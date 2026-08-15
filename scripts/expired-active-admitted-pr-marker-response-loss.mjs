#!/usr/bin/env node
// Responsibility: Expose plan and task-authorized run commands for one expired marker repair.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExpiredActiveAdmittedPrMarkerResponseLossController }
  from "./expired-active-admitted-pr-marker-response-loss-controller.mjs";
import { createRepositoryExpiredActiveAdmittedPrMarkerResponseLossAdapter }
  from "./expired-active-admitted-pr-marker-response-loss-repository-adapter.mjs";

export async function runExpiredActiveAdmittedPrMarkerResponseLoss(
  input,
  dependencies = {},
) {
  const createAdapter = dependencies.createAdapter
    || createRepositoryExpiredActiveAdmittedPrMarkerResponseLossAdapter;
  const createController = dependencies.createController
    || createExpiredActiveAdmittedPrMarkerResponseLossController;
  const adapter = createAdapter({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    taskAuthorityFile: input.taskAuthorityFile,
    predecessorPlan: input.predecessorPlan,
  }, dependencies.adapterDependencies);
  const controller = createController(adapter);
  if (input.mode === "plan") return controller.plan();
  if (input.mode === "run") return controller.run({ plan: input.plan });
  throw new Error("Expired active admitted PR marker response-loss mode must be plan or run.");
}

export function parseExpiredActiveAdmittedPrMarkerResponseLossArguments(argumentsList) {
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
    ...(mode === "plan" ? ["predecessor-plan-file"] : ["plan-file", "task-authority"]),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = path.resolve(required(options.repository, "repository"));
  const pullRequestNumber = positiveInteger(options["pull-request"], "pull-request");
  if (mode === "plan") {
    const predecessorPlanFile = path.resolve(required(
      options["predecessor-plan-file"],
      "predecessor-plan-file",
    ));
    const predecessorPlan = JSON.parse(readFileSync(predecessorPlanFile, "utf8"));
    return Object.freeze({
      mode,
      repository,
      pullRequestNumber,
      predecessorPlan,
      predecessorPlanFile,
      json: options.json === true,
    });
  }
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  const taskAuthorityFile = path.resolve(required(options["task-authority"], "task-authority"));
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  return Object.freeze({
    mode,
    repository,
    pullRequestNumber,
    plan,
    planFile,
    taskAuthorityFile,
    json: options.json === true,
  });
}

async function main() {
  try {
    const input = parseExpiredActiveAdmittedPrMarkerResponseLossArguments(
      process.argv.slice(2),
    );
    const result = await runExpiredActiveAdmittedPrMarkerResponseLoss(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`--${label} is required.`);
  return value;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(`--${label} must be a positive integer.`);
  }
  return number;
}
function usage() {
  return "Usage: expired-active-admitted-pr-marker-response-loss.mjs <plan|run> "
    + "--repository=<path> --pull-request=<number> "
    + "[--predecessor-plan-file=<sealed-active-plan.json>] "
    + "[--plan-file=<sealed-expired-plan.json> --task-authority=<external-capability.json>] [--json]";
}
function fail(message) {
  throw new Error(message);
}
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) await main();
