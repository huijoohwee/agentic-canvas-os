import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLifecycleMonitorObservation,
  LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
  LIFECYCLE_MONITOR_REQUEST_SCHEMA,
} from "../scripts/lifecycle-monitor-contract.mjs";
import { monitorLifecycle } from "../scripts/lifecycle-monitor-controller.mjs";

const identityDigest = "b".repeat(64);

function request(overrides = {}) {
  const base = {
    schema: LIFECYCLE_MONITOR_REQUEST_SCHEMA,
    subject: { subjectId: "subject:controller", identityDigest },
    target: { state: "ready", minimumGeneration: 2, minimumHeartbeatSequence: 2 },
    schedule: {
      minimumDelayMs: 10,
      maximumDelayMs: 1_000,
      multiplierPermille: 2_000,
      jitterPermille: 0,
      unchangedGrowthThreshold: 1,
      maximumClockSkewMs: 1_000,
    },
    budget: { maximumAttempts: 5, maximumElapsedMs: 10_000, maximumReadUnits: 10 },
  };
  return {
    ...base,
    ...overrides,
    budget: { ...base.budget, ...overrides.budget },
  };
}

function observation(index, observedAt, overrides = {}) {
  return buildLifecycleMonitorObservation({
    schema: LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
    observedAt,
    subjectId: "subject:controller",
    identityDigest,
    sourceRevision: `revision-${index}`,
    generation: index,
    heartbeatSequence: index,
    state: index >= 2 ? "ready" : "running",
    readUnits: 1,
    retryAfterMs: null,
    error: null,
    ...overrides,
  });
}

test("the controller reads sequentially, adapts its wait, and returns exact target evidence", async () => {
  let clock = Date.parse("2026-08-12T00:00:00.000Z");
  let reads = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  const waits = [];
  const checkpoints = [];

  const result = await monitorLifecycle({
    request: request(),
    now: () => new Date(clock),
    wait: async milliseconds => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    readObservation: async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      reads += 1;
      const value = observation(reads, new Date(clock).toISOString());
      inFlight -= 1;
      return value;
    },
    onCheckpoint: checkpoint => checkpoints.push(checkpoint.status),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.classification, "target-observed");
  assert.equal(result.mutationAuthority, false);
  assert.equal(result.resumeSignal.mutationAuthority, false);
  assert.equal(reads, 2);
  assert.equal(maximumInFlight, 1);
  assert.deepEqual(waits, [10]);
  assert.deepEqual(checkpoints, ["wait", "ready"]);
  assert.match(result.resultDigest, /^[0-9a-f]{64}$/u);
});

test("pre-cancelled monitoring stops without reading", async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const result = await monitorLifecycle({
    request: request(),
    signal: controller.signal,
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    readObservation: async () => {
      reads += 1;
      return observation(1, "2026-08-12T00:00:00.000Z");
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.classification, "cancelled");
  assert.equal(result.mutationAuthority, false);
  assert.equal(reads, 0);
});

test("cancellation between the loop guard and read budget cannot emit ready", async () => {
  const controller = new AbortController();
  let clockReads = 0;
  let reads = 0;
  const result = await monitorLifecycle({
    request: request(),
    signal: controller.signal,
    now: () => {
      clockReads += 1;
      if (clockReads === 5) controller.abort();
      return new Date("2026-08-12T00:00:00.000Z");
    },
    readObservation: async () => {
      reads += 1;
      return observation(2, "2026-08-12T00:00:00.000Z");
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.classification, "cancelled");
  assert.equal(result.resumeSignal, null);
  assert.equal(result.mutationAuthority, false);
  assert.equal(reads, 0);
});

test("observer and scheduler failures block without becoming authority", async () => {
  const observerFailure = await monitorLifecycle({
    request: request(),
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    readObservation: async () => { throw new Error("offline"); },
  });
  assert.equal(observerFailure.status, "blocked");
  assert.equal(observerFailure.classification, "observer-failed");
  assert.equal(observerFailure.resumeSignal, null);

  let clock = Date.parse("2026-08-12T00:00:00.000Z");
  let reads = 0;
  const schedulerFailure = await monitorLifecycle({
    request: request(),
    now: () => new Date(clock),
    readObservation: async () => {
      reads += 1;
      return observation(reads, new Date(clock).toISOString(), {
        sourceRevision: "unchanged",
        generation: 1,
        heartbeatSequence: 1,
        state: "running",
      });
    },
    wait: async () => { throw new Error("scheduler unavailable"); },
  });
  assert.equal(schedulerFailure.status, "blocked");
  assert.equal(schedulerFailure.classification, "scheduler-failed");
  assert.equal(schedulerFailure.mutationAuthority, false);
  assert.equal(reads, 1);
});

test("budget exhaustion prevents another observer call", async () => {
  let reads = 0;
  const result = await monitorLifecycle({
    request: request({ budget: { maximumAttempts: 1 } }),
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    readObservation: async () => {
      reads += 1;
      return observation(1, "2026-08-12T00:00:00.000Z");
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.classification, "budget-exhausted");
  assert.equal(result.resumeSignal, null);
  assert.equal(result.mutationAuthority, false);
  assert.equal(reads, 1);
});

test("repeated identical evidence consumes budget and cannot enter a zero-delay loop", async () => {
  let clock = Date.parse("2026-08-12T00:00:00.000Z");
  let reads = 0;
  const waits = [];
  const fixed = observation(1, new Date(clock).toISOString(), {
    sourceRevision: "unchanged",
    generation: 1,
    heartbeatSequence: 1,
    state: "running",
  });
  const result = await monitorLifecycle({
    request: request({ budget: { maximumAttempts: 3, maximumReadUnits: 3 } }),
    now: () => new Date(clock),
    wait: async milliseconds => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    readObservation: async () => {
      reads += 1;
      if (reads > 3) throw new Error("busy-loop tripwire");
      return fixed;
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.classification, "budget-exhausted");
  assert.equal(result.checkpoint.consumption.attempts, 3);
  assert.equal(result.checkpoint.consumption.readUnits, 3);
  assert.equal(reads, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("elapsed budget aborts a cooperative hung observer", async () => {
  const started = Date.now();
  const result = await monitorLifecycle({
    request: request({ budget: { maximumElapsedMs: 25 } }),
    readObservation: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.classification, "budget-exhausted");
  assert.equal(result.resumeSignal, null);
  assert.ok(Date.now() - started < 1_000);
});

test("elapsed budget rejects a late target from an adapter that ignores cancellation", async () => {
  const result = await monitorLifecycle({
    request: request({ budget: { maximumElapsedMs: 10 } }),
    readObservation: async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      return observation(2, new Date().toISOString());
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.classification, "budget-exhausted");
  assert.equal(result.resumeSignal, null);
});
