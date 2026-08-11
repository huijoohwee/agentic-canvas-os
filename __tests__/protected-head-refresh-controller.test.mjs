import assert from "node:assert/strict";
import test from "node:test";

import {
  requireProtectedHeadRefreshControllerRevision,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  candidate,
  createControllerHarness,
  delivered,
  mainOne,
  refreshTwo,
  targetMain,
} from "./protected-head-refresh-fixtures.mjs";

test("open controller revisions remain pinned to the projected target main", () => {
  assert.equal(requireProtectedHeadRefreshControllerRevision({
    controllerRevision: targetMain,
    targetMainSha: targetMain,
  }), targetMain);
  assert.throws(() => requireProtectedHeadRefreshControllerRevision({
    controllerRevision: mainOne,
    targetMainSha: targetMain,
    mergedReplay: false,
    targetMainIsAncestor: true,
    mergeCommitIsAncestor: true,
  }), /nor an authorized merged successor/u);
});

test("merged replay accepts only a successor containing target and merge commit", () => {
  assert.equal(requireProtectedHeadRefreshControllerRevision({
    controllerRevision: mainOne,
    targetMainSha: targetMain,
    mergedReplay: true,
    targetMainIsAncestor: true,
    mergeCommitIsAncestor: true,
  }), mainOne);
  for (const ancestry of [
    { targetMainIsAncestor: false, mergeCommitIsAncestor: true },
    { targetMainIsAncestor: true, mergeCommitIsAncestor: false },
  ]) {
    assert.throws(() => requireProtectedHeadRefreshControllerRevision({
      controllerRevision: mainOne,
      targetMainSha: targetMain,
      mergedReplay: true,
      ...ancestry,
    }), /nor an authorized merged successor/u);
  }
});

test("publishes behind strict absent-check protection and completes only after user re-authorization", () => {
  const harness = createControllerHarness({ unknownReads: 1 });
  const result = harness.execute();
  assert.equal(result.status, "candidate-published");
  assert.equal(result.workflowRunId, 123);
  assert.equal(result.checkSuiteId, 9123);
  assert.equal(harness.state.cloudStatus, "complete");
  assert.ok(harness.events.indexOf("prepare") < harness.events.indexOf("push"));
  assert.ok(harness.events.indexOf("workflow") < harness.events.indexOf("push"));
  assert.ok(harness.events.indexOf("protection") < harness.events.indexOf("push"));
  assert.ok(harness.events.indexOf("checks-absent") < harness.events.indexOf("push"));
  assert.ok(harness.events.indexOf("gate-create") < harness.events.indexOf("ci"));
  assert.ok(harness.events.lastIndexOf("cloud") < harness.events.indexOf("gate-complete"));
  assert.equal(harness.events.includes("disable"), false, "controller never disables");
  assert.equal(harness.events.includes("arm"), false, "controller never re-arms");
});

test("replays a lost push response from the exact observable candidate", () => {
  const harness = createControllerHarness({ lostPushResponse: true });
  assert.equal(harness.execute().status, "candidate-published");
  assert.equal(harness.events.filter(value => value === "push").length, 1);
});

test("allows only the captured pre-push base to converge to target main", () => {
  const harness = createControllerHarness({ baseDriftBeforeCas: true });
  assert.equal(harness.execute().status, "candidate-published");
  assert.equal(harness.state.baseSha, targetMain);
});

test("absent strict context blocks while base converges before gate creation and long verifiers", () => {
  const harness = createControllerHarness({
    initialHeadSha: candidate,
    initialBaseSha: mainOne,
    initialAutoMergeMethod: "squash",
    initialAutoMergeAuthorization: "original",
    initialMergeState: "behind",
    candidateBaseConvergesOnSleep: true,
  });
  assert.equal(harness.execute().status, "candidate-replay");
  assert.ok(harness.events.indexOf("sleep") < harness.events.indexOf("gate-create"));
  assert.ok(harness.events.indexOf("gate-create") < harness.events.indexOf("workflow"));
  assert.ok(harness.events.indexOf("gate-create") < harness.events.indexOf("protection"));
});

test("a branch CAS race never reaches CI or gate creation", () => {
  const harness = createControllerHarness({ pushRaceHeadSha: targetMain });
  assert.throws(() => harness.execute(), /unauthorized head after push/u);
  assert.equal(harness.state.autoMergeMethod, "squash");
  assert.equal(harness.state.autoMergeAuthorization, "original");
  assert.equal(harness.events.includes("ci"), false);
  assert.equal(harness.events.includes("gate-create"), false);
});

test("post-push base SHA, ref, and repository drift fail before CI", async t => {
  for (const [name, options, error] of [
    ["foreign SHA", { postPushBaseSha: refreshTwo }, /provider base drifted/u],
    ["foreign ref", { postPushBaseRef: "release" }, /protected main base/u],
    ["foreign repository", { postPushBaseRepository: "other/repo" }, /protected main base/u],
  ]) {
    await t.test(name, () => {
      const harness = createControllerHarness(options);
      assert.throws(() => harness.execute(), error);
      assert.equal(harness.state.autoMergeMethod, "squash");
      assert.equal(harness.events.includes("ci"), false);
    });
  }
});

test("a missing push is bounded without mutating original user authorization", () => {
  const harness = createControllerHarness({ pushNeverObservable: true });
  assert.throws(() => harness.execute({ maxCandidatePolls: 3 }), /push response lost/u);
  assert.equal(harness.state.autoMergeMethod, "squash");
  assert.equal(harness.state.autoMergeAuthorization, "original");
  assert.equal(harness.events.includes("gate-create"), false);
});

test("a crash after CAS but before pending POST replays the carried original request", () => {
  const harness = createControllerHarness({ crashBeforeGateCreateOnce: true });
  assert.throws(() => harness.execute(), /crash before gate create/u);
  assert.equal(harness.state.headSha, candidate);
  assert.equal(harness.state.autoMergeAuthorization, "original");
  assert.equal(harness.state.cloudStatus, "absent");
  const replay = harness.execute();
  assert.equal(replay.status, "candidate-replay");
  assert.equal(harness.events.filter(value => value === "push").length, 1);
});

test("candidate must be BLOCKED by the absent strict context before pending POST", () => {
  const harness = createControllerHarness({ postPushMergeState: "clean" });
  assert.throws(() => harness.execute(), /not exactly BLOCKED by the absent strict context/u);
  assert.equal(harness.state.cloudStatus, "absent");
  assert.equal(harness.events.includes("gate-create"), false);
});

test("metadata drift before either exact pre-CAS read causes no publication", async t => {
  for (const options of [{ driftBeforeCas: true }, { driftAtCasFence: true }]) {
    await t.test(JSON.stringify(options), () => {
      const harness = createControllerHarness(options);
      assert.throws(() => harness.execute(), /metadata drifted|identity drifted/u);
      assert.equal(harness.events.includes("push"), false);
      assert.equal(harness.events.includes("gate-complete"), false);
    });
  }
});

test("candidate-authored CI bytes fail before push", () => {
  const harness = createControllerHarness({ candidateWorkflowDrift: true });
  assert.throws(() => harness.execute(), /candidate CI workflow differs/u);
  assert.equal(harness.state.headSha, delivered);
  assert.equal(harness.state.autoMergeMethod, "squash");
  assert.equal(harness.events.includes("push"), false);
});

test("main drift during final cloud proof is caught before PATCH", () => {
  const harness = createControllerHarness({ mainDriftDuringFinalCloudProof: true });
  assert.throws(() => harness.execute(), /Protected main changed/u);
  assert.equal(harness.state.cloudStatus, "pending");
  assert.equal(harness.events.includes("gate-complete"), false);
});

test("fresh branch-ref race after long proofs is caught before cloud PATCH", () => {
  const harness = createControllerHarness({ candidateHeadFenceRace: true });
  assert.throws(() => harness.execute(), /fetched feature ref drifted/u);
  assert.equal(harness.state.cloudStatus, "pending");
  assert.equal(harness.events.includes("gate-complete"), false);
  assert.ok(harness.events.lastIndexOf("cloud") < harness.events.indexOf("head-fence"));
});

test("a non-behind reviewed head is a non-mutating result", () => {
  const harness = createControllerHarness({ initialMergeState: "clean" });
  const result = harness.execute();
  assert.equal(result.status, "not-behind");
  assert.equal(result.mutated, false);
  assert.equal(harness.events.includes("disable"), false);
});
