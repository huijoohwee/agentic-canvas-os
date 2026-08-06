import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  captureExpiredCommittedHeartbeatSnapshot,
  GITHUB_PULL_REQUEST_BODY_MAX_BYTES,
  recoverExpiredCommittedHeartbeat,
  requireChangedPathsWithinScope,
} from "../scripts/expired-committed-heartbeat-recovery-lib.mjs";
import { markOperationDerivedCloudVerification } from "../scripts/scoped-lane-admission-lib.mjs";
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

test("captures an XR-shaped pushed prefix while proving the full fence-to-HEAD range", () => {
  const lease = leaseWithDeclaredWriteSet(expiredCloudLease(), [
    "path:docs/workspace-seeds",
    "semantic:expired-heartbeat",
  ]);
  const authoredPath =
    "docs/workspace-seeds/knowgrph-physics-playground-demo.md";
  const protectedPath =
    "docs/documents/knowgrph-ar-vr-xr-prd-tad-adr.md";
  const protectedBlobSha = "3".repeat(40);
  const protectedEntry = { mode: "100644", blobSha: protectedBlobSha };
  const snapshot = captureExpiredCommittedHeartbeatSnapshot({
    repo,
    branch,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: [
        authoredPath,
        protectedPath,
      ],
      paths: [authoredPath, protectedPath],
      sourceRemoteEntries: { [protectedPath]: protectedEntry },
      headEntries: { [protectedPath]: protectedEntry },
      protectedEntries: { [protectedPath]: protectedEntry },
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(lease, {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(snapshot.remoteHeadSha, pushedRemoteHeadSha);
  assert.equal(snapshot.pullRequestHeadSha, pushedRemoteHeadSha);
  assert.equal(
    snapshot.recoveryEvidence.sourceRemoteHeadSha,
    pushedRemoteHeadSha,
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
  assert.equal(snapshot.sourceRemotePrefix.treeSha, sourceRemoteTreeSha);
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
    snapshot.recoveryEvidence.sourceRemoteProtectedMainEquivalenceDigest,
    digestValue(snapshot.sourceRemotePrefix.protectedMainEquivalence),
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
  }), /differs from fetched protected main/);
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

test("expired-source replay requires the next exact cloud transition", () => {
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
    transitionIncrement: 2,
  });

  assert.throws(
    () => recoverExpiredCommittedHeartbeat(harness.input),
    /Cloud heartbeat changed the expired lease claim subject/,
  );
  assert.equal(harness.cloudCalls(), 1);
  assert.equal(harness.localWrites(), 0);
  assert.equal(harness.markerWrites(), 0);
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
      return protectedRefReads <= 4 ? protectedMainSha : nextProtectedMainSha;
    }
    if (key === `merge-base --is-ancestor ${baseSha} ${nextProtectedMainSha}`) return "";
    if (key === `rev-parse ${nextProtectedMainSha}^{tree}`) return nextProtectedMainTreeSha;
    return stableGit(args);
  };
  const harness = recoveryHarness({ source, recoveryGit,
    renewedManifestDigest: source.cloudAuthority.manifestDigest });
  assert.throws(() => recoverExpiredCommittedHeartbeat(harness.input),
    /state drifted after cloud renewal|protected-main subject drifted/);
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
  fenceParentSha = baseSha,
  sourceRemoteHeadSha = fenceSha,
  remoteTreeSha = sourceRemoteTreeSha,
  sourceRemotePaths = [],
  sourceRemoteEntries = {},
  remoteFenceAncestryError = false,
  remoteHeadAncestryError = false,
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
    if (key === `rev-list --parents -n 1 ${fenceSha}`) {
      return `${fenceSha} ${fenceParentSha}`;
    }
    if (key === `merge-base --is-ancestor ${fenceSha} ${headSha}`) {
      if (ancestryError) throw new Error("fatal: not an ancestor");
      return "";
    }
    if (
      sourceRemoteHeadSha !== fenceSha &&
      key ===
        `merge-base --is-ancestor ${fenceSha} ${sourceRemoteHeadSha}`
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
      return protectedMainSha;
    }
    if (key === `merge-base --is-ancestor ${baseSha} ${protectedMainSha}`) {
      if (baseAncestryError) {
        throw new Error("fatal: protected base is not an ancestor");
      }
      return "";
    }
    if (key === `rev-parse ${protectedMainSha}^{tree}`) {
      return protectedMainTreeSha;
    }
    if (args[0] === "ls-tree" && args[1] === "-z") {
      const treeish = args[2];
      const relativePath = args[4];
      const entry = treeish === headSha
        ? headEntries[relativePath]
        : treeish === sourceRemoteHeadSha
          ? sourceRemoteEntries[relativePath]
        : treeish === protectedMainSha
          ? protectedEntries[relativePath]
          : null;
      return entry
        ? `${entry.mode} blob ${entry.blobSha}\t${relativePath}\0`
        : "";
    }
    if (key === `diff --name-only -z --no-renames ${fenceSha} ${headSha} --`) {
      return `${paths.join("\0")}\0`;
    }
    if (key ===
      `diff --name-only -z --no-renames ${fenceSha} ${sourceRemoteHeadSha} --`
    ) {
      return sourceRemotePaths.length
        ? `${sourceRemotePaths.join("\0")}\0`
        : "";
    }
    if (key === `diff --binary --no-renames ${fenceSha} ${headSha} --`) {
      return "binary committed range";
    }
    if (key ===
      `diff --binary --no-renames ${fenceSha} ${sourceRemoteHeadSha} --`
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
