#!/usr/bin/env node

import { buildLifecycleReport, cleanupCompletedWorktree } from "./worktree-lifecycle-lib.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["check", "cleanup"].includes(command)) usage();
const repository = readOption(args, "repository") || process.cwd();
const report = buildLifecycleReport({ repository });

if (command === "cleanup") {
  const target = readOption(args, "worktree");
  if (!target) throw new Error("cleanup requires --worktree=<registered-task-worktree>.");
  const result = cleanupCompletedWorktree({ report, target });
  console.log(JSON.stringify({ schema: report.schema, status: "cleaned", ...result }));
} else {
  console.log(JSON.stringify(report));
  if (report.status !== "ready") process.exitCode = 1;
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  return values.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function usage() {
  console.error("Usage: worktree-lifecycle.mjs check [--repository=<path>] | cleanup --repository=<path> --worktree=<path>");
  process.exit(2);
}
