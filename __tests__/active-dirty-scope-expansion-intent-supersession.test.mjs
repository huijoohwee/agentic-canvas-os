import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "../scripts/active-owned-dirt-recovery-evidence.mjs";
import { applyCloudTransition, createEmptyLedger }
  from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import {
  OPERATION,
  assertNoEffectScopeExpansionIntent,
  authorizeActiveDirtyScopeExpansionIntentSupersession,
  buildActiveDirtyScopeExpansionIntentSupersessionPlan,
} from "../scripts/active-dirty-scope-expansion-intent-supersession-contract.mjs";
import {
  analyzeNoEffectScopeExpansionCloudAbsence,
  applyActiveDirtyScopeExpansionIntentSupersession,
  assertIntentSupersessionRepositoryAuthority,
  createActiveDirtyScopeExpansionIntentSupersessionRepositoryController,
  normalizeIntentSupersessionLedgerCommitResponse,
  readStableRawCollaborationLedger,
} from "../scripts/active-dirty-scope-expansion-intent-supersession-repository-adapter.mjs";
import { writerLeaseDigest }
  from "../scripts/writer-lease-registry-cas.mjs";
import {
  LEDGER_REF_BARRIER_RECEIPT_SCHEMA,
  buildGithubCloudCollaborationLedgerRefBarrierRequest,
} from "../scripts/github-cloud-collaboration-ledger-ref-barrier.mjs";

const SHA = character => character.repeat(40);
const D = label => digestValue({ label });
const BRANCH = "agent/test-device.local/scope-expansion-source";
const SCOPE = "scope-expansion-source";
const SOURCE_CLAIM = D("source-claim");
const MAIN = SHA("a");
const OLD_MAIN = SHA("b");
const HEAD = SHA("c");
const PULL_NODE = "PR_node_839";
const REVIEW_REQUEST = `github-pull-request:${PULL_NODE}`;

test("contract accepts only a no-effect intent and exact typed authorization", () => {
  const fixture = planFixture();
  const authorized = authorizeActiveDirtyScopeExpansionIntentSupersession({
    plan: fixture.plan,
    authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
  });
  assert.equal(authorized.planDigest, fixture.plan.planDigest);
  assert.throws(() => authorizeActiveDirtyScopeExpansionIntentSupersession({
    plan: fixture.plan,
    authorization: `authorize ${OPERATION} ${D("other-plan")}`,
  }), /exact authorization/u);
  for (const field of ["targetClaimId", "waitingReceiptDigest", "boundAuthority",
    "localProjection", "pullRequestProjection", "finalReceiptDigest"]) {
    const value = structuredClone(fixture.intent);
    value[field] = field.endsWith("Authority") || field.endsWith("Projection")
      ? { effect: true } : D(field);
    assert.throws(() => assertNoEffectScopeExpansionIntent(value, { branch: BRANCH }),
      /rejects effect evidence/u);
  }
  assert.throws(() => assertNoEffectScopeExpansionIntent({
    ...fixture.intent,
    unknownEffect: null,
  }, { branch: BRANCH }), /intent-phase/u);
});

test("contract rejects a wrong PR node, fork head, or armed auto-merge", () => {
  const fixture = planFixture();
  for (const mutate of [
    evidence => { evidence.pullRequest.nodeId = "PR_foreign"; },
    evidence => { evidence.pullRequest.headRepository = "attacker/fork"; },
    evidence => { evidence.pullRequest.autoMergeRequest = { mergeMethod: "SQUASH" }; },
    evidence => { evidence.pullRequest.reviewRequestId = "github-pull-request:PR_foreign"; },
    evidence => { evidence.pullRequest.baseRefOid = SHA("9"); },
    evidence => { evidence.protectedMainAdvance.protectedMainSha = SHA("9"); },
    evidence => { evidence.protectedMainAdvance.protectedMainTreeSha = SHA("9"); },
    evidence => { evidence.protectedMainAdvance.declaredWriteSetDigest = D("foreign-scope"); },
  ]) {
    const evidence = structuredClone(fixture.plan.evidence);
    mutate(evidence);
    delete evidence.evidenceDigest;
    evidence.evidenceDigest = digestValue(evidence);
    assert.throws(
      () => buildActiveDirtyScopeExpansionIntentSupersessionPlan({ evidence }),
      /pull request|does not join exactly/u,
    );
  }
});

test("controller requires the remote ledger barrier before local archive-clear", async () => {
  const fixture = planFixture();
  let applied = false;
  const controller = createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
    {},
    { runtime: {
      readReplay: async () => null,
      inspect: async () => fixture.plan.evidence,
      authorizeTaskAuthority: async () => ({ receiptDigest: D("task-authority") }),
      captureDirt: async () => fixture.plan.evidence.dirt,
      establishBarrier: async () => { throw new Error("barrier CAS lost"); },
      finalize: () => { applied = true; },
    } },
  );
  await assert.rejects(() => controller.run({
    planDigest: fixture.plan.planDigest,
    authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
  }), /barrier CAS lost/u);
  assert.equal(applied, false);
});

test("controller revalidates the exact PR/head/remote/marker subject after the barrier", async () => {
  const fixture = planFixture();
  let applied = false;
  const controller = createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
    {},
    { runtime: {
      readReplay: async () => null,
      inspect: async () => fixture.plan.evidence,
      authorizeTaskAuthority: async () => ({ receiptDigest: D("task-authority") }),
      captureDirt: async () => fixture.plan.evidence.dirt,
      establishBarrier: async plan => barrierReceipt(plan),
      revalidateSubject: async () => {
        throw new Error("pull-request marker drifted after barrier");
      },
      finalize: () => { applied = true; },
    } },
  );
  await assert.rejects(() => controller.run({
    planDigest: fixture.plan.planDigest,
    authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
  }), /marker drifted after barrier/u);
  assert.equal(applied, false);
});

test("revalidation-time dirt drift blocks the local archive-clear CAS", async () => {
  const fixture = planFixture();
  const changedDirt = structuredClone(fixture.plan.evidence.dirt);
  changedDirt.entries[0].worktreeBlob = SHA("7");
  delete changedDirt.evidenceDigest;
  changedDirt.evidenceDigest = digestValue(changedDirt);
  let revalidated = false;
  let applied = false;
  const controller = createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
    {},
    { runtime: {
      readReplay: async () => null,
      inspect: async () => fixture.plan.evidence,
      authorizeTaskAuthority: async () => ({ receiptDigest: D("task-authority") }),
      captureDirt: async () => fixture.plan.evidence.dirt,
      establishBarrier: async plan => barrierReceipt(plan),
      revalidateSubject: async () => {
        queueMicrotask(() => { revalidated = true; });
      },
      finalize: ({ beforeDirt }) => {
        const finalDirt = revalidated ? changedDirt : fixture.plan.evidence.dirt;
        requireSameActiveOwnedDirtEvidence(beforeDirt, finalDirt);
        applied = true;
      },
    } },
  );
  await assert.rejects(() => controller.run({
    planDigest: fixture.plan.planDigest,
    authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
  }), /bytes, modes, paths, or index state changed/u);
  assert.equal(applied, false);
});

test("production ledger commit normalization preserves message bytes", () => {
  const message = " exact barrier message\n ";
  const normalized = normalizeIntentSupersessionLedgerCommitResponse({
    sha: SHA("1"),
    tree: { sha: SHA("2") },
    parents: [{ sha: SHA("3") }],
    message,
  });
  assert.equal(normalized.message, message);
});

test("archive-clear CAS changes one revision, preserves lease/maps, and replays immutably", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "intent-supersession-registry-"));
  try {
    const fixture = planFixture();
    const statePath = path.join(root, "writer-leases.json");
    writeFileSync(statePath, `${JSON.stringify(fixture.registry, null, 2)}\n`);
    const store = fileLeaseStore(statePath);
    const leaseBefore = structuredClone(fixture.lease);
    const unrelatedBefore = structuredClone(fixture.registry.unrelatedRecoveryMap);
    const input = {
      leaseStore: store,
      branch: BRANCH,
      plan: fixture.plan,
      authorizationDigest: D("authorization"),
      taskAuthorityReceipt: { receiptDigest: D("task-authority") },
      barrierReceipt: barrierReceipt(fixture.plan),
      clock: () => new Date("2026-08-31T00:30:00.000Z"),
    };
    const first = applyActiveDirtyScopeExpansionIntentSupersession(input);
    const after = store.readRegistry();
    assert.equal(first.replayed, false);
    assert.equal(after.revision, fixture.registry.revision + 1);
    assert.equal(after.scopeExpansionIntents[BRANCH], undefined);
    assert.deepEqual(after.leases[BRANCH], leaseBefore);
    assert.deepEqual(after.unrelatedRecoveryMap, unrelatedBefore);
    assert.equal(
      after.scopeExpansionIntentSupersessionReceipts[BRANCH]
        [fixture.plan.evidence.sourceIntentDigest].receiptDigest,
      first.receiptDigest,
    );

    const replay = applyActiveDirtyScopeExpansionIntentSupersession(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.receiptDigest, first.receiptDigest);
    assert.deepEqual(replay.completionEffects, first.completionEffects);
    assert.equal(replay.attemptEffects.registryCasApplied, false);
    assert.equal(replay.attemptEffects.coordinationLedgerBarrierObserved, false);
    assert.equal(replay.attemptEffects.coordinationCommitCreationAcknowledged, false);
    assert.equal(replay.attemptEffects.coordinationRefUpdateAcknowledged, false);
    assert.equal(replay.attemptEffects.coordinationLedgerMutationDisposition,
      "not-attempted-stored-replay");
    assert.equal(applyActiveDirtyScopeExpansionIntentSupersession(input).resultDigest,
      replay.resultDigest);
    assert.equal(store.readRegistry().revision, after.revision);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("projected and response-loss completions replay with zero current-attempt effects", () => {
  for (const disposition of ["projected", "adopted-response-loss"]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "intent-supersession-attempt-"));
    try {
      const fixture = planFixture();
      const statePath = path.join(root, "writer-leases.json");
      writeFileSync(statePath, `${JSON.stringify(fixture.registry, null, 2)}\n`);
      const input = {
        leaseStore: fileLeaseStore(statePath),
        branch: BRANCH,
        plan: fixture.plan,
        authorizationDigest: D("authorization"),
        taskAuthorityReceipt: { receiptDigest: D("task-authority") },
        barrierReceipt: barrierReceipt(fixture.plan, { disposition }),
        clock: () => new Date("2026-08-31T00:30:00.000Z"),
      };
      const first = applyActiveDirtyScopeExpansionIntentSupersession(input);
      const replay = applyActiveDirtyScopeExpansionIntentSupersession(input);
      assert.equal(first.completionEffects.coordinationLedgerMutationDisposition, disposition);
      assert.equal(first.attemptEffects.registryCasApplied, true);
      assert.equal(first.attemptEffects.coordinationCommitCreationAcknowledged, true);
      assert.equal(first.attemptEffects.coordinationRefUpdateAcknowledged,
        disposition === "projected");
      assert.equal(replay.receiptDigest, first.receiptDigest);
      assert.deepEqual(replay.completionEffects, first.completionEffects);
      assert.equal(replay.attemptEffects.registryCasApplied, false);
      assert.equal(replay.attemptEffects.coordinationLedgerBarrierObserved, false);
      assert.equal(replay.attemptEffects.coordinationCommitCreationAcknowledged, false);
      assert.equal(replay.attemptEffects.coordinationRefUpdateAcknowledged, false);
      assert.equal(replay.attemptEffects.coordinationLedgerMutationDisposition,
        "not-attempted-stored-replay");
      assert.equal(applyActiveDirtyScopeExpansionIntentSupersession(input).resultDigest,
        replay.resultDigest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("CAS rejects registry or intent drift without clearing anything", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "intent-supersession-drift-"));
  try {
    const fixture = planFixture();
    const changed = structuredClone(fixture.registry);
    changed.revision += 1;
    changed.unrelatedRecoveryMap.extra = D("concurrent-change");
    const statePath = path.join(root, "writer-leases.json");
    writeFileSync(statePath, `${JSON.stringify(changed, null, 2)}\n`);
    assert.throws(() => applyActiveDirtyScopeExpansionIntentSupersession({
      leaseStore: fileLeaseStore(statePath),
      branch: BRANCH,
      plan: fixture.plan,
      authorizationDigest: D("authorization"),
      taskAuthorityReceipt: { receiptDigest: D("task-authority") },
      barrierReceipt: barrierReceipt(fixture.plan),
      clock: () => new Date("2026-08-31T00:30:00.000Z"),
    }), /registry changed/u);
    const after = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(after, changed);
    assert.ok(after.scopeExpansionIntents[BRANCH]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CAS rejects a barrier receipt from another ledger parent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "intent-supersession-barrier-drift-"));
  try {
    const fixture = planFixture();
    const statePath = path.join(root, "writer-leases.json");
    writeFileSync(statePath, `${JSON.stringify(fixture.registry, null, 2)}\n`);
    const wrong = barrierReceipt(fixture.plan);
    wrong.sourceRevision = SHA("0");
    assert.throws(() => applyActiveDirtyScopeExpansionIntentSupersession({
      leaseStore: fileLeaseStore(statePath),
      branch: BRANCH,
      plan: fixture.plan,
      authorizationDigest: D("authorization"),
      taskAuthorityReceipt: { receiptDigest: D("task-authority") },
      barrierReceipt: wrong,
      clock: () => new Date("2026-08-31T00:30:00.000Z"),
    }), /barrier receipt digest drifted|rebuilt sealed request|exact sealed ledger-ref barrier/u);
    assert.ok(fileLeaseStore(statePath).readRegistry().scopeExpansionIntents[BRANCH]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CAS fails closed when current authority crosses into expiry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "intent-supersession-expiry-"));
  try {
    const fixture = planFixture({ disposition: "current" });
    const statePath = path.join(root, "writer-leases.json");
    writeFileSync(statePath, `${JSON.stringify(fixture.registry, null, 2)}\n`);
    const unlocked = fileLeaseStore(statePath);
    let lockHeld = false;
    const store = {
      ...unlocked,
      withRegistryLock(callback) {
        lockHeld = true;
        try { return callback(unlocked.readRegistry()); }
        finally { lockHeld = false; }
      },
    };
    assert.throws(() => applyActiveDirtyScopeExpansionIntentSupersession({
      leaseStore: store,
      branch: BRANCH,
      plan: fixture.plan,
      authorizationDigest: D("authorization"),
      taskAuthorityReceipt: { receiptDigest: D("task-authority") },
      barrierReceipt: barrierReceipt(fixture.plan),
      clock: () => {
        assert.equal(lockHeld, true);
        return new Date("2026-08-31T01:00:00.000Z");
      },
    }), /expiry disposition changed/u);
    assert.ok(fileLeaseStore(statePath).readRegistry().scopeExpansionIntents[BRANCH]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lost-response replay is read-only and skips every mutation dependency", async () => {
  const fixture = planFixture();
  const replayReceipt = Object.freeze({ receiptDigest: D("stored-receipt"), replayed: true });
  const forbidden = () => { throw new Error("mutation dependency was called"); };
  const controller = createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
    {},
    { runtime: {
      readReplay: async digest => digest === fixture.plan.planDigest
        ? { plan: fixture.plan, receipt: replayReceipt } : null,
      inspect: forbidden,
      authorizeTaskAuthority: forbidden,
      captureDirt: forbidden,
      establishBarrier: forbidden,
      revalidateSubject: forbidden,
      finalize: forbidden,
    } },
  );
  const result = await controller.run({
    planDigest: fixture.plan.planDigest,
    authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
  });
  assert.equal(result, replayReceipt);
});

test("controller rejects sealed-dirt drift before invoking archive-clear CAS", async () => {
  const fixture = planFixture();
  let applied = false;
  const changedDirt = dirtFixture(fixture.plan.evidence.dirt.headSha);
  changedDirt.entries[0] = { ...changedDirt.entries[0], worktreeBlob: SHA("7") };
  const changedCore = {
    ...changedDirt,
    entries: changedDirt.entries,
  };
  delete changedCore.evidenceDigest;
  changedDirt.evidenceDigest = digestValue(changedCore);
  const controller = createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
    {},
    { runtime: {
      readReplay: async () => null,
      inspect: async () => fixture.plan.evidence,
      authorizeTaskAuthority: async () => ({ receiptDigest: D("task-authority") }),
      captureDirt: async () => changedDirt,
      finalize: () => { applied = true; },
    } },
  );
  await assert.rejects(() => controller.run({
    planDigest: fixture.plan.planDigest,
    authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
  }), /drifted before archive-clear CAS/u);
  assert.equal(applied, false);
});

test("adapter binds source, target, and ledger repositories to cloud authority", () => {
  const input = {
    sourceRemote: "git@github.com:example/repository.git",
    targetRepository: "example/repository",
    ledgerRepository: "example/ledger",
    cloudAuthority: {
      targetRepository: "example/repository",
      ledgerRepository: "example/ledger",
    },
  };
  assert.deepEqual(assertIntentSupersessionRepositoryAuthority(input), {
    targetRepository: input.targetRepository,
    ledgerRepository: input.ledgerRepository,
  });
  assert.throws(() => assertIntentSupersessionRepositoryAuthority({
    ...input,
    ledgerRepository: "attacker/copied-ledger",
  }), /repositories are not exact/u);
  assert.throws(() => assertIntentSupersessionRepositoryAuthority({
    ...input,
    sourceRemote: "git@github.com:attacker/fork.git",
  }), /repositories are not exact/u);
});

test("controller preserves mixed staged/unstaged bytes, mode, and index exactly", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "intent-supersession-dirt-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Scope Test"]);
    git(root, ["config", "user.email", "scope@example.invalid"]);
    writeFileSync(path.join(root, "owned.txt"), "base\n");
    git(root, ["add", "owned.txt"]);
    git(root, ["commit", "-qm", "base"]);
    const head = git(root, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(root, "owned.txt"), "staged\n", { mode: 0o755 });
    execFileSync("chmod", ["+x", path.join(root, "owned.txt")]);
    git(root, ["add", "owned.txt"]);
    writeFileSync(path.join(root, "owned.txt"), "unstaged\n", { mode: 0o755 });
    const dirt = captureActiveOwnedDirtEvidence({ repository: root });
    assert.equal(dirt.stagedPathCount, 1);
    assert.equal(dirt.unstagedPathCount, 1);
    assert.equal(dirt.entries[0].indexMode, "100755");
    const fixture = planFixture({ head, dirt });
    const statePath = path.join(root, ".git", "agentic-canvas-os-test", "writer-leases.json");
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(fixture.registry, null, 2)}\n`);
    const store = fileLeaseStore(statePath);
    const indexBefore = git(root, ["ls-files", "--stage", "-z"]);
    const stagedBefore = git(root, ["diff", "--cached", "--binary"]);
    const unstagedBefore = git(root, ["diff", "--binary"]);
    const runtime = {
      readReplay: async () => null,
      inspect: async () => fixture.plan.evidence,
      authorizeTaskAuthority: async () => ({ receiptDigest: D("task-authority") }),
      captureDirt: async () => captureActiveOwnedDirtEvidence({ repository: root }),
      establishBarrier: async plan => barrierReceipt(plan),
      revalidateSubject: async () => ({ subjectDigest: D("revalidated-subject") }),
      finalize: ({ beforeDirt, ...input }) => {
        const finalDirt = captureActiveOwnedDirtEvidence({ repository: root });
        requireSameActiveOwnedDirtEvidence(beforeDirt, finalDirt);
        return applyActiveDirtyScopeExpansionIntentSupersession({
          leaseStore: store,
          branch: BRANCH,
          clock: () => new Date("2026-08-31T00:30:00.000Z"),
          ...input,
        });
      },
    };
    const controller = createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
      {}, { runtime },
    );
    const receipt = await controller.run({
      planDigest: fixture.plan.planDigest,
      authorization: `authorize ${OPERATION} ${fixture.plan.planDigest}`,
    });
    assert.equal(receipt.attemptEffects.sourceBytesChanged, false);
    assert.equal(receipt.attemptEffects.coordinationRefUpdateAcknowledged, true);
    assert.equal(receipt.completionEffects.coordinationRefUpdateAcknowledged, true);
    assert.equal(git(root, ["ls-files", "--stage", "-z"]), indexBefore);
    assert.equal(git(root, ["diff", "--cached", "--binary"]), stagedBefore);
    assert.equal(git(root, ["diff", "--binary"]), unstagedBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw ledger double-read fails closed on ref/blob drift", async () => {
  let reads = 0;
  await assert.rejects(() => readStableRawCollaborationLedger({
    readSnapshot: async () => ({
      revision: reads++ === 0 ? SHA("1") : SHA("2"),
      blobSha: SHA("3"),
      rawDigest: D("raw"),
      ledgerDigest: D("ledger"),
      sequence: 1,
      ledger: {},
    }),
  }), /changed across the double read/u);
});

test("validated raw cloud evidence classifies current/dormant and rejects old effect", () => {
  const actor = { actorId: "github-user:test", deviceId: "device:test", sessionId: "session:test" };
  const repository = { repositoryId: "github-repository:test", canonicalRevision: SHA("1") };
  const empty = createEmptyLedger(repository);
  const claimed = applyCloudTransition({
    ledger: empty,
    action: "claim",
    actor,
    repository,
    evaluationTime: "2026-08-31T00:00:00.000Z",
    request: {
      workItemId: "work-item:test",
      canonicalBaseRevision: SHA("1"),
      laneRevision: SHA("2"),
      declaredWriteScope: ["path:owned.txt", "semantic:scope"],
      leaseEpoch: 1,
      expiresAt: "2026-08-31T02:00:00.000Z",
      idempotencyKey: "source-claim",
      expectedLedgerDigest: empty.headDigest,
    },
  });
  const input = {
    ledger: claimed.ledger,
    sourceClaimId: claimed.claim.claimId,
    sourceClaimDigest: claimed.claim.fenceRevision,
    sourceTransitionDigest: claimed.claim.ledgerRevision,
    sourceTransitionCounter: claimed.claim.transitionCounter,
    sourceLeaseExpiresAt: "2026-08-31T01:00:00.000Z",
    sourceCloudExpiresAt: claimed.claim.expiresAt,
    sourcePlanDigest: D("old-plan"),
    targetCanonicalBaseSha: SHA("1"),
    targetWriteSetDigest: digestValue(["path:owned.txt", "semantic:scope"]),
    targetDeclaredWriteSet: ["path:owned.txt", "semantic:scope"],
  };
  assert.equal(analyzeNoEffectScopeExpansionCloudAbsence({
    ...input,
    now: new Date("2026-08-31T00:30:00.000Z"),
  }).effectiveState, "current");
  assert.equal(analyzeNoEffectScopeExpansionCloudAbsence({
    ...input,
    now: new Date("2026-08-31T01:30:00.000Z"),
  }).effectiveState, "dormant-preserved");

  const tampered = structuredClone(claimed.ledger);
  tampered.entries[0].idempotencyKey = digestValue(
    `active-dirty-scope-expansion:waiting:${input.sourcePlanDigest}`,
  );
  const { digest: _oldDigest, ...draft } = tampered.entries[0];
  draft.requestDigest = tampered.entries[0].requestDigest;
  tampered.entries[0] = { ...draft, digest: digestValue(draft) };
  tampered.headDigest = tampered.entries[0].digest;
  assert.throws(() => analyzeNoEffectScopeExpansionCloudAbsence({
    ...input,
    ledger: tampered,
    sourceClaimDigest: tampered.entries[0].claimDigest,
    sourceTransitionDigest: tampered.entries[0].digest,
    now: new Date("2026-08-31T00:30:00.000Z"),
  }), /request or a foreign-key derivative already exists/u);
});

function planFixture({ head = HEAD, dirt = dirtFixture(head), disposition = "current" } = {}) {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths: ["owned.txt", "scripts/new-scope.mjs"],
  });
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 9,
    branch: BRANCH,
    expiresAt: "2026-08-31T01:00:00.000Z",
    cloudAuthority: {
      claimId: SOURCE_CLAIM,
      expiresAt: "2026-08-31T02:00:00.000Z",
      reviewRequestId: REVIEW_REQUEST,
    },
  };
  const sharedPlan = {
    schema: "agentic-active-dirty-scope-expansion-plan/v1",
    sourceBranch: BRANCH,
    sourceFenceSha: head,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: SOURCE_CLAIM,
    sourceClaimDigest: D("source-claim-digest"),
    sourceClaimTransitionCounter: 2,
    sourceReviewRequestId: REVIEW_REQUEST,
    sourceWriteSetDigest: D("source-write-set"),
    sourceManifestDigest: D("source-manifest"),
    sourceDirtyDigest: dirt.evidenceDigest,
    sourceChangedPaths: dirt.entries.map(entry => entry.path),
    targetCanonicalBaseSha: SHA("d"),
    targetManifestDigest: manifest.manifestDigest,
    targetWriteSetDigest: manifest.writeSetDigest,
    targetDeclaredWriteSet: manifest.declaredWriteSet,
    targetCloudLeaseEpoch: 1,
  };
  const oldPlanCore = {
    ...sharedPlan,
    canonicalDescendantProof: canonicalProof(SHA("d"), OLD_MAIN),
  };
  const oldPlanDigest = digestValue(oldPlanCore);
  const oldPlan = { ...oldPlanCore, planDigest: oldPlanDigest };
  const intent = {
    schema: "agentic-active-dirty-scope-expansion-intent/v1",
    status: "intent",
    branch: BRANCH,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: SOURCE_CLAIM,
    sourceFenceSha: head,
    targetWriteSetDigest: manifest.writeSetDigest,
    targetManifestDigest: manifest.manifestDigest,
    planDigest: oldPlanDigest,
    targetClaimId: null,
    targetClaimDigest: null,
    targetLeaseEpoch: 1,
    targetCanonicalBaseSha: SHA("d"),
    targetReviewRequestId: null,
    completedReceiptDigest: null,
    planSnapshot: oldPlan,
  };
  const registry = {
    schema: "agentic-writer-lease-registry/v2",
    revision: 41,
    leases: { [BRANCH]: lease },
    scopeExpansionIntents: { [BRANCH]: intent },
    unrelatedRecoveryMap: { preserved: D("unrelated") },
  };
  const freshCore = {
    ...sharedPlan,
    canonicalDescendantProof: canonicalProof(SHA("d"), MAIN),
  };
  const freshExpansionPlan = { ...freshCore, planDigest: digestValue(freshCore) };
  const evidenceCore = {
    repository: "example/repository",
    controller: {
      path: "/protected/controller",
      headSha: MAIN,
      treeSha: SHA("e"),
      originMainSha: MAIN,
      remoteMainSha: MAIN,
      clean: true,
      implementationDigest: D("implementation"),
    },
    scope: SCOPE,
    branch: BRANCH,
    sessionId: "source-session",
    pullRequestNumber: 839,
    lane: { worktreePath: "/source", headSha: head, remoteHeadSha: head, treeSha: SHA("f") },
    lease: {
      leaseDigest: writerLeaseDigest(lease),
      claimId: SOURCE_CLAIM,
      reviewRequestId: REVIEW_REQUEST,
      taskAuthorityBindingDigest: D("task-binding"),
      registryRevision: registry.revision,
      registryDigest: digestValue(registry),
      expiresAt: "2026-08-31T01:00:00.000Z",
      disposition,
    },
    pullRequest: {
      number: 839,
      nodeId: PULL_NODE,
      url: "https://github.com/example/repository/pull/839",
      state: "OPEN",
      isDraft: true,
      autoMergeRequest: null,
      headRepository: "example/repository",
      headRefName: BRANCH,
      headRefOid: head,
      baseRefName: "main",
      baseRefOid: SHA("1"),
      reviewRequestId: REVIEW_REQUEST,
      markerDigest: D("marker"),
      bodyDigest: D("body"),
    },
    sourceIntent: intent,
    sourceIntentDigest: digestValue(intent),
    targetManifest: manifest,
    dirt,
    protectedMainAdvance: protectedMainAdvanceFixture(manifest),
    freshExpansionPlan,
    cloud: {
      ledgerRepository: "example/repository",
      revision: SHA("2"),
      treeSha: SHA("8"),
      blobSha: SHA("3"),
      rawDigest: D("raw"),
      ledgerDigest: D("ledger"),
      sequence: 12,
      rereadRevision: SHA("2"),
      rereadBlobSha: SHA("3"),
      rereadRawDigest: D("raw"),
      sourceClaimId: SOURCE_CLAIM,
      sourceClaimDigest: D("source-claim-digest"),
      sourceTransitionDigest: D("source-transition"),
      sourceTransitionCounter: 2,
      sourceExpiresAt: "2026-08-31T02:00:00.000Z",
      recordedState: "current",
      effectiveState: disposition,
      operationKeyDigest: D("operation-key"),
      exactOperationAbsent: true,
      foreignDerivativeAbsent: true,
      prohibitedEntryCount: 0,
      absenceDigest: D("absence"),
    },
    zeroEffectPreconditions: {
      intentPhaseOnly: true,
      noCloudReceipt: true,
      noSuccessorClaim: true,
      noRetirement: true,
      noLocalProjection: true,
      noPullRequestProjection: true,
    },
  };
  const evidence = { ...evidenceCore, evidenceDigest: digestValue(evidenceCore) };
  return {
    lease,
    intent,
    registry,
    plan: buildActiveDirtyScopeExpansionIntentSupersessionPlan({ evidence }),
  };
}

function dirtFixture(headSha) {
  const entry = {
    path: "owned.txt",
    staged: true,
    unstaged: true,
    untracked: false,
    headMode: "100644",
    headBlob: SHA("4"),
    indexMode: "100755",
    indexBlob: SHA("5"),
    worktreeType: "file",
    worktreeMode: "100755",
    worktreeBlob: SHA("6"),
  };
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha,
    entries: [entry],
    pathCount: 1,
    stagedPathCount: 1,
    unstagedPathCount: 1,
    untrackedPathCount: 0,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function canonicalProof(sourceBaseSha, protectedMainSha) {
  const canonicalChangedPaths = ["protected-main.md"];
  const preservedChangedPaths = ["owned.txt", "scripts/new-scope.mjs"];
  const core = {
    schema: "agentic-legacy-review-current-base-disjoint-proof/v1",
    sourceBaseSha,
    targetBaseSha: protectedMainSha,
    protectedMainSha,
    canonicalChangedPaths,
    canonicalChangedPathsDigest: digestValue(canonicalChangedPaths),
    preservedChangedPaths,
    preservedChangedPathsDigest: digestValue(preservedChangedPaths),
    ancestry: "source-base-to-current-protected-main",
    overlap: "none",
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function protectedMainAdvanceFixture(manifest, {
  baseSha = SHA("d"),
  pullRequestBaseSha = SHA("1"),
  protectedMainSha = MAIN,
  protectedMainTreeSha = SHA("e"),
} = {}) {
  return {
    schema: "agentic-active-owned-dirt-protected-main-advance/v1",
    baseSha,
    pullRequestBaseSha,
    protectedMainSha,
    protectedMainTreeSha,
    declaredWriteSetDigest: digestValue(manifest.declaredWriteSet),
    changedPathCount: 1,
    changedPathsDigest: digestValue(["protected-main.md"]),
  };
}

function barrierReceipt(plan, { disposition = "projected" } = {}) {
  const cloud = plan.evidence.cloud;
  const request = buildGithubCloudCollaborationLedgerRefBarrierRequest({
    operation: OPERATION,
    operationDigest: plan.planDigest,
    repository: cloud.ledgerRepository,
    ref: "refs/heads/agentic/collaboration-ledger",
    sourceRevision: cloud.revision,
    sourceTreeSha: cloud.treeSha,
    ledgerBlobSha: cloud.blobSha,
    rawDigest: cloud.rawDigest,
    ledgerDigest: cloud.ledgerDigest,
    sequence: cloud.sequence,
  });
  const core = {
    schema: LEDGER_REF_BARRIER_RECEIPT_SCHEMA,
    status: "established",
    operation: OPERATION,
    operationDigest: plan.planDigest,
    repository: cloud.ledgerRepository,
    ref: "refs/heads/agentic/collaboration-ledger",
    sourceRevision: cloud.revision,
    barrierRevision: SHA("7"),
    observedRevision: SHA("7"),
    sourceTreeSha: cloud.treeSha,
    barrierTreeSha: cloud.treeSha,
    ledgerBlobSha: cloud.blobSha,
    rawDigest: cloud.rawDigest,
    ledgerDigest: cloud.ledgerDigest,
    sequence: cloud.sequence,
    metadataDigest: request.metadataDigest,
    messageDigest: request.messageDigest,
    ancestry: "barrier-or-descendant",
    force: false,
    disposition,
    commitCreationAcknowledged: disposition !== "replayed",
    refUpdateAcknowledged: disposition === "projected",
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function fileLeaseStore(statePath) {
  return {
    statePath,
    readRegistry() { return JSON.parse(readFileSync(statePath, "utf8")); },
    withRegistryLock(callback) { return callback(this.readRegistry()); },
  };
}

function git(cwd, args) {
  return String(execFileSync("git", args, { cwd, encoding: "utf8" })).trim();
}
