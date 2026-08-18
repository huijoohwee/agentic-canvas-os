import assert from "node:assert/strict";
import test from "node:test";
import {
  recoverPlannedAdmissionCloudAuthority,
  shouldReconcileRecoveredPlannedLease,
} from "../scripts/planned-clean-committed-recovery-lib.mjs";

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
const manifest = { writeSetDigest: authority.writeSetDigest };
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
