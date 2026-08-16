import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  readdirSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createRecoveryArtifactRetirementController } from "../scripts/recovery-artifact-retirement-controller.mjs";
import { createRecoveryArtifactRetirementRepositoryAdapter } from "../scripts/recovery-artifact-retirement-repository-adapter.mjs";
import {
  advanceRecoverableLaneCleanupIntent, authorizeRecoverableLaneCleanup,
  buildRecoverableLaneCleanupPlan, buildRecoverableLaneCleanupReceipt,
  createRecoverableLaneCleanupIntent, RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
} from "../scripts/recoverable-lane-cleanup-contract.mjs";
import { GENERATED_RESIDUE_SCHEMA } from "../scripts/recoverable-lane-cleanup-generated-residue.mjs";

test("real adapter archives atomically and replays a lost post-rename response", t => {
  const fixture = recoveryFixture(t, { unicode: true });
  let loseResponse = true;
  const adapter = createRecoveryArtifactRetirementRepositoryAdapter({
    repository: fixture.subject, subjectRepository: fixture.subject,
    source: fixture.source, archiveRoot: fixture.archive,
    checkpoint(phase) { if (phase === "after-rename" && loseResponse) {
      loseResponse = false; throw new Error("simulated lost rename response");
    } },
  });
  const controller = createRecoveryArtifactRetirementController({ adapter });
  const input = { sessionId: "retirement-test", operatorDecisionDigest: "d".repeat(64),
    acknowledgedDriftDigest: null };
  const planned = controller.plan(input);
  const run = { ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization };
  assert.throws(() => controller.run(run), /lost rename response/u);
  assert.equal(existsSync(fixture.source), false);
  assert.equal(existsSync(planned.plan.archivePath), true);
  const completed = controller.run(run);
  assert.equal(completed.status, "complete");
  assert.equal(completed.receipt.archive.manifestDigest, planned.plan.evidence.manifest.manifestDigest);
  assert.equal(controller.observe({ planDigest: planned.planDigest }).status, "complete");
  rmdirSync(path.dirname(fixture.source));
  const replayAdapter = createRecoveryArtifactRetirementRepositoryAdapter({
    repository: fixture.subject, subjectRepository: fixture.subject,
    source: fixture.source, archiveRoot: fixture.archive,
  });
  assert.equal(createRecoveryArtifactRetirementController({ adapter: replayAdapter })
    .observe({ planDigest: planned.planDigest }).status, "complete");
});

test("real capture rejects symlinks and hardlinks without moving the source", async t => {
  const fixture = recoveryFixture(t);
  const options = { repository: fixture.subject, subjectRepository: fixture.subject,
    source: fixture.source, archiveRoot: fixture.archive };
  const symbolic = path.join(fixture.source, "symbolic");
  symlinkSync("lane.bundle", symbolic);
  assert.throws(() => createRecoveryArtifactRetirementRepositoryAdapter(options).captureEvidence(), /Unsupported recovery artifact entry/u);
  unlinkSync(symbolic);
  const hardlink = path.join(fixture.source, "hardlink");
  linkSync(path.join(fixture.source, "lane.bundle"), hardlink);
  assert.throws(() => createRecoveryArtifactRetirementRepositoryAdapter(options).captureEvidence(), /hardlinked file/u);
  assert.equal(existsSync(fixture.source), true);
  assert.equal(statSync(fixture.archive).isDirectory(), true);
});

test("reservation-released recovery requires the adapter-derived drift acknowledgement", t => {
  const fixture = recoveryFixture(t);
  const intentPath = path.join(fixture.source, "cleanup-intent.json");
  const complete = JSON.parse(readFileSync(intentPath, "utf8"));
  const phases = Object.fromEntries(Object.entries(complete.phases).filter(([phase]) => phase !== "complete"));
  const core = { schema: complete.schema, status: "reservation_released", plan: complete.plan,
    planDigest: complete.planDigest, subjectKey: complete.subjectKey,
    authorizationDigest: complete.authorizationDigest, phases };
  writeFileSync(intentPath, `${JSON.stringify({ ...core, intentDigest: digestValue(core) })}\n`);
  unlinkSync(path.join(fixture.source, "cleanup-receipt.json"));
  const adapter = createRecoveryArtifactRetirementRepositoryAdapter({ repository: fixture.subject,
    subjectRepository: fixture.subject, source: fixture.source, archiveRoot: fixture.archive });
  const controller = createRecoveryArtifactRetirementController({ adapter });
  const input = { sessionId: "retirement-test", operatorDecisionDigest: "d".repeat(64) };
  assert.throws(() => controller.plan(input), /requires --acknowledge-drift/u);
  const drift = adapter.captureEvidence().cleanup.requiredDriftAcknowledgement;
  assert.equal(controller.plan({ ...input, acknowledgedDriftDigest: drift }).plan.acknowledgedDriftDigest, drift);
  assert.equal(existsSync(fixture.source), true);
});

test("dead-owner subject lock is recovered through an atomic stale-lock rename", t => {
  const fixture = recoveryFixture(t);
  const adapter = createRecoveryArtifactRetirementRepositoryAdapter({ repository: fixture.subject,
    subjectRepository: fixture.subject, source: fixture.source, archiveRoot: fixture.archive });
  adapter.withSubjectFence({}, () => {});
  const journalRoot = path.join(fixture.subject, ".git", "agentic-canvas-os", "recovery-artifact-retirement");
  const subjectDirectory = path.join(journalRoot, readdirSync(journalRoot)[0]);
  writeFileSync(path.join(subjectDirectory, "subject.lock"), `${JSON.stringify({
    pid: 2_147_483_647, subjectKey: path.basename(subjectDirectory), token: "dead-owner",
  })}\n`, { mode: 0o600 });
  let entered = false;
  adapter.withSubjectFence({}, () => { entered = true; });
  assert.equal(entered, true);
  assert.equal(readdirSync(subjectDirectory).some(name => name.startsWith("subject.lock.stale-dead-owner-")), true);
});

test("bundle drift after planning fails before intent or rename", t => {
  const fixture = recoveryFixture(t);
  const adapter = createRecoveryArtifactRetirementRepositoryAdapter({ repository: fixture.subject,
    subjectRepository: fixture.subject, source: fixture.source, archiveRoot: fixture.archive });
  const controller = createRecoveryArtifactRetirementController({ adapter });
  const input = { sessionId: "retirement-test", operatorDecisionDigest: "d".repeat(64),
    acknowledgedDriftDigest: null };
  const planned = controller.plan(input);
  appendFileSync(path.join(fixture.source, "lane.bundle"), "drift");
  assert.throws(() => controller.run({ ...input, planDigest: planned.planDigest,
    authorization: planned.exactAuthorization }), /bundle bytes differ|drifted/u);
  assert.equal(existsSync(fixture.source), true);
  assert.equal(existsSync(planned.plan.archivePath), false);
});

function recoveryFixture(t, { unicode = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "acos-retirement-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const subject = path.join(root, "subject");
  const source = path.join(root, "recovery", "subject");
  const archive = path.join(root, "archive");
  mkdirSync(path.dirname(source)); mkdirSync(source); mkdirSync(archive);
  git(root, ["init", "--bare", remote]); git(root, ["init", "-b", "main", subject]);
  git(subject, ["config", "user.name", "Retirement Test"]);
  git(subject, ["config", "user.email", "retirement@example.invalid"]);
  writeFileSync(path.join(subject, "owned.txt"), "integrated\n");
  git(subject, ["add", "owned.txt"]); git(subject, ["commit", "-m", "integrated"]);
  git(subject, ["remote", "add", "origin", remote]); git(subject, ["push", "-u", "origin", "main"]);
  const head = git(subject, ["rev-parse", "HEAD"]).trim();
  const tree = git(subject, ["rev-parse", "HEAD^{tree}"]).trim();
  const branch = "refs/heads/agent/retired-test";
  git(subject, ["branch", "agent/retired-test", head]);
  git(subject, ["bundle", "create", path.join(source, "lane.bundle"), branch]);
  const bundleBytes = readFileSync(path.join(source, "lane.bundle"));
  const bundle = { path: path.join(source, "lane.bundle"), sha256: hash(bundleBytes),
    sizeBytes: bundleBytes.length, headSha: head, treeSha: tree, headRef: branch, complete: true };
  const commonDir = realpathSync(path.join(subject, ".git"));
  const remoteAuthorityCore = { provider: "github", ledgerRepository: "test/local",
    targetRepository: "test/local", targetClaims: [], currentRemoteWriter: false, waitingSuccessors: 0 };
  const remoteAuthority = { ...remoteAuthorityCore,
    verificationReceiptDigest: digestValue(remoteAuthorityCore) };
  const authorityCore = { lifecycleState: "review-required", leaseStatus: null,
    currentLocalWriter: false, disposition: "unowned-terminal", priorLease: null,
    priorLeaseDigest: null, preservationReceiptDigests: [], remoteAuthority };
  const evidenceCore = {
    schema: RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
    repository: { root: subject, gitCommonDir: commonDir,
      identityDigest: digestValue({ commonDir, originUrl: remote }) },
    canonical: { worktreePath: subject, headSha: head, treeSha: tree,
      originMainSha: head, remoteMainSha: head, clean: true },
    target: { worktreePath: path.join(root, "retired-worktree"), branch, headSha: head,
      branchHeadSha: head, treeSha: tree, worktreeGenerationDigest: "1".repeat(64),
      gitDir: path.join(commonDir, "worktrees", "retired-test"),
      gitDirIdentityDigest: "2".repeat(64), gitDirGenerationDigest: "3".repeat(64),
      clean: true, generatedResidue: generatedResidue(),
      unmergedEntries: 0, operationMarkers: [], stateDigest: "4".repeat(64) },
    authority: { ...authorityCore, authorityDigest: digestValue(authorityCore) },
    remoteBranch: { ref: branch, sha: null },
  };
  const evidence = { ...evidenceCore, evidenceDigest: digestValue(evidenceCore) };
  const plan = buildRecoverableLaneCleanupPlan({ evidence, recoveryDirectory: source,
    sessionId: "cleanup-test", operatorDecisionDigest: "5".repeat(64) });
  const authorization = authorizeRecoverableLaneCleanup({ plan, authorization: plan.exactAuthorization });
  let intent = createRecoverableLaneCleanupIntent({ plan, authorization });
  intent = advanceRecoverableLaneCleanupIntent(intent, { status: "bundle_verified", evidence: {
    bundle, reservation: { schema: "agentic-recoverable-lane-cleanup-reservation/v1",
      branch: "agent/retired-test", epoch: 1, sessionId: "cleanup-test", reservationDigest: "6".repeat(64) },
    quarantineStateDigest: "7".repeat(64),
  } });
  const snapshots = { targetRegistered: false, targetExists: false, stagingExists: false,
    snapshotExists: true, snapshotDigest: "8".repeat(64), snapshotGenerationDigest: "9".repeat(64),
    gitDirSnapshotExists: true, gitDirSnapshotDigest: "a".repeat(64),
    gitDirSnapshotGenerationDigest: "b".repeat(64) };
  intent = advanceRecoverableLaneCleanupIntent(intent, { status: "worktree_quarantined", evidence: {
    ...snapshots, stagingRegistered: true, disposableGitDirExists: true,
    disposableGitDirDigest: "c".repeat(64), disposableGitDirGenerationDigest: "d".repeat(64),
    removalStateDigest: "e".repeat(64),
  } });
  intent = advanceRecoverableLaneCleanupIntent(intent, { status: "worktree_removed", evidence: {
    ...snapshots, stagingRegistered: false, disposableGitDirExists: false, replayedAbsentRegistration: false,
  } });
  const releaseCore = { schema: "agentic-recoverable-lane-cleanup-reservation-release/v1",
    planDigest: plan.planDigest, priorLeaseDigest: null };
  intent = advanceRecoverableLaneCleanupIntent(intent, { status: "reservation_released", evidence: {
    release: { ...releaseCore, receiptDigest: digestValue(releaseCore) },
  } });
  const finalObservation = { ...snapshots, stagingRegistered: false, disposableGitDirExists: false,
    priorLeaseRestored: true, canonicalHeadSha: head, branchHeadSha: head, remoteBranchSha: null };
  const receipt = buildRecoverableLaneCleanupReceipt({ intent, bundle, finalObservation });
  intent = advanceRecoverableLaneCleanupIntent(intent, { status: "complete",
    evidence: { receiptDigest: receipt.receiptDigest } });
  writeFileSync(path.join(source, "cleanup-intent.json"), `${JSON.stringify(intent)}\n`);
  writeFileSync(path.join(source, "cleanup-receipt.json"), `${JSON.stringify(receipt)}\n`);
  if (unicode) writeFileSync(path.join(source, "évidence.txt"), "unicode\n");
  return { root, remote, subject, source, archive };
}
function git(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function generatedResidue() {
  const core = {
    schema: GENERATED_RESIDUE_SCHEMA,
    mode: "none",
    roots: [],
    ignoredPathCount: 0,
    ignoredPathsDigest: digestValue([]),
    entryCount: 0,
    totalBytes: 0,
    inventoryDigest: digestValue([]),
    checkoutEntryCount: 2,
    checkoutInventoryDigest: "6".repeat(64),
  };
  return { ...core, profileDigest: digestValue(core) };
}
