import { evaluateUpstreamDependencies } from "../../agent-api/src/upstream-dependency-admission.js";
import { verifyAuthoringAttestation } from "./attestation.mjs";
import { computeAuthoringBaselineDigest } from "./baseline-digest.mjs";
import {
  validateAdmissionCollaboration,
} from "./admission-collaboration.mjs";
import {
  BUDGET_FIELDS,
  CAPABILITY_CLASSES,
  EXACT_CIRCUIT_BREAKER_LIMIT,
  TASK_ID_PATTERN,
} from "./constants.mjs";
import {
  digestAdmissionValue,
  validateAdmissionOperations,
} from "./admission-evidence.mjs";
import { inspectTaskGraph } from "./graph.mjs";
import {
  array,
  compareText,
  object,
  pathWithinScope,
  sameStableValue,
  stableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const WAVE_ORDINAL_PATTERN = /^[1-9][0-9]{0,14}$/u;

export function evaluateAdmissionDomain(input, collector) {
  const evidence = object(input.admissionEvidence);
  const baseline = object(evidence.authoringBaseline);
  const vccs = array(evidence.vccs).map(object);
  const tasks = array(evidence.tasks).map(object);
  const expectedBaselineDigest = computeAuthoringBaselineDigest(
    baseline,
    vccs,
    evidence.specificationTokenEstimate,
  );
  if (
    baseline.status !== "baselined"
    || baseline.openBlockerCount !== 0
    || baseline.digest !== expectedBaselineDigest
    || !verifyAuthoringAttestation(
      baseline,
      vccs,
      evidence.specificationTokenEstimate,
    )
  ) {
    collector.add("runtime-readiness-unproven", {
      artifactReference: "authoring-baseline",
      evidenceExcerpt:
        "The PRD/TAD baseline, blocker count, digest, and authoring attestation must join.",
    });
  }
  if (text(evidence.derivationRevision) !== text(baseline.vccRevision)) {
    collector.add("ungrounded-task", {
      artifactReference: "derivation-revision",
      evidenceExcerpt: "The task plan must be derived from the current VCC revision.",
    });
  }

  const plan = validatePlan({ collector, evidence, tasks, vccs });
  validateMechanisms(evidence.executionMechanisms, collector);
  validateAdmissionCollaboration(
    evidence.collaboration,
    input.evaluationTime,
    tasks,
    collector,
  );
  const dependencyAdmissionDigest = validateDependencies({
    collector,
    dependencies: evidence.dependencies,
    evaluationTime: input.evaluationTime,
    tasks,
  });
  if (
    dependencyAdmissionDigest
    !== text(input.sourceIdentity?.dependencyClosureDigest)
  ) {
    const error = new Error(
      "The evaluated dependency admission closure does not match the source identity.",
    );
    error.code = "AGENTIC_SDLC_DEPENDENCY_IDENTITY_UNAVAILABLE";
    throw error;
  }
  if (
    evidence.deployBoundary?.lane !== "authoring"
    || evidence.deployBoundary?.state !== "closed"
  ) {
    collector.add("deploy-boundary-breach", {
      artifactReference: "deployBoundary",
      evidenceExcerpt: "Admission cannot grant promotion or deployment capability.",
    });
  }
  validateAdmissionOperations({
    collector,
    dependencyAdmissionDigest,
    evidence,
    operations: input.operations,
  });
  return {
    ...plan,
    dependencyAdmissionDigest,
    expectedBaselineDigest,
  };
}

function validatePlan({ collector, evidence, tasks, vccs }) {
  const vccById = new Map();
  const covered = new Set();
  const propertyIds = new Set();
  for (const vcc of vccs) {
    const vccId = text(vcc.conditionId);
    if (!vccId || vccById.has(vccId)) {
      collector.add("ungrounded-task", {
        artifactReference: vccId || "vcc-without-id",
        evidenceExcerpt: "VCC identities must be non-empty and unique.",
      });
    }
    vccById.set(vccId, vcc);
    for (const propertyInput of array(vcc.correctnessProperties)) {
      const property = object(propertyInput);
      const propertyId = text(property.propertyId);
      if (!propertyId || propertyIds.has(propertyId)) {
        collector.add("unproven-property", {
          artifactReference: propertyId || "property-without-id",
          evidenceExcerpt: "Correctness property identities must be unique.",
        });
      }
      propertyIds.add(propertyId);
    }
  }

  const taskIds = new Set();
  let declaredTokenTotal = 0;
  for (const task of tasks) {
    const taskId = text(task.taskId);
    if (!TASK_ID_PATTERN.test(taskId) || taskIds.has(taskId)) {
      collector.add("ungrounded-task", {
        artifactReference: `task:${taskId || "unknown"}`,
        evidenceExcerpt: "Every pre-dispatch task requires one unique bounded Task ID.",
      });
    }
    taskIds.add(taskId);
    declaredTokenTotal += Number(task.budgets?.tokens ?? 0);
    validateTaskBridge(
      task,
      vccById,
      covered,
      evidence.authoringBaseline,
      collector,
    );
    validateTaskBounds(task, vccById, collector);
    validateTaskCapabilities(task, collector);
  }
  if (
    !Number.isSafeInteger(evidence.specificationTokenEstimate)
    || declaredTokenTotal > evidence.specificationTokenEstimate
  ) {
    collector.add("oversized-task", {
      artifactReference: "specification-token-estimate",
      evidenceExcerpt:
        "Aggregate declared task token bounds must fit the specification estimate.",
    });
  }
  for (const vccId of vccById.keys()) {
    if (!covered.has(vccId)) {
      collector.add("unexecuted-condition", {
        artifactReference: vccId || "vcc-without-id",
        evidenceExcerpt: "Every VCC must be covered by at least one task.",
      });
    }
  }

  const graph = inspectTaskGraph(tasks.map((task) => ({
    id: task.taskId,
    dependencies: task.dependencyIds,
    wave: task.waveId,
    declaredWriteSet: task.writeSet,
  })));
  for (const taskId of graph.cycleNodes) {
    collector.add("task-cycle", {
      artifactReference: `task:${taskId}`,
      evidenceExcerpt: "The pre-dispatch task graph contains a cycle.",
    });
  }
  for (const unknown of graph.unknownDependencies) {
    collector.add("ungrounded-task", {
      artifactReference: `task:${unknown.taskId}:${unknown.dependency}`,
      evidenceExcerpt: "A task dependency does not resolve to a declared Task ID.",
    });
  }
  const taskById = new Map(tasks.map((task) => [
    text(task.taskId),
    task,
  ]));
  for (const task of tasks) {
    const taskWave = waveOrdinal(task.waveId);
    if (taskWave === null) {
      collector.add("runtime-readiness-unproven", {
        artifactReference: `task:${text(task.taskId)}:wave`,
        evidenceExcerpt:
          "Every dispatch wave must be a positive deterministic ordinal.",
      });
    }
    for (const dependencyId of uniqueSortedStrings(task.dependencyIds)) {
      const dependency = taskById.get(dependencyId);
      const dependencyWave = waveOrdinal(dependency?.waveId);
      if (
        dependency
        && taskWave !== null
        && dependencyWave !== null
        && dependencyWave >= taskWave
      ) {
        collector.add("runtime-readiness-unproven", {
          artifactReference:
            `task:${text(task.taskId)}:dependency:${dependencyId}`,
          evidenceExcerpt:
            "Every dependency must occupy an earlier dispatch wave than its consumer.",
        });
      }
    }
  }
  for (const conflict of graph.writeConflicts) {
    collector.add("concurrent-write-conflict", {
      artifactReference:
        `wave:${conflict.wave}:${conflict.leftTaskId}:${conflict.rightTaskId}`,
      evidenceExcerpt: `Concurrent tasks overlap: ${conflict.artifacts.join(", ")}.`,
    });
  }
  return {
    coveredVccCount: covered.size,
    vccCount: vccById.size,
  };
}

function validateTaskBridge(
  task,
  vccById,
  covered,
  authoringBaseline,
  collector,
) {
  const sourceIds = uniqueSortedStrings(task.vccIds);
  const sourceVccs = sourceIds.map((vccId) => vccById.get(vccId)).filter(Boolean);
  if (sourceIds.length === 0 || sourceVccs.length !== sourceIds.length) {
    collector.add("ungrounded-task", {
      artifactReference: `task:${text(task.taskId)}:vccs`,
      evidenceExcerpt: "Every task must trace only to declared VCC identities.",
    });
  }
  sourceIds.forEach((vccId) => {
    if (vccById.has(vccId)) covered.add(vccId);
  });
  const criteria = uniqueSortedStrings(sourceVccs.map((vcc) => vcc.criterionId));
  if (!sameStableValue(criteria, uniqueSortedStrings(task.criterionIds))) {
    collector.add("ungrounded-task", {
      artifactReference: `task:${text(task.taskId)}:criteria`,
      evidenceExcerpt: "Task criterion identities must exactly match their source VCCs.",
    });
  }
  const expectedClaims = uniqueSortedStrings(sourceVccs.flatMap((vcc) =>
    uniqueSortedStrings(vcc.behaviorClaims)));
  const taskClaims = uniqueSortedStrings(task.behaviorClaims);
  if (
    !sameStableValue(taskClaims, expectedClaims)
    || text(task.text) !== expectedClaims.join(" | ")
  ) {
    collector.add("ungrounded-task", {
      artifactReference: `task:${text(task.taskId)}:behavior`,
      evidenceExcerpt:
        "Task behavior and text must be the exact canonical rendering of its source VCCs.",
    });
  }
  const expectedChecks = uniqueSortedStrings(
    sourceVccs.map((vcc) => vcc.statedCheck),
  );
  if (
    expectedChecks.length !== 1
    || text(task.namedCheck) !== expectedChecks[0]
    || text(task.existingVerificationLane)
      !== text(authoringBaseline?.existingVerificationLane)
  ) {
    collector.add("ungrounded-task", {
      artifactReference: `task:${text(task.taskId)}:checks`,
      evidenceExcerpt:
        "The named check and existing verification lane must join the source VCC baseline.",
    });
  }
  const expectedProperties = new Map(sourceVccs.flatMap((vcc) =>
    array(vcc.correctnessProperties).map((propertyInput) => {
      const property = object(propertyInput);
      return [text(property.propertyId), property];
    })));
  const obligationEntries = array(task.propertyObligations)
    .map((obligationInput) => {
      const obligation = object(obligationInput);
      return [text(obligation.propertyId), obligation];
    });
  const obligations = new Map(obligationEntries);
  if (
    obligations.size !== obligationEntries.length
    || !sameStableValue(
      [...obligations.keys()].sort(compareText),
      [...expectedProperties.keys()].sort(compareText),
    )
  ) {
    collector.add("unproven-property", {
      artifactReference: `task:${text(task.taskId)}:property-closure`,
      evidenceExcerpt:
        "Property obligations must exactly match the source VCC property identities.",
    });
  }
  for (const [propertyId, property] of expectedProperties) {
    const obligation = obligations.get(propertyId);
    if (
      !obligation
      || obligation.propertyClass !== property.propertyClass
      || obligation.iterations < property.iterations
      || obligation.shrinking !== true
    ) {
      collector.add("unproven-property", {
        artifactReference: `task:${text(task.taskId)}:${propertyId}`,
        evidenceExcerpt:
          "Every correctness property needs a matching bounded pre-dispatch obligation.",
      });
    }
  }
  const behaviorKinds = new Set(uniqueSortedStrings(task.behaviorKinds));
  const obligationClasses = new Set(
    obligationEntries.map(([, obligation]) =>
      text(obligation.propertyClass)),
  );
  if (
    (
      behaviorKinds.has("parser")
      || behaviorKinds.has("serialiser")
    )
    && !obligationClasses.has("round-trip")
  ) {
    collector.add("unproven-property", {
      artifactReference: `task:${text(task.taskId)}:round-trip`,
      evidenceExcerpt:
        "Parser and serialiser behavior requires a round-trip property obligation.",
    });
  }
  if (
    [...behaviorKinds].some((kind) =>
      ["ordering", "dedup", "aggregation"].includes(kind))
    && ![...obligationClasses].some((propertyClass) =>
      ["invariant", "metamorphic"].includes(propertyClass))
  ) {
    collector.add("unproven-property", {
      artifactReference: `task:${text(task.taskId)}:invariant`,
      evidenceExcerpt:
        "Ordering, dedup, and aggregation behavior requires an invariant or metamorphic obligation.",
    });
  }
}

function validateTaskBounds(task, vccById, collector) {
  const taskId = text(task.taskId);
  const budgets = object(task.budgets);
  if (BUDGET_FIELDS.some((field) =>
    !Number.isSafeInteger(budgets[field]) || budgets[field] < 1)) {
    collector.add("unbounded-task", {
      artifactReference: `task:${taskId}:budgets`,
      evidenceExcerpt: "All four positive per-task bounds are required before dispatch.",
    });
  }
  if (
    task.circuitBreaker?.maxConsecutiveNoProgress
      !== EXACT_CIRCUIT_BREAKER_LIMIT
    || text(task.circuitBreaker?.progressCheck) !== text(task.namedCheck)
  ) {
    collector.add("unbounded-task", {
      artifactReference: `task:${taskId}:circuit-breaker`,
      evidenceExcerpt:
        "The two-failure circuit breaker must use the task's named progress check.",
    });
  }
  if (
    task.sizing?.withinSingleBudget !== true
    || task.sizing?.verifiableOutcomeCount !== 1
    || task.sizing?.coherentVccGroup !== true
  ) {
    collector.add("oversized-task", {
      artifactReference: `task:${taskId}:sizing`,
      evidenceExcerpt: "A task must fit one budget and one verifiable outcome.",
    });
  }
  for (const vccId of uniqueSortedStrings(task.vccIds)) {
    const bound = vccById.get(vccId)?.bound;
    if (bound && budgets[bound.field] > bound.maximum) {
      collector.add("oversized-task", {
        artifactReference: `task:${taskId}:${bound.field}`,
        evidenceExcerpt: "The task budget exceeds a source VCC bound.",
      });
    }
  }
}

function validateTaskCapabilities(task, collector) {
  const taskId = text(task.taskId);
  const grants = array(task.capabilityGrants);
  const classes = new Set();
  for (const grantInput of grants) {
    const grant = object(grantInput);
    const capabilityClass = text(grant.class);
    if (
      !CAPABILITY_CLASSES.includes(capabilityClass)
      || classes.has(capabilityClass)
      || !text(grant.intendedUse)
    ) {
      collector.add("self-escalated-capability", {
        artifactReference: `task:${taskId}:${capabilityClass || "grant"}`,
        evidenceExcerpt: "Capability grants must be unique, named, and predeclared.",
      });
    }
    classes.add(capabilityClass);
    const scope = uniqueSortedStrings(grant.scope);
    if (capabilityClass === "local-write" && scope.length === 0) {
      collector.add("self-escalated-capability", {
        artifactReference: `task:${taskId}:${capabilityClass}`,
        evidenceExcerpt: "A local capability grant requires an exact bounded scope.",
      });
    }
    if (capabilityClass === "boundary-crossing") {
      collector.add("deploy-boundary-breach", {
        artifactReference: `task:${taskId}:boundary-crossing`,
        evidenceExcerpt: "Boundary-crossing capability is forbidden during execution.",
      });
    }
    if (
      capabilityClass === "irreversible"
      && grant.operatorDecisionReference != null
    ) {
      collector.add("ungated-irreversible-operation", {
        artifactReference: `task:${taskId}:irreversible`,
        evidenceExcerpt:
          "A pre-dispatch grant cannot carry standing irreversible-operation approval.",
      });
    }
  }
  const writeScopes = grants
    .map(object)
    .filter((grant) => grant.class === "local-write")
    .flatMap((grant) => uniqueSortedStrings(grant.scope));
  for (const artifact of uniqueSortedStrings(task.writeSet)) {
    if (!writeScopes.some((scope) => pathWithinScope(artifact, scope))) {
      collector.add("out-of-scope-write", {
        artifactReference: `task:${taskId}:${artifact}`,
        evidenceExcerpt: "Every declared write must fit a local-write grant.",
      });
    }
  }
}

function validateMechanisms(mechanismsInput, collector) {
  const mechanisms = object(mechanismsInput);
  const evaluator = object(mechanisms.evaluator);
  const implementer = object(mechanisms.implementer);
  const missing = [evaluator, implementer].some((mechanism) =>
    !text(mechanism.mechanismId)
    || !text(mechanism.mechanismType)
    || !DIGEST_PATTERN.test(text(mechanism.mechanismDigest)));
  if (missing) {
    collector.add("unnamed-evaluator", {
      artifactReference: "execution-mechanisms",
      evidenceExcerpt: "Admission requires named evaluator and implementer mechanisms.",
    });
  }
  if (
    evaluator.mechanismId === implementer.mechanismId
    || evaluator.mechanismDigest === implementer.mechanismDigest
  ) {
    collector.add("self-graded-verdict", {
      artifactReference: "execution-mechanisms",
      evidenceExcerpt:
        "The future task evaluator must be mechanically distinct from the implementer.",
    });
  }
}

function validateDependencies({
  collector,
  dependencies: dependenciesInput,
  evaluationTime,
  tasks,
}) {
  const dependencies = object(dependenciesInput);
  if (dependencies.inventoryComplete !== true) {
    collector.add("dependency-closure-drift", {
      artifactReference: "dependencies.inventoryComplete",
      evidenceExcerpt: "Dependency inventory must be explicitly complete.",
    });
  }
  if (dependencies.request === null) {
    return digestAdmissionValue({
      schema: "agentic-upstream-dependency-closure/v1",
      inventoryComplete: dependencies.inventoryComplete === true,
      records: [],
    });
  }
  let result;
  try {
    result = evaluateUpstreamDependencies(dependencies.request);
  } catch (error) {
    collector.add("dependency-closure-drift", {
      artifactReference: "dependencies.request",
      evidenceExcerpt: error?.message || "Dependency admission evaluation failed.",
    });
    return digestAdmissionValue({
      invalidDependencyAdmission: stableValue(dependencies),
    });
  }
  const expectedUnits = tasks.map((taskInput) => {
    const task = object(taskInput);
    return {
    unitId: text(task.taskId),
    dependencies: uniqueSortedStrings(task.dependencyIds),
    };
  }).sort((left, right) => compareText(left.unitId, right.unitId));
  const observedUnits = array(dependencies.request.units)
    .map((unitInput) => {
      const unit = object(unitInput);
      return {
        unitId: text(unit.unitId),
        dependencies: uniqueSortedStrings(unit.dependencies),
      };
    }).sort((left, right) => compareText(left.unitId, right.unitId));
  if (
    dependencies.request.evaluationTime !== evaluationTime
    || dependencies.request.requestedPlanStop !== false
    || !sameStableValue(expectedUnits, observedUnits)
    || result.findings.length > 0
    || result.waitingUnits.length > 0
    || result.omittedUnits.length > 0
    || result.decisions.some((decision) => decision.status !== "eligible")
    || !sameStableValue(
      result.readyUnits,
      expectedUnits.map(({ unitId }) => unitId),
    )
  ) {
    collector.add("dependency-closure-drift", {
      artifactReference: "dependencies.admission-result",
      evidenceExcerpt:
        "Every task unit and upstream dependency must join one eligible complete admission result.",
    });
  }
  return result.evidenceDigest;
}

function waveOrdinal(value) {
  const normalized = text(value);
  return WAVE_ORDINAL_PATTERN.test(normalized)
    ? Number(normalized)
    : null;
}
