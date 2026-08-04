import test from "node:test";
import assert from "node:assert/strict";

import {
  DESTRUCTIVE_OPERATION_CLASSES,
  assertCrossRepositoryWorkspaceProjection,
  assertNonDestructiveOperation,
  assertRecoveryReference,
  assertWorkspaceLaneIsolation,
  assertWorkspaceReconciliationAdmission,
  buildWorkspaceParallelismReport,
  classifyGitOperation,
  laneIsDirty,
  laneKey,
  WORKSPACE_RECONCILIATION_RECEIPT_SCHEMA,
} from "../scripts/workspace-parallelism-lib.mjs";
import { resolveWorkspaceRoot as resolveGuardWorkspaceRoot } from "../scripts/workspace-parallelism-guard.mjs";
import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { createCrossRepositoryCoordinationTask } from "../scripts/integration-order-contract.mjs";

const cleanLane = {
  repository: "knowgrph",
  worktree: "/GitHub/knowgrph",
  branch: "refs/heads/docs/payments",
  session: "session-a",
  scope: "payments",
  dirtyTrackedPaths: 0,
  untrackedPaths: 0,
  recoveryRef: null,
};

const foreignDirtyLane = {
  repository: "knowgrph",
  worktree: "/GitHub/.git-worktrees/geo",
  branch: "refs/heads/agent/mac/geospatial",
  session: "session-b",
  scope: "geospatial",
  dirtyTrackedPaths: 3,
  untrackedPaths: 2,
  recoveryRef: null,
};

const coordinationScope = "workspace-coordination-test";

function coordinationFixture(specs = [
  { repository: "example/source", path: "docs/source.md" },
  { repository: "example/projection", path: "docs/projection.md" },
]) {
  const units = specs.map((spec, index) => {
    const unitId = `unit-${index}`;
    const declaredWriteScope = normalizeWriteSet([`path:${spec.path}`]);
    const claimId = digestValue({ unitId, kind: "claim" });
    const fence = digestValue({ unitId, kind: "fence" });
    const branch = `agent/device/${unitId}`;
    const worktree = `/GitHub/.worktrees/${spec.repository.replace("/", "-")}/${unitId}`;
    return {
      unitId,
      repository: spec.repository,
      repositoryId: spec.repositoryId || digestValue({ repository: spec.repository }),
      branch,
      worktree,
      semanticScope: coordinationScope,
      declaredWriteScope,
      writeSetDigest: digestValue(declaredWriteScope),
      claimId,
      authorityEpoch: 1,
      fence,
      pullRequest: `https://example.invalid/${spec.repository}/pull/${index + 1}`,
      sourceRevision: String(index + 1).padStart(40, "0"),
      sourceDigest: digestValue({ unitId, kind: "source" }),
      namedChecks: [`${unitId}:focused`],
      handoffEvidenceDigest: digestValue({ unitId, kind: "handoff" }),
    };
  });
  const task = createCrossRepositoryCoordinationTask({
    taskId: "workspace-coordination",
    semanticScope: coordinationScope,
    sourceGuideline: {
      repository: "example/source",
      revision: units[0].sourceRevision,
      tree: "f".repeat(40),
      guidelineDigest: "a".repeat(64),
      companionDigest: "b".repeat(64),
    },
    units,
    dependencyEdges: [{ from: units[0].unitId, to: units[1].unitId }],
  });
  const lanes = units.map((unit, index) => ({
    repository: unit.repository,
    worktree: unit.worktree,
    branch: `refs/heads/${unit.branch}`,
    session: `session-${index}`,
    scope: coordinationScope,
    writeSetDigest: unit.writeSetDigest,
    dirtyTrackedPaths: 0,
    untrackedPaths: 0,
  }));
  const claims = units.map((unit, index) => {
    const state = specs[index].state || "current";
    return {
      claimId: unit.claimId,
      repositoryId: unit.repositoryId,
      state,
      writeAuthority: state === "current",
      declaredWriteScope: unit.declaredWriteScope,
      writeSetDigest: unit.writeSetDigest,
      leaseEpoch: unit.authorityEpoch,
      fenceRevision: unit.fence,
      provider: "replaceable-test-projection",
      localLease: { epoch: 999 },
    };
  });
  return { task, lanes, claims };
}

test("destructive git operations are classified by the explicit catalog", () => {
  const cases = [
    ["git reset --hard origin/main", "workingTreeReset"],
    ["git clean -fdx", "untrackedRemoval"],
    ["git checkout --force main", "forcedCheckout"],
    ["git restore --worktree docs", "forcedCheckout"],
    ["git push --force origin main", "historyRewrite"],
    ["git branch -D agent/mac/payments", "laneRemoval"],
    ["git worktree remove --force /GitHub/.git-worktrees/geo", "laneRemoval"],
    ["git gc --prune=now", "objectPruning"],
    ["git reflog expire --expire=now --all", "objectPruning"],
    ["git pull origin main", "blindIntegration"],
    ["git merge origin/main", "blindIntegration"],
  ];
  for (const [operation, expected] of cases) {
    const classification = classifyGitOperation(operation);
    assert.equal(classification.destructive, true, operation);
    assert.equal(classification.class, expected, operation);
    assert.equal(classification.reason, DESTRUCTIVE_OPERATION_CLASSES[expected]);
  }
});

test("read-only and additive operations stay non-destructive", () => {
  for (const operation of [
    "git status --porcelain",
    "git add docs",
    "git commit -m message",
    "git fetch origin",
    "git worktree list --porcelain",
    "git merge --no-ff origin/main",
    "git rebase --abort",
    "git bundle create backup.bundle HEAD",
  ]) {
    assert.equal(classifyGitOperation(operation).destructive, false, operation);
  }
});

test("classification accepts argv arrays and rejects empty invocations", () => {
  assert.equal(classifyGitOperation(["git", "clean", "-fd"]).class, "untrackedRemoval");
  assert.equal(classifyGitOperation(["status"]).destructive, false);
  assert.throws(() => classifyGitOperation("   "), /requires a git invocation/);
});

test("parallel lanes are accepted when repository, worktree, branch, and scope are distinct", () => {
  const lanes = assertWorkspaceLaneIsolation([
    cleanLane,
    foreignDirtyLane,
    { ...cleanLane, repository: "agentic-canvas-os", worktree: "/GitHub/agentic-canvas-os", branch: "refs/heads/docs/parallelism", scope: "parallelism" },
  ]);
  assert.equal(lanes.length, 3);
  assert.equal(laneKey(lanes[0]), "knowgrph::/GitHub/knowgrph");
  assert.equal(laneIsDirty(lanes[0]), false);
  assert.equal(laneIsDirty(lanes[1]), true);
});

test("one worktree cannot be claimed by two sessions", () => {
  assert.throws(
    () => assertWorkspaceLaneIsolation([cleanLane, { ...cleanLane, session: "session-c" }]),
    /claimed by sessions session-a and session-c/,
  );
});

test("one branch cannot be live in two worktrees", () => {
  assert.throws(
    () => assertWorkspaceLaneIsolation([
      cleanLane,
      { ...cleanLane, worktree: "/GitHub/.git-worktrees/dup", session: "session-d", scope: "other" },
    ]),
    /is active in .* and .*; parallel lanes require distinct branches/,
  );
});

test("two sessions cannot claim one semantic scope in one repository", () => {
  assert.throws(
    () => assertWorkspaceLaneIsolation([
      cleanLane,
      { ...cleanLane, worktree: "/GitHub/.git-worktrees/payments-2", branch: "refs/heads/agent/mac/payments-2", session: "session-e" },
    ]),
    /Scope payments in knowgrph is claimed by sessions/,
  );
});

test("cross-repository task units bind to exact local and cloud authority projections", () => {
  const fixture = coordinationFixture();
  const projection = assertCrossRepositoryWorkspaceProjection(fixture);
  assert.equal(projection.schema, "agentic-workspace-coordination-projection/v1");
  assert.equal(projection.taskDigest, fixture.task.taskDigest);
  assert.deepEqual(projection.dependencyWaves, [["unit-0"], ["unit-1"]]);
  assert.equal(projection.currentWriteAuthorities, 2);
  assert.equal(projection.waitingSuccessors, 0);
  assert.equal(projection.projections[0].branch, "agent/device/unit-0");
  assert.equal(projection.projections[0].repositoryId, fixture.task.units[0].repositoryId);
  assert.equal(projection.projections[0].semanticScope, coordinationScope);
  assert.equal(projection.projections[0].writeSetDigest, fixture.task.units[0].writeSetDigest);
  assert.equal("provider" in projection.projections[0], false);
  assert.equal("localLease" in projection.projections[0], false);
});

test("cross-repository task projections fail closed on local identity or authority drift", () => {
  const fixture = coordinationFixture();
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    lanes: fixture.lanes.map((lane, index) => index === 0 ? { ...lane, repository: "example/wrong" } : lane),
  }), /repository does not match/u);
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    lanes: fixture.lanes.map((lane, index) => index === 0 ? { ...lane, branch: "refs\/heads\/agent\/wrong" } : lane),
  }), /branch does not match/u);
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    claims: fixture.claims.map((claim, index) => index === 0 ? { ...claim, fenceRevision: "c".repeat(64) } : claim),
  }), /authority epoch or fence has drifted/u);
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    claims: fixture.claims.map((claim, index) => index === 1
      ? { ...claim, repositoryId: digestValue({ repository: "wrong-but-unique" }) }
      : claim),
  }), /repository authority does not match/u);
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    lanes: fixture.lanes.map((lane, index) => index === 0 ? { ...lane, scope: "wrong-scope" } : lane),
  }), /semantic scope does not match/u);
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    lanes: fixture.lanes.map((lane, index) => index === 0
      ? { ...lane, writeSetDigest: digestValue({ writeSet: "wrong" }) }
      : lane),
  }), /write-set digest does not match/u);
  const staleTask = JSON.parse(JSON.stringify(fixture.task));
  staleTask.units[0].branch = "agent/device/drifted";
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({ ...fixture, task: staleTask }), /digest has drifted/u);
});

test("an overlapping successor waits without acquiring write authority", () => {
  const fixture = coordinationFixture([
    { repository: "example/source", path: "docs/shared" },
    { repository: "example/projection", path: "docs/projection.md" },
    { repository: "example/source", path: "docs/shared/child.md", state: "waiting-successor" },
  ]);
  const projection = assertCrossRepositoryWorkspaceProjection(fixture);
  assert.equal(projection.currentWriteAuthorities, 2);
  assert.equal(projection.waitingSuccessors, 1);
  assert.equal(projection.projections.find((unit) => unit.unitId === "unit-2").writeAuthority, false);
  assert.throws(() => assertCrossRepositoryWorkspaceProjection({
    ...fixture,
    claims: fixture.claims.map((claim, index) => index === 2 ? { ...claim, writeAuthority: true } : claim),
  }), /write authority does not match state waiting-successor/u);
});

test("overlapping current claims fail while disjoint current claims have no global cap", () => {
  const overlapping = coordinationFixture([
    { repository: "example/source", path: "docs/shared" },
    { repository: "example/projection", path: "docs/projection.md" },
    { repository: "example/source", path: "docs/shared/child.md" },
  ]);
  assert.throws(
    () => assertCrossRepositoryWorkspaceProjection(overlapping),
    /competing overlapping scope reservations/u,
  );

  const dormantConflict = coordinationFixture([
    { repository: "example/source", path: "docs/shared", state: "dormant-preserved" },
    { repository: "example/projection", path: "docs/projection.md" },
    { repository: "example/source", path: "docs/shared/child.md" },
  ]);
  assert.throws(
    () => assertCrossRepositoryWorkspaceProjection(dormantConflict),
    /competing overlapping scope reservations/u,
  );

  const disjoint = coordinationFixture(Array.from({ length: 24 }, (_value, index) => ({
    repository: index % 2 === 0 ? "example/source" : "example/projection",
    path: `units/${index}.md`,
  })));
  const projection = assertCrossRepositoryWorkspaceProjection(disjoint);
  assert.equal(projection.currentWriteAuthorities, 24);
  assert.equal(projection.projections.length, 24);
});

test("lane declarations require repository, worktree, and session", () => {
  assert.throws(() => assertWorkspaceLaneIsolation([{ worktree: "/x", session: "s" }]), /missing a repository/);
  assert.throws(() => assertWorkspaceLaneIsolation([{ repository: "r", session: "s" }]), /missing a worktree path/);
  assert.throws(() => assertWorkspaceLaneIsolation([{ repository: "r", worktree: "/x" }]), /missing a session owner/);
  assert.throws(() => assertWorkspaceLaneIsolation([]), /at least one declared lane/);
});

test("a session cannot run a destructive operation on a lane it does not own", () => {
  assert.throws(
    () => assertNonDestructiveOperation({
      operation: "git reset --hard origin/main",
      lane: foreignDirtyLane,
      session: "session-a",
      lanes: [cleanLane, foreignDirtyLane],
    }),
    /cannot run "reset --hard origin\/main".*owned by session-b/,
  );
});

test("a destructive operation is refused while another session holds uncommitted work in the repository", () => {
  assert.throws(
    () => assertNonDestructiveOperation({
      operation: "git clean -fd",
      lane: cleanLane,
      session: "session-a",
      lanes: [cleanLane, foreignDirtyLane],
    }),
    /uncommitted work is live in knowgrph::\/GitHub\/\.git-worktrees\/geo \(session-b\)/,
  );
});

test("untracked files block a destructive operation because they were never committed", () => {
  assert.throws(
    () => assertNonDestructiveOperation({
      operation: "git clean -fdx",
      lane: { ...cleanLane, untrackedPaths: 4 },
      session: "session-a",
      lanes: [{ ...cleanLane, untrackedPaths: 4 }],
    }),
    /4 untracked path\(s\).*would be unrecoverable/,
  );
});

test("modified tracked files require a recovery reference before a destructive operation", () => {
  const dirty = { ...cleanLane, dirtyTrackedPaths: 2 };
  assert.throws(
    () => assertNonDestructiveOperation({ operation: "git reset --hard", lane: dirty, session: "session-a", lanes: [dirty] }),
    /2 modified path\(s\) and no recovery reference/,
  );
  const recovered = { ...dirty, recoveryRef: "refs/heads/recovery/payments" };
  const decision = assertNonDestructiveOperation({
    operation: "git reset --hard",
    lane: recovered,
    session: "session-a",
    lanes: [recovered],
  });
  assert.equal(decision.decision, "allow-with-recovery");
  assert.equal(decision.recoveryRef, "refs/heads/recovery/payments");
});

test("non-destructive operations are allowed even while other lanes are dirty", () => {
  const decision = assertNonDestructiveOperation({
    operation: "git status --porcelain",
    lane: cleanLane,
    session: "session-a",
    lanes: [cleanLane, foreignDirtyLane],
  });
  assert.equal(decision.decision, "allow");
  assert.equal(decision.destructive, false);
});

test("destructive-operation review requires the acting session", () => {
  assert.throws(
    () => assertNonDestructiveOperation({ operation: "git clean -fd", lane: cleanLane, session: "  " }),
    /requires the acting session id/,
  );
});

test("recovery references must be durable, declared, and existing", () => {
  assert.equal(assertRecoveryReference({ lane: cleanLane, refs: [] }).required, false);
  const dirty = { ...cleanLane, dirtyTrackedPaths: 1 };
  assert.throws(() => assertRecoveryReference({ lane: dirty, refs: [] }), /declares no recovery reference/);
  assert.throws(
    () => assertRecoveryReference({ lane: { ...dirty, recoveryRef: "refs/stash" }, refs: ["refs/stash"] }),
    /stashes are anonymous/,
  );
  assert.throws(
    () => assertRecoveryReference({ lane: { ...dirty, recoveryRef: "refs/heads/recovery/x" }, refs: [] }),
    /does not exist/,
  );
  assert.equal(
    assertRecoveryReference({
      lane: { ...dirty, recoveryRef: "refs/heads/recovery/x" },
      refs: ["refs/heads/recovery/x"],
    }).recoveryRef,
    "refs/heads/recovery/x",
  );
});

test("the workspace report enumerates lanes, sessions, and unrecoverable work", () => {
  const report = buildWorkspaceParallelismReport({
    workspaceRoot: "/GitHub",
    lanes: [cleanLane, foreignDirtyLane],
    now: () => new Date("2026-07-28T00:00:00.000Z"),
  });
  assert.equal(report.schema, "agentic-workspace-parallelism-report/v1");
  assert.equal(report.workspaceRoot, "/GitHub");
  assert.equal(report.generatedAt, "2026-07-28T00:00:00.000Z");
  assert.deepEqual([...report.repositories], ["knowgrph"]);
  assert.deepEqual([...report.sessions], ["session-a", "session-b"]);
  assert.equal(report.parallelLanes, 2);
  assert.equal(report.ready, false);
  assert.equal(report.unrecoverableLanes.length, 1);
  assert.equal(report.unrecoverableLanes[0].session, "session-b");
  assert.deepEqual([...report.forbiddenOperationClasses].sort(), Object.keys(DESTRUCTIVE_OPERATION_CLASSES).sort());
});

test("the workspace report is ready only when every lane is recoverable", () => {
  const report = buildWorkspaceParallelismReport({
    workspaceRoot: "/GitHub",
    lanes: [cleanLane, { ...foreignDirtyLane, untrackedPaths: 0, recoveryRef: "refs/heads/recovery/geo" }],
  });
  assert.equal(report.ready, true);
  assert.equal(report.unrecoverableLanes.length, 0);
});

test("the workspace report requires a workspace root", () => {
  assert.throws(() => buildWorkspaceParallelismReport({ workspaceRoot: "", lanes: [cleanLane] }), /requires a workspace root/);
});

test("task-worktree invocation resolves the registered canonical workspace root", () => {
  const root = resolveGuardWorkspaceRoot({
    agenticCanvasOsRoot: "/GitHub/.worktrees/agentic-canvas-os/reconciliation-admission",
    env: {},
    spawn: (_command, args) => ({
      status: 0,
      stdout: args.join(" ") === "worktree list --porcelain"
        ? "worktree /GitHub/.worktrees/agentic-canvas-os/reconciliation-admission\nbranch refs/heads/agent/device/reconcile\n\nworktree /GitHub/.worktrees/canonical/agentic-canvas-os\nbranch refs/heads/main\n"
        : "",
    }),
  });
  assert.equal(root, "/GitHub/.worktrees/canonical");
});

test("a receipt admits only retained, disjoint lanes whose captured bytes still match", () => {
  const dirtyLane = {
    ...foreignDirtyLane,
    untrackedPaths: 0,
    stateDigest: "a".repeat(64),
    writeSetDigest: "b".repeat(64),
  };
  const report = buildWorkspaceParallelismReport({ workspaceRoot: "/GitHub", lanes: [cleanLane, dirtyLane] });
  const receipt = {
    schema: WORKSPACE_RECONCILIATION_RECEIPT_SCHEMA,
    workspaceRoot: "/GitHub",
    protectedTip: "c".repeat(40),
    items: [{
      lane: laneKey(dirtyLane),
      session: "session-b",
      stateDigest: dirtyLane.stateDigest,
      writeSetDigest: dirtyLane.writeSetDigest,
      overlapClass: "disjoint",
      disposition: "retained",
      recoveryHandle: "refs/agentic-canvas-os/retained/session-b/geospatial",
    }],
  };
  const result = assertWorkspaceReconciliationAdmission({
    report,
    receipt,
    target: { repository: "knowgrph", scope: "release" },
  });
  assert.equal(result.decision, "admit-retained-disjoint-lanes");
  assert.equal(result.retained.length, 1);
});

test("reconciliation rejects missing, drifting, or overlapping dirty lane receipts", () => {
  const dirtyLane = {
    ...foreignDirtyLane,
    untrackedPaths: 0,
    stateDigest: "a".repeat(64),
    writeSetDigest: "b".repeat(64),
  };
  const report = buildWorkspaceParallelismReport({ workspaceRoot: "/GitHub", lanes: [cleanLane, dirtyLane] });
  const baseReceipt = {
    schema: WORKSPACE_RECONCILIATION_RECEIPT_SCHEMA,
    workspaceRoot: "/GitHub",
    protectedTip: "c".repeat(40),
    items: [],
  };
  assert.throws(() => assertWorkspaceReconciliationAdmission({ report, receipt: baseReceipt }), /does not account/);
  const item = {
    lane: laneKey(dirtyLane), session: "session-b", stateDigest: "d".repeat(64),
    writeSetDigest: dirtyLane.writeSetDigest, overlapClass: "disjoint", disposition: "retained", recoveryHandle: "refs/recovery/x",
  };
  assert.throws(() => assertWorkspaceReconciliationAdmission({ report, receipt: { ...baseReceipt, items: [item] } }), /drifted/);
  assert.throws(() => assertWorkspaceReconciliationAdmission({
    report,
    receipt: { ...baseReceipt, items: [{ ...item, stateDigest: dirtyLane.stateDigest, overlapClass: "overlapping" }] },
  }), /overlapping/);
});
