import os from "node:os";
import path from "node:path";

import {
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
} from "./repository-guards.mjs";
import {
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

export function start({
  scope,
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  run,
  log = console.log,
}) {
  if (!scope) throw new Error("A semantic scope is required.");
  requireSession(sessionId);
  const worktree = requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  if (!worktree.detached || gitText(["branch", "--show-current"]).trim()) {
    throw new Error("device:start requires a detached registered task worktree; keep main checked out in its canonical worktree.");
  }
  const device = sanitizeDevice(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const normalizedScope = sanitizeScope(scope);
  const branch = `agent/${device}/${normalizedScope}`;
  if (!parseDeviceBranch(branch)) throw new Error(`Generated branch does not satisfy the device branch contract: ${branch}`);
  run("git", ["fetch", "origin", "main"]);
  const detachedSha = gitText(["rev-parse", "HEAD"]).trim();
  const baseSha = gitText(["rev-parse", "origin/main"]).trim();
  if (detachedSha !== baseSha) {
    throw new Error(`Task worktree must start at fetched origin/main ${baseSha}; received ${detachedSha}.`);
  }
  requireNoCompetingPullRequest({ branch, ghText });
  const claimed = leaseStore.claim({
    sessionId,
    device,
    scope: normalizedScope,
    branch,
    worktreePath: repo,
    baseSha,
    ttlMs: leaseTtlMs,
  });
  run("git", ["switch", "--create", branch, "origin/main"]);
  run("git", ["commit", "--allow-empty", "-m", `chore(coordination): claim ${normalizedScope} lease ${claimed.epoch}`]);
  const fenceSha = gitText(["rev-parse", "HEAD"]).trim();
  let lease = leaseStore.annotate({ sessionId, branch, values: { fenceSha } });
  run("git", ["push", "--set-upstream", "origin", branch]);
  const url = ghText([
    "pr",
    "create",
    "--draft",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    `WIP: ${normalizedScope}`,
    "--body",
    renderWriterLeasePullRequestBody(lease),
  ]).trim();
  lease = leaseStore.annotate({ sessionId, branch, values: { pullRequestUrl: url } });
  log(
    `Claimed ${branch} in ${url} with fence ${fenceSha.slice(0, 12)}; keep the claiming task's AGENTIC_SESSION_ID set before commits and heartbeat before ${lease.expiresAt}.`,
  );
  return branch;
}

export function heartbeat({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  leaseStore,
  sessionId,
  leaseTtlMs,
  run,
  log = console.log,
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  const current = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(current, repo);
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (!current.fenceSha || remoteSha !== current.fenceSha) {
    throw new Error(
      `Remote fence for ${branch} is ${remoteSha || "missing"}, not ${current.fenceSha || "unclaimed"}; this session is stale.`,
    );
  }
  const lease = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Writer lease is missing its draft pull request or fencing SHA.");
  }
  run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", renderWriterLeasePullRequestBody(lease)]);
  log(`Renewed ${lease.scope} lease ${lease.epoch} until ${lease.expiresAt}.`);
  return lease;
}

export function resume({
  branchName,
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireSession(sessionId);
  const identity = parseDeviceBranch(branchName);
  if (!identity) throw new Error("Resume requires the exact agent/<device>/<semantic-scope> handoff branch.");
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  if (gitText(["branch", "--show-current"]).trim()) {
    throw new Error("device:resume requires a detached registered task worktree.");
  }
  run("git", ["fetch", "origin", "main", branchName]);

  const pulls = JSON.parse(ghText([
    "pr",
    "list",
    "--state",
    "open",
    "--base",
    "main",
    "--limit",
    "100",
    "--json",
    "number,headRefName,url,body",
  ]));
  const owner = assertNoCompetingPullRequests(pulls, branchName);
  if (!owner?.url) throw new Error(`No draft ownership pull request exists for ${branchName}.`);
  const remoteLease = parseWriterLeasePullRequestBody(owner.body);
  if (!remoteLease || remoteLease.branch !== branchName) {
    throw new Error(`Pull request ${owner.url} has no matching writer-lease metadata.`);
  }
  const expired = Date.parse(remoteLease.expiresAt) <= now().getTime();
  const sameSessionDelivery = remoteLease.status === "delivery" && remoteLease.sessionId === sessionId;
  if (remoteLease.status !== "parked" && !(remoteLease.status === "active" && expired) && !sameSessionDelivery) {
    throw new Error(
      `Semantic scope ${identity.scope} remains ${remoteLease.status} under another session until ${remoteLease.expiresAt}.`,
    );
  }

  const remoteRef = `origin/${branchName}`;
  const remoteSha = gitText(["rev-parse", remoteRef]).trim();
  if (remoteLease.fenceSha) run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, remoteRef]);
  const localExists = Boolean(gitOptional(["show-ref", "--verify", `refs/heads/${branchName}`]));
  if (localExists) {
    run("git", ["switch", branchName]);
    run("git", ["merge", "--ff-only", remoteRef]);
    const localSha = gitText(["rev-parse", "HEAD"]).trim();
    if (localSha !== remoteSha) {
      throw new Error(
        `Local ${branchName} is ${localSha.slice(0, 12)}, not the handed-off remote ${remoteSha.slice(0, 12)}; preserve or publish local commits before resume.`,
      );
    }
  } else {
    run("git", ["switch", "--create", branchName, "--track", remoteRef]);
  }

  const device = sanitizeDevice(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const claimed = leaseStore.claim({
    sessionId,
    device,
    scope: identity.scope,
    branch: branchName,
    worktreePath: repo,
    baseSha: remoteSha,
    previousEpoch: remoteLease.epoch,
    ttlMs: leaseTtlMs,
  });
  run("git", ["commit", "--allow-empty", "-m", `chore(coordination): claim ${identity.scope} lease ${claimed.epoch}`]);
  const fenceSha = gitText(["rev-parse", "HEAD"]).trim();
  const lease = leaseStore.annotate({
    sessionId,
    branch: branchName,
    values: { fenceSha, pullRequestUrl: owner.url },
  });
  run("git", ["push", "origin", branchName]);
  run("gh", ["pr", "edit", owner.url, "--body", renderWriterLeasePullRequestBody(lease)]);
  log(
    `Resumed ${branchName} at epoch ${lease.epoch} with fence ${fenceSha.slice(0, 12)}; prior writers are fenced by the fast-forward remote head.`,
  );
  return lease;
}

export function publish({
  invocationPath,
  repo,
  gitText,
  ghText,
  ghOptional,
  leaseStore,
  sessionId,
  run,
  log = console.log,
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch || branch === "main") throw new Error("Publish from an agent/<device>/<scope> branch, never main.");
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  const lease = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Publish requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  run("npm", ["run", "check"]);
  run("git", ["push", "--set-upstream", "origin", branch]);

  const url = ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!url || url.trim() !== lease.pullRequestUrl) {
    throw new Error(`Active pull request does not match the writer lease ${lease.pullRequestUrl}.`);
  }
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  run("gh", ["pr", "edit", url, "--title", title, "--add-label", "automerge"]);
  run("gh", ["pr", "ready", url]);
  run("gh", ["pr", "merge", "--auto", "--squash", url]);
  const deliveredLease = leaseStore.release({ sessionId, branch, status: "delivery" });
  run("gh", ["pr", "edit", url, "--body", renderWriterLeasePullRequestBody(deliveredLease)]);
  const trimmedUrl = url.trim();
  log(`Published ${trimmedUrl} with protected auto-merge enabled.`);
  return trimmedUrl;
}

export function park({
  invocationPath,
  repo,
  gitText,
  leaseStore,
  sessionId,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch) throw new Error("Park from a branch checkout, not a detached HEAD.");
  const leasedTaskBranch = branch.startsWith("agent/");
  if (leasedTaskBranch) {
    requireSession(sessionId);
    const lease = leaseStore.verify({ sessionId, branch, allowExpired: true });
    assertLeaseWorktree(lease, repo);
  }

  let stashRef = null;
  if (gitText(["status", "--porcelain"]).trim()) {
    run("git", ["stash", "push", "-u", "-m", createParkMessage(branch, now())]);
    stashRef = gitText(["stash", "list", "--format=%gd", "-n", "1"]).trim();
  }

  run("git", ["fetch", "origin", "main"]);
  if (branch === "main") run("git", ["merge", "--ff-only", "origin/main"]);
  else run("git", ["switch", "--detach", "origin/main"]);

  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalSha = gitText(["rev-parse", "origin/main"]).trim();
  if (headSha !== canonicalSha) {
    throw new Error(
      `main must match origin/main after park; local main is ${headSha.slice(0, 12)} but origin/main is ${canonicalSha.slice(0, 12)}`,
    );
  }
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("main remains dirty after park; resolve local changes before continuing.");
  }
  if (leasedTaskBranch) {
    const parkedLease = leaseStore.release({ sessionId, branch, status: "parked" });
    if (parkedLease.pullRequestUrl) {
      run("gh", ["pr", "edit", parkedLease.pullRequestUrl, "--body", renderWriterLeasePullRequestBody(parkedLease)]);
    }
  }

  const summary = stashRef
    ? `Parked ${branch} in ${stashRef}; task worktree is detached at ${headSha.slice(0, 12)}.`
    : branch === "main"
      ? `main is already clean at ${headSha.slice(0, 12)}.`
      : `Detached the task worktree from ${branch} at ${headSha.slice(0, 12)}.`;
  log(summary);
  return { branch, headSha, stashRef };
}

export function completeSession({
  invocationPath,
  repo,
  gitText,
  ghText,
  run,
  log = console.log,
  json = false,
}) {
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });

  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch || branch === "main") {
    throw new Error("Completion must begin on the merged agent/<device>/<scope> task branch.");
  }
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  const parkedStashes = gitText(["stash", "list", "--format=%s"])
    .split("\n")
    .filter(subject => subject.includes(`park: ${branch} `));
  if (parkedStashes.length) {
    throw new Error(`Task remains parked in a named stash for ${branch}; restore and integrate it before completion.`);
  }

  const pullRequest = readPullRequest({ branch, ghText });
  if (pullRequest.baseRefName !== "main") {
    throw new Error(`Pull request ${pullRequest.url} targets ${pullRequest.baseRefName}, not main.`);
  }
  if (pullRequest.state !== "MERGED") {
    throw new Error(
      `Task remains pending: pull request ${pullRequest.url} is ${pullRequest.state.toLowerCase()}, not merged. Use device:park only when pausing or blocked.`,
    );
  }
  const mergeCommitSha = pullRequest.mergeCommit?.oid;
  if (!mergeCommitSha) throw new Error(`Merged pull request ${pullRequest.url} has no merge commit SHA.`);
  const taskHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  if (!pullRequest.headRefOid || taskHeadSha !== pullRequest.headRefOid) {
    throw new Error(
      `Task branch HEAD ${taskHeadSha.slice(0, 12)} is not the merged pull-request head ${pullRequest.headRefOid?.slice(0, 12) || "unknown"}.`,
    );
  }

  run("git", ["fetch", "origin", "main"]);
  run("git", ["merge-base", "--is-ancestor", mergeCommitSha, "origin/main"]);
  run("git", ["switch", "--detach", "origin/main"]);

  const mainSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalSha = gitText(["rev-parse", "origin/main"]).trim();
  if (mainSha !== canonicalSha) {
    throw new Error(
      `main must match origin/main after completion; local main is ${mainSha.slice(0, 12)} but origin/main is ${canonicalSha.slice(0, 12)}`,
    );
  }
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("main remains dirty after completion; resolve local changes before reporting completion.");
  }

  const summary = {
    completedBranch: branch,
    pullRequestUrl: pullRequest.url,
    mergeCommitSha,
    mainSha,
    status: "ok",
  };

  if (json) {
    log(JSON.stringify(summary));
    return summary;
  }

  log(
    `Task integrated through ${summary.pullRequestUrl}; clean main is ${summary.mainSha.slice(0, 12)}. Restart the local runtime from this SHA and rerun the original browser acceptance before claiming completion.`,
  );
  return summary;
}

export function createParkMessage(branch, date = new Date()) {
  return `park: ${branch} ${formatParkTimestamp(date)}`;
}

export function formatParkTimestamp(date = new Date()) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function sanitize(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Device/scope must contain an ASCII letter or number.");
  return normalized.slice(0, 48);
}

export function sanitizeDevice(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 48);
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    throw new Error("Device must have ASCII alphanumeric boundaries.");
  }
  return normalized;
}

export function sanitizeScope(value) {
  const normalized = normalizeBranchSegment(value, /[^a-z0-9-]+/g, /^-+|-+$/g);
  if (!normalized) throw new Error("Semantic scope must contain an ASCII letter or number.");
  return normalized;
}

function normalizeBranchSegment(value, invalidPattern, edgePattern) {
  const normalized = String(value).toLowerCase().replace(invalidPattern, "-").replace(edgePattern, "");
  if (!normalized) throw new Error("Device/scope must contain an ASCII letter or number.");
  return normalized.slice(0, 48);
}

function requireRepositorySafety({ invocationPath, repo, gitText }) {
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

function assertLeaseWorktree(lease, repo) {
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Writer lease owns worktree ${lease.worktreePath}, not ${repo}.`);
  }
}

function requireNoCompetingPullRequest({ branch, ghText }) {
  const pulls = JSON.parse(ghText(["pr", "list", "--state", "open", "--base", "main", "--limit", "100", "--json", "number,headRefName,url"]));
  assertNoCompetingPullRequests(pulls, branch);
}

function requireClean({ gitText }) {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Working tree is not clean. Commit intentionally before switching or publishing.");
  }
}

function requireSession(sessionId) {
  if (!String(sessionId || "").trim()) {
    throw new Error("A stable session id is required through --session=<id> or AGENTIC_SESSION_ID.");
  }
}

function readPullRequest({ branch, ghText }) {
  let pullRequest;
  try {
    pullRequest = JSON.parse(
      ghText(["pr", "view", branch, "--json", "state,baseRefName,url,mergeCommit,headRefOid"]),
    );
  } catch (error) {
    throw new Error(`Cannot prove a pull request for ${branch}: ${error.message}`);
  }
  if (!pullRequest?.url || !pullRequest?.state || !pullRequest?.baseRefName) {
    throw new Error(`Cannot prove a complete pull request record for ${branch}.`);
  }
  return pullRequest;
}
