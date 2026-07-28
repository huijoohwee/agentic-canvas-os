import { isSuccessfulRecordedResult } from "./evidence-result.mjs";
import { isEvidenceClosed } from "./traceability-mapper.mjs";

export const READINESS_LADDER = Object.freeze([
  "undocumented",
  "spec-complete",
  "dev-proven",
  "runtime-ready",
  "production-verified",
]);

export function evaluateReadiness(chainsInput = [], operatorInstruction = null) {
  const chains = Array.isArray(chainsInput)
    ? chainsInput
    : chainsInput?.chains ?? [];
  const assignments = chains
    .map((chain) => assignReadiness(chain, operatorInstruction))
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId, "en"));
  return { assignments, findings: [] };
}

export function assignReadiness(chain = {}, operatorInstruction = null) {
  const evidence = arrayOf(chain.evidence).filter(Boolean);
  const conditions = arrayOf(chain.conditions).filter(Boolean);
  const documented = arrayOf(chain.entryIds).length > 0 ||
    arrayOf(chain.links).length > 0 ||
    Boolean(chain.documented);
  const hasLocalProof = evidence.some(isReproducibleLocalResult);
  const closure = isEvidenceClosed(conditions, evidence);
  const hasProductionProof = evidence.some(isRecordedProductionResult);

  let localReadiness = documented ? "spec-complete" : "undocumented";
  if (hasLocalProof) localReadiness = "dev-proven";
  if (closure) localReadiness = "runtime-ready";

  const productionVerified = closure && hasProductionProof && hasOperatorInstruction(operatorInstruction);
  const deployedReadiness = productionVerified ? "production-verified" : "undocumented";
  const assignedLevel = productionVerified ? "production-verified" : localReadiness;
  const uncovered = firstUncoveredCondition(conditions, evidence);

  return {
    capabilityId: String(chain.capabilityId ?? "unknown-capability"),
    localReadiness,
    deployedReadiness,
    assignedLevel,
    evidenceCount: evidence.length,
    gapStatement: gapFor(assignedLevel, uncovered),
    priority: priorityFor(assignedLevel),
    exitCriterion: uncovered ?? nextCriterion(assignedLevel),
  };
}

export function readinessRank(level) {
  return READINESS_LADDER.indexOf(level);
}

function isReproducibleLocalResult(evidence) {
  return String(evidence.reproducible ?? evidence.surface ?? "").trim().toLowerCase() === "local" &&
    isSuccessfulRecordedResult(evidence) &&
    String(evidence.checkName ?? evidence.command ?? "").trim().length > 0;
}

function isRecordedProductionResult(evidence) {
  return String(evidence.reproducible ?? evidence.surface ?? "").trim().toLowerCase() === "production" &&
    isSuccessfulRecordedResult(evidence) &&
    String(evidence.checkName ?? evidence.command ?? "").trim().length > 0;
}

function hasOperatorInstruction(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return String(value.reference ?? value.id ?? "").trim().length > 0;
}

function firstUncoveredCondition(conditions, evidence) {
  for (const condition of conditions) {
    const id = String(condition.conditionId ?? condition.id ?? "");
    const covered = evidence.some((item) =>
      isSuccessfulRecordedResult(item) &&
      (id.length > 0
        ? String(item.conditionId ?? item.condition_id ?? "") === id
        : String(item.checkName ?? "") === String(condition.statedCheck ?? condition.check ?? "")));
    if (!covered) return normalizeCriterion(condition);
  }
  return null;
}

function normalizeCriterion(condition) {
  return {
    conditionId: String(condition.conditionId ?? condition.id ?? "next-condition"),
    endState: String(condition.endState ?? "The capability reaches its stated end state."),
    statedCheck: String(condition.statedCheck ?? condition.check ?? "Run the named local check."),
    constraint: String(condition.constraint ?? "Evaluate only the configured capability scope."),
    bound: condition.bound ?? null,
  };
}

function nextCriterion(level) {
  const byLevel = {
    undocumented: {
      conditionId: "document-capability",
      endState: "The capability has a linked specification and runtime artifact.",
      statedCheck: "Re-run the alignment audit and inspect the traceability chain.",
      constraint: "Use only configured input documents.",
    },
    "spec-complete": {
      conditionId: "record-local-proof",
      endState: "A reproducible local check has a recorded passing result.",
      statedCheck: "Run the declared validation command locally.",
      constraint: "Do not mutate a production or edge surface.",
    },
    "dev-proven": {
      conditionId: "close-vcc-evidence",
      endState: "Every linked completion condition has recorded evidence.",
      statedCheck: "Re-run every named VCC check.",
      constraint: "Retain all existing Evidence References.",
    },
    "runtime-ready": {
      conditionId: "verify-production",
      endState: "A production check is recorded under an explicit operator instruction.",
      statedCheck: "Run the operator-approved production verification.",
      constraint: "The deploy boundary remains closed without explicit approval.",
    },
    "production-verified": {
      conditionId: "retain-verification",
      endState: "All production verification evidence remains reproducible.",
      statedCheck: "Re-run the recorded verification at the next governed release.",
      constraint: "Preserve the operator instruction reference.",
    },
  };
  return { ...byLevel[level], bound: null };
}

function gapFor(level, uncovered) {
  if (uncovered) return `Missing recorded evidence for ${uncovered.conditionId}.`;
  return {
    undocumented: "No linked specification and runtime artifact are documented.",
    "spec-complete": "No reproducible local proof has a recorded result.",
    "dev-proven": "Not every Verifiable Completion Condition is evidence-closed.",
    "runtime-ready": "Production verification requires both production evidence and operator approval.",
    "production-verified": "No readiness gap remains.",
  }[level];
}

function priorityFor(level) {
  if (level === "undocumented" || level === "spec-complete") return "P0";
  if (level === "dev-proven") return "P1";
  return "P2";
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
