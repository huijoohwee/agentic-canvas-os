// Responsibility: Persist one lane-convergence intent with a durable CAS and live-owner lock.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeLaneConvergenceIntent } from "./lane-convergence-transaction-contract.mjs";

export function createLaneConvergenceJournal({ statePath, plan, now = () => new Date() }) {
  const journalPath = safeStatePath(statePath);
  const root = path.dirname(journalPath);
  const lockPath = `${journalPath}.lock`;

  function readIntent() {
    const value = readJson(journalPath);
    return value === null ? null : normalizeLaneConvergenceIntent(value, plan);
  }

  function writeIntent({ expectedIntent, nextIntent }) {
    const expected = expectedIntent === null ? null : normalizeLaneConvergenceIntent(expectedIntent, plan);
    const next = normalizeLaneConvergenceIntent(nextIntent, plan);
    const current = readIntent();
    if ((current?.intentDigest || null) !== (expected?.intentDigest || null)) {
      throw new Error("Lane-convergence journal changed before compare-and-swap.");
    }
    if (current?.intentDigest === next.intentDigest) return current;
    if (current && current.planDigest !== next.planDigest) {
      throw new Error("A different lane-convergence plan owns this journal.");
    }
    writeAtomic(journalPath, next);
    return next;
  }

  async function withOperationLock(action) {
    if (typeof action !== "function") throw new Error("Lane-convergence lock action is required.");
    mkdirDurable(root);
    const owner = acquireLock(lockPath, { planDigest: plan.planDigest }, now);
    try { return await action(owner); } finally { releaseLock(lockPath, owner); }
  }

  return Object.freeze({ statePath: journalPath, readIntent, writeIntent, withOperationLock });
}

function acquireLock(file, context, now) {
  const processIdentity = readProcessIdentity(process.pid);
  if (!processIdentity) throw new Error("Lane-convergence process identity is unavailable.");
  const owner = Object.freeze({ pid: process.pid, processIdentity, token: randomUUID(),
    acquiredAt: instant(now()), context, contextDigest: digestValue(context) });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = openSync(file, "wx", 0o600);
      try { writeFileSync(descriptor, `${canonicalJson(owner)}\n`); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
      fsyncDirectory(path.dirname(file));
      return owner;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const observed = readJson(file);
    if (!validOwner(observed)) throw new Error("Lane-convergence operation lock is malformed.");
    const liveIdentity = readProcessIdentity(observed.pid);
    if (liveIdentity === observed.processIdentity) {
      throw new Error("Lane-convergence operation is locked by a live controller.");
    }
    if (!liveIdentity && processExists(observed.pid)) {
      throw new Error("Lane-convergence lock owner cannot be verified.");
    }
    const stale = `${file}.stale.${randomUUID()}`;
    renameSync(file, stale);
    const moved = readJson(stale);
    if (moved?.token !== observed.token) {
      if (!existsSync(file)) renameSync(stale, file);
      throw new Error("Lane-convergence lock changed during stale-owner recovery.");
    }
    unlinkSync(stale);
    fsyncDirectory(path.dirname(file));
  }
  throw new Error("Lane-convergence operation lock could not be acquired.");
}

function releaseLock(file, owner) {
  const observed = readJson(file);
  if (observed?.token !== owner.token || observed.contextDigest !== owner.contextDigest) {
    throw new Error("Lane-convergence lock ownership changed before release.");
  }
  unlinkSync(file);
  fsyncDirectory(path.dirname(file));
}

function writeAtomic(file, value) {
  mkdirDurable(path.dirname(file));
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, `${canonicalJson(value)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function readJson(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error("Lane-convergence journal storage is unsafe.");
    }
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function mkdirDurable(directory) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    fsyncDirectory(path.dirname(directory));
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Lane-convergence journal directory is unsafe.");
  }
}

function safeStatePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.normalize(value) !== value || path.extname(value) !== ".json") {
    throw new Error("Lane-convergence state path must be an absolute normalized JSON path.");
  }
  const requestedParent = path.dirname(value);
  let existingAncestor = requestedParent;
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error("Lane-convergence state parent is unavailable.");
    existingAncestor = parent;
  }
  const realAncestor = realpathSync(existingAncestor);
  const resolved = path.join(realAncestor, path.relative(existingAncestor, requestedParent), path.basename(value));
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new Error("Lane-convergence state path cannot be a symbolic link.");
  }
  return resolved;
}

function validOwner(value) { return value && Number.isSafeInteger(value.pid) && value.pid > 0
  && typeof value.processIdentity === "string" && value.processIdentity.length > 0
  && typeof value.token === "string" && value.token.length > 0
  && value.context && value.contextDigest === digestValue(value.context); }
function readProcessIdentity(pid) { try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="],
  { encoding: "utf8" }).trim() || null; } catch { return null; } }
function processExists(pid) { try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; } }
function fsyncDirectory(directory) { const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function instant(value) { const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Lane-convergence time is invalid."); return date.toISOString(); }
