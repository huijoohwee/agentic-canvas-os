import { realpathSync } from "node:fs";
import path from "node:path";

const DEVICE_BRANCH_PATTERN = /^agent\/([^/]+)\/([^/]+)$/u;

function parseDeviceBranch(branch) {
  const match = String(branch || "").replace(/^refs\/heads\//u, "").match(DEVICE_BRANCH_PATTERN);
  return match ? { branch: match[0], device: match[1], scope: match[2] } : null;
}

export function assertUniquePullRequestScopes(pulls) {
  const owners = new Map();
  for (const pull of Array.isArray(pulls) ? pulls : []) {
    const identity = parseDeviceBranch(pull?.headRefName);
    if (!identity) continue;
    const existing = owners.get(identity.scope);
    if (existing && existing.headRefName !== pull.headRefName) {
      throw new Error(
        `Semantic scope ${identity.scope} has multiple active pull requests: `
          + `#${existing.number}:${existing.headRefName}, #${pull.number}:${pull.headRefName}`,
      );
    }
    owners.set(identity.scope, pull);
  }
  return owners;
}

function assertNoCompetingScopePullRequests(pulls, activeBranch) {
  const normalizedActiveBranch = String(activeBranch || "").replace(/^refs\/heads\//u, "");
  const active = parseDeviceBranch(normalizedActiveBranch);
  if (!active) {
    throw new Error(
      `Expected an agent/<device>/<semantic-scope> branch; received ${activeBranch}`,
    );
  }
  const owner = assertUniquePullRequestScopes(pulls).get(active.scope);
  if (owner && owner.headRefName !== normalizedActiveBranch) {
    throw new Error(
      `Semantic scope ${active.scope} is already owned by `
        + `#${owner.number}:${owner.headRefName}; wait for an exact-SHA handoff.`,
    );
  }
  return owner || null;
}

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
