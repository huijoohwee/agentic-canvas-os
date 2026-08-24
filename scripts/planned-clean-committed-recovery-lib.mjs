// Responsibility: Recover one expired planned claim while preserving its clean committed descendant.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { assertLeaseWorktree, requireClean, requireRepositorySafety, requireSession } from "./device-branch-ownership-lib.mjs";
import { captureCommittedDescendantEvidence, readExactPullRequestProjection, readPullRequestProjection, remoteBranchHead } from "./expired-committed-heartbeat-evidence.mjs";
import { assertPullRequestBodyWithinGitHubLimit } from "./expired-committed-heartbeat-contract.mjs";
import { fetchProtectedMain } from "./protected-main-path-equivalence-lib.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeOwnerIdentifier } from "./planned-device-projection-recovery-evidence.mjs";
import { parseDeviceBranch, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, projectExpiredCommittedHeartbeatLease, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const PLANNED_CLEAN_COMMITTED_RECOVERY_RESULT_SCHEMA = "agentic-planned-clean-committed-recovery-result/v1";
const FENCE_PROJECTION_RECEIPTS_FIELD = "plannedStartFenceProjectionRecoveryReceipts";
const DIGEST = /^[0-9a-f]{64}$/u;

export function recoverPlannedCleanCommitted({ invocationPath, repo, gitText, gitOptional, ghText,
  leaseStore, sessionId, leaseTtlMs, run, now = () => new Date(),
  recoverCloud = recoverPlannedAdmissionCloudAuthority, verifyCloud = verifyAdmissionCloudAuthority }) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  const existing = leaseStore.read(branch);
  if (shouldReconcileRecoveredPlannedLease(existing, now())) {
    return reconcileExisting({ repo, branch, gitText, gitOptional, ghText, leaseStore,
      sessionId, run, now, verifyCloud });
  }
  fetchProtectedMain({ run });
  const source = captureSource({ repo, branch, gitText, gitOptional, ghText, leaseStore, sessionId, now });
  const manifest = manifestFromLease(source.lease);
  const recovered = recoverCloud({ authority: source.lease.cloudAuthority, manifest, branch,
    recoveryEvidenceDigest: source.evidenceDigest, ttlSeconds: Math.floor(leaseTtlMs / 1_000),
    deviceId: source.lease.device, sessionId });
  const unchanged = captureSource({ repo, branch, gitText, gitOptional, ghText, leaseStore, sessionId, now });
  if (unchanged.sourceDigest !== source.sourceDigest) {
    throw new Error("Planned clean committed recovery subject drifted before local CAS.");
  }
  const recoveredAt = now().toISOString();
  const projectionSourceLease = source.projectionReceipt
    ? canonicalizeProjectedManifestSource(source.lease)
    : source.lease;
  const projectedLease = projectExpiredCommittedHeartbeatLease({ sourceLease: projectionSourceLease,
    renewedCloudAuthority: recovered.authority, recoveryEvidence: source.recoveryEvidence,
    ttlMs: leaseTtlMs, recoveredAt });
  requirePlannedLease(projectedLease, repo, branch, sessionId, now(), true);
  assertPullRequestBodyWithinGitHubLimit(updateWriterLeasePullRequestBody(source.projection.pullRequest.body, projectedLease));
  const lease = source.projectionReceipt
    ? recoverReceiptCanonicalizedPlannedLease({ leaseStore, branch,
      expectedLease: source.lease, renewedCloudAuthority: recovered.authority,
      recoveryEvidence: source.recoveryEvidence, ttlMs: leaseTtlMs, recoveredAt,
      projectionReceipt: source.projectionReceipt, instant: now() })
    : leaseStore.recoverExpiredCommittedHeartbeat({ sessionId, branch,
      expectedLease: source.lease, renewedCloudAuthority: recovered.authority,
      recoveryEvidence: source.recoveryEvidence, ttlMs: leaseTtlMs, recoveredAt });
  const body = updateWriterLeasePullRequestBody(source.projection.pullRequest.body, lease);
  run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", body]);
  const projected = readExactPullRequestProjection({ lease, branch, ghText, expectedBody: body,
    expectedHeadSha: source.remoteHeadSha });
  if (projected.markerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Planned clean committed recovery did not seal its PR projection.");
  }
  assertPreserved({ source, lease, branch, gitText, gitOptional, leaseStore });
  return result({ branch, lease, headSha: source.descendant.headSha, replayed: false });
}

export function recoverPlannedAdmissionCloudAuthority({ authority, manifest, branch,
  recoveryEvidenceDigest, ttlSeconds = 1_800, deviceId = authority?.deviceId,
  sessionId = authority?.sessionId, invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction, verify = verifyAdmissionCloudAuthority }) {
  const status = inspect({ action: "status", ledgerRepository: authority?.ledgerRepository,
    request: { targetRepository: authority?.targetRepository } });
  const matches = (status?.claims || []).filter(claim => claim.claimId === authority?.claimId);
  const claim = matches[0];
  const dormant = ["dormant-preserved", "parked"].includes(claim?.state);
  const responseLossReplay = claim?.state === "current"
    && claim.transitionCounter > authority.transitionCounter;
  if (matches.length !== 1 || (!dormant && !responseLossReplay)
    || claim.canonicalBaseRevision !== authority.canonicalBaseSha
    || claim.laneRevision !== authority.laneRevision
    || claim.writeSetDigest !== manifest?.writeSetDigest
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.reviewRequestId !== authority.reviewRequestId) {
    throw new Error("Planned admission recovery requires its exact dormant cloud claim.");
  }
  const result = responseLossReplay ? status : invoke({ action: "continue",
    ledgerRepository: authority.ledgerRepository, request: {
      targetRepository: authority.targetRepository, claimId: claim.claimId,
      expectedFenceRevision: claim.fenceRevision, expectedTransitionCounter: claim.transitionCounter,
      mode: "recovery", ttlSeconds, recoveryEvidenceDigest, deviceId, sessionId,
      idempotencyKey: ["planned-clean-committed-recovery", claim.claimId,
        claim.transitionCounter, claim.fenceRevision, recoveryEvidenceDigest].join(":") } });
  const recoveredClaim = responseLossReplay ? claim : result?.claim;
  if (result?.ok !== true || (!responseLossReplay && result.action !== "continue")
    || recoveredClaim?.state !== "current" || recoveredClaim.claimId !== claim.claimId
    || (!responseLossReplay && recoveredClaim.transitionCounter !== claim.transitionCounter + 1)
    || recoveredClaim.canonicalBaseRevision !== claim.canonicalBaseRevision
    || recoveredClaim.laneRevision !== claim.laneRevision
    || recoveredClaim.writeSetDigest !== claim.writeSetDigest
    || recoveredClaim.reviewRequestId !== claim.reviewRequestId) {
    throw new Error("Planned admission cloud recovery changed its exact claim subject.");
  }
  const projected = Object.freeze({ ...authority,
    claimDigest: recoveredClaim.fenceRevision,
    ledgerRevision: result.ledgerRevision,
    ledgerDigest: result.ledgerDigest || result.receipt?.ledgerDigest,
    claimLedgerRevision: recoveredClaim.transitionDigest,
    entrySchema: recoveredClaim.entrySchema,
    claimIdentitySchema: recoveredClaim.claimIdentitySchema,
    operationReceiptDigest: recoveredClaim.operationReceiptDigest,
    transitionCounter: recoveredClaim.transitionCounter,
    expiresAt: recoveredClaim.expiresAt,
    state: "active",
    manifestDigest: manifest.manifestDigest,
  });
  return verify({ authority: projected, manifest, canonicalBaseSha: authority.canonicalBaseSha,
    branch });
}

export function shouldReconcileRecoveredPlannedLease(lease, instant = new Date()) {
  if (!lease?.expiredCommittedHeartbeatRecovery) return false;
  const expiresAt = Date.parse(lease.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt > instant.getTime();
}

export function recoverReceiptCanonicalizedPlannedLease({ leaseStore, branch,
  expectedLease, renewedCloudAuthority, recoveryEvidence, ttlMs, recoveredAt,
  projectionReceipt, instant = new Date() }, {
  mutateRegistry = mutateWriterLeaseRegistry,
  projectLease = projectExpiredCommittedHeartbeatLease,
} = {}) {
  const expectedLeaseDigest = writerLeaseDigest(expectedLease);
  if (projectionReceipt?.targetLeaseDigest !== expectedLeaseDigest) {
    throw new Error("Planned manifest canonicalization receipt changed before local CAS.");
  }
  const evaluationTime = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(evaluationTime.getTime())) {
    throw new Error("Planned manifest canonicalization CAS requires an exact evaluation instant.");
  }
  const result = mutateRegistry({ leaseStore, branch, expectedLeaseDigest,
    expectedClaimId: expectedLease.cloudAuthority.claimId,
    action: ({ registry, lease }) => {
      const currentReceipt = authorizeProjectedManifestCanonicalization({ registry, lease });
      if (currentReceipt?.receiptDigest !== projectionReceipt.receiptDigest) {
        throw new Error("Planned manifest canonicalization receipt changed before local CAS.");
      }
      const projectedLease = projectLease({
        sourceLease: canonicalizeProjectedManifestSource(lease),
        renewedCloudAuthority, recoveryEvidence, ttlMs, recoveredAt,
      });
      const sourceExpiry = Date.parse(lease.expiresAt);
      const projectedHeartbeat = Date.parse(projectedLease.heartbeatAt);
      const projectedExpiry = Date.parse(projectedLease.expiresAt);
      if (!Number.isFinite(sourceExpiry) || sourceExpiry > evaluationTime.getTime()
        || !Number.isFinite(projectedHeartbeat) || projectedHeartbeat > evaluationTime.getTime()
        || !Number.isFinite(projectedExpiry) || projectedExpiry <= evaluationTime.getTime()) {
        throw new Error("Planned manifest canonicalization projection is not live at the local registry CAS.");
      }
      return {
        registry: { ...registry, leases: { ...registry.leases, [branch]: projectedLease } },
        lease: projectedLease,
        changed: true,
      };
    },
  });
  return result.lease;
}

function captureSource({ repo, branch, gitText, gitOptional, ghText, leaseStore, sessionId, now }) {
  const registry = typeof leaseStore.readRegistry === "function" ? leaseStore.readRegistry() : null;
  const lease = registry?.leases?.[branch] || leaseStore.read(branch);
  const projectionReceipt = authorizeProjectedManifestCanonicalization({ registry, lease });
  requirePlannedLease(lease, repo, branch, sessionId, now(), false, projectionReceipt);
  const remoteHeadSha = remoteBranchHead({ branch, gitOptional });
  const projection = readPlannedPullRequestProjection({ lease, branch, ghText,
    expectedHeadSha: remoteHeadSha, projectionReceipt });
  const descendant = captureCommittedDescendantEvidence({ lease, gitText, bindProtectedMain: true,
    sourceRemoteHeadSha: remoteHeadSha });
  const prefix = descendant.sourceRemotePrefix;
  const recoveryEvidence = {
    sourceEpoch: lease.epoch, sourceSessionId: lease.sessionId, sourceDevice: lease.device,
    sourceScope: lease.scope, sourceBranch: lease.branch, sourceBaseSha: lease.baseSha,
    sourceFenceSha: lease.fenceSha, sourceRemoteHeadSha: remoteHeadSha,
    sourceRemoteTreeSha: prefix.treeSha, sourceRemoteChangedPathCount: prefix.changedPaths.length,
    sourceRemoteChangedPathsDigest: digestValue(prefix.changedPaths),
    sourceRemoteDeclaredChangedPathCount: prefix.declaredChangedPaths.length,
    sourceRemoteDeclaredChangedPathsDigest: digestValue(prefix.declaredChangedPaths),
    sourceRemoteProtectedEquivalentPathCount: prefix.protectedEquivalentPaths.length,
    sourceRemoteProtectedEquivalentPathsDigest: digestValue(prefix.protectedEquivalentPaths),
    sourceRemoteSharedAncestorEquivalence: prefix.sharedAncestorEquivalence,
    sourceRemoteSharedAncestorEquivalenceDigest: prefix.sharedAncestorEquivalenceDigest,
    sourceRemoteRangeDiffDigest: prefix.rangeDiffDigest, sourcePullRequestUrl: lease.pullRequestUrl,
    sourceClaimId: lease.cloudAuthority.claimId, sourceClaimDigest: lease.cloudAuthority.claimDigest,
    sourceLedgerRevision: lease.cloudAuthority.ledgerRevision,
    sourceClaimLedgerRevision: lease.cloudAuthority.claimLedgerRevision,
    sourceCloudTransitionCounter: lease.cloudAuthority.transitionCounter,
    plannedFenceProjectionReceiptDigest: projectionReceipt?.receiptDigest || null,
    headSha: descendant.headSha, treeSha: descendant.treeSha,
    changedPathCount: descendant.changedPaths.length, changedPathsDigest: digestValue(descendant.changedPaths),
    declaredChangedPathCount: descendant.declaredChangedPaths.length,
    declaredChangedPathsDigest: digestValue(descendant.declaredChangedPaths),
    protectedEquivalentPathCount: descendant.protectedEquivalentPaths.length,
    protectedEquivalentPathsDigest: digestValue(descendant.protectedEquivalentPaths),
    protectedMainEquivalence: descendant.protectedMainEquivalence,
    protectedMainEquivalenceDigest: descendant.protectedMainEquivalenceDigest,
    sourceMarkerDigest: projection.markerDigest, pullRequestBodyDigest: projection.bodyDigest,
    rangeDiffDigest: descendant.rangeDiffDigest,
  };
  const evidenceDigest = digestValue({ schema: "agentic-planned-clean-committed-recovery-evidence/v1",
    recoveryEvidence, admissionStatus: lease.admission.status });
  const sourceDigest = digestValue({ lease, remoteHeadSha, projectionDigest: projection.bodyDigest,
    descendant, evidenceDigest });
  return Object.freeze({ lease, projectionReceipt, remoteHeadSha, projection, descendant,
    recoveryEvidence: Object.freeze(recoveryEvidence), evidenceDigest, sourceDigest });
}

function canonicalizeProjectedManifestSource(lease) {
  return Object.freeze({
    ...lease,
    cloudAuthority: Object.freeze({
      ...lease.cloudAuthority,
      manifestDigest: lease.admission.manifestDigest,
    }),
  });
}

function requirePlannedLease(lease, repo, branch, sessionId, instant, requireLive,
  projectionReceipt = null) {
  if (!lease || lease.status !== "active" || lease.sessionId !== sessionId || lease.branch !== branch
    || lease.admission?.status !== "planned" || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || lease.cloudAuthority.state !== "active"
    || !ownerIdentifierMatches("device", lease.cloudAuthority.deviceId, lease.device)
    || !ownerIdentifierMatches("session", lease.cloudAuthority.sessionId, sessionId)
    || lease.cloudAuthority.canonicalBaseSha !== lease.baseSha
    || lease.cloudAuthority.laneRevision !== lease.fenceSha
    || lease.cloudAuthority.writeSetDigest !== lease.admission.writeSetDigest
    || (lease.cloudAuthority.manifestDigest !== lease.admission.manifestDigest && !projectionReceipt)
    || digestValue(normalizeWriteSet(lease.admission.declaredWriteSet)) !== lease.admission.writeSetDigest
    || (requireLive ? Date.parse(lease.expiresAt) <= instant.getTime() : Date.parse(lease.expiresAt) > instant.getTime())) {
    throw new Error("Recovery requires the exact expired planned cloud-admitted lease.");
  }
  assertLeaseWorktree(lease, repo);
  const identity = parseDeviceBranch(branch);
  if (!identity || identity.device !== lease.device || identity.scope !== lease.scope) {
    throw new Error("Recovery branch identity drifted from its planned lease.");
  }
}

export function authorizeProjectedManifestCanonicalization({ registry, lease } = {}) {
  const admittedManifestDigest = lease?.admission?.manifestDigest;
  const projectedManifestDigest = lease?.cloudAuthority?.manifestDigest;
  if (projectedManifestDigest === admittedManifestDigest) return null;
  if (projectedManifestDigest !== undefined || !DIGEST.test(String(admittedManifestDigest || ""))) {
    throw new Error("Recovery requires the exact expired planned cloud-admitted lease.");
  }
  const receipts = Object.values(registry?.[FENCE_PROJECTION_RECEIPTS_FIELD] || {})
    .filter(receipt => isExactFenceProjectionReceipt({ receipt, registry, lease }));
  if (receipts.length !== 1) {
    throw new Error("Recovery requires the exact expired planned cloud-admitted lease.");
  }
  return receipts[0];
}

export function isProjectedPredecessorPullRequestMarker({ marker, lease,
  projectionReceipt } = {}) {
  if (!projectionReceipt) return false;
  try {
    const reconstructedSourceLease = { ...lease, cloudAuthority: marker.cloudAuthority };
    return projectionReceipt.targetLeaseDigest === writerLeaseDigest(lease)
      && projectionReceipt.sourceLeaseDigest === writerLeaseDigest(reconstructedSourceLease)
      && sameMarkerExceptPriorHeartbeat(marker,
        projectWriterLeasePullRequestMarker(reconstructedSourceLease));
  } catch {
    return false;
  }
}

function sameMarkerExceptPriorHeartbeat(marker, expected) {
  const source = structuredClone(marker);
  const target = structuredClone(expected);
  const sourceHeartbeat = Date.parse(source.heartbeatAt || "");
  const sourceExpiry = Date.parse(source.expiresAt || "");
  const targetHeartbeat = Date.parse(target.heartbeatAt || "");
  const targetExpiry = Date.parse(target.expiresAt || "");
  delete source.heartbeatAt;
  delete source.expiresAt;
  delete target.heartbeatAt;
  delete target.expiresAt;
  const sourceTtl = sourceExpiry - sourceHeartbeat;
  return Number.isFinite(sourceHeartbeat) && Number.isFinite(sourceExpiry)
    && Number.isFinite(targetHeartbeat) && Number.isFinite(targetExpiry)
    && sourceTtl >= 60_000 && sourceTtl === targetExpiry - targetHeartbeat
    && sourceHeartbeat <= targetHeartbeat && sourceExpiry <= targetExpiry
    && targetHeartbeat - sourceHeartbeat <= sourceTtl
    && digestValue(source) === digestValue(target);
}

function readPlannedPullRequestProjection({ lease, branch, ghText, expectedHeadSha,
  projectionReceipt }) {
  try {
    return readExactPullRequestProjection({ lease, branch, ghText, expectedHeadSha });
  } catch (error) {
    const projection = readPullRequestProjection({ lease, branch, ghText, expectedHeadSha });
    const marker = parseWriterLeasePullRequestBody(projection.pullRequest.body);
    if (!isProjectedPredecessorPullRequestMarker({ marker, lease, projectionReceipt })) throw error;
    return projection;
  }
}

function isExactFenceProjectionReceipt({ receipt, registry, lease }) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const { receiptDigest, ...core } = receipt;
  const authority = receipt.phaseValues?.authorityVerified;
  const attempted = receipt.phaseValues?.localAttempted;
  const operationPrefix = "planned-start-fence-projection-recovery:local-attempted:";
  return receipt.schema === "agentic-planned-start-fence-projection-recovery-registry-receipt/v1"
    && DIGEST.test(String(receiptDigest || "")) && receiptDigest === digestValue(core)
    && DIGEST.test(String(receipt.planDigest || ""))
    && receipt.targetLeaseDigest === writerLeaseDigest(lease)
    && receipt.claimId === lease.cloudAuthority.claimId
    && receipt.sourceTransitionCounter === 1
    && receipt.targetTransitionCounter === lease.cloudAuthority.transitionCounter
    && Number.isSafeInteger(receipt.registryRevision) && receipt.registryRevision > 0
    && Number.isSafeInteger(registry?.revision) && receipt.registryRevision <= registry.revision
    && receipt.writerRegistryMutation === true && receipt.cloudMutation === false
    && receipt.providerMutation === false && receipt.gitMutation === false
    && receipt.sourceMutation === false
    && DIGEST.test(String(authority?.taskAuthorityReceiptDigest || ""))
    && authority?.taskAuthorityBindingDigest === lease.taskAuthority?.bindingDigest
    && DIGEST.test(String(attempted?.sourceLeaseDigest || ""))
    && attempted?.sourceLeaseDigest === receipt.sourceLeaseDigest
    && attempted?.targetLeaseDigest === receipt.targetLeaseDigest
    && receipt.operationKey === `${operationPrefix}${attempted?.idempotencyKey}`;
}

export function ownerIdentifierMatches(namespace, providerIdentity, localIdentity) {
  return normalizeOwnerIdentifier(namespace, providerIdentity)
    === normalizeOwnerIdentifier(namespace, localIdentity);
}

function manifestFromLease(lease) {
  return Object.freeze({ manifestDigest: lease.admission.manifestDigest,
    declaredWriteSet: normalizeWriteSet(lease.admission.declaredWriteSet),
    writeSetDigest: lease.admission.writeSetDigest });
}

function reconcileExisting({ repo, branch, gitText, gitOptional, ghText, leaseStore, sessionId, run, now, verifyCloud }) {
  const lease = leaseStore.read(branch);
  requirePlannedLease(lease, repo, branch, sessionId, now(), true);
  requireClean({ gitText });
  const recovery = lease.expiredCommittedHeartbeatRecovery;
  const remoteHeadSha = remoteBranchHead({ branch, gitOptional });
  const descendant = captureCommittedDescendantEvidence({ lease, gitText, bindProtectedMain: true,
    sourceRemoteHeadSha: remoteHeadSha });
  if (recovery.headSha !== descendant.headSha || recovery.treeSha !== descendant.treeSha
    || recovery.rangeDiffDigest !== descendant.rangeDiffDigest) {
    throw new Error("Recovered planned descendant evidence drifted.");
  }
  verifyCloud({ authority: lease.cloudAuthority, manifest: manifestFromLease(lease), canonicalBaseSha: lease.baseSha });
  const projection = readPullRequestProjection({ lease, branch, ghText, expectedHeadSha: remoteHeadSha });
  const markerDigest = digestValue(projectWriterLeasePullRequestMarker(lease));
  if (projection.markerDigest !== markerDigest) {
    const body = updateWriterLeasePullRequestBody(projection.pullRequest.body, lease);
    run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", body]);
    readExactPullRequestProjection({ lease, branch, ghText, expectedBody: body, expectedHeadSha: remoteHeadSha });
  }
  return result({ branch, lease, headSha: descendant.headSha, replayed: true });
}

function assertPreserved({ source, lease, branch, gitText, gitOptional, leaseStore }) {
  requireClean({ gitText });
  if (leaseStore.read(branch)?.heartbeatAt !== lease.heartbeatAt
    || remoteBranchHead({ branch, gitOptional }) !== source.remoteHeadSha
    || gitText(["rev-parse", "HEAD"]).trim() !== source.descendant.headSha) {
    throw new Error("Recovery changed the preserved committed subject.");
  }
}

function result({ branch, lease, headSha, replayed }) {
  return Object.freeze({ schema: PLANNED_CLEAN_COMMITTED_RECOVERY_RESULT_SCHEMA, ok: true,
    status: "recovered-planned", deployment: false, mutationAuthority: false, replayed,
    branch, pullRequestUrl: lease.pullRequestUrl, headSha, lease,
    recovery: lease.expiredCommittedHeartbeatRecovery });
}
