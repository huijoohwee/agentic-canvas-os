// Responsibility: serialize one private operation with durable dead-owner recovery.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

const LOCK_SCHEMA = "agentic-private-operation-lock/v1";
const LOCK_KEYS = Object.freeze([
  "acquiredAt",
  "context",
  "contextDigest",
  "pid",
  "processIdentity",
  "schema",
  "token",
]);
const MAX_ATTEMPTS = 3;
const MAX_LOCK_BYTES = 64 * 1024;

export async function withPrivateOperationLock({
  file,
  context,
  action,
  now = () => new Date(),
  processIdentity = readProcessStartIdentity,
  processExists = defaultProcessExists,
} = {}) {
  const lockPath = normalizeLockPath(file);
  if (typeof action !== "function") throw new Error("Private operation lock action is required.");
  if (typeof now !== "function" || typeof processIdentity !== "function"
    || typeof processExists !== "function") {
    throw new Error("Private operation lock dependencies are invalid.");
  }
  const normalizedContext = normalizeContext(context);
  ensureParentDirectory(path.dirname(lockPath));
  const currentIdentity = normalizeProcessIdentity(processIdentity(process.pid));
  if (!currentIdentity) {
    throw new Error("Private operation lock cannot establish its process identity.");
  }
  const owner = Object.freeze({
    schema: LOCK_SCHEMA,
    pid: process.pid,
    processIdentity: currentIdentity,
    token: randomUUID(),
    acquiredAt: normalizeInstant(now()),
    context: normalizedContext,
    contextDigest: digestValue(normalizedContext),
  });
  requireBoundedOwner(owner);
  const acquired = acquirePrivateOperationLock({ lockPath, owner, processIdentity, processExists });
  try {
    return await action(owner);
  } finally {
    releasePrivateOperationLock(lockPath, acquired);
  }
}

export function readPrivateOperationLock(file) {
  const record = readLockRecord(normalizeLockPath(file), { absent: true });
  return record?.owner || null;
}

function acquirePrivateOperationLock({ lockPath, owner, processIdentity, processExists }) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return createOwnedLock(lockPath, owner);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    let observed;
    try { observed = readLockRecord(lockPath); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const liveIdentity = normalizeProcessIdentity(processIdentity(observed.owner.pid));
    if (liveIdentity === observed.owner.processIdentity) {
      throw new Error("Private operation lock is owned by a live process.");
    }
    if (!liveIdentity && processExists(observed.owner.pid) !== false) {
      throw new Error("Private operation lock owner identity is ambiguous.");
    }
    const acquired = captureDeadOwner({ lockPath, observed, owner });
    if (acquired) return acquired;
  }
  throw new Error("Private operation lock could not be acquired after bounded recovery.");
}

function captureDeadOwner({ lockPath, observed, owner }) {
  const directory = path.dirname(lockPath);
  const stalePath = `${lockPath}.stale.${randomUUID()}`;
  try {
    renameSync(lockPath, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  syncDirectory(directory);
  const captured = readLockRecord(stalePath);
  if (!sameRecord(observed, captured)) {
    restoreCapture(stalePath, lockPath);
    throw new Error("Private operation lock changed during dead-owner capture.");
  }
  let acquired;
  try {
    acquired = createOwnedLock(lockPath, owner);
  } catch (error) {
    if (error?.code === "EEXIST") {
      removeExactRecord(stalePath, captured);
      syncDirectory(directory);
      return null;
    }
    if (!existsSync(lockPath)) restoreCapture(stalePath, lockPath);
    else {
      removeExactRecord(stalePath, captured);
      syncDirectory(directory);
    }
    throw error;
  }
  try {
    removeExactRecord(stalePath, captured);
    syncDirectory(directory);
    return acquired;
  } catch (error) {
    try { releasePrivateOperationLock(lockPath, acquired); } catch {}
    throw error;
  }
}

function releasePrivateOperationLock(lockPath, expected) {
  const observed = readLockRecord(lockPath);
  if (!sameRecord(observed, expected)) {
    throw new Error("Private operation lock ownership changed before release.");
  }
  const releasePath = `${lockPath}.release.${expected.owner.token}.${randomUUID()}`;
  try {
    renameSync(lockPath, releasePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Private operation lock disappeared before release.");
    }
    throw error;
  }
  syncDirectory(path.dirname(lockPath));
  const captured = readLockRecord(releasePath);
  if (!sameRecord(expected, captured)) {
    restoreCapture(releasePath, lockPath);
    throw new Error("Private operation lock changed during release capture.");
  }
  removeExactRecord(releasePath, captured);
  syncDirectory(path.dirname(lockPath));
}

function createOwnedLock(file, owner) {
  const descriptor = openSync(file, "wx", 0o600);
  const created = fstatSync(descriptor);
  let closed = false;
  try {
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${canonicalJson(owner)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    closed = true;
    syncDirectory(path.dirname(file));
    const observed = readLockRecord(file);
    if (!sameInode(created, observed.stat) || digestValue(observed.owner) !== digestValue(owner)) {
      throw new Error("Private operation lock changed during durable acquisition.");
    }
    return Object.freeze({ owner, stat: created });
  } catch (error) {
    if (!closed) {
      try { closeSync(descriptor); } catch {}
    }
    try {
      const current = lstatSync(file);
      if (sameInode(created, current)) {
        unlinkSync(file);
        syncDirectory(path.dirname(file));
      }
    } catch {}
    throw error;
  }
}

function readLockRecord(file, { absent = false } = {}) {
  let before;
  try {
    before = lstatSync(file);
  } catch (error) {
    if (absent && error?.code === "ENOENT") return null;
    throw error;
  }
  requirePrivateRegularFile(file, before);
  if (before.size < 2 || before.size > MAX_LOCK_BYTES) {
    throw new Error("Private operation lock size is invalid.");
  }
  const bytes = readFileSync(file, "utf8");
  const after = lstatSync(file);
  if (!sameSnapshot(before, after)) {
    throw new Error("Private operation lock changed while it was read.");
  }
  let value;
  try { value = JSON.parse(bytes); }
  catch { throw new Error("Private operation lock is malformed."); }
  const owner = normalizeOwner(value);
  if (bytes !== `${canonicalJson(owner)}\n`) {
    throw new Error("Private operation lock bytes are not canonical.");
  }
  return Object.freeze({ owner, stat: after });
}

function normalizeOwner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson(LOCK_KEYS)) {
    throw new Error("Private operation lock is malformed.");
  }
  if (value.schema !== LOCK_SCHEMA || !Number.isSafeInteger(value.pid) || value.pid < 1
    || !normalizeProcessIdentity(value.processIdentity)
    || typeof value.token !== "string" || value.token.length < 1 || value.token.length > 128
    || normalizeInstant(value.acquiredAt) !== value.acquiredAt) {
    throw new Error("Private operation lock owner is invalid.");
  }
  const context = normalizeContext(value.context);
  if (value.contextDigest !== digestValue(context)) {
    throw new Error("Private operation lock context digest is invalid.");
  }
  const owner = Object.freeze({ ...value, context });
  requireBoundedOwner(owner);
  return owner;
}

function requireBoundedOwner(owner) {
  const size = Buffer.byteLength(`${canonicalJson(owner)}\n`, "utf8");
  if (size < 2 || size > MAX_LOCK_BYTES) {
    throw new Error("Private operation lock size is invalid.");
  }
}

function requirePrivateRegularFile(file, stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || realpathSync(file) !== file
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Private operation lock must be an owner-private regular file.");
  }
}

function restoreCapture(capturedPath, lockPath) {
  if (existsSync(lockPath)) {
    throw new Error("Private operation lock capture cannot be restored over a new owner.");
  }
  renameSync(capturedPath, lockPath);
  syncDirectory(path.dirname(lockPath));
}

function removeExactRecord(file, expected) {
  const current = readLockRecord(file);
  if (!sameRecord(expected, current)) {
    throw new Error("Private operation lock capture ownership changed.");
  }
  unlinkSync(file);
}

function sameRecord(left, right) {
  return sameInode(left.stat, right.stat)
    && digestValue(left.owner) === digestValue(right.owner);
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left, right) {
  return sameInode(left, right) && left.size === right.size
    && left.mode === right.mode && left.mtimeMs === right.mtimeMs;
}

function normalizeLockPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value
    || value.includes("\0")) {
    throw new Error("Private operation lock path must be absolute and normalized.");
  }
  const requestedParent = path.dirname(value);
  let existingAncestor = requestedParent;
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error("Private operation lock parent is unavailable.");
    existingAncestor = parent;
  }
  const canonicalParent = path.join(realpathSync(existingAncestor),
    path.relative(existingAncestor, requestedParent));
  return path.join(canonicalParent, path.basename(value));
}

function ensureParentDirectory(directory) {
  const existed = existsSync(directory);
  if (!existed) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
    || (!existed && (stat.mode & 0o077) !== 0)
    || (!existed && typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Private operation lock parent directory is unsafe.");
  }
  if (!existed) syncDirectory(path.dirname(directory));
}

function normalizeContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Private operation lock context must be an object.");
  }
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Private operation lock time is invalid.");
  return date.toISOString();
}

function normalizeProcessIdentity(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() ? value : null;
}

function readProcessStartIdentity(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

function defaultProcessExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
