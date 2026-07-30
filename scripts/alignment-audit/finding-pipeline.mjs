import {
  compareFindings,
  deduplicationKey,
  makeFinding,
  normalizeFinding,
  SEVERITY_RANK,
} from "./finding.mjs";
import { gateRemediation } from "./deploy-gate.mjs";

export function finalizeFindings(findings = [], options = {}) {
  const byKey = new Map();
  for (const input of findings) {
    const normalized = normalizeFinding(input);
    const key = deduplicationKey(normalized);
    const current = byKey.get(key);
    byKey.set(key, current ? mergeFindings(current, normalized) : normalized);
  }

  const ordered = [...byKey.values()]
    .map((finding) => applyRemediationGate(finding, options.operatorInstruction ?? null))
    .sort(compareFindings);

  if (options.enforceBound === true) {
    assertFindingCountBound(
      ordered,
      options.normativeElementCount,
      options.artifactEntryCount,
    );
  }
  return ordered;
}

export const reduceFindings = finalizeFindings;
export const processFindings = finalizeFindings;

export function assertFindingCountBound(
  findings,
  normativeElementCount,
  artifactEntryCount,
) {
  const elementCount = nonnegativeInteger(normativeElementCount, "normativeElementCount");
  const entryCount = nonnegativeInteger(artifactEntryCount, "artifactEntryCount");
  const bound = elementCount + entryCount;
  if (findings.length > bound) {
    throw new Error(
      `Finding count post-condition failed: ${findings.length} > ${elementCount} + ${entryCount}`,
    );
  }
  return true;
}

function mergeFindings(left, right) {
  const severity = SEVERITY_RANK[left.severity] <= SEVERITY_RANK[right.severity]
    ? left.severity
    : right.severity;
  const evidenceExcerpt = left.evidenceExcerpt.localeCompare(right.evidenceExcerpt, "en") <= 0
    ? left.evidenceExcerpt
    : right.evidenceExcerpt;
  const remediation = compareRemediations(left.remediation, right.remediation) <= 0
    ? left.remediation
    : right.remediation;
  return makeFinding({
    findingType: left.findingType,
    severity,
    guidelineAnchor: left.guidelineAnchor,
    artifactReference: left.artifactReference,
    evidenceExcerpt,
    remediation,
  });
}

function applyRemediationGate(finding, operatorInstruction) {
  const remediation = gateRemediation(finding.remediation, operatorInstruction);
  if (remediation === finding.remediation) return finding;
  return makeFinding({
    ...finding,
    remediation,
  });
}

function compareRemediations(left, right) {
  return JSON.stringify([
    left.class,
    left.statement,
    left.state,
    left.operatorInstructionRef,
  ]).localeCompare(JSON.stringify([
    right.class,
    right.statement,
    right.state,
    right.operatorInstructionRef,
  ]), "en");
}

function nonnegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}
