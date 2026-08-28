#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact typed authorization for one claim pair.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMixedIdentityPairRetirementController }
  from "./claim-only-mixed-identity-pair-retirement-controller.mjs";
import { createRepositoryMixedIdentityPairRetirementAdapter }
  from "./claim-only-mixed-identity-pair-retirement-repository-adapter.mjs";

const COMMANDS = new Set(["plan", "run"]);
const OPTIONS = new Set([
  "auth-file", "controller-root", "ledger-repository", "plan-digest", "repository",
  "source-claim-id", "state-path", "target-repository", "waiting-successor-claim-id",
  "json",
]);
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESULT_SCHEMA = "agentic-claim-only-mixed-identity-pair-retirement-result/v1";

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command = "plan", ...tail] = argumentsList;
  if (!COMMANDS.has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const running = command === "run";
  if (!running && (options.has("auth-file") || options.has("plan-digest"))) {
    throw new Error("Planning forbids authorization and run-digest options.");
  }
  const repository = path.resolve(required(options, "repository"));
  const controllerRoot = path.resolve(options.get("controller-root") || CONTROLLER_ROOT);
  const statePath = externalPrivatePath(required(options, "state-path"), {
    repository, controllerRoot, label: "state path",
  });
  const authorizationPath = running
    ? externalPrivatePath(required(options, "auth-file"), {
      repository, controllerRoot, label: "authorization path",
    }) : null;
  if (authorizationPath === statePath) {
    throw new Error("Journal and authorization paths must be distinct.");
  }
  const createAdapter = dependencies.createAdapter
    || createRepositoryMixedIdentityPairRetirementAdapter;
  const createController = dependencies.createController
    || createMixedIdentityPairRetirementController;
  const adapter = createAdapter({
    repository,
    controllerRoot,
    targetRepository: required(options, "target-repository"),
    ledgerRepository: options.get("ledger-repository"),
    sourceClaimId: exactDigest(required(options, "source-claim-id"), "source claim ID"),
    waitingSuccessorClaimId: exactDigest(
      required(options, "waiting-successor-claim-id"), "waiting-successor claim ID",
    ),
    statePath,
  });
  const controller = createController({ adapter });
  if (!running) return controller.plan();
  return controller.run({
    planDigest: exactDigest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(authorizationPath),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA, status: "complete", result: await main(argumentsList),
    })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA, status: "blocked", error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function readAuthorization(file) {
  const stat = lstatSync(file);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.uid !== currentUid) {
    throw new Error("Authorization file must be owner-held, regular, non-symlinked, mode 0600.");
  }
  const content = readFileSync(file, "utf8");
  if (!content.includes("\n")) return content;
  if (content.endsWith("\n") && !content.slice(0, -1).includes("\n")) {
    return content.slice(0, -1);
  }
  throw new Error("Authorization file must contain exactly one line.");
}

function externalPrivatePath(value, { repository, controllerRoot, label }) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
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
    if (!match || !OPTIONS.has(match[1]) || !match[2] || result.has(match[1])) {
      throw new Error(`Unsupported or repeated option: ${argument}`);
    }
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
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}
function usage() {
  return "Usage: claim-only-mixed-identity-pair-retirement.mjs <plan|run> "
    + "--repository=<path> --target-repository=<owner/name> "
    + "--source-claim-id=<digest> --waiting-successor-claim-id=<digest> "
    + "--state-path=<private-json> [--ledger-repository=<owner/name>] "
    + "[--plan-digest=<digest> --auth-file=<private-text>] [--json]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
