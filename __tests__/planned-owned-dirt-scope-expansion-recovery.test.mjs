import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildPlannedOwnedDirtScopeExpansionRecoveryPlan,
  OPERATION,
} from "../scripts/planned-owned-dirt-scope-expansion-recovery-contract.mjs";
import { createPlannedOwnedDirtScopeExpansionRecoveryController }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery-controller.mjs";
import { capturePlannedOwnedDirtProtectedMainAdvance }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery-repository-adapter.mjs";
import { buildPlannedOwnedDirtScopeExpansionRecoveryEvidence }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery-evidence.mjs";
import { parsePlannedOwnedDirtScopeExpansionRecoveryArguments }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery.mjs";
import { createPlannedOwnedDirtScopeExpansionStore }
  from "../scripts/planned-owned-dirt-scope-expansion-recovery-store.mjs";

const SHA = "a".repeat(40);
const CLAIM = "b".repeat(64);
const SOURCE_WRITE_SET = [
  "path:src/owned", "semantic:marketplace",
];
const TARGET_WRITE_SET = [
  "path:src/new-runtime", "path:src/owned", "semantic:marketplace",
];

test("planned dirt plan seals a strict-superset successor including untracked bytes", () => {
  const plan = planFixture();
  assert.equal(plan.evidence.claimState, "dormant-preserved");
  assert.deepEqual(plan.evidence.untrackedPaths, ["src/owned/new.mjs"]);
  assert.deepEqual(plan.target.declaredWriteSet, TARGET_WRITE_SET);
  assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
  assert.throws(() => buildPlannedOwnedDirtScopeExpansionRecoveryPlan({
    evidence: evidenceFixture(),
    targetManifest: manifest(SOURCE_WRITE_SET),
  }), /strict superset/u);
});

test("controller requires exact authorization, persists every phase, and replays", async () => {
  const plan = planFixture();
  const state = { intent: null, calls: [] };
  const adapter = fakeAdapter(state);
  const controller = createPlannedOwnedDirtScopeExpansionRecoveryController(adapter);
  await assert.rejects(
    () => controller.run({ plan, authorization: "authorize" }),
    /requires: authorize planned-owned-dirt/u,
  );
  const result = await controller.run({
    plan,
    authorization: `authorize ${OPERATION} ${plan.planDigest}`,
  });
  assert.equal(result.status, "mutation-authority-restored");
  assert.equal(result.gitMutation, false);
  assert.equal(result.sourceMutation, false);
  assert.deepEqual(state.calls, [
    "authorize-task", "waiting", "retire", "promote", "bind", "local", "marker", "terminal",
  ]);
  const replay = await controller.run({ plan, authorization: "ignored-after-journal" });
  assert.equal(replay.receiptDigest, result.receiptDigest);
  assert.equal(state.calls.at(-1), "terminal");
  assert.equal(state.calls.filter(item => item === "waiting").length, 1);
});

test("journal CAS preserves the exact digest-bound intent", async () => {
  const plan = planFixture();
  const state = { intent: null, calls: [] };
  const controller = createPlannedOwnedDirtScopeExpansionRecoveryController(fakeAdapter(state));
  await controller.run({ plan,
    authorization: `authorize ${OPERATION} ${plan.planDigest}` });
  const directory = mkdtempSync(path.join(os.tmpdir(), "planned-owned-dirt-store-"));
  const store = createPlannedOwnedDirtScopeExpansionStore({ statePath: path.join(directory, "run.json") });
  store.write({ expected: null, next: state.intent });
  assert.equal(store.read().intentDigest, state.intent.intentDigest);
  assert.throws(() => store.write({ expected: null, next: state.intent }), /journal CAS/u);
});

test("CLI parser keeps planning read-only and run task-authorized", () => {
  const planned = parsePlannedOwnedDirtScopeExpansionRecoveryArguments([
    "plan", "--repository=/repo", "--session=s", "--target-manifest=/tmp/scope.json", "--json",
  ]);
  assert.equal(planned.mode, "plan");
  assert.equal(planned.taskAuthorityFile, undefined);
  const run = parsePlannedOwnedDirtScopeExpansionRecoveryArguments([
    "run", "--repository=/repo", "--session=s", "--target-manifest=/tmp/scope.json",
    "--plan-file=/tmp/plan.json", "--task-authority=/tmp/capability.json",
    "--authorize=authorize exact", "--ttl-seconds=600",
  ]);
  assert.equal(run.mode, "run");
  assert.equal(run.ttlSeconds, 600);
  assert.throws(() => parsePlannedOwnedDirtScopeExpansionRecoveryArguments([
    "run", "--repository=/repo", "--session=s", "--target-manifest=/tmp/scope.json",
  ]), /plan-file/u);
});

test("protected main may advance only as a path-disjoint descendant", () => {
  const baseSha = "1".repeat(40);
  const pullRequestBaseSha = "2".repeat(40);
  const protectedMainSha = "3".repeat(40);
  const calls = [];
  const gitText = argumentsList => {
    calls.push(argumentsList);
    if (argumentsList[0] === "diff") return "docs/unrelated.md\0";
    if (argumentsList[0] === "rev-parse") return "4".repeat(40);
    return "";
  };
  const proof = capturePlannedOwnedDirtProtectedMainAdvance({
    baseSha, pullRequestBaseSha, protectedMainSha,
    declaredWriteSet: TARGET_WRITE_SET, gitText,
  });
  assert.equal(proof.protectedMainSha, protectedMainSha);
  assert.equal(proof.changedPathCount, 1);
  assert.deepEqual(calls.slice(0, 2), [
    ["merge-base", "--is-ancestor", baseSha, pullRequestBaseSha],
    ["merge-base", "--is-ancestor", pullRequestBaseSha, protectedMainSha],
  ]);

  assert.throws(() => capturePlannedOwnedDirtProtectedMainAdvance({
    baseSha, pullRequestBaseSha, protectedMainSha,
    declaredWriteSet: TARGET_WRITE_SET,
    gitText: argumentsList => argumentsList[0] === "diff" ? "src/owned/file.mjs\0" : "4".repeat(40),
  }), /advanced within the admitted recovery write set/u);

  assert.throws(() => capturePlannedOwnedDirtProtectedMainAdvance({
    baseSha, pullRequestBaseSha, protectedMainSha,
    declaredWriteSet: TARGET_WRITE_SET,
    gitText: argumentsList => {
      if (argumentsList[0] === "merge-base") throw new Error("not an ancestor");
      return "";
    },
  }), /not an ancestor/u);
});

function fakeAdapter(state) {
  const values = {
    waiting: { claimId: "c".repeat(64), claimDigest: "d".repeat(64),
      transitionCounter: 1, receiptDigest: "e".repeat(64) },
    retired: { receiptDigest: "f".repeat(64) },
    promoted: { claimId: "c".repeat(64), claimDigest: "1".repeat(64),
      transitionCounter: 2, receiptDigest: "2".repeat(64) },
    bound: { authority: { claimId: "c".repeat(64) },
      verificationReceiptDigest: "3".repeat(64) },
    local: { leaseDigest: "4".repeat(64), mutationAuthorityReceiptDigest: "5".repeat(64) },
    marker: { markerDigest: "6".repeat(64), receiptDigest: "7".repeat(64) },
    terminal: { mutationAuthorityReceiptDigest: "8".repeat(64),
      terminalEvidenceDigest: "9".repeat(64) },
  };
  return {
    readEvidence: async () => evidenceFixture(),
    withOperationLock: async (_plan, action) => action(),
    readIntent: async () => state.intent,
    writeIntent: async ({ expected, next }) => {
      assert.equal(expected?.intentDigest || null, state.intent?.intentDigest || null);
      state.intent = next;
    },
    authorizeTask: async () => { state.calls.push("authorize-task"); return {
      receiptDigest: "a".repeat(64), proofDigest: "0".repeat(64) }; },
    claimWaitingSuccessor: async () => called(state, "waiting", values.waiting),
    retireSource: async () => called(state, "retire", values.retired),
    promoteSuccessor: async () => called(state, "promote", values.promoted),
    bindSuccessor: async () => called(state, "bind", values.bound),
    projectLocal: async () => called(state, "local", values.local),
    projectPullRequestMarker: async () => called(state, "marker", values.marker),
    verifyTerminal: async () => called(state, "terminal", values.terminal),
  };
}
function called(state, name, value) { state.calls.push(name); return value; }

function planFixture() {
  return buildPlannedOwnedDirtScopeExpansionRecoveryPlan({
    evidence: evidenceFixture(), targetManifest: manifest(TARGET_WRITE_SET),
  });
}
function manifest(declaredWriteSet) {
  return { schema: "agentic-declared-write-scope/v1", semanticScope: "marketplace",
    declaredWriteSet, writeSetDigest: digestValue(declaredWriteSet),
    manifestDigest: digestValue({ declaredWriteSet }) };
}
function evidenceFixture() {
  const entry = { path: "src/owned/new.mjs", staged: false, unstaged: false,
    untracked: true, headMode: null, headBlob: null, indexMode: null, indexBlob: null,
    worktreeType: "file", worktreeMode: "100644", worktreeBlob: "1".repeat(40) };
  const dirtCore = { schema: "agentic-active-owned-dirt-evidence/v1", headSha: SHA,
    entries: [entry], pathCount: 1, stagedPathCount: 0, unstagedPathCount: 0,
    untrackedPathCount: 1 };
  const ownedDirt = { ...dirtCore, evidenceDigest: digestValue(dirtCore) };
  return buildPlannedOwnedDirtScopeExpansionRecoveryEvidence({
    repositoryPathDigest: "2".repeat(64), targetRepository: "owner/repository",
    ledgerRepository: "owner/controller", branch: "agent/device/marketplace",
    sessionId: "session", device: "device", scope: "marketplace",
    baseSha: SHA, fenceSha: SHA, leaseDigest: "3".repeat(64), claimId: CLAIM,
    claimDigest: "4".repeat(64), claimTransitionCounter: 2,
    claimState: "dormant-preserved", reviewRequestId: "review", pullRequestUrl: "review-url",
    declaredWriteSet: SOURCE_WRITE_SET, writeSetDigest: digestValue(SOURCE_WRITE_SET),
    manifestDigest: "5".repeat(64), existingLaneStateDigest: "6".repeat(64),
    ownedDirt, taskAuthorityBindingDigest: "7".repeat(64),
    cloudLedgerRevision: "8".repeat(40), cloudLedgerDigest: "9".repeat(64),
    controllerDigest: "a".repeat(64), observedAt: "2026-08-22T00:00:00.000Z",
  });
}
