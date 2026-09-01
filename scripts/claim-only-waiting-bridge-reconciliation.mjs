#!/usr/bin/env node
// Responsibility: Expose private planning and exact authorization for both bridge phases.
import {
  closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createClaimOnlyWaitingBridgeReconciliationController }
  from "./claim-only-waiting-bridge-reconciliation-controller.mjs";
import { createRepositoryClaimOnlyWaitingBridgeReconciliationAdapter }
  from "./claim-only-waiting-bridge-reconciliation-repository-adapter.mjs";

const COMMANDS = new Set([
  "plan-retirement", "run-retirement", "plan-promotion", "run-promotion",
  "plan-protected-advance",
]);
const OPTIONS = new Set([
  "anchor-claim-id", "auth-file", "authority-output", "bridge-claim-id",
  "controller-root", "json", "ledger-repository", "plan-digest", "repository",
  "protected-advance-auth-file", "protected-advance-output", "protected-advance-plan",
  "retirement-state-path", "state-path", "successor-claim-id", "target-repository",
  "ttl-seconds",
]);
const RESULT_SCHEMA = "agentic-claim-only-waiting-bridge-reconciliation-cli-result/v1";
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command = "plan-retirement", ...tail] = argumentsList;
  if (!COMMANDS.has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const protectedAdvancePlanning = command === "plan-protected-advance";
  const promotion = command.endsWith("promotion");
  const running = command.startsWith("run-");
  rejectIrrelevantOptions(options, {
    command, promotion, protectedAdvancePlanning, running,
  });
  const repository = path.resolve(required(options, "repository"));
  const controllerRoot = path.resolve(options.get("controller-root") || CONTROLLER_ROOT);
  const statePath = externalPrivatePath(required(options, "state-path"), {
    repository, controllerRoot, label: "state path",
  });
  const retirementStatePath = promotion
    ? externalPrivatePath(required(options, "retirement-state-path"), {
      repository, controllerRoot, label: "retirement state path",
    }) : null;
  const authorityOutputPath = promotion
    ? externalPrivatePath(required(options, "authority-output"), {
      repository, controllerRoot, label: "authority output path",
    }) : null;
  const authorizationPath = running
    ? externalPrivatePath(required(options, "auth-file"), {
      repository, controllerRoot, label: "authorization path",
    }) : null;
  const protectedAdvanceOutputPath = protectedAdvancePlanning
    ? externalPrivatePath(required(options, "protected-advance-output"), {
      repository, controllerRoot, label: "protected-advance output path",
    }) : null;
  const protectedAdvancePlanPath = options.has("protected-advance-plan")
    ? externalPrivatePath(required(options, "protected-advance-plan"), {
      repository, controllerRoot, label: "protected-advance plan path",
    }) : null;
  const protectedAdvanceAuthorizationPath = options.has("protected-advance-auth-file")
    ? externalPrivatePath(required(options, "protected-advance-auth-file"), {
      repository, controllerRoot, label: "protected-advance authorization path",
    }) : null;
  const privatePaths = [
    statePath, retirementStatePath, authorityOutputPath, authorizationPath,
    protectedAdvanceOutputPath, protectedAdvancePlanPath,
    protectedAdvanceAuthorizationPath,
  ].filter(Boolean);
  if (new Set(privatePaths).size !== privatePaths.length) {
    throw new Error("Journal, retirement journal, authority output, and authorization paths must be distinct.");
  }
  const createAdapter = dependencies.createAdapter
    || createRepositoryClaimOnlyWaitingBridgeReconciliationAdapter;
  const createController = dependencies.createController
    || createClaimOnlyWaitingBridgeReconciliationController;
  const adapter = createAdapter({
    repository,
    controllerRoot,
    targetRepository: required(options, "target-repository"),
    ledgerRepository: options.get("ledger-repository"),
    anchorClaimId: exactDigest(required(options, "anchor-claim-id"), "anchor claim ID"),
    bridgeClaimId: exactDigest(required(options, "bridge-claim-id"), "bridge claim ID"),
    successorClaimId: exactDigest(required(options, "successor-claim-id"),
      "successor claim ID"),
    statePath,
    ...(promotion ? {
      retirementStatePath,
      authorityOutputPath,
      ttlSeconds: positiveInteger(required(options, "ttl-seconds"), "promotion TTL"),
    } : {}),
    ...(protectedAdvancePlanPath ? {
      protectedAdvancePlan: readPrivateJson(
        protectedAdvancePlanPath, "protected-advance plan",
      ),
      protectedAdvanceAuthorization: readAuthorization(
        protectedAdvanceAuthorizationPath,
      ),
    } : {}),
  });
  if (protectedAdvancePlanning) {
    const plan = await adapter.planProtectedAdvance();
    writePrivateJsonExclusive(protectedAdvanceOutputPath, plan);
    return Object.freeze({
      operation: plan.operation,
      planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization,
      outputPath: protectedAdvanceOutputPath,
    });
  }
  const controller = createController({ adapter });
  if (!running) {
    return promotion ? controller.planPromotion() : controller.planRetirement();
  }
  const input = {
    planDigest: exactDigest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(authorizationPath),
  };
  return promotion ? controller.runPromotion(input) : controller.runRetirement(input);
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const result = await main(argumentsList);
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA, status: "complete", result,
    })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA, status: "blocked", error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function rejectIrrelevantOptions(options, {
  command, promotion, protectedAdvancePlanning, running,
}) {
  const forbidden = [];
  if (!promotion) forbidden.push("retirement-state-path", "authority-output", "ttl-seconds");
  if (!running) forbidden.push("auth-file", "plan-digest");
  if (!protectedAdvancePlanning) forbidden.push("protected-advance-output");
  if (command !== "run-retirement") {
    forbidden.push("protected-advance-plan", "protected-advance-auth-file");
  } else if (options.has("protected-advance-plan")
    !== options.has("protected-advance-auth-file")) {
    throw new Error(
      "--protected-advance-plan and --protected-advance-auth-file must be paired.",
    );
  }
  for (const name of forbidden) {
    if (options.has(name)) throw new Error(`--${name} is not accepted by this command.`);
  }
}

function readPrivateJson(value, label) {
  const stat = lstatSync(value);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.uid !== currentUid) {
    throw new Error(`${label} must be owner-held, regular, non-symlinked, and mode 0600.`);
  }
  try { return JSON.parse(readFileSync(value, "utf8")); } catch {
    throw new Error(`${label} must contain one JSON object.`);
  }
}

function writePrivateJsonExclusive(value, payload) {
  let descriptor;
  try {
    descriptor = openSync(value, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(payload)}\n`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const stat = lstatSync(value);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.uid !== currentUid) {
    throw new Error("Protected-advance output must remain owner-held and mode 0600.");
  }
}

function readAuthorization(value) {
  const file = path.resolve(value);
  const stat = lstatSync(file);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.uid !== currentUid) {
    throw new Error("Authorization file must be owner-held, regular, non-symlinked, and mode 0600.");
  }
  const content = readFileSync(file, "utf8");
  if (!content.includes("\n")) return content;
  if (content.endsWith("\n") && !content.slice(0, -1).includes("\n")) {
    return content.slice(0, -1);
  }
  throw new Error("Authorization file must contain exactly one line.");
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
    const match = /^--([a-z0-9-]+)=(.*)$/u.exec(argument);
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
  return "Usage: claim-only-waiting-bridge-reconciliation.mjs "
    + "<plan-retirement|run-retirement|plan-promotion|run-promotion"
    + "|plan-protected-advance> "
    + "--repository=<path> --target-repository=<owner/name> "
    + "--anchor-claim-id=<digest> --bridge-claim-id=<digest> "
    + "--successor-claim-id=<digest> --state-path=<private-json> "
    + "[--retirement-state-path=<private-json> --ttl-seconds=<60..86400> "
    + "--authority-output=<private-json>] [--ledger-repository=<owner/name>] "
    + "[--plan-digest=<digest> --auth-file=<private-text>] [--json]"
    + " [--protected-advance-output=<private-json>] "
    + "[--protected-advance-plan=<private-json> "
    + "--protected-advance-auth-file=<private-text>]";
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
