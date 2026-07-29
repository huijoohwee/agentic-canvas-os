import { createHash } from "node:crypto";

export const UPSTREAM_ADMISSION_SCHEMA = "agentic-upstream-dependency-admission-result/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_STATES = new Set(["protected", "candidate", "local-only", "missing"]);
const CHECK_STATES = new Set(["pass", "fail", "missing"]);
const FALLBACK_TYPES = new Set(["defer", "omit", "protected-equivalent"]);

export function evaluateUpstreamDependencies(input) {
  requireExact(
    input,
    ["evaluationTime", "units", "dependencies", "requestedPlanStop"],
    "upstream admission input",
  );
  const evaluationTime = requireInstant(input.evaluationTime, "evaluationTime");
  if (typeof input.requestedPlanStop !== "boolean") {
    throw new Error("requestedPlanStop must be boolean.");
  }

  const units = normalizeUnits(input.units);
  const unitIds = new Set(units.map((unit) => unit.unitId));
  const dependencies = normalizeDependencies(input.dependencies, unitIds);
  const overlappingOwners = findOverlappingOwners(dependencies);
  const decisions = dependencies.map((dependency) => evaluateDependency(
    dependency,
    evaluationTime,
    units,
    overlappingOwners,
  ));

  const waitingUnits = sortedUnique(decisions.flatMap((decision) => decision.waitingUnits));
  const omittedUnits = sortedUnique(decisions.flatMap((decision) => decision.omittedUnits));
  const unavailableUnits = new Set([...waitingUnits, ...omittedUnits]);
  const readyUnits = units
    .map((unit) => unit.unitId)
    .filter((unitId) => !unavailableUnits.has(unitId))
    .sort(compareText);
  const findings = decisions.flatMap((decision) => decision.findings);
  if (input.requestedPlanStop && readyUnits.length > 0) {
    findings.push(createFinding({
      dependencyId: "plan",
      type: "upstream-plan-overblocked",
      severity: "major",
      consumers: readyUnits,
      observed: "plan-wide stop requested while disjoint units remain",
      expected: "continue units outside unavailable consumer closures",
    }));
  }

  const result = {
    schema: UPSTREAM_ADMISSION_SCHEMA,
    evaluationTime: input.evaluationTime,
    decisions: decisions.map(({ findings: _findings, ...decision }) => decision),
    waitingUnits,
    omittedUnits,
    readyUnits,
    nextEvaluationAt: earliestInstant(
      decisions.map((decision) => decision.nextEvaluationAt).filter(Boolean),
    ),
    findings: findings.sort(compareFinding),
  };
  return deepFreeze({ ...result, evidenceDigest: digest(result) });
}

function evaluateDependency(dependency, evaluationTime, units, overlappingOwners) {
  const findings = [];
  const consumerClosure = deriveConsumerClosure(dependency.consumers, units);
  const ownerAmbiguous = dependency.sourceState === "missing"
    ? dependency.owners.length !== 0
    : dependency.owners.length !== 1 || overlappingOwners.has(dependency.dependencyId);
  if (ownerAmbiguous) {
    findings.push(createFinding({
      dependencyId: dependency.dependencyId,
      type: "upstream-owner-ambiguous",
      severity: "blocker",
      consumers: consumerClosure,
      observed: `${dependency.owners.length} admissible owners or an overlapping owner scope`,
      expected: "one registered owner and one non-overlapping scope",
    }));
  }

  const evidenceStale = dependency.sourceState !== "missing" && (
    dependency.evidenceRevision !== dependency.sourceRevision ||
    dependency.requiredChecks.some((check) => check.status !== "pass")
  );
  if (evidenceStale) {
    findings.push(createFinding({
      dependencyId: dependency.dependencyId,
      type: "upstream-evidence-stale",
      severity: "blocker",
      consumers: consumerClosure,
      observed: "source revision and named-check evidence do not join",
      expected: "current source revision with complete passing named checks",
    }));
  }

  const projectionPremature = dependency.projectionRequested &&
    dependency.sourceState !== "protected";
  if (projectionPremature) {
    findings.push(createFinding({
      dependencyId: dependency.dependencyId,
      type: "upstream-projection-premature",
      severity: "blocker",
      consumers: consumerClosure,
      observed: `projection requested from ${dependency.sourceState} source`,
      expected: "projection from an eligible protected source revision",
    }));
  }

  const fallbackInvalid = dependency.sourceState === "candidate" &&
    dependency.fallback.type === "protected-equivalent" &&
    dependency.fallback.sourceRevision === dependency.sourceRevision;
  if (fallbackInvalid) {
    findings.push(createFinding({
      dependencyId: dependency.dependencyId,
      type: "upstream-fallback-invalid",
      severity: "major",
      consumers: consumerClosure,
      observed: "protected-equivalent fallback reuses the unprotected candidate revision",
      expected: "a distinct already protected equivalent revision",
    }));
  }

  const commonBlocked = ownerAmbiguous || evidenceStale || projectionPremature || fallbackInvalid;
  if (dependency.sourceState === "protected" && !commonBlocked) {
    return decision(dependency, "eligible", [], [], null, null, findings);
  }

  if (dependency.sourceState === "candidate" && !commonBlocked) {
    const deadline = Date.parse(dependency.decisionDeadline);
    if (deadline > evaluationTime) {
      return decision(
        dependency,
        "deferred",
        consumerClosure,
        [],
        dependency.decisionDeadline,
        null,
        findings,
      );
    }
    if (dependency.fallback.type === "protected-equivalent") {
      return decision(
        dependency,
        "superseded",
        [],
        [],
        null,
        "protected-equivalent",
        findings,
      );
    }
    if (dependency.fallback.type === "omit") {
      findings.push(unadmittedFinding(dependency, consumerClosure, "candidate deadline elapsed"));
      return decision(
        dependency,
        "blocked",
        [],
        consumerClosure,
        null,
        "omit",
        findings,
      );
    }
    findings.push(createFinding({
      dependencyId: dependency.dependencyId,
      type: "upstream-wait-unbounded",
      severity: "blocker",
      consumers: consumerClosure,
      observed: "candidate deadline elapsed with defer fallback",
      expected: "omit, protected equivalent, or an explicit blocked result",
    }));
    return decision(dependency, "blocked", consumerClosure, [], null, null, findings);
  }

  findings.push(unadmittedFinding(
    dependency,
    consumerClosure,
    `${dependency.sourceState} source is not eligible`,
  ));
  return decision(dependency, "blocked", consumerClosure, [], null, null, findings);
}

function decision(
  dependency,
  status,
  waitingUnits,
  omittedUnits,
  nextEvaluationAt,
  fallbackApplied,
  findings,
) {
  return {
    dependencyId: dependency.dependencyId,
    sourceRevision: dependency.sourceRevision,
    status,
    waitingUnits,
    omittedUnits,
    nextEvaluationAt,
    fallbackApplied,
    findings,
  };
}

function unadmittedFinding(dependency, consumers, observed) {
  return createFinding({
    dependencyId: dependency.dependencyId,
    type: "upstream-source-unadmitted",
    severity: "blocker",
    consumers,
    observed,
    expected: "protected source with joined ownership, closure, and check evidence",
  });
}

function normalizeUnits(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("units must contain at least one unit.");
  }
  const units = input.map((unit) => {
    requireExact(unit, ["unitId", "dependencies"], "plan unit");
    requireText(unit.unitId, "unitId");
    requireTextArray(unit.dependencies, "dependencies", { allowEmpty: true });
    return {
      unitId: unit.unitId,
      dependencies: sortedUnique(unit.dependencies),
    };
  }).sort((left, right) => compareText(left.unitId, right.unitId));
  requireUnique(units.map((unit) => unit.unitId), "unitId");
  const unitIds = new Set(units.map((unit) => unit.unitId));
  for (const unit of units) {
    for (const dependency of unit.dependencies) {
      if (!unitIds.has(dependency)) {
        throw new Error(`Unknown plan dependency ${dependency} for ${unit.unitId}.`);
      }
      if (dependency === unit.unitId) {
        throw new Error(`Unit ${unit.unitId} cannot depend on itself.`);
      }
    }
  }
  assertAcyclic(units);
  return units;
}

function normalizeDependencies(input, unitIds) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("dependencies must contain at least one admission record.");
  }
  const dependencies = input.map((dependency) => {
    requireExact(dependency, [
      "dependencyId",
      "capabilityId",
      "sourceRevision",
      "sourceState",
      "owners",
      "closureDigest",
      "evidenceRevision",
      "requiredChecks",
      "consumers",
      "decisionDeadline",
      "fallback",
      "projectionRequested",
    ], "dependency admission record");
    requireText(dependency.dependencyId, "dependencyId");
    requireText(dependency.capabilityId, "capabilityId");
    if (!SOURCE_STATES.has(dependency.sourceState)) {
      throw new Error(`Unsupported sourceState ${dependency.sourceState}.`);
    }
    if (typeof dependency.projectionRequested !== "boolean") {
      throw new Error("projectionRequested must be boolean.");
    }
    const owners = normalizeOwners(dependency.owners);
    const requiredChecks = normalizeChecks(dependency.requiredChecks);
    requireTextArray(dependency.consumers, "consumers", { allowEmpty: false });
    const consumers = sortedUnique(dependency.consumers);
    for (const consumer of consumers) {
      if (!unitIds.has(consumer)) throw new Error(`Unknown consumer ${consumer}.`);
    }
    requireInstant(dependency.decisionDeadline, "decisionDeadline");
    const fallback = normalizeFallback(dependency.fallback);
    if (dependency.sourceState === "missing") {
      for (const field of ["sourceRevision", "closureDigest", "evidenceRevision"]) {
        if (dependency[field] !== null) throw new Error(`Missing source requires null ${field}.`);
      }
    } else {
      requireRevision(dependency.sourceRevision, "sourceRevision");
      requireDigest(dependency.closureDigest, "closureDigest");
      requireRevision(dependency.evidenceRevision, "evidenceRevision");
    }
    return {
      ...dependency,
      owners,
      requiredChecks,
      consumers,
      fallback,
    };
  }).sort((left, right) => compareText(left.dependencyId, right.dependencyId));
  requireUnique(dependencies.map((dependency) => dependency.dependencyId), "dependencyId");
  return dependencies;
}

function normalizeOwners(input) {
  if (!Array.isArray(input)) throw new Error("owners must be an array.");
  return input.map((owner) => {
    requireExact(owner, ["ownerId", "scopeId", "fenceRevision"], "dependency owner");
    requireText(owner.ownerId, "ownerId");
    requireText(owner.scopeId, "scopeId");
    requireRevision(owner.fenceRevision, "fenceRevision");
    return { ...owner };
  }).sort((left, right) => (
    compareText(left.scopeId, right.scopeId) || compareText(left.ownerId, right.ownerId)
  ));
}

function normalizeChecks(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("requiredChecks must contain at least one named check.");
  }
  const checks = input.map((check) => {
    requireExact(check, ["name", "status"], "named check");
    requireText(check.name, "check.name");
    if (!CHECK_STATES.has(check.status)) throw new Error(`Unsupported check status ${check.status}.`);
    return { ...check };
  }).sort((left, right) => compareText(left.name, right.name));
  requireUnique(checks.map((check) => check.name), "check name");
  return checks;
}

function normalizeFallback(fallback) {
  requireExact(
    fallback,
    ["type", "capabilityId", "sourceRevision", "evidenceDigest"],
    "fallback",
  );
  if (!FALLBACK_TYPES.has(fallback.type)) {
    throw new Error(`Unsupported fallback type ${fallback.type}.`);
  }
  if (fallback.type === "protected-equivalent") {
    requireText(fallback.capabilityId, "fallback.capabilityId");
    requireRevision(fallback.sourceRevision, "fallback.sourceRevision");
    requireDigest(fallback.evidenceDigest, "fallback.evidenceDigest");
  } else if (
    fallback.capabilityId !== null ||
    fallback.sourceRevision !== null ||
    fallback.evidenceDigest !== null
  ) {
    throw new Error(`${fallback.type} fallback cannot carry equivalent-source evidence.`);
  }
  return { ...fallback };
}

function findOverlappingOwners(dependencies) {
  const byScope = new Map();
  for (const dependency of dependencies) {
    for (const owner of dependency.owners) {
      const entries = byScope.get(owner.scopeId) || [];
      entries.push({ dependencyId: dependency.dependencyId, ownerId: owner.ownerId });
      byScope.set(owner.scopeId, entries);
    }
  }
  const overlaps = new Set();
  for (const entries of byScope.values()) {
    if (new Set(entries.map((entry) => entry.ownerId)).size <= 1) continue;
    entries.forEach((entry) => overlaps.add(entry.dependencyId));
  }
  return overlaps;
}

function deriveConsumerClosure(consumers, units) {
  const reverseEdges = new Map(units.map((unit) => [unit.unitId, []]));
  for (const unit of units) {
    for (const dependency of unit.dependencies) reverseEdges.get(dependency).push(unit.unitId);
  }
  const closure = new Set(consumers);
  const queue = [...consumers];
  while (queue.length > 0) {
    for (const dependent of reverseEdges.get(queue.shift()) || []) {
      if (closure.has(dependent)) continue;
      closure.add(dependent);
      queue.push(dependent);
    }
  }
  return [...closure].sort(compareText);
}

function assertAcyclic(units) {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const visiting = new Set();
  const visited = new Set();
  function visit(unitId) {
    if (visiting.has(unitId)) throw new Error(`Plan dependency cycle includes ${unitId}.`);
    if (visited.has(unitId)) return;
    visiting.add(unitId);
    byId.get(unitId).dependencies.forEach(visit);
    visiting.delete(unitId);
    visited.add(unitId);
  }
  units.forEach((unit) => visit(unit.unitId));
}

function createFinding({ dependencyId, type, severity, consumers, observed, expected }) {
  return { dependencyId, type, severity, consumers, observed, expected };
}

function compareFinding(left, right) {
  return compareText(left.dependencyId, right.dependencyId) ||
    compareText(left.type, right.type);
}

function earliestInstant(instants) {
  return instants.length === 0 ? null : [...instants].sort(compareText)[0];
}

function requireExact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be non-empty trimmed text.`);
  }
}

function requireTextArray(value, label, { allowEmpty }) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  }
  value.forEach((entry) => requireText(entry, label));
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} values must be unique.`);
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value))) throw new Error(`${label} must be a SHA-256 digest.`);
}

function requireRevision(value, label) {
  if (!REVISION_PATTERN.test(String(value))) throw new Error(`${label} must be a 40-character revision.`);
}

function requireInstant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 instant.`);
  }
  return Date.parse(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function compareText(left, right) {
  return left.localeCompare(right);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
