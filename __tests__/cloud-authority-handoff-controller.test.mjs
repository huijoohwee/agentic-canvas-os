import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
  continueExpiredReviewLaneAuthority,
  createCloudAuthorityHandoffControllerAdapter,
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "../scripts/cloud-authority-handoff-controller.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";

const BASE_SHA = "a".repeat(40);
const REVIEW_SHA = "b".repeat(40);
const REFRESHED_SHA = "0".repeat(40);
const REFRESH_MAIN_PARENT_SHA = "f".repeat(40);
const PREDECESSOR_CLAIM_ID = "c".repeat(64);
const PREDECESSOR_CLAIM_DIGEST = "d".repeat(64);
const PREDECESSOR_LEDGER_DIGEST = "e".repeat(64);
const PREDECESSOR_FOCUSED_EVIDENCE = "1".repeat(64);
const SUCCESSOR_CLAIM_ID = "1".repeat(64);
const SUCCESSOR_CLAIM_DIGEST = "2".repeat(64);
const SUCCESSOR_LEDGER_DIGEST = "3".repeat(64);
const MANIFEST_DIGEST = "4".repeat(64);
const WRITE_SET_DIGEST = "5".repeat(64);
const ADMITTED_REPORT_DIGEST = "6".repeat(64);
const CLAIM_RECEIPT_DIGEST = "7".repeat(64);
const REVIEW_RECEIPT_DIGEST = "8".repeat(64);
const PROJECTION_RECEIPT_DIGEST = "9".repeat(64);
const INTEGRATION_RECEIPT_DIGEST = "a".repeat(64);
const RECOVERY_RECEIPT_DIGEST = "b".repeat(64);
const CONVERGENCE_EVIDENCE_DIGEST = "f".repeat(64);

function preservedLane(overrides = {}) {
  const lease = {
    status: "review_ready",
    sessionId: "legacy-session",
    device: "legacy-device",
    scope: "legacy-authority-evaluator",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    baseSha: BASE_SHA,
    reviewHeadSha: REVIEW_SHA,
    pullRequestUrl: "https://github.com/example/repo/pull/238",
    admission: {
      status: "admitted",
      declaredWriteSet: [
        "path:docs/CANONICAL-LIFECYCLE.md",
        "path:scripts/legacy-authority-evaluator.mjs",
        "semantic:legacy-authority-evaluator",
      ],
      writeSetDigest: WRITE_SET_DIGEST,
      admittedReportDigest: ADMITTED_REPORT_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "example/ledger",
      targetRepository: "example/repo",
      claimId: PREDECESSOR_CLAIM_ID,
      claimDigest: PREDECESSOR_CLAIM_DIGEST,
      ledgerRevision: BASE_SHA,
      claimLedgerRevision: PREDECESSOR_LEDGER_DIGEST,
      canonicalBaseSha: BASE_SHA,
      laneRevision: REVIEW_SHA,
      cloudDeclaredWriteScope: [
        "path:docs/CANONICAL-LIFECYCLE.md",
        "path:scripts/legacy-authority-evaluator.mjs",
        "semantic:legacy-authority-evaluator",
      ],
      writeSetDigest: WRITE_SET_DIGEST,
      deviceId: "legacy-device",
      sessionId: "legacy-session",
      reviewRequestId: "github-pull-request:PR_238",
      leaseEpoch: 1,
      transitionCounter: 4,
      state: "review_ready",
      expiresAt: "2026-08-03T07:37:22.000Z",
      focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
    },
  };
  return {
    repository: "/repo",
    branch: lease.branch,
    headSha: REVIEW_SHA,
    remoteHeadSha: REVIEW_SHA,
    clean: true,
    baseSha: BASE_SHA,
    lease,
    manifest: {
      declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: WRITE_SET_DIGEST,
      admittedReportDigest: ADMITTED_REPORT_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
    authority: lease.cloudAuthority,
    pullRequest: {
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: false,
      headRefName: lease.branch,
      headRefOid: REVIEW_SHA,
      baseRefName: "main",
      body: "<lease-marker>",
      authorLogin: "owner",
    },
    remoteLease: {
      branch: lease.branch,
      baseSha: BASE_SHA,
      scope: lease.scope,
      reviewHeadSha: REVIEW_SHA,
      cloudAuthority: { claimId: PREDECESSOR_CLAIM_ID },
    },
    ...overrides,
  };
}

function successorAuthority(overrides = {}) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: SUCCESSOR_CLAIM_ID,
    claimDigest: SUCCESSOR_CLAIM_DIGEST,
    ledgerRevision: BASE_SHA,
    claimLedgerRevision: SUCCESSOR_LEDGER_DIGEST,
    canonicalBaseSha: BASE_SHA,
    laneRevision: REVIEW_SHA,
    cloudDeclaredWriteScope: [
      "path:docs/CANONICAL-LIFECYCLE.md",
      "path:scripts/legacy-authority-evaluator.mjs",
      "semantic:legacy-authority-evaluator",
    ],
    writeSetDigest: WRITE_SET_DIGEST,
    deviceId: "legacy-device",
    sessionId: "legacy-session",
    reviewRequestId: "github-pull-request:PR_238",
    leaseEpoch: 2,
    transitionCounter: 3,
    state: "review_ready",
    expiresAt: "2026-08-03T09:07:22.000Z",
    focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
    ...overrides,
  };
}

function statusResult(claims = []) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    claims,
  };
}

function resumableSuccessorClaim(overrides = {}) {
  return {
    claimId: SUCCESSOR_CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "waiting-successor",
    actorId: "github-user:1",
    repositoryId: "github-repository:example",
    workItemId: pseudonymousIdentifier("work-item", "legacy-authority-evaluator"),
    canonicalBaseRevision: BASE_SHA,
    laneRevision: REVIEW_SHA,
    declaredWriteScope: preservedLane().manifest.declaredWriteSet,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 2,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    predecessorClaimId: PREDECESSOR_CLAIM_ID,
    expiresAt: "2026-08-03T09:07:22.000Z",
    fenceRevision: SUCCESSOR_CLAIM_DIGEST,
    transitionDigest: SUCCESSOR_LEDGER_DIGEST,
    operationReceiptDigest: CLAIM_RECEIPT_DIGEST,
    integrationReceiptDigest: null,
    integration: null,
    ...overrides,
  };
}

function integratedReplayEvidence() {
  return {
    candidateRevision: REVIEW_SHA,
    reviewRequestId: "github-pull-request:PR_238",
    focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
    dependencyClosureDigest: "a".repeat(64),
    namedChecksDigest: "b".repeat(64),
    handoffEvidenceDigest: "c".repeat(64),
    operatorDecisionDigest: "d".repeat(64),
    integrationIntentDigest: "e".repeat(64),
    integratedAt: "2026-08-03T08:00:00.000Z",
  };
}

function integratedReplayClaim(overrides = {}) {
  return {
    claimId: PREDECESSOR_CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "dormant-preserved",
    actorId: "github-user:1",
    repositoryId: "github-repository:example",
    workItemId: pseudonymousIdentifier("work-item", "legacy-authority-evaluator"),
    canonicalBaseRevision: BASE_SHA,
    laneRevision: REVIEW_SHA,
    declaredWriteScope: preservedLane().manifest.declaredWriteSet,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 1,
    transitionCounter: 5,
    heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_238",
    predecessorClaimId: null,
    expiresAt: "2026-08-03T09:07:22.000Z",
    fenceRevision: "f".repeat(64),
    transitionDigest: "0".repeat(64),
    operationReceiptDigest: "1".repeat(64),
    integrationReceiptDigest: INTEGRATION_RECEIPT_DIGEST,
    integration: integratedReplayEvidence(),
    ...overrides,
  };
}

function integratedReplayAuthority(overrides = {}) {
  const claim = integratedReplayClaim({
    state: "integrated-preserved",
    transitionCounter: 6,
    expiresAt: "2099-08-03T09:07:22.000Z",
  });
  return {
    ...preservedLane().authority,
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    ledgerRevision: BASE_SHA,
    ledgerDigest: PREDECESSOR_LEDGER_DIGEST,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    transitionCounter: claim.transitionCounter,
    state: "delivery_authorized",
    expiresAt: claim.expiresAt,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
    ...overrides,
  };
}

function claimResult({ replayed = false, claimOverrides = {} } = {}) {
  const claim = resumableSuccessorClaim({ state: "active", ...claimOverrides });
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "claim",
    status: claim.state,
    replayed,
    ledgerRevision: BASE_SHA,
    claimDigest: SUCCESSOR_CLAIM_DIGEST,
    claim,
    receipt: {
      receiptDigest: CLAIM_RECEIPT_DIGEST,
      ledgerDigest: PREDECESSOR_LEDGER_DIGEST,
      evaluationTime: "2026-08-03T08:30:00.000Z",
    },
  };
}

function reclaimRequest() {
  return {
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  };
}

test("reclaim restores live authority for the exact preserved review lane", async () => {
  const events = [];
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([{
      claimId: PREDECESSOR_CLAIM_ID,
      reviewRequestId: "github-pull-request:PR_238",
      declaredWriteScope: preservedLane().manifest.declaredWriteSet,
    }]),
    claimSuccessor: ({ request, lane }) => {
      events.push(["claim", request.transition, lane.authority.claimId]);
      return claimResult();
    },
    bindAndReviewReady: ({ request }) => {
      events.push(["ready", request.successorSessionId, request.successorDeviceId]);
      return {
        authority: successorAuthority(),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
      };
    },
    persistReviewProjection: ({ authority }) => {
      events.push(["persist", authority.claimId]);
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.schema, CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA);
  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.projectionUpdated, true);
  assert.equal(result.predecessorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorClaimId, SUCCESSOR_CLAIM_ID);
  assert.equal(result.successorLeaseEpoch, 2);
  assert.deepEqual(events, [
    ["claim", "reclaim", PREDECESSOR_CLAIM_ID],
    ["ready", "legacy-session", "legacy-device"],
    ["persist", SUCCESSOR_CLAIM_ID],
  ]);
  assert.equal(result.receipts.length, 3);
  assert.equal(result.receipts[1].kind, "continuation");
});

test("reclaim preserves the predecessor base and reviewed head for successor claims", async () => {
  let observed = null;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(),
    claimSuccessor: ({ lane }) => {
      observed = {
        baseSha: lane.baseSha,
        headSha: lane.headSha,
        predecessorClaimId: lane.authority.claimId,
      };
      return claimResult();
    },
    bindAndReviewReady: () => ({
      authority: successorAuthority(),
      verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
    }),
    persistReviewProjection: () => ({ receiptDigest: PROJECTION_RECEIPT_DIGEST }),
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "reclaimed-live");
  assert.deepEqual(observed, {
    baseSha: BASE_SHA,
    headSha: REVIEW_SHA,
    predecessorClaimId: PREDECESSOR_CLAIM_ID,
  });
});

test("repository reclaim projection pins non-writer expiry to cloud authority", () => {
  const lane = preservedLane();
  const authority = successorAuthority();
  let releaseInput = null;
  let pullRequestBody = "<lease-marker>";
  const updatedLease = {
    ...lane.lease,
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 2,
    fenceSha: REVIEW_SHA,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: authority.expiresAt,
    expiresAt: authority.expiresAt,
    reviewHeadSha: lane.headSha,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: lane.lease.scope,
      declaredWriteSet: lane.manifest.declaredWriteSet,
      writeSetDigest: lane.manifest.writeSetDigest,
      manifestDigest: lane.manifest.manifestDigest,
      planReceiptDigest: "a".repeat(64),
      admissionReceiptDigest: "b".repeat(64),
      existingLaneStateDigest: "c".repeat(64),
      admittedReportDigest: lane.manifest.admittedReportDigest,
      preservationReceiptDigest: "d".repeat(64),
    },
    cloudAuthority: authority,
  };
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    leaseStore: {
      release(input) {
        releaseInput = input;
        return updatedLease;
      },
    },
    run: (_command, args) => {
      pullRequestBody = args[args.indexOf("--body") + 1];
    },
    ghText: () => JSON.stringify({
      url: lane.pullRequest.url,
      state: "OPEN",
      isDraft: false,
      headRefName: lane.branch,
      headRefOid: lane.headSha,
      headRepository: { nameWithOwner: "example/repo" },
      baseRefName: "main",
      body: pullRequestBody,
    }),
  });

  adapter.persistReviewProjection({ lane, authority });
  assert.equal(releaseInput.timestamp, authority.expiresAt);
  assert.equal(releaseInput.status, "review_ready");
  assert.equal(updatedLease.status, "review_ready");
  assert.equal(updatedLease.expiresAt, authority.expiresAt);
});

test("retain returns a validated retained-legacy outcome without mutation", async () => {
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(),
    claimSuccessor: () => {
      throw new Error("retain must not claim");
    },
    bindAndReviewReady: () => {
      throw new Error("retain must not bind");
    },
    persistReviewProjection: () => {
      throw new Error("retain must not persist");
    },
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "retain",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "retained-legacy");
  assert.equal(result.receipts.length, 1);
});

test("reclaim accepts a preserved review lane whose PR head only moved by protected-main refresh", async () => {
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane({
      refreshedHeadSha: REFRESHED_SHA,
      remoteHeadSha: REFRESHED_SHA,
      protectedMainRefresh: {
        schema: "agentic-protected-main-refresh/v1",
        deliveredHeadSha: REVIEW_SHA,
        refreshedHeadSha: REFRESHED_SHA,
        mainParentSha: REFRESH_MAIN_PARENT_SHA,
      },
      pullRequest: {
        url: "https://github.com/example/repo/pull/238",
        state: "OPEN",
        isDraft: false,
        headRefName: "agent/legacy-device/legacy-authority-evaluator",
        headRefOid: REFRESHED_SHA,
        baseRefName: "main",
        body: "<lease-marker>",
        authorLogin: "owner",
      },
    }),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(),
    claimSuccessor: ({ lane }) => {
      assert.equal(lane.headSha, REVIEW_SHA);
      assert.equal(lane.refreshedHeadSha, REFRESHED_SHA);
      assert.equal(lane.protectedMainRefresh?.refreshedHeadSha, REFRESHED_SHA);
      return claimResult();
    },
    bindAndReviewReady: () => ({
      authority: successorAuthority(),
      verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
    }),
    persistReviewProjection: () => ({ receiptDigest: PROJECTION_RECEIPT_DIGEST }),
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.reviewedHeadSha, REVIEW_SHA);
});

test("handoff creates a live successor without rewriting the local projection", async () => {
  let persisted = false;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(),
    claimSuccessor: () => claimResult(),
    bindAndReviewReady: () => ({
      authority: successorAuthority({
        deviceId: "new-device",
        sessionId: "new-session",
      }),
      verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
    }),
    persistReviewProjection: () => {
      persisted = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "handoff",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "new-session",
    successorDeviceId: "new-device",
  }, { adapter });

  assert.equal(result.outcome, "handed-off-live");
  assert.equal(result.projectionUpdated, false);
  assert.equal(persisted, false);
  assert.equal(result.receipts.length, 2);
});

test("exact-head drift blocks before any mutation", async () => {
  let mutated = false;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane({ remoteHeadSha: "9".repeat(40) }),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(),
    claimSuccessor: () => {
      mutated = true;
      return claimResult();
    },
    bindAndReviewReady: () => {
      mutated = true;
      return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
    },
    persistReviewProjection: () => {
      mutated = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.blockingFindings.some(item => item.type === "exact-head-drift"), true);
  assert.equal(mutated, false);
});

test("a competing live overlap blocks reclaim", async () => {
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([{
      claimId: "a".repeat(64),
      declaredWriteScope: [
        "path:scripts/legacy-authority-evaluator.mjs",
        "semantic:other",
      ],
    }]),
    claimSuccessor: () => claimResult(),
    bindAndReviewReady: () => ({
      authority: successorAuthority(),
      verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
    }),
    persistReviewProjection: () => ({ receiptDigest: PROJECTION_RECEIPT_DIGEST }),
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.blockingFindings.some(item => item.type === "competing-live-claim"), true);
});

test("another live claim using the same review request blocks before mutation", async () => {
  let mutated = false;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([{
      claimId: "a".repeat(64),
      reviewRequestId: "github-pull-request:PR_238",
      declaredWriteScope: ["semantic:independent-scope"],
    }]),
    claimSuccessor: () => {
      mutated = true;
      return claimResult();
    },
    bindAndReviewReady: () => {
      mutated = true;
      return {
        authority: successorAuthority(),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
      };
    },
    persistReviewProjection: () => {
      mutated = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "blocked");
  assert.equal(
    result.blockingFindings.some(item => item.type === "review-request-already-live"),
    true,
  );
  assert.equal(mutated, false);
});

test("reclaim reuses the exact waiting successor after a crash before local projection", async () => {
  const predecessor = {
    claimId: PREDECESSOR_CLAIM_ID,
    reviewRequestId: "github-pull-request:PR_238",
    declaredWriteScope: preservedLane().manifest.declaredWriteSet,
  };
  const waiting = resumableSuccessorClaim();
  let claims = [predecessor];
  let claimAttempts = 0;
  let projections = 0;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(claims),
    claimSuccessor: () => {
      claimAttempts += 1;
      claims = [predecessor, waiting];
      return claimResult({
        replayed: claimAttempts > 1,
        claimOverrides: { state: "waiting-successor" },
      });
    },
    bindAndReviewReady: ({ claimResult: replay, resumableSuccessor }) => {
      if (claimAttempts === 1) throw new Error("simulated crash after cloud claim");
      assert.equal(replay.replayed, true);
      assert.equal(resumableSuccessor?.claimId, SUCCESSOR_CLAIM_ID);
      return {
        authority: successorAuthority(),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
      };
    },
    persistReviewProjection: () => {
      projections += 1;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  await assert.rejects(
    continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter }),
    /simulated crash after cloud claim/u,
  );
  const recovered = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });

  assert.equal(recovered.outcome, "reclaimed-live");
  assert.equal(recovered.successorClaimId, SUCCESSOR_CLAIM_ID);
  assert.equal(claimAttempts, 2);
  assert.equal(projections, 1);
  assert.equal(recovered.receipts[0].payload.resumableSuccessorClaimId, SUCCESSOR_CLAIM_ID);
});

test("reclaim recovers an exact integrated-preserved claim without claiming or rewriting review projection", async () => {
  const integrated = integratedReplayClaim();
  const waiting = resumableSuccessorClaim();
  const forbidden = [];
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([integrated, waiting]),
    claimSuccessor: () => {
      forbidden.push("claim");
      throw new Error("integrated replay must not claim");
    },
    bindAndReviewReady: () => {
      forbidden.push("review");
      throw new Error("integrated replay must not review");
    },
    persistReviewProjection: () => {
      forbidden.push("persist");
      throw new Error("integrated replay must not persist");
    },
    recoverIntegratedAuthority: ({ integratedReplay }) => {
      assert.equal(integratedReplay.claim.claimId, PREDECESSOR_CLAIM_ID);
      assert.equal(integratedReplay.queuedClaim.claimId, SUCCESSOR_CLAIM_ID);
      return {
        authority: integratedReplayAuthority(),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
        convergenceEvidenceDigest: CONVERGENCE_EVIDENCE_DIGEST,
      };
    },
  });

  const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });

  assert.equal(result.outcome, "reclaimed-live-replay");
  assert.equal(result.predecessorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.projectionUpdated, false);
  assert.deepEqual(forbidden, []);
  assert.equal(result.receipts[1].kind, "integrated-authority-converged");
  assert.equal(
    result.receipts[1].payload.convergenceEvidenceDigest,
    CONVERGENCE_EVIDENCE_DIGEST,
  );
  assert.equal("queuedRetirementReceiptDigest" in result.receipts[1].payload, false);
  assert.equal("verificationReceiptDigest" in result.receipts[1].payload, false);
});

test("integrated replay controller identity is stable after lifecycle response loss", async () => {
  const recoveredClaim = integratedReplayClaim({
    state: "integrated-preserved",
    transitionCounter: 6,
    expiresAt: "2099-08-03T09:07:22.000Z",
    fenceRevision: integratedReplayAuthority().claimDigest,
    transitionDigest: integratedReplayAuthority().claimLedgerRevision,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
  });
  let claims = [integratedReplayClaim(), resumableSuccessorClaim()];
  let verificationReceiptDigest = "1".repeat(64);
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(claims),
    claimSuccessor: () => {
      throw new Error("integrated replay must not claim");
    },
    bindAndReviewReady: () => {
      throw new Error("integrated replay must not review");
    },
    persistReviewProjection: () => {
      throw new Error("integrated replay must not persist");
    },
    recoverIntegratedAuthority: () => {
      claims = [recoveredClaim];
      const result = {
        authority: integratedReplayAuthority(),
        verification: { receiptDigest: verificationReceiptDigest },
        convergenceEvidenceDigest: CONVERGENCE_EVIDENCE_DIGEST,
      };
      verificationReceiptDigest = "2".repeat(64);
      return result;
    },
  });

  const firstCompletion = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
  const postLossReplay = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });

  assert.equal(firstCompletion.resultDigest, postLossReplay.resultDigest);
  assert.deepEqual(firstCompletion.receipts, postLossReplay.receipts);
  assert.equal(
    firstCompletion.receipts[1].payload.currentOperationReceiptDigest,
    RECOVERY_RECEIPT_DIGEST,
  );
  assert.equal("queuedSuccessorClaimId" in firstCompletion.receipts[1].payload, false);
  assert.equal("queuedRetirementReceiptDigest" in firstCompletion.receipts[1].payload, false);
  assert.equal("verificationReceiptDigest" in firstCompletion.receipts[1].payload, false);
});

test("integrated-preserved replay derivative drift blocks before every mutation route", async () => {
  const driftCases = [
    { state: "active" },
    { actorId: "github-user:2" },
    { laneRevision: "9".repeat(40) },
    { leaseEpoch: 3 },
    { reviewRequestId: "github-pull-request:PR_other" },
    { integration: integratedReplayEvidence() },
  ];
  for (const drift of driftCases) {
    let mutated = false;
    const adapter = createCloudAuthorityHandoffControllerAdapter({
      readPreservedReviewLane: () => preservedLane(),
      readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
      readCloudStatus: () => statusResult([
        integratedReplayClaim(),
        resumableSuccessorClaim(drift),
      ]),
      claimSuccessor: () => {
        mutated = true;
        return claimResult();
      },
      bindAndReviewReady: () => {
        mutated = true;
        return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
      },
      persistReviewProjection: () => {
        mutated = true;
        return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
      },
      recoverIntegratedAuthority: () => {
        mutated = true;
        return {
          authority: integratedReplayAuthority(),
          verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
        };
      },
    });

    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
    assert.equal(result.outcome, "blocked");
    assert.equal(
      result.blockingFindings.some(item => item.type === "integrated-replay-drift"),
      true,
    );
    assert.equal(mutated, false);
  }
});

test("integrated-preserved replay evidence drift blocks before every mutation route", async () => {
  const driftCases = [
    { laneRevision: "9".repeat(40) },
    { leaseEpoch: 2 },
    { reviewRequestId: "github-pull-request:PR_other" },
    { integrationReceiptDigest: null },
    {
      integration: {
        ...integratedReplayEvidence(),
        candidateRevision: "8".repeat(40),
      },
    },
    {
      integration: {
        ...integratedReplayEvidence(),
        operatorDecisionDigest: null,
      },
    },
  ];
  for (const drift of driftCases) {
    let mutated = false;
    const adapter = createCloudAuthorityHandoffControllerAdapter({
      readPreservedReviewLane: () => preservedLane(),
      readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
      readCloudStatus: () => statusResult([integratedReplayClaim(drift)]),
      claimSuccessor: () => {
        mutated = true;
        return claimResult();
      },
      bindAndReviewReady: () => {
        mutated = true;
        return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
      },
      persistReviewProjection: () => {
        mutated = true;
        return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
      },
      recoverIntegratedAuthority: () => {
        mutated = true;
        return {
          authority: integratedReplayAuthority(),
          verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
        };
      },
    });

    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
    assert.equal(result.outcome, "blocked");
    assert.equal(
      result.blockingFindings.some(item => item.type === "integrated-replay-drift"),
      true,
    );
    assert.equal(mutated, false);
  }
});

test("a drifted waiting successor remains a competing claim", async () => {
  const driftCases = [
    { laneRevision: "9".repeat(40) },
    { predecessorClaimId: "8".repeat(64) },
    { workItemId: pseudonymousIdentifier("work-item", "different-scope") },
    { leaseEpoch: 3 },
    { writeSetDigest: "7".repeat(64) },
  ];
  for (const drift of driftCases) {
    let mutated = false;
    const adapter = createCloudAuthorityHandoffControllerAdapter({
      readPreservedReviewLane: () => preservedLane(),
      readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
      readCloudStatus: () => statusResult([resumableSuccessorClaim(drift)]),
      claimSuccessor: () => {
        mutated = true;
        return claimResult();
      },
      bindAndReviewReady: () => {
        mutated = true;
        return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
      },
      persistReviewProjection: () => {
        mutated = true;
        return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
      },
    });
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === "competing-live-claim"), true);
    assert.equal(mutated, false);
  }
});

test("ambiguous exact successors block before mutation", async () => {
  let mutated = false;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([
      resumableSuccessorClaim(),
      resumableSuccessorClaim({ claimId: "a".repeat(64) }),
    ]),
    claimSuccessor: () => {
      mutated = true;
      return claimResult();
    },
    bindAndReviewReady: () => {
      mutated = true;
      return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
    },
    persistReviewProjection: () => {
      mutated = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });

  assert.equal(result.outcome, "blocked");
  assert.equal(
    result.blockingFindings.some(item => item.type === "ambiguous-successor-continuation"),
    true,
  );
  assert.equal(mutated, false);
});

test("resumable successor replay rejects a different claim identity", async () => {
  let routed = false;
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([resumableSuccessorClaim()]),
    claimSuccessor: () => claimResult({
      replayed: true,
      claimOverrides: { claimId: "a".repeat(64), state: "waiting-successor" },
    }),
    bindAndReviewReady: () => {
      routed = true;
      return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
    },
    persistReviewProjection: () => {
      routed = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  await assert.rejects(
    continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter }),
    /did not preserve the exact resumable successor identity/u,
  );
  assert.equal(routed, false);
});

test("a reviewed successor replay routes only the missing local projection", async () => {
  let observedState = null;
  let projections = 0;
  const reviewed = resumableSuccessorClaim({
    state: "reviewed",
    transitionCounter: 3,
    reviewRequestId: "github-pull-request:PR_238",
  });
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult([reviewed]),
    claimSuccessor: () => claimResult({
      replayed: true,
      claimOverrides: { state: "waiting-successor" },
    }),
    bindAndReviewReady: ({ resumableSuccessor }) => {
      observedState = resumableSuccessor?.state || null;
      return {
        authority: successorAuthority(),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
      };
    },
    persistReviewProjection: () => {
      projections += 1;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(observedState, "reviewed");
  assert.equal(projections, 1);
});

test("owner mismatch blocks reclaim", async () => {
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "someone-else" }),
    readCloudStatus: () => statusResult(),
    claimSuccessor: () => claimResult(),
    bindAndReviewReady: () => ({
      authority: successorAuthority(),
      verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
    }),
    persistReviewProjection: () => ({ receiptDigest: PROJECTION_RECEIPT_DIGEST }),
  });

  const result = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  }, { adapter });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.blockingFindings.some(item => item.type === "authenticated-owner-mismatch"), true);
});
