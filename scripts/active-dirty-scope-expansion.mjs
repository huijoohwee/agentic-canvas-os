#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  authorizeActiveDirtyScopeExpansion,
  buildActiveDirtyScopeExpansionPlan,
  normalizeActiveDirtyScopeExpansionPlan,
} from "./active-dirty-scope-expansion-contract.mjs";
import {
  createRepositoryActiveDirtyScopeExpansionAdapter,
  runActiveDirtyScopeExpansion,
} from "./active-dirty-scope-expansion-controller.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { proveLegacyReviewCanonicalDescendant }
  from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  assertCompletedScopeExpansionProjection,
  rolloverCompletedScopeExpansionIntent,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

const RESULT_SCHEMA = "agentic-active-dirty-scope-expansion-result/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export async function activeDirtyScopeExpansionCliMain(argv = process.argv.slice(2), {
  environment = process.env,
  readText = file => readFileSync(file, "utf8"),
  createAdapter = createRepositoryActiveDirtyScopeExpansionAdapter,
  runController = runActiveDirtyScopeExpansion,
  rolloverRepositoryIntent = rolloverRepositoryScopeExpansionIntent,
} = {}) {
  const parsed = parseArguments(argv);
  const targetManifest = normalizeDeclaredWriteScopeManifest(
    JSON.parse(readText(parsed.targetManifestPath)),
  );
  const adapter = createAdapter({
    sourceRepository: parsed.sourceRepository,
    sessionId: parsed.sessionId,
    targetManifest,
    ttlSeconds: parsed.ttlSeconds,
    environment,
  });
  let state = await adapter.readState();
  let prepared = prepareActiveDirtyScopeExpansion({ state, targetManifest });

  if (parsed.command === "plan") return plannedResult(prepared.plan);
  if (prepared.mode === "terminal-replay") {
    return buildCompletedScopeExpansionReplay({ state, plan: prepared.plan });
  }
  if (prepared.mode === "terminal-rollover") {
    authorizeActiveDirtyScopeExpansion({
      plan: prepared.plan,
      authorization: parsed.authorization,
    });
    const authorizedPlanDigest = prepared.plan.planDigest;
    await rolloverRepositoryIntent({
      sourceRepository: parsed.sourceRepository,
      sessionId: parsed.sessionId,
      targetManifest,
      state,
      environment,
    });
    state = await adapter.readState();
    prepared = prepareActiveDirtyScopeExpansion({ state, targetManifest });
    if (prepared.mode !== "fresh" || prepared.plan.planDigest !== authorizedPlanDigest) {
      throw new Error("Scope-expansion source changed after terminal intent rollover.");
    }
  }
  return runController({
    targetManifest,
    authorization: parsed.authorization,
  }, { adapter });
}

export function prepareActiveDirtyScopeExpansion({ state, targetManifest }) {
  const intent = state?.intent || null;
  if (!intent) {
    return Object.freeze({
      mode: "fresh",
      plan: buildFreshPlan({ state, targetManifest }),
    });
  }
  const historicalPlan = normalizeActiveDirtyScopeExpansionPlan(intent.planSnapshot);
  requireIntentPlanBinding(intent, historicalPlan);
  const sameTarget = historicalPlan.targetManifestDigest === targetManifest?.manifestDigest
    && historicalPlan.targetWriteSetDigest === targetManifest?.writeSetDigest;
  if (intent.status !== "complete") {
    if (!sameTarget) {
      throw new Error("Target manifest drifted from the active durable scope-expansion intent.");
    }
    return Object.freeze({ mode: "resume", plan: historicalPlan });
  }
  requireCompletedProjection({ state, intent, plan: historicalPlan });
  if (sameTarget) {
    return Object.freeze({ mode: "terminal-replay", plan: historicalPlan });
  }
  return Object.freeze({
    mode: "terminal-rollover",
    plan: buildFreshPlan({ state, targetManifest }),
  });
}

export function buildCompletedScopeExpansionReplay({ state, plan }) {
  const normalizedPlan = normalizeActiveDirtyScopeExpansionPlan(plan);
  const intent = requireCompletedProjection({
    state,
    intent: state?.intent,
    plan: normalizedPlan,
  });
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "complete",
    replay: true,
    plan: normalizedPlan,
    intent: Object.freeze({ ...intent, intentDigest: digestValue(intent) }),
    receiptDigest: requiredDigest(intent.finalReceiptDigest, "final receipt digest"),
  });
}

export function rolloverRepositoryScopeExpansionIntent({
  sourceRepository,
  sessionId,
  targetManifest,
  state,
  environment = process.env,
  gitText = (repository, args) => execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  }).trim(),
  createStore = createWriterLeaseStore,
  rolloverIntent = rolloverCompletedScopeExpansionIntent,
} = {}) {
  const repository = path.resolve(requiredText(sourceRepository, "source repository"));
  const branch = requiredText(gitText(repository, ["branch", "--show-current"]), "source branch");
  if (branch !== state?.source?.branch) {
    throw new Error("Scope-expansion branch changed before terminal intent rollover.");
  }
  const commonDir = path.resolve(
    repository,
    requiredText(gitText(repository, ["rev-parse", "--git-common-dir"]), "Git common directory"),
  );
  const leaseStore = createStore({
    gitCommonDir: commonDir,
    taskAuthorityFile: environment.AGENTIC_TASK_AUTHORITY_FILE || null,
  });
  const lease = leaseStore.verify({ sessionId, branch });
  const expectedLeaseDigest = writerLeaseDigest(state?.source?.lease);
  const expectedClaimId = requiredDigest(state?.source?.claimId, "source claim ID");
  if (writerLeaseDigest(lease) !== expectedLeaseDigest
    || lease.cloudAuthority?.claimId !== expectedClaimId) {
    throw new Error("Scope-expansion lease changed before terminal intent rollover.");
  }
  return rolloverIntent({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    targetManifestDigest: requiredDigest(targetManifest?.manifestDigest, "target manifest digest"),
    targetWriteSetDigest: requiredDigest(targetManifest?.writeSetDigest, "target write-set digest"),
  });
}

function buildFreshPlan({ state, targetManifest }) {
  return buildActiveDirtyScopeExpansionPlan({
    source: state?.source,
    targetManifest,
    targetCanonicalBaseSha: state?.targetCanonicalBaseSha,
    canonicalDescendantProof: rebindCanonicalDescendantProof({
      proof: state?.canonicalDescendantProof,
      targetManifest,
    }),
  });
}

function rebindCanonicalDescendantProof({ proof, targetManifest }) {
  if (!proof) return null;
  return proveLegacyReviewCanonicalDescendant({
    sourceBaseSha: proof.sourceBaseSha,
    targetBaseSha: proof.targetBaseSha,
    protectedMainSha: proof.protectedMainSha,
    canonicalChangedPaths: proof.canonicalChangedPaths,
    preservedChangedPaths: targetManifest.declaredWriteSet
      .filter(value => value.startsWith("path:"))
      .map(value => value.slice("path:".length)),
    sourceIsAncestor: proof.ancestry === "source-base-to-current-protected-main",
    targetIsProtectedAncestor: proof.targetBaseSha === proof.protectedMainSha,
  });
}

function requireCompletedProjection({ state, intent, plan }) {
  if (!intent || intent.status !== "complete") {
    throw new Error("Scope-expansion terminal intent is not complete.");
  }
  requireIntentPlanBinding(intent, plan);
  for (const field of [
    "waitingReceiptDigest",
    "sourceRetirementReceiptDigest",
    "promotedReceiptDigest",
    "boundReceiptDigest",
    "localProjectionReceiptDigest",
    "pullRequestProjectionReceiptDigest",
    "finalReceiptDigest",
    "targetClaimId",
    "targetClaimDigest",
  ]) requiredDigest(intent[field], `terminal intent ${field}`);
  const lease = state?.source?.lease;
  assertCompletedScopeExpansionProjection({
    intent,
    lease,
    expectedLeaseDigest: writerLeaseDigest(lease),
    expectedClaimId: lease?.cloudAuthority?.claimId,
  });
  return intent;
}

function requireIntentPlanBinding(intent, plan) {
  if (intent?.planDigest !== plan.planDigest
    || intent.targetManifestDigest !== plan.targetManifestDigest
    || intent.targetWriteSetDigest !== plan.targetWriteSetDigest
    || intent.sourceLeaseDigest !== plan.sourceLeaseDigest
    || intent.sourceClaimId !== plan.sourceClaimId) {
    throw new Error("Scope-expansion intent drifted from its durable plan snapshot.");
  }
}

function plannedResult(plan) {
  return Object.freeze({
    schema: "agentic-active-dirty-scope-expansion-plan-result/v1",
    status: "planned",
    plan,
    exactAuthorization: `authorize scope-expansion ${plan.planDigest}`,
  });
}

function parseArguments(argv) {
  const [command = "plan", ...args] = argv;
  if (!["plan", "execute"].includes(command)) {
    throw new Error("Usage: active-dirty-scope-expansion.mjs plan|execute --source-repository=<path> --target-manifest=<path> --session=<id> [--authorize=<exact text>] [--ttl-seconds=28800] [--json]");
  }
  const option = name => {
    const prefix = `--${name}=`;
    const value = args.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : null;
  };
  const requiredOption = name => {
    const value = option(name);
    if (!value) throw new Error(`--${name}=... is required.`);
    return value;
  };
  return Object.freeze({
    command,
    sourceRepository: requiredOption("source-repository"),
    sessionId: requiredOption("session"),
    targetManifestPath: requiredOption("target-manifest"),
    authorization: option("authorize"),
    ttlSeconds: option("ttl-seconds") === null ? 28_800 : positiveInteger(option("ttl-seconds")),
  });
}

function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400) {
    throw new Error("--ttl-seconds must be an integer from 60 through 86400.");
  }
  return parsed;
}

async function runDirectly() {
  const argv = process.argv.slice(2);
  try {
    console.log(JSON.stringify(await activeDirtyScopeExpansionCliMain(argv)));
  } catch (error) {
    const result = { schema: RESULT_SCHEMA, status: "blocked", error: String(error?.message || error) };
    if (!argv.includes("--json")) throw error;
    console.log(JSON.stringify(result));
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runDirectly();
}
