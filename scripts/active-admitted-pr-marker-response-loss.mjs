#!/usr/bin/env node
// Responsibility: Expose plan and task-authorized run commands for marker response-loss repair.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createActiveAdmittedPrMarkerResponseLossController }
  from "./active-admitted-pr-marker-response-loss-controller.mjs";
import { createRepositoryActiveAdmittedPrMarkerResponseLossAdapter }
  from "./active-admitted-pr-marker-response-loss-repository-adapter.mjs";

export async function runActiveAdmittedPrMarkerResponseLoss(input, dependencies = {}) {
  const adapter = createRepositoryActiveAdmittedPrMarkerResponseLossAdapter({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    taskAuthorityFile: input.taskAuthorityFile,
  }, dependencies);
  const controller = createActiveAdmittedPrMarkerResponseLossController(adapter);
  return input.mode === "plan"
    ? controller.plan()
    : controller.run({ plan: input.plan });
}

export function parseActiveAdmittedPrMarkerResponseLossArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") { options.json = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match) fail(`Unknown argument: ${token}`);
    if (Object.hasOwn(options, match[1])) fail(`Duplicate argument: --${match[1]}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set([
    "repository",
    "pull-request",
    ...(mode === "run" ? ["plan-file", "task-authority"] : []),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = required(options.repository, "repository");
  const pullRequestNumber = positiveInteger(options["pull-request"], "pull-request");
  if (mode === "plan") {
    return Object.freeze({ mode, repository, pullRequestNumber, json: options.json === true });
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
    const input = parseActiveAdmittedPrMarkerResponseLossArguments(process.argv.slice(2));
    const result = await runActiveAdmittedPrMarkerResponseLoss(input);
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
  if (!Number.isSafeInteger(number) || number < 1) fail(`--${label} must be a positive integer.`);
  return number;
}
function usage() {
  return "Usage: active-admitted-pr-marker-response-loss.mjs <plan|run> --repository=<path> --pull-request=<number> [--plan-file=<sealed-plan.json> --task-authority=<external-capability.json>] [--json]";
}
function fail(message) {
  throw new Error(message);
}
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) await main();
