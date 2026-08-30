// Responsibility: Seal one exact authorization to continue an already-promoted replacement.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  normalizeSuccessorRolloverJournal,
  normalizeSuccessorRolloverReplacementPlan,
} from "./active-dirty-scope-expansion-successor-rollover-contract.mjs";
import {
  normalizeSuccessorRolloverContinuationFrame,
  promotedPrefixDigest,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs";

export const CONTINUATION_OPERATION =
  "active-dirty-scope-expansion-successor-rollover-continue";
export const CONTINUATION_PLAN_SCHEMA = `agentic-${CONTINUATION_OPERATION}-plan/v1`;
export const CONTINUATION_AUTHORIZATION_SCHEMA =
  `agentic-${CONTINUATION_OPERATION}-authorization/v1`;

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildSuccessorRolloverContinuationPlan({
  replacementPlan,
  journal,
  frame,
  operatorSessionId,
} = {}) {
  const originalPlan = normalizeSuccessorRolloverReplacementPlan(replacementPlan);
  const sourceJournal = normalizeSuccessorRolloverJournal(journal);
  requirePromotedSource(sourceJournal, originalPlan);
  const sealedFrame = normalizeSuccessorRolloverContinuationFrame(frame, {
    replacementPlan: originalPlan,
    journal: sourceJournal,
  });
  const operator = text(operatorSessionId, "operator session");
  if (operator !== originalPlan.operatorSessionId) invalid("operator continuity");
  const core = {
    schema: CONTINUATION_PLAN_SCHEMA,
    operation: CONTINUATION_OPERATION,
    operatorSessionId: operator,
    replacementPlanDigest: originalPlan.planDigest,
    replacementPlanSnapshot: originalPlan,
    sourceJournalDigest: sourceJournal.journalDigest,
    sourceJournalSnapshot: sourceJournal,
    sourceReplacementIntentDigest: sourceJournal.replacement.intentDigest,
    promotedPrefixDigest: promotedPrefixDigest(sourceJournal),
    continuationFrameDigest: sealedFrame.frameDigest,
    continuationFrameSnapshot: sealedFrame,
    historicalBindProof: sealedFrame.historicalBindProof,
    protectedControllerAdvance: sealedFrame.protectedControllerAdvance,
    repairedControllerDigest: sealedFrame.repairedControllerDigest,
    allowedEffects: [
      "bind-exact-promoted-replacement",
      "atomic-local-lease-intent-supersession",
      "exact-pull-request-marker-replacement",
      "private-external-journal",
      "private-continuation-authorization-sidecar",
      "response-loss-reconciliation",
    ],
    forbiddenEffects: [
      "source-change", "replacement-claim", "replacement-promotion", "git-ref-change",
      "commit", "push", "merge", "deployment", "cleanup",
    ],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${CONTINUATION_OPERATION} ${planDigest}`,
  });
}

export function normalizeSuccessorRolloverContinuationPlan(value) {
  if (value?.schema !== CONTINUATION_PLAN_SCHEMA
    || value.operation !== CONTINUATION_OPERATION) invalid("continuation plan schema");
  const rebuilt = buildSuccessorRolloverContinuationPlan({
    replacementPlan: value.replacementPlanSnapshot,
    journal: value.sourceJournalSnapshot,
    frame: value.continuationFrameSnapshot,
    operatorSessionId: value.operatorSessionId,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("continuation plan projection");
  return rebuilt;
}

export function authorizeSuccessorRolloverContinuation({ plan, authorization } = {}) {
  const sealed = normalizeSuccessorRolloverContinuationPlan(plan);
  if (authorization !== sealed.exactAuthorization) {
    throw new Error(`Successor rollover continuation requires exact authorization: ${sealed.exactAuthorization}`);
  }
  const core = {
    schema: CONTINUATION_AUTHORIZATION_SCHEMA,
    operation: CONTINUATION_OPERATION,
    planDigest: sealed.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export const createSuccessorRolloverContinuationAuthorization =
  authorizeSuccessorRolloverContinuation;

export function normalizeSuccessorRolloverContinuationAuthorization(value, { plan } = {}) {
  if (!plan) invalid("continuation authorization plan join");
  exactObject(value, "continuation authorization", ["schema", "operation", "planDigest",
    "statement", "authorizationDigest"]);
  const planDigest = digest(value.planDigest, "continuation authorization plan");
  const expectedStatement = `authorize ${CONTINUATION_OPERATION} ${planDigest}`;
  const core = {
    schema: value.schema,
    operation: value.operation,
    planDigest,
    statement: text(value.statement, "continuation authorization statement"),
  };
  if (core.schema !== CONTINUATION_AUTHORIZATION_SCHEMA
    || core.operation !== CONTINUATION_OPERATION
    || core.statement !== expectedStatement
    || value.authorizationDigest !== digestValue(core)) invalid("continuation authorization");
  if (normalizeSuccessorRolloverContinuationPlan(plan).planDigest !== planDigest) {
    invalid("continuation authorization plan join");
  }
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

export function requireSuccessorRolloverContinuationJournal({ plan, journal } = {}) {
  const continuation = normalizeSuccessorRolloverContinuationPlan(plan);
  const current = normalizeSuccessorRolloverJournal(journal);
  const source = continuation.sourceJournalSnapshot;
  const phases = ["authorized", "replacement-claimed", "replacement-promoted"];
  const statuses = ["authorized", "replacement-claimed", "replacement-promoted",
    "replacement-bound", "local-cas", "pr-marker", "verified", "complete"];
  if (canonicalJson(current.retirement) !== canonicalJson(source.retirement)
    || current.replacement?.planDigest !== continuation.replacementPlanDigest
    || current.replacement.authorizationDigest !== source.replacement.authorizationDigest
    || canonicalJson(current.replacement.planSnapshot)
      !== canonicalJson(source.replacement.planSnapshot)
    || statuses.indexOf(current.replacement.status) < statuses.indexOf("replacement-promoted")
    || phases.some(phase => canonicalJson(current.replacement.phases[phase])
      !== canonicalJson(source.replacement.phases[phase]))
    || promotedPrefixDigest(current) !== continuation.promotedPrefixDigest) {
    invalid("monotonic continuation journal");
  }
  return current;
}

function requirePromotedSource(journal, plan) {
  if (journal.replacement?.status !== "replacement-promoted"
    || journal.replacement.planDigest !== plan.planDigest
    || journal.retirement.intentDigest !== plan.retirementIntentDigest) {
    invalid("replacement-promoted source journal");
  }
}

function exactObject(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) {
  throw new Error(`Active dirty scope-expansion successor rollover has invalid ${label}.`);
}
