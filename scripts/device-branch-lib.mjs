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

export function endSession({
  invocationPath,
  repo,
  gitText,
  run,
  log = console.log,
  now = () => new Date(),
  json = false,
}) {
  const result = park({
    invocationPath,
    repo,
    gitText,
    run,
    log: () => {},
    now,
  });
  const summary = {
    parkedBranch: result.branch,
    stashRef: result.stashRef,
    mainSha: result.headSha,
    status: "ok",
  };

  if (json) {
    log(JSON.stringify(summary));
    return summary;
  }

  const message = summary.stashRef
    ? `Session ended: parked ${summary.parkedBranch} in ${summary.stashRef}; clean main is ${summary.mainSha.slice(0, 12)}.`
    : summary.parkedBranch === "main"
      ? `Session ended: main is already clean at ${summary.mainSha.slice(0, 12)}.`
      : `Session ended: returned from ${summary.parkedBranch} to clean main at ${summary.mainSha.slice(0, 12)}.`;
  log(message);
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
