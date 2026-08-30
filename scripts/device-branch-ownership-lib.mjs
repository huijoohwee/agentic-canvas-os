// Responsibility: Enforce exact device-branch ownership, heartbeat, PR, and protected-main projections.
import { createHash } from "node:crypto";
import path from "node:path";
import { digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { assertActivePublishPathsAdmitted } from "./active-publish-write-scope.mjs";
import {
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
} from "./repository-guards.mjs";
import { updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import {
  readOwnershipPullRequest,
  requireOwnershipPullRequestDraft,
} from "./device-pull-request-state.mjs";
import { captureOwnedDirtEvidence } from "./owned-dirt-resume-lib.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { assertTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";
import { assertActiveDraftMutationAuthority, reconcileLostCloudHeartbeat,
  requireExactDraftHeartbeatMarker, verifiedHeartbeatAuthority }
  from "./active-owned-dirt-recovery-registry.mjs";
import {
  assertHeartbeatMutationIntentFence,
  casWriterLeaseProjection,
  heartbeatWriterLeaseProjection,
  withHeartbeatProjectionFence,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

export function heartbeat({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  repairPullRequestProjection = false,
  heartbeatCloudAuthority = null,
  inspectCloudStatus = invokeRepositoryCloudAction,
  verifyActiveCloudAuthority = null,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  // Renewal must not assert the liveness it exists to restore. Expiry is the
  // condition this command repairs, so asserting it here made a routine lapse
  // permanent: the lease could not be renewed because it needed renewing. Every
  // ownership check still binds -- session, branch, epoch mutability, task
  // authority, worktree, remote fence, and draft pull request -- and the store's
  // own heartbeat already reads with allowExpired for the same reason.
  let current = leaseStore.verify({ sessionId, branch, allowExpired: true });
  assertLeaseWorktree(current, repo);
  let observedRemoteSha = null;
  if (!repairPullRequestProjection) {
    const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    observedRemoteSha = remoteLine.split(/\s+/)[0] || "";
    if (!current.fenceSha || (
      observedRemoteSha !== current.fenceSha
      && observedRemoteSha !== current.integration?.commitSha
    )) throw remoteFenceStaleError({ branch, lease: current, remoteSha: observedRemoteSha });
  }
  if (!current.pullRequestUrl || !current.fenceSha) {
    throw new Error("Writer lease is missing its draft pull request or fencing SHA.");
  }
  if (repairPullRequestProjection) {
    current = repairOwnershipPullRequestProjection({
      branch,
      lease: current,
      leaseStore,
      sessionId,
      gitText,
      gitOptional,
      ghText,
      run,
      now,
    });
  }
  const pullRequest = requireOwnershipPullRequestDraft({
    url: current.pullRequestUrl, branch, ghText, expectedDraft: true,
  });
  if (!repairPullRequestProjection) {
    requireRemoteFence({
      branch, lease: current, pullRequest, gitText, gitOptional,
      remoteSha: observedRemoteSha,
    });
  }
  let activeDraftPullRequest = null;
  let cloudExpiryCap = null;
  let cloudVerification = null;
  let mutationAuthorityReceipt = null;
  let expectedLeaseDigest = writerLeaseDigest(current);
  let expectedClaimId = current.cloudAuthority?.claimId || null;
  if (current.cloudAuthority) {
    if (typeof heartbeatCloudAuthority !== "function") {
      throw new Error("Cloud-authoritative heartbeat requires the repository cloud heartbeat adapter.");
    }
    if (typeof verifyActiveCloudAuthority !== "function") {
      throw new Error("Cloud-authoritative heartbeat requires the repository cloud verifier.");
    }
    assertHeartbeatMutationIntentFence({
      leaseStore,
      branch,
      expectedLeaseDigest,
      expectedClaimId,
    });
    if (!current.cloudAuthority.reviewRequestId) {
      activeDraftPullRequest = readActiveOwnedDirtRecoveryPullRequest({
        url: current.pullRequestUrl, branch,
        targetRepository: current.cloudAuthority.targetRepository, ghText,
      });
      requireExactDraftHeartbeatMarker({ lease: current, pullRequest: activeDraftPullRequest });
    }
    let renewed = typeof leaseStore?.withRegistryLock === "function" && leaseStore.statePath
      ? reconcileLostCloudHeartbeat({
        current, branch, inspectCloudStatus, verifyActiveCloudAuthority, now,
      }) : null;
    if (!renewed) renewed = heartbeatCloudAuthority({
      authority: current.cloudAuthority, deviceId: current.device, sessionId,
      ttlSeconds: Math.floor(leaseTtlMs / 1000),
    });
    const renewedAuthority = verifiedHeartbeatAuthority(renewed);
    mutationAuthorityReceipt = assertActiveDraftMutationAuthority({
      lease: { ...current, cloudAuthority: renewedAuthority },
      cloudAuthority: renewedAuthority,
      remoteAuthorityVerification: renewed.verification,
      pullRequest: activeDraftPullRequest,
    });
    current = casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest,
      expectedClaimId,
      requireNoActiveIntent: true,
      values: { cloudAuthority: renewedAuthority },
    }).lease;
    expectedLeaseDigest = writerLeaseDigest(current);
    expectedClaimId = renewedAuthority.claimId;
    cloudExpiryCap = renewedAuthority.expiresAt;
    cloudVerification = renewed.verification;
  }
  let lease = current.cloudAuthority
    ? heartbeatWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest,
      expectedClaimId,
      ttlMs: leaseTtlMs,
      expiresAtCap: cloudExpiryCap,
      now,
    })
    : leaseStore.heartbeat({
      sessionId,
      branch,
      ttlMs: leaseTtlMs,
      expiresAtCap: cloudExpiryCap,
    });
  if (lease.cloudAuthority) {
    expectedLeaseDigest = writerLeaseDigest(lease);
    expectedClaimId = lease.cloudAuthority.claimId;
  }
  if (cloudVerification) {
    const immediate = verifyActiveCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: {
        declaredWriteSet: lease.cloudAuthority.cloudDeclaredWriteScope,
        writeSetDigest: lease.cloudAuthority.writeSetDigest,
      },
      canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha,
    });
    const finalAuthority = verifiedHeartbeatAuthority(immediate);
    mutationAuthorityReceipt = assertActiveDraftMutationAuthority({
      lease: { ...lease, cloudAuthority: finalAuthority },
      cloudAuthority: finalAuthority,
      remoteAuthorityVerification: immediate.verification,
      pullRequest: activeDraftPullRequest,
    });
    lease = casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest,
      expectedClaimId,
      requireNoActiveIntent: true,
      values: { cloudAuthority: finalAuthority },
    }).lease;
    expectedLeaseDigest = writerLeaseDigest(lease);
    expectedClaimId = immediate.authority.claimId;
  }
  if (lease.cloudAuthority) {
    withHeartbeatProjectionFence({
      leaseStore,
      branch,
      expectedLeaseDigest,
      expectedClaimId,
      action: () => run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
        pullRequest.body,
        lease,
      )]),
    });
  } else {
    run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
      pullRequest.body,
      lease,
    )]);
  }
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
  if (!lease.cloudAuthority?.reviewRequestId) requireExactDraftHeartbeatMarker({
    lease, pullRequest: readActiveOwnedDirtRecoveryPullRequest({
      url: lease.pullRequestUrl, branch,
      targetRepository: lease.cloudAuthority.targetRepository, ghText,
    }),
  });
  log(`Renewed ${lease.scope} lease ${lease.epoch} until ${lease.expiresAt}.`);
  return mutationAuthorityReceipt
    ? Object.freeze({ ...lease, mutationAuthorityReceipt })
    : lease;
}

export function repairOwnershipPullRequestProjection({
  branch,
  lease,
  leaseStore,
  sessionId,
  gitText,
  gitOptional,
  ghText,
  run,
  now = () => new Date(),
}) {
  const expectedHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  requireProjectionRepairHead({ lease, expectedHeadSha, gitText });
  requireExactRemoteHead({ branch, expectedHeadSha, gitOptional });
  requireNoCompetingPullRequest({ branch, ghText });
  const dirtEvidence = gitText(["status", "--porcelain"]).trim()
    ? captureOwnedDirtEvidence({ gitText, gitOptional })
    : null;
  const existing = normalizePullRequestProjectionRepair(lease.pullRequestProjectionRepair);
  const sourceUrl = existing?.sourcePullRequestUrl || lease.pullRequestUrl;
  let source = readOwnershipPullRequest({
    url: sourceUrl,
    branch,
    ghText,
    requireOpen: false,
  });
  let repair = existing;
  if (!repair) {
    if (source.state !== "OPEN" || source.isDraft !== true) {
      throw new Error("Pull-request projection repair requires the exact open draft ownership pull request.");
    }
    if (source.headRefOid === expectedHeadSha) {
      throw new Error("Pull-request projection already matches the active writer fence.");
    }
    gitText(["merge-base", "--is-ancestor", source.headRefOid, expectedHeadSha]);
    repair = createPullRequestProjectionRepair({
      lease,
      sourceUrl,
      staleHeadSha: source.headRefOid,
      expectedHeadSha,
      dirtEvidence,
      now,
    });
    lease = leaseStore.annotate({
      sessionId,
      branch,
      values: { pullRequestProjectionRepair: repair },
    });
    run("gh", ["pr", "close", sourceUrl]);
    run("gh", ["pr", "reopen", sourceUrl]);
    source = readOwnershipPullRequest({
      url: sourceUrl,
      branch,
      ghText,
      requireOpen: false,
    });
  } else {
    requireMatchingPullRequestProjectionRepair({
      repair,
      lease,
      expectedHeadSha,
      dirtEvidence,
    });
  }

  let target = source;
  let targetUrl = sourceUrl;
  let outcome = "reopened";
  if (source.state !== "OPEN" || source.headRefOid !== expectedHeadSha) {
    if (source.state === "OPEN") run("gh", ["pr", "close", sourceUrl]);
    const candidates = JSON.parse(ghText([
      "pr", "list", "--state", "open", "--base", "main", "--head", branch,
      "--limit", "10", "--json", "url,headRefName,headRefOid,isDraft",
    ]));
    if (candidates.length > 1) {
      throw new Error("Pull-request projection repair found multiple replacement candidates.");
    }
    if (candidates.length === 1) {
      targetUrl = candidates[0].url;
    } else {
      targetUrl = String(ghText([
        "pr", "create", "--draft", "--base", "main", "--head", branch,
        "--title", gitText(["log", "-1", "--pretty=%s"]).trim(),
        "--body", updateWriterLeasePullRequestBody("", lease),
      ])).trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    }
    if (!targetUrl || targetUrl === sourceUrl) {
      throw new Error("Pull-request projection repair did not create a distinct replacement pull request.");
    }
    target = requireOwnershipPullRequestDraft({
      url: targetUrl,
      branch,
      ghText,
      expectedDraft: true,
    });
    outcome = "replaced";
  }
  if (target.state !== "OPEN" || target.isDraft !== true || target.headRefOid !== expectedHeadSha) {
    throw new Error("Pull-request projection repair could not prove an exact open draft replacement.");
  }
  verifyPullRequestRepositoryIdentity({ pullRequest: target, url: targetUrl });
  requireSameRepairDirt({ repair, dirtEvidence });
  const completedRepair = finalizePullRequestProjectionRepair({
    repair,
    targetPullRequestUrl: targetUrl,
    outcome,
    now,
  });
  const repairedLease = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      pullRequestUrl: targetUrl,
      pullRequestProjectionRepair: completedRepair,
    },
  });
  run("gh", ["pr", "edit", targetUrl, "--body", updateWriterLeasePullRequestBody(
    target.body,
    repairedLease,
  )]);
  const verified = requireOwnershipPullRequestDraft({
    url: targetUrl,
    branch,
    ghText,
    expectedDraft: true,
  });
  if (verified.headRefOid !== expectedHeadSha) {
    throw new Error("Pull-request projection changed after its repaired lease marker was published.");
  }
  requireSameRepairDirt({ repair: completedRepair, dirtEvidence: gitText(["status", "--porcelain"]).trim()
    ? captureOwnedDirtEvidence({ gitText, gitOptional })
    : null });
  return repairedLease;
}

export function requireRepositorySafety({ invocationPath, repo, gitText }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) {
    throw new Error(`Repository commands must start at the registered worktree root ${repo}; received ${invocationPath}`);
  }
  const worktree = assertRegisteredWorktree({
    cwd: repo,
    porcelain: gitText(["worktree", "list", "--porcelain", "-z"]),
  });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
  return worktree;
}

export function assertLeaseWorktree(lease, repo) {
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Writer lease owns worktree ${lease.worktreePath}, not ${repo}.`);
  }
}

function requireRemoteFence({ branch, lease, pullRequest, gitText, gitOptional, remoteSha = null }) {
  if (remoteSha === null) {
    const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    remoteSha = remoteLine.split(/\s+/)[0] || "";
  }
  if (lease.fenceSha && remoteSha === lease.fenceSha) return;
  assertPreparedIntegrationRemoteFence({ branch, lease, pullRequest, remoteSha, gitText });
}

export function assertPreparedIntegrationRemoteFence({
  branch,
  lease,
  pullRequest,
  remoteSha,
  gitText,
}) {
  const stale = () => remoteFenceStaleError({ branch, lease, remoteSha });
  const integration = lease?.integration;
  const integrationKeys = [
    "commitMessage", "commitSha", "manifestDigest", "paths", "recordedAt", "schema",
    "stagedDiffDigest", "treeSha",
  ];
  if (
    typeof gitText !== "function"
    || lease?.schema !== "agentic-writer-lease/v2"
    || lease.status !== "active"
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || integration?.schema !== "agentic-integration-commit/v1"
    || JSON.stringify(Object.keys(integration).sort()) !== JSON.stringify(integrationKeys)
    || !SHA_PATTERN.test(String(integration.commitSha || ""))
    || !SHA_PATTERN.test(String(integration.treeSha || ""))
    || remoteSha !== integration.commitSha
    || !isDigest(integration.manifestDigest)
    || !isDigest(integration.stagedDiffDigest)
    || typeof integration.commitMessage !== "string"
    || !integration.commitMessage.trim()
    || integration.commitMessage.includes("\n")
    || !isCanonicalInstant(integration.recordedAt)
  ) throw stale();

  let admittedPaths;
  try {
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    admittedPaths = assertActivePublishPathsAdmitted({
      paths: integration.paths,
      admission: lease.admission,
    }).paths;
  } catch {
    throw stale();
  }
  if (JSON.stringify(integration.paths) !== JSON.stringify(admittedPaths)) throw stale();

  const authority = lease.cloudAuthority;
  const exactCloudIdentity = authority?.schema === "agentic-lane-cloud-authority/v1"
    && authority.provider === "github"
    && authority.state === "active"
    && authority.mutationAuthorityEligible === true
    && authority.canonicalBaseSha === lease.baseSha
    && authority.laneRevision === lease.fenceSha
    && authority.writeSetDigest === lease.admission.writeSetDigest
    && authority.manifestDigest === lease.admission.manifestDigest
    && JSON.stringify(authority.cloudDeclaredWriteScope)
      === JSON.stringify(lease.admission.declaredWriteSet)
    && authority.deviceId === lease.device
    && authority.sessionId === lease.sessionId
    && authority.reviewRequestId === `github-pull-request:${pullRequest?.id || ""}`
    && authority.integrationReceiptDigest === null
    && authority.integration === null
    && isDigest(authority.claimId)
    && isDigest(authority.claimDigest)
    && SHA_PATTERN.test(String(authority.ledgerRevision || ""))
    && isDigest(authority.ledgerDigest)
    && isDigest(authority.claimLedgerRevision)
    && isDigest(authority.operationReceiptDigest)
    && Number.isSafeInteger(authority.leaseEpoch)
    && authority.leaseEpoch > 0
    && Number.isSafeInteger(authority.transitionCounter)
    && authority.transitionCounter > 0
    && isCanonicalInstant(authority.expiresAt)
    && Date.parse(authority.expiresAt) >= Date.parse(lease.expiresAt);
  const exactPullRequestIdentity = pullRequest?.url === lease.pullRequestUrl
    && pullRequest.state === "OPEN"
    && pullRequest.isDraft === true
    && pullRequest.headRefName === branch
    && pullRequest.headRefOid === integration.commitSha
    && pullRequest.headRepository?.nameWithOwner === authority?.targetRepository
    && pullRequest.baseRefName === "main";
  if (!exactCloudIdentity || !exactPullRequestIdentity) throw stale();

  const localHead = gitText(["rev-parse", "HEAD"]).trim();
  const worktreeStatus = gitText(["status", "--porcelain", "--untracked-files=all"]);
  const lineage = gitText(["rev-list", "--parents", "-n", "1", integration.commitSha])
    .trim().split(/\s+/u);
  const treeSha = gitText(["rev-parse", `${integration.commitSha}^{tree}`]).trim();
  const commitMessage = gitText(["log", "-1", "--pretty=%s", integration.commitSha]).trim();
  const paths = splitNul(gitText([
    "diff", "--name-only", "-z", lease.fenceSha, integration.commitSha, "--",
  ]));
  const stagedDiffDigest = createHash("sha256").update(gitText([
    "diff", "--binary", lease.fenceSha, integration.commitSha, "--",
  ])).digest("hex");
  if (
    localHead !== integration.commitSha
    || worktreeStatus !== ""
    || lineage.length !== 2
    || lineage[0] !== integration.commitSha
    || lineage[1] !== lease.fenceSha
    || treeSha !== integration.treeSha
    || commitMessage !== integration.commitMessage
    || JSON.stringify(paths) !== JSON.stringify(integration.paths)
    || stagedDiffDigest !== integration.stagedDiffDigest
  ) throw stale();
  return Object.freeze({
    schema: "agentic-prepared-integration-remote-fence/v1",
    status: "accepted",
    branch,
    fenceSha: lease.fenceSha,
    integrationCommitSha: integration.commitSha,
    integrationTreeSha: integration.treeSha,
    manifestDigest: integration.manifestDigest,
    stagedDiffDigest: integration.stagedDiffDigest,
  });
}

function remoteFenceStaleError({ branch, lease, remoteSha }) {
  return new Error(
    `Remote fence for ${branch} is ${remoteSha || "missing"}, not ${lease?.fenceSha || "unclaimed"}; this session is stale.`,
  );
}

function isDigest(value) {
  return /^[0-9a-f]{64}$/u.test(String(value || ""));
}

function isCanonicalInstant(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function requireExactRemoteHead({ branch, expectedHeadSha, gitOptional }) {
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (!SHA_PATTERN.test(String(expectedHeadSha || "")) || remoteSha !== expectedHeadSha) {
    throw new Error(
      `Remote head for ${branch} is ${remoteSha || "missing"}, not ${expectedHeadSha || "unknown"}.`,
    );
  }
}

function requireProjectionRepairHead({ lease, expectedHeadSha, gitText }) {
  if (expectedHeadSha === lease.fenceSha) return;
  const integrationHead = lease.integration?.commitSha;
  if (!SHA_PATTERN.test(String(integrationHead || ""))) {
    throw new Error("Pull-request projection repair requires the active fence or recorded integration head.");
  }
  gitText(["merge-base", "--is-ancestor", lease.fenceSha, integrationHead]);
  if (expectedHeadSha === integrationHead) return;
  verifyProtectedMainRefreshChain({
    expectedHeadSha: integrationHead,
    observedHeadSha: expectedHeadSha,
    gitText,
  });
}

export function requireNoCompetingPullRequest({ branch, ghText }) {
  const pulls = JSON.parse(ghText(["pr", "list", "--state", "open", "--base", "main", "--limit", "100", "--json", "number,headRefName,url"]));
  assertNoCompetingPullRequests(pulls, branch);
}

const PULL_REQUEST_PROJECTION_REPAIR_SCHEMA = "agentic-pull-request-projection-repair/v1";
export const SHA_PATTERN = /^[0-9a-f]{40}$/;

function createPullRequestProjectionRepair({
  lease,
  sourceUrl,
  staleHeadSha,
  expectedHeadSha,
  dirtEvidence,
  now,
}) {
  if (!SHA_PATTERN.test(String(staleHeadSha || "")) ||
      !SHA_PATTERN.test(String(expectedHeadSha || ""))) {
    throw new Error("Pull-request projection repair requires exact stale and expected head SHAs.");
  }
  return {
    schema: PULL_REQUEST_PROJECTION_REPAIR_SCHEMA,
    status: "repairing",
    sourceEpoch: lease.epoch,
    sourcePullRequestUrl: sourceUrl,
    staleHeadSha,
    expectedHeadSha,
    dirtEvidenceDigest: dirtEvidence?.digest || null,
    dirtPathCount: dirtEvidence?.pathCount || 0,
    targetPullRequestUrl: null,
    outcome: null,
    startedAt: now().toISOString(),
    completedAt: null,
  };
}

function normalizePullRequestProjectionRepair(value) {
  if (value === null || value === undefined) return null;
  if (
    value?.schema !== PULL_REQUEST_PROJECTION_REPAIR_SCHEMA ||
    !["repairing", "completed"].includes(value.status) ||
    !Number.isInteger(value.sourceEpoch) ||
    value.sourceEpoch < 1 ||
    !String(value.sourcePullRequestUrl || "").includes("/pull/") ||
    !SHA_PATTERN.test(String(value.staleHeadSha || "")) ||
    !SHA_PATTERN.test(String(value.expectedHeadSha || "")) ||
    !Number.isInteger(value.dirtPathCount) ||
    value.dirtPathCount < 0 ||
    (value.dirtPathCount === 0) !== (value.dirtEvidenceDigest === null) ||
    (value.dirtEvidenceDigest !== null &&
      !/^[0-9a-f]{64}$/.test(String(value.dirtEvidenceDigest || ""))) ||
    !String(value.startedAt || "").trim()
  ) {
    throw new Error("Pull-request projection repair receipt is malformed.");
  }
  if (value.status === "completed" && (
    !String(value.targetPullRequestUrl || "").includes("/pull/") ||
    !["reopened", "replaced"].includes(value.outcome) ||
    !String(value.completedAt || "").trim()
  )) {
    throw new Error("Completed pull-request projection repair receipt is incomplete.");
  }
  return {
    schema: PULL_REQUEST_PROJECTION_REPAIR_SCHEMA,
    status: value.status,
    sourceEpoch: value.sourceEpoch,
    sourcePullRequestUrl: value.sourcePullRequestUrl,
    staleHeadSha: value.staleHeadSha,
    expectedHeadSha: value.expectedHeadSha,
    dirtEvidenceDigest: value.dirtEvidenceDigest,
    dirtPathCount: value.dirtPathCount,
    targetPullRequestUrl: value.targetPullRequestUrl || null,
    outcome: value.outcome || null,
    startedAt: value.startedAt,
    completedAt: value.completedAt || null,
  };
}

function requireMatchingPullRequestProjectionRepair({
  repair,
  lease,
  expectedHeadSha,
  dirtEvidence,
}) {
  if (
    repair.sourceEpoch !== lease.epoch ||
    repair.expectedHeadSha !== expectedHeadSha
  ) {
    throw new Error("Pull-request projection repair replay does not match the active lease fence.");
  }
  requireSameRepairDirt({ repair, dirtEvidence });
}

function requireSameRepairDirt({ repair, dirtEvidence }) {
  const digest = dirtEvidence?.digest || null;
  const pathCount = dirtEvidence?.pathCount || 0;
  if (repair.dirtEvidenceDigest !== digest || repair.dirtPathCount !== pathCount) {
    throw new Error("Pull-request projection repair dirt changed from its preserved evidence.");
  }
}

function finalizePullRequestProjectionRepair({
  repair,
  targetPullRequestUrl,
  outcome,
  now,
}) {
  return normalizePullRequestProjectionRepair({
    ...repair,
    status: "completed",
    targetPullRequestUrl,
    outcome,
    completedAt: now().toISOString(),
  });
}

function verifyPullRequestRepositoryIdentity({ pullRequest, url }) {
  const match = String(url || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+(?:[/?#]|$)/);
  const expected = match?.[1] || "";
  const observed = pullRequest.headRepository?.nameWithOwner || "";
  if (!expected || observed !== expected) {
    throw new Error("Pull-request projection repair crossed repository ownership.");
  }
}

export function requireClean({ gitText }) {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Working tree is not clean. Commit intentionally before switching or publishing.");
  }
}

export function requireSession(sessionId) {
  if (!String(sessionId || "").trim()) {
    throw new Error("A stable session id is required through --session=<id> or AGENTIC_SESSION_ID.");
  }
}

export function captureProtectedMainAdvance({
  baseSha, pullRequestBaseSha, protectedMainSha, declaredWriteSet, gitText,
}) {
  for (const [value, label] of [[baseSha, "source base"],
    [pullRequestBaseSha, "pull-request base"], [protectedMainSha, "protected main"]]) {
    if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  }
  gitText(["merge-base", "--is-ancestor", baseSha, pullRequestBaseSha]);
  gitText(["merge-base", "--is-ancestor", pullRequestBaseSha, protectedMainSha]);
  const changedPaths = normalizeProtectedChangedPaths(String(gitText([
    "diff", "--name-only", "--no-renames", "-z", baseSha, protectedMainSha, "--",
  ]) || ""));
  const scopes = normalizeWriteSet(declaredWriteSet);
  if (changedPaths.some(candidate => writeSetsOverlap([`path:${candidate}`], scopes))) {
    throw new Error("Protected main advanced within the admitted recovery write set.");
  }
  const tree = String(gitText(["rev-parse", `${protectedMainSha}^{tree}`]) || "").trim();
  if (!/^[0-9a-f]{40,64}$/u.test(tree)) throw new Error("protected-main tree must be a Git object ID.");
  return Object.freeze({ schema: "agentic-active-owned-dirt-protected-main-advance/v1",
    baseSha, pullRequestBaseSha, protectedMainSha, protectedMainTreeSha: tree,
    declaredWriteSetDigest: digestValue(scopes), changedPathCount: changedPaths.length,
    changedPathsDigest: digestValue(changedPaths) });
}

function normalizeProtectedChangedPaths(value) {
  const paths = value.split("\0").filter(Boolean).map(candidate => {
    const normalized = candidate.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || normalized.includes("\0")
      || normalized.split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error("Protected-main change path is not repository-relative.");
    }
    return normalized;
  });
  const sorted = [...new Set(paths)].sort();
  if (sorted.length !== paths.length || sorted.length > 100_000
    || Buffer.byteLength(JSON.stringify(sorted)) > 4_000_000) {
    throw new Error("Protected-main change evidence exceeds bounded exact capture.");
  }
  return sorted;
}

export function requireProtectedMainEquivalent({ planned, observed, gitText }) {
  if (planned.baseSha !== observed.baseSha
    || planned.pullRequestBaseSha !== observed.pullRequestBaseSha
    || planned.declaredWriteSetDigest !== observed.declaredWriteSetDigest) {
    throw new Error("Protected-main disjoint descendant evidence drifted.");
  }
  if (planned.protectedMainSha !== observed.protectedMainSha) {
    if (typeof gitText !== "function") throw new Error("Protected-main descendant cannot be proven.");
    gitText(["merge-base", "--is-ancestor", planned.protectedMainSha, observed.protectedMainSha]);
  } else if (planned.protectedMainTreeSha !== observed.protectedMainTreeSha
    || planned.changedPathCount !== observed.changedPathCount
    || planned.changedPathsDigest !== observed.changedPathsDigest) {
    throw new Error("Protected-main identity drifted without a descendant advance.");
  }
}

export function readActiveOwnedDirtRecoveryPullRequest({
  url, branch, targetRepository, ghText,
}) {
  const pullRequest = JSON.parse(ghText(["pr", "view", url, "--json",
    "id,url,state,isDraft,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body,autoMergeRequest"]));
  if (pullRequest?.id === undefined || pullRequest.url !== url
    || pullRequest.state !== "OPEN" || pullRequest.isDraft !== true
    || pullRequest.headRefName !== branch || pullRequest.baseRefName !== "main"
    || pullRequest.headRepository?.nameWithOwner !== targetRepository
    || pullRequest.autoMergeRequest !== null) {
    throw new Error("Recovery requires the exact open draft same-repository pull request with no delivery request.");
  }
  return pullRequest;
}
