// Platform-neutral observability helpers for canvas collaboration rooms.
//
// PURE, no I/O: the Durable Object (worker/canvas-room.js) calls these to build
// structured log records and maintain per-instance counters, then emits the
// records with `console.log` so Cloudflare Tail / Logpush can collect them. The
// same helpers work unchanged in a future self-hosted Node WebSocket server.
// The transport owner may persist the returned plain object; the helpers do
// not depend on a datastore or logging vendor.

/** Fresh cumulative counters for one room instance. */
export function createRoomMetrics() {
  return {
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
  };
}

const ROOM_METRIC_KEYS = Object.freeze(Object.keys(createRoomMetrics()));

function safeAdd(value, amount = 1) {
  const base = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return Math.min(Number.MAX_SAFE_INTEGER, base + amount);
}

/** Restore forward-compatible counters from an untrusted persistence value. */
export function normalizeRoomMetrics(value) {
  const normalized = createRoomMetrics();
  if (value === undefined) return normalized;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    normalized.observabilityFailures = 1;
    return normalized;
  }
  let invalid = false;
  for (const key of ROOM_METRIC_KEYS) {
    if (value[key] === undefined) continue;
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) normalized[key] = value[key];
    else invalid = true;
  }
  if (invalid) normalized.observabilityFailures = safeAdd(normalized.observabilityFailures);
  return normalized;
}

/** Count a metrics/export failure without throwing into the application path. */
export function recordRoomObservabilityFailure(metrics, { auditPersistence = false } = {}) {
  return {
    ...metrics,
    observabilityFailures: safeAdd(metrics?.observabilityFailures),
    fanOutAuditPersistFailures: safeAdd(
      metrics?.fanOutAuditPersistFailures,
      auditPersistence ? 1 : 0,
    ),
  };
}

const EVENT_TO_COUNTER = {
  join: "joins",
  applied: "opsApplied",
  duplicate: "duplicates",
  conflict: "conflicts",
  error: "errors",
  socketError: "socketErrors",
};

/**
 * Return NEW counters with the counter for `type` incremented. Unknown types
 * settle as an observability failure so schema drift cannot stay invisible.
 *
 * @param {ReturnType<typeof createRoomMetrics>} metrics
 * @param {"join"|"applied"|"duplicate"|"conflict"|"error"|"socketError"} type
 */
export function recordRoomEvent(metrics, type) {
  const key = EVENT_TO_COUNTER[type];
  if (!key) return recordRoomObservabilityFailure(metrics);
  return { ...metrics, [key]: safeAdd(metrics?.[key]) };
}

/**
 * Add one fail-soft fan-out settlement to the cumulative room counters.
 * Invalid summaries become a non-blocking observability failure metric.
 */
export function recordRoomFanOut(metrics, {
  attempted,
  dispatched = attempted,
  succeeded,
  failed,
  timedOut = 0,
  canceled = 0,
  canceledBeforeDispatch = 0,
  setupFailures = 0,
} = {}) {
  if (
    ![
      attempted,
      dispatched,
      succeeded,
      failed,
      timedOut,
      canceled,
      canceledBeforeDispatch,
      setupFailures,
    ].every(Number.isSafeInteger)
    || attempted < 0
    || dispatched < 0
    || succeeded < 0
    || failed < 0
    || timedOut < 0
    || canceled < 0
    || canceledBeforeDispatch < 0
    || setupFailures < 0
    || attempted !== succeeded + failed
    || dispatched > attempted
    || canceledBeforeDispatch > canceled
    || dispatched + canceledBeforeDispatch > attempted
    || timedOut + canceled > failed
  ) return recordRoomObservabilityFailure(metrics);
  return {
    ...metrics,
    fanOutOperations: safeAdd(metrics?.fanOutOperations),
    fanOutRecipientsAttempted: safeAdd(metrics?.fanOutRecipientsAttempted, attempted),
    fanOutRecipientsDispatched: safeAdd(metrics?.fanOutRecipientsDispatched, dispatched),
    fanOutRecipientsSucceeded: safeAdd(metrics?.fanOutRecipientsSucceeded, succeeded),
    fanOutRecipientsFailed: safeAdd(metrics?.fanOutRecipientsFailed, failed),
    fanOutRecipientsTimedOut: safeAdd(metrics?.fanOutRecipientsTimedOut, timedOut),
    fanOutRecipientsCanceled: safeAdd(metrics?.fanOutRecipientsCanceled, canceled),
    fanOutCanceledBeforeDispatch: safeAdd(
      metrics?.fanOutCanceledBeforeDispatch,
      canceledBeforeDispatch,
    ),
    fanOutSetupFailures: safeAdd(metrics?.fanOutSetupFailures, setupFailures),
    fanOutPartial: safeAdd(metrics?.fanOutPartial, Number(succeeded > 0 && failed > 0)),
    fanOutExhausted: safeAdd(metrics?.fanOutExhausted, Number(
      setupFailures > 0 || (attempted > 0 && succeeded === 0),
    )),
  };
}

/**
 * Build a structured, JSON-serializable log record. Timestamp is injectable so
 * tests are deterministic; a non-finite `now` falls back to the current time.
 *
 * @param {object} args
 * @param {string} args.room room id
 * @param {string} args.event short event name (e.g. "join", "op_conflict")
 * @param {string} [args.level] "info" | "warn" | "error" (default "info")
 * @param {number} [args.now] epoch ms for the timestamp
 * @param {object} [args.fields] extra structured fields to merge in
 */
export function roomLogRecord({ room, event, level = "info", now, fields = {} } = {}) {
  const ts = Number.isFinite(now) ? now : Date.now();
  return { ts: new Date(ts).toISOString(), level, room, event, ...fields };
}

/**
 * Build a metrics summary payload (cumulative counters plus the live
 * connection count) suitable for logging or returning to an admin view.
 *
 * @param {ReturnType<typeof createRoomMetrics>} metrics
 * @param {{ room?: string, connections?: number }} [context]
 */
export function metricsSummary(metrics, { room, connections } = {}) {
  return { event: "metrics", room, connections, ...metrics };
}
