import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  reviewedSuccessorEvidenceMatchesPlan,
  reviewedSuccessorMarkerHeadSha,
}
  from "../scripts/reviewed-successor-projection-response-loss-repository-adapter.mjs";

const SHA = value => value.repeat(40);
const DIGEST = value => digestValue(value);

function evidence(observedAt) {
  const oldClaim = DIGEST("old");
  const newClaim = DIGEST("new");
  const baseSha = SHA("1");
  const headSha = SHA("2");
  const markerDigest = DIGEST("marker");
  const writeSetDigest = DIGEST("write-set");
  const core = {
    mode: "absent-predecessor",
    observedAt,
    repository: "huijoohwee/agentic-canvas-os",
    actorId: "github-user:1",
    workItemId: "repository-teardown",
    branch: "agent/device/repository-teardown",
    sessionId: "session",
    local: { status: "review_ready", admissionStatus: "admitted", clean: true, baseSha, headSha, writeSetDigest, reviewRequestId: "github-pull-request:PR519", leaseEpoch: 1, claimId: oldClaim, taskBindingDigest: DIGEST("binding"), leaseDigest: DIGEST("lease"), markerDigest },
    remoteHeadSha: headSha,
    pullRequest: { number: 519, id: "PR519", url: "https://github.com/huijoohwee/agentic-canvas-os/pull/519", state: "OPEN", isDraft: false, autoMergeRequest: null, headRefName: "agent/device/repository-teardown", headRefOid: headSha, baseRefName: "main", markerClaimId: oldClaim, markerLeaseEpoch: 1, markerDigest },
    predecessor: { claimId: oldClaim, cloudInventoryMatches: 0, leaseEpoch: 1 },
    successor: { cloudInventoryMatches: 1, claimId: newClaim, predecessorClaimId: oldClaim, state: "dormant-preserved", actorId: "github-user:1", repository: "huijoohwee/agentic-canvas-os", workItemId: "repository-teardown", canonicalBaseSha: baseSha, laneRevision: headSha, writeSetDigest, reviewRequestId: "github-pull-request:PR519", leaseEpoch: 2, integrationState: "not-integrated", operationReceiptDigest: DIGEST("operation"), verificationReceiptDigest: DIGEST("verification"), authorityDigest: DIGEST("authority") },
    partialLocal: null,
  };
  return { ...core, evidenceDigest: DIGEST(core) };
}

test("review-ready partial-local markers use the reviewed head instead of a stale fence", () => {
  const reviewedHeadSha = SHA("c");
  const marker = {
    status: "review_ready",
    fenceSha: SHA("7"),
    reviewHeadSha: reviewedHeadSha,
  };

  assert.equal(reviewedSuccessorMarkerHeadSha(marker), reviewedHeadSha);
});

test("a changed review-ready marker head cannot satisfy the sealed lane head", () => {
  const sealedHeadSha = SHA("c");
  const marker = {
    status: "review_ready",
    fenceSha: SHA("7"),
    reviewHeadSha: SHA("d"),
  };

  assert.notEqual(reviewedSuccessorMarkerHeadSha(marker), sealedHeadSha);
});

test("active markers continue to use their fencing head", () => {
  const fenceSha = SHA("7");
  const marker = {
    status: "active",
    fenceSha,
    reviewHeadSha: SHA("c"),
  };

  assert.equal(reviewedSuccessorMarkerHeadSha(marker), fenceSha);
});

test("an active successor marker does not depend on reviewed-head metadata", () => {
  const fenceSha = SHA("8");
  assert.equal(reviewedSuccessorMarkerHeadSha({
    status: "active",
    fenceSha,
    reviewHeadSha: null,
    cloudAuthority: { reviewRequestId: null },
  }), fenceSha);
});

test("adapter replay validation ignores fresh observation metadata only", () => {
  const planned = evidence("2026-08-16T06:00:00.000Z");
  const live = evidence("2026-08-16T06:05:00.000Z");

  assert.equal(reviewedSuccessorEvidenceMatchesPlan(live, planned), true);

  live.successor.authorityDigest = DIGEST("changed-authority");
  delete live.evidenceDigest;
  live.evidenceDigest = DIGEST(live);
  assert.equal(reviewedSuccessorEvidenceMatchesPlan(live, planned), false);
});
