import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import { casWriterLeaseProjection, mutateWriterLeaseRegistry, writerLeaseDigest }
  from "../scripts/writer-lease-registry-cas.mjs";
import {
  buildExpiredDescendantInnerResult,
  expiredDescendantTerminalReceiptForPlan,
  expiredDescendantIntentAtLeast,
  stableExpiredDescendantTerminalDigest,
} from "../scripts/expired-descendant-untracked-scope-recovery-repository-terminal.mjs";

const D = value => digestValue(value);

test("provider-deferred phases are monotonic and exclude ordinary PR phases", () => {
  assert.equal(expiredDescendantIntentAtLeast("source-retired", "waiting-successor"), true);
  assert.equal(expiredDescendantIntentAtLeast("promoted", "successor-bound"), false);
  assert.throws(() => expiredDescendantIntentAtLeast("pr-marker", "intent"),
    /invalid phase/u);
});

test("terminal projection is deterministic and joins the exact successor", () => {
  const terminal = { schema: "agentic-expired-descendant-untracked-scope-recovery-terminal/v1",
    planDigest: D("outer"), innerPlanDigest: D("inner"),
    successorClaimId: D("claim"), successorClaimDigest: D("fence"),
    targetLeaseDigest: D("lease"), localProjectionReceiptDigest: D("projection"),
    mutationAuthorityReceiptDigest: D("mutation"),
    preservedPullRequestDigest: D("pull"), heartbeatFenceDigest: D("heartbeat-fence"),
    providerProjection: "deferred",
    pullRequestMutation: false, completedAt: "2026-08-31T00:00:00.000Z" };
  const withReceipt = { ...terminal, receiptDigest: D(terminal) };
  const result = buildExpiredDescendantInnerResult(withReceipt);
  assert.equal(result.successorClaimId, terminal.successorClaimId);
  assert.equal(result.pullRequestMutation, false);
  assert.equal(stableExpiredDescendantTerminalDigest(withReceipt),
    stableExpiredDescendantTerminalDigest({ ...withReceipt,
      completedAt: "2026-08-31T00:01:00.000Z", receiptDigest: D("other") }));
  assert.notEqual(stableExpiredDescendantTerminalDigest(withReceipt),
    stableExpiredDescendantTerminalDigest({ ...withReceipt,
      successorClaimId: D("other") }));
});

test("terminal history is keyed by plan so a later branch recovery cannot overwrite it", () => {
  const branch = "agent/device.local/reused", first = D("first"), second = D("second");
  const registry = { expiredDescendantUntrackedRecoveryReceipts: { [branch]: {
    [first]: { receiptDigest: D("first receipt") },
    [second]: { receiptDigest: D("second receipt") },
  } } };
  assert.equal(expiredDescendantTerminalReceiptForPlan(registry, branch, first)
    .receiptDigest, D("first receipt"));
  assert.equal(expiredDescendantTerminalReceiptForPlan(registry, branch, second)
    .receiptDigest, D("second receipt"));
  assert.equal(expiredDescendantTerminalReceiptForPlan(registry, branch, D("absent")), null);
});

test("compatibility fence blocks heartbeat-style lease mutation until atomic retirement", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "expired-descendant-fence-"));
  const branch = "agent/device.local/fenced", claimId = D("claim");
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    let lease = store.claim({ sessionId: "session", device: "device.local",
      scope: "fenced", branch, worktreePath: root, baseSha: "a".repeat(40) });
    lease = store.annotate({ sessionId: lease.sessionId, branch,
      values: { fenceSha: "b".repeat(40), cloudAuthority: { claimId } } });
    const expectedLeaseDigest = writerLeaseDigest(lease);
    const fence = { schema: "agentic-active-owned-dirt-recovery-intent/v1",
      status: "intent", planDigest: D("expired descendant plan") };
    mutateWriterLeaseRegistry({ leaseStore: store, branch, expectedLeaseDigest,
      expectedClaimId: claimId, action: ({ registry }) => ({ registry: { ...registry,
        activeOwnedDirtRecoveryIntents: {
          ...(registry.activeOwnedDirtRecoveryIntents || {}), [branch]: fence,
        } }, lease, changed: true }) });
    assert.throws(() => casWriterLeaseProjection({ leaseStore: store, branch,
      expectedLeaseDigest, expectedClaimId: claimId, requireNoActiveIntent: true,
      values: { heartbeatAt: "2026-08-31T00:01:00.000Z" } }),
    /recovery intent fences this heartbeat/u);
    mutateWriterLeaseRegistry({ leaseStore: store, branch, expectedLeaseDigest,
      expectedClaimId: claimId, action: ({ registry }) => {
        const fences = { ...registry.activeOwnedDirtRecoveryIntents }; delete fences[branch];
        return { registry: { ...registry, activeOwnedDirtRecoveryIntents: fences },
          lease, changed: true };
      } });
    assert.doesNotThrow(() => casWriterLeaseProjection({ leaseStore: store, branch,
      expectedLeaseDigest, expectedClaimId: claimId, requireNoActiveIntent: true,
      values: { heartbeatAt: "2026-08-31T00:01:00.000Z" } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
