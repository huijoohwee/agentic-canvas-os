// Responsibility: Seal exact same-owner expired active-dirty recovery plans, intent phases, and receipts.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation,
  normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence,
} from "./expired-active-dirty-scope-expansion-recovery-evidence.mjs";

export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PLAN_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-plan/v1";
export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_AUTHORIZATION_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-authorization/v1";
export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_INTENT_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-intent/v1";
export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_RECEIPT_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-receipt/v1";
export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_NO_EFFECT_SUPERSESSION_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-no-effect-supersession/v1";
export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES = Object.freeze([
  "cloud-recovered",
  "local-rebound",
  "pr-projected",
  "complete",
]);

const OPERATION_KEY_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-operation-key/v1";
const STATUSES = Object.freeze([
  "authorized",
  ...EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES,
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MINIMUM_TTL_SECONDS = 60;
const MAXIMUM_TTL_SECONDS = 86_400;

export function buildExpiredActiveDirtyScopeExpansionRecoveryPlan({
  sourceEvidence,
  ttlSeconds,
} = {}) {
  const source = normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(
    sourceEvidence,
  );
  return sealPlan({
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PLAN_SCHEMA,
    operation: "expired-active-dirty-scope-expansion-recovery",
    sourceEvidence: source,
    sourceEvidenceDigest: source.sourceEvidenceDigest,
    ttlSeconds: boundedTtlSeconds(ttlSeconds),
  });
}

export function normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(value) {
  requireObject(value, "Recovery plan");
  exactKeys(value, [
    "exactAuthorization",
    "operation",
    "planDigest",
    "schema",
    "sourceEvidence",
    "sourceEvidenceDigest",
    "ttlSeconds",
  ], "Recovery plan");
  const source = normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(
    value.sourceEvidence,
  );
  const core = {
    schema: text(value.schema, "Plan schema"),
    operation: text(value.operation, "Plan operation"),
    sourceEvidence: source,
    sourceEvidenceDigest: digest(
      value.sourceEvidenceDigest,
      "Plan source-evidence digest",
    ),
    ttlSeconds: boundedTtlSeconds(value.ttlSeconds),
  };
  if (
    core.schema !== EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PLAN_SCHEMA
    || core.operation !== "expired-active-dirty-scope-expansion-recovery"
    || core.sourceEvidenceDigest !== source.sourceEvidenceDigest
  ) {
    throw new Error("Recovery plan semantics are invalid.");
  }
  const expected = sealPlan(core);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Recovery plan digest or exact authorization drifted.");
  }
  return expected;
}

export function authorizeExpiredActiveDirtyScopeExpansionRecovery(
  plan,
  authorization,
) {
  const normalized = normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(plan);
  if (
    typeof authorization !== "string"
    || authorization !== normalized.exactAuthorization
  ) {
    throw new Error(
      `Recovery requires exact authorization: ${normalized.exactAuthorization}`,
    );
  }
  const core = {
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    sourceEvidenceDigest: normalized.sourceEvidenceDigest,
    operatorDecisionDigest: normalized.planDigest,
    authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createExpiredActiveDirtyScopeExpansionRecoveryIntent(
  plan,
  authorizationReceipt,
) {
  const normalizedPlan = normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(plan);
  const authorization = normalizeAuthorization(
    authorizationReceipt,
    normalizedPlan,
  );
  return sealIntent({
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    phases: {},
  });
}

export function normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(value) {
  requireObject(value, "Recovery intent");
  exactKeys(value, [
    "authorizationDigest",
    "intentDigest",
    "phases",
    "planDigest",
    "planSnapshot",
    "schema",
    "status",
  ], "Recovery intent");
  const plan = normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(
    value.planSnapshot,
  );
  const authorizationDigest = digest(
    value.authorizationDigest,
    "Intent authorization digest",
  );
  const status = requiredStatus(value.status);
  const core = {
    schema: text(value.schema, "Intent schema"),
    planDigest: digest(value.planDigest, "Intent plan digest"),
    planSnapshot: plan,
    authorizationDigest,
    status,
    phases: normalizeIntentPhases(
      value.phases,
      plan,
      authorizationDigest,
      status,
    ),
  };
  if (
    core.schema !== EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest
    || core.authorizationDigest !== authorizationDigestForPlan(plan)
    || value.intentDigest !== digestValue(core)
  ) {
    throw new Error("Recovery intent is malformed or digest-invalid.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function advanceExpiredActiveDirtyScopeExpansionRecoveryIntent(
  intent,
  phase,
  observation,
) {
  const normalized = normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(intent);
  const nextStatus = requiredPhase(phase);
  const currentIndex = STATUSES.indexOf(normalized.status);
  const nextIndex = STATUSES.indexOf(nextStatus);
  const operationKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    normalized.planDigest,
    normalized.authorizationDigest,
    nextStatus,
  );
  const normalizedObservation = normalizePhaseObservation({
    plan: normalized.planSnapshot,
    phase: nextStatus,
    operationKey,
    observation,
  });
  const nextRecord = deepFreeze({ operationKey, observation: normalizedObservation });
  if (nextIndex === currentIndex) {
    if (
      canonicalJson(normalized.phases[nextStatus])
      !== canonicalJson(nextRecord)
    ) {
      throw new Error(`Recovery ${nextStatus} replay drifted.`);
    }
    return normalized;
  }
  if (nextIndex !== currentIndex + 1) {
    throw new Error(
      `Recovery cannot advance from ${normalized.status} to ${nextStatus}.`,
    );
  }
  return sealIntent({
    schema: normalized.schema,
    planDigest: normalized.planDigest,
    planSnapshot: normalized.planSnapshot,
    authorizationDigest: normalized.authorizationDigest,
    status: nextStatus,
    phases: { ...normalized.phases, [nextStatus]: nextRecord },
  });
}

export function expiredActiveDirtyScopeExpansionRecoveryOperationKey(
  planDigest,
  authorizationDigest,
  phase,
) {
  return digestValue({
    schema: OPERATION_KEY_SCHEMA,
    planDigest: digest(planDigest, "Operation-key plan digest"),
    authorizationDigest: digest(
      authorizationDigest,
      "Operation-key authorization digest",
    ),
    phase: requiredPhase(phase),
  });
}

export function buildExpiredActiveDirtyScopeExpansionRecoveryReceipt(intent) {
  const complete = normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(intent);
  if (complete.status !== "complete") {
    throw new Error("Recovery receipt requires the exact complete intent.");
  }
  const core = receiptCore(complete);
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt(
  value,
  expectedIntent = null,
) {
  requireObject(value, "Recovery receipt");
  exactKeys(value, [
    "authorizationDigest",
    "cloudRecoveredObservationDigest",
    "cloudRecoveredOperationKey",
    "completeIntentDigest",
    "completionObservationDigest",
    "completionOperationKey",
    "localReboundObservationDigest",
    "localReboundOperationKey",
    "planDigest",
    "prProjectionObservationDigest",
    "prProjectionOperationKey",
    "receiptDigest",
    "schema",
    "sourceEvidenceDigest",
    "status",
  ], "Recovery receipt");
  const core = {
    schema: text(value.schema, "Receipt schema"),
    status: text(value.status, "Receipt status"),
    planDigest: digest(value.planDigest, "Receipt plan digest"),
    sourceEvidenceDigest: digest(
      value.sourceEvidenceDigest,
      "Receipt source-evidence digest",
    ),
    authorizationDigest: digest(
      value.authorizationDigest,
      "Receipt authorization digest",
    ),
    completeIntentDigest: digest(
      value.completeIntentDigest,
      "Receipt complete-intent digest",
    ),
    cloudRecoveredOperationKey: digest(
      value.cloudRecoveredOperationKey,
      "Receipt cloud-recovered operation key",
    ),
    cloudRecoveredObservationDigest: digest(
      value.cloudRecoveredObservationDigest,
      "Receipt cloud-recovered observation digest",
    ),
    localReboundOperationKey: digest(
      value.localReboundOperationKey,
      "Receipt local-rebound operation key",
    ),
    localReboundObservationDigest: digest(
      value.localReboundObservationDigest,
      "Receipt local-rebound observation digest",
    ),
    prProjectionOperationKey: digest(
      value.prProjectionOperationKey,
      "Receipt PR-projection operation key",
    ),
    prProjectionObservationDigest: digest(
      value.prProjectionObservationDigest,
      "Receipt PR-projection observation digest",
    ),
    completionOperationKey: digest(
      value.completionOperationKey,
      "Receipt completion operation key",
    ),
    completionObservationDigest: digest(
      value.completionObservationDigest,
      "Receipt completion observation digest",
    ),
  };
  if (
    core.schema !== EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_RECEIPT_SCHEMA
    || core.status !== "recovered"
    || core.authorizationDigest !== authorizationDigestForSubject(core)
    || [
      [core.cloudRecoveredOperationKey, "cloud-recovered"],
      [core.localReboundOperationKey, "local-rebound"],
      [core.prProjectionOperationKey, "pr-projected"],
      [core.completionOperationKey, "complete"],
    ].some(([key, phase]) => key !== expiredActiveDirtyScopeExpansionRecoveryOperationKey(
      core.planDigest, core.authorizationDigest, phase,
    ))
    || value.receiptDigest !== digestValue(core)
  ) {
    throw new Error("Recovery receipt is malformed or digest-invalid.");
  }
  const normalized = deepFreeze({ ...core, receiptDigest: value.receiptDigest });
  if (expectedIntent) {
    const expected = buildExpiredActiveDirtyScopeExpansionRecoveryReceipt(
      expectedIntent,
    );
    if (canonicalJson(normalized) !== canonicalJson(expected)) {
      throw new Error("Recovery receipt changed its complete intent.");
    }
  }
  return normalized;
}

export function buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt({
  supersededIntent, successorPlan,
} = {}) {
  const intent = normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(supersededIntent);
  const successor = normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(successorPlan);
  const source = intent.planSnapshot.sourceEvidence, next = successor.sourceEvidence;
  const claim = source.cloud.claim, nextClaim = next.cloud.claim;
  if (intent.status !== "authorized" || Object.keys(intent.phases).length !== 0
    || intent.planDigest === successor.planDigest
    || source.sourceEvidenceDigest === next.sourceEvidenceDigest
    || source.cloud.ledgerRepository !== next.cloud.ledgerRepository
    || source.controller.targetRepository !== next.controller.targetRepository
    || claim.claimId !== nextClaim.claimId || nextClaim.recovery !== null
    || canonicalJson(claim) !== canonicalJson(nextClaim)) {
    throw new Error("No-effect supersession requires one fresh plan over the exact unchanged dormant target claim.");
  }
  const base = {
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_NO_EFFECT_SUPERSESSION_SCHEMA,
    status: "superseded-authorized-no-effect", supersededPlanDigest: intent.planDigest,
    supersededSourceEvidenceDigest: source.sourceEvidenceDigest,
    supersededAuthorizationDigest: intent.authorizationDigest, supersededIntentDigest: intent.intentDigest,
    supersededCloudOperationKey: expiredActiveDirtyScopeExpansionRecoveryOperationKey(intent.planDigest, intent.authorizationDigest, "cloud-recovered"),
    successorPlanDigest: successor.planDigest, successorSourceEvidenceDigest: next.sourceEvidenceDigest,
    ledgerRepository: next.cloud.ledgerRepository, targetRepository: next.controller.targetRepository,
    claimId: nextClaim.claimId, claimDigest: nextClaim.claimDigest,
    transitionCounter: nextClaim.transitionCounter, transitionDigest: nextClaim.transitionDigest,
    operationReceiptDigest: nextClaim.operationReceiptDigest, recoveryEvidenceDigest: null,
  };
  const proofDigest = digestValue({ schema: `${base.schema}/proof`, ...base });
  const core = { ...base, proofDigest };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt(
  value, expected = {},
) {
  requireObject(value, "No-effect supersession receipt");
  const normalized = buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt(expected);
  exactKeys(value, Object.keys(normalized), "No-effect supersession receipt");
  if (canonicalJson(value) !== canonicalJson(normalized)) throw new Error("No-effect supersession receipt drifted.");
  return normalized;
}

function sealPlan(core) {
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization:
      `authorize expired-active-dirty-scope-expansion-recovery ${planDigest}`,
  });
}

function normalizeAuthorization(value, plan) {
  requireObject(value, "Recovery authorization receipt");
  exactKeys(value, [
    "authorization",
    "authorizationDigest",
    "operatorDecisionDigest",
    "planDigest",
    "schema",
    "sourceEvidenceDigest",
  ], "Recovery authorization receipt");
  const core = {
    schema: text(value.schema, "Authorization schema"),
    planDigest: digest(value.planDigest, "Authorization plan digest"),
    sourceEvidenceDigest: digest(
      value.sourceEvidenceDigest,
      "Authorization source-evidence digest",
    ),
    operatorDecisionDigest: digest(
      value.operatorDecisionDigest,
      "Authorization operator-decision digest",
    ),
    authorization: exactText(value.authorization, "Authorization text"),
  };
  if (
    core.schema
      !== EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_AUTHORIZATION_SCHEMA
    || core.planDigest !== plan.planDigest
    || core.sourceEvidenceDigest !== plan.sourceEvidenceDigest
    || core.operatorDecisionDigest !== plan.planDigest
    || core.authorization !== plan.exactAuthorization
    || value.authorizationDigest !== digestValue(core)
  ) {
    throw new Error("Recovery authorization receipt is invalid or drifted.");
  }
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function authorizationDigestForPlan(plan) {
  return authorizationDigestForSubject({
    planDigest: plan.planDigest,
    sourceEvidenceDigest: plan.sourceEvidenceDigest,
  });
}

function authorizationDigestForSubject({ planDigest, sourceEvidenceDigest }) {
  const normalizedPlanDigest = digest(planDigest, "Authorization subject plan digest");
  return digestValue({
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_AUTHORIZATION_SCHEMA,
    planDigest: normalizedPlanDigest,
    sourceEvidenceDigest: digest(
      sourceEvidenceDigest,
      "Authorization subject source-evidence digest",
    ),
    operatorDecisionDigest: normalizedPlanDigest,
    authorization:
      `authorize expired-active-dirty-scope-expansion-recovery ${normalizedPlanDigest}`,
  });
}

function normalizeIntentPhases(value, plan, authorizationDigest, status) {
  requireObject(value, "Intent phases");
  const statusIndex = STATUSES.indexOf(status);
  const phases = {};
  for (let index = 0; index < statusIndex; index += 1) {
    const phase = EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES[index];
    const record = value[phase];
    requireObject(record, `Intent ${phase} phase`);
    exactKeys(record, ["observation", "operationKey"], `Intent ${phase} phase`);
    const operationKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
      plan.planDigest,
      authorizationDigest,
      phase,
    );
    if (record.operationKey !== operationKey) {
      throw new Error(`Intent ${phase} operation key drifted.`);
    }
    phases[phase] = deepFreeze({
      operationKey,
      observation: normalizePhaseObservation({
        plan,
        phase,
        operationKey,
        observation: record.observation,
      }),
    });
  }
  if (Object.keys(value).some(key => !Object.hasOwn(phases, key))) {
    throw new Error("Intent contains an out-of-order recovery phase.");
  }
  return deepFreeze(phases);
}

function normalizePhaseObservation({ plan, phase, operationKey, observation }) {
  const normalized =
    normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation(
      observation,
      { planDigest: plan.planDigest, phase, operationKey },
    );
  if (
    normalized?.state !== "complete"
    || normalized.phase !== phase
    || normalized.planDigest !== plan.planDigest
    || normalized.operationKey !== operationKey
    || normalized.sourceEvidenceDigest !== plan.sourceEvidenceDigest
    || !DIGEST_PATTERN.test(String(normalized.observationDigest || ""))
  ) {
    throw new Error(`Recovery ${phase} observation is not exact-complete.`);
  }
  return normalized;
}

function receiptCore(intent) {
  const cloud = intent.phases["cloud-recovered"];
  const local = intent.phases["local-rebound"];
  const pullRequest = intent.phases["pr-projected"];
  const complete = intent.phases.complete;
  return {
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_RECEIPT_SCHEMA,
    status: "recovered",
    planDigest: intent.planDigest,
    sourceEvidenceDigest: intent.planSnapshot.sourceEvidenceDigest,
    authorizationDigest: intent.authorizationDigest,
    completeIntentDigest: intent.intentDigest,
    cloudRecoveredOperationKey: cloud.operationKey,
    cloudRecoveredObservationDigest: cloud.observation.observationDigest,
    localReboundOperationKey: local.operationKey,
    localReboundObservationDigest: local.observation.observationDigest,
    prProjectionOperationKey: pullRequest.operationKey,
    prProjectionObservationDigest: pullRequest.observation.observationDigest,
    completionOperationKey: complete.operationKey,
    completionObservationDigest: complete.observation.observationDigest,
  };
}

function sealIntent(core) {
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function requiredStatus(value) {
  const candidate = text(value, "Intent status");
  if (!STATUSES.includes(candidate)) throw new Error("Recovery intent status is invalid.");
  return candidate;
}

function requiredPhase(value) {
  const candidate = text(value, "Recovery phase");
  if (!EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES.includes(candidate)) {
    throw new Error("Recovery phase is invalid.");
  }
  return candidate;
}

function boundedTtlSeconds(value) {
  if (
    !Number.isInteger(value)
    || value < MINIMUM_TTL_SECONDS
    || value > MAXIMUM_TTL_SECONDS
  ) {
    throw new Error(
      `Recovery TTL must be an integer from ${MINIMUM_TTL_SECONDS} through ${MAXIMUM_TTL_SECONDS} seconds.`,
    );
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be canonical non-empty text.`);
  }
  return value.trim();
}

function exactText(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`${label} must be byte-exact non-empty text.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(canonical)) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
