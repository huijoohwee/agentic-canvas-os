// Responsibility: Bind exact authority and monotonic receipts for reviewed-to-authoring correction.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeReviewedLaneSourceCorrectionEvidence,
} from "./reviewed-lane-source-correction-evidence.mjs";

export const PLAN_SCHEMA = "agentic-reviewed-lane-source-correction-plan/v1";
export const AUTHORIZATION_SCHEMA =
  "agentic-reviewed-lane-source-correction-authorization/v1";
export const INTENT_SCHEMA = "agentic-reviewed-lane-source-correction-intent/v1";
export const PHASE_RECEIPT_SCHEMA =
  "agentic-reviewed-lane-source-correction-phase-receipt/v1";
export const COMPLETION_SCHEMA =
  "agentic-reviewed-lane-source-correction-completion/v1";

export const PHASES = Object.freeze([
  "prepared",
  "successor_waiting",
  "source_retired",
  "successor_current",
  "lease_activated",
  "pr_drafted",
  "verified",
  "complete",
]);

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildReviewedLaneSourceCorrectionPlan({
  source,
  operatorSessionId,
} = {}) {
  const evidence = normalizeReviewedLaneSourceCorrectionEvidence(source);
  const operatorSession = text(operatorSessionId, "operator session");
  if (operatorSession === evidence.lease.sessionId) {
    throw new Error("Source correction requires distinct source and operator sessions.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: "reviewed-lane-source-correction",
    source: evidence,
    sourceClaimId: evidence.claim.claimId,
    sourceHeadSha: evidence.localHeadSha,
    sourceReviewRequestId: `github-pull-request:${evidence.pullRequest.nodeId}`,
    pullRequestNumber: evidence.pullRequest.number,
    operatorSessionId: operatorSession,
    successorLeaseEpoch: evidence.claim.leaseEpoch + 1,
    disposition: "same-owner-authoring-restored",
    forbiddenEffects: Object.freeze([
      "source-byte-change", "commit", "push", "merge", "cleanup", "deployment",
    ]),
  };
  const planDigest = digestValue(core);
  return freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize reviewed-lane-source-correction ${planDigest}`,
  });
}

export function normalizeReviewedLaneSourceCorrectionPlan(value) {
  if (value?.schema !== PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildReviewedLaneSourceCorrectionPlan({
    source: value.source,
    operatorSessionId: value.operatorSessionId,
  });
  exactKeys(value, Object.keys(rebuilt), "plan");
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeReviewedLaneSourceCorrection({ plan, authorization } = {}) {
  const normalized = normalizeReviewedLaneSourceCorrectionPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Source correction requires exact authorization: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    statement: authorization,
  };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createReviewedLaneSourceCorrectionIntent(plan, authorization) {
  const normalized = normalizeReviewedLaneSourceCorrectionPlan(plan);
  const authority = authorizeReviewedLaneSourceCorrection({ plan: normalized, authorization });
  const prepared = phaseReceipt({
    plan: normalized,
    phase: "prepared",
    priorIntentDigest: null,
    values: { authorizationDigest: authority.authorizationDigest },
  });
  return sealIntent({
    status: "prepared",
    plan: normalized,
    authorization: authority,
    phases: { prepared },
    completion: null,
  });
}

export function advanceReviewedLaneSourceCorrectionIntent(intent, {
  status,
  values = {},
} = {}) {
  const current = normalizeReviewedLaneSourceCorrectionIntent(intent);
  const next = phase(status);
  const currentIndex = PHASES.indexOf(current.status);
  const nextIndex = PHASES.indexOf(next);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
    throw new Error("Source correction intent cannot skip or regress a protected phase.");
  }
  const normalizedValues = plain(values, "phase values");
  if (nextIndex === currentIndex) {
    const existing = current.phases[next];
    if (existing.valuesDigest !== digestValue(normalizedValues)) invalid("phase replay");
    return current;
  }
  const receipt = phaseReceipt({
    plan: current.planSnapshot,
    phase: next,
    priorIntentDigest: current.intentDigest,
    values: normalizedValues,
  });
  const phases = { ...current.phases, [next]: receipt };
  const completion = next === "complete"
    ? completionReceipt(current.planSnapshot, normalizedValues.receipt, current.intentDigest)
    : null;
  return sealIntent({
    status: next,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizeReviewedLaneSourceCorrectionIntent(value) {
  if (value?.schema !== INTENT_SCHEMA) invalid("intent schema");
  const status = phase(value.status);
  const plan = normalizeReviewedLaneSourceCorrectionPlan(value.planSnapshot);
  const authorization = authorizeReviewedLaneSourceCorrection({
    plan,
    authorization: value.authorization?.statement,
  });
  const expected = PHASES.slice(0, PHASES.indexOf(status) + 1);
  exactKeys(value.phases, expected, "intent phases");
  let prior = null;
  const phases = {};
  for (const name of expected) {
    phases[name] = normalizePhaseReceipt(value.phases[name], plan, name, prior);
    prior = intentDigest({ status: name, plan, authorization, phases: { ...phases },
      completion: name === "complete" ? value.completion : null });
  }
  const completion = status === "complete"
    ? completionReceipt(plan, value.completion, phases.verified?.intentDigest || null)
    : value.completion === null ? null : invalid("non-terminal completion");
  const core = {
    schema: INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    authorizationDigest: authorization.authorizationDigest,
    phases,
    completion,
  };
  exactKeys(value, [...Object.keys(core), "intentDigest"], "intent");
  if (value.intentDigest !== digestValue(core)) invalid("intent digest");
  return freeze({ ...core, intentDigest: value.intentDigest });
}

export function operationKey(plan, phaseName) {
  const normalized = normalizeReviewedLaneSourceCorrectionPlan(plan);
  const name = phase(phaseName);
  return `reviewed-lane-source-correction:${name}:${digestValue({
    planDigest: normalized.planDigest,
    phase: name,
  })}`;
}

export function buildCompletionReceipt(plan, values) {
  const normalized = normalizeReviewedLaneSourceCorrectionPlan(plan);
  const result = plain(values, "completion values");
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "authoring-restored",
    planDigest: normalized.planDigest,
    sourceClaimId: normalized.sourceClaimId,
    sourceHeadSha: normalized.sourceHeadSha,
    successorClaimId: digest(result.successorClaimId, "successor claim"),
    successorClaimDigest: digest(result.successorClaimDigest, "successor claim digest"),
    leaseDigest: digest(result.leaseDigest, "lease digest"),
    pullRequestDigest: digest(result.pullRequestDigest, "pull-request digest"),
    verificationDigest: digest(result.verificationDigest, "verification digest"),
    disposition: "same-owner-authoring-restored",
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function phaseReceipt({ plan, phase: name, priorIntentDigest, values }) {
  const normalizedValues = plain(values, "phase values");
  const core = {
    schema: PHASE_RECEIPT_SCHEMA,
    phase: phase(name),
    planDigest: plan.planDigest,
    operationKey: operationKey(plan, name),
    intentDigest: priorIntentDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseReceipt(value, plan, name, prior) {
  const expected = phaseReceipt({ plan, phase: name, priorIntentDigest: prior, values: value?.values });
  if (JSON.stringify(value) !== JSON.stringify(expected)) invalid(`${name} receipt`);
  return expected;
}

function completionReceipt(plan, value, priorIntentDigest) {
  const normalized = buildCompletionReceipt(plan, value);
  if (value?.receiptDigest && JSON.stringify(value) !== JSON.stringify(normalized)) {
    invalid("completion receipt");
  }
  if (priorIntentDigest === undefined) invalid("completion lineage");
  return normalized;
}

function sealIntent({ status, plan, authorization, phases, completion }) {
  const core = {
    schema: INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    authorizationDigest: authorization.authorizationDigest,
    phases,
    completion,
  };
  return freeze({ ...core, intentDigest: digestValue(core) });
}
function intentDigest({ status, plan, authorization, phases, completion }) {
  return digestValue({ schema: INTENT_SCHEMA, status, planDigest: plan.planDigest,
    planSnapshot: plan, authorization, authorizationDigest: authorization.authorizationDigest,
    phases, completion });
}
function phase(value) {
  if (!PHASES.includes(value)) invalid("phase");
  return value;
}
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return JSON.parse(JSON.stringify(value));
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(label);
  return value;
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label);
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Reviewed-lane source correction ${label} is invalid.`); }
