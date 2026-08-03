import { isTerminalState } from "./state-machine.mjs";
import {
  array,
  object,
  populatedResult,
  text,
} from "./normalize.mjs";
import { isJoinedPartialState } from "./partial-state.mjs";

export function validateRecoveryAndOperator(context) {
  const persistence = object(context.run?.persistence);
  const recoveryEvents = array(context.run?.recoveryEvents);
  const humanGateEvents = array(context.run?.humanGateEvents);
  const operatorDecisions = array(context.run?.operatorDecisions);
  const persistedRefs = new Set(array(persistence.persistedTransitionRefs).map(text));
  const expectedPersistedRefs = new Set();
  const persistedComponents = new Set(array(persistence.persistedComponents).map(text));
  const terminalRecords = array(context.run?.persistedTerminals);
  const matchedTerminalRecords = new Set();
  const reconstructionCheck = object(persistence.reconstructionCheck);
  let latestTerminal = null;
  let persistenceComplete = persistence.outsideWorkingContext === true
    && persistence.reconstructable === true
    && text(persistence.storageReference).length > 0
    && text(persistence.checkpointDigest).length > 0
    && text(persistence.writerMechanismId).length > 0
    && text(persistence.readerMechanismId).length > 0
    && text(persistence.writerMechanismId)
      !== text(persistence.readerMechanismId)
    && text(persistence.writerMechanismDigest).length > 0
    && text(persistence.readerMechanismDigest).length > 0
    && text(persistence.writerMechanismDigest)
      !== text(persistence.readerMechanismDigest)
    && populatedResult({ ...reconstructionCheck, ran: true })
    && reconstructionCheck.exitCode === 0
    && text(reconstructionCheck.artifactRevision)
      === text(persistence.checkpointDigest)
    && [
      "task-states",
      "transitions",
      "evidence-references",
      "findings",
      "budget-consumption",
    ].every((component) => persistedComponents.has(component));
  if (!identitiesUnique(recoveryEvents, "id")) {
    persistenceComplete = false;
    context.collector.add("unresumable-run", {
      ruleId: "checkpoint--recovery#7",
      artifactReference: "recovery-event-identities",
      evidenceExcerpt: "Every recovery event requires one globally unique identity.",
    });
  }
  for (const task of context.tasks) {
    for (const transition of array(task?.transitions)) {
      if (!isTerminalState(transition?.to)) continue;
      const reference = `${text(task?.id)}:${transition?.ordinal}`;
      expectedPersistedRefs.add(reference);
      if (!persistedRefs.has(reference)) {
        persistenceComplete = false;
        context.collector.add("unresumable-run", {
          taskId: text(task?.id),
          ruleId: "checkpoint--recovery#2",
          artifactReference: reference,
          evidenceExcerpt: "Terminal transition was not persisted outside working context.",
        });
      }
      const matchingTerminals = terminalRecords.filter((terminal) =>
        text(terminal?.taskId) === text(task?.id)
        && text(terminal?.state) === text(transition?.to)
        && terminal?.transitionOrdinal === transition?.ordinal);
      const persistedTerminal = matchingTerminals[0];
      if (
        matchingTerminals.length === 1
        && (
          !latestTerminal
          || transition.sequence > latestTerminal.transition.sequence
        )
      ) {
        latestTerminal = { record: persistedTerminal, transition };
      }
      for (const terminal of matchingTerminals) {
        matchedTerminalRecords.add(terminal);
      }
      if (
        matchingTerminals.length !== 1
        || !text(persistedTerminal.ledgerRevision)
        || !text(persistedTerminal.checkpointDigest)
      ) {
        persistenceComplete = false;
        context.collector.add("unresumable-run", {
          taskId: text(task?.id),
          ruleId: "checkpoint--recovery#7",
          artifactReference: `persisted-terminal:${reference}`,
          evidenceExcerpt: "Terminal checkpoint metadata cannot reconstruct the matching transition.",
        });
      }
      if (
        persistedTerminal
        && persistedTerminal.partialState !== null
        && persistedTerminal.partialState !== undefined
        && !isJoinedPartialState(task, persistedTerminal, transition)
      ) {
        persistenceComplete = false;
        context.collector.add("unresumable-run", {
          taskId: text(task?.id),
          ruleId: "checkpoint--recovery#5",
          artifactReference: `persisted-terminal:${reference}`,
          evidenceExcerpt: "A partially applied task must be checkpointed as failed.",
        });
      }
    }
  }
  if (
    persistedRefs.size !== expectedPersistedRefs.size
    || [...persistedRefs].some((reference) =>
      !expectedPersistedRefs.has(reference))
  ) {
    persistenceComplete = false;
    context.collector.add("unresumable-run", {
      ruleId: "checkpoint--recovery#2",
      artifactReference: "persisted-transition-accounting",
      evidenceExcerpt: "Persisted transition references must equal the complete terminal transition set.",
    });
  }
  if (matchedTerminalRecords.size !== terminalRecords.length) {
    persistenceComplete = false;
    context.collector.add("unresumable-run", {
      ruleId: "checkpoint--recovery#7",
      artifactReference: "persisted-terminal-accounting",
      evidenceExcerpt: "Every persisted terminal must match exactly one recorded terminal transition.",
    });
  }
  if (
    latestTerminal
    && text(latestTerminal.record?.checkpointDigest)
      !== text(persistence.checkpointDigest)
  ) {
    persistenceComplete = false;
    context.collector.add("unresumable-run", {
      taskId: text(latestTerminal.record?.taskId),
      ruleId: "checkpoint--recovery#2",
      artifactReference: "latest-terminal-checkpoint",
      evidenceExcerpt: "The latest persisted terminal must bind the run's reconstructable checkpoint digest.",
    });
  }
  if (!persistenceComplete) {
    context.collector.add("unresumable-run", {
      ruleId: "checkpoint--recovery#2",
      artifactReference: "run-persistence",
      evidenceExcerpt: "Run state is not reconstructable from an external checkpoint.",
    });
  }
  for (const recovery of recoveryEvents) {
    const taskId = text(recovery?.taskId);
    const artifactReference = text(recovery?.id) || "recovery-event";
    const transitions = array(context.taskById.get(taskId)?.transitions);
    const checkpointTransition = transitions.find((transition) =>
      transition?.ordinal === recovery?.checkpointTransitionOrdinal);
    const continuationTransition = transitions.find((transition) =>
      transition?.ordinal === recovery?.continuationTransitionOrdinal);
    const previousTerminalState = text(recovery?.previousTerminalState);
    const recoveryCheck = object(recovery?.recoveryCheck);
    const causalRecovery = (
      checkpointTransition
      && continuationTransition
      && isTerminalState(checkpointTransition.to)
      && checkpointTransition.ordinal < continuationTransition.ordinal
      && checkpointTransition.sequence < continuationTransition.sequence
      && text(continuationTransition.artifactRevision)
        === text(recovery?.artifactRevision)
      && (
        !previousTerminalState
        || text(checkpointTransition.to) === previousTerminalState
      )
      && continuationTransition.rederived === true
      && text(continuationTransition.from)
        === text(checkpointTransition.to)
      && text(continuationTransition.to) === "not-started"
      && recovery?.rederived === true
      && populatedResult({ ...recoveryCheck, ran: true })
      && recoveryCheck.exitCode === 0
      && text(recoveryCheck.artifactRevision)
        === text(recovery?.artifactRevision)
    );
    if (!causalRecovery) {
      context.collector.add("unresumable-run", {
        taskId,
        ruleId: "checkpoint--recovery#7",
        artifactReference,
        evidenceExcerpt: "Recovery must join an exact checkpoint transition to a later artifact-bound continuation.",
      });
    }
    const partialTerminal = terminalRecords.find((terminal) =>
      text(terminal?.taskId) === taskId
      && terminal?.transitionOrdinal === recovery?.checkpointTransitionOrdinal
      && isJoinedPartialState(
        context.taskById.get(taskId),
        terminal,
        checkpointTransition,
      ));
    if (
      recovery?.partialApplied === true
      && (
        text(checkpointTransition?.to) !== "failed"
        || !partialTerminal
      )
    ) {
      context.collector.add("unresumable-run", {
        taskId,
        ruleId: "checkpoint--recovery#5",
        artifactReference,
        evidenceExcerpt: "Partially applied recovery must join a persisted failed checkpoint carrying partial state.",
      });
    }
    if (recovery?.resumed === true && recovery?.artifactReverified !== true) {
      context.collector.add("unresumable-run", {
        taskId,
        ruleId: "checkpoint--recovery#4",
        artifactReference,
        evidenceExcerpt: "Recovery resumed without re-verifying the current artifact state.",
      });
    }
    if (
      previousTerminalState === "verified"
      && recovery?.redispatched === true
      && recovery?.rederived !== true
    ) {
      context.collector.add("unresumable-run", {
        taskId,
        ruleId: "checkpoint--recovery#6",
        artifactReference,
        evidenceExcerpt: "Recovery re-dispatched verified work without explicit re-derivation.",
      });
    }
  }
  for (const taskId of array(persistence.redispatchedVerifiedTaskIds).map(text)) {
    context.collector.add("unresumable-run", {
      taskId,
      ruleId: "checkpoint--recovery#6",
      artifactReference: "verified-redispatch",
      evidenceExcerpt: "Verified task was re-dispatched without an explicit re-derivation.",
    });
  }

  let humanGatesClosed = identitiesUnique(humanGateEvents, "id")
    && identitiesUnique(operatorDecisions, "id");
  if (!humanGatesClosed) {
    context.collector.add("assumed-operator-decision", {
      ruleId: "human-in-the-loop-gates#5",
      artifactReference: "operator-gate-identities",
      evidenceExcerpt: "Operator decisions and human gates require globally unique identities.",
    });
  }
  const gateById = new Map(humanGateEvents.map((gate) => [
    text(gate?.id),
    gate,
  ]));
  for (const gate of humanGateEvents) {
    const taskId = text(gate?.taskId);
    const trigger = text(gate?.trigger);
    const resolution = text(gate?.resolution);
    const gateId = text(gate?.id) || trigger;
    const task = context.taskById.get(taskId);
    const resolved = [
      "approved",
      "authorized",
      "abandoned",
      "refused",
    ].includes(resolution);
    if (resolved) {
      humanGatesClosed = validateDecisionReference(
        gate?.decisionRef,
        context,
        taskId,
        gateId,
        resolution,
      ) && humanGatesClosed;
    } else {
      humanGatesClosed = false;
      if (
        text(task?.state) !== gateRequiredState(trigger)
        || text(gate?.decisionRef)
      ) {
        context.collector.add("assumed-operator-decision", {
          taskId,
          ruleId: "human-in-the-loop-gates#2",
          artifactReference: gateId,
          evidenceExcerpt: "An unresolved gate must carry no decision and leave the task in its trigger-mandated terminal state.",
        });
      }
    }
    if (!validateGateCausality(gate, task, context)) {
      humanGatesClosed = false;
    }
    if (trigger === "boundary-promotion" && resolution !== "refused") {
      humanGatesClosed = false;
      context.collector.add("deploy-boundary-breach", {
        taskId,
        ruleId: "tool-permission--blast-radius#4",
        artifactReference: gateId,
        evidenceExcerpt: "Boundary promotion must be refused during execution, never authorized as a task.",
      });
    }
  }
  for (const task of context.tasks) {
    const taskId = text(task?.id);
    const repeatedFailureGate = humanGateEvents.find((gate) =>
      text(gate?.taskId) === taskId
      && text(gate?.trigger) === "repeated-failure");
    if (failureTriggerFacts(task).triggered && !repeatedFailureGate) {
      humanGatesClosed = false;
      context.collector.add("assumed-operator-decision", {
        taskId,
        ruleId: "human-in-the-loop-gates#2",
        artifactReference: "repeated-failure",
        evidenceExcerpt: "A repeated approach failure or third distinct failed approach requires a recorded human gate.",
      });
    }
    for (const transition of array(task?.transitions).filter((item) =>
      Boolean(text(item?.operatorDecisionRef)))) {
      const matchingGates = humanGateEvents.filter((gate) =>
        text(gate?.taskId) === taskId
        && text(gate?.decisionRef) === text(transition?.operatorDecisionRef));
      if (
        matchingGates.length !== 1
        || !transitionHasCausalGate(transition, matchingGates[0])
      ) {
        humanGatesClosed = false;
        context.collector.add("assumed-operator-decision", {
          taskId,
          ruleId: "human-in-the-loop-gates#5",
          artifactReference: `${taskId}:${String(transition?.ordinal)}`,
          evidenceExcerpt: "A transition decision reference requires one matching resolved gate with the exact causal transition semantics.",
        });
      }
    }
  }
  for (const operation of array(context.irreversibleOperations)) {
    const gate = gateById.get(text(operation?.occurrenceId));
    if (
      !gate
      || text(gate?.trigger) !== "irreversible-operation"
      || text(gate?.taskId) !== text(operation?.taskId)
      || text(gate?.decisionRef) !== text(operation?.decisionRef)
      || !["approved", "authorized"].includes(text(gate?.resolution))
    ) {
      humanGatesClosed = false;
      context.collector.add("ungated-irreversible-operation", {
        taskId: text(operation?.taskId),
        ruleId: "tool-permission--blast-radius#3",
        artifactReference: text(operation?.occurrenceId),
        evidenceExcerpt: "Every irreversible use requires its own blocked gate and authorized continuation.",
      });
    }
  }
  for (const task of context.tasks) {
    for (const transition of array(task?.transitions).filter(
      (item) => text(item?.to) === "abandoned",
    )) {
      const gate = humanGateEvents.find((item) =>
        text(item?.taskId) === text(task?.id)
        && text(item?.resolution) === "abandoned"
        && text(item?.decisionRef) === text(transition?.operatorDecisionRef));
      if (!gate) {
        humanGatesClosed = false;
        context.collector.add("assumed-operator-decision", {
          taskId: text(task?.id),
          ruleId: "human-in-the-loop-gates#5",
          artifactReference: `${text(task?.id)}:${transition?.ordinal}`,
          evidenceExcerpt: "An abandoned transition requires its matching resolved human gate.",
        });
      }
    }
  }
  for (const decision of operatorDecisions) {
    if (!context.usedOperatorDecisionRefs?.has(text(decision?.id))) {
      humanGatesClosed = false;
      context.collector.add("assumed-operator-decision", {
        taskId: text(decision?.taskId),
        ruleId: "human-in-the-loop-gates#5",
        artifactReference: text(decision?.occurrenceId),
        evidenceExcerpt: "Every Operator decision must resolve exactly one recorded occurrence.",
      });
    }
  }
  return Object.freeze({ persistenceComplete, humanGatesClosed });
}

function validateDecisionReference(
  referenceInput,
  context,
  taskId,
  artifactReference,
  expectedResolution,
) {
  const reference = text(referenceInput);
  const decision = context.decisionById.get(reference);
  const decisionIsAbsentOrAssumed = !reference
    || !decisionMatchesResolution(decision, expectedResolution);
  if (
    decisionIsAbsentOrAssumed
    || text(decision?.taskId) !== text(taskId)
    || text(decision?.occurrenceId) !== text(artifactReference)
  ) {
    context.collector.add("assumed-operator-decision", {
      taskId,
      ruleId: decisionIsAbsentOrAssumed
        ? "human-in-the-loop-gates#2"
        : "human-in-the-loop-gates#5",
      artifactReference,
      evidenceExcerpt: "Transition or gate lacks an explicit, auditable Operator decision.",
    });
    return false;
  }
  context.usedOperatorDecisionRefs?.add(reference);
  return true;
}

function decisionMatchesResolution(decisionInput, resolution) {
  const decision = object(decisionInput);
  const options = array(decision.options).map(text);
  const consequences = array(decision.consequences).map(text);
  const expectedChoices = {
    approved: ["approve", "approved"],
    authorized: ["authorize", "authorized"],
    refused: ["refuse", "refused", "deny", "denied"],
    abandoned: ["abandon", "abandoned"],
  };
  const expectedApproval = ["approved", "authorized"].includes(resolution);
  return text(decision.role) === "operator"
    && decision.attestationValid === true
    && decision.explicit === true
    && decision.approved === expectedApproval
    && options.length > 0
    && consequences.length === options.length
    && options.every(Boolean)
    && consequences.every(Boolean)
    && options.includes(text(decision.decision))
    && array(expectedChoices[resolution]).includes(text(decision.decision));
}

function validateGateCausality(gate, task, context) {
  const taskId = text(gate?.taskId);
  const gateId = text(gate?.id) || text(gate?.trigger);
  const trigger = text(gate?.trigger);
  const resolution = text(gate?.resolution);
  const transitions = array(task?.transitions);
  const transitionRefs = transitions.filter((transition) =>
    text(transition?.operatorDecisionRef) === text(gate?.decisionRef));
  let valid = Boolean(task);

  if (resolution === "abandoned") {
    valid = valid
      && text(task?.state) === "abandoned"
      && transitionRefs.length === 1
      && text(transitionRefs[0]?.to) === "abandoned";
  } else if (["approved", "authorized"].includes(resolution)) {
    valid = valid
      && trigger === "irreversible-operation"
      && transitionRefs.length === 1
      && text(transitionRefs[0]?.from) === "blocked"
      && text(transitionRefs[0]?.to) === "not-started"
      && transitionRefs[0]?.rederived === true;
  } else if (resolution === "refused") {
    valid = valid && transitionRefs.length === 0;
  }

  const blocked = transitions.find((transition) =>
    text(transition?.to) === "blocked");
  const failed = transitions.find((transition) =>
    text(transition?.to) === "failed");
  if (["scope-change", "specification-defect"].includes(trigger)) {
    valid = valid
      && Boolean(blocked)
      && Boolean(text(blocked?.reason))
      && (
        resolution === "abandoned"
        || text(task?.state) === "blocked"
      )
      && !["approved", "authorized"].includes(resolution);
  } else if (trigger === "irreversible-operation") {
    valid = valid
      && Boolean(blocked)
      && text(blocked?.reason).includes(gateId)
      && (
        !transitionRefs[0]
        || blocked.sequence < transitionRefs[0].sequence
      );
  } else if (trigger === "budget-reauthorization") {
    valid = valid
      && Boolean(failed)
      && Boolean(text(failed?.reason))
      && text(task?.state) === "failed"
      && !["approved", "authorized"].includes(resolution);
  } else if (trigger === "repeated-failure") {
    const failureFacts = failureTriggerFacts(task);
    valid = valid
      && Boolean(failed)
      && text(task?.state) === "failed"
      && failureFacts.triggered
      && failureFacts.diagnosed
      && !["approved", "authorized"].includes(resolution);
  }
  if (!valid) {
    context.collector.add("assumed-operator-decision", {
      taskId,
      ruleId: "human-in-the-loop-gates#5",
      artifactReference: gateId,
      evidenceExcerpt: "Gate resolution does not match its required blocked or failed causal transition.",
    });
  }
  return valid;
}

function failureTriggerFacts(task) {
  const failedAttempts = array(task?.return?.attempts).filter((attempt) =>
    attempt?.progress === false);
  const approachCounts = new Map();
  for (const attempt of failedAttempts) {
    const approachId = text(attempt?.approachId);
    if (!approachId) continue;
    approachCounts.set(approachId, (approachCounts.get(approachId) ?? 0) + 1);
  }
  const sameApproachTwice = [...approachCounts.values()].some(
    (count) => count >= 2,
  );
  const thirdDistinctFailure = approachCounts.size >= 3;
  return {
    diagnosed: failedAttempts.length > 0
      && failedAttempts.every((attempt) => Boolean(text(attempt?.diagnosis))),
    triggered: sameApproachTwice || thirdDistinctFailure,
  };
}

function transitionHasCausalGate(transition, gate) {
  const resolution = text(gate?.resolution);
  if (resolution === "abandoned") {
    return text(transition?.to) === "abandoned";
  }
  return ["approved", "authorized"].includes(resolution)
    && text(gate?.trigger) === "irreversible-operation"
    && text(transition?.from) === "blocked"
    && text(transition?.to) === "not-started"
    && transition?.rederived === true;
}

function gateRequiredState(trigger) {
  return ["budget-reauthorization", "repeated-failure"].includes(trigger)
    ? "failed"
    : "blocked";
}

function identitiesUnique(records, field) {
  const identities = array(records).map((record) => text(record?.[field]));
  return identities.every(Boolean)
    && new Set(identities).size === identities.length;
}
