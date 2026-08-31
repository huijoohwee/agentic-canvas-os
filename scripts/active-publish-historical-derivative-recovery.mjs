#!/usr/bin/env node
// Responsibility: Expose sealed planning and exact-authorized historical derivative recovery.
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createActivePublishHistoricalDerivativeRecoveryController,
} from "./active-publish-historical-derivative-recovery-controller.mjs";
import {
  createActivePublishHistoricalDerivativeRecoveryRepositoryAdapter,
} from "./active-publish-historical-derivative-recovery-repository-adapter.mjs";
import {
  createActivePublishHistoricalDerivativeRecoveryStore,
} from "./active-publish-historical-derivative-recovery-store.mjs";

const RESULT_SCHEMA = "agentic-active-publish-historical-derivative-recovery-result/v1";
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
  assertModeOptions(command, options);
  const repository = absolute(options, "repository");
  const worktreePath = absolute(options, "worktree");
  const pullRequestNumber = positive(options, "pull-request");
  const operatorSession = required(options, "operator-session");
  const branch = required(options, "branch");
  const protectedRoots = [repository, worktreePath];
  const manifestFile = absolute(options, "manifest");
  requireExternal(manifestFile, protectedRoots, "manifest");
  const journalFile = absolute(options, "journal");
  requireExternal(journalFile, protectedRoots, "journal");

  const adapter = (dependencies.createAdapter
    || createActivePublishHistoricalDerivativeRecoveryRepositoryAdapter)({
    repository,
    worktreePath,
    branch,
    pullRequestNumber,
    sessionId: operatorSession,
    manifestFile,
    taskAuthorityFile: command === "run"
      ? privateExternalFile(
        absolute(options, "task-authority"), protectedRoots, "task authority",
      )
      : null,
  }, dependencies.adapterDependencies || dependencies);
  const store = (dependencies.createStore
    || createActivePublishHistoricalDerivativeRecoveryStore)({
    gitCommonDir: adapter.gitCommonDir,
    branch,
    pullRequestNumber,
    journalFile,
  });
  const controller = (dependencies.createController
    || createActivePublishHistoricalDerivativeRecoveryController)({ adapter, store });

  if (command === "plan") {
    const plan = await controller.plan({
      ttlSeconds: options.has("ttl-seconds")
        ? positive(options, "ttl-seconds")
        : undefined,
    });
    const output = absolute(options, "output");
    requireExternal(output, protectedRoots, "output");
    writePlan(plan, output, dependencies);
    return Object.freeze({
      schema: RESULT_SCHEMA,
      status: "planned",
      planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization,
      plan,
    });
  }

  const planFile = privateExternalFile(
    absolute(options, "plan"), protectedRoots, "plan",
  );
  const completion = await controller.run({
    plan: readPlan(planFile),
    authorization: required(options, "authorization"),
  });
  return Object.freeze({ schema: RESULT_SCHEMA, status: "complete", completion });
}

export async function runCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  try {
    console.log(JSON.stringify(await main(argumentsList, dependencies)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: RESULT_SCHEMA,
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

function assertModeOptions(command, options) {
  const planOnly = ["output", "ttl-seconds"];
  const runOnly = ["authorization", "plan", "task-authority"];
  if (command === "plan"
    && (options.has("authorization") || options.has("task-authority"))) {
    throw new Error("Planning accepts neither authorization nor task capability.");
  }
  for (const name of command === "plan" ? runOnly : planOnly) {
    if (options.has(name)) throw new Error(`${command} does not accept --${name}.`);
  }
  const requiredNames = [
    "repository", "worktree", "branch", "pull-request", "operator-session", "manifest",
    "journal", ...(command === "plan" ? ["output"] : runOnly),
  ];
  for (const name of requiredNames) required(options, name);
}

function readPlan(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("Recovery plan is unavailable or invalid JSON.");
  }
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

function privateExternalFile(file, roots, label) {
  requireExternal(file, roots, label);
  if (!existsSync(file)) throw new Error(`${label} is unavailable.`);
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a private single-link regular file.`);
  }
  return file;
}

function requireExternal(file, roots, label) {
  for (const repository of roots) {
    if (file === repository || file.startsWith(`${repository}${path.sep}`)) {
      throw new Error(`${label} must remain outside every repository worktree.`);
    }
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
  return "Usage: active-publish-historical-derivative-recovery.mjs plan|run --repository=<canonical> --worktree=<source> --branch=<branch> --pull-request=<number> --operator-session=<session> --manifest=<external-json> --journal=<external-json> (--output=<external-plan> [--ttl-seconds=<seconds>] | --plan=<external-plan> --task-authority=<external-capability> --authorization=<exact-text>)";
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
