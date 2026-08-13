// Responsibility: Persist one replay-safe recovery intent outside the authored worktree.

import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { RECOVERY_INTENT_SCHEMA } from "./provisioned-start-admission-recovery-contract.mjs";

const PHASES = ["intent", "local-projected", "marker-projected", "complete"];

export function createProvisionedStartAdmissionRecoveryStore({ gitCommonDir, branch }) {
  const common = path.resolve(gitCommonDir);
  requireDirectory(common, "Git common directory");
  const root = path.join(common, "agentic-canvas-os", "provisioned-start-admission-recovery");
  const key = digestValue({ branch });
  const statePath = path.join(root, `${key}.json`);
  const lockPath = path.join(root, `${key}.lock`);

  function read() {
    requireSafeRoot(root);
    if (!existsSync(statePath)) return null;
    requireRegularFile(statePath, "Recovery intent");
    return normalizeIntent(JSON.parse(readFileSync(statePath, "utf8")));
  }

  function begin({ plan, authorization, startedAt }) {
    return mutate(current => {
      if (current) {
        if (current.planDigest !== plan.planDigest) throw new Error("Another recovery intent owns this branch.");
        return current;
      }
      const receiptCore = { schema: "agentic-provisioned-start-admission-recovery-phase/v1",
        planDigest: plan.planDigest, phase: "intent", values: { authorizationDigest: authorization.authorizationDigest },
        recordedAt: startedAt };
      const receipt = { ...receiptCore, receiptDigest: digestValue(receiptCore) };
      return seal({ schema: RECOVERY_INTENT_SCHEMA, branch, planDigest: plan.planDigest,
        evidenceDigest: digestValue(plan.evidence), authorizationDigest: authorization.authorizationDigest,
        startedAt, phase: "intent", phases: { intent: receipt } });
    });
  }

  function advance({ expectedPhase, phase, values, recordedAt }) {
    if (PHASES.indexOf(phase) !== PHASES.indexOf(expectedPhase) + 1) {
      throw new Error("Recovery intent phases must advance sequentially.");
    }
    return mutate(current => {
      if (!current || current.phase !== expectedPhase) {
        if (current?.phase === phase) return current;
        throw new Error(`Recovery intent is not at ${expectedPhase}.`);
      }
      const receiptCore = { schema: "agentic-provisioned-start-admission-recovery-phase/v1",
        planDigest: current.planDigest, phase, values, recordedAt };
      const receipt = Object.freeze({ ...receiptCore, receiptDigest: digestValue(receiptCore) });
      return seal({ ...current, phase, phases: { ...current.phases, [phase]: receipt } });
    });
  }

  function mutate(project) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    requireSafeRoot(root);
    const lock = acquire(lockPath);
    try {
      const current = read();
      const next = normalizeIntent(project(current));
      writeAtomic(statePath, next);
      return next;
    } finally {
      closeSync(lock.descriptor);
      const owner = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;
      if (owner?.token === lock.token) unlinkSync(lockPath);
    }
  }

  return Object.freeze({ advance, begin, read, statePath });
}

function normalizeIntent(value) {
  if (value?.schema !== RECOVERY_INTENT_SCHEMA || typeof value.branch !== "string"
    || !/^[0-9a-f]{64}$/u.test(String(value.planDigest || ""))
    || !/^[0-9a-f]{64}$/u.test(String(value.evidenceDigest || ""))
    || !/^[0-9a-f]{64}$/u.test(String(value.authorizationDigest || ""))
    || !PHASES.includes(value.phase) || !value.phases || typeof value.phases !== "object") {
    throw new Error("Recovery intent is malformed.");
  }
  const supplied = value.intentDigest;
  const core = { ...value };
  delete core.intentDigest;
  const expected = digestValue(core);
  if (supplied && supplied !== expected) throw new Error("Recovery intent digest is invalid.");
  return Object.freeze({ ...core, intentDigest: expected });
}

function seal(value) { const core = { ...value }; delete core.intentDigest; return { ...core, intentDigest: digestValue(core) }; }
function requireDirectory(candidate, label) { const stat = lstatSync(candidate); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is invalid.`); }
function requireRegularFile(candidate, label) { const stat = lstatSync(candidate); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`${label} storage is unsafe.`); }
function requireSafeRoot(root) { if (!existsSync(root)) return; requireDirectory(root, "Recovery intent directory"); }

function acquire(lockPath) {
  if (existsSync(lockPath)) throw new Error("Recovery intent is locked by another controller.");
  const token = randomUUID();
  const descriptor = openSync(lockPath, "wx", 0o600);
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
  fsyncSync(descriptor);
  return { descriptor, token };
}

function writeAtomic(statePath, value) {
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  renameSync(temporaryPath, statePath);
  const directory = openSync(path.dirname(statePath), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
