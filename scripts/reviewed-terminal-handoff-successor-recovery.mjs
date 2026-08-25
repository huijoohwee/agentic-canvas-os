#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized reviewed terminal-handoff recovery.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createReviewedTerminalHandoffSuccessorRecoveryController }
  from "./reviewed-terminal-handoff-successor-recovery-controller.mjs";
import { createReviewedTerminalHandoffSuccessorRecoveryRepositoryAdapter }
  from "./reviewed-terminal-handoff-successor-recovery-repository-adapter.mjs";

const OPTIONS = new Set([
  "authorization", "branch", "operator-session", "plan", "repository",
  "task-authority", "ttl-seconds",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parse(tail);
  const repository = path.resolve(required(options, "repository"));
  const operatorSessionId = required(options, "operator-session");
  const adapter = (dependencies.createAdapter
    || createReviewedTerminalHandoffSuccessorRecoveryRepositoryAdapter)({
    repository,
    branch: options.get("branch") || null,
    taskAuthorityFile: path.resolve(required(options, "task-authority")),
  });
  const controller = (dependencies.createController
    || createReviewedTerminalHandoffSuccessorRecoveryController)(adapter);
  if (command === "plan") {
    if (options.has("authorization") || options.has("plan")) {
      throw new Error("plan does not accept --authorization or --plan.");
    }
    return controller.plan({
      operatorSessionId,
      ttlSeconds: Number(options.get("ttl-seconds") || 1800),
    });
  }
  return controller.run({
    plan: readJson(path.resolve(required(options, "plan")), "recovery plan"),
    operatorSessionId,
    authorization: required(options, "authorization"),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try { console.log(JSON.stringify(await main(argumentsList))); return 0; }
  catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-reviewed-terminal-handoff-successor-recovery-result/v1",
      ok: false,
      status: "blocked",
      error: String(error?.message || error).slice(0, 1_000),
    }));
    return 1;
  }
}

function parse(argumentsList) {
  const options = new Map();
  for (const argument of argumentsList) {
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1]) || !match[2] || options.has(match[1])) {
      throw new Error(`Unsupported or duplicate option: ${argument}`);
    }
    options.set(match[1], match[2]);
  }
  return options;
}
function required(options, name) { const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
function readJson(file, label) { try { const value = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object"); return value;
} catch (error) { throw new Error(`Unable to read ${label}: ${error.message}`); } }
function usage() { return "Usage: reviewed-terminal-handoff-successor-recovery.mjs plan|run "
  + "--repository=<worktree> --operator-session=<session> --task-authority=<external-file> "
  + "[--branch=<branch> --ttl-seconds=<seconds>] [--plan=<json> --authorization=<exact-token>]"; }

const entry = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (entry) process.exitCode = await runCli();
