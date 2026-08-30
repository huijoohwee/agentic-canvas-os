// Responsibility: Re-seal one exact continuation after its durable PR-marker checkpoint.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  CONTINUATION_AUTHORIZATION_SCHEMA,
  CONTINUATION_OPERATION,
  buildSuccessorRolloverContinuationPlan,
  normalizeSuccessorRolloverContinuationPlan,
  requireSuccessorRolloverContinuationJournal,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs";
import {
  buildSuccessorRolloverContinuationFrame,
  normalizeSuccessorRolloverContinuationFrame,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs";
import { requireProtectedMainEquivalent } from "./device-branch-ownership-lib.mjs";

const IMMUTABLE_FRAME_KEYS = [
  "owner", "replacementClaim", "boundReplacement", "reviewRequest", "historicalBindProof",
];
export const CONTINUATION_REFRESH_PLAN_SCHEMA =
  `agentic-${CONTINUATION_OPERATION}-refresh-plan/v1`;
const CHECKPOINT_PHASES = ["replacement-bound", "local-cas", "pr-marker"];
const JOURNAL_STATUSES = ["pr-marker", "verified", "complete"];

export function buildSuccessorRolloverContinuationRefreshFrame({
  priorPlan,
  currentJournal,
  liveBoundValues,
  liveLocalValues,
  livePullRequestValues,
  protectedControllerAdvance,
  repairedControllerDigest,
  gitText,
} = {}) {
  const { prior } = requireRefreshCheckpoint({
    priorPlan, currentJournal, liveBoundValues, liveLocalValues, livePullRequestValues,
  });
  const previous = prior.continuationFrameSnapshot;
  const frame = rebuildFrame({ prior, protectedControllerAdvance, repairedControllerDigest });
  requireRefreshFrame({ prior, frame });
  if (typeof gitText !== "function") invalid("protected-controller Git reader");
  requireProtectedMainEquivalent({
    planned: previous.protectedControllerAdvance.advance,
    observed: frame.protectedControllerAdvance.advance,
    gitText,
  });
  return frame;
}

export function rebuildSuccessorRolloverAuthorizedPrMarkerFrame({
  priorPlan,
  currentJournal,
  liveBoundValues,
  liveLocalValues,
  livePullRequestValues,
  protectedControllerAdvance,
  repairedControllerDigest,
} = {}) {
  const { prior } = requireRefreshCheckpoint({ priorPlan, currentJournal,
    liveBoundValues, liveLocalValues, livePullRequestValues });
  const frame = rebuildFrame({ prior, protectedControllerAdvance, repairedControllerDigest });
  if (canonicalJson(frame) !== canonicalJson(prior.continuationFrameSnapshot)) {
    invalid("authorized PR-marker frame replay");
  }
  return frame;
}

export function buildSuccessorRolloverContinuationRefreshPlan({
  priorPlan,
  currentJournal,
  frame,
  operatorSessionId,
} = {}) {
  const { priorAuthority, prior, current } = requireRefreshCheckpoint({ priorPlan, currentJournal });
  const refreshed = normalizeSuccessorRolloverContinuationFrame(frame, {
    replacementPlan: prior.replacementPlanSnapshot,
    journal: prior.sourceJournalSnapshot,
  });
  requireRefreshFrame({ prior, frame: refreshed });
  const continuationPlan = buildSuccessorRolloverContinuationPlan({
    replacementPlan: prior.replacementPlanSnapshot,
    journal: prior.sourceJournalSnapshot,
    frame: refreshed,
    operatorSessionId,
  });
  if (continuationPlan.planDigest === prior.planDigest) invalid("fresh continuation plan");
  const core = {
    schema: CONTINUATION_REFRESH_PLAN_SCHEMA,
    operation: CONTINUATION_OPERATION,
    kind: "pr-marker-refresh",
    operatorSessionId: continuationPlan.operatorSessionId,
    priorPlanDigest: priorAuthority.planDigest,
    priorPlanSnapshot: priorAuthority,
    checkpointJournalDigest: current.journalDigest,
    checkpointJournalSnapshot: current,
    continuationPlanDigest: continuationPlan.planDigest,
    continuationPlanSnapshot: continuationPlan,
    allowedEffects: ["terminal-verification", "private-external-journal",
      "private-continuation-authorization-sidecar", "terminal-verification-reconciliation"],
    forbiddenEffects: ["source-change", "replacement-claim", "replacement-promotion",
      "replacement-bind", "bind-exact-promoted-replacement", "reconcile-exact-bound-replacement",
      "local-cas", "atomic-local-lease-intent-supersession", "pull-request-marker",
      "exact-pull-request-marker-replacement", "response-loss-reconciliation", "git-ref-change",
      "commit", "push", "merge", "deployment", "cleanup"],
  };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize ${CONTINUATION_OPERATION} ${planDigest}` });
}

export function isSuccessorRolloverContinuationRefreshPlan(value) {
  return value?.schema === CONTINUATION_REFRESH_PLAN_SCHEMA;
}

export function normalizeSuccessorRolloverContinuationAuthorityPlan(value) {
  return isSuccessorRolloverContinuationRefreshPlan(value)
    ? normalizeSuccessorRolloverContinuationRefreshPlan(value)
    : normalizeSuccessorRolloverContinuationPlan(value);
}

export function normalizeSuccessorRolloverContinuationRefreshPlan(value) {
  if (!isSuccessorRolloverContinuationRefreshPlan(value)
    || value.operation !== CONTINUATION_OPERATION) invalid("refresh plan schema");
  const rebuilt = buildSuccessorRolloverContinuationRefreshPlan({
    priorPlan: value.priorPlanSnapshot,
    currentJournal: value.checkpointJournalSnapshot,
    frame: value.continuationPlanSnapshot?.continuationFrameSnapshot,
    operatorSessionId: value.operatorSessionId,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("refresh plan projection");
  return rebuilt;
}

export function authorizeSuccessorRolloverContinuationRefresh({ plan, authorization } = {}) {
  const sealed = normalizeSuccessorRolloverContinuationRefreshPlan(plan);
  if (authorization !== sealed.exactAuthorization) {
    throw new Error(`Successor rollover continuation requires exact authorization: ${sealed.exactAuthorization}`);
  }
  const core = { schema: CONTINUATION_AUTHORIZATION_SCHEMA, operation: CONTINUATION_OPERATION,
    planDigest: sealed.planDigest, statement: authorization };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function normalizeSuccessorRolloverContinuationRefreshAuthorization(value, { plan } = {}) {
  const sealed = normalizeSuccessorRolloverContinuationRefreshPlan(plan);
  exactObject(value, "refresh authorization", ["schema", "operation", "planDigest",
    "statement", "authorizationDigest"]);
  const statement = `authorize ${CONTINUATION_OPERATION} ${sealed.planDigest}`;
  const core = { schema: value.schema, operation: value.operation,
    planDigest: value.planDigest, statement: value.statement };
  if (core.schema !== CONTINUATION_AUTHORIZATION_SCHEMA || core.operation !== CONTINUATION_OPERATION
    || core.planDigest !== sealed.planDigest || core.statement !== statement
    || value.authorizationDigest !== digestValue(core)) invalid("refresh authorization");
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

export function requireSuccessorRolloverContinuationRefreshJournal({
  plan, journal, exactCheckpoint = false,
} = {}) {
  const sealed = normalizeSuccessorRolloverContinuationRefreshPlan(plan);
  const current = requireSuccessorRolloverContinuationJournal({
    plan: sealed.continuationPlanSnapshot, journal,
  });
  const checkpoint = sealed.checkpointJournalSnapshot;
  if (exactCheckpoint) {
    if (canonicalJson(current) !== canonicalJson(checkpoint)) invalid("exact PR-marker checkpoint");
  } else if (!JOURNAL_STATUSES.includes(current.replacement.status)
    || CHECKPOINT_PHASES.some(phase => canonicalJson(current.replacement.phases[phase])
      !== canonicalJson(checkpoint.replacement.phases[phase]))) {
    invalid("monotonic PR-marker checkpoint");
  }
  return current;
}

export function requireSuccessorRolloverContinuationRefreshCheckpoint({
  priorPlan,
  currentJournal,
  liveBoundValues,
  liveLocalValues,
  livePullRequestValues,
} = {}) {
  return requireRefreshCheckpoint({
    priorPlan, currentJournal, liveBoundValues, liveLocalValues, livePullRequestValues,
  }).current;
}

function requireRefreshCheckpoint(input) {
  const priorAuthority = normalizeSuccessorRolloverContinuationAuthorityPlan(input.priorPlan);
  const prior = isSuccessorRolloverContinuationRefreshPlan(priorAuthority)
    ? priorAuthority.continuationPlanSnapshot : priorAuthority;
  const current = requireSuccessorRolloverContinuationJournal({
    plan: prior,
    journal: input.currentJournal,
  });
  if (prior.continuationDisposition !== "bound-response-ahead"
    || current.replacement.status !== "pr-marker") invalid("PR-marker refresh checkpoint");
  const live = [input.liveBoundValues, input.liveLocalValues, input.livePullRequestValues];
  if (live.some(value => value !== undefined)) {
    const phases = ["replacement-bound", "local-cas", "pr-marker"];
    if (live.some(value => !value || typeof value !== "object" || Array.isArray(value))
      || phases.some((phase, index) => canonicalJson(current.replacement.phases[phase].values)
        !== canonicalJson(live[index]))) invalid("live PR-marker phase join");
  }
  return { priorAuthority, prior, current };
}

function requireRefreshFrame({ prior, frame }) {
  const previous = prior.continuationFrameSnapshot;
  if (IMMUTABLE_FRAME_KEYS.some(key => canonicalJson(frame[key]) !== canonicalJson(previous[key]))
    || frame.continuationDisposition !== "bound-response-ahead"
    || frame.repairedControllerDigest === prior.repairedControllerDigest
    || frame.protectedControllerAdvance.protectedMainSha
      === previous.protectedControllerAdvance.protectedMainSha) {
    invalid("continuation refresh frame");
  }
}

function rebuildFrame({ prior, protectedControllerAdvance, repairedControllerDigest }) {
  const previous = prior.continuationFrameSnapshot;
  return buildSuccessorRolloverContinuationFrame({
    replacementPlan: prior.replacementPlanSnapshot,
    journal: prior.sourceJournalSnapshot,
    owner: previous.owner,
    replacementClaim: previous.replacementClaim,
    boundReplacement: previous.boundReplacement,
    reviewRequest: previous.reviewRequest,
    protectedControllerAdvance,
    repairedControllerDigest,
  });
}

function invalid(label) {
  throw new Error(`Successor-rollover continuation refresh has invalid ${label}.`);
}
function exactObject(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
