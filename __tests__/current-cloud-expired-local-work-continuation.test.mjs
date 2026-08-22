import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import { buildCurrentCloudExpiredLocalWorkContinuationEvidence }
  from "../scripts/current-cloud-expired-local-work-continuation-evidence.mjs";
import { buildCurrentCloudExpiredLocalWorkContinuationPlan }
  from "../scripts/current-cloud-expired-local-work-continuation-contract.mjs";
import { createCurrentCloudExpiredLocalWorkContinuationController }
  from "../scripts/current-cloud-expired-local-work-continuation-controller.mjs";
import { createRepositoryCurrentCloudExpiredLocalWorkContinuationAdapter,
  normalizeCurrentCloudContinuationClaim }
  from "../scripts/current-cloud-expired-local-work-continuation-repository-adapter.mjs";

const D = value => digestValue({ value });
const S = value => value.repeat(40);
const OBSERVED_AT = "2026-08-16T01:00:00.000Z";
const CLOUD_EXPIRY = "2026-08-16T03:00:00.000Z";

test("repository adapter maps the provider-neutral active state to current", () => {
  const claim = { state: "active", claimId: D("claim") };
  assert.deepEqual(normalizeCurrentCloudContinuationClaim(claim), {
    state: "current", claimId: claim.claimId,
  });
  assert.equal(normalizeCurrentCloudContinuationClaim({ state: "review_ready" }).state,
    "review_ready");
});

for (const mode of ["admitted-committed-descendant-dirty", "planned-fence-dirty"]) {
  test(`${mode} restores the exact local projection and preserves owned work`, async () => {
    const fixture = controllerFixture({ mode });
    const completion = await fixture.controller.run({ plan: fixture.plan });
    assert.equal(completion.mode, mode);
    assert.equal(completion.writerRegistryDisposition, "projected");
    assert.equal(completion.writerRegistryMutation, true);
    assert.equal(completion.ownedWorkDigest, fixture.plan.evidence.ownedWork.ownedWorkDigest);
    assertForbiddenEffects(completion);
  });
}

test("exact replay and post-CAS response loss retain cumulative causality", async () => {
  const replay = controllerFixture({ mode: "admitted-committed-descendant-dirty" });
  const first = await replay.controller.run({ plan: replay.plan });
  const second = await replay.controller.run({ plan: replay.plan });
  assert.deepEqual(second, first);
  assert.equal(replay.calls.filter(value => value === "project").length, 1);

  const lost = controllerFixture({ mode: "planned-fence-dirty", responseLoss: "target" });
  const adopted = await lost.controller.run({ plan: lost.plan });
  assert.equal(adopted.writerRegistryDisposition, "adopted-response-loss");
  assert.equal(adopted.writerRegistryMutation, true);
  assert.equal(lost.calls.filter(value => value === "project").length, 1);
  assertForbiddenEffects(adopted);
});

test("response-loss reconciliation rejects a third registry state", async () => {
  const fixture = controllerFixture({ mode: "planned-fence-dirty", responseLoss: "third" });
  await assert.rejects(fixture.controller.run({ plan: fixture.plan }), /response lost/u);
  assert.equal(fixture.calls.filter(value => value === "project").length, 1);
});

test("evidence rejects controller, review, identity, task, authority, and work drift", () => {
  const cases = [
    ["controller head", input => { input.controller.headSha = S("e"); }],
    ["controller dirt", input => { input.controller.clean = false; }],
    ["remote branch", input => { input.remoteHeadSha = S("e"); }],
    ["closed review", input => { input.pullRequest.state = "CLOSED"; }],
    ["non-draft review", input => { input.pullRequest.isDraft = false; }],
    ["review head", input => { input.pullRequest.headSha = S("e"); }],
    ["actor", input => { input.cloudClaim.actorId = "provider-user:foreign"; }],
    ["repository", input => { input.cloudClaim.repositoryId = "repository:foreign"; }],
    ["work item", input => { input.cloudClaim.workItemId = "work-item:foreign"; }],
    ["session", input => { input.claimOwner.sessionId = "session:foreign"; }],
    ["device", input => { input.claimOwner.deviceId = "device:foreign"; }],
    ["task binding", input => { input.taskCapabilityDigest = D("foreign-task"); }],
    ["claim", input => { input.cloudClaim.claimId = D("foreign-claim"); }],
    ["claim transition", input => { input.cloudClaim.transitionCounter += 1; }],
    ["cloud expiry", input => { input.cloudClaim.expiresAt = OBSERVED_AT; }],
    ["local not expired", input => { input.lease.expiresAt = CLOUD_EXPIRY;
      input.leaseDigest = writerLeaseDigest(input.lease); }],
    ["owner", input => { input.lease.cloudAuthority.sessionId = "other-session";
      input.leaseDigest = writerLeaseDigest(input.lease); }],
    ["overlap", input => { input.cloudObservation.overlappingClaimIds = [D("peer")]; }],
    ["out-of-scope", input => { input.ownedWork.entries[0].path = "outside/file.mjs";
      resealOwnedWork(input.ownedWork); }],
    ["wrong planned head", input => { input.mode = "planned-fence-dirty";
      input.ownedWork.headSha = S("f"); resealOwnedWork(input.ownedWork); }],
    ["wrong admitted descendant", input => { input.mode = "admitted-committed-descendant-dirty";
      input.ownedWork.commits = []; resealOwnedWork(input.ownedWork); }],
  ];
  for (const [name, mutate] of cases) {
    const input = evidenceInput("admitted-committed-descendant-dirty");
    mutate(input);
    assert.throws(() => buildCurrentCloudExpiredLocalWorkContinuationEvidence(input),
      undefined, name);
  }
});

test("evidence seals the normalized inventory projection and owner authority join", () => {
  const input = evidenceInput("admitted-committed-descendant-dirty");
  Object.assign(input.cloudClaim, {
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: D("operation"),
    sessionId: input.claimOwner.sessionId,
    deviceId: input.claimOwner.deviceId,
  });
  const evidence = buildCurrentCloudExpiredLocalWorkContinuationEvidence(input);
  for (const field of ["entrySchema", "claimIdentitySchema", "operationReceiptDigest",
    "sessionId", "deviceId"]) assert.equal(field in evidence.cloudClaim, false, field);
  assert.equal(evidence.claimOwner.sessionId,
    pseudonymousIdentifier("session", evidence.lease.cloudAuthority.sessionId));
  assert.equal(evidence.claimOwner.deviceId,
    pseudonymousIdentifier("device", evidence.lease.cloudAuthority.deviceId));
});

test("both modes accept every nonempty in-scope dirt classification", () => {
  for (const mode of ["admitted-committed-descendant-dirty", "planned-fence-dirty"]) {
    for (const kind of ["staged", "unstaged", "untracked"]) {
      const input = evidenceInput(mode);
      classifyDirt(input.ownedWork, kind);
      assert.doesNotThrow(() => buildCurrentCloudExpiredLocalWorkContinuationEvidence(input),
        `${mode}: ${kind}`);
    }
  }
});

test("repository adapter covers planned and admitted local work without publishing the descendant", async () => {
  for (const mode of ["planned-fence-dirty", "admitted-committed-descendant-dirty"]) {
    const fixture = repositoryAdapterFixture({ mode });
    try {
      const controller = createCurrentCloudExpiredLocalWorkContinuationController(fixture.adapter);
      const plan = await controller.plan();
      assert.equal(plan.evidence.remoteHeadSha, plan.evidence.lease.fenceSha);
      assert.equal(plan.evidence.pullRequest.headSha, plan.evidence.lease.fenceSha);
      if (mode.startsWith("admitted")) assert.notEqual(
        plan.evidence.ownedWork.headSha, plan.evidence.lease.fenceSha);
      assert.equal(fixture.calls.cloud, 2, "mandatory cloud double-read");
      assert.equal(fixture.calls.review, 2, "mandatory review double-read");
      assert.equal(fixture.calls.controller, 2, "mandatory controller double-read");
      const completion = await controller.run({ plan });
      const registry = fixture.readRegistry();
      const storedLease = registry.leases[fixture.branch];
      const receipt = storedLease.currentCloudExpiredLocalWorkContinuationReceipts[0];
      assert.equal(registry.revision, 8);
      assert.equal(completion.taskProofDigest, D("real-task-proof"));
      assert.equal(receipt.taskProofDigest, completion.taskProofDigest);
      assert.equal(completion.projectedLeaseDigest, plan.projectedLeaseDigest);
      assert.equal(completion.storedLeaseDigest, writerLeaseDigest(storedLease));
      assert.notEqual(completion.projectedLeaseDigest, completion.storedLeaseDigest);
    } finally { fixture.cleanup(); }
  }
});

test("repository adapter rejects protected-controller, remote, review, and registry drift", async () => {
  const cases = [
    ["protected controller", { controllerDriftAt: 3 }, async fixture => {
      const controller = createCurrentCloudExpiredLocalWorkContinuationController(fixture.adapter);
      const plan = await controller.plan();
      await assert.rejects(controller.run({ plan }), /controller drift/u);
    }],
    ["remote branch", { remoteDriftAt: 2 }, async fixture =>
      assert.rejects(Promise.resolve().then(() => fixture.adapter.readPlanEvidence()), /remote/u)],
    ["open draft review", { reviewDriftAt: 2 }, async fixture =>
      assert.rejects(Promise.resolve().then(() => fixture.adapter.readPlanEvidence()), /review/u)],
    ["third registry state", {}, async fixture => {
      const controller = createCurrentCloudExpiredLocalWorkContinuationController(fixture.adapter);
      const plan = await controller.plan();
      const registry = fixture.readRegistry();
      registry.leases[fixture.branch].heartbeatAt = "2026-08-15T23:30:00.000Z";
      fixture.writeRegistry(registry);
      await assert.rejects(controller.run({ plan }), /source-or-target lease/u);
    }],
  ];
  for (const [name, options, run] of cases) {
    const fixture = repositoryAdapterFixture(options);
    try { await run(fixture); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
    finally { fixture.cleanup(); }
  }
});

function controllerFixture({ mode, responseLoss = null }) {
  const plan = buildCurrentCloudExpiredLocalWorkContinuationPlan({
    evidence: buildCurrentCloudExpiredLocalWorkContinuationEvidence(evidenceInput(mode)),
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
    revalidateCloud(_plan, stage) {
      calls.push(`cloud:${stage}`);
      if (stage === "after-local-error") return responseLoss === "target"
        ? { localProjected: true, values: projectionValues(plan, "adopted-response-loss") }
        : { localProjected: false };
      return attemptedValues(plan);
    },
    projectLocal() { calls.push("project");
      if (responseLoss) throw new Error("registry response lost");
      return projectionValues(plan, "projected"); },
    verifyTerminal(_plan, { replay }) { calls.push(`verify:${replay}`);
      return terminalValues(plan); },
  };
  return { controller: createCurrentCloudExpiredLocalWorkContinuationController(adapter),
    plan, calls };
}

function authorityValues(plan) {
  return { taskAuthorityBindingDigest: plan.evidence.taskCapabilityDigest,
    taskAuthorityReceiptDigest: D("task-receipt"), taskProofDigest: D("task-proof") };
}
function attemptedValues(plan) {
  return { idempotencyKey: D("local-attempt"), sourceLeaseDigest: plan.evidence.leaseDigest,
    projectedLeaseDigest: plan.projectedLeaseDigest };
}
function projectionValues(plan, disposition) {
  return { disposition, writerRegistryMutation: true,
    projectedLeaseDigest: plan.projectedLeaseDigest, storedLeaseDigest: D("stored-lease"),
    mutationAuthorityReceipt: mutationAuthority(plan) };
}
function terminalValues(plan) {
  return { projectedLeaseDigest: plan.projectedLeaseDigest, storedLeaseDigest: D("stored-lease"),
    mutationAuthorityReceiptDigest: mutationAuthority(plan).receiptDigest,
    verificationDigest: D("terminal") };
}
function mutationAuthority(plan) {
  const core = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: plan.evidence.cloudClaim.claimId,
    claimDigest: plan.evidence.cloudClaim.fenceRevision,
    ledgerRevision: plan.evidence.cloudObservation.ledgerRevision,
    localLeaseEpoch: plan.evidence.lease.epoch, localFenceSha: plan.evidence.lease.fenceSha,
    remoteLeaseEpoch: plan.evidence.cloudClaim.leaseEpoch,
    cloudVerificationReceiptDigest: plan.evidence.cloudObservation.verificationReceiptDigest,
    evaluatedAt: plan.evidence.observedAt, expiresAt: plan.evidence.cloudClaim.expiresAt };
  return { ...core, receiptDigest: digestValue(core) };
}

function evidenceInput(mode) {
  const fenceSha = S("b");
  const headSha = mode === "planned-fence-dirty" ? fenceSha : S("c");
  const writeSet = ["path:runtime.mjs", "semantic:work-continuation"];
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "owner-session", device: "owner-device", scope: "work-continuation",
    branch: "agent/owner/work-continuation", worktreePath: "/owned/worktree",
    baseSha: S("a"), fenceSha, pullRequestUrl: "https://provider.test/reviews/12",
    heartbeatAt: "2026-08-15T23:00:00.000Z", expiresAt: "2026-08-16T00:00:00.000Z",
    taskAuthority: { bindingDigest: D("task-binding") },
    admission: { schema: "agentic-lane-admission-lease/v1",
      status: mode === "planned-fence-dirty" ? "planned" : "admitted",
      semanticScope: "work-continuation", declaredWriteSet: writeSet,
      writeSetDigest: digestValue(writeSet), manifestDigest: D("manifest") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", state: "active",
      claimId: D("claim"), claimDigest: D("claim-fence"),
      leaseEpoch: 3, transitionCounter: 2, heartbeatCounter: 0,
      operationReceiptDigest: D("operation"), sessionId: "owner-session",
      deviceId: "owner-device", actorId: "provider-user:owner",
      targetRepository: "example/repository" } };
  const claimOwner = { actorId: "actor:owner", repositoryId: "repository:owner",
    workItemId: "work-item:owner",
    sessionId: pseudonymousIdentifier("session", lease.cloudAuthority.sessionId),
    deviceId: pseudonymousIdentifier("device", lease.cloudAuthority.deviceId) };
  const claim = { claimId: lease.cloudAuthority.claimId,
    fenceRevision: lease.cloudAuthority.claimDigest,
    transitionDigest: D("transition"),
    state: "current", writeAuthority: true, scopeReserved: true,
    canonicalBaseRevision: lease.baseSha, laneRevision: lease.fenceSha,
    leaseEpoch: lease.cloudAuthority.leaseEpoch,
    transitionCounter: lease.cloudAuthority.transitionCounter, heartbeatCounter: 0,
    expiresAt: CLOUD_EXPIRY, declaredWriteScope: writeSet,
    writeSetDigest: lease.admission.writeSetDigest,
    actorId: claimOwner.actorId, repositoryId: claimOwner.repositoryId,
    workItemId: claimOwner.workItemId, reviewRequestId: null };
  const planned = mode === "planned-fence-dirty";
  const dirtCore = { schema: "agentic-active-owned-dirt-evidence/v1", headSha,
    entries: [{ path: "runtime.mjs", staged: !planned, unstaged: !planned, untracked: planned,
      headMode: planned ? null : "100644", headBlob: planned ? null : "1".repeat(40),
      indexMode: planned ? null : "100644", indexBlob: planned ? null : "2".repeat(40),
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: "3".repeat(40) }],
    pathCount: 1, stagedPathCount: planned ? 0 : 1,
    unstagedPathCount: planned ? 0 : 1, untrackedPathCount: planned ? 1 : 0 };
  const dirt = { ...dirtCore, evidenceDigest: digestValue(dirtCore) };
  const commits = mode === "planned-fence-dirty" ? []
    : [{ sha: headSha, parentSha: fenceSha, changedPaths: ["runtime.mjs"] }];
  const ownedCore = { ...dirt, commits };
  const ownedWork = { ...ownedCore, ownedWorkDigest: digestValue(ownedCore) };
  return { repository: "example/repository", mode,
    controller: { rootDigest: D("controller-root"), headSha: S("a"),
      originMainSha: S("a"), treeSha: S("f"), runtimeDigest: D("runtime"),
      clean: true, protected: true },
    remoteHeadSha: fenceSha,
    pullRequest: { url: lease.pullRequestUrl, nodeId: "review-node:12", state: "OPEN",
      isDraft: true, headBranch: lease.branch, headSha: fenceSha, baseBranch: "main",
      autoMergeRequest: null },
    observedAt: OBSERVED_AT,
    lease, leaseDigest: writerLeaseDigest(lease), cloudClaim: claim, claimOwner,
    cloudObservation: { status: "ready", evaluatedAt: OBSERVED_AT,
      ledgerRevision: S("d"), ledgerDigest: D("ledger"), inventoryDigest: D("inventory"),
      verificationReceiptDigest: D("cloud-verification"), overlappingClaimIds: [] },
    ownedWork, taskCapabilityDigest: lease.taskAuthority.bindingDigest };
}
function resealOwnedWork(value) {
  const dirtCore = { schema: value.schema, headSha: value.headSha, entries: value.entries,
    pathCount: value.entries.length,
    stagedPathCount: value.entries.filter(item => item.staged).length,
    unstagedPathCount: value.entries.filter(item => item.unstaged).length,
    untrackedPathCount: value.entries.filter(item => item.untracked).length };
  value.pathCount = dirtCore.pathCount;
  value.stagedPathCount = dirtCore.stagedPathCount;
  value.unstagedPathCount = dirtCore.unstagedPathCount;
  value.untrackedPathCount = dirtCore.untrackedPathCount;
  value.evidenceDigest = digestValue(dirtCore);
  const { ownedWorkDigest: _ignored, ...ownedCore } = value;
  value.ownedWorkDigest = digestValue(ownedCore);
}

function classifyDirt(value, kind) {
  const entry = value.entries[0];
  entry.staged = kind === "staged";
  entry.unstaged = kind === "unstaged";
  entry.untracked = kind === "untracked";
  entry.headMode = kind === "untracked" ? null : "100644";
  entry.headBlob = kind === "untracked" ? null : "1".repeat(40);
  entry.indexMode = kind === "untracked" ? null : "100644";
  entry.indexBlob = kind === "untracked" ? null : "2".repeat(40);
  resealOwnedWork(value);
}

function repositoryAdapterFixture({ controllerDriftAt = 0, remoteDriftAt = 0,
  reviewDriftAt = 0, mode = "planned-fence-dirty" } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "work-continuation-test-")));
  const repository = path.join(root, "lane");
  const statePath = path.join(root, "registry", "writer-leases.json");
  const taskAuthorityFile = path.join(root, "task-authority.json");
  mkdirSync(path.join(repository, ".git"), { recursive: true });
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(path.join(repository, "runtime.mjs"), "export const preserved = true;\n");
  writeFileSync(taskAuthorityFile, "{}\n");
  const input = evidenceInput(mode);
  const { lease, cloudClaim: claim } = input;
  const providerOwner = { actorId: "github-user:42", repositoryId: "github-repository:repo-node",
    workItemId: pseudonymousIdentifier("work-item", lease.scope) };
  Object.assign(claim, providerOwner);
  lease.worktreePath = repository;
  const branch = lease.branch;
  const initialRegistry = { schema: "agentic-writer-lease-registry/v2", revision: 7,
    leases: { [branch]: lease } };
  writeFileSync(statePath, `${JSON.stringify(initialRegistry, null, 2)}\n`);
  const readRegistry = () => JSON.parse(readFileSync(statePath, "utf8"));
  const writeRegistry = value => writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`);
  const leaseStore = {
    statePath,
    read(name) { return readRegistry().leases[name] || null; },
    readRegistry,
    withRegistryLock(action) { return action(readRegistry()); },
  };
  const localHeadSha = input.ownedWork.headSha;
  const calls = { cloud: 0, controller: 0, remote: 0, review: 0 };
  const git = (argumentsList, options = {}) => {
    const command = argumentsList.join(" ");
    if (command === "branch --show-current") return branch;
    if (command === "rev-parse --git-common-dir") return ".git";
    if (command === "worktree list --porcelain -z") {
      return `worktree ${repository}\0HEAD ${localHeadSha}\0branch refs/heads/${branch}\0`;
    }
    if (command === "rev-parse HEAD") return localHeadSha;
    if (command === `rev-parse refs/remotes/origin/${branch}`) {
      calls.remote += 1;
      return calls.remote === remoteDriftAt ? S("e") : lease.fenceSha;
    }
    if (command === `merge-base --is-ancestor ${lease.fenceSha} ${localHeadSha}`) return "";
    if (command === `rev-list --reverse --first-parent ${lease.fenceSha}..${localHeadSha}`) {
      return localHeadSha;
    }
    if (command === `rev-parse ${localHeadSha}^`) return lease.fenceSha;
    if (command === `diff-tree --no-commit-id --name-only -r -z --no-renames ${lease.fenceSha} ${localHeadSha} --`) {
      return "runtime.mjs\0";
    }
    if (command === "diff --name-only --diff-filter=U -z") return "";
    if (command === "diff --cached --name-only --no-renames -z --"
      || command === "diff --name-only --no-renames -z --") return "";
    if (command === "ls-files --others --exclude-standard -z --") return "runtime.mjs\0";
    if (command === "ls-tree -z --full-tree HEAD -- runtime.mjs"
      || command === "ls-files --stage -z -- runtime.mjs") return "";
    if (command === "hash-object --no-filters --stdin" && options.input) return "3".repeat(40);
    throw new Error(`Unexpected test Git command: ${command}`);
  };
  const readController = () => {
    calls.controller += 1;
    return { ...input.controller,
      headSha: calls.controller === controllerDriftAt ? S("e") : input.controller.headSha };
  };
  const gh = argumentsList => {
    const command = argumentsList.join(" ");
    if (command === "api user") return JSON.stringify({ id: 42 });
    if (command.startsWith("repo view ")) return JSON.stringify({ id: "repo-node",
      nameWithOwner: lease.cloudAuthority.targetRepository });
    calls.review += 1;
    return JSON.stringify({ id: input.pullRequest.nodeId, url: input.pullRequest.url,
      state: calls.review === reviewDriftAt ? "CLOSED" : "OPEN", isDraft: true,
      autoMergeRequest: null, headRefName: branch, headRefOid: lease.fenceSha,
      baseRefName: "main" });
  };
  const verifyCloud = () => {
    calls.cloud += 1;
    return { verification: { status: "ready", verifiedAt: OBSERVED_AT,
      ledgerRevision: input.cloudObservation.ledgerRevision,
      ledgerDigest: input.cloudObservation.ledgerDigest,
      remoteClaimInventoryDigest: input.cloudObservation.inventoryDigest,
      receiptDigest: input.cloudObservation.verificationReceiptDigest,
      inventory: { claims: [claim] } } };
  };
  const adapter = createRepositoryCurrentCloudExpiredLocalWorkContinuationAdapter({
    repository, mode: input.mode, sessionId: lease.sessionId, taskAuthorityFile,
  }, { git, gh, readController, verifyCloud, leaseStore,
    authorizeTaskMutation: () => ({ receiptDigest: D("real-task-receipt"),
      proofDigest: D("real-task-proof") }), now: () => new Date(OBSERVED_AT) });
  return { adapter, branch, calls, readRegistry, writeRegistry,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function assertForbiddenEffects(value) {
  for (const field of ["cloudMutation", "providerMutation", "sourceMutation", "gitMutation",
    "indexMutation", "remoteRefMutation", "pullRequestMutation",
    "pullRequestStateMutation", "newClaimCreated", "newWorktreeCreated", "mergeMutation",
    "deploymentMutation", "cleanupMutation"]) assert.equal(value[field], false, field);
}
