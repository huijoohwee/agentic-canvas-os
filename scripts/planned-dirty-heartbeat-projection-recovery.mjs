#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized heartbeat projection.
import {
  closeSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exactAuthorization }
  from "./planned-dirty-heartbeat-projection-recovery-contract.mjs";
import { createPlannedDirtyHeartbeatProjectionRecoveryController }
  from "./planned-dirty-heartbeat-projection-recovery-controller.mjs";
import { createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter }
  from "./planned-dirty-heartbeat-projection-recovery-repository-adapter.mjs";

export function parseArguments(values) {
  const [mode, ...tokens] = values;
  if (!new Set(["plan", "execute"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") { options.json = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set(["repository", "session",
    ...(mode === "plan" ? ["output"] : ["plan-file", "task-authority", "authorize"])]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const repository = canonicalDirectory(options.repository, "repository");
  const input = {
    mode,
    repository,
    sessionId: required(options.session, "session"),
    json: options.json === true,
  };
  if (mode === "plan") {
    const output = externalOutput(options.output, repository);
    return Object.freeze({ ...input, output });
  }
  const planFile = externalInput(options["plan-file"], repository, "plan input");
  const taskAuthorityFile = externalInput(
    options["task-authority"], repository, "task-authority capability",
  );
  return Object.freeze({ ...input, planFile, taskAuthorityFile,
    authorization: required(options.authorize, "authorize") });
}

export async function runCli(values = process.argv.slice(2), dependencies = {}) {
  const input = parseArguments(values);
  const adapter = (dependencies.createAdapter
    || createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter)(input,
    dependencies.adapterDependencies);
  const controller = (dependencies.createController
    || createPlannedDirtyHeartbeatProjectionRecoveryController)(adapter);
  if (input.mode === "plan") {
    const plan = await controller.plan();
    writeExclusiveJson(input.output, plan);
    return Object.freeze({
      schema: "agentic-planned-dirty-heartbeat-projection-recovery-result/v1",
      ok: true,
      status: "planned",
      plan,
      exactAuthorization: exactAuthorization(plan),
    });
  }
  const plan = JSON.parse(readFileSync(input.planFile, "utf8"));
  const completion = await controller.execute({ plan,
    authorization: input.authorization, taskAuthorityFile: input.taskAuthorityFile });
  return Object.freeze({
    schema: "agentic-planned-dirty-heartbeat-projection-recovery-result/v1",
    ok: true,
    status: "complete",
    completion,
  });
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`--${label}=<value> is required.`);
  return value.trim();
}
function absolute(value, label) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) fail(`--${label}=<value> must be absolute.`);
  return path.resolve(source);
}
function canonicalDirectory(value, label) {
  const target = realpathSync(absolute(value, label));
  const metadata = lstatSync(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} must be a canonical real directory.`);
  }
  return target;
}
function externalOutput(value, repository) {
  const target = absolute(value, "output");
  const parent = canonicalDirectory(path.dirname(target), "plan output parent");
  const canonical = path.join(parent, path.basename(target));
  external(canonical, repository, "plan output");
  if (lstatSync(canonical, { throwIfNoEntry: false })) {
    fail("plan output must be a new non-symlink file.");
  }
  return canonical;
}
function externalInput(value, repository, label) {
  const target = absolute(value, label);
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600) {
    fail(`${label} must be one private regular non-symlink 0600 file.`);
  }
  const canonical = realpathSync(target);
  external(canonical, repository, label);
  return canonical;
}
function external(candidate, repository, label) {
  const relative = path.relative(repository, candidate);
  const parentTraversal = relative === ".." || relative.startsWith(`..${path.sep}`);
  if (relative === "" || (relative && !parentTraversal
    && !path.isAbsolute(relative))) {
    fail(`${label} must remain outside the source repository.`);
  }
}
function writeExclusiveJson(target, value) {
  const descriptor = openSync(target, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600) {
    fail("plan output must be one private regular non-symlink 0600 file.");
  }
}
function fail(message) { throw new Error(message); }
function usage() {
  return "Usage: planned-dirty-heartbeat-projection-recovery.mjs plan --repository=<path> --session=<id> --output=<external-json> [--json] | execute --repository=<path> --session=<id> --plan-file=<external-json> --task-authority=<external-capability> --authorize=<exact-token> [--json]";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const input = parseArguments(process.argv.slice(2));
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, input.json ? 0 : 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
