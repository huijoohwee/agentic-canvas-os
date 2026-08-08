#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import {
  adoptLegacyDirtyLane,
  captureLegacyDirtyLane,
  MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
  SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
  verifyLegacyRecoveryPackage,
} from "./legacy-dirty-lane-adoption-lib.mjs";

const [command, ...args] = process.argv.slice(2);
const json = args.includes("--json");

function main() {
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
            explicitRepository: option("repository"),
            pullRequestNumber: option("pull-request"),
          })
          : null,
      });
    } else if (command === "verify") {
      result = verifyLegacyRecoveryPackage({ recoveryDirectory: option("recovery") });
    } else if (command === "adopt") {
      const target = path.resolve(option("target") || "");
      const operatorSessionId = option("session");
      const branch = gitText(target, ["branch", "--show-current"]).trim();
      const commonDirectory = path.resolve(target, gitText(target, ["rev-parse", "--git-common-dir"]).trim());
      const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
      const lease = leaseStore.verify({ sessionId: operatorSessionId, branch });
      result = adoptLegacyDirtyLane({
        sourceWorktree: option("source"),
        recoveryDirectory: option("recovery"),
        targetWorktree: target,
        operatorSessionId,
        receiptPath: option("receipt"),
        reconciliationPaths: listOption("reconcile"),
        leaseStore,
        expectedLeaseDigest: writerLeaseDigest(lease),
      });
    } else {
      usage();
    }
    process.stdout.write(`${json ? JSON.stringify(result) : render(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${json ? JSON.stringify({
      schema: "agentic-legacy-dirty-lane-error/v1", status: "blocked", message,
    }) : `[legacy-adoption] ${message}`}\n`);
    process.exitCode = 1;
  }
}

export function normalizeGitHubOriginRepository(originUrl) {
  const origin = requireText(originUrl, "Legacy source origin URL");
  let host;
  let pathname;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(origin)) {
    const parsed = new URL(origin);
    if (!["https:", "ssh:"].includes(parsed.protocol)) {
      throw new Error("Legacy source origin must use GitHub HTTPS, SSH, or SCP.");
    }
    host = parsed.hostname;
    pathname = parsed.pathname;
  } else {
    const match = origin.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/u);
    if (!match) throw new Error("Legacy source origin must be a GitHub URL.");
    [, host, pathname] = match;
  }
  if (host.toLowerCase() !== "github.com") {
    throw new Error("Legacy source origin must use github.com.");
  }
  const repositoryPath = pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
  return normalizeRepositoryName(repositoryPath, "Legacy source origin repository");
}

export function resolveGitHubRepository({ originUrl, explicitRepository = "" }) {
  const repository = normalizeGitHubOriginRepository(originUrl);
  if (explicitRepository) {
    const explicit = normalizeRepositoryName(explicitRepository, "Explicit repository");
    if (explicit.toLowerCase() !== repository.toLowerCase()) {
      throw new Error("Explicit repository does not match the legacy source origin.");
    }
  }
  return repository;
}

export function mapGitHubPullRequestPayload({ repository, pullRequestNumber, payload }) {
  const normalizedRepository = normalizeRepositoryName(repository, "Pull request repository");
  const number = requirePositiveInteger(pullRequestNumber, "Pull request number");
  if (!payload || typeof payload !== "object" || payload.number !== number) {
    throw new Error("GitHub pull request payload does not match the requested number.");
  }
  return Object.freeze({
    schema: MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
    repository: normalizedRepository,
    pullRequestNumber: payload.number,
    state: payload.state,
    draft: payload.draft,
    merged: payload.merged,
    mergedAt: payload.merged_at,
    mergeCommitSha: payload.merge_commit_sha,
    headRepository: payload.head?.repo?.full_name,
    headBranch: payload.head?.ref,
    headSha: payload.head?.sha,
    baseRepository: payload.base?.repo?.full_name,
    baseBranch: payload.base?.ref,
    baseSha: payload.base?.sha,
  });
}

function fetchPullRequestEvidence({ sourceWorktree, explicitRepository, pullRequestNumber }) {
  const originUrl = gitText(sourceWorktree, ["remote", "get-url", "origin"]).trim();
  const repository = resolveGitHubRepository({ originUrl, explicitRepository });
  const number = requirePositiveInteger(
    pullRequestNumber,
    "Squash-integrated capture --pull-request",
  );
  const payload = JSON.parse(execFileSync("gh", [
    "api", `repos/${repository}/pulls/${number}`, "--hostname", "github.com",
  ], { cwd: sourceWorktree, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  return mapGitHubPullRequestPayload({ repository, pullRequestNumber: number, payload });
}

function normalizeRepositoryName(value, label) {
  const repository = requireText(value, label);
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu.test(repository)) {
    throw new Error(`${label} must use owner/repository form.`);
  }
  return repository;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function option(name) {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function gitText(worktree, gitArgs) {
  return execFileSync("git", gitArgs, { cwd: worktree, encoding: "utf8" });
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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
