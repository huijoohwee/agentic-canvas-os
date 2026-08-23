import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

import {
  advanceOrphanedTaskAuthorityRecoveryIntent,
  createOrphanedTaskAuthorityRecoveryIntent,
  createOrphanedTaskAuthorityRecoveryPlan,
} from "../scripts/orphaned-task-authority-recovery-contract.mjs";
import {
  createOrphanedTaskAuthorityRecoveryJournalStore,
  readOrphanedTaskAuthorityRecoveryPlan,
  writeOrphanedTaskAuthorityRecoveryPlan,
} from "../scripts/orphaned-task-authority-recovery-store.mjs";

const digest = character => character.repeat(64);
const receipt = kind => {
  const core = { schema: "test-phase-receipt/v1", kind };
  return { ...core, receiptDigest: digestValue(core) };
};

function plan() {
  return createOrphanedTaskAuthorityRecoveryPlan({
    source: {
      schema: "agentic-orphaned-task-authority-source/v1",
      repository: { id: "repo", nameWithOwner: "owner/repo" },
      branch: "agent/device/scope",
      headSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      worktreeIdentityDigest: digest("1"),
      leaseDigest: digest("2"),
      claimId: digest("3"),
      cloudClaimDigest: digest("4"),
      pullRequest: {
        id: "pr", url: "https://github.test/owner/repo/pull/1",
        bodyDigest: digest("5"), bodyRemainderDigest: digest("6"),
        markerDigest: digest("7"), state: "OPEN", isDraft: true,
      },
      taskAuthority: {
        authoritySubjectId: `urn:agentic-task:${digest("8")}`,
        generation: 1, bindingDigest: digest("9"), publicKeyDigest: digest("a"),
      },
      git: { kind: "clean", evidenceDigest: digest("b") },
    },
    targetCapability: {
      authoritySubjectId: `urn:agentic-task:${digest("c")}`,
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
      generation: 2, publicKey: "public", publicKeyDigest: digest("d"),
    },
    incidentReference: "incident-reference-1234",
    lossAttestationDigest: digest("e"),
    plannedAt: "2026-08-23T04:00:00.000Z",
  });
}

test("external plan and journal stay owner-only and advance exactly once", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "orphaned-authority-store-")));
  const repository = path.join(root, "repository");
  const external = path.join(root, "private");
  mkdirSync(repository);
  mkdirSync(external, { mode: 0o700 });
  chmodSync(external, 0o700);
  const planPath = path.join(external, "plan.json");
  const statePath = path.join(external, "state.json");
  try {
    const planned = plan();
    writeOrphanedTaskAuthorityRecoveryPlan({ repository, outputPath: planPath, plan: planned });
    assert.equal(readOrphanedTaskAuthorityRecoveryPlan({ repository, planPath }).planDigest,
      planned.planDigest);
    assert.equal(statSync(planPath).mode & 0o777, 0o600);
    const store = createOrphanedTaskAuthorityRecoveryJournalStore({ repository, statePath });
    let intent = createOrphanedTaskAuthorityRecoveryIntent({
      plan: planned,
      authorization: planned.exactAuthorization,
    });
    await store.withLock(async () => { intent = store.write(intent); });
    for (const [index, phase] of ["snapshotted", "local-cas", "pr-attempted",
      "pr-projected", "verified"].entries()) {
      intent = store.write(advanceOrphanedTaskAuthorityRecoveryIntent(intent, {
        phase,
        receipt: receipt(`phase-${index + 1}`),
        ...(phase === "local-cas" ? { targetBindingDigest: digest("f") } : {}),
      }));
    }
    const completionCore = {
      schema: "agentic-orphaned-task-authority-recovery-result/v1",
      status: "complete",
      planDigest: planned.planDigest,
      sourceBindingDigest: planned.source.taskAuthority.bindingDigest,
      targetBindingDigest: digest("f"),
      sourceBytesChanged: false,
      cloudMutated: false,
      merged: false,
      deployed: false,
      phaseReceiptDigests: Object.fromEntries(Object.entries(intent.receipts)
        .map(([phase, value]) => [phase, value.receiptDigest])),
    };
    const completion = { ...completionCore, resultDigest: digestValue(completionCore) };
    intent = store.write(advanceOrphanedTaskAuthorityRecoveryIntent(intent, {
      phase: "complete", receipt: receipt("complete"), completion,
    }));
    assert.equal(intent.phase, "complete");
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
    assert.equal(store.write(intent).intentDigest, intent.intentDigest);
    assert.throws(() => store.write({ ...intent, intentDigest: digest("0") }), /digest/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan storage rejects a repository-local output", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "orphaned-authority-local-")));
  try {
    assert.throws(() => writeOrphanedTaskAuthorityRecoveryPlan({
      repository: root,
      outputPath: path.join(root, "plan.json"),
      plan: plan(),
    }), /outside/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
