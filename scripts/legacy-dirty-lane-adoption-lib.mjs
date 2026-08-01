import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { textCommandOptions } from "./command-text-options.mjs";

export const LEGACY_RECOVERY_SCHEMA = "agentic-legacy-dirty-lane-recovery/v1";
export const LEGACY_ADOPTION_SCHEMA = "agentic-legacy-dirty-lane-adoption/v1";

export function captureLegacyDirtyLane({
  sourceWorktree,
  recoveryDirectory,
  protectedTipSha,
  operatorSessionId,
  now = () => new Date(),
}) {
  const source = requireWorktree(sourceWorktree);
  const recovery = path.resolve(requireText(recoveryDirectory, "Recovery directory"));
  requireNewRecoveryDirectory(recovery);
  requireSha(protectedTipSha, "Protected tip SHA");
  requireText(operatorSessionId, "Operator session id");
  requireCommit(source, protectedTipSha);

  const before = captureSourceEvidence(source);
  if (before.trackedPaths.length === 0 && before.untrackedPaths.length === 0) {
    throw new Error("Legacy capture requires a dirty source worktree.");
  }
  requireAgentBranch(before.branch);
  git(source, ["merge-base", "--is-ancestor", before.headSha, protectedTipSha]);

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
  requireSha(manifest.sourceHeadSha, "Recovery source HEAD");
  requireSha(manifest.protectedTipSha, "Recovery protected tip");
  requireDigest(manifest.stateDigest, "Recovery state digest");
  requireDigest(manifest.writeSetDigest, "Recovery write-set digest");
  requireDigest(manifest.trackedPatchDigest, "Recovery patch digest");
  requireDigest(manifest.packageDigest, "Recovery package digest");

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
  lease,
  receiptPath,
  reconciliationPaths = [],
  now = () => new Date(),
}) {
  const recovery = verifyLegacyRecoveryPackage({ recoveryDirectory });
  const source = requireWorktree(sourceWorktree);
  const target = requireWorktree(targetWorktree);
  if (source !== path.resolve(recovery.sourceWorktree)) throw new Error("Recovery source worktree identity changed.");
  requireText(operatorSessionId, "Operator session id");
  if (operatorSessionId !== recovery.operatorSessionId) throw new Error("Recovery operator session changed.");
  const currentSource = captureSourceEvidence(source);
  requireRecoverySource(recovery, currentSource);
  requireTargetLease({ target, operatorSessionId, lease, protectedTipSha: recovery.protectedTipSha });
  requireCleanTarget(target);

  const reconciliations = normalizeReconciliationPaths(reconciliationPaths, recovery.tracked);
  const alreadyIntegrated = [];
  const untrackedToRestore = [];
  for (const entry of recovery.untracked) {
    const targetPath = resolveInside(target, entry.path);
    if (!existsSync(targetPath)) {
      untrackedToRestore.push(entry);
    } else if (recoveryEntryMatchesPath(entry, targetPath)) {
      alreadyIntegrated.push(entry.path);
    } else {
      throw new Error(`Adoption target path differs from the recovery package: ${entry.path}`);
    }
  }

  const patchPath = path.join(recovery.recoveryDirectory, "tracked.patch");
  const hasPatch = lstatSync(patchPath).size > 0;
  const exclusions = reconciliations.map((relativePath) => `--exclude=${relativePath}`);
  if (hasPatch) git(target, ["apply", "--check", "--3way", ...exclusions, patchPath]);
  if (hasPatch) git(target, ["apply", "--3way", "--index", ...exclusions, patchPath]);
  for (const entry of untrackedToRestore) restoreEntry({ recovery: recovery.recoveryDirectory, target, entry });

  const adoptedPaths = [...recovery.tracked, ...recovery.untracked]
    .map((entry) => entry.path)
    .filter((relativePath) => !reconciliations.includes(relativePath))
    .sort();
  const receipt = Object.freeze({
    schema: LEGACY_ADOPTION_SCHEMA,
    status: reconciliations.length > 0 ? "reconciliation-required" : "complete",
    adoptedAt: now().toISOString(),
    operatorSessionId,
    sourceWorktree: source,
    sourceHeadSha: recovery.sourceHeadSha,
    targetWorktree: target,
    targetBranch: gitText(target, ["branch", "--show-current"]).trim(),
    targetHeadSha: gitText(target, ["rev-parse", "HEAD"]).trim(),
    protectedTipSha: recovery.protectedTipSha,
    recoveryPackageDigest: recovery.packageDigest,
    stateDigest: recovery.stateDigest,
    writeSetDigest: recovery.writeSetDigest,
    adoptedPaths,
    alreadyIntegratedPaths: alreadyIntegrated.sort(),
    reconciliationPaths: reconciliations,
  });
  const output = path.resolve(receiptPath || path.join(recovery.recoveryDirectory, "adoption-receipt.json"));
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({ ...receipt, receiptPath: output });
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

function requireTargetLease({ target, operatorSessionId, lease, protectedTipSha }) {
  const branch = gitText(target, ["branch", "--show-current"]).trim();
  const headSha = gitText(target, ["rev-parse", "HEAD"]).trim();
  if (!lease || lease.status !== "active" || lease.sessionId !== operatorSessionId ||
      lease.branch !== branch || realpathSync(lease.worktreePath) !== target || lease.baseSha !== protectedTipSha ||
      lease.fenceSha !== headSha) {
    throw new Error("Adoption requires the exact active target writer lease at the captured protected tip.");
  }
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

function requireAgentBranch(branch) {
  if (!/^agent\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(branch)) {
    throw new Error("Legacy source must use the canonical agent/device/scope branch form.");
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
