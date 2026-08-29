import {
  buildScopeExpansionLineageMigrationPlan,
  verifyScopeExpansionLineageMigrationPlan,
} from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";

export const SCOPE_EXPANSION_LINEAGE_PROJECTION_PROOF_SCHEMA =
  "agentic-cloud-authority-scope-expansion-lineage-projection-proof/v1";

const VERIFIED_PROOFS = new WeakSet();

export function createScopeExpansionLineageProjectionProof({
  lane,
  actor,
  status,
  ledger,
  request,
  plan = null,
  now = new Date(),
}) {
  const validationLane = readyProjectionView(lane);
  const lineagePlan = plan
    ? verifyScopeExpansionLineageMigrationPlan({
      plan,
      lane: validationLane,
      actor,
      status,
      ledger,
    }).plan
    : buildScopeExpansionLineageMigrationPlan({
      lane: validationLane,
      actor,
      status,
      ledger,
    });
  const claim = uniqueClaim(status, lineagePlan.legacyClaimId);
  assertTerminalProjection({ lane, claim, lineagePlan, request, now });
  const lineageIdentity = stableLineageIdentity(lineagePlan);
  const core = Object.freeze({
    schema: SCOPE_EXPANSION_LINEAGE_PROJECTION_PROOF_SCHEMA,
    plan: lineagePlan,
    planDigest: lineagePlan.planDigest,
    lineageIdentity,
    lineageIdentityDigest: digestValue(lineageIdentity),
    sourceClaimId: lineagePlan.sourceClaimId,
    targetGenesisEntryDigest: lineagePlan.targetGenesisEntryDigest,
    sourceRetirementEntryDigest: lineagePlan.sourceRetirementEntryDigest,
    currentClaimDigest: digestValue(claim),
    currentClaimFenceRevision: claim.fenceRevision,
    currentClaimTransitionDigest: claim.transitionDigest,
    currentClaimTransitionCounter: claim.transitionCounter,
    currentLedgerRevision: status.ledgerRevision,
    currentLedgerDigest: status.ledgerDigest,
    localAuthorityDigest: digestValue(lane.authority),
    localLeaseDigest: digestValue(lane.lease),
    laneIdentityDigest: projectionInvariantLaneDigest(lane),
    requestDigest: digestValue(request),
  });
  const proof = Object.freeze({ ...core, proofDigest: digestValue(core) });
  VERIFIED_PROOFS.add(proof);
  return proof;
}

export function scopeExpansionLineageProjectionProofMatches({
  proof,
  claim,
  lane,
  status,
  repositoryId,
  request,
}) {
  try {
    if (!VERIFIED_PROOFS.has(proof)
      || proof?.schema !== SCOPE_EXPANSION_LINEAGE_PROJECTION_PROOF_SCHEMA
      || proof.proofDigest !== digestValue(proofCore(proof))) return false;
    const plan = proof.plan;
    return Boolean(
      claim?.claimId === plan.legacyClaimId
      && claim.predecessorClaimId === plan.sourceClaimId
      && claim.leaseEpoch === 1
      && claim.actorId === plan.actorId
      && claim.repositoryId === plan.repositoryId
      && repositoryId === plan.repositoryId
      && claim.workItemId === plan.workItemId
      && claim.canonicalBaseRevision === plan.canonicalBaseSha
      && claim.laneRevision === plan.reviewedHeadSha
      && claim.writeSetDigest === plan.writeSetDigest
      && sameWriteSet(claim.declaredWriteScope, plan.declaredWriteSet)
      && claim.reviewRequestId === plan.reviewRequestId
      && claim.fenceRevision === proof.currentClaimFenceRevision
      && claim.transitionDigest === proof.currentClaimTransitionDigest
      && claim.transitionCounter === proof.currentClaimTransitionCounter
      && digestValue(claim) === proof.currentClaimDigest
      && status?.ledgerRevision === proof.currentLedgerRevision
      && status?.ledgerDigest === proof.currentLedgerDigest
      && digestValue(lane.authority) === proof.localAuthorityDigest
      && digestValue(lane.lease) === proof.localLeaseDigest
      && projectionInvariantLaneDigest(lane) === proof.laneIdentityDigest
      && digestValue(request) === proof.requestDigest
      && terminalProjectionIdentityMatches({ lane, claim, plan, request })
    );
  } catch {
    return false;
  }
}

function assertTerminalProjection({ lane, claim, lineagePlan, request, now }) {
  if (!terminalProjectionIdentityMatches({ lane, claim, plan: lineagePlan, request })) {
    throw new Error("Scope-expansion projection is not the exact terminal integrated identity.");
  }
  const observedAt = now instanceof Date ? now : new Date(now);
  const writerExpiry = Date.parse(lane?.lease?.expiresAt);
  if (!Number.isFinite(observedAt.getTime())
    || !Number.isFinite(writerExpiry)
    || writerExpiry > observedAt.getTime()) {
    throw new Error("Scope-expansion projection proof requires a stale local writer lease.");
  }
}

function terminalProjectionIdentityMatches({ lane, claim, plan, request }) {
  const authority = lane?.authority;
  const integration = claim?.integration;
  return Boolean(
    lane?.lease?.status === "review_ready"
    && authority?.state === "review_ready"
    && claim?.state === "integrated-preserved"
    && claim.writeAuthority === false
    && claim.scopeReserved === true
    && claim.claimId === authority.claimId
    && claim.claimId === plan.legacyClaimId
    && claim.predecessorClaimId === plan.sourceClaimId
    && claim.leaseEpoch === 1
    && authority.leaseEpoch === 1
    && claim.expiresAt === authority.expiresAt
    && claim.transitionCounter === authority.transitionCounter + 1
    && claim.operationReceiptDigest === claim.integrationReceiptDigest
    && claim.reviewRequestId === authority.reviewRequestId
    && claim.reviewRequestId === `github-pull-request:${lane.pullRequest?.id}`
    && integration?.candidateRevision === lane.headSha
    && integration.reviewRequestId === authority.reviewRequestId
    && integration.focusedEvidenceDigest === authority.focusedEvidenceDigest
    && request?.transition === "reclaim"
    && request.sessionId === lane.lease.sessionId
    && request.successorSessionId === lane.lease.sessionId
    && request.successorDeviceId === lane.lease.device
  );
}

function projectionInvariantLaneDigest(lane) {
  const pullRequest = { ...lane.pullRequest };
  delete pullRequest.isDraft;
  return digestValue({ ...lane, pullRequest });
}

function readyProjectionView(lane) {
  if (lane?.pullRequest?.state !== "OPEN"
    || typeof lane.pullRequest.isDraft !== "boolean") {
    throw new Error("Scope-expansion projection proof requires one open pull-request projection.");
  }
  return Object.freeze({
    ...lane,
    pullRequest: Object.freeze({
      ...lane.pullRequest,
      isDraft: false,
    }),
  });
}

function stableLineageIdentity(plan) {
  const {
    observedLedgerRevision: _observedLedgerRevision,
    observedLedgerDigest: _observedLedgerDigest,
    planDigest: _planDigest,
    ...identity
  } = plan;
  return Object.freeze(identity);
}

function proofCore(proof) {
  const { proofDigest: _proofDigest, ...core } = proof;
  return core;
}

function uniqueClaim(status, claimId) {
  const matches = Array.isArray(status?.claims)
    ? status.claims.filter(claim => claim?.claimId === claimId)
    : [];
  if (matches.length !== 1) {
    throw new Error("Scope-expansion projection proof requires one exact current claim.");
  }
  return matches[0];
}

function sameWriteSet(left, right) {
  return JSON.stringify(normalizeWriteSet(left)) === JSON.stringify(normalizeWriteSet(right));
}
