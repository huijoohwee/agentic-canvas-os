#!/usr/bin/env node
// Responsibility: Expose external plan and exact-authorized run transports for marker replay.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createActiveOwnedDirtCurrentBasePrMarkerReplayController }
  from "./active-owned-dirt-current-base-pr-marker-replay-controller.mjs";
import { createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter }
  from "./active-owned-dirt-current-base-pr-marker-replay-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-active-owned-dirt-current-base-pr-marker-replay-result/v1";

export function parseActiveOwnedDirtCurrentBasePrMarkerReplayArguments(argumentsList) {
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
    if (!match) fail(`Unknown argument: ${token}`);
    if (Object.hasOwn(options, match[1])) fail(`Duplicate argument: --${match[1]}`);
    options[match[1]] = match[2];
  }
  const common = [
    "repository", "reanchor-plan", "reanchor-journal", "recovery-journal",
  ];
  const allowed = new Set([
    ...common,
    ...(mode === "plan" ? ["output", "ttl-seconds"] : [
      "plan-file", "task-authority", "authorize",
    ]),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const base = {
    mode,
    repository,
    reanchorPlanFile: path.resolve(required(options["reanchor-plan"], "reanchor-plan")),
    reanchorJournalFile: path.resolve(
      required(options["reanchor-journal"], "reanchor-journal"),
    ),
    recoveryJournalFile: path.resolve(
      required(options["recovery-journal"], "recovery-journal"),
    ),
    json: options.json === true,
  };
  for (const file of [base.reanchorPlanFile, base.reanchorJournalFile,
    base.recoveryJournalFile]) {
    requireExternal(file, repository);
  }
  if (mode === "plan") {
    const output = path.resolve(required(options.output, "output"));
    requireExternal(output, repository);
    const ttlSeconds = options["ttl-seconds"] === undefined
      ? undefined : positiveInteger(options["ttl-seconds"], "ttl-seconds");
    return Object.freeze({ ...base, output, ttlSeconds });
  }
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  const taskAuthorityFile = path.resolve(
    required(options["task-authority"], "task-authority"),
  );
  requireExternal(planFile, repository);
  requireExternal(taskAuthorityFile, repository);
  return Object.freeze({
    ...base,
    planFile,
    taskAuthorityFile,
    authorization: required(options.authorize, "authorize"),
  });
}

export const parseArguments =
  parseActiveOwnedDirtCurrentBasePrMarkerReplayArguments;

export async function runActiveOwnedDirtCurrentBasePrMarkerReplayCli(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  const input = Array.isArray(argumentsList)
    ? parseActiveOwnedDirtCurrentBasePrMarkerReplayArguments(argumentsList)
    : argumentsList;
  const createAdapter = dependencies.createAdapter
    || createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter;
  const createController = dependencies.createController
    || createActiveOwnedDirtCurrentBasePrMarkerReplayController;
  const adapter = createAdapter(input, dependencies.adapterDependencies || {});
  const controller = createController(adapter);
  if (input.mode === "plan") {
    const plan = await controller.plan({ ttlSeconds: input.ttlSeconds });
    if (typeof adapter.writePlanFile !== "function") {
      fail("Marker replay adapter requires writePlanFile().");
    }
    const planFile = adapter.writePlanFile(plan);
    return Object.freeze({
      schema: RESULT_SCHEMA,
      ok: true,
      status: "planned",
      plan,
      planFile,
      exactAuthorization: plan.exactAuthorization,
    });
  }
  const plan = JSON.parse(readFileSync(input.planFile, "utf8"));
  const receipt = await controller.run({
    plan,
    authorization: input.authorization,
  });
  return Object.freeze({
    schema: RESULT_SCHEMA,
    ok: true,
    status: "complete",
    receipt,
  });
}

export const runCli = runActiveOwnedDirtCurrentBasePrMarkerReplayCli;

function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(`--${label}=<value> is required.`);
  }
  return value;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(`--${label} must be a positive integer.`);
  }
  return number;
}
function requireExternal(candidate, repository) {
  const relative = path.relative(repository, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    fail("Marker replay artifacts must remain outside the source repository.");
  }
}
function usage() {
  return [
    "Usage: active-owned-dirt-current-base-pr-marker-replay.mjs plan|run",
    "--repository=<worktree> --reanchor-plan=<external-plan>",
    "--reanchor-journal=<external-journal> --recovery-journal=<external-journal>",
    "[--output=<external-plan> --ttl-seconds=<30..900> |",
    "--plan-file=<external-plan> --task-authority=<external-capability>",
    "--authorize=<exact-text>] [--json]",
  ].join(" ");
}
function fail(message) {
  throw new Error(message);
}
function isMain() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const result = await runActiveOwnedDirtCurrentBasePrMarkerReplayCli();
    process.stdout.write(`${JSON.stringify(
      result,
      null,
      process.argv.includes("--json") ? 2 : 0,
    )}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: RESULT_SCHEMA,
      ok: false,
      status: "blocked",
      error: String(error?.message || error).slice(0, 1_000),
    })}\n`);
    process.exitCode = 1;
  }
}
