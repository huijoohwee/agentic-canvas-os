import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import {
  LANE_CLOUD_AUTHORITY_SCHEMA,
  markOperationDerivedCloudVerification,
  normalizeCloudAuthority,
} from "./scoped-lane-admission-lib.mjs";
import {
  normalizeCurrentClaimInventory,
  reconcileCloudAuthorityProjection,
} from "./scoped-lane-cloud-reconciliation.mjs";
const CLOUD_SCRIPT = fileURLToPath(
  new URL("./cloud-collaboration.mjs", import.meta.url),
);
const CLOUD_RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function attachCloudHeartbeatMachineEvidence(response, { lease, result } = {}) {
  if (!result?.mutationAuthorityReceipt) return response;
  if (!lease?.admission || !lease.cloudAuthority) {
    throw new Error("Cloud heartbeat lost its joined admission projection.");
  }
  response.admission = lease.admission;
  response.cloudAuthority = lease.cloudAuthority;
  response.mutationAuthorityReceipt = result.mutationAuthorityReceipt;
  return response;
}

export function verifyAdmissionCloudAuthority({
  authority,
  manifest,
  canonicalBaseSha,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority, manifest, canonicalBaseSha, environment, inspect, invoke,
    expectedState: "active",
  });
}

export function verifyReviewReadyAdmissionCloudAuthority({
  authority, manifest,
  headSha = authority?.laneRevision,
  branch = null,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority, manifest,
    canonicalBaseSha: authority?.canonicalBaseSha,
    expectedState: "review_ready",
    expectedLaneRevision: headSha,
    branch,
    focusedEvidenceDigest: requiredDigest(focusedEvidenceDigest, "focusedEvidenceDigest"),
    environment, inspect, invoke,
  });
}

export function reconcileAdmissionCloudAuthority({
  authority, manifest, branch, headSha, pullRequestNumber,
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
    authority, manifest, statusResult, branch, headSha, pullRequestNumber,
    allowPriorLaneRevision,
  });
  return verifyCloudAuthorityState({
    authority: reconciled.authority,
    manifest,
    canonicalBaseSha: reconciled.authority.canonicalBaseSha,
    expectedState: reconciled.authority.state,
    expectedLaneRevision: reconciled.authority.laneRevision,
    branch,
    focusedEvidenceDigest: reconciled.focusedEvidenceDigest,
    pullRequestNumber,
    environment, inspect, invoke: verify,
  });
}

function verifyCloudAuthorityState({
  authority, manifest, canonicalBaseSha, expectedState,
  expectedLaneRevision = authority?.laneRevision,
  focusedEvidenceDigest = null,
  pullRequestNumber = null,
  branch = null,
  environment, inspect, invoke,
}) {
  requireAuthority(authority);
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
      requiredState: expectedState,
      ...(authority.reviewRequestId
        ? { reviewRequestId: authority.reviewRequestId }
        : {}),
      ...(pullRequestNumber
        ? { pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber") }
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
  requireReadyResult(result, {
    authority,
    manifest,
    canonicalBaseSha,
    expectedState,
    expectedLaneRevision,
  });
  const verifiedAuthority = Object.freeze({
    ...authority,
    claimDigest: result.claimDigest,
    ledgerRevision: result.ledgerRevision,
    claimLedgerRevision: requiredDigest(
      result.claim.transitionDigest,
      "claim ledger revision",
    ),
    transitionCounter: result.claim.transitionCounter,
    state: expectedState,
    expiresAt: result.claim.expiresAt,
    reviewRequestId: result.claim.reviewRequestId || null,
    ...(focusedEvidenceDigest ? { focusedEvidenceDigest } : {}),
  });
  const verification = Object.freeze({
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
  return {
    authority: verifiedAuthority,
    verification: markOperationDerivedCloudVerification(verification),
  };
}

export function bindAdmissionCloudAuthority({
  authority, manifest, branch, headSha, pullRequestNumber, deviceId, sessionId,
  idempotencyKey = `device-start-bind:${authority?.claimId}`,
  returnVerification = false,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  requireAuthority(authority);
  const request = {
    targetRepository: authority.targetRepository,
    pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber"),
    branch: requiredText(branch, "branch"),
    canonicalBaseSha: authority.canonicalBaseSha,
    headSha: requiredSha(headSha, "headSha"),
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    claimId: authority.claimId,
    expectedFenceRevision: authority.claimDigest,
    expectedTransitionCounter: authority.transitionCounter,
    idempotencyKey: requiredText(idempotencyKey, "idempotencyKey"),
  };
  let result;
  try {
    result = invoke({
      action: "bind",
      ledgerRepository: authority.ledgerRepository,
      request,
      environment,
    });
  } catch (originalError) {
    try {
      const recovered = reconcileAdmissionCloudAuthority({
        authority, manifest, branch: request.branch, headSha: request.headSha,
        pullRequestNumber: request.pullRequestNumber, environment, inspect,
        verify,
      });
      if (recovered.authority.state !== "active") {
        throw new Error("Recovered bind is not active.");
      }
      return returnVerification ? recovered : recovered.authority;
    } catch (recoveryError) {
      throw new Error(
        `${originalError.message}; exact live bind reconciliation failed: ${recoveryError.message}`,
        { cause: originalError },
      );
    }
  }
  requireReadyResult(result, {
    authority,
    manifest,
    canonicalBaseSha: authority.canonicalBaseSha,
    expectedState: "active",
    expectedLaneRevision: headSha,
  });
  const bound = normalizeBoundAuthority({
    result,
    authority,
    manifest,
    deviceId,
    sessionId,
  });
  const verified = verifyAdmissionCloudAuthority({
    authority: bound,
    manifest,
    canonicalBaseSha: bound.canonicalBaseSha,
    environment,
    inspect,
    invoke: verify,
  });
  return returnVerification ? verified : verified.authority;
}

export function heartbeatAdmissionCloudAuthority({
  authority,
  deviceId,
  sessionId,
  ttlSeconds,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  requireAuthority(authority);
  const result = invoke({
    action: "heartbeat",
    ledgerRepository: authority.ledgerRepository,
    request: {
      targetRepository: authority.targetRepository,
      deviceId: requiredText(deviceId, "deviceId"),
      sessionId: requiredText(sessionId, "sessionId"),
      claimId: authority.claimId,
      expectedFenceRevision: authority.claimDigest,
      expectedTransitionCounter: authority.transitionCounter,
      ttlSeconds: positiveInteger(ttlSeconds, "ttlSeconds"),
      idempotencyKey: [
        "device-heartbeat",
        authority.claimId,
        authority.transitionCounter,
        authority.claimDigest,
      ].join(":"),
    },
    environment,
  });
  requireReadyResult(result, {
    authority,
    manifest: {
      declaredWriteSet: authority.cloudDeclaredWriteScope,
      writeSetDigest: authority.writeSetDigest,
    },
    canonicalBaseSha: authority.canonicalBaseSha,
    expectedState: "active",
    expectedLaneRevision: authority.laneRevision,
  });
  const renewed = normalizeBoundAuthority({
    result,
    authority,
    manifest: {
      declaredWriteSet: authority.cloudDeclaredWriteScope,
      writeSetDigest: authority.writeSetDigest,
    },
    deviceId,
    sessionId,
  });
  return verifyAdmissionCloudAuthority({
    authority: renewed,
    manifest: {
      declaredWriteSet: authority.cloudDeclaredWriteScope,
      writeSetDigest: authority.writeSetDigest,
    },
    canonicalBaseSha: authority.canonicalBaseSha,
    environment,
    inspect,
    invoke: verify,
  });
}

export function reviewReadyAdmissionCloudAuthority({
  authority, manifest, branch, headSha, pullRequestNumber, deviceId, sessionId,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  const evidenceDigest = digestValue({
    schema: "agentic-focused-review-evidence/v1",
    command: "npm run check",
    branch: requiredText(branch, "branch"),
    headSha: requiredSha(headSha, "headSha"),
    pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber"),
    admittedReportDigest: requiredDigest(manifest?.admittedReportDigest, "admittedReportDigest"),
  });
  let current = reconcileAdmissionCloudAuthority({
    authority, manifest, branch, headSha, pullRequestNumber,
    allowPriorLaneRevision: true, environment, inspect, verify,
  });
  if (current.authority.state === "review_ready") return current;
  if (current.authority.laneRevision !== headSha) {
    current = bindAdmissionCloudAuthority({
      authority: current.authority, manifest, branch, headSha,
      pullRequestNumber, deviceId, sessionId, environment, invoke, inspect,
      verify, returnVerification: true,
      idempotencyKey: [
        "device-review-bind", current.authority.claimId,
        current.authority.transitionCounter, current.authority.claimDigest, headSha,
      ].join(":"),
    });
  }
  const active = current.authority;
  const request = {
    targetRepository: active.targetRepository,
    pullRequestNumber,
    branch,
    canonicalBaseSha: active.canonicalBaseSha,
    headSha,
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    claimId: active.claimId,
    expectedFenceRevision: active.claimDigest,
    expectedTransitionCounter: active.transitionCounter,
    focusedEvidenceDigest: evidenceDigest,
    idempotencyKey: [
      "device-review-ready", active.claimId, active.transitionCounter,
      active.claimDigest, headSha, evidenceDigest,
    ].join(":"),
  };
  let result;
  try {
    result = invoke({
      action: "review-ready",
      ledgerRepository: active.ledgerRepository,
      request,
      environment,
    });
  } catch (originalError) {
    try {
      const recovered = reconcileAdmissionCloudAuthority({
        authority: active, manifest, branch, headSha, pullRequestNumber,
        environment, inspect, verify,
      });
      if (recovered.authority.state !== "review_ready") {
        throw new Error("Recovered claim is not review-ready.");
      }
      return recovered;
    } catch (recoveryError) {
      throw new Error(
        `${originalError.message}; exact live review-ready reconciliation failed: ${recoveryError.message}`,
        { cause: originalError },
      );
    }
  }
  requireReadyResult(result, {
    authority: active, manifest, canonicalBaseSha: active.canonicalBaseSha,
    expectedState: "review_ready", expectedLaneRevision: headSha,
  });
  const ready = normalizeBoundAuthority({
    result, authority: active, manifest, deviceId, sessionId,
    focusedEvidenceDigest: evidenceDigest,
  });
  return verifyReviewReadyAdmissionCloudAuthority({
    authority: ready, manifest, headSha, branch,
    focusedEvidenceDigest: evidenceDigest,
    environment, inspect, invoke: verify,
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
    throw new Error(`Cloud collaboration ${action} failed: ${publicMessage(message)}`);
  }
  return output;
}

export function cloudAuthorityFromResult(source, options) {
  return normalizeCloudAuthority(source, options);
}

function normalizeBoundAuthority({
  result, authority, manifest,
  deviceId = authority.deviceId,
  sessionId = authority.sessionId,
  focusedEvidenceDigest = authority.focusedEvidenceDigest || null,
}) {
  return Object.freeze({
    schema: LANE_CLOUD_AUTHORITY_SCHEMA,
    provider: "github",
    ledgerRepository: authority.ledgerRepository,
    targetRepository: authority.targetRepository,
    claimId: requiredDigest(result.claim.claimId, "claimId"),
    claimDigest: requiredDigest(result.claimDigest, "claimDigest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "ledgerRevision"),
    claimLedgerRevision: requiredDigest(
      result.claim.transitionDigest,
      "claimLedgerRevision",
    ),
    canonicalBaseSha: requiredSha(
      result.claim.canonicalBaseRevision,
      "canonicalBaseRevision",
    ),
    laneRevision: requiredSha(result.claim.laneRevision, "laneRevision"),
    cloudDeclaredWriteScope: normalizeWriteSet(
      result.claim.declaredWriteScope,
    ),
    writeSetDigest: requiredDigest(
      result.claim.writeSetDigest,
      "writeSetDigest",
    ),
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    reviewRequestId: result.claim.reviewRequestId
      ? requiredText(result.claim.reviewRequestId, "reviewRequestId")
      : null,
    leaseEpoch: positiveInteger(result.claim.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(
      result.claim.transitionCounter,
      "transitionCounter",
    ),
    state: String(result.claim.state || "").replaceAll("-", "_"),
    expiresAt: requiredInstant(result.claim.expiresAt, "expiresAt"),
    ...(focusedEvidenceDigest ? {
      focusedEvidenceDigest: requiredDigest(
        focusedEvidenceDigest,
        "focusedEvidenceDigest",
      ),
    } : {}),
    manifestDigest: manifest.manifestDigest || digestValue({
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
    }),
  });
}

function requireReadyResult(result, {
  authority, manifest, canonicalBaseSha, expectedState,
  expectedLaneRevision = authority.laneRevision,
}) {
  if (
    !result
    || result.schema !== CLOUD_RESULT_SCHEMA
    || result.ok !== true
    || !["verify", "bind", "heartbeat", "review-ready"].includes(result.action)
  ) {
    throw new Error("Cloud collaboration did not return a successful authoritative result.");
  }
  const claim = result.claim;
  if (
    claim?.claimId !== authority.claimId
    || claim.canonicalBaseRevision !== canonicalBaseSha
    || claim.laneRevision !== expectedLaneRevision
    || String(claim.state || "").replaceAll("-", "_") !== expectedState
    || claim.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(manifest.declaredWriteSet)
    || !Array.isArray(result.findings || [])
    || (result.findings || []).length > 0
  ) {
    throw new Error("Cloud collaboration result drifted from the scoped admission subject.");
  }
  requiredSha(result.ledgerRevision, "ledgerRevision");
  requiredDigest(result.claimDigest, "claimDigest");
  if (Date.parse(claim.expiresAt) <= Date.now()) {
    throw new Error(`Cloud collaboration claim expired at ${claim.expiresAt}.`);
  }
}

function requireAuthority(value) {
  if (!value || value.schema !== LANE_CLOUD_AUTHORITY_SCHEMA)
    throw new Error("A normalized lane cloud authority projection is required.");
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
function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a Git SHA.`);
  return normalized;
}
function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}
function requiredInstant(value, label) {
  const normalized = requiredText(value, label);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO instant.`);
  return new Date(milliseconds).toISOString();
}
function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return normalized;
}
