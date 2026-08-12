import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  advanceLifecycleMonitor,
  buildLifecycleMonitorObservation,
  createLifecycleMonitorCheckpoint,
  digestValue,
  LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
  LIFECYCLE_MONITOR_REQUEST_SCHEMA,
  normalizeLifecycleMonitorCheckpoint,
  normalizeLifecycleMonitorRequest,
  stopLifecycleMonitorIfBudgetExhausted,
} from "../scripts/lifecycle-monitor-contract.mjs";

const identityDigest = "a".repeat(64);

function request(overrides = {}) {
  const base = {
    schema: LIFECYCLE_MONITOR_REQUEST_SCHEMA,
    subject: { subjectId: "neutral-subject:42", identityDigest },
    target: { state: "settled", minimumGeneration: 2, minimumHeartbeatSequence: 0 },
    schedule: {
      minimumDelayMs: 100,
      maximumDelayMs: 10_000,
      multiplierPermille: 2_000,
      jitterPermille: 200,
      unchangedGrowthThreshold: 2,
      maximumClockSkewMs: 1_000,
    },
    budget: { maximumAttempts: 20, maximumElapsedMs: 60_000, maximumReadUnits: 100 },
  };
  return {
    ...base,
    ...overrides,
    subject: { ...base.subject, ...overrides.subject },
    target: { ...base.target, ...overrides.target },
    schedule: { ...base.schedule, ...overrides.schedule },
    budget: { ...base.budget, ...overrides.budget },
  };
}

function observation(overrides = {}) {
  const input = {
    schema: LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
    observedAt: "2026-08-12T00:00:00.000Z",
    subjectId: "neutral-subject:42",
    identityDigest,
    sourceRevision: "opaque-revision-1",
    generation: 1,
    heartbeatSequence: 0,
    state: "running",
    readUnits: 1,
    retryAfterMs: null,
    error: null,
    ...overrides,
  };
  delete input.observationId;
  return buildLifecycleMonitorObservation(input);
}

function initial(policy = request()) {
  return createLifecycleMonitorCheckpoint({
    request: policy,
    evaluatedAt: "2026-08-12T00:00:00.000Z",
  });
}

function advance(policy, checkpoint, observed, evaluatedAt = observed.observedAt) {
  return advanceLifecycleMonitor({
    request: policy,
    priorCheckpoint: checkpoint,
    observation: observed,
    evaluatedAt,
  });
}

test("an exact target emits one stable wake-and-revalidate signal with no authority", () => {
  const policy = request();
  const observed = observation({ state: "settled", generation: 2 });
  const ready = advance(policy, initial(policy), observed);

  assert.equal(ready.status, "ready");
  assert.equal(ready.classification, "target-observed");
  assert.equal(ready.resumeSignal.observedGeneration, 2);
  assert.equal(ready.resumeSignal.mutationAuthority, false);
  assert.equal(ready.mutationAuthority, false);
  assert.equal(ready.nextObservationAt, null);
  assert.deepEqual(advance(policy, ready, observed), ready);
  assert.deepEqual(normalizeLifecycleMonitorCheckpoint(ready, { request: policy }), ready);
});

test("the monitor grammar rejects fixed expiry and zero-cost observations", () => {
  assert.throws(() => normalizeLifecycleMonitorRequest({
    ...request(),
    expiresAt: "2026-08-13T00:00:00.000Z",
  }), /request/u);
  assert.throws(() => observation({ readUnits: 0 }), /observation read units/u);
});

test("a target snapshot before the requested heartbeat baseline remains non-ready", () => {
  const policy = request({ target: { minimumHeartbeatSequence: 5 } });
  const stale = advance(policy, initial(policy), observation({
    state: "settled",
    generation: 2,
    heartbeatSequence: 4,
  }));
  assert.equal(stale.status, "wait");
  assert.equal(stale.resumeSignal, null);

  const fresh = advance(policy, stale, observation({
    observedAt: "2026-08-12T00:00:00.100Z",
    state: "settled",
    generation: 2,
    heartbeatSequence: 5,
  }));
  assert.equal(fresh.status, "ready");
  assert.equal(fresh.resumeSignal.observedHeartbeatSequence, 5);
});

test("observation IDs are derived, idempotent, and content-bound", () => {
  const policy = request();
  const observed = observation();
  const waiting = advance(policy, initial(policy), observed);
  assert.deepEqual(advance(policy, waiting, observed), waiting);

  assert.throws(() => advance(policy, waiting, { ...observed, state: "different" }),
    /observation ID binding/u);

  const laterPoll = advance(policy, waiting, observed, "2026-08-12T00:00:00.100Z");
  assert.equal(laterPoll.classification, "unchanged");
  assert.equal(laterPoll.consumption.attempts, 2);
  assert.equal(laterPoll.consumption.readUnits, 2);
  assert.notEqual(laterPoll.checkpointDigest, waiting.checkpointDigest);
});

test("unchanged evidence backs off deterministically while progress resets the delay", () => {
  const policy = request();
  const first = advance(policy, initial(policy), observation());
  assert.equal(first.delayMs, 100);

  const secondObservation = observation({
    observationId: "observation-2",
    observedAt: "2026-08-12T00:00:00.100Z",
  });
  const second = advance(policy, first, secondObservation);
  const replayedFromSameState = advance(policy, first, secondObservation);
  assert.equal(second.classification, "unchanged");
  assert.equal(second.delayMs, replayedFromSameState.delayMs);
  assert.ok(second.delayMs >= 100 && second.delayMs <= 10_000);

  const third = advance(policy, second, observation({
    observationId: "observation-3",
    observedAt: "2026-08-12T00:00:00.300Z",
  }));
  assert.ok(third.delayMs >= 200 && third.delayMs <= 10_000);

  const progress = advance(policy, third, observation({
    observationId: "observation-4",
    observedAt: "2026-08-12T00:00:00.600Z",
    sourceRevision: "opaque-revision-2",
    heartbeatSequence: 1,
  }));
  assert.equal(progress.classification, "progress-observed");
  assert.equal(progress.consecutiveUnchanged, 0);
  assert.equal(progress.delayMs, 100);
});

test("typed transient errors back off and permanent or integrity errors block", () => {
  const policy = request();
  for (const errorClass of ["transient", "rate-limited"]) {
    const result = advance(policy, initial(policy), observation({
      error: { class: errorClass, code: "observer-unavailable" },
      retryAfterMs: 500,
    }));
    assert.equal(result.status, "wait");
    assert.ok(result.delayMs >= 500);
    assert.equal(result.mutationAuthority, false);
  }
  for (const errorClass of ["permanent", "integrity"]) {
    const result = advance(policy, initial(policy), observation({
      error: { class: errorClass, code: "observer-invalid" },
    }));
    assert.equal(result.status, "blocked");
    assert.equal(result.resumeSignal, null);
  }
});

test("identity, clock, generation, and heartbeat regressions fail closed", () => {
  const policy = request();
  const first = advance(policy, initial(policy), observation({
    generation: 2,
    heartbeatSequence: 2,
  }));
  const cases = [
    [observation({ observationId: "id-2", subjectId: "other" }), "identity-drift"],
    [observation({ observationId: "id-3", observedAt: "2026-08-11T23:59:59.000Z" }),
      "observation-clock-regression"],
    [observation({ observationId: "id-4", generation: 1, heartbeatSequence: 2 }),
      "generation-regression"],
    [observation({ observationId: "id-5", generation: 2, heartbeatSequence: 1 }),
      "heartbeat-regression"],
  ];
  for (const [observed, classification] of cases) {
    const result = advance(policy, first, observed, "2026-08-12T00:00:01.000Z");
    assert.equal(result.status, "blocked");
    assert.equal(result.classification, classification);
    assert.equal(result.mutationAuthority, false);
  }
});

test("attempt, elapsed, and read-unit budgets stop without satisfying the target", () => {
  const attemptPolicy = request({ budget: { maximumAttempts: 1 } });
  const attempt = advance(attemptPolicy, initial(attemptPolicy), observation());
  assert.equal(attempt.status, "stopped");
  assert.equal(attempt.classification, "budget-exhausted");

  const readPolicy = request({ budget: { maximumReadUnits: 1 } });
  const reads = advance(readPolicy, initial(readPolicy), observation());
  assert.equal(reads.status, "stopped");

  const elapsedPolicy = request({ budget: { maximumElapsedMs: 100 } });
  const expired = stopLifecycleMonitorIfBudgetExhausted({
    request: elapsedPolicy,
    priorCheckpoint: initial(elapsedPolicy),
    evaluatedAt: "2026-08-12T00:00:00.100Z",
  });
  assert.equal(expired.status, "stopped");
  assert.equal(expired.resumeSignal, null);
  assert.equal(expired.mutationAuthority, false);

  const noRoomPolicy = request({
    schedule: { minimumDelayMs: 200 },
    budget: { maximumElapsedMs: 100 },
  });
  const noRoom = advance(noRoomPolicy, initial(noRoomPolicy), observation());
  assert.equal(noRoom.status, "stopped");
  assert.equal(noRoom.nextObservationAt, null);

  const overshootPolicy = request({ budget: { maximumReadUnits: 1 } });
  const overshoot = advance(overshootPolicy, initial(overshootPolicy), observation({
    state: "settled",
    generation: 2,
    readUnits: 2,
  }));
  assert.equal(overshoot.status, "stopped");
  assert.equal(overshoot.resumeSignal, null);
});

test("serialized checkpoints preserve backoff, budget, and exact validation", () => {
  const policy = request();
  const waiting = advance(policy, initial(policy), observation());
  const restored = normalizeLifecycleMonitorCheckpoint(
    JSON.parse(JSON.stringify(waiting)),
    { request: policy },
  );
  assert.deepEqual(restored, waiting);
  assert.throws(() => normalizeLifecycleMonitorCheckpoint({
    ...JSON.parse(JSON.stringify(waiting)),
    mutationAuthority: true,
  }, { request: policy }), /checkpoint digest/u);
});

test("a rehashed ready checkpoint cannot forge resume-signal semantics", () => {
  const policy = request();
  const ready = advance(policy, initial(policy), observation({ state: "settled", generation: 2 }));
  const forged = JSON.parse(JSON.stringify(ready));
  const { signalKey: _signalKey, ...signalCore } = forged.resumeSignal;
  signalCore.subjectId = "forged-subject";
  signalCore.observedGeneration = 99;
  forged.resumeSignal = { ...signalCore, signalKey: digestValue(signalCore) };
  const { checkpointDigest: _checkpointDigest, ...checkpointCore } = forged;
  forged.checkpointDigest = digestValue(checkpointCore);
  assert.throws(() => normalizeLifecycleMonitorCheckpoint(forged, { request: policy }),
    /resume signal binding|resume signal request binding/u);
});

test("a rehashed wait checkpoint cannot forge its next schedule", () => {
  const policy = request();
  const waiting = advance(policy, initial(policy), observation());
  const forged = JSON.parse(JSON.stringify(waiting));
  forged.nextObservationAt = "2026-08-13T00:00:00.000Z";
  const { checkpointDigest: _checkpointDigest, ...core } = forged;
  forged.checkpointDigest = digestValue(core);
  assert.throws(() => normalizeLifecycleMonitorCheckpoint(forged, { request: policy }),
    /waiting checkpoint policy binding/u);
});

test("provider names are absent and equivalent normalized observations decide identically", () => {
  const policy = request();
  const fromAdapterA = observation();
  const fromAdapterB = JSON.parse(JSON.stringify(fromAdapterA));
  const left = advance(policy, initial(policy), fromAdapterA);
  const right = advance(policy, initial(policy), fromAdapterB);
  assert.deepEqual(left, right);
  assert.doesNotMatch(JSON.stringify({ policy, left }), /github|cloudflare|claude|codex/iu);
  for (const file of [
    "lifecycle-monitor-contract.mjs",
    "lifecycle-monitor-controller.mjs",
    "lifecycle-monitor-json-adapter.mjs",
    "lifecycle-monitor.mjs",
  ]) {
    const source = readFileSync(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /github|cloudflare|claude|codex|openai|anthropic|chatgpt|mcp/iu);
    assert.doesNotMatch(source, /cloud-collaboration/iu);
  }
});
