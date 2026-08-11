import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const DELIVERY_BASE_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-delivery-authorized-base-recovery-evidence/v1";
export const DELIVERY_BASE_RECOVERY_PLAN_SCHEMA =
  "agentic-delivery-authorized-base-recovery-plan/v1";
export const DELIVERY_BASE_RECOVERY_RECEIPT_SCHEMA =
  "agentic-delivery-authorized-base-recovery-receipt/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildDeliveryAuthorizedBaseRecoveryPlan(input) {
  const evidence = normalizeDeliveryAuthorizedBaseRecoveryEvidence(input);
  const findings = findingsFor(evidence);
  const core = Object.freeze({
    schema: DELIVERY_BASE_RECOVERY_PLAN_SCHEMA,
    operation: "delivery-authorized-base-recovery",
    status: findings.length === 0 ? "planned" : "blocked",
    evidence,
    evidenceDigest: digestValue(evidence),
    findings,
    allowedEffects: Object.freeze([
      "pull-request-draft-demotion",
      "same-owner-successor-claim",
      "predecessor-retirement",
      "writer-lease-base-cas",
      "pull-request-marker-projection",
    ]),
    forbiddenEffects: Object.freeze([
      "source-edit",
      "commit",
      "force-push",
      "merge",
      "cleanup",
      "deployment",
    ]),
  });
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: findings.length === 0
      ? `authorize delivery-authorized-base-recovery ${planDigest}`
      : null,
  });
}

export function normalizeDeliveryAuthorizedBaseRecoveryPlan(value) {
  if (value?.schema !== DELIVERY_BASE_RECOVERY_PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildDeliveryAuthorizedBaseRecoveryPlan(value.evidence);
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function assertDeliveryAuthorizedBaseRecoveryAuthorization(plan, authorization) {
  const normalized = normalizeDeliveryAuthorizedBaseRecoveryPlan(plan);
  if (normalized.status !== "planned" || !normalized.exactAuthorization) {
    throw new Error("Blocked delivery-base recovery plans cannot authorize mutation.");
  }
  if (authorization !== normalized.exactAuthorization) {
    throw new Error("Delivery-base recovery authorization does not match the exact plan.");
  }
  return normalized;
}

export function buildDeliveryAuthorizedBaseRecoveryReceipt({
  plan,
  outcome,
  successorAuthority,
  finalLeaseDigest,
  finalMarkerDigest,
  effects,
}) {
  const normalized = normalizeDeliveryAuthorizedBaseRecoveryPlan(plan);
  if (!["recovered", "already-recovered"].includes(outcome)) invalid("receipt outcome");
  const normalizedEffects = stringArray(effects, "effects");
  if (JSON.stringify(normalizedEffects) !== JSON.stringify(normalized.allowedEffects)) {
    invalid("receipt effects");
  }
  const core = Object.freeze({
    schema: DELIVERY_BASE_RECOVERY_RECEIPT_SCHEMA,
    outcome,
    planDigest: normalized.planDigest,
    originalBaseSha: normalized.evidence.originalBaseSha,
    deliveryBaseSha: normalized.evidence.deliveryBaseSha,
    sourceLeaseDigest: normalized.evidence.leaseDigest,
    sourceClaimId: normalized.evidence.claimId,
    successorClaimId: digest(successorAuthority?.claimId, "successor claim ID"),
    successorClaimDigest: digest(successorAuthority?.claimDigest, "successor claim digest"),
    successorLeaseEpoch: positiveInteger(
      successorAuthority?.leaseEpoch,
      "successor lease epoch",
    ),
    successorTransitionCounter: positiveInteger(
      successorAuthority?.transitionCounter,
      "successor transition counter",
    ),
    finalLeaseDigest: digest(finalLeaseDigest, "final lease digest"),
    finalMarkerDigest: digest(finalMarkerDigest, "final marker digest"),
    effects: normalizedEffects,
    forbiddenEffectsObserved: Object.freeze([]),
  });
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeDeliveryAuthorizedBaseRecoveryEvidence(value) {
  if (value?.schema !== DELIVERY_BASE_RECOVERY_EVIDENCE_SCHEMA) invalid("evidence schema");
  const result = {
    schema: DELIVERY_BASE_RECOVERY_EVIDENCE_SCHEMA,
    repository: text(value.repository, "repository"),
    repositoryId: text(value.repositoryId, "repository ID"),
    actorLogin: text(value.actorLogin, "actor login"),
    actorId: positiveInteger(value.actorId, "actor ID"),
    pullRequestAuthorLogin: text(value.pullRequestAuthorLogin, "pull request author"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session ID"),
    deviceId: text(value.deviceId, "device ID"),
    semanticScope: text(value.semanticScope, "semantic scope"),
    headSha: sha(value.headSha, "head SHA"),
    treeSha: sha(value.treeSha, "tree SHA"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head SHA"),
    protectedMainSha: sha(value.protectedMainSha, "protected main SHA"),
    protectedMainTreeSha: sha(value.protectedMainTreeSha, "protected main tree SHA"),
    originalBaseSha: sha(value.originalBaseSha, "original base SHA"),
    deliveryBaseSha: sha(value.deliveryBaseSha, "delivery base SHA"),
    fenceSha: sha(value.fenceSha, "fence SHA"),
    deliveryHeadSha: sha(value.deliveryHeadSha, "delivery head SHA"),
    leaseStatus: text(value.leaseStatus, "lease status"),
    leaseEpoch: positiveInteger(value.leaseEpoch, "lease epoch"),
    leaseDigest: digest(value.leaseDigest, "lease digest"),
    pullRequestNumber: positiveInteger(value.pullRequestNumber, "pull request number"),
    pullRequestNodeId: text(value.pullRequestNodeId, "pull request node ID"),
    pullRequestState: text(value.pullRequestState, "pull request state"),
    pullRequestIsDraft: boolean(value.pullRequestIsDraft, "pull request draft state"),
    pullRequestHeadSha: sha(value.pullRequestHeadSha, "pull request head SHA"),
    pullRequestBaseSha: sha(value.pullRequestBaseSha, "pull request base SHA"),
    pullRequestAutoMergeRequest: nullableObject(
      value.pullRequestAutoMergeRequest,
      "pull request auto-merge request",
    ),
    pullRequestBodyDigest: digest(value.pullRequestBodyDigest, "pull request body digest"),
    pullRequestMarkerDigest: nullableDigest(
      value.pullRequestMarkerDigest,
      "pull request marker digest",
    ),
    claimId: digest(value.claimId, "claim ID"),
    claimDigest: digest(value.claimDigest, "claim digest"),
    claimLedgerRevision: digest(value.claimLedgerRevision, "claim ledger revision"),
    ledgerRevision: sha(value.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "ledger digest"),
    claimInventoryDigest: digest(value.claimInventoryDigest, "claim inventory digest"),
    claimState: text(value.claimState, "claim state"),
    projectedAuthorityState: text(
      value.projectedAuthorityState,
      "projected authority state",
    ),
    projectedAuthorityDigest: digest(
      value.projectedAuthorityDigest,
      "projected authority digest",
    ),
    claimActorId: text(value.claimActorId, "claim actor ID"),
    claimRepositoryId: text(value.claimRepositoryId, "claim repository ID"),
    claimWriteAuthority: boolean(value.claimWriteAuthority, "claim write authority"),
    claimScopeReserved: boolean(value.claimScopeReserved, "claim scope reservation"),
    claimLeaseEpoch: positiveInteger(value.claimLeaseEpoch, "claim lease epoch"),
    claimTransitionCounter: positiveInteger(
      value.claimTransitionCounter,
      "claim transition counter",
    ),
    claimCanonicalBaseSha: sha(value.claimCanonicalBaseSha, "claim canonical base"),
    claimLaneRevision: sha(value.claimLaneRevision, "claim lane revision"),
    claimReviewRequestId: text(value.claimReviewRequestId, "claim review request"),
    claimWorkItemId: text(value.claimWorkItemId, "claim work item"),
    operationReceiptDigest: digest(
      value.operationReceiptDigest,
      "operation receipt digest",
    ),
    integrationReceiptDigest: digest(
      value.integrationReceiptDigest,
      "integration receipt digest",
    ),
    manifestDigest: digest(value.manifestDigest, "manifest digest"),
    writeSetDigest: digest(value.writeSetDigest, "write-set digest"),
    declaredWriteSet: normalizeWriteSet(value.declaredWriteSet),
    deliveryChangedPaths: pathArray(value.deliveryChangedPaths, "delivery changed paths"),
    protectedMainChangedPaths: pathArray(
      value.protectedMainChangedPaths,
      "protected-main changed paths",
    ),
    protectedMainOverlapPaths: pathArray(
      value.protectedMainOverlapPaths,
      "protected-main overlap paths",
    ),
    originalAuthoredPaths: pathArray(value.originalAuthoredPaths, "original authored paths"),
    outsideScopeEquivalenceDigest: digest(
      value.outsideScopeEquivalenceDigest,
      "outside-scope equivalence digest",
    ),
    clean: boolean(value.clean, "clean state"),
    originalBaseAncestor: boolean(value.originalBaseAncestor, "original-base ancestry"),
    deliveryBaseAncestor: boolean(value.deliveryBaseAncestor, "delivery-base ancestry"),
    deliveryBaseAncestorOfProtectedMain: boolean(
      value.deliveryBaseAncestorOfProtectedMain,
      "protected-main delivery-base ancestry",
    ),
    fenceAncestor: boolean(value.fenceAncestor, "fence ancestry"),
  };
  exact(value, Object.keys(result), "evidence");
  return Object.freeze(result);
}

function findingsFor(value) {
  const findings = [];
  const declaredPaths = new Set(value.declaredWriteSet
    .filter(item => item.startsWith("path:"))
    .map(item => item.slice(5)));
  if (!value.clean) findings.push("dirty-source-lane");
  if (value.leaseStatus !== "active") findings.push("local-lease-not-active");
  if (value.projectedAuthorityState !== "delivery_authorized") {
    findings.push("projection-not-delivery-authorized");
  }
  if (value.claimState !== "dormant-preserved") {
    findings.push("claim-not-dormant-preserved");
  }
  if (value.claimWriteAuthority || !value.claimScopeReserved) {
    findings.push("claim-authority-shape-invalid");
  }
  if (value.pullRequestState !== "OPEN" || value.pullRequestIsDraft) {
    findings.push("pull-request-not-open-ready");
  }
  if (value.pullRequestAutoMergeRequest !== null) findings.push("auto-merge-still-armed");
  if (value.actorLogin !== value.pullRequestAuthorLogin) findings.push("owner-identity-mismatch");
  if (value.originalBaseSha === value.deliveryBaseSha) findings.push("no-base-drift");
  if (!value.originalBaseAncestor) findings.push("original-base-not-ancestor");
  if (!value.deliveryBaseAncestor) findings.push("delivery-base-not-ancestor");
  if (!value.deliveryBaseAncestorOfProtectedMain) {
    findings.push("protected-main-not-delivery-base-descendant");
  }
  if (!value.fenceAncestor) findings.push("fence-not-ancestor");
  if (new Set([
    value.headSha,
    value.remoteHeadSha,
    value.pullRequestHeadSha,
    value.claimLaneRevision,
    value.deliveryHeadSha,
  ]).size !== 1) findings.push("head-identity-drift");
  if (new Set([
    value.deliveryBaseSha,
    value.pullRequestBaseSha,
    value.claimCanonicalBaseSha,
  ]).size !== 1) findings.push("delivery-base-identity-drift");
  if (value.declaredWriteSet.some(item => item.startsWith("semantic:")
    && item !== `semantic:${value.semanticScope}`)) findings.push("semantic-scope-drift");
  if (value.deliveryChangedPaths.some(item => !declaredPaths.has(item))) {
    findings.push("delivery-diff-outside-write-set");
  }
  if (value.protectedMainOverlapPaths.length > 0) {
    findings.push("protected-main-drift-overlaps-write-set");
  }
  if (value.originalAuthoredPaths.some(item => !declaredPaths.has(item))) {
    findings.push("original-authorship-outside-write-set");
  }
  return Object.freeze([...new Set(findings)].sort());
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    invalid(label);
  }
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) {
    invalid(label);
  }
  return value;
}
function sha(value, label) {
  const result = text(value, label);
  if (!SHA.test(result)) invalid(label);
  return result;
}
function digest(value, label) {
  const result = text(value, label);
  if (!DIGEST.test(result)) invalid(label);
  return result;
}
function nullableDigest(value, label) {
  return value === null ? null : digest(value, label);
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}
function nullableObject(value, label) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}
function stringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) {
    invalid(label);
  }
  return Object.freeze([...value]);
}
function pathArray(value, label) {
  const result = stringArray(value, label);
  if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n")) {
    invalid(label);
  }
  return result;
}
function invalid(label) {
  throw new Error(`Invalid delivery-authorized base recovery ${label}.`);
}
