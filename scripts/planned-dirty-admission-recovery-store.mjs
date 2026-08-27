// Responsibility: Persist one private digest-bound planned-dirty replay journal with CAS.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeRecoveryIntent }
  from "./planned-dirty-admission-recovery-contract.mjs";

const JOURNAL_SCHEMA = "agentic-planned-dirty-admission-recovery-journal/v1";

export function resolvePlannedDirtyAdmissionRecoveryJournalPath({
  commonDirectory,
  branch,
  planDigest,
} = {}) {
  const common = path.resolve(required(commonDirectory, "Git common directory"));
  const key = digestValue({
    branch: required(branch, "branch"),
    planDigest: digest(planDigest, "plan digest"),
  });
  const target = path.join(
    common,
    "agentic-canvas-os",
    "planned-dirty-admission-recovery",
    `${key}.json`,
  );
  assertWithin(common, target);
  return target;
}

export function createPlannedDirtyAdmissionRecoveryStore({ statePath } = {}) {
  const target = requireAbsolute(statePath, "journal path");
  const root = path.dirname(target);
  const writeLockPath = `${target}.write.lock`;
  const entrypointLockPath = `${target}.entrypoint.lock`;

  function read() {
    requireSafeRoot(root);
    if (!existsSync(target)) return null;
    requirePrivateFile(target, "recovery journal");
    const wrapper = parseJson(target, "recovery journal");
    if (wrapper?.schema !== JOURNAL_SCHEMA
      || wrapper.intentDigest !== digestValue(wrapper.intent)) {
      invalid("journal wrapper digest");
    }
    return normalizeRecoveryIntent(wrapper.intent);
  }

  function write({ expected, next } = {}) {
    ensureRoot(root);
    const lock = acquire(writeLockPath);
    try {
      const current = read();
      const normalizedExpected = expected === null
        ? null : normalizeRecoveryIntent(expected);
      if (canonicalJson(current) !== canonicalJson(normalizedExpected)) {
        invalid("journal CAS");
      }
      const intent = normalizeRecoveryIntent(next);
      const wrapper = {
        schema: JOURNAL_SCHEMA,
        intent,
        intentDigest: digestValue(intent),
      };
      writeAtomic(target, wrapper);
      return intent;
    } finally {
      release(writeLockPath, lock);
    }
  }

  async function withLock(action) {
    if (typeof action !== "function") invalid("entrypoint callback");
    ensureRoot(root);
    const lock = acquire(entrypointLockPath);
    try {
      return await action();
    } finally {
      release(entrypointLockPath, lock);
    }
  }

  return Object.freeze({ statePath: target, read, write, withLock });
}

function acquire(lockPath) {
  const owner = {
    schema: "agentic-planned-dirty-admission-recovery-lock/v1",
    pid: process.pid,
    token: randomUUID(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(owner));
      fsyncSync(descriptor);
      return Object.freeze({ descriptor, token: owner.token });
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        try { unlinkSync(lockPath); } catch {}
      } else if (attempt === 0 && error?.code === "EEXIST"
        && reclaimDeadOwnerLock(lockPath)) {
        continue;
      }
      throw new Error(`Planned-dirty admission recovery journal is locked: ${error.message}`);
    }
  }
  invalid("lock acquisition");
}

function reclaimDeadOwnerLock(lockPath) {
  requirePrivateFile(lockPath, "recovery lock");
  const owner = parseJson(lockPath, "recovery lock");
  if (owner?.schema !== "agentic-planned-dirty-admission-recovery-lock/v1"
    || !Number.isSafeInteger(owner.pid) || owner.pid < 1
    || typeof owner.token !== "string" || !owner.token) invalid("recovery lock owner");
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
  }
  const current = parseJson(lockPath, "recovery lock");
  if (current.token !== owner.token || current.pid !== owner.pid) return false;
  try { unlinkSync(lockPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  syncDirectory(path.dirname(lockPath));
  return true;
}

function release(lockPath, lock) {
  closeSync(lock.descriptor);
  requirePrivateFile(lockPath, "recovery lock");
  const owner = existsSync(lockPath) ? parseJson(lockPath, "recovery lock") : null;
  if (owner?.token !== lock.token) {
    throw new Error("Planned-dirty admission recovery lock ownership changed.");
  }
  unlinkSync(lockPath);
  syncDirectory(path.dirname(lockPath));
}

function writeAtomic(target, value) {
  const root = path.dirname(target);
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
    syncDirectory(root);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  requirePrivateFile(target, "recovery journal");
}

function ensureRoot(root) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  requireDirectory(root, "recovery journal directory");
}
function requireSafeRoot(root) {
  if (existsSync(root)) requireDirectory(root, "recovery journal directory");
}
function requireDirectory(candidate, label) {
  const metadata = lstatSync(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) invalid(label);
}
function requirePrivateFile(candidate, label) {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600) invalid(label);
}
function parseJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} is invalid: ${error.message}`); }
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function assertWithin(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    invalid("journal path");
  }
}
function requireAbsolute(value, label) {
  const source = required(value, label);
  if (!path.isAbsolute(source)) invalid(label);
  return path.resolve(source);
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Planned-dirty admission recovery store has invalid ${label}.`);
}
