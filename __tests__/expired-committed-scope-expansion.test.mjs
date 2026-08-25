import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeExpiredCommittedScopeExpansion,
  buildExpiredCommittedScopeExpansionPlan,
  normalizeExpiredCommittedScopeExpansionPlan,
} from "../scripts/expired-committed-scope-expansion-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  initializeExpiredCommittedScopeExpansionIntent,
  resolveExpiredCommittedSourceRetirementIdentity,
  resolveExpiredCommittedSuccessorCanonicalBase,
}
  from "../scripts/expired-committed-scope-expansion-repository-adapter.mjs";

const sourceBaseSha = "1".repeat(40);
const protectedMainSha = "2".repeat(40);
const fenceSha = "3".repeat(40);
const headSha = "4".repeat(40);
const treeSha = "5".repeat(40);
const sourceClaimId = "a".repeat(64);
const sourceClaimDigest = "b".repeat(64);
const sourceWriteSet = [
  "path:src/marketplace.ts",
  "semantic:native-marketplace",
];
const targetWriteSet = [
  "path:docs/runtime.md",
  "path:src/marketplace.ts",
  "semantic:native-marketplace",
];

test("plans one exact expired clean unpublished scope-expansion successor", () => {
  const plan = buildExpiredCommittedScopeExpansionPlan(fixture());
  assert.equal(plan.sourceFenceSha, fenceSha);
  assert.equal(plan.localHeadSha, headSha);
  assert.equal(plan.targetWriteSetDigest, digestValue(targetWriteSet));
  assert.deepEqual(normalizeExpiredCommittedScopeExpansionPlan(plan), plan);
  assert.throws(
    () => authorizeExpiredCommittedScopeExpansion(plan, "authorize something-else"),
    /exact authorization/u,
  );
  assert.equal(
    authorizeExpiredCommittedScopeExpansion(
      plan,
      `authorize expired-committed-scope-expansion ${plan.planDigest}`,
    ).planDigest,
    plan.planDigest,
  );
});

test("rejects a descendant that is not directly fenced or does not use expansion", () => {
  assert.throws(
    () => buildExpiredCommittedScopeExpansionPlan({
      ...fixture(),
      parentSha: "6".repeat(40),
    }),
    /directly above/u,
  );
  assert.throws(
    () => buildExpiredCommittedScopeExpansionPlan({
      ...fixture(),
      authoredPaths: ["src/marketplace.ts"],
    }),
    /strict scope expansion/u,
  );
});

test("rejects live local or cloud authority", () => {
  const current = fixture();
  assert.throws(
    () => buildExpiredCommittedScopeExpansionPlan({
      ...current,
      lease: { ...current.lease, expiresAt: "2030-01-01T00:00:00.000Z" },
    }),
    /expired active admitted/u,
  );
  assert.throws(
    () => buildExpiredCommittedScopeExpansionPlan({
      ...current,
      sourceClaim: { ...current.sourceClaim, state: "current" },
    }),
    /dormant expired/u,
  );
});

test("uses the newly persisted intent directly before the first cloud mutation", () => {
  const plan = buildExpiredCommittedScopeExpansionPlan(fixture());
  const persistedIntent = {
    status: "intent",
    planDigest: plan.planDigest,
    sourceLeaseDigest: plan.sourceLeaseDigest,
    sourceClaimId: plan.sourceClaimId,
  };
  let calls = 0;
  const initialized = initializeExpiredCommittedScopeExpansionIntent({
    intent: null,
    plan,
    authorization: `authorize expired-committed-scope-expansion ${plan.planDigest}`,
    store: {},
    begin: options => {
      calls += 1;
      assert.equal(options.plan, plan);
      return persistedIntent;
    },
  });
  assert.equal(initialized, persistedIntent);
  assert.equal(calls, 1);
  assert.equal(initializeExpiredCommittedScopeExpansionIntent({
    intent: persistedIntent,
    plan,
    authorization: "unused-on-replay",
    store: {},
    begin: () => assert.fail("replay must not persist a second intent"),
  }), persistedIntent);
});

test("binds the successor to incorporated protected main without rewriting the replay plan", () => {
  const plan = buildExpiredCommittedScopeExpansionPlan(fixture());
  assert.equal(plan.targetCanonicalBaseSha, sourceBaseSha);
  assert.equal(resolveExpiredCommittedSuccessorCanonicalBase(plan), protectedMainSha);
  assert.equal(normalizeExpiredCommittedScopeExpansionPlan(plan).planDigest, plan.planDigest);
});

test("retires the predecessor at its fenced cloud identity, not the unpublished child", () => {
  const input = fixture();
  const plan = buildExpiredCommittedScopeExpansionPlan(input);
  assert.deepEqual(resolveExpiredCommittedSourceRetirementIdentity({
    plan,
    sourceAuthority: input.lease.cloudAuthority,
  }), {
    finalRevision: fenceSha,
    reviewRequestId: null,
  });
  assert.notEqual(plan.localHeadSha, fenceSha);
  assert.notEqual(plan.reviewRequestId, null);
});

function fixture() {
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "native-marketplace",
    declaredWriteSet: sourceWriteSet,
    writeSetDigest: digestValue(sourceWriteSet),
    manifestDigest: "c".repeat(64),
    existingLaneStateDigest: "d".repeat(64),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: "codex-native-marketplace",
    device: "test-device",
    scope: "native-marketplace",
    branch: "agent/test-device/native-marketplace",
    worktreePath: "/tmp/native-marketplace",
    baseSha: sourceBaseSha,
    fenceSha,
    pullRequestUrl: "https://github.com/example/repo/pull/1",
    admission,
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      claimId: sourceClaimId,
      claimDigest: sourceClaimDigest,
      laneRevision: fenceSha,
      reviewRequestId: null,
    },
    expiresAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    lease,
    sourceClaim: {
      claimId: sourceClaimId,
      fenceRevision: sourceClaimDigest,
      transitionCounter: 9,
      state: "parked",
      laneRevision: fenceSha,
      writeSetDigest: admission.writeSetDigest,
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
    headSha,
    localHeadTreeSha: treeSha,
    parentSha: fenceSha,
    remoteHeadSha: fenceSha,
    pullRequest: {
      id: "PR_test",
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: true,
      headRefOid: fenceSha,
    },
    authoredPaths: ["docs/runtime.md", "src/marketplace.ts"],
    targetManifest: {
      semanticScope: "native-marketplace",
      declaredWriteSet: targetWriteSet,
      writeSetDigest: digestValue(targetWriteSet),
      manifestDigest: "e".repeat(64),
    },
    protectedMainIncorporationProof: proof(),
    evaluatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function proof() {
  const core = {
    schema: "agentic-protected-main-incorporated-fence/v1",
    sourceBaseSha,
    protectedMainSha,
    protectedMainTreeSha: "7".repeat(40),
    fenceSha,
    fenceTreeSha: "8".repeat(40),
    sourceBaseAncestorOfProtectedMain: true,
    protectedMainAncestorOfFence: true,
    protectedMainChangedPaths: ["src/protected-main.ts"],
    protectedMainChangedPathsDigest: digestValue(["src/protected-main.ts"]),
  };
  return { ...core, evidenceDigest: digestValue(core) };
}
