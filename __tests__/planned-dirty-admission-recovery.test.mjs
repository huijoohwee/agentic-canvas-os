import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlannedDirtyAdmissionRecovery,
  buildPlannedDirtyAdmissionRecoveryPlan,
  createRecoveryIntent,
  OPERATION,
} from "../scripts/planned-dirty-admission-recovery-contract.mjs";
import { createPlannedDirtyAdmissionRecoveryController }
  from "../scripts/planned-dirty-admission-recovery-controller.mjs";
import { buildPlannedDirtyAdmissionRecoveryEvidence }
  from "../scripts/planned-dirty-admission-recovery-evidence.mjs";
import { createPlannedDirtyAdmissionRecoveryRepositoryAdapter }
  from "../scripts/planned-dirty-admission-recovery-repository-adapter.mjs";
import { createPlannedDirtyAdmissionRecoveryStore }
  from "../scripts/planned-dirty-admission-recovery-store.mjs";
import { parsePlannedDirtyAdmissionRecoveryArguments }
  from "../scripts/planned-dirty-admission-recovery.mjs";
import { PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA }
  from "../scripts/provisioned-start-cloud-authority-subject.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import { projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const BASE = "a".repeat(40);
const FENCE = "b".repeat(40);
const PROTECTED = "c".repeat(40);
const OBSERVED = "2026-08-26T00:00:00.000Z";
const EXPIRES = "2026-08-27T00:00:00.000Z";
const D = value => digestValue({ value });

for (const kind of ["staged", "unstaged", "untracked", "mixed"]) {
  test(`plan content-binds exact ${kind} dirt at the unchanged fence`, () => {
    const plan = planFixture({ kind });
    assert.equal(plan.evidence.sourceLease.admission.status, "planned");
    assert.equal(plan.evidence.ownedDirt.headSha, FENCE);
    assert.equal(plan.evidence.ownedDirt.entries[0][kind === "mixed" ? "staged" : kind], true);
    assert.equal(plan.evidence.sourceLease.integration, undefined);
    assert.deepEqual(plan.allowedMutations, [
      "private-replay-journal", "writer-lease-registry-cas",
      "pull-request-hidden-marker-projection",
    ]);
    assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
  });
}

test("evidence rejects clean, out-of-scope, descendant, admitted, and cloud-drift states", () => {
  assert.throws(() => evidenceFixture({ clean: true }), /dirty worktree|evidence/u);
  assert.throws(() => evidenceFixture({ dirtPath: "scripts/outside.mjs" }),
    /outside the admitted write set/u);
  assert.throws(() => evidenceFixture({ dirtHead: PROTECTED }), /dirt fence/u);
  assert.throws(() => evidenceFixture({ admissionStatus: "admitted" }),
    /active planned lease/u);
  assert.throws(() => evidenceFixture({ cloudState: "parked" }),
    /current cloud write authority/u);
  assert.throws(() => evidenceFixture({ overlap: D("foreign") }), /no overlap/u);
});

test("repository adapter requires the exact empty one-parent coordination fence", () => {
  const cases = [
    ["wrong parent", { fenceParent: PROTECTED }],
    ["different fence tree", { fenceTree: "e".repeat(40) }],
    ["changed fence path", { fencePaths: "docs/fence.md\0" }],
  ];
  for (const [label, options] of cases) {
    assert.throws(() => fenceAdapter(options).readEvidence(),
      /exact empty one-parent coordination fence/u, label);
  }
});

test("repository adapter rejects origin and pull-request repository mismatches", () => {
  const cases = [
    ["origin", { originRepository: "other/repository" }],
    ["pull request", { pullRequestUrl: "https://github.com/other/repository/pull/1" }],
  ];
  for (const [label, options] of cases) {
    const fixture = terminalAdapterFixture(options);
    assert.throws(() => fixture.adapter.verifyTerminal({
      plan: fixture.plan, intent: fixture.intent,
    }), /same-repository open draft pull request/u, label);
  }
});

test("projected admitted marker capacity fails before registry mutation", () => {
  const fixture = terminalAdapterFixture({
    registrySource: true, sourceBodyAtLimit: true, trackRegistryMutation: true,
  });
  assert.throws(() => fixture.adapter.projectRegistry({
    plan: fixture.plan, intent: fixture.intent,
  }), /bounded target pull-request marker body/u);
  assert.equal(fixture.registryCasCalls(), 0);
});

test("terminal verification returns fresh admitted authority, not preserved planned authority", () => {
  const fixture = terminalAdapterFixture({ registryRevision: 5 });
  const terminal = fixture.adapter.verifyTerminal({
    plan: fixture.plan, intent: fixture.intent,
  });
  assert.notEqual(fixture.plannedReceiptDigest, fixture.admittedReceiptDigest);
  assert.equal(terminal.mutationAuthorityReceiptDigest,
    fixture.admittedReceiptDigest);
  assert.deepEqual(fixture.mutationAdmissionStatuses, ["admitted", "admitted"]);

  const regression = terminalAdapterFixture({ registryRevision: 1 });
  assert.throws(() => regression.adapter.verifyTerminal({
    plan: regression.plan, intent: regression.intent,
  }), /target registry recovery receipt/u);
  const thirdState = terminalAdapterFixture({ thirdStateLease: true });
  assert.throws(() => thirdState.adapter.verifyTerminal({
    plan: thirdState.plan, intent: thirdState.intent,
  }), /source-or-target writer registry/u);
});

test("controller requires exact authorization, preserves effect order, and replays", async () => {
  const plan = planFixture();
  const state = controllerState();
  const controller = createPlannedDirtyAdmissionRecoveryController(fakeAdapter(state, plan));
  await assert.rejects(() => controller.run({ plan, authorization: "authorize" }),
    /Exact authorization required/u);
  const result = await controller.run({
    plan, authorization: `authorize ${OPERATION} ${plan.planDigest}`,
  });
  assert.equal(result.status, "mutation-authority-restored");
  assert.equal(result.admissionStatus, "admitted");
  assert.deepEqual(state.calls, [
    "source:before-task-authorization", "task",
    "source:before-registry-projection", "registry",
    "source:before-pr-marker-projection", "marker",
    "source:before-terminal-verification", "terminal",
  ]);
  for (const field of ["sourceMutation", "indexMutation", "gitMutation", "cloudMutation",
    "refMutation", "localRefMutation", "remoteRefMutation", "pullRequestStateMutation",
    "mergeMutation", "deploymentMutation", "releaseMutation", "cleanupMutation"]) {
    assert.equal(result[field], false, field);
  }
  const replay = await controller.run({ plan, authorization: "ignored-after-journal" });
  assert.equal(replay.receiptDigest, result.receiptDigest);
  assert.equal(state.calls.filter(item => item === "registry").length, 1);
  assert.equal(state.calls.filter(item => item === "marker").length, 1);
  assert.equal(state.calls.at(-2), "source:before-terminal-replay");
  assert.equal(state.calls.at(-1), "terminal-replay");
});

test("registry response loss adopts one exact mutation and rejects third-state drift", async () => {
  const plan = planFixture();
  const state = controllerState({ loseRegistryResponse: true });
  const controller = createPlannedDirtyAdmissionRecoveryController(fakeAdapter(state, plan));
  const authorization = `authorize ${OPERATION} ${plan.planDigest}`;
  await assert.rejects(() => controller.run({ plan, authorization }), /simulated response loss/u);
  const result = await controller.run({ plan, authorization });
  assert.equal(result.status, "mutation-authority-restored");
  assert.equal(state.registryMutations, 1);
  assert.equal(state.registryCalls, 2);

  const drift = controllerState({ sourceError: "third registry state" });
  const rejected = createPlannedDirtyAdmissionRecoveryController(fakeAdapter(drift, plan));
  await assert.rejects(() => rejected.run({ plan, authorization }), /third registry state/u);
  assert.equal(drift.registryMutations, 0);
});

test("marker response loss is adopted after one exact marker mutation", () => {
  const fixture = terminalAdapterFixture({ markerResponseLoss: true });
  assert.throws(() => fixture.adapter.projectPullRequestMarker({
    plan: fixture.plan, intent: fixture.intent,
  }), /simulated marker response loss/u);
  const result = fixture.adapter.projectPullRequestMarker({
    plan: fixture.plan, intent: fixture.intent,
  });
  assert.equal(result.adopted, true);
  assert.equal(fixture.markerMutations(), 1);
});

test("private journal uses exact CAS and plan/run files remain external and private", async () => {
  const plan = planFixture();
  const authorization = authorizePlannedDirtyAdmissionRecovery(
    plan, `authorize ${OPERATION} ${plan.planDigest}`,
  );
  const intent = createRecoveryIntent({ plan, authorization, taskAuthority: {
    receiptDigest: D("task receipt"), proofDigest: D("task proof"),
  } });
  const temporary = mkdtempSync(path.join(os.tmpdir(), "planned-dirty-test-"));
  const repository = mkdtempSync(path.join(os.tmpdir(), "planned-dirty-repo-"));
  const store = createPlannedDirtyAdmissionRecoveryStore({
    statePath: path.join(temporary, "journal.json"),
  });
  store.write({ expected: null, next: intent });
  assert.equal(store.read().intentDigest, intent.intentDigest);
  assert.throws(() => store.write({ expected: null, next: intent }), /journal CAS/u);
  const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(exited.status, 0);
  assert.throws(() => process.kill(exited.pid, 0), error => error?.code === "ESRCH");
  writeFileSync(`${store.statePath}.entrypoint.lock`, JSON.stringify({
    schema: "agentic-planned-dirty-admission-recovery-lock/v1",
    pid: exited.pid, token: "provably-dead-owner",
  }), { mode: 0o600 });
  assert.equal(await store.withLock(() => "reclaimed"), "reclaimed");

  const planFile = path.join(temporary, "plan.json");
  const capabilityFile = path.join(temporary, "capability.json");
  writeFileSync(planFile, "{}\n", { mode: 0o600 });
  writeFileSync(capabilityFile, "{}\n", { mode: 0o600 });
  const parsedPlan = parsePlannedDirtyAdmissionRecoveryArguments([
    "plan", `--repository=${repository}`, "--session=s",
    `--output=${path.join(temporary, "new-plan.json")}`, "--json",
  ]);
  assert.equal(parsedPlan.mode, "plan");
  const parsedRun = parsePlannedDirtyAdmissionRecoveryArguments([
    "run", `--repository=${repository}`, "--session=s", `--plan-file=${planFile}`,
    `--task-authority=${capabilityFile}`,
    `--authorize=authorize ${OPERATION} ${plan.planDigest}`,
  ]);
  assert.equal(parsedRun.mode, "run");
  assert.throws(() => parsePlannedDirtyAdmissionRecoveryArguments([
    "plan", `--repository=${repository}`, "--session=s",
    `--output=${path.join(repository, "plan.json")}`,
  ]), /outside the repository/u);
  const repositoryAlias = path.join(temporary, "repository-alias");
  symlinkSync(repository, repositoryAlias);
  assert.throws(() => parsePlannedDirtyAdmissionRecoveryArguments([
    "plan", `--repository=${repository}`, "--session=s",
    `--output=${path.join(repositoryAlias, "plan.json")}`,
  ]), /outside the repository/u);
});

function planFixture(options = {}) {
  return buildPlannedDirtyAdmissionRecoveryPlan({ evidence: evidenceFixture(options) });
}

function evidenceFixture({ kind = "staged", clean = false,
  dirtPath = "docs/a.md", dirtHead = FENCE, admissionStatus = "planned",
  cloudState = "active", overlap = null } = {}) {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1", semanticScope: "repair",
    paths: ["docs/a.md"],
  });
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "owner/controller", targetRepository: "owner/repository",
    claimId: D("claim"), claimDigest: D("claim fence"), ledgerRevision: PROTECTED,
    ledgerDigest: D("ledger"), claimLedgerRevision: D("claim transition"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: D("cloud operation"), mutationAuthorityEligible: true,
    canonicalBaseSha: BASE, laneRevision: FENCE,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, deviceId: "device", sessionId: "session",
    reviewRequestId: "github-pull-request:PR_1", leaseEpoch: 1,
    transitionCounter: 2, state: "active", expiresAt: EXPIRES,
    integrationReceiptDigest: null, integration: null,
    manifestDigest: manifest.manifestDigest,
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1", status: admissionStatus,
    semanticScope: "repair", declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest,
    planReceiptDigest: D("plan receipt"), admissionReceiptDigest: D("admission receipt"),
    existingLaneStateDigest: D("existing lanes"),
  };
  const leaseFrame = {
    schema: "agentic-writer-lease/v2", status: "active", sessionId: "session",
    device: "device", scope: "repair", branch: "agent/device/repair",
    worktreePath: "/task/worktree", epoch: 2, baseSha: BASE, fenceSha: FENCE,
    pullRequestUrl: "https://github.com/owner/repository/pull/1", autoDelivery: true,
    runtimeRequired: true, admission, cloudAuthority,
    heartbeatAt: OBSERVED, expiresAt: EXPIRES,
  };
  const capability = createTaskAuthorityCapability({ generation: 1, issuedAt: OBSERVED });
  const lease = { ...leaseFrame, taskAuthority: createTaskAuthorityBinding({
    capability, lease: leaseFrame, boundAt: OBSERVED,
  }) };
  const body = updateWriterLeasePullRequestBody("owner", lease);
  const marker = projectWriterLeasePullRequestMarker(lease);
  const ownedDirt = dirtEvidence({ kind, path: dirtPath, headSha: dirtHead, clean });
  const cloudSubject = {
    schema: PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA,
    verificationSchema: "agentic-lane-cloud-verification/v1", provider: "github",
    ledgerRepository: cloudAuthority.ledgerRepository,
    targetRepository: cloudAuthority.targetRepository,
    claim: { claimId: cloudAuthority.claimId, claimDigest: cloudAuthority.claimDigest,
      claimLedgerRevision: cloudAuthority.claimLedgerRevision,
      entrySchema: cloudAuthority.entrySchema,
      claimIdentitySchema: cloudAuthority.claimIdentitySchema,
      operationReceiptDigest: cloudAuthority.operationReceiptDigest,
      state: cloudState, transitionCounter: 2, heartbeatCounter: 0,
      leaseEpoch: 1, expiresAt: EXPIRES, mutationAuthorityEligible: true,
      writeAuthority: cloudState === "active", scopeReserved: true },
    owner: { actorId: "actor", repositoryId: "repository", workItemId: "work-item",
      deviceId: "device", sessionId: "session" },
    lane: { branch: lease.branch, canonicalBaseSha: BASE, laneRevision: FENCE,
      fenceSha: FENCE, reviewRequestId: cloudAuthority.reviewRequestId },
    scope: { semanticScope: "repair", declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest },
  };
  const sourceRegistry = { schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [lease.branch]: lease } };
  const registry = { schema: sourceRegistry.schema, revision: sourceRegistry.revision,
    registryDigest: digestValue(sourceRegistry), leaseDigest: writerLeaseDigest(lease) };
  const review = { id: "PR_1", reviewRequestId: "github-pull-request:PR_1",
    number: 1, url: lease.pullRequestUrl, state: "OPEN", isDraft: true,
    autoMergeRequest: null, branch: lease.branch, headRepository: "owner/repository",
    headSha: FENCE, remoteHeadSha: FENCE, baseBranch: "main", baseSha: BASE,
    body, bodyDigest: digestValue(body), marker, markerDigest: digestValue(marker) };
  const controller = { repositoryPathDigest: D("controller path"), branch: "main",
    headSha: PROTECTED, treeSha: D("tree").slice(0, 40), originMainSha: PROTECTED,
    remoteMainSha: PROTECTED, statusDigest: D("clean"), clean: true,
    protected: true, implementationDigest: D("implementation") };
  const advance = { schema: "agentic-active-owned-dirt-protected-main-advance/v1",
    baseSha: BASE, pullRequestBaseSha: BASE, protectedMainSha: PROTECTED,
    protectedMainTreeSha: D("protected tree").slice(0, 40),
    declaredWriteSetDigest: manifest.writeSetDigest, changedPathCount: 0,
    changedPathsDigest: digestValue([]) };
  return buildPlannedDirtyAdmissionRecoveryEvidence({ observedAt: OBSERVED,
    repositoryPathDigest: digestValue(lease.worktreePath),
    targetRepository: "owner/repository", ledgerRepository: "owner/controller",
    branch: lease.branch, sessionId: lease.sessionId, leaseObservations: [lease, lease],
    registryObservations: [registry, registry], dirtObservations: [ownedDirt, ownedDirt],
    manifest, pullRequestObservations: [review, review],
    cloudSubjects: [cloudSubject, cloudSubject],
    controllerObservations: [controller, controller],
    protectedMainObservations: [advance, advance],
    overlappingClaimIds: overlap ? [overlap] : [],
    taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest });
}

function dirtEvidence({ kind, path: entryPath, headSha, clean }) {
  const states = { staged: [true, false, false], unstaged: [false, true, false],
    untracked: [false, false, true], mixed: [true, true, false] }[kind];
  const [staged, unstaged, untracked] = states;
  const entries = clean ? [] : [{ path: entryPath, staged, unstaged, untracked,
    headMode: untracked ? null : "100644", headBlob: untracked ? null : "1".repeat(40),
    indexMode: untracked ? null : "100644",
    indexBlob: untracked ? null : (staged ? "2" : "1").repeat(40),
    worktreeType: "file", worktreeMode: "100644",
    worktreeBlob: untracked ? "3".repeat(40)
      : (unstaged ? "3" : (staged ? "2" : "1")).repeat(40) }];
  const core = { schema: "agentic-active-owned-dirt-evidence/v1", headSha, entries,
    pathCount: entries.length, stagedPathCount: entries.filter(item => item.staged).length,
    unstagedPathCount: entries.filter(item => item.unstaged).length,
    untrackedPathCount: entries.filter(item => item.untracked).length };
  return { ...core, evidenceDigest: digestValue(core) };
}

function fenceAdapter(options = {}) {
  const plan = planFixture();
  const lease = plan.evidence.sourceLease;
  return createPlannedDirtyAdmissionRecoveryRepositoryAdapter({
    repository: lease.worktreePath, sessionId: lease.sessionId,
  }, {
    realpath: value => path.resolve(value), controllerRoot: "/controller",
    git: repositoryGit(lease, options),
    leaseStore: { readRegistry: () => ({
      schema: "agentic-writer-lease-registry/v2", revision: 1,
      leases: { [lease.branch]: lease },
    }) },
    captureDirt: () => plan.evidence.ownedDirt,
    now: () => new Date(OBSERVED),
  });
}

function terminalAdapterFixture({ registryRevision = 2, thirdStateLease = false,
  originRepository = null, pullRequestUrl = null, registrySource = false,
  sourceBodyAtLimit = false, trackRegistryMutation = false,
  markerResponseLoss = false } = {}) {
  const plan = planFixture();
  const source = plan.evidence.sourceLease;
  const authorization = authorizePlannedDirtyAdmissionRecovery(
    plan, `authorize ${OPERATION} ${plan.planDigest}`,
  );
  const intent = createRecoveryIntent({ plan, authorization, taskAuthority: {
    receiptDigest: D("terminal task receipt"), proofDigest: D("terminal task proof"),
  } });
  const plannedReceipt = mutationReceipt(source, "planned mutation", OBSERVED);
  const recoveryCore = {
    schema: "agentic-planned-dirty-admission-preservation/v1",
    planDigest: plan.planDigest, sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    sourceAdmissionDigest: digestValue(source.admission),
    dirtEvidenceDigest: plan.evidence.dirtDigest,
    authorizationDigest: intent.phases.authorized.values.authorizationDigest,
    taskAuthorityReceiptDigest:
      intent.phases.authorized.values.taskAuthorityReceiptDigest,
    taskProofDigest: intent.phases.authorized.values.taskProofDigest,
    plannedMutationAuthorityReceipt: plannedReceipt,
    projectedAt: plannedReceipt.evaluatedAt,
  };
  const recovery = { ...recoveryCore, receiptDigest: digestValue(recoveryCore) };
  const target = { ...source, admission: { ...source.admission, status: "admitted",
    admittedReportDigest: recovery.receiptDigest,
    preservationReceiptDigest: recovery.receiptDigest },
  plannedDirtyAdmissionRecovery: recovery };
  const operationKey = digestValue({ operation: OPERATION, planDigest: plan.planDigest });
  const registryReceiptCore = {
    schema: "agentic-planned-dirty-admission-recovery-registry-receipt/v1",
    operationKey, planDigest: plan.planDigest,
    sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    targetLeaseDigest: writerLeaseDigest(target), claimId: target.cloudAuthority.claimId,
    dirtDigest: plan.evidence.dirtDigest, registryRevision: 2,
  };
  const registryReceipt = { ...registryReceiptCore,
    receiptDigest: digestValue(registryReceiptCore) };
  const registryLease = registrySource ? source : (thirdStateLease
    ? { ...target, heartbeatAt: "2026-08-26T00:05:00.000Z" } : target);
  const registry = { schema: "agentic-writer-lease-registry/v2",
    revision: registrySource ? 1 : registryRevision,
    leases: { [target.branch]: registryLease },
    ...(registrySource ? {} : {
      plannedDirtyAdmissionRecoveryReceipts: { [operationKey]: registryReceipt },
    }) };
  const targetBody = updateWriterLeasePullRequestBody(
    plan.evidence.pullRequest.body, target,
  );
  let currentBody = markerResponseLoss || registrySource
    ? plan.evidence.pullRequest.body : targetBody;
  if (sourceBodyAtLimit) currentBody = `${"x".repeat(
    65_536 - Buffer.byteLength(currentBody),
  )}${currentBody}`;
  if (sourceBodyAtLimit) assert.equal(Buffer.byteLength(currentBody), 65_536);
  let registryCasCalls = 0;
  let markerMutations = 0;
  let loseMarkerResponse = markerResponseLoss;
  const admittedReceiptDigest = D("fresh admitted mutation authority");
  const mutationAdmissionStatuses = [];
  const subject = plan.evidence.cloudAuthoritySubject;
  const adapter = createPlannedDirtyAdmissionRecoveryRepositoryAdapter({
    repository: target.worktreePath, sessionId: target.sessionId,
  }, {
    realpath: value => path.resolve(value), controllerRoot: "/controller",
    git: repositoryGit(target, { originRepository }), leaseStore: {
      readRegistry: () => registry,
      ...(trackRegistryMutation ? { statePath: "/not-used", withRegistryLock: () => {
        registryCasCalls += 1;
        throw new Error("unexpected registry mutation");
      } } : {}),
    },
    captureDirt: () => plan.evidence.ownedDirt,
    captureController: () => ({ controller: plan.evidence.protectedController,
      protectedMainAdvance: plan.evidence.protectedMainAdvance }),
    gh: argumentsList => {
      if (argumentsList[1] === "edit") {
        markerMutations += 1;
        currentBody = argumentsList[argumentsList.indexOf("--body") + 1];
        if (loseMarkerResponse) { loseMarkerResponse = false;
          throw new Error("simulated marker response loss"); }
        return "";
      }
      assert.equal(argumentsList[1], "view");
      return JSON.stringify({ id: plan.evidence.pullRequest.id,
        number: plan.evidence.pullRequest.number,
        url: pullRequestUrl || target.pullRequestUrl,
        state: "OPEN", isDraft: true, autoMergeRequest: null,
        headRefName: target.branch, headRefOid: target.fenceSha,
        headRepository: { nameWithOwner: target.cloudAuthority.targetRepository },
        baseRefName: "main", baseRefOid: plan.evidence.pullRequest.baseSha,
        body: currentBody });
    },
    verifyCloud: ({ authority }) => ({ authority,
      verification: cloudVerification(subject) }),
    assertMutationAuthority: ({ lease }) => {
      mutationAdmissionStatuses.push(lease.admission.status);
      return { receiptDigest: admittedReceiptDigest };
    },
    now: () => new Date(OBSERVED),
  });
  return { adapter, plan, intent,
    plannedReceiptDigest: plannedReceipt.receiptDigest,
    admittedReceiptDigest, mutationAdmissionStatuses,
    registryCasCalls: () => registryCasCalls,
    markerMutations: () => markerMutations };
}

function repositoryGit(lease, options = {}) {
  const tree = "d".repeat(40);
  return argumentsList => {
    const command = argumentsList.join(" ");
    if (command === "branch --show-current") return lease.branch;
    if (command === "rev-parse --git-common-dir") return "/task/common";
    if (command === "worktree list --porcelain -z") return `worktree ${lease.worktreePath}\0HEAD ${lease.fenceSha}\0branch refs/heads/${lease.branch}\0`;
    if (command === "rev-parse HEAD") return lease.fenceSha;
    if (command === `rev-parse ${lease.fenceSha}^{tree}`) {
      return options.fenceTree || tree;
    }
    if (command === `rev-parse ${lease.baseSha}^{tree}`) return tree;
    if (command === `show -s --format=%P ${lease.fenceSha}`) {
      return options.fenceParent || lease.baseSha;
    }
    if (command === `diff --name-only --no-renames -z ${lease.baseSha} ${lease.fenceSha} --`) {
      return options.fencePaths || "";
    }
    if (command === `ls-remote --heads origin refs/heads/${lease.branch}`) {
      return `${lease.fenceSha}\trefs/heads/${lease.branch}`;
    }
    if (command === "remote get-url origin") {
      return `https://github.com/${options.originRepository
        || lease.cloudAuthority.targetRepository}.git`;
    }
    throw new Error(`Unexpected git call: ${command}`);
  };
}

function mutationReceipt(lease, label, evaluatedAt) {
  const authority = lease.cloudAuthority;
  const core = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: authority.claimId, claimDigest: authority.claimDigest,
    ledgerRevision: authority.ledgerRevision, localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha, remoteLeaseEpoch: authority.leaseEpoch,
    cloudVerificationReceiptDigest: D(`${label} verification`),
    evaluatedAt, expiresAt: EXPIRES };
  return { ...core, receiptDigest: digestValue(core) };
}

function cloudVerification(subject) {
  const claim = subject.claim;
  return { schema: subject.verificationSchema,
    receiptDigest: D("terminal cloud verification"), verifiedAt: OBSERVED,
    inventory: { claims: [{ claimId: claim.claimId,
      fenceRevision: claim.claimDigest, transitionDigest: claim.claimLedgerRevision,
      state: claim.state, transitionCounter: claim.transitionCounter,
      heartbeatCounter: claim.heartbeatCounter, leaseEpoch: claim.leaseEpoch,
      expiresAt: claim.expiresAt, writeAuthority: claim.writeAuthority,
      scopeReserved: claim.scopeReserved, actorId: subject.owner.actorId,
      repositoryId: subject.owner.repositoryId, workItemId: subject.owner.workItemId,
      canonicalBaseRevision: subject.lane.canonicalBaseSha,
      laneRevision: subject.lane.laneRevision,
      reviewRequestId: subject.lane.reviewRequestId,
      writeSetDigest: subject.scope.writeSetDigest,
      declaredWriteScope: subject.scope.declaredWriteSet }] } };
}

function controllerState(options = {}) {
  return { intent: null, calls: [], registryCalls: 0, registryMutations: 0,
    target: false, loseRegistryResponse: options.loseRegistryResponse === true,
    sourceError: options.sourceError || null };
}

function fakeAdapter(state, plan) {
  return {
    readEvidence: async () => { throw new Error("not used"); },
    withOperationLock: async (_plan, action) => action(),
    readIntent: async () => state.intent,
    writeIntent: async ({ expected, next }) => {
      assert.equal(expected?.intentDigest ?? null, state.intent?.intentDigest ?? null);
      state.intent = next;
    },
    assertSource: async (_plan, stage) => {
      state.calls.push(`source:${stage}`);
      if (state.sourceError) throw new Error(state.sourceError);
      return true;
    },
    authorizeTask: async () => called(state, "task", {
      receiptDigest: D("task receipt"), proofDigest: D("task proof") }),
    projectRegistry: async () => {
      state.calls.push("registry"); state.registryCalls += 1;
      if (!state.target) { state.target = true; state.registryMutations += 1;
        if (state.loseRegistryResponse) { state.loseRegistryResponse = false;
          throw new Error("simulated response loss"); } }
      return { leaseDigest: D("target lease"), preservationReceiptDigest: D("preservation"),
        plannedMutationAuthorityReceiptDigest: D("planned mutation authority"),
        adopted: state.registryCalls > 1 };
    },
    projectPullRequestMarker: async () => called(state, "marker", {
      markerDigest: D("marker"), bodyDigest: D("body"), receiptDigest: D("marker receipt"),
      adopted: false }),
    verifyTerminal: async ({ replay }) => called(state, replay ? "terminal-replay" : "terminal", {
      mutationAuthorityReceiptDigest: D("admitted mutation authority"),
      terminalEvidenceDigest: D("terminal evidence"), leaseDigest: D("target lease"),
      markerDigest: D("marker"), bodyDigest: D("body"),
      dirtDigest: plan.evidence.dirtDigest,
      cloudAuthoritySubjectDigest: plan.evidence.cloudAuthoritySubjectDigest,
      cloudVerificationReceiptDigest: D(replay ? "fresh replay" : "fresh first") }),
  };
}
function called(state, name, value) { state.calls.push(name); return value; }
