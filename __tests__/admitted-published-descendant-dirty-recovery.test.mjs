import assert from "node:assert/strict";
import test from "node:test";
import { createAdmittedPublishedDescendantDirtyRecoveryController }
  from "../scripts/admitted-published-descendant-dirty-recovery-controller.mjs";
import { isAdoptableRecoveredPublishedDescendantClaim }
  from "../scripts/admitted-published-descendant-dirty-recovery-repository-adapter.mjs";

const evidence = Object.freeze({
  schema: "agentic-admitted-published-descendant-dirty-recovery-evidence/v1",
  cloud: { claimId: "a".repeat(64) }, lease: { fenceSha: "1".repeat(40) },
  lane: { headSha: "2".repeat(40) }, dirt: { evidenceDigest: "b".repeat(64) },
});

test("plan is read-twice and run requires exact authorization", async () => {
  let captures = 0;
  const result = {
    cloudRecoveryReceiptDigest: "c".repeat(64), cloudProjectionReceiptDigest: "d".repeat(64),
    storedLeaseDigest: "e".repeat(64), taskAuthorityReceiptDigest: "f".repeat(64),
    markerDigest: "0".repeat(64),
  };
  const controller = createAdmittedPublishedDescendantDirtyRecoveryController({ adapter: {
    capture: async () => { captures += 1; return evidence; },
    authorize: async () => ({ receiptDigest: result.taskAuthorityReceiptDigest }),
    recover: async () => result,
  } });
  const plan = await controller.plan({ ttlSeconds: 1_800 });
  assert.equal(captures, 2);
  await assert.rejects(controller.run({ plan, authorization: "wrong" }), /not exact/u);
  const completion = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(completion.status, "recovered-admitted-published-descendant-dirty");
  assert.equal(completion.publishedHeadSha, evidence.lane.headSha);
  assert.equal(captures, 3);
});

test("planning rejects drift between reads", async () => {
  let count = 0;
  const controller = createAdmittedPublishedDescendantDirtyRecoveryController({ adapter: {
    capture: async () => ({ ...evidence, observedAt: String(count += 1) }),
    authorize: async () => ({}), recover: async () => ({}),
  } });
  await assert.rejects(controller.plan({ ttlSeconds: 1_800 }), /drifted between reads/u);
});

test("only the exact counter-plus-one recovered intermediate claim is adoptable", () => {
  const lease = { baseSha: "1".repeat(40), admission: { writeSetDigest: "a".repeat(64) },
    cloudAuthority: { reviewRequestId: "review", transitionCounter: 4 } };
  const claim = { state: "current", writeAuthority: true, scopeReserved: true,
    canonicalBaseRevision: lease.baseSha, laneRevision: "2".repeat(40),
    writeSetDigest: lease.admission.writeSetDigest, reviewRequestId: "review",
    transitionCounter: 5, recovery: { evidenceDigest: "b".repeat(64) } };
  lease.fenceSha = claim.laneRevision;
  assert.equal(isAdoptableRecoveredPublishedDescendantClaim({ claim, lease }), true);
  assert.equal(isAdoptableRecoveredPublishedDescendantClaim({
    claim: { ...claim, transitionCounter: 6 }, lease,
  }), false);
});
