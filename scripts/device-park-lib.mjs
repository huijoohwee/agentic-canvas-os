import path from "node:path";

import { assertNoUnmergedPaths, assertRegisteredWorktree } from "./repository-guards.mjs";
import { parseWriterLeasePullRequestBody, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";

export function park({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  const worktree = requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch) return replayDetachedPark({ worktree, repo, gitText, gitOptional, ghText, leaseStore, sessionId, run, log });
  const instant = now();
  let stashRef = null;

  if (branch === "main") {
    if (gitText(["status", "--porcelain"]).trim()) {
      run("git", ["stash", "push", "-u", "-m", createParkMessage(branch, instant)]);
      stashRef = gitText(["stash", "list", "--format=%gd", "-n", "1"]).trim();
    }
    run("git", ["fetch", "origin", "main"]);
    run("git", ["merge", "--ff-only", "origin/main"]);
    const headSha = requireCleanMain(gitText);
    log(stashRef ? `Parked ${branch} in ${stashRef}; task worktree is detached at ${headSha.slice(0, 12)}.` : `main is already clean at ${headSha.slice(0, 12)}.`);
    return { branch, headSha, stashRef };
  }
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  requireSession(sessionId);

  let lease = leaseStore.read?.(branch) || leaseStore.verify({ sessionId, branch, allowExpired: true });
  if (!lease || !["active", "parked"].includes(lease.status) || lease.sessionId !== sessionId) {
    throw new Error(`No active or replayable parked lease belongs to this session for ${branch}.`);
  }
  if (lease.status === "active") lease = leaseStore.verify({ sessionId, branch, allowExpired: true });
  assertLeaseWorktree(lease, repo);
  requireRemoteFence({ branch, lease, gitOptional });
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);

  if (lease.status === "active") {
    if (!lease.pullRequestUrl) throw new Error("Park requires the exact ownership pull request created by device:start.");
    if (gitText(["status", "--porcelain"]).trim()) {
      run("git", ["stash", "push", "-u", "-m", createParkMessage(branch, instant)]);
      stashRef = gitText(["stash", "list", "--format=%gd", "-n", "1"]).trim();
    }
    run("git", ["fetch", "origin", "main"]);
    const timestamp = instant.toISOString();
    const parkHeadSha = gitText(["rev-parse", "origin/main"]).trim();
    if (!/^[0-9a-f]{40}$/.test(parkHeadSha)) throw new Error("Park requires an exact origin/main commit SHA.");
    const parkValues = { parkHeadSha, parkStashRef: stashRef };
    const projected = { ...lease, ...parkValues, status: "parked", heartbeatAt: timestamp, expiresAt: timestamp };
    run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
      readRemotePullRequestBody({ url: lease.pullRequestUrl, ghText }), projected,
    )]);
    lease = leaseStore.release({
      sessionId,
      branch,
      status: "parked",
      expectedLease: lease,
      timestamp,
      values: parkValues,
    });
  } else {
    requireClean(gitText);
    requireParkedPullRequest(lease, ghText);
    run("git", ["fetch", "origin", "main"]);
  }

  run("git", ["switch", "--detach", "origin/main"]);
  const headSha = requireCleanMain(gitText);
  const summary = stashRef
    ? `Parked ${branch} in ${stashRef}; task worktree is detached at ${headSha.slice(0, 12)}.`
    : `Detached the task worktree from ${branch} at ${headSha.slice(0, 12)}.`;
  log(summary);
  return { branch, headSha, stashRef };
}

export function createParkMessage(branch, date = new Date()) {
  return `park: ${branch} ${formatParkTimestamp(date)}`;
}

export function formatParkTimestamp(date = new Date()) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function replayDetachedPark({ worktree, repo, gitText, gitOptional, ghText, leaseStore, sessionId, run, log }) {
  requireSession(sessionId);
  if (!worktree.detached) throw new Error("Detached park replay requires a registered detached task worktree.");
  const registry = leaseStore.read();
  const candidates = Object.values(registry?.leases || {}).filter(candidate =>
    candidate?.status === "parked" && candidate.sessionId === sessionId &&
    candidate.worktreePath && path.resolve(candidate.worktreePath) === path.resolve(repo));
  if (candidates.length !== 1) throw new Error("Detached park replay requires exactly one parked lease for this session and worktree.");
  const lease = candidates[0];
  if (!/^[0-9a-f]{40}$/.test(String(lease.parkHeadSha || ""))) throw new Error("Detached park replay lacks its exact parked main SHA.");
  requireRemoteFence({ branch: lease.branch, lease, gitOptional });
  requireParkedPullRequest(lease, ghText);
  requireClean(gitText);
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== lease.parkHeadSha) throw new Error(`Detached park HEAD ${headSha} does not match ${lease.parkHeadSha}.`);
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, lease.branch]);
  log(`Park already completed for ${lease.branch} at ${headSha.slice(0, 12)}.`);
  return { branch: lease.branch, headSha, stashRef: lease.parkStashRef ?? null };
}

function requireParkedPullRequest(lease, ghText) {
  if (!lease.pullRequestUrl) throw new Error("Parked replay lacks its ownership pull request.");
  const remote = parseWriterLeasePullRequestBody(readRemotePullRequestBody({ url: lease.pullRequestUrl, ghText }));
  for (const field of ["status", "epoch", "sessionId", "branch", "baseSha", "fenceSha", "heartbeatAt", "expiresAt", "parkHeadSha", "parkStashRef"]) {
    if (remote?.[field] !== lease[field]) throw new Error(`Parked pull request evidence disagrees on ${field}.`);
  }
}

function readRemotePullRequestBody({ url, ghText }) {
  return ghText(["pr", "view", url, "--json", "body", "--jq", ".body"]);
}

function requireRemoteFence({ branch, lease, gitOptional }) {
  const remoteSha = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] || "";
  if (!lease.fenceSha || remoteSha !== lease.fenceSha) {
    throw new Error(`Remote fence for ${branch} is ${remoteSha || "missing"}, not ${lease.fenceSha || "unclaimed"}; this session is stale.`);
  }
}

function requireCleanMain(gitText) {
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalSha = gitText(["rev-parse", "origin/main"]).trim();
  if (headSha !== canonicalSha) throw new Error(`main must match origin/main after park; local main is ${headSha.slice(0, 12)} but origin/main is ${canonicalSha.slice(0, 12)}`);
  requireClean(gitText);
  return headSha;
}

function requireClean(gitText) {
  if (gitText(["status", "--porcelain"]).trim()) throw new Error("Worktree remains dirty after park; resolve local changes before continuing.");
}

function requireRepositorySafety({ invocationPath, repo, gitText }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) throw new Error(`Repository commands must start at the registered worktree root ${repo}; received ${invocationPath}`);
  const worktree = assertRegisteredWorktree({ cwd: repo, porcelain: gitText(["worktree", "list", "--porcelain", "-z"]) });
  assertNoUnmergedPaths({ conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]), indexEntries: gitText(["ls-files", "-u"]) });
  return worktree;
}

function assertLeaseWorktree(lease, repo) {
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) throw new Error(`Writer lease owns worktree ${lease.worktreePath}, not ${repo}.`);
}

function requireSession(sessionId) {
  if (!String(sessionId || "").trim()) throw new Error("A stable session id is required through --session=<id> or AGENTIC_SESSION_ID.");
}
