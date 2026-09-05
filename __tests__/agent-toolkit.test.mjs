import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentApiApp,
} from "../agent-api/src/app.js";
import {
  createAgentToolkitMemoryStore,
} from "../agent-api/src/agent-toolkit.js";
import {
  COST, BASELINE, CANDIDATE, CANDIDATE_C,
  request, evidence, evaluatorOutcome, createHarness,
  observedRun,
} from "./fixtures/agent-toolkit.mjs";

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

test("profiles bounded span latency, bottlenecks, tokens, and cost without payloads", async () => {
  let time = 3_000;
  const clock = { advance: (value) => { time += value; } };
  const { runtime } = createHarness({ now: () => time });
  await observedRun(runtime, request("profiled-run"), { durationMs: 17 }, clock);
  const profile = await runtime.profile("profiled-run", { principalId: "owner" });
  assert.equal(profile.schema, "agent-toolkit-profile/v1");
  assert.equal(profile.status, "completed");
  assert.deepEqual(profile.spanLatencyMs, { count: 1, p50: 17, p95: 17, p99: 17, max: 17 });
  assert.equal(profile.bottlenecks[0].durationMs, 17);
  assert.equal(profile.tokenUsage.promptTokens, 3);
  assert.equal(profile.tokenUsage.completionTokens, 2);
  assert.equal(profile.estimatedCostUsd, 0);
  assert.equal(JSON.stringify(profile).includes("rawPromptSentinel"), false);
});

test("optimizes exact evaluated candidates across quality, latency, and cost without applying", async () => {
  let time = 3_500;
  const clock = { advance: (value) => { time += value; } };
  const { runtime } = createHarness({
    now: () => time,
    evaluate: async (call) => evaluatorOutcome({
      baseline: 0.7,
      candidate: 0.93,
      "candidate-c": 0.86,
    }[call.candidate.id], call.evidence.id),
  });
  for (const [prefix, candidate, durationMs] of [
    ["base", BASELINE, 20],
    ["candidate", CANDIDATE, 18],
    ["candidate-c", CANDIDATE_C, 12],
  ]) {
    await observedRun(runtime, request(`${prefix}-one`, candidate, "optimization-cohort"), { durationMs }, clock);
    await observedRun(runtime, request(`${prefix}-two`, candidate, "optimization-cohort"), { durationMs }, clock);
  }
  const optimized = await runtime.optimize({
    cohortId: "optimization-cohort",
    baseline: BASELINE,
    candidates: [CANDIDATE_C, CANDIDATE],
    policy: {
      minSamples: 2,
      qualityBoundary: 0.8,
      minimumQualityImprovement: 0.1,
      maxLatencyRegressionRatio: 1,
      maxCostRegressionRatio: 1,
    },
  }, { principalId: "owner" });
  assert.equal(optimized.status, "completed");
  assert.equal(optimized.recommendation, "propose");
  assert.deepEqual(optimized.selected.candidate, CANDIDATE);
  assert.equal(optimized.reviewRequired, true);
  assert.equal(optimized.applied, false);
  assert.equal("apply" in runtime, false);
});

test("enforces durable per-principal request, run, and cohort quotas", async () => {
  const rateLimited = createHarness({
    requestWindowMs: 1_000,
    maxRequestsPerWindow: 2,
  }).runtime;
  await rateLimited.start(request("rate-run", BASELINE, "rate-cohort"), { principalId: "rate-owner" });
  await rateLimited.status("rate-run", { principalId: "rate-owner" });
  const limited = await rateLimited.status("rate-run", { principalId: "rate-owner" });
  assert.equal(limited.reasonCode, "rate_limited");
  assert.equal(limited.retryAfterMs > 0, true);

  const runLimited = createHarness({ maxPrincipalRuns: 1 }).runtime;
  await runLimited.start(request("run-one", BASELINE, "one-cohort"), { principalId: "run-owner" });
  assert.equal((await runLimited.start(
    request("run-two", BASELINE, "one-cohort"),
    { principalId: "run-owner" },
  )).reasonCode, "run_quota_exceeded");

  const cohortLimited = createHarness({ maxPrincipalRuns: 2, maxPrincipalCohorts: 1 }).runtime;
  await cohortLimited.start(request("cohort-one", BASELINE, "cohort-one"), { principalId: "cohort-owner" });
  assert.equal((await cohortLimited.start(
    request("cohort-two", BASELINE, "cohort-two"),
    { principalId: "cohort-owner" },
  )).reasonCode, "cohort_quota_exceeded");

  const sharedStore = createAgentToolkitMemoryStore();
  const first = createHarness({
    stateStore: sharedStore,
    maxRequestsPerWindow: 1,
  }).runtime;
  const second = createHarness({
    stateStore: sharedStore,
    maxRequestsPerWindow: 1,
  }).runtime;
  await first.start(request("shared-admission"), { principalId: "shared-admission-owner" });
  assert.equal((await second.status(
    "shared-admission",
    { principalId: "shared-admission-owner" },
  )).reasonCode, "rate_limited");

  const principalLimited = createHarness({
    principalShardCount: 1,
    maxPrincipalsPerShard: 1,
  }).runtime;
  await principalLimited.start(request("principal-one"), { principalId: "principal-one" });
  assert.equal((await principalLimited.start(
    request("principal-two"),
    { principalId: "principal-two" },
  )).reasonCode, "principal_quota_exceeded");
});

test("exports only bounded structured telemetry and ignores exporter failure", async () => {
  const events = [];
  const { runtime } = createHarness({ telemetry: async (event) => events.push(event) });
  await runtime.start(request("telemetry-run"), { principalId: "telemetry-owner" });
  assert.equal(events.length, 1);
  assert.equal(events[0].schema, "agent-toolkit-telemetry/v1");
  assert.equal(events[0].action, "start");
  assert.equal(events[0].status, "running");
  assert.equal(typeof events[0].principalDigest, "string");
  assert.equal(JSON.stringify(events[0]).includes("telemetry-owner"), false);
  assert.equal(JSON.stringify(events[0]).includes("support-team"), false);

  const failing = createHarness({ telemetry: async () => { throw new Error("export failed"); } }).runtime;
  assert.equal((await failing.start(request("telemetry-failure"), {
    principalId: "telemetry-owner",
  })).status, "running");
});

test("reports production readiness only with every application-owned runtime seam", () => {
  const backing = createAgentToolkitMemoryStore();
  const durableStore = Object.freeze({
    ...backing,
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      horizontalRecovery: true,
      owner: "agent-toolkit",
    }),
  });
  const app = createAgentApiApp({
    env: { AGENT_API_JWT_SECRET: "production-contract-secret" },
    agentToolkitStore: durableStore,
    agentToolkitAuthorize: async () => ({ allowed: true, authorizationId: "revision-verified" }),
    agentToolkitEvaluate: async (call) => evaluatorOutcome(0.8, call.evidence.id),
    agentToolkitTelemetry: async () => {},
  });
  assert.equal(app.readiness().agentToolkit.productionReady, true);
  assert.equal(app.readiness().agentToolkit.revisionAuthorizerConfigured, true);
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
