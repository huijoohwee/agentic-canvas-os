// Responsibility: prove the repository repair adapter's strict surface and mutation boundary.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  createTaskAuthoritySuccessorProjectionRepairAdapter,
  createRepositoryTaskAuthoritySuccessorProjectionRepairAdapter,
}
  from "../scripts/task-authority-successor-projection-repair-repository-adapter.mjs";
import { projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";

const METHODS = [
  "readEvidence", "withEntrypointFence", "readIntent", "writeIntent", "revalidate",
  "reconcilePhase", "prepareProjection", "assertIrreversibilityBarrier", "promoteSuccessor",
  "bindSuccessor", "projectLease", "projectMarker", "finalizeExpansion", "verifyTerminal",
  "archiveComplete",
];

test("adapter requires and exposes only the complete controller surface", () => {
  for (const missing of METHODS) {
    const methods = Object.fromEntries(METHODS.filter(name => name !== missing)
      .map(name => [name, () => null]));
    assert.throws(() => createTaskAuthoritySuccessorProjectionRepairAdapter(methods),
      new RegExp(`${missing}\\(\\)`));
  }
  const methods = Object.fromEntries(METHODS.map(name => [name, () => name]));
  const adapter = createTaskAuthoritySuccessorProjectionRepairAdapter({ ...methods,
    unauthorized: () => "no" });
  assert.deepEqual(Object.keys(adapter), METHODS);
  assert.equal(Object.isFrozen(adapter), true);
});

test("production adapter keeps Git read-only and uses cooperative projection fences", () => {
  const source = readFileSync(new URL(
    "../scripts/task-authority-successor-projection-repair-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.match(source, /GIT_OPTIONAL_LOCKS:\s*"0"/u);
  assert.match(source, /--no-renames/u);
  assert.match(source, /withReviewedLaneEntrypointFence/u);
  assert.match(source, /withHeartbeatProjectionFence/u);
  assert.match(source, /casWriterLeaseProjection\(\{/u);
  assert.doesNotMatch(source, /\b(?:add|commit|checkout|merge|push|reset|restore|write-tree)\b/u);
  assert.doesNotMatch(source, /mutateWriterLeaseRegistry/u);
  assert.doesNotMatch(source, /registryBeforeRevision|registryAfterDigest/u);
  assert.match(source, /agentic-task-authority-successor-store-transition-operation\/v1/u);
  assert.match(source, /method:"writer-lease-registry-cas\.casWriterLeaseProjection"/u);
  assert.match(source, /authorityEnforcement:"source-barrier\+exact-cas\+target-proof"/u);
  assert.match(source, /targetCapabilityVerificationReceipt:targetProof/u);
  assert.match(source, /target-proof:\$\{plan\.planDigest\}/u);
  assert.match(source, /expansion_finalization_operation/u);
  assert.match(source, /stableMutation/u);
  assert.match(source, /heartbeatCounter:_ignored/u);
  assert.doesNotMatch(source, /heartbeatCounter:claim\.heartbeatCounter/u);
  assert.match(source, /fsyncSync\(descriptor\)/u);
  assert.match(source, /renameSync\(temporary,file\);syncDirectory\(parent\)/u);
});

test("response-loss reconciliation is bound to durable lease and marker operations", () => {
  const source = readFileSync(new URL(
    "../scripts/task-authority-successor-projection-repair-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.match(source, /lease_projection_operation/u);
  assert.match(source, /marker_projection_operation/u);
  assert.match(source, /exactLeaseCandidate/u);
  assert.match(source, /exactMarkerCandidate/u);
  assert.match(source, /allowExpired:\s*true/u);
  assert.match(source, /authorizeTaskBoundLeaseMutation/u);
  assert.match(source, /new Date\(sidecar\.values\.projectedAt\)/u);
});

test("fresh revalidation adopts exactly one promoted, bound, lease, marker, or final effect", t => {
  const fixture = responseLossFixture(t);
  fixture.set("promote");
  assert.doesNotThrow(() => fixture.adapter.readEvidence());
  fixture.set("bind");
  assert.doesNotThrow(() => fixture.adapter.readEvidence());
  const leaseOperation = {
    schema: "agentic-task-authority-successor-store-transition-operation/v1",
    planDigest: fixture.plan.planDigest, branch: fixture.branch,
    sourceLeaseDigest: fixture.sourceDigest,
    targetLeaseDigest: fixture.targetDigest,
    sourceBindingDigest: fixture.sourceBindingDigest,
    continuationBindingDigest: fixture.continuationBindingDigest,
  };
  fixture.writeEffect("lease_projection_operation", { ...leaseOperation,
    operationDigest: digestValue(leaseOperation) });
  fixture.set("lease");
  assert.doesNotThrow(() => fixture.adapter.readEvidence());
  const markerOperation = { schema: "agentic-task-authority-successor-marker-operation/v1",
    planDigest: fixture.plan.planDigest, pullRequestUrl: fixture.pullRequestUrl,
    beforeBodyDigest: fixture.sourceBodyDigest, afterBodyDigest: fixture.targetBodyDigest,
    targetLeaseDigest: fixture.targetDigest };
  fixture.writeEffect("marker_projection_operation", { ...markerOperation,
    receiptDigest: digestValue(markerOperation) });
  fixture.set("marker");
  assert.doesNotThrow(() => fixture.adapter.readEvidence());
  fixture.writeFinalizationEffect();
  fixture.set("final");
  assert.doesNotThrow(() => fixture.adapter.readEvidence());
  fixture.set("marker");
  const drift = structuredClone(fixture.live());
  drift.bodyDigest = "f".repeat(64);
  fixture.replace(drift);
  assert.throws(() => fixture.adapter.readEvidence(), /body|marker/u);
});

test("archive accepts fresh volatile verification only when its terminal subject is exact", t => {
  const fixture = responseLossFixture(t);
  const receipt = (leaseDigest, instant, cloudDigest) => {
    const values = { leaseDigest, authorityDigest: "1".repeat(64), markerDigest: "2".repeat(64),
      bodyDigest: "3".repeat(64), expansionIntentDigest: "4".repeat(64),
      verifiedAt: instant, cloudVerificationReceiptDigest: cloudDigest };
    values.receiptDigest = digestValue(values);
    const core = { schema: "agentic-task-authority-successor-projection-repair-phase-receipt/v1",
      phase: "verified", planDigest: fixture.plan.planDigest, operationKey: "5".repeat(64), values };
    return { ...core, receiptDigest: digestValue(core) };
  };
  const stored = receipt(fixture.targetDigest, "2026-08-13T02:10:00.000Z", "6".repeat(64));
  const fresh = receipt(fixture.targetDigest, "2026-08-13T02:11:00.000Z", "7".repeat(64));
  const intent = { intentDigest: "8".repeat(64), receipt: { receiptDigest: "9".repeat(64) },
    phases: { verified: stored } };
  assert.doesNotThrow(() => fixture.adapter.archiveComplete({ plan: fixture.plan, intent,
    verified: fresh }));
  assert.throws(() => fixture.adapter.archiveComplete({ plan: fixture.plan, intent,
    verified: receipt("a".repeat(64), "2026-08-13T02:12:00.000Z", "b".repeat(64)) }),
  /verification drifted/u);
});

test("lease projection rejects a same-branch source change at the registry CAS", t => {
  const fixture = responseLossFixture(t);
  assert.throws(() => fixture.projectWithLockDrift(), /Writer lease changed/u);
});

function responseLossFixture(t) {
  const D = value => value.repeat(64), S = value => value.repeat(40);
  const branch = "agent/device.local/frozen-repair", sourceClaim = D("1"), targetClaim = D("2");
  const head = S("a"), sourceBase = S("b"), targetBase = S("c"), review = "github-pull-request:PR_node";
  const declaredWriteSet = ["path:scripts/a.mjs", "semantic:frozen-repair"];
  const writeSetDigest = digestValue(declaredWriteSet);
  const capability = createTaskAuthorityCapability({ authoritySubjectId: `urn:agentic-task:${D("3")}`,
    issuedAt: "2026-08-13T01:00:00.000Z" });
  const leaseCore = { schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "session", device: "device.local", scope: "frozen-repair", branch,
    worktreePath: "/source", baseSha: sourceBase, fenceSha: head,
    pullRequestUrl: "https://github.com/o/r/pull/465",
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "frozen-repair", declaredWriteSet, writeSetDigest,
      manifestDigest: D("d"), planReceiptDigest: D("0"), admissionReceiptDigest: D("1"),
      existingLaneStateDigest: D("2"), admittedReportDigest: D("3"),
      preservationReceiptDigest: D("4") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "o/r", targetRepository: "o/r", claimId: sourceClaim,
      claimDigest: D("5"), ledgerRevision: S("e"), ledgerDigest: D("6"),
      claimLedgerRevision: D("7"), canonicalBaseSha: sourceBase, laneRevision: head,
      cloudDeclaredWriteScope: declaredWriteSet, writeSetDigest, deviceId: "device.local",
      sessionId: "session", reviewRequestId: review, leaseEpoch: 1,
      transitionCounter: 1, state: "active", expiresAt: "2026-08-13T03:00:00.000Z",
      operationReceiptDigest: D("8"), integrationReceiptDigest: null, integration: null,
      manifestDigest: D("d") },
    heartbeatAt: "2026-08-13T01:00:00.000Z", expiresAt: "2026-08-13T03:00:00.000Z" };
  const sourceBinding = createTaskAuthorityBinding({ capability, lease: leaseCore,
    boundAt: "2026-08-13T01:00:00.000Z" });
  const sourceLease = Object.freeze({ ...leaseCore, taskAuthority: sourceBinding });
  const sourceDigest = digestValue(sourceLease);
  const boundAuthority = Object.freeze({ ...sourceLease.cloudAuthority, claimId: targetClaim,
    claimDigest: D("8"), canonicalBaseSha: targetBase, transitionCounter: 3,
    reviewRequestId: review });
  const targetAdmission = { schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "frozen-repair", declaredWriteSet, writeSetDigest, manifestDigest: D("d"),
    planReceiptDigest: D("e"), admissionReceiptDigest: boundAuthority.operationReceiptDigest,
    existingLaneStateDigest: D("2"), admittedReportDigest: digestValue({
      schema: "agentic-active-dirty-scope-expansion-admitted-report/v1", planDigest: D("e"),
      claimId: targetClaim, claimDigest: boundAuthority.claimDigest }),
    preservationReceiptDigest: digestValue({
      schema: "agentic-active-dirty-scope-expansion-preservation/v1", planDigest: D("e"),
      sourceAdmissionDigest: digestValue(sourceLease.admission), successorClaimId: targetClaim }) };
  const targetCore = { ...sourceLease, baseSha: targetBase, admission: targetAdmission,
    cloudAuthority: boundAuthority, heartbeatAt: "2026-08-13T02:00:00.000Z",
    expiresAt: boundAuthority.expiresAt };
  const targetBinding = createTaskAuthorityBinding({ capability, lease: targetCore,
    bindingMode: "continuation", priorBindingDigest: sourceBinding.bindingDigest,
    boundAt: "2026-08-13T02:00:00.000Z" });
  const targetLease = Object.freeze({ ...targetCore, taskAuthority: targetBinding });
  const targetDigest = digestValue(targetLease);
  const sourceBody = updateWriterLeasePullRequestBody("repair", sourceLease);
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, targetLease);
  const sourceMarker = digestValue(projectWriterLeasePullRequestMarker(sourceLease));
  const targetMarker = digestValue(projectWriterLeasePullRequestMarker(targetLease));
  const sourcePull = { url: leaseCore.pullRequestUrl, number: 465, nodeId: "PR_node",
    repository: "o/r", author: "owner", state: "OPEN", isDraft: true,
    headRefName: branch, headRefOid: head, baseRefName: "main", body: sourceBody };
  const expectedPull = { url: sourcePull.url, number: 465, nodeId: sourcePull.nodeId,
    repository: "o/r", author: "owner", state: "OPEN", isDraft: true, branch,
    headSha: head, baseBranch: "main", markerDigest: sourceMarker,
    bodyDigest: digestValue(sourceBody) };
  const dirt = Object.freeze({ exact: "bytes" });
  const snapshot = { headSha: head, treeSha: S("d"), remoteHeadSha: head, indexStateDigest: D("4") };
  const expansion = { status: "source-retired", sourceLeaseDigest: sourceDigest,
    sourceClaimId: sourceClaim, targetClaimId: targetClaim, targetCanonicalBaseSha: targetBase,
    planSnapshot: { targetDeclaredWriteSet: declaredWriteSet, targetWriteSetDigest: writeSetDigest,
      targetManifestDigest: D("d"), planDigest: D("e") }, planDigest: D("e") };
  const waitingCore = { claimId: targetClaim, claimDigest: D("5"), state: "waiting-successor",
    writeAuthority: false, scopeReserved: false, canonicalBaseRevision: targetBase,
    laneRevision: head, writeSetDigest, leaseEpoch: 1, transitionCounter: 1,
    predecessorClaimId: sourceClaim, reviewRequestId: null,
    expiresAt: "2026-08-13T05:00:00.000Z", operationReceiptDigest: D("7") };
  const successor = { ...waitingCore, claimRecordDigest: digestValue(waitingCore) };
  const plan = { planDigest: D("a"), evidence: { source: { lease: sourceLease,
    leaseDigest: sourceDigest, binding: sourceBinding,
    snapshot: { ...snapshot, snapshotDigest: digestValue(snapshot) }, currentDirt: dirt },
  expansion: { intent: expansion,
    intentDigest: digestValue(expansion) }, cloud: { successor }, pullRequest: expectedPull } };
  const promoted = { claimId: targetClaim, claimDigest: D("9"), ledgerRevision: S("e"),
    claimLedgerRevision: D("b"), transitionCounter: 2,
    expiresAt: waitingCore.expiresAt, operationReceiptDigest: waitingCore.operationReceiptDigest };
  const bound = { ...boundAuthority, transitionCounter: 3 };
  const prepared = { projectedAt: "2026-08-13T02:00:00.000Z", continuationBinding: targetBinding,
    sourceLeaseDigest: sourceDigest, sourceBindingDigest: sourceBinding.bindingDigest };
  const boundReceipt = D("e");
  const mutationCore = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: targetClaim, claimDigest: bound.claimDigest, ledgerRevision: bound.ledgerRevision,
    localLeaseEpoch: targetLease.epoch, localFenceSha: head, remoteLeaseEpoch: bound.leaseEpoch,
    cloudVerificationReceiptDigest: D("f"), evaluatedAt: "2026-08-13T02:01:00.000Z",
    expiresAt: bound.expiresAt };
  const mutationAuthority = { ...mutationCore, receiptDigest: digestValue(mutationCore) };
  const mutationReceipt = mutationAuthority.receiptDigest;
  const intents = {
    promote: { status: "projection_prepared", phases: { projection_prepared: { values: prepared } } },
    bind: { status: "successor_promoted", phases: { projection_prepared: { values: prepared },
      successor_promoted: { values: promoted } } },
    lease: { status: "successor_bound", phases: { projection_prepared: { values: prepared },
      successor_promoted: { values: promoted }, successor_bound: { values: { authority: bound,
        cloudVerificationReceiptDigest: boundReceipt } } } },
    marker: { status: "lease_projected", phases: { projection_prepared: { values: prepared },
      successor_promoted: { values: promoted }, successor_bound: { values: { authority: bound,
        cloudVerificationReceiptDigest: boundReceipt } },
      lease_projected: { values: { targetLeaseDigest: targetDigest } } } },
    final: { status: "marker_projected", phases: { projection_prepared: { values: prepared },
      successor_promoted: { values: promoted }, successor_bound: { values: { authority: bound,
        cloudVerificationReceiptDigest: boundReceipt } },
      lease_projected: { values: { targetLeaseDigest: targetDigest } },
      marker_projected: { values: { markerDigest: targetMarker,
        bodyDigest: digestValue(targetBody) } } } },
  };
  const claims = {
    promote: { ...waitingCore, state: "active", writeAuthority: true, scopeReserved: true,
      transitionCounter: 2, fenceRevision: promoted.claimDigest, transitionDigest: D("b"),
      reviewRequestId: null },
    bind: { ...waitingCore, state: "active", writeAuthority: true, scopeReserved: true,
      transitionCounter: 3, fenceRevision: bound.claimDigest, transitionDigest: D("c"),
      reviewRequestId: review },
  };
  const pullReceipt = digestValue({ schema: "agentic-active-dirty-scope-expansion-pr-projection/v1",
    planDigest: expansion.planDigest, pullRequestUrl: sourcePull.url, markerDigest: targetMarker });
  const finalReceipt = digestValue({ schema: "agentic-active-dirty-scope-expansion-complete/v1",
    planDigest: expansion.planDigest, mutationAuthorityReceiptDigest: mutationReceipt,
    pullRequestMarkerDigest: targetMarker });
  const completeExpansion = { ...expansion, status: "complete", targetClaimDigest: bound.claimDigest,
    targetReviewRequestId: bound.reviewRequestId, promoted: { claimId: promoted.claimId,
      claimDigest: promoted.claimDigest, ledgerRevision: promoted.ledgerRevision,
      claimLedgerRevision: promoted.claimLedgerRevision, transitionCounter: promoted.transitionCounter,
      expiresAt: promoted.expiresAt }, promotedReceiptDigest: promoted.operationReceiptDigest,
    boundAuthority: bound, boundReceiptDigest: boundReceipt,
    localProjection: { leaseDigest: targetDigest, claimId: targetClaim, receiptDigest: mutationReceipt },
    localProjectionReceiptDigest: mutationReceipt, pullRequestProjection: { markerDigest: targetMarker },
    pullRequestProjectionReceiptDigest: pullReceipt, finalReceiptDigest: finalReceipt };
  const finalizationCore = {
    schema: "agentic-task-authority-successor-expansion-finalization-operation/v1",
    planDigest: plan.planDigest, branch, sourceExpansionIntentDigest: digestValue(expansion),
    targetLeaseDigest: targetDigest, targetClaimId: targetClaim, markerDigest: targetMarker,
    mutationAuthorityReceipt: mutationAuthority,
    mutationAuthorityReceiptDigest: mutationAuthority.receiptDigest,
    terminalExpansionIntentDigest: digestValue(completeExpansion),
  };
  const finalizationOperation = { ...finalizationCore, operationDigest: digestValue(finalizationCore) };
  const root = mkdtempSync(path.join(tmpdir(), "successor-adapter-"));
  const common = path.join(root, "common"), capabilityFile = path.join(root, "capability.json");
  mkdirSync(common); writeFileSync(capabilityFile, JSON.stringify(capability), { mode: 0o600 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const operationRoot = path.join(common, "agentic-canvas-os", "task-authority-successor-projection-repair",
    `${digestValue({ root, session: "session", target: "o/r", pullNumber: 465 })}.json.effects`);
  let mode = "promote", current;
  const makeLive = name => { const target = ["lease", "marker", "final"].includes(name);
    const claim = name === "promote" ? claims.promote : claims.bind;
    const lease = target ? targetLease : sourceLease, body = ["marker", "final"].includes(name) ? targetBody : sourceBody;
    return { branch, lease, leaseDigest: digestValue(lease), binding: lease.taskAuthority,
      expansion: name === "final" ? completeExpansion : expansion,
      expansionDigest: digestValue(name === "final" ? completeExpansion : expansion),
      dirt, pull: { ...sourcePull, body }, markerDigest: target ? targetMarker : sourceMarker,
      bodyDigest: digestValue(body), cloud: { claims: [claim], ledgerRevision: S("e") }, headSha: head,
      treeSha: snapshot.treeSha, remoteHeadSha: head, indexStateDigest: snapshot.indexStateDigest } };
  current = makeLive(mode);
  const sourceRegistry = { schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [branch]: sourceLease }, scopeExpansionIntents: { [branch]: expansion } };
  let lockRegistry = sourceRegistry;
  const store = { statePath: path.join(common, "writer-leases.json"),
    withRegistryLock(action) { return action(lockRegistry); }, readRegistry() { return sourceRegistry; } };
  const adapter = createRepositoryTaskAuthoritySuccessorProjectionRepairAdapter({ sourceRepository: root,
    sessionId: "session", capabilityFile, pullRequestNumber: 465, targetRepository: "o/r",
    execute: (_program, args) => args.includes("remote.origin.url") ? "https://github.com/o/r.git" : common,
    leaseStore: store,
    captureLiveState: () => current });
  ;return { adapter, plan, branch, sourceDigest, targetDigest,
    sourceBindingDigest: sourceBinding.bindingDigest,
    continuationBindingDigest: targetBinding.bindingDigest,
    pullRequestUrl: sourcePull.url, sourceBodyDigest: digestValue(sourceBody),
    targetBodyDigest: digestValue(targetBody),
    projectWithLockDrift() { current = makeLive("bind"); lockRegistry = { ...sourceRegistry,
      leases: { [branch]: { ...sourceLease, heartbeatAt: "2026-08-13T01:01:00.000Z" } } };
      return adapter.projectLease({ plan, intent: intents.lease }); },
    set(name) { mode = name; current = makeLive(name); const intent = { ...intents[name], planSnapshot: plan,
      planDigest: plan.planDigest }; mkdirSync(path.dirname(operationRoot), { recursive: true });
      writeFileSync(operationRoot.slice(0, -8), JSON.stringify({
      schema: "agentic-task-authority-successor-projection-repair-journal/v2", intent,
      intentDigest: digestValue(intent) })); }, replace(value) { current = value; }, live: () => current,
    writeEffect(name, value) { mkdirSync(path.dirname(operationRoot), { recursive: true });
      writeFileSync(`${operationRoot}.${name}.json`, JSON.stringify(value)); },
    writeFinalizationEffect() { mkdirSync(path.dirname(operationRoot), { recursive: true });
      writeFileSync(`${operationRoot}.expansion_finalization_operation.json`,
        JSON.stringify(finalizationOperation)); } };
}
