// Responsibility: Turn one goal plus recorded outcomes into the next non-blocking
// advance decision, without owning readiness, dispatch, or authority.
//
// Ownership boundary, stated so this file cannot become a second scheduler:
//   - readiness, dependency waves, blocker localization to dependents, and
//     write-set disjointness stay owned by coordination-scheduler-contract.mjs;
//     this module composes it and never reimplements it.
//   - digests, canonical JSON, and write-set normalization stay owned by
//     product-contract-primitives.mjs.
//   - concurrent execution stays owned by the Agent Swarm runtime. Nothing here
//     dispatches, sleeps, retries, or touches a lane, a lease, or a ref.
//
// What this module adds, which nothing else owned:
//   1. Adaptive priority derived from recorded outcomes instead of a caller
//      guess, fed into the existing scheduler as its `priority` input.
//   2. A self-improving loop that is deterministic and auditable: the same
//      outcomes always yield the same weights, and every weight ships in the
//      receipt with its own digest so an adjustment can be replayed.
//   3. Non-blocking goal progress: a blocked unit bounds itself and its
//      dependents, and the goal stays continuable while any unit is ready.
//   4. A fail-closed gate: a unit declaring `gate: true` is refused until the
//      caller passes an explicit authorization for that exact unit.
//
// Determinism: integer arithmetic only, no clock, no randomness, no filesystem,
// no network. Every returned record is frozen and carries `mutation: false`.

import {
  COORDINATION_SCHEDULER_INPUT_SCHEMA,
  buildCoordinationSchedule,
} from "./coordination-scheduler-contract.mjs";
import { digestValue, normalizeWriteSet } from "./product-contract-primitives.mjs";

export const GOAL_SCHEMA = "acos-goal-completion-goal/v1";
export const GOAL_RECEIPT_SCHEMA = "acos-goal-completion-receipt/v1";
export const HEURISTICS_SCHEMA = "acos-goal-completion-heuristics/v1";

export const UNIT_STATES = Object.freeze(["pending", "done", "abandoned"]);
export const GOAL_STATES = Object.freeze(["continuable", "stalled", "complete", "blocked"]);
export const GATE_FINDING = "goal-gate-unauthorized";

// Priority is an integer band because the scheduler orders by descending
// integer priority. BASE_WEIGHT is the neutral prior for a kind with no
// recorded history, so an unproven kind is neither favoured nor buried.
export const PRIORITY_CEILING = 1_000;
export const BASE_WEIGHT = 500;
export const RETRY_PENALTY = 50;
export const MAX_UNITS = 128;
export const MAX_OUTCOMES = 512;

export function deriveHeuristics(outcomes) {
  const records = normalizeOutcomes(outcomes);
  const byKind = new Map();
  for (const record of records) {
    const bucket = byKind.get(record.kind)
      || { attempts: 0, successes: 0, retries: 0 };
    bucket.attempts += 1;
    if (record.result === "success") bucket.successes += 1;
    bucket.retries += record.retries;
    byKind.set(record.kind, bucket);
  }

  const weights = [...byKind.entries()]
    .map(([kind, bucket]) => Object.freeze({
      kind,
      attempts: bucket.attempts,
      successes: bucket.successes,
      // Integer-only so the same outcomes always produce the same weight on
      // every platform. A kind that keeps failing or keeps needing retries
      // sinks; it is never removed, because ranking is not admission.
      weight: clampWeight(
        Math.floor((PRIORITY_CEILING * bucket.successes) / bucket.attempts)
        - RETRY_PENALTY * Math.floor(bucket.retries / bucket.attempts),
      ),
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));

  const core = {
    schema: HEURISTICS_SCHEMA,
    baseWeight: BASE_WEIGHT,
    observedOutcomes: records.length,
    weights,
    mutation: false,
  };
  return Object.freeze({ ...core, heuristicsDigest: digestValue(core) });
}

export function weightForKind(heuristics, kind) {
  const match = heuristics.weights.find((entry) => entry.kind === kind);
  return match ? match.weight : BASE_WEIGHT;
}

export function planGoalAdvance(source) {
  const goal = normalizeGoal(source);
  const heuristics = deriveHeuristics(goal.outcomes);

  const done = goal.units.filter((unit) => unit.state === "done");
  const abandoned = goal.units.filter((unit) => unit.state === "abandoned");
  const terminalIds = new Set([...done, ...abandoned].map((unit) => unit.id));
  const active = goal.units.filter((unit) => unit.state === "pending");

  // Every unit is terminal: report completion without inventing a schedule.
  if (active.length === 0) {
    return receipt({
      goal,
      heuristics,
      schedule: null,
      state: abandoned.length > 0 && done.length === 0 ? "blocked" : "complete",
      done,
      abandoned,
      ready: [],
      waiting: [],
      blocked: [],
      attention: [],
    });
  }

  const schedule = buildCoordinationSchedule({
    schema: COORDINATION_SCHEDULER_INPUT_SCHEMA,
    capacity: goal.capacity,
    tasks: active.map((unit) => ({
      id: unit.id,
      // The learned weight becomes the scheduler's priority. Ordering is the
      // only thing heuristics may influence; they never admit, gate, or block.
      priority: weightForKind(heuristics, unit.kind),
      // A dependency already terminal is no longer a constraint, and the
      // scheduler requires every declared dependency to be present in its
      // own input, so satisfied edges are dropped here rather than faked.
      dependencies: unit.dependencies.filter((id) => !terminalIds.has(id)),
      declaredWriteSet: unit.declaredWriteSet,
      authorityState: unit.authorityState,
      findings: gateFindings(unit, goal.authorizations).concat(unit.findings),
    })),
  });

  const readyIds = new Set(schedule.ready.map((item) => item.taskId));
  const state = readyIds.size > 0
    ? "continuable"
    : schedule.waiting.length > 0 ? "stalled" : "blocked";

  return receipt({
    goal,
    heuristics,
    schedule,
    state,
    done,
    abandoned,
    ready: schedule.ready,
    waiting: schedule.waiting,
    blocked: schedule.blocked,
    attention: schedule.nonBlockingAttention,
  });
}

// A gate is refused by the same typed-finding path the scheduler already
// understands, so gating adds no second block vocabulary. Absence of an
// authorization is a refusal, never an assumed yes.
function gateFindings(unit, authorizations) {
  if (!unit.gate || authorizations.includes(unit.id)) return [];
  return [{
    code: GATE_FINDING,
    blockScope: "candidate",
    affectedWriteSet: unit.declaredWriteSet,
    evidenceDigest: digestValue({ gate: unit.id, authorized: false }),
  }];
}

function receipt({
  goal, heuristics, schedule, state, done, abandoned,
  ready, waiting, blocked, attention,
}) {
  const total = goal.units.length;
  const terminal = done.length + abandoned.length;
  const core = {
    schema: GOAL_RECEIPT_SCHEMA,
    goalId: goal.goalId,
    goalDigest: digestValue(goal),
    heuristicsDigest: heuristics.heuristicsDigest,
    scheduleDigest: schedule ? schedule.reportDigest : null,
    state,
    // `continuable` is the non-blocking contract: a blocked unit bounds itself
    // and its dependents, and the caller may still advance every ready unit.
    continuable: ready.length > 0,
    progress: Object.freeze({
      total,
      terminal,
      done: done.length,
      abandoned: abandoned.length,
      ready: ready.length,
      waiting: waiting.length,
      blocked: blocked.length,
      // Permille keeps progress exact under integer arithmetic.
      completedPermille: total === 0 ? 1_000 : Math.floor((1_000 * terminal) / total),
    }),
    // The scheduler reports dispositions in input order. Dispatch order is this
    // module's own output, so it is sorted by wave, then by learned weight, then
    // by id: earliest wave first, best-performing kind first, stable tiebreak.
    nextUnitIds: Object.freeze(orderForDispatch(ready, goal, heuristics)),
    waves: schedule ? schedule.waves : Object.freeze([]),
    blockedUnits: Object.freeze(blocked.map(dispositionRecord)),
    waitingUnits: Object.freeze(waiting.map(dispositionRecord)),
    nonBlockingAttention: Object.freeze(attention.map((item) => Object.freeze({
      unitId: item.taskId, code: item.code,
    }))),
    appliedWeights: heuristics.weights,
    mutation: false,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function orderForDispatch(ready, goal, heuristics) {
  const kindById = new Map(goal.units.map((unit) => [unit.id, unit.kind]));
  return ready
    .map((item) => ({
      id: item.taskId,
      wave: item.wave ?? 0,
      weight: weightForKind(heuristics, kindById.get(item.taskId)),
    }))
    .sort((left, right) => left.wave - right.wave
      || right.weight - left.weight
      || left.id.localeCompare(right.id))
    .map((item) => item.id);
}

function dispositionRecord(item) {
  return Object.freeze({
    unitId: item.taskId,
    reason: item.reason,
    related: Object.freeze([...item.related]),
  });
}

function normalizeGoal(source) {
  requireObject(source, "goal");
  if (source.schema !== GOAL_SCHEMA) invalid("schema");
  const goalId = text(source.goalId, "goalId");
  const capacity = positiveInteger(source.capacity, "capacity");
  if (!Array.isArray(source.units) || source.units.length === 0 || source.units.length > MAX_UNITS) {
    invalid("units");
  }
  const units = source.units.map(normalizeUnit);
  const ids = new Set(units.map((unit) => unit.id));
  if (ids.size !== units.length) invalid("duplicate unit id");
  for (const unit of units) {
    if (unit.dependencies.some((id) => !ids.has(id) || id === unit.id)) {
      invalid(`dependencies for ${unit.id}`);
    }
  }
  const authorizations = uniqueTextArray(source.authorizations || [], "authorizations").sort();
  for (const id of authorizations) {
    if (!ids.has(id)) invalid(`authorization for unknown unit ${id}`);
  }
  const outcomes = normalizeOutcomes(source.outcomes || []);
  return Object.freeze({
    schema: GOAL_SCHEMA, goalId, capacity, units, authorizations, outcomes,
  });
}

function normalizeUnit(value) {
  requireObject(value, "unit");
  const id = text(value.id, "unit id");
  const kind = text(value.kind, `kind for ${id}`);
  const state = text(value.state, `state for ${id}`);
  if (!UNIT_STATES.includes(state)) invalid(`state for ${id}`);
  return Object.freeze({
    id,
    kind,
    state,
    gate: value.gate === true,
    dependencies: uniqueTextArray(value.dependencies || [], `dependencies for ${id}`).sort(),
    declaredWriteSet: normalizeWriteSet(value.declaredWriteSet),
    authorityState: text(value.authorityState, `authorityState for ${id}`),
    findings: Array.isArray(value.findings) ? value.findings : [],
  });
}

function normalizeOutcomes(value) {
  if (!Array.isArray(value)) invalid("outcomes");
  if (value.length > MAX_OUTCOMES) invalid("outcomes bound");
  return Object.freeze(value.map((item, index) => {
    requireObject(item, `outcome[${index}]`);
    const result = text(item.result, `outcome[${index}].result`);
    if (result !== "success" && result !== "failure") invalid(`outcome[${index}].result`);
    return Object.freeze({
      kind: text(item.kind, `outcome[${index}].kind`),
      result,
      retries: item.retries === undefined
        ? 0
        : nonnegativeInteger(item.retries, `outcome[${index}].retries`),
    });
  }));
}

function clampWeight(value) {
  return Math.max(0, Math.min(PRIORITY_CEILING, value));
}
function uniqueTextArray(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = value.map((item) => text(item, label));
  if (new Set(result).size !== result.length) invalid(label);
  return result;
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Goal completion runtime has invalid ${label}.`);
}
