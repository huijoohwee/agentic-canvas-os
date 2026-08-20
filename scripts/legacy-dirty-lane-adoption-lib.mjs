import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { textCommandOptions } from "./command-text-options.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const LEGACY_RECOVERY_SCHEMA = "agentic-legacy-dirty-lane-recovery/v1";
export const LEGACY_ADOPTION_SCHEMA = "agentic-legacy-dirty-lane-adoption/v1";
export const LEGACY_TASK_LANE_CAPTURE_PROFILE = "task-lane";
export const SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE = "task-lane-squash-integrated";
export const CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE = "canonical-untracked-retention";
export const MERGED_PULL_REQUEST_EVIDENCE_SCHEMA = "agentic-merged-pull-request-evidence/v1";
export const SQUASH_INTEGRATION_PROOF_SCHEMA = "agentic-squash-integration-proof/v1";

export function captureLegacyDirtyLane({
  sourceWorktree,
  recoveryDirectory,
  protectedTipSha,
  operatorSessionId,
  captureProfile = LEGACY_TASK_LANE_CAPTURE_PROFILE,
  pullRequestEvidence = null,
  now = () => new Date(),
}) {
  const source = requireWorktree(sourceWorktree);
  const recovery = path.resolve(requireText(recoveryDirectory, "Recovery directory"));
  requireNewRecoveryDirectory(recovery);
  requireSha(protectedTipSha, "Protected tip SHA");
  requireText(operatorSessionId, "Operator session id");
  requireCaptureProfile(captureProfile);
  if (captureProfile !== LEGACY_TASK_LANE_CAPTURE_PROFILE) {
    if (captureProfile === CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE) requirePrimaryCanonicalWorktree(source);
    requireRemoteMainTip(source, protectedTipSha);
  }
  requireCommit(source, protectedTipSha);
  const before = captureSourceEvidence(source);
  if (before.trackedPaths.length === 0 && before.untrackedPaths.length === 0) {
    throw new Error("Legacy capture requires a dirty source worktree.");
  }
  let squashIntegrationProof = null;
  if (captureProfile === LEGACY_TASK_LANE_CAPTURE_PROFILE) {
    requireAgentBranch(before.branch);
    git(source, ["merge-base", "--is-ancestor", before.headSha, protectedTipSha]);
  } else if (captureProfile === SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE) {
    requireAgentBranch(before.branch);
    squashIntegrationProof = requireSquashIntegratedTaskLane({
      source,
      evidence: before,
      protectedTipSha,
      pullRequestEvidence,
    });
  } else {
    requireCanonicalUntrackedRetention({ source, evidence: before, protectedTipSha });
  }

  mkdirSync(path.join(recovery, "files"), { recursive: true });
  const patchBytes = gitBuffer(source, ["diff", "--no-ext-diff", "--binary", "HEAD"]);
  const patchPath = path.join(recovery, "tracked.patch");
  writeFileSync(patchPath, patchBytes);

  const deleted = new Set(splitNull(gitBuffer(source, ["diff", "--name-only", "--diff-filter=D", "-z", "HEAD"])));
  const tracked = before.trackedPaths.map((relativePath) => deleted.has(relativePath)
    ? Object.freeze({ path: relativePath, ownership: "tracked", kind: "deleted" })
    : capturePath({ source, recovery, relativePath, ownership: "tracked" }));
  const untracked = before.untrackedPaths.map((relativePath) =>
    capturePath({ source, recovery, relativePath, ownership: "untracked" }));

  const core = Object.freeze({
    schema: LEGACY_RECOVERY_SCHEMA,
    captureProfile,
    sourceWorktree: source,
    sourceBranch: before.branch,
    sourceHeadSha: before.headSha,
    protectedTipSha,
    operatorSessionId,
    capturedAt: now().toISOString(),
    stateDigest: before.stateDigest,
    writeSetDigest: before.writeSetDigest,
    trackedPatchDigest: sha256(patchBytes),
    tracked,
    untracked,
    ...(squashIntegrationProof ? { squashIntegrationProof } : {}),
  });
  const after = captureSourceEvidence(source);
  requireSameSourceEvidence(before, after);
  const manifest = Object.freeze({ ...core, packageDigest: sha256(canonicalJson(core)) });
  writeFileSync(path.join(recovery, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(recovery, ".complete"), `${manifest.packageDigest}\n`);
  return verifyLegacyRecoveryPackage({ recoveryDirectory: recovery });
}

export function verifyLegacyRecoveryPackage({ recoveryDirectory }) {
  const recovery = path.resolve(requireText(recoveryDirectory, "Recovery directory"));
  const manifestPath = path.join(recovery, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== LEGACY_RECOVERY_SCHEMA) throw new Error("Unsupported legacy recovery schema.");
  requireCaptureProfile(manifest.captureProfile);
  requireSha(manifest.sourceHeadSha, "Recovery source HEAD");
  requireSha(manifest.protectedTipSha, "Recovery protected tip");
  requireDigest(manifest.stateDigest, "Recovery state digest");
  requireDigest(manifest.writeSetDigest, "Recovery write-set digest");
  requireDigest(manifest.trackedPatchDigest, "Recovery patch digest");
  requireDigest(manifest.packageDigest, "Recovery package digest");
  if (manifest.captureProfile === SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE) {
    verifySquashIntegrationProof(manifest);
  } else if (manifest.squashIntegrationProof !== undefined) {
    throw new Error("Unexpected squash integration proof for this capture profile.");
  }

  const patchBytes = readFileSync(path.join(recovery, "tracked.patch"));
  if (sha256(patchBytes) !== manifest.trackedPatchDigest) throw new Error("Legacy recovery patch digest changed.");
  for (const entry of [...manifest.tracked, ...manifest.untracked]) {
    verifyRecoveryEntry({ recovery, entry });
  }
  const { packageDigest, ...core } = manifest;
  if (sha256(canonicalJson(core)) !== packageDigest) throw new Error("Legacy recovery package digest changed.");
  if (readFileSync(path.join(recovery, ".complete"), "utf8").trim() !== packageDigest) {
    throw new Error("Legacy recovery package is incomplete.");
  }
  return Object.freeze({ recoveryDirectory: recovery, ...manifest });
}

export function adoptLegacyDirtyLane({
  sourceWorktree,
  recoveryDirectory,
  targetWorktree,
  operatorSessionId,
  leaseStore,
  expectedLeaseDigest,
  receiptPath,
  reconciliationPaths = [],
  now = () => new Date(),
}) {
  const recovery = verifyLegacyRecoveryPackage({ recoveryDirectory });
  if (recovery.captureProfile === CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE) {
    throw new Error("Canonical untracked retention packages are preservation-only and cannot be adopted.");
  }
  const source = requireWorktree(sourceWorktree);
  const target = requireWorktree(targetWorktree);
  if (source !== path.resolve(recovery.sourceWorktree)) throw new Error("Recovery source worktree identity changed.");
  requireText(operatorSessionId, "Operator session id");
  if (operatorSessionId !== recovery.operatorSessionId) throw new Error("Recovery operator session changed.");
  const currentSource = captureSourceEvidence(source);
  requireRecoverySource(recovery, currentSource);
  if (recovery.captureProfile === SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE) {
    requireRemoteMainTip(source, recovery.protectedTipSha);
    const liveProof = requireSquashIntegratedTaskLane({
      source,
      evidence: currentSource,
      protectedTipSha: recovery.protectedTipSha,
      pullRequestEvidence: recovery.squashIntegrationProof.pullRequest,
    });
    if (canonicalJson(liveProof) !== canonicalJson(recovery.squashIntegrationProof)) {
      throw new Error("Squash integration proof changed before adoption.");
    }
  }

  return withTargetLeaseFence({
    target, operatorSessionId, leaseStore, expectedLeaseDigest,
    protectedTipSha: recovery.protectedTipSha,
    recoveryPaths: [...recovery.tracked, ...recovery.untracked].map((entry) => entry.path),
    now,
    action: ({ lease, registryRevision, adoptedAt }) => {
      requireCleanTarget(target);
      const reconciliations = normalizeReconciliationPaths(reconciliationPaths, recovery.tracked);
      const alreadyIntegrated = [];
      const untrackedToRestore = [];
      for (const entry of recovery.untracked) {
        const targetPath = resolveInside(target, entry.path);
        if (!existsSync(targetPath)) untrackedToRestore.push(entry);
        else if (recoveryEntryMatchesPath(entry, targetPath)) alreadyIntegrated.push(entry.path);
        else throw new Error(`Adoption target path differs from the recovery package: ${entry.path}`);
      }

      const patchPath = path.join(recovery.recoveryDirectory, "tracked.patch");
      const hasTrackedPathsToAdopt = recovery.tracked.some((entry) => !reconciliations.includes(entry.path));
      const exclusions = reconciliations.map((relativePath) => `--exclude=${relativePath}`);
      if (lstatSync(patchPath).size > 0 && hasTrackedPathsToAdopt) {
        git(target, ["apply", "--check", "--3way", ...exclusions, patchPath]);
        git(target, ["apply", "--3way", "--index", ...exclusions, patchPath]);
      }
      for (const entry of untrackedToRestore) restoreEntry({ recovery: recovery.recoveryDirectory, target, entry });

      const adoptedPaths = [...recovery.tracked, ...recovery.untracked]
        .map((entry) => entry.path).filter((relativePath) => !reconciliations.includes(relativePath)).sort();
      const receipt = Object.freeze({
        schema: LEGACY_ADOPTION_SCHEMA,
        status: reconciliations.length > 0 ? "reconciliation-required" : "complete",
        adoptedAt: adoptedAt.toISOString(), operatorSessionId,
        sourceWorktree: source, sourceHeadSha: recovery.sourceHeadSha,
        targetWorktree: target, targetBranch: lease.branch,
        targetHeadSha: gitText(target, ["rev-parse", "HEAD"]).trim(),
        targetLeaseEpoch: lease.epoch, targetLeaseDigest: expectedLeaseDigest,
        targetLeaseRegistryRevision: registryRevision,
        protectedTipSha: recovery.protectedTipSha,
        recoveryPackageDigest: recovery.packageDigest,
        stateDigest: recovery.stateDigest, writeSetDigest: recovery.writeSetDigest,
        adoptedPaths, alreadyIntegratedPaths: alreadyIntegrated.sort(),
        reconciliationPaths: reconciliations,
      });
      const output = path.resolve(receiptPath || path.join(recovery.recoveryDirectory, "adoption-receipt.json"));
      writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
      return Object.freeze({ ...receipt, receiptPath: output });
    },
  });
}

export function captureSourceEvidence(worktree) {
  const conflictPaths = splitNull(gitBuffer(worktree, ["diff", "--name-only", "--diff-filter=U", "-z"]));
  if (conflictPaths.length > 0 || gitText(worktree, ["ls-files", "-u"]).trim()) {
    throw new Error("Legacy source has unresolved merge conflicts.");
  }
  const trackedPatch = gitBuffer(worktree, ["diff", "--no-ext-diff", "--binary", "HEAD"]);
  const trackedPaths = splitNull(gitBuffer(worktree, ["diff", "--name-only", "-z", "HEAD"]));
  const untrackedPaths = splitNull(gitBuffer(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const untrackedObjects = untrackedPaths.map((file) => ({
    file,
    objectId: gitText(worktree, ["hash-object", "--no-filters", "--", file]).trim(),
  }));
  const paths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  return Object.freeze({
    branch: gitText(worktree, ["branch", "--show-current"]).trim(),
    headSha: gitText(worktree, ["rev-parse", "HEAD"]).trim(),
    trackedPaths,
    untrackedPaths,
    stateDigest: sha256(canonicalJson({ trackedPatch: trackedPatch.toString("base64"), untrackedObjects })),
    writeSetDigest: sha256(canonicalJson(paths)),
  });
}

function capturePath({ source, recovery, relativePath, ownership }) {
  const sourcePath = resolveInside(source, relativePath);
  const destination = resolveInside(path.join(recovery, "files"), relativePath);
  const stat = lstatSync(sourcePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isSymbolicLink()) {
    const linkTarget = readlinkSync(sourcePath);
    symlinkSync(linkTarget, destination);
    return Object.freeze({ path: relativePath, ownership, kind: "symlink", linkTarget });
  }
  if (!stat.isFile()) throw new Error(`Unsupported legacy path type: ${relativePath}`);
  copyFileSync(sourcePath, destination);
  const mode = stat.mode & 0o777;
  chmodSync(destination, mode);
  const sourceDigest = sha256(readFileSync(sourcePath));
  const storedDigest = sha256(readFileSync(destination));
  if (sourceDigest !== storedDigest) throw new Error(`Legacy source changed while copying: ${relativePath}`);
  return Object.freeze({ path: relativePath, ownership, kind: "file", mode, digest: storedDigest });
}

function verifyRecoveryEntry({ recovery, entry }) {
  requireSafeRelativePath(entry.path);
  if (entry.kind === "deleted") return;
  const stored = resolveInside(path.join(recovery, "files"), entry.path);
  const stat = lstatSync(stored);
  if (entry.kind === "symlink") {
    if (!stat.isSymbolicLink() || readlinkSync(stored) !== entry.linkTarget) {
      throw new Error(`Legacy recovery symlink changed: ${entry.path}`);
    }
    return;
  }
  if (entry.kind !== "file" || !stat.isFile() || sha256(readFileSync(stored)) !== entry.digest) {
    throw new Error(`Legacy recovery file changed: ${entry.path}`);
  }
}

function restoreEntry({ recovery, target, entry }) {
  const source = resolveInside(path.join(recovery, "files"), entry.path);
  const destination = resolveInside(target, entry.path);
  mkdirSync(path.dirname(destination), { recursive: true });
  if (entry.kind === "symlink") symlinkSync(entry.linkTarget, destination);
  else {
    copyFileSync(source, destination);
    chmodSync(destination, entry.mode);
  }
}

function recoveryEntryMatchesPath(entry, targetPath) {
  const stat = lstatSync(targetPath);
  if (entry.kind === "symlink") {
    return stat.isSymbolicLink() && readlinkSync(targetPath) === entry.linkTarget;
  }
  return entry.kind === "file" && stat.isFile() && sha256(readFileSync(targetPath)) === entry.digest;
}

function normalizeReconciliationPaths(values, trackedEntries) {
  if (!Array.isArray(values)) throw new Error("Reconciliation paths must be an array.");
  const normalized = [...new Set(values.map((value) => requireText(value, "Reconciliation path")))].sort();
  if (normalized.length !== values.length) throw new Error("Reconciliation paths must be unique.");
  const tracked = new Set(trackedEntries.map((entry) => entry.path));
  for (const relativePath of normalized) {
    requireSafeRelativePath(relativePath);
    if (!tracked.has(relativePath)) throw new Error(`Reconciliation path is not a tracked legacy change: ${relativePath}`);
  }
  return normalized;
}

function requireRecoverySource(recovery, evidence) {
  if (evidence.branch !== recovery.sourceBranch || evidence.headSha !== recovery.sourceHeadSha ||
      evidence.stateDigest !== recovery.stateDigest || evidence.writeSetDigest !== recovery.writeSetDigest) {
    throw new Error("Legacy source changed after recovery capture.");
  }
}

function withTargetLeaseFence({
  target, operatorSessionId, leaseStore, expectedLeaseDigest, protectedTipSha,
  recoveryPaths, now, action,
}) {
  if (typeof leaseStore?.withRegistryLock !== "function" || !leaseStore.statePath) {
    throw new Error("Adoption requires the repository writer-lease registry lock.");
  }
  requireDigest(expectedLeaseDigest, "Expected target lease digest");
  const commonDirectory = path.resolve(target, gitText(target, ["rev-parse", "--git-common-dir"]).trim());
  const expectedStatePath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.json");
  if (path.resolve(leaseStore.statePath) !== expectedStatePath) {
    throw new Error("Adoption lease store does not belong to the target repository.");
  }
  return leaseStore.withRegistryLock((registry) => {
    const branch = gitText(target, ["branch", "--show-current"]).trim();
    const headSha = gitText(target, ["rev-parse", "HEAD"]).trim();
    const lease = registry?.leases?.[branch];
    const adoptedAt = now();
    const expiresAt = Date.parse(lease?.expiresAt);
    if (!(adoptedAt instanceof Date) || !Number.isFinite(adoptedAt.getTime())) {
      throw new Error("Adoption requires a valid lease verification instant.");
    }
    if (!lease || writerLeaseDigest(lease) !== expectedLeaseDigest || lease.status !== "active" ||
        !Number.isFinite(expiresAt) || expiresAt <= adoptedAt.getTime() || lease.sessionId !== operatorSessionId ||
        lease.branch !== branch || realpathSync(lease.worktreePath) !== target ||
        lease.fenceSha !== headSha) {
      throw new Error("Adoption requires the exact live target writer lease.");
    }
    requireDisjointTargetBaseAdvance({
      target,
      protectedTipSha,
      targetBaseSha: lease.baseSha,
      targetHeadSha: headSha,
      recoveryPaths,
    });
    const registryRevision = Number(registry.revision);
    if (!Number.isSafeInteger(registryRevision) || registryRevision < 1) {
      throw new Error("Adoption requires a revisioned target writer-lease registry.");
    }
    return action({ lease, registryRevision, adoptedAt });
  });
}
function requireDisjointTargetBaseAdvance({
  target, protectedTipSha, targetBaseSha, targetHeadSha, recoveryPaths,
}) {
  git(target, ["merge-base", "--is-ancestor", protectedTipSha, targetBaseSha]);
  git(target, ["merge-base", "--is-ancestor", targetBaseSha, targetHeadSha]);
  if (targetBaseSha === protectedTipSha) return;
  const changedPaths = splitNull(gitBuffer(target, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z",
    protectedTipSha, targetBaseSha, "--",
  ]));
  if (changedPaths.some((changedPath) => recoveryPaths.some(
    (recoveryPath) => pathsOverlap(changedPath, recoveryPath),
  ))) {
    throw new Error("Adoption target base advance overlaps the recovery package write set.");
  }
}
function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
function requireCleanTarget(target) {
  if (gitText(target, ["status", "--porcelain"]).trim()) throw new Error("Adoption target must be clean.");
}

function requireWorktree(value) {
  const requested = path.resolve(requireText(value, "Worktree path"));
  const requestedRealpath = realpathSync(requested);
  const root = realpathSync(path.resolve(gitText(requested, ["rev-parse", "--show-toplevel"]).trim()));
  if (root !== requestedRealpath) throw new Error(`Command must start at the worktree root: ${root}`);
  const registered = gitText(requested, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/).some((line) => line.startsWith("worktree ") && realpathSync(line.slice(9)) === requestedRealpath);
  if (!registered) throw new Error(`Worktree is not registered: ${requested}`);
  return requestedRealpath;
}

function requireNewRecoveryDirectory(recovery) {
  if (existsSync(recovery)) throw new Error(`Recovery directory already exists: ${recovery}`);
  const parent = path.dirname(recovery);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

function requireCommit(worktree, sha) {
  git(worktree, ["cat-file", "-e", `${sha}^{commit}`]);
}

function requireRemoteMainTip(worktree, protectedTipSha) {
  const records = gitText(worktree, ["ls-remote", "--exit-code", "origin", "refs/heads/main"])
    .trim().split(/\r?\n/).filter(Boolean);
  const [sha, ref] = records[0]?.split(/\s+/) || [];
  if (records.length !== 1 || sha !== protectedTipSha || ref !== "refs/heads/main") {
    throw new Error("Legacy capture requires remote origin/main at the exact protected tip.");
  }
}

function requireAgentBranch(branch) {
  if (!/^agent\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(branch)) {
    throw new Error("Legacy source must use the canonical agent/device/scope branch form.");
  }
}

function requireSquashIntegratedTaskLane({
  source,
  evidence,
  protectedTipSha,
  pullRequestEvidence,
}) {
  const pullRequest = requireMergedPullRequestSemantics({
    pullRequestEvidence, sourceBranch: evidence.branch, sourceHeadSha: evidence.headSha,
  });
  requireCommit(source, pullRequest.baseSha);
  requireCommit(source, pullRequest.mergeCommitSha);
  git(source, ["merge-base", "--is-ancestor", pullRequest.baseSha, pullRequest.headSha]);
  git(source, ["merge-base", "--is-ancestor", pullRequest.mergeCommitSha, protectedTipSha]);
  const mergeRecord = gitText(source, [
    "show", "--no-patch", "--format=%H %P", pullRequest.mergeCommitSha,
  ]).trim().split(/\s+/);
  if (mergeRecord.length !== 2 || mergeRecord[1] !== pullRequest.baseSha) {
    throw new Error("Squash-integrated capture requires a single-parent commit at the exact pull request base.");
  }
  const sourceTreeSha = gitText(source, ["rev-parse", `${evidence.headSha}^{tree}`]).trim();
  const integratedTreeSha = gitText(source, ["rev-parse", `${pullRequest.mergeCommitSha}^{tree}`]).trim();
  if (sourceTreeSha !== integratedTreeSha) {
    throw new Error("Squash-integrated pull request tree differs from the legacy source HEAD tree.");
  }
  const core = Object.freeze({
    schema: SQUASH_INTEGRATION_PROOF_SCHEMA,
    pullRequest,
    protectedTipSha,
    mergeParentSha: mergeRecord[1],
    sourceTreeSha,
    integratedTreeSha,
  });
  return Object.freeze({ ...core, proofDigest: sha256(canonicalJson(core)) });
}

function normalizeMergedPullRequestEvidence(source) {
  if (!source || typeof source !== "object" || source.schema !== MERGED_PULL_REQUEST_EVIDENCE_SCHEMA) {
    throw new Error("Squash-integrated capture requires typed pull request evidence.");
  }
  return Object.freeze({
    schema: MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
    repository: requireRepository(source.repository, "Pull request repository"),
    pullRequestNumber: requirePositiveInteger(source.pullRequestNumber, "Pull request number"),
    state: requireText(source.state, "Pull request state").toLowerCase(),
    draft: requireBoolean(source.draft, "Pull request draft state"),
    merged: requireBoolean(source.merged, "Pull request merged state"),
    mergedAt: requireInstant(source.mergedAt, "Pull request mergedAt"),
    mergeCommitSha: requireShaValue(source.mergeCommitSha, "Pull request merge commit"),
    headRepository: requireRepository(source.headRepository, "Pull request head repository"),
    headBranch: requireText(source.headBranch, "Pull request head branch"),
    headSha: requireShaValue(source.headSha, "Pull request head SHA"),
    baseRepository: requireRepository(source.baseRepository, "Pull request base repository"),
    baseBranch: requireText(source.baseBranch, "Pull request base branch"),
    baseSha: requireShaValue(source.baseSha, "Pull request base SHA"),
  });
}

function requireMergedPullRequestSemantics({ pullRequestEvidence, sourceBranch, sourceHeadSha }) {
  const pullRequest = normalizeMergedPullRequestEvidence(pullRequestEvidence);
  if (pullRequest.state !== "closed" || !pullRequest.merged || pullRequest.draft) {
    throw new Error("Squash-integrated capture requires an authoritative merged pull request.");
  }
  const repository = pullRequest.repository.toLowerCase();
  if (repository !== pullRequest.baseRepository.toLowerCase() ||
      repository !== pullRequest.headRepository.toLowerCase()) {
    throw new Error("Squash-integrated capture requires same-repository pull request evidence.");
  }
  if (pullRequest.baseBranch !== "main") {
    throw new Error("Squash-integrated capture requires protected base branch main.");
  }
  if (pullRequest.headBranch !== sourceBranch || pullRequest.headSha !== sourceHeadSha) {
    throw new Error("Squash-integrated pull request head does not match the legacy source.");
  }
  return pullRequest;
}

function verifySquashIntegrationProof(manifest) {
  const proof = manifest.squashIntegrationProof;
  if (!proof || proof.schema !== SQUASH_INTEGRATION_PROOF_SCHEMA) {
    throw new Error("Squash-integrated recovery package requires its typed proof.");
  }
  const pullRequest = requireMergedPullRequestSemantics({
    pullRequestEvidence: proof.pullRequest,
    sourceBranch: manifest.sourceBranch,
    sourceHeadSha: manifest.sourceHeadSha,
  });
  requireSha(proof.protectedTipSha, "Squash proof protected tip");
  requireSha(proof.mergeParentSha, "Squash proof merge parent");
  requireSha(proof.sourceTreeSha, "Squash proof source tree");
  requireSha(proof.integratedTreeSha, "Squash proof integrated tree");
  requireDigest(proof.proofDigest, "Squash proof digest");
  if (
    pullRequest.headSha !== manifest.sourceHeadSha
    || proof.protectedTipSha !== manifest.protectedTipSha
    || proof.mergeParentSha !== pullRequest.baseSha
    || proof.sourceTreeSha !== proof.integratedTreeSha
  ) {
    throw new Error("Squash integration proof does not match the recovery package.");
  }
  const { proofDigest, ...core } = proof;
  if (sha256(canonicalJson(core)) !== proofDigest) {
    throw new Error("Squash integration proof digest changed.");
  }
}

function requireCaptureProfile(profile) {
  if (![
    LEGACY_TASK_LANE_CAPTURE_PROFILE,
    SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
    CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  ].includes(profile)) {
    throw new Error(`Unsupported legacy capture profile: ${profile}`);
  }
}

function requirePrimaryCanonicalWorktree(source) {
  const gitDirectory = realpathSync(path.resolve(source, gitText(source, ["rev-parse", "--git-dir"]).trim()));
  const commonDirectory = realpathSync(path.resolve(source, gitText(source, ["rev-parse", "--git-common-dir"]).trim()));
  if (gitDirectory !== commonDirectory) {
    throw new Error("Canonical untracked retention requires the primary registered worktree.");
  }
}

function requireCanonicalUntrackedRetention({ source, evidence, protectedTipSha }) {
  if (evidence.branch !== "main") throw new Error("Canonical untracked retention requires branch main.");
  if (evidence.headSha !== protectedTipSha) {
    throw new Error("Canonical untracked retention requires HEAD at the exact protected tip.");
  }
  if (evidence.trackedPaths.length > 0) {
    throw new Error("Canonical untracked retention rejects tracked or staged changes.");
  }
  if (evidence.untrackedPaths.length === 0) {
    throw new Error("Canonical untracked retention requires at least one untracked path.");
  }
}
function requireSameSourceEvidence(before, after) {
  if (canonicalJson(before) !== canonicalJson(after)) throw new Error("Legacy source changed during recovery capture.");
}

function resolveInside(root, relativePath) {
  requireSafeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes recovery root: ${relativePath}`);
  }
  return resolved;
}

function requireSafeRelativePath(value) {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..") || value.includes("\0")) {
    throw new Error(`Unsafe recovery path: ${value}`);
  }
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requireSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(String(value || ""))) throw new Error(`${label} must be a lowercase 40-hex SHA.`);
}

function requireShaValue(value, label) {
  requireSha(value, label);
  return value;
}

function requireRepository(value, label) {
  const repository = requireText(value, label);
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu.test(repository)) {
    throw new Error(`${label} must use owner/repository form.`);
  }
  return repository;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function requireInstant(value, label) {
  const instant = requireText(value, label);
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO instant.`);
  return new Date(milliseconds).toISOString();
}

function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ""))) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

function splitNull(value) {
  return Buffer.from(value).toString("utf8").split("\0").filter(Boolean).sort();
}

function canonicalJson(value) {
  return JSON.stringify(value);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(worktree, args) {
  return execFileSync("git", args, { cwd: worktree, ...textCommandOptions() });
}
function gitText(worktree, args) {
  return String(git(worktree, args));
}

function gitBuffer(worktree, args) {
  return execFileSync("git", args, { cwd: worktree, maxBuffer: 64 * 1024 * 1024 });
}
