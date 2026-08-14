#!/usr/bin/env node
// Responsibility: expose strict read-only planning and exact-authorized successor projection repair.
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { createTaskAuthoritySuccessorProjectionRepairController }
  from "./task-authority-successor-projection-repair-controller.mjs";
import { createRepositoryTaskAuthoritySuccessorProjectionRepairAdapter }
  from "./task-authority-successor-projection-repair-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-task-authority-successor-projection-repair-result/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const VALUE_OPTIONS = new Set([
  "authorize", "plan-digest", "pull-request", "session", "source-repository",
  "target-repository", "task-authority", "ttl-seconds",
]);
const FLAG_OPTIONS = new Set(["json"]);

export function parseTaskAuthoritySuccessorProjectionRepairArguments(argv) {
  const [command, ...tail] = argv;
  if (!new Set(["plan", "run"]).has(command)) {
    throw new Error(usage());
  }
  const options = parseOptions(tail);
  const common = Object.freeze({
    sourceRepository: absolute(required(options, "source-repository"),
      "--source-repository"),
    sessionId: required(options, "session"),
    capabilityFile: absolute(required(options, "task-authority"), "--task-authority"),
    pullRequestNumber: positiveInteger(required(options, "pull-request"),
      "--pull-request"),
    targetRepository: repository(options.get("target-repository")
      || "huijoohwee/agentic-canvas-os"),
    ttlSeconds: exactTtl(options.get("ttl-seconds")),
  });
  if (command === "plan") {
    if (options.has("plan-digest") || options.has("authorize")) {
      throw new Error("plan does not accept --plan-digest or --authorize.");
    }
    return Object.freeze({ command, common, planDigest: null,
      authorization: null, json: options.has("json") });
  }
  const planDigest = options.get("plan-digest");
  if (!DIGEST.test(String(planDigest || ""))) {
    throw new Error("run requires --plan-digest=<exact lowercase SHA-256 digest>.");
  }
  return Object.freeze({
    command, common, planDigest,
    authorization: required(options, "authorize"),
    json: options.has("json"),
  });
}

export async function main(argv = process.argv.slice(2), {
  createAdapter = createRepositoryTaskAuthoritySuccessorProjectionRepairAdapter,
  createController = createTaskAuthoritySuccessorProjectionRepairController,
} = {}) {
  const input = parseTaskAuthoritySuccessorProjectionRepairArguments(argv);
  const controller = createController({ adapter: createAdapter(input.common) });
  const plan = await controller.plan();
  if (input.command === "plan") return plan;
  if (plan.planDigest !== input.planDigest) {
    throw new Error("Live successor-projection repair plan differs from --plan-digest.");
  }
  return controller.run({ plan, authorization: input.authorization });
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    process.stdout.write(`${JSON.stringify(await main(argv))}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA,
      status: "blocked",
      error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function parseOptions(argv) {
  const options = new Map();
  for (const argument of argv) {
    const flag = argument.match(/^--([a-z0-9-]+)$/u);
    const valued = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    const name = flag?.[1] || valued?.[1];
    if (!name || (!FLAG_OPTIONS.has(name) && !VALUE_OPTIONS.has(name))) {
      throw new Error(`Unsupported option: ${argument}`);
    }
    if (options.has(name)) throw new Error(`--${name} must be provided exactly once.`);
    if (FLAG_OPTIONS.has(name)) {
      if (!flag) throw new Error(`--${name} does not accept a value.`);
      options.set(name, true);
    } else {
      if (!valued || !valued[2]) throw new Error(`--${name}=<value> is required.`);
      options.set(name, valued[2]);
    }
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || !value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function absolute(value, label) {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return value;
}

function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function exactTtl(value) {
  if (value === undefined) return 7_200;
  const ttl = positiveInteger(value, "--ttl-seconds");
  if (ttl !== 7_200) throw new Error("--ttl-seconds must be exactly 7200.");
  return ttl;
}

function repository(value) {
  if (!REPOSITORY.test(value)) {
    throw new Error("--target-repository must be an owner/name repository.");
  }
  return value;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}

function usage() {
  return "Usage: task-authority-successor-projection-repair.mjs plan|run "
    + "--source-repository=<absolute> --session=<id> "
    + "--task-authority=<absolute> --pull-request=<number> "
    + "[--target-repository=<owner/name>] [--ttl-seconds=7200] [--json] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
