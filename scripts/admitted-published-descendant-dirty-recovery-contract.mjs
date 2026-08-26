// Responsibility: Seal one published-descendant plus preserved-dirt recovery.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-admitted-published-descendant-dirty-recovery-plan/v1";
export const COMPLETION_SCHEMA = "agentic-admitted-published-descendant-dirty-recovery-completion/v1";

export function buildAdmittedPublishedDescendantDirtyRecoveryPlan(evidence, ttlSeconds = 1_800) {
  if (!evidence || evidence.schema !== "agentic-admitted-published-descendant-dirty-recovery-evidence/v1") {
    throw new Error("Recovery requires exact combined-state evidence.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    throw new Error("Recovery TTL must be from 300 through 86400 seconds.");
  }
  const core = { schema: PLAN_SCHEMA, evidence, ttlSeconds };
  const planDigest = digestValue(core);
  return Object.freeze({ ...core, planDigest,
    exactAuthorization: `authorize admitted-published-descendant-dirty-recovery ${planDigest}` });
}

export function normalizeAdmittedPublishedDescendantDirtyRecoveryPlan(value) {
  const expected = buildAdmittedPublishedDescendantDirtyRecoveryPlan(value?.evidence, value?.ttlSeconds);
  if (canonicalJson(expected) !== canonicalJson(value)) throw new Error("Recovery plan digest drifted.");
  return expected;
}

export function buildAdmittedPublishedDescendantDirtyRecoveryCompletion({ plan, result }) {
  const normalized = normalizeAdmittedPublishedDescendantDirtyRecoveryPlan(plan);
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "recovered-admitted-published-descendant-dirty",
    planDigest: normalized.planDigest,
    claimId: normalized.evidence.cloud.claimId,
    sourceFenceSha: normalized.evidence.lease.fenceSha,
    publishedHeadSha: normalized.evidence.lane.headSha,
    dirtyEvidenceDigest: normalized.evidence.dirt.evidenceDigest,
    cloudRecoveryReceiptDigest: result.cloudRecoveryReceiptDigest,
    cloudProjectionReceiptDigest: result.cloudProjectionReceiptDigest,
    storedLeaseDigest: result.storedLeaseDigest,
    taskAuthorityReceiptDigest: result.taskAuthorityReceiptDigest,
    markerDigest: result.markerDigest,
    mutationAuthorityGranted: true,
    authoringAuthority: true,
    integrationAuthority: false,
    deploymentAuthority: false,
    cleanupAuthority: false,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
