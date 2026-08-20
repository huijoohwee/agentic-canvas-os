import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { markOperationDerivedCloudVerification } from "./scoped-lane-admission-lib.mjs";
import { normalizeBoundAuthority, normalizeCurrentClaimInventory, positiveInteger,
  cloudAuthorityFromResult, projectRootState, reconcileCloudAuthorityProjection, requireAuthority, requiredDigest,
  requiredInstant, requiredSha, requiredText, requireReadyResult, rootStateForProjection,
} from "./scoped-lane-cloud-reconciliation.mjs";
const CLOUD_SCRIPT = fileURLToPath(new URL("./cloud-collaboration.mjs", import.meta.url));
export { attachCloudHeartbeatMachineEvidence, cloudAuthorityFromResult } from "./scoped-lane-cloud-reconciliation.mjs";
export function verifyAdmissionCloudAuthority({ authority, manifest, canonicalBaseSha,
  environment = process.env,
  invoke = invokeRepositoryCloudVerifier } = {}) {
  return verifyCloudAuthorityState({
    authority, manifest, canonicalBaseSha, environment, invoke,
    expectedState: "active",
  });
}
export function verifyReviewReadyAdmissionCloudAuthority({
  authority, manifest,
  headSha = authority?.laneRevision,
  branch = null,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest,
  environment = process.env,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority, manifest,
    canonicalBaseSha: authority?.canonicalBaseSha,
    expectedState: "review_ready",
    expectedLaneRevision: headSha,
    branch,
    focusedEvidenceDigest: requiredDigest(focusedEvidenceDigest, "focusedEvidenceDigest"),
    environment, invoke,
  });
}
export function verifyDeliveryAuthorizedCloudAuthority({
  authority, manifest,
  headSha = authority?.laneRevision,
  branch = null,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest,
  environment = process.env,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  return verifyCloudAuthorityState({
    authority, manifest,
    canonicalBaseSha: authority?.canonicalBaseSha,
    expectedState: "delivery_authorized",
    expectedLaneRevision: headSha,
    branch,
    focusedEvidenceDigest: requiredDigest(focusedEvidenceDigest, "focusedEvidenceDigest"),
    environment, invoke,
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
    environment, invoke: verify,
  });
}
function verifyCloudAuthorityState({
  authority, manifest, canonicalBaseSha, expectedState,
  expectedLaneRevision = authority?.laneRevision,
  focusedEvidenceDigest = null,
  pullRequestNumber = null,
  branch = null,
  environment, invoke,
}) {
  requireAuthority(authority);
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
        ? { pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber") }
        : {}),
      ...(branch ? { branch: requiredText(branch, "branch") } : {}),
      ...(focusedEvidenceDigest ? { focusedEvidenceDigest } : {}),
    },
    environment,
  });
  const inventory = normalizeCurrentClaimInventory({
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
  authority,
  manifest,
  branch,
  headSha,
  pullRequestNumber = null,
  reviewRequestId = null,
  deviceId,
  sessionId,
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
    branch: requiredText(branch, "branch"),
    canonicalBaseSha: authority.canonicalBaseSha,
    headSha: requiredSha(headSha, "headSha"),
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    claimId: authority.claimId,
    expectedFenceRevision: authority.claimDigest,
    expectedTransitionCounter: authority.transitionCounter,
    idempotencyKey: requiredText(idempotencyKey, "idempotencyKey"),
    ...(pullRequestNumber
      ? { pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber") }
      : {}),
    ...(reviewRequestId
      ? { reviewRequestId: requiredText(reviewRequestId, "reviewRequestId") }
      : {}),
  };
  let result;
  try {
    result = invoke({
      action: "continue",
      ledgerRepository: authority.ledgerRepository,
      request: { ...request, mode: "projection" },
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
    result: projectOperationLedgerDigest(result),
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
export function continueClaimedReviewSuccessorCloudAuthority({
  authority,
  claimResult,
  observedClaim = claimResult?.claim,
  manifest,
  branch,
  headSha,
  pullRequestNumber = null,
  reviewRequestId = null,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest || null,
  ttlSeconds = 1_800,
  deviceId = authority?.deviceId,
  sessionId = authority?.sessionId,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  requireAuthority(authority);
  const resolvedBranch = requiredText(branch, "branch");
  const resolvedHeadSha = requiredSha(headSha, "headSha");
  const initialClaim = requireClaimResultSuccessor({
    authority,
    claimResult,
    manifest,
    headSha: resolvedHeadSha,
  });
  const observed = requireExactSuccessorIdentity({
    claim: observedClaim,
    reference: initialClaim,
    manifest,
    canonicalBaseSha: authority.canonicalBaseSha,
    headSha: resolvedHeadSha,
    label: "observed successor",
  });
  requireSuccessorProgression(initialClaim, observed, "observed successor");

  const statusResult = inspect({
    action: "status",
    ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository },
    environment,
  });
  const liveClaim = requireLiveSuccessor({
    statusResult,
    authority,
    reference: initialClaim,
    manifest,
    headSha: resolvedHeadSha,
  });
  requireSuccessorProgression(observed, liveClaim, "live successor");
  requireExpectedReviewIdentity(liveClaim, reviewRequestId);

  const resolvedFocusedEvidenceDigest = focusedEvidenceDigest
    ? requiredDigest(focusedEvidenceDigest, "focusedEvidenceDigest")
    : null;
  if (
    authority.focusedEvidenceDigest
    && resolvedFocusedEvidenceDigest
    && authority.focusedEvidenceDigest !== resolvedFocusedEvidenceDigest
  ) {
    throw new Error("Claimed review successor focused evidence drifted from its authority projection.");
  }
  const recoverableAuthority = resolvedFocusedEvidenceDigest
    ? Object.freeze({ ...authority, focusedEvidenceDigest: resolvedFocusedEvidenceDigest })
    : authority;
  if (projectRootState(liveClaim.state) === "waiting-successor") {
    return supersedePredecessorAndPromoteWaitingLegacyReviewClaim({
      authority: recoverableAuthority,
      claimResult: {
        ...claimResult,
        claim: liveClaim,
        claimDigest: liveClaim.fenceRevision,
        ledgerRevision: statusResult.ledgerRevision,
        ledgerDigest: statusResult.ledgerDigest,
      },
      ledgerRepository: authority.ledgerRepository,
      targetRepository: authority.targetRepository,
      manifest,
      canonicalBaseSha: authority.canonicalBaseSha,
      branch: resolvedBranch,
      deviceId,
      sessionId,
      ttlSeconds,
      environment,
      inspect,
      invoke,
      verify,
    });
  }
  return reconcileAdmissionCloudAuthority({
    authority: recoverableAuthority,
    manifest,
    branch: resolvedBranch,
    headSha: resolvedHeadSha,
    pullRequestNumber,
    environment,
    inspect,
    verify,
  });
}
export function recoverIntegratedPreservedCloudAuthority({
  authority,
  integratedClaim,
  queuedSuccessor = null,
  manifest,
  branch,
  headSha,
  focusedEvidenceDigest = authority?.focusedEvidenceDigest,
  ttlSeconds = 1_800,
  deviceId = authority?.deviceId,
  sessionId = authority?.sessionId,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  requireAuthority(authority);
  const resolvedBranch = requiredText(branch, "branch");
  const resolvedHeadSha = requiredSha(headSha, "headSha");
  const resolvedFocusedEvidenceDigest = requiredDigest(
    focusedEvidenceDigest,
    "focusedEvidenceDigest",
  );
  const initialStatus = inspect({
    action: "status",
    ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository },
    environment,
  });
  let currentClaim = requireIntegratedReplayInventory({
    statusResult: initialStatus,
    authority,
    integratedClaim,
    queuedSuccessor,
    manifest,
    headSha: resolvedHeadSha,
    focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
  });
  let currentStatus = initialStatus;
  if (queuedSuccessor) {
    retireIntegratedReplayQueuedSuccessor({
      claim: queuedSuccessor,
      integratedClaim: currentClaim,
      targetRepository: authority.targetRepository,
      ledgerRepository: authority.ledgerRepository,
      deviceId,
      sessionId,
      branch: resolvedBranch,
      manifest,
      environment,
      invoke,
    });
    currentStatus = inspect({
      action: "status",
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository },
      environment,
    });
    currentClaim = requireIntegratedReplayInventory({
      statusResult: currentStatus,
      authority,
      integratedClaim: currentClaim,
      queuedSuccessor: null,
      manifest,
      headSha: resolvedHeadSha,
      focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
    });
  }

  let projectedAuthority;
  if (projectRootState(currentClaim.state) === "parked") {
    const recoveryEvidenceDigest = digestValue({
      schema: "agentic-integrated-preserved-recovery-evidence/v1",
      branch: resolvedBranch,
      claimId: currentClaim.claimId,
      candidateRevision: currentClaim.integration.candidateRevision,
      reviewRequestId: currentClaim.integration.reviewRequestId,
      integrationReceiptDigest: currentClaim.integrationReceiptDigest,
      operationReceiptDigest: currentClaim.operationReceiptDigest,
      manifestDigest: requiredDigest(manifest?.manifestDigest, "manifestDigest"),
      writeSetDigest: requiredDigest(manifest?.writeSetDigest, "writeSetDigest"),
    });
    const recoveredResult = invoke({
      action: "continue",
      ledgerRepository: authority.ledgerRepository,
      request: {
        targetRepository: authority.targetRepository,
        claimId: currentClaim.claimId,
        expectedFenceRevision: requiredDigest(
          currentClaim.fenceRevision,
          "integrated claim fenceRevision",
        ),
        expectedTransitionCounter: positiveInteger(
          currentClaim.transitionCounter,
          "integrated claim transitionCounter",
        ),
        mode: "recovery",
        ttlSeconds: positiveInteger(ttlSeconds, "ttlSeconds"),
        recoveryEvidenceDigest,
        deviceId: requiredText(deviceId, "deviceId"),
        sessionId: requiredText(sessionId, "sessionId"),
        idempotencyKey: [
          "integrated-preserved-recovery",
          currentClaim.claimId,
          currentClaim.transitionCounter,
          currentClaim.fenceRevision,
          recoveryEvidenceDigest,
        ].join(":"),
      },
      environment,
    });
    requireReadyResult(recoveredResult, {
      authority,
      manifest,
      canonicalBaseSha: authority.canonicalBaseSha,
      expectedState: "delivery_authorized",
      expectedLaneRevision: resolvedHeadSha,
    });
    requireRecoveredIntegratedReplayClaim({
      claim: recoveredResult.claim,
      reference: currentClaim,
      authority,
      manifest,
      headSha: resolvedHeadSha,
      focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
    });
    requiredDigest(
      recoveredResult.receipt?.receiptDigest,
      "integrated recovery receipt digest",
    );
    currentClaim = recoveredResult.claim;
    projectedAuthority = normalizeBoundAuthority({
      result: projectOperationLedgerDigest(recoveredResult),
      authority,
      manifest,
      deviceId,
      sessionId,
      focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
    });
  } else {
    projectedAuthority = normalizeBoundAuthority({
      result: {
        ...currentStatus,
        action: "continue",
        claim: currentClaim,
        claimDigest: currentClaim.fenceRevision,
      },
      authority,
      manifest,
      deviceId,
      sessionId,
      focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
    });
  }

  const verified = verifyDeliveryAuthorizedCloudAuthority({
    authority: projectedAuthority,
    manifest,
    headSha: resolvedHeadSha,
    branch: resolvedBranch,
    focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
    environment,
    inspect,
    invoke: verify,
  });
  requireRecoveredIntegratedReplayAuthority({
    recoveredAuthority: verified.authority,
    reference: currentClaim,
    authority,
    manifest,
    headSha: resolvedHeadSha,
    focusedEvidenceDigest: resolvedFocusedEvidenceDigest,
  });
  const overlappingCurrentClaimIds = requireIntegratedReplayConvergence({
    inventory: verified.verification.inventory,
    authority: verified.authority,
    reference: currentClaim,
    manifest,
  });
  const convergenceEvidence = Object.freeze({
    schema: "agentic-integrated-replay-convergence-evidence/v1",
    claimId: verified.authority.claimId,
    claimDigest: verified.authority.claimDigest,
    fenceRevision: verified.authority.claimDigest,
    claimLedgerRevision: verified.authority.claimLedgerRevision,
    transitionDigest: verified.authority.claimLedgerRevision,
    transitionCounter: verified.authority.transitionCounter,
    state: verified.authority.state,
    expiresAt: verified.authority.expiresAt,
    branch: resolvedBranch,
    canonicalBaseSha: verified.authority.canonicalBaseSha,
    candidateRevision: verified.authority.laneRevision,
    manifestDigest: requiredDigest(manifest?.manifestDigest, "manifestDigest"),
    writeSetDigest: verified.authority.writeSetDigest,
    leaseEpoch: verified.authority.leaseEpoch,
    reviewRequestId: verified.authority.reviewRequestId,
    focusedEvidenceDigest: verified.authority.focusedEvidenceDigest,
    currentOperationReceiptDigest: requiredDigest(
      verified.authority.operationReceiptDigest,
      "current operation receipt digest",
    ),
    integrationReceiptDigest: verified.authority.integrationReceiptDigest,
    integrationEvidenceDigest: digestValue(verified.authority.integration),
    currentQueuedDerivativeDisposition: "absent-from-verified-inventory",
    overlappingCurrentClaimIds,
    lifecycleAttribution: "not-reconstructed",
    observation: "current-state-only",
  });
  return Object.freeze({
    ...verified,
    convergenceEvidence,
    convergenceEvidenceDigest: digestValue(convergenceEvidence),
  });
}
export function claimLegacyReviewAdmissionCloudAuthority({
  ledgerRepository,
  targetRepository,
  manifest,
  canonicalBaseSha,
  branch,
  headSha,
  pullRequestNumber = null,
  deviceId,
  sessionId,
  workItemId = branch,
  predecessorClaimId = null,
  canonicalDescendantProof = null,
  leaseEpoch = 1,
  ttlSeconds = 1_800,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  const resolvedLedgerRepository = requiredText(
    ledgerRepository,
    "ledgerRepository",
  );
  const resolvedTargetRepository = requiredText(
    targetRepository || ledgerRepository,
    "targetRepository",
  );
  const resolvedCanonicalBaseSha = requiredSha(
    canonicalBaseSha,
    "canonicalBaseSha",
  );
  const resolvedHeadSha = requiredSha(headSha, "headSha");
  const resolvedBranch = requiredText(branch, "branch");
  const resolvedPredecessorClaimId = predecessorClaimId
    ? requiredDigest(predecessorClaimId, "predecessorClaimId") : null;
  const initialLaneRevision = canonicalDescendantProof
    ? resolvedHeadSha
    : resolvedCanonicalBaseSha;
  const requestForLeaseEpoch = claimLeaseEpoch => ({
    targetRepository: resolvedTargetRepository,
    branch: resolvedBranch,
    workItemId: requiredText(workItemId, "workItemId"),
    canonicalBaseSha: resolvedCanonicalBaseSha,
    headSha: initialLaneRevision,
    predecessorClaimId: resolvedPredecessorClaimId,
    canonicalDescendantProof,
    declaredWriteScope: manifest?.declaredWriteSet,
    leaseEpoch: positiveInteger(claimLeaseEpoch, "leaseEpoch"),
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    ttlSeconds: positiveInteger(ttlSeconds, "ttlSeconds"),
    idempotencyKey: [
      "legacy-review-claim",
      resolvedTargetRepository,
      resolvedBranch,
      resolvedCanonicalBaseSha,
      resolvedHeadSha,
      manifest?.writeSetDigest,
      ...(resolvedPredecessorClaimId ? [resolvedPredecessorClaimId] : []),
      ...(canonicalDescendantProof?.evidenceDigest ? [canonicalDescendantProof.evidenceDigest] : []),
      claimLeaseEpoch,
    ].join(":"),
  });
  let claimResult;
  try {
    claimResult = invoke({
      action: "claim",
      ledgerRepository: resolvedLedgerRepository,
      request: requestForLeaseEpoch(leaseEpoch),
      environment,
    });
  } catch (error) {
    const requiredLeaseEpoch = parseRequiredLeaseEpoch(error);
    if (!requiredLeaseEpoch || requiredLeaseEpoch === leaseEpoch) throw error;
    claimResult = invoke({
      action: "claim",
      ledgerRepository: resolvedLedgerRepository,
      request: requestForLeaseEpoch(requiredLeaseEpoch),
      environment,
    });
  }
  const claimedState = projectRootState(
    claimResult?.claim?.state || claimResult?.status || null,
  );
  const claimedContinuation = claimedState === "waiting-successor"
    ? supersedePredecessorAndPromoteWaitingLegacyReviewClaim({
      claimResult,
      ledgerRepository: resolvedLedgerRepository,
      targetRepository: resolvedTargetRepository,
      manifest,
      canonicalBaseSha: resolvedCanonicalBaseSha,
      branch: resolvedBranch,
      deviceId,
      sessionId,
      ttlSeconds,
      environment,
      inspect,
      invoke,
      verify,
    })
    : null;
  const claimed = claimedContinuation?.authority || (canonicalDescendantProof
    ? normalizeBoundAuthority({
      result: projectOperationLedgerDigest(claimResult),
      authority: {
        ledgerRepository: resolvedLedgerRepository,
        targetRepository: resolvedTargetRepository,
        deviceId,
        sessionId,
      },
      manifest,
      deviceId,
      sessionId,
    })
    : cloudAuthorityFromResult({
      ledgerRepository: resolvedLedgerRepository,
      targetRepository: resolvedTargetRepository,
      deviceId,
      sessionId,
      result: claimResult,
    }, {
      manifest,
      canonicalBaseSha: resolvedCanonicalBaseSha,
    }));
  if (resolvedHeadSha === resolvedCanonicalBaseSha) {
    return claimedContinuation || verifyAdmissionCloudAuthority({
      authority: claimed,
      manifest,
      canonicalBaseSha: resolvedCanonicalBaseSha,
      environment,
      inspect,
      invoke: verify,
    });
  }
  return bindAdmissionCloudAuthority({
    authority: claimed,
    manifest,
    branch: resolvedBranch,
    headSha: resolvedHeadSha,
    pullRequestNumber,
    deviceId,
    sessionId,
    environment,
    invoke,
    inspect,
    verify,
    returnVerification: true,
    idempotencyKey: [
      "legacy-review-bind",
      claimed.claimId,
      claimed.transitionCounter,
      claimed.claimDigest,
      resolvedHeadSha,
    ].join(":"),
  });
}
function parseRequiredLeaseEpoch(error) {
  const message = String(error?.message || "");
  const match = message.match(/leaseEpoch must be (\d+)/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}
function requireClaimResultSuccessor({
  authority,
  claimResult,
  manifest,
  headSha,
}) {
  if (
    claimResult?.schema !== "agentic-cloud-collaboration-result/v1"
    || claimResult.ok !== true
    || claimResult.action !== "claim"
  ) {
    throw new Error("Claimed review successor continuation requires its successful claim result.");
  }
  const claim = requireExactSuccessorIdentity({
    claim: claimResult.claim,
    manifest,
    canonicalBaseSha: authority.canonicalBaseSha,
    headSha,
    label: "claimed successor",
  });
  const authorityWriteSet = normalizeWriteSet(authority.cloudDeclaredWriteScope);
  const authorityState = projectRootState(authority.state);
  if (
    authority.claimId !== claim.claimId
    || authority.claimDigest !== (claimResult.claimDigest || claim.fenceRevision)
    || authority.ledgerRevision !== claimResult.ledgerRevision
    || authority.claimLedgerRevision !== claim.transitionDigest
    || authority.entrySchema !== claim.entrySchema
    || authority.claimIdentitySchema !== claim.claimIdentitySchema
    || authority.operationReceiptDigest !== claim.operationReceiptDigest
    || authority.canonicalBaseSha !== claim.canonicalBaseRevision
    || authority.laneRevision !== claim.laneRevision
    || authority.writeSetDigest !== claim.writeSetDigest
    || JSON.stringify(authorityWriteSet) !== JSON.stringify(claim.declaredWriteScope)
    || authority.leaseEpoch !== claim.leaseEpoch
    || authority.transitionCounter !== claim.transitionCounter
    || authorityState !== projectRootState(claim.state)
    || authority.expiresAt !== claim.expiresAt
    || (authority.reviewRequestId || null) !== claim.reviewRequestId
    || authority.manifestDigest !== requiredDigest(manifest?.manifestDigest, "manifestDigest")
  ) {
    throw new Error("Claimed review successor authority drifted from its claim result.");
  }
  return claim;
}
function requireLiveSuccessor({
  statusResult,
  authority,
  reference,
  manifest,
  headSha,
}) {
  requireCompleteStatusResult(statusResult);
  const matches = statusResult.claims.filter(
    claim => claim?.claimId === authority.claimId,
  );
  if (matches.length !== 1) {
    throw new Error("Claimed review successor continuation requires exactly one live successor claim.");
  }
  return requireExactSuccessorIdentity({
    claim: matches[0],
    reference,
    manifest,
    canonicalBaseSha: authority.canonicalBaseSha,
    headSha,
    label: "live successor",
  });
}
function requireExactSuccessorIdentity({
  claim,
  reference = null,
  manifest,
  canonicalBaseSha,
  headSha,
  label,
}) {
  const declaredWriteScope = normalizeWriteSet(claim?.declaredWriteScope);
  const state = projectRootState(requiredText(claim?.state, `${label} state`));
  if (!["waiting-successor", "active", "review_ready"].includes(state)) {
    throw new Error(`${label} state ${claim?.state || "missing"} is not resumable.`);
  }
  const entrySchema = requiredText(claim?.entrySchema, `${label} entrySchema`);
  const operationReceiptDigest = claim?.operationReceiptDigest
    ? requiredDigest(claim.operationReceiptDigest, `${label} operationReceiptDigest`)
    : null;
  if (entrySchema === "agentic-cloud-collaboration-entry/v2" && !operationReceiptDigest) {
    throw new Error(`${label} current entry requires an operation receipt digest.`);
  }
  const normalized = Object.freeze({
    ...claim,
    claimId: requiredDigest(claim?.claimId, `${label} claimId`),
    entrySchema,
    claimIdentitySchema: requiredText(
      claim?.claimIdentitySchema,
      `${label} claimIdentitySchema`,
    ),
    actorId: requiredText(claim?.actorId, `${label} actorId`),
    repositoryId: requiredText(claim?.repositoryId, `${label} repositoryId`),
    workItemId: requiredText(claim?.workItemId, `${label} workItemId`),
    predecessorClaimId: requiredDigest(
      claim?.predecessorClaimId,
      `${label} predecessorClaimId`,
    ),
    canonicalBaseRevision: requiredSha(
      claim?.canonicalBaseRevision,
      `${label} canonicalBaseRevision`,
    ),
    laneRevision: requiredSha(claim?.laneRevision, `${label} laneRevision`),
    declaredWriteScope,
    writeSetDigest: requiredDigest(claim?.writeSetDigest, `${label} writeSetDigest`),
    leaseEpoch: positiveInteger(claim?.leaseEpoch, `${label} leaseEpoch`),
    transitionCounter: positiveInteger(
      claim?.transitionCounter,
      `${label} transitionCounter`,
    ),
    reviewRequestId: claim?.reviewRequestId
      ? requiredText(claim.reviewRequestId, `${label} reviewRequestId`)
      : null,
    expiresAt: requiredInstant(claim?.expiresAt, `${label} expiresAt`),
    fenceRevision: requiredDigest(claim?.fenceRevision, `${label} fenceRevision`),
    transitionDigest: requiredDigest(
      claim?.transitionDigest,
      `${label} transitionDigest`,
    ),
    operationReceiptDigest,
  });
  const expectedWriteSet = normalizeWriteSet(manifest?.declaredWriteSet);
  if (
    normalized.canonicalBaseRevision !== requiredSha(canonicalBaseSha, "canonicalBaseSha")
    || normalized.laneRevision !== requiredSha(headSha, "headSha")
    || normalized.writeSetDigest !== requiredDigest(manifest?.writeSetDigest, "writeSetDigest")
    || normalized.writeSetDigest !== digestValue(normalized.declaredWriteScope)
    || JSON.stringify(normalized.declaredWriteScope) !== JSON.stringify(expectedWriteSet)
    || (reference && successorIdentityDigest(normalized) !== successorIdentityDigest(reference))
  ) {
    throw new Error(`${label} drifted from the exact claimed successor identity.`);
  }
  return normalized;
}
function successorIdentityDigest(claim) {
  return digestValue({
    claimId: claim.claimId,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    actorId: claim.actorId,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    predecessorClaimId: claim.predecessorClaimId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    declaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch,
  });
}
function requireSuccessorProgression(earlier, later, label) {
  const earlierState = projectRootState(earlier.state);
  const laterState = projectRootState(later.state);
  const stateRank = new Map([
    ["waiting-successor", 0],
    ["active", 1],
    ["review_ready", 2],
  ]);
  const sameTransitionDrift = (
    later.transitionCounter === earlier.transitionCounter
    && (
      laterState !== earlierState
      || later.fenceRevision !== earlier.fenceRevision
      || later.transitionDigest !== earlier.transitionDigest
      || later.operationReceiptDigest !== earlier.operationReceiptDigest
      || later.reviewRequestId !== earlier.reviewRequestId
      || later.expiresAt !== earlier.expiresAt
    )
  );
  if (
    later.transitionCounter < earlier.transitionCounter
    || stateRank.get(laterState) < stateRank.get(earlierState)
    || sameTransitionDrift
  ) {
    throw new Error(`${label} does not continue the claimed successor monotonically.`);
  }
}
function requireExpectedReviewIdentity(claim, reviewRequestId) {
  const expected = reviewRequestId
    ? requiredText(reviewRequestId, "reviewRequestId")
    : null;
  const actual = claim.reviewRequestId || null;
  if (
    (actual && actual !== expected)
    || (projectRootState(claim.state) === "review_ready" && !actual)
  ) {
    throw new Error("Claimed review successor drifted from the expected review identity.");
  }
}
function requireCompleteStatusResult(statusResult) {
  if (
    statusResult?.schema !== "agentic-cloud-collaboration-result/v1"
    || statusResult.ok !== true
    || statusResult.action !== "status"
    || statusResult.status !== "ready"
    || !Array.isArray(statusResult.claims)
  ) {
    throw new Error("Claimed review successor continuation requires a complete cloud status result.");
  }
  requiredSha(statusResult.ledgerRevision, "status ledgerRevision");
  requiredDigest(statusResult.ledgerDigest, "status ledgerDigest");
}
function requireUnchangedWaitingSuccessor({
  statusResult,
  waitingClaim,
  manifest,
  canonicalBaseSha,
}) {
  requireCompleteStatusResult(statusResult);
  const matches = statusResult.claims.filter(
    claim => claim?.claimId === waitingClaim.claimId,
  );
  if (matches.length !== 1) {
    throw new Error("Waiting successor promotion requires exactly one live successor claim.");
  }
  const current = requireExactSuccessorIdentity({
    claim: matches[0],
    reference: waitingClaim,
    manifest,
    canonicalBaseSha,
    headSha: waitingClaim.laneRevision,
    label: "waiting successor",
  });
  if (
    projectRootState(current.state) !== "waiting-successor"
    || current.transitionCounter !== waitingClaim.transitionCounter
    || current.fenceRevision !== waitingClaim.fenceRevision
    || current.transitionDigest !== waitingClaim.transitionDigest
    || current.operationReceiptDigest !== waitingClaim.operationReceiptDigest
  ) {
    throw new Error("Waiting successor changed before exact promotion.");
  }
}
function requireIntegratedReplayInventory({
  statusResult,
  authority,
  integratedClaim,
  queuedSuccessor,
  manifest,
  headSha,
  focusedEvidenceDigest,
}) {
  if (
    statusResult?.schema !== "agentic-cloud-collaboration-result/v1"
    || statusResult.ok !== true
    || statusResult.action !== "status"
    || statusResult.status !== "ready"
    || !Array.isArray(statusResult.claims)
  ) {
    throw new Error("Integrated-preserved replay requires a complete cloud status inventory.");
  }
  requiredSha(statusResult.ledgerRevision, "integrated replay ledgerRevision");
  requiredDigest(statusResult.ledgerDigest, "integrated replay ledgerDigest");
  const matches = statusResult.claims.filter(
    claim => claim?.claimId === authority.claimId,
  );
  if (matches.length !== 1) {
    throw new Error("Integrated-preserved replay requires exactly one same-claim authority.");
  }
  const current = requireIntegratedReplayClaim({
    claim: matches[0],
    authority,
    manifest,
    headSha,
    focusedEvidenceDigest,
  });
  requireSameIntegratedClaimSnapshot(current, integratedClaim);

  const derivatives = statusResult.claims.filter(
    claim => claim?.predecessorClaimId === current.claimId,
  );
  if (queuedSuccessor) {
    if (derivatives.length !== 1
      || derivatives[0]?.claimId !== queuedSuccessor.claimId) {
      throw new Error("Integrated-preserved replay queued successor inventory drifted.");
    }
    requireIntegratedReplayQueuedSuccessor({
      claim: derivatives[0],
      reference: queuedSuccessor,
      integratedClaim: current,
      manifest,
      headSha,
    });
  } else if (derivatives.length > 0) {
    throw new Error("Integrated-preserved replay found an unexpected queued derivative.");
  }

  const allowedClaimIds = new Set([
    current.claimId,
    ...(queuedSuccessor ? [queuedSuccessor.claimId] : []),
  ]);
  const competing = statusResult.claims.filter(claim => {
    if (allowedClaimIds.has(claim?.claimId)) return false;
    if (claim?.reviewRequestId === current.reviewRequestId) return true;
    try {
      return writeSetsOverlap(claim?.declaredWriteScope, manifest.declaredWriteSet);
    } catch {
      return true;
    }
  });
  if (competing.length > 0) {
    throw new Error("Integrated-preserved replay found competing cloud authority.");
  }
  return current;
}
function requireIntegratedReplayClaim({
  claim,
  authority,
  manifest,
  headSha,
  focusedEvidenceDigest,
}) {
  const normalizedWriteSet = normalizeWriteSet(claim?.declaredWriteScope);
  const integration = requireIntegratedReplayEvidence(claim?.integration, {
    headSha,
    reviewRequestId: authority.reviewRequestId,
    focusedEvidenceDigest,
  });
  const claimId = requiredDigest(claim?.claimId, "integrated replay claimId");
  requiredText(claim?.actorId, "integrated replay actorId");
  requiredText(claim?.repositoryId, "integrated replay repositoryId");
  requiredText(claim?.workItemId, "integrated replay workItemId");
  requiredText(claim?.entrySchema, "integrated replay entrySchema");
  requiredText(claim?.claimIdentitySchema, "integrated replay claimIdentitySchema");
  const canonicalBaseRevision = requiredSha(
    claim?.canonicalBaseRevision,
    "integrated replay canonicalBaseRevision",
  );
  const laneRevision = requiredSha(claim?.laneRevision, "integrated replay laneRevision");
  const writeSetDigest = requiredDigest(claim?.writeSetDigest, "integrated replay writeSetDigest");
  const leaseEpoch = positiveInteger(claim?.leaseEpoch, "integrated replay leaseEpoch");
  const transitionCounter = positiveInteger(
    claim?.transitionCounter,
    "integrated replay transitionCounter",
  );
  const reviewRequestId = requiredText(
    claim?.reviewRequestId,
    "integrated replay reviewRequestId",
  );
  requiredDigest(claim?.integrationReceiptDigest, "integrationReceiptDigest");
  requiredDigest(claim?.fenceRevision, "integrated replay fenceRevision");
  requiredDigest(claim?.transitionDigest, "integrated replay transitionDigest");
  requiredDigest(claim?.operationReceiptDigest, "integrated replay operationReceiptDigest");
  requiredInstant(claim?.expiresAt, "integrated replay expiresAt");
  if (
    claimId !== authority.claimId
    || !["delivery_authorized", "parked"].includes(projectRootState(claim?.state))
    || canonicalBaseRevision !== authority.canonicalBaseSha
    || laneRevision !== headSha
    || writeSetDigest !== manifest.writeSetDigest
    || claim.writeSetDigest !== digestValue(normalizedWriteSet)
    || JSON.stringify(normalizedWriteSet)
      !== JSON.stringify(normalizeWriteSet(manifest.declaredWriteSet))
    || leaseEpoch !== authority.leaseEpoch
    || transitionCounter < authority.transitionCounter
    || reviewRequestId !== authority.reviewRequestId
  ) {
    throw new Error("Integrated-preserved replay claim drifted from the reviewed authority.");
  }
  return Object.freeze({ ...claim, declaredWriteScope: normalizedWriteSet, integration });
}
function requireIntegratedReplayEvidence(value, {
  headSha,
  reviewRequestId,
  focusedEvidenceDigest,
}) {
  const normalized = Object.freeze({
    candidateRevision: requiredSha(value?.candidateRevision, "integration candidateRevision"),
    reviewRequestId: requiredText(value?.reviewRequestId, "integration reviewRequestId"),
    focusedEvidenceDigest: requiredDigest(value?.focusedEvidenceDigest, "integration focusedEvidenceDigest"),
    dependencyClosureDigest: requiredDigest(value?.dependencyClosureDigest, "integration dependencyClosureDigest"),
    namedChecksDigest: requiredDigest(value?.namedChecksDigest, "integration namedChecksDigest"),
    handoffEvidenceDigest: requiredDigest(value?.handoffEvidenceDigest, "integration handoffEvidenceDigest"),
    operatorDecisionDigest: requiredDigest(value?.operatorDecisionDigest, "integration operatorDecisionDigest"),
    integrationIntentDigest: requiredDigest(value?.integrationIntentDigest, "integration integrationIntentDigest"),
    integratedAt: requiredInstant(value?.integratedAt, "integration integratedAt"),
  });
  if (
    !value
    || Object.keys(value).length !== Object.keys(normalized).length
    || normalized.candidateRevision !== headSha
    || normalized.reviewRequestId !== reviewRequestId
    || normalized.focusedEvidenceDigest !== focusedEvidenceDigest
  ) {
    throw new Error("Integrated-preserved replay did not preserve exact integration evidence.");
  }
  return normalized;
}
function requireSameIntegratedClaimSnapshot(claim, reference) {
  const snapshotKeys = [
    "claimId",
    "entrySchema",
    "claimIdentitySchema",
    "state",
    "actorId",
    "repositoryId",
    "workItemId",
    "canonicalBaseRevision",
    "laneRevision",
    "writeSetDigest",
    "leaseEpoch",
    "transitionCounter",
    "reviewRequestId",
    "predecessorClaimId",
    "expiresAt",
    "fenceRevision",
    "transitionDigest",
    "operationReceiptDigest",
    "integrationReceiptDigest",
  ];
  const exact = reference
    && snapshotKeys.every(key => claim?.[key] === reference?.[key])
    && JSON.stringify(claim.declaredWriteScope)
      === JSON.stringify(normalizeWriteSet(reference.declaredWriteScope))
    && digestValue(claim.integration) === digestValue(reference.integration);
  if (!exact) {
    throw new Error("Integrated-preserved replay claim changed after controller preflight.");
  }
}
function requireIntegratedReplayQueuedSuccessor({
  claim,
  reference,
  integratedClaim,
  manifest,
  headSha,
}) {
  const normalizedWriteSet = normalizeWriteSet(claim?.declaredWriteScope);
  const snapshotKeys = [
    "claimId",
    "entrySchema",
    "claimIdentitySchema",
    "state",
    "actorId",
    "repositoryId",
    "workItemId",
    "canonicalBaseRevision",
    "laneRevision",
    "writeSetDigest",
    "leaseEpoch",
    "transitionCounter",
    "reviewRequestId",
    "predecessorClaimId",
    "expiresAt",
    "fenceRevision",
    "transitionDigest",
    "operationReceiptDigest",
    "integrationReceiptDigest",
  ];
  if (
    requiredDigest(claim?.claimId, "queued successor claimId") === integratedClaim.claimId
    || projectRootState(claim?.state) !== "waiting-successor"
    || claim.actorId !== integratedClaim.actorId
    || claim.repositoryId !== integratedClaim.repositoryId
    || claim.workItemId !== integratedClaim.workItemId
    || claim.predecessorClaimId !== integratedClaim.claimId
    || claim.canonicalBaseRevision !== integratedClaim.canonicalBaseRevision
    || claim.laneRevision !== headSha
    || claim.writeSetDigest !== manifest.writeSetDigest
    || claim.writeSetDigest !== digestValue(normalizedWriteSet)
    || JSON.stringify(normalizedWriteSet)
      !== JSON.stringify(normalizeWriteSet(manifest.declaredWriteSet))
    || claim.leaseEpoch !== integratedClaim.leaseEpoch + 1
    || claim.reviewRequestId !== null
    || claim.integration !== null
    || claim.integrationReceiptDigest !== null
    || !snapshotKeys.every(key => claim?.[key] === reference?.[key])
    || JSON.stringify(normalizedWriteSet)
      !== JSON.stringify(normalizeWriteSet(reference?.declaredWriteScope))
  ) {
    throw new Error("Integrated-preserved replay queued successor drifted from its exact derivative.");
  }
}
function requireRecoveredIntegratedReplayClaim({
  claim,
  reference,
  authority,
  manifest,
  headSha,
  focusedEvidenceDigest,
}) {
  const recovered = requireIntegratedReplayClaim({
    claim,
    authority,
    manifest,
    headSha,
    focusedEvidenceDigest,
  });
  const sameSubject = [
    "claimId",
    "entrySchema",
    "claimIdentitySchema",
    "actorId",
    "repositoryId",
    "workItemId",
    "canonicalBaseRevision",
    "laneRevision",
    "writeSetDigest",
    "leaseEpoch",
    "reviewRequestId",
    "predecessorClaimId",
    "integrationReceiptDigest",
  ].every(key => recovered[key] === reference[key]);
  if (
    !sameSubject
    || projectRootState(recovered.state) !== "delivery_authorized"
    || recovered.transitionCounter <= reference.transitionCounter
    || JSON.stringify(recovered.declaredWriteScope) !== JSON.stringify(reference.declaredWriteScope)
    || digestValue(recovered.integration) !== digestValue(reference.integration)
  ) {
    throw new Error("Recovered integrated-preserved claim changed its reviewed integration identity.");
  }
}
function requireRecoveredIntegratedReplayAuthority({
  recoveredAuthority,
  reference,
  authority,
  manifest,
  headSha,
  focusedEvidenceDigest,
}) {
  if (
    recoveredAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || recoveredAuthority.claimId !== authority.claimId
    || recoveredAuthority.canonicalBaseSha !== authority.canonicalBaseSha
    || recoveredAuthority.laneRevision !== headSha
    || recoveredAuthority.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(recoveredAuthority.cloudDeclaredWriteScope))
      !== JSON.stringify(normalizeWriteSet(manifest.declaredWriteSet))
    || recoveredAuthority.leaseEpoch !== authority.leaseEpoch
    || recoveredAuthority.reviewRequestId !== authority.reviewRequestId
    || recoveredAuthority.state !== "delivery_authorized"
    || recoveredAuthority.focusedEvidenceDigest !== focusedEvidenceDigest
    || recoveredAuthority.operationReceiptDigest !== reference.operationReceiptDigest
    || recoveredAuthority.integrationReceiptDigest !== reference.integrationReceiptDigest
    || digestValue(recoveredAuthority.integration) !== digestValue(reference.integration)
  ) {
    throw new Error("Verified integrated-preserved authority changed its reviewed integration identity.");
  }
}
function requireIntegratedReplayConvergence({
  inventory,
  authority,
  reference,
  manifest,
}) {
  if (!inventory || !Array.isArray(inventory.claims)) {
    throw new Error("Integrated-preserved replay requires a verified current-claim inventory.");
  }
  const candidates = inventory.claims.filter(
    claim => claim.claimId === authority.claimId,
  );
  if (
    candidates.length !== 1
    || candidates[0].state !== "delivery_authorized"
    || candidates[0].actorId !== reference.actorId
    || candidates[0].repositoryId !== reference.repositoryId
    || candidates[0].workItemId !== reference.workItemId
    || candidates[0].canonicalBaseRevision !== authority.canonicalBaseSha
    || candidates[0].laneRevision !== authority.laneRevision
    || candidates[0].writeSetDigest !== manifest.writeSetDigest
    || candidates[0].leaseEpoch !== authority.leaseEpoch
    || candidates[0].transitionCounter !== authority.transitionCounter
    || candidates[0].operationReceiptDigest !== authority.operationReceiptDigest
  ) {
    throw new Error("Integrated-preserved replay final inventory drifted from the verified authority.");
  }
  const overlapping = inventory.claims.filter(claim => {
    if (claim.claimId === authority.claimId) return false;
    if (claim.reviewRequestId === authority.reviewRequestId) return true;
    try {
      return writeSetsOverlap(claim.declaredWriteScope, manifest.declaredWriteSet);
    } catch {
      return true;
    }
  });
  if (overlapping.length > 0) {
    throw new Error(
      "Integrated-preserved replay retained a current queued, overlapping, or duplicate-review authority.",
    );
  }
  return Object.freeze([]);
}
function retireIntegratedReplayQueuedSuccessor({
  claim,
  integratedClaim,
  targetRepository,
  ledgerRepository,
  deviceId,
  sessionId,
  branch,
  manifest,
  environment,
  invoke,
}) {
  const retirementEvidence = {
    schema: "agentic-integrated-replay-queued-successor-retirement/v1",
    branch: requiredText(branch, "branch"),
    integratedClaimId: requiredDigest(integratedClaim?.claimId, "integrated claimId"),
    queuedSuccessorClaimId: requiredDigest(claim?.claimId, "queued successor claimId"),
    candidateRevision: requiredSha(integratedClaim?.laneRevision, "candidateRevision"),
    integrationReceiptDigest: requiredDigest(
      integratedClaim?.integrationReceiptDigest,
      "integrationReceiptDigest",
    ),
    manifestDigest: requiredDigest(manifest?.manifestDigest, "manifestDigest"),
    writeSetDigest: requiredDigest(manifest?.writeSetDigest, "writeSetDigest"),
  };
  const result = invoke({
    action: "retire",
    ledgerRepository,
    request: {
      targetRepository,
      claimId: claim.claimId,
      expectedFenceRevision: requiredDigest(
        claim.fenceRevision,
        "queued successor fenceRevision",
      ),
      expectedTransitionCounter: positiveInteger(
        claim.transitionCounter,
        "queued successor transitionCounter",
      ),
      reason: "superseded",
      finalRevision: requiredSha(claim.laneRevision, "queued successor laneRevision"),
      reviewRequestId: null,
      bytesDigest: digestValue({ ...retirementEvidence, operation: "retire-bytes" }),
      namedChecksDigest: digestValue({ ...retirementEvidence, operation: "retire-checks" }),
      handoffEvidenceDigest: digestValue({ ...retirementEvidence, operation: "retire-handoff" }),
      deviceId: requiredText(deviceId, "deviceId"),
      sessionId: requiredText(sessionId, "sessionId"),
      idempotencyKey: [
        "integrated-replay-retire-queued-successor",
        claim.claimId,
        claim.transitionCounter,
        claim.fenceRevision,
      ].join(":"),
    },
    environment,
  });
  if (
    result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "retire"
    || result.claim?.claimId !== claim.claimId
    || projectRootState(result.claim?.state) !== "released"
  ) {
    throw new Error("Integrated-preserved replay did not retire the exact queued successor.");
  }
  return requiredDigest(
    result.receipt?.receiptDigest,
    "queued successor retirement receipt digest",
  );
}
function supersedePredecessorAndPromoteWaitingLegacyReviewClaim({
  authority = null,
  claimResult,
  ledgerRepository,
  targetRepository,
  manifest,
  canonicalBaseSha,
  branch,
  deviceId,
  sessionId,
  ttlSeconds,
  environment,
  inspect,
  invoke,
  verify,
}) {
  const waitingClaim = claimResult?.claim;
  const waitingClaimId = requiredDigest(waitingClaim?.claimId, "waiting claimId");
  const predecessorClaimId = requiredDigest(
    waitingClaim?.predecessorClaimId,
    "waiting predecessorClaimId",
  );
  const statusResult = inspect({
    action: "status",
    ledgerRepository,
    request: { targetRepository },
    environment,
  });
  requireUnchangedWaitingSuccessor({
    statusResult,
    waitingClaim,
    manifest,
    canonicalBaseSha,
  });
  const predecessor = statusResult?.claims?.find(
    claim => claim?.claimId === predecessorClaimId,
  );
  const predecessorState = predecessor
    ? projectRootState(predecessor.state)
    : null;
  if (
    predecessor
    && !["parked", "active", "waiting-successor", "delivery_authorized"].includes(predecessorState)
  ) {
    throw new Error(
      `Legacy review waiting successor requires a dormant-preserved, current, waiting, or integrated-preserved predecessor; received ${predecessor.state || "missing"}.`,
    );
  }
  if (predecessor && predecessor.actorId !== waitingClaim.actorId) {
    throw new Error("Legacy review waiting successor cannot supersede another actor's predecessor claim.");
  }
  const successionEvidence = {
    schema: "agentic-legacy-review-successor-promotion/v1",
    branch: requiredText(branch, "branch"),
    predecessorClaimId,
    successorClaimId: waitingClaimId,
    canonicalBaseSha: requiredSha(canonicalBaseSha, "canonicalBaseSha"),
    manifestDigest: requiredDigest(manifest?.manifestDigest, "manifestDigest"),
    writeSetDigest: requiredDigest(manifest?.writeSetDigest, "writeSetDigest"),
  };
  if (predecessor) {
    const integratedPredecessor = predecessorState === "delivery_authorized";
    invoke({
      action: "retire",
      ledgerRepository,
      request: {
        targetRepository,
        claimId: predecessorClaimId,
        expectedFenceRevision: requiredDigest(
          predecessor.fenceRevision,
          "predecessor fenceRevision",
        ),
        expectedTransitionCounter: positiveInteger(
          predecessor.transitionCounter,
          "predecessor transitionCounter",
        ),
        reason: integratedPredecessor ? "integrated" : "superseded",
        finalRevision: requiredSha(
          predecessor.laneRevision,
          "predecessor laneRevision",
        ),
        reviewRequestId: predecessor.reviewRequestId || null,
        bytesDigest: digestValue({
          ...successionEvidence,
          operation: "retire-bytes",
        }),
        namedChecksDigest: digestValue({
          ...successionEvidence,
          operation: "retire-checks",
        }),
        handoffEvidenceDigest: digestValue({
          ...successionEvidence,
          operation: "retire-handoff",
        }),
        integrationReceiptDigest: integratedPredecessor
          ? requiredDigest(
            predecessor.integrationReceiptDigest,
            "integrated predecessor integrationReceiptDigest",
          )
          : null,
        deviceId: requiredText(deviceId, "deviceId"),
        sessionId: requiredText(sessionId, "sessionId"),
        idempotencyKey: [
          "legacy-review-supersede",
          predecessorClaimId,
          waitingClaimId,
          requiredDigest(waitingClaim.fenceRevision, "waiting fenceRevision"),
        ].join(":"),
      },
      environment,
    });
  }
  const refreshStatusResult = inspect({
    action: "status",
    ledgerRepository,
    request: { targetRepository },
    environment,
  });
  requireUnchangedWaitingSuccessor({
    statusResult: refreshStatusResult,
    waitingClaim,
    manifest,
    canonicalBaseSha,
  });
  const competingWaitingSuccessors = Array.isArray(refreshStatusResult?.claims)
    ? refreshStatusResult.claims.filter((claim) => (
      claim?.claimId !== waitingClaimId
      && claim?.actorId === waitingClaim.actorId
      && claim?.workItemId === waitingClaim.workItemId
      && claim?.predecessorClaimId === waitingClaim.predecessorClaimId
      && claim?.canonicalBaseRevision === waitingClaim.canonicalBaseRevision
      && claim?.laneRevision === waitingClaim.laneRevision
      && claim?.writeSetDigest === waitingClaim.writeSetDigest
      && claim?.leaseEpoch === waitingClaim.leaseEpoch
      && JSON.stringify(normalizeWriteSet(claim?.declaredWriteScope))
        === JSON.stringify(normalizeWriteSet(waitingClaim.declaredWriteScope))
      && projectRootState(claim?.state) === "waiting-successor"
    ))
    : [];
  for (const competing of competingWaitingSuccessors) {
    retireLegacyReviewQueuedSuccessor({
      claim: competing,
      targetRepository,
      ledgerRepository,
      deviceId,
      sessionId,
      branch,
      predecessorClaimId,
      waitingClaimId,
      environment,
      invoke,
    });
  }
  const promotedResult = invoke({
    action: "continue",
    ledgerRepository,
    request: {
      targetRepository,
      claimId: waitingClaimId,
      expectedFenceRevision: requiredDigest(
        waitingClaim.fenceRevision,
        "waiting fenceRevision",
      ),
      expectedTransitionCounter: positiveInteger(
        waitingClaim.transitionCounter,
        "waiting transitionCounter",
      ),
      mode: "promote",
      ttlSeconds: positiveInteger(ttlSeconds, "ttlSeconds"),
      deviceId: requiredText(deviceId, "deviceId"),
      sessionId: requiredText(sessionId, "sessionId"),
      idempotencyKey: [
        "legacy-review-promote",
        waitingClaimId,
        positiveInteger(waitingClaim.transitionCounter, "waiting transitionCounter"),
        requiredDigest(waitingClaim.fenceRevision, "waiting fenceRevision"),
      ].join(":"),
    },
    environment,
  });
  const promoted = authority
    ? normalizeBoundAuthority({
      result: projectOperationLedgerDigest(promotedResult),
      authority,
      manifest,
      deviceId,
      sessionId,
      focusedEvidenceDigest: authority.focusedEvidenceDigest || null,
    })
    : cloudAuthorityFromResult({
      ledgerRepository,
      targetRepository,
      deviceId,
      sessionId,
      result: promotedResult,
    }, {
      manifest,
      canonicalBaseSha,
    });
  return verifyAdmissionCloudAuthority({
    authority: promoted,
    manifest,
    canonicalBaseSha,
    environment,
    inspect,
    invoke: verify,
  });
}
function retireLegacyReviewQueuedSuccessor({
  claim,
  targetRepository,
  ledgerRepository,
  deviceId,
  sessionId,
  branch,
  predecessorClaimId,
  waitingClaimId,
  environment,
  invoke,
}) {
  const claimId = requiredDigest(claim?.claimId, "queued successor claimId");
  const supersessionEvidence = {
    schema: "agentic-legacy-review-queued-successor-retirement/v1",
    branch: requiredText(branch, "branch"),
    predecessorClaimId: requiredDigest(
      predecessorClaimId,
      "predecessorClaimId",
    ),
    survivingSuccessorClaimId: requiredDigest(
      waitingClaimId,
      "waitingClaimId",
    ),
    retiredSuccessorClaimId: claimId,
  };
  invoke({
    action: "retire",
    ledgerRepository,
    request: {
      targetRepository,
      claimId,
      expectedFenceRevision: requiredDigest(
        claim?.fenceRevision,
        "queued successor fenceRevision",
      ),
      expectedTransitionCounter: positiveInteger(
        claim?.transitionCounter,
        "queued successor transitionCounter",
      ),
      reason: "superseded",
      finalRevision: requiredSha(
        claim?.laneRevision,
        "queued successor laneRevision",
      ),
      reviewRequestId: claim?.reviewRequestId || null,
      bytesDigest: digestValue({
        ...supersessionEvidence,
        operation: "retire-bytes",
      }),
      namedChecksDigest: digestValue({
        ...supersessionEvidence,
        operation: "retire-checks",
      }),
      handoffEvidenceDigest: digestValue({
        ...supersessionEvidence,
        operation: "retire-handoff",
      }),
      deviceId: requiredText(deviceId, "deviceId"),
      sessionId: requiredText(sessionId, "sessionId"),
      idempotencyKey: [
        "legacy-review-retire-queued-successor",
        claimId,
        requiredDigest(claim?.fenceRevision, "queued successor fenceRevision"),
      ].join(":"),
    },
    environment,
  });
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
    action: "continue",
    ledgerRepository: authority.ledgerRepository,
    request: {
      targetRepository: authority.targetRepository,
      deviceId: requiredText(deviceId, "deviceId"),
      sessionId: requiredText(sessionId, "sessionId"),
      claimId: authority.claimId,
      expectedFenceRevision: authority.claimDigest,
      expectedTransitionCounter: authority.transitionCounter,
      mode: "renewal",
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
    result: projectOperationLedgerDigest(result),
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
  authority,
  manifest,
  branch,
  headSha,
  pullRequestNumber = null,
  reviewRequestId = null,
  focusedEvidenceDigest = null,
  deviceId,
  sessionId,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  const evidenceDigest = focusedEvidenceDigest
    ? requiredDigest(focusedEvidenceDigest, "focusedEvidenceDigest")
    : digestValue({
      schema: "agentic-focused-review-evidence/v1",
      command: "npm run check",
      branch: requiredText(branch, "branch"),
      headSha: requiredSha(headSha, "headSha"),
      pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber"),
      admittedReportDigest: requiredDigest(manifest?.admittedReportDigest, "admittedReportDigest"),
    });
  let current = reconcileAdmissionCloudAuthority({
    authority,
    manifest,
    branch,
    headSha,
    pullRequestNumber,
    allowPriorLaneRevision: true, environment, inspect, verify,
  });
  if (current.authority.state === "review_ready") return current;
  if (current.authority.laneRevision !== headSha) {
    current = bindAdmissionCloudAuthority({
      authority: current.authority,
      manifest,
      branch,
      headSha,
      pullRequestNumber,
      reviewRequestId,
      deviceId,
      sessionId,
      environment,
      invoke,
      inspect,
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
    branch,
    canonicalBaseSha: active.canonicalBaseSha,
    headSha,
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    claimId: active.claimId,
    expectedFenceRevision: active.claimDigest,
    expectedTransitionCounter: active.transitionCounter,
    focusedEvidenceDigest: evidenceDigest,
    ...(pullRequestNumber
      ? { pullRequestNumber }
      : {}),
    ...(reviewRequestId
      ? { reviewRequestId: requiredText(reviewRequestId, "reviewRequestId") }
      : {}),
    idempotencyKey: [
      "device-review-ready", active.claimId, active.transitionCounter,
      active.claimDigest, headSha, evidenceDigest,
    ].join(":"),
  };
  let result;
  try {
    result = invoke({
      action: "continue",
      ledgerRepository: active.ledgerRepository,
      request: { ...request, mode: "review" },
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
    result: projectOperationLedgerDigest(result), authority: active, manifest, deviceId, sessionId,
    focusedEvidenceDigest: evidenceDigest,
  });
  return verifyReviewReadyAdmissionCloudAuthority({
    authority: ready, manifest, headSha, branch,
    focusedEvidenceDigest: evidenceDigest,
    environment, inspect, invoke: verify,
  });
}
export function authorizeDeliveryAdmissionCloudAuthority({
  authority,
  manifest,
  branch,
  headSha,
  pullRequestNumber = null,
  reviewRequestId = null,
  allowProtectedMainRefresh = false,
  dependencyClosureDigest,
  namedChecksDigest,
  handoffEvidenceDigest,
  operatorDecisionDigest,
  integrationIntentDigest,
  deviceId,
  sessionId,
  environment = process.env,
  invoke = invokeRepositoryCloudAction,
  inspect = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  const expectedIntegration = Object.freeze({
    dependencyClosureDigest: requiredDigest(dependencyClosureDigest, "dependencyClosureDigest"),
    namedChecksDigest: requiredDigest(namedChecksDigest, "namedChecksDigest"),
    handoffEvidenceDigest: requiredDigest(handoffEvidenceDigest, "handoffEvidenceDigest"),
    operatorDecisionDigest: requiredDigest(operatorDecisionDigest, "operatorDecisionDigest"),
    integrationIntentDigest: requiredDigest(integrationIntentDigest, "integrationIntentDigest"),
  });
  const resolvedReviewRequestId = reviewRequestId || authority?.reviewRequestId || null;
  const reconciledPullRequestNumber = allowProtectedMainRefresh
    ? null
    : pullRequestNumber;
  const current = reconcileAdmissionCloudAuthority({
    authority,
    manifest,
    branch,
    headSha,
    pullRequestNumber: reconciledPullRequestNumber,
    environment, inspect, verify,
  });
  if (current.authority.state === "delivery_authorized") {
    const recorded = current.authority.integration;
    const evidenceMatches = recorded
      && recorded.candidateRevision === headSha
      && recorded.reviewRequestId === resolvedReviewRequestId
      && recorded.focusedEvidenceDigest === current.authority.focusedEvidenceDigest
      && Object.entries(expectedIntegration).every(([key, value]) => recorded[key] === value);
    if (!evidenceMatches || !current.authority.integrationReceiptDigest
      || (authority.integrationReceiptDigest && authority.integrationReceiptDigest !== current.authority.integrationReceiptDigest)) {
      throw new Error("Existing delivery authorization does not join the exact integration evidence and receipt.");
    }
    return current;
  }
  if (current.authority.state !== "review_ready") {
    throw new Error("Delivery authorization requires the exact review-ready cloud claim.");
  }
  const reviewed = current.authority;
  const focusedEvidenceDigest = requiredDigest(
    reviewed.focusedEvidenceDigest,
    "focusedEvidenceDigest",
  );
  const explicitOperatorDecision = expectedIntegration.operatorDecisionDigest;
  const explicitIntegrationIntent = expectedIntegration.integrationIntentDigest;
  const result = invoke({
    action: "integrate",
    ledgerRepository: reviewed.ledgerRepository,
    request: {
      targetRepository: reviewed.targetRepository,
      branch,
      headSha,
      deviceId: requiredText(deviceId, "deviceId"),
      sessionId: requiredText(sessionId, "sessionId"),
      claimId: reviewed.claimId,
      expectedFenceRevision: reviewed.claimDigest,
      expectedTransitionCounter: reviewed.transitionCounter,
      focusedEvidenceDigest,
      dependencyClosureDigest: expectedIntegration.dependencyClosureDigest,
      namedChecksDigest: expectedIntegration.namedChecksDigest,
      handoffEvidenceDigest: expectedIntegration.handoffEvidenceDigest,
      operatorDecisionDigest: explicitOperatorDecision,
      integrationIntentDigest: explicitIntegrationIntent,
      ...(allowProtectedMainRefresh
        ? { reviewRequestId: requiredText(resolvedReviewRequestId, "reviewRequestId") }
        : { pullRequestNumber: positiveInteger(pullRequestNumber, "pullRequestNumber") }),
      idempotencyKey: [
        "device-delivery-authorize", reviewed.claimId,
        reviewed.transitionCounter, reviewed.claimDigest, headSha,
        ...Object.values(expectedIntegration),
      ].join(":"),
    },
    environment,
  });
  requireReadyResult(result, {
    authority: reviewed,
    manifest,
    canonicalBaseSha: reviewed.canonicalBaseSha,
    expectedState: "delivery_authorized",
    expectedLaneRevision: headSha,
  });
  const authorized = Object.freeze({
    ...normalizeBoundAuthority({
      result: projectOperationLedgerDigest(result), authority: reviewed, manifest, deviceId, sessionId,
      focusedEvidenceDigest,
    }),
    operatorDecisionDigest: explicitOperatorDecision,
    integrationIntentDigest: explicitIntegrationIntent,
  });
  return verifyDeliveryAuthorizedCloudAuthority({
    authority: authorized, manifest, headSha, branch,
    focusedEvidenceDigest, environment, inspect, invoke: verify,
  });
}

function projectOperationLedgerDigest(result) {
  if (result?.ledgerDigest) return result;
  return {
    ...result,
    ledgerDigest: result?.receipt?.ledgerDigest,
  };
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
