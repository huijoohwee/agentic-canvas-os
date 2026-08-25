// Responsibility: Seal authorization and durable phase intent for one reviewed terminal-handoff recovery.
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { sealReviewedTerminalHandoffEvidence }
  from "./reviewed-terminal-handoff-successor-recovery-evidence.mjs";

export const OPERATION = "reviewed-terminal-handoff-successor-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
export const PHASES = Object.freeze([
  "authorized", "successor-claimed", "successor-bound", "successor-review-ready",
  "local-cas", "pr-marker", "verified", "complete",
]);

export function buildRecoveryPlan({ evidence, operatorSessionId, ttlSeconds = 1800 } = {}) {
  const source = sealReviewedTerminalHandoffEvidence(evidence);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.lease.sessionId) {
    throw new Error("Recovery requires a distinct successor operator session.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    operatorSessionId: operator,
    ttlSeconds: positive(ttlSeconds, "TTL seconds"),
    sourceClaimId: source.reviewedSource.claimId,
    handoffClaimId: source.handoffSource.claimId,
    sourceLeaseDigest: source.leaseDigest,
    targetLeaseEpoch: source.handoffSource.leaseEpoch + 1,
    targetCapabilityDigest: source.targetCapabilityDigest,
    forbiddenEffects: ["source-change", "commit", "push", "merge", "cleanup", "deployment"],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildRecoveryPlan(value);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("plan projection");
  return rebuilt;
}

export function authorizeRecovery({ plan, authorization } = {}) {
  const source = normalizeRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Recovery requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: `agentic-${OPERATION}-authorization/v1`,
    planDigest: source.planDigest,
    statement: authorization,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createRecoveryIntent(plan, authorization) {
  const source = normalizeRecoveryPlan(plan);
  const authority = authorizeRecovery({ plan: source, authorization });
  return seal({
    phase: "authorized",
    plan: source,
    authority,
    receipts: {
      authorized: receipt(source, "authorized", null, {
        authorizationDigest: authority.authorizationDigest,
      }),
    },
    completion: null,
  });
}

export function advanceRecoveryIntent(value, { phase, values } = {}) {
  const current = normalizeRecoveryIntent(value);
  const from = PHASES.indexOf(current.phase);
  const to = PHASES.indexOf(phase);
  if (to !== from + 1) throw new Error("Recovery cannot skip or regress a protected phase.");
  const receipts = {
    ...current.receipts,
    [phase]: receipt(current.planSnapshot, phase, current.intentDigest, values),
  };
  return seal({
    phase,
    plan: current.planSnapshot,
    authority: current.authorization,
    receipts,
    completion: phase === "complete" ? values : null,
  });
}

export function normalizeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) invalid("intent schema");
  const plan = normalizeRecoveryPlan(value.planSnapshot);
  const authority = authorizeRecovery({ plan, authorization: value.authorization?.statement });
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts)) !== canonicalJson(names)) invalid("intent phases");
  let prior = null;
  const receipts = {};
  for (const name of names) {
    receipts[name] = receipt(plan, name, prior, value.receipts[name]?.values);
    prior = sealCore({
      phase: name,
      plan,
      authority,
      receipts: { ...receipts },
      completion: name === "complete" ? value.completion : null,
    }).intentDigest;
  }
  const rebuilt = seal({
    phase: value.phase,
    plan,
    authority,
    receipts,
    completion: value.phase === "complete" ? value.completion : null,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("intent projection");
  return rebuilt;
}

export function operationKey(plan, phase) {
  const source = normalizeRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

export function createRecoveryJournalStore({ commonDirectory, branch } = {}) {
  const root = path.join(text(commonDirectory, "Git common directory"),
    "agentic-canvas-os", OPERATION);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = digestValue({ branch: text(branch, "branch") });
  const journal = path.join(root, `${key}.json`);
  const lock = path.join(root, `${key}.lock`);
  return Object.freeze({
    read: () => readJournal(journal),
    write: ({ expected, value }) => writeJournal(journal, expected, value),
    withFence: action => withLock(lock, action),
  });
}

function receipt(plan, phase, priorIntentDigest, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) invalid(`${phase} values`);
  const normalized = deepFreeze(structuredClone(values));
  const core = {
    schema: `agentic-${OPERATION}-phase/v1`,
    phase,
    planDigest: plan.planDigest,
    operationKey: operationKey(plan, phase),
    priorIntentDigest,
    values: normalized,
    valuesDigest: digestValue(normalized),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function seal(args) { return deepFreeze(sealCore(args)); }
function sealCore({ phase, plan, authority, receipts, completion }) {
  const core = {
    schema: INTENT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization: authority,
    authorizationDigest: authority.authorizationDigest,
    receipts,
    completion,
  };
  return { ...core, intentDigest: digestValue(core) };
}
function text(value, label) { const result = String(value || "").trim(); if (!result) invalid(label); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Reviewed terminal-handoff recovery has invalid ${label}.`); }

function readJournal(file) {
  if (!existsSync(file)) return null;
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  if (envelope.schema !== JOURNAL_SCHEMA
    || envelope.intentDigest !== digestValue(envelope.intent)) {
    throw new Error("Recovery journal is invalid.");
  }
  return normalizeRecoveryIntent(envelope.intent);
}

function writeJournal(file, expected, value) {
  const current = readJournal(file);
  if (digestValue(current) !== digestValue(expected)) {
    throw new Error("Recovery journal changed before CAS.");
  }
  const envelope = { schema: JOURNAL_SCHEMA, intent: value, intentDigest: digestValue(value) };
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, file);
  } finally {
    if (descriptor) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return value;
}

async function withLock(file, action) {
  let descriptor;
  try {
    descriptor = openSync(file, "wx", 0o600);
    writeFileSync(descriptor, `${process.pid}\n`);
    fsyncSync(descriptor);
    return await action();
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Recovery is already fenced.");
    throw error;
  } finally {
    if (descriptor) closeSync(descriptor);
    if (existsSync(file)) unlinkSync(file);
  }
}
