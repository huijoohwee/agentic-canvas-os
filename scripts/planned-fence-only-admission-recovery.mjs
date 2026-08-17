#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized recovery transport.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlannedFenceOnlyAdmissionRecoveryController }
  from "./planned-fence-only-admission-recovery-controller.mjs";
import { createPlannedFenceOnlyAdmissionRecoveryRepositoryAdapter }
  from "./planned-fence-only-admission-recovery-repository-adapter.mjs";
import { createPlannedFenceOnlyAdmissionRecoveryStore }
  from "./planned-fence-only-admission-recovery-store.mjs";

const COMMAND_SCHEMA = "agentic-planned-fence-only-admission-recovery-command/v1";

export async function runPlannedFenceOnlyAdmissionRecovery(input, dependencies = {}) {
  const createAdapter = dependencies.createAdapter
    || createPlannedFenceOnlyAdmissionRecoveryRepositoryAdapter;
  const adapter = createAdapter({
    repository: input.repository,
    worktreePath: input.worktreePath,
    branch: input.branch,
    sessionId: input.sessionId,
    manifestFile: input.manifestFile,
    taskAuthorityFile: input.taskAuthorityFile || null,
  }, dependencies.adapterDependencies || {});
  const branch = adapter.branch || input.branch;
  const createStore = dependencies.createStore
    || createPlannedFenceOnlyAdmissionRecoveryStore;
  const store = createStore({
    gitCommonDir: adapter.gitCommonDir,
    branch,
    statePath: input.statePath || null,
  });
  const createController = dependencies.createController
    || createPlannedFenceOnlyAdmissionRecoveryController;
  const controller = createController({ adapter, store });
  return input.mode === "plan"
    ? await controller.plan({ ttlSeconds: input.ttlSeconds })
    : await controller.run({ plan: input.plan, authorization: input.authorization });
}

export function parsePlannedFenceOnlyAdmissionRecoveryArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = parseOptions(tokens);
  const allowed = new Set([
    "repository", "worktree", "branch", "session", "manifest", "ttl-seconds", "state-path",
    ...(mode === "run" ? ["plan-file", "task-authority", "authorize"] : []),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const worktreePath = path.resolve(required(options.worktree, "worktree"));
  const branch = required(options.branch, "branch");
  const sessionId = required(options.session, "session");
  const externalRoots = [repository, worktreePath];
  const manifestFile = externalFile(options.manifest, "manifest", externalRoots);
  const ttlSeconds = boundedInteger(options["ttl-seconds"] || "3600", "ttl-seconds", 300, 86_400);
  const statePath = options["state-path"]
    ? externalPath(options["state-path"], "state-path", externalRoots) : null;
  const common = {
    mode, repository, worktreePath, branch, sessionId, manifestFile, ttlSeconds, statePath,
    json: options.json === true,
  };
  if (mode === "plan") return Object.freeze(common);
  const planFile = externalFile(options["plan-file"], "plan-file", externalRoots);
  const taskAuthorityFile = externalFile(
    options["task-authority"], "task-authority", externalRoots,
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

function externalFile(value, label, roots) {
  const candidate = externalPath(value, label, roots);
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    fail(`--${label} must be a private regular file.`);
  }
  return candidate;
}
function externalPath(value, label, roots) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) fail(`--${label} must be absolute.`);
  const candidate = path.resolve(source);
  if (roots.some(root => candidate === path.resolve(root)
    || candidate.startsWith(`${path.resolve(root)}${path.sep}`))) {
    fail(`--${label} must remain outside the repository and target worktree.`);
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
  return "Usage: planned-fence-only-admission-recovery.mjs <plan|run> --repository=<canonical-main-worktree> --worktree=<exact-recorded-target> --branch=<existing-remote-branch> --session=<id> --manifest=<external-manifest.json> [--ttl-seconds=3600] [--state-path=<external-journal.json>] [--plan-file=<external-plan.json> --task-authority=<external-capability.json> --authorize='authorize planned-fence-only-admission-recovery <digest>'] [--json]";
}
function fail(message) { throw new Error(message); }
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const input = parsePlannedFenceOnlyAdmissionRecoveryArguments(process.argv.slice(2));
    const output = await runPlannedFenceOnlyAdmissionRecovery(input);
    process.stdout.write(`${JSON.stringify(output, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      ok: false,
      status: "error",
      error: { code: "planned_fence_only_admission_recovery_failed", message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
