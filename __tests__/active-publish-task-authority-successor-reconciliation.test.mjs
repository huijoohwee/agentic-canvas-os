import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildCompletion, buildReconciliationPlan, normalizeReconciliationPlan, operationForPlan } from "../scripts/active-publish-task-authority-successor-reconciliation-contract.mjs";
import { createActivePublishTaskAuthoritySuccessorReconciliationController } from "../scripts/active-publish-task-authority-successor-reconciliation-controller.mjs";
import { buildReconciliationEvidence, reconciliationEvidenceReplaySubjectDigest } from "../scripts/active-publish-task-authority-successor-reconciliation-evidence.mjs";
import { createActivePublishTaskAuthoritySuccessorReconciliationRepositoryAdapter } from "../scripts/active-publish-task-authority-successor-reconciliation-repository-adapter.mjs";
import { continueActivePublishTaskAuthoritySuccessor } from "../scripts/active-publish-task-authority-successor.mjs";
import { createTaskAuthorityLeaseBinding, writeTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-store.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const D = value => digestValue(value);
const V1 = "agentic-active-publish-task-authority-successor-reconciliation-journal/v1";
const V2 = "agentic-active-publish-task-authority-successor-reconciliation-journal/v2";
const LEGACY_PLAN_DIGEST = "fa5de551a44b6327bec7dd9b2bf0d4fec9c0891c90d8318b983df66781f31151";
const LEGACY_JOURNAL_DIGEST = "6ae5a76c82ed12d892ce95fb00397c1ca8e0013f961a30d2a7f313a3a79f8140";
const LEGACY_JOURNAL = Object.freeze({ schema: V1, planDigest: LEGACY_PLAN_DIGEST, phase: "prepared", values: {} });
const SOURCE_BASE = "3".repeat(40);
const SOURCE_FENCE = "4".repeat(40);
const TARGET_BASE = "5".repeat(40);
const TARGET_FENCE = "1".repeat(40);
const INITIAL_PROTECTED = "2".repeat(40);
const REFRESHED_PROTECTED = "6".repeat(40);
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "active-publish-reconciliation-")));
const capabilityPath = path.join(root, "capability.json");
writeTaskAuthorityCapability({ outputPath: capabilityPath, issuedAt: "2026-08-15T00:00:00.000Z" });
after(() => rmSync(root, { recursive: true, force: true }));

function runtimeFixture({ observedAt = "2026-08-15T07:00:00.000Z", repository = "/repo", declaredWriteSet = ["path:scripts/planned-fence-only-admission-recovery.mjs"] } = {}) {
  const branch = "agent/device/lane";
  const pullRequestUrl = "https://github.com/o/r/pull/500";
  const sourceClaim = D("source");
  const targetClaim = D("target");
  const admissionCore = { schema: "agentic-lane-admission-lease/v1", status: "admitted", semanticScope: "active-publish-successor-replay-stability", declaredWriteSet, writeSetDigest: D(declaredWriteSet), manifestDigest: D("manifest") };
  const sourceAdmission = { ...admissionCore, admissionReceiptDigest: D("source-admission") };
  const targetAdmission = { ...admissionCore, admissionReceiptDigest: D("target-admission") };
  const sourceAuthority = { claimId: sourceClaim, canonicalBaseSha: SOURCE_BASE, laneRevision: SOURCE_FENCE, leaseEpoch: 1, deviceId: "device", sessionId: "session", reviewRequestId: null, writeSetDigest: admissionCore.writeSetDigest, operationReceiptDigest: D("source-operation") };
  const sourceCore = { schema: "agentic-writer-lease/v2", status: "active", epoch: 7, sessionId: "session", device: "device", scope: admissionCore.semanticScope, branch, worktreePath: repository, pullRequestUrl, baseSha: SOURCE_BASE, fenceSha: SOURCE_FENCE, admission: sourceAdmission, cloudAuthority: sourceAuthority };
  const sourceLease = { ...sourceCore, taskAuthority: createTaskAuthorityLeaseBinding({ lease: sourceCore, capabilityPath, boundAt: "2026-08-15T00:00:01.000Z" }) };
  const recovery = { status: "recovered", sourceClaimId: sourceClaim, sourceFenceSha: SOURCE_FENCE };
  const targetLease = { ...sourceLease, baseSha: TARGET_BASE, fenceSha: TARGET_FENCE, admission: targetAdmission, cloudAuthority: { ...sourceAuthority, claimId: targetClaim, canonicalBaseSha: TARGET_BASE, laneRevision: TARGET_FENCE, leaseEpoch: 2, operationReceiptDigest: D("target-operation") }, activeOwnedDirtRecovery: recovery };
  const pullRequest = { number: 500, id: "PR_node", url: pullRequestUrl, state: "OPEN", isDraft: true, autoMergeRequest: null, headRefName: branch, headRefOid: TARGET_FENCE, baseRefName: "main" };
  const evidence = buildReconciliationEvidence({ observedAt, repository, branch, sessionId: "session", pullRequest, canonical: { protectedRevision: INITIAL_PROTECTED, sourceBaseSha: SOURCE_BASE, changedPaths: ["docs/a.md"], changedPathsDigest: D(["docs/a.md"]) }, source: { claimId: sourceClaim, baseSha: SOURCE_BASE, fenceSha: SOURCE_FENCE, bindingDigest: sourceLease.taskAuthority.bindingDigest, laneBindingDigest: sourceLease.taskAuthority.laneBindingDigest, leaseEpoch: 1 }, target: { claimId: targetClaim, baseSha: TARGET_BASE, fenceSha: TARGET_FENCE, operationReceiptDigest: targetLease.cloudAuthority.operationReceiptDigest, verificationReceiptDigest: targetAdmission.admissionReceiptDigest, leaseEpoch: 2, predecessorClaimId: sourceClaim, cloudState: "dormant-preserved" }, leaseDigest: writerLeaseDigest(targetLease) });
  const plan = buildReconciliationPlan(evidence);
  const recoveredSource = { ...sourceLease, activeOwnedDirtRecovery: recovery };
  const continued = continueActivePublishTaskAuthoritySuccessor({ sourceLease: recoveredSource, targetLease, cloudOperationReceiptDigest: targetLease.cloudAuthority.operationReceiptDigest, cloudVerificationReceiptDigest: targetAdmission.admissionReceiptDigest, boundAt: "2026-08-15T07:00:30.000Z" });
  const prepared = { sourceLeaseDigest: writerLeaseDigest(recoveredSource), expectedLeaseDigest: writerLeaseDigest(targetLease), expectedClaimId: targetClaim, priorTaskAuthority: sourceLease.taskAuthority, binding: continued.binding, receipt: continued.receipt };
  const projectedLease = { ...targetLease, taskAuthority: continued.binding, activePublishTaskAuthoritySuccessor: continued.receipt };
  const projected = { ...prepared, targetBindingDigest: continued.binding.bindingDigest, successorReceiptDigest: continued.receipt.receiptDigest, targetLeaseDigest: writerLeaseDigest(projectedLease), registryRevision: 4 };
  const terminal = { targetBindingDigest: projected.targetBindingDigest, successorReceiptDigest: projected.successorReceiptDigest, targetLeaseDigest: projected.targetLeaseDigest, registryRevision: projected.registryRevision, verifiedAt: "2026-08-15T07:01:00.000Z" };
  return { branch, repository, pullRequest, sourceLease, targetLease, projectedLease, evidence, plan, prepared, projected, terminal };
}

function taskReceipt(fixture, plan = fixture.plan) {
  const binding = fixture.sourceLease.taskAuthority;
  const core = { authoritySubjectId: binding.authoritySubjectId, bindingDigest: binding.bindingDigest, proofDigest: D("task-proof"), operation: operationForPlan(plan), verifiedAt: "2026-08-15T07:00:10.000Z" };
  return { schema: "agentic-task-authority-verification-receipt/v1", status: "verified", authoritySubjectId: core.authoritySubjectId, proofAdapterId: binding.proofAdapterId, generation: binding.generation, ...core, receiptDigest: D(core) };
}

function fakeAdapter(fixture = runtimeFixture()) {
  let journal = null;
  let projections = 0;
  let authorizations = 0;
  const writes = [];
  return {
    captureEvidence: () => fixture.evidence,
    authorizeTask: plan => { authorizations += 1; return taskReceipt(fixture, plan); },
    prepareProjection: () => fixture.prepared,
    projectRegistry: () => { projections += 1; return fixture.projected; },
    verifyTerminal: () => fixture.terminal,
    readJournal: () => structuredClone(journal),
    writeJournal: value => { journal = structuredClone(value); writes.push(structuredClone(value)); },
    withOperationLock: action => action(),
    seed: value => { journal = structuredClone(value); writes.length = 0; },
    journal: () => structuredClone(journal), writes: () => structuredClone(writes), projections: () => projections, authorizations: () => authorizations,
  };
}

function authorize(controller, plan = controller.plan()) { return controller.run({ plan, authorization: `authorize active-publish-task-authority-successor-reconciliation ${plan.planDigest}` }); }
function legacyProjection(projection) { const { priorTaskAuthority: _omitted, ...legacy } = projection; return legacy; }
function v1Prepared(planDigest) { return { schema: V1, planDigest, phase: "prepared", values: {} }; }
function sealV2(core) { return { ...core, journalDigest: D(core) }; }
function reseal(value) { const { journalDigest: _old, ...core } = value; return sealV2(core); }

test("plan is stable and replay subject omits only observation metadata", () => {
  const fixture = runtimeFixture();
  assert.deepEqual(normalizeReconciliationPlan(fixture.plan), fixture.plan);
  assert.throws(() => normalizeReconciliationPlan({ ...fixture.plan, planDigest: D("wrong") }), /invalid plan digest/);
  const reobserved = buildReconciliationEvidence({ ...fixture.evidence, observedAt: "2026-08-15T07:02:00.000Z" });
  assert.equal(reconciliationEvidenceReplaySubjectDigest(fixture.evidence), reconciliationEvidenceReplaySubjectDigest(reobserved));
  const advanced = buildReconciliationEvidence({ ...reobserved, canonical: { ...reobserved.canonical, protectedRevision: REFRESHED_PROTECTED } });
  assert.notEqual(reconciliationEvidenceReplaySubjectDigest(fixture.evidence), reconciliationEvidenceReplaySubjectDigest(advanced));
});

test("fresh exact authorization writes sealed v2 once and complete replay is inert", () => {
  const fixture = runtimeFixture();
  const adapter = fakeAdapter(fixture);
  const controller = createActivePublishTaskAuthoritySuccessorReconciliationController(adapter);
  const first = authorize(controller, fixture.plan);
  assert.equal(adapter.writes()[0].phase, "task-authority-verified");
  const writeCount = adapter.writes().length;
  const replay = authorize(controller, fixture.plan);
  assert.equal(first.receiptDigest, replay.receiptDigest);
  assert.equal(adapter.projections(), 1);
  assert.equal(adapter.writes().length, writeCount);
  assert.equal(adapter.journal().schema, V2);
  assert.equal(adapter.journal().phase, "complete");
  assert.deepEqual(adapter.journal().history, []);
  assert.equal(first.cloudMutation, false);
  assert.equal(first.authoringAuthorityGranted, false);
});

test("wrong or literal legacy authorization has zero writes, proof, or projection", () => {
  const fixture = runtimeFixture();
  for (const authorization of ["no", `authorize active-publish-task-authority-successor-reconciliation ${LEGACY_PLAN_DIGEST}`]) {
    const adapter = fakeAdapter(fixture);
    const controller = createActivePublishTaskAuthoritySuccessorReconciliationController(adapter);
    assert.throws(() => controller.run({ plan: fixture.plan, authorization }), /Exact authorization required/);
    assert.deepEqual([adapter.writes().length, adapter.authorizations(), adapter.projections()], [0, 0, 0]);
  }
});

test("same-plan legacy v1 pre-CAS fails closed while projected state finishes without schema widening", () => {
  const fixture = runtimeFixture();
  for (const journal of [
    v1Prepared(fixture.plan.planDigest),
    { schema: V1, planDigest: fixture.plan.planDigest, phase: "task-authority-verified", values: { taskAuthorityReceipt: taskReceipt(fixture) } },
    { schema: V1, planDigest: fixture.plan.planDigest, phase: "registry-attempted", values: { taskAuthorityReceipt: taskReceipt(fixture), projection: legacyProjection(fixture.prepared) } },
  ]) {
    const blocked = fakeAdapter(fixture);
    blocked.seed(journal);
    assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(blocked), fixture.plan), /Legacy v1 pre-CAS/);
    assert.deepEqual([blocked.writes().length, blocked.authorizations(), blocked.projections()], [0, 0, 0]);
  }
  const adapter = fakeAdapter(fixture);
  adapter.seed({ schema: V1, planDigest: fixture.plan.planDigest, phase: "registry-projected", values: { taskAuthorityReceipt: taskReceipt(fixture), projection: legacyProjection(fixture.projected) } });
  authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(adapter), fixture.plan);
  for (const write of adapter.writes()) {
    assert.equal(write.schema, V1);
    assert.equal("history" in write, false);
    assert.equal("evidenceDigest" in write, false);
    if (write.values.projection) assert.equal("priorTaskAuthority" in write.values.projection, false);
  }
  const before = adapter.writes().length;
  authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(adapter), fixture.plan);
  assert.equal(adapter.writes().length, before);
});

test("a pristine legacy v1 journal is superseded into digest-linked v2 history", () => {
  const fixture = runtimeFixture();
  const adapter = fakeAdapter(fixture);
  const legacy = LEGACY_JOURNAL;
  assert.equal(D(legacy), LEGACY_JOURNAL_DIGEST);
  adapter.seed(legacy);
  authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(adapter), fixture.plan);
  const firstWrite = adapter.writes()[0];
  assert.equal(firstWrite.schema, V2);
  assert.equal(firstWrite.phase, "task-authority-verified");
  assert.deepEqual(firstWrite.history, [{ previousPlanDigest: LEGACY_PLAN_DIGEST, previousEvidenceDigest: null, previousJournalDigest: LEGACY_JOURNAL_DIGEST }]);
});

test("fresh v2 creation and legacy supersession reobserve the exact live subject before their first write", () => {
  const fixture = runtimeFixture();
  for (const seed of [null, LEGACY_JOURNAL]) {
    const adapter = fakeAdapter(fixture);
    if (seed) adapter.seed(seed);
    adapter.captureEvidence = () => buildReconciliationEvidence({ ...fixture.evidence, canonical: { ...fixture.evidence.canonical, protectedRevision: REFRESHED_PROTECTED } });
    assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(adapter), fixture.plan), /changed before the first v2 journal write/);
    assert.deepEqual([adapter.writes().length, adapter.authorizations(), adapter.projections()], [0, 0, 0]);
  }
});

test("v2 predecessors are immutable and cyclic or oversized histories are rejected", () => {
  const fixture = runtimeFixture();
  const prior = sealV2({ schema: V2, planDigest: D("prior-plan"), evidenceDigest: D("prior-evidence"), phase: "prepared", values: {}, history: [] });
  const immutable = fakeAdapter(fixture);
  immutable.seed(prior);
  assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(immutable), fixture.plan), /already owns/);
  assert.deepEqual([immutable.writes().length, immutable.authorizations(), immutable.projections()], [0, 0, 0]);

  const ancestorCore = { schema: V2, planDigest: D("ancestor-plan"), evidenceDigest: D("ancestor-evidence"), phase: "prepared", values: {}, history: [] };
  const buried = sealV2({ schema: V2, planDigest: fixture.plan.planDigest, evidenceDigest: fixture.plan.evidence.evidenceDigest, phase: "task-authority-verified", values: { taskAuthorityReceipt: taskReceipt(fixture) }, history: [{ previousPlanDigest: ancestorCore.planDigest, previousEvidenceDigest: ancestorCore.evidenceDigest, previousJournalDigest: D(ancestorCore) }] });
  const buriedAdapter = fakeAdapter(fixture);
  buriedAdapter.seed(buried);
  assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(buriedAdapter), fixture.plan), /v2 journal history predecessor/);
  assert.deepEqual([buriedAdapter.writes().length, buriedAdapter.authorizations(), buriedAdapter.projections()], [0, 0, 0]);

  const legacyEntry = previousPlanDigest => ({ previousPlanDigest, previousEvidenceDigest: null, previousJournalDigest: D(v1Prepared(previousPlanDigest)) });
  const multiple = sealV2({ schema: V2, planDigest: fixture.plan.planDigest, evidenceDigest: fixture.plan.evidence.evidenceDigest, phase: "task-authority-verified", values: { taskAuthorityReceipt: taskReceipt(fixture) }, history: [legacyEntry(D("legacy-one")), legacyEntry(D("legacy-two"))] });
  const multipleAdapter = fakeAdapter(fixture);
  multipleAdapter.seed(multiple);
  assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(multipleAdapter), fixture.plan), /journal history chronology/);
  assert.deepEqual([multipleAdapter.writes().length, multipleAdapter.authorizations(), multipleAdapter.projections()], [0, 0, 0]);

  const cycleOwner = D("cycle-owner");
  const returning = v1Prepared(cycleOwner);
  const cyclicEntry = { previousPlanDigest: cycleOwner, previousEvidenceDigest: null, previousJournalDigest: D(returning) };
  const cyclicCore = { schema: V2, planDigest: cycleOwner, evidenceDigest: D("cycle-evidence"), phase: "prepared", values: {}, history: [cyclicEntry] };
  const rejected = fakeAdapter(fixture);
  rejected.seed(sealV2(cyclicCore));
  assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(rejected), fixture.plan), /ping-pong/);
  assert.deepEqual([rejected.writes().length, rejected.authorizations(), rejected.projections()], [0, 0, 0]);

  const oversized = fakeAdapter(fixture);
  oversized.seed(sealV2({ schema: V2, planDigest: D("oversized-plan"), evidenceDigest: D("oversized-evidence"), phase: "prepared", values: {}, history: Array.from({ length: 129 }, () => ({})) }));
  assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(oversized), fixture.plan), /journal history/);
  assert.equal(oversized.writes().length, 0);
});

test("non-pristine, completion-bearing, malformed, and tampered histories are immutable", () => {
  const fixture = runtimeFixture();
  const validTask = taskReceipt(fixture);
  const malformedV2 = sealV2({ schema: V2, planDigest: D("malformed-plan"), evidenceDigest: D("malformed-evidence"), phase: "prepared", values: {}, history: [] });
  malformedV2.journalDigest = D("wrong-journal");
  const badLink = { previousPlanDigest: D("linked-plan"), previousEvidenceDigest: null, previousJournalDigest: D("wrong-link") };
  const badHistory = sealV2({ schema: V2, planDigest: D("history-owner"), evidenceDigest: D("history-evidence"), phase: "prepared", values: {}, history: [badLink] });
  const cases = [
    { ...v1Prepared(D("nonempty")), values: { unexpected: true } },
    { schema: V1, planDigest: D("later"), phase: "task-authority-verified", values: { taskAuthorityReceipt: validTask } },
    { ...v1Prepared(D("completion-bearing")), completion: {} },
    { ...v1Prepared(D("extra-key")), extra: true },
    malformedV2,
    badHistory,
  ];
  for (const value of cases) {
    const adapter = fakeAdapter(fixture);
    adapter.seed(value);
    assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(adapter), fixture.plan));
    assert.deepEqual([adapter.writes().length, adapter.authorizations(), adapter.projections()], [0, 0, 0]);
  }
});

test("same-plan forged or resealed complete journals fail before terminal return", () => {
  const fixture = runtimeFixture();
  for (const schema of [V1, V2]) {
    const source = fakeAdapter(fixture);
    authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(source), fixture.plan);
    const completed = source.journal();
    const forged = schema === V1 ? { schema: V1, planDigest: completed.planDigest, phase: "complete", values: { ...completed.values, projection: legacyProjection(completed.values.projection) }, completion: completed.completion } : completed;
    forged.completion = { ...forged.completion, targetLeaseDigest: D("forged-target") };
    const sealed = schema === V2 ? reseal(forged) : forged;
    const replay = fakeAdapter(fixture);
    replay.seed(sealed);
    assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(replay), fixture.plan), /invalid completion/);
    assert.deepEqual([replay.writes().length, replay.authorizations(), replay.projections()], [0, 0, 0]);
  }
});

test("golden legacy v1 complete accepts its protected two-verification timestamps", () => {
  const fixture = runtimeFixture();
  const firstTerminal = { ...fixture.terminal, verifiedAt: "2026-08-15T07:01:00.000Z" };
  const completionVerifiedAt = "2026-08-15T07:01:01.000Z";
  const receipt = taskReceipt(fixture);
  const completion = buildCompletion({ plan: fixture.plan, taskAuthorityReceipt: receipt, projection: firstTerminal, verifiedAt: completionVerifiedAt });
  const legacy = { schema: V1, planDigest: fixture.plan.planDigest, phase: "complete", values: { taskAuthorityReceipt: receipt, projection: legacyProjection(fixture.projected), terminal: firstTerminal }, completion };
  const adapter = fakeAdapter(fixture);
  adapter.seed(legacy);
  const result = authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(adapter), fixture.plan);
  assert.equal(result.verifiedAt, completionVerifiedAt);
  assert.deepEqual([adapter.writes().length, adapter.authorizations(), adapter.projections()], [0, 0, 0]);

  const earlier = fakeAdapter(fixture);
  const earlierAt = "2026-08-15T07:00:59.000Z";
  earlier.seed({ ...legacy, completion: buildCompletion({ plan: fixture.plan, taskAuthorityReceipt: receipt, projection: firstTerminal, verifiedAt: earlierAt }) });
  assert.throws(() => authorize(createActivePublishTaskAuthoritySuccessorReconciliationController(earlier), fixture.plan), /legacy completion chronology/);
  assert.equal(earlier.writes().length, 0);
});

test("protected fast-forward and paired provider drift fail before task proof", () => {
  const fastForward = repositoryFixture();
  const plan = buildReconciliationPlan(fastForward.adapter.captureEvidence());
  fastForward.advanceProtectedMain();
  assert.throws(() => fastForward.adapter.authorizeTask(plan, "proof"), /evidence changed/);
  assert.equal(fastForward.authorizations(), 0);

  const providerDrift = repositoryFixture();
  const driftPlan = buildReconciliationPlan(providerDrift.adapter.captureEvidence());
  providerDrift.driftProviderDuringNextCapture();
  assert.throws(() => providerDrift.adapter.authorizeTask(driftPlan, "proof"), /changed during capture|evidence changed/);
  assert.equal(providerDrift.authorizations(), 0);
});

test("repository response-loss replay adopts one exact branch across disjoint registry revisions", () => {
  const fixture = repositoryFixture();
  const plan = buildReconciliationPlan(fixture.adapter.captureEvidence());
  const prepared = fixture.adapter.prepareProjection(plan);
  fixture.installProjected(prepared, 19);
  fixture.advanceGlobalRevisionOnSecondSnapshot();
  const result = fixture.adapter.projectRegistry(plan, prepared);
  assert.equal(result.registryRevision, 20);
  assert.equal(result.targetBindingDigest, prepared.binding.bindingDigest);
  assert.deepEqual([fixture.registryWrites(), fixture.authorizations()], [0, 0]);

  const legacy = repositoryFixture();
  const legacyPlan = buildReconciliationPlan(legacy.adapter.captureEvidence());
  const legacyPrepared = legacy.adapter.prepareProjection(legacyPlan);
  legacy.installProjected(legacyPrepared, 21);
  assert.throws(() => legacy.adapter.projectRegistry(legacyPlan, legacyProjection(legacyPrepared)), /Legacy v1 registry response loss/);
  assert.equal(legacy.registryWrites(), 0);
});

test("authorization-time protected drift and projected-branch drift have zero registry writes", () => {
  const callbackDrift = repositoryFixture();
  const plan = buildReconciliationPlan(callbackDrift.adapter.captureEvidence());
  const prepared = callbackDrift.adapter.prepareProjection(plan);
  callbackDrift.driftProtectedOnAuthorize();
  assert.throws(() => callbackDrift.adapter.projectRegistry(plan, prepared), /evidence changed/);
  assert.equal(callbackDrift.registryWrites(), 0);

  const projectedDrift = repositoryFixture();
  const projectedPlan = buildReconciliationPlan(projectedDrift.adapter.captureEvidence());
  const projectedPrepared = projectedDrift.adapter.prepareProjection(projectedPlan);
  projectedDrift.installProjected(projectedPrepared, 23, { receiptDigest: D("different-receipt") });
  assert.throws(() => projectedDrift.adapter.projectRegistry(projectedPlan, projectedPrepared), /response-loss subject changed/);
  assert.equal(projectedDrift.registryWrites(), 0);

  const snapshotDrift = repositoryFixture();
  const snapshotPlan = buildReconciliationPlan(snapshotDrift.adapter.captureEvidence());
  const snapshotPrepared = snapshotDrift.adapter.prepareProjection(snapshotPlan);
  snapshotDrift.installProjected(snapshotPrepared, 24);
  snapshotDrift.driftBranchOnSecondSnapshot();
  assert.throws(() => snapshotDrift.adapter.projectRegistry(snapshotPlan, snapshotPrepared), /branch changed during response-loss adoption/);
  assert.equal(snapshotDrift.registryWrites(), 0);
});

test("protected changed-path capture preserves hostile bytes and fences exact overlap", () => {
  const cases = [
    { owned: "path: leading.md", changed: " leading.md", sibling: " leading.md-sibling" },
    { owned: "path:dir/multi\nline.md", changed: "dir/multi\nline.md", sibling: "dir/multi\nline.md-sibling" },
  ];
  for (const { owned, changed, sibling } of cases) {
    const overlap = repositoryFixture({ declaredWriteSet: [owned], protectedChangedPaths: [changed] });
    assert.throws(() => overlap.adapter.captureEvidence(), /overlaps the successor write authority/);
    const disjoint = repositoryFixture({ declaredWriteSet: [owned], protectedChangedPaths: [sibling] });
    assert.deepEqual(disjoint.adapter.captureEvidence().canonical.changedPaths, [sibling]);
  }
});

function repositoryFixture({ declaredWriteSet, protectedChangedPaths = ["docs/a.md"] } = {}) {
  const fixture = runtimeFixture({ declaredWriteSet });
  let protectedRevision = INITIAL_PROTECTED;
  let registry = { schema: "agentic-writer-lease-registry/v2", revision: 8, leases: { [fixture.branch]: fixture.targetLease } };
  let registryWrites = 0;
  let authorizationCount = 0;
  let driftOnAuthorize = false;
  let pullReads = 0;
  let driftPullAt = null;
  let lockReads = 0;
  let driftLockAt = null;
  let advanceRevisionLockAt = null;
  const leaseStore = { statePath: path.join(root, "unused-writer-leases.json"), read: branch => registry.leases[branch] || null, readRegistry: () => structuredClone(registry), withRegistryLock: action => { lockReads += 1; if (lockReads === driftLockAt) registry = { ...registry, leases: { ...registry.leases, [fixture.branch]: { ...registry.leases[fixture.branch], heartbeatAt: "2026-08-15T07:02:00.000Z" } } }; if (lockReads === advanceRevisionLockAt) registry = { ...registry, revision: registry.revision + 1 }; return action(structuredClone(registry)); } };
  const git = args => {
    const command = args.join(" ");
    if (command === "branch --show-current") return fixture.branch;
    if (command === "rev-parse --git-common-dir") return ".git";
    if (command === "status --porcelain=v2 --untracked-files=all") return "";
    if (command === "rev-parse HEAD" || command === `rev-parse refs/remotes/origin/${fixture.branch}`) return TARGET_FENCE;
    if (command === `rev-parse ${SOURCE_FENCE}^`) return SOURCE_BASE;
    if (command === `rev-parse ${SOURCE_BASE}^{tree}` || command === `rev-parse ${SOURCE_FENCE}^{tree}`) return "8".repeat(40);
    if (command === "rev-parse refs/remotes/origin/main") return protectedRevision;
    if (command === `merge-base --is-ancestor ${SOURCE_BASE} ${protectedRevision}`) return "";
    throw new Error(`Unexpected git call: ${command}`);
  };
  const gitRaw = args => {
    const expected = ["--no-replace-objects", "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", SOURCE_BASE, protectedRevision, "--"];
    assert.deepEqual(args, expected);
    return protectedChangedPaths.length ? `${protectedChangedPaths.join("\0")}\0` : "";
  };
  const gh = () => { pullReads += 1; const drift = driftPullAt && pullReads >= driftPullAt; return JSON.stringify({ ...fixture.pullRequest, baseRefName: drift ? "changed-base" : "main" }); };
  const journal = { read: () => null, write() {}, withLock: action => action(), project() { registryWrites += 1; throw new Error("unexpected registry write"); } };
  const adapter = createActivePublishTaskAuthoritySuccessorReconciliationRepositoryAdapter({ repository: fixture.repository, pullRequestNumber: 500, sessionId: "session", taskAuthorityFile: capabilityPath }, { realpath: value => value, git, gitRaw, gh, now: () => new Date("2026-08-15T07:00:00.000Z"), leaseStore, journal, inspectCloud: () => ({ state: "dormant-preserved" }), authorize: () => { authorizationCount += 1; if (driftOnAuthorize) protectedRevision = REFRESHED_PROTECTED; return { receiptDigest: D("authorized") }; } });
  return {
    adapter,
    authorizations: () => authorizationCount,
    registryWrites: () => registryWrites,
    advanceProtectedMain() { protectedRevision = REFRESHED_PROTECTED; },
    driftProtectedOnAuthorize() { driftOnAuthorize = true; },
    driftProviderDuringNextCapture() { driftPullAt = pullReads + 2; },
    driftBranchOnSecondSnapshot() { driftLockAt = lockReads + 2; },
    advanceGlobalRevisionOnSecondSnapshot() { advanceRevisionLockAt = lockReads + 2; },
    installProjected(prepared, revision, receiptChanges = {}) { registry = { ...registry, revision, leases: { ...registry.leases, [fixture.branch]: { ...fixture.targetLease, taskAuthority: prepared.binding, activePublishTaskAuthoritySuccessor: { ...prepared.receipt, ...receiptChanges } } } }; },
  };
}
