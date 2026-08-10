// Responsibility: derive and reclaim only empty repository-owned task-worktree containers.
import { lstatSync, rmdirSync } from "node:fs";
import path from "node:path";

const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR"]);
const NONEMPTY_CODES = new Set(["EEXIST", "ENOTEMPTY"]);

export function deriveTaskWorktreeContainers({
  repoRoot,
  gitCommonDir = path.join(path.resolve(repoRoot || "."), ".git"),
  targetPath,
} = {}) {
  const canonicalRoot = path.resolve(repoRoot || ".");
  const commonDirectory = path.resolve(canonicalRoot, gitCommonDir);
  const repositoryOwnerRoot = path.dirname(commonDirectory);
  const workspaceRoot = path.dirname(repositoryOwnerRoot);
  const repositoryName = path.basename(repositoryOwnerRoot);
  const sharedRoot = path.join(workspaceRoot, ".worktrees");
  const managedRoot = path.join(sharedRoot, repositoryName);
  const targetSupplied = targetPath !== undefined && targetPath !== null;
  const normalizedTarget = targetSupplied && path.isAbsolute(String(targetPath))
    ? path.resolve(String(targetPath))
    : null;
  const rootsAreUnambiguous = Boolean(
    repositoryName
    && repositoryOwnerRoot !== path.parse(repositoryOwnerRoot).root
    && path.dirname(managedRoot) === sharedRoot
    && path.dirname(sharedRoot) === workspaceRoot,
  );
  const targetIsManaged = !targetSupplied || Boolean(
    normalizedTarget
    && normalizedTarget !== managedRoot
    && path.dirname(normalizedTarget) === managedRoot,
  );

  return Object.freeze({
    kind: rootsAreUnambiguous && targetIsManaged ? "managed" : "external",
    repoRoot: canonicalRoot,
    gitCommonDir: commonDirectory,
    repositoryOwnerRoot,
    workspaceRoot,
    targetPath: normalizedTarget,
    managedContainer: Object.freeze({ root: managedRoot }),
    sharedContainer: Object.freeze({ root: sharedRoot }),
  });
}

export function cleanupEmptyTaskWorktreeContainers({
  repoRoot,
  gitCommonDir,
  targetPath,
  pathStat = lstatSync,
  removeDirectory = rmdirSync,
} = {}) {
  // Cooperative safety boundary: lifecycle/provision callers serialize this operation with the
  // repository registry lock. We pin and recheck directory identities immediately before each
  // path-based rmdir. Node exposes no unlinkat-style atomic identity-and-remove primitive, so this
  // deliberately fails closed on observed drift but does not claim adversarial race immunity.
  const ownership = deriveTaskWorktreeContainers({ repoRoot, gitCommonDir, targetPath });
  const workspaceRoot = ownership.workspaceRoot;
  const managedRoot = ownership.managedContainer.root;
  const sharedRoot = ownership.sharedContainer.root;
  const result = {
    kind: ownership.kind,
    managedContainer: { root: managedRoot, disposition: "not-attempted" },
    sharedContainer: { root: sharedRoot, disposition: "not-attempted" },
    removedEmptyDirectories: [],
  };

  if (ownership.kind !== "managed") {
    result.managedContainer.disposition = "not-managed";
    result.sharedContainer.disposition = "not-managed";
    return freezeResult(result);
  }

  const workspaceProbe = inspectContainer(workspaceRoot, pathStat);
  if (workspaceProbe.state !== "directory") {
    result.sharedContainer.disposition = workspaceProbe.state === "absent"
      ? "absent"
      : "retained-ambiguous";
    result.managedContainer.disposition = workspaceProbe.state === "absent"
      ? "absent"
      : "not-attempted";
    return freezeResult(result);
  }

  const sharedProbe = inspectContainer(sharedRoot, pathStat);
  if (sharedProbe.state !== "directory") {
    result.sharedContainer.disposition = sharedProbe.state;
    result.managedContainer.disposition = sharedProbe.state === "absent" ? "absent" : "not-attempted";
    return freezeResult(result);
  }

  const managedProbe = inspectContainer(managedRoot, pathStat);
  if (managedProbe.state !== "directory") {
    result.managedContainer.disposition = managedProbe.state;
    if (managedProbe.state !== "absent") return freezeResult(result);
  } else {
    if (!revalidateDirectoryChain([
      [workspaceRoot, workspaceProbe.identity],
      [sharedRoot, sharedProbe.identity],
      [managedRoot, managedProbe.identity],
    ], pathStat)) {
      result.managedContainer.disposition = "retained-ambiguous";
      result.sharedContainer.disposition = "retained-ambiguous";
      return freezeResult(result);
    }
    result.managedContainer.disposition = removeEmptyDirectory(managedRoot, removeDirectory);
    if (result.managedContainer.disposition === "removed-empty") {
      result.removedEmptyDirectories.push(managedRoot);
    } else if (result.managedContainer.disposition !== "absent") {
      return freezeResult(result);
    }
  }

  const managedAfter = inspectContainer(managedRoot, pathStat);
  if (managedAfter.state !== "absent") {
    result.sharedContainer.disposition = managedAfter.state === "directory"
      ? "retained-nonempty"
      : "retained-ambiguous";
    return freezeResult(result);
  }
  if (!revalidateDirectoryChain([
    [workspaceRoot, workspaceProbe.identity],
    [sharedRoot, sharedProbe.identity],
  ], pathStat)) {
    result.sharedContainer.disposition = "retained-ambiguous";
    return freezeResult(result);
  }
  result.sharedContainer.disposition = removeEmptyDirectory(sharedRoot, removeDirectory);
  if (result.sharedContainer.disposition === "removed-empty") {
    result.removedEmptyDirectories.push(sharedRoot);
  }
  return freezeResult(result);
}

function inspectContainer(root, pathStat) {
  try {
    const metadata = pathStat(root);
    if (metadata.isSymbolicLink()) return { state: "retained-symlink", identity: null };
    if (!metadata.isDirectory()) return { state: "retained-nondirectory", identity: null };
    const identity = directoryIdentity(metadata);
    return identity
      ? { state: "directory", identity }
      : { state: "retained-ambiguous", identity: null };
  } catch (error) {
    if (ABSENT_CODES.has(error?.code)) return { state: "absent", identity: null };
    return { state: "retained-ambiguous", identity: null };
  }
}

function directoryIdentity(metadata) {
  if (!("dev" in metadata) || !("ino" in metadata)) return null;
  return Object.freeze({ dev: metadata.dev, ino: metadata.ino, type: "directory" });
}

function revalidateDirectoryChain(expectedDirectories, pathStat) {
  return expectedDirectories.every(([root, expectedIdentity]) => {
    const current = inspectContainer(root, pathStat);
    return current.state === "directory"
      && sameDirectoryIdentity(current.identity, expectedIdentity);
  });
}

function sameDirectoryIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.type === right.type
    && left.dev === right.dev
    && left.ino === right.ino,
  );
}

function removeEmptyDirectory(root, removeDirectory) {
  try {
    removeDirectory(root);
    return "removed-empty";
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    if (NONEMPTY_CODES.has(error?.code)) return "retained-nonempty";
    return "retained-ambiguous";
  }
}

function freezeResult(result) {
  return Object.freeze({
    ...result,
    managedContainer: Object.freeze({ ...result.managedContainer }),
    sharedContainer: Object.freeze({ ...result.sharedContainer }),
    removedEmptyDirectories: Object.freeze([...result.removedEmptyDirectories]),
  });
}
