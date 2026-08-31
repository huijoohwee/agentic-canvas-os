#!/usr/bin/env node
// Responsibility: Expose external-plan-only execution for one descendant/untracked recovery.

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createActiveDescendantUntrackedScopeRecoveryController }
  from "./active-descendant-untracked-scope-recovery-controller.mjs";
import { createActiveDescendantUntrackedScopeRecoveryRepositoryAdapter }
  from "./active-descendant-untracked-scope-recovery-repository-adapter.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESULT_SCHEMA = "agentic-active-descendant-untracked-scope-recovery-cli/v1";
const COMMANDS = new Set(["plan", "run"]);
const COMMON_OPTIONS = Object.freeze([
  "repository", "session", "target-manifest", "owner-stop-receipt", "ttl-seconds",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!COMMANDS.has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  rejectOptions(options, command);
  const repository = directory(required(options, "repository"), "repository");
  const controllerRoot = directory(
    dependencies.controllerRoot || CONTROLLER_ROOT,
    "controller root",
  );
  const roots = [repository, controllerRoot];
  const targetManifestFile = externalFile(
    required(options, "target-manifest"), roots, "target manifest",
  );
  const ownerStopReceiptFile = externalFile(
    required(options, "owner-stop-receipt"), roots, "owner-stop receipt",
  );
  const taskAuthorityFile = command === "run"
    ? externalFile(required(options, "task-authority"), roots, "task authority")
    : null;
  const planFile = command === "run"
    ? externalFile(required(options, "plan-file"), roots, "plan file")
    : null;
  const outputFile = command === "plan"
    ? externalOutput(required(options, "output"), roots, "plan output")
    : null;
  requireDistinct([
    targetManifestFile, ownerStopReceiptFile, taskAuthorityFile, planFile, outputFile,
  ].filter(Boolean));

  const adapter = (dependencies.createAdapter
    || createActiveDescendantUntrackedScopeRecoveryRepositoryAdapter)({
    repository,
    sourceSessionId: required(options, "session"),
    targetManifestFile,
    ownerStopReceiptFile,
    taskAuthorityFile,
    ttlSeconds: ttl(options.get("ttl-seconds") || "1800"),
    controllerRoot,
  }, dependencies.adapterDependencies || {});
  const controller = (dependencies.createController
    || createActiveDescendantUntrackedScopeRecoveryController)(adapter);

  if (command === "plan") {
    const plan = await controller.plan();
    writePrivateJsonExclusive(outputFile, plan, dependencies);
    return Object.freeze({ schema: RESULT_SCHEMA, ok: true, status: "planned",
      planDigest: plan.planDigest, exactAuthorization: plan.exactAuthorization,
      planOutput: outputFile });
  }
  const plan = readJson(planFile, "plan");
  const completion = await controller.run({ plan,
    authorization: required(options, "authorization") });
  return Object.freeze({ schema: RESULT_SCHEMA, ok: true, status: "complete", completion });
}

export async function runCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  try {
    const result = await main(argumentsList, dependencies);
    (dependencies.stdout || process.stdout).write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    (dependencies.stderr || process.stderr).write(`${JSON.stringify({
      schema: RESULT_SCHEMA, ok: false, status: "blocked", error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function parseOptions(tokens) {
  const values = new Map();
  for (const token of tokens) {
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(token);
    if (!match || values.has(match[1])) throw new Error(`Invalid option: ${token}`);
    values.set(match[1], match[2]);
  }
  return values;
}

function rejectOptions(values, command) {
  const allowed = new Set([...COMMON_OPTIONS,
    ...(command === "plan" ? ["output"] : ["plan-file", "task-authority", "authorization"])]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unsupported --${name} for ${command}.`);
  }
}

function required(values, name) {
  const value = String(values.get(name) || "").trim();
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function ttl(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 60 || number > 86_400) {
    throw new Error("--ttl-seconds must be 60..86400.");
  }
  return number;
}

function directory(value, label) {
  const target = realpathSync(path.resolve(value));
  if (!lstatSync(target).isDirectory()) throw new Error(`${label} must be a directory.`);
  return target;
}

function externalFile(value, roots, label) {
  const requested = path.resolve(value);
  if (!path.isAbsolute(value) || realpathSync(requested) !== requested) {
    throw new Error(`${label} must use its canonical absolute path.`);
  }
  const stat = lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  requireExternal(requested, roots, label);
  return requested;
}

function externalOutput(value, roots, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must use an absolute path.`);
  const target = path.resolve(value), parent = realpathSync(path.dirname(target));
  if (parent !== path.dirname(target) || existsSync(target)) {
    throw new Error(`${label} must be one absent path under a canonical directory.`);
  }
  requireExternal(target, roots, label);
  return target;
}

function requireExternal(target, roots, label) {
  if (roots.some(root => target === root || target.startsWith(`${root}${path.sep}`))) {
    throw new Error(`${label} must remain outside the source and controller repositories.`);
  }
}

function requireDistinct(files) {
  if (new Set(files).size !== files.length) throw new Error("External recovery files must be distinct.");
}

function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} JSON is invalid: ${error.message}`); }
}

function writePrivateJsonExclusive(file, value, dependencies) {
  if (dependencies.writePlan) return dependencies.writePlan(file, value);
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    renameSync(temporary, file);
  } finally {
    if (descriptor) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}

function usage() {
  return "Usage: active-descendant-untracked-scope-recovery.mjs plan|run "
    + "--repository=<worktree> --session=<source-session> "
    + "--target-manifest=<external-json> --owner-stop-receipt=<external-json> "
    + "[--ttl-seconds=1800] --output=<external-plan-json> | "
    + "--plan-file=<external-plan-json> --task-authority=<external-capability> "
    + "--authorization='authorize active-descendant-untracked-scope-recovery <planDigest>'";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli();
}
