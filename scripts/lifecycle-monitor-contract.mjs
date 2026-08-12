// Responsibility: Reduce provider-neutral lifecycle observations into adaptive read-only checkpoints.
import { createHash } from "node:crypto";

export const LIFECYCLE_MONITOR_REQUEST_SCHEMA = "agentic-lifecycle-monitor-request/v1";
export const LIFECYCLE_MONITOR_OBSERVATION_SCHEMA = "agentic-lifecycle-monitor-observation/v1";
export const LIFECYCLE_MONITOR_CHECKPOINT_SCHEMA = "agentic-lifecycle-monitor-checkpoint/v1";
export const LIFECYCLE_MONITOR_RESUME_SIGNAL_SCHEMA = "agentic-lifecycle-monitor-resume-signal/v1";
const LIFECYCLE_MONITOR_OBSERVATION_ID_SCHEMA = "agentic-lifecycle-monitor-observation-identity/v1";

const ERROR_CLASSES = new Set(["transient", "rate-limited", "permanent", "integrity"]);
const TERMINAL_STATUSES = new Set(["ready", "blocked", "stopped"]);
const CHECKPOINT_STATUSES = new Set(["observe", "wait", ...TERMINAL_STATUSES]);
const DIGEST = /^[0-9a-f]{64}$/u;

export function normalizeLifecycleMonitorRequest(value) {
  exact(value, ["schema", "subject", "target", "schedule", "budget"], "request");
  if (value.schema !== LIFECYCLE_MONITOR_REQUEST_SCHEMA) invalid("request schema");
  return freeze({
    schema: LIFECYCLE_MONITOR_REQUEST_SCHEMA,
    subject: normalizeSubject(value.subject),
    target: normalizeTarget(value.target),
    schedule: normalizeSchedule(value.schedule),
    budget: normalizeBudget(value.budget),
  });
}

export function buildLifecycleMonitorObservation(value) {
  exact(value, [
    "schema", "observedAt", "subjectId", "identityDigest",
    "sourceRevision", "generation", "heartbeatSequence", "state", "readUnits",
    "retryAfterMs", "error",
  ], "observation input");
  if (value.schema !== LIFECYCLE_MONITOR_OBSERVATION_SCHEMA) invalid("observation schema");
  const core = {
    schema: LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
    observedAt: instant(value.observedAt, "observation instant"),
    subjectId: text(value.subjectId, "observation subject"),
    identityDigest: digest(value.identityDigest, "observation identity"),
    sourceRevision: text(value.sourceRevision, "observation source revision"),
    generation: nonnegativeInteger(value.generation, "observation generation"),
    heartbeatSequence: nonnegativeInteger(value.heartbeatSequence, "observation heartbeat sequence"),
    state: text(value.state, "observation state"),
    readUnits: boundedInteger(value.readUnits, 1, 1_000_000_000, "observation read units"),
    retryAfterMs: nullableBoundedInteger(value.retryAfterMs, 0, 86_400_000,
      "observation retry delay"),
    error: normalizeError(value.error),
  };
  const observationId = digestValue({
    schema: LIFECYCLE_MONITOR_OBSERVATION_ID_SCHEMA,
    observation: core,
  });
  return freeze({ schema: core.schema, observationId, ...withoutSchema(core) });
}

export function normalizeLifecycleMonitorObservation(value) {
  exact(value, [
    "schema", "observationId", "observedAt", "subjectId", "identityDigest",
    "sourceRevision", "generation", "heartbeatSequence", "state", "readUnits",
    "retryAfterMs", "error",
  ], "observation");
  const { observationId, ...input } = value;
  const rebuilt = buildLifecycleMonitorObservation(input);
  if (observationId !== rebuilt.observationId) invalid("observation ID binding");
  return rebuilt;
}

export function createLifecycleMonitorCheckpoint({ request, evaluatedAt }) {
  const policy = normalizeLifecycleMonitorRequest(request);
  const requestDigest = digestValue(policy);
  const time = instant(evaluatedAt, "evaluation instant");
  return checkpoint({
    monitorId: digestValue({ schema: "agentic-lifecycle-monitor/v1", requestDigest }),
    requestDigest,
    priorCheckpointDigest: null,
    status: "observe",
    classification: "initial-observation-required",
    startedAt: time,
    evaluatedAt: time,
    attempt: 0,
    consecutiveUnchanged: 0,
    nextObservationAt: time,
    delayMs: 0,
    consumption: { attempts: 0, elapsedMs: 0, readUnits: 0 },
    lastObservation: null,
    resumeSignal: null,
  });
}

export function normalizeLifecycleMonitorCheckpoint(value, { request } = {}) {
  exact(value, [
    "schema", "monitorId", "requestDigest", "priorCheckpointDigest", "status",
    "classification", "startedAt", "evaluatedAt", "attempt", "consecutiveUnchanged",
    "nextObservationAt", "delayMs", "consumption", "lastObservation", "resumeSignal",
    "mutationAuthority", "checkpointDigest",
  ], "checkpoint");
  if (value.schema !== LIFECYCLE_MONITOR_CHECKPOINT_SCHEMA) invalid("checkpoint schema");
  const { checkpointDigest, ...core } = value;
  if (!DIGEST.test(String(checkpointDigest || "")) || digestValue(core) !== checkpointDigest) {
    invalid("checkpoint digest");
  }
  const policy = request ? normalizeLifecycleMonitorRequest(request) : null;
  if (policy) {
    const requestDigest = digestValue(policy);
    if (value.requestDigest !== requestDigest) invalid("checkpoint request binding");
    if (value.monitorId !== digestValue({
      schema: "agentic-lifecycle-monitor/v1",
      requestDigest,
    })) invalid("checkpoint monitor binding");
  }
  digest(value.monitorId, "checkpoint monitor");
  nullableDigest(value.priorCheckpointDigest, "prior checkpoint");
  if (!CHECKPOINT_STATUSES.has(value.status)) invalid("checkpoint status");
  text(value.classification, "checkpoint classification");
  instant(value.startedAt, "checkpoint start");
  instant(value.evaluatedAt, "checkpoint evaluation");
  nonnegativeInteger(value.attempt, "checkpoint attempt");
  nonnegativeInteger(value.consecutiveUnchanged, "checkpoint unchanged count");
  nullableInstant(value.nextObservationAt, "checkpoint next observation");
  nullableNonnegativeInteger(value.delayMs, "checkpoint delay");
  normalizeConsumption(value.consumption);
  normalizeLastObservation(value.lastObservation);
  normalizeResumeSignal(value.resumeSignal, value, policy);
  if (value.mutationAuthority !== false) invalid("checkpoint mutation authority");
  if (TERMINAL_STATUSES.has(value.status)
    && (value.nextObservationAt !== null || value.delayMs !== null)) {
    invalid("terminal checkpoint schedule");
  }
  if (value.status === "ready" && !value.resumeSignal) invalid("ready checkpoint signal");
  if (value.status !== "ready" && value.resumeSignal !== null) invalid("non-ready signal");
  if (value.attempt !== value.consumption.attempts
    || value.consumption.elapsedMs !== Date.parse(value.evaluatedAt) - Date.parse(value.startedAt)
    || value.consecutiveUnchanged > value.attempt) invalid("checkpoint counters");
  if ((value.attempt === 0) !== (value.lastObservation === null)) {
    invalid("checkpoint observation history");
  }
  if (value.status === "observe" && (value.attempt !== 0 || value.delayMs !== 0
    || value.nextObservationAt !== value.evaluatedAt)) invalid("initial checkpoint");
  if (value.status === "wait") {
    if (value.delayMs === null || value.nextObservationAt === null) {
      invalid("waiting checkpoint schedule");
    }
    if (policy && (
      value.delayMs < policy.schedule.minimumDelayMs
      || value.delayMs > policy.schedule.maximumDelayMs
      || Date.parse(value.nextObservationAt) !== Date.parse(value.evaluatedAt) + value.delayMs
      || Date.parse(value.nextObservationAt) - Date.parse(value.startedAt)
        > policy.budget.maximumElapsedMs
    )) invalid("waiting checkpoint policy binding");
  }
  return freeze(structuredClone(value));
}

export function advanceLifecycleMonitor({ request, priorCheckpoint, observation, evaluatedAt }) {
  const policy = normalizeLifecycleMonitorRequest(request);
  const prior = normalizeLifecycleMonitorCheckpoint(priorCheckpoint, { request: policy });
  const observed = normalizeLifecycleMonitorObservation(observation);
  const observationDigest = digestValue(observed);
  const sameObservation = prior.lastObservation?.observationId === observed.observationId
    && prior.lastObservation.observationDigest === observationDigest;
  if (TERMINAL_STATUSES.has(prior.status)) return prior;
  const time = instant(evaluatedAt, "evaluation instant");
  if (sameObservation && time === prior.evaluatedAt) return prior;
  const elapsedMs = Date.parse(time) - Date.parse(prior.startedAt);
  if (Date.parse(time) < Date.parse(prior.evaluatedAt)) {
    return terminate(policy, prior, time, "blocked", "evaluation-clock-regression");
  }
  if (Date.parse(observed.observedAt)
    > Date.parse(time) + policy.schedule.maximumClockSkewMs) {
    return terminate(policy, prior, time, "blocked", "observation-clock-ahead");
  }
  if (observed.subjectId !== policy.subject.subjectId
    || observed.identityDigest !== policy.subject.identityDigest) {
    return terminate(policy, prior, time, "blocked", "identity-drift");
  }
  const last = prior.lastObservation;
  if (last && Date.parse(observed.observedAt) < Date.parse(last.observedAt)) {
    return terminate(policy, prior, time, "blocked", "observation-clock-regression");
  }
  if (last && observed.generation < last.generation) {
    return terminate(policy, prior, time, "blocked", "generation-regression");
  }
  if (last && observed.heartbeatSequence < last.heartbeatSequence) {
    return terminate(policy, prior, time, "blocked", "heartbeat-regression");
  }
  const lastObservation = projectObservation(observed, observationDigest);
  const consumption = {
    attempts: prior.consumption.attempts + 1,
    elapsedMs,
    readUnits: prior.consumption.readUnits + observed.readUnits,
  };
  if (observed.error && ["permanent", "integrity"].includes(observed.error.class)) {
    return nextCheckpoint(prior, {
      status: "blocked",
      classification: `${observed.error.class}-observation-error`,
      evaluatedAt: time,
      attempt: prior.attempt + 1,
      consumption,
      lastObservation,
    });
  }
  if (budgetExceeded(policy, consumption)) {
    return nextCheckpoint(prior, {
      status: "stopped", classification: "budget-exhausted", evaluatedAt: time,
      attempt: prior.attempt + 1, consumption, lastObservation,
    });
  }
  const targetReached = observed.error === null
    && observed.state === policy.target.state
    && observed.generation >= policy.target.minimumGeneration
    && observed.heartbeatSequence >= policy.target.minimumHeartbeatSequence;
  if (targetReached) {
    return nextCheckpoint(prior, {
      status: "ready",
      classification: "target-observed",
      evaluatedAt: time,
      attempt: prior.attempt + 1,
      consumption,
      lastObservation,
      resumeSignal: resumeSignal(policy, prior, observed, observationDigest, time),
    });
  }
  if (budgetExhausted(policy, consumption)) {
    return nextCheckpoint(prior, {
      status: "stopped",
      classification: "budget-exhausted",
      evaluatedAt: time,
      attempt: prior.attempt + 1,
      consumption,
      lastObservation,
    });
  }
  const unchanged = Boolean(last)
    && last.sourceRevision === observed.sourceRevision
    && last.generation === observed.generation
    && last.heartbeatSequence === observed.heartbeatSequence
    && last.state === observed.state;
  const consecutiveUnchanged = unchanged || observed.error
    ? prior.consecutiveUnchanged + 1 : 0;
  const classification = observed.error?.class === "rate-limited" ? "rate-limited"
    : observed.error ? "transient-observation-error"
      : unchanged ? "unchanged" : last ? "progress-observed" : "target-not-observed";
  const delayMs = adaptiveDelay(policy, {
    consecutiveUnchanged,
    progress: !observed.error && !unchanged,
    retryAfterMs: observed.retryAfterMs,
    seed: { monitorId: prior.monitorId, attempt: prior.attempt + 1, observationDigest },
  });
  if (delayMs > policy.budget.maximumElapsedMs - consumption.elapsedMs) {
    return nextCheckpoint(prior, {
      status: "stopped",
      classification: "budget-exhausted",
      evaluatedAt: time,
      attempt: prior.attempt + 1,
      consecutiveUnchanged,
      consumption,
      lastObservation,
    });
  }
  return nextCheckpoint(prior, {
    status: "wait",
    classification,
    evaluatedAt: time,
    attempt: prior.attempt + 1,
    consecutiveUnchanged,
    nextObservationAt: addMilliseconds(time, delayMs),
    delayMs,
    consumption,
    lastObservation,
  });
}

export function stopLifecycleMonitor({ request, priorCheckpoint, evaluatedAt, classification }) {
  const policy = normalizeLifecycleMonitorRequest(request);
  const prior = normalizeLifecycleMonitorCheckpoint(priorCheckpoint, { request: policy });
  if (TERMINAL_STATUSES.has(prior.status)) return prior;
  const time = instant(evaluatedAt, "evaluation instant");
  if (Date.parse(time) < Date.parse(prior.evaluatedAt)) {
    return terminate(policy, prior, time, "blocked", "evaluation-clock-regression");
  }
  return nextCheckpoint(prior, {
    status: "stopped",
    classification: text(classification, "stop classification"),
    evaluatedAt: time,
    consumption: {
      ...prior.consumption,
      elapsedMs: Date.parse(time) - Date.parse(prior.startedAt),
    },
  });
}

export function stopLifecycleMonitorIfBudgetExhausted({ request, priorCheckpoint, evaluatedAt }) {
  const policy = normalizeLifecycleMonitorRequest(request);
  const prior = normalizeLifecycleMonitorCheckpoint(priorCheckpoint, { request: policy });
  if (TERMINAL_STATUSES.has(prior.status)) return prior;
  const time = instant(evaluatedAt, "evaluation instant");
  const consumption = {
    ...prior.consumption,
    elapsedMs: Date.parse(time) - Date.parse(prior.startedAt),
  };
  if (!budgetExhausted(policy, consumption)) return prior;
  return nextCheckpoint(prior, {
    status: "stopped",
    classification: "budget-exhausted",
    evaluatedAt: time,
    consumption,
  });
}

export function blockLifecycleMonitor({ request, priorCheckpoint, evaluatedAt, classification }) {
  const policy = normalizeLifecycleMonitorRequest(request);
  const prior = normalizeLifecycleMonitorCheckpoint(priorCheckpoint, { request: policy });
  if (TERMINAL_STATUSES.has(prior.status)) return prior;
  return terminate(policy, prior, evaluatedAt, "blocked", classification);
}

function terminate(policy, prior, evaluatedAt, status, classification) {
  normalizeLifecycleMonitorRequest(policy);
  const time = instant(evaluatedAt, "evaluation instant");
  return nextCheckpoint(prior, {
    status,
    classification,
    evaluatedAt: time,
    consumption: {
      ...prior.consumption,
      elapsedMs: Math.max(0, Date.parse(time) - Date.parse(prior.startedAt)),
    },
  });
}

function nextCheckpoint(prior, changes) {
  return checkpoint({
    ...prior,
    priorCheckpointDigest: prior.checkpointDigest,
    status: changes.status,
    classification: changes.classification,
    evaluatedAt: changes.evaluatedAt,
    attempt: changes.attempt ?? prior.attempt,
    consecutiveUnchanged: changes.consecutiveUnchanged ?? prior.consecutiveUnchanged,
    nextObservationAt: changes.nextObservationAt ?? null,
    delayMs: changes.delayMs ?? null,
    consumption: changes.consumption ?? prior.consumption,
    lastObservation: changes.lastObservation ?? prior.lastObservation,
    resumeSignal: changes.resumeSignal ?? null,
  });
}

function checkpoint(value) {
  const core = {
    schema: LIFECYCLE_MONITOR_CHECKPOINT_SCHEMA,
    monitorId: value.monitorId,
    requestDigest: value.requestDigest,
    priorCheckpointDigest: value.priorCheckpointDigest,
    status: value.status,
    classification: value.classification,
    startedAt: value.startedAt,
    evaluatedAt: value.evaluatedAt,
    attempt: value.attempt,
    consecutiveUnchanged: value.consecutiveUnchanged,
    nextObservationAt: value.nextObservationAt,
    delayMs: value.delayMs,
    consumption: value.consumption,
    lastObservation: value.lastObservation,
    resumeSignal: value.resumeSignal,
    mutationAuthority: false,
  };
  return freeze({ ...core, checkpointDigest: digestValue(core) });
}

function resumeSignal(policy, prior, observed, observationDigest, issuedAt) {
  const core = {
    schema: LIFECYCLE_MONITOR_RESUME_SIGNAL_SCHEMA,
    monitorId: prior.monitorId,
    requestDigest: prior.requestDigest,
    subjectId: policy.subject.subjectId,
    identityDigest: policy.subject.identityDigest,
    targetState: policy.target.state,
    minimumGeneration: policy.target.minimumGeneration,
    minimumHeartbeatSequence: policy.target.minimumHeartbeatSequence,
    observedState: observed.state,
    observedGeneration: observed.generation,
    observedHeartbeatSequence: observed.heartbeatSequence,
    observationDigest,
    issuedAt,
    purpose: "wake-and-revalidate",
    mutationAuthority: false,
  };
  return freeze({ ...core, signalKey: digestValue(core) });
}

function adaptiveDelay(policy, { consecutiveUnchanged, progress, retryAfterMs, seed }) {
  if (progress) return policy.schedule.minimumDelayMs;
  const growth = Math.floor(consecutiveUnchanged / policy.schedule.unchangedGrowthThreshold);
  const multiplier = policy.schedule.multiplierPermille / 1_000;
  const base = Math.min(
    policy.schedule.maximumDelayMs,
    Math.floor(policy.schedule.minimumDelayMs * (multiplier ** growth)),
  );
  const entropy = Number.parseInt(digestValue(seed).slice(0, 8), 16) / 0xffffffff;
  const jitter = Math.floor(base * policy.schedule.jitterPermille / 1_000 * entropy);
  return Math.min(
    policy.schedule.maximumDelayMs,
    Math.max(policy.schedule.minimumDelayMs, retryAfterMs || 0, base + jitter),
  );
}

function budgetExhausted(policy, consumption) {
  return consumption.attempts >= policy.budget.maximumAttempts
    || consumption.elapsedMs >= policy.budget.maximumElapsedMs
    || consumption.readUnits >= policy.budget.maximumReadUnits;
}
function budgetExceeded(policy, consumption) {
  return consumption.attempts > policy.budget.maximumAttempts
    || consumption.elapsedMs > policy.budget.maximumElapsedMs
    || consumption.readUnits > policy.budget.maximumReadUnits;
}

function normalizeSubject(value) {
  exact(value, ["subjectId", "identityDigest"], "subject");
  return freeze({
    subjectId: text(value.subjectId, "subject ID"),
    identityDigest: digest(value.identityDigest, "subject identity"),
  });
}
function normalizeTarget(value) {
  exact(value, ["state", "minimumGeneration", "minimumHeartbeatSequence"], "target");
  return freeze({
    state: text(value.state, "target state"),
    minimumGeneration: nonnegativeInteger(value.minimumGeneration, "target generation"),
    minimumHeartbeatSequence: nonnegativeInteger(value.minimumHeartbeatSequence,
      "target heartbeat sequence"),
  });
}
function normalizeSchedule(value) {
  exact(value, [
    "minimumDelayMs", "maximumDelayMs", "multiplierPermille", "jitterPermille",
    "unchangedGrowthThreshold", "maximumClockSkewMs",
  ], "schedule");
  const result = {
    minimumDelayMs: boundedInteger(value.minimumDelayMs, 10, 86_400_000, "minimum delay"),
    maximumDelayMs: boundedInteger(value.maximumDelayMs, 10, 86_400_000, "maximum delay"),
    multiplierPermille: boundedInteger(value.multiplierPermille, 1_000, 10_000,
      "delay multiplier"),
    jitterPermille: boundedInteger(value.jitterPermille, 0, 1_000, "delay jitter"),
    unchangedGrowthThreshold: boundedInteger(
      value.unchangedGrowthThreshold,
      1,
      1_000,
      "unchanged growth threshold",
    ),
    maximumClockSkewMs: boundedInteger(value.maximumClockSkewMs, 0, 86_400_000,
      "maximum clock skew"),
  };
  if (result.maximumDelayMs < result.minimumDelayMs) invalid("schedule bounds");
  return freeze(result);
}
function normalizeBudget(value) {
  exact(value, ["maximumAttempts", "maximumElapsedMs", "maximumReadUnits"], "budget");
  return freeze({
    maximumAttempts: boundedInteger(value.maximumAttempts, 1, 1_000_000, "attempt budget"),
    maximumElapsedMs: boundedInteger(value.maximumElapsedMs, 1, 2_147_000_000, "elapsed budget"),
    maximumReadUnits: boundedInteger(value.maximumReadUnits, 1, 1_000_000_000, "read-unit budget"),
  });
}
function normalizeError(value) {
  if (value === null) return null;
  exact(value, ["class", "code"], "observation error");
  if (!ERROR_CLASSES.has(value.class)) invalid("observation error class");
  return freeze({ class: value.class, code: text(value.code, "observation error code") });
}
function normalizeConsumption(value) {
  exact(value, ["attempts", "elapsedMs", "readUnits"], "checkpoint consumption");
  return freeze({
    attempts: nonnegativeInteger(value.attempts, "consumed attempts"),
    elapsedMs: nonnegativeInteger(value.elapsedMs, "consumed elapsed time"),
    readUnits: nonnegativeInteger(value.readUnits, "consumed read units"),
  });
}
function normalizeLastObservation(value) {
  if (value === null) return null;
  exact(value, [
    "observationId", "observationDigest", "observedAt", "sourceRevision", "generation",
    "heartbeatSequence", "state",
  ], "last observation");
  text(value.observationId, "last observation ID");
  digest(value.observationDigest, "last observation digest");
  instant(value.observedAt, "last observation instant");
  text(value.sourceRevision, "last source revision");
  nonnegativeInteger(value.generation, "last generation");
  nonnegativeInteger(value.heartbeatSequence, "last heartbeat sequence");
  text(value.state, "last state");
  return freeze(structuredClone(value));
}
function normalizeResumeSignal(value, checkpointValue, policy) {
  if (value === null) return null;
  exact(value, [
    "schema", "monitorId", "requestDigest", "subjectId", "identityDigest", "targetState",
    "minimumGeneration", "minimumHeartbeatSequence", "observedState", "observedGeneration",
    "observedHeartbeatSequence", "observationDigest", "issuedAt", "purpose",
    "mutationAuthority", "signalKey",
  ], "resume signal");
  text(value.subjectId, "resume subject");
  digest(value.identityDigest, "resume identity");
  text(value.targetState, "resume target state");
  nonnegativeInteger(value.minimumGeneration, "resume minimum generation");
  nonnegativeInteger(value.minimumHeartbeatSequence, "resume minimum heartbeat sequence");
  text(value.observedState, "resume observed state");
  nonnegativeInteger(value.observedGeneration, "resume observed generation");
  nonnegativeInteger(value.observedHeartbeatSequence, "resume observed heartbeat sequence");
  digest(value.observationDigest, "resume observation digest");
  instant(value.issuedAt, "resume issue instant");
  if (value.schema !== LIFECYCLE_MONITOR_RESUME_SIGNAL_SCHEMA
    || value.monitorId !== checkpointValue.monitorId
    || value.requestDigest !== checkpointValue.requestDigest
    || value.observationDigest !== checkpointValue.lastObservation?.observationDigest
    || value.observedState !== checkpointValue.lastObservation?.state
    || value.observedGeneration !== checkpointValue.lastObservation?.generation
    || value.observedHeartbeatSequence !== checkpointValue.lastObservation?.heartbeatSequence
    || value.issuedAt !== checkpointValue.evaluatedAt
    || value.purpose !== "wake-and-revalidate"
    || value.mutationAuthority !== false) invalid("resume signal binding");
  if (policy && (
    value.subjectId !== policy.subject.subjectId
    || value.identityDigest !== policy.subject.identityDigest
    || value.targetState !== policy.target.state
    || value.minimumGeneration !== policy.target.minimumGeneration
    || value.minimumHeartbeatSequence !== policy.target.minimumHeartbeatSequence
    || value.observedState !== policy.target.state
    || value.observedGeneration < policy.target.minimumGeneration
    || value.observedHeartbeatSequence < policy.target.minimumHeartbeatSequence
  )) invalid("resume signal request binding");
  const { signalKey, ...core } = value;
  if (digestValue(core) !== signalKey) invalid("resume signal digest");
  return freeze(structuredClone(value));
}
function projectObservation(value, observationDigest) {
  return freeze({
    observationId: value.observationId,
    observationDigest,
    observedAt: value.observedAt,
    sourceRevision: value.sourceRevision,
    generation: value.generation,
    heartbeatSequence: value.heartbeatSequence,
    state: value.state,
  });
}
function addMilliseconds(value, milliseconds) { return new Date(Date.parse(value) + milliseconds).toISOString(); }
function withoutSchema(value) {
  const { schema: _schema, ...rest } = value;
  return rest;
}
export function digestValue(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label);
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()
    || value.includes("\0") || value.length > 512) invalid(label);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(label);
  return value;
}
function nullableDigest(value, label) { return value === null ? null : digest(value, label); }
function instant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function nullableInstant(value, label) { return value === null ? null : instant(value, label); }
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function nullableNonnegativeInteger(value, label) {
  return value === null ? null : nonnegativeInteger(value, label);
}
function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label);
  return value;
}
function nullableBoundedInteger(value, minimum, maximum, label) {
  return value === null ? null : boundedInteger(value, minimum, maximum, label);
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Lifecycle monitor ${label} is invalid.`); }
