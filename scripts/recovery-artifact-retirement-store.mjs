// Responsibility: Persist retirement intent and receipt outside both recovery source and archive.
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export function createRecoveryArtifactRetirementStore({ commonDir, subjectKey,
  normalizeIntent, normalizeReceipt } = {}) {
  const directory = path.join(commonDir, "agentic-canvas-os", "recovery-artifact-retirement", subjectKey);
  const intentPath = path.join(directory, "intent.json");
  const receiptPath = path.join(directory, "receipt.json");
  const lockPath = path.join(directory, "subject.lock");
  assertSafeDirectory(commonDir, "Git common directory");
  return Object.freeze({
    directory,
    withSubjectFence(_plan, callback) {
      ensureJournalDirectory(commonDir, subjectKey);
      let descriptor;
      const token = randomUUID();
      try { descriptor = acquireLock({ lockPath, directory, subjectKey, token }); }
      catch (error) { if (error?.code === "EEXIST") {
        recoverDeadOwner({ lockPath, directory, subjectKey });
        descriptor = acquireLock({ lockPath, directory, subjectKey, token });
      } else throw error; }
      try { return callback(); }
      finally {
        closeSync(descriptor);
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        if (lock.token !== token) throw new Error("Retirement subject lock ownership drifted; lock retained.");
        unlinkSync(lockPath);
        syncDirectory(directory);
      }
    },
    readIntent() { return read(intentPath, normalizeIntent); },
    writeIntent(previous, next) { return cas(intentPath, previous, next, normalizeIntent); },
    readReceipt() { return read(receiptPath, normalizeReceipt); },
    writeReceipt(previous, next) { return cas(receiptPath, previous, next, normalizeReceipt); },
  });
}

function read(file, normalize) {
  if (!existsSync(file)) return null;
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 4 * 1024 * 1024
    || (stats.mode & 0o077) !== 0) throw new Error("Retirement journal file is unsafe or too large.");
  return normalize(JSON.parse(readFileSync(file, "utf8")));
}
function cas(file, previous, next, normalize) {
  const current = read(file, normalize);
  if (digestValue(current) !== digestValue(previous)) throw new Error("Retirement journal CAS conflict.");
  const normalized = normalize(next);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${process.hrtime.bigint()}`;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${canonicalJson(normalized)}\n`, "utf8"); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, file);
    const parent = openSync(path.dirname(file), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return read(file, normalize);
}
function assertSafeDirectory(directory, label) {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} is unsafe.`);
}
function ensureJournalDirectory(commonDir, subjectKey) {
  let parent = commonDir;
  for (const name of ["agentic-canvas-os", "recovery-artifact-retirement", subjectKey]) {
    const child = path.join(parent, name);
    if (!existsSync(child)) { mkdirSync(child, { mode: 0o700 }); syncDirectory(parent); }
    const stats = lstatSync(child);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Retirement journal directory is unsafe.");
    parent = child;
  }
}
function syncDirectory(directory) { const descriptor = openSync(directory, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function acquireLock({ lockPath, directory, subjectKey, token }) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, subjectKey, token })}\n`); fsyncSync(descriptor); syncDirectory(directory); return descriptor; }
  catch (error) { closeSync(descriptor); throw error; }
}
function recoverDeadOwner({ lockPath, directory, subjectKey }) {
  const before = lstatSync(lockPath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 4096) {
    throw new Error("Recovery artifact retirement lock is unsafe; owner recovery refused.");
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0 || lock.subjectKey !== subjectKey
    || typeof lock.token !== "string" || !lock.token) throw new Error("Retirement lock owner record is malformed.");
  try { process.kill(lock.pid, 0); throw new Error("Recovery artifact retirement subject is already locked."); }
  catch (error) { if (error?.message?.includes("already locked") || error?.code === "EPERM") throw error;
    if (error?.code !== "ESRCH") throw error; }
  const stalePath = `${lockPath}.stale-${lock.token}-${randomUUID()}`;
  renameSync(lockPath, stalePath);
  const after = lstatSync(stalePath);
  const moved = JSON.parse(readFileSync(stalePath, "utf8"));
  if (after.dev !== before.dev || after.ino !== before.ino || moved.token !== lock.token) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    throw new Error("Retirement lock changed during dead-owner recovery.");
  }
  syncDirectory(directory);
}
