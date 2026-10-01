import test from "node:test";
import assert from "node:assert/strict";
import { runPlannedAdmissionOwnerRelease } from "../scripts/planned-admission-owner-release-controller.mjs";
import { buildPlan } from "../scripts/planned-admission-owner-release-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const sha = value => value.repeat(40).slice(0, 40), digest = value => value.repeat(64).slice(0, 64);
function plan() { const staleLease = { status: "active" }; return buildPlan({ ledgerRepository: "o/l", targetRepository: "o/t",
  claim: { claimId: digest("a"), state: "dormant-preserved", writeAuthority: false, scopeReserved: true, laneRevision: sha("1"),
    fenceRevision: digest("b"), transitionCounter: 1, reviewRequestId: "github-pull-request:PR" }, ledgerRevision: sha("2"), ledgerDigest: digest("c"),
  pullRequest: { url: "https://e/p/1", number: 1, nodeId: "PR", state: "OPEN", isDraft: true, mergedAt: null,
    branch: "agent/d/s", headSha: sha("1"), baseBranch: "main", baseSha: sha("3") }, remoteBranchHead: sha("1"),
  staleLease, staleLeaseDigest: digestValue(staleLease), leaseRegistryDigest: digest("d"),
  sourceProjection: { worktreePath: "/missing", branch: "agent/d/s", worktreePresent: false, localBranchPresent: false },
  preservedLane: { path: "/p", branch: "agent/d/p", headSha: sha("4"), treeSha: sha("5"), dirty: true,
    changedPaths: ["x"], workingTreeDigest: digest("e"), stateDigest: digest("f"), pullRequest: null } }); }
test("controller preserves strict cloud-provider-local-final order", async () => { const value = plan(), calls = [], releasedLease = { status: "released" };
  const adapter = { async verifyPlan() { calls.push("verify"); }, async retireClaim() { calls.push("cloud"); return { receiptDigest: digest("6") }; },
    async closePullRequest() { calls.push("provider"); return { disposition: "closed-unmerged", closedAt: "2026-08-16T00:00:00.000Z", remoteBranchPreserved: true }; },
    async releaseLocalOwner() { calls.push("local"); return { releasedLease, completedAt: "2026-08-16T00:00:00.000Z" }; },
    async verifyFinal() { calls.push("final"); } };
  const receipt = await runPlannedAdmissionOwnerRelease({ adapter, plan: value, authorization: value.exactAuthorization });
  assert.deepEqual(calls, ["verify", "cloud", "provider", "local", "final"]); assert.equal(receipt.status, "completed"); });
