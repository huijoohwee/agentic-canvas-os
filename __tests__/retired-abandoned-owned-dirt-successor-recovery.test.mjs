import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { captureActiveOwnedDirtEvidence }
  from "../scripts/active-owned-dirt-recovery-evidence.mjs";
import {
  canonicalJson,
  digestValue,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { proveIgnoredStateRetention }
  from "../scripts/canonical-main-recovery-evidence.mjs";
import { writerLeaseBodyRemainder }
  from "../scripts/orphaned-task-authority-recovery-evidence.mjs";
import { PHASES, buildRecoveryPlan }
  from "../scripts/retired-abandoned-owned-dirt-successor-recovery-contract.mjs";
import { createRetiredAbandonedOwnedDirtSuccessorRecoveryController }
  from "../scripts/retired-abandoned-owned-dirt-successor-recovery-controller.mjs";
import {
  assertNoLiveRetiredAbandonedOverlap,
  buildDeterministicCoordinationCommit,
  buildRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence,
  selectRetiredAbandonedClaimProof,
  selectTargetCloudLeaseEpochProof,
} from "../scripts/retired-abandoned-owned-dirt-successor-recovery-evidence.mjs";
import {
  buildRetiredAbandonedOwnedDirtDeterministicTargetLease,
  convergeRetiredAbandonedOwnedDirtLocalReanchor,
  createRetiredAbandonedOwnedDirtSuccessorRecoveryRepositoryAdapter,
  createRetiredAbandonedOwnedDirtSnapshotV2,
  materializeProjectedReanchorObjects,
  projectRetiredAbandonedOwnedDirtCurrentBaseReanchor,
  verifyMaterializedReanchorObjects,
  verifyRetiredAbandonedOwnedDirtSnapshotV2,
} from "../scripts/retired-abandoned-owned-dirt-successor-recovery-repository-adapter.mjs";
import { runRetiredAbandonedOwnedDirtSuccessorRecoveryCli }
  from "../scripts/retired-abandoned-owned-dirt-successor-recovery.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
  projectTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
import {
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
}
  from "../scripts/writer-lease-lib.mjs";

const hex = value => digestValue(value);
const sha = value => hex(value).slice(0, 40);
const comparePaths = (left, right) => Buffer.compare(Buffer.from(left, "utf8"),
  Buffer.from(right, "utf8"));
const SOURCE_PATHS = ["src/owned"];
const TARGET_PATHS = ["src/new-runtime", ...SOURCE_PATHS];

test("selects only an exact current-to-retired abandoned chain", () => {
  const fixture = sourceFixture();
  const proof = selectRetiredAbandonedClaimProof(fixture);
  assert.equal(proof.claimId, fixture.lease.cloudAuthority.claimId);
  assert.equal(proof.retirementReason, "abandoned");
  assert.equal(proof.terminalTransitionCounter, proof.sourceTransitionCounter + 1);

  assert.throws(() => selectRetiredAbandonedClaimProof({
    lease: fixture.lease,
    entries: fixture.entries.map((entry, index) => index === 0 ? entry : {
      ...entry,
      claimCore: {
        ...entry.claimCore,
        retirement: { ...entry.claimCore.retirement, reason: "handoff" },
      },
    }),
  }), /terminal abandoned/u);
  assert.throws(() => selectRetiredAbandonedClaimProof({
    lease: fixture.lease,
    entries: fixture.entries.map((entry, index) => index === 0 ? entry : {
      ...entry,
      claimCore: { ...entry.claimCore, transitionCounter: 9 },
    }),
  }), /terminal abandoned/u);
});

test("derives target epoch from each matching claim's latest validated ledger entry", () => {
  const source = sourceFixture();
  const sourceProof = selectRetiredAbandonedClaimProof(source);
  const target = manifest(TARGET_PATHS);
  const historical = (claimId, leaseEpoch, transitionCounter, state) => ({
    claimId,
    digest: hex(`${claimId}:${transitionCounter}`),
    claimCore: {
      repositoryId: sourceProof.repositoryId,
      workItemId: sourceProof.workItemId,
      writeSetDigest: target.writeSetDigest,
      leaseEpoch,
      transitionCounter,
      state,
    },
  });
  const first = hex("historical-target-first");
  const second = hex("historical-target-second");
  const proof = selectTargetCloudLeaseEpochProof({
    entries: [
      ...source.entries,
      historical(first, 4, 1, "current"),
      historical(first, 4, 2, "retired"),
      historical(second, 7, 1, "current"),
    ],
    sourceProof,
    targetDeclaredWriteSet: target.declaredWriteSet,
  });
  assert.equal(proof.matchingClaims.length, 2);
  assert.equal(proof.maximumHistoricalLeaseEpoch, 7);
  assert.equal(proof.targetCloudLeaseEpoch, 8);
});

test("seals deterministic current-base reanchor without changing authored overlay entries", () => {
  const evidence = evidenceFixture();
  assert.deepEqual(evidence.targetManifest.paths, TARGET_PATHS.toSorted());
  assert.equal(evidence.targetCloudLeaseEpoch, 1);
  assert.equal(evidence.targetCapability.generation, evidence.lease.taskAuthority.generation + 1);
  assert.notEqual(evidence.targetCapability.authoritySubjectId,
    evidence.lease.taskAuthority.authoritySubjectId);
  assert.equal(evidence.dirt.entries[0].path, "src/new-runtime/new.mjs");
  assert.equal(evidence.sourceFence.parentSha, evidence.lease.baseSha);
  assert.equal(evidence.sourceFence.treeSha, evidence.sourceFence.baseTreeSha);
  assert.notEqual(evidence.targetProtectedMain.protectedMainSha, evidence.lease.baseSha);
  assert.deepEqual(evidence.targetProtectedMain.dirtyOverlapPaths,
    ["src/new-runtime/new.mjs"]);
  assert.deepEqual(evidence.reanchor.coordination.parents,
    [evidence.headSha, evidence.targetProtectedMain.protectedMainSha]);
  assert.equal(evidence.reanchor.coordination.treeSha,
    evidence.targetProtectedMain.treeSha);
  assert.equal(evidence.reanchor.targetDirt.headSha,
    evidence.reanchor.coordination.commitSha);
  assert.equal(evidence.reanchor.authoredBytesPreserved, true);
  assert.equal(evidence.reanchor.sourceWorktreeAuthoredPathCount, 1);
  assert.equal(evidence.targetCloudLeaseEpoch,
    evidence.targetEpochProof.targetCloudLeaseEpoch);

  assert.throws(() => evidenceFixture({ targetPaths: SOURCE_PATHS }), /strict superset/u);
  assert.throws(() => evidenceFixture({ targetPaths: ["src/other", ...SOURCE_PATHS] }),
    /outside the admitted write set/u);
  assert.throws(() => evidenceFixture({ targetGeneration: 1 }), /generation\+1/u);
  assert.throws(() => evidenceFixture({ dirtyOverlapPaths: [] }), /dirty-overlap/u);
  assert.throws(() => evidenceFixture({ sourceFenceParentSha: sha("wrong-parent") }),
    /empty coordination fence/u);
});

test("normalizes every reanchor path collection in unsigned UTF-8 byte order", () => {
  const orderingPaths = [
    "z.txt", "\uE000.txt", "😀.txt", "__smoke__/proof.mjs",
    ".github/workflows/proof.yml", "Alpha.txt", "alpha.txt",
  ];
  const evidence = evidenceFixture({ orderingPaths });
  const expected = [...new Set([...orderingPaths, "docs/protected-main.md",
    "src/new-runtime/new.mjs"])].sort(comparePaths);
  const dispositionPaths = evidence.reanchor.dispositions.map(item => item.path);
  assert.deepEqual(dispositionPaths, expected);
  assert.equal(evidence.reanchor.dispositionCount, expected.length);
  assert.equal(new Set(dispositionPaths).size, dispositionPaths.length);
  assert.deepEqual(evidence.targetProtectedMain.changedPaths, expected);
  assert.deepEqual(evidence.reanchor.targetDirt.entries.map(item => item.path),
    ["src/new-runtime/new.mjs"]);
});

test("rejects live source, successor, and strict-superset overlap", () => {
  const source = sourceFixture();
  const proof = selectRetiredAbandonedClaimProof(source);
  const target = manifest(TARGET_PATHS);
  assert.throws(() => assertNoLiveRetiredAbandonedOverlap({
    claims: [{ claimId: proof.claimId, declaredWriteScope: proof.declaredWriteScope }],
    sourceProof: proof,
    targetDeclaredWriteSet: target.declaredWriteSet,
  }), /remains live/u);
  assert.throws(() => assertNoLiveRetiredAbandonedOverlap({
    claims: [{ claimId: hex("successor"), predecessorClaimId: proof.claimId,
      declaredWriteScope: ["path:elsewhere", "semantic:other"] }],
    sourceProof: proof,
    targetDeclaredWriteSet: target.declaredWriteSet,
  }), /successor claim already exists/u);
  assert.throws(() => assertNoLiveRetiredAbandonedOverlap({
    claims: [{ claimId: hex("overlap"), scopeReserved: true,
      declaredWriteScope: ["path:src/new-runtime"] }],
    sourceProof: proof,
    targetDeclaredWriteSet: target.declaredWriteSet,
  }), /overlaps the strict-superset/u);
});

test("runs authorized deterministic reanchor before claiming P/C without predecessor", async () => {
  const evidence = evidenceFixture();
  let journal = null;
  const calls = [];
  let captureCount = 0;
  let fenceCount = 0;
  const values = {
    authorizeSource: receipt("source-authority"),
    snapshot: receipt("snapshot"),
    prepareReanchor: receipt("reanchor-prepared"),
    reanchorLocal: receipt("local-reanchor"),
    reanchorRemote: receipt("remote-reanchor"),
    reopenPullRequest: receipt("reopen"),
    claimRecovery: { claimId: hex("recovery"), ...receipt("claim") },
    bindRecovery: receipt("bind"),
    projectLocal: receipt("local"),
    projectPullRequestMarker: receipt("marker"),
    verifyTerminal: {
      ...receipt("terminal"),
      mutationAuthorityReceiptDigest: hex("mutation-authority"),
    },
  };
  const adapter = {
    withFence: action => { fenceCount += 1; return action(); },
    captureEvidence: async () => { captureCount += 1; return evidence; },
    readIntent: async () => journal,
    writeIntent: async ({ expected, value }) => {
      assert.equal(expected, journal);
      journal = value;
    },
    reconcile: async () => null,
    ...Object.fromEntries(Object.entries(values).map(([method, value]) => [method,
      async input => {
        calls.push(method);
        if (method === "claimRecovery") {
          assert.equal(input.plan.targetCanonicalBaseSha,
            evidence.targetProtectedMain.protectedMainSha);
          assert.equal(input.plan.targetLaneRevision,
            evidence.reanchor.coordination.commitSha);
          assert.equal(input.plan.predecessorClaimId, null);
        }
        return value;
      }])),
  };
  const controller = createRetiredAbandonedOwnedDirtSuccessorRecoveryController(adapter);
  const plan = await controller.plan({
    targetManifest: evidence.targetManifest,
    operatorSessionId: "successor-session",
    ttlSeconds: 1800,
  });
  assert.equal(captureCount, 2);
  assert.equal(fenceCount, 0);
  assert.deepEqual(calls, []);
  assert.equal(plan.targetCloudLeaseEpoch, 1);
  assert.equal(plan.writerLeaseEpoch, evidence.lease.epoch);
  assert.equal(plan.sourceBaseSha, evidence.lease.baseSha);
  assert.equal(plan.sourceFenceSha, evidence.headSha);
  assert.equal(plan.targetLaneRevision, evidence.reanchor.coordination.commitSha);
  assert.equal(plan.targetCanonicalBaseSha,
    evidence.targetProtectedMain.protectedMainSha);
  assert.equal(plan.targetCloudCanonicalBaseSha,
    evidence.targetProtectedMain.protectedMainSha);
  assert.equal(plan.targetLocalBaseSha, evidence.targetProtectedMain.protectedMainSha);
  assert.equal(plan.predecessorClaimId, null);
  assert.match(plan.exactAuthorization,
    /^authorize retired-abandoned-owned-dirt-successor-recovery [0-9a-f]{64}$/u);

  await assert.rejects(() => controller.run({
    plan,
    operatorSessionId: "successor-session",
    authorization: `authorize retired-abandoned-owned-dirt-successor-recovery ${hex("wrong")}`,
  }), /exact authorization/u);
  assert.equal(fenceCount, 0, "authorization must be checked before acquiring the mutation fence");

  const completion = await controller.run({
    plan,
    operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization,
  });
  assert.equal(captureCount, 3);
  assert.equal(fenceCount, 1);
  assert.equal(completion.status, "mutation-authority-restored");
  assert.equal(completion.predecessorClaimId, null);
  assert.equal(completion.targetCanonicalBaseSha,
    evidence.targetProtectedMain.protectedMainSha);
  assert.equal(completion.recoveryLaneRevision, evidence.reanchor.coordination.commitSha);
  assert.equal(completion.canonicalBaseChanged, true);
  assert.equal(completion.authoredBytesPreserved, true);
  assert.equal(completion.upstreamConflictResolutionRequired, true);
  assert.equal(completion.sourceWorktreeChanged, true);
  assert.equal(completion.sourceIndexChanged, true);
  assert.equal(completion.sourceHeadChanged, true);
  assert.equal(completion.sourceLocalRefChanged, true);
  assert.equal(completion.sourceRemoteRefChanged, true);
  assert.equal(completion.gitIndexChanged, true);
  assert.equal(completion.gitWorktreeChanged, true);
  assert.equal(completion.untrackedBytesChanged, false);
  assert.equal(completion.pushed, true);
  assert.equal(completion.committed, true);
  assert.equal(completion.authoredContentCommitted, false);
  assert.equal(completion.mergedProtectedMain, true);
  assert.equal(completion.pullRequestMerged, false);
  assert.equal(completion.pullRequestReopened, true);
  assert.deepEqual(calls, [
    "authorizeSource",
    "snapshot",
    "prepareReanchor",
    "reanchorLocal",
    "reanchorRemote",
    "reopenPullRequest",
    "claimRecovery",
    "bindRecovery",
    "projectLocal",
    "projectPullRequestMarker",
    "verifyTerminal",
  ]);
  assert.equal(journal.phase, "complete");
  assert.deepEqual(Object.keys(journal.receipts), PHASES);
  assert.deepEqual(await controller.run({
    plan,
    operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization,
  }), completion);
  assert.equal(fenceCount, 2);
});

test("snapshot v2 retains canonical evidence larger than 256 KiB as reachable Git structure",
  { timeout: 120_000 }, t => {
    const fixture = disposableRepository(t, "large-snapshot");
    const directory = Array.from({ length: 4 }, (_, index) =>
      `${index}-${"\\".repeat(168)}`).join(path.sep);
    mkdirSync(path.join(fixture.repository, directory), { recursive: true });
    const entries = Array.from({ length: 140 }, (_, index) => {
      const relativePath = path.join(
        directory,
        `${String(index).padStart(4, "0")}-${"\\".repeat(160)}.txt`,
      );
      const bytes = Buffer.from(`payload-${index}\n`);
      writeFileSync(path.join(fixture.repository, relativePath), bytes);
      return Object.freeze({
        path: relativePath,
        staged: false,
        unstaged: false,
        untracked: true,
        headMode: null,
        headBlob: null,
        indexMode: null,
        indexBlob: null,
        worktreeType: "file",
        worktreeMode: "100644",
        worktreeBlob: gitBlobSha(bytes),
      });
    });
    const evidenceCore = {
      schema: "agentic-active-owned-dirt-evidence/v1",
      headSha: fixture.git(["rev-parse", "HEAD"]),
      entries,
      pathCount: entries.length,
      stagedPathCount: 0,
      unstagedPathCount: 0,
      untrackedPathCount: entries.length,
    };
    const evidence = Object.freeze({
      ...evidenceCore,
      evidenceDigest: digestValue(evidenceCore),
    });
    const evidenceBytes = Buffer.byteLength(canonicalJson(evidence));
    assert.ok(evidenceBytes > 256 * 1024, `${evidenceBytes} evidence bytes`);

    const snapshot = createRetiredAbandonedOwnedDirtSnapshotV2({
      repository: fixture.repository,
      evidence,
      claimId: hex("large-snapshot-claim"),
      planDigest: hex("large-snapshot-plan"),
      timestamp: "2026-08-25T00:00:00.000Z",
    });
    assert.equal(snapshot.schema,
      "agentic-retired-abandoned-owned-dirt-successor-recovery-snapshot/v2");
    assert.equal(
      fixture.git(["cat-file", "blob", snapshot.evidenceBlobSha]),
      canonicalJson(evidence),
    );
    assert.ok(Buffer.byteLength(fixture.git([
      "show", "-s", "--format=%B", snapshot.commitSha,
    ])) < 256 * 1024, "snapshot commit message remains compact");
    const reachable = new Set(fixture.git([
      "rev-list", "--objects", snapshot.snapshotRef,
    ]).split("\n").map(line => line.split(" ")[0]));
    for (const objectId of [
      snapshot.commitSha,
      snapshot.indexCommitSha,
      snapshot.evidenceCommitSha,
      snapshot.evidenceTreeSha,
      snapshot.evidenceBlobSha,
    ]) {
      assert.ok(reachable.has(objectId), `${objectId} is structurally reachable`);
    }
    fixture.git(["gc", "--prune=now"]);
    assert.deepEqual(
      verifyRetiredAbandonedOwnedDirtSnapshotV2({
        repository: fixture.repository,
        snapshot: { ...snapshot, evidence, timestamp: "2026-08-25T00:00:00.000Z" },
      }),
      snapshot,
    );
  });

test("projects and converges the deterministic current-base overlay without authored loss",
  { timeout: 60_000 }, t => {
    const fixture = reanchorRepository(t, "overlay");
    const before = captureRepositoryBoundary(fixture);
    const first = projectReanchor(fixture);
    const second = projectReanchor(fixture);
    assert.equal(canonicalJson(first), canonicalJson(second));
    assert.deepEqual(captureRepositoryBoundary(fixture), before,
      "read-only projection must not mutate objects, refs, index, worktree, or state");

    const dispositions = new Map(first.dispositions.map(item => [item.path, item]));
    assertDisposition(dispositions, "protected-only.txt", "protected", "protected");
    assertDisposition(dispositions, "protected-added.txt", "protected", "protected");
    assertDisposition(dispositions, "protected-deleted.txt", "protected", "protected");
    assertDisposition(dispositions, "staged.txt", "source", "source");
    assertDisposition(dispositions, "unstaged.txt", "protected", "source");
    assertDisposition(dispositions, "both.txt", "source", "source");
    assertDisposition(dispositions, "deleted-staged.txt", "source", "source");
    assertDisposition(dispositions, "deleted-unstaged.txt", "protected", "source");
    assertDisposition(dispositions, "exec.sh", "source", "source");
    assertDisposition(dispositions, "link.txt", "protected", "source");
    assertDisposition(dispositions, "untracked.txt", "protected", "source");
    assertDisposition(dispositions, "overlap.txt", "protected", "source");
    assert.equal(dispositions.get("exec.sh").targetIndex.mode, "100755");
    assert.equal(dispositions.get("link.txt").targetWorktree.mode, "120000");
    assert.equal(dispositions.get("deleted-staged.txt").targetIndex.mode, null);
    assert.equal(dispositions.get("deleted-unstaged.txt").targetIndex.mode, "100644");

    const plan = reanchorPlan(fixture, first);
    snapshotReanchorSource(fixture, plan);
    const preMaterialization = captureRepositoryBoundary(fixture);
    const materialized = materializeProjectedReanchorObjects({
      repository: fixture.repository,
      plan,
    });
    assert.deepEqual(materialized, verifyMaterializedReanchorObjects({
      repository: fixture.repository,
      plan,
    }));
    const postMaterialization = captureRepositoryBoundary(fixture);
    assert.notEqual(postMaterialization.objects, preMaterialization.objects,
      "authorized materialization adds the sealed objects");
    assert.equal(postMaterialization.refs, preMaterialization.refs);
    assert.equal(postMaterialization.index, preMaterialization.index);
    assert.equal(postMaterialization.dirtEvidenceDigest,
      preMaterialization.dirtEvidenceDigest);
    assert.equal(postMaterialization.stateExists, false);

    writeFileSync(path.join(fixture.repository, "staged.txt"), "foreign-drift\n");
    assert.throws(() => convergeRetiredAbandonedOwnedDirtLocalReanchor({
      repository: fixture.repository,
      branch: fixture.branch,
      plan,
    }), /recognized local reanchor index\/worktree state/u);
    assert.equal(fixture.git(["rev-parse", "HEAD"]), fixture.fenceSha);
    assert.equal(fixture.git(["rev-parse", `refs/heads/${fixture.branch}`]),
      fixture.fenceSha);
    writeFileSync(path.join(fixture.repository, "staged.txt"), "source-staged\n");

    const result = convergeRetiredAbandonedOwnedDirtLocalReanchor({
      repository: fixture.repository,
      branch: fixture.branch,
      plan,
    });
    assert.equal(result.targetLaneRevision, first.coordination.commitSha);
    assert.equal(fixture.git(["rev-parse", "HEAD"]), first.coordination.commitSha);
    assert.equal(fixture.git(["rev-parse", `refs/heads/${fixture.branch}`]),
      first.coordination.commitSha);
    assert.equal(fixture.git(["write-tree"]), first.targetIndexTreeSha);
    assert.equal(fixture.git(["diff", "--name-only", "--diff-filter=U"]), "");
    assert.equal(captureActiveOwnedDirtEvidence({ repository: fixture.repository })
      .evidenceDigest, first.targetDirt.evidenceDigest);

    assert.equal(readFileSync(path.join(fixture.repository, "protected-only.txt"), "utf8"),
      "protected-only\n");
    assert.equal(readFileSync(path.join(fixture.repository, "protected-added.txt"), "utf8"),
      "protected-added\n");
    assert.equal(existsSync(path.join(fixture.repository, "protected-deleted.txt")), false);
    assert.equal(readFileSync(path.join(fixture.repository, "staged.txt"), "utf8"),
      "source-staged\n");
    assert.equal(readFileSync(path.join(fixture.repository, "unstaged.txt"), "utf8"),
      "source-unstaged\n");
    assert.equal(readFileSync(path.join(fixture.repository, "both.txt"), "utf8"),
      "source-both-worktree\n");
    assert.equal(existsSync(path.join(fixture.repository, "deleted-staged.txt")), false);
    assert.equal(existsSync(path.join(fixture.repository, "deleted-unstaged.txt")), false);
    assert.equal(lstatSync(path.join(fixture.repository, "exec.sh")).mode & 0o111, 0o111);
    assert.equal(readlinkSync(path.join(fixture.repository, "link.txt")), "source-target");
    assert.equal(readFileSync(path.join(fixture.repository, "untracked.txt"), "utf8"),
      "source-untracked\n");
    assert.equal(readFileSync(path.join(fixture.repository, "overlap.txt"), "utf8"),
      "source-overlap\n");
    assert.equal(readFileSync(path.join(fixture.repository, "ignored/cache.bin"), "utf8"),
      "ignored-local-state\n");
    assert.match(fixture.git(["status", "--porcelain=v1", "--untracked-files=all"]),
      /\?\? untracked\.txt/u);
  });

test("marker projection rejects writer-lease drift before edit or no-op adoption",
  { timeout: 60_000 }, t => {
    const fixture = markerProjectionFixture(t);
    let observedLease = fixture.target.lease;
    let registryLease = fixture.target.lease;
    let driftAtProjectionFence = true;
    let driftAfterPullRead = false;
    let pullRequestEdits = 0;
    let pullRequestReads = 0;
    let readsAtProjectionFence = null;
    const foreignLease = {
      ...fixture.target.lease,
      sessionId: "foreign-marker-session",
    };
    const leaseStore = {
      read: () => observedLease,
      withRegistryLock(action) {
        return action({
          schema: "agentic-writer-lease-registry/v2",
          revision: 7,
          leases: { [fixture.plan.evidence.lease.branch]: registryLease },
        });
      },
    };
    const adapter = createRetiredAbandonedOwnedDirtSuccessorRecoveryRepositoryAdapter({
      repository: fixture.repository,
      branch: fixture.plan.evidence.lease.branch,
      sourceTaskAuthorityFile: fixture.sourceCapabilityFile,
      targetTaskAuthorityFile: fixture.targetCapabilityFile,
    }, {
      git: fixture.adapterGit,
      leaseStore,
      controllerWitness: () => fixture.plan.evidence.controller,
      now: () => new Date(fixture.verifiedAt),
      verify: fixture.verify,
      beforePullRequestMarkerProjectionFence() {
        if (!driftAtProjectionFence) return;
        readsAtProjectionFence = pullRequestReads;
        observedLease = foreignLease;
        registryLease = foreignLease;
      },
      gh(args) {
        if (args[0] === "pr" && args[1] === "view") {
          if (args.includes("autoMergeRequest")) {
            return JSON.stringify({ autoMergeRequest: null });
          }
          pullRequestReads += 1;
          const response = JSON.stringify(fixture.pullRequest);
          if (driftAfterPullRead) observedLease = foreignLease;
          return response;
        }
        if (args[0] === "pr" && args[1] === "edit") {
          pullRequestEdits += 1;
          return "";
        }
        throw new Error(`Unexpected gh command: ${args.join(" ")}`);
      },
    });

    assert.throws(() => adapter.projectPullRequestMarker({
      plan: fixture.plan,
      intent: fixture.intent,
    }), /writer lease changed|deterministic local target lease/iu);
    assert.equal(pullRequestReads, readsAtProjectionFence,
      "registry drift must fail before any marker-phase PR observation");
    assert.equal(pullRequestEdits, 0,
      "registry drift must not project a foreign writer marker");

    observedLease = fixture.target.lease;
    registryLease = fixture.target.lease;
    driftAtProjectionFence = false;
    driftAfterPullRead = true;
    assert.throws(() => adapter.projectPullRequestMarker({
      plan: fixture.plan,
      intent: fixture.intent,
    }), /deterministic local target lease/u);
    assert.equal(pullRequestEdits, 0,
      "an already exact marker is not a no-op success after local target drift");

    observedLease = foreignLease;
    registryLease = foreignLease;
    driftAfterPullRead = false;
    assert.equal(adapter.reconcile({
      plan: fixture.plan,
      intent: fixture.intent,
      phase: "pr-marker",
    }), null, "reconciliation must not adopt a marker for a non-deterministic local target");
    assert.equal(pullRequestEdits, 0);
  });

test("CLI keeps plans private and external, and invalid authorization creates no state",
  { timeout: 30_000 }, async t => {
    const fixture = disposableRepository(t, "cli");
    chmodSync(fixture.repository, 0o700);
    const privateRoot = path.join(fixture.root, "private");
    mkdirSync(privateRoot, { mode: 0o700 });
    chmodSync(privateRoot, 0o700);
    const sourceCapability = privateJson(privateRoot, "source.json", { source: true });
    const targetCapability = privateJson(privateRoot, "target.json", { target: true });
    const targetManifest = manifest(TARGET_PATHS);
    const targetManifestFile = privateJson(privateRoot, "manifest.json", targetManifest);
    const output = path.join(privateRoot, "plan.json");
    const plan = buildRecoveryPlan({
      evidence: evidenceFixture(),
      operatorSessionId: "successor-session",
      ttlSeconds: 1800,
    });
    let adapterOptions = null;
    const summary = await runRetiredAbandonedOwnedDirtSuccessorRecoveryCli([
      "plan",
      `--repository=${fixture.repository}`,
      "--operator-session=successor-session",
      `--source-task-authority=${sourceCapability}`,
      `--target-task-authority=${targetCapability}`,
      `--target-manifest=${targetManifestFile}`,
      `--output=${output}`,
    ], {
      createAdapter(options) {
        adapterOptions = options;
        return Object.freeze({});
      },
      createController() {
        return Object.freeze({ plan: async () => plan });
      },
    });
    assert.equal(summary.planDigest, plan.planDigest);
    assert.equal(summary.planOutput,
      path.join(realpathSync(privateRoot), path.basename(output)));
    assert.equal(lstatSync(output).mode & 0o777, 0o600);
    assert.equal(canonicalJson(JSON.parse(readFileSync(output, "utf8"))),
      canonicalJson(plan));
    assert.equal(adapterOptions.sourceTaskAuthorityFile, realpathSync(sourceCapability));
    assert.equal(adapterOptions.targetTaskAuthorityFile, realpathSync(targetCapability));

    const inRepositoryOutput = path.join(fixture.repository, "forbidden-plan.json");
    await assert.rejects(() => runRetiredAbandonedOwnedDirtSuccessorRecoveryCli([
      "plan",
      `--repository=${fixture.repository}`,
      "--operator-session=successor-session",
      `--source-task-authority=${sourceCapability}`,
      `--target-task-authority=${targetCapability}`,
      `--target-manifest=${targetManifestFile}`,
      `--output=${inRepositoryOutput}`,
    ], {
      createAdapter: () => Object.freeze({}),
      createController: () => Object.freeze({ plan: async () => plan }),
    }), /outside every repository worktree and Git directory/u);
    assert.equal(existsSync(inRepositoryOutput), false);

    chmodSync(sourceCapability, 0o644);
    await assert.rejects(() => runRetiredAbandonedOwnedDirtSuccessorRecoveryCli([
      "plan",
      `--repository=${fixture.repository}`,
      "--operator-session=successor-session",
      `--source-task-authority=${sourceCapability}`,
      `--target-task-authority=${targetCapability}`,
      `--target-manifest=${targetManifestFile}`,
      `--output=${path.join(privateRoot, "must-not-exist.json")}`,
    ]), /owner-only regular non-symlink file/u);
    chmodSync(sourceCapability, 0o600);

    const stateRoot = path.join(fixture.repository, ".git", "agentic-canvas-os");
    assert.equal(existsSync(stateRoot), false);
    await assert.rejects(() => runRetiredAbandonedOwnedDirtSuccessorRecoveryCli([
      "run",
      `--repository=${fixture.repository}`,
      "--operator-session=successor-session",
      `--source-task-authority=${sourceCapability}`,
      `--target-task-authority=${targetCapability}`,
      `--target-manifest=${targetManifestFile}`,
      `--plan=${output}`,
      `--authorization=authorize retired-abandoned-owned-dirt-successor-recovery ${hex("wrong-cli-authorization")}`,
    ], {
      adapterDependencies: {
        controllerWitness: {
          headSha: sha("cli-controller"),
          implementationDigest: hex("cli-controller-implementation"),
        },
        leaseStore: { read: () => { throw new Error("lease must not be read"); } },
      },
    }), /requires exact authorization/u);
    assert.equal(existsSync(stateRoot), false,
      "invalid authorization must not create a lock, journal, or state directory");
  });

function evidenceFixture({
  targetPaths = TARGET_PATHS,
  targetGeneration = 2,
  dirtyOverlapPaths = ["src/new-runtime/new.mjs"],
  sourceFenceParentSha = null,
  orderingPaths = [],
} = {}) {
  const source = sourceFixture();
  const targetManifest = manifest(targetPaths);
  const targetCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"2".repeat(64)}`,
    generation: targetGeneration,
    issuedAt: "2026-08-25T00:00:00.000Z",
  });
  const sourceProof = selectRetiredAbandonedClaimProof(source);
  const liveInventory = assertNoLiveRetiredAbandonedOverlap({
    claims: [],
    sourceProof,
    targetDeclaredWriteSet: targetManifest.declaredWriteSet,
  });
  const dirt = dirtFixture(source.lease.fenceSha);
  const sourceTreeSha = sha("source-base-tree");
  const protectedMainSha = sha("protected-main");
  const protectedMainTreeSha = sha("protected-main-tree");
  const changedPaths = [...orderingPaths, "docs/protected-main.md",
    "src/new-runtime/new.mjs"].sort(comparePaths);
  const targetEpochProof = selectTargetCloudLeaseEpochProof({
    entries: source.entries,
    sourceProof,
    targetDeclaredWriteSet: targetManifest.declaredWriteSet,
  });
  const coordination = buildDeterministicCoordinationCommit({
    sourceFenceSha: source.lease.fenceSha,
    protectedMainSha,
    protectedMainTreeSha,
    sourceClaimId: sourceProof.claimId,
    dirtEvidenceDigest: dirt.evidenceDigest,
    timestamp: sourceProof.retiredAt,
  });
  const baseDocBlob = sha("base-doc");
  const protectedDocBlob = sha("protected-doc");
  const protectedNewBlob = sha("protected-new-runtime");
  const protectedOnlyDispositions = orderingPaths.map(relativePath => ({
    path: relativePath,
    base: { mode: "100644", blob: sha(`base:${relativePath}`) },
    protected: { mode: "100644", blob: sha(`protected:${relativePath}`) },
    sourceIndex: { mode: "100644", blob: sha(`base:${relativePath}`) },
    sourceWorktree: { type: "file", mode: "100644", blob: sha(`base:${relativePath}`) },
    targetIndex: { mode: "100644", blob: sha(`protected:${relativePath}`) },
    targetWorktree: { type: "file", mode: "100644",
      blob: sha(`protected:${relativePath}`) },
    indexDisposition: "protected",
    worktreeDisposition: "protected",
  }));
  const dispositions = [...protectedOnlyDispositions, {
    path: "docs/protected-main.md",
    base: { mode: "100644", blob: baseDocBlob },
    protected: { mode: "100644", blob: protectedDocBlob },
    sourceIndex: { mode: "100644", blob: baseDocBlob },
    sourceWorktree: { type: "file", mode: "100644", blob: baseDocBlob },
    targetIndex: { mode: "100644", blob: protectedDocBlob },
    targetWorktree: { type: "file", mode: "100644", blob: protectedDocBlob },
    indexDisposition: "protected",
    worktreeDisposition: "protected",
  }, {
    path: "src/new-runtime/new.mjs",
    base: { mode: null, blob: null },
    protected: { mode: "100644", blob: protectedNewBlob },
    sourceIndex: { mode: null, blob: null },
    sourceWorktree: { type: "file", mode: "100644", blob: dirt.entries[0].worktreeBlob },
    targetIndex: { mode: "100644", blob: protectedNewBlob },
    targetWorktree: { type: "file", mode: "100644", blob: dirt.entries[0].worktreeBlob },
    indexDisposition: "protected",
    worktreeDisposition: "source",
  }].toReversed();
  const targetDirt = targetDirtFixture({
    headSha: coordination.commitSha,
    protectedBlob: protectedNewBlob,
    worktreeBlob: dirt.entries[0].worktreeBlob,
  });
  return buildRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence({
    branch: source.lease.branch,
    headSha: source.lease.fenceSha,
    treeSha: sourceTreeSha,
    controller: {
      headSha: sha("protected-controller"),
      implementationDigest: hex("controller-implementation"),
    },
    sourceFence: {
      headSha: source.lease.fenceSha,
      parentSha: sourceFenceParentSha || source.lease.baseSha,
      treeSha: sourceTreeSha,
      baseTreeSha: sourceTreeSha,
    },
    targetProtectedMain: {
      sourceBaseSha: source.lease.baseSha,
      protectedMainSha,
      treeSha: protectedMainTreeSha,
      mergeBaseSha: source.lease.baseSha,
      ancestryVerified: true,
      localMainSha: protectedMainSha,
      localOriginMainSha: protectedMainSha,
      remoteMainSha: protectedMainSha,
      changedPaths,
      changedPathsDigest: digestValue(changedPaths),
      dirtyOverlapPaths,
      dirtyOverlapPathsDigest: digestValue(dirtyOverlapPaths.toSorted(comparePaths)),
    },
    reanchor: {
      coordination,
      sourceIndexTreeSha: sha("source-index-tree"),
      sourceWorktreeTreeSha: sha("source-worktree-tree"),
      targetIndexTreeSha: sha("target-index-tree"),
      targetWorktreeTreeSha: sha("target-worktree-tree"),
      dispositions,
      ignoredRetention: {
        disposition: "none",
        pathCount: 0,
        pathsDigest: digestValue([]),
        targetHead: protectedMainSha,
        ignoreRulesChanged: false,
        pathComparison: {
          caseFold: false,
          caseFoldStrategy: "none",
          unicodeNormalization: "NFC",
        },
      },
      targetDirt,
    },
    lease: source.lease,
    leaseDigest: writerLeaseDigest(source.lease),
    sourceClaim: sourceProof,
    dirt,
    pullRequest: {
      id: "PR_node_835",
      url: source.lease.pullRequestUrl,
      number: 835,
      headSha: source.lease.fenceSha,
      baseSha: source.lease.baseSha,
      bodyDigest: hex("pull-body"),
      bodyRemainderDigest: hex("pull-body-remainder"),
      isDraft: true,
      state: "CLOSED",
    },
    pullRequestMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(source.lease)),
    liveInventory,
    targetManifest,
    targetEpochProof,
    targetCapability: projectTaskAuthorityCapability(targetCapability),
  });
}

function sourceFixture() {
  const sourceManifest = manifest(SOURCE_PATHS);
  const claimId = hex("source-claim");
  const claimDigest = hex("source-claim-fence");
  const baseSha = sha("base");
  const fenceSha = sha("fence");
  const reviewRequestId = "github-pull-request:PR_node_835";
  const leaseWithoutTask = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 494,
    sessionId: "source-session",
    device: "device",
    scope: "migration",
    branch: "agent/device/migration",
    worktreePath: "/private/worktree",
    baseSha,
    fenceSha,
    pullRequestUrl: "https://github.com/owner/repository/pull/835",
    autoDelivery: true,
    runtimeRequired: true,
    acquiredAt: "2026-08-24T00:00:00.000Z",
    heartbeatAt: "2026-08-24T00:15:00.000Z",
    expiresAt: "2026-08-24T00:30:00.000Z",
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "migration",
      declaredWriteSet: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest,
      manifestDigest: sourceManifest.manifestDigest,
      planReceiptDigest: hex("plan-receipt"),
      admissionReceiptDigest: hex("admission-receipt"),
      existingLaneStateDigest: hex("existing-lane"),
      admittedReportDigest: hex("admitted-report"),
      preservationReceiptDigest: hex("preservation"),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "owner/controller",
      targetRepository: "owner/repository",
      claimId,
      claimDigest,
      ledgerRevision: sha("ledger-ref"),
      claimLedgerRevision: hex("claim-ledger"),
      canonicalBaseSha: baseSha,
      laneRevision: fenceSha,
      cloudDeclaredWriteScope: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest,
      deviceId: "device-id",
      sessionId: "session-id",
      reviewRequestId,
      leaseEpoch: 1,
      transitionCounter: 2,
      state: "active",
      manifestDigest: sourceManifest.manifestDigest,
      expiresAt: "2026-08-24T00:30:00.000Z",
    },
  };
  const sourceCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"1".repeat(64)}`,
    generation: 1,
    issuedAt: "2026-08-24T00:00:00.000Z",
  });
  const taskAuthority = createTaskAuthorityBinding({
    capability: sourceCapability,
    lease: leaseWithoutTask,
    bindingMode: "claim",
    boundAt: "2026-08-24T00:00:00.000Z",
  });
  const lease = { ...leaseWithoutTask, taskAuthority };
  const common = {
    claimId,
    repositoryId: "repository:1",
    actorId: "actor:1",
    workItemId: "work-item:1",
    canonicalBaseRevision: baseSha,
    laneRevision: fenceSha,
    declaredWriteScope: sourceManifest.declaredWriteSet,
    writeSetDigest: sourceManifest.writeSetDigest,
    leaseEpoch: 1,
    reviewRequestId,
  };
  const sourceCore = { ...common, state: "current", transitionCounter: 2 };
  const terminalCore = {
    ...common,
    state: "retired",
    transitionCounter: 3,
    retirement: {
      reason: "abandoned",
      finalRevision: fenceSha,
      reviewRequestId,
      retiredAt: "2026-08-25T00:00:00.000Z",
    },
  };
  return {
    lease,
    entries: [
      {
        claimId,
        claimDigest,
        digest: hex("source-transition"),
        claimCore: sourceCore,
      },
      {
        claimId,
        repositoryId: common.repositoryId,
        claimDigest: hex("terminal-fence"),
        digest: hex("terminal-transition"),
        sequence: 3,
        idempotencyKey: hex("retire-idempotency"),
        requestDigest: hex("retire-request"),
        evaluationTime: "2026-08-25T00:00:00.000Z",
        claimCore: terminalCore,
      },
    ],
  };
}

function dirtFixture(headSha) {
  const entry = {
    path: "src/new-runtime/new.mjs",
    staged: false,
    unstaged: false,
    untracked: true,
    headMode: null,
    headBlob: null,
    indexMode: null,
    indexBlob: null,
    worktreeType: "file",
    worktreeMode: "100644",
    worktreeBlob: sha("dirty-blob"),
  };
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha,
    entries: [entry],
    pathCount: 1,
    stagedPathCount: 0,
    unstagedPathCount: 0,
    untrackedPathCount: 1,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function targetDirtFixture({ headSha, protectedBlob, worktreeBlob }) {
  const entry = {
    path: "src/new-runtime/new.mjs",
    staged: false,
    unstaged: true,
    untracked: false,
    headMode: "100644",
    headBlob: protectedBlob,
    indexMode: "100644",
    indexBlob: protectedBlob,
    worktreeType: "file",
    worktreeMode: "100644",
    worktreeBlob,
  };
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha,
    entries: [entry],
    pathCount: 1,
    stagedPathCount: 0,
    unstagedPathCount: 1,
    untrackedPathCount: 0,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function manifest(paths) {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "migration",
    paths,
  });
}

function receipt(label) {
  return { receiptDigest: hex(`${label}-receipt`) };
}

function disposableRepository(t, label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `agentic-${label}-`));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  const git = gitClient(repository);
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Agentic Test"]);
  git(["config", "user.email", "agentic-test@localhost"]);
  writeFileSync(path.join(repository, "README.md"), "base\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "base"]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repository, git };
}

function reanchorRepository(t, label) {
  const fixture = disposableRepository(t, label);
  const files = {
    ".gitignore": "ignored/\n",
    "protected-only.txt": "base-protected-only\n",
    "protected-deleted.txt": "base-protected-deleted\n",
    "staged.txt": "base-staged\n",
    "unstaged.txt": "base-unstaged\n",
    "both.txt": "base-both\n",
    "deleted-staged.txt": "base-deleted-staged\n",
    "deleted-unstaged.txt": "base-deleted-unstaged\n",
    "exec.sh": "#!/bin/sh\necho base\n",
    "overlap.txt": "base-overlap\n",
  };
  for (const [relativePath, bytes] of Object.entries(files)) {
    writeFileSync(path.join(fixture.repository, relativePath), bytes);
  }
  symlinkSync("base-target", path.join(fixture.repository, "link.txt"));
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-m", "historical base"]);
  const baseSha = fixture.git(["rev-parse", "HEAD"]);
  const baseTreeSha = fixture.git(["show", "-s", "--format=%T", baseSha]);

  writeFileSync(path.join(fixture.repository, "protected-only.txt"), "protected-only\n");
  writeFileSync(path.join(fixture.repository, "protected-added.txt"), "protected-added\n");
  writeFileSync(path.join(fixture.repository, "overlap.txt"), "protected-overlap\n");
  unlinkSync(path.join(fixture.repository, "protected-deleted.txt"));
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-m", "protected main advance"]);
  const protectedMainSha = fixture.git(["rev-parse", "HEAD"]);
  const protectedMainTreeSha = fixture.git([
    "show", "-s", "--format=%T", protectedMainSha,
  ]);

  const branch = `agent/test/${label}`;
  fixture.git(["switch", "-c", branch, baseSha]);
  fixture.git(["commit", "--allow-empty", "-m", "empty coordination fence"]);
  const fenceSha = fixture.git(["rev-parse", "HEAD"]);
  assert.equal(fixture.git(["show", "-s", "--format=%T", fenceSha]), baseTreeSha);

  writeFileSync(path.join(fixture.repository, "staged.txt"), "source-staged\n");
  fixture.git(["add", "staged.txt"]);
  writeFileSync(path.join(fixture.repository, "unstaged.txt"), "source-unstaged\n");
  writeFileSync(path.join(fixture.repository, "both.txt"), "source-both-index\n");
  fixture.git(["add", "both.txt"]);
  writeFileSync(path.join(fixture.repository, "both.txt"), "source-both-worktree\n");
  fixture.git(["rm", "--quiet", "deleted-staged.txt"]);
  unlinkSync(path.join(fixture.repository, "deleted-unstaged.txt"));
  chmodSync(path.join(fixture.repository, "exec.sh"), 0o755);
  fixture.git(["add", "exec.sh"]);
  unlinkSync(path.join(fixture.repository, "link.txt"));
  symlinkSync("source-target", path.join(fixture.repository, "link.txt"));
  writeFileSync(path.join(fixture.repository, "untracked.txt"), "source-untracked\n");
  writeFileSync(path.join(fixture.repository, "source-added-staged.txt"),
    "source-added-staged\n");
  fixture.git(["add", "source-added-staged.txt"]);
  writeFileSync(path.join(fixture.repository, "overlap.txt"), "source-overlap\n");
  mkdirSync(path.join(fixture.repository, "ignored"));
  writeFileSync(path.join(fixture.repository, "ignored/cache.bin"),
    "ignored-local-state\n");

  const dirt = captureActiveOwnedDirtEvidence({ repository: fixture.repository });
  const changedPaths = fixture.git([
    "diff", "--name-only", "--no-renames", "-z", baseSha, protectedMainSha, "--",
  ]).split("\0").filter(Boolean).toSorted();
  const dirtyPaths = new Set(dirt.entries.map(entry => entry.path));
  const ignoredRetention = proveIgnoredStateRetention({
    localHead: baseSha,
    originHead: protectedMainSha,
    gitText: fixture.git,
    gitOptional: fixture.git.optional,
  });
  return {
    ...fixture,
    branch,
    baseSha,
    baseTreeSha,
    fenceSha,
    protectedMainSha,
    protectedMainTreeSha,
    dirt,
    changedPaths,
    dirtyOverlapPaths: changedPaths.filter(item => dirtyPaths.has(item)),
    ignoredRetention,
    sourceClaim: Object.freeze({
      claimId: hex(`${label}-retired-claim`),
      retiredAt: "2026-08-25T00:00:00.000Z",
    }),
  };
}

function projectReanchor(fixture) {
  return projectRetiredAbandonedOwnedDirtCurrentBaseReanchor({
    repository: fixture.repository,
    dirt: fixture.dirt,
    sourceFence: {
      headSha: fixture.fenceSha,
      parentSha: fixture.baseSha,
      treeSha: fixture.baseTreeSha,
      baseTreeSha: fixture.baseTreeSha,
    },
    targetProtectedMain: {
      sourceBaseSha: fixture.baseSha,
      protectedMainSha: fixture.protectedMainSha,
      treeSha: fixture.protectedMainTreeSha,
      changedPaths: fixture.changedPaths,
      dirtyOverlapPaths: fixture.dirtyOverlapPaths,
    },
    sourceClaim: fixture.sourceClaim,
    ignoredRetention: fixture.ignoredRetention,
  });
}

function reanchorPlan(fixture, projection) {
  const planDigest = hex(`${fixture.branch}-reanchor-plan`);
  return Object.freeze({
    planDigest,
    sourceClaimId: fixture.sourceClaim.claimId,
    sourceBaseSha: fixture.baseSha,
    sourceFenceSha: fixture.fenceSha,
    targetCanonicalBaseSha: fixture.protectedMainSha,
    targetLaneRevision: projection.coordination.commitSha,
    coordinationCommitSha: projection.coordination.commitSha,
    coordinationTreeSha: projection.coordination.treeSha,
    sourceIndexTreeSha: projection.sourceIndexTreeSha,
    sourceWorktreeTreeSha: projection.sourceWorktreeTreeSha,
    targetIndexTreeSha: projection.targetIndexTreeSha,
    targetWorktreeTreeSha: projection.targetWorktreeTreeSha,
    dispositionsDigest: digestValue(projection.dispositions),
    targetDirtEvidenceDigest: projection.targetDirt.evidenceDigest,
    evidence: Object.freeze({ reanchor: projection }),
  });
}

function snapshotReanchorSource(fixture, plan) {
  return createRetiredAbandonedOwnedDirtSnapshotV2({
    repository: fixture.repository,
    evidence: fixture.dirt,
    claimId: fixture.sourceClaim.claimId,
    planDigest: plan.planDigest,
    timestamp: fixture.sourceClaim.retiredAt,
    expectedIndexTreeSha: plan.sourceIndexTreeSha,
    expectedWorktreeTreeSha: plan.sourceWorktreeTreeSha,
  });
}

function markerProjectionFixture(t) {
  const fixture = reanchorRepository(t, "marker-projection");
  const projection = projectReanchor(fixture);
  const reanchor = reanchorPlan(fixture, projection);
  snapshotReanchorSource(fixture, reanchor);
  materializeProjectedReanchorObjects({
    repository: fixture.repository,
    plan: reanchor,
  });
  convergeRetiredAbandonedOwnedDirtLocalReanchor({
    repository: fixture.repository,
    branch: fixture.branch,
    plan: reanchor,
  });

  const requestedPrivateRoot = path.join(fixture.root, "marker-private");
  mkdirSync(requestedPrivateRoot, { mode: 0o700 });
  const privateRoot = realpathSync(requestedPrivateRoot);
  chmodSync(privateRoot, 0o700);
  const sourceCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"3".repeat(64)}`,
    generation: 1,
    issuedAt: "2026-08-25T00:00:00.000Z",
  });
  const targetCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"4".repeat(64)}`,
    generation: 2,
    issuedAt: "2026-08-25T00:10:00.000Z",
  });
  const sourceCapabilityFile = privateJson(
    privateRoot,
    "source-capability.json",
    sourceCapability,
  );
  const targetCapabilityFile = privateJson(
    privateRoot,
    "target-capability.json",
    targetCapability,
  );
  const source = sourceFixture().lease;
  const { taskAuthority: _sourceTaskAuthority, ...sourceTemplate } = source;
  const targetManifest = manifest(TARGET_PATHS);
  const sourceClaimId = hex("marker-source-claim");
  const recoveryClaimId = hex("marker-recovery-claim");
  const pullRequestId = "PR_marker_projection";
  const reviewRequestId = `github-pull-request:${pullRequestId}`;
  const pullRequestUrl = "https://github.com/acme/repo/pull/7";
  const sourceUnbound = {
    ...sourceTemplate,
    branch: fixture.branch,
    worktreePath: fixture.repository,
    baseSha: fixture.baseSha,
    fenceSha: fixture.fenceSha,
    pullRequestUrl,
    expiresAt: "2099-08-25T01:00:00.000Z",
    cloudAuthority: {
      ...sourceTemplate.cloudAuthority,
      ledgerRepository: "acme/controller",
      targetRepository: "acme/repo",
      claimId: sourceClaimId,
      canonicalBaseSha: fixture.baseSha,
      laneRevision: fixture.fenceSha,
      reviewRequestId,
      expiresAt: "2099-08-25T01:00:00.000Z",
    },
  };
  const sourceTaskAuthority = createTaskAuthorityBinding({
    capability: sourceCapability,
    lease: sourceUnbound,
    boundAt: "2026-08-25T00:00:00.000Z",
  });
  const sourceLease = Object.freeze({
    ...sourceUnbound,
    taskAuthority: sourceTaskAuthority,
  });
  const verifiedAt = "2026-08-25T00:20:00.000Z";
  const expiresAt = "2099-08-25T01:00:00.000Z";
  const ledgerRevision = sha("marker-ledger-revision");
  const ledgerDigest = hex("marker-ledger-digest");
  const claimDigest = hex("marker-claim-fence");
  const claimLedgerRevision = hex("marker-claim-ledger-revision");
  const operationReceiptDigest = hex("marker-operation-receipt");
  const planDigest = hex("marker-projection-plan");
  const claimed = recoveryAdapterEffect("claim", {
    claimId: recoveryClaimId,
    claimDigest: hex("marker-claim-before-bind"),
    transitionCounter: 1,
    claimLedgerRevision: hex("marker-claim-before-bind-ledger"),
    ledgerSequence: 1,
    expiresAt,
    evaluationTime: "2026-08-25T00:15:00.000Z",
    operationReceiptDigest: hex("marker-claim-operation"),
  });
  const authority = Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "acme/controller",
    targetRepository: "acme/repo",
    claimId: recoveryClaimId,
    claimDigest,
    ledgerRevision,
    ledgerDigest,
    claimLedgerRevision,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: fixture.protectedMainSha,
    laneRevision: projection.coordination.commitSha,
    cloudDeclaredWriteScope: targetManifest.declaredWriteSet,
    writeSetDigest: targetManifest.writeSetDigest,
    deviceId: sourceLease.device,
    sessionId: "marker-successor-session",
    reviewRequestId,
    leaseEpoch: 2,
    transitionCounter: 2,
    state: "active",
    expiresAt,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: targetManifest.manifestDigest,
  });
  const sealedVerification = Object.freeze({
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    claimId: recoveryClaimId,
    claimDigest,
    ledgerRevision,
    ledgerDigest,
    canonicalBaseSha: fixture.protectedMainSha,
    laneRevision: projection.coordination.commitSha,
    writeSetDigest: targetManifest.writeSetDigest,
    reviewRequestId,
    receiptDigest: hex("marker-sealed-verification"),
    verifiedAt,
  });
  const bound = recoveryAdapterEffect("bind", {
    authority,
    verification: sealedVerification,
    verificationReceiptDigest: sealedVerification.receiptDigest,
    verifiedAt,
  });
  const controller = {
    headSha: sha("marker-controller-head"),
    implementationDigest: hex("marker-controller-implementation"),
  };
  const protectedMain = {
    sourceBaseSha: fixture.baseSha,
    protectedMainSha: fixture.protectedMainSha,
    treeSha: fixture.protectedMainTreeSha,
    mergeBaseSha: fixture.baseSha,
    ancestryVerified: true,
    localMainSha: fixture.protectedMainSha,
    localOriginMainSha: fixture.protectedMainSha,
    remoteMainSha: fixture.protectedMainSha,
    changedPaths: fixture.changedPaths,
    changedPathsDigest: digestValue(fixture.changedPaths),
    dirtyOverlapPaths: fixture.dirtyOverlapPaths,
    dirtyOverlapPathsDigest: digestValue(fixture.dirtyOverlapPaths),
  };
  const plan = {
    planDigest,
    operatorSessionId: authority.sessionId,
    sourceLeaseDigest: writerLeaseDigest(sourceLease),
    sourceClaimId,
    sourceBaseSha: fixture.baseSha,
    sourceFenceSha: fixture.fenceSha,
    writerLeaseEpoch: sourceLease.epoch,
    targetCanonicalBaseSha: fixture.protectedMainSha,
    targetLaneRevision: projection.coordination.commitSha,
    targetIndexTreeSha: projection.targetIndexTreeSha,
    targetWorktreeTreeSha: projection.targetWorktreeTreeSha,
    targetDirtEvidenceDigest: projection.targetDirt.evidenceDigest,
    targetCloudLeaseEpoch: authority.leaseEpoch,
    targetManifestDigest: targetManifest.manifestDigest,
    targetWriteSetDigest: targetManifest.writeSetDigest,
    targetDeclaredWriteSet: targetManifest.declaredWriteSet,
    targetCapabilityDigest: digestValue(
      projectTaskAuthorityCapability(targetCapability),
    ),
    evidence: {
      lease: sourceLease,
      dirt: fixture.dirt,
      controller,
      targetManifest,
      targetProtectedMain: protectedMain,
      sourceClaim: Object.freeze({ reviewRequestId }),
      reanchor: Object.freeze({
        ignoredRetention: fixture.ignoredRetention,
        targetDirt: projection.targetDirt,
      }),
      pullRequest: {
        id: pullRequestId,
        url: pullRequestUrl,
        number: 7,
        bodyRemainderDigest: null,
      },
    },
  };
  const target = buildRetiredAbandonedOwnedDirtDeterministicTargetLease({
    plan,
    sourceLease,
    bound,
    claimed,
    targetCapability,
  });
  const local = recoveryAdapterEffect("local-cas", {
    targetLeaseDigest: writerLeaseDigest(target.lease),
    targetBindingDigest: target.binding.bindingDigest,
    targetProofDigest: hex("marker-target-proof"),
    cloudAuthorityDigest: digestValue(target.authority),
    mutationAuthorityReceiptDigest: hex("marker-mutation-authority"),
    registryRevision: 6,
  });
  const intent = Object.freeze({
    receipts: Object.freeze({
      "recovery-claimed": Object.freeze({ values: claimed }),
      "recovery-bound": Object.freeze({ values: bound }),
      "local-cas": Object.freeze({ values: local }),
    }),
  });
  const body = updateWriterLeasePullRequestBody(
    "Marker projection fixture.",
    target.lease,
  );
  plan.evidence.pullRequest.bodyRemainderDigest = digestValue(
    writerLeaseBodyRemainder(body),
  );
  const pullRequest = Object.freeze({
    id: pullRequestId,
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: fixture.branch,
    headRefOid: projection.coordination.commitSha,
    headRepository: { nameWithOwner: "acme/repo" },
    baseRefName: "main",
    baseRefOid: fixture.protectedMainSha,
    baseRepository: { nameWithOwner: "acme/repo" },
    body,
  });
  const adapterGit = (args, options = {}) => {
    if (args[0] === "remote" && args[1] === "get-url") {
      return "https://github.com/acme/repo.git";
    }
    if (args[0] === "ls-remote" && args.includes("refs/heads/main")) {
      return `${fixture.protectedMainSha}\trefs/heads/main`;
    }
    if (args[0] === "ls-remote"
      && args.includes(`refs/heads/${fixture.branch}`)) {
      return `${projection.coordination.commitSha}\trefs/heads/${fixture.branch}`;
    }
    if (args[0] === "rev-parse"
      && args.at(-1) === "refs/remotes/origin/main") {
      return fixture.protectedMainSha;
    }
    return fixture.git(args, options);
  };
  adapterGit.optional = (args, options = {}) => {
    try {
      return adapterGit(args, options);
    } catch (error) {
      if (new Set([1, 128]).has(error?.status)) return "";
      throw error;
    }
  };
  return Object.freeze({
    ...fixture,
    plan,
    intent,
    target,
    pullRequest,
    sourceCapabilityFile,
    targetCapabilityFile,
    adapterGit,
    verifiedAt,
    verify: () => markerCloudVerificationResult({
      authority,
      manifest: targetManifest,
      evaluationTime: verifiedAt,
    }),
  });
}

function recoveryAdapterEffect(kind, values) {
  const core = {
    schema: "agentic-retired-abandoned-owned-dirt-successor-recovery-effect/v1",
    kind,
    ...values,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function markerCloudVerificationResult({ authority, manifest, evaluationTime }) {
  const claim = Object.freeze({
    claimId: authority.claimId,
    entrySchema: authority.entrySchema,
    claimIdentitySchema: authority.claimIdentitySchema,
    operationReceiptDigest: authority.operationReceiptDigest,
    state: "current",
    actorId: "github-user:marker",
    deviceId: authority.deviceId,
    sessionId: authority.sessionId,
    repositoryId: "github-repository:marker",
    workItemId: "work-item:marker",
    canonicalBaseRevision: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter,
    heartbeatCounter: 0,
    reviewRequestId: authority.reviewRequestId,
    expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
  });
  const inventoryCore = {
    schema: "agentic-cloud-collaboration-current-claim-inventory/v1",
    ledgerRevision: authority.ledgerRevision,
    ledgerDigest: authority.ledgerDigest,
    evaluationTime,
    claims: [claim],
  };
  const currentClaimInventory = Object.freeze({
    ...inventoryCore,
    claimInventoryDigest: digestValue(inventoryCore),
  });
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision: authority.ledgerRevision,
    ledgerDigest: authority.ledgerDigest,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    contractReceiptDigest: hex("marker-contract-receipt"),
    claimInventoryDigest: currentClaimInventory.claimInventoryDigest,
    evaluationTime,
    findings: [],
  };
  return Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision: authority.ledgerRevision,
    claimDigest: authority.claimDigest,
    claim,
    currentClaimInventory,
    findings: [],
    receipt: Object.freeze({
      ...receiptCore,
      receiptDigest: digestValue(receiptCore),
    }),
  });
}

function assertDisposition(dispositions, relativePath, indexDisposition,
  worktreeDisposition) {
  assert.equal(dispositions.get(relativePath)?.indexDisposition, indexDisposition,
    `${relativePath} index disposition`);
  assert.equal(dispositions.get(relativePath)?.worktreeDisposition, worktreeDisposition,
    `${relativePath} worktree disposition`);
}

function captureRepositoryBoundary(fixture) {
  return Object.freeze({
    objects: fixture.git([
      "cat-file", "--batch-all-objects", "--batch-check=%(objectname)",
    ]).split("\n").filter(Boolean).toSorted().join("\n"),
    refs: fixture.git.optional(["show-ref", "--head"]),
    index: readFileSync(path.join(fixture.repository, ".git", "index")).toString("base64"),
    dirtEvidenceDigest: captureActiveOwnedDirtEvidence({
      repository: fixture.repository,
    }).evidenceDigest,
    stateExists: existsSync(path.join(
      fixture.repository,
      ".git",
      "agentic-canvas-os",
      "retired-abandoned-owned-dirt-successor-recovery",
    )),
  });
}

function privateJson(directory, name, value) {
  const file = path.join(directory, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

function gitClient(repository) {
  const invoke = (argumentsList, options = {}) => String(execFileSync(
    "git",
    argumentsList,
    {
      cwd: repository,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      ...options,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        ...(options.env || {}),
      },
    },
  )).trim();
  invoke.optional = (argumentsList, options = {}) => {
    try {
      return invoke(argumentsList, options);
    } catch (error) {
      if (new Set([1, 128]).has(error?.status)) return "";
      throw error;
    }
  };
  return invoke;
}
