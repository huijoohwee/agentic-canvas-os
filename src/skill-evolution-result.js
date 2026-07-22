// Canonical, model-free validation for knowgrph Skill Evolution MCP result snapshots.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SKILL_EVOLUTION_RESULT_SCHEMA = "knowgrph-skill-evolution-result/v1";
const SKILL_EVOLUTION_OPERATIONS = new Set(["plan", "start", "step", "status", "cancel"]);
const SKILL_EVOLUTION_STATUSES = new Set([
  "planned",
  "ready",
  "running",
  "review_pending",
  "stopped",
  "canceled",
  "failed",
]);
const SKILL_EVOLUTION_OPERATION_STATUSES = Object.freeze({
  plan: new Set(["planned", "failed"]),
  start: new Set(["ready", "failed"]),
  step: new Set(["running", "review_pending", "stopped", "canceled", "failed"]),
  status: new Set(["ready", "running", "review_pending", "stopped", "canceled", "failed"]),
  cancel: new Set(["canceled", "failed"]),
});
const SKILL_EVOLUTION_BINDINGS = Object.freeze([
  "@skill-catalog",
  "@skill-policy",
  "@runtime-proof",
  "@operator",
]);
const TOKEN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?$/;
const REVISION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/+-]*[A-Za-z0-9])?$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9._-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SKILL_EVOLUTION_SNAPSHOT_FIELDS = Object.freeze([
  "schema",
  "runId",
  "revision",
  "operation",
  "status",
  "invocation",
  "sourceRevision",
  "baseline",
  "executor",
  "candidateAdapter",
  "dataset",
  "evaluator",
  "plan",
  "progress",
  "workingCandidate",
  "champion",
  "promotedCandidate",
  "metrics",
  "validation",
  "cost",
  "stopReason",
  "proposal",
  "errors",
  "applied",
  "modelWeightsMutated",
  "deploymentAttempted",
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sameStrings(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isToken(value) {
  return typeof value === "string" && value.length <= 160 && TOKEN_PATTERN.test(value);
}

function isRevision(value) {
  return typeof value === "string" && value.length <= 160 && REVISION_PATTERN.test(value);
}

function isRunId(value) {
  return typeof value === "string" && value.length <= 160 && RUN_ID_PATTERN.test(value);
}

function isOpaqueRef(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 4096
    && /\S/.test(value)
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function normalizeUsd(value) {
  return Number(value.toFixed(12));
}

function validateExactObject(value, expected, path, fields) {
  if (!isPlainObject(value)) {
    fields.push(path);
    return false;
  }
  const expectedSet = new Set(expected);
  for (const key of expected) {
    if (!hasOwn(value, key)) fields.push(`${path}.${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) fields.push(`${path}.${key}`);
  }
  return true;
}

function validateDigest(value, path, fields, length = 64) {
  if (!(typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value))) fields.push(path);
}

function validateRef(value, path, fields) {
  if (!validateExactObject(value, ["id", "revision", "digest"], path, fields)) return;
  if (!isToken(value.id)) fields.push(`${path}.id`);
  if (!isRevision(value.revision)) fields.push(`${path}.revision`);
  validateDigest(value.digest, `${path}.digest`, fields);
}

function validateBaseline(value, path, fields) {
  if (!validateExactObject(
    value,
    ["skillId", "revision", "digest", "artifactRef", "normalizedChars"],
    path,
    fields,
  )) return;
  if (!isToken(value.skillId)) fields.push(`${path}.skillId`);
  if (!isRevision(value.revision)) fields.push(`${path}.revision`);
  validateDigest(value.digest, `${path}.digest`, fields);
  if (!isOpaqueRef(value.artifactRef)) fields.push(`${path}.artifactRef`);
  if (!isPositiveInteger(value.normalizedChars) || value.normalizedChars > 10000000) {
    fields.push(`${path}.normalizedChars`);
  }
}

function validateDatasetEntry(value, path, fields) {
  if (!validateExactObject(value, ["id", "digest", "ref"], path, fields)) return;
  if (!isToken(value.id)) fields.push(`${path}.id`);
  validateDigest(value.digest, `${path}.digest`, fields);
  if (!isOpaqueRef(value.ref)) fields.push(`${path}.ref`);
}

function validateDataset(value, path, fields) {
  if (!validateExactObject(value, ["training", "validation"], path, fields)) return;
  const seen = {
    id: new Set(),
    digest: new Set(),
    ref: new Set(),
  };
  for (const split of ["training", "validation"]) {
    const entries = value[split];
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 1000) {
      fields.push(`${path}.${split}`);
      if (!Array.isArray(entries)) continue;
    }
    entries.slice(0, 1000).forEach((entry, index) => {
      const entryPath = `${path}.${split}[${index}]`;
      validateDatasetEntry(entry, entryPath, fields);
      if (!isPlainObject(entry)) return;
      const identities = {
        id: typeof entry.id === "string" ? entry.id.normalize("NFKC").trim().toLowerCase() : null,
        digest: typeof entry.digest === "string" ? entry.digest : null,
        ref: typeof entry.ref === "string" ? entry.ref.normalize("NFKC").trim().toLowerCase() : null,
      };
      for (const [identity, normalized] of Object.entries(identities)) {
        if (normalized === null) continue;
        if (seen[identity].has(normalized)) fields.push(`${entryPath}.${identity}`);
        else seen[identity].add(normalized);
      }
    });
  }
}

function validateEvaluator(value, path, fields) {
  if (!validateExactObject(value, ["id", "revision", "digest", "metric"], path, fields)) return;
  if (!isToken(value.id)) fields.push(`${path}.id`);
  if (!isRevision(value.revision)) fields.push(`${path}.revision`);
  validateDigest(value.digest, `${path}.digest`, fields);
  if (validateExactObject(value.metric, ["id", "direction", "threshold"], `${path}.metric`, fields)) {
    if (!isToken(value.metric.id)) fields.push(`${path}.metric.id`);
    if (!new Set(["maximize", "minimize"]).has(value.metric.direction)) fields.push(`${path}.metric.direction`);
    if (!Number.isFinite(value.metric.threshold)) fields.push(`${path}.metric.threshold`);
  }
}

function validatePlan(value, path, fields) {
  const keys = [
    "epochs",
    "batchSize",
    "miniBatchSize",
    "learningRate",
    "batchesPerEpoch",
    "miniBatchesPerEpoch",
    "maxCandidateCalls",
  ];
  if (!validateExactObject(value, keys, path, fields)) return;
  const maxima = {
    epochs: 100,
    batchSize: 1000,
    miniBatchSize: 1000,
    batchesPerEpoch: 1000,
    miniBatchesPerEpoch: 1000000,
    maxCandidateCalls: 1000000,
  };
  for (const [key, maximum] of Object.entries(maxima)) {
    if (!isPositiveInteger(value[key]) || value[key] > maximum) fields.push(`${path}.${key}`);
  }
  if (isPositiveInteger(value.batchSize)
    && isPositiveInteger(value.miniBatchSize)
    && value.miniBatchSize > value.batchSize) fields.push(`${path}.miniBatchSize`);
  if (validateExactObject(value.learningRate, ["initial", "decay", "floor"], `${path}.learningRate`, fields)) {
    const { initial, decay, floor } = value.learningRate;
    if (!(Number.isFinite(initial) && initial > 0 && initial <= 1)) fields.push(`${path}.learningRate.initial`);
    if (!(Number.isFinite(decay) && decay > 0 && decay <= 1)) fields.push(`${path}.learningRate.decay`);
    if (!(Number.isFinite(floor) && floor >= 0 && floor <= 1 && floor <= initial)) {
      fields.push(`${path}.learningRate.floor`);
    }
  }
}

function validateCandidate(value, path, fields, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!validateExactObject(value, ["candidateRef", "diffRef", "digest", "parentDigest"], path, fields)) return;
  if (!isOpaqueRef(value.candidateRef)) fields.push(`${path}.candidateRef`);
  if (!(value.diffRef === null || isOpaqueRef(value.diffRef))) fields.push(`${path}.diffRef`);
  validateDigest(value.digest, `${path}.digest`, fields);
  if (value.parentDigest !== null) validateDigest(value.parentDigest, `${path}.parentDigest`, fields);
}

function validateProgress(value, path, fields) {
  const keys = ["epoch", "batch", "miniBatch", "candidatesEvaluated"];
  if (!validateExactObject(value, keys, path, fields)) return;
  for (const key of keys) {
    if (!isNonNegativeInteger(value[key])) fields.push(`${path}.${key}`);
  }
}

function validateMetrics(value, path, fields) {
  const keys = ["baseline", "workingCandidate", "champion", "promotedCandidate"];
  if (!validateExactObject(value, keys, path, fields)) return;
  for (const key of keys) {
    if (!(value[key] === null || Number.isFinite(value[key]))) fields.push(`${path}.${key}`);
  }
}

function validateValidation(value, path, fields) {
  if (!validateExactObject(value, ["disjoint", "gateResults", "staleEpochs"], path, fields)) return;
  if (typeof value.disjoint !== "boolean") fields.push(`${path}.disjoint`);
  if (!isNonNegativeInteger(value.staleEpochs) || value.staleEpochs > 100) fields.push(`${path}.staleEpochs`);
  if (!Array.isArray(value.gateResults) || value.gateResults.length > 64) {
    fields.push(`${path}.gateResults`);
    if (!Array.isArray(value.gateResults)) return;
  }
  const gateIds = new Set();
  value.gateResults.slice(0, 64).forEach((gate, index) => {
    const gatePath = `${path}.gateResults[${index}]`;
    if (!validateExactObject(gate, ["id", "passed", "evidenceDigest"], gatePath, fields)) return;
    if (!isToken(gate.id) || gateIds.has(gate.id)) fields.push(`${gatePath}.id`);
    else gateIds.add(gate.id);
    if (typeof gate.passed !== "boolean") fields.push(`${gatePath}.passed`);
    if (gate.evidenceDigest !== null) validateDigest(gate.evidenceDigest, `${gatePath}.evidenceDigest`, fields);
  });
}

function validateCost(value, path, fields) {
  const keys = [
    "adapterCalls",
    "mutationOperations",
    "changedChars",
    "tokens",
    "costUsd",
    "durationMs",
    "byPhase",
  ];
  if (!validateExactObject(value, keys, path, fields)) return;
  for (const key of ["adapterCalls", "mutationOperations", "changedChars", "tokens", "durationMs"]) {
    if (!isNonNegativeInteger(value[key])) fields.push(`${path}.${key}`);
  }
  if (!isFiniteNonNegative(value.costUsd)) fields.push(`${path}.costUsd`);
  if (!validateExactObject(value.byPhase, ["training", "validation"], `${path}.byPhase`, fields)) return;

  const phaseKeys = ["adapterCalls", "tokens", "costUsd", "durationMs"];
  let phaseShapesValid = true;
  for (const phase of ["training", "validation"]) {
    const phasePath = `${path}.byPhase.${phase}`;
    if (!validateExactObject(value.byPhase[phase], phaseKeys, phasePath, fields)) {
      phaseShapesValid = false;
      continue;
    }
    for (const key of ["adapterCalls", "tokens", "durationMs"]) {
      if (!isNonNegativeInteger(value.byPhase[phase][key])) {
        fields.push(`${phasePath}.${key}`);
        phaseShapesValid = false;
      }
    }
    if (!isFiniteNonNegative(value.byPhase[phase].costUsd)) {
      fields.push(`${phasePath}.costUsd`);
      phaseShapesValid = false;
    }
  }

  if (!phaseShapesValid) return;
  const { training, validation } = value.byPhase;
  for (const key of ["adapterCalls", "tokens", "durationMs"]) {
    if (value[key] !== training[key] + validation[key]) fields.push(`${path}.${key}`);
  }
  const phaseCostUsd = normalizeUsd(training.costUsd + validation.costUsd);
  if (value.costUsd !== phaseCostUsd) fields.push(`${path}.costUsd`);
}

function validateErrors(value, failed, fields) {
  if (!Array.isArray(value)) {
    fields.push("errors");
    return;
  }
  if ((failed && value.length === 0) || (!failed && value.length > 0) || value.length > 100) fields.push("errors");
  value.slice(0, 100).forEach((entry, index) => {
    const path = `errors[${index}]`;
    if (!validateExactObject(entry, ["code", "field", "message"], path, fields)) return;
    if (!(typeof entry.code === "string" && entry.code.length <= 160 && ERROR_CODE_PATTERN.test(entry.code))) {
      fields.push(`${path}.code`);
    }
    if (!(entry.field === null || (isNonEmptyString(entry.field) && entry.field.length <= 512))) {
      fields.push(`${path}.field`);
    }
    if (!(isNonEmptyString(entry.message) && entry.message.length <= 4096)) fields.push(`${path}.message`);
  });
}

function validateInitialSnapshot(value, fields) {
  for (const key of ["epoch", "batch", "miniBatch", "candidatesEvaluated"]) {
    if (value.progress?.[key] !== 0) fields.push(`progress.${key}`);
  }
  const expectedCandidate = isPlainObject(value.baseline) ? {
    candidateRef: value.baseline.artifactRef,
    diffRef: null,
    digest: value.baseline.digest,
    parentDigest: null,
  } : null;
  if (expectedCandidate) {
    for (const role of ["workingCandidate", "champion"]) {
      for (const [key, expected] of Object.entries(expectedCandidate)) {
        if (value[role]?.[key] !== expected) fields.push(`${role}.${key}`);
      }
    }
  }
  if (value.promotedCandidate !== null) fields.push("promotedCandidate");
  for (const key of ["baseline", "workingCandidate", "champion", "promotedCandidate"]) {
    if (value.metrics?.[key] !== null) fields.push(`metrics.${key}`);
  }
  if (value.validation?.disjoint !== true) fields.push("validation.disjoint");
  if (value.validation?.staleEpochs !== 0) fields.push("validation.staleEpochs");
  if (Array.isArray(value.validation?.gateResults) && value.validation.gateResults.length !== 0) {
    fields.push("validation.gateResults");
  }
  for (const key of ["adapterCalls", "mutationOperations", "changedChars", "tokens", "costUsd", "durationMs"]) {
    if (value.cost?.[key] !== 0) fields.push(`cost.${key}`);
  }
  for (const phase of ["training", "validation"]) {
    for (const key of ["adapterCalls", "tokens", "costUsd", "durationMs"]) {
      if (value.cost?.byPhase?.[phase]?.[key] !== 0) fields.push(`cost.byPhase.${phase}.${key}`);
    }
  }
  if (value.stopReason !== null) fields.push("stopReason");
}

/** Return every canonical Skill Evolution result-contract violation. */
export function skillEvolutionResultValidationFields(value, { expectedOperation } = {}) {
  if (!isPlainObject(value)) return ["result"];

  const fields = [];
  const snapshotFieldSet = new Set(SKILL_EVOLUTION_SNAPSHOT_FIELDS);
  for (const field of SKILL_EVOLUTION_SNAPSHOT_FIELDS) {
    if (!hasOwn(value, field)) fields.push(field);
  }
  for (const field of Object.keys(value)) {
    if (!snapshotFieldSet.has(field)) fields.push(`unknown.${field}`);
  }
  if (value.schema !== SKILL_EVOLUTION_RESULT_SCHEMA) fields.push("schema");
  if (!SKILL_EVOLUTION_OPERATIONS.has(value.operation)) fields.push("operation");
  if (expectedOperation !== undefined && value.operation !== expectedOperation) fields.push("operation_mismatch");
  if (!SKILL_EVOLUTION_STATUSES.has(value.status)) fields.push("status");
  if (SKILL_EVOLUTION_OPERATION_STATUSES[value.operation]
    && !SKILL_EVOLUTION_OPERATION_STATUSES[value.operation].has(value.status)) fields.push("operation_status");
  if (!isNonNegativeInteger(value.revision)) fields.push("revision");
  const failed = value.status === "failed";
  const hasRun = isRunId(value.runId);
  if (!(value.runId === null || hasRun)) fields.push("runId");
  if (value.operation === "plan") {
    if (value.runId !== null || value.revision !== 0) fields.push("plan_identity");
  } else if (value.operation === "start" && !failed) {
    if (!hasRun || value.revision !== 1) fields.push("start_identity");
  } else if (failed && value.runId === null) {
    if (value.revision !== 0) fields.push("revision");
  } else if (!hasRun || !isPositiveInteger(value.revision)) {
    fields.push(!hasRun ? "runId" : "revision");
  }

  const resolved = !failed || hasRun;
  if (value.sourceRevision === null) {
    if (resolved) fields.push("sourceRevision");
  } else {
    validateDigest(value.sourceRevision, "sourceRevision", fields, 40);
  }

  if (validateExactObject(value.invocation, ["command", "semantics", "bindings"], "invocation", fields)) {
    const invocation = value.invocation;
    if (invocation.command !== "/skill.evolve") fields.push("invocation.command");
    if (!sameStrings(invocation.semantics, ["#skill-evolution"])) fields.push("invocation.semantics");
    if (!sameStrings(invocation.bindings, SKILL_EVOLUTION_BINDINGS)) fields.push("invocation.bindings");
  }

  for (const [field, validator] of [
    ["baseline", validateBaseline],
    ["executor", validateRef],
    ["candidateAdapter", validateRef],
    ["dataset", validateDataset],
    ["evaluator", validateEvaluator],
    ["plan", validatePlan],
  ]) {
    if (value[field] === null) {
      if (resolved) fields.push(field);
    } else {
      validator(value[field], field, fields);
    }
  }

  validateProgress(value.progress, "progress", fields);
  validateCandidate(value.workingCandidate, "workingCandidate", fields, { nullable: !resolved });
  validateCandidate(value.champion, "champion", fields, { nullable: !resolved });
  validateCandidate(value.promotedCandidate, "promotedCandidate", fields, { nullable: true });
  validateMetrics(value.metrics, "metrics", fields);
  validateValidation(value.validation, "validation", fields);
  if (!failed && isPlainObject(value.validation) && value.validation.disjoint !== true) {
    fields.push("validation.disjoint");
  }
  validateCost(value.cost, "cost", fields);
  validateErrors(value.errors, failed, fields);
  if ((value.operation === "plan" && value.status === "planned")
    || (value.operation === "start" && value.status === "ready")) {
    validateInitialSnapshot(value, fields);
  }

  if (!(value.stopReason === null
    || (typeof value.stopReason === "string"
      && value.stopReason.length <= 160
      && ERROR_CODE_PATTERN.test(value.stopReason)))) fields.push("stopReason");

  if (value.status === "review_pending") {
    if (validateExactObject(value.proposal, ["status", "candidateRef", "diffRef", "digest"], "proposal", fields)) {
      if (value.proposal.status !== "review_pending") fields.push("proposal.status");
      if (!isOpaqueRef(value.proposal.candidateRef)) fields.push("proposal.candidateRef");
      if (!isOpaqueRef(value.proposal.diffRef)) fields.push("proposal.diffRef");
      validateDigest(value.proposal.digest, "proposal.digest", fields);
      if (isPlainObject(value.champion)
        && (value.proposal.candidateRef !== value.champion.candidateRef
          || value.proposal.diffRef !== value.champion.diffRef
          || value.proposal.digest !== value.champion.digest)) fields.push("proposal.champion");
    }
  } else if (value.proposal !== null) {
    fields.push("proposal");
  }

  for (const field of ["applied", "modelWeightsMutated", "deploymentAttempted"]) {
    if (value[field] !== false) fields.push(field);
  }

  return [...new Set(fields)].sort();
}

export function isSkillEvolutionOperation(value) {
  return SKILL_EVOLUTION_OPERATIONS.has(value);
}
