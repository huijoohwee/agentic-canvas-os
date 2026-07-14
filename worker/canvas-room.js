// Cloudflare Durable Object: one instance per canvas collaboration room.
//
// Uses the WebSocket Hibernation API (`acceptWebSocket`, not `accept()`) so the
// Object wakes only for messages and lifecycle events. Account quotas and
// billing remain deployment concerns; this source makes no zero-cost claim.
//
// Authority split: this file owns ONLY the Cloudflare-specific WebSocket/DO
// plumbing (accept, hibernate, broadcast, SQLite persistence). All actual
// collaboration semantics (op validation, state reduction, snapshotting) live
// in `src/collab-room.js`, which is platform-neutral and reusable by a future
// Oracle Cloud Always Free A1 (Ampere) Node WebSocket server without change.

import { sessionCanJoinRoom, verifySessionToken } from "../agent-api/src/auth.js";
import { applyOp, createEmptyRoomState, isValidRoomId, serializeSnapshot } from "../src/collab-room.js";

const STORAGE_KEY = "room-state-v1";
const MAX_MESSAGE_BYTES = 65536; // generous bound; well under the 32 MiB DO WS limit
const MAX_RECENT_OP_IDS = 512;
const OP_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class CanvasRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.roomId = "";
    this.recentOpIds = [];
    /** @type {{nodes: object, links: object, rev: number} | null} */
    this.state = null;
    this.loaded = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get(STORAGE_KEY);
      if (stored && typeof stored === "object" && stored.graph) {
        this.state = stored.graph;
        this.recentOpIds = Array.isArray(stored.recentOpIds) ? stored.recentOpIds.slice(-MAX_RECENT_OP_IDS) : [];
      } else {
        // Backward-compatible read of the original graph-only value.
        this.state = stored && typeof stored === "object" ? stored : createEmptyRoomState();
      }
    });
  }

  async ensureLoaded() {
    await this.loaded;
    if (!this.state) this.state = createEmptyRoomState();
  }

  async persist() {
    // One bounded value keeps graph state and the idempotency window together.
    await this.ctx.storage.put(STORAGE_KEY, { graph: this.state, recentOpIds: this.recentOpIds });
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket already closed/broken; hibernation API cleans it up on its own.
    }
  }

  broadcast(payload, exclude) {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(text);
      } catch {
        // Best-effort; a broken socket will be reaped by the runtime.
      }
    }
  }

  async fetch(request) {
    await this.ensureLoaded();
    const url = new URL(request.url);
    const roomId = url.searchParams.get("room") || "";
    if (!isValidRoomId(roomId)) {
      return new Response(JSON.stringify({ error: "invalid room id" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    this.roomId = roomId;

    const secret = this.env && typeof this.env.AGENT_API_JWT_SECRET === "string" ? this.env.AGENT_API_JWT_SECRET : "";
    if (!secret) {
      return new Response(JSON.stringify({ error: "auth not configured" }), {
        status: 501,
        headers: { "content-type": "application/json" },
      });
    }

    // Browsers cannot set a custom Authorization header on a WebSocket
    // upgrade; the token travels as a query param instead (short-lived
    // session token, not a long-lived credential — see agent-api/src/auth.js).
    const token = url.searchParams.get("token") || "";
    const verdict = verifySessionToken(token, secret);
    if (!verdict.valid || !sessionCanJoinRoom(verdict.claims, roomId)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(JSON.stringify({ error: "expected websocket upgrade" }), {
        status: 426,
        headers: { "content-type": "application/json" },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API: the runtime may hibernate this Object between
    // messages without tearing down `server`'s open connection, and — the
    // whole point — does NOT bill duration while hibernated.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ subject: verdict.claims.sub || "" });

    this.send(server, serializeSnapshot(this.state));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.ensureLoaded();
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES) {
      this.send(ws, { type: "error", error: "message too large or not text" });
      return;
    }
    const op = safeJsonParse(message);
    if (!op) {
      this.send(ws, { type: "error", error: "invalid JSON" });
      return;
    }
    if (typeof op.opId !== "string" || !OP_ID_PATTERN.test(op.opId)) {
      this.send(ws, { type: "error", error: "valid opId required" });
      return;
    }
    if (this.recentOpIds.includes(op.opId)) {
      this.send(ws, { type: "ack", opType: op.type, opId: op.opId, rev: this.state.rev, duplicate: true });
      return;
    }
    const { state: nextState, event, error } = applyOp(this.state, op);
    if (error) {
      this.send(ws, { type: "error", error });
      return;
    }
    if (!event) return; // no-op (e.g. deleting an id that's already gone)

    this.state = nextState;
    this.recentOpIds = [...this.recentOpIds, op.opId].slice(-MAX_RECENT_OP_IDS);
    await this.persist();
    this.broadcast({ ...event, opId: op.opId }, ws);
    this.send(ws, { type: "ack", opType: op.type, opId: op.opId, rev: event.rev });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // No per-connection cleanup needed: room state lives in this.state /
    // storage, not on the socket. Presence (who's connected) is derivable
    // from `this.ctx.getWebSockets()` on demand if a future revision needs
    // a roster; no separate bookkeeping to leak here.
  }

  async webSocketError(ws, error) {
    // Swallow: the Hibernation API will close/reap the socket; no shared
    // state to roll back since each op is applied and persisted atomically
    // above before broadcast.
  }
}
