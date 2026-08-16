import {
  BUDGET_FIELDS,
  PROPERTY_CLASSES,
} from "./constants.mjs";
import {
  array,
  finiteNonNegative,
  object,
  populatedResult,
  sameStableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

export function validateTaskReturns(context) {
  const consumptions = [];
  const receiptOwners = new Map();
  for (const task of context.tasks) {
    const taskReturn = object(task?.return);
    const dispatch = object(task?.dispatch);
    const taskId = text(task?.id);
    const enumerated = uniqueSortedStrings(taskReturn.changedArtifacts);
    const observed = uniqueSortedStrings(task?.observedChangedArtifacts);
    const declared = uniqueSortedStrings(task?.declaredWriteSet);
    const capabilityEvents = array(task?.capabilityEvents);
    const writeReceipts = uniqueSortedStrings(
      capabilityEvents
        .filter((event) =>
          text(event?.action) === "use"
          && text(event?.capabilityClass) === "local-write")
        .map((event) => event?.artifact),
    );
    const automatedTestArtifacts = uniqueSortedStrings(
      taskReturn.automatedTests?.artifacts,
    );
    const automatedTestsValid = taskReturn.automatedTests?.addedOrExtended === true
      && automatedTestArtifacts.length > 0
      && automatedTestArtifacts.every((artifact) =>
        isTestLikePath(artifact)
        && enumerated.includes(artifact)
        && observed.includes(artifact));
    const derivedCodeBearing = text(task?.kind) !== "documentation"
      || enumerated.some((artifact) => !isDocumentationPath(artifact));
    const returnIdentityInvalid = (
      !["feature", "bug-fix", "documentation", "other"].includes(text(task?.kind))
      || typeof task?.codeBearing !== "boolean"
      || task?.codeBearing !== derivedCodeBearing
      || text(taskReturn.namedCheck) !== text(dispatch.namedCheck)
      || !text(dispatch.namedCheck)
      || !text(taskReturn.implementerMechanismId)
      || !text(taskReturn.implementerMechanismDigest)
      || !text(taskReturn.checkRunId)
      || !populatedResult(taskReturn.checkResult)
      || !text(taskReturn.artifactRevision)
      || !text(taskReturn.idempotencyKey)
      || text(taskReturn.checkResult?.checkRunId) !== text(taskReturn.checkRunId)
      || text(taskReturn.checkResult?.artifactRevision)
        !== text(taskReturn.artifactRevision)
      || (text(task?.state) === "verified"
        && taskReturn.checkResult?.exitCode !== 0)
    );
    if (returnIdentityInvalid) {
      context.collector.add("unsurfaced-result", {
        taskId,
        ruleId: "execution-contract#3",
        artifactReference: "task-return",
        evidenceExcerpt: "Return must surface its exact predeclared check, run identity, result, and artifact revision.",
      });
    }
    const existingLaneValid = populatedResult(taskReturn.existingVerificationLane)
      && text(taskReturn.existingVerificationLane?.name)
      && text(taskReturn.existingVerificationLane?.name)
        !== text(taskReturn.namedCheck)
      && text(taskReturn.existingVerificationLane?.checkRunId)
      && text(taskReturn.existingVerificationLane?.artifactRevision)
        === text(taskReturn.artifactRevision)
      && (!text(task?.declaredExistingVerificationLane)
        || text(task.declaredExistingVerificationLane)
          === text(taskReturn.existingVerificationLane?.name))
      && (text(task?.state) !== "verified"
        || taskReturn.existingVerificationLane?.exitCode === 0);
    if (!existingLaneValid) {
      context.collector.add("unsurfaced-result", {
        taskId,
        ruleId: "verification-strategy#4",
        artifactReference: "existing-verification-lane",
        evidenceExcerpt: "Existing verification evidence must bind its check run and current artifact revision.",
      });
    }
    const failingFirst = object(taskReturn.failingFirstWitness);
    const receiptIdentities = [
      ["named-check", text(taskReturn.checkRunId)],
      [
        "existing-verification-lane",
        text(taskReturn.existingVerificationLane?.checkRunId),
      ],
    ];
    if (text(task?.kind) === "bug-fix") {
      receiptIdentities.push([
        "failing-first",
        text(failingFirst.checkRunId),
      ]);
    }
    for (const propertyResult of array(taskReturn.propertyResults)) {
      receiptIdentities.push([
        `property:${text(propertyResult?.id) || "unknown"}`,
        text(propertyResult?.checkRunId),
      ]);
    }
    for (const [receiptKind, checkRunId] of receiptIdentities) {
      if (!checkRunId) continue;
      const owner = receiptOwners.get(checkRunId);
      if (owner) {
        context.collector.add("evidence-without-run", {
          taskId,
          ruleId: "verification-strategy#11",
          artifactReference: checkRunId,
          evidenceExcerpt: `Check-run identity is reused by ${owner.taskId}:${owner.receiptKind} and ${taskId}:${receiptKind}.`,
        });
      } else {
        receiptOwners.set(checkRunId, { taskId, receiptKind });
      }
    }
    if (task?.codeBearing === true && !automatedTestsValid) {
      context.collector.add("unsurfaced-result", {
        taskId,
        ruleId: "verification-strategy#2",
        artifactReference: "automated-tests",
        evidenceExcerpt: "Code-bearing work must surface changed automated-test artifacts.",
      });
    }
    if (
      text(task?.kind) === "documentation"
      && (
        task?.codeBearing !== false
        || enumerated.length === 0
        || !sameStableValue(declared, enumerated)
      )
    ) {
      context.collector.add("unsurfaced-result", {
        taskId,
        ruleId: "task-model#14",
        artifactReference: "documentation-artifact",
        evidenceExcerpt: "Documentation work must predeclare and return the exact nonempty artifact set proven by its named check.",
      });
    }
    if (!Array.isArray(taskReturn.constraintViolations)) {
      context.collector.add("unsurfaced-result", {
        taskId,
        ruleId: "execution-contract#6",
        artifactReference: "constraint-violations",
        evidenceExcerpt: "The Implementer return must explicitly surface constraint violations.",
      });
    } else if (taskReturn.constraintViolations.length > 0) {
      context.collector.add("unexecuted-condition", {
        taskId,
        ruleId: "specification-to-task-bridge#2",
        artifactReference: "constraint-violations",
        evidenceExcerpt: "A task reporting a constraint violation cannot satisfy its source VCC.",
      });
    }

    if (!sameStableValue(enumerated, observed)) {
      context.collector.add("unenumerated-change", {
        taskId,
        ruleId: "execution-contract#5",
        artifactReference: "changed-artifacts",
        evidenceExcerpt: "Returned changed artifacts do not exactly enumerate observed changes.",
      });
    }
    if (!sameStableValue(declared, enumerated)) {
      context.collector.add("unenumerated-change", {
        taskId,
        ruleId: "execution-contract#5",
        artifactReference: "predeclared-write-set",
        evidenceExcerpt: "Every surfaced write must appear in the immutable pre-dispatch write set.",
      });
    }
    if (!sameStableValue(writeReceipts, enumerated)) {
      context.collector.add("unenumerated-change", {
        taskId,
        ruleId: "execution-contract#5",
        artifactReference: "local-write-receipts",
        evidenceExcerpt: "Every changed artifact must map one-to-one to a Local write capability-use receipt.",
      });
    }
    for (const [checkName, checkRunId, receiptKind] of [
      [taskReturn.namedCheck, taskReturn.checkRunId, "named-check"],
      [
        taskReturn.existingVerificationLane?.name,
        taskReturn.existingVerificationLane?.checkRunId,
        "existing-verification-lane",
      ],
    ]) {
      const matchingReceipts = capabilityEvents.filter((event) =>
        text(event?.action) === "use"
        && text(event?.capabilityClass) === "local-execute"
        && text(event?.artifact) === text(checkName)
        && text(event?.operationId) === text(checkRunId));
      if (matchingReceipts.length !== 1) {
        context.collector.add("evidence-without-run", {
          taskId,
          ruleId: "verification-strategy#11",
          artifactReference: receiptKind,
          evidenceExcerpt: "Each surfaced check requires one exact Local execute capability-use receipt.",
        });
      }
    }

    const consumption = object(taskReturn.consumption);
    consumptions.push(consumption);
    if (BUDGET_FIELDS.some((field) => !finiteNonNegative(consumption[field]))) {
      context.collector.add("unrecorded-consumption", {
        taskId,
        ruleId: "per-task-budgets#3",
        artifactReference: "consumption",
        evidenceExcerpt: "Return must record tokens, iterations, wall-clock, and context consumption.",
      });
    }
    validateAttemptAccounting(task, context.collector);
    validateBudgetConsumption(task, context.collector);
    validateFailingFirst(task, context.collector);
    validateProperties(task, context.vccById, context.collector);
  }
  return consumptions;
}

function isDocumentationPath(pathInput) {
  return /\.(?:md|mdx|txt|adoc|rst)$/iu.test(text(pathInput));
}

export function validateEvidence(context) {
  const evidence = context.evidence;
  const evidenceByVcc = new Map();
  const satisfyingByVcc = new Map();
  const evidenceIds = new Set();
  for (const reference of evidence) {
    const evidenceId = text(reference?.id);
    if (!evidenceId || evidenceIds.has(evidenceId)) {
      context.collector.add("evidence-without-run", {
        taskId: text(reference?.taskId),
        ruleId: "verification-strategy#10",
        artifactReference: evidenceId || "evidence-reference",
        evidenceExcerpt: "Every Evidence Reference requires one globally unique identity.",
      });
    }
    evidenceIds.add(evidenceId);
    const vccId = text(reference?.vccId);
    if (!evidenceByVcc.has(vccId)) evidenceByVcc.set(vccId, []);
    evidenceByVcc.get(vccId).push(reference);
    const taskId = text(reference?.taskId);
    const task = context.taskById.get(taskId);
    const taskReturn = object(task?.return);
    const satisfying = (
      Boolean(task)
      && context.vccById.has(vccId)
      && uniqueSortedStrings(task?.sourceVccIds).includes(vccId)
      && text(task?.state) === "verified"
      && text(reference?.runId) === text(context.run?.runId)
      && text(reference?.surface) === "authoring"
      && text(reference?.namedCheck) === text(taskReturn.namedCheck)
      && text(reference?.checkRunId) === text(taskReturn.checkRunId)
      && Boolean(text(reference?.checkRunId))
      && populatedResult(reference?.recordedResult)
      && sameStableValue(reference?.recordedResult, taskReturn.checkResult)
      && text(reference?.recordedResult?.checkRunId)
        === text(reference?.checkRunId)
      && text(reference?.recordedResult?.artifactRevision)
        === text(reference?.artifactRevision)
      && text(reference?.artifactRevision) === text(taskReturn.artifactRevision)
      && reference?.recordedResult?.exitCode === 0
      && array(taskReturn.constraintViolations).length === 0
      && reference?.checkRanInTask === true
    );
    if (!satisfying) {
      context.collector.add("evidence-without-run", {
        taskId,
        ruleId: populatedResult(reference?.recordedResult)
          ? "verification-strategy#11"
          : "verification-strategy#12",
        artifactReference: text(reference?.id) || vccId || "evidence-reference",
        evidenceExcerpt: "Evidence must bind a verified task, VCC, run, check run, concrete result, and authoring surface.",
      });
    } else {
      if (!satisfyingByVcc.has(vccId)) satisfyingByVcc.set(vccId, []);
      satisfyingByVcc.get(vccId).push(reference);
    }
  }
  const satisfiedVccIds = [];
  for (const vcc of context.vccs) {
    const vccId = text(vcc?.id);
    const references = evidenceByVcc.get(vccId) ?? [];
    const satisfyingReferences = satisfyingByVcc.get(vccId) ?? [];
    const verifiedCoverage = context.tasks.some((task) =>
      text(task?.state) === "verified"
      && uniqueSortedStrings(task?.sourceVccIds).includes(vccId));
    if (verifiedCoverage && (
      references.length !== 1
      || satisfyingReferences.length !== 1
    )) {
      context.collector.add("evidence-without-run", {
        ruleId: "verification-strategy#10",
        artifactReference: vccId,
        evidenceExcerpt: "Each satisfied VCC must have exactly one canonical Evidence Reference.",
      });
    }
    if (references.length === 1 && satisfyingReferences.length === 1) {
      satisfiedVccIds.push(vccId);
    }
  }
  return Object.freeze({
    evidenceComplete: context.vccs.length > 0
      && satisfiedVccIds.length === context.vccs.length,
    satisfiedVccCount: satisfiedVccIds.length,
    satisfiedVccIds: Object.freeze([...satisfiedVccIds].sort((left, right) =>
      left.localeCompare(right, "en"))),
  });
}

function validateAttemptAccounting(task, collector) {
  const taskId = text(task?.id);
  const attempts = array(task?.return?.attempts);
  const consumedIterations = task?.return?.consumption?.iterations;
  const attemptsExactlyAccounted = (
    Array.isArray(task?.return?.attempts)
    && attempts.length > 0
    && Number.isInteger(consumedIterations)
    && consumedIterations >= 0
    && attempts.length === consumedIterations
    && attempts.every((attempt, index) =>
      attempt?.iteration === index + 1
      && typeof attempt?.progress === "boolean")
  );
  if (!attemptsExactlyAccounted) {
    collector.add("unrecorded-consumption", {
      taskId,
      ruleId: "per-task-budgets#3",
      artifactReference: "attempt-consumption",
      evidenceExcerpt: "Attempt ordinals must be contiguous and exactly match recorded iteration consumption.",
    });
  }
}

function validateBudgetConsumption(task, collector) {
  const budgets = object(task?.dispatch?.budgets);
  const consumption = object(task?.return?.consumption);
  const exceeded = BUDGET_FIELDS.filter((field) =>
    finiteNonNegative(consumption[field])
    && Number(consumption[field]) > Number(budgets[field]));
  if (exceeded.length > 0) {
    collector.add("budget-raised-under-pressure", {
      taskId: text(task?.id),
      ruleId: "per-task-budgets#2",
      artifactReference: exceeded.join(","),
      evidenceExcerpt: "Task consumption exceeded an immutable declared bound.",
    });
  }
}

function validateFailingFirst(task, collector) {
  if (text(task?.kind) !== "bug-fix") return;
  const witness = object(task?.return?.failingFirstWitness);
  const result = object(witness.recordedResult);
  const capabilityEvents = array(task?.capabilityEvents);
  const matchingReceipts = capabilityEvents.filter((event) =>
    text(event?.action) === "use"
    && text(event?.capabilityClass) === "local-execute"
    && text(event?.artifact) === text(witness.check)
    && text(event?.operationId) === text(witness.checkRunId));
  const firstWriteOrdinal = capabilityEvents
    .filter((event) =>
      text(event?.action) === "use"
      && text(event?.capabilityClass) === "local-write")
    .reduce((minimum, event) =>
      Math.min(minimum, Number(event?.ordinal)), Number.POSITIVE_INFINITY);
  if (
    witness.ranBeforeFix !== true
    || witness.failedOnUnfixed !== true
    || !text(witness.check)
    || !text(witness.checkRunId)
    || !text(witness.unfixedArtifactRevision)
    || text(witness.unfixedArtifactRevision)
      === text(task?.return?.artifactRevision)
    || !populatedResult({ ...result, ran: true })
    || result.exitCode === 0
    || text(result.checkRunId) !== text(witness.checkRunId)
    || text(result.artifactRevision)
      !== text(witness.unfixedArtifactRevision)
    || matchingReceipts.length !== 1
    || !Number.isInteger(matchingReceipts[0]?.ordinal)
    || matchingReceipts[0].ordinal >= firstWriteOrdinal
  ) {
    collector.add("fix-without-witness", {
      taskId: text(task?.id),
      ruleId: "verification-strategy#3",
      artifactReference: "failing-first-witness",
      evidenceExcerpt: "Bug-fixing task lacks an artifact-bound failing check receipt from the unfixed state.",
    });
  }
}

function validateProperties(task, vccById, collector) {
  const taskId = text(task?.id);
  const obligations = array(task?.dispatch?.propertyObligations);
  const results = array(task?.return?.propertyResults);
  const capabilityEvents = array(task?.capabilityEvents);
  const artifactRevision = text(task?.return?.artifactRevision);
  const sourceProperties = uniqueSortedStrings(task?.sourceVccIds)
    .flatMap((vccId) => array(vccById.get(vccId)?.correctnessProperties));
  const sourcePropertyIds = sourceProperties.map((property) => text(property?.id));
  const required = uniqueProperties(sourceProperties);
  required.push(...obligations
    .filter((obligation) => text(obligation?.class) !== "none"));
  const malformedProperties = uniqueSortedStrings(task?.sourceVccIds)
    .flatMap((vccId) => array(vccById.get(vccId)?.correctnessProperties))
    .some((property) =>
      !text(property?.id)
      || !text(property?.class)
      || !text(property?.statement)
      || !Number.isInteger(property?.minimumIterations)
      || property.minimumIterations < 2
      || property?.shrinkingRequired !== true);
  const behaviorKinds = new Set(uniqueSortedStrings(task?.behaviorKinds));
  if (
    (behaviorKinds.has("parser") || behaviorKinds.has("serialiser"))
    && !required.some((property) => text(property?.class) === "round-trip")
  ) {
    required.push({ id: "behavior:round-trip", class: "round-trip" });
  }
  if (
    behaviorKinds.has("ordering")
    || behaviorKinds.has("dedup")
    || behaviorKinds.has("aggregation")
  ) {
    const hasInvariantClass = obligations.some((item) =>
      ["invariant", "metamorphic"].includes(text(item?.class)));
    if (!hasInvariantClass) {
      required.push({ id: "behavior:ordering-invariant", class: "invariant" });
    }
  }
  const uniqueRequired = uniqueProperties(required);
  const requiredIds = new Set(uniqueRequired.map((property) => text(property?.id)));
  const obligationIds = obligations.map((item) => text(item?.id));
  const resultIds = results.map((item) => text(item?.id));
  if (
    new Set(sourcePropertyIds).size !== sourcePropertyIds.length
    || sourcePropertyIds.some((id) => !id)
    || new Set(obligationIds).size !== obligationIds.length
    || new Set(resultIds).size !== resultIds.length
    || obligationIds.some((id) => !requiredIds.has(id))
    || resultIds.some((id) => !requiredIds.has(id))
  ) {
    collector.add("unproven-property", {
      taskId,
      ruleId: "verification-strategy#5",
      artifactReference: "property-record-accounting",
      evidenceExcerpt: "Specification properties, obligations, and results must map one-to-one by unique property ID.",
    });
  }
  for (const property of uniqueRequired) {
    const propertyId = text(property?.id);
    const propertyClass = text(property?.class);
    const obligation = obligations.find((item) => text(item?.id) === propertyId);
    const result = results.find((item) => text(item?.id) === propertyId);
    const sourceProperty = sourceProperties.find((item) =>
      text(item?.id) === propertyId);
    const executionRuleId = propertyExecutionRuleId(
      propertyClass,
      behaviorKinds,
    );
    const recordedResult = object(result?.recordedResult);
    const recordedCounts = object(recordedResult.counts);
    const iterationMeasurement = array(recordedResult.measurements).find(
      (measurement) =>
        text(measurement?.name) === "generated_iterations"
        && measurement?.observed === result?.iterations
        && text(measurement?.comparator) === "eq"
        && measurement?.expected === result?.iterations,
    );
    const propertyVolumeProven = recordedResult.counts !== undefined
      ? recordedCounts.total === result?.iterations
        && recordedCounts.passed === result?.iterations
        && recordedCounts.failed === 0
        && recordedCounts.errored === 0
      : Boolean(iterationMeasurement);
    const matchingReceipts = capabilityEvents.filter((event) =>
      text(event?.action) === "use"
      && text(event?.capabilityClass) === "local-execute"
      && text(event?.artifact) === text(result?.checkName)
      && text(event?.operationId) === text(result?.checkRunId));
    if (
      !obligation
      || !result
      || result?.ran !== true
      || result?.passed !== true
      || !text(result?.checkName)
      || !text(result?.checkRunId)
      || !populatedResult(recordedResult)
      || recordedResult.exitCode !== 0
      || text(recordedResult.checkRunId) !== text(result?.checkRunId)
      || text(recordedResult.artifactRevision) !== artifactRevision
      || text(result?.artifactRevision) !== artifactRevision
      || matchingReceipts.length !== 1
      || !propertyVolumeProven
    ) {
      collector.add("unproven-property", {
        taskId,
        ruleId: executionRuleId,
        artifactReference: propertyId || "correctness-property",
        evidenceExcerpt: "Correctness property lacks a matching obligation, artifact-bound result, or exact Local execute receipt.",
      });
    }
    if (
      !PROPERTY_CLASSES.includes(propertyClass)
      || text(obligation?.class) !== propertyClass
      || text(result?.class) !== propertyClass
    ) {
      collector.add("unproven-property", {
        taskId,
        ruleId: "verification-strategy#8",
        artifactReference: propertyId || "correctness-property",
        evidenceExcerpt: "Correctness property, obligation, and result must state the same supported property class.",
      });
    }
    if (
      !Number.isInteger(obligation?.minimumIterations)
      || obligation.minimumIterations < 2
      || obligation?.shrinkingRequired !== true
      || (
        sourceProperty
        && (
          obligation.minimumIterations !== sourceProperty.minimumIterations
          || obligation.shrinkingRequired !== sourceProperty.shrinkingRequired
        )
      )
      || !Number.isInteger(result?.iterations)
      || result.iterations !== obligation.minimumIterations
      || result?.shrinkingEnabled !== true
    ) {
      collector.add("unproven-property", {
        taskId,
        ruleId: "verification-strategy#9",
        artifactReference: propertyId || "correctness-property",
        evidenceExcerpt: "Correctness property lacks a repeated, minimum-bound, shrinking-enabled result.",
      });
    }
  }
  if (malformedProperties) {
    collector.add("unproven-property", {
      taskId,
      ruleId: "verification-strategy#8",
      artifactReference: "malformed-correctness-property",
      evidenceExcerpt: "Every stated correctness property requires an ID and explicit property class.",
    });
  }
}

function propertyExecutionRuleId(propertyClass, behaviorKinds) {
  if (
    propertyClass === "round-trip"
    && (behaviorKinds.has("parser") || behaviorKinds.has("serialiser"))
  ) {
    return "verification-strategy#6";
  }
  if (
    ["invariant", "metamorphic"].includes(propertyClass)
    && (
      behaviorKinds.has("ordering")
      || behaviorKinds.has("dedup")
      || behaviorKinds.has("aggregation")
    )
  ) {
    return "verification-strategy#7";
  }
  return "verification-strategy#5";
}

function uniqueProperties(properties) {
  const byId = new Map();
  for (const property of array(properties)) {
    const id = text(property?.id);
    if (id && !byId.has(id)) byId.set(id, property);
  }
  return [...byId.values()];
}

function isTestLikePath(artifactInput) {
  const artifact = text(artifactInput)
    .replaceAll("\\", "/")
    .toLowerCase();
  const segments = artifact.split("/").filter(Boolean);
  const basename = segments.at(-1) ?? "";
  return segments.some((segment) =>
    ["test", "tests", "__tests__", "spec", "specs"].includes(segment))
    || /(?:^|[._-])(?:test|tests|spec)(?:[._-]|$)/u.test(basename);
}
