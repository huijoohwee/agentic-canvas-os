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
  const authoringEvidence = evidence.filter(isAuthoringEvidence);
  const deliveredEvidence = evidence.filter((item) =>
    ["mirror", "delivery", "production"].includes(evidenceSurface(item)));
  const hasLocalProof = authoringEvidence.some(isRecordedResult);
  const localClosure = closesConditions(conditions, authoringEvidence);
  const deliveredClosure = closesConditions(conditions, deliveredEvidence);
  const hasProductionProof = evidence.some((item) =>
    ["delivery", "production"].includes(evidenceSurface(item)) &&
    isRecordedResult(item));

  let localRung = documented ? "spec-complete" : "undocumented";
  if (hasLocalProof) localRung = "dev-proven";
  if (localClosure) localRung = "runtime-ready";

  let deliveredRung = deliveredEvidence.some(isRecordedResult)
    ? "dev-proven"
    : "undocumented";
  if (deliveredClosure) deliveredRung = "runtime-ready";
  const productionVerified = localClosure && hasProductionProof &&
    hasOperatorInstruction(operatorInstruction);
  if (productionVerified) deliveredRung = "production-verified";
  const assignedLevel = productionVerified ? "production-verified" : localRung;
  const uncovered = firstUncoveredCondition(conditions, authoringEvidence);

  return {
    capabilityId: String(chain.capabilityId ?? "unknown-capability"),
    localRung,
    deliveredRung,
    localReadiness: localRung,
    deployedReadiness: deliveredRung,
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

function evidenceSurface(evidence) {
  return String(evidence.surface ?? evidence.reproducible ?? "").trim().toLowerCase();
}

function isAuthoringEvidence(evidence) {
  const surface = evidenceSurface(evidence);
  return ["authoring", "local"].includes(surface);
}

function isRecordedResult(evidence) {
  return isSuccessfulRecordedResult(evidence) &&
    String(evidence.checkName ?? evidence.command ?? "").trim().length > 0;
}

function closesConditions(conditions, evidence) {
  return isEvidenceClosed(conditions, evidence.map((item) => ({
    ...item,
    reproducible: ["delivery", "production"].includes(evidenceSurface(item))
      ? "production"
      : "local",
  })));
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
