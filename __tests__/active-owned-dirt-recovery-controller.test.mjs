import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildActiveOwnedDirtRecoveryPlan,
} from "../scripts/active-owned-dirt-recovery-contract.mjs";
import {
  createActiveOwnedDirtRecoveryControllerAdapter,
  createRepositoryActiveOwnedDirtRecoveryAdapter,
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

test("controller orders durable snapshot before cloud and replays every phase once", async () => {
  const source = sourceFixture();
  const plan = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  const calls = [];
  let intent = null;
  let finalReceiptDigest = "b".repeat(64);
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
    recoverCloud: async () => {
      calls.push("cloud");
      assert.ok(calls.indexOf("snapshot") < calls.indexOf("cloud"));
      return cloudFixture();
    },
    projectLocal: async () => {
      calls.push("local-cas");
      intent = {
        ...intent,
        status: "local-cas",
        localProjection: {
          leaseDigest: "8".repeat(64),
          mutationAuthorityReceiptDigest: "7".repeat(64),
        },
      };
      return { intent };
    },
    projectPullRequest: async () => {
      calls.push("pr-marker");
      return { markerDigest: "9".repeat(64), bodyDigest: "a".repeat(64) };
    },
    finalize: async () => {
      calls.push("complete");
      return { receiptDigest: finalReceiptDigest };
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
  finalReceiptDigest = "c".repeat(64);
  await assert.rejects(() => runActiveOwnedDirtRecovery({}, { adapter }), /live verification drifted/);
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
    recoverCloud: async () => {
      cloudCalls += 1;
      if (cloudCalls === 1) throw new Error("lost cloud response after mutation");
      return cloudFixture();
    },
    projectLocal: async () => {
      localCalls += 1;
      intent = {
        ...intent,
        status: "local-cas",
        localProjection: {
          leaseDigest: "8".repeat(64),
          mutationAuthorityReceiptDigest: "7".repeat(64),
        },
      };
      throw new Error("lost local CAS response");
    },
    projectPullRequest: async () => ({
      markerDigest: "9".repeat(64), bodyDigest: "a".repeat(64),
    }),
    finalize: async () => ({ receiptDigest: "b".repeat(64) }),
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

function cloudFixture() {
  return {
    cloudReceiptDigest: "7".repeat(64),
    claimDigest: "8".repeat(64),
    mutationAuthorityReceiptDigest: "9".repeat(64),
  };
}

function sourceFixture() {
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
    schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "source", device: "device", scope: "recovery",
    branch: "agent/device/recovery", worktreePath: "/worktree",
    baseSha: "a".repeat(40), fenceSha: evidence.headSha,
    pullRequestUrl: "https://github.test/org/repo/pull/1",
    heartbeatAt: "2026-08-08T00:00:00.000Z",
    expiresAt: "2026-08-08T00:30:00.000Z",
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet, writeSetDigest, manifestDigest: "3".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1", state: "active",
      claimId: "4".repeat(64), claimDigest: "5".repeat(64),
      claimLedgerRevision: "9".repeat(64), transitionCounter: 3, leaseEpoch: 1,
      deviceId: "device", sessionId: "source", reviewRequestId: "github-pull-request:1",
    },
  };
  return {
    sessionId: lease.sessionId, branch: lease.branch, lease,
    leaseDigest: "6".repeat(64), headSha: lease.fenceSha,
    remoteHeadSha: lease.fenceSha, remoteMainSha: lease.baseSha,
    pullRequest: {
      state: "OPEN", isDraft: true, headRefName: lease.branch,
      headRefOid: lease.fenceSha, baseRefName: "main",
      baseRefOid: lease.baseSha,
    },
    pullRequestBodyDigest: "7".repeat(64), markerDigest: digestValue(expectedMarker),
    expectedMarker, worktreeIdentityDigest: "8".repeat(64),
    claim: {
      claimId: lease.cloudAuthority.claimId, fenceRevision: lease.cloudAuthority.claimDigest,
      transitionDigest: "9".repeat(64), transitionCounter: 3, leaseEpoch: 1,
      state: "dormant-preserved", canonicalBaseRevision: lease.baseSha,
      laneRevision: lease.fenceSha, writeSetDigest, declaredWriteScope: declaredWriteSet,
      reviewRequestId: lease.cloudAuthority.reviewRequestId,
      deviceId: lease.device, sessionId: lease.sessionId,
    },
    overlappingClaims: [], ledgerRevision: "a".repeat(40), ledgerDigest: "b".repeat(64),
    evidence, evaluatedAt: "2026-08-09T00:00:00.000Z",
  };
}
