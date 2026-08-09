// Responsibility: bind merged dormant reconciliation plans, authorization, durable phase intents, operation keys, and terminal receipts.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertMergedDormantClaimReconciliationSourceEvidence } from "./merged-dormant-claim-reconciliation-evidence.mjs";

export const MERGED_DORMANT_CLAIM_RECONCILIATION_PLAN_SCHEMA =
  "agentic-merged-dormant-claim-reconciliation-plan/v1";
export const MERGED_DORMANT_CLAIM_RECONCILIATION_AUTHORIZATION_SCHEMA =
  "agentic-merged-dormant-claim-reconciliation-authorization/v1";
export const MERGED_DORMANT_CLAIM_RECONCILIATION_INTENT_SCHEMA =
  "agentic-merged-dormant-claim-reconciliation-intent/v1";
export const MERGED_DORMANT_CLAIM_RECONCILIATION_RECEIPT_SCHEMA =
  "agentic-merged-dormant-claim-reconciliation-receipt/v1";

const OPERATION_KEY_SCHEMA = "agentic-merged-dormant-claim-reconciliation-operation-key/v1";
const PHASES = Object.freeze(["prepared", "recovered", "integrated", "retired", "complete"]);
const STATUSES = Object.freeze(["authorized", ...PHASES]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildMergedDormantClaimReconciliationPlan(source) {
  const evidence = assertMergedDormantClaimReconciliationSourceEvidence(source);
  const { claim, provider } = evidence;
  const core = {
    schema: MERGED_DORMANT_CLAIM_RECONCILIATION_PLAN_SCHEMA,
    provider: provider.provider,
    targetRepository: provider.repository,
    repositoryId: claim.repositoryId,
    actorId: claim.actorId,
    workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    recoveryDeviceId: evidence.local.lease.device,
    recoverySessionId: evidence.local.lease.sessionId,
    expectedCloudDeviceId: claim.deviceId,
    expectedCloudSessionId: claim.sessionId,
    claimId: claim.claimId,
    claimDigest: claim.claimDigest,
    claimTransitionDigest: claim.transitionDigest,
    claimOperationReceiptDigest: claim.operationReceiptDigest,
    expectedLedgerRevision: claim.ledgerRevision,
    expectedLedgerDigest: claim.ledgerDigest,
    expectedTransitionCounter: claim.transitionCounter,
    claimLeaseEpoch: claim.leaseEpoch,
    claimLaneRevision: claim.laneRevision,
    claimReviewRequestId: claim.reviewRequestId,
    claimFocusedEvidenceDigest: claim.evidenceDigest,
    claimWriteSetDigest: claim.writeSetDigest,
    pullRequestNumber: provider.pullRequest.number,
    pullRequestNodeId: provider.pullRequest.nodeId,
    pullRequestHeadSha: provider.pullRequest.headSha,
    pullRequestHeadTreeSha: provider.pullRequest.headTreeSha,
    pullRequestMergeCommitSha: provider.pullRequest.mergeCommitSha,
    pullRequestMergeCommitTreeSha: provider.pullRequest.mergeCommitTreeSha,
    protectedMainSha: provider.protectedMain.sha,
    protectedMainTreeSha: provider.protectedMain.treeSha,
    sourceEvidenceDigest: evidence.sourceEvidenceDigest,
    bytesDigest: evidence.bytesDigest,
    refreshTopologyDigest: evidence.refreshTopologyDigest,
    namedChecksDigest: evidence.namedChecksDigest,
    handoffEvidenceDigest: evidence.handoffEvidenceDigest,
    localSnapshotDigest: digestValue(evidence.local),
    localAuthorityDigest: digestValue(evidence.local.lease.cloudAuthority),
    dependencyClosureDigest: digestValue({
      schema: "agentic-merged-dormant-claim-reconciliation-dependency-closure/v1",
      sourceEvidenceDigest: evidence.sourceEvidenceDigest,
      refreshTopologyDigest: evidence.refreshTopologyDigest,
      claimWriteSetDigest: claim.writeSetDigest,
      pullRequestMergeCommitSha: provider.pullRequest.mergeCommitSha,
      protectedMainSha: provider.protectedMain.sha,
    }),
    retirementReason: "integrated",
    finalRevision: claim.laneRevision,
    integrationReceiptDigest: null,
    phases: PHASES,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    exactAuthorization: `authorize merged-dormant-claim-reconciliation ${planDigest}`,
    planDigest,
  });
}

export function normalizeMergedDormantClaimReconciliationPlan(value) {
  requireObject(value, "Reconciliation plan");
  const normalized = {
    schema: requiredText(value.schema, "plan schema"),
    provider: requiredText(value.provider, "plan provider"),
    targetRepository: requiredRepository(value.targetRepository, "plan target repository"),
    repositoryId: requiredText(value.repositoryId, "plan repository ID"),
    actorId: requiredText(value.actorId, "plan actor ID"),
    workItemId: requiredText(value.workItemId, "plan work-item ID"),
    canonicalBaseRevision: requiredSha(value.canonicalBaseRevision, "plan canonical base"),
    recoveryDeviceId: requiredText(value.recoveryDeviceId, "plan recovery device ID"),
    recoverySessionId: requiredText(value.recoverySessionId, "plan recovery session ID"),
    expectedCloudDeviceId: requiredText(value.expectedCloudDeviceId, "plan cloud device ID"),
    expectedCloudSessionId: requiredText(value.expectedCloudSessionId, "plan cloud session ID"),
    claimId: requiredDigest(value.claimId, "plan claim ID"),
    claimDigest: requiredDigest(value.claimDigest, "plan claim digest"),
    claimTransitionDigest: requiredDigest(value.claimTransitionDigest, "plan claim transition digest"),
    claimOperationReceiptDigest: requiredDigest(
      value.claimOperationReceiptDigest,
      "plan claim operation receipt digest",
    ),
    expectedLedgerRevision: requiredSha(value.expectedLedgerRevision, "plan ledger revision"),
    expectedLedgerDigest: requiredDigest(value.expectedLedgerDigest, "plan ledger digest"),
    expectedTransitionCounter: positiveInteger(
      value.expectedTransitionCounter,
      "plan transition counter",
    ),
    claimLeaseEpoch: positiveInteger(value.claimLeaseEpoch, "plan claim lease epoch"),
    claimLaneRevision: requiredSha(value.claimLaneRevision, "plan claim lane revision"),
    claimReviewRequestId: requiredText(value.claimReviewRequestId, "plan review request ID"),
    claimFocusedEvidenceDigest: requiredDigest(
      value.claimFocusedEvidenceDigest,
      "plan focused evidence digest",
    ),
    claimWriteSetDigest: requiredDigest(value.claimWriteSetDigest, "plan write-set digest"),
    pullRequestNumber: positiveInteger(value.pullRequestNumber, "plan pull request number"),
    pullRequestNodeId: requiredText(value.pullRequestNodeId, "plan pull request node ID"),
    pullRequestHeadSha: requiredSha(value.pullRequestHeadSha, "plan pull request head"),
    pullRequestHeadTreeSha: requiredSha(value.pullRequestHeadTreeSha, "plan pull request tree"),
    pullRequestMergeCommitSha: requiredSha(value.pullRequestMergeCommitSha, "plan merge commit"),
    pullRequestMergeCommitTreeSha: requiredSha(value.pullRequestMergeCommitTreeSha, "plan merge tree"),
    protectedMainSha: requiredSha(value.protectedMainSha, "plan protected main SHA"),
    protectedMainTreeSha: requiredSha(value.protectedMainTreeSha, "plan protected main tree"),
    sourceEvidenceDigest: requiredDigest(value.sourceEvidenceDigest, "plan source evidence digest"),
    bytesDigest: requiredDigest(value.bytesDigest, "plan bytes digest"),
    refreshTopologyDigest: requiredDigest(value.refreshTopologyDigest, "plan refresh-topology digest"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "plan named-checks digest"),
    handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "plan handoff evidence digest"),
    localSnapshotDigest: requiredDigest(value.localSnapshotDigest, "plan local snapshot digest"),
    localAuthorityDigest: requiredDigest(value.localAuthorityDigest, "plan local authority digest"),
    dependencyClosureDigest: requiredDigest(
      value.dependencyClosureDigest,
      "plan dependency-closure digest",
    ),
    retirementReason: requiredText(value.retirementReason, "plan retirement reason"),
    finalRevision: requiredSha(value.finalRevision, "plan final revision"),
    integrationReceiptDigest: requiredNull(
      value.integrationReceiptDigest,
      "plan integration receipt digest",
    ),
    phases: normalizePhases(value.phases),
  };
  if (normalized.schema !== MERGED_DORMANT_CLAIM_RECONCILIATION_PLAN_SCHEMA
    || normalized.provider !== "github" || normalized.retirementReason !== "integrated"
    || normalized.finalRevision !== normalized.claimLaneRevision) {
    throw new Error("Merged dormant reconciliation plan semantics are invalid.");
  }
  const expectedDigest = digestValue(normalized);
  const exactAuthorization = `authorize merged-dormant-claim-reconciliation ${expectedDigest}`;
  if (value.exactAuthorization !== exactAuthorization || value.planDigest !== expectedDigest) {
    throw new Error("Merged dormant reconciliation plan digest or exact authorization is invalid.");
  }
  return deepFreeze({ ...normalized, exactAuthorization, planDigest: expectedDigest });
}

export function authorizeMergedDormantClaimReconciliation({ plan, authorization }) {
  const normalizedPlan = normalizeMergedDormantClaimReconciliationPlan(plan);
  if (typeof authorization !== "string" || authorization !== normalizedPlan.exactAuthorization) {
    throw new Error(
      `Merged dormant reconciliation requires exact authorization: ${normalizedPlan.exactAuthorization}`,
    );
  }
  const core = {
    schema: MERGED_DORMANT_CLAIM_RECONCILIATION_AUTHORIZATION_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    authorization: normalizedPlan.exactAuthorization,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createMergedDormantClaimReconciliationIntent({ plan, authorizationReceipt }) {
  const normalizedPlan = normalizeMergedDormantClaimReconciliationPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: MERGED_DORMANT_CLAIM_RECONCILIATION_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    phases: {},
  });
}

export function normalizeMergedDormantClaimReconciliationIntent(value) {
  requireObject(value, "Reconciliation intent");
  const plan = normalizeMergedDormantClaimReconciliationPlan(value.planSnapshot || value.plan);
  const status = requiredStatus(value.status);
  const authorizationDigest = requiredDigest(value.authorizationDigest, "intent authorization digest");
  const phases = normalizeIntentPhases(value.phases, plan, status, authorizationDigest);
  const core = {
    schema: requiredText(value.schema, "intent schema"),
    planDigest: requiredDigest(value.planDigest, "intent plan digest"),
    planSnapshot: plan,
    authorizationDigest,
    status,
    phases,
  };
  if (core.schema !== MERGED_DORMANT_CLAIM_RECONCILIATION_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest
    || value.intentDigest !== digestValue(core)) {
    throw new Error("Merged dormant reconciliation intent is malformed or drifted.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function advanceMergedDormantClaimReconciliationIntent(intent, { status, values }) {
  const normalized = normalizeMergedDormantClaimReconciliationIntent(intent);
  const nextStatus = requiredStatus(status);
  const currentIndex = STATUSES.indexOf(normalized.status);
  const nextIndex = STATUSES.indexOf(nextStatus);
  let normalizedValues = normalizeJsonObject(values, `${nextStatus} intent values`);
  assertPhaseValueKeys(normalizedValues, nextStatus);
  if (nextIndex === currentIndex) {
    const existing = normalized.phases[nextStatus]?.values;
    if (canonicalJson(existing) !== canonicalJson(normalizedValues)) {
      throw new Error(`Merged dormant reconciliation ${nextStatus} replay drifted.`);
    }
    return normalized;
  }
  if (nextIndex !== currentIndex + 1 || nextStatus === "authorized") {
    throw new Error(`Merged dormant reconciliation cannot advance from ${normalized.status} to ${nextStatus}.`);
  }
  if (nextStatus !== "complete") {
    const expectedKey = mergedDormantClaimReconciliationOperationKey(
      normalized.planSnapshot,
      nextStatus,
    );
    if (normalizedValues.operationKey !== expectedKey
      || !DIGEST_PATTERN.test(String(normalizedValues.evidenceDigest || ""))) {
      throw new Error(`Merged dormant reconciliation ${nextStatus} evidence is not operation-bound.`);
    }
  } else if (!normalizedValues.receipt) {
    throw new Error("Merged dormant reconciliation completion requires its terminal receipt.");
  } else {
    const expectedKey = mergedDormantClaimReconciliationOperationKey(
      normalized.planSnapshot,
      "complete",
    );
    const evidenceDigest = requiredDigest(
      normalizedValues.evidenceDigest,
      "complete evidence digest",
    );
    const integrationReceiptDigest = requiredDigest(
      normalizedValues.integrationReceiptDigest,
      "complete integration receipt digest",
    );
    if (normalizedValues.operationKey !== expectedKey) {
      throw new Error("Merged dormant reconciliation completion operation key drifted.");
    }
    const receipt = normalizeMergedDormantClaimReconciliationReceipt(normalizedValues.receipt, {
        plan: normalized.planSnapshot,
        authorizationDigest: normalized.authorizationDigest,
        retiredIntentDigest: normalized.intentDigest,
        operationKey: expectedKey,
        evidenceDigest,
        integrationReceiptDigest,
      });
    normalizedValues = deepFreeze({ ...normalizedValues, receipt });
  }
  return sealIntent({
    schema: normalized.schema,
    planDigest: normalized.planDigest,
    planSnapshot: normalized.planSnapshot,
    authorizationDigest: normalized.authorizationDigest,
    status: nextStatus,
    phases: {
      ...normalized.phases,
      [nextStatus]: { values: normalizedValues },
    },
  });
}

export function mergedDormantClaimReconciliationOperationKey(plan, phase) {
  const normalized = normalizeMergedDormantClaimReconciliationPlan(plan);
  const normalizedPhase = requiredPhase(phase);
  return digestValue({
    schema: OPERATION_KEY_SCHEMA,
    planDigest: normalized.planDigest,
    phase: normalizedPhase,
  });
}

export function buildMergedDormantClaimReconciliationReceipt({ plan, intent, phase, values }) {
  const normalizedPlan = normalizeMergedDormantClaimReconciliationPlan(plan);
  const normalizedIntent = normalizeMergedDormantClaimReconciliationIntent(intent);
  const normalizedPhase = requiredPhase(phase);
  if (normalizedPhase !== "complete" || normalizedIntent.status !== "retired"
    || normalizedIntent.planDigest !== normalizedPlan.planDigest) {
    throw new Error("Terminal receipt requires the exact retired reconciliation intent.");
  }
  const normalizedValues = normalizeJsonObject(values, "terminal receipt values");
  const expectedKey = mergedDormantClaimReconciliationOperationKey(normalizedPlan, "complete");
  if (normalizedValues.operationKey !== expectedKey
    || !DIGEST_PATTERN.test(String(normalizedValues.evidenceDigest || ""))) {
    throw new Error("Terminal receipt evidence is not bound to the complete operation.");
  }
  const core = {
    schema: MERGED_DORMANT_CLAIM_RECONCILIATION_RECEIPT_SCHEMA,
    status: "complete",
    phase: "complete",
    planDigest: normalizedPlan.planDigest,
    authorizationDigest: normalizedIntent.authorizationDigest,
    retiredIntentDigest: normalizedIntent.intentDigest,
    claimId: normalizedPlan.claimId,
    finalRevision: normalizedPlan.finalRevision,
    retirementReason: normalizedPlan.retirementReason,
    bytesDigest: normalizedPlan.bytesDigest,
    namedChecksDigest: normalizedPlan.namedChecksDigest,
    handoffEvidenceDigest: normalizedPlan.handoffEvidenceDigest,
    operationKey: normalizedValues.operationKey,
    evidenceDigest: normalizedValues.evidenceDigest,
    integrationReceiptDigest: requiredDigest(
      normalizedValues.integrationReceiptDigest,
      "terminal integration receipt digest",
    ),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeMergedDormantClaimReconciliationReceipt(value, {
  plan,
  authorizationDigest,
  retiredIntentDigest,
  operationKey,
    evidenceDigest,
  integrationReceiptDigest,
} = {}) {
  const normalizedPlan = normalizeMergedDormantClaimReconciliationPlan(plan);
  requireObject(value, "Terminal reconciliation receipt");
  const core = {
    schema: requiredText(value.schema, "receipt schema"),
    status: requiredText(value.status, "receipt status"),
    phase: requiredText(value.phase, "receipt phase"),
    planDigest: requiredDigest(value.planDigest, "receipt plan digest"),
    authorizationDigest: requiredDigest(value.authorizationDigest, "receipt authorization digest"),
    retiredIntentDigest: requiredDigest(value.retiredIntentDigest, "receipt retired intent digest"),
    claimId: requiredDigest(value.claimId, "receipt claim ID"),
    finalRevision: requiredSha(value.finalRevision, "receipt final revision"),
    retirementReason: requiredText(value.retirementReason, "receipt retirement reason"),
    bytesDigest: requiredDigest(value.bytesDigest, "receipt bytes digest"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "receipt named-checks digest"),
    handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "receipt handoff digest"),
    operationKey: requiredDigest(value.operationKey, "receipt operation key"),
    evidenceDigest: requiredDigest(value.evidenceDigest, "receipt evidence digest"),
    integrationReceiptDigest: requiredDigest(
      value.integrationReceiptDigest,
      "receipt integration receipt digest",
    ),
  };
  const exact = core.schema === MERGED_DORMANT_CLAIM_RECONCILIATION_RECEIPT_SCHEMA
    && core.status === "complete" && core.phase === "complete"
    && core.planDigest === normalizedPlan.planDigest
    && core.authorizationDigest === requiredDigest(authorizationDigest, "expected authorization digest")
    && core.retiredIntentDigest === requiredDigest(retiredIntentDigest, "expected retired intent digest")
    && core.claimId === normalizedPlan.claimId && core.finalRevision === normalizedPlan.finalRevision
    && core.retirementReason === normalizedPlan.retirementReason
    && core.bytesDigest === normalizedPlan.bytesDigest
    && core.namedChecksDigest === normalizedPlan.namedChecksDigest
    && core.handoffEvidenceDigest === normalizedPlan.handoffEvidenceDigest
    && core.operationKey === requiredDigest(operationKey, "expected completion operation key")
    && core.evidenceDigest === requiredDigest(evidenceDigest, "expected completion evidence digest")
    && core.integrationReceiptDigest === requiredDigest(
      integrationReceiptDigest,
      "expected integration receipt digest",
    )
    && value.receiptDigest === digestValue(core);
  if (!exact) throw new Error("Terminal reconciliation receipt is invalid or drifted.");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeAuthorization(value, plan) {
  requireObject(value, "Reconciliation authorization receipt");
  const core = {
    schema: requiredText(value.schema, "authorization schema"),
    planDigest: requiredDigest(value.planDigest, "authorization plan digest"),
    authorization: requiredText(value.authorization, "authorization text"),
  };
  if (core.schema !== MERGED_DORMANT_CLAIM_RECONCILIATION_AUTHORIZATION_SCHEMA
    || core.planDigest !== plan.planDigest || core.authorization !== plan.exactAuthorization
    || value.authorizationDigest !== digestValue(core)) {
    throw new Error("Merged dormant reconciliation authorization receipt is invalid.");
  }
  return Object.freeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function normalizeIntentPhases(value, plan, status, authorizationDigest) {
  requireObject(value, "Intent phases");
  const result = {};
  const statusIndex = STATUSES.indexOf(status);
  for (let index = 1; index <= statusIndex; index += 1) {
    const phase = STATUSES[index];
    requireObject(value[phase], `${phase} intent phase`);
    result[phase] = Object.freeze({
      values: normalizeJsonObject(value[phase].values, `${phase} intent values`),
    });
    assertPhaseValueKeys(result[phase].values, phase);
  }
  if (Object.keys(value).some(phase => !Object.hasOwn(result, phase))) {
    throw new Error("Intent contains an out-of-order reconciliation phase.");
  }
  for (const phase of PHASES.filter(item => item !== "complete" && Object.hasOwn(result, item))) {
    const values = result[phase].values;
    if (values.operationKey !== mergedDormantClaimReconciliationOperationKey(plan, phase)
      || !DIGEST_PATTERN.test(String(values.evidenceDigest || ""))) {
      throw new Error(`Stored ${phase} reconciliation evidence drifted.`);
    }
    if (["integrated", "retired"].includes(phase)) {
      requiredDigest(values.integrationReceiptDigest, `stored ${phase} integration receipt digest`);
    }
  }
  if (result.complete) {
    const values = result.complete.values;
    const operationKey = mergedDormantClaimReconciliationOperationKey(plan, "complete");
    const evidenceDigest = requiredDigest(values.evidenceDigest, "stored completion evidence digest");
    const integrationReceiptDigest = requiredDigest(
      values.integrationReceiptDigest,
      "stored completion integration receipt digest",
    );
    if (values.operationKey !== operationKey || !values.receipt) {
      throw new Error("Stored completion phase lacks exact terminal evidence.");
    }
    const retiredPhases = Object.fromEntries(
      Object.entries(result).filter(([phase]) => phase !== "complete"),
    );
    const retiredIntentDigest = digestValue({
      schema: MERGED_DORMANT_CLAIM_RECONCILIATION_INTENT_SCHEMA,
      planDigest: plan.planDigest,
      planSnapshot: plan,
      authorizationDigest,
      status: "retired",
      phases: retiredPhases,
    });
    const receipt = normalizeMergedDormantClaimReconciliationReceipt(values.receipt, {
      plan, authorizationDigest, retiredIntentDigest, operationKey, evidenceDigest,
      integrationReceiptDigest,
    });
    result.complete = Object.freeze({ values: deepFreeze({ ...values, receipt }) });
  }
  return deepFreeze(result);
}

function sealIntent(core) {
  const frozen = deepFreeze(core);
  return deepFreeze({ ...frozen, intentDigest: digestValue(frozen) });
}

function normalizeJsonObject(value, label) {
  requireObject(value, label);
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function assertPhaseValueKeys(value, phase) {
  const expected = ["evidenceDigest", "operationKey"];
  if (["integrated", "retired", "complete"].includes(phase)) {
    expected.push("integrationReceiptDigest");
  }
  if (phase === "complete") expected.push("receipt");
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expected.sort())) {
    throw new Error(`Stored ${phase} reconciliation values have unexpected or missing fields.`);
  }
}

function normalizePhases(value) {
  if (!Array.isArray(value) || canonicalJson(value) !== canonicalJson(PHASES)) {
    throw new Error("Reconciliation plan phases are invalid.");
  }
  return PHASES;
}

function requiredPhase(value) {
  const phase = requiredText(value, "reconciliation phase");
  if (!PHASES.includes(phase)) throw new Error(`Unsupported reconciliation phase: ${phase}.`);
  return phase;
}

function requiredStatus(value) {
  const status = requiredText(value, "reconciliation status");
  if (!STATUSES.includes(status)) throw new Error(`Unsupported reconciliation status: ${status}.`);
  return status;
}

function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`${label} must use owner/repository form.`);
  }
  return repository;
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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requiredNull(value, label) {
  if (value !== null) throw new Error(`${label} must be null.`);
  return null;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
