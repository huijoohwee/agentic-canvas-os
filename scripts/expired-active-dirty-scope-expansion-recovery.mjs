#!/usr/bin/env node
// Responsibility: expose read-only expired active-dirty planning and exact-authority recovery.
import { pathToFileURL } from "node:url";

import { createExpiredActiveDirtyScopeExpansionRecoveryController }
  from "./expired-active-dirty-scope-expansion-recovery-controller.mjs";
import { createRepositoryExpiredActiveDirtyScopeExpansionRecoveryAdapter }
  from "./expired-active-dirty-scope-expansion-recovery-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-result/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const OPTIONS = new Set([
  "authorize", "claim-id", "ledger-repository", "plan-digest",
  "pull-request", "source-repository", "target-repository", "ttl-seconds",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryExpiredActiveDirtyScopeExpansionRecoveryAdapter,
  createController = createExpiredActiveDirtyScopeExpansionRecoveryController,
} = {}) {
  const [command = "plan", ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const planDigest = options.get("plan-digest") || null;
  if (command === "plan" && options.has("authorize")) {
    throw new Error("plan does not accept --authorize.");
  }
  if (command === "run") {
    if (!DIGEST_PATTERN.test(String(planDigest || ""))) {
      throw new Error("run requires --plan-digest=<exact lowercase digest>.");
    }
    required(options, "authorize");
  }
  const adapter = createAdapter({
    sourceRepository: required(options, "source-repository"),
    targetRepository: required(options, "target-repository"),
    pullRequestNumber: positiveInteger(required(options, "pull-request"), "--pull-request"),
    claimId: requiredDigest(required(options, "claim-id"), "--claim-id"),
    ledgerRepository: options.get("ledger-repository") || "huijoohwee/agentic-canvas-os",
    ttlSeconds: options.has("ttl-seconds")
      ? positiveInteger(options.get("ttl-seconds"), "--ttl-seconds") : 1_800,
  });
  const controller = createController({ adapter });
  if (command === "plan") return controller.plan({ planDigest });
  return controller.run({
    planDigest,
    authorization: required(options, "authorize"),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
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
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
    if (values.has(match[1])) throw new Error(`--${match[1]} must be provided exactly once.`);
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
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
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
  return "Usage: expired-active-dirty-scope-expansion-recovery.mjs plan|run "
    + "--source-repository=<expired-dirty-worktree> --target-repository=<owner/name> "
    + "--pull-request=<number> --claim-id=<digest> "
    + "[--ledger-repository=<owner/name>] [--ttl-seconds=1800] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
