// Tests for the platform-neutral canvas collaboration room reducer. ZERO I/O:
// no WebSocket, no Durable Object, no network — this is the same reducer a
// future Oracle Cloud A1 Node server would reuse unmodified.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOp,
  createEmptyRoomState,
  isValidRoomId,
  serializeGraph,
  serializeSnapshot,
  validateOp,
} from "../src/collab-room.js";
import { isSecureRoomCapability, mintSessionToken, sessionCanJoinRoom, verifySessionToken } from "../agent-api/src/auth.js";
import { createAuthSessionHandler } from "../agent-api/src/handler.js";

test("isValidRoomId accepts a conservative slug and rejects everything else", () => {
  assert.equal(isValidRoomId("demo-room_1"), true);
  assert.equal(isValidRoomId(""), false);
  assert.equal(isValidRoomId("../etc/passwd"), false);
  assert.equal(isValidRoomId("has space"), false);
  assert.equal(isValidRoomId("a".repeat(200)), false);
});

test("upsertNode adds a node and bumps room rev", () => {
  const state0 = createEmptyRoomState();
  const { state, event, error } = applyOp(state0, { type: "upsertNode", node: { id: "a", label: "Concept A", x: 1, y: 2 } });
  assert.equal(error, null);
  assert.equal(event.type, "nodeUpserted");
  assert.equal(state.rev, 1);
  assert.equal(state.nodes.a.label, "Concept A");
  assert.equal(state.nodes.a.v, 1);
});

test("upsertNode on an existing node bumps its version, not just the room rev", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } }));
  const { state: state2 } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 5, y: 5 } });
  assert.equal(state2.nodes.a.v, 2);
  assert.equal(state2.nodes.a.x, 5);
});

test("deleteNode cascades to remove links touching it (mirrors web/app.js deleteSelection)", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } }));
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "b", x: 1, y: 1 } }));
  ({ state } = applyOp(state, { type: "upsertLink", link: { id: "l1", source: "a", target: "b" } }));
  const { state: state2, event } = applyOp(state, { type: "deleteNode", id: "a" });
  assert.equal(state2.nodes.a, undefined);
  assert.equal(state2.links.l1, undefined);
  assert.equal(event.type, "nodeDeleted");
});

test("deleteNode on a missing id is a no-op (no event, no error)", () => {
  const state0 = createEmptyRoomState();
  const { state, event, error } = applyOp(state0, { type: "deleteNode", id: "missing" });
  assert.equal(state, state0);
  assert.equal(event, null);
  assert.equal(error, null);
});

test("upsertLink requires id/source/target and validates before applying", () => {
  const { valid, errors } = validateOp({ type: "upsertLink", link: { id: "", source: "a", target: "b" } });
  assert.equal(valid, false);
  assert.ok(errors.length > 0);
});

test("upsertLink applies and deleteLink removes it", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertLink", link: { id: "l1", source: "a", target: "b", label: "rel" } }));
  assert.equal(state.links.l1.label, "rel");
  const { state: state2, event } = applyOp(state, { type: "deleteLink", id: "l1" });
  assert.equal(state2.links.l1, undefined);
  assert.equal(event.type, "linkDeleted");
});

test("replaceGraph rebuilds state and drops links pointing at unknown nodes", () => {
  const state0 = createEmptyRoomState();
  const { state, event } = applyOp(state0, {
    type: "replaceGraph",
    graph: {
      nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 1 }],
      links: [{ id: "l1", source: "a", target: "b" }, { id: "l2", source: "a", target: "ghost" }],
    },
  });
  assert.equal(Object.keys(state.nodes).length, 2);
  assert.equal(Object.keys(state.links).length, 1);
  assert.equal(state.links.l1 !== undefined, true);
  assert.equal(state.links.l2, undefined);
  assert.equal(event.type, "graphReplaced");
});

test("baseVersion opt-in rejects a stale upsertNode as a typed conflict without mutating state", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } })); // v=1
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 1, y: 1 } })); // v=2
  const before = state;
  const { state: after, event, error, conflict } = applyOp(state, {
    type: "upsertNode",
    node: { id: "a", x: 9, y: 9 },
    baseVersion: 1, // stale: current is 2
  });
  assert.equal(after, before, "state must not change on conflict");
  assert.equal(event, null);
  assert.ok(error.includes("version conflict"));
  assert.deepEqual(conflict, { kind: "node", id: "a", currentVersion: 2, baseVersion: 1, rev: state.rev });
});

test("baseVersion matching the current version applies normally", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } })); // v=1
  const { state: after, event, error, conflict } = applyOp(state, {
    type: "upsertNode",
    node: { id: "a", x: 7, y: 7 },
    baseVersion: 1, // fresh
  });
  assert.equal(error, null);
  assert.equal(conflict, undefined);
  assert.equal(event.type, "nodeUpserted");
  assert.equal(after.nodes.a.v, 2);
  assert.equal(after.nodes.a.x, 7);
});

test("baseVersion 0 lets a create-if-absent upsert succeed for a new node", () => {
  const state0 = createEmptyRoomState();
  const { event, error } = applyOp(state0, { type: "upsertNode", node: { id: "new", x: 0, y: 0 }, baseVersion: 0 });
  assert.equal(error, null);
  assert.equal(event.type, "nodeUpserted");
});

test("baseVersion guards deleteNode and upsertLink against stale edits", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } }));
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "b", x: 1, y: 1 } }));
  ({ state } = applyOp(state, { type: "upsertLink", link: { id: "l1", source: "a", target: "b" } })); // v=1
  ({ state } = applyOp(state, { type: "upsertLink", link: { id: "l1", source: "a", target: "b", label: "x" } })); // v=2

  const staleLink = applyOp(state, { type: "upsertLink", link: { id: "l1", source: "a", target: "b" }, baseVersion: 1 });
  assert.ok(staleLink.error.includes("version conflict"));
  assert.equal(staleLink.conflict.kind, "link");
  assert.equal(staleLink.conflict.currentVersion, 2);

  const staleDelete = applyOp(state, { type: "deleteNode", id: "a", baseVersion: 99 });
  assert.ok(staleDelete.error.includes("version conflict"));
  assert.equal(staleDelete.state, state);
});

test("omitting baseVersion preserves last-write-wins (backward compatible)", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } }));
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 1, y: 1 } }));
  const { event, error } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 2, y: 2 } });
  assert.equal(error, null);
  assert.equal(event.type, "nodeUpserted");
});

test("serializeSnapshot reports room capacity limits and current counts", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } }));
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "b", x: 1, y: 1 } }));
  ({ state } = applyOp(state, { type: "upsertLink", link: { id: "l1", source: "a", target: "b" } }));
  const snapshot = serializeSnapshot(state);
  assert.equal(snapshot.counts.nodes, 2);
  assert.equal(snapshot.counts.links, 1);
  assert.equal(snapshot.limits.maxNodes, 500);
  assert.equal(snapshot.limits.maxLinks, 1000);
});

test("validateOp rejects unknown op types without throwing", () => {
  const { valid, errors } = validateOp({ type: "notAThing" });
  assert.equal(valid, false);
  assert.ok(errors[0].includes("unknown op type"));
});

test("applyOp fails closed (no state change) on an invalid op", () => {
  const state0 = createEmptyRoomState();
  const { state, event, error } = applyOp(state0, { type: "upsertNode", node: { id: "" } });
  assert.equal(state, state0);
  assert.equal(event, null);
  assert.ok(error.includes("required"));
});

test("serializeGraph and serializeSnapshot produce deterministic, sorted output", () => {
  let state = createEmptyRoomState();
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "b", x: 0, y: 0 } }));
  ({ state } = applyOp(state, { type: "upsertNode", node: { id: "a", x: 0, y: 0 } }));
  const graph = serializeGraph(state);
  assert.deepEqual(graph.nodes.map((n) => n.id), ["a", "b"]);

  const snapshot = serializeSnapshot(state);
  assert.equal(snapshot.type, "snapshot");
  assert.equal(snapshot.rev, state.rev);
});

test("sessionCanJoinRoom: unscoped token cannot join a room", () => {
  assert.equal(sessionCanJoinRoom({ roomIds: [] }, "room-1"), false);
  assert.equal(sessionCanJoinRoom({}, "room-1"), false);
});

test("sessionCanJoinRoom: scoped token only joins its listed rooms", () => {
  assert.equal(sessionCanJoinRoom({ roomIds: ["room-1"] }, "room-1"), true);
  assert.equal(sessionCanJoinRoom({ roomIds: ["room-1"] }, "room-2"), false);
});

test("sessionCanJoinRoom rejects an empty roomId without throwing", () => {
  assert.equal(sessionCanJoinRoom({ roomIds: [] }, ""), false);
});

test("room capability requires at least 128 bits of hexadecimal entropy", () => {
  assert.equal(isSecureRoomCapability("a".repeat(32)), true);
  assert.equal(isSecureRoomCapability("victim-room"), false);
  assert.equal(isSecureRoomCapability("a".repeat(31)), false);
});

test("auth/session ignores caller subject and rejects guessable room ids", async () => {
  const secret = "test-secret";
  const handler = createAuthSessionHandler({ secret, now: 1_700_000_000_000 });
  const rejected = await handler({ body: { subject: "spoofed-admin", roomIds: ["victim-room"] } });
  assert.equal(rejected.statusCode, 400);

  const roomId = "a".repeat(32);
  const accepted = await handler({ body: { subject: "spoofed-admin", roomIds: [roomId] } });
  assert.equal(accepted.statusCode, 200);
  const verdict = verifySessionToken(accepted.body.token, secret, { now: 1_700_000_000_000 });
  assert.equal(verdict.valid, true);
  assert.notEqual(verdict.claims.sub, "spoofed-admin");
  assert.deepEqual(verdict.claims.roomIds, [roomId]);
});

test("mintSessionToken + verifySessionToken round-trips roomIds end to end", () => {
  const secret = "test-secret";
  const room1 = "a".repeat(32);
  const room2 = "b".repeat(32);
  const token = mintSessionToken({ secret, subject: "u1", roomIds: [room1, room2] });
  const verdict = verifySessionToken(token, secret);
  assert.equal(verdict.valid, true);
  assert.deepEqual(verdict.claims.roomIds, [room1, room2]);
  assert.equal(sessionCanJoinRoom(verdict.claims, room1), true);
  assert.equal(sessionCanJoinRoom(verdict.claims, "c".repeat(32)), false);
});
