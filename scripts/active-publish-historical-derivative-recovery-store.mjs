// Responsibility: Persist one replay-safe recovery intent behind process-safe private fences.
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeActivePublishHistoricalDerivativeRecoveryIntent,
} from "./active-publish-historical-derivative-recovery-contract.mjs";

export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_JOURNAL_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-journal/v1";

export function createActivePublishHistoricalDerivativeRecoveryStore({
  gitCommonDir,
  statePath = null,
  journalFile = null,
  operationId = null,
  claimId = null,
  branch = null,
  pullRequestNumber = null,
  now = () => new Date(),
} = {}) {
  const filePath = resolveStatePath({
    gitCommonDir,
    statePath: statePath || journalFile,
    operationId,
    claimId,
    branch,
    pullRequestNumber,
  });
  const root = path.dirname(filePath);
  const intentLockPath = `${filePath}.intent.lock`;
  const operationLockPath = `${filePath}.operation.lock`;

  function readIntent() {
    requireSafeRoot(root);
    if (!existsSync(filePath)) return null;
    requirePrivateRegularFile(filePath, "Recovery journal");
    const journal = JSON.parse(readFileSync(filePath, "utf8"));
    exactKeys(journal, ["schema", "intent", "intentDigest", "updatedAt"], "journal");
    const intent = normalizeActivePublishHistoricalDerivativeRecoveryIntent(journal.intent);
    if (journal.schema !== ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_JOURNAL_SCHEMA
      || journal.intentDigest !== intent.intentDigest
      || !validInstant(journal.updatedAt)) {
      throw new Error("Recovery journal is malformed or digest-invalid.");
    }
    return intent;
  }

  function writeIntent({ expectedIntent = null, nextIntent } = {}) {
    if (arguments[0] && Object.hasOwn(arguments[0], "expected")) {
      expectedIntent = arguments[0].expected;
      nextIntent = arguments[0].value;
    }
    return withFileLock(intentLockPath, "intent-cas", () => {
      const current = readIntent();
      if (nullableIntentDigest(current) !== nullableIntentDigest(expectedIntent)) {
        throw new Error("Recovery intent changed before compare-and-swap.");
      }
      const intent = normalizeActivePublishHistoricalDerivativeRecoveryIntent(nextIntent);
      writeAtomic(filePath, {
        schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_JOURNAL_SCHEMA,
        intent,
        intentDigest: intent.intentDigest,
        updatedAt: currentInstant(now),
      });
      return intent;
    });
  }

  async function withOperationLock(subject, action) {
    if (typeof subject === "function" && action === undefined) {
      action = subject;
      subject = { statePath: filePath };
    }
    if (typeof action !== "function") throw new Error("Recovery operation action is required.");
    const normalizedSubject = normalizeLockSubject(subject);
    const lock = acquireLock(operationLockPath, "operation", normalizedSubject);
    try {
      return await action(Object.freeze({
        acquiredAt: currentInstant(now),
        fenceDigest: digestValue({ filePath, subject: normalizedSubject, token: lock.token }),
      }));
    } finally {
      releaseLock(lock);
    }
  }

  return Object.freeze({ statePath: filePath, readIntent, writeIntent, withOperationLock });
}

function resolveStatePath({
  gitCommonDir, statePath, operationId, claimId, branch, pullRequestNumber,
}) {
  if (statePath) return path.resolve(requiredText(statePath, "state path"));
  const common = path.resolve(requiredText(gitCommonDir, "Git common directory"));
  requireDirectory(common, "Git common directory");
  const subject = Object.fromEntries(Object.entries({
    operationId,
    claimId,
    branch,
    pullRequestNumber,
  }).filter(([, value]) => (typeof value === "string" && value.trim())
    || (Number.isSafeInteger(value) && value > 0)));
  if (!Object.keys(subject).length) {
    throw new Error("Recovery store requires an operation, claim, or branch subject.");
  }
  const key = digestValue({
    schema: "agentic-active-publish-historical-derivative-recovery-store-key/v1",
    ...subject,
  });
  return path.join(
    common,
    "agentic-canvas-os",
    "active-publish-historical-derivative-recovery",
    `${key}.json`,
  );
}

function withFileLock(lockPath, operation, action) {
  const lock = acquireLock(lockPath, operation, null);
  try {
    return action();
  } finally {
    releaseLock(lock);
  }
}

function acquireLock(lockPath, operation, subject) {
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  requireSafeRoot(path.dirname(lockPath));
  return acquireLockAttempt(lockPath, operation, subject, true);
}

function acquireLockAttempt(lockPath, operation, subject, mayRecover) {
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({ operation, subject, pid: process.pid, token }));
    fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code === "EEXIST" && mayRecover && recoverDeadLock(lockPath)) {
      return acquireLockAttempt(lockPath, operation, subject, false);
    }
    if (error?.code === "EEXIST") throw new Error("Recovery operation is already in progress.");
    throw error;
  }
  return { descriptor, lockPath, token };
}

function recoverDeadLock(lockPath) {
  requirePrivateRegularFile(lockPath, "Recovery lock");
  const observed = readFileSync(lockPath, "utf8");
  const owner = JSON.parse(observed);
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.token !== "string") {
    throw new Error("Recovery lock owner is malformed.");
  }
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
  }
  if (readFileSync(lockPath, "utf8") !== observed) return false;
  unlinkSync(lockPath);
  return true;
}

function releaseLock(lock) {
  closeSync(lock.descriptor);
  if (!existsSync(lock.lockPath)) return;
  const owner = JSON.parse(readFileSync(lock.lockPath, "utf8"));
  if (owner?.token !== lock.token) {
    throw new Error("Recovery operation lock ownership drifted.");
  }
  unlinkSync(lock.lockPath);
}

function writeAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  requireSafeRoot(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, filePath);
  const directory = openSync(path.dirname(filePath), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function nullableIntentDigest(value) {
  if (value === null || value === undefined) return null;
  return normalizeActivePublishHistoricalDerivativeRecoveryIntent(value).intentDigest;
}
function normalizeLockSubject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery operation subject is required.");
  }
  const clone = JSON.parse(JSON.stringify(value));
  if (!Object.keys(clone).length) throw new Error("Recovery operation subject is empty.");
  return Object.freeze(clone);
}
function currentInstant(now) {
  const value = now();
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (!validInstant(candidate)) throw new Error("Recovery journal clock is invalid.");
  return candidate;
}
function validInstant(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function requireDirectory(candidate, label) {
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is invalid.`);
}
function requirePrivateRegularFile(candidate, label) {
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} storage is unsafe.`);
  }
}
function requireSafeRoot(root) {
  if (existsSync(root)) requireDirectory(root, "Recovery journal directory");
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`Recovery ${label} is invalid.`);
  }
}
