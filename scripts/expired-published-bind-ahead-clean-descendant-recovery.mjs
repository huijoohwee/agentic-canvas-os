#!/usr/bin/env node
// Responsibility: Expose sealed planning and exact-authorized bind-ahead recovery.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExpiredPublishedBindAheadCleanDescendantRecoveryController }
  from "./expired-published-bind-ahead-clean-descendant-recovery-controller.mjs";
import { createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter }
  from "./expired-published-bind-ahead-clean-descendant-recovery-repository-adapter.mjs";

const COMMAND_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-command/v1";

export async function runExpiredPublishedBindAheadCleanDescendantRecovery(
  input,
  dependencies = {},
) {
  const createAdapter = dependencies.createAdapter
    || createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter;
  const createController = dependencies.createController
    || createExpiredPublishedBindAheadCleanDescendantRecoveryController;
  const adapter = createAdapter({
    repository: input.repository,
    sessionId: input.sessionId,
    pullRequestNumber: input.pullRequestNumber,
    ttlSeconds: input.ttlSeconds,
    taskAuthorityFile: input.taskAuthorityFile || null,
  }, dependencies.adapterDependencies || {});
  const controller = createController(adapter);
  if (input.mode === "plan") return controller.plan();
  if (input.mode === "run") {
    return controller.run({ plan: input.plan, authorization: input.authorization });
  }
  throw new Error("Bind-ahead clean-descendant recovery mode must be plan or run.");
}

export function parseExpiredPublishedBindAheadCleanDescendantRecoveryArguments(
  argumentsList,
) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = parseOptions(tokens);
  const allowed = new Set([
    "repository", "session", "pull-request", "ttl-seconds",
    ...(mode === "run" ? ["plan-file", "task-authority", "authorize"] : []),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const common = Object.freeze({
    mode,
    repository,
    sessionId: required(options.session, "session"),
    pullRequestNumber: positive(options["pull-request"], "pull-request"),
    ttlSeconds: bounded(options["ttl-seconds"] || "1800", "ttl-seconds", 300, 3600),
    json: options.json === true,
  });
  if (mode === "plan") return common;
  const planFile = externalPrivateFile(options["plan-file"], "plan-file", repository);
  const taskAuthorityFile = externalPrivateFile(
    options["task-authority"],
    "task-authority",
    repository,
  );
  return Object.freeze({
    ...common,
    planFile,
    plan: parseJson(planFile, "plan"),
    taskAuthorityFile,
    authorization: required(options.authorize, "authorize"),
  });
}

function parseOptions(tokens) {
  const options = {};
  for (const token of tokens) {
    if (token === "--json") {
      if (options.json === true) fail("Duplicate argument: --json");
      options.json = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  return options;
}

function externalPrivateFile(value, label, repository) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) fail(`--${label} must be absolute.`);
  const candidate = path.resolve(source);
  const root = path.resolve(repository);
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    fail(`--${label} must remain outside the repository worktree.`);
  }
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    fail(`--${label} must be a private regular file.`);
  }
  return candidate;
}

function parseJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Could not read ${label} file: ${error.message}`); }
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(`--${label} is required.`);
  }
  return value;
}
function positive(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`--${label} must be positive.`);
  return number;
}
function bounded(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(`--${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}
function usage() {
  return "Usage: expired-published-bind-ahead-clean-descendant-recovery.mjs <plan|run> "
    + "--repository=<task-worktree> --session=<source-session> --pull-request=<number> "
    + "[--ttl-seconds=1800] [--plan-file=<external-plan.json> "
    + "--task-authority=<external-capability.json> "
    + "--authorize='authorize expired-published-bind-ahead-clean-descendant-recovery "
    + "<plan-digest>'] [--json]";
}
function fail(message) { throw new Error(message); }
function isMain() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const input = parseExpiredPublishedBindAheadCleanDescendantRecoveryArguments(
      process.argv.slice(2),
    );
    const result = await runExpiredPublishedBindAheadCleanDescendantRecovery(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      ok: false,
      status: "error",
      error: {
        code: "expired_published_bind_ahead_clean_descendant_recovery_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    })}\n`);
    process.exitCode = 1;
  }
}
