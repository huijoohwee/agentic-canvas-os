import assert from "node:assert/strict";
import test from "node:test";

import {
  assertIntegratedPreservedDraftRecoveryAuthorization,
  assertIntegratedPreservedReadyProjection,
  createIntegratedPreservedDraftRecoveryPlan,
  INTEGRATED_PRESERVED_DRAFT_RECOVERY_AUTHORIZATION_PREFIX,
} from "../scripts/integrated-preserved-draft-recovery-contract.mjs";
import {
  createIntegratedPreservedDraftRecoveryController,
} from "../scripts/integrated-preserved-draft-recovery-controller.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);

function evidence(overrides = {}) {
  return {
    repository: "/repo",
    repositoryId: "github-repository:R_test",
    targetRepository: "owner/repo",
    branch: "agent/device.local/scope",
    sessionId: "source-session",
    deviceId: "device.local",
    actorLogin: "owner",
    clean: true,
    baseSha: sha("a"),
    localHeadSha: sha("b"),
    remoteHeadSha: sha("b"),
    reviewHeadSha: sha("b"),
    leaseStatus: "review_ready",
    leaseSessionId: "source-session",
    leaseEpoch: 7,
    localLeaseDigest: digest("1"),
    taskAuthorityBindingDigest: digest("2"),
    localAuthorityState: "review_ready",
    localAuthorityClaimId: digest("3"),
    localAuthorityLaneRevision: sha("b"),
    localAuthorityReviewRequestId: "github-pull-request:PR_1",
    localAuthorityWriteSetDigest: digest("4"),
    localAuthorityLeaseEpoch: 7,
    localAuthorityDigest: digest("5"),
    remoteClaimId: digest("3"),
    remoteClaimState: "integrated-preserved",
    remoteClaimWriteAuthority: false,
    remoteClaimScopeReserved: true,
    remoteClaimRepositoryId: "github-repository:R_test",
    remoteClaimCanonicalBaseSha: sha("a"),
    remoteClaimLaneRevision: sha("b"),
    remoteClaimReviewRequestId: "github-pull-request:PR_1",
    remoteClaimWriteSetDigest: digest("4"),
    remoteClaimLeaseEpoch: 7,
    remoteClaimTransitionCounter: 6,
    remoteClaimOperationReceiptDigest: digest("6"),
    remoteClaimIntegrationReceiptDigest: digest("7"),
    remoteClaimIntegrationDigest: digest("8"),
    remoteClaimDigest: digest("9"),
    continuationSubjectDigest: digest("a"),
    pullRequestId: "PR_1",
    pullRequestNumber: 1,
    pullRequestUrl: "https://github.com/owner/repo/pull/1",
    pullRequestState: "OPEN",
    pullRequestDraft: true,
    pullRequestAutoMergeArmed: false,
    pullRequestAuthorLogin: "owner",
    pullRequestHeadRepository: "owner/repo",
    pullRequestHeadOwnerLogin: "owner",
    pullRequestHeadBranch: "agent/device.local/scope",
    pullRequestHeadSha: sha("b"),
    pullRequestBaseBranch: "main",
    pullRequestBaseSha: sha("a"),
    pullRequestBodyDigest: digest("b"),
    pullRequestProviderIdentityDigest: digest("c"),
    remoteLeaseDigest: digest("d"),
    ...overrides,
  };
}

function controllerFixture({ initial = evidence(), project = null } = {}) {
  let state = initial;
  const calls = [];
  const adapter = {
    async readState() {
      calls.push("read");
      return state;
    },
    async authorizeTask() {
      calls.push("authorize");
      return { receiptDigest: digest("e") };
    },
    async withOperationFence(_options, action) {
      calls.push("fence");
      return action();
    },
    async projectPullRequestReady(input) {
      calls.push("ready");
      if (project) return project({ input, setState: next => { state = next; } });
      state = evidence({ ...state, pullRequestDraft: false });
      return { operationDigest: digest("f") };
    },
  };
  return {
    calls,
    controller: createIntegratedPreservedDraftRecoveryController({ adapter }),
    setState(next) { state = next; },
  };
}

test("plan seals the exact integrated-preserved draft projection", () => {
  const plan = createIntegratedPreservedDraftRecoveryPlan(evidence());
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.findings, []);
  assert.equal(
    plan.authorization,
    `${INTEGRATED_PRESERVED_DRAFT_RECOVERY_AUTHORIZATION_PREFIX} ${plan.planDigest}`,
  );
  assert.equal(assertIntegratedPreservedDraftRecoveryAuthorization(plan, plan.authorization), plan);
});

test("draft is the only projection bit excluded from the sealed identity", () => {
  const before = evidence();
  const after = evidence({ pullRequestDraft: false });
  const beforePlan = createIntegratedPreservedDraftRecoveryPlan(before);
  const afterPlan = createIntegratedPreservedDraftRecoveryPlan(after);
  assert.equal(beforePlan.planDigest, afterPlan.planDigest);
  assert.deepEqual(assertIntegratedPreservedReadyProjection({ before, after }), {
    planDigest: beforePlan.planDigest,
    beforeDraft: true,
    afterDraft: false,
    identityDigest: afterPlan.identityDigest,
  });
  assert.throws(
    () => assertIntegratedPreservedReadyProjection({
      before,
      after: evidence({ pullRequestDraft: false, pullRequestBodyDigest: digest("0") }),
    }),
    /outside the sealed exact identity/u,
  );
});

test("identity, authority, provider, and worktree drift block planning", () => {
  const cases = [
    { clean: false },
    { leaseStatus: "delivery" },
    { remoteClaimState: "current" },
    { remoteClaimWriteAuthority: true },
    { pullRequestState: "CLOSED" },
    { pullRequestAutoMergeArmed: true },
    { pullRequestHeadSha: sha("c") },
    { pullRequestBaseSha: sha("c") },
    { pullRequestAuthorLogin: "other" },
    { localAuthorityClaimId: digest("0") },
  ];
  for (const change of cases) {
    assert.equal(createIntegratedPreservedDraftRecoveryPlan(evidence(change)).status, "blocked");
  }
});

test("execute projects ready once and returns a bounded receipt", async () => {
  const fixture = controllerFixture();
  const plan = await fixture.controller.plan({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
  });
  const result = await fixture.controller.execute({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
    authorization: plan.authorization,
  });
  assert.equal(result.status, "pull-request-ready");
  assert.equal(result.disposition, "projected");
  assert.equal(result.providerMutationAttempted, true);
  assert.equal(result.providerResponseObserved, true);
  assert.equal(result.sourceMutation, false);
  assert.equal(result.receiptDigest, result.terminalReceiptDigest);
  assert.equal(result.terminalReceipt.receiptDigest, result.terminalReceiptDigest);
  assert.match(result.executionReceiptDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(fixture.calls, ["read", "read", "fence", "read", "authorize", "ready", "read"]);
});

test("response loss adopts only the exact ready provider projection", async () => {
  const fixture = controllerFixture({
    project({ setState }) {
      setState(evidence({ pullRequestDraft: false }));
      throw new Error("simulated provider response loss");
    },
  });
  const plan = await fixture.controller.plan({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
  });
  const result = await fixture.controller.execute({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
    authorization: plan.authorization,
  });
  assert.equal(result.disposition, "response-loss-adopted");
  assert.equal(result.providerResponseObserved, false);
});

test("response loss without the ready projection fails closed", async () => {
  const fixture = controllerFixture({
    project() {
      throw new Error("provider failed before mutation");
    },
  });
  const plan = await fixture.controller.plan({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
  });
  await assert.rejects(fixture.controller.execute({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
    authorization: plan.authorization,
  }), /exact ready-state adoption did not verify/u);
});

test("stale authorization fails before task proof and provider mutation", async () => {
  const fixture = controllerFixture();
  await assert.rejects(fixture.controller.execute({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
    authorization: `${INTEGRATED_PRESERVED_DRAFT_RECOVERY_AUTHORIZATION_PREFIX} ${digest("0")}`,
  }), /Exact authorization required/u);
  assert.deepEqual(fixture.calls, ["read"]);
});

test("cold replay authenticates the task but never reprojects an already-ready PR", async () => {
  const fixture = controllerFixture({ initial: evidence({ pullRequestDraft: false }) });
  const plan = await fixture.controller.plan({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
  });
  const result = await fixture.controller.execute({
    branch: evidence().branch,
    sessionId: evidence().sessionId,
    authorization: plan.authorization,
  });
  assert.equal(result.disposition, "already-ready-adopted");
  assert.equal(result.providerMutationAttempted, false);
  assert.equal(result.providerResponseObserved, false);
  assert.equal(fixture.calls.includes("ready"), false);
  assert.equal(fixture.calls.includes("authorize"), true);
});

test("projected, response-loss, and cold replay share one terminal receipt", async () => {
  const projected = controllerFixture();
  const responseLoss = controllerFixture({
    project({ setState }) {
      setState(evidence({ pullRequestDraft: false }));
      throw new Error("simulated provider response loss");
    },
  });
  const coldReplay = controllerFixture({ initial: evidence({ pullRequestDraft: false }) });
  const results = [];
  for (const fixture of [projected, responseLoss, coldReplay]) {
    const plan = await fixture.controller.plan({
      branch: evidence().branch,
      sessionId: evidence().sessionId,
    });
    results.push(await fixture.controller.execute({
      branch: evidence().branch,
      sessionId: evidence().sessionId,
      authorization: plan.authorization,
    }));
  }
  assert.equal(new Set(results.map(result => result.terminalReceiptDigest)).size, 1);
  assert.equal(new Set(results.map(result => result.receiptDigest)).size, 1);
  assert.equal(new Set(results.map(result => result.executionReceiptDigest)).size, 3);
});
