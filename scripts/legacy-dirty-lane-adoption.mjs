#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  adoptLegacyDirtyLane,
  captureLegacyDirtyLane,
  MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
  SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
  verifyLegacyRecoveryPackage,
} from "./legacy-dirty-lane-adoption-lib.mjs";

const [command, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  let result;
  if (command === "capture") {
    const sourceWorktree = option("source");
    const captureProfile = option("capture-profile") || "task-lane";
    result = captureLegacyDirtyLane({
      sourceWorktree,
      recoveryDirectory: option("recovery"),
      protectedTipSha: option("protected-tip"),
      operatorSessionId: option("session"),
      captureProfile,
      pullRequestEvidence: captureProfile === SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE
        ? fetchPullRequestEvidence({
          sourceWorktree,
          expectedRepository: option("repository"),
          pullRequestNumber: option("pull-request"),
        })
        : null,
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
      reconciliationPaths: listOption("reconcile"),
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

function fetchPullRequestEvidence({ sourceWorktree, expectedRepository, pullRequestNumber }) {
  const repository = execFileSync("gh", [
    "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner",
  ], { cwd: sourceWorktree, encoding: "utf8" }).trim();
  if (expectedRepository && expectedRepository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("Explicit repository does not match the legacy source origin.");
  }
  const number = Number(pullRequestNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("Squash-integrated capture requires --pull-request=<positive-integer>.");
  }
  const pullRequest = JSON.parse(execFileSync("gh", [
    "api", `repos/${repository}/pulls/${number}`, "--hostname", "github.com",
  ], { cwd: sourceWorktree, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  return Object.freeze({
    schema: MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
    repository,
    pullRequestNumber: pullRequest.number,
    state: pullRequest.state,
    draft: pullRequest.draft,
    merged: pullRequest.merged,
    mergedAt: pullRequest.merged_at,
    mergeCommitSha: pullRequest.merge_commit_sha,
    headRepository: pullRequest.head?.repo?.full_name,
    headBranch: pullRequest.head?.ref,
    headSha: pullRequest.head?.sha,
    baseRepository: pullRequest.base?.repo?.full_name,
    baseBranch: pullRequest.base?.ref,
    baseSha: pullRequest.base?.sha,
  });
}

function listOption(name) {
  const value = option(name);
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function render(result) {
  if (result.schema === "agentic-legacy-dirty-lane-adoption/v1") {
    return `[legacy-adoption] ${result.status} after adopting ${result.adoptedPaths.length} paths into ${result.targetBranch}; receipt ${result.receiptPath}`;
  }
  return `[legacy-adoption] captured ${result.tracked.length} tracked and ${result.untracked.length} untracked paths; package ${result.packageDigest}`;
}

function usage() {
  throw new Error(
    "Usage: legacy-dirty-lane-adoption.mjs capture --source=<worktree> --recovery=<new-directory> --protected-tip=<sha> --session=<id> [--capture-profile=task-lane|task-lane-squash-integrated|canonical-untracked-retention] [--pull-request=<number> --repository=<owner/repo>] [--json] | verify --recovery=<directory> [--json] | adopt --source=<worktree> --recovery=<directory> --target=<leased-worktree> --session=<id> [--reconcile=<comma-separated-tracked-paths>] [--receipt=<path>] [--json]",
  );
}
