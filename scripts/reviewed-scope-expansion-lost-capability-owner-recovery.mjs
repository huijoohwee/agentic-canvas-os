#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized lost-capability owner recovery.
import { readFileSync, writeFileSync } from "node:fs";
import { createLostCapabilityOwnerRecoveryController }
  from "./reviewed-scope-expansion-lost-capability-owner-recovery-controller.mjs";
import { createLostCapabilityOwnerRecoveryRepositoryAdapter }
  from "./reviewed-scope-expansion-lost-capability-owner-recovery-repository-adapter.mjs";

const [command, ...tokens] = process.argv.slice(2);
const options = parse(tokens);
try {
  if (!["plan", "run"].includes(command)) usage();
  const adapter = createLostCapabilityOwnerRecoveryRepositoryAdapter({ repository: options.repository,
    taskAuthorityFile: options.taskAuthority, targetManifestFile: options.targetManifest });
  const controller = createLostCapabilityOwnerRecoveryController(adapter);
  const result = command === "plan" ? controller.plan() : controller.run({
    plan: JSON.parse(readFileSync(required(options.planFile, "plan file"), "utf8")),
    authorization: required(options.authorization, "authorization"),
  });
  if (command === "plan" && options.output) writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
} catch (error) {
  if (!options.json) throw error;
  console.error(JSON.stringify({ schema: "agentic-reviewed-scope-expansion-lost-capability-owner-recovery-command/v1",
    status: "error", error: { code: "owner_recovery_failed", message: String(error.message).slice(0, 500) } }));
  process.exitCode = 1;
}

function parse(values) { const result = { json: values.includes("--json") }; for (const token of values) {
  if (!token.startsWith("--") || token === "--json") continue; const index = token.indexOf("=");
  if (index > 2) result[camel(token.slice(2, index))] = token.slice(index + 1); } return result; }
function camel(value) { return value.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()); }
function required(value, label) { if (!value) throw new Error(`${label} is required.`); return value; }
function usage() { throw new Error("Usage: reviewed-scope-expansion-lost-capability-owner-recovery.mjs plan|run --repository=<worktree> --target-manifest=<external-json> --task-authority=<external-capability> [--output=<plan>] [--plan-file=<plan> --authorization=<statement>] [--json]"); }
