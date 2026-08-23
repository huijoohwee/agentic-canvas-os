// Responsibility: Persist external owner-only plans and replay journals atomically.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
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

import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeOrphanedTaskAuthorityRecoveryIntent,
  normalizeOrphanedTaskAuthorityRecoveryPlan,
} from "./orphaned-task-authority-recovery-contract.mjs";

const PHASES = [
  "prepared", "snapshotted", "local-cas", "pr-attempted",
  "pr-projected", "verified", "complete",
];

export function writeOrphanedTaskAuthorityRecoveryPlan({ repository, outputPath, plan }) {
  const target = externalPath({ repository, candidate: outputPath, label: "plan path" });
  const normalized = normalizeOrphanedTaskAuthorityRecoveryPlan(plan);
  ensureParent(path.dirname(target));
  if (existsSync(target)) throw new Error("Recovery plan output already exists.");
  writeExclusive(target, normalized);
  return normalized;
}

export function readOrphanedTaskAuthorityRecoveryPlan({ repository, planPath }) {
  const target = externalPath({ repository, candidate: planPath, label: "plan path" });
  requirePrivateFile(target, "recovery plan");
  return normalizeOrphanedTaskAuthorityRecoveryPlan(readJson(target, "recovery plan"));
}

export function createOrphanedTaskAuthorityRecoveryJournalStore({
  repository,
  statePath,
} = {}) {
  const target = externalPath({ repository, candidate: statePath, label: "journal path" });
  const root = path.dirname(target);
  const lockPath = `${target}.lock`;

  function read() {
    if (!existsSync(target)) return null;
    requirePrivateFile(target, "recovery journal");
    return normalizeOrphanedTaskAuthorityRecoveryIntent(
      readJson(target, "recovery journal"),
    );
  }

  function write(value) {
    const next = normalizeOrphanedTaskAuthorityRecoveryIntent(value);
    const current = read();
    if (current?.intentDigest === next.intentDigest) return current;
    if (!current && next.phase !== "prepared") {
      throw new Error("Recovery journal must begin at prepared.");
    }
    if (current?.phase === "complete") {
      throw new Error("Completed recovery journal is immutable.");
    }
    if (current && (current.planDigest !== next.planDigest
      || PHASES.indexOf(next.phase) !== PHASES.indexOf(current.phase) + 1)) {
      throw new Error("Recovery journal phase CAS failed.");
    }
    writeAtomic(target, next);
    return next;
  }

  async function withLock(action) {
    if (typeof action !== "function") throw new Error("Journal lock requires an action.");
    ensureParent(root);
    let descriptor;
    try { descriptor = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Another orphaned-authority recovery owns this journal.");
      }
      throw error;
    }
    try {
      writeFileSync(descriptor, `${process.pid}\n`);
      fsyncSync(descriptor);
      return await action();
    } finally {
      closeSync(descriptor);
      unlinkSync(lockPath);
      syncDirectory(root);
    }
  }

  return Object.freeze({ statePath: target, read, write, withLock });
}

function externalPath({ repository, candidate, label }) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  const source = requiredText(candidate, label);
  if (!path.isAbsolute(source)) throw new Error(`${label} must be absolute.`);
  const target = path.resolve(source);
  const parent = path.dirname(target);
  if (existsSync(parent) && realpathSync(parent) !== parent) {
    throw new Error(`${label} parent must be canonical.`);
  }
  const relative = path.relative(root, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error(`${label} must be outside the source repository.`);
  }
  return target;
}

function ensureParent(root) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("Recovery storage directory must be owner-only and non-symlink.");
  }
}

function writeExclusive(target, value) {
  ensureParent(path.dirname(target));
  const descriptor = openSync(target, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(path.dirname(target));
  requirePrivateFile(target, "recovery plan");
}

function writeAtomic(target, value) {
  ensureParent(path.dirname(target));
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
    syncDirectory(path.dirname(target));
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  requirePrivateFile(target, "recovery journal");
}

function requirePrivateFile(candidate, label) {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`${label} must be an owner-only regular file.`);
  }
}

function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} is invalid: ${error.message}`); }
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

export function sameRecoveryJournal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
