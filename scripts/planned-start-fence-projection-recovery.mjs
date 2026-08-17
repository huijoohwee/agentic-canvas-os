#!/usr/bin/env node
// Responsibility: Expose plan and task-authorized run transport for fence projection recovery.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlannedStartFenceProjectionRecoveryController }
  from "./planned-start-fence-projection-recovery-controller.mjs";
import { createRepositoryPlannedStartFenceProjectionRecoveryAdapter }
  from "./planned-start-fence-projection-recovery-repository-adapter.mjs";

export async function runPlannedStartFenceProjectionRecovery(input, dependencies = {}) {
  const createAdapter = dependencies.createAdapter
    || createRepositoryPlannedStartFenceProjectionRecoveryAdapter;
  const adapter = createAdapter({ repository: input.repository, sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile || null }, dependencies.adapterDependencies || {});
  const createController = dependencies.createController
    || createPlannedStartFenceProjectionRecoveryController;
  const controller = createController(adapter);
  return input.mode === "plan" ? controller.plan() : controller.run({ plan: input.plan });
}

export function parsePlannedStartFenceProjectionRecoveryArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") {
      if (options.json) fail("Duplicate argument: --json");
      options.json = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set(["repository", "session", ...(mode === "run"
    ? ["plan-file", "task-authority"] : [])]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const sessionId = required(options.session, "session");
  const common = { mode, repository, sessionId, json: options.json === true };
  if (mode === "plan") return Object.freeze(common);
  const roots = [repository];
  const planFile = external(options["plan-file"], "plan-file", roots);
  const taskAuthorityFile = external(options["task-authority"], "task-authority", roots);
  return Object.freeze({ ...common, planFile, taskAuthorityFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")) });
}

function external(value, label, roots) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) fail(`--${label} must be absolute.`);
  const candidate = path.resolve(source);
  if (roots.some(root => candidate === root || candidate.startsWith(`${root}${path.sep}`))) {
    fail(`--${label} must remain outside the repository.`);
  }
  return candidate;
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    fail(`--${label} is required.`);
  }
  return value;
}
function fail(message) { throw new Error(message); }
function usage() {
  return "Usage: planned-start-fence-projection-recovery.mjs <plan|run> --repository=<target-worktree> --session=<source-session> [--plan-file=<external-plan.json> --task-authority=<external-capability.json>] [--json]";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = parsePlannedStartFenceProjectionRecoveryArguments(process.argv.slice(2));
    const result = await runPlannedStartFenceProjectionRecovery(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
