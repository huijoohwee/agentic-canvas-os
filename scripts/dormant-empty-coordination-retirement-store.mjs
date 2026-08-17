// Responsibility: provide one durable external intent CAS and subject operation lock.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeDormantEmptyCoordinationRetirementIntent } from
  "./dormant-empty-coordination-retirement-contract.mjs";

export function createDormantEmptyCoordinationRetirementStore({
  statePath,
  now = () => new Date(),
}) {
  const journalPath = safeStatePath(statePath);
  const root = path.dirname(journalPath);
  const lockPath = `${journalPath}.lock`;

  function readIntent() {
    const value = readJson(journalPath);
    return value === null ? null : normalizeDormantEmptyCoordinationRetirementIntent(value);
  }

  function writeIntent({ expectedIntent, nextIntent }) {
    const expected = expectedIntent === null ? null
      : normalizeDormantEmptyCoordinationRetirementIntent(expectedIntent);
    const next = normalizeDormantEmptyCoordinationRetirementIntent(nextIntent);
    const current = readIntent();
    if ((current?.intentDigest || null) !== (expected?.intentDigest || null)) {
      throw new Error("Retirement journal changed before its exact compare-and-swap.");
    }
    if (current && current.intentDigest === next.intentDigest) return current;
    if (current && current.planDigest !== next.planDigest) {
      throw new Error("A different retirement plan owns this journal.");
    }
    writeAtomic(journalPath, next);
    return next;
  }

  async function withOperationLock(context, action) {
    if (typeof action !== "function") throw new Error("Retirement operation action is required.");
    mkdirDurable(root);
    const owner = acquireLock(lockPath, normalizeContext(context), now);
    try { return await action(); } finally { releaseLock(lockPath, owner); }
  }

  return Object.freeze({ statePath: journalPath, readIntent, writeIntent, withOperationLock });
}

function acquireLock(file, context, now) {
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error("Retirement controller process identity is unavailable.");
  const owner = Object.freeze({ pid: process.pid, processIdentity: identity,
    token: randomUUID(), acquiredAt: instant(now(), "lock acquisition time"),
    context, contextDigest: digestValue(context) });
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
    if (!validOwner(observed)) throw new Error("Retirement operation lock is malformed.");
    const observedIdentity = processIdentity(observed.pid);
    if (observedIdentity === observed.processIdentity) {
      throw new Error("Retirement operation is locked by a live controller.");
    }
    if (!observedIdentity && processExists(observed.pid)) {
      throw new Error("Retirement lock owner identity cannot be verified.");
    }
    const stale = `${file}.stale.${randomUUID()}`;
    renameSync(file, stale);
    const moved = readJson(stale);
    if (moved?.token !== observed.token) {
      if (!existsSync(file)) renameSync(stale, file);
      throw new Error("Retirement operation lock changed during stale-owner recovery.");
    }
    unlinkSync(stale);
    fsyncDirectory(path.dirname(file));
  }
  throw new Error("Retirement operation lock could not be acquired.");
}

function releaseLock(file, owner) {
  const observed = readJson(file);
  if (observed?.token !== owner.token || observed.contextDigest !== owner.contextDigest) {
    throw new Error("Retirement operation lock ownership changed before release.");
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
      throw new Error("Retirement journal storage is unsafe.");
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
    throw new Error("Retirement journal directory is unsafe.");
  }
}

function safeStatePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.normalize(value) !== value || path.extname(value) !== ".json") {
    throw new Error("Retirement state path must be an absolute normalized JSON path.");
  }
  const requestedParent = path.dirname(value);
  let existingAncestor = requestedParent;
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error("Retirement state parent is unavailable.");
    existingAncestor = parent;
  }
  const realAncestor = realpathSync(existingAncestor);
  const result = path.join(realAncestor, path.relative(existingAncestor, requestedParent),
    path.basename(value));
  if (existsSync(result) && lstatSync(result).isSymbolicLink()) {
    throw new Error("Retirement state path cannot be a symbolic link.");
  }
  return result;
}

function normalizeContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Retirement operation context is invalid.");
  }
  return Object.freeze(JSON.parse(canonicalJson(value)));
}
function validOwner(value) { return value && Number.isSafeInteger(value.pid) && value.pid > 0
  && typeof value.processIdentity === "string" && value.processIdentity.length > 0
  && typeof value.token === "string" && value.token.length > 0
  && value.context && value.contextDigest === digestValue(value.context); }
function instant(value, label) { const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`); return date.toISOString(); }
function processIdentity(pid) {
  try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="],
    { encoding: "utf8" }).trim() || null; } catch { return null; }
}
function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false; return true; }
}
function fsyncDirectory(directory) { const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
