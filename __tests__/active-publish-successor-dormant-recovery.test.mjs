import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  activePublishSuccessorDormantRecoveryDecisionSubject,
  buildActivePublishSuccessorDormantRecoveryEvidence,
  normalizeActivePublishSuccessorDormantRecoveryEvidence,
} from "../scripts/active-publish-successor-dormant-recovery-evidence.mjs";
import {
  ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES,
  advanceActivePublishSuccessorDormantRecoveryIntent,
  authorizeActivePublishSuccessorDormantRecoveryPlan,
  buildActivePublishSuccessorDormantRecoveryCompletion,
  buildActivePublishSuccessorDormantRecoveryPlan,
  createActivePublishSuccessorDormantRecoveryIntent,
  normalizeActivePublishSuccessorDormantRecoveryIntent,
  normalizeActivePublishSuccessorDormantRecoveryPlan,
} from "../scripts/active-publish-successor-dormant-recovery-contract.mjs";
import {
  createActivePublishSuccessorDormantRecoveryController,
} from "../scripts/active-publish-successor-dormant-recovery-controller.mjs";
import {
  createActivePublishSuccessorDormantRecoveryRepositoryAdapter,
} from "../scripts/active-publish-successor-dormant-recovery-repository-adapter.mjs";
import { createActivePublishSuccessorDormantRecoveryStore }
  from "../scripts/active-publish-successor-dormant-recovery-store.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const D = value => digestValue(value);
const S = digit => digit.repeat(40);
const AT = "2026-08-15T12:00:00.000Z";
const REPOSITORY = "owner/repository";
const BRANCH = "agent/device/source";
const REVIEW_URL = "https://provider.example/owner/repository/pull/500";

function successorReceipt(
  leaseDigest,
  bindingDigest,
  lineageReceiptDigest,
  sourceBindingDigest = D("source-binding"),
) {
  const core = {
    schema: "agentic-active-publish-task-authority-successor-reconciliation-receipt/v1",
    planDigest: D("successor-plan"),
    sourceBindingDigest,
    targetBindingDigest: bindingDigest,
    successorReceiptDigest: lineageReceiptDigest,
    taskAuthorityReceiptDigest: D("task-authority"),
    targetLeaseDigest: leaseDigest,
    registryRevision: 7,
    verifiedAt: AT,
    mutationSet: ["writer-lease-task-authority-continuation"],
    cloudMutation: false,
    providerMutation: false,
    gitMutation: false,
    sourceMutation: false,
    authoringAuthorityGranted: false,
  };
  return { ...core, receiptDigest: D(core) };
}

function evidenceInput() {
  const declaredWriteSet = ["path:docs/source.md", "semantic:source"];
  const writeSetDigest = D(declaredWriteSet);
  const bindingDigest = D("target-binding");
  const claimId = D("successor-claim");
  const lineageCore = {
    schema: "agentic-active-publish-task-authority-successor-receipt/v1",
    branch: BRANCH, epoch: 2, sourceBaseSha: S("8"), sourceFenceSha: S("9"),
    sourceClaimId: D("predecessor"), sourceBindingDigest: D("source-binding"),
    targetBaseSha: S("5"), targetFenceSha: S("3"), targetClaimId: claimId,
    targetBindingDigest: bindingDigest, cloudOperationReceiptDigest: D("claim-operation"),
    cloudVerificationReceiptDigest: D("successor-cloud-verification"), boundAt: AT,
  };
  const lineage = { ...lineageCore, receiptDigest: D(lineageCore) };
  const sourceLease = {
    schema: "agentic-writer-lease/v2",
    branch: BRANCH,
    activePublishTaskAuthoritySuccessor: lineage,
  };
  const leaseDigest = D(sourceLease);
  const refresh = { previousHeadSha: S("7"), refreshedHeadSha: S("3"), mainParentSha: S("5") };
  const refreshReceiptCore = {
    schema: "agentic-protected-main-refresh/v1",
    deliveredHeadSha: S("7"), refreshedHeadSha: S("3"), mainParentSha: S("5"),
  };
  const overlapCore = {
    subjectClaimId: claimId,
    subjectWriteSetDigest: writeSetDigest,
    competingClaimIds: [],
    noOverlappingCompetitor: true,
  };
  return {
    observedAt: AT,
    controller: {
      repository: REPOSITORY,
      headSha: S("1"), treeSha: S("2"), originMainSha: S("1"), remoteMainSha: S("1"),
      clean: true, implementationDigest: D("implementation"),
    },
    canonicalAdvance: {
      protectedBaseSha: S("5"), deliveredHeadSha: S("7"), refreshedFenceSha: S("3"),
      protectedMainSha: S("1"), refreshes: [refresh],
      protectedRefreshReceiptDigest: D(refreshReceiptCore), protectedMainDescendant: true,
      changedPaths: ["docs/unrelated.md"], changedPathsDigest: D(["docs/unrelated.md"]),
      noWriteSetOverlap: true,
    },
    lane: {
      repository: REPOSITORY, worktreePath: "/worktrees/source", branch: BRANCH,
      headSha: S("3"), treeSha: S("4"), remoteHeadSha: S("3"),
      statusDigest: D("clean-status"), registered: true, clean: true,
    },
    lease: {
      sourceLease, leaseDigest, status: "active", admissionStatus: "admitted", sessionId: "session",
      device: "device.local", scope: "source", branch: BRANCH, epoch: 2,
      baseSha: S("5"), fenceSha: S("3"), integrationCommitSha: S("7"),
      pullRequestUrl: REVIEW_URL,
      manifestDigest: D("manifest"), writeSetDigest, declaredWriteSet,
      taskAuthorityBindingDigest: bindingDigest, cloudAuthorityDigest: D("cloud-authority"),
      cloudClaimId: claimId, cloudClaimDigest: D("claim-fence"),
      cloudTransitionCounter: 4, cloudOperationReceiptDigest: D("claim-operation"),
      activePublishTaskAuthoritySuccessor: lineage,
    },
    review: {
      adapterId: "provider-review/v1", id: "review:500", url: REVIEW_URL,
      state: "open", draft: true, autoDeliveryAbsent: true,
      headRepository: REPOSITORY, headBranch: BRANCH, headSha: S("3"),
      baseBranch: "main", baseSha: S("5"), markerDigest: D("source-marker"),
      bodyDigest: D("review-body"), visibleBodyDigest: D("visible-review-body"),
    },
    successorReceipt: successorReceipt(leaseDigest, bindingDigest, lineage.receiptDigest),
    cloud: {
      ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
      ledgerRevision: S("6"), ledgerDigest: D("ledger"), ledgerSequence: 9,
      inventoryDigest: D("inventory"), verificationReceiptDigest: D("verification"),
      claim: {
        claimId, fenceRevision: D("claim-fence"), transitionDigest: D("transition"),
        operationReceiptDigest: D("claim-operation"), actorId: "actor:A",
        deviceId: "device.local", sessionId: "session", repositoryId: "repository:R",
        workItemId: "work-item:source", canonicalBaseRevision: S("5"),
        laneRevision: S("3"), declaredWriteScope: declaredWriteSet, writeSetDigest,
        leaseEpoch: 2, transitionCounter: 4, heartbeatCounter: 1,
        predecessorClaimId: D("predecessor"), reviewRequestId: "review:500",
        state: "dormant-preserved", recordedState: "current", writeAuthority: false,
        scopeReserved: true, expiresAt: "2026-08-15T11:00:00.000Z",
      },
      overlapProof: { ...overlapCore, overlapProofDigest: D(overlapCore) },
    },
  };
}

function clone(value) { return structuredClone(value); }

function terminalVerification(plan) {
  const authorityCore = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: plan.evidence.cloud.claim.claimId, claimDigest: D("current-claim"),
    ledgerRevision: S("b"), localLeaseEpoch: 2, localFenceSha: S("3"), remoteLeaseEpoch: 2,
    cloudVerificationReceiptDigest: D("authority-verification"), evaluatedAt: AT,
    expiresAt: "2026-08-15T13:00:00.000Z" };
  const mutationAuthority = { ...authorityCore, receiptDigest: D(authorityCore) };
  const core = {
    schema: "agentic-active-publish-successor-dormant-recovery-terminal-verification/v1",
    planDigest: plan.planDigest,
    claimId: plan.evidence.cloud.claim.claimId,
    sourceLeaseDigest: plan.evidence.lease.leaseDigest,
    projectedLeaseDigest: D("projected-lease"),
    leaseProjectionReceiptDigest: D("lease-projection"),
    reviewMarkerReceiptDigest: D("review-marker"),
    cloudVerificationReceiptDigest: D("terminal-cloud"),
    mutationAuthority,
    mutationAuthorityReceiptDigest: mutationAuthority.receiptDigest,
    verifiedAt: AT,
    gitMutation: false,
    sourceMutation: false,
    newClaim: false,
    newPullRequest: false,
  };
  return { ...core, verificationDigest: D(core) };
}

test("exact dormant successor evidence is deterministic and immutable", () => {
  const evidence = buildActivePublishSuccessorDormantRecoveryEvidence(evidenceInput());
  assert.deepEqual(normalizeActivePublishSuccessorDormantRecoveryEvidence(evidence), evidence);
  assert.equal(Object.isFrozen(evidence.cloud.claim.declaredWriteScope), true);
  assert.equal(evidence.cloud.claim.state, "dormant-preserved");
  const refreshed = buildActivePublishSuccessorDormantRecoveryEvidence({
    ...evidenceInput(), observedAt: "2026-08-15T12:01:00.000Z",
  });
  assert.notEqual(refreshed.evidenceDigest, evidence.evidenceDigest);
  assert.deepEqual(
    activePublishSuccessorDormantRecoveryDecisionSubject(refreshed),
    activePublishSuccessorDormantRecoveryDecisionSubject(evidence),
  );
});

test("adversarial subject drift fails closed", () => {
  const cases = [
    ["dirty protected controller", value => { value.controller.clean = false; }],
    ["unregistered lane", value => { value.lane.registered = false; }],
    ["remote head drift", value => { value.lane.remoteHeadSha = S("7"); }],
    ["non-admitted lease", value => { value.lease.admissionStatus = "planned"; }],
    ["non-draft review", value => { value.review.draft = false; }],
    ["writing claim", value => { value.cloud.claim.writeAuthority = true; }],
    ["non-dormant claim", value => { value.cloud.claim.state = "current"; }],
    ["foreign transition", value => { value.cloud.claim.transitionCounter += 1; }],
    ["competing reservation", value => {
      const competitor = D("competitor");
      value.cloud.overlapProof.competingClaimIds = [competitor];
      const { overlapProofDigest: _old, ...core } = value.cloud.overlapProof;
      value.cloud.overlapProof.overlapProofDigest = D(core);
    }],
    ["successor receipt with cloud effect", value => {
      value.successorReceipt.cloudMutation = true;
      const { receiptDigest: _old, ...core } = value.successorReceipt;
      value.successorReceipt.receiptDigest = D(core);
    }],
  ];
  for (const [label, mutate] of cases) {
    const input = clone(evidenceInput());
    mutate(input);
    assert.throws(() => buildActivePublishSuccessorDormantRecoveryEvidence(input), undefined, label);
  }
});

test("plan authorization and phase chain are exact, ordered, and replay-stable", () => {
  const evidence = buildActivePublishSuccessorDormantRecoveryEvidence(evidenceInput());
  const plan = buildActivePublishSuccessorDormantRecoveryPlan({ evidence, ttlSeconds: 600 });
  assert.deepEqual(normalizeActivePublishSuccessorDormantRecoveryPlan(plan), plan);
  assert.throws(
    () => authorizeActivePublishSuccessorDormantRecoveryPlan(plan, "authorize something else"),
    /Exact authorization required/,
  );
  const authorization = authorizeActivePublishSuccessorDormantRecoveryPlan(
    plan, plan.exactAuthorization,
  );
  let intent = createActivePublishSuccessorDormantRecoveryIntent(plan, authorization, AT);
  assert.throws(
    () => advanceActivePublishSuccessorDormantRecoveryIntent(
      intent, "cloud_request_sealed", { receiptDigest: D("skip") }, AT,
    ),
    /cannot advance/,
  );
  for (const phase of ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES) {
    const values = { receiptDigest: D(phase) };
    if (phase === "cloud_recovered") values.cloudMutation = true;
    if (phase === "lease_projected") values.writerRegistryMutation = true;
    if (phase === "review_marker_projected") values.providerMutation = true;
    if (phase === "verified") Object.assign(values, terminalVerification(plan));
    intent = advanceActivePublishSuccessorDormantRecoveryIntent(intent, phase, values, AT);
    assert.deepEqual(
      advanceActivePublishSuccessorDormantRecoveryIntent(intent, phase, values, AT),
      intent,
    );
  }
  assert.deepEqual(normalizeActivePublishSuccessorDormantRecoveryIntent(intent), intent);
  const completion = buildActivePublishSuccessorDormantRecoveryCompletion(intent);
  assert.equal(completion.claimId, evidence.cloud.claim.claimId);
  assert.deepEqual(completion.mutationSet, [
    "cloud-same-claim-recovery",
    "writer-lease-cloud-authority-projection",
    "review-hidden-marker-projection",
  ]);
  for (const field of [
    "cloudMutation", "providerMutation", "writerRegistryMutation", "reviewMarkerMutation",
  ]) assert.equal(completion[field], true, field);
  for (const field of [
    "gitMutation", "sourceMutation", "branchMutation", "worktreeMutation", "mergeMutation",
    "deploymentMutation", "newClaim", "newPullRequest",
  ]) assert.equal(completion[field], false, field);
  assert.equal(completion.authoringAuthorityRestored, true);
  let untyped = createActivePublishSuccessorDormantRecoveryIntent(plan, authorization, AT);
  for (const phase of ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES) {
    const values = { receiptDigest: D(`untyped:${phase}`) };
    if (phase === "verified") Object.assign(values, terminalVerification(plan));
    untyped = advanceActivePublishSuccessorDormantRecoveryIntent(
      untyped, phase, values, AT,
    );
  }
  assert.throws(() => buildActivePublishSuccessorDormantRecoveryCompletion(untyped),
    /invalid cloud mutation/);
});

function fakeControllerFixture(lostAt = null) {
  const effects = Object.fromEntries([
    "assertSource", "authorizeTask", "sealCloudRequest", "recoverCloud",
    "projectLease", "projectReviewMarker", "verifyTerminal",
  ].map(name => [name, 0]));
  let intent = null;
  const note = name => {
    effects[name] += 1;
    if (name === lostAt && effects[name] === 1) throw new Error(`${name} response lost`);
    return { receiptDigest: D(`${name}:${effects[name]}`),
      ...(name === "recoverCloud" ? { cloudMutation: true } : {}),
      ...(name === "projectLease" ? { writerRegistryMutation: true } : {}),
      ...(name === "projectReviewMarker" ? { providerMutation: true } : {}) };
  };
  const adapter = {
    readPlanEvidence: async () => buildActivePublishSuccessorDormantRecoveryEvidence(evidenceInput()),
    assertSource: async () => note("assertSource"),
    authorizeTask: async () => note("authorizeTask"),
    sealCloudRequest: async () => note("sealCloudRequest"),
    recoverCloud: async () => note("recoverCloud"),
    projectLease: async () => note("projectLease"),
    projectReviewMarker: async () => note("projectReviewMarker"),
    verifyTerminal: async plan => {
      effects.verifyTerminal += 1;
      return terminalVerification(plan);
    },
  };
  const store = {
    readIntent: () => intent,
    writeIntent: ({ expected, value }) => {
      assert.equal(expected?.intentDigest ?? null, intent?.intentDigest ?? null);
      intent = value;
      return intent;
    },
    withOperationLock: action => action(),
  };
  return { adapter, effects, controller: createActivePublishSuccessorDormantRecoveryController({
    adapter, store,
  }) };
}

test("controller performs each recovery effect once and complete replay performs none", async () => {
  const fixture = fakeControllerFixture();
  const plan = await fixture.controller.plan({ ttlSeconds: 600 });
  const first = await fixture.controller.run({ plan, authorization: plan.exactAuthorization });
  const afterFirst = { ...fixture.effects };
  const replay = await fixture.controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(first.receiptDigest, replay.receiptDigest);
  assert.deepEqual(fixture.effects, afterFirst);
  assert.deepEqual(afterFirst, {
    assertSource: 2,
    authorizeTask: 1,
    sealCloudRequest: 1,
    recoverCloud: 1,
    projectLease: 1,
    projectReviewMarker: 1,
    verifyTerminal: 2,
  });
});

test("cloud, lease, and review response loss resume only their unrecorded phase", async () => {
  for (const lostAt of ["recoverCloud", "projectLease", "projectReviewMarker"]) {
    const fixture = fakeControllerFixture(lostAt);
    const plan = await fixture.controller.plan({ ttlSeconds: 600 });
    await assert.rejects(
      fixture.controller.run({ plan, authorization: plan.exactAuthorization }),
      new RegExp(`${lostAt} response lost`),
    );
    const completion = await fixture.controller.run({
      plan, authorization: plan.exactAuthorization,
    });
    assert.equal(completion.status, "recovered");
    assert.equal(fixture.effects[lostAt], 2);
  }
});

test("a dead process lock is recovered without weakening a live owner", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dormant-recovery-lock-"));
  try {
    const statePath = path.join(root, "intent.json");
    const store = createActivePublishSuccessorDormantRecoveryStore({ statePath });
    writeFileSync(`${statePath}.operation.lock`, JSON.stringify({
      operation: "operation", subject: {}, pid: 2_147_483_647, token: "dead-owner",
    }), { mode: 0o600 });
    const value = await store.withOperationLock(() => "recovered");
    assert.equal(value, "recovered");
    let entered = false;
    await store.withOperationLock(async () => {
      await assert.rejects(store.withOperationLock(() => "unsafe"), /already in progress/);
      entered = true;
    });
    assert.equal(entered, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("wrong authorization fails before journal or recovery effects", async () => {
  const fixture = fakeControllerFixture();
  const plan = await fixture.controller.plan({ ttlSeconds: 600 });
  await assert.rejects(
    fixture.controller.run({ plan, authorization: "wrong" }),
    /Exact authorization required/,
  );
  assert.equal(Object.values(fixture.effects).reduce((sum, value) => sum + value, 0), 0);
});

test("repository capture retains the exact single-hop protected refresh and source marker", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "dormant-successor-capture-")));
  try {
    const repository = path.join(root, "controller");
    const worktreePath = path.join(root, "source");
    const commonDirectory = path.join(root, "git-common");
    const manifestFile = path.join(root, "manifest.json");
    for (const directory of [repository, worktreePath, commonDirectory]) {
      mkdirSync(directory, { recursive: true });
    }
    const manifestInput = {
      schema: "agentic-declared-write-scope/v1",
      semanticScope: "source",
      paths: ["docs/source.md"],
    };
    writeFileSync(manifestFile, JSON.stringify(manifestInput));
    const manifest = normalizeDeclaredWriteScopeManifest(manifestInput);
    const adapterBranch = "agent/test-device.local/source";
    const sourceClaimId = D("source-claim");
    const targetClaimId = D("target-claim");
    const sourceAdmission = {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "source", declaredWriteSet: manifest.declaredWriteSet,
      manifestDigest: manifest.manifestDigest, writeSetDigest: manifest.writeSetDigest,
      planReceiptDigest: D("source-plan"), admissionReceiptDigest: D("source-admission"),
      existingLaneStateDigest: D("source-state"), admittedReportDigest: D("source-report"),
      preservationReceiptDigest: D("source-preservation"),
    };
    const sourceCloudAuthority = {
      schema: "agentic-lane-cloud-authority/v1", canonicalBaseSha: S("8"),
      cloudDeclaredWriteScope: manifest.declaredWriteSet, writeSetDigest: manifest.writeSetDigest,
      claimId: sourceClaimId, claimDigest: D("source-fence"), ledgerRevision: S("6"),
      claimLedgerRevision: D("source-transition"), leaseEpoch: 1,
    };
    const sourceMarkerBase = {
      schema: "agentic-writer-lease/v2", status: "active", epoch: 1, sessionId: "session",
      device: "device.local", scope: "source", branch: adapterBranch, baseSha: S("8"),
      fenceSha: S("9"), autoDelivery: false, runtimeRequired: false,
      heartbeatAt: "2026-08-15T10:00:00.000Z", expiresAt: "2026-08-15T11:00:00.000Z",
      admission: sourceAdmission, cloudAuthority: sourceCloudAuthority,
    };
    const sourceTaskAuthority = createTaskAuthorityBinding({
      capability: createTaskAuthorityCapability({ issuedAt: "2026-08-15T09:00:00.000Z" }),
      lease: sourceMarkerBase,
      boundAt: "2026-08-15T09:01:00.000Z",
    });
    const sourceBindingDigest = sourceTaskAuthority.bindingDigest;
    const targetBindingDigest = D("target-binding");
    const targetOperationReceiptDigest = D("target-operation");
    const lineageCore = {
      schema: "agentic-active-publish-task-authority-successor-receipt/v1",
      branch: adapterBranch, epoch: 2, sourceBaseSha: S("8"), sourceFenceSha: S("9"),
      sourceClaimId, sourceBindingDigest, targetBaseSha: S("5"), targetFenceSha: S("3"),
      targetClaimId, targetBindingDigest, cloudOperationReceiptDigest: targetOperationReceiptDigest,
      cloudVerificationReceiptDigest: D("lineage-verification"), boundAt: AT,
    };
    const lineage = { ...lineageCore, receiptDigest: D(lineageCore) };
    const authority = {
      schema: "agentic-lane-cloud-authority/v1", provider: "fixture",
      ledgerRepository: REPOSITORY, targetRepository: REPOSITORY, claimId: targetClaimId,
      claimDigest: D("target-fence"), ledgerRevision: S("6"), ledgerDigest: D("ledger"),
      claimLedgerRevision: D("target-transition"), entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: targetOperationReceiptDigest, canonicalBaseSha: S("5"),
      laneRevision: S("3"), cloudDeclaredWriteScope: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest,
      deviceId: "device.local", sessionId: "session", reviewRequestId: "review:500",
      leaseEpoch: 2, transitionCounter: 4, heartbeatCounter: 1, state: "active",
      expiresAt: "2026-08-15T11:00:00.000Z",
    };
    const lease = {
      schema: "agentic-writer-lease/v2", status: "active", epoch: 2, sessionId: "session",
      device: "device.local", scope: "source", branch: adapterBranch, worktreePath,
      baseSha: S("5"), fenceSha: S("3"), pullRequestUrl: REVIEW_URL,
      autoDelivery: false, runtimeRequired: false,
      admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
        semanticScope: "source", declaredWriteSet: manifest.declaredWriteSet,
        manifestDigest: manifest.manifestDigest, writeSetDigest: manifest.writeSetDigest },
      cloudAuthority: authority, taskAuthority: { bindingDigest: targetBindingDigest },
      integration: { commitSha: S("7") }, activePublishTaskAuthoritySuccessor: lineage,
      acquiredAt: "2026-08-15T09:00:00.000Z", heartbeatAt: "2026-08-15T10:00:00.000Z",
      expiresAt: "2026-08-15T11:00:00.000Z",
    };
    const targetLeaseDigest = writerLeaseDigest(lease);
    const reconciliation = successorReceipt(targetLeaseDigest, targetBindingDigest,
      lineage.receiptDigest, sourceBindingDigest);
    const reconciliationDirectory = path.join(commonDirectory, "agentic-canvas-os",
      "active-publish-task-authority-successor-reconciliation");
    mkdirSync(reconciliationDirectory, { recursive: true });
    writeFileSync(path.join(reconciliationDirectory, "receipt.json"), JSON.stringify({
      phase: "complete", completion: reconciliation,
    }));
    const sourceMarker = { ...sourceMarkerBase, taskAuthority: sourceTaskAuthority };
    const reviewBody = `Visible source review\n\n<!-- agentic-writer-lease/v2 ${JSON.stringify(sourceMarker)} -->`;
    const claim = {
      claimId: targetClaimId, fenceRevision: authority.claimDigest,
      transitionDigest: authority.claimLedgerRevision, operationReceiptDigest: targetOperationReceiptDigest,
      actorId: "actor:A", deviceId: "device.local", sessionId: "session",
      repositoryId: "repository:R", workItemId: "work-item:source",
      canonicalBaseRevision: S("5"), laneRevision: S("3"),
      declaredWriteScope: manifest.declaredWriteSet, writeSetDigest: manifest.writeSetDigest,
      leaseEpoch: 2, transitionCounter: 4, heartbeatCounter: 1,
      predecessorClaimId: sourceClaimId, reviewRequestId: "review:500",
      state: "dormant-preserved", recordedState: "current", writeAuthority: false,
      scopeReserved: true, expiresAt: "2026-08-15T11:00:00.000Z",
    };
    const overlapCore = { subjectClaimId: targetClaimId,
      subjectWriteSetDigest: manifest.writeSetDigest, competingClaimIds: [],
      noOverlappingCompetitor: true };
    const cloudEvidence = {
      ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
      ledgerRevision: S("6"), ledgerDigest: D("ledger"), ledgerSequence: 9,
      inventoryDigest: D("inventory"), verificationReceiptDigest: D("cloud-verification"),
      claim, overlapProof: { ...overlapCore, overlapProofDigest: D(overlapCore) },
    };
    const review = { id: "review:500", number: 500, url: REVIEW_URL, state: "OPEN",
      isDraft: true, autoMergeRequest: null, headRepository: { nameWithOwner: REPOSITORY },
      headRefName: adapterBranch, headRefOid: S("3"), baseRefName: "main", baseRefOid: S("5"),
      body: reviewBody };
    const git = (cwd, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --git-common-dir") return commonDirectory;
      if (command === "branch --show-current") return "main";
      if (command === "rev-parse HEAD") return cwd === worktreePath ? S("3") : S("1");
      if (command === "rev-parse origin/main") return S("1");
      if (command === "rev-parse HEAD^{tree}") return cwd === worktreePath ? S("4") : S("2");
      if (command === `rev-list --parents -n 1 ${S("3")}`) return `${S("3")} ${S("7")} ${S("5")}`;
      if (command === `merge-tree --write-tree --no-messages ${S("7")} ${S("5")}`) return S("4");
      if (command === `rev-parse ${S("3")}^\{tree\}`) return S("4");
      if (command.startsWith("merge-base --is-ancestor")) return "";
      if (command.startsWith("ls-remote --heads origin ")) {
        const reference = args.at(-1);
        return `${reference.endsWith("/main") ? S("1") : S("3")}\t${reference}`;
      }
      if (command === `rev-parse ${S("1")}:docs/source.md`) return S("a");
      throw new Error(`Unexpected git call: ${cwd} :: ${command}`);
    };
    const gitRaw = (_cwd, args) => {
      if (args.join(" ") === "worktree list --porcelain -z") {
        return `worktree ${worktreePath}\0HEAD ${S("3")}\0branch refs/heads/${adapterBranch}\0`;
      }
      if (args[0] === "status") return "";
      if (args.includes("diff")) return "docs/unrelated.md\0";
      throw new Error(`Unexpected gitRaw call: ${args.join(" ")}`);
    };
    const gh = args => args[0] === "repo" ? REPOSITORY : JSON.stringify(review);
    const adapter = createActivePublishSuccessorDormantRecoveryRepositoryAdapter({
      repository, worktreePath, branch: adapterBranch, sessionId: "session", pullRequestNumber: 500,
      manifestFile,
    }, { git, gitRaw, gh, now: () => new Date(AT), leaseStore: { read: () => lease },
      cloudAdapter: { inspectDormant: () => cloudEvidence } });
    const evidence = adapter.readPlanEvidence();
    assert.deepEqual(evidence.canonicalAdvance.refreshes, [{ previousHeadSha: S("7"),
      refreshedHeadSha: S("3"), mainParentSha: S("5") }]);
    assert.equal(evidence.lease.integrationCommitSha, S("7"));
    assert.equal(writerLeaseDigest(evidence.lease.sourceLease), evidence.lease.leaseDigest);
    assert.equal(evidence.review.visibleBodyDigest, D(
      "Visible source review\n\n<!-- agentic-writer-lease/v2 [hidden] -->",
    ));
    assert.deepEqual(evidence.canonicalAdvance.changedPaths, ["docs/unrelated.md"]);
    assert.equal(evidence.canonicalAdvance.noWriteSetOverlap, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI planning is dependency-injected and rejects authority inputs", async () => {
  const { main } = await import("../scripts/active-publish-successor-dormant-recovery.mjs");
  const plan = Object.freeze({ planDigest: D("plan"), exactAuthorization: "authorize exact" });
  const calls = [];
  const dependencies = {
    createAdapter: options => ({ gitCommonDir: "/git", options }),
    createStore: options => ({ options }),
    createController: ({ adapter, store }) => ({
      plan: async options => { calls.push({ adapter, store, options }); return plan; },
    }),
    writePlan: value => calls.push(value),
  };
  const base = [
    "plan", "--repository=/repo", "--worktree=/worktree", `--branch=${BRANCH}`,
    "--pull-request=500", "--operator-session=session", "--manifest=/tmp/manifest.json",
    "--output=/tmp/plan.json", "--ttl-seconds=600",
  ];
  const result = await main(base, dependencies);
  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, plan.planDigest);
  assert.equal(calls[0].options.ttlSeconds, 600);
  assert.equal(calls[1].file, "/tmp/plan.json");
  await assert.rejects(
    main([...base, "--task-authority=/tmp/private"], dependencies),
    /Planning accepts neither authorization nor task capability/,
  );
});
