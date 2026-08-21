// Responsibility: verify exact source joins, protected refresh topology, and phase-stable merged dormant reconciliation evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceMergedDormantClaimReconciliationIntent,
  authorizeMergedDormantClaimReconciliation,
  buildMergedDormantClaimReconciliationPlan,
  createMergedDormantClaimReconciliationIntent,
  mergedDormantClaimReconciliationOperationKey,
} from "../scripts/merged-dormant-claim-reconciliation-contract.mjs";
import {
  assertMergedDormantClaimReconciliationSourceEvidence,
  buildMergedDormantClaimReconciliationPhaseObservation,
  buildMergedDormantClaimReconciliationSourceEvidence,
  classifyMergedDormantClaimReconciliationPhase,
} from "../scripts/merged-dormant-claim-reconciliation-evidence.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";

const instant = "2026-08-09T16:00:00.000Z";
const digest = label => digestValue({ label });
const sha = label => digestValue({ sha: label }).slice(0, 40);

test("joins historical local authority to the hydrated dormant claim and merged provider proof", () => {
  const raw = sourceFixture();
  const evidence = buildMergedDormantClaimReconciliationSourceEvidence(raw);
  assert.deepEqual(assertMergedDormantClaimReconciliationSourceEvidence(evidence), evidence);
  assert.equal(evidence.local.lease.fenceSha, raw.local.lineage.fence.sha);
  assert.notEqual(evidence.local.lease.cloudAuthority.ledgerDigest, evidence.claim.ledgerDigest);
  assert.equal(evidence.local.lease.cloudAuthority.state, "review_ready");
  assert.equal(evidence.provider.checkRuns.find(run => run.headSha === sha("refresh-one")).conclusion, "FAILURE");
  assert.match(evidence.sourceEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.refreshTopologyDigest, /^[0-9a-f]{64}$/u);
});

test("rejects source identity, owner mapping, fence lineage, and stored-authority corruption", () => {
  const cases = [
    raw => { raw.claim.claimId = digest("forged-claim"); },
    raw => { raw.local.lease.cloudAuthority.deviceId = "other-device"; },
    raw => { raw.local.lineage.fence.treeSha = sha("changed-fence-tree"); },
    raw => { raw.local.lineage.reviewedHead.parentSha = sha("unrelated-parent"); },
    raw => { raw.local.lineage.reviewedHead.changedPaths = ["outside/file.ts"]; },
    raw => { raw.local.lease.cloudAuthority.claimDigest = digest("stale-immutable-fence"); },
  ];
  for (const corrupt of cases) {
    const raw = sourceFixture();
    corrupt(raw);
    assert.throws(() => buildMergedDormantClaimReconciliationSourceEvidence(raw));
  }
});

test("rejects authored refresh bytes, malformed squash topology, escaped paths, and final check drift", () => {
  const cases = [
    raw => { raw.provider.refreshChain[0].scopeTreeDigest = digest("authored-byte-change"); },
    raw => { raw.provider.refreshChain[1].parents[0] = raw.claim.laneRevision; },
    raw => { raw.provider.mergeCommitParents = [sha("wrong-squash-parent")]; },
    raw => { raw.provider.mergeChangedPaths = ["outside/file.ts"]; },
    raw => { raw.provider.checkRuns.find(run => run.headSha === raw.provider.pullRequest.headSha).conclusion = "FAILURE"; },
  ];
  for (const corrupt of cases) {
    const raw = sourceFixture();
    corrupt(raw);
    assert.throws(() => buildMergedDormantClaimReconciliationSourceEvidence(raw));
  }
});

test("accepts only an exact reviewed-head squash when no refresh commit exists", () => {
  const direct = directMergeFixture();
  const evidence = buildMergedDormantClaimReconciliationSourceEvidence(direct);
  assert.deepEqual(evidence.provider.refreshChain, []);
  for (const corrupt of [
    raw => { raw.provider.pullRequest.headSha = sha("different-head"); },
    raw => { raw.provider.pullRequest.headTreeSha = sha("different-tree"); },
    raw => { raw.provider.mergeCommitParents = [sha("different-base")]; },
  ]) {
    const raw = directMergeFixture();
    corrupt(raw);
    assert.throws(() => buildMergedDormantClaimReconciliationSourceEvidence(raw));
  }
});

test("joins a completed absent worktree only through its retained local ref and completion chain", () => {
  const evidence = buildMergedDormantClaimReconciliationSourceEvidence(completedAbsentFixture());
  assert.equal(evidence.local.mode, "completed-absent");
  assert.equal(evidence.local.absence.localBranchPresent, true);
  assert.equal(evidence.preservation.localBranch, "retained-ref");
  assert.equal(evidence.provider.completion.mainIsAncestorOfProtectedMain, true);
  const cases = [
    raw => { delete raw.provider.completion; },
    raw => { raw.local.absence.localBranchPresent = false; },
    raw => { raw.local.absence.matchingLeaseCount = 2; },
    raw => { raw.local.canonicalAnchor.sha = sha("stale-main"); },
    raw => { raw.local.lease.completion.mainSha = sha("other-completion-main"); },
  ];
  for (const corrupt of cases) {
    const raw = completedAbsentFixture();
    corrupt(raw);
    assert.throws(() => buildMergedDormantClaimReconciliationSourceEvidence(raw));
  }
  const attached = sourceFixture();
  attached.provider.completion = {
    mainSha: sha("unexpected-completion-main"), treeSha: sha("unexpected-completion-tree"),
    mergeCommitIsAncestor: true, mainIsAncestorOfProtectedMain: true,
  };
  assert.throws(() => buildMergedDormantClaimReconciliationSourceEvidence(attached));
});

test("classifies exact predecessors pending and keeps earlier evidence stable after later transitions", () => {
  const plan = buildMergedDormantClaimReconciliationPlan(
    buildMergedDormantClaimReconciliationSourceEvidence(sourceFixture()),
  );
  const authorization = authorizeMergedDormantClaimReconciliation({
    plan,
    authorization: plan.exactAuthorization,
  });
  let intent = createMergedDormantClaimReconciliationIntent({ plan, authorizationReceipt: authorization });
  const prepared = classifyAndObserve({ plan, intent, phase: "prepared", live: liveAt(plan, "prepared", authorization.authorizationDigest) });
  intent = advance(intent, "prepared", prepared);

  const pending = classifyAndObserve({ plan, intent, phase: "recovered", live: liveAt(plan, "prepared", authorization.authorizationDigest) });
  assert.equal(pending.state, "pending");
  const recovered = classifyAndObserve({ plan, intent, phase: "recovered", live: liveAt(plan, "recovered", authorization.authorizationDigest) });
  intent = advance(intent, "recovered", recovered);
  const integrated = classifyAndObserve({ plan, intent, phase: "integrated", live: liveAt(plan, "integrated", authorization.authorizationDigest) });
  intent = advance(intent, "integrated", integrated);
  const retired = classifyAndObserve({ plan, intent, phase: "retired", live: liveAt(plan, "retired", authorization.authorizationDigest) });
  intent = advance(intent, "retired", retired);

  const recoveredReplay = classifyAndObserve({ plan, intent, phase: "recovered", live: liveAt(plan, "retired", authorization.authorizationDigest) });
  const integratedReplay = classifyAndObserve({ plan, intent, phase: "integrated", live: liveAt(plan, "retired", authorization.authorizationDigest) });
  assert.equal(recoveredReplay.evidenceDigest, recovered.evidenceDigest);
  assert.equal(integratedReplay.evidenceDigest, integrated.evidenceDigest);
  assert.equal(integratedReplay.integrationReceiptDigest, integrated.integrationReceiptDigest);
});

test("fails closed on recovery, owner, integration, and retirement live drift", () => {
  const plan = buildMergedDormantClaimReconciliationPlan(
    buildMergedDormantClaimReconciliationSourceEvidence(sourceFixture()),
  );
  const authorization = authorizeMergedDormantClaimReconciliation({ plan, authorization: plan.exactAuthorization });
  const intent = createMergedDormantClaimReconciliationIntent({ plan, authorizationReceipt: authorization });
  const cases = [
    ["recovered", live => { live.claim.recovery.evidenceDigest = digest("wrong-recovery"); }],
    ["recovered", live => { live.claim.deviceId = "device:wrong"; }],
    ["integrated", live => { live.claim.integration.operatorDecisionDigest = digest("wrong-authorization"); }],
    ["retired", live => { live.claim.retirement.bytesDigest = digest("wrong-bytes"); }],
  ];
  for (const [phase, corrupt] of cases) {
    const live = liveAt(plan, phase, authorization.authorizationDigest);
    corrupt(live);
    assert.throws(() => buildMergedDormantClaimReconciliationPhaseObservation({
      plan,
      intent,
      phase,
      operationKey: mergedDormantClaimReconciliationOperationKey(plan, phase),
      live,
    }));
  }
});

function classifyAndObserve({ plan, intent, phase, live }) {
  const operationKey = mergedDormantClaimReconciliationOperationKey(plan, phase);
  const observation = buildMergedDormantClaimReconciliationPhaseObservation({
    plan, intent, phase, operationKey, live,
  });
  return classifyMergedDormantClaimReconciliationPhase({
    plan, intent, phase, operationKey, observation,
  });
}

function advance(intent, status, classification) {
  const values = {
    operationKey: classification.operationKey,
    evidenceDigest: classification.evidenceDigest,
  };
  if (classification.integrationReceiptDigest) {
    values.integrationReceiptDigest = classification.integrationReceiptDigest;
  }
  return advanceMergedDormantClaimReconciliationIntent(intent, { status, values });
}

function sourceFixture() {
  const declaredWriteScope = normalizeWriteSet(["path:src/game", "semantic:game-os"]);
  const actorId = "github-user:1";
  const repositoryId = "github-repository:R_1";
  const workItemId = "work-item:game-os";
  const canonicalBaseRevision = sha("canonical-base");
  const laneRevision = sha("reviewed-head");
  const writeSetDigest = digestValue(declaredWriteScope);
  const leaseEpoch = 1;
  const claimId = digestValue({
    actorId, canonicalBaseRevision, leaseEpoch, repositoryId, workItemId, writeSetDigest,
  });
  const branch = "agent/device/game-os";
  const pullRequestUrl = "https://github.com/owner/repo/pull/738";
  const reviewRequestId = "github-pull-request:PR_738";
  const plainDevice = "device";
  const plainSession = "session";
  const claimDigest = digest("claim-fence");
  const transitionDigest = digest("claim-transition");
  const operationReceiptDigest = digest("claim-operation");
  const evidenceDigest = digest("review-evidence");
  const scopeTreeDigest = digest("reviewed-scope-tree");
  const pullHead = sha("refresh-final");
  const pullTree = sha("pull-tree");
  const firstRefresh = sha("refresh-one");
  const finalMainParent = sha("refresh-final-main-parent");
  const mergeCommit = sha("squash-merge");
  const requiredChecks = [{ context: "Integration Gate", appId: 15368 }];
  return {
    claim: {
      claimId, claimDigest, transitionDigest, operationReceiptDigest,
      ledgerRevision: sha("current-ledger-ref"), ledgerDigest: digest("current-ledger"),
      state: "dormant-preserved", recordedState: "reviewed", writeAuthority: false,
      scopeReserved: true, actorId,
      deviceId: pseudonymousIdentifier("device", plainDevice),
      sessionId: pseudonymousIdentifier("session", plainSession),
      repositoryId, workItemId, canonicalBaseRevision, laneRevision, declaredWriteScope,
      writeSetDigest, leaseEpoch, transitionCounter: 5, reviewRequestId, evidenceDigest,
      integration: null, integrationReceiptDigest: null,
    },
    provider: {
      provider: "github", repository: "owner/repo", repositoryId,
      pullRequest: {
        number: 738, nodeId: "PR_738", url: pullRequestUrl, state: "CLOSED",
        draft: false, merged: true, headRepository: "owner/repo", headBranch: branch,
        headSha: pullHead, headTreeSha: pullTree, baseRepository: "owner/repo",
        baseBranch: "main", mergeCommitSha: mergeCommit, mergeCommitTreeSha: pullTree,
      },
      claimHead: { sha: laneRevision, treeSha: sha("reviewed-tree"), scopeTreeDigest },
      protectedMain: { branch: "main", sha: sha("protected-main"), treeSha: sha("protected-tree") },
      ancestry: { claimHeadIsAncestorOfPullRequestHead: true, mergeCommitIsAncestorOfProtectedMain: true },
      refreshChain: [
        { sha: firstRefresh, treeSha: sha("refresh-one-tree"), scopeTreeDigest,
          parents: [laneRevision, sha("refresh-one-main-parent")], secondParentIsAncestorOfProtectedMain: true },
        { sha: pullHead, treeSha: pullTree, scopeTreeDigest,
          parents: [firstRefresh, finalMainParent], secondParentIsAncestorOfProtectedMain: true },
      ],
      mergeCommitParents: [finalMainParent],
      mergeChangedPaths: ["src/game/runtime.ts"],
      requiredChecks,
      checkRuns: [
        checkRun(laneRevision, "SUCCESS"),
        checkRun(firstRefresh, "FAILURE"),
        checkRun(pullHead, "SUCCESS"),
        checkRun(mergeCommit, "SUCCESS"),
      ],
    },
    local: {
      worktreePath: "/preserved/game-os", registered: true, attached: true, clean: true,
      branch, headSha: laneRevision, treeSha: sha("reviewed-tree"),
      indexDigest: digest("index"), workingTreeDigest: digest("working"), stateDigest: digest("state"),
      remote: { name: "origin", branchPresent: false },
      lineage: {
        fence: { sha: sha("coordination-fence"), treeSha: sha("base-tree"),
          parentSha: canonicalBaseRevision, parentTreeSha: sha("base-tree") },
        reviewedHead: { sha: laneRevision, treeSha: sha("reviewed-tree"),
          parentSha: sha("coordination-fence"), changedPaths: ["src/game/runtime.ts"] },
      },
      lease: {
        schema: "agentic-writer-lease/v2", status: "review_ready", epoch: 473,
        sessionId: plainSession, device: plainDevice, scope: "game-os", branch,
        baseSha: canonicalBaseRevision, fenceSha: sha("coordination-fence"),
        reviewHeadSha: laneRevision, pullRequestUrl, leaseDigest: digest("lease"),
        cloudAuthority: {
          claimId, claimDigest, ledgerRevision: sha("historical-ledger-ref"),
          ledgerDigest: digest("historical-ledger"), claimLedgerRevision: transitionDigest,
          operationReceiptDigest, deviceId: plainDevice, sessionId: plainSession,
          canonicalBaseSha: canonicalBaseRevision, laneRevision, writeSetDigest,
          reviewRequestId, focusedEvidenceDigest: evidenceDigest, leaseEpoch,
          transitionCounter: 5, state: "review_ready",
          integrationReceiptDigest: null, integration: null,
        },
      },
    },
  };
}

function directMergeFixture() {
  const raw = sourceFixture();
  raw.provider.pullRequest.headSha = raw.provider.claimHead.sha;
  raw.provider.pullRequest.headTreeSha = raw.provider.claimHead.treeSha;
  raw.provider.pullRequest.mergeCommitTreeSha = raw.provider.claimHead.treeSha;
  raw.provider.refreshChain = [];
  raw.provider.mergeCommitParents = [raw.claim.canonicalBaseRevision];
  raw.provider.checkRuns = [
    checkRun(raw.provider.claimHead.sha, "SUCCESS"),
    checkRun(raw.provider.pullRequest.mergeCommitSha, "SUCCESS"),
  ];
  return raw;
}

function completedAbsentFixture() {
  const raw = sourceFixture();
  const completedPath = "/missing/completed-game-os";
  raw.provider.completion = {
    mainSha: sha("completion-main"), treeSha: sha("completion-main-tree"),
    mergeCommitIsAncestor: true, mainIsAncestorOfProtectedMain: true,
  };
  raw.local = {
    mode: "completed-absent", worktreePath: completedPath, registered: false, attached: false,
    branch: raw.local.branch, headSha: raw.local.headSha, treeSha: raw.local.treeSha,
    canonicalAnchor: { branch: "main", sha: raw.provider.protectedMain.sha,
      treeSha: raw.provider.protectedMain.treeSha },
    absence: { pathExists: false, registered: false, branchAttached: false,
      localBranchPresent: true, localRefName: `refs/heads/${raw.local.branch}`, matchingLeaseCount: 1 },
    remote: raw.local.remote, lineage: raw.local.lineage,
    lease: {
      ...raw.local.lease, status: "completed", worktreePath: completedPath,
      completion: { mergeCommitSha: raw.provider.pullRequest.mergeCommitSha,
        mainSha: raw.provider.completion.mainSha },
    },
  };
  return raw;
}

function checkRun(headSha, conclusion) {
  return { name: "Integration Gate", appId: 15368, headSha, status: "COMPLETED", conclusion };
}

function liveAt(plan, phase, authorizationDigest) {
  const stages = { prepared: 0, recovered: 1, integrated: 2, retired: 3 };
  const stage = stages[phase];
  const recoveryKey = mergedDormantClaimReconciliationOperationKey(plan, "recovered");
  const integrationKey = mergedDormantClaimReconciliationOperationKey(plan, "integrated");
  const integrationReceiptDigest = digest("integration-receipt");
  const claim = {
    claimId: plan.claimId, state: "dormant-preserved", recordedState: "reviewed",
    writeAuthority: false, scopeReserved: true, actorId: plan.actorId,
    repositoryId: plan.repositoryId, workItemId: plan.workItemId,
    deviceId: plan.expectedCloudDeviceId, sessionId: plan.expectedCloudSessionId,
    canonicalBaseRevision: plan.canonicalBaseRevision, laneRevision: plan.claimLaneRevision,
    writeSetDigest: plan.claimWriteSetDigest, leaseEpoch: plan.claimLeaseEpoch,
    transitionCounter: plan.expectedTransitionCounter + stage,
    reviewRequestId: plan.claimReviewRequestId, evidenceDigest: plan.claimFocusedEvidenceDigest,
    fenceRevision: stage === 0 ? plan.claimDigest : digest(`fence-${stage}`),
    transitionDigest: stage === 0 ? plan.claimTransitionDigest : digest(`transition-${stage}`),
    operationReceiptDigest: stage === 0 ? plan.claimOperationReceiptDigest : digest(`operation-${stage}`),
    recovery: null, integration: null, integrationReceiptDigest: null, retirement: null,
  };
  if (stage >= 1) {
    claim.state = claim.recordedState = "reviewed";
    claim.recovery = { evidenceDigest: recoveryKey, recoveredAt: instant };
  }
  if (stage >= 2) {
    claim.state = claim.recordedState = "integrated-preserved";
    claim.integration = {
      candidateRevision: plan.claimLaneRevision, reviewRequestId: plan.claimReviewRequestId,
      focusedEvidenceDigest: plan.claimFocusedEvidenceDigest,
      dependencyClosureDigest: plan.dependencyClosureDigest,
      namedChecksDigest: plan.namedChecksDigest, handoffEvidenceDigest: plan.handoffEvidenceDigest,
      operatorDecisionDigest: authorizationDigest, integrationIntentDigest: integrationKey,
      integratedAt: instant,
    };
    claim.integrationReceiptDigest = integrationReceiptDigest;
  }
  if (stage >= 3) {
    claim.state = claim.recordedState = "retired";
    claim.scopeReserved = false;
    claim.retirement = {
      reason: "integrated", finalRevision: plan.finalRevision,
      reviewRequestId: plan.claimReviewRequestId, bytesDigest: plan.bytesDigest,
      namedChecksDigest: plan.namedChecksDigest, handoffEvidenceDigest: plan.handoffEvidenceDigest,
      integrationReceiptDigest, retiredAt: instant,
    };
  }
  return {
    claim,
    result: {
      ledgerRevision: stage === 0 ? plan.expectedLedgerRevision : sha(`ledger-ref-${stage}`),
      ledgerDigest: stage === 0 ? plan.expectedLedgerDigest : digest(`ledger-${stage}`),
    },
  };
}
