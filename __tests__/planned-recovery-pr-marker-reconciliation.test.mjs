import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, authorizePlan, buildReceipt,
  LOCAL_RELEASE_RECEIPT_SCHEMA, normalizeLocalReleaseReceipt } from "../scripts/planned-recovery-pr-marker-reconciliation-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { runReconciliation } from "../scripts/planned-recovery-pr-marker-reconciliation-controller.mjs";

const D = "a".repeat(64), S = "b".repeat(40);
function plan() { return buildPlan({ repository: "/repo", sourceWorktree: "/lane", branch: "agent/device/scope",
  headSha: S, treeSha: S, remoteHeadSha: S, sourceLeaseDigest: D, sourceMarkerDigest: D,
  sourceBodyDigest: D, pullRequestUrl: "https://example.test/pull/1", pullRequestNumber: 1,
  pullRequestNodeId: "PR_1", ledgerRepository: "ledger/repo", targetRepository: "target/repo",
  claimId: D, claimDigest: D, claimTransitionCounter: 3,
  sessionId: "session", operatorDecisionDigest: D }); }

test("plan requires literal digest-bound authorization", () => {
  const value = plan();
  assert.throws(() => authorizePlan(value, "authorize"), /Exact reconciliation/u);
  assert.equal(authorizePlan(value, value.exactAuthorization).planDigest, value.planDigest);
});

test("receipt preserves every recovery surface and forbids deployment", () => {
  const value = plan();
  const receipt = buildReceipt({ plan: value, provider: { disposition: "closed-unmerged",
    closedAt: "2026-08-12T00:00:00.000Z" }, releasedLeaseDigest: D,
    targetMarkerDigest: D, completedAt: "2026-08-12T00:00:00.000Z" });
  assert.equal(receipt.deployment, false);
  assert.deepEqual(receipt.preservation, { worktree: true, branch: true, remoteBranch: true, authoredBytes: true });
});

test("local release receipt is exact and digest-bound", () => {
  const core = {
    schema: LOCAL_RELEASE_RECEIPT_SCHEMA,
    planDigest: D,
    claimId: D,
    pullRequestUrl: "https://example.test/pull/1",
    completedAt: "2026-08-12T00:00:00.000Z",
  };
  assert.deepEqual(normalizeLocalReleaseReceipt({ ...core, receiptDigest: digestValue(core) }), {
    ...core, receiptDigest: digestValue(core),
  });
  assert.throws(() => normalizeLocalReleaseReceipt({ ...core, receiptDigest: D }), /digest is invalid/u);
});

test("controller orders provider close before local CAS and projection", async () => {
  const value = plan(), calls = [];
  const adapter = {
    async verifyPlan() { calls.push("verify-plan"); },
    async closePullRequest() { calls.push("close"); return { disposition: "closed-unmerged", closedAt: "2026-08-12T00:00:00.000Z" }; },
    async releaseLocalOwner() { calls.push("release"); return { releasedLeaseDigest: D }; },
    async projectPullRequest() { calls.push("project"); return { targetMarkerDigest: D, completedAt: "2026-08-12T00:00:00.000Z" }; },
    async verifyFinal() { calls.push("verify"); },
  };
  const result = await runReconciliation({ adapter, plan: value, authorization: value.exactAuthorization });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["verify-plan", "close", "release", "project", "verify"]);
});
