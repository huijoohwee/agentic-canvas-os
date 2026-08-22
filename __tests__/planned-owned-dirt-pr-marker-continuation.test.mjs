import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildPlannedOwnedDirtScopeExpansionRecoveryEvidence }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery-evidence.mjs";
import { advanceRecoveryIntent, buildPlannedOwnedDirtScopeExpansionRecoveryPlan,
  createRecoveryIntent }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery-contract.mjs";
import { buildPlan, OPERATION }
  from "../scripts/planned-owned-dirt-pr-marker-continuation-contract.mjs";
import { createController }
  from "../scripts/planned-owned-dirt-pr-marker-continuation-controller.mjs";
import { parseArguments }
  from "../scripts/planned-owned-dirt-pr-marker-continuation.mjs";

test("continuation requires an exact authorization and advances only marker plus terminal", async () => {
  const state = { intent: localProjectedIntent(), calls: [] };
  const plan = continuationPlan(state.intent);
  const adapter = fakeAdapter(state, plan);
  const controller = createController(adapter);
  await assert.rejects(() => controller.run({ plan, authorization: "authorize" }),
    /Continuation requires/u);
  const receipt = await controller.run({ plan,
    authorization: `authorize ${OPERATION} ${plan.planDigest}` });
  assert.equal(receipt.status, "mutation-authority-restored");
  assert.equal(receipt.gitMutation, false);
  assert.deepEqual(state.calls, ["task", "marker", "terminal"]);
  assert.equal(state.intent.status, "complete");
});

test("completed continuation replays terminal verification without another marker mutation", async () => {
  const state = { intent: localProjectedIntent(), calls: [] };
  const plan = continuationPlan(state.intent);
  const controller = createController(fakeAdapter(state, plan));
  const first = await controller.run({ plan,
    authorization: `authorize ${OPERATION} ${plan.planDigest}` });
  const replay = await controller.run({ plan,
    authorization: `authorize ${OPERATION} ${plan.planDigest}` });
  assert.equal(replay.receiptDigest, first.receiptDigest);
  assert.equal(state.calls.filter(value => value === "marker").length, 1);
  assert.equal(state.calls.filter(value => value === "terminal").length, 2);
});

test("CLI parser separates external plan output from exact-authorized run", () => {
  const common = ["--repository=/repo", "--source-session=session",
    `--original-plan-digest=${"a".repeat(64)}`, "--pull-request=629",
    "--task-authority=/tmp/task.json"];
  assert.equal(parseArguments(["plan", ...common, "--output=/tmp/plan.json"]).mode, "plan");
  const run = parseArguments(["run", ...common, "--plan-file=/tmp/plan.json",
    "--authorize=authorize exact"]);
  assert.equal(run.pullRequestNumber, 629);
  assert.equal(run.authorization, "authorize exact");
  assert.throws(() => parseArguments(["run", ...common]), /plan-file/u);
});

function fakeAdapter(state, plan) {
  return {
    capture: async () => plan,
    withLock: async (_plan, action) => action(),
    readIntent: async () => state.intent,
    authorizeTask: async () => { state.calls.push("task"); return { receiptDigest: "1".repeat(64) }; },
    projectMarker: async () => { state.calls.push("marker"); return {
      markerDigest: "2".repeat(64), receiptDigest: "3".repeat(64) }; },
    verifyTerminal: async () => { state.calls.push("terminal"); return {
      mutationAuthorityReceiptDigest: "4".repeat(64), terminalEvidenceDigest: "5".repeat(64) }; },
    writeIntent: async ({ expected, next }) => {
      assert.equal(expected.intentDigest, state.intent.intentDigest);
      state.intent = next;
    },
  };
}

function continuationPlan(intent) {
  return buildPlan({ originalPlanDigest: intent.planDigest,
    originalIntentDigest: intent.intentDigest, repositoryPathDigest: "6".repeat(64),
    branch: intent.planSnapshot.evidence.branch,
    sourceSessionId: intent.planSnapshot.evidence.sessionId,
    pullRequestUrl: "https://github.com/owner/repository/pull/629", pullRequestNumber: 629,
    headSha: "a".repeat(40), remoteHeadSha: "a".repeat(40),
    dirtDigest: intent.planSnapshot.evidence.dirtDigest,
    successorClaimId: "7".repeat(64), successorClaimDigest: "8".repeat(64),
    targetLeaseDigest: "9".repeat(64), targetTaskAuthorityBindingDigest: "a".repeat(64),
    sourceMarkerDigest: "b".repeat(64), sourceBodyDigest: "c".repeat(64),
    targetMarkerDigest: "d".repeat(64), cloudVerificationReceiptDigest: "e".repeat(64),
    mutationAuthorityReceiptDigest: "f".repeat(64), observedAt: "2026-08-22T00:00:00.000Z" });
}

function localProjectedIntent() {
  const plan = originalPlan();
  let intent = createRecoveryIntent({ plan,
    authorization: { authorizationDigest: "0".repeat(64) },
    taskAuthority: { receiptDigest: "1".repeat(64), proofDigest: "2".repeat(64) } });
  for (const [status, values] of [
    ["waiting-successor", { claimId: "3".repeat(64) }],
    ["source-retired", { receiptDigest: "4".repeat(64) }],
    ["successor-promoted", { claimId: "3".repeat(64), claimDigest: "5".repeat(64) }],
    ["successor-bound", { authority: { claimId: "3".repeat(64) } }],
    ["local-projected", { leaseDigest: "6".repeat(64) }],
  ]) intent = advanceRecoveryIntent(intent, { status, values });
  return intent;
}

function originalPlan() {
  const sourceWriteSet = ["path:src/owned", "semantic:scope"];
  const targetWriteSet = ["path:src/new", "path:src/owned", "semantic:scope"];
  const entry = { path: "src/owned/file.mjs", staged: false, unstaged: true,
    untracked: false, headMode: "100644", headBlob: "1".repeat(40),
    indexMode: "100644", indexBlob: "1".repeat(40), worktreeType: "file",
    worktreeMode: "100644", worktreeBlob: "2".repeat(40) };
  const dirtCore = { schema: "agentic-active-owned-dirt-evidence/v1", headSha: "a".repeat(40),
    entries: [entry], pathCount: 1, stagedPathCount: 0, unstagedPathCount: 1,
    untrackedPathCount: 0 };
  const ownedDirt = { ...dirtCore, evidenceDigest: digestValue(dirtCore) };
  const evidence = buildPlannedOwnedDirtScopeExpansionRecoveryEvidence({
    repositoryPathDigest: "3".repeat(64), targetRepository: "owner/repository",
    ledgerRepository: "owner/repository", branch: "agent/device/scope", sessionId: "session",
    device: "device", scope: "scope", baseSha: "a".repeat(40), fenceSha: "a".repeat(40),
    leaseDigest: "4".repeat(64), claimId: "5".repeat(64), claimDigest: "6".repeat(64),
    claimTransitionCounter: 2, claimState: "current", reviewRequestId: "review",
    pullRequestUrl: "https://github.com/owner/repository/pull/629",
    declaredWriteSet: sourceWriteSet, writeSetDigest: digestValue(sourceWriteSet),
    manifestDigest: "7".repeat(64), existingLaneStateDigest: "8".repeat(64), ownedDirt,
    taskAuthorityBindingDigest: "9".repeat(64), cloudLedgerRevision: "b".repeat(40),
    cloudLedgerDigest: "a".repeat(64), controllerDigest: "b".repeat(64),
    observedAt: "2026-08-22T00:00:00.000Z" });
  return buildPlannedOwnedDirtScopeExpansionRecoveryPlan({ evidence,
    targetManifest: { schema: "agentic-declared-write-scope/v1", semanticScope: "scope",
      declaredWriteSet: targetWriteSet, writeSetDigest: digestValue(targetWriteSet),
      manifestDigest: digestValue({ targetWriteSet }) } });
}
