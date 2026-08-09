#!/usr/bin/env node
// Responsibility: expose read-only planning and exact-authorization execution for merged dormant claim reconciliation.

import { pathToFileURL } from "node:url";

import * as Controller from "./merged-dormant-claim-reconciliation-controller.mjs";
import {
  createRepositoryMergedDormantClaimReconciliationAdapter,
} from "./merged-dormant-claim-reconciliation-repository-adapter.mjs";

export async function main(
  argumentsList = process.argv.slice(2),
  {
    createAdapter = createRepositoryMergedDormantClaimReconciliationAdapter,
    createController = Controller.createMergedDormantClaimReconciliationController,
  } = {},
) {
  const [command = "plan", ...options] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const adapter = createAdapter({
    sourceRepository: requiredOption(options, "source-repository"),
    targetRepository: requiredOption(options, "target-repository"),
    pullRequestNumber: positiveInteger(
      requiredOption(options, "pull-request"),
      "--pull-request",
    ),
    claimId: requiredOption(options, "claim-id"),
    ledgerRepository: option(options, "ledger-repository") || "huijoohwee/agentic-canvas-os",
    statePath: option(options, "state-path") || null,
    ttlSeconds: option(options, "ttl-seconds")
      ? positiveInteger(option(options, "ttl-seconds"), "--ttl-seconds")
      : 1_800,
  });
  if (typeof createController !== "function") {
    throw new Error("Merged dormant claim reconciliation controller factory is unavailable.");
  }
  const controller = createController({ adapter });
  const planDigest = option(options, "plan-digest") || null;
  if (command === "plan") {
    if (option(options, "authorize")) throw new Error("plan does not accept --authorize.");
    return controller.plan({ planDigest });
  }
  const authorization = requiredOption(options, "authorize");
  if (!planDigest) throw new Error("run requires --plan-digest=<exact digest>.");
  return controller.run({ authorization, planDigest });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const result = await main(argumentsList);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-merged-dormant-claim-reconciliation-result/v1",
      status: "blocked",
      error: String(error?.message || error),
    }));
    return 1;
  }
}

function option(argumentsList, name) {
  const prefix = `--${name}=`;
  const value = argumentsList.find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function requiredOption(argumentsList, name) {
  const value = option(argumentsList, name);
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function usage() {
  return "Usage: merged-dormant-claim-reconciliation.mjs plan|run "
    + "--source-repository=<preserved-worktree> --target-repository=<owner/name> "
    + "--pull-request=<number> --claim-id=<digest> [--ledger-repository=<owner/name>] "
    + "[--state-path=<path>] [--ttl-seconds=1800] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
