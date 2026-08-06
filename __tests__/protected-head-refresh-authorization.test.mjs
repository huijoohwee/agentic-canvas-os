import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTECTED_HEAD_REFRESH_HANDSHAKE_SCHEMA,
  renderProtectedHeadRefreshHandshakeEvidence,
  renderProtectedHeadRefreshRearmCommitMessage,
  requireProtectedHeadRefreshPullRequest,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  autoMergeActor,
  candidate,
  createControllerHarness,
  delivered,
  mainOne,
  normalizedProjection,
  pullRequestTitle,
  rawPull,
  targetMain,
} from "./protected-head-refresh-fixtures.mjs";

test("binds distinct original and deterministic non-null candidate authorizations", () => {
  const projection = normalizedProjection();
  const candidateBody = renderProtectedHeadRefreshRearmCommitMessage({
    pullRequestNumber: 17,
    deliveredHeadSha: delivered,
    targetMainSha: targetMain,
  });
  assert.equal(projection.auto_merge_commit_message, "null");
  assert.equal(projection.candidate_auto_merge_commit_title, pullRequestTitle);
  assert.equal(projection.candidate_auto_merge_commit_message, JSON.stringify(candidateBody));
  assert.notEqual(JSON.parse(projection.candidate_auto_merge_commit_message), null);

  const summary = renderProtectedHeadRefreshHandshakeEvidence({
    projection,
    candidateSha: candidate,
    phase: "pending-user-authorization",
  });
  const evidence = JSON.parse(summary);
  assert.equal(evidence.schema, PROTECTED_HEAD_REFRESH_HANDSHAKE_SCHEMA);
  assert.equal(evidence.operation_id, projection.operation_id);
  assert.equal(evidence.phase, "pending-user-authorization");
  assert.equal(
    evidence.projection.candidate_auto_merge_commit_message,
    JSON.stringify(candidateBody),
  );
  assert.equal(requireProtectedHeadRefreshPullRequest({
    pullRequest: rawPull({
      headSha: candidate,
      baseSha: targetMain,
      mergeState: "blocked",
      autoMergeAuthorization: "original",
    }),
    projection,
  }).autoMergeAuthorization, "original");
  assert.equal(requireProtectedHeadRefreshPullRequest({
    pullRequest: rawPull({
      headSha: candidate,
      baseSha: targetMain,
      mergeState: "blocked",
      autoMergeAuthorization: "candidate",
    }),
    projection,
  }).autoMergeAuthorization, "candidate");
});

test("initial null candidate authorization remains a manual recovery state", () => {
  const harness = createControllerHarness({
    initialHeadSha: candidate,
    initialAutoMergeMethod: null,
    initialMergeState: "blocked",
    initialCloudStatus: "pending",
  });
  assert.throws(() => harness.execute(), /candidate user re-authorization did not arrive/u);
  assert.equal(harness.events.includes("prepare"), false);
  assert.equal(harness.events.includes("push"), false);
  assert.equal(harness.events.includes("disable"), false);
  assert.equal(harness.events.includes("gate-create"), false);
  assert.equal(harness.events.includes("gate-complete"), false);
});

test("carried original authorization plus absent context creates the pending gate", () => {
  const harness = createControllerHarness({
    initialHeadSha: candidate,
    initialAutoMergeMethod: "squash",
    initialAutoMergeAuthorization: "original",
    initialMergeState: "blocked",
  });
  assert.equal(harness.execute().status, "candidate-replay");
  assert.ok(harness.events.indexOf("gate-create") < harness.events.indexOf("workflow"));
  assert.ok(harness.events.indexOf("gate-create") < harness.events.indexOf("protection"));
  assert.equal(harness.events.includes("disable"), false);
  assert.equal(harness.events.includes("gate-complete"), true);
});

test("exact candidate authorization plus pending gate continues without controller auth mutation", () => {
  const harness = createControllerHarness({
    initialHeadSha: candidate,
    initialAutoMergeMethod: "squash",
    initialMergeState: "blocked",
    initialCloudStatus: "pending",
  });
  assert.equal(harness.execute().status, "candidate-replay");
  assert.equal(harness.events.includes("disable"), false);
  assert.equal(harness.events.includes("gate-complete"), true);
});

test("candidate authorization without its prerequisite pending gate fails closed", () => {
  const harness = createControllerHarness({
    initialHeadSha: candidate,
    initialAutoMergeMethod: "squash",
    initialAutoMergeAuthorization: "candidate",
    initialMergeState: "blocked",
  });
  assert.throws(() => harness.execute(), /lacks its pending gate/u);
  assert.equal(harness.events.includes("gate-create"), false);
  assert.equal(harness.events.includes("ci"), false);
});

test("complete+disabled is preserved as manual-recovery state", () => {
  const harness = createControllerHarness({
    initialHeadSha: candidate,
    initialAutoMergeMethod: null,
    initialMergeState: "blocked",
    initialCloudStatus: "complete",
  });
  const result = harness.execute();
  assert.equal(result.status, "authorization-complete-disabled");
  assert.equal(result.mutated, false);
  assert.equal(harness.events.includes("ci"), false);
});

test("disabled original head respects user revocation without any controller mutation", () => {
  const harness = createControllerHarness({ initialAutoMergeMethod: null });
  const result = harness.execute();
  assert.equal(result.status, "original-authorization-revoked");
  assert.equal(result.mutated, false);
  assert.equal(harness.events.includes("push"), false);
});

test("pending gate remains pending when user re-authorization never arrives", () => {
  const harness = createControllerHarness({ neverUserArm: true });
  assert.throws(() => harness.execute(), /candidate user re-authorization did not arrive/u);
  assert.equal(harness.state.cloudStatus, "pending");
  assert.equal(harness.state.autoMergeAuthorization, "original");
  assert.equal(harness.events.includes("gate-complete"), false);
});

test("substituted re-authorization identity cannot complete the gate", () => {
  const harness = createControllerHarness({ substitutedArm: true });
  assert.throws(() => harness.execute(), /non-SQUASH|authorization identity drifted/u);
  assert.equal(harness.state.cloudStatus, "pending");
  assert.equal(harness.events.includes("gate-complete"), false);
});

test("partial or lost cloud completion response does not mutate authorization", () => {
  const harness = createControllerHarness({ partialCloudCompletion: true });
  assert.throws(() => harness.execute(), /did not complete exactly/u);
  assert.equal(harness.state.autoMergeMethod, "squash");
  assert.equal(harness.state.cloudStatus, "pending");
  assert.equal(harness.events.filter(value => value === "disable").length, 0);
});

test("pending gate terminal failure is never overwritten or followed by auth mutation", () => {
  const harness = createControllerHarness({ cloudFailsBeforePatch: true });
  assert.throws(() => harness.execute(), /terminalized before authorization commit/u);
  assert.equal(harness.state.cloudStatus, "pending");
  assert.equal(harness.state.autoMergeMethod, "squash");
  assert.equal(harness.events.filter(value => value === "disable").length, 0);
});

test("merged replay requires completed owned evidence for a refreshed candidate", async t => {
  await t.test("pending evidence is rejected", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialMergeState: "blocked",
      initialCloudStatus: "pending",
      merged: true,
    });
    assert.throws(() => harness.execute(), /without complete owned authorization/u);
  });
  await t.test("complete evidence is accepted", () => {
    let mergedProof;
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialMergeState: "blocked",
      initialCloudStatus: "complete",
      merged: true,
      captureMergedCommit: value => { mergedProof = value; },
    });
    assert.equal(harness.execute().status, "merged-replay");
    assert.equal(harness.events.includes("inspect"), true);
    assert.equal(
      mergedProof.commitMessageJson,
      normalizedProjection().candidate_auto_merge_commit_message,
    );
  });
  await t.test("provider base substitution is rejected", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialBaseSha: mainOne,
      initialMergeState: "blocked",
      initialCloudStatus: "complete",
      merged: true,
    });
    assert.throws(() => harness.execute(), /merged candidate base drifted/u);
  });
});

test("unchanged delivered-head merged replay needs ancestry but no owned check", () => {
  const harness = createControllerHarness({ merged: true });
  assert.equal(harness.execute().status, "merged-replay");
  assert.equal(harness.events.includes("merged"), true);
  assert.equal(harness.events.includes("gate-read"), false);
});

test("merged provider projection retains the exact candidate request and human merger", async t => {
  const projection = normalizedProjection();
  const verify = overrides => requireProtectedHeadRefreshPullRequest({
    pullRequest: rawPull({
      headSha: candidate,
      baseSha: targetMain,
      mergeState: "clean",
      state: "closed",
      merged: true,
      ...overrides,
    }),
    projection,
  });
  assert.equal(verify({}).merged, true);
  for (const [name, overrides, error] of [
    ["missing retained request", { autoMergeMethod: null }, /retained SQUASH/u],
    ["wrong method", { autoMergeMethod: "merge" }, /non-SQUASH/u],
    ["actor database id", {
      autoMergeActorValue: { ...autoMergeActor, id: 78 },
    }, /authorization identity drifted/u],
    ["actor node id", {
      autoMergeActorValue: { ...autoMergeActor, node_id: "U_other" },
    }, /authorization identity drifted/u],
    ["actor login", {
      autoMergeActorValue: { ...autoMergeActor, login: "other" },
    }, /authorization identity drifted/u],
    ["actor type", {
      autoMergeActorValue: { ...autoMergeActor, type: "Bot" },
    }, /authorization identity drifted/u],
    ["commit title", {
      autoMergeCommitTitle: "Substituted squash title",
    }, /authorization identity drifted/u],
    ["commit body", { autoMergeCommitMessage: null }, /retained SQUASH|authorization identity/u],
    ["merged by", {
      mergedBy: { ...autoMergeActor, id: 78 },
    }, /merged attribution drifted/u],
    ["base ref", { baseRef: "release" }, /protected main base/u],
    ["base repository", { baseRepository: "other/repo" }, /protected main base/u],
    ["head ref", { headRef: "other" }, /exact same-repository head/u],
    ["head repository", { headRepository: "other/repo" }, /exact same-repository head/u],
    ["PR node", { nodeId: "PR_other" }, /identity drifted/u],
    ["PR title", { title: "Other title" }, /identity drifted/u],
  ]) {
    await t.test(name, () => assert.throws(() => verify(overrides), error));
  }
});
