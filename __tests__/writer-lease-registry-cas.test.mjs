import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import {
  advanceScopeExpansionIntent,
  assertHeartbeatScopeExpansionFence,
  beginScopeExpansionIntent,
  casWriterLeaseProjection,
  writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";

const BRANCH = "agent/device/protected-head-refresh-controller";
const CLAIM_1 = "1".repeat(64);
const CLAIM_2 = "2".repeat(64);

function plan() {
  const core = {
    schema: "agentic-active-dirty-scope-expansion-plan/v1",
    sourceBranch: BRANCH,
    targetWriteSetDigest: "3".repeat(64),
    targetManifestDigest: "4".repeat(64),
    targetCanonicalBaseSha: "a".repeat(40),
  };
  return { ...core, planDigest: digestValue(core) };
}

test("registry CAS fences delayed C1 heartbeats and permits only the bound C2 projection", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "active-dirty-scope-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    let lease = store.claim({
      sessionId: "session", device: "device", scope: "protected-head-refresh-controller",
      branch: BRANCH, worktreePath: "/worktree", baseSha: "a".repeat(40),
    });
    lease = store.annotate({
      sessionId: "session", branch: BRANCH,
      values: { fenceSha: "b".repeat(40), cloudAuthority: { claimId: CLAIM_1 } },
    });
    const sourceDigest = writerLeaseDigest(lease);
    const intent = beginScopeExpansionIntent({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest,
      expectedClaimId: CLAIM_1, plan: plan(),
    }).intent;
    assert.equal(intent.status, "intent");
    assert.throws(() => assertHeartbeatScopeExpansionFence({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest, expectedClaimId: CLAIM_1,
    }), /fences this source heartbeat/);

    const c2 = casWriterLeaseProjection({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest,
      expectedClaimId: CLAIM_1, values: {
        baseSha: "c".repeat(40), cloudAuthority: { claimId: CLAIM_2 },
      },
    }).lease;
    const c2Digest = writerLeaseDigest(c2);
    const completed = advanceScopeExpansionIntent({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: c2Digest,
      expectedClaimId: CLAIM_2, expectedPlanDigest: plan().planDigest,
      values: { status: "local-cas", targetClaimId: CLAIM_2, localProjection: { leaseDigest: c2Digest, claimId: CLAIM_2 } },
    }).intent;
    assert.equal(completed.status, "local-cas");
    assert.doesNotThrow(() => assertHeartbeatScopeExpansionFence({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: c2Digest, expectedClaimId: CLAIM_2,
    }));
    assert.throws(() => casWriterLeaseProjection({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest,
      expectedClaimId: CLAIM_1, values: { heartbeatAt: "2026-08-07T00:00:00.000Z" },
    }), /changed before scope-expansion CAS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry CAS admits only an explicitly fenced null-cloud source", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "null-cloud-cas-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    const source = store.claim({
      sessionId: "session", device: "device", scope: "protected-head-refresh-controller",
      branch: BRANCH, worktreePath: "/worktree", baseSha: "a".repeat(40),
    });
    const sourceDigest = writerLeaseDigest(source);

    assert.throws(() => casWriterLeaseProjection({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest,
      expectedClaimId: undefined, values: { cloudAuthority: { claimId: CLAIM_1 } },
    }), /expected claim ID must be a SHA-256 digest/);
    assert.throws(() => casWriterLeaseProjection({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: "f".repeat(64),
      expectedClaimId: null, values: { cloudAuthority: { claimId: CLAIM_1 } },
    }), /Writer lease changed before scope-expansion CAS/);

    const projected = casWriterLeaseProjection({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest,
      expectedClaimId: null, values: { cloudAuthority: { claimId: CLAIM_1 } },
    }).lease;
    assert.equal(projected.cloudAuthority.claimId, CLAIM_1);

    assert.throws(() => casWriterLeaseProjection({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(projected),
      expectedClaimId: null, values: { cloudAuthority: { claimId: CLAIM_2 } },
    }), /Writer lease claim changed before scope-expansion CAS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("literal null claim fence rejects every non-null cloud-authority object", () => {
  const cases = [
    { label: "empty", cloudAuthority: {} },
    {
      label: "missing-claim-id",
      cloudAuthority: { schema: "agentic-lane-cloud-authority/v1" },
    },
  ];

  for (const { label, cloudAuthority } of cases) {
    const root = mkdtempSync(path.join(os.tmpdir(), `null-cloud-${label}-`));
    const store = createWriterLeaseStore({ gitCommonDir: root });
    const branch = `agent/device/null-cloud-${label}`;
    try {
      let source = store.claim({
        sessionId: "session", device: "device", scope: `null-cloud-${label}`,
        branch, worktreePath: "/worktree", baseSha: "a".repeat(40),
      });
      source = store.annotate({
        sessionId: "session", branch, values: { cloudAuthority },
      });

      assert.throws(() => casWriterLeaseProjection({
        leaseStore: store, branch, expectedLeaseDigest: writerLeaseDigest(source),
        expectedClaimId: null, values: { cloudAuthority: { claimId: CLAIM_1 } },
      }), /Writer lease claim changed before scope-expansion CAS/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("literal null claim fence accepts an absent cloud-authority field", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "null-cloud-absent-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  const branch = "agent/device/null-cloud-absent";
  try {
    const source = { ...store.claim({
      sessionId: "session", device: "device", scope: "null-cloud-absent",
      branch, worktreePath: "/worktree", baseSha: "a".repeat(40),
    }) };
    delete source.cloudAuthority;
    assert.equal(Object.hasOwn(source, "cloudAuthority"), false);

    const projected = casWriterLeaseProjection({
      leaseStore: {
        verify: () => source,
        annotate: ({ values }) => ({ ...source, ...values }),
      },
      branch, expectedLeaseDigest: writerLeaseDigest(source),
      expectedClaimId: null, values: { cloudAuthority: { claimId: CLAIM_1 } },
    }).lease;
    assert.equal(projected.cloudAuthority.claimId, CLAIM_1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
