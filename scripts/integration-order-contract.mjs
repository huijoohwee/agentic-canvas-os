import { createHash } from "node:crypto";
import { normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";

export const INTEGRATION_PLAN_SCHEMA = "agentic-integration-order-plan/v1";
export const RELEASE_FRONTIER_SCHEMA = "agentic-release-frontier/v1";
export const CROSS_REPOSITORY_TASK_SCHEMA = "agentic-cross-repository-coordination-task/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const UNIT_KINDS = new Set(["control", "contract", "source", "consumer", "projection"]);
const SUCCESS_STATES = new Set(["already-integrated", "superseded", "integrated"]);
const UNIT_STATES = new Set(["pending", ...SUCCESS_STATES, "blocked"]);

export function createIntegrationPlan(input) {
  requireExact(input, ["frontierRevision", "dependencyClosureDigest", "units"], "integration plan input");
  requireText(input.frontierRevision, "frontierRevision");
  requireDigest(input.dependencyClosureDigest, "dependencyClosureDigest");
  if (!Array.isArray(input.units) || input.units.length === 0) {
    throw new Error("Integration plan requires at least one unit.");
  }

  const units = input.units.map(normalizeUnit).sort(compareUnit);
  requireUnique(units.map((unit) => unit.unitId), "unitId");
  requireUnique(units.map((unit) => unit.changeDigest), "changeDigest");
  const unitIds = new Set(units.map((unit) => unit.unitId));
  for (const unit of units) {
    for (const dependency of unit.dependencies) {
      if (!unitIds.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${unit.unitId}.`);
      if (dependency === unit.unitId) throw new Error(`Unit ${unit.unitId} cannot depend on itself.`);
    }
  }
  assertAcyclic(units);

  return finalizePlan({
    schema: INTEGRATION_PLAN_SCHEMA,
    frontier: {
      revision: input.frontierRevision,
      dependencyClosureDigest: input.dependencyClosureDigest,
    },
    units,
  });
}

export function deriveIntegrationWaves(plan) {
  validatePlan(plan);
  return deriveWaves(plan.units);
}

function deriveWaves(planUnits) {
  const units = new Map(planUnits.map((unit) => [unit.unitId, unit]));
  const resolved = new Set(
    planUnits.filter((unit) => SUCCESS_STATES.has(unit.status)).map((unit) => unit.unitId),
  );
  const pending = new Set(
    planUnits.filter((unit) => unit.status === "pending").map((unit) => unit.unitId),
  );
  const waves = [];

  while (pending.size > 0) {
    const ready = [...pending]
      .map((unitId) => units.get(unitId))
      .filter((unit) => unit.dependencies.every((dependency) => resolved.has(dependency)))
      .sort(compareUnit);
    if (ready.length === 0) break;

    const wave = [];
    const occupiedScopes = [];
    for (const unit of ready) {
      if (occupiedScopes.some((scopes) => writeSetsOverlap(scopes, unit.writeScopes))) continue;
      wave.push(unit.unitId);
      occupiedScopes.push(unit.writeScopes);
    }
    if (wave.length === 0) throw new Error("Ready integration units could not form a disjoint wave.");
    waves.push(Object.freeze(wave));
    wave.forEach((unitId) => {
      pending.delete(unitId);
      resolved.add(unitId);
    });
  }
  return Object.freeze(waves);
}

export function createCrossRepositoryCoordinationTask(input) {
  requireExact(input, [
    "taskId", "semanticScope", "sourceGuideline", "units", "dependencyEdges",
  ], "cross-repository coordination task");
  requireText(input.taskId, "taskId");
  requireText(input.semanticScope, "semanticScope");
  const sourceGuideline = normalizeSourceGuideline(input.sourceGuideline);
  if (!Array.isArray(input.units) || input.units.length < 2) {
    throw new Error("Cross-repository coordination requires at least two repository units.");
  }
  const units = input.units.map((unit) => normalizeCoordinationUnit(unit, input.semanticScope))
    .sort(compareUnit);
  requireUnique(units.map((unit) => unit.unitId), "unitId");
  requireUnique(units.map((unit) => unit.worktree), "worktree");
  requireUnique(units.map((unit) => unit.claimId), "claimId");
  requireUnique(units.map((unit) => `${unit.repository}:${unit.branch}`), "repository branch");
  if (new Set(units.map((unit) => unit.repository)).size < 2) {
    throw new Error("Cross-repository coordination units must span at least two repositories.");
  }
  const sourceUnits = units.filter((unit) => (
    unit.repository === sourceGuideline.repository && unit.sourceRevision === sourceGuideline.revision
  ));
  if (sourceUnits.length !== 1) {
    throw new Error("Cross-repository coordination requires exactly one unit pinned to the source guideline revision.");
  }
  const unitIds = new Set(units.map((unit) => unit.unitId));
  const dependencyEdges = normalizeDependencyEdges(input.dependencyEdges, unitIds);
  const graphUnits = units.map((unit) => ({
    unitId: unit.unitId,
    dependencies: dependencyEdges.filter((edge) => edge.to === unit.unitId).map((edge) => edge.from),
  }));
  assertAcyclic(graphUnits);
  const core = {
    schema: CROSS_REPOSITORY_TASK_SCHEMA,
    taskId: input.taskId,
    semanticScope: input.semanticScope,
    sourceGuideline,
    units,
    dependencyEdges,
  };
  return deepFreeze({ ...core, taskDigest: digest(core) });
}

export function deriveCrossRepositoryWaves(task) {
  validateCoordinationTask(task);
  const dependencies = new Map(task.units.map((unit) => [
    unit.unitId,
    task.dependencyEdges.filter((edge) => edge.to === unit.unitId).map((edge) => edge.from),
  ]));
  const resolved = new Set();
  const pending = new Map(task.units.map((unit) => [unit.unitId, unit]));
  const waves = [];
  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter((unit) => dependencies.get(unit.unitId).every((dependency) => resolved.has(dependency)))
      .sort(compareUnit);
    if (ready.length === 0) throw new Error("Cross-repository dependency graph cannot make progress.");
    const wave = [];
    for (const unit of ready) {
      const collision = wave.some((unitId) => {
        const peer = pending.get(unitId);
        return peer.repository === unit.repository
          && writeSetsOverlap(peer.declaredWriteScope, unit.declaredWriteScope);
      });
      if (!collision) wave.push(unit.unitId);
    }
    waves.push(Object.freeze(wave));
    wave.forEach((unitId) => {
      pending.delete(unitId);
      resolved.add(unitId);
    });
  }
  return Object.freeze(waves);
}

function normalizeSourceGuideline(value) {
  requireExact(value, ["repository", "revision", "tree", "guidelineDigest", "companionDigest"], "source guideline");
  requireText(value.repository, "sourceGuideline.repository");
  requireGitRevision(value.revision, "sourceGuideline.revision");
  requireGitRevision(value.tree, "sourceGuideline.tree");
  requireDigest(value.guidelineDigest, "sourceGuideline.guidelineDigest");
  requireDigest(value.companionDigest, "sourceGuideline.companionDigest");
  return { ...value };
}

function normalizeCoordinationUnit(value, semanticScope) {
  requireExact(value, [
    "unitId", "repository", "repositoryId", "branch", "worktree", "semanticScope", "declaredWriteScope",
    "writeSetDigest", "claimId", "authorityEpoch", "fence", "pullRequest", "sourceRevision",
    "sourceDigest", "namedChecks", "handoffEvidenceDigest",
  ], "cross-repository coordination unit");
  for (const field of ["unitId", "repository", "repositoryId", "branch", "worktree", "semanticScope", "pullRequest"]) {
    requireText(value[field], field);
  }
  if (value.semanticScope !== semanticScope) throw new Error("Every repository unit must retain the task semantic scope.");
  const declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  requireDigest(value.writeSetDigest, "writeSetDigest");
  if (digest(declaredWriteScope) !== value.writeSetDigest) throw new Error("Repository unit writeSetDigest is stale.");
  requireDigest(value.claimId, "claimId");
  if (!Number.isSafeInteger(value.authorityEpoch) || value.authorityEpoch < 1) {
    throw new Error("authorityEpoch must be a positive integer.");
  }
  requireFence(value.fence, "fence");
  requireGitRevision(value.sourceRevision, "sourceRevision");
  requireDigest(value.sourceDigest, "sourceDigest");
  requireTextArray(value.namedChecks, "namedChecks", { allowEmpty: false });
  requireDigest(value.handoffEvidenceDigest, "handoffEvidenceDigest");
  return {
    ...value,
    declaredWriteScope,
    namedChecks: [...new Set(value.namedChecks)].sort(compareText),
  };
}

function normalizeDependencyEdges(value, unitIds) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Cross-repository coordination requires dependency edges.");
  }
  const edges = value.map((edge) => {
    requireExact(edge, ["from", "to"], "dependency edge");
    requireText(edge.from, "dependency edge from");
    requireText(edge.to, "dependency edge to");
    if (!unitIds.has(edge.from) || !unitIds.has(edge.to)) throw new Error("Dependency edge names an unknown unit.");
    if (edge.from === edge.to) throw new Error("Dependency edge cannot be self-referential.");
    return { from: edge.from, to: edge.to };
  }).sort((left, right) => compareText(`${left.from}:${left.to}`, `${right.from}:${right.to}`));
  requireUnique(edges.map((edge) => `${edge.from}:${edge.to}`), "dependency edge");
  return edges;
}

function validateCoordinationTask(task) {
  if (!task || task.schema !== CROSS_REPOSITORY_TASK_SCHEMA) throw new Error("Invalid cross-repository task schema.");
  requireExact(task, [
    "schema", "taskId", "semanticScope", "sourceGuideline", "units", "dependencyEdges", "taskDigest",
  ], "cross-repository coordination task");
  requireDigest(task.taskDigest, "taskDigest");
  const { taskDigest, ...unsigned } = task;
  if (digest(unsigned) !== taskDigest) throw new Error("Cross-repository task digest does not match its content.");
  const reconstructed = createCrossRepositoryCoordinationTask({
    taskId: task.taskId,
    semanticScope: task.semanticScope,
    sourceGuideline: task.sourceGuideline,
    units: task.units,
    dependencyEdges: task.dependencyEdges,
  });
  if (canonicalJson(reconstructed) !== canonicalJson(task)) {
    throw new Error("Cross-repository task is not in canonical constructor form.");
  }
}

export function recordCanonicalDisposition(plan, input) {
  validatePlan(plan);
  requireExact(input, [
    "unitId",
    "status",
    "baseFrontierRevision",
    "canonicalRevision",
    "equivalenceCheckDigest",
    "capabilityCoverageDigest",
  ], "canonical disposition");
  if (!["already-integrated", "superseded"].includes(input.status)) {
    throw new Error("Canonical disposition must be already-integrated or superseded.");
  }
  requireCurrentFrontier(plan, input.baseFrontierRevision);
  if (input.canonicalRevision !== plan.frontier.revision) {
    throw new Error("Canonical disposition must be evaluated against the current frontier.");
  }
  requireDigest(input.equivalenceCheckDigest, "equivalenceCheckDigest");
  if (input.status === "superseded") {
    requireDigest(input.capabilityCoverageDigest, "capabilityCoverageDigest");
  } else if (input.capabilityCoverageDigest !== null) {
    throw new Error("already-integrated disposition cannot carry capabilityCoverageDigest.");
  }

  const unit = requirePendingUnit(plan, input.unitId);
  requireSuccessfulDependencies(plan, unit);
  return replaceUnit(plan, unit.unitId, {
    status: input.status,
    evidence: {
      canonicalRevision: input.canonicalRevision,
      equivalenceCheckDigest: input.equivalenceCheckDigest,
      capabilityCoverageDigest: input.capabilityCoverageDigest,
    },
  });
}

export function recordProtectedIntegration(plan, input) {
  validatePlan(plan);
  requireExact(input, [
    "unitId",
    "baseFrontierRevision",
    "protectedRevision",
    "dependencyClosureDigest",
    "integrationReceiptDigest",
    "exactCanonicalChecksDigest",
    "runtimeConvergenceDigest",
  ], "protected integration");
  requireCurrentFrontier(plan, input.baseFrontierRevision);
  requireText(input.protectedRevision, "protectedRevision");
  if (input.protectedRevision === plan.frontier.revision) {
    throw new Error("Protected integration must advance the canonical frontier.");
  }
  for (const field of [
    "dependencyClosureDigest",
    "integrationReceiptDigest",
    "exactCanonicalChecksDigest",
  ]) {
    requireDigest(input[field], field);
  }

  const unit = requirePendingUnit(plan, input.unitId);
  requireSuccessfulDependencies(plan, unit);
  if (unit.runtimeImpact) {
    requireDigest(input.runtimeConvergenceDigest, "runtimeConvergenceDigest");
  } else if (input.runtimeConvergenceDigest !== null) {
    throw new Error("A unit without runtime impact cannot carry runtimeConvergenceDigest.");
  }

  return replaceUnit(plan, unit.unitId, {
    status: "integrated",
    evidence: {
      protectedRevision: input.protectedRevision,
      integrationReceiptDigest: input.integrationReceiptDigest,
      exactCanonicalChecksDigest: input.exactCanonicalChecksDigest,
      runtimeConvergenceDigest: input.runtimeConvergenceDigest,
    },
  }, {
    revision: input.protectedRevision,
    dependencyClosureDigest: input.dependencyClosureDigest,
  });
}

export function recordBlockedUnit(plan, input) {
  validatePlan(plan);
  requireExact(input, ["unitId", "baseFrontierRevision", "reason"], "blocked unit");
  requireCurrentFrontier(plan, input.baseFrontierRevision);
  requireText(input.reason, "reason");
  const unit = requirePendingUnit(plan, input.unitId);
  return replaceUnit(plan, unit.unitId, {
    status: "blocked",
    evidence: { reason: input.reason },
  });
}

export function sealReleaseFrontier(plan, input) {
  validatePlan(plan);
  requireExact(input, [
    "canonicalRevision",
    "dependencyClosureDigest",
    "exactCanonicalChecksDigest",
    "runtimeConvergenceDigest",
  ], "release frontier");
  if (input.canonicalRevision !== plan.frontier.revision) {
    throw new Error("Release frontier canonical revision is stale.");
  }
  if (input.dependencyClosureDigest !== plan.frontier.dependencyClosureDigest) {
    throw new Error("Release frontier dependency closure is stale.");
  }
  requireDigest(input.exactCanonicalChecksDigest, "exactCanonicalChecksDigest");
  const unfinished = plan.units.filter((unit) => !SUCCESS_STATES.has(unit.status));
  if (unfinished.length > 0) {
    throw new Error(`Release frontier has non-success units: ${unfinished.map((unit) => unit.unitId).join(", ")}.`);
  }
  if (plan.units.some((unit) => unit.runtimeImpact)) {
    requireDigest(input.runtimeConvergenceDigest, "runtimeConvergenceDigest");
  } else if (input.runtimeConvergenceDigest !== null) {
    throw new Error("Release frontier cannot carry runtime convergence without runtime impact.");
  }

  const record = {
    schema: RELEASE_FRONTIER_SCHEMA,
    status: "sealed",
    planDigest: plan.planDigest,
    canonicalRevision: input.canonicalRevision,
    dependencyClosureDigest: input.dependencyClosureDigest,
    exactCanonicalChecksDigest: input.exactCanonicalChecksDigest,
    runtimeConvergenceDigest: input.runtimeConvergenceDigest,
    unitDispositionsDigest: digest(plan.units.map(({ unitId, status, evidence }) => ({
      unitId,
      status,
      evidence,
    }))),
  };
  return deepFreeze({ ...record, sealDigest: digest(record) });
}

function normalizeUnit(unit) {
  requireExact(unit, [
    "unitId",
    "sourceRevision",
    "changeDigest",
    "writeScopes",
    "dependencies",
    "kind",
    "namedChecks",
    "runtimeImpact",
  ], "integration unit");
  requireText(unit.unitId, "unitId");
  requireText(unit.sourceRevision, "sourceRevision");
  requireDigest(unit.changeDigest, "changeDigest");
  requireTextArray(unit.writeScopes, "writeScopes", { allowEmpty: false });
  requireTextArray(unit.dependencies, "dependencies", { allowEmpty: true });
  requireTextArray(unit.namedChecks, "namedChecks", { allowEmpty: false });
  if (!UNIT_KINDS.has(unit.kind)) throw new Error(`Unsupported integration unit kind ${unit.kind}.`);
  if (typeof unit.runtimeImpact !== "boolean") throw new Error("runtimeImpact must be boolean.");
  return {
    ...unit,
    writeScopes: [...new Set(unit.writeScopes)].sort(compareText),
    dependencies: [...new Set(unit.dependencies)].sort(compareText),
    namedChecks: [...new Set(unit.namedChecks)].sort(compareText),
    status: "pending",
    evidence: null,
  };
}

function finalizePlan(plan) {
  const core = {
    schema: plan.schema,
    frontier: plan.frontier,
    units: plan.units,
  };
  const provisional = { ...core, waves: deriveWaves(core.units) };
  return deepFreeze({ ...provisional, planDigest: digest(provisional) });
}

function replaceUnit(plan, unitId, update, frontier = plan.frontier) {
  const units = plan.units.map((unit) => (
    unit.unitId === unitId ? { ...unit, ...update } : unit
  ));
  return finalizePlan({
    schema: INTEGRATION_PLAN_SCHEMA,
    frontier,
    units,
  });
}

function validatePlan(plan) {
  if (!plan || plan.schema !== INTEGRATION_PLAN_SCHEMA) throw new Error("Invalid integration plan schema.");
  requireExact(plan, ["schema", "frontier", "units", "waves", "planDigest"], "integration plan");
  requireDigest(plan.planDigest, "planDigest");
  requireText(plan.frontier?.revision, "frontier.revision");
  requireDigest(plan.frontier?.dependencyClosureDigest, "frontier.dependencyClosureDigest");
  if (!Array.isArray(plan.units) || plan.units.length === 0) throw new Error("Integration plan has no units.");
  for (const unit of plan.units) {
    if (!UNIT_STATES.has(unit.status)) throw new Error(`Invalid unit status ${unit.status}.`);
  }
  const { planDigest, ...unsignedPlan } = plan;
  if (digest(unsignedPlan) !== planDigest) throw new Error("Integration plan digest does not match its content.");
}

function requirePendingUnit(plan, unitId) {
  requireText(unitId, "unitId");
  const unit = plan.units.find((candidate) => candidate.unitId === unitId);
  if (!unit) throw new Error(`Unknown integration unit ${unitId}.`);
  if (unit.status !== "pending") throw new Error(`Integration unit ${unitId} is already ${unit.status}.`);
  return unit;
}

function requireSuccessfulDependencies(plan, unit) {
  const byId = new Map(plan.units.map((candidate) => [candidate.unitId, candidate]));
  const unresolved = unit.dependencies.filter((dependency) => !SUCCESS_STATES.has(byId.get(dependency)?.status));
  if (unresolved.length > 0) {
    throw new Error(`Integration unit ${unit.unitId} has unresolved dependencies: ${unresolved.join(", ")}.`);
  }
}

function requireCurrentFrontier(plan, revision) {
  requireText(revision, "baseFrontierRevision");
  if (revision !== plan.frontier.revision) throw new Error("Integration operation is based on a stale frontier.");
}

function assertAcyclic(units) {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const visiting = new Set();
  const visited = new Set();
  function visit(unitId) {
    if (visiting.has(unitId)) throw new Error("Integration dependency graph contains a cycle.");
    if (visited.has(unitId)) return;
    visiting.add(unitId);
    for (const dependency of byId.get(unitId).dependencies) visit(dependency);
    visiting.delete(unitId);
    visited.add(unitId);
  }
  units.forEach((unit) => visit(unit.unitId));
}

function requireExact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has missing or unknown fields.`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be non-empty text.`);
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function requireGitRevision(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git revision.`);
  }
}

function requireFence(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) {
    throw new Error(`${label} must be an exact Git or cloud fence.`);
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

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function compareUnit(left, right) {
  return compareText(left.unitId, right.unitId);
}

function compareText(left, right) {
  return String(left).localeCompare(String(right));
}
