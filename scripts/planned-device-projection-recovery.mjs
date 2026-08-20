#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized device projection recovery.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlannedDeviceProjectionRecoveryController }
  from "./planned-device-projection-recovery-controller.mjs";
import { createPlannedDeviceProjectionRecoveryRepositoryAdapter }
  from "./planned-device-projection-recovery-repository-adapter.mjs";

const COMMAND_SCHEMA = "agentic-planned-device-projection-recovery-command/v1";

export async function runPlannedDeviceProjectionRecovery(input, dependencies = {}) {
  const adapter = (dependencies.createAdapter
    || createPlannedDeviceProjectionRecoveryRepositoryAdapter)({
    repository: input.repository,
    worktreePath: input.worktreePath,
    branch: input.branch,
    sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile || null,
  }, dependencies.adapterDependencies || {});
  const controller = (dependencies.createController
    || createPlannedDeviceProjectionRecoveryController)({ adapter });
  return input.mode === "plan"
    ? await controller.plan({ ttlSeconds: input.ttlSeconds })
    : await controller.run({ plan: input.plan, authorization: input.authorization });
}

export function parsePlannedDeviceProjectionRecoveryArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = parseOptions(tokens);
  const allowed = new Set([
    "repository", "worktree", "branch", "session", "ttl-seconds",
    ...(mode === "run" ? ["plan-file", "task-authority", "authorize"] : []),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const worktreePath = path.resolve(required(options.worktree, "worktree"));
  const branch = required(options.branch, "branch");
  const sessionId = required(options.session, "session");
  const ttlSeconds = boundedInteger(options["ttl-seconds"] || "1800", "ttl-seconds", 300, 3600);
  const common = {
    mode,
    repository,
    worktreePath,
    branch,
    sessionId,
    ttlSeconds,
    json: options.json === true,
  };
  if (mode === "plan") return Object.freeze(common);
  const roots = [repository, worktreePath];
  const planFile = externalPrivateFile(options["plan-file"], "plan-file", roots);
  const taskAuthorityFile = externalPrivateFile(
    options["task-authority"],
    "task-authority",
    roots,
  );
  return Object.freeze({
    ...common,
    planFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")),
    taskAuthorityFile,
    authorization: required(options.authorize, "authorize"),
  });
}

function parseOptions(tokens) {
  const options = {};
  for (const token of tokens) {
    if (token === "--json") {
      if (options.json) fail("Duplicate argument: --json");
      options.json = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match) fail(`Unknown argument: ${token}`);
    if (Object.hasOwn(options, match[1])) fail(`Duplicate argument: --${match[1]}`);
    options[match[1]] = match[2];
  }
  return options;
}

function externalPrivateFile(value, label, roots) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) fail(`--${label} must be absolute.`);
  const candidate = path.resolve(source);
  if (roots.some(root => candidate === path.resolve(root)
    || candidate.startsWith(`${path.resolve(root)}${path.sep}`))) {
    fail(`--${label} must remain outside repository worktrees.`);
  }
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    fail(`--${label} must be a private regular file.`);
  }
  return candidate;
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(`--${label} is required.`);
  }
  return value;
}
function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(`--${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}
function usage() {
  return "Usage: planned-device-projection-recovery.mjs <plan|run> --repository=<canonical-main-worktree> --worktree=<exact-target-worktree> --branch=<branch> --session=<id> [--ttl-seconds=1800] [--plan-file=<external-plan.json> --task-authority=<external-capability.json> --authorize='authorize planned-device-projection-recovery <digest>'] [--json]";
}
function fail(message) { throw new Error(message); }
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const input = parsePlannedDeviceProjectionRecoveryArguments(process.argv.slice(2));
    const output = await runPlannedDeviceProjectionRecovery(input);
    process.stdout.write(`${JSON.stringify(output, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      ok: false,
      status: "error",
      error: {
        code: "planned_device_projection_recovery_failed",
        message: error.message,
      },
    })}\n`);
    process.exitCode = 1;
  }
}
