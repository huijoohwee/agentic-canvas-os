import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildActiveOwnedDirtRecoveryPlan, buildActiveOwnedDirtRecoveryReceipt,
} from "../scripts/active-owned-dirt-recovery-contract.mjs";
import {
  createActiveOwnedDirtRecoveryControllerAdapter,
  createRepositoryActiveOwnedDirtRecoveryAdapter,
  captureProtectedMainAdvance,
  invokeActiveOwnedDirtRecoveryContinue,
  requireProtectedMainEquivalent,
  runActiveOwnedDirtRecovery,
} from "../scripts/active-owned-dirt-recovery-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const CLI = fileURLToPath(new URL("../scripts/active-owned-dirt-recovery.mjs", import.meta.url));

test("CLI redacts paths and GitHub tokens and suppresses child-process diagnostics", () => {
  const token = `ghp_${"A".repeat(36)}`;
  const missing = spawnSync(process.execPath, [
    CLI, "plan", `--repository=/Users/operator/${token}/missing`, "--session=source", "--json",
  ], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.doesNotMatch(missing.stdout, /ghp_|\/Users\/operator/u);
  assert.match(missing.stdout, /\[local-path\]/u);
  assert.ok(JSON.parse(missing.stdout).error.length <= 300);

  const linuxSecret = `linux-secret-${process.pid}`;
  const linuxMissing = spawnSync(process.execPath, [
    CLI, "plan", `--repository=/tmp/${linuxSecret}/missing`, "--session=source", "--json",
  ], { encoding: "utf8" });
  assert.equal(linuxMissing.status, 1);
  assert.doesNotMatch(linuxMissing.stdout, /\/tmp\/|linux-secret/u);
  assert.match(linuxMissing.stdout, /\[local-path\]/u);

  const subprocess = spawnSync(process.execPath, [
    CLI, "plan", `--repository=${process.cwd()}`, "--session=source", "--json",
  ], { encoding: "utf8", env: { ...process.env, PATH: "/missing-bin" } });
  assert.equal(subprocess.status, 1);
  assert.equal(JSON.parse(subprocess.stdout).error, "Recovery subprocess failed.");
});

test("repository adapter rejects a branch attached to more than one worktree record", () => {
  const root = process.cwd();
  const branch = "agent/device/recovery";
  const values = new Map([
    ["rev-parse --show-toplevel", root],
    ["branch --show-current", branch],
    ["worktree list --porcelain -z", [
      `worktree ${root}\0HEAD ${"a".repeat(40)}\0branch refs/heads/${branch}\0`,
      `worktree ${root}-duplicate\0HEAD ${"a".repeat(40)}\0branch refs/heads/${branch}\0`,
    ].join("\0")],
  ]);
  assert.throws(() => createRepositoryActiveOwnedDirtRecoveryAdapter({
    repository: root,
    sessionId: "source",
    gitText: args => values.get(args.join(" ")) || "",
  }), /exact registered attached worktree/);
});

test("cloud response loss retries the identical continue invocation exactly once", () => {
  const invocation = { action: "continue", request: { idempotencyKey: "same" } };
  const observed = [];
  const result = invokeActiveOwnedDirtRecoveryContinue({
    invocation,
    invoke: value => {
      observed.push(value);
      if (observed.length === 1) throw new Error("response lost");
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(observed.length, 2);
  assert.equal(observed[0], invocation);
  assert.equal(observed[1], invocation);
});

test("protected-main evidence admits only disjoint descendant advancement", () => {
  const baseSha = "1".repeat(40);
  const pullRequestBaseSha = "2".repeat(40);
  const protectedMainSha = "3".repeat(40);
  const calls = [];
  const gitText = args => {
    calls.push(args);
    if (args[0] === "merge-base") return "";
    if (args[0] === "diff") return "docs/unrelated.md\0";
    if (args[0] === "rev-parse") return "4".repeat(40);
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  const planned = captureProtectedMainAdvance({
    baseSha, pullRequestBaseSha, protectedMainSha,
    declaredWriteSet: ["path:scripts/recovery.mjs", "semantic:recovery"],
    gitText,
  });
  assert.equal(planned.changedPathCount, 1);
  assert.equal("changedPaths" in planned, false);
  const observed = { ...planned, protectedMainSha: "5".repeat(40),
    protectedMainTreeSha: "6".repeat(40), changedPathCount: 2,
    changedPathsDigest: digestValue(["docs/next.md", "docs/unrelated.md"]) };
  requireProtectedMainEquivalent({ planned, observed, gitText });
  assert.ok(calls.some(args => args.join(" ")
    === `merge-base --is-ancestor ${planned.protectedMainSha} ${observed.protectedMainSha}`));
  assert.throws(() => captureProtectedMainAdvance({
    baseSha, pullRequestBaseSha, protectedMainSha,
    declaredWriteSet: ["path:docs/START-WORKFLOW.md"],
    gitText: args => args[0] === "diff" ? "docs\0" : gitText(args),
  }), /advanced within/);
  assert.throws(() => captureProtectedMainAdvance({
    baseSha, pullRequestBaseSha, protectedMainSha,
    declaredWriteSet: ["path:scripts/recovery.mjs"],
    gitText: args => {
      if (args[0] === "merge-base" && args.at(-1) === protectedMainSha) {
        throw new Error("not a descendant");
      }
      return gitText(args);
    },
  }), /not a descendant/);
});

test("controller orders durable snapshot before cloud and replays every phase once", async () => {
  const source = sourceFixture();
  const plan = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  const calls = [];
  let intent = null;
  let finalOverride = null;
  const adapter = createActiveOwnedDirtRecoveryControllerAdapter({
    readState: async () => ({ source, intent, ttlSeconds: 1_800 }),
    beginIntent: async ({ plan: received }) => {
      calls.push("intent");
      intent = baseIntent(received);
      return { intent };
    },
    markIntent: async ({ status, values }) => {
      calls.push(`mark:${status}`);
      intent = { ...intent, ...values, status };
      return intent;
    },
    createSnapshot: async ({ plan: received }) => {
      calls.push("snapshot");
      return snapshotFixture(received);
    },
    recoverCloud: async ({ plan: received }) => {
      calls.push("cloud");
      assert.ok(calls.indexOf("snapshot") < calls.indexOf("cloud"));
      return cloudFixture(received);
    },
    projectLocal: async () => {
      calls.push("local-cas");
      intent = {
        ...intent,
        status: "local-cas",
        localProjection: {
          leaseDigest: "8".repeat(64),
          mutationAuthorityReceiptDigest: "7".repeat(64),
          claimId: plan.sourceClaimId,
          claimDigest: "8".repeat(64),
        },
      };
      return { intent };
    },
    projectPullRequest: async () => {
      calls.push("pr-marker");
      return { markerDigest: "9".repeat(64), bodyDigest: "a".repeat(64) };
    },
    finalize: async ({ plan: received, snapshot }) => {
      calls.push("complete");
      return { receiptDigest: finalOverride || finalReceipt(received, snapshot, intent) };
    },
  });
  const authorization = `authorize active-owned-dirt-reclaim ${plan.planDigest}`;
  const result = await runActiveOwnedDirtRecovery({ authorization }, { adapter });
  assert.equal(result.status, "recovered");
  assert.deepEqual(calls, [
    "intent", "snapshot", "mark:snapshot", "cloud", "mark:cloud",
    "local-cas", "pr-marker", "mark:pr-marker", "complete", "mark:complete",
  ]);
  const replay = await runActiveOwnedDirtRecovery({}, { adapter });
  assert.equal(replay.finalReceiptDigest, result.finalReceiptDigest);
  assert.equal(calls.filter(value => value === "cloud").length, 1);
  assert.equal(calls.filter(value => value === "local-cas").length, 1);
  finalOverride = "c".repeat(64);
  await assert.rejects(() => runActiveOwnedDirtRecovery({}, { adapter }), /live verification drifted/);
  intent = { ...intent, finalReceiptDigest: "0".repeat(64) };
  await assert.rejects(() => runActiveOwnedDirtRecovery({}, { adapter }), /malformed/);
});

test("controller replays cloud response loss and retains atomic local CAS", async () => {
  const source = sourceFixture();
  const plan = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  let intent = null;
  let cloudCalls = 0;
  let localCalls = 0;
  const adapter = createActiveOwnedDirtRecoveryControllerAdapter({
    readState: async () => ({ source, intent, ttlSeconds: 1_800 }),
    beginIntent: async ({ plan: received }) => {
      intent = baseIntent(received);
      return { intent };
    },
    markIntent: async ({ status, values }) => {
      intent = { ...intent, ...values, status };
      return intent;
    },
    createSnapshot: async ({ plan: received }) => snapshotFixture(received),
    recoverCloud: async ({ plan: received }) => {
      cloudCalls += 1;
      if (cloudCalls === 1) throw new Error("lost cloud response after mutation");
      return cloudFixture(received);
    },
    projectLocal: async () => {
      localCalls += 1;
      intent = {
        ...intent,
        status: "local-cas",
        localProjection: {
          leaseDigest: "8".repeat(64),
          mutationAuthorityReceiptDigest: "7".repeat(64),
          claimId: plan.sourceClaimId,
          claimDigest: "8".repeat(64),
        },
      };
      throw new Error("lost local CAS response");
    },
    projectPullRequest: async () => ({
      markerDigest: "9".repeat(64), bodyDigest: "a".repeat(64),
    }),
    finalize: async ({ plan: received, snapshot }) => ({
      receiptDigest: finalReceipt(received, snapshot, intent),
    }),
  });
  const authorization = `authorize active-owned-dirt-reclaim ${plan.planDigest}`;
  await assert.rejects(() => runActiveOwnedDirtRecovery({ authorization }, { adapter }), /lost cloud response/);
  await assert.rejects(() => runActiveOwnedDirtRecovery({}, { adapter }), /lost local CAS response/);
  const recovered = await runActiveOwnedDirtRecovery({}, { adapter });
  assert.equal(recovered.status, "recovered");
  assert.equal(cloudCalls, 2);
  assert.equal(localCalls, 1);
});

test("controller rejects authorization drift before durable intent", async () => {
  const source = sourceFixture();
  let began = false;
  const adapter = createActiveOwnedDirtRecoveryControllerAdapter({
    readState: async () => ({ source, intent: null, ttlSeconds: 1_800 }),
    beginIntent: async () => { began = true; },
    markIntent: async () => {},
    createSnapshot: async () => {},
    recoverCloud: async () => {},
    projectLocal: async () => {},
    projectPullRequest: async () => {},
    finalize: async () => {},
  });
  await assert.rejects(() => runActiveOwnedDirtRecovery({
    authorization: `authorize active-owned-dirt-reclaim ${"0".repeat(64)}`,
  }, { adapter }), /requires exact authorization/);
  assert.equal(began, false);
});

test("completed intent is superseded by a second exact expired recovery", async () => {
  let source = sourceFixture();
  let intent = null;
  let cloudCalls = 0;
  const adapter = createActiveOwnedDirtRecoveryControllerAdapter({
    readState: async () => ({ source, intent, ttlSeconds: 1_800 }),
    beginIntent: async ({ plan }) => { intent = baseIntent(plan); return { intent }; },
    markIntent: async ({ status, values }) => {
      intent = { ...intent, ...values, status };
      return intent;
    },
    createSnapshot: async ({ plan }) => snapshotFixture(plan),
    recoverCloud: async ({ plan }) => { cloudCalls += 1; return cloudFixture(plan); },
    projectLocal: async ({ plan, cloud }) => {
      intent = { ...intent, status: "local-cas", localProjection: {
        leaseDigest: digestValue({ plan: plan.planDigest, phase: "lease" }),
        mutationAuthorityReceiptDigest: "7".repeat(64),
        claimId: plan.sourceClaimId, claimDigest: cloud.claimDigest,
      } };
      return { intent };
    },
    projectPullRequest: async () => ({
      markerDigest: "9".repeat(64), bodyDigest: "a".repeat(64),
    }),
    finalize: async ({ plan, snapshot }) => ({
      receiptDigest: finalReceipt(plan, snapshot, intent),
    }),
  });
  const first = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  await runActiveOwnedDirtRecovery({
    authorization: `authorize active-owned-dirt-reclaim ${first.planDigest}`,
  }, { adapter });
  source = sourceFixture({ localEpoch: 5, transitionCounter: 4,
    claimDigest: "c".repeat(64), claimLedgerRevision: "d".repeat(64),
    operationReceiptDigest: "e".repeat(64),
    heartbeatAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2026-08-10T00:30:00.000Z",
    evaluatedAt: "2026-08-11T00:00:00.000Z" });
  const second = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  assert.notEqual(second.planDigest, first.planDigest);
  await runActiveOwnedDirtRecovery({
    authorization: `authorize active-owned-dirt-reclaim ${second.planDigest}`,
  }, { adapter });
  assert.equal(cloudCalls, 2);
  assert.equal(intent.status, "complete");
  assert.equal(intent.planDigest, second.planDigest);
});

function baseIntent(plan) {
  return {
    schema: "agentic-active-owned-dirt-recovery-intent/v1",
    status: "intent",
    branch: plan.sourceBranch,
    sourceLeaseDigest: plan.sourceLeaseDigest,
    sourceClaimId: plan.sourceClaimId,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    snapshot: null,
    cloud: null,
    localProjection: null,
    pullRequestProjection: null,
    finalReceiptDigest: null,
  };
}

function snapshotFixture(plan) {
  return {
    snapshotReceiptDigest: "5".repeat(64),
    snapshotRef: `refs/agentic-canvas-os/recovery/active-owned-dirt/${plan.sourceClaimId}/${plan.planDigest}`,
    commitSha: "6".repeat(40),
    indexCommitSha: "7".repeat(40),
  };
}

function cloudFixture(plan) {
  const operationReceiptDigest = "6".repeat(64);
  return {
    cloudReceiptDigest: "7".repeat(64),
    claimId: plan.sourceClaimId,
    claimDigest: "8".repeat(64),
    ledgerRevision: "9".repeat(40),
    ledgerDigest: "a".repeat(64),
    claimLedgerRevision: "b".repeat(64),
    transitionCounter: plan.sourceCloudTransitionCounter + 1,
    expiresAt: "2026-08-09T00:30:00.000Z",
    recoveredAt: "2026-08-09T00:00:00.000Z",
    operationReceiptDigest,
    authority: {
      claimId: plan.sourceClaimId,
      claimDigest: "8".repeat(64),
      leaseEpoch: plan.sourceCloudLeaseEpoch,
      transitionCounter: plan.sourceCloudTransitionCounter + 1,
      operationReceiptDigest,
    },
    mutationAuthorityReceiptDigest: "9".repeat(64),
  };
}

function finalReceipt(plan, snapshot, intent) {
  return buildActiveOwnedDirtRecoveryReceipt({ phase: "complete", plan, values: {
    snapshotReceiptDigest: snapshot.snapshotReceiptDigest,
    recoveredLeaseDigest: intent.localProjection.leaseDigest,
    markerDigest: intent.pullRequestProjection.markerDigest,
    mutationAuthorityReceiptDigest: intent.localProjection.mutationAuthorityReceiptDigest,
  } }).receiptDigest;
}

function sourceFixture({ localEpoch = 4, transitionCounter = 3,
  claimDigest = "5".repeat(64), claimLedgerRevision = "9".repeat(64),
  operationReceiptDigest = "4".repeat(64),
  heartbeatAt = "2026-08-08T00:00:00.000Z",
  expiresAt = "2026-08-08T00:30:00.000Z",
  evaluatedAt = "2026-08-09T00:00:00.000Z" } = {}) {
  const declaredWriteSet = ["path:src/runtime.mjs", "semantic:recovery"];
  const writeSetDigest = digestValue(declaredWriteSet);
  const evidenceCore = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: "b".repeat(40),
    entries: [{
      path: "src/runtime.mjs", staged: false, unstaged: true, untracked: false,
      headMode: "100644", headBlob: "1".repeat(40),
      indexMode: "100644", indexBlob: "1".repeat(40),
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: "2".repeat(40),
    }],
    pathCount: 1,
    stagedPathCount: 0,
    unstagedPathCount: 1,
    untrackedPathCount: 0,
  };
  const evidence = { ...evidenceCore, evidenceDigest: digestValue(evidenceCore) };
  const expectedMarker = { marker: true };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: localEpoch,
    sessionId: "source", device: "device", scope: "recovery",
    branch: "agent/device/recovery", worktreePath: "/worktree",
    baseSha: "a".repeat(40), fenceSha: evidence.headSha,
    pullRequestUrl: "https://github.test/org/repo/pull/1",
    heartbeatAt, expiresAt,
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet, writeSetDigest, manifestDigest: "3".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1", state: "active",
      claimId: null, claimDigest,
      claimLedgerRevision, transitionCounter, leaseEpoch: 3,
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest,
      deviceId: "device", sessionId: "source", reviewRequestId: null,
      targetRepository: "org/repo",
    },
  };
  const actorId = "github-user:1";
  const repositoryId = "github-repository:R";
  const workItemId = `work-item:${"f".repeat(64)}`;
  lease.cloudAuthority.claimId = digestValue({ actorId,
    canonicalBaseRevision: lease.baseSha, leaseEpoch: lease.cloudAuthority.leaseEpoch,
    repositoryId, workItemId, writeSetDigest });
  return {
    sessionId: lease.sessionId, branch: lease.branch, lease,
    leaseDigest: "6".repeat(64), headSha: lease.fenceSha,
    remoteHeadSha: lease.fenceSha, remoteMainSha: "d".repeat(40),
    pullRequest: {
      id: "PR_source", url: lease.pullRequestUrl,
      state: "OPEN", isDraft: true, headRefName: lease.branch,
      headRefOid: lease.fenceSha, baseRefName: "main",
      baseRefOid: "c".repeat(40),
      headRepository: { nameWithOwner: "org/repo" }, autoMergeRequest: null,
    },
    pullRequestBodyDigest: "7".repeat(64), markerDigest: digestValue(expectedMarker),
    expectedMarker, worktreeIdentityDigest: "8".repeat(64),
    claim: {
      claimId: lease.cloudAuthority.claimId, fenceRevision: lease.cloudAuthority.claimDigest,
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      actorId, repositoryId, workItemId,
      transitionDigest: claimLedgerRevision, transitionCounter, leaseEpoch: 3,
      state: "dormant-preserved", canonicalBaseRevision: lease.baseSha,
      laneRevision: lease.fenceSha, writeSetDigest, declaredWriteScope: declaredWriteSet,
      reviewRequestId: lease.cloudAuthority.reviewRequestId,
      operationReceiptDigest: lease.cloudAuthority.operationReceiptDigest,
    },
    overlappingClaims: [], ledgerRevision: "a".repeat(40), ledgerDigest: "b".repeat(64),
    evidence,
    protectedMainAdvance: {
      schema: "agentic-active-owned-dirt-protected-main-advance/v1",
      baseSha: lease.baseSha, pullRequestBaseSha: "c".repeat(40),
      protectedMainSha: "d".repeat(40), protectedMainTreeSha: "e".repeat(40),
      declaredWriteSetDigest: writeSetDigest, changedPathCount: 1,
      changedPathsDigest: digestValue(["docs/unrelated.md"]),
    },
    evaluatedAt,
  };
}
