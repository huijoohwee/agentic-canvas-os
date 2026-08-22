// Responsibility: Persist one digest-bound replay journal beneath the source Git common directory.
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeRecoveryIntent } from "./planned-owned-dirt-scope-expansion-recovery-contract.mjs";

const JOURNAL_SCHEMA = "agentic-planned-owned-dirt-scope-expansion-journal/v1";

export function resolvePlannedOwnedDirtScopeExpansionJournalPath({
  commonDirectory, claimId, planDigest,
}) {
  const root = path.resolve(required(commonDirectory, "Git common directory"));
  const target = path.join(root, "agentic-canvas-os",
    "planned-owned-dirt-scope-expansion-recovery",
    `${digest(claimId, "claim ID")}.${digest(planDigest, "plan digest")}.json`);
  assertWithin(root, target);
  return target;
}

export function createPlannedOwnedDirtScopeExpansionStore({ statePath }) {
  const target = path.resolve(required(statePath, "journal path"));
  const lockPath = `${target}.lock`;
  const entrypointLockPath = `${target}.entrypoint.lock`;
  return Object.freeze({
    statePath: target,
    async withLock(action) {
      if (typeof action !== "function") invalid("entrypoint callback");
      const release = acquireLock(entrypointLockPath);
      try { return await action(); } finally { release(); }
    },
    read() {
      if (!existsSync(target)) return null;
      requireRegular(target, "journal");
      const wrapper = JSON.parse(readFileSync(target, "utf8"));
      if (wrapper?.schema !== JOURNAL_SCHEMA
        || wrapper.intentDigest !== digestValue(wrapper.intent)) invalid("journal digest");
      return normalizeRecoveryIntent(wrapper.intent);
    },
    write({ expected, next }) {
      const release = acquireLock(lockPath);
      try {
        const current = this.read();
        if (nullableDigest(current) !== nullableDigest(expected)) invalid("journal CAS");
        const intent = normalizeRecoveryIntent(next);
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
        const descriptor = openSync(temporary, "wx", 0o600);
        try {
          writeFileSync(descriptor, `${JSON.stringify({ schema: JOURNAL_SCHEMA,
            intent, intentDigest: digestValue(intent) }, null, 2)}\n`);
        } finally { closeSync(descriptor); }
        renameSync(temporary, target);
        return intent;
      } finally { release(); }
    },
  });
}

function acquireLock(lockPath) {
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor;
  try { descriptor = openSync(lockPath, "wx", 0o600); }
  catch (error) { throw new Error(`Planned-owned-dirt recovery journal is locked: ${error.message}`); }
  writeFileSync(descriptor, `${process.pid}\n`); closeSync(descriptor);
  return () => { if (existsSync(lockPath)) unlinkSync(lockPath); };
}
function requireRegular(target, label) {
  const status = lstatSync(target); if (!status.isFile() || status.isSymbolicLink()) invalid(label);
}
function assertWithin(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) invalid("journal path");
}
function nullableDigest(value) { return value === null ? null : digestValue(value); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function invalid(label) { throw new Error(`Planned-owned-dirt recovery store has invalid ${label}.`); }
