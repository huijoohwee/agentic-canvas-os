import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertLeaseWorktree,
  requireClean,
  requireRepositorySafety,
  requireSession,
} from "./device-branch-ownership-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { continueExpiredCommittedHeartbeatCloudAuthority, expiredCommittedCloudRecoveryEvidenceDigest, preserveSourceManifestProjection }
  from "./expired-committed-heartbeat-cloud-authority.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  captureCommittedDescendantEvidence,
  captureExpiredCommittedHeartbeatSnapshot,
  captureSourceRemotePrefixEvidence,
  readExactPullRequestProjection,
  readPullRequestProjection,
  remoteBranchHead,
  requireCloudAdmission,
  requireChangedPathsWithinScope,
} from "./expired-committed-heartbeat-evidence.mjs";
import {
  assertPullRequestBodyWithinGitHubLimit,
  assertSameCloudSubject,
  GITHUB_PULL_REQUEST_BODY_MAX_BYTES,
  reconcileHeartbeatManifestProjection,
} from "./expired-committed-heartbeat-contract.mjs";
import {
  assertProtectedMainPathEquivalence,
  fetchProtectedMain,
} from "./protected-main-path-equivalence-lib.mjs";
import {
  EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  parseDeviceBranch,
  projectExpiredCommittedHeartbeatLease,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

export const EXPIRED_COMMITTED_HEARTBEAT_RESULT_SCHEMA = "agentic-expired-committed-heartbeat-result/v1";
export { assertPullRequestBodyWithinGitHubLimit, GITHUB_PULL_REQUEST_BODY_MAX_BYTES,
  reconcileHeartbeatManifestProjection };
export { captureExpiredCommittedHeartbeatSnapshot, requireChangedPathsWithinScope };
export function authorizeExpiredCommittedHeartbeatTaskAuthority({
  lease,
  taskAuthorityFile,
  authorizeTaskAuthority = authorizeTaskBoundLeaseMutation,
  now = () => new Date(),
}) {
  return authorizeTaskAuthority({
    lease,
    capabilityPath: taskAuthorityFile,
    operation: "expired-committed-heartbeat-recovery",
    now: now(),
  });
}

export function recoverExpiredCommittedHeartbeat({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  taskAuthorityReceipt = null,
  heartbeatCloudAuthority = continueExpiredCommittedHeartbeatCloudAuthority,
  verifyActiveCloudAuthority = verifyAdmissionCloudAuthority,
  assertMutationAuthority = assertAdmissionMutationAuthority,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  const localLease = leaseStore.read(branch);
  if (localLease?.expiredCommittedHeartbeatRecovery) {
    if (
      localLease.expiredCommittedHeartbeatRecovery.schema !==
      LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA
    ) {
      fetchProtectedMain({ run });
    }
    return reconcileRecoveredExpiredCommittedHeartbeat({
      repo,
      branch,
      gitText,
      gitOptional,
      ghText,
      leaseStore,
      sessionId,
      verifyActiveCloudAuthority,
      assertMutationAuthority,
      run,
      log,
      now,
      taskAuthorityReceipt,
    });
  }
  fetchProtectedMain({ run });
  const before = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText,
    gitOptional,
    ghText,
    leaseStore,
    sessionId,
    now,
  });

  const heartbeat = heartbeatCloudAuthority({
    authority: before.lease.cloudAuthority,
    manifest: { manifestDigest: before.lease.admission.manifestDigest,
      declaredWriteSet: before.lease.admission.declaredWriteSet,
      writeSetDigest: before.lease.admission.writeSetDigest },
    recoveryEvidenceDigest: expiredCommittedCloudRecoveryEvidenceDigest({
      snapshotDigest: before.snapshotDigest,
      recoveryEvidence: before.recoveryEvidence,
    }),
    deviceId: before.lease.device,
    sessionId,
    ttlSeconds: Math.floor(leaseTtlMs / 1000),
  });
  const renewedProjection = reconcileHeartbeatManifestProjection({
    renewed: heartbeat?.authority,
    admittedManifestDigest: before.lease.admission.manifestDigest,
  });
  assertSameCloudSubject({
    source: before.lease.cloudAuthority,
    renewed: renewedProjection,
    lease: before.lease,
    now: now(),
  });
  const renewedAuthority = preserveSourceManifestProjection(
    before.lease.cloudAuthority, renewedProjection,
  );

  const afterCloud = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText,
    gitOptional,
    ghText,
    leaseStore,
    sessionId,
    now,
  });
  if (afterCloud.snapshotDigest !== before.snapshotDigest) {
    throw new Error(
      "Expired committed recovery state drifted after cloud renewal and before local CAS.",
    );
  }

  const preflightProjection = readExactPullRequestProjection({
    lease: before.lease,
    branch,
    ghText,
    expectedHeadSha: before.remoteHeadSha,
  });
  if (
    preflightProjection.bodyDigest !== before.pullRequestBodyDigest ||
    preflightProjection.markerDigest !== before.sourceMarkerDigest
  ) {
    throw new Error(
      "Ownership pull-request marker drifted before recovered marker size preflight.",
    );
  }
  const afterPreflight = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText,
    gitOptional,
    ghText,
    leaseStore,
    sessionId,
    now,
  });
  if (afterPreflight.snapshotDigest !== before.snapshotDigest) {
    throw new Error(
      "Expired committed recovery state drifted after recovered marker size preflight and before local CAS.",
    );
  }
  const recoveredAt = now().toISOString();
  const projectedLease = projectExpiredCommittedHeartbeatLease({
    sourceLease: before.lease,
    renewedCloudAuthority: renewedAuthority,
    recoveryEvidence: before.recoveryEvidence,
    ttlMs: leaseTtlMs,
    recoveredAt,
  });
  assertMutationAuthority({
    lease: projectedLease,
    cloudAuthority: renewedAuthority,
    remoteAuthorityVerification: heartbeat.verification,
    evaluatedAt: recoveredAt,
  });
  assertPullRequestBodyWithinGitHubLimit(
    updateWriterLeasePullRequestBody(
      preflightProjection.pullRequest.body,
      projectedLease,
    ),
  );
  const lease = leaseStore.recoverExpiredCommittedHeartbeat({
    sessionId,
    branch,
    expectedLease: before.lease,
    renewedCloudAuthority: renewedAuthority,
    recoveryEvidence: before.recoveryEvidence,
    ttlMs: leaseTtlMs,
    recoveredAt,
  });
  const mutationAuthorityReceipt = assertMutationAuthority({
    lease,
    cloudAuthority: renewedAuthority,
    remoteAuthorityVerification: heartbeat.verification,
    evaluatedAt: recoveredAt,
  });
  assertRecoveredLocalState({
    snapshot: before,
    lease,
    branch,
    gitText,
    gitOptional,
    leaseStore,
  });

  const sourceProjection = readExactPullRequestProjection({
    lease: before.lease,
    branch,
    ghText,
    expectedHeadSha: before.remoteHeadSha,
  });
  if (
    sourceProjection.bodyDigest !== before.pullRequestBodyDigest ||
    sourceProjection.markerDigest !== before.sourceMarkerDigest
  ) {
    throw new Error(
      "Ownership pull-request marker drifted after local recovery and before projection.",
    );
  }
  assertRecoveredLocalState({
    snapshot: before,
    lease,
    branch,
    gitText,
    gitOptional,
    leaseStore,
  });
  const renewedBody = updateWriterLeasePullRequestBody(
    sourceProjection.pullRequest.body,
    lease,
  );
  assertPullRequestBodyWithinGitHubLimit(renewedBody);
  run("gh", [
    "pr",
    "edit",
    lease.pullRequestUrl,
    "--body",
    renewedBody,
  ]);
  const projected = readExactPullRequestProjection({
    lease,
    branch,
    ghText,
    expectedBody: renewedBody,
    expectedHeadSha: before.remoteHeadSha,
  });
  if (projected.markerDigest !== digestValue(
    projectWriterLeasePullRequestMarker(lease),
  )) {
    throw new Error("Ownership pull-request marker did not retain the recovered lease.");
  }
  assertRecoveredLocalState({
    snapshot: before,
    lease,
    branch,
    gitText,
    gitOptional,
    leaseStore,
  });

  log(
    `Recovered expired ${lease.scope} lease ${lease.epoch} until ${lease.expiresAt}; committed descendant remains locally preserved.`,
  );
  return recoveryResult({
    branch,
    lease,
    headSha: before.headSha,
    mutationAuthorityReceipt,
    replayed: false,
    taskAuthorityReceipt,
  });
}

function recoveryResult({
  branch,
  lease,
  headSha,
  mutationAuthorityReceipt,
  replayed,
  taskAuthorityReceipt,
}) {
  return Object.freeze({
    schema: EXPIRED_COMMITTED_HEARTBEAT_RESULT_SCHEMA,
    ok: true,
    status: "recovered",
    deployment: false,
    replayed,
    taskAuthorityReceipt,
    branch,
    pullRequestUrl: lease.pullRequestUrl,
    headSha,
    lease,
    recovery: lease.expiredCommittedHeartbeatRecovery,
    mutationAuthorityReceipt,
  });
}

function reconcileRecoveredExpiredCommittedHeartbeat({
  repo,
  branch,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  verifyActiveCloudAuthority,
  assertMutationAuthority,
  run,
  log,
  now,
  taskAuthorityReceipt,
}) {
  const instant = now();
  const lease = leaseStore.read(branch);
  const recovery = lease?.expiredCommittedHeartbeatRecovery;
  if (
    !lease ||
    lease.status !== "active" ||
    lease.sessionId !== sessionId ||
    lease.branch !== branch ||
    !recovery ||
    Date.parse(lease.expiresAt) <= instant.getTime()
  ) {
    throw new Error(
      "Expired committed recovery replay requires its exact live recovered lease.",
    );
  }
  assertLeaseWorktree(lease, repo);
  const identity = parseDeviceBranch(branch);
  if (
    !identity ||
    identity.device !== lease.device ||
    identity.scope !== lease.scope
  ) {
    throw new Error(
      "Expired committed recovery replay branch identity drifted from its lease.",
    );
  }
  requireCloudAdmission({ lease, instant });
  requireClean({ gitText });
  const expectedRemoteHeadSha = recovery.schema ===
    EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA
    ? recovery.sourceRemoteHeadSha
    : lease.fenceSha;
  const remoteHeadSha = remoteBranchHead({ branch, gitOptional });
  const projection = readPullRequestProjection({
    lease,
    branch,
    ghText,
    expectedHeadSha: expectedRemoteHeadSha,
  });
  if (remoteHeadSha !== expectedRemoteHeadSha) {
    throw new Error(
      "Expired committed recovery replay requires its exact stored remote and pull-request head.",
    );
  }
  const descendant = captureCommittedDescendantEvidence({
    lease,
    gitText,
    bindProtectedMain:
      recovery.schema !==
      LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
    bindPublishedPrefix:
      recovery.schema === EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
    sourceRemoteHeadSha: expectedRemoteHeadSha,
  });
  requireRecoveredEvidenceMatchesCurrent({ lease, recovery, descendant });

  const verified = verifyActiveCloudAuthority({
    authority: lease.cloudAuthority,
    manifest: {
      declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: lease.admission.writeSetDigest,
    },
    canonicalBaseSha: lease.baseSha,
  });
  if (digestValue(verified?.authority) !== digestValue(lease.cloudAuthority)) {
    throw new Error(
      "Expired committed recovery replay cloud authority drifted from its local receipt.",
    );
  }
  const mutationAuthorityReceipt = assertMutationAuthority({
    lease,
    cloudAuthority: lease.cloudAuthority,
    remoteAuthorityVerification: verified.verification,
  });
  assertRecoveredLocalState({
    snapshot: { ...descendant, remoteHeadSha },
    lease,
    branch,
    gitText,
    gitOptional,
    leaseStore,
  });

  const currentMarkerDigest = digestValue(
    projectWriterLeasePullRequestMarker(lease),
  );
  if (projection.markerDigest !== currentMarkerDigest) {
    if (
      projection.markerDigest !== recovery.sourceMarkerDigest ||
      projection.bodyDigest !== recovery.pullRequestBodyDigest
    ) {
      throw new Error(
        "Expired committed recovery replay found an unrelated PR-marker projection.",
      );
    }
    const renewedBody = updateWriterLeasePullRequestBody(
      projection.pullRequest.body,
      lease,
    );
    run("gh", [
      "pr",
      "edit",
      lease.pullRequestUrl,
      "--body",
      renewedBody,
    ]);
    const projected = readExactPullRequestProjection({
      lease,
      branch,
      ghText,
      expectedBody: renewedBody,
      expectedHeadSha: expectedRemoteHeadSha,
    });
    if (projected.markerDigest !== currentMarkerDigest) {
      throw new Error(
        "Expired committed recovery replay did not confirm the recovered marker.",
      );
    }
  }
  assertRecoveredLocalState({
    snapshot: { ...descendant, remoteHeadSha },
    lease,
    branch,
    gitText,
    gitOptional,
    leaseStore,
  });
  log(
    `Reconciled recovered ${lease.scope} lease ${lease.epoch}; committed descendant remains locally preserved.`,
  );
  return recoveryResult({
    branch,
    lease,
    headSha: descendant.headSha,
    mutationAuthorityReceipt,
    replayed: true,
    taskAuthorityReceipt,
  });
}

function requireRecoveredEvidenceMatchesCurrent({
  lease,
  recovery,
  descendant,
}) {
  const commonDrift = (
    recovery.sourceEpoch !== lease.epoch ||
    recovery.sourceSessionId !== lease.sessionId ||
    recovery.sourceDevice !== lease.device ||
    recovery.sourceScope !== lease.scope ||
    recovery.sourceBranch !== lease.branch ||
    recovery.sourceBaseSha !== lease.baseSha ||
    recovery.sourceFenceSha !== lease.fenceSha ||
    recovery.sourcePullRequestUrl !== lease.pullRequestUrl ||
    recovery.sourceClaimId !== lease.cloudAuthority?.claimId ||
    recovery.renewedClaimDigest !== lease.cloudAuthority?.claimDigest ||
    recovery.renewedLedgerRevision !== lease.cloudAuthority?.ledgerRevision ||
    recovery.renewedClaimLedgerRevision !==
      lease.cloudAuthority?.claimLedgerRevision ||
    recovery.renewedCloudTransitionCounter !==
      lease.cloudAuthority?.transitionCounter ||
    recovery.recoveredAt !== lease.heartbeatAt ||
    recovery.headSha !== descendant.headSha ||
    recovery.treeSha !== descendant.treeSha ||
    recovery.changedPathCount !== descendant.changedPaths.length ||
    recovery.changedPathsDigest !== digestValue(descendant.changedPaths) ||
    recovery.rangeDiffDigest !== descendant.rangeDiffDigest
  );
  const protectedMainDrift = (
    recovery.schema !==
      LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA &&
    (
      recovery.declaredChangedPathCount !==
        descendant.declaredChangedPaths.length ||
      recovery.declaredChangedPathsDigest !==
        digestValue(descendant.declaredChangedPaths) ||
      recovery.protectedEquivalentPathCount !==
        descendant.protectedEquivalentPaths.length ||
      recovery.protectedEquivalentPathsDigest !==
        digestValue(descendant.protectedEquivalentPaths) ||
      recovery.protectedMainEquivalenceDigest !==
        descendant.protectedMainEquivalenceDigest ||
      digestValue(recovery.protectedMainEquivalence) !==
        descendant.protectedMainEquivalenceDigest
    )
  );
  const pushedPrefixDrift = (
    recovery.schema === EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA && (
      recovery.sourceRemoteHeadSha !== descendant.sourceRemoteHeadSha ||
      recovery.sourceRemoteTreeSha !==
        descendant.sourceRemotePrefix?.treeSha ||
      recovery.sourceRemoteChangedPathCount !==
        descendant.sourceRemotePrefix?.changedPaths.length ||
      recovery.sourceRemoteChangedPathsDigest !== digestValue(
        descendant.sourceRemotePrefix?.changedPaths,
      ) ||
      recovery.sourceRemoteDeclaredChangedPathCount !==
        descendant.sourceRemotePrefix?.declaredChangedPaths.length ||
      recovery.sourceRemoteDeclaredChangedPathsDigest !== digestValue(
        descendant.sourceRemotePrefix?.declaredChangedPaths,
      ) ||
      recovery.sourceRemoteProtectedEquivalentPathCount !==
        descendant.sourceRemotePrefix?.protectedEquivalentPaths.length ||
      recovery.sourceRemoteProtectedEquivalentPathsDigest !== digestValue(
        descendant.sourceRemotePrefix?.protectedEquivalentPaths,
      ) ||
      recovery.sourceRemoteSharedAncestorEquivalenceDigest !==
        descendant.sourceRemotePrefix?.sharedAncestorEquivalenceDigest ||
      digestValue(recovery.sourceRemoteSharedAncestorEquivalence) !==
        descendant.sourceRemotePrefix?.sharedAncestorEquivalenceDigest ||
      recovery.sourceRemoteRangeDiffDigest !==
        descendant.sourceRemotePrefix?.rangeDiffDigest
    )
  );
  const unsupportedProtectedSchema = (
    recovery.schema !== LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA &&
    recovery.schema !==
      PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA &&
    recovery.schema !== EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA
  );
  if (
    commonDrift ||
    protectedMainDrift ||
    pushedPrefixDrift ||
    unsupportedProtectedSchema
  ) {
    throw new Error(
      "Expired committed recovery replay evidence changed from its exact recovered subject.",
    );
  }
}

function assertRecoveredLocalState({
  snapshot,
  lease,
  branch,
  gitText,
  gitOptional,
  leaseStore,
}) {
  const current = leaseStore.read(branch);
  requireClean({ gitText });
  if (
    JSON.stringify(current) !== JSON.stringify(lease) ||
    gitText(["branch", "--show-current"]).trim() !== branch ||
    gitText(["rev-parse", "HEAD"]).trim() !== snapshot.headSha ||
    gitText(["rev-parse", `${snapshot.headSha}^{tree}`]).trim() !==
      snapshot.treeSha ||
    remoteBranchHead({ branch, gitOptional }) !== snapshot.remoteHeadSha
  ) {
    throw new Error(
      "Recovered local lease or committed descendant drifted before PR projection.",
    );
  }
  if (snapshot.protectedMainEquivalence) {
    assertProtectedMainPathEquivalence({
      evidence: snapshot.protectedMainEquivalence,
      baseSha: lease.baseSha,
      headSha: snapshot.headSha,
      exemptPaths: snapshot.protectedEquivalentPaths ||
        snapshot.protectedMainEquivalence.entries.map(entry => entry.path),
      gitText,
    });
  }
  if (snapshot.sourceRemotePrefix) {
    const observedPrefix = captureSourceRemotePrefixEvidence({
      lease,
      sourceRemoteHeadSha: snapshot.remoteHeadSha,
      worktreeHeadSha: snapshot.headSha,
      gitText,
      bindProtectedMain: true,
    });
    if (digestValue(observedPrefix) !== digestValue(
      snapshot.sourceRemotePrefix,
    )) {
      throw new Error(
        "Recovered published remote prefix drifted before PR projection.",
      );
    }
  }
}
