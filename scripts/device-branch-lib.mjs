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
import { readOwnershipPullRequest, requireOwnershipPullRequestDraft } from "./device-pull-request-state.mjs";

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
  if (!current.pullRequestUrl || !current.fenceSha) {
    throw new Error("Writer lease is missing its draft pull request or fencing SHA.");
  }
  const pullRequest = requireOwnershipPullRequestDraft({
    url: current.pullRequestUrl, branch, ghText, expectedDraft: true,
  });
  const lease = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
  run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
    pullRequest.body,
    lease,
  )]);
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
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
  const pullRequest = readOwnershipPullRequest({ url: owner.url, branch: branchName, ghText });
  const remoteLease = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!remoteLease || remoteLease.branch !== branchName) {
    throw new Error(`Pull request ${owner.url} has no matching writer-lease metadata.`);
  }
  const remoteRef = `origin/${branchName}`;
  const remoteSha = gitText(["rev-parse", remoteRef]).trim();
  const replay = reconcileResumeReplay({
    branch: branchName, identity, currentBranch, repo, sessionId, remoteLease, remoteSha, owner,
    pullRequest, leaseStore, gitText, gitOptional, ghText, run, log, now,
  });
  if (replay) return replay;
  const expired = Date.parse(remoteLease.expiresAt) <= now().getTime();
  const sameSessionDelivery = remoteLease.status === "delivery" && remoteLease.sessionId === sessionId;
  const reviewHandoff = remoteLease.status === "review_ready";
  if (reviewHandoff && !/^[0-9a-f]{40}$/.test(String(remoteLease.reviewHeadSha || ""))) throw new Error("Reviewed handoff requires an exact reviewHeadSha.");
  if (sameSessionDelivery && !/^[0-9a-f]{40}$/.test(String(remoteLease.deliveryHeadSha || ""))) throw new Error("Delivery revision requires an exact deliveryHeadSha.");
  if (remoteLease.status !== "parked" && !(remoteLease.status === "active" && expired) && !sameSessionDelivery && !reviewHandoff) {
    throw new Error(
      `Semantic scope ${identity.scope} remains ${remoteLease.status} under another session until ${remoteLease.expiresAt}.`,
    );
  }

  if (remoteLease.fenceSha) run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, remoteRef]);
  if (currentBranch) {
    if (currentBranch !== branchName || (!reviewHandoff && !sameSessionDelivery)) {
      throw new Error("Attached resume is allowed only for the exact reviewed handoff or same-session delivery revision.");
    }
    const localSha = gitText(["rev-parse", "HEAD"]).trim();
    const handoffHead = reviewHandoff ? remoteLease.reviewHeadSha : remoteLease.deliveryHeadSha;
    if (localSha !== remoteSha || localSha !== handoffHead) {
      throw new Error("Attached handoff HEAD does not match its exact remote handoff evidence.");
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

  if (!pullRequest.isDraft) {
    if (!reviewHandoff && !sameSessionDelivery) {
      throw new Error(`Ownership pull request ${owner.url} must be draft before resume.`);
    }
    run("gh", ["pr", "ready", "--undo", owner.url]);
  }
  const draftPullRequest = requireOwnershipPullRequestDraft({
    url: owner.url, branch: branchName, ghText, expectedDraft: true,
  });

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
  run("git", ["commit", "--allow-empty", "-m", resumeClaimSubject(identity.scope, claimed.epoch)]);
  const fenceSha = gitText(["rev-parse", "HEAD"]).trim();
  const lease = leaseStore.annotate({
    sessionId,
    branch: branchName,
    values: { fenceSha, pullRequestUrl: owner.url },
  });
  try {
    run("git", ["push", "origin", branchName]);
  } catch (error) {
    const observedRemote = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branchName}`]).split(/\s+/)[0] || "";
    if (observedRemote !== fenceSha) {
      leaseStore.rollbackClaim({ sessionId, branch: branchName, epoch: lease.epoch, fenceSha, previousLease: previousLocalLease });
      run("git", ["switch", "--detach", remoteRef]);
    }
    throw error;
  }
  run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(draftPullRequest.body, lease)]);
  requireOwnershipPullRequestDraft({ url: owner.url, branch: branchName, ghText, expectedDraft: true });
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
  const pullRequest = readOwnershipPullRequest({ url, branch, ghText });
  if (pullRequest.isDraft) run("gh", ["pr", "ready", url]);
  const readyPullRequest = requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  const reviewHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  leaseStore.annotate({ sessionId, branch, values: { reviewHeadSha } });
  const readyLease = leaseStore.release({ sessionId, branch, status: "review_ready" });
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    readyPullRequest.body,
    readyLease,
  )]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
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
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
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
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
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

function reconcileResumeReplay({
  branch, identity, currentBranch, repo, sessionId, remoteLease, remoteSha, owner,
  pullRequest, leaseStore, gitText, gitOptional, ghText, run, log, now,
}) {
  let local = leaseStore.read?.(branch) || null;
  if (!local || local.status !== "active" || local.sessionId !== sessionId || currentBranch !== branch ||
      local.branch !== branch || local.device !== identity.device || local.scope !== identity.scope ||
      !local.worktreePath || path.resolve(local.worktreePath) !== path.resolve(repo) ||
      Date.parse(local.expiresAt) <= now().getTime()) return null;
  const markerFields = ["schema", "status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha", "heartbeatAt", "expiresAt"];
  const activeReplay = remoteLease.status === "active" && markerFields.every(field => remoteLease[field] === local[field]);
  const handoffHead = remoteLease.status === "review_ready" ? remoteLease.reviewHeadSha :
    remoteLease.status === "delivery" && remoteLease.sessionId === sessionId ? remoteLease.deliveryHeadSha : null;
  const pendingHandoff = /^[0-9a-f]{40}$/.test(String(handoffHead || "")) &&
    local.baseSha === handoffHead && local.epoch === remoteLease.epoch + 1;
  if (!activeReplay && !pendingHandoff) return null;
  if (!pullRequest.isDraft) throw new Error(`Ownership pull request ${owner.url} must be draft before active resume replay.`);
  let headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (activeReplay && (local.pullRequestUrl !== owner.url || local.fenceSha !== remoteSha || headSha !== remoteSha)) return null;
  if (pendingHandoff) {
    if (headSha === handoffHead) {
      if (local.fenceSha || local.pullRequestUrl) throw new Error("Uncommitted resume claim has unexpected fence or pull-request evidence.");
      run("git", ["commit", "--allow-empty", "-m", resumeClaimSubject(identity.scope, local.epoch)]);
      headSha = gitText(["rev-parse", "HEAD"]).trim();
    }
    requireResumeClaimCommit({ lease: local, headSha, gitText });
    if (!local.fenceSha && local.pullRequestUrl) {
      throw new Error("Resume claim has partial pull-request annotation without its exact fence.");
    }
    if (!local.fenceSha) {
      local = leaseStore.annotate({ sessionId, branch, values: { fenceSha: headSha, pullRequestUrl: owner.url } });
    } else if (local.fenceSha !== headSha || local.pullRequestUrl !== owner.url) {
      throw new Error("Resume claim annotation does not match its exact local claim commit and pull request.");
    }
    if (remoteSha === handoffHead) run("git", ["push", "origin", branch]);
    else if (remoteSha !== headSha) throw new Error("Resume claim remote is neither the handed-off head nor the exact claim commit.");
    const observedRemote = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] || "";
    if (observedRemote !== headSha) throw new Error("Resume claim push did not establish its exact remote fence.");
  }
  run("git", ["merge-base", "--is-ancestor", local.baseSha, local.fenceSha]);
  run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, local.fenceSha]);
  const verified = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(verified, repo);
  if (pendingHandoff) {
    run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(pullRequest.body, verified)]);
    requireOwnershipPullRequestDraft({ url: owner.url, branch, ghText, expectedDraft: true });
  }
  log(`Resume is already active for ${branch} at fence ${local.fenceSha.slice(0, 12)}.`);
  return verified;
}

function requireResumeClaimCommit({ lease, headSha, gitText }) {
  const parents = gitText(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  if (parents.length !== 2 || parents[0] !== headSha || parents[1] !== lease.baseSha) {
    throw new Error("Resume recovery requires the exact single-parent claim commit.");
  }
  if (gitText(["log", "-1", "--pretty=%s"]).trim() !== resumeClaimSubject(lease.scope, lease.epoch)) {
    throw new Error("Resume recovery claim subject does not match its lease epoch.");
  }
  if (gitText(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).trim()) {
    throw new Error("Resume recovery claim commit must not change the source tree.");
  }
}

function resumeClaimSubject(scope, epoch) {
  return `chore(coordination): claim ${scope} lease ${epoch}`;
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
  const pullRequest = requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    pullRequest.body,
    lease,
  )]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
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
