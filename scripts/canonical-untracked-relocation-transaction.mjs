// Responsibility: Own the loss-safe filesystem transaction and private journals for canonical relocation.
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, closeSync, constants, copyFileSync, existsSync, fsyncSync, fstatSync,
  linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertCanonicalUntrackedRelocationAuthorityAttempt,
  assertCanonicalUntrackedRelocationPlan,
  assertCanonicalUntrackedRelocationReceipt,
  canonicalUntrackedRelocationOperationLayout,
  canonicalUntrackedRelocationSubject,
  createCanonicalUntrackedRelocationAuthorityAttempt,
} from "./canonical-untracked-relocation-contract.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PATHS = 256;

export { canonicalUntrackedRelocationOperationLayout, canonicalUntrackedRelocationSubject };

export async function withCanonicalUntrackedRelocationLock({ plan, action, now }) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  return withPrivateOperationLock({
    file: layout.lockPath,
    context: {
      operation: "canonical-untracked-relocation",
      sourceOperationId: layout.sourceOperationId,
      sourceWorktree: normalized.evidence.source.worktree,
      sourceHeadSha: normalized.evidence.source.headSha,
      sourceStateDigest: normalized.evidence.source.stateDigest,
      sourceWriteSetDigest: normalized.evidence.source.writeSetDigest,
    },
    action,
    ...(now ? { now } : {}),
  });
}

export function prepareCanonicalUntrackedRelocationTransaction({ plan, entries, recoveryDirectory }) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  const subject = canonicalUntrackedRelocationSubject(normalized);
  requireRecoveryDirectory(normalized, recoveryDirectory);
  ensureOwnedDirectory(normalized.evidence.source.commonDirectory, layout.operationRoot);
  const sourceIntent = Object.freeze({
    schema: "agentic-canonical-untracked-relocation-source-intent/v1",
    sourceOperationId: layout.sourceOperationId,
    subjectDigest: subject.subjectDigest,
    transactionLayoutDigest: digestValue(layout),
  });
  ensureImmutableJson(layout.sourceIntentPath, sourceIntent, "source relocation intent",
    normalized.evidence.source.commonDirectory);
  ensureOwnedDirectory(recoveryDirectory, layout.transactionRoot);
  ensureImmutableJson(layout.intentPath, Object.freeze({
    schema: "agentic-canonical-untracked-relocation-intent/v1",
    sourceOperationId: layout.sourceOperationId,
    subjectDigest: subject.subjectDigest,
    recoveryPackageDigest: normalized.evidence.recovery.packageDigest,
    transactionLayoutDigest: digestValue(layout),
  }), "relocation intent", recoveryDirectory);
  const targetRoot = path.join(normalized.evidence.target.worktree,
    normalized.evidence.source.subtree);
  const targetState = canonicalRelocationDirectoryState(targetRoot, entries,
    normalized.evidence.source.subtree);
  if (targetState === "absent") {
    prepareStage({ stage: layout.stagePath, entries, recoveryDirectory,
      subtree: normalized.evidence.source.subtree });
  } else if (targetState !== "exact") {
    throw new Error("Canonical-untracked relocation target drifted before staging.");
  }
  return Object.freeze({ layout, sourceIntent });
}

export function readCanonicalUntrackedRelocationSourceIntent(plan) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  if (!existsSync(layout.sourceIntentPath)) return null;
  const value = readJsonBounded(
    layout.sourceIntentPath,
    "source relocation intent",
    normalized.evidence.source.commonDirectory,
  );
  const expected = {
    schema: "agentic-canonical-untracked-relocation-source-intent/v1",
    sourceOperationId: layout.sourceOperationId,
    subjectDigest: canonicalUntrackedRelocationSubject(normalized).subjectDigest,
    transactionLayoutDigest: digestValue(layout),
  };
  if (digestValue(value) !== digestValue(expected)) {
    throw new Error("Source relocation intent drifted.");
  }
  return Object.freeze(value);
}

export function applyCanonicalUntrackedRelocationTransaction({
  plan,
  entries,
  recoveryDirectory,
}, dependencies = {}) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const evidence = normalized.evidence;
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  requireRecoveryDirectory(normalized, recoveryDirectory);
  const sourceRoot = path.join(evidence.source.worktree, evidence.source.subtree);
  const targetRoot = path.join(evidence.target.worktree, evidence.source.subtree);
  const sourceState = canonicalRelocationDirectoryState(sourceRoot, entries, evidence.source.subtree);
  const targetState = canonicalRelocationDirectoryState(targetRoot, entries, evidence.source.subtree);
  const quarantineState = canonicalRelocationDirectoryState(
    layout.quarantinePath,
    entries,
    evidence.source.subtree,
  );
  requireCanonicalUntrackedRelocationEffectDevices(
    { plan: normalized, entries },
    { stat: dependencies.stat || statSync },
  );
  if (sourceState === "exact" && targetState === "absent" && quarantineState === "absent") {
    requireCanonicalRelocationDirectoryExact(
      layout.stagePath,
      entries,
      evidence.source.subtree,
      "relocation stage",
    );
    renameSync(layout.stagePath, targetRoot);
    syncDirectory(path.dirname(targetRoot));
  } else if (sourceState === "absent" && targetState === "absent" && quarantineState === "exact") {
    requireCanonicalRelocationDirectoryExact(
      layout.stagePath, entries, evidence.source.subtree, "relocation recovery stage",
    );
    renameSync(layout.stagePath, targetRoot);
    syncDirectory(path.dirname(targetRoot));
  } else if (!(sourceState === "exact" && targetState === "exact" && quarantineState === "absent")
    && !(sourceState === "absent" && targetState === "exact" && quarantineState === "exact")) {
    throw new Error("Canonical-untracked relocation transaction state is ambiguous or drifted.");
  }
  if (canonicalRelocationDirectoryState(sourceRoot, entries, evidence.source.subtree) === "exact") {
    if (dependencies.beforeSourceQuarantine) dependencies.beforeSourceQuarantine();
    requireCanonicalUntrackedRelocationEffectDevices(
      { plan: normalized, entries },
      { stat: dependencies.stat || statSync },
    );
    requireCanonicalRelocationDirectoryExact(targetRoot, entries, evidence.source.subtree, "relocation target");
    renameSync(sourceRoot, layout.quarantinePath);
    syncDirectory(path.dirname(sourceRoot));
    syncDirectory(layout.transactionRoot);
  }
  requireCanonicalRelocationDirectoryExact(targetRoot, entries, evidence.source.subtree, "relocation target");
  requireCanonicalRelocationDirectoryExact(
    layout.quarantinePath,
    entries,
    evidence.source.subtree,
    "source quarantine",
  );
  if (existsSync(sourceRoot)) throw new Error("Canonical source subtree remains after relocation.");
  return Object.freeze({
    status: "relocated",
    contentDigest: canonicalRelocationContentDigest(entries),
    targetRoot,
    quarantine: layout.quarantinePath,
  });
}

export function executeCanonicalUntrackedFilesystemTransaction(input, dependencies = {}) {
  prepareCanonicalUntrackedRelocationTransaction(input);
  return applyCanonicalUntrackedRelocationTransaction(input, dependencies);
}

export function writeCanonicalUntrackedRelocationEffectIntent({
  plan,
  phase,
  taskAuthorityReceiptDigest,
  mutationAuthorityReceiptDigest,
  receiptTimestamp,
  targetInstallAttempt = null,
  sourceQuarantineAttempt = null,
}) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  const subject = canonicalUntrackedRelocationSubject(normalized);
  const pendingAttempt = createCanonicalUntrackedRelocationAuthorityAttempt({
    plan: normalized,
    phase,
    taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest,
    authorizedAt: receiptTimestamp,
  });
  const targetAttempt = phase === "target-install" ? pendingAttempt
    : assertCanonicalUntrackedRelocationAuthorityAttempt(targetInstallAttempt);
  const core = Object.freeze({
    schema: "agentic-canonical-untracked-relocation-effect-intent/v3",
    subjectDigest: subject.subjectDigest,
    targetInstallAttempt: targetAttempt,
    sourceQuarantineAttempt: phase === "source-quarantine" ? pendingAttempt
      : sourceQuarantineAttempt
        ? assertCanonicalUntrackedRelocationAuthorityAttempt(sourceQuarantineAttempt) : null,
  });
  const intent = Object.freeze({ ...core, intentDigest: digestValue(core) });
  writeJsonAtomic(layout.effectIntentPath, intent, {
    replace: true,
    ownedRoot: normalized.evidence.recovery.directory,
  });
  return intent;
}

export function readCanonicalUntrackedRelocationEffectIntent(plan) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  const file = layout.effectIntentPath;
  if (!existsSync(file)) return null;
  const value = readJsonBounded(
    file,
    "relocation effect intent",
    normalized.evidence.recovery.directory,
  );
  const core = {
    schema: value.schema,
    subjectDigest: value.subjectDigest,
    targetInstallAttempt: assertCanonicalUntrackedRelocationAuthorityAttempt(value.targetInstallAttempt),
    sourceQuarantineAttempt: value.sourceQuarantineAttempt === null ? null
      : assertCanonicalUntrackedRelocationAuthorityAttempt(value.sourceQuarantineAttempt),
  };
  if (core.schema !== "agentic-canonical-untracked-relocation-effect-intent/v3"
    || core.subjectDigest !== canonicalUntrackedRelocationSubject(normalized).subjectDigest
    || core.targetInstallAttempt.phase !== "target-install"
    || core.targetInstallAttempt.subjectDigest !== core.subjectDigest
    || (core.sourceQuarantineAttempt && (
      core.sourceQuarantineAttempt.phase !== "source-quarantine"
      || core.sourceQuarantineAttempt.subjectDigest !== core.subjectDigest
    ))
    || value.intentDigest !== digestValue(core)
    || digestValue(value) !== digestValue({ ...core, intentDigest: value.intentDigest })) {
    throw new Error("Relocation effect intent is invalid or belongs to another plan.");
  }
  return Object.freeze(value);
}

export function readCanonicalUntrackedRelocationReceipt(plan) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const receiptPath = canonicalUntrackedRelocationOperationLayout(normalized).receiptPath;
  if (!existsSync(receiptPath)) return null;
  const receipt = assertCanonicalUntrackedRelocationReceipt(
    readJsonBounded(
      receiptPath,
      "relocation receipt",
      normalized.evidence.recovery.directory,
    ),
    normalized,
  );
  return Object.freeze({ ...receipt, receiptPath });
}

export function writeCanonicalUntrackedRelocationReceipt(plan, receipt) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const validated = assertCanonicalUntrackedRelocationReceipt(receipt, normalized);
  const receiptPath = canonicalUntrackedRelocationOperationLayout(normalized).receiptPath;
  writeJsonAtomic(receiptPath, validated, {
    exclusive: true,
    ownedRoot: normalized.evidence.recovery.directory,
  });
  return Object.freeze({ ...validated, receiptPath });
}

export function preflightCanonicalUntrackedRecoveryManifest(recovery) {
  const root = path.resolve(recovery);
  requireOwnedDirectory(root, "recovery directory");
  for (const name of ["tracked.patch", ".complete"]) {
    const file = path.join(root, name); requireOwnedAncestors(root, file);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_JSON_BYTES)
      throw new Error(`Recovery ${name} must be a bounded regular file.`);
  }
  const source = readJsonBounded(path.join(root, "manifest.json"), "recovery manifest", root);
  const entries = [...(source.tracked || []), ...(source.untracked || [])];
  if (entries.length === 0 || entries.length > MAX_PATHS) throw new Error("Recovery path count is unbounded.");
  let total = 0;
  for (const entry of entries) {
    if (entry.kind === "deleted") continue;
    const file = inside(path.join(root, "files"), safeRelative(entry.path));
    requireOwnedAncestors(root, file);
    const size = lstatSync(file).size;
    if (size > MAX_FILE_BYTES || (total += size) > MAX_TOTAL_BYTES) {
      throw new Error("Recovery bytes exceed relocation bounds.");
    }
  }
}

export function normalizeCanonicalUntrackedRelocationEntries(entries, recovery) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_PATHS) {
    throw new Error("Recovery contains an invalid untracked path count.");
  }
  return Object.freeze(entries.map(entry => {
    if (entry.ownership !== "untracked" || entry.kind !== "file"
      || !Number.isInteger(entry.mode) || !/^[0-9a-f]{64}$/u.test(entry.digest)) {
      throw new Error("Canonical relocation supports bounded regular-file recovery entries only.");
    }
    const relative = safeRelative(entry.path);
    const file = inside(path.join(recovery, "files"), relative);
    requireOwnedAncestors(recovery, file);
    requireStableFile(file, { ...entry, path: relative });
    return Object.freeze({ path: relative, mode: entry.mode, digest: entry.digest });
  }).sort((left, right) => left.path.localeCompare(right.path)));
}

export function canonicalRelocationDirectoryState(root, entries, subtree) {
  if (!existsSync(root)) return "absent";
  try {
    requireCanonicalRelocationDirectoryExact(root, entries, subtree, "transaction directory");
    return "exact";
  } catch {
    return "drifted";
  }
}

export function requireCanonicalRelocationDirectoryExact(root, entries, subtree, label) {
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  const observed = listRegularFiles(root).sort();
  const expected = entries.map(entry => path.posix.relative(subtree, entry.path)).sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`${label} path set differs from the recovery package.`);
  }
  for (const entry of entries) {
    requireStableFile(inside(root, path.posix.relative(subtree, entry.path)), entry);
  }
}

export function canonicalRelocationContentDigest(entries) {
  return digestValue(entries.map(({ path: relativePath, mode, digest }) => ({
    path: relativePath,
    mode,
    digest,
  })));
}

export function canonicalRelocationCommonParent(paths) {
  const parents = paths.map(item => safeRelative(path.posix.dirname(item)).split("/"));
  const shared = [];
  for (let index = 0; index < Math.min(...parents.map(parts => parts.length)); index += 1) {
    if (!parents.every(parts => parts[index] === parents[0][index])) break;
    shared.push(parents[0][index]);
  }
  if (shared.length === 0) throw new Error("Recovery paths must share one non-root subtree.");
  return shared.join("/");
}

export function requireCanonicalUntrackedRelocationEffectDevices({ plan, entries }, dependencies = {}) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  const subtree = normalized.evidence.source.subtree;
  const sourceRoot = path.join(normalized.evidence.source.worktree, subtree);
  const targetRoot = path.join(normalized.evidence.target.worktree, subtree);
  const sourceState = canonicalRelocationDirectoryState(sourceRoot, entries, subtree);
  const targetState = canonicalRelocationDirectoryState(targetRoot, entries, subtree);
  const quarantineState = canonicalRelocationDirectoryState(layout.quarantinePath, entries, subtree);
  const stat = dependencies.stat || statSync;
  if (sourceState !== "exact" || quarantineState !== "absent") return;
  if (targetState === "absent") {
    requireCanonicalRelocationSameDevice([layout.stagePath, path.dirname(targetRoot)], stat);
  }
  if (targetState === "absent" || targetState === "exact") {
    requireCanonicalRelocationSameDevice([sourceRoot, layout.transactionRoot], stat);
  }
}

function prepareStage({ stage, entries, recoveryDirectory, subtree }) {
  if (canonicalRelocationDirectoryState(stage, entries, subtree) === "exact") return;
  const temporary = mkdtempSync(`${stage}.tmp-`);
  for (const entry of entries) {
    const relative = path.posix.relative(subtree, entry.path);
    const target = inside(temporary, relative);
    ensureOwnedDirectory(temporary, path.dirname(target));
    const source = inside(path.join(recoveryDirectory, "files"), entry.path);
    requireOwnedAncestors(recoveryDirectory, source);
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    chmodSync(target, entry.mode);
    syncFile(target);
    syncDirectory(path.dirname(target));
  }
  requireCanonicalRelocationDirectoryExact(temporary, entries, subtree, "temporary relocation stage");
  syncDirectory(temporary);
  if (existsSync(stage)) {
    renameSync(stage, `${stage}.retained-${randomUUID()}`);
    syncDirectory(path.dirname(stage));
  }
  renameSync(temporary, stage);
  syncDirectory(path.dirname(stage));
}

function ensureImmutableJson(file, value, label, ownedRoot) {
  if (!existsSync(file)) {
    writeJsonAtomic(file, value, { exclusive: true, ownedRoot });
    return value;
  }
  const current = readJsonBounded(file, label, ownedRoot);
  if (digestValue(current) !== digestValue(value)) throw new Error(`${label} drifted.`);
  return current;
}

function writeJsonAtomic(output, value, {
  exclusive = false,
  replace = false,
  ownedRoot,
} = {}) {
  if (exclusive === replace) throw new Error("Atomic JSON publication mode is invalid.");
  if (!ownedRoot) throw new Error("Atomic JSON publication requires one owned root.");
  ensureOwnedDirectory(ownedRoot, path.dirname(output));
  const temporary = `${output}.tmp-${randomUUID()}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${canonicalJson(value)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (exclusive) {
    linkSync(temporary, output);
    unlinkSync(temporary);
  } else {
    renameSync(temporary, output);
  }
  syncDirectory(path.dirname(output));
}

function readJsonBounded(file, label, ownedRoot) {
  if (!ownedRoot) throw new Error(`${label} requires one owned root.`);
  requireOwnedAncestors(ownedRoot, file);
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 2 || before.size > MAX_JSON_BYTES) {
    throw new Error(`${label} must be a bounded regular file.`);
  }
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let value, opened, after;
  try { opened = fstatSync(descriptor); value = JSON.parse(readFileSync(descriptor, "utf8"));
    after = fstatSync(descriptor); } catch { throw new Error(`${label} is malformed or unsafe.`); }
  finally { closeSync(descriptor); }
  if (before.dev !== opened.dev || before.ino !== opened.ino || before.size !== opened.size
    || before.mtimeMs !== opened.mtimeMs || opened.dev !== after.dev
    || opened.ino !== after.ino || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs)
    throw new Error(`${label} changed while read.`);
  return value;
}

function listRegularFiles(root, prefix = "", output = [], state = { visited: 0 }) {
  if ((state.visited += 1) > MAX_PATHS * 4 || output.length > MAX_PATHS) {
    throw new Error("Relocation directory path count is unbounded.");
  }
  for (const item of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error("Relocation directories cannot contain symlinks.");
    if (item.isDirectory()) listRegularFiles(root, relative, output, state);
    else if (item.isFile()) output.push(relative);
    else throw new Error("Relocation directories contain an unsupported file type.");
  }
  return output;
}

function requireStableFile(file, entry) {
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || Number(before.size) > MAX_FILE_BYTES || Number(before.mode & 0o777n) !== entry.mode) {
    throw new Error(`Relocation file type, links, size, or mode changed: ${entry.path}`);
  }
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, Number(opened.size) - offset), offset);
      if (count === 0) throw new Error(`Relocation file read ended early: ${entry.path}`);
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1n
      || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs
      || Number(after.mode & 0o777n) !== entry.mode || hash.digest("hex") !== entry.digest) {
      throw new Error(`Relocation file bytes changed: ${entry.path}`);
    }
  } finally {
    closeSync(descriptor);
  }
}

function ensureOwnedDirectory(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget !== normalizedRoot
    && !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("Relocation directory escaped its owned root.");
  }
  requireOwnedDirectory(normalizedRoot, "relocation owned root");
  const relative = path.relative(normalizedRoot, normalizedTarget);
  let current = normalizedRoot;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 });
      syncDirectory(path.dirname(current));
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current) {
      throw new Error("Relocation directory has an unsafe ancestor.");
    }
  }
}

function requireOwnedAncestors(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget === normalizedRoot
    || !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("Relocation path escaped its owned root.");
  }
  requireOwnedDirectory(normalizedRoot, "relocation owned root");
  const parent = path.dirname(normalizedTarget);
  let current = normalizedRoot;
  for (const part of path.relative(normalizedRoot, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    requireOwnedDirectory(current, "relocation path ancestor");
  }
}

function requireOwnedDirectory(directory, label) {
  const normalized = path.resolve(directory);
  const stat = lstatSync(normalized);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(normalized) !== normalized) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
  return normalized;
}

function requireRecoveryDirectory(plan, recoveryDirectory) {
  const expected = plan.evidence.recovery.directory;
  if (path.resolve(recoveryDirectory) !== expected) {
    throw new Error("Relocation recovery directory drifted from the plan.");
  }
  requireOwnedDirectory(expected, "relocation recovery directory");
}

function safeRelative(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized)
    || normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Relocation paths must be normalized repository-relative paths.");
  }
  return normalized;
}

function inside(root, relativePath) {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, safeRelative(relativePath));
  if (target === normalizedRoot || !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("Relocation path escaped its owned root.");
  }
  return target;
}

function syncFile(file) { const descriptor = openSync(file, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }

function syncDirectory(directory) { const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }

export function requireCanonicalRelocationSameDevice(paths, inspect = statSync) {
  const devices = paths.map(item => inspect(item).dev);
  if (!devices.every(device => device === devices[0])) {
    throw new Error("Canonical relocation requires source, target, and recovery on one filesystem.");
  }
}
