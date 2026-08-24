import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeProjectedManifestCanonicalization,
  isProjectedPredecessorPullRequestMarker,
  ownerIdentifierMatches,
  recoverPlannedAdmissionCloudAuthority,
  recoverReceiptCanonicalizedPlannedLease,
  shouldReconcileRecoveredPlannedLease,
} from "../scripts/planned-clean-committed-recovery-lib.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeOwnerIdentifier } from "../scripts/planned-device-projection-recovery-evidence.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);
const authority = {
  schema: "agentic-lane-cloud-authority/v1",
  ledgerRepository: "owner/ledger",
  targetRepository: "owner/target",
  claimId: digest("a"),
  canonicalBaseSha: sha("b"),
  laneRevision: sha("c"),
  writeSetDigest: digest("d"),
  leaseEpoch: 3,
  reviewRequestId: "github-pull-request:PR_1",
  deviceId: "device",
  sessionId: "session",
};
const manifest = { manifestDigest: digest("0"), writeSetDigest: authority.writeSetDigest };
const dormant = {
  claimId: authority.claimId,
  state: "parked",
  canonicalBaseRevision: authority.canonicalBaseSha,
  laneRevision: authority.laneRevision,
  writeSetDigest: authority.writeSetDigest,
  leaseEpoch: authority.leaseEpoch,
  reviewRequestId: authority.reviewRequestId,
  transitionCounter: 7,
  fenceRevision: digest("e"),
};

test("planned recovery compares provider and local owner identities canonically", () => {
  assert.equal(ownerIdentifierMatches(
    "device",
    normalizeOwnerIdentifier("device", "huis-macbook-pro-3.local"),
    "huis-macbook-pro-3.local",
  ), true);
  assert.equal(ownerIdentifierMatches(
    "session",
    normalizeOwnerIdentifier("session", "codex-owned-session"),
    "codex-owned-session",
  ), true);
  assert.equal(ownerIdentifierMatches(
    "device",
    normalizeOwnerIdentifier("device", "another-device"),
    "huis-macbook-pro-3.local",
  ), false);
});

test("planned clean recovery advances only the exact dormant claim", () => {
  let request = null;
  const projected = { ...authority, state: "active", transitionCounter: 8 };
  const result = recoverPlannedAdmissionCloudAuthority({
    authority, manifest, branch: "agent/device/scope",
    recoveryEvidenceDigest: digest("f"), ttlSeconds: 900,
    inspect: () => ({ claims: [dormant] }),
    invoke: input => {
      request = input.request;
      return { ok: true, action: "continue", claim: {
        ...dormant, state: "current", transitionCounter: 8,
      } };
    },
    verify: input => ({ authority: { ...input.authority, marker: projected }, verification: { status: "ready" } }),
  });

  assert.equal(request.mode, "recovery");
  assert.equal(request.expectedTransitionCounter, 7);
  assert.equal(request.recoveryEvidenceDigest, digest("f"));
  assert.equal(result.authority.marker, projected);
  assert.equal(result.authority.manifestDigest, manifest.manifestDigest);
});

test("planned clean recovery canonicalizes a missing manifest only from its exact fence-projection receipt", () => {
  const branch = "agent/device/planned-scope";
  const taskAuthorityCore = {
    schema: "agentic-task-authority-binding/v1",
    authoritySubjectId: `urn:agentic-task:${digest("5")}`,
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
    generation: 1,
    publicKey: "MCowBQYDK2VwAyEACUyj2+Djg0vdM+PGbZv96+mo10QyALragq2D5Vw86rY=",
    publicKeyDigest: null,
    laneBindingDigest: digest("6"),
    bindingMode: "claim",
    boundAt: "2026-08-24T01:00:00.000Z",
    transitionPlanDigest: null,
    priorBindingDigest: null,
  };
  taskAuthorityCore.publicKeyDigest = digestValue(taskAuthorityCore.publicKey);
  const taskAuthority = {
    ...taskAuthorityCore,
    bindingDigest: digestValue(taskAuthorityCore),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session",
    device: "device",
    scope: "planned-scope",
    branch,
    baseSha: sha("b"),
    fenceSha: sha("c"),
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-24T01:00:00.000Z",
    expiresAt: "2026-08-24T01:30:00.000Z",
    taskAuthority,
    admission: { status: "planned", manifestDigest: digest("9") },
    cloudAuthority: { claimId: digest("a"), transitionCounter: 3 },
  };
  const predecessorLease = {
    ...lease,
    cloudAuthority: { ...lease.cloudAuthority, transitionCounter: 1 },
  };
  const predecessorMarker = {
    ...projectWriterLeasePullRequestMarker(predecessorLease),
    heartbeatAt: "2026-08-24T00:55:00.000Z",
    expiresAt: "2026-08-24T01:25:00.000Z",
  };
  const attempted = {
    idempotencyKey: digest("1"),
    sourceLeaseDigest: writerLeaseDigest(predecessorLease),
    targetLeaseDigest: writerLeaseDigest(lease),
  };
  const core = {
    schema: "agentic-planned-start-fence-projection-recovery-registry-receipt/v1",
    operationKey: `planned-start-fence-projection-recovery:local-attempted:${attempted.idempotencyKey}`,
    planDigest: digest("3"),
    sourceLeaseDigest: attempted.sourceLeaseDigest,
    targetLeaseDigest: attempted.targetLeaseDigest,
    claimId: lease.cloudAuthority.claimId,
    sourceTransitionCounter: 1,
    targetTransitionCounter: 3,
    registryRevision: 9,
    phaseValues: {
      authorityVerified: {
        taskAuthorityReceiptDigest: digest("4"),
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      },
      localAttempted: attempted,
    },
    writerRegistryMutation: true,
    cloudMutation: false,
    providerMutation: false,
    gitMutation: false,
    sourceMutation: false,
  };
  const receipt = { ...core, receiptDigest: digestValue(core) };
  const registry = {
    revision: 9,
    plannedStartFenceProjectionRecoveryReceipts: { [receipt.operationKey]: receipt },
  };

  assert.equal(authorizeProjectedManifestCanonicalization({ registry, lease }), receipt);
  assert.equal(isProjectedPredecessorPullRequestMarker({
    marker: predecessorMarker,
    lease,
    projectionReceipt: receipt,
  }), true);
  assert.equal(isProjectedPredecessorPullRequestMarker({
    marker: { ...predecessorMarker, fenceSha: sha("f") },
    lease,
    projectionReceipt: receipt,
  }), false);
  const projectedLease = {
    ...lease,
    cloudAuthority: {
      ...lease.cloudAuthority,
      manifestDigest: lease.admission.manifestDigest,
      expiresAt: "2026-08-24T03:00:00.000Z",
    },
    heartbeatAt: "2026-08-24T02:00:00.000Z",
    expiresAt: "2026-08-24T02:30:00.000Z",
    expiredCommittedHeartbeatRecovery: { status: "recovered" },
  };
  let canonicalSourceLease = null;
  const recoveredLease = recoverReceiptCanonicalizedPlannedLease({
    leaseStore: { statePath: "/unused/writer-leases.json" },
    branch,
    expectedLease: lease,
    renewedCloudAuthority: projectedLease.cloudAuthority,
    recoveryEvidence: { sourceEpoch: lease.epoch },
    ttlMs: 1_800_000,
    recoveredAt: projectedLease.heartbeatAt,
    projectionReceipt: receipt,
    instant: new Date("2026-08-24T02:00:01.000Z"),
  }, {
    projectLease: ({ sourceLease }) => {
      canonicalSourceLease = sourceLease;
      return projectedLease;
    },
    mutateRegistry: ({ expectedLeaseDigest, expectedClaimId, action }) => {
      assert.equal(expectedLeaseDigest, writerLeaseDigest(lease));
      assert.equal(expectedClaimId, lease.cloudAuthority.claimId);
      const mutation = action({ registry: { ...registry, leases: { [branch]: lease } }, lease });
      assert.equal(mutation.registry.plannedStartFenceProjectionRecoveryReceipts,
        registry.plannedStartFenceProjectionRecoveryReceipts);
      return { lease: mutation.lease };
    },
  });
  assert.equal(canonicalSourceLease.cloudAuthority.manifestDigest,
    lease.admission.manifestDigest);
  assert.equal(recoveredLease, projectedLease);
  assert.throws(() => authorizeProjectedManifestCanonicalization({ registry: { revision: 9 }, lease }),
    /exact expired planned cloud-admitted lease/u);
  assert.throws(() => authorizeProjectedManifestCanonicalization({
    registry,
    lease: { ...lease, cloudAuthority: { ...lease.cloudAuthority, manifestDigest: digest("7") } },
  }), /exact expired planned cloud-admitted lease/u);
  assert.throws(() => authorizeProjectedManifestCanonicalization({
    registry: { ...registry, plannedStartFenceProjectionRecoveryReceipts: {
      [receipt.operationKey]: { ...receipt, targetTransitionCounter: 2 },
    } },
    lease,
  }), /exact expired planned cloud-admitted lease/u);
});

test("planned clean recovery accepts the provider-neutral dormant state", () => {
  const liveDormant = { ...dormant, state: "dormant-preserved" };
  const projected = { ...authority, state: "active", transitionCounter: 8 };
  const result = recoverPlannedAdmissionCloudAuthority({
    authority, manifest, branch: "agent/device/scope",
    recoveryEvidenceDigest: digest("f"),
    inspect: () => ({ claims: [liveDormant] }),
    invoke: () => ({ ok: true, action: "continue", claim: {
      ...liveDormant, state: "current", transitionCounter: 8,
    } }),
    verify: input => ({ authority: { ...input.authority, marker: projected }, verification: { status: "ready" } }),
  });
  assert.equal(result.authority.marker, projected);
});

test("planned clean recovery reconciles a lost recovery response without a second mutation", () => {
  const current = { ...dormant, state: "current", transitionCounter: 8,
    fenceRevision: digest("1"), transitionDigest: digest("2"),
    operationReceiptDigest: digest("3"), entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", expiresAt: "2026-08-12T03:00:00.000Z" };
  let invoked = false;
  const result = recoverPlannedAdmissionCloudAuthority({
    authority: { ...authority, transitionCounter: 7 }, manifest,
    branch: "agent/device/scope", recoveryEvidenceDigest: digest("f"),
    inspect: () => ({ ok: true, action: "status", ledgerRevision: sha("4"),
      ledgerDigest: digest("5"), claims: [current] }),
    invoke: () => { invoked = true; },
    verify: input => ({ authority: input.authority, verification: { status: "ready" } }),
  });
  assert.equal(invoked, false);
  assert.equal(result.authority.claimDigest, digest("1"));
  assert.equal(result.authority.transitionCounter, 8);
});

test("planned clean recovery reconciles repeated lost recovery responses without another mutation", () => {
  const current = { ...dormant, state: "current", transitionCounter: 10,
    fenceRevision: digest("6"), transitionDigest: digest("7"),
    operationReceiptDigest: digest("8"), entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", expiresAt: "2026-08-12T04:00:00.000Z" };
  let invoked = false;
  const result = recoverPlannedAdmissionCloudAuthority({
    authority: { ...authority, transitionCounter: 7 }, manifest,
    branch: "agent/device/scope", recoveryEvidenceDigest: digest("f"),
    inspect: () => ({ ok: true, action: "status", ledgerRevision: sha("8"),
      ledgerDigest: digest("9"), claims: [current] }),
    invoke: () => { invoked = true; },
    verify: input => ({ authority: input.authority, verification: { status: "ready" } }),
  });
  assert.equal(invoked, false);
  assert.equal(result.authority.claimDigest, digest("6"));
  assert.equal(result.authority.transitionCounter, 10);
});

test("planned clean recovery rejects non-dormant or drifted subjects before mutation", () => {
  for (const claim of [
    { ...dormant, state: "active" },
    { ...dormant, laneRevision: sha("9") },
    { ...dormant, reviewRequestId: "github-pull-request:PR_2" },
  ]) {
    let invoked = false;
    assert.throws(() => recoverPlannedAdmissionCloudAuthority({
      authority, manifest, branch: "agent/device/scope",
      recoveryEvidenceDigest: digest("f"),
      inspect: () => ({ claims: [claim] }),
      invoke: () => { invoked = true; },
    }), /exact dormant cloud claim/u);
    assert.equal(invoked, false);
  }
});

test("planned clean recovery only replays while the recovered lease is still live", () => {
  const instant = new Date("2026-08-17T14:20:00.000Z");
  assert.equal(shouldReconcileRecoveredPlannedLease({
    expiresAt: "2026-08-17T14:30:00.000Z",
    expiredCommittedHeartbeatRecovery: { schema: "agentic-expired-committed-heartbeat-recovery/v3" },
  }, instant), true);
  assert.equal(shouldReconcileRecoveredPlannedLease({
    expiresAt: "2026-08-17T14:13:09.000Z",
    expiredCommittedHeartbeatRecovery: { schema: "agentic-expired-committed-heartbeat-recovery/v3" },
  }, instant), false);
  assert.equal(shouldReconcileRecoveredPlannedLease({
    expiresAt: "2026-08-17T14:30:00.000Z",
  }, instant), false);
});
