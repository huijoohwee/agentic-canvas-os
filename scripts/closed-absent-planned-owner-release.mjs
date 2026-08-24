#!/usr/bin/env node
// Responsibility: Expose read-only planning and private-file exact authorization transport.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createController } from "./closed-absent-planned-owner-release-controller.mjs";
import { createRepositoryAdapter } from "./closed-absent-planned-owner-release-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-closed-absent-planned-owner-release-command/v1";
const INSTALLED_CONTROLLER_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMMON = new Set([
  "repository", "target-repository", "ledger-repository", "branch",
  "pull-request", "claim-id", "controller-root", "json",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const input = parseArguments(argumentsList);
  const createAdapter = dependencies.createAdapter || createRepositoryAdapter;
  const createRuntime = dependencies.createController || createController;
  const adapter = createAdapter({
    repository: input.repository,
    targetRepository: input.targetRepository,
    ledgerRepository: input.ledgerRepository,
    branch: input.branch,
    pullRequestNumber: input.pullRequestNumber,
    claimId: input.claimId,
    controllerRoot: input.controllerRoot,
  }, dependencies.adapterDependencies || {});
  const controller = createRuntime({ adapter });
  return input.action === "plan"
    ? await controller.plan()
    : await controller.run({ plan: input.plan, authorization: input.authorization });
}

export function parseArguments(argumentsList) {
  const [action, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(action)) throw new Error(usage());
  const options = parseOptions(tokens);
  const allowed = new Set([...COMMON, ...(action === "run" ? ["plan-file", "auth-file"] : [])]);
  for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`Unsupported option: --${key}`);
  const repository = path.resolve(required(options, "repository"));
  const controllerRoot = options.has("controller-root")
    ? path.resolve(required(options, "controller-root")) : undefined;
  const common = {
    action,
    repository,
    targetRepository: repositoryName(required(options, "target-repository")),
    ledgerRepository: options.get("ledger-repository")
      ? repositoryName(options.get("ledger-repository")) : undefined,
    branch: required(options, "branch"),
    pullRequestNumber: positive(required(options, "pull-request"), "pull-request"),
    claimId: exactDigest(required(options, "claim-id"), "claim-id"),
    controllerRoot,
    json: options.has("json"),
  };
  if (action === "plan") {
    if (options.has("plan-file") || options.has("auth-file")) {
      throw new Error("Planning forbids run authorization files.");
    }
    return Object.freeze(common);
  }
  const excludedRoots = [repository, controllerRoot || INSTALLED_CONTROLLER_ROOT];
  const planFile = externalPrivateFile(required(options, "plan-file"), "plan-file", excludedRoots);
  const authFile = externalPrivateFile(required(options, "auth-file"), "auth-file", excludedRoots);
  return Object.freeze({ ...common, planFile, authFile,
    plan: JSON.parse(readFileSync(planFile, "utf8")),
    authorization: readAuthorization(authFile) });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const input = parseArguments(argumentsList);
    const result = await main(argumentsList);
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schema: RESULT_SCHEMA, ok: false, status: "blocked",
      error: String(error?.message || error).slice(0, 1_000) })}\n`);
    return 1;
  }
}

function parseOptions(tokens) {
  const result = new Map();
  for (const token of tokens) {
    if (token === "--json") {
      if (result.has("json")) throw new Error("--json must be provided once.");
      result.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(token);
    if (!match) throw new Error(`Unsupported option: ${token}`);
    if (result.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    result.set(match[1], match[2]);
  }
  return result;
}

function externalPrivateFile(value, label, excludedRoots) {
  if (!path.isAbsolute(value)) throw new Error(`--${label} must be absolute.`);
  const candidate = path.resolve(value);
  if (excludedRoots.some(root => candidate === path.resolve(root)
    || candidate.startsWith(`${path.resolve(root)}${path.sep}`))) {
    throw new Error(`--${label} must remain outside repository worktrees.`);
  }
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`--${label} must be an owner-only regular file.`);
  }
  return candidate;
}

function readAuthorization(file) {
  const value = readFileSync(file, "utf8");
  if (!value.includes("\n")) return value;
  if (value.endsWith("\n") && !value.slice(0, -1).includes("\n")) return value.slice(0, -1);
  throw new Error("Authorization file must contain exactly one line.");
}
function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`--${name}=<value> is required.`);
  }
  return value;
}
function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) throw new Error("Repository identity is invalid.");
  return value;
}
function positive(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`--${label} is invalid.`);
  return result;
}
function exactDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`--${label} is invalid.`);
  return value;
}
function usage() {
  return "Usage: closed-absent-planned-owner-release.mjs plan|run --repository=<canonical-repository> --target-repository=<owner/name> --branch=<agent-branch> --pull-request=<number> --claim-id=<digest> [--ledger-repository=<owner/name>] [--controller-root=<protected-main>] [--plan-file=<private-json> --auth-file=<private-text>] [--json]";
}
function isMain() { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
if (isMain()) process.exitCode = await runCli();
