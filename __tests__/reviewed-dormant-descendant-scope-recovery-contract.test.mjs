import assert from "node:assert/strict";
import test from "node:test";

import { digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  PHASES,
  authorizeReviewedDormantDescendantScopeRecovery,
  buildReviewedDormantDescendantScopeRecoveryPlan,
  normalizeReviewedDormantDescendantScopeRecoveryIntent,
  normalizeReviewedDormantDescendantScopeRecoveryPlan,
} from "../scripts/reviewed-dormant-descendant-scope-recovery-contract.mjs";
import {
  createReviewedDormantDescendantScopeRecoveryController,
} from "../scripts/reviewed-dormant-descendant-scope-recovery-controller.mjs";
import {
  EVIDENCE_SCHEMA,
  PROTECTED_MAIN_PROOF_SCHEMA,
  deriveReviewedDormantDescendantTargetManifest,
  normalizeReviewedDormantDescendantScopeRecoveryEvidence,
  sealReviewedDormantDescendantScopeRecoveryEvidence,
} from "../scripts/reviewed-dormant-descendant-scope-recovery-evidence.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function manifest(paths = ["a.js", "shared.js"]) {
  return {
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "scope",
    paths,
  };
}

function fixture(overrides = {}) {
  const branch = "agent/device/scope";
  const sourceSessionId = "session:source";
  const reviewedHeadSha = sha("1");
  const localHeadSha = sha("7");
  const descendantCommits = ["2", "3", "4", "5", "6", "7"].map(sha);
  const descendantPaths = ["a.js", "b.js"];
  const sourceManifest = manifest();
  const targetManifest = deriveReviewedDormantDescendantTargetManifest({
    sourceManifest,
    descendantPaths,
  });
  const sourceLease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    branch,
    scope: "scope",
    sessionId: sourceSessionId,
    fenceSha: reviewedHeadSha,
    admission: { status: "planned" },
  };
  const sourceClaim = {
    claimId: digest("1"),
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    transitionCounter: 3,
    leaseEpoch: 1,
    sessionId: sourceSessionId,
    laneRevision: reviewedHeadSha,
    canonicalBaseRevision: sha("c"),
    declaredWriteScope: targetManifest.declaredWriteSet.filter(item => item !== "path:b.js"),
    writeSetDigest: digestValue(
      targetManifest.declaredWriteSet.filter(item => item !== "path:b.js"),
    ),
    reviewRequestId: "github-pull-request:PR_node",
  };
  const proofCore = {
    schema: PROTECTED_MAIN_PROOF_SCHEMA,
    sourceBaseSha: sha("c"),
    sourceBaseTreeSha: sha("a"),
    protectedMainSha: sha("d"),
    protectedMainTreeSha: sha("b"),
    sourceBaseAncestorOfProtectedMain: true,
    changedPaths: ["canonical.js"],
    changedPathsDigest: digestValue(["canonical.js"]),
    targetWriteSetDigest: targetManifest.writeSetDigest,
    overlap: "none",
  };
  return sealReviewedDormantDescendantScopeRecoveryEvidence({
    schema: EVIDENCE_SCHEMA,
    repository: { fullName: "owner/repository", nodeId: "R_node" },
    branch,
    sourceSessionId,
    sourceLease,
    sourceLeaseDigest: digestValue(sourceLease),
    taskCapabilityDigest: digest("2"),
    sourceClaim,
    sourceClaimDigest: digestValue(sourceClaim),
    cloudInventoryDigest: digest("3"),
    overlapClaimIds: [],
    pullRequest: {
      id: "PR_node",
      number: 816,
      url: "https://github.com/owner/repository/pull/816",
      state: "OPEN",
      isDraft: false,
      autoMergeRequest: null,
      headBranch: branch,
      headSha: reviewedHeadSha,
      baseSha: sha("c"),
      bodyDigest: digest("4"),
      bodyRemainderDigest: digest("5"),
      markerDigest: digest("6"),
    },
    reviewedHeadSha,
    reviewedTreeSha: sha("8"),
    localHeadSha,
    localTreeSha: sha("9"),
    remoteHeadSha: reviewedHeadSha,
    descendantCommits,
    descendantCommitsDigest: digestValue(descendantCommits),
    descendantPaths,
    descendantPathsDigest: digestValue(descendantPaths),
    descendantPatchDigest: digest("7"),
    sourceManifest,
    targetManifest,
    protectedMainProof: { ...proofCore, evidenceDigest: digestValue(proofCore) },
    gitSnapshot: {
      headSha: localHeadSha,
      indexTreeSha: sha("9"),
      statusDigest: digest("8"),
      localRefSha: localHeadSha,
      remoteRefSha: reviewedHeadSha,
      clean: true,
    },
    observedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  });
}

function terminal(plan, verificationCharacter = "e", overrides = {}) {
  return {
    sourceClaimId: plan.sourceClaimId,
    successorClaimId: digest("9"),
    successorClaimDigest: digest("0"),
    taskAuthorityReceiptDigest: digest("b"),
    leaseDigest: digest("c"),
    pullRequestDigest: digest("d"),
    verificationDigest: digest(verificationCharacter),
    headSha: plan.localHeadSha,
    indexTreeSha: plan.evidence.localTreeSha,
    localRefSha: plan.localHeadSha,
    remoteRefSha: plan.reviewedHeadSha,
    authoringAuthorityRestored: true,
    sourceBytesChanged: false,
    committed: false,
    pushed: false,
    refRewritten: false,
    merged: false,
    deployed: false,
    cleaned: false,
    integrationAuthorityRestored: false,
    ...overrides,
  };
}

test("evidence derives only the exact uncovered reviewed-descendant scope", () => {
  const value = fixture();
  assert.deepEqual(normalizeReviewedDormantDescendantScopeRecoveryEvidence(value), value);
  assert.deepEqual(
    value.targetManifest.declaredWriteSet.filter(item => !value.sourceManifest.declaredWriteSet.includes(item)),
    ["path:b.js"],
  );
  assert.throws(() => sealReviewedDormantDescendantScopeRecoveryEvidence({
    ...value,
    targetManifest: manifest(["a.js", "b.js", "extra.js", "shared.js"]),
  }), /exact target manifest/u);
  assert.throws(() => sealReviewedDormantDescendantScopeRecoveryEvidence({
    ...value,
    overlapClaimIds: [digest("f")],
  }), /overlap claim IDs/u);
});

test("plan seals the exact literal, six commits, target manifest, and forbidden effects", () => {
  const plan = buildReviewedDormantDescendantScopeRecoveryPlan({
    evidence: fixture(),
    operatorSessionId: "session:operator",
    ttlSeconds: 120,
  });
  assert.deepEqual(normalizeReviewedDormantDescendantScopeRecoveryPlan(plan), plan);
  assert.equal(
    plan.exactAuthorization,
    `authorize reviewed-dormant-descendant-scope-recovery ${plan.planDigest}`,
  );
  assert.equal(plan.successorLeaseEpoch, 2);
  assert.equal(plan.descendantCommitsDigest, digestValue(plan.evidence.descendantCommits));
  assert.ok(plan.forbiddenEffects.includes("push"));
  assert.ok(plan.forbiddenEffects.includes("ref-rewrite"));
  assert.equal(authorizeReviewedDormantDescendantScopeRecovery({
    plan,
    authorization: plan.exactAuthorization,
  }).planDigest, plan.planDigest);
  assert.throws(() => authorizeReviewedDormantDescendantScopeRecovery({
    plan,
    authorization: "authorize recovery",
  }), /exact authorization/u);
});

test("controller journals every phase and freshly verifies before complete and replay", async () => {
  const evidence = fixture();
  let stored = null;
  let verifies = 0;
  const effects = {
    authorizeTaskAuthority: { taskAuthorityReceiptDigest: digest("b") },
    createWaitingSuccessor: {
      claimId: digest("9"), claimDigest: digest("8"), transitionCounter: 1,
      operationReceiptDigest: digest("1"),
    },
    retireSourceClaim: {
      sourceClaimId: evidence.sourceClaim.claimId,
      sourceRetirementReceiptDigest: digest("2"),
    },
    promoteSuccessor: {
      claimId: digest("9"), claimDigest: digest("a"), transitionCounter: 2,
      operationReceiptDigest: digest("3"),
    },
    bindSuccessor: {
      claimId: digest("9"), claimDigest: digest("0"), transitionCounter: 3,
      operationReceiptDigest: digest("4"), taskAuthorityReceiptDigest: digest("b"),
    },
    projectLocalLease: { leaseDigest: digest("c") },
    projectDraftPullRequest: { pullRequestDigest: digest("d") },
  };
  let controller;
  const adapter = {
    withFence: action => action(),
    captureEvidence: async () => evidence,
    readIntent: async () => stored,
    writeIntent: async ({ expected, value }) => {
      assert.equal(digestValue(stored), digestValue(expected));
      stored = value;
    },
    reconcilePhase: async () => null,
    verifyTerminal: async ({ plan }) => terminal(plan, verifies++ === 0 ? "e" : "f"),
  };
  for (const [method, values] of Object.entries(effects)) {
    adapter[method] = async () => structuredClone(values);
  }
  controller = createReviewedDormantDescendantScopeRecoveryController({ adapter });
  const plan = await controller.plan({ operatorSessionId: "session:operator", ttlSeconds: 120 });
  const completion = await controller.run({
    plan,
    operatorSessionId: "session:operator",
    authorization: plan.exactAuthorization,
  });
  assert.equal(stored.phase, "complete");
  assert.deepEqual(Object.keys(stored.receipts), PHASES);
  assert.equal(completion.status, "authoring-authority-restored");
  assert.equal(completion.verificationDigest, digest("f"));
  assert.equal(completion.pushed, false);
  assert.equal(verifies, 2);
  assert.deepEqual(normalizeReviewedDormantDescendantScopeRecoveryIntent(stored), stored);

  const replay = await controller.run({
    plan,
    operatorSessionId: "session:operator",
    authorization: plan.exactAuthorization,
  });
  assert.equal(replay.verificationDigest, digest("f"));
  assert.equal(verifies, 3);
});

test("complete replay rejects stable terminal authority drift", async () => {
  const evidence = fixture();
  let stored = null;
  let drift = false;
  const adapter = {
    withFence: action => action(), captureEvidence: async () => evidence,
    readIntent: async () => stored,
    writeIntent: async ({ value }) => { stored = value; },
    reconcilePhase: async () => null,
    authorizeTaskAuthority: async () => ({ taskAuthorityReceiptDigest: digest("b") }),
    createWaitingSuccessor: async () => ({ claimId: digest("9"), claimDigest: digest("8"),
      transitionCounter: 1, operationReceiptDigest: digest("1") }),
    retireSourceClaim: async () => ({ sourceClaimId: evidence.sourceClaim.claimId,
      sourceRetirementReceiptDigest: digest("2") }),
    promoteSuccessor: async () => ({ claimId: digest("9"), claimDigest: digest("a"),
      transitionCounter: 2, operationReceiptDigest: digest("3") }),
    bindSuccessor: async () => ({ claimId: digest("9"), claimDigest: digest("0"),
      transitionCounter: 3, operationReceiptDigest: digest("4"),
      taskAuthorityReceiptDigest: digest("b") }),
    projectLocalLease: async () => ({ leaseDigest: digest("c") }),
    projectDraftPullRequest: async () => ({ pullRequestDigest: digest("d") }),
    verifyTerminal: async ({ plan }) => terminal(plan, "e", drift
      ? { successorClaimDigest: digest("f") } : {}),
  };
  const controller = createReviewedDormantDescendantScopeRecoveryController({ adapter });
  const plan = await controller.plan({ operatorSessionId: "session:operator" });
  await controller.run({ plan, operatorSessionId: "session:operator",
    authorization: plan.exactAuthorization });
  drift = true;
  await assert.rejects(() => controller.run({ plan, operatorSessionId: "session:operator",
    authorization: plan.exactAuthorization }), /changed stable authority/u);
});
