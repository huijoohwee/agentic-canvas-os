// Responsibility: classify receipt-bound reconciliation phases independently from source evidence normalization.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

const PLAN_SCHEMA = "agentic-merged-dormant-claim-reconciliation-plan/v1";
const INTENT_SCHEMA = "agentic-merged-dormant-claim-reconciliation-intent/v1";
const OPERATION_KEY_SCHEMA = "agentic-merged-dormant-claim-reconciliation-operation-key/v1";
const PHASE_EVIDENCE_SCHEMA = "agentic-merged-dormant-claim-reconciliation-phase-evidence/v1";
const PHASES = Object.freeze(["prepared", "recovered", "integrated", "retired", "complete"]);
const INTENT_STATUSES = Object.freeze(["authorized", ...PHASES]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildMergedDormantClaimReconciliationPhaseObservation({
  plan, intent, phase, operationKey, live,
}) {
  const normalizedPhase = requiredPhase(phase);
  const normalizedPlan = normalizePlanEnvelope(plan);
  const normalizedIntent = normalizeIntentEnvelope(intent, normalizedPlan.planDigest, normalizedPhase);
  const expectedOperationKey = phaseOperationKey(normalizedPlan.planDigest, normalizedPhase);
  if (operationKey !== expectedOperationKey) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} operation key drifted.`);
  }
  const projected = projectPhaseLive(live);
  const state = phaseLiveState(normalizedPlan, normalizedIntent, normalizedPhase, projected);
  const evidenceDigest = phaseEvidenceDigest(
    normalizedPlan, normalizedPhase, expectedOperationKey, projected, state,
  );
  return deepFreeze({
    kind: state,
    values: { operationKey: expectedOperationKey, evidenceDigest, live: projected },
  });
}

export function classifyMergedDormantClaimReconciliationPhase({
  plan, intent, phase, observation, operationKey,
}) {
  const normalizedPhase = requiredPhase(phase);
  const normalizedPlan = normalizePlanEnvelope(plan);
  const normalizedIntent = normalizeIntentEnvelope(intent, normalizedPlan.planDigest, normalizedPhase);
  const expectedOperationKey = phaseOperationKey(normalizedPlan.planDigest, normalizedPhase);
  if (operationKey !== expectedOperationKey) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} operation key drifted.`);
  }
  requireObject(observation, `${normalizedPhase} observation`);
  if (!new Set(["pending", "complete"]).has(observation.kind)) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} observation is impossible.`);
  }
  assertExactKeys(observation, ["kind", "values"], `${normalizedPhase} observation`);
  requireObject(observation.values, `${normalizedPhase} observation values`);
  assertExactKeys(
    observation.values,
    ["evidenceDigest", "live", "operationKey"],
    `${normalizedPhase} observation values`,
  );
  if (observation.values.operationKey !== expectedOperationKey) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} live operation key drifted.`);
  }
  const live = projectPhaseLive(observation.values.live);
  const liveState = phaseLiveState(normalizedPlan, normalizedIntent, normalizedPhase, live);
  if (observation.kind !== liveState) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} live state drifted.`);
  }
  const expectedEvidenceDigest = phaseEvidenceDigest(
    normalizedPlan, normalizedPhase, expectedOperationKey, live, liveState,
  );
  if (observation.values.evidenceDigest !== expectedEvidenceDigest) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} live evidence digest drifted.`);
  }
  return Object.freeze({
    phase: normalizedPhase,
    operationKey: expectedOperationKey,
    state: liveState,
    evidenceDigest: liveState === "complete" ? expectedEvidenceDigest : null,
    integrationReceiptDigest: liveState === "complete"
      && ["integrated", "retired", "complete"].includes(normalizedPhase)
      ? live.claim.integrationReceiptDigest
      : null,
  });
}

function phaseLiveState(plan, intent, phase, live) {
  const stages = ["prepared", "recovered", "integrated", "retired"];
  const targetOffset = phase === "complete" ? 3 : stages.indexOf(phase);
  const observedOffset = live.claim.transitionCounter - plan.expectedTransitionCounter;
  if (observedOffset < 0 || observedOffset > 3 || observedOffset < targetOffset - 1) {
    throw new Error(`Merged dormant reconciliation ${phase} observed an impossible transition counter.`);
  }
  const currentPhase = stages[observedOffset];
  assertPhaseLive(plan, intent, currentPhase, phaseOperationKey(plan.planDigest, currentPhase), live);
  return observedOffset >= targetOffset ? "complete" : "pending";
}

function projectPhaseLive(value) {
  requireObject(value, "Live phase evidence");
  const result = value.result || value;
  const claim = value.claim;
  requireObject(claim, "Live phase claim");
  return deepFreeze({
    ledgerRevision: requiredSha(result.ledgerRevision, "live ledger revision"),
    ledgerDigest: requiredDigest(result.ledgerDigest, "live ledger digest"),
    claim: {
      claimId: requiredDigest(claim.claimId, "live claim ID"),
      state: requiredText(claim.state, "live claim state"),
      recordedState: requiredText(claim.recordedState, "live recorded state"),
      writeAuthority: claim.writeAuthority,
      scopeReserved: claim.scopeReserved,
      actorId: requiredText(claim.actorId, "live actor ID"),
      repositoryId: requiredText(claim.repositoryId, "live repository ID"),
      workItemId: requiredText(claim.workItemId, "live work-item ID"),
      deviceId: requiredText(claim.deviceId, "live device ID"),
      sessionId: requiredText(claim.sessionId, "live session ID"),
      canonicalBaseRevision: requiredSha(claim.canonicalBaseRevision, "live canonical base"),
      laneRevision: requiredSha(claim.laneRevision, "live lane revision"),
      writeSetDigest: requiredDigest(claim.writeSetDigest, "live write-set digest"),
      leaseEpoch: positiveInteger(claim.leaseEpoch, "live lease epoch"),
      transitionCounter: positiveInteger(claim.transitionCounter, "live transition counter"),
      reviewRequestId: requiredText(claim.reviewRequestId, "live review request ID"),
      evidenceDigest: requiredDigest(claim.evidenceDigest, "live review evidence digest"),
      fenceRevision: requiredDigest(claim.fenceRevision, "live fence revision"),
      transitionDigest: requiredDigest(claim.transitionDigest, "live transition digest"),
      operationReceiptDigest: requiredDigest(claim.operationReceiptDigest, "live operation receipt digest"),
      recovery: projectRecovery(claim.recovery),
      integration: projectIntegration(claim.integration),
      integrationReceiptDigest: optionalDigest(claim.integrationReceiptDigest, "live integration receipt digest"),
      retirement: projectRetirement(claim.retirement),
    },
  });
}

function assertPhaseLive(plan, intent, phase, operationKey, live) {
  const claim = live.claim;
  const offset = phase === "prepared" ? 0 : phase === "recovered" ? 1
    : phase === "integrated" ? 2 : 3;
  if (claim.claimId !== plan.claimId || claim.actorId !== plan.actorId
    || claim.repositoryId !== plan.repositoryId || claim.workItemId !== plan.workItemId
    || claim.canonicalBaseRevision !== plan.canonicalBaseRevision
    || claim.laneRevision !== plan.claimLaneRevision || claim.writeSetDigest !== plan.claimWriteSetDigest
    || claim.leaseEpoch !== plan.claimLeaseEpoch || claim.reviewRequestId !== plan.claimReviewRequestId
    || claim.evidenceDigest !== plan.claimFocusedEvidenceDigest
    || claim.transitionCounter !== plan.expectedTransitionCounter + offset
    || claim.writeAuthority !== false) {
    throw new Error(`Merged dormant reconciliation ${phase} live claim identity drifted.`);
  }
  if (phase === "prepared") {
    if (claim.state !== "dormant-preserved" || claim.recordedState !== "reviewed"
      || claim.scopeReserved !== true || claim.fenceRevision !== plan.claimDigest
      || claim.transitionDigest !== plan.claimTransitionDigest
      || claim.operationReceiptDigest !== plan.claimOperationReceiptDigest
      || live.ledgerRevision !== plan.expectedLedgerRevision
      || live.ledgerDigest !== plan.expectedLedgerDigest
      || claim.recovery !== null || claim.integration !== null || claim.retirement !== null) {
      throw new Error("Prepared evidence drifted from the exact dormant source claim.");
    }
    return;
  }
  if (claim.deviceId !== plan.expectedCloudDeviceId || claim.sessionId !== plan.expectedCloudSessionId
    || claim.fenceRevision === plan.claimDigest || live.ledgerDigest === plan.expectedLedgerDigest
    || claim.recovery?.evidenceDigest !== phaseOperationKey(plan.planDigest, "recovered")) {
    throw new Error(`Merged dormant reconciliation ${phase} recovery evidence drifted.`);
  }
  if (phase === "recovered") {
    if (claim.state !== "reviewed" || claim.recordedState !== "reviewed"
      || claim.scopeReserved !== true || claim.integration !== null || claim.retirement !== null) {
      throw new Error("Recovered evidence is not the exact reviewed claim transition.");
    }
    return;
  }
  assertIntegration(plan, intent, claim, phaseOperationKey(plan.planDigest, "integrated"));
  if (phase === "integrated") {
    if (claim.state !== "integrated-preserved" || claim.recordedState !== "integrated-preserved"
      || claim.scopeReserved !== true || claim.retirement !== null) {
      throw new Error("Integrated evidence is not the exact preserved integration transition.");
    }
    return;
  }
  assertRetirement(plan, claim);
  if (claim.state !== "retired" || claim.recordedState !== "retired"
    || claim.scopeReserved !== false || operationKey !== phaseOperationKey(plan.planDigest, phase)) {
    throw new Error(`Merged dormant reconciliation ${phase} terminal evidence drifted.`);
  }
}

function assertIntegration(plan, intent, claim, integrationKey) {
  const value = claim.integration;
  if (!value || value.candidateRevision !== plan.claimLaneRevision
    || value.reviewRequestId !== plan.claimReviewRequestId
    || value.focusedEvidenceDigest !== plan.claimFocusedEvidenceDigest
    || value.dependencyClosureDigest !== plan.dependencyClosureDigest
    || value.namedChecksDigest !== plan.namedChecksDigest
    || value.handoffEvidenceDigest !== plan.handoffEvidenceDigest
    || value.operatorDecisionDigest !== intent.authorizationDigest
    || value.integrationIntentDigest !== integrationKey || !claim.integrationReceiptDigest) {
    throw new Error("Integrated evidence drifted from its exact reviewed intent.");
  }
}

function assertRetirement(plan, claim) {
  const value = claim.retirement;
  if (!value || value.reason !== "integrated" || value.finalRevision !== plan.finalRevision
    || value.reviewRequestId !== plan.claimReviewRequestId || value.bytesDigest !== plan.bytesDigest
    || value.namedChecksDigest !== plan.namedChecksDigest
    || value.handoffEvidenceDigest !== plan.handoffEvidenceDigest
    || value.integrationReceiptDigest !== claim.integrationReceiptDigest) {
    throw new Error("Retirement evidence drifted from the exact integrated claim.");
  }
}

function projectRecovery(value) {
  if (value == null) return null;
  requireObject(value, "Live recovery evidence");
  return Object.freeze({
    evidenceDigest: requiredDigest(value.evidenceDigest, "recovery evidence digest"),
    recoveredAt: requiredInstant(value.recoveredAt, "recovery instant"),
  });
}

function projectIntegration(value) {
  if (value == null) return null;
  requireObject(value, "Live integration evidence");
  return Object.freeze({
    candidateRevision: requiredSha(value.candidateRevision, "integration candidate"),
    reviewRequestId: requiredText(value.reviewRequestId, "integration review request ID"),
    focusedEvidenceDigest: requiredDigest(value.focusedEvidenceDigest, "integration focused evidence"),
    dependencyClosureDigest: requiredDigest(value.dependencyClosureDigest, "integration dependency closure"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "integration named checks"),
    handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "integration handoff evidence"),
    operatorDecisionDigest: requiredDigest(value.operatorDecisionDigest, "integration operator decision"),
    integrationIntentDigest: requiredDigest(value.integrationIntentDigest, "integration intent"),
    integratedAt: requiredInstant(value.integratedAt, "integration instant"),
  });
}

function projectRetirement(value) {
  if (value == null) return null;
  requireObject(value, "Live retirement evidence");
  return Object.freeze({
    reason: requiredText(value.reason, "retirement reason"),
    finalRevision: requiredSha(value.finalRevision, "retirement final revision"),
    reviewRequestId: requiredText(value.reviewRequestId, "retirement review request ID"),
    bytesDigest: requiredDigest(value.bytesDigest, "retirement bytes digest"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "retirement named checks"),
    handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "retirement handoff evidence"),
    integrationReceiptDigest: requiredDigest(value.integrationReceiptDigest, "retirement integration receipt"),
    retiredAt: requiredInstant(value.retiredAt, "retirement instant"),
  });
}

function phaseOperationKey(planDigest, phase) {
  return digestValue({ schema: OPERATION_KEY_SCHEMA, planDigest, phase });
}

function phaseEvidenceDigest(plan, phase, operationKey, live, state) {
  if (state === "pending") {
    return digestValue({
      schema: PHASE_EVIDENCE_SCHEMA, planDigest: plan.planDigest, phase, operationKey, state, live,
    });
  }
  let evidence;
  if (phase === "prepared") evidence = { sourceEvidenceDigest: plan.sourceEvidenceDigest };
  else if (phase === "recovered") evidence = { recovery: live.claim.recovery };
  else if (phase === "integrated") {
    evidence = { integration: live.claim.integration, integrationReceiptDigest: live.claim.integrationReceiptDigest };
  } else {
    evidence = { retirement: live.claim.retirement, operationReceiptDigest: live.claim.operationReceiptDigest };
  }
  return digestValue({ schema: PHASE_EVIDENCE_SCHEMA, planDigest: plan.planDigest, phase, operationKey, evidence });
}

function normalizePlanEnvelope(value) {
  requireObject(value, "Reconciliation plan");
  if (value.schema !== PLAN_SCHEMA) throw new Error("Unsupported reconciliation plan.");
  const { planDigest, exactAuthorization, ...core } = value;
  if (requiredDigest(planDigest, "plan digest") !== digestValue(core)) {
    throw new Error("Merged dormant reconciliation plan digest is invalid.");
  }
  if (exactAuthorization !== `authorize merged-dormant-claim-reconciliation ${planDigest}`) {
    throw new Error("Merged dormant reconciliation exact authorization is invalid.");
  }
  return value;
}

function normalizeIntentEnvelope(value, planDigest, phase) {
  requireObject(value, "Reconciliation intent");
  if (value.schema !== INTENT_SCHEMA || value.planDigest !== planDigest) {
    throw new Error("Merged dormant reconciliation intent does not join its plan.");
  }
  const statusIndex = INTENT_STATUSES.indexOf(value.status);
  const phaseIndex = INTENT_STATUSES.indexOf(phase);
  if (statusIndex < 0 || statusIndex < phaseIndex - 1) {
    throw new Error(`Merged dormant reconciliation cannot observe ${phase} before its predecessor.`);
  }
  const { intentDigest, ...core } = value;
  if (requiredDigest(intentDigest, "intent digest") !== digestValue(core)) {
    throw new Error("Merged dormant reconciliation intent digest is invalid.");
  }
  requiredDigest(value.authorizationDigest, "intent authorization digest");
  return value;
}

function requiredPhase(value) {
  const phase = requiredText(value, "reconciliation phase");
  if (!PHASES.includes(phase)) throw new Error(`Unsupported reconciliation phase: ${phase}.`);
  return phase;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.normalize("NFC").trim();
}

function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase SHA.`);
  return sha;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}

function optionalDigest(value, label) {
  return value == null ? null : requiredDigest(value, label);
}

function requiredInstant(value, label) {
  const instant = requiredText(value, label);
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO-8601 instant.`);
  return new Date(milliseconds).toISOString();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
