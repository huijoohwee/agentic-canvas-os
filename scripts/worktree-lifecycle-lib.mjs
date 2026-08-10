import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { isRetiredPreservedLane } from "./legacy-review-ready-retirement-lib.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { cleanupEmptyTaskWorktreeContainers } from "./task-worktree-owned-containers.mjs";

export const WORKTREE_CLEANUP_RESULT_SCHEMA = "agentic-worktree-cleanup-result/v1";

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
  const relevantCompletionShas = new Set(records
    .filter(record => !record.branch && !record.bare && !record.prunable && !record.locked)
    .map(record => ({ record, lease: latestLeaseForPath(leases, record.path) }))
    .filter(({ record, lease }) => lease?.status === "completed" &&
      lease.completion?.mainSha === record.head)
    .map(({ lease }) => lease.completion.mainSha));
  const integratedCompletionShas = new Set([...relevantCompletionShas]
    .filter(completionSha => isAncestor(root, completionSha, canonicalSha)));
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

export function buildWorktreeCleanupReport({
  repository,
  target,
  git = runGit,
  readLeases = readRepositoryLeases,
  isAncestor = isGitAncestor,
  pathExists = pathEntryExists,
  gitCommonDir = "",
} = {}) {
  const root = path.resolve(repository || process.cwd());
  const normalizedTarget = path.resolve(target || "");
  if (!target) throw new Error("Cleanup requires one exact worktree target.");
  const records = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]));
  const mainRecords = records.filter(record => record.branch === "refs/heads/main");
  if (mainRecords.length !== 1) {
    throw new Error(`Expected one canonical main worktree; found ${mainRecords.length}.`);
  }
  const matches = records.filter(record => path.resolve(record.path) === normalizedTarget);
  if (matches.length > 1) throw new Error(`Target has ambiguous worktree registration: ${normalizedTarget}`);
  const canonicalSha = git(root, ["rev-parse", "origin/main"]).trim();
  const commonDirectory = path.resolve(
    root,
    gitCommonDir || git(root, ["rev-parse", "--git-common-dir"]).trim(),
  );
  const leases = readLeases(root, git);
  const lease = latestLeaseForPath(leases, normalizedTarget);
  const record = matches[0] || null;
  const pathPresentBefore = pathExists(normalizedTarget);

  if (!record) {
    if (pathPresentBefore) {
      throw new Error(`Target path remains present without worktree registration: ${normalizedTarget}`);
    }
    if (lease?.status !== "completed" || !lease.completion?.mainSha) {
      throw new Error(`Target is not a registered completed worktree: ${normalizedTarget}`);
    }
    if (!isAncestor(root, lease.completion.mainSha, canonicalSha)) {
      throw new Error(`Completed target is not contained by canonical origin/main: ${normalizedTarget}`);
    }
    return {
      repository: root,
      canonicalSha,
      gitCommonDir: commonDirectory,
      target: {
        path: normalizedTarget,
        registeredBefore: false,
        pathPresentBefore: false,
        head: null,
        completionMainSha: lease.completion.mainSha,
        state: "already-cleaned",
      },
      lease,
    };
  }

  if (record === mainRecords[0]) {
    throw new Error(`Refusing cleanup for ${normalizedTarget}; lifecycle state is canonical.`);
  }
  if (!pathPresentBefore) {
    throw new Error(`Registered cleanup target is missing from the filesystem: ${normalizedTarget}`);
  }
  const observedAt = new Date().toISOString();
  const targetDirt = parseDirtState(
    git(record.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    observedAt,
  );
  const integratedCompletionShas = new Set();
  if (lease?.status === "completed" && lease.completion?.mainSha === record.head &&
      isAncestor(root, lease.completion.mainSha, canonicalSha)) {
    integratedCompletionShas.add(lease.completion.mainSha);
  }
  const candidate = classifyWorktreeLifecycle({
    records: [mainRecords[0], record],
    canonicalSha,
    leases: lease ? [lease] : [],
    dirt: new Map([[normalizedTarget, targetDirt]]),
    integratedCompletionShas,
  })[1];
  return {
    repository: root,
    canonicalSha,
    gitCommonDir: commonDirectory,
    target: {
      path: normalizedTarget,
      registeredBefore: true,
      pathPresentBefore: true,
      head: record.head,
      completionMainSha: lease?.completion?.mainSha || null,
      state: candidate.state,
    },
    lease,
    candidate,
  };
}

export function cleanupCompletedWorktree({
  report,
  target,
  remove = removeWorktree,
  cleanupContainers = cleanupEmptyTaskWorktreeContainers,
} = {}) {
  const normalizedTarget = path.resolve(target || "");
  if (!target) throw new Error("Cleanup requires one exact worktree target.");
  const candidate = report.candidate || report.worktrees?.find(
    item => path.resolve(item.path) === normalizedTarget,
  ) || null;
  const lease = report.lease || candidate?.lease || null;
  const targetEvidence = report.target || (candidate ? {
    path: normalizedTarget,
    registeredBefore: true,
    pathPresentBefore: true,
    head: candidate.head || lease?.completion?.mainSha || null,
    completionMainSha: lease?.completion?.mainSha || null,
    state: candidate.state,
  } : null);
  if (!targetEvidence) throw new Error(`Target is not a registered worktree: ${normalizedTarget}`);
  if (!["cleanup-ready", "already-cleaned"].includes(targetEvidence.state)) {
    throw new Error(`Refusing cleanup for ${normalizedTarget}; lifecycle state is ${targetEvidence.state}.`);
  }
  const replayed = targetEvidence.state === "already-cleaned";
  const removal = replayed
    ? { registeredAfter: false, pathExistsAfter: false }
    : remove(report.repository, normalizedTarget);
  if (removal?.registeredAfter !== false || removal?.pathExistsAfter !== false) {
    throw new Error(`Cleanup did not prove exact worktree absence: ${normalizedTarget}`);
  }
  const commonDirectory = path.resolve(
    report.repository,
    report.gitCommonDir || path.join(report.repository, ".git"),
  );
  const finalTargetEvidence = {
    ...targetEvidence,
    registeredAfter: false,
    pathExistsAfter: false,
  };
  const containers = cleanupContainers({
    repoRoot: report.repository,
    gitCommonDir: commonDirectory,
    targetPath: normalizedTarget,
  });
  const preservedBranch = lease?.branch || null;
  return {
    schema: WORKTREE_CLEANUP_RESULT_SCHEMA,
    status: replayed ? "already-cleaned" : "cleaned",
    repository: report.repository,
    gitCommonDir: commonDirectory,
    canonicalSha: report.canonicalSha,
    target: finalTargetEvidence,
    removedWorktree: replayed ? null : normalizedTarget,
    preservedBranch,
    registrationPruned: false,
    ...containers,
    operationId: createWorktreeCleanupOperationId({
      repository: report.repository,
      gitCommonDir: commonDirectory,
      targetPath: normalizedTarget,
      completionMainSha: targetEvidence.completionMainSha,
      preservedBranch,
      managedContainer: containers.managedContainer,
      sharedContainer: containers.sharedContainer,
    }),
    replayed,
  };
}

export function cleanupEmptyWorktreeContainers({
  repository,
  git = runGit,
  gitCommonDir = "",
  cleanupContainers = cleanupEmptyTaskWorktreeContainers,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  const canonicalSha = git(root, ["rev-parse", "origin/main"]).trim();
  const commonDirectory = path.resolve(
    root,
    gitCommonDir || git(root, ["rev-parse", "--git-common-dir"]).trim(),
  );
  const containers = cleanupContainers({ repoRoot: root, gitCommonDir: commonDirectory });
  const cleaned = containers.removedEmptyDirectories.length > 0;
  const repositoryResidueAbsent = containers.managedContainer.disposition === "absent"
    && ["absent", "retained-nonempty"].includes(containers.sharedContainer.disposition);
  const status = cleaned ? "cleaned" : repositoryResidueAbsent ? "already-cleaned" : "retained";
  return {
    schema: WORKTREE_CLEANUP_RESULT_SCHEMA,
    status,
    repository: root,
    gitCommonDir: commonDirectory,
    canonicalSha,
    target: null,
    removedWorktree: null,
    preservedBranch: null,
    registrationPruned: false,
    ...containers,
    operationId: createWorktreeCleanupOperationId({
      repository: root,
      gitCommonDir: commonDirectory,
      targetPath: null,
      completionMainSha: null,
      preservedBranch: null,
      managedContainer: containers.managedContainer,
      sharedContainer: containers.sharedContainer,
    }),
    replayed: status === "already-cleaned",
  };
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
  const records = parseWorktreeRecords(runGit(repository, ["worktree", "list", "--porcelain"]));
  const registeredAfter = records.some(record => path.resolve(record.path) === path.resolve(target));
  const pathExistsAfter = pathEntryExists(target);
  if (registeredAfter || pathExistsAfter) {
    throw new Error(`Exact worktree removal left registered or filesystem residue: ${target}`);
  }
  return { registeredAfter, pathExistsAfter };
}

export function createWorktreeCleanupOperationId({
  repository,
  gitCommonDir,
  targetPath,
  completionMainSha,
  preservedBranch,
  managedContainer,
  sharedContainer,
}) {
  return createHash("sha256").update(JSON.stringify({
    schema: WORKTREE_CLEANUP_RESULT_SCHEMA,
    repository: path.resolve(repository),
    gitCommonDir: path.resolve(repository, gitCommonDir || path.join(repository, ".git")),
    targetPath: targetPath ? path.resolve(targetPath) : null,
    completionMainSha,
    preservedBranch,
    managedContainerRoot: managedContainer.root,
    sharedContainerRoot: sharedContainer.root,
  })).digest("hex");
}

function pathEntryExists(candidate) {
  try {
    lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
