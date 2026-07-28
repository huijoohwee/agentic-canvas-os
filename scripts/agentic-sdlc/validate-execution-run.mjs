import {
  BUDGET_FIELDS,
  EXECUTION_FINDING_TYPES,
  EXECUTION_RUN_SCHEMA,
} from "./constants.mjs";
import {
  DEFAULT_SEVERITY,
  FINDING_TYPES,
} from "../alignment-audit/finding.mjs";
import { validateCapabilitiesAndBudgets } from "./capability-budget.mjs";
import { createFindingCollector } from "./findings.mjs";
import { isFindingRulePair } from "./finding-rules.mjs";
import {
  matchesPinnedGuidelineBaseline,
  PINNED_EXECUTION_RULE_CATALOG,
} from "./guideline-baseline.mjs";
import { validateGuidelineLoadEvents } from "./guideline-load.mjs";
import {
  array,
  deepFreeze,
  finiteNonNegative,
  object,
  sumByFields,
  text,
} from "./normalize.mjs";
import { normalizeValidationRequest } from "./normalize-run.mjs";
import { compareFindingSets } from "./regression.mjs";
import { validateRecoveryAndOperator } from "./recovery-operator.mjs";
import { validateTaskPlan } from "./task-plan.mjs";
import {
  validateEvidence,
  validateTaskReturns,
} from "./verification.mjs";

export function validateExecutionRun(input, explicitRuleBindings) {
  const { run: normalizedRun } = normalizeValidationRequest(
    input,
    explicitRuleBindings,
  );
  return evaluateNormalizedExecutionRun(normalizedRun);
}

// Test-only seam for legacy unit fixtures that exercise individual controls
// against the evaluator's normalized shape. It is intentionally not re-exported
// by index.mjs or exposed by the CLI.
export function __validateNormalizedExecutionRunForTests(
  input,
  explicitRuleBindings,
) {
  const artifact = object(input);
  if (text(artifact.schema) !== "agentic-sdlc-normalized-internal/test-v1") {
    throw new TypeError(
      "normalized execution test fixtures require the internal test schema",
    );
  }
  return evaluateNormalizedExecutionRun({
    ...artifact,
    schema: EXECUTION_RUN_SCHEMA,
    ruleBindings: explicitRuleBindings ?? artifact.ruleBindings,
  });
}

function evaluateNormalizedExecutionRun(normalizedRun) {
  const run = object(normalizedRun);
  const collector = createFindingCollector(run.ruleBindings);
  const tasks = array(run.tasks);
  const vccs = array(run.vccs);
  const evidence = array(run.evidenceReferences);
  const evaluator = object(run.evaluator);
  const taskById = new Map(tasks.map((task) => [text(task?.id), task]));
  const vccById = new Map(vccs.map((vcc) => [text(vcc?.id), vcc]));
  const decisions = array(run.operatorDecisions);
  const decisionById = new Map(decisions.map((decision) => [
    text(decision?.id),
    decision,
  ]));
  const context = {
    collector,
    decisionById,
    evidence,
    evaluator,
    irreversibleOperations: [],
    run,
    taskById,
    tasks,
    vccById,
    vccs,
    usedOperatorDecisionRefs: new Set(),
  };

  validateEvaluator(context);
  validatePriorFindingRecords(context);
  const plan = validateTaskPlan(context);
  const capabilityBudget = validateCapabilitiesAndBudgets(context);
  const consumptions = validateTaskReturns(context);
  validateAggregateConsumption(context, consumptions);
  const evidenceResult = validateEvidence(context);
  const recovery = validateRecoveryAndOperator(context);
  const controls = validateRunControls(context, {
    capabilityBudget,
    evidenceResult,
    plan,
    recovery,
  });
  const consumed = sumByFields(consumptions, BUDGET_FIELDS);
  const governanceLoadCostTokens = finiteNonNegative(run.governanceLoadCostTokens)
    ? Number(run.governanceLoadCostTokens)
    : 0;
  const totalTokenConsumption = consumed.tokens + governanceLoadCostTokens;
  const tokenEstimate = Number(run.baseline?.specificationTokenBudget);
  const economicsWithinEstimate = finiteNonNegative(tokenEstimate)
    && totalTokenConsumption <= tokenEstimate;
  if (!economicsWithinEstimate) {
    addControlFinding(context, controls, {
      code: "specification-token-budget-exceeded",
      findingType: "unproven-claim",
      ruleId: "per-task-budgets#4",
      artifactReference: "aggregate-consumption",
      evidenceExcerpt:
        "Per-run token consumption must remain within the specification estimate.",
    });
  }
  const findingResult = collector.finalize();
  const findingComparison = compareFindingSets(
    findingResult.findings,
    run.priorFindings,
  );
  if (findingComparison.newBlockerCount > 0) {
    controls.push("new-blocker-regression");
  }

  const terminalTaskCount = tasks.filter((task) =>
    ["verified", "failed", "blocked", "abandoned"].includes(text(task?.state))).length;
  const controlFailures = [...new Set(controls)].sort((left, right) =>
    left.localeCompare(right, "en"));
  const runtimeReady = findingResult.findings.length === 0
    && controlFailures.length === 0;
  const admissionReady = runtimeReady;
  const readiness = Object.freeze({
    localRung: deriveLocalReadiness(
      vccs.length,
      evidenceResult.satisfiedVccCount,
    ),
    deliveredRung: "undocumented",
  });

  return deepFreeze({
    schema: "agentic-sdlc-execution-conformance/v1",
    runId: text(run.runId),
    runtimeReady,
    admissionReady,
    readiness,
    controlFailures,
    findings: findingResult.findings,
    findingComparison,
    findingCounts: findingResult.findingCounts,
    severityCounts: findingResult.severityCounts,
    metrics: {
      taskCount: tasks.length,
      vccCount: vccs.length,
      coveredVccCount: plan.coveredVccCount,
      bridgeCoverageRatio: plan.coverageRatio,
      transitionCount: tasks.reduce(
        (total, task) => total + array(task?.transitions).length,
        0,
      ),
      terminalTaskCount,
      verifiedTaskCount: tasks.filter((task) => text(task?.state) === "verified").length,
      evidenceReferenceCount: evidence.length,
      satisfiedVccCount: evidenceResult.satisfiedVccCount,
      satisfiedVccIds: evidenceResult.satisfiedVccIds,
      graphAcyclic: plan.graph.acyclic,
      stateMachineValid: plan.stateMachineValid,
      boundaryClosed: capabilityBudget.boundaryClosed
        && text(run.deployBoundary?.state) === "closed",
      persistenceComplete: recovery.persistenceComplete,
      humanGatesClosed: recovery.humanGatesClosed,
      economicsWithinEstimate,
      governanceLoadCostTokens,
      consumption: consumed,
      totalTokenConsumption,
    },
  });
}

function deriveLocalReadiness(vccCount, satisfiedVccCount) {
  if (vccCount === 0) return "undocumented";
  if (satisfiedVccCount === 0) return "spec-complete";
  if (satisfiedVccCount < vccCount) return "dev-proven";
  return "runtime-ready";
}

function validateEvaluator(context) {
  const evaluatorId = text(context.evaluator?.mechanismId);
  const declaredImplementerId = text(
    context.evaluator?.implementerMechanismId,
  );
  const evaluatorDigest = text(context.evaluator?.mechanismDigest);
  const declaredImplementerDigest = text(
    context.evaluator?.implementerMechanismDigest,
  );
  const implementerIds = new Set(context.tasks.map((task) =>
    text(task?.return?.implementerMechanismId)).filter(Boolean));
  const implementerDigests = new Set(context.tasks.map((task) =>
    text(task?.return?.implementerMechanismDigest)).filter(Boolean));
  const unnamed = (
    !evaluatorId
    || !text(context.evaluator?.mechanismType)
    || !declaredImplementerId
    || !evaluatorDigest
    || !declaredImplementerDigest
  );
  if (unnamed) {
    context.collector.add("unnamed-evaluator", {
      ruleId: "agent-roles--independence#7",
      artifactReference: "evaluator",
      evidenceExcerpt:
        "Execution requires a named Evaluator mechanism and Implementer mechanism.",
    });
  }
  if (
    !unnamed
    && (
      context.evaluator?.mechanicallyDistinct !== true
    || implementerIds.has(evaluatorId)
    || implementerDigests.has(evaluatorDigest)
    || evaluatorDigest === declaredImplementerDigest
    || [...implementerIds].some((implementerId) =>
      implementerId !== declaredImplementerId)
    || [...implementerDigests].some((digest) =>
      digest !== declaredImplementerDigest)
  )
  ) {
    context.collector.add("unnamed-evaluator", {
      ruleId: "agent-roles--independence#1",
      artifactReference: "evaluator",
      evidenceExcerpt: "Execution requires a named mechanism mechanically distinct from every Implementer.",
    });
  }
}

function validatePriorFindingRecords(context) {
  for (const finding of array(context.run?.priorFindings)) {
    const findingType = text(finding?.findingType);
    const ruleId = text(finding?.guidelineAnchor);
    if (
      !FINDING_TYPES.includes(findingType)
      || finding?.severity !== DEFAULT_SEVERITY[findingType]
      || !text(PINNED_EXECUTION_RULE_CATALOG[ruleId])
      || !isFindingRulePair(findingType, ruleId)
    ) {
      context.collector.add("unproven-claim", {
        ruleId: "boundary-with-the-authoring-set#2",
        artifactReference: `prior-finding:${findingType || "unknown"}`,
        evidenceExcerpt: "Prior execution findings must preserve the pinned type, severity, and Rule-ID contract.",
      });
    }
  }
}

function validateRunControls(context, results) {
  const failures = [];
  const baseline = object(context.run?.baseline);
  if (
    text(context.run?.schema) !== EXECUTION_RUN_SCHEMA
    || !text(context.run?.runId)
  ) {
    addControlFinding(context, failures, {
      code: "run-schema-invalid",
      findingType: "unproven-claim",
      ruleId: "execution-contract#2",
      artifactReference: "execution-run",
      evidenceExcerpt: "The execution run must use the canonical schema and a stable Run ID.",
    });
  }
  if (
    baseline.baselined !== true
    || baseline.openAuthoringBlockers !== 0
    || !text(baseline.vccRevision)
    || !text(baseline.prdReference)
    || !text(baseline.tadReference)
    || !text(baseline.existingVerificationLane)
    || text(baseline.prdReference) === text(baseline.tadReference)
    || baseline.digestValid !== true
    || baseline.attestationValid !== true
  ) {
    addControlFinding(context, failures, {
      code: "execution-admission-failed",
      findingType: "unproven-claim",
      ruleId: "boundary-with-the-authoring-set#1",
      artifactReference: "authoring-baseline",
      evidenceExcerpt:
        "Execution requires a digest-bound authoring pair, exact VCC revision, and zero open blockers.",
    });
  }
  const guidelineBaseline = object(context.run?.guidelineBaseline);
  if (!matchesPinnedGuidelineBaseline(guidelineBaseline)) {
    addControlFinding(context, failures, {
      code: "guideline-baseline-invalid",
      findingType: "stale-evidence",
      ruleId: "boundary-with-the-authoring-set#2",
      artifactReference: "guideline-baseline",
      evidenceExcerpt:
        "The run guideline baseline does not exactly match the pinned authoring and execution sources.",
    });
  }
  if (
    !text(context.run?.derivation?.vccRevision)
    || text(context.run?.derivation?.vccRevision) !== text(baseline.vccRevision)
  ) {
    addControlFinding(context, failures, {
      code: "task-derivation-stale",
      findingType: "ungrounded-task",
      ruleId: "specification-to-task-bridge#6",
      artifactReference: "task-derivation",
      evidenceExcerpt: "The task derivation revision must match the baselined VCC revision.",
    });
  }
  if (context.tasks.length === 0 || context.vccs.length === 0) {
    addControlFinding(context, failures, {
      code: "empty-execution-plan",
      findingType: "unexecuted-condition",
      ruleId: "specification-to-task-bridge#2",
      artifactReference: "execution-plan",
      evidenceExcerpt: "An execution plan must contain VCCs and tasks that cover them.",
    });
  }
  if (results.plan.coverageRatio !== 1) failures.push("bridge-coverage-incomplete");
  if (!results.plan.graph.acyclic) failures.push("task-graph-cyclic");
  if (!results.plan.stateMachineValid) failures.push("state-machine-invalid");
  if (context.tasks.some((task) =>
    text(task?.dispatch?.lane) !== "authoring"
    || (text(task?.declaredLane) && text(task.declaredLane) !== "authoring"))) {
    addControlFinding(context, failures, {
      code: "lane-not-authoring",
      findingType: "deploy-boundary-breach",
      ruleId: "tool-permission--blast-radius#4",
      artifactReference: "dispatch-lane",
      evidenceExcerpt: "Execution tasks must remain in the authoring lane.",
    });
  }
  const everyTerminal = context.tasks.every((task) =>
    ["verified", "failed", "blocked", "abandoned"].includes(text(task?.state)));
  if (!everyTerminal) {
    addControlFinding(context, failures, {
      code: "nonterminal-task",
      findingType: "unresumable-run",
      ruleId: "checkpoint--recovery#2",
      artifactReference: "task-states",
      evidenceExcerpt: "Runtime readiness requires every task to reach a persisted terminal state.",
    });
  }
  if (!results.evidenceResult.evidenceComplete) {
    addControlFinding(context, failures, {
      code: "evidence-incomplete",
      findingType: "unexecuted-condition",
      ruleId: "verification-strategy#10",
      artifactReference: "evidence-references",
      evidenceExcerpt: "Every satisfied VCC requires one complete Evidence Reference.",
    });
  }
  if (!results.capabilityBudget.boundaryClosed) failures.push("boundary-crossed");
  if (text(context.run?.deployBoundary?.state) !== "closed") {
    addControlFinding(context, failures, {
      code: "deploy-boundary-open",
      findingType: "deploy-boundary-breach",
      ruleId: "tool-permission--blast-radius#4",
      artifactReference: "deploy-boundary",
      evidenceExcerpt: "Execution cannot open or promote across the Deploy Boundary.",
    });
  }
  if (array(context.run?.outboundTransmissions).length > 0) {
    addControlFinding(context, failures, {
      code: "outbound-transmission-during-execution",
      findingType: "deploy-boundary-breach",
      ruleId: "tool-permission--blast-radius#5",
      artifactReference: "outbound-transmissions",
      evidenceExcerpt: "Project content may not cross an external boundary during execution.",
    });
  }
  const orphanReferences = array(context.run?.orphanTaskReferences);
  if (orphanReferences.length > 0) {
    addControlFinding(context, failures, {
      code: "orphan-canonical-record",
      findingType: "unresumable-run",
      ruleId: "task-model#3",
      artifactReference: "canonical-records",
      evidenceExcerpt:
        `Canonical records reference unknown Task IDs: ${orphanReferences
          .map(({ recordType, taskId }) => `${recordType}:${taskId}`)
          .join(", ")}.`,
    });
  }
  const canonicalCounts = object(context.run?.canonicalRecordCounts);
  const consumedCounts = object(context.run?.consumedRecordCounts);
  if (!validateGuidelineLoadEvents(context)) {
    failures.push("guideline-load-unrecorded");
  }
  if (["transitions", "dispatches", "returns"].some(
    (recordType) => canonicalCounts[recordType] !== consumedCounts[recordType],
  )) {
    addControlFinding(context, failures, {
      code: "canonical-record-accounting-mismatch",
      findingType: "unresumable-run",
      ruleId: "checkpoint--recovery#2",
      artifactReference: "canonical-records",
      evidenceExcerpt:
        "Every canonical transition, dispatch, and return must survive normalization and accounting.",
    });
  }
  if (!results.recovery.persistenceComplete) failures.push("persistence-incomplete");
  if (!results.recovery.humanGatesClosed) failures.push("human-gate-open");
  return failures;
}

function validateAggregateConsumption(context, consumptions) {
  const reported = object(context.run?.reportedAggregateConsumption);
  if (Object.keys(reported).length === 0) return;
  const derived = sumByFields(consumptions, BUDGET_FIELDS);
  if (BUDGET_FIELDS.some((field) => reported[field] !== derived[field])) {
    context.collector.add("unrecorded-consumption", {
      ruleId: "per-task-budgets#3",
      artifactReference: "aggregate-consumption",
      evidenceExcerpt: "Run aggregate consumption does not equal the sum of task returns.",
    });
  }
}

function addControlFinding(context, failures, details) {
  failures.push(details.code);
  context.collector.add(details.findingType, {
    ruleId: details.ruleId,
    artifactReference: details.artifactReference,
    evidenceExcerpt: details.evidenceExcerpt,
  });
}
