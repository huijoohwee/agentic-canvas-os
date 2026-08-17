export const DEFAULT_SEVERITY = Object.freeze({
  "missing-frontmatter-key": "minor",
  "malformed-document": "major",
  "unknown-status": "minor",
  "unproven-claim": "blocker",
  "blended-status": "minor",
  "unimplemented-guideline": "major",
  "unguided-artifact": "minor",
  "unresolvable-reference": "major",
  "stale-evidence": "major",
  "missing-companion": "major",
  "duplicate-owner": "major",
  "status-conflict": "major",
  "gate-order-drift": "major",
  "gate-sequence-violation": "major",
  "vendor-coupling": "major",
  "path-derived-claim": "major",
  "non-modular-section": "minor",
  "missing-economics-metric": "major",
  "blended-deployment-tco": "major",
  "missing-foss-comparison": "major",
  "unbounded-loop": "blocker",
  "paid-read-path": "major",
  "incomplete-delivery-reach": "major",
  "orphan-route": "major",
  "ambiguous-route": "major",
  "unfederated-tool": "major",
  "uncatalogued-tool": "major",
  "missing-lane": "blocker",
  "incomplete-lane-transition": "major",
  "deploy-boundary-breach": "blocker",
  "ungated-promotion": "blocker",
  "incomplete-topology-node": "major",
  "self-graded-verdict": "blocker",
  "unnamed-evaluator": "blocker",
  "ungrounded-task": "major",
  "unexecuted-condition": "major",
  "task-cycle": "blocker",
  "concurrent-write-conflict": "major",
  "parallel-scope-collision": "blocker",
  "stale-collaboration-fence": "blocker",
  "delivery-authority-unjoined": "blocker",
  "canonical-base-drift": "blocker",
  "scope-admission-collision": "blocker",
  "unattributed-lane-ambiguity": "blocker",
  "admission-snapshot-stale": "blocker",
  "unsafe-candidate-target": "blocker",
  "local-only-cross-device-lease": "blocker",
  "collateral-lane-mutation": "blocker",
  "admission-runtime-conflation": "major",
  "candidate-lane-orphaned": "major",
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
  "unreviewed-release-candidate": "blocker",
  "dependency-closure-drift": "blocker",
  "authorization-evidence-unjoined": "blocker",
  "authorization-interaction-unjoined": "blocker",
  "duplicate-release-controller": "blocker",
  "production-authorization-drift": "blocker",
  "post-authorization-rebuild": "blocker",
  "state-reconciliation-unverified": "blocker",
  "immutable-origin-unverified": "blocker",
  "public-route-unverified": "blocker",
  "client-cache-convergence-unverified": "blocker",
  "publication-before-live-verification": "blocker",
  "cleanup-ownership-unproven": "blocker",
  "integration-order-cycle": "blocker",
  "integration-before-dependency": "blocker",
  "canonical-frontier-unverified": "blocker",
  "duplicate-change-reintegrated": "major",
  "stale-candidate-frontier": "blocker",
  "runtime-readiness-unproven": "blocker",
  "undesigned-criterion": "major",
  "ungrounded-design-element": "minor",
  "requirement-introduced-downstream": "blocker",
  "stale-downstream-artifact": "major",
  "phase-advanced-without-approval": "blocker",
  "seam-elided": "blocker",
});

export const FINDING_TYPES = Object.freeze(Object.keys(DEFAULT_SEVERITY));

export const SEVERITY_RANK = Object.freeze({
  blocker: 0,
  major: 1,
  minor: 2,
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

const LEGACY_FINDING_TYPE = Object.freeze({
  "missing-delivery-statement": "incomplete-delivery-reach",
  "scope-contradiction": "non-modular-section",
  "unreadable-input": "malformed-document",
});
const FINDING_TYPE_SET = new Set(FINDING_TYPES);

export function resolveSeverity(findingType, requestedSeverity, defaults = DEFAULT_SEVERITY) {
  const canonicalType = canonicalFindingType(findingType);
  assertFindingType(canonicalType);
  if (DEFAULT_SEVERITY[canonicalType] === "blocker") return "blocker";
  const severity = requestedSeverity ?? defaults[canonicalType];
  if (!(severity in SEVERITY_RANK)) {
    throw new TypeError(`invalid severity for ${findingType}: ${String(severity)}`);
  }
  return severity;
}

export function makeFinding(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("makeFinding expects an object");
  }
  const findingType = canonicalFindingType(input.findingType);
  assertFindingType(findingType);
  const remediation = normalizeRemediation(input.remediation);
  return Object.freeze({
    findingType,
    severity: resolveSeverity(findingType, input.severity),
    guidelineAnchor: populated(
      input.ruleId ?? input.ruleAnchor ?? input.guidelineAnchor,
      "-",
    ),
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

export function canonicalFindingType(findingType) {
  const supplied = String(findingType ?? "");
  return LEGACY_FINDING_TYPE[supplied] ?? supplied;
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
