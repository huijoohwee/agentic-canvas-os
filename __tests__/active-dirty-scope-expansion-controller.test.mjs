import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveDirtyScopeExpansionPlan,
} from "../scripts/active-dirty-scope-expansion-contract.mjs";
import {
  createActiveDirtyScopeExpansionControllerAdapter,
  runActiveDirtyScopeExpansion,
} from "../scripts/active-dirty-scope-expansion-controller.mjs";
import {
  activeDirtyScopeExpansionCliMain,
  buildCompletedScopeExpansionReplay,
  prepareActiveDirtyScopeExpansion,
  rolloverRepositoryScopeExpansionIntent,
} from "../scripts/active-dirty-scope-expansion.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { proveLegacyReviewCanonicalDescendant }
  from "../scripts/legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const BASE = "a".repeat(40);
const FENCE = "b".repeat(40);
const C1 = "c".repeat(64);
const C2 = "d".repeat(64);
const BRANCH = "agent/device/protected-head-refresh-controller";
const REVIEW = "github-pull-request:PR_test";

function fixture() {
  const sourceManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: ["scripts/protected-main-refresh-lib.mjs"],
  });
  const targetManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: ["scripts/protected-main-refresh-lib.mjs", "scripts/protected-main-refresh-candidate.mjs"],
  });
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "test", targetRepository: "org/repo", ledgerRepository: "org/ledger",
    deviceId: "device", sessionId: "session", state: "active",
    claimId: C1, claimDigest: "e".repeat(64), canonicalBaseSha: BASE,
    claimLedgerRevision: "6".repeat(64), operationReceiptDigest: "7".repeat(64),
    ledgerRevision: "8".repeat(40), ledgerDigest: "9".repeat(64),
    laneRevision: FENCE, cloudDeclaredWriteScope: sourceManifest.declaredWriteSet,
    writeSetDigest: sourceManifest.writeSetDigest, leaseEpoch: 1, transitionCounter: 3,
    heartbeatCounter: 0, expiresAt: "2099-08-30T02:00:00.000Z",
    reviewRequestId: REVIEW,
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", branch: BRANCH,
    epoch: 1, sessionId: "session", device: "device", worktreePath: "/worktree",
    scope: "protected-head-refresh-controller", baseSha: BASE, fenceSha: FENCE,
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest, manifestDigest: sourceManifest.manifestDigest,
    },
    heartbeatAt: authority.expiresAt, expiresAt: authority.expiresAt,
    cloudAuthority: authority,
  };
  const state = {
    source: {
      lease, branch: BRANCH, fenceSha: FENCE, claimId: C1, claimDigest: authority.claimDigest,
      changedPaths: ["scripts/protected-main-refresh-lib.mjs"], untrackedPaths: [],
      dirtyDigest: digestValue({ dirty: true }),
    },
    reviewRequestId: REVIEW,
    targetCanonicalBaseSha: "f".repeat(40),
    sourceStateDigest: "1".repeat(64),
    targetObservationDigest: "2".repeat(64),
  };
  return { state, targetManifest };
}

function waitingResult(plan) {
  return {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "claim",
    claimDigest: "3".repeat(64), ledgerRevision: "4".repeat(40),
    receipt: { receiptDigest: "5".repeat(64) },
    claim: {
      claimId: C2, state: "waiting-successor", predecessorClaimId: plan.sourceClaimId,
      canonicalBaseRevision: plan.targetCanonicalBaseSha, laneRevision: plan.sourceFenceSha,
      writeSetDigest: plan.targetWriteSetDigest, declaredWriteScope: plan.targetDeclaredWriteSet,
      leaseEpoch: 1, transitionCounter: 1, transitionDigest: "6".repeat(64),
      expiresAt: "2026-08-07T12:00:00.000Z",
    },
  };
}

test("controller persists the exact C1 -> waiting C2 -> bound C2 phase sequence", async () => {
  const { state, targetManifest } = fixture();
  const planned = buildActiveDirtyScopeExpansionPlan({
    source: state.source, targetManifest, targetCanonicalBaseSha: state.targetCanonicalBaseSha,
  });
  const trace = [];
  let intent = null;
  const adapter = createActiveDirtyScopeExpansionControllerAdapter({
    readState: () => ({ ...state, intent }),
    beginIntent: ({ plan }) => {
      trace.push("intent");
      intent = {
        status: "intent", planSnapshot: plan, planDigest: plan.planDigest,
        sourceClaimId: plan.sourceClaimId, sourceLeaseDigest: plan.sourceLeaseDigest,
        targetWriteSetDigest: plan.targetWriteSetDigest, targetManifestDigest: plan.targetManifestDigest,
        targetCanonicalBaseSha: plan.targetCanonicalBaseSha, targetLeaseEpoch: 1,
      };
      return intent;
    },
    markIntent: ({ status, ...values }) => {
      trace.push(status);
      intent = { ...intent, status, ...values };
      return intent;
    },
    claimWaitingSuccessor: ({ plan }) => {
      trace.push("claim");
      return waitingResult(plan);
    },
    retireSource: () => {
      trace.push("retire");
      return { receiptDigest: "7".repeat(64) };
    },
    promoteSuccessor: ({ plan }) => {
      trace.push("promote");
      return {
        ...waitingResult(plan), action: "continue", claimDigest: "8".repeat(64),
        receipt: { receiptDigest: "9".repeat(64) },
        claim: { ...waitingResult(plan).claim, state: "current", transitionCounter: 2 },
      };
    },
    bindSuccessor: ({ plan }) => {
      trace.push("bind");
      return {
        receiptDigest: "a".repeat(64),
        authority: {
          schema: "agentic-lane-cloud-authority/v1", claimId: C2, claimDigest: "8".repeat(64),
          canonicalBaseSha: plan.targetCanonicalBaseSha, laneRevision: plan.sourceFenceSha,
          writeSetDigest: plan.targetWriteSetDigest, leaseEpoch: 1, transitionCounter: 2,
          state: "active", reviewRequestId: REVIEW,
        },
      };
    },
    projectLocal: () => {
      trace.push("local");
      const localProjection = { leaseDigest: "b".repeat(64), claimId: C2 };
      intent = {
        ...intent,
        status: "local-cas",
        localProjection,
        localProjectionReceiptDigest: "c".repeat(64),
      };
      return { intent, projection: localProjection, receiptDigest: "c".repeat(64) };
    },
    projectPullRequest: () => {
      trace.push("pr");
      return { projection: { markerDigest: "d".repeat(64) }, receiptDigest: "e".repeat(64) };
    },
    finalize: () => {
      trace.push("complete");
      return { receiptDigest: "f".repeat(64) };
    },
  });

  const result = await runActiveDirtyScopeExpansion({
    targetManifest,
    authorization: `authorize scope-expansion ${planned.planDigest}`,
  }, { adapter });
  assert.equal(result.status, "complete");
  assert.equal(result.receiptDigest, "f".repeat(64));
  assert.deepEqual(trace.filter((phase, index) => (
    phase !== "local-cas" || trace[index - 1] !== "local"
  )), [
    "intent", "claim", "waiting-successor", "retire", "source-retired",
    "promote", "promoted", "bind", "successor-bound", "local",
    "pr", "pr-marker", "complete", "complete",
  ]);
});

test("controller refuses to mutate before the exact plan authorization", async () => {
  const { state, targetManifest } = fixture();
  const adapter = createActiveDirtyScopeExpansionControllerAdapter({
    readState: () => state,
    beginIntent: () => { throw new Error("must not begin"); },
    markIntent: () => { throw new Error("must not mark"); },
    claimWaitingSuccessor: () => { throw new Error("must not claim"); },
    retireSource: () => { throw new Error("must not retire"); },
    promoteSuccessor: () => { throw new Error("must not promote"); },
    bindSuccessor: () => { throw new Error("must not bind"); },
    projectLocal: () => { throw new Error("must not project"); },
    projectPullRequest: () => { throw new Error("must not edit PR"); },
    finalize: () => { throw new Error("must not finalize"); },
  });
  await assert.rejects(() => runActiveDirtyScopeExpansion({ targetManifest }, { adapter }), /exact typed authorization/);
});

test("completed target replays while a different strict superset derives a fresh plan", () => {
  const completed = completedFixture();
  const same = prepareActiveDirtyScopeExpansion({
    state: completed.state,
    targetManifest: completed.completedTarget,
  });
  assert.equal(same.mode, "terminal-replay");
  assert.equal(same.plan.planDigest, completed.historicalPlan.planDigest);
  const replay = buildCompletedScopeExpansionReplay({
    state: completed.state,
    plan: same.plan,
  });
  assert.equal(replay.status, "complete");
  assert.equal(replay.replay, true);
  assert.equal(replay.receiptDigest, completed.intent.finalReceiptDigest);

  const next = prepareActiveDirtyScopeExpansion({
    state: completed.state,
    targetManifest: completed.nextTarget,
  });
  assert.equal(next.mode, "terminal-rollover");
  assert.equal(next.plan.sourceClaimId, C2);
  assert.equal(next.plan.sourceLeaseDigest, writerLeaseDigest(completed.state.source.lease));
  assert.equal(next.plan.targetManifestDigest, completed.nextTarget.manifestDigest);
});

test("completed target replay and rollover accept a monotonic heartbeat descendant", () => {
  const completed = completedFixture();
  const bound = completed.state.source.lease.cloudAuthority;
  const current = {
    ...bound,
    claimDigest: "2".repeat(64),
    claimLedgerRevision: "3".repeat(64),
    operationReceiptDigest: "4".repeat(64),
    ledgerDigest: "5".repeat(64),
    transitionCounter: bound.transitionCounter + 2,
    heartbeatCounter: bound.heartbeatCounter + 2,
    expiresAt: "2099-08-30T04:30:00.000Z",
  };
  const lease = {
    ...completed.state.source.lease,
    cloudAuthority: current,
    heartbeatAt: current.expiresAt,
    expiresAt: current.expiresAt,
  };
  const state = {
    ...completed.state,
    source: {
      ...completed.state.source,
      lease,
      claimDigest: current.claimDigest,
    },
  };
  assert.equal(prepareActiveDirtyScopeExpansion({
    state,
    targetManifest: completed.completedTarget,
  }).mode, "terminal-replay");
  const rollover = prepareActiveDirtyScopeExpansion({
    state,
    targetManifest: completed.nextTarget,
  });
  assert.equal(rollover.mode, "terminal-rollover");
  assert.equal(rollover.plan.sourceLeaseDigest, writerLeaseDigest(lease));
});

test("different target cannot roll an incomplete or forged terminal intent", () => {
  const completed = completedFixture();
  assert.throws(() => prepareActiveDirtyScopeExpansion({
    state: { ...completed.state, intent: { ...completed.intent, status: "pr-marker" } },
    targetManifest: completed.nextTarget,
  }), /active durable scope-expansion intent/u);
  assert.throws(() => prepareActiveDirtyScopeExpansion({
    state: {
      ...completed.state,
      intent: {
        ...completed.intent,
        localProjection: {
          ...completed.intent.localProjection,
          leaseDigest: "0".repeat(64),
        },
      },
    },
    targetManifest: completed.nextTarget,
  }), /does not match its exact live C2 projection/u);
});

test("repeat planning rebinds stale-base disjointness to the requested target", () => {
  const completed = completedFixture();
  const protectedMainSha = "e".repeat(40);
  const oldProof = proveLegacyReviewCanonicalDescendant({
    sourceBaseSha: completed.state.targetCanonicalBaseSha,
    targetBaseSha: protectedMainSha,
    protectedMainSha,
    canonicalChangedPaths: ["docs/canonical.md"],
    preservedChangedPaths: completed.completedTarget.declaredWriteSet
      .filter(value => value.startsWith("path:"))
      .map(value => value.slice("path:".length)),
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
  const prepared = prepareActiveDirtyScopeExpansion({
    state: { ...completed.state, canonicalDescendantProof: oldProof },
    targetManifest: completed.nextTarget,
  });
  const requestedPaths = completed.nextTarget.declaredWriteSet
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length))
    .sort();
  assert.deepEqual(prepared.plan.canonicalDescendantProof.preservedChangedPaths,
    requestedPaths);
  assert.notEqual(prepared.plan.canonicalDescendantProof.evidenceDigest,
    oldProof.evidenceDigest);
});

test("CLI authorizes terminal rollover, re-reads C2, and then starts the fresh plan", async () => {
  const completed = completedFixture();
  const freshState = { ...completed.state, intent: null };
  const prepared = prepareActiveDirtyScopeExpansion({
    state: completed.state,
    targetManifest: completed.nextTarget,
  });
  const trace = [];
  let reads = 0;
  const result = await activeDirtyScopeExpansionCliMain([
    "execute",
    "--source-repository=/tmp/repository",
    "--target-manifest=/tmp/target.json",
    "--session=session-1",
    `--authorize=authorize scope-expansion ${prepared.plan.planDigest}`,
  ], {
    readText: () => JSON.stringify(completed.nextTarget),
    createAdapter: () => ({
      readState: () => {
        trace.push("read");
        return reads++ === 0 ? completed.state : freshState;
      },
    }),
    rolloverRepositoryIntent: () => { trace.push("rollover"); },
    runController: ({ authorization }, { adapter }) => {
      trace.push("run");
      assert.equal(authorization, `authorize scope-expansion ${prepared.plan.planDigest}`);
      assert.ok(adapter);
      return { schema: "agentic-active-dirty-scope-expansion-result/v1", status: "complete" };
    },
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(trace, ["read", "rollover", "read", "run"]);
});

test("CLI rejects a protected-main proof change observed after terminal rollover", async () => {
  const completed = completedFixture();
  const protectedMainSha = "e".repeat(40);
  const proof = canonicalProof(completed, protectedMainSha, ["docs/canonical-a.md"]);
  const advancedProof = canonicalProof(
    completed,
    protectedMainSha,
    ["docs/canonical-a.md", "docs/canonical-b.md"],
  );
  const initial = { ...completed.state, canonicalDescendantProof: proof };
  const fresh = {
    ...completed.state,
    intent: null,
    canonicalDescendantProof: advancedProof,
  };
  const authorized = prepareActiveDirtyScopeExpansion({
    state: initial,
    targetManifest: completed.nextTarget,
  }).plan;
  let reads = 0;
  let runs = 0;
  await assert.rejects(() => activeDirtyScopeExpansionCliMain([
    "execute",
    "--source-repository=/tmp/repository",
    "--target-manifest=/tmp/target.json",
    "--session=session-1",
    `--authorize=authorize scope-expansion ${authorized.planDigest}`,
  ], {
    readText: () => JSON.stringify(completed.nextTarget),
    createAdapter: () => ({ readState: () => reads++ === 0 ? initial : fresh }),
    rolloverRepositoryIntent: () => {},
    runController: () => { runs += 1; },
  }), /source changed after terminal intent rollover/u);
  assert.equal(reads, 2);
  assert.equal(runs, 0);
});

test("CLI refuses an unauthorized terminal rollover before its registry CAS", async () => {
  const completed = completedFixture();
  let rolloverCalls = 0;
  await assert.rejects(() => activeDirtyScopeExpansionCliMain([
    "execute",
    "--source-repository=/tmp/repository",
    "--target-manifest=/tmp/target.json",
    "--session=session-1",
    "--authorize=authorize scope-expansion wrong",
  ], {
    readText: () => JSON.stringify(completed.nextTarget),
    createAdapter: () => ({ readState: () => completed.state }),
    rolloverRepositoryIntent: () => { rolloverCalls += 1; },
    runController: () => { throw new Error("must not run"); },
  }), /exact typed authorization/u);
  assert.equal(rolloverCalls, 0);
});

test("repository rollover binds the exact live lease, completed intent, and requested target", () => {
  const completed = completedFixture();
  let invocation = null;
  const store = {
    verify({ sessionId, branch }) {
      assert.equal(sessionId, "session-1");
      assert.equal(branch, BRANCH);
      return completed.state.source.lease;
    },
  };
  rolloverRepositoryScopeExpansionIntent({
    sourceRepository: "/tmp/repository",
    sessionId: "session-1",
    targetManifest: completed.nextTarget,
    state: completed.state,
    environment: { AGENTIC_TASK_AUTHORITY_FILE: "/external/authority.json" },
    gitText: (_repository, args) => (
      args.includes("--show-current") ? BRANCH : "/tmp/common"
    ),
    createStore: options => {
      assert.equal(options.gitCommonDir, "/tmp/common");
      assert.equal(options.taskAuthorityFile, "/external/authority.json");
      return store;
    },
    rolloverIntent: values => { invocation = values; return { changed: true }; },
  });
  assert.equal(invocation.expectedLeaseDigest,
    writerLeaseDigest(completed.state.source.lease));
  assert.equal(invocation.expectedClaimId, C2);
  assert.equal(invocation.targetManifestDigest, completed.nextTarget.manifestDigest);
});

function completedFixture() {
  const { state: sourceState, targetManifest: completedTarget } = fixture();
  const historicalPlan = buildActiveDirtyScopeExpansionPlan({
    source: sourceState.source,
    targetManifest: completedTarget,
    targetCanonicalBaseSha: sourceState.targetCanonicalBaseSha,
  });
  const claimDigest = "8".repeat(64);
  const localReceipt = "9".repeat(64);
  const authority = {
    ...sourceState.source.lease.cloudAuthority,
    claimId: C2,
    claimDigest,
    claimLedgerRevision: "1".repeat(64),
    operationReceiptDigest: "2".repeat(64),
    canonicalBaseSha: historicalPlan.targetCanonicalBaseSha,
    cloudDeclaredWriteScope: completedTarget.declaredWriteSet,
    writeSetDigest: completedTarget.writeSetDigest,
    manifestDigest: completedTarget.manifestDigest,
    transitionCounter: 2,
    heartbeatCounter: 0,
    expiresAt: "2099-08-30T02:30:00.000Z",
  };
  const lease = {
    ...sourceState.source.lease,
    baseSha: historicalPlan.targetCanonicalBaseSha,
    admission: {
      ...sourceState.source.lease.admission,
      declaredWriteSet: completedTarget.declaredWriteSet,
      writeSetDigest: completedTarget.writeSetDigest,
      manifestDigest: completedTarget.manifestDigest,
    },
    taskAuthority: { bindingDigest: "0".repeat(64) },
    cloudAuthority: authority,
    heartbeatAt: authority.expiresAt,
    expiresAt: authority.expiresAt,
  };
  const localProjection = {
    leaseDigest: writerLeaseDigest(lease),
    claimId: C2,
    receiptDigest: localReceipt,
    ownerIdentityDigest: digestValue({
      deviceId: lease.device,
      sessionId: lease.sessionId,
      provider: authority.provider,
      targetRepository: authority.targetRepository,
      ledgerRepository: authority.ledgerRepository,
    }),
    targetTaskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
  };
  const intent = {
    schema: "agentic-active-dirty-scope-expansion-intent/v1",
    status: "complete",
    branch: BRANCH,
    sourceLeaseDigest: historicalPlan.sourceLeaseDigest,
    sourceClaimId: C1,
    sourceFenceSha: FENCE,
    targetWriteSetDigest: completedTarget.writeSetDigest,
    targetManifestDigest: completedTarget.manifestDigest,
    planDigest: historicalPlan.planDigest,
    targetClaimId: C2,
    targetClaimDigest: claimDigest,
    targetLeaseEpoch: 1,
    targetCanonicalBaseSha: historicalPlan.targetCanonicalBaseSha,
    targetReviewRequestId: REVIEW,
    planSnapshot: historicalPlan,
    waiting: { claimId: C2, claimDigest: "3".repeat(64) },
    waitingReceiptDigest: "4".repeat(64),
    sourceRetirementReceiptDigest: "5".repeat(64),
    promoted: { claimId: C2, claimDigest },
    promotedReceiptDigest: "6".repeat(64),
    boundAuthority: authority,
    boundReceiptDigest: "7".repeat(64),
    localProjection,
    localProjectionReceiptDigest: localReceipt,
    pullRequestProjection: { markerDigest: "a".repeat(64) },
    pullRequestProjectionReceiptDigest: "b".repeat(64),
    finalReceiptDigest: "f".repeat(64),
  };
  const state = {
    ...sourceState,
    source: {
      ...sourceState.source,
      lease,
      claimId: C2,
      claimDigest,
    },
    intent,
  };
  const nextTarget = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: [
      "scripts/protected-main-refresh-lib.mjs",
      "scripts/protected-main-refresh-candidate.mjs",
      "scripts/protected-main-refresh-controller.mjs",
    ],
  });
  return { completedTarget, historicalPlan, intent, nextTarget, state };
}

function canonicalProof(completed, protectedMainSha, canonicalChangedPaths) {
  return proveLegacyReviewCanonicalDescendant({
    sourceBaseSha: completed.state.targetCanonicalBaseSha,
    targetBaseSha: protectedMainSha,
    protectedMainSha,
    canonicalChangedPaths,
    preservedChangedPaths: completed.completedTarget.declaredWriteSet
      .filter(value => value.startsWith("path:"))
      .map(value => value.slice("path:".length)),
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
}
