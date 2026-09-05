import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createAgentToolkitRuntime,
} from "../../agent-api/src/agent-toolkit.js";

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
const CANDIDATE_C = Object.freeze({ id: "candidate-c", revision: "policy-v3", digest: "c".repeat(64) });

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

function createHarness({ stateStore, evaluate, authorize, telemetry, now, ...limits } = {}) {
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
    ...(telemetry ? { telemetry } : {}),
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

export {
  COST, PROFILE, BASELINE, CANDIDATE, CANDIDATE_C, request, evidence,
  evaluatorOutcome, deferred, createHarness, observedRun,
};
