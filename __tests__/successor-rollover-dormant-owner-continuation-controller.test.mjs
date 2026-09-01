import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceDormantOwnerContinuationJournal,
  buildDormantOwnerContinuationPlan,
  createDormantOwnerContinuationJournal,
}
  from "../scripts/successor-rollover-dormant-owner-continuation-contract.mjs";
import { createDormantOwnerContinuationController }
  from "../scripts/successor-rollover-dormant-owner-continuation-controller.mjs";

test("orders task proof, same-claim recovery, local CAS, PR marker, and verification", async () => {
  const evidence = fixtureEvidence();
  const plan = buildDormantOwnerContinuationPlan({ evidence });
  const calls = [];
  let stored = null;
  const journalStore = {
    read: () => stored,
    write(value, expected) {
      assert.equal(stored?.journalDigest ?? null, expected);
      stored = value;
      return value;
    },
  };
  const cloudRecovery = {
    authority: { claimId: plan.claimId, claimDigest: d("renewed claim") },
    claimDigest: d("renewed claim"), receiptDigest: d("cloud"),
    expiresAt: "2026-09-01T00:00:00.000Z",
  };
  let verificationCount = 0;
  const adapter = {
    captureEvidence: async () => evidence,
    authorizeTaskAuthority: async () => (calls.push("task"), { receiptDigest: d("task") }),
    recoverCloudAuthority: async () => (calls.push("cloud"), cloudRecovery),
    projectLocalLease: async input => {
      calls.push("local");
      assert.equal(input.cloudRecovery, cloudRecovery);
      return { leaseDigest: d("lease target"), registryRevision: 10,
        taskAuthorityBindingDigest: d("binding target") };
    },
    projectPullRequestMarker: async () => (calls.push("pr"), {
      bodyDigest: d("body target"), markerDigest: d("marker target"),
    }),
    verifyCompletion: async () => (calls.push("verify"), {
      claimDigest: d("renewed claim"), leaseDigest: d("lease target"),
      markerDigest: d("marker target"),
      verificationDigest: d(`verified ${verificationCount += 1}`),
    }),
  };
  const controller = createDormantOwnerContinuationController({ adapter, journalStore });
  const result = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(result.status, "authoring-authority-restored");
  assert.deepEqual(calls, ["task", "cloud", "local", "pr", "verify"]);

  calls.length = 0;
  const replay = await controller.run({ plan, authorization: "not-consumed-on-replay" });
  assert.equal(replay.resultDigest, result.resultDigest);
  assert.deepEqual(calls, ["verify"]);
});

test("adopts provider response loss from the task-authority phase", async () => {
  const evidence = fixtureEvidence();
  const plan = buildDormantOwnerContinuationPlan({ evidence });
  let stored = createDormantOwnerContinuationJournal(plan, plan.exactAuthorization);
  stored = advanceDormantOwnerContinuationJournal(stored, "task-authority-verified", {
    taskAuthorityReceiptDigest: d("task"),
  });
  const cloudRecovery = {
    authority: { claimId: plan.claimId, claimDigest: d("renewed claim") },
    claimDigest: d("renewed claim"), receiptDigest: d("cloud"),
    expiresAt: "2026-09-01T00:00:00.000Z",
  };
  const calls = [];
  const controller = createDormantOwnerContinuationController({
    adapter: {
      captureEvidence: async () => assert.fail("must use phase-specific static evidence"),
      authorizeTaskAuthority: async () => assert.fail("must not re-authorize"),
      recoverCloudAuthority: async () => (calls.push("cloud-adopt"), cloudRecovery),
      projectLocalLease: async ({ cloudRecovery: observed }) => {
        calls.push("local");
        assert.equal(observed, cloudRecovery);
        return { leaseDigest: d("lease target"), registryRevision: 10,
          taskAuthorityBindingDigest: d("binding target") };
      },
      projectPullRequestMarker: async () => (calls.push("pr"), {
        bodyDigest: d("body target"), markerDigest: d("marker target"),
      }),
      verifyCompletion: async () => (calls.push("verify"), {
        claimDigest: d("renewed claim"), leaseDigest: d("lease target"),
        markerDigest: d("marker target"), verificationDigest: d("verified"),
      }),
    },
    journalStore: {
      read: () => stored,
      async write(value, expected) {
        assert.equal(stored.journalDigest, expected);
        stored = value;
        return value;
      },
    },
  });
  const result = await controller.run({ plan, authorization: "already-authorized" });
  assert.equal(result.status, "authoring-authority-restored");
  assert.deepEqual(calls, ["cloud-adopt", "local", "pr", "verify"]);
});

test("resumes after cloud recovery without recapturing dormant evidence or repeating cloud effects", async () => {
  const evidence = fixtureEvidence();
  const plan = buildDormantOwnerContinuationPlan({ evidence });
  let stored = createDormantOwnerContinuationJournal(plan, plan.exactAuthorization);
  stored = advanceDormantOwnerContinuationJournal(stored, "task-authority-verified", {
    taskAuthorityReceiptDigest: d("task"),
  });
  stored = advanceDormantOwnerContinuationJournal(stored, "cloud-recovered", {
    claimDigest: d("renewed claim"), cloudReceiptDigest: d("cloud"),
    expiresAt: "2026-09-01T00:00:00.000Z",
  });
  const calls = [];
  const controller = createDormantOwnerContinuationController({
    adapter: {
      captureEvidence: async () => assert.fail("must not recapture dormant evidence"),
      authorizeTaskAuthority: async () => assert.fail("must not re-authorize"),
      recoverCloudAuthority: async () => assert.fail("must not repeat cloud recovery"),
      projectLocalLease: async ({ cloudRecovery }) => {
        calls.push("local");
        assert.equal(cloudRecovery, null);
        return { leaseDigest: d("lease target"), registryRevision: 10,
          taskAuthorityBindingDigest: d("binding target") };
      },
      projectPullRequestMarker: async () => (calls.push("pr"), {
        bodyDigest: d("body target"), markerDigest: d("marker target"),
      }),
      verifyCompletion: async () => (calls.push("verify"), {
        claimDigest: d("renewed claim"), leaseDigest: d("lease target"),
        markerDigest: d("marker target"), verificationDigest: d("verified"),
      }),
    },
    journalStore: {
      read: () => stored,
      write(value, expected) {
        assert.equal(stored.journalDigest, expected);
        stored = value;
        return value;
      },
    },
  });
  const result = await controller.run({ plan, authorization: "already-authorized" });
  assert.equal(result.status, "authoring-authority-restored");
  assert.deepEqual(calls, ["local", "pr", "verify"]);
});

test("reverifies a journal that restarts from the verified phase", async () => {
  const evidence = fixtureEvidence();
  const plan = buildDormantOwnerContinuationPlan({ evidence });
  let stored = createDormantOwnerContinuationJournal(plan, plan.exactAuthorization);
  stored = advanceDormantOwnerContinuationJournal(stored, "task-authority-verified", {
    taskAuthorityReceiptDigest: d("task"),
  });
  stored = advanceDormantOwnerContinuationJournal(stored, "cloud-recovered", {
    claimDigest: d("renewed claim"), cloudReceiptDigest: d("cloud"),
    expiresAt: "2026-09-01T00:00:00.000Z",
  });
  stored = advanceDormantOwnerContinuationJournal(stored, "local-cas", {
    leaseDigest: d("lease target"), registryRevision: 10,
    taskAuthorityBindingDigest: d("binding target"),
  });
  stored = advanceDormantOwnerContinuationJournal(stored, "pr-marker", {
    bodyDigest: d("body target"), pullRequestMarkerDigest: d("marker target"),
  });
  stored = advanceDormantOwnerContinuationJournal(stored, "verified", {
    claimDigest: d("renewed claim"), leaseDigest: d("lease target"),
    pullRequestMarkerDigest: d("marker target"), verificationDigest: d("old verification"),
  });
  const calls = [];
  let freshVerificationDigest = null;
  const fail = async () => assert.fail("verified restart must only reverify");
  const controller = createDormantOwnerContinuationController({
    adapter: {
      captureEvidence: fail, authorizeTaskAuthority: fail, recoverCloudAuthority: fail,
      projectLocalLease: fail, projectPullRequestMarker: fail,
      verifyCompletion: async () => (calls.push("verify"), {
        claimDigest: d("renewed claim"), leaseDigest: d("lease target"),
        markerDigest: d("marker target"),
        ...(freshVerificationDigest ? { verificationDigest: freshVerificationDigest } : {}),
      }),
    },
    journalStore: {
      read: () => stored,
      async write(value, expected) {
        assert.equal(stored.journalDigest, expected);
        stored = value;
        return value;
      },
    },
  });
  await assert.rejects(
    controller.run({ plan, authorization: "already-authorized" }),
    /completion verification digest/u,
  );
  assert.equal(stored.phase, "verified");
  freshVerificationDigest = d("fresh verification");
  const result = await controller.run({ plan, authorization: "already-authorized" });
  assert.equal(result.status, "authoring-authority-restored");
  assert.deepEqual(calls, ["verify", "verify"]);
  assert.equal(stored.phase, "complete");
});

test("fails before authority when live evidence changes", async () => {
  const evidence = fixtureEvidence();
  const plan = buildDormantOwnerContinuationPlan({ evidence });
  const changed = structuredClone(evidence);
  changed.pullRequest.markerDigest = d("changed marker");
  const { evidenceDigest: ignored, ...core } = changed;
  void ignored;
  changed.evidenceDigest = digestValue(core);
  let called = false;
  const adapter = Object.fromEntries([
    "authorizeTaskAuthority", "recoverCloudAuthority", "projectLocalLease",
    "projectPullRequestMarker", "verifyCompletion",
  ].map(name => [name, async () => { called = true; throw new Error(name); }]));
  adapter.captureEvidence = async () => changed;
  const controller = createDormantOwnerContinuationController({
    adapter,
    journalStore: { read: () => null, write: () => assert.fail("must not persist") },
  });
  await assert.rejects(
    controller.run({ plan, authorization: plan.exactAuthorization }),
    /live evidence drift/u,
  );
  assert.equal(called, false);
});

function fixtureEvidence() {
  const claimId = d("claim"), writeSetDigest = d("write set"), fenceSha = s("fence");
  const core = {
    schema: "agentic-successor-rollover-dormant-owner-continuation-evidence/v1",
    repository: "/repository", controllerRoot: "/controller",
    source: { branch: "agent/device/scope", sessionId: "session", worktreePath: "/repository",
      leaseDigest: d("lease"), claimId, claimDigest: d("claim digest"), transitionCounter: 2,
      localEpoch: 7, cloudLeaseEpoch: 1, baseSha: s("base"), fenceSha,
      writeSetDigest, manifestDigest: d("manifest"), reviewRequestId: "PR_test",
      taskAuthorityBindingDigest: d("binding"), expiresAt: "2026-01-01T00:00:00.000Z" },
    rollover: { continuationPlanDigest: d("continuation"), rolloverJournalDigest: d("rollover journal"),
      replacementPlanDigest: d("replacement"), historicalBindProofDigest: d("history"),
      tombstoneDigest: d("tombstone"), tombstoneReceiptDigest: d("tombstone receipt") },
    promotion: { journalDigest: d("promotion journal"), resultDigest: d("promotion result"),
      bridgeClaimId: d("bridge"), successorClaimId: d("successor") },
    pullRequest: { id: "PR_test", number: 808, url: "https://github.com/o/r/pull/808",
      state: "OPEN", isDraft: true, autoMergeRequest: null, headBranch: "agent/device/scope",
      headSha: fenceSha, baseSha: s("pr base"), etag: "\"etag\"", bodyDigest: d("body"),
      bodyRemainderDigest: d("remainder"), markerDigest: d("marker"), markerClaimId: claimId },
    dirt: { evidenceDigest: d("dirt") }, controller: { evidenceDigest: d("controller") },
    cloud: { topologyDigest: d("topology"), anchorClaimId: claimId, anchorWriteSetDigest: writeSetDigest },
    registryRevision: 9, observedAt: "2026-08-31T00:00:00.000Z",
  };
  return { ...core, evidenceDigest: digestValue(core) };
}
function d(value) { return digestValue({ value }); }
function s(value) { return d(value).slice(0, 40); }
