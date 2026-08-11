#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  buildLifecycleReport,
  buildWorktreeCleanupReport,
  cleanupCompletedWorktree,
  cleanupEmptyWorktreeContainers,
} from "./worktree-lifecycle-lib.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["check", "cleanup", "cleanup-empty"].includes(command)) usage();
const repository = readOption(args, "repository") || process.cwd();

if (command === "cleanup") {
  const target = readOption(args, "worktree");
  if (!target) throw new Error("cleanup requires --worktree=<registered-task-worktree>.");
  const result = withWriterLeaseRegistryLock(repository, gitCommonDir => {
    const report = buildWorktreeCleanupReport({ repository, target, gitCommonDir });
    return cleanupCompletedWorktree({ report, target });
  });
  console.log(JSON.stringify(result));
} else if (command === "cleanup-empty") {
  const result = withWriterLeaseRegistryLock(repository, gitCommonDir =>
    cleanupEmptyWorktreeContainers({ repository, gitCommonDir }));
  console.log(JSON.stringify(result));
} else {
  const report = buildLifecycleReport({ repository });
  console.log(JSON.stringify(report));
  if (report.status !== "ready") process.exitCode = 1;
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  return values.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function usage() {
  console.error("Usage: worktree-lifecycle.mjs check [--repository=<path>] | cleanup --repository=<path> --worktree=<path> | cleanup-empty --repository=<path>");
  process.exit(2);
}

function withWriterLeaseRegistryLock(repositoryPath, action) {
  const root = path.resolve(repositoryPath);
  const gitCommonDir = path.resolve(root, execFileSync(
    "git",
    ["rev-parse", "--git-common-dir"],
    { cwd: root, encoding: "utf8" },
  ).trim());
  const store = createWriterLeaseStore({ gitCommonDir });
  return store.withRegistryLock(() => action(gitCommonDir));
}
