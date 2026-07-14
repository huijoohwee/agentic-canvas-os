#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { park, publish, start } from "./device-branch-lib.mjs";

const [command, rawScope] = process.argv.slice(2);
if (!command || !["start", "publish", "park"].includes(command)) usage();

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
  console.error("Usage: node scripts/device-branch.mjs start <scope> | publish | park");
  process.exit(2);
}
