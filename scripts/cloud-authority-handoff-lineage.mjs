import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { scopeExpansionLineageAdmissionMatches } from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import { normalizeBoundAuthority, projectRootState } from "./scoped-lane-cloud-reconciliation.mjs";
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

export function classifyPredecessor({ lane, actor, status, request = null, lineageAdmission = null }) {
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
    lineageAdmission,
  })) {
    return predecessorResult("mismatched", null, candidate);
  }
  return predecessorResult("ready", candidate, candidate, [candidate.claimId]);
}

export function classifyIntegratedReplay({ request, lane, actor, status, predecessor }) {
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
  const exactQueued = derivatives.filter(
    candidate => integratedReplayQueuedClaimMatches({ candidate, claim, lane }),
  );
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

export function validateContinuation({ request, lane, actor, status, predecessor, successor, integratedReplay }) {
  const findings = [];
  if (!parseDeviceBranch(lane.branch)) findings.push(finding("invalid-branch-identity"));
  if (!lane.clean) findings.push(finding("dirty-preserved-lane"));
  if (lane.lease.status !== "review_ready") findings.push(finding("lane-not-review-ready"));
  if (lane.pullRequest.state !== "OPEN" || lane.pullRequest.isDraft) {
    findings.push(finding("review-projection-not-ready"));
  }
  if (lane.pullRequest.baseRefName !== "main") findings.push(finding("pull-request-base-drift"));
  const expectedHead = requiredSha(lane.lease.reviewHeadSha, "lease reviewHeadSha");
  const exactHead = lane.headSha === expectedHead
    && lane.remoteHeadSha === expectedHead
    && lane.pullRequest.headRefOid === expectedHead
    && lane.authority.laneRevision === expectedHead;
  const refreshedHead = lane.headSha === expectedHead
    && lane.authority.laneRevision === expectedHead
    && lane.protectedMainRefresh
    && lane.refreshedHeadSha === lane.remoteHeadSha
    && lane.refreshedHeadSha === lane.pullRequest.headRefOid;
  if (!exactHead && !refreshedHead) findings.push(finding("exact-head-drift"));
  validateOwnerAndAuthority({ request, lane, actor, findings });
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
  return findings.sort(compareFindings);
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

function predecessorImmutableIdentityMatches({
  claim, lane, actor, repositoryId, status = null, request = null, lineageAdmission = null,
}) {
  const authority = lane.authority;
  const strictLineageValid = claim?.leaseEpoch === 1
    ? claim.predecessorClaimId === null || claim.predecessorClaimId === undefined
    : DIGEST_PATTERN.test(String(claim?.predecessorClaimId || ""));
  const predecessorLineageValid = strictLineageValid || scopeExpansionLineageAdmissionMatches({
    admission: lineageAdmission, claim, lane, status, repositoryId, request,
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
    );
  } catch {
    return false;
  }
}

function integratedReplayQueuedClaimMatches({ candidate, claim, lane }) {
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

function validateOwnerAndAuthority({ request, lane, actor, findings }) {
  if (!lane.remoteLease) findings.push(finding("missing-authoritative-owner-marker"));
  if (lane.remoteLease && (
    lane.remoteLease.branch !== lane.lease.branch
    || lane.remoteLease.baseSha !== lane.lease.baseSha
    || lane.remoteLease.scope !== lane.lease.scope
    || lane.remoteLease.reviewHeadSha !== lane.lease.reviewHeadSha
    || lane.remoteLease.cloudAuthority?.claimId !== lane.authority.claimId
  )) findings.push(finding("owner-marker-drift"));
  if (lane.authority.state !== "review_ready") findings.push(finding("legacy-authority-not-review-ready"));
  if (Date.parse(lane.authority.expiresAt) > Date.now()) findings.push(finding("legacy-authority-still-live"));
  if (lane.pullRequest.authorLogin !== actor.login) findings.push(finding("authenticated-owner-mismatch"));
  if (
    request.transition === "handoff"
    && request.successorSessionId === lane.lease.sessionId
    && request.successorDeviceId === lane.lease.device
  ) findings.push(finding("handoff-recipient-not-distinct"));
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
