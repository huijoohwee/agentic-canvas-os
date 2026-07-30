import path from "node:path";
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
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";

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
  verifyActiveCloudAuthority = null,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  let current = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(current, repo);
  if (!repairPullRequestProjection) {
    requireRemoteFence({ branch, lease: current, gitOptional });
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
  let cloudExpiryCap = null;
  let cloudVerification = null;
  let mutationAuthorityReceipt = null;
  if (current.cloudAuthority) {
    if (typeof heartbeatCloudAuthority !== "function") {
      throw new Error("Cloud-authoritative heartbeat requires the repository cloud heartbeat adapter.");
    }
    if (typeof verifyActiveCloudAuthority !== "function") {
      throw new Error("Cloud-authoritative heartbeat requires the repository cloud verifier.");
    }
    const renewed = heartbeatCloudAuthority({
      authority: current.cloudAuthority,
      deviceId: current.device,
      sessionId,
      ttlSeconds: Math.floor(leaseTtlMs / 1000),
    });
    const renewedAuthority = renewed.authority;
    mutationAuthorityReceipt = assertAdmissionMutationAuthority({
      lease: { ...current, cloudAuthority: renewedAuthority },
      cloudAuthority: renewedAuthority,
      remoteAuthorityVerification: renewed.verification,
    });
    current = leaseStore.annotate({
      sessionId,
      branch,
      values: { cloudAuthority: renewedAuthority },
    });
    cloudExpiryCap = renewedAuthority.expiresAt;
    cloudVerification = renewed.verification;
  }
  let lease = leaseStore.heartbeat({
    sessionId,
    branch,
    ttlMs: leaseTtlMs,
    expiresAtCap: cloudExpiryCap,
  });
  if (cloudVerification) {
    const immediate = verifyActiveCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: {
        declaredWriteSet: lease.cloudAuthority.cloudDeclaredWriteScope,
        writeSetDigest: lease.cloudAuthority.writeSetDigest,
      },
      canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha,
    });
    mutationAuthorityReceipt = assertAdmissionMutationAuthority({
      lease: { ...lease, cloudAuthority: immediate.authority },
      cloudAuthority: immediate.authority,
      remoteAuthorityVerification: immediate.verification,
    });
    lease = leaseStore.annotate({
      sessionId,
      branch,
      values: { cloudAuthority: immediate.authority },
    });
  }
  run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
    pullRequest.body,
    lease,
  )]);
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
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

function requireRemoteFence({ branch, lease, gitOptional }) {
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (!lease.fenceSha || remoteSha !== lease.fenceSha) throw new Error(
    `Remote fence for ${branch} is ${remoteSha || "missing"}, not ${lease.fenceSha || "unclaimed"}; this session is stale.`,
  );
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
