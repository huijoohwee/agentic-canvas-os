#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  createWriterLeaseStore,
  parseDeviceBranch,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  readOwnershipPullRequest,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";

const args = process.argv.slice(2);

main();

function main() {
try {
  const sessionId = required(readOption("session") || process.env.AGENTIC_SESSION_ID, "A stable --session or AGENTIC_SESSION_ID");
  process.env.AGENTIC_SESSION_ID = sessionId;
  const invocationPath = path.resolve(readOption("repository") || process.cwd());
  const worktreePath = gitText(["rev-parse", "--show-toplevel"], { cwd: invocationPath });
  const branch = gitText(["branch", "--show-current"], { cwd: worktreePath });
  const identity = parseDeviceBranch(branch);
  if (!identity) {
    throw new Error("Legacy refresh requires an attached agent/<device>/<semantic-scope> branch.");
  }
  if (gitText(["status", "--short"], { cwd: worktreePath })) {
    throw new Error("Legacy refresh requires a clean worktree.");
  }
  git(["fetch", "origin", "main", branch], { cwd: worktreePath });
  const gitCommonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd: worktreePath });
  const gitCommonDir = path.isAbsolute(gitCommonDirRaw)
    ? gitCommonDirRaw
    : path.resolve(worktreePath, gitCommonDirRaw);
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
  const existing = leaseStore.read(branch);
  if (existing?.admission || existing?.cloudAuthority) {
    throw new Error("Legacy refresh refuses cloud-admitted lanes; use the repository handoff or reclaim path instead.");
  }
  const pullRequest = findPullRequest({ branch, cwd: worktreePath });
  if (!pullRequest) {
    throw new Error(`Legacy refresh requires an open ownership pull request for ${branch}.`);
  }
  const startHeadSha = gitText(["rev-parse", "HEAD"], { cwd: worktreePath });
  leaseStore.claim({
    sessionId,
    device: identity.device || sanitizeDevice(os.hostname()),
    scope: identity.scope,
    branch,
    worktreePath,
    baseSha: startHeadSha,
    previousEpoch: Number(existing?.epoch || 0),
  });
  leaseStore.annotate({
    sessionId,
    branch,
    values: {
      fenceSha: startHeadSha,
      pullRequestUrl: pullRequest.url,
    },
  });
  let merged = false;
  try {
    git(["merge", "--no-edit", "origin/main"], { cwd: worktreePath });
    merged = true;
  } catch (error) {
    throw new Error(`Legacy refresh merge failed: ${String(error?.message || error)}`);
  }
  const refreshedHeadSha = gitText(["rev-parse", "HEAD"], { cwd: worktreePath });
  const lease = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      fenceSha: refreshedHeadSha,
      pullRequestUrl: pullRequest.url,
    },
  });
  git(["push", "--set-upstream", "origin", branch], { cwd: worktreePath });
  const refreshedPullRequest = waitForOwnershipPullRequestHead({
    url: pullRequest.url,
    branch,
    expectedHeadSha: refreshedHeadSha,
    ghText: command => ghText(command, { cwd: worktreePath }),
  });
  gh([
    "pr",
    "edit",
    pullRequest.url,
    "--body",
    updateWriterLeasePullRequestBody(refreshedPullRequest.body, lease),
  ], { cwd: worktreePath });
  console.log(JSON.stringify({
    schema: "agentic-legacy-clean-committed-lane-refresh-result/v1",
    status: "refreshed",
    branch,
    pullRequestUrl: pullRequest.url,
    previousHeadSha: startHeadSha,
    refreshedHeadSha,
    epoch: lease.epoch,
    merged,
    sessionId,
  }));
} catch (error) {
  console.error(JSON.stringify({
    schema: "agentic-legacy-clean-committed-lane-refresh-result/v1",
    status: "blocked",
    message: publicMessage(error),
  }));
  process.exitCode = 1;
}
}

function publicMessage(error) {
  return String(error instanceof Error ? error.message : error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 240);
}

function findPullRequest({ branch, cwd }) {
  const pulls = JSON.parse(ghText([
    "pr",
    "list",
    "--state",
    "open",
    "--head",
    branch,
    "--base",
    "main",
    "--json",
    "url,headRefName",
  ], { cwd }));
  return pulls.find(pull => pull.headRefName === branch) || null;
}

function sanitizeDevice(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function readOption(name) {
  const prefix = `--${name}=`;
  const value = args.find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : "";
}

function required(value, label) {
  const resolved = String(value || "").trim();
  if (!resolved) throw new Error(`${label} is required.`);
  return resolved;
}

function git(args, { cwd }) {
  execFileSync("git", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function gitText(args, { cwd }) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  }).trim();
}

function gh(args, { cwd }) {
  execFileSync("gh", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function ghText(args, { cwd }) {
  return execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  }).trim();
}
