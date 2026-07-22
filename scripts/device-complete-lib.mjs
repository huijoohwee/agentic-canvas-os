import path from "node:path";

import {
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
} from "./repository-guards.mjs";
import {
  dropParkedStashObject,
  requireParkedStashEvidence,
  requireParkedStashObject,
} from "./device-park-lib.mjs";

const PARK_STASH_IDENTITY_FIELDS = [
  "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha",
  "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus",
];

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
  if (!leaseStore) throw new Error("Completion requires the repository writer-lease store.");

  const attachedBranch = gitText(["branch", "--show-current"]).trim();
  const { branch, lease: completionLease } = resolveCompletionLease({
    attachedBranch, repo, leaseStore,
  });
  const parkedStashes = readStashEntries(gitText(["stash", "list", "--format=%H%x00%gd%x00%gs"]))
    .filter(entry => entry.subject.includes(`park: ${branch} `));
  const exactRestoredStash = requireCompletionStash({
    branch, lease: completionLease, parkedStashes, gitText,
  });

  const pullRequest = readPullRequest({ branch, ghText });
  requireMergedPullRequest(pullRequest);
  const mergeCommitSha = pullRequest.mergeCommit?.oid;
  const taskHeadSha = optionalGitText(gitText, ["rev-parse", `refs/heads/${branch}`]);
  if (!pullRequest.headRefOid || taskHeadSha !== pullRequest.headRefOid) {
    throw new Error(
      `Task branch HEAD ${taskHeadSha.slice(0, 12) || "unknown"} is not the merged pull-request head ${pullRequest.headRefOid?.slice(0, 12) || "unknown"}.`,
    );
  }
  if (attachedBranch && gitText(["rev-parse", "HEAD"]).trim() !== taskHeadSha) {
    throw new Error("Attached completion worktree is not at the exact merged task head.");
  }

  run("git", ["fetch", "origin", "main"]);
  const canonicalSha = gitText(["rev-parse", "origin/main"]).trim();
  run("git", ["merge-base", "--is-ancestor", mergeCommitSha, canonicalSha]);
  let durableLease = completionLease;
  if (["completing", "completed"].includes(completionLease?.status)) {
    requireCompletionEvidence({
      lease: completionLease, pullRequestUrl: pullRequest.url, mergeCommitSha,
    });
    run("git", ["merge-base", "--is-ancestor", completionLease.completion.mainSha, canonicalSha]);
  } else {
    durableLease = leaseStore.beginCompletion({
      branch,
      pullRequestUrl: pullRequest.url,
      mergeCommitSha,
      mainSha: canonicalSha,
    });
  }

  if (exactRestoredStash) {
    dropParkedStashObject({ lease: durableLease, repo, gitText, run });
  }
  detachCanonicalHead({ canonicalSha, gitText, run });
  const mainSha = canonicalSha;
  if (durableLease.status !== "completed") {
    durableLease = leaseStore.complete({
      branch,
      pullRequestUrl: pullRequest.url,
      mergeCommitSha,
      mainSha,
    });
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

function detachCanonicalHead({ canonicalSha, gitText, run }) {
  const attached = Boolean(gitText(["branch", "--show-current"]).trim());
  if (attached || gitText(["rev-parse", "HEAD"]).trim() !== canonicalSha) {
    run("git", ["switch", "--detach", canonicalSha]);
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== canonicalSha) {
    throw new Error(`Detached completion HEAD ${headSha.slice(0, 12)} does not match ${canonicalSha.slice(0, 12)}.`);
  }
  requireClean({ gitText, message: "main remains dirty after completion; resolve local changes before reporting completion." });
}

function resolveCompletionLease({ attachedBranch, repo, leaseStore }) {
  if (attachedBranch) {
    if (attachedBranch === "main") {
      throw new Error("Completion must begin on the merged agent/<device>/<scope> task branch.");
    }
    if (!attachedBranch.startsWith("agent/")) {
      throw new Error(`Refusing unexpected device branch: ${attachedBranch}`);
    }
    const lease = leaseStore.read?.(attachedBranch) || null;
    if (!lease) throw new Error(`No writer lease records ${attachedBranch}.`);
    return { branch: attachedBranch, lease };
  }
  const registry = leaseStore.read?.() || null;
  const matches = Object.values(registry?.leases || {}).filter(lease =>
    ["completing", "completed"].includes(lease?.status) && lease.worktreePath &&
    path.resolve(lease.worktreePath) === path.resolve(repo));
  if (matches.length !== 1) {
    throw new Error("Detached completion replay requires one exact completing lease for this worktree.");
  }
  return { branch: matches[0].branch, lease: matches[0] };
}

function requireCompletionStash({ branch, lease, parkedStashes, gitText }) {
  const hasStashEvidence = PARK_STASH_IDENTITY_FIELDS.some(field =>
    lease?.[field] !== null && lease?.[field] !== undefined);
  let exactRestoredStash = false;
  if (hasStashEvidence) {
    const evidence = requireParkedStashEvidence(lease);
    if (evidence?.status !== "restored") throw new Error("Completion requires exact restored stash evidence.");
    const refSha = optionalGitText(gitText, ["show-ref", "--hash", "--verify", evidence.ref]);
    const cleanupReplay = ["completing", "completed"].includes(lease.status) && !refSha &&
      !parkedStashes.some(entry => entry.sha === evidence.sha);
    if (!cleanupReplay) {
      requireParkedStashObject({
        lease,
        gitText,
        gitOptional: args => optionalGitText(gitText, args),
      });
    }
    exactRestoredStash = true;
  }
  const unresolved = parkedStashes.filter(entry => !exactRestoredStash || entry.sha !== lease.parkStashSha);
  if (unresolved.length || (parkedStashes.length && !exactRestoredStash)) {
    throw new Error(`Task remains parked in a named stash for ${branch}; restore and integrate it before completion.`);
  }
  return exactRestoredStash;
}

function requireMergedPullRequest(pullRequest) {
  if (pullRequest.baseRefName !== "main") {
    throw new Error(`Pull request ${pullRequest.url} targets ${pullRequest.baseRefName}, not main.`);
  }
  if (pullRequest.state !== "MERGED") {
    throw new Error(
      `Task remains pending: pull request ${pullRequest.url} is ${pullRequest.state.toLowerCase()}, not merged. Use device:park only when pausing or blocked.`,
    );
  }
  if (!pullRequest.mergeCommit?.oid) {
    throw new Error(`Merged pull request ${pullRequest.url} has no merge commit SHA.`);
  }
}

function requireCompletionEvidence({ lease, pullRequestUrl, mergeCommitSha }) {
  if (lease.pullRequestUrl !== pullRequestUrl || lease.completion?.mergeCommitSha !== mergeCommitSha ||
      !/^[0-9a-f]{40}$/.test(String(lease.completion?.mainSha || ""))) {
    throw new Error(`Completion evidence for ${lease.branch} does not match its merged pull request.`);
  }
}

function readStashEntries(output) {
  return String(output).split("\n").flatMap(line => {
    const [sha, selector, subject] = line.split("\0");
    return sha && selector && subject ? [{ sha, selector, subject }] : [];
  });
}

function optionalGitText(gitText, args) {
  try {
    return gitText(args).trim();
  } catch {
    return "";
  }
}

function requireRepositorySafety({ invocationPath, repo, gitText }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) {
    throw new Error(`Repository commands must start at the registered worktree root ${repo}; received ${invocationPath}`);
  }
  assertRegisteredWorktree({ cwd: repo, porcelain: gitText(["worktree", "list", "--porcelain", "-z"]) });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
}

function requireClean({ gitText, message = "Working tree is not clean. Commit intentionally before switching or publishing." }) {
  if (gitText(["status", "--porcelain"]).trim()) throw new Error(message);
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
