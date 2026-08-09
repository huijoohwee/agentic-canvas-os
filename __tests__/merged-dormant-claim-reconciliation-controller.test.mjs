// Responsibility: prove durable exact-authority orchestration and effect replay safety.
import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  createMergedDormantClaimReconciliationController,
} from "../scripts/merged-dormant-claim-reconciliation-controller.mjs";
import {
  buildMergedDormantClaimReconciliationSourceEvidence,
} from "../scripts/merged-dormant-claim-reconciliation-evidence.mjs";
import { createRepositoryMergedDormantClaimCloudActions } from "../scripts/merged-dormant-claim-reconciliation-repository-adapter.mjs";
import {
  mergedDormantClaimReconciliationOperationKey,
} from "../scripts/merged-dormant-claim-reconciliation-contract.mjs";

const BASE_SHA = "1".repeat(40);
const FENCE_SHA = "8".repeat(40);
const BASE_TREE_SHA = "9".repeat(40);
const HEAD_SHA = "2".repeat(40);
const TREE_SHA = "3".repeat(40);
const MERGE_SHA = "4".repeat(40);
const MAIN_SHA = "5".repeat(40);
const PULL_HEAD_SHA = "7".repeat(40);
const SCOPE_TREE_DIGEST = "7".repeat(64);
const CLAIM_DIGEST = "b".repeat(64);
const TRANSITION_DIGEST = "c".repeat(64);
const OPERATION_RECEIPT_DIGEST = "d".repeat(64);
const LEDGER_REVISION = "6".repeat(40);
const LEDGER_DIGEST = "e".repeat(64);
const REVIEW_EVIDENCE_DIGEST = "f".repeat(64);
const REPOSITORY_ID = "github-repository:R_example";
const REPOSITORY = "example/agentic-canvas-os";
const BRANCH = "agent/device/merged-lane";
const PULL_REQUEST_NODE_ID = "PR_example";
const PULL_REQUEST_URL = "https://github.com/example/agentic-canvas-os/pull/355";
const DEVICE = "device-example";
const SESSION = "session-example";
const CLOUD_DEVICE_ID = pseudonymousIdentifier("device", DEVICE);
const CLOUD_SESSION_ID = pseudonymousIdentifier("session", SESSION);
const WRITE_SCOPE = Object.freeze([
  "path:scripts/merged-dormant-claim-reconciliation-controller.mjs",
]);
const CLAIM_ID = digestValue({
  actorId: "github-user:example",
  canonicalBaseRevision: BASE_SHA,
  leaseEpoch: 3,
  repositoryId: REPOSITORY_ID,
  workItemId: "merged-dormant-claim-reconciliation",
  writeSetDigest: digestValue(WRITE_SCOPE),
});
const EFFECTS = Object.freeze([
  ["recovered", "recoverDormant"],
  ["integrated", "integrateReviewed"],
  ["retired", "retireIntegrated"],
]);
const observePhase = createRepositoryMergedDormantClaimCloudActions({
  ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
}).observePhase;

test("plan is read-only and returns one exact authorization-bound plan", async () => {
  const harness = createHarness();
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const result = await controller.plan();

  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, result.plan.planDigest);
  assert.equal(
    result.exactAuthorization,
    `authorize merged-dormant-claim-reconciliation ${result.planDigest}`,
  );
  assert.deepEqual(harness.counts, {
    effects: 0,
    fences: 0,
    intentReads: 1,
    sourceReads: 1,
    claimReads: 0,
    writes: 0,
  });
});

test("rejects non-exact authorization before durable or repository effects", async () => {
  const harness = createHarness();
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();

  await assert.rejects(
    controller.run({
      authorization: "authorize merged-dormant-claim-reconciliation wrong",
      planDigest: planned.planDigest,
    }),
    /requires exact authorization/u,
  );
  assert.equal(harness.intent, null);
  assert.equal(harness.counts.writes, 0);
  assert.equal(harness.counts.effects, 0);
});

test("persists authorized through complete in exact effect order", async () => {
  const harness = createHarness();
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  const result = await controller.run({
    authorization: planned.exactAuthorization,
    planDigest: planned.planDigest,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.planDigest, planned.planDigest);
  assert.equal(result.receipt.planDigest, planned.planDigest);
  assert.equal(
    harness.intent.phases.complete.values.operationKey,
    result.receipt.operationKey,
  );
  assert.equal(
    harness.intent.phases.complete.values.evidenceDigest,
    result.receipt.evidenceDigest,
  );
  assert.deepEqual(harness.effectNames, EFFECTS.map(([, method]) => method));
  assert.deepEqual(harness.persistedStatuses, [
    "authorized",
    "prepared",
    "recovered",
    "integrated",
    "retired",
    "complete",
  ]);
  assert.equal(harness.intent.status, "complete");
});

test("reconciles a lost response after every effect without replaying it", async (context) => {
  for (const [, method] of EFFECTS) {
    await context.test(method, async () => {
      const harness = createHarness({ failAfterEffect: method });
      const controller = createMergedDormantClaimReconciliationController({
        adapter: harness.adapter,
      });
      const planned = await controller.plan();
      const result = await controller.run({
        authorization: planned.exactAuthorization,
        planDigest: planned.planDigest,
      });

      assert.equal(result.status, "complete");
      assert.equal(
        harness.effectNames.filter(value => value === method).length,
        1,
      );
      await controller.run({
        authorization: planned.exactAuthorization,
        planDigest: planned.planDigest,
      });
      assert.equal(
        harness.effectNames.filter(value => value === method).length,
        1,
      );
    });
  }
});

test("resumes after every post-effect intent persistence crash", async (context) => {
  for (const [phase, method] of EFFECTS) {
    await context.test(phase, async () => {
      const harness = createHarness({ failAfterPersist: phase });
      const controller = createMergedDormantClaimReconciliationController({
        adapter: harness.adapter,
      });
      const planned = await controller.plan();
      await assert.rejects(
        controller.run({
          authorization: planned.exactAuthorization,
          planDigest: planned.planDigest,
        }),
        new RegExp(`${phase} intent response was lost`, "u"),
      );
      assert.equal(harness.intent.status, phase);
      assert.equal(harness.effectNames.filter(value => value === method).length, 1);

      const result = await controller.run({
        authorization: planned.exactAuthorization,
        planDigest: planned.planDigest,
      });
      assert.equal(result.status, "complete");
      assert.equal(harness.effectNames.filter(value => value === method).length, 1);
    });
  }
});

test("adopts an already live exact phase without repeating its effect", async () => {
  const harness = createHarness({ responseAhead: "recovered" });
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  await controller.run({
    authorization: planned.exactAuthorization,
    planDigest: planned.planDigest,
  });

  assert.equal(harness.effectNames.includes("recoverDormant"), false);
  assert.equal(harness.intent.status, "complete");
});

test("rejects same-phase evidence drift before a later effect or replay", async () => {
  const harness = createHarness({ driftAfterPersist: "recovered" });
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();

  await assert.rejects(
    controller.run({
      authorization: planned.exactAuthorization,
      planDigest: planned.planDigest,
    }),
    /evidence drifted after persistence/u,
  );
  assert.equal(harness.intent.status, "recovered");
  assert.deepEqual(harness.effectNames, ["recoverDormant"]);

  await assert.rejects(
    controller.run({
      authorization: planned.exactAuthorization,
      planDigest: planned.planDigest,
    }),
    /evidence drifted after persistence/u,
  );
  assert.deepEqual(harness.effectNames, ["recoverDormant"]);
});

test("rejects an effect response bound to a different operation key", async () => {
  const harness = createHarness({ wrongOperationKey: "recoverDormant" });
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();

  await assert.rejects(
    controller.run({
      authorization: planned.exactAuthorization,
      planDigest: planned.planDigest,
    }),
    /effect is not bound to its exact operation key/u,
  );
  assert.equal(harness.intent.status, "prepared");
  assert.deepEqual(harness.effectNames, ["recoverDormant"]);
});

test("rejects a recomputed intent whose durable terminal receipt was tampered", async () => {
  const harness = createHarness();
  const controller = createMergedDormantClaimReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  await controller.run({
    authorization: planned.exactAuthorization,
    planDigest: planned.planDigest,
  });
  const effectsBeforeReplay = [...harness.effectNames];
  const tampered = structuredClone(harness.intent);
  const receiptCore = { ...tampered.phases.complete.values.receipt };
  delete receiptCore.receiptDigest;
  receiptCore.claimId = "0".repeat(64);
  tampered.phases.complete.values.receipt = {
    ...receiptCore,
    receiptDigest: digestValue(receiptCore),
  };
  delete tampered.intentDigest;
  tampered.intentDigest = digestValue(tampered);
  harness.replaceIntent(tampered);

  await assert.rejects(
    controller.run({
      authorization: planned.exactAuthorization,
      planDigest: planned.planDigest,
    }),
    /receipt|drift/iu,
  );
  assert.deepEqual(harness.effectNames, effectsBeforeReplay);
});

function createHarness({
  driftAfterPersist = null,
  failAfterEffect = null,
  failAfterPersist = null,
  responseAhead = null,
  wrongOperationKey = null,
} = {}) {
  const source = sourceEvidence();
  let livePhase = responseAhead || "prepared";
  const failed = new Set();
  const effectNames = [];
  const persistedStatuses = [];
  let intent = null;
  const counts = {
    effects: 0,
    fences: 0,
    intentReads: 0,
    sourceReads: 0,
    claimReads: 0,
    writes: 0,
  };
  const harness = {
    counts,
    effectNames,
    persistedStatuses,
    get intent() { return intent; },
    replaceIntent(value) { intent = value; },
  };
  const methods = {
    async withEntrypointFence(_subject, action) {
      counts.fences += 1;
      return action(Object.freeze({ fenceDigest: "9".repeat(64) }));
    },
    async readSourceEvidence() {
      counts.sourceReads += 1;
      return source;
    },
    async readIntent() {
      counts.intentReads += 1;
      return intent;
    },
    async writeIntent({ expectedIntent, nextIntent }) {
      counts.writes += 1;
      assert.equal(expectedIntent?.intentDigest || null, intent?.intentDigest || null);
      intent = nextIntent;
      persistedStatuses.push(intent.status);
      if (intent.status === failAfterPersist && !failed.has(`persist:${intent.status}`)) {
        failed.add(`persist:${intent.status}`);
        throw new Error(`${intent.status} intent response was lost`);
      }
      return intent;
    },
    async readClaim({ intent: observedIntent, operationKey, phase, plan }) {
      counts.claimReads += 1;
      const drifted = phase === driftAfterPersist && observedIntent.status === phase;
      return observePhase({
        intent: observedIntent,
        live: livePhaseEvidence({
          drifted,
          intent: observedIntent,
          phase: livePhase,
          plan,
        }),
        operationKey,
        phase,
        plan,
      });
    },
  };
  for (const [phase, method] of EFFECTS) {
    methods[method] = async ({ operationKey }) => {
      counts.effects += 1;
      effectNames.push(method);
      livePhase = phase;
      if (method === failAfterEffect && !failed.has(method)) {
        failed.add(method);
        throw new Error(`${method} response was lost`);
      }
      return {
        operationKey: method === wrongOperationKey ? "wrong-operation-key" : operationKey,
      };
    };
  }
  harness.adapter = Object.freeze(methods);
  return harness;
}

function sourceEvidence() {
  const writeSetDigest = digestValue(WRITE_SCOPE);
  const claim = {
    claimId: CLAIM_ID,
    claimDigest: CLAIM_DIGEST,
    transitionDigest: TRANSITION_DIGEST,
    operationReceiptDigest: OPERATION_RECEIPT_DIGEST,
    ledgerRevision: LEDGER_REVISION,
    ledgerDigest: LEDGER_DIGEST,
    state: "dormant-preserved",
    recordedState: "reviewed",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:example",
    deviceId: CLOUD_DEVICE_ID,
    sessionId: CLOUD_SESSION_ID,
    repositoryId: REPOSITORY_ID,
    workItemId: "merged-dormant-claim-reconciliation",
    canonicalBaseRevision: BASE_SHA,
    laneRevision: HEAD_SHA,
    declaredWriteScope: WRITE_SCOPE,
    writeSetDigest,
    leaseEpoch: 3,
    transitionCounter: 7,
    reviewRequestId: `github-pull-request:${PULL_REQUEST_NODE_ID}`,
    evidenceDigest: REVIEW_EVIDENCE_DIGEST,
    integration: null,
    integrationReceiptDigest: null,
  };
  const provider = {
    provider: "github",
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    pullRequest: {
      number: 355,
      nodeId: PULL_REQUEST_NODE_ID,
      url: PULL_REQUEST_URL,
      state: "CLOSED",
      draft: false,
      merged: true,
      headRepository: REPOSITORY,
      headBranch: BRANCH,
      headSha: PULL_HEAD_SHA,
      headTreeSha: TREE_SHA,
      baseRepository: REPOSITORY,
      baseBranch: "main",
      mergeCommitSha: MERGE_SHA,
      mergeCommitTreeSha: TREE_SHA,
    },
    claimHead: {
      sha: HEAD_SHA,
      treeSha: TREE_SHA,
      scopeTreeDigest: SCOPE_TREE_DIGEST,
    },
    protectedMain: { branch: "main", sha: MAIN_SHA, treeSha: TREE_SHA },
    ancestry: {
      claimHeadIsAncestorOfPullRequestHead: true,
      mergeCommitIsAncestorOfProtectedMain: true,
    },
    refreshChain: [{
      sha: PULL_HEAD_SHA,
      treeSha: TREE_SHA,
      scopeTreeDigest: SCOPE_TREE_DIGEST,
      parents: [HEAD_SHA, BASE_SHA],
      secondParentIsAncestorOfProtectedMain: true,
    }],
    mergeCommitParents: [BASE_SHA],
    mergeChangedPaths: [
      "scripts/merged-dormant-claim-reconciliation-controller.mjs",
    ],
    requiredChecks: [{ context: "test", appId: 1 }],
    checkRuns: [HEAD_SHA, PULL_HEAD_SHA, MERGE_SHA].map(headSha => ({
      name: "test", appId: 1, headSha,
      status: "COMPLETED", conclusion: "SUCCESS",
    })),
  };
  const local = {
    worktreePath: "/workspace/merged-lane",
    registered: true,
    attached: true,
    clean: true,
    branch: BRANCH,
    headSha: HEAD_SHA,
    treeSha: TREE_SHA,
    indexDigest: "1".repeat(64),
    workingTreeDigest: "2".repeat(64),
    stateDigest: "3".repeat(64),
    fenceIsAncestorOfReviewHead: true,
    remote: { name: "origin", branchPresent: false },
    lineage: {
      fence: {
        sha: FENCE_SHA, treeSha: BASE_TREE_SHA,
        parentSha: BASE_SHA, parentTreeSha: BASE_TREE_SHA,
      },
      reviewedHead: {
        sha: HEAD_SHA, treeSha: TREE_SHA, parentSha: FENCE_SHA,
        changedPaths: ["scripts/merged-dormant-claim-reconciliation-controller.mjs"],
      },
    },
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "review_ready",
      epoch: 3,
      sessionId: SESSION,
      device: DEVICE,
      scope: "merged-dormant-claim-reconciliation",
      branch: BRANCH,
      baseSha: BASE_SHA,
      fenceSha: FENCE_SHA,
      reviewHeadSha: HEAD_SHA,
      pullRequestUrl: PULL_REQUEST_URL,
      leaseDigest: "4".repeat(64),
      cloudAuthority: {
        claimId: CLAIM_ID,
        claimDigest: CLAIM_DIGEST,
        ledgerRevision: LEDGER_REVISION,
        ledgerDigest: LEDGER_DIGEST,
        claimLedgerRevision: TRANSITION_DIGEST,
        operationReceiptDigest: OPERATION_RECEIPT_DIGEST,
        deviceId: DEVICE,
        sessionId: SESSION,
        canonicalBaseSha: BASE_SHA,
        laneRevision: HEAD_SHA,
        writeSetDigest,
        reviewRequestId: `github-pull-request:${PULL_REQUEST_NODE_ID}`,
        focusedEvidenceDigest: REVIEW_EVIDENCE_DIGEST,
        leaseEpoch: 3,
        transitionCounter: 7,
        state: "dormant-preserved",
        integrationReceiptDigest: null,
        integration: null,
      },
    },
  };
  return buildMergedDormantClaimReconciliationSourceEvidence({ claim, provider, local });
}

function livePhaseEvidence({ drifted, intent, phase, plan }) {
  const phases = ["prepared", "recovered", "integrated", "retired"];
  const index = phases.indexOf(phase);
  assert.notEqual(index, -1);
  const recovered = index >= 1;
  const integrated = index >= 2;
  const retired = index >= 3;
  const integrationReceiptDigest = integrated
    ? digestValue({ planDigest: plan.planDigest, receipt: "integration" })
    : null;
  const recovery = recovered ? {
    evidenceDigest: mergedDormantClaimReconciliationOperationKey(plan, "recovered"),
    recoveredAt: drifted && phase === "recovered"
      ? "2030-01-01T00:00:02.000Z"
      : "2030-01-01T00:00:01.000Z",
  } : null;
  const integration = integrated ? {
    candidateRevision: plan.claimLaneRevision,
    reviewRequestId: plan.claimReviewRequestId,
    focusedEvidenceDigest: plan.claimFocusedEvidenceDigest,
    dependencyClosureDigest: plan.dependencyClosureDigest,
    namedChecksDigest: plan.namedChecksDigest,
    handoffEvidenceDigest: plan.handoffEvidenceDigest,
    operatorDecisionDigest: intent.authorizationDigest,
    integrationIntentDigest: mergedDormantClaimReconciliationOperationKey(
      plan,
      "integrated",
    ),
    integratedAt: drifted && phase === "integrated"
      ? "2030-01-01T00:00:04.000Z"
      : "2030-01-01T00:00:03.000Z",
  } : null;
  const retirement = retired ? {
    reason: plan.retirementReason,
    finalRevision: plan.finalRevision,
    reviewRequestId: plan.claimReviewRequestId,
    bytesDigest: plan.bytesDigest,
    namedChecksDigest: plan.namedChecksDigest,
    handoffEvidenceDigest: plan.handoffEvidenceDigest,
    integrationReceiptDigest,
    retiredAt: drifted
      ? "2030-01-01T00:00:06.000Z"
      : "2030-01-01T00:00:05.000Z",
  } : null;
  const states = ["dormant-preserved", "reviewed", "integrated-preserved", "retired"];
  const ledgerRevisions = [plan.expectedLedgerRevision,
    "8".repeat(40), "9".repeat(40), "a".repeat(40)];
  return {
    result: {
      ledgerRevision: ledgerRevisions[index],
      ledgerDigest: index === 0
        ? plan.expectedLedgerDigest
        : digestValue({ planDigest: plan.planDigest, phase, type: "ledger" }),
    },
    claim: {
      claimId: plan.claimId,
      state: states[index],
      recordedState: states[index] === "dormant-preserved" ? "reviewed" : states[index],
      writeAuthority: false,
      scopeReserved: !retired,
      actorId: plan.actorId,
      repositoryId: plan.repositoryId,
      workItemId: plan.workItemId,
      deviceId: plan.expectedCloudDeviceId,
      sessionId: plan.expectedCloudSessionId,
      canonicalBaseRevision: plan.canonicalBaseRevision,
      laneRevision: plan.claimLaneRevision,
      writeSetDigest: plan.claimWriteSetDigest,
      leaseEpoch: plan.claimLeaseEpoch,
      transitionCounter: plan.expectedTransitionCounter + index,
      reviewRequestId: plan.claimReviewRequestId,
      evidenceDigest: plan.claimFocusedEvidenceDigest,
      fenceRevision: index === 0
        ? plan.claimDigest
        : digestValue({ planDigest: plan.planDigest, phase, type: "fence" }),
      transitionDigest: index === 0
        ? plan.claimTransitionDigest
        : digestValue({ planDigest: plan.planDigest, phase, type: "transition" }),
      operationReceiptDigest: index === 0
        ? plan.claimOperationReceiptDigest
        : digestValue({ planDigest: plan.planDigest, phase, type: "operation" }),
      recovery,
      integration,
      integrationReceiptDigest,
      retirement,
    },
  };
}
