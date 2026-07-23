import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseWorktreeRecords } from "./repository-guards.mjs";

const SAFE_STATES = new Set(["canonical", "active", "review-ready", "delivery", "parked", "cleanup-ready"]);

export function classifyWorktreeLifecycle({
  records,
  canonicalSha,
  leases = [],
  dirt = new Map(),
  integratedCompletionShas = new Set(),
  now = new Date(),
}) {
  const mainRecords = records.filter(record => record.branch === "refs/heads/main");
  if (mainRecords.length !== 1) throw new Error(`Expected one canonical main worktree; found ${mainRecords.length}.`);
  return records.map(record => {
    const dirty = Boolean(dirt.get(path.resolve(record.path)));
    const lease = latestLeaseForPath(leases, record.path);
    const base = { path: record.path, head: record.head, branch: record.branch || null, lease: lease || null };
    if (record === mainRecords[0]) {
      return { ...base, state: !dirty && record.head === canonicalSha ? "canonical" : "blocked-canonical" };
    }
    if (dirty) return { ...base, state: "blocked-dirty" };
    if (record.bare || record.prunable || record.locked) return { ...base, state: "blocked-invalid" };
    if (record.branch) {
      if (lease?.status === "active" && Date.parse(lease.expiresAt) > now.getTime()) {
        return { ...base, state: "active" };
      }
      if (lease?.status === "delivery") return { ...base, state: "delivery" };
      if (lease?.status === "review_ready") return { ...base, state: "review-ready" };
      return { ...base, state: "review-required" };
    }
    if (lease?.status === "parked") return { ...base, state: "parked" };
    if (lease?.status === "completed" && record.head === lease.completion?.mainSha &&
        integratedCompletionShas.has(record.head)) {
      return { ...base, state: "cleanup-ready" };
    }
    return { ...base, state: "review-required" };
  });
}

export function buildLifecycleReport({
  repository,
  git = runGit,
  readLeases = readRepositoryLeases,
  isAncestor = isGitAncestor,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  const records = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]));
  const canonicalSha = git(root, ["rev-parse", "origin/main"]).trim();
  const dirt = new Map(records.map(record => [
    path.resolve(record.path),
    Boolean(git(record.path, ["status", "--porcelain"]).trim()),
  ]));
  const leases = readLeases(root, git);
  const integratedCompletionShas = new Set(leases
    .filter(lease => lease?.status === "completed" && lease.completion?.mainSha &&
      isAncestor(root, lease.completion.mainSha, canonicalSha))
    .map(lease => lease.completion.mainSha));
  const worktrees = classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases,
    dirt,
    integratedCompletionShas,
  });
  return {
    schema: "agentic-worktree-lifecycle-report/v1",
    repository: root,
    canonicalSha,
    status: worktrees.every(item => SAFE_STATES.has(item.state)) ? "ready" : "attention-required",
    worktrees,
  };
}

export function cleanupCompletedWorktree({ report, target, remove = removeWorktree }) {
  const normalizedTarget = path.resolve(target || "");
  const candidate = report.worktrees.find(item => path.resolve(item.path) === normalizedTarget);
  if (!candidate) throw new Error(`Target is not a registered worktree: ${normalizedTarget}`);
  if (candidate.state !== "cleanup-ready") {
    throw new Error(`Refusing cleanup for ${normalizedTarget}; lifecycle state is ${candidate.state}.`);
  }
  remove(report.repository, normalizedTarget);
  return { removedWorktree: normalizedTarget, preservedBranch: candidate.lease?.branch || null };
}

function latestLeaseForPath(leases, worktreePath) {
  const normalized = path.resolve(worktreePath);
  return leases
    .filter(lease => lease?.worktreePath && path.resolve(lease.worktreePath) === normalized)
    .sort((left, right) => Number(right.epoch || 0) - Number(left.epoch || 0))[0] || null;
}

function readRepositoryLeases(repository, git) {
  const commonDirectory = path.resolve(repository, git(repository, ["rev-parse", "--git-common-dir"]).trim());
  const registryPath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.json");
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  if (registry?.schema !== "agentic-writer-lease-registry/v2" || !registry.leases) {
    throw new Error(`Unsupported writer lease registry at ${registryPath}.`);
  }
  return Object.values(registry.leases);
}

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function isGitAncestor(cwd, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function removeWorktree(repository, target) {
  execFileSync("git", ["worktree", "remove", target], { cwd: repository, stdio: "inherit" });
  execFileSync("git", ["worktree", "prune"], { cwd: repository, stdio: "inherit" });
}
