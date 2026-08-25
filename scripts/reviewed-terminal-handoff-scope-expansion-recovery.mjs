#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized execution for reviewed-handoff scope repair.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createReviewedTerminalHandoffScopeExpansionRecoveryController }
  from "./reviewed-terminal-handoff-scope-expansion-recovery-controller.mjs";
import { createReviewedTerminalHandoffScopeExpansionRecoveryRepositoryAdapter }
  from "./reviewed-terminal-handoff-scope-expansion-recovery-repository-adapter.mjs";

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const [mode, ...args] = argv;
  if (!["plan", "run"].includes(mode)) usage();
  const values = options(args);
  const repository = required(values.get("repository"), "repository");
  const targetManifestFile = required(values.get("target-manifest"), "target manifest");
  const taskAuthorityFile = required(values.get("task-authority"), "task authority");
  const operatorSessionId = required(values.get("operator-session"), "operator session");
  const adapter = (dependencies.createAdapter
    || createReviewedTerminalHandoffScopeExpansionRecoveryRepositoryAdapter)({
    repository, targetManifestFile, taskAuthorityFile,
    ttlSeconds: positive(values.get("ttl-seconds") || "1800", "TTL seconds"),
  }, dependencies.adapterDependencies || {});
  const controller = (dependencies.createController
    || createReviewedTerminalHandoffScopeExpansionRecoveryController)(adapter);
  if (mode === "plan") {
    const plan = await controller.plan({ operatorSessionId,
      ttlSeconds: positive(values.get("ttl-seconds") || "1800", "TTL seconds") });
    if (values.get("output")) writeJson(values.get("output"), plan, dependencies);
    emit({ schema: "agentic-reviewed-terminal-handoff-scope-expansion-recovery-cli/v1",
      ok: true, mode, status: "planned", plan }, values.has("json"), dependencies);
    return plan;
  }
  const planFile = required(values.get("plan-file"), "plan file");
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const completion = await controller.run({ plan, operatorSessionId,
    authorization: required(values.get("authorization"), "authorization") });
  emit({ schema: "agentic-reviewed-terminal-handoff-scope-expansion-recovery-cli/v1",
    ok: true, mode, status: "complete", completion }, values.has("json"), dependencies);
  return completion;
}

function options(args) { const result = new Map();
  for (const argument of args) {
    if (argument === "--json") { result.set("json", "true"); continue; }
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) usage(); result.set(match[1], match[2]);
  } return result; }
function writeJson(file, value, dependencies) {
  if (dependencies.writeJson) return dependencies.writeJson(file, value);
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  renameSync(temporary, file);
}
function emit(value, json, dependencies) { const output = json ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  (dependencies.log || console.log)(output); }
function required(value, label) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
function usage() { throw new Error("Usage: reviewed-terminal-handoff-scope-expansion-recovery.mjs plan|run --repository=<worktree> --target-manifest=<external-json> --task-authority=<external-capability> --operator-session=<id> [--ttl-seconds=1800] [--output=<plan-json>] [--plan-file=<plan-json> --authorization='authorize reviewed-terminal-handoff-scope-expansion-recovery <digest>'] [--json]"); }

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
