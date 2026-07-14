// Platform-neutral canvas collaboration room state + op reducer.
//
// PURE, no I/O, no framework globals (no WebSocket/DurableObject/fetch here) so
// this module runs unmodified in:
//   - the Cloudflare Durable Object (worker/canvas-room.js), using WebSocket
//     Hibernation to avoid active duration while idle, and
//   - a future self-hosted Node WebSocket server on Oracle Cloud's Always Free
//     A1 (Ampere) tier — same reducer, same wire protocol, different transport.
//
// Concurrency model: last-write-wins per entity by default, with a monotonic
// version counter (`v`) recorded on every node/link. An op MAY additionally
// carry an optional numeric `baseVersion` to opt into optimistic concurrency:
// when present, the op is rejected as a typed `conflict` (never applied) if the
// current entity version does not equal `baseVersion`, so the client can rebase
// onto the returned current version instead of silently clobbering a concurrent
// edit. Omitting `baseVersion` preserves the original last-write-wins behavior,
// so the wire shape stays backward compatible. A Durable Object (or a single
// Node process per room) still processes one message at a time, so the only
// hazard resolved here is "this writer edited a stale version".

const ROOM_ID_MAX = 128;
const LABEL_MAX = 256;
const NODE_ID_MAX = 200;
// The room is persisted as one bounded value. These limits keep worst-case
// serialized state below the Durable Object per-value limit with headroom.
const MAX_NODES = 500;
const MAX_LINKS = 1000;

/** Valid collaboration room id: conservative slug, safe as a DO name / file key. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidRoomId(roomId) {
  return typeof roomId === "string" && roomId.length > 0 && roomId.length <= ROOM_ID_MAX && ROOM_ID_PATTERN.test(roomId);
}

/** Fresh, empty room state. `rev` is a monotonic room-wide revision counter. */
export function createEmptyRoomState() {
  return { nodes: {}, links: {}, rev: 0 };
}

function cleanId(value) {
  return typeof value === "string" ? value.trim().slice(0, NODE_ID_MAX) : "";
}

function cleanLabel(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, LABEL_MAX);
}

function cleanNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Optimistic-concurrency guard. When `op.baseVersion` is a finite number, the
 * caller is asserting it edited version `baseVersion`; if the current entity
 * version differs, return a typed conflict descriptor so `applyOp` can reject
 * the op without mutating state. Returns `null` when there is no conflict
 * (either `baseVersion` was omitted or it matches the current version).
 *
 * @param {"node"|"link"} kind
 * @param {string} id
 * @param {number} currentVersion current entity `v` (0 when the entity is absent)
 * @param {object} op the incoming op, possibly carrying `baseVersion`
 * @param {number} rev current room revision, echoed back for client rebase
 */
function versionConflict(kind, id, currentVersion, op, rev) {
  if (typeof op.baseVersion !== "number" || !Number.isFinite(op.baseVersion)) return null;
  if (currentVersion === op.baseVersion) return null;
  return { conflict: { kind, id, currentVersion, baseVersion: op.baseVersion, rev } };
}

/** Validate an incoming op. Returns `{ valid, errors }`; never throws. */
export function validateOp(op) {
  const errors = [];
  if (!op || typeof op !== "object" || Array.isArray(op)) {
    return { valid: false, errors: ["op must be an object"] };
  }
  const type = op.type;
  if (type === "upsertNode") {
    const id = cleanId(op.node && op.node.id);
    if (!id) errors.push("node.id is required");
  } else if (type === "deleteNode") {
    if (!cleanId(op.id)) errors.push("id is required");
  } else if (type === "upsertLink") {
    const link = op.link || {};
    if (!cleanId(link.id)) errors.push("link.id is required");
    if (!cleanId(link.source)) errors.push("link.source is required");
    if (!cleanId(link.target)) errors.push("link.target is required");
  } else if (type === "deleteLink") {
    if (!cleanId(op.id)) errors.push("id is required");
  } else if (type === "replaceGraph") {
    const graph = op.graph || {};
    if (!Array.isArray(graph.nodes)) errors.push("graph.nodes must be an array");
    if (!Array.isArray(graph.links)) errors.push("graph.links must be an array");
    if (Array.isArray(graph.nodes) && graph.nodes.length > MAX_NODES) errors.push(`graph.nodes exceeds ${MAX_NODES}`);
    if (Array.isArray(graph.links) && graph.links.length > MAX_LINKS) errors.push(`graph.links exceeds ${MAX_LINKS}`);
  } else {
    errors.push(`unknown op type: ${String(type)}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Apply a validated op to `state`, returning a NEW state (never mutates the
 * input) plus the broadcast-worthy `event` (or `null` if nothing changed) and
 * an `error` string (or `null`). Callers MUST call `validateOp` first, or pass
 * already-trusted ops; this function still fails closed on malformed input
 * rather than throwing.
 *
 * @param {{nodes: object, links: object, rev: number}} state
 * @param {object} op
 * @param {{ now?: number }} [opts] injectable clock (ms epoch) for deterministic tests
 */
export function applyOp(state, op, opts = {}) {
  const { valid, errors } = validateOp(op);
  if (!valid) return { state, event: null, error: errors.join("; ") };

  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const rev = state.rev + 1;

  if (op.type === "upsertNode") {
    const id = cleanId(op.node.id);
    const prev = state.nodes[id];
    const conflict = versionConflict("node", id, prev?.v ?? 0, op, state.rev);
    if (conflict) {
      return { state, event: null, error: `version conflict on node ${id}`, ...conflict };
    }
    if (Object.prototype.hasOwnProperty.call(state.nodes, id) === false && Object.keys(state.nodes).length >= MAX_NODES) {
      return { state, event: null, error: `room node limit (${MAX_NODES}) reached` };
    }
    const node = {
      id,
      label: cleanLabel(op.node.label, id),
      x: cleanNumber(op.node.x) ?? prev?.x ?? 0,
      y: cleanNumber(op.node.y) ?? prev?.y ?? 0,
      lon: cleanNumber(op.node.lon) ?? prev?.lon,
      lat: cleanNumber(op.node.lat) ?? prev?.lat,
      r: cleanNumber(op.node.r) ?? prev?.r ?? 18,
      v: (prev?.v ?? 0) + 1,
      updatedAt: now,
    };
    const nodes = { ...state.nodes, [id]: node };
    return { state: { ...state, nodes, rev }, event: { type: "nodeUpserted", node, rev }, error: null };
  }

  if (op.type === "deleteNode") {
    const id = cleanId(op.id);
    if (!Object.prototype.hasOwnProperty.call(state.nodes, id)) return { state, event: null, error: null };
    const conflict = versionConflict("node", id, state.nodes[id]?.v ?? 0, op, state.rev);
    if (conflict) {
      return { state, event: null, error: `version conflict on node ${id}`, ...conflict };
    }
    const nodes = { ...state.nodes };
    delete nodes[id];
    // Cascade: drop links touching the deleted node (mirrors web/app.js deleteSelection).
    const links = {};
    for (const [linkId, link] of Object.entries(state.links)) {
      if (link.source !== id && link.target !== id) links[linkId] = link;
    }
    return { state: { ...state, nodes, links, rev }, event: { type: "nodeDeleted", id, rev }, error: null };
  }

  if (op.type === "upsertLink") {
    const id = cleanId(op.link.id);
    const prev = state.links[id];
    const conflict = versionConflict("link", id, prev?.v ?? 0, op, state.rev);
    if (conflict) {
      return { state, event: null, error: `version conflict on link ${id}`, ...conflict };
    }
    if (Object.prototype.hasOwnProperty.call(state.links, id) === false && Object.keys(state.links).length >= MAX_LINKS) {
      return { state, event: null, error: `room link limit (${MAX_LINKS}) reached` };
    }
    const link = {
      id,
      source: cleanId(op.link.source),
      target: cleanId(op.link.target),
      label: cleanLabel(op.link.label, ""),
      v: (prev?.v ?? 0) + 1,
      updatedAt: now,
    };
    const links = { ...state.links, [id]: link };
    return { state: { ...state, links, rev }, event: { type: "linkUpserted", link, rev }, error: null };
  }

  if (op.type === "deleteLink") {
    const id = cleanId(op.id);
    if (!Object.prototype.hasOwnProperty.call(state.links, id)) return { state, event: null, error: null };
    const conflict = versionConflict("link", id, state.links[id]?.v ?? 0, op, state.rev);
    if (conflict) {
      return { state, event: null, error: `version conflict on link ${id}`, ...conflict };
    }
    const links = { ...state.links };
    delete links[id];
    return { state: { ...state, links, rev }, event: { type: "linkDeleted", id, rev }, error: null };
  }

  if (op.type === "replaceGraph") {
    const nodes = {};
    for (const n of op.graph.nodes) {
      const id = cleanId(n && n.id);
      if (!id || Object.prototype.hasOwnProperty.call(nodes, id)) continue;
      nodes[id] = {
        id,
        label: cleanLabel(n.label, id),
        x: cleanNumber(n.x) ?? 0,
        y: cleanNumber(n.y) ?? 0,
        lon: cleanNumber(n.lon),
        lat: cleanNumber(n.lat),
        r: cleanNumber(n.r) ?? 18,
        v: 1,
        updatedAt: now,
      };
    }
    const links = {};
    for (const l of op.graph.links) {
      const id = cleanId(l && l.id);
      const source = cleanId(l && l.source);
      const target = cleanId(l && l.target);
      if (!id || !source || !target) continue;
      if (!Object.prototype.hasOwnProperty.call(nodes, source) || !Object.prototype.hasOwnProperty.call(nodes, target)) continue;
      if (Object.prototype.hasOwnProperty.call(links, id)) continue;
      links[id] = { id, source, target, label: cleanLabel(l.label, ""), v: 1, updatedAt: now };
    }
    const nextState = { nodes, links, rev };
    return { state: nextState, event: { type: "graphReplaced", graph: serializeGraph(nextState), rev }, error: null };
  }

  // Unreachable given validateOp, but fail closed rather than throw.
  return { state, event: null, error: "unhandled op type" };
}

/** Plain `{ nodes: [], links: [] }` view, sorted by id for deterministic output. */
export function serializeGraph(state) {
  const nodes = Object.values(state.nodes).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const links = Object.values(state.links).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, links };
}

/**
 * Full snapshot payload sent to a client on join. Includes room capacity so a
 * client can warn the operator as usage approaches the hard caps rather than
 * discovering the limit only when an op is rejected.
 */
export function serializeSnapshot(state) {
  return {
    type: "snapshot",
    ...serializeGraph(state),
    rev: state.rev,
    limits: { maxNodes: MAX_NODES, maxLinks: MAX_LINKS },
    counts: { nodes: Object.keys(state.nodes).length, links: Object.keys(state.links).length },
  };
}

// --- Reconnect catch-up ------------------------------------------------------

// The transport keeps a bounded, ordered log of applied events. A reconnecting
// client can replay the gap after its last seen revision when the log still
// covers every missed event; otherwise it safely falls back to a full snapshot.
const MAX_EVENT_LOG = 256;

export function appendEventLog(log, event, cap = MAX_EVENT_LOG) {
  if (!event || typeof event.rev !== "number") return log;
  const base = Array.isArray(log) ? log : [];
  const next = base.length >= cap ? base.slice(base.length - cap + 1) : base.slice();
  next.push(event);
  return next;
}

export function catchupSince(log, sinceRev, currentRev) {
  if (typeof sinceRev !== "number" || !Number.isInteger(sinceRev) || sinceRev < 0 || sinceRev > currentRev) {
    return { type: "catchup", complete: false, events: [], rev: currentRev };
  }
  if (sinceRev === currentRev) {
    return { type: "catchup", complete: true, events: [], rev: currentRev };
  }
  const events = (Array.isArray(log) ? log : []).filter((event) =>
    event && typeof event.rev === "number" && event.rev > sinceRev,
  );
  const complete =
    events.length > 0 && events[0].rev === sinceRev + 1 && events[events.length - 1].rev === currentRev;
  return { type: "catchup", complete, events, rev: currentRev };
}

// Presence is derived from live connection attachments so no separate roster
// state can leak when a socket disappears.
export function rosterFromAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const counts = new Map();
  for (const attachment of list) {
    const subject =
      attachment && typeof attachment.subject === "string" && attachment.subject ? attachment.subject : "anonymous";
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }
  const members = [...counts.entries()]
    .map(([subject, connections]) => ({ subject, connections }))
    .sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
  return { type: "presence", members, connections: list.length };
}

export const COLLAB_ROOM_LIMITS = Object.freeze({
  MAX_NODES,
  MAX_LINKS,
  LABEL_MAX,
  NODE_ID_MAX,
  ROOM_ID_MAX,
  MAX_EVENT_LOG,
});
