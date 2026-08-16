import { TASK_ID_PATTERN } from "./constants.mjs";
import { inspectTaskGraph } from "./graph.mjs";
import { inspectTaskTransitions } from "./state-machine.mjs";
import {
  array,
  object,
  sameStableValue,
  stableJson,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

export function validateTaskPlan(context) {
  const {
    collector,
    evaluator,
    tasks,
    taskById,
    vccs,
    vccById,
  } = context;
  const coverage = new Map(vccs.map((vcc) => [text(vcc?.id), new Set()]));
  const seenVccIds = new Set();
  const seenPropertyIds = new Set();
  const seenTaskIds = new Set();
  const seenTransitionSequences = new Set();
  let stateMachineValid = true;

  for (const vcc of vccs) {
    const vccId = text(vcc?.id);
    if (!vccId || seenVccIds.has(vccId)) {
      collector.add("ungrounded-task", {
        ruleId: "specification-to-task-bridge#1",
        artifactReference: vccId || "vcc-without-id",
        evidenceExcerpt: "Every source VCC requires one globally unique condition identity.",
      });
    }
    seenVccIds.add(vccId);
    for (const property of array(vcc?.correctnessProperties)) {
      const propertyId = text(property?.id);
      if (!propertyId || seenPropertyIds.has(propertyId)) {
        collector.add("unproven-property", {
          ruleId: "verification-strategy#5",
          artifactReference: propertyId || "property-without-id",
          evidenceExcerpt: "Every specification correctness property requires one globally unique identity.",
        });
      }
      seenPropertyIds.add(propertyId);
    }
  }

  for (const task of tasks) {
    const taskId = text(task?.id);
    let previousTransitionSequence = 0;
    if (!taskId || seenTaskIds.has(taskId)) {
      collector.add("ungrounded-task", {
        taskId,
        ruleId: "task-model#1",
        artifactReference: taskId || "task-without-id",
        evidenceExcerpt: "Each task must carry one unique Task ID.",
      });
    }
    seenTaskIds.add(taskId);
    if (!text(task?.wave)) {
      collector.add("ungrounded-task", {
        taskId,
        ruleId: "task-model#17",
        artifactReference: "wave",
        evidenceExcerpt: "Every task must declare its graph wave so write conflicts cannot evade comparison.",
      });
    }
    if (!TASK_ID_PATTERN.test(taskId)) {
      collector.add("oversized-task", {
        taskId,
        ruleId: "task-model#2",
        evidenceExcerpt: "Task IDs are positive hierarchical ordinals with at most two levels.",
      });
    }
    validateSizing(task, collector);
    validateTaskBridge(task, vccById, coverage, collector);
    validateDispatchIdentity(task, context.run, vccById, collector);

    const inspection = inspectTaskTransitions(task);
    if (!inspection.valid) stateMachineValid = false;
    for (const transition of array(task?.transitions)) {
      if (
        !Number.isInteger(transition?.sequence)
        || transition.sequence < 1
        || seenTransitionSequences.has(transition.sequence)
        || transition.sequence <= previousTransitionSequence
      ) {
        stateMachineValid = false;
        collector.add("state-without-reason", {
          taskId,
          ruleId: "checkpoint--recovery#7",
          artifactReference: `transition-sequence:${String(transition?.sequence)}`,
          evidenceExcerpt: "Every transition requires one unique global causal sequence.",
        });
      }
      seenTransitionSequences.add(transition?.sequence);
      if (Number.isInteger(transition?.sequence)) {
        previousTransitionSequence = Math.max(
          previousTransitionSequence,
          transition.sequence,
        );
      }
      if (
        transition?.rederived === true
        && text(transition.derivationRevision)
          !== text(context.run?.derivation?.vccRevision)
      ) {
        stateMachineValid = false;
        collector.add("ungrounded-task", {
          taskId,
          ruleId: "specification-to-task-bridge#6",
          artifactReference: `rederivation:${String(transition?.sequence)}`,
          evidenceExcerpt: "A terminal reset must bind the current VCC derivation revision.",
        });
      }
    }
    for (const violation of inspection.violations) {
      collector.add(
        violation.kind === "invalid-verifier"
          ? "self-graded-verdict"
          : "state-without-reason",
        {
          taskId,
          ruleId: transitionViolationRuleId(violation.kind),
          artifactReference: violation.reference,
          evidenceExcerpt: stateViolationMessage(violation.kind),
        },
      );
    }
    validateVerifiedTask(task, evaluator, collector);
  }

  for (const [vccId, coveringTasks] of coverage) {
    if (coveringTasks.size === 0) {
      collector.add("unexecuted-condition", {
        ruleId: "specification-to-task-bridge#2",
        artifactReference: vccId || "vcc-without-id",
        evidenceExcerpt: "Every VCC must be covered by at least one traced task.",
      });
    }
  }

  const graph = inspectTaskGraph(tasks);
  for (const taskId of graph.cycleNodes) {
    collector.add("task-cycle", {
      taskId,
      ruleId: "task-model#15",
      evidenceExcerpt: "Task dependency graph contains a directed cycle.",
    });
  }
  for (const unknown of graph.unknownDependencies) {
    collector.add("ungrounded-task", {
      taskId: unknown.taskId,
      ruleId: "task-model#15",
      artifactReference: unknown.dependency,
      evidenceExcerpt: "Task dependency does not resolve to a Task ID.",
    });
  }
  for (const conflict of graph.writeConflicts) {
    collector.add("concurrent-write-conflict", {
      taskId: conflict.leftTaskId,
      ruleId: "task-model#17",
      artifactReference: `${conflict.wave}:${conflict.rightTaskId}`,
      evidenceExcerpt: `Concurrent wave writes overlap: ${conflict.artifacts.join(", ")}.`,
    });
  }
  validateDependencyReadiness(tasks, taskById, collector);
  validatePriorTaskIdentity(context.run, tasks, collector);

  const coveredVccCount = [...coverage.values()]
    .filter((taskIds) => taskIds.size > 0).length;
  return Object.freeze({
    graph,
    stateMachineValid,
    coveredVccCount,
    coverageRatio: vccs.length === 0 ? 0 : coveredVccCount / vccs.length,
  });
}

function validateSizing(task, collector) {
  const sizing = object(task?.sizing);
  const taskId = text(task?.id);
  if (
    sizing.withinSingleBudget !== true
    || !Number.isInteger(sizing.verifiableOutcomeCount)
    || sizing.verifiableOutcomeCount !== 1
    || sizing.coherentVccGroup !== true
  ) {
    collector.add("oversized-task", {
      taskId,
      ruleId: "task-model#12",
      evidenceExcerpt: "Task must fit one budget and one coherent verifiable outcome.",
    });
  }
}

function validateTaskBridge(task, vccById, coverage, collector) {
  const taskId = text(task?.id);
  const sourceVccIds = uniqueSortedStrings(task?.sourceVccIds);
  const criterionIdList = uniqueSortedStrings(task?.criterionIds);
  const criterionIds = new Set(criterionIdList);
  const sourceCriterionIds = [];
  const sourceBehaviorClaims = [];
  if (sourceVccIds.length === 0) {
    collector.add("ungrounded-task", {
      taskId,
      ruleId: "specification-to-task-bridge#1",
      evidenceExcerpt: "Task has no source VCC.",
    });
  }
  for (const vccId of sourceVccIds) {
    const vcc = vccById.get(vccId);
    if (!vcc) {
      collector.add("ungrounded-task", {
        taskId,
        ruleId: "specification-to-task-bridge#1",
        artifactReference: vccId,
        evidenceExcerpt: "Task references an unknown source VCC.",
      });
      continue;
    }
    coverage.get(vccId)?.add(taskId);
    const criterionId = text(vcc.criterionId);
    if (criterionId) sourceCriterionIds.push(criterionId);
    sourceBehaviorClaims.push(...uniqueSortedStrings(vcc.behaviorClaims));
    if (!criterionId || !criterionIds.has(criterionId)) {
      collector.add("ungrounded-task", {
        taskId,
        ruleId: "specification-to-task-bridge#3",
        artifactReference: criterionId || vccId,
        evidenceExcerpt: "Task does not record the criterion behind its source VCC.",
      });
    }
  }
  if (
    JSON.stringify(criterionIdList)
    !== JSON.stringify(uniqueSortedStrings(sourceCriterionIds))
  ) {
    collector.add("ungrounded-task", {
      taskId,
      ruleId: "specification-to-task-bridge#3",
      artifactReference: "criterion-join",
      evidenceExcerpt: "Every task criterion must resolve exactly to one of its source VCC criteria.",
    });
  }
  const taskBehaviorClaims = uniqueSortedStrings(task?.behaviorClaims);
  if (
    taskBehaviorClaims.length === 0
    || JSON.stringify(taskBehaviorClaims)
      !== JSON.stringify(uniqueSortedStrings(sourceBehaviorClaims))
    || text(task?.text) !== taskBehaviorClaims.join(" | ")
  ) {
    collector.add("ungrounded-task", {
      taskId,
      ruleId: "specification-to-task-bridge#5",
      artifactReference: "behavior-claim-join",
      evidenceExcerpt: "Task text is the canonical rendering of the exact normative behaviors in its source VCC set.",
    });
  }
}

function validateDispatchIdentity(task, run, vccById, collector) {
  const taskId = text(task?.id);
  const dispatch = object(task?.dispatch);
  const relevantPriorFindings = array(run?.priorFindings).filter((finding) => {
    const reference = text(finding?.artifactReference);
    return reference.startsWith(`task:${taskId}:`)
      || uniqueSortedStrings(task?.declaredWriteSet).some((artifact) =>
        reference === artifact || reference.startsWith(`${artifact}:`));
  });
  const sourceVccIds = uniqueSortedStrings(task?.sourceVccIds);
  const dispatchedVccIds = uniqueSortedStrings(
    array(dispatch.sourceVccs).map((vcc) => vcc?.id),
  );
  const exactVccs = array(dispatch.sourceVccs).length === sourceVccIds.length
    && array(dispatch.sourceVccs).every((vcc) =>
      sameStableValue(vcc, vccById.get(text(vcc?.id))));
  const completeVccs = array(dispatch.sourceVccs).every((vcc) =>
    text(vcc?.id)
    && text(vcc?.criterionId)
    && text(vcc?.endState)
    && text(vcc?.check)
    && text(vcc?.constraint)
    && uniqueSortedStrings(vcc?.behaviorClaims).length > 0);
  const sourceChecksMatch = array(dispatch.sourceVccs).every((vcc) =>
    text(vcc?.check) === text(dispatch.namedCheck));
  if (
    text(dispatch.taskId) !== taskId
    || text(dispatch.text) !== text(task?.text)
    || JSON.stringify(array(dispatch.subTasks).map(text))
      !== JSON.stringify(array(task?.subTasks).map(text))
    || JSON.stringify(dispatchedVccIds) !== JSON.stringify(sourceVccIds)
    || !completeVccs
    || !exactVccs
    || !sourceChecksMatch
    || JSON.stringify(uniqueSortedStrings(dispatch.tracedCriteria))
      !== JSON.stringify(uniqueSortedStrings(task?.criterionIds))
    || !Array.isArray(dispatch.priorFindings)
    || !sameRecordSet(dispatch.priorFindings, relevantPriorFindings)
    || (text(task?.declaredNamedCheck)
      && text(task.declaredNamedCheck) !== text(dispatch.namedCheck))
    || text(task?.declaredExistingVerificationLane)
      !== text(dispatch.existingVerificationLane)
    || text(dispatch.existingVerificationLane)
      !== text(run?.baseline?.existingVerificationLane)
    || !sameStableValue(
      array(task?.declaredPropertyObligations),
      array(dispatch.propertyObligations),
    )
    || !sameStableValue(
      object(task?.declaredCircuitBreaker),
      object(dispatch.circuitBreaker),
    )
    || !text(dispatch.derivationRevision)
    || text(dispatch.derivationRevision) !== text(run?.derivation?.vccRevision)
  ) {
    collector.add("ungrounded-task", {
      taskId,
      ruleId: "specification-to-task-bridge#6",
      artifactReference: "dispatch",
      evidenceExcerpt: "Dispatch identity, source VCCs, criteria, or prior findings are incomplete.",
    });
  }
  const recordCounts = object(task?.recordCounts);
  if (
    Object.keys(recordCounts).length > 0
    && (recordCounts.dispatches !== 1 || recordCounts.returns !== 1)
  ) {
    collector.add(recordCounts.dispatches !== 1
      ? "ungrounded-task"
      : "unsurfaced-result", {
      taskId,
      ruleId: "execution-contract#2",
      artifactReference: "canonical-record-count",
      evidenceExcerpt: "Each task requires exactly one dispatch and one Implementer return.",
    });
  }
}

function sameRecordSet(left, right) {
  return sameStableValue(
    array(left).map(stableJson).sort(),
    array(right).map(stableJson).sort(),
  );
}

function validateVerifiedTask(task, evaluator, collector) {
  if (text(task?.state) !== "verified") return;
  const taskId = text(task?.id);
  const verdict = object(task?.verdict);
  const evaluatorId = text(evaluator?.mechanismId);
  const implementerId = text(task?.return?.implementerMechanismId);
  const finalTransition = [...array(task?.transitions)].reverse()
    .find((transition) => text(transition?.to) === "verified");
  if (
    text(verdict.role) !== "evaluator"
    || text(verdict.mechanismId) !== evaluatorId
    || !evaluatorId
    || evaluatorId === implementerId
    || verdict.evaluatedFromSurfacedOutput !== true
    || verdict.modifiedArtifacts === true
    || text(finalTransition?.role) !== "evaluator"
    || text(finalTransition?.mechanismId) !== evaluatorId
    || text(finalTransition?.artifactRevision)
      !== text(task?.return?.artifactRevision)
  ) {
    collector.add("self-graded-verdict", {
      taskId,
      ruleId: "agent-roles--independence#8",
      artifactReference: "verdict",
      evidenceExcerpt: "Verified requires the named independent Evaluator using surfaced output.",
    });
  }
}

function validateDependencyReadiness(tasks, taskById, collector) {
  for (const task of tasks) {
    const taskId = text(task?.id);
    const dependencies = uniqueSortedStrings(task?.dependencies);
    const sameWaveDependencies = dependencies.filter((dependency) =>
      text(taskById.get(dependency)?.wave) === text(task?.wave));
    if (sameWaveDependencies.length > 0) {
      collector.add("state-without-reason", {
        taskId,
        ruleId: "task-model#16",
        artifactReference: `wave:${text(task?.wave)}`,
        evidenceExcerpt:
          `A task cannot share a concurrent wave with its dependencies: ${sameWaveDependencies.join(", ")}.`,
      });
    }
    for (const readyTransition of array(task?.transitions).filter(
      (transition) => text(transition?.to) === "ready",
    )) {
      const readySequence = readyTransition?.sequence;
      const unmet = dependencies.filter((dependency) => {
        const latestPriorTransition = array(
          taskById.get(dependency)?.transitions,
        )
          .filter((transition) =>
            Number.isInteger(transition?.sequence)
            && Number.isInteger(readySequence)
            && transition.sequence < readySequence)
          .sort((left, right) => right.sequence - left.sequence)[0];
        return text(latestPriorTransition?.to) !== "verified";
      });
      if (unmet.length > 0) {
        collector.add("state-without-reason", {
          taskId,
          ruleId: "task-model#16",
          artifactReference: `${String(readySequence)}:${unmet.join(",")}`,
          evidenceExcerpt:
            "Task became ready while a dependency's latest causal state was not verified.",
        });
      }
    }
  }
}

function validatePriorTaskIdentity(run, tasks, collector) {
  const priorByText = new Map();
  const priorById = new Map();
  for (const task of array(run?.priorTasks)) {
    const taskId = text(task?.id);
    const taskText = text(task?.text);
    if (
      !taskId
      || !taskText
      || priorByText.has(taskText)
      || priorById.has(taskId)
    ) {
      collector.add("oversized-task", {
        taskId,
        ruleId: "task-model#1",
        artifactReference: taskId || "prior-task",
        evidenceExcerpt: "Prior task identity records must be globally unique by both Task ID and unchanged text.",
      });
      continue;
    }
    priorByText.set(taskText, taskId);
    priorById.set(taskId, taskText);
  }
  for (const task of tasks) {
    const priorId = priorByText.get(text(task?.text));
    if (priorId && priorId !== text(task?.id)) {
      collector.add("oversized-task", {
        taskId: text(task?.id),
        ruleId: "task-model#1",
        artifactReference: priorId,
        evidenceExcerpt: "Unchanged task text must retain its stable Task ID.",
      });
    }
  }
}

function stateViolationMessage(kind) {
  const messages = {
    "invalid-ordinal": "Transition ordinals must be positive and strictly increasing.",
    "missing-task-id": "Every transition must record its Task ID.",
    "missing-transition-metadata": "Every transition must bind its producing mechanism and artifact revision.",
    "unknown-state": "Transition uses a state outside the exact state vocabulary.",
    "terminal-transition": "Terminal task state cannot be exited without re-derivation.",
    "invalid-rederivation": "Re-derivation metadata is valid only on an explicit terminal-to-not-started reset.",
    "invalid-transition": "Transition skips or reverses the strictly ordered state machine.",
    "invalid-verifier": "A non-Evaluator attempted to set verified.",
    "invalid-role": "Transition was produced by a role not permitted to set the state.",
    "missing-reason": "Failed, blocked, and abandoned transitions require a reason.",
    "unknown-declared-state": "Task declares a state outside the exact state vocabulary.",
    "state-without-transition": "Declared state has no reconstructable transition.",
    "state-mismatch": "Declared task state differs from its transition ledger.",
  };
  return messages[kind] ?? "Task transition ledger is invalid.";
}

function transitionViolationRuleId(kind) {
  const rules = {
    "invalid-ordinal": "checkpoint--recovery#7",
    "missing-task-id": "task-model#3",
    "missing-transition-metadata": "checkpoint--recovery#7",
    "unknown-state": "task-model#19",
    "terminal-transition": "task-model#21",
    "invalid-rederivation": "task-model#21",
    "invalid-transition": "task-model#19",
    "invalid-verifier": "agent-roles--independence#8",
    "invalid-role": "agent-roles--independence#9",
    "missing-reason": "task-model#20",
    "unknown-declared-state": "task-model#19",
    "state-without-transition": "task-model#22",
    "state-mismatch": "task-model#22",
  };
  return rules[kind] ?? "checkpoint--recovery#7";
}
