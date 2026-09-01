#!/usr/bin/env node
// Responsibility: Transport one private sealed plan into exact-authorized current-base reanchoring.
import { execFileSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeReanchorPlan }
  from "./active-owned-dirt-current-base-reanchor-contract.mjs";
import { createActiveOwnedDirtCurrentBaseReanchorController }
  from "./active-owned-dirt-current-base-reanchor-controller.mjs";
import { createActiveOwnedDirtCurrentBaseReanchorRepositoryAdapter }
  from "./active-owned-dirt-current-base-reanchor-repository-adapter.mjs";
import { createGitHubConditionalPullBodyPort }
  from "./github-conditional-pull-body.mjs";

const OPERATION = "active-owned-dirt-current-base-reanchor";
const COMMAND_SCHEMA = `agentic-${OPERATION}-command/v1`;
const COMMON_OPTIONS = new Set([
  "journal",
  "json",
  "repository",
  "session",
  "task-authority",
]);

export async function runActiveOwnedDirtCurrentBaseReanchorCli(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  const [command, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parse(tokens);
  assertAllowedOptions(options, command);

  const repository = canonicalDirectory(
    required(options, "repository"),
    "repository",
  );
  const excludedRoots = repositoryOwnedRoots(repository);
  const sessionId = required(options, "session");
  const taskAuthorityFile = externalPrivateInput(
    required(options, "task-authority"),
    excludedRoots,
    "task authority capability",
  );
  const journalFile = absolute(required(options, "journal"), "journal");
  const createAdapter = dependencies.createAdapter
    || createActiveOwnedDirtCurrentBaseReanchorRepositoryAdapter;
  const adapterDependencies = composeReanchorAdapterDependencies({
    repository,
    adapterDependencies: dependencies.adapterDependencies,
    createPort: dependencies.createConditionalPullBodyPort,
  });
  const adapter = createAdapter({
    repository,
    sessionId,
    taskAuthorityFile,
    journalFile,
  }, adapterDependencies);
  const createController = dependencies.createController
    || createActiveOwnedDirtCurrentBaseReanchorController;
  const controller = createController(adapter);

  if (command === "plan") {
    const output = externalPrivateOutput(
      required(options, "output"),
      excludedRoots,
    );
    const plan = normalizeReanchorPlan(await controller.plan({
      ttlSeconds: parseTtl(options.get("ttl-seconds") || "1800"),
    }));
    writeExclusiveJson(output, plan);
    return Object.freeze({
      schema: COMMAND_SCHEMA,
      ok: true,
      action: "plan",
      status: "planned",
      planDigest: plan.planDigest,
      exactAuthorization: `authorize ${OPERATION} ${plan.planDigest}`,
      planOutput: output,
      sourceMutation: false,
      providerMutation: false,
      cloudMutation: false,
    });
  }

  const planFile = externalPrivateInput(
    required(options, "plan"),
    excludedRoots,
    "reanchor plan",
  );
  const plan = normalizeReanchorPlan(readJson(planFile, "reanchor plan"));
  const receipt = await controller.run({
    plan,
    authorization: required(options, "authorization"),
  });
  return Object.freeze({
    schema: COMMAND_SCHEMA,
    ok: true,
    action: "run",
    status: receipt.status,
    planDigest: plan.planDigest,
    receipt,
    authoringAuthorityReanchored:
      receipt.status === "authoring-authority-reanchored",
    authoredCommitCreated: false,
    reviewed: false,
    merged: false,
    deployed: false,
    cleaned: false,
  });
}

export function composeReanchorAdapterDependencies({
  repository,
  adapterDependencies = {},
  createPort = createGitHubConditionalPullBodyPort,
} = {}) {
  const result = { ...adapterDependencies };
  const hasRead = typeof result.readConditionalPull === "function";
  const hasPatch = typeof result.patchConditionalPull === "function";
  if (hasRead !== hasPatch) {
    throw new Error("Conditional pull-request dependency pair must be complete.");
  }
  if (!hasRead) {
    const port = createPort({ repository });
    if (typeof port?.readConditionalPull !== "function"
      || typeof port?.patchConditionalPull !== "function") {
      throw new Error("Conditional pull-request provider port is incomplete.");
    }
    result.readConditionalPull = port.readConditionalPull;
    result.patchConditionalPull = port.patchConditionalPull;
  }
  return Object.freeze(result);
}

function parse(tokens) {
  const options = new Map();
  for (const token of tokens) {
    if (token === "--json") {
      if (options.has("json")) throw new Error("Duplicate option: --json");
      options.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(token);
    if (!match || options.has(match[1])) {
      throw new Error(`Unsupported or duplicate option: ${token}`);
    }
    options.set(match[1], match[2]);
  }
  return options;
}

function assertAllowedOptions(options, command) {
  const allowed = new Set([
    ...COMMON_OPTIONS,
    ...(command === "plan"
      ? ["output", "ttl-seconds"]
      : ["authorization", "plan"]),
  ]);
  for (const name of options.keys()) {
    if (!allowed.has(name)) throw new Error(`--${name} is not valid for ${command}.`);
  }
}

function canonicalDirectory(value, label) {
  const target = realpathSync(absolute(value, label));
  const metadata = lstatSync(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return target;
}

function externalPrivateInput(value, excludedRoots, label) {
  const target = absolute(value, label);
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`${label} must be one owner-only regular non-symlink file.`);
  }
  const canonical = realpathSync(target);
  requireExternal(canonical, excludedRoots, label);
  return canonical;
}

function externalPrivateOutput(value, excludedRoots) {
  const target = absolute(value, "plan output");
  const parent = canonicalDirectory(path.dirname(target), "plan output parent");
  const metadata = lstatSync(parent);
  if ((metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("Plan output parent must be owner-only.");
  }
  const canonical = path.join(parent, path.basename(target));
  requireExternal(canonical, excludedRoots, "plan output");
  return canonical;
}

function writeExclusiveJson(file, value) {
  const descriptor = openSync(file, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directory = openSync(path.dirname(file), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function requireExternal(target, excludedRoots, label) {
  for (const root of excludedRoots) {
    const relative = path.relative(root, target);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
      throw new Error(
        `${label} must remain outside every repository worktree and Git directory.`,
      );
    }
  }
}

function repositoryOwnedRoots(repository) {
  const git = argumentsList => String(execFileSync("git", argumentsList, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
  const common = realpathSync(path.resolve(
    repository,
    git(["rev-parse", "--git-common-dir"]),
  ));
  const worktrees = git(["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter(token => token.startsWith("worktree "))
    .map(token => realpathSync(token.slice("worktree ".length)));
  return [...new Set([repository, common, ...worktrees])];
}

function readJson(file, label) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected one object");
    }
    return value;
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function parseTtl(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 60 || result > 86_400) {
    throw new Error("--ttl-seconds must be an integer from 60 through 86400.");
  }
  return result;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(value);
}

function usage() {
  return "Usage: active-owned-dirt-current-base-reanchor.mjs plan|run "
    + "--repository=<absolute-dirty-worktree> --session=<session> "
    + "--task-authority=<absolute-external-capability> "
    + "--journal=<absolute-external-private-journal> "
    + "[--output=<absolute-external-plan> --ttl-seconds=1800] "
    + "[--plan=<absolute-external-plan> --authorization=<exact-text>] [--json]";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runActiveOwnedDirtCurrentBaseReanchorCli();
    process.stdout.write(`${JSON.stringify(
      result,
      null,
      process.argv.includes("--json") ? 2 : 0,
    )}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      ok: false,
      status: "blocked",
      error: String(error?.message || error).slice(0, 1_000),
    })}\n`);
    process.exitCode = 1;
  }
}
