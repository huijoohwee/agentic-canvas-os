// Responsibility: Capture and verify immutable no-follow Git evidence for one active-owned dirty worktree.
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
export const ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA = "agentic-active-owned-dirt-evidence/v1";
export const ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA = "agentic-active-owned-dirt-snapshot/v1";
export const ACTIVE_OWNED_DIRT_INDEX_SNAPSHOT_SCHEMA = "agentic-active-owned-dirt-index-snapshot/v1";
const SHA_PATTERN = /^[0-9a-f]{40,64}$/u, DIGEST_PATTERN = /^[0-9a-f]{64}$/u, SNAPSHOT_MESSAGE_LIMIT = 256 * 1024;
export function captureActiveOwnedDirtEvidence({ repository, git = createGit(repository) } = {}) {
  const root = path.resolve(requiredText(repository, "repository"));
  const headSha = requiredObjectId(git(["rev-parse", "HEAD"]), "HEAD");
  const conflicts = nulValues(git(["diff", "--name-only", "--diff-filter=U", "-z"]));
  if (conflicts.length > 0) throw new Error(
    "Active-owned-dirt recovery rejects unmerged paths.");
  const staged = pathSet(git(["diff", "--cached", "--name-only", "--no-renames", "-z", "--"]));
  const unstaged = pathSet(git(["diff", "--name-only", "--no-renames", "-z", "--"]));
  const untracked = pathSet(git(["ls-files", "--others", "--exclude-standard", "-z", "--"]));
  const paths = [...new Set([...staged, ...unstaged, ...untracked])].sort(comparePaths);
  if (paths.length === 0) throw new Error(
    "Active-owned-dirt recovery requires a dirty worktree.");
  const entries = paths.map(relativePath => captureEntry({
    root, relativePath, staged, unstaged, untracked, git }));
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
  if (!value || value.schema !== ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA) throw new Error(
    "Active-owned-dirt evidence is malformed.");
  const entries = (value.entries || []).map(normalizeEntry).sort((left, right) => comparePaths(left.path, right.path));
  const core = {
    schema: ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA,
    headSha: requiredObjectId(value.headSha, "evidence HEAD"),
    entries,
    pathCount: entries.length,
    stagedPathCount: entries.filter(entry => entry.staged).length,
    unstagedPathCount: entries.filter(entry => entry.unstaged).length,
    untrackedPathCount: entries.filter(entry => entry.untracked).length,
  };
  if (entries.some((entry, index) => entry.path === entries[index - 1]?.path)
    || entries.length === 0 || value.pathCount !== entries.length
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
  if (uncovered.length > 0) throw new Error(
    `Dirty paths are outside the admitted write set: ${uncovered.join(", ")}`);
  return normalized;
}
export function requireSameActiveOwnedDirtEvidence(expected, observed) {
  const left = normalizeActiveOwnedDirtEvidence(expected);
  const right = normalizeActiveOwnedDirtEvidence(observed);
  if (left.evidenceDigest !== right.evidenceDigest) throw new Error(
    "Active-owned-dirt bytes, modes, paths, or index state changed.");
  return right;
}
export function createActiveOwnedDirtSnapshot({ repository, evidence, claimId, planDigest,
  timestamp, git = createGit(repository) } = {}) {
  const root = path.resolve(requiredText(repository, "repository"));
  const normalized = normalizeActiveOwnedDirtEvidence(evidence);
  const claim = requiredDigest(claimId, "claim ID");
  const plan = requiredDigest(planDigest, "plan digest");
  const instant = requiredInstant(timestamp, "snapshot timestamp");
  preflightSnapshot({ root, evidence: normalized, claimId: claim, planDigest: plan, git });
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agentic-owned-dirt-"));
  try {
    const indexTreeSha = buildTree({ root, indexPath: path.join(temporary, "index-state"),
      evidence: normalized, state: "index", git });
    const worktreeTreeSha = buildTree({ root,
      indexPath: path.join(temporary, "worktree-state"), evidence: normalized,
      state: "worktree", git });
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
    const existing = git.optional(["rev-parse", "--verify", "--quiet", snapshotRef]);
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
  assertSnapshotTrees({ snapshot: normalized, git });
  return normalized;
}
function assertSnapshotTrees({ snapshot, git }) {
  const expected = { index: [], worktree: [] };
  for (const entry of snapshot.evidence.entries) {
    const observed = { head: snapshotTreeEntry(git, snapshot.headSha, entry.path),
      index: snapshotTreeEntry(git, snapshot.indexTreeSha, entry.path),
      worktree: snapshotTreeEntry(git, snapshot.worktreeTreeSha, entry.path) };
    const declared = { head: treePair(entry.headMode, entry.headBlob),
      index: treePair(entry.indexMode, entry.indexBlob),
      worktree: treePair(entry.worktreeMode, entry.worktreeBlob) };
    if (["head", "index", "worktree"].some(state =>
      !sameTreeEntry(observed[state], declared[state]))) invalidSnapshotTrees();
    const staged = !sameTreeEntry(observed.head, observed.index);
    const untracked = !observed.head && !observed.index && Boolean(observed.worktree);
    const unstaged = !untracked && !sameTreeEntry(observed.index, observed.worktree);
    if (entry.staged !== staged || entry.unstaged !== unstaged
      || entry.untracked !== untracked) invalidSnapshotTrees();
    if (staged) expected.index.push(entry.path);
    if (!sameTreeEntry(observed.head, observed.worktree)) expected.worktree.push(entry.path);
  }
  for (const [state, tree] of [["index", snapshot.indexTreeSha],
    ["worktree", snapshot.worktreeTreeSha]]) {
    const actual = [...pathSet(git(["diff-tree", "--no-commit-id", "--name-only",
      "-r", "-z", "--no-renames", snapshot.headSha, tree, "--"]))].sort(comparePaths);
    if (JSON.stringify(actual) !== JSON.stringify(expected[state])) invalidSnapshotTrees();
  }
}
function invalidSnapshotTrees() { throw new Error(
  "Active-owned-dirt snapshot trees do not encode declared evidence."); }
function snapshotTreeEntry(git, tree, entryPath) { return parseTreeEntry(git.optional(
  ["ls-tree", "-z", "--full-tree", tree, "--", entryPath])); }
function treePair(mode, blob) { return mode && blob ? { mode, blob } : null; }
function sameTreeEntry(left, right) { return (left?.mode || null) === (right?.mode || null)
  && (left?.blob || null) === (right?.blob || null); }
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
  return withSecureWorktreeEntry({ root, relativePath }, observed => {
    if (!observed) return null;
    const blob = requiredObjectId(git([
      "hash-object", "--no-filters", "--stdin",
    ], { input: observed.bytes }), "worktree blob");
    return { type: observed.type, mode: observed.mode, blob };
  });
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
  return withSecureWorktreeEntry({ root, relativePath: entry.path }, observed => {
    if (!observed) {
      if (entry.worktreeType !== "deleted" || entry.worktreeMode || entry.worktreeBlob) {
        throw new Error(`Dirty path changed while snapshotting ${entry.path}.`);
      }
      return null;
    }
    if (observed.type !== entry.worktreeType || observed.mode !== entry.worktreeMode
      || !entry.worktreeBlob) {
      throw new Error(`Dirty path type or mode changed while snapshotting ${entry.path}.`);
    }
    const predictedBlob = requiredObjectId(git([
      "hash-object", "--no-filters", "--stdin",
    ], { input: observed.bytes }), "predicted snapshot blob");
    if (predictedBlob !== entry.worktreeBlob) {
      throw new Error(`Dirty bytes changed while snapshotting ${entry.path}.`);
    }
    observed.assertUnchanged();
    const writtenBlob = requiredObjectId(git([
      "hash-object", "-w", "--no-filters", "--stdin",
    ], { input: observed.bytes }), "snapshot blob");
    if (writtenBlob !== predictedBlob) {
      throw new Error(`Snapshot object changed while writing ${entry.path}.`);
    }
    return writtenBlob;
  });
}
function preflightSnapshot({ root, evidence, claimId, planDigest, git }) {
  const placeholder = "f".repeat(evidence.headSha.length);
  const receiptCore = { schema: ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA, planDigest, claimId,
    headSha: evidence.headSha, indexTreeSha: placeholder,
    indexCommitSha: placeholder, worktreeTreeSha: placeholder, evidence };
  const projected = `${ACTIVE_OWNED_DIRT_SNAPSHOT_SCHEMA}\n\n${JSON.stringify(
    { ...receiptCore, snapshotReceiptDigest: digestValue(receiptCore) })}\n`;
  if (Buffer.byteLength(projected) > SNAPSHOT_MESSAGE_LIMIT) throw new Error(
    "Active-owned-dirt snapshot manifest exceeds 256 KiB.");
  for (const entry of evidence.entries) {
    withSecureWorktreeEntry({ root, relativePath: entry.path }, observed => {
      if (entry.worktreeType === "deleted") {
        if (observed) throw new Error(
          `Deleted dirty path reappeared while preflighting ${entry.path}.`);
        return;
      }
      if (!observed || observed.type !== entry.worktreeType
        || observed.mode !== entry.worktreeMode) throw new Error(
          `Dirty path type or mode changed while preflighting ${entry.path}.`);
      const blob = requiredObjectId(git(["hash-object", "--no-filters", "--stdin"],
        { input: observed.bytes }), "preflight worktree blob");
      if (blob !== entry.worktreeBlob) throw new Error(
        `Dirty bytes changed while preflighting ${entry.path}.`);
      observed.assertUnchanged();
    });
  }
}
function withSecureWorktreeEntry({ root, relativePath }, action) {
  const safePath = requiredPath(relativePath);
  const resolvedRoot = path.resolve(requiredText(root, "repository"));
  const absolute = path.resolve(resolvedRoot, safePath);
  if (absolute === resolvedRoot || !absolute.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Dirty path escapes the repository.");
  }
  const ancestors = captureAncestorIdentities({ root: resolvedRoot,
    parent: path.dirname(absolute), relativePath: safePath });
  if (ancestors.at(-1)?.identity === null) {
    try { return action(null); }
    finally { assertAncestorIdentities(ancestors, safePath); }
  }
  let target;
  try {
    target = lstatSync(absolute, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const result = action(null);
    assertTargetAbsent(absolute, safePath);
    assertAncestorIdentities(ancestors, safePath);
    return result;
  }
  const targetIdentity = statIdentity(target);
  if (target.isSymbolicLink()) {
    const bytes = readlinkSync(absolute, { encoding: "buffer" });
    const assertUnchanged = () => {
      assertTargetIdentity({ absolute, expected: targetIdentity, relativePath: safePath });
      assertAncestorIdentities(ancestors, safePath);
    };
    try { return action({ type: "symlink", mode: "120000", bytes, assertUnchanged }); }
    finally { assertUnchanged(); }
  }
  if (!target.isFile()) throw new Error(`Unsupported dirty path type: ${safePath}`);
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new Error(
    "Secure dirty-file capture requires no-follow file opens.");
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || statIdentity(opened) !== targetIdentity) throw new Error(
      `Dirty path changed before secure read: ${safePath}`);
    const bytes = readFileSync(descriptor);
    const mode = Number(opened.mode & 0o111n) ? "100755" : "100644";
    const assertUnchanged = () => {
      const observed = fstatSync(descriptor, { bigint: true });
      if (!observed.isFile() || statIdentity(observed) !== targetIdentity) {
        throw new Error(`Dirty file changed during secure read: ${safePath}`);
      }
      assertTargetIdentity({ absolute, expected: targetIdentity, relativePath: safePath });
      assertAncestorIdentities(ancestors, safePath);
    };
    try { return action({ type: "file", mode, bytes, assertUnchanged }); }
    finally { assertUnchanged(); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    assertTargetIdentity({ absolute, expected: targetIdentity, relativePath: safePath });
    assertAncestorIdentities(ancestors, safePath);
  }
}
function captureAncestorIdentities({ root, parent, relativePath }) {
  const relativeParent = path.relative(root, parent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeParent)) {
    throw new Error("Dirty path parent escapes the repository.");
  }
  const paths = [root];
  let cursor = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    paths.push(cursor);
  }
  const identities = [];
  for (const ancestor of paths) {
    let stat;
    try {
      stat = lstatSync(ancestor, { bigint: true });
    } catch (error) {
      if (ancestor !== root && error?.code === "ENOENT") {
        identities.push(Object.freeze({ path: ancestor, identity: null }));
        break;
      }
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Dirty path has a symlink or non-directory ancestor: ${relativePath}`);
    }
    identities.push(Object.freeze({ path: ancestor, identity: statIdentity(stat) }));
  }
  return Object.freeze(identities);
}
function assertAncestorIdentities(ancestors, relativePath) {
  for (const ancestor of ancestors) {
    let observed;
    try {
      observed = lstatSync(ancestor.path, { bigint: true });
    } catch (error) {
      if (ancestor.identity === null && error?.code === "ENOENT") continue;
      throw new Error(`Dirty path ancestor changed during secure read: ${relativePath}`);
    }
    if (ancestor.identity === null || observed.isSymbolicLink() || !observed.isDirectory()
      || statIdentity(observed) !== ancestor.identity) {
      throw new Error(`Dirty path ancestor changed during secure read: ${relativePath}`);
    }
  }
}
function assertTargetIdentity({ absolute, expected, relativePath }) {
  let observed;
  try {
    observed = lstatSync(absolute, { bigint: true });
  } catch {
    throw new Error(`Dirty path changed during secure read: ${relativePath}`);
  }
  if (statIdentity(observed) !== expected) {
    throw new Error(`Dirty path changed during secure read: ${relativePath}`);
  }
}
function assertTargetAbsent(absolute, relativePath) {
  try {
    lstatSync(absolute, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Deleted dirty path reappeared during secure read: ${relativePath}`);
}
function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size,
    stat.mtimeNs, stat.ctimeNs].join(":");
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
    || Boolean(entry.headMode) !== Boolean(entry.headBlob)
    || Boolean(entry.indexMode) !== Boolean(entry.indexBlob)
    || (entry.worktreeType === "deleted") !== (!entry.worktreeMode && !entry.worktreeBlob)
    || (entry.worktreeType !== "deleted" && (!entry.worktreeMode || !entry.worktreeBlob))
    || (entry.worktreeType === "symlink" && entry.worktreeMode !== "120000")
    || (entry.worktreeType === "file" && !["100644", "100755"].includes(entry.worktreeMode))
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
    cwd, encoding: options.input === undefined ? "utf8" : undefined,
    stdio: ["pipe", "pipe", "pipe"], ...options,
    env: { ...process.env, ...(options.env || {}) } });
  invoke.optional = (args, options = {}) => {
    try { return invoke(args, options); } catch (error) {
      if (error?.status === 1) return "";
      throw error;
    } };
  return invoke;
}
function deterministicCommitEnvironment(timestamp) {
  return { GIT_AUTHOR_NAME: "Agentic Canvas OS", GIT_AUTHOR_DATE: timestamp,
    GIT_AUTHOR_EMAIL: "agentic-canvas-os@localhost", GIT_COMMITTER_NAME: "Agentic Canvas OS",
    GIT_COMMITTER_EMAIL: "agentic-canvas-os@localhost", GIT_COMMITTER_DATE: timestamp };
}
function nulValues(value) { return String(value || "").split("\0").filter(Boolean); }
function pathSet(value) { return new Set(nulValues(value).map(requiredPath)); }
function comparePaths(left, right) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function coversPath(scope, candidate) {
  if (!scope.startsWith("path:")) return false;
  const declared = scope.slice("path:".length).replace(/\/$/u, "");
  return declared === "." || candidate === declared || candidate.startsWith(`${declared}/`); }
function requiredPath(value) {
  const candidate = String(value || "");
  if (!candidate || path.isAbsolute(candidate) || candidate.includes("\0") || candidate.includes("\uFFFD")
    || candidate.split("/").some(part => part === ".." || part === "")) {
    throw new Error("Dirty path must be a repository-relative literal path.");
  }
  return candidate; }
function optionalMode(value) {
  if (value === null || value === undefined) return null;
  if (!/^(?:100644|100755|120000|160000)$/u.test(String(value))) throw new Error(
    "Git entry mode is invalid.");
  return String(value); }
function optionalObjectId(value) { return value == null ? null : requiredObjectId(value, "blob ID"); }
function requiredObjectId(value, label) {
  const candidate = Buffer.isBuffer(value) ? value.toString("utf8").trim() : String(value || "").trim();
  if (!SHA_PATTERN.test(candidate)) throw new Error(`${label} must be a Git object ID.`); return candidate; }
function requiredDigest(value, label) {
  const candidate = String(value || "");
  if (!DIGEST_PATTERN.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`); return candidate; }
function requiredInstant(value, label) {
  const candidate = String(value || "");
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} must be an ISO timestamp.`); return candidate; }
function requiredText(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(
  `${label} is required.`); return value.trim(); }
function zeroObjectId(reference) { return "0".repeat(reference.length); }
