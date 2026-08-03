import {
  BUDGET_FIELDS,
  CAPABILITY_CLASSES,
  EXACT_CIRCUIT_BREAKER_LIMIT,
} from "./constants.mjs";
import { validateAttemptIdempotency } from "./attempt-idempotency.mjs";
import {
  array,
  finitePositive,
  object,
  pathWithinScope,
  sameStableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";
import { isJoinedPartialState } from "./partial-state.mjs";

export function validateCapabilitiesAndBudgets(context) {
  let boundaryClosed = true;
  for (const task of context.tasks) {
    const dispatch = object(task?.dispatch);
    const taskId = text(task?.id);
    const grants = array(dispatch.capabilityGrants);
    const grantsByClass = new Map();
    for (const grant of grants) {
      const capabilityClass = text(grant?.class);
      if (!grantsByClass.has(capabilityClass)) grantsByClass.set(capabilityClass, []);
      grantsByClass.get(capabilityClass).push(grant);
      if (
        !CAPABILITY_CLASSES.includes(capabilityClass)
        || array(grant?.uses).map(text).filter(Boolean).length === 0
        || (capabilityClass === "environment-mutate" && !text(grant?.change))
      ) {
        context.collector.add("self-escalated-capability", {
          taskId,
          ruleId: "tool-permission--blast-radius#1",
          artifactReference: capabilityClass || "capability-grant",
          evidenceExcerpt: "Grant is unknown, unused, or lacks its declared use.",
        });
      }
      if (
        capabilityClass === "local-write"
        && uniqueSortedStrings(grant?.writeScope).length === 0
      ) {
        context.collector.add("out-of-scope-write", {
          taskId,
          ruleId: "tool-permission--blast-radius#6",
          artifactReference: "local-write-grant",
          evidenceExcerpt: "Local write grant has no predeclared write scope.",
        });
      }
      if (
        capabilityClass === "local-execute"
        && uniqueSortedStrings(
          grant?.executeScope ?? grant?.writeScope,
        ).length === 0
      ) {
        context.collector.add("self-escalated-capability", {
          taskId,
          ruleId: "tool-permission--blast-radius#1",
          artifactReference: "local-execute-grant",
          evidenceExcerpt: "Local execute grant has no predeclared exact command scope.",
        });
      }
      if (
        capabilityClass === "environment-mutate"
        && uniqueSortedStrings(
          grant?.mutationScope ?? grant?.writeScope,
        ).length === 0
      ) {
        context.collector.add("self-escalated-capability", {
          taskId,
          ruleId: "tool-permission--blast-radius#1",
          artifactReference: "environment-mutate-grant",
          evidenceExcerpt: "Environment mutation has no exact predeclared target.",
        });
      }
      if (capabilityClass === "boundary-crossing") {
        boundaryClosed = false;
        context.collector.add("deploy-boundary-breach", {
          taskId,
          ruleId: "tool-permission--blast-radius#4",
          artifactReference: "boundary-crossing-grant",
          evidenceExcerpt: "Boundary-crossing capability is forbidden in an execution task.",
        });
      }
    }
    boundaryClosed = validateCapabilityEvents(
      task,
      grantsByClass,
      context,
    ) && boundaryClosed;
    validateGrantUseAccounting(task, grantsByClass, context.collector);
    validateWriteScope(task, grantsByClass, context.collector);
    validateBudget(task, context);
  }
  return Object.freeze({ boundaryClosed });
}

function validateCapabilityEvents(task, grantsByClass, context) {
  const taskId = text(task?.id);
  let boundaryClosed = true;
  const usedDecisionRefs = context.usedOperatorDecisionRefs
    ?? context.irreversibleDecisionRefs
    ?? new Set();
  const eventOrdinals = new Set();
  const operationIds = new Set();
  for (const event of array(task?.capabilityEvents)) {
    const capabilityClass = text(event?.capabilityClass);
    const action = text(event?.action);
    const artifact = text(event?.artifact);
    const operationId = text(event?.operationId);
    const decisionRef = text(event?.decisionRef);
    if (
      !Number.isInteger(event?.ordinal)
      || event.ordinal < 1
      || eventOrdinals.has(event.ordinal)
      || (operationId && operationIds.has(operationId))
    ) {
      context.collector.add("self-escalated-capability", {
        taskId,
        ruleId: "tool-permission--blast-radius#2",
        artifactReference: operationId || "capability-event",
        evidenceExcerpt: "Capability events require unique positive ordinals and operation identities.",
      });
    }
    eventOrdinals.add(event?.ordinal);
    if (operationId) operationIds.add(operationId);
    if (
      action === "use"
      && (
        (["read", "local-write", "local-execute", "environment-mutate"]
          .includes(capabilityClass) && (!artifact || !operationId))
        || (
          ["irreversible", "boundary-crossing"]
            .includes(capabilityClass)
          && !operationId
        )
      )
    ) {
      context.collector.add("self-escalated-capability", {
        taskId,
        ruleId: "tool-permission--blast-radius#1",
        artifactReference: operationId || capabilityClass,
        evidenceExcerpt: "Capability use lacks the exact target or operation identity required by its class.",
      });
    }
    if (
      decisionRef
      && !(action === "use" && capabilityClass === "irreversible")
    ) {
      context.collector.add("assumed-operator-decision", {
        taskId,
        ruleId: "human-in-the-loop-gates#2",
        artifactReference: operationId || capabilityClass,
        evidenceExcerpt: "Only an irreversible capability use may carry an Operator decision reference.",
      });
    }
    if (capabilityClass === "boundary-crossing") {
      boundaryClosed = false;
      context.collector.add("deploy-boundary-breach", {
        taskId,
        ruleId: "tool-permission--blast-radius#4",
        artifactReference: text(event?.operationId) || "boundary-crossing",
        evidenceExcerpt: "Boundary-crossing capability is forbidden during execution.",
      });
    }
    if (event?.externalTransmission === true) {
      boundaryClosed = false;
      context.collector.add("deploy-boundary-breach", {
        taskId,
        ruleId: "tool-permission--blast-radius#5",
        artifactReference: text(event?.operationId) || "external-transmission",
        evidenceExcerpt: "Execution event transmitted project content across its boundary.",
      });
    }
    if (action === "request-elevation") {
      if (text(task?.state) !== "blocked" || text(event?.actorRole) !== "implementer") {
        context.collector.add("self-escalated-capability", {
          taskId,
          ruleId: "tool-permission--blast-radius#2",
          artifactReference: text(event?.operationId) || capabilityClass,
          evidenceExcerpt: "Capability elevation request must stop the task as blocked.",
        });
      }
      continue;
    }
    if (
      ["grant", "widen"].includes(action)
      || !grantsByClass.has(capabilityClass)
      || text(event?.actorRole) !== "implementer"
    ) {
      context.collector.add("self-escalated-capability", {
        taskId,
        ruleId: "tool-permission--blast-radius#2",
        artifactReference: text(event?.operationId) || capabilityClass,
        evidenceExcerpt: "Capability was widened, ungranted, or exercised by the wrong role.",
      });
    }
    if (capabilityClass === "local-write" && artifact) {
      const scopes = grantsByClass.get("local-write")
        ?.flatMap((grant) => uniqueSortedStrings(grant?.writeScope)) ?? [];
      if (!scopes.some((scope) => pathWithinScope(artifact, scope))) {
        context.collector.add("out-of-scope-write", {
          taskId,
          ruleId: "tool-permission--blast-radius#6",
          artifactReference: artifact,
          evidenceExcerpt: "Local write event falls outside its dispatch grant scope.",
        });
      }
    }
    if (capabilityClass === "local-execute" && action === "use") {
      const commands = grantsByClass.get("local-execute")
        ?.flatMap((grant) => uniqueSortedStrings(
          grant?.executeScope ?? grant?.writeScope,
        )) ?? [];
      if (!commands.includes(artifact)) {
        context.collector.add("self-escalated-capability", {
          taskId,
          ruleId: "tool-permission--blast-radius#1",
          artifactReference: artifact || "local-execute",
          evidenceExcerpt: "Local execute use was not one of the exact commands named at dispatch.",
        });
      }
    }
    if (capabilityClass === "environment-mutate" && action === "use") {
      const targets = grantsByClass.get("environment-mutate")
        ?.flatMap((grant) => uniqueSortedStrings(
          grant?.mutationScope ?? grant?.writeScope,
        )) ?? [];
      if (!artifact || !targets.includes(artifact)) {
        context.collector.add("self-escalated-capability", {
          taskId,
          ruleId: "tool-permission--blast-radius#1",
          artifactReference: artifact || "environment-mutate",
          evidenceExcerpt: "Environment mutation did not match the exact change target named at dispatch.",
        });
      }
    }
    if (capabilityClass === "irreversible" && action === "use") {
      const decision = context.decisionById.get(decisionRef);
      const occurrenceId = text(event?.operationId);
      if (
        !decisionRef
        || !isExplicitDecision(decision)
        || text(decision?.occurrenceId) !== occurrenceId
        || text(decision?.taskId) !== taskId
      ) {
        context.collector.add("ungated-irreversible-operation", {
          taskId,
          ruleId: "tool-permission--blast-radius#3",
          artifactReference: occurrenceId || "irreversible-operation",
          evidenceExcerpt: "Irreversible operation lacks one explicit Operator decision for this occurrence.",
        });
      }
      if (decisionRef) {
        usedDecisionRefs.add(decisionRef);
        context.irreversibleOperations?.push({
          taskId,
          occurrenceId,
          decisionRef,
        });
      }
    }
  }
  const effective = array(task?.effectiveCapabilityGrants);
  if (effective.length > 0 && !sameStableValue(effective, array(task?.dispatch?.capabilityGrants))) {
    context.collector.add("self-escalated-capability", {
      taskId,
      ruleId: "tool-permission--blast-radius#2",
      artifactReference: "effective-capability-grants",
      evidenceExcerpt: "Effective grants differ from immutable dispatch grants.",
    });
  }
  return boundaryClosed;
}

function validateGrantUseAccounting(task, grantsByClass, collector) {
  const taskId = text(task?.id);
  const usesByClass = new Map();
  for (const event of array(task?.capabilityEvents)) {
    if (text(event?.action) !== "use") continue;
    const capabilityClass = text(event?.capabilityClass);
    if (!usesByClass.has(capabilityClass)) usesByClass.set(capabilityClass, []);
    usesByClass.get(capabilityClass).push(text(event?.artifact));
  }
  for (const [capabilityClass, grants] of grantsByClass) {
    if (grants.length !== 1 || !usesByClass.has(capabilityClass)) {
      collector.add("self-escalated-capability", {
        taskId,
        ruleId: "tool-permission--blast-radius#1",
        artifactReference: capabilityClass || "capability-grant",
        evidenceExcerpt: "Each granted capability class must be unique and exercised by an exact recorded use.",
      });
    }
  }
  const scopedClasses = ["read", "local-write", "local-execute", "environment-mutate"];
  for (const capabilityClass of scopedClasses) {
    if (!grantsByClass.has(capabilityClass)) continue;
    const grantedTargets = grantsByClass.get(capabilityClass)
      .flatMap((grant) => uniqueSortedStrings(
        capabilityClass === "local-execute"
          ? grant?.executeScope
          : capabilityClass === "environment-mutate"
            ? grant?.mutationScope
            : grant?.writeScope,
      ));
    const usedTargets = capabilityClass === "local-write"
      ? uniqueSortedStrings(task?.declaredWriteSet)
      : uniqueSortedStrings(usesByClass.get(capabilityClass));
    if (!sameStableValue(uniqueSortedStrings(grantedTargets), usedTargets)) {
      collector.add(
        capabilityClass === "local-write"
          ? "out-of-scope-write"
          : "self-escalated-capability",
        {
          taskId,
          ruleId: capabilityClass === "local-write"
            ? "tool-permission--blast-radius#6"
            : "tool-permission--blast-radius#1",
          artifactReference: `${capabilityClass}-grant-scope`,
          evidenceExcerpt: "Grant scope must equal the exact predeclared or exercised target set.",
        },
      );
    }
  }
}

function validateWriteScope(task, grantsByClass, collector) {
  const taskId = text(task?.id);
  const scopes = grantsByClass.get("local-write")
    ?.flatMap((grant) => uniqueSortedStrings(grant?.writeScope)) ?? [];
  const declaredWrites = uniqueSortedStrings(task?.declaredWriteSet);
  const observedWrites = uniqueSortedStrings(task?.observedChangedArtifacts);
  for (const artifact of [...declaredWrites, ...observedWrites]) {
    if (!scopes.some((scope) => pathWithinScope(artifact, scope))) {
      collector.add("out-of-scope-write", {
        taskId,
        ruleId: "tool-permission--blast-radius#6",
        artifactReference: artifact,
        evidenceExcerpt: "Write falls outside the dispatch Local write scope.",
      });
    }
  }
}

function validateBudget(task, context) {
  const collector = context.collector;
  const taskId = text(task?.id);
  const budgets = object(task?.dispatch?.budgets);
  const breaker = object(task?.dispatch?.circuitBreaker);
  const consumption = object(task?.return?.consumption);
  if (
    BUDGET_FIELDS.some((field) => !finitePositive(budgets[field]))
    || breaker.maxConsecutiveNoProgress !== EXACT_CIRCUIT_BREAKER_LIMIT
    || !text(breaker.progressCheck)
    || text(breaker.progressCheck) !== text(task?.dispatch?.namedCheck)
  ) {
    collector.add("unbounded-task", {
      taskId,
      ruleId: "per-task-budgets#1",
      artifactReference: "dispatch-budgets",
      evidenceExcerpt: "All four positive bounds and the two-iteration circuit breaker are required.",
    });
  }
  for (const vcc of array(task?.dispatch?.sourceVccs)) {
    const bound = object(vcc?.bound);
    if (
      Object.keys(bound).length > 0
      && (
        !BUDGET_FIELDS.includes(text(bound.field))
        || !finitePositive(bound.maximum)
        || Number(budgets[bound.field]) > Number(bound.maximum)
      )
    ) {
      collector.add("unbounded-task", {
        taskId,
        ruleId: "per-task-budgets#1",
        artifactReference: `vcc-bound:${text(vcc?.id) || "unknown"}`,
        evidenceExcerpt: "A task budget may not exceed an optional bound declared by its source VCC.",
      });
    }
  }
  const effectiveBudgets = object(task?.effectiveBudgets);
  if (
    Object.keys(effectiveBudgets).length > 0
    && !sameStableValue(budgets, effectiveBudgets)
  ) {
    collector.add("budget-raised-under-pressure", {
      taskId,
      ruleId: "per-task-budgets#2",
      artifactReference: "effective-budgets",
      evidenceExcerpt: "Per-task bounds are immutable within a run.",
    });
  }
  const budgetEvents = array(task?.budgetEvents);
  const exhaustibleFields = ["tokens", "iterations", "wallClockMs"];
  const exhaustedFields = exhaustibleFields.filter((field) =>
    finitePositive(budgets[field])
    && finitePositive(consumption[field])
    && Number(consumption[field]) === Number(budgets[field]));
  if (budgetEvents.some((event) =>
    ["raise", "reauthorize"].includes(text(event?.action)))) {
    collector.add("budget-raised-under-pressure", {
      taskId,
      ruleId: "per-task-budgets#2",
      artifactReference: "budget-events",
      evidenceExcerpt: "A task attempted to raise or reauthorize its bound within the same run.",
    });
  }
  const eventOrdinals = budgetEvents.map((event) => event?.ordinal);
  if (
    eventOrdinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)
    || new Set(eventOrdinals).size !== eventOrdinals.length
  ) {
    collector.add("unrecorded-consumption", {
      taskId,
      ruleId: "per-task-budgets#3",
      artifactReference: "budget-event-order",
      evidenceExcerpt: "Every budget event requires one unique positive ordinal.",
    });
  }
  for (const event of budgetEvents) {
    const action = text(event?.action);
    const field = text(event?.field);
    if (text(event?.decisionRef)) {
      collector.add("assumed-operator-decision", {
        taskId,
        ruleId: "human-in-the-loop-gates#2",
        artifactReference: `budget-event:${String(event?.ordinal)}`,
        evidenceExcerpt: "In-run budget events cannot carry or infer an Operator decision.",
      });
    }
    if (
      action === "exhaust"
      && (
        !exhaustibleFields.includes(field)
        || text(task?.state) !== "failed"
        || !exhaustedFields.includes(field)
        || Number(event?.value) !== Number(consumption[field])
      )
    ) {
      collector.add("budget-raised-under-pressure", {
        taskId,
        ruleId: "per-task-budgets#2",
        artifactReference: `budget-exhaustion:${field || "unknown"}`,
        evidenceExcerpt: "Token, iteration, or wall-clock exhaustion must stop the task as failed at its declared bound.",
      });
    }
    if (
      action === "checkpoint"
      && (
        field !== "contextTokens"
        || Number(event?.value) >= Number(budgets.contextTokens)
        || !text(event?.reason)
      )
    ) {
      collector.add("unresumable-run", {
        taskId,
        ruleId: "checkpoint--recovery#3",
        artifactReference: "context-checkpoint",
        evidenceExcerpt: "A context checkpoint must be reasoned, bounded, and recorded before context exhaustion.",
      });
    }
  }
  for (const field of exhaustedFields) {
    const exactExhaustionEvents = budgetEvents.filter((event) =>
      text(event?.action) === "exhaust"
      && text(event?.field) === field
      && Number(event?.value) === Number(consumption[field]));
    if (exactExhaustionEvents.length !== 1) {
      collector.add("unrecorded-consumption", {
        taskId,
        ruleId: "per-task-budgets#3",
        artifactReference: `budget-exhaustion:${field}`,
        evidenceExcerpt: "A reached or exceeded bound requires one exact exhaustion event joined to reported consumption.",
      });
    }
  }
  if (exhaustedFields.length > 0) {
    const partialTerminal = array(context.run?.persistedTerminals).find(
      (terminal) => {
        const transition = array(task?.transitions).find((item) =>
          item?.ordinal === terminal?.transitionOrdinal);
        return text(terminal?.taskId) === taskId
          && isJoinedPartialState(task, terminal, transition);
      },
    );
    if (text(task?.state) !== "failed" || !partialTerminal) {
      collector.add("unresumable-run", {
        taskId,
        ruleId: "checkpoint--recovery#5",
        artifactReference: `budget-exhaustion:${exhaustedFields.join(",")}`,
        evidenceExcerpt: "Bound exhaustion must stop as failed and persist the resumable partial task state.",
      });
    }
  }
  const contextConsumeOrdinal = budgetEvents.find((event) =>
    text(event?.action) === "consume"
    && text(event?.field) === "contextTokens")?.ordinal;
  const validContextCheckpoints = budgetEvents.filter((event) =>
    text(event?.action) === "checkpoint"
    && text(event?.field) === "contextTokens"
    && Number(event?.value) < Number(budgets.contextTokens)
    && Boolean(text(event?.reason))
    && Number.isInteger(contextConsumeOrdinal)
    && event?.ordinal < contextConsumeOrdinal);
  if (
    Number(consumption.contextTokens) >= Number(budgets.contextTokens)
    && validContextCheckpoints.length === 0
  ) {
    collector.add("unresumable-run", {
      taskId,
      ruleId: "checkpoint--recovery#3",
      artifactReference: "context-bound",
      evidenceExcerpt: "Context consumption reached its bound without a prior valid checkpoint.",
    });
  }
  const attempts = array(task?.return?.attempts);
  const attemptsValid = attempts.length === consumption.iterations
    && attempts.every((attempt, index) =>
      attempt?.iteration === index + 1
      && typeof attempt?.progress === "boolean");
  if (!attemptsValid) {
    collector.add("unrecorded-consumption", {
      taskId,
      ruleId: "per-task-budgets#3",
      artifactReference: "attempt-consumption",
      evidenceExcerpt: "Attempt ordinals must be contiguous and exactly match consumed iterations.",
    });
  }
  validateAttemptIdempotency(task, attempts, collector);
  const consumeEvents = budgetEvents.filter((event) =>
    text(event?.action) === "consume");
  const consumeOrdinals = new Set(consumeEvents.map((event) => event?.ordinal));
  const consumptionEventsValid = consumeEvents.length === BUDGET_FIELDS.length
    && consumeOrdinals.size === consumeEvents.length
    && BUDGET_FIELDS.every((field) => {
      const events = consumeEvents.filter((event) => text(event?.field) === field);
      return events.length === 1 && events[0]?.value === consumption[field];
    });
  if (!consumptionEventsValid) {
    collector.add("unrecorded-consumption", {
      taskId,
      ruleId: "per-task-budgets#3",
      artifactReference: "budget-events",
      evidenceExcerpt: "Budget events must bind each reported consumption field exactly once.",
    });
  }
  let noProgress = 0;
  let tripped = false;
  let continuedAfterTrip = false;
  for (const attempt of attempts) {
    if (tripped) continuedAfterTrip = true;
    noProgress = attempt?.progress === true ? 0 : noProgress + 1;
    if (noProgress >= EXACT_CIRCUIT_BREAKER_LIMIT) tripped = true;
  }
  if (
    tripped
    && (text(task?.state) !== "failed" || continuedAfterTrip)
  ) {
    collector.add("budget-raised-under-pressure", {
      taskId,
      ruleId: "per-task-budgets#2",
      artifactReference: "circuit-breaker",
      evidenceExcerpt: "Two consecutive no-progress iterations must immediately stop the task as failed.",
    });
  }
}

export function isExplicitDecision(decisionInput) {
  const decision = object(decisionInput);
  const options = array(decision.options).map(text);
  const consequences = array(decision.consequences).map(text);
  return text(decision.role) === "operator"
    && decision.attestationValid === true
    && decision.explicit === true
    && decision.approved === true
    && options.length > 0
    && consequences.length === options.length
    && options.every(Boolean)
    && consequences.every(Boolean)
    && options.includes(text(decision.decision));
}
