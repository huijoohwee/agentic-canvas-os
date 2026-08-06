import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { markOperationDerivedCloudVerification } from "./scoped-lane-admission-lib.mjs";
import { normalizeBoundAuthority, normalizeCurrentClaimInventory, positiveInteger,
  cloudAuthorityFromResult, projectRootState, reconcileCloudAuthorityProjection, requireAuthority, requiredDigest,
  requiredInstant, requiredSha, requiredText, requireReadyResult, rootStateForProjection,
} from "./scoped-lane-cloud-reconciliation.mjs";
const CLOUD_SCRIPT = fileURLToPath(new URL("./cloud-collaboration.mjs", import.meta.url));
export { attachCloudHeartbeatMachineEvidence, cloudAuthorityFromResult } from "./scoped-lane-cloud-reconciliation.mjs";
export function verifyAdmissionCloudAuthority({ authority, manifest, canonicalBaseSha,
  environment = process.env, inspect = invokeRepositoryCloudAction,
  invoke = invokeRepositoryCloudVerifier } = {}) {
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
export function verifyDeliveryAuthorizedCloudAuthority({
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
    expectedState: "delivery_authorized",
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
  const requestForLeaseEpoch = claimLeaseEpoch => ({
    targetRepository: resolvedTargetRepository,
    branch: resolvedBranch,
    workItemId: requiredText(workItemId, "workItemId"),
    canonicalBaseSha: resolvedCanonicalBaseSha,
    headSha: resolvedCanonicalBaseSha,
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
  const claimed = claimedState === "waiting-successor"
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
    : cloudAuthorityFromResult({
      ledgerRepository: resolvedLedgerRepository,
      targetRepository: resolvedTargetRepository,
      deviceId,
      sessionId,
      result: claimResult,
    }, {
      manifest,
      canonicalBaseSha: resolvedCanonicalBaseSha,
    });
  if (resolvedHeadSha === resolvedCanonicalBaseSha) {
    return verifyAdmissionCloudAuthority({
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
function supersedePredecessorAndPromoteWaitingLegacyReviewClaim({
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
  const predecessor = statusResult?.claims?.find(
    claim => claim?.claimId === predecessorClaimId,
  );
  const predecessorState = predecessor
    ? projectRootState(predecessor.state)
    : null;
  if (
    predecessor
    && !["parked", "active"].includes(predecessorState)
  ) {
    throw new Error(
      `Legacy review waiting successor requires a dormant-preserved or current predecessor; received ${predecessor.state || "missing"}.`,
    );
  }
  if (predecessor && predecessor.actorId !== waitingClaim.actorId) {
    throw new Error("Legacy review waiting successor cannot supersede another actor's predecessor claim.");
  }
  const expectedWriteSet = normalizeWriteSet(manifest?.declaredWriteSet);
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
        reason: "superseded",
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
  const competingWaitingSuccessors = Array.isArray(refreshStatusResult?.claims)
    ? refreshStatusResult.claims.filter((claim) => (
      claim?.claimId !== waitingClaimId
      && claim?.predecessorClaimId === predecessorClaimId
      && claim?.actorId === waitingClaim.actorId
      && claim?.workItemId === waitingClaim.workItemId
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
  const promoted = cloudAuthorityFromResult({
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
  }).authority;
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
