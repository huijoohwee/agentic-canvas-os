#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  authorizeScopeExpansionLineageMigration,
  buildScopeExpansionLineageAdmission,
  buildScopeExpansionLineageMigrationPlan,
  buildScopeExpansionLineageReceipt,
  normalizeScopeExpansionLineageMigrationPlan,
  sanitizeCloudAuthorityDiagnostic,
  SCOPE_EXPANSION_LINEAGE_EXECUTION_INTENT_SCHEMA,
  verifyMigratedScopeExpansionLineage,
  verifyScopeExpansionLineageMigrationPlan,
} from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import {
  continueExpiredReviewLaneAuthority,
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "./cloud-authority-handoff-controller.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  DEFAULT_LEDGER_PATH,
  DEFAULT_LEDGER_REF,
} from "./github-cloud-collaboration-adapter.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";
import { textCommandOptions } from "./command-text-options.mjs";

export const SCOPE_EXPANSION_LINEAGE_RESULT_SCHEMA =
  "agentic-cloud-authority-scope-expansion-lineage-result/v1";

export function githubLedgerCommandOptions(repository) {
  return textCommandOptions({
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function createScopeExpansionLineageMigrationAdapter(methods = {}) {
  const adapter = Object.freeze({
    readLane: methods.readLane,
    readActor: methods.readActor,
    readStatus: methods.readStatus,
    readLedger: methods.readLedger,
    continueAuthority: methods.continueAuthority,
  });
  for (const [name, method] of Object.entries(adapter)) {
    if (typeof method !== "function") throw new Error(`Lineage migration adapter requires ${name}().`);
  }
  return adapter;
}

export async function runScopeExpansionLineageMigration(input = {}, { adapter } = {}) {
  if (!adapter) throw new Error("Lineage migration adapter is required.");
  const mode = requiredMode(input.mode);
  const branch = requiredDeviceBranch(input.branch).branch;
  const observed = await readEvidence(adapter, branch);
  if (mode === "plan") {
    const plan = buildScopeExpansionLineageMigrationPlan(observed);
    const receipt = buildScopeExpansionLineageReceipt("plan", {
      planDigest: plan.planDigest,
      legacyClaimId: plan.legacyClaimId,
      sourceClaimId: plan.sourceClaimId,
      targetGenesisEntryDigest: plan.targetGenesisEntryDigest,
      sourceRetirementEntryDigest: plan.sourceRetirementEntryDigest,
      observedLedgerRevision: plan.observedLedgerRevision,
      observedLedgerDigest: plan.observedLedgerDigest,
    });
    return finalizeResult({
      mode,
      outcome: "planned",
      plan,
      receipts: [receipt],
    });
  }

  const plan = normalizeScopeExpansionLineageMigrationPlan(input.plan);
  const verified = verifyScopeExpansionLineageMigrationPlan({ plan, ...observed });
  const reclaimOwner = requireSameOwnerReclaim({ input, lane: observed.lane });
  const ttlSeconds = positiveInteger(input.ttlSeconds ?? 1_800, "TTL seconds");
  const executionIntent = buildExecutionIntent({
    plan, branch, sessionId: reclaimOwner.sessionId,
    successorSessionId: reclaimOwner.sessionId,
    successorDeviceId: reclaimOwner.deviceId, ttlSeconds,
  });
  const authorization = authorizeScopeExpansionLineageMigration({
    plan, authorization: input.authorization, executionIntent,
  });
  const authorizationReceipt = buildScopeExpansionLineageReceipt("authorization", {
    planDigest: plan.planDigest,
    authorizationDigest: authorization.authorizationDigest,
  });
  if (verified.state === "migrated") {
    const migratedReceipt = verifyMigratedScopeExpansionLineage({
      plan,
      lane: observed.lane,
      status: observed.status,
    });
    return finalizeResult({
      mode,
      outcome: "already-migrated",
      plan,
      successorClaimId: migratedReceipt.payload.successorClaimId,
      receipts: [authorizationReceipt, migratedReceipt],
    });
  }

  const admission = buildScopeExpansionLineageAdmission({
    verified, authorization, executionIntent,
    lane: observed.lane,
    status: observed.status,
  });
  const request = {
    transition: "reclaim",
    branch: plan.branch,
    sessionId: reclaimOwner.sessionId,
    successorSessionId: reclaimOwner.sessionId,
    successorDeviceId: reclaimOwner.deviceId,
    ttlSeconds,
  };
  const continued = await adapter.continueAuthority({ request, lineageAdmission: admission });
  if (
    continued?.schema !== "agentic-cloud-authority-handoff-controller-result/v1"
    || !["reclaimed-live", "reclaimed-live-replay"].includes(continued.outcome)
    || continued.predecessorClaimId !== plan.legacyClaimId
    || continued.successorLeaseEpoch !== plan.successorLeaseEpoch
  ) {
    throw new Error("Lineage migration did not produce the exact standard epoch-2 continuation.");
  }
  const finalObserved = await readEvidence(adapter, plan.branch);
  verifyScopeExpansionLineageMigrationPlan({ plan, ...finalObserved });
  const migratedReceipt = verifyMigratedScopeExpansionLineage({
    plan,
    lane: finalObserved.lane,
    status: finalObserved.status,
  });
  const continuationReceipt = buildScopeExpansionLineageReceipt("continuation", {
    planDigest: plan.planDigest,
    admissionDigest: admission.admissionDigest,
    handoffResultDigest: requiredDigest(continued.resultDigest, "handoff result digest"),
    predecessorClaimId: continued.predecessorClaimId,
    successorClaimId: continued.successorClaimId,
    successorLeaseEpoch: continued.successorLeaseEpoch,
  });
  return finalizeResult({
    mode,
    outcome: "migrated-live",
    plan,
    successorClaimId: continued.successorClaimId,
    receipts: [authorizationReceipt, admission, continuationReceipt, migratedReceipt],
  });
}

export function createRepositoryScopeExpansionLineageMigrationAdapter({
  repository,
  sessionId,
  environment = process.env,
  gitText = null,
  ghText = null,
  handoffAdapter = null,
} = {}) {
  const repoRoot = realpathSync(path.resolve(requiredText(repository, "repository")));
  const repositoryGitText = gitText || (args => execFileSync("git", args, {
    cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
  const repositoryGhText = ghText || (args => execFileSync(
    "gh",
    args,
    githubLedgerCommandOptions(repoRoot),
  ));
  const owner = handoffAdapter || createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: repoRoot,
    sessionId: requiredText(sessionId, "session ID"),
    environment,
    gitText: repositoryGitText,
    ghText: repositoryGhText,
    resolveRealpath: value => value,
  });
  return createScopeExpansionLineageMigrationAdapter({
    readLane: ({ branch }) => owner.readPreservedReviewLane({ branch }),
    readActor: () => owner.readAuthenticatedOwner(),
    readStatus: ({ lane }) => owner.readCloudStatus({
      ledgerRepository: lane.authority.ledgerRepository,
      targetRepository: lane.authority.targetRepository,
    }),
    readLedger: ({ lane }) => readGitHubLedger({
      ledgerRepository: lane.authority.ledgerRepository,
      ghText: repositoryGhText,
    }),
    continueAuthority: ({ request, lineageAdmission }) => continueExpiredReviewLaneAuthority(
      request,
      { adapter: owner, lineageAdmission },
    ),
  });
}

async function readEvidence(adapter, branch) {
  const lane = await adapter.readLane({ branch: requiredText(branch, "branch") });
  const actor = await adapter.readActor();
  const status = await adapter.readStatus({ lane });
  const ledger = await adapter.readLedger({ lane, status });
  return Object.freeze({ lane, actor, status, ledger });
}

function readGitHubLedger({ ledgerRepository, ghText }) {
  const repository = requiredRepository(ledgerRepository);
  const metadata = JSON.parse(ghText([
    "api",
    `repos/${repository}/contents/${DEFAULT_LEDGER_PATH}?ref=${encodeURIComponent(DEFAULT_LEDGER_REF)}`,
  ]));
  let content = metadata.content;
  if (!content) {
    const blobSha = requiredSha(metadata.sha, "ledger blob SHA");
    content = JSON.parse(ghText(["api", `repos/${repository}/git/blobs/${blobSha}`])).content;
  }
  if (!content) throw new Error("Cloud collaboration ledger content is unavailable.");
  return JSON.parse(Buffer.from(String(content).replaceAll("\n", ""), "base64").toString("utf8"));
}

function finalizeResult({ mode, outcome, plan, successorClaimId = null, receipts }) {
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_RESULT_SCHEMA,
    mode,
    outcome,
    plan,
    planDigest: plan.planDigest,
    predecessorClaimId: plan.legacyClaimId,
    successorClaimId,
    successorLeaseEpoch: successorClaimId ? plan.successorLeaseEpoch : null,
    receipts,
  };
  return Object.freeze({ ...core, resultDigest: digestValue(core) });
}

function parsePlan(argumentsList) {
  const inline = option(argumentsList, "plan-json");
  const planFile = option(argumentsList, "plan-file");
  if (!inline && !planFile) throw new Error("execute requires --plan-json or --plan-file.");
  const parsed = JSON.parse(inline || readFileSync(path.resolve(planFile), "utf8"));
  return parsed.plan || parsed;
}

function option(argumentsList, name) {
  const prefix = `--${name}=`;
  const inline = argumentsList.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : "";
}

function requiredMode(value) {
  const mode = requiredText(value, "mode");
  if (!["plan", "execute"].includes(mode)) throw new Error("mode must be plan or execute.");
  return mode;
}

function requiredDeviceBranch(value) {
  const identity = parseDeviceBranch(requiredText(value, "branch"));
  if (!identity) throw new Error("branch must use the canonical agent/device/scope form.");
  return identity;
}

function requiredRepository(value) {
  const repository = requiredText(value, "ledger repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("ledger repository must be an owner/name identifier.");
  }
  return repository;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} must be a 40-character SHA.`);
  return sha;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}

function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) throw new Error(`${label} must be a positive integer.`);
  return integer;
}

function buildExecutionIntent({
  plan, branch, sessionId, successorSessionId, successorDeviceId, ttlSeconds,
}) {
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_EXECUTION_INTENT_SCHEMA,
    planDigest: plan.planDigest, transition: "reclaim", branch, sessionId,
    successorSessionId, successorDeviceId, ttlSeconds,
  };
  if (branch !== plan.branch) throw new Error("Execution intent branch drifted from its plan.");
  return Object.freeze({ ...core, executionIntentDigest: digestValue(core) });
}

function requireSameOwnerReclaim({ input, lane }) {
  const leaseSessionId = requiredText(lane?.lease?.sessionId, "preserved lease session ID");
  const leaseDeviceId = requiredText(lane?.lease?.device, "preserved lease device ID");
  const sessionId = requiredText(input.sessionId, "session ID");
  const successorSessionId = requiredText(
    input.successorSessionId || input.sessionId,
    "successor session ID",
  );
  const successorDeviceId = requiredText(input.successorDeviceId, "successor device ID");
  if (
    sessionId !== leaseSessionId
    || successorSessionId !== leaseSessionId
    || successorDeviceId !== leaseDeviceId
  ) {
    throw new Error(
      "Lineage migration permits only same-owner reclaim to the exact preserved lease session and device.",
    );
  }
  return Object.freeze({ sessionId: leaseSessionId, deviceId: leaseDeviceId });
}

async function main() {
  const [mode, ...argumentsList] = process.argv.slice(2);
  const json = argumentsList.includes("--json");
  try {
    const branchIdentity = requiredDeviceBranch(option(argumentsList, "branch"));
    const repository = path.resolve(option(argumentsList, "repository")
      || execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
    const sessionId = option(argumentsList, "session");
    const device = option(argumentsList, "successor-device") || branchIdentity.device;
    const adapter = createRepositoryScopeExpansionLineageMigrationAdapter({
      repository,
      sessionId,
      environment: process.env,
    });
    const result = await runScopeExpansionLineageMigration({
      mode,
      branch: branchIdentity.branch,
      sessionId,
      successorSessionId: option(argumentsList, "successor-session") || sessionId,
      successorDeviceId: device,
      ttlSeconds: option(argumentsList, "ttl-seconds") || 1_800,
      authorization: option(argumentsList, "authorize"),
      plan: mode === "execute" ? parsePlan(argumentsList) : null,
    }, { adapter });
    process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
  } catch (error) {
    if (!json) throw error;
    process.stdout.write(`${JSON.stringify({
      schema: SCOPE_EXPANSION_LINEAGE_RESULT_SCHEMA,
      mode: mode || null,
      outcome: "blocked",
      error: { message: sanitizeCloudAuthorityDiagnostic(error) },
    })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
