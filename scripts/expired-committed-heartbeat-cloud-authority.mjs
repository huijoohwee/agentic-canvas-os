// Responsibility: Continue one expired committed lane through exact renewal or dormant recovery.
import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import {
  heartbeatAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  normalizeBoundAuthority,
  requireReadyResult,
  requiredDigest,
  requiredSha,
  requiredText,
} from "./scoped-lane-cloud-reconciliation.mjs";
import { resolveExpiredCommittedRecoveryReplayEvidence } from
  "./expired-committed-heartbeat-replay-evidence.mjs";

export const EXPIRED_COMMITTED_CLOUD_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-expired-committed-heartbeat-cloud-recovery-evidence/v1";

export function preserveSourceManifestProjection(source, renewed) {
  return renewed?.manifestDigest === source?.manifestDigest ? renewed
    : Object.freeze({ ...renewed, manifestDigest: source?.manifestDigest });
}

export function expiredCommittedCloudRecoveryEvidenceDigest({
  snapshotDigest,
  recoveryEvidence,
} = {}) {
  return digestValue({
    schema: EXPIRED_COMMITTED_CLOUD_RECOVERY_EVIDENCE_SCHEMA,
    snapshotDigest: requiredDigest(snapshotDigest, "recovery snapshot digest"),
    recoveryEvidence: requiredObject(recoveryEvidence, "recovery evidence"),
  });
}

export function continueExpiredCommittedHeartbeatCloudAuthority({
  authority,
  manifest,
  recoveryEvidenceDigest,
  deviceId = authority?.deviceId,
  sessionId = authority?.sessionId,
  ttlSeconds,
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudAction,
  renew = heartbeatAdmissionCloudAuthority,
  verify = verifyAdmissionCloudAuthority,
  resolveReplayEvidence = resolveExpiredCommittedRecoveryReplayEvidence,
} = {}) {
  const admittedManifest = normalizeManifest(manifest);
  const source = normalizeSourceAuthority(authority, admittedManifest);
  const evidenceDigest = requiredDigest(
    recoveryEvidenceDigest,
    "recovery evidence digest",
  );
  const status = inspect({
    action: "status",
    ledgerRepository: source.ledgerRepository,
    request: { targetRepository: source.targetRepository },
    environment,
  });
  const claim = exactClaim(status, source, admittedManifest);
  const exactProjection = sameRecordedProjection(claim, source);
  const common = {
    authority: source,
    manifest: admittedManifest,
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    ttlSeconds: positiveInteger(ttlSeconds, "ttlSeconds"),
    environment,
  };

  if (claim.state === "dormant-preserved" && exactProjection) {
    return recoverDormant({
      ...common,
      claim,
      evidenceDigest,
      expectedReplay: false,
      invoke,
      verify,
    });
  }
  if (claim.state === "current" && exactProjection) {
    return finalizeContinuation(renew(common), source, admittedManifest);
  }
  if (!["current", "dormant-preserved"].includes(claim.state)) drift();
  if (claim.transitionCounter <= source.transitionCounter) drift();

  const sourceHeartbeat = optionalCounter(source.heartbeatCounter);
  const liveHeartbeat = optionalCounter(claim.heartbeatCounter);
  if (sourceHeartbeat !== null && liveHeartbeat !== null) {
    if (liveHeartbeat === sourceHeartbeat + 1) {
      return finalizeContinuation(renew(common), source, admittedManifest);
    }
    if (liveHeartbeat !== sourceHeartbeat) drift();
    if (claim.transitionCounter === source.transitionCounter + 1) {
      return recoverDormant({
        ...common,
        claim,
        evidenceDigest: resolveReplayEvidence({
          source,
          liveClaim: claim,
          status,
          environment,
        }),
        followupEvidenceDigest: evidenceDigest,
        expectedReplay: true,
        invoke,
        verify,
      });
    }
    const replayEvidenceDigest = resolveReplayEvidenceOrDrift({
      resolveReplayEvidence,
      source,
      liveClaim: claim,
      status,
      environment,
    });
    if (replayEvidenceDigest !== evidenceDigest) drift();
    if (claim.state === "dormant-preserved") {
      return recoverDormant({
        ...common,
        claim,
        evidenceDigest: replayEvidenceDigest,
        followupEvidenceDigest: evidenceDigest,
        expectedReplay: true,
        invoke,
        verify,
      });
    }
    return adoptCurrentResponseLoss({
      source,
      claim,
      status,
      manifest: admittedManifest,
      verify,
      environment,
    });
  }
  if (claim.transitionCounter !== source.transitionCounter + 1) {
    const replayEvidenceDigest = resolveReplayEvidenceOrDrift({
      resolveReplayEvidence,
      source,
      liveClaim: claim,
      status,
      environment,
    });
    if (replayEvidenceDigest !== evidenceDigest) drift();
    return adoptCurrentResponseLoss({
      source,
      claim,
      status,
      manifest: admittedManifest,
      verify,
      environment,
    });
  }

  try {
    return recoverDormant({
      ...common,
      claim,
      evidenceDigest: resolveReplayEvidence({
        source,
        liveClaim: claim,
        status,
        environment,
      }),
      followupEvidenceDigest: evidenceDigest,
      expectedReplay: true,
      invoke,
      verify,
    });
  } catch (error) {
    if (!isRecoveryReplayMiss(error)) throw error;
    return finalizeContinuation(renew(common), source, admittedManifest);
  }
}

function adoptCurrentResponseLoss({
  source,
  claim,
  status,
  manifest,
  verify,
  environment,
}) {
  if (claim.state !== "current" || claim.writeAuthority !== true) drift();
  const authority = Object.freeze({
    ...source,
    claimDigest: requiredDigest(claim.fenceRevision, "live claim fence"),
    ledgerRevision: requiredSha(status.ledgerRevision, "live ledger revision"),
    ledgerDigest: requiredDigest(status.ledgerDigest, "live ledger digest"),
    claimLedgerRevision: requiredDigest(claim.transitionDigest, "live transition digest"),
    operationReceiptDigest: requiredDigest(
      claim.operationReceiptDigest,
      "live operation receipt digest",
    ),
    laneRevision: requiredSha(claim.laneRevision, "live lane revision"),
    canonicalBaseSha: requiredSha(
      claim.canonicalBaseRevision,
      "live canonical base revision",
    ),
    cloudDeclaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: requiredDigest(claim.writeSetDigest, "live write-set digest"),
    leaseEpoch: positiveInteger(claim.leaseEpoch, "live lease epoch"),
    transitionCounter: positiveInteger(
      claim.transitionCounter,
      "live transition counter",
    ),
    state: "active",
    expiresAt: requiredText(claim.expiresAt, "live expiresAt"),
    heartbeatCounter: optionalCounter(claim.heartbeatCounter),
  });
  const verified = verify({
    authority,
    manifest,
    canonicalBaseSha: source.canonicalBaseSha,
    environment,
  });
  return finalizeAdoptedContinuation(verified, source, manifest);
}

function finalizeAdoptedContinuation(result, source, manifest) {
  const authority = result?.authority;
  const verification = result?.verification;
  const inventoryClaim = verification?.inventory?.claims?.find(
    candidate => candidate.claimId === source.claimId,
  );
  if (
    !authority
    || verification?.status !== "ready"
    || verification.claimId !== source.claimId
    || verification.claimDigest !== authority.claimDigest
    || inventoryClaim?.claimId !== source.claimId
    || inventoryClaim.state !== "active"
    || inventoryClaim.fenceRevision !== authority.claimDigest
    || inventoryClaim.transitionCounter !== authority.transitionCounter
    || authority.claimId !== source.claimId
    || authority.canonicalBaseSha !== source.canonicalBaseSha
    || authority.laneRevision !== source.laneRevision
    || authority.writeSetDigest !== manifest.writeSetDigest
    || authority.leaseEpoch !== source.leaseEpoch
    || authority.reviewRequestId !== source.reviewRequestId
    || authority.transitionCounter <= source.transitionCounter
    || authority.state !== "active"
    || Date.parse(authority.expiresAt) <= Date.now()
  ) drift();
  return Object.freeze({
    ...result,
    authority: Object.freeze({
      ...authority,
      heartbeatCounter: inventoryClaim.heartbeatCounter,
    }),
  });
}

function recoverDormant({
  authority,
  manifest,
  claim,
  evidenceDigest,
  followupEvidenceDigest = null,
  expectedReplay,
  deviceId,
  sessionId,
  ttlSeconds,
  environment,
  invoke,
  verify,
}) {
  const operationKey = [
    "device-expired-committed-recovery",
    authority.claimId,
    authority.transitionCounter,
    authority.claimDigest,
    evidenceDigest,
  ].join(":");
  const result = invoke({
    action: "continue",
    ledgerRepository: authority.ledgerRepository,
    request: {
      targetRepository: authority.targetRepository,
      claimId: authority.claimId,
      expectedFenceRevision: authority.claimDigest,
      expectedTransitionCounter: authority.transitionCounter,
      mode: "recovery",
      ttlSeconds,
      recoveryEvidenceDigest: evidenceDigest,
      deviceId,
      sessionId,
      idempotencyKey: operationKey,
    },
    environment,
  });
  requireRecoveryResult({
    result,
    authority,
    claim,
    manifest,
    operationKey,
    expectedReplay,
  });
  const projected = normalizeBoundAuthority({
    result: result.ledgerDigest ? result : {
      ...result,
      ledgerDigest: result.receipt?.ledgerDigest,
    },
    authority,
    manifest: {
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
    },
    deviceId,
    sessionId,
  });
  if (Date.parse(projected.expiresAt) <= Date.now()) {
    if (!followupEvidenceDigest) drift();
    return recoverDormant({
      authority: Object.freeze({ ...projected, state: "active" }),
      manifest,
      claim: result.claim,
      evidenceDigest: followupEvidenceDigest,
      expectedReplay: false,
      deviceId,
      sessionId,
      ttlSeconds,
      environment,
      invoke,
      verify,
    });
  }
  const verified = verify({
    authority: projected,
    manifest,
    canonicalBaseSha: authority.canonicalBaseSha,
    environment,
  });
  return finalizeContinuation(verified, authority, manifest);
}

function requireRecoveryResult({
  result,
  authority,
  claim,
  manifest,
  operationKey,
  expectedReplay,
}) {
  requireRecoverySubjectResult(result, {
    authority,
    manifest,
    canonicalBaseSha: authority.canonicalBaseSha,
    expectedState: "active",
    expectedLaneRevision: authority.laneRevision,
  }, { allowExpired: expectedReplay });
  const operation = result.operationReceipt;
  if (
    result.replayed !== expectedReplay
    || result.claim.transitionCounter !== authority.transitionCounter + 1
    || result.claim.heartbeatCounter !== claim.heartbeatCounter
    || result.claim.fenceRevision !== result.claimDigest
    || result.claim.transitionDigest !== operation?.ledgerRevision
    || result.claim.operationReceiptDigest !== operation?.receiptDigest
    || operation?.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue"
    || operation.status !== "current"
    || operation.claimId !== authority.claimId
    || operation.claimDigest !== result.claimDigest
    || operation.idempotencyKey !== digestValue(operationKey)
    || !/^[0-9a-f]{64}$/u.test(String(operation.requestDigest || ""))
  ) {
    throw new Error("Dormant recovery did not return its exact continuation receipt.");
  }
}

function requireRecoverySubjectResult(result, expected, { allowExpired }) {
  if (!allowExpired || Date.parse(result?.claim?.expiresAt) > Date.now()) {
    requireReadyResult(result, expected);
    return;
  }
  const claim = result?.claim;
  const findings = result?.findings ?? [];
  if (
    result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "continue"
    || claim?.claimId !== expected.authority.claimId
    || claim.canonicalBaseRevision !== expected.canonicalBaseSha
    || claim.laneRevision !== expected.expectedLaneRevision
    || !["current", "dormant-preserved"].includes(claim.state)
    || claim.writeSetDigest !== expected.manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(expected.manifest.declaredWriteSet)
    || !Array.isArray(findings)
    || findings.length > 0
  ) drift();
  requiredSha(result.ledgerRevision, "replay ledger revision");
  requiredDigest(result.claimDigest, "replay claim digest");
}

function finalizeContinuation(result, source, manifest) {
  const authority = result?.authority;
  const verification = result?.verification;
  const inventoryClaim = verification?.inventory?.claims?.find(
    candidate => candidate.claimId === source.claimId,
  );
  if (
    !authority
    || verification?.status !== "ready"
    || verification.claimId !== source.claimId
    || verification.claimDigest !== authority.claimDigest
    || inventoryClaim?.claimId !== source.claimId
    || inventoryClaim.state !== "active"
    || inventoryClaim.fenceRevision !== authority.claimDigest
    || inventoryClaim.transitionCounter !== source.transitionCounter + 1
    || authority.claimId !== source.claimId
    || authority.canonicalBaseSha !== source.canonicalBaseSha
    || authority.laneRevision !== source.laneRevision
    || authority.writeSetDigest !== manifest.writeSetDigest
    || authority.leaseEpoch !== source.leaseEpoch
    || authority.reviewRequestId !== source.reviewRequestId
    || authority.transitionCounter !== source.transitionCounter + 1
    || authority.state !== "active"
    || Date.parse(authority.expiresAt) <= Date.now()
  ) drift();
  return Object.freeze({
    ...result,
    authority: Object.freeze({
      ...authority,
      heartbeatCounter: inventoryClaim.heartbeatCounter,
    }),
  });
}

function exactClaim(status, authority, manifest) {
  if (
    status?.schema !== "agentic-cloud-collaboration-result/v1"
    || status.ok !== true
    || status.action !== "status"
    || !Array.isArray(status.claims)
  ) drift();
  const matches = status.claims.filter(claim => claim.claimId === authority.claimId);
  if (matches.length !== 1) drift();
  const claim = matches[0];
  const stateShape = claim.state === "current"
    ? claim.writeAuthority === true && claim.scopeReserved === true
    : claim.state === "dormant-preserved"
      && claim.writeAuthority === false && claim.scopeReserved === true;
  if (
    !stateShape
    || claim.entrySchema !== authority.entrySchema
    || claim.claimIdentitySchema !== authority.claimIdentitySchema
    || claim.canonicalBaseRevision !== authority.canonicalBaseSha
    || claim.laneRevision !== authority.laneRevision
    || claim.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(manifest.declaredWriteSet)
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.reviewRequestId !== authority.reviewRequestId
  ) drift();
  return claim;
}

function normalizeSourceAuthority(authority, manifest) {
  if (
    authority?.schema !== "agentic-lane-cloud-authority/v1"
    || authority.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || authority.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || authority.state !== "active"
    || authority.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(authority.cloudDeclaredWriteScope))
      !== JSON.stringify(manifest.declaredWriteSet)
  ) drift();
  requiredDigest(authority.claimId, "source claim ID");
  requiredDigest(authority.claimDigest, "source claim digest");
  requiredDigest(authority.claimLedgerRevision, "source transition digest");
  requiredDigest(authority.operationReceiptDigest, "source operation receipt");
  requiredSha(authority.canonicalBaseSha, "source canonical base");
  requiredSha(authority.laneRevision, "source lane revision");
  positiveInteger(authority.transitionCounter, "source transition counter");
  positiveInteger(authority.leaseEpoch, "source lease epoch");
  return authority;
}

function normalizeManifest(manifest) {
  const declaredWriteSet = normalizeWriteSet(manifest?.declaredWriteSet);
  const writeSetDigest = requiredDigest(manifest?.writeSetDigest, "write-set digest");
  if (writeSetDigest !== digestValue(declaredWriteSet)) drift();
  return Object.freeze({
    ...manifest,
    declaredWriteSet,
    writeSetDigest,
  });
}

function sameRecordedProjection(claim, authority) {
  return claim.transitionCounter === authority.transitionCounter
    && claim.fenceRevision === authority.claimDigest
    && claim.transitionDigest === authority.claimLedgerRevision
    && claim.operationReceiptDigest === authority.operationReceiptDigest;
}

function isRecoveryReplayMiss(error) {
  return /expectedFenceRevision is stale|expectedTransitionCounter is stale|recovery requires dormant-preserved authority/u
    .test(String(error instanceof Error ? error.message : error));
}

function optionalCounter(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function resolveReplayEvidenceOrDrift({
  resolveReplayEvidence,
  source,
  liveClaim,
  status,
  environment,
}) {
  try {
    return resolveReplayEvidence({ source, liveClaim, status, environment });
  } catch {
    drift();
  }
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(label + " must be a positive integer.");
  }
  return number;
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " is required.");
  }
  return value;
}

function drift() {
  throw new Error("Live cloud claim drifted from the expired committed recovery subject.");
}
