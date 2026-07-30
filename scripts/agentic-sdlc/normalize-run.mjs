import { EXECUTION_RUN_SCHEMA } from "./constants.mjs";
import {
  verifyAuthoringAttestation,
  verifyOperatorDecisionAttestation,
  verifyPersistenceAttestation,
} from "./attestation.mjs";
import { computeAuthoringBaselineDigest } from "./baseline-digest.mjs";
import { normalizeGuidelineLoadEvents } from "./guideline-load.mjs";
import { assertCanonicalRunSchema } from "./schema-validation.mjs";
import {
  array,
  object,
  stableJson,
  stableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

const RELEASE_LIFECYCLE_RECEIPT_ORDER = new Map([
  ["agentic-overlap-preservation-receipt/v1\u0000preserved", 0],
  ["agentic-overlap-disposition-receipt/v1\u0000accounted", 1],
  ["agentic-integration-receipt/v2\u0000integrated", 2],
  ["agentic-runtime-review-receipt/v1\u0000reviewed", 3],
  ["agentic-candidate-manifest/v1\u0000awaiting-human-authorization", 4],
  ["agentic-authorization-interaction-receipt/v1\u0000observed", 5],
  ["agentic-human-authorization-receipt/v2\u0000authorized", 6],
  ["agentic-human-authorization-receipt/v2\u0000consumed", 7],
  ["agentic-live-verification-receipt/v1\u0000verified", 8],
  ["agentic-publication-receipt/v1\u0000published", 9],
]);

export function normalizeValidationRequest(input, explicitRuleBindings) {
  const request = object(input);
  const wrappedRun = object(request.run);
  const artifact = text(wrappedRun.schema) ? wrappedRun : request;
  if (text(artifact.schema) !== EXECUTION_RUN_SCHEMA) {
    const ruleBindings = explicitRuleBindings
      ?? request.ruleBindings;
    return {
      run: {
        ...artifact,
        ruleBindings: ruleBindings ?? artifact.ruleBindings,
      },
      sourceSchema: text(artifact.schema),
    };
  }
  return {
    run: normalizeCanonicalRun(artifact),
    sourceSchema: text(artifact.schema),
  };
}

export function normalizeCanonicalRun(artifactInput) {
  const artifact = object(artifactInput);
  assertCanonicalRunSchema(artifact);
  const transitionsByTask = groupedRecords(artifact.transitions, "taskId");
  const dispatchesByTask = groupedRecords(artifact.dispatches, "taskId");
  const returnsByTask = groupedRecords(artifact.returns, "taskId");
  const evaluator = object(artifact.evaluator);
  const operatorDecisions = normalizeDecisions(artifact);
  const taskReturns = new Map();

  const tasks = array(artifact.tasks).map((taskInput) => {
    const task = object(taskInput);
    const taskId = text(task.taskId);
    const dispatchRecords = dispatchesByTask.get(taskId) ?? [];
    const returnRecords = returnsByTask.get(taskId) ?? [];
    const dispatch = object(dispatchRecords[0]);
    const taskReturn = object(returnRecords[0]);
    const grants = normalizeGrants(dispatch.capabilityGrants ?? task.capabilityGrants);
    const declaredPropertyObligations = normalizePropertyObligations(
      task.propertyObligations,
    );
    const propertyObligations = normalizePropertyObligations(
      dispatch.propertyObligations,
    );
    const normalizedReturn = normalizeReturn(taskReturn);
    taskReturns.set(taskId, normalizedReturn);
    const transitions = (transitionsByTask.get(taskId) ?? [])
      .map((transition) => ({
        ...transition,
        operatorDecisionRef: text(transition?.operatorDecisionReference),
      }))
      .sort((left, right) =>
        Number(left.ordinal) - Number(right.ordinal)
        || stableJson(left).localeCompare(stableJson(right), "en"));
    return {
      id: taskId,
      text: text(task.text),
      subTasks: array(task.subtasks).map(text),
      kind: text(task.kind),
      codeBearing: task.codeBearing,
      behaviorKinds: uniqueSortedStrings(task.behaviorKinds),
      behaviorClaims: uniqueSortedStrings(task.behaviorClaims),
      sourceVccIds: uniqueSortedStrings(task.vccIds),
      criterionIds: uniqueSortedStrings(task.criterionIds),
      dependencies: uniqueSortedStrings(task.dependencyIds),
      wave: text(task.waveId),
      declaredWriteSet: uniqueSortedStrings(task.writeSet),
      observedChangedArtifacts: uniqueSortedStrings(task.observedChangedArtifacts),
      sizing: object(task.sizing),
      state: text(task.state),
      declaredLane: text(task.lane),
      declaredNamedCheck: text(task.namedCheck),
      declaredExistingVerificationLane: text(
        task.existingVerificationLane,
      ),
      declaredPropertyObligations,
      declaredCircuitBreaker: object(task.circuitBreaker),
      dispatch: {
        taskId: text(dispatch.taskId),
        text: text(dispatch.taskText),
        subTasks: array(dispatch.subtasks).map(text),
        sourceVccs: array(dispatch.sourceVccs).map(normalizeDispatchVcc),
        tracedCriteria: uniqueSortedStrings(dispatch.criterionIds),
        capabilityGrants: grants,
        budgets: object(dispatch.budgets),
        circuitBreaker: object(dispatch.circuitBreaker),
        lane: text(dispatch.lane),
        priorFindings: dispatch.priorFindings,
        namedCheck: text(dispatch.namedCheck),
        existingVerificationLane: text(dispatch.existingVerificationLane),
        propertyObligations,
        derivationRevision: text(dispatch.derivationRevision),
      },
      effectiveCapabilityGrants: normalizeGrants(task.capabilityGrants),
      effectiveBudgets: object(task.budgets),
      capabilityEvents: array(task.capabilityEvents).map(normalizeCapabilityEvent),
      budgetEvents: array(task.budgetEvents).map((event) => ({
        ...event,
        decisionRef: text(event?.operatorDecisionReference),
      })),
      transitions,
      return: normalizedReturn,
      verdict: object(task.verdict),
      recordCounts: {
        dispatches: dispatchRecords.length,
        returns: returnRecords.length,
      },
    };
  });

  return {
    schema: EXECUTION_RUN_SCHEMA,
    runId: text(artifact.runId),
    ruleBindings: artifact.ruleBindings,
    baseline: {
      baselined: text(artifact.authoringBaseline?.status) === "baselined",
      openAuthoringBlockers: artifact.authoringBaseline?.openBlockerCount,
      vccRevision: text(artifact.authoringBaseline?.vccRevision),
      specificationTokenBudget: artifact.specTokenEstimate,
      digest: text(artifact.authoringBaseline?.digest),
      prdReference: text(artifact.authoringBaseline?.prdReference),
      tadReference: text(artifact.authoringBaseline?.tadReference),
      existingVerificationLane: text(
        artifact.authoringBaseline?.existingVerificationLane,
      ),
      digestValid: text(artifact.authoringBaseline?.digest)
        === computeAuthoringBaselineDigest(
          artifact.authoringBaseline,
          artifact.vccs,
          artifact.specTokenEstimate,
        ),
      attestationValid: verifyAuthoringAttestation(
        artifact.authoringBaseline,
        artifact.vccs,
        artifact.specTokenEstimate,
      ),
    },
    guidelineBaseline: artifact.guidelineBaseline,
    derivation: { vccRevision: text(artifact.derivationRevision) },
    evaluator: {
      mechanismId: text(evaluator.mechanismId),
      mechanismType: text(evaluator.mechanismType),
      mechanismDigest: text(evaluator.mechanismDigest),
      implementerMechanismId: text(evaluator.implementerMechanismId),
      implementerMechanismDigest: text(evaluator.implementerMechanismDigest),
      mechanicallyDistinct: text(evaluator.mechanismId)
        !== text(evaluator.implementerMechanismId)
        && text(evaluator.mechanismDigest)
          !== text(evaluator.implementerMechanismDigest),
    },
    vccs: array(artifact.vccs).map(normalizeVcc),
    tasks,
    evidenceReferences: array(artifact.evidence).map((reference, index) => {
      const taskId = text(reference?.taskId);
      const taskReturn = taskReturns.get(taskId);
      return {
        id: text(reference?.evidenceId)
          || `${text(reference?.conditionId) || "condition"}:${taskId || index}`,
        runId: text(artifact.runId),
        taskId,
        vccId: text(reference?.conditionId),
        namedCheck: text(reference?.checkName),
        checkRunId: text(reference?.checkRunId),
        checkRanInTask: Boolean(taskReturn)
          && text(reference?.checkName) === text(taskReturn?.namedCheck)
          && text(reference?.checkRunId) === text(taskReturn?.checkRunId)
          && text(reference?.artifactRevision) === text(taskReturn?.artifactRevision),
        recordedResult: {
          ...object(reference?.recordedResult),
          ran: true,
        },
        surface: text(reference?.surface),
        artifactRevision: text(reference?.artifactRevision),
      };
    }),
    operatorDecisions,
    persistenceAttestationValid: verifyPersistenceAttestation(artifact),
    humanGateEvents: array(artifact.humanGateEvents).map(normalizeHumanGateEvent),
    persistence: object(artifact.persistence),
    persistedTerminals: array(artifact.persistedTerminals)
      .map((terminal) => ({ ...terminal })),
    recoveryEvents: array(artifact.recoveryEvents).map((event) => ({
      ...event,
      id: text(event?.eventId),
    })),
    deployBoundary: artifact.deployBoundary,
    outboundTransmissions: array(artifact.outboundTransmissions).map((item) =>
      typeof item === "object" && item !== null ? { ...item } : item),
    guidelineLoadEvents: normalizeGuidelineLoadEvents(
      artifact.guidelineLoadCost?.events,
    ),
    governanceLoadCostTokens: array(artifact.guidelineLoadCost?.events)
      .reduce((total, event) => total + Number(event?.tokens ?? 0), 0),
    reportedAggregateConsumption: artifact.consumption,
    canonicalRecordCounts: {
      transitions: array(artifact.transitions).length,
      dispatches: array(artifact.dispatches).length,
      returns: array(artifact.returns).length,
      persistedTerminals: array(artifact.persistedTerminals).length,
    },
    consumedRecordCounts: {
      transitions: tasks.reduce(
        (total, task) => total + array(task.transitions).length,
        0,
      ),
      dispatches: tasks.reduce(
        (total, task) => total + Number(task.recordCounts?.dispatches ?? 0),
        0,
      ),
      returns: tasks.reduce(
        (total, task) => total + Number(task.recordCounts?.returns ?? 0),
        0,
      ),
    },
    orphanTaskReferences: collectOrphanTaskReferences(
      artifact,
      new Set(tasks.map((task) => text(task.id))),
    ),
    priorFindings: artifact.priorFindings,
    priorTasks: array(artifact.priorTasks).map((task) => ({
      id: text(task?.taskId ?? task?.id),
      text: text(task?.text),
    })),
    ...(Object.hasOwn(artifact, "releaseLifecycle")
      ? { releaseLifecycle: normalizeReleaseLifecycle(artifact.releaseLifecycle) }
      : {}),
  };
}

function normalizeReleaseLifecycle(input) {
  const receipts = array(object(input).receipts)
    .map((receipt) => stableValue(receipt))
    .sort((left, right) =>
      releaseLifecycleReceiptRank(left) - releaseLifecycleReceiptRank(right)
      || stableJson(left).localeCompare(stableJson(right), "en"));
  return { receipts };
}

function releaseLifecycleReceiptRank(receipt) {
  const key = `${text(receipt?.schema)}\u0000${text(receipt?.status)}`;
  return RELEASE_LIFECYCLE_RECEIPT_ORDER.get(key)
    ?? RELEASE_LIFECYCLE_RECEIPT_ORDER.size;
}

function normalizeVcc(vcc) {
  const normalized = {
    id: text(vcc?.conditionId ?? vcc?.id),
    criterionId: text(vcc?.criterionId),
    endState: text(vcc?.endState),
    check: text(vcc?.statedCheck ?? vcc?.check),
    constraint: text(vcc?.constraint),
    behaviorClaims: uniqueSortedStrings(vcc?.behaviorClaims),
    correctnessProperties: array(vcc?.correctnessProperties).map((property) => ({
      id: text(property?.propertyId ?? property?.id),
      class: text(property?.propertyClass ?? property?.class),
      statement: text(property?.statement),
      minimumIterations: property?.iterations ?? property?.minimumIterations,
      shrinkingRequired: property?.shrinking ?? property?.shrinkingRequired,
    })),
  };
  if (vcc?.bound !== undefined) {
    normalized.bound = {
      field: text(vcc.bound?.field),
      maximum: vcc.bound?.maximum,
    };
  }
  return normalized;
}

const normalizeDispatchVcc = normalizeVcc;

function normalizeGrants(grantsInput) {
  return array(grantsInput).map((grant) => ({
    class: text(grant?.class),
    uses: [text(grant?.intendedUse)].filter(Boolean),
    writeScope: uniqueSortedStrings(grant?.scope),
    executeScope: uniqueSortedStrings(grant?.scope),
    mutationScope: uniqueSortedStrings(grant?.scope),
    change: text(grant?.intendedUse),
    decisionRef: text(grant?.operatorDecisionReference),
  }));
}

function normalizePropertyObligations(obligationsInput) {
  return array(obligationsInput)
    .map((obligation) => ({
      id: text(obligation?.propertyId),
      class: text(obligation?.propertyClass),
      minimumIterations: obligation?.iterations,
      shrinkingRequired: obligation?.shrinking,
    }))
    .filter((obligation) => obligation.class !== "none");
}

function normalizeReturn(taskReturn) {
  const artifactRevision = text(taskReturn.artifactRevision);
  const namedCheck = text(taskReturn.namedCheck);
  return {
    implementerMechanismId: text(taskReturn.implementerMechanismId),
    implementerMechanismDigest: text(taskReturn.implementerMechanismDigest),
    namedCheck,
    checkRunId: text(taskReturn.checkRunId),
    checkResult: { ...object(taskReturn.namedCheckResult), ran: true },
    existingVerificationLane: {
      ...object(taskReturn.existingVerificationResult),
      ran: true,
      name: text(taskReturn.existingVerificationLane),
    },
    changedArtifacts: uniqueSortedStrings(taskReturn.changedArtifacts),
    consumption: object(taskReturn.consumption),
    constraintViolations: taskReturn.constraintViolations,
    attempts: array(taskReturn.attempts).map((attempt) => ({ ...attempt })),
    automatedTests: object(taskReturn.automatedTests),
    failingFirstWitness: taskReturn.failingFirstWitness,
    propertyResults: array(taskReturn.propertyResults).map((result, index) => ({
      id: text(result?.propertyId ?? result?.id),
      class: text(result?.propertyClass ?? result?.class),
      ran: result?.ran,
      passed: result?.passed,
      iterations: result?.iterations,
      shrinkingEnabled: result?.shrinkingEnabled ?? result?.shrinking,
      checkName: text(result?.checkName),
      checkRunId: text(result?.checkRunId),
      recordedResult: {
        ...object(result?.recordedResult),
        ran: true,
      },
      artifactRevision: text(result?.artifactRevision),
    })),
    artifactRevision,
    idempotencyKey: text(taskReturn.idempotencyKey),
  };
}

function normalizeCapabilityEvent(event) {
  const action = text(event?.action);
  return {
    ...event,
    action: action === "irreversible-use" ? "use" : action,
    capabilityClass: text(event?.capabilityClass),
    actorRole: text(event?.actorRole),
    artifact: text(event?.artifact),
    operationId: text(event?.operationId),
    decisionRef: text(
      event?.decisionRef ?? event?.operatorDecisionReference,
    ),
  };
}

function normalizeHumanGateEvent(event) {
  return {
    ...event,
    id: text(event?.gateId),
    decisionRef: text(
      event?.decisionRef ?? event?.operatorDecisionReference,
    ),
  };
}

function normalizeDecisions(artifact) {
  return array(artifact.operatorDecisions).map((decision) => ({
    ...decision,
    id: text(decision?.reference),
    role: text(decision?.role),
    explicit: decision?.explicit,
    approved: decision?.approved,
    taskId: text(decision?.taskId),
    occurrenceId: text(decision?.occurrenceId),
    decision: text(decision?.decision),
    options: array(decision?.options),
    consequences: array(decision?.consequences),
    attestationValid: verifyOperatorDecisionAttestation(
      artifact.runId,
      decision,
    ),
  }));
}

function groupedRecords(recordsInput, key) {
  const grouped = new Map();
  const records = [...array(recordsInput)].sort((left, right) =>
    text(left?.[key]).localeCompare(text(right?.[key]), "en")
    || stableJson(left).localeCompare(stableJson(right), "en"));
  for (const record of records) {
    const id = text(record?.[key]);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(record);
  }
  return grouped;
}

function collectOrphanTaskReferences(artifact, taskIds) {
  const collections = [
    ["transition", artifact.transitions],
    ["dispatch", artifact.dispatches],
    ["return", artifact.returns],
    ["evidence", artifact.evidence],
    ["persisted-terminal", artifact.persistedTerminals],
    ["recovery-event", artifact.recoveryEvents],
    ["human-gate", artifact.humanGateEvents],
    ["outbound-transmission", artifact.outboundTransmissions],
    ["operator-decision", artifact.operatorDecisions],
  ];
  return collections.flatMap(([recordType, records]) =>
    array(records)
      .map((record, index) => ({
        recordType,
        index,
        taskId: text(record?.taskId),
      }))
      .filter((reference) =>
        reference.taskId && !taskIds.has(reference.taskId)));
}
