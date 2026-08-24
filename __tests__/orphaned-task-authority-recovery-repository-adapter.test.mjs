import assert from "node:assert/strict";
import test from "node:test";

import { selectRetiredReviewedCloudClaimProof }
  from "../scripts/orphaned-task-authority-recovery-repository-adapter.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function fixture() {
  const claimId = digest("1");
  const claimDigest = digest("2");
  const laneRevision = sha("a");
  const reviewRequestId = "github-pull-request:review-node";
  const lease = {
    status: "review_ready",
    fenceSha: laneRevision,
    reviewHeadSha: laneRevision,
    cloudAuthority: {
      state: "review_ready",
      claimId,
      claimDigest,
      laneRevision,
      writeSetDigest: digest("3"),
      reviewRequestId,
    },
  };
  const reviewed = {
    claimId,
    claimDigest,
    digest: digest("4"),
    claimCore: {
      state: "reviewed",
      transitionCounter: 5,
      laneRevision,
      writeSetDigest: digest("3"),
      reviewRequestId,
    },
  };
  const retired = {
    claimId,
    claimDigest: digest("5"),
    digest: digest("6"),
    claimCore: {
      state: "retired",
      transitionCounter: 6,
      retirement: {
        reason: "superseded",
        finalRevision: laneRevision,
        reviewRequestId,
      },
    },
  };
  return { lease, reviewed, retired };
}

test("selects only the exact reviewed projection and adjacent terminal retirement", () => {
  const { lease, reviewed, retired } = fixture();
  const proof = selectRetiredReviewedCloudClaimProof({ entries: [reviewed, retired], lease });
  assert.equal(proof.schema,
    "agentic-orphaned-task-authority-retired-reviewed-cloud-proof/v1");
  assert.equal(proof.claimDigest, lease.cloudAuthority.claimDigest);
  assert.equal(proof.sourceTransitionDigest, reviewed.digest);
  assert.equal(proof.terminalTransitionDigest, retired.digest);
  assert.equal(proof.finalRevision, lease.reviewHeadSha);
});

test("rejects a non-adjacent retirement or a mismatched local claim projection", () => {
  const { lease, reviewed, retired } = fixture();
  assert.throws(() => selectRetiredReviewedCloudClaimProof({
    entries: [reviewed, {
      ...retired,
      claimCore: { ...retired.claimCore, transitionCounter: 7 },
    }],
    lease,
  }), /terminal retirement fence/u);
  assert.throws(() => selectRetiredReviewedCloudClaimProof({
    entries: [reviewed, retired],
    lease: {
      ...lease,
      cloudAuthority: { ...lease.cloudAuthority, claimDigest: digest("9") },
    },
  }), /no unique local claim projection/u);
});

test("rejects fallback for a local lease that is not review-ready", () => {
  const { lease, reviewed, retired } = fixture();
  assert.throws(() => selectRetiredReviewedCloudClaimProof({
    entries: [reviewed, retired],
    lease: { ...lease, status: "active" },
  }), /locally review-ready/u);
});
