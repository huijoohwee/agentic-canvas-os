// Responsibility: Deterministically plan an effect-free, dependency-aware sprint.
import { createHash } from "node:crypto";

export const SPRINT_PLAN_SCHEMA = "agentic-sprint-plan/v1";
export const SPRINT_RECEIPT_SCHEMA = "agentic-sprint-receipt/v1";
export const MERGE_TRAIN_VALIDATION_SCHEMA = "agentic-merge-train-fence-validation/v1";

const PROFILES = new Set(["standalone", "fork", "enrolled"]);
const MAX_UNITS = 128;
const MAX_TEXT = 512;
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export const FIXED_CONVERGENCE_POLICY = deepFreeze({
  sourceMutation: false,
  gitMutation: false,
  network: false,
  providerMutation: false,
  dispatch: false,
  onCanonicalAdvance: "validate-descendant-or-wait",
  conflictOwnership: "source-owner-once",
  downstreamRewrite: false,
});

export function canonicalStringify(value) {
  const active = new WeakSet();
  const visit = (candidate, location) => {
    if (candidate === null) return "null";
    if (typeof candidate === "string" || typeof candidate === "boolean") {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) invalid(`non-finite number at ${location}`);
      return JSON.stringify(Object.is(candidate, -0) ? 0 : candidate);
    }
    if (typeof candidate !== "object") invalid(`unsupported value at ${location}`);
    if (active.has(candidate)) invalid(`cyclic value at ${location}`);
    active.add(candidate);
    let serialized;
    if (Array.isArray(candidate)) {
      serialized = `[${candidate.map((item, index) => visit(item, `${location}[${index}]`)).join(",")}]`;
    } else {
      requireRecord(candidate, `canonical object at ${location}`);
      const keys = Object.keys(candidate).sort();
      serialized = `{${keys.map(key => `${JSON.stringify(key)}:${visit(candidate[key], `${location}.${key}`)}`).join(",")}}`;
    }
    active.delete(candidate);
    return serialized;
  };
  return visit(value, "$");
}

export function sha256(value) {
  const bytes = typeof value === "string" ? value : canonicalStringify(value);
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export function normalizePlan(source) {
  requireRecord(source, "sprint plan");
  exactKeys(source, ["schema", "profile", "sprint", "units"], ["mergeTrain"], "sprint plan");
  if (source.schema !== SPRINT_PLAN_SCHEMA) invalid("sprint plan schema");
  const profile = requiredText(source.profile, "profile");
  if (!PROFILES.has(profile)) invalid("profile");
  const sprint = normalizeSprint(source.sprint);
  if (!Array.isArray(source.units) || source.units.length < 1 || source.units.length > MAX_UNITS) {
    invalid("units");
  }
  const units = source.units.map(normalizeUnit).sort(compareById);
  const unitById = uniqueMap(units, "unit");
  assertUnique(units.map(unit => unit.immutableHead.ref), "immutable head ref");
  for (const unit of units) {
    for (const dependency of unit.dependsOn) {
      if (!unitById.has(dependency)) invalid(`missing dependency ${dependency} for unit ${unit.id}`);
      if (dependency === unit.id) invalid(`self dependency for unit ${unit.id}`);
    }
  }
  assertAcyclic(units, unitById);
  const mergeTrain = source.mergeTrain === undefined
    ? undefined
    : normalizeMergeTrain(source.mergeTrain, unitById);
  return deepFreeze({
    schema: SPRINT_PLAN_SCHEMA,
    profile,
    sprint,
    units,
    ...(mergeTrain ? { mergeTrain } : {}),
  });
}

export function planSprint(source, options = {}) {
  const plan = normalizePlan(source);
  requireRecord(options, "planning options");
  exactKeys(options, [], ["observedMergeTrain"], "planning options");
  if (options.observedMergeTrain !== undefined && !plan.mergeTrain) {
    invalid("observed merge train without an expected fence");
  }
  const waves = buildWaves(plan.units);
  const economics = estimateEconomics(plan, waves);
  const mergeTrainEvidence = plan.mergeTrain
    ? (options.observedMergeTrain === undefined
      ? plan.mergeTrain
      : buildMergeTrainEvidence(plan.mergeTrain, options.observedMergeTrain))
    : undefined;
  const core = {
    schema: SPRINT_RECEIPT_SCHEMA,
    planDigest: sha256(canonicalStringify(plan)),
    profile: plan.profile,
    sprint: plan.sprint,
    waves,
    economics,
    convergence: FIXED_CONVERGENCE_POLICY,
    ...(mergeTrainEvidence ? { mergeTrainEvidence } : {}),
  };
  return deepFreeze({ ...core, receiptDigest: sha256(canonicalStringify(core)) });
}

export function validateMergeTrainFence(expected, observed) {
  const normalizedExpected = normalizeMergeTrain(expected);
  let normalizedObserved;
  try {
    normalizedObserved = normalizeMergeTrain(observed);
  } catch (error) {
    return deepFreeze(fenceResult({
      valid: false,
      expected: normalizedExpected,
      observed: null,
      drift: ["observed-fence-invalid"],
      reason: messageOf(error),
    }));
  }
  const drift = mergeTrainDrift(normalizedExpected, normalizedObserved);
  return deepFreeze(fenceResult({
    valid: drift.length === 0,
    expected: normalizedExpected,
    observed: normalizedObserved,
    drift,
  }));
}

export function demoPlan() {
  const digestA = sha256("evidence:foundation");
  const digestB = sha256("evidence:value");
  return deepFreeze({
    schema: SPRINT_PLAN_SCHEMA,
    profile: "standalone",
    sprint: { id: "bounded-value-sprint", timeboxMinutes: 60 },
    units: [
      {
        id: "foundation",
        paths: ["src/foundation"],
        dependsOn: [],
        immutableHead: { ref: "refs/sprint/foundation", sha: "1".repeat(40) },
        estimatedMinutes: 12,
        estimatedTokens: 1800,
        evidenceDigests: [digestA],
      },
      {
        id: "independent-proof",
        paths: ["tests/independent"],
        dependsOn: [],
        immutableHead: { ref: "refs/sprint/independent-proof", sha: "2".repeat(40) },
        estimatedMinutes: 8,
        estimatedTokens: 900,
        evidenceDigests: [digestA],
      },
      {
        id: "next-value",
        paths: ["src/value"],
        dependsOn: ["foundation"],
        immutableHead: { ref: "refs/sprint/next-value", sha: "3".repeat(40) },
        estimatedMinutes: 16,
        estimatedTokens: 2400,
        evidenceDigests: [digestB],
      },
    ],
  });
}

function normalizeSprint(value) {
  requireRecord(value, "sprint");
  exactKeys(value, ["id", "timeboxMinutes"], [], "sprint");
  return deepFreeze({
    id: requiredText(value.id, "sprint id"),
    timeboxMinutes: positiveInteger(value.timeboxMinutes, "sprint timeboxMinutes"),
  });
}

function normalizeUnit(value) {
  requireRecord(value, "unit");
  exactKeys(value,
    ["id", "paths", "dependsOn", "immutableHead", "estimatedMinutes", "estimatedTokens"],
    ["evidenceDigests"], "unit");
  const id = requiredText(value.id, "unit id");
  const paths = uniqueArray(value.paths, normalizePath, `paths for unit ${id}`).sort();
  if (paths.length === 0) invalid(`paths for unit ${id}`);
  const dependsOn = uniqueArray(value.dependsOn, item => requiredText(item, "dependency id"),
    `dependencies for unit ${id}`).sort();
  const evidenceDigests = uniqueArray(value.evidenceDigests ?? [],
    item => digest(item, "evidence digest"), `evidence digests for unit ${id}`).sort();
  return deepFreeze({
    id,
    paths,
    dependsOn,
    immutableHead: normalizeImmutableHead(value.immutableHead),
    estimatedMinutes: positiveInteger(value.estimatedMinutes, `estimatedMinutes for unit ${id}`),
    estimatedTokens: nonnegativeInteger(value.estimatedTokens, `estimatedTokens for unit ${id}`),
    evidenceDigests,
  });
}

function normalizeImmutableHead(value) {
  requireRecord(value, "immutable head");
  exactKeys(value, ["ref", "sha"], [], "immutable head");
  const ref = requiredText(value.ref, "immutable head ref");
  if (!ref.startsWith("refs/") || /(?:\.\.|@\{|[\s~^:?*\[\\]|\/$)/u.test(ref)) {
    invalid("immutable head ref");
  }
  return deepFreeze({ ref, sha: commitSha(value.sha, "immutable head sha") });
}

function normalizeMergeTrain(value, unitById) {
  requireRecord(value, "merge train fence");
  exactKeys(value,
    ["queueId", "baseRef", "baseSha", "mergeHeadRef", "mergeHeadSha", "rebuildId", "members"],
    [], "merge train fence");
  if (!Array.isArray(value.members) || value.members.length === 0 || value.members.length > MAX_UNITS) {
    invalid("merge train members");
  }
  const members = value.members.map(normalizeMergeTrainMember);
  assertUnique(members.map(member => member.id), "merge train member id");
  if (unitById) {
    const memberIndex = new Map(members.map((member, index) => [member.id, index]));
    for (const member of members) {
      const unit = unitById.get(member.id);
      if (!unit) invalid(`merge train member ${member.id}`);
      if (unit.immutableHead.sha !== member.reviewedHeadSha) {
        invalid(`reviewed head for merge train member ${member.id}`);
      }
      for (const dependency of unit.dependsOn) {
        if (memberIndex.has(dependency) && memberIndex.get(dependency) > memberIndex.get(member.id)) {
          invalid(`merge train dependency order for member ${member.id}`);
        }
      }
    }
  }
  return deepFreeze({
    queueId: requiredText(value.queueId, "merge train queueId"),
    baseRef: fullRef(value.baseRef, "merge train baseRef"),
    baseSha: commitSha(value.baseSha, "merge train baseSha"),
    mergeHeadRef: fullRef(value.mergeHeadRef, "merge train mergeHeadRef"),
    mergeHeadSha: commitSha(value.mergeHeadSha, "merge train mergeHeadSha"),
    rebuildId: requiredText(value.rebuildId, "merge train rebuildId"),
    members,
  });
}

function normalizeMergeTrainMember(value) {
  requireRecord(value, "merge train member");
  exactKeys(value, ["id", "reviewedHeadSha", "evidenceDigest"], [], "merge train member");
  return deepFreeze({
    id: requiredText(value.id, "merge train member id"),
    reviewedHeadSha: commitSha(value.reviewedHeadSha, "merge train reviewedHeadSha"),
    evidenceDigest: digest(value.evidenceDigest, "merge train evidenceDigest"),
  });
}

function buildWaves(units) {
  const complete = new Set();
  const remaining = new Set(units.map(unit => unit.id));
  const waves = [];
  while (remaining.size > 0) {
    const eligible = units.filter(unit => remaining.has(unit.id)
      && unit.dependsOn.every(dependency => complete.has(dependency)));
    if (eligible.length === 0) invalid("dependency cycle");
    const selected = [];
    for (const unit of eligible) {
      if (selected.every(peer => pathsAreDisjoint(unit.paths, peer.paths))) selected.push(unit);
    }
    waves.push(deepFreeze({ index: waves.length, unitIds: selected.map(unit => unit.id) }));
    for (const unit of selected) {
      remaining.delete(unit.id);
      complete.add(unit.id);
    }
  }
  return deepFreeze(waves);
}

function estimateEconomics(plan, waves) {
  const byId = new Map(plan.units.map(unit => [unit.id, unit]));
  const plannedTokens = plan.units.reduce((total, unit) => total + unit.estimatedTokens, 0);
  const criticalPathMinutes = waves.reduce((total, wave) => total
    + Math.max(...wave.unitIds.map(id => byId.get(id).estimatedMinutes)), 0);
  const timeToNextValueMinutes = Math.min(...waves[0].unitIds.map(id => byId.get(id).estimatedMinutes));
  const evidence = plan.units.flatMap(unit => unit.evidenceDigests);
  if (plan.mergeTrain) evidence.push(...plan.mergeTrain.members.map(member => member.evidenceDigest));
  const reusedEvidence = evidence.length - new Set(evidence).size;
  const avoidedRestacks = plan.units.filter(unit => unit.dependsOn.length > 0).length;
  const avoidedConflictResolutions = countOverlappingPairs(plan.units);
  return deepFreeze({
    plannedUnits: plan.units.length,
    waveCount: waves.length,
    plannedTokens,
    criticalPathMinutes,
    timeToNextValueMinutes,
    estimatedVelocityUnitsPerHour: roundedRate(plan.units.length * 60, criticalPathMinutes),
    estimatedTokensPerUnit: roundedRate(plannedTokens, plan.units.length),
    estimatedTokensPerMinute: roundedRate(plannedTokens, criticalPathMinutes),
    reusedEvidence,
    avoidedRestacks,
    avoidedConflictResolutions,
    estimatesOnly: true,
    withinTimebox: criticalPathMinutes <= plan.sprint.timeboxMinutes,
  });
}

function buildMergeTrainEvidence(expected, observed) {
  const fenceDigest = sha256(canonicalStringify(expected));
  const binding = {
    schema: "agentic-merge-train-evidence/v1",
    fenceDigest,
    queueId: expected.queueId,
    base: { ref: expected.baseRef, sha: expected.baseSha },
    mergeHead: { ref: expected.mergeHeadRef, sha: expected.mergeHeadSha },
    rebuildId: expected.rebuildId,
    orderedMemberIds: expected.members.map(member => member.id),
    reviewedHeads: expected.members.map(member => member.reviewedHeadSha),
    evidenceDigests: expected.members.map(member => member.evidenceDigest),
  };
  if (observed === undefined) return deepFreeze({ ...binding, queueEvidence: "recorded" });
  return deepFreeze({ ...binding, validation: validateMergeTrainFence(expected, observed) });
}

function mergeTrainDrift(expected, observed) {
  const drift = [];
  for (const key of ["queueId", "baseRef", "baseSha", "mergeHeadRef", "mergeHeadSha", "rebuildId"]) {
    if (expected[key] !== observed[key]) drift.push(key);
  }
  if (expected.members.length !== observed.members.length) drift.push("members.length");
  const length = Math.max(expected.members.length, observed.members.length);
  for (let index = 0; index < length; index += 1) {
    const left = expected.members[index];
    const right = observed.members[index];
    if (!left || !right) continue;
    for (const key of ["id", "reviewedHeadSha", "evidenceDigest"]) {
      if (left[key] !== right[key]) drift.push(`members[${index}].${key}`);
    }
  }
  return drift;
}

function fenceResult({ valid, expected, observed, drift, reason }) {
  return {
    schema: MERGE_TRAIN_VALIDATION_SCHEMA,
    valid,
    queueEvidence: valid ? "valid" : "invalidated",
    invalidation: valid ? "none" : "merge-train-evidence-only",
    authoredWork: "preserved",
    expectedFenceDigest: sha256(canonicalStringify(expected)),
    observedFenceDigest: observed ? sha256(canonicalStringify(observed)) : null,
    drift,
    ...(reason ? { reason } : {}),
  };
}

function assertAcyclic(units, unitById) {
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) invalid(`dependency cycle at unit ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of unitById.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.id);
}

function pathsAreDisjoint(left, right) {
  return !left.some(leftPath => right.some(rightPath => pathOverlaps(leftPath, rightPath)));
}

function countOverlappingPairs(units) {
  let count = 0;
  for (let left = 0; left < units.length; left += 1) {
    for (let right = left + 1; right < units.length; right += 1) {
      if (!pathsAreDisjoint(units[left].paths, units[right].paths)) count += 1;
    }
  }
  return count;
}

function pathOverlaps(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function normalizePath(value) {
  const result = requiredText(value, "unit path");
  if (result.startsWith("/") || result.includes("\\") || result.endsWith("/")
    || result.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    invalid("unit path");
  }
  return result;
}

function uniqueArray(value, normalize, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = value.map(normalize);
  if (new Set(result).size !== result.length) invalid(`duplicate ${label}`);
  return result;
}

function uniqueMap(values, label) {
  const result = new Map();
  for (const value of values) {
    if (result.has(value.id)) invalid(`duplicate ${label} id ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) invalid(`duplicate ${label}`);
}

function fullRef(value, label) {
  const result = requiredText(value, label);
  if (!result.startsWith("refs/") || /(?:\.\.|@\{|[\s~^:?*\[\\]|\/$)/u.test(result)) invalid(label);
  return result;
}

function commitSha(value, label) {
  const result = requiredText(value, label).toLowerCase();
  if (!SHA_PATTERN.test(result)) invalid(label);
  return result;
}

function digest(value, label) {
  const result = requiredText(value, label).toLowerCase();
  if (!DIGEST_PATTERN.test(result)) invalid(label);
  return result;
}

function requiredText(value, label) {
  if (typeof value !== "string") invalid(label);
  const result = value.trim();
  if (!result || result.length > MAX_TEXT || /[\u0000-\u001f\u007f]/u.test(result)) invalid(label);
  return result;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

function exactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.has(key))) invalid(`${label} fields`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
}

function compareById(left, right) { return left.id.localeCompare(right.id); }
function roundedRate(numerator, denominator) { return Number((numerator / denominator).toFixed(2)); }
function messageOf(error) { return String(error?.message || error).slice(0, 500); }
function invalid(label) { throw new Error(`Sprint harness has invalid ${label}.`); }

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
