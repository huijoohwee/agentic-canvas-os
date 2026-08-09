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
    sourcePullRequestBodyDigest: normalized.pullRequestBodyDigest,
    sourceMarkerDigest: normalized.markerDigest,
    sourceWorktreeIdentityDigest: normalized.worktreeIdentityDigest,
    sourceClaimId: normalized.claim.claimId,
    sourceClaimDigest: normalized.claim.fenceRevision,
    sourceClaimLedgerRevision: normalized.claim.transitionDigest,
    sourceCloudTransitionCounter: normalized.claim.transitionCounter,
    sourceCloudLeaseEpoch: normalized.claim.leaseEpoch,
    sourceLedgerRevision: normalized.ledgerRevision,
    sourceLedgerDigest: normalized.ledgerDigest,
    sourceReviewRequestId: normalized.claim.reviewRequestId,
    sourceManifestDigest: normalized.lease.admission.manifestDigest,
    sourceWriteSetDigest: normalized.lease.admission.writeSetDigest,
    sourceDeclaredWriteSet: normalized.declaredWriteSet,
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
    sourcePullRequestBodyDigest: requiredDigest(value.sourcePullRequestBodyDigest, "source pull-request body digest"),
    sourceMarkerDigest: requiredDigest(value.sourceMarkerDigest, "source marker digest"),
    sourceWorktreeIdentityDigest: requiredDigest(value.sourceWorktreeIdentityDigest, "source worktree identity digest"),
    sourceClaimId: requiredDigest(value.sourceClaimId, "source claim ID"),
    sourceClaimDigest: requiredDigest(value.sourceClaimDigest, "source claim digest"),
    sourceClaimLedgerRevision: requiredDigest(value.sourceClaimLedgerRevision, "source claim ledger revision"),
    sourceCloudTransitionCounter: positiveInteger(value.sourceCloudTransitionCounter, "source transition counter"),
    sourceCloudLeaseEpoch: positiveInteger(value.sourceCloudLeaseEpoch, "source cloud lease epoch"),
    sourceLedgerRevision: requiredSha(value.sourceLedgerRevision, "source ledger revision"),
    sourceLedgerDigest: requiredDigest(value.sourceLedgerDigest, "source ledger digest"),
    sourceReviewRequestId: requiredText(value.sourceReviewRequestId, "source review request ID"),
    sourceManifestDigest: requiredDigest(value.sourceManifestDigest, "source manifest digest"),
    sourceWriteSetDigest: requiredDigest(value.sourceWriteSetDigest, "source write-set digest"),
    sourceDeclaredWriteSet: writeSet,
    evidenceDigest: requiredDigest(value.evidenceDigest, "evidence digest"),
    dirtyPathCount: positiveInteger(value.dirtyPathCount, "dirty path count"),
    snapshotTimestamp: requiredInstant(value.snapshotTimestamp, "snapshot timestamp"),
    ttlSeconds: boundedTtl(value.ttlSeconds),
  };
  if (core.sourceCloudLeaseEpoch !== 1
    || core.sourceWriteSetDigest !== digestValue(writeSet)
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

export function verifyActiveOwnedDirtCloudRecovery({ plan, result, recoveryEvidenceDigest }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const claim = result?.claim;
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "continue"
    || claim?.claimId !== normalized.sourceClaimId
    || claim.state !== "current"
    || claim.canonicalBaseRevision !== normalized.sourceBaseSha
    || claim.laneRevision !== normalized.sourceFenceSha
    || claim.writeSetDigest !== normalized.sourceWriteSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(normalized.sourceDeclaredWriteSet)
    || claim.reviewRequestId !== normalized.sourceReviewRequestId
    || claim.leaseEpoch !== normalized.sourceCloudLeaseEpoch
    || claim.transitionCounter !== normalized.sourceCloudTransitionCounter + 1
    || claim.deviceId !== normalized.sourceDevice
    || claim.sessionId !== normalized.sourceSessionId
    || claim.recovery?.evidenceDigest
      !== requiredDigest(recoveryEvidenceDigest, "cloud recovery evidence digest")) {
    throw new Error("Cloud recovery changed the admitted claim identity.");
  }
  return Object.freeze({
    claimId: normalized.sourceClaimId,
    claimDigest: requiredDigest(result.claimDigest || claim.fenceRevision, "recovered claim digest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "recovered ledger revision"),
    ledgerDigest: requiredDigest(result.ledgerDigest || result.receipt?.ledgerDigest, "recovered ledger digest"),
    claimLedgerRevision: requiredDigest(claim.transitionDigest, "recovered claim ledger revision"),
    transitionCounter: claim.transitionCounter,
    expiresAt: requiredFutureInstant(claim.expiresAt, "recovered claim expiry"),
    recoveredAt: requiredInstant(result.receipt?.evaluationTime, "cloud recovery evaluation time"),
    operationReceiptDigest: requiredDigest(claim.operationReceiptDigest, "recovered operation receipt digest"),
    cloudReceiptDigest: requiredDigest(result.receipt?.receiptDigest, "cloud recovery receipt digest"),
  });
}

export function classifyActiveOwnedDirtCloudRecoveryState({ plan, source, snapshotReceiptDigest }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const claim = source?.claim;
  const commonIdentityMatches = claim?.claimId === normalized.sourceClaimId
    && claim.canonicalBaseRevision === normalized.sourceBaseSha
    && claim.laneRevision === normalized.sourceFenceSha
    && claim.writeSetDigest === normalized.sourceWriteSetDigest
    && JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      === JSON.stringify(normalized.sourceDeclaredWriteSet)
    && claim.reviewRequestId === normalized.sourceReviewRequestId
    && claim.leaseEpoch === normalized.sourceCloudLeaseEpoch
    && claim.deviceId === normalized.sourceDevice
    && claim.sessionId === normalized.sourceSessionId;
  if (!commonIdentityMatches
    || source?.leaseDigest !== normalized.sourceLeaseDigest
    || source?.headSha !== normalized.sourceFenceSha
    || source?.remoteHeadSha !== normalized.sourceFenceSha
    || source?.remoteMainSha !== normalized.sourceBaseSha
    || source?.pullRequest?.isDraft !== true
    || source?.pullRequest?.headRefOid !== normalized.sourceFenceSha
    || source?.pullRequest?.baseRefOid !== normalized.sourceBaseSha
    || source?.pullRequestBodyDigest !== normalized.sourcePullRequestBodyDigest
    || source?.markerDigest !== normalized.sourceMarkerDigest
    || source?.evidence?.evidenceDigest !== normalized.evidenceDigest) {
    throw new Error("Cloud recovery source drifted from the exact plan.");
  }
  const sourceState = claim.state === "dormant-preserved"
    && claim.fenceRevision === normalized.sourceClaimDigest
    && claim.transitionDigest === normalized.sourceClaimLedgerRevision
    && claim.transitionCounter === normalized.sourceCloudTransitionCounter;
  const recoveredState = claim.state === "current"
    && claim.transitionCounter === normalized.sourceCloudTransitionCounter + 1
    && claim.recovery?.evidenceDigest
      === requiredDigest(snapshotReceiptDigest, "snapshot receipt digest");
  if (!sourceState && !recoveredState) {
    throw new Error("Cloud recovery claim is neither the exact source nor its exact recovered replay.");
  }
  return recoveredState ? "recovered" : "source";
}

export function reconstructActiveOwnedDirtCloudRecoveryResult(source) {
  const claim = source?.claim;
  if (claim?.state !== "current" || !claim.recovery?.recoveredAt) {
    throw new Error("Cloud recovery replay lacks an exact recovered status claim.");
  }
  return Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    claimDigest: requiredDigest(claim.fenceRevision, "replayed claim digest"),
    ledgerRevision: requiredSha(source.ledgerRevision, "replayed ledger revision"),
    ledgerDigest: requiredDigest(source.ledgerDigest, "replayed ledger digest"),
    receipt: {
      receiptDigest: requiredDigest(claim.operationReceiptDigest, "replayed operation receipt digest"),
      ledgerDigest: requiredDigest(source.ledgerDigest, "replayed receipt ledger digest"),
      evaluationTime: requiredInstant(claim.recovery.recoveredAt, "replayed recovery time"),
    },
    claim,
  });
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

function normalizeSource(source) {
  const lease = source?.lease;
  const claim = source?.claim;
  const evidence = assertActiveOwnedDirtWithinWriteSet({
    evidence: source?.evidence,
    declaredWriteSet: lease?.admission?.declaredWriteSet,
  });
  const declaredWriteSet = normalizeWriteSet(lease?.admission?.declaredWriteSet);
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.sessionId !== source?.sessionId || lease.branch !== source?.branch
    || lease.fenceSha !== source?.headSha || lease.fenceSha !== source?.remoteHeadSha
    || lease.baseSha !== source?.remoteMainSha
    || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "admitted"
    || lease.admission.writeSetDigest !== digestValue(declaredWriteSet)
    || lease.cloudAuthority?.claimId !== claim?.claimId
    || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || lease.cloudAuthority.state !== "active"
    || lease.cloudAuthority?.sessionId !== lease.sessionId
    || lease.cloudAuthority?.deviceId !== lease.device
    || claim?.state !== "dormant-preserved"
    || claim.fenceRevision !== lease.cloudAuthority?.claimDigest
    || claim.transitionDigest !== lease.cloudAuthority?.claimLedgerRevision
    || claim.transitionCounter !== lease.cloudAuthority?.transitionCounter
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lease.fenceSha
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope)) !== JSON.stringify(declaredWriteSet)
    || claim.reviewRequestId !== lease.cloudAuthority?.reviewRequestId
    || claim.leaseEpoch !== 1 || claim.leaseEpoch !== lease.cloudAuthority?.leaseEpoch
    || claim.sessionId !== lease.sessionId || claim.deviceId !== lease.device
    || evidence.headSha !== lease.fenceSha
    || !Number.isFinite(Date.parse(lease.expiresAt))
    || !Number.isFinite(Date.parse(source?.evaluatedAt))
    || Date.parse(lease.expiresAt) > Date.parse(source.evaluatedAt)
    || source?.pullRequest?.state !== "OPEN" || source.pullRequest.isDraft !== true
    || source.pullRequest.headRefName !== lease.branch
    || source.pullRequest.headRefOid !== lease.fenceSha
    || source.pullRequest.baseRefName !== "main"
    || source.pullRequest.baseRefOid !== source.remoteMainSha
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
    ledgerRevision: requiredSha(source.ledgerRevision, "ledger revision"),
    ledgerDigest: requiredDigest(source.ledgerDigest, "ledger digest"),
    leaseDigest: requiredDigest(source.leaseDigest, "lease digest"),
    pullRequestBodyDigest: requiredDigest(source.pullRequestBodyDigest, "pull-request body digest"),
    markerDigest: requiredDigest(source.markerDigest, "marker digest"),
    worktreeIdentityDigest: requiredDigest(source.worktreeIdentityDigest, "worktree identity digest"),
  };
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

function requiredFutureInstant(value, label) {
  const candidate = requiredInstant(value, label);
  if (Date.parse(candidate) <= Date.now()) throw new Error(`${label} must be in the future.`);
  return candidate;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
