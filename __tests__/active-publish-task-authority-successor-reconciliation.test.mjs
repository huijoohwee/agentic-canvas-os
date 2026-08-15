import test from "node:test";
import assert from "node:assert/strict";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildReconciliationPlan, normalizeReconciliationPlan } from "../scripts/active-publish-task-authority-successor-reconciliation-contract.mjs";
import { createActivePublishTaskAuthoritySuccessorReconciliationController } from "../scripts/active-publish-task-authority-successor-reconciliation-controller.mjs";

const D = value => digestValue(value);
const SHA = "1".repeat(40);
function evidence() {
  const core = { observedAt: "2026-08-15T07:00:00.000Z", repository: "/repo", branch: "agent/device/lane", sessionId: "session", pullRequest: { number: 500, id: "PR_node", url: "https://github.com/o/r/pull/500", state: "OPEN", isDraft: true, autoMergeRequest: null, headRefName: "agent/device/lane", headRefOid: SHA, baseRefName: "main" }, canonical: { protectedRevision: "2".repeat(40), sourceBaseSha: "3".repeat(40), changedPaths: ["docs/a.md"], changedPathsDigest: D(["docs/a.md"]) }, source: { claimId: D("source"), baseSha: "3".repeat(40), fenceSha: "4".repeat(40), bindingDigest: D("binding"), laneBindingDigest: D("lane"), leaseEpoch: 1 }, target: { claimId: D("target"), baseSha: "5".repeat(40), fenceSha: SHA, operationReceiptDigest: D("operation"), verificationReceiptDigest: D("verify"), leaseEpoch: 2, predecessorClaimId: D("source"), cloudState: "dormant-preserved" }, leaseDigest: D("lease") };
  return { ...core, evidenceDigest: D(core) };
}
function fakeAdapter() {
  let journal = null; let projections = 0;
  const projection = { targetBindingDigest: D("target-binding"), successorReceiptDigest: D("receipt"), targetLeaseDigest: D("target-lease"), registryRevision: 4 };
  return { captureEvidence: evidence, authorizeTask: () => ({ receiptDigest: D("task") }), prepareProjection: () => projection, projectRegistry: () => { projections += 1; return projection; }, verifyTerminal: () => ({ ...projection, verifiedAt: "2026-08-15T07:01:00.000Z" }), readJournal: () => journal, writeJournal: value => { journal = structuredClone(value); }, withOperationLock: action => action(), projections: () => projections };
}

test("plan is stable and rejects evidence drift", () => { const plan = buildReconciliationPlan(evidence()); assert.deepEqual(normalizeReconciliationPlan(plan), plan); assert.throws(() => normalizeReconciliationPlan({ ...plan, planDigest: D("wrong") }), /invalid plan digest/); });
test("exact authorization performs one registry projection and complete replay performs none", () => { const adapter = fakeAdapter(); const controller = createActivePublishTaskAuthoritySuccessorReconciliationController(adapter); const plan = controller.plan(); const authorization = `authorize active-publish-task-authority-successor-reconciliation ${plan.planDigest}`; const first = controller.run({ plan, authorization }); const replay = controller.run({ plan, authorization }); assert.equal(first.receiptDigest, replay.receiptDigest); assert.equal(adapter.projections(), 1); assert.equal(first.cloudMutation, false); assert.equal(first.authoringAuthorityGranted, false); });
test("wrong human authorization has zero effect", () => { const adapter = fakeAdapter(); const controller = createActivePublishTaskAuthoritySuccessorReconciliationController(adapter); assert.throws(() => controller.run({ plan: controller.plan(), authorization: "no" }), /Exact authorization required/); assert.equal(adapter.projections(), 0); });
test("durable registry-attempted replay adopts one exact projection", () => { const adapter = fakeAdapter(); const controller = createActivePublishTaskAuthoritySuccessorReconciliationController(adapter); const plan = controller.plan(); adapter.writeJournal({ schema: "agentic-active-publish-task-authority-successor-reconciliation-journal/v1", planDigest: plan.planDigest, phase: "registry-attempted", values: { taskAuthorityReceipt: { receiptDigest: D("task") }, projection: { targetBindingDigest: D("target-binding"), successorReceiptDigest: D("receipt"), targetLeaseDigest: D("target-lease"), registryRevision: 4 } } }); controller.run({ plan, authorization: `authorize active-publish-task-authority-successor-reconciliation ${plan.planDigest}` }); assert.equal(adapter.projections(), 1); });
