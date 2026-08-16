#!/usr/bin/env node
// Responsibility: Expose plan and task-authorized run commands for local lease continuation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCurrentCloudExpiredLocalWorkContinuationController }
  from "./current-cloud-expired-local-work-continuation-controller.mjs";
import { createRepositoryCurrentCloudExpiredLocalWorkContinuationAdapter }
  from "./current-cloud-expired-local-work-continuation-repository-adapter.mjs";

export async function runCurrentCloudExpiredLocalWorkContinuation(input, dependencies = {}) {
  const adapter = createRepositoryCurrentCloudExpiredLocalWorkContinuationAdapter({
    repository: input.repository,
    mode: input.continuationMode,
    sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile,
  }, dependencies);
  const controller = createCurrentCloudExpiredLocalWorkContinuationController(adapter);
  return input.mode === "plan" ? controller.plan() : controller.run({ plan: input.plan });
}

export function parseCurrentCloudExpiredLocalWorkContinuationArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") { options.json = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set(["repository", "session", "continuation-mode", ...(mode === "run"
    ? ["plan-file", "task-authority"] : [])]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = required(options.repository, "repository");
  const sessionId = required(options.session, "session");
  const continuationMode = required(options["continuation-mode"], "continuation-mode");
  if (!new Set(["admitted-committed-descendant-dirty", "planned-fence-dirty"])
    .has(continuationMode)) fail("--continuation-mode is invalid.");
  if (mode === "plan") return Object.freeze({ mode, repository, sessionId, continuationMode,
    json: options.json === true });
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  const taskAuthorityFile = path.resolve(required(options["task-authority"], "task-authority"));
  return Object.freeze({ mode, repository, sessionId, continuationMode, planFile, taskAuthorityFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")), json: options.json === true });
}

async function main() {
  try {
    const input = parseCurrentCloudExpiredLocalWorkContinuationArguments(process.argv.slice(2));
    const result = await runCurrentCloudExpiredLocalWorkContinuation(input);
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
function fail(message) { throw new Error(message); }
function usage() {
  return "Usage: current-cloud-expired-local-work-continuation.mjs <plan|run> --repository=<path> --session=<source-session> --continuation-mode=<admitted-committed-descendant-dirty|planned-fence-dirty> [--plan-file=<sealed-plan.json> --task-authority=<external-capability.json>] [--json]";
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
