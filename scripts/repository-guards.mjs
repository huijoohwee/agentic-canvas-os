import { realpathSync } from "node:fs";
import path from "node:path";
import {
  assertNoCompetingScopePullRequests,
  assertUniquePullRequestScopes,
} from "./writer-lease-lib.mjs";

export function parseWorktreeRecords(porcelain) {
  const records = [];
  let current = null;
  const tokens = String(porcelain || "").includes("\0")
    ? String(porcelain || "").split("\0")
    : String(porcelain || "").split(/\r?\n/);
  for (const token of tokens) {
    const line = token.trim();
    if (!line) continue;
    if (line.startsWith("worktree ")) {
      if (current) records.push(Object.freeze(current));
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length).trim();
    else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).trim();
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line === "locked" || line.startsWith("locked ")) current.locked = true;
    else if (line === "prunable" || line.startsWith("prunable ")) current.prunable = true;
  }
  if (current) records.push(Object.freeze(current));
  return Object.freeze(records);
}

export function parseWorktreePaths(porcelain) {
  return parseWorktreeRecords(porcelain).map(record => record.path);
}

export function assertWorktreeRegistry({ porcelain, resolvePath = realpathSync }) {
  const records = parseWorktreeRecords(porcelain);
  if (records.length === 0) throw new Error("Repository has no registered worktree.");
  const branchOwners = new Map();
  for (const record of records) {
    if (record.bare || record.prunable) {
      throw new Error(`Registered worktree is unavailable or prunable: ${record.path}`);
    }
    resolvePath(record.path);
    if (!record.branch) continue;
    const existing = branchOwners.get(record.branch);
    if (existing && existing !== record.path) {
      throw new Error(`Branch ${record.branch} is active in multiple worktrees: ${existing}, ${record.path}`);
    }
    branchOwners.set(record.branch, record.path);
  }
  return records;
}

export function assertRegisteredWorktree({ cwd, porcelain, resolvePath = realpathSync }) {
  const invocationPath = path.normalize(resolvePath(cwd));
  const record = assertWorktreeRegistry({ porcelain, resolvePath }).find(candidate => (
    path.normalize(resolvePath(candidate.path)) === invocationPath
  ));
  if (!record) {
    throw new Error(`Repository commands require a live registered worktree; received ${invocationPath}`);
  }
  return record;
}

export function assertMainWorktree({ cwd, porcelain, resolvePath = realpathSync }) {
  const record = assertRegisteredWorktree({ cwd, porcelain, resolvePath });
  if (record.branch !== "refs/heads/main") {
    throw new Error(`Canonical synchronization requires the registered main worktree; ${record.path} owns ${record.branch || "detached HEAD"}`);
  }
  return record;
}

export function assertNoUnmergedPaths({ conflictPaths, indexEntries }) {
  const conflicts = String(conflictPaths || "").trim();
  const entries = String(indexEntries || "").trim();
  if (conflicts || entries) {
    throw new Error(`Resolve every merge conflict before committing or publishing: ${conflicts || "unmerged index entries"}`);
  }
}

export function assertNoCompetingPullRequests(pulls, activeBranch) {
  return assertNoCompetingScopePullRequests(pulls, activeBranch);
}

export { assertUniquePullRequestScopes };
