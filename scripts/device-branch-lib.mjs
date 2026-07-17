import os from "node:os";

import {
  assertCanonicalReadPath,
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertSingleCanonicalWorktree,
} from "./repository-guards.mjs";

export function start({
  scope,
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  run,
  log = console.log,
}) {
  if (!scope) throw new Error("A semantic scope is required.");
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const device = sanitize(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const branch = `agent/${device}/${sanitize(scope)}`;
  requireNoCompetingPullRequest({ branch, ghText });
  run("git", ["fetch", "origin", "main"]);
  run("git", ["switch", "--create", branch, "origin/main"]);
  log(`Created ${branch}. Commit intentionally, then run npm run device:publish.`);
  return branch;
}

export function publish({
  invocationPath,
  repo,
  gitText,
  ghText,
  ghOptional,
  run,
  log = console.log,
}) {
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch || branch === "main") throw new Error("Publish from an agent/<device>/<scope> branch, never main.");
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  requireNoCompetingPullRequest({ branch, ghText });
  run("npm", ["run", "check"]);
  run("git", ["push", "--set-upstream", "origin", branch]);

  let url = ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!url) {
    const title = gitText(["log", "-1", "--pretty=%s"]).trim();
    url = ghText([
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      title,
      "--body",
      "Device branch published for protected CI and serialized auto-merge.",
      "--label",
      "automerge",
    ]);
  } else {
    run("gh", ["pr", "edit", "--add-label", "automerge"]);
  }
  run("gh", ["pr", "merge", "--auto", "--squash", url.trim()]);
  const trimmedUrl = url.trim();
  log(`Published ${trimmedUrl} with protected auto-merge enabled.`);
  return trimmedUrl;
}

export function park({
  invocationPath,
  repo,
  gitText,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch) throw new Error("Park from a branch checkout, not a detached HEAD.");

  let stashRef = null;
  if (gitText(["status", "--porcelain"]).trim()) {
    run("git", ["stash", "push", "-u", "-m", createParkMessage(branch, now())]);
    stashRef = gitText(["stash", "list", "--format=%gd", "-n", "1"]).trim();
  }

  if (branch !== "main") run("git", ["switch", "main"]);
  run("git", ["fetch", "origin", "main"]);
  run("git", ["merge", "--ff-only", "origin/main"]);

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

  const summary = stashRef
    ? `Parked ${branch} in ${stashRef}; main is now ${headSha.slice(0, 12)}.`
    : branch === "main"
      ? `main is already clean at ${headSha.slice(0, 12)}.`
      : `Switched from ${branch} to clean main at ${headSha.slice(0, 12)}.`;
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
  run("git", ["switch", "main"]);
  run("git", ["merge", "--ff-only", "origin/main"]);

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

function requireRepositorySafety({ invocationPath, repo, gitText }) {
  assertCanonicalReadPath({ root: repo, cwd: invocationPath });
  assertSingleCanonicalWorktree({ root: repo, porcelain: gitText(["worktree", "list", "--porcelain"]) });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
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
