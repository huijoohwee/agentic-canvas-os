// Responsibility: Join verified cloud authority, heartbeat projection, and mutation authority.

import { verifiedHeartbeatAuthority }
  from "./active-owned-dirt-recovery-registry.mjs";
import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { projectPlannedDirtyHeartbeatProjection }
  from "./planned-dirty-admission-recovery-evidence.mjs";
import { reconcileCloudAuthorityProjection }
  from "./scoped-lane-cloud-reconciliation.mjs";
import {
  attestProvisionedStartCloudAuthoritySubject,
  projectProvisionedStartCloudAuthoritySubject,
  requireProvisionedStartCloudAuthorityAttestation,
} from "./provisioned-start-cloud-authority-subject.mjs";

export function buildPlannedDirtyAdmissionRecoveryCloudFrame({
  lease,
  branch,
  manifest,
  sealedHeartbeatProjection = null,
  inspectCloudStatus,
  verifyCloud,
  assertMutation,
  environment,
  now,
}) {
  const authority = typeof inspectCloudStatus === "function"
    ? reconcileCloudAuthorityProjection({
      authority: lease.cloudAuthority,
      manifest,
      statusResult: inspectCloudStatus({ action: "status",
        ledgerRepository: lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: lease.cloudAuthority.targetRepository,
          claimId: lease.cloudAuthority.claimId } }),
      branch,
      headSha: lease.fenceSha,
      now: now(),
    }).authority
    : lease.cloudAuthority;
  let verified = verifyCloud({ authority, manifest,
    canonicalBaseSha: lease.baseSha, environment });
  const targetCloudAuthority = verifiedHeartbeatAuthority(verified);
  verified = { ...verified, authority: targetCloudAuthority };
  const heartbeatProjection = sealedHeartbeatProjection
    || projectPlannedDirtyHeartbeatProjection({
      sourceLease: lease,
      targetCloudAuthority,
      observedAt: now().toISOString(),
    });
  if (heartbeatProjection.targetAuthorityDigest !== digestValue(targetCloudAuthority)) {
    invalid("sealed target cloud authority");
  }
  const projectedLease = heartbeatProjection.sourceAuthorityDigest
    === digestValue(lease.cloudAuthority)
    ? {
      ...lease,
      cloudAuthority: targetCloudAuthority,
      heartbeatAt: heartbeatProjection.heartbeatAt,
      expiresAt: heartbeatProjection.expiresAt,
    }
    : lease;
  if (digestValue(projectedLease.cloudAuthority) !== digestValue(targetCloudAuthority)
    || projectedLease.heartbeatAt !== heartbeatProjection.heartbeatAt
    || projectedLease.expiresAt !== heartbeatProjection.expiresAt) {
    invalid("source-or-target heartbeat lease projection");
  }
  const subject = projectProvisionedStartCloudAuthoritySubject({ verified, lease, manifest });
  const attestation = attestProvisionedStartCloudAuthoritySubject({ verified, subject });
  requireProvisionedStartCloudAuthorityAttestation(attestation, digestValue(subject));
  const mutation = assertMutation({
    lease: projectedLease,
    cloudAuthority: targetCloudAuthority,
    remoteAuthorityVerification: verified.verification,
    allowPlanned: projectedLease.admission?.status === "planned",
  });
  const claims = verified.verification?.inventory?.claims;
  if (!Array.isArray(claims)) invalid("cloud claim inventory");
  const overlaps = claims.filter(claim => claim.claimId !== subject.claim.claimId
    && (claim.writeAuthority === true || claim.scopeReserved === true)
    && writeSetsOverlap(claim.declaredWriteScope, manifest.declaredWriteSet))
    .map(claim => claim.claimId).sort();
  if (overlaps.length) invalid("non-overlapping peer inventory");
  return Object.freeze({
    subject,
    attestation,
    mutation,
    overlaps,
    targetCloudAuthority,
    heartbeatProjection,
    projectedLease,
  });
}

function invalid(label) {
  throw new Error(`Planned-dirty admission recovery has invalid ${label}.`);
}
