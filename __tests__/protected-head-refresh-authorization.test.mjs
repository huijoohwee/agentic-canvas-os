import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROTECTED_HEAD_REFRESH_HANDSHAKE_SCHEMA,
  renderProtectedHeadRefreshHandshakeEvidence,
  renderProtectedHeadRefreshRearmCommitMessage,
  requireProtectedHeadRefreshPullRequest,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  requireProtectedHeadRefreshMergedAuthorizationRecovery,
} from "../scripts/protected-head-refresh-github-adapter.mjs";
import {
  DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY,
  readProtectedHeadRefreshRepositoryPolicy,
} from "../scripts/protected-head-refresh-repository-policy.mjs";
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

test("workflow encodes recovery without exceeding the 25-input provider cap", () => {
  const workflow = readFileSync(new URL(
    "../.github/workflows/auto-delivery.yml",
    import.meta.url,
  ), "utf8");
  const dispatchInputs = workflow
    .split("permissions: {}", 1)[0]
    .match(/^      [a-z][a-z_]+:$/gmu) || [];
  assert.equal(dispatchInputs.length, 25);
  assert.doesNotMatch(workflow, /^      merged_authorization_recovery:$/mu);
  assert.match(
    workflow,
    /protected-head-refresh-recover-absent-merged-authorization/u,
  );
  assert.match(
    workflow,
    /recover-absent-merged-authorization:\{0\}/u,
  );
  const adapter = readFileSync(new URL(
    "../scripts/protected-head-refresh-github-adapter.mjs",
    import.meta.url,
  ), "utf8");
  assert.match(adapter, /allowRetiredIntegratedPreserved: true/u);
  assert.match(adapter, /integrationReceiptDigest: projection\.integration_receipt_digest/u);
  assert.match(adapter, /transitionCounter: projection\.transition_counter/u);
  assert.ok(
    adapter.indexOf("integrationReceiptDigest: projection.integration_receipt_digest")
      < adapter.indexOf("pullRequest.merged && allowAbsentMergedAuthorizationRecovery"),
  );
});

test("repository policy keeps defaults and validates adapter overrides", () => {
  assert.equal(DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY.ciWorkflow, "ci.yml");
  const policy = readProtectedHeadRefreshRepositoryPolicy({ environment: {
    PROTECTED_HEAD_REFRESH_CI_WORKFLOW: "integration.yml",
    PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON: '["Integration Gate"]',
    PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: '["Integration Gate"]',
    PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: "[]",
    PROTECTED_HEAD_REFRESH_AUDITED_WORKFLOWS_JSON: '["auto-delivery.yml"]',
  } });
  assert.equal(policy.ciWorkflow, "integration.yml");
  assert.deepEqual(policy.requiredCiContexts, ["Integration Gate"]);
  assert.deepEqual(policy.classicRequiredChecks, ["Integration Gate"]);
  assert.deepEqual(policy.rulesetRequiredChecks, []);
  assert.deepEqual(policy.auditedWorkflows, ["auto-delivery.yml"]);
  assert.match(policy.policyDigest, /^[0-9a-f]{64}$/u);

  for (const environment of [
    { PROTECTED_HEAD_REFRESH_CI_WORKFLOW: "../ci.yml" },
    { PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON: "[]" },
    { PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: '["x","x"]' },
    { PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: "not-json" },
  ]) {
    assert.throws(
      () => readProtectedHeadRefreshRepositoryPolicy({ environment }),
      /Protected-head refresh/u,
    );
  }
});

test("absent merged recovery token binds exact operation and human actor", () => {
  const projection = normalizedProjection();
  assert.equal(requireProtectedHeadRefreshMergedAuthorizationRecovery({
    value: "",
    projection,
  }), false);
  assert.equal(requireProtectedHeadRefreshMergedAuthorizationRecovery({
    value: `recover-absent-merged-authorization:${projection.operation_id}`,
    projection,
    actorId: projection.auto_merge_enabled_by_database_id,
    actorLogin: projection.auto_merge_enabled_by_login,
  }), true);
  for (const overrides of [
    { value: "recover-absent-merged-authorization:wrong" },
    { actorId: "7" },
    { actorLogin: "other" },
  ]) {
    assert.throws(() => requireProtectedHeadRefreshMergedAuthorizationRecovery({
      value: `recover-absent-merged-authorization:${projection.operation_id}`,
      projection,
      actorId: projection.auto_merge_enabled_by_database_id,
      actorLogin: projection.auto_merge_enabled_by_login,
      ...overrides,
    }), /recovery identity drifted/u);
  }
});

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

test("same serialized completion survives immediate merge and gate disappearance", () => {
  const harness = createControllerHarness({
    mergeAfterCompletion: true,
    dropCloudAfterCompletion: true,
  });
  const result = harness.execute();
  assert.equal(result.status, "merged-replay");
  assert.equal(result.mutated, true);
  assert.deepEqual(result.cloudCheckRunIds, [501]);
  assert.equal(harness.events.filter(value => value === "gate-complete").length, 1);
  assert.equal(harness.events.filter(value => value === "gate-create").length, 1);
});

test("merged replay recovers only exact pending owned evidence for a refreshed candidate", async t => {
  await t.test("pending evidence is completed after full merged proof", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialMergeState: "blocked",
      initialCloudStatus: "pending",
      merged: true,
    });
    const result = harness.execute();
    assert.equal(result.status, "merged-replay");
    assert.equal(result.mutated, true);
    assert.equal(harness.state.cloudStatus, "complete");
    assert.equal(harness.events.filter(value => value === "gate-complete").length, 1);
    assert.equal(harness.events.filter(value => value === "ci").length, 2);
    assert.equal(harness.events.filter(value => value === "cloud").length, 2);
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
    const result = harness.execute();
    assert.equal(result.status, "merged-replay");
    assert.equal(result.mutated, false);
    assert.equal(harness.events.includes("gate-complete"), false);
    assert.equal(harness.events.includes("inspect"), true);
    assert.equal(
      mergedProof.commitMessageJson,
      normalizedProjection().candidate_auto_merge_commit_message,
    );
  });
  await t.test("absent owned evidence is rejected without creating it", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialAutoMergeAuthorization: "candidate",
      initialMergeState: "blocked",
      merged: true,
    });
    assert.throws(() => harness.execute(), /without complete owned authorization/u);
    assert.equal(harness.events.includes("gate-create"), false);
    assert.equal(harness.events.includes("gate-complete"), false);
  });
  await t.test("exact recovery authorization creates and completes sole absent evidence", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialAutoMergeAuthorization: "candidate",
      initialMergeState: "blocked",
      merged: true,
    });
    const result = harness.execute({
      projection: Object.freeze({
        ...normalizedProjection(),
        allowAbsentMergedAuthorizationRecovery: true,
      }),
    });
    assert.equal(result.status, "merged-replay");
    assert.equal(result.mutated, true);
    assert.equal(harness.state.cloudStatus, "complete");
    assert.equal(harness.events.filter(value => value === "gate-create").length, 1);
    assert.equal(harness.events.filter(value => value === "gate-complete").length, 1);
    assert.equal(harness.events.filter(value => value === "ci").length, 3);
    assert.equal(harness.events.filter(value => value === "cloud").length, 3);
  });
  await t.test("pending evidence is not completed when candidate workflow proof drifts", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialMergeState: "blocked",
      initialCloudStatus: "pending",
      candidateWorkflowDrift: true,
      merged: true,
    });
    assert.throws(() => harness.execute(), /workflow differs/u);
    assert.equal(harness.state.cloudStatus, "pending");
    assert.equal(harness.events.includes("gate-complete"), false);
  });
  await t.test("partial completion stays fail closed", () => {
    const harness = createControllerHarness({
      initialHeadSha: candidate,
      initialMergeState: "blocked",
      initialCloudStatus: "pending",
      partialCloudCompletion: true,
      merged: true,
    });
    assert.throws(() => harness.execute(), /did not complete exactly/u);
    assert.equal(harness.state.cloudStatus, "pending");
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
