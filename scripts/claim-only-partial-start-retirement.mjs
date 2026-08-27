#!/usr/bin/env node
// Responsibility: Expose private planning and exact authorization for two claim-only operations.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createClaimOnlyPartialStartRetirementController }
  from "./claim-only-partial-start-retirement-controller.mjs";
import { createRepositoryClaimOnlyPartialStartRetirementAdapter }
  from "./claim-only-partial-start-retirement-repository-adapter.mjs";

const COMMANDS = new Set([
  "plan-retirement", "run-retirement", "plan-rollover", "run-rollover",
]);
const OPTIONS = new Set([
  "auth-file", "claim-output", "controller-root", "ledger-repository", "plan-digest",
  "repository", "retirement-state-path", "source-claim-id", "state-path",
  "successor-claim-id", "target-repository", "ttl-seconds", "json",
]);
const RESULT_SCHEMA = "agentic-claim-only-partial-start-retirement-result/v1";
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command = "plan-retirement", ...tail] = argumentsList;
  if (!COMMANDS.has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const rollover = command.endsWith("rollover");
  const running = command.startsWith("run-");
  rejectIrrelevantOptions(options, { rollover, running });
  const createAdapter = dependencies.createAdapter
    || createRepositoryClaimOnlyPartialStartRetirementAdapter;
  const createController = dependencies.createController
    || createClaimOnlyPartialStartRetirementController;
  const repository = path.resolve(required(options, "repository"));
  const controllerRoot = path.resolve(options.get("controller-root") || CONTROLLER_ROOT);
  const statePath = externalPrivatePath(required(options, "state-path"), {
    repository, controllerRoot, label: "state path",
  });
  const retirementStatePath = rollover
    ? externalPrivatePath(required(options, "retirement-state-path"), {
      repository, controllerRoot, label: "retirement state path",
    }) : null;
  const claimOutputPath = rollover
    ? externalPrivatePath(required(options, "claim-output"), {
      repository, controllerRoot, label: "claim output path",
    }) : null;
  const authorizationPath = running
    ? externalPrivatePath(required(options, "auth-file"), {
      repository, controllerRoot, label: "authorization path",
    }) : null;
  const privatePaths = [statePath, retirementStatePath, claimOutputPath, authorizationPath]
    .filter(Boolean);
  if (new Set(privatePaths).size !== privatePaths.length) {
    throw new Error("Journal, authorization, retirement-state, and claim-output paths must be distinct.");
  }
  const adapter = createAdapter({
    repository,
    targetRepository: required(options, "target-repository"),
    ledgerRepository: options.get("ledger-repository"),
    controllerRoot,
    sourceClaimId: exactDigest(required(options, "source-claim-id"), "source claim ID"),
    successorClaimId: exactDigest(required(options, "successor-claim-id"),
      "successor claim ID"),
    statePath,
    ...(rollover ? {
      retirementStatePath,
      claimOutputPath,
    } : {}),
    ...(options.has("ttl-seconds")
      ? { ttlSeconds: positiveInteger(options.get("ttl-seconds"), "replacement TTL") } : {}),
  });
  const controller = createController({ adapter });
  if (!running) {
    if (options.has("auth-file") || options.has("plan-digest")) {
      throw new Error("Planning forbids run authorization options.");
    }
    return rollover ? controller.planRollover() : controller.planRetirement();
  }
  const input = {
    planDigest: exactDigest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(authorizationPath),
  };
  return rollover ? controller.runRollover(input) : controller.runRetirement(input);
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status: "complete",
      result: await main(argumentsList) })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status: "blocked",
      error: publicMessage(error) })}\n`);
    return 1;
  }
}

function readAuthorization(value) {
  const file = path.resolve(value);
  const stat = lstatSync(file);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.uid !== currentUid) {
    throw new Error("Authorization file must be owner-held, regular, non-symlinked, and exact mode 0600.");
  }
  const content = readFileSync(file, "utf8");
  if (!content.includes("\n")) return content;
  if (content.endsWith("\n") && !content.slice(0, -1).includes("\n")) {
    return content.slice(0, -1);
  }
  throw new Error("Authorization file must contain exactly one line.");
}

function rejectIrrelevantOptions(options, { rollover, running }) {
  const forbidden = [];
  if (!rollover) forbidden.push("retirement-state-path", "claim-output", "ttl-seconds");
  if (!running) forbidden.push("auth-file", "plan-digest");
  for (const name of forbidden) {
    if (options.has(name)) throw new Error(`--${name} is not accepted by this command.`);
  }
}

function externalPrivatePath(value, { repository, controllerRoot, label }) {
  if (!path.isAbsolute(String(value || ""))) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const requested = path.resolve(value);
  rejectSymlinkTraversal(requested, label);
  const resolved = physicalPath(requested);
  for (const candidate of [repository, controllerRoot]) {
    const root = physicalPath(path.resolve(candidate));
    const relative = path.relative(root, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error(`${label} must be outside repository and controller worktrees.`);
    }
  }
  return resolved;
}

function rejectSymlinkTraversal(value, label) {
  const parsed = path.parse(value);
  let current = parsed.root;
  for (const segment of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} cannot traverse a symbolic link.`);
    }
  }
}

function physicalPath(value) {
  let ancestor = value;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return value;
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), path.relative(ancestor, value));
}

function parseOptions(argumentsList) {
  const result = new Map();
  for (const argument of argumentsList) {
    if (argument === "--json") {
      if (result.has("json")) throw new Error("--json must be provided once.");
      result.set("json", "true");
      continue;
    }
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1]) || !match[2]) {
      throw new Error(`Unsupported option: ${argument}`);
    }
    if (result.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    result.set(match[1], match[2]);
  }
  return result;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function exactDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 60 || result > 86_400) {
    throw new Error(`${label} must be an integer from 60 through 86400.`);
  }
  return result;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}

function usage() {
  return "Usage: claim-only-partial-start-retirement.mjs "
    + "<plan-retirement|run-retirement|plan-rollover|run-rollover> "
    + "--repository=<path> --target-repository=<owner/name> "
    + "--source-claim-id=<digest> --successor-claim-id=<digest> --state-path=<private-json> "
    + "[--retirement-state-path=<private-json> --claim-output=<private-json>] "
    + "[--ledger-repository=<owner/name>] [--controller-root=<protected-main>] "
    + "[--ttl-seconds=<60..86400>] [--plan-digest=<digest> --auth-file=<private-text>] [--json]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
