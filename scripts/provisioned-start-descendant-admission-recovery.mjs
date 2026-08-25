#!/usr/bin/env node
// Responsibility: Expose plan and exact-authorized run transport for descendant admission recovery.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProvisionedStartDescendantAdmissionRecoveryController }
  from "./provisioned-start-descendant-admission-recovery-controller.mjs";
import { createProvisionedStartDescendantAdmissionRecoveryRepositoryAdapter }
  from "./provisioned-start-descendant-admission-recovery-repository-adapter.mjs";

export function runProvisionedStartDescendantAdmissionRecovery(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) throw new Error(usage());
  const options = parse(tokens);
  const repository = absolute(options.repository, "repository");
  const taskAuthorityFile = external(options["task-authority"], "task-authority", repository);
  const adapter = (dependencies.createAdapter
    || createProvisionedStartDescendantAdmissionRecoveryRepositoryAdapter)({ repository,
    sessionId: required(options.session, "session"), taskAuthorityFile,
    controllerRepository: dependencies.controllerRepository });
  const controller = (dependencies.createController
    || createProvisionedStartDescendantAdmissionRecoveryController)({ adapter });
  if (mode === "plan") {
    const plan = controller.plan(), output = external(options.output, "output", repository);
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return { schema: "agentic-provisioned-start-descendant-admission-recovery-command/v1",
      ok: true, mode, planPath: output, planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization, plan };
  }
  const planFile = external(options["plan-file"], "plan-file", repository);
  const result = controller.run({ sealedPlan: JSON.parse(readFileSync(planFile, "utf8")),
    authorization: required(options.authorize, "authorize") });
  return { schema: "agentic-provisioned-start-descendant-admission-recovery-command/v1",
    ok: true, mode, result };
}

function parse(tokens) { const result = {}; for (const token of tokens) {
  if (token === "--json") continue; const match = /^--([a-z-]+)=(.*)$/u.exec(token);
  if (!match || Object.hasOwn(result, match[1])) throw new Error(`Invalid argument: ${token}`);
  result[match[1]] = match[2]; } return result; }
function required(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`--${label} is required.`); return value; }
function absolute(value, label) { const result = path.resolve(required(value, label)); if (!path.isAbsolute(result)) throw new Error(`--${label} must be absolute.`); return result; }
function external(value, label, repository) { const result = absolute(value, label), root = `${path.resolve(repository)}${path.sep}`;
  if (result === path.resolve(repository) || result.startsWith(root)) throw new Error(`--${label} must remain outside the source repository.`); return result; }
function usage() { return "Usage: provisioned-start-descendant-admission-recovery.mjs <plan|run> --repository=<worktree> --session=<id> --task-authority=<external> --output=<external-plan> | --plan-file=<external-plan> --authorize=<exact> --json"; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(runProvisionedStartDescendantAdmissionRecovery())}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ schema: "agentic-provisioned-start-descendant-admission-recovery-command/v1",
    ok: false, error: { code: "provisioned_start_descendant_admission_recovery_failed",
      message: String(error?.message || error).slice(0, 500) } })}\n`); process.exitCode = 1; }
}
