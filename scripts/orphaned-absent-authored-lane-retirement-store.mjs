// Responsibility: Persist exact retirement journals outside all repositories and worktrees.
import { digestValue, normalizeRootIntent } from "./cloud-collaboration-primitives.mjs";
import { claimOnlyOperationReceiptForEntry, createClaimOnlyPartialStartRetirementStore }
  from "./claim-only-partial-start-retirement-store.mjs";

export function createRetirementStore({ statePath, now } = {}) {
  const store = createClaimOnlyPartialStartRetirementStore({ statePath, now });
  return Object.freeze({
    statePath: store.statePath,
    readState: store.readJournal,
    writeState: store.writeJournal,
    withLock: store.withOperationLock,
  });
}

export function retirementOperationKey(plan) {
  return `orphaned-absent-authored-lane-retirement:${plan.planDigest}:claim`;
}

export function retirementRequest(plan, cloud) {
  const claim = plan.evidence.claim;
  return Object.freeze({
    targetRepository: plan.evidence.repository.fullName,
    claimId: claim.claimId,
    expectedFenceRevision: claim.claimDigest,
    expectedTransitionCounter: claim.transitionCounter,
    expectedLedgerDigest: cloud.ledgerDigest,
    deviceId: plan.evidence.marker.device,
    sessionId: plan.evidence.marker.sessionId,
    reason: "abandoned",
    finalRevision: claim.laneRevision,
    reviewRequestId: claim.reviewRequestId,
    bytesDigest: digestValue({
      rangeDigest: plan.evidence.authoredRange.rangeDigest,
      headSha: plan.evidence.authoredRange.headSha,
      treeSha: plan.evidence.authoredRange.headTreeSha,
    }),
    namedChecksDigest: digestValue({
      exactChangedPaths: plan.evidence.authoredRange.changedPaths,
      absenceDigest: plan.evidence.absence.absenceDigest,
    }),
    handoffEvidenceDigest: digestValue({
      taskAuthorityBindingDigest: plan.evidence.marker.taskAuthority.bindingDigest,
      pullRequestImmutableDigest: plan.evidence.pullRequest.immutableDigest,
    }),
    integrationReceiptDigest: null,
    idempotencyKey: retirementOperationKey(plan),
  });
}

export function retirementRequestDigest(plan) {
  const claim = plan.evidence.claim;
  const request = retirementRequest(plan, { ledgerDigest: digestValue("ledger-placeholder") });
  const intent = normalizeRootIntent("retire", request,
    { actorId: claim.actorId, deviceId: claim.deviceId, sessionId: claim.sessionId },
    claim.repositoryId);
  const { expectedLedgerDigest: _ledger, ...semantic } = intent;
  return digestValue({ action: "retire", intent: semantic });
}

export function retirementOperationReceipt(entry) {
  return claimOnlyOperationReceiptForEntry(entry, "retired");
}
