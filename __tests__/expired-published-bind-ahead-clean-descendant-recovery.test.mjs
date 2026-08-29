import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync }
  from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCloudTransition, createEmptyLedger, listCurrentClaims,
} from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildExpiredPublishedBindAheadCleanDescendantRecoveryEvidence,
  normalizeExpiredPublishedBindAheadCleanDescendantRecoveryEvidence,
} from "../scripts/expired-published-bind-ahead-clean-descendant-recovery-evidence.mjs";
import {
  advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent,
  authorizeExpiredPublishedBindAheadCleanDescendantRecovery,
  buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption,
  buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan,
  createExpiredPublishedBindAheadCleanDescendantRecoveryIntent,
} from "../scripts/expired-published-bind-ahead-clean-descendant-recovery-contract.mjs";
import { createExpiredPublishedBindAheadCleanDescendantRecoveryController }
  from "../scripts/expired-published-bind-ahead-clean-descendant-recovery-controller.mjs";
import {
  assertExpiredPublishedBindAheadCleanDescendantGitFrame,
  classifyExpiredPublishedBindAheadCloudLineage,
  classifyExpiredPublishedBindAheadBranchControllerFence,
  createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter,
  normalizeExpiredPublishedBindAheadCloudSidecar,
  projectExpiredPublishedBindAheadCleanDescendantLease,
  reverifyExpiredPublishedBindAheadCleanDescendantMutationAuthority,
}
  from "../scripts/expired-published-bind-ahead-clean-descendant-recovery-repository-adapter.mjs";
import {
  projectPublicClaim, pseudonymousIdentifier,
} from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  createTaskAuthorityBinding, createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  isOperationDerivedCloudVerification,
  markOperationDerivedCloudVerification,
} from "../scripts/scoped-lane-admission-lib.mjs";
import {
  parseWriterLeasePullRequestBody, renderWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import { readExpiredCommittedScopeExpansionIntent }
  from "../scripts/expired-committed-scope-expansion-contract.mjs";
import { acquireReviewedLaneEntrypointFence }
  from "../scripts/reviewed-lane-revision-fence.mjs";
import {
  beginScopeExpansionIntent, heartbeatWriterLeaseProjection, writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";

const D = value => digestValue({ value });
const S = value => value.repeat(40);
const BASE = S("1");
const F = S("2");
const R = S("3");
const H = S("4");
const TREE = S("5");
const BRANCH = "agent/device.test/bind-ahead";
const SESSION = "bind-ahead-session";
const PULL_ID = "PR_bind_ahead_fixture";
const PULL_URL = "https://github.com/example/repository/pull/879";
const OBSERVED_AT = "2026-08-30T01:00:00.000Z";
const EXPIRES_AT = "2026-08-30T00:30:00.000Z";
const WRITE_SET = Object.freeze(["path:scripts/recovery.mjs", "semantic:bind-ahead"]);

test("raw proof keeps transport and claim revisions distinct across unrelated suffixes", () => {
  const fixture = buildFixture();
  const proof = fixture.evidence.cloud;
  assert.equal(proof.sourceEntry.sequence + 1, proof.source.sequence);
  assert.equal(proof.sourceEntry.digest, fixture.lease.cloudAuthority.claimLedgerRevision);
  assert.notEqual(proof.source.ledgerDigest, proof.sourceEntry.digest);
  assert.equal(proof.sourceTransportSuffixCount, 1);
  assert.equal(proof.unrelatedBetweenSourceAndBindCount, 2);
  assert.equal(proof.unrelatedBetweenTransportAndBindCount, 1);
  assert.equal(proof.unrelatedAfterBindCount, 1);
  assert.equal(proof.targetEntry.claimCore.laneRevision, R);
  assert.equal(fixture.evidence.committed.localHeadSha, H);
});

test("target lease moves the authority fence to R and retains the exact task binding", () => {
  const { evidence, lease } = buildFixture();
  const authority = Object.freeze({
    ...lease.cloudAuthority,
    claimDigest: evidence.cloud.targetEntry.claimDigest,
    claimLedgerRevision: evidence.cloud.targetEntry.digest,
    operationReceiptDigest: evidence.cloud.targetOperationReceipt.receiptDigest,
    laneRevision: R,
    transitionCounter: evidence.cloud.targetEntry.claimCore.transitionCounter,
    ledgerRevision: evidence.cloud.current.ledgerRevision,
    ledgerDigest: evidence.cloud.current.ledgerDigest,
    expiresAt: "2026-08-30T02:00:00.000Z",
    state: "active",
  });
  const target = projectExpiredPublishedBindAheadCleanDescendantLease({
    sourceLease: lease,
    publishedFenceSha: R,
    cloudAuthority: authority,
    verifiedAt: "2026-08-30T01:01:00.000Z",
  });
  assert.equal(target.fenceSha, R);
  assert.equal(target.cloudAuthority.laneRevision, R);
  assert.deepEqual(target.taskAuthority, lease.taskAuthority);
  assert.equal(target.worktreePath, lease.worktreePath);
});

test("cloud lineage admits exact dormant t4 and current t5 recovery descendants", () => {
  const fixture = buildFixture();
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
    evidence: fixture.evidence,
  });
  const t4 = continueRecovery({
    ledger: fixture.currentLedger,
    plan,
    evaluationTime: "2026-08-30T01:00:00.000Z",
    expiresAt: "2026-08-30T01:10:00.000Z",
  });
  const dormantT4 = projectPublicClaim(listCurrentClaims(
    t4.ledger,
    "2026-08-30T01:11:00.000Z",
  ).find(candidate => candidate.claimId === plan.evidence.cloud.liveClaim.claimId));
  assert.equal(classifyExpiredPublishedBindAheadCloudLineage({
    plan,
    status: { sequence: t4.ledger.sequence, ledgerDigest: t4.ledger.headDigest },
    ledger: t4.ledger,
    claim: dormantT4,
  }), "dormant-recovered");
  const t5 = continueRecovery({
    ledger: t4.ledger,
    plan,
    evaluationTime: "2026-08-30T01:11:00.000Z",
    expiresAt: "2026-08-30T02:00:00.000Z",
  });
  const currentT5 = projectPublicClaim(listCurrentClaims(
    t5.ledger,
    "2026-08-30T01:12:00.000Z",
  ).find(candidate => candidate.claimId === plan.evidence.cloud.liveClaim.claimId));
  assert.equal(classifyExpiredPublishedBindAheadCloudLineage({
    plan,
    status: { sequence: t5.ledger.sequence, ledgerDigest: t5.ledger.headDigest },
    ledger: t5.ledger,
    claim: currentT5,
  }), "recovered");
});

test("controller adopts a current bind, persists attempts, and replays terminal proof", async () => {
  const { evidence } = buildFixture();
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({ evidence });
  const calls = [];
  let intent = null;
  const cloud = cloudValues(plan, "adopted-current-bind");
  const branchFence = branchFenceValues(plan);
  const local = localValues(plan, cloud);
  const marker = markerValues(plan, local, cloud);
  const verified = verifiedValues(plan, cloud, local, marker);
  const adapter = {
    async readPlanEvidence() { return evidence; },
    async readPlanTtlSeconds() { return plan.ttlSeconds; },
    async withOperationLock(action) { calls.push("lock"); return action(); },
    async assertRuntimeSubject(received) { assert.equal(received.planDigest, plan.planDigest); },
    async readIntent() { return intent; },
    async writeIntent({ expected, value }) {
      assert.equal(expected?.intentDigest || null, intent?.intentDigest || null);
      intent = value;
    },
    async authorizeTask(_plan, { intent: receivedIntent } = {}) {
      assert.equal(receivedIntent?.status, "authorized");
      calls.push("authorize-task");
      return { bindingDigest: evidence.committed.taskAuthorityBindingDigest,
        taskAuthorityReceiptDigest: D("task-receipt"), taskProofDigest: D("task-proof") };
    },
    async acquireBranchFence() { calls.push("acquire-branch-fence"); return branchFence; },
    async releaseBranchFence() { calls.push("release-branch-fence"); return {}; },
    async revalidate(_plan, phase) {
      calls.push(phase);
      if (phase === "before-task-authority") return { revalidationDigest: D(phase) };
      if (phase === "before-branch-fence") return branchFenceAttempt(plan, phase);
      if (phase === "adopt-branch-fence") return { branchFenced: false };
      if (phase === "adopt-bind") {
        return buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption(
          plan,
          D(phase),
        );
      }
      if (phase === "before-cloud") return { claimState: "current-bind",
        recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
        revalidationDigest: D(phase) };
      if (phase === "adopt-cloud") return { cloudReconciled: true, values: cloud };
      if (phase === "before-local") return localAttempt(plan, cloud, phase);
      if (phase === "adopt-local") return { localProjected: false };
      if (phase === "before-marker") return markerAttempt(plan, local, phase);
      if (phase === "adopt-marker") return { markerProjected: false };
      throw new Error(`unexpected revalidation ${phase}`);
    },
    async recoverDormantClaim() { throw new Error("current bind must not recover"); },
    async projectLocalLease() { calls.push("project-local"); return local; },
    async projectProviderMarker() { calls.push("project-marker"); return marker; },
    async finalizeTerminalProjection() {
      calls.push("project-marker");
      return { markerValues: marker, verifiedValues: verified };
    },
    async verifyTerminal() { calls.push("verify-terminal"); return verified; },
  };
  const controller = createExpiredPublishedBindAheadCleanDescendantRecoveryController(adapter);
  const completion = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(completion.status, "authoring-authority-restored");
  assert.equal(completion.cloudDisposition, "adopted-current-bind");
  assert.equal(intent.status, "complete");
  assert.equal(calls.filter(value => value === "verify-terminal").length, 0);
  const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, completion);
  assert.equal(calls.filter(value => value === "project-local").length, 1);
  assert.equal(calls.filter(value => value === "project-marker").length, 1);
  assert.equal(calls.filter(value => value === "acquire-branch-fence").length, 1);
  assert.equal(calls.filter(value => value === "release-branch-fence").length, 2);
  assert.ok(calls.indexOf("authorize-task") < calls.indexOf("acquire-branch-fence"));
  assert.ok(calls.indexOf("acquire-branch-fence") < calls.indexOf("project-local"));
  assert.ok(calls.indexOf("acquire-branch-fence") < calls.indexOf("project-marker"));
});

test("controller adopts one dormant-recovery response loss without replaying the bind", async () => {
  const { evidence } = buildFixture();
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({ evidence });
  const calls = [];
  let intent = null;
  let recoveryLanded = false;
  const recovered = cloudValues(plan, "adopted-recovery-response-loss");
  const branchFence = branchFenceValues(plan);
  const local = localValues(plan, recovered);
  const marker = markerValues(plan, local, recovered);
  const verified = verifiedValues(plan, recovered, local, marker);
  const adapter = {
    async readPlanEvidence() { return evidence; },
    async readPlanTtlSeconds() { return 1800; },
    async withOperationLock(action) { return action(); },
    async assertRuntimeSubject(received) { assert.equal(received.planDigest, plan.planDigest); },
    async readIntent() { return intent; },
    async writeIntent({ expected, value }) {
      assert.equal(expected?.intentDigest || null, intent?.intentDigest || null);
      intent = value;
    },
    async authorizeTask() {
      return { bindingDigest: evidence.committed.taskAuthorityBindingDigest,
        taskAuthorityReceiptDigest: D("task-receipt"), taskProofDigest: D("task-proof") };
    },
    async acquireBranchFence() { return branchFence; },
    async releaseBranchFence() { return {}; },
    async revalidate(_plan, phase) {
      if (phase === "before-task-authority") return { revalidationDigest: D(phase) };
      if (phase === "before-branch-fence") return branchFenceAttempt(plan, phase);
      if (phase === "adopt-branch-fence") return { branchFenced: false };
      if (phase === "adopt-bind") {
        return buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption(
          plan,
          D(phase),
        );
      }
      if (phase === "before-cloud") return { claimState: "dormant-bind",
        recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
        revalidationDigest: D(phase) };
      if (phase === "adopt-cloud") return recoveryLanded
        ? { cloudReconciled: true, values: recovered }
        : { cloudReconciled: false };
      if (phase === "before-local") return localAttempt(plan, recovered, phase);
      if (phase === "adopt-local") return { localProjected: false };
      if (phase === "before-marker") return markerAttempt(plan, local, phase);
      if (phase === "adopt-marker") return { markerProjected: false };
      throw new Error(`unexpected revalidation ${phase}`);
    },
    async recoverDormantClaim() {
      calls.push("recover-dormant");
      recoveryLanded = true;
      throw new Error("simulated provider response loss");
    },
    async projectLocalLease() { return local; },
    async projectProviderMarker() { return marker; },
    async finalizeTerminalProjection() {
      return { markerValues: marker, verifiedValues: verified };
    },
    async verifyTerminal() { return verified; },
  };
  const controller = createExpiredPublishedBindAheadCleanDescendantRecoveryController(adapter);
  const completion = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(completion.status, "authoring-authority-restored");
  assert.equal(completion.cloudDisposition, "adopted-recovery-response-loss");
  assert.equal(completion.cloudLedgerMutation, true);
  assert.equal(completion.bindReplay, false);
  assert.deepEqual(calls, ["recover-dormant"]);
});

test("process restart obtains a fresh runtime cloud-verification brand", () => {
  const { evidence, lease } = buildFixture();
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({ evidence });
  const authority = Object.freeze({
    ...lease.cloudAuthority,
    claimDigest: evidence.cloud.targetEntry.claimDigest,
    claimLedgerRevision: evidence.cloud.targetEntry.digest,
    operationReceiptDigest: evidence.cloud.targetOperationReceipt.receiptDigest,
    laneRevision: R,
    transitionCounter: evidence.cloud.targetEntry.claimCore.transitionCounter,
    ledgerRevision: evidence.cloud.current.ledgerRevision,
    ledgerDigest: evidence.cloud.current.ledgerDigest,
    expiresAt: "2026-08-30T02:00:00.000Z",
    state: "active",
  });
  const targetLease = projectExpiredPublishedBindAheadCleanDescendantLease({
    sourceLease: lease,
    publishedFenceSha: R,
    cloudAuthority: authority,
    verifiedAt: "2026-08-30T01:01:00.000Z",
  });
  let generation = 0;
  const observedBrands = [];
  const execute = () => reverifyExpiredPublishedBindAheadCleanDescendantMutationAuthority({
    plan,
    lease: targetLease,
    currentAuthority: authority,
    verifyCloud: ({ authority: input }) => {
      generation += 1;
      return { authority: input,
        verification: markOperationDerivedCloudVerification(Object.freeze({
          verifiedAt: "2026-08-30T01:01:00.000Z",
          runtimeBrand: generation,
        })) };
    },
    assertMutationAuthority: ({ remoteAuthorityVerification }) => {
      assert.equal(isOperationDerivedCloudVerification(remoteAuthorityVerification), true);
      observedBrands.push(remoteAuthorityVerification.runtimeBrand);
      return Object.freeze({ receiptDigest: D(`runtime-${generation}`) });
    },
  });
  const first = execute();
  const durable = JSON.parse(JSON.stringify({ receipt: first.receipt }));
  assert.equal(durable.verification, undefined);
  const replay = execute();
  assert.deepEqual(observedBrands, [1, 2]);
  assert.notEqual(first.verification, replay.verification);
});

test("sealed title and attached symbolic branch reject identity drift", () => {
  const { evidence } = buildFixture();
  assert.throws(() => normalizeExpiredPublishedBindAheadCleanDescendantRecoveryEvidence({
    ...evidence,
    pullRequest: { ...evidence.pullRequest, title: "Foreign title" },
  }), /invalid canonical evidence projection/u);
  const expected = evidence.committed;
  const observed = {
    headSha: expected.localHeadSha,
    treeSha: expected.localTreeSha,
    localBranchSha: expected.localHeadSha,
    remoteBranchSha: expected.publishedHeadSha,
    attachedBranch: expected.branch,
    symbolicBranch: expected.branch,
    status: "",
  };
  assert.equal(assertExpiredPublishedBindAheadCleanDescendantGitFrame({
    expected,
    observed,
  }), true);
  assert.throws(() => assertExpiredPublishedBindAheadCleanDescendantGitFrame({
    expected,
    observed: { ...observed, symbolicBranch: "" },
  }), /invalid preserved R\/H Git frame/u);
  assert.throws(() => assertExpiredPublishedBindAheadCleanDescendantGitFrame({
    expected,
    observed: { ...observed, attachedBranch: "other" },
  }), /invalid preserved R\/H Git frame/u);
});

test("durable branch fence survives restart and rejects every competing controller", () => {
  const branch = "agent/device.test/fenced";
  const fence = Object.freeze({ schema: "fixture-branch-fence/v1",
    fenceDigest: D("durable-fence") });
  const fields = [
    "scopeExpansionIntents",
    "activeOwnedDirtRecoveryIntents",
    "expiredCommittedScopeExpansionIntents",
    "reviewedLaneRevisionIntents",
    "reviewedLaneEntrypointFences",
  ];
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 5,
    leases: {}, ...Object.fromEntries(fields.map(field => [field, { [branch]: fence }])) };
  const restarted = JSON.parse(JSON.stringify(registry));
  assert.equal(classifyExpiredPublishedBindAheadBranchControllerFence({
    registry: restarted,
    branch,
    expectedFence: fence,
  }), "owned");
  const partial = structuredClone(restarted);
  delete partial.reviewedLaneEntrypointFences[branch];
  assert.throws(() => classifyExpiredPublishedBindAheadBranchControllerFence({
    registry: partial,
    branch,
    expectedFence: fence,
  }), /partial branch-controller fence projection/u);
  for (const field of fields) {
    const competing = structuredClone(restarted);
    competing[field] = { ...(competing[field] || {}),
      [branch]: { schema: "fixture-competing-controller/v1" } };
    assert.throws(() => classifyExpiredPublishedBindAheadBranchControllerFence({
      registry: competing,
      branch,
      expectedFence: fence,
    }), /competing branch controller intent or fence/u, field);
  }
});

test("repository adapter carries controller intent into task capability proof", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-bind-ahead-adapter-"));
  const repository = path.join(root, "repository");
  const commonDirectory = path.join(repository, ".git");
  const capabilityPath = path.join(root, "task-authority.json");
  mkdirSync(commonDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(capabilityPath, "{}\n", { mode: 0o600 });
  const fixture = buildFixture({ worktreePath: repository });
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
    evidence: fixture.evidence,
  });
  const authorization = authorizeExpiredPublishedBindAheadCleanDescendantRecovery(
    plan,
    plan.exactAuthorization,
  );
  const intent = createExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
    plan,
    authorization,
  );
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [BRANCH]: fixture.lease } };
  const calls = [];
  const adapter = createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter({
    repository,
    sessionId: SESSION,
    pullRequestNumber: 879,
    taskAuthorityFile: capabilityPath,
  }, {
    realpath: value => path.resolve(value),
    git: argumentsList => {
      const command = argumentsList.join(" ");
      if (command === "branch --show-current") return BRANCH;
      if (command === "rev-parse --git-common-dir") return ".git";
      if (command === "rev-parse HEAD") return H;
      if (command === "rev-parse HEAD^{tree}") return TREE;
      if (command === `rev-parse refs/heads/${BRANCH}`) return H;
      if (command === "status --porcelain=v1 -z --untracked-files=all") return "";
      throw new Error(`unexpected Git command: ${command}`);
    },
    gitOptional: argumentsList => argumentsList[0] === "ls-remote"
      ? `${R}\trefs/heads/${BRANCH}` : BRANCH,
    gh: () => JSON.stringify({ ...fixture.pullRequest,
      headRefName: fixture.pullRequest.headBranch,
      headRefOid: fixture.pullRequest.headSha,
      baseRefName: fixture.pullRequest.baseBranch,
      baseRefOid: fixture.pullRequest.baseSha,
      body: fixture.pullRequest.sourceBody }),
    inspectCloud: () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", claims: [fixture.liveClaim],
      evaluationTime: OBSERVED_AT, ledgerRevision: S("b"),
      ledgerDigest: fixture.currentLedger.headDigest,
      sequence: fixture.currentLedger.sequence }),
    readLedgerSnapshot: () => fixture.currentLedger,
    leaseStore: { readRegistry: () => registry },
    authorizeTaskMutation: input => {
      calls.push("capability-proof");
      assert.equal(input.capabilityPath, capabilityPath);
      assert.equal(input.operation, plan.taskAuthorityOperation);
      return { bindingDigest: fixture.lease.taskAuthority.bindingDigest,
        receiptDigest: D("adapter-task-receipt"), proofDigest: D("adapter-task-proof") };
    },
    now: () => new Date(OBSERVED_AT),
  });
  try {
    const receipt = adapter.authorizeTask(plan, { intent });
    assert.deepEqual(calls, ["capability-proof"]);
    assert.equal(receipt.bindingDigest, plan.evidence.committed.taskAuthorityBindingDigest);
    assert.equal(receipt.taskProofDigest, D("adapter-task-proof"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository adapter safely takes over an exact dead-owner operation lock", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-bind-ahead-lock-"));
  const repository = path.join(root, "repository");
  mkdirSync(path.join(repository, ".git"), { recursive: true, mode: 0o700 });
  const adapter = createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter({
    repository, sessionId: SESSION, pullRequestNumber: 879,
  }, {
    realpath: value => path.resolve(value),
    git: argumentsList => argumentsList.join(" ") === "branch --show-current"
      ? BRANCH : ".git",
    leaseStore: { readRegistry: () => ({}) },
    isProcessAlive: () => false,
  });
  const lockPath = `${adapter.journalPath}.lock`;
  try {
    let operationId;
    await adapter.withOperationLock(async () => {
      const owner = JSON.parse(readFileSync(lockPath, "utf8"));
      operationId = owner.operationId;
    });
    assert.equal(existsSync(lockPath), false);
    mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    writeFileSync(lockPath, `${JSON.stringify({
      schema: "agentic-expired-published-bind-ahead-clean-descendant-recovery-lock/v1",
      operationId,
      pid: 999_999,
      token: "dead-owner-token",
    })}\n`, { mode: 0o600 });
    let replacement;
    await adapter.withOperationLock(async () => {
      replacement = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.notEqual(replacement.token, "dead-owner-token");
      assert.equal(replacement.operationId, operationId);
    });
    assert.equal(existsSync(lockPath), false);
    assert.ok(replacement);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical lifecycle entrypoints reject every reciprocal five-map sentinel", () => {
  const { lease } = buildFixture();
  const expectedLeaseDigest = writerLeaseDigest(lease);
  const expectedClaimId = lease.cloudAuthority.claimId;
  const sentinel = Object.freeze({
    schema: "agentic-expired-published-bind-ahead-clean-descendant-recovery-fence/v1",
    branch: BRANCH,
    planDigest: D("sentinel-plan"),
    fenceDigest: D("sentinel-fence"),
  });
  const base = { schema: "agentic-writer-lease-registry/v2", revision: 5,
    leases: { [BRANCH]: lease } };
  const storeFor = field => ({
    statePath: `/tmp/${D(field)}.json`,
    readRegistry: () => ({ ...base, [field]: { [BRANCH]: sentinel } }),
    withRegistryLock: action => action({ ...base, [field]: { [BRANCH]: sentinel } }),
  });
  for (const field of ["reviewedLaneRevisionIntents", "reviewedLaneEntrypointFences"]) {
    assert.throws(() => acquireReviewedLaneEntrypointFence({
      leaseStore: storeFor(field), branch: BRANCH, entrypoint: "device:review",
      operationDigest: D("review-operation"), expectedLeaseDigest, expectedClaimId,
    }), /intent|fence|malformed|schema/u, field);
  }
  assert.throws(() => beginScopeExpansionIntent({
    leaseStore: storeFor("scopeExpansionIntents"), branch: BRANCH,
    expectedLeaseDigest, expectedClaimId,
    plan: { planDigest: D("scope-plan"), targetWriteSetDigest: D("write-set"),
      targetManifestDigest: D("manifest"), targetCanonicalBaseSha: BASE },
  }), /Scope-expansion intent is malformed/u);
  assert.throws(() => heartbeatWriterLeaseProjection({
    leaseStore: storeFor("activeOwnedDirtRecoveryIntents"), branch: BRANCH,
    expectedLeaseDigest, expectedClaimId, ttlMs: 60_000,
    now: () => new Date(OBSERVED_AT),
  }), /Active-owned-dirt recovery intent is malformed/u);
  assert.throws(() => readExpiredCommittedScopeExpansionIntent({
    store: storeFor("expiredCommittedScopeExpansionIntents"), branch: BRANCH,
  }), /Expired committed scope-expansion intent is malformed/u);
});

test("cloud sidecar rejects nested byte tamper and generation reordering", () => {
  const fixture = buildFixture();
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
    evidence: fixture.evidence,
  });
  const firstAuthority = {
    ...fixture.lease.cloudAuthority,
    claimDigest: fixture.evidence.cloud.targetEntry.claimDigest,
    claimLedgerRevision: fixture.evidence.cloud.targetEntry.digest,
    operationReceiptDigest: fixture.evidence.cloud.targetOperationReceipt.receiptDigest,
    laneRevision: R,
    transitionCounter: fixture.evidence.cloud.targetEntry.claimCore.transitionCounter,
    ledgerRevision: fixture.evidence.cloud.current.ledgerRevision,
    ledgerDigest: fixture.evidence.cloud.current.ledgerDigest,
    heartbeatCounter: 0,
    expiresAt: "2026-08-30T02:00:00.000Z",
    state: "active",
  };
  const secondAuthority = {
    ...firstAuthority,
    claimDigest: D("second-claim"), claimLedgerRevision: D("second-transition"),
    operationReceiptDigest: D("second-operation"), transitionCounter: 4,
    heartbeatCounter: 1, ledgerRevision: S("c"), ledgerDigest: D("second-ledger"),
    expiresAt: "2026-08-30T03:00:00.000Z",
  };
  const sidecar = buildCloudSidecar(plan, [
    { authority: firstAuthority, disposition: "adopted-current-bind",
      verifiedAt: "2026-08-30T01:01:00.000Z" },
    { authority: secondAuthority, disposition: "projection-renewed-current",
      verifiedAt: "2026-08-30T01:02:00.000Z" },
  ]);
  assert.deepEqual(normalizeExpiredPublishedBindAheadCloudSidecar({ plan, sidecar }), sidecar);
  const tampered = structuredClone(sidecar);
  tampered.generations[0].verification.providerBytes = "changed";
  assert.throws(() => normalizeExpiredPublishedBindAheadCloudSidecar({
    plan, sidecar: tampered,
  }), /cloud sidecar generation projection/u);
  const reordered = structuredClone(sidecar);
  reordered.generations.reverse();
  assert.throws(() => normalizeExpiredPublishedBindAheadCloudSidecar({
    plan, sidecar: reordered,
  }), /cloud sidecar/u);
});

test("production adapter atomically converges an expired t4 marker to t5 and releases from the final lease", async () => {
  const fixture = buildProductionRestartFixture({
    continuationMode: "recovery",
    resultAlreadyObserved: false,
  });
  try {
    const firstAdapter = fixture.createAdapter();
    fixture.seedJournal(firstAdapter);
    const writes = [];
    const crashingController = createExpiredPublishedBindAheadCleanDescendantRecoveryController({
      ...fixture.createAdapter(),
      writeIntent(input) {
        writes.push(input.value.status);
        return firstAdapter.writeIntent(input);
      },
      releaseBranchFence() {
        throw new Error("simulated crash after durable complete");
      },
    });
    await assert.rejects(
      crashingController.run({
        plan: fixture.plan,
        authorization: fixture.plan.exactAuthorization,
      }),
      /simulated crash after durable complete/u,
    );

    assert.deepEqual(writes, ["complete"]);
    const complete = firstAdapter.readIntent(fixture.plan);
    assert.equal(complete.status, "complete");
    assert.equal(complete.phases["cloud-reconciled"].values.disposition,
      "adopted-recovery-response-loss");
    const marker = complete.phases["marker-projected"].values;
    const verified = complete.phases.verified.values;
    for (const key of [
      "cloudDisposition", "cloudGenerationCount", "cloudContinuationCount",
      "cloudRenewalCount", "cloudRecoveryCount", "cloudLedgerMutation",
      "cloudResponseLossAdopted", "sidecarHeadDigest", "targetLeaseDigest",
      "bodyDigest", "markerDigest", "registryRevision",
    ]) assert.equal(marker[key], verified[key], key);
    assert.equal(verified.cloudDisposition, "projection-recovered-dormant");
    assert.equal(verified.cloudGenerationCount, 2);
    assert.equal(verified.cloudContinuationCount, 2);
    assert.equal(verified.cloudRecoveryCount, 2);
    assert.equal(verified.cloudRenewalCount, 0);
    assert.equal(verified.cloudLedgerMutation, true);
    assert.equal(verified.cloudResponseLossAdopted, true);
    assert.equal(verified.transitionCounter, fixture.t5Authority.transitionCounter);
    assert.equal(fixture.providerEditCount(), 1);
    assert.equal(fixture.cloudContinuationCount(), 1);
    assert.equal(fixture.currentLeaseDigest(), verified.targetLeaseDigest);
    assert.equal(fixture.fenceProjectionCount(), 5);

    const replay = createExpiredPublishedBindAheadCleanDescendantRecoveryController(
      fixture.createAdapter(),
    );
    const completion = await replay.run({
      plan: fixture.plan,
      authorization: fixture.plan.exactAuthorization,
    });
    assert.equal(completion.status, "authoring-authority-restored");
    assert.equal(completion.cloudDisposition, "projection-recovered-dormant");
    assert.equal(completion.cloudGenerationCount, 2);
    assert.equal(completion.cloudRecoveryCount, 2);
    assert.equal(fixture.fenceProjectionCount(), 0);
    assert.equal(fixture.releaseLeaseDigest(), verified.targetLeaseDigest);
    const finalMarker = parseWriterLeasePullRequestBody(fixture.pullRequestBody());
    assert.equal(digestValue(finalMarker), verified.markerDigest);
    assert.equal(finalMarker.cloudAuthority.claimDigest, fixture.t5Authority.claimDigest);
  } finally {
    fixture.cleanup();
  }
});

test("production adapter classifies adopted response loss from returned recovery or renewal lineage", () => {
  for (const [continuationMode, expected] of [
    ["recovery", {
      disposition: "projection-adopted-recovery-response-loss",
      recoveryCount: 2,
      renewalCount: 0,
    }],
    ["renewal", {
      disposition: "projection-adopted-renewal-response-loss",
      recoveryCount: 1,
      renewalCount: 1,
    }],
  ]) {
    const fixture = buildProductionRestartFixture({
      continuationMode,
      resultAlreadyObserved: true,
    });
    try {
      const adapter = fixture.createAdapter();
      fixture.seedJournal(adapter);
      const restarted = fixture.createAdapter();
      const intent = restarted.readIntent(fixture.plan);
      const finalized = restarted.finalizeTerminalProjection(fixture.plan, { intent });
      assert.equal(finalized.markerValues.cloudDisposition, expected.disposition,
        continuationMode);
      assert.equal(finalized.markerValues.cloudResponseLossAdopted, true,
        continuationMode);
      assert.equal(finalized.markerValues.cloudRecoveryCount, expected.recoveryCount,
        continuationMode);
      assert.equal(finalized.markerValues.cloudRenewalCount, expected.renewalCount,
        continuationMode);
      assert.equal(finalized.markerValues.cloudContinuationCount, 2,
        continuationMode);
      assert.equal(finalized.markerValues.cloudLedgerMutation, true,
        continuationMode);
      assert.equal(finalized.verifiedValues.cloudDisposition, expected.disposition,
        continuationMode);
      assert.equal(fixture.cloudContinuationCount(), 1, continuationMode);
      assert.equal(fixture.providerEditCount(), 1, continuationMode);
    } finally {
      fixture.cleanup();
    }
  }
});

function buildFixture({ worktreePath = "/tmp/bind-ahead" } = {}) {
  const repository = { repositoryId: "github-repository:repo-node", canonicalRevision: BASE };
  const actor = { actorId: "github-user:actor-node",
    deviceId: pseudonymousIdentifier("device", "device.test"),
    sessionId: pseudonymousIdentifier("session", SESSION) };
  let ledger = createEmptyLedger(repository);
  const transition = (action, evaluationTime, request, selectedActor = actor) => {
    const result = applyCloudTransition({ ledger, action, actor: selectedActor, repository,
      evaluationTime, request: { ...request, expectedLedgerDigest: ledger.headDigest } });
    ledger = result.ledger;
    return result;
  };
  const claimed = transition("claim", "2026-08-30T00:00:00.000Z", {
    workItemId: pseudonymousIdentifier("work-item", BRANCH),
    canonicalBaseRevision: BASE, laneRevision: F, declaredWriteScope: WRITE_SET,
    leaseEpoch: 1, expiresAt: EXPIRES_AT, idempotencyKey: "bind-ahead-claim",
  });
  const source = transition("continue", "2026-08-30T00:05:00.000Z", {
    claimId: claimed.claim.claimId, expectedFenceRevision: claimed.claim.fenceRevision,
    expectedTransitionCounter: claimed.claim.transitionCounter, mode: "projection",
    laneRevision: F, reviewRequestId: `github-pull-request:${PULL_ID}`,
    idempotencyKey: "bind-ahead-source",
  });
  const sourceEntry = ledger.entries.at(-1);
  addUnrelated("one", "2026-08-30T00:06:00.000Z");
  const sourceLedger = ledger;
  addUnrelated("two", "2026-08-30T00:07:00.000Z");
  const rawBindKey = ["device-review-bind", sourceEntry.claimId,
    sourceEntry.claimCore.transitionCounter, sourceEntry.claimDigest, R].join(":");
  const target = transition("continue", "2026-08-30T00:08:00.000Z", {
    claimId: sourceEntry.claimId, expectedFenceRevision: sourceEntry.claimDigest,
    expectedTransitionCounter: sourceEntry.claimCore.transitionCounter, mode: "projection",
    laneRevision: R, reviewRequestId: `github-pull-request:${PULL_ID}`,
    idempotencyKey: rawBindKey,
  });
  const targetEntry = ledger.entries.at(-1);
  addUnrelated("three", "2026-08-30T00:09:00.000Z");
  const currentLedger = ledger;
  const sourceClaim = projectPublicClaim(listCurrentClaims(
    sourceLedger,
    "2026-08-30T00:10:00.000Z",
  ).find(item => item.claimId === sourceEntry.claimId));
  const liveClaim = projectPublicClaim(listCurrentClaims(
    currentLedger,
    OBSERVED_AT,
  ).find(item => item.claimId === sourceEntry.claimId));
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "bind-ahead", declaredWriteSet: WRITE_SET,
    writeSetDigest: sourceClaim.writeSetDigest, manifestDigest: D("manifest"),
    planReceiptDigest: D("plan"), admissionReceiptDigest: D("admission"),
    existingLaneStateDigest: D("lane"), admittedReportDigest: D("report"),
    preservationReceiptDigest: D("preservation") };
  const authority = { schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "example/ledger", targetRepository: "example/repository",
    claimId: sourceEntry.claimId, claimDigest: sourceEntry.claimDigest,
    ledgerRevision: S("a"), ledgerDigest: sourceLedger.headDigest,
    claimLedgerRevision: sourceEntry.digest,
    entrySchema: sourceClaim.entrySchema, claimIdentitySchema: sourceClaim.claimIdentitySchema,
    operationReceiptDigest: sourceClaim.operationReceiptDigest,
    mutationAuthorityEligible: true, canonicalBaseSha: BASE, laneRevision: F,
    cloudDeclaredWriteScope: sourceClaim.declaredWriteScope,
    writeSetDigest: sourceClaim.writeSetDigest, deviceId: "device.test", sessionId: SESSION,
    reviewRequestId: `github-pull-request:${PULL_ID}`, leaseEpoch: 1,
    transitionCounter: sourceEntry.claimCore.transitionCounter, heartbeatCounter: 0,
    state: "active", expiresAt: EXPIRES_AT, integrationReceiptDigest: null,
    integration: null, manifestDigest: admission.manifestDigest };
  const leaseCore = { schema: "agentic-writer-lease/v2", status: "active", epoch: 9,
    sessionId: SESSION, device: "device.test", scope: "bind-ahead", branch: BRANCH,
    worktreePath, baseSha: BASE, fenceSha: F,
    pullRequestUrl: PULL_URL, autoDelivery: false, runtimeRequired: false,
    admission, cloudAuthority: authority, acquiredAt: "2026-08-30T00:00:00.000Z",
    heartbeatAt: "2026-08-30T00:05:00.000Z", expiresAt: EXPIRES_AT };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${D("subject")}`,
    issuedAt: "2026-08-30T00:00:00.000Z",
  });
  const lease = Object.freeze({ ...leaseCore, taskAuthority: createTaskAuthorityBinding({
    capability, lease: leaseCore, bindingMode: "claim",
    boundAt: "2026-08-30T00:00:00.000Z",
  }) });
  const body = renderWriterLeasePullRequestBody(lease);
  const markerDigest = digestValue(parseWriterLeasePullRequestBody(body));
  const sourceRemotePrefix = { headSha: R, treeSha: S("6"), changedPaths: ["scripts/recovery.mjs"],
    declaredChangedPaths: ["scripts/recovery.mjs"], protectedEquivalentPaths: [],
    sharedAncestorEquivalence: {}, sharedAncestorEquivalenceDigest: D("shared"),
    rangeDiffDigest: D("F-R") };
  const snapshotCore = { schema: "agentic-expired-committed-heartbeat-snapshot/v3",
    branch: BRANCH, sourceLeaseDigest: digestValue(lease), sourceMarkerDigest: markerDigest,
    pullRequestBodyDigest: sha256(body), remoteHeadSha: R, pullRequestHeadSha: R,
    sourceRemotePrefix, headSha: H, treeSha: TREE, changedPaths: ["scripts/recovery.mjs"],
    declaredChangedPaths: ["scripts/recovery.mjs"], protectedEquivalentPaths: [],
    protectedMainEquivalence: {}, protectedMainEquivalenceDigest: D("protected"),
    rangeDiffDigest: D("F-H") };
  const committedSnapshot = { ...snapshotCore, snapshotDigest: digestValue(snapshotCore), lease,
    recoveryEvidence: { sourceFenceSha: F, sourceRemoteHeadSha: R, headSha: H,
      sourceClaimId: authority.claimId, sourceClaimDigest: authority.claimDigest,
      sourceClaimLedgerRevision: authority.claimLedgerRevision,
      sourceCloudTransitionCounter: authority.transitionCounter,
      sourceMarkerDigest: markerDigest, pullRequestBodyDigest: sha256(body),
      rangeDiffDigest: D("F-H") } };
  const pullRequest = { id: PULL_ID, number: 879, url: PULL_URL,
    title: "Bind-ahead recovery fixture", state: "OPEN",
    isDraft: true, autoMergeRequest: null,
    headRepository: { id: "repo-node", nameWithOwner: "example/repository" },
    headBranch: BRANCH, headSha: R, baseBranch: "main", baseSha: BASE, sourceBody: body };
  const evidence = buildExpiredPublishedBindAheadCleanDescendantRecoveryEvidence({
    observedAt: OBSERVED_AT, repository: "example/repository", committedSnapshot, pullRequest,
    cloud: { evaluationTime: OBSERVED_AT,
      status: { ledgerRevision: S("b"), ledgerDigest: currentLedger.headDigest,
        sequence: currentLedger.sequence },
      sourceLedgerSnapshot: { revision: S("a"), ledger: sourceLedger },
      currentLedgerSnapshot: { revision: S("b"), ledger: currentLedger }, liveClaim,
      inventoryDigest: D("inventory"), verificationReceiptDigest: D("verification"),
      noOverlappingCompetitor: true, competitorCount: 0 } });
  return { currentLedger, evidence, lease, liveClaim, pullRequest };

  function addUnrelated(label, time) {
    transition("claim", time, { workItemId: `work-item:unrelated-${label}`,
      canonicalBaseRevision: BASE, laneRevision: F,
      declaredWriteScope: [`path:unrelated/${label}.md`], leaseEpoch: 1,
      expiresAt: "2026-08-30T03:00:00.000Z", idempotencyKey: `unrelated-${label}` },
    { actorId: `actor:unrelated-${label}`, deviceId: `device:unrelated-${label}`,
      sessionId: `session:unrelated-${label}` });
  }
}

function cloudValues(plan, disposition) {
  const target = plan.evidence.cloud.targetEntry;
  const recovered = disposition !== "adopted-current-bind";
  return { authorityDigest: D("authority"),
    claimDigest: recovered ? D("recovered-claim") : target.claimDigest,
    claimId: target.claimId,
    cloudLedgerMutation: disposition === "recovered-dormant", disposition,
    operationReceiptDigest: recovered ? D("recovered-operation")
      : plan.evidence.cloud.targetOperationReceipt.receiptDigest,
    recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
    recoveryTransitionRecorded: recovered,
    responseLossAdopted: disposition === "adopted-recovery-response-loss",
    sidecarHeadDigest: D("cloud-sidecar"),
    transitionCounter: target.claimCore.transitionCounter + (recovered ? 1 : 0),
    transitionDigest: recovered ? D("recovered-transition") : target.digest,
    verificationReceiptDigest: D("cloud-verification"),
    verifiedAt: "2026-08-30T01:01:00.000Z" };
}
function continueRecovery({ ledger, plan, evaluationTime, expiresAt }) {
  const previous = ledger.entries.findLast(
    entry => entry.claimId === plan.evidence.cloud.liveClaim.claimId,
  );
  const actor = {
    actorId: previous.claimCore.actorId,
    deviceId: previous.claimCore.deviceId,
    sessionId: previous.claimCore.sessionId,
  };
  return applyCloudTransition({
    ledger,
    action: "continue",
    actor,
    repository: {
      repositoryId: previous.repositoryId,
      canonicalRevision: previous.claimCore.canonicalBaseRevision,
    },
    evaluationTime,
    request: {
      claimId: previous.claimId,
      expectedFenceRevision: previous.claimDigest,
      expectedTransitionCounter: previous.claimCore.transitionCounter,
      expectedLedgerDigest: ledger.headDigest,
      mode: "recovery",
      expiresAt,
      recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
      idempotencyKey: [
        "device-expired-committed-recovery", previous.claimId,
        previous.claimCore.transitionCounter, previous.claimDigest,
        plan.recoveryEvidenceDigest,
      ].join(":"),
    },
  });
}
function branchFenceAttempt(plan, label) {
  return { revalidationDigest: D(label),
    sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest };
}
function branchFenceValues(plan) {
  return { disposition: "acquired", fenceDigest: D("branch-fence"),
    registryRevision: 1, sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    writerRegistryMutation: true };
}
function localAttempt(plan, cloud, label) {
  return { cloudAuthorityDigest: cloud.authorityDigest,
    publishedFenceSha: plan.evidence.committed.publishedHeadSha,
    preservedHeadSha: plan.evidence.committed.localHeadSha,
    revalidationDigest: D(label), sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest };
}
function localValues(plan, cloud) {
  return { cloudAuthorityDigest: cloud.authorityDigest, disposition: "projected",
    registryRevision: 2, sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    sidecarHeadDigest: cloud.sidecarHeadDigest, targetLeaseDigest: D("target-lease"),
    taskAuthorityBindingDigest: plan.evidence.committed.taskAuthorityBindingDigest,
    writerRegistryMutation: true };
}
function markerAttempt(plan, local, label) {
  return { markerState: "source", revalidationDigest: D(label),
    sourceBodyDigest: plan.evidence.pullRequest.sourceBodyDigest,
    sourceMarkerDigest: plan.evidence.pullRequest.sourceMarkerDigest,
    targetLeaseDigest: local.targetLeaseDigest };
}
function markerValues(plan, local, cloud) {
  return { bodyDigest: D("target-body"), cloudAuthorityDigest: local.cloudAuthorityDigest,
    ...cloudSummary(plan, cloud),
    disposition: "projected",
    markerDigest: D("target-marker"), providerMutation: true,
    registryRevision: local.registryRevision, sidecarHeadDigest: local.sidecarHeadDigest,
    targetLeaseDigest: local.targetLeaseDigest,
    visibleBodyDigest: plan.evidence.pullRequest.visibleBodyDigest };
}
function verifiedValues(plan, cloud, local, marker) {
  const values = { bodyDigest: marker.bodyDigest, claimDigest: cloud.claimDigest,
    claimId: cloud.claimId, cloudAuthorityDigest: cloud.authorityDigest,
    ...cloudSummary(plan, cloud),
    cloudVerificationReceiptDigest: cloud.verificationReceiptDigest,
    markerDigest: marker.markerDigest, mutationAuthorityReceiptDigest: D("mutation"),
    operationReceiptDigest: cloud.operationReceiptDigest,
    preservedHeadSha: plan.evidence.committed.localHeadSha,
    publishedFenceSha: plan.evidence.committed.publishedHeadSha,
    pullRequestHeadSha: plan.evidence.committed.publishedHeadSha,
    registryRevision: marker.registryRevision,
    remoteHeadSha: plan.evidence.committed.publishedHeadSha,
    sidecarHeadDigest: marker.sidecarHeadDigest,
    sourceFenceSha: plan.evidence.committed.sourceFenceSha,
    targetLeaseDigest: local.targetLeaseDigest,
    taskAuthorityBindingDigest: plan.evidence.committed.taskAuthorityBindingDigest,
    transitionCounter: cloud.transitionCounter, transitionDigest: cloud.transitionDigest,
    visibleBodyDigest: marker.visibleBodyDigest };
  return { ...values, verificationDigest: digestValue(values) };
}

function cloudSummary(plan, cloud) {
  const cloudContinuationCount = cloud.transitionCounter
    - plan.evidence.cloud.targetEntry.claimCore.transitionCounter;
  return {
    cloudDisposition: cloud.disposition,
    cloudGenerationCount: 1,
    cloudContinuationCount,
    cloudRenewalCount: 0,
    cloudRecoveryCount: cloudContinuationCount,
    cloudLedgerMutation: cloudContinuationCount > 0,
    cloudResponseLossAdopted: cloud.responseLossAdopted,
  };
}

function buildCloudSidecar(plan, inputs) {
  let previousGenerationDigest = null;
  const generations = inputs.map((input, index) => {
    const verification = {
      receiptDigest: D(`sidecar-verification-${index + 1}`),
      verifiedAt: input.verifiedAt,
    };
    const reconciliation = {
      authorityDigest: digestValue(input.authority),
      claimDigest: input.authority.claimDigest,
      claimId: input.authority.claimId,
      cloudLedgerMutation: input.cloudLedgerMutation ?? index > 0,
      disposition: input.disposition,
      operationReceiptDigest: input.authority.operationReceiptDigest,
      recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
      recoveryTransitionRecorded: input.recoveryTransitionRecorded ?? false,
      responseLossAdopted: input.responseLossAdopted ?? false,
      transitionCounter: input.authority.transitionCounter,
      transitionDigest: input.authority.claimLedgerRevision,
      verificationReceiptDigest: verification.receiptDigest,
      verifiedAt: verification.verifiedAt,
    };
    const core = {
      schema: "agentic-expired-published-bind-ahead-clean-descendant-cloud-generation/v1",
      planDigest: plan.planDigest,
      ordinal: index + 1,
      previousGenerationDigest,
      authority: input.authority,
      verification,
      reconciliation,
    };
    const generation = { ...core, generationDigest: digestValue(core) };
    previousGenerationDigest = generation.generationDigest;
    return generation;
  });
  const core = {
    schema: "agentic-expired-published-bind-ahead-clean-descendant-cloud-sidecar/v1",
    planDigest: plan.planDigest,
    generations,
    headGenerationDigest: previousGenerationDigest,
  };
  return { ...core, sidecarDigest: digestValue(core) };
}

function buildProductionRestartFixture({
  continuationMode,
  resultAlreadyObserved,
}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-bind-ahead-restart-"));
  const repository = path.join(root, "repository");
  mkdirSync(path.join(repository, ".git"), { recursive: true, mode: 0o700 });
  const source = buildFixture({ worktreePath: repository });
  const plan = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
    evidence: source.evidence,
  });
  const t4 = continueRecovery({
    ledger: source.currentLedger,
    plan,
    evaluationTime: "2026-08-30T01:00:00.000Z",
    expiresAt: continuationMode === "renewal"
      ? "2026-08-30T01:21:00.000Z"
      : "2026-08-30T01:10:00.000Z",
  });
  const nowValue = "2026-08-30T01:20:00.000Z";
  const t4Claim = publicClaimAt(t4.ledger, plan, nowValue);
  const t5 = continuationMode === "renewal"
    ? continueRenewal({
      ledger: t4.ledger,
      plan,
      evaluationTime: nowValue,
      expiresAt: "2026-08-30T02:00:00.000Z",
    })
    : continueRecovery({
      ledger: t4.ledger,
      plan,
      evaluationTime: nowValue,
      expiresAt: "2026-08-30T02:00:00.000Z",
    });
  const t5Claim = publicClaimAt(t5.ledger, plan, "2026-08-30T01:20:01.000Z");
  const t4Authority = authorityForClaim({
    sourceAuthority: source.lease.cloudAuthority,
    claim: t4Claim,
    ledgerRevision: S("c"),
    ledgerDigest: t4.ledger.headDigest,
  });
  const t5Authority = authorityForClaim({
    sourceAuthority: source.lease.cloudAuthority,
    claim: t5Claim,
    ledgerRevision: S("d"),
    ledgerDigest: t5.ledger.headDigest,
  });
  const t4VerifiedAt = "2026-08-30T01:01:00.000Z";
  const sidecar = buildCloudSidecar(plan, [{
    authority: t4Authority,
    disposition: "adopted-recovery-response-loss",
    verifiedAt: t4VerifiedAt,
    cloudLedgerMutation: false,
    recoveryTransitionRecorded: true,
    responseLossAdopted: true,
  }]);
  const t4Lease = projectExpiredPublishedBindAheadCleanDescendantLease({
    sourceLease: source.lease,
    publishedFenceSha: R,
    cloudAuthority: t4Authority,
    verifiedAt: t4VerifiedAt,
  });
  const fence = recoveryFence(plan);
  let intent = createExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
    plan,
    authorizeExpiredPublishedBindAheadCleanDescendantRecovery(
      plan,
      plan.exactAuthorization,
    ),
  );
  const advance = (status, values) => {
    intent = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      intent,
      { status, values },
    );
  };
  advance("task-authority-verified", {
    bindingDigest: plan.evidence.committed.taskAuthorityBindingDigest,
    taskAuthorityReceiptDigest: D("restart-task-receipt"),
    taskProofDigest: D("restart-task-proof"),
  });
  advance("branch-fence-attempted", branchFenceAttempt(plan, "restart-fence-attempt"));
  advance("branch-fenced", {
    disposition: "acquired",
    fenceDigest: fence.fenceDigest,
    registryRevision: 11,
    sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    writerRegistryMutation: true,
  });
  advance("bind-adopted",
    buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption(
      plan,
      D("restart-bind-adoption"),
    ));
  advance("cloud-attempted", {
    claimState: t4Claim.state === "current" ? "recovered" : "dormant-recovered",
    recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
    revalidationDigest: D("restart-cloud-attempt"),
  });
  const rootGeneration = sidecar.generations[0];
  advance("cloud-reconciled", {
    ...rootGeneration.reconciliation,
    sidecarHeadDigest: rootGeneration.generationDigest,
  });
  const t4LeaseDigest = writerLeaseDigest(t4Lease);
  advance("local-attempted", {
    cloudAuthorityDigest: digestValue(t4Authority),
    preservedHeadSha: H,
    publishedFenceSha: R,
    revalidationDigest: D("restart-local-attempt"),
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
  });
  advance("local-projected", {
    cloudAuthorityDigest: digestValue(t4Authority),
    disposition: "projected",
    registryRevision: 12,
    sidecarHeadDigest: rootGeneration.generationDigest,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    targetLeaseDigest: t4LeaseDigest,
    taskAuthorityBindingDigest: plan.evidence.committed.taskAuthorityBindingDigest,
    writerRegistryMutation: true,
  });
  advance("marker-attempted", {
    markerState: "target",
    revalidationDigest: D("restart-marker-attempt"),
    sourceBodyDigest: plan.evidence.pullRequest.sourceBodyDigest,
    sourceMarkerDigest: plan.evidence.pullRequest.sourceMarkerDigest,
    targetLeaseDigest: t4LeaseDigest,
  });

  const fenceFields = [
    "scopeExpansionIntents",
    "activeOwnedDirtRecoveryIntents",
    "expiredCommittedScopeExpansionIntents",
    "reviewedLaneRevisionIntents",
    "reviewedLaneEntrypointFences",
  ];
  let registry = {
    schema: "agentic-writer-lease-registry/v2",
    revision: 12,
    leases: { [BRANCH]: t4Lease },
    ...Object.fromEntries(fenceFields.map(field => [field, { [BRANCH]: fence }])),
  };
  let body = updateWriterLeasePullRequestBody(source.pullRequest.sourceBody, t4Lease);
  let providerEdits = 0;
  let cloudContinuations = 0;
  const mutationLeaseDigests = [];
  let liveLedger = resultAlreadyObserved ? t5.ledger : t4.ledger;
  let liveRevision = resultAlreadyObserved ? S("d") : S("c");
  let liveEvaluation = resultAlreadyObserved
    ? "2026-08-30T01:20:01.000Z"
    : nowValue;

  const currentPublicClaim = () => publicClaimAt(liveLedger, plan, liveEvaluation);
  const verificationFor = (authority, label) => {
    const candidate = {
      ...currentPublicClaim(),
      state: "active",
      writeAuthority: true,
      scopeReserved: true,
    };
    return markOperationDerivedCloudVerification(Object.freeze({
      schema: "agentic-current-claim-inventory-verification/v1",
      status: "ready",
      claimId: authority.claimId,
      claimDigest: authority.claimDigest,
      ledgerRevision: authority.ledgerRevision,
      ledgerDigest: authority.ledgerDigest,
      canonicalBaseSha: authority.canonicalBaseSha,
      laneRevision: authority.laneRevision,
      writeSetDigest: authority.writeSetDigest,
      reviewRequestId: authority.reviewRequestId,
      inventory: { claims: [candidate] },
      receiptDigest: D(`restart-verification-${label}`),
      verifiedAt: liveEvaluation,
    }));
  };
  const leaseStore = {
    readRegistry: () => registry,
    withRegistryLock: action => action(registry),
  };
  const mutateRegistry = ({
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action,
  }) => {
    assert.equal(branch, BRANCH);
    assert.equal(expectedClaimId, plan.evidence.cloud.liveClaim.claimId);
    const currentLease = registry.leases[branch];
    assert.equal(writerLeaseDigest(currentLease), expectedLeaseDigest);
    mutationLeaseDigests.push(expectedLeaseDigest);
    const result = action({ registry, lease: currentLease });
    if (result.changed) {
      registry = { ...result.registry, revision: registry.revision + 1 };
    }
    return {
      ...result,
      lease: result.lease || registry.leases[branch],
      registryRevision: registry.revision,
    };
  };
  const createAdapter = () =>
    createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter({
      repository,
      sessionId: SESSION,
      pullRequestNumber: 879,
    }, {
      realpath: value => path.resolve(value),
      git: argumentsList => {
        const command = argumentsList.join(" ");
        if (command === "branch --show-current") return BRANCH;
        if (command === "rev-parse --git-common-dir") return ".git";
        if (command === "rev-parse HEAD") return H;
        if (command === "rev-parse HEAD^{tree}") return TREE;
        if (command === `rev-parse refs/heads/${BRANCH}`) return H;
        if (command === "status --porcelain=v1 -z --untracked-files=all") return "";
        throw new Error(`unexpected Git command: ${command}`);
      },
      gitOptional: argumentsList => argumentsList[0] === "ls-remote"
        ? `${R}\trefs/heads/${BRANCH}`
        : BRANCH,
      gh: () => JSON.stringify({
        ...source.pullRequest,
        headRefName: source.pullRequest.headBranch,
        headRefOid: source.pullRequest.headSha,
        baseRefName: source.pullRequest.baseBranch,
        baseRefOid: source.pullRequest.baseSha,
        body,
      }),
      inspectCloud: () => ({
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "status",
        status: "ready",
        claims: [currentPublicClaim()],
        evaluationTime: liveEvaluation,
        ledgerRevision: liveRevision,
        ledgerDigest: liveLedger.headDigest,
        sequence: liveLedger.sequence,
      }),
      readLedgerSnapshot: () => liveLedger,
      recoverCloud: () => {
        cloudContinuations += 1;
        liveLedger = t5.ledger;
        liveRevision = S("d");
        liveEvaluation = "2026-08-30T01:20:01.000Z";
        return {
          authority: t5Authority,
          verification: verificationFor(t5Authority, `continuation-${cloudContinuations}`),
        };
      },
      verifyCloud: ({ authority }) => ({
        authority,
        verification: verificationFor(authority, `runtime-${cloudContinuations}`),
      }),
      leaseStore,
      mutateRegistry,
      editBody: (_url, nextBody) => {
        providerEdits += 1;
        body = nextBody;
      },
      now: () => new Date(nowValue),
    });
  const seedJournal = adapter => {
    adapter.writeIntent({ plan, expected: null, value: intent });
    const journal = JSON.parse(readFileSync(adapter.journalPath, "utf8"));
    writeFileSync(adapter.journalPath, `${JSON.stringify({
      ...journal,
      cloud: sidecar,
    }, null, 2)}\n`, { mode: 0o600 });
  };
  return {
    plan,
    t5Authority,
    createAdapter,
    seedJournal,
    providerEditCount: () => providerEdits,
    cloudContinuationCount: () => cloudContinuations,
    currentLeaseDigest: () => writerLeaseDigest(registry.leases[BRANCH]),
    fenceProjectionCount: () => fenceFields.filter(
      field => registry[field]?.[BRANCH],
    ).length,
    releaseLeaseDigest: () => mutationLeaseDigests.at(-1),
    pullRequestBody: () => body,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function publicClaimAt(ledger, plan, evaluationTime) {
  return projectPublicClaim(listCurrentClaims(ledger, evaluationTime).find(
    claim => claim.claimId === plan.evidence.cloud.liveClaim.claimId,
  ));
}

function authorityForClaim({ sourceAuthority, claim, ledgerRevision, ledgerDigest }) {
  return Object.freeze({
    ...sourceAuthority,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    ledgerRevision,
    ledgerDigest,
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    reviewRequestId: claim.reviewRequestId,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter,
    state: "active",
    expiresAt: claim.expiresAt,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
  });
}

function continueRenewal({ ledger, plan, evaluationTime, expiresAt }) {
  const previous = ledger.entries.findLast(
    entry => entry.claimId === plan.evidence.cloud.liveClaim.claimId,
  );
  return applyCloudTransition({
    ledger,
    action: "continue",
    actor: {
      actorId: previous.claimCore.actorId,
      deviceId: previous.claimCore.deviceId,
      sessionId: previous.claimCore.sessionId,
    },
    repository: {
      repositoryId: previous.repositoryId,
      canonicalRevision: previous.claimCore.canonicalBaseRevision,
    },
    evaluationTime,
    request: {
      claimId: previous.claimId,
      expectedFenceRevision: previous.claimDigest,
      expectedTransitionCounter: previous.claimCore.transitionCounter,
      expectedLedgerDigest: ledger.headDigest,
      mode: "renewal",
      expiresAt,
      idempotencyKey: [
        "device-heartbeat", previous.claimId,
        previous.claimCore.transitionCounter, previous.claimDigest,
      ].join(":"),
    },
  });
}

function recoveryFence(plan) {
  const core = {
    schema: "agentic-expired-published-bind-ahead-clean-descendant-recovery-fence/v1",
    branch: BRANCH,
    planDigest: plan.planDigest,
    authorizationDigest: authorizeExpiredPublishedBindAheadCleanDescendantRecovery(
      plan,
      plan.exactAuthorization,
    ).authorizationDigest,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
    sourceFenceSha: F,
    publishedFenceSha: R,
    preservedHeadSha: H,
  };
  return Object.freeze({ ...core, fenceDigest: digestValue(core) });
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
