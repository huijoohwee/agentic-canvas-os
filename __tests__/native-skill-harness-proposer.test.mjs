import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  GAP_SIGNAL_SCHEMA,
  SKILL_DRAFT_SCHEMA,
  SKILL_PROPOSER_DEFAULTS,
  SKILL_PROPOSER_IDENTITY,
  SKILL_PROPOSER_TRACE_SCHEMA,
  SkillProposalBlock,
  createSkillProposerRuntime,
  gapSignalFromToolSearchDenial,
  normalizeCostEntry,
  normalizeGapSignal,
  p95CostDecision,
} from "../agent-api/src/skill-proposer.js";
import {
  captureSnapshot,
  createInMemoryDraftStore,
  createInMemoryToolAllowlist,
  createRecordingObserver,
  createScriptedCandidateAdapter,
  createValidAgentDefinition,
  createValidGapSignal,
} from "./lib/native-skill-harness-fakes.mjs";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";

const PROPERTY_SEED = 20260817;

function createRegistry() {
  return createAgentDefinitionRegistry({
    verifyDefinitionSource: async ({ source }) => ({
      verified: true,
      uri: source.uri,
      digest: source.digest,
      verificationId: "source-proof-1",
    }),
  });
}

function createHarness({ markers = ["valid"], costThrows = false, gapSignal = createValidGapSignal(), runtimeOverrides = {} } = {}) {
  const draftStore = createInMemoryDraftStore();
  const adapter = createScriptedCandidateAdapter(markers);
  const costObserver = createRecordingObserver({ throws: costThrows });
  const traceObserver = createRecordingObserver();
  const registry = createRegistry();
  registry.register(createValidAgentDefinition());
  const allowlist = createInMemoryToolAllowlist();
  let clock = 1_000;
  const runtime = createSkillProposerRuntime({
    draftStore,
    proposeCandidate: adapter.proposeCandidate,
    emitCostLog: costObserver.emit,
    emitTrace: traceObserver.emit,
    now: () => clock,
    ...runtimeOverrides,
  });
  return { draftStore, adapter, costObserver, traceObserver, registry, allowlist, runtime, gapSignal, tick: (step) => { clock += step; } };
}

function expectedStopReason(markers, breakerThreshold) {
  let iterations = 0;
  let consecutiveNoCandidate = 0;
  while (iterations < SKILL_PROPOSER_DEFAULTS.iterationBound) {
    const marker = markers[Math.min(iterations, markers.length - 1)] ?? "valid";
    iterations += 1;
    if (marker === "throws") {
      return { stopReason: "provider_unreachable", iterationCount: iterations, circuitBreaker: "not_tripped" };
    }
    if (marker === "valid") {
      return { stopReason: "candidate_accepted", iterationCount: iterations, circuitBreaker: "not_tripped" };
    }
    consecutiveNoCandidate += 1;
    if (consecutiveNoCandidate >= breakerThreshold) {
      return { stopReason: "circuit_breaker_tripped", iterationCount: iterations, circuitBreaker: "tripped" };
    }
  }
  return {
    stopReason: "iteration_bound_reached",
    iterationCount: SKILL_PROPOSER_DEFAULTS.iterationBound,
    circuitBreaker: "not_tripped",
  };
}

function usageFromVariant(variant) {
  switch (variant) {
    case "complete":
      return {
        model: "fixture-model",
        prompt_tokens: 120,
        completion_tokens: 80,
        cache_hits: 32,
        estimated_cost_usd: 0.002,
      };
    case "missing_fields":
      return { model: "fixture-model", prompt_tokens: 120 };
    case "extra_fields":
      return {
        model: "fixture-model",
        prompt_tokens: 120,
        completion_tokens: 80,
        cache_hits: 32,
        estimated_cost_usd: 0.002,
        extra_field: true,
      };
    case "non_numeric":
      return {
        model: "fixture-model",
        prompt_tokens: "bad",
        completion_tokens: "bad",
        cache_hits: "bad",
        estimated_cost_usd: "bad",
      };
    default:
      return undefined;
  }
}

test("declared budget and latency constants match the harness contract", () => {
  assert.equal(SKILL_PROPOSER_DEFAULTS.maxPromptTokens, 800);
  assert.equal(SKILL_PROPOSER_DEFAULTS.maxCompletionTokens, 400);
  assert.equal(SKILL_PROPOSER_DEFAULTS.cacheHitTarget, 0.4);
  assert.equal(SKILL_PROPOSER_DEFAULTS.iterationBound, 5);
  assert.equal(SKILL_PROPOSER_DEFAULTS.circuitBreakerConsecutiveNoCandidate, 2);
  assert.equal(SKILL_PROPOSER_DEFAULTS.p95GapToDraftMs, 12000);
});

test("a configuration above the declared token ceiling is rejected at construction", () => {
  assert.throws(
    () => createSkillProposerRuntime({ maxPromptTokens: 801 }),
    (error) => error instanceof SkillProposalBlock && error.reasonCode === "budget_ceiling_exceeded",
  );
  assert.throws(
    () => createSkillProposerRuntime({ maxCompletionTokens: 401 }),
    (error) => error instanceof SkillProposalBlock,
  );
});

test("a valid candidate writes exactly one proposed draft and returns exactly three fields", async () => {
  const harness = createHarness();
  const snapshotBefore = captureSnapshot(harness.registry);
  const result = await harness.runtime.propose(harness.gapSignal);

  assert.deepEqual(Object.keys(result).sort(), ["confidence", "draft_agent_definition", "rationale"]);
  assert.equal(result.draft_agent_definition.status, "proposed");
  const putCalls = harness.draftStore.calls.filter((call) => call.method === "put");
  assert.equal(putCalls.length, 1);
  const stored = await harness.draftStore.peek(putCalls[0].argument);
  assert.equal(stored.schema, SKILL_DRAFT_SCHEMA);
  assert.equal(stored.status, "proposed");
  assert.equal(stored.consumed, false);
  assert.equal(stored.proposing_mechanism.identity, SKILL_PROPOSER_IDENTITY);
  assert.deepEqual(await harness.draftStore.indexList("agentic-graph"), [stored.draft_id]);

  // Inertness: the active registry and the tool allowlist are untouched.
  assert.equal(captureSnapshot(harness.registry), snapshotBefore);
  assert.equal(harness.allowlist.snapshot(), JSON.stringify([]));

  // Exactly one trace entry with the unapproved literal and the iteration count.
  assert.equal(harness.traceObserver.entries.length, 1);
  const trace = harness.traceObserver.entries[0];
  assert.equal(trace.schema, SKILL_PROPOSER_TRACE_SCHEMA);
  assert.equal(trace.approval_status, "skill-creation: unapproved");
  assert.equal(trace.stop_reason, "candidate_accepted");
  assert.equal(trace.iteration_count, 1);
  assert.equal(trace.iteration_bound, 5);
  assert.equal(trace.circuit_breaker, "not_tripped");
  assert.ok(Number.isFinite(trace.elapsed_ms) && trace.elapsed_ms >= 0);
  assert.equal(trace.cost_log_emitted, true);
  assert.equal(trace.observation_gap, null);
  assert.equal(trace.draft_id, stored.draft_id);
});

test("every emitted Cost_Log_Entry carries exactly the five universal fields", async () => {
  const harness = createHarness({ markers: ["valid"] });
  await harness.runtime.propose(harness.gapSignal);
  assert.equal(harness.costObserver.entries.length, 1);
  assert.deepEqual(
    Object.keys(harness.costObserver.entries[0]).sort(),
    ["cache_hits", "completion_tokens", "estimated_cost_usd", "model", "prompt_tokens"],
  );

  assert.deepEqual(normalizeCostEntry(undefined), {
    model: "unreported",
    prompt_tokens: null,
    completion_tokens: null,
    cache_hits: null,
    estimated_cost_usd: null,
  });
  assert.deepEqual(normalizeCostEntry({ model: "m", prompt_tokens: "x", completion_tokens: 5, cache_hits: 1, estimated_cost_usd: 0.5 }), {
    model: "m",
    prompt_tokens: null,
    completion_tokens: 5,
    cache_hits: 1,
    estimated_cost_usd: 0.5,
  });
});

test("an invalid gap signal throws typed, spends nothing, and emits one zero-iteration trace", async () => {
  const harness = createHarness();
  await assert.rejects(
    () => harness.runtime.propose({ schema: GAP_SIGNAL_SCHEMA, signal_id: "gap-002" }),
    (error) => error instanceof SkillProposalBlock && error.reasonCode === "gap_signal_invalid",
  );
  assert.equal(harness.adapter.calls.length, 0);
  assert.equal(harness.costObserver.entries.length, 0);
  assert.equal(harness.draftStore.calls.length, 0);
  assert.equal(harness.traceObserver.entries.length, 1);
  assert.equal(harness.traceObserver.entries[0].stop_reason, "gap_signal_invalid");
  assert.equal(harness.traceObserver.entries[0].iteration_count, 0);
});

test("a prompt estimate above 800 tokens stops before the adapter call", async () => {
  const harness = createHarness();
  const hugeSignal = createValidGapSignal({
    missing_tool_names: [`${"t".repeat(4000)}`],
    capability: "c".repeat(200),
  });
  const result = await harness.runtime.propose(hugeSignal);
  assert.equal(result.status, "no-draft");
  assert.equal(result.reason_code, "budget_breach");
  assert.ok(result.estimated_prompt_tokens > 800);
  assert.equal(harness.adapter.calls.length, 0);
  assert.equal(harness.draftStore.calls.length, 0);
});

test("a provider failure returns a typed no-draft with nothing persisted", async () => {
  const harness = createHarness({ markers: ["throws"] });
  const result = await harness.runtime.propose(harness.gapSignal);
  assert.equal(result.status, "no-draft");
  assert.equal(result.reason_code, "provider_unreachable");
  assert.equal(harness.draftStore.calls.length, 0);
  assert.equal(harness.traceObserver.entries[0].stop_reason, "provider_unreachable");
});

test("two consecutive no-candidate iterations trip the circuit breaker", async () => {
  const harness = createHarness({ markers: ["malformed", "malformed", "valid"] });
  const result = await harness.runtime.propose(harness.gapSignal);
  assert.equal(result.reason_code, "circuit_breaker_tripped");
  assert.equal(result.iteration_count, 2);
  assert.equal(harness.draftStore.calls.length, 0);
  const trace = harness.traceObserver.entries[0];
  assert.equal(trace.circuit_breaker, "tripped");
  assert.equal(trace.stop_reason, "circuit_breaker_tripped");
});

test("a malformed candidate is retried within the bound and the bound stop is observable", async () => {
  const retry = createHarness({ markers: ["malformed", "valid"] });
  const retried = await retry.runtime.propose(retry.gapSignal);
  assert.equal(retried.draft_agent_definition.status, "proposed");
  assert.equal(retry.traceObserver.entries[0].iteration_count, 2);

  // The breaker trips at two consecutive no-candidates by default, so the
  // iteration bound is observable only when the breaker threshold sits above
  // the bound.
  const draftStore = createInMemoryDraftStore();
  const adapter = createScriptedCandidateAdapter(["malformed"]);
  const traceObserver = createRecordingObserver();
  const boundedRuntime = createSkillProposerRuntime({
    draftStore,
    proposeCandidate: adapter.proposeCandidate,
    emitTrace: traceObserver.emit,
    circuitBreakerConsecutiveNoCandidate: 6,
  });
  const bounded = await boundedRuntime.propose(createValidGapSignal());
  assert.equal(bounded.reason_code, "iteration_bound_reached");
  assert.equal(bounded.iteration_count, 5);
  assert.equal(traceObserver.entries[0].iteration_bound, 5);
  assert.equal(traceObserver.entries[0].circuit_breaker, "not_tripped");
});

test("a cost log emitter failure is an observation gap that changes no outcome", async () => {
  const harness = createHarness({ costThrows: true });
  const result = await harness.runtime.propose(harness.gapSignal);
  assert.equal(result.draft_agent_definition.status, "proposed");
  const trace = harness.traceObserver.entries[0];
  assert.equal(trace.observation_gap, "cost log emission failed; cost evidence is an observation gap");
  assert.equal(trace.cost_log_emitted, false);
  assert.equal(trace.stop_reason, "candidate_accepted");
});

test("the p95 cost decision computes the percentile and breach boolean", () => {
  const series = Array.from({ length: 20 }, (_, index) => normalizeCostEntry({ estimated_cost_usd: 0.001 * (index + 1) }));
  const decision = p95CostDecision(series);
  assert.equal(decision.sampleCount, 20);
  assert.equal(decision.p95, 0.019);
  assert.equal(decision.breach, true);

  const cheap = Array.from({ length: 20 }, () => normalizeCostEntry({ estimated_cost_usd: 0.0001 }));
  assert.equal(p95CostDecision(cheap).breach, false);
  assert.deepEqual(p95CostDecision([]), { sampleCount: 0, p95: null, breach: false });
});

test("gapSignalFromToolSearchDenial maps a tool-search denial into a Gap_Signal", () => {
  const signal = gapSignalFromToolSearchDenial(
    { authorized: false, reasonCode: "tool_not_granted" },
    {
      signal_id: "gap-009",
      adapter_id: "agentic-graph",
      capability: "update agent run notes",
      missing_tool_names: ["update_agent_run_note"],
      observed_at_ms: 1786950000000,
    },
  );
  assert.equal(signal.schema, GAP_SIGNAL_SCHEMA);
  assert.equal(signal.denial_reason_code, "tool_not_granted");
  assert.throws(
    () => gapSignalFromToolSearchDenial({ authorized: true }, {}),
    TypeError,
  );
});

test("the runtime surface is exactly propose and stats with no registry write", () => {
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.runtime).sort(), ["propose", "stats"]);
  assert.equal(harness.runtime.stats().registryWriteCapability, false);
  assert.equal(harness.runtime.stats().modelAdapterConfigured, true);
  assert.equal(harness.runtime.stats().draftStoreConfigured, true);
});

// Feature: native-skill-creation-harness, Property 5: Proposer inertness and observable unapproved terminal outcome.
test("Property 5: Proposer inertness and observable unapproved terminal outcome", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("valid", "malformed", "throws"), { minLength: 1, maxLength: 20 }),
      fc.boolean(),
      async (markers, costThrows) => {
        const harness = createHarness({ markers, costThrows });
        const snapshotBefore = captureSnapshot(harness.registry);
        const allowlistBefore = harness.allowlist.snapshot();
        let outcome = null;
        let thrown = null;
        try {
          outcome = await harness.runtime.propose(harness.gapSignal);
        } catch (error) {
          thrown = error;
        }

        const putCalls = harness.draftStore.calls.filter((call) => call.method === "put");
        assert.ok(putCalls.length <= 1);
        assert.equal(captureSnapshot(harness.registry), snapshotBefore);
        assert.equal(harness.allowlist.snapshot(), allowlistBefore);
        const isSuccess = Boolean(outcome && !("status" in outcome));
        const isNoDraft = outcome?.status === "no-draft";
        const isTypedThrow = thrown instanceof SkillProposalBlock;
        assert.equal(Number(isSuccess) + Number(isNoDraft) + Number(isTypedThrow), 1);
        assert.equal(harness.traceObserver.entries.length, 1);
        assert.equal(harness.traceObserver.entries[0].approval_status, "skill-creation: unapproved");
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 5 },
  );
});

// Feature: native-skill-creation-harness, Property 6: Bounded termination with observable stop state.
test("Property 6: Bounded termination with observable stop state", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("valid", "malformed", "throws"), { minLength: 1, maxLength: 20 }),
      fc.constantFrom(2, 6),
      async (markers, breakerThreshold) => {
        const harness = createHarness({
          markers,
          runtimeOverrides: { circuitBreakerConsecutiveNoCandidate: breakerThreshold },
        });
        const expected = expectedStopReason(markers, breakerThreshold);
        const outcome = await harness.runtime.propose(harness.gapSignal);
        const trace = harness.traceObserver.entries[0];

        assert.ok(trace.iteration_count >= 0);
        assert.ok(trace.iteration_count <= SKILL_PROPOSER_DEFAULTS.iterationBound);
        assert.equal(trace.iteration_bound, SKILL_PROPOSER_DEFAULTS.iterationBound);
        assert.equal(trace.stop_reason, expected.stopReason);
        assert.equal(trace.iteration_count, expected.iterationCount);
        assert.equal(trace.circuit_breaker, expected.circuitBreaker);

        if (expected.stopReason === "candidate_accepted") {
          assert.ok(outcome && !("status" in outcome));
        } else {
          assert.equal(outcome.status, "no-draft");
          assert.equal(outcome.reason_code, expected.stopReason);
        }
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 6 },
  );
});

// Feature: native-skill-creation-harness, Property 7: Result and cost log field exactness.
test("Property 7: Result and cost log field exactness", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("complete", "missing_fields", "extra_fields", "non_numeric", "absent"),
      async (usageVariant) => {
        const draftStore = createInMemoryDraftStore();
        const costObserver = createRecordingObserver();
        const runtime = createSkillProposerRuntime({
          draftStore,
          emitCostLog: costObserver.emit,
          proposeCandidate: async () => ({
            agent_definition: createValidAgentDefinition({ id: `variant-${usageVariant}`, revision: `variant-${usageVariant}-v1` }),
            rationale: `usage-${usageVariant}`,
            confidence: 0.5,
            usage: usageFromVariant(usageVariant),
          }),
        });
        const result = await runtime.propose(createValidGapSignal({ signal_id: `gap-${usageVariant}` }));
        assert.deepEqual(Object.keys(result).sort(), ["confidence", "draft_agent_definition", "rationale"]);
        assert.equal(costObserver.entries.length, 1);
        assert.deepEqual(
          Object.keys(costObserver.entries[0]).sort(),
          ["cache_hits", "completion_tokens", "estimated_cost_usd", "model", "prompt_tokens"],
        );
      },
    ),
    { numRuns: 50, seed: PROPERTY_SEED + 7 },
  );
});

// Feature: native-skill-creation-harness, Property 9: All-or-nothing draft persistence.
test("Property 9: All-or-nothing draft persistence", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("valid", "malformed", "throws"), { minLength: 1, maxLength: 20 }),
      async (markers) => {
        const harness = createHarness({ markers });
        let outcome = null;
        let thrown = null;
        try {
          outcome = await harness.runtime.propose(harness.gapSignal);
        } catch (error) {
          thrown = error;
        }

        const putCalls = harness.draftStore.calls.filter((call) => call.method === "put");
        const indexWrites = harness.draftStore.calls.filter((call) => call.method === "indexAppend");
        assert.ok(putCalls.length <= 1);
        assert.ok(indexWrites.length <= 1);

        if (putCalls.length === 1) {
          assert.equal(indexWrites.length, 1);
          assert.equal(thrown, null);
          assert.ok(outcome && !("status" in outcome));
          const stored = await harness.draftStore.peek(putCalls[0].argument);
          assert.ok(stored);
          assert.equal(stored.status, "proposed");
          assert.equal(stored.consumed, false);
        } else {
          assert.equal(indexWrites.length, 0);
          assert.equal((await harness.draftStore.indexList("agentic-graph")).length, 0);
          assert.ok(
            (outcome && outcome.status === "no-draft")
              || thrown instanceof SkillProposalBlock,
          );
        }
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 9 },
  );
});

// Feature: native-skill-creation-harness, Property 8: Fail before spend.
test("Property 8: Fail before spend", async () => {
  const invalidGapSignalArb = fc.anything().filter((value) => {
    try {
      normalizeGapSignal(value);
      return false;
    } catch {
      return true;
    }
  });
  await fc.assert(
    fc.asyncProperty(
      invalidGapSignalArb,
      fc.integer({ min: 0, max: 2000 }),
      fc.integer({ min: 0, max: 2000 }),
      async (invalidGapSignal, promptUnits, completionBudget) => {
        const invalidHarness = createHarness();
        await assert.rejects(
          () => invalidHarness.runtime.propose(invalidGapSignal),
          (error) => error instanceof SkillProposalBlock && error.reasonCode === "gap_signal_invalid",
        );
        assert.equal(invalidHarness.adapter.calls.length, 0);
        assert.equal(invalidHarness.costObserver.entries.length, 0);

        if (completionBudget > SKILL_PROPOSER_DEFAULTS.maxCompletionTokens) {
          assert.throws(
            () => createHarness({ runtimeOverrides: { maxCompletionTokens: completionBudget } }),
            (error) => error instanceof SkillProposalBlock && error.reasonCode === "budget_ceiling_exceeded",
          );
          return;
        }

        const breachHarness = createHarness({
          runtimeOverrides: { maxCompletionTokens: completionBudget },
        });
        const signal = createValidGapSignal({
          missing_tool_names: [`tool-${"t".repeat(Math.max(1, promptUnits * 8))}`],
          capability: "c".repeat(Math.max(1, promptUnits * 2)),
        });
        const outcome = await breachHarness.runtime.propose(signal);
        if (outcome.status === "no-draft" && outcome.reason_code === "budget_breach") {
          assert.equal(breachHarness.adapter.calls.length, 0);
          assert.equal(breachHarness.costObserver.entries.length, 0);
        }
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 8 },
  );
});
