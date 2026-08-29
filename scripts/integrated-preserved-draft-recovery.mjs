#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import {
  INTEGRATED_PRESERVED_DRAFT_RECOVERY_RESULT_SCHEMA,
} from "./integrated-preserved-draft-recovery-contract.mjs";
import {
  createIntegratedPreservedDraftRecoveryController,
} from "./integrated-preserved-draft-recovery-controller.mjs";
import {
  createRepositoryIntegratedPreservedDraftRecoveryAdapter,
} from "./integrated-preserved-draft-recovery-repository-adapter.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";

const [mode = "plan", ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (!["plan", "execute"].includes(mode)) {
    throw new Error("Mode must be plan or execute.");
  }
  const repository = path.resolve(option("repository") || process.cwd());
  const sessionId = required("session");
  const branch = option("branch") || currentBranch(repository);
  if (!parseDeviceBranch(branch)) {
    throw new Error("Branch must use canonical agent/device/scope identity.");
  }
  const taskAuthorityFile = mode === "execute"
    ? realpathSync(required("task-authority"))
    : null;
  const adapter = createRepositoryIntegratedPreservedDraftRecoveryAdapter({
    repository,
    sessionId,
    taskAuthorityFile,
  });
  const controller = createIntegratedPreservedDraftRecoveryController({ adapter });
  const result = mode === "plan"
    ? await controller.plan({ branch, sessionId })
    : await controller.execute({
      branch,
      sessionId,
      authorization: required("authorize"),
    });
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
  if (result.status === "blocked") process.exitCode = 1;
} catch (error) {
  const result = {
    schema: INTEGRATED_PRESERVED_DRAFT_RECOVERY_RESULT_SCHEMA,
    ok: false,
    status: "blocked",
    sourceMutation: false,
    branchMutation: false,
    cloudMutation: false,
    localLeaseMutation: false,
    merge: false,
    deployment: false,
    cleanup: false,
    error: { message: error instanceof Error ? error.message : String(error) },
  };
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  const item = argumentsList.find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function currentBranch(repository) {
  return execFileSync("git", ["branch", "--show-current"], {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
