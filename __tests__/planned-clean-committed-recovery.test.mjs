import assert from "node:assert/strict";
import test from "node:test";
import { recoverPlannedAdmissionCloudAuthority } from "../scripts/planned-clean-committed-recovery-lib.mjs";

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
    project: () => projected,
    verify: input => ({ authority: input.authority, verification: { status: "ready" } }),
  });

  assert.equal(request.mode, "recovery");
  assert.equal(request.expectedTransitionCounter, 7);
  assert.equal(request.recoveryEvidenceDigest, digest("f"));
  assert.equal(result.authority, projected);
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
