#!/usr/bin/env node
// Responsibility: Expose sealed planning and capability-bound recovery for both exact successor projection modes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReviewedSuccessorProjectionResponseLossController }
  from "./reviewed-successor-projection-response-loss-controller.mjs";
import { createRepositoryReviewedSuccessorProjectionResponseLossAdapter }
  from "./reviewed-successor-projection-response-loss-repository-adapter.mjs";

export async function runReviewedSuccessorProjectionResponseLoss(input, dependencies = {}) {
  const adapter = (dependencies.createAdapter
    || createRepositoryReviewedSuccessorProjectionResponseLossAdapter)(input, dependencies.adapterDependencies);
  const controller = (dependencies.createController
    || createReviewedSuccessorProjectionResponseLossController)(adapter);
  if (input.mode === "plan") return controller.plan();
  if (input.mode === "run") {
    return controller.run({
      plan: input.plan,
      authorization: input.authorization,
      taskAuthorityFile: input.taskAuthorityFile,
    });
  }
  throw new Error("Reviewed-successor response-loss mode must be plan or run.");
}

export function parseReviewedSuccessorProjectionResponseLossArguments(values) {
  const [mode, ...tokens] = values;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") { options.json = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  const input = {
    mode,
    repository: path.resolve(required(options.repository, "repository")),
    pullRequestNumber: positiveInteger(options["pull-request"], "pull-request"),
    sessionId: required(options.session, "session"),
    json: options.json === true,
  };
  if (mode === "plan") return Object.freeze(input);
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  return Object.freeze({
    ...input,
    planFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")),
    authorization: required(options.authorize, "authorize"),
    taskAuthorityFile: path.resolve(required(options["task-authority"], "task-authority")),
  });
}

async function main() {
  try {
    const input = parseReviewedSuccessorProjectionResponseLossArguments(process.argv.slice(2));
    const result = await runReviewedSuccessorProjectionResponseLoss(input);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 0 : 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
function required(value, name) { if (!value?.trim()) fail(`--${name} is required.`); return value.trim(); }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(`--${name} must be positive.`); return number; }
function fail(message) { throw new Error(message); }
function usage() { return "Usage: reviewed-successor-projection-response-loss.mjs <plan|run> --repository=<path> --pull-request=<number> --session=<id> [--plan-file=<json> --authorize=<token> --task-authority=<capability>] [--json]"; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
