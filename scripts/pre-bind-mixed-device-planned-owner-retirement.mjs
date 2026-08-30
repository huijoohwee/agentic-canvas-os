#!/usr/bin/env node
// Responsibility: Transport private exact authorization to the pre-bind retirement controller.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPreBindMixedDevicePlannedOwnerRetirementController }
  from "./pre-bind-mixed-device-planned-owner-retirement-controller.mjs";
import { createPreBindMixedDevicePlannedOwnerRetirementRepositoryAdapter }
  from "./pre-bind-mixed-device-planned-owner-retirement-repository-adapter.mjs";

const OPTIONS = new Set(["repository", "subject-worktree", "target-repository",
  "ledger-repository", "controller-root", "branch", "pull-request", "claim-id",
  "claim-owner-device", "task-authority", "state-path", "plan-digest", "auth-file", "json"]);
const INSTALLED_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [action, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(action)) throw new Error(usage());
  const options = parse(tail);
  const repository = path.resolve(required(options, "repository"));
  const subjectWorktree = path.resolve(required(options, "subject-worktree"));
  const controllerRoot = path.resolve(options.get("controller-root") || INSTALLED_ROOT);
  const gitCommonDirectory = path.resolve(dependencies.resolveGitCommonDirectory
    ? dependencies.resolveGitCommonDirectory(repository)
    : String(execFileSync("git", ["-C", repository, "rev-parse", "--path-format=absolute",
      "--git-common-dir"], { encoding: "utf8" })).trim());
  const common = {
    repository, subjectWorktree,
    targetRepository: repositoryName(required(options, "target-repository")),
    ledgerRepository: options.get("ledger-repository"),
    controllerRoot, branch: required(options, "branch"),
    pullRequestNumber: positive(required(options, "pull-request"), "pull request"),
    claimId: digest(required(options, "claim-id"), "claim ID"),
    claimOwnerDevice: required(options, "claim-owner-device"),
    taskAuthorityFile: privateFile(required(options, "task-authority"), "task authority"),
    statePath: privateDestination(required(options, "state-path"),
      [repository, subjectWorktree, controllerRoot, gitCommonDirectory]),
  };
  const createAdapter = dependencies.createAdapter
    || createPreBindMixedDevicePlannedOwnerRetirementRepositoryAdapter;
  const createController = dependencies.createController
    || createPreBindMixedDevicePlannedOwnerRetirementController;
  const controller = createController({ adapter: createAdapter(common, dependencies.adapterDependencies) });
  if (action === "plan") {
    if (options.has("plan-digest") || options.has("auth-file")) throw new Error("plan forbids run authorization options.");
    return controller.plan();
  }
  return controller.run({ planDigest: digest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(privateFile(required(options, "auth-file"), "authorization")) });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const result = await main(argumentsList);
    process.stdout.write(`${JSON.stringify({ schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-command/v1",
      status: "complete", result }, null, argumentsList.includes("--json") ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-command/v1",
      status: "blocked", error: String(error?.message || error).slice(0, 1_000) })}\n`);
    return 1;
  }
}

function parse(args) { const values = new Map(); for (const argument of args) {
  if (argument === "--json") { if (values.has("json")) throw new Error("--json must be provided once."); values.set("json", "true"); continue; }
  const match = /^--([a-z0-9-]+)=(.+)$/u.exec(argument);
  if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
  if (values.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
  values.set(match[1], match[2]); } return values; }
function privateFile(value, label) { if (!path.isAbsolute(value)) throw new Error(`${label} file must be absolute.`);
  const stat = lstatSync(value); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`${label} file must be owner-only and regular.`); return path.resolve(value); }
function privateDestination(value, excludedRoots) {
  if (!path.isAbsolute(value)) throw new Error("state path must be absolute.");
  const candidate = resolveThroughExistingAncestor(path.resolve(value));
  for (const root of excludedRoots.map(item => resolveThroughExistingAncestor(path.resolve(item)))) {
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error("state path must remain outside repository, worktree, controller, and Git roots.");
    }
  }
  return candidate;
}
function resolveThroughExistingAncestor(value) {
  const remainder = []; let cursor = value;
  while (!existsSync(cursor)) { const parent = path.dirname(cursor); if (parent === cursor) break;
    remainder.unshift(path.basename(cursor)); cursor = parent; }
  const anchor = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return path.resolve(anchor, ...remainder);
}
function readAuthorization(file) { const value = readFileSync(file, "utf8"); if (!value.includes("\n")) return value;
  if (value.endsWith("\n") && !value.slice(0, -1).includes("\n")) return value.slice(0, -1);
  throw new Error("Authorization file must contain exactly one line."); }
function required(options, name) { const value = options.get(name); if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid.`); return value; }
function repositoryName(value) { if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) throw new Error("Repository identity is invalid."); return value; }
function usage() { return "Usage: pre-bind-mixed-device-planned-owner-retirement.mjs plan|run --repository=<canonical> --subject-worktree=<planned-owner> --target-repository=<owner/name> --branch=<agent-branch> --pull-request=<number> --claim-id=<digest> --claim-owner-device=<exact-raw-case-variant> --task-authority=<private-capability> --state-path=<private-journal> [--ledger-repository=<owner/name>] [--controller-root=<protected-main>] [--plan-digest=<digest> --auth-file=<private-text>] [--json]"; }
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await runCli();
