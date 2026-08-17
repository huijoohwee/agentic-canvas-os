#!/usr/bin/env node
// Responsibility: Expose sealed plan and task-authorized run for one marker-only repair.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRepositoryExpiredPlannedCommittedPrMarkerResponseLossAdapter }
  from "./expired-planned-committed-pr-marker-response-loss-repository-adapter.mjs";
import { createExpiredPlannedCommittedPrMarkerResponseLossController }
  from "./expired-planned-committed-pr-marker-response-loss-controller.mjs";

export async function runExpiredPlannedCommittedPrMarkerResponseLoss(
  input,
  dependencies = {},
) {
  const createAdapter = dependencies.createAdapter
    || createRepositoryExpiredPlannedCommittedPrMarkerResponseLossAdapter;
  const adapter = createAdapter({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile,
  }, dependencies.adapterDependencies);
  const controller = (dependencies.createController
    || createExpiredPlannedCommittedPrMarkerResponseLossController)(adapter);
  if (input.mode === "plan") return controller.plan();
  if (input.mode === "run") return controller.run({ plan: input.plan });
  throw new Error("Expired planned marker response-loss mode must be plan or run.");
}

export function parseExpiredPlannedCommittedPrMarkerResponseLossArguments(argumentsList) {
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
    "session",
    ...(mode === "run" ? ["plan-file", "task-authority"] : []),
  ]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const base = {
    mode,
    repository: path.resolve(required(options.repository, "repository")),
    pullRequestNumber: positiveInteger(options["pull-request"], "pull-request"),
    sessionId: required(options.session, "session"),
    json: options.json === true,
  };
  if (mode === "plan") return Object.freeze(base);
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  const taskAuthorityFile = path.resolve(required(
    options["task-authority"],
    "task-authority",
  ));
  return Object.freeze({
    ...base,
    planFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")),
    taskAuthorityFile,
  });
}

async function main() {
  try {
    const input = parseExpiredPlannedCommittedPrMarkerResponseLossArguments(
      process.argv.slice(2),
    );
    const result = await runExpiredPlannedCommittedPrMarkerResponseLoss(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`--${label} is required.`);
  return value.trim();
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(`--${label} must be a positive integer.`);
  }
  return number;
}
function usage() {
  return "Usage: expired-planned-committed-pr-marker-response-loss.mjs <plan|run> "
    + "--repository=<path> --pull-request=<number> --session=<session-id> "
    + "[--plan-file=<sealed-plan.json> --task-authority=<external-capability.json>] [--json]";
}
function fail(message) {
  throw new Error(message);
}
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) await main();
