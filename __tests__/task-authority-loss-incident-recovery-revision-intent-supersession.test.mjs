import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  OPERATION,
  authorizeRevisionIntentSupersession,
  buildRevisionIntentSupersessionEvidence,
  buildRevisionIntentSupersessionPlan,
  normalizeRevisionIntentSupersessionReceipt,
} from "../scripts/task-authority-loss-incident-recovery-revision-intent-supersession-contract.mjs";
import {
  applyRevisionIntentSupersession,
} from "../scripts/task-authority-loss-incident-recovery-revision-intent-supersession-repository-adapter.mjs";
import { WRITER_LEASE_REGISTRY_SCHEMA } from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const DIGEST = character => character.repeat(64);
const SHA = character => character.repeat(40);
const branch = "agent/device/task-authority-loss-incident-recovery";

function fixture() {
  const lease = {
    schema: "agentic-writer-lease/v2",
    epoch: 1,
    branch,
    cloudAuthority: { claimId: DIGEST("b") },
  };
  const revisionIntentCore = {
    schema: "agentic-reviewed-lane-revision-journal/v1",
    status: "active",
    branch,
    entrypoint: "reviewed-lane-revision",
    operationDigest: DIGEST("1"),
    planDigest: DIGEST("2"),
    sourceLeaseDigest: DIGEST("3"),
    sourceClaimId: DIGEST("a"),
    currentLeaseDigest: DIGEST("3"),
    currentClaimId: DIGEST("a"),
    phase: "prepared",
    journalRevision: 1,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    values: { revisionIntent: { planSnapshot: { sourceHeadSha: SHA("c") } } },
    history: [],
  };
  const revisionIntent = {
    ...revisionIntentCore,
    intentDigest: digestValue(revisionIntentCore),
  };
  const evidence = buildRevisionIntentSupersessionEvidence({
    repository: "owner/repository",
    branch,
    sessionId: "owner-session",
    pullRequest: { number: 644, url: "https://example.test/pull/644", headSha: SHA("c"), isDraft: true },
    git: {
      protectedMainSha: SHA("d"),
      remoteHeadSha: SHA("c"),
      localHeadSha: SHA("e"),
      parentSha: SHA("c"),
      remoteTreeSha: SHA("f"),
      localTreeSha: SHA("f"),
      worktreeStateDigest: DIGEST("4"),
    },
    lease: {
      leaseDigest: writerLeaseDigest(lease),
      claimId: DIGEST("b"),
      taskAuthorityBindingDigest: DIGEST("5"),
      manifestDigest: DIGEST("6"),
      writeSetDigest: DIGEST("7"),
    },
    revisionIntent: {
      intentDigest: revisionIntent.intentDigest,
      planDigest: revisionIntent.planDigest,
      sourceClaimId: DIGEST("a"),
      sourceHeadSha: SHA("c"),
    },
    recovery: {
      sourceCorrectionJournalDigest: DIGEST("8"),
      sourceCorrectionReceiptDigest: DIGEST("9"),
      fenceRecoveryJournalDigest: DIGEST("0"),
      fenceRecoveryReceiptDigest: DIGEST("a"),
      taskBindingReconciliationReceiptDigest: DIGEST("b"),
      predecessorClaimId: DIGEST("a"),
      successorClaimId: DIGEST("b"),
    },
    runtime: {
      digest: DIGEST("c"),
      paths: ["scripts/task-authority-loss-incident-recovery-controller.mjs"],
    },
  });
  return { lease, revisionIntent, plan: buildRevisionIntentSupersessionPlan({ evidence }) };
}

test("plan emits one exact content-bound authorization", () => {
  const { plan } = fixture();
  assert.equal(plan.exactAuthorization, `authorize ${OPERATION} ${plan.planDigest}`);
  assert.throws(
    () => authorizeRevisionIntentSupersession({ plan, authorization: `authorize ${OPERATION} ${DIGEST("f")}` }),
    /requires exact authorization/u,
  );
  assert.equal(
    authorizeRevisionIntentSupersession({ plan, authorization: plan.exactAuthorization }).planDigest,
    plan.planDigest,
  );
});

test("run CAS-supersedes only the exact prepared intent and emits zero-effect receipt", () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "revision-intent-supersession-"));
  try {
    const statePath = path.join(temporaryDirectory, "writer-leases.json");
    const { lease, revisionIntent, plan } = fixture();
    const registry = {
      schema: WRITER_LEASE_REGISTRY_SCHEMA,
      revision: 12,
      leases: { [branch]: lease },
      reviewedLaneRevisionIntents: { [branch]: revisionIntent },
      untouched: { peer: true },
    };
    const leaseStore = {
      statePath,
      withRegistryLock: action => action(registry),
    };
    const receipt = applyRevisionIntentSupersession({
      leaseStore,
      branch,
      plan,
      authorization: plan.exactAuthorization,
      taskAuthorityReceipt: { receiptDigest: DIGEST("d") },
      now: () => new Date("2026-08-23T01:00:00.000Z"),
    });
    normalizeRevisionIntentSupersessionReceipt(receipt);
    assert.equal(receipt.sourceByteMutation, false);
    assert.equal(receipt.gitRefMutation, false);
    assert.equal(receipt.mergeEffect, false);
    assert.equal(receipt.cleanupEffect, false);
    assert.equal(receipt.deploymentEffect, false);
    const persisted = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(persisted.revision, 13);
    assert.deepEqual(persisted.leases, registry.leases);
    assert.deepEqual(persisted.untouched, registry.untouched);
    const next = persisted.reviewedLaneRevisionIntents[branch];
    assert.equal(next.status, "superseded");
    assert.equal(next.phase, "prepared");
    assert.equal(next.journalRevision, 2);
    assert.equal(
      next.values.taskAuthorityLossIncidentRecoveryRevisionIntentSupersession.receiptDigest,
      receipt.receiptDigest,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
