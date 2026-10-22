import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function inspectRootSourceMaintenance({
  lanePath,
  manifestPath,
  expectedManifestDigest,
} = {}) {
  const normalizedLanePath = path.resolve(requiredText(
    lanePath,
    "root-source bootstrap maintenance lane path",
  ));
  const normalizedManifestPath = path.resolve(requiredText(
    manifestPath,
    "root-source bootstrap maintenance manifest path",
  ));
  const manifestBytes = readFileSync(normalizedManifestPath);
  const manifestDigest = sha256(manifestBytes);
  if (manifestDigest !== requiredDigest(
    expectedManifestDigest,
    "root-source bootstrap expected maintenance manifest digest",
  )) {
    throw new Error("Root-source bootstrap maintenance manifest bytes drifted.");
  }
  const manifest = parseManifest(manifestBytes);
  const semanticScope = requiredText(
    manifest.semanticScope,
    "root-source bootstrap maintenance semanticScope",
  );
  if (!Array.isArray(manifest.declaredWriteSet)) {
    throw new Error("Root-source bootstrap maintenance declaredWriteSet is required.");
  }
  const declaredWriteSet = normalizeWriteSet(manifest.declaredWriteSet);
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)) {
    throw new Error(
      "Root-source bootstrap maintenance manifest must declare its semantic scope.",
    );
  }
  const changedPaths = [...new Set([
    ...readGitPaths(normalizedLanePath, ["diff", "--name-only", "-z", "--cached"]),
    ...readGitPaths(normalizedLanePath, ["diff", "--name-only", "-z"]),
    ...readGitPaths(normalizedLanePath, [
      "ls-files", "--others", "--exclude-standard", "-z",
    ]),
  ])].sort();
  const untrackedPaths = readGitPaths(normalizedLanePath, [
    "ls-files", "--others", "--exclude-standard", "-z",
  ]).sort();
  const contentDigest = digestValue({
    schema: "agentic-root-source-bootstrap-maintenance-content/v1",
    stagedDiffDigest: sha256(execFileSync("git", [
      "-C", normalizedLanePath, "diff", "--binary", "--no-ext-diff", "--cached", "--",
    ])),
    unstagedDiffDigest: sha256(execFileSync("git", [
      "-C", normalizedLanePath, "diff", "--binary", "--no-ext-diff", "--",
    ])),
    untrackedFiles: untrackedPaths.map(relativePath => ({
      path: relativePath,
      digest: digestUntrackedFile(normalizedLanePath, relativePath),
    })),
  });
  const records = parseWorktreeRecords(execFileSync("git", [
    "-C", normalizedLanePath, "worktree", "list", "--porcelain", "-z",
  ], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }));
  const matchingRecords = records.filter(
    record => path.resolve(record.path) === normalizedLanePath,
  );
  if (matchingRecords.length !== 1) {
    throw new Error("Root-source bootstrap maintenance source must be one registered worktree.");
  }
  const record = matchingRecords[0];
  const repositoryRoot = path.resolve(execFileSync("git", [
    "-C", normalizedLanePath, "rev-parse", "--show-toplevel",
  ], { encoding: "utf8" }).trim());
  if (repositoryRoot !== normalizedLanePath) {
    throw new Error("Root-source bootstrap maintenance path must be its worktree root.");
  }
  const head = requiredSha(record.head, "root-source bootstrap maintenance HEAD");
  const branch = requiredText(record.branch, "root-source bootstrap maintenance branch");
  const commonDirectory = path.resolve(normalizedLanePath, execFileSync("git", [
    "-C", normalizedLanePath, "rev-parse", "--git-common-dir",
  ], { encoding: "utf8" }).trim());
  const leaseRegistry = createWriterLeaseStore({
    gitCommonDir: commonDirectory,
  }).readRegistry();
  const leaseCount = Object.values(leaseRegistry.leases).filter(lease => (
    path.resolve(lease?.worktreePath || "") === normalizedLanePath
    || lease?.branch === branch.replace(/^refs\/heads\//u, "")
  )).length;
  const core = {
    path: normalizedLanePath,
    repositoryRoot,
    head,
    branch,
    registered: true,
    detached: Boolean(record.detached),
    invalid: Boolean(record.bare || record.locked || record.prunable),
    dirty: changedPaths.length > 0,
    leaseCount,
    manifestDigest,
    semanticScope,
    declaredWriteSet,
    changedPaths,
    contentDigest,
  };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}

export function normalizeMaintenanceSourceProof(source, {
  expectedManifestDigest,
}) {
  requireObject(source, "Root-source bootstrap maintenance proof");
  const manifestDigest = requiredDigest(
    source.manifestDigest,
    "root-source bootstrap maintenance proof manifestDigest",
  );
  if (manifestDigest !== expectedManifestDigest) {
    throw new Error("Root-source bootstrap maintenance proof used a different manifest.");
  }
  const semanticScope = requiredText(
    source.semanticScope,
    "root-source bootstrap maintenance proof semanticScope",
  );
  if (!Array.isArray(source.declaredWriteSet)) {
    throw new Error("Root-source bootstrap maintenance proof declaredWriteSet is required.");
  }
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)) {
    throw new Error("Root-source bootstrap maintenance proof lost its semantic scope.");
  }
  if (!Array.isArray(source.changedPaths)) {
    throw new Error("Root-source bootstrap maintenance proof changedPaths is required.");
  }
  const changedPaths = [...new Set(source.changedPaths.map((changedPath) => {
    const normalized = requiredText(
      changedPath,
      "maintenance changed path",
    ).replaceAll("\\", "/");
    if (
      normalized.startsWith("/")
      || normalized === ".."
      || normalized.startsWith("../")
      || normalized.includes("/../")
    ) {
      throw new Error(
        "Root-source bootstrap maintenance changed paths must be repository-relative.",
      );
    }
    return normalized;
  }))].sort();
  const core = {
    path: path.resolve(requiredText(source.path, "maintenance proof path")),
    repositoryRoot: path.resolve(requiredText(
      source.repositoryRoot,
      "maintenance proof repositoryRoot",
    )),
    head: requiredSha(source.head, "maintenance proof head"),
    branch: requiredText(source.branch, "maintenance proof branch"),
    registered: source.registered === true,
    detached: source.detached === true,
    invalid: source.invalid === true,
    dirty: source.dirty === true,
    leaseCount: nonnegativeInteger(source.leaseCount, "maintenance proof leaseCount"),
    manifestDigest,
    semanticScope,
    declaredWriteSet,
    changedPaths,
    contentDigest: requiredDigest(source.contentDigest, "maintenance proof contentDigest"),
  };
  const stateDigest = requiredDigest(source.stateDigest, "maintenance proof stateDigest");
  if (digestValue(core) !== stateDigest) {
    throw new Error("Root-source bootstrap maintenance source-state digest is invalid.");
  }
  return Object.freeze({ ...core, stateDigest });
}

function parseManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Root-source bootstrap maintenance manifest must be valid JSON.");
  }
  requireObject(manifest, "Root-source bootstrap maintenance manifest");
  if (manifest.schema !== "agentic-write-scope-manifest/v1") {
    throw new Error(
      "Root-source bootstrap maintenance manifest must use agentic-write-scope-manifest/v1.",
    );
  }
  return manifest;
}

function readGitPaths(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }).split("\0").filter(Boolean);
}

function digestUntrackedFile(repository, relativePath) {
  const absolutePath = path.resolve(repository, relativePath);
  const relative = path.relative(repository, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Root-source bootstrap untracked file escaped the maintenance worktree.");
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    return sha256(Buffer.from(`symlink\0${readlinkSync(absolutePath)}`, "utf8"));
  }
  if (!stat.isFile()) {
    throw new Error("Root-source bootstrap untracked changes must be files or symbolic links.");
  }
  return sha256(readFileSync(absolutePath));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase 40-character SHA.`);
  }
  return normalized;
}

function nonnegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return normalized;
}
