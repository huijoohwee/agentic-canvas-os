import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";

export const ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA =
  "agentic-active-owned-dirt-evidence/v1";
export const ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA =
  "agentic-active-owned-dirt-snapshot/v1";
export const ACTIVE_OWNED_DIRT_INDEX_SNAPSHOT_SCHEMA =
  "agentic-active-owned-dirt-index-snapshot/v1";

const SHA_PATTERN = /^[0-9a-f]{40,64}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SNAPSHOT_MESSAGE_LIMIT = 256 * 1024;

export function captureActiveOwnedDirtEvidence({
  repository,
  git = createGit(repository),
} = {}) {
  const root = path.resolve(requiredText(repository, "repository"));
  const headSha = requiredObjectId(git(["rev-parse", "HEAD"]), "HEAD");
  const conflicts = nulValues(git([
    "diff", "--name-only", "--diff-filter=U", "-z",
  ]));
  if (conflicts.length > 0) {
    throw new Error("Active-owned-dirt recovery rejects unmerged paths.");
  }
  const staged = pathSet(git([
    "diff", "--cached", "--name-only", "--no-renames", "-z", "--",
  ]));
  const unstaged = pathSet(git([
    "diff", "--name-only", "--no-renames", "-z", "--",
  ]));
  const untracked = pathSet(git([
    "ls-files", "--others", "--exclude-standard", "-z", "--",
  ]));
  const paths = [...new Set([...staged, ...unstaged, ...untracked])].sort();
  if (paths.length === 0) {
    throw new Error("Active-owned-dirt recovery requires a dirty worktree.");
  }
  const entries = paths.map(relativePath => captureEntry({
    root,
    relativePath,
    staged,
    unstaged,
    untracked,
    git,
  }));
  const core = {
    schema: ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA,
    headSha,
    entries,
    pathCount: entries.length,
    stagedPathCount: entries.filter(entry => entry.staged).length,
    unstagedPathCount: entries.filter(entry => entry.unstaged).length,
    untrackedPathCount: entries.filter(entry => entry.untracked).length,
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeActiveOwnedDirtEvidence(value) {
  if (!value || value.schema !== ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA) {
    throw new Error("Active-owned-dirt evidence is malformed.");
  }
  const entries = (value.entries || []).map(normalizeEntry)
    .sort((left, right) => left.path.localeCompare(right.path));
  const core = {
    schema: ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA,
    headSha: requiredObjectId(value.headSha, "evidence HEAD"),
    entries,
    pathCount: entries.length,
    stagedPathCount: entries.filter(entry => entry.staged).length,
    unstagedPathCount: entries.filter(entry => entry.unstaged).length,
    untrackedPathCount: entries.filter(entry => entry.untracked).length,
  };
  if (entries.length === 0 || value.pathCount !== entries.length
    || value.stagedPathCount !== core.stagedPathCount
    || value.unstagedPathCount !== core.unstagedPathCount
    || value.untrackedPathCount !== core.untrackedPathCount
    || value.evidenceDigest !== digestValue(core)) {
    throw new Error("Active-owned-dirt evidence digest or counts are invalid.");
  }
  return Object.freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

export function assertActiveOwnedDirtWithinWriteSet({ evidence, declaredWriteSet }) {
  const normalized = normalizeActiveOwnedDirtEvidence(evidence);
  const writeSet = normalizeWriteSet(declaredWriteSet);
  const uncovered = normalized.entries
    .map(entry => entry.path)
    .filter(candidate => !writeSet.some(scope => coversPath(scope, candidate)));
  if (uncovered.length > 0) {
    throw new Error(`Dirty paths are outside the admitted write set: ${uncovered.join(", ")}`);
  }
  return normalized;
}

export function requireSameActiveOwnedDirtEvidence(expected, observed) {
  const left = normalizeActiveOwnedDirtEvidence(expected);
  const right = normalizeActiveOwnedDirtEvidence(observed);
  if (left.evidenceDigest !== right.evidenceDigest) {
    throw new Error("Active-owned-dirt bytes, modes, paths, or index state changed.");
  }
  return right;
}

export function createActiveOwnedDirtSnapshot({
  repository,
  evidence,
  claimId,
  planDigest,
  timestamp,
  git = createGit(repository),
} = {}) {
  const root = path.resolve(requiredText(repository, "repository"));
  const normalized = normalizeActiveOwnedDirtEvidence(evidence);
  const claim = requiredDigest(claimId, "claim ID");
  const plan = requiredDigest(planDigest, "plan digest");
  const instant = requiredInstant(timestamp, "snapshot timestamp");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agentic-owned-dirt-"));
  try {
    const indexTreeSha = buildTree({
      root,
      indexPath: path.join(temporary, "index-state"),
      evidence: normalized,
      state: "index",
      git,
    });
    const worktreeTreeSha = buildTree({
      root,
      indexPath: path.join(temporary, "worktree-state"),
      evidence: normalized,
      state: "worktree",
      git,
    });
    const indexReceiptCore = {
      schema: ACTIVE_OWNED_DIRT_INDEX_SNAPSHOT_SCHEMA,
      planDigest: plan,
      claimId: claim,
      headSha: normalized.headSha,
      indexTreeSha,
      evidenceDigest: normalized.evidenceDigest,
    };
    const indexReceipt = {
      ...indexReceiptCore,
      indexReceiptDigest: digestValue(indexReceiptCore),
    };
    const indexMessage = `${ACTIVE_OWNED_DIRT_INDEX_SNAPSHOT_SCHEMA}\n\n${JSON.stringify(indexReceipt)}\n`;
    const commitEnvironment = deterministicCommitEnvironment(instant);
    const indexCommitSha = requiredObjectId(git([
      "commit-tree", indexTreeSha, "-p", normalized.headSha,
    ], { input: indexMessage, env: commitEnvironment }), "snapshot index commit");
    const receiptCore = {
      schema: ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA,
      planDigest: plan,
      claimId: claim,
      headSha: normalized.headSha,
      indexTreeSha,
      indexCommitSha,
      worktreeTreeSha,
      evidence: normalized,
    };
    const receipt = Object.freeze({
      ...receiptCore,
      snapshotReceiptDigest: digestValue(receiptCore),
    });
    const message = `${ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA}\n\n${JSON.stringify(receipt)}\n`;
    if (Buffer.byteLength(message) > SNAPSHOT_MESSAGE_LIMIT) {
      throw new Error("Active-owned-dirt snapshot manifest exceeds 256 KiB.");
    }
    const commitSha = requiredObjectId(git([
      "commit-tree", worktreeTreeSha,
      "-p", normalized.headSha,
      "-p", indexCommitSha,
    ], {
      input: message,
      env: commitEnvironment,
    }), "snapshot commit");
    const snapshotRef = `refs/agentic-canvas-os/recovery/active-owned-dirt/${claim}/${plan}`;
    const existing = git.optional(["rev-parse", "--verify", snapshotRef]);
    if (existing && requiredObjectId(existing, "existing snapshot ref") !== commitSha) {
      throw new Error("Active-owned-dirt snapshot ref already binds different bytes.");
    }
    if (!existing) git(["update-ref", snapshotRef, commitSha, zeroObjectId(commitSha)]);
    return verifyActiveOwnedDirtSnapshot({
      repository: root,
      snapshot: { ...receipt, snapshotRef, commitSha },
      git,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifyActiveOwnedDirtSnapshot({ repository, snapshot, git = createGit(repository) }) {
  const normalized = normalizeSnapshot(snapshot);
  const refSha = requiredObjectId(
    git(["rev-parse", "--verify", normalized.snapshotRef]),
    "snapshot ref",
  );
  const treeSha = requiredObjectId(
    git(["show", "-s", "--format=%T", normalized.commitSha]),
    "snapshot tree",
  );
  const indexTreeSha = requiredObjectId(
    git(["show", "-s", "--format=%T", normalized.indexCommitSha]),
    "snapshot index tree",
  );
  if (refSha !== normalized.commitSha || treeSha !== normalized.worktreeTreeSha
    || indexTreeSha !== normalized.indexTreeSha) {
    throw new Error("Active-owned-dirt snapshot ref or tree drifted.");
  }
  const message = git(["show", "-s", "--format=%B", normalized.commitSha]);
  const payload = String(message).split("\n").slice(2).join("\n").trim();
  const receipt = JSON.parse(payload);
  const expectedReceipt = {
    schema: normalized.schema,
    planDigest: normalized.planDigest,
    claimId: normalized.claimId,
    headSha: normalized.headSha,
    indexTreeSha: normalized.indexTreeSha,
    indexCommitSha: normalized.indexCommitSha,
    worktreeTreeSha: normalized.worktreeTreeSha,
    evidence: normalized.evidence,
    snapshotReceiptDigest: normalized.snapshotReceiptDigest,
  };
  const parents = String(git(["show", "-s", "--format=%P", normalized.commitSha])).trim();
  const indexParents = String(git([
    "show", "-s", "--format=%P", normalized.indexCommitSha,
  ])).trim();
  const indexPayload = String(git([
    "show", "-s", "--format=%B", normalized.indexCommitSha,
  ])).split("\n").slice(2).join("\n").trim();
  const indexReceipt = JSON.parse(indexPayload);
  const expectedIndexCore = {
    schema: ACTIVE_OWNED_DIRT_INDEX_SNAPSHOT_SCHEMA,
    planDigest: normalized.planDigest,
    claimId: normalized.claimId,
    headSha: normalized.headSha,
    indexTreeSha: normalized.indexTreeSha,
    evidenceDigest: normalized.evidence.evidenceDigest,
  };
  const expectedIndexReceipt = {
    ...expectedIndexCore,
    indexReceiptDigest: digestValue(expectedIndexCore),
  };
  if (digestValue(receipt) !== digestValue(expectedReceipt)
    || digestValue(indexReceipt) !== digestValue(expectedIndexReceipt)
    || parents !== `${normalized.headSha} ${normalized.indexCommitSha}`
    || indexParents !== normalized.headSha) {
    throw new Error("Active-owned-dirt snapshot receipt drifted.");
  }
  return normalized;
}

function captureEntry({ root, relativePath, staged, unstaged, untracked, git }) {
  const safePath = requiredPath(relativePath);
  const head = parseTreeEntry(git.optional([
    "ls-tree", "-z", "--full-tree", "HEAD", "--", safePath,
  ]));
  const index = parseIndexEntry(git.optional([
    "ls-files", "--stage", "-z", "--", safePath,
  ]));
  const worktree = readWorktreeEntry(root, safePath, git);
  return normalizeEntry({
    path: safePath,
    staged: staged.has(safePath),
    unstaged: unstaged.has(safePath),
    untracked: untracked.has(safePath),
    headMode: head?.mode || null,
    headBlob: head?.blob || null,
    indexMode: index?.mode || null,
    indexBlob: index?.blob || null,
    worktreeType: worktree?.type || "deleted",
    worktreeMode: worktree?.mode || null,
    worktreeBlob: worktree?.blob || null,
  });
}

function readWorktreeEntry(root, relativePath, git) {
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Dirty path escapes the repository.");
  }
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let type;
  let mode;
  let bytes;
  if (stat.isSymbolicLink()) {
    type = "symlink";
    mode = "120000";
    bytes = readlinkSync(absolute, { encoding: "buffer" });
  } else if (stat.isFile()) {
    type = "file";
    mode = stat.mode & 0o111 ? "100755" : "100644";
    bytes = readFileSync(absolute);
  } else {
    throw new Error(`Unsupported dirty path type: ${relativePath}`);
  }
  const blob = requiredObjectId(git([
    "hash-object", "--no-filters", "--stdin",
  ], { input: bytes }), "worktree blob");
  return { type, mode, blob };
}

function buildTree({ root, indexPath, evidence, state, git }) {
  const environment = { GIT_INDEX_FILE: indexPath };
  git(["read-tree", evidence.headSha], { env: environment });
  for (const entry of evidence.entries) {
    const mode = state === "index" ? entry.indexMode : entry.worktreeMode;
    const blob = state === "index" ? entry.indexBlob : writeWorktreeBlob({ root, entry, git });
    if (!mode || !blob) {
      git(["update-index", "--force-remove", "--", entry.path], { env: environment });
      continue;
    }
    git(["update-index", "--add", "--cacheinfo", mode, blob, entry.path], {
      env: environment,
    });
  }
  return requiredObjectId(git(["write-tree"], { env: environment }), `${state} tree`);
}

function writeWorktreeBlob({ root, entry, git }) {
  if (!entry.worktreeBlob) return null;
  const absolute = path.resolve(root, entry.path);
  const bytes = entry.worktreeType === "symlink"
    ? readlinkSync(absolute, { encoding: "buffer" })
    : readFileSync(absolute);
  const blob = requiredObjectId(git(["hash-object", "-w", "--no-filters", "--stdin"], {
    input: bytes,
  }), "snapshot blob");
  if (blob !== entry.worktreeBlob) {
    throw new Error(`Dirty bytes changed while snapshotting ${entry.path}.`);
  }
  return blob;
}

function normalizeEntry(value) {
  const entry = {
    path: requiredPath(value?.path),
    staged: value?.staged === true,
    unstaged: value?.unstaged === true,
    untracked: value?.untracked === true,
    headMode: optionalMode(value?.headMode),
    headBlob: optionalObjectId(value?.headBlob),
    indexMode: optionalMode(value?.indexMode),
    indexBlob: optionalObjectId(value?.indexBlob),
    worktreeType: ["file", "symlink", "deleted"].includes(value?.worktreeType)
      ? value.worktreeType : null,
    worktreeMode: optionalMode(value?.worktreeMode),
    worktreeBlob: optionalObjectId(value?.worktreeBlob),
  };
  if (!entry.worktreeType || (!entry.staged && !entry.unstaged && !entry.untracked)
    || (entry.worktreeType === "deleted") !== (!entry.worktreeMode && !entry.worktreeBlob)
    || (entry.worktreeType !== "deleted" && (!entry.worktreeMode || !entry.worktreeBlob))
    || (entry.untracked && (entry.headBlob || entry.indexBlob))) {
    throw new Error(`Active-owned-dirt entry is malformed: ${entry.path}`);
  }
  return Object.freeze(entry);
}

function normalizeSnapshot(value) {
  const evidence = normalizeActiveOwnedDirtEvidence(value?.evidence);
  const core = {
    schema: ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA,
    planDigest: requiredDigest(value?.planDigest, "snapshot plan digest"),
    claimId: requiredDigest(value?.claimId, "snapshot claim ID"),
    headSha: requiredObjectId(value?.headSha, "snapshot HEAD"),
    indexTreeSha: requiredObjectId(value?.indexTreeSha, "snapshot index tree"),
    indexCommitSha: requiredObjectId(value?.indexCommitSha, "snapshot index commit"),
    worktreeTreeSha: requiredObjectId(value?.worktreeTreeSha, "snapshot worktree tree"),
    evidence,
  };
  if (core.headSha !== evidence.headSha
    || value?.snapshotReceiptDigest !== digestValue(core)) {
    throw new Error("Active-owned-dirt snapshot receipt is malformed.");
  }
  const snapshotRef = requiredText(value?.snapshotRef, "snapshot ref");
  const expectedRef = `refs/agentic-canvas-os/recovery/active-owned-dirt/${core.claimId}/${core.planDigest}`;
  if (snapshotRef !== expectedRef) throw new Error("Active-owned-dirt snapshot ref is malformed.");
  return Object.freeze({
    ...core,
    snapshotReceiptDigest: value.snapshotReceiptDigest,
    snapshotRef,
    commitSha: requiredObjectId(value?.commitSha, "snapshot commit"),
  });
}

function parseTreeEntry(value) {
  if (!value) return null;
  const line = String(value).split("\0").find(Boolean);
  const match = line?.match(/^(\d{6})\s+(?:blob|commit)\s+([0-9a-f]{40,64})\t/u);
  if (!match) throw new Error("Unable to parse HEAD tree entry.");
  return { mode: match[1], blob: match[2] };
}

function parseIndexEntry(value) {
  if (!value) return null;
  const records = String(value).split("\0").filter(Boolean);
  if (records.length !== 1) throw new Error("Conflicted or ambiguous index entry.");
  const match = records[0].match(/^(\d{6})\s+([0-9a-f]{40,64})\s+0\t/u);
  if (!match || /^0+$/u.test(match[2])) throw new Error("Unsupported index entry state.");
  return { mode: match[1], blob: match[2] };
}

function createGit(repository) {
  const cwd = path.resolve(requiredText(repository, "repository"));
  const invoke = (args, options = {}) => execFileSync("git", args, {
    cwd,
    encoding: options.input === undefined ? "utf8" : undefined,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
  invoke.optional = (args, options = {}) => {
    try {
      return invoke(args, options);
    } catch {
      return "";
    }
  };
  return invoke;
}

function deterministicCommitEnvironment(timestamp) {
  return {
    GIT_AUTHOR_NAME: "Agentic Canvas OS",
    GIT_AUTHOR_EMAIL: "agentic-canvas-os@localhost",
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_NAME: "Agentic Canvas OS",
    GIT_COMMITTER_EMAIL: "agentic-canvas-os@localhost",
    GIT_COMMITTER_DATE: timestamp,
  };
}

function nulValues(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function pathSet(value) {
  return new Set(nulValues(value).map(requiredPath));
}

function coversPath(scope, candidate) {
  if (!scope.startsWith("path:")) return false;
  const declared = scope.slice("path:".length).replace(/\/$/u, "");
  return declared === "." || candidate === declared || candidate.startsWith(`${declared}/`);
}

function requiredPath(value) {
  const candidate = String(value || "");
  if (!candidate || path.isAbsolute(candidate) || candidate.includes("\0")
    || candidate.split("/").some(part => part === ".." || part === "")) {
    throw new Error("Dirty path must be a repository-relative literal path.");
  }
  return candidate;
}

function optionalMode(value) {
  if (value === null || value === undefined) return null;
  if (!/^(?:100644|100755|120000|160000)$/u.test(String(value))) {
    throw new Error("Git entry mode is invalid.");
  }
  return String(value);
}

function optionalObjectId(value) {
  return value === null || value === undefined ? null : requiredObjectId(value, "blob ID");
}

function requiredObjectId(value, label) {
  const candidate = Buffer.isBuffer(value) ? value.toString("utf8").trim() : String(value || "").trim();
  if (!SHA_PATTERN.test(candidate)) throw new Error(`${label} must be a Git object ID.`);
  return candidate;
}

function requiredDigest(value, label) {
  const candidate = String(value || "");
  if (!DIGEST_PATTERN.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`);
  return candidate;
}

function requiredInstant(value, label) {
  const candidate = String(value || "");
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} must be an ISO timestamp.`);
  return candidate;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function zeroObjectId(reference) {
  return "0".repeat(reference.length);
}
