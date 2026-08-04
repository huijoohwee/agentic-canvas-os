import { createHash } from "node:crypto";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import {
  assertLeaseWorktree,
  requireClean,
  requireRepositorySafety,
  requireSession,
} from "./device-branch-ownership-lib.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import {
  heartbeatAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  projectExpiredCommittedHeartbeatLease,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

export const EXPIRED_COMMITTED_HEARTBEAT_RESULT_SCHEMA =
  "agentic-expired-committed-heartbeat-result/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_CHANGED_PATHS = 128;
const MAX_CHANGED_PATH_BYTES = 16 * 1024;

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

  const renewed = heartbeatCloudAuthority({
    authority: before.lease.cloudAuthority,
    deviceId: before.lease.device,
    sessionId,
    ttlSeconds: Math.floor(leaseTtlMs / 1000),
  });
  assertSameCloudSubject({
    source: before.lease.cloudAuthority,
    renewed: renewed?.authority,
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
    renewedCloudAuthority: renewed.authority,
    recoveryEvidence: before.recoveryEvidence,
    ttlMs: leaseTtlMs,
    recoveredAt,
  });
  assertMutationAuthority({
    lease: projectedLease,
    cloudAuthority: renewed.authority,
    remoteAuthorityVerification: renewed.verification,
  });
  const lease = leaseStore.recoverExpiredCommittedHeartbeat({
    sessionId,
    branch,
    expectedLease: before.lease,
    renewedCloudAuthority: renewed.authority,
    recoveryEvidence: before.recoveryEvidence,
    ttlMs: leaseTtlMs,
    recoveredAt,
  });
  const mutationAuthorityReceipt = assertMutationAuthority({
    lease,
    cloudAuthority: renewed.authority,
    remoteAuthorityVerification: renewed.verification,
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
  requireActiveCloudAdmission({ lease, instant });
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
  const descendant = captureCommittedDescendantEvidence({ lease, gitText });
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
  if (
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
}

export function captureExpiredCommittedHeartbeatSnapshot({
  repo,
  branch,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  now = () => new Date(),
}) {
  const instant = now();
  const lease = leaseStore.read(branch);
  if (
    !lease ||
    lease.status !== "active" ||
    lease.sessionId !== sessionId ||
    lease.branch !== branch
  ) {
    throw new Error("Expired committed recovery requires its exact active session lease.");
  }
  assertLeaseWorktree(lease, repo);
  const identity = parseDeviceBranch(branch);
  if (
    !identity ||
    identity.device !== lease.device ||
    identity.scope !== lease.scope
  ) {
    throw new Error("Expired committed recovery branch identity drifted from its lease.");
  }
  if (Date.parse(lease.expiresAt) > instant.getTime()) {
    throw new Error("Expired committed recovery requires an expired local writer lease.");
  }
  requireActiveCloudAdmission({ lease, instant });
  if (gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) {
    throw new Error("Expired committed recovery requires a clean worktree.");
  }

  const projection = readExactPullRequestProjection({ lease, branch, ghText });
  const remoteHeadSha = remoteBranchHead({ branch, gitOptional });
  if (
    remoteHeadSha !== lease.fenceSha ||
    projection.pullRequest.headRefOid !== lease.fenceSha
  ) {
    throw new Error(
      "Expired committed recovery requires the exact remote and pull-request fence.",
    );
  }
  const {
    headSha,
    treeSha,
    changedPaths,
    rangeDiffDigest,
  } = captureCommittedDescendantEvidence({ lease, gitText });
  const sourceLeaseDigest = digestValue(lease);
  const snapshot = {
    schema: "agentic-expired-committed-heartbeat-snapshot/v1",
    branch,
    sourceLeaseDigest,
    sourceMarkerDigest: projection.markerDigest,
    pullRequestBodyDigest: projection.bodyDigest,
    remoteHeadSha,
    pullRequestHeadSha: projection.pullRequest.headRefOid,
    headSha,
    treeSha,
    changedPaths,
    rangeDiffDigest,
  };
  const snapshotDigest = digestValue(snapshot);
  return Object.freeze({
    ...snapshot,
    snapshotDigest,
    lease,
    recoveryEvidence: Object.freeze({
      sourceEpoch: lease.epoch,
      sourceSessionId: lease.sessionId,
      sourceDevice: lease.device,
      sourceScope: lease.scope,
      sourceBranch: lease.branch,
      sourceBaseSha: lease.baseSha,
      sourceFenceSha: lease.fenceSha,
      sourcePullRequestUrl: lease.pullRequestUrl,
      sourceClaimId: lease.cloudAuthority.claimId,
      sourceClaimDigest: lease.cloudAuthority.claimDigest,
      sourceLedgerRevision: lease.cloudAuthority.ledgerRevision,
      sourceClaimLedgerRevision: lease.cloudAuthority.claimLedgerRevision,
      sourceCloudTransitionCounter:
        lease.cloudAuthority.transitionCounter,
      headSha,
      treeSha,
      changedPathCount: changedPaths.length,
      changedPathsDigest: digestValue(changedPaths),
      sourceMarkerDigest: projection.markerDigest,
      pullRequestBodyDigest: projection.bodyDigest,
      rangeDiffDigest,
    }),
  });
}

function captureCommittedDescendantEvidence({ lease, gitText }) {
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (!SHA_PATTERN.test(headSha) || headSha === lease.fenceSha) {
    throw new Error(
      "Expired committed recovery requires a strict committed descendant of the fence.",
    );
  }
  const fenceParents = gitText([
    "rev-list",
    "--parents",
    "-n",
    "1",
    lease.fenceSha,
  ]).trim().split(/\s+/);
  if (
    fenceParents.length !== 2 ||
    fenceParents[0] !== lease.fenceSha ||
    fenceParents[1] !== lease.baseSha
  ) {
    throw new Error(
      "Expired committed recovery requires the exact single-parent fence over its source base.",
    );
  }
  gitText(["merge-base", "--is-ancestor", lease.fenceSha, headSha]);
  const treeSha = gitText(["rev-parse", `${headSha}^{tree}`]).trim();
  if (!SHA_PATTERN.test(treeSha)) {
    throw new Error("Expired committed recovery could not resolve the descendant tree.");
  }
  const changedPaths = uniqueSorted(splitNul(gitText([
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    lease.fenceSha,
    headSha,
    "--",
  ])));
  if (!changedPaths.length) {
    throw new Error("Expired committed recovery found no committed path changes.");
  }
  requireBoundedChangedPaths(changedPaths);
  requireChangedPathsWithinScope({
    changedPaths,
    declaredWriteSet: lease.admission.declaredWriteSet,
  });
  const rangeDiffDigest = sha256(gitText([
    "diff",
    "--binary",
    "--no-renames",
    lease.fenceSha,
    headSha,
    "--",
  ]));
  return { headSha, treeSha, changedPaths, rangeDiffDigest };
}

function requireBoundedChangedPaths(changedPaths) {
  const encodedBytes = Buffer.byteLength(changedPaths.join("\0"), "utf8");
  if (
    changedPaths.length > MAX_CHANGED_PATHS ||
    encodedBytes > MAX_CHANGED_PATH_BYTES
  ) {
    throw new Error(
      `Expired committed recovery changed-path evidence exceeds ${MAX_CHANGED_PATHS} paths or ${MAX_CHANGED_PATH_BYTES} bytes.`,
    );
  }
}

export function requireChangedPathsWithinScope({
  changedPaths,
  declaredWriteSet,
}) {
  const declaredPaths = normalizeWriteSet(declaredWriteSet)
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length));
  if (!declaredPaths.length) {
    throw new Error("Expired committed recovery has no declared path authority.");
  }
  for (const changedPath of changedPaths) {
    if (
      typeof changedPath !== "string" ||
      changedPath.includes("\\") ||
      changedPath.startsWith("/")
    ) {
      throw new Error(
        `Expired committed recovery path is unsafe: ${changedPath}`,
      );
    }
    const normalized = normalizeWriteSet([`path:${changedPath}`])[0]
      .slice("path:".length);
    const authorized = declaredPaths.some(declared => (
      declared === "." ||
      normalized === declared ||
      normalized.startsWith(`${declared}/`)
    ));
    if (!authorized) {
      throw new Error(
        `Expired committed recovery path is outside declared write scope: ${changedPath}`,
      );
    }
  }
}

function requireActiveCloudAdmission({ lease, instant }) {
  const authority = lease.cloudAuthority;
  const declaredWriteSet = normalizeWriteSet(
    lease.admission?.declaredWriteSet || [],
  );
  if (
    lease.admission?.schema !== "agentic-lane-admission-lease/v1" ||
    lease.admission.status !== "admitted" ||
    authority?.schema !== "agentic-lane-cloud-authority/v1" ||
    authority.state !== "active" ||
    authority.deviceId !== lease.device ||
    authority.sessionId !== lease.sessionId ||
    authority.canonicalBaseSha !== lease.baseSha ||
    authority.laneRevision !== lease.fenceSha ||
    authority.writeSetDigest !== lease.admission.writeSetDigest ||
    !Number.isFinite(Date.parse(authority.expiresAt)) ||
    Date.parse(authority.expiresAt) <= instant.getTime() ||
    digestValue(declaredWriteSet) !== lease.admission.writeSetDigest ||
    JSON.stringify(authority.cloudDeclaredWriteScope) !==
      JSON.stringify(declaredWriteSet)
  ) {
    throw new Error(
      "Expired committed recovery requires its exact live admitted cloud claim.",
    );
  }
}

function readExactPullRequestProjection({
  lease,
  branch,
  ghText,
  expectedBody = null,
}) {
  const projection = readPullRequestProjection({
    lease,
    branch,
    ghText,
    expectedBody,
  });
  const expectedMarker = projectWriterLeasePullRequestMarker(lease);
  if (projection.markerDigest !== digestValue(expectedMarker)) {
    throw new Error(
      "Expired committed recovery pull-request marker differs from the local lease.",
    );
  }
  return projection;
}

function readPullRequestProjection({
  lease,
  branch,
  ghText,
  expectedBody = null,
}) {
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch,
    ghText,
  });
  const expectedRepository = repositoryFromPullRequestUrl(lease.pullRequestUrl);
  if (
    pullRequest.isDraft !== true ||
    pullRequest.headRefOid !== lease.fenceSha ||
    pullRequest.headRepository?.nameWithOwner !== expectedRepository ||
    (expectedBody !== null && pullRequest.body !== expectedBody)
  ) {
    throw new Error(
      "Expired committed recovery requires the exact open draft ownership pull request.",
    );
  }
  const marker = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!marker) {
    throw new Error(
      "Expired committed recovery pull request has no valid lease marker.",
    );
  }
  return Object.freeze({
    pullRequest,
    markerDigest: digestValue(marker),
    bodyDigest: sha256(pullRequest.body),
  });
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
    renewed.transitionCounter <= source.transitionCounter ||
    Date.parse(renewed.expiresAt) <= now.getTime()
  ) {
    throw new Error("Cloud heartbeat changed the expired lease claim subject.");
  }
}

function remoteBranchHead({ branch, gitOptional }) {
  const line = gitOptional([
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  const sha = line.split(/\s+/)[0] || "";
  if (!SHA_PATTERN.test(sha)) {
    throw new Error("Expired committed recovery could not resolve its remote branch.");
  }
  return sha;
}

function repositoryFromPullRequestUrl(url) {
  const match = String(url || "").match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/[1-9]\d*(?:[/?#]|$)/,
  );
  if (!match) {
    throw new Error("Expired committed recovery requires an exact GitHub pull-request URL.");
  }
  return match[1];
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}
