#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized execution for planned dirty scope expansion.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlannedOwnedDirtScopeExpansionRecoveryController }
  from "./planned-owned-dirt-scope-expansion-recovery-controller.mjs";
import { createRepositoryPlannedOwnedDirtScopeExpansionRecoveryAdapter }
  from "./planned-owned-dirt-scope-expansion-recovery-repository-adapter.mjs";
import { OPERATION, normalizePlannedOwnedDirtScopeExpansionRecoveryPlan }
  from "./planned-owned-dirt-scope-expansion-recovery-contract.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";

export async function runPlannedOwnedDirtScopeExpansionRecovery(input, dependencies = {}) {
  const targetManifest = normalizeDeclaredWriteScopeManifest(JSON.parse(
    readFileSync(input.targetManifestFile, "utf8"),
  ));
  const adapter = createRepositoryPlannedOwnedDirtScopeExpansionRecoveryAdapter({
    repository: input.repository, sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile, ttlSeconds: input.ttlSeconds,
  }, dependencies);
  const controller = createPlannedOwnedDirtScopeExpansionRecoveryController(adapter);
  if (input.mode === "plan") {
    const plan = await controller.plan({ targetManifest });
    return Object.freeze({ schema:
      "agentic-planned-owned-dirt-scope-expansion-recovery-plan-result/v1",
    status: "planned", plan,
    exactAuthorization: `authorize ${OPERATION} ${plan.planDigest}` });
  }
  const plan = normalizePlannedOwnedDirtScopeExpansionRecoveryPlan(JSON.parse(
    readFileSync(input.planFile, "utf8"),
  ));
  if (plan.target.manifestDigest !== targetManifest.manifestDigest
    || plan.target.writeSetDigest !== targetManifest.writeSetDigest) {
    throw new Error("Target manifest drifted from the sealed recovery plan.");
  }
  return controller.run({ plan, authorization: input.authorization });
}

export function parsePlannedOwnedDirtScopeExpansionRecoveryArguments(argumentsList) {
  const [mode, ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(mode)) fail(usage());
  const options = {};
  for (const token of tokens) {
    if (token === "--json") { options.json = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(token);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid argument: ${token}`);
    options[match[1]] = match[2];
  }
  const allowed = new Set(["repository", "session", "target-manifest", "ttl-seconds",
    ...(mode === "run" ? ["plan-file", "task-authority", "authorize"] : [])]);
  for (const key of Object.keys(options)) {
    if (key !== "json" && !allowed.has(key)) fail(`Unknown argument: --${key}`);
  }
  const base = { mode, repository: required(options.repository, "repository"),
    sessionId: required(options.session, "session"),
    targetManifestFile: path.resolve(required(options["target-manifest"], "target-manifest")),
    ttlSeconds: options["ttl-seconds"] ? ttl(options["ttl-seconds"]) : 28_800,
    json: options.json === true };
  if (mode === "plan") return Object.freeze(base);
  return Object.freeze({ ...base,
    planFile: path.resolve(required(options["plan-file"], "plan-file")),
    taskAuthorityFile: path.resolve(required(options["task-authority"], "task-authority")),
    authorization: required(options.authorize, "authorize") });
}

async function main() {
  const input = parsePlannedOwnedDirtScopeExpansionRecoveryArguments(process.argv.slice(2));
  const result = await runPlannedOwnedDirtScopeExpansionRecovery(input);
  process.stdout.write(`${JSON.stringify(result, null, input.json ? 2 : 0)}\n`);
}
function required(value, label) { if (typeof value !== "string" || !value.trim()) fail(`--${label} is required.`); return value; }
function ttl(value) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400) fail("--ttl-seconds must be 60..86400."); return parsed; }
function fail(message) { throw new Error(message); }
function usage() { return "Usage: planned-owned-dirt-scope-expansion-recovery.mjs <plan|run> --repository=<path> --session=<id> --target-manifest=<path> [--plan-file=<plan.json> --task-authority=<capability.json> --authorize=<exact-text>] [--ttl-seconds=28800] [--json]"; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
