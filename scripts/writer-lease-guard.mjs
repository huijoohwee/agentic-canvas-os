#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertWorktreeRegistry } from "./repository-guards.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const repo = git(["rev-parse", "--show-toplevel"]);
const branch = git(["branch", "--show-current"]);
if (!branch.startsWith("agent/")) process.exit(0);

const sessionId = String(process.env.AGENTIC_SESSION_ID || "").trim();
if (!sessionId) fail("Agent branches require AGENTIC_SESSION_ID from the active device:start claim.");

const gitCommonDir = path.resolve(repo, git(["rev-parse", "--git-common-dir"]));
const store = createWriterLeaseStore({ gitCommonDir });
try {
  assertWorktreeRegistry({ porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
  const lease = store.verify({ sessionId, branch });
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Writer lease owns worktree ${lease.worktreePath}, not ${repo}.`);
  }
  process.stdout.write(`[writer-lease] ${lease.scope} epoch ${lease.epoch} owner verified\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message) {
  process.stderr.write(`[writer-lease] ${message}\n`);
  process.exit(1);
}
