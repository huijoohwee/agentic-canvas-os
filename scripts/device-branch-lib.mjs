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
import {
  park,
  requireParkedStashObject,
  restoreParkedStashObject,
} from "./device-park-lib.mjs";

export { sanitize, sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
export { park, createParkMessage, formatParkTimestamp } from "./device-park-lib.mjs";
export { completeSession } from "./device-complete-lib.mjs";
const PARK_STASH_FIELDS = [
  "parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha",
  "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus",
];
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
  const currentBranch = gitText(["branch", "--show-current"]).trim();
  const localAtInvocation = leaseStore.read?.(branchName) || null;
  const dirty = Boolean(gitText(["status", "--porcelain"]).trim());
  const dirtyRestoreReplay = currentBranch === branchName && localAtInvocation?.status === "active" &&
    localAtInvocation.sessionId === sessionId && ["pending", "restored"].includes(localAtInvocation.parkStashStatus);
  if (dirty && !dirtyRestoreReplay) requireClean({ gitText });
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
    pullRequest, leaseStore, leaseTtlMs, gitText, gitOptional, ghText, run, log, now,
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
  const parkedStashValues = remoteLease.status === "parked"
    ? requireExactParkedStashHandoff({ remoteLease, localLease: localAtInvocation, owner, repo, sessionId, gitText, gitOptional })
    : null;
  const parkedResumeHead = remoteLease.status === "parked" ? requireParkedResumeHead(remoteLease) : null;

  if (remoteLease.fenceSha) run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, remoteRef]);
  let claimBaseSha = remoteSha;
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
        localLease.parkBranchHeadSha === remoteLease.parkBranchHeadSha && localSha === remoteLease.parkBranchHeadSha &&
        localLease.worktreePath && path.resolve(localLease.worktreePath) === path.resolve(repo);
      if (!localParkedContinuation) throw new Error(`Local ${branchName} is not the exact same-session parked continuation of ${remoteSha.slice(0, 12)}.`);
      run("git", ["merge-base", "--is-ancestor", remoteRef, "HEAD"]);
      run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, "HEAD"]);
      claimBaseSha = localSha;
    }
  } else {
    run("git", ["switch", "--create", branchName, "--track", remoteRef]);
  }
  if (remoteLease.status === "parked" && claimBaseSha !== parkedResumeHead) {
    throw new Error("Parked resume HEAD does not match its exact pre-claim branch head.");
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

  const device = sanitizeDevice(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const claimed = leaseStore.claim({
    sessionId,
    device,
    scope: identity.scope,
    branch: branchName,
    worktreePath: repo,
    baseSha: claimBaseSha,
    previousEpoch: remoteLease.epoch,
    ttlMs: leaseTtlMs,
  });
  run("git", ["commit", "--allow-empty", "-m", resumeClaimSubject(identity.scope, claimed.epoch)]);
  const fenceSha = gitText(["rev-parse", "HEAD"]).trim();
  const lease = leaseStore.annotate({
    sessionId,
    branch: branchName,
    values: { fenceSha, pullRequestUrl: owner.url, ...(parkedStashValues || {}) },
  });
  try {
    run("git", ["push", "origin", branchName]);
  } catch (error) {
    gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branchName}`]);
    throw error;
  }
  run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(draftPullRequest.body, lease)]);
  requireOwnershipPullRequestDraft({ url: owner.url, branch: branchName, ghText, expectedDraft: true });
  const restoredLease = completeParkedStashRestore({
    branch: branchName, lease, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run,
  });
  log(
    `Resumed ${branchName} at epoch ${restoredLease.epoch} with fence ${fenceSha.slice(0, 12)}; prior writers are fenced by the fast-forward remote head.`,
  );
  return restoredLease;
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

function reconcileResumeReplay({
  branch, identity, currentBranch, repo, sessionId, remoteLease, remoteSha, owner,
  pullRequest, leaseStore, leaseTtlMs, gitText, gitOptional, ghText, run, log, now,
}) {
  let local = leaseStore.read?.(branch) || null;
  if (!local || local.status !== "active" || local.sessionId !== sessionId || currentBranch !== branch ||
      local.branch !== branch || local.device !== identity.device || local.scope !== identity.scope ||
      !local.worktreePath || path.resolve(local.worktreePath) !== path.resolve(repo)) return null;
  const markerFields = ["schema", "status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha", "heartbeatAt", "expiresAt"];
  const activeReplay = remoteLease.status === "active" && markerFields.every(field => remoteLease[field] === local[field]);
  const expiredActiveHandoff = remoteLease.status === "active" && Date.parse(remoteLease.expiresAt) <= now().getTime();
  const handoffHead = remoteLease.status === "review_ready" ? remoteLease.reviewHeadSha :
    remoteLease.status === "delivery" && remoteLease.sessionId === sessionId ? remoteLease.deliveryHeadSha :
    remoteLease.status === "parked" ? requireParkedResumeHead(remoteLease) :
    expiredActiveHandoff ? remoteLease.fenceSha : null;
  const pendingHandoff = /^[0-9a-f]{40}$/.test(String(handoffHead || "")) &&
    local.baseSha === handoffHead && local.epoch === remoteLease.epoch + 1;
  if (!activeReplay && !pendingHandoff) return null;
  const expired = Date.parse(local.expiresAt) <= now().getTime();
  if (expired && !pendingHandoff) return null;
  if (!pullRequest.isDraft) throw new Error(`Ownership pull request ${owner.url} must be draft before active resume replay.`);
  const parkedStashValues = remoteLease.status === "parked"
    ? requireReplayParkedStash({ remoteLease, local, owner, repo, sessionId, gitText, gitOptional })
    : null;
  let headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (activeReplay && (local.pullRequestUrl !== owner.url || local.fenceSha !== remoteSha || headSha !== remoteSha)) return null;
  if (pendingHandoff) {
    const pushBase = remoteLease.status === "parked" ? remoteLease.parkSourceFenceSha : handoffHead;
    const atHandoffHead = headSha === handoffHead;
    if (atHandoffHead) {
      if (local.fenceSha || local.pullRequestUrl || hasCarriedParkedStash(local)) {
        throw new Error("Uncommitted resume claim has unexpected fence, pull-request, or parked-stash evidence.");
      }
    } else {
      requireResumeClaimCommit({ lease: local, headSha, gitText });
      requirePendingClaimAnnotation({ local, headSha, owner, parkedStashValues });
    }
    if (expired) {
      const recoverableRemote = remoteSha === pushBase ||
        (/^[0-9a-f]{40}$/.test(String(local.fenceSha || "")) && remoteSha === local.fenceSha);
      if (!recoverableRemote) {
        throw new Error("Expired resume claim lost its exact remote handoff or fence.");
      }
      local = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
      if (local.fenceSha) requireCarriedParkedStash({ local, expected: parkedStashValues });
    }
    if (atHandoffHead) {
      run("git", ["commit", "--allow-empty", "-m", resumeClaimSubject(identity.scope, local.epoch)]);
      headSha = gitText(["rev-parse", "HEAD"]).trim();
    }
    requireResumeClaimCommit({ lease: local, headSha, gitText });
    if (!local.fenceSha && local.pullRequestUrl) {
      throw new Error("Resume claim has partial pull-request annotation without its exact fence.");
    }
    if (!local.fenceSha) {
      local = leaseStore.annotate({
        sessionId, branch, values: { fenceSha: headSha, pullRequestUrl: owner.url, ...(parkedStashValues || {}) },
      });
    } else if (local.fenceSha !== headSha || local.pullRequestUrl !== owner.url) {
      throw new Error("Resume claim annotation does not match its exact local claim commit and pull request.");
    }
    requireCarriedParkedStash({ local, expected: parkedStashValues });
    if (remoteSha === pushBase) {
      if (remoteLease.status === "parked") run("git", ["merge-base", "--is-ancestor", pushBase, handoffHead]);
      run("git", ["push", "origin", branch]);
    }
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
  const restored = completeParkedStashRestore({
    branch, lease: verified, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run,
  });
  log(`Resume is already active for ${branch} at fence ${local.fenceSha.slice(0, 12)}.`);
  return restored;
}

function requireParkedResumeHead(lease) {
  if (!/^[0-9a-f]{40}$/.test(String(lease.parkBranchHeadSha || "")) ||
      lease.parkSourceEpoch !== lease.epoch || lease.parkSourceFenceSha !== lease.fenceSha) {
    throw new Error("Parked resume lacks its exact pre-claim head, source epoch, or source fence.");
  }
  return lease.parkBranchHeadSha;
}

function requireExactParkedStashHandoff({ remoteLease, localLease, owner, repo, sessionId, gitText, gitOptional }) {
  const anyEvidence = PARK_STASH_FIELDS.slice(4).some(field => remoteLease[field] !== null && remoteLease[field] !== undefined);
  if (!anyEvidence) return null;
  if (remoteLease.sessionId !== sessionId || localLease?.status !== "parked" || localLease.sessionId !== sessionId ||
      localLease.pullRequestUrl !== owner.url || !localLease.worktreePath ||
      path.resolve(localLease.worktreePath) !== path.resolve(repo)) {
    throw new Error("A dirty parked handoff can resume only in its exact same-session worktree and pull request.");
  }
  for (const field of ["schema", "status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha", ...PARK_STASH_FIELDS]) {
    if (localLease[field] !== remoteLease[field]) throw new Error(`Dirty parked handoff disagrees on ${field}.`);
  }
  requireParkedStashObject({ lease: remoteLease, gitText, gitOptional });
  return carriedParkedStash(remoteLease);
}

function requireReplayParkedStash({ remoteLease, local, owner, repo, sessionId, gitText, gitOptional }) {
  const expected = requireExactParkedStashHandoff({
    remoteLease,
    localLease: { ...remoteLease, pullRequestUrl: owner.url, worktreePath: repo },
    owner, repo, sessionId, gitText, gitOptional,
  });
  if (!expected) return null;
  if (local.sessionId !== sessionId || !local.worktreePath || path.resolve(local.worktreePath) !== path.resolve(repo)) {
    throw new Error("Partial dirty-park resume belongs to another session or worktree.");
  }
  return expected;
}

function carriedParkedStash(lease) {
  return Object.fromEntries(PARK_STASH_FIELDS.map(field => [field, lease[field] ?? null]));
}

function requireCarriedParkedStash({ local, expected }) {
  if (!expected) {
    if (hasCarriedParkedStash(local)) throw new Error("Resume claim carries parked-stash evidence absent from its handoff.");
    return;
  }
  for (const field of PARK_STASH_FIELDS) {
    if (local[field] !== expected[field]) throw new Error(`Partial resume lost parked stash evidence ${field}.`);
  }
}

function hasCarriedParkedStash(lease) {
  return PARK_STASH_FIELDS.some(field => lease?.[field] !== null && lease?.[field] !== undefined);
}

function requirePendingClaimAnnotation({ local, headSha, owner, parkedStashValues }) {
  if (!local.fenceSha) {
    if (local.pullRequestUrl || hasCarriedParkedStash(local)) {
      throw new Error("Resume claim has partial annotation before its exact fence.");
    }
    return;
  }
  if (local.fenceSha !== headSha || local.pullRequestUrl !== owner.url) {
    throw new Error("Resume claim annotation does not match its exact local claim commit and pull request.");
  }
  requireCarriedParkedStash({ local, expected: parkedStashValues });
}

function completeParkedStashRestore({ branch, lease, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run }) {
  if (!lease.parkStashSha) return lease;
  if (!["pending", "restored"].includes(lease.parkStashStatus)) {
    throw new Error("Active parked-stash restoration has no exact pending or restored status.");
  }
  restoreParkedStashObject({ lease, repo: lease.worktreePath, gitText, gitOptional, run });
  let restored = lease;
  if (lease.parkStashStatus === "pending") {
    restored = leaseStore.annotate({ sessionId, branch, values: { parkStashStatus: "restored" } });
  }
  const pullRequest = requireOwnershipPullRequestDraft({ url: owner.url, branch, ghText, expectedDraft: true });
  const marker = parseWriterLeasePullRequestBody(pullRequest.body);
  const synchronized = marker?.status === restored.status && marker.epoch === restored.epoch &&
    PARK_STASH_FIELDS.every(field => marker[field] === restored[field]);
  if (!synchronized) {
    run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(pullRequest.body, restored)]);
  }
  requireOwnershipPullRequestDraft({ url: owner.url, branch, ghText, expectedDraft: true });
  return restored;
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
