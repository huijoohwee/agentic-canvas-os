export async function captureReviewAheadProjectionEvidence({ adapter, branch, sessionId }) {
  if (!adapter) throw new Error("Review-ahead evidence requires an adapter.");
  const lane = await adapter.readPreservedReviewLane({ branch });
  if (lane.lease.sessionId !== sessionId) {
    throw new Error("Review-ahead recovery belongs to another source session.");
  }
  const status = await adapter.readCloudStatus({
    ledgerRepository: lane.authority.ledgerRepository,
    targetRepository: lane.authority.targetRepository,
  });
  const actor = await adapter.readAuthenticatedOwner();
  const localHeadSha = typeof adapter.readLocalHead === "function"
    ? await adapter.readLocalHead({ repository: lane.repository })
    : lane.refreshedHeadSha || lane.headSha;
  const descendantReceipt = localHeadSha === lane.headSha
    ? null
    : await adapter.readLocalDescendantReceipt({
      baseSha: lane.baseSha,
      localHeadSha,
      reviewHeadSha: lane.headSha,
      repository: lane.repository,
      declaredWriteScope: lane.authority.cloudDeclaredWriteScope,
    });
  const claims = (status.claims || []).filter(claim => claim.claimId === lane.authority.claimId);
  if (claims.length !== 1) {
    throw new Error("Review-ahead recovery requires exactly one matching cloud claim.");
  }
  const claim = claims[0];
  const evidence = Object.freeze({
    repository: lane.repository,
    repositoryId: status.repositoryId,
    branch: lane.branch,
    deviceId: lane.lease.device,
    sessionId,
    actorLogin: actor.login,
    clean: lane.clean,
    localHeadSha,
    refreshedHeadSha: lane.refreshedHeadSha,
    localDescendantReceiptDigest: descendantReceipt?.receiptDigest || null,
    remoteHeadSha: lane.remoteHeadSha,
    reviewHeadSha: lane.headSha,
    pullRequestHeadSha: lane.pullRequest.headRefOid,
    pullRequestUrl: lane.pullRequest.url,
    pullRequestAuthorLogin: lane.pullRequest.authorLogin,
    pullRequestState: lane.pullRequest.state,
    pullRequestDraft: lane.pullRequest.isDraft,
    pullRequestAutoMergeArmed: lane.pullRequest.autoMergeRequest != null,
    leaseStatus: lane.lease.status,
    localExpiresAt: lane.lease.expiresAt,
    localAuthorityState: lane.authority.state,
    claimId: lane.authority.claimId,
    authorityLaneRevision: lane.authority.laneRevision,
    reviewRequestId: lane.authority.reviewRequestId,
    writeSetDigest: lane.authority.writeSetDigest,
    declaredWriteScope: lane.authority.cloudDeclaredWriteScope,
    leaseEpoch: lane.authority.leaseEpoch,
    remoteClaimId: claim.claimId,
    remoteClaimState: claim.state,
    remoteRepositoryId: claim.repositoryId,
    remoteLaneRevision: claim.laneRevision,
    remoteReviewRequestId: claim.reviewRequestId,
    remoteWriteSetDigest: claim.writeSetDigest,
    remoteDeclaredWriteScope: claim.declaredWriteScope,
    remoteLeaseEpoch: claim.leaseEpoch,
    remoteExpiresAt: claim.expiresAt,
  });
  return Object.freeze({ lane, status, claim, evidence });
}
