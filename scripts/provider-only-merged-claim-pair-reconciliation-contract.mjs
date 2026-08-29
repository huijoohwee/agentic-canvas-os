// Responsibility: seal provider-only pair plans, exact authorization, durable intents, and terminal receipts.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeProviderOnlyMergedClaimPairReconciliationEvidence,
} from "./provider-only-merged-claim-pair-reconciliation-evidence.mjs";

export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PLAN_SCHEMA =
  "agentic-provider-only-merged-claim-pair-reconciliation-plan/v1";
export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_AUTHORIZATION_SCHEMA =
  "agentic-provider-only-merged-claim-pair-reconciliation-authorization/v1";
export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_INTENT_SCHEMA =
  "agentic-provider-only-merged-claim-pair-reconciliation-intent/v1";
export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RECEIPT_SCHEMA =
  "agentic-provider-only-merged-claim-pair-reconciliation-receipt/v1";

const OPERATION_KEY_SCHEMA =
  "agentic-provider-only-merged-claim-pair-reconciliation-operation-key/v1";
const PHASES = Object.freeze([
  "prepared",
  "waiter-retired",
  "source-recovered",
  "source-integrated",
  "source-retired",
  "verified",
  "complete",
]);
const STATUSES = Object.freeze(["authorized", ...PHASES]);
const DIGEST = /^[0-9a-f]{64}$/u;
const INTEGRATION_PHASES = new Set([
  "source-integrated", "source-retired", "verified", "complete",
]);

export function buildProviderOnlyMergedClaimPairReconciliationPlan(source) {
  const evidence = normalizeProviderOnlyMergedClaimPairReconciliationEvidence(source);
  const { cloud, controller, provider } = evidence;
  const sourceEvidenceDigest = digestValue({
    schema: "agentic-provider-only-merged-claim-pair-stable-source-evidence/v1",
    controllerRuntimeDigest: controller.runtimeDigest,
    provider,
    local: evidence.local,
    source: cloud.source,
    waiter: cloud.waiter,
    sourceLineageDigest: cloud.sourceLineageDigest,
    waiterLineageDigest: cloud.waiterLineageDigest,
    bytesDigest: evidence.bytesDigest,
    namedChecksDigest: evidence.namedChecksDigest,
    handoffEvidenceDigest: evidence.handoffEvidenceDigest,
  });
  const stableCore = {
    schema: PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PLAN_SCHEMA,
    provider: provider.provider,
    targetRepository: provider.repository,
    repositoryId: provider.repositoryId,
    actorId: provider.actorId,
    ledgerRepository: cloud.ledgerRepository,
    controllerRevision: controller.headSha,
    controllerRuntimeDigest: controller.runtimeDigest,
    sourceClaimId: cloud.source.claimId,
    sourceClaimDigest: cloud.source.claimDigest,
    sourceTransitionDigest: cloud.source.transitionDigest,
    sourceTransitionCounter: cloud.source.transitionCounter,
    sourceLaneRevision: cloud.source.laneRevision,
    sourceReviewRequestId: cloud.source.reviewRequestId,
    sourceFocusedEvidenceDigest: cloud.source.evidenceDigest,
    sourceLeaseEpoch: cloud.source.leaseEpoch,
    waiterClaimId: cloud.waiter.claimId,
    waiterClaimDigest: cloud.waiter.claimDigest,
    waiterTransitionDigest: cloud.waiter.transitionDigest,
    waiterTransitionCounter: cloud.waiter.transitionCounter,
    waiterLeaseEpoch: cloud.waiter.leaseEpoch,
    effectDeviceId: cloud.source.deviceId,
    effectSessionId: cloud.source.sessionId,
    recoveryTtlSeconds: evidence.recoveryTtlSeconds,
    writeSetDigest: cloud.source.writeSetDigest,
    pullRequestNumber: provider.pullRequest.number,
    pullRequestNodeId: provider.pullRequest.nodeId,
    mergeCommitSha: provider.mergeCommit.sha,
    protectedMainSha: provider.protectedMain.sha,
    sourceEvidenceDigest,
    bytesDigest: evidence.bytesDigest,
    namedChecksDigest: evidence.namedChecksDigest,
    handoffEvidenceDigest: evidence.handoffEvidenceDigest,
    dependencyClosureDigest: digestValue({
      schema: "agentic-provider-only-merged-claim-pair-dependency-closure/v1",
      controllerRuntimeDigest: controller.runtimeDigest,
      sourceEvidenceDigest,
      sourceLineageDigest: cloud.sourceLineageDigest,
      waiterLineageDigest: cloud.waiterLineageDigest,
      mergeCommitSha: provider.mergeCommit.sha,
      protectedMainSha: provider.protectedMain.sha,
    }),
    waiterRetirementReason: "superseded",
    sourceRetirementReason: "integrated",
    finalRevision: cloud.source.laneRevision,
    phases: PHASES,
  };
  const observation = {
    expectedLedgerRevision: cloud.ledgerRevision,
    expectedLedgerDigest: cloud.ledgerDigest,
    expectedLedgerSequence: cloud.sequence,
    expectedCurrentInventoryDigest: cloud.currentInventoryDigest,
    expectedUnrelatedInventoryDigest: cloud.unrelatedInventoryDigest,
    evidence,
  };
  const planDigest = digestValue(stableCore);
  return deepFreeze({
    ...stableCore,
    ...observation,
    exactAuthorization: `authorize provider-only-merged-claim-pair-reconciliation ${planDigest}`,
    planDigest,
  });
}

export function normalizeProviderOnlyMergedClaimPairReconciliationPlan(value) {
  object(value, "Provider-only reconciliation plan");
  const rebuilt = buildProviderOnlyMergedClaimPairReconciliationPlan(value.evidence);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    throw new Error("Provider-only merged-claim-pair plan is malformed or digest-drifted.");
  }
  return rebuilt;
}

export function authorizeProviderOnlyMergedClaimPairReconciliation({ plan, authorization }) {
  const normalized = normalizeProviderOnlyMergedClaimPairReconciliationPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(
      `Provider-only merged-claim-pair reconciliation requires exact authorization: ${normalized.exactAuthorization}`,
    );
  }
  const core = {
    schema: PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    authorization: normalized.exactAuthorization,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createProviderOnlyMergedClaimPairReconciliationIntent({
  plan,
  authorizationReceipt,
}) {
  const normalizedPlan = normalizeProviderOnlyMergedClaimPairReconciliationPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    phases: {},
  });
}

export function normalizeProviderOnlyMergedClaimPairReconciliationIntent(value) {
  object(value, "Provider-only reconciliation intent");
  const plan = normalizeProviderOnlyMergedClaimPairReconciliationPlan(value.planSnapshot);
  const status = requiredStatus(value.status);
  const authorizationDigest = digest(value.authorizationDigest, "intent authorization digest");
  const expectedAuthorizationDigest = digestValue({
    schema: PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_AUTHORIZATION_SCHEMA,
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  if (authorizationDigest !== expectedAuthorizationDigest) {
    throw new Error("Provider-only reconciliation intent authorization digest drifted.");
  }
  const phases = normalizePhases(value.phases, plan, status);
  const core = {
    schema: text(value.schema, "intent schema"),
    planDigest: digest(value.planDigest, "intent plan digest"),
    planSnapshot: plan,
    authorizationDigest,
    status,
    phases,
  };
  if (core.schema !== PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest || value.intentDigest !== digestValue(core)) {
    throw new Error("Provider-only merged-claim-pair intent is malformed or digest-drifted.");
  }
  if (status === "complete") assertCompleteReceipt(core);
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function advanceProviderOnlyMergedClaimPairReconciliationIntent(
  intent,
  { status, values },
) {
  const current = normalizeProviderOnlyMergedClaimPairReconciliationIntent(intent);
  const nextStatus = requiredStatus(status);
  const currentIndex = STATUSES.indexOf(current.status);
  const nextIndex = STATUSES.indexOf(nextStatus);
  const normalizedValues = jsonObject(values, `${nextStatus} intent values`);
  if (nextIndex === currentIndex) {
    if (canonicalJson(current.phases[nextStatus]?.values) !== canonicalJson(normalizedValues)) {
      throw new Error(`Provider-only reconciliation ${nextStatus} replay drifted.`);
    }
    return current;
  }
  if (nextStatus === "authorized" || nextIndex !== currentIndex + 1) {
    throw new Error(`Provider-only reconciliation cannot advance from ${current.status} to ${nextStatus}.`);
  }
  const expectedKey = providerOnlyMergedClaimPairReconciliationOperationKey(
    current.planSnapshot,
    nextStatus,
  );
  assertPhaseValueShape(nextStatus, normalizedValues);
  if (normalizedValues.operationKey !== expectedKey) {
    throw new Error(`Provider-only reconciliation ${nextStatus} evidence is not operation-bound.`);
  }
  assertIntegrationReceiptChain(current.phases, nextStatus, normalizedValues);
  if (nextStatus === "complete") assertReceiptMatchesVerified(current, normalizedValues);
  return sealIntent({
    schema: current.schema,
    planDigest: current.planDigest,
    planSnapshot: current.planSnapshot,
    authorizationDigest: current.authorizationDigest,
    status: nextStatus,
    phases: {
      ...current.phases,
      [nextStatus]: { values: normalizedValues },
    },
  });
}

export function providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase) {
  const normalized = normalizeProviderOnlyMergedClaimPairReconciliationPlan(plan);
  const normalizedPhase = requiredPhase(phase);
  return digestValue({
    schema: OPERATION_KEY_SCHEMA,
    planDigest: normalized.planDigest,
    phase: normalizedPhase,
  });
}

export function assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, ledger) {
  const normalized = normalizeProviderOnlyMergedClaimPairReconciliationPlan(plan);
  const expected = [
    ["waiter-retired", "retire", normalized.waiterClaimId, normalized.waiterTransitionCounter + 1],
    ["source-recovered", "continue", normalized.sourceClaimId, normalized.sourceTransitionCounter + 1],
    ["source-integrated", "integrate", normalized.sourceClaimId, normalized.sourceTransitionCounter + 2],
    ["source-retired", "retire", normalized.sourceClaimId, normalized.sourceTransitionCounter + 3],
  ];
  const baselines = new Map([
    [normalized.sourceClaimId, normalized.sourceTransitionCounter],
    [normalized.waiterClaimId, normalized.waiterTransitionCounter],
  ]);
  const tail = ledger.entries.filter(entry => {
    if (entry.repositoryId !== normalized.repositoryId || !baselines.has(entry.claimId)) {
      return false;
    }
    const counter = entry.claimCore?.transitionCounter;
    if (!Number.isSafeInteger(counter) || counter < 1) {
      throw new Error("Target-pair ledger tail contains an invalid transition counter.");
    }
    return counter > baselines.get(entry.claimId);
  });
  if (tail.length > expected.length) {
    throw new Error("Target-repository ledger tail exceeds the closed sequence.");
  }
  for (const [index, entry] of tail.entries()) {
    const [phase, action, claimId, counter] = expected[index];
    const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(normalized, phase);
    if (entry.action !== action || entry.claimId !== claimId
      || entry.claimCore?.transitionCounter !== counter
      || entry.idempotencyKey !== digestValue(
        `provider-only-merged-claim-pair-reconciliation:${operationKey}`,
      )) throw new Error("Target-repository ledger tail escaped the exact waiter-first sequence.");
  }
  return Object.freeze(tail);
}

export function buildProviderOnlyMergedClaimPairReconciliationReceipt({ plan, intent, values }) {
  const normalizedPlan = normalizeProviderOnlyMergedClaimPairReconciliationPlan(plan);
  const normalizedIntent = normalizeProviderOnlyMergedClaimPairReconciliationIntent(intent);
  const normalizedValues = jsonObject(values, "terminal receipt values");
  assertExactKeys(normalizedValues, [
    "evidenceDigest", "operationKey", "sourceIntegrationReceiptDigest",
  ], "terminal receipt values");
  if (normalizedIntent.status !== "verified"
    || normalizedIntent.planDigest !== normalizedPlan.planDigest
    || normalizedValues.operationKey !== providerOnlyMergedClaimPairReconciliationOperationKey(
      normalizedPlan,
      "complete",
  )) {
    throw new Error("Terminal receipt requires the exact verified provider-only intent.");
  }
  const integrationReceiptDigest = digest(
    normalizedValues.sourceIntegrationReceiptDigest,
    "source integration receipt digest",
  );
  const verified = normalizedIntent.phases.verified.values;
  if (integrationReceiptDigest !== verified.sourceIntegrationReceiptDigest) {
    throw new Error("Terminal receipt source integration receipt drifted from verified intent.");
  }
  const expectedEvidenceDigest = digestValue({
    schema: "agentic-provider-only-merged-claim-pair-completion-evidence/v1",
    planDigest: normalizedPlan.planDigest,
    verifiedEvidenceDigest: verified.evidenceDigest,
    sourceIntegrationReceiptDigest: integrationReceiptDigest,
  });
  if (normalizedValues.evidenceDigest !== expectedEvidenceDigest) {
    throw new Error("Terminal receipt completion evidence drifted from verified intent.");
  }
  const core = {
    schema: PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RECEIPT_SCHEMA,
    status: "complete",
    planDigest: normalizedPlan.planDigest,
    authorizationDigest: normalizedIntent.authorizationDigest,
    verifiedIntentDigest: normalizedIntent.intentDigest,
    sourceClaimId: normalizedPlan.sourceClaimId,
    waiterClaimId: normalizedPlan.waiterClaimId,
    finalRevision: normalizedPlan.finalRevision,
    bytesDigest: normalizedPlan.bytesDigest,
    namedChecksDigest: normalizedPlan.namedChecksDigest,
    handoffEvidenceDigest: normalizedPlan.handoffEvidenceDigest,
    sourceIntegrationReceiptDigest: integrationReceiptDigest,
    operationKey: normalizedValues.operationKey,
    evidenceDigest: expectedEvidenceDigest,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeAuthorization(value, plan) {
  object(value, "Provider-only authorization receipt");
  const core = {
    schema: text(value.schema, "authorization schema"),
    planDigest: digest(value.planDigest, "authorization plan digest"),
    authorization: text(value.authorization, "authorization text"),
  };
  if (core.schema !== PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_AUTHORIZATION_SCHEMA
    || core.planDigest !== plan.planDigest || core.authorization !== plan.exactAuthorization
    || value.authorizationDigest !== digestValue(core)) {
    throw new Error("Provider-only reconciliation authorization receipt is invalid.");
  }
  return Object.freeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function normalizePhases(value, plan, status) {
  object(value, "Intent phases");
  const statusIndex = STATUSES.indexOf(status);
  const normalized = {};
  for (let index = 1; index <= statusIndex; index += 1) {
    const phase = STATUSES[index];
    object(value[phase], `${phase} phase`);
    const values = jsonObject(value[phase].values, `${phase} phase values`);
    assertPhaseValueShape(phase, values);
    if (values.operationKey !== providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase)) {
      throw new Error(`Intent phase ${phase} is not operation-bound.`);
    }
    assertIntegrationReceiptChain(normalized, phase, values);
    normalized[phase] = deepFreeze({ values });
  }
  const expected = STATUSES.slice(1, statusIndex + 1);
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new Error("Intent phase set is not the exact contiguous prefix.");
  }
  return deepFreeze(normalized);
}

function assertPhaseValueShape(phase, values) {
  const keys = ["evidenceDigest", "operationKey"];
  if (INTEGRATION_PHASES.has(phase)) keys.push("sourceIntegrationReceiptDigest");
  if (phase === "complete") keys.push("receipt");
  assertExactKeys(values, keys, `${phase} phase values`);
  digest(values.evidenceDigest, `${phase} evidence digest`);
  if (INTEGRATION_PHASES.has(phase)) {
    digest(values.sourceIntegrationReceiptDigest, `${phase} source integration receipt digest`);
  }
  if (phase === "complete") object(values.receipt, "completion receipt");
}

function assertIntegrationReceiptChain(phases, phase, values) {
  if (!INTEGRATION_PHASES.has(phase) || phase === "source-integrated") return;
  const integrated = phases["source-integrated"]?.values?.sourceIntegrationReceiptDigest;
  if (values.sourceIntegrationReceiptDigest !== integrated) {
    throw new Error(`Provider-only reconciliation ${phase} integration receipt drifted.`);
  }
}

function assertReceiptMatchesVerified(verifiedIntent, completeValues) {
  const { receipt, ...values } = completeValues;
  const expected = buildProviderOnlyMergedClaimPairReconciliationReceipt({
    plan: verifiedIntent.planSnapshot,
    intent: verifiedIntent,
    values,
  });
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    throw new Error("Provider-only reconciliation completion receipt drifted.");
  }
}

function assertCompleteReceipt(core) {
  const { complete: _complete, ...verifiedPhases } = core.phases;
  const verified = sealIntent({ ...core, status: "verified", phases: verifiedPhases });
  assertReceiptMatchesVerified(verified, core.phases.complete.values);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(normalizedExpected)) {
    throw new Error(`${label} must contain the exact keys ${normalizedExpected.join(", ")}.`);
  }
}

function sealIntent(core) {
  const normalized = deepFreeze(core);
  return deepFreeze({ ...normalized, intentDigest: digestValue(normalized) });
}
function requiredStatus(value) {
  const result = text(value, "intent status");
  if (!STATUSES.includes(result)) throw new Error(`Unsupported provider-only status: ${result}.`);
  return result;
}
function requiredPhase(value) {
  const result = text(value, "operation phase");
  if (!PHASES.includes(result)) throw new Error(`Unsupported provider-only phase: ${result}.`);
  return result;
}
function jsonObject(value, label) {
  object(value, label);
  try { return deepFreeze(JSON.parse(JSON.stringify(value))); }
  catch { throw new Error(`${label} must be JSON-compatible.`); }
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.normalize("NFC").trim();
}
function digest(value, label) {
  const result = text(value, label);
  if (!DIGEST.test(result)) throw new Error(`${label} must be a SHA-256 digest.`);
  return result;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
