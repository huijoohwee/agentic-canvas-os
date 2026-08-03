import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
  continueExpiredReviewLaneAuthority,
  createCloudAuthorityHandoffControllerAdapter,
} from "../scripts/cloud-authority-handoff-controller.mjs";

const BASE_SHA = "a".repeat(40);
const REVIEW_SHA = "b".repeat(40);
const PREDECESSOR_CLAIM_ID = "c".repeat(64);
const PREDECESSOR_CLAIM_DIGEST = "d".repeat(64);
const PREDECESSOR_LEDGER_DIGEST = "e".repeat(64);
const PREDECESSOR_FOCUSED_EVIDENCE = "f".repeat(64);
const SUCCESSOR_CLAIM_ID = "1".repeat(64);
const SUCCESSOR_CLAIM_DIGEST = "2".repeat(64);
const SUCCESSOR_LEDGER_DIGEST = "3".repeat(64);
const MANIFEST_DIGEST = "4".repeat(64);
const WRITE_SET_DIGEST = "5".repeat(64);
const ADMITTED_REPORT_DIGEST = "6".repeat(64);
const CLAIM_RECEIPT_DIGEST = "7".repeat(64);
const REVIEW_RECEIPT_DIGEST = "8".repeat(64);
const PROJECTION_RECEIPT_DIGEST = "9".repeat(64);

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

function claimResult() {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "claim",
    status: "active",
    ledgerRevision: BASE_SHA,
    claimDigest: SUCCESSOR_CLAIM_DIGEST,
    claim: {
      claimId: SUCCESSOR_CLAIM_ID,
      state: "active",
      canonicalBaseRevision: BASE_SHA,
      laneRevision: REVIEW_SHA,
      declaredWriteScope: [
        "path:docs/CANONICAL-LIFECYCLE.md",
        "path:scripts/legacy-authority-evaluator.mjs",
        "semantic:legacy-authority-evaluator",
      ],
      writeSetDigest: WRITE_SET_DIGEST,
      reviewRequestId: "github-pull-request:PR_238",
      leaseEpoch: 2,
      transitionCounter: 1,
      expiresAt: "2026-08-03T09:07:22.000Z",
      transitionDigest: SUCCESSOR_LEDGER_DIGEST,
    },
    receipt: { receiptDigest: CLAIM_RECEIPT_DIGEST, evaluationTime: "2026-08-03T08:30:00.000Z" },
  };
}

test("reclaim restores live authority for the exact preserved review lane", async () => {
  const events = [];
  const adapter = createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => preservedLane(),
    readAuthenticatedOwner: () => ({ id: 1, login: "owner" }),
    readCloudStatus: () => statusResult(),
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
  assert.deepEqual(events, [
    ["claim", "reclaim", PREDECESSOR_CLAIM_ID],
    ["ready", "legacy-session", "legacy-device"],
    ["persist", SUCCESSOR_CLAIM_ID],
  ]);
  assert.equal(result.receipts.length, 3);
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
