// Tests for the pure collaboration-room observability helpers. ZERO I/O.

import test from "node:test";
import assert from "node:assert/strict";

import { createRoomMetrics, metricsSummary, recordRoomEvent, roomLogRecord } from "../src/collab-metrics.js";

test("createRoomMetrics starts every counter at zero", () => {
  assert.deepEqual(createRoomMetrics(), { joins: 0, opsApplied: 0, duplicates: 0, conflicts: 0, errors: 0 });
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
  for (const type of ["join", "applied", "duplicate", "conflict", "error"]) m = recordRoomEvent(m, type);
  assert.deepEqual(m, { joins: 1, opsApplied: 1, duplicates: 1, conflicts: 1, errors: 1 });
});

test("recordRoomEvent ignores unknown event types", () => {
  const m0 = createRoomMetrics();
  assert.equal(recordRoomEvent(m0, "nope"), m0);
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
