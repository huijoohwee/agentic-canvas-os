// Responsibility: Persist one private replay-safe recovery journal with exact CAS semantics.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizePlannedFenceOnlyAdmissionRecoveryIntent }
  from "./planned-fence-only-admission-recovery-contract.mjs";

export function createPlannedFenceOnlyAdmissionRecoveryStore({
  gitCommonDir,
  branch,
  statePath = null,
} = {}) {
  const common = path.resolve(requiredText(gitCommonDir, "Git common directory"));
  requireDirectory(common, "Git common directory");
  const branchName = requiredText(branch, "branch");
  const defaultRoot = path.join(common, "agentic-canvas-os", "planned-fence-only-admission-recovery");
  const target = statePath
    ? requireAbsolute(statePath, "journal path")
    : path.join(defaultRoot, `${digestValue({ branch: branchName })}.json`);
  const root = path.dirname(target);
  const lockPath = `${target}.lock`;

  function readIntent() {
    requireSafeRoot(root);
    if (!existsSync(target)) return null;
    requirePrivateFile(target, "recovery journal");
    return normalizePlannedFenceOnlyAdmissionRecoveryIntent(parseJson(target, "recovery journal"));
  }

  function writeIntent({ expected, value }) {
    const normalized = normalizePlannedFenceOnlyAdmissionRecoveryIntent(value);
    const current = readIntent();
    const expectedIntent = expected
      ? normalizePlannedFenceOnlyAdmissionRecoveryIntent(expected) : null;
    if (canonicalJson(current) !== canonicalJson(expectedIntent)) {
      throw new Error("Planned fence-only recovery journal changed before CAS.");
    }
    writeAtomic(target, normalized);
    return normalized;
  }

  async function withOperationLock(callback) {
    if (typeof callback !== "function") throw new Error("Recovery operation lock requires a callback.");
    ensureRoot(root);
    const lock = acquire(lockPath);
    try {
      return await callback();
    } finally {
      release(lockPath, lock);
    }
  }

  return Object.freeze({ readIntent, writeIntent, withOperationLock, statePath: target });
}

function ensureRoot(root) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  requireDirectory(root, "recovery journal directory");
}

function requireSafeRoot(root) {
  if (existsSync(root)) requireDirectory(root, "recovery journal directory");
}

function acquire(lockPath) {
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error("Recovery operation cannot establish its process identity.");
  const owner = Object.freeze({
    schema: "agentic-planned-fence-only-admission-recovery-lock/v1",
    pid: process.pid,
    processIdentity: identity,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      try { writeFileSync(descriptor, JSON.stringify(owner)); fsyncSync(descriptor); }
      catch (error) { closeSync(descriptor); try { unlinkSync(lockPath); } catch {} throw error; }
      syncDirectory(path.dirname(lockPath));
      return Object.freeze({ descriptor, token: owner.token });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const observed = readLock(lockPath);
    if (!observed) throw new Error("Recovery operation lock owner is invalid.");
    if (processIdentity(observed.pid) === observed.processIdentity) {
      throw new Error("Another planned fence-only recovery operation owns this journal.");
    }
    const stalePath = `${lockPath}.stale.${randomUUID()}`;
    renameSync(lockPath, stalePath);
    const moved = readLock(stalePath);
    if (moved?.token !== observed.token) {
      if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
      throw new Error("Recovery operation lock changed during stale-owner recovery.");
    }
    unlinkSync(stalePath);
    syncDirectory(path.dirname(lockPath));
  }
  throw new Error("Recovery operation lock could not be acquired.");
}

function release(lockPath, lock) {
  closeSync(lock.descriptor);
  const owner = readLock(lockPath);
  if (owner?.token !== lock.token) throw new Error("Recovery operation lock ownership changed.");
  unlinkSync(lockPath);
  syncDirectory(path.dirname(lockPath));
}

function writeAtomic(target, value) {
  const root = path.dirname(target);
  ensureRoot(root);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, target);
    const directory = openSync(root, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  requirePrivateFile(target, "recovery journal");
}

function parseJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} is invalid: ${error.message}`); }
}
function readLock(file) {
  try {
    requirePrivateFile(file, "recovery operation lock");
    const value = JSON.parse(readFileSync(file, "utf8"));
    const keys = ["createdAt", "pid", "processIdentity", "schema", "token"];
    if (JSON.stringify(Object.keys(value || {}).sort()) !== JSON.stringify(keys)
      || value?.schema !== "agentic-planned-fence-only-admission-recovery-lock/v1"
      || !Number.isSafeInteger(value.pid) || value.pid < 1
      || typeof value.processIdentity !== "string" || !value.processIdentity.trim()
      || typeof value.token !== "string" || !value.token.trim()
      || !canonicalInstant(value.createdAt)) {
      throw new Error("Recovery operation lock owner is invalid.");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
function processIdentity(pid) { try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; } }
function canonicalInstant(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; }
function syncDirectory(directory) { const descriptor = openSync(directory, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function requireDirectory(candidate, label) { const metadata = lstatSync(candidate); if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} must be a real directory.`); }
function requirePrivateFile(candidate, label) { const metadata = lstatSync(candidate); if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) throw new Error(`${label} must be a private regular file.`); }
function requireAbsolute(value, label) { const source = requiredText(value, label); if (!path.isAbsolute(source)) throw new Error(`${label} must be absolute.`); return path.resolve(source); }
function requiredText(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) throw new Error(`${label} is required.`); return value; }
