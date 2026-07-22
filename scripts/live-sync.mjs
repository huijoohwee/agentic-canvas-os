#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { assertMainWorktree } from "./repository-guards.mjs";

const watch = process.argv.includes("--watch");
const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
const intervalSeconds = Math.max(5, Math.min(300, Number(intervalArg?.split("=")[1] || 20)));
const root = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();

await syncOnce();
if (watch) {
  console.log(`Watching origin/main every ${intervalSeconds}s. Stop with Ctrl-C.`);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    await syncOnce();
  }
}

async function syncOnce() {
  assertMainWorktree({
    cwd: root,
    porcelain: gitText(root, ["worktree", "list", "--porcelain", "-z"]),
  });

  run(root, "git", ["fetch", "--quiet", "origin", "main"]);
  const branch = gitText(root, ["branch", "--show-current"]).trim();
  if (branch !== "main") throw new Error(`Live sync updates canonical main only; current branch is ${branch || "detached"}`);
  const status = gitText(root, ["status", "--porcelain"]).trim();
  if (status) {
    throw new Error(`Canonical checkout is dirty; commit or restore the owned changes before live sync: ${root}`);
  }
  const before = gitText(root, ["rev-parse", "HEAD"]).trim();
  const after = gitText(root, ["rev-parse", "origin/main"]).trim();
  if (before === after) return;
  run(root, "git", ["merge", "--ff-only", after]);
  const integrated = gitText(root, ["rev-parse", "HEAD"]).trim();
  if (integrated !== after || gitText(root, ["status", "--porcelain"]).trim()) {
    throw new Error(`Canonical checkout did not integrate the exact pinned main object ${after}.`);
  }
  console.log(`Canonical checkout updated ${before.slice(0, 12)} -> ${after.slice(0, 12)}.`);
}

function gitText(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
