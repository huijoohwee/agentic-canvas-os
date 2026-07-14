import { realpathSync } from "node:fs";
import path from "node:path";

export function parseWorktreePaths(porcelain) {
  return String(porcelain || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
}

export function assertCanonicalReadPath({ root, cwd, resolvePath = realpathSync }) {
  const canonicalRoot = path.normalize(resolvePath(root));
  const invocationPath = path.normalize(resolvePath(cwd));
  if (invocationPath !== canonicalRoot) {
    throw new Error(`Repository commands must read from the canonical checkout ${canonicalRoot}; received ${invocationPath}`);
  }
  return canonicalRoot;
}

export function assertSingleCanonicalWorktree({ root, porcelain, resolvePath = realpathSync }) {
  const canonicalRoot = path.normalize(resolvePath(root));
  const worktrees = parseWorktreePaths(porcelain).map((value) => path.normalize(resolvePath(value)));
  if (worktrees.length !== 1 || worktrees[0] !== canonicalRoot) {
    throw new Error(`Exactly one canonical worktree is required at ${canonicalRoot}; found ${worktrees.join(", ") || "none"}`);
  }
  return worktrees[0];
}

export function assertNoUnmergedPaths({ conflictPaths, indexEntries }) {
  const conflicts = String(conflictPaths || "").trim();
  const entries = String(indexEntries || "").trim();
  if (conflicts || entries) {
    throw new Error(`Resolve every merge conflict before committing or publishing: ${conflicts || "unmerged index entries"}`);
  }
}

export function assertNoCompetingPullRequests(pulls, activeBranch) {
  const normalized = Array.isArray(pulls) ? pulls : [];
  const owned = normalized.filter((pull) => pull.headRefName === activeBranch);
  const competing = normalized.filter((pull) => pull.headRefName !== activeBranch);
  if (owned.length > 1 || competing.length > 0) {
    const details = normalized.map((pull) => `#${pull.number}:${pull.headRefName}`).join(", ");
    throw new Error(`Exactly one active delivery PR is allowed; close or consolidate competing PRs first (${details})`);
  }
  return owned[0] || null;
}
