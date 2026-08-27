#!/usr/bin/env node
// Responsibility: Expose plan/run for one exact clean-fence one-ahead admission finalization.
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  OPERATION,
  buildPlannedCleanFenceAdmissionFinalizationPlan,
  normalizePlannedCleanFenceAdmissionFinalizationPlan,
  requirePlannedCleanFenceAdmissionFinalizationAuthorization,
} from "./planned-clean-fence-one-ahead-admission-finalization-contract.mjs";
import { createPlannedCleanFenceAdmissionFinalizationRepositoryAdapter }
  from "./planned-clean-fence-one-ahead-admission-finalization-repository-adapter.mjs";

const [action, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  if (!new Set(["plan", "run"]).has(action)) usage();
  const canonicalRepository = absoluteOption("canonical-repository");
  const repository = absoluteOption("repository");
  const adapter = createPlannedCleanFenceAdmissionFinalizationRepositoryAdapter({
    canonicalRepository,
    repository,
    branch: option("branch"),
    sessionId: option("session"),
    manifestFile: absoluteOption("manifest"),
    rootAuthorizationFile: absoluteOption("root-authorization"),
    taskAuthorityFile: absoluteOption("task-authority"),
  });
  if (action === "plan") {
    const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(
      adapter.readPlanEvidence(),
    );
    const authorization = `authorize ${OPERATION} ${plan.planDigest}`;
    const planFile = option("write-plan")
      ? writeExternalPlan({ value: plan, file: absoluteOption("write-plan"),
        forbidden: [canonicalRepository, repository] })
      : null;
    emit({ schema: "agentic-planned-clean-fence-admission-finalization-cli-result/v1",
      ok: true, action, planDigest: plan.planDigest, authorization, planFile, plan });
  } else {
    const plan = normalizePlannedCleanFenceAdmissionFinalizationPlan(
      readJson(absoluteOption("plan-file"), "plan file"),
    );
    const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
      plan,
      option("authorize"),
    );
    const result = adapter.execute({ plan, authorization });
    emit({ schema: "agentic-planned-clean-fence-admission-finalization-cli-result/v1",
      ok: true, action, result });
  }
} catch (error) {
  if (!json) throw error;
  emit({ schema: "agentic-planned-clean-fence-admission-finalization-cli-result/v1",
    ok: false, action: action || null, error: publicMessage(error) });
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  return args.find(item => item.startsWith(prefix))?.slice(prefix.length) || "";
}
function absoluteOption(name) {
  const value = option(name);
  if (!path.isAbsolute(value)) throw new Error(`--${name} must be absolute.`);
  return path.resolve(value);
}
function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error(`${label} is invalid JSON.`); }
}
function writeExternalPlan({ value, file, forbidden }) {
  if (forbidden.some(root => file === root || file.startsWith(`${root}${path.sep}`))) {
    throw new Error("Plan output must remain outside the repositories.");
  }
  try { lstatSync(file); throw new Error("Plan output already exists."); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}
function emit(value) { console.log(JSON.stringify(value, null, json ? 0 : 2)); }
function publicMessage(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1000);
}
function usage() {
  throw new Error("Usage: planned-clean-fence-one-ahead-admission-finalization.mjs <plan|run> --canonical-repository=<abs> --repository=<abs> --branch=<agent/...> --session=<id> --manifest=<abs> --root-authorization=<abs> --task-authority=<abs> [--write-plan=<abs>|--plan-file=<abs> --authorize='authorize ...'] [--json]");
}
