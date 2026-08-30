// Responsibility: classify the exact promoted or response-ahead bound C3 ledger suffix.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  validateLedger,
} from "./cloud-collaboration-primitives.mjs";
import {
  normalizeSuccessorRolloverJournal,
  normalizeSuccessorRolloverReplacementPlan,
  successorRolloverOperationKey,
} from "./active-dirty-scope-expansion-successor-rollover-contract.mjs";
import { claimOnlyOperationReceiptForEntry }
  from "./claim-only-partial-start-retirement-store.mjs";

export const SUCCESSOR_ROLLOVER_PROMOTED_UNBOUND = "promoted-unbound";
export const SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD = "bound-response-ahead";
const CLAIM_FRAME_SCHEMA =
  "agentic-active-dirty-scope-expansion-successor-rollover-claim-frame/v1";
const BOUND_FRAME_SCHEMA =
  "agentic-active-dirty-scope-expansion-successor-rollover-bound-frame/v1";
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function classifySuccessorRolloverBindEvidence({
  plan: planValue,
  journal: journalValue,
  ledger,
  candidate,
} = {}) {
  const plan = normalizeSuccessorRolloverReplacementPlan(planValue);
  const journal = normalizeSuccessorRolloverJournal(journalValue);
  if (validateLedger(ledger).length > 0) invalid("cloud ledger");
  const promoted = requirePromotedJournal(journal, plan);
  const entries = Array.isArray(ledger?.entries)
    ? ledger.entries.filter(entry => entry.claimId === candidate?.claimId)
    : [];
  if (![1, 2].includes(entries.length)) invalid("replacement claim ledger cardinality");
  const genesis = entries[0];
  const genesisReceipt = requireGenesis({ plan, journal, promoted, genesis });
  const promotedClaim = claimFrame(promoted.claim, null, genesisReceipt.receiptDigest);
  if (candidate?.reviewRequestId === null) {
    if (entries.length !== 1) invalid("unbound replacement ledger suffix");
    requireCandidate({ candidate, entry: genesis, plan, reviewRequestId: null,
      receipt: genesisReceipt });
    return deepFreeze({
      disposition: SUCCESSOR_ROLLOVER_PROMOTED_UNBOUND,
      promotedClaim,
      boundReplacement: null,
    });
  }
  if (candidate?.reviewRequestId !== plan.sourceReviewRequestId || entries.length !== 2) {
    invalid("bound replacement ledger suffix");
  }
  const boundEntry = entries[1];
  const boundReceipt = requireBoundEntry({
    plan,
    genesis,
    boundEntry,
    candidate,
  });
  return deepFreeze({
    disposition: SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD,
    promotedClaim,
    boundReplacement: {
      schema: BOUND_FRAME_SCHEMA,
      claim: claimFrameFromCandidate(candidate),
      receipt: boundReceipt,
    },
  });
}

export function assertSuccessorRolloverBindMutationAllowed(disposition) {
  if (disposition === SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD) {
    throw new Error("Successor-rollover bound response ahead forbids another bind mutation.");
  }
  if (disposition !== SUCCESSOR_ROLLOVER_PROMOTED_UNBOUND) {
    invalid("bind disposition");
  }
  return disposition;
}

export function requireSuccessorRolloverSealedBindEvidence({
  plan,
  journal,
  ledger,
  candidate,
  expectedBoundReplacement,
} = {}) {
  const evidence = classifySuccessorRolloverBindEvidence({
    plan, journal, ledger, candidate,
  });
  if (evidence.disposition !== SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD
    || canonicalJson(evidence.boundReplacement)
      !== canonicalJson(expectedBoundReplacement)) {
    invalid("sealed bound replacement");
  }
  return evidence;
}

export function projectSuccessorRolloverTerminalVerifiedLease({
  lease,
  verifiedAuthority,
} = {}) {
  const claimLocal = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid("terminal claim-local authority");
    }
    const { ledgerRevision: _revision, ledgerDigest: _digest, ...subject } = value;
    return subject;
  };
  if (canonicalJson(claimLocal(lease?.cloudAuthority))
    !== canonicalJson(claimLocal(verifiedAuthority))) {
    invalid("terminal claim-local authority");
  }
  return Object.freeze({ ...lease, cloudAuthority: verifiedAuthority });
}

export function assertSuccessorRolloverTerminalControllerIdentity({
  continuationPlan,
  currentControllerDigest,
  originalControllerDigest,
} = {}) {
  const expected = continuationPlan
    ? continuationPlan.repairedControllerDigest
    : originalControllerDigest;
  if (!DIGEST_PATTERN.test(String(expected || ""))
    || currentControllerDigest !== expected) invalid("terminal controller identity");
  return currentControllerDigest;
}

function requirePromotedJournal(journal, plan) {
  const replacement = journal.replacement;
  const claimed = replacement?.phases?.["replacement-claimed"]?.values;
  const promoted = replacement?.phases?.["replacement-promoted"]?.values;
  if (replacement?.status !== "replacement-promoted"
    || replacement.planDigest !== plan.planDigest
    || !claimed?.claim || !promoted?.claim || promoted.promoted !== false
    || canonicalJson(claimed.claim) !== canonicalJson(promoted.claim)
    || claimed.receiptDigest !== promoted.receiptDigest) {
    invalid("journaled promoted replacement");
  }
  return promoted;
}

function requireGenesis({ plan, journal, promoted, genesis }) {
  const core = genesis?.claimCore;
  const receipt = genesis ? claimOnlyOperationReceiptForEntry(genesis, "current") : null;
  const identity = plan.sourceClaimIdentity;
  const identityCore = {
    repositoryId: genesis?.repositoryId,
    actorId: core?.actorId,
    deviceId: core?.deviceId,
    sessionId: core?.sessionId,
    workItemId: core?.workItemId,
  };
  const intent = {
    repositoryId: genesis?.repositoryId,
    actorId: core?.actorId,
    deviceId: core?.deviceId,
    sessionId: core?.sessionId,
    workItemId: core?.workItemId,
    canonicalBaseRevision: plan.targetCanonicalBaseSha,
    declaredWriteScope: normalizeWriteSet(plan.target.declaredWriteSet),
    writeSetDigest: plan.target.writeSetDigest,
    laneRevision: plan.sourceFenceSha,
    leaseEpoch: plan.targetCloudLeaseEpoch,
    predecessorClaimId: null,
    canonicalDescendantProof: null,
    expiresAt: core?.expiresAt,
    claimId: genesis?.claimId,
  };
  if (genesis?.schema !== ENTRY_SCHEMA || genesis.action !== "claim"
    || !sealedEntry(genesis) || core?.state !== "current"
    || core.transitionCounter !== 1 || core.reviewRequestId !== null
    || !sameStaticCore(core, plan) || canonicalJson(identityCore)
      !== canonicalJson(stripIdentityDigest(identity))
    || identity.identityDigest !== digestValue(identityCore)
    || genesis.idempotencyKey !== digestValue(successorRolloverOperationKey(
      plan, "replacement-claimed"))
    || genesis.requestDigest !== digestValue({ action: "claim", intent })
    || !storedClaimMatchesEntry(promoted.claim, genesis)
    || promoted.receiptDigest !== receipt?.receiptDigest
    || journal.replacement.phases["replacement-claimed"].values.receiptDigest
      !== receipt.receiptDigest) {
    invalid("replacement genesis join");
  }
  return receipt;
}

function requireBoundEntry({ plan, genesis, boundEntry, candidate }) {
  const core = boundEntry?.claimCore;
  const intent = {
    repositoryId: genesis.repositoryId,
    actorId: genesis.claimCore.actorId,
    deviceId: genesis.claimCore.deviceId,
    sessionId: genesis.claimCore.sessionId,
    claimId: genesis.claimId,
    expectedFenceRevision: genesis.claimDigest,
    expectedTransitionCounter: genesis.claimCore.transitionCounter,
    mode: "projection",
    laneRevision: plan.sourceFenceSha,
    reviewRequestId: plan.sourceReviewRequestId,
    expiresAt: null,
    focusedEvidenceDigest: null,
    handoffEvidenceDigest: null,
    recoveryEvidenceDigest: null,
  };
  const receipt = boundEntry
    ? claimOnlyOperationReceiptForEntry(boundEntry, "current") : null;
  if (boundEntry?.schema !== ENTRY_SCHEMA || boundEntry.action !== "continue"
    || !sealedEntry(boundEntry) || boundEntry.repositoryId !== genesis.repositoryId
    || boundEntry.claimId !== genesis.claimId || core?.state !== "current"
    || core.transitionCounter !== genesis.claimCore.transitionCounter + 1
    || core.reviewRequestId !== plan.sourceReviewRequestId
    || !sameBoundCore(genesis.claimCore, core)
    || boundEntry.idempotencyKey !== digestValue(successorRolloverOperationKey(
      plan, "replacement-bound"))
    || boundEntry.requestDigest !== digestValue({ action: "continue", intent })) {
    invalid("replacement bind operation");
  }
  requireCandidate({ candidate, entry: boundEntry, plan,
    reviewRequestId: plan.sourceReviewRequestId, receipt });
  return receipt;
}

function requireCandidate({ candidate, entry, plan, reviewRequestId, receipt }) {
  const core = entry.claimCore;
  if (candidate?.claimId !== entry.claimId
    || candidate.entrySchema !== ENTRY_SCHEMA
    || candidate.claimIdentitySchema !== ENTRY_SCHEMA
    || candidate.state !== "current" || candidate.writeAuthority !== true
    || candidate.scopeReserved !== true
    || candidate.repositoryId !== entry.repositoryId
    || candidate.actorId !== core.actorId || candidate.deviceId !== core.deviceId
    || candidate.sessionId !== core.sessionId || candidate.workItemId !== core.workItemId
    || candidate.canonicalBaseRevision !== plan.targetCanonicalBaseSha
    || candidate.laneRevision !== plan.sourceFenceSha
    || canonicalJson(normalizeWriteSet(candidate.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(plan.target.declaredWriteSet))
    || candidate.writeSetDigest !== plan.target.writeSetDigest
    || candidate.leaseEpoch !== plan.targetCloudLeaseEpoch
    || candidate.transitionCounter !== core.transitionCounter
    || candidate.heartbeatCounter !== core.heartbeatCounter
    || candidate.reviewRequestId !== reviewRequestId
    || (candidate.predecessorClaimId ?? null) !== null
    || candidate.expiresAt !== core.expiresAt
    || candidate.fenceRevision !== entry.claimDigest
    || candidate.transitionDigest !== entry.digest
    || candidate.operationReceiptDigest !== receipt.receiptDigest) {
    invalid("replacement candidate projection");
  }
}

function sameStaticCore(core, plan) {
  return core?.canonicalBaseRevision === plan.targetCanonicalBaseSha
    && core.laneRevision === plan.sourceFenceSha
    && canonicalJson(normalizeWriteSet(core.declaredWriteScope))
      === canonicalJson(normalizeWriteSet(plan.target.declaredWriteSet))
    && core.writeSetDigest === plan.target.writeSetDigest
    && core.leaseEpoch === plan.targetCloudLeaseEpoch
    && (core.predecessorClaimId ?? null) === null
    && core.heartbeatCounter === 0;
}

function sameBoundCore(prior, current) {
  const stable = ["claimId", "actorId", "deviceId", "sessionId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "declaredWriteScope", "writeSetDigest",
    "laneRevision", "leaseEpoch", "heartbeatCounter", "expiresAt", "evidenceDigest",
    "predecessorClaimId", "eligibleSince", "handoff", "release",
    "handoffEvidenceDigest", "promotedAt", "recovery", "integration", "retirement",
    "canonicalDescendantProof"];
  return stable.every(key => canonicalJson(prior?.[key] ?? null)
    === canonicalJson(current?.[key] ?? null));
}

function storedClaimMatchesEntry(stored, entry) {
  const core = entry.claimCore;
  return stored?.claimId === entry.claimId && stored.claimDigest === entry.claimDigest
    && stored.claimLedgerRevision === entry.digest
    && stored.transitionCounter === core.transitionCounter
    && stored.state === core.state
    && (stored.predecessorClaimId ?? null) === (core.predecessorClaimId ?? null)
    && stored.canonicalBaseSha === core.canonicalBaseRevision
    && stored.laneRevision === core.laneRevision
    && stored.writeSetDigest === core.writeSetDigest
    && stored.leaseEpoch === core.leaseEpoch && stored.expiresAt === core.expiresAt;
}

function claimFrame(stored, reviewRequestId, operationReceiptDigest) {
  return deepFreeze({
    schema: CLAIM_FRAME_SCHEMA,
    claimId: stored.claimId,
    claimDigest: stored.claimDigest,
    claimLedgerRevision: stored.claimLedgerRevision,
    transitionCounter: stored.transitionCounter,
    state: stored.state,
    predecessorClaimId: stored.predecessorClaimId ?? null,
    canonicalBaseSha: stored.canonicalBaseSha,
    laneRevision: stored.laneRevision,
    writeSetDigest: stored.writeSetDigest,
    leaseEpoch: stored.leaseEpoch,
    reviewRequestId,
    expiresAt: stored.expiresAt,
    operationReceiptDigest,
  });
}

function claimFrameFromCandidate(candidate) {
  return claimFrame({
    claimId: candidate.claimId,
    claimDigest: candidate.fenceRevision,
    claimLedgerRevision: candidate.transitionDigest,
    transitionCounter: candidate.transitionCounter,
    state: candidate.state,
    predecessorClaimId: candidate.predecessorClaimId ?? null,
    canonicalBaseSha: candidate.canonicalBaseRevision,
    laneRevision: candidate.laneRevision,
    writeSetDigest: candidate.writeSetDigest,
    leaseEpoch: candidate.leaseEpoch,
    expiresAt: candidate.expiresAt,
  }, candidate.reviewRequestId, candidate.operationReceiptDigest);
}

function sealedEntry(entry) {
  const draft = { ...entry };
  delete draft.digest;
  return entry.claimDigest === digestValue(entry.claimCore)
    && entry.digest === digestValue(draft);
}

function stripIdentityDigest(value) {
  const { identityDigest: _digest, ...core } = value || {};
  return core;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function invalid(label) {
  throw new Error(`Successor-rollover bind evidence has invalid ${label}.`);
}
