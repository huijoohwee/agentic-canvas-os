#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { textCommandOptions } from "./command-text-options.mjs";
import {
  authorizeExpiredCommittedHeartbeatTaskAuthority,
  recoverExpiredCommittedHeartbeat,
} from "./expired-committed-heartbeat-recovery-lib.mjs";
import {
  createWriterLeaseStore,
  DEFAULT_WRITER_LEASE_TTL_MS,
} from "./writer-lease-lib.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const invocationPath = path.resolve(
  readOption(args, "repository") ||
  process.env.AGENTIC_TARGET_REPOSITORY ||
  process.env.INIT_CWD ||
  process.cwd(),
);
const sessionId = readOption(args, "session") ||
  process.env.AGENTIC_SESSION_ID || "";
const ttlSeconds = Number(
  readOption(args, "ttl-seconds") ||
  DEFAULT_WRITER_LEASE_TTL_MS / 1000,
);
let taskAuthorityFile = null;

let repo = null;
try {
  const unknown = args.filter(value => (
    value !== "--json" &&
    !value.startsWith("--repository=") &&
    !value.startsWith("--session=") &&
    !value.startsWith("--task-authority=") &&
    !value.startsWith("--ttl-seconds=")
  ));
  if (unknown.length) {
    throw new Error(`Unsupported expired heartbeat option: ${unknown[0]}`);
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error("--ttl-seconds must be between 60 and 86400 seconds.");
  }
  process.chdir(invocationPath);
  repo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(repo);
  const gitCommonDir = path.resolve(
    repo,
    gitText(["rev-parse", "--git-common-dir"]).trim(),
  );
  taskAuthorityFile = externalTaskAuthorityFile(
    readOption(args, "task-authority"),
    [repo, path.dirname(gitCommonDir)],
  );
  const leaseStore = createWriterLeaseStore({
    gitCommonDir,
    taskAuthorityFile,
    taskAuthorityPolicy: "required",
  });
  const branch = gitText(["branch", "--show-current"]).trim();
  const taskAuthorityReceipt = authorizeExpiredCommittedHeartbeatTaskAuthority({
    lease: leaseStore.read(branch),
    taskAuthorityFile,
  });
  const result = recoverExpiredCommittedHeartbeat({
    invocationPath,
    repo,
    gitText,
    gitOptional,
    ghText,
    leaseStore,
    sessionId,
    leaseTtlMs: Math.floor(ttlSeconds * 1000),
    taskAuthorityReceipt,
    run,
    log: json ? () => {} : console.log,
  });
  if (json) console.log(JSON.stringify(result));
} catch (error) {
  if (!json) throw error;
  console.log(JSON.stringify({
    schema: "agentic-expired-committed-heartbeat-result/v1",
    ok: false,
    status: "error",
    deployment: false,
    repoRoot: repo,
    worktreePath: invocationPath,
    error: {
      code: "expired_committed_heartbeat_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  }));
  process.exitCode = 1;
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function externalTaskAuthorityFile(value, repositoryRoots) {
  if (!value) throw new Error("--task-authority=<absolute external capability> is required.");
  if (!path.isAbsolute(value)) throw new Error("--task-authority must be absolute.");
  const resolved = realpathSync(value);
  if (repositoryRoots.map(root => path.resolve(root)).some(root => (
    resolved === root || resolved.startsWith(`${root}${path.sep}`)
  ))) {
    throw new Error("--task-authority must remain outside the target repository.");
  }
  const metadata = lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("--task-authority must be a private regular 0600 file.");
  }
  return resolved;
}

function gitText(commandArgs) {
  return execFileSync("git", commandArgs, textCommandOptions());
}

function gitOptional(commandArgs) {
  const result = spawnSync("git", commandArgs, textCommandOptions());
  return result.status === 0 ? result.stdout.trim() : "";
}

function ghText(commandArgs) {
  return execFileSync("gh", commandArgs, textCommandOptions());
}

function run(command, commandArgs) {
  const stdio = json ? ["ignore", "ignore", "inherit"] : "inherit";
  const result = spawnSync(command, commandArgs, { stdio });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  }
}
