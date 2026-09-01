#!/usr/bin/env node
// Responsibility: Transport private exact authorization to the canonical-squash recovery controller.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createCanonicalSquashAttributionRecoveryTerminalizationController,
} from "./canonical-squash-attribution-recovery-terminalization-controller.mjs";
import {
  createCanonicalSquashAttributionRecoveryTerminalizationRepositoryAdapter,
} from "./canonical-squash-attribution-recovery-terminalization-repository-adapter.mjs";

const COMMAND_SCHEMA =
  "agentic-canonical-squash-attribution-recovery-terminalization-command/v1";
const INSTALLED_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OPTIONS = new Set([
  "repository",
  "subject-worktree",
  "target-repository",
  "subject-pull-request",
  "recovery-pull-request",
  "recovery-evidence-path",
  "recovery-cleanup-receipt-digest",
  "controller-root",
  "ledger-repository",
  "state-path",
  "task-authority",
  "plan-digest",
  "auth-file",
  "json",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [action, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(action)) throw new Error(usage());
  const options = parse(tail);
  const repository = physicalDirectory(required(options, "repository"), "canonical repository");
  const subjectWorktree = physicalOrAbsentPath(
    required(options, "subject-worktree"),
    "subject worktree",
  );
  const controllerRoot = physicalDirectory(
    options.get("controller-root") || INSTALLED_ROOT,
    "controller root",
  );
  if (controllerRoot !== realpathSync(INSTALLED_ROOT)) {
    throw new Error("Controller root must be this installed protected controller checkout.");
  }
  const gitCommonDirectory = physicalDirectory(
    dependencies.resolveGitCommonDirectory
      ? dependencies.resolveGitCommonDirectory(repository)
      : String(execFileSync("git", [
        "-C", repository, "rev-parse", "--path-format=absolute", "--git-common-dir",
      ], { encoding: "utf8" })).trim(),
    "Git common directory",
  );
  const excludedRoots = [repository, subjectWorktree, controllerRoot, gitCommonDirectory];
  const statePath = privateDestination(
    required(options, "state-path"),
    "state path",
    excludedRoots,
  );
  const taskAuthorityFile = privateFile(
    required(options, "task-authority"),
    "task authority",
    excludedRoots,
  );
  const common = {
    repository,
    subjectWorktree,
    targetRepository: repositoryName(required(options, "target-repository")),
    subjectPullRequest: positive(
      required(options, "subject-pull-request"),
      "subject pull request",
    ),
    recoveryPullRequest: positive(
      required(options, "recovery-pull-request"),
      "recovery pull request",
    ),
    recoveryEvidencePath: repositoryPath(
      required(options, "recovery-evidence-path"),
      "recovery evidence path",
    ),
    recoveryCleanupReceiptDigest: digest(
      required(options, "recovery-cleanup-receipt-digest"),
      "recovery cleanup receipt digest",
    ),
    controllerRoot,
    ledgerRepository: options.has("ledger-repository")
      ? repositoryName(required(options, "ledger-repository"))
      : "huijoohwee/agentic-canvas-os",
    statePath,
    taskAuthorityFile,
  };
  const createAdapter = dependencies.createAdapter
    || createCanonicalSquashAttributionRecoveryTerminalizationRepositoryAdapter;
  const createController = dependencies.createController
    || createCanonicalSquashAttributionRecoveryTerminalizationController;
  const controller = createController({
    adapter: createAdapter(common, dependencies.adapterDependencies),
  });
  if (action === "plan") {
    forbid(options, ["plan-digest", "auth-file"], "plan");
    return controller.plan();
  }
  return controller.run({
    planDigest: digest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(privateFile(
      required(options, "auth-file"),
      "authorization",
      excludedRoots,
    )),
  });
}

export async function runCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  try {
    const result = await main(argumentsList, dependencies);
    process.stdout.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      status: "complete",
      result,
    }, null, argumentsList.includes("--json") ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      status: "blocked",
      error: String(error?.message || error).slice(0, 1_000),
    })}\n`);
    return 1;
  }
}

function parse(args) {
  const values = new Map();
  for (const argument of args) {
    if (argument === "--json") {
      if (values.has("json")) throw new Error("--json must be provided once.");
      values.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(argument);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
    if (values.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    values.set(match[1], match[2]);
  }
  return values;
}

function physicalDirectory(value, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const target = realpathSync(path.resolve(value));
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be one physical directory.`);
  }
  return target;
}

function privateFile(value, label, excludedRoots) {
  if (!path.isAbsolute(value)) throw new Error(`${label} file must be absolute.`);
  const target = path.resolve(value);
  rejectSymlinkTraversal(target, label);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} file must be one owner-held mode-0600 regular file.`);
  }
  const physical = realpathSync(target);
  requireExternal(physical, label, excludedRoots);
  return physical;
}

function privateDestination(value, label, excludedRoots) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const target = path.resolve(value);
  rejectSymlinkTraversal(target, label);
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
      throw new Error(`${label} must be one owner-held mode-0600 regular file when it exists.`);
    }
  }
  const physical = resolveThroughExistingAncestor(target);
  requireExternal(physical, label, excludedRoots);
  return physical;
}

function physicalOrAbsentPath(value, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const target = path.resolve(value);
  rejectSymlinkTraversal(target, label);
  if (existsSync(target)) return physicalDirectory(target, label);
  if (resolveThroughExistingAncestor(target) !== target) {
    throw new Error(`${label} cannot traverse a symbolic-link alias.`);
  }
  return target;
}

function rejectSymlinkTraversal(value, label) {
  const parsed = path.parse(value);
  let cursor = parsed.root;
  for (const segment of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`${label} cannot traverse a symbolic link.`);
      }
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return;
      throw error;
    }
  }
}

function requireExternal(value, label, excludedRoots) {
  for (const root of excludedRoots) {
    if (value === root || value.startsWith(`${root}${path.sep}`)) {
      throw new Error(`${label} must remain outside repository, worktree, controller, and Git roots.`);
    }
  }
}

function resolveThroughExistingAncestor(value) {
  const remainder = [];
  let cursor = value;
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    remainder.unshift(path.basename(cursor));
    cursor = parent;
  }
  const anchor = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return path.resolve(anchor, ...remainder);
}

function readAuthorization(file) {
  const value = readFileSync(file, "utf8");
  if (!value.includes("\n")) return requiredText(value, "authorization");
  if (value.endsWith("\n") && !value.slice(0, -1).includes("\n")) {
    return requiredText(value.slice(0, -1), "authorization");
  }
  throw new Error("Authorization file must contain exactly one line.");
}

function forbid(options, names, action) {
  const forbidden = names.find(name => options.has(name));
  if (forbidden) throw new Error(`${action} forbids --${forbidden}.`);
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positive(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`);
  return result;
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) {
    throw new Error("Repository identity is invalid.");
  }
  return value;
}

function repositoryPath(value, label) {
  const candidate = requiredText(value, label).replaceAll("\\", "/");
  if (candidate.startsWith("/") || candidate.endsWith("/")
    || candidate.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be one normalized repository-relative path.`);
  }
  return candidate;
}

function usage() {
  return "Usage: canonical-squash-attribution-recovery-terminalization.mjs plan|run --repository=<canonical> --subject-worktree=<merged-lane> --target-repository=<owner/name> --subject-pull-request=<number> --recovery-pull-request=<number> --recovery-evidence-path=<repo-relative-path> --recovery-cleanup-receipt-digest=<digest> --task-authority=<private-capability> --state-path=<private-journal> [--controller-root=<protected-main>] [--ledger-repository=<owner/name>] [--plan-digest=<digest> --auth-file=<private-text>] [--json]";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli();
}
