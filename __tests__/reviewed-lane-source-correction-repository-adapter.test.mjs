// Responsibility: Prove hydrated optional claim fields preserve sealed null semantics.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  resetReviewedLanePublishCheckpoint,
  sameSourceClaim,
} from "../scripts/reviewed-lane-source-correction-repository-adapter.mjs";
import {
  buildSameClaimRecoverySplitEvidence,
} from "../scripts/reviewed-lane-source-correction-evidence.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const hex = character => character.repeat(64);

const expected = Object.freeze({
  claimId: "claim",
  state: "integrated-preserved",
  recordedState: "integrated-preserved",
  declaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
  integration: null,
  recovery: null,
});

test("source correction clears every stale publish checkpoint", () => {
  const projected = resetReviewedLanePublishCheckpoint({
    status: "active",
    reviewHeadSha: hex("1"),
    deliveryHeadSha: hex("2"),
    integration: { commitSha: hex("3") },
    fenceSha: hex("4"),
  });

  assert.equal(projected.status, "active");
  assert.equal(projected.reviewHeadSha, null);
  assert.equal(projected.deliveryHeadSha, null);
  assert.equal(projected.integration, null);
  assert.equal(projected.fenceSha, hex("4"));
});

test("hydrated claims treat omitted optional recovery as sealed null", () => {
  const live = { ...expected };
  delete live.recovery;

  assert.equal(sameSourceClaim(live, expected), true);
});

test("hydrated claims still reject material optional recovery drift", () => {
  const live = {
    ...expected,
    recovery: { recoveredAt: "2026-08-13T00:00:00.000Z" },
  };

  assert.equal(sameSourceClaim(live, expected), false);
});

test("durable integrated intent accepts only its ordinary dormant expiry projection", () => {
  const live = { ...expected, state: "dormant-preserved" };

  assert.equal(sameSourceClaim(live, expected), true);
  assert.equal(sameSourceClaim(expected, live), false);
});

test("durable integrated intent rejects material source-state drift", () => {
  const live = { ...expected, state: "reviewed" };

  assert.equal(sameSourceClaim(live, expected), false);
});

function completedRecoveryFixture() {
  const predecessorAuthority = { claimId: hex("1"), claimDigest: hex("2"),
    transitionCounter: 3, operationReceiptDigest: hex("3") };
  const predecessor = { schema: "agentic-writer-lease/v2", branch: "agent/source",
    heartbeatAt: "2026-08-16T11:00:00.000Z", expiresAt: "2026-08-16T11:30:00.000Z",
    cloudAuthority: predecessorAuthority };
  const authority = { ...predecessorAuthority, claimDigest: hex("4"),
    transitionCounter: 4, operationReceiptDigest: hex("5") };
  const targetSubject = { ...predecessor, cloudAuthority: authority,
    heartbeatAt: "2026-08-16T12:00:00.000Z", expiresAt: "2026-08-16T12:30:00.000Z" };
  const cloudRecovery = { recoveryDigest: hex("6") };
  const repairCore = {
    schema: "agentic-same-claim-dormant-reviewed-continuation-local-repair/v1",
    status: "recovered",
    planDigest: hex("7"),
    claimId: authority.claimId,
    sourceLeaseDigest: writerLeaseDigest(predecessor),
    targetLeaseSubjectDigest: writerLeaseDigest(targetSubject),
    taskAuthorityReceiptDigest: hex("8"),
    cloudRecoveryDigest: cloudRecovery.recoveryDigest,
    cloudRecovery,
    cloudEffect: false,
    pullRequestEffect: false,
    sourceEffect: false,
    gitEffect: false,
    mergeEffect: false,
    integrationEffect: false,
    deploymentEffect: false,
  };
  const repair = { ...repairCore, receiptDigest: digestValue(repairCore) };
  const lease = { ...targetSubject, sameClaimDormantReviewedContinuation: repair };
  const projection = { taskAuthorityReceiptDigest: repair.taskAuthorityReceiptDigest,
    cloudRecoveryDigest: repair.cloudRecoveryDigest, localRepair: repair,
    targetLeaseDigest: writerLeaseDigest(lease), registryRevision: 3710 };
  const terminal = { localRepairReceiptDigest: repair.receiptDigest,
    targetLeaseDigest: projection.targetLeaseDigest, registryRevision: projection.registryRevision,
    verifiedAt: "2026-08-16T12:01:00.000Z" };
  const policy = { cloudRecovery: "same-claim-only", localLeaseCas: true,
    pullRequestMutation: false, sourceMutation: false, gitRefMutation: false,
    mergeMutation: false, integrationMutation: false, deployMutation: false,
    authoringAuthorityGranted: false };
  const completionCore = { planDigest: repair.planDigest, claimId: repair.claimId,
    taskAuthorityReceiptDigest: repair.taskAuthorityReceiptDigest,
    cloudRecoveryDigest: repair.cloudRecoveryDigest,
    localRepairReceiptDigest: repair.receiptDigest,
    targetLeaseDigest: projection.targetLeaseDigest, registryRevision: projection.registryRevision,
    verifiedAt: terminal.verifiedAt, policy };
  const completion = { ...completionCore, receiptDigest: digestValue(completionCore) };
  const journalCore = {
    schema: "agentic-same-claim-dormant-reviewed-continuation-journal/v1",
    planDigest: repair.planDigest,
    phase: "complete",
    values: { taskAuthorityReceipt: { receiptDigest: repair.taskAuthorityReceiptDigest },
      cloudRecovery, projection, terminal },
    completion,
  };
  const journal = { ...journalCore, journalDigest: digestValue(journalCore) };
  const marker = { heartbeatAt: predecessor.heartbeatAt, expiresAt: predecessor.expiresAt,
    cloudAuthority: predecessorAuthority };
  return { lease, marker, journal };
}

test("same-claim split requires the exact completed zero-effect journal", () => {
  const fixture = completedRecoveryFixture();
  const proof = buildSameClaimRecoverySplitEvidence(fixture);
  assert.equal(proof.predecessorTransitionCounter, 3);
  assert.equal(proof.recoveredTransitionCounter, 4);
  const tampered = structuredClone(fixture);
  tampered.journal.completion.registryRevision += 1;
  assert.throws(() => buildSameClaimRecoverySplitEvidence(tampered),
    /same-claim recovery proof/);
});

test("same-claim split is skipped after exact source-correction successor binding join", () => {
  const fixture = completedRecoveryFixture();
  const successorAuthority = {
    claimId: hex("9"),
    claimDigest: hex("a"),
    transitionCounter: 6,
    operationReceiptDigest: hex("b"),
  };
  const taskAuthority = { bindingDigest: hex("c") };
  const successorCore = {
    schema: "agentic-source-correction-successor-task-binding-reconciliation-local-repair/v1",
    status: "reconciled",
    planDigest: hex("d"),
    branch: fixture.lease.branch,
    predecessorClaimId: fixture.lease.cloudAuthority.claimId,
    successorClaimId: successorAuthority.claimId,
    sourceBindingDigest: hex("e"),
    targetBindingDigest: taskAuthority.bindingDigest,
    sourceLeaseDigest: writerLeaseDigest(fixture.lease),
    taskAuthorityReceiptDigest: hex("f"),
    reconciledAt: "2026-08-16T15:22:06.835Z",
    cloudEffect: false,
    pullRequestEffect: false,
    sourceEffect: false,
    gitEffect: false,
    mergeEffect: false,
    integrationEffect: false,
    deploymentEffect: false,
    authoringAuthorityGranted: false,
  };
  const successor = { ...successorCore, receiptDigest: digestValue(successorCore) };
  const lease = {
    ...fixture.lease,
    cloudAuthority: successorAuthority,
    taskAuthority,
    sourceCorrectionSuccessorTaskBindingReconciliation: successor,
  };
  const marker = { ...fixture.marker, cloudAuthority: successorAuthority, taskAuthority };

  assert.equal(buildSameClaimRecoverySplitEvidence({ lease, marker, journal: fixture.journal }), null);

  const tampered = structuredClone({ lease, marker, journal: fixture.journal });
  tampered.marker.taskAuthority.bindingDigest = hex("0");
  assert.throws(() => buildSameClaimRecoverySplitEvidence(tampered),
    /same-claim recovery proof/);
});
