#!/usr/bin/env node
// Responsibility: expose read-only planning and exact-authority terminal intent reconciliation.
import { pathToFileURL } from "node:url";

import {
  createActiveDirtyScopeExpansionIntentRecoveryController,
} from "./active-dirty-scope-expansion-intent-recovery-controller.mjs";
import {
  createRepositoryActiveDirtyScopeExpansionIntentRecoveryAdapter,
} from "./active-dirty-scope-expansion-intent-recovery-repository-adapter.mjs";

const RESULT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-result/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const OPTIONS = new Set([
  "authorize",
  "json",
  "ledger-repository",
  "plan-digest",
  "pull-request",
  "session",
  "source-repository",
  "target-repository",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryActiveDirtyScopeExpansionIntentRecoveryAdapter,
  createController = createActiveDirtyScopeExpansionIntentRecoveryController,
} = {}) {
  const [command = "plan", ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const planDigest = options.get("plan-digest") || null;
  if (command === "plan" && options.has("authorize")) {
    throw new Error("plan does not accept --authorize.");
  }
  if (command === "run") {
    requiredDigest(planDigest, "--plan-digest");
    required(options, "authorize");
  }
  const adapter = createAdapter({
    sourceRepository: required(options, "source-repository"),
    ledgerRepository: required(options, "ledger-repository"),
    targetRepository: required(options, "target-repository"),
    pullRequestNumber: positiveInteger(
      required(options, "pull-request"),
      "--pull-request",
    ),
    sessionId: required(options, "session"),
  });
  const controller = createController({ adapter });
  if (command === "plan") return controller.plan({ planDigest });
  return controller.run({
    planDigest,
    authorization: required(options, "authorize"),
  });
}

export async function runCli(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  try {
    console.log(JSON.stringify(await main(argumentsList, dependencies)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: RESULT_SCHEMA,
      status: "blocked",
      error: publicMessage(error),
    }));
    return 1;
  }
}

function parseOptions(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    if (argument === "--json") {
      if (values.has("json")) throw new Error("--json must be provided exactly once.");
      values.set("json", true);
      continue;
    }
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1])) {
      throw new Error(`Unsupported option: ${argument}`);
    }
    if (values.has(match[1])) {
      throw new Error(`--${match[1]} must be provided exactly once.`);
    }
    if (!match[2]) throw new Error(`--${match[1]} requires a value.`);
    values.set(match[1], match[2]);
  }
  return values;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase SHA-256 digest.`);
  }
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}

function usage() {
  return "Usage: active-dirty-scope-expansion-intent-recovery.mjs plan|run "
    + "--source-repository=<preserved-dirty-worktree> --session=<source-session> "
    + "--ledger-repository=<owner/name> --target-repository=<owner/name> "
    + "--pull-request=<number> "
    + "[--plan-digest=<digest> --authorize=<exact text>] [--json]";
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
