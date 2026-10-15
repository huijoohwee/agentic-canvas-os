import test from "node:test";
import assert from "node:assert/strict";
import { authorizePlan, buildPlan } from "../scripts/planned-admission-owner-release-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const sha = value => value.repeat(40).slice(0, 40), digest = value => value.repeat(64).slice(0, 64);
function fixture() { const staleLease = { schema: "agentic-writer-lease/v2", status: "active" }; return {
  ledgerRepository: "owner/ledger", targetRepository: "owner/target",
  claim: { claimId: digest("a"), state: "dormant-preserved", writeAuthority: false, scopeReserved: true,
    laneRevision: sha("1"), fenceRevision: digest("b"), transitionCounter: 3, reviewRequestId: "github-pull-request:PR_1" },
  ledgerRevision: sha("2"), ledgerDigest: digest("c"),
  pullRequest: { url: "https://example.test/pull/1", number: 1, nodeId: "PR_1", state: "OPEN", isDraft: true,
    mergedAt: null, branch: "agent/device/stale", headSha: sha("1"), baseBranch: "main", baseSha: sha("3") },
  remoteBranchHead: sha("1"), staleLease, staleLeaseDigest: digestValue(staleLease), leaseRegistryDigest: digest("d"),
  sourceProjection: { worktreePath: "/missing", branch: "agent/device/stale", worktreePresent: false, localBranchPresent: false },
  preservedLane: { path: "/preserved", branch: "agent/device/preserved", headSha: sha("4"), treeSha: sha("5"), dirty: true,
    changedPaths: ["design.md"], workingTreeDigest: digest("e"), stateDigest: digest("f"), pullRequest: null } }; }

test("plan seals exact abandoned-owner evidence and authorization", () => { const plan = buildPlan(fixture());
  assert.equal(authorizePlan(plan, plan.exactAuthorization).planDigest, plan.planDigest);
  assert.throws(() => authorizePlan(plan, "authorize planned-admission-owner-release bad"), /Exact/); });
test("planning rejects present source projections and non-dormant claims", () => { const present = fixture(); present.sourceProjection.worktreePresent = true;
  assert.throws(() => buildPlan(present), /absent/); const current = fixture(); current.claim.state = "current";
  assert.throws(() => buildPlan(current), /dormant/); });
