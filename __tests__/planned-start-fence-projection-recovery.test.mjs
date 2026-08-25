import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildPlannedStartFenceProjectionRecoveryEvidence }
  from "../scripts/planned-start-fence-projection-recovery-evidence.mjs";
import { buildPlannedStartFenceProjectionRecoveryPlan }
  from "../scripts/planned-start-fence-projection-recovery-contract.mjs";
import { createPlannedStartFenceProjectionRecoveryController }
  from "../scripts/planned-start-fence-projection-recovery-controller.mjs";

const D = value => digestValue({ value });
const S = value => value.repeat(40);

test("exact same-claim t1 base to t2 fence projects locally and preserves the descendant", async () => {
  const fixture = controllerFixture();
  const result = await fixture.controller.run({ plan: fixture.plan });
  assert.equal(result.writerRegistryDisposition, "projected");
  assert.equal(result.writerRegistryMutation, true);
  assert.equal(fixture.plan.evidence.gitObservations[0].authoredDescendantDigest,
    D("authored-range"));
  assertForbiddenEffects(result);
  assert.equal(fixture.calls.filter(value => value === "project").length, 1);
});

test("exact provenance-bound t1 base to t3 response-ahead fence projects locally", async () => {
  const input = evidenceInput({ responseAhead: true });
  const evidence = buildPlannedStartFenceProjectionRecoveryEvidence(input);
  assert.equal(evidence.sourceCloudAuthority.transitionCounter, 1);
  assert.equal(evidence.targetCloudAuthority.transitionCounter, 3);
  assert.equal(evidence.targetCloudObservation.claim.recovery.evidenceDigest,
    D("response-ahead-recovery"));
});

test("unrelated ledger-head advance preserves the exact subject and overlap join", () => {
  const input = evidenceInput({ responseAhead: true });
  input.cloudObservations[1].ledgerRevision = S("7");
  input.cloudObservations[1].ledgerDigest = D("later-unrelated-ledger");
  input.cloudObservations[1].inventoryDigest = D("later-nonoverlapping-inventory");
  const evidence = buildPlannedStartFenceProjectionRecoveryEvidence(input);
  assert.equal(evidence.targetCloudObservation.claim.claimId, D("claim"));
  assert.deepEqual(evidence.targetCloudObservation.overlappingClaimIds, []);
});

test("exact dormant t3 projects only its expired historical fence", () => {
  const input = evidenceInput({ responseAhead: true });
  eachCloud(input, item => {
    item.claim.state = "dormant-preserved";
    item.claim.writeAuthority = false;
    item.claim.expiresAt = "2026-08-16T00:01:30.000Z";
  });
  const evidence = buildPlannedStartFenceProjectionRecoveryEvidence(input);
  assert.equal(evidence.targetCloudObservation.claim.state, "dormant-preserved");
  assert.equal(evidence.targetCloudAuthority.state, "active");
  assert.equal(Date.parse(evidence.targetCloudAuthority.expiresAt)
    < Date.parse(evidence.observedAt), true);
});

test("terminal replay and post-CAS response loss retain cumulative mutation causality", async () => {
  const replay = controllerFixture();
  const first = await replay.controller.run({ plan: replay.plan });
  const second = await replay.controller.run({ plan: replay.plan });
  assert.deepEqual(second, first);
  assert.equal(replay.calls.filter(value => value === "project").length, 1);

  const lost = controllerFixture({ responseLoss: "target" });
  const adopted = await lost.controller.run({ plan: lost.plan });
  assert.equal(adopted.writerRegistryDisposition, "adopted-response-loss");
  assert.equal(adopted.writerRegistryMutation, true);
  assert.equal(lost.calls.filter(value => value === "project").length, 1);
  assertForbiddenEffects(adopted);
});

test("response-loss reconciliation rejects any third registry state", async () => {
  const fixture = controllerFixture({ responseLoss: "third" });
  await assert.rejects(fixture.controller.run({ plan: fixture.plan }), /response lost/u);
  assert.equal(fixture.intent().status, "local-attempted");
});

test("evidence rejects transition, owner, base, scope, descendant, and boundary drift", () => {
  const cases = [
    ["claim", input => eachCloud(input, item => { item.claim.claimId = D("foreign"); })],
    ["transition", input => eachCloud(input, item => { item.claim.transitionCounter += 1; })],
    ["response-ahead without provenance", input => eachCloud(input, item => {
      item.claim.transitionCounter = 3;
      delete item.claim.recovery;
    })],
    ["later response-ahead", input => eachCloud(input, item => {
      item.claim.transitionCounter = 4;
      item.claim.recovery = { evidenceDigest: D("response-ahead-recovery"),
        recoveredAt: "2026-08-16T00:01:30.000Z" };
    })],
    ["base", input => eachCloud(input,
      item => { item.claim.canonicalBaseRevision = S("9"); })],
    ["scope", input => eachCloud(input, item => {
      item.claim.declaredWriteScope = ["path:docs/other.md"];
      item.claim.writeSetDigest = digestValue(item.claim.declaredWriteScope);
    })],
    ["owner", input => input.leaseObservations.forEach(
      item => { item.cloudAuthority.sessionId = "other-session"; })],
    ["descendant", input => input.gitObservations.forEach(item => { item.fenceSha = S("8"); })],
    ["out-of-scope descendant", input => input.gitObservations.forEach(
      item => { item.changedPaths = ["path:docs/other.md"]; })],
    ["overlap", input => eachCloud(input,
      item => { item.overlappingClaimIds = [D("peer")]; })],
    ["boundary", input => { input.mutationBoundary = {
      allowedMutations: ["git"], forbiddenEffects: [],
    }; }],
  ];
  for (const [name, mutate] of cases) {
    const input = evidenceInput();
    mutate(input);
    assert.throws(() => buildPlannedStartFenceProjectionRecoveryEvidence(input), undefined, name);
  }
});

function controllerFixture({ responseLoss = null } = {}) {
  const plan = buildPlannedStartFenceProjectionRecoveryPlan({
    evidence: buildPlannedStartFenceProjectionRecoveryEvidence(evidenceInput()),
  });
  let intent = null;
  const calls = [];
  const adapter = {
    readPlanEvidence() { return plan.evidence; },
    withOperationLock(action) { calls.push("lock"); return action(); },
    readIntent() { calls.push("read"); return intent; },
    writeIntent({ expected, value }) { assert.equal(intent, expected); intent = value;
      calls.push(`write:${value.status}`); },
    authorizeTask() { calls.push("authority"); return authorityValues(plan); },
    revalidate(_plan, stage) {
      calls.push(`revalidate:${stage}`);
      if (stage === "after-local-error") return responseLoss === "target"
        ? { localProjected: true, values: projectedValues(plan, "adopted-response-loss") }
        : { localProjected: false };
      return attemptedValues(plan);
    },
    projectLocal() { calls.push("project");
      if (responseLoss) throw new Error("registry response lost");
      return projectedValues(plan, "projected"); },
    verifyTerminal(_plan, { replay }) { calls.push(`verify:${replay}`);
      return verifiedValues(plan, replay); },
  };
  return { controller: createPlannedStartFenceProjectionRecoveryController(adapter),
    plan, calls, intent: () => intent };
}

function authorityValues(plan) {
  return { taskAuthorityBindingDigest: plan.evidence.taskCapabilityDigest,
    taskAuthorityReceiptDigest: D("task-authority") };
}
function attemptedValues(plan) {
  return { idempotencyKey: D("local-attempt"), sourceLeaseDigest: plan.sourceLeaseDigest,
    targetLeaseDigest: plan.targetLeaseDigest };
}
function projectedValues(plan, disposition) {
  return { disposition, writerRegistryMutation: true,
    sourceLeaseDigest: plan.sourceLeaseDigest,
    targetLeaseDigest: plan.targetLeaseDigest, registryRevision: 12,
    recoveryReceiptDigest: D("recovery"),
    mutationAuthorityReceiptDigest: D("mutation-authority") };
}
function verifiedValues(plan, replay) {
  return { targetLeaseDigest: plan.targetLeaseDigest, recoveryReceiptDigest: D("recovery"),
    registryRevision: 12,
    verificationDigest: D("terminal-verification") };
}

function evidenceInput({ responseAhead = false } = {}) {
  const baseSha = S("a"), fenceSha = S("b"), headSha = S("c");
  const writeSet = ["path:docs/runtime.md", "semantic:planned-fence"];
  const sourceAuthority = { schema: "agentic-lane-cloud-authority/v1", state: "active",
    claimId: D("claim"), claimDigest: D("source-fence"),
    canonicalBaseSha: baseSha, laneRevision: baseSha, leaseEpoch: 3,
    transitionCounter: 1, heartbeatCounter: 0, writeSetDigest: digestValue(writeSet),
    cloudDeclaredWriteScope: writeSet, reviewRequestId: null,
    ledgerRevision: S("f"), operationReceiptDigest: D("source-operation"),
    deviceId: "owner-device", sessionId: "owner-session" };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "owner-session", device: "owner-device", scope: "planned-fence",
    branch: "agent/owner/planned-fence", worktreePath: "/owned/worktree",
    baseSha, fenceSha, pullRequestUrl: "https://provider.test/reviews/12",
    integration: null, heartbeatAt: "2026-08-16T00:00:00.000Z",
    expiresAt: "2026-08-16T00:01:00.000Z",
    admission: { schema: "agentic-lane-admission-lease/v1", status: "planned",
      semanticScope: "planned-fence", declaredWriteSet: writeSet,
      writeSetDigest: digestValue(writeSet), manifestDigest: D("manifest") },
    cloudAuthority: sourceAuthority,
    taskAuthority: { bindingDigest: D("task-binding") } };
  const targetTransitionCounter = responseAhead ? 3 : 2;
  const targetAuthority = { ...sourceAuthority, claimDigest: D("target-fence"),
    laneRevision: fenceSha, transitionCounter: targetTransitionCounter,
    reviewRequestId: "github-pull-request:PR_12",
    operationReceiptDigest: D("target-operation") };
  const claim = { entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    claimId: sourceAuthority.claimId, fenceRevision: targetAuthority.claimDigest,
    transitionDigest: D("transition"), transitionCounter: targetTransitionCounter, heartbeatCounter: 0,
    state: "current", writeAuthority: true, scopeReserved: true,
    canonicalBaseRevision: baseSha, laneRevision: fenceSha, leaseEpoch: 3,
    declaredWriteScope: writeSet, writeSetDigest: digestValue(writeSet),
    reviewRequestId: "github-pull-request:PR_12",
    deviceId: "owner-device", sessionId: "owner-session",
    operationReceiptDigest: targetAuthority.operationReceiptDigest,
    expiresAt: "2026-08-16T01:00:00.000Z" };
  if (responseAhead) claim.recovery = { evidenceDigest: D("response-ahead-recovery"),
    recoveredAt: "2026-08-16T00:01:30.000Z" };
  const cloud = { status: "ready", evaluatedAt: "2026-08-16T00:02:00.000Z",
    claim, ledgerRevision: S("d"),
    ledgerDigest: D("ledger"), inventoryDigest: D("inventory"),
    verificationReceiptDigest: D("cloud-verification"), overlappingClaimIds: [] };
  const git = { branch: lease.branch, localHeadSha: headSha, localTreeSha: S("e"), fenceSha,
    worktreePath: lease.worktreePath, registered: true, clean: true,
    remoteHeadSha: fenceSha, indexTreeSha: S("e"), statusDigest: D("clean"),
    authoredDescendantDigest: D("authored-range"), changedPaths: ["path:docs/runtime.md"] };
  const pullRequest = { id: "PR_12", number: 12, url: lease.pullRequestUrl,
    state: "OPEN", isDraft: true, autoMergeRequest: null, branch: lease.branch,
    reviewRequestId: "github-pull-request:PR_12", headSha: fenceSha, baseSha,
    bodyDigest: D("body"), markerDigest: D("marker") };
  return { repository: "example/repository", observedAt: "2026-08-16T00:02:00.000Z",
    leaseObservations: [structuredClone(lease), structuredClone(lease)],
    cloudObservations: [structuredClone(cloud), structuredClone(cloud)],
    gitObservations: [structuredClone(git), structuredClone(git)],
    pullRequestObservations: [structuredClone(pullRequest), structuredClone(pullRequest)],
    taskCapabilityDigest: lease.taskAuthority.bindingDigest };
}

function eachCloud(input, mutate) { input.cloudObservations.forEach(mutate); }

function assertForbiddenEffects(result) {
  for (const field of ["cloudMutation", "providerMutation", "gitMutation",
    "indexMutation", "remoteRefMutation", "sourceMutation", "pullRequestMutation",
    "pullRequestStateMutation", "newClaimCreated", "newWorktreeCreated", "mergeMutation",
    "deploymentMutation", "cleanupMutation"]) {
    assert.equal(result[field], false, field);
  }
}
