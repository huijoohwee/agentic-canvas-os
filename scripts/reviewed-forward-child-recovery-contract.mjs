// Responsibility: Bind exact authority and monotonic receipts for reviewed forward-child recovery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeReviewedForwardChildCandidate,
  normalizeReviewedForwardChildEvidence,
} from "./reviewed-forward-child-recovery-evidence.mjs";

export const PLAN_SCHEMA = "agentic-reviewed-forward-child-recovery-plan/v1";
export const INTENT_SCHEMA = "agentic-reviewed-forward-child-recovery-intent/v1";
export const COMPLETION_SCHEMA = "agentic-reviewed-forward-child-recovery-completion/v1";
export const PHASES = Object.freeze([
  "prepared",
  "auto_merge_cancelled",
  "forward_child_created",
  "successor_waiting",
  "source_retired",
  "successor_current",
  "local_ref_updated",
  "remote_ref_updated",
  "lease_activated",
  "pr_drafted",
  "verified",
  "complete",
]);

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildReviewedForwardChildPlan({ source, candidate, operatorSessionId } = {}) {
  const evidence = normalizeReviewedForwardChildEvidence(source);
  const child = normalizeReviewedForwardChildCandidate(candidate);
  const operatorSession = text(operatorSessionId, "operator session");
  if (operatorSession === evidence.source.sessionId) {
    throw new Error("Forward-child recovery requires a distinct operator session.");
  }
  if (child.sourceHeadSha !== evidence.source.headSha
    || child.sourceTreeSha !== evidence.source.treeSha) {
    throw new Error("Forward-child candidate drifted from the exact source evidence.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: "reviewed-forward-child-recovery",
    source: evidence,
    candidate: child,
    sourceClaimId: evidence.claim.claimId,
    sourceHeadSha: evidence.source.headSha,
    childHeadSha: child.childHeadSha,
    pullRequestNumber: evidence.pullRequest.number,
    operatorSessionId: operatorSession,
    successorLeaseEpoch: evidence.claim.leaseEpoch + 1,
    disposition: "same-owner-forward-child-authoring-restored",
    forbiddenEffects: Object.freeze([
      "source-tree-change", "force-push", "merge", "cleanup", "deployment",
    ]),
  };
  const planDigest = digestValue(core);
  return freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize reviewed-forward-child-recovery ${planDigest}`,
  });
}

export function normalizeReviewedForwardChildPlan(value) {
  if (value?.schema !== PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildReviewedForwardChildPlan({
    source: value.source,
    candidate: value.candidate,
    operatorSessionId: value.operatorSessionId,
  });
  exact(value, Object.keys(rebuilt), "plan");
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeReviewedForwardChild({ plan, authorization } = {}) {
  const normalized = normalizeReviewedForwardChildPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Forward-child recovery requires exact authorization: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: "agentic-reviewed-forward-child-recovery-authorization/v1",
    planDigest: normalized.planDigest,
    statement: authorization,
  };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createReviewedForwardChildIntent(plan, authorization) {
  const normalized = normalizeReviewedForwardChildPlan(plan);
  const authority = authorizeReviewedForwardChild({ plan: normalized, authorization });
  const prepared = phaseReceipt(normalized, "prepared", null, {
    authorizationDigest: authority.authorizationDigest,
  });
  return seal({
    status: "prepared",
    plan: normalized,
    authorization: authority,
    phases: { prepared },
    completion: null,
  });
}

export function advanceReviewedForwardChildIntent(intent, { status, values = {} } = {}) {
  const current = normalizeReviewedForwardChildIntent(intent);
  const next = phase(status);
  const currentIndex = PHASES.indexOf(current.status);
  const nextIndex = PHASES.indexOf(next);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
    throw new Error("Forward-child intent cannot skip or regress a protected phase.");
  }
  const normalizedValues = plain(values, "phase values");
  if (nextIndex === currentIndex) {
    if (current.phases[next].valuesDigest !== digestValue(normalizedValues)) invalid("phase replay");
    return current;
  }
  const receipt = phaseReceipt(
    current.planSnapshot,
    next,
    current.intentDigest,
    normalizedValues,
  );
  const phases = { ...current.phases, [next]: receipt };
  const completion = next === "complete"
    ? completionReceipt(current.planSnapshot, normalizedValues.receipt)
    : null;
  return seal({
    status: next,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizeReviewedForwardChildIntent(value) {
  if (value?.schema !== INTENT_SCHEMA) invalid("intent schema");
  const status = phase(value.status);
  const plan = normalizeReviewedForwardChildPlan(value.planSnapshot);
  const authorization = authorizeReviewedForwardChild({
    plan,
    authorization: value.authorization?.statement,
  });
  const expectedNames = PHASES.slice(0, PHASES.indexOf(status) + 1);
  exact(value.phases, expectedNames, "intent phases");
  let prior = null;
  const phases = {};
  for (const name of expectedNames) {
    const receipt = phaseReceipt(plan, name, prior, value.phases[name]?.values);
    if (JSON.stringify(receipt) !== JSON.stringify(value.phases[name])) invalid(`${name} receipt`);
    phases[name] = receipt;
    prior = digestValue(intentCore({ status: name, plan, authorization, phases: { ...phases },
      completion: name === "complete" ? value.completion : null }));
  }
  const completion = status === "complete"
    ? completionReceipt(plan, value.completion)
    : value.completion === null ? null : invalid("non-terminal completion");
  const core = intentCore({ status, plan, authorization, phases, completion });
  exact(value, [...Object.keys(core), "intentDigest"], "intent");
  if (value.intentDigest !== digestValue(core)) invalid("intent digest");
  return freeze({ ...core, intentDigest: value.intentDigest });
}

export function operationKey(plan, phaseName) {
  const normalized = normalizeReviewedForwardChildPlan(plan);
  const name = phase(phaseName);
  return `reviewed-forward-child-recovery:${name}:${digestValue({
    planDigest: normalized.planDigest,
    phase: name,
  })}`;
}

export function buildCompletionReceipt(plan, values) {
  const normalized = normalizeReviewedForwardChildPlan(plan);
  const result = plain(values, "completion values");
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "authoring-restored",
    planDigest: normalized.planDigest,
    sourceClaimId: normalized.sourceClaimId,
    sourceHeadSha: normalized.sourceHeadSha,
    childHeadSha: normalized.childHeadSha,
    autoMergeCancellationDigest: digest(
      result.autoMergeCancellationDigest,
      "auto-merge cancellation digest",
    ),
    successorClaimId: digest(result.successorClaimId, "successor claim"),
    successorClaimDigest: digest(result.successorClaimDigest, "successor claim digest"),
    leaseDigest: digest(result.leaseDigest, "lease digest"),
    pullRequestDigest: digest(result.pullRequestDigest, "pull-request digest"),
    verificationDigest: digest(result.verificationDigest, "verification digest"),
    disposition: "same-owner-forward-child-authoring-restored",
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function phaseReceipt(plan, name, priorIntentDigest, values) {
  const normalizedValues = plain(values, "phase values");
  const core = {
    schema: "agentic-reviewed-forward-child-recovery-phase-receipt/v1",
    phase: phase(name),
    planDigest: plan.planDigest,
    operationKey: operationKey(plan, name),
    intentDigest: priorIntentDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function completionReceipt(plan, value) {
  const normalized = buildCompletionReceipt(plan, value);
  if (value?.receiptDigest && JSON.stringify(value) !== JSON.stringify(normalized)) {
    invalid("completion receipt");
  }
  return normalized;
}

function seal({ status, plan, authorization, phases, completion }) {
  const core = intentCore({ status, plan, authorization, phases, completion });
  return freeze({ ...core, intentDigest: digestValue(core) });
}

function intentCore({ status, plan, authorization, phases, completion }) {
  return {
    schema: INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    authorizationDigest: authorization.authorizationDigest,
    phases,
    completion,
  };
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
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label);
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const childValue of Object.values(value)) freeze(childValue);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Reviewed forward-child recovery ${label} is invalid.`); }
