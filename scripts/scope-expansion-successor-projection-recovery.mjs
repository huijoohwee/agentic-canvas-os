#!/usr/bin/env node
// Responsibility: Transport an external sealed plan into the exact-authorized recovery controller.
import { closeSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeScopeExpansionSuccessorProjectionRecoveryPlan }
  from "./scope-expansion-successor-projection-recovery-contract.mjs";
import { createScopeExpansionSuccessorProjectionRecoveryRepositoryController }
  from "./scope-expansion-successor-projection-recovery-repository-adapter.mjs";

export async function runScopeExpansionSuccessorProjectionRecoveryCli(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const [command, ...tokens] = argv;
  if (!["plan", "execute"].includes(command)) throw new Error(usage());
  const options = parse(tokens);
  const repository = canonicalDirectory(options.repository, "source repository");
  const common = {
    repository,
    sourceSessionId: options.sourceSession,
    operatorSessionId: options.operatorSession,
    pullRequestNumber: Number(options.pullRequest),
    taskAuthorityFile: options.taskAuthority,
  };
  if (command === "plan") {
    const output = externalOutput(options.output, repository);
    const controller = createController(common, dependencies);
    const plan = await controller.plan({ operatorSessionId: options.operatorSession });
    writeExclusiveJson(output, plan);
    return { schema: "agentic-scope-expansion-successor-projection-recovery-command/v1",
      ok: true, action: "plan", planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization, planOutput: output };
  }
  const planPath = externalInput(options.plan, repository);
  const plan = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(
    JSON.parse(readFileSync(planPath, "utf8")),
  );
  const controller = createController(common, dependencies);
  const receipt = await controller.run({ plan, operatorSessionId: options.operatorSession,
    authorization: options.authorization });
  return { schema: "agentic-scope-expansion-successor-projection-recovery-command/v1",
    ok: true, action: "execute", planDigest: plan.planDigest, receipt,
    authoringAuthority: false, deployment: false };
}

function parse(tokens) {
  const result = {};
  for (const token of tokens) {
    if (token === "--json") { result.json = true; continue; }
    const match = /^--([a-z-]+)=(.*)$/u.exec(token);
    if (!match) throw new Error(`Unknown argument: ${token}`);
    result[match[1].replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = match[2];
  }
  return result;
}
function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(value);
}
function writeExclusiveJson(target, value) {
  const descriptor = openSync(target, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(descriptor); }
}
function createController(common, dependencies) {
  const create = dependencies.createController
    || createScopeExpansionSuccessorProjectionRecoveryRepositoryController;
  return create(common, dependencies.adapterDependencies || {});
}
function canonicalDirectory(value, label) {
  const target = realpathSync(absolute(value, label));
  if (!lstatSync(target).isDirectory()) throw new Error(`${label} must be a real directory.`);
  return target;
}
function externalOutput(value, repository) {
  const target = absolute(value, "external plan output");
  const parent = canonicalDirectory(path.dirname(target), "plan output parent");
  const canonical = path.join(parent, path.basename(target));
  requireExternal(canonical, repository, "plan output");
  return canonical;
}
function externalInput(value, repository) {
  const target = absolute(value, "external plan");
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) {
    throw new Error("plan input must be one private regular non-symlink file.");
  }
  const canonical = realpathSync(target);
  requireExternal(canonical, repository, "plan input");
  return canonical;
}
function requireExternal(target, repository, label) {
  const root = realpathSync(repository);
  const relative = path.relative(root, target);
  if (relative === "" || relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error(`${label} must remain outside the source worktree.`);
  }
}
function usage() {
  return "Usage: scope-expansion-successor-projection-recovery.mjs <plan|execute> --repository=<path> --source-session=<id> --operator-session=<id> --pull-request=<number> [--output=<external-plan>|--plan=<external-plan> --task-authority=<external-file> --authorization=<exact-token>] --json";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runScopeExpansionSuccessorProjectionRecoveryCli();
    process.stdout.write(`${JSON.stringify(result, null, process.argv.includes("--json") ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schema: "agentic-scope-expansion-successor-projection-recovery-command/v1",
      ok: false, status: "error", error: { code: "scope_expansion_successor_projection_recovery_failed",
        message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
