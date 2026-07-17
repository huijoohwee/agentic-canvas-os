#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { completeSession, heartbeat, park, publish, resume, start } from "./device-branch-lib.mjs";
import { createWriterLeaseStore, DEFAULT_WRITER_LEASE_TTL_MS } from "./writer-lease-lib.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command || !["start", "resume", "heartbeat", "publish", "park", "complete", "end"].includes(command)) usage();

const json = args.includes("--json");
const rawScope = args.find((value) => !value.startsWith("--"));
const sessionId = readOption(args, "session") || process.env.AGENTIC_SESSION_ID || "";
const ttlSeconds = Number(readOption(args, "ttl-seconds") || DEFAULT_WRITER_LEASE_TTL_MS / 1000);
if (!Number.isFinite(ttlSeconds)) throw new Error("--ttl-seconds must be numeric.");
if (sessionId) process.env.AGENTIC_SESSION_ID = sessionId;

const invocationPath = path.resolve(
  readOption(args, "repository") || process.env.AGENTIC_TARGET_REPOSITORY || process.env.INIT_CWD || process.cwd(),
);
process.chdir(invocationPath);
const repo = gitText(["rev-parse", "--show-toplevel"]).trim();
process.chdir(repo);
configureHooks();
const gitCommonDir = path.resolve(repo, gitText(["rev-parse", "--git-common-dir"]).trim());
const leaseStore = createWriterLeaseStore({ gitCommonDir });

const context = {
  scope: rawScope,
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  ghOptional,
  leaseStore,
  sessionId,
  leaseTtlMs: ttlSeconds * 1000,
  run,
  log: console.log,
  now: () => new Date(),
};

if (command === "start") start(context);
if (command === "resume") resume({ ...context, branchName: rawScope });
if (command === "heartbeat") heartbeat(context);
if (command === "publish") publish(context);
if (command === "park") park(context);
if (command === "complete" || command === "end") completeSession({ ...context, json });

function configureHooks() {
  run("git", ["config", "core.hooksPath", ".githooks"]);
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
  console.error(
    "Usage: node scripts/device-branch.mjs start <scope> --session=<id> --repository=<path> [--ttl-seconds=<n>] | resume <agent/device/scope> --session=<id> --repository=<path> | heartbeat --session=<id> --repository=<path> | publish --session=<id> --repository=<path> | park --session=<id> --repository=<path> | complete --repository=<path> | end --repository=<path> [--json]",
  );
  process.exit(2);
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}
