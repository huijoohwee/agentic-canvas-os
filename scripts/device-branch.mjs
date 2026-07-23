#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { completeSession, heartbeat, park, publish, resume, review, start } from "./device-branch-lib.mjs";
import { createDeviceCommandError, createDeviceCommandResult } from "./device-command-result.mjs";
import { integrateSession } from "./device-integrate-lib.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { provisionTaskWorktree, rollbackUnclaimedProvision } from "./task-worktree-provision.mjs";
import { createWriterLeaseStore, DEFAULT_WRITER_LEASE_TTL_MS } from "./writer-lease-lib.mjs";

const [command, ...args] = process.argv.slice(2);
const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!command || !["start", "resume", "heartbeat", "review", "publish", "integrate", "park", "complete", "end"].includes(command)) usage();

const json = args.includes("--json");
const provisionRequested = args.includes("--provision");
const rawScope = args.find((value) => !value.startsWith("--"));
const sessionId = readOption(args, "session") || process.env.AGENTIC_SESSION_ID || "";
if (sessionId) process.env.AGENTIC_SESSION_ID = sessionId;

let repo = null;
let canonicalRepo = null;
let provision = null;
let leaseRevisionBeforeProvision = null;
const invocationPath = path.resolve(
  readOption(args, "repository") || process.env.AGENTIC_TARGET_REPOSITORY || process.env.INIT_CWD || process.cwd(),
);
const requestedWorktreePath = readOption(args, "worktree");
try {
  const ttlSeconds = Number(readOption(args, "ttl-seconds") || DEFAULT_WRITER_LEASE_TTL_MS / 1000);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("--ttl-seconds must be a positive number.");
  process.chdir(invocationPath);
  canonicalRepo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(canonicalRepo);
  configureHooks();
  let activeInvocationPath = invocationPath;
  if (provisionRequested) {
    if (command !== "start") throw new Error("--provision is supported only by device:start.");
    const commonDirectory = path.resolve(canonicalRepo, gitText(["rev-parse", "--git-common-dir"]).trim());
    leaseRevisionBeforeProvision = createWriterLeaseStore({ gitCommonDir: commonDirectory }).readRegistry().revision;
    provision = provisionTaskWorktree({
      invocationPath,
      repoRoot: canonicalRepo,
      targetPath: requestedWorktreePath,
      gitText,
      run,
    });
    activeInvocationPath = provision.target;
  } else if (requestedWorktreePath) {
    throw new Error("--worktree requires --provision.");
  }
  process.chdir(activeInvocationPath);
  repo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(repo);
  const gitCommonDir = path.resolve(repo, gitText(["rev-parse", "--git-common-dir"]).trim());
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
  const context = {
    scope: rawScope,
    invocationPath: activeInvocationPath,
    repo,
    gitText,
    gitOptional,
    ghText,
    ghOptional,
    leaseStore,
    sessionId,
    leaseTtlMs: ttlSeconds * 1000,
    run,
    log: json ? () => {} : console.log,
    now: () => new Date(),
  };
  const result = execute(command, context);
  if (json) emitJson(command, context, result, { provisioned: Boolean(provision) });
} catch (error) {
  const finalError = rollbackProvision(error);
  if (!json) throw finalError;
  console.log(JSON.stringify(createDeviceCommandError({
    action: command,
    repoRoot: repo || canonicalRepo,
    worktreePath: provision?.target || (requestedWorktreePath ? path.resolve(requestedWorktreePath) : invocationPath),
    error: finalError,
  })));
  process.exitCode = 1;
}

function execute(action, context) {
  if (action === "start") return start(context);
  if (action === "resume") return resume({ ...context, branchName: rawScope });
  if (action === "heartbeat") return heartbeat(context);
  if (action === "review") return review(context);
  if (action === "publish") return publish(context);
  if (action === "integrate") return integrateSession({
    ...context,
    commitMessage: readOption(args, "commit-message"),
    pathsManifest: readOption(args, "paths-manifest"),
    runtime: readOption(args, "runtime") || "canonical",
    runtimeRepository: readOption(args, "runtime-repository"),
    waitSeconds: Number(readOption(args, "wait-seconds") || 900),
    pollSeconds: Number(readOption(args, "poll-seconds") || 5),
    controllerRoot,
    publishTask: () => publish(context),
    completeTask: () => completeSession({ ...context, json: false }),
    runText,
  });
  if (action === "park") return park(context);
  return completeSession({ ...context, json: false });
}

function emitJson(action, context, result, { provisioned }) {
  if (action === "complete" || action === "end" || action === "integrate") {
    console.log(JSON.stringify(result));
    return;
  }
  const branch = resolveResultBranch(action, result);
  const lease = branch ? context.leaseStore.read(branch) : null;
  const pullRequestIsDraft = lease?.pullRequestUrl ? readMachinePullRequestDraft({ action, branch, lease, ghText: context.ghText }) : null;
  console.log(JSON.stringify(createDeviceCommandResult({
    action,
    repoRoot: context.repo,
    worktreePath: context.repo,
    branch,
    lease,
    result,
    provisioned,
    pullRequestIsDraft,
  })));
}

function readMachinePullRequestDraft({ action, branch, lease, ghText }) {
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch,
    ghText,
    requireOpen: action !== "publish",
  });
  const expected = ["start", "resume", "heartbeat", "park"].includes(action) ? true :
    ["review", "publish"].includes(action) ? false : null;
  if (expected !== null && pullRequest.isDraft !== expected) {
    throw new Error(`Machine result for ${action} cannot prove pull request draft state ${expected}.`);
  }
  return pullRequest.isDraft;
}

function resolveResultBranch(action, result) {
  if (action === "start") return result;
  if (action === "review" || action === "publish") return gitText(["branch", "--show-current"]).trim();
  return result?.branch || "";
}

function rollbackProvision(originalError) {
  if (!provision || !canonicalRepo) return originalError;
  try {
    process.chdir(canonicalRepo);
    const commonDirectory = path.resolve(canonicalRepo, gitText(["rev-parse", "--git-common-dir"]).trim());
    const revision = createWriterLeaseStore({ gitCommonDir: commonDirectory }).readRegistry().revision;
    rollbackUnclaimedProvision({
      provision,
      registryUnchanged: revision === leaseRevisionBeforeProvision,
      gitText,
      run,
    });
    return originalError;
  } catch (rollbackError) {
    return new Error(`${originalError.message}; automatic worktree rollback stopped: ${rollbackError.message}`);
  }
}

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
  const stdio = json ? ["ignore", "ignore", "inherit"] : "inherit";
  const result = spawnSync(command, args, { stdio });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function runText(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function usage() {
  console.error(
    "Usage: node scripts/device-branch.mjs start <scope> --session=<id> --repository=<path> [--provision --worktree=<absolute-new-path>] [--ttl-seconds=<n>] [--json] | resume <agent/device/scope> --session=<id> --repository=<path> [--json] | heartbeat --session=<id> --repository=<path> [--json] | review --session=<id> --repository=<path> [--json] | publish --session=<id> --repository=<path> [--json] | integrate --session=<id> --repository=<path> [--commit-message=<text> --paths-manifest=<json>] [--runtime=canonical|none] [--runtime-repository=<path>] [--wait-seconds=<n>] [--json] | park --session=<id> --repository=<path> [--json] | complete --repository=<path> --json | end --repository=<path> --json",
  );
  process.exit(2);
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}
