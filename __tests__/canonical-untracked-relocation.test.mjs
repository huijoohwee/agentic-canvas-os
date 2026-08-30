import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCanonicalUntrackedRelocationAuthorization,
  createCanonicalUntrackedRelocationAuthorityAttempt,
  createCanonicalUntrackedRelocationPlan,
  createCanonicalUntrackedRelocationReceipt,
  deriveCanonicalUntrackedRelocationLayout,
} from "../scripts/canonical-untracked-relocation-contract.mjs";
import {
  canonicalUntrackedRelocationOperationLayout,
  executeCanonicalUntrackedFilesystemTransaction,
  normalizeCanonicalUntrackedRelocationEntries,
  preflightCanonicalUntrackedRecoveryManifest,
  prepareCanonicalUntrackedRelocationTransaction,
  requireCanonicalUntrackedRelocationEffectDevices,
  writeCanonicalUntrackedRelocationEffectIntent,
} from "../scripts/canonical-untracked-relocation-transaction.mjs";
import { assertCanonicalUntrackedRelocationLiveRepositoryState,
  executeCanonicalUntrackedRelocation, withGitMutationFence }
  from "../scripts/canonical-untracked-relocation-repository-adapter.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const D = character => character.repeat(64);
const S = character => character.repeat(40);

test("plan digest seals source, recovery, target authority, and transaction paths", () => {
  const fixture = createFixture();
  try {
    const first = fixture.plan;
    const second = createCanonicalUntrackedRelocationPlan(first.evidence);
    assert.equal(second.planDigest, first.planDigest);
    assert.equal(second.exactAuthorization,
      `authorize canonical-untracked-relocation ${first.planDigest}`);
    const changed = fixture.makePlan({ leaseDigest: D("9") });
    assert.notEqual(changed.planDigest, first.planDigest);
  } finally { fixture.cleanup(); }
});

test("exact authorization rejects generic approval and accepts only the sealed plan", () => {
  const fixture = createFixture();
  try {
    assert.throws(() => assertCanonicalUntrackedRelocationAuthorization({
      plan: fixture.plan,
      authorization: "run",
    }), /requires exact authorization/u);
    assert.equal(assertCanonicalUntrackedRelocationAuthorization({
      plan: fixture.plan,
      authorization: fixture.plan.exactAuthorization,
    }).planDigest, fixture.plan.planDigest);
  } finally { fixture.cleanup(); }
});

test("public execution fails closed until the two-sided registry intent owner is installed", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(executeCanonicalUntrackedRelocation({
      plan: fixture.plan, authorization: fixture.plan.exactAuthorization,
    }), /two-sided registry mutation-intent owner/u);
    assert.equal(readFileSync(path.join(fixture.sourceRoot, "a.md"), "utf8"), "alpha\n");
    assert.equal(existsSync(fixture.targetRoot), false);
  } finally { fixture.cleanup(); }
});

test("plan construction rejects transaction paths not derived from sealed evidence", () => {
  const fixture = createFixture();
  try {
    const forged = structuredClone(fixture.plan.evidence);
    forged.transaction.stagePath = path.join(fixture.root, "outside-stage");
    assert.throws(
      () => createCanonicalUntrackedRelocationPlan(forged),
      /layout is not derived/u,
    );
  } finally { fixture.cleanup(); }
});

test("filesystem transaction installs the target and atomically quarantines canonical source", () => {
  const fixture = createFixture();
  try {
    const result = executeCanonicalUntrackedFilesystemTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    assert.equal(result.status, "relocated");
    assert.equal(existsSync(fixture.sourceRoot), false);
    assert.equal(readFileSync(path.join(fixture.targetRoot, "a.md"), "utf8"), "alpha\n");
    assert.equal(readFileSync(path.join(fixture.targetRoot, "nested/b.md"), "utf8"), "beta\n");
    assert.equal(readFileSync(path.join(fixture.quarantine, "a.md"), "utf8"), "alpha\n");
    assert.equal(readFileSync(path.join(fixture.recoveryFiles, "a.md"), "utf8"), "alpha\n");
    assert.equal(result.contentDigest, contentDigest(fixture.entries));
  } finally { fixture.cleanup(); }
});

test("filesystem transaction is idempotent after target install and source quarantine", () => {
  const fixture = createFixture();
  try {
    const first = executeCanonicalUntrackedFilesystemTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    const second = executeCanonicalUntrackedFilesystemTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    assert.deepEqual(second, first);
  } finally { fixture.cleanup(); }
});

test("partial canonical stage is retained and rebuilt before either repository moves", () => {
  const fixture = createFixture();
  try {
    const layout = canonicalUntrackedRelocationOperationLayout(fixture.plan);
    mkdirSync(layout.stagePath, { recursive: true });
    writeFileSync(path.join(layout.stagePath, "partial.md"), "partial\n");
    executeCanonicalUntrackedFilesystemTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    const retained = readdirSync(layout.transactionRoot)
      .filter(item => item.startsWith("target-stage.retained-"));
    assert.equal(retained.length, 1);
    assert.equal(readFileSync(path.join(fixture.targetRoot, "a.md"), "utf8"), "alpha\n");
    assert.equal(existsSync(fixture.sourceRoot), false);
  } finally { fixture.cleanup(); }
});

test("one source intent prevents a second target plan from installing duplicate bytes", () => {
  const fixture = createFixture();
  try {
    const firstLayout = canonicalUntrackedRelocationOperationLayout(fixture.plan);
    prepareCanonicalUntrackedRelocationTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    renameSync(firstLayout.stagePath, fixture.targetRoot);
    const secondTarget = path.join(fixture.root, "target-two");
    mkdirSync(path.join(secondTarget, "specs"), { recursive: true });
    const secondPlan = fixture.makePlan({
      targetWorktree: secondTarget,
      leaseDigest: D("7"),
      packageDigest: D("8"),
    });
    const secondLayout = canonicalUntrackedRelocationOperationLayout(secondPlan);
    assert.equal(secondLayout.sourceOperationId, firstLayout.sourceOperationId);
    assert.throws(() => executeCanonicalUntrackedFilesystemTransaction({
      plan: secondPlan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    }), /source relocation intent drifted/u);
    assert.equal(existsSync(secondLayout.transactionRoot), false);
    assert.equal(existsSync(path.join(secondTarget, fixture.subtree)), false);
    assert.equal(readFileSync(path.join(fixture.sourceRoot, "a.md"), "utf8"), "alpha\n");
  } finally { fixture.cleanup(); }
});

test("stable target-subject substitution cannot reuse the source slot", () => {
  const fixture = createFixture();
  try {
    const baseline = canonicalUntrackedRelocationOperationLayout(fixture.plan);
    prepareCanonicalUntrackedRelocationTransaction({
      plan: fixture.plan, entries: fixture.entries, recoveryDirectory: fixture.recovery,
    });
    const cases = [
      { branch: "agent/device/other-scope" },
      { headSha: S("d"), fenceSha: S("d") },
      { leaseEpoch: 2 }, { sessionId: "session-2" }, { device: "other-device" },
      { scope: "other-scope" }, { manifestDigest: D("d") }, { writeSetDigest: D("e") },
      { cloudClaimId: D("f") }, { taskAuthoritySubjectId: "urn:agentic-task:other" },
      { taskAuthorityGeneration: 2 }, { taskAuthorityBindingDigest: D("0") },
    ];
    for (const targetOverrides of cases) {
      const candidate = fixture.makePlan({ targetOverrides });
      const layout = canonicalUntrackedRelocationOperationLayout(candidate);
      assert.equal(layout.sourceOperationId, baseline.sourceOperationId);
      assert.notEqual(layout.transactionRoot, baseline.transactionRoot);
      assert.throws(() => prepareCanonicalUntrackedRelocationTransaction({
        plan: candidate, entries: fixture.entries, recoveryDirectory: fixture.recovery,
      }), /source relocation intent drifted/u);
      assert.equal(existsSync(layout.transactionRoot), false);
    }
  } finally { fixture.cleanup(); }
});

test("fresh lease and cloud digests reuse the exact transaction before either rename", () => {
  const fixture = createFixture();
  try {
    const firstLayout = canonicalUntrackedRelocationOperationLayout(fixture.plan);
    prepareCanonicalUntrackedRelocationTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    const refreshed = fixture.makePlan({ leaseDigest: D("7"), cloudClaimDigest: D("8") });
    assert.notEqual(refreshed.planDigest, fixture.plan.planDigest);
    assert.equal(
      canonicalUntrackedRelocationOperationLayout(refreshed).transactionRoot,
      firstLayout.transactionRoot,
    );
    executeCanonicalUntrackedFilesystemTransaction({
      plan: refreshed,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    assert.equal(existsSync(fixture.sourceRoot), false);
    assert.equal(readFileSync(path.join(fixture.targetRoot, "a.md"), "utf8"), "alpha\n");
  } finally { fixture.cleanup(); }
});

test("fresh authority resumes after target installation without creating a second stage", () => {
  const fixture = createFixture();
  try {
    const layout = canonicalUntrackedRelocationOperationLayout(fixture.plan);
    prepareCanonicalUntrackedRelocationTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    const firstEffect = writeCanonicalUntrackedRelocationEffectIntent({
      plan: fixture.plan, phase: "target-install",
      taskAuthorityReceiptDigest: D("7"),
      mutationAuthorityReceiptDigest: D("8"),
      receiptTimestamp: "2026-08-30T00:00:00.000Z",
    });
    renameSync(layout.stagePath, fixture.targetRoot);
    const refreshed = fixture.makePlan({ leaseDigest: D("7"), cloudClaimDigest: D("8") });
    const secondEffect = writeCanonicalUntrackedRelocationEffectIntent({
      plan: refreshed, phase: "source-quarantine",
      taskAuthorityReceiptDigest: D("9"),
      mutationAuthorityReceiptDigest: D("a"),
      receiptTimestamp: "2026-08-30T00:01:00.000Z",
      targetInstallAttempt: firstEffect.targetInstallAttempt,
    });
    executeCanonicalUntrackedFilesystemTransaction({
      plan: refreshed,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    assert.equal(existsSync(layout.stagePath), false);
    assert.equal(existsSync(fixture.sourceRoot), false);
    assert.equal(readFileSync(path.join(fixture.quarantine, "nested/b.md"), "utf8"), "beta\n");
    const receipt = createCanonicalUntrackedRelocationReceipt({
      plan: refreshed,
      taskAuthorityReceiptDigest: secondEffect.sourceQuarantineAttempt.taskAuthorityReceiptDigest,
      mutationAuthorityReceiptDigest: secondEffect.sourceQuarantineAttempt.mutationAuthorityReceiptDigest,
      targetInstallAttempt: secondEffect.targetInstallAttempt,
      sourceQuarantineAttempt: secondEffect.sourceQuarantineAttempt,
      targetInstalledDigest: contentDigest(fixture.entries),
      sourceQuarantineDigest: contentDigest(fixture.entries),
      completedAt: secondEffect.sourceQuarantineAttempt.authorizedAt,
    });
    assert.equal(receipt.authorityLineage.targetInstall.planDigest, fixture.plan.planDigest);
    assert.equal(receipt.authorityLineage.sourceQuarantine.planDigest, refreshed.planDigest);
  } finally { fixture.cleanup(); }
});

test("authoritative receipt, transaction, and recovery ancestors cannot escape through symlinks", () => {
  const fixture = createFixture();
  try {
    const outside = path.join(fixture.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(fixture.recovery, "receipt-link"), "dir");
    assert.throws(
      () => fixture.makePlan({
        receiptPath: path.join(fixture.recovery, "receipt-link", "receipt.json"),
      }),
      /derived authoritative receipt/u,
    );
    assert.equal(existsSync(path.join(outside, "receipt.json")), false);

    writeFileSync(path.join(outside, "tracked.patch"), "outside\n");
    symlinkSync(path.join(outside, "tracked.patch"), path.join(fixture.recovery, "tracked.patch"));
    writeFileSync(path.join(fixture.recovery, ".complete"), `${D("3")}\n`);
    writeFileSync(path.join(fixture.recovery, "manifest.json"), JSON.stringify({
      tracked: [], untracked: fixture.entries.map(entry => ({ ...entry, kind: "file" })),
    }));
    assert.throws(
      () => preflightCanonicalUntrackedRecoveryManifest(fixture.recovery),
      /tracked\.patch must be a bounded regular file/u,
    );
    rmSync(path.join(fixture.recovery, "tracked.patch"));

    symlinkSync(outside, path.join(fixture.recovery, ".canonical-untracked-relocation"), "dir");
    assert.throws(() => prepareCanonicalUntrackedRelocationTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    }), /unsafe ancestor/u);
    assert.deepEqual(readdirSync(outside), ["tracked.patch"]);

    const nested = path.join(fixture.recoveryFiles, "nested");
    const outsideNested = path.join(outside, "nested");
    rmSync(nested, { recursive: true });
    mkdirSync(outsideNested);
    writeFileSync(path.join(outsideNested, "b.md"), "beta\n");
    symlinkSync(outsideNested, nested, "dir");
    assert.throws(() => normalizeCanonicalUntrackedRelocationEntries(
      fixture.entries.map(entry => ({ ...entry, ownership: "untracked", kind: "file" })),
      fixture.recovery,
    ), /real non-symlink directory/u);
    assert.equal(readFileSync(path.join(outsideNested, "b.md"), "utf8"), "beta\n");
    assert.equal(readFileSync(path.join(fixture.sourceRoot, "a.md"), "utf8"), "alpha\n");
  } finally { fixture.cleanup(); }
});

test("rename endpoint device drift blocks before target installation", () => {
  const fixture = createFixture();
  try {
    prepareCanonicalUntrackedRelocationTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    });
    const layout = canonicalUntrackedRelocationOperationLayout(fixture.plan);
    assert.throws(() => requireCanonicalUntrackedRelocationEffectDevices(
      { plan: fixture.plan, entries: fixture.entries },
      { stat: item => ({ dev: item === layout.transactionRoot ? statSync(item).dev + 1 : statSync(item).dev }) },
    ), /one filesystem/u);
    assert.equal(existsSync(fixture.targetRoot), false);
    assert.equal(readFileSync(path.join(fixture.sourceRoot, "a.md"), "utf8"), "alpha\n");
  } finally { fixture.cleanup(); }
});

test("locked live Git and whole-worktree drift fail before filesystem effects", () => {
  const fixture = createFixture();
  try {
    const sourceCapture = {
      branch: "main",
      headSha: fixture.plan.evidence.source.headSha,
      stateDigest: fixture.plan.evidence.source.stateDigest,
      writeSetDigest: fixture.plan.evidence.source.writeSetDigest,
      trackedPaths: [],
      untrackedPaths: fixture.entries.map(entry => entry.path),
    };
    const targetCapture = {
      branch: fixture.plan.evidence.target.branch,
      headSha: fixture.plan.evidence.target.headSha,
      trackedPaths: [],
      untrackedPaths: [],
    };
    const git = (worktree, args) => {
      const command = args.join(" ");
      if (command === "branch --show-current") {
        return worktree === fixture.source ? "main" : fixture.plan.evidence.target.branch;
      }
      if (command === "rev-parse HEAD") {
        return worktree === fixture.source
          ? fixture.plan.evidence.source.headSha : fixture.plan.evidence.target.headSha;
      }
      if (command === "rev-parse HEAD^{tree}") return fixture.plan.evidence.source.treeSha;
      if (command === "rev-parse refs/remotes/origin/main") return fixture.plan.evidence.source.headSha;
      throw new Error(`unexpected Git probe: ${command}`);
    };
    assert.doesNotThrow(() => assertCanonicalUntrackedRelocationLiveRepositoryState(
      { plan: fixture.plan, entries: fixture.entries },
      { gitText: git, captureSourceEvidence: worktree => worktree === fixture.source
        ? sourceCapture : targetCapture },
    ));
    assert.throws(() => assertCanonicalUntrackedRelocationLiveRepositoryState(
      { plan: fixture.plan, entries: fixture.entries },
      { gitText: (worktree, args) => worktree === fixture.target && args.join(" ") === "rev-parse HEAD"
        ? S("d") : git(worktree, args), captureSourceEvidence: worktree => worktree === fixture.source
        ? sourceCapture : targetCapture },
    ), /refs changed/u);
    assert.throws(() => assertCanonicalUntrackedRelocationLiveRepositoryState(
      { plan: fixture.plan, entries: fixture.entries },
      { gitText: git, captureSourceEvidence: worktree => worktree === fixture.source
        ? sourceCapture : { ...targetCapture, untrackedPaths: ["unrelated.txt"] } },
    ), /target or quarantine changed/u);
    assert.equal(existsSync(fixture.targetRoot), false);
    assert.equal(readFileSync(path.join(fixture.sourceRoot, "a.md"), "utf8"), "alpha\n");
  } finally { fixture.cleanup(); }
});

test("Git mutation fence blocks cooperative index, ref, and worktree removal and releases exact locks", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "canonical-relocation-fence-")));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  try {
    execFileSync("git", ["init", "-b", "main", source], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: source });
    execFileSync("git", ["config", "user.name", "Relocation Test"], { cwd: source });
    writeFileSync(path.join(source, "base.txt"), "base\n");
    execFileSync("git", ["add", "base.txt"], { cwd: source });
    execFileSync("git", ["commit", "-m", "base"], { cwd: source, stdio: "ignore" });
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: source });
    execFileSync("git", ["worktree", "add", "-b", "agent/device/commerce-spec", target],
      { cwd: source, stdio: "ignore" });
    const commonDirectory = realpathSync(path.resolve(source, execFileSync(
      "git", ["rev-parse", "--git-common-dir"], { cwd: source, encoding: "utf8" },
    ).trim()));
    const targetGit = realpathSync(path.resolve(target, execFileSync(
      "git", ["rev-parse", "--git-dir"], { cwd: target, encoding: "utf8" },
    ).trim()));
    writeFileSync(path.join(target, "base.txt"), "changed\n");
    const result = await withGitMutationFence({ planDigest: D("f"), evidence: {
      source: { worktree: source, commonDirectory },
      target: { worktree: target, branch: "agent/device/commerce-spec" },
    } }, () => {
      assert.equal(existsSync(path.join(targetGit, "index.lock")), true);
      assert.equal(existsSync(path.join(targetGit, "locked")), true);
      assert.throws(() => execFileSync("git", ["add", "base.txt"], { cwd: target, stdio: "pipe" }));
      assert.throws(() => execFileSync("git", ["worktree", "remove", "--force", target],
        { cwd: source, stdio: "pipe" }));
      return "fenced";
    });
    assert.equal(result, "fenced");
    assert.equal(existsSync(path.join(targetGit, "index.lock")), false);
    assert.equal(existsSync(path.join(targetGit, "locked")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("target drift blocks before canonical source moves", () => {
  const fixture = createFixture();
  try {
    mkdirSync(fixture.targetRoot, { recursive: true });
    writeFileSync(path.join(fixture.targetRoot, "a.md"), "different\n");
    assert.throws(() => executeCanonicalUntrackedFilesystemTransaction({
      plan: fixture.plan,
      entries: fixture.entries,
      recoveryDirectory: fixture.recovery,
    }), /ambiguous or drifted|drifted before staging/u);
    assert.equal(readFileSync(path.join(fixture.sourceRoot, "a.md"), "utf8"), "alpha\n");
    assert.equal(existsSync(fixture.quarantine), false);
  } finally { fixture.cleanup(); }
});

test("receipt binds both authority receipts without claiming ref, cloud, or remote mutation", () => {
  const fixture = createFixture();
  try {
    const receipt = createCanonicalUntrackedRelocationReceipt({
      plan: fixture.plan,
      taskAuthorityReceiptDigest: D("7"),
      mutationAuthorityReceiptDigest: D("8"),
      targetInstalledDigest: contentDigest(fixture.entries),
      sourceQuarantineDigest: contentDigest(fixture.entries),
      completedAt: "2026-08-30T00:00:00.000Z",
    });
    assert.equal(receipt.status, "complete");
    assert.equal(receipt.effects.sourceSubtreeMovedToQuarantine, true);
    assert.equal(receipt.effects.recoveryPackagePreserved, true);
    assert.equal(receipt.effects.sourceRefMutation, false);
    assert.equal(receipt.effects.cloudMutation, false);
    assert.notEqual(
      receipt.authorityLineage.targetInstall.attemptDigest,
      receipt.authorityLineage.sourceQuarantine.attemptDigest,
    );
    assert.equal(receipt.authorityLineage.targetInstall.phase, "target-install");
    assert.equal(receipt.authorityLineage.sourceQuarantine.phase, "source-quarantine");
    assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/u);
  } finally { fixture.cleanup(); }
});

test("receipt authority lineage binds exact effect phases, stable subject, and current quarantine plan", () => {
  const fixture = createFixture();
  const attempt = (plan, phase) => createCanonicalUntrackedRelocationAuthorityAttempt({
    plan, phase, taskAuthorityReceiptDigest: D("7"), mutationAuthorityReceiptDigest: D("8"),
    authorizedAt: "2026-08-30T00:00:00.000Z",
  });
  try {
    const refreshed = fixture.makePlan({ leaseDigest: D("7"), cloudClaimDigest: D("8") });
    const target = attempt(fixture.plan, "target-install");
    const quarantine = attempt(refreshed, "source-quarantine");
    const input = { plan: refreshed, taskAuthorityReceiptDigest: D("7"),
      mutationAuthorityReceiptDigest: D("8"), targetInstallAttempt: target,
      sourceQuarantineAttempt: quarantine, targetInstalledDigest: contentDigest(fixture.entries),
      sourceQuarantineDigest: contentDigest(fixture.entries),
      completedAt: "2026-08-30T00:00:00.000Z" };
    assert.doesNotThrow(() => createCanonicalUntrackedRelocationReceipt(input));
    assert.throws(() => createCanonicalUntrackedRelocationReceipt({ ...input,
      targetInstallAttempt: attempt(fixture.makePlan({ targetOverrides: { scope: "other" } }),
        "target-install") }), /authority lineage/u);
    assert.throws(() => createCanonicalUntrackedRelocationReceipt({ ...input,
      sourceQuarantineAttempt: attempt(fixture.plan, "source-quarantine") }), /authority lineage/u);
    assert.throws(() => createCanonicalUntrackedRelocationReceipt({ ...input,
      sourceQuarantineAttempt: attempt(refreshed, "target-install") }), /authority lineage/u);
  } finally { fixture.cleanup(); }
});

function createFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "canonical-untracked-relocation-")));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  const recovery = path.join(root, "recovery");
  const commonDirectory = path.join(root, "common");
  const subtree = "specs/commerce";
  const sourceRoot = path.join(source, subtree);
  const targetRoot = path.join(target, subtree);
  const recoveryFiles = path.join(recovery, "files", subtree);
  mkdirSync(commonDirectory, { recursive: true });
  mkdirSync(path.join(source, "specs"), { recursive: true });
  mkdirSync(path.join(target, "specs"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "nested"), { recursive: true });
  mkdirSync(path.join(recoveryFiles, "nested"), { recursive: true });
  writeFileSync(path.join(sourceRoot, "a.md"), "alpha\n", { mode: 0o644 });
  writeFileSync(path.join(sourceRoot, "nested/b.md"), "beta\n", { mode: 0o644 });
  writeFileSync(path.join(recoveryFiles, "a.md"), "alpha\n", { mode: 0o644 });
  writeFileSync(path.join(recoveryFiles, "nested/b.md"), "beta\n", { mode: 0o644 });
  const entries = Object.freeze([
    Object.freeze({ path: `${subtree}/a.md`, mode: 0o644, digest: sha("alpha\n") }),
    Object.freeze({ path: `${subtree}/nested/b.md`, mode: 0o644, digest: sha("beta\n") }),
  ]);
  const sourceEvidence = Object.freeze({
      worktree: source,
      commonDirectory,
      headSha: S("a"), treeSha: S("b"), branch: "main", subtree,
      stateDigest: D("1"), writeSetDigest: D("2"),
    });
  const makePlan = ({
    targetWorktree = target,
    leaseDigest = D("4"),
    cloudClaimDigest = D("b"),
    packageDigest = D("3"),
    receiptPath = undefined,
    targetOverrides = {},
  } = {}) => {
    const recoveryEvidence = Object.freeze({
      directory: recovery, packageDigest,
      captureProfile: "canonical-untracked-retention",
      paths: entries.map(entry => entry.path),
    });
    const targetEvidence = Object.freeze({
      worktree: targetWorktree,
      branch: "agent/device/commerce-spec",
      headSha: S("c"), treeSha: S("b"), leaseDigest, leaseEpoch: 1,
      baseSha: S("a"), fenceSha: S("c"), device: "device", scope: "commerce-spec",
      sessionId: "session-1", manifestDigest: D("5"), writeSetDigest: D("6"),
      cloudClaimId: D("a"), cloudClaimDigest,
      taskAuthoritySubjectId: "urn:agentic-task:commerce-spec",
      taskAuthorityGeneration: 1, taskAuthorityBindingDigest: D("c"),
      ...targetOverrides,
    });
    const layout = deriveCanonicalUntrackedRelocationLayout({
      source: sourceEvidence,
      recovery: recoveryEvidence,
      target: targetEvidence,
      receiptPath,
    });
    return createCanonicalUntrackedRelocationPlan({
      source: sourceEvidence,
      recovery: recoveryEvidence,
      target: targetEvidence,
      transaction: {
        stagePath: layout.stagePath,
        quarantinePath: layout.quarantinePath,
        receiptPath: layout.receiptPath,
        sameFilesystem: true,
      },
    });
  };
  const plan = makePlan();
  const quarantine = plan.evidence.transaction.quarantinePath;
  return {
    root, source, target, recovery, subtree, sourceRoot, targetRoot, recoveryFiles,
    entries, plan, quarantine, makePlan,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contentDigest(entries) {
  return digestValue(entries.map(({ path: relativePath, mode, digest }) => ({
    path: relativePath, mode, digest,
  })));
}
