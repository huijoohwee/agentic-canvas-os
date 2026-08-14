import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createRecoverableLaneCleanupController,
} from "../scripts/recoverable-lane-cleanup-controller.mjs";
import { RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA } from "../scripts/recoverable-lane-cleanup-contract.mjs";
import { GENERATED_RESIDUE_SCHEMA } from "../scripts/recoverable-lane-cleanup-generated-residue.mjs";

test("controller plans with two stable read-only captures", () => {
  const harness = fakeAdapter();
  const result = harness.controller.plan(input());
  assert.equal(result.status, "planned");
  assert.equal(harness.calls.filter(call => call === "capture").length, 2);
  assert.equal(harness.intent, null);
  assert.equal(harness.removals, 0);
});

test("controller persists intent and verifies recovery before exact removal", () => {
  const harness = fakeAdapter();
  const planned = harness.controller.plan(input());
  const result = harness.controller.run({
    ...input(),
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  });
  assert.equal(result.status, "complete");
  assert.equal(harness.removals, 1);
  assert.equal(harness.target.present, false);
  const prepared = harness.calls.indexOf("write-intent:prepared");
  const bundle = harness.calls.indexOf("ensure-bundle");
  const removed = harness.calls.indexOf("remove-worktree");
  assert.ok(prepared >= 0 && prepared < bundle && bundle < removed);
  assert.equal(result.receipt.effects.localBranch, "preserve");
  assert.equal(result.receipt.effects.worktreeSnapshot, "preserve");
  assert.equal(result.receipt.effects.gitDirectorySnapshot, "preserve");
  assert.equal(result.receipt.effects.remoteRefs, "preserve");
});

test("controller rejects wrong authorization before intent, bundle, or removal", () => {
  const harness = fakeAdapter();
  const planned = harness.controller.plan(input());
  assert.throws(() => harness.controller.run({
    ...input(),
    planDigest: planned.planDigest,
    authorization: "authorize something else",
  }), /requires exact authorization/);
  assert.equal(harness.intent, null);
  assert.equal(harness.removals, 0);
  assert.equal(harness.calls.includes("ensure-bundle"), false);
});

test("controller replays a completed or partially removed target exactly once", () => {
  const harness = fakeAdapter();
  const planned = harness.controller.plan(input());
  const request = {
    ...input(), planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  };
  const first = harness.controller.run(request);
  const second = harness.controller.run(request);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(harness.removals, 1);
  const observed = harness.controller.observe({ ...input(), planDigest: planned.planDigest });
  assert.equal(observed.status, "complete");
});

test("controller reconciles a lost removal response without repeating the effect", () => {
  const harness = fakeAdapter({ failAfterRemovalOnce: true });
  const planned = harness.controller.plan(input());
  const request = {
    ...input(), planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  };
  assert.throws(() => harness.controller.run(request), /lost removal response/);
  assert.equal(harness.removals, 1);
  assert.equal(harness.intent.status, "worktree_quarantined");
  const replay = harness.controller.run(request);
  assert.equal(replay.status, "complete");
  assert.equal(harness.removals, 1);
  assert.equal(replay.intent.phases.worktree_removed.replayedAbsentRegistration, true);
});

test("stored intent and observation require the exact bound inputs", () => {
  const harness = fakeAdapter();
  const planned = harness.controller.plan(input());
  const request = {
    ...input(), planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  };
  harness.controller.run(request);
  assert.throws(() => harness.controller.run({
    ...request, worktree: "/tasks/different",
  }), /worktree differs/);
  assert.throws(() => harness.controller.run({
    ...request, sessionId: "different-session",
  }), /sessionId differs/);
  assert.throws(() => harness.controller.observe({
    ...input(), recoveryDirectory: "/recovery/different", planDigest: planned.planDigest,
  }), /recoveryDirectory differs/);
});

test("completed replay and observation fail closed on recreated or drifted final state", () => {
  const recreated = fakeAdapter();
  const planned = recreated.controller.plan(input());
  const request = {
    ...input(), planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  };
  recreated.controller.run(request);
  recreated.target.present = true;
  assert.throws(() => recreated.controller.run(request), /recreated|drifted/);
  assert.throws(() => recreated.controller.observe({
    ...input(), planDigest: planned.planDigest,
  }), /recreated|drifted/);

  const branchDrift = fakeAdapter();
  const branchPlan = branchDrift.controller.plan(input());
  const branchRequest = {
    ...input(), planDigest: branchPlan.planDigest, authorization: branchPlan.exactAuthorization,
  };
  branchDrift.controller.run(branchRequest);
  branchDrift.finalBranchHead = "f".repeat(40);
  assert.throws(() => branchDrift.controller.run(branchRequest), /drifted/);

  const snapshotDrift = fakeAdapter();
  const snapshotPlan = snapshotDrift.controller.plan(input());
  const snapshotRequest = {
    ...input(), planDigest: snapshotPlan.planDigest,
    authorization: snapshotPlan.exactAuthorization,
  };
  snapshotDrift.controller.run(snapshotRequest);
  snapshotDrift.snapshotDigest = "6".repeat(64);
  assert.throws(() => snapshotDrift.controller.run(snapshotRequest), /snapshot|drifted/);
  assert.throws(() => snapshotDrift.controller.observe({
    ...input(), planDigest: snapshotPlan.planDigest,
  }), /snapshot|drifted/);
});

test("controller fails closed on evidence drift or bundle failure", () => {
  const drifting = fakeAdapter({ driftCapture: 2 });
  assert.throws(() => drifting.controller.plan(input()), /changed between consecutive/);

  const failing = fakeAdapter({ failBundle: true });
  const planned = failing.controller.plan(input());
  assert.throws(() => failing.controller.run({
    ...input(), planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  }), /bundle verification failed/);
  assert.equal(failing.removals, 0);
  assert.equal(failing.intent.status, "prepared");
});

test("controller terminalizes restored drift after abort response loss and expiry", () => {
  const state = fakeAdapter({ generatedDrift: true, failAfterAbortOnce: true });
  const planned = state.controller.plan(input());
  const request = { ...input(), planDigest: planned.planDigest,
    authorization: planned.exactAuthorization };
  assert.throws(() => state.controller.run(request), /lost abort response/);
  assert.equal(state.intent.status, "drift_aborting");
  assert.equal(state.reservation, null);
  assert.equal(state.removals, 0);
  state.reservationExpired = true;
  const completed = state.controller.run(request);
  assert.equal(completed.status, "drift_aborted");
  assert.equal(state.controller.run(request).status, "drift_aborted");
  assert.equal(state.removals, 0);
  state.restoredDrift = true;
  assert.throws(() => state.controller.run(request), /restored target changed/);
  state.restoredDrift = false;
  state.priorLeaseRestored = false;
  assert.throws(() => state.controller.run(request), /reservation is not exactly released/);
});

function fakeAdapter({
  driftCapture = 0, failBundle = false, failAfterRemovalOnce = false,
  generatedDrift = false, failAfterAbortOnce = false,
} = {}) {
  const stableEvidence = evidence();
  const state = {
    calls: [],
    captures: 0,
    intent: null,
    receipt: null,
    removals: 0,
    target: { present: true },
    staging: { registered: false, present: false },
    snapshotPresent: false,
    snapshotDigest: null,
    snapshotGenerationDigest: null,
    gitDirSnapshotPresent: false,
    gitDirSnapshotDigest: null,
    gitDirSnapshotGenerationDigest: null,
    disposableGitDirPresent: false,
    reservation: null,
    priorLeaseRestored: true,
    finalBranchHead: null,
    aborts: 0,
  };
  const adapter = {
    captureEvidence() {
      state.calls.push("capture");
      state.captures += 1;
      if (state.captures === driftCapture) {
        return evidence({ targetHead: "e".repeat(40) });
      }
      return stableEvidence;
    },
    withSubjectFence(_plan, action) {
      state.calls.push("fence");
      return action();
    },
    readIntent() { return state.intent; },
    writeIntent(expected, next) {
      assert.deepEqual(state.intent, expected);
      state.intent = structuredClone(next);
      state.calls.push(`write-intent:${next.status}`);
      return state.intent;
    },
    ensureBundle(plan) {
      state.calls.push("ensure-bundle");
      return bundle(plan);
    },
    verifyBundle() {
      state.calls.push("verify-bundle");
      if (failBundle) throw new Error("bundle verification failed");
    },
    inspectReservation() { return state.reservation; },
    beginReservation() {
      state.calls.push("begin-reservation");
      state.priorLeaseRestored = false;
      state.reservation = {
        schema: "agentic-recoverable-lane-cleanup-reservation/v1",
        branch: "agent/device/lane-a", epoch: 1, sessionId: "cleanup-session",
        reservationDigest: "9".repeat(64),
      };
      return state.reservation;
    },
    inspectCleanupState() {
      return {
        targetRegistered: state.target.present,
        targetExists: state.target.present,
        stagingRegistered: state.staging.registered,
        stagingExists: state.staging.present,
        snapshotExists: state.snapshotPresent,
        snapshotDigest: state.snapshotDigest,
        snapshotGenerationDigest: state.snapshotGenerationDigest,
        gitDirSnapshotExists: state.gitDirSnapshotPresent,
        gitDirSnapshotDigest: state.gitDirSnapshotDigest,
        gitDirSnapshotGenerationDigest: state.gitDirSnapshotGenerationDigest,
        disposableGitDirExists: state.disposableGitDirPresent,
      };
    },
    quarantineWorktree(_plan, reservation) {
      state.calls.push("quarantine-worktree");
      assert.deepEqual(reservation, state.reservation);
      if (generatedDrift) {
        const error = new Error("generated residue drifted");
        error.code = "RECOVERABLE_GENERATED_RESIDUE_DRIFT";
        throw error;
      }
      state.target.present = false;
      state.staging.registered = true;
      state.staging.present = false;
      state.snapshotPresent = true;
      state.snapshotDigest = "5".repeat(64);
      state.snapshotGenerationDigest = "6".repeat(64);
      state.gitDirSnapshotPresent = true;
      state.gitDirSnapshotDigest = "7".repeat(64);
      state.gitDirSnapshotGenerationDigest = "8".repeat(64);
      state.disposableGitDirPresent = true;
      return {
        targetRegistered: false, targetExists: false,
        stagingRegistered: true, stagingExists: false, snapshotExists: true,
        snapshotDigest: state.snapshotDigest,
        snapshotGenerationDigest: state.snapshotGenerationDigest,
        gitDirSnapshotExists: true,
        gitDirSnapshotDigest: state.gitDirSnapshotDigest,
        gitDirSnapshotGenerationDigest: state.gitDirSnapshotGenerationDigest,
        disposableGitDirExists: true,
        disposableGitDirDigest: "8".repeat(64),
        disposableGitDirGenerationDigest: "9".repeat(64),
      };
    },
    removeWorktree(_plan, reservation, expected) {
      state.calls.push("remove-worktree");
      assert.deepEqual(reservation, state.reservation);
      assert.equal(expected.snapshotDigest, state.snapshotDigest);
      state.target.present = false;
      const replayedAbsentRegistration = !state.staging.registered;
      if (state.staging.registered) {
        state.staging.registered = false;
        state.disposableGitDirPresent = false;
        state.removals += 1;
        if (failAfterRemovalOnce && state.removals === 1) {
          throw new Error("lost removal response");
        }
      }
      return {
        targetRegistered: false, targetExists: false,
        stagingRegistered: false, stagingExists: false, snapshotExists: true,
        snapshotDigest: state.snapshotDigest,
        snapshotGenerationDigest: state.snapshotGenerationDigest,
        gitDirSnapshotExists: true,
        gitDirSnapshotDigest: state.gitDirSnapshotDigest,
        gitDirSnapshotGenerationDigest: state.gitDirSnapshotGenerationDigest,
        disposableGitDirExists: false,
        replayedAbsentRegistration,
      };
    },
    releaseReservation(plan, reservation) {
      assert.deepEqual(reservation, state.reservation);
      const core = {
        schema: "agentic-recoverable-lane-cleanup-reservation-release/v1",
        planDigest: plan.planDigest, priorLeaseDigest: null,
      };
      state.reservation = null;
      state.priorLeaseRestored = true;
      state.calls.push("release-reservation");
      return { ...core, receiptDigest: digestValue(core) };
    },
    observeRestored(plan) {
      return { restoredStateDigest: digestValue({ planDigest: plan.planDigest,
        restored: !state.restoredDrift }) };
    },
    abortReservation(plan, reservation, restoredStateDigest) {
      const core = { schema: "agentic-recoverable-lane-cleanup-drift-abort/v1",
        planDigest: plan.planDigest, reservationDigest: reservation.reservationDigest,
        restoredStateDigest };
      state.reservation = null;
      state.priorLeaseRestored = true;
      state.aborts += 1;
      if (failAfterAbortOnce && state.aborts === 1) throw new Error("lost abort response");
      return { ...core, receiptDigest: digestValue(core) };
    },
    observeAbortRelease(plan, reservation, restoredStateDigest) {
      if (!state.priorLeaseRestored) throw new Error("reservation is not exactly released");
      const core = { schema: "agentic-recoverable-lane-cleanup-drift-abort/v1",
        planDigest: plan.planDigest, reservationDigest: reservation.reservationDigest,
        restoredStateDigest };
      return { ...core, receiptDigest: digestValue(core) };
    },
    observeFinal(plan) {
      return {
        targetRegistered: state.target.present,
        targetExists: state.target.present,
        stagingRegistered: state.staging.registered,
        stagingExists: state.staging.present,
        snapshotExists: state.snapshotPresent,
        snapshotDigest: state.snapshotDigest,
        snapshotGenerationDigest: state.snapshotGenerationDigest,
        gitDirSnapshotExists: state.gitDirSnapshotPresent,
        gitDirSnapshotDigest: state.gitDirSnapshotDigest,
        gitDirSnapshotGenerationDigest: state.gitDirSnapshotGenerationDigest,
        disposableGitDirExists: state.disposableGitDirPresent,
        priorLeaseRestored: state.priorLeaseRestored,
        canonicalHeadSha: plan.evidence.canonical.headSha,
        branchHeadSha: state.finalBranchHead || plan.evidence.target.branchHeadSha,
        remoteBranchSha: plan.evidence.remoteBranch.sha,
      };
    },
    readReceipt() { return state.receipt; },
    writeReceipt(next) {
      state.receipt = structuredClone(next);
      state.calls.push("write-receipt");
      return state.receipt;
    },
  };
  state.controller = createRecoverableLaneCleanupController({ adapter });
  return state;
}

function input() {
  return {
    repository: "/repo",
    worktree: "/tasks/lane-a",
    recoveryDirectory: "/recovery/lane-a",
    sessionId: "session-cleanup",
    operatorDecisionDigest: "7".repeat(64),
    supersededPreservationDigests: [],
  };
}

function evidence({ targetHead = "c".repeat(40) } = {}) {
  const authorityCore = {
    lifecycleState: "review-required",
    leaseStatus: null,
    currentLocalWriter: false,
    disposition: "unowned-terminal",
    priorLease: null,
    priorLeaseDigest: null,
    preservationReceiptDigests: [],
    remoteAuthority: remoteAuthority(),
  };
  const core = {
    schema: RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
    repository: { root: "/repo", gitCommonDir: "/repo/.git", identityDigest: "1".repeat(64) },
    canonical: {
      worktreePath: "/repo", headSha: "a".repeat(40), treeSha: "b".repeat(40),
      originMainSha: "a".repeat(40), remoteMainSha: "a".repeat(40), clean: true,
    },
    target: {
      worktreePath: "/tasks/lane-a", branch: "refs/heads/agent/device/lane-a",
      headSha: targetHead, branchHeadSha: targetHead, treeSha: "d".repeat(40), clean: true,
      worktreeGenerationDigest: "3".repeat(64),
      gitDir: "/repo/.git/worktrees/lane-a", gitDirIdentityDigest: "4".repeat(64),
      gitDirGenerationDigest: "5".repeat(64),
      generatedResidue: generatedResidue(),
      unmergedEntries: 0, operationMarkers: [], stateDigest: "2".repeat(64),
    },
    authority: { ...authorityCore, authorityDigest: digestValue(authorityCore) },
    remoteBranch: { ref: "refs/heads/agent/device/lane-a", sha: targetHead },
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function generatedResidue() {
  const core = {
    schema: GENERATED_RESIDUE_SCHEMA, mode: "none", roots: [], ignoredPathCount: 0,
    ignoredPathsDigest: digestValue([]), entryCount: 0, totalBytes: 0,
    inventoryDigest: digestValue([]), checkoutEntryCount: 2,
    checkoutInventoryDigest: "6".repeat(64),
  };
  return { ...core, profileDigest: digestValue(core) };
}

function bundle(plan) {
  return {
    path: plan.recovery.bundlePath,
    sha256: "3".repeat(64),
    sizeBytes: 42,
    headSha: plan.evidence.target.headSha,
    treeSha: plan.evidence.target.treeSha,
    headRef: plan.evidence.target.branch,
    complete: true,
  };
}

function remoteAuthority() {
  const core = {
    provider: "neutral-test", ledgerRepository: "owner/repo",
    targetRepository: "owner/repo", targetClaims: [],
    currentRemoteWriter: false, waitingSuccessors: 0,
  };
  return { ...core, verificationReceiptDigest: digestValue(core) };
}
