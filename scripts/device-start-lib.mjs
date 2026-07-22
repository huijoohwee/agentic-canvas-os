import os from "node:os";
import path from "node:path";

import { sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
import {
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
} from "./repository-guards.mjs";
import {
  parseDeviceBranch,
  renderWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
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
  now = () => new Date(),
}) {
  if (!scope) throw new Error("A semantic scope is required.");
  requireSession(sessionId);
  const worktree = requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean(gitText);
  const device = sanitizeDevice(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const normalizedScope = sanitizeScope(scope);
  const branch = `agent/${device}/${normalizedScope}`;
  if (!parseDeviceBranch(branch)) throw new Error(`Generated branch does not satisfy the device branch contract: ${branch}`);

  run("git", ["fetch", "origin", "main"]);
  const currentBranch = gitText(["branch", "--show-current"]).trim();
  if (currentBranch && currentBranch !== branch) {
    throw new Error(`device:start recovery expected ${branch}, not attached branch ${currentBranch}.`);
  }
  const openBefore = readOpenPullRequests(ghText);
  const existingOwner = requireSingleOwner(openBefore, branch);
  let lease = leaseStore.read?.(branch) || null;
  let freshClaim = false;

  if (lease) {
    requireRecoverableLease({ lease, branch, device, scope: normalizedScope, repo, sessionId });
    if (!currentBranch && !worktree.detached) throw new Error("device:start recovery requires a detached or exact attached task worktree.");
    if (Date.parse(lease.expiresAt) <= now().getTime() && lease.pullRequestUrl) {
      throw new Error("Completed start lease expired; use the explicit park/resume handoff instead of renewing it through start.");
    }
    lease = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
  } else {
    if (currentBranch || !worktree.detached) {
      throw new Error("device:start requires a detached registered task worktree; keep main checked out in its canonical worktree.");
    }
    if (existingOwner) throw new Error(`Pull request ${existingOwner.url} exists for ${branch} without its exact local lease.`);
    const localCollision = gitOptional(["show-ref", "--hash", "--verify", `refs/heads/${branch}`]).trim();
    const remoteCollision = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).trim();
    if (localCollision || remoteCollision) {
      throw new Error(`Task branch collision for ${branch}; local and remote refs must both be absent before claim.`);
    }
    const detachedSha = gitText(["rev-parse", "HEAD"]).trim();
    const baseSha = gitText(["rev-parse", "origin/main"]).trim();
    if (detachedSha !== baseSha) {
      throw new Error(`Task worktree must start at fetched origin/main ${baseSha}; received ${detachedSha}.`);
    }
    lease = leaseStore.claim({
      sessionId,
      device,
      scope: normalizedScope,
      branch,
      worktreePath: repo,
      baseSha,
      ttlMs: leaseTtlMs,
    });
    freshClaim = true;
  }

  if (!currentBranch) {
    const localRef = gitOptional(["show-ref", "--hash", "--verify", `refs/heads/${branch}`]).trim();
    if (freshClaim && localRef) {
      rollbackFreshClaim({ leaseStore, lease, sessionId, branch });
      throw new Error(`Task branch ${branch} appeared after its collision preflight; the fresh lease was rolled back.`);
    }
    if (localRef && localRef !== lease.baseSha) {
      throw new Error(`Unattached local ${branch} is ${localRef}, not the exact activation base ${lease.baseSha}.`);
    }
    try {
      if (localRef) run("git", ["switch", branch]);
      else run("git", ["switch", "--create", branch, lease.baseSha]);
    } catch (error) {
      if (freshClaim) rollbackFreshClaim({ leaseStore, lease, sessionId, branch });
      throw error;
    }
  }

  let headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (!lease.fenceSha && headSha === lease.baseSha) {
    run("git", ["commit", "--allow-empty", "-m", claimSubject(lease)]);
    headSha = gitText(["rev-parse", "HEAD"]).trim();
    lease = leaseStore.annotate({ sessionId, branch, values: { fenceSha: headSha } });
  } else {
    requireExactClaimCommit({ lease, headSha, gitText });
    if (!lease.fenceSha) lease = leaseStore.annotate({ sessionId, branch, values: { fenceSha: headSha } });
  }

  run("git", ["push", "--set-upstream", "origin", branch]);
  const owner = requireSingleOwner(readOpenPullRequests(ghText), branch);
  let url;
  if (lease.pullRequestUrl) {
    if (!owner || owner.url !== lease.pullRequestUrl || owner.isDraft !== true) {
      throw new Error(`Draft pull request evidence for ${branch} does not match ${lease.pullRequestUrl}.`);
    }
    url = owner.url;
    run("gh", ["pr", "edit", url, "--body", updateWriterLeasePullRequestBody(owner.body, lease)]);
  } else if (owner) {
    if (owner.isDraft !== true) throw new Error(`Recovered pull request ${owner.url} is not draft.`);
    url = owner.url;
    lease = leaseStore.annotate({ sessionId, branch, values: { pullRequestUrl: url } });
    run("gh", ["pr", "edit", url, "--body", updateWriterLeasePullRequestBody(owner.body, lease)]);
  } else {
    url = ghText([
      "pr", "create", "--draft", "--base", "main", "--head", branch,
      "--title", `WIP: ${normalizedScope}`, "--body", renderWriterLeasePullRequestBody(lease),
    ]).trim();
    if (!url) throw new Error(`GitHub did not return a draft pull request URL for ${branch}.`);
    lease = leaseStore.annotate({ sessionId, branch, values: { pullRequestUrl: url } });
  }
  log(`Claimed ${branch} in ${url} with fence ${headSha.slice(0, 12)}; heartbeat before ${lease.expiresAt}.`);
  return branch;
}

function requireExactClaimCommit({ lease, headSha, gitText }) {
  if (lease.fenceSha && headSha !== lease.fenceSha) {
    throw new Error(`Activation HEAD ${headSha} does not match its recorded fence ${lease.fenceSha}.`);
  }
  const parents = gitText(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  if (parents.length !== 2 || parents[0] !== headSha || parents[1] !== lease.baseSha) {
    throw new Error("Activation recovery requires the exact single-parent claim commit.");
  }
  if (gitText(["log", "-1", "--pretty=%s"]).trim() !== claimSubject(lease)) {
    throw new Error("Activation recovery claim subject does not match its lease epoch.");
  }
}

function claimSubject(lease) {
  return `chore(coordination): claim ${lease.scope} lease ${lease.epoch}`;
}

function rollbackFreshClaim({ leaseStore, lease, sessionId, branch }) {
  leaseStore.rollbackClaim({ sessionId, branch, epoch: lease.epoch, fenceSha: null, previousLease: null });
}

function requireRecoverableLease({ lease, branch, device, scope, repo, sessionId }) {
  if (lease.status !== "active" || lease.sessionId !== sessionId || lease.branch !== branch ||
      lease.device !== device || lease.scope !== scope || path.resolve(lease.worktreePath) !== path.resolve(repo) ||
      !/^[0-9a-f]{40}$/.test(String(lease.baseSha || ""))) {
    throw new Error(`Existing writer lease for ${branch} is not this exact recoverable activation.`);
  }
}

function readOpenPullRequests(ghText) {
  return JSON.parse(ghText([
    "pr", "list", "--state", "open", "--base", "main", "--limit", "100",
    "--json", "number,headRefName,url,body,isDraft",
  ]));
}

function requireSingleOwner(pulls, branch) {
  const owner = assertNoCompetingPullRequests(pulls, branch);
  const exact = pulls.filter(pull => pull.headRefName === branch);
  if (exact.length > 1) throw new Error(`Multiple open pull requests claim ${branch}.`);
  return owner || null;
}

function requireRepositorySafety({ invocationPath, repo, gitText }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) {
    throw new Error(`Repository commands must start at the registered worktree root ${repo}; received ${invocationPath}`);
  }
  const worktree = assertRegisteredWorktree({ cwd: repo, porcelain: gitText(["worktree", "list", "--porcelain", "-z"]) });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
  return worktree;
}

function requireClean(gitText) {
  if (gitText(["status", "--porcelain"]).trim()) throw new Error("Working tree is not clean before device:start.");
}

function requireSession(sessionId) {
  if (!String(sessionId || "").trim()) throw new Error("A stable session id is required through --session=<id> or AGENTIC_SESSION_ID.");
}
