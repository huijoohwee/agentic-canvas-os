// Responsibility: content-bind one empty coordination lane retirement and its replay-safe receipts.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeDormantEmptyCoordinationRetirementEvidence } from
  "./dormant-empty-coordination-retirement-evidence.mjs";

export const DORMANT_EMPTY_COORDINATION_RETIREMENT_PLAN_SCHEMA =
  "agentic-dormant-empty-coordination-retirement-plan/v1";
export const DORMANT_EMPTY_COORDINATION_RETIREMENT_AUTHORIZATION_SCHEMA =
  "agentic-dormant-empty-coordination-retirement-authorization/v1";
export const DORMANT_EMPTY_COORDINATION_RETIREMENT_INTENT_SCHEMA =
  "agentic-dormant-empty-coordination-retirement-intent/v1";
export const DORMANT_EMPTY_COORDINATION_RETIREMENT_RECEIPT_SCHEMA =
  "agentic-dormant-empty-coordination-retirement-receipt/v1";
export const DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES = Object.freeze([
  "authorized", "prepared", "claim-retired", "pr-close-attempted", "pr-closed",
  "verified", "complete",
]);

const STATUSES = DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES;
const EFFECT_PHASES = Object.freeze(DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES.slice(1));
const OPERATION_KEY_SCHEMA = "agentic-dormant-empty-coordination-retirement-operation-key/v1";
const EFFECTS = Object.freeze(["retire-cloud-claim", "close-pull-request"]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "source", "git", "ref", "worktree", "writer-lease", "new-claim",
  "waiting-successor", "unrelated-claim", "deployment",
]);
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildDormantEmptyCoordinationRetirementPlan(source) {
  const evidence = normalizeEvidence(source);
  const core = {
    schema: DORMANT_EMPTY_COORDINATION_RETIREMENT_PLAN_SCHEMA,
    action: "retire-dormant-empty-coordination",
    subjectClaimId: evidence.claim.claimId,
    pullRequestNumber: evidence.pullRequest.number,
    evidence,
    effects: EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    phases: DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES,
  };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize dormant-empty-coordination-retirement ${planDigest}` });
}

export function normalizeDormantEmptyCoordinationRetirementPlan(value) {
  object(value, "Retirement plan");
  const rebuilt = buildDormantEmptyCoordinationRetirementPlan(value.evidence);
  if (value.schema !== rebuilt.schema || value.action !== rebuilt.action
    || value.subjectClaimId !== rebuilt.subjectClaimId
    || value.pullRequestNumber !== rebuilt.pullRequestNumber
    || canonicalJson(value.effects) !== canonicalJson(EFFECTS)
    || canonicalJson(value.forbiddenEffects) !== canonicalJson(FORBIDDEN_EFFECTS)
    || canonicalJson(value.phases) !== canonicalJson(DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES)
    || value.planDigest !== rebuilt.planDigest
    || value.exactAuthorization !== rebuilt.exactAuthorization
    || digestValue(value) !== digestValue(rebuilt)) {
    throw new Error("Dormant empty coordination retirement plan is invalid or drifted.");
  }
  return rebuilt;
}

export function authorizeDormantEmptyCoordinationRetirement({ plan, authorization }) {
  const normalized = normalizeDormantEmptyCoordinationRetirementPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: DORMANT_EMPTY_COORDINATION_RETIREMENT_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    authorization: normalized.exactAuthorization,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createDormantEmptyCoordinationRetirementIntent({ plan, authorizationReceipt }) {
  const normalizedPlan = normalizeDormantEmptyCoordinationRetirementPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: DORMANT_EMPTY_COORDINATION_RETIREMENT_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    phases: {},
  });
}

export function normalizeDormantEmptyCoordinationRetirementIntent(value) {
  object(value, "Retirement intent");
  const plan = normalizeDormantEmptyCoordinationRetirementPlan(value.planSnapshot);
  const status = requiredStatus(value.status);
  const authorizationDigest = digest(value.authorizationDigest, "intent authorization digest");
  const phases = normalizeIntentPhases(value.phases, plan, status, authorizationDigest);
  const core = {
    schema: text(value.schema, "intent schema"),
    planDigest: digest(value.planDigest, "intent plan digest"),
    planSnapshot: plan,
    authorizationDigest,
    status,
    phases,
  };
  if (core.schema !== DORMANT_EMPTY_COORDINATION_RETIREMENT_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest || value.intentDigest !== digestValue(core)) {
    throw new Error("Dormant empty coordination retirement intent is invalid or drifted.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function advanceDormantEmptyCoordinationRetirementIntent(intent, { status, values }) {
  const current = normalizeDormantEmptyCoordinationRetirementIntent(intent);
  const nextStatus = requiredStatus(status);
  const currentIndex = STATUSES.indexOf(current.status);
  const nextIndex = STATUSES.indexOf(nextStatus);
  const normalizedValues = normalizePhaseValues(values, current.planSnapshot, nextStatus);
  if (nextIndex === currentIndex) {
    if (canonicalJson(current.phases[nextStatus]?.values) !== canonicalJson(normalizedValues)) {
      throw new Error(`Retirement ${nextStatus} replay drifted.`);
    }
    return current;
  }
  if (nextStatus === "authorized" || nextIndex !== currentIndex + 1) {
    throw new Error(`Retirement cannot advance from ${current.status} to ${nextStatus}.`);
  }
  let valuesWithReceipt = normalizedValues;
  if (nextStatus === "complete") {
    const receipt = normalizeReceipt(normalizedValues.receipt, {
      plan: current.planSnapshot,
      authorizationDigest: current.authorizationDigest,
      verifiedIntentDigest: current.intentDigest,
      operationKey: normalizedValues.operationKey,
      evidenceDigest: normalizedValues.evidenceDigest,
    });
    valuesWithReceipt = deepFreeze({ ...normalizedValues, receipt });
  }
  return sealIntent({ ...current, status: nextStatus,
    phases: { ...current.phases, [nextStatus]: { values: valuesWithReceipt } },
    intentDigest: undefined });
}

export function dormantEmptyCoordinationRetirementOperationKey(plan, phase) {
  const normalized = normalizeDormantEmptyCoordinationRetirementPlan(plan);
  const normalizedPhase = requiredPhase(phase);
  return digestValue({ schema: OPERATION_KEY_SCHEMA, planDigest: normalized.planDigest,
    claimId: normalized.subjectClaimId, pullRequestNumber: normalized.pullRequestNumber,
    phase: normalizedPhase });
}

export function buildDormantEmptyCoordinationRetirementReceipt({ plan, intent, values }) {
  const normalizedPlan = normalizeDormantEmptyCoordinationRetirementPlan(plan);
  const verified = normalizeDormantEmptyCoordinationRetirementIntent(intent);
  if (verified.planDigest !== normalizedPlan.planDigest || verified.status !== "verified") {
    throw new Error("Terminal receipt requires the exact verified retirement intent.");
  }
  const completion = normalizePhaseValues(values, normalizedPlan, "complete", { receipt: false });
  const claimPhase = verified.phases["claim-retired"].values;
  const providerPhase = verified.phases["pr-closed"].values;
  const verification = verified.phases.verified.values;
  const core = {
    schema: DORMANT_EMPTY_COORDINATION_RETIREMENT_RECEIPT_SCHEMA,
    status: "complete",
    planDigest: normalizedPlan.planDigest,
    authorizationDigest: verified.authorizationDigest,
    verifiedIntentDigest: verified.intentDigest,
    claimId: normalizedPlan.subjectClaimId,
    claimRetirementReceiptDigest: claimPhase.claimRetirementReceiptDigest,
    pullRequestNumber: normalizedPlan.pullRequestNumber,
    pullRequestCloseAttemptDigest: digestValue(verified.phases["pr-close-attempted"].values),
    pullRequestCloseReceiptDigest: providerPhase.pullRequestCloseReceiptDigest,
    terminalEvidenceDigest: verification.terminalEvidenceDigest,
    cloudMutation: verification.cloudMutation,
    providerMutation: verification.providerMutation,
    operationKey: completion.operationKey,
    evidenceDigest: completion.evidenceDigest,
    mutationDisposition: mutationDisposition(),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeEvidence(value) {
  return normalizeDormantEmptyCoordinationRetirementEvidence(value);
}

function normalizeAuthorization(value, plan) {
  object(value, "Authorization receipt");
  const core = { schema: text(value.schema, "authorization schema"),
    planDigest: digest(value.planDigest, "authorization plan digest"),
    authorization: text(value.authorization, "authorization text") };
  if (core.schema !== DORMANT_EMPTY_COORDINATION_RETIREMENT_AUTHORIZATION_SCHEMA
    || core.planDigest !== plan.planDigest || core.authorization !== plan.exactAuthorization
    || value.authorizationDigest !== digestValue(core)) throw new Error("Authorization receipt is invalid.");
  return Object.freeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function normalizeIntentPhases(value, plan, status, authorizationDigest) {
  object(value, "Intent phases");
  const result = {};
  for (let index = 1; index <= STATUSES.indexOf(status); index += 1) {
    const phase = STATUSES[index];
    object(value[phase], `${phase} phase`);
    result[phase] = deepFreeze({ values: normalizePhaseValues(value[phase].values, plan, phase) });
  }
  if (Object.keys(value).some(key => !Object.hasOwn(result, key))) {
    throw new Error("Intent contains an out-of-order retirement phase.");
  }
  if (result.complete) {
    const beforeComplete = { ...result }; delete beforeComplete.complete;
    const verifiedIntentDigest = digestValue({ schema: DORMANT_EMPTY_COORDINATION_RETIREMENT_INTENT_SCHEMA,
      planDigest: plan.planDigest, planSnapshot: plan, authorizationDigest,
      status: "verified", phases: beforeComplete });
    normalizeReceipt(result.complete.values.receipt, { plan, authorizationDigest, verifiedIntentDigest,
      operationKey: result.complete.values.operationKey,
      evidenceDigest: result.complete.values.evidenceDigest });
  }
  return deepFreeze(result);
}

function normalizePhaseValues(value, plan, phase, { receipt = true } = {}) {
  object(value, `${phase} values`);
  const result = { operationKey: digest(value.operationKey, `${phase} operation key`),
    evidenceDigest: digest(value.evidenceDigest, `${phase} evidence digest`) };
  if (result.operationKey !== dormantEmptyCoordinationRetirementOperationKey(plan, phase)) {
    throw new Error(`${phase} operation key is invalid.`);
  }
  if (phase === "claim-retired") {
    result.disposition = text(value.disposition, "claim retirement disposition");
    result.cloudMutation = boolean(value.cloudMutation, "claim retirement cloud mutation");
    result.providerMutation = boolean(value.providerMutation, "claim retirement provider mutation");
    result.claimRetirementReceiptDigest = digest(value.claimRetirementReceiptDigest, "claim retirement receipt");
  } else if (phase === "pr-close-attempted") {
    result.closeOperationKey = digest(value.closeOperationKey, "pull-request close operation key");
    if (result.closeOperationKey !== dormantEmptyCoordinationRetirementOperationKey(plan, "pr-closed")) {
      throw new Error("Pull-request close attempt does not bind the close operation.");
    }
    result.cloudMutation = boolean(value.cloudMutation, "close attempt cloud mutation");
    result.providerMutation = boolean(value.providerMutation, "close attempt provider mutation");
    if (result.providerMutation !== false) {
      throw new Error("Pull-request close attempt cannot report a provider mutation before the effect.");
    }
  } else if (phase === "pr-closed") {
    result.disposition = text(value.disposition, "pull-request close disposition");
    result.cloudMutation = boolean(value.cloudMutation, "pull-request close cloud mutation");
    result.providerMutation = boolean(value.providerMutation, "pull-request close provider mutation");
    result.pullRequestCloseReceiptDigest = digest(value.pullRequestCloseReceiptDigest, "pull-request close receipt");
  } else if (phase === "verified") {
    result.cloudMutation = boolean(value.cloudMutation, "verification cloud mutation");
    result.providerMutation = boolean(value.providerMutation, "verification provider mutation");
    result.terminalEvidenceDigest = digest(value.terminalEvidenceDigest, "terminal evidence digest");
  } else if (phase === "complete" && receipt) {
    result.receipt = object(value.receipt, "terminal receipt");
  }
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(Object.keys(result).sort())) {
    throw new Error(`${phase} values contain unexpected or missing fields.`);
  }
  return deepFreeze(result);
}

function normalizeReceipt(value, expected) {
  object(value, "Terminal receipt");
  const core = { ...value }; delete core.receiptDigest;
  if (core.schema !== DORMANT_EMPTY_COORDINATION_RETIREMENT_RECEIPT_SCHEMA
    || core.status !== "complete" || core.planDigest !== expected.plan.planDigest
    || core.authorizationDigest !== expected.authorizationDigest
    || core.verifiedIntentDigest !== expected.verifiedIntentDigest
    || core.claimId !== expected.plan.subjectClaimId
    || core.pullRequestNumber !== expected.plan.pullRequestNumber
    || core.operationKey !== expected.operationKey || core.evidenceDigest !== expected.evidenceDigest
    || canonicalJson(core.mutationDisposition) !== canonicalJson(mutationDisposition())
    || value.receiptDigest !== digestValue(core)) throw new Error("Terminal receipt is invalid or drifted.");
  digest(core.claimRetirementReceiptDigest, "receipt claim retirement digest");
  digest(core.pullRequestCloseAttemptDigest, "receipt pull-request close attempt digest");
  digest(core.pullRequestCloseReceiptDigest, "receipt pull-request close digest");
  digest(core.terminalEvidenceDigest, "receipt terminal evidence digest");
  boolean(core.cloudMutation, "receipt cloud mutation");
  boolean(core.providerMutation, "receipt provider mutation");
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function mutationDisposition() { return Object.freeze({ cloudClaim: "retired", pullRequest: "closed-unmerged",
  source: "unchanged", git: "unchanged", ref: "unchanged", worktree: "unchanged",
  writerLease: "unchanged", newClaim: "not-created", waitingSuccessor: "unchanged",
  unrelatedClaims: "unchanged", deployment: "not-performed" }); }
function sealIntent(value) { const core = { ...value }; delete core.intentDigest;
  const frozen = deepFreeze(core); return deepFreeze({ ...frozen, intentDigest: digestValue(frozen) }); }
function requiredPhase(value) { const phase = text(value, "retirement phase");
  if (!EFFECT_PHASES.includes(phase)) throw new Error(`Unsupported phase: ${phase}.`); return phase; }
function requiredStatus(value) { const status = text(value, "retirement status");
  if (!STATUSES.includes(status)) throw new Error(`Unsupported status: ${status}.`); return status; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`); return value.normalize("NFC").trim(); }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function boolean(value, label) { if (typeof value !== "boolean") throw new Error(`${label} is invalid.`); return value; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
