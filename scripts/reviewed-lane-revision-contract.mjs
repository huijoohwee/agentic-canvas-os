import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { requireProtectedSquashSubject } from "./protected-squash-subject.mjs";
import {
  normalizeReviewedLaneRevisionCommitCandidate,
  normalizeReviewedLaneRevisionSourceEvidence,
} from "./reviewed-lane-revision-evidence.mjs";

export const REVIEWED_LANE_REVISION_PLAN_SCHEMA =
  "agentic-reviewed-lane-revision-plan/v1";
export const REVIEWED_LANE_REVISION_AUTHORIZATION_SCHEMA =
  "agentic-reviewed-lane-revision-authorization/v1";
export const REVIEWED_LANE_REVISION_INTENT_SCHEMA =
  "agentic-reviewed-lane-revision-intent/v1";
export const REVIEWED_LANE_REVISION_RECEIPT_SCHEMA =
  "agentic-reviewed-lane-revision-receipt/v1";

export const REVIEWED_LANE_REVISION_PHASES = Object.freeze([
  "prepared",
  "successor_waiting",
  "commit_created",
  "local_ref_updated",
  "remote_ref_updated",
  "source_retired",
  "successor_current",
  "successor_bound",
  "successor_review_ready",
  "lease_updated",
  "pr_projected",
  "verified",
  "complete",
]);

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildReviewedLaneRevisionPlan({
  source,
  replacementSubject,
  candidate,
} = {}) {
  const evidence = normalizeReviewedLaneRevisionSourceEvidence(source);
  const commitCandidate = normalizeReviewedLaneRevisionCommitCandidate(candidate);
  const subject = requireProtectedSquashSubject(replacementSubject, {
    label: "Reviewed-lane replacement subject",
  });
  assertPlanCommitJoin(evidence, commitCandidate, subject);
  const core = planCore({ evidence, commitCandidate, replacementSubject: subject });
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize reviewed-lane-revision ${planDigest}`,
  });
}

export function normalizeReviewedLaneRevisionPlan(value) {
  if (value?.schema !== REVIEWED_LANE_REVISION_PLAN_SCHEMA) {
    throw new Error("Reviewed-lane revision plan is malformed.");
  }
  const evidence = normalizeReviewedLaneRevisionSourceEvidence(value.source);
  const commitCandidate = normalizeReviewedLaneRevisionCommitCandidate(value.candidate);
  const subject = requireProtectedSquashSubject(value.replacementSubject, {
    label: "Reviewed-lane replacement subject",
  });
  assertPlanCommitJoin(evidence, commitCandidate, subject);
  const core = planCore({ evidence, commitCandidate, replacementSubject: subject });
  const planDigest = requiredDigest(value.planDigest, "plan digest");
  const exactAuthorization = `authorize reviewed-lane-revision ${planDigest}`;
  assertExactKeys(
    value,
    [...Object.keys(core), "planDigest", "exactAuthorization"],
    "reviewed-lane revision plan",
  );
  if (planDigest !== digestValue(core) || value.exactAuthorization !== exactAuthorization) {
    throw new Error("Reviewed-lane revision plan digest or authorization text is invalid.");
  }
  return deepFreeze({ ...core, planDigest, exactAuthorization });
}

export function authorizeReviewedLaneRevision({ plan, authorization } = {}) {
  const normalized = normalizeReviewedLaneRevisionPlan(plan);
  if (typeof authorization !== "string" || authorization !== normalized.exactAuthorization) {
    throw new Error(
      `Reviewed-lane revision requires exact authorization: ${normalized.exactAuthorization}`,
    );
  }
  const core = {
    schema: REVIEWED_LANE_REVISION_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createReviewedLaneRevisionIntent(plan, authorization) {
  const normalizedPlan = normalizeReviewedLaneRevisionPlan(plan);
  const normalizedAuthorization = normalizeAuthorization(authorization, normalizedPlan);
  const prepared = buildReviewedLaneRevisionReceipt({
    plan: normalizedPlan,
    phase: "prepared",
    values: {
      authorizationDigest: normalizedAuthorization.authorizationDigest,
      operationKey: reviewedLaneRevisionOperationKey(normalizedPlan, "prepared"),
    },
  });
  return sealIntent({
    schema: REVIEWED_LANE_REVISION_INTENT_SCHEMA,
    status: "prepared",
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorization: normalizedAuthorization,
    authorizationDigest: normalizedAuthorization.authorizationDigest,
    phases: { prepared },
    receipt: null,
  });
}

export function advanceReviewedLaneRevisionIntent(intent, { status, values } = {}) {
  const current = normalizeReviewedLaneRevisionIntent(intent);
  const nextStatus = requirePhase(status);
  const currentIndex = REVIEWED_LANE_REVISION_PHASES.indexOf(current.status);
  const nextIndex = REVIEWED_LANE_REVISION_PHASES.indexOf(nextStatus);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
    throw new Error("Reviewed-lane revision intent cannot skip or regress a protected phase.");
  }
  if (nextIndex === currentIndex) {
    const replayValues = normalizeValues(values);
    const prior = current.phases[nextStatus];
    if (!prior || prior.valuesDigest !== digestValue(replayValues)) {
      throw new Error("Reviewed-lane revision phase replay drifted from its durable values.");
    }
    return current;
  }
  const receipt = buildReviewedLaneRevisionReceipt({
    plan: current.planSnapshot,
    intent: current,
    phase: nextStatus,
    values,
  });
  const terminalReceipt = nextStatus === "complete"
    ? normalizeCompletionReceipt(
      values?.receipt,
      current.planSnapshot,
      current.intentDigest,
    )
    : null;
  return sealIntent({
    schema: REVIEWED_LANE_REVISION_INTENT_SCHEMA,
    status: nextStatus,
    planDigest: current.planDigest,
    planSnapshot: current.planSnapshot,
    authorization: current.authorization,
    authorizationDigest: current.authorizationDigest,
    phases: { ...current.phases, [nextStatus]: receipt },
    receipt: terminalReceipt,
  });
}

export function normalizeReviewedLaneRevisionIntent(value) {
  if (value?.schema !== REVIEWED_LANE_REVISION_INTENT_SCHEMA) {
    throw new Error("Reviewed-lane revision intent is malformed.");
  }
  const status = requirePhase(value.status);
  const plan = normalizeReviewedLaneRevisionPlan(value.planSnapshot);
  const authorization = normalizeAuthorization(value.authorization, plan);
  const expectedPhases = REVIEWED_LANE_REVISION_PHASES.slice(
    0,
    REVIEWED_LANE_REVISION_PHASES.indexOf(status) + 1,
  );
  const phases = {};
  assertExactKeys(value.phases, expectedPhases, "intent phases");
  let expectedPriorIntentDigest = null;
  let receipt = null;
  for (const phase of expectedPhases) {
    phases[phase] = normalizeReviewedLaneRevisionReceipt(value.phases[phase], {
      phase,
      plan,
      expectedPriorIntentDigest,
    });
    receipt = phase === "complete"
      ? normalizeCompletionReceipt(
        value.receipt,
        plan,
        expectedPriorIntentDigest,
      )
      : null;
    if (phase === "complete"
      && digestValue(phases[phase].values.receipt) !== digestValue(receipt)) {
      throw new Error("Reviewed-lane completion receipt drifted from its phase values.");
    }
    expectedPriorIntentDigest = digestValue({
      schema: REVIEWED_LANE_REVISION_INTENT_SCHEMA,
      status: phase,
      planDigest: plan.planDigest,
      planSnapshot: plan,
      authorization,
      authorizationDigest: authorization.authorizationDigest,
      phases: { ...phases },
      receipt,
    });
  }
  if (status !== "complete" && value.receipt !== null) invalid("non-terminal receipt");
  const core = {
    schema: REVIEWED_LANE_REVISION_INTENT_SCHEMA,
    status,
    planDigest: requiredDigest(value.planDigest, "intent plan digest"),
    planSnapshot: plan,
    authorization,
    authorizationDigest: requiredDigest(value.authorizationDigest, "intent authorization digest"),
    phases,
    receipt,
  };
  assertExactKeys(value, [...Object.keys(core), "intentDigest"], "reviewed-lane revision intent");
  if (
    core.planDigest !== plan.planDigest
    || core.authorizationDigest !== authorization.authorizationDigest
    || requiredDigest(value.intentDigest, "intent digest") !== digestValue(core)
  ) {
    throw new Error("Reviewed-lane revision intent digest or authority is invalid.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function reviewedLaneRevisionOperationKey(plan, operation) {
  const normalized = normalizeReviewedLaneRevisionPlan(plan);
  const phase = requirePhase(operation);
  const suffix = digestValue({ planDigest: normalized.planDigest, operation: phase });
  return `reviewed-lane-revision:${phase}:${suffix}`;
}

export function buildReviewedLaneRevisionReceipt({
  plan,
  intent = null,
  phase,
  values = {},
} = {}) {
  const normalizedPlan = normalizeReviewedLaneRevisionPlan(plan);
  const normalizedPhase = requirePhase(phase);
  const normalizedValues = normalizeValues(values);
  const operationKey = reviewedLaneRevisionOperationKey(normalizedPlan, normalizedPhase);
  if (normalizedValues.operationKey && normalizedValues.operationKey !== operationKey) {
    throw new Error("Reviewed-lane revision receipt operation key drifted.");
  }
  const intentDigest = intent
    ? requiredDigest(intent.intentDigest, "prior intent digest")
    : null;
  const core = {
    schema: REVIEWED_LANE_REVISION_RECEIPT_SCHEMA,
    phase: normalizedPhase,
    planDigest: normalizedPlan.planDigest,
    operationKey,
    intentDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeReviewedLaneRevisionReceipt(value, {
  phase,
  plan,
  expectedPriorIntentDigest,
}) {
  if (value?.schema !== REVIEWED_LANE_REVISION_RECEIPT_SCHEMA) {
    throw new Error("Reviewed-lane revision receipt is malformed.");
  }
  const values = normalizeValues(value.values);
  const core = {
    schema: REVIEWED_LANE_REVISION_RECEIPT_SCHEMA,
    phase: requirePhase(value.phase),
    planDigest: requiredDigest(value.planDigest, "receipt plan digest"),
    operationKey: requiredText(value.operationKey, "receipt operation key"),
    intentDigest: value.intentDigest === null
      ? null
      : requiredDigest(value.intentDigest, "receipt prior intent digest"),
    values,
    valuesDigest: requiredDigest(value.valuesDigest, "receipt values digest"),
  };
  assertExactKeys(value, [...Object.keys(core), "receiptDigest"], "reviewed-lane revision receipt");
  if (
    core.phase !== phase
    || core.planDigest !== plan.planDigest
    || core.operationKey !== reviewedLaneRevisionOperationKey(plan, phase)
    || core.intentDigest !== expectedPriorIntentDigest
    || core.valuesDigest !== digestValue(values)
    || requiredDigest(value.receiptDigest, "receipt digest") !== digestValue(core)
  ) {
    throw new Error(
      "Reviewed-lane revision receipt digest, phase, or prior-intent ancestry is invalid.",
    );
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function planCore({ evidence, commitCandidate, replacementSubject }) {
  return {
    schema: REVIEWED_LANE_REVISION_PLAN_SCHEMA,
    strategy: "replace-reviewed-subject-preserve-tree-parents-and-authorship",
    source: evidence,
    sourceEvidenceDigest: evidence.evidenceDigest,
    candidate: commitCandidate,
    candidateDigest: commitCandidate.candidateDigest,
    replacementSubject,
    sourceHeadSha: evidence.commit.headSha,
    replacementHeadSha: commitCandidate.candidate.headSha,
    treeSha: evidence.commit.treeSha,
    parentShas: evidence.commit.parentShas,
    sourceLeaseDigest: evidence.lease.leaseDigest,
    sourceClaimId: evidence.claim.claimId,
    sourceClaimDigest: evidence.authority.claimDigest,
    sourceReviewRequestId: evidence.pullRequest.reviewRequestId,
    sourceFocusedEvidenceDigest: evidence.authority.focusedEvidenceDigest,
    pullRequestUrl: evidence.pullRequest.url,
    pullRequestNumber: evidence.pullRequest.number,
    pullRequestNodeId: evidence.pullRequest.nodeId,
    pullRequestTitle: evidence.pullRequest.title,
    pullRequestBodyDigest: digestValue(evidence.pullRequest.body),
  };
}

function assertPlanCommitJoin(evidence, candidate, subject) {
  if (
    candidate.replacementSubject !== subject
    || candidate.source.rawCommitDigest !== evidence.commit.rawCommitDigest
    || candidate.source.headSha !== evidence.commit.headSha
    || candidate.source.treeSha !== evidence.commit.treeSha
    || JSON.stringify(candidate.source.parentShas) !== JSON.stringify(evidence.commit.parentShas)
    || candidate.candidate.treeSha !== evidence.commit.treeSha
    || JSON.stringify(candidate.candidate.parentShas) !== JSON.stringify(evidence.commit.parentShas)
    || candidate.candidate.authorHeader !== evidence.commit.authorHeader
    || candidate.candidate.committerHeader !== evidence.commit.committerHeader
  ) {
    throw new Error("Reviewed-lane revision candidate drifted from the exact reviewed source.");
  }
}

function normalizeAuthorization(value, plan) {
  if (value?.schema !== REVIEWED_LANE_REVISION_AUTHORIZATION_SCHEMA) {
    throw new Error("Reviewed-lane revision authorization receipt is malformed.");
  }
  const core = {
    schema: REVIEWED_LANE_REVISION_AUTHORIZATION_SCHEMA,
    planDigest: requiredDigest(value.planDigest, "authorization plan digest"),
    statement: requiredText(value.statement, "authorization statement"),
  };
  assertExactKeys(value, [...Object.keys(core), "authorizationDigest"], "authorization receipt");
  if (
    core.planDigest !== plan.planDigest
    || core.statement !== plan.exactAuthorization
    || requiredDigest(value.authorizationDigest, "authorization digest") !== digestValue(core)
  ) {
    throw new Error("Reviewed-lane revision authorization receipt is invalid.");
  }
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function normalizeCompletionReceipt(value, plan, expectedPriorIntentDigest) {
  const receipt = normalizeReviewedLaneRevisionReceipt(value, {
    phase: "complete",
    plan,
    expectedPriorIntentDigest,
  });
  return receipt;
}

function sealIntent(core) {
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function normalizeValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reviewed-lane revision phase values must be an object.");
  }
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw new Error("Reviewed-lane revision phase values exceed their bound.");
  }
  const normalized = JSON.parse(serialized);
  if (digestValue(normalized) !== digestValue(value)) {
    throw new Error("Reviewed-lane revision phase values are not canonical JSON.");
  }
  return deepFreeze(normalized);
}

function requirePhase(value) {
  if (!REVIEWED_LANE_REVISION_PHASES.includes(value)) {
    throw new Error(`Unsupported reviewed-lane revision phase: ${String(value || "missing")}.`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} must be non-empty and whitespace-exact.`);
  }
  return value;
}

function requiredDigest(value, label) {
  const text = String(value || "");
  if (!DIGEST_PATTERN.test(text)) throw new Error(`${label} must be an exact digest.`);
  return text;
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value || {}).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains missing or arbitrary fields.`);
  }
}

function invalid(label) {
  throw new Error(`Reviewed-lane revision ${label} is invalid.`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
