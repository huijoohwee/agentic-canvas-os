const RULE_IDS_BY_FINDING = Object.freeze({
  "assumed-operator-decision": ["human-in-the-loop-gates#2", "human-in-the-loop-gates#5"],
  "budget-raised-under-pressure": ["per-task-budgets#2", "task-model#5"],
  "concurrent-write-conflict": ["task-model#9"],
  "deploy-boundary-breach": ["tool-permission--blast-radius#4", "tool-permission--blast-radius#5"],
  "evidence-without-run": [
    "verification-strategy#10",
    "verification-strategy#11",
    "verification-strategy#12",
  ],
  "fix-without-witness": ["verification-strategy#3"],
  "out-of-scope-write": ["tool-permission--blast-radius#6"],
  "oversized-task": ["task-model#1", "task-model#2", "task-model#4", "task-model#5"],
  "self-escalated-capability": ["tool-permission--blast-radius#1", "tool-permission--blast-radius#2"],
  "self-graded-verdict": ["agent-roles--independence#8"],
  "stale-evidence": ["boundary-with-the-authoring-set#2"],
  "state-without-reason": [
    "agent-roles--independence#9",
    "checkpoint--recovery#7",
    "task-model#3",
    "task-model#8",
    "task-model#11",
    "task-model#12",
    "task-model#13",
    "task-model#14",
  ],
  "task-cycle": ["task-model#7"],
  "unbounded-task": ["per-task-budgets#1"],
  "unenumerated-change": ["execution-contract#5"],
  "unexecuted-condition": ["specification-to-task-bridge#2", "verification-strategy#10"],
  "ungated-irreversible-operation": ["tool-permission--blast-radius#3"],
  "ungrounded-task": [
    "execution-contract#2",
    "specification-to-task-bridge#1",
    "specification-to-task-bridge#3",
    "specification-to-task-bridge#5",
    "specification-to-task-bridge#6",
    "task-model#1",
    "task-model#9",
    "task-model#10",
  ],
  "unnamed-evaluator": ["agent-roles--independence#1", "agent-roles--independence#7"],
  "unproven-claim": [
    "boundary-with-the-authoring-set#1",
    "boundary-with-the-authoring-set#2",
    "execution-contract#2",
    "per-task-budgets#4",
  ],
  "unproven-property": [
    "verification-strategy#5",
    "verification-strategy#6",
    "verification-strategy#7",
    "verification-strategy#8",
    "verification-strategy#9",
  ],
  "unrecorded-consumption": ["execution-load-budget#2", "per-task-budgets#3", "per-task-budgets#5"],
  "unresumable-run": [
    "checkpoint--recovery#2",
    "checkpoint--recovery#3",
    "checkpoint--recovery#4",
    "checkpoint--recovery#5",
    "checkpoint--recovery#6",
    "checkpoint--recovery#7",
    "task-model#3",
  ],
  "unsurfaced-result": [
    "execution-contract#2",
    "execution-contract#3",
    "execution-contract#6",
    "task-model#6",
    "verification-strategy#2",
    "verification-strategy#4",
  ],
});

export function findingRuleIds(findingType) {
  return RULE_IDS_BY_FINDING[findingType] ?? [];
}

export function isFindingRulePair(findingType, ruleId) {
  return findingRuleIds(findingType).includes(ruleId);
}
