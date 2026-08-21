// Responsibility: Normalize the exact immutable subject of a completed source-correction fence recovery.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const EVIDENCE_SCHEMA = "agentic-completed-source-correction-fence-recovery-evidence/v1";

export function buildCompletedSourceCorrectionFenceRecoveryEvidence(value = {}) {
  const source = object(value.source, "source");
  const lease = object(value.lease, "lease");
  const correction = object(value.correction, "correction");
  const pullRequest = object(value.pullRequest, "pull request");
  const claim = object(value.claim, "claim");
  const declaredWriteSet = normalizeWriteSet(lease.declaredWriteSet);
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    repository: text(value.repository, "repository"),
    source: {
      branch: text(source.branch, "branch"),
      sessionId: text(source.sessionId, "session"),
      localHeadSha: sha(source.localHeadSha, "local head"),
      remoteHeadSha: sha(source.remoteHeadSha, "remote head"),
      protectedMainSha: sha(source.protectedMainSha, "protected main"),
      clean: source.clean === true,
      changedPaths: normalizeChangedPaths(source.changedPaths),
    },
    lease: {
      epoch: integer(lease.epoch, "epoch"),
      leaseDigest: digest(lease.leaseDigest, "lease digest"),
      leaseWithoutTaskAuthorityDigest: digest(lease.leaseWithoutTaskAuthorityDigest, "lease projection digest"),
      fenceSha: sha(lease.fenceSha, "source fence"),
      declaredWriteSet,
      writeSetDigest: digest(lease.writeSetDigest, "write-set digest"),
      taskAuthorityBindingDigest: digest(lease.taskAuthorityBindingDigest, "task binding digest"),
    },
    correction: {
      journalDigest: digest(correction.journalDigest, "journal digest"),
      planDigest: digest(correction.planDigest, "correction plan digest"),
      completionReceiptDigest: digest(correction.completionReceiptDigest, "completion receipt digest"),
      completionLeaseDigest: digest(correction.completionLeaseDigest, "completion lease digest"),
      sourceHeadSha: sha(correction.sourceHeadSha, "corrected source head"),
      successorClaimId: digest(correction.successorClaimId, "successor claim id"),
      successorClaimDigest: digest(correction.successorClaimDigest, "successor claim digest"),
    },
    pullRequest: {
      number: integer(pullRequest.number, "pull request number"),
      state: pullRequest.state === "OPEN" ? "OPEN" : invalid("pull request state"),
      isDraft: pullRequest.isDraft === true,
      headSha: sha(pullRequest.headSha, "pull request head"),
      autoMergeAbsent: pullRequest.autoMergeAbsent === true,
      markerDigest: digest(pullRequest.markerDigest, "marker digest"),
    },
    claim: {
      claimId: digest(claim.claimId, "claim id"),
      fenceRevision: digest(claim.fenceRevision, "claim fence"),
      state: ["dormant-preserved", "parked", "current"].includes(claim.state) ? claim.state : invalid("claim state"),
      recordedState: claim.recordedState === undefined || claim.recordedState === null
        ? null : text(claim.recordedState, "claim recorded state"),
      transitionCounter: integer(claim.transitionCounter, "claim transition counter"),
      laneRevision: sha(claim.laneRevision, "claim lane revision"),
      scopeReserved: claim.scopeReserved === true,
      writeAuthority: claim.writeAuthority === true,
      writeSetDigest: digest(claim.writeSetDigest, "claim write-set digest"),
      reviewRequestId: text(claim.reviewRequestId, "claim review request"),
    },
  };
  if (!evidence.source.clean || !evidence.pullRequest.isDraft || !evidence.pullRequest.autoMergeAbsent) invalid("preserved source");
  if (evidence.lease.leaseWithoutTaskAuthorityDigest !== evidence.correction.completionLeaseDigest) invalid("completed lease projection");
  if (evidence.source.remoteHeadSha !== evidence.correction.sourceHeadSha
    || evidence.pullRequest.headSha !== evidence.correction.sourceHeadSha
    || evidence.claim.laneRevision !== evidence.correction.sourceHeadSha) invalid("corrected source head");
  if (evidence.claim.claimId !== evidence.correction.successorClaimId
    || evidence.claim.writeSetDigest !== evidence.lease.writeSetDigest) invalid("successor claim");
  for (const changed of evidence.source.changedPaths) {
    if (!declaredWriteSet.includes(changed)) invalid("changed path scope");
  }
  return Object.freeze({ ...evidence, evidenceDigest: digestValue(evidence) });
}

export function normalizeCompletedSourceCorrectionFenceRecoveryEvidence(value) {
  const rebuilt = buildCompletedSourceCorrectionFenceRecoveryEvidence(value);
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("evidence projection");
  return rebuilt;
}

function normalizeChangedPaths(value) {
  if (Array.isArray(value) && value.length === 0) return Object.freeze([]);
  return normalizeWriteSet(value);
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function invalid(label) { throw new Error(`Completed source-correction fence recovery has invalid ${label}.`); }
