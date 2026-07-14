#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
const intervalSeconds = Math.max(5, Math.min(300, Number(intervalArg?.split("=")[1] || 20)));
const root = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const livePath = path.resolve(process.env.AGENTIC_LIVE_WORKTREE || `${root}-live`);

await syncOnce();
if (watch) {
  console.log(`Watching origin/main every ${intervalSeconds}s. Stop with Ctrl-C.`);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    await syncOnce();
  }
}

async function syncOnce() {
  run(root, "git", ["fetch", "--quiet", "origin", "main"]);
  if (!existsSync(livePath)) {
    run(root, "git", ["worktree", "add", "--detach", livePath, "origin/main"]);
    console.log(`Created clean live worktree at ${livePath}.`);
    return;
  }

  const status = gitText(livePath, ["status", "--porcelain"]).trim();
  if (status) {
    console.error(`Live worktree is dirty; leaving it untouched: ${livePath}`);
    return;
  }
  const before = gitText(livePath, ["rev-parse", "HEAD"]).trim();
  const after = gitText(root, ["rev-parse", "origin/main"]).trim();
  if (before === after) return;
  run(livePath, "git", ["switch", "--detach", "origin/main"]);
  console.log(`Live worktree updated ${before.slice(0, 12)} -> ${after.slice(0, 12)}.`);
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
