// Responsibility: Persist the private journal and seal pair-bounded cloud retirement semantics.
import {
  canonicalJson, digestValue, normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { createClaimOnlyPartialStartRetirementStore }
  from "./claim-only-partial-start-retirement-store.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;

export function createMixedIdentityPairRetirementStore(options = {}) {
  const store = createClaimOnlyPartialStartRetirementStore({
    statePath: options.statePath,
    now: options.now,
  });
  return Object.freeze({
    statePath: store.statePath,
    withOperationLock: store.withOperationLock,
    readJournal: store.readJournal,
    writeJournal: store.writeJournal,
  });
}

export function mixedIdentityPairOperationKey(planDigest, phase) {
  return digestValue({
    schema: "agentic-claim-only-mixed-identity-pair-operation-key/v1",
    operation: "claim-only-mixed-identity-pair-retirement",
    planDigest: digest(planDigest, "plan digest"),
    phase: text(phase, "operation phase"),
  });
}

export function buildMixedIdentityPairRetirementRequest({
  plan, claim, phase, operationKey, expectedLedgerDigest,
}) {
  const normalizedPhase = effectPhase(phase);
  const affectedScope = plan.evidence.scopeComparison.union;
  return Object.freeze({
    claimId: digest(claim.claimId, "retirement claim ID"),
    expectedFenceRevision: digest(claim.claimDigest, "retirement fence"),
    expectedTransitionCounter: positive(claim.transitionCounter, "retirement transition"),
    expectedLedgerDigest: digest(expectedLedgerDigest, "fresh ledger digest"),
    reason: "abandoned",
    finalRevision: text(claim.laneRevision, "retirement final revision"),
    reviewRequestId: null,
    bytesDigest: semanticEffectDigest(plan, normalizedPhase, "bytes", affectedScope),
    namedChecksDigest: semanticEffectDigest(plan, normalizedPhase, "named-checks", affectedScope),
    handoffEvidenceDigest: semanticEffectDigest(plan, normalizedPhase, "handoff", affectedScope),
    integrationReceiptDigest: null,
    deviceId: text(claim.deviceId, "retirement device"),
    sessionId: text(claim.sessionId, "retirement session"),
    idempotencyKey: digest(operationKey, "retirement operation key"),
  });
}

export function mixedIdentityPairRetirementRequestDigest({ plan, claim, phase }) {
  const request = buildMixedIdentityPairRetirementRequest({
    plan,
    claim,
    phase,
    operationKey: digestValue("operation-key-placeholder"),
    expectedLedgerDigest: digestValue("ledger-placeholder"),
  });
  const { expectedLedgerDigest: _ledger, idempotencyKey: _operationKey, ...semantic } = request;
  return digestValue({
    action: "retire",
    intent: {
      repositoryId: claim.repositoryId,
      actorId: claim.actorId,
      ...semantic,
    },
  });
}

export function validateMixedIdentityPairRetirementTerminal({
  plan, claim, phase, operationKey, entry, result = null,
}) {
  object(entry, "terminal entry");
  const expectedRequestDigest = mixedIdentityPairRetirementRequestDigest({ plan, claim, phase });
  const expectedOperationKey = digestValue(operationKey);
  const retirement = entry.claimCore?.retirement;
  const expectedRetirement = {
    reason: "abandoned",
    finalRevision: claim.laneRevision,
    reviewRequestId: null,
    bytesDigest: semanticEffectDigest(plan, phase, "bytes", plan.evidence.scopeComparison.union),
    namedChecksDigest: semanticEffectDigest(
      plan, phase, "named-checks", plan.evidence.scopeComparison.union,
    ),
    handoffEvidenceDigest: semanticEffectDigest(
      plan, phase, "handoff", plan.evidence.scopeComparison.union,
    ),
    integrationReceiptDigest: null,
    retiredAt: entry.evaluationTime,
  };
  const preserved = {
    claimId: claim.claimId,
    actorId: claim.actorId,
    deviceId: claim.deviceId,
    sessionId: claim.sessionId,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    declaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    laneRevision: claim.laneRevision,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter + 1,
    heartbeatCounter: claim.heartbeatCounter,
    state: "retired",
    expiresAt: claim.expiresAt,
    evidenceDigest: claim.evidenceDigest,
    reviewRequestId: claim.reviewRequestId,
    predecessorClaimId: claim.predecessorClaimId,
    eligibleSince: claim.eligibleSince ?? null,
    handoff: claim.handoff ?? null,
    release: claim.release ?? null,
    ...(claim.canonicalDescendantProof == null ? {}
      : { canonicalDescendantProof: claim.canonicalDescendantProof }),
    retirement: expectedRetirement,
  };
  const actualCore = entry.claimCore;
  const entryCore = { ...entry };
  delete entryCore.digest;
  if (entry.schema !== "agentic-cloud-collaboration-entry/v2"
    || entry.action !== "retire" || entry.claimId !== claim.claimId
    || entry.repositoryId !== claim.repositoryId || entry.idempotencyKey !== expectedOperationKey
    || entry.requestDigest !== expectedRequestDigest
    || entry.claimDigest !== digestValue(actualCore)
    || entry.digest !== digestValue(entryCore)
    || canonicalJson(actualCore) !== canonicalJson(preserved)) {
    invalid("terminal retirement entry");
  }
  const operationReceipt = operationReceiptForEntry(entry);
  if (result) requireMutationResult(result, entry, operationReceipt);
  return Object.freeze({
    requestDigest: expectedRequestDigest,
    operationReceiptDigest: operationReceipt.receiptDigest,
    terminalEntryDigest: entry.digest,
    terminalClaimDigest: entry.claimDigest,
    transportReceiptDigest: result?.receipt?.receiptDigest ?? null,
  });
}

function requireMutationResult(result, entry, receipt) {
  const claim = result?.claim;
  const transport = result?.receipt;
  const transportCore = transport && { ...transport };
  if (transportCore) delete transportCore.receiptDigest;
  const scalarFields = [
    "claimId", "actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch",
    "transitionCounter", "heartbeatCounter", "reviewRequestId", "predecessorClaimId",
    "expiresAt", "eligibleSince",
  ];
  const scalarMismatch = scalarFields.some(name => claim?.[name] !== entry.claimCore?.[name]);
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "retire" || result.status !== "retired"
    || canonicalJson(result.operationReceipt) !== canonicalJson(receipt)
    || result.claimDigest !== entry.claimDigest || claim?.state !== "retired"
    || claim?.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim?.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim?.writeAuthority !== false || claim?.scopeReserved !== false
    || claim?.fenceRevision !== entry.claimDigest || claim?.transitionDigest !== entry.digest
    || claim?.operationReceiptDigest !== receipt.receiptDigest
    || claim?.integrationReceiptDigest !== null || scalarMismatch
    || canonicalJson(normalizeWriteSet(claim?.declaredWriteScope))
      !== canonicalJson(entry.claimCore.declaredWriteScope)
    || canonicalJson(claim?.handoff ?? null) !== canonicalJson(entry.claimCore.handoff ?? null)
    || canonicalJson(claim?.release ?? null) !== canonicalJson(entry.claimCore.release ?? null)
    || canonicalJson(claim?.recovery ?? null) !== canonicalJson(entry.claimCore.recovery ?? null)
    || canonicalJson(claim?.integration ?? null)
      !== canonicalJson(entry.claimCore.integration ?? null)
    || canonicalJson(claim?.canonicalDescendantProof ?? null)
      !== canonicalJson(entry.claimCore.canonicalDescendantProof ?? null)
    || canonicalJson(claim?.retirement) !== canonicalJson(entry.claimCore.retirement)
    || transport?.schema !== "agentic-cloud-collaboration-github-receipt/v1"
    || transport?.action !== "retire" || transport?.claimId !== entry.claimId
    || transport?.claimDigest !== entry.claimDigest
    || transport?.contractReceiptDigest !== receipt.receiptDigest
    || transport?.receiptDigest !== digestValue(transportCore)) {
    invalid("terminal cloud mutation result");
  }
}

export function operationReceiptForEntry(entry) {
  const core = {
    schema: "agentic-collaboration-retirement-receipt/v1",
    operation: "retire",
    status: "retired",
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function effectValuesDigest(values) {
  const projected = { ...values };
  delete projected.phase;
  delete projected.receiptDigest;
  return digestValue(projected);
}

function semanticEffectDigest(plan, phase, kind, affectedScope) {
  return digestValue({
    schema: "agentic-claim-only-mixed-identity-pair-effect-evidence/v1",
    planDigest: plan.planDigest,
    phase: effectPhase(phase),
    kind,
    sourceClaimId: plan.sourceClaimId,
    waitingSuccessorClaimId: plan.waitingSuccessorClaimId,
    sourceScope: plan.evidence.source.declaredWriteScope,
    waitingSuccessorScope: plan.evidence.waitingSuccessor.declaredWriteScope,
    affectedScope,
  });
}

function effectPhase(value) {
  if (!["waiting-successor-retired", "source-retired"].includes(value)) {
    invalid("effect phase");
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Mixed-identity pair ${label} is invalid.`);
}
