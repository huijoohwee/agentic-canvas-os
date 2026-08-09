#!/usr/bin/env node
// Responsibility: Expose exact read-only planning and receipt-bound disposition execution.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRetiredHandoffSuccessorDispositionController,
} from "./retired-handoff-successor-disposition-controller.mjs";
import {
  createRepositoryRetiredHandoffSuccessorDispositionAdapter,
} from "./retired-handoff-successor-disposition-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-retired-handoff-successor-disposition-result/v1";
const OPTIONS = new Set([
  "authorize", "controller-root", "ledger-repository", "plan-digest",
  "port-decision", "repository", "source-claim-id", "source-pr",
  "successor-pr", "target-repository",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter,
  createController = createRetiredHandoffSuccessorDispositionController,
} = {}) {
  const [command = "plan", ...argumentsTail] = argumentsList;
  if (!new Set(["observe", "plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(argumentsTail);
  const portDecisionPath = options.get("port-decision");
  const request = Object.freeze({
    repository: path.resolve(required(options, "repository")),
    controllerRoot: path.resolve(options.get("controller-root")
      || fileURLToPath(new URL("..", import.meta.url))),
    targetRepository: repositoryIdentity(required(options, "target-repository")),
    ledgerRepository: repositoryIdentity(required(options, "ledger-repository")),
    sourcePr: positiveInteger(required(options, "source-pr"), "--source-pr"),
    sourceClaimId: digest(required(options, "source-claim-id"), "--source-claim-id"),
    successorPr: positiveInteger(required(options, "successor-pr"), "--successor-pr"),
    portDecision: portDecisionPath
      ? readJson(path.resolve(portDecisionPath), "port decision") : null,
  });
  const adapter = createAdapter(request);
  const controller = createController({ adapter });
  const planDigest = options.get("plan-digest") || null;
  if (command !== "run") {
    if (options.has("authorize")) {
      throw new Error(`${command} does not accept --authorize.`);
    }
    return controller[command]({ ...request, planDigest });
  }
  if (!planDigest) throw new Error("run requires --plan-digest=<exact digest>.");
  return controller.run({
    ...request,
    planDigest: digest(planDigest, "--plan-digest"),
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

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object.`);
  }
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
  return "Usage: retired-handoff-successor-disposition.mjs observe|plan|run "
    + "--repository=<path> --target-repository=<owner/name> "
    + "--ledger-repository=<owner/name> --source-pr=<number> "
    + "--source-claim-id=<digest> --successor-pr=<number> "
    + "[--controller-root=<protected-main>] [--port-decision=<json>] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
