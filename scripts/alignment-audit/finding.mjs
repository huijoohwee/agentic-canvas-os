export const FINDING_TYPES = Object.freeze([
  "missing-frontmatter-key",
  "unknown-status",
  "unimplemented-guideline",
  "unguided-artifact",
  "unproven-claim",
  "unresolvable-reference",
  "gate-order-drift",
  "gate-sequence-violation",
  "status-conflict",
  "stale-evidence",
  "duplicate-owner",
  "blended-status",
  "missing-companion",
  "vendor-coupling",
  "path-derived-claim",
  "non-modular-section",
  "scope-contradiction",
  "missing-economics-metric",
  "blended-deployment-tco",
  "missing-foss-comparison",
  "unbounded-loop",
  "paid-read-path",
  "missing-delivery-statement",
  "orphan-route",
  "ambiguous-route",
  "unfederated-tool",
  "uncatalogued-tool",
  "missing-lane",
  "incomplete-lane-transition",
  "deploy-boundary-breach",
  "ungated-promotion",
  "incomplete-topology-node",
  "malformed-document",
  "unreadable-input",
]);

export const SEVERITY_RANK = Object.freeze({
  blocker: 0,
  major: 1,
  minor: 2,
});

export const DEFAULT_SEVERITY = Object.freeze({
  "missing-frontmatter-key": "major",
  "unknown-status": "major",
  "unimplemented-guideline": "major",
  "unguided-artifact": "minor",
  "unproven-claim": "blocker",
  "unresolvable-reference": "major",
  "gate-order-drift": "major",
  "gate-sequence-violation": "major",
  "status-conflict": "major",
  "stale-evidence": "major",
  "duplicate-owner": "major",
  "blended-status": "minor",
  "missing-companion": "major",
  "vendor-coupling": "major",
  "path-derived-claim": "major",
  "non-modular-section": "minor",
  "scope-contradiction": "major",
  "missing-economics-metric": "major",
  "blended-deployment-tco": "major",
  "missing-foss-comparison": "major",
  "unbounded-loop": "blocker",
  "paid-read-path": "major",
  "missing-delivery-statement": "major",
  "orphan-route": "major",
  "ambiguous-route": "major",
  "unfederated-tool": "major",
  "uncatalogued-tool": "major",
  "missing-lane": "major",
  "incomplete-lane-transition": "major",
  "deploy-boundary-breach": "blocker",
  "ungated-promotion": "major",
  "incomplete-topology-node": "minor",
  "malformed-document": "major",
  "unreadable-input": "major",
});

export const REMEDIATION_CLASSES = Object.freeze([
  "documentation-change",
  "specification-change",
  "local-reproducible-check",
]);

export const REMEDIATION_STATES = Object.freeze([
  "proposed",
  "deploy-gated",
  "operator-approved",
]);

const CRITERION_SEVERITY = Object.freeze({
  "unproven-claim": "blocker",
  "unbounded-loop": "blocker",
  "deploy-boundary-breach": "blocker",
});
const FINDING_TYPE_SET = new Set(FINDING_TYPES);

export function resolveSeverity(findingType, requestedSeverity, defaults = DEFAULT_SEVERITY) {
  assertFindingType(findingType);
  if (CRITERION_SEVERITY[findingType]) return CRITERION_SEVERITY[findingType];
  const severity = requestedSeverity ?? defaults[findingType];
  if (!(severity in SEVERITY_RANK)) {
    throw new TypeError(`invalid severity for ${findingType}: ${String(severity)}`);
  }
  return severity;
}

export function makeFinding(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("makeFinding expects an object");
  }
  const findingType = String(input.findingType ?? "");
  assertFindingType(findingType);
  const remediation = normalizeRemediation(input.remediation);
  return Object.freeze({
    findingType,
    severity: resolveSeverity(findingType, input.severity),
    guidelineAnchor: populated(input.guidelineAnchor, "-"),
    artifactReference: populated(input.artifactReference, "-"),
    evidenceExcerpt: populated(input.evidenceExcerpt),
    remediation,
  });
}

export function normalizeFinding(finding) {
  return makeFinding(finding);
}

export function deduplicationKey(finding) {
  return JSON.stringify([
    finding.findingType,
    finding.guidelineAnchor,
    finding.artifactReference,
  ]);
}

export function compareFindings(left, right) {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    left.findingType.localeCompare(right.findingType, "en") ||
    left.guidelineAnchor.localeCompare(right.guidelineAnchor, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en")
  );
}

export function assertFindingType(findingType) {
  if (!FINDING_TYPE_SET.has(findingType)) {
    throw new TypeError(`unknown Finding_Type: ${String(findingType)}`);
  }
}

function normalizeRemediation(remediation) {
  if (!remediation || typeof remediation !== "object") {
    throw new TypeError("Finding remediation is required");
  }
  const remediationClass = String(remediation.class ?? "");
  if (!REMEDIATION_CLASSES.includes(remediationClass)) {
    throw new TypeError(`invalid remediation class: ${remediationClass}`);
  }
  const state = String(remediation.state ?? "proposed");
  if (!REMEDIATION_STATES.includes(state)) {
    throw new TypeError(`invalid remediation state: ${state}`);
  }
  const operatorInstructionRef =
    remediation.operatorInstructionRef === undefined ||
    remediation.operatorInstructionRef === null
      ? null
      : populated(remediation.operatorInstructionRef);
  if (state === "operator-approved" && operatorInstructionRef === null) {
    throw new TypeError("operator-approved remediation requires an operator instruction");
  }
  return Object.freeze({
    class: remediationClass,
    statement: populated(remediation.statement),
    state,
    operatorInstructionRef,
  });
}

function populated(value, fallback) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (text.length > 0) return text;
  if (fallback !== undefined) return fallback;
  throw new TypeError("Finding fields must be non-empty");
}
