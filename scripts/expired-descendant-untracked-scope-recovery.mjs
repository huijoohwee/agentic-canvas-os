#!/usr/bin/env node
// Responsibility: Expose private planning and exact-authorized dormant descendant recovery.
import { execFileSync } from "node:child_process";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync,
  openSync, readFileSync, realpathSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createExpiredDescendantUntrackedScopeRecoveryController }
  from "./expired-descendant-untracked-scope-recovery-controller.mjs";
import { createExpiredDescendantUntrackedScopeRecoveryRepositoryAdapter }
  from "./expired-descendant-untracked-scope-recovery-repository-adapter.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA = "agentic-expired-descendant-untracked-scope-recovery-cli/v1";
const COMMANDS = new Set(["owner-stop", "plan", "run"]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!COMMANDS.has(command)) throw new Error(usage());
  const options = parse(tail);
  reject(options, command);
  const repository = directory(required(options, "repository"), "repository");
  const controllerRoot = directory(
    dependencies.controllerRoot || CONTROLLER_ROOT,
    "controller root",
  );
  const gitCommonDirectory = dependencies.gitCommonDirectory || (root => directory(
    path.resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim()), "Git common directory"));
  const roots = [repository, controllerRoot, gitCommonDirectory(repository),
    gitCommonDirectory(controllerRoot)];
  const targetManifestFile = command === "owner-stop" ? null
    : externalFile(required(options, "target-manifest"), roots, "target manifest");
  const ownerStopReceiptFile = command === "owner-stop" ? null
    : externalFile(required(options, "owner-stop-receipt"), roots, "owner-stop receipt");
  const historicalOwnerDecisionFile = command === "owner-stop" ? null
    : externalFile(required(options, "historical-owner-decision"), roots,
      "historical owner decision");
  const taskAuthorityFile = externalFile(
    required(options, "task-authority"), roots, "task authority",
  );
  const planFile = command === "run"
    ? externalFile(required(options, "plan-file"), roots, "plan") : null;
  const outputFile = command !== "run"
    ? externalOutput(required(options, "output"), roots, "output") : null;
  distinct([targetManifestFile, ownerStopReceiptFile, historicalOwnerDecisionFile,
    taskAuthorityFile, planFile, outputFile].filter(Boolean));
  const adapter = (dependencies.createAdapter
    || createExpiredDescendantUntrackedScopeRecoveryRepositoryAdapter)({
    repository,
    sourceSessionId: required(options, "session"),
    targetManifestFile,
    ownerStopReceiptFile,
    historicalOwnerDecisionFile,
    taskAuthorityFile,
    ttlSeconds: ttl(options.get("ttl-seconds") || "1800"),
    controllerRoot,
  }, dependencies.adapterDependencies || {});
  if (command === "owner-stop") {
    const receipt = await adapter.createOwnerStopReceipt();
    writePrivate(outputFile, receipt, dependencies);
    return Object.freeze({ schema: SCHEMA, ok: true, status: "owner-stopped",
      receiptDigest: receipt.receiptDigest, receiptOutput: outputFile });
  }
  const controller = (dependencies.createController
    || createExpiredDescendantUntrackedScopeRecoveryController)(adapter);
  if (command === "plan") {
    const plan = await controller.plan();
    writePrivate(outputFile, plan, dependencies);
    return Object.freeze({ schema: SCHEMA, ok: true, status: "planned",
      planDigest: plan.planDigest, exactAuthorization: plan.exactAuthorization,
      planOutput: outputFile });
  }
  const plan = readPrivate(planFile, "plan");
  const completion = await controller.run({ plan,
    authorization: required(options, "authorization") });
  return Object.freeze({ schema: SCHEMA, ok: true, status: "complete", completion });
}

export async function runCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  try {
    (dependencies.stdout || process.stdout).write(
      `${JSON.stringify(await main(argumentsList, dependencies))}\n`,
    );
    return 0;
  } catch (error) {
    (dependencies.stderr || process.stderr).write(`${JSON.stringify({
      schema: SCHEMA, ok: false, status: "blocked", error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function parse(tokens) {
  const result = new Map();
  for (const token of tokens) {
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(token);
    if (!match || result.has(match[1])) throw new Error(`Invalid option: ${token}`);
    result.set(match[1], match[2]);
  }
  return result;
}
function reject(values, command) {
  const common = ["repository", "session", "task-authority", "ttl-seconds"];
  const allowed = new Set(command === "owner-stop" ? [...common, "output"]
    : command === "plan" ? [...common, "target-manifest", "owner-stop-receipt",
      "historical-owner-decision", "output"]
      : [...common, "target-manifest", "owner-stop-receipt",
        "historical-owner-decision", "plan-file", "authorization"]);
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
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 60 || result > 3_600) {
    throw new Error("--ttl-seconds must be 60..3600.");
  }
  return result;
}
function directory(value, label) {
  const result = realpathSync(path.resolve(value));
  if (!lstatSync(result).isDirectory()) throw new Error(`${label} must be a directory.`);
  return result;
}
function externalFile(value, roots, label) {
  const requested = path.resolve(value);
  if (!path.isAbsolute(value) || realpathSync(requested) !== requested) {
    throw new Error(`${label} must use its canonical absolute path.`);
  }
  const stat = lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  external(requested, roots, label);
  return requested;
}
function externalOutput(value, roots, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must use an absolute path.`);
  const result = path.resolve(value), parent = realpathSync(path.dirname(result));
  if (parent !== path.dirname(result) || existsSync(result)) {
    throw new Error(`${label} must be one absent path under a canonical directory.`);
  }
  external(result, roots, label);
  return result;
}
function external(target, roots, label) {
  if (roots.some(root => target === root || target.startsWith(`${root}${path.sep}`))) {
    throw new Error(`${label} must remain outside source and controller repositories.`);
  }
}
function distinct(files) {
  if (new Set(files).size !== files.length) throw new Error("External recovery files must be distinct.");
}
function readPrivate(file, label) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size > 1024 * 1024
      || (typeof process.getuid === "function" && before.uid !== process.getuid())
      || (before.mode & 0o077) !== 0) throw new Error(`${label} must be one private file.`);
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error(`${label} changed while being read.`);
    }
    return value;
  } finally { closeSync(descriptor); }
}
function writePrivate(file, value, dependencies) {
  if (dependencies.writePlan) return dependencies.writePlan(file, value);
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    linkSync(temporary, file);
    const parent = openSync(path.dirname(file), constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
    unlinkSync(temporary);
  } finally {
    if (descriptor) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]").slice(0, 1_000);
}
function usage() {
  return "Usage: expired-descendant-untracked-scope-recovery.mjs owner-stop|plan|run "
    + "--repository=<worktree> --session=<source-session> --task-authority=<capability> "
    + "[--target-manifest=<private-manifest> --owner-stop-receipt=<private-stop> "
    + "--historical-owner-decision=<private-v1-decision> "
    + "--output=<private-plan>|--plan-file=<private-plan> --authorization=<exact>]";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli();
}
