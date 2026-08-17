import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
import { buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence }
  from "../scripts/current-cloud-expired-local-owned-dirt-continuation-evidence.mjs";
import { buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan,
  currentCloudExpiredLocalOwnedDirtContinuationOperationKey }
  from "../scripts/current-cloud-expired-local-owned-dirt-continuation-contract.mjs";
import { createCurrentCloudExpiredLocalOwnedDirtContinuationController }
  from "../scripts/current-cloud-expired-local-owned-dirt-continuation-controller.mjs";
import { createRepositoryCurrentCloudExpiredLocalOwnedDirtContinuationAdapter }
  from "../scripts/current-cloud-expired-local-owned-dirt-continuation-repository-adapter.mjs";

const DIGEST = value => digestValue({ value });
const SOURCE_EXPIRY = "2026-08-16T00:00:00.000Z";
const OBSERVED_AT = "2026-08-16T00:01:00.000Z";
const CLOUD_EXPIRY = "2026-08-16T01:00:00.000Z";

test("success projects only the local registry and reports cumulative mutation", async () => {
  const fixture = controllerFixture();
  const result = await fixture.controller.run({ plan: fixture.plan });
  assert.equal(result.status, "mutation-authority-restored");
  assert.equal(result.writerRegistryDisposition, "projected");
  assert.equal(result.writerRegistryMutation, true);
  assertForbiddenEffects(result);
  assert.deepEqual(fixture.calls, [
    "lock", "read", "write:prepared", "cloud:before-authority", "authority",
    "write:authority-verified", "cloud:before-local", "write:local-attempted",
    "project", "write:local-projected", "verify:false", "write:verified",
    "write:complete",
  ]);
});

test("exact terminal replay performs no second CAS and preserves cumulative disposition", async () => {
  const fixture = controllerFixture();
  const first = await fixture.controller.run({ plan: fixture.plan });
  const projects = fixture.calls.filter(value => value === "project").length;
  const second = await fixture.controller.run({ plan: fixture.plan });
  assert.deepEqual(second, first);
  assert.equal(second.writerRegistryMutation, true);
  assert.equal(fixture.calls.filter(value => value === "project").length, projects);
  assert.equal(fixture.calls.at(-1), "verify:true");
});

test("post-CAS response loss adopts the exact target without erasing causal mutation", async () => {
  const fixture = controllerFixture({ responseLoss: "target" });
  const result = await fixture.controller.run({ plan: fixture.plan });
  assert.equal(result.writerRegistryDisposition, "adopted-response-loss");
  assert.equal(result.writerRegistryMutation, true);
  assert.equal(fixture.calls.filter(value => value === "project").length, 1);
  assert.ok(fixture.calls.includes("cloud:after-local-error"));
  assertForbiddenEffects(result);
});

test("post-CAS response loss rejects a third registry state", async () => {
  const fixture = controllerFixture({ responseLoss: "third" });
  await assert.rejects(
    fixture.controller.run({ plan: fixture.plan }),
    /response lost/u,
  );
  assert.equal(fixture.calls.filter(value => value === "project").length, 1);
  assert.equal(fixture.intent().status, "local-attempted");
});

test("a fresh repository adapter hydrates the durable CAS receipt without a second CAS", () => {
  const plan = buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan({
    evidence: buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence(evidenceInput()),
  });
  const repository = mkdtempSync(path.join(os.tmpdir(), "local-continuation-restart-"));
  const targetLease = { ...plan.evidence.lease, heartbeatAt: plan.evidence.observedAt,
    expiresAt: plan.evidence.cloudClaim.expiresAt };
  const operationKey = currentCloudExpiredLocalOwnedDirtContinuationOperationKey(
    plan, "local-attempted",
  );
  const authorityVerified = { taskAuthorityBindingDigest: plan.evidence.taskCapabilityDigest,
    taskAuthorityReceiptDigest: DIGEST("restart-task-receipt") };
  const localAttempted = { idempotencyKey: digestValue({ planDigest: plan.planDigest,
    phase: "local-attempted" }), sourceLeaseDigest: plan.evidence.leaseDigest,
  targetLeaseDigest: writerLeaseDigest(targetLease) };
  const receiptCore = {
    schema: "agentic-current-cloud-expired-local-owned-dirt-continuation-registry-receipt/v1",
    operationKey, planDigest: plan.planDigest, sourceLeaseDigest: plan.evidence.leaseDigest,
    targetLeaseDigest: writerLeaseDigest(targetLease), claimId: plan.evidence.cloudClaim.claimId,
    registryRevision: 42, phaseValues: { authorityVerified, localAttempted },
    writerRegistryMutation: true,
  };
  let casCalls = 0;
  const registry = { schema: "agentic-writer-lease-registry/v1", revision: 42,
    leases: { [targetLease.branch]: targetLease },
    currentCloudExpiredLocalOwnedDirtContinuationReceipts: {
      [operationKey]: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
    } };
  const leaseStore = { readRegistry: () => registry, read: () => targetLease,
    withRegistryLock() { casCalls += 1; throw new Error("unexpected second CAS"); },
    statePath: path.join(repository, "writer-leases.json") };
  const dependencies = { leaseStore, realpath: value => path.resolve(value),
    git(argumentsList) {
      if (argumentsList[0] === "branch") return targetLease.branch;
      if (argumentsList[0] === "rev-parse" && argumentsList[1] === "--git-common-dir") {
        return repository;
      }
      throw new Error(`unexpected git read: ${argumentsList.join(" ")}`);
    } };
  const create = () => createRepositoryCurrentCloudExpiredLocalOwnedDirtContinuationAdapter({
    repository, sessionId: targetLease.sessionId,
  }, dependencies);
  assert.equal(create().readIntent(plan).status, "local-attempted");
  assert.equal(create().readIntent(plan).status, "local-attempted");
  assert.equal(casCalls, 0);
});

test("repository evidence forwards optional reads and worktree bytes to Git", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "local-continuation-dirt-"));
  const runGit = argumentsList => execFileSync("git", argumentsList,
    { cwd: repository, encoding: "utf8" }).trim();
  runGit(["init", "-b", "agent/owner/local-continuation"]);
  runGit(["config", "user.email", "agentic-canvas-os@localhost"]);
  runGit(["config", "user.name", "Agentic Canvas OS"]);
  writeFileSync(path.join(repository, "owned.txt"), "source\n");
  runGit(["add", "owned.txt"]);
  runGit(["commit", "-m", "source"]);
  writeFileSync(path.join(repository, "owned.txt"), "staged\n");
  runGit(["add", "owned.txt"]);
  writeFileSync(path.join(repository, "owned.txt"), "worktree\n");

  const branch = runGit(["branch", "--show-current"]);
  const headSha = runGit(["rev-parse", "HEAD"]);
  const writeSet = ["path:owned.txt", "semantic:local-continuation"];
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "owner-session", device: "owner-device", scope: "local-continuation",
    branch, worktreePath: realpathSync(repository), baseSha: "a".repeat(40), fenceSha: headSha,
    heartbeatAt: "2026-08-15T23:30:00.000Z", expiresAt: SOURCE_EXPIRY,
    taskAuthority: { bindingDigest: DIGEST("task-binding") },
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet: writeSet, writeSetDigest: digestValue(writeSet),
      manifestDigest: DIGEST("manifest") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", state: "active",
      claimId: DIGEST("claim"), claimDigest: DIGEST("claim-fence"),
      leaseEpoch: 3, transitionCounter: 7, heartbeatCounter: 2,
      operationReceiptDigest: DIGEST("operation"), targetRepository: "example/repository" },
  };
  const claim = { entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    claimId: lease.cloudAuthority.claimId, fenceRevision: lease.cloudAuthority.claimDigest,
    transitionDigest: DIGEST("transition"),
    operationReceiptDigest: lease.cloudAuthority.operationReceiptDigest,
    state: "current", writeAuthority: true, scopeReserved: true,
    canonicalBaseRevision: lease.baseSha, laneRevision: lease.fenceSha,
    leaseEpoch: lease.cloudAuthority.leaseEpoch,
    transitionCounter: lease.cloudAuthority.transitionCounter,
    heartbeatCounter: lease.cloudAuthority.heartbeatCounter,
    expiresAt: CLOUD_EXPIRY, declaredWriteScope: writeSet,
    writeSetDigest: lease.admission.writeSetDigest };
  const verification = { status: "ready", verifiedAt: OBSERVED_AT,
    ledgerRevision: "c".repeat(40), ledgerDigest: DIGEST("ledger"),
    remoteClaimInventoryDigest: DIGEST("inventory"), receiptDigest: DIGEST("verification"),
    inventory: { claims: [claim] } };
  const adapter = createRepositoryCurrentCloudExpiredLocalOwnedDirtContinuationAdapter({
    repository, sessionId: lease.sessionId,
  }, { leaseStore: { read: () => lease }, verifyCloud: () => ({ verification }) });
  const evidence = adapter.readPlanEvidence();
  assert.equal(evidence.ownedDirt.entries[0].indexBlob,
    runGit(["rev-parse", ":owned.txt"]));
  assert.notEqual(evidence.ownedDirt.entries[0].worktreeBlob,
    evidence.ownedDirt.entries[0].indexBlob);
  assert.equal(evidence.ownedDirt.entries[0].staged, true);
  assert.equal(evidence.ownedDirt.entries[0].unstaged, true);
});

test("evidence rejects drift, out-of-scope dirt, cloud state, and expiry", () => {
  const cases = [
    ["lease digest drift", input => { input.leaseDigest = DIGEST("drift"); }],
    ["out-of-scope dirt", input => { input.ownedDirt.entries[0].path = "secrets/outside";
      resealDirt(input.ownedDirt); }],
    ["non-current cloud", input => { input.cloudClaim.state = "dormant-preserved"; }],
    ["expired cloud", input => { input.cloudClaim.expiresAt = OBSERVED_AT; }],
    ["unexpired local", input => { input.lease.expiresAt = CLOUD_EXPIRY;
      input.leaseDigest = writerLeaseDigest(input.lease); }],
    ["overlapping claim", input => { input.cloudObservation.overlappingClaimIds = [DIGEST("peer")]; }],
    ["forbidden boundary expansion", input => { input.mutationBoundary = {
      allowedMutations: ["writer-lease-registry-cas", "cloud"], forbiddenEffects: [],
    }; }],
  ];
  for (const [name, mutate] of cases) {
    const input = evidenceInput();
    mutate(input);
    assert.throws(
      () => buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence(input),
      undefined,
      name,
    );
  }
});

function controllerFixture({ responseLoss = null } = {}) {
  const plan = buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan({
    evidence: buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence(evidenceInput()),
  });
  const calls = [];
  let intent = null;
  const adapter = {
    readPlanEvidence() { return plan.evidence; },
    withOperationLock(action) { calls.push("lock"); return action(); },
    readIntent() { calls.push("read"); return intent; },
    writeIntent({ expected, value }) {
      assert.equal(intent, expected);
      intent = value;
      calls.push(`write:${value.status}`);
    },
    authorizeTask() {
      calls.push("authority");
      return { taskAuthorityReceiptDigest: DIGEST("authority-receipt"),
        taskAuthorityBindingDigest: plan.evidence.taskCapabilityDigest };
    },
    revalidateCloud(_plan, phase) {
      calls.push(`cloud:${phase}`);
      if (phase === "after-local-error") {
        return responseLoss === "target"
          ? { localProjected: true,
            values: projectionValues("adopted-response-loss", { plan }) }
          : { localProjected: false };
      }
      return { idempotencyKey: DIGEST("local-operation"),
        sourceLeaseDigest: plan.evidence.leaseDigest,
        targetLeaseDigest: DIGEST("target-lease") };
    },
    projectLocal() {
      calls.push("project");
      if (responseLoss) throw new Error("registry response lost");
      return projectionValues("projected", { plan });
    },
    verifyTerminal(_plan, { replay }) {
      calls.push(`verify:${replay}`);
      return { mutationAuthorityReceiptDigest: mutationAuthority(plan).receiptDigest,
        targetLeaseDigest: DIGEST("target-lease"),
        verificationDigest: DIGEST(`terminal-${replay}`) };
    },
  };
  return { controller: createCurrentCloudExpiredLocalOwnedDirtContinuationController(adapter),
    plan, calls, intent: () => intent };
}

function projectionValues(disposition, extra = {}) {
  const plan = extra.plan;
  delete extra.plan;
  return {
    disposition,
    writerRegistryMutation: true,
    targetLeaseDigest: DIGEST("target-lease"),
    mutationAuthorityReceipt: mutationAuthority(plan),
    ...extra,
  };
}

function mutationAuthority(plan) {
  const evidence = plan.evidence;
  const core = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: evidence.cloudClaim.claimId, claimDigest: evidence.cloudClaim.fenceRevision,
    ledgerRevision: evidence.cloudObservation.ledgerRevision,
    localFenceSha: evidence.lease.fenceSha, localLeaseEpoch: evidence.lease.epoch,
    remoteLeaseEpoch: evidence.cloudClaim.leaseEpoch, expiresAt: evidence.cloudClaim.expiresAt,
    cloudVerificationReceiptDigest: evidence.cloudObservation.verificationReceiptDigest,
    evaluatedAt: evidence.observedAt };
  return { ...core, receiptDigest: digestValue(core) };
}

function evidenceInput() {
  const writeSet = ["path:scripts/runtime.mjs", "semantic:local-continuation"];
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "owner-session", device: "owner-device", scope: "local-continuation",
    branch: "agent/owner/current-cloud-local-continuation", worktreePath: "/owned/worktree",
    baseSha: "a".repeat(40), fenceSha: "b".repeat(40),
    heartbeatAt: "2026-08-15T23:30:00.000Z", expiresAt: SOURCE_EXPIRY,
    taskAuthority: { bindingDigest: DIGEST("task-binding") },
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet: writeSet, writeSetDigest: digestValue(writeSet),
      manifestDigest: DIGEST("manifest") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", state: "active",
      claimId: DIGEST("claim"), claimDigest: DIGEST("claim-fence"),
      leaseEpoch: 3, transitionCounter: 7, heartbeatCounter: 2,
      operationReceiptDigest: DIGEST("operation") },
  };
  const dirtCore = {
    schema: "agentic-active-owned-dirt-evidence/v1", headSha: lease.fenceSha,
    entries: [{ path: "scripts/runtime.mjs", staged: true, unstaged: true,
      untracked: false, headMode: "100644", headBlob: "1".repeat(40),
      indexMode: "100644", indexBlob: "2".repeat(40), worktreeType: "file",
      worktreeMode: "100644", worktreeBlob: "3".repeat(40) }],
    pathCount: 1, stagedPathCount: 1, unstagedPathCount: 1, untrackedPathCount: 0,
  };
  const cloudClaim = {
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    claimId: lease.cloudAuthority.claimId, fenceRevision: lease.cloudAuthority.claimDigest,
    transitionDigest: DIGEST("transition"),
    operationReceiptDigest: lease.cloudAuthority.operationReceiptDigest,
    state: "current", writeAuthority: true, scopeReserved: true,
    canonicalBaseRevision: lease.baseSha, laneRevision: lease.fenceSha,
    leaseEpoch: lease.cloudAuthority.leaseEpoch,
    transitionCounter: lease.cloudAuthority.transitionCounter,
    heartbeatCounter: lease.cloudAuthority.heartbeatCounter,
    expiresAt: CLOUD_EXPIRY, declaredWriteScope: writeSet,
    writeSetDigest: lease.admission.writeSetDigest,
  };
  return {
    repository: "example/repository", observedAt: OBSERVED_AT, lease,
    leaseDigest: writerLeaseDigest(lease), cloudClaim,
    cloudObservation: { status: "ready", evaluatedAt: OBSERVED_AT,
      ledgerRevision: "c".repeat(40), ledgerDigest: DIGEST("ledger"),
      inventoryDigest: DIGEST("inventory"),
      verificationReceiptDigest: DIGEST("cloud-verification"), overlappingClaimIds: [] },
    ownedDirt: { ...dirtCore, evidenceDigest: digestValue(dirtCore) },
    taskCapabilityDigest: DIGEST("task-binding"),
  };
}

function resealDirt(dirt) {
  const { evidenceDigest: _ignored, ...core } = dirt;
  dirt.evidenceDigest = digestValue(core);
}

function assertForbiddenEffects(result) {
  for (const field of ["cloudMutation", "sourceMutation", "gitMutation",
    "remoteRefMutation", "pullRequestMutation", "newClaimCreated", "newWorktreeCreated",
    "deploymentMutation", "cleanupMutation"]) {
    assert.equal(result[field], false, field);
  }
}
