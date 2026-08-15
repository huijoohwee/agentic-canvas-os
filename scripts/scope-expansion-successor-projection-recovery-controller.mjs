// Responsibility: Orchestrate one exact, journaled successor projection recovery.
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  PHASES,
  advanceScopeExpansionSuccessorProjectionRecoveryIntent,
  authorizeScopeExpansionSuccessorProjectionRecovery,
  buildScopeExpansionSuccessorProjectionRecoveryCompletion,
  buildScopeExpansionSuccessorProjectionRecoveryPlan,
  createScopeExpansionSuccessorProjectionRecoveryIntent,
  normalizeScopeExpansionSuccessorProjectionRecoveryPlan,
  normalizeScopeExpansionSuccessorProjectionRecoveryIntent,
  scopeExpansionSuccessorProjectionRecoveryOperationKey,
} from "./scope-expansion-successor-projection-recovery-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { scopeExpansionSuccessorProjectionRecoveryDecisionSubject }
  from "./scope-expansion-successor-projection-recovery-evidence.mjs";

const EFFECTS = Object.freeze({
  "task-authority-verified": "verifyTaskAuthority",
  "promotion-adopted": "adoptPromotion",
  "successor-bound": "bindSuccessor",
  "local-cas": "projectLocal",
  "pr-marker": "projectPullRequest",
  verified: "verifyTerminal",
  complete: "completeOriginalIntent",
});
const FRESH_CAPABILITY_PHASES = new Set([
  "successor-bound", "local-cas", "pr-marker", "complete",
]);
const METHODS = Object.freeze([
  "withFence", "readEvidence", "readIntent", "writeIntent", "reconcilePhase",
  "verifyCompleted",
  ...Object.values(EFFECTS),
]);
const JOURNAL_SCHEMA = "agentic-scope-expansion-successor-projection-recovery-journal/v1";
const MAX_JOURNAL_BYTES = 2_097_152;

export function createScopeExpansionSuccessorProjectionRecoveryController(adapter) {
  for (const name of METHODS) {
    if (typeof adapter?.[name] !== "function") {
      throw new Error(`Successor projection recovery adapter requires ${name}().`);
    }
  }
  return Object.freeze({
    async plan({ operatorSessionId } = {}) {
      const stored = await adapter.readIntent();
      if (stored) {
        const intent = normalizeScopeExpansionSuccessorProjectionRecoveryIntent(stored);
        if (intent.planSnapshot.operatorSessionId !== operatorSessionId) {
          throw new Error("Recovery journal is already owned by another operator session.");
        }
        return intent.planSnapshot;
      }
      return buildScopeExpansionSuccessorProjectionRecoveryPlan({
        evidence: await adapter.readEvidence(),
        operatorSessionId,
      });
    },
    async run({ plan: suppliedPlan, operatorSessionId, authorization } = {}) {
      return adapter.withFence(async () => {
        let intent = await adapter.readIntent();
        if (intent) {
          intent = normalizeScopeExpansionSuccessorProjectionRecoveryIntent(intent);
          const supplied = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(suppliedPlan);
          if (supplied.planDigest !== intent.planDigest) {
            throw new Error("Stored recovery plan differs from the caller-authorized plan.");
          }
          authorizeScopeExpansionSuccessorProjectionRecovery({ plan: intent.planSnapshot, authorization });
          if (intent.planSnapshot.operatorSessionId !== operatorSessionId) {
            throw new Error("Stored recovery operator differs from current authority.");
          }
        } else {
          const plan = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(suppliedPlan);
          if (plan.operatorSessionId !== operatorSessionId) {
            throw new Error("Caller-authorized recovery plan belongs to another operator.");
          }
          const currentEvidence = await adapter.readEvidence();
          const currentDecisionDigest = digestValue(
            scopeExpansionSuccessorProjectionRecoveryDecisionSubject(currentEvidence),
          );
          if (currentDecisionDigest !== plan.decisionSubjectDigest) {
            throw new Error("Caller-authorized recovery decision subject is no longer exact-current.");
          }
          intent = createScopeExpansionSuccessorProjectionRecoveryIntent(plan, authorization);
          await adapter.writeIntent({ expected: null, value: intent });
        }
        return execute(adapter, intent);
      });
    },
  });
}

async function execute(adapter, initial) {
  let intent = initial;
  if (intent.status === "complete") {
    await adapter.verifyCompleted({ intent, plan: intent.planSnapshot, phase: "complete" });
    return intent.completion;
  }
  for (const phase of PHASES.slice(PHASES.indexOf(intent.status) + 1)) {
    const input = Object.freeze({
      intent,
      plan: intent.planSnapshot,
      phase,
      operationKey: scopeExpansionSuccessorProjectionRecoveryOperationKey(intent.planSnapshot, phase),
    });
    if (FRESH_CAPABILITY_PHASES.has(phase)) {
      await adapter.verifyTaskAuthority({ ...input, authorityRefresh: true });
    }
    let values = await adapter.reconcilePhase(input);
    if (!values) {
      try {
        values = await adapter[EFFECTS[phase]](input);
      } catch (error) {
        values = await adapter.reconcilePhase(input);
        if (!values) throw error;
      }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Successor projection recovery ${phase} did not complete.`);
    }
    if (phase === "complete") {
      const receipt = buildScopeExpansionSuccessorProjectionRecoveryCompletion(
        intent.planSnapshot,
        values,
      );
      values = { receipt };
    }
    const next = advanceScopeExpansionSuccessorProjectionRecoveryIntent(intent, { status: phase, values });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  return intent.completion;
}

export function readScopeExpansionSuccessorProjectionRecoveryJournal(filePath) {
  if (!pathEntryExists(filePath)) return null;
  assertSecureRegularFile(filePath, "recovery journal");
  const stat = lstatSync(filePath);
  if (stat.size < 2 || stat.size > MAX_JOURNAL_BYTES) {
    throw new Error("Recovery journal size is outside its bound.");
  }
  let value;
  try { value = JSON.parse(readFileSync(filePath, "utf8")); }
  catch (error) { throw new Error(`Recovery journal JSON is invalid: ${error.message}`); }
  exactKeys(value, ["schema", "intent", "intentDigest"], "recovery journal envelope");
  if (value.schema !== JOURNAL_SCHEMA || value.intentDigest !== digestValue(value.intent)) {
    throw new Error("Recovery journal envelope is digest-invalid.");
  }
  return normalizeScopeExpansionSuccessorProjectionRecoveryIntent(value.intent);
}

export function writeScopeExpansionSuccessorProjectionRecoveryJournal({
  filePath, stateRoot, expected, value,
}) {
  ensureSecureRecoveryDirectory(stateRoot, path.dirname(filePath));
  const current = readScopeExpansionSuccessorProjectionRecoveryJournal(filePath);
  if (digestValue(current) !== digestValue(expected)) {
    throw new Error("Recovery journal changed before CAS.");
  }
  const envelope = { schema: JOURNAL_SCHEMA, intent: value, intentDigest: digestValue(value) };
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) {
    throw new Error("Recovery journal exceeds its serialized size bound.");
  }
  const temporary = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, serialized); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = null;
    if (pathEntryExists(filePath)) assertSecureRegularFile(filePath, "recovery journal");
    renameSync(temporary, filePath);
    syncDirectory(path.dirname(filePath));
    assertSecureRegularFile(filePath, "recovery journal");
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (pathEntryExists(temporary)) unlinkSync(temporary);
  }
  return value;
}

export async function withScopeExpansionSuccessorProjectionRecoveryFence({
  lockPath, stateRoot, action, processAlive = isProcessAlive, now = () => new Date(),
}) {
  ensureSecureRecoveryDirectory(stateRoot, path.dirname(lockPath));
  const token = `${process.pid}:${process.hrtime.bigint()}`;
  let descriptor = createLock(lockPath, token, now);
  if (descriptor === null) {
    const owner = readLock(lockPath);
    if (!owner) throw new Error("Recovery lock is malformed.");
    if (processAlive(owner.pid)) throw new Error("Recovery is already fenced.");
    const stale = `${lockPath}.stale.${token}`;
    renameSync(lockPath, stale);
    const moved = readLock(stale);
    if (moved?.token !== owner.token) {
      if (!pathEntryExists(lockPath)) renameSync(stale, lockPath);
      throw new Error("Recovery lock changed during stale-owner fencing.");
    }
    descriptor = createLock(lockPath, token, now);
    if (descriptor === null) {
      if (!pathEntryExists(lockPath)) renameSync(stale, lockPath);
      throw new Error("Recovery lock was concurrently reacquired.");
    }
    unlinkSync(stale);
  }
  try { return await action(); } finally {
    closeSync(descriptor);
    if (readLock(lockPath)?.token === token) unlinkSync(lockPath);
  }
}

export function ensureSecureRecoveryDirectory(stateRoot, directory) {
  const requestedRoot = path.resolve(stateRoot);
  const relative = path.relative(requestedRoot, path.resolve(directory));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Recovery state directory must be a child of the Git common directory.");
  }
  const root = realpathSync(requestedRoot);
  const target = path.join(root, relative);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(target) !== target
    || (stat.mode & 0o077) !== 0) {
    throw new Error("Recovery state directory must be a private real directory.");
  }
  return target;
}

function createLock(filePath, token, now) {
  let descriptor;
  try { descriptor = openSync(filePath, "wx", 0o600); }
  catch (error) { if (error?.code === "EEXIST") return null; throw error; }
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token,
    acquiredAt: now().toISOString() })}\n`);
  fsyncSync(descriptor);
  return descriptor;
}
function syncDirectory(directory) { const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function readLock(filePath) {
  if (!pathEntryExists(filePath)) return null;
  try {
    assertSecureRegularFile(filePath, "recovery lock");
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    exactKeys(value, ["pid", "token", "acquiredAt"], "recovery lock");
    return Number.isSafeInteger(value.pid) && value.pid > 0
      && typeof value.token === "string" && Number.isFinite(Date.parse(value.acquiredAt))
      ? value : null;
  } catch { return null; }
}
function assertSecureRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular non-symlink file.`);
  }
}
function pathEntryExists(filePath) { try { lstatSync(filePath); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}
function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true; throw error; }
}
