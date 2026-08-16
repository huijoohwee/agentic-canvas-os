// Cloudflare Durable Object: one instance per canvas collaboration room.
//
// Uses the WebSocket Hibernation API (`acceptWebSocket`, not `accept()`) so the
// Object wakes only for messages and lifecycle events. Account quotas and
// billing remain deployment concerns; this source makes no zero-cost claim.
//
// Authority split: this file owns ONLY the Cloudflare-specific WebSocket/DO
// plumbing (accept, hibernate, broadcast, and key-value storage persistence via
// ctx.storage.put of one bounded room value). All actual
// collaboration semantics (op validation, state reduction, snapshotting) live
// in `src/collab-room.js`, which is platform-neutral and reusable by a future
// Oracle Cloud Always Free A1 (Ampere) Node WebSocket server without change.

import { createHash } from "node:crypto";
import { sessionCanJoinRoom, verifySessionToken } from "../agent-api/src/auth.js";
import {
  appendEventLog,
  applyOp,
  catchupSince,
  createEmptyRoomState,
  isValidRoomId,
  roomIsExpired,
  rosterFromAttachments,
  serializeSnapshot,
} from "../src/collab-room.js";
import {
  createRoomMetrics,
  metricsSummary,
  normalizeRoomMetrics,
  recordRoomEvent,
  recordRoomFanOut,
  recordRoomObservabilityFailure,
  roomLogRecord,
} from "../src/collab-metrics.js";
import {
  failSoftBranchFailure,
  failSoftFanOut,
  fanOutUnavailableResult,
} from "../src/fail-soft-fan-out.js";

const STORAGE_KEY = "room-state-v1";
const FAN_OUT_AUDIT_KEY = "room-fanout-audit-v1";
const MAX_MESSAGE_BYTES = 65536; // generous bound; well under the 32 MiB DO WS limit
const MAX_RECENT_OP_IDS = 512;
// Garbage-collect a room after this much idle time with no live connections.
const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OP_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function roomCorrelationId(roomId) {
  if (typeof roomId !== "string" || !roomId) return "";
  return `room_${createHash("sha256").update(roomId).digest("hex").slice(0, 24)}`;
}

export class CanvasRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.roomId = "";
    this.roomLogId = "";
    this.persisted = false;
    this.scheduledAlarmAt = undefined;
    this.recentOpIds = [];
    // In-memory only. After hibernation eviction a reconnect safely falls back
    // to a full snapshot because this bounded replay window starts empty.
    this.eventLog = [];
    // Cumulative counters are restored from storage; degraded delivery writes
    // them again so hibernation cannot erase the failure evidence.
    this.metrics = createRoomMetrics();
    this.lastActivityAt = Date.now();
    /** @type {{nodes: object, links: object, rev: number} | null} */
    this.state = null;
    this.loaded = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get(STORAGE_KEY);
      this.persisted = stored !== undefined && stored !== null;
      const storedAudit = await this.ctx.storage.get(FAN_OUT_AUDIT_KEY);
      this.metrics = normalizeRoomMetrics(storedAudit?.cumulative);
      if (stored && typeof stored === "object" && stored.graph) {
        this.state = stored.graph;
        this.recentOpIds = Array.isArray(stored.recentOpIds) ? stored.recentOpIds.slice(-MAX_RECENT_OP_IDS) : [];
        this.lastActivityAt = Number.isFinite(stored.lastActivityAt) ? stored.lastActivityAt : Date.now();
        this.roomLogId = typeof stored.roomLogId === "string"
          ? stored.roomLogId
          : roomCorrelationId(typeof stored.roomId === "string" ? stored.roomId : "");
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

  async persist({ touch = true } = {}) {
    if (touch) this.lastActivityAt = Date.now();
    // One bounded value keeps graph state and the idempotency window together.
    await this.ctx.storage.put(STORAGE_KEY, {
      graph: this.state,
      recentOpIds: this.recentOpIds,
      lastActivityAt: this.lastActivityAt,
      roomLogId: this.roomLogId,
    });
    this.persisted = true;
    await this.scheduleExpiry();
  }

  async scheduleExpiry(at = this.lastActivityAt + ROOM_TTL_MS, { replaceExisting = false } = {}) {
    if (
      typeof this.ctx.storage.getAlarm !== "function"
      || typeof this.ctx.storage.setAlarm !== "function"
    ) return;
    let scheduled = this.scheduledAlarmAt;
    if (scheduled === undefined) {
      scheduled = await this.ctx.storage.getAlarm();
      this.scheduledAlarmAt = scheduled;
    }
    if (
      scheduled === null
      || scheduled > at
      || (replaceExisting && scheduled !== at)
    ) {
      await this.ctx.storage.setAlarm(at);
      this.scheduledAlarmAt = at;
    }
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket already closed/broken; hibernation API cleans it up on its own.
    }
  }

  safeLog(event, fields = {}, level = "info") {
    try {
      this.log(event, fields, level);
      return true;
    } catch {
      this.metrics = recordRoomObservabilityFailure(this.metrics);
      return false;
    }
  }

  async persistFailureMetrics(deliveryType, result) {
    const audit = {
      schema: "canvas-room-fanout-audit/v1",
      room: this.roomLogId,
      recordedAt: new Date().toISOString(),
      deliveryType,
      status: result.status,
      attempted: result.attempted,
      dispatched: result.dispatched,
      succeeded: result.succeeded,
      failed: result.failed,
      timedOut: result.timedOut,
      canceled: result.canceled,
      setupFailures: result.setupFailures,
      reasonCodes: [...new Set(result.auditTrail
        .filter((entry) => entry.status === "failed")
        .map((entry) => entry.reasonCode))].sort(),
      cumulative: this.metrics,
    };
    try {
      await this.ctx.storage.put(FAN_OUT_AUDIT_KEY, audit, { allowUnconfirmed: true });
    } catch {
      this.metrics = recordRoomObservabilityFailure(this.metrics, { auditPersistence: true });
      this.safeLog("fanout_audit_persist_failed", { deliveryType }, "error");
    }
  }

  async recordFanOut(deliveryType, result) {
    this.metrics = recordRoomFanOut(this.metrics, result);
    if (result.failed === 0 && result.setupFailures === 0) return;
    const reasonCodes = [...new Set(
      result.auditTrail
        .filter((entry) => entry.status === "failed")
        .map((entry) => entry.reasonCode),
    )].sort();
    this.safeLog("fanout_degraded", {
      deliveryType,
      fanOutStatus: result.status,
      attempted: result.attempted,
      succeeded: result.succeeded,
      failed: result.failed,
      timedOut: result.timedOut,
      canceled: result.canceled,
      setupFailures: result.setupFailures,
      reasonCodes,
    }, "warn");
    await this.persistFailureMetrics(deliveryType, result);
  }

  async broadcast(payload, exclude) {
    let result;
    try {
      const text = JSON.stringify(payload);
      const recipients = this.ctx.getWebSockets().filter((ws) => ws !== exclude);
      result = await failSoftFanOut(recipients, (ws) => {
        try {
          ws.send(text);
        } catch {
          throw failSoftBranchFailure("branch_unavailable", { retryable: true });
        }
      });
    } catch {
      result = fanOutUnavailableResult("fanout_setup_failed", { retryable: true });
    }
    await this.recordFanOut(typeof payload?.type === "string" ? payload.type : "room_event", result);
    return result;
  }

  async broadcastPresence(exclude) {
    let result;
    try {
      const sockets = this.ctx.getWebSockets();
      const attachments = [];
      for (const ws of sockets) {
        if (ws === exclude) continue;
        let attachment = null;
        try {
          attachment = ws.deserializeAttachment();
        } catch {
          attachment = null;
        }
        attachments.push(attachment || {});
      }
      const payload = JSON.stringify(rosterFromAttachments(attachments));
      const recipients = sockets.filter((ws) => ws !== exclude);
      result = await failSoftFanOut(recipients, (ws) => {
        try {
          ws.send(payload);
        } catch {
          throw failSoftBranchFailure("branch_unavailable", { retryable: true });
        }
      });
    } catch {
      result = fanOutUnavailableResult("fanout_setup_failed", { retryable: true });
    }
    await this.recordFanOut("presence", result);
    return result;
  }

  liveConnections() {
    try {
      return this.ctx.getWebSockets().length;
    } catch {
      return 0;
    }
  }

  restoreRoomLogId(ws) {
    if (this.roomLogId) return;
    try {
      const attachment = ws.deserializeAttachment();
      if (/^room_[a-f0-9]{24}$/.test(attachment?.roomLogId || "")) {
        this.roomLogId = attachment.roomLogId;
      }
    } catch {
      // A missing legacy attachment leaves correlation empty but never leaks
      // the bearer room capability.
    }
  }

  // Emit one structured JSON log line. Cloudflare Tail / Logpush collect
  // `console` output; keeping it single-line JSON makes it query-friendly.
  log(event, fields = {}, level = "info") {
    const record = roomLogRecord({
      room: this.roomLogId,
      event,
      level,
      fields: { connections: this.liveConnections(), ...fields },
    });
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
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
    this.roomLogId = roomCorrelationId(roomId);

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
    server.serializeAttachment({ subject: verdict.claims.sub || "", roomLogId: this.roomLogId });

    const sinceParam = url.searchParams.get("since");
    const since = sinceParam === null ? NaN : Number(sinceParam);
    let sentInitial = false;
    if (Number.isInteger(since)) {
      const catchup = catchupSince(this.eventLog, since, this.state.rev);
      if (catchup.complete) {
        this.send(server, catchup);
        sentInitial = true;
      }
    }
    if (!sentInitial) this.send(server, serializeSnapshot(this.state));
    await this.broadcastPresence();

    this.metrics = recordRoomEvent(this.metrics, "join");
    this.log("join", { subject: verdict.claims.sub || "anonymous", init: sentInitial ? "catchup" : "snapshot", rev: this.state.rev });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.ensureLoaded();
    this.restoreRoomLogId(ws);
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
      this.metrics = recordRoomEvent(this.metrics, "duplicate");
      this.send(ws, { type: "ack", opType: op.type, opId: op.opId, rev: this.state.rev, duplicate: true });
      return;
    }
    const { state: nextState, event, error, conflict } = applyOp(this.state, op);
    if (conflict) {
      this.metrics = recordRoomEvent(this.metrics, "conflict");
      this.log("op_conflict", { opType: op.type, kind: conflict.kind, id: conflict.id, currentVersion: conflict.currentVersion }, "warn");
      // Optimistic-concurrency rejection: return the current entity so the
      // sender can rebase its edit onto the winning version instead of
      // silently clobbering a concurrent change. State is unchanged.
      const current =
        conflict.kind === "node" ? this.state.nodes[conflict.id] ?? null : this.state.links[conflict.id] ?? null;
      this.send(ws, {
        type: "conflict",
        opType: op.type,
        opId: op.opId,
        kind: conflict.kind,
        id: conflict.id,
        baseVersion: conflict.baseVersion,
        currentVersion: conflict.currentVersion,
        current,
        rev: conflict.rev,
      });
      return;
    }
    if (error) {
      this.metrics = recordRoomEvent(this.metrics, "error");
      this.log("op_error", { opType: op && op.type, error }, "warn");
      this.send(ws, { type: "error", error });
      return;
    }
    if (!event) return; // no-op (e.g. deleting an id that's already gone)

    this.state = nextState;
    this.metrics = recordRoomEvent(this.metrics, "applied");
    this.recentOpIds = [...this.recentOpIds, op.opId].slice(-MAX_RECENT_OP_IDS);
    this.eventLog = appendEventLog(this.eventLog, event);
    await this.persist();
    await this.broadcast({ ...event, opId: op.opId }, ws);
    this.send(ws, { type: "ack", opType: op.type, opId: op.opId, rev: event.rev });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.restoreRoomLogId(ws);
    // The runtime may still list a mid-close socket, so explicitly exclude it
    // while deriving the new live roster.
    await this.broadcastPresence(ws);
    const remaining = Math.max(0, this.liveConnections() - 1);
    this.log("leave", { code, wasClean: Boolean(wasClean), connections: remaining });
    // Emit a metrics summary as the room drains so a Tail query can chart
    // per-instance activity (joins, applied, conflicts, errors) without a
    // separate metrics store.
    this.log("metrics", { ...metricsSummary(this.metrics, { room: this.roomLogId }), connections: remaining });
    if (this.persisted) await this.persist();
  }

  async webSocketError(ws, error) {
    // The Hibernation API will close/reap the socket; no shared state rolls
    // back, but the sanitized failure metric survives eviction when possible.
    this.restoreRoomLogId(ws);
    this.metrics = recordRoomEvent(this.metrics, "socketError");
    this.safeLog("websocket_error", {}, "warn");
    await this.persistFailureMetrics("websocket_error", fanOutUnavailableResult("fanout_unavailable"));
  }

  async alarm() {
    await this.ensureLoaded();
    // Cloudflare has consumed the alarm that invoked this method.
    this.scheduledAlarmAt = null;
    const now = Date.now();
    if (this.liveConnections() > 0) {
      await this.scheduleExpiry(now + ROOM_TTL_MS, { replaceExisting: true });
      return;
    }
    if (!roomIsExpired({ lastActivityAt: this.lastActivityAt, now, ttlMs: ROOM_TTL_MS })) {
      await this.scheduleExpiry(this.lastActivityAt + ROOM_TTL_MS, { replaceExisting: true });
      return;
    }

    if (typeof this.ctx.storage.deleteAll === "function") await this.ctx.storage.deleteAll();
    else if (typeof this.ctx.storage.delete === "function") await this.ctx.storage.delete(STORAGE_KEY);
    this.persisted = false;
    this.scheduledAlarmAt = null;
    this.state = createEmptyRoomState();
    this.recentOpIds = [];
    this.eventLog = [];
    this.log("room_expired", { idleMs: now - this.lastActivityAt });
  }
}
