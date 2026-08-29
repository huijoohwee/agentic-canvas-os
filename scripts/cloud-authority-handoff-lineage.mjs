import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { scopeExpansionLineageAdmissionMatches } from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import { scopeExpansionLineageProjectionProofMatches } from "./cloud-authority-scope-expansion-lineage-projection.mjs";
import { normalizeBoundAuthority, projectRootState } from "./scoped-lane-cloud-reconciliation.mjs";
import { integratedPreservedRecoveryEvidence } from "./scoped-lane-cloud-authority.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";
export const CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA = "agentic-cloud-authority-handoff-controller-result/v1";
export const CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA = "agentic-cloud-authority-handoff-receipt/v1";
const RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const WORK_ITEM_PATTERN = /^work-item:[0-9a-f]{64}$/u;
const REPOSITORY_ID_PATTERN = /^github-repository:[A-Za-z0-9_-]+$/u;
const TRANSITIONS = new Set(["retain", "reclaim", "handoff"]);
export function normalizeContinuationRequest(input = {}) {
  const transition = requiredText(input.transition || input.action || "reclaim", "transition");
  if (!TRANSITIONS.has(transition)) throw new Error(`Unsupported transition ${transition}.`);
  const sessionId = requiredText(input.sessionId, "sessionId");
  return Object.freeze({
    transition,
    branch: requiredText(input.branch, "branch"),
    sessionId,
    ttlSeconds: positiveInteger(input.ttlSeconds ?? 1800, "ttlSeconds"),
    successorSessionId: requiredText(input.successorSessionId || sessionId, "successorSessionId"),
    successorDeviceId: requiredText(input.successorDeviceId || input.deviceId, "successorDeviceId"),
  });
}

export function buildCloudAuthoritySuccessorClaimRequest({ request, lane, predecessor }) {
  const workItemId = requiredCanonicalWorkItemId(predecessor?.workItemId);
  const predecessorLeaseEpoch = positiveInteger(predecessor?.leaseEpoch, "observed predecessor leaseEpoch");
  if (predecessorLeaseEpoch === Number.MAX_SAFE_INTEGER) {
    throw new Error("Observed predecessor leaseEpoch cannot advance safely.");
  }
  const leaseEpoch = predecessorLeaseEpoch + 1;
  return Object.freeze({
    targetRepository: lane.authority.targetRepository,
    workItemId,
    canonicalBaseSha: requiredSha(
      predecessor?.canonicalBaseRevision,
      "observed predecessor canonicalBaseRevision",
    ),
    headSha: requiredSha(predecessor?.laneRevision, "observed predecessor laneRevision"),
    declaredWriteSet: normalizeWriteSet(predecessor?.declaredWriteScope),
    predecessorClaimId: requiredDigest(predecessor?.claimId, "observed predecessor claimId"),
    leaseEpoch,
    ttlSeconds: request.ttlSeconds,
    deviceId: request.successorDeviceId,
    sessionId: request.successorSessionId,
    idempotencyKey: [
      "cloud-authority-continuation",
      request.transition,
      predecessor.claimId,
      workItemId,
      leaseEpoch,
      predecessor.laneRevision,
      lane.authority.reviewRequestId,
      request.successorDeviceId,
      request.successorSessionId,
    ].join(":"),
  });
}

export function classifyPredecessor({ lane, actor, status, request = null, lineageAdmission = null, lineageProjectionProof = null }) {
  const unavailable = predecessorResult("unavailable");
  if (!completeStatus(status)) return unavailable;
  const matches = status.claims.filter(claim => claim?.claimId === lane.authority.claimId);
  if (matches.length === 0) return predecessorResult("missing");
  if (matches.length > 1) {
    return predecessorResult("duplicate", null, null,
      matches.map(claim => String(claim.claimId)).sort());
  }
  const candidate = matches[0];
  if (!predecessorImmutableIdentityMatches({
    claim: candidate, lane, actor, status, request, repositoryId: status.repositoryId,
    lineageAdmission, lineageProjectionProof,
  })) {
    return predecessorResult("mismatched", null, candidate);
  }
  return predecessorResult("ready", candidate, candidate, [candidate.claimId]);
}
export function classifyIntegratedReplay({
  request,
  lane,
  actor,
  status,
  predecessor,
  claimAssociations = null,
}) {
  const empty = integratedReplayResult();
  if (request.transition !== "reclaim" || !completeStatus(status)) return empty;
  const claim = predecessor.candidate;
  if (!claim) return empty;
  const applicable = Boolean(claim.integration || claim.integrationReceiptDigest)
    || projectRootState(claim.state) === "delivery_authorized";
  if (!applicable) return empty;

  const drifted = [];
  if (!integratedReplayClaimMatches({
    claim, lane, predecessor,
  })) drifted.push(claim.claimId);
  const derivatives = status.claims.filter(
    candidate => candidate?.predecessorClaimId === lane.authority.claimId,
  );
  const queuedMatches = derivatives.map(candidate => ({
    candidate,
    ...integratedReplayQueuedClaimMatch({
      candidate,
      claim,
      lane,
      claimAssociations,
    }),
  })).filter(match => match.variant);
  const exactQueued = queuedMatches.map(match => match.candidate);
  for (const derivative of derivatives) {
    if (!exactQueued.includes(derivative)) drifted.push(derivative?.claimId || "missing-claim-id");
  }
  const ambiguous = exactQueued.length > 1
    ? exactQueued.map(candidate => candidate.claimId).sort()
    : [];
  return integratedReplayResult({
    applicable: true,
    claim: drifted.length === 0 && ambiguous.length === 0 ? claim : null,
    queuedClaim: drifted.length === 0 && exactQueued.length === 1 ? exactQueued[0] : null,
    queuedClaimVariant: drifted.length === 0 && queuedMatches.length === 1
      ? queuedMatches[0].variant
      : null,
    associationFrameDigest: drifted.length === 0 && queuedMatches.length === 1
      ? queuedMatches[0].associationFrameDigest
      : null,
    ambiguousClaimIds: ambiguous,
    driftedClaimIds: [...new Set(drifted)].sort(),
  });
}

export function classifyResumableSuccessor({ request, lane, actor, status, predecessor }) {
  if (request.transition === "retain" || !completeStatus(status) || !predecessor.claim) {
    return emptyResumableSuccessor();
  }
  const actorId = authenticatedActorId(actor);
  const expectedWriteSet = normalizeWriteSet(lane.manifest.declaredWriteSet);
  const matches = status.claims.filter(claim => {
    const state = resumableSuccessorState(claim?.state);
    const reviewRequestId = claim?.reviewRequestId || null;
    const reviewMatches = state === "review_ready"
      ? reviewRequestId === lane.authority.reviewRequestId
      : reviewRequestId === null || reviewRequestId === lane.authority.reviewRequestId;
    try {
      return Boolean(
        actorId
        && DIGEST_PATTERN.test(String(claim.claimId || ""))
        && claim.claimId !== predecessor.claim.claimId
        && claim.entrySchema === predecessor.claim.entrySchema
        && claim.claimIdentitySchema === predecessor.claim.claimIdentitySchema
        && claim.actorId === actorId
        && claim.repositoryId === predecessor.claim.repositoryId
        && claim.workItemId === predecessor.claim.workItemId
        && claim.predecessorClaimId === predecessor.claim.claimId
        && claim.canonicalBaseRevision === lane.baseSha
        && claim.laneRevision === lane.headSha
        && claim.writeSetDigest === lane.manifest.writeSetDigest
        && sameWriteSet(claim.declaredWriteScope, expectedWriteSet)
        && claim.leaseEpoch === predecessor.claim.leaseEpoch + 1
        && state
        && reviewMatches
      );
    } catch {
      return false;
    }
  }).sort((left, right) => left.claimId.localeCompare(right.claimId));
  return matches.length === 1
    ? Object.freeze({ claim: matches[0], ambiguousClaimIds: Object.freeze([]) })
    : Object.freeze({
      claim: null,
      ambiguousClaimIds: Object.freeze(matches.map(claim => claim.claimId)),
    });
}
export function emptyResumableSuccessor() {
  return Object.freeze({ claim: null, ambiguousClaimIds: Object.freeze([]) });
}
export function validateContinuation({ request, lane, actor, status, predecessor, successor, integratedReplay, lineageProjectionProof = null }) {
  const findings = [];
  if (!parseDeviceBranch(lane.branch)) findings.push(finding("invalid-branch-identity"));
  if (!lane.clean) findings.push(finding("dirty-preserved-lane"));
  const integratedDeliveryReplay = integratedReplay?.applicable === true
    && (
      lane.lease.status === "delivery"
      || lane.authority.state === "delivery_authorized"
    );
  if (integratedDeliveryReplay) {
    if (lane.lease.status !== "delivery") findings.push(finding("lane-not-delivery"));
    if (
      request.successorDeviceId !== lane.lease.device
      || request.successorSessionId !== lane.lease.sessionId
    ) {
      findings.push(finding("integrated-delivery-recipient-drift"));
    }
  } else if (lane.lease.status !== "review_ready") {
    findings.push(finding("lane-not-review-ready"));
  }
  if (lane.pullRequest.state !== "OPEN" || lane.pullRequest.isDraft) {
    findings.push(finding("review-projection-not-ready"));
  }
  if (integratedDeliveryReplay && lane.pullRequest.autoMergeRequest?.mergeMethod !== "SQUASH") {
    findings.push(finding("integrated-delivery-auto-merge-not-armed"));
  }
  if (lane.pullRequest.baseRefName !== "main") findings.push(finding("pull-request-base-drift"));
  const expectedHead = requiredSha(
    integratedDeliveryReplay ? lane.lease.deliveryHeadSha : lane.lease.reviewHeadSha,
    integratedDeliveryReplay ? "lease deliveryHeadSha" : "lease reviewHeadSha",
  );
  const exactHead = lane.headSha === expectedHead
    && (!integratedDeliveryReplay || lane.localHeadSha === expectedHead)
    && lane.remoteHeadSha === expectedHead
    && lane.pullRequest.headRefOid === expectedHead
    && lane.authority.laneRevision === expectedHead;
  const refreshedHead = !integratedDeliveryReplay
    && lane.headSha === expectedHead
    && lane.authority.laneRevision === expectedHead
    && lane.protectedMainRefresh
    && lane.refreshedHeadSha === lane.remoteHeadSha
    && lane.refreshedHeadSha === lane.pullRequest.headRefOid;
  if (!exactHead && !refreshedHead) findings.push(finding("exact-head-drift"));
  validateOwnerAndAuthority({
    request,
    lane,
    actor,
    integratedReplay,
    findings,
  });
  if (!completeStatus(status)) {
    findings.push(finding("cloud-status-unavailable"));
    return findings.sort(compareFindings);
  }
  validatePredecessor({ lane, predecessor, integratedReplay, findings });
  if (successor.ambiguousClaimIds.length > 0) {
    findings.push(finding("ambiguous-successor-continuation", {
      competingClaimIds: successor.ambiguousClaimIds,
    }));
  }
  if (integratedReplay.ambiguousClaimIds.length > 0) {
    findings.push(finding("ambiguous-integrated-replay-successor", {
      competingClaimIds: integratedReplay.ambiguousClaimIds,
    }));
  }
  if (integratedReplay.driftedClaimIds.length > 0) {
    findings.push(finding("integrated-replay-drift", {
      competingClaimIds: integratedReplay.driftedClaimIds,
    }));
  }
  validateCompetingClaims({ lane, status, successor, integratedReplay, findings });
  const exactTerminalProjection = integratedReplay?.applicable
    && integratedReplay.claim === predecessor?.claim
    && scopeExpansionLineageProjectionProofMatches({ proof: lineageProjectionProof,
      claim: integratedReplay.claim, lane, status, repositoryId: status?.repositoryId, request });
  return (exactTerminalProjection
    ? findings.filter(item => item.type !== "legacy-authority-still-live")
    : findings).sort(compareFindings);
}

export function assertResumableSuccessorReplay({ claimResult, resumableSuccessor, lane, predecessor }) {
  const claim = claimResult?.claim;
  if (
    claimResult?.schema !== RESULT_SCHEMA
    || claimResult.ok !== true
    || claimResult.action !== "claim"
    || !successorClaimMatchesPredecessor({ claim, predecessor, lane })
    || (resumableSuccessor && (
      claimResult.replayed !== true
      || !sameSuccessorIdentity(claim, resumableSuccessor)
    ))
    || (!resumableSuccessor && claimResult.replayed !== false)
  ) {
    throw new Error("Cloud claim did not preserve the exact observed predecessor identity.");
  }
}

export function assertIntegratedReplayRecovery({ recovered, integratedReplay, lane }) {
  const authority = recovered?.authority;
  const reference = integratedReplay.claim;
  const deliveryReplay = lane.lease.status === "delivery"
    || lane.authority.state === "delivery_authorized";
  if (!deliveryReplay) {
    if (
      !authority
      || authority.schema !== "agentic-lane-cloud-authority/v1"
      || authority.claimId !== lane.authority.claimId
      || authority.claimId !== reference.claimId
      || authority.canonicalBaseSha !== lane.baseSha
      || authority.laneRevision !== lane.headSha
      || authority.writeSetDigest !== lane.manifest.writeSetDigest
      || !sameWriteSet(authority.cloudDeclaredWriteScope, lane.manifest.declaredWriteSet)
      || authority.leaseEpoch !== lane.authority.leaseEpoch
      || authority.reviewRequestId !== lane.authority.reviewRequestId
      || authority.state !== "delivery_authorized"
      || !DIGEST_PATTERN.test(String(authority.operationReceiptDigest || ""))
      || authority.integrationReceiptDigest !== reference.integrationReceiptDigest
      || digestValue(authority.integration) !== digestValue(reference.integration)
      || !DIGEST_PATTERN.test(String(recovered.convergenceEvidenceDigest || ""))
    ) {
      throw new Error(
        "Integrated-preserved replay did not preserve the exact reviewed integration authority.",
      );
    }
    return;
  }
  const recoveryEvidenceDigest = digestValue(integratedPreservedRecoveryEvidence({
    branch: lane.branch,
    authority: lane.authority,
    manifest: lane.manifest,
  }));
  const recoveredAt = recovered?.convergenceEvidence?.recoveredAt;
  const canonicalRecoveredAt = Number.isFinite(Date.parse(recoveredAt))
    && recoveredAt === new Date(Date.parse(recoveredAt)).toISOString();
  const expectedConvergenceEvidence = authority ? Object.freeze({
    schema: "agentic-integrated-replay-convergence-evidence/v1",
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    fenceRevision: authority.claimDigest,
    claimLedgerRevision: authority.claimLedgerRevision,
    transitionDigest: authority.claimLedgerRevision,
    transitionCounter: authority.transitionCounter,
    state: authority.state,
    expiresAt: authority.expiresAt,
    branch: lane.branch,
    canonicalBaseSha: authority.canonicalBaseSha,
    candidateRevision: authority.laneRevision,
    manifestDigest: lane.manifest.manifestDigest,
    writeSetDigest: authority.writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    reviewRequestId: authority.reviewRequestId,
    focusedEvidenceDigest: authority.focusedEvidenceDigest,
    currentOperationReceiptDigest: authority.operationReceiptDigest,
    integrationReceiptDigest: authority.integrationReceiptDigest,
    integrationEvidenceDigest: digestValue(authority.integration),
    recoveryEvidenceDigest,
    recoveredAt,
    currentQueuedDerivativeDisposition: "absent-from-verified-inventory",
    overlappingCurrentClaimIds: Object.freeze([]),
    lifecycleAttribution: "not-reconstructed",
    observation: "current-state-only",
  }) : null;
  const exactCurrentReference = authority && reference && (
    authority.claimDigest === reference.fenceRevision
    && authority.claimLedgerRevision === reference.transitionDigest
    && authority.transitionCounter === reference.transitionCounter
    && authority.expiresAt === reference.expiresAt
    && authority.operationReceiptDigest === reference.operationReceiptDigest
  );
  const strictRecoveredDescendant = authority && reference
    && projectRootState(reference.state) === "parked"
    && DIGEST_PATTERN.test(String(authority.claimDigest || ""))
    && authority.claimDigest !== reference.fenceRevision
    && DIGEST_PATTERN.test(String(authority.claimLedgerRevision || ""))
    && authority.claimLedgerRevision !== reference.transitionDigest
    && Number.isSafeInteger(authority.transitionCounter)
    && authority.transitionCounter > reference.transitionCounter
    && DIGEST_PATTERN.test(String(authority.operationReceiptDigest || ""))
    && authority.operationReceiptDigest !== reference.operationReceiptDigest
    && authority.operationReceiptDigest !== authority.integrationReceiptDigest
    && Number.isFinite(Date.parse(authority.expiresAt))
    && Date.parse(authority.expiresAt) > Date.parse(reference.expiresAt)
    && Date.parse(authority.expiresAt) > Date.now();
  const allowedCurrentProjection = projectRootState(reference?.state) === "delivery_authorized"
    ? exactCurrentReference
    : strictRecoveredDescendant;
  if (
    !authority
    || authority.schema !== "agentic-lane-cloud-authority/v1"
    || authority.claimId !== lane.authority.claimId
    || authority.claimId !== reference.claimId
    || authority.entrySchema !== lane.authority.entrySchema
    || authority.claimIdentitySchema !== lane.authority.claimIdentitySchema
    || authority.canonicalBaseSha !== lane.baseSha
    || authority.laneRevision !== lane.headSha
    || authority.writeSetDigest !== lane.manifest.writeSetDigest
    || !sameWriteSet(authority.cloudDeclaredWriteScope, lane.manifest.declaredWriteSet)
    || authority.leaseEpoch !== lane.authority.leaseEpoch
    || authority.reviewRequestId !== lane.authority.reviewRequestId
    || authority.focusedEvidenceDigest !== lane.authority.focusedEvidenceDigest
    || authority.manifestDigest !== lane.manifest.manifestDigest
    || authority.deviceId !== lane.lease.device
    || authority.sessionId !== lane.lease.sessionId
    || reference.deviceId !== lane.cloudSubject?.deviceId
    || reference.sessionId !== lane.cloudSubject?.sessionId
    || authority.state !== "delivery_authorized"
    || !allowedCurrentProjection
    || authority.integrationReceiptDigest !== reference.integrationReceiptDigest
    || digestValue(authority.integration) !== digestValue(reference.integration)
    || !canonicalRecoveredAt
    || recovered.convergenceEvidence?.recoveryEvidenceDigest !== recoveryEvidenceDigest
    || digestValue(recovered.convergenceEvidence) !== digestValue(expectedConvergenceEvidence)
    || recovered.convergenceEvidenceDigest !== digestValue(expectedConvergenceEvidence)
  ) {
    throw new Error(
      "Integrated-preserved replay did not preserve the exact reviewed integration authority.",
    );
  }
}

export function projectSuccessorClaimAuthority({ result, lane, successorDeviceId, successorSessionId }) {
  if (result?.schema !== RESULT_SCHEMA || result.ok !== true || result.action !== "claim") {
    throw new Error("Successor continuation requires a successful cloud claim result.");
  }
  return normalizeBoundAuthority({
    result: {
      ...result,
      ledgerDigest: requiredDigest(
        result.ledgerDigest || result.receipt?.ledgerDigest,
        "claim ledger digest",
      ),
    },
    authority: {
      ledgerRepository: lane.authority.ledgerRepository,
      targetRepository: lane.authority.targetRepository,
      deviceId: requiredText(successorDeviceId, "successorDeviceId"),
      sessionId: requiredText(successorSessionId, "successorSessionId"),
      focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
    },
    manifest: lane.manifest,
    deviceId: successorDeviceId,
    sessionId: successorSessionId,
    focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
  });
}

export function finalizeContinuationResult({
  request, lane, actor, outcome, authority = null, receipts,
  blockingFindings = [], projectionUpdated = false,
}) {
  const result = {
    schema: CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
    outcome,
    transition: request.transition,
    branch: lane.branch,
    pullRequestUrl: lane.pullRequest.url,
    canonicalBaseSha: lane.baseSha,
    reviewedHeadSha: lane.headSha,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorClaimId: authority?.claimId || null,
    successorLeaseEpoch: authority?.leaseEpoch || null,
    reviewRequestId: authority?.reviewRequestId || lane.authority.reviewRequestId,
    projectionUpdated,
    actorLogin: actor.login,
    blockingFindings,
    receipts,
  };
  return Object.freeze({ ...result, resultDigest: digestValue(result) });
}

export function buildHandoffReceipt(kind, payload) {
  const receipt = { schema: CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA, kind, payload };
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

function predecessorImmutableIdentityMatches({ claim, lane, actor, repositoryId, status = null,
  request = null, lineageAdmission = null, lineageProjectionProof = null }) {
  const authority = lane.authority;
  const strictLineageValid = claim?.leaseEpoch === 1
    ? claim.predecessorClaimId === null || claim.predecessorClaimId === undefined
    : DIGEST_PATTERN.test(String(claim?.predecessorClaimId || ""));
  const predecessorLineageValid = strictLineageValid || scopeExpansionLineageAdmissionMatches({
    admission: lineageAdmission, claim, lane, status, repositoryId, request,
  }) || scopeExpansionLineageProjectionProofMatches({
    proof: lineageProjectionProof, claim, lane, status, repositoryId, request,
  });
  try {
    return Boolean(
      authenticatedActorId(actor)
      && DIGEST_PATTERN.test(String(claim?.claimId || ""))
      && claim.claimId === authority.claimId
      && claim.entrySchema === authority.entrySchema
      && claim.entrySchema === ENTRY_SCHEMA
      && claim.claimIdentitySchema === authority.claimIdentitySchema
      && claim.claimIdentitySchema === ENTRY_SCHEMA
      && claim.actorId === authenticatedActorId(actor)
      && REPOSITORY_ID_PATTERN.test(String(repositoryId || ""))
      && claim.repositoryId === repositoryId
      && WORK_ITEM_PATTERN.test(String(claim.workItemId || ""))
      && predecessorLineageValid
      && claim.canonicalBaseRevision === lane.baseSha
      && claim.laneRevision === lane.headSha
      && claim.writeSetDigest === lane.manifest.writeSetDigest
      && sameWriteSet(claim.declaredWriteScope, lane.manifest.declaredWriteSet)
      && claim.leaseEpoch === authority.leaseEpoch
      && claim.reviewRequestId === authority.reviewRequestId
    );
  } catch {
    return false;
  }
}

function predecessorReviewProjectionMatches({ claim, lane }) {
  return Boolean(
    ["review_ready", "parked"].includes(projectRootState(claim.state))
    && claim.fenceRevision === lane.authority.claimDigest
    && claim.transitionDigest === lane.authority.claimLedgerRevision
    && claim.transitionCounter === lane.authority.transitionCounter
    && claim.expiresAt === lane.authority.expiresAt
    && claim.operationReceiptDigest === lane.authority.operationReceiptDigest
    && !claim.integrationReceiptDigest
    && !claim.integration
  );
}

function integratedReplayClaimMatches({ claim, lane, predecessor }) {
  const integration = claim?.integration;
  const integrationKeys = [
    "candidateRevision",
    "reviewRequestId",
    "focusedEvidenceDigest",
    "dependencyClosureDigest",
    "namedChecksDigest",
    "handoffEvidenceDigest",
    "operatorDecisionDigest",
    "integrationIntentDigest",
    "integratedAt",
  ];
  try {
    return Boolean(
      predecessor?.status === "ready"
      && predecessor.claim === claim
      && predecessor.candidate === claim
      && ["delivery_authorized", "parked"].includes(projectRootState(claim.state))
      && DIGEST_PATTERN.test(String(claim.integrationReceiptDigest || ""))
      && integration
      && JSON.stringify(Object.keys(integration).sort()) === JSON.stringify([...integrationKeys].sort())
      && integration.candidateRevision === lane.headSha
      && integration.reviewRequestId === lane.authority.reviewRequestId
      && integration.focusedEvidenceDigest === lane.authority.focusedEvidenceDigest
      && integrationKeys.slice(3, 8).every(
        key => DIGEST_PATTERN.test(String(integration[key] || "")),
      )
      && Number.isFinite(Date.parse(integration.integratedAt))
      && (!integratedDeliveryProjection(lane)
        || exactIntegratedDeliveryAuthorityMatchesClaim({ claim, lane })
        || liveIntegratedDeliveryDescendantMatchesClaim({ claim, lane }))
    );
  } catch {
    return false;
  }
}

function integratedReplayQueuedClaimMatch({ candidate, claim, lane, claimAssociations }) {
  if (integratedReplayExactSuccessorMatches({ candidate, claim, lane })) {
    return Object.freeze({
      variant: "exact-successor",
      associationFrameDigest: null,
    });
  }
  const associationFrameDigest = claimOnlyAssociationFrameDigest({
    claimId: candidate?.claimId,
    claimAssociations,
  });
  if (
    associationFrameDigest
    && integratedReplayClaimOnlyDerivativeMatches({ candidate, claim, lane })
  ) {
    return Object.freeze({
      variant: "claim-only-unprojected",
      associationFrameDigest,
    });
  }
  return Object.freeze({ variant: null, associationFrameDigest: null });
}

function integratedReplayExactSuccessorMatches({ candidate, claim, lane }) {
  try {
    return Boolean(
      DIGEST_PATTERN.test(String(candidate?.claimId || ""))
      && candidate.claimId !== claim.claimId
      && projectRootState(candidate.state) === "waiting-successor"
      && candidate.entrySchema === claim.entrySchema
      && candidate.claimIdentitySchema === claim.claimIdentitySchema
      && candidate.actorId === claim.actorId
      && candidate.repositoryId === claim.repositoryId
      && candidate.workItemId === claim.workItemId
      && candidate.predecessorClaimId === claim.claimId
      && candidate.canonicalBaseRevision === lane.baseSha
      && candidate.laneRevision === lane.headSha
      && candidate.writeSetDigest === lane.manifest.writeSetDigest
      && sameWriteSet(candidate.declaredWriteScope, lane.manifest.declaredWriteSet)
      && candidate.leaseEpoch === claim.leaseEpoch + 1
      && !candidate.reviewRequestId
      && !candidate.integration
      && !candidate.integrationReceiptDigest
    );
  } catch {
    return false;
  }
}

function integratedReplayClaimOnlyDerivativeMatches({ candidate, claim, lane }) {
  try {
    const declaredWriteScope = normalizeWriteSet(candidate?.declaredWriteScope);
    return Boolean(
      lane.lease.status === "delivery"
      && lane.authority.state === "delivery_authorized"
      && DIGEST_PATTERN.test(String(candidate?.claimId || ""))
      && candidate.claimId !== claim.claimId
      && candidate.state === "waiting-successor"
      && candidate.writeAuthority === false
      && candidate.scopeReserved === false
      && candidate.entrySchema === claim.entrySchema
      && candidate.claimIdentitySchema === claim.claimIdentitySchema
      && candidate.actorId === claim.actorId
      && candidate.deviceId === claim.deviceId
      && candidate.repositoryId === claim.repositoryId
      && candidate.workItemId !== claim.workItemId
      && WORK_ITEM_PATTERN.test(String(candidate.workItemId || ""))
      && candidate.predecessorClaimId === claim.claimId
      && candidate.canonicalBaseRevision === lane.baseSha
      && candidate.laneRevision === lane.baseSha
      && candidate.writeSetDigest === digestValue(declaredWriteScope)
      && writeSetsOverlap(declaredWriteScope, lane.manifest.declaredWriteSet)
      && candidate.leaseEpoch === 1
      && candidate.transitionCounter === 1
      && candidate.heartbeatCounter === 0
      && candidate.reviewRequestId === null
      && candidate.integration === null
      && candidate.integrationReceiptDigest === null
      && candidate.recovery === null
      && !candidate.retirement
      && !candidate.handoff
      && !candidate.release
      && DIGEST_PATTERN.test(String(candidate.fenceRevision || ""))
      && DIGEST_PATTERN.test(String(candidate.transitionDigest || ""))
      && DIGEST_PATTERN.test(String(candidate.operationReceiptDigest || ""))
      && Number.isFinite(Date.parse(candidate.expiresAt))
    );
  } catch {
    return false;
  }
}

function claimOnlyAssociationFrameDigest({ claimId, claimAssociations }) {
  try {
    if (
      claimAssociations?.schema !== "agentic-cloud-authority-handoff-claim-associations/v1"
      || !Array.isArray(claimAssociations.claims)
      || claimAssociations.claims.length !== 1
      || !DIGEST_PATTERN.test(String(claimAssociations.writerRegistryDigest || ""))
      || !DIGEST_PATTERN.test(String(claimAssociations.providerInventoryDigest || ""))
      || !Number.isSafeInteger(claimAssociations.providerPullRequestCount)
      || claimAssociations.providerPullRequestCount < 0
      || !Number.isSafeInteger(claimAssociations.providerPageCount)
      || claimAssociations.providerPageCount < 1
    ) return null;
    const core = {
      schema: claimAssociations.schema,
      writerRegistryDigest: claimAssociations.writerRegistryDigest,
      providerInventoryDigest: claimAssociations.providerInventoryDigest,
      providerPullRequestCount: claimAssociations.providerPullRequestCount,
      providerPageCount: claimAssociations.providerPageCount,
      claims: claimAssociations.claims,
    };
    if (
      !DIGEST_PATTERN.test(String(claimAssociations.frameDigest || ""))
      || claimAssociations.frameDigest !== digestValue(core)
    ) return null;
    const matches = claimAssociations.claims.filter(item => item?.claimId === claimId);
    if (matches.length !== 1) return null;
    const match = matches[0];
    if (
      !Array.isArray(match.writerLeaseMatchDigests)
      || !Array.isArray(match.pullRequestMarkerMatchDigests)
      || match.writerLeaseMatchDigests.length > 0
      || match.pullRequestMarkerMatchDigests.length > 0
    ) return null;
    return claimAssociations.frameDigest;
  } catch {
    return null;
  }
}

function validateOwnerAndAuthority({ request, lane, actor, integratedReplay, findings }) {
  if (!lane.remoteLease) findings.push(finding("missing-authoritative-owner-marker"));
  const integratedDeliveryReplay = integratedReplay?.applicable === true
    && (
      lane.lease.status === "delivery"
      || lane.authority.state === "delivery_authorized"
    );
  const markerDrift = integratedDeliveryReplay
    ? lane.remoteLease && (
      lane.remoteLease.status !== "delivery"
      || lane.remoteLease.branch !== lane.lease.branch
      || lane.remoteLease.baseSha !== lane.lease.baseSha
      || lane.remoteLease.scope !== lane.lease.scope
      || lane.remoteLease.deliveryHeadSha !== lane.lease.deliveryHeadSha
      || digestValue(lane.remoteLease.cloudAuthority)
        !== digestValue(lane.lease.cloudAuthority)
      || digestValue(lane.lease.cloudAuthority) !== digestValue(lane.authority)
    )
    : lane.remoteLease && (
      lane.remoteLease.branch !== lane.lease.branch
      || lane.remoteLease.baseSha !== lane.lease.baseSha
      || lane.remoteLease.scope !== lane.lease.scope
      || lane.remoteLease.reviewHeadSha !== lane.lease.reviewHeadSha
      || lane.remoteLease.cloudAuthority?.claimId !== lane.authority.claimId
    );
  if (markerDrift) findings.push(finding("owner-marker-drift"));
  if (integratedDeliveryReplay) {
    if (lane.authority.state !== "delivery_authorized") {
      findings.push(finding("integrated-authority-not-delivery-authorized"));
    }
  } else if (lane.authority.state !== "review_ready") {
    findings.push(finding("legacy-authority-not-review-ready"));
  }
  if (Date.parse(lane.authority.expiresAt) > Date.now()) findings.push(finding("legacy-authority-still-live"));
  if (lane.pullRequest.authorLogin !== actor.login) findings.push(finding("authenticated-owner-mismatch"));
  if (
    request.transition === "handoff"
    && request.successorSessionId === lane.lease.sessionId
    && request.successorDeviceId === lane.lease.device
  ) findings.push(finding("handoff-recipient-not-distinct"));
}

function integratedDeliveryProjection(lane) {
  return lane?.lease?.status === "delivery"
    || lane?.authority?.state === "delivery_authorized";
}

function exactIntegratedDeliveryAuthorityMatchesClaim({ claim, lane }) {
  const authority = lane.authority;
  const admission = lane.manifest;
  const integration = authority?.integration;
  try {
    const cloudDeviceId = requiredText(
      lane.cloudSubject?.deviceId,
      "cloud subject deviceId",
    );
    const cloudSessionId = requiredText(
      lane.cloudSubject?.sessionId,
      "cloud subject sessionId",
    );
    return Boolean(
      lane.lease.status === "delivery"
      && authority.state === "delivery_authorized"
      && lane.lease.deliveryHeadSha === lane.headSha
      && lane.localHeadSha === lane.headSha
      && digestValue(lane.lease.cloudAuthority) === digestValue(authority)
      && authority.schema === "agentic-lane-cloud-authority/v1"
      && authority.claimId === claim.claimId
      && authority.entrySchema === claim.entrySchema
      && authority.claimIdentitySchema === claim.claimIdentitySchema
      && authority.canonicalBaseSha === claim.canonicalBaseRevision
      && authority.laneRevision === claim.laneRevision
      && authority.writeSetDigest === admission.writeSetDigest
      && authority.writeSetDigest === claim.writeSetDigest
      && sameWriteSet(authority.cloudDeclaredWriteScope, admission.declaredWriteSet)
      && sameWriteSet(claim.declaredWriteScope, admission.declaredWriteSet)
      && authority.manifestDigest === admission.manifestDigest
      && authority.deviceId === lane.lease.device
      && authority.sessionId === lane.lease.sessionId
      && claim.deviceId === cloudDeviceId
      && claim.sessionId === cloudSessionId
      && authority.leaseEpoch === claim.leaseEpoch
      && authority.reviewRequestId === claim.reviewRequestId
      && authority.focusedEvidenceDigest === claim.integration?.focusedEvidenceDigest
      && authority.claimDigest === claim.fenceRevision
      && authority.claimLedgerRevision === claim.transitionDigest
      && authority.transitionCounter === claim.transitionCounter
      && authority.expiresAt === claim.expiresAt
      && authority.operationReceiptDigest === authority.integrationReceiptDigest
      && authority.operationReceiptDigest === claim.operationReceiptDigest
      && authority.integrationReceiptDigest === claim.integrationReceiptDigest
      && digestValue(integration) === digestValue(claim.integration)
      && projectRootState(claim.state) === "parked"
      && claim.writeAuthority === false
      && claim.scopeReserved === true
      && integration?.candidateRevision === lane.headSha
      && integration.reviewRequestId === authority.reviewRequestId
      && integration.focusedEvidenceDigest === authority.focusedEvidenceDigest
    );
  } catch {
    return false;
  }
}

function liveIntegratedDeliveryDescendantMatchesClaim({ claim, lane }) {
  const authority = lane.authority;
  const admission = lane.manifest;
  const integration = authority?.integration;
  try {
    const cloudDeviceId = requiredText(
      lane.cloudSubject?.deviceId,
      "cloud subject deviceId",
    );
    const cloudSessionId = requiredText(
      lane.cloudSubject?.sessionId,
      "cloud subject sessionId",
    );
    return Boolean(
      lane.lease.status === "delivery"
      && authority.state === "delivery_authorized"
      && lane.lease.deliveryHeadSha === lane.headSha
      && lane.localHeadSha === lane.headSha
      && digestValue(lane.lease.cloudAuthority) === digestValue(authority)
      && authority.schema === "agentic-lane-cloud-authority/v1"
      && authority.claimId === claim.claimId
      && authority.entrySchema === claim.entrySchema
      && authority.claimIdentitySchema === claim.claimIdentitySchema
      && authority.canonicalBaseSha === claim.canonicalBaseRevision
      && authority.laneRevision === claim.laneRevision
      && authority.writeSetDigest === admission.writeSetDigest
      && authority.writeSetDigest === claim.writeSetDigest
      && sameWriteSet(authority.cloudDeclaredWriteScope, admission.declaredWriteSet)
      && sameWriteSet(claim.declaredWriteScope, admission.declaredWriteSet)
      && authority.manifestDigest === admission.manifestDigest
      && authority.deviceId === lane.lease.device
      && authority.sessionId === lane.lease.sessionId
      && claim.deviceId === cloudDeviceId
      && claim.sessionId === cloudSessionId
      && authority.leaseEpoch === claim.leaseEpoch
      && authority.reviewRequestId === claim.reviewRequestId
      && authority.focusedEvidenceDigest === claim.integration?.focusedEvidenceDigest
      && authority.operationReceiptDigest === authority.integrationReceiptDigest
      && authority.integrationReceiptDigest === claim.integrationReceiptDigest
      && digestValue(integration) === digestValue(claim.integration)
      && integration?.candidateRevision === lane.headSha
      && integration.reviewRequestId === authority.reviewRequestId
      && integration.focusedEvidenceDigest === authority.focusedEvidenceDigest
      && projectRootState(claim.state) === "delivery_authorized"
      && claim.writeAuthority === false
      && claim.scopeReserved === true
      && Number.isSafeInteger(claim.transitionCounter)
      && claim.transitionCounter > authority.transitionCounter
      && DIGEST_PATTERN.test(String(claim.fenceRevision || ""))
      && claim.fenceRevision !== authority.claimDigest
      && DIGEST_PATTERN.test(String(claim.transitionDigest || ""))
      && claim.transitionDigest !== authority.claimLedgerRevision
      && DIGEST_PATTERN.test(String(claim.operationReceiptDigest || ""))
      && claim.operationReceiptDigest !== authority.operationReceiptDigest
      && claim.operationReceiptDigest !== claim.integrationReceiptDigest
      && Number.isFinite(Date.parse(claim.expiresAt))
      && Date.parse(claim.expiresAt) > Date.parse(authority.expiresAt)
      && Date.parse(claim.expiresAt) > Date.now()
      && claim.recovery
      && Object.keys(claim.recovery).length === 2
      && claim.recovery.evidenceDigest === digestValue(integratedPreservedRecoveryEvidence({
        branch: lane.branch,
        authority,
        manifest: admission,
      }))
      && Number.isFinite(Date.parse(claim.recovery.recoveredAt))
      && claim.recovery.recoveredAt
        === new Date(Date.parse(claim.recovery.recoveredAt)).toISOString()
    );
  } catch {
    return false;
  }
}
function validatePredecessor({ lane, predecessor, integratedReplay, findings }) {
  if (predecessor.status === "missing") {
    findings.push(finding("missing-predecessor-claim", { predecessorClaimId: lane.authority.claimId }));
  } else if (predecessor.status === "duplicate") {
    findings.push(finding("duplicate-predecessor-claim", {
      predecessorClaimId: lane.authority.claimId,
      matchCount: predecessor.matchingClaimIds.length,
    }));
  } else if (predecessor.status === "mismatched") {
    findings.push(finding("predecessor-identity-drift", { predecessorClaimId: lane.authority.claimId }));
  } else if (
    predecessor.claim
    && !integratedReplay.applicable
    && !predecessorReviewProjectionMatches({ claim: predecessor.claim, lane })
  ) {
    findings.push(finding("predecessor-review-state-drift", {
      predecessorClaimId: lane.authority.claimId,
    }));
  }
}
function validateCompetingClaims({ lane, status, successor, integratedReplay, findings }) {
  const excludedClaimIds = new Set([
    lane.authority.claimId,
    ...(successor.claim ? [successor.claim.claimId] : []),
    ...(integratedReplay.queuedClaim ? [integratedReplay.queuedClaim.claimId] : []),
  ]);
  const otherClaims = status.claims.filter(claim => !excludedClaimIds.has(claim.claimId));
  const overlaps = otherClaims.filter(claim => {
    try {
      return writeSetsOverlap(claim.declaredWriteScope, lane.manifest.declaredWriteSet);
    } catch {
      return true;
    }
  });
  if (overlaps.length > 0) {
    findings.push(finding("competing-live-claim", {
      competingClaimIds: overlaps.map(claim => claim.claimId).sort(),
    }));
  }
  if (otherClaims.some(claim => claim.reviewRequestId === lane.authority.reviewRequestId)) {
    findings.push(finding("review-request-already-live"));
  }
}
function sameSuccessorIdentity(left, right) {
  const keys = [
    "claimId",
    "entrySchema",
    "claimIdentitySchema",
    "actorId",
    "repositoryId",
    "workItemId",
    "predecessorClaimId",
    "canonicalBaseRevision",
    "laneRevision",
    "writeSetDigest",
    "leaseEpoch",
  ];
  return keys.every(key => left?.[key] === right?.[key])
    && sameWriteSet(left?.declaredWriteScope, right?.declaredWriteScope);
}
function successorClaimMatchesPredecessor({ claim, predecessor, lane }) {
  const state = projectRootState(claim?.state);
  return Boolean(
    DIGEST_PATTERN.test(String(claim?.claimId || ""))
    && claim.claimId !== predecessor.claimId
    && claim.entrySchema === predecessor.entrySchema
    && claim.entrySchema === ENTRY_SCHEMA
    && claim.claimIdentitySchema === predecessor.claimIdentitySchema
    && claim.actorId === predecessor.actorId
    && claim.repositoryId === predecessor.repositoryId
    && claim.workItemId === predecessor.workItemId
    && claim.predecessorClaimId === predecessor.claimId
    && claim.canonicalBaseRevision === predecessor.canonicalBaseRevision
    && claim.canonicalBaseRevision === lane.baseSha
    && claim.laneRevision === predecessor.laneRevision
    && claim.laneRevision === lane.headSha
    && claim.writeSetDigest === predecessor.writeSetDigest
    && claim.writeSetDigest === lane.manifest.writeSetDigest
    && sameWriteSet(claim.declaredWriteScope, predecessor.declaredWriteScope)
    && claim.leaseEpoch === predecessor.leaseEpoch + 1
    && ["active", "waiting-successor"].includes(state)
    && !claim.reviewRequestId
    && !claim.integrationReceiptDigest
    && !claim.integration
  );
}
function predecessorResult(status, claim = null, candidate = null, matchingClaimIds = []) {
  return Object.freeze({
    status,
    claim,
    candidate,
    matchingClaimIds: Object.freeze(matchingClaimIds),
  });
}
function integratedReplayResult(values = {}) {
  return Object.freeze({
    applicable: values.applicable || false,
    claim: values.claim || null,
    queuedClaim: values.queuedClaim || null,
    queuedClaimVariant: values.queuedClaimVariant || null,
    associationFrameDigest: values.associationFrameDigest || null,
    ambiguousClaimIds: Object.freeze(values.ambiguousClaimIds || []),
    driftedClaimIds: Object.freeze(values.driftedClaimIds || []),
  });
}
function completeStatus(status) {
  return status?.schema === RESULT_SCHEMA
    && status.ok === true
    && status.action === "status"
    && status.status === "ready"
    && REPOSITORY_ID_PATTERN.test(String(status.repositoryId || ""))
    && Array.isArray(status.claims);
}
function resumableSuccessorState(value) {
  const state = String(value || "").trim().replaceAll("_", "-");
  if (state === "waiting-successor") return "waiting_successor";
  if (["current", "active"].includes(state)) return "active";
  if (["reviewed", "review-ready"].includes(state)) return "review_ready";
  return null;
}
function sameWriteSet(left, right) {
  try { return JSON.stringify(normalizeWriteSet(left)) === JSON.stringify(normalizeWriteSet(right)); } catch { return false; }
}
function authenticatedActorId(actor) {
  const id = Number(actor?.id);
  return Number.isSafeInteger(id) && id > 0 ? `github-user:${id}` : null;
}
function finding(type, detail = {}) {
  return Object.freeze({ type, detail });
}
function compareFindings(left, right) {
  return digestValue(left).localeCompare(digestValue(right));
}
function requiredCanonicalWorkItemId(value) {
  const workItemId = requiredText(value, "observed predecessor workItemId");
  if (!WORK_ITEM_PATTERN.test(workItemId)) {
    throw new Error("Observed predecessor workItemId must be a canonical work-item SHA-256 identifier.");
  }
  return workItemId;
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a 40-character SHA.`);
  return sha;
}
function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}
function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return integer;
}
