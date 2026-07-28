export const EXECUTION_RUN_SCHEMA = "agentic-sdlc-run/v1";

export const EXECUTION_FINDING_TYPES = Object.freeze([
  "self-graded-verdict",
  "unnamed-evaluator",
  "ungrounded-task",
  "unexecuted-condition",
  "task-cycle",
  "concurrent-write-conflict",
  "state-without-reason",
  "oversized-task",
  "unsurfaced-result",
  "unenumerated-change",
  "self-escalated-capability",
  "out-of-scope-write",
  "ungated-irreversible-operation",
  "unbounded-task",
  "budget-raised-under-pressure",
  "unrecorded-consumption",
  "fix-without-witness",
  "unproven-property",
  "evidence-without-run",
  "unresumable-run",
  "assumed-operator-decision",
]);

export const EXECUTION_FINDING_SEVERITIES = Object.freeze({
  "self-graded-verdict": "blocker",
  "unnamed-evaluator": "blocker",
  "ungrounded-task": "major",
  "unexecuted-condition": "major",
  "task-cycle": "blocker",
  "concurrent-write-conflict": "major",
  "state-without-reason": "minor",
  "oversized-task": "minor",
  "unsurfaced-result": "major",
  "unenumerated-change": "minor",
  "self-escalated-capability": "blocker",
  "out-of-scope-write": "major",
  "ungated-irreversible-operation": "blocker",
  "unbounded-task": "blocker",
  "budget-raised-under-pressure": "major",
  "unrecorded-consumption": "minor",
  "fix-without-witness": "major",
  "unproven-property": "major",
  "evidence-without-run": "blocker",
  "unresumable-run": "major",
  "assumed-operator-decision": "blocker",
});

export const SEVERITY_RANK = Object.freeze({
  blocker: 0,
  major: 1,
  minor: 2,
});

export const EXECUTION_ROLES = Object.freeze([
  "orchestrator",
  "implementer",
  "evaluator",
  "operator",
]);

export const TASK_STATES = Object.freeze([
  "not-started",
  "queued",
  "ready",
  "in-progress",
  "verified",
  "failed",
  "blocked",
  "abandoned",
]);

export const TERMINAL_TASK_STATES = Object.freeze([
  "verified",
  "failed",
  "blocked",
  "abandoned",
]);

export const CAPABILITY_CLASSES = Object.freeze([
  "read",
  "local-write",
  "local-execute",
  "environment-mutate",
  "irreversible",
  "boundary-crossing",
]);

export const BUDGET_FIELDS = Object.freeze([
  "tokens",
  "iterations",
  "wallClockMs",
  "contextTokens",
]);

export const PROPERTY_CLASSES = Object.freeze([
  "round-trip",
  "invariant",
  "metamorphic",
  "idempotence",
  "confluence",
  "error-condition",
]);

export const TASK_ID_PATTERN = /^(?:[1-9]\d*)(?:\.(?:[1-9]\d*))?$/u;

export const EXACT_CIRCUIT_BREAKER_LIMIT = 2;

export const READINESS_LADDER = Object.freeze([
  "undocumented",
  "spec-complete",
  "dev-proven",
  "runtime-ready",
  "production-verified",
]);
