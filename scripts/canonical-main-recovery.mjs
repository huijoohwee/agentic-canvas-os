#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import { recoverCanonicalMain } from "./canonical-main-recovery-lib.mjs";
import { textCommandOptions } from "./command-text-options.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const repository = path.resolve(readOption(args, "repository") || "");
const sessionId = readOption(args, "session") || process.env.AGENTIC_SESSION_ID || "";
const expectedLocalHead = readOption(args, "expected-local-head");
const expectedOriginHead = readOption(args, "expected-origin-head");
const acknowledged = args.includes("--acknowledge-equivalent-realignment");

try {
  if (!readOption(args, "repository")) usage();
  process.chdir(repository);
  const repo = path.resolve(gitText(["rev-parse", "--show-toplevel"]).trim());
  process.chdir(repo);
  const result = recoverCanonicalMain({
    acknowledged,
    invocationPath: repository,
    repo,
    sessionId,
    expectedLocalHead,
    expectedOriginHead,
    gitText,
    gitOptional,
    gitSucceeds,
    gitPatchId,
    gitHashObject,
    run,
    log: json ? () => {} : console.log,
  });
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify({
    schema: "agentic-canonical-main-recovery-result/v1",
    status: "error",
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
    },
  })}\n`);
  process.exitCode = 1;
}

function gitText(gitArgs) {
  return execFileSync("git", gitArgs, textCommandOptions());
}

function gitOptional(gitArgs) {
  const result = spawnSync("git", gitArgs, textCommandOptions());
  return result.status === 0 ? result.stdout : "";
}

function gitSucceeds(gitArgs) {
  return spawnSync("git", gitArgs, { stdio: "ignore" }).status === 0;
}

function gitPatchId(commit) {
  const patch = execFileSync(
    "git",
    ["show", "--pretty=medium", "--binary", "--full-index", "--no-ext-diff", commit],
    textCommandOptions(),
  );
  return execFileSync("git", ["patch-id", "--stable"], textCommandOptions({ input: patch })).trim();
}

function gitHashObject(payload) {
  return execFileSync(
    "git",
    ["hash-object", "-w", "--stdin"],
    textCommandOptions({ input: payload }),
  ).trim();
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: json ? ["ignore", "ignore", "inherit"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function usage() {
  throw new Error(
    "Usage: node scripts/canonical-main-recovery.mjs " +
    "--repository=<primary-main-worktree> --session=<stable-session-id> " +
    "--expected-local-head=<sha> --expected-origin-head=<sha> " +
    "--acknowledge-equivalent-realignment [--json]",
  );
}
