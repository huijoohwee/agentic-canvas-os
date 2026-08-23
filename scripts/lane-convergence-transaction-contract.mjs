// Responsibility: Seal one stable multi-lane convergence plan, grant, journal, and terminal receipt.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const REQUEST_SCHEMA = "agentic-lane-convergence-request/v1";
export const PLAN_SCHEMA = "agentic-lane-convergence-plan/v1";
export const AUTHORIZATION_SCHEMA = "agentic-lane-convergence-authorization/v1";
export const GRANT_SCHEMA = "agentic-lane-convergence-internal-grant/v1";
export const INTENT_SCHEMA = "agentic-lane-convergence-intent/v1";
export const RECEIPT_SCHEMA = "agentic-lane-convergence-receipt/v1";
export const AUTHORIZATION_PREFIX = "authorize lane-convergence-transaction";
export const EFFECT_KEYS = Object.freeze([
  "cloudMutation", "providerMutation", "localProjectionMutation", "gitRefMutation",
  "sourceMutation", "integrationMutation", "deploymentMutation", "cleanupMutation",
]);

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildLaneConvergencePlan({ request, adapter }) {
  const normalizedRequest = normalizeLaneConvergenceRequest(request);
  const descriptor = normalizeAdapterDescriptor(adapter);
  for (const subject of normalizedRequest.subjects) {
    for (const action of subject.allowedActions) {
      const declared = descriptor.actions.find((item) => item.action === action);
      if (!declared) invalid(`adapter action ${action}`);
      assertEffectsWithin(declared.effects, subject.effectCeiling, `${subject.subjectId} effect ceiling`);
    }
  }
  const core = {
    schema: PLAN_SCHEMA,
    transactionId: normalizedRequest.transactionId,
    objective: normalizedRequest.objective,
    adapter: descriptor,
    subjects: normalizedRequest.subjects,
    maxTransitions: normalizedRequest.maxTransitions,
    terminalReceiptTypes: normalizedRequest.terminalReceiptTypes,
  };
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: `${AUTHORIZATION_PREFIX} ${planDigest}`,
  });
}

export function normalizeLaneConvergencePlan(value) {
  exactKeys(value, ["schema", "transactionId", "objective", "adapter", "subjects",
    "maxTransitions", "terminalReceiptTypes", "planDigest", "exactAuthorization"], "plan");
  const plan = buildLaneConvergencePlan({
    request: {
      schema: REQUEST_SCHEMA,
      transactionId: value.transactionId,
      objective: value.objective,
      subjects: value.subjects,
      maxTransitions: value.maxTransitions,
      terminalReceiptTypes: value.terminalReceiptTypes,
    },
    adapter: value.adapter,
  });
  if (value.schema !== PLAN_SCHEMA || value.planDigest !== plan.planDigest
    || value.exactAuthorization !== plan.exactAuthorization) invalid("digest or authorization");
  return plan;
}

export function authorizeLaneConvergence({ plan: rawPlan, authorization, authorizedAt }) {
  const plan = normalizeLaneConvergencePlan(rawPlan);
  if (authorization !== plan.exactAuthorization) {
    throw new Error(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    planDigest: plan.planDigest,
    authorizationDigest: digestValue(authorization),
    authorizedAt: instant(authorizedAt, "authorization time"),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildInternalGrant({ plan: rawPlan, authorizationReceipt, decision }) {
  const plan = normalizeLaneConvergencePlan(rawPlan);
  const receipt = normalizeAuthorizationReceipt(authorizationReceipt, plan);
  const transition = normalizeTransitionDecision(decision, plan);
  const core = {
    schema: GRANT_SCHEMA,
    planDigest: plan.planDigest,
    authorizationReceiptDigest: receipt.receiptDigest,
    transitionDigest: transition.transitionDigest,
    subjectId: transition.subjectId,
    action: transition.action,
    operationKey: transition.operationKey,
    effects: transition.effects,
  };
  return Object.freeze({ ...core, grantDigest: digestValue(core) });
}

export function normalizeTransitionDecision(value, rawPlan) {
  const plan = normalizeLaneConvergencePlan(rawPlan);
  exactKeys(value, ["kind", "subjectId", "action", "operationKey", "preconditionDigest",
    "effects", "transitionDigest"], "transition decision");
  if (value.kind !== "transition") invalid("transition kind");
  const subject = plan.subjects.find((item) => item.subjectId === text(value.subjectId, "subject id"));
  if (!subject || !subject.allowedActions.includes(value.action)) invalid("transition action");
  const declared = plan.adapter.actions.find((item) => item.action === value.action);
  const effects = normalizeEffects(value.effects, "transition effects");
  if (!declared || digestValue(effects) !== digestValue(declared.effects)) invalid("adapter effects");
  assertEffectsWithin(effects, subject.effectCeiling, "transition effects");
  const core = {
    kind: "transition",
    subjectId: subject.subjectId,
    action: value.action,
    operationKey: text(value.operationKey, "operation key"),
    preconditionDigest: digest(value.preconditionDigest, "precondition digest"),
    effects,
  };
  const transitionDigest = digestValue(core);
  if (value.transitionDigest !== transitionDigest) invalid("transition digest");
  return Object.freeze({ ...core, transitionDigest });
}

export function createTransitionDecision({ plan, subjectId, action, operationKey,
  preconditionDigest, effects }) {
  const core = { kind: "transition", subjectId, action, operationKey,
    preconditionDigest, effects };
  return normalizeTransitionDecision({ ...core, transitionDigest: digestValue(core) }, plan);
}

export function createLaneConvergenceIntent({ plan: rawPlan, authorizationReceipt }) {
  const plan = normalizeLaneConvergencePlan(rawPlan);
  const authorization = normalizeAuthorizationReceipt(authorizationReceipt, plan);
  const core = {
    schema: INTENT_SCHEMA,
    planDigest: plan.planDigest,
    status: "running",
    authorization,
    transitions: [],
    terminal: null,
  };
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}

export function normalizeLaneConvergenceIntent(value, rawPlan) {
  const plan = normalizeLaneConvergencePlan(rawPlan);
  exactKeys(value, ["schema", "planDigest", "status", "authorization", "transitions",
    "terminal", "intentDigest"], "intent");
  if (value.schema !== INTENT_SCHEMA || value.planDigest !== plan.planDigest
    || !["running", "complete"].includes(value.status)) invalid("intent identity");
  const authorization = normalizeAuthorizationReceipt(value.authorization, plan);
  if (!Array.isArray(value.transitions) || value.transitions.length > plan.maxTransitions) {
    invalid("intent transitions");
  }
  const transitions = value.transitions.map((item, index) => normalizeTransitionRecord(item, plan, index));
  const terminal = value.terminal === null ? null : normalizeTerminal(value.terminal, plan);
  if ((value.status === "complete") !== Boolean(terminal)) invalid("intent terminal status");
  const core = { schema: INTENT_SCHEMA, planDigest: plan.planDigest, status: value.status,
    authorization, transitions, terminal };
  if (value.intentDigest !== digestValue(core)) invalid("intent digest");
  return Object.freeze({ ...core, intentDigest: value.intentDigest });
}

export function withTransitionAttempt({ intent: rawIntent, plan, decision, attemptedAt }) {
  const intent = normalizeLaneConvergenceIntent(rawIntent, plan);
  if (intent.status !== "running" || intent.transitions.length >= plan.maxTransitions) {
    throw new Error("Lane convergence transition bound is exhausted.");
  }
  const transition = normalizeTransitionDecision(decision, plan);
  const record = transitionRecord({ decision: transition, status: "attempted",
    attemptedAt: instant(attemptedAt, "transition attempt time"), resultReceipt: null });
  return rebuildIntent(intent, { transitions: [...intent.transitions, record] });
}

export function withTransitionComplete({ intent: rawIntent, plan, resultReceipt, completedAt }) {
  const intent = normalizeLaneConvergenceIntent(rawIntent, plan);
  const index = intent.transitions.length - 1;
  const current = intent.transitions[index];
  if (!current || current.status !== "attempted") throw new Error("No attempted transition awaits completion.");
  const receipt = normalizeResultReceipt(resultReceipt, current.decision);
  const completed = transitionRecord({ decision: current.decision, status: "complete",
    attemptedAt: current.attemptedAt, completedAt: instant(completedAt, "transition completion time"),
    resultReceipt: receipt });
  return rebuildIntent(intent, { transitions: [...intent.transitions.slice(0, index), completed] });
}

export function completeLaneConvergenceIntent({ intent: rawIntent, plan, terminal }) {
  const intent = normalizeLaneConvergenceIntent(rawIntent, plan);
  if (intent.transitions.some((item) => item.status !== "complete")) {
    throw new Error("Lane convergence cannot complete with an attempted transition.");
  }
  return rebuildIntent(intent, { status: "complete", terminal: normalizeTerminal(terminal, plan) });
}

export function buildLaneConvergenceReceipt({ plan: rawPlan, intent: rawIntent }) {
  const plan = normalizeLaneConvergencePlan(rawPlan);
  const intent = normalizeLaneConvergenceIntent(rawIntent, plan);
  if (intent.status !== "complete") throw new Error("Lane convergence terminal receipt requires completion.");
  const core = {
    schema: RECEIPT_SCHEMA,
    transactionId: plan.transactionId,
    planDigest: plan.planDigest,
    authorizationReceiptDigest: intent.authorization.receiptDigest,
    transitionCount: intent.transitions.length,
    transitionReceiptDigests: intent.transitions.map((item) => item.resultReceipt.receiptDigest),
    terminalReceiptDigests: intent.terminal.receipts.map((item) => item.receiptDigest),
    completedAt: intent.terminal.completedAt,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeAdapterDescriptor(value) {
  exactKeys(value, ["id", "version", "moduleDigest", "configurationDigest", "actions"], "adapter descriptor");
  if (!Array.isArray(value.actions) || value.actions.length < 1) invalid("adapter actions");
  const actions = value.actions.map((item) => {
    exactKeys(item, ["action", "effects"], "adapter action");
    return Object.freeze({ action: text(item.action, "adapter action"),
      effects: normalizeEffects(item.effects, "adapter effects") });
  });
  if (new Set(actions.map((item) => item.action)).size !== actions.length) invalid("duplicate adapter action");
  return Object.freeze({ id: text(value.id, "adapter id"), version: text(value.version, "adapter version"),
    moduleDigest: digest(value.moduleDigest, "adapter module digest"),
    configurationDigest: digest(value.configurationDigest, "adapter configuration digest"),
    actions: Object.freeze(actions) });
}

function normalizeLaneConvergenceRequest(value) {
  exactKeys(value, ["schema", "transactionId", "objective", "subjects", "maxTransitions",
    "terminalReceiptTypes"], "request");
  if (value.schema !== REQUEST_SCHEMA || !Array.isArray(value.subjects) || value.subjects.length < 1) {
    invalid("request identity");
  }
  const subjects = value.subjects.map(normalizeSubject);
  const ids = new Set(subjects.map((item) => item.subjectId));
  if (ids.size !== subjects.length) invalid("duplicate subject");
  for (const subject of subjects) for (const dependency of subject.dependencies) {
    if (!ids.has(dependency) || dependency === subject.subjectId) invalid("subject dependency");
  }
  assertAcyclic(subjects);
  if (!Array.isArray(value.terminalReceiptTypes) || value.terminalReceiptTypes.length < 1) {
    invalid("terminal receipt types");
  }
  const terminalReceiptTypes = value.terminalReceiptTypes.map((item) => text(item, "receipt type"));
  if (new Set(terminalReceiptTypes).size !== terminalReceiptTypes.length) invalid("duplicate receipt type");
  return Object.freeze({ schema: REQUEST_SCHEMA, transactionId: text(value.transactionId, "transaction id"),
    objective: text(value.objective, "objective"), subjects: Object.freeze(subjects),
    maxTransitions: bounded(value.maxTransitions, 1, 128, "max transitions"),
    terminalReceiptTypes: Object.freeze(terminalReceiptTypes) });
}

function normalizeSubject(value) {
  exactKeys(value, ["subjectId", "repository", "lane", "targetState", "dependencies",
    "allowedActions", "effectCeiling"], "subject");
  if (!Array.isArray(value.dependencies) || !Array.isArray(value.allowedActions)
    || value.allowedActions.length < 1) invalid("subject lists");
  if (new Set(value.dependencies).size !== value.dependencies.length
    || new Set(value.allowedActions).size !== value.allowedActions.length) invalid("duplicate subject list item");
  return Object.freeze({ subjectId: text(value.subjectId, "subject id"),
    repository: text(value.repository, "repository"), lane: text(value.lane, "lane"),
    targetState: text(value.targetState, "target state"),
    dependencies: Object.freeze(value.dependencies.map((item) => text(item, "dependency"))),
    allowedActions: Object.freeze(value.allowedActions.map((item) => text(item, "allowed action"))),
    effectCeiling: normalizeEffects(value.effectCeiling, "effect ceiling") });
}

function normalizeAuthorizationReceipt(value, plan) {
  exactKeys(value, ["schema", "planDigest", "authorizationDigest", "authorizedAt", "receiptDigest"], "authorization receipt");
  const core = { schema: AUTHORIZATION_SCHEMA, planDigest: plan.planDigest,
    authorizationDigest: digest(value.authorizationDigest, "authorization digest"),
    authorizedAt: instant(value.authorizedAt, "authorization time") };
  if (value.schema !== AUTHORIZATION_SCHEMA || value.planDigest !== plan.planDigest
    || value.receiptDigest !== digestValue(core)) invalid("authorization receipt");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeTransitionRecord(value, plan, index) {
  exactKeys(value, ["decision", "status", "attemptedAt", "completedAt", "resultReceipt", "recordDigest"], `transition ${index}`);
  const decision = normalizeTransitionDecision(value.decision, plan);
  if (!["attempted", "complete"].includes(value.status)) invalid("transition status");
  const completedAt = value.status === "complete" ? instant(value.completedAt, "completed at") : null;
  const resultReceipt = value.status === "complete" ? normalizeResultReceipt(value.resultReceipt, decision) : null;
  if (value.status === "attempted" && (value.completedAt !== null || value.resultReceipt !== null)) invalid("attempted transition");
  const record = transitionRecord({ decision, status: value.status,
    attemptedAt: instant(value.attemptedAt, "attempted at"), completedAt, resultReceipt });
  if (record.recordDigest !== value.recordDigest) invalid("transition record digest");
  return record;
}

function transitionRecord({ decision, status, attemptedAt, completedAt = null, resultReceipt = null }) {
  const core = { decision, status, attemptedAt, completedAt, resultReceipt };
  return Object.freeze({ ...core, recordDigest: digestValue(core) });
}

function normalizeResultReceipt(value, decision) {
  exactKeys(value, ["schema", "operationKey", "transitionDigest", "status", "evidenceDigest", "receiptDigest"], "transition receipt");
  if (value.status !== "complete" || value.operationKey !== decision.operationKey
    || value.transitionDigest !== decision.transitionDigest) invalid("transition receipt identity");
  const core = { schema: text(value.schema, "transition receipt schema"), operationKey: value.operationKey,
    transitionDigest: value.transitionDigest, status: "complete",
    evidenceDigest: digest(value.evidenceDigest, "transition evidence") };
  if (value.receiptDigest !== digestValue(core)) invalid("transition receipt digest");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeTerminal(value, plan) {
  exactKeys(value, ["subjects", "receipts", "completedAt", "terminalDigest"], "terminal evidence");
  if (!Array.isArray(value.subjects) || value.subjects.length !== plan.subjects.length
    || !Array.isArray(value.receipts)) invalid("terminal evidence lists");
  const subjects = value.subjects.map((item) => {
    exactKeys(item, ["subjectId", "state", "evidenceDigest"], "terminal subject");
    const expected = plan.subjects.find((subject) => subject.subjectId === item.subjectId);
    if (!expected || item.state !== expected.targetState) invalid("terminal subject state");
    return Object.freeze({ subjectId: item.subjectId, state: item.state,
      evidenceDigest: digest(item.evidenceDigest, "terminal subject evidence") });
  });
  if (new Set(subjects.map((item) => item.subjectId)).size !== subjects.length) invalid("duplicate terminal subject");
  const types = new Set();
  const receipts = value.receipts.map((item) => {
    exactKeys(item, ["type", "receiptDigest"], "terminal receipt");
    types.add(text(item.type, "terminal receipt type"));
    return Object.freeze({ type: item.type, receiptDigest: digest(item.receiptDigest, "terminal receipt digest") });
  });
  if (types.size !== receipts.length) invalid("duplicate terminal receipt type");
  for (const required of plan.terminalReceiptTypes) if (!types.has(required)) invalid(`missing ${required} receipt`);
  const core = { subjects: Object.freeze(subjects), receipts: Object.freeze(receipts),
    completedAt: instant(value.completedAt, "terminal completion time") };
  if (value.terminalDigest !== digestValue(core)) invalid("terminal digest");
  return Object.freeze({ ...core, terminalDigest: value.terminalDigest });
}

function rebuildIntent(intent, changes) {
  const core = { schema: INTENT_SCHEMA, planDigest: intent.planDigest, status: intent.status,
    authorization: intent.authorization, transitions: intent.transitions, terminal: intent.terminal,
    ...changes };
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}

function normalizeEffects(value, label) {
  exactKeys(value, EFFECT_KEYS, label);
  for (const key of EFFECT_KEYS) if (typeof value[key] !== "boolean") invalid(label);
  return Object.freeze(Object.fromEntries(EFFECT_KEYS.map((key) => [key, value[key]])));
}
function assertAcyclic(subjects) {
  const dependencies = new Map(subjects.map((subject) => [subject.subjectId, subject.dependencies]));
  const visiting = new Set();
  const visited = new Set();
  function visit(subjectId) {
    if (visiting.has(subjectId)) invalid("cyclic subject dependency");
    if (visited.has(subjectId)) return;
    visiting.add(subjectId);
    for (const dependency of dependencies.get(subjectId)) visit(dependency);
    visiting.delete(subjectId);
    visited.add(subjectId);
  }
  for (const subject of subjects) visit(subject.subjectId);
}
function assertEffectsWithin(actual, ceiling, label) {
  for (const key of EFFECT_KEYS) if (actual[key] && !ceiling[key]) invalid(label);
}
function exactKeys(value, keys, label) { record(value, label); if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function bounded(value, min, max, label) { if (!Number.isSafeInteger(value) || value < min || value > max) invalid(label); return value; }
function instant(value, label) { const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) invalid(label); return date.toISOString(); }
function invalid(label) { throw new Error(`Lane convergence has invalid ${label}.`); }
