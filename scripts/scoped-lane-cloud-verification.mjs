import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { markOperationDerivedCloudVerification } from "./scoped-lane-admission-lib.mjs";
import {
  normalizeCurrentClaimInventory,
  positiveInteger,
  reconcileCloudAuthorityProjection,
  requireAuthority,
  requiredDigest,
  requiredInstant,
  requiredText,
  requireReadyResult,
  rootStateForProjection,
} from "./scoped-lane-cloud-reconciliation.mjs";

const CLOUD_SCRIPT = fileURLToPath(
  new URL("./cloud-collaboration.mjs", import.meta.url),
);

export function verifyAdmissionCloudAuthority({
  authority,
  manifest,
  canonicalBaseSha,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority,
    manifest,
    canonicalBaseSha,
    environment,
    inspect,
    invoke,
    expectedState: "active",
  });
}

export function verifyReviewReadyAdmissionCloudAuthority({
  authority,
  manifest,
  headSha = authority?.laneRevision,
  branch = null,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority,
    manifest,
    canonicalBaseSha: authority?.canonicalBaseSha,
    expectedState: "review_ready",
    expectedLaneRevision: headSha,
    branch,
    focusedEvidenceDigest: requiredDigest(
      focusedEvidenceDigest,
      "focusedEvidenceDigest",
    ),
    environment,
    inspect,
    invoke,
  });
}

export function verifyDeliveryAuthorizedCloudAuthority({
  authority,
  manifest,
  headSha = authority?.laneRevision,
  branch = null,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority,
    manifest,
    canonicalBaseSha: authority?.canonicalBaseSha,
    expectedState: "delivery_authorized",
    expectedLaneRevision: headSha,
    branch,
    focusedEvidenceDigest: requiredDigest(
      focusedEvidenceDigest,
      "focusedEvidenceDigest",
    ),
    environment,
    inspect,
    invoke,
  });
}

export function reconcileAdmissionCloudAuthority({
  authority,
  manifest,
  branch,
  headSha,
  pullRequestNumber,
  allowPriorLaneRevision = false,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  requireAuthority(authority);
  const statusResult = inspect({
    action: "status",
    ledgerRepository: authority?.ledgerRepository,
    request: { targetRepository: authority?.targetRepository },
    environment,
  });
  const reconciled = reconcileCloudAuthorityProjection({
    authority,
    manifest,
    statusResult,
    branch,
    headSha,
    pullRequestNumber,
    allowPriorLaneRevision,
  });
  const verifiesCurrentPullRequestHead = (
    reconciled.authority.laneRevision === headSha
  );
  return verifyCloudAuthorityState({
    authority: reconciled.authority,
    manifest,
    canonicalBaseSha: reconciled.authority.canonicalBaseSha,
    expectedState: reconciled.authority.state,
    expectedLaneRevision: reconciled.authority.laneRevision,
    branch: verifiesCurrentPullRequestHead ? branch : null,
    focusedEvidenceDigest: reconciled.focusedEvidenceDigest,
    pullRequestNumber: verifiesCurrentPullRequestHead ? pullRequestNumber : null,
    environment,
    inspect,
    invoke: verify,
  });
}

export function verifyCloudAuthorityState({
  authority,
  manifest,
  canonicalBaseSha,
  expectedState,
  expectedLaneRevision = authority?.laneRevision,
  focusedEvidenceDigest = null,
  pullRequestNumber = null,
  branch = null,
  environment = process.env,
  inspect,
  invoke,
}) {
  requireAuthority(authority);
  if (typeof inspect !== "function" || typeof invoke !== "function") {
    throw new Error("Cloud verification requires repository status and verification adapters.");
  }
  const inventoryResult = inspect({
    action: "status",
    ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository },
    environment,
  });
  const result = invoke({
    ledgerRepository: authority.ledgerRepository,
    request: {
      targetRepository: authority.targetRepository,
      claimId: authority.claimId,
      canonicalBaseSha,
      headSha: expectedLaneRevision,
      writeSetDigest: manifest.writeSetDigest,
      leaseEpoch: authority.leaseEpoch,
      expectedFenceRevision: authority.claimDigest,
      expectedLedgerRevision: authority.ledgerRevision,
      requiredState: rootStateForProjection(expectedState),
      ...(authority.reviewRequestId
        ? { reviewRequestId: authority.reviewRequestId }
        : {}),
      ...(pullRequestNumber
        ? {
          pullRequestNumber: positiveInteger(
            pullRequestNumber,
            "pullRequestNumber",
          ),
        }
        : {}),
      ...(branch ? { branch: requiredText(branch, "branch") } : {}),
      ...(focusedEvidenceDigest ? { focusedEvidenceDigest } : {}),
    },
    environment,
  });
  const inventory = normalizeCurrentClaimInventory({
    inventoryResult,
    verificationResult: result,
    authority,
  });
  deepFreeze(inventory);
  requireReadyResult(result, {
    authority,
    manifest,
    canonicalBaseSha,
    expectedState,
    expectedLaneRevision,
  });
  const verifiedAuthority = deepFreeze(structuredClone({
    ...authority,
    claimDigest: result.claimDigest,
    ledgerRevision: result.ledgerRevision,
    ledgerDigest: inventory.ledgerDigest,
    claimLedgerRevision: requiredDigest(
      result.claim.transitionDigest,
      "claim ledger revision",
    ),
    transitionCounter: result.claim.transitionCounter,
    state: expectedState,
    expiresAt: result.claim.expiresAt,
    reviewRequestId: result.claim.reviewRequestId || null,
    ...(focusedEvidenceDigest ? { focusedEvidenceDigest } : {}),
  }));
  const verification = deepFreeze({
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    claimId: verifiedAuthority.claimId,
    claimDigest: verifiedAuthority.claimDigest,
    ledgerRevision: verifiedAuthority.ledgerRevision,
    ledgerDigest: inventory.ledgerDigest,
    canonicalBaseSha,
    laneRevision: verifiedAuthority.laneRevision,
    writeSetDigest: manifest.writeSetDigest,
    reviewRequestId: verifiedAuthority.reviewRequestId,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    inventory,
    receiptDigest: requiredDigest(
      result.receipt?.receiptDigest,
      "verification receipt digest",
    ),
    verifiedAt: requiredInstant(
      result.receipt?.evaluationTime,
      "verification time",
    ),
  });
  return deepFreeze({
    authority: verifiedAuthority,
    verification: markOperationDerivedCloudVerification(verification),
  });
}

export function invokeRepositoryCloudAction({
  action,
  ledgerRepository,
  request,
  environment = process.env,
} = {}) {
  const childEnvironment = { ...environment };
  delete childEnvironment.NODE_OPTIONS;
  delete childEnvironment.NODE_PATH;
  const result = spawnSync(process.execPath, [
    CLOUD_SCRIPT,
    action,
    `--ledger-repository=${ledgerRepository}`,
    `--request-json=${JSON.stringify(request)}`,
    "--json",
  ], {
    encoding: "utf8",
    env: childEnvironment,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  const output = parseResult(result.stdout);
  if (result.error || result.status !== 0) {
    const message = output?.error?.message || result.error?.message || result.stderr;
    throw new Error(
      `Cloud collaboration ${action} failed: ${publicMessage(message)}`,
    );
  }
  return output;
}

function parseResult(stdout) {
  const line = String(stdout || "").trim().split(/\r?\n/u).reverse()
    .find(candidate => candidate.trim().startsWith("{"));
  if (!line) throw new Error("Cloud collaboration command returned no JSON result.");
  return JSON.parse(line);
}

function publicMessage(value) {
  return String(value || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
