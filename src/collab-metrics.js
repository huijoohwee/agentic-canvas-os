// Platform-neutral observability helpers for canvas collaboration rooms.
//
// PURE, no I/O: the Durable Object (worker/canvas-room.js) calls these to build
// structured log records and maintain per-instance counters, then emits the
// records with `console.log` so Cloudflare Tail / Logpush can collect them. The
// same helpers work unchanged in a future self-hosted Node WebSocket server.
//
// Counters are per DO instance and in-memory: they reset when the Object is
// evicted from memory, so they measure "since this instance woke", not
// all-time totals. That is the right granularity for spotting a hot room or a
// spike of conflicts/errors without introducing a second datastore.

/** Fresh cumulative counters for one room instance. */
export function createRoomMetrics() {
  return { joins: 0, opsApplied: 0, duplicates: 0, conflicts: 0, errors: 0 };
}

const EVENT_TO_COUNTER = {
  join: "joins",
  applied: "opsApplied",
  duplicate: "duplicates",
  conflict: "conflicts",
  error: "errors",
};

/**
 * Return NEW counters with the counter for `type` incremented. Unknown types
 * are ignored (returns the same object) so callers never crash on a typo.
 *
 * @param {ReturnType<typeof createRoomMetrics>} metrics
 * @param {"join"|"applied"|"duplicate"|"conflict"|"error"} type
 */
export function recordRoomEvent(metrics, type) {
  const key = EVENT_TO_COUNTER[type];
  if (!key) return metrics;
  return { ...metrics, [key]: (metrics[key] ?? 0) + 1 };
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
