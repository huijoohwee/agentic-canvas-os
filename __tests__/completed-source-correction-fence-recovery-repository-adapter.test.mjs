import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  cloudAuthorityProjectsClaim,
  isExactPersistedRecoveryClaim,
  recoveredCloudAuthorityAlreadyProjected,
} from "../scripts/completed-source-correction-fence-recovery-repository-adapter.mjs";

test("repository adapter limits its protected effects", () => {
  const source = readFileSync(new URL("../scripts/completed-source-correction-fence-recovery-repository-adapter.mjs", import.meta.url), "utf8");
  assert.match(source, /authorizeTaskBoundLeaseMutation/u);
  assert.match(source, /currentSuccessorRepair/u);
  assert.match(source, /successorTaskBindingSourceLeaseDigest/u);
  assert.match(source, /recoverPlannedAdmissionCloudAuthority/u);
  assert.match(source, /casWriterLeaseProjection/u);
  assert.match(source, /updateWriterLeasePullRequestBody/u);
  assert.doesNotMatch(source, /git", \["push/u);
  assert.doesNotMatch(source, /git", \["commit/u);
  assert.doesNotMatch(source, /wrangler|pages deploy/u);
});

test("same-claim recovery requires the complete cloud authority projection", () => {
  const current = {
    claimId: "a".repeat(64),
    claimDigest: "b".repeat(64),
    transitionCounter: 3,
    operationReceiptDigest: "c".repeat(64),
  };
  assert.equal(recoveredCloudAuthorityAlreadyProjected(current, current), true);
  assert.equal(recoveredCloudAuthorityAlreadyProjected(current, {
    ...current,
    transitionCounter: 4,
    operationReceiptDigest: "d".repeat(64),
  }), false);
});

test("persisted recovery replay accepts only its exact next transition and evidence", () => {
  const sourceClaim = {
    claimId: "a".repeat(64),
    state: "dormant-preserved",
    transitionCounter: 3,
    laneRevision: "c".repeat(40),
    writeSetDigest: "d".repeat(64),
    reviewRequestId: "github-pull-request:example",
  };
  const canonicalBaseRevision = "b".repeat(40);
  const leaseEpoch = 4;
  const recoveryEvidenceDigest = "e".repeat(64);
  const liveClaim = {
    ...sourceClaim,
    state: "current",
    transitionCounter: 4,
    canonicalBaseRevision,
    leaseEpoch,
    fenceRevision: "f".repeat(64),
    transitionDigest: "1".repeat(64),
    operationReceiptDigest: "2".repeat(64),
    recovery: { evidenceDigest: recoveryEvidenceDigest },
  };

  assert.equal(isExactPersistedRecoveryClaim({
    sourceClaim,
    liveClaim,
    canonicalBaseRevision,
    leaseEpoch,
    recoveryEvidenceDigest,
  }), true);
  assert.equal(isExactPersistedRecoveryClaim({
    sourceClaim,
    liveClaim: { ...liveClaim, transitionCounter: 5 },
    canonicalBaseRevision,
    leaseEpoch,
    recoveryEvidenceDigest,
  }), false);
  assert.equal(isExactPersistedRecoveryClaim({
    sourceClaim,
    liveClaim: { ...liveClaim, recovery: { evidenceDigest: "3".repeat(64) } },
    canonicalBaseRevision,
    leaseEpoch,
    recoveryEvidenceDigest,
  }), false);
  assert.equal(isExactPersistedRecoveryClaim({
    sourceClaim,
    liveClaim: { ...liveClaim, canonicalBaseRevision: "4".repeat(40) },
    canonicalBaseRevision,
    leaseEpoch,
    recoveryEvidenceDigest,
  }), false);
  assert.equal(isExactPersistedRecoveryClaim({
    sourceClaim,
    liveClaim: { ...liveClaim, leaseEpoch: leaseEpoch + 1 },
    canonicalBaseRevision,
    leaseEpoch,
    recoveryEvidenceDigest,
  }), false);
  assert.equal(cloudAuthorityProjectsClaim({
    claimId: liveClaim.claimId,
    claimDigest: liveClaim.fenceRevision,
    claimLedgerRevision: liveClaim.transitionDigest,
    operationReceiptDigest: liveClaim.operationReceiptDigest,
    transitionCounter: liveClaim.transitionCounter,
    laneRevision: liveClaim.laneRevision,
    reviewRequestId: liveClaim.reviewRequestId,
  }, liveClaim), true);
});
