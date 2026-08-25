// Responsibility: Seal authorization and monotonic intent for terminal-handoff recovery.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { sealTerminalHandoffEvidence }
  from "./terminal-handoff-owned-dirt-successor-recovery-evidence.mjs";

export const OPERATION = "terminal-handoff-owned-dirt-successor-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const PHASES = Object.freeze([
  "authorized", "snapshotted", "successor-claimed", "successor-bound",
  "local-cas", "pr-marker", "verified", "complete",
]);

export function buildRecoveryPlan({ evidence, operatorSessionId, ttlSeconds = 1800 } = {}) {
  const source = sealTerminalHandoffEvidence(evidence);
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
    sourceClaimId: source.sourceClaim.claimId,
    sourceLeaseDigest: source.leaseDigest,
    targetLeaseEpoch: source.sourceClaim.leaseEpoch + 1,
    targetCapabilityDigest: source.targetCapabilityDigest,
    forbiddenEffects: ["source-change", "commit", "push", "merge", "cleanup", "deployment"],
  };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
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
  const core = { schema: `agentic-${OPERATION}-authorization/v1`,
    planDigest: source.planDigest, statement: authorization };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createRecoveryIntent(plan, authorization) {
  const source = normalizeRecoveryPlan(plan);
  const authority = authorizeRecovery({ plan: source, authorization });
  return seal({ phase: "authorized", plan: source, authority,
    receipts: { authorized: receipt(source, "authorized", null,
      { authorizationDigest: authority.authorizationDigest }) }, completion: null });
}

export function advanceRecoveryIntent(value, { phase, values } = {}) {
  const current = normalizeRecoveryIntent(value);
  const from = PHASES.indexOf(current.phase), to = PHASES.indexOf(phase);
  if (to !== from + 1) throw new Error("Recovery cannot skip or regress a protected phase.");
  const receipts = { ...current.receipts,
    [phase]: receipt(current.planSnapshot, phase, current.intentDigest, values) };
  const completion = phase === "complete" ? values : null;
  return seal({ phase, plan: current.planSnapshot, authority: current.authorization,
    receipts, completion });
}

export function normalizeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) invalid("intent schema");
  const plan = normalizeRecoveryPlan(value.planSnapshot);
  const authority = authorizeRecovery({ plan, authorization: value.authorization?.statement });
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts)) !== canonicalJson(names)) invalid("intent phases");
  let prior = null; const receipts = {};
  for (const name of names) {
    receipts[name] = receipt(plan, name, prior, value.receipts[name]?.values);
    prior = sealCore({ phase: name, plan, authority, receipts: { ...receipts },
      completion: name === "complete" ? value.completion : null }).intentDigest;
  }
  const rebuilt = seal({ phase: value.phase, plan, authority, receipts,
    completion: value.phase === "complete" ? value.completion : null });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("intent projection");
  return rebuilt;
}

export function operationKey(plan, phase) {
  const source = normalizeRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

function receipt(plan, phase, priorIntentDigest, values) {
  const normalized = values && typeof values === "object" && !Array.isArray(values)
    ? deepFreeze(structuredClone(values)) : invalid(`${phase} values`);
  const core = { schema: `agentic-${OPERATION}-phase/v1`, phase,
    planDigest: plan.planDigest, operationKey: operationKey(plan, phase), priorIntentDigest,
    values: normalized, valuesDigest: digestValue(normalized) };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
function seal(args) { return deepFreeze(sealCore(args)); }
function sealCore({ phase, plan, authority, receipts, completion }) {
  const core = { schema: INTENT_SCHEMA, phase, planDigest: plan.planDigest,
    planSnapshot: plan, authorization: authority,
    authorizationDigest: authority.authorizationDigest, receipts, completion };
  return { ...core, intentDigest: digestValue(core) };
}
function text(value, label) { const result = String(value || "").trim();
  if (!result) invalid(label); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Terminal-handoff recovery has invalid ${label}.`); }
