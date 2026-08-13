// Cloudflare Durable Object: one instance per canvas collaboration room.
//
// Uses the WebSocket Hibernation API (`acceptWebSocket`, not `accept()`) so the
// Object wakes only for messages and lifecycle events. Account quotas and
// billing remain deployment concerns; this source makes no zero-cost claim.
//
// Authority split: this file owns ONLY the Cloudflare-specific WebSocket/DO
// plumbing (accept, hibernate, broadcast, and key-value storage persistence via
// one authoritative room value plus one bounded failure-only sidecar). All actual
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
const FAN_OUT_AUDIT_SCHEMA = "canvas-room-failure-audit/v1";
const DURABLE_FAILURE_WINDOW_SCHEMA = "canvas-room-durable-failure-window/v1";
const MAX_MESSAGE_BYTES = 65536; // generous bound; well under the 32 MiB DO WS limit
const MAX_RECENT_OP_IDS = 512;
// Garbage-collect a room after this much idle time with no live connections.
const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_AUDIT_READ_TIMEOUT_MS = 1_000;
// Keep a safety margin below the Durable Object blockConcurrencyWhile limit.
const MAX_AUDIT_READ_TIMEOUT_MS = 25_000;
const MAX_AUDIT_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const OP_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const FAN_OUT_BRANCH_ID_PATTERN = /^branch-[1-9][0-9]*$/;
const FAN_OUT_REASON_CODES = new Set([
  "branch_canceled",
  "branch_failed",
  "branch_output_invalid",
  "branch_result_limit",
  "branch_timed_out",
  "branch_unavailable",
  "fanout_setup_failed",
  "fanout_unavailable",
  "recipient_enumeration_failed",
]);
const DELIVERY_TYPES = new Set([
  "linkDeleted",
  "linkUpserted",
  "nodeDeleted",
  "nodeUpserted",
  "presence",
  "room_event",
]);

function safeCounter(value, amount = 0) {
  const base = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const increment = Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
  return Math.min(Number.MAX_SAFE_INTEGER, base + increment);
}

function auditReadTimeoutMs(env) {
  const configured = Number(env?.CANVAS_FAILURE_AUDIT_READ_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= MAX_AUDIT_READ_TIMEOUT_MS
    ? configured
    : DEFAULT_AUDIT_READ_TIMEOUT_MS;
}

function boundedAuditRead(operation, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, value: null }), timeoutMs);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    Promise.resolve().then(operation).then(
      (value) => finish({ ok: true, value }),
      () => finish({ ok: false, value: null }),
    );
  });
}

function freshFailureAudit({ continuity = "complete", baselineReadFailures = 0 } = {}) {
  return {
    schema: FAN_OUT_AUDIT_SCHEMA,
    continuity,
    baselineReadFailures,
    firstFailureAt: null,
    lastFailureAt: null,
    degradedOperations: 0,
    recipientFailures: 0,
    setupFailures: 0,
    partialOperations: 0,
    exhaustedOperations: 0,
    timedOut: 0,
    canceled: 0,
    socketErrors: 0,
    invalidSettlements: 0,
    auditWriteFailuresRecovered: 0,
    last: null,
  };
}

function unavailableFailureAudit() {
  return freshFailureAudit({ continuity: "baseline-unavailable", baselineReadFailures: 1 });
}

const FAILURE_AUDIT_COUNTERS = Object.freeze([
  "degradedOperations",
  "recipientFailures",
  "setupFailures",
  "partialOperations",
  "exhaustedOperations",
  "timedOut",
  "canceled",
  "socketErrors",
  "invalidSettlements",
  "auditWriteFailuresRecovered",
]);

function normalizeFailureAudit(value) {
  if (value === undefined || value === null) {
    return { valid: true, audit: freshFailureAudit() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== FAN_OUT_AUDIT_SCHEMA) {
    return { valid: false, audit: unavailableFailureAudit() };
  }
  const audit = freshFailureAudit();
  const continuity = value.continuity === undefined ? "complete" : value.continuity;
  const baselineReadFailures = value.baselineReadFailures === undefined ? 0 : value.baselineReadFailures;
  if (
    !["complete", "baseline-unavailable"].includes(continuity)
    || !Number.isSafeInteger(baselineReadFailures)
    || baselineReadFailures < 0
  ) {
    return { valid: false, audit: unavailableFailureAudit() };
  }
  audit.continuity = continuity;
  audit.baselineReadFailures = baselineReadFailures;
  for (const key of FAILURE_AUDIT_COUNTERS) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      return { valid: false, audit: unavailableFailureAudit() };
    }
    audit[key] = value[key];
  }
  if ((value.firstFailureAt === null) !== (value.lastFailureAt === null)) {
    return { valid: false, audit: unavailableFailureAudit() };
  }
  if (value.firstFailureAt !== null) {
    const now = Date.now();
    const first = Date.parse(value.firstFailureAt);
    const last = Date.parse(value.lastFailureAt);
    if (
      typeof value.firstFailureAt !== "string"
      || typeof value.lastFailureAt !== "string"
      || !Number.isFinite(first)
      || !Number.isFinite(last)
      || new Date(first).toISOString() !== value.firstFailureAt
      || new Date(last).toISOString() !== value.lastFailureAt
      || first > last
      || last > now + MAX_AUDIT_CLOCK_SKEW_MS
    ) {
      return { valid: false, audit: unavailableFailureAudit() };
    }
    audit.firstFailureAt = value.firstFailureAt;
    audit.lastFailureAt = value.lastFailureAt;
  }
  // The latest receipt is not needed to continue the counters. Discarding it on
  // load keeps corrupt or legacy caller text from crossing the trust boundary.
  audit.last = null;
  return { valid: true, audit };
}

function projectDurableFailureWindow(audit) {
  return Object.freeze({
    schema: DURABLE_FAILURE_WINDOW_SCHEMA,
    window: "durable-failure-only",
    continuity: audit.continuity,
    baselineReadFailures: audit.baselineReadFailures,
    firstFailureAt: audit.firstFailureAt,
    lastFailureAt: audit.lastFailureAt,
    degradedOperations: audit.degradedOperations,
    recipientFailures: audit.recipientFailures,
    setupFailures: audit.setupFailures,
    partialOperations: audit.partialOperations,
    exhaustedOperations: audit.exhaustedOperations,
    timedOut: audit.timedOut,
    canceled: audit.canceled,
    socketErrors: audit.socketErrors,
    invalidSettlements: audit.invalidSettlements,
    auditWriteFailuresRecovered: audit.auditWriteFailuresRecovered,
  });
}

function deliveryType(value) {
  return DELIVERY_TYPES.has(value) ? value : "room_event";
}

function fanOutStatus({ attempted, succeeded, failed, setupFailures }) {
  if (setupFailures > 0 && attempted === 0) return "failed";
  if (attempted === 0) return "empty";
  if (failed === 0) return "completed";
  if (succeeded === 0) return "failed";
  return "partial";
}

function projectFanOutReceipt(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.auditTrail)) return null;
  const fields = [
    "attempted",
    "dispatched",
    "canceledBeforeDispatch",
    "succeeded",
    "failed",
    "timedOut",
    "canceled",
    "setupFailures",
  ];
  if (fields.some((key) => !Number.isSafeInteger(result[key]) || result[key] < 0)) return null;
  if (
    result.attempted !== result.succeeded + result.failed
    || result.dispatched + result.canceledBeforeDispatch > result.attempted
    || result.succeeded > result.dispatched
    || result.canceledBeforeDispatch > result.canceled
    || result.timedOut + result.canceled > result.failed
    || result.status !== fanOutStatus(result)
    || result.auditTrail.length !== result.attempted + result.setupFailures
  ) return null;
  const ids = new Set();
  let succeeded = 0;
  let failed = 0;
  let timedOut = 0;
  let canceled = 0;
  let setupFailures = 0;
  const reasonCodes = new Set();
  for (const entry of result.auditTrail) {
    if (!entry || typeof entry !== "object" || !["succeeded", "failed"].includes(entry.status)) return null;
    const setup = entry.branchId === "fanout-setup";
    if ((!setup && !FAN_OUT_BRANCH_ID_PATTERN.test(entry.branchId || "")) || ids.has(entry.branchId)) return null;
    ids.add(entry.branchId);
    if (entry.status === "succeeded") {
      if (setup) return null;
      succeeded += 1;
      continue;
    }
    if (!FAN_OUT_REASON_CODES.has(entry.reasonCode) || typeof entry.retryable !== "boolean") return null;
    reasonCodes.add(entry.reasonCode);
    if (setup) setupFailures += 1;
    else failed += 1;
    if (entry.reasonCode === "branch_timed_out") timedOut += 1;
    if (entry.reasonCode === "branch_canceled") canceled += 1;
  }
  if (
    succeeded !== result.succeeded
    || failed !== result.failed
    || timedOut !== result.timedOut
    || canceled !== result.canceled
    || setupFailures !== result.setupFailures
  ) return null;
  return Object.freeze({
    status: result.status,
    attempted: result.attempted,
    dispatched: result.dispatched,
    canceledBeforeDispatch: result.canceledBeforeDispatch,
    succeeded: result.succeeded,
    failed: result.failed,
    timedOut: result.timedOut,
    canceled: result.canceled,
    setupFailures: result.setupFailures,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
  });
}

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
    // Ordinary activity counters are per wake. A separate bounded sidecar
    // retains durable failure totals in its own labeled window, so incompatible
    // lifetime numerators are never mixed into fresh per-wake denominators.
    this.metrics = createRoomMetrics();
    this.failureAudit = freshFailureAudit();
    this.pendingAuditWriteFailures = 0;
    this.lastActivityAt = 0;
    /** @type {{nodes: object, links: object, rev: number} | null} */
    this.state = null;
    this.loaded = this.ctx.blockConcurrencyWhile(async () => {
      // The graph remains authoritative and fail-closed. The observational
      // sidecar is independently fail-soft so a telemetry outage cannot brick
      // room traffic.
      const auditRead = boundedAuditRead(
        () => this.ctx.storage.get(FAN_OUT_AUDIT_KEY, { allowConcurrency: true }),
        auditReadTimeoutMs(this.env),
      );
      const stored = await this.ctx.storage.get(STORAGE_KEY);
      this.persisted = stored !== undefined && stored !== null;
      const storedAudit = await auditRead;
      if (storedAudit.ok) {
        let normalized;
        try {
          normalized = normalizeFailureAudit(storedAudit.value);
        } catch {
          normalized = { valid: false, audit: unavailableFailureAudit() };
        }
        this.failureAudit = normalized.audit;
        if (!normalized.valid) {
          this.metrics = recordRoomObservabilityFailure(this.metrics);
        }
      } else {
        this.failureAudit = unavailableFailureAudit();
        this.metrics = recordRoomObservabilityFailure(this.metrics);
      }
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
        if (stored !== undefined && stored !== null) this.lastActivityAt = Date.now();
      }
      const failureAt = Date.parse(this.failureAudit.lastFailureAt || "");
      if (Number.isFinite(failureAt)) this.lastActivityAt = Math.max(this.lastActivityAt, failureAt);
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

  trackBackground(promise) {
    const task = Promise.resolve(promise).catch(() => {
      this.metrics = recordRoomObservabilityFailure(this.metrics, { auditPersistence: true });
    });
    try {
      if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(task);
    } catch {
      this.metrics = recordRoomObservabilityFailure(this.metrics, { auditPersistence: true });
    }
  }

  foldFailureAudit(event) {
    const recordedAt = new Date().toISOString();
    const prior = this.failureAudit;
    const fanOut = event.kind === "fanout";
    const next = {
      schema: FAN_OUT_AUDIT_SCHEMA,
      continuity: prior.continuity,
      baselineReadFailures: prior.baselineReadFailures,
      firstFailureAt: prior.firstFailureAt || recordedAt,
      lastFailureAt: recordedAt,
      degradedOperations: safeCounter(prior.degradedOperations, fanOut ? 1 : 0),
      recipientFailures: safeCounter(prior.recipientFailures, fanOut ? event.failed : 0),
      setupFailures: safeCounter(prior.setupFailures, fanOut ? event.setupFailures : 0),
      partialOperations: safeCounter(prior.partialOperations, fanOut && event.status === "partial" ? 1 : 0),
      exhaustedOperations: safeCounter(prior.exhaustedOperations, fanOut && event.status === "failed" ? 1 : 0),
      timedOut: safeCounter(prior.timedOut, fanOut ? event.timedOut : 0),
      canceled: safeCounter(prior.canceled, fanOut ? event.canceled : 0),
      socketErrors: safeCounter(prior.socketErrors, event.kind === "socket_error" ? 1 : 0),
      invalidSettlements: safeCounter(prior.invalidSettlements, event.kind === "invalid_settlement" ? 1 : 0),
      auditWriteFailuresRecovered: safeCounter(
        prior.auditWriteFailuresRecovered,
        this.pendingAuditWriteFailures,
      ),
      last: {
        eventType: event.eventType,
        status: event.status,
        attempted: event.attempted,
        dispatched: event.dispatched,
        succeeded: event.succeeded,
        failed: event.failed,
        timedOut: event.timedOut,
        canceled: event.canceled,
        setupFailures: event.setupFailures,
        reasonCodes: event.reasonCodes,
        recordedAt,
      },
    };
    this.failureAudit = next;
    this.lastActivityAt = Math.max(this.lastActivityAt, Date.parse(recordedAt));
    return next;
  }

  async persistFailureAudit(audit, eventType) {
    try {
      await this.ctx.storage.put(FAN_OUT_AUDIT_KEY, audit, {
        allowConcurrency: true,
        allowUnconfirmed: true,
      });
      this.pendingAuditWriteFailures = 0;
      if (typeof this.ctx.storage.getAlarm === "function" && typeof this.ctx.storage.setAlarm === "function") {
        const expiresAt = Date.parse(audit.lastFailureAt) + ROOM_TTL_MS;
        const scheduled = await this.ctx.storage.getAlarm({ allowConcurrency: true });
        if (scheduled === null || scheduled > expiresAt) {
          await this.ctx.storage.setAlarm(expiresAt, {
            allowConcurrency: true,
            allowUnconfirmed: true,
          });
          this.scheduledAlarmAt = expiresAt;
        } else {
          this.scheduledAlarmAt = scheduled;
        }
      }
    } catch {
      this.pendingAuditWriteFailures = safeCounter(this.pendingAuditWriteFailures, 1);
      this.metrics = recordRoomObservabilityFailure(this.metrics, { auditPersistence: true });
      this.safeLog("fanout_audit_persist_failed", { eventType }, "error");
    }
  }

  recordFailureAudit(event) {
    try {
      const audit = this.foldFailureAudit(event);
      this.trackBackground(this.persistFailureAudit(audit, event.eventType));
    } catch {
      this.metrics = recordRoomObservabilityFailure(this.metrics, { auditPersistence: true });
      this.safeLog("fanout_audit_projection_failed", { eventType: event?.eventType || "unknown" }, "error");
    }
  }

  recordFanOut(rawDeliveryType, result) {
    let receipt;
    try {
      receipt = projectFanOutReceipt(result);
    } catch {
      receipt = null;
    }
    if (!receipt) {
      this.metrics = recordRoomObservabilityFailure(this.metrics);
      this.safeLog("fanout_audit_invalid", { deliveryType: deliveryType(rawDeliveryType) }, "error");
      this.recordFailureAudit({
        kind: "invalid_settlement",
        eventType: "fanout_audit_invalid",
        status: "failed",
        attempted: 0,
        dispatched: 0,
        succeeded: 0,
        failed: 0,
        timedOut: 0,
        canceled: 0,
        setupFailures: 0,
        reasonCodes: ["fanout_unavailable"],
      });
      return;
    }
    this.metrics = recordRoomFanOut(this.metrics, receipt);
    if (receipt.failed === 0 && receipt.setupFailures === 0) return;
    const type = deliveryType(rawDeliveryType);
    this.safeLog("fanout_degraded", {
      deliveryType: type,
      fanOutStatus: receipt.status,
      attempted: receipt.attempted,
      dispatched: receipt.dispatched,
      succeeded: receipt.succeeded,
      failed: receipt.failed,
      timedOut: receipt.timedOut,
      canceled: receipt.canceled,
      setupFailures: receipt.setupFailures,
      reasonCodes: receipt.reasonCodes,
    }, "warn");
    this.recordFailureAudit({
      kind: "fanout",
      eventType: type,
      ...receipt,
    });
  }

  deliveryReceipt(result) {
    try {
      const receipt = projectFanOutReceipt(result);
      if (receipt) return Object.freeze({ failurePolicy: "fail-soft", ...receipt });
    } catch {
      // The application path still returns a fixed unavailable receipt.
    }
    return Object.freeze({
      failurePolicy: "fail-soft",
      status: "failed",
      attempted: 0,
      dispatched: 0,
      canceledBeforeDispatch: 0,
      succeeded: 0,
      failed: 0,
      timedOut: 0,
      canceled: 0,
      setupFailures: 1,
      reasonCodes: Object.freeze(["fanout_unavailable"]),
    });
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
    this.recordFanOut(typeof payload?.type === "string" ? payload.type : "room_event", result);
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
    this.recordFanOut("presence", result);
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
    // Authenticated clients receive a fixed, failure-only lifetime window. This
    // makes hibernation-surviving evidence queryable without exposing payloads,
    // identities, room capabilities, or incompatible healthy denominators.
    this.send(server, { type: "failureAudit", ...projectDurableFailureWindow(this.failureAudit) });
    await this.broadcastPresence();

    this.metrics = recordRoomEvent(this.metrics, "join");
    this.safeLog("join", { subject: verdict.claims.sub || "anonymous", init: sentInitial ? "catchup" : "snapshot", rev: this.state.rev });

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
      this.safeLog("op_conflict", { opType: op.type, kind: conflict.kind, id: conflict.id, currentVersion: conflict.currentVersion }, "warn");
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
      this.safeLog("op_error", { opType: op && op.type, error }, "warn");
      this.send(ws, { type: "error", error });
      return;
    }
    if (!event) return; // no-op (e.g. deleting an id that's already gone)

    this.state = nextState;
    this.metrics = recordRoomEvent(this.metrics, "applied");
    this.recentOpIds = [...this.recentOpIds, op.opId].slice(-MAX_RECENT_OP_IDS);
    this.eventLog = appendEventLog(this.eventLog, event);
    await this.persist();
    const delivery = await this.broadcast({ ...event, opId: op.opId }, ws);
    this.send(ws, {
      type: "ack",
      opType: op.type,
      opId: op.opId,
      rev: event.rev,
      delivery: this.deliveryReceipt(delivery),
    });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.restoreRoomLogId(ws);
    // The runtime may still list a mid-close socket, so explicitly exclude it
    // while deriving the new live roster.
    await this.broadcastPresence(ws);
    const remaining = Math.max(0, this.liveConnections() - 1);
    this.safeLog("leave", { code, wasClean: Boolean(wasClean), connections: remaining });
    // Emit a metrics summary as the room drains so a Tail query can chart
    // per-instance activity (joins, applied, conflicts, errors) without a
    // separate metrics store.
    this.safeLog("metrics", {
      ...metricsSummary(this.metrics, { room: this.roomLogId }),
      connections: remaining,
      durableFailureWindow: projectDurableFailureWindow(this.failureAudit),
    });
    if (this.persisted) await this.persist();
  }

  async webSocketError(ws, error) {
    // The Hibernation API will close/reap the socket; no shared state rolls
    // back, but the sanitized failure metric survives eviction when possible.
    this.restoreRoomLogId(ws);
    this.metrics = recordRoomEvent(this.metrics, "socketError");
    this.safeLog("websocket_error", {}, "warn");
    this.recordFailureAudit({
      kind: "socket_error",
      eventType: "websocket_error",
      status: "failed",
      attempted: 0,
      dispatched: 0,
      succeeded: 0,
      failed: 0,
      timedOut: 0,
      canceled: 0,
      setupFailures: 0,
      reasonCodes: ["branch_unavailable"],
    });
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
    else if (typeof this.ctx.storage.delete === "function") {
      await Promise.all([
        this.ctx.storage.delete(STORAGE_KEY),
        this.ctx.storage.delete(FAN_OUT_AUDIT_KEY),
      ]);
    }
    this.persisted = false;
    this.scheduledAlarmAt = null;
    this.state = createEmptyRoomState();
    this.recentOpIds = [];
    this.eventLog = [];
    this.failureAudit = freshFailureAudit();
    this.pendingAuditWriteFailures = 0;
    this.safeLog("room_expired", { idleMs: now - this.lastActivityAt });
  }
}
