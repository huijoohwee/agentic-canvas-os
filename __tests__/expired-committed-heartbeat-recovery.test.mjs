import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  captureExpiredCommittedHeartbeatSnapshot,
  GITHUB_PULL_REQUEST_BODY_MAX_BYTES,
  recoverExpiredCommittedHeartbeat,
  requireChangedPathsWithinScope,
} from "../scripts/expired-committed-heartbeat-recovery-lib.mjs";
import {
  continueExpiredCommittedHeartbeatCloudAuthority,
} from "../scripts/expired-committed-heartbeat-cloud-authority.mjs";
import { markOperationDerivedCloudVerification } from "../scripts/scoped-lane-admission-lib.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectExpiredCommittedHeartbeatLease,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/expired-heartbeat";
const pullRequestUrl = "https://github.com/org/repo/pull/81";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const headSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const pushedRemoteHeadSha = "e".repeat(40);
const sourceRemoteTreeSha = "7".repeat(40);
const protectedMainSha = "1".repeat(40);
const protectedMainTreeSha = "2".repeat(40);
const sharedAncestorSha = "6".repeat(40);
const sharedAncestorTreeSha = "5".repeat(40);
const refreshedFenceParentSha = "f".repeat(40);
const refreshedDeliveredHeadSha = "9".repeat(40);
const refreshedMainParentSha = "4".repeat(40);
const refreshedFenceTreeSha = "3".repeat(40);

test("captures one exact clean committed descendant inside declared path scope", () => {
  const lease = expiredCloudLease();
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText(),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });
  assert.equal(snapshot.headSha, headSha);
  assert.equal(snapshot.treeSha, treeSha);
  assert.deepEqual(snapshot.changedPaths,
    ["docs/runtime.md", "scripts/recovery/check.mjs"]);
  assert.deepEqual(snapshot.declaredChangedPaths, snapshot.changedPaths);
  assert.deepEqual(snapshot.protectedEquivalentPaths, []);
  assert.equal(snapshot.protectedMainEquivalence.protectedMainSha, protectedMainSha);
  assert.equal(snapshot.protectedMainEquivalence.protectedMainTreeSha, protectedMainTreeSha);
  assert.deepEqual(snapshot.protectedMainEquivalence.entries, []);
  assert.match(snapshot.snapshotDigest, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.recoveryEvidence.sourceEpoch, lease.epoch);
  assert.equal(snapshot.recoveryEvidence.sourceClaimId, lease.cloudAuthority.claimId);
  assert.equal(snapshot.recoveryEvidence.sourceRemoteHeadSha, fenceSha);
});

test("captures mixed authored and protected-main-equivalent descendant paths", () => {
  const lease = expiredCloudLease();
  const protectedBlobSha = "3".repeat(40);
  const protectedEntry = { mode: "100644", blobSha: protectedBlobSha };
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo, branch,
    gitText: recoveryGitText({
      paths: ["scripts/recovery/check.mjs", "docs/protected.md"],
      headEntries: { "docs/protected.md": protectedEntry },
      protectedEntries: { "docs/protected.md": protectedEntry },
    }),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.deepEqual(snapshot.declaredChangedPaths, ["scripts/recovery/check.mjs"]);
  assert.deepEqual(snapshot.protectedEquivalentPaths, ["docs/protected.md"]);
  assert.deepEqual(snapshot.protectedMainEquivalence.entries, [{
    path: "docs/protected.md", headMode: "100644", headBlobSha: protectedBlobSha,
    protectedMode: "100644", protectedBlobSha,
  }]);
  assert.equal(snapshot.recoveryEvidence.protectedEquivalentPathCount, 1);
  assert.equal(snapshot.recoveryEvidence.protectedMainEquivalenceDigest,
    digestValue(snapshot.protectedMainEquivalence));
});

test("captures a descendant when the fence is an exact refresh parent plus empty resume-authoring child", () => {
  const lease = expiredCloudLease();
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      fenceParentSha: refreshedFenceParentSha,
      remoteTreeSha: refreshedFenceTreeSha,
      refreshFenceParentSha: refreshedFenceParentSha,
      refreshDeliveredHeadSha: refreshedDeliveredHeadSha,
      refreshMainParentSha: refreshedMainParentSha,
      refreshFenceTreeSha: refreshedFenceTreeSha,
      fenceSubject: "chore(reviewed-forward-child-recovery): resume authoring",
    }),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(snapshot.headSha, headSha);
  assert.equal(snapshot.remoteHeadSha, fenceSha);
  assert.equal(snapshot.sourceRemotePrefix.treeSha, refreshedFenceTreeSha);
  assert.deepEqual(snapshot.changedPaths,
    ["docs/runtime.md", "scripts/recovery/check.mjs"]);
});

test("captures a descendant when the fence is an authored child over an exact refresh parent", () => {
  const lease = expiredCloudLease();
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      fenceParentSha: refreshedFenceParentSha,
      remoteTreeSha: refreshedFenceTreeSha,
      refreshFenceParentSha: refreshedFenceParentSha,
      refreshDeliveredHeadSha: refreshedDeliveredHeadSha,
      refreshMainParentSha: refreshedMainParentSha,
      refreshFenceTreeSha: "8".repeat(40),
    }),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(snapshot.headSha, headSha);
  assert.equal(snapshot.remoteHeadSha, fenceSha);
  assert.equal(snapshot.sourceRemotePrefix.treeSha, refreshedFenceTreeSha);
  assert.deepEqual(snapshot.changedPaths,
    ["docs/runtime.md", "scripts/recovery/check.mjs"]);
});

test("captures a descendant when the refresh target is the exact source base", () => {
  const lease = expiredCloudLease();
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      fenceParentSha: refreshedFenceParentSha,
      remoteTreeSha: refreshedFenceTreeSha,
      refreshFenceParentSha: refreshedFenceParentSha,
      refreshDeliveredHeadSha: "8".repeat(40),
      refreshMainParentSha: baseSha,
      refreshFenceTreeSha: "7".repeat(40),
    }),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(snapshot.headSha, headSha);
  assert.equal(snapshot.remoteHeadSha, fenceSha);
  assert.equal(snapshot.sourceRemotePrefix.treeSha, refreshedFenceTreeSha);
  assert.deepEqual(snapshot.changedPaths,
    ["docs/runtime.md", "scripts/recovery/check.mjs"]);
});

test("captures the real XR-shaped shared-history prefix and current-main suffix", () => {
  const realSourceBaseSha =
    "8e8bf1a37d164cd30b8d2fdb4d4252b41f2e815d";
  const realFenceSha =
    "0f5f60cf69bae7395d6b0275967e0c49e0f6a11d";
  const realRemoteHeadSha =
    "77c29fca0df014039f5d0f74ce1b6a65333d6c4c";
  const realRemoteTreeSha =
    "391c2656c9cf45568499e2711ed86b63234c7cfb";
  const realProtectedMainSha =
    "f68653d1f1365b957def2d14357fd5984df1f45b";
  const realProtectedMainTreeSha =
    "c99deeac3f45adc8c7cd16f8b798f8b1ccfae711";
  const realSharedAncestorSha =
    "0232f9af7a462067597850889f7304115e9a9017";
  const realSharedAncestorTreeSha =
    "ec3928cb8e76c6e7827c184fd90ca36f7f6aa3b5";
  const lease = leaseWithHistory(leaseWithDeclaredWriteSet(
    expiredCloudLease(),
    [
      "path:docs/workspace-seeds",
      "semantic:expired-heartbeat",
    ],
  ), {
    sourceBaseSha: realSourceBaseSha,
    sourceFenceSha: realFenceSha,
  });
  const authoredPath =
    "docs/workspace-seeds/knowgrph-physics-playground-demo.md";
  const protectedPath =
    "docs/runtime-readiness-contract.md";
  const sharedHistoryBlobSha =
    "34be8d82715d4a447cb6c63166215de6c34ad95f";
  const currentMainBlobSha =
    "b410b05f096b9af2aedd04c1facf9f8a4df32c7b";
  const sharedHistoryEntry = {
    mode: "100644",
    blobSha: sharedHistoryBlobSha,
  };
  const currentMainEntry = {
    mode: "100644",
    blobSha: currentMainBlobSha,
  };
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      sourceBaseRevision: realSourceBaseSha,
      sourceFenceRevision: realFenceSha,
      sourceRemoteHeadSha: realRemoteHeadSha,
      remoteTreeSha: realRemoteTreeSha,
      protectedRevision: realProtectedMainSha,
      protectedTree: realProtectedMainTreeSha,
      sharedAncestorRevision: realSharedAncestorSha,
      sharedAncestorTree: realSharedAncestorTreeSha,
      sourceRemotePaths: [
        authoredPath,
        protectedPath,
      ],
      paths: [authoredPath, protectedPath],
      sourceRemoteEntries: { [protectedPath]: sharedHistoryEntry },
      sharedAncestorEntries: { [protectedPath]: sharedHistoryEntry },
      headEntries: { [protectedPath]: currentMainEntry },
      protectedEntries: { [protectedPath]: currentMainEntry },
    }),
    gitOptional: () =>
      `${realRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease, {
      headRefOid: realRemoteHeadSha,
    }),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(snapshot.remoteHeadSha, realRemoteHeadSha);
  assert.equal(snapshot.pullRequestHeadSha, realRemoteHeadSha);
  assert.equal(
    snapshot.recoveryEvidence.sourceRemoteHeadSha,
    realRemoteHeadSha,
  );
  assert.deepEqual(snapshot.changedPaths, [
    protectedPath,
    authoredPath,
  ]);
  assert.deepEqual(snapshot.declaredChangedPaths, [
    authoredPath,
  ]);
  assert.deepEqual(snapshot.protectedEquivalentPaths, [
    protectedPath,
  ]);
  assert.equal(snapshot.sourceRemotePrefix.treeSha, realRemoteTreeSha);
  assert.deepEqual(snapshot.sourceRemotePrefix.changedPaths, [
    protectedPath,
    authoredPath,
  ]);
  assert.deepEqual(snapshot.sourceRemotePrefix.declaredChangedPaths, [
    authoredPath,
  ]);
  assert.deepEqual(snapshot.sourceRemotePrefix.protectedEquivalentPaths, [
    protectedPath,
  ]);
  assert.equal(
    snapshot.recoveryEvidence.sourceRemoteSharedAncestorEquivalenceDigest,
    digestValue(snapshot.sourceRemotePrefix.sharedAncestorEquivalence),
  );
  assert.equal(
    snapshot.sourceRemotePrefix.sharedAncestorEquivalence.sharedAncestorSha,
    realSharedAncestorSha,
  );
  assert.equal(
    snapshot.sourceRemotePrefix.sharedAncestorEquivalence.protectedMainSha,
    realProtectedMainSha,
  );
  assert.deepEqual(
    snapshot.sourceRemotePrefix.sharedAncestorEquivalence.entries,
    [{
      path: protectedPath,
      headMode: "100644",
      headBlobSha: sharedHistoryBlobSha,
      sharedAncestorMode: "100644",
      sharedAncestorBlobSha: sharedHistoryBlobSha,
    }],
  );
  assert.equal(
    snapshot.protectedMainEquivalence.entries[0].headBlobSha,
    currentMainBlobSha,
  );
});

test("published prefix rejects an unauthorized path hidden by a local revert", () => {
  const lease = expiredCloudLease();
  const remoteOnlyPath = "docs/hidden-remote-change.md";
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: [
        "scripts/recovery/check.mjs",
        remoteOnlyPath,
      ],
      sourceRemoteEntries: {
        [remoteOnlyPath]: {
          mode: "100644",
          blobSha: "8".repeat(40),
        },
      },
      sharedAncestorEntries: {
        [remoteOnlyPath]: {
          mode: "100644",
          blobSha: "9".repeat(40),
        },
      },
      headEntries: {
        [remoteOnlyPath]: {
          mode: "100644",
          blobSha: "9".repeat(40),
        },
      },
      protectedEntries: {
        [remoteOnlyPath]: {
          mode: "100644",
          blobSha: "9".repeat(40),
        },
      },
      paths: ["scripts/recovery/check.mjs"],
    }),
    gitOptional: () => `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease, {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  }), /differs from its protected-main shared ancestor/);
});

test("published prefix cannot substitute current-main bytes for shared-history bytes", () => {
  const lease = expiredCloudLease();
  const remoteOnlyPath = "docs/current-main-only.md";
  const currentEntry = { mode: "100644", blobSha: "9".repeat(40) };
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: ["scripts/recovery/check.mjs", remoteOnlyPath],
      sourceRemoteEntries: { [remoteOnlyPath]: currentEntry },
      sharedAncestorEntries: {
        [remoteOnlyPath]: { mode: "100644", blobSha: "8".repeat(40) },
      },
      headEntries: { [remoteOnlyPath]: currentEntry },
      protectedEntries: { [remoteOnlyPath]: currentEntry },
      paths: ["scripts/recovery/check.mjs", remoteOnlyPath],
    }),
    gitOptional: () => `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease, {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  }), /differs from its protected-main shared ancestor/);
});

test("snapshot fails closed on marker, remote, dirt, ancestry, and path drift", () => {
  const lease = expiredCloudLease();
  const base = {
    repo, branch,
    gitText: recoveryGitText(),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  };

  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    ghText: () => pullRequestJson({ ...lease, epoch: lease.epoch + 1 }),
  }), /marker differs/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitOptional: () => `${"e".repeat(40)}\trefs/heads/${branch}`,
  }), /exact open draft ownership pull request/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({ dirt: "?? untracked.txt\0" }),
  }), /clean worktree/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({ ancestryError: true }),
  }), /not an ancestor/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      remoteFenceAncestryError: true,
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease, {
      headRefOid: pushedRemoteHeadSha,
    }),
  }), /fence, remote\/PR prefix, and local HEAD ancestry/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      remoteHeadAncestryError: true,
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease, {
      headRefOid: pushedRemoteHeadSha,
    }),
  }), /fence, remote\/PR prefix, and local HEAD ancestry/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({ baseAncestryError: true }),
  }), /protected base is not an ancestor/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({ fenceParentSha: "e".repeat(40) }),
  }), /single-parent fence/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({
      fenceParentSha: refreshedFenceParentSha,
      remoteTreeSha: refreshedFenceTreeSha,
      refreshFenceParentSha: refreshedFenceParentSha,
      refreshDeliveredHeadSha: refreshedDeliveredHeadSha,
      refreshMainParentSha: refreshedMainParentSha,
      refreshFenceTreeSha: refreshedFenceTreeSha,
      fenceSubject: "chore(reviewed-forward-child-recovery): wrong subject",
    }),
  }), /single-parent fence/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({ paths: ["outside.txt"] }),
  }), /does not contain exactly one tracked blob/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({
      paths: Array.from(
        { length: 129 },
        (_, index) => `scripts/recovery/file-${index}.mjs`,
      ),
    }),
  }), /changed-path evidence exceeds/);
});

test("declared path containment is directional", () => {
  const declaredWriteSet = ["path:scripts/recovery", "semantic:expired-heartbeat"];
  assert.doesNotThrow(() => requireChangedPathsWithinScope({
    changedPaths: ["scripts/recovery/check.mjs"],
    declaredWriteSet,
  }));
  assert.throws(() => requireChangedPathsWithinScope({
    changedPaths: ["scripts"],
    declaredWriteSet,
  }), /outside declared write scope/);
  assert.throws(() => requireChangedPathsWithinScope({
    changedPaths: ["scripts-other/check.mjs"],
    declaredWriteSet,
  }), /outside declared write scope/);
});

test("recovery replays an advanced heartbeat after source expiry and restores its admitted manifest", () => {
  const source = liveManifestLease({
    cloudExpiresAt: "2026-08-04T11:30:00.000Z",
  });
  const transportManifestDigest = digestValue({
    declaredWriteSet: source.cloudAuthority.cloudDeclaredWriteScope,
    writeSetDigest: source.cloudAuthority.writeSetDigest,
  });
  assert.notEqual(transportManifestDigest, source.cloudAuthority.manifestDigest);
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: transportManifestDigest,
    useProductionAuthority: true,
  });

  const result = recoverExpiredCommittedHeartbeat(harness.input);

  assert.equal(
    result.lease.cloudAuthority.manifestDigest,
    source.cloudAuthority.manifestDigest,
  );
  assert.equal(
    parseWriterLeasePullRequestBody(harness.remoteBody()).cloudAuthority
      .manifestDigest,
    source.cloudAuthority.manifestDigest,
  );
  assert.equal(harness.localWrites(), 1);
  assert.equal(harness.markerWrites(), 1);
});

test("recovery projects a repeated response-loss transition chain", () => {
  const source = liveManifestLease();
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
    transitionIncrement: 3,
  });

  const result = recoverExpiredCommittedHeartbeat(harness.input);

  assert.equal(result.lease.cloudAuthority.transitionCounter,
    source.cloudAuthority.transitionCounter + 3);
  assert.equal(harness.localWrites(), 1);
  assert.equal(harness.markerWrites(), 1);
});

test("recovery accepts a stale marker one task-authority continuation behind", () => {
  const { currentLease, markerLease } =
    leaseWithTaskAuthorityContinuation(liveManifestLease());
  const harness = recoveryHarness({
    source: currentLease,
    renewedManifestDigest: currentLease.cloudAuthority.manifestDigest,
  });
  harness.input.ghText = () => pullRequestBodyJson(
    harness.markerWrites() > 0
      ? harness.remoteBody()
      : renderWriterLeasePullRequestBody(markerLease),
  );

  const result = recoverExpiredCommittedHeartbeat(harness.input);

  assert.equal(result.lease.taskAuthority.bindingDigest,
    currentLease.taskAuthority.bindingDigest);
  assert.equal(harness.localWrites(), 1);
  assert.equal(harness.markerWrites(), 1);
  assert.equal(parseWriterLeasePullRequestBody(harness.remoteBody())
    .taskAuthority.bindingDigest, currentLease.taskAuthority.bindingDigest);
});

test("recovery rejects arbitrary renewed manifest drift before local CAS or marker mutation", () => {
  const source = liveManifestLease();
  const transportManifestDigest = digestValue({
    declaredWriteSet: source.cloudAuthority.cloudDeclaredWriteScope,
    writeSetDigest: source.cloudAuthority.writeSetDigest,
  });
  const arbitraryManifestDigest = "0".repeat(64);
  assert.notEqual(arbitraryManifestDigest, source.cloudAuthority.manifestDigest);
  assert.notEqual(arbitraryManifestDigest, transportManifestDigest);
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: arbitraryManifestDigest,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /Cloud heartbeat changed the expired lease claim subject/,
  );
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("recovery rejects source manifest drift before cloud, local CAS, or marker mutation", () => {
  const admitted = liveManifestLease();
  const source = {
    ...admitted,
    cloudAuthority: {
      ...admitted.cloudAuthority,
      manifestDigest: "0".repeat(64),
    },
  };
  const transportManifestDigest = digestValue({
    declaredWriteSet: source.cloudAuthority.cloudDeclaredWriteScope,
    writeSetDigest: source.cloudAuthority.writeSetDigest,
  });
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: transportManifestDigest,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /source cloud manifest differs from its admitted manifest/,
  );
  assert.equal(harness.cloudCalls(), 0);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("recovery rejects a missing source manifest before cloud, local CAS, or marker mutation", () => {
  const admitted = liveManifestLease();
  const { manifestDigest: _missing, ...cloudAuthority } =
    admitted.cloudAuthority;
  const source = { ...admitted, cloudAuthority };
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: digestValue({
      declaredWriteSet: cloudAuthority.cloudDeclaredWriteScope,
      writeSetDigest: cloudAuthority.writeSetDigest,
    }),
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /source cloud manifest differs from its admitted manifest/,
  );
  assert.equal(harness.cloudCalls(), 0);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("expired-source replay requires a newer cloud transition", () => {
  const source = liveManifestLease({
    cloudExpiresAt: "2026-08-04T11:30:00.000Z",
  });
  const transportManifestDigest = digestValue({
    declaredWriteSet: source.cloudAuthority.cloudDeclaredWriteScope,
    writeSetDigest: source.cloudAuthority.writeSetDigest,
  });
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: transportManifestDigest,
    transitionIncrement: 0,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /Cloud heartbeat changed the expired lease claim subject/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("expired-source replay adopts repeated current response-loss with stable heartbeat", () => {
  const source = liveManifestLease();
  source.cloudAuthority.heartbeatCounter = 1;
  const recoveryEvidenceDigest = "d".repeat(64);
  const claim = {
    claimId: source.cloudAuthority.claimId,
    entrySchema: source.cloudAuthority.entrySchema,
    claimIdentitySchema: source.cloudAuthority.claimIdentitySchema,
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    canonicalBaseRevision: source.cloudAuthority.canonicalBaseSha,
    laneRevision: source.cloudAuthority.laneRevision,
    declaredWriteScope: source.cloudAuthority.cloudDeclaredWriteScope,
    writeSetDigest: source.cloudAuthority.writeSetDigest,
    leaseEpoch: source.cloudAuthority.leaseEpoch,
    transitionCounter: source.cloudAuthority.transitionCounter + 2,
    heartbeatCounter: source.cloudAuthority.heartbeatCounter,
    reviewRequestId: source.cloudAuthority.reviewRequestId,
    expiresAt: "2026-08-30T13:30:00.000Z",
    fenceRevision: "e".repeat(64),
    transitionDigest: "f".repeat(64),
    operationReceiptDigest: "1".repeat(64),
  };
  const status = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    ledgerRevision: "2".repeat(40),
    ledgerDigest: "3".repeat(64),
    claims: [claim],
  };
  let renewCalls = 0;
  let invokeCalls = 0;
  let replayCalls = 0;

  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    authority: source.cloudAuthority,
    manifest: {
      declaredWriteSet: source.cloudAuthority.cloudDeclaredWriteScope,
      writeSetDigest: source.cloudAuthority.writeSetDigest,
    },
    recoveryEvidenceDigest,
    ttlSeconds: 1800,
    inspect: () => status,
    invoke: () => {
      invokeCalls += 1;
      throw new Error("unexpected cloud mutation");
    },
    renew: () => {
      renewCalls += 1;
      throw new Error("unexpected renewal");
    },
    resolveReplayEvidenceChain: ({ liveClaim }) => {
      replayCalls += 1;
      assert.equal(liveClaim, claim);
      return ["c".repeat(64), recoveryEvidenceDigest];
    },
    verify: ({ authority }) => ({
      authority,
      verification: operationVerification({
        ...authority,
        heartbeatCounter: source.cloudAuthority.heartbeatCounter,
      }),
    }),
  });

  assert.equal(result.authority.transitionCounter, claim.transitionCounter);
  assert.equal(result.authority.claimDigest, claim.fenceRevision);
  assert.equal(result.authority.operationReceiptDigest, claim.operationReceiptDigest);
  assert.equal(result.authority.heartbeatCounter, claim.heartbeatCounter);
  assert.equal(replayCalls, 1);
  assert.equal(renewCalls, 0);
  assert.equal(invokeCalls, 0);
});

test("expired-source replay renews an ordered dormant response-loss chain", () => {
  const source = liveManifestLease();
  source.cloudAuthority.heartbeatCounter = 1;
  const historicalRecoveryEvidenceDigests = ["d".repeat(64), "b".repeat(64)];
  const recoveryEvidenceDigest = "a".repeat(64);
  const liveClaim = cloudClaim({
    source: source.cloudAuthority,
    state: "dormant-preserved",
    transitionCounter: source.cloudAuthority.transitionCounter + 2,
    heartbeatCounter: source.cloudAuthority.heartbeatCounter,
    expiresAt: "2026-08-01T13:30:00.000Z",
    fenceRevision: "e".repeat(64),
    transitionDigest: "f".repeat(64),
    operationReceiptDigest: "1".repeat(64),
  });
  const status = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    ledgerRevision: "2".repeat(40),
    ledgerDigest: "3".repeat(64),
    claims: [liveClaim],
  };
  const invocations = [];

  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    authority: source.cloudAuthority,
    manifest: {
      declaredWriteSet: source.cloudAuthority.cloudDeclaredWriteScope,
      writeSetDigest: source.cloudAuthority.writeSetDigest,
    },
    recoveryEvidenceDigest,
    ttlSeconds: 1800,
    inspect: () => status,
    resolveReplayEvidenceChain: () => historicalRecoveryEvidenceDigests,
    invoke: ({ request }) => {
      invocations.push(request);
      const replay = invocations.length < 3;
      const transitionCounter = source.cloudAuthority.transitionCounter
        + invocations.length;
      const operationReceiptDigest = ["4", "5", "6"][invocations.length - 1].repeat(64);
      const transitionDigest = ["6", "7", "8"][invocations.length - 1].repeat(64);
      const claimDigest = ["8", "9", "a"][invocations.length - 1].repeat(64);
      return recoveryContinuationResult({
        source: source.cloudAuthority,
        transitionCounter,
        heartbeatCounter: source.cloudAuthority.heartbeatCounter,
        expiresAt: replay
          ? "2026-08-01T13:30:00.000Z"
          : "2026-08-30T13:30:00.000Z",
        claimDigest,
        transitionDigest,
        operationReceiptDigest,
        replayed: replay,
        operationKey: request.idempotencyKey,
      });
    },
    renew: () => {
      throw new Error("unexpected renewal");
    },
    verify: ({ authority }) => ({
      authority,
      verification: operationVerification({
        ...authority,
        heartbeatCounter: source.cloudAuthority.heartbeatCounter,
      }),
    }),
  });

  assert.equal(result.authority.transitionCounter,
    source.cloudAuthority.transitionCounter + 3);
  assert.equal(result.authority.heartbeatCounter,
    source.cloudAuthority.heartbeatCounter);
  assert.equal(invocations.length, 3);
  assert.equal(invocations[0].expectedTransitionCounter,
    source.cloudAuthority.transitionCounter);
  assert.equal(invocations[1].expectedTransitionCounter,
    source.cloudAuthority.transitionCounter + 1);
  assert.equal(invocations[2].expectedTransitionCounter,
    source.cloudAuthority.transitionCounter + 2);
  assert.equal(invocations[0].recoveryEvidenceDigest,
    historicalRecoveryEvidenceDigests[0]);
  assert.equal(invocations[1].recoveryEvidenceDigest,
    historicalRecoveryEvidenceDigests[1]);
  assert.equal(invocations[2].recoveryEvidenceDigest,
    recoveryEvidenceDigest);
});

test("oversized recovered marker fails before local CAS or marker publication", () => {
  const source = liveManifestLease();
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
    sourceBodyPrefix: `${"x".repeat(GITHUB_PULL_REQUEST_BODY_MAX_BYTES)}\n`,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /exceeds the 65536-byte GitHub limit before local CAS/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("pull-request drift during size preflight fails before local CAS or marker", () => {
  const source = liveManifestLease();
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
  });
  let reads = 0;
  harness.input.ghText = () => {
    reads += 1;
    const body = reads < 4
      ? harness.remoteBody()
      : `drifted during size preflight\n${harness.remoteBody()}`;
    return pullRequestBodyJson(body);
  };

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /state drifted after recovered marker size preflight and before local CAS/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("renewed authority expiring during preflight fails before local CAS or marker", () => {
  const source = liveManifestLease();
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
  });
  let reads = 0;
  harness.input.now = () => {
    reads += 1;
    return new Date(
      reads <= 3
        ? "2026-08-04T12:00:00.000Z"
        : "2026-08-04T13:31:00.000Z",
    );
  };

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /Cloud heartbeat changed the expired lease claim subject/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("non-equivalent out-of-scope bytes fail before cloud, local CAS, or marker", () => {
  const source = liveManifestLease();
  const harness = recoveryHarness({
    source,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
    recoveryGit: recoveryGitText({
      paths: ["scripts/recovery/check.mjs", "docs/protected.md"],
      headEntries: { "docs/protected.md": { mode: "100644",
        blobSha: "3".repeat(40) } },
      protectedEntries: { "docs/protected.md": { mode: "100755",
        blobSha: "3".repeat(40) } },
    }),
  });
  assert.throws(() => recoverExpiredCommittedHeartbeat(harness.input),
    /differs from fetched protected main/);
  assert.equal(harness.cloudCalls(), 0);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("protected-main ref drift after cloud renewal fails before local CAS or marker", () => {
  const source = liveManifestLease();
  const nextProtectedMainSha = "4".repeat(40);
  const nextProtectedMainTreeSha = "5".repeat(40);
  const stableGit = recoveryGitText();
  let protectedRefReads = 0;
  const recoveryGit = args => {
    const key = args.join(" ");
    if (key === "rev-parse refs/remotes/origin/main") {
      protectedRefReads += 1;
      return protectedRefReads <= 5 ? protectedMainSha : nextProtectedMainSha;
    }
    if (key ===
      `merge-base --all ${fenceSha} ${nextProtectedMainSha}`) {
      return sharedAncestorSha;
    }
    if (key === `merge-base --is-ancestor ${baseSha} ${nextProtectedMainSha}`) return "";
    if (key === `rev-parse ${nextProtectedMainSha}^{tree}`) return nextProtectedMainTreeSha;
    return stableGit(args);
  };
  const harness = recoveryHarness({ source, recoveryGit,
    renewedManifestDigest: source.cloudAuthority.manifestDigest });
  assert.throws(() => recoverExpiredCommittedHeartbeat(harness.input),
    /state drifted after cloud renewal|ref, merge-base, or tree drifted/);
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("published-prefix tree TOCTOU fails after cloud and before local CAS", () => {
  const source = liveManifestLease();
  const stableGit = recoveryGitText();
  const driftedRemoteTreeSha = "8".repeat(40);
  let remoteTreeReads = 0;
  const recoveryGit = args => {
    if (args.join(" ") === `rev-parse ${fenceSha}^{tree}`) {
      remoteTreeReads += 1;
      return remoteTreeReads <= 3
        ? sourceRemoteTreeSha
        : driftedRemoteTreeSha;
    }
    return stableGit(args);
  };
  const harness = recoveryHarness({
    source,
    recoveryGit,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /state drifted after cloud renewal/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("shared-ancestor tree TOCTOU fails after cloud and before local CAS", () => {
  const source = liveManifestLease();
  const stableGit = recoveryGitText();
  const driftedSharedAncestorTreeSha = "8".repeat(40);
  let sharedTreeReads = 0;
  const recoveryGit = args => {
    if (args.join(" ") === `rev-parse ${sharedAncestorSha}^{tree}`) {
      sharedTreeReads += 1;
      return sharedTreeReads <= 2
        ? sharedAncestorTreeSha
        : driftedSharedAncestorTreeSha;
    }
    return stableGit(args);
  };
  const harness = recoveryHarness({
    source,
    recoveryGit,
    renewedManifestDigest: source.cloudAuthority.manifestDigest,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /state drifted after cloud renewal/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
});

test("remote, pull-request, and local HEAD TOCTOU fail after cloud and before local CAS", async t => {
  const source = liveManifestLease();
  const driftedHeadSha = "0".repeat(40);

  await t.test("remote head", () => {
    const harness = recoveryHarness({ source,
      renewedManifestDigest: source.cloudAuthority.manifestDigest });
    let reads = 0;
    harness.input.gitOptional = () => {
      reads += 1;
      const remote = reads === 1 ? fenceSha : driftedHeadSha;
      return `${remote}\trefs/heads/${branch}`;
    };
    assert.throws(() => recoverExpiredCommittedHeartbeat(harness.input),
      /exact open draft ownership pull request|state drifted after cloud renewal/);
    assert.equal(harness.cloudCalls(), 1);
    assert.equal(harness.localWrites(), 0);
    assert.equal(harness.markerWrites(), 0);
  });

  await t.test("pull-request head", () => {
    const harness = recoveryHarness({ source,
      renewedManifestDigest: source.cloudAuthority.manifestDigest });
    let reads = 0;
    harness.input.ghText = () => {
      reads += 1;
      return pullRequestBodyJson(harness.remoteBody(), {
        headRefOid: reads === 1 ? fenceSha : driftedHeadSha,
      });
    };
    assert.throws(() => recoverExpiredCommittedHeartbeat(harness.input),
      /exact open draft ownership pull request/);
    assert.equal(harness.cloudCalls(), 1);
    assert.equal(harness.localWrites(), 0);
    assert.equal(harness.markerWrites(), 0);
  });

  await t.test("local HEAD", () => {
    const stable = recoveryGitText();
    const driftedTreeSha = "4".repeat(40);
    let headReads = 0;
    const recoveryGit = args => {
      const key = args.join(" ");
      if (key === "rev-parse HEAD") {
        headReads += 1;
        return headReads <= 5 ? headSha : driftedHeadSha;
      }
      if (key ===
        `merge-base --is-ancestor ${fenceSha} ${driftedHeadSha}`) return "";
      if (key === `rev-parse ${driftedHeadSha}^{tree}`) {
        return driftedTreeSha;
      }
      if (key ===
        `diff --name-only -z --no-renames ${fenceSha} ${driftedHeadSha} --`) {
        return "scripts/recovery/check.mjs\0docs/runtime.md\0";
      }
      if (key ===
        `diff --binary --no-renames ${fenceSha} ${driftedHeadSha} --`) {
        return "binary committed range";
      }
      return stable(args);
    };
    const harness = recoveryHarness({ source, recoveryGit,
      renewedManifestDigest: source.cloudAuthority.manifestDigest });
    assert.throws(() => recoverExpiredCommittedHeartbeat(harness.input),
      /state drifted after cloud renewal|descendant HEAD drifted/);
    assert.equal(harness.cloudCalls(), 1);
    assert.equal(harness.localWrites(), 0);
    assert.equal(harness.markerWrites(), 0);
  });
});

function liveManifestLease({ cloudExpiresAt = null } = {}) {
  const lease = expiredCloudLease();
  return {
    ...lease,
    cloudAuthority: {
      ...lease.cloudAuthority,
      manifestDigest: lease.admission.manifestDigest,
      ...(cloudExpiresAt ? { expiresAt: cloudExpiresAt } : {}),
    },
  };
}

function leaseWithDeclaredWriteSet(lease, declaredWriteSet) {
  const normalized = [...declaredWriteSet].sort();
  const writeSetDigest = digestValue(normalized);
  return {
    ...lease,
    admission: {
      ...lease.admission,
      declaredWriteSet: normalized,
      writeSetDigest,
    },
    cloudAuthority: {
      ...lease.cloudAuthority,
      cloudDeclaredWriteScope: normalized,
      writeSetDigest,
    },
  };
}

function leaseWithHistory(lease, { sourceBaseSha, sourceFenceSha }) {
  return {
    ...lease,
    baseSha: sourceBaseSha,
    fenceSha: sourceFenceSha,
    cloudAuthority: {
      ...lease.cloudAuthority,
      canonicalBaseSha: sourceBaseSha,
      laneRevision: sourceFenceSha,
    },
  };
}

function leaseWithTaskAuthorityContinuation(lease) {
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"f".repeat(64)}`,
    issuedAt: "2026-08-04T09:59:00.000Z",
  });
  const markerBinding = createTaskAuthorityBinding({
    capability,
    lease,
    boundAt: "2026-08-04T10:00:00.000Z",
  });
  const markerLease = { ...lease, taskAuthority: markerBinding };
  const continuedLease = {
    ...markerLease,
    cloudAuthority: {
      ...markerLease.cloudAuthority,
      ledgerRevision: "c".repeat(40),
      ledgerDigest: "d".repeat(64),
    },
  };
  return {
    markerLease,
    currentLease: {
      ...continuedLease,
      taskAuthority: createTaskAuthorityBinding({
        capability,
        lease: continuedLease,
        bindingMode: "continuation",
        boundAt: "2026-08-04T10:05:00.000Z",
        priorBindingDigest: markerBinding.bindingDigest,
      }),
    },
  };
}

function recoveryHarness({
  source,
  renewedManifestDigest,
  transitionIncrement = 1,
  useProductionAuthority = false,
  recoveryGit = recoveryGitText(),
  sourceBodyPrefix = "",
}) {
  const renewedCloudAuthority = {
    ...source.cloudAuthority,
    manifestDigest: renewedManifestDigest,
    transitionCounter:
      source.cloudAuthority.transitionCounter + transitionIncrement,
    ledgerRevision: "e".repeat(40),
    claimLedgerRevision: "f".repeat(64),
    expiresAt: "2026-08-04T13:30:00.000Z",
  };
  let saved = source;
  let remoteBody = `${sourceBodyPrefix}${renderWriterLeasePullRequestBody(source)}`;
  let cloudCalls = 0;
  let localWrites = 0;
  let markerWrites = 0;
  const verification = operationVerification(renewedCloudAuthority);
  return {
    input: {
      invocationPath: repo,
      repo,
      gitText: recoveryGit,
      gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
      ghText: () => pullRequestBodyJson(remoteBody),
      leaseStore: {
        read: () => saved,
        recoverExpiredCommittedHeartbeat: input => {
          localWrites += 1;
          saved = projectExpiredCommittedHeartbeatLease({
            sourceLease: input.expectedLease,
            renewedCloudAuthority: input.renewedCloudAuthority,
            recoveryEvidence: input.recoveryEvidence,
            ttlMs: input.ttlMs,
            recoveredAt: input.recoveredAt,
          });
          return saved;
        },
      },
      sessionId: source.sessionId,
      leaseTtlMs: 1_800_000,
      heartbeatCloudAuthority: () => {
        cloudCalls += 1;
        return { authority: renewedCloudAuthority, verification };
      },
      ...(!useProductionAuthority ? {
        assertMutationAuthority: ({ lease, cloudAuthority }) => {
          assert.equal(lease.cloudAuthority, cloudAuthority);
          return { status: "ready" };
        },
      } : {}),
      run: (command, args) => {
        if (command === "git") {
          assert.deepEqual(args, [
            "fetch",
            "--no-tags",
            "origin",
            "+refs/heads/main:refs/remotes/origin/main",
          ]);
          return;
        }
        markerWrites += 1;
        remoteBody = args[args.indexOf("--body") + 1];
      },
      log: () => {},
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    },
    cloudCalls: () => cloudCalls,
    localWrites: () => localWrites,
    markerWrites: () => markerWrites,
    remoteBody: () => remoteBody,
  };
}

function operationVerification(authority) {
  const ledgerDigest = "b".repeat(64);
  const inventoryDigest = "c".repeat(64);
  return markOperationDerivedCloudVerification({
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    ledgerRevision: authority.ledgerRevision,
    ledgerDigest,
    canonicalBaseSha: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision,
    writeSetDigest: authority.writeSetDigest,
    reviewRequestId: authority.reviewRequestId,
    remoteClaimInventoryDigest: inventoryDigest,
    inventory: {
      schema: "agentic-cloud-claim-inventory/v1",
      inventoryDigest,
      observedLedgerHeadRevision: authority.ledgerRevision,
      ledgerDigest,
      claims: [{
        claimId: authority.claimId,
        entrySchema: authority.entrySchema,
        claimIdentitySchema: authority.claimIdentitySchema,
        operationReceiptDigest: authority.operationReceiptDigest,
        mutationAuthorityEligible: authority.mutationAuthorityEligible,
        state: authority.state,
        actorId: "github-user:1",
        repositoryId: "github-repository:1",
        workItemId: "work-item:1",
        canonicalBaseRevision: authority.canonicalBaseSha,
        laneRevision: authority.laneRevision,
        declaredWriteScope: authority.cloudDeclaredWriteScope,
        writeSetDigest: authority.writeSetDigest,
        leaseEpoch: authority.leaseEpoch,
        transitionCounter: authority.transitionCounter,
        heartbeatCounter: authority.heartbeatCounter,
        reviewRequestId: authority.reviewRequestId,
        expiresAt: authority.expiresAt,
        fenceRevision: authority.claimDigest,
        transitionDigest: authority.claimLedgerRevision,
      }],
    },
    receiptDigest: "e".repeat(64),
    verifiedAt: "2026-08-04T12:00:01.000Z",
  });
}

function cloudClaim({
  source, state, transitionCounter, heartbeatCounter, expiresAt,
  fenceRevision, transitionDigest, operationReceiptDigest,
}) {
  return {
    claimId: source.claimId,
    entrySchema: source.entrySchema,
    claimIdentitySchema: source.claimIdentitySchema,
    state,
    writeAuthority: state === "current",
    scopeReserved: true,
    canonicalBaseRevision: source.canonicalBaseSha,
    laneRevision: source.laneRevision,
    declaredWriteScope: source.cloudDeclaredWriteScope,
    writeSetDigest: source.writeSetDigest,
    leaseEpoch: source.leaseEpoch,
    transitionCounter,
    heartbeatCounter,
    reviewRequestId: source.reviewRequestId,
    expiresAt,
    fenceRevision,
    transitionDigest,
    operationReceiptDigest,
  };
}

function recoveryContinuationResult({
  source, transitionCounter, heartbeatCounter, expiresAt, claimDigest,
  transitionDigest, operationReceiptDigest, replayed, operationKey,
}) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    status: "current",
    replayed,
    ledgerRevision: "a".repeat(40),
    ledgerDigest: "b".repeat(64),
    claimDigest,
    findings: [],
    claim: cloudClaim({
      source,
      state: "current",
      transitionCounter,
      heartbeatCounter,
      expiresAt,
      fenceRevision: claimDigest,
      transitionDigest,
      operationReceiptDigest,
    }),
    operationReceipt: {
      schema: "agentic-collaboration-continuation-receipt/v1",
      operation: "continue",
      status: "current",
      claimId: source.claimId,
      claimDigest,
      ledgerRevision: transitionDigest,
      idempotencyKey: digestValue(operationKey),
      requestDigest: "c".repeat(64),
      receiptDigest: operationReceiptDigest,
    },
  };
}

function expiredCloudLease() {
  const declaredWriteSet = [
    "path:docs/runtime.md",
    "path:scripts/recovery",
    "semantic:expired-heartbeat",
  ];
  const writeSetDigest = digestValue(declaredWriteSet);
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 415,
    sessionId: "session-a",
    device: "device",
    scope: "expired-heartbeat",
    branch,
    worktreePath: repo,
    baseSha,
    fenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "expired-heartbeat",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: "1".repeat(64),
      planReceiptDigest: "2".repeat(64),
      admissionReceiptDigest: "3".repeat(64),
      existingLaneStateDigest: "4".repeat(64),
      admittedReportDigest: "5".repeat(64),
      preservationReceiptDigest: "6".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "org/ledger",
      targetRepository: "org/repo",
      claimId: "7".repeat(64),
      claimDigest: "8".repeat(64),
      ledgerRevision: "9".repeat(40),
      ledgerDigest: "b".repeat(64),
      claimLedgerRevision: "a".repeat(64),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: "b".repeat(64),
      mutationAuthorityEligible: true,
      canonicalBaseSha: baseSha,
      laneRevision: fenceSha,
      cloudDeclaredWriteScope: declaredWriteSet,
      writeSetDigest,
      deviceId: "device",
      sessionId: "session-a",
      reviewRequestId: "github-pull-request:81",
      leaseEpoch: 1,
      transitionCounter: 2,
      state: "active",
      manifestDigest: "1".repeat(64),
      expiresAt: "2026-08-04T13:00:00.000Z",
    },
    acquiredAt: "2026-08-04T10:00:00.000Z",
    heartbeatAt: "2026-08-04T10:00:00.000Z",
    expiresAt: "2026-08-04T10:30:00.000Z",
  };
}

function recoveryGitText({
  dirt = "",
  paths = ["scripts/recovery/check.mjs", "docs/runtime.md"],
  ancestryError = false,
  baseAncestryError = false,
  sourceBaseRevision = baseSha,
  sourceFenceRevision = fenceSha,
  fenceParentSha = sourceBaseRevision,
  sourceRemoteHeadSha = sourceFenceRevision,
  remoteTreeSha = sourceRemoteTreeSha,
  sourceRemotePaths = [],
  sourceRemoteEntries = {},
  protectedRevision = protectedMainSha,
  protectedTree = protectedMainTreeSha,
  sharedAncestorRevision = sharedAncestorSha,
  sharedAncestorTree = sharedAncestorTreeSha,
  sharedAncestorEntries = {},
  sharedAncestorBaseAncestryError = false,
  sharedAncestorMainAncestryError = false,
  sharedAncestorHeadAncestryError = false,
  sharedAncestorMergeBases = [sharedAncestorRevision],
  remoteFenceAncestryError = false,
  remoteHeadAncestryError = false,
  refreshFenceParentSha = null,
  refreshDeliveredHeadSha = null,
  refreshMainParentSha = null,
  refreshFenceTreeSha = null,
  fenceSubject = "",
  headEntries = {},
  protectedEntries = {},
} = {}) {
  return args => {
    const key = args.join(" ");
    if (key === "worktree list --porcelain -z") {
      return `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`;
    }
    if (key === "diff --name-only --diff-filter=U") return "";
    if (key === "ls-files -u") return "";
    if (key === "status --porcelain") return "";
    if (key === "branch --show-current") return branch;
    if (key === "status --porcelain=v1 -z --untracked-files=all") return dirt;
    if (key === "rev-parse HEAD") return headSha;
    if (key === `rev-parse ${headSha}^{tree}`) return treeSha;
    if (key === `rev-parse ${sourceRemoteHeadSha}^{tree}`) {
      return remoteTreeSha;
    }
    if (key === `rev-parse ${sharedAncestorRevision}^{tree}`) {
      return sharedAncestorTree;
    }
    if (
      refreshFenceParentSha &&
      key === `rev-parse ${refreshFenceParentSha}^{tree}`
    ) {
      return refreshFenceTreeSha;
    }
    if (key === `rev-list --parents -n 1 ${sourceFenceRevision}`) {
      return `${sourceFenceRevision} ${fenceParentSha}`;
    }
    if (
      refreshFenceParentSha &&
      key === `rev-list --parents -n 1 ${refreshFenceParentSha}`
    ) {
      return `${refreshFenceParentSha} ${refreshDeliveredHeadSha} ${refreshMainParentSha}`;
    }
    if (key ===
      `merge-base --is-ancestor ${sourceFenceRevision} ${headSha}`) {
      if (ancestryError) throw new Error("fatal: not an ancestor");
      return "";
    }
    if (
      refreshDeliveredHeadSha &&
      key ===
        `merge-base --is-ancestor ${sourceBaseRevision} ${refreshDeliveredHeadSha}`
    ) {
      return "";
    }
    if (
      sourceRemoteHeadSha !== sourceFenceRevision &&
      key ===
        `merge-base --is-ancestor ${sourceFenceRevision} ${sourceRemoteHeadSha}`
    ) {
      if (remoteFenceAncestryError) throw new Error("not an ancestor");
      return "";
    }
    if (
      sourceRemoteHeadSha !== headSha &&
      key ===
        `merge-base --is-ancestor ${sourceRemoteHeadSha} ${headSha}`
    ) {
      if (remoteHeadAncestryError) throw new Error("not an ancestor");
      return "";
    }
    if (key === "rev-parse refs/remotes/origin/main") {
      return protectedRevision;
    }
    if (key ===
      `merge-base --is-ancestor ${sourceBaseRevision} ${protectedRevision}`) {
      if (baseAncestryError) {
        throw new Error("fatal: protected base is not an ancestor");
      }
      return "";
    }
    if (key ===
      `merge-base --all ${sourceRemoteHeadSha} ${protectedRevision}`) {
      return sharedAncestorMergeBases.join("\n");
    }
    if (key ===
      `merge-base --is-ancestor ${sourceBaseRevision} ${sharedAncestorRevision}`) {
      if (sharedAncestorBaseAncestryError) {
        throw new Error("source base is not an ancestor of shared ancestor");
      }
      return "";
    }
    if (key ===
      `merge-base --is-ancestor ${sharedAncestorRevision} ${protectedRevision}`) {
      if (sharedAncestorMainAncestryError) {
        throw new Error("shared ancestor is not an ancestor of protected main");
      }
      return "";
    }
    if (key ===
      `merge-base --is-ancestor ${sharedAncestorRevision} ${sourceRemoteHeadSha}`) {
      if (sharedAncestorHeadAncestryError) {
        throw new Error("shared ancestor is not an ancestor of remote head");
      }
      return "";
    }
    if (key === `rev-parse ${protectedRevision}^{tree}`) {
      return protectedTree;
    }
    if (
      refreshFenceParentSha &&
      key ===
        `merge-base --is-ancestor ${refreshMainParentSha} refs/remotes/origin/main`
    ) {
      return "";
    }
    if (
      refreshFenceParentSha &&
      key ===
        `merge-tree --write-tree --no-messages ${refreshDeliveredHeadSha} ${refreshMainParentSha}`
    ) {
      return `${refreshFenceTreeSha}\n`;
    }
    if (fenceSubject && key === `show -s --format=%s ${sourceFenceRevision}`) {
      return fenceSubject;
    }
    if (args[0] === "ls-tree" && args[1] === "-z") {
      const treeish = args[2];
      const relativePath = args[4];
      const entry = treeish === headSha
        ? headEntries[relativePath]
        : treeish === sourceRemoteHeadSha
          ? sourceRemoteEntries[relativePath]
        : treeish === sharedAncestorRevision
          ? sharedAncestorEntries[relativePath]
        : treeish === protectedRevision
          ? protectedEntries[relativePath]
          : null;
      return entry
        ? `${entry.mode} blob ${entry.blobSha}\t${relativePath}\0`
        : "";
    }
    if (key ===
      `diff --name-only -z --no-renames ${sourceFenceRevision} ${headSha} --`) {
      return `${paths.join("\0")}\0`;
    }
    if (key ===
      `diff --name-only -z --no-renames ${sourceFenceRevision} ${sourceRemoteHeadSha} --`
    ) {
      return sourceRemotePaths.length
        ? `${sourceRemotePaths.join("\0")}\0`
        : "";
    }
    if (key ===
      `diff --binary --no-renames ${sourceFenceRevision} ${headSha} --`) {
      return "binary committed range";
    }
    if (key ===
      `diff --binary --no-renames ${sourceFenceRevision} ${sourceRemoteHeadSha} --`
    ) {
      return sourceRemotePaths.length ? "binary published prefix" : "";
    }
    throw new Error(`unexpected git command: ${key}`);
  };
}

function pullRequestJson(markerLease, options = {}) {
  return pullRequestBodyJson(
    renderWriterLeasePullRequestBody(markerLease),
    options,
  );
}

function pullRequestBodyJson(body, { headRefOid = fenceSha } = {}) {
  return JSON.stringify({
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: branch,
    headRefOid,
    headRepository: { nameWithOwner: "org/repo" },
    baseRefName: "main",
    body,
  });
}
