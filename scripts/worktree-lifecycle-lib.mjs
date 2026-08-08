import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { isRetiredPreservedLane } from "./legacy-review-ready-retirement-lib.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";

const SAFE_STATES = new Set([
  "canonical",
  "active",
  "review-ready",
  "delivery",
  "parked",
  "owned-untracked",
  "retired-preserved",
  "cleanup-ready",
]);

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
    const dirtState = normalizeDirt(dirt.get(path.resolve(record.path)));
    const lease = latestLeaseForPath(leases, record.path);
    const base = { path: record.path, head: record.head, branch: record.branch || null, lease: lease || null };
    if (record === mainRecords[0]) {
      return {
        ...base,
        state: !dirtState.dirty && record.head === canonicalSha ? "canonical" : "blocked-canonical",
      };
    }
    if (record.bare || record.prunable || record.locked) return { ...base, state: "blocked-invalid" };
    if (dirtState.dirty) {
      if (dirtState.untrackedPaths.length > 0 && hasDurableOwner(lease, record)) {
        return {
          ...base,
          state: "owned-untracked",
          blockScope: "semantic-scope",
          cleanupEligible: false,
          authoredState: {
            schema: "agentic-owned-untracked-state/v1",
            preservation: "in-place",
            observedAt: dirtState.observedAt || now.toISOString(),
            paths: dirtState.untrackedPaths,
            files: dirtState.untrackedFiles,
            owner: {
              sessionId: lease.sessionId,
              branch: lease.branch,
              scope: lease.scope,
              epoch: lease.epoch,
              pullRequestUrl: lease.pullRequestUrl,
            },
          },
        };
      }
      return { ...base, state: "blocked-dirty" };
    }
    if (record.branch) {
      if (isRetiredPreservedLane({ record, lease })) {
        return { ...base, state: "retired-preserved", cleanupEligible: false };
      }
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
  describeUntracked = describeUntrackedFile,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  const records = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]));
  const canonicalSha = git(root, ["rev-parse", "origin/main"]).trim();
  const observedAt = new Date().toISOString();
  const dirt = new Map(records.map(record => {
    const porcelain = git(record.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const dirtState = parseDirtState(porcelain, observedAt);
    dirtState.untrackedFiles = dirtState.untrackedPaths.map(relativePath =>
      describeUntracked(record.path, relativePath, git));
    return [path.resolve(record.path), dirtState];
  }));
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

function normalizeDirt(value) {
  if (!value) return { dirty: false, untrackedPaths: [], untrackedFiles: [], observedAt: null };
  if (typeof value === "boolean") {
    return { dirty: value, untrackedPaths: [], untrackedFiles: [], observedAt: null };
  }
  return {
    dirty: Boolean(value.dirty),
    untrackedPaths: Array.isArray(value.untrackedPaths) ? [...value.untrackedPaths] : [],
    untrackedFiles: Array.isArray(value.untrackedFiles) ? [...value.untrackedFiles] : [],
    observedAt: typeof value.observedAt === "string" ? value.observedAt : null,
  };
}

function parseDirtState(porcelain, observedAt) {
  const entries = porcelain.split("\0").filter(Boolean);
  return {
    dirty: entries.length > 0,
    untrackedPaths: entries
      .filter(entry => entry.startsWith("?? "))
      .map(entry => entry.slice(3))
      .sort(),
    observedAt,
  };
}

function describeUntrackedFile(worktreePath, relativePath, git) {
  const root = path.resolve(worktreePath);
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Untracked path escapes its owning worktree: ${relativePath}`);
  }
  return {
    path: relativePath,
    sizeBytes: lstatSync(absolutePath).size,
    gitObjectId: git(root, ["hash-object", "--no-filters", "--", relativePath]).trim(),
  };
}

function hasDurableOwner(lease, record) {
  const checkedOutBranch = record.branch?.replace(/^refs\/heads\//, "") || null;
  return Boolean(
    lease?.sessionId &&
    lease?.branch &&
    lease?.scope &&
    Number(lease?.epoch) > 0 &&
    lease?.pullRequestUrl &&
    lease?.worktreePath &&
    path.resolve(lease.worktreePath) === path.resolve(record.path) &&
    (!checkedOutBranch || checkedOutBranch === lease.branch),
  );
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
