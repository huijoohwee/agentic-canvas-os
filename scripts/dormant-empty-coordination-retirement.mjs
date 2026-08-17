#!/usr/bin/env node
// Responsibility: Expose exact read-only planning and authorized empty-coordination retirement.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createDormantEmptyCoordinationRetirementController,
} from "./dormant-empty-coordination-retirement-controller.mjs";
import {
  createRepositoryDormantEmptyCoordinationRetirementAdapter,
} from "./dormant-empty-coordination-retirement-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-dormant-empty-coordination-retirement-result/v1";
const OPTIONS = new Set([
  "authorize", "claim-id", "controller-root", "ledger-repository", "plan-digest",
  "pull-request", "repository", "state-path", "target-repository",
  "waiting-successor-claim-id", "json",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryDormantEmptyCoordinationRetirementAdapter,
  createController = createDormantEmptyCoordinationRetirementController,
} = {}) {
  const [command = "plan", ...argumentsTail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(argumentsTail);
  const request = Object.freeze({
    repository: path.resolve(required(options, "repository")),
    controllerRoot: path.resolve(options.get("controller-root")
      || fileURLToPath(new URL("..", import.meta.url))),
    targetRepository: repositoryIdentity(required(options, "target-repository")),
    ledgerRepository: repositoryIdentity(options.get("ledger-repository")
      || "huijoohwee/agentic-canvas-os"),
    pullRequestNumber: positiveInteger(required(options, "pull-request"), "--pull-request"),
    claimId: digest(required(options, "claim-id"), "--claim-id"),
    waitingSuccessorClaimId: digest(required(options, "waiting-successor-claim-id"),
      "--waiting-successor-claim-id"),
    ...(options.has("state-path")
      ? { statePath: path.resolve(options.get("state-path")) } : {}),
  });
  const controller = createController({ adapter: createAdapter(request) });
  if (command === "plan") {
    if (options.has("authorize") || options.has("plan-digest")) {
      throw new Error("plan does not accept --authorize or --plan-digest.");
    }
    return controller.plan();
  }
  return controller.run({
    planDigest: digest(required(options, "plan-digest"), "--plan-digest"),
    authorization: required(options, "authorize"),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ schema: RESULT_SCHEMA, status: "blocked",
      error: publicMessage(error) }));
    return 1;
  }
}

function parseOptions(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    if (argument === "--json") {
      if (values.has("json")) throw new Error("--json must be provided at most once.");
      values.set("json", "true");
      continue;
    }
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

function repositoryIdentity(value) {
  const repository = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("Repository identity must be owner/name.");
  }
  return repository;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function digest(value, label) {
  const normalized = String(value || "");
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 1_000);
}

function usage() {
  return "Usage: dormant-empty-coordination-retirement.mjs plan|run "
    + "--repository=<path> --target-repository=<owner/name> --pull-request=<number> "
    + "--claim-id=<digest> --waiting-successor-claim-id=<digest> "
    + "[--ledger-repository=<owner/name>] [--controller-root=<protected-main>] "
    + "[--state-path=<private-json>] [--plan-digest=<digest> --authorize=<exact text>] [--json]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
