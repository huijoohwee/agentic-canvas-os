#!/usr/bin/env node
// Responsibility: Parse CLI transport for provisioned-start admission recovery.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProvisionedStartAdmissionRecoveryController } from "./provisioned-start-admission-recovery-controller.mjs";
import { createProvisionedStartAdmissionRecoveryRepositoryAdapter } from "./provisioned-start-admission-recovery-repository-adapter.mjs";
import { createProvisionedStartAdmissionRecoveryStore } from "./provisioned-start-admission-recovery-store.mjs";

export function runProvisionedStartAdmissionRecoveryCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [action] = argumentsList;
  if (!action || !["plan", "execute"].includes(action)) throw new Error(usage());
  const repository = required(argumentsList, "repository");
  const sessionId = required(argumentsList, "session");
  const taskAuthorityFile = required(argumentsList, "task-authority");
  const adapter = (dependencies.createAdapter || createProvisionedStartAdmissionRecoveryRepositoryAdapter)({
    repository, sessionId, taskAuthorityFile,
  });
  const branch = dependencies.branch || dependencies.gitBranch?.(repository)
    || dependencies.git?.(repository, ["branch", "--show-current"])
    || defaultBranch(repository);
  const intentStore = (dependencies.createStore || createProvisionedStartAdmissionRecoveryStore)({
    gitCommonDir: adapter.gitCommonDir, branch,
  });
  const controller = (dependencies.createController || createProvisionedStartAdmissionRecoveryController)({
    adapter, intentStore,
  });
  if (action === "plan") {
    const plan = controller.plan();
    const output = option(argumentsList, "output");
    if (output) {
      requireExternal(output, repository);
      writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    }
    return { schema: "agentic-provisioned-start-admission-recovery-command/v1", ok: true,
      action, plan, authorization: `authorize provisioned-start-admission-recovery ${plan.planDigest}` };
  }
  const planFile = required(argumentsList, "plan");
  requireExternal(planFile, repository);
  const authorization = required(argumentsList, "authorization");
  const result = controller.execute({ sealedPlan: JSON.parse(readFileSync(planFile, "utf8")), authorization });
  return { schema: "agentic-provisioned-start-admission-recovery-command/v1", ok: true, action, result };
}

function option(values, name) { const prefix = `--${name}=`; return values.find(value => value.startsWith(prefix))?.slice(prefix.length) || ""; }
function required(values, name) { const value = option(values, name); if (!value) throw new Error(`--${name} is required.`); return value; }
function requireExternal(candidate, repository) { const file = path.resolve(candidate); const root = `${path.resolve(repository)}${path.sep}`;
  if (file === path.resolve(repository) || file.startsWith(root)) throw new Error("Recovery artifacts must remain outside the repository."); }
function defaultBranch(repository) { return execFileSync("git", ["-C", repository, "branch", "--show-current"], { encoding: "utf8" }).trim(); }
function usage() { return "Usage: provisioned-start-admission-recovery.mjs <plan|execute> --repository=<path> --session=<id> --task-authority=<external-file> [--output=<external-plan>|--plan=<external-plan> --authorization=<exact-token>] --json"; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runProvisionedStartAdmissionRecoveryCli())); }
  catch (error) { console.error(JSON.stringify({ schema: "agentic-provisioned-start-admission-recovery-command/v1",
    ok: false, status: "error", error: { code: "provisioned_start_admission_recovery_failed", message: error.message } })); process.exitCode = 1; }
}
