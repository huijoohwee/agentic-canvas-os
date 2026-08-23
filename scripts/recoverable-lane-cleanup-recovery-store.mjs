// Responsibility: preserve and remove one linked worktree under a replay-safe local reservation.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { buildRecoverableLaneCleanupDriftAbort as abortProjection, buildRecoverableLaneCleanupReservationMarker as reservationMarker,
  buildRecoverableLaneCleanupReservationRelease as releaseProjection,
  projectRecoverableLaneCleanupReservation as reservationProjection } from "./recoverable-lane-cleanup-contract.mjs";
import { assertRecoverableLaneGeneratedResidueSnapshot, inspectRecoverableLaneCleanupTree as inspectTree,
  recoverableLaneDirectoryGenerationDigest as directoryGenerationDigest,
  recoverableLanePathExists as directoryEntryExists,
  syncRecoverableLaneDirectory as syncDirectory, syncRecoverableLaneFile as syncFile } from "./recoverable-lane-cleanup-generated-residue.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
const REGISTRY_SCHEMA = "agentic-writer-lease-registry/v2", LEASE_SCHEMA = "agentic-writer-lease/v2";
const OPERATION_MARKERS = Object.freeze(["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "sequencer", "index.lock"]);
export function createRecoverableLaneCleanupRecoveryStore({
  root, target, recovery, commonDir, leaseStore, git = runGit,
  now = () => new Date(), checkpoint = () => {},
  normalizeIntent, normalizeReceipt,
} = {}) {
  const intentPath = path.join(recovery, "cleanup-intent.json");
  const receiptPath = path.join(recovery, "cleanup-receipt.json");
  const registryLockPath = path.join(path.dirname(leaseStore.statePath), "writer-leases.lock");
  const subjectRoot = path.join(commonDir, "agentic-canvas-os", "recoverable-lane-cleanup");
  return Object.freeze({
    assertInitialLocation: records => assertInitialLocation({ recovery, target, commonDir, records }),
    inspectState: plan => inspectState({ root, plan, git }),
    withSubjectFence: (plan, action) => withSubjectFence({
      subjectRoot, subjectKey: plan.subjectKey, action,
    }),
    readIntent: () => readRecoveryJson(recovery, intentPath),
    writeIntent: (expected, next) => writeRecoveryJson({
      recovery, filePath: intentPath, expected, next, normalize: normalizeIntent,
    }),
    readReceipt: () => readRecoveryJson(recovery, receiptPath),
    writeReceipt: next => writeRecoveryJson({
      recovery, filePath: receiptPath, expected: null, next, normalize: normalizeReceipt,
      allowExistingEqual: true,
    }),
    inspectReservation: (plan, authorizationDigest) => {
      const lease = leaseStore.readRegistry().leases?.[branchName(plan)] ?? null;
      return isExactReservation(lease, plan, authorizationDigest)
        ? reservationProjection(lease) : null;
    },
    beginReservation: (plan, authorizationDigest) => withWriterRegistry({
      leaseStore, registryLockPath, plan,
      action: registry => beginReservation({ registry, plan, authorizationDigest, now }),
    }),
    quarantine: (plan, reservation) => withReservation({
      leaseStore, registryLockPath, plan, reservation, now,
      action: () => quarantine({ root, plan, git, checkpoint }),
    }),
    remove: (plan, reservation, quarantined) => withReservation({
      leaseStore, registryLockPath, plan, reservation, now,
      action: () => remove({ root, plan, git, checkpoint, quarantined }),
    }),
    releaseReservation: (plan, reservation, finalObservation) => withWriterRegistry({
      leaseStore, registryLockPath, plan,
      action: registry => releaseReservation({ registry, plan, reservation, finalObservation }),
    }),
    abortReservation: (plan, reservation, restoredStateDigest, verifyRestored) =>
      withWriterRegistry({ leaseStore, registryLockPath, plan,
        action: registry => abortReservation({ registry, plan, reservation,
          restoredStateDigest, verifyRestored, checkpoint }) }),
    observeAbortRelease: (plan, reservation, restoredStateDigest) => {
      const lease = leaseStore.readRegistry().leases?.[branchName(plan)] ?? null;
      if (digestNullable(lease) !== plan.evidence.authority.priorLeaseDigest) {
        throw new Error("Cleanup drift-abort reservation is not exactly released.");
      }
      return abortProjection(plan, reservation, restoredStateDigest);
    },
  });
}
function beginReservation({ registry, plan, authorizationDigest, now }) {
  const branch = branchName(plan);
  const current = registry.leases?.[branch] ?? null;
  const expectedDigest = plan.evidence.authority.priorLeaseDigest;
  if (isExactReservation(current, plan, authorizationDigest)) {
    return { registry, result: reservationProjection(current), changed: false };
  }
  if (digestNullable(current) !== expectedDigest) {
    throw new Error("Cleanup target writer lease changed before reservation.");
  }
  for (const [candidateBranch, candidate] of Object.entries(registry.leases || {})) {
    if (candidateBranch === branch || candidate?.status !== "active") continue;
    if (path.resolve(candidate.worktreePath || "") === plan.evidence.target.worktreePath
      && Date.parse(candidate.expiresAt) > now().getTime()) {
      throw new Error("Cleanup target worktree gained a competing writer lease.");
    }
  }
  const instant = now();
  const marker = reservationMarker(plan, authorizationDigest, expectedDigest);
  const priorEpoch = Math.max(0, ...Object.values(registry.leases || {})
    .map(lease => Number(lease?.epoch || 0)));
  const identity = branch.split("/");
  const lease = {
    schema: LEASE_SCHEMA,
    status: "active",
    epoch: priorEpoch + 1,
    sessionId: `cleanup:${plan.sessionId}:${plan.subjectKey.slice(0, 12)}`,
    device: identity[1] || "cleanup",
    scope: identity.slice(2).join("/") || "recoverable-lane-cleanup",
    branch,
    worktreePath: plan.evidence.target.worktreePath,
    baseSha: plan.evidence.canonical.headSha,
    fenceSha: plan.evidence.target.headSha,
    pullRequestUrl: current?.pullRequestUrl ?? null,
    autoDelivery: false,
    runtimeRequired: false,
    cleanupReservation: marker,
    acquiredAt: instant.toISOString(),
    heartbeatAt: instant.toISOString(),
    expiresAt: new Date(instant.getTime() + 10 * 60_000).toISOString(),
  };
  const next = writeRegistry(leaseStorePath(registry), registryWithLease(registry, branch, lease));
  return { registry: next, result: reservationProjection(lease), changed: true };
}
function withReservation({ leaseStore, registryLockPath, plan, reservation, now, action }) {
  return withWriterRegistry({
    leaseStore, registryLockPath, plan,
    action: registry => {
      const branch = branchName(plan);
      const lease = registry.leases?.[branch] ?? null;
      assertReservation(lease, plan, reservation);
      if (Date.parse(lease.expiresAt) <= now().getTime()) {
        throw new Error("Cleanup writer reservation expired before an effect.");
      }
      const renewed = {
        ...lease,
        heartbeatAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + 10 * 60_000).toISOString(),
      };
      const next = writeRegistry(
        leaseStore.statePath,
        registryWithLease(registry, branch, renewed),
      );
      const value = action();
      return { registry: next, result: value, changed: true };
    },
  });
}
function releaseReservation({ registry, plan, reservation, finalObservation }) {
  if (!finalObservation?.snapshotExists || !finalObservation?.gitDirSnapshotExists
    || finalObservation.targetExists || finalObservation.targetRegistered
    || finalObservation.stagingExists || finalObservation.stagingRegistered
    || finalObservation.disposableGitDirExists) {
    throw new Error("Cleanup reservation cannot release before exact final recovery proof.");
  }
  const branch = branchName(plan);
  const lease = registry.leases?.[branch] ?? null;
  if (!lease && plan.evidence.authority.priorLease === null) {
    return { registry, result: releaseProjection(plan), changed: false };
  }
  assertReservation(lease, plan, reservation);
  const leases = { ...(registry.leases || {}) };
  if (plan.evidence.authority.priorLease === null) delete leases[branch];
  else leases[branch] = plan.evidence.authority.priorLease;
  const next = writeRegistry(leaseStorePath(registry), {
    ...registry, revision: Number(registry.revision || 0) + 1, leases,
  });
  return { registry: next, result: releaseProjection(plan), changed: true };
}
function abortReservation({ registry, plan, reservation, restoredStateDigest, verifyRestored, checkpoint }) {
  if (verifyRestored() !== restoredStateDigest) throw new Error(
    "Cleanup restored target drifted before abort reservation CAS.");
  const branch = branchName(plan), lease = registry.leases?.[branch] ?? null;
  const receipt = abortProjection(plan, reservation, restoredStateDigest);
  if (digestNullable(lease) === plan.evidence.authority.priorLeaseDigest)
    return { registry, result: receipt, changed: false };
  assertReservation(lease, plan, reservation);
  const leases = { ...(registry.leases || {}) };
  if (plan.evidence.authority.priorLease === null) delete leases[branch]; else leases[branch] = plan.evidence.authority.priorLease;
  const next = writeRegistry(leaseStorePath(registry), { ...registry,
    revision: Number(registry.revision || 0) + 1, leases });
  checkpoint("after-drift-abort-release");
  return { registry: next, result: receipt, changed: true };
}
function withWriterRegistry({ leaseStore, registryLockPath, plan, action }) {
  recoverDeadWriterLock(registryLockPath, plan);
  let result;
  leaseStore.withRegistryLock(registry => {
    const normalized = normalizeRegistry(registry);
    const outcome = action(Object.assign(normalized, { __statePath: leaseStore.statePath }));
    result = outcome.result;
  });
  return result;
}
function quarantine({ root, plan, git, checkpoint }) {
  const { target: targetPath, recovery: recoveryPaths } = paths(plan);
  const { quarantine: staging, snapshot, gitSnapshot, disposableStaging } = recoveryPaths;
  let state = inspectState({ root, plan, git });
  if (state.targetExists) {
    assertInitialGeneration(plan);
    assertRecoverableLaneGeneratedResidueSnapshot({ root: targetPath,
      expected: plan.evidence.target.generatedResidue });
    git(root, ["worktree", "move", "--", targetPath, staging]);
    syncDirectory(path.dirname(targetPath));
    syncDirectory(path.dirname(staging));
    checkpoint("after-worktree-move");
    state = inspectState({ root, plan, git });
  }
  if (state.stagingExists && !state.snapshotExists) {
    renameSync(staging, snapshot);
    syncDirectory(path.dirname(snapshot));
    checkpoint("after-checkout-snapshot");
    state = inspectState({ root, plan, git });
  }
  assertResidueOrRestore({ root, plan, git, snapshot });
  const originalGitDir = plan.evidence.target.gitDir;
  if (directoryEntryExists(originalGitDir) && !state.gitDirSnapshotExists) {
    if (directoryGenerationDigest(originalGitDir)
      !== plan.evidence.target.gitDirGenerationDigest) {
      throw new Error("Cleanup linked Git-directory generation drifted before preservation.");
    }
    renameSync(originalGitDir, gitSnapshot);
    syncDirectory(path.dirname(originalGitDir));
    syncDirectory(path.dirname(gitSnapshot));
    checkpoint("after-gitdir-snapshot");
  }
  if (!directoryEntryExists(snapshot) || !directoryEntryExists(gitSnapshot)) {
    throw new Error("Cleanup quarantine cannot reconcile checkout and Git-directory snapshots.");
  }
  rewriteGitFile(path.join(snapshot, ".git"), gitSnapshot);
  rewritePlainFile(path.join(gitSnapshot, "gitdir"), path.join(snapshot, ".git"));
  rewritePlainFile(path.join(gitSnapshot, "commondir"), plan.evidence.repository.gitCommonDir);
  assertFrozenLane(plan);
  const checkout = inspectTree(snapshot, { durable: true });
  const linkedGit = inspectTree(gitSnapshot, { durable: true });
  checkpoint("after-snapshot-seal");
  assertResidueOrRestore({ root, plan, git, snapshot });
  if (!directoryEntryExists(originalGitDir)) {
    if (directoryEntryExists(disposableStaging)) {
      assertDisposableCopy(plan, disposableStaging, linkedGit);
    } else {
      cpSync(gitSnapshot, disposableStaging, {
        recursive: true, force: false, errorOnExist: true,
        preserveTimestamps: true, verbatimSymlinks: true,
      });
      rewritePlainFile(
        path.join(disposableStaging, "gitdir"),
        path.join(staging, ".git"),
      );
      inspectTree(disposableStaging, { durable: true });
      assertDisposableCopy(plan, disposableStaging, linkedGit);
      checkpoint("after-disposable-copy");
    }
    renameSync(disposableStaging, originalGitDir);
    syncDirectory(path.dirname(originalGitDir));
    checkpoint("after-disposable-publish");
  }
  assertStagingRegistration({ root, plan, git });
  state = inspectState({ root, plan, git });
  return Object.freeze({
    targetRegistered: state.targetRegistered,
    targetExists: state.targetExists,
    stagingRegistered: state.stagingRegistered,
    stagingExists: state.stagingExists,
    snapshotExists: checkout.exists,
    snapshotDigest: checkout.digest,
    snapshotGenerationDigest: checkout.generationDigest,
    gitDirSnapshotExists: linkedGit.exists,
    gitDirSnapshotDigest: linkedGit.digest,
    gitDirSnapshotGenerationDigest: linkedGit.generationDigest,
    disposableGitDirExists: state.disposableGitDirExists,
    disposableGitDirDigest: state.disposableGitDirDigest,
    disposableGitDirGenerationDigest: state.disposableGitDirGenerationDigest,
  });
}
function assertResidueOrRestore({ root, plan, git, snapshot }) {
  try {
    assertRecoverableLaneGeneratedResidueSnapshot({
      root: snapshot, expected: plan.evidence.target.generatedResidue,
    });
  } catch (error) {
    restorePreDisposableQuarantine({ root, plan, git });
    throw error;
  }
}
function restorePreDisposableQuarantine({ root, plan, git }) {
  const { target, recovery } = paths(plan);
  const { quarantine: staging, snapshot, gitSnapshot } = recovery;
  const originalGitDir = plan.evidence.target.gitDir;
  if (!directoryEntryExists(originalGitDir) && directoryEntryExists(gitSnapshot)) {
    rewriteGitFile(path.join(snapshot, ".git"), originalGitDir);
    rewritePlainFile(path.join(gitSnapshot, "gitdir"), path.join(staging, ".git"));
    renameSync(gitSnapshot, originalGitDir);
    syncDirectory(path.dirname(originalGitDir));
  }
  if (directoryEntryExists(snapshot) && !directoryEntryExists(staging)) {
    renameSync(snapshot, staging);
    syncDirectory(path.dirname(staging));
  }
  if (!directoryEntryExists(target) && directoryEntryExists(staging)) {
    git(root, ["worktree", "move", "--", staging, target]);
    syncDirectory(path.dirname(target));
  }
}
function remove({ root, plan, git, checkpoint, quarantined }) {
  const state = inspectState({ root, plan, git });
  assertSnapshotState(state, quarantined);
  if (!state.stagingRegistered) {
    if (state.targetExists || state.targetRegistered || state.stagingExists
      || state.disposableGitDirExists) throw new Error("Cleanup removal replay is ambiguous.");
    assertFrozenLane(plan);
    return Object.freeze({ ...snapshotProjection(state), replayedAbsentRegistration: true });
  }
  assertStagingRegistration({ root, plan, git });
  checkpoint("before-worktree-remove");
  assertRecoverableLaneGeneratedResidueSnapshot({ root: plan.recovery.snapshotPath, expected: plan.evidence.target.generatedResidue });
  assertSnapshotState(inspectState({ root, plan, git }), quarantined);
  assertFrozenLane(plan);
  git(root, ["worktree", "remove", "--", plan.recovery.quarantinePath]);
  checkpoint("after-worktree-remove");
  const final = inspectState({ root, plan, git });
  if (final.targetExists || final.targetRegistered || final.stagingExists
    || final.stagingRegistered || final.disposableGitDirExists) {
    throw new Error("Non-force worktree removal did not clear only disposable registration state.");
  }
  assertSnapshotState(final, quarantined);
  assertFrozenLane(plan);
  return Object.freeze({
    ...snapshotProjection(final),
    replayedAbsentRegistration: false,
  });
}
function inspectState({ root, plan, git }) {
  const records = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]));
  const targetRegistered = records.some(record =>
    path.resolve(record.path) === plan.evidence.target.worktreePath);
  const stagingRegistered = records.some(
    record => path.resolve(record.path) === plan.recovery.quarantinePath,
  );
  const checkout = inspectTree(plan.recovery.snapshotPath);
  const linkedGit = inspectTree(plan.recovery.gitDirSnapshotPath);
  const disposable = inspectTree(plan.evidence.target.gitDir);
  return Object.freeze({
    targetRegistered, targetExists: directoryEntryExists(plan.evidence.target.worktreePath),
    stagingRegistered, stagingExists: directoryEntryExists(plan.recovery.quarantinePath),
    snapshotExists: checkout.exists, snapshotDigest: checkout.digest,
    snapshotGenerationDigest: checkout.generationDigest,
    gitDirSnapshotExists: linkedGit.exists, gitDirSnapshotDigest: linkedGit.digest,
    gitDirSnapshotGenerationDigest: linkedGit.generationDigest,
    disposableGitDirExists: disposable.exists, disposableGitDirDigest: disposable.digest,
    disposableGitDirGenerationDigest: disposable.generationDigest,
  });
}
function assertStagingRegistration({ root, plan, git }) {
  const matches = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]))
    .filter(record => path.resolve(record.path) === plan.recovery.quarantinePath);
  if (matches.length !== 1 || (matches[0].branch ?? null) !== plan.evidence.target.branch
    || matches[0].head !== plan.evidence.target.headSha || matches[0].bare
    || Boolean(matches[0].detached) !== (plan.evidence.target.branch === null)
    || matches[0].locked) {
    throw new Error("Cleanup staging registration differs from the authorized lane generation.");
  }
  const disposable = inspectTree(plan.evidence.target.gitDir);
  const preserved = inspectTree(plan.recovery.gitDirSnapshotPath);
  if (!disposable.exists || !preserved.exists
    || disposable.generationDigest === preserved.generationDigest) {
    throw new Error("Cleanup disposable and preserved Git directories are not independent.");
  }
  if (plainFileTarget(path.join(plan.evidence.target.gitDir, "gitdir"))
    !== path.join(plan.recovery.quarantinePath, ".git")) {
    throw new Error("Cleanup disposable Git-directory backlink is invalid.");
  }
}
function assertFrozenLane(plan) {
  const worktree = plan.recovery.snapshotPath;
  const gitDir = plan.recovery.gitDirSnapshotPath;
  const run = args => execFileSync("git", args, {
    cwd: worktree,
    env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: worktree, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const markers = OPERATION_MARKERS.filter(marker => directoryEntryExists(path.join(gitDir, marker)));
  if (run(["status", "--porcelain=v2", "-z", "--untracked-files=no"])
    || run(["ls-files", "-u", "-z"]) || markers.length
    || run(["rev-parse", "--symbolic-full-name", "HEAD"]).trim()
      !== (plan.evidence.target.branch ?? "HEAD")
    || run(["rev-parse", "HEAD"]).trim() !== plan.evidence.target.headSha
    || run(["rev-parse", "HEAD^{tree}"]).trim() !== plan.evidence.target.treeSha) {
    throw new Error("Cleanup lane changed while quarantined.");
  }
}
function assertInitialGeneration(plan) {
  if (directoryGenerationDigest(plan.evidence.target.worktreePath)
    !== plan.evidence.target.worktreeGenerationDigest
    || directoryGenerationDigest(plan.evidence.target.gitDir)
      !== plan.evidence.target.gitDirGenerationDigest) {
    throw new Error("Cleanup target generation drifted before quarantine.");
  }
}
function assertSnapshotState(state, expected) {
  for (const field of [
    "snapshotDigest", "snapshotGenerationDigest", "gitDirSnapshotDigest",
    "gitDirSnapshotGenerationDigest",
  ]) if (state[field] !== expected[field]) throw new Error("Cleanup checkout or Git-directory snapshot drifted.");
}
function assertDisposableCopy(plan, candidate, source) {
  const observed = inspectTree(candidate);
  if (!observed.exists || observed.generationDigest === source.generationDigest
    || normalizedGitDirDigest(candidate) !== normalizedGitDirDigest(plan.recovery.gitDirSnapshotPath)) {
    throw new Error("Cleanup disposable Git-directory copy is not exact and independent.");
  }
}
function paths(plan) {
  return {
    target: plan.evidence.target.worktreePath,
    recovery: { quarantine: plan.recovery.quarantinePath, snapshot: plan.recovery.snapshotPath,
      gitSnapshot: plan.recovery.gitDirSnapshotPath,
      disposableStaging: plan.recovery.disposableGitDirStagingPath },
  };
}
function snapshotProjection(state) {
  return {
    targetRegistered: state.targetRegistered, targetExists: state.targetExists,
    stagingRegistered: state.stagingRegistered, stagingExists: state.stagingExists,
    snapshotExists: state.snapshotExists, snapshotDigest: state.snapshotDigest,
    snapshotGenerationDigest: state.snapshotGenerationDigest,
    gitDirSnapshotExists: state.gitDirSnapshotExists, gitDirSnapshotDigest: state.gitDirSnapshotDigest,
    gitDirSnapshotGenerationDigest: state.gitDirSnapshotGenerationDigest,
    disposableGitDirExists: state.disposableGitDirExists,
  };
}
function isExactReservation(lease, plan, authorizationDigest) {
  if (lease?.status !== "active" || lease?.branch !== branchName(plan)) return false;
  return canonicalJson(lease.cleanupReservation)
    === canonicalJson(reservationMarker(
      plan, authorizationDigest, plan.evidence.authority.priorLeaseDigest,
    ));
}
function assertReservation(lease, plan, reservation) {
  if (!isExactReservation(lease, plan, lease?.cleanupReservation?.authorizationDigest)
    || reservation?.reservationDigest !== lease.cleanupReservation.reservationDigest
    || reservation?.branch !== branchName(plan) || reservation?.epoch !== lease.epoch
    || reservation?.sessionId !== lease.sessionId) {
    throw new Error("Cleanup writer reservation changed before an effect.");
  }
}
function branchName(plan) {
  return plan.evidence.target.branch === null
    ? `agent/recoverable-cleanup/detached-${plan.subjectKey.slice(0, 16)}`
    : plan.evidence.target.branch.replace(/^refs\/heads\//u, "");
}
function registryWithLease(registry, branch, lease) {
  return { ...registry, revision: Number(registry.revision || 0) + 1,
    leases: { ...(registry.leases || {}), [branch]: lease } };
}
function normalizeRegistry(value) {
  if (value?.schema !== REGISTRY_SCHEMA || !Number.isSafeInteger(Number(value.revision || 0))
    || !value.leases || typeof value.leases !== "object" || Array.isArray(value.leases)) {
    throw new Error("Cleanup writer registry is malformed.");
  }
  return { ...value, revision: Number(value.revision || 0), leases: { ...value.leases } };
}
function writeRegistry(statePath, value) {
  const clean = { ...value };
  delete clean.__statePath; atomicWriteJson(statePath, clean);
  return clean;
}
function leaseStorePath(registry) { if (!registry.__statePath) throw new Error("Cleanup writer registry state path is unavailable."); return registry.__statePath; }
function digestNullable(value) { return value === null ? null : digestValue(value); }
function assertInitialLocation({ recovery, target, commonDir, records }) {
  const parent = path.dirname(recovery);
  if (directoryEntryExists(recovery)) throw new Error("Recovery directory must be absent before planning.");
  if (!directoryEntryExists(parent) || !lstatSync(parent).isDirectory()
    || lstatSync(parent).isSymbolicLink() || realpathSync(parent) !== parent) {
    throw new Error("Recovery directory parent must be one existing normalized real directory.");
  }
  for (const forbidden of [target, commonDir, ...records.map(record => path.resolve(record.path))]) {
    if (sameOrContains(forbidden, recovery) || sameOrContains(recovery, forbidden)) {
      throw new Error(`Recovery directory is not isolated; overlaps ${forbidden}`);
    }
  }
}
function withSubjectFence({ subjectRoot, subjectKey, action }) {
  mkdirSync(subjectRoot, { recursive: true, mode: 0o700 });
  const lockPath = path.join(subjectRoot, `${subjectKey}.lock`);
  const release = acquireRecoverableLock(lockPath, { subjectKey });
  try { return action(); }
  finally { release(); }
}
function acquireRecoverableLock(lockPath, subject) {
  const token = randomBytes(16).toString("hex");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return createOwnedLock(lockPath, subject, token); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readLock(lockPath);
      if (!owner) throw new Error("Cleanup subject lock is malformed.");
      if (processIsAlive(owner.pid)) throw new Error("Cleanup subject is already fenced.");
      const stale = `${lockPath}.stale.${createHash("sha256").update(owner.token).digest("hex")}`;
      if (directoryEntryExists(stale)) throw new Error("Cleanup stale-lock recovery is already pending.");
      renameSync(lockPath, stale);
      if (readLock(stale)?.token !== owner.token) {
        if (!directoryEntryExists(lockPath)) renameSync(stale, lockPath);
        throw new Error("Cleanup stale-lock recovery captured a different owner.");
      }
      syncDirectory(path.dirname(lockPath));
      try {
        const release = createOwnedLock(lockPath, subject, token);
        unlinkSync(stale); syncDirectory(path.dirname(lockPath)); return release;
      } catch (replacementError) {
        if (!directoryEntryExists(lockPath)) renameSync(stale, lockPath);
        throw replacementError;
      }
    }
  }
  throw new Error("Cleanup subject lock could not be acquired.");
}
function recoverDeadWriterLock(lockPath, plan) {
  if (!directoryEntryExists(lockPath)) return;
  const owner = readLock(lockPath);
  if (!owner || processIsAlive(owner.pid)) return;
  const stale = `${lockPath}.cleanup-stale.${plan.subjectKey}`;
  if (directoryEntryExists(stale)) throw new Error("Cleanup writer-lock recovery needs manual review.");
  renameSync(lockPath, stale);
  if (readLock(stale)?.token !== owner.token) {
    if (!directoryEntryExists(lockPath)) renameSync(stale, lockPath);
    throw new Error("Cleanup writer-lock recovery captured a different owner.");
  }
  unlinkSync(stale); syncDirectory(path.dirname(lockPath));
}
function createOwnedLock(lockPath, subject, token) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token, subject })}\n`);
  fsyncSync(descriptor); syncDirectory(path.dirname(lockPath));
  return () => {
    closeSync(descriptor);
    if (readLock(lockPath)?.token === token) {
      unlinkSync(lockPath); syncDirectory(path.dirname(lockPath));
    }
  };
}
function readLock(filePath) {
  if (!directoryEntryExists(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string" ? value : null;
  } catch { return null; }
}
function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
function writeRecoveryJson({
  recovery, filePath, expected, next, normalize, allowExistingEqual = false,
}) {
  if (!directoryEntryExists(recovery)) {
    const temporary = `${recovery}.prepare-${process.pid}-${randomBytes(6).toString("hex")}`;
    mkdirSync(temporary, { mode: 0o700 });
    atomicWriteJson(path.join(temporary, path.basename(filePath)), normalize(next));
    renameSync(temporary, recovery); syncDirectory(path.dirname(recovery));
    return normalize(readFileJson(filePath));
  }
  assertSafeRecoveryDirectory(recovery);
  const current = directoryEntryExists(filePath) ? normalize(readFileJson(filePath)) : null;
  if (allowExistingEqual && current && canonicalJson(current) === canonicalJson(normalize(next))) return current;
  if (canonicalJson(current) !== canonicalJson(expected)) {
    throw new Error("Cleanup recovery journal changed before its exact CAS.");
  }
  atomicWriteJson(filePath, normalize(next));
  return normalize(readFileJson(filePath));
}
function readRecoveryJson(recovery, filePath) { if (!directoryEntryExists(recovery)) return null; assertSafeRecoveryDirectory(recovery); return directoryEntryExists(filePath) ? readFileJson(filePath) : null; }
function assertSafeRecoveryDirectory(recovery) {
  const metadata = lstatSync(recovery);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(recovery) !== recovery) {
    throw new Error("Cleanup recovery path is not one normalized real directory.");
  }
}
function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  renameSync(temporary, filePath); syncDirectory(path.dirname(filePath));
}
function readFileJson(filePath) { const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Cleanup JSON path is unsafe.");
  return JSON.parse(readFileSync(filePath, "utf8")); }
function rewriteGitFile(filePath, targetPath) { rewritePlainFile(filePath, `gitdir: ${targetPath}`); }
function rewritePlainFile(filePath, value) {
  const current = readFileSync(filePath, "utf8").trim();
  if (current === value) return;
  const temporary = `${filePath}.rewrite-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporary, `${value}\n`, { mode: 0o600 }); syncFile(temporary);
  renameSync(temporary, filePath); syncDirectory(path.dirname(filePath));
}
function plainFileTarget(filePath) { const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Cleanup Git backlink is unsafe."); return path.normalize(readFileSync(filePath, "utf8").trim().replace(/^gitdir:\s*/u, "")); }
function normalizedGitDirDigest(root) { return inspectTree(root, { normalizeGitdir: true }).digest; }
function sameOrContains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function runGit(cwd, args) { return execFileSync("git", args, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
