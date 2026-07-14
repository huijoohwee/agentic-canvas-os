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
