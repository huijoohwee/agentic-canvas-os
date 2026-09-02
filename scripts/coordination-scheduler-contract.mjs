// Responsibility: Partition independently-authorized work without mutating any lane.
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./product-contract-primitives.mjs";

export const COORDINATION_SCHEDULER_INPUT_SCHEMA = "agentic-coordination-scheduler-input/v1";
export const COORDINATION_SCHEDULER_REPORT_SCHEMA = "agentic-coordination-scheduler-report/v1";

const AUTHORITY_STATES = new Set([
  "current", "waiting-successor", "reviewed", "integrated-preserved",
  "dormant-preserved", "retired",
]);
const BLOCK_SCOPES = new Set(["candidate", "semantic-scope", "global"]);

export function buildCoordinationSchedule(source) {
  const input = normalizeInput(source);
  assertAcyclic(input.tasks);
  const taskById = new Map(input.tasks.map(task => [task.id, task]));
  const disposition = new Map();
  const nonBlockingAttention = [];

  for (const task of input.tasks) {
    const blocking = [];
    for (const finding of task.findings) {
      const disjointGlobal = finding.blockScope === "global"
        && finding.affectedWriteSet
        && !writeSetsOverlap(task.declaredWriteSet, finding.affectedWriteSet);
      if (disjointGlobal) {
        nonBlockingAttention.push(Object.freeze({ taskId: task.id, ...finding }));
      } else {
        blocking.push(finding);
      }
    }
    if (blocking.length > 0) {
      disposition.set(task.id, blocked(task, "admission-finding", blocking.map(item => item.code)));
    } else if (task.authorityState === "waiting-successor") {
      disposition.set(task.id, waiting(task, "cloud-waiting-successor"));
    } else if (task.authorityState !== "current") {
      disposition.set(task.id, blocked(task, "write-authority-unavailable", [task.authorityState]));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const task of input.tasks) {
      if (disposition.has(task.id)) continue;
      const dependencyStates = task.dependencies.map(id => disposition.get(id)).filter(Boolean);
      if (dependencyStates.some(item => item.disposition === "blocked")) {
        disposition.set(task.id, blocked(task, "dependency-blocked",
          task.dependencies.filter(id => disposition.get(id)?.disposition === "blocked")));
        changed = true;
      } else if (dependencyStates.some(item => item.disposition === "waiting")) {
        disposition.set(task.id, waiting(task, "dependency-waiting",
          task.dependencies.filter(id => disposition.get(id)?.disposition === "waiting")));
        changed = true;
      }
    }
  }

  const pending = input.tasks.filter(task => !disposition.has(task.id));
  const waves = [];
  const scheduled = new Set();
  while (pending.some(task => !scheduled.has(task.id))) {
    const eligible = pending.filter(task => !scheduled.has(task.id)
      && task.dependencies.every(id => scheduled.has(id)));
    if (eligible.length === 0) break;
    const wave = [];
    for (const task of eligible.sort(compareTasks)) {
      if (wave.length >= input.capacity) break;
      if (wave.some(selected => writeSetsOverlap(selected.declaredWriteSet, task.declaredWriteSet))) continue;
      wave.push(task);
    }
    if (wave.length === 0) break;
    waves.push(Object.freeze({ index: waves.length, taskIds: wave.map(task => task.id) }));
    wave.forEach(task => scheduled.add(task.id));
  }

  for (const task of pending) {
    if (scheduled.has(task.id)) disposition.set(task.id, ready(task, waveFor(waves, task.id)));
    else disposition.set(task.id, waiting(task, "capacity-or-write-set-overlap",
      pending.filter(peer => peer.id !== task.id && writeSetsOverlap(peer.declaredWriteSet, task.declaredWriteSet))
        .map(peer => peer.id).sort()));
  }

  const ordered = input.tasks.map(task => disposition.get(task.id));
  const core = {
    schema: COORDINATION_SCHEDULER_REPORT_SCHEMA,
    inputDigest: digestValue(input),
    capacity: input.capacity,
    waves,
    ready: ordered.filter(item => item.disposition === "ready"),
    waiting: ordered.filter(item => item.disposition === "waiting"),
    blocked: ordered.filter(item => item.disposition === "blocked"),
    nonBlockingAttention: nonBlockingAttention.sort((a, b) => a.taskId.localeCompare(b.taskId)
      || a.code.localeCompare(b.code)),
    summary: {
      total: input.tasks.length,
      ready: ordered.filter(item => item.disposition === "ready").length,
      waiting: ordered.filter(item => item.disposition === "waiting").length,
      blocked: ordered.filter(item => item.disposition === "blocked").length,
      waves: waves.length,
    },
    mutation: false,
  };
  return Object.freeze({ ...core, reportDigest: digestValue(core) });
}

function normalizeInput(source) {
  requireObject(source, "scheduler input");
  if (source.schema !== COORDINATION_SCHEDULER_INPUT_SCHEMA) invalid("schema");
  const capacity = positiveInteger(source.capacity, "capacity");
  if (!Array.isArray(source.tasks) || source.tasks.length === 0 || source.tasks.length > 128) invalid("tasks");
  const tasks = source.tasks.map(normalizeTask);
  const ids = new Set(tasks.map(task => task.id));
  if (ids.size !== tasks.length) invalid("duplicate task id");
  for (const task of tasks) {
    if (task.dependencies.some(id => !ids.has(id) || id === task.id)) invalid(`dependencies for ${task.id}`);
  }
  return Object.freeze({ schema: COORDINATION_SCHEDULER_INPUT_SCHEMA, capacity, tasks });
}

function normalizeTask(value) {
  requireObject(value, "scheduler task");
  const id = text(value.id, "task id");
  const priority = value.priority === undefined ? 0 : nonnegativeInteger(value.priority, "priority");
  const dependencies = uniqueTextArray(value.dependencies || [], "dependencies").sort();
  const declaredWriteSet = normalizeWriteSet(value.declaredWriteSet);
  const authorityState = text(value.authorityState, "authority state");
  if (!AUTHORITY_STATES.has(authorityState)) invalid(`authority state for ${id}`);
  const findings = (value.findings || []).map(normalizeFinding);
  return Object.freeze({ id, priority, dependencies, declaredWriteSet, authorityState, findings });
}

function normalizeFinding(value) {
  requireObject(value, "finding");
  const code = text(value.code, "finding code");
  const blockScope = text(value.blockScope, "finding blockScope");
  if (!BLOCK_SCOPES.has(blockScope)) invalid("finding blockScope");
  const affectedWriteSet = value.affectedWriteSet === null || value.affectedWriteSet === undefined
    ? null : normalizeWriteSet(value.affectedWriteSet);
  const evidenceDigest = digest(value.evidenceDigest, "finding evidenceDigest");
  return Object.freeze({ code, blockScope, affectedWriteSet, evidenceDigest });
}

function assertAcyclic(tasks) {
  const dependencies = new Map(tasks.map(task => [task.id, task.dependencies]));
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) invalid("dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    dependencies.get(id).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach(task => visit(task.id));
}

function ready(task, wave) { return disposition(task, "ready", "scheduled", [], wave); }
function waiting(task, reason, related = []) { return disposition(task, "waiting", reason, related, null); }
function blocked(task, reason, related = []) { return disposition(task, "blocked", reason, related, null); }
function disposition(task, state, reason, related, wave) {
  return Object.freeze({ taskId: task.id, disposition: state, reason, related: [...related].sort(), wave });
}
function waveFor(waves, id) { return waves.find(wave => wave.taskIds.includes(id))?.index ?? null; }
function compareTasks(left, right) { return right.priority - left.priority || left.id.localeCompare(right.id); }
function uniqueTextArray(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = value.map(item => text(item, label));
  if (new Set(result).size !== result.length) invalid(label);
  return result;
}
function requireObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positiveInteger(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function nonnegativeInteger(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function invalid(label) { throw new Error(`Coordination scheduler has invalid ${label}.`); }
