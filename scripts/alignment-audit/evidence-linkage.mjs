import {
  normalizeElementIds,
  parseElementIdList,
} from "./element-linkage.mjs";
import {
  isSuccessfulRecordedResult,
  recordedResultOf,
} from "./evidence-result.mjs";

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "has", "in", "is",
  "it", "of", "on", "or", "shall", "that", "the", "this", "to", "with",
  "artifact", "capability", "document", "evidence", "guideline", "must", "required",
  "record", "records", "runtime", "should",
]);

export function selectEvidenceForElement(element = {}, evidence = [], conditions = []) {
  const elementId = String(element.elementId ?? "");
  const candidates = arrayOf(evidence).filter(Boolean);
  const explicit = bestEvidence(candidates.filter((candidate) =>
    elementIdsOf(candidate).includes(elementId)));
  if (explicit) return explicit;

  const relevantConditions = arrayOf(conditions)
    .filter((condition) => conditionAppliesToElement(condition, element));
  for (const condition of relevantConditions) {
    const matched = bestEvidence(candidates.filter((candidate) =>
      evidenceMatchesCondition(candidate, condition)));
    if (matched) return matched;
  }
  return bestEvidence(candidates.filter((candidate) =>
    recordSemanticallyMatchesElement(candidate, element)));
}

export function significantTokens(value) {
  return new Set(String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}_-]{2,}/gu) ?? []
    .filter((token) => !STOP_WORDS.has(token)));
}

export function hasRequiredTokenOverlap(requiredTokens, availableTokens) {
  if (requiredTokens.size === 0) return false;
  return [...requiredTokens].every((token) => availableTokens.has(token));
}

function conditionAppliesToElement(condition, element) {
  const elementId = String(element.elementId ?? "");
  if (elementIdsOf(condition).includes(elementId)) return true;
  const conditionId = String(condition.conditionId ?? condition.id ?? "").trim();
  const identities = new Set([
    elementId,
    String(element.gateId ?? ""),
    String(element.sectionAnchor ?? ""),
  ].filter(Boolean));
  return identities.has(conditionId) ||
    recordSemanticallyMatchesElement(condition, element);
}

function evidenceMatchesCondition(evidence, condition) {
  const conditionId = String(condition.conditionId ?? condition.id ?? "").trim();
  const evidenceConditionId =
    String(evidence.conditionId ?? evidence.condition_id ?? "").trim();
  const statedCheck =
    String(condition.statedCheck ?? condition.stated_check ?? condition.check ?? "").trim();
  const evidenceCheck =
    String(evidence.checkName ?? evidence.check_name ?? evidence.command ?? "").trim();
  return conditionId.length > 0 &&
    evidenceConditionId === conditionId &&
    statedCheck.length > 0 &&
    evidenceCheck === statedCheck;
}

function bestEvidence(candidates) {
  return [...candidates].sort((left, right) =>
    Number(!isAdmissible(left)) - Number(!isAdmissible(right)) ||
    evidenceKey(left).localeCompare(evidenceKey(right), "en"))[0] ?? null;
}

function isAdmissible(evidence) {
  const check = String(
    evidence.checkName ?? evidence.check_name ?? evidence.command ?? "",
  ).trim();
  const surface = String(evidence.reproducible ?? evidence.surface ?? "")
    .trim().toLowerCase();
  return check.length > 0 &&
    ["local", "production"].includes(surface) &&
    isSuccessfulRecordedResult(evidence);
}

function evidenceKey(evidence) {
  return JSON.stringify([
    String(evidence.conditionId ?? evidence.condition_id ?? ""),
    String(evidence.checkName ?? evidence.check_name ?? evidence.command ?? ""),
    recordedResultOf(evidence),
    String(evidence.reproducible ?? evidence.surface ?? ""),
    elementIdsOf(evidence),
  ]);
}

function recordSemanticallyMatchesElement(record, element) {
  const required = significantTokens([
    element.text,
    element.requiredArtifactDescriptor,
    element.artifactDescriptor,
  ].filter(Boolean).join(" "));
  const available = significantTokens([
    record.conditionId,
    record.condition_id,
    record.endState,
    record.end_state,
    record.statedCheck,
    record.stated_check,
    record.check,
    record.checkName,
    record.check_name,
    record.command,
  ].filter(Boolean).join(" "));
  return hasRequiredTokenOverlap(required, available);
}

function elementIdsOf(record) {
  return normalizeElementIds([
    ...parseElementIdList(record.elementIds ?? record.element_ids),
    ...parseElementIdList(
      record.guidelineElementIds ?? record.guideline_element_ids,
    ),
    record.elementId ?? record.element_id,
    record.guidelineElementId ?? record.guideline_element_id,
  ].filter(Boolean));
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
