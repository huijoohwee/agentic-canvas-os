import {
  digestValue,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { isOperationDerivedCloudVerification } from "./scoped-lane-admission-lib.mjs";
import { claimProvenanceMatches } from "./scoped-lane-admission-ownership.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function assertAdmissionMutationAuthority({
  lease,
  cloudAuthority,
  remoteAuthorityVerification,
  allowPlanned = false,
  evaluatedAt = remoteAuthorityVerification?.verifiedAt,
}) {
  assertVerificationInventoryIntegrity(remoteAuthorityVerification);
  const evaluationTime = Date.parse(evaluatedAt);
  const localExpiry = Date.parse(lease?.expiresAt);
  const cloudExpiry = Date.parse(cloudAuthority?.expiresAt);
  const candidate = remoteAuthorityVerification?.inventory?.claims
    ?.find(claim => claim.claimId === cloudAuthority?.claimId);
  const identityComplete = candidate && Array.isArray(candidate.declaredWriteScope)
    && [candidate.actorId, candidate.canonicalBaseRevision, candidate.entrySchema,
      candidate.claimIdentitySchema, candidate.operationReceiptDigest,
      candidate.leaseEpoch, candidate.repositoryId, candidate.workItemId,
      candidate.writeSetDigest].every(value => value !== undefined && value !== null);
  const currentClaimMatches = Boolean(identityComplete && cloudAuthority && (
    claimProvenanceMatches(candidate, cloudAuthority)
    && candidate.state === "active"
    && cloudAuthority.state === candidate.state
    && candidate.expiresAt === cloudAuthority.expiresAt
    && candidate.leaseEpoch === cloudAuthority.leaseEpoch
    && candidate.transitionCounter === cloudAuthority.transitionCounter
    && candidate.reviewRequestId === cloudAuthority.reviewRequestId
    && candidate.writeSetDigest === cloudAuthority.writeSetDigest
    && candidate.writeSetDigest === lease?.admission?.writeSetDigest
    && digestValue(candidate.declaredWriteScope) === candidate.writeSetDigest
    && JSON.stringify(candidate.declaredWriteScope)
      === JSON.stringify(cloudAuthority.cloudDeclaredWriteScope)
    && JSON.stringify(candidate.declaredWriteScope)
      === JSON.stringify(lease?.admission?.declaredWriteSet)
    && candidate.canonicalBaseRevision === cloudAuthority.canonicalBaseSha
    && candidate.canonicalBaseRevision === lease?.baseSha
    && candidate.laneRevision === cloudAuthority.laneRevision
    && candidate.laneRevision === lease?.fenceSha
  ));
  const noCompetingOverlap = candidate
    ? remoteAuthorityVerification.inventory.claims.every(claim => (
      claim.claimId === candidate.claimId
      || claim.state === "waiting-successor"
      || !writeSetsOverlap(
        claim.declaredWriteScope,
        candidate.declaredWriteScope,
      )
    ))
    : true;
  if (!noCompetingOverlap) {
    throw new Error("Scoped authoring found competing overlapping cloud authority.");
  }
  if (
    lease?.schema !== "agentic-writer-lease/v2"
    || lease.status !== "active"
    || !["admitted", ...(allowPlanned ? ["planned"] : [])]
      .includes(lease.admission?.status)
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || !lease.pullRequestUrl
    || !isOperationDerivedCloudVerification(remoteAuthorityVerification)
    || remoteAuthorityVerification.status !== "ready"
    || lease.cloudAuthority?.claimId !== cloudAuthority?.claimId
    || lease.cloudAuthority?.claimDigest !== cloudAuthority.claimDigest
    || lease.cloudAuthority?.ledgerRevision !== cloudAuthority.ledgerRevision
    || remoteAuthorityVerification.claimId !== cloudAuthority?.claimId
    || remoteAuthorityVerification.claimDigest !== cloudAuthority.claimDigest
    || remoteAuthorityVerification.ledgerRevision !== cloudAuthority.ledgerRevision
    || remoteAuthorityVerification.ledgerDigest !== cloudAuthority.ledgerDigest
    || remoteAuthorityVerification.canonicalBaseSha !== cloudAuthority.canonicalBaseSha
    || remoteAuthorityVerification.laneRevision !== lease.fenceSha
    || remoteAuthorityVerification.writeSetDigest
      !== lease.admission.writeSetDigest
    || remoteAuthorityVerification.reviewRequestId
      !== cloudAuthority.reviewRequestId
    || digestValue(lease.cloudAuthority) !== digestValue(cloudAuthority)
    || !currentClaimMatches
    || candidate.fenceRevision !== cloudAuthority.claimDigest
    || candidate.transitionDigest !== cloudAuthority.claimLedgerRevision
    || cloudAuthority.laneRevision !== lease.fenceSha
    || cloudAuthority.deviceId !== lease.device
    || cloudAuthority.sessionId !== lease.sessionId
    || !cloudAuthority.reviewRequestId
    || !Number.isFinite(evaluationTime)
    || !Number.isFinite(localExpiry)
    || !Number.isFinite(cloudExpiry)
    || localExpiry <= evaluationTime
    || cloudExpiry <= evaluationTime
    || localExpiry > cloudExpiry
  ) {
    throw new Error("Scoped authoring requires current joined cloud and local lease authority.");
  }
  const receipt = {
    schema: "agentic-admission-mutation-authority/v1",
    status: "ready",
    claimId: cloudAuthority.claimId,
    claimDigest: cloudAuthority.claimDigest,
    ledgerRevision: cloudAuthority.ledgerRevision,
    localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha,
    remoteLeaseEpoch: cloudAuthority.leaseEpoch,
    cloudVerificationReceiptDigest: remoteAuthorityVerification.receiptDigest,
    evaluatedAt: new Date(evaluationTime).toISOString(),
    expiresAt: new Date(Math.min(localExpiry, cloudExpiry)).toISOString(),
  };
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

function assertVerificationInventoryIntegrity(verification) {
  const inventory = verification?.inventory;
  if (
    inventory?.schema !== "agentic-cloud-claim-inventory/v1"
    || !Array.isArray(inventory.claims)
    || verification.remoteClaimInventoryDigest !== inventory.inventoryDigest
    || inventory.observedLedgerHeadRevision !== verification.ledgerRevision
    || inventory.ledgerDigest !== verification.ledgerDigest
    || inventory.evaluationTime !== verification.verifiedAt
  ) {
    throw new Error("Scoped authoring requires an intact current cloud inventory.");
  }
  const { inventoryDigest, ...inventoryCore } = inventory;
  if (digestValue(inventoryCore) !== inventoryDigest) {
    throw new Error("Scoped authoring requires an intact current cloud inventory.");
  }
  for (const claim of inventory.claims) {
    const { recordDigest, ...recordCore } = claim || {};
    if (digestValue(recordCore) !== recordDigest) {
      throw new Error("Scoped authoring requires intact current cloud claim records.");
    }
  }
  const claimIds = inventory.claims.map(claim => claim.claimId);
  if (
    new Set(claimIds).size !== claimIds.length
    || claimIds.filter(claimId => claimId === verification.claimId).length !== 1
  ) {
    throw new Error("Scoped authoring requires one unique verified candidate claim.");
  }
}
