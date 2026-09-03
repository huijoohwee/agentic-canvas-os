import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  claimProvenanceMatches,
  classifyExistingLane,
} from "../scripts/scoped-lane-admission-ownership.mjs";

const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const future = "2099-08-05T08:00:00.000Z";
const writeSet = ["path:docs/peer", "semantic:peer-scope"];
const writeSetDigest = digestValue(writeSet);
const claimId = "1".repeat(64);
const claimDigest = "2".repeat(64);
const transitionDigest = "3".repeat(64);

function fixture() {
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    claimId,
    claimDigest,
    ledgerRevision: "c".repeat(40),
    ledgerDigest: "4".repeat(64),
    claimLedgerRevision: transitionDigest,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "5".repeat(64),
    canonicalBaseSha: baseSha,
    laneRevision: fenceSha,
    cloudDeclaredWriteScope: writeSet,
    writeSetDigest,
    deviceId: "peer",
    sessionId: "peer-session",
    reviewRequestId: "github-pull-request:PR_peer",
    leaseEpoch: 1,
    transitionCounter: 2,
    state: "active",
    expiresAt: future,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 126,
    sessionId: "peer-session",
    device: "peer",
    scope: "peer-scope",
    branch: "agent/peer/peer-scope",
    worktreePath: "/workspace/.worktrees/repository/peer-scope",
    baseSha,
    fenceSha,
    pullRequestUrl: "https://github.test/o/r/pull/9",
    expiresAt: future,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "peer-scope",
      declaredWriteSet: writeSet,
      writeSetDigest,
      admissionReceiptDigest: "6".repeat(64),
      preservationReceiptDigest: "7".repeat(64),
    },
    cloudAuthority,
  };
  const lane = {
    path: lease.worktreePath,
    head: fenceSha,
    branch: `refs/heads/${lease.branch}`,
    dirty: true,
    invalid: false,
    leaseAmbiguous: false,
    lease,
  };
  const claim = {
    claimId,
    entrySchema: cloudAuthority.entrySchema,
    claimIdentitySchema: cloudAuthority.claimIdentitySchema,
    operationReceiptDigest: cloudAuthority.operationReceiptDigest,
    state: "active",
    canonicalBaseRevision: baseSha,
    laneRevision: fenceSha,
    declaredWriteScope: writeSet,
    writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 2,
    reviewRequestId: cloudAuthority.reviewRequestId,
    expiresAt: future,
    fenceRevision: claimDigest,
    transitionDigest,
  };
  return { cloudAuthority, claim, lane };
}

test("ownership classifies one exact current peer and preserves disjoint concurrency", () => {
  const { cloudAuthority, claim, lane } = fixture();
  assert.equal(claimProvenanceMatches(claim, cloudAuthority), true);
  const disjoint = classifyExistingLane({
    lane,
    branch: "agent/device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T08:00:00.000Z"),
    currentRemoteClaims: [claim],
    deliveryPeerAuthorities: new Map(),
  });
  assert.equal(disjoint.classification, "disjoint-attributed");
  const overlapping = classifyExistingLane({
    lane,
    branch: "agent/device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/peer/child", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T08:00:00.000Z"),
    currentRemoteClaims: [claim],
    deliveryPeerAuthorities: new Map(),
  });
  assert.equal(overlapping.classification, "overlapping");
  assert.ok(overlapping.overlapReasons.includes("write-set-overlap"));
  for (const receiptField of [
    "admissionReceiptDigest",
    "preservationReceiptDigest",
  ]) {
    const withoutReceipt = structuredClone(lane);
    delete withoutReceipt.lease.admission[receiptField];
    const missingReceipt = classifyExistingLane({
      lane: withoutReceipt,
      branch: "agent/device/new-scope",
      semanticScope: "new-scope",
      declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
      evaluatedAt: new Date("2026-08-04T08:00:00.000Z"),
      currentRemoteClaims: [claim],
      deliveryPeerAuthorities: new Map(),
    });
    assert.equal(missingReceipt.classification, "ambiguous", receiptField);
  }
});

test("historical or stale provenance cannot become current write authority", () => {
  const { cloudAuthority, claim, lane } = fixture();
  const historical = {
    ...claim,
    entrySchema: "agentic-cloud-collaboration-entry/v1",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    operationReceiptDigest: null,
  };
  assert.equal(claimProvenanceMatches(historical, cloudAuthority), false);
  const classified = classifyExistingLane({
    lane,
    branch: "agent/device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T08:00:00.000Z"),
    currentRemoteClaims: [{ ...claim, transitionCounter: 3 }],
    deliveryPeerAuthorities: new Map(),
  });
  assert.equal(classified.classification, "ambiguous");
  assert.ok(classified.overlapReasons.includes("missing-authoritative-owner"));
});

test("dormant-preserved authority survives local expiry but not CAS drift", () => {
  const { claim, lane } = fixture();
  lane.lease.status = "parked";
  lane.lease.expiresAt = "2026-08-03T08:00:00.000Z";
  lane.lease.cloudAuthority.state = "parked";
  lane.lease.cloudAuthority.expiresAt = lane.lease.expiresAt;
  const parkedClaim = {
    ...claim,
    state: "parked",
    expiresAt: lane.lease.expiresAt,
  };
  const classify = remoteClaim => classifyExistingLane({
    lane,
    branch: "agent/device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T08:00:00.000Z"),
    currentRemoteClaims: [remoteClaim],
    deliveryPeerAuthorities: new Map(),
  });
  assert.equal(classify(parkedClaim).classification, "disjoint-attributed");
  assert.equal(classify({
    ...parkedClaim,
    transitionDigest: "8".repeat(64),
  }).classification, "ambiguous");
});
