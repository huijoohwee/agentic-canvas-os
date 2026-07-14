#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import {
  assertCanonicalReadPath,
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertSingleCanonicalWorktree,
} from "./repository-guards.mjs";

const [command, rawScope] = process.argv.slice(2);
if (!command || !["start", "publish"].includes(command)) usage();

const invocationPath = process.cwd();
const repo = gitText(["rev-parse", "--show-toplevel"]).trim();
process.chdir(repo);
configureHooks();

if (command === "start") start(rawScope);
if (command === "publish") publish();

function start(scope) {
  if (!scope) usage();
  requireRepositorySafety();
  requireClean();
  const device = sanitize(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const branch = `agent/${device}/${sanitize(scope)}`;
  requireNoCompetingPullRequest(branch);
  run("git", ["fetch", "origin", "main"]);
  run("git", ["switch", "--create", branch, "origin/main"]);
  console.log(`Created ${branch}. Commit intentionally, then run npm run device:publish.`);
}

function publish() {
  requireRepositorySafety();
  requireClean();
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch || branch === "main") throw new Error("Publish from an agent/<device>/<scope> branch, never main.");
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  requireNoCompetingPullRequest(branch);
  run("npm", ["run", "check"]);
  run("git", ["push", "--set-upstream", "origin", branch]);

  let url = ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!url) {
    const title = gitText(["log", "-1", "--pretty=%s"]).trim();
    url = ghText(["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", "Device branch published for protected CI and serialized auto-merge.", "--label", "automerge"]);
  } else {
    run("gh", ["pr", "edit", "--add-label", "automerge"]);
  }
  run("gh", ["pr", "merge", "--auto", "--squash", url.trim()]);
  console.log(`Published ${url.trim()} with protected auto-merge enabled.`);
}

function configureHooks() {
  run("git", ["config", "core.hooksPath", ".githooks"]);
}

function requireRepositorySafety() {
  assertCanonicalReadPath({ root: repo, cwd: invocationPath });
  assertSingleCanonicalWorktree({ root: repo, porcelain: gitText(["worktree", "list", "--porcelain"]) });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
}

function requireNoCompetingPullRequest(branch) {
  const pulls = JSON.parse(ghText(["pr", "list", "--state", "open", "--base", "main", "--limit", "100", "--json", "number,headRefName,url"]));
  assertNoCompetingPullRequests(pulls, branch);
}

function requireClean() {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Working tree is not clean. Commit intentionally before switching or publishing.");
  }
}

function sanitize(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Device/scope must contain an ASCII letter or number.");
  return normalized.slice(0, 48);
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function gitOptional(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function ghText(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function ghOptional(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function usage() {
  console.error("Usage: node scripts/device-branch.mjs start <scope> | publish");
  process.exit(2);
}
