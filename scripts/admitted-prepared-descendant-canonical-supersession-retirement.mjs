#!/usr/bin/env node
// Responsibility: Expose planning and file-transported exact supersession retirement authorization.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createController } from "./admitted-prepared-descendant-canonical-supersession-retirement-controller.mjs";
import { createRepositoryAdapter } from "./admitted-prepared-descendant-canonical-supersession-retirement-repository-adapter.mjs";

const OPTIONS = new Set([
  "auth-file", "claim-id", "controller-root", "ledger-repository", "plan-digest",
  "pull-request", "repository", "source-task-authority", "state-path", "subject-worktree",
  "successor-manifest", "successor-task-authority", "successor-write-scope-manifest",
  "target-repository", "json",
]);
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [action = "plan", ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(action)) throw new Error(usage());
  const options = parse(tail);
  const repository = path.resolve(required(options, "repository"));
  const controllerRoot = path.resolve(options.get("controller-root") || CONTROLLER_ROOT);
  const createAdapter = dependencies.createAdapter || createRepositoryAdapter;
  const createRuntime = dependencies.createController || createController;
  const adapter = createAdapter({
    repository,
    subjectWorktree: required(options, "subject-worktree"),
    targetRepository: required(options, "target-repository"),
    controllerRoot,
    ledgerRepository: options.get("ledger-repository"),
    pullRequestNumber: integer(required(options, "pull-request"), "pull request"),
    claimId: exactDigest(required(options, "claim-id"), "claim ID"),
    statePath: required(options, "state-path"),
    sourceTaskAuthorityFile: required(options, "source-task-authority"),
    successorTaskAuthorityFile: required(options, "successor-task-authority"),
    successorWriteScopeManifestFile: required(options, "successor-write-scope-manifest"),
    successorManifestFile: required(options, "successor-manifest"),
  });
  const controller = createRuntime({ adapter });
  if (action === "plan") {
    if (options.has("auth-file") || options.has("plan-digest")) {
      throw new Error("plan forbids run authorization options.");
    }
    return controller.plan();
  }
  return controller.run({
    planDigest: exactDigest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(externalPrivatePath(required(options, "auth-file"), {
      repository, controllerRoot, label: "authorization path",
    })),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    process.stdout.write(`${JSON.stringify({
      schema: "agentic-admitted-prepared-descendant-canonical-supersession-retirement-result/v1",
      status: "complete", result: await main(argumentsList),
    })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: "agentic-admitted-prepared-descendant-canonical-supersession-retirement-result/v1",
      status: "blocked", error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function readAuthorization(file) {
  const stat = lstatSync(file);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.uid !== currentUid) {
    throw new Error("Authorization file must be owner-held, regular, non-symlinked, and exact mode 0600.");
  }
  const value = readFileSync(file, "utf8");
  if (value.endsWith("\n") && !value.slice(0, -1).includes("\n")) return value.slice(0, -1);
  if (!value.includes("\n")) return value;
  throw new Error("Authorization file must contain exactly one line.");
}
function externalPrivatePath(value, { repository, controllerRoot, label }) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be an absolute path.`);
  const requested = path.resolve(value);
  if (existsSync(requested) && lstatSync(requested).isSymbolicLink()) {
    throw new Error(`${label} cannot be a symbolic link.`);
  }
  const resolved = physicalPath(requested);
  for (const candidate of [repository, controllerRoot]) {
    const relative = path.relative(physicalPath(candidate), resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error(`${label} must be outside repository and controller worktrees.`);
    }
  }
  return resolved;
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
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}
function parse(args) {
  const result = new Map();
  for (const argument of args) {
    if (argument === "--json") {
      if (result.has("json")) throw new Error("--json must be provided once.");
      result.set("json", "true"); continue;
    }
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1]) || !match[2]) throw new Error(`Unsupported option: ${argument}`);
    if (result.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    result.set(match[1], match[2]);
  }
  return result;
}
function required(options, name) { const value = options.get(name); if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
function integer(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
function exactDigest(value, label) { if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid.`); return value; }
function usage() { return "Usage: admitted-prepared-descendant-canonical-supersession-retirement.mjs plan|run --repository=<canonical> --subject-worktree=<path> --target-repository=<owner/name> --pull-request=<number> --claim-id=<digest> --state-path=<private-json> --source-task-authority=<private-capability> --successor-task-authority=<private-capability> --successor-write-scope-manifest=<private-json> --successor-manifest=<private-json> [--controller-root=<protected-main>] [--ledger-repository=<owner/name>] [--plan-digest=<digest> --auth-file=<private-text>] [--json]"; }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli();
}
