import test from "node:test";
import assert from "node:assert/strict";

import {
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { isOperationDerivedCloudVerification } from "../scripts/scoped-lane-admission-lib.mjs";
import {
  verifyAdmissionCloudAuthority,
  verifyCloudAuthorityState,
} from "../scripts/scoped-lane-cloud-verification.mjs";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const ledgerSha = "3".repeat(40);
const ledgerDigest = "4".repeat(64);
const claimDigest = "5".repeat(64);
const transitionDigest = "6".repeat(64);
const expiresAt = "2099-08-05T08:00:00.000Z";
const evaluatedAt = "2026-08-04T08:00:00.000Z";
const declaredWriteSet = normalizeWriteSet([
  "path:scripts/scoped-lane-cloud-verification.mjs",
  "semantic:claim-identity-admission-module-extraction",
]);
const writeSetDigest = digestValue(declaredWriteSet);
const claimIdentity = {
  actorId: "github-user:7",
  canonicalBaseRevision: baseSha,
  leaseEpoch: 1,
  repositoryId: "github-repository:R_target",
  workItemId: "work-item:module-extraction",
  writeSetDigest,
};
const claimId = digestValue(claimIdentity);
const manifest = Object.freeze({
  declaredWriteSet,
  writeSetDigest,
  manifestDigest: "7".repeat(64),
});

function claim(overrides = {}) {
  return {
    claimId,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "8".repeat(64),
    state: "current",
    actorId: claimIdentity.actorId,
    repositoryId: claimIdentity.repositoryId,
    workItemId: claimIdentity.workItemId,
    canonicalBaseRevision: baseSha,
    laneRevision: headSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 2,
    heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_276",
    expiresAt,
    fenceRevision: claimDigest,
    transitionDigest,
    ...overrides,
  };
}

function authority() {
  return Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    claimId,
    claimDigest,
    ledgerRevision: ledgerSha,
    ledgerDigest,
    claimLedgerRevision: transitionDigest,
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: "device-a",
    sessionId: "session-a",
    reviewRequestId: "github-pull-request:PR_276",
    leaseEpoch: 1,
    transitionCounter: 2,
    state: "active",
    expiresAt,
  });
}

function statusResult(currentClaim) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision: ledgerSha,
    ledgerDigest,
    claims: [currentClaim],
  };
}

function verificationResult(currentClaim) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision: ledgerSha,
    claimDigest: currentClaim.fenceRevision,
    claim: currentClaim,
    findings: [],
    receipt: {
      receiptDigest: "9".repeat(64),
      ledgerDigest,
      evaluationTime: evaluatedAt,
    },
  };
}

test("cloud verification joins status, CAS, claim identity, and typed receipt", () => {
  const currentClaim = claim();
  const result = verifyAdmissionCloudAuthority({
    authority: authority(),
    manifest,
    canonicalBaseSha: baseSha,
    inspect: () => statusResult(currentClaim),
    invoke: () => verificationResult(currentClaim),
  });
  assert.equal(result.authority.claimDigest, claimDigest);
  assert.equal(result.verification.status, "ready");
  assert.equal(isOperationDerivedCloudVerification(result.verification), true);
  assert.equal(result.verification.inventory.claims[0].claimId, claimId);
  assert.equal(Object.isFrozen(result.verification.inventory.claims), true);
  assert.equal(Object.isFrozen(result.authority.cloudDeclaredWriteScope), true);
  assert.throws(() => result.verification.inventory.claims.pop(), TypeError);
  assert.throws(() => result.authority.cloudDeclaredWriteScope.push("path:mutated"),
    TypeError);
});

test("cloud verification rejects stale or competing subject projections", () => {
  const currentClaim = claim();
  assert.throws(() => verifyCloudAuthorityState({
    authority: authority(),
    manifest,
    canonicalBaseSha: baseSha,
    expectedState: "active",
    expectedLaneRevision: headSha,
    inspect: () => statusResult(currentClaim),
    invoke: () => verificationResult({
      ...currentClaim,
      laneRevision: "a".repeat(40),
    }),
  }), /drifted from the scoped admission subject/);
  assert.throws(() => verifyCloudAuthorityState({
    authority: authority(),
    manifest,
    canonicalBaseSha: baseSha,
    expectedState: "active",
    expectedLaneRevision: headSha,
    inspect: () => statusResult({
      ...currentClaim,
      writeSetDigest: "0".repeat(64),
    }),
    invoke: () => verificationResult(currentClaim),
  }), /invalid write-set digest/);
});
