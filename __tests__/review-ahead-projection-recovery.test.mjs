import assert from "node:assert/strict";
import test from "node:test";

import {
  createReviewAheadPlan,
  REVIEW_AHEAD_AUTHORIZATION_PREFIX,
} from "../scripts/review-ahead-projection-recovery-contract.mjs";
import { createReviewAheadProjectionController } from "../scripts/review-ahead-projection-recovery-controller.mjs";
import { captureReviewAheadProjectionEvidence } from "../scripts/review-ahead-projection-recovery-evidence.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const expired = "2026-08-10T00:00:00.000Z";

function fixture(overrides = {}) {
  return {
    repository: "/repo", repositoryId: "github-repository:R_test", branch: "agent/device.local/scope",
    deviceId: "device.local", sessionId: "source-session", actorLogin: "owner", clean: true,
    localHeadSha: sha("a"), refreshedHeadSha: null, localDescendantReceiptDigest: null,
    remoteHeadSha: sha("a"), reviewHeadSha: sha("a"), pullRequestHeadSha: sha("a"),
    pullRequestUrl: "https://github.com/o/r/pull/1", pullRequestAuthorLogin: "owner",
    pullRequestState: "OPEN", pullRequestDraft: false, pullRequestAutoMergeArmed: false,
    leaseStatus: "active", localExpiresAt: expired, localAuthorityState: "review_ready",
    claimId: digest("1"), authorityLaneRevision: sha("a"), reviewRequestId: "github-pull-request:PR_1",
    writeSetDigest: digest("2"), declaredWriteScope: ["path:a", "semantic:scope"], leaseEpoch: 1,
    remoteClaimId: digest("1"), remoteClaimState: "dormant-preserved",
    remoteRepositoryId: "github-repository:R_test", remoteLaneRevision: sha("a"),
    remoteDeviceId: "device.local", remoteSessionId: "source-session",
    remoteReviewRequestId: "github-pull-request:PR_1", remoteWriteSetDigest: digest("2"),
    remoteDeclaredWriteScope: ["path:a", "semantic:scope"], remoteLeaseEpoch: 1,
    remoteExpiresAt: expired,
    ...overrides,
  };
}

test("plan binds the exact expired review-ahead projection", () => {
  const plan = createReviewAheadPlan(fixture(), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "planned");
  assert.equal(plan.authorization, `${REVIEW_AHEAD_AUTHORIZATION_PREFIX} ${plan.planDigest}`);
  assert.deepEqual(plan.findings, []);
});

test("identity, provider, dirt, and non-expiry drift block before mutation", () => {
  const cases = [
    { clean: false }, { leaseStatus: "delivery" }, { remoteClaimState: "current" },
    { pullRequestDraft: true }, { pullRequestAutoMergeArmed: true }, { pullRequestHeadSha: sha("b") },
    { localHeadSha: sha("b"), localDescendantReceiptDigest: null },
    { remoteClaimId: digest("3") }, { remoteRepositoryId: "github-repository:R_other" },
    { localExpiresAt: "2026-08-10T02:00:00.000Z" },
  ];
  for (const change of cases) {
    assert.equal(
      createReviewAheadPlan(fixture(change), { now: new Date("2026-08-10T01:00:00.000Z") }).status,
      "blocked",
    );
  }
});

test("receipt-bound in-scope commits may be ahead of the reviewed remote head", () => {
  const plan = createReviewAheadPlan(fixture({
    localHeadSha: sha("b"),
    localDescendantReceiptDigest: digest("6"),
  }), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "planned");
});

test("an exact integrated-preserved post-success state remains replayable before expiry", () => {
  const plan = createReviewAheadPlan(fixture({
    remoteClaimState: "integrated-preserved",
    localExpiresAt: "2026-08-10T02:00:00.000Z",
    remoteExpiresAt: "2026-08-10T02:00:00.000Z",
  }), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.findings, []);
  assert.ok(plan.allowedMutations.includes("cloud-integrated-replay-receipt"));
});

test("integrated-preserved replay accepts one receipt-bound protected refresh head", () => {
  const refreshedHead = sha("b");
  const plan = createReviewAheadPlan(fixture({
    remoteClaimState: "integrated-preserved",
    localHeadSha: refreshedHead,
    localDescendantReceiptDigest: digest("6"),
    remoteHeadSha: refreshedHead,
    pullRequestHeadSha: refreshedHead,
    localExpiresAt: "2026-08-10T02:00:00.000Z",
    remoteExpiresAt: "2026-08-10T02:00:00.000Z",
  }), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.findings, []);
});

test("expired dormant-preserved replay accepts the same exact protected refresh proof", () => {
  const refreshedHead = sha("b");
  const plan = createReviewAheadPlan(fixture({
    localHeadSha: refreshedHead,
    localDescendantReceiptDigest: digest("6"),
    remoteHeadSha: refreshedHead,
    pullRequestHeadSha: refreshedHead,
  }), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.findings, []);
  assert.ok(plan.allowedMutations.includes("cloud-successor-reclaim"));
});

test("dormant-preserved protected refresh remains blocked before expiry", () => {
  const refreshedHead = sha("b");
  const plan = createReviewAheadPlan(fixture({
    localHeadSha: refreshedHead,
    localDescendantReceiptDigest: digest("6"),
    remoteHeadSha: refreshedHead,
    pullRequestHeadSha: refreshedHead,
    localExpiresAt: "2026-08-10T02:00:00.000Z",
    remoteExpiresAt: "2026-08-10T02:00:00.000Z",
  }), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.findings.includes("authority-not-expired"));
});

test("integrated-preserved protected refresh requires local remote and PR head equality", () => {
  const plan = createReviewAheadPlan(fixture({
    remoteClaimState: "integrated-preserved",
    localHeadSha: sha("b"),
    localDescendantReceiptDigest: digest("6"),
    remoteHeadSha: sha("b"),
    pullRequestHeadSha: sha("c"),
  }), { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.findings.includes("review-head-provider-drift"));
});

test("descendant evidence binds protected-main equivalence to the lane base", async () => {
  const base = fixture({ localHeadSha: sha("b") });
  let receiptRequest;
  const lane = {
    repository: base.repository,
    branch: base.branch,
    baseSha: sha("0"),
    headSha: base.reviewHeadSha,
    refreshedHeadSha: null,
    remoteHeadSha: base.localHeadSha,
    clean: true,
    authority: {
      state: "review_ready",
      claimId: base.claimId,
      laneRevision: base.authorityLaneRevision,
      reviewRequestId: base.reviewRequestId,
      writeSetDigest: base.writeSetDigest,
      cloudDeclaredWriteScope: base.declaredWriteScope,
      leaseEpoch: 1,
      ledgerRepository: "o/ledger",
      targetRepository: "o/r",
    },
    lease: {
      status: "review_ready",
      sessionId: base.sessionId,
      expiresAt: expired,
      device: "device.local",
    },
    pullRequest: {
      headRefOid: base.localHeadSha,
      url: base.pullRequestUrl,
      authorLogin: "owner",
      state: "OPEN",
      isDraft: false,
    },
  };
  const adapter = {
    async readPreservedReviewLane() { return lane; },
    async readLocalHead() { return base.localHeadSha; },
    async readLocalDescendantReceipt(request) {
      receiptRequest = request;
      return { receiptDigest: digest("6") };
    },
    async readCloudStatus() {
      return {
        repositoryId: base.repositoryId,
        claims: [{
          claimId: base.claimId,
          state: "integrated-preserved",
          repositoryId: base.repositoryId,
          laneRevision: base.authorityLaneRevision,
          reviewRequestId: base.reviewRequestId,
          writeSetDigest: base.writeSetDigest,
          declaredWriteScope: base.declaredWriteScope,
          leaseEpoch: 1,
          expiresAt: expired,
        }],
      };
    },
    async readAuthenticatedOwner() { return { login: "owner" }; },
  };

  await captureReviewAheadProjectionEvidence({
    adapter,
    branch: base.branch,
    sessionId: base.sessionId,
  });
  assert.equal(receiptRequest.baseSha, lane.baseSha);
  assert.equal(receiptRequest.reviewHeadSha, lane.headSha);
  assert.equal(receiptRequest.localHeadSha, base.localHeadSha);
});

test("execute projects review-ready once then delegates exact same-session reclaim", async () => {
  let status = "active";
  let projected = 0;
  const base = fixture();
  const lane = {
    repository: base.repository, branch: base.branch, headSha: base.reviewHeadSha,
    refreshedHeadSha: null, remoteHeadSha: base.remoteHeadSha, clean: true,
    authority: {
      state: "review_ready", claimId: base.claimId, laneRevision: base.authorityLaneRevision,
      reviewRequestId: base.reviewRequestId, writeSetDigest: base.writeSetDigest,
      cloudDeclaredWriteScope: base.declaredWriteScope, leaseEpoch: 1,
      ledgerRepository: "o/ledger", targetRepository: "o/r",
    },
    lease: { status, sessionId: base.sessionId, expiresAt: expired, device: "device.local" },
    pullRequest: {
      headRefOid: base.pullRequestHeadSha, url: base.pullRequestUrl,
      authorLogin: "owner", state: "OPEN", isDraft: false,
    },
  };
  const adapter = {
    async readPreservedReviewLane() { return { ...lane, lease: { ...lane.lease, status } }; },
    async readCloudStatus() {
      return {
        repositoryId: base.repositoryId,
        claims: [{
          claimId: base.claimId, state: "dormant-preserved", repositoryId: base.repositoryId,
          predecessorClaimId: digest("9"),
          reviewRequestId: base.reviewRequestId, writeSetDigest: base.writeSetDigest,
          laneRevision: sha("a"), deviceId: "device.local", sessionId: base.sessionId,
          declaredWriteScope: base.declaredWriteScope, leaseEpoch: 1, expiresAt: expired,
        }],
      };
    },
    async readAuthenticatedOwner() { return { login: "owner" }; },
    async createLineageProjectionProof() {
      throw new Error("Dormant successor reclaim must not build an integrated replay proof.");
    },
    async persistReviewProjection() {
      projected += 1;
      status = "review_ready";
      return { receiptDigest: digest("4") };
    },
  };
  let reclaimed = 0;
  const controller = createReviewAheadProjectionController({
    adapter,
    now: () => new Date("2026-08-10T01:00:00.000Z"),
    async reclaim(request, options) {
      reclaimed += 1;
      assert.equal(request.sessionId, base.sessionId);
      assert.equal(options.lineageProjectionProof, null);
      return {
        outcome: reclaimed === 1 ? "reclaimed-live" : "reclaimed-live-replay",
        successorClaimId: digest("5"),
      };
    },
  });
  const plan = await controller.plan({ branch: base.branch, sessionId: base.sessionId });
  const result = await controller.execute({
    branch: base.branch, sessionId: base.sessionId, authorization: plan.authorization,
  });
  assert.equal(result.status, "review-ready-reclaimed");
  assert.equal(result.successorClaimId, digest("5"));
  assert.equal(status, "review_ready");
  assert.equal(reclaimed, 1);
  const replayPlan = await controller.plan({ branch: base.branch, sessionId: base.sessionId });
  await controller.execute({
    branch: base.branch, sessionId: base.sessionId, authorization: replayPlan.authorization,
  });
  assert.equal(projected, 1);
  assert.equal(reclaimed, 2);
});

test("integrated replay forwards its fresh branded lineage proof to the shared reclaim", async () => {
  const live = "2026-08-10T02:00:00.000Z";
  const base = fixture({
    remoteClaimState: "integrated-preserved",
    localExpiresAt: live,
    remoteExpiresAt: live,
  });
  const lane = {
    repository: base.repository,
    branch: base.branch,
    headSha: base.reviewHeadSha,
    refreshedHeadSha: null,
    remoteHeadSha: base.remoteHeadSha,
    clean: true,
    authority: {
      state: "review_ready",
      claimId: base.claimId,
      laneRevision: base.authorityLaneRevision,
      reviewRequestId: base.reviewRequestId,
      writeSetDigest: base.writeSetDigest,
      cloudDeclaredWriteScope: base.declaredWriteScope,
      leaseEpoch: 1,
      ledgerRepository: "o/ledger",
      targetRepository: "o/r",
    },
    lease: {
      status: "review_ready",
      sessionId: base.sessionId,
      expiresAt: live,
      device: "device.local",
    },
    pullRequest: {
      headRefOid: base.pullRequestHeadSha,
      url: base.pullRequestUrl,
      authorLogin: "owner",
      state: "OPEN",
      isDraft: false,
      autoMergeRequest: null,
    },
  };
  const lineageProjectionProof = Object.freeze({ kind: "opaque-branded-proof" });
  let proofCalls = 0;
  const adapter = {
    async readPreservedReviewLane() { return lane; },
    async readCloudStatus() {
      return {
        repositoryId: base.repositoryId,
        claims: [{
          claimId: base.claimId,
          predecessorClaimId: digest("9"),
          state: "integrated-preserved",
          repositoryId: base.repositoryId,
          reviewRequestId: base.reviewRequestId,
          writeSetDigest: base.writeSetDigest,
          laneRevision: base.authorityLaneRevision,
          declaredWriteScope: base.declaredWriteScope,
          leaseEpoch: 1,
          expiresAt: live,
        }],
      };
    },
    async readAuthenticatedOwner() { return { login: "owner" }; },
    async createLineageProjectionProof({ request, observedAt }) {
      proofCalls += 1;
      assert.equal(request.transition, "reclaim");
      assert.equal(request.sessionId, base.sessionId);
      assert.equal(observedAt.toISOString(), "2026-08-10T01:00:00.000Z");
      return lineageProjectionProof;
    },
  };
  const controller = createReviewAheadProjectionController({
    adapter,
    now: () => new Date("2026-08-10T01:00:00.000Z"),
    async reclaim(request, options) {
      assert.equal(request.successorSessionId, base.sessionId);
      assert.equal(options.lineageProjectionProof, lineageProjectionProof);
      return {
        outcome: "reclaimed-live-replay",
        successorClaimId: base.claimId,
      };
    },
  });
  const plan = await controller.plan({ branch: base.branch, sessionId: base.sessionId });
  const result = await controller.execute({
    branch: base.branch,
    sessionId: base.sessionId,
    authorization: plan.authorization,
  });
  assert.equal(result.status, "review-ready-reclaimed");
  assert.equal(result.successorClaimId, base.claimId);
  assert.equal(proofCalls, 1);
});

test("execute rejects a stale authorization before projection", async () => {
  let projected = false;
  const base = fixture();
  const adapter = {
    async readPreservedReviewLane() {
      return {
        repository: base.repository, branch: base.branch, headSha: base.reviewHeadSha,
        refreshedHeadSha: null, remoteHeadSha: base.remoteHeadSha, clean: true,
        authority: {
          state: "review_ready", claimId: base.claimId, laneRevision: base.authorityLaneRevision,
          reviewRequestId: base.reviewRequestId, writeSetDigest: base.writeSetDigest,
          cloudDeclaredWriteScope: base.declaredWriteScope, leaseEpoch: 1,
          ledgerRepository: "o/l", targetRepository: "o/r",
        },
        lease: { status: "active", sessionId: base.sessionId, expiresAt: expired, device: "device.local" },
        pullRequest: {
          headRefOid: base.pullRequestHeadSha, url: base.pullRequestUrl,
          authorLogin: "owner", state: "OPEN", isDraft: false,
        },
      };
    },
    async readCloudStatus() {
      return { repositoryId: base.repositoryId, claims: [{
        claimId: base.claimId, state: "dormant-preserved", repositoryId: base.repositoryId,
        reviewRequestId: base.reviewRequestId, writeSetDigest: base.writeSetDigest,
        laneRevision: sha("a"), deviceId: "device.local", sessionId: base.sessionId,
        declaredWriteScope: base.declaredWriteScope, leaseEpoch: 1, expiresAt: expired,
      }] };
    },
    async readAuthenticatedOwner() { return { login: "owner" }; },
    async persistReviewProjection() { projected = true; },
  };
  const controller = createReviewAheadProjectionController({
    adapter, now: () => new Date("2026-08-10T01:00:00.000Z"),
  });
  await assert.rejects(
    controller.execute({ branch: base.branch, sessionId: base.sessionId, authorization: "stale" }),
    /Exact authorization required/u,
  );
  assert.equal(projected, false);
});
