import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  captureExpiredCommittedHeartbeatSnapshot,
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
  assert.deepEqual(snapshot.changedPaths, [
    "docs/runtime.md",
    "scripts/recovery/check.mjs",
  ]);
  assert.match(snapshot.snapshotDigest, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.recoveryEvidence.sourceEpoch, lease.epoch);
  assert.equal(snapshot.recoveryEvidence.sourceClaimId, lease.cloudAuthority.claimId);
});

test("snapshot fails closed on marker, remote, dirt, ancestry, and path drift", () => {
  const lease = expiredCloudLease();
  const base = {
    repo,
    branch,
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
  }), /exact remote and pull-request fence/);
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
    gitText: recoveryGitText({ fenceParentSha: "e".repeat(40) }),
  }), /single-parent fence/);
  assert.throws(() => captureExpiredCommittedHeartbeatSnapshot({
    ...base,
    gitText: recoveryGitText({ paths: ["outside.txt"] }),
  }), /outside declared write scope/);
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

function recoveryHarness({
  source,
  renewedManifestDigest,
  transitionIncrement = 1,
  useProductionAuthority = false,
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
  let remoteBody = renderWriterLeasePullRequestBody(source);
  let cloudCalls = 0;
  let localWrites = 0;
  let markerWrites = 0;
  const verification = operationVerification(renewedCloudAuthority);
  return {
    input: {
      invocationPath: repo,
      repo,
      gitText: recoveryGitText(),
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
      run: (_command, args) => {
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
  fenceParentSha = baseSha,
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
    if (key === `rev-list --parents -n 1 ${fenceSha}`) {
      return `${fenceSha} ${fenceParentSha}`;
    }
    if (key === `merge-base --is-ancestor ${fenceSha} ${headSha}`) {
      if (ancestryError) throw new Error("fatal: not an ancestor");
      return "";
    }
    if (key === `diff --name-only -z --no-renames ${fenceSha} ${headSha} --`) {
      return `${paths.join("\0")}\0`;
    }
    if (key === `diff --binary --no-renames ${fenceSha} ${headSha} --`) {
      return "binary committed range";
    }
    throw new Error(`unexpected git command: ${key}`);
  };
}

function pullRequestJson(markerLease) {
  return pullRequestBodyJson(renderWriterLeasePullRequestBody(markerLease));
}

function pullRequestBodyJson(body) {
  return JSON.stringify({
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: branch,
    headRefOid: fenceSha,
    headRepository: { nameWithOwner: "org/repo" },
    baseRefName: "main",
    body,
  });
}
