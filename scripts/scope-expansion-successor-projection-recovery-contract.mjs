// Responsibility: Seal fresh authority and a monotonic journal for one C1-to-C2 projection recovery.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeScopeExpansionSuccessorProjectionRecoveryEvidence,
  scopeExpansionSuccessorProjectionRecoveryDecisionSubject,
}
  from "./scope-expansion-successor-projection-recovery-evidence.mjs";

export const PLAN_SCHEMA = "agentic-scope-expansion-successor-projection-recovery-plan/v1";
export const INTENT_SCHEMA = "agentic-scope-expansion-successor-projection-recovery-intent/v1";
export const OPERATION = "scope-expansion-successor-projection-recovery";
export const PHASES = Object.freeze([
  "prepared", "task-authority-verified", "promotion-adopted", "successor-bound",
  "local-cas", "pr-marker", "verified", "complete",
]);

export function buildScopeExpansionSuccessorProjectionRecoveryPlan({
  evidence,
  operatorSessionId,
} = {}) {
  const source = normalizeScopeExpansionSuccessorProjectionRecoveryEvidence(evidence);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.lease.sessionId) {
    throw new Error("Successor projection recovery requires a distinct operator session.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    decisionSubjectDigest: digestValue(
      scopeExpansionSuccessorProjectionRecoveryDecisionSubject(source),
    ),
    operatorSessionId: operator,
    sourceSessionId: source.lease.sessionId,
    branch: source.lease.branch,
    sourceClaimId: source.originalPlan.sourceClaimId,
    successorClaimId: source.successor.claimId,
    pullRequestNumber: source.pullRequest.number,
    forbiddenEffects: ["source-change", "commit", "push", "merge", "cleanup", "deployment"],
  };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest, exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizeScopeExpansionSuccessorProjectionRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildScopeExpansionSuccessorProjectionRecoveryPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeScopeExpansionSuccessorProjectionRecovery({ plan, authorization } = {}) {
  const source = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Successor projection recovery requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: "agentic-scope-expansion-successor-projection-recovery-authorization/v1",
    planDigest: source.planDigest,
    evidenceDigest: source.evidenceDigest,
    statement: authorization,
  };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createScopeExpansionSuccessorProjectionRecoveryIntent(plan, authorization) {
  const source = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(plan);
  const authority = authorizeScopeExpansionSuccessorProjectionRecovery({ plan: source, authorization });
  return seal({
    status: "prepared",
    plan: source,
    authorization: authority,
    phases: { prepared: phaseReceipt(source, "prepared", null, {
      authorizationDigest: authority.authorizationDigest,
    }) },
    completion: null,
  });
}

export function advanceScopeExpansionSuccessorProjectionRecoveryIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeScopeExpansionSuccessorProjectionRecoveryIntent(value);
  const from = PHASES.indexOf(current.status);
  const to = PHASES.indexOf(status);
  if (to < from || to > from + 1) {
    throw new Error("Successor projection recovery cannot skip or regress a protected phase.");
  }
  if (to === from) return current;
  const phases = {
    ...current.phases,
    [status]: phaseReceipt(current.planSnapshot, status, current.intentDigest, values),
  };
  assertPhaseJoins(phases, current.planSnapshot);
  const completion = status === "complete"
    ? buildScopeExpansionSuccessorProjectionRecoveryCompletion(current.planSnapshot, values)
    : null;
  return seal({
    status,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizeScopeExpansionSuccessorProjectionRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)) invalid("intent");
  const plan = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(value.planSnapshot);
  const authorization = authorizeScopeExpansionSuccessorProjectionRecovery({
    plan,
    authorization: value.authorization?.statement,
  });
  const names = PHASES.slice(0, PHASES.indexOf(value.status) + 1);
  if (canonicalJson(Object.keys(value.phases)) !== canonicalJson(names)) invalid("intent phases");
  let prior = null;
  const phases = {};
  for (const name of names) {
    phases[name] = phaseReceipt(plan, name, prior, value.phases[name]?.values);
    prior = sealCore({
      status: name,
      plan,
      authorization,
      phases: { ...phases },
      completion: name === "complete" ? value.completion : null,
    }).intentDigest;
  }
  assertPhaseJoins(phases, plan);
  const completion = value.status === "complete"
    ? buildScopeExpansionSuccessorProjectionRecoveryCompletion(plan, value.completion)
    : null;
  const rebuilt = seal({ status: value.status, plan, authorization, phases, completion });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildScopeExpansionSuccessorProjectionRecoveryCompletion(plan, values = {}) {
  const source = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(plan);
  const receipt = values.receipt ?? values;
  const core = {
    schema: "agentic-scope-expansion-successor-projection-recovery-completion/v1",
    status: "successor-projected",
    planDigest: source.planDigest,
    originalScopeExpansionPlanDigest: source.evidence.originalPlanDigest,
    sourceClaimId: source.sourceClaimId,
    successorClaimId: source.successorClaimId,
    taskAuthorityReceiptDigest: digest(receipt.taskAuthorityReceiptDigest, "task authority receipt"),
    successorBindReceiptDigest: digest(receipt.successorBindReceiptDigest, "successor bind receipt"),
    localProjectionReceiptDigest: digest(receipt.localProjectionReceiptDigest, "local projection receipt"),
    pullRequestMarkerDigest: digest(receipt.pullRequestMarkerDigest, "pull-request marker"),
    terminalVerificationDigest: digest(receipt.terminalVerificationDigest, "terminal verification"),
    finalScopeExpansionReceiptDigest: digest(receipt.finalScopeExpansionReceiptDigest, "scope-expansion completion"),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function scopeExpansionSuccessorProjectionRecoveryOperationKey(plan, phase) {
  const source = normalizeScopeExpansionSuccessorProjectionRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

export function scopeExpansionSuccessorProjectionRecoveryTaskOperation(phase) {
  if (!PHASES.includes(phase)) invalid("task-authority operation phase");
  return `${OPERATION}:${phase}`;
}

function phaseReceipt(plan, phase, priorIntentDigest, values) {
  const normalizedValues = normalizePhaseValues(phase, values, plan);
  const core = {
    schema: "agentic-scope-expansion-successor-projection-recovery-phase/v1",
    phase,
    planDigest: plan.planDigest,
    operationKey: scopeExpansionSuccessorProjectionRecoveryOperationKey(plan, phase),
    priorIntentDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, value, plan) {
  const source = clone(object(value, `${phase} phase values`));
  const schemas = {
    prepared: ["authorizationDigest"],
    "task-authority-verified": ["taskAuthorityReceiptDigest", "sourceTaskAuthorityBindingDigest"],
    "promotion-adopted": ["promoted", "receiptDigest"],
    "successor-bound": ["authority", "receiptDigest"],
    "local-cas": ["leaseDigest", "projection", "receiptDigest", "adopted"],
    "pr-marker": ["pullRequestMarkerDigest", "receiptDigest"],
    verified: ["schema", "recoveryPlanDigest", "leaseDigest", "originalIntentDigest",
      "pullRequestMarkerDigest", "dirtDigest", "mutationAuthorityReceiptDigest",
      "taskAuthorityBindingDigest", "cloudAuthorityDigest", "terminalVerificationDigest"],
    complete: ["receipt"],
  };
  exactKeys(source, schemas[phase], `${phase} phase values`);
  if (phase === "prepared") digest(source.authorizationDigest, "prepared authorization");
  if (phase === "task-authority-verified") {
    digest(source.taskAuthorityReceiptDigest, "task receipt");
    digest(source.sourceTaskAuthorityBindingDigest, "source task binding");
  }
  if (phase === "promotion-adopted") {
    const promoted = object(source.promoted, "promoted C2");
    exactKeys(promoted, ["claimId", "claimDigest", "ledgerRevision", "claimLedgerRevision",
      "transitionCounter", "expiresAt"], "promoted C2");
    digest(source.receiptDigest, "promotion receipt");
    if (promoted.claimId !== plan.successorClaimId
      || promoted.claimDigest !== plan.evidence.successor.fenceRevision
      || promoted.claimLedgerRevision !== plan.evidence.successor.transitionDigest
      || promoted.transitionCounter !== plan.evidence.successor.transitionCounter
      || promoted.expiresAt !== plan.evidence.successor.expiresAt
      || !/^[0-9a-f]{40}$/u.test(promoted.ledgerRevision)
      || source.receiptDigest !== digestValue({
        schema: "agentic-scope-expansion-successor-promotion-adoption/v1",
        recoveryPlanDigest: plan.planDigest,
        originalPlanDigest: plan.evidence.originalPlanDigest,
        promoted,
      })) invalid("promoted C2 claim");
  }
  if (phase === "successor-bound") {
    object(source.authority, "bound C2 authority"); digest(source.receiptDigest, "bind receipt");
    if (source.authority.claimId !== plan.successorClaimId
      || source.authority.reviewRequestId !== plan.evidence.originalPlan.sourceReviewRequestId
      || source.authority.transitionCounter !== plan.evidence.successor.transitionCounter + 1
      || source.authority.writeSetDigest !== plan.evidence.originalPlan.targetWriteSetDigest
      || source.authority.canonicalBaseSha !== plan.evidence.originalPlan.targetCanonicalBaseSha
      || source.authority.laneRevision !== plan.evidence.originalPlan.sourceFenceSha
      || source.authority.claimDigest === plan.evidence.successor.fenceRevision) {
      invalid("bound C2 authority");
    }
  }
  if (phase === "local-cas") {
    digest(source.leaseDigest, "local lease"); object(source.projection, "local projection");
    digest(source.receiptDigest, "local projection receipt");
    if (typeof source.adopted !== "boolean" || source.projection.claimId !== plan.successorClaimId
      || source.projection.receiptDigest !== source.receiptDigest
      || source.projection.leaseDigest !== source.leaseDigest) invalid("local projection values");
  }
  if (phase === "pr-marker") {
    digest(source.pullRequestMarkerDigest, "pull-request marker");
    digest(source.receiptDigest, "pull-request projection receipt");
  }
  if (phase === "verified") {
    for (const key of ["leaseDigest", "originalIntentDigest", "pullRequestMarkerDigest",
      "dirtDigest", "mutationAuthorityReceiptDigest", "taskAuthorityBindingDigest",
      "cloudAuthorityDigest", "terminalVerificationDigest"]) digest(source[key], `terminal ${key}`);
    if (source.schema !== "agentic-scope-expansion-successor-projection-terminal/v1"
      || source.recoveryPlanDigest !== plan.planDigest
      || source.terminalVerificationDigest
        !== scopeExpansionSuccessorProjectionTerminalStableDigest(source)) {
      invalid("terminal verification values");
    }
  }
  if (phase === "complete") {
    const receipt = buildScopeExpansionSuccessorProjectionRecoveryCompletion(plan, source.receipt);
    if (canonicalJson(receipt) !== canonicalJson(source.receipt)) invalid("completion receipt");
    source.receipt = receipt;
  }
  return deepFreeze(source);
}

function assertPhaseJoins(phases, plan) {
  const task = phases["task-authority-verified"]?.values;
  const local = phases["local-cas"]?.values;
  const marker = phases["pr-marker"]?.values;
  const verified = phases.verified?.values;
  const completion = phases.complete?.values?.receipt;
  if (task && task.sourceTaskAuthorityBindingDigest
    !== plan.evidence.sourceTaskAuthorityBindingDigest) invalid("source task-binding join");
  if (local && (local.projection.sourceTaskAuthorityBindingDigest
      !== plan.evidence.sourceTaskAuthorityBindingDigest
    || local.projection.targetTaskAuthorityBindingDigest === local.projection.sourceTaskAuthorityBindingDigest)) {
    invalid("C1 to C2 task-binding continuation");
  }
  if (verified && (verified.leaseDigest !== local?.leaseDigest
    || verified.pullRequestMarkerDigest !== marker?.pullRequestMarkerDigest)) {
    invalid("terminal projection join");
  }
  if (completion && (completion.taskAuthorityReceiptDigest !== task?.taskAuthorityReceiptDigest
    || completion.successorBindReceiptDigest !== phases["successor-bound"]?.values.receiptDigest
    || completion.localProjectionReceiptDigest !== local?.receiptDigest
    || completion.pullRequestMarkerDigest !== marker?.pullRequestMarkerDigest
    || completion.terminalVerificationDigest !== verified?.terminalVerificationDigest)) {
    invalid("completion phase join");
  }
}
function seal(args) { const core = sealCore(args); return freeze(core); }
function sealCore({ status, plan, authorization, phases, completion }) {
  const raw = { schema: INTENT_SCHEMA, status, planDigest: plan.planDigest,
    planSnapshot: plan, authorization, authorizationDigest: authorization.authorizationDigest,
    phases, completion };
  return { ...raw, intentDigest: digestValue(raw) };
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function exactKeys(value, keys, label) { if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function without(value, key) { const result = { ...value }; delete result[key]; return result; }
export function scopeExpansionSuccessorProjectionTerminalStableDigest(value) {
  const result = without(value, "terminalVerificationDigest");
  delete result.mutationAuthorityReceiptDigest; return digestValue(result); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function freeze(value) { return Object.freeze(value); }
function invalid(label) { throw new Error(`Scope-expansion successor projection recovery has invalid ${label}.`); }
