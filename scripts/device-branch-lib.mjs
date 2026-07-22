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
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { sanitizeDevice } from "./device-branch-identity.mjs";

export { sanitize, sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
export { park, createParkMessage, formatParkTimestamp } from "./device-park-lib.mjs";
export { start } from "./device-start-lib.mjs";
export function heartbeat({
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
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  const current = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(current, repo);
  requireRemoteFence({ branch, lease: current, gitOptional });
  const lease = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Writer lease is missing its draft pull request or fencing SHA.");
  }
  run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
    readRemotePullRequestBody({ url: lease.pullRequestUrl, ghText }),
    lease,
  )]);
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
  const currentBranch = gitText(["branch", "--show-current"]).trim();
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
  const reviewHandoff = remoteLease.status === "review_ready";
  if (reviewHandoff && !/^[0-9a-f]{40}$/.test(String(remoteLease.reviewHeadSha || ""))) throw new Error("Reviewed handoff requires an exact reviewHeadSha.");
  if (remoteLease.status !== "parked" && !(remoteLease.status === "active" && expired) && !sameSessionDelivery && !reviewHandoff) {
    throw new Error(
      `Semantic scope ${identity.scope} remains ${remoteLease.status} under another session until ${remoteLease.expiresAt}.`,
    );
  }

  const remoteRef = `origin/${branchName}`;
  const remoteSha = gitText(["rev-parse", remoteRef]).trim();
  if (remoteLease.fenceSha) run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, remoteRef]);
  if (currentBranch) {
    if (currentBranch !== branchName || (!reviewHandoff && !sameSessionDelivery)) {
      throw new Error("Attached resume is allowed only for the exact reviewed handoff or same-session delivery revision.");
    }
    const localSha = gitText(["rev-parse", "HEAD"]).trim();
    if (localSha !== remoteSha || (remoteLease.reviewHeadSha && localSha !== remoteLease.reviewHeadSha)) {
      throw new Error("Attached handoff HEAD does not match its exact reviewed remote evidence.");
    }
  } else if (gitOptional(["show-ref", "--verify", `refs/heads/${branchName}`])) {
    run("git", ["switch", branchName]);
    run("git", ["merge", "--ff-only", remoteRef]);
    const localSha = gitText(["rev-parse", "HEAD"]).trim();
    if (localSha !== remoteSha) {
      const localLease = leaseStore.read(branchName);
      const localParkedContinuation = remoteLease.status === "parked" && remoteLease.sessionId === sessionId &&
        localLease?.status === "parked" && localLease.sessionId === sessionId && localLease.branch === branchName &&
        localLease.epoch === remoteLease.epoch && localLease.fenceSha === remoteLease.fenceSha &&
        localLease.baseSha === remoteLease.baseSha && localLease.pullRequestUrl === owner.url &&
        localLease.worktreePath && path.resolve(localLease.worktreePath) === path.resolve(repo);
      if (!localParkedContinuation) throw new Error(`Local ${branchName} is not the exact same-session parked continuation of ${remoteSha.slice(0, 12)}.`);
      run("git", ["merge-base", "--is-ancestor", remoteRef, "HEAD"]);
      run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, "HEAD"]);
    }
  } else {
    run("git", ["switch", "--create", branchName, "--track", remoteRef]);
  }

  const previousLocalLease = leaseStore.read?.(branchName) || null;
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
  try {
    run("git", ["push", "origin", branchName]);
  } catch (error) {
    leaseStore.rollbackClaim({ sessionId, branch: branchName, epoch: lease.epoch, fenceSha, previousLease: previousLocalLease });
    run("git", ["switch", "--detach", remoteRef]);
    throw error;
  }
  run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(owner.body, lease)]);
  log(
    `Resumed ${branchName} at epoch ${lease.epoch} with fence ${fenceSha.slice(0, 12)}; prior writers are fenced by the fast-forward remote head.`,
  );
  return lease;
}
export function review({
  invocationPath,
  repo,
  gitText,
  gitOptional,
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
  const branch = requireTaskBranch(gitText(["branch", "--show-current"]).trim(), "Review");
  const existing = leaseStore.read(branch);
  if (existing?.status === "review_ready") {
    if (existing.sessionId !== sessionId) throw new Error("Review-ready lease belongs to another session.");
    assertLeaseWorktree(existing, repo);
    requireReviewReplay({ branch, lease: existing, gitText, gitOptional, ghText, ghOptional, run });
    log(`Review is already ready at ${existing.pullRequestUrl}.`);
    return existing.pullRequestUrl;
  }
  const lease = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Review requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  run("npm", ["run", "check"]);
  run("git", ["push", "--set-upstream", "origin", branch]);
  const url = requireLeasePullRequest({ lease, ghOptional });
  const draft = ghOptional(["pr", "view", "--json", "isDraft", "--jq", ".isDraft"]);
  if (draft !== "true" && draft !== "false") throw new Error(`Cannot prove draft state for ${url}.`);
  if (draft === "true") run("gh", ["pr", "ready", url]);
  const reviewHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  leaseStore.annotate({ sessionId, branch, values: { reviewHeadSha } });
  const readyLease = leaseStore.release({ sessionId, branch, status: "review_ready" });
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    readRemotePullRequestBody({ url, ghText }),
    readyLease,
  )]);
  log(`Marked ${url} ready for review without enabling merge or deployment.`);
  return url;
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
  const deliveryHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  leaseStore.annotate({ sessionId, branch, values: { deliveryHeadSha } });
  const deliveredLease = leaseStore.release({ sessionId, branch, status: "delivery" });
  run("gh", ["pr", "edit", url, "--body", updateWriterLeasePullRequestBody(
    readRemotePullRequestBody({ url, ghText }),
    deliveredLease,
  )]);
  const trimmedUrl = url.trim();
  log(`Published ${trimmedUrl} with protected auto-merge enabled.`);
  return trimmedUrl;
}

export function completeSession({
  invocationPath,
  repo,
  gitText,
  ghText,
  leaseStore,
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
  if (!leaseStore) throw new Error("Completion requires the repository writer-lease store.");
  leaseStore.complete({
    branch,
    pullRequestUrl: pullRequest.url,
    mergeCommitSha,
    mainSha,
  });

  if (json) {
    log(JSON.stringify(summary));
    return summary;
  }

  log(
    `Task integrated through ${summary.pullRequestUrl}; clean main is ${summary.mainSha.slice(0, 12)}. Restart the local runtime from this SHA and rerun the original browser acceptance before claiming completion.`,
  );
  return summary;
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

function requireRemoteFence({ branch, lease, gitOptional }) {
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (!lease.fenceSha || remoteSha !== lease.fenceSha) throw new Error(
    `Remote fence for ${branch} is ${remoteSha || "missing"}, not ${lease.fenceSha || "unclaimed"}; this session is stale.`,
  );
}

function requireNoCompetingPullRequest({ branch, ghText }) {
  const pulls = JSON.parse(ghText(["pr", "list", "--state", "open", "--base", "main", "--limit", "100", "--json", "number,headRefName,url"]));
  assertNoCompetingPullRequests(pulls, branch);
}

function requireTaskBranch(branch, action) {
  if (!branch || branch === "main") throw new Error(`${action} from an agent/<device>/<scope> branch, never main.`);
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  return branch;
}

function requireLeasePullRequest({ lease, ghOptional }) {
  const url = ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!url || url.trim() !== lease.pullRequestUrl) {
    throw new Error(`Active pull request does not match the writer lease ${lease.pullRequestUrl}.`);
  }
  return url.trim();
}

function requireReviewReplay({ branch, lease, gitText, gitOptional, ghText, ghOptional, run }) {
  if (!lease.pullRequestUrl || !lease.fenceSha || !lease.reviewHeadSha) {
    throw new Error("Review-ready replay lacks pull request, fence, or reviewed-head evidence; resume explicitly.");
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== lease.reviewHeadSha) {
    throw new Error(`Review-ready HEAD changed from ${lease.reviewHeadSha} to ${headSha}; resume explicitly.`);
  }
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  if ((remoteLine.split(/\s+/)[0] || "") !== headSha) {
    throw new Error("Review-ready remote head changed; resume explicitly before another handoff.");
  }
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  const url = requireLeasePullRequest({ lease, ghOptional });
  const pullRequest = JSON.parse(ghText(["pr", "view", url, "--json", "state,isDraft"]));
  if (pullRequest.state !== "OPEN" || pullRequest.isDraft !== false) {
    throw new Error("Review-ready replay requires the matching open, non-draft pull request.");
  }
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    readRemotePullRequestBody({ url, ghText }),
    lease,
  )]);
}

function readRemotePullRequestBody({ url, ghText }) {
  return ghText(["pr", "view", url, "--json", "body", "--jq", ".body"]);
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
