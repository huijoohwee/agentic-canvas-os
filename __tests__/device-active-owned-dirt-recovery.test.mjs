import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createActiveOwnedDirtLeaseRecovery,
  normalizeActiveOwnedDirtRecoveryPlan,
} from "../scripts/active-owned-dirt-recovery-contract.mjs";
import {
  advanceActiveOwnedDirtRecoveryIntent,
  beginActiveOwnedDirtRecoveryIntent,
  projectActiveOwnedDirtRecoveredLease,
} from "../scripts/active-owned-dirt-recovery-registry.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

test("recovery CAS renews only the same source session and preserves fence/admission", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "device-active-owned-dirt-"));
  const branch = "agent/device/recovery";
  const claimId = "a".repeat(64);
  const store = createWriterLeaseStore({
    gitCommonDir,
    now: () => new Date("2026-08-09T00:00:00.000Z"),
  });
  try {
    let lease = store.claim({
      sessionId: "source-session",
      device: "device",
      scope: "recovery",
      branch,
      worktreePath: "/worktree/recovery",
      baseSha: "b".repeat(40),
      ttlMs: 60_000,
    });
    const declaredWriteSet = ["path:src", "semantic:recovery"];
    lease = store.annotate({
      sessionId: lease.sessionId,
      branch,
      values: {
        fenceSha: "c".repeat(40),
        pullRequestUrl: "https://github.test/org/repo/pull/9",
        admission: {
          schema: "agentic-lane-admission-lease/v1",
          status: "admitted",
          declaredWriteSet,
          writeSetDigest: digestValue(declaredWriteSet),
          manifestDigest: "d".repeat(64),
        },
        cloudAuthority: { claimId },
      },
    });
    const plan = planFixture({ lease, declaredWriteSet });
    let intent = beginActiveOwnedDirtRecoveryIntent({
      leaseStore: store,
      branch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: claimId,
      plan,
    }).intent;
    const snapshot = {
      snapshotReceiptDigest: "e".repeat(64),
      snapshotRef: `refs/agentic-canvas-os/recovery/active-owned-dirt/${claimId}/${plan.planDigest}`,
      commitSha: "f".repeat(40),
      indexCommitSha: "0".repeat(40),
    };
    intent = advanceActiveOwnedDirtRecoveryIntent({
      leaseStore: store,
      branch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: claimId,
      planDigest: plan.planDigest,
      status: "snapshot",
      values: { snapshot },
    }).intent;
    const cloud = {
      claimDigest: "1".repeat(64),
      ledgerRevision: "2".repeat(40),
      claimLedgerRevision: "3".repeat(64),
      transitionCounter: 4,
      recoveredAt: "2026-08-09T00:01:00.000Z",
    };
    intent = advanceActiveOwnedDirtRecoveryIntent({
      leaseStore: store,
      branch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: claimId,
      planDigest: plan.planDigest,
      status: "cloud",
      values: { cloud },
    }).intent;
    const recovery = createActiveOwnedDirtLeaseRecovery({
      plan,
      snapshot,
      cloud,
      recoveredAt: cloud.recoveredAt,
    });
    const cloudAuthority = {
      schema: "agentic-lane-cloud-authority/v1",
      claimId,
      claimDigest: cloud.claimDigest,
      transitionCounter: cloud.transitionCounter,
      expiresAt: "2026-08-09T00:31:00.000Z",
    };
    const projected = projectActiveOwnedDirtRecoveredLease({
      leaseStore: store,
      branch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: claimId,
      planDigest: plan.planDigest,
      cloudAuthority,
      recovery,
      validateLease: candidate => {
        assert.equal(candidate.sessionId, lease.sessionId);
        return { receiptDigest: "6".repeat(64) };
      },
    });
    assert.equal(projected.intent.status, "local-cas");
    assert.equal(projected.lease.sessionId, lease.sessionId);
    assert.equal(projected.lease.device, lease.device);
    assert.equal(projected.lease.fenceSha, lease.fenceSha);
    assert.deepEqual(projected.lease.admission, lease.admission);
    assert.ok(projected.lease.epoch > lease.epoch);
    assert.equal(projected.lease.activeOwnedDirtRecovery.planDigest, plan.planDigest);
    assert.equal(projected.intent.localProjection.mutationAuthorityReceiptDigest, "6".repeat(64));
    assert.throws(() => store.heartbeat({
      sessionId: projected.lease.sessionId,
      branch,
    }), /recovery intent fences this writer-lease heartbeat/);
    assert.equal(writerLeaseDigest(store.read(branch)), writerLeaseDigest(projected.lease));

    assert.throws(() => projectActiveOwnedDirtRecoveredLease({
      leaseStore: store,
      branch,
      expectedLeaseDigest: writerLeaseDigest(projected.lease),
      expectedClaimId: claimId,
      planDigest: plan.planDigest,
      cloudAuthority,
      recovery: { ...recovery, sourceSessionId: "successor-session" },
    }), /cannot transfer dirty ownership|belongs to another plan/);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

function planFixture({ lease, declaredWriteSet }) {
  const core = {
    schema: "agentic-active-owned-dirt-recovery-plan/v1",
    sourceSessionId: lease.sessionId,
    sourceDevice: lease.device,
    sourceScope: lease.scope,
    sourceBranch: lease.branch,
    sourceEpoch: lease.epoch,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceBaseSha: lease.baseSha,
    sourceFenceSha: lease.fenceSha,
    sourcePullRequestUrl: lease.pullRequestUrl,
    sourcePullRequestBodyDigest: "4".repeat(64),
    sourceMarkerDigest: "5".repeat(64),
    sourceWorktreeIdentityDigest: "6".repeat(64),
    sourceClaimId: lease.cloudAuthority.claimId,
    sourceClaimDigest: "7".repeat(64),
    sourceClaimLedgerRevision: "8".repeat(64),
    sourceCloudTransitionCounter: 3,
    sourceCloudLeaseEpoch: 1,
    sourceLedgerRevision: "9".repeat(40),
    sourceLedgerDigest: "a".repeat(64),
    sourceReviewRequestId: "github-pull-request:9",
    sourceManifestDigest: lease.admission.manifestDigest,
    sourceWriteSetDigest: lease.admission.writeSetDigest,
    sourceDeclaredWriteSet: declaredWriteSet,
    evidenceDigest: "b".repeat(64),
    dirtyPathCount: 15,
    snapshotTimestamp: "2026-08-09T00:00:00.000Z",
    ttlSeconds: 1_800,
  };
  return normalizeActiveOwnedDirtRecoveryPlan({ ...core, planDigest: digestValue(core) });
}
