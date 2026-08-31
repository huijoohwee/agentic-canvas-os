import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  CURRENT_CLAIM_INVENTORY_SCHEMA,
  projectPublicClaim,
  pseudonymousIdentifier,
} from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  attachCloudHeartbeatMachineEvidence,
  authorizeDeliveryAdmissionCloudAuthority,
  bindAdmissionCloudAuthority,
  claimLegacyReviewAdmissionCloudAuthority,
  cloudAuthorityFromResult,
  continueClaimedReviewSuccessorCloudAuthority,
  heartbeatAdmissionCloudAuthority,
  recoverIntegratedPreservedCloudAuthority,
  reviewReadyAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "../scripts/scoped-lane-cloud-authority.mjs";
import {
  normalizeCurrentClaimInventory,
  reconcileCloudAuthorityProjection,
} from "../scripts/scoped-lane-cloud-reconciliation.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const LEDGER_SHA = "3".repeat(40);
const NEXT_LEDGER_SHA = "4".repeat(40);
const EXPIRES_AT = "2099-08-05T08:00:00.000Z";
const EVALUATED_AT = "2026-08-04T08:00:00.000Z";
const BRANCH = "agent/device/git-guidelines-companion";
const PULL_REQUEST_NUMBER = 261;
const REVIEW_REQUEST_ID = "github-pull-request:PR_261";
const ACTOR_ID = "github-user:7";
const REPOSITORY_ID = "github-repository:R_target";
const WORK_ITEM_ID = "work-item:git-guidelines-companion";
const DEVICE_ID = "device-a";
const SESSION_ID = "session-a";
const DECLARED_WRITE_SET = normalizeWriteSet([
  "path:scripts/cloud-collaboration-contract.mjs",
  "semantic:git-guidelines-companion",
]);
const WRITE_SET_DIGEST = digestValue(DECLARED_WRITE_SET);
const CLAIM_ID = digestValue({
  actorId: ACTOR_ID,
  canonicalBaseRevision: BASE_SHA,
  leaseEpoch: 1,
  repositoryId: REPOSITORY_ID,
  workItemId: WORK_ITEM_ID,
  writeSetDigest: WRITE_SET_DIGEST,
});
const LEGACY_CLAIM_ID = digestValue({
  actorId: ACTOR_ID,
  canonicalBaseRevision: BASE_SHA,
  deviceId: pseudonymousIdentifier("device", DEVICE_ID),
  leaseEpoch: 1,
  repositoryId: REPOSITORY_ID,
  sessionId: pseudonymousIdentifier("session", SESSION_ID),
  workItemId: WORK_ITEM_ID,
  writeSetDigest: WRITE_SET_DIGEST,
});
const MANIFEST = Object.freeze({
  schema: "agentic-declared-write-scope/v1",
  semanticScope: "git-guidelines-companion",
  declaredWriteSet: DECLARED_WRITE_SET,
  writeSetDigest: WRITE_SET_DIGEST,
  manifestDigest: digestValue({ declaredWriteSet: DECLARED_WRITE_SET }),
  admittedReportDigest: "a".repeat(64),
});

function focusedEvidenceDigest() {
  return digestValue({
    schema: "agentic-focused-review-evidence/v1",
    command: "npm run check",
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    admittedReportDigest: MANIFEST.admittedReportDigest,
  });
}

function rootClaim({
  claimId = CLAIM_ID,
  claimIdentitySchema = "agentic-cloud-collaboration-entry/v2",
  state = "current",
  laneRevision = HEAD_SHA,
  transitionCounter = 2,
  fenceRevision = "b".repeat(64),
  transitionDigest = "c".repeat(64),
  reviewRequestId = null,
  leaseEpoch = 1,
  predecessorClaimId = null,
  operationReceiptDigest = "d".repeat(64),
  deviceId = null,
  sessionId = null,
  integration = null,
  integrationReceiptDigest = null,
} = {}) {
  return {
    claimId,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema,
    state,
    writeAuthority: state === "current",
    scopeReserved: state !== "waiting-successor",
    actorId: ACTOR_ID,
    ...(deviceId ? { deviceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    repositoryId: REPOSITORY_ID,
    workItemId: WORK_ITEM_ID,
    canonicalBaseRevision: BASE_SHA,
    laneRevision,
    declaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch,
    transitionCounter,
    heartbeatCounter: 0,
    reviewRequestId,
    predecessorClaimId,
    expiresAt: EXPIRES_AT,
    fenceRevision,
    transitionDigest,
    operationReceiptDigest,
    integrationReceiptDigest,
    integration,
  };
}

function localAuthority({
  claimId = CLAIM_ID,
  claimIdentitySchema = "agentic-cloud-collaboration-entry/v2",
  state = "active",
  laneRevision = BASE_SHA,
  transitionCounter = 1,
  claimDigest = "e".repeat(64),
  claimLedgerRevision = "f".repeat(64),
  ledgerRevision = LEDGER_SHA,
  ledgerDigest = "2".repeat(64),
  reviewRequestId = null,
  focusedEvidence = null,
  leaseEpoch = 1,
  operationReceiptDigest = "d".repeat(64),
} = {}) {
  return Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    claimId,
    claimDigest,
    ledgerRevision,
    ledgerDigest,
    claimLedgerRevision,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema,
    operationReceiptDigest,
    canonicalBaseSha: BASE_SHA,
    laneRevision,
    cloudDeclaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    reviewRequestId,
    leaseEpoch,
    transitionCounter,
    state,
    expiresAt: EXPIRES_AT,
    ...(focusedEvidence ? { focusedEvidenceDigest: focusedEvidence } : {}),
    manifestDigest: MANIFEST.manifestDigest,
  });
}

function mutationResult(action, claim, ledgerRevision = NEXT_LEDGER_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: claim.state,
    ledgerRevision,
    claim,
    claimDigest: claim.fenceRevision,
    receipt: {
      receiptDigest: "1".repeat(64),
      ledgerDigest: "2".repeat(64),
    },
  };
}

function statusResult(claim, ledgerRevision = NEXT_LEDGER_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision,
    ledgerDigest: "2".repeat(64),
    claims: [claim],
  };
}

function verificationResult(
  claim,
  ledgerRevision = NEXT_LEDGER_SHA,
  claims = [claim],
  { ledgerDigest = "2".repeat(64), evaluationTime = EVALUATED_AT } = {},
) {
  const inventoryCore = {
    schema: CURRENT_CLAIM_INVENTORY_SCHEMA,
    ledgerRevision,
    ledgerDigest,
    evaluationTime,
    claims: claims.map(value => structuredClone(value))
      .sort((left, right) => left.claimId.localeCompare(right.claimId)),
  };
  const claimInventoryDigest = digestValue(inventoryCore);
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision,
    ledgerDigest,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest: "4".repeat(64),
    claimInventoryDigest,
    evaluationTime,
    findings: [],
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory: { ...inventoryCore, claimInventoryDigest },
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}

function projectionHarness(initialClaim) {
  let current = initialClaim;
  const calls = [];
  return {
    calls,
    inspect: () => statusResult(current),
    verify: () => verificationResult(current),
    invoke: ({ action, request }) => {
      calls.push({ action, request });
      const state = action === "integrate"
        ? "integrated-preserved"
        : request.mode === "review"
          ? "reviewed"
          : "current";
      current = rootClaim({
        state,
        laneRevision: request.headSha || current.laneRevision,
        transitionCounter: current.transitionCounter + 1,
        fenceRevision: digestValue({ action, request }),
        transitionDigest: digestValue({ transition: calls.length }),
        reviewRequestId: request.reviewRequestId || current.reviewRequestId,
        integration: action === "integrate" ? {
          candidateRevision: request.headSha,
          reviewRequestId: REVIEW_REQUEST_ID,
          focusedEvidenceDigest: request.focusedEvidenceDigest,
          dependencyClosureDigest: request.dependencyClosureDigest,
          namedChecksDigest: request.namedChecksDigest,
          handoffEvidenceDigest: request.handoffEvidenceDigest,
          operatorDecisionDigest: request.operatorDecisionDigest,
          integrationIntentDigest: request.integrationIntentDigest,
          integratedAt: EVALUATED_AT,
        } : current.integration,
        integrationReceiptDigest: action === "integrate" ? "e".repeat(64) : current.integrationReceiptDigest,
      });
      return mutationResult(action, current);
    },
  };
}

function waitingSuccessorHarness({
  predecessorState = "dormant-preserved",
  duplicateWaitingScope = false,
  chainedWaitingPredecessor = false,
  successorLaneRevision = BASE_SHA,
  currentState = "waiting-successor",
} = {}) {
  let predecessor = rootClaim({
    claimId: "6".repeat(64),
    state: predecessorState,
    laneRevision: "5".repeat(40),
    transitionCounter: 4,
    fenceRevision: "7".repeat(64),
    transitionDigest: "8".repeat(64),
    reviewRequestId: REVIEW_REQUEST_ID,
    integration: predecessorState === "integrated-preserved"
      ? integratedReplayEvidence()
      : null,
    integrationReceiptDigest: predecessorState === "integrated-preserved"
      ? "f".repeat(64)
      : null,
  });
  let waiting = {
    ...rootClaim({
      claimId: "9".repeat(64),
      laneRevision: successorLaneRevision,
      transitionCounter: 1,
      fenceRevision: "a".repeat(64),
      transitionDigest: "b".repeat(64),
      leaseEpoch: 2,
      predecessorClaimId: predecessor.claimId,
    }),
    state: "waiting-successor",
    writeAuthority: false,
    scopeReserved: false,
  };
  const duplicateScope = normalizeWriteSet([
    "path:scripts/older-legacy-refresh.mjs",
    "semantic:git-guidelines-companion",
  ]);
  let staleWaiting = {
    ...rootClaim({
      claimId: "c".repeat(64),
      laneRevision: successorLaneRevision,
      transitionCounter: 1,
      fenceRevision: "d".repeat(64),
      transitionDigest: "e".repeat(64),
      leaseEpoch: 2,
      predecessorClaimId: predecessor.claimId,
    }),
    state: "waiting-successor",
    writeAuthority: false,
    scopeReserved: false,
    declaredWriteScope: duplicateWaitingScope ? waiting.declaredWriteScope : duplicateScope,
    writeSetDigest: duplicateWaitingScope
      ? waiting.writeSetDigest
      : digestValue(duplicateScope),
  };
  let current = currentState === "waiting-successor"
    ? waiting
    : {
      ...waiting,
      state: currentState,
      writeAuthority: currentState === "current",
      scopeReserved: true,
      transitionCounter: currentState === "reviewed" ? 3 : 2,
      fenceRevision: digestValue({ currentState, field: "fence" }),
      transitionDigest: digestValue({ currentState, field: "transition" }),
      operationReceiptDigest: digestValue({ currentState, field: "receipt" }),
      reviewRequestId: currentState === "reviewed" ? REVIEW_REQUEST_ID : null,
    };
  const calls = [];
  return {
    calls,
    claimResult: mutationResult("claim", waiting, LEDGER_SHA),
    get observedClaim() {
      return current;
    },
    inspect: () => (
      current.state === "waiting-successor"
        ? {
          ...statusResult(predecessor, NEXT_LEDGER_SHA),
          claims: chainedWaitingPredecessor
            ? [predecessor, staleWaiting, waiting].map((claim, index) => (
              index === 0
                ? { ...claim, state: "waiting-successor" }
                : claim
            ))
            : [predecessor, staleWaiting, waiting],
        }
        : statusResult(current, NEXT_LEDGER_SHA)
    ),
    verify: () => verificationResult(current, NEXT_LEDGER_SHA),
    invoke: ({ action, request }) => {
      calls.push({ action, request });
      if (action === "claim") {
        current = waiting;
        return mutationResult("claim", waiting, NEXT_LEDGER_SHA);
      }
      if (action === "retire" && request.claimId === staleWaiting.claimId) {
        staleWaiting = {
          ...staleWaiting,
          state: "retired",
          transitionCounter: staleWaiting.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ retireQueued: calls.length }),
        };
        return mutationResult("retire", staleWaiting, NEXT_LEDGER_SHA);
      }
      if (action === "retire") {
        predecessor = {
          ...predecessor,
          state: "retired",
          transitionCounter: predecessor.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ retire: calls.length }),
        };
        return mutationResult("retire", predecessor, NEXT_LEDGER_SHA);
      }
      if (action === "continue" && request.mode === "promote") {
        current = {
          ...waiting,
          state: "current",
          writeAuthority: true,
          scopeReserved: true,
          transitionCounter: waiting.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ promote: calls.length }),
          operationReceiptDigest: digestValue({ promoteReceipt: calls.length }),
        };
        return mutationResult("continue", current, NEXT_LEDGER_SHA);
      }
      if (action === "continue" && request.mode === "projection") {
        current = {
          ...current,
          state: "current",
          writeAuthority: true,
          scopeReserved: true,
          laneRevision: request.headSha,
          transitionCounter: current.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ projection: calls.length }),
          operationReceiptDigest: digestValue({ projectionReceipt: calls.length }),
          reviewRequestId: request.reviewRequestId || current.reviewRequestId,
        };
        return mutationResult("continue", current, NEXT_LEDGER_SHA);
      }
      throw new Error(`Unexpected action ${action}:${request.mode || "none"}`);
    },
  };
}

function claimedSuccessorAuthority(claimResult) {
  const claim = claimResult.claim;
  return localAuthority({
    claimId: claim.claimId,
    claimIdentitySchema: claim.claimIdentitySchema,
    state: "waiting-successor",
    laneRevision: claim.laneRevision,
    transitionCounter: claim.transitionCounter,
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    ledgerRevision: claimResult.ledgerRevision,
    reviewRequestId: claim.reviewRequestId,
    focusedEvidence: focusedEvidenceDigest(),
    leaseEpoch: claim.leaseEpoch,
    operationReceiptDigest: claim.operationReceiptDigest,
  });
}

function integratedReplayEvidence() {
  return {
    candidateRevision: HEAD_SHA,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    dependencyClosureDigest: "4".repeat(64),
    namedChecksDigest: "5".repeat(64),
    handoffEvidenceDigest: "6".repeat(64),
    operatorDecisionDigest: "7".repeat(64),
    integrationIntentDigest: "8".repeat(64),
    integratedAt: EVALUATED_AT,
  };
}

function integratedReplayHarness({
  integratedState = "dormant-preserved",
  withQueuedSuccessor = true,
  loseRetirementResponse = false,
  loseRecoveryResponse = false,
  integratedOverrides = {},
  ledgerRevision = NEXT_LEDGER_SHA,
  ledgerDigest = "2".repeat(64),
  verificationTime = EVALUATED_AT,
  finalInventoryClaims = [],
} = {}) {
  let integrated = {
    ...rootClaim({
      state: integratedState,
      laneRevision: HEAD_SHA,
      transitionCounter: 4,
      fenceRevision: "4".repeat(64),
      transitionDigest: "5".repeat(64),
      reviewRequestId: REVIEW_REQUEST_ID,
      operationReceiptDigest: "6".repeat(64),
      integration: integratedReplayEvidence(),
      integrationReceiptDigest: "7".repeat(64),
    }),
    ...integratedOverrides,
  };
  let queued = withQueuedSuccessor
    ? {
      ...rootClaim({
        claimId: "9".repeat(64),
        state: "waiting-successor",
        laneRevision: HEAD_SHA,
        transitionCounter: 1,
        fenceRevision: "a".repeat(64),
        transitionDigest: "b".repeat(64),
        reviewRequestId: null,
        leaseEpoch: 2,
        predecessorClaimId: integrated.claimId,
        operationReceiptDigest: "c".repeat(64),
      }),
      writeAuthority: false,
      scopeReserved: false,
    }
    : null;
  const events = [];
  const calls = [];
  let inspectCount = 0;
  const status = (additionalClaims = []) => ({
    ...statusResult(integrated, ledgerRevision),
    ledgerDigest,
    claims: [integrated, ...(queued ? [queued] : []), ...additionalClaims],
  });
  return {
    events,
    calls,
    get integratedClaim() {
      return integrated;
    },
    get queuedSuccessor() {
      return queued;
    },
    inspect: () => {
      inspectCount += 1;
      return status(inspectCount > 1 ? finalInventoryClaims : []);
    },
    invoke: ({ action, request }) => {
      events.push([action, request.mode || null, request.claimId]);
      calls.push({ action, request });
      if (action === "retire" && queued && request.claimId === queued.claimId) {
        const retired = { ...queued, state: "retired" };
        queued = null;
        const result = mutationResult("retire", retired, NEXT_LEDGER_SHA);
        if (loseRetirementResponse) {
          loseRetirementResponse = false;
          throw new Error("simulated response loss after queued retirement commit");
        }
        return result;
      }
      if (action === "continue" && request.mode === "recovery"
        && request.claimId === integrated.claimId) {
        integrated = {
          ...integrated,
          state: "integrated-preserved",
          transitionCounter: integrated.transitionCounter + 1,
          fenceRevision: digestValue({ request, field: "fence" }),
          transitionDigest: digestValue({ request, field: "transition" }),
          operationReceiptDigest: digestValue({ request, field: "operation" }),
          expiresAt: EXPIRES_AT,
        };
        const result = mutationResult("continue", integrated, NEXT_LEDGER_SHA);
        if (loseRecoveryResponse) {
          loseRecoveryResponse = false;
          throw new Error("simulated response loss after recovery commit");
        }
        return result;
      }
      throw new Error(`Unexpected action ${action}:${request.mode || "none"}`);
    },
    verify: () => {
      events.push(["verify", null, integrated.claimId]);
      return verificationResult(
        integrated,
        ledgerRevision,
        [integrated, ...finalInventoryClaims],
        { ledgerDigest, evaluationTime: verificationTime },
      );
    },
  };
}

function integratedReplayAuthority() {
  return localAuthority({
    state: "review_ready",
    laneRevision: HEAD_SHA,
    transitionCounter: 3,
    claimDigest: "3".repeat(64),
    claimLedgerRevision: "4".repeat(64),
    ledgerRevision: LEDGER_SHA,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidence: focusedEvidenceDigest(),
  });
}

function disjointReviewClaim(reviewRequestId) {
  const declaredWriteScope = normalizeWriteSet([
    "path:scripts/disjoint-review-owner.mjs",
    "semantic:disjoint-review-owner",
  ]);
  return {
    ...rootClaim({
      claimId: "d".repeat(64),
      state: "reviewed",
      laneRevision: HEAD_SHA,
      transitionCounter: 3,
      fenceRevision: "e".repeat(64),
      transitionDigest: "f".repeat(64),
      reviewRequestId,
      operationReceiptDigest: "a".repeat(64),
    }),
    workItemId: "work-item:disjoint-review-owner",
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
  };
}

test("claim projection accepts v2 logical identity without device/session in claimId", () => {
  const claim = rootClaim({ laneRevision: BASE_SHA, transitionCounter: 1 });
  const authority = cloudAuthorityFromResult({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    result: mutationResult("claim", claim, LEDGER_SHA),
  }, {
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    now: new Date(EVALUATED_AT),
  });
  assert.equal(authority.state, "active");
  assert.equal(authority.claimId, CLAIM_ID);
});

test("review reconciliation preserves exact v1 claim identity after a v2 continuation", () => {
  const claim = rootClaim({
    claimId: LEGACY_CLAIM_ID,
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    transitionCounter: 17,
  });
  const authority = localAuthority({
    claimId: LEGACY_CLAIM_ID,
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    transitionCounter: 13,
  });
  const reconciled = reconcileCloudAuthorityProjection({
    authority,
    manifest: MANIFEST,
    statusResult: statusResult(claim),
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    allowPriorLaneRevision: true,
    now: new Date(EVALUATED_AT),
  });
  assert.equal(reconciled.authority.claimId, LEGACY_CLAIM_ID);
  assert.equal(reconciled.authority.transitionCounter, 17);
  assert.throws(() => reconcileCloudAuthorityProjection({
    authority,
    manifest: MANIFEST,
    statusResult: statusResult({
      ...claim,
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    }),
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    allowPriorLaneRevision: true,
    now: new Date(EVALUATED_AT),
  }), /recoverable admission subject/u);
});

test("current-claim inventory preserves effective authority flags", () => {
  const incumbent = rootClaim();
  const parked = {
    ...rootClaim({ fenceRevision: "6".repeat(64), transitionDigest: "5".repeat(64) }),
    claimId: "6".repeat(64),
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    workItemId: "work-item:dormant-preserved",
    expiresAt: "2026-08-04T07:00:00.000Z",
  };
  const waiting = {
    ...rootClaim({ fenceRevision: "8".repeat(64), transitionDigest: "9".repeat(64) }),
    claimId: "7".repeat(64),
    state: "waiting-successor",
    writeAuthority: false,
    scopeReserved: false,
    workItemId: "work-item:waiting-successor",
    expiresAt: "2026-08-04T07:00:00.000Z",
  };
  const inventory = normalizeCurrentClaimInventory({
    verificationResult: verificationResult(
      incumbent,
      NEXT_LEDGER_SHA,
      [incumbent, parked, waiting],
    ),
    authority: localAuthority({ claimDigest: incumbent.fenceRevision, claimLedgerRevision: incumbent.transitionDigest, laneRevision: HEAD_SHA, transitionCounter: 2 }),
  });
  assert.deepEqual(
    inventory.claims.map(({ state, writeAuthority, scopeReserved }) => ({
      state,
      writeAuthority,
      scopeReserved,
    })).sort((left, right) => left.state.localeCompare(right.state)),
    [
      { state: "active", writeAuthority: true, scopeReserved: true },
      { state: "parked", writeAuthority: false, scopeReserved: true },
      { state: "waiting-successor", writeAuthority: false, scopeReserved: false },
    ],
  );
});

test("cloud verification derives its complete inventory from one verifier operation", () => {
  const claim = rootClaim();
  let inspectCalls = 0;
  const verified = verifyAdmissionCloudAuthority({
    authority: localAuthority({
      claimDigest: claim.fenceRevision,
      claimLedgerRevision: claim.transitionDigest,
      laneRevision: HEAD_SHA,
      transitionCounter: claim.transitionCounter,
    }),
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    inspect: () => {
      inspectCalls += 1;
      throw new Error("status must not run");
    },
    invoke: () => verificationResult(claim),
  });
  assert.equal(inspectCalls, 0);
  assert.equal(verified.verification.inventory.claims.length, 1);
  assert.equal(
    verified.verification.remoteClaimInventoryDigest,
    verified.verification.inventory.inventoryDigest,
  );
});

test("same-snapshot current-claim inventory rejects seal, bound, and candidate drift", () => {
  const claim = rootClaim();
  const authority = localAuthority({
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    laneRevision: HEAD_SHA,
    transitionCounter: claim.transitionCounter,
  });
  const normalize = result => normalizeCurrentClaimInventory({
    verificationResult: result,
    authority,
  });

  const unsealed = structuredClone(verificationResult(claim));
  unsealed.currentClaimInventory.claimInventoryDigest = "9".repeat(64);
  assert.throws(() => normalize(unsealed), /seal or observation metadata drifted/u);

  const mismatchedLedger = structuredClone(verificationResult(claim));
  mismatchedLedger.currentClaimInventory.ledgerRevision = "8".repeat(40);
  resealCurrentClaimInventory(mismatchedLedger);
  assert.throws(() => normalize(mismatchedLedger), /seal or observation metadata drifted/u);

  const duplicate = structuredClone(verificationResult(claim));
  duplicate.currentClaimInventory.claims.push(structuredClone(claim));
  resealCurrentClaimInventory(duplicate);
  assert.throws(() => normalize(duplicate), /duplicate claim identities/u);

  const oversized = structuredClone(verificationResult(claim));
  oversized.currentClaimInventory.claims = Array.from({ length: 129 }, () => claim);
  resealCurrentClaimInventory(oversized);
  assert.throws(() => normalize(oversized), /complete bounded current-claim inventory/u);

  const candidateDrift = structuredClone(verificationResult(claim));
  candidateDrift.currentClaimInventory.claims[0].transitionCounter += 1;
  resealCurrentClaimInventory(candidateDrift);
  assert.throws(() => normalize(candidateDrift), /exact verified candidate claim/u);
});

function resealCurrentClaimInventory(result) {
  const { claimInventoryDigest: ignored, ...core } = result.currentClaimInventory;
  const claimInventoryDigest = digestValue(core);
  result.currentClaimInventory.claimInventoryDigest = claimInventoryDigest;
  result.receipt.claimInventoryDigest = claimInventoryDigest;
  const { receiptDigest: ignoredReceipt, ...receiptCore } = result.receipt;
  result.receipt.receiptDigest = digestValue(receiptCore);
}

test("bind and heartbeat helpers are explicit continue projections", () => {
  const bindHarness = projectionHarness(rootClaim({ laneRevision: BASE_SHA, transitionCounter: 1 }));
  const bound = bindAdmissionCloudAuthority({
    authority: localAuthority(),
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: bindHarness.invoke,
    inspect: bindHarness.inspect,
    verify: bindHarness.verify,
  });
  assert.equal(bindHarness.calls[0].action, "continue");
  assert.equal(bindHarness.calls[0].request.mode, "projection");
  assert.equal(bound.state, "active");

  const heartbeatHarness = projectionHarness(rootClaim({ transitionCounter: bound.transitionCounter }));
  const renewed = heartbeatAdmissionCloudAuthority({
    authority: bound,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    ttlSeconds: 3_600,
    invoke: heartbeatHarness.invoke,
    inspect: heartbeatHarness.inspect,
    verify: heartbeatHarness.verify,
  });
  assert.equal(heartbeatHarness.calls[0].action, "continue");
  assert.equal(heartbeatHarness.calls[0].request.mode, "renewal");
  assert.equal(renewed.authority.state, "active");
});

test("legacy review bootstrap claims at base and binds the exact reviewed head", () => {
  const harness = projectionHarness(rootClaim({
    laneRevision: BASE_SHA,
    transitionCounter: 1,
  }));
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls[0].action, "claim");
  assert.equal(harness.calls[0].request.headSha, BASE_SHA);
  assert.equal(harness.calls[0].request.idempotencyKey,
    ["legacy-review-claim", "owner/target", BRANCH, BASE_SHA, HEAD_SHA, WRITE_SET_DIGEST, 1].join(":"));
  assert.equal(harness.calls[1].action, "continue");
  assert.equal(harness.calls[1].request.mode, "projection");
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap can bind by an exact sealed review identity without PR resolution", () => {
  const sealedReviewRequestId = "github-pull-request:PR_SEALED";
  const harness = projectionHarness(rootClaim({
    laneRevision: BASE_SHA,
    transitionCounter: 1,
  }));
  claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    reviewRequestId: sealedReviewRequestId,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls[1].action, "continue");
  assert.equal(harness.calls[1].request.mode, "projection");
  assert.equal(harness.calls[1].request.pullRequestNumber, undefined);
  assert.equal(harness.calls[1].request.reviewRequestId, sealedReviewRequestId);
});

test("legacy review bootstrap claims the preserved head for an exact historical-base predecessor", () => {
  const predecessorClaimId = "e".repeat(64);
  const canonicalDescendantProof = { evidenceDigest: "d".repeat(64) };
  const harness = projectionHarness(rootClaim({ laneRevision: HEAD_SHA, transitionCounter: 1 }));
  claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger", targetRepository: "owner/target", manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA, branch: BRANCH, headSha: HEAD_SHA, predecessorClaimId,
    canonicalDescendantProof,
    deviceId: DEVICE_ID, sessionId: SESSION_ID,
    invoke: harness.invoke, inspect: harness.inspect, verify: harness.verify,
  });
  assert.equal(harness.calls[0].action, "claim");
  assert.equal(harness.calls[0].request.canonicalBaseSha, BASE_SHA);
  assert.equal(harness.calls[0].request.headSha, HEAD_SHA);
  assert.equal(harness.calls[0].request.predecessorClaimId, predecessorClaimId);
  assert.equal(harness.calls[0].request.canonicalDescendantProof, canonicalDescendantProof);
  assert.match(harness.calls[0].request.idempotencyKey, new RegExp(predecessorClaimId, "u"));
  assert.match(harness.calls[0].request.idempotencyKey,
    new RegExp(canonicalDescendantProof.evidenceDigest, "u"));
});

test("legacy review bootstrap keeps a same-base predecessor on the preserved head without a descendant proof", () => {
  const predecessorClaimId = "e".repeat(64);
  const harness = projectionHarness(rootClaim({ laneRevision: HEAD_SHA, transitionCounter: 1 }));
  claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger", targetRepository: "owner/target", manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA, branch: BRANCH, headSha: HEAD_SHA, predecessorClaimId,
    deviceId: DEVICE_ID, sessionId: SESSION_ID,
    invoke: harness.invoke, inspect: harness.inspect, verify: harness.verify,
  });
  assert.equal(harness.calls[0].request.headSha, HEAD_SHA);
  assert.equal(harness.calls[0].request.predecessorClaimId, predecessorClaimId);
  assert.equal(harness.calls[0].request.canonicalDescendantProof, null);
});

test("public claim projection preserves pseudonymous owner identity", () => {
  const projected = projectPublicClaim(rootClaim({
    deviceId: pseudonymousIdentifier("device", DEVICE_ID),
    sessionId: pseudonymousIdentifier("session", SESSION_ID),
  }));
  assert.equal(projected.deviceId, pseudonymousIdentifier("device", DEVICE_ID));
  assert.equal(projected.sessionId, pseudonymousIdentifier("session", SESSION_ID));
});

test("legacy review bootstrap retries claim with the required lease epoch", () => {
  const harness = projectionHarness(rootClaim({
    laneRevision: BASE_SHA,
    transitionCounter: 1,
  }));
  let firstAttempt = true;
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    inspect: harness.inspect,
    verify: harness.verify,
    invoke: (input) => {
      if (input.action === "claim" && firstAttempt) {
        firstAttempt = false;
        throw new Error("Cloud collaboration claim failed: leaseEpoch must be 2");
      }
      return harness.invoke(input);
    },
  });
  const claimCalls = harness.calls.filter(call => call.action === "claim");
  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0].request.leaseEpoch, 2);
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap supersedes a preserved predecessor before promoting its waiting successor", () => {
  const harness = waitingSuccessorHarness();
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["claim", null],
      ["retire", null],
      ["continue", "promote"],
      ["continue", "projection"],
    ],
  );
  assert.equal(harness.calls[1].request.reason, "superseded");
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap supersedes a current predecessor before promoting its waiting successor", () => {
  const harness = waitingSuccessorHarness({
    predecessorState: "current",
  });
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["claim", null],
      ["retire", null],
      ["continue", "promote"],
      ["continue", "projection"],
    ],
  );
  assert.equal(harness.calls[1].request.reason, "superseded");
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap retires an integrated-preserved predecessor with its receipt before promoting", () => {
  const harness = waitingSuccessorHarness({
    predecessorState: "integrated-preserved",
  });
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["claim", null],
      ["retire", null],
      ["continue", "promote"],
      ["continue", "projection"],
    ],
  );
  assert.equal(harness.calls[1].request.reason, "integrated");
  assert.equal(harness.calls[1].request.integrationReceiptDigest, "f".repeat(64));
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap retires duplicate queued successors before promotion", () => {
  const harness = waitingSuccessorHarness({
    predecessorState: "current",
    duplicateWaitingScope: true,
  });
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["claim", null],
      ["retire", null],
      ["retire", null],
      ["continue", "promote"],
      ["continue", "projection"],
    ],
  );
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap preserves a disjoint queued successor", () => {
  const harness = waitingSuccessorHarness({ predecessorState: "current" });
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(
    harness.calls.filter(call => call.action === "retire").length,
    1,
  );
  assert.equal(bootstrapped.authority.state, "active");
});

test("legacy review bootstrap collapses waiting-successor predecessor chains before promotion", () => {
  const harness = waitingSuccessorHarness({
    predecessorState: "current",
    duplicateWaitingScope: true,
    chainedWaitingPredecessor: true,
  });
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("claimed review successor retires its predecessor before promoting the exact head-pinned waiter", () => {
  const harness = waitingSuccessorHarness({ successorLaneRevision: HEAD_SHA });
  const continued = continueClaimedReviewSuccessorCloudAuthority({
    authority: claimedSuccessorAuthority(harness.claimResult),
    claimResult: harness.claimResult,
    observedClaim: harness.observedClaim,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["retire", null],
      ["continue", "promote"],
    ],
  );
  assert.equal(harness.calls.some(call => call.action === "claim"), false);
  assert.equal(continued.authority.state, "active");
  assert.equal(continued.authority.laneRevision, HEAD_SHA);
  assert.equal(continued.authority.claimId, harness.claimResult.claim.claimId);
});

test("claimed review successor reconciles an already-current crash state without mutations", () => {
  const harness = waitingSuccessorHarness({
    successorLaneRevision: HEAD_SHA,
    currentState: "current",
  });
  const continued = continueClaimedReviewSuccessorCloudAuthority({
    authority: claimedSuccessorAuthority(harness.claimResult),
    claimResult: harness.claimResult,
    observedClaim: harness.observedClaim,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(harness.calls, []);
  assert.equal(continued.authority.state, "active");
  assert.equal(continued.authority.laneRevision, HEAD_SHA);
});

test("claimed review successor reconciles an already-reviewed crash state without mutations", () => {
  const harness = waitingSuccessorHarness({
    successorLaneRevision: HEAD_SHA,
    currentState: "reviewed",
  });
  const continued = continueClaimedReviewSuccessorCloudAuthority({
    authority: claimedSuccessorAuthority(harness.claimResult),
    claimResult: harness.claimResult,
    observedClaim: harness.observedClaim,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(harness.calls, []);
  assert.equal(continued.authority.state, "review_ready");
  assert.equal(continued.authority.laneRevision, HEAD_SHA);
  assert.equal(continued.authority.reviewRequestId, REVIEW_REQUEST_ID);
});

test("claimed review successor rejects a claim that is not pinned to the exact reviewed head", () => {
  const harness = waitingSuccessorHarness();
  assert.throws(
    () => continueClaimedReviewSuccessorCloudAuthority({
      authority: claimedSuccessorAuthority(harness.claimResult),
      claimResult: harness.claimResult,
      observedClaim: harness.observedClaim,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      reviewRequestId: REVIEW_REQUEST_ID,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    }),
    /exact claimed successor identity/u,
  );
  assert.deepEqual(harness.calls, []);
});

test("integrated replay retires only the exact waiter, recovers the same claim, then verifies delivery", () => {
  const harness = integratedReplayHarness();
  const originalClaimId = harness.integratedClaim.claimId;
  const result = recoverIntegratedPreservedCloudAuthority({
    authority: integratedReplayAuthority(),
    integratedClaim: harness.integratedClaim,
    queuedSuccessor: harness.queuedSuccessor,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.deepEqual(
    harness.events.map(([action, mode]) => [action, mode]),
    [
      ["retire", null],
      ["continue", "recovery"],
      ["verify", null],
    ],
  );
  assert.equal(harness.events[0][2], "9".repeat(64));
  assert.equal(harness.events[1][2], originalClaimId);
  assert.equal(result.authority.claimId, originalClaimId);
  assert.equal(result.authority.state, "delivery_authorized");
  assert.equal(result.authority.integrationReceiptDigest, "7".repeat(64));
  assert.match(result.convergenceEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.equal(
    result.convergenceEvidence.currentQueuedDerivativeDisposition,
    "absent-from-verified-inventory",
  );
  assert.deepEqual(result.convergenceEvidence.overlappingCurrentClaimIds, []);
  assert.equal(result.convergenceEvidence.lifecycleAttribution, "not-reconstructed");
  assert.equal(result.convergenceEvidence.observation, "current-state-only");
  assert.equal("queuedRetirementReceiptDigest" in result, false);
  assert.equal("recoveryReceiptDigest" in result, false);
  const retireCall = harness.calls.find(call => call.action === "retire");
  assert.equal(retireCall.request.claimId, "9".repeat(64));
  assert.equal(retireCall.request.expectedFenceRevision, "a".repeat(64));
  assert.equal(retireCall.request.expectedTransitionCounter, 1);
  assert.equal(retireCall.request.reason, "superseded");
  assert.equal(
    retireCall.request.idempotencyKey,
    [
      "integrated-replay-retire-queued-successor",
      "9".repeat(64),
      1,
      "a".repeat(64),
    ].join(":"),
  );
  const recoveryCall = harness.calls.find(
    call => call.action === "continue" && call.request.mode === "recovery",
  );
  assert.equal(recoveryCall.request.claimId, originalClaimId);
  assert.equal(recoveryCall.request.expectedFenceRevision, "4".repeat(64));
  assert.equal(recoveryCall.request.expectedTransitionCounter, 4);
  assert.match(recoveryCall.request.recoveryEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.equal(
    recoveryCall.request.idempotencyKey,
    [
      "integrated-preserved-recovery",
      originalClaimId,
      4,
      "4".repeat(64),
      recoveryCall.request.recoveryEvidenceDigest,
    ].join(":"),
  );
});

test("already-live integrated replay performs no recovery mutation", () => {
  const harness = integratedReplayHarness({
    integratedState: "integrated-preserved",
    withQueuedSuccessor: false,
  });
  const result = recoverIntegratedPreservedCloudAuthority({
    authority: integratedReplayAuthority(),
    integratedClaim: harness.integratedClaim,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.deepEqual(harness.events, [["verify", null, CLAIM_ID]]);
  assert.equal(result.authority.claimId, CLAIM_ID);
  assert.match(result.convergenceEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.equal("recoveryReceiptDigest" in result, false);
  assert.equal("queuedRetirementReceiptDigest" in result, false);
});

test("integrated replay convergence binds claim-local fence, transition, expiry, and operation evidence", () => {
  const run = integratedOverrides => {
    const harness = integratedReplayHarness({
      integratedState: "integrated-preserved",
      withQueuedSuccessor: false,
      integratedOverrides,
    });
    return recoverIntegratedPreservedCloudAuthority({
      authority: integratedReplayAuthority(),
      integratedClaim: harness.integratedClaim,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    });
  };
  const baseline = run({});
  const variants = [
    { fenceRevision: "8".repeat(64) },
    { transitionDigest: "9".repeat(64) },
    { transitionCounter: 5 },
    { operationReceiptDigest: "a".repeat(64) },
    { expiresAt: "2099-08-06T08:00:00.000Z" },
  ];
  for (const variant of variants) {
    assert.notEqual(
      run(variant).convergenceEvidenceDigest,
      baseline.convergenceEvidenceDigest,
    );
  }
});

test("integrated replay convergence excludes unrelated ledger head and verification time", () => {
  const run = options => {
    const harness = integratedReplayHarness({
      integratedState: "integrated-preserved",
      withQueuedSuccessor: false,
      ...options,
    });
    return recoverIntegratedPreservedCloudAuthority({
      authority: integratedReplayAuthority(),
      integratedClaim: harness.integratedClaim,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    });
  };
  const baseline = run({});
  const unrelatedLedgerDrift = run({
    ledgerRevision: "9".repeat(40),
    ledgerDigest: "a".repeat(64),
    verificationTime: "2026-08-04T09:00:00.000Z",
  });

  assert.equal(
    unrelatedLedgerDrift.convergenceEvidenceDigest,
    baseline.convergenceEvidenceDigest,
  );
  assert.notEqual(
    unrelatedLedgerDrift.authority.ledgerRevision,
    baseline.authority.ledgerRevision,
  );
  assert.notEqual(
    unrelatedLedgerDrift.verification.verifiedAt,
    baseline.verification.verifiedAt,
  );
});

test("integrated replay final convergence rejects a disjoint duplicate review injected after preflight", () => {
  const harness = integratedReplayHarness({
    integratedState: "integrated-preserved",
    withQueuedSuccessor: false,
    finalInventoryClaims: [disjointReviewClaim(REVIEW_REQUEST_ID)],
  });

  assert.throws(
    () => recoverIntegratedPreservedCloudAuthority({
      authority: integratedReplayAuthority(),
      integratedClaim: harness.integratedClaim,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    }),
    /duplicate-review authority/u,
  );
  assert.deepEqual(harness.events, [["verify", null, CLAIM_ID]]);
});

test("integrated replay final convergence rejects an overlapping different-review claim", () => {
  const overlapping = {
    ...disjointReviewClaim("github-pull-request:PR_overlap"),
    declaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
  };
  const harness = integratedReplayHarness({
    integratedState: "integrated-preserved",
    withQueuedSuccessor: false,
    finalInventoryClaims: [overlapping],
  });

  assert.throws(
    () => recoverIntegratedPreservedCloudAuthority({
      authority: integratedReplayAuthority(),
      integratedClaim: harness.integratedClaim,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    }),
    /overlapping/u,
  );
});

test("integrated replay final convergence preserves a disjoint different-review authority", () => {
  const harness = integratedReplayHarness({
    integratedState: "integrated-preserved",
    withQueuedSuccessor: false,
    finalInventoryClaims: [disjointReviewClaim("github-pull-request:PR_disjoint")],
  });
  const result = recoverIntegratedPreservedCloudAuthority({
    authority: integratedReplayAuthority(),
    integratedClaim: harness.integratedClaim,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.equal(result.authority.claimId, CLAIM_ID);
  assert.deepEqual(result.convergenceEvidence.overlappingCurrentClaimIds, []);
});

test("integrated replay convergence survives response loss after exact waiter retirement", () => {
  const harness = integratedReplayHarness({ loseRetirementResponse: true });
  const authority = integratedReplayAuthority();
  const observedIntegrated = harness.integratedClaim;
  const observedQueued = harness.queuedSuccessor;
  assert.throws(
    () => recoverIntegratedPreservedCloudAuthority({
      authority,
      integratedClaim: observedIntegrated,
      queuedSuccessor: observedQueued,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    }),
    /simulated response loss after queued retirement commit/u,
  );

  const firstCompletion = recoverIntegratedPreservedCloudAuthority({
    authority,
    integratedClaim: harness.integratedClaim,
    queuedSuccessor: null,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  const postLossReplay = recoverIntegratedPreservedCloudAuthority({
    authority,
    integratedClaim: harness.integratedClaim,
    queuedSuccessor: null,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.equal(harness.events.filter(([action]) => action === "retire").length, 1);
  assert.equal(harness.events.filter(([action, mode]) => action === "continue" && mode === "recovery").length, 1);
  assert.equal(firstCompletion.convergenceEvidenceDigest, postLossReplay.convergenceEvidenceDigest);
  assert.equal(
    firstCompletion.authority.operationReceiptDigest,
    postLossReplay.authority.operationReceiptDigest,
  );
  assert.equal("queuedRetirementReceiptDigest" in firstCompletion, false);
  assert.equal("recoveryReceiptDigest" in firstCompletion, false);
});

test("integrated replay convergence survives response loss after same-claim recovery", () => {
  const harness = integratedReplayHarness({
    withQueuedSuccessor: false,
    loseRecoveryResponse: true,
  });
  const authority = integratedReplayAuthority();
  assert.throws(
    () => recoverIntegratedPreservedCloudAuthority({
      authority,
      integratedClaim: harness.integratedClaim,
      queuedSuccessor: null,
      manifest: MANIFEST,
      branch: BRANCH,
      headSha: HEAD_SHA,
      focusedEvidenceDigest: focusedEvidenceDigest(),
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      invoke: harness.invoke,
      inspect: harness.inspect,
      verify: harness.verify,
    }),
    /simulated response loss after recovery commit/u,
  );

  const firstCompletion = recoverIntegratedPreservedCloudAuthority({
    authority,
    integratedClaim: harness.integratedClaim,
    queuedSuccessor: null,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  const postLossReplay = recoverIntegratedPreservedCloudAuthority({
    authority,
    integratedClaim: harness.integratedClaim,
    queuedSuccessor: null,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.equal(harness.events.filter(([action, mode]) => action === "continue" && mode === "recovery").length, 1);
  assert.equal(firstCompletion.convergenceEvidenceDigest, postLossReplay.convergenceEvidenceDigest);
  assert.equal(
    firstCompletion.authority.operationReceiptDigest,
    postLossReplay.authority.operationReceiptDigest,
  );
  assert.equal("recoveryReceiptDigest" in firstCompletion, false);
});

test("review helper records continue(review) without changing candidate identity", () => {
  const initial = rootClaim({ laneRevision: HEAD_SHA, transitionCounter: 2 });
  const harness = projectionHarness(initial);
  const ready = reviewReadyAdmissionCloudAuthority({
    authority: localAuthority({
      laneRevision: HEAD_SHA,
      transitionCounter: 2,
      claimDigest: initial.fenceRevision,
      claimLedgerRevision: initial.transitionDigest,
      ledgerRevision: NEXT_LEDGER_SHA,
    }),
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls.at(-1).action, "continue");
  assert.equal(harness.calls.at(-1).request.mode, "review");
  assert.equal(ready.authority.state, "review_ready");
  assert.equal(ready.authority.laneRevision, HEAD_SHA);
  assert.equal(ready.authority.reviewRequestId, REVIEW_REQUEST_ID);
});

test("review helper prefers explicit review request identity over pull request projection", () => {
  const initial = rootClaim({ laneRevision: BASE_SHA, transitionCounter: 1 });
  const harness = projectionHarness(initial);
  const ready = reviewReadyAdmissionCloudAuthority({
    authority: localAuthority({
      claimDigest: initial.fenceRevision,
      claimLedgerRevision: initial.transitionDigest,
    }),
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null, call.request.pullRequestNumber]),
    [
      ["continue", "projection", undefined],
      ["continue", "review", undefined],
    ],
  );
  assert.equal(harness.calls[0].request.reviewRequestId, REVIEW_REQUEST_ID);
  assert.equal(harness.calls[1].request.reviewRequestId, REVIEW_REQUEST_ID);
  assert.equal(ready.authority.state, "review_ready");
  assert.equal(ready.authority.reviewRequestId, REVIEW_REQUEST_ID);
});

test("integration projection requires explicit operator and joined evidence", () => {
  const evidence = focusedEvidenceDigest();
  const reviewedClaim = rootClaim({
    state: "reviewed",
    laneRevision: HEAD_SHA,
    transitionCounter: 3,
    reviewRequestId: REVIEW_REQUEST_ID,
  });
  const authority = localAuthority({
    state: "review_ready",
    laneRevision: HEAD_SHA,
    transitionCounter: 3,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidence: evidence,
    claimDigest: reviewedClaim.fenceRevision,
    claimLedgerRevision: reviewedClaim.transitionDigest,
    ledgerRevision: NEXT_LEDGER_SHA,
  });
  const explicitEvidence = {
    dependencyClosureDigest: "4".repeat(64), namedChecksDigest: "5".repeat(64),
    handoffEvidenceDigest: "6".repeat(64), operatorDecisionDigest: "7".repeat(64),
    integrationIntentDigest: "8".repeat(64),
  };
  const missing = projectionHarness(reviewedClaim);
  for (const field of Object.keys(explicitEvidence)) {
    const incomplete = { ...explicitEvidence };
    delete incomplete[field];
    assert.throws(() => authorizeDeliveryAdmissionCloudAuthority({ authority, manifest: MANIFEST, branch: BRANCH, headSha: HEAD_SHA, pullRequestNumber: PULL_REQUEST_NUMBER,
      deviceId: DEVICE_ID, sessionId: SESSION_ID, invoke: missing.invoke, inspect: missing.inspect, verify: missing.verify, ...incomplete }), new RegExp(field, "u"));
  }
  assert.equal(missing.calls.length, 0);

  const harness = projectionHarness(reviewedClaim);
  const integrated = authorizeDeliveryAdmissionCloudAuthority({
    authority,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    ...explicitEvidence,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls[0].action, "integrate");
  assert.equal(harness.calls[0].request.operatorDecisionDigest, "7".repeat(64));
  assert.equal(integrated.authority.state, "delivery_authorized");
  const replay = authorizeDeliveryAdmissionCloudAuthority({ authority: integrated.authority, manifest: MANIFEST, branch: BRANCH, headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER, deviceId: DEVICE_ID, sessionId: SESSION_ID, invoke: harness.invoke, inspect: harness.inspect, verify: harness.verify, ...explicitEvidence });
  assert.equal(replay.authority.integrationReceiptDigest, "e".repeat(64));
  assert.equal(harness.calls.length, 1);
  assert.throws(() => authorizeDeliveryAdmissionCloudAuthority({ authority: integrated.authority, manifest: MANIFEST, branch: BRANCH, headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER, deviceId: DEVICE_ID, sessionId: SESSION_ID, invoke: harness.invoke, inspect: harness.inspect, verify: harness.verify,
    ...explicitEvidence, operatorDecisionDigest: "9".repeat(64) }), /exact integration evidence/u);
});

test("heartbeat machine envelope carries only joined authority evidence", () => {
  const response = { ok: true };
  const lease = { admission: { status: "admitted" }, cloudAuthority: localAuthority() };
  const result = { mutationAuthorityReceipt: { status: "ready" } };
  assert.deepEqual(attachCloudHeartbeatMachineEvidence(response, { lease, result }), {
    ok: true,
    admission: lease.admission,
    cloudAuthority: lease.cloudAuthority,
    mutationAuthorityReceipt: result.mutationAuthorityReceipt,
  });
});
