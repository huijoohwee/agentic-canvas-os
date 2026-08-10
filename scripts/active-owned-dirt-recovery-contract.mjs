// Responsibility: Bind public claim provenance, authorization, replay receipts, and local recovery projections.
import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";

export const ACTIVE_OWNED_DIRT_RECOVERY_PLAN_SCHEMA =
  "agentic-active-owned-dirt-recovery-plan/v1";
export const ACTIVE_OWNED_DIRT_RECOVERY_LEASE_SCHEMA =
  "agentic-active-owned-dirt-recovery-lease/v1";
export const ACTIVE_OWNED_DIRT_RECOVERY_RECEIPT_SCHEMA =
  "agentic-active-owned-dirt-recovery-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40,64}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds }) {
  const normalized = normalizeSource(source);
  const ttl = boundedTtl(ttlSeconds);
  const core = {
    schema: ACTIVE_OWNED_DIRT_RECOVERY_PLAN_SCHEMA,
    sourceSessionId: normalized.lease.sessionId,
    sourceDevice: normalized.lease.device,
    sourceScope: normalized.lease.scope,
    sourceBranch: normalized.branch,
    sourceEpoch: normalized.lease.epoch,
    sourceLeaseDigest: normalized.leaseDigest,
    sourceBaseSha: normalized.lease.baseSha,
    sourceFenceSha: normalized.lease.fenceSha,
    sourcePullRequestUrl: normalized.lease.pullRequestUrl,
    sourcePullRequestId: normalized.pullRequest.id,
    sourcePullRequestRepository: normalized.pullRequest.headRepository.nameWithOwner,
    sourcePullRequestBodyDigest: normalized.pullRequestBodyDigest,
    sourceMarkerDigest: normalized.markerDigest,
    sourceWorktreeIdentityDigest: normalized.worktreeIdentityDigest,
    sourceEntrySchema: normalized.claim.entrySchema,
    sourceClaimIdentitySchema: normalized.claim.claimIdentitySchema,
    sourceActorId: normalized.claim.actorId,
    sourceRepositoryId: normalized.claim.repositoryId,
    sourceWorkItemId: normalized.claim.workItemId,
    sourcePredecessorClaimId: normalized.claim.predecessorClaimId ?? null,
    sourceCloudDeviceId: cloudOwnerIdentifier("device", normalized.lease.device),
    sourceCloudSessionId: cloudOwnerIdentifier("session", normalized.lease.sessionId),
    sourceClaimId: normalized.claim.claimId,
    sourceClaimDigest: normalized.claim.fenceRevision,
    sourceClaimLedgerRevision: normalized.claim.transitionDigest,
    sourceCloudTransitionCounter: normalized.claim.transitionCounter,
    sourceCloudLeaseEpoch: normalized.claim.leaseEpoch,
    sourceOperationReceiptDigest: normalized.claim.operationReceiptDigest,
    sourceLedgerRevision: normalized.ledgerRevision,
    sourceLedgerDigest: normalized.ledgerDigest,
    sourceReviewRequestId: normalized.claim.reviewRequestId,
    sourceManifestDigest: normalized.lease.admission.manifestDigest,
    sourceWriteSetDigest: normalized.lease.admission.writeSetDigest,
    sourceDeclaredWriteSet: normalized.declaredWriteSet,
    sourceProtectedMainAdvance: normalized.protectedMainAdvance,
    evidenceDigest: normalized.evidence.evidenceDigest,
    dirtyPathCount: normalized.evidence.pathCount,
    snapshotTimestamp: normalized.lease.heartbeatAt,
    ttlSeconds: ttl,
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeActiveOwnedDirtRecoveryPlan(value) {
  if (!value || value.schema !== ACTIVE_OWNED_DIRT_RECOVERY_PLAN_SCHEMA) {
    throw new Error("Active-owned-dirt recovery plan is malformed.");
  }
  const writeSet = normalizeWriteSet(value.sourceDeclaredWriteSet);
  const core = {
    schema: ACTIVE_OWNED_DIRT_RECOVERY_PLAN_SCHEMA,
    sourceSessionId: requiredText(value.sourceSessionId, "source session ID"),
    sourceDevice: requiredText(value.sourceDevice, "source device"),
    sourceScope: requiredText(value.sourceScope, "source scope"),
    sourceBranch: requiredText(value.sourceBranch, "source branch"),
    sourceEpoch: positiveInteger(value.sourceEpoch, "source epoch"),
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "source lease digest"),
    sourceBaseSha: requiredSha(value.sourceBaseSha, "source base SHA"),
    sourceFenceSha: requiredSha(value.sourceFenceSha, "source fence SHA"),
    sourcePullRequestUrl: requiredText(value.sourcePullRequestUrl, "source pull-request URL"),
    sourcePullRequestId: requiredText(value.sourcePullRequestId, "source pull-request ID"),
    sourcePullRequestRepository: requiredText(
      value.sourcePullRequestRepository,
      "source pull-request repository",
    ),
    sourcePullRequestBodyDigest: requiredDigest(value.sourcePullRequestBodyDigest, "source pull-request body digest"),
    sourceMarkerDigest: requiredDigest(value.sourceMarkerDigest, "source marker digest"),
    sourceWorktreeIdentityDigest: requiredDigest(value.sourceWorktreeIdentityDigest, "source worktree identity digest"),
    sourceEntrySchema: requiredV2Schema(value.sourceEntrySchema, "source entry schema"),
    sourceClaimIdentitySchema: requiredV2Schema(value.sourceClaimIdentitySchema, "source claim identity schema"),
    sourceActorId: requiredText(value.sourceActorId, "source actor ID"),
    sourceRepositoryId: requiredText(value.sourceRepositoryId, "source repository ID"),
    sourceWorkItemId: requiredWorkItemId(value.sourceWorkItemId),
    sourcePredecessorClaimId: optionalDigest(value.sourcePredecessorClaimId, "source predecessor claim ID"),
    sourceCloudDeviceId: requiredOpaqueOwner(value.sourceCloudDeviceId, "device"),
    sourceCloudSessionId: requiredOpaqueOwner(value.sourceCloudSessionId, "session"),
    sourceClaimId: requiredDigest(value.sourceClaimId, "source claim ID"),
    sourceClaimDigest: requiredDigest(value.sourceClaimDigest, "source claim digest"),
    sourceClaimLedgerRevision: requiredDigest(value.sourceClaimLedgerRevision, "source claim ledger revision"),
    sourceCloudTransitionCounter: positiveInteger(value.sourceCloudTransitionCounter, "source transition counter"),
    sourceCloudLeaseEpoch: positiveInteger(value.sourceCloudLeaseEpoch, "source cloud lease epoch"),
    sourceOperationReceiptDigest: requiredDigest(value.sourceOperationReceiptDigest, "source operation receipt digest"),
    sourceLedgerRevision: requiredSha(value.sourceLedgerRevision, "source ledger revision"),
    sourceLedgerDigest: requiredDigest(value.sourceLedgerDigest, "source ledger digest"),
    sourceReviewRequestId: optionalText(value.sourceReviewRequestId, "source review request ID"),
    sourceManifestDigest: requiredDigest(value.sourceManifestDigest, "source manifest digest"),
    sourceWriteSetDigest: requiredDigest(value.sourceWriteSetDigest, "source write-set digest"),
    sourceDeclaredWriteSet: writeSet,
    sourceProtectedMainAdvance: normalizeProtectedMainAdvance(value.sourceProtectedMainAdvance),
    evidenceDigest: requiredDigest(value.evidenceDigest, "evidence digest"),
    dirtyPathCount: positiveInteger(value.dirtyPathCount, "dirty path count"),
    snapshotTimestamp: requiredInstant(value.snapshotTimestamp, "snapshot timestamp"),
    ttlSeconds: boundedTtl(value.ttlSeconds),
  };
  if (core.sourceWriteSetDigest !== digestValue(writeSet)
    || core.sourceClaimId !== digestValue({ actorId: core.sourceActorId,
      canonicalBaseRevision: core.sourceBaseSha, leaseEpoch: core.sourceCloudLeaseEpoch,
      repositoryId: core.sourceRepositoryId, workItemId: core.sourceWorkItemId,
      writeSetDigest: core.sourceWriteSetDigest })
    || core.sourceCloudDeviceId !== cloudOwnerIdentifier("device", core.sourceDevice)
    || core.sourceCloudSessionId !== cloudOwnerIdentifier("session", core.sourceSessionId)
    || core.sourceProtectedMainAdvance.baseSha !== core.sourceBaseSha
    || core.sourceProtectedMainAdvance.declaredWriteSetDigest !== core.sourceWriteSetDigest
    || value.planDigest !== digestValue(core)) {
    throw new Error("Active-owned-dirt plan digest, write set, or cloud epoch is invalid.");
  }
  return Object.freeze({ ...core, planDigest: value.planDigest });
}

export function authorizeActiveOwnedDirtRecovery({ plan, authorization }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const expected = `authorize active-owned-dirt-reclaim ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Active-owned-dirt recovery requires exact authorization: ${expected}`);
  }
  return Object.freeze({
    schema: "agentic-active-owned-dirt-recovery-authorization/v1",
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue({ planDigest: normalized.planDigest, authorization: expected }),
  });
}

export function selectActiveOwnedDirtRecoveryPlan({ state, ttlSeconds }) {
  const intent = state?.intent ?? null;
  if (!intent) {
    return Object.freeze({
      plan: buildActiveOwnedDirtRecoveryPlan({ source: state?.source, ttlSeconds }),
      resumeIntent: false,
    });
  }
  if (intent.status !== "complete") {
    return Object.freeze({
      plan: normalizeActiveOwnedDirtRecoveryPlan(intent.planSnapshot),
      resumeIntent: true,
    });
  }
  const completed = validateCompletedActiveOwnedDirtRecoveryIntent(intent);
  const expired = Number.isFinite(Date.parse(state?.source?.lease?.expiresAt))
    && Number.isFinite(Date.parse(state?.source?.evaluatedAt))
    && Date.parse(state.source.lease.expiresAt) <= Date.parse(state.source.evaluatedAt);
  if (state?.source?.claim?.state === "dormant-preserved" && expired) {
    const plan = buildActiveOwnedDirtRecoveryPlan({ source: state.source, ttlSeconds });
    return Object.freeze({
      plan,
      resumeIntent: plan.planDigest === completed.planDigest,
    });
  }
  return Object.freeze({ plan: completed.planSnapshot, resumeIntent: true });
}

export function verifyActiveOwnedDirtCloudRecovery({ plan, result, recoveryEvidenceDigest }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const claim = result?.claim;
  const operation = result?.operationReceipt;
  const { receiptDigest: operationReceiptDigest, ...operationCore } = operation || {};
  const evidenceDigest = requiredDigest(recoveryEvidenceDigest, "cloud recovery evidence digest");
  const expectedRequestDigest = recoveryRequestDigest({
    plan: normalized, recoveryEvidenceDigest: evidenceDigest,
    evaluationTime: operation?.evaluationTime,
  });
  const expectedIdempotencyKey = digestValue(`active-owned-dirt-recovery:${normalized.planDigest}`);
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "continue"
    || result.status !== "current" || typeof result.replayed !== "boolean"
    || claim?.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.actorId !== normalized.sourceActorId
    || claim.repositoryId !== normalized.sourceRepositoryId
    || claim.workItemId !== normalized.sourceWorkItemId
    || (claim.predecessorClaimId ?? null) !== normalized.sourcePredecessorClaimId
    || claim?.claimId !== normalized.sourceClaimId
    || claim.state !== "current" || claim.writeAuthority !== true
    || claim.scopeReserved !== true
    || claim.canonicalBaseRevision !== normalized.sourceBaseSha
    || claim.laneRevision !== normalized.sourceFenceSha
    || claim.writeSetDigest !== normalized.sourceWriteSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(normalized.sourceDeclaredWriteSet)
    || claim.reviewRequestId !== normalized.sourceReviewRequestId
    || claim.leaseEpoch !== normalized.sourceCloudLeaseEpoch
    || claim.transitionCounter !== normalized.sourceCloudTransitionCounter + 1
    || claim.fenceRevision !== result.claimDigest
    || claim.transitionDigest !== operation?.ledgerRevision
    || claim.operationReceiptDigest !== operation?.receiptDigest
    || operation?.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue" || operation.status !== "current"
    || operation.repositoryId !== normalized.sourceRepositoryId
    || operation.claimId !== normalized.sourceClaimId
    || operation.claimDigest !== claim.fenceRevision
    || operation.fenceRevision !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest
    || operation.idempotencyKey !== expectedIdempotencyKey
    || operation.requestDigest !== expectedRequestDigest
    || !Number.isSafeInteger(operation.ledgerSequence) || operation.ledgerSequence < 1
    || operationReceiptDigest !== digestValue(operationCore)
    || result.receipt?.schema !== "agentic-cloud-collaboration-github-receipt/v1"
    || result.receipt.action !== "continue"
    || result.receipt?.contractReceiptDigest !== operation.receiptDigest
    || result.receipt?.claimId !== claim.claimId
    || result.receipt?.claimDigest !== claim.fenceRevision
    || result.receipt?.ledgerRevision !== result.ledgerRevision
    || !Number.isSafeInteger(result.receipt.sequence)
    || result.receipt.sequence < operation.ledgerSequence
    || result.receipt.evaluationTime === undefined
    || result.receipt.receiptDigest !== digestValue((({ receiptDigest: _digest, ...core }) => core)(result.receipt))) {
    throw new Error("Cloud recovery changed the admitted claim identity.");
  }
  const recoveredAt = requiredInstant(operation.evaluationTime, "cloud recovery evaluation time");
  const expiresAt = requiredInstant(claim.expiresAt, "recovered claim expiry");
  if (Date.parse(expiresAt) !== Date.parse(recoveredAt) + normalized.ttlSeconds * 1_000) {
    throw new Error("Cloud recovery expiry changed from the exact request.");
  }
  return Object.freeze({
    claimId: normalized.sourceClaimId,
    claimDigest: requiredDigest(result.claimDigest || claim.fenceRevision, "recovered claim digest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "recovered ledger revision"),
    ledgerDigest: requiredDigest(result.receipt?.ledgerDigest, "recovered ledger digest"),
    claimLedgerRevision: requiredDigest(claim.transitionDigest, "recovered claim ledger revision"),
    transitionCounter: claim.transitionCounter,
    expiresAt,
    recoveredAt,
    operationReceiptDigest: requiredDigest(claim.operationReceiptDigest, "recovered operation receipt digest"),
    cloudReceiptDigest: requiredDigest(result.receipt?.receiptDigest, "cloud recovery receipt digest"),
  });
}

export function createActiveOwnedDirtCloudRecoveryRequest({ plan, recoveryEvidenceDigest }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  return Object.freeze({ claimId: normalized.sourceClaimId,
    expectedFenceRevision: normalized.sourceClaimDigest,
    expectedLedgerRevision: normalized.sourceLedgerRevision,
    expectedLedgerDigest: normalized.sourceLedgerDigest,
    expectedTransitionCounter: normalized.sourceCloudTransitionCounter,
    mode: "recovery", ttlSeconds: normalized.ttlSeconds,
    recoveryEvidenceDigest: requiredDigest(recoveryEvidenceDigest, "cloud recovery evidence digest"),
    deviceId: normalized.sourceDevice, sessionId: normalized.sourceSessionId,
    idempotencyKey: `active-owned-dirt-recovery:${normalized.planDigest}` });
}

export function createActiveOwnedDirtLeaseRecovery({
  plan,
  snapshot,
  cloud,
  recoveredAt,
}) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const value = {
    schema: ACTIVE_OWNED_DIRT_RECOVERY_LEASE_SCHEMA,
    status: "recovered",
    sourceEpoch: normalized.sourceEpoch,
    sourceSessionId: normalized.sourceSessionId,
    sourceDevice: normalized.sourceDevice,
    sourceBranch: normalized.sourceBranch,
    sourceFenceSha: normalized.sourceFenceSha,
    sourceClaimId: normalized.sourceClaimId,
    planDigest: normalized.planDigest,
    evidenceDigest: normalized.evidenceDigest,
    snapshotReceiptDigest: requiredDigest(snapshot?.snapshotReceiptDigest, "snapshot receipt digest"),
    snapshotRef: requiredText(snapshot?.snapshotRef, "snapshot ref"),
    snapshotCommitSha: requiredObjectId(snapshot?.commitSha, "snapshot commit"),
    snapshotIndexCommitSha: requiredObjectId(snapshot?.indexCommitSha, "snapshot index commit"),
    recoveredClaimDigest: requiredDigest(cloud?.claimDigest, "recovered claim digest"),
    recoveredLedgerRevision: requiredSha(cloud?.ledgerRevision, "recovered ledger revision"),
    recoveredClaimLedgerRevision: requiredDigest(cloud?.claimLedgerRevision, "recovered claim ledger revision"),
    recoveredTransitionCounter: positiveInteger(cloud?.transitionCounter, "recovered transition counter"),
    recoveredAt: requiredInstant(recoveredAt, "recovered at"),
  };
  return normalizeActiveOwnedDirtLeaseRecovery(value);
}

export function normalizeActiveOwnedDirtLeaseRecovery(value) {
  if (value === null || value === undefined) return null;
  const normalized = {
    schema: value?.schema,
    status: value?.status,
    sourceEpoch: positiveInteger(value?.sourceEpoch, "recovery source epoch"),
    sourceSessionId: requiredText(value?.sourceSessionId, "recovery source session"),
    sourceDevice: requiredText(value?.sourceDevice, "recovery source device"),
    sourceBranch: requiredText(value?.sourceBranch, "recovery source branch"),
    sourceFenceSha: requiredSha(value?.sourceFenceSha, "recovery source fence"),
    sourceClaimId: requiredDigest(value?.sourceClaimId, "recovery source claim ID"),
    planDigest: requiredDigest(value?.planDigest, "recovery plan digest"),
    evidenceDigest: requiredDigest(value?.evidenceDigest, "recovery evidence digest"),
    snapshotReceiptDigest: requiredDigest(value?.snapshotReceiptDigest, "snapshot receipt digest"),
    snapshotRef: requiredText(value?.snapshotRef, "snapshot ref"),
    snapshotCommitSha: requiredObjectId(value?.snapshotCommitSha, "snapshot commit"),
    snapshotIndexCommitSha: requiredObjectId(value?.snapshotIndexCommitSha, "snapshot index commit"),
    recoveredClaimDigest: requiredDigest(value?.recoveredClaimDigest, "recovered claim digest"),
    recoveredLedgerRevision: requiredSha(value?.recoveredLedgerRevision, "recovered ledger revision"),
    recoveredClaimLedgerRevision: requiredDigest(value?.recoveredClaimLedgerRevision, "recovered claim ledger revision"),
    recoveredTransitionCounter: positiveInteger(value?.recoveredTransitionCounter, "recovered transition counter"),
    recoveredAt: requiredInstant(value?.recoveredAt, "recovered at"),
  };
  if (normalized.schema !== ACTIVE_OWNED_DIRT_RECOVERY_LEASE_SCHEMA
    || normalized.status !== "recovered"
    || normalized.recoveredTransitionCounter < 2
    || normalized.snapshotRef !== `refs/agentic-canvas-os/recovery/active-owned-dirt/${normalized.sourceClaimId}/${normalized.planDigest}`) {
    throw new Error("Active-owned-dirt lease recovery is malformed.");
  }
  return Object.freeze(normalized);
}

export function buildActiveOwnedDirtRecoveryReceipt({ phase, plan, values = {} }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const core = {
    schema: ACTIVE_OWNED_DIRT_RECOVERY_RECEIPT_SCHEMA,
    phase: requiredText(phase, "recovery phase"),
    planDigest: normalized.planDigest,
    sourceClaimId: normalized.sourceClaimId,
    evidenceDigest: normalized.evidenceDigest,
    ...values,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function validateCompletedActiveOwnedDirtRecoveryIntent(value) {
  const plan = normalizeActiveOwnedDirtRecoveryPlan(value?.planSnapshot);
  const snapshot = value?.snapshot;
  const cloud = value?.cloud;
  const local = value?.localProjection;
  const pullRequest = value?.pullRequestProjection;
  const expectedFinal = buildActiveOwnedDirtRecoveryReceipt({
    phase: "complete",
    plan,
    values: {
      snapshotReceiptDigest: requiredDigest(snapshot?.snapshotReceiptDigest, "snapshot receipt digest"),
      recoveredLeaseDigest: requiredDigest(local?.leaseDigest, "recovered lease digest"),
      markerDigest: requiredDigest(pullRequest?.markerDigest, "marker digest"),
      mutationAuthorityReceiptDigest: requiredDigest(
        local?.mutationAuthorityReceiptDigest,
        "mutation-authority receipt digest",
      ),
    },
  });
  if (value?.schema !== "agentic-active-owned-dirt-recovery-intent/v1"
    || value.status !== "complete" || value.branch !== plan.sourceBranch
    || value.sourceLeaseDigest !== plan.sourceLeaseDigest
    || value.sourceClaimId !== plan.sourceClaimId || value.planDigest !== plan.planDigest
    || snapshot?.snapshotRef !== `refs/agentic-canvas-os/recovery/active-owned-dirt/${plan.sourceClaimId}/${plan.planDigest}`
    || !OBJECT_ID_PATTERN.test(String(snapshot?.commitSha || ""))
    || !OBJECT_ID_PATTERN.test(String(snapshot?.indexCommitSha || ""))
    || cloud?.claimId !== plan.sourceClaimId
    || cloud?.transitionCounter !== plan.sourceCloudTransitionCounter + 1
    || cloud?.authority?.claimId !== plan.sourceClaimId
    || cloud?.authority?.claimDigest !== cloud?.claimDigest
    || cloud?.authority?.leaseEpoch !== plan.sourceCloudLeaseEpoch
    || cloud?.authority?.transitionCounter !== cloud?.transitionCounter
    || cloud?.authority?.operationReceiptDigest !== cloud?.operationReceiptDigest
    || local?.claimId !== plan.sourceClaimId || local?.claimDigest !== cloud?.claimDigest
    || expectedFinal.receiptDigest !== value.finalReceiptDigest) {
    throw new Error("Completed active-owned-dirt recovery intent is malformed.");
  }
  return Object.freeze(value);
}

function normalizeSource(source) {
  const lease = source?.lease;
  const claim = source?.claim;
  const evidence = assertActiveOwnedDirtWithinWriteSet({
    evidence: source?.evidence,
    declaredWriteSet: lease?.admission?.declaredWriteSet,
  });
  const declaredWriteSet = normalizeWriteSet(lease?.admission?.declaredWriteSet);
  const protectedMainAdvance = normalizeProtectedMainAdvance(source?.protectedMainAdvance);
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.sessionId !== source?.sessionId || lease.branch !== source?.branch
    || lease.fenceSha !== source?.headSha || lease.fenceSha !== source?.remoteHeadSha
    || protectedMainAdvance.baseSha !== lease.baseSha
    || protectedMainAdvance.protectedMainSha !== source?.remoteMainSha
    || protectedMainAdvance.pullRequestBaseSha !== source?.pullRequest?.baseRefOid
    || protectedMainAdvance.declaredWriteSetDigest !== lease?.admission?.writeSetDigest
    || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "admitted"
    || lease.admission.writeSetDigest !== digestValue(declaredWriteSet)
    || lease.cloudAuthority?.claimId !== claim?.claimId
    || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || lease.cloudAuthority.state !== "active"
    || lease.cloudAuthority?.sessionId !== lease.sessionId
    || lease.cloudAuthority?.deviceId !== lease.device
    || claim?.state !== "dormant-preserved"
    || claim.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.fenceRevision !== lease.cloudAuthority?.claimDigest
    || claim.transitionDigest !== lease.cloudAuthority?.claimLedgerRevision
    || claim.transitionCounter !== lease.cloudAuthority?.transitionCounter
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lease.fenceSha
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope)) !== JSON.stringify(declaredWriteSet)
    || claim.reviewRequestId !== lease.cloudAuthority?.reviewRequestId
    || !Number.isInteger(claim.leaseEpoch) || claim.leaseEpoch < 1
    || claim.leaseEpoch !== lease.cloudAuthority?.leaseEpoch
    || claim.operationReceiptDigest !== lease.cloudAuthority?.operationReceiptDigest
    || lease.cloudAuthority?.entrySchema !== claim.entrySchema
    || lease.cloudAuthority?.claimIdentitySchema !== claim.claimIdentitySchema
    || claim.claimId !== digestValue({ actorId: claim.actorId,
      canonicalBaseRevision: claim.canonicalBaseRevision, leaseEpoch: claim.leaseEpoch,
      repositoryId: claim.repositoryId, workItemId: claim.workItemId,
      writeSetDigest: claim.writeSetDigest })
    || evidence.headSha !== lease.fenceSha
    || !Number.isFinite(Date.parse(lease.expiresAt))
    || !Number.isFinite(Date.parse(source?.evaluatedAt))
    || Date.parse(lease.expiresAt) > Date.parse(source.evaluatedAt)
    || source?.pullRequest?.state !== "OPEN" || source.pullRequest.isDraft !== true
    || source.pullRequest.id === undefined
    || source.pullRequest.url !== lease.pullRequestUrl
    || source.pullRequest.autoMergeRequest !== null
    || source.pullRequest.headRepository?.nameWithOwner
      !== lease.cloudAuthority?.targetRepository
    || source.pullRequest.headRefName !== lease.branch
    || source.pullRequest.headRefOid !== lease.fenceSha
    || source.pullRequest.baseRefName !== "main"
    || source.markerDigest !== digestValue(source.expectedMarker)
    || source.overlappingClaims?.some(candidate => writeSetsOverlap(
      candidate.declaredWriteScope, declaredWriteSet,
    ))) {
    throw new Error("Recovery requires one exact expired, admitted, draft, dormant-owned lane.");
  }
  return {
    ...source,
    lease,
    claim,
    evidence: normalizeActiveOwnedDirtEvidence(evidence),
    declaredWriteSet,
    protectedMainAdvance,
    ledgerRevision: requiredSha(source.ledgerRevision, "ledger revision"),
    ledgerDigest: requiredDigest(source.ledgerDigest, "ledger digest"),
    leaseDigest: requiredDigest(source.leaseDigest, "lease digest"),
    pullRequestBodyDigest: requiredDigest(source.pullRequestBodyDigest, "pull-request body digest"),
    markerDigest: requiredDigest(source.markerDigest, "marker digest"),
    worktreeIdentityDigest: requiredDigest(source.worktreeIdentityDigest, "worktree identity digest"),
    pullRequest: source.pullRequest,
  };
}

function recoveryRequestDigest({ plan, recoveryEvidenceDigest, evaluationTime }) {
  const recoveredAt = requiredInstant(evaluationTime, "cloud operation evaluation time");
  const intent = { repositoryId: plan.sourceRepositoryId, actorId: plan.sourceActorId,
    deviceId: plan.sourceCloudDeviceId, sessionId: plan.sourceCloudSessionId,
    claimId: plan.sourceClaimId, expectedFenceRevision: plan.sourceClaimDigest,
    expectedTransitionCounter: plan.sourceCloudTransitionCounter, mode: "recovery",
    laneRevision: null, reviewRequestId: null,
    expiresAt: new Date(Date.parse(recoveredAt) + plan.ttlSeconds * 1_000).toISOString(),
    focusedEvidenceDigest: null, handoffEvidenceDigest: null, recoveryEvidenceDigest };
  return digestValue({ action: "continue", intent });
}

function normalizeProtectedMainAdvance(value) {
  const normalized = { schema: value?.schema,
    baseSha: requiredSha(value?.baseSha, "protected-main advance base"),
    pullRequestBaseSha: requiredSha(value?.pullRequestBaseSha, "pull-request base"),
    protectedMainSha: requiredSha(value?.protectedMainSha, "protected-main SHA"),
    protectedMainTreeSha: requiredObjectId(value?.protectedMainTreeSha, "protected-main tree"),
    declaredWriteSetDigest: requiredDigest(
      value?.declaredWriteSetDigest,
      "protected-main declared write-set digest",
    ),
    changedPathCount: nonnegativeInteger(value?.changedPathCount, "changed path count"),
    changedPathsDigest: requiredDigest(value?.changedPathsDigest, "changed paths digest") };
  if (normalized.schema !== "agentic-active-owned-dirt-protected-main-advance/v1"
    || normalized.changedPathCount > 100_000) {
    throw new Error("Protected-main disjoint descendant evidence is malformed.");
  }
  return Object.freeze(normalized);
}

function boundedTtl(value) {
  const ttl = Number(value);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) {
    throw new Error("Recovery TTL must be an integer from 60 through 86400 seconds.");
  }
  return ttl;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function requiredObjectId(value, label) {
  const candidate = String(value || "");
  if (!OBJECT_ID_PATTERN.test(candidate)) throw new Error(`${label} must be a Git object ID.`);
  return candidate;
}

function requiredSha(value, label) {
  const candidate = String(value || "");
  if (!SHA_PATTERN.test(candidate)) throw new Error(`${label} must be a SHA.`);
  return candidate;
}

function requiredDigest(value, label) {
  const candidate = String(value || "");
  if (!DIGEST_PATTERN.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`);
  return candidate;
}

function requiredInstant(value, label) {
  const candidate = String(value || "");
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} must be an ISO timestamp.`);
  return candidate;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalText(value, label) {
  if (value === null || value === undefined) return null;
  return requiredText(value, label);
}

function optionalDigest(value, label) {
  if (value === null || value === undefined) return null;
  return requiredDigest(value, label);
}

function requiredWorkItemId(value) {
  const candidate = requiredText(value, "source work-item ID");
  if (!/^work-item:[0-9a-f]{64}$/u.test(candidate)) {
    throw new Error("Source work-item ID must be opaque.");
  }
  return candidate;
}

function requiredV2Schema(value, label) {
  const schema = requiredText(value, label);
  if (schema !== "agentic-cloud-collaboration-entry/v2") throw new Error(`${label} must be v2.`);
  return schema;
}

function cloudOwnerIdentifier(namespace, value) {
  return `${namespace}:${digestValue({ namespace, value: requiredText(value, `${namespace} source`) })}`;
}

function requiredOpaqueOwner(value, namespace) {
  const candidate = requiredText(value, `${namespace} cloud owner`);
  if (!new RegExp(`^${namespace}:[0-9a-f]{64}$`, "u").test(candidate)) {
    throw new Error(`${namespace} cloud owner must be opaque.`);
  }
  return candidate;
}
