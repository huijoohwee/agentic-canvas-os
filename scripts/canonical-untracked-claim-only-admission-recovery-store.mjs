// Responsibility: Persist one private, external, CAS-protected operation journal.
import { randomUUID } from "node:crypto";
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import { normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent }
  from "./canonical-untracked-claim-only-admission-recovery-contract.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";

export function createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore({ statePath } = {}) {
  const target = absolute(statePath, "journal path");
  const root = path.dirname(target);
  const lockPath = `${target}.lock`;
  function readIntent() {
    if (!pathEntryExists(target)) return null;
    privateFile(target, "recovery journal");
    return normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(parse(target));
  }
  function writeIntent({ expected, value }) {
    const normalized = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(value);
    const current = readIntent();
    const expectedValue = expected ? normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(expected) : null;
    if (canonicalJson(current) !== canonicalJson(expectedValue)) throw new Error("Claim-only recovery journal changed before CAS.");
    atomic(target, normalized, { createOnly: current === null });
    return normalized;
  }
  async function withOperationLock(callback) {
    if (typeof callback !== "function") throw new Error("Operation lock callback is required.");
    ensureRoot(root);
    return withPrivateOperationLock({
      file: lockPath,
      context: {
        operation: "canonical-untracked-claim-only-admission-recovery",
        statePath: target,
      },
      action: callback,
    });
  }
  return Object.freeze({ statePath: target, readIntent, writeIntent, withOperationLock });
}

export function writeCanonicalUntrackedClaimOnlyPrivateJson(outputPath, value, { replace = false } = {}) {
  const target = absolute(outputPath, "private JSON output path");
  ensureRoot(path.dirname(target));
  if (pathEntryExists(target)) {
    privateFile(target, "private JSON output");
    if (!replace || canonicalJson(JSON.parse(readFileSync(target, "utf8"))) !== canonicalJson(value)) {
      throw new Error("Private JSON output already exists.");
    }
    return target;
  }
  const descriptor = openSync(target, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  syncDirectory(path.dirname(target));
  privateFile(target, "private JSON output");
  return target;
}

function atomic(target, value, { createOnly = false } = {}) {
  const root = path.dirname(target); ensureRoot(root);
  if (createOnly) {
    const descriptor = openSync(target, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    syncDirectory(root);
    privateFile(target, "recovery journal");
    return;
  }
  privateFile(target, "recovery journal");
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  try { renameSync(temporary, target); syncDirectory(root); }
  catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  privateFile(target, "private JSON output");
}
function ensureRoot(root) { if (!pathEntryExists(root)) mkdirSync(root, { recursive: true, mode: 0o700 }); const stat = lstatSync(root); if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) throw new Error("Private state parent must be a canonical real directory."); }
function privateFile(file, label) { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw new Error(`${label} must be a private regular file.`); }
function pathEntryExists(file) { try { lstatSync(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function absolute(value, label) { if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be absolute.`); return path.resolve(value); }
function parse(file) { try { return JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new Error(`Recovery journal is invalid: ${error.message}`); } }
function syncDirectory(root) { const descriptor = openSync(root, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
