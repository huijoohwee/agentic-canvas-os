import assert from "node:assert/strict";
import test from "node:test";
import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { createAdmittedPublishedDescendantDirtyRecoveryController }
  from "../scripts/admitted-published-descendant-dirty-recovery-controller.mjs";
import { classifyRecoveredPublishedDescendantClaim, isAdoptableRecoveredPublishedDescendantClaim,
  projectPublishedDescendantContinuationAuthority }
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
  assert.equal(classifyRecoveredPublishedDescendantClaim({
    claim: { ...claim, laneRevision: "3".repeat(40), transitionCounter: 6 }, lease,
    publishedHeadSha: "3".repeat(40),
  }), "projected");
});

test("published projection uses continuation reconciliation instead of fresh-claim normalization", () => {
  const baseSha = "1".repeat(40), headSha = "2".repeat(40);
  const declaredWriteSet = normalizeWriteSet(["path:docs/example.md", "semantic:example"]);
  const writeSetDigest = digestValue(declaredWriteSet);
  const claimId = "3".repeat(64), operationReceiptDigest = "4".repeat(64);
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "owner/ledger", targetRepository: "owner/target", claimId,
    claimDigest: "5".repeat(64), ledgerRevision: "6".repeat(40),
    ledgerDigest: "7".repeat(64), claimLedgerRevision: "8".repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest,
    canonicalBaseSha: baseSha, laneRevision: baseSha, cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest, deviceId: "device", sessionId: "session", reviewRequestId: "review",
    leaseEpoch: 2, transitionCounter: 4, state: "active", expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const claim = {
    claimId, entrySchema: cloudAuthority.entrySchema,
    claimIdentitySchema: cloudAuthority.claimIdentitySchema, operationReceiptDigest: "9".repeat(64),
    state: "current", actorId: "actor", repositoryId: "repository", workItemId: "work-item",
    canonicalBaseRevision: baseSha, laneRevision: headSha, declaredWriteScope: declaredWriteSet,
    writeSetDigest, leaseEpoch: 2, transitionCounter: 6, reviewRequestId: "review",
    expiresAt: cloudAuthority.expiresAt, fenceRevision: "a".repeat(64),
    transitionDigest: "b".repeat(64), integrationReceiptDigest: null, integration: null,
  };
  const authority = projectPublishedDescendantContinuationAuthority({
    lease: { cloudAuthority }, manifest: { declaredWriteSet, writeSetDigest },
    statusResult: { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "status",
      status: "ready", ledgerRevision: "c".repeat(40), ledgerDigest: "d".repeat(64), claims: [claim] },
    branch: "agent/device/example", headSha, now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(authority.canonicalBaseSha, baseSha);
  assert.equal(authority.laneRevision, headSha);
  assert.equal(authority.transitionCounter, 6);
});
