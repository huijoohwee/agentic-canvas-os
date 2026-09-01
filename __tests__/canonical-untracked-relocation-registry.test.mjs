import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createCanonicalUntrackedRelocationPlan,
  createCanonicalUntrackedRelocationReceipt,
  deriveCanonicalUntrackedRelocationLayout,
} from "../scripts/canonical-untracked-relocation-contract.mjs";
import {
  inspectCanonicalUntrackedRelocationNoEffect,
  withCanonicalUntrackedRelocationRegistryIntent,
} from "../scripts/canonical-untracked-relocation-registry.mjs";
import { executeCanonicalUntrackedRelocation }
  from "../scripts/canonical-untracked-relocation-repository-adapter.mjs";
import {
  CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  captureLegacyDirtyLane,
} from "../scripts/legacy-dirty-lane-adoption-lib.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import {
  assertHeartbeatMutationIntentFence,
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";
import {
  createCanonicalUntrackedRelocationRegistryIntent,
  createHeartbeatMutationIntent,
  normalizeCanonicalUntrackedRelocationRegistryIntent,
  withHeartbeatMutationIntent,
} from "../scripts/writer-lease-registry-intents.mjs";

const D = character => character.repeat(64);
const S = character => character.repeat(40);
const EFFECT_INTENT_DIGEST = D("e");

test("registry relocation intent is active before action and complete only after durable receipt", async () => {
  const fixture = createFixture();
  try {
    let actions = 0;
    const dependencies = fixture.successDependencies();
    const result = await withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => {
        actions += 1;
        assert.equal(fixture.intent().status, "active");
        assert.equal(fixture.intent().effectIntentDigest, null);
        return fixture.durableReceipt;
      },
    }, dependencies);
    assert.equal(result.receiptDigest, fixture.receipt.receiptDigest);
    const completed = fixture.intent();
    assert.equal(completed.status, "complete");
    assert.equal(completed.effectIntentDigest, EFFECT_INTENT_DIGEST);
    assert.equal(completed.receiptDigest, fixture.receipt.receiptDigest);
    assert.equal(completed.targetLeaseDigest, completed.sourceLeaseDigest);
    assert.equal(completed.targetAuthoritySnapshot.transitionCounter, 3);

    const revision = fixture.store.readRegistry().revision;
    await withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => {
        actions += 1;
        assert.equal(fixture.intent().status, "complete");
        return fixture.durableReceipt;
      },
    }, dependencies);
    assert.equal(actions, 2);
    assert.equal(fixture.store.readRegistry().revision, revision);
  } finally { fixture.cleanup(); }
});

test("replay terminalizes an active registry record after the durable receipt CAS response is lost", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => fixture.durableReceipt,
    }, {
      ...fixture.successDependencies(),
      readEffectIntent: () => { throw new Error("terminal registry CAS response lost"); },
    }), /terminal registry CAS response lost/u);
    assert.equal(fixture.intent().status, "active");

    let replayedExistingReceipt = false;
    await withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => {
        replayedExistingReceipt = true;
        assert.equal(fixture.intent().status, "active");
        return fixture.durableReceipt;
      },
    }, fixture.successDependencies());
    assert.equal(replayedExistingReceipt, true);
    assert.equal(fixture.intent().status, "complete");
  } finally { fixture.cleanup(); }
});

test("completed receipt replay tolerates a later heartbeat without reusing stale mutation authority", async () => {
  const fixture = createFixture();
  try {
    await withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => fixture.durableReceipt,
    }, fixture.successDependencies());
    const sourceLeaseDigest = fixture.leaseDigest;
    const heartbeat = fixture.store.heartbeat({
      sessionId: "session-1", branch: fixture.branch, ttlMs: 60_000,
    });
    assert.notEqual(writerLeaseDigest(heartbeat), sourceLeaseDigest);
    const heartbeatRevision = fixture.store.readRegistry().revision;

    const replayed = await withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      preflight: () => { throw new Error("completed replay must skip stale authority preflight"); },
      action: () => fixture.durableReceipt,
    }, fixture.successDependencies());
    assert.equal(replayed.receiptDigest, fixture.receipt.receiptDigest);
    assert.equal(fixture.store.readRegistry().revision, heartbeatRevision);
    assert.equal(fixture.intent().status, "complete");
  } finally { fixture.cleanup(); }
});

test("public execution rejects invalid authority before changing registry bytes", async () => {
  const fixture = createNoEffectFixture();
  try {
    const before = readFileSync(fixture.store.statePath, "utf8");
    const revision = fixture.store.readRegistry().revision;
    for (const message of ["task capability is revoked", "admitted manifest is invalid"]) {
      await assert.rejects(executeCanonicalUntrackedRelocation({
        ...fixture.input, plan: fixture.plan,
        authorization: fixture.plan.exactAuthorization,
      }, {
        now: () => new Date("2026-08-30T10:00:00.000Z"),
        inspectTargetAuthority: () => { throw new Error(message); },
      }), new RegExp(message, "u"));
      assert.equal(readFileSync(fixture.store.statePath, "utf8"), before);
      assert.equal(fixture.store.readRegistry().revision, revision);
    }
  } finally { fixture.cleanup(); }
});

test("a pending heartbeat excludes relocation before the action starts", async () => {
  const fixture = createFixture();
  try {
    const heartbeat = createHeartbeatMutationIntent({
      branch: fixture.branch, sourceLeaseDigest: fixture.leaseDigest,
      sourceClaimId: fixture.authority.claimId,
      sourceAuthoritySnapshot: fixture.authority,
    });
    mutateWriterLeaseRegistry({
      leaseStore: fixture.store, branch: fixture.branch,
      expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: fixture.authority.claimId,
      action: ({ registry, lease }) => ({
        registry: withHeartbeatMutationIntent(registry, fixture.branch, heartbeat),
        lease, intent: heartbeat, changed: true,
      }),
    });
    let called = false;
    await assert.rejects(withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => { called = true; return fixture.durableReceipt; },
    }, fixture.successDependencies()), /heartbeat mutation intent fences/u);
    assert.equal(called, false);
  } finally { fixture.cleanup(); }
});

test("an exact pre-effect failure seals an aborted tombstone", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => {
        assert.equal(fixture.intent().status, "active");
        throw new Error("cloud verification failed");
      },
    }, {
      leaseStore: fixture.store,
      inspectNoEffect: fixture.noEffectProof,
    }), /cloud verification failed/u);
    const aborted = fixture.intent();
    assert.equal(aborted.status, "aborted");
    assert.equal(aborted.abortReceiptDigest, fixture.noEffectProof().abortReceiptDigest);
    assert.deepEqual(aborted.abortReceiptSnapshot, fixture.noEffectProof());
    assert.equal(aborted.effectIntentDigest, null);
    const invalidCore = {
      ...fixture.noEffectProof(), targetState: "exact",
    };
    delete invalidCore.abortReceiptDigest;
    const invalidProof = { ...invalidCore, abortReceiptDigest: digestValue(invalidCore) };
    assert.throws(() => createCanonicalUntrackedRelocationRegistryIntent({
      status: "aborted", branch: fixture.branch,
      sourceLeaseDigest: fixture.leaseDigest, sourceClaimId: fixture.authority.claimId,
      sourceFenceSha: fixture.plan.evidence.target.fenceSha,
      sourceAuthoritySnapshot: fixture.authority, planSnapshot: fixture.plan,
      abortReceiptSnapshot: invalidProof,
    }), /no-effect abort proof is invalid/u);
  } finally { fixture.cleanup(); }
});

test("relocation record rejects a cloud claim digest outside the sealed plan", () => {
  const fixture = createFixture();
  try {
    assert.throws(() => createCanonicalUntrackedRelocationRegistryIntent({
      branch: fixture.branch, sourceLeaseDigest: fixture.leaseDigest,
      sourceClaimId: fixture.authority.claimId,
      sourceFenceSha: fixture.plan.evidence.target.fenceSha,
      sourceAuthoritySnapshot: { ...fixture.authority, claimDigest: D("0") },
      planSnapshot: fixture.plan,
    }), /exact target authority subject/u);
  } finally { fixture.cleanup(); }
});

test("ambiguous failure retains the active relocation fence for exact replay", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(withCanonicalUntrackedRelocationRegistryIntent({
      plan: fixture.plan, input: fixture.input,
      action: () => { throw new Error("filesystem state ambiguous"); },
    }, {
      leaseStore: fixture.store,
      inspectNoEffect: () => null,
    }), /filesystem state ambiguous/u);
    assert.equal(fixture.intent().status, "active");
    assert.equal(fixture.intent().abortReceiptDigest, null);
    assert.throws(() => assertHeartbeatMutationIntentFence({
      leaseStore: fixture.store, branch: fixture.branch,
      expectedLeaseDigest: fixture.leaseDigest, expectedClaimId: fixture.authority.claimId,
    }), /relocation intent fences this heartbeat/u);
  } finally { fixture.cleanup(); }
});

test("no-effect abort proof requires exact canonical bytes and absent target and quarantine", () => {
  const fixture = createNoEffectFixture();
  try {
    const proof = inspectCanonicalUntrackedRelocationNoEffect(fixture.plan);
    assert.equal(proof.status, "no-effect");
    assert.match(proof.abortReceiptDigest, /^[0-9a-f]{64}$/u);
    mkdirSync(path.dirname(fixture.targetFile), { recursive: true });
    writeFileSync(fixture.targetFile, "alpha\n");
    assert.equal(inspectCanonicalUntrackedRelocationNoEffect(fixture.plan), null);
  } finally { fixture.cleanup(); }
});

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "canonical-relocation-registry-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  const recovery = path.join(root, "recovery");
  mkdirSync(source); mkdirSync(target); mkdirSync(recovery);
  const store = createWriterLeaseStore({ gitCommonDir: root });
  const branch = "agent/device/commerce-spec";
  const authority = Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    claimId: D("a"), claimDigest: D("b"), claimLedgerRevision: D("c"),
    operationReceiptDigest: D("d"), transitionCounter: 3, heartbeatCounter: 1,
    expiresAt: "2026-08-30T12:00:00.000Z",
  });
  let lease = store.claim({
    sessionId: "session-1", device: "device", scope: "commerce-spec", branch,
    worktreePath: target, baseSha: S("1"),
  });
  lease = store.annotate({
    sessionId: "session-1", branch,
    values: { fenceSha: S("2"), cloudAuthority: authority },
  });
  const leaseDigest = writerLeaseDigest(lease);
  const sourceEvidence = Object.freeze({
    worktree: source, commonDirectory: root, headSha: S("1"), treeSha: S("3"),
    branch: "main", subtree: "specs/commerce", stateDigest: D("1"), writeSetDigest: D("2"),
  });
  const recoveryEvidence = Object.freeze({
    directory: recovery, packageDigest: D("3"),
    captureProfile: "canonical-untracked-retention", paths: ["specs/commerce/a.md"],
  });
  const targetEvidence = Object.freeze({
    worktree: target, branch, headSha: S("2"), treeSha: S("3"),
    leaseDigest, leaseEpoch: lease.epoch, baseSha: S("1"), fenceSha: S("2"),
    device: "device", scope: "commerce-spec", sessionId: "session-1",
    manifestDigest: D("4"), writeSetDigest: D("5"),
    cloudClaimId: authority.claimId, cloudClaimDigest: authority.claimDigest,
    taskAuthoritySubjectId: "urn:agentic-task:commerce-spec",
    taskAuthorityGeneration: 1, taskAuthorityBindingDigest: D("6"),
  });
  const layout = deriveCanonicalUntrackedRelocationLayout({
    source: sourceEvidence, recovery: recoveryEvidence, target: targetEvidence,
  });
  const plan = createCanonicalUntrackedRelocationPlan({
    source: sourceEvidence, recovery: recoveryEvidence, target: targetEvidence,
    transaction: {
      stagePath: layout.stagePath, quarantinePath: layout.quarantinePath,
      receiptPath: layout.receiptPath, sameFilesystem: true,
    },
  });
  const receipt = createCanonicalUntrackedRelocationReceipt({
    plan, taskAuthorityReceiptDigest: D("7"), mutationAuthorityReceiptDigest: D("8"),
    targetInstalledDigest: D("f"), sourceQuarantineDigest: D("f"),
    completedAt: "2026-08-30T10:00:00.000Z",
  });
  const durableReceipt = Object.freeze({ ...receipt, receiptPath: layout.receiptPath });
  const input = Object.freeze({
    source, target, recovery, sessionId: "session-1",
    taskAuthorityFile: path.join(root, "authority.json"),
    writeScopeManifestPath: path.join(root, "manifest.json"),
  });
  return {
    root, branch, authority, store, leaseDigest, plan, receipt, durableReceipt, input,
    intent: () => normalizeCanonicalUntrackedRelocationRegistryIntent(
      store.readRegistry().canonicalUntrackedRelocationIntents?.[branch] ?? null),
    successDependencies: () => ({
      leaseStore: store,
      readReceipt: () => durableReceipt,
      readEffectIntent: () => ({ intentDigest: EFFECT_INTENT_DIGEST }),
      inspectNoEffect: () => null,
    }),
    noEffectProof: () => {
      const core = Object.freeze({
        schema: "agentic-canonical-untracked-relocation-no-effect-abort/v1",
        status: "no-effect", planDigest: plan.planDigest,
        sourceLeaseDigest: targetEvidence.leaseDigest,
        sourceClaimId: targetEvidence.cloudClaimId,
        sourceState: "exact", targetState: "absent", quarantineState: "absent",
        effectIntentDigest: null,
      });
      return Object.freeze({ ...core, abortReceiptDigest: digestValue(core) });
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createNoEffectFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "canonical-relocation-no-effect-")));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  const recoveryDirectory = path.join(root, "recovery");
  mkdirSync(source);
  git(source, ["init", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  writeFileSync(path.join(source, "base.txt"), "base\n");
  git(source, ["add", "base.txt"]); git(source, ["commit", "-m", "base"]);
  const headSha = git(source, ["rev-parse", "HEAD"]);
  git(root, ["init", "--bare", "remote.git"]);
  git(source, ["remote", "add", "origin", path.join(root, "remote.git")]);
  git(source, ["push", "-u", "origin", "main"]);
  git(source, ["worktree", "add", "-b", "agent/device/commerce-spec", target]);
  mkdirSync(path.join(target, "specs"));
  const relativeFile = "specs/commerce/a.md";
  mkdirSync(path.join(source, "specs/commerce"), { recursive: true });
  writeFileSync(path.join(source, relativeFile), "alpha\n");
  const recovery = captureLegacyDirtyLane({
    sourceWorktree: source, recoveryDirectory, protectedTipSha: headSha,
    operatorSessionId: "session-1",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  });
  const commonDirectory = path.resolve(source, git(source, ["rev-parse", "--git-common-dir"]));
  const store = createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const branch = "agent/device/commerce-spec";
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    claimId: D("a"), claimDigest: D("b"), claimLedgerRevision: D("c"),
    operationReceiptDigest: D("d"), transitionCounter: 3, heartbeatCounter: 1,
    expiresAt: "2026-08-30T12:00:00.000Z",
  };
  let lease = store.claim({
    sessionId: "session-1", device: "device", scope: "commerce-spec", branch,
    worktreePath: target, baseSha: headSha,
  });
  const fenceSha = git(target, ["rev-parse", "HEAD"]);
  lease = store.annotate({
    sessionId: "session-1", branch, values: { fenceSha, cloudAuthority: authority },
  });
  const sourceEvidence = {
    worktree: source, commonDirectory, headSha,
    treeSha: git(source, ["rev-parse", "HEAD^{tree}"]), branch: "main",
    subtree: "specs/commerce", stateDigest: recovery.stateDigest,
    writeSetDigest: recovery.writeSetDigest,
  };
  const recoveryEvidence = {
    directory: recoveryDirectory, packageDigest: recovery.packageDigest,
    captureProfile: recovery.captureProfile, paths: recovery.untracked.map(entry => entry.path),
  };
  const targetEvidence = {
    worktree: target, branch, headSha: fenceSha,
    treeSha: git(target, ["rev-parse", "HEAD^{tree}"]),
    leaseDigest: writerLeaseDigest(lease), leaseEpoch: lease.epoch,
    baseSha: headSha, fenceSha, device: "device", scope: "commerce-spec",
    sessionId: "session-1", manifestDigest: D("4"), writeSetDigest: D("5"),
    cloudClaimId: authority.claimId, cloudClaimDigest: authority.claimDigest,
    taskAuthoritySubjectId: "urn:agentic-task:commerce-spec",
    taskAuthorityGeneration: 1, taskAuthorityBindingDigest: D("6"),
  };
  const layout = deriveCanonicalUntrackedRelocationLayout({
    source: sourceEvidence, recovery: recoveryEvidence, target: targetEvidence,
  });
  const plan = createCanonicalUntrackedRelocationPlan({
    source: sourceEvidence, recovery: recoveryEvidence, target: targetEvidence,
    transaction: {
      stagePath: layout.stagePath, quarantinePath: layout.quarantinePath,
      receiptPath: layout.receiptPath, sameFilesystem: true,
    },
  });
  return {
    plan, store, targetFile: path.join(target, relativeFile),
    input: {
      source, target, recovery: recoveryDirectory, sessionId: "session-1",
      taskAuthorityFile: path.join(root, "authority.json"),
      writeScopeManifestPath: path.join(root, "write-scope.json"),
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function git(worktree, args) {
  return execFileSync("git", args, { cwd: worktree, encoding: "utf8", stdio: "pipe" }).trim();
}
