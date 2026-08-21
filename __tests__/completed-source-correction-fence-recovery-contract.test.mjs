import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletedSourceCorrectionFenceRecoveryEvidence } from "../scripts/completed-source-correction-fence-recovery-evidence.mjs";
import { authorizeCompletedSourceCorrectionFenceRecovery, buildCompletedSourceCorrectionFenceRecoveryPlan, createCompletedSourceCorrectionFenceRecoveryIntent } from "../scripts/completed-source-correction-fence-recovery-contract.mjs";

const A = "a".repeat(40); const B = "b".repeat(40); const C = "c".repeat(40); const D = "d".repeat(64); const E = "e".repeat(64); const F = "f".repeat(64);
export function fixture() {
  return buildCompletedSourceCorrectionFenceRecoveryEvidence({
    repository: "owner/repo",
    source: { branch: "agent/device/scope", sessionId: "source-session", localHeadSha: C, remoteHeadSha: B, protectedMainSha: A, clean: true, changedPaths: ["path:test.mjs"] },
    lease: { epoch: 9, leaseDigest: D, leaseWithoutTaskAuthorityDigest: E, fenceSha: A, declaredWriteSet: ["path:test.mjs"], writeSetDigest: F, taskAuthorityBindingDigest: D },
    correction: { journalDigest: D, planDigest: E, completionReceiptDigest: F, completionLeaseDigest: E, sourceHeadSha: B, successorClaimId: D, successorClaimDigest: E },
    pullRequest: { number: 778, state: "OPEN", isDraft: true, headSha: B, autoMergeAbsent: true, markerDigest: F },
    claim: { claimId: D, fenceRevision: E, state: "dormant-preserved", recordedState: "integrated-preserved", transitionCounter: 3, laneRevision: B, scopeReserved: true, writeAuthority: false, writeSetDigest: F, reviewRequestId: "github-pull-request:test" },
  });
}

test("plan binds the exact completed correction and authorization", () => {
  const plan = buildCompletedSourceCorrectionFenceRecoveryPlan({ evidence: fixture(), operatorSessionId: "operator-session" });
  assert.match(plan.exactAuthorization, new RegExp(`${plan.planDigest}$`, "u"));
  assert.equal(authorizeCompletedSourceCorrectionFenceRecovery({ plan, authorization: plan.exactAuthorization }).planDigest, plan.planDigest);
  assert.equal(createCompletedSourceCorrectionFenceRecoveryIntent(plan, plan.exactAuthorization).status, "prepared");
});

test("plan rejects same-session operator and exact-token drift", () => {
  assert.throws(() => buildCompletedSourceCorrectionFenceRecoveryPlan({ evidence: fixture(), operatorSessionId: "source-session" }), /distinct operator/u);
  const plan = buildCompletedSourceCorrectionFenceRecoveryPlan({ evidence: fixture(), operatorSessionId: "operator-session" });
  assert.throws(() => authorizeCompletedSourceCorrectionFenceRecovery({ plan, authorization: "authorize wrong" }), /exact authorization/u);
});

test("evidence accepts a tree-equivalent empty local descendant", () => {
  const source = fixture();
  const evidence = buildCompletedSourceCorrectionFenceRecoveryEvidence({
    ...source,
    source: { ...source.source, changedPaths: [] },
  });
  assert.deepEqual(evidence.source.changedPaths, []);
});
