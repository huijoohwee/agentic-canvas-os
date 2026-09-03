import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { markOperationDerivedCloudVerification } from "../scripts/scoped-lane-admission-lib.mjs";
import { assertAdmissionMutationAuthority } from "../scripts/scoped-lane-mutation-authority.mjs";

const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const ledgerSha = "c".repeat(40);
const claimDigest = "1".repeat(64);
const transitionDigest = "2".repeat(64);
const ledgerDigest = "3".repeat(64);
const operationReceiptDigest = "4".repeat(64);
const receiptDigest = "5".repeat(64);
const evaluatedAt = "2026-08-04T08:00:00.000Z";
const expiresAt = "2099-08-05T08:00:00.000Z";
const declaredWriteSet = [
  "path:scripts/scoped-lane-mutation-authority.mjs",
  "semantic:module-extraction",
];
const writeSetDigest = digestValue(declaredWriteSet);
const claimId = "6".repeat(64);

function fixture(extraClaims = []) {
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    claimId,
    claimDigest,
    ledgerRevision: ledgerSha,
    ledgerDigest,
    claimLedgerRevision: transitionDigest,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest,
    canonicalBaseSha: baseSha,
    laneRevision: fenceSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: "device",
    sessionId: "session",
    reviewRequestId: "github-pull-request:PR_276",
    leaseEpoch: 1,
    transitionCounter: 3,
    state: "active",
    expiresAt,
  };
  const candidate = {
    claimId,
    entrySchema: cloudAuthority.entrySchema,
    claimIdentitySchema: cloudAuthority.claimIdentitySchema,
    operationReceiptDigest,
    state: "active",
    actorId: "github-user:1",
    repositoryId: "github-repository:R_1",
    workItemId: "work-item:module-extraction",
    canonicalBaseRevision: baseSha,
    laneRevision: fenceSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 3,
    reviewRequestId: cloudAuthority.reviewRequestId,
    expiresAt,
    fenceRevision: claimDigest,
    transitionDigest,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 162,
    sessionId: "session",
    device: "device",
    baseSha,
    fenceSha,
    pullRequestUrl: "https://github.test/o/r/pull/276",
    expiresAt,
    admission: {
      status: "admitted",
      declaredWriteSet,
      writeSetDigest,
    },
    cloudAuthority,
  };
  const records = [candidate, ...extraClaims].map(source => {
    const { recordDigest: _recordDigest, ...recordCore } = source;
    return { ...recordCore, recordDigest: digestValue(recordCore) };
  });
  const inventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: ledgerSha,
    ledgerDigest,
    evaluationTime: evaluatedAt,
    claims: records,
  };
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  const verification = markOperationDerivedCloudVerification({
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    claimId,
    claimDigest,
    ledgerRevision: ledgerSha,
    ledgerDigest,
    canonicalBaseSha: baseSha,
    laneRevision: fenceSha,
    writeSetDigest,
    reviewRequestId: cloudAuthority.reviewRequestId,
    receiptDigest,
    verifiedAt: evaluatedAt,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    inventory,
  });
  return { cloudAuthority, lease, remoteAuthorityVerification: verification };
}

test("mutation authority admits one joined current writer and waiting successors", () => {
  const waiting = {
    ...fixture().remoteAuthorityVerification.inventory.claims[0],
    claimId: "7".repeat(64),
    state: "waiting-successor",
  };
  const input = fixture([waiting]);
  const receipt = assertAdmissionMutationAuthority(input);
  assert.equal(receipt.status, "ready");
  assert.equal(receipt.localLeaseEpoch, 162);
  assert.equal(receipt.expiresAt, expiresAt);
});

test("mutation authority rejects active overlap and expiry skew", () => {
  const overlap = {
    ...fixture().remoteAuthorityVerification.inventory.claims[0],
    claimId: "8".repeat(64),
  };
  assert.throws(() => assertAdmissionMutationAuthority(fixture([overlap])),
    /competing overlapping cloud authority/);
  const input = fixture();
  const shorterCloud = { ...input.cloudAuthority, expiresAt: "2099-08-04T08:00:00.000Z" };
  assert.throws(() => assertAdmissionMutationAuthority({
    ...input,
    cloudAuthority: shorterCloud,
    lease: {
      ...input.lease,
      cloudAuthority: shorterCloud,
      expiresAt,
    },
  }), /current joined cloud and local lease authority/);
  const mismatchedInventory = fixture();
  const mismatchedCore = {
    ...mismatchedInventory.remoteAuthorityVerification.inventory,
    observedLedgerHeadRevision: "d".repeat(40),
  };
  delete mismatchedCore.inventoryDigest;
  mismatchedInventory.remoteAuthorityVerification.inventory = {
    ...mismatchedCore,
    inventoryDigest: digestValue(mismatchedCore),
  };
  mismatchedInventory.remoteAuthorityVerification.remoteClaimInventoryDigest =
    mismatchedInventory.remoteAuthorityVerification.inventory.inventoryDigest;
  assert.throws(() => assertAdmissionMutationAuthority(mismatchedInventory),
    /intact current cloud inventory/);
});
