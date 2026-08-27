#!/usr/bin/env node
// Responsibility: expose read-only planning and exact-authorized duplicate-PR reconciliation.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createIntegratedSourceDuplicatePrReconciliationController,
} from "./integrated-source-duplicate-pr-reconciliation-controller.mjs";
import {
  createIntegratedSourceDuplicatePrReconciliationRepositoryAdapter,
} from "./integrated-source-duplicate-pr-reconciliation-repository-adapter.mjs";

const RESULT_SCHEMA =
  "agentic-integrated-source-duplicate-pr-reconciliation-command/v1";
const SOURCE_PULL_REQUEST = 736;
const INTEGRATED_PULL_REQUEST = 735;
const AUTHORIZATION_PREFIX =
  "authorize integrated-source-duplicate-pr-reconciliation";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const COMMON_OPTIONS = new Set([
  "repository",
  "source-worktree",
  "source-pr",
  "integrated-pr",
  "claim-id",
  "checkpoint",
  "task-authority",
  "plan-digest",
  "json",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const input = parseArguments(argumentsList);
  const createAdapter = dependencies.createAdapter
    || createIntegratedSourceDuplicatePrReconciliationRepositoryAdapter;
  const createController = dependencies.createController
    || createIntegratedSourceDuplicatePrReconciliationController;
  const adapter = createAdapter({
    repository: input.repository,
    sourceWorktree: input.sourceWorktree,
    sourcePullRequestNumber: input.sourcePullRequestNumber,
    integratedPullRequestNumber: input.integratedPullRequestNumber,
    claimId: input.claimId,
    checkpointPath: input.checkpointPath,
    taskAuthorityFile: input.taskAuthorityFile,
  }, dependencies.adapterDependencies || {});
  const controller = createController({ adapter });
  if (!controller || typeof controller.plan !== "function"
    || typeof controller.run !== "function") {
    throw new Error(
      "Integrated-source duplicate-PR reconciliation controller is unavailable.",
    );
  }

  if (input.action === "plan") {
    return verifyPlanDigest(await controller.plan(), input.planDigest);
  }
  const plan = verifyPlanDigest(input.plan, input.planDigest);
  const exactAuthorization = `${AUTHORIZATION_PREFIX} ${plan.planDigest}`;
  if (input.authorization !== exactAuthorization) {
    throw new Error(
      `Run requires the exact authorization: ${exactAuthorization}`,
    );
  }
  return controller.run({ plan, authorization: input.authorization });
}

export function parseArguments(argumentsList) {
  const [action, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(action)) throw new Error(usage());
  const options = parseOptions(tokens);
  const allowed = new Set([
    ...COMMON_OPTIONS,
    ...(action === "run" ? ["plan-file", "authorize"] : []),
  ]);
  for (const key of options.keys()) {
    if (!allowed.has(key)) throw new Error(`Unsupported option: --${key}`);
  }
  if (action === "plan" && (options.has("plan-file") || options.has("authorize"))) {
    throw new Error("Planning forbids run plan and authorization inputs.");
  }

  const repository = absolutePath(required(options, "repository"), "repository");
  const sourceWorktree = absolutePath(
    required(options, "source-worktree"),
    "source-worktree",
  );
  if (repository === sourceWorktree) {
    throw new Error("Controller repository and preserved source worktree must differ.");
  }
  const checkpointPath = privateExternalFile(
    required(options, "checkpoint"),
    "checkpoint",
    [repository, sourceWorktree],
  );
  const common = {
    action,
    repository,
    sourceWorktree,
    sourcePullRequestNumber: exactPullRequest(
      required(options, "source-pr"),
      SOURCE_PULL_REQUEST,
      "source-pr",
    ),
    integratedPullRequestNumber: exactPullRequest(
      required(options, "integrated-pr"),
      INTEGRATED_PULL_REQUEST,
      "integrated-pr",
    ),
    claimId: exactDigest(required(options, "claim-id"), "claim-id"),
    checkpointPath,
    planDigest: options.has("plan-digest")
      ? exactDigest(required(options, "plan-digest"), "plan-digest")
      : null,
    json: options.has("json"),
  };

  if (action === "plan") {
    // The optional locator is deliberately neither resolved nor opened while planning.
    return Object.freeze({ ...common, taskAuthorityFile: null });
  }

  const taskAuthorityFile = privateExternalFile(
    required(options, "task-authority"),
    "task-authority",
    [repository, sourceWorktree],
  );
  const planFile = privateExternalFile(
    required(options, "plan-file"),
    "plan-file",
    [repository, sourceWorktree],
  );
  if (new Set([checkpointPath, taskAuthorityFile, planFile]).size !== 3) {
    throw new Error("Checkpoint, task-authority, and plan files must be distinct.");
  }
  const authorization = required(options, "authorize");
  return Object.freeze({
    ...common,
    taskAuthorityFile,
    planFile,
    plan: readPlan(planFile),
    authorization,
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const result = await main(argumentsList);
    const pretty = argumentsList.includes("--json");
    process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: RESULT_SCHEMA,
      ok: false,
      status: "blocked",
      error: publicError(error),
    })}\n`);
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

function readPlan(planFile) {
  let value;
  try {
    value = JSON.parse(readFileSync(planFile, "utf8"));
  } catch {
    throw new Error("--plan-file must contain valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--plan-file must contain one plan object.");
  }
  exactDigest(value.planDigest, "stored plan digest");
  return value;
}

function verifyPlanDigest(plan, expectedDigest) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("Controller returned no reconciliation plan.");
  }
  const planDigest = exactDigest(plan.planDigest, "plan digest");
  if (expectedDigest && expectedDigest !== planDigest) {
    throw new Error("--plan-digest does not match the exact reconciliation plan.");
  }
  return plan;
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`--${name}=<value> is required.`);
  }
  return value;
}

function exactPullRequest(value, expected, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result !== expected) {
    throw new Error(`--${label} must equal ${expected}.`);
  }
  return result;
}

function exactDigest(value, label) {
  const normalized = String(value || "");
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function absolutePath(value, label) {
  if (!path.isAbsolute(value)) throw new Error(`--${label} must be absolute.`);
  return path.resolve(value);
}

function externalPath(value, label, excludedRoots) {
  const candidate = absolutePath(value, label);
  assertOutsideRoots(candidate, label, excludedRoots);
  if (existsSync(candidate)) requirePrivateRegularFile(candidate, label);
  return candidate;
}

function privateExternalFile(value, label, excludedRoots) {
  const candidate = externalPath(value, label, excludedRoots);
  if (!existsSync(candidate)) throw new Error(`--${label} must exist.`);
  requirePrivateRegularFile(candidate, label);
  return candidate;
}

function assertOutsideRoots(candidate, label, excludedRoots) {
  if (excludedRoots.some(root => candidate === root
    || candidate.startsWith(`${root}${path.sep}`))) {
    throw new Error(`--${label} must remain outside repository worktrees.`);
  }
}

function requirePrivateRegularFile(candidate, label) {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`--${label} must be an owner-only regular file.`);
  }
}

function publicError(error) {
  return String(error?.message || error)
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}

function usage() {
  return "Usage: integrated-source-duplicate-pr-reconciliation.mjs plan|run "
    + "--repository=<absolute-controller-worktree> "
    + "--source-worktree=<absolute-preserved-source-worktree> "
    + "--source-pr=736 --integrated-pr=735 --claim-id=<digest> "
    + "--checkpoint=<absolute-external-path> "
    + "[--task-authority=<absolute-private-file>] [--plan-digest=<digest>] "
    + "[--plan-file=<absolute-private-json> "
    + "--authorize='authorize integrated-source-duplicate-pr-reconciliation <planDigest>'] "
    + "[--json]";
}

function isMain() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
if (isMain()) process.exitCode = await runCli();
