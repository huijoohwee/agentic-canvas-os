#!/usr/bin/env node
// Responsibility: Expose read-only dormant-preservation planning and exact-authority execution.
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createDormantPreservationAdmissionController,
} from "./dormant-preservation-decision-controller.mjs";
import {
  createRepositoryDormantPreservationAdmissionAdapter,
} from "./dormant-preservation-decision-repository-adapter.mjs";

const OPTIONS = new Set([
  "authorize", "cloud-authority", "controller-root", "ledger-repository", "manifest",
  "plan-digest", "repository", "scope", "selection",
  "session", "state-path", "target-repository", "ttl-seconds", "worktree",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryDormantPreservationAdmissionAdapter,
  createController = createDormantPreservationAdmissionController,
} = {}) {
  const [command = "plan", ...argumentsTail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(argumentsTail);
  const adapter = createAdapter({
    repository: required(options, "repository"),
    targetRepository: required(options, "target-repository"),
    targetPath: required(options, "worktree"),
    scope: required(options, "scope"),
    sessionId: required(options, "session"),
    manifestPath: required(options, "manifest"),
    cloudAuthorityPath: required(options, "cloud-authority"),
    selectionPath: required(options, "selection"),
    ledgerRepository: options.get("ledger-repository") || "huijoohwee/agentic-canvas-os",
    controllerRoot: options.get("controller-root")
      || fileURLToPath(new URL("..", import.meta.url)),
    statePath: options.get("state-path") || null,
    ttlSeconds: options.has("ttl-seconds")
      ? positiveInteger(options.get("ttl-seconds"), "--ttl-seconds") : 1_800,
  });
  const controller = createController({ adapter });
  const planDigest = options.get("plan-digest") || null;
  if (command === "plan") {
    if (options.has("authorize")) throw new Error("plan does not accept --authorize.");
    return controller.plan({ planDigest });
  }
  if (!planDigest) throw new Error("run requires --plan-digest=<exact digest>.");
  return controller.run({
    planDigest, authorization: required(options, "authorize"),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-dormant-preservation-admission-result/v1",
      status: "blocked", error: publicMessage(error),
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

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 1_000);
}

function usage() {
  return "Usage: dormant-preservation-decision.mjs plan|run "
    + "--repository=<canonical> --target-repository=<owner/name> --worktree=<new-path> "
    + "--scope=<semantic-scope> --session=<id> --manifest=<json> "
    + "--cloud-authority=<json> --selection=<json> [--controller-root=<protected-main>] "
    + "[--ledger-repository=<owner/name>] "
    + "[--state-path=<journal>] [--ttl-seconds=1800] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
