#!/usr/bin/env node
// Responsibility: Expose read-only plan and explicitly authorized run commands.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActivePublishTaskAuthoritySuccessorReconciliationController } from "./active-publish-task-authority-successor-reconciliation-controller.mjs";
import { createActivePublishTaskAuthoritySuccessorReconciliationRepositoryAdapter } from "./active-publish-task-authority-successor-reconciliation-repository-adapter.mjs";

export function parseArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const values = {};
  for (const token of tokens) { if (token === "--json") { values.json = true; continue; } const match = /^--([a-z-]+)=(.+)$/u.exec(token); if (!match || Object.hasOwn(values, match[1])) fail(`Invalid argument: ${token}`); values[match[1]] = match[2]; }
  const allowed = new Set(["repository", "pull-request", "session", ...(mode === "run" ? ["plan-file", "task-authority", "authorize"] : [])]);
  for (const key of Object.keys(values)) if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  const input = { mode, repository: path.resolve(required(values.repository, "repository")), pullRequestNumber: positive(values["pull-request"], "pull-request"), sessionId: required(values.session, "session"), json: values.json === true };
  if (mode === "run") Object.assign(input, { plan: JSON.parse(readFileSync(path.resolve(required(values["plan-file"], "plan-file")), "utf8")), taskAuthorityFile: path.resolve(required(values["task-authority"], "task-authority")), authorization: required(values.authorize, "authorize") });
  return Object.freeze(input);
}

export async function runCommand(input, dependencies = {}) {
  const adapter = (dependencies.createAdapter || createActivePublishTaskAuthoritySuccessorReconciliationRepositoryAdapter)(input, dependencies.adapterDependencies);
  const controller = (dependencies.createController || createActivePublishTaskAuthoritySuccessorReconciliationController)(adapter);
  return input.mode === "plan" ? controller.plan() : controller.run({ plan: input.plan, authorization: input.authorization });
}

async function main() { try { const input = parseArguments(process.argv.slice(2)); const result = await runCommand(input); process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }
function required(value, label) { if (typeof value !== "string" || !value.trim()) fail(`--${label} is required.`); return value; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) fail(`--${label} is invalid.`); return result; }
function fail(message) { throw new Error(message); }
function usage() { return "Usage: active-publish-task-authority-successor-reconciliation.mjs <plan|run> --repository=<worktree> --pull-request=<number> --session=<id> [--plan-file=<file> --task-authority=<file> --authorize=<exact token>] [--json]"; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
