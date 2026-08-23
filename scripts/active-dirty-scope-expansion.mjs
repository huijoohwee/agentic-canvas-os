#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  buildActiveDirtyScopeExpansionPlan,
  normalizeActiveDirtyScopeExpansionPlan,
} from "./active-dirty-scope-expansion-contract.mjs";
import {
  createRepositoryActiveDirtyScopeExpansionAdapter,
  runActiveDirtyScopeExpansion,
} from "./active-dirty-scope-expansion-controller.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";

const [command = "plan", ...args] = process.argv.slice(2);

try {
  if (!["plan", "execute"].includes(command)) {
    throw new Error("Usage: active-dirty-scope-expansion.mjs plan|execute --source-repository=<path> --target-manifest=<path> --session=<id> [--authorize=<exact text>] [--ttl-seconds=28800] [--json]");
  }
  const sourceRepository = requiredOption("source-repository");
  const sessionId = requiredOption("session");
  const targetManifestPath = requiredOption("target-manifest");
  const ttlSeconds = option("ttl-seconds") === null ? 28_800 : positiveInteger(option("ttl-seconds"));
  const targetManifest = normalizeDeclaredWriteScopeManifest(
    JSON.parse(readFileSync(targetManifestPath, "utf8")),
  );
  const adapter = createRepositoryActiveDirtyScopeExpansionAdapter({
    sourceRepository,
    sessionId,
    targetManifest,
    ttlSeconds,
  });
  const state = await adapter.readState();
  const plan = state.intent?.planSnapshot
    ? normalizeActiveDirtyScopeExpansionPlan(state.intent.planSnapshot)
    : buildActiveDirtyScopeExpansionPlan({
      source: state.source,
      targetManifest,
      targetCanonicalBaseSha: state.targetCanonicalBaseSha,
      canonicalDescendantProof: state.canonicalDescendantProof,
    });
  if (plan.targetManifestDigest !== targetManifest.manifestDigest
    || plan.targetWriteSetDigest !== targetManifest.writeSetDigest) {
    throw new Error("Target manifest drifted from the durable scope-expansion intent.");
  }
  const result = command === "plan"
    ? Object.freeze({
      schema: "agentic-active-dirty-scope-expansion-plan-result/v1",
      status: "planned",
      plan,
      exactAuthorization: `authorize scope-expansion ${plan.planDigest}`,
    })
    : await runActiveDirtyScopeExpansion({
      targetManifest,
      authorization: option("authorize"),
    }, { adapter });
  console.log(JSON.stringify(result));
} catch (error) {
  const result = {
    schema: "agentic-active-dirty-scope-expansion-result/v1",
    status: "blocked",
    error: String(error?.message || error),
  };
  if (!args.includes("--json")) throw error;
  console.log(JSON.stringify(result));
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  const value = args.find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400) {
    throw new Error("--ttl-seconds must be an integer from 60 through 86400.");
  }
  return parsed;
}
