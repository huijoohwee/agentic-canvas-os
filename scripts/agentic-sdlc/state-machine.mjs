import {
  TASK_STATES,
  TERMINAL_TASK_STATES,
} from "./constants.mjs";
import { array, text } from "./normalize.mjs";

const ALLOWED_TRANSITIONS = Object.freeze({
  "not-started": Object.freeze(["queued"]),
  queued: Object.freeze(["ready"]),
  ready: Object.freeze(["in-progress"]),
  "in-progress": Object.freeze(["verified", "failed", "blocked", "abandoned"]),
  verified: Object.freeze([]),
  failed: Object.freeze([]),
  blocked: Object.freeze([]),
  abandoned: Object.freeze([]),
});

const STATE_ROLES = Object.freeze({
  "not-started": Object.freeze(["orchestrator"]),
  queued: Object.freeze(["orchestrator"]),
  ready: Object.freeze(["orchestrator"]),
  "in-progress": Object.freeze(["orchestrator"]),
  verified: Object.freeze(["evaluator"]),
  failed: Object.freeze(["evaluator", "orchestrator"]),
  blocked: Object.freeze(["orchestrator"]),
  abandoned: Object.freeze(["operator"]),
});

export function isTerminalState(value) {
  return TERMINAL_TASK_STATES.includes(text(value));
}

export function allowedTransition(from, to) {
  return (ALLOWED_TRANSITIONS[text(from)] ?? []).includes(text(to));
}

export function allowedRoleForState(state, role) {
  return (STATE_ROLES[text(state)] ?? []).includes(text(role));
}

export function inspectTaskTransitions(taskInput) {
  const task = taskInput ?? {};
  const transitions = array(task.transitions);
  const violations = [];
  let expectedFrom = "not-started";
  let terminalSeen = false;
  let previousOrdinal = 0;

  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index] ?? {};
    const from = text(transition.from);
    const to = text(transition.to);
    const role = text(transition.role);
    const ordinal = transition.ordinal;
    const reference = `${text(task.id) || "task"}:${Number.isInteger(ordinal) ? ordinal : index + 1}`;

    if (!Number.isInteger(ordinal) || ordinal <= previousOrdinal) {
      violations.push({ kind: "invalid-ordinal", reference, transition });
    }
    previousOrdinal = Number.isInteger(ordinal) ? ordinal : previousOrdinal;
    if (text(transition.taskId) !== text(task.id)) {
      violations.push({ kind: "missing-task-id", reference, transition });
    }
    if (!text(transition.mechanismId) || !text(transition.artifactRevision)) {
      violations.push({
        kind: "missing-transition-metadata",
        reference,
        transition,
      });
    }
    if (!TASK_STATES.includes(from) || !TASK_STATES.includes(to)) {
      violations.push({ kind: "unknown-state", reference, transition });
    }
    const explicitRederivation = terminalSeen
      && from === expectedFrom
      && to === "not-started"
      && transition.rederived === true
      && role === "orchestrator"
      && text(transition.reason)
      && text(transition.derivationRevision);
    if (
      (transition.rederived !== undefined
        || transition.derivationRevision !== undefined)
      && !explicitRederivation
    ) {
      violations.push({
        kind: "invalid-rederivation",
        reference,
        transition,
      });
    }
    if (terminalSeen && !explicitRederivation) {
      violations.push({ kind: "terminal-transition", reference, transition });
    }
    if (
      from !== expectedFrom
      || (!allowedTransition(from, to) && !explicitRederivation)
    ) {
      violations.push({ kind: "invalid-transition", reference, transition });
    }
    if (!allowedRoleForState(to, role)) {
      violations.push({
        kind: to === "verified" ? "invalid-verifier" : "invalid-role",
        reference,
        transition,
      });
    }
    if (["failed", "blocked", "abandoned"].includes(to) && !text(transition.reason)) {
      violations.push({ kind: "missing-reason", reference, transition });
    }
    expectedFrom = to;
    terminalSeen = explicitRederivation ? false : isTerminalState(to);
  }

  const declaredState = text(task.state);
  if (!TASK_STATES.includes(declaredState)) {
    violations.push({
      kind: "unknown-declared-state",
      reference: text(task.id) || "task",
    });
  } else if (transitions.length === 0) {
    if (declaredState !== "not-started") {
      violations.push({
        kind: "state-without-transition",
        reference: text(task.id) || "task",
      });
    }
  } else if (declaredState !== expectedFrom) {
    violations.push({
      kind: "state-mismatch",
      reference: text(task.id) || "task",
    });
  }

  return Object.freeze({
    valid: violations.length === 0,
    terminal: isTerminalState(declaredState),
    terminalTransition: transitions.findLast?.((item) => isTerminalState(item?.to))
      ?? [...transitions].reverse().find((item) => isTerminalState(item?.to))
      ?? null,
    violations: Object.freeze(violations),
  });
}

export {
  ALLOWED_TRANSITIONS,
  STATE_ROLES,
};
