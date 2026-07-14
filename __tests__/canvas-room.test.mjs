// Integration tests for the CanvasRoom Durable Object.
//
// This repo uses `node --test` (no Miniflare), and the test runner isolates
// each file in its own process, so we stub the two Workers-runtime globals the
// DO touches (`WebSocketPair`, `Response`) here without affecting other files.
// Everything else (auth, reducer, catch-up, presence) is the real code path.

import test from "node:test";
import assert from "node:assert/strict";

import { CanvasRoom } from "../worker/canvas-room.js";
import { mintSessionToken } from "../agent-api/src/auth.js";

const SECRET = "integration-test-secret";
const ROOM_ID = "a".repeat(32); // satisfies isSecureRoomCapability (>=128 bits hex)

// --- Workers-runtime global stubs -------------------------------------------

class FakeWebSocket {
  constructor() {
    this.sent = [];
    this.attachment = null;
    this.closed = false;
  }
  send(text) {
    if (this.closed) throw new Error("socket closed");
    this.sent.push(JSON.parse(text));
  }
  serializeAttachment(value) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  messagesOfType(type) {
    return this.sent.filter((m) => m && m.type === type);
  }
}

globalThis.WebSocketPair = function WebSocketPairStub() {
  return { 0: new FakeWebSocket(), 1: new FakeWebSocket() };
};

globalThis.Response = class ResponseStub {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket ?? null;
  }
};

// Capture (and silence) the DO's structured `console` logs so we can assert on
// them and keep the test output clean. Isolated to this test process.
const logLines = [];
for (const method of ["log", "warn", "error"]) {
  console[method] = (...args) => logLines.push(args.map(String).join(" "));
}
function parsedLogs() {
  return logLines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// --- Fake Durable Object context --------------------------------------------

class FakeDurableObjectCtx {
  constructor() {
    this.store = new Map();
    this.sockets = [];
    this.storage = {
      get: async (key) => this.store.get(key),
      put: async (key, value) => {
        this.store.set(key, value);
      },
      delete: async (key) => {
        this.store.delete(key);
      },
      setAlarm: async (value) => {
        this.alarmAt = value;
      },
    };
  }
  blockConcurrencyWhile(fn) {
    return fn();
  }
  acceptWebSocket(ws) {
    this.sockets.push(ws);
  }
  getWebSockets() {
    return this.sockets.slice();
  }
}

function makeRoom() {
  const ctx = new FakeDurableObjectCtx();
  const room = new CanvasRoom(ctx, { AGENT_API_JWT_SECRET: SECRET });
  return { room, ctx };
}

function joinRequest({ subject, since } = {}) {
  const token = mintSessionToken({ secret: SECRET, subject: subject || "op", roomIds: [ROOM_ID] });
  const params = new URLSearchParams({ room: ROOM_ID, token });
  if (since !== undefined) params.set("since", String(since));
  return {
    url: `https://worker.example/api/canvas/room?${params.toString()}`,
    headers: { get: (name) => (name.toLowerCase() === "upgrade" ? "websocket" : null) },
  };
}

async function connect(room, ctx, opts) {
  await room.fetch(joinRequest(opts));
  return ctx.sockets[ctx.sockets.length - 1];
}

function upsert(id, extra = {}) {
  return JSON.stringify({ type: "upsertNode", opId: `op-${id}-000000000000`, node: { id, x: 0, y: 0 }, ...extra });
}

// --- Tests ------------------------------------------------------------------

test("rejects a websocket join with no auth secret configured", async () => {
  const ctx = new FakeDurableObjectCtx();
  const room = new CanvasRoom(ctx, {}); // no AGENT_API_JWT_SECRET
  const res = await room.fetch(joinRequest());
  assert.equal(res.status, 501);
});

test("rejects a join carrying a token for a different room", async () => {
  const { room } = makeRoom();
  const foreignToken = mintSessionToken({ secret: SECRET, subject: "op", roomIds: ["b".repeat(32)] });
  const params = new URLSearchParams({ room: ROOM_ID, token: foreignToken });
  const res = await room.fetch({
    url: `https://worker.example/api/canvas/room?${params.toString()}`,
    headers: { get: (n) => (n.toLowerCase() === "upgrade" ? "websocket" : null) },
  });
  assert.equal(res.status, 401);
});

test("a fresh join receives a full snapshot with capacity metadata", async () => {
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "op" });
  const snapshot = ws.sent[0];
  assert.equal(snapshot.type, "snapshot");
  assert.equal(snapshot.rev, 0);
  assert.equal(snapshot.limits.maxNodes, 500);
  assert.deepEqual(snapshot.counts, { nodes: 0, links: 0 });
});

test("an applied op is acked to the sender and broadcast to peers", async () => {
  const { room, ctx } = makeRoom();
  const a = await connect(room, ctx, { subject: "op-a" });
  const b = await connect(room, ctx, { subject: "op-b" });

  await room.webSocketMessage(a, upsert("n1"));

  const ack = a.messagesOfType("ack").at(-1);
  assert.equal(ack.opId, "op-n1-000000000000");
  assert.equal(ack.rev, 1);

  const broadcast = b.messagesOfType("nodeUpserted").at(-1);
  assert.equal(broadcast.node.id, "n1");
  assert.equal(broadcast.opId, "op-n1-000000000000");
});

test("a duplicate opId is acknowledged as a no-op replay, not applied twice", async () => {
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "op" });
  await room.webSocketMessage(ws, upsert("n1"));
  await room.webSocketMessage(ws, upsert("n1")); // same opId
  const acks = ws.messagesOfType("ack");
  assert.equal(acks.at(-1).duplicate, true);
  assert.equal(room.state.rev, 1, "state advanced only once");
});

test("reconnecting with ?since replays only the missed ops", async () => {
  const { room, ctx } = makeRoom();
  const a = await connect(room, ctx, { subject: "op-a" });
  await room.webSocketMessage(a, upsert("n1")); // rev 1
  await room.webSocketMessage(a, upsert("n2")); // rev 2

  const b = await connect(room, ctx, { subject: "op-b", since: 1 });
  const first = b.sent[0];
  assert.equal(first.type, "catchup");
  assert.equal(first.complete, true);
  assert.deepEqual(first.events.map((e) => e.node.id), ["n2"]);
});

test("reconnecting with an un-resumable ?since falls back to a snapshot", async () => {
  const { room, ctx } = makeRoom();
  const a = await connect(room, ctx, { subject: "op-a" });
  await room.webSocketMessage(a, upsert("n1"));

  const b = await connect(room, ctx, { subject: "op-b", since: 99 }); // ahead of room
  assert.equal(b.sent[0].type, "snapshot");
});

test("presence is broadcast and reflects multi-connection counts", async () => {
  const { room, ctx } = makeRoom();
  const a = await connect(room, ctx, { subject: "katrina" });
  await connect(room, ctx, { subject: "katrina" }); // same operator, 2nd device

  const presence = a.messagesOfType("presence").at(-1);
  assert.equal(presence.connections, 2);
  assert.deepEqual(presence.members, [{ subject: "katrina", connections: 2 }]);
});

test("presence updates when a socket closes", async () => {
  const { room, ctx } = makeRoom();
  const a = await connect(room, ctx, { subject: "op-a" });
  const b = await connect(room, ctx, { subject: "op-b" });

  // Simulate the runtime dropping b's connection.
  ctx.sockets = ctx.sockets.filter((s) => s !== b);
  await room.webSocketClose(b, 1000, "", true);

  const presence = a.messagesOfType("presence").at(-1);
  assert.equal(presence.connections, 1);
  assert.deepEqual(presence.members, [{ subject: "op-a", connections: 1 }]);
});

test("a join emits a structured join log with subject, init mode, and live connections", async () => {
  logLines.length = 0;
  const { room, ctx } = makeRoom();
  await connect(room, ctx, { subject: "op-log" });
  const join = parsedLogs().find((r) => r.event === "join");
  assert.ok(join, "a join log record was emitted");
  assert.equal(join.level, "info");
  assert.equal(join.subject, "op-log");
  assert.equal(join.init, "snapshot");
  assert.equal(join.connections, 1);
  assert.match(join.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("a conflict emits a warn-level op_conflict log", async () => {
  logLines.length = 0;
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "op" });
  await room.webSocketMessage(ws, upsert("n1"));
  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: "upsertNode", opId: "op-n1-stale000000000", node: { id: "n1", x: 9, y: 9 }, baseVersion: 0 }),
  );
  const conflict = parsedLogs().find((r) => r.event === "op_conflict");
  assert.ok(conflict, "a conflict log record was emitted");
  assert.equal(conflict.level, "warn");
  assert.equal(conflict.kind, "node");
  assert.equal(conflict.id, "n1");
});

test("closing a socket emits leave and a metrics summary log", async () => {
  logLines.length = 0;
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "op" });
  await room.webSocketMessage(ws, upsert("n1")); // opsApplied 1
  ctx.sockets = ctx.sockets.filter((s) => s !== ws);
  await room.webSocketClose(ws, 1000, "", true);

  const logs = parsedLogs();
  assert.ok(logs.find((r) => r.event === "leave"), "a leave log was emitted");
  const metrics = logs.find((r) => r.event === "metrics");
  assert.ok(metrics, "a metrics summary was emitted");
  assert.equal(metrics.joins, 1);
  assert.equal(metrics.opsApplied, 1);
  assert.equal(metrics.connections, 0);
});

test("a stale baseVersion edit is rejected with a typed conflict carrying the current entity", async () => {
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "op" });
  await room.webSocketMessage(ws, upsert("n1")); // v=1
  await room.webSocketMessage(ws, upsert("n1", { opId: "op-n1-second00000000" })); // v=2

  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: "upsertNode", opId: "op-n1-stale000000000", node: { id: "n1", x: 9, y: 9 }, baseVersion: 1 }),
  );

  const conflict = ws.messagesOfType("conflict").at(-1);
  assert.equal(conflict.kind, "node");
  assert.equal(conflict.id, "n1");
  assert.equal(conflict.currentVersion, 2);
  assert.equal(conflict.baseVersion, 1);
  assert.equal(conflict.current.v, 2, "current entity is returned so the client can rebase");
  assert.equal(room.state.rev, 2, "conflicting op did not mutate state");
});

test("structured room logs summarize joins, applied ops, duplicates, conflicts, and live connections", async () => {
  logLines.length = 0;
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "observer" });
  await room.webSocketMessage(ws, upsert("n1"));
  await room.webSocketMessage(ws, upsert("n1"));
  await room.webSocketMessage(ws, upsert("n1", { opId: "op-n1-second00000000" }));
  await room.webSocketMessage(
    ws,
    JSON.stringify({ type: "upsertNode", opId: "op-n1-stale000000000", node: { id: "n1", x: 9, y: 9 }, baseVersion: 1 }),
  );

  ctx.sockets = [];
  await room.webSocketClose(ws, 1000, "", true);

  const logs = parsedLogs();
  const join = logs.find((entry) => entry.event === "join");
  assert.equal(join.subject, "observer");
  assert.equal(join.connections, 1);

  const conflict = logs.find((entry) => entry.event === "op_conflict");
  assert.equal(conflict.level, "warn");
  assert.equal(conflict.id, "n1");
  assert.equal(conflict.currentVersion, 2);

  const summary = logs.find((entry) => entry.event === "metrics");
  assert.deepEqual(
    {
      connections: summary.connections,
      joins: summary.joins,
      opsApplied: summary.opsApplied,
      duplicates: summary.duplicates,
      conflicts: summary.conflicts,
      errors: summary.errors,
    },
    { connections: 0, joins: 1, opsApplied: 2, duplicates: 1, conflicts: 1, errors: 0 },
  );
});

test("room alarms preserve live rooms and delete expired disconnected state", async () => {
  const { room, ctx } = makeRoom();
  const ws = await connect(room, ctx, { subject: "observer" });
  assert.equal(ctx.store.has("room-state-v1"), true);
  assert.equal(Number.isFinite(ctx.alarmAt), true);

  room.lastActivityAt = 0;
  await room.alarm();
  assert.equal(ctx.store.has("room-state-v1"), true, "a live connection prevents collection");

  ctx.sockets = ctx.sockets.filter((socket) => socket !== ws);
  room.lastActivityAt = 0;
  await room.alarm();
  assert.equal(ctx.store.has("room-state-v1"), false);
  assert.deepEqual(room.state, { nodes: {}, links: {}, rev: 0 });
  assert.equal(parsedLogs().some((entry) => entry.event === "room_expired"), true);
});
