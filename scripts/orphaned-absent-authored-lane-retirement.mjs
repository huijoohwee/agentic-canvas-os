#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact authorized absent-owner retirement.
import path from "node:path";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createController }
  from "./orphaned-absent-authored-lane-retirement-controller.mjs";
import { createRepositoryAdapter }
  from "./orphaned-absent-authored-lane-retirement-repository-adapter.mjs";

const RESULT_SCHEMA = "agentic-orphaned-absent-authored-lane-retirement-result/v1";
const OPTIONS = new Set(["auth-file", "claim-id", "controller-root", "json",
  "ledger-repository", "plan-digest", "private-task-root", "pull-request",
  "repository", "state-path", "target-repository"]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = createRepositoryAdapter,
  createRuntimeController = createController,
} = {}) {
  const [command = "plan", ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const request = Object.freeze({
    repository: absolute(required(options, "repository"), "--repository"),
    controllerRoot: absolute(options.get("controller-root")
      || fileURLToPath(new URL("..", import.meta.url)), "--controller-root"),
    targetRepository: repositoryIdentity(required(options, "target-repository")),
    ledgerRepository: repositoryIdentity(options.get("ledger-repository")
      || "huijoohwee/agentic-canvas-os"),
    pullRequestNumber: positiveInteger(required(options, "pull-request"), "--pull-request"),
    claimId: sha256(required(options, "claim-id"), "--claim-id"),
    statePath: absolute(required(options, "state-path"), "--state-path"),
    privateTaskRoot: absolute(required(options, "private-task-root"), "--private-task-root"),
  });
  const adapter = createAdapter(request);
  const controller = createRuntimeController({ adapter });
  if (command === "plan") {
    if (options.has("auth-file") || options.has("plan-digest")) {
      throw new Error("plan does not accept --auth-file or --plan-digest.");
    }
    return controller.plan();
  }
  return controller.run({
    planDigest: sha256(required(options, "plan-digest"), "--plan-digest"),
    authorization: readAuthorization(required(options, "auth-file"),
      adapter.authorityForbiddenRoots || [request.repository, request.controllerRoot], request.statePath),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ schema: RESULT_SCHEMA, status: "blocked",
      error: publicMessage(error) }));
    return 1;
  }
}

function parseOptions(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    if (argument === "--json") {
      if (values.has("json")) throw new Error("--json must be provided at most once.");
      values.set("json", "true");
      continue;
    }
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
function absolute(value, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  return path.resolve(value);
}
function repositoryIdentity(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) {
    throw new Error("Repository identity must be owner/name.");
  }
  return value;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
  return number;
}
function sha256(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
function readAuthorization(value, forbiddenRoots, statePath) {
  if (!path.isAbsolute(value)) throw new Error("--auth-file must be absolute.");
  const requested = path.resolve(value), requestedStat = lstatSync(requested);
  if (!requestedStat.isFile() || requestedStat.isSymbolicLink()
    || (requestedStat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && requestedStat.uid !== process.getuid())) {
    throw new Error("--auth-file must be a private owner-only regular file.");
  }
  const target = realpathSync(requested), stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("--auth-file is unsafe.");
  if (target === path.resolve(statePath)) throw new Error("--auth-file and --state-path must be distinct.");
  for (const root of forbiddenRoots) {
    const relative = path.relative(root, target);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("--auth-file must remain outside repositories and worktrees.");
    }
  }
  const content = readFileSync(target, "utf8");
  const authorization = content.endsWith("\n") ? content.slice(0, -1) : "";
  if (!authorization || content !== `${authorization}\n` || authorization.includes("\n")
    || authorization.trim() !== authorization) {
    throw new Error("--auth-file must contain one exact newline-normalized authorization line.");
  }
  return authorization;
}
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]").slice(0, 1_000);
}
function usage() {
  return "Usage: orphaned-absent-authored-lane-retirement.mjs plan|run "
    + "--repository=<absolute-path> --target-repository=<owner/name> --pull-request=<number> "
    + "--claim-id=<digest> --private-task-root=<absolute-path> --state-path=<private-json> "
    + "[--ledger-repository=<owner/name>] [--controller-root=<protected-main>] "
    + "[--plan-digest=<digest> --auth-file=<private-owner-only-file>] [--json]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
