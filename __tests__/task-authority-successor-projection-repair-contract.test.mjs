import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeWriteSet }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
  projectTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES as PHASES,
  advanceTaskAuthoritySuccessorProjectionRepairIntent as advance,
  authorizeTaskAuthoritySuccessorProjectionRepair as authorize,
  buildTaskAuthoritySuccessorProjectionRepairPlan as buildPlan,
  buildTaskAuthoritySuccessorProjectionRepairReceipt as buildReceipt,
  createTaskAuthoritySuccessorProjectionRepairIntent as createIntent,
  normalizeTaskAuthoritySuccessorProjectionRepairIntent as normalizeIntent,
  normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt as normalizePhase,
  normalizeTaskAuthoritySuccessorProjectionRepairReceipt as normalizeReceipt,
  sealTaskAuthoritySuccessorProjectionRepairEvidence as sealEvidence,
} from "../scripts/task-authority-successor-projection-repair-contract.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";

const D = character => character.repeat(64);
const S = character => character.repeat(40);
const NOW = "2026-08-13T07:30:00.000Z";
const EXPIRY = "2026-08-13T09:30:00.000Z";

test("exact evidence, authorization, continuation, phases, and receipt form one chain", () => {
  const fixture = makeFixture();
  const { plan } = fixture;
  assert.deepEqual(PHASES, ["prepared", "projection_prepared", "successor_promoted",
    "successor_bound", "lease_projected", "marker_projected", "expansion_finalized",
    "verified", "complete"]);
  assert.throws(() => authorize(plan, `${plan.exactAuthorization} `), /authorization/u);
  let intent = createIntent(plan, authorize(plan, plan.exactAuthorization));
  for (const [phase, values] of fixture.phaseValues) {
    const receipt = phaseReceipt(plan, phase, values);
    intent = advance(intent, phase, receipt);
    assert.equal(normalizeIntent(intent).status, phase);
  }
  const final = buildReceipt({ intent, verified: intent.phases.verified });
  const complete = advance(intent, "complete", final);
  assert.equal(normalizeIntent(complete).status, "complete");
  assert.deepEqual(normalizeReceipt(complete.receipt, intent), final);
  assert.equal(final.sourceMutation, false);
  assert.equal(final.gitMutation, false);
});

test("current dirt is separately sealed and must remain inside both C1 and C2", () => {
  const fixture = makeFixture();
  const changed = structuredClone(fixture.evidence);
  changed.source.currentDirt.changedPaths.push("outside.txt");
  changed.source.currentDirt.changedPaths.sort();
  const dirt = { ...changed.source.currentDirt };
  delete dirt.dirtyDigest;
  changed.source.currentDirt.dirtyDigest = digestValue(dirt);
  assert.throws(() => sealEvidence(changed), /current dirt join|evidence joins/u);

  const removed = structuredClone(fixture.evidence);
  removed.source.dirtReconciliation.removedPaths = ["scripts/a.mjs"];
  const core = { ...removed.source.dirtReconciliation };
  delete core.receiptDigest;
  removed.source.dirtReconciliation.receiptDigest = digestValue(core);
  assert.throws(() => sealEvidence(removed), /evidence joins/u);
});

test("phase values and continuation lineage cannot be self-asserted or skipped", () => {
  const fixture = makeFixture();
  const authority = authorize(fixture.plan, fixture.plan.exactAuthorization);
  const prepared = createIntent(fixture.plan, authority);
  const projection = phaseReceipt(fixture.plan, "projection_prepared",
    fixture.phaseValues[0][1]);
  assert.throws(() => advance(prepared, "successor_promoted",
    phaseReceipt(fixture.plan, "successor_promoted", fixture.phaseValues[1][1])),
  /phase order/u);
  const altered = structuredClone(projection);
  altered.values.receiptDigest = D("f");
  const outer = { ...altered };
  delete outer.receiptDigest;
  altered.receiptDigest = digestValue(outer);
  assert.throws(() => normalizePhase({ plan: fixture.plan,
    phase: "projection_prepared", value: altered }), /values digest/u);
});

function makeFixture() {
  const branch = "agent/katrinas-macbook-pro.local/repair-source";
  const scope = "repair-source";
  const sourceClaimId = D("1");
  const successorClaimId = D("2");
  const sourceBase = S("a");
  const head = S("b");
  const targetBase = S("c");
  const sourceSet = normalizeWriteSet([
    "path:scripts/a.mjs", "path:scripts/b.mjs", `semantic:${scope}`,
  ]);
  const targetSet = normalizeWriteSet([
    ...sourceSet, "path:scripts/writer-lease-lib.mjs",
  ]);
  const sourceWriteSetDigest = digestValue(sourceSet);
  const targetWriteSetDigest = digestValue(targetSet);
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${D("3")}`,
    generation: 1,
    issuedAt: "2026-08-13T01:00:00.000Z",
  });
  const sourceAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    targetRepository: "huijoohwee/agentic-canvas-os", claimId: sourceClaimId,
    claimDigest: D("0"), ledgerRevision: S("0"), ledgerDigest: D("1"),
    claimLedgerRevision: D("1"), entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: D("2"), mutationAuthorityEligible: true,
    canonicalBaseSha: sourceBase, laneRevision: head, cloudDeclaredWriteScope: sourceSet,
    writeSetDigest: sourceWriteSetDigest, deviceId: "katrinas-macbook-pro.local",
    sessionId: "repair-session", reviewRequestId: "github-pull-request:PR_node",
    leaseEpoch: 1, transitionCounter: 5, state: "active", expiresAt: EXPIRY,
    integrationReceiptDigest: null, integration: null, manifestDigest: D("4"),
    heartbeatCounter: 3,
  };
  const leaseCore = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 9,
    sessionId: "repair-session", device: "katrinas-macbook-pro.local", scope, branch,
    worktreePath: "/tmp/repair-source", baseSha: sourceBase, fenceSha: head,
    pullRequestUrl: "https://github.com/huijoohwee/agentic-canvas-os/pull/465",
    autoDelivery: true, runtimeRequired: true,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: scope, declaredWriteSet: sourceSet,
      writeSetDigest: sourceWriteSetDigest, manifestDigest: D("4") },
    cloudAuthority: sourceAuthority,
    acquiredAt: "2026-08-13T01:00:00.000Z",
    heartbeatAt: "2026-08-13T01:00:00.000Z",
    expiresAt: "2026-08-13T02:00:00.000Z",
  };
  const binding = createTaskAuthorityBinding({ capability, lease: leaseCore,
    boundAt: "2026-08-13T01:00:00.000Z" });
  const lease = { ...leaseCore, taskAuthority: binding };
  const expansionPlanCore = {
    schema: "agentic-active-dirty-scope-expansion-plan/v1",
    sourceDirtyDigest: D("5"), sourceChangedPaths: ["scripts/a.mjs"],
    sourceWriteSetDigest, sourceManifestDigest: D("4"),
    targetCanonicalBaseSha: targetBase, targetWriteSetDigest,
    targetManifestDigest: D("6"), targetDeclaredWriteSet: targetSet,
  };
  const expansionPlan = { ...expansionPlanCore, planDigest: digestValue(expansionPlanCore) };
  const successorCore = {
    claimId: successorClaimId, claimDigest: D("7"), state: "waiting-successor",
    writeAuthority: false, scopeReserved: false, canonicalBaseRevision: targetBase,
    laneRevision: head, writeSetDigest: targetWriteSetDigest, leaseEpoch: 1,
    transitionCounter: 1, predecessorClaimId: sourceClaimId, reviewRequestId: null,
    expiresAt: EXPIRY, operationReceiptDigest: D("8"),
  };
  const successor = { ...successorCore, claimRecordDigest: digestValue(successorCore) };
  const expansionIntent = {
    schema: "agentic-active-dirty-scope-expansion-intent/v1", status: "source-retired",
    sourceLeaseDigest: digestValue(lease), sourceClaimId, sourceFenceSha: head,
    targetClaimId: successorClaimId, targetClaimDigest: successor.claimDigest,
    targetWriteSetDigest, targetManifestDigest: expansionPlan.targetManifestDigest,
    targetCanonicalBaseSha: targetBase, planDigest: expansionPlan.planDigest,
    waiting: { claimId: successorClaimId }, planSnapshot: expansionPlan,
  };
  const currentCore = {
    changedPaths: ["scripts/a.mjs", "scripts/b.mjs"],
    stagedPaths: ["scripts/a.mjs", "scripts/b.mjs"], unstagedPaths: [], untrackedPaths: [],
    stagedPatchDigest: D("9"), unstagedPatchDigest: D("a"), indexEntriesDigest: D("b"),
  };
  const currentDirt = { ...currentCore, dirtyDigest: digestValue(currentCore) };
  const reconciliationCore = { historicalDirtyDigest: expansionPlan.sourceDirtyDigest,
    historicalChangedPaths: expansionPlan.sourceChangedPaths,
    currentDirtyDigest: currentDirt.dirtyDigest, addedPaths: ["scripts/b.mjs"],
    removedPaths: [], commonPaths: ["scripts/a.mjs"] };
  const snapshotCore = { headSha: head, treeSha: S("d"), remoteHeadSha: head,
    indexStateDigest: D("c") };
  const projected = projectTaskAuthorityCapability(capability);
  const rawEvidence = {
    schema: "agentic-task-authority-successor-projection-repair-evidence/v2",
    repository: "/tmp/repair-source", branch, sessionId: lease.sessionId,
    source: { lease, leaseDigest: digestValue(lease), binding,
      snapshot: { ...snapshotCore, snapshotDigest: digestValue(snapshotCore) },
      currentDirt, dirtReconciliation: { ...reconciliationCore,
        receiptDigest: digestValue(reconciliationCore) } },
    expansion: { intent: expansionIntent, intentDigest: digestValue(expansionIntent) },
    cloud: { ledgerRevision: S("e"), ledgerDigest: D("d"), successor,
      inventoryDigest: D("e") },
    pullRequest: { url: lease.pullRequestUrl, number: 465, nodeId: "PR_node",
      repository: "huijoohwee/agentic-canvas-os", author: "huijoohwee", state: "OPEN",
      isDraft: true, branch, headSha: head, baseBranch: "main",
      markerDigest: D("f"), bodyDigest: D("0") },
    capability: { authoritySubjectId: projected.authoritySubjectId,
      proofAdapterId: projected.proofAdapterId, generation: projected.generation,
      publicKeyDigest: projected.publicKeyDigest, bindingDigest: binding.bindingDigest },
  };
  const evidence = sealEvidence(rawEvidence);
  const plan = buildPlan(evidence);
  const projectedAt = NOW;
  const prospectiveLane = { branch, scope, device: lease.device, epoch: lease.epoch,
    baseSha: targetBase, cloudClaimId: successorClaimId };
  const minimal = { branch, scope, device: lease.device, epoch: lease.epoch,
    baseSha: targetBase, cloudAuthority: { claimId: successorClaimId } };
  const continuation = createTaskAuthorityBinding({ capability, lease: minimal,
    bindingMode: "continuation", priorBindingDigest: binding.bindingDigest,
    boundAt: projectedAt });
  const bound = { ...sourceAuthority, claimId: successorClaimId, claimDigest: D("1"),
    ledgerRevision: S("1"), ledgerDigest: D("2"), claimLedgerRevision: D("2"),
    operationReceiptDigest: D("3"), canonicalBaseSha: targetBase, laneRevision: head,
    cloudDeclaredWriteScope: targetSet, writeSetDigest: targetWriteSetDigest,
    reviewRequestId: "github-pull-request:PR_node", state: "active", transitionCounter: 3,
    expiresAt: EXPIRY, manifestDigest: expansionPlan.targetManifestDigest };
  delete bound.heartbeatCounter;
  const targetLease = { ...lease, baseSha: targetBase,
    admission: { ...lease.admission, declaredWriteSet: targetSet,
      writeSetDigest: targetWriteSetDigest, manifestDigest: expansionPlan.targetManifestDigest },
    cloudAuthority: bound, heartbeatAt: projectedAt, expiresAt: EXPIRY,
    taskAuthority: continuation };
  const markerDigest = digestValue(projectWriterLeasePullRequestMarker(targetLease));
  const capabilityOperation = `task-authority-successor-projection-repair:prepare:${plan.planDigest}`;
  const capabilityReceiptCore = { authoritySubjectId: binding.authoritySubjectId,
    bindingDigest: binding.bindingDigest, proofDigest: D("2"),
    operation: capabilityOperation, verifiedAt: projectedAt };
  const capabilityVerificationReceipt = {
    schema: "agentic-task-authority-verification-receipt/v1", status: "verified",
    authoritySubjectId: binding.authoritySubjectId, proofAdapterId: binding.proofAdapterId,
    generation: binding.generation, bindingDigest: binding.bindingDigest,
    proofDigest: D("2"), operation: capabilityOperation, verifiedAt: projectedAt,
    receiptDigest: digestValue(capabilityReceiptCore),
  };
  const storeOperation = { schema: "agentic-task-authority-successor-store-transition-operation/v1",
    planDigest: plan.planDigest, branch, sourceLeaseDigest: digestValue(lease),
    targetLeaseDigest: digestValue(targetLease), sourceBindingDigest: binding.bindingDigest,
    continuationBindingDigest: continuation.bindingDigest };
  const targetProofOperation = `task-authority-successor-projection-repair:target-proof:${plan.planDigest}`;
  const targetProofCore = { authoritySubjectId: continuation.authoritySubjectId,
    bindingDigest: continuation.bindingDigest, proofDigest: D("6"),
    operation: targetProofOperation, verifiedAt: projectedAt };
  const targetCapabilityVerificationReceipt = {
    schema: "agentic-task-authority-verification-receipt/v1", status: "verified",
    authoritySubjectId: continuation.authoritySubjectId,
    proofAdapterId: continuation.proofAdapterId, generation: continuation.generation,
    bindingDigest: continuation.bindingDigest, proofDigest: D("6"),
    operation: targetProofOperation, verifiedAt: projectedAt,
    receiptDigest: digestValue(targetProofCore),
  };
  const storeTransitionCore = { schema: "agentic-task-authority-successor-store-transition/v1",
    planDigest: plan.planDigest, branch,
    method: "writer-lease-registry-cas.casWriterLeaseProjection",
    authorityEnforcement: "source-barrier+exact-cas+target-proof",
    sourceLeaseDigest: digestValue(lease),
    targetLeaseDigest: digestValue(targetLease), sourceBindingDigest: binding.bindingDigest,
    continuationBindingDigest: continuation.bindingDigest,
    operationDigest: digestValue(storeOperation), frozenIncidentOnly: true,
    targetCapabilityVerificationReceipt };
  const mutationAuthorityReceiptDigest = D("c");
  const expansionFinalReceiptDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-complete/v1",
    planDigest: expansionIntent.planDigest,
    mutationAuthorityReceiptDigest,
    pullRequestMarkerDigest: markerDigest,
  });
  const values = [
    ["projection_prepared", inner({ sourceLeaseDigest: digestValue(lease),
      sourceBindingDigest: binding.bindingDigest, prospectiveLane,
      prospectiveLaneDigest: digestValue(prospectiveLane), continuationBinding: continuation,
      capabilityVerificationReceipt,
      projectedAt, expiresAt: EXPIRY, expansionIntentDigest: digestValue(expansionIntent) })],
    ["successor_promoted", inner({ claimId: successorClaimId, claimDigest: bound.claimDigest,
      transitionCounter: 2, state: "active", writeAuthority: true, scopeReserved: true,
      operationReceiptDigest: D("3"), claimLedgerRevision: D("4"),
      ledgerRevision: S("4"), expiresAt: EXPIRY })],
    ["successor_bound", inner({ authority: bound, authorityDigest: digestValue(bound),
      reviewRequestId: bound.reviewRequestId, cloudVerificationReceiptDigest: D("5") })],
    ["lease_projected", inner({ sourceLeaseDigest: digestValue(lease), targetLease,
      targetLeaseDigest: digestValue(targetLease), continuationBinding: continuation,
      storeTransitionReceipt: { ...storeTransitionCore,
        receiptDigest: digestValue(storeTransitionCore) },
      expansionIntentDigest: digestValue(expansionIntent) })],
    ["marker_projected", inner({ pullRequestUrl: lease.pullRequestUrl,
      pullRequestNodeId: "PR_node", leaseDigest: digestValue(targetLease),
      markerDigest, bodyDigest: D("9"), beforeBodyDigest: D("0") })],
    ["expansion_finalized", inner({ expansionIntentDigest: D("a"),
      expansionFinalReceiptDigest, status: "complete",
      mutationAuthorityReceiptDigest })],
    ["verified", inner({ sourceSnapshotDigest: digestValue(snapshotCore),
      currentDirtDigest: currentDirt.dirtyDigest, leaseDigest: digestValue(targetLease),
      authorityDigest: digestValue(bound), markerDigest, bodyDigest: D("9"),
      expansionIntentDigest: D("a"), claimId: successorClaimId, verifiedAt: NOW,
      cloudVerificationReceiptDigest: D("d") })],
  ];
  return { capability, evidence, plan, phaseValues: values };
}

function inner(core) { return { ...core, receiptDigest: digestValue(core) }; }
function phaseReceipt(plan, phase, values) {
  const core = { schema: "agentic-task-authority-successor-projection-repair-phase-receipt/v1",
    phase, planDigest: plan.planDigest,
    operationKey: digestValue({
      schema: "agentic-task-authority-successor-projection-repair-phase-receipt/v1",
      planDigest: plan.planDigest, phase,
    }), values };
  return { ...core, receiptDigest: digestValue(core) };
}
