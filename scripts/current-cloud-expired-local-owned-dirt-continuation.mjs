#!/usr/bin/env node
// Responsibility: Expose plan and task-authorized run commands for local lease continuation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCurrentCloudExpiredLocalOwnedDirtContinuationController }
  from "./current-cloud-expired-local-owned-dirt-continuation-controller.mjs";
import { createRepositoryCurrentCloudExpiredLocalOwnedDirtContinuationAdapter }
  from "./current-cloud-expired-local-owned-dirt-continuation-repository-adapter.mjs";

export async function runCurrentCloudExpiredLocalOwnedDirtContinuation(input, dependencies = {}) {
  const adapter = createRepositoryCurrentCloudExpiredLocalOwnedDirtContinuationAdapter({
    repository: input.repository,
    sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile,
  }, dependencies);
  const controller = createCurrentCloudExpiredLocalOwnedDirtContinuationController(adapter);
  return input.mode === "plan" ? controller.plan() : controller.run({ plan: input.plan });
}

export function parseCurrentCloudExpiredLocalOwnedDirtContinuationArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") { options.json = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set(["repository", "session", ...(mode === "run"
    ? ["plan-file", "task-authority"] : [])]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = required(options.repository, "repository");
  const sessionId = required(options.session, "session");
  if (mode === "plan") return Object.freeze({ mode, repository, sessionId,
    json: options.json === true });
  const planFile = path.resolve(required(options["plan-file"], "plan-file"));
  const taskAuthorityFile = path.resolve(required(options["task-authority"], "task-authority"));
  return Object.freeze({ mode, repository, sessionId, planFile, taskAuthorityFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")), json: options.json === true });
}

async function main() {
  try {
    const input = parseCurrentCloudExpiredLocalOwnedDirtContinuationArguments(process.argv.slice(2));
    const result = await runCurrentCloudExpiredLocalOwnedDirtContinuation(input);
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
  return "Usage: current-cloud-expired-local-owned-dirt-continuation.mjs <plan|run> --repository=<path> --session=<source-session> [--plan-file=<sealed-plan.json> --task-authority=<external-capability.json>] [--json]";
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
