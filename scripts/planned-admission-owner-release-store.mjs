// Responsibility: Create and recognize the terminal local lease projection.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export function buildLocalReleaseProjection({ plan, originalLease, cloud, provider, completedAt }) {
  const release = {
    schema: "agentic-planned-admission-owner-local-release/v1",
    status: "retired-preserved",
    planDigest: plan.planDigest,
    claimId: plan.claim.claimId,
    cloudRetirementReceiptDigest: cloud.receiptDigest,
    pullRequestUrl: plan.pullRequest.url,
    providerDisposition: provider.disposition,
    originalLease: structuredClone(originalLease),
    originalLeaseDigest: digestValue(originalLease),
    preservedLaneStateDigest: plan.preservedLane.stateDigest,
    completedAt,
  };
  return Object.freeze({ ...release, receiptDigest: digestValue(release) });
}

export function isReleasedProjection(lease, plan) {
  return lease?.status === "released"
    && lease?.plannedAdmissionOwnerRelease?.status === "retired-preserved"
    && lease.plannedAdmissionOwnerRelease.planDigest === plan.planDigest
    && lease.plannedAdmissionOwnerRelease.originalLeaseDigest === plan.staleLeaseDigest;
}
