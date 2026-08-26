// Responsibility: Prove exact planning, projection-only execution, and replay bounds.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlannedDirtyHeartbeatProjectionRecovery,
  buildPlannedDirtyHeartbeatProjectionRecoveryCompletion,
  buildPlannedDirtyHeartbeatProjectionRecoveryPlan,
  exactAuthorization,
} from "../scripts/planned-dirty-heartbeat-projection-recovery-contract.mjs";
import { createPlannedDirtyHeartbeatProjectionRecoveryController }
  from "../scripts/planned-dirty-heartbeat-projection-recovery-controller.mjs";
import {
  buildPlannedDirtyHeartbeatProjectionRecoveryEvidence,
  buildProjection,
  requireSameRecoveryOwnedDirt,
} from "../scripts/planned-dirty-heartbeat-projection-recovery-evidence.mjs";
import { createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter }
  from "../scripts/planned-dirty-heartbeat-projection-recovery-repository-adapter.mjs";
import {
  parseArguments, runCli,
} from "../scripts/planned-dirty-heartbeat-projection-recovery.mjs";
import {
  createTaskAuthorityBinding, createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const D = value => digestValue({ value });
const S = value => value.repeat(40);
const OBSERVED_AT = "2026-08-26T00:05:00.000Z";

test("plan seals exact authorization and a projection-only completion", () => {
  const plan = buildPlannedDirtyHeartbeatProjectionRecoveryPlan(evidence());
  const token = exactAuthorization(plan);
  assert.equal(token,
    `authorize planned-dirty-heartbeat-projection-recovery ${plan.planDigest}`);
  assert.equal(authorizePlannedDirtyHeartbeatProjectionRecovery(plan, token), token);
  assert.throws(() => authorizePlannedDirtyHeartbeatProjectionRecovery(
    plan, `${token}0`), /Exact authorization required/u);
  assert.throws(() => authorizePlannedDirtyHeartbeatProjectionRecovery(
    plan, "authorize planned-dirty-heartbeat-projection-recovery"),
  /Exact authorization required/u);

  const completion = buildPlannedDirtyHeartbeatProjectionRecoveryCompletion({
    plan, terminal: terminalFor(plan),
  });
  assert.equal(completion.status, "complete");
  assert.equal(completion.registryProjected, true);
  assert.equal(completion.markerProjected, true);
  assert.equal(completion.mutationPolicy.cloudLedger, false);
  assert.equal(completion.mutationPolicy.sourceBytes, false);
  assert.match(completion.completionDigest, /^[0-9a-f]{64}$/u);
  assert.throws(() => buildPlannedDirtyHeartbeatProjectionRecoveryCompletion({
    plan, terminal: { ...terminalFor(plan), targetBodyDigest: D("drift") },
  }), /terminal projection/u);
});

test("evidence accepts exactly one cloud heartbeat ahead and caps local TTL", () => {
  const value = evidence();
  assert.equal(value.projection.sourceTransitionCounter + 1,
    value.projection.targetTransitionCounter);
  assert.equal(value.projection.sourceHeartbeatCounter + 1,
    value.projection.targetHeartbeatCounter);
  assert.equal(value.projection.heartbeatAt, OBSERVED_AT);
  assert.equal(value.projection.expiresAt, "2026-08-26T00:15:00.000Z");
  assert.equal(value.recoveryReceipt.cloudMutation, false);
  assert.equal(value.recoveryReceipt.gitMutation, false);
  assert.equal(value.targetLease.admission.status, "planned");
  assert.equal(value.targetLease.fenceSha, value.sourceLease.fenceSha);
  assert.equal(value.targetLeaseDigest, writerLeaseDigest(value.targetLease));
  assert.equal(requireSameRecoveryOwnedDirt(value.ownedDirt,
    structuredClone(value.ownedDirt)).evidenceDigest, value.dirtDigest);
});

test("evidence rejects transition, heartbeat, identity, expiry, inventory, body, and dirt drift", () => {
  const cases = [
    ["transition", input => { input.targetCloudAuthority.transitionCounter += 1; }],
    ["heartbeat", input => { input.targetCloudAuthority.heartbeatCounter += 1; }],
    ["identity", input => { input.targetCloudAuthority.targetRepository = "owner/other"; }],
    ["expiry", input => { input.targetCloudAuthority.expiresAt =
      input.sourceLease.cloudAuthority.expiresAt; }],
    ["inventory", input => { input.inventoryHeartbeatCounter += 1; }],
    ["body", input => { input.pullRequest.body = input.pullRequest.body.replace(
      input.sourceLease.heartbeatAt, "2026-08-26T00:00:01.000Z"); }],
    ["dirt", input => { input.ownedDirt.entries[0].path = "outside/file.mjs";
      resealDirt(input.ownedDirt); }],
  ];
  for (const [label, mutate] of cases) {
    const input = evidenceInput();
    mutate(input);
    assert.throws(() => buildPlannedDirtyHeartbeatProjectionRecoveryEvidence(input),
      undefined, label);
  }

  const current = evidenceInput();
  current.targetCloudAuthority = structuredClone(current.sourceLease.cloudAuthority);
  current.inventoryHeartbeatCounter = current.targetCloudAuthority.heartbeatCounter;
  assert.throws(() => buildPlannedDirtyHeartbeatProjectionRecoveryEvidence(current),
    /one-transition one-heartbeat successor/u);
});

test("projection rejects a non-growing local window independently of cloud freshness", () => {
  const input = evidenceInput();
  assert.throws(() => buildProjection({
    sourceLease: input.sourceLease,
    targetCloudAuthority: input.targetCloudAuthority,
    observedAt: "2026-08-25T23:59:30.000Z",
  }), /growing TTL-capped local heartbeat window/u);
});

test("controller orders phases and adopts each exact replay or response-loss state", async () => {
  const cases = [
    ["source", false, false, ["registry", "marker"]],
    ["registry-lost", true, false, ["registry", "marker"]],
    ["marker-lost", false, true, ["registry", "marker"]],
    ["target-source", true, false, ["marker"]],
    ["target-target", true, true, []],
  ];
  for (const [initial, adoptedRegistry, adoptedMarker, mutations] of cases) {
    const fixture = controllerFixture(initial);
    const completion = await fixture.controller.execute({
      plan: fixture.plan,
      authorization: exactAuthorization(fixture.plan),
      taskAuthorityFile: "/external/task-authority.json",
    });
    assert.equal(completion.adoptedRegistryProjection, adoptedRegistry, initial);
    assert.equal(completion.adoptedMarkerProjection, adoptedMarker, initial);
    assert.deepEqual(fixture.calls.filter(call => ["registry", "marker"].includes(call)),
      mutations, initial);
    assert.equal(fixture.calls[0], "inspect", initial);
    assert.equal(fixture.calls[1], "authorize", initial);
    assert.equal(fixture.calls.at(-1), "terminal", initial);
  }
});

test("controller plans read-only and fails before effects without exact authority", async () => {
  const fixture = controllerFixture("source");
  assert.deepEqual(await fixture.controller.plan(), fixture.plan);
  await assert.rejects(() => fixture.controller.execute({
    plan: fixture.plan, authorization: "authorize", taskAuthorityFile: "/external/cap",
  }), /Exact authorization required/u);
  await assert.rejects(() => fixture.controller.execute({
    plan: fixture.plan, authorization: exactAuthorization(fixture.plan),
  }), /task-authority capability/u);
  assert.deepEqual(fixture.calls, ["plan"]);
  assert.throws(() => createPlannedDirtyHeartbeatProjectionRecoveryController({}),
    /requires inspectPlan/u);
});

test("CLI canonicalizes aliases and rejects unsafe external artifacts", t => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "heartbeat-parse-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const external = path.join(root, "external");
  mkdirSync(repository); mkdirSync(external);
  const repositoryAlias = path.join(root, "repository-alias");
  symlinkSync(repository, repositoryAlias);
  const planFile = path.join(external, "plan.json");
  const capability = path.join(external, "capability.json");
  writeFileSync(planFile, "{}\n", { mode: 0o600 });
  writeFileSync(capability, "{}\n", { mode: 0o600 });
  const planned = parseArguments([
    "plan", `--repository=${repositoryAlias}`, "--session=session",
    `--output=${path.join(external, "new-plan.json")}`, "--json",
  ]);
  assert.equal(planned.mode, "plan");
  assert.equal(planned.json, true);
  assert.equal(planned.repository, repository);
  const executed = parseArguments([
    "execute", `--repository=${repositoryAlias}`, "--session=session",
    `--plan-file=${planFile}`, `--task-authority=${capability}`,
    "--authorize=authorize exact",
  ]);
  assert.equal(executed.authorization, "authorize exact");
  chmodSync(planFile, 0o644);
  assert.throws(() => parseArguments([
    "execute", `--repository=${repository}`, "--session=session",
    `--plan-file=${planFile}`, `--task-authority=${capability}`, "--authorize=authorize exact",
  ]), /private regular non-symlink 0600/u);
  chmodSync(planFile, 0o600);
  const planAlias = path.join(external, "plan-alias.json");
  symlinkSync(planFile, planAlias);
  assert.throws(() => parseArguments([
    "execute", `--repository=${repository}`, "--session=session",
    `--plan-file=${planAlias}`, `--task-authority=${capability}`, "--authorize=authorize exact",
  ]), /non-symlink 0600/u);
  const outputParentAlias = path.join(root, "output-parent-alias");
  symlinkSync(repository, outputParentAlias);
  assert.throws(() => parseArguments([
    "plan", `--repository=${repositoryAlias}`, "--session=session",
    `--output=${path.join(outputParentAlias, "plan.json")}`,
  ]), /outside the source repository/u);
  const dotDotArtifacts = path.join(repository, "..artifacts");
  mkdirSync(dotDotArtifacts);
  const internalPlan = path.join(dotDotArtifacts, "plan.json");
  const internalCapability = path.join(dotDotArtifacts, "capability.json");
  writeFileSync(internalPlan, "{}\n", { mode: 0o600 });
  writeFileSync(internalCapability, "{}\n", { mode: 0o600 });
  assert.throws(() => parseArguments([
    "plan", `--repository=${repository}`, "--session=session",
    `--output=${path.join(dotDotArtifacts, "new-plan.json")}`,
  ]), /outside the source repository/u);
  for (const [plan, taskAuthority] of [
    [internalPlan, capability], [planFile, internalCapability],
  ]) assert.throws(() => parseArguments([
    "execute", `--repository=${repository}`, "--session=session",
    `--plan-file=${plan}`, `--task-authority=${taskAuthority}`,
    "--authorize=authorize exact",
  ]), /outside the source repository/u);
  const existingOutput = path.join(external, "existing.json");
  writeFileSync(existingOutput, "{}\n", { mode: 0o600 });
  assert.throws(() => parseArguments([
    "plan", `--repository=${repository}`, "--session=session",
    `--output=${existingOutput}`,
  ]), /new non-symlink file/u);
  assert.throws(() => parseArguments([
    "plan", `--repository=${repository}`, "--session=session",
    `--output=${path.join(external, "a")}`, `--output=${path.join(external, "b")}`,
  ]), /Invalid argument/u);
  assert.throws(() => parseArguments(["run"]), /Usage/u);
});

test("CLI writes a private sealed plan and forwards execute inputs", async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "heartbeat-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  const planFile = path.join(root, "plan.json");
  const capability = path.join(root, "capability.json");
  writeFileSync(capability, "{}\n", { mode: 0o600 });
  const plan = buildPlannedDirtyHeartbeatProjectionRecoveryPlan(evidence());
  const adapterToken = Object.freeze({ adapter: true });
  const calls = [];
  const dependencies = {
    createAdapter(input) { calls.push(["adapter", input.mode]); return adapterToken; },
    createController(adapter) {
      assert.equal(adapter, adapterToken);
      return {
        async plan() { calls.push(["plan"]); return plan; },
        async execute(input) { calls.push(["execute", input]);
          return buildPlannedDirtyHeartbeatProjectionRecoveryCompletion({
            plan, terminal: terminalFor(plan),
          }); },
      };
    },
  };
  const planned = await runCli([
    "plan", `--repository=${repository}`, "--session=session", `--output=${planFile}`,
  ], dependencies);
  assert.equal(planned.status, "planned");
  assert.deepEqual(JSON.parse(readFileSync(planFile, "utf8")), plan);
  assert.equal(statSync(planFile).mode & 0o777, 0o600);

  const token = exactAuthorization(plan);
  const complete = await runCli([
    "execute", `--repository=${repository}`, "--session=session", `--plan-file=${planFile}`,
    `--task-authority=${capability}`, `--authorize=${token}`,
  ], dependencies);
  assert.equal(complete.status, "complete");
  assert.equal(calls.at(-1)[1].taskAuthorityFile, realpathSync(capability));
  assert.equal(calls.at(-1)[1].authorization, token);
  await assert.rejects(() => runCli([
    "plan", `--repository=${repository}`, "--session=session", `--output=${planFile}`,
  ], dependencies), /new non-symlink file/u);
});

test("repository adapter performs only one registry CAS and one marker replacement", async t => {
  const fixture = repositoryFixture(t);
  const adapter = createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter(
    { repository: fixture.repository, sessionId: fixture.sessionId }, fixture.dependencies,
  );
  const controller = createPlannedDirtyHeartbeatProjectionRecoveryController(adapter);
  const plan = await controller.plan();
  const sourceDirtDigest = plan.evidence.dirtDigest;
  const completion = await controller.execute({
    plan, authorization: exactAuthorization(plan), taskAuthorityFile: fixture.capabilityPath,
  });

  assert.equal(completion.targetLeaseDigest, plan.evidence.targetLeaseDigest);
  assert.equal(fixture.counts().registryWrites, 1);
  assert.equal(fixture.counts().markerWrites, 1);
  assert.equal(fixture.counts().cloudWrites, 0);
  assert.equal(fixture.registry().leases[fixture.branch].admission.status, "planned");
  assert.equal(fixture.registry().leases[fixture.branch].fenceSha, fixture.headSha);
  assert.equal(execGit(fixture.repository, ["rev-parse", "HEAD"]), fixture.headSha);
  assert.equal((await adapter.verifyTerminal({ plan })).dirtDigest, sourceDirtDigest);

  const replay = await controller.execute({
    plan, authorization: exactAuthorization(plan), taskAuthorityFile: fixture.capabilityPath,
  });
  assert.equal(replay.adoptedRegistryProjection, true);
  assert.equal(replay.adoptedMarkerProjection, true);
  assert.equal(fixture.counts().registryWrites, 1);
  assert.equal(fixture.counts().markerWrites, 1);
});

test("repository adapter requires real CAS capability and external task authority", async t => {
  const fixture = repositoryFixture(t);
  assert.throws(() => createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter(
    { repository: fixture.repository, sessionId: fixture.sessionId }, {
      ...fixture.dependencies, leaseStore: { readRegistry() {} },
    }), /real writer-registry CAS capability/u);

  const adapter = createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter(
    { repository: fixture.repository, sessionId: fixture.sessionId }, fixture.dependencies,
  );
  const deceptiveDirectory = path.join(fixture.repository, "..auth");
  mkdirSync(deceptiveDirectory);
  const deceptiveCapability = path.join(deceptiveDirectory, "capability.json");
  writeFileSync(deceptiveCapability, "{}\n", { mode: 0o600 });
  const exclude = execGit(fixture.repository, ["rev-parse", "--git-path", "info/exclude"]);
  writeFileSync(path.resolve(fixture.repository, exclude), "/..auth/\n", { flag: "a" });
  const plan = await createPlannedDirtyHeartbeatProjectionRecoveryController(adapter).plan();
  await assert.rejects(() => adapter.authorizeTask({
    plan, taskAuthorityFile: deceptiveCapability,
  }), /external task-authority capability/u);
  await assert.rejects(() => adapter.authorizeTask({
    plan, taskAuthorityFile: path.join(fixture.repository, "src/new.mjs"),
  }), /external task-authority capability/u);
  assert.equal(fixture.counts().registryWrites, 0);
  assert.equal(fixture.counts().markerWrites, 0);
});

function controllerFixture(initial) {
  const plan = buildPlannedDirtyHeartbeatProjectionRecoveryPlan(evidence());
  let state = initial;
  const calls = [];
  const adapter = {
    async inspectPlan() { calls.push("plan"); return plan.evidence; },
    async inspectExecution() { calls.push("inspect"); return frame(state); },
    async authorizeTask() { calls.push("authorize"); },
    async projectRegistry() {
      calls.push("registry");
      state = state === "registry-lost" ? "target-source" : "target-source";
      if (initial === "registry-lost") throw new Error("registry response lost");
    },
    async projectMarker() {
      calls.push("marker"); state = "target-target";
      if (initial === "marker-lost") throw new Error("marker response lost");
    },
    async verifyTerminal() { calls.push("terminal"); return terminalFor(plan); },
  };
  return { plan, calls,
    controller: createPlannedDirtyHeartbeatProjectionRecoveryController(adapter) };
}

function frame(state) {
  if (state === "source" || state === "registry-lost" || state === "marker-lost") {
    return { registryProjected: false, markerProjected: false };
  }
  if (state === "target-source") return { registryProjected: true, markerProjected: false };
  return { registryProjected: true, markerProjected: true };
}

function terminalFor(plan) {
  const value = plan.evidence;
  return {
    targetLeaseDigest: value.targetLeaseDigest,
    targetCloudAuthorityDigest: value.targetCloudAuthorityDigest,
    recoveryReceiptDigest: value.recoveryReceipt.receiptDigest,
    dirtDigest: value.dirtDigest,
    targetMarkerDigest: value.targetMarkerDigest,
    targetBodyDigest: value.targetBodyDigest,
  };
}

function evidence() {
  return buildPlannedDirtyHeartbeatProjectionRecoveryEvidence(evidenceInput());
}

function evidenceInput() {
  const branch = "agent/test-device/heartbeat";
  const baseSha = S("a");
  const writeSet = ["path:src/new.mjs", "semantic:heartbeat"];
  const writeSetDigest = digestValue(writeSet);
  const claimIdentity = {
    actorId: "github-user:42", canonicalBaseRevision: baseSha, leaseEpoch: 1,
    repositoryId: "github-repository:R_heartbeat", workItemId: "work-item:heartbeat",
    writeSetDigest,
  };
  const claimId = digestValue(claimIdentity);
  const reviewRequestId = "github-pull-request:PR_42";
  const sourceAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "owner/controller", targetRepository: "owner/source",
    claimId, claimDigest: D("source-claim"), ledgerRevision: S("b"),
    ledgerDigest: D("source-ledger"), claimLedgerRevision: D("source-transition"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: D("source-operation"), mutationAuthorityEligible: true,
    canonicalBaseSha: baseSha, laneRevision: baseSha,
    cloudDeclaredWriteScope: writeSet, writeSetDigest,
    manifestDigest: D("manifest"), deviceId: "test-device", sessionId: "test-session",
    reviewRequestId, leaseEpoch: 1, transitionCounter: 2, heartbeatCounter: 4,
    state: "active", expiresAt: "2026-08-26T00:20:00.000Z",
    integrationReceiptDigest: null, integration: null,
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1", status: "planned",
    semanticScope: "heartbeat", declaredWriteSet: writeSet, writeSetDigest,
    manifestDigest: sourceAuthority.manifestDigest,
    planReceiptDigest: D("plan-receipt"), admissionReceiptDigest: D("admission-receipt"),
    existingLaneStateDigest: D("existing-state"),
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "test-session", device: "test-device", scope: "heartbeat", branch,
    worktreePath: "/worktree", baseSha, fenceSha: baseSha,
    pullRequestUrl: "https://github.com/owner/source/pull/42",
    autoDelivery: true, runtimeRequired: true,
    heartbeatAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-26T00:10:00.000Z",
    admission, cloudAuthority: sourceAuthority, integration: null,
  };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"1".repeat(64)}`,
    issuedAt: "2026-08-26T00:00:00.000Z",
  });
  lease.taskAuthority = createTaskAuthorityBinding({
    capability, lease, boundAt: "2026-08-26T00:00:00.000Z",
  });
  const ownedDirt = dirt(baseSha);
  const targetCloudAuthority = {
    ...sourceAuthority,
    claimDigest: D("target-claim"), ledgerRevision: S("c"),
    ledgerDigest: D("target-ledger"), claimLedgerRevision: D("target-transition"),
    operationReceiptDigest: D("target-operation"), transitionCounter: 3,
    heartbeatCounter: 5, expiresAt: "2026-08-26T00:30:00.000Z",
  };
  return {
    observedAt: OBSERVED_AT, repositoryPathDigest: D("repository-path"),
    sourceLease: lease, targetCloudAuthority, ownedDirt,
    registry: { schema: "agentic-writer-lease-registry/v2", revision: 8,
      registryDigest: D("registry"), leaseDigest: writerLeaseDigest(lease) },
    repository: { branch, headSha: baseSha, localRefSha: baseSha,
      remoteRefSha: baseSha, registered: true },
    pullRequest: { id: "PR_42", number: 42, url: lease.pullRequestUrl,
      state: "OPEN", isDraft: true, autoMergeRequest: null,
      headRepository: sourceAuthority.targetRepository, headRefName: branch,
      headRefOid: baseSha, baseRefName: "main",
      body: renderWriterLeasePullRequestBody(lease) },
    inventoryHeartbeatCounter: 5,
    cloudVerificationReceiptDigest: D("cloud-verification"),
    mutationAuthorityReceiptDigest: D("mutation-authority"),
  };
}

function dirt(headSha) {
  const entry = { path: "src/new.mjs", staged: false, unstaged: false,
    untracked: true, headMode: null, headBlob: null, indexMode: null, indexBlob: null,
    worktreeType: "file", worktreeMode: "100644", worktreeBlob: S("d") };
  const core = { schema: "agentic-active-owned-dirt-evidence/v1", headSha,
    entries: [entry], pathCount: 1, stagedPathCount: 0, unstagedPathCount: 0,
    untrackedPathCount: 1 };
  return { ...core, evidenceDigest: digestValue(core) };
}

function resealDirt(value) {
  const core = { ...value };
  delete core.evidenceDigest;
  value.evidenceDigest = digestValue(core);
}

function repositoryFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "heartbeat-adapter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  execGit(repository, ["init", "-q"]);
  execGit(repository, ["config", "user.name", "Test Agent"]);
  execGit(repository, ["config", "user.email", "agent@example.invalid"]);
  writeFileSync(path.join(repository, "README.md"), "baseline\n");
  execGit(repository, ["add", "README.md"]);
  execGit(repository, ["commit", "-qm", "test: baseline"]);
  const branch = "agent/test-device/heartbeat";
  execGit(repository, ["checkout", "-qb", branch]);
  mkdirSync(path.join(repository, "src"));
  writeFileSync(path.join(repository, "src/new.mjs"), "export const owned = true;\n");
  const headSha = execGit(repository, ["rev-parse", "HEAD"]);
  const input = evidenceInput();
  input.sourceLease.worktreePath = realpathSync(repository);
  input.sourceLease.baseSha = headSha;
  input.sourceLease.fenceSha = headSha;
  input.sourceLease.cloudAuthority.canonicalBaseSha = headSha;
  input.sourceLease.cloudAuthority.laneRevision = headSha;
  input.sourceLease.cloudAuthority.claimId = digestValue({
    actorId: "github-user:42", canonicalBaseRevision: headSha, leaseEpoch: 1,
    repositoryId: "github-repository:R_heartbeat", workItemId: "work-item:heartbeat",
    writeSetDigest: input.sourceLease.cloudAuthority.writeSetDigest,
  });
  input.sourceLease.taskAuthority = createTaskAuthorityBinding({
    capability: createTaskAuthorityCapability({
      authoritySubjectId: `urn:agentic-task:${"2".repeat(64)}`,
      issuedAt: "2026-08-26T00:00:00.000Z",
    }),
    lease: input.sourceLease, boundAt: "2026-08-26T00:00:00.000Z",
  });
  const sourceLease = structuredClone(input.sourceLease);
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 3,
    leases: { [branch]: sourceLease }, scopeExpansionIntents: {},
    activeOwnedDirtRecoveryIntents: {} };
  const statePath = path.join(root, "writer-leases.json");
  writeFileSync(statePath, `${JSON.stringify(registry)}\n`, { mode: 0o600 });
  let pullRequest = structuredClone(input.pullRequest);
  pullRequest.body = renderWriterLeasePullRequestBody(sourceLease);
  pullRequest.headRefOid = headSha;
  const targetAuthority = { ...sourceLease.cloudAuthority,
    claimDigest: D("adapter-target-claim"), ledgerRevision: S("c"),
    ledgerDigest: D("adapter-target-ledger"),
    claimLedgerRevision: D("adapter-target-transition"),
    operationReceiptDigest: D("adapter-target-operation"), transitionCounter: 3,
    heartbeatCounter: 5, expiresAt: "2026-08-26T00:30:00.000Z" };
  const claim = cloudClaim(targetAuthority, sourceLease);
  let registryWrites = 0, markerWrites = 0, cloudWrites = 0;
  const leaseStore = {
    statePath,
    readRegistry: () => JSON.parse(readFileSync(statePath, "utf8")),
    withRegistryLock(action) {
      const before = readFileSync(statePath, "utf8");
      const result = action(this.readRegistry());
      if (readFileSync(statePath, "utf8") !== before) registryWrites += 1;
      return result;
    },
  };
  const realGit = argumentsList => execGit(repository, argumentsList);
  const git = argumentsList => argumentsList[0] === "ls-remote"
    ? `${headSha}\trefs/heads/${branch}` : realGit(argumentsList);
  const status = { schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", claims: [claim],
    ledgerRevision: targetAuthority.ledgerRevision,
    ledgerDigest: targetAuthority.ledgerDigest };
  const capabilityPath = path.join(root, "task-authority.json");
  writeFileSync(capabilityPath, "{}\n", { mode: 0o600 });
  const dependencies = {
    git, leaseStore, now: () => new Date(OBSERVED_AT),
    gh: () => JSON.stringify({ ...pullRequest,
      headRepository: { nameWithOwner: pullRequest.headRepository } }),
    execute(command, argumentsList) {
      if (command !== "gh" || argumentsList[0] !== "pr" || argumentsList[1] !== "edit") {
        throw new Error(`unexpected mutation command: ${command} ${argumentsList.join(" ")}`);
      }
      pullRequest.body = argumentsList[4]; markerWrites += 1; return "";
    },
    inspectCloudStatus: () => structuredClone(status),
    verifyCloud: ({ authority }) => ({ authority: structuredClone(authority),
      verification: { receiptDigest: D("adapter-cloud-verification"),
        inventory: { claims: [structuredClone(claim)] } } }),
    assertMutationAuthority: () => ({ receiptDigest: D("adapter-mutation-authority") }),
    authorizeTaskMutation: ({ lease }) => ({
      bindingDigest: lease.taskAuthority.bindingDigest,
    }),
  };
  return { repository, branch, headSha, sessionId: sourceLease.sessionId,
    capabilityPath, dependencies, registry: () => leaseStore.readRegistry(),
    counts: () => ({ registryWrites, markerWrites, cloudWrites }) };
}

function cloudClaim(authority, lease) {
  return {
    claimId: authority.claimId, entrySchema: authority.entrySchema,
    claimIdentitySchema: authority.claimIdentitySchema,
    operationReceiptDigest: authority.operationReceiptDigest,
    mutationAuthorityEligible: true, state: "current", writeAuthority: true,
    scopeReserved: true, actorId: "github-user:42",
    repositoryId: "github-repository:R_heartbeat", workItemId: "work-item:heartbeat",
    canonicalBaseRevision: authority.canonicalBaseSha, laneRevision: authority.laneRevision,
    declaredWriteScope: authority.cloudDeclaredWriteScope,
    writeSetDigest: authority.writeSetDigest, leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter, heartbeatCounter: authority.heartbeatCounter,
    reviewRequestId: authority.reviewRequestId, expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest, transitionDigest: authority.claimLedgerRevision,
    integrationReceiptDigest: null, integration: null,
    deviceId: lease.device, sessionId: lease.sessionId,
  };
}

function execGit(repository, argumentsList) {
  return String(execFileSync("git", argumentsList, { cwd: repository, encoding: "utf8" })).trim();
}
