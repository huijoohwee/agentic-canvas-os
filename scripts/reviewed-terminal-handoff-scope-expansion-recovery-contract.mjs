// Responsibility: Seal one exact recovery plan that expands a bound reviewed handoff scope.
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";

export const OPERATION = "reviewed-terminal-handoff-scope-expansion-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
export const PHASES = Object.freeze([
  "authorized", "source-recovered", "successor-claimed", "source-retired",
  "successor-promoted", "successor-bound", "successor-review-ready", "local-cas",
  "pr-marker", "source-journal-archived", "verified", "complete",
]);

export function buildScopeExpansionRecoveryPlan({ evidence, operatorSessionId, ttlSeconds = 1800 } = {}) {
  const source = normalizeEvidence(evidence);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.sourceOperatorSessionId) {
    throw new Error("Scope repair requires a distinct successor operator session.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    operatorSessionId: operator,
    ttlSeconds: positive(ttlSeconds, "TTL seconds"),
    sourceClaimId: source.sourceClaim.claimId,
    sourceClaimDigest: source.sourceClaim.fenceRevision,
    sourceTransitionCounter: source.sourceClaim.transitionCounter,
    targetCloudLeaseEpoch: 1,
    forbiddenEffects: ["source-change", "commit", "push", "merge", "cleanup", "deployment"],
  };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizeScopeExpansionRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildScopeExpansionRecoveryPlan(value);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("plan projection");
  return rebuilt;
}

export function authorizeScopeExpansionRecovery({ plan, authorization } = {}) {
  const source = normalizeScopeExpansionRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Scope repair requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = { schema: `agentic-${OPERATION}-authorization/v1`,
    planDigest: source.planDigest, statement: authorization };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createScopeExpansionRecoveryIntent(plan, authorization) {
  const source = normalizeScopeExpansionRecoveryPlan(plan);
  const authority = authorizeScopeExpansionRecovery({ plan: source, authorization });
  return seal({ phase: "authorized", plan: source, authority, receipts: {
    authorized: phaseReceipt(source, "authorized", null,
      { authorizationDigest: authority.authorizationDigest }),
  }, completion: null });
}

export function advanceScopeExpansionRecoveryIntent(value, { phase, values } = {}) {
  const current = normalizeScopeExpansionRecoveryIntent(value);
  if (PHASES.indexOf(phase) !== PHASES.indexOf(current.phase) + 1) {
    throw new Error("Scope repair cannot skip or regress a protected phase.");
  }
  const receipts = { ...current.receipts,
    [phase]: phaseReceipt(current.planSnapshot, phase, current.intentDigest, values) };
  return seal({ phase, plan: current.planSnapshot, authority: current.authorization,
    receipts, completion: phase === "complete" ? values : null });
}

export function normalizeScopeExpansionRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) invalid("intent schema");
  const plan = normalizeScopeExpansionRecoveryPlan(value.planSnapshot);
  const authority = authorizeScopeExpansionRecovery({ plan,
    authorization: value.authorization?.statement });
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts)) !== canonicalJson(names)) invalid("intent phases");
  const receipts = {};
  let prior = null;
  for (const name of names) {
    receipts[name] = phaseReceipt(plan, name, prior, value.receipts[name]?.values);
    prior = sealCore({ phase: name, plan, authority, receipts: { ...receipts },
      completion: name === "complete" ? value.completion : null }).intentDigest;
  }
  const rebuilt = seal({ phase: value.phase, plan, authority, receipts,
    completion: value.phase === "complete" ? value.completion : null });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("intent projection");
  return rebuilt;
}

export function scopeExpansionRecoveryOperationKey(plan, phase) {
  const source = normalizeScopeExpansionRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

export function createScopeExpansionRecoveryJournalStore({ commonDirectory, branch } = {}) {
  const root = path.join(text(commonDirectory, "Git common directory"), "agentic-canvas-os", OPERATION);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = digestValue({ branch: text(branch, "branch") });
  const journal = path.join(root, `${key}.json`);
  const lock = path.join(root, `${key}.lock`);
  return Object.freeze({ path: journal, read: () => readJournal(journal),
    write: ({ expected, value }) => writeJournal(journal, expected, value),
    withFence: action => withLock(lock, action) });
}

function normalizeEvidence(value) {
  if (!value || value.schema !== `agentic-${OPERATION}-evidence/v1`) invalid("evidence schema");
  const sourceWriteSet = normalizeWriteSet(value.sourceAdmission?.declaredWriteSet);
  const targetWriteSet = normalizeWriteSet(value.targetManifest?.declaredWriteSet);
  const missingPaths = [...new Set((value.missingPaths || []).map(requiredPath))].sort();
  const changedPaths = [...new Set((value.changedPaths || []).map(requiredPath))].sort();
  const additions = targetWriteSet.filter(item => !sourceWriteSet.includes(item));
  if (!(sourceWriteSet.length < targetWriteSet.length
    && sourceWriteSet.every(item => targetWriteSet.includes(item)))) invalid("strict-superset scope");
  if (!changedPaths.every(item => covered(targetWriteSet, item))) invalid("target path coverage");
  if (canonicalJson(missingPaths) !== canonicalJson(changedPaths.filter(item => !covered(sourceWriteSet, item)))) {
    invalid("missing path projection");
  }
  if (canonicalJson(additions) !== canonicalJson(missingPaths.map(item => `path:${item}`).sort())) {
    invalid("target scope additions");
  }
  const core = { ...structuredClone(value) };
  delete core.evidenceDigest;
  core.changedPaths = changedPaths;
  core.missingPaths = missingPaths;
  core.sourceAdmission.declaredWriteSet = sourceWriteSet;
  core.targetManifest.declaredWriteSet = targetWriteSet;
  if (core.sourceJournalPhase !== "successor-bound"
    || core.sourceClaim.claimId !== core.sourceJournalSuccessor.claimId
    || core.sourceClaim.fenceRevision !== core.sourceJournalSuccessor.claimDigest
    || core.sourceAdmission.writeSetDigest !== digestValue(sourceWriteSet)
    || core.targetManifest.writeSetDigest !== digestValue(targetWriteSet)
    || core.targetManifest.semanticScope !== core.sourceAdmission.semanticScope
    || core.targetManifest.manifestDigest !== digestValue({ schema: "agentic-declared-write-scope/v1",
      semanticScope: core.targetManifest.semanticScope, paths: core.targetManifest.paths })) {
    invalid("evidence joins");
  }
  const normalized = { ...core, evidenceDigest: digestValue(core) };
  if (value.evidenceDigest !== normalized.evidenceDigest) invalid("evidence digest");
  return deepFreeze(normalized);
}

function phaseReceipt(plan, phase, priorIntentDigest, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) invalid(`${phase} values`);
  const normalized = deepFreeze(structuredClone(values));
  const core = { schema: `agentic-${OPERATION}-phase/v1`, phase,
    planDigest: plan.planDigest, operationKey: scopeExpansionRecoveryOperationKey(plan, phase),
    priorIntentDigest, values: normalized, valuesDigest: digestValue(normalized) };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function seal(args) { return deepFreeze(sealCore(args)); }
function sealCore({ phase, plan, authority, receipts, completion }) {
  const core = { schema: INTENT_SCHEMA, phase, planDigest: plan.planDigest,
    planSnapshot: plan, authorization: authority, authorizationDigest: authority.authorizationDigest,
    receipts, completion };
  return { ...core, intentDigest: digestValue(core) };
}
function covered(writeSet, changedPath) { return writeSet.some(item => item.startsWith("path:")
  && (item.slice(5) === "." || changedPath === item.slice(5)
    || changedPath.startsWith(`${item.slice(5)}/`))); }
function requiredPath(value) { const result = text(value, "path");
  if (path.isAbsolute(result) || result.split("/").includes("..")) invalid("path"); return result; }
function text(value, label) { const result = String(value ?? "").trim(); if (!result) invalid(label); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Reviewed handoff scope repair has invalid ${label}.`); }

function readJournal(file) {
  if (!existsSync(file)) return null;
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  if (envelope.schema !== JOURNAL_SCHEMA || envelope.intentDigest !== digestValue(envelope.intent)) {
    throw new Error("Scope repair journal is invalid.");
  }
  return normalizeScopeExpansionRecoveryIntent(envelope.intent);
}
function writeJournal(file, expected, value) {
  if (digestValue(readJournal(file)) !== digestValue(expected)) throw new Error("Scope repair journal changed before CAS.");
  const envelope = { schema: JOURNAL_SCHEMA, intent: value, intentDigest: digestValue(value) };
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = null; renameSync(temporary, file);
  } finally { if (descriptor) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary); }
  return value;
}
async function withLock(file, action) {
  let descriptor;
  try { descriptor = openSync(file, "wx", 0o600); writeFileSync(descriptor, `${process.pid}\n`);
    fsyncSync(descriptor); return await action(); }
  catch (error) { if (error?.code === "EEXIST") throw new Error("Scope repair is already fenced."); throw error; }
  finally { if (descriptor) closeSync(descriptor); if (existsSync(file)) unlinkSync(file); }
}
