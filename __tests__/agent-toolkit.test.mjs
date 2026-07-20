import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createAgentApiApp } from "../agent-api/src/app.js";
import {
  createAgentToolkitMemoryStore,
  createAgentToolkitRuntime,
} from "../agent-api/src/agent-toolkit.js";

const COST = Object.freeze({
  model: "offline-toolkit-model",
  prompt_tokens: 3,
  completion_tokens: 2,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

const PROFILE = Object.freeze({
  evaluator: Object.freeze({ id: "quality-evaluator", revision: "eval-v1", digest: "1".repeat(64) }),
  dataset: Object.freeze({ id: "support-suite", revision: "suite-v1", digest: "2".repeat(64) }),
  metric: Object.freeze({
    id: "resolved-quality", revision: "metric-v1", digest: "3".repeat(64), direction: "maximize",
  }),
});

const BASELINE = Object.freeze({ id: "baseline", revision: "policy-v1", digest: "a".repeat(64) });
const CANDIDATE = Object.freeze({ id: "candidate", revision: "policy-v2", digest: "b".repeat(64) });

function request(runId, candidate = BASELINE, cohortId = "support-cohort") {
  return {
    runId,
    cohortId,
    target: { kind: "team", id: "support-team", revision: "team-v3", digest: "4".repeat(64) },
    candidate,
    adapter: { id: "framework-neutral-adapter", revision: "adapter-v1", digest: "5".repeat(64) },
    operation: "resolve-support-case",
    profile: PROFILE,
  };
}

function evidence(id) {
  return { id, digest: createHash("sha256").update(`subject:${id}`).digest("hex") };
}

function evaluatorOutcome(score, id) {
  return {
    status: "reported",
    score,
    metric: PROFILE.metric,
    evidence: {
      id: `evaluation-${id}`,
      digest: createHash("sha256").update(`evaluation:${id}`).digest("hex"),
    },
    costLog: COST,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createHarness({ stateStore, evaluate, authorize, now, ...limits } = {}) {
  const calls = { authorize: [], evaluate: [] };
  const runtime = createAgentToolkitRuntime({
    ...(stateStore ? { stateStore } : {}),
    now: now || (() => Date.now()),
    authorize: authorize || (async (call) => {
      calls.authorize.push(call);
      return { allowed: true, authorizationId: "offline-toolkit-authorization" };
    }),
    evaluate: evaluate || (async (call) => {
      calls.evaluate.push(call);
      const candidate = call.candidate.id === "candidate";
      return evaluatorOutcome(candidate ? 0.92 : 0.72, call.evidence.id);
    }),
    ...limits,
  });
  return { runtime, calls };
}

async function observedRun(runtime, value, {
  durationMs = 10,
  costLog = COST,
  evidenceRef = evidence(value.runId),
  access = { principalId: "owner" },
} = {}, clock) {
  const started = await runtime.start(value, access);
  assert.equal(started.status, "running");
  await runtime.startSpan({
    runId: value.runId,
    spanId: "root",
    kind: value.target.kind,
    operation: value.operation,
    component: { id: value.target.id, revision: value.target.revision, digest: value.target.digest },
  }, access);
  clock.advance(durationMs);
  await runtime.finishSpan({ runId: value.runId, spanId: "root", status: "completed" }, access);
  await runtime.complete({
    runId: value.runId,
    operationId: `complete-${value.runId}`,
    status: "completed",
    costLog,
  }, access);
  return runtime.evaluate({
    runId: value.runId,
    operationId: `evaluate-${value.runId}`,
    evidence: evidenceRef,
  }, access);
}

test("instruments an arbitrary adapter with server timing and persists metadata only", async () => {
  let time = 1_000;
  const { runtime, calls } = createHarness({ now: () => time });
  const secretOutput = "private-output-must-not-be-persisted";
  const secretInput = "private-input-must-not-be-persisted";
  const result = await runtime.instrument(request("instrumented-run"), async ({ signal, target, candidate, adapter }) => {
    assert.equal(signal instanceof AbortSignal, true);
    assert.deepEqual(target, request("unused").target);
    assert.deepEqual(candidate, BASELINE);
    assert.equal(adapter.id, "framework-neutral-adapter");
    time += 25;
    return {
      value: { answer: secretOutput, source: secretInput },
      costLog: COST,
      evidence: evidence("baseline-observation"),
    };
  }, { principalId: "owner" });

  assert.equal(result.status, "completed");
  assert.equal(result.value.answer, secretOutput);
  assert.equal(result.observation.spans[0].durationMs, 25);
  assert.equal(result.observation.completion.cost.status, "reported");
  assert.equal(result.observation.evaluation.status, "reported");
  assert.equal(calls.evaluate.length, 1);
  assert.equal(calls.evaluate[0].signal instanceof AbortSignal, true);
  assert.equal(calls.evaluate[0].profile.dataset.revision, "suite-v1");
  const persisted = JSON.stringify(result.observation);
  for (const sentinel of [secretOutput, secretInput, "rawPromptSentinel", "privateReasoning", "toolPayload"]) {
    assert.equal(persisted.includes(sentinel), false);
  }
  assert.equal(runtime.stats().defaultEgress, false);
  assert.equal("apply" in runtime, false);
});

test("compares only same-cohort evidence and creates a review-pending immutable proposal", async () => {
  let time = 2_000;
  const clock = { advance: (value) => { time += value; } };
  const { runtime } = createHarness({ now: () => time });
  await observedRun(runtime, request("baseline-1"), { durationMs: 20 }, clock);
  await observedRun(runtime, request("baseline-2"), { durationMs: 22 }, clock);
  await observedRun(runtime, request("candidate-1", CANDIDATE), { durationMs: 18 }, clock);
  await observedRun(runtime, request("candidate-2", CANDIDATE), { durationMs: 19 }, clock);
  const policy = {
    minSamples: 2,
    qualityBoundary: 0.8,
    minimumQualityImprovement: 0.1,
    maxLatencyRegressionRatio: 1,
    maxCostRegressionRatio: 1,
  };
  const comparison = await runtime.compare({
    cohortId: "support-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy,
  }, { principalId: "owner" });

  assert.equal(comparison.status, "completed");
  assert.equal(comparison.recommendation, "propose");
  assert.equal(comparison.applied, false);
  assert.equal(comparison.reviewRequired, true);
  assert.deepEqual(comparison.sampleCounts, { baseline: 2, candidate: 2 });
  assert.equal(comparison.checks.qualityImprovement, true);
  assert.equal(typeof comparison.comparisonDigest, "string");

  const proposal = await runtime.propose({
    cohortId: "support-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy,
    operationId: "proposal-1",
  }, { principalId: "owner" });
  const replay = await runtime.propose({
    cohortId: "support-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy,
    operationId: "proposal-1",
  }, { principalId: "owner" });
  assert.equal(proposal.status, "review_pending");
  assert.equal(proposal.applied, false);
  assert.equal(proposal.reviewRequired, true);
  assert.equal(replay.proposalId, proposal.proposalId);
});

test("reports insufficient evidence when quality or cost is not honestly available", async () => {
  let time = 4_000;
  const clock = { advance: (value) => { time += value; } };
  const { runtime } = createHarness({ now: () => time });
  for (const [runId, candidate] of [["unreported-base", BASELINE], ["unreported-candidate", CANDIDATE]]) {
    await runtime.start(request(runId, candidate, "unreported-cohort"), { principalId: "owner" });
    clock.advance(5);
    await runtime.complete({ runId, operationId: `complete-${runId}`, status: "completed" }, { principalId: "owner" });
  }
  const comparison = await runtime.compare({
    cohortId: "unreported-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy: {
      minSamples: 1,
      qualityBoundary: 0,
      minimumQualityImprovement: 0,
      maxLatencyRegressionRatio: 2,
      maxCostRegressionRatio: 2,
    },
  }, { principalId: "owner" });
  assert.equal(comparison.status, "insufficient-evidence");
  assert.equal(comparison.reasonCode, "quality_unreported");
  assert.equal(comparison.recommendation, "hold");
});

test("fences duplicate evaluation spend across runtimes sharing one atomic store", async () => {
  let time = 6_000;
  const clock = { advance: (value) => { time += value; } };
  const stateStore = createAgentToolkitMemoryStore({ now: () => time });
  const gate = deferred();
  let calls = 0;
  const evaluate = async (call) => {
    calls += 1;
    await gate.promise;
    return evaluatorOutcome(0.75, call.evidence.id);
  };
  const first = createHarness({ stateStore, now: () => time, evaluate }).runtime;
  const second = createHarness({ stateStore, now: () => time, evaluate }).runtime;
  await first.start(request("shared-run", BASELINE, "shared-cohort"), { principalId: "owner" });
  clock.advance(10);
  await first.complete({
    runId: "shared-run", operationId: "shared-complete", status: "completed", costLog: COST,
  }, { principalId: "owner" });
  const firstEvaluation = first.evaluate({
    runId: "shared-run", operationId: "shared-evaluation", evidence: evidence("shared"),
  }, { principalId: "owner" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const duplicate = await second.evaluate({
    runId: "shared-run", operationId: "duplicate-evaluation", evidence: evidence("shared"),
  }, { principalId: "owner" });
  assert.equal(duplicate.reasonCode, "evaluation_busy");
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal((await firstEvaluation).evaluation.status, "reported");
  assert.equal(calls, 1);
});

test("isolates principals, rejects unsafe fields, and redacts adapter failures", async () => {
  const { runtime } = createHarness();
  await runtime.start(request("owned-run", BASELINE, "owned-cohort"), { principalId: "owner" });
  assert.equal((await runtime.status("owned-run", { principalId: "other" })).reasonCode, "run_not_found");
  await assert.rejects(
    () => runtime.start({ ...request("raw-run"), prompt: "raw secret" }, { principalId: "owner" }),
    /unsupported fields: prompt/,
  );
  await assert.rejects(
    () => runtime.start({ ...request("signal-run"), signal: { aborted: false } }, { principalId: "owner" }),
    /must be an AbortSignal/,
  );
  const failed = await runtime.instrument(
    request("failed-run", BASELINE, "failed-cohort"),
    async () => { throw new Error("private-provider-key-and-payload"); },
    { principalId: "owner" },
  );
  assert.equal(failed.reasonCode, "adapter_failed");
  assert.equal(JSON.stringify(failed).includes("private-provider-key-and-payload"), false);
});

test("keeps nested spans ordered and rejects evaluator provenance changes", async () => {
  let time = 8_000;
  const runtime = createHarness({ now: () => time }).runtime;
  await runtime.start(request("nested-run", BASELINE, "nested-cohort"), { principalId: "owner" });
  const parent = {
    runId: "nested-run",
    spanId: "parent",
    kind: "team",
    operation: "parent-work",
    component: { id: "support-team", revision: "team-v3", digest: "4".repeat(64) },
  };
  assert.equal((await runtime.startSpan(parent, { principalId: "owner" })).status, "running");
  assert.equal((await runtime.startSpan(parent, { principalId: "owner" })).status, "running");
  await runtime.startSpan({
    ...parent,
    spanId: "child",
    parentSpanId: "parent",
    kind: "tool",
    operation: "child-work",
    component: { id: "lookup", revision: "tool-v1", digest: "6".repeat(64) },
  }, { principalId: "owner" });
  assert.equal((await runtime.finishSpan({
    runId: "nested-run", spanId: "parent", status: "completed",
  }, { principalId: "owner" })).reasonCode, "span_children_running");
  time += 5;
  await runtime.finishSpan({ runId: "nested-run", spanId: "child", status: "completed" }, { principalId: "owner" });
  assert.equal((await runtime.finishSpan({
    runId: "nested-run", spanId: "parent", status: "completed",
  }, { principalId: "owner" })).spans.every((span) => span.status === "completed"), true);

  const mismatched = createHarness({
    now: () => time,
    evaluate: async () => ({
      ...evaluatorOutcome(0.8, "mismatch"),
      metric: { ...PROFILE.metric, revision: "metric-poisoned" },
    }),
  }).runtime;
  await mismatched.start(request("mismatch-run", BASELINE, "mismatch-cohort"), { principalId: "owner" });
  time += 1;
  await mismatched.complete({
    runId: "mismatch-run", operationId: "mismatch-complete", status: "completed", costLog: COST,
  }, { principalId: "owner" });
  const result = await mismatched.evaluate({
    runId: "mismatch-run", operationId: "mismatch-evaluate", evidence: evidence("mismatch"),
  }, { principalId: "owner" });
  assert.equal(result.reasonCode, "evaluation_metric_mismatch");
  assert.equal((await mismatched.status("mismatch-run", { principalId: "owner" })).evaluation.status, "pending");
});

test("binds cohort provenance and excludes remote-unverified telemetry from decisions", async () => {
  let time = 10_000;
  const clock = { advance: (value) => { time += value; } };
  const { runtime } = createHarness({ now: () => time });
  await runtime.start(request("bound-run", BASELINE, "bound-cohort"), { principalId: "owner" });
  const mixedAdapter = request("mixed-adapter", BASELINE, "bound-cohort");
  mixedAdapter.adapter = { ...mixedAdapter.adapter, revision: "adapter-v2", digest: "7".repeat(64) };
  assert.equal((await runtime.start(mixedAdapter, { principalId: "owner" })).reasonCode, "cohort_mismatch");
  const mixedOperation = { ...request("mixed-operation", BASELINE, "bound-cohort"), operation: "other-operation" };
  assert.equal((await runtime.start(mixedOperation, { principalId: "owner" })).reasonCode, "cohort_mismatch");

  const remote = { principalId: "remote-owner", telemetryTrust: "remote-unverified" };
  await observedRun(runtime, request("remote-base", BASELINE, "remote-cohort"), { access: remote }, clock);
  await observedRun(runtime, request("remote-candidate", CANDIDATE, "remote-cohort"), { access: remote }, clock);
  const comparison = await runtime.compare({
    cohortId: "remote-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy: {
      minSamples: 1,
      qualityBoundary: 0,
      minimumQualityImprovement: 0,
      maxLatencyRegressionRatio: 2,
      maxCostRegressionRatio: 2,
    },
  }, remote);
  assert.equal(comparison.status, "insufficient-evidence");
  assert.equal(comparison.reasonCode, "trusted_sample_count");
  assert.deepEqual(comparison.sampleCounts, { baseline: 0, candidate: 0 });
  assert.deepEqual(comparison.untrustedSampleCounts, { baseline: 1, candidate: 1 });
});

test("rejects reused source evidence and repairs cohort synchronization after a commit crash", async () => {
  let time = 12_000;
  const clock = { advance: (value) => { time += value; } };
  const first = createHarness({ now: () => time }).runtime;
  const reused = evidence("same-source");
  await observedRun(first, request("unique-base", BASELINE, "unique-cohort"), { evidenceRef: reused }, clock);
  const duplicate = await observedRun(
    first,
    request("duplicate-base", BASELINE, "unique-cohort"),
    { evidenceRef: reused },
    clock,
  );
  assert.equal(duplicate.reasonCode, "evidence_reused");
  await observedRun(first, request("unique-candidate-1", CANDIDATE, "unique-cohort"), {}, clock);
  await observedRun(first, request("unique-candidate-2", CANDIDATE, "unique-cohort"), {}, clock);
  const insufficient = await first.compare({
    cohortId: "unique-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy: {
      minSamples: 2,
      qualityBoundary: 0,
      minimumQualityImprovement: 0,
      maxLatencyRegressionRatio: 2,
      maxCostRegressionRatio: 2,
    },
  }, { principalId: "owner" });
  assert.equal(insufficient.reasonCode, "trusted_sample_count");
  assert.equal(insufficient.sampleCounts.baseline, 1);

  const backing = createAgentToolkitMemoryStore({ now: () => time });
  let armed = false;
  let failedOnce = false;
  const faultStore = Object.freeze({
    ...backing,
    async replace(recordId, claimId, replacement) {
      const reportedCohort = replacement.schema === "agent-toolkit-cohort/v1"
        && replacement.samples.some((sample) => sample.quality.status === "reported");
      if (armed && !failedOnce && reportedCohort) {
        failedOnce = true;
        return false;
      }
      return backing.replace(recordId, claimId, replacement);
    },
  });
  const recovering = createHarness({ stateStore: faultStore, now: () => time }).runtime;
  await observedRun(recovering, request("repair-candidate", CANDIDATE, "repair-cohort"), {}, clock);
  await recovering.start(request("repair-base", BASELINE, "repair-cohort"), { principalId: "owner" });
  clock.advance(5);
  await recovering.complete({
    runId: "repair-base", operationId: "repair-complete", status: "completed", costLog: COST,
  }, { principalId: "owner" });
  armed = true;
  const evaluationRequest = {
    runId: "repair-base", operationId: "repair-evaluate", evidence: evidence("repair-base"),
  };
  assert.equal((await recovering.evaluate(evaluationRequest, { principalId: "owner" })).reasonCode, "state_conflict");
  assert.equal((await recovering.evaluate(evaluationRequest, { principalId: "owner" })).evaluation.status, "reported");
  const repaired = await recovering.compare({
    cohortId: "repair-cohort",
    baseline: BASELINE,
    candidate: CANDIDATE,
    policy: {
      minSamples: 1,
      qualityBoundary: 0,
      minimumQualityImprovement: 0,
      maxLatencyRegressionRatio: 2,
      maxCostRegressionRatio: 2,
    },
  }, { principalId: "owner" });
  assert.equal(repaired.status, "completed");
});

test("freezes evaluator provenance and bounds metadata, costs, scores, and runtime limits", async () => {
  let mutationBlocked = false;
  const hardened = createHarness({
    evaluate: async (call) => {
      try {
        call.profile.metric.id = "poisoned-metric";
      } catch {
        mutationBlocked = true;
      }
      return { ...evaluatorOutcome(0.8, call.evidence.id), metric: call.profile.metric };
    },
  }).runtime;
  await hardened.start(request("frozen-run", BASELINE, "frozen-cohort"), { principalId: "owner" });
  await hardened.complete({
    runId: "frozen-run", operationId: "frozen-complete", status: "completed", costLog: COST,
  }, { principalId: "owner" });
  const evaluated = await hardened.evaluate({
    runId: "frozen-run", operationId: "frozen-evaluate", evidence: evidence("frozen"),
  }, { principalId: "owner" });
  assert.equal(mutationBlocked, true);
  assert.equal(evaluated.evaluation.metric.id, PROFILE.metric.id);

  await hardened.start(request("bounded-run", BASELINE, "bounded-cohort"), { principalId: "owner" });
  await assert.rejects(() => hardened.complete({
    runId: "bounded-run",
    operationId: "bounded-complete",
    status: "completed",
    costLog: { ...COST, prompt_tokens: 1_000_000_000_001 },
  }, { principalId: "owner" }), /exceeds the Agent Toolkit bound/);
  assert.equal((await hardened.status("bounded-run", { principalId: "owner" })).status, "running");
  await assert.rejects(
    () => hardened.start({ ...request("smuggled-run"), operation: "rawPrompt=customer-secret" }, { principalId: "owner" }),
    /opaque machine token/,
  );
  await assert.rejects(
    () => hardened.start({
      ...request("missing-digest"), target: { kind: "team", id: "support-team", revision: "team-v3" },
    }, { principalId: "owner" }),
    /target.digest/,
  );
  assert.throws(() => createAgentToolkitRuntime({
    authorize: async () => ({ allowed: true, authorizationId: "ok" }),
    evaluationLeaseMs: 5,
    operationTimeoutMs: 5,
  }), /must exceed/);

  const extreme = createHarness({
    evaluate: async (call) => evaluatorOutcome(1_000_000_000_001, call.evidence.id),
  }).runtime;
  await extreme.start(request("extreme-score", BASELINE, "extreme-cohort"), { principalId: "owner" });
  await extreme.complete({
    runId: "extreme-score", operationId: "extreme-complete", status: "completed", costLog: COST,
  }, { principalId: "owner" });
  assert.equal((await extreme.evaluate({
    runId: "extreme-score", operationId: "extreme-evaluate", evidence: evidence("extreme"),
  }, { principalId: "owner" })).reasonCode, "evaluation_failed");
});

test("fences timed-out evaluator spend with a stable idempotency key", async () => {
  let time = 20_000;
  const keys = [];
  const runtime = createHarness({
    now: () => time,
    operationTimeoutMs: 5,
    evaluationLeaseMs: 20,
    storeClaimTtlMs: 1,
    runTtlMs: 100,
    cohortTtlMs: 200,
    evaluate: async (call) => {
      keys.push(call.idempotencyKey);
      if (keys.length === 1) return new Promise(() => {});
      return evaluatorOutcome(0.8, call.evidence.id);
    },
  }).runtime;
  await runtime.start(request("timeout-run", BASELINE, "timeout-cohort"), { principalId: "owner" });
  await runtime.complete({
    runId: "timeout-run", operationId: "timeout-complete", status: "completed", costLog: COST,
  }, { principalId: "owner" });
  const evaluationRequest = {
    runId: "timeout-run", operationId: "timeout-evaluate", evidence: evidence("timeout-source"),
  };
  assert.equal((await runtime.evaluate(evaluationRequest, { principalId: "owner" })).reasonCode, "timeout");
  assert.equal((await runtime.status("timeout-run", { principalId: "owner" })).evaluation.status, "in_doubt");
  assert.equal((await runtime.evaluate(evaluationRequest, { principalId: "owner" })).reasonCode, "evaluation_busy");
  assert.equal(keys.length, 1);
  time += 21;
  assert.equal((await runtime.evaluate(evaluationRequest, { principalId: "owner" })).evaluation.status, "reported");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("instrumentation requires every ledger transition and reports no-cost observations honestly", async () => {
  const noCost = createHarness().runtime;
  const succeeded = await noCost.instrument(
    request("no-cost-run", BASELINE, "no-cost-cohort"),
    async () => ({ value: 42 }),
    { principalId: "owner" },
  );
  assert.equal(succeeded.status, "completed");
  assert.equal(succeeded.observation.completion.cost.status, "unreported");

  let racing;
  racing = createHarness().runtime;
  const raced = await racing.instrument(
    request("raced-run", BASELINE, "raced-cohort"),
    async () => {
      await racing.complete({
        runId: "raced-run",
        operationId: "concurrent-complete",
        status: "canceled",
        reasonCode: "operator_cancelled",
      }, { principalId: "owner" });
      return { value: "must-not-be-reported-as-success" };
    },
    { principalId: "owner" },
  );
  assert.equal(raced.status, "canceled");
  assert.equal(raced.observation.completion.operationId, "concurrent-complete");
  assert.equal("value" in raced, false);

  const backing = createAgentToolkitMemoryStore();
  const contended = createHarness({
    stateStore: Object.freeze({ ...backing, claim: async () => null }),
    storeClaimAttempts: 1,
  }).runtime;
  let called = false;
  const blockedResult = await contended.instrument(
    request("contended-run", BASELINE, "contended-cohort"),
    async () => { called = true; return { value: true }; },
    { principalId: "owner" },
  );
  assert.equal(blockedResult.reasonCode, "state_busy");
  assert.equal(called, false);
});

test("Agent API handlers authenticate Toolkit mutations and reject caller-owned signals", async () => {
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "toolkit-session-secret" } });
  assert.equal(app.readiness().agentToolkit.contractReady, true);
  assert.equal(app.readiness().agentToolkit.evidencePolicy.includes("metadata-only"), true);
  const unauthorized = await app.agentToolkitStart({ headers: {}, body: request("http-unauthorized") });
  assert.equal(unauthorized.statusCode, 401);
  const session = await app.authSession({ headers: {}, body: {} });
  const token = session.body.token;
  const headers = { authorization: `Bearer ${token}` };
  const started = await app.agentToolkitStart({ headers, body: request("http-run") });
  assert.equal(started.statusCode, 202);
  assert.equal(started.body.status, "running");
  const rejected = await app.agentToolkitEvaluate({
    headers,
    body: { runId: "http-run", operationId: "caller-signal", evidence: evidence("http"), signal: {} },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.reason.includes("server-owned"), true);
});
