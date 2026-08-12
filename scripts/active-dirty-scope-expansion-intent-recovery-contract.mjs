// Responsibility: Seal exact authorization, replay intent, terminal projection, and recovery receipt.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  buildActiveDirtyScopeExpansionIntentRecoveryDecisionEvidence,
  normalizeActiveDirtyScopeExpansionIntentRecoveryDecisionEvidence,
  normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence,
  normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
  normalizeRecoverableScopeExpansionIntent,
} from "./active-dirty-scope-expansion-intent-recovery-evidence.mjs";

export const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_PLAN_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-plan/v2";
export const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_AUTHORIZATION_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-authorization/v2";
export const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_INTENT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-intent/v2";
export const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_RECEIPT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-receipt/v2";
export const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_PHASES =
  Object.freeze(["complete"]);

const OPERATION = "active-dirty-scope-expansion-intent-recovery";
const OPERATION_KEY_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-operation-key/v2";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildActiveDirtyScopeExpansionIntentRecoveryPlan({
  sourceEvidence,
} = {}) {
  const source = normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
    sourceEvidence,
  );
  if (source.scopeExpansionIntent.status !== "successor-bound") {
    throw new Error("Recovery planning requires the exact successor-bound source intent.");
  }
  const decisionEvidence =
    buildActiveDirtyScopeExpansionIntentRecoveryDecisionEvidence(source);
  return sealPlan({
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_PLAN_SCHEMA,
    operation: OPERATION,
    decisionEvidence,
    decisionEvidenceDigest: decisionEvidence.decisionEvidenceDigest,
    sourceEvidence: source,
    sourceEvidenceDigest: source.sourceEvidenceDigest,
  });
}

export function normalizeActiveDirtyScopeExpansionIntentRecoveryPlan(value) {
  object(value, "Recovery plan");
  exactKeys(value, [
    "schema", "operation", "decisionEvidence", "decisionEvidenceDigest",
    "sourceEvidence", "sourceEvidenceDigest", "planDigest", "exactAuthorization",
  ], "Recovery plan");
  const source = normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
    value.sourceEvidence,
  );
  const decision = normalizeActiveDirtyScopeExpansionIntentRecoveryDecisionEvidence(
    value.decisionEvidence,
  );
  const projectedDecision =
    buildActiveDirtyScopeExpansionIntentRecoveryDecisionEvidence(source);
  const expected = sealPlan({
    schema: text(value.schema, "plan schema"),
    operation: text(value.operation, "plan operation"),
    decisionEvidence: decision,
    decisionEvidenceDigest: digest(value.decisionEvidenceDigest,
      "decision-evidence digest"),
    sourceEvidence: source,
    sourceEvidenceDigest: digest(value.sourceEvidenceDigest, "source-evidence digest"),
  });
  if (expected.schema !== ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_PLAN_SCHEMA
    || expected.operation !== OPERATION
    || source.scopeExpansionIntent.status !== "successor-bound"
    || expected.decisionEvidenceDigest !== decision.decisionEvidenceDigest
    || canonicalJson(decision) !== canonicalJson(projectedDecision)
    || expected.sourceEvidenceDigest !== source.sourceEvidenceDigest
    || canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Recovery plan digest or exact authorization drifted.");
  }
  return expected;
}

export function authorizeActiveDirtyScopeExpansionIntentRecovery(
  plan,
  authorization,
) {
  const normalized = normalizeActiveDirtyScopeExpansionIntentRecoveryPlan(plan);
  if (typeof authorization !== "string"
    || authorization !== normalized.exactAuthorization) {
    throw new Error(`Recovery requires exact authorization: ${normalized.exactAuthorization}`);
  }
  const core = authorizationCore(normalized, authorization);
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createActiveDirtyScopeExpansionIntentRecoveryIntent(
  plan,
  authorizationReceipt,
) {
  const normalizedPlan = normalizeActiveDirtyScopeExpansionIntentRecoveryPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealRecoveryIntent({
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    terminal: null,
  });
}

export function refreshActiveDirtyScopeExpansionIntentRecoveryIntent(
  intent,
  currentPlan,
) {
  const stored = normalizeActiveDirtyScopeExpansionIntentRecoveryIntent(intent);
  const plan = normalizeActiveDirtyScopeExpansionIntentRecoveryPlan(currentPlan);
  if (stored.status !== "authorized" || stored.planDigest !== plan.planDigest
    || stored.authorizationDigest !== authorizationDigestForPlan(plan)) {
    throw new Error("Recovery observation refresh changed its semantic authority.");
  }
  return sealRecoveryIntent({
    schema: stored.schema,
    planDigest: stored.planDigest,
    planSnapshot: plan,
    authorizationDigest: stored.authorizationDigest,
    status: stored.status,
    terminal: stored.terminal,
  });
}

export function normalizeActiveDirtyScopeExpansionIntentRecoveryIntent(value) {
  object(value, "Recovery intent");
  exactKeys(value, [
    "schema", "planDigest", "planSnapshot", "authorizationDigest", "status",
    "terminal", "intentDigest",
  ], "Recovery intent");
  const plan = normalizeActiveDirtyScopeExpansionIntentRecoveryPlan(value.planSnapshot);
  const status = text(value.status, "recovery intent status");
  const authorizationDigest = digest(value.authorizationDigest, "authorization digest");
  const operationKey = activeDirtyScopeExpansionIntentRecoveryOperationKey(
    plan.planDigest,
    authorizationDigest,
  );
  const terminal = value.terminal == null ? null : deepFreeze({
    operationKey: digest(value.terminal.operationKey, "terminal operation key"),
    observation: normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation(
      value.terminal.observation,
      {
        planDigest: plan.planDigest,
        operationKey,
        sourceEvidenceDigest: plan.sourceEvidenceDigest,
        sourceEvidence: plan.sourceEvidence,
      },
    ),
  });
  const core = {
    schema: text(value.schema, "recovery intent schema"),
    planDigest: digest(value.planDigest, "recovery intent plan digest"),
    planSnapshot: plan,
    authorizationDigest,
    status,
    terminal,
  };
  if (core.schema !== ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest
    || authorizationDigest !== authorizationDigestForPlan(plan)
    || !["authorized", "complete"].includes(status)
    || (status === "authorized") !== (terminal === null)
    || (terminal && terminal.operationKey !== operationKey)
    || value.intentDigest !== digestValue(core)) {
    throw new Error("Recovery intent is malformed or digest-invalid.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function completeActiveDirtyScopeExpansionIntentRecoveryIntent(
  intent,
  observation,
) {
  const current = normalizeActiveDirtyScopeExpansionIntentRecoveryIntent(intent);
  const operationKey = activeDirtyScopeExpansionIntentRecoveryOperationKey(
    current.planDigest,
    current.authorizationDigest,
  );
  const normalizedObservation =
    normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation(
      observation,
      {
        planDigest: current.planDigest,
        operationKey,
        sourceEvidenceDigest: current.planSnapshot.sourceEvidenceDigest,
        sourceEvidence: current.planSnapshot.sourceEvidence,
      },
    );
  const terminal = deepFreeze({ operationKey, observation: normalizedObservation });
  if (current.status === "complete") {
    if (canonicalJson(current.terminal) !== canonicalJson(terminal)) {
      throw new Error("Recovery terminal replay drifted.");
    }
    return current;
  }
  return sealRecoveryIntent({
    schema: current.schema,
    planDigest: current.planDigest,
    planSnapshot: current.planSnapshot,
    authorizationDigest: current.authorizationDigest,
    status: "complete",
    terminal,
  });
}

export function activeDirtyScopeExpansionIntentRecoveryOperationKey(
  planDigest,
  authorizationDigest,
) {
  return digestValue({
    schema: OPERATION_KEY_SCHEMA,
    operation: "complete",
    planDigest: digest(planDigest, "operation-key plan digest"),
    authorizationDigest: digest(
      authorizationDigest,
      "operation-key authorization digest",
    ),
  });
}

export function projectTerminalScopeExpansionIntent({
  sourceIntent,
  currentLeaseDigest,
  currentAuthority,
  mutationAuthorityReceipt,
  pullRequestMarkerDigest,
  pullRequestUrl,
} = {}) {
  const source = normalizeRecoverableScopeExpansionIntent(
    sourceIntent,
    { expectedStatus: "successor-bound" },
  );
  const leaseDigest = digest(currentLeaseDigest, "current lease digest");
  const authority = authorityProjection(currentAuthority);
  const mutation = mutationProjection(mutationAuthorityReceipt);
  const markerDigest = digest(pullRequestMarkerDigest, "pull-request marker digest");
  const url = text(pullRequestUrl, "pull-request URL");
  if (authority.claimId !== source.targetClaimId
    || authority.transitionCounter !== source.boundAuthority.transitionCounter + 1
    || mutation.claimId !== authority.claimId
    || mutation.claimDigest !== authority.claimDigest
    || mutation.claimLedgerRevision !== authority.claimLedgerRevision) {
    throw new Error("Terminal projection does not join the exact heartbeat successor.");
  }
  const pullRequestProjectionReceiptDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-pr-projection/v1",
    planDigest: source.planDigest,
    pullRequestUrl: url,
    markerDigest,
  });
  const finalReceiptDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-complete/v1",
    planDigest: source.planDigest,
    mutationAuthorityReceiptDigest: mutation.receiptDigest,
    pullRequestMarkerDigest: markerDigest,
  });
  const projected = {
    ...source,
    status: "complete",
    localProjection: {
      leaseDigest,
      claimId: authority.claimId,
      receiptDigest: mutation.receiptDigest,
    },
    localProjectionReceiptDigest: mutation.receiptDigest,
    pullRequestProjection: { markerDigest },
    pullRequestProjectionReceiptDigest,
    finalReceiptDigest,
  };
  const terminal = normalizeRecoverableScopeExpansionIntent(
    projected,
    { expectedStatus: "complete" },
  );
  assertHistoricalIntentPreserved(source, terminal);
  return terminal;
}

export function buildActiveDirtyScopeExpansionIntentRecoveryReceipt(intent) {
  const complete = normalizeActiveDirtyScopeExpansionIntentRecoveryIntent(intent);
  if (complete.status !== "complete") {
    throw new Error("Recovery receipt requires the exact complete intent.");
  }
  const source = complete.planSnapshot.sourceEvidence;
  const observation = complete.terminal.observation;
  const core = {
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_RECEIPT_SCHEMA,
    status: "recovered",
    planDigest: complete.planDigest,
    sourceEvidenceDigest: source.sourceEvidenceDigest,
    authorizationDigest: complete.authorizationDigest,
    completeIntentDigest: complete.intentDigest,
    operationKey: complete.terminal.operationKey,
    terminalObservationDigest: observation.observationDigest,
    sourceScopeExpansionIntentDigest: source.scopeExpansionIntentDigest,
    recoveredScopeExpansionIntentDigest: observation.recoveredScopeExpansionIntentDigest,
    currentAuthorityDigest: observation.currentAuthorityDigest,
    heartbeatLineageDigest: observation.heartbeatLineageDigest,
    currentLeaseDigest: observation.currentLeaseDigest,
    pullRequestMarkerDigest: observation.pullRequestMarkerDigest,
    mutationAuthorityReceiptDigest: observation.mutationAuthorityReceiptDigest,
    finalReceiptDigest: observation.finalReceiptDigest,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeActiveDirtyScopeExpansionIntentRecoveryReceipt(
  value,
  expectedIntent,
) {
  if (!expectedIntent) {
    throw new Error("Recovery receipt proof requires the expected complete intent.");
  }
  object(value, "Recovery receipt");
  const fields = [
    "schema", "status", "planDigest", "sourceEvidenceDigest", "authorizationDigest",
    "completeIntentDigest", "operationKey", "terminalObservationDigest",
    "sourceScopeExpansionIntentDigest", "recoveredScopeExpansionIntentDigest",
    "currentAuthorityDigest", "heartbeatLineageDigest", "currentLeaseDigest",
    "pullRequestMarkerDigest", "mutationAuthorityReceiptDigest",
    "finalReceiptDigest", "receiptDigest",
  ];
  exactKeys(value, fields, "Recovery receipt");
  const core = Object.fromEntries(fields.slice(2, -1).map(key => [
    key,
    digest(value[key], `receipt ${key}`),
  ]));
  const normalized = {
    schema: text(value.schema, "receipt schema"),
    status: text(value.status, "receipt status"),
    ...core,
  };
  if (normalized.schema !== ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_RECEIPT_SCHEMA
    || normalized.status !== "recovered"
    || normalized.operationKey !== activeDirtyScopeExpansionIntentRecoveryOperationKey(
      normalized.planDigest,
      normalized.authorizationDigest,
    )
    || value.receiptDigest !== digestValue(normalized)) {
    throw new Error("Recovery receipt is malformed or digest-invalid.");
  }
  const receipt = deepFreeze({ ...normalized, receiptDigest: value.receiptDigest });
  if (canonicalJson(receipt) !== canonicalJson(
    buildActiveDirtyScopeExpansionIntentRecoveryReceipt(expectedIntent),
  )) {
    throw new Error("Recovery receipt changed its complete intent.");
  }
  return receipt;
}

function sealPlan(core) {
  const planDigest = digestValue({
    schema: core.schema,
    operation: core.operation,
    decisionEvidence: core.decisionEvidence,
    decisionEvidenceDigest: core.decisionEvidenceDigest,
  });
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

function authorizationCore(plan, authorization) {
  return {
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_AUTHORIZATION_SCHEMA,
    planDigest: plan.planDigest,
    decisionEvidenceDigest: plan.decisionEvidenceDigest,
    operatorDecisionDigest: plan.planDigest,
    authorization,
  };
}

function normalizeAuthorization(value, plan) {
  object(value, "Recovery authorization");
  exactKeys(value, [
    "schema", "planDigest", "decisionEvidenceDigest", "operatorDecisionDigest",
    "authorization", "authorizationDigest",
  ], "Recovery authorization");
  const core = authorizationCore(plan, value.authorization);
  if (value.schema !== core.schema || value.planDigest !== core.planDigest
    || value.decisionEvidenceDigest !== core.decisionEvidenceDigest
    || value.operatorDecisionDigest !== core.operatorDecisionDigest
    || value.authorization !== plan.exactAuthorization
    || value.authorizationDigest !== digestValue(core)) {
    throw new Error("Recovery authorization receipt drifted.");
  }
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function authorizationDigestForPlan(plan) {
  return digestValue(authorizationCore(plan, plan.exactAuthorization));
}

function sealRecoveryIntent(core) {
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function authorityProjection(value) {
  object(value, "Current authority");
  if (value.schema !== "agentic-lane-cloud-authority/v1" || value.state !== "active") {
    throw new Error("Current authority is not active.");
  }
  return {
    claimId: digest(value.claimId, "current authority claim ID"),
    claimDigest: digest(value.claimDigest, "current authority claim digest"),
    claimLedgerRevision: digest(value.claimLedgerRevision,
      "current authority claim ledger revision"),
    ledgerRevision: sha(value.ledgerRevision, "current authority ledger revision"),
    transitionCounter: integer(value.transitionCounter, "current transition counter", 1),
  };
}

function mutationProjection(value) {
  object(value, "Mutation-authority receipt");
  const core = { ...value };
  const receiptDigest = core.receiptDigest;
  delete core.receiptDigest;
  if (value.schema !== "agentic-active-dirty-scope-expansion-intent-recovery-mutation-authority/v1"
    || value.status !== "ready" || receiptDigest !== digestValue(core)) {
    throw new Error("Mutation-authority receipt is malformed.");
  }
  return {
    claimId: digest(value.claimId, "mutation-authority claim ID"),
    claimDigest: digest(value.claimDigest, "mutation-authority claim digest"),
    claimLedgerRevision: digest(value.claimLedgerRevision,
      "mutation-authority claim ledger revision"),
    globalLedgerRevision: sha(value.globalLedgerRevision,
      "mutation-authority global ledger revision"),
    receiptDigest,
  };
}

function assertHistoricalIntentPreserved(source, target) {
  const mutable = new Set([
    "status", "localProjection", "localProjectionReceiptDigest",
    "pullRequestProjection", "pullRequestProjectionReceiptDigest", "finalReceiptDigest",
  ]);
  for (const key of Object.keys(source)) {
    if (!mutable.has(key) && canonicalJson(source[key]) !== canonicalJson(target[key])) {
      throw new Error(`Terminal recovery changed historical intent field ${key}.`);
    }
  }
  if (canonicalJson(source.boundAuthority) !== canonicalJson(target.boundAuthority)
    || source.boundReceiptDigest !== target.boundReceiptDigest) {
    throw new Error("Terminal recovery changed historical bound authority.");
  }
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function exactKeys(value, keys, label) { if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(`${label} has unexpected or missing fields.`); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
function digest(value, label) { if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} must be a Git SHA.`); return value; }
function integer(value, label, minimum) { if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} is invalid.`); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
