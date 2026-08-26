#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized planned-dirty admission recovery.
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlannedDirtyAdmissionRecoveryController }
  from "./planned-dirty-admission-recovery-controller.mjs";
import { OPERATION, normalizePlannedDirtyAdmissionRecoveryPlan }
  from "./planned-dirty-admission-recovery-contract.mjs";
import { createPlannedDirtyAdmissionRecoveryRepositoryAdapter }
  from "./planned-dirty-admission-recovery-repository-adapter.mjs";

const COMMAND_SCHEMA = "agentic-planned-dirty-admission-recovery-command/v1";

export async function runPlannedDirtyAdmissionRecovery(input, dependencies = {}) {
  const createAdapter = dependencies.createAdapter
    || createPlannedDirtyAdmissionRecoveryRepositoryAdapter;
  const adapter = createAdapter({
    repository: input.repository,
    sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile || null,
  }, dependencies.adapterDependencies || {});
  const createController = dependencies.createController
    || createPlannedDirtyAdmissionRecoveryController;
  const controller = createController(adapter);

  if (input.mode === "plan") {
    const plan = await controller.plan();
    if (input.outputFile) {
      writeFileSync(input.outputFile, `${JSON.stringify(plan, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
    return Object.freeze({
      schema: "agentic-planned-dirty-admission-recovery-plan-result/v1",
      status: "planned",
      plan,
      exactAuthorization: `authorize ${OPERATION} ${plan.planDigest}`,
    });
  }

  const plan = normalizePlannedDirtyAdmissionRecoveryPlan(
    input.plan || JSON.parse(readFileSync(input.planFile, "utf8")),
  );
  return controller.run({ plan, authorization: input.authorization });
}

export function parsePlannedDirtyAdmissionRecoveryArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = parseOptions(tokens);
  const allowed = new Set([
    "repository",
    "session",
    ...(mode === "plan" ? ["output"] : ["plan-file", "task-authority", "authorize"]),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const common = {
    mode,
    repository,
    sessionId: required(options.session, "session"),
    json: options.json === true,
  };
  if (mode === "plan") {
    return Object.freeze({
      ...common,
      outputFile: options.output
        ? externalPath(options.output, "output", repository) : null,
    });
  }
  return Object.freeze({
    ...common,
    planFile: externalFile(options["plan-file"], "plan-file", repository),
    taskAuthorityFile: externalFile(
      options["task-authority"],
      "task-authority",
      repository,
    ),
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
    if (!match) fail(`Invalid argument: ${token}`);
    if (Object.hasOwn(options, match[1])) fail(`Duplicate argument: --${match[1]}`);
    options[match[1]] = match[2];
  }
  return options;
}

function externalFile(value, label, repository) {
  const candidate = externalPath(value, label, repository);
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600) {
    fail(`--${label} must be a private regular file.`);
  }
  return candidate;
}
function externalPath(value, label, repository) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) fail(`--${label} must be absolute.`);
  const lexicalCandidate = path.resolve(source);
  const candidate = path.join(
    realpathSync(path.dirname(lexicalCandidate)),
    path.basename(lexicalCandidate),
  );
  const root = realpathSync(path.resolve(repository));
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    fail(`--${label} must remain outside the repository.`);
  }
  return candidate;
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(`--${label} is required.`);
  }
  return value;
}
function usage() {
  return "Usage: planned-dirty-admission-recovery.mjs <plan|run> --repository=<task-worktree> --session=<id> [--output=<external-plan.json> | --plan-file=<external-plan.json> --task-authority=<external-capability.json> --authorize='authorize planned-dirty-admission-recovery <digest>'] [--json]";
}
function fail(message) { throw new Error(message); }
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const input = parsePlannedDirtyAdmissionRecoveryArguments(process.argv.slice(2));
    const result = await runPlannedDirtyAdmissionRecovery(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      ok: false,
      status: "error",
      error: {
        code: "planned_dirty_admission_recovery_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    })}\n`);
    process.exitCode = 1;
  }
}
