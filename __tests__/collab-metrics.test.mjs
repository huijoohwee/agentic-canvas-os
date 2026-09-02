// Tests for the pure collaboration-room observability helpers. ZERO I/O.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createRoomMetrics,
  metricsSummary,
  normalizeRoomMetrics,
  recordRoomEvent,
  recordRoomFanOut,
  recordRoomObservabilityFailure,
  roomLogRecord,
} from "../src/collab-metrics.js";

test("createRoomMetrics starts every counter at zero", () => {
  assert.deepEqual(createRoomMetrics(), {
    joins: 0,
    opsApplied: 0,
    duplicates: 0,
    conflicts: 0,
    errors: 0,
    socketErrors: 0,
    fanOutOperations: 0,
    fanOutRecipientsAttempted: 0,
    fanOutRecipientsDispatched: 0,
    fanOutRecipientsSucceeded: 0,
    fanOutRecipientsFailed: 0,
    fanOutRecipientsTimedOut: 0,
    fanOutRecipientsCanceled: 0,
    fanOutCanceledBeforeDispatch: 0,
    fanOutSetupFailures: 0,
    fanOutPartial: 0,
    fanOutExhausted: 0,
    fanOutAuditPersistFailures: 0,
    observabilityFailures: 0,
  });
});

test("recordRoomEvent increments the mapped counter immutably", () => {
  const m0 = createRoomMetrics();
  const m1 = recordRoomEvent(m0, "join");
  assert.equal(m0.joins, 0, "input is not mutated");
  assert.equal(m1.joins, 1);
  const m2 = recordRoomEvent(recordRoomEvent(m1, "applied"), "applied");
  assert.equal(m2.opsApplied, 2);
});

test("recordRoomEvent maps each event type to its counter", () => {
  let m = createRoomMetrics();
  for (const type of ["join", "applied", "duplicate", "conflict", "error", "socketError"]) {
    m = recordRoomEvent(m, type);
  }
  assert.deepEqual(m, {
    joins: 1,
    opsApplied: 1,
    duplicates: 1,
    conflicts: 1,
    errors: 1,
    socketErrors: 1,
    fanOutOperations: 0,
    fanOutRecipientsAttempted: 0,
    fanOutRecipientsDispatched: 0,
    fanOutRecipientsSucceeded: 0,
    fanOutRecipientsFailed: 0,
    fanOutRecipientsTimedOut: 0,
    fanOutRecipientsCanceled: 0,
    fanOutCanceledBeforeDispatch: 0,
    fanOutSetupFailures: 0,
    fanOutPartial: 0,
    fanOutExhausted: 0,
    fanOutAuditPersistFailures: 0,
    observabilityFailures: 0,
  });
});

test("recordRoomEvent makes unknown event types visible without throwing", () => {
  const m0 = createRoomMetrics();
  const m1 = recordRoomEvent(m0, "nope");
  assert.equal(m1.observabilityFailures, 1);
  assert.equal(m0.observabilityFailures, 0);
});

test("recordRoomFanOut tracks partial and exhausted delivery without changing operation errors", () => {
  const initial = createRoomMetrics();
  const partial = recordRoomFanOut(initial, { attempted: 3, succeeded: 2, failed: 1 });
  const exhausted = recordRoomFanOut(partial, {
    attempted: 2,
    succeeded: 0,
    failed: 2,
    timedOut: 1,
    canceled: 1,
  });
  const unavailable = recordRoomFanOut(exhausted, {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    setupFailures: 1,
  });

  assert.equal(initial.fanOutOperations, 0, "input is not mutated");
  assert.equal(unavailable.fanOutOperations, 3);
  assert.equal(unavailable.fanOutRecipientsAttempted, 5);
  assert.equal(unavailable.fanOutRecipientsDispatched, 5);
  assert.equal(unavailable.fanOutRecipientsSucceeded, 2);
  assert.equal(unavailable.fanOutRecipientsFailed, 3);
  assert.equal(unavailable.fanOutRecipientsTimedOut, 1);
  assert.equal(unavailable.fanOutRecipientsCanceled, 1);
  assert.equal(unavailable.fanOutSetupFailures, 1);
  assert.equal(unavailable.fanOutPartial, 1);
  assert.equal(unavailable.fanOutExhausted, 2);
  assert.equal(unavailable.errors, 0, "delivery degradation is separate from reducer errors");
  const invalid = recordRoomFanOut(unavailable, { attempted: 2, succeeded: 2, failed: 1 });
  assert.equal(invalid.observabilityFailures, 1, "invalid summaries cannot disappear silently");
  assert.equal(invalid.fanOutOperations, unavailable.fanOutOperations);

  const overlapping = recordRoomFanOut(unavailable, {
    attempted: 2,
    dispatched: 2,
    canceledBeforeDispatch: 1,
    succeeded: 1,
    failed: 1,
    canceled: 1,
  });
  assert.equal(overlapping.observabilityFailures, 1);
  assert.equal(overlapping.fanOutOperations, unavailable.fanOutOperations);
});

test("restores durable counters defensively and counts malformed known fields", () => {
  const restored = normalizeRoomMetrics({
    joins: 4,
    fanOutRecipientsFailed: 2,
    fanOutPartial: "secret-shaped-but-invalid",
    futureCounter: 99,
  });
  assert.equal(restored.joins, 4);
  assert.equal(restored.fanOutRecipientsFailed, 2);
  assert.equal(restored.fanOutPartial, 0);
  assert.equal(restored.observabilityFailures, 1);
  assert.equal(Object.hasOwn(restored, "futureCounter"), false);
});

test("audit persistence failures have explicit non-blocking counters", () => {
  const initial = createRoomMetrics();
  const failed = recordRoomObservabilityFailure(initial, { auditPersistence: true });
  assert.equal(failed.observabilityFailures, 1);
  assert.equal(failed.fanOutAuditPersistFailures, 1);
  assert.equal(initial.observabilityFailures, 0);
});

test("roomLogRecord builds a structured record with an injected timestamp", () => {
  const record = roomLogRecord({
    room: "room-1",
    event: "op_conflict",
    level: "warn",
    now: 1_700_000_000_000,
    fields: { opType: "upsertNode", id: "n1" },
  });
  assert.deepEqual(record, {
    ts: "2023-11-14T22:13:20.000Z",
    level: "warn",
    room: "room-1",
    event: "op_conflict",
    opType: "upsertNode",
    id: "n1",
  });
});

test("roomLogRecord defaults level to info and is JSON-serializable", () => {
  const record = roomLogRecord({ room: "r", event: "join", now: 0 });
  assert.equal(record.level, "info");
  assert.equal(typeof JSON.stringify(record), "string");
});

test("metricsSummary attaches room and live connection count to the counters", () => {
  let m = createRoomMetrics();
  m = recordRoomEvent(m, "join");
  m = recordRoomEvent(m, "conflict");
  const summary = metricsSummary(m, { room: "room-1", connections: 3 });
  assert.equal(summary.event, "metrics");
  assert.equal(summary.room, "room-1");
  assert.equal(summary.connections, 3);
  assert.equal(summary.joins, 1);
  assert.equal(summary.conflicts, 1);
});
