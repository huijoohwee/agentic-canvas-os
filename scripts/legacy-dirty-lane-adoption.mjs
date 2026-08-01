#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  adoptLegacyDirtyLane,
  captureLegacyDirtyLane,
  verifyLegacyRecoveryPackage,
} from "./legacy-dirty-lane-adoption-lib.mjs";

const [command, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  let result;
  if (command === "capture") {
    result = captureLegacyDirtyLane({
      sourceWorktree: option("source"),
      recoveryDirectory: option("recovery"),
      protectedTipSha: option("protected-tip"),
      operatorSessionId: option("session"),
    });
  } else if (command === "verify") {
    result = verifyLegacyRecoveryPackage({ recoveryDirectory: option("recovery") });
  } else if (command === "adopt") {
    const target = path.resolve(option("target") || "");
    const branch = gitText(target, ["branch", "--show-current"]).trim();
    const commonDirectory = path.resolve(target, gitText(target, ["rev-parse", "--git-common-dir"]).trim());
    const lease = createWriterLeaseStore({ gitCommonDir: commonDirectory }).read(branch);
    result = adoptLegacyDirtyLane({
      sourceWorktree: option("source"),
      recoveryDirectory: option("recovery"),
      targetWorktree: target,
      operatorSessionId: option("session"),
      receiptPath: option("receipt"),
      lease,
    });
  } else {
    usage();
  }
  process.stdout.write(`${json ? JSON.stringify(result) : render(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${json ? JSON.stringify({ schema: "agentic-legacy-dirty-lane-error/v1", status: "blocked", message }) : `[legacy-adoption] ${message}`}\n`);
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function gitText(worktree, gitArgs) {
  return execFileSync("git", gitArgs, { cwd: worktree, encoding: "utf8" });
}

function render(result) {
  if (result.schema === "agentic-legacy-dirty-lane-adoption/v1") {
    return `[legacy-adoption] adopted ${result.adoptedPaths.length} paths into ${result.targetBranch}; receipt ${result.receiptPath}`;
  }
  return `[legacy-adoption] captured ${result.tracked.length} tracked and ${result.untracked.length} untracked paths; package ${result.packageDigest}`;
}

function usage() {
  throw new Error(
    "Usage: legacy-dirty-lane-adoption.mjs capture --source=<worktree> --recovery=<new-directory> --protected-tip=<sha> --session=<id> [--json] | verify --recovery=<directory> [--json] | adopt --source=<worktree> --recovery=<directory> --target=<leased-worktree> --session=<id> [--receipt=<path>] [--json]",
  );
}
