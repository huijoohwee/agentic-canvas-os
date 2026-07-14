#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { endSession, park, publish, start } from "./device-branch-lib.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command || !["start", "publish", "park", "end"].includes(command)) usage();

const json = args.includes("--json");
const rawScope = args.find((value) => !value.startsWith("--"));

const invocationPath = process.cwd();
const repo = gitText(["rev-parse", "--show-toplevel"]).trim();
process.chdir(repo);
configureHooks();

const context = {
  scope: rawScope,
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  ghOptional,
  run,
  log: console.log,
  now: () => new Date(),
};

if (command === "start") start(context);
if (command === "publish") publish(context);
if (command === "park") park(context);
if (command === "end") endSession({ ...context, json });

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
  console.error("Usage: node scripts/device-branch.mjs start <scope> | publish | park | end [--json]");
  process.exit(2);
}
