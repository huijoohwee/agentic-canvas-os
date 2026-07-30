import { createHash } from "node:crypto";
import { lstatSync, readlinkSync } from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue, requireSha } from "./canonical-main-recovery-receipts.mjs";

export function createWorkingStateManifest({ repo, gitText }) {
  const records = parsePorcelainV1(gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  return records.map(record => {
    const worktree = readWorktreeEntry({ repo, entryPath: record.path, gitText });
    const index = readIndexEntry(record.path, gitText);
    const head = readHeadEntry(record.path, gitText);
    const originalHead = record.originalPath ? readHeadEntry(record.originalPath, gitText) : null;
    return Object.freeze({
      path: record.path,
      originalPath: record.originalPath,
      status: record.status,
      head,
      originalHead,
      index,
      worktree,
    });
  });
}

export function hasWorkingState({ gitText }) {
  return Boolean(gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
}

export function proveIgnoredStateRetention({ localHead, originHead, gitText, gitOptional }) {
  const ignoreCase = gitOptional(["config", "--bool", "core.ignorecase"]).trim() === "true";
  const pathComparison = Object.freeze({
    caseFold: ignoreCase,
    caseFoldStrategy: ignoreCase ? "unicode-upper-lower" : "none",
    unicodeNormalization: "NFC",
  });
  const ignoredPaths = readIgnoredPaths(gitText).sort();
  if (!ignoredPaths.length) {
    return Object.freeze({
      disposition: "none",
      pathCount: 0,
      pathsDigest: digestValue([]),
      targetHead: originHead,
      ignoreRulesChanged: false,
      pathComparison,
    });
  }
  const changedIgnoreRules = readNulValues(gitText([
    "diff",
    "--name-only",
    "-z",
    localHead,
    originHead,
    "--",
    ".gitignore",
    ":(glob)**/.gitignore",
  ]));
  if (changedIgnoreRules.length) {
    throw new Error(
      `Ignored local state cannot be retained because protected history changes ignore rules: ` +
      `${changedIgnoreRules.slice(0, 3).join(", ")}.`,
    );
  }
  const comparableIgnoredPaths = ignoredPaths
    .map(entryPath => normalizeComparisonPath(entryPath, { ignoreCase }))
    .sort();
  const ignored = new Set(comparableIgnoredPaths);
  const targetPaths = readNulValues(gitText(["ls-tree", "-rz", "--name-only", originHead]));
  const collisions = targetPaths.filter(targetPath =>
    hasIgnoredCollision({
      targetPath: normalizeComparisonPath(targetPath, { ignoreCase }),
      ignored,
      ignoredPaths: comparableIgnoredPaths,
    }));
  if (collisions.length) {
    throw new Error(
      `Ignored local state collides with protected target paths: ${collisions.slice(0, 3).join(", ")}.`,
    );
  }
  return Object.freeze({
    disposition: "retained-in-place",
    pathCount: ignoredPaths.length,
    pathsDigest: digestValue(ignoredPaths),
    targetHead: originHead,
    ignoreRulesChanged: false,
    pathComparison,
  });
}

function normalizeComparisonPath(entryPath, { ignoreCase }) {
  const normalized = entryPath.normalize("NFC");
  return ignoreCase
    ? normalized.toUpperCase().toLowerCase().normalize("NFC")
    : normalized;
}

function hasIgnoredCollision({ targetPath, ignored, ignoredPaths }) {
  if (ignored.has(targetPath)) return true;
  const segments = targetPath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    if (ignored.has(segments.slice(0, index).join("/"))) return true;
  }
  const descendantPrefix = `${targetPath}/`;
  let low = 0;
  let high = ignoredPaths.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ignoredPaths[middle] < descendantPrefix) low = middle + 1;
    else high = middle;
  }
  return Boolean(ignoredPaths[low]?.startsWith(descendantPrefix));
}

export function parsePorcelainV1(output) {
  const tokens = String(output || "").split("\0");
  const records = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.length < 4 || token[2] !== " ") throw new Error("Malformed porcelain-v1 working-state record.");
    const status = token.slice(0, 2);
    const entryPath = token.slice(3);
    const renamed = ["R", "C"].includes(status[0]) || ["R", "C"].includes(status[1]);
    const originalPath = renamed ? tokens[++index] : null;
    if (renamed && !originalPath) throw new Error(`Rename/copy record for ${entryPath} lacks its original path.`);
    records.push(Object.freeze({ path: entryPath, originalPath, status }));
  }
  return records;
}

export function describeCapturedStash({ stash, gitText, gitOptional }) {
  const untrackedParent = gitOptional(["rev-parse", "--verify", `${stash.sha}^3`]).trim();
  return Object.freeze({
    ref: stash.ref,
    sha: stash.sha,
    message: stash.message,
    status: "parked",
    trees: Object.freeze({
      worktree: requireSha(gitText(["rev-parse", `${stash.sha}^{tree}`]).trim(), "Stash worktree tree"),
      index: requireSha(gitText(["rev-parse", `${stash.sha}^2^{tree}`]).trim(), "Stash index tree"),
      untracked: untrackedParent
        ? requireSha(gitText(["rev-parse", `${stash.sha}^3^{tree}`]).trim(), "Stash untracked tree")
        : null,
    }),
  });
}

export function verifyCapturedStashManifest({ stash, manifest, gitText }) {
  const expectedPaths = new Set(manifest.flatMap(entry =>
    entry.originalPath ? [entry.path, entry.originalPath] : [entry.path]));
  const capturedPaths = new Set([
    ...readNulValues(gitText([
      "diff", "--name-only", "-z", "--no-renames", `${stash.sha}^1`, stash.sha, "--",
    ])),
    ...readNulValues(gitText([
      "diff", "--name-only", "-z", "--no-renames", `${stash.sha}^1`, `${stash.sha}^2`, "--",
    ])),
    ...(stash.trees.untracked
      ? readNulValues(gitText(["ls-tree", "-rz", "--name-only", `${stash.sha}^3`]))
      : []),
  ]);
  if (canonicalJson([...capturedPaths].sort()) !== canonicalJson([...expectedPaths].sort())) {
    throw new Error("Captured stash path set does not match the prepared working-state manifest.");
  }
  for (const entry of manifest) {
    const head = readTreeEntry({ treeish: `${stash.sha}^1`, entryPath: entry.path, gitText });
    const originalHead = entry.originalPath
      ? readTreeEntry({ treeish: `${stash.sha}^1`, entryPath: entry.originalPath, gitText })
      : null;
    const index = readTreeEntry({ treeish: `${stash.sha}^2`, entryPath: entry.path, gitText });
    const worktreeTreeish = entry.status === "??" ? `${stash.sha}^3` : stash.sha;
    const worktree = readTreeEntry({ treeish: worktreeTreeish, entryPath: entry.path, gitText });
    const normalizedWorktree = worktree && {
      kind: worktree.mode === "120000" ? "symlink" : "file",
      mode: worktree.mode,
      oid: worktree.oid,
    };
    const normalizedIndex = index && { mode: index.mode, oid: index.oid };
    if (canonicalJson(head) !== canonicalJson(entry.head) ||
        canonicalJson(originalHead) !== canonicalJson(entry.originalHead) ||
        canonicalJson(normalizedIndex) !== canonicalJson(entry.index) ||
        canonicalJson(normalizedWorktree) !== canonicalJson(entry.worktree)) {
      throw new Error(`Captured stash evidence disagrees with prepared path ${entry.path}.`);
    }
  }
}

function readWorktreeEntry({ repo, entryPath, gitText }) {
  const absolute = path.resolve(repo, entryPath);
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (stats.isDirectory()) {
    throw new Error(`Working-state path ${entryPath} is a directory or nested repository and cannot be captured exactly.`);
  }
  const kind = stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
  if (kind === "other") throw new Error(`Working-state path ${entryPath} has unsupported filesystem kind.`);
  return Object.freeze({
    kind,
    mode: stats.isSymbolicLink() ? "120000" : stats.mode & 0o111 ? "100755" : "100644",
    oid: stats.isSymbolicLink()
      ? gitBlobOid(readlinkSync(absolute, { encoding: "buffer" }))
      : requireSha(gitText(["hash-object", "--no-filters", "--", entryPath]).trim(), `Worktree blob ${entryPath}`),
  });
}

function readIndexEntry(entryPath, gitText) {
  const output = gitText(["ls-files", "--stage", "-z", "--", entryPath]);
  if (!output) return null;
  const records = output.split("\0").filter(Boolean);
  if (records.length !== 1) throw new Error(`Index path ${entryPath} does not have one stage-zero entry.`);
  const match = /^([0-7]{6}) ([0-9a-f]{40}) 0\t/.exec(records[0]);
  if (!match) throw new Error(`Index path ${entryPath} has an unsupported staged entry.`);
  return Object.freeze({ mode: match[1], oid: match[2] });
}

function readHeadEntry(entryPath, gitText) {
  return readTreeEntry({ treeish: "HEAD", entryPath, gitText });
}

function readTreeEntry({ treeish, entryPath, gitText }) {
  const output = gitText(["ls-tree", "-z", treeish, "--", entryPath]);
  if (!output) return null;
  const records = output.split("\0").filter(Boolean);
  if (records.length !== 1) throw new Error(`${treeish} path ${entryPath} does not resolve to one tree entry.`);
  const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})\t/.exec(records[0]);
  if (!match) throw new Error(`${treeish} path ${entryPath} has an unsupported tree entry.`);
  return Object.freeze({ mode: match[1], type: match[2], oid: match[3] });
}

function gitBlobOid(contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
}

function readNulValues(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function readIgnoredPaths(gitText) {
  return readNulValues(gitText([
    "ls-files", "--others", "--ignored", "--exclude-standard", "-z",
  ]));
}
