import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASES,
  authorizeActiveDescendantUntrackedScopeRecovery,
  buildActiveDescendantUntrackedScopeRecoveryPlan,
  createActiveDescendantUntrackedScopeRecoveryIntent,
  stableActiveDescendantUntrackedTerminalDigest,
} from "../scripts/active-descendant-untracked-scope-recovery-contract.mjs";
import { createActiveDescendantUntrackedScopeRecoveryController }
  from "../scripts/active-descendant-untracked-scope-recovery-controller.mjs";
import {
  buildActiveDescendantUntrackedOwnerStopEvidence,
  buildActiveDescendantUntrackedScopeRecoveryEvidence,
  buildActiveDescendantUntrackedTargetAvailabilityEvidence,
} from "../scripts/active-descendant-untracked-scope-recovery-evidence.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";

const AT = "2026-08-31T00:00:00.000Z";
const BRANCH = "agent/device.local/untracked-scope";
const SCOPE = "untracked-scope";
const REVIEW_ID = "review:untracked-scope";
const REVIEW_URL = "https://provider.example/owner/repository/pull/31";
const D = value => digestValue(value);
const S = digit => digit.repeat(40);

function dirtEvidence(headSha) {
  const entries = [
    {
      path: "src/tracked.txt",
      staged: false,
      unstaged: true,
      untracked: false,
      headMode: "100644",
      headBlob: S("4"),
      indexMode: "100644",
      indexBlob: S("4"),
      worktreeType: "file",
      worktreeMode: "100644",
      worktreeBlob: S("5"),
    },
    {
      path: "src/untracked.txt",
      staged: false,
      unstaged: false,
      untracked: true,
      headMode: null,
      headBlob: null,
      indexMode: null,
      indexBlob: null,
      worktreeType: "file",
      worktreeMode: "100644",
      worktreeBlob: S("6"),
    },
  ];
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha,
    entries,
    pathCount: 2,
    stagedPathCount: 0,
    unstagedPathCount: 1,
    untrackedPathCount: 1,
  };
  return { ...core, evidenceDigest: D(core) };
}

function evidenceFixture({ observedAt = AT } = {}) {
  const baseSha = S("1");
  const fenceSha = S("2");
  const headSha = S("3");
  const claimId = D("source-claim");
  const sourceManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths: ["src/tracked.txt"],
  });
  const targetManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths: ["src/tracked.txt", "src/untracked.txt"],
  });
  const cloudAuthority = {
    claimId,
    claimDigest: D("source-claim-fence"),
    transitionCounter: 7,
  };
  const leaseCore = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 4,
    sessionId: "session:owner",
    device: "device.local",
    scope: SCOPE,
    branch: BRANCH,
    baseSha,
    fenceSha,
    pullRequestUrl: REVIEW_URL,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: SCOPE,
      declaredWriteSet: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest,
      manifestDigest: sourceManifest.manifestDigest,
    },
    cloudAuthority,
  };
  const capability = createTaskAuthorityCapability({ issuedAt: AT });
  const taskAuthority = createTaskAuthorityBinding({
    capability,
    lease: leaseCore,
    boundAt: AT,
  });
  const lease = { ...leaseCore, taskAuthority };
  const dirt = dirtEvidence(headSha);
  const worktreeIdentityDigest = D("source-worktree");
  const ownerStop = buildActiveDescendantUntrackedOwnerStopEvidence({
    sourceSessionId: lease.sessionId,
    sourceBranch: BRANCH,
    sourceHeadSha: headSha,
    sourceFenceSha: fenceSha,
    untrackedPaths: ["src/untracked.txt"],
    stoppedAt: observedAt,
  });
  const targetAvailability =
    buildActiveDescendantUntrackedTargetAvailabilityEvidence({
      sourceClaimId: claimId,
      targetWriteSetDigest: targetManifest.writeSetDigest,
      absentPaths: [],
      inventoryDigest: D("target-inventory"),
      verificationReceiptDigest: D("target-availability"),
      observedAt,
    });
  return buildActiveDescendantUntrackedScopeRecoveryEvidence({
    repository: "owner/repository",
    authorityRepository: "owner/authority",
    observedAt,
    lane: {
      schema: "agentic-clean-unpublished-descendant/v1",
      status: "clean-unpublished-descendant",
      branch: BRANCH,
      scope: SCOPE,
      sessionId: lease.sessionId,
      device: lease.device,
      worktreeIdentityDigest,
      baseSha,
      remoteFenceSha: fenceSha,
      headSha,
      headTreeSha: S("7"),
      linearDescendant: true,
      headPublished: false,
      commitCount: 1,
      commitInventoryDigest: D("descendant-commits"),
      rangeDiffDigest: D("descendant-range"),
      changedPaths: ["src/tracked.txt"],
    },
    lease,
    registry: (() => {
      const snapshot = {
        schema: "agentic-writer-lease-registry/v2",
        revision: 12,
        leases: { [BRANCH]: lease },
      };
      return {
        snapshot,
        revision: snapshot.revision,
        registryDigest: D(snapshot),
        leaseDigest: D(lease),
      };
    })(),
    claim: {
      schema: "agentic-current-cloud-claim-evidence/v1",
      state: "current",
      writeAuthority: true,
      scopeReserved: true,
      claimId,
      claimDigest: cloudAuthority.claimDigest,
      claimLedgerRevision: D("source-transition"),
      operationReceiptDigest: D("source-operation"),
      actorId: "actor:owner",
      repositoryId: "repository:target",
      workItemId: "work-item:untracked-scope",
      predecessorClaimId: null,
      canonicalBaseRevision: baseSha,
      laneRevision: fenceSha,
      declaredWriteScope: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest,
      leaseEpoch: lease.epoch,
      transitionCounter: cloudAuthority.transitionCounter,
      heartbeatCounter: 2,
      reviewRequestId: REVIEW_ID,
      expiresAt: "2026-08-31T01:00:00.000Z",
      ledgerRevision: S("8"),
      ledgerDigest: D("source-ledger"),
      inventoryDigest: D("source-inventory"),
      verificationReceiptDigest: D("source-verification"),
    },
    pullRequest: {
      schema: "agentic-draft-review-subject/v1",
      adapterId: "provider-review/v1",
      repository: "owner/repository",
      id: REVIEW_ID,
      nodeId: "review-node:untracked-scope",
      number: 31,
      url: REVIEW_URL,
      state: "open",
      draft: true,
      autoDelivery: null,
      branch: BRANCH,
      headSha: fenceSha,
      baseSha,
      bodyDigest: D("source-body"),
      bodyRemainderDigest: D("source-body-remainder"),
      markerDigest: D("source-marker"),
      observedAt,
    },
    dirt,
    ownerStop,
    targetManifest,
    targetAvailability,
    controller: {
      repository: "owner/authority",
      branch: "agent/controller.local/untracked-recovery",
      baseSha: S("8"),
      headSha: S("9"),
      remoteHeadSha: S("9"),
      treeSha: S("a"),
      clean: true,
      published: true,
      leaseDigest: D("controller-lease"),
      claimId: D("controller-claim"),
      claimDigest: D("controller-claim-fence"),
      transitionCounter: 2,
      writeSetDigest: D("controller-write-set"),
      taskAuthorityBindingDigest: D("controller-task-authority"),
      implementationDigest: D("controller-implementation"),
    },
    mutationBoundary: {
      privateJournal: true,
      taskAuthorityProof: true,
      cloudSuccessorClaim: true,
      cloudSourceRetirement: true,
      cloudSuccessorPromotion: true,
      cloudReviewBinding: true,
      writerRegistryCas: true,
      sourceBytes: false,
      index: false,
      head: false,
      localRef: false,
      remoteRef: false,
      commit: false,
      push: false,
      pullRequestBody: false,
      pullRequestMarker: false,
      pullRequestState: false,
      reviewAuthority: false,
      integration: false,
      deployment: false,
      cleanup: false,
    },
  });
}

function buildPlan(options) {
  return buildActiveDescendantUntrackedScopeRecoveryPlan({
    evidence: evidenceFixture(options),
  });
}

function phaseValues(plan, { verifiedAt = AT } = {}) {
  const successorClaimId = D("successor-claim");
  const taskAuthorityReceiptDigest = D("task-authority-receipt");
  const mutationAuthorityReceiptDigest = D("mutation-authority-receipt");
  const cloudVerificationReceiptDigest = D("terminal-cloud-verification");
  const targetLeaseDigest = D("target-lease");
  const bound = {
    claimId: successorClaimId,
    claimDigest: D("successor-bound-fence"),
    transitionCounter: 3,
    laneRevision: plan.sourceFenceSha,
    reviewRequestId: plan.sourceReviewRequestId,
  };
  const terminalEvidence = {
    sourceHeadSha: plan.sourceHeadSha,
    sourceIndexEvidenceDigest: plan.sourceIndexEvidenceDigest,
    sourceDirtEvidenceDigest: plan.sourceDirtEvidenceDigest,
    successorClaimId,
    successorClaimDigest: bound.claimDigest,
    targetWriteSetDigest: plan.targetWriteSetDigest,
    targetManifestDigest: plan.targetManifestDigest,
    sourceLeaseDigest: plan.sourceLeaseDigest,
    targetLeaseDigest,
    registryDigest: D("target-registry"),
    pullRequestIdentityDigest: plan.pullRequestIdentityDigest,
    taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest,
    cloudVerificationReceiptDigest,
    successorTransitionCounter: bound.transitionCounter,
    successorLaneRevision: bound.laneRevision,
    registryRevision: 13,
    verifiedAt,
    sourceMutation: false,
    indexMutation: false,
    headMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
    commitMutation: false,
    pushMutation: false,
    authoringAuthority: true,
    reviewAuthority: false,
    integrationAuthority: false,
    deploymentAuthority: false,
    cleanupAuthority: false,
    pullRequestMutation: false,
    providerProjection: "deferred",
    crossDeviceResumeAuthority: false,
  };
  return {
    authorizeTask: {
      taskAuthorityReceiptDigest,
      taskAuthorityProofDigest: D("task-authority-proof"),
      sourceTaskAuthorityBindingDigest: plan.sourceTaskAuthorityBindingDigest,
    },
    createWaitingSuccessor: {
      claimId: successorClaimId,
      claimDigest: D("successor-waiting-fence"),
      transitionCounter: 1,
      state: "waiting-successor",
      predecessorClaimId: plan.sourceClaimId,
      writeSetDigest: plan.targetWriteSetDigest,
      laneRevision: plan.sourceFenceSha,
      operationReceiptDigest: D("waiting-operation"),
      receiptDigest: D("waiting-receipt"),
    },
    retireSource: {
      sourceClaimId: plan.sourceClaimId,
      sourceClaimDigest: D("source-retired-fence"),
      transitionCounter: plan.sourceTransitionCounter + 1,
      state: "retired",
      operationReceiptDigest: D("retire-operation"),
      receiptDigest: D("retire-receipt"),
    },
    promoteSuccessor: {
      claimId: successorClaimId,
      claimDigest: D("successor-current-fence"),
      transitionCounter: 2,
      state: "current",
      predecessorClaimId: plan.sourceClaimId,
      writeSetDigest: plan.targetWriteSetDigest,
      laneRevision: plan.sourceFenceSha,
      operationReceiptDigest: D("promote-operation"),
      receiptDigest: D("promote-receipt"),
    },
    bindSuccessor: {
      authority: { ...bound, state: "active" },
      ...bound,
      state: "current",
      operationReceiptDigest: D("bind-operation"),
      verificationReceiptDigest: D("bind-verification"),
      receiptDigest: D("bind-receipt"),
    },
    projectLocal: {
      leaseDigest: targetLeaseDigest,
      registryRevision: terminalEvidence.registryRevision,
      taskAuthorityBindingDigest: D("target-task-authority-binding"),
      mutationAuthorityReceiptDigest,
      adopted: false,
      receiptDigest: D("local-cas-receipt"),
    },
    verifyTerminal: {
      terminalEvidence,
      terminalEvidenceDigest:
        stableActiveDescendantUntrackedTerminalDigest(terminalEvidence),
      mutationAuthorityReceiptDigest,
      cloudVerificationReceiptDigest,
      receiptDigest: D("terminal-verification-receipt"),
    },
  };
}

function persistedIntent(plan) {
  const authorizationReceipt = authorizeActiveDescendantUntrackedScopeRecovery(
    plan,
    plan.exactAuthorization,
  );
  return createActiveDescendantUntrackedScopeRecoveryIntent({
    plan,
    authorizationReceipt,
  });
}

function controllerFixture({ initialIntent = null, failOnceAt = null } = {}) {
  const calls = [];
  const writes = [];
  let intent = initialIntent;
  let pendingFailure = failOnceAt;
  let replayTerminal = null;
  const effect = name => async ({ plan, replay = false }) => {
    calls.push(`${name}:${replay ? "replay" : "effect"}`);
    if (pendingFailure === name) {
      pendingFailure = null;
      throw new Error(`${name} response lost`);
    }
    if (name === "verifyTerminal" && replayTerminal) return replayTerminal;
    return phaseValues(plan)[name];
  };
  const adapter = {
    readEvidence: async () => {
      calls.push("read-evidence");
      return evidenceFixture();
    },
    withOperationLock: async (_plan, action) => {
      calls.push("lock");
      return action();
    },
    readIntent: async () => {
      calls.push("read-intent");
      return intent;
    },
    writeIntent: async ({ expected, next }) => {
      assert.equal(expected?.intentDigest ?? null, intent?.intentDigest ?? null);
      calls.push(`write:${next.phase}`);
      writes.push(next.phase);
      intent = next;
    },
    assertState: async ({ before }) => calls.push(`assert:${before}`),
    authorizeTask: effect("authorizeTask"),
    createWaitingSuccessor: effect("createWaitingSuccessor"),
    retireSource: effect("retireSource"),
    promoteSuccessor: effect("promoteSuccessor"),
    bindSuccessor: effect("bindSuccessor"),
    projectLocal: effect("projectLocal"),
    verifyTerminal: effect("verifyTerminal"),
  };
  return {
    calls,
    writes,
    controller: createActiveDescendantUntrackedScopeRecoveryController(adapter),
    clearCalls() { calls.length = 0; },
    get intent() { return intent; },
    setReplayTerminal(value) { replayTerminal = value; },
  };
}

test("controller persists every protected phase in exact effect order", async () => {
  const fixture = controllerFixture();
  const plan = await fixture.controller.plan();
  const receipt = await fixture.controller.run({
    plan,
    authorization: plan.exactAuthorization,
  });

  assert.equal(receipt.status, "authoring-authority-restored");
  assert.equal(receipt.pullRequestMutation, false);
  assert.equal(receipt.providerProjection, "deferred");
  assert.equal(receipt.crossDeviceResumeAuthority, false);
  assert.deepEqual(fixture.writes, PHASES);
  assert.deepEqual(fixture.calls, [
    "read-evidence",
    "lock",
    "read-intent",
    "assert:authorized",
    "write:authorized",
    "assert:task-authority-verified",
    "authorizeTask:effect",
    "write:task-authority-verified",
    "assert:successor-waiting",
    "createWaitingSuccessor:effect",
    "write:successor-waiting",
    "assert:source-retired",
    "retireSource:effect",
    "write:source-retired",
    "assert:successor-current",
    "promoteSuccessor:effect",
    "write:successor-current",
    "assert:successor-bound",
    "bindSuccessor:effect",
    "write:successor-bound",
    "assert:local-cas",
    "projectLocal:effect",
    "write:local-cas",
    "assert:verified",
    "verifyTerminal:effect",
    "write:verified",
    "write:complete",
  ]);
});

test("response loss resumes only the unpersisted phase and complete replay is effect-free", async () => {
  const fixture = controllerFixture({ failOnceAt: "bindSuccessor" });
  const plan = await fixture.controller.plan();
  await assert.rejects(
    fixture.controller.run({ plan, authorization: plan.exactAuthorization }),
    /bindSuccessor response lost/,
  );
  assert.equal(fixture.intent.phase, "successor-current");

  fixture.clearCalls();
  const first = await fixture.controller.run({ plan,
    authorization: plan.exactAuthorization });
  assert.deepEqual(fixture.calls, [
    "lock",
    "read-intent",
    "assert:successor-bound",
    "bindSuccessor:effect",
    "write:successor-bound",
    "assert:local-cas",
    "projectLocal:effect",
    "write:local-cas",
    "assert:verified",
    "verifyTerminal:effect",
    "write:verified",
    "write:complete",
  ]);

  fixture.clearCalls();
  const replay = await fixture.controller.run({
    plan,
    authorization: plan.exactAuthorization,
  });
  assert.equal(replay.receiptDigest, first.receiptDigest);
  assert.deepEqual(fixture.calls, [
    "lock",
    "read-intent",
    "verifyTerminal:replay",
  ]);
});

test("wrong authorization is rejected before journal access or effects", async () => {
  const plan = buildPlan();
  for (const initialIntent of [null, persistedIntent(plan)]) {
    const fixture = controllerFixture({ initialIntent });
    await assert.rejects(
      fixture.controller.run({ plan, authorization: "wrong authorization" }),
      /requires exact authorization/,
    );
    assert.deepEqual(fixture.calls, ["lock"]);
    assert.deepEqual(fixture.writes, []);
  }
});

test("a persisted journal from another plan fails before recovery effects", async () => {
  const plan = buildPlan();
  const otherPlan = buildPlan({ observedAt: "2026-08-31T00:01:00.000Z" });
  const fixture = controllerFixture({ initialIntent: persistedIntent(otherPlan) });
  await assert.rejects(
    fixture.controller.run({ plan, authorization: plan.exactAuthorization }),
    /journal belongs to another descendant\/untracked plan/,
  );
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.calls.some(call => call.startsWith("assert:")), false);
  assert.equal(fixture.calls.some(call => call.endsWith(":effect")), false);
});

test("complete replay ignores fresh receipt rotation but rejects structural drift", async () => {
  const fixture = controllerFixture();
  const plan = await fixture.controller.plan();
  const first = await fixture.controller.run({
    plan,
    authorization: plan.exactAuthorization,
  });
  const refreshed = structuredClone(phaseValues(plan, {
    verifiedAt: "2026-08-31T00:02:00.000Z",
  }).verifyTerminal);
  refreshed.terminalEvidence.cloudVerificationReceiptDigest = D("fresh-cloud-receipt");
  refreshed.terminalEvidence.mutationAuthorityReceiptDigest = D("fresh-mutation-receipt");
  refreshed.cloudVerificationReceiptDigest = refreshed.terminalEvidence.cloudVerificationReceiptDigest;
  refreshed.mutationAuthorityReceiptDigest = refreshed.terminalEvidence.mutationAuthorityReceiptDigest;
  fixture.setReplayTerminal(refreshed);
  fixture.clearCalls();

  const replay = await fixture.controller.run({
    plan,
    authorization: plan.exactAuthorization,
  });
  assert.equal(replay.receiptDigest, first.receiptDigest);
  assert.deepEqual(fixture.calls, ["lock", "read-intent", "verifyTerminal:replay"]);

  const drifted = structuredClone(refreshed);
  drifted.terminalEvidence.registryDigest = D("structural-registry-drift");
  drifted.terminalEvidenceDigest = stableActiveDescendantUntrackedTerminalDigest(
    drifted.terminalEvidence,
  );
  fixture.setReplayTerminal(drifted);
  fixture.clearCalls();

  await assert.rejects(
    fixture.controller.run({ plan, authorization: plan.exactAuthorization }),
    /terminal evidence drifted on replay/,
  );
  assert.deepEqual(fixture.calls, ["lock", "read-intent", "verifyTerminal:replay"]);
});
