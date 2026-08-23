#!/usr/bin/env node

import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { createRepeatedRecoveryController }
  from "./repeated-expired-committed-heartbeat-recovery-controller.mjs";
import { createRepositoryRepeatedRecoveryAdapter }
  from "./repeated-expired-committed-heartbeat-recovery-repository-adapter.mjs";

const [command = "plan", ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (!["plan", "run"].includes(command)) usage();
  const repository = path.resolve(option("repository"));
  const targetManifestFile = externalPrivateFile(option("target-manifest"), repository,
    "target-manifest");
  const taskAuthorityFile = command === "run"
    ? externalPrivateFile(option("task-authority"), repository, "task-authority")
    : null;
  const adapter = createRepositoryRepeatedRecoveryAdapter({
    repository,
    sessionId: option("session"),
    pullRequestNumber: Number(option("pull-request")),
    targetManifestFile,
    taskAuthorityFile,
    ttlSeconds: Number(optional("ttl-seconds") || 1800),
  });
  const controller = createRepeatedRecoveryController({ adapter });
  const result = command === "plan"
    ? await controller.plan()
    : await controller.run({ authorization: option("authorization") });
  console.log(JSON.stringify(result));
} catch (error) {
  if (!json) throw error;
  console.log(JSON.stringify({
    schema: "agentic-repeated-expired-committed-heartbeat-recovery-result/v1",
    status: "blocked",
    error: String(error?.message || error).slice(0, 500),
  }));
  process.exitCode = 1;
}

function optional(name) {
  const prefix = `--${name}=`;
  const argument = argumentsList.find(value => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : "";
}

function option(name) {
  const value = optional(name);
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}

function externalPrivateFile(value, repository, optionName) {
  if (!path.isAbsolute(value)) throw new Error(`--${optionName} must be absolute.`);
  const resolved = realpathSync(value);
  if (resolved === repository || resolved.startsWith(`${repository}${path.sep}`)) {
    throw new Error(`--${optionName} must remain outside the target repository.`);
  }
  const metadata = lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error(`--${optionName} must be a private regular 0600 file.`);
  }
  return resolved;
}

function usage() {
  throw new Error("Usage: repeated-expired-committed-heartbeat-recovery.mjs <plan|run> --repository=<worktree> --session=<id> --pull-request=<number> --target-manifest=<external-0600-file> [--task-authority=<external-0600-file> --authorization=<exact-statement>] [--ttl-seconds=1800] [--json]");
}
