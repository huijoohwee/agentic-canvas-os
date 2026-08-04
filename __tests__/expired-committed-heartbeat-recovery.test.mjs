import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  captureExpiredCommittedHeartbeatSnapshot,
  requireChangedPathsWithinScope,
} from "../scripts/expired-committed-heartbeat-recovery-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = "/worktrees/recovery";
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
      claimLedgerRevision: "a".repeat(64),
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
  return JSON.stringify({
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: branch,
    headRefOid: fenceSha,
    headRepository: { nameWithOwner: "org/repo" },
    baseRefName: "main",
    body: renderWriterLeasePullRequestBody(markerLease),
  });
}
