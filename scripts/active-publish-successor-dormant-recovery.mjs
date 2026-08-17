#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized dormant successor recovery.
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createActivePublishSuccessorDormantRecoveryController,
} from "./active-publish-successor-dormant-recovery-controller.mjs";
import {
  createActivePublishSuccessorDormantRecoveryRepositoryAdapter,
} from "./active-publish-successor-dormant-recovery-repository-adapter.mjs";
import {
  createActivePublishSuccessorDormantRecoveryStore,
} from "./active-publish-successor-dormant-recovery-store.mjs";

const OPTIONS = new Set([
  "authorization",
  "branch",
  "journal",
  "manifest",
  "operator-session",
  "output",
  "plan",
  "pull-request",
  "repository",
  "task-authority",
  "ttl-seconds",
  "worktree",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const repository = absolute(options, "repository");
  const worktreePath = absolute(options, "worktree");
  const pullRequestNumber = positive(options, "pull-request");
  const operatorSession = required(options, "operator-session");
  const branch = required(options, "branch");
  const manifestFile = absolute(options, "manifest");
  const journalFile = options.has("journal") ? absolute(options, "journal") : null;
  if (journalFile) requireExternal(journalFile, repository, "journal");
  const adapter = (dependencies.createAdapter
    || createActivePublishSuccessorDormantRecoveryRepositoryAdapter)({
    repository,
    worktreePath,
    branch,
    pullRequestNumber,
    sessionId: operatorSession,
    manifestFile,
    taskAuthorityFile: options.has("task-authority")
      ? absolute(options, "task-authority") : null,
  }, dependencies);
  const store = (dependencies.createStore
    || createActivePublishSuccessorDormantRecoveryStore)({
    gitCommonDir: adapter.gitCommonDir,
    branch,
    pullRequestNumber,
    journalFile,
  });
  const controller = (dependencies.createController
    || createActivePublishSuccessorDormantRecoveryController)({ adapter, store });
  if (command === "plan") {
    if (options.has("authorization") || options.has("task-authority")) {
      throw new Error("Planning accepts neither authorization nor task capability.");
    }
    const plan = await controller.plan({
      ttlSeconds: options.has("ttl-seconds")
        ? positive(options, "ttl-seconds") : undefined,
    });
    if (!options.has("output")) throw new Error("Planning requires --output=<external-plan>.");
    const output = absolute(options, "output");
    requireExternal(output, repository, "output");
    writePlan(plan, output, dependencies);
    return Object.freeze({
      schema: "agentic-active-publish-successor-dormant-recovery-result/v1",
      status: "planned",
      planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization,
      plan,
    });
  }
  if (options.has("output")) throw new Error("Run accepts --plan, not --output.");
  const plan = readPlan(privateExternalFile(absolute(options, "plan"), repository, "plan"));
  const completion = await controller.run({
    plan,
    authorization: required(options, "authorization"),
  });
  return Object.freeze({
    schema: "agentic-active-publish-successor-dormant-recovery-result/v1",
    status: "complete",
    completion,
  });
}

export async function runCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  try {
    console.log(JSON.stringify(await main(argumentsList, dependencies)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-active-publish-successor-dormant-recovery-result/v1",
      status: "blocked",
      error: String(error?.message || error || "blocked").slice(0, 1_000),
    }));
    return 1;
  }
}

function parseOptions(values) {
  const options = new Map();
  for (const value of values) {
    const match = value.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1]) || !match[2] || options.has(match[1])) {
      throw new Error(`Invalid or duplicate option: ${value}`);
    }
    options.set(match[1], match[2]);
  }
  return options;
}

function readPlan(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Recovery plan is unavailable or invalid JSON."); }
}

function writePlan(plan, file, dependencies) {
  if (typeof dependencies.writePlan === "function") {
    dependencies.writePlan({ file, value: plan });
    return;
  }
  let descriptor;
  try {
    descriptor = openSync(file, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(plan)}\n`, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if ((lstatSync(file).mode & 0o777) !== 0o600) {
    throw new Error("Recovery plan permissions are not private.");
  }
}

function privateExternalFile(file, repository, label) {
  requireExternal(file, repository, label);
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a private single-link regular file.`);
  }
  return file;
}
function requireExternal(file, repository, label) {
  if (file === repository || file.startsWith(`${repository}${path.sep}`)) {
    throw new Error(`${label} must remain outside the repository.`);
  }
}

function required(options, name) {
  const value = options.get(name);
  if (!value || value !== value.trim()) throw new Error(`--${name}=<value> is required.`);
  return value;
}
function absolute(options, name) {
  const value = required(options, name);
  if (!path.isAbsolute(value)) throw new Error(`--${name} must be absolute.`);
  return path.resolve(value);
}
function positive(options, name) {
  const value = Number(required(options, name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} is invalid.`);
  return value;
}
function usage() {
  return "Usage: active-publish-successor-dormant-recovery.mjs plan|run --repository=<canonical> --worktree=<source> --branch=<branch> --pull-request=<number> --operator-session=<session> --manifest=<external-json> --output=<external-plan> [--task-authority=<external-capability> --authorization=<exact-text>]";
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
