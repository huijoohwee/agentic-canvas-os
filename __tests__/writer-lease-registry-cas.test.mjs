import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createCanonicalUntrackedRelocationPlan,
  deriveCanonicalUntrackedRelocationLayout,
} from "../scripts/canonical-untracked-relocation-contract.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import {
  advanceScopeExpansionIntent,
  assertHeartbeatMutationIntentFence,
  assertHeartbeatScopeExpansionFence,
  beginScopeExpansionIntent,
  casWriterLeaseProjection,
  heartbeatWriterLeaseProjection,
  mutateWriterLeaseRegistry,
  rolloverCompletedScopeExpansionIntent,
  writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";
import {
  createCanonicalUntrackedRelocationRegistryIntent,
  withCanonicalUntrackedRelocationRegistryIntent,
} from "../scripts/writer-lease-registry-intents.mjs";

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

function cloudAuthority({ claimId = CLAIM_1, transitionCounter = 1, heartbeatCounter = 0,
  claimDigest = "5".repeat(64), claimLedgerRevision = "6".repeat(64),
  operationReceiptDigest = "7".repeat(64), ledgerRevision = "8".repeat(40),
  ledgerDigest = "9".repeat(64), expiresAt = "2026-08-30T02:30:00.000Z" } = {}) {
  return {
    schema: "agentic-lane-cloud-authority/v1", provider: "test",
    targetRepository: "org/repo", ledgerRepository: "org/ledger",
    deviceId: "device", sessionId: "session", state: "active",
    claimId, claimDigest, claimLedgerRevision, operationReceiptDigest,
    ledgerRevision, ledgerDigest,
    transitionCounter, heartbeatCounter, expiresAt, reviewRequestId: null,
  };
}

function renewHeartbeat(store, lease, { local = true, now = "2099-08-30T02:31:00.000Z" } = {}) {
  const source = lease.cloudAuthority;
  const successor = cloudAuthority({ claimId: source.claimId,
    transitionCounter: source.transitionCounter + 1,
    heartbeatCounter: (source.heartbeatCounter ?? 0) + 1,
    claimDigest: digestValue([source.claimDigest, "claim"]),
    claimLedgerRevision: digestValue([source.claimLedgerRevision, "ledger"]),
    operationReceiptDigest: digestValue([source.operationReceiptDigest, "receipt"]),
    ledgerRevision: source.ledgerRevision === "8".repeat(40)
      ? "a".repeat(40) : "8".repeat(40),
    ledgerDigest: digestValue([source.ledgerDigest, "ledger"]),
    expiresAt: new Date(Date.parse(source.expiresAt) + 3_600_000).toISOString() });
  const sourceDigest = writerLeaseDigest(lease);
  assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: sourceDigest, expectedClaimId: source.claimId });
  let projected = casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: sourceDigest, expectedClaimId: source.claimId,
    requireNoActiveIntent: true, values: { cloudAuthority: successor } }).lease;
  if (local) projected = heartbeatWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: writerLeaseDigest(projected), expectedClaimId: source.claimId,
    ttlMs: 60 * 60_000, expiresAtCap: successor.expiresAt, now: () => new Date(now) });
  return projected;
}

function installActiveRelocation(store, lease) {
  const leaseDigest = writerLeaseDigest(lease);
  const source = { worktree: "/source", commonDirectory: path.dirname(store.statePath),
    headSha: "a".repeat(40), treeSha: "b".repeat(40), branch: "main",
    subtree: "specs/commerce", stateDigest: "a".repeat(64), writeSetDigest: "b".repeat(64) };
  const recovery = { directory: "/recovery", packageDigest: "c".repeat(64),
    captureProfile: "canonical-untracked-retention", paths: ["specs/commerce/a.md"] };
  const target = { worktree: "/worktree", branch: BRANCH,
    headSha: "b".repeat(40), treeSha: "c".repeat(40), leaseDigest,
    leaseEpoch: lease.epoch, baseSha: "a".repeat(40), fenceSha: lease.fenceSha,
    device: "device", scope: "protected-head-refresh-controller", sessionId: "session",
    manifestDigest: "d".repeat(64), writeSetDigest: "e".repeat(64),
    cloudClaimId: lease.cloudAuthority.claimId,
    cloudClaimDigest: lease.cloudAuthority.claimDigest,
    taskAuthoritySubjectId: "urn:agentic-task:scope", taskAuthorityGeneration: 1,
    taskAuthorityBindingDigest: "f".repeat(64) };
  const layout = deriveCanonicalUntrackedRelocationLayout({ source, recovery, target });
  const relocationPlan = createCanonicalUntrackedRelocationPlan({ source, recovery, target,
    transaction: { stagePath: layout.stagePath, quarantinePath: layout.quarantinePath,
      receiptPath: layout.receiptPath, sameFilesystem: true } });
  const relocation = createCanonicalUntrackedRelocationRegistryIntent({ branch: BRANCH,
    sourceLeaseDigest: leaseDigest, sourceClaimId: lease.cloudAuthority.claimId,
    sourceFenceSha: lease.fenceSha, sourceAuthoritySnapshot: lease.cloudAuthority,
    planSnapshot: relocationPlan });
  return mutateWriterLeaseRegistry({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: leaseDigest, expectedClaimId: lease.cloudAuthority.claimId,
    action: ({ registry, lease: locked }) => ({
      registry: withCanonicalUntrackedRelocationRegistryIntent(registry, BRANCH, relocation),
      lease: locked, intent: relocation, changed: true,
    }) });
}

function completeScopeExpansionFixture({ priorHeartbeat = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "scope-rollover-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  let lease = store.claim({ sessionId: "session", device: "device",
    scope: "protected-head-refresh-controller", branch: BRANCH,
    worktreePath: "/worktree", baseSha: "a".repeat(40) });
  lease = store.annotate({ sessionId: "session", branch: BRANCH,
    values: { fenceSha: "b".repeat(40) } });
  const sourceAuthority = cloudAuthority({ claimId: CLAIM_1,
    expiresAt: "2099-08-30T02:00:00.000Z" });
  lease = casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: null,
    values: { cloudAuthority: sourceAuthority } }).lease;
  let priorHeartbeatIntent = null;
  if (priorHeartbeat) {
    lease = renewHeartbeat(store, lease, { local: false });
    priorHeartbeatIntent = store.readRegistry().heartbeatMutationIntents[BRANCH];
  }
  const sourceLeaseDigest = writerLeaseDigest(lease);
  beginScopeExpansionIntent({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: sourceLeaseDigest, expectedClaimId: CLAIM_1, plan: plan() });
  const authority = cloudAuthority({ claimId: CLAIM_2, claimDigest: "c".repeat(64),
    expiresAt: "2099-08-30T02:30:00.000Z" });
  lease = casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: sourceLeaseDigest, expectedClaimId: CLAIM_1, values: {
      cloudAuthority: authority,
      admission: { manifestDigest: plan().targetManifestDigest,
        writeSetDigest: plan().targetWriteSetDigest },
      taskAuthority: { bindingDigest: "f".repeat(64) },
      heartbeatAt: authority.expiresAt, expiresAt: authority.expiresAt,
  } }).lease;
  const leaseDigest = writerLeaseDigest(lease);
  const completed = advanceScopeExpansionIntent({ leaseStore: store, branch: BRANCH,
    expectedLeaseDigest: leaseDigest, expectedClaimId: CLAIM_2,
    expectedPlanDigest: plan().planDigest, values: {
      status: "complete", targetClaimId: CLAIM_2, targetClaimDigest: "c".repeat(64),
      targetReviewRequestId: "github-pull-request:PR_1",
      waiting: { claimId: CLAIM_2 }, waitingReceiptDigest: "a".repeat(64),
      sourceRetirementReceiptDigest: "b".repeat(64),
      promoted: { claimId: CLAIM_2 }, promotedReceiptDigest: "c".repeat(64),
      boundAuthority: authority,
      boundReceiptDigest: "d".repeat(64),
      localProjection: { leaseDigest, claimId: CLAIM_2,
        receiptDigest: "e".repeat(64),
        ownerIdentityDigest: digestValue({ deviceId: lease.device, sessionId: lease.sessionId,
          provider: authority.provider, targetRepository: authority.targetRepository,
          ledgerRepository: authority.ledgerRepository }),
        targetTaskAuthorityBindingDigest: lease.taskAuthority.bindingDigest },
      localProjectionReceiptDigest: "e".repeat(64),
      pullRequestProjection: { markerDigest: "f".repeat(64) },
      pullRequestProjectionReceiptDigest: "1".repeat(64),
      finalReceiptDigest: "2".repeat(64),
    } }).intent;
  return { root, store, lease, leaseDigest, completed, priorHeartbeatIntent };
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
    const beginRevision = store.readRegistry().revision;
    const replayedBegin = beginScopeExpansionIntent({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: sourceDigest,
      expectedClaimId: CLAIM_1, plan: plan(),
    });
    assert.equal(replayedBegin.intent.planDigest, intent.planDigest);
    assert.equal(replayedBegin.registryRevision, beginRevision);
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

test("heartbeat C1 intent replays exactly and only exact one-ahead C2 terminalizes it", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "heartbeat-intent-cas-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    let lease = store.claim({ sessionId: "session", device: "device",
      scope: "protected-head-refresh-controller", branch: BRANCH,
      worktreePath: "/worktree", baseSha: "a".repeat(40) });
    lease = store.annotate({ sessionId: "session", branch: BRANCH, values: {
      fenceSha: "b".repeat(40), cloudAuthority: cloudAuthority(),
    } });
    const sourceDigest = writerLeaseDigest(lease);
    const begun = assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: sourceDigest, expectedClaimId: CLAIM_1 });
    assert.equal(begun.heartbeatIntent.status, "active");
    const replay = assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: sourceDigest, expectedClaimId: CLAIM_1 });
    assert.equal(replay.registryRevision, begun.registryRevision);
    assert.equal(replay.heartbeatIntent.intentDigest, begun.heartbeatIntent.intentDigest);

    const invalid = cloudAuthority({ transitionCounter: 3, heartbeatCounter: 1,
      claimDigest: "a".repeat(64), claimLedgerRevision: "b".repeat(64),
      operationReceiptDigest: "c".repeat(64), expiresAt: "2026-08-30T02:40:00.000Z" });
    assert.throws(() => casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: sourceDigest, expectedClaimId: CLAIM_1,
      requireNoActiveIntent: true, values: { cloudAuthority: invalid } }),
    /not one exact authority renewal ahead/);
    assert.equal(writerLeaseDigest(store.read(BRANCH)), sourceDigest);
    assert.equal(store.readRegistry().heartbeatMutationIntents[BRANCH].status, "active");

    const successor = cloudAuthority({ transitionCounter: 2, heartbeatCounter: 1,
      claimDigest: "a".repeat(64), claimLedgerRevision: "b".repeat(64),
      operationReceiptDigest: "c".repeat(64), ledgerRevision: "a".repeat(40),
      ledgerDigest: "b".repeat(64), expiresAt: "2026-08-30T02:40:00.000Z" });
    assert.throws(() => casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: sourceDigest, expectedClaimId: CLAIM_1,
      values: { baseSha: "c".repeat(40), cloudAuthority: successor } }),
    /changed the non-cloud C1 lease subject/);
    const projected = casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: sourceDigest, expectedClaimId: CLAIM_1,
      requireNoActiveIntent: true, values: { cloudAuthority: successor } });
    assert.equal(projected.heartbeatIntent.status, "complete");
    assert.equal(store.readRegistry().heartbeatMutationIntents[BRANCH].status, "complete");
    assert.equal(projected.heartbeatIntent.targetLeaseDigest, writerLeaseDigest(projected.lease));
    const chained = assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(projected.lease), expectedClaimId: CLAIM_1 });
    assert.equal(chained.heartbeatIntent.predecessorIntentDigest,
      projected.heartbeatIntent.intentDigest);
    assert.equal(chained.heartbeatIntent.predecessorBridgeDigest, null);
    const chainRevision = store.readRegistry().revision;
    const chainedReplay = assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(projected.lease), expectedClaimId: CLAIM_1 });
    assert.equal(chainedReplay.registryRevision, chainRevision);
    assert.equal(chainedReplay.heartbeatIntent.predecessorIntentDigest,
      projected.heartbeatIntent.intentDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stale completed heartbeat tombstones cannot authorize a contradictory live authority", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "heartbeat-terminal-stale-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    let lease = store.claim({ sessionId: "session", device: "device",
      scope: "protected-head-refresh-controller", branch: BRANCH,
      worktreePath: "/worktree", baseSha: "a".repeat(40) });
    lease = store.annotate({ sessionId: "session", branch: BRANCH, values: {
      fenceSha: "b".repeat(40), cloudAuthority: cloudAuthority(),
    } });
    lease = renewHeartbeat(store, lease, { local: false });
    const completed = store.readRegistry().heartbeatMutationIntents[BRANCH];
    const contradictory = cloudAuthority({ claimId: CLAIM_2,
      claimDigest: "c".repeat(64), expiresAt: "2099-08-30T04:00:00.000Z" });
    lease = casWriterLeaseProjection({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_1,
      values: { cloudAuthority: contradictory } }).lease;
    assert.throws(() => assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_2 }),
    /fully completed durable intent/);
    assert.equal(store.readRegistry().heartbeatMutationIntents[BRANCH].intentDigest,
      completed.intentDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("heartbeat intent fails closed after ambiguous local C1 drift and on malformed journals", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "heartbeat-intent-drift-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    let lease = store.claim({ sessionId: "session", device: "device",
      scope: "protected-head-refresh-controller", branch: BRANCH,
      worktreePath: "/worktree", baseSha: "a".repeat(40) });
    lease = store.annotate({ sessionId: "session", branch: BRANCH, values: {
      fenceSha: "b".repeat(40), cloudAuthority: cloudAuthority(),
    } });
    assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_1 });
    const drifted = store.annotate({ sessionId: "session", branch: BRANCH,
      values: { runtimeRequired: true } });
    assert.throws(() => assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(drifted), expectedClaimId: CLAIM_1 }),
    /changed its exact C1 authority subject/);
    assert.equal(store.readRegistry().heartbeatMutationIntents[BRANCH].status, "active");

    const registry = JSON.parse(readFileSync(store.statePath, "utf8"));
    registry.heartbeatMutationIntents[BRANCH].targetClaimId = CLAIM_2;
    writeFileSync(store.statePath, `${JSON.stringify(registry, null, 2)}\n`);
    assert.throws(() => assertHeartbeatMutationIntentFence({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(drifted), expectedClaimId: CLAIM_1 }),
    /carries terminal evidence/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("active relocation fences scope-expansion begin under the same registry CAS", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "relocation-scope-fence-"));
  const store = createWriterLeaseStore({ gitCommonDir: root });
  try {
    let lease = store.claim({ sessionId: "session", device: "device",
      scope: "protected-head-refresh-controller", branch: BRANCH,
      worktreePath: "/worktree", baseSha: "a".repeat(40) });
    lease = store.annotate({ sessionId: "session", branch: BRANCH, values: {
      fenceSha: "b".repeat(40), cloudAuthority: cloudAuthority(),
    } });
    const leaseDigest = writerLeaseDigest(lease);
    installActiveRelocation(store, lease);
    assert.throws(() => beginScopeExpansionIntent({ leaseStore: store, branch: BRANCH,
      expectedLeaseDigest: leaseDigest, expectedClaimId: CLAIM_1, plan: plan() }),
    /relocation intent fences scope expansion/);
    assert.equal(store.readRegistry().scopeExpansionIntents?.[BRANCH], undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("completed scope expansion bridges a source heartbeat tombstone to target heartbeats", () => {
  const fixture = completeScopeExpansionFixture({ priorHeartbeat: true });
  try {
    const begun = assertHeartbeatMutationIntentFence({ leaseStore: fixture.store, branch: BRANCH,
      expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2 });
    assert.equal(begun.heartbeatIntent.predecessorIntentDigest,
      fixture.priorHeartbeatIntent.intentDigest);
    assert.match(begun.heartbeatIntent.predecessorBridgeDigest, /^[0-9a-f]{64}$/u);
    const revision = fixture.store.readRegistry().revision;
    const replay = assertHeartbeatMutationIntentFence({ leaseStore: fixture.store, branch: BRANCH,
      expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2 });
    assert.equal(replay.registryRevision, revision);
    assert.equal(replay.heartbeatIntent.predecessorBridgeDigest,
      begun.heartbeatIntent.predecessorBridgeDigest);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("incomplete or forged scope-expansion bridges cannot replace a heartbeat tombstone", () => {
  for (const mutation of [
    intent => { intent.status = "local-cas"; },
    intent => { intent.sourceLeaseDigest = "0".repeat(64); },
  ]) {
    const fixture = completeScopeExpansionFixture({ priorHeartbeat: true });
    try {
      const registry = fixture.store.readRegistry();
      mutation(registry.scopeExpansionIntents[BRANCH]);
      writeFileSync(fixture.store.statePath, `${JSON.stringify(registry, null, 2)}\n`);
      const before = fixture.store.readRegistry();
      assert.throws(() => assertHeartbeatMutationIntentFence({ leaseStore: fixture.store,
        branch: BRANCH, expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2 }),
      /fully completed durable intent|does not bridge the prior heartbeat authority/);
      assert.deepEqual(fixture.store.readRegistry(), before);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test("scope-expansion rollover replays the same target and archives one different completed target", () => {
  const fixture = completeScopeExpansionFixture();
  try {
    let lease = renewHeartbeat(fixture.store, fixture.lease);
    const same = rolloverCompletedScopeExpansionIntent({ leaseStore: fixture.store,
      branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_2,
      targetManifestDigest: plan().targetManifestDigest,
      targetWriteSetDigest: plan().targetWriteSetDigest });
    assert.equal(same.changed, false);
    assert.equal(same.intent.planDigest, plan().planDigest);

    lease = renewHeartbeat(fixture.store, lease, { now: "2099-08-30T02:32:00.000Z" });
    const changed = rolloverCompletedScopeExpansionIntent({ leaseStore: fixture.store,
      branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_2,
      targetManifestDigest: "5".repeat(64), targetWriteSetDigest: "6".repeat(64) });
    assert.equal(changed.changed, true);
    assert.equal(changed.intent, null);
    assert.equal(changed.archive.planDigest, plan().planDigest);
    const registry = fixture.store.readRegistry();
    assert.equal(registry.scopeExpansionIntents[BRANCH], undefined);
    assert.equal(registry.lastCompletedScopeExpansionIntents[BRANCH].tombstoneDigest,
      changed.archive.tombstoneDigest);
    registry.lastCompletedScopeExpansionIntents[BRANCH].finalReceiptDigest = "0".repeat(64);
    writeFileSync(fixture.store.statePath, `${JSON.stringify(registry, null, 2)}\n`);
    assert.throws(() => rolloverCompletedScopeExpansionIntent({ leaseStore: fixture.store,
      branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_2,
      targetManifestDigest: "5".repeat(64), targetWriteSetDigest: "6".repeat(64) }),
    /tombstone is malformed/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("scope-expansion rollover rejects incomplete and live-C2-drifted terminal intents", () => {
  const incompleteRoot = mkdtempSync(path.join(os.tmpdir(), "scope-rollover-incomplete-"));
  const incompleteStore = createWriterLeaseStore({ gitCommonDir: incompleteRoot });
  try {
    let lease = incompleteStore.claim({ sessionId: "session", device: "device",
      scope: "protected-head-refresh-controller", branch: BRANCH,
      worktreePath: "/worktree", baseSha: "a".repeat(40) });
    lease = incompleteStore.annotate({ sessionId: "session", branch: BRANCH,
      values: { fenceSha: "b".repeat(40), cloudAuthority: { claimId: CLAIM_1 } } });
    beginScopeExpansionIntent({ leaseStore: incompleteStore, branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_1, plan: plan() });
    assert.throws(() => rolloverCompletedScopeExpansionIntent({ leaseStore: incompleteStore,
      branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: CLAIM_1,
      targetManifestDigest: "5".repeat(64), targetWriteSetDigest: "6".repeat(64) }),
    /fully completed durable intent/);
  } finally { rmSync(incompleteRoot, { recursive: true, force: true }); }

  const fixture = completeScopeExpansionFixture();
  try {
    const drifted = casWriterLeaseProjection({ leaseStore: fixture.store, branch: BRANCH,
      expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2,
      values: { runtimeRequired: true } }).lease;
    assert.throws(() => rolloverCompletedScopeExpansionIntent({ leaseStore: fixture.store,
      branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(drifted), expectedClaimId: CLAIM_2,
      targetManifestDigest: "5".repeat(64), targetWriteSetDigest: "6".repeat(64) }),
    /does not match its exact live C2 projection/);
    assert.equal(fixture.store.readRegistry().scopeExpansionIntents[BRANCH].status, "complete");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("scope-expansion rollover preserves its terminal intent under every foreign active fence", () => {
  const cases = [
    { message: /heartbeat mutation intent fences scope expansion/,
      install: fixture => assertHeartbeatMutationIntentFence({ leaseStore: fixture.store,
        branch: BRANCH, expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2 }) },
    { message: /relocation intent fences scope expansion/,
      install: fixture => installActiveRelocation(fixture.store, fixture.lease) },
    { message: /recovery intent fences scope expansion/,
      install: fixture => mutateWriterLeaseRegistry({ leaseStore: fixture.store, branch: BRANCH,
        expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2,
        action: ({ registry, lease }) => ({ registry: { ...registry,
          activeOwnedDirtRecoveryIntents: {
            ...(registry.activeOwnedDirtRecoveryIntents || {}), [BRANCH]: {
              schema: "agentic-active-owned-dirt-recovery-intent/v1", status: "intent",
              planDigest: "a".repeat(64),
            },
          } }, lease, changed: true }) }) },
  ];
  for (const { install, message } of cases) {
    const fixture = completeScopeExpansionFixture();
    try {
      install(fixture);
      const before = fixture.store.readRegistry();
      assert.throws(() => rolloverCompletedScopeExpansionIntent({ leaseStore: fixture.store,
        branch: BRANCH, expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: CLAIM_2,
        targetManifestDigest: "5".repeat(64), targetWriteSetDigest: "6".repeat(64) }), message);
      assert.deepEqual(fixture.store.readRegistry(), before);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});
