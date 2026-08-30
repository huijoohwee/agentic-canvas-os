#!/usr/bin/env node
// Responsibility: Expose plan and exact-authorized execution for canonical untracked relocation.
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertCanonicalUntrackedRelocationPlan } from "./canonical-untracked-relocation-contract.mjs";
import {
  executeCanonicalUntrackedRelocation,
  planCanonicalUntrackedRelocation,
} from "./canonical-untracked-relocation-repository-adapter.mjs";

const [command, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");
const MAX_PLAN_BYTES = 1024 * 1024;

async function main() {
  try {
    const input = commonInput();
    let result;
    if (command === "plan") {
      const output = externalOutput(requiredOption("output"), input);
      const plan = planCanonicalUntrackedRelocation(input);
      writeJsonExclusive(output, plan);
      result = Object.freeze({
        schema: "agentic-canonical-untracked-relocation-result/v1",
        status: "planned",
        planPath: output,
        planDigest: plan.planDigest,
        exactAuthorization: plan.exactAuthorization,
        plan,
      });
    } else if (command === "execute") {
      const planPath = externalInput(requiredOption("plan"), input);
      const plan = assertCanonicalUntrackedRelocationPlan(readJsonBounded(planPath));
      const receipt = await executeCanonicalUntrackedRelocation({
        ...input,
        plan,
        authorization: requiredOption("authorization"),
      });
      result = Object.freeze({
        schema: "agentic-canonical-untracked-relocation-result/v1",
        status: "complete",
        planPath,
        receipt,
      });
    } else usage();
    process.stdout.write(`${json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = publicError(error);
    if (!json) throw error;
    process.stderr.write(`${JSON.stringify({
      schema: "agentic-canonical-untracked-relocation-error/v1",
      status: "blocked",
      message,
    })}\n`);
    process.exitCode = 1;
  }
}

function commonInput() {
  return Object.freeze({
    source: path.resolve(requiredOption("source")),
    recovery: path.resolve(requiredOption("recovery")),
    target: path.resolve(requiredOption("target")),
    sessionId: requiredOption("session"),
    taskAuthorityFile: path.resolve(requiredOption("task-authority")),
    writeScopeManifestPath: path.resolve(requiredOption("write-scope-manifest")),
  });
}

function externalOutput(value, input) {
  const output = path.resolve(value);
  requireExternal(output, input);
  if (existsSync(output)) throw new Error("Relocation plan output already exists.");
  return output;
}

function externalInput(value, input) {
  const target = path.resolve(value);
  requireExternal(target, input);
  return target;
}

function requireExternal(target, input) {
  for (const repository of [input.source, input.target]) {
    if (target === repository || target.startsWith(`${repository}${path.sep}`)) {
      throw new Error("Relocation plan must remain outside source and target repositories.");
    }
  }
}

function readJsonBounded(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PLAN_BYTES) {
    throw new Error("Relocation plan must be a bounded regular file.");
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonExclusive(output, value) {
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const descriptor = openSync(output, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); }
  finally { closeSync(descriptor); }
}

function option(name) {
  const prefix = `--${name}=`;
  return argumentsList.find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function publicError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}

function usage() {
  throw new Error(
    "Usage: canonical-untracked-relocation.mjs plan --source=<canonical> --recovery=<verified-package> --target=<admitted-worktree> --session=<id> --task-authority=<external-capability> --write-scope-manifest=<external-manifest> --output=<external-plan> [--json] | execute <same authority options> --plan=<external-plan> --authorization='authorize canonical-untracked-relocation <digest>' [--json]",
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
