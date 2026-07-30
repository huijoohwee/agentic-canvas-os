export function requireCarriedIntegrationSource({
  stored,
  localLease,
  remoteLease,
  handoffHeadSha,
  gitText,
  normalizeContinuation,
}) {
  const remoteStored = normalizeContinuation(
    remoteLease.preClaimIntegrationContinuation,
  );
  if (
    !remoteStored ||
    JSON.stringify(stored) !== JSON.stringify(remoteStored) ||
    JSON.stringify(localLease.integration) !== JSON.stringify(remoteLease.integration) ||
    localLease.integration?.commitSha !== stored.integrationCommitSha ||
    localLease.integration?.treeSha !== stored.integrationTreeSha
  ) {
    throw new Error("Delivered continuation lost its exact carried integration evidence.");
  }
  gitText(["merge-base", "--is-ancestor", stored.headSha, remoteLease.fenceSha]);
  gitText(["merge-base", "--is-ancestor", remoteLease.fenceSha, handoffHeadSha]);
  return {
    baseSha: stored.integrationSourceBaseSha,
    fenceSha: stored.integrationSourceFenceSha,
  };
}
