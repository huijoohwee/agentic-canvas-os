// Responsibility: Recover one exact partial-admission claim with a device-only projection change.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { normalizePlannedDeviceProjectionRecoveryPlan }
  from "./planned-device-projection-recovery-contract.mjs";
import {
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority }
  from "./scoped-lane-cloud-reconciliation.mjs";

export function createPlannedDeviceProjectionRecoveryCloudAdapter({
  environment = process.env,
  inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudAction,
  verify = verifyAdmissionCloudAuthority,
} = {}) {
  function inspectDormant({ sourceAuthority, sourceLease, manifest }) {
    const status = readStatus(sourceAuthority);
    const claim = exactClaim(status, sourceAuthority.claimId);
    assertPartialAdmissionClaim({ claim, sourceAuthority, sourceLease, manifest });
    assertNoCompetitors(status.claims, claim, manifest);
    return Object.freeze({
      claim,
      inventoryDigest: digestValue(status.claims
        .map(projectInventoryClaim).sort((left, right) => left.claimId.localeCompare(right.claimId))),
    });
  }

  function recover(plan) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const request = recoveryRequest(sealed);
    const sourceClaim = sealed.evidence.cloud.claim;
    const sourceAuthority = sealed.evidence.sourceLease.cloudAuthority;
    const status = readStatus(sourceAuthority);
    const current = exactClaim(status, sourceClaim.claimId);
    assertNoCompetitors(status.claims, current, sealed.evidence.manifest);
    if (current.transitionCounter === sourceClaim.transitionCounter) {
      assertPartialAdmissionClaim({
        claim: current,
        sourceAuthority,
        sourceLease: sealed.evidence.sourceLease,
        manifest: sealed.evidence.manifest,
      });
    } else {
      assertRecoveredClaim(current, sourceClaim, sealed);
    }
    const result = invoke({
      action: "continue",
      ledgerRepository: sourceAuthority.ledgerRepository,
      request,
      environment,
    });
    const claim = result?.claim;
    assertRecoveryResult({ result, claim, sourceClaim, plan: sealed, request });
    const authority = normalizeBoundAuthority({
      result: result.ledgerDigest ? result : {
        ...result,
        ledgerDigest: result.receipt?.ledgerDigest,
      },
      authority: sourceAuthority,
      manifest: sealed.evidence.manifest,
      deviceId: claim.deviceId,
      sessionId: claim.sessionId,
    });
    const terminal = verifyRecovered(sealed, authority);
    return Object.freeze({
      authority: terminal.authority,
      recoveredAt: instant(result.operationReceipt?.evaluationTime, "recovery evaluation time"),
      verificationReceiptDigest: terminal.verificationReceiptDigest,
      disposition: result.replayed === true ? "adopted" : "projected",
    });
  }

  function verifyRecovered(plan, authority) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const result = verify({
      authority,
      manifest: sealed.evidence.manifest,
      canonicalBaseSha: sealed.evidence.sourceLease.baseSha,
      environment,
    });
    const verification = result?.verification;
    const claims = verification?.inventory?.claims;
    if (verification?.status !== "ready" || !Array.isArray(claims)) invalid("cloud verification");
    const claim = exactClaim({ claims }, authority.claimId);
    assertRecoveredClaim(claim, sealed.evidence.cloud.claim, sealed);
    assertNoCompetitors(claims, claim, sealed.evidence.manifest);
    if (result.authority?.claimDigest !== claim.fenceRevision
      || result.authority?.deviceId !== sealed.evidence.cloud.expectedDeviceId
      || result.authority?.sessionId !== sealed.evidence.cloud.expectedSessionId) {
      invalid("verified authority projection");
    }
    return Object.freeze({
      authority: result.authority,
      verificationReceiptDigest: digest(verification.receiptDigest, "verification receipt"),
    });
  }

  function readStatus(authority) {
    const status = inspect({
      action: "status",
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository },
      environment,
    });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1"
      || status.ok !== true || status.action !== "status" || !Array.isArray(status.claims)) {
      invalid("operation-derived cloud status");
    }
    return status;
  }

  return Object.freeze({ inspectDormant, recover, verifyRecovered });
}

function recoveryRequest(plan) {
  const claim = plan.evidence.cloud.claim;
  return Object.freeze({
    targetRepository: plan.evidence.sourceLease.cloudAuthority.targetRepository,
    claimId: claim.claimId,
    expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter,
    mode: "recovery",
    ttlSeconds: plan.ttlSeconds,
    recoveryEvidenceDigest: plan.evidence.evidenceDigest,
    deviceId: plan.evidence.sourceLease.device,
    sessionId: plan.evidence.sourceLease.sessionId,
    idempotencyKey: `planned-device-projection-recovery:${plan.planDigest}`,
  });
}

function assertPartialAdmissionClaim({ claim, sourceAuthority, sourceLease, manifest }) {
  if (claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || claim.claimId !== sourceAuthority.claimId
    || claim.transitionCounter !== sourceAuthority.transitionCounter + 1
    || claim.fenceRevision === sourceAuthority.claimDigest
    || claim.canonicalBaseRevision !== sourceLease.baseSha
    || claim.laneRevision !== sourceLease.fenceSha
    || claim.writeSetDigest !== manifest.writeSetDigest
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(manifest.declaredWriteSet)
    || claim.leaseEpoch !== sourceAuthority.leaseEpoch
    || claim.deviceId !== sourceAuthority.deviceId
    || claim.sessionId !== sourceAuthority.sessionId
    || claim.reviewRequestId == null) {
    invalid("partial-admission source claim");
  }
}

function assertRecoveryResult({ result, claim, sourceClaim, plan, request }) {
  const operation = result?.operationReceipt;
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "continue" || result.status !== "current"
    || typeof result.replayed !== "boolean"
    || claim?.fenceRevision !== result.claimDigest
    || operation?.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue" || operation.status !== "current"
    || operation.claimId !== sourceClaim.claimId || operation.claimDigest !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest
    || operation.idempotencyKey !== digestValue(request.idempotencyKey)
    || operation.receiptDigest !== claim.operationReceiptDigest
    || !/^[0-9a-f]{64}$/u.test(String(operation.requestDigest || ""))) {
    invalid("continuation receipt");
  }
  assertRecoveredClaim(claim, sourceClaim, plan);
}

function assertRecoveredClaim(claim, sourceClaim, plan) {
  const stableFields = [
    "claimId", "entrySchema", "claimIdentitySchema", "actorId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "laneRevision", "writeSetDigest",
    "leaseEpoch", "reviewRequestId",
  ];
  if (claim?.state !== "current" || claim.writeAuthority !== true
    || claim.scopeReserved !== true
    || stableFields.some(field => claim[field] !== sourceClaim[field])
    || claim.transitionCounter !== sourceClaim.transitionCounter + 1
    || claim.heartbeatCounter !== sourceClaim.heartbeatCounter
    || claim.deviceId !== plan.evidence.cloud.expectedDeviceId
    || claim.sessionId !== plan.evidence.cloud.expectedSessionId
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(plan.evidence.manifest.declaredWriteSet)
    || Date.parse(claim.expiresAt) <= Date.now()) {
    invalid("recovered same-claim projection");
  }
}

function assertNoCompetitors(claims, source, manifest) {
  const competitors = claims.filter(claim => claim.claimId !== source.claimId
    && claim.repositoryId === source.repositoryId && claim.scopeReserved === true
    && (claim.reviewRequestId === source.reviewRequestId
      || writeSetsOverlap(claim.declaredWriteScope, manifest.declaredWriteSet)));
  if (competitors.length) invalid("overlapping cloud reservation");
}

function exactClaim(status, claimId) {
  const matches = status.claims.filter(claim => claim.claimId === claimId);
  if (matches.length !== 1) invalid("claim cardinality");
  return matches[0];
}

function projectInventoryClaim(claim) {
  return {
    claimId: claim.claimId,
    state: claim.state,
    scopeReserved: claim.scopeReserved,
    fenceRevision: claim.fenceRevision,
    transitionCounter: claim.transitionCounter,
    reviewRequestId: claim.reviewRequestId,
    writeSetDigest: claim.writeSetDigest,
  };
}

function digest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) invalid(label);
  return value;
}
function instant(value, label) {
  const parsed = new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) invalid(label);
  return parsed.toISOString();
}
function invalid(subject) {
  throw new Error(`Planned device-projection recovery rejected ${subject}.`);
}
