import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertLeaseWorktree,
  requireClean,
  requireRepositorySafety,
  requireSession,
} from "./device-branch-ownership-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import {
  heartbeatAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  captureCommittedDescendantEvidence,
  captureExpiredCommittedHeartbeatSnapshot,
  readExactPullRequestProjection,
  readPullRequestProjection,
  remoteBranchHead,
  requireCloudAdmission,
  requireChangedPathsWithinScope,
} from "./expired-committed-heartbeat-evidence.mjs";
import {
  assertProtectedMainPathEquivalence,
  fetchProtectedMain,
} from "./protected-main-path-equivalence-lib.mjs";
import {
  LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  parseDeviceBranch,
  projectExpiredCommittedHeartbeatLease,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

export const EXPIRED_COMMITTED_HEARTBEAT_RESULT_SCHEMA =
  "agentic-expired-committed-heartbeat-result/v1";

export {
  captureExpiredCommittedHeartbeatSnapshot,
  requireChangedPathsWithinScope,
};

export function recoverExpiredCommittedHeartbeat({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  heartbeatCloudAuthority = heartbeatAdmissionCloudAuthority,
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
    deviceId: before.lease.device,
    sessionId,
    ttlSeconds: Math.floor(leaseTtlMs / 1000),
  });
  const renewedAuthority = reconcileHeartbeatManifestProjection({
    source: before.lease.cloudAuthority,
    renewed: heartbeat?.authority,
    admittedManifestDigest: before.lease.admission.manifestDigest,
  });
  assertSameCloudSubject({
    source: before.lease.cloudAuthority,
    renewed: renewedAuthority,
    lease: before.lease,
    now: now(),
  });

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
  });
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
    `Recovered expired ${lease.scope} lease ${lease.epoch} until ${lease.expiresAt}; committed descendant remains unpushed.`,
  );
  return recoveryResult({
    branch,
    lease,
    headSha: before.headSha,
    mutationAuthorityReceipt,
    replayed: false,
  });
}

export function reconcileHeartbeatManifestProjection({
  source,
  renewed,
  admittedManifestDigest,
}) {
  if (renewed?.manifestDigest === source?.manifestDigest) {
    return renewed;
  }
  const transportManifestDigest = digestValue({
    declaredWriteSet: renewed?.cloudDeclaredWriteScope,
    writeSetDigest: renewed?.writeSetDigest,
  });
  if (renewed?.manifestDigest !== transportManifestDigest) {
    return renewed;
  }
  return Object.freeze({
    ...renewed,
    manifestDigest: admittedManifestDigest,
  });
}

function recoveryResult({
  branch,
  lease,
  headSha,
  mutationAuthorityReceipt,
  replayed,
}) {
  return Object.freeze({
    schema: EXPIRED_COMMITTED_HEARTBEAT_RESULT_SCHEMA,
    ok: true,
    status: "recovered",
    deployment: false,
    replayed,
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
  const remoteHeadSha = remoteBranchHead({ branch, gitOptional });
  const projection = readPullRequestProjection({ lease, branch, ghText });
  if (
    remoteHeadSha !== lease.fenceSha ||
    projection.pullRequest.headRefOid !== lease.fenceSha
  ) {
    throw new Error(
      "Expired committed recovery replay requires the exact remote and pull-request fence.",
    );
  }
  const descendant = captureCommittedDescendantEvidence({
    lease,
    gitText,
    bindProtectedMain:
      recovery.schema !==
      LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
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
    `Reconciled recovered ${lease.scope} lease ${lease.epoch}; committed descendant remains unpushed.`,
  );
  return recoveryResult({
    branch,
    lease,
    headSha: descendant.headSha,
    mutationAuthorityReceipt,
    replayed: true,
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
  if (commonDrift || protectedMainDrift) {
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
}

function assertSameCloudSubject({ source, renewed, lease, now }) {
  const immutableFields = [
    "schema",
    "provider",
    "ledgerRepository",
    "targetRepository",
    "claimId",
    "canonicalBaseSha",
    "laneRevision",
    "writeSetDigest",
    "deviceId",
    "sessionId",
    "reviewRequestId",
    "leaseEpoch",
    "state",
    "manifestDigest",
  ];
  if (
    !renewed ||
    immutableFields.some(field => renewed[field] !== source[field]) ||
    JSON.stringify(renewed.cloudDeclaredWriteScope) !==
      JSON.stringify(source.cloudDeclaredWriteScope) ||
    renewed.state !== "active" ||
    renewed.laneRevision !== lease.fenceSha ||
    renewed.transitionCounter !== source.transitionCounter + 1 ||
    Date.parse(renewed.expiresAt) <= now.getTime()
  ) {
    throw new Error("Cloud heartbeat changed the expired lease claim subject.");
  }
}
