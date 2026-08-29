#!/usr/bin/env node
// Responsibility: expose read-only planning and exact-authorized provider-only pair reconciliation.

import { pathToFileURL } from "node:url";

import { createProviderOnlyMergedClaimPairReconciliationController } from "./provider-only-merged-claim-pair-reconciliation-controller.mjs";
import { createRepositoryProviderOnlyMergedClaimPairReconciliationAdapter } from "./provider-only-merged-claim-pair-reconciliation-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-provider-only-merged-claim-pair-reconciliation-result/v1";
const OPTIONS = new Set([
  "source-repository", "target-repository", "pull-request", "source-claim-id",
  "waiter-claim-id", "ledger-repository", "state-path", "ttl-seconds", "plan-digest",
  "authorize", "json",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryProviderOnlyMergedClaimPairReconciliationAdapter,
  createController = createProviderOnlyMergedClaimPairReconciliationController,
} = {}) {
  const { command, options } = parseArguments(argumentsList);
  const adapter = createAdapter({
    sourceRepository: required(options, "source-repository"),
    targetRepository: required(options, "target-repository"),
    pullRequestNumber: positive(required(options, "pull-request"), "--pull-request"),
    sourceClaimId: required(options, "source-claim-id"),
    waiterClaimId: required(options, "waiter-claim-id"),
    ledgerRepository: options.get("ledger-repository") || "huijoohwee/agentic-canvas-os",
    statePath: options.get("state-path") || null,
    ttlSeconds: options.has("ttl-seconds")
      ? boundedTtl(options.get("ttl-seconds")) : 1_800,
  });
  if (typeof createController !== "function") throw new Error("Provider-only controller is unavailable.");
  const controller = createController({ adapter });
  if (!controller || typeof controller.plan !== "function"
    || (command === "run" && typeof controller.run !== "function")) {
    throw new Error("Provider-only controller surface is unavailable.");
  }
  const planDigest = options.get("plan-digest") || null;
  if (command === "plan") {
    if (options.has("authorize")) throw new Error("plan does not accept --authorize.");
    return controller.plan({ planDigest });
  }
  if (!planDigest) throw new Error("run requires --plan-digest=<exact digest>.");
  return controller.run({ planDigest, authorization: required(options, "authorize") });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const result = await main(argumentsList);
    process.stdout.write(`${JSON.stringify(result, null, argumentsList.includes("--json") ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status: "blocked",
      error: String(error?.message || error) })}\n`);
    return 1;
  }
}

function parseArguments(argumentsList) {
  const [command = "plan", ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = new Map();
  for (const token of tokens) {
    if (token === "--json") {
      if (options.has("json")) throw new Error("--json must be provided once.");
      options.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(token);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${token}`);
    if (options.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    options.set(match[1], match[2]);
  }
  return { command, options };
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`--${name}=... is required.`);
  }
  return value;
}
function positive(value, label) { const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be positive.`);
  return result; }
function boundedTtl(value) { const result = positive(value, "--ttl-seconds");
  if (result < 60 || result > 86_400) throw new Error("--ttl-seconds must be between 60 and 86400.");
  return result; }
function usage() {
  return "Usage: provider-only-merged-claim-pair-reconciliation.mjs plan|run "
    + "--source-repository=<clean-main> --target-repository=<owner/name> --pull-request=<number> "
    + "--source-claim-id=<digest> --waiter-claim-id=<digest> [--ledger-repository=<owner/name>] "
    + "[--state-path=<private-path>] [--ttl-seconds=1800] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
