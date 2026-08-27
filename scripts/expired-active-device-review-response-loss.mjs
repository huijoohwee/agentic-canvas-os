#!/usr/bin/env node
// Responsibility: Expose sealed planning and exact task-authorized execution for the recovery.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExpiredActiveDeviceReviewResponseLossController }
  from "./expired-active-device-review-response-loss-controller.mjs";
import { createRepositoryExpiredActiveDeviceReviewResponseLossAdapter }
  from "./expired-active-device-review-response-loss-repository-adapter.mjs";

export async function runExpiredActiveDeviceReviewResponseLoss(
  input,
  dependencies = {},
) {
  const createAdapter = dependencies.createAdapter
    || createRepositoryExpiredActiveDeviceReviewResponseLossAdapter;
  const createController = dependencies.createController
    || createExpiredActiveDeviceReviewResponseLossController;
  const adapter = createAdapter({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    taskAuthorityFile: input.taskAuthorityFile || null,
  }, dependencies.adapterDependencies);
  const controller = createController(adapter);
  if (input.mode === "plan") return controller.plan();
  if (input.mode === "run") {
    return controller.run({
      plan: input.plan,
      authorization: input.authorization,
    });
  }
  throw new Error("Expired active device-review response-loss mode must be plan or run.");
}

export function parseExpiredActiveDeviceReviewResponseLossArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") {
      if (options.json === true) fail("Duplicate argument: --json");
      options.json = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match) fail(`Unknown argument: ${token}`);
    if (Object.hasOwn(options, match[1])) fail(`Duplicate argument: --${match[1]}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set([
    "repository",
    "pull-request",
    ...(mode === "run" ? ["plan-file", "task-authority", "authorize"] : []),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const common = {
    mode,
    repository: path.resolve(required(options.repository, "repository")),
    pullRequestNumber: positiveInteger(options["pull-request"], "pull-request"),
    json: options.json === true,
  };
  if (mode === "plan") return Object.freeze(common);
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  const taskAuthorityFile = path.resolve(required(
    options["task-authority"],
    "task-authority",
  ));
  return Object.freeze({
    ...common,
    planFile,
    plan: parseJsonFile(planFile, "plan"),
    taskAuthorityFile,
    authorization: required(options.authorize, "authorize"),
  });
}

async function main() {
  try {
    const input = parseExpiredActiveDeviceReviewResponseLossArguments(
      process.argv.slice(2),
    );
    const result = await runExpiredActiveDeviceReviewResponseLoss(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 0 : 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function parseJsonFile(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Could not read ${label} file: ${error.message}`); }
}
function required(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(`--${name} is required.`);
  return value.trim();
}
function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`--${name} must be positive.`);
  return number;
}
function usage() {
  return "Usage: expired-active-device-review-response-loss.mjs <plan|run> "
    + "--repository=<path> --pull-request=<number> "
    + "[--plan-file=<sealed-plan.json> --task-authority=<capability.json> "
    + "--authorize=<exact-token>] [--json]";
}
function fail(message) { throw new Error(message); }
function isMain() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) await main();
