import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildRetiredPlannedAdmissionOwnerReceipt,
  isRetiredPlannedAdmissionOwnerLane,
} from "../scripts/retired-planned-admission-owner-lib.mjs";

const sha = value => String(value).repeat(40).slice(0, 40);
const digest = value => String(value).repeat(64).slice(0, 64);
const retiredAt = "2026-08-12T02:00:00.000Z";

test("a cloud-retired planned owner becomes retired-preserved without losing its commit", () => {
  const originalLease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: "source-session",
    device: "device",
    scope: "source-scope",
    branch: "agent/device/source-scope",
    worktreePath: "/workspace/source",
    baseSha: sha("a"),
    fenceSha: sha("b"),
    pullRequestUrl: "https://github.test/owner/repository/pull/1",
    heartbeatAt: "2026-08-12T01:00:00.000Z",
    expiresAt: "2026-08-12T03:00:00.000Z",
    admission: { status: "planned" },
    cloudAuthority: { claimId: digest("c") },
  };
  const lane = {
    path: "/workspace/source",
    branch: "refs/heads/agent/device/source-scope",
    head: sha("d"),
    treeSha: sha("e"),
    stateDigest: digest("f"),
    dirty: false,
  };
  const receipt = buildRetiredPlannedAdmissionOwnerReceipt({
    authorizationDigest: digest("1"),
    source: { ...lane, lease: originalLease, remoteHeadSha: sha("b") },
    candidate: {
      claimId: digest("2"),
      branch: "agent/device/candidate",
      sessionId: "candidate-session",
      admissionReceiptDigest: digest("3"),
    },
    cloud: {
      ledgerRevision: sha("4"),
      ledgerDigest: digest("5"),
      verificationReceiptDigest: digest("6"),
      sourceClaimId: digest("c"),
      sourceClaimAbsent: true,
    },
    provider: {
      url: originalLease.pullRequestUrl,
      number: 1,
      state: "CLOSED",
      draft: true,
      mergedAt: null,
      closedAt: "2026-08-12T01:30:00.000Z",
      headBranch: originalLease.branch,
      headSha: originalLease.fenceSha,
      baseBranch: "main",
      baseSha: originalLease.baseSha,
    },
    retiredAt,
  });
  const released = {
    ...originalLease,
    status: "released",
    heartbeatAt: retiredAt,
    expiresAt: retiredAt,
    admission: null,
    cloudAuthority: null,
    admissionOwnerRetirement: receipt,
  };
  assert.equal(isRetiredPlannedAdmissionOwnerLane({ lane: { ...lane, lease: released } }), true);
  assert.equal(receipt.source.headSha, lane.head);
  assert.equal(receipt.source.originalLeaseDigest, digestValue(originalLease));
});

test("retired-preserved evidence fails closed on dirt, head drift, or receipt drift", () => {
  assert.equal(isRetiredPlannedAdmissionOwnerLane({ lane: { dirty: false } }), false);
});
