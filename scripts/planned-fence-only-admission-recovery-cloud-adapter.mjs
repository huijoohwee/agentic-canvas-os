// Responsibility: Seal and verify one idempotent same-claim dormant recovery transition.
import { canonicalJson, digestValue, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { normalizePlannedFenceOnlyAdmissionRecoveryPlan }
  from "./planned-fence-only-admission-recovery-contract.mjs";
import { normalizeClaimProvenance } from "./scoped-lane-claim-provenance.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";

export function createPlannedFenceOnlyAdmissionRecoveryCloudAdapter({
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudAction,
  verify = verifyAdmissionCloudAuthority,
} = {}) {
  function inspectDormant({ sourceAuthority, sourceLease, manifest }) {
    const status = inspect({
      action: "status",
      ledgerRepository: sourceAuthority.ledgerRepository,
      request: { targetRepository: sourceAuthority.targetRepository },
      environment,
    });
    requireStatus(status);
    const matches = status.claims.filter(claim => claim.claimId === sourceAuthority.claimId);
    if (matches.length !== 1) invalid("dormant claim cardinality");
    const observedClaim = projectClaim(matches[0]);
    let claim = observedClaim;
    if (observedClaim.state === "dormant-preserved"
      && observedClaim.transitionCounter === sourceAuthority.transitionCounter + 1) {
      const projectedSourceClaim = projectSourceClaimFromExpiredResponseLoss({
        claim: observedClaim,
        sourceAuthority,
      });
      assertExpiredRecoveredResponseLossClaim({
        claim: observedClaim,
        sourceClaim: projectedSourceClaim,
        sourceLease,
        manifest,
        sourceAuthority,
      });
      claim = projectedSourceClaim;
    } else {
      assertSourceClaim({ claim, sourceAuthority, sourceLease, manifest });
    }
    const overlappingClaimIds = status.claims
      .filter(candidate => candidate.claimId !== claim.claimId
        && candidate.repositoryId === claim.repositoryId
        && candidate.scopeReserved === true
        && (candidate.reviewRequestId === claim.reviewRequestId
          || overlaps(candidate.declaredWriteScope, manifest.declaredWriteSet)))
      .map(candidate => candidate.claimId).sort();
    if (overlappingClaimIds.length) invalid("overlapping cloud reservation");
    return Object.freeze({
      status: "ready",
      ledgerRevision: requiredSha(status.ledgerRevision, "status ledger revision"),
      ledgerDigest: requiredDigest(status.ledgerDigest, "status ledger digest"),
      inventoryDigest: digestValue(status.claims.map(projectInventoryClaim)
        .sort((left, right) => left.claimId.localeCompare(right.claimId))),
      claim,
      overlappingClaimIds,
    });
  }

  function sealRequest(plan) {
    const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    return projectSealedRequest(buildCloudRequest(normalizedPlan));
  }

  function buildCloudRequest(normalizedPlan) {
    const authority = normalizedPlan.evidence.sourceLease.cloudAuthority;
    const claim = normalizedPlan.evidence.cloud.claim;
    const idempotencyDigest = digestValue({
      schema: "agentic-planned-fence-only-admission-recovery-cloud-request-key/v1",
      planDigest: normalizedPlan.planDigest,
      claimId: claim.claimId,
      expectedFenceRevision: claim.fenceRevision,
      expectedTransitionCounter: claim.transitionCounter,
    });
    const request = Object.freeze({
      targetRepository: authority.targetRepository,
      claimId: claim.claimId,
      expectedFenceRevision: claim.fenceRevision,
      expectedTransitionCounter: claim.transitionCounter,
      mode: "recovery",
      ttlSeconds: normalizedPlan.ttlSeconds,
      recoveryEvidenceDigest: normalizedPlan.evidence.evidenceDigest,
      deviceId: normalizedPlan.evidence.sourceLease.device,
      sessionId: normalizedPlan.evidence.sourceLease.sessionId,
      idempotencyKey: `planned-fence-only-admission-recovery:${idempotencyDigest}`,
    });
    const sealedTransportDigest = digestValue({
      action: "continue",
      ledgerRepository: authority.ledgerRepository,
      request,
    });
    return Object.freeze({
      ledgerRepository: authority.ledgerRepository,
      request,
      sealedTransportDigest,
    });
  }

  function projectSealedRequest(transport) {
    return Object.freeze({
      sealedTransportDigest: transport.sealedTransportDigest,
      idempotencyKey: digestValue(transport.request.idempotencyKey),
      expectedFenceRevision: transport.request.expectedFenceRevision,
      expectedTransitionCounter: transport.request.expectedTransitionCounter,
      ttlSeconds: transport.request.ttlSeconds,
      recoveryEvidenceDigest: transport.request.recoveryEvidenceDigest,
    });
  }

  function recover({ plan, sealedRequest }) {
    const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const expected = sealRequest(normalizedPlan);
    if (canonicalJson(sealedRequest) !== canonicalJson(expected)) invalid("sealed cloud request");
    const transport = buildCloudRequest(normalizedPlan);
    assertRecoverableCloudState(normalizedPlan);
    const result = invoke({
      action: "continue",
      ledgerRepository: transport.ledgerRepository,
      request: transport.request,
      environment,
    });
    const claim = projectClaim(result?.claim);
    assertRecoveredClaim({
      claim,
      sourceClaim: normalizedPlan.evidence.cloud.claim,
      sourceLease: normalizedPlan.evidence.sourceLease,
      manifest: normalizedPlan.evidence.manifest,
      result,
      sealedRequest: expected,
      plan: normalizedPlan,
    });
    const authority = projectRecoveredAuthority({
      source: normalizedPlan.evidence.sourceLease.cloudAuthority,
      claim,
      result,
    });
    const terminal = verifyRecovered({ plan: normalizedPlan, authority });
    const recoveredAt = requiredInstant(result.operationReceipt?.evaluationTime,
      "recovery evaluation time");
    const verifiedAuthority = terminal.authority;
    return Object.freeze({
      authority: verifiedAuthority,
      authorityDigest: digestValue(verifiedAuthority),
      verificationReceiptDigest: terminal.verificationReceiptDigest,
      inventoryDigest: terminal.inventoryDigest,
      operationReceiptDigest: claim.operationReceiptDigest,
      providerReceiptDigest: requiredDigest(result.receipt?.receiptDigest,
        "provider recovery receipt"),
      idempotencyKey: expected.idempotencyKey,
      sealedTransportDigest: expected.sealedTransportDigest,
      semanticOperationDigest: requiredDigest(result.operationReceipt?.requestDigest,
        "operation request digest"),
      targetClaimDigest: terminal.targetClaimDigest,
      transitionCounter: verifiedAuthority.transitionCounter,
      expiresAt: verifiedAuthority.expiresAt,
      recoveredAt,
      disposition: result.replayed === true ? "replayed" : "projected",
    });
  }

  function verifyRecovered({ plan, authority }) {
    const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const verified = verify({
      authority,
      manifest: normalizedPlan.evidence.manifest,
      canonicalBaseSha: normalizedPlan.evidence.sourceLease.baseSha,
      environment,
    });
    const verification = verified?.verification;
    const claims = verification?.inventory?.claims;
    if (verification?.status !== "ready" || !Array.isArray(claims)) {
      invalid("operation-derived recovered verification");
    }
    const matches = claims.filter(claim => claim.claimId === authority.claimId);
    if (matches.length !== 1) invalid("recovered claim cardinality");
    const claim = matches[0];
    if (claim.state !== "current" || claim.writeAuthority !== true || claim.scopeReserved !== true
      || claim.transitionCounter !== normalizedPlan.evidence.cloud.claim.transitionCounter + 1
      || claim.leaseEpoch !== normalizedPlan.evidence.cloud.claim.leaseEpoch) {
      invalid("recovered cloud authority state");
    }
    const competitors = claims.filter(candidate => candidate.claimId !== claim.claimId
      && candidate.repositoryId === claim.repositoryId
      && candidate.scopeReserved === true
      && (candidate.reviewRequestId === claim.reviewRequestId
        || overlaps(candidate.declaredWriteScope, normalizedPlan.evidence.manifest.declaredWriteSet)));
    if (competitors.length) invalid("recovered overlapping cloud reservation");
    return Object.freeze({
      authority: verified.authority,
      verificationReceiptDigest: requiredDigest(verification.receiptDigest, "verification receipt"),
      inventoryDigest: requiredDigest(verification.remoteClaimInventoryDigest, "verification inventory"),
      targetClaimDigest: digestValue(projectTargetClaim(claim)),
      verifiedAt: requiredInstant(verification.verifiedAt, "verification time"),
    });
  }

  function assertRecoverableCloudState(plan) {
    const authority = plan.evidence.sourceLease.cloudAuthority;
    const status = inspect({
      action: "status",
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository },
      environment,
    });
    requireStatus(status);
    const matches = status.claims.filter(claim => claim.claimId === authority.claimId);
    if (matches.length !== 1) invalid("recoverable claim cardinality");
    const claim = projectClaim(matches[0]);
    if (claim.state === "dormant-preserved"
      && claim.transitionCounter === plan.evidence.cloud.claim.transitionCounter) {
      assertSourceClaim({ claim, sourceAuthority: authority,
        sourceLease: plan.evidence.sourceLease, manifest: plan.evidence.manifest });
    } else if (claim.state === "dormant-preserved") {
      assertExpiredRecoveredResponseLossClaim({
        claim,
        sourceClaim: plan.evidence.cloud.claim,
        sourceLease: plan.evidence.sourceLease,
        manifest: plan.evidence.manifest,
        recoveryEvidenceDigest: plan.evidence.evidenceDigest,
      });
    } else {
      assertRecoveredResponseLossClaim({ claim, sourceClaim: plan.evidence.cloud.claim,
        sourceLease: plan.evidence.sourceLease, manifest: plan.evidence.manifest });
    }
    const competitors = status.claims.filter(candidate => candidate.claimId !== claim.claimId
      && candidate.repositoryId === claim.repositoryId && candidate.scopeReserved === true
      && (candidate.reviewRequestId === claim.reviewRequestId
        || overlaps(candidate.declaredWriteScope, plan.evidence.manifest.declaredWriteSet)));
    if (competitors.length) invalid("recoverable overlapping cloud reservation");
  }

  return Object.freeze({ inspectDormant, recover, sealRequest, verifyRecovered });
}

function assertSourceClaim({ claim, sourceAuthority, sourceLease, manifest }) {
  const expectedDeviceId = normalizeOwnerIdentifier("device", sourceLease.device);
  const expectedSessionId = normalizeOwnerIdentifier("session", sourceLease.sessionId);
  if (claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || claim.claimId !== sourceAuthority.claimId
    || claim.fenceRevision !== sourceAuthority.claimDigest
    || claim.transitionDigest !== sourceAuthority.claimLedgerRevision
    || claim.transitionCounter !== sourceAuthority.transitionCounter
    || claim.heartbeatCounter !== normalizeHeartbeatCounter(sourceAuthority.heartbeatCounter)
    || claim.operationReceiptDigest !== sourceAuthority.operationReceiptDigest
    || claim.entrySchema !== sourceAuthority.entrySchema
    || claim.claimIdentitySchema !== sourceAuthority.claimIdentitySchema
    || claim.canonicalBaseRevision !== sourceLease.baseSha
    || claim.laneRevision !== sourceLease.fenceSha
    || claim.writeSetDigest !== manifest.writeSetDigest
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(manifest.declaredWriteSet)
    || claim.leaseEpoch !== sourceAuthority.leaseEpoch
    || normalizeOwnerIdentifier("device", claim.deviceId) !== expectedDeviceId
    || normalizeOwnerIdentifier("session", claim.sessionId) !== expectedSessionId
    || normalizeOwnerIdentifier("device", sourceAuthority.deviceId) !== expectedDeviceId
    || normalizeOwnerIdentifier("session", sourceAuthority.sessionId) !== expectedSessionId
    || claim.reviewRequestId !== sourceAuthority.reviewRequestId) invalid("exact dormant claim subject");
}

function assertRecoveredClaim({ claim, sourceClaim, sourceLease, manifest, result,
  sealedRequest, plan }) {
  const stableFields = [
    "claimId", "entrySchema", "claimIdentitySchema", "actorId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "laneRevision", "writeSetDigest",
    "leaseEpoch", "reviewRequestId",
  ];
  const operation = result?.operationReceipt;
  const { receiptDigest: operationReceiptDigest, ...operationCore } = operation || {};
  const providerReceipt = result?.receipt;
  const { receiptDigest: providerReceiptDigest, ...providerReceiptCore } = providerReceipt || {};
  const operationTime = Date.parse(requiredInstant(
    operation?.evaluationTime,
    "operation receipt evaluation time",
  ));
  const providerTime = Date.parse(requiredInstant(
    providerReceipt?.evaluationTime,
    "provider receipt evaluation time",
  ));
  const expectedRequestDigest = recoveryRequestDigest({
    plan,
    evaluationTime: operation?.evaluationTime,
  });
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "continue" || result.status !== "current"
    || typeof result.replayed !== "boolean" || claim.state !== "current"
    || claim.writeAuthority !== true || claim.scopeReserved !== true
    || stableFields.some(field => claim[field] !== sourceClaim[field])
    || claim.transitionCounter !== sourceClaim.transitionCounter + 1
    || claim.heartbeatCounter !== sourceClaim.heartbeatCounter
    || normalizeOwnerIdentifier("device", claim.deviceId)
      !== normalizeOwnerIdentifier("device", sourceLease.device)
    || normalizeOwnerIdentifier("session", claim.sessionId)
      !== normalizeOwnerIdentifier("session", sourceLease.sessionId)
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(manifest.declaredWriteSet)
    || result.claimDigest !== claim.fenceRevision
    || operation?.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue" || operation.status !== "current"
    || operation.repositoryId !== sourceClaim.repositoryId
    || operation.claimId !== sourceClaim.claimId
    || operation.claimDigest !== claim.fenceRevision
    || operation.fenceRevision !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest
    || operation.idempotencyKey !== sealedRequest.idempotencyKey
    || operation.requestDigest !== expectedRequestDigest
    || operationReceiptDigest !== claim.operationReceiptDigest
    || operationReceiptDigest !== digestValue(operationCore)
    || providerReceipt?.schema !== "agentic-cloud-collaboration-github-receipt/v1"
    || providerReceipt.action !== "continue"
    || providerReceipt.contractReceiptDigest !== operationReceiptDigest
    || providerReceipt.claimId !== claim.claimId
    || providerReceipt.claimDigest !== claim.fenceRevision
    || providerReceipt.ledgerRevision !== result.ledgerRevision
    || providerTime < operationTime
    || providerReceiptDigest !== digestValue(providerReceiptCore)
    || result.ledgerRevision === undefined) invalid("same-claim dormant recovery result");
}

function assertRecoveredResponseLossClaim({ claim, sourceClaim, sourceLease, manifest }) {
  const stableFields = [
    "claimId", "entrySchema", "claimIdentitySchema", "actorId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "laneRevision", "writeSetDigest",
    "leaseEpoch", "reviewRequestId",
  ];
  const provenance = normalizeClaimProvenance(claim, "response-loss claim");
  if (!provenance.mutationAuthorityEligible || claim.state !== "current"
    || claim.writeAuthority !== true || claim.scopeReserved !== true
    || stableFields.some(field => claim[field] !== sourceClaim[field])
    || claim.transitionCounter !== sourceClaim.transitionCounter + 1
    || claim.heartbeatCounter !== sourceClaim.heartbeatCounter
    || normalizeOwnerIdentifier("device", claim.deviceId)
      !== normalizeOwnerIdentifier("device", sourceLease.device)
    || normalizeOwnerIdentifier("session", claim.sessionId)
      !== normalizeOwnerIdentifier("session", sourceLease.sessionId)
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(manifest.declaredWriteSet)) {
    invalid("exact response-loss recovery claim");
  }
}

function assertExpiredRecoveredResponseLossClaim({ claim, sourceClaim, sourceLease, manifest,
  recoveryEvidenceDigest = null, sourceAuthority = null }) {
  const stableFields = [
    "claimId", "entrySchema", "claimIdentitySchema", "actorId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "laneRevision", "writeSetDigest",
    "leaseEpoch", "reviewRequestId",
  ];
  if (claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true
    || stableFields.some(field => claim[field] !== sourceClaim[field])
    || claim.transitionCounter !== sourceClaim.transitionCounter + 1
    || claim.heartbeatCounter !== sourceClaim.heartbeatCounter
    || normalizeOwnerIdentifier("device", claim.deviceId)
      !== normalizeOwnerIdentifier("device", sourceLease.device)
    || normalizeOwnerIdentifier("session", claim.sessionId)
      !== normalizeOwnerIdentifier("session", sourceLease.sessionId)
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(manifest.declaredWriteSet)
    || requiredDigest(claim.recovery?.evidenceDigest, "response-loss recovery evidence")
      !== (recoveryEvidenceDigest || claim.recovery?.evidenceDigest)
    || !requiredInstant(claim.recovery?.recoveredAt, "response-loss recovery time")
    || (sourceAuthority && (claim.claimId !== sourceAuthority.claimId
      || claim.entrySchema !== sourceAuthority.entrySchema
      || claim.claimIdentitySchema !== sourceAuthority.claimIdentitySchema
      || claim.transitionCounter !== sourceAuthority.transitionCounter + 1
      || claim.heartbeatCounter !== normalizeHeartbeatCounter(sourceAuthority.heartbeatCounter)
      || claim.canonicalBaseRevision !== sourceAuthority.canonicalBaseSha
      || claim.laneRevision !== sourceAuthority.laneRevision
      || claim.writeSetDigest !== sourceAuthority.writeSetDigest
      || claim.leaseEpoch !== sourceAuthority.leaseEpoch
      || normalizeOwnerIdentifier("device", sourceAuthority.deviceId)
        !== normalizeOwnerIdentifier("device", sourceLease.device)
      || normalizeOwnerIdentifier("session", sourceAuthority.sessionId)
        !== normalizeOwnerIdentifier("session", sourceLease.sessionId)
      || claim.reviewRequestId !== sourceAuthority.reviewRequestId))) {
    invalid("exact expired response-loss recovery claim");
  }
}

function projectSourceClaimFromExpiredResponseLoss({ claim, sourceAuthority }) {
  const { recovery: _recovery, ...stableClaim } = claim;
  return Object.freeze({
    ...stableClaim,
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    expiresAt: sourceAuthority.expiresAt,
    fenceRevision: sourceAuthority.claimDigest,
    transitionDigest: sourceAuthority.claimLedgerRevision,
    operationReceiptDigest: sourceAuthority.operationReceiptDigest,
    transitionCounter: sourceAuthority.transitionCounter,
    heartbeatCounter: normalizeHeartbeatCounter(sourceAuthority.heartbeatCounter),
  });
}

function recoveryRequestDigest({ plan, evaluationTime }) {
  const recoveredAt = requiredInstant(evaluationTime, "cloud operation evaluation time");
  const sourceClaim = plan.evidence.cloud.claim;
  const lease = plan.evidence.sourceLease;
  const intent = {
    repositoryId: sourceClaim.repositoryId,
    actorId: sourceClaim.actorId,
    deviceId: normalizeOwnerIdentifier("device", lease.device),
    sessionId: normalizeOwnerIdentifier("session", lease.sessionId),
    claimId: sourceClaim.claimId,
    expectedFenceRevision: sourceClaim.fenceRevision,
    expectedTransitionCounter: sourceClaim.transitionCounter,
    mode: "recovery",
    laneRevision: null,
    reviewRequestId: null,
    expiresAt: new Date(Date.parse(recoveredAt) + plan.ttlSeconds * 1_000).toISOString(),
    focusedEvidenceDigest: null,
    handoffEvidenceDigest: null,
    recoveryEvidenceDigest: plan.evidence.evidenceDigest,
  };
  return digestValue({ action: "continue", intent });
}

function projectRecoveredAuthority({ source, claim, result }) {
  return Object.freeze({
    ...source,
    ...normalizeClaimProvenance(claim, "recovered claim"),
    claimDigest: claim.fenceRevision,
    ledgerRevision: requiredSha(result.ledgerRevision, "recovered ledger revision"),
    ledgerDigest: requiredDigest(result.ledgerDigest || result.receipt?.ledgerDigest,
      "recovered ledger digest"),
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter,
    expiresAt: claim.expiresAt,
    state: "active",
  });
}

function projectTargetClaim(value) {
  return {
    claimId: value.claimId,
    entrySchema: value.entrySchema,
    claimIdentitySchema: value.claimIdentitySchema,
    state: value.state,
    writeAuthority: value.writeAuthority,
    scopeReserved: value.scopeReserved,
    actorId: value.actorId,
    repositoryId: value.repositoryId,
    workItemId: value.workItemId,
    deviceId: value.deviceId,
    sessionId: value.sessionId,
    canonicalBaseRevision: value.canonicalBaseRevision,
    laneRevision: value.laneRevision,
    declaredWriteScope: value.declaredWriteScope,
    writeSetDigest: value.writeSetDigest,
    leaseEpoch: value.leaseEpoch,
    transitionCounter: value.transitionCounter,
    heartbeatCounter: value.heartbeatCounter,
    reviewRequestId: value.reviewRequestId,
    expiresAt: value.expiresAt,
    fenceRevision: value.fenceRevision,
    transitionDigest: value.transitionDigest,
    operationReceiptDigest: value.operationReceiptDigest,
  };
}

function projectClaim(value) {
  const source = record(value, "cloud claim");
  return Object.freeze({
    ...structuredClone(source),
    claimId: requiredDigest(source.claimId, "claim identity"),
    state: requiredText(source.state, "claim state"),
    canonicalBaseRevision: requiredSha(source.canonicalBaseRevision, "claim base"),
    laneRevision: requiredSha(source.laneRevision, "claim lane"),
    declaredWriteScope: [...source.declaredWriteScope],
    writeSetDigest: requiredDigest(source.writeSetDigest, "claim write set"),
    leaseEpoch: positive(source.leaseEpoch, "claim lease epoch"),
    transitionCounter: positive(source.transitionCounter, "claim transition"),
    heartbeatCounter: nonnegative(source.heartbeatCounter, "claim heartbeat"),
    expiresAt: requiredInstant(source.expiresAt, "claim expiry"),
    fenceRevision: requiredDigest(source.fenceRevision, "claim fence"),
    transitionDigest: requiredDigest(source.transitionDigest, "claim transition digest"),
    operationReceiptDigest: requiredDigest(source.operationReceiptDigest, "claim operation receipt"),
  });
}

function normalizeOwnerIdentifier(namespace, value) {
  const candidate = requiredText(value, `${namespace} identity`);
  const prefix = `${namespace}:`;
  return candidate.startsWith(prefix) && /^[0-9a-f]{64}$/u.test(candidate.slice(prefix.length))
    ? candidate
    : pseudonymousIdentifier(namespace, candidate);
}

function normalizeHeartbeatCounter(value) {
  return value === null || value === undefined
    ? 0
    : nonnegative(value, "source heartbeat counter");
}

function projectInventoryClaim(value) {
  return {
    claimId: value.claimId,
    repositoryId: value.repositoryId,
    state: value.state,
    declaredWriteScope: value.declaredWriteScope,
    writeSetDigest: value.writeSetDigest,
    leaseEpoch: value.leaseEpoch,
    transitionCounter: value.transitionCounter,
    heartbeatCounter: value.heartbeatCounter,
    laneRevision: value.laneRevision,
    fenceRevision: value.fenceRevision,
    scopeReserved: value.scopeReserved,
    writeAuthority: value.writeAuthority,
  };
}

function requireStatus(value) {
  if (value?.schema !== "agentic-cloud-collaboration-result/v1" || value.ok !== true
    || value.action !== "status" || value.status !== "ready" || !Array.isArray(value.claims)) {
    invalid("cloud status result");
  }
}
function overlaps(left, right) { try { return writeSetsOverlap(left, right); } catch { return true; } }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function requiredText(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function requiredSha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function requiredDigest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function nonnegative(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function requiredInstant(value, label) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) invalid(label); return parsed.toISOString(); }
function invalid(label) { throw new Error(`Planned fence-only admission recovery cloud adapter has invalid ${label}.`); }
