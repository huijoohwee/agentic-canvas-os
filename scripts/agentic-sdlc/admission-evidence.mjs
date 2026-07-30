import { createHash } from "node:crypto";

import {
  LIFECYCLE_STAGES,
} from "../lifecycle-conformance-gate.mjs";
import {
  array,
  compareText,
  deepFreeze,
  object,
  sameStableValue,
  stableJson,
  stableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

export const ADMISSION_EVIDENCE_SCHEMA =
  "agentic-sdlc-admission-evidence/v1";
export const ADMISSION_RECEIPT_SCHEMA =
  "agentic-sdlc-admission-stage-receipt/v1";
export const ADMISSION_STAGE_EVIDENCE_SCHEMA =
  "agentic-sdlc-admission-stage-evidence/v1";
export const ADMISSION_ENFORCED_STAGES = Object.freeze(["admission"]);
export const ADMISSION_UNEVALUATED_STAGES =
  Object.freeze(LIFECYCLE_STAGES.slice(1));

export const ADMISSION_OPERATION_PRODUCERS = Object.freeze({
  "admission:authoring-baseline": Object.freeze({
    mechanismId: "agentic-sdlc-authoring-baseline/v1",
    actorRole: "evaluator",
  }),
  "admission:task-plan": Object.freeze({
    mechanismId: "agentic-sdlc-task-plan/v1",
    actorRole: "orchestrator",
  }),
  "admission:collaboration": Object.freeze({
    mechanismId: "agentic-writer-lease/v2",
    actorRole: "orchestrator",
  }),
  "admission:dependency-admission": Object.freeze({
    mechanismId: "agentic-upstream-dependency-admission/v1",
    actorRole: "evaluator",
  }),
  "admission:execution-evaluator": Object.freeze({
    mechanismId: "agentic-sdlc-evaluator-selection/v1",
    actorRole: "orchestrator",
  }),
});

export function normalizeAdmissionEvidence(input) {
  const normalized = stableValue(input);
  const evidence = normalized.admissionEvidence;
  if (!isRecord(evidence)) return deepFreeze(normalized);
  if (Array.isArray(evidence.vccs)) {
    evidence.vccs = sortBy(evidence.vccs, "conditionId")
      .map((vcc) => isRecord(vcc) ? normalizeVcc(vcc) : vcc);
  }
  if (Array.isArray(evidence.tasks)) {
    evidence.tasks = sortBy(evidence.tasks, "taskId")
      .map((task) => isRecord(task) ? normalizeTask(task) : task);
  }
  if (isRecord(evidence.collaboration)) {
    if (Array.isArray(evidence.collaboration.declaredWriteScope)) {
      evidence.collaboration.declaredWriteScope =
        sortedNormalizedStrings(evidence.collaboration.declaredWriteScope);
    }
    if (Array.isArray(evidence.collaboration.peerWriters)) {
      evidence.collaboration.peerWriters =
        evidence.collaboration.peerWriters.map(normalizeWriter)
          .sort((left, right) =>
            compareText(stableJson(left), stableJson(right)));
    }
  }
  normalizeDependencyRequest(evidence.dependencies);
  if (Array.isArray(normalized.operations)) {
    normalized.operations = sortBy(normalized.operations, "operationId")
      .map((operation) => isRecord(operation)
        ? {
          ...operation,
          ...(Array.isArray(operation.evidenceReferences)
            ? {
              evidenceReferences:
                sortReferences(operation.evidenceReferences),
            }
            : {}),
        }
        : operation);
  }
  return deepFreeze(stableValue(normalized));
}

export function validateAdmissionOperations({
  collector,
  dependencyAdmissionDigest,
  evidence,
  operations,
}) {
  const expected = expectedOperationContracts(evidence, dependencyAdmissionDigest);
  const byId = new Map();
  for (const operationInput of array(operations)) {
    const operation = object(operationInput);
    const operationId = text(operation.operationId);
    if (byId.has(operationId) || !expected.has(operationId)) {
      collector.add("evidence-without-run", {
        artifactReference: operationId || "operation-without-id",
        evidenceExcerpt: "Admission operation identities must be complete and unique.",
      });
    }
    byId.set(operationId, operation);
  }
  for (const [operationId, contract] of expected) {
    const operation = byId.get(operationId);
    const references = sortReferences(operation?.evidenceReferences);
    const producer = ADMISSION_OPERATION_PRODUCERS[operationId];
    const valid = operation
      && operation.stage === "admission"
      && operation.mechanismId === producer.mechanismId
      && operation.actorRole === producer.actorRole
      && operation.inputDigest === contract.inputDigest
      && operation.terminalResult?.status === "passed"
      && hasRecordedTerminalResult(operation.terminalResult)
      && sameStableValue(references, contract.references)
      && operation.resultDigest === digestAdmissionValue({
        terminalResult: operation.terminalResult,
        evidenceReferences: references,
      });
    if (!valid) {
      collector.add(operationFindingType(operationId), {
        artifactReference: operationId,
        evidenceExcerpt:
          "The permitted producer, exact input, terminal result, and typed evidence references must join.",
      });
    }
  }
}

// Test-only seam for constructing complete producer fixtures. It is not
// re-exported by the public agentic-sdlc index or used by the CLI adapter.
export function __deriveAdmissionOperationContractsForTests(
  evidence,
  dependencyAdmissionDigest,
) {
  return expectedOperationContracts(evidence, dependencyAdmissionDigest);
}

function expectedOperationContracts(evidence, dependencyAdmissionDigest) {
  const baseline = object(evidence.authoringBaseline);
  const vccs = array(evidence.vccs).map(object);
  const tasks = array(evidence.tasks).map(object);
  return new Map([
    ["admission:authoring-baseline", {
      inputDigest: digestAdmissionValue({
        authoringBaseline: baseline,
        specificationTokenEstimate: evidence.specificationTokenEstimate,
        vccs,
      }),
      references: sortReferences([
        reference("authoring-baseline", baseline.vccRevision, baseline.digest),
        ...vccs.map((vcc) =>
          reference("vcc", vcc.conditionId, digestAdmissionValue(vcc))),
      ]),
    }],
    ["admission:task-plan", {
      inputDigest: digestAdmissionValue({
        derivationRevision: evidence.derivationRevision,
        tasks,
      }),
      references: sortReferences(tasks.map((task) =>
        reference("task", task.taskId, digestAdmissionValue(task)))),
    }],
    ["admission:collaboration", {
      inputDigest: digestAdmissionValue(evidence.collaboration),
      references: [reference(
        "collaboration",
        evidence.collaboration?.fenceRevision,
        digestAdmissionValue(evidence.collaboration),
      )],
    }],
    ["admission:dependency-admission", {
      inputDigest: digestAdmissionValue(evidence.dependencies),
      references: [reference(
        "dependency-admission",
        "complete-closure",
        dependencyAdmissionDigest,
      )],
    }],
    ["admission:execution-evaluator", {
      inputDigest: digestAdmissionValue(evidence.executionMechanisms),
      references: [reference(
        "execution-evaluator",
        evidence.executionMechanisms?.evaluator?.mechanismId,
        digestAdmissionValue(evidence.executionMechanisms),
      )],
    }],
  ]);
}

function normalizeVcc(vcc) {
  return {
    ...vcc,
    ...(Array.isArray(vcc.behaviorClaims)
      ? { behaviorClaims: sortedNormalizedStrings(vcc.behaviorClaims) }
      : {}),
    ...(Array.isArray(vcc.correctnessProperties)
      ? {
        correctnessProperties:
          sortBy(vcc.correctnessProperties, "propertyId"),
      }
      : {}),
  };
}

function normalizeTask(task) {
  return {
    ...task,
    ...normalizeStringArrayField(task, "behaviorKinds"),
    ...normalizeStringArrayField(task, "behaviorClaims"),
    ...normalizeStringArrayField(task, "vccIds"),
    ...normalizeStringArrayField(task, "criterionIds"),
    ...normalizeStringArrayField(task, "dependencyIds"),
    ...normalizeStringArrayField(task, "writeSet"),
    ...(Array.isArray(task.propertyObligations)
      ? {
        propertyObligations:
          sortBy(task.propertyObligations, "propertyId"),
      }
      : {}),
    ...(Array.isArray(task.capabilityGrants)
      ? {
        capabilityGrants: task.capabilityGrants
          .map((grant) => isRecord(grant)
            ? {
              ...grant,
              ...(Array.isArray(grant.scope)
                ? { scope: sortedNormalizedStrings(grant.scope) }
                : {}),
            }
            : grant)
          .sort((left, right) =>
            compareText(left?.class, right?.class)
            || compareText(left?.intendedUse, right?.intendedUse)
            || compareText(stableJson(left), stableJson(right))),
      }
      : {}),
  };
}

function normalizeWriter(writer) {
  if (!isRecord(writer)) return writer;
  return {
    ...writer,
    ...(Array.isArray(writer.declaredWriteScope)
      ? {
        declaredWriteScope:
          sortedNormalizedStrings(writer.declaredWriteScope),
      }
      : {}),
  };
}

function normalizeDependencyRequest(dependenciesInput) {
  if (!isRecord(dependenciesInput)) return;
  const dependencies = dependenciesInput;
  const request = dependencies.request;
  if (!isRecord(request)) return;
  if (Array.isArray(request.units)) {
    request.units = sortBy(request.units, "unitId").map((unit) =>
      isRecord(unit)
        ? { ...unit, ...normalizeStringArrayField(unit, "dependencies") }
        : unit);
  }
  if (Array.isArray(request.dependencies)) {
    request.dependencies = sortBy(
      request.dependencies,
      "dependencyId",
    ).map((dependency) => {
      if (!isRecord(dependency)) return dependency;
      return {
        ...dependency,
        ...(Array.isArray(dependency.owners)
          ? { owners: sortBy(dependency.owners, "scopeId", "ownerId") }
          : {}),
        ...(Array.isArray(dependency.requiredChecks)
          ? { requiredChecks: sortBy(dependency.requiredChecks, "name") }
          : {}),
        ...normalizeStringArrayField(dependency, "consumers"),
      };
    });
  }
}

function operationFindingType(operationId) {
  if (operationId === "admission:collaboration") {
    return "stale-collaboration-fence";
  }
  if (operationId === "admission:dependency-admission") {
    return "dependency-closure-drift";
  }
  if (operationId === "admission:execution-evaluator") {
    return "unnamed-evaluator";
  }
  return "evidence-without-run";
}

function reference(kind, referenceId, referenceDigest) {
  return {
    kind,
    referenceId: text(referenceId),
    digest: text(referenceDigest),
  };
}

function sortReferences(references) {
  return array(references)
    .map((item) => isRecord(item) ? { ...item } : item)
    .sort((left, right) =>
      compareText(left?.kind, right?.kind)
      || compareText(left?.referenceId, right?.referenceId)
      || compareText(left?.digest, right?.digest)
      || compareText(stableJson(left), stableJson(right)));
}

function sortBy(values, ...keys) {
  return [...values].sort((left, right) => {
    for (const key of keys) {
      const comparison = compareText(left?.[key], right?.[key]);
      if (comparison !== 0) return comparison;
    }
    return compareText(stableJson(left), stableJson(right));
  });
}

function normalizeStringArrayField(value, field) {
  return Array.isArray(value?.[field])
    ? { [field]: sortedNormalizedStrings(value[field]) }
    : {};
}

function sortedNormalizedStrings(values) {
  return array(values).map(text).sort(compareText);
}

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function hasRecordedTerminalResult(resultInput) {
  const result = object(resultInput);
  const counts = object(result.counts);
  const total = Number(counts.total);
  const passed = Number(counts.passed);
  const failed = Number(counts.failed);
  const errored = Number(counts.errored);
  const skipped = Number(counts.skipped);
  const countValues = [total, passed, failed, errored, skipped];
  return result.ran === true
    && Number.isSafeInteger(result.exitCode)
    && result.exitCode >= 0
    && text(result.summary)
    && countValues.every((value) => Number.isSafeInteger(value) && value >= 0)
    && total === passed + failed + errored + skipped
    && (
      result.status === "passed"
        ? result.exitCode === 0 && passed > 0 && failed === 0 && errored === 0
        : ["failed", "blocked"].includes(result.status)
          && result.exitCode !== 0
          && failed + errored > 0
    );
}

export function digestAdmissionValue(value) {
  const serialized = stableJson(value);
  return createHash("sha256")
    .update(serialized === undefined ? "undefined" : serialized, "utf8")
    .digest("hex");
}
