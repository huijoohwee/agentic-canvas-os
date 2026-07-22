import { existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

import { parseWorktreeRecords } from "./repository-guards.mjs";

const SAFE_TASK_NAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export function deriveTaskWorktreeRoot(repoRoot) {
  const root = path.resolve(repoRoot);
  return path.join(path.dirname(root), ".worktrees", path.basename(root));
}

export function provisionTaskWorktree({
  invocationPath,
  repoRoot,
  targetPath,
  gitText,
  run,
  pathExists = existsSync,
  pathStat = lstatSync,
  makeDirectory = mkdirSync,
}) {
  const canonicalRoot = path.resolve(repoRoot);
  if (path.resolve(invocationPath) !== canonicalRoot) {
    throw new Error(`Provisioning must start at the canonical repository root ${canonicalRoot}.`);
  }
  const { safeRoot, target } = validateTarget({
    repoRoot: canonicalRoot,
    targetPath,
    pathExists,
    pathStat,
  });
  const before = parseWorktreeRecords(gitText(["worktree", "list", "--porcelain", "-z"]));
  const canonical = before.find(record => path.resolve(record.path) === canonicalRoot);
  if (canonical?.branch !== "refs/heads/main") {
    throw new Error("Provisioning requires the registered canonical main worktree with main checked out.");
  }
  if (before.some(record => path.resolve(record.path) === target)) {
    throw new Error(`Task worktree target is already registered: ${target}`);
  }
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Canonical main must be clean before task-worktree provisioning.");
  }
  run("git", ["fetch", "origin", "main"]);
  const baseSha = gitText(["rev-parse", "origin/main"]).trim();
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== baseSha) {
    throw new Error(`Canonical main must equal fetched origin/main ${baseSha}; received ${headSha}.`);
  }
  makeDirectory(safeRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkAncestors({ repoRoot: canonicalRoot, target, pathExists, pathStat });
  run("git", ["worktree", "add", "--detach", target, baseSha]);
  return { baseSha, canonicalRoot, safeRoot, target };
}

export function rollbackUnclaimedProvision({
  provision,
  registryUnchanged,
  gitText,
  run,
  pathExists = existsSync,
}) {
  if (!provision || !registryUnchanged || !pathExists(provision.target)) return false;
  const records = parseWorktreeRecords(gitText(["worktree", "list", "--porcelain", "-z"]));
  const created = records.find(record => path.resolve(record.path) === provision.target);
  if (!created?.detached || created.branch) return false;
  if (gitText(["-C", provision.target, "status", "--porcelain"]).trim()) return false;
  if (gitText(["-C", provision.target, "rev-parse", "HEAD"]).trim() !== provision.baseSha) return false;
  run("git", ["worktree", "remove", provision.target]);
  return true;
}

function validateTarget({ repoRoot, targetPath, pathExists, pathStat }) {
  if (!targetPath) throw new Error("--worktree=<absolute-new-task-worktree> is required with --provision.");
  if (!path.isAbsolute(targetPath)) throw new Error("Provisioned task worktree path must be absolute.");
  const target = path.resolve(targetPath);
  const safeRoot = deriveTaskWorktreeRoot(repoRoot);
  if (path.dirname(target) !== safeRoot || !SAFE_TASK_NAME.test(path.basename(target))) {
    throw new Error(`Task worktree must be a safe direct child of ${safeRoot}.`);
  }
  if (pathExists(target)) throw new Error(`Task worktree target already exists: ${target}`);
  assertNoSymlinkAncestors({ repoRoot, target, pathExists, pathStat });
  return { safeRoot, target };
}

function assertNoSymlinkAncestors({ repoRoot, target, pathExists, pathStat }) {
  const boundary = path.dirname(path.resolve(repoRoot));
  const relative = path.relative(boundary, path.dirname(target));
  let candidate = boundary;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) candidate = path.join(candidate, segment);
    if (pathExists(candidate) && pathStat(candidate).isSymbolicLink()) {
      throw new Error(`Task worktree root cannot traverse a symbolic link: ${candidate}`);
    }
  }
}
