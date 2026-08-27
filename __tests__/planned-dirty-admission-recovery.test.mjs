import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlannedDirtyAdmissionRecovery,
  createRecoveryIntent,
  OPERATION,
} from "../scripts/planned-dirty-admission-recovery-contract.mjs";
import { createPlannedDirtyAdmissionRecoveryController }
  from "../scripts/planned-dirty-admission-recovery-controller.mjs";
import { createPlannedDirtyAdmissionRecoveryStore }
  from "../scripts/planned-dirty-admission-recovery-store.mjs";
import { parsePlannedDirtyAdmissionRecoveryArguments }
  from "../scripts/planned-dirty-admission-recovery.mjs";
import {
  controllerState,
  D,
  evidenceFixture,
  fakeAdapter,
  FENCE,
  fenceAdapter,
  OBSERVED,
  planFixture,
  PROTECTED,
  terminalAdapterFixture,
} from "./helpers/planned-dirty-admission-recovery-fixtures.mjs";

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

test("plan seals one exact lost heartbeat and renews only the local projection", () => {
  const plan = planFixture({ oneAhead: true });
  const heartbeat = plan.evidence.heartbeatProjection;
  assert.equal(heartbeat.disposition, "one-ahead");
  assert.equal(heartbeat.sourceTransitionCounter, 2);
  assert.equal(heartbeat.targetTransitionCounter, 3);
  assert.equal(heartbeat.sourceHeartbeatCounter, 0);
  assert.equal(heartbeat.targetHeartbeatCounter, 1);
  assert.equal(heartbeat.heartbeatAt, OBSERVED);
  assert.equal(heartbeat.expiresAt, "2026-08-26T00:30:00.000Z");
  assert.equal(plan.evidence.targetCloudAuthority.transitionCounter, 3);
  assert.equal(plan.evidence.targetCloudAuthority.heartbeatCounter, 1);
});

test("one-ahead evidence rejects counter, expiry, digest, and immutable identity drift", () => {
  const scope = ["path:docs/b.md", "semantic:repair"];
  const cases = [
    ["transition +2", { transitionCounter: 4, heartbeatCounter: 2 }],
    ["heartbeat +2", { heartbeatCounter: 2 }],
    ["same transition", { transitionCounter: 2 }],
    ["non-growing expiry", { expiresAt: "2026-08-25T23:30:00.000Z" }],
    ["same claim fence", { claimDigest: D("claim fence") }],
    ["same transition digest", { claimLedgerRevision: D("claim transition") }],
    ["same operation digest", { operationReceiptDigest: D("cloud operation") }],
    ["scope", { cloudDeclaredWriteScope: scope, writeSetDigest: digestValue(scope) }],
    ["base", { canonicalBaseSha: PROTECTED }],
    ["review", { reviewRequestId: "github-pull-request:PR_2" }],
    ["state", { state: "parked" }],
    ["integration", { integrationReceiptDigest: D("integration"),
      integration: { receiptDigest: D("integration evidence") } }],
  ];
  for (const [label, targetAuthorityChanges] of cases) {
    assert.throws(() => evidenceFixture({ oneAhead: true, targetAuthorityChanges }),
      /heartbeat|cloud authority|cloud subject|joined recovery subject/u, label);
  }
});

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

test("full target marker capacity fails before registry mutation", () => {
  const fixture = terminalAdapterFixture({ registrySource: true,
    mutableRegistry: true, exactTargetOverflow: true });
  assert.throws(() => fixture.adapter.projectRegistry({
    plan: fixture.plan, intent: fixture.intent,
  }), /bounded exact target pull-request marker body/u);
  assert.equal(fixture.registryCasCalls(), 0);
});

for (const oneAhead of [false, true]) {
  test(`repository adapter atomically projects ${oneAhead ? "one-ahead" : "exact-current"} authority`, () => {
    const fixture = terminalAdapterFixture({ oneAhead, registrySource: true,
      mutableRegistry: true });
    const result = fixture.adapter.projectRegistry({
      plan: fixture.plan, intent: fixture.intent,
    });
    const lease = fixture.registry().leases[fixture.plan.evidence.sourceLease.branch];
    assert.equal(lease.admission.status, "admitted");
    assert.deepEqual(lease.cloudAuthority, fixture.plan.evidence.targetCloudAuthority);
    assert.equal(lease.heartbeatAt, fixture.plan.evidence.heartbeatProjection.heartbeatAt);
    assert.equal(lease.expiresAt, fixture.plan.evidence.heartbeatProjection.expiresAt);
    assert.equal(result.targetCloudAuthorityDigest,
      fixture.plan.evidence.targetCloudAuthorityDigest);
    assert.equal(fixture.registry().revision, 2);
    assert.ok(fixture.mutationAuthorityCalls.every(item =>
      item === "planned:true" || item === "admitted:false"));
  });
}

test("repository adapter adopts one-ahead registry CAS after response loss", () => {
  const fixture = terminalAdapterFixture({ oneAhead: true, registrySource: true,
    mutableRegistry: true, registryResponseLoss: true });
  assert.throws(() => fixture.adapter.projectRegistry({
    plan: fixture.plan, intent: fixture.intent,
  }), /simulated registry response loss/u);
  const replay = fixture.adapter.projectRegistry({
    plan: fixture.plan, intent: fixture.intent,
  });
  assert.equal(replay.adopted, true);
  assert.equal(fixture.registry().revision, 2);
});

test("repository adapter rejects a second heartbeat after the sealed plan", () => {
  const fixture = terminalAdapterFixture({ oneAhead: true, registrySource: true,
    mutableRegistry: true, secondHeartbeat: true });
  assert.throws(() => fixture.adapter.projectRegistry({
    plan: fixture.plan, intent: fixture.intent,
  }), /not one exact renewal ahead/u);
  assert.equal(fixture.registry().revision, 1);
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
