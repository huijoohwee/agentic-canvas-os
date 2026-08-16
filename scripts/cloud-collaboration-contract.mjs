import { CLOUD_COLLABORATION_BOUNDS, ENTRY_SCHEMA, LEGACY_ENTRY_SCHEMA, LEDGER_SCHEMA,
  MUTATING_ACTIONS, RECEIPT_SCHEMA, FINDING_TYPES, canonicalJson, collaborationFinding,
  createEmptyLedger, digest, digestValue, fail, instant, normalizeActor, normalizeRepository,
  normalizeRootIntent, normalizeWriteSet, text, validateLedger, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
export { CLOUD_COLLABORATION_BOUNDS, CloudCollaborationError, ENTRY_SCHEMA, LEGACY_ENTRY_SCHEMA,
  LEDGER_SCHEMA, RECEIPT_SCHEMA, canonicalJson, createEmptyLedger, digestValue,
  normalizeWriteSet, validateLedger, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
const TERMINAL_STATES = new Set(["retired", "released", "revoked"]);
const WRITE_AUTHORITY_STATES = new Set(["current"]);
const SCOPE_RESERVATION_STATES = new Set([
  ...WRITE_AUTHORITY_STATES,
  "reviewed",
  "integrated-preserved",
  "dormant-preserved",
]);
const OPERATION_RECEIPT_SCHEMAS = Object.freeze({
  claim: "agentic-collaboration-claim-receipt/v1",
  continue: "agentic-collaboration-continuation-receipt/v1",
  integrate: "agentic-collaboration-integration-receipt/v1",
  retire: "agentic-collaboration-retirement-receipt/v1",
});
function hydrate(entry, evaluationTime = null) {
  if (!entry) return null;
  const claim = {
    ...entry.claimCore,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    entrySchema: entry.schema,
  };
  claim.state = projectAuthorityState(claim.state);
  claim.recordedState = claim.state;
  if (evaluationTime && SCOPE_RESERVATION_STATES.has(claim.state)
    && Date.parse(evaluationTime) >= Date.parse(claim.expiresAt)) claim.state = "dormant-preserved";
  claim.writeAuthority = WRITE_AUTHORITY_STATES.has(claim.state);
  claim.scopeReserved = SCOPE_RESERVATION_STATES.has(claim.state);
  claim.ledgerSequence = entry.sequence;
  claim.operationReceiptDigest = receiptForEntry(entry, claim.recordedState).receiptDigest;
  return claim;
}
function projectAuthorityState(state) {
  if (state === "active") return "current";
  if (["review-ready", "delivery-authorized"].includes(state)) return "reviewed";
  if (state === "parked" || state === "expired") return "dormant-preserved";
  if (state === "released") return "retired";
  return state;
}
function currentClaimEntries(ledger) {
  const latest = new Map();
  for (const entry of ledger.entries) latest.set(entry.claimId, entry);
  return latest;
}
function currentClaims(ledger, evaluationTime) {
  const latest = currentClaimEntries(ledger);
  const legacyLineages = new Set(ledger.entries
    .filter((entry) => entry.schema === LEGACY_ENTRY_SCHEMA && entry.action === "claim")
    .map((entry) => entry.claimId));
  const legacyConsumed = new Set([...latest.values()]
    .filter((entry) => legacyLineages.has(entry.claimId))
    .map((entry) => entry.claimCore.predecessorClaimId)
    .filter(Boolean));
  return [...latest.values()]
    .filter((entry) => !legacyConsumed.has(entry.claimId))
    .map((entry) => hydrateWithLedger(ledger, entry, evaluationTime));
}
export function listCurrentClaims(ledger, evaluationTime, { repositoryId = null } = {}) {
  const failures = validateLedger(ledger);
  if (failures.length > 0) fail("invalid_ledger", failures.join("; "));
  const evaluatedAt = instant(evaluationTime, "evaluationTime");
  const targetRepositoryId = text(repositoryId, "repositoryId", { optional: true });
  return currentClaims(ledger, evaluatedAt)
    .filter((claim) => !TERMINAL_STATES.has(claim.state))
    .filter((claim) => !targetRepositoryId || claim.repositoryId === targetRepositoryId)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
}
function findClaimEntry(ledger, claimId) {
  return currentClaimEntries(ledger).get(claimId) ?? null;
}
function buildReceipt(entry) {
  return receiptForEntry(entry, projectAuthorityState(entry.claimCore.state));
}
function hydrateWithLedger(ledger, entry, evaluationTime) {
  const claim = hydrate(entry, evaluationTime);
  if (!claim) return null;
  const identityEntry = ledger.entries.find((candidate) => (
    candidate.claimId === claim.claimId && candidate.action === "claim"
  ));
  if (!identityEntry) fail("invalid_ledger", "claim identity origin is missing");
  claim.claimIdentitySchema = identityEntry.schema;
  const integrationEntry = claim?.integration && ledger.entries.findLast((candidate) => (
    candidate.schema === ENTRY_SCHEMA && candidate.claimId === claim.claimId && candidate.action === "integrate"
  ));
  claim.integrationReceiptDigest = integrationEntry ? buildReceipt(integrationEntry).receiptDigest : null;
  return claim;
}
function receiptForEntry(entry, status) {
  if (entry.schema === LEGACY_ENTRY_SCHEMA) {
    const receipt = {
      schema: RECEIPT_SCHEMA,
      action: entry.action,
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
    return { ...receipt, receiptDigest: digestValue(receipt) };
  }
  const receipt = {
    schema: OPERATION_RECEIPT_SCHEMAS[entry.action],
    operation: entry.action,
    status,
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
  return { ...receipt, receiptDigest: digestValue(receipt) };
}
function mutationResult(ledger, entry, replayed) {
  return {
    ledger,
    claim: hydrateWithLedger(ledger, entry, entry.evaluationTime),
    claimDigest: entry.claimDigest,
    receipt: buildReceipt(entry),
    replayed,
  };
}
function requireOwnedClaim(ledger, intent, evaluationTime) {
  const entry = findClaimEntry(ledger, intent.claimId);
  if (!entry) fail("claim_not_found", `claim ${intent.claimId} does not exist`);
  const claim = hydrate(entry, evaluationTime);
  if (TERMINAL_STATES.has(claim.state)) fail("claim_not_active", `claim is ${claim.state}`);
  const leaseIndependent = (
    claim.state === "dormant-preserved"
    && (intent.mode === "recovery" || intent.reason)
  ) || (
    claim.state === "waiting-successor"
    && Boolean(intent.reason)
  );
  if (claim.actorId !== intent.actorId || (!leaseIndependent && (
    claim.deviceId !== intent.deviceId || claim.sessionId !== intent.sessionId
  ))) fail("claim_owner_mismatch", "authenticated claim authority does not match");
  if (claim.fenceRevision !== intent.expectedFenceRevision) {
    fail("stale_collaboration_fence", "expectedFenceRevision is stale");
  }
  if (claim.transitionCounter !== intent.expectedTransitionCounter) {
    fail("stale_transition_counter", "expectedTransitionCounter is stale");
  }
  if (intent.expectedLedgerDigest && intent.expectedLedgerDigest !== ledger.headDigest) {
    fail("stale_ledger_digest", "expectedLedgerDigest is stale");
  }
  return claim;
}
function claimCoreForAction(action, intent, ledger, evaluationTime) {
  if (action === "claim") return buildClaimCore(intent, ledger, evaluationTime);
  const previous = requireOwnedClaim(ledger, intent, evaluationTime);
  const base = { ...previous };
  for (const field of [
    "writeAuthority", "scopeReserved", "fenceRevision", "ledgerRevision",
    "ledgerSequence", "entrySchema", "recordedState", "operationReceiptDigest",
    "deliveryAuthorization",
  ]) delete base[field];
  base.eligibleSince ??= null;
  base.handoff = null;
  base.release = null;
  base.transitionCounter += 1;
  if (action === "continue") return continueClaim({ base, previous, intent, ledger, evaluationTime });
  if (action === "integrate") return integrateClaim({ base, previous, intent, evaluationTime });
  return retireClaim({ base, previous, intent, ledger, evaluationTime });
}
function continueClaim({ base, previous, intent, ledger, evaluationTime }) {
  if (intent.mode === "projection") {
    if (previous.state !== "current") fail("invalid_transition", "projection continuation requires current authority");
    if (!intent.laneRevision) fail("invalid_request", "projection continuation requires laneRevision");
    return { ...base, state: "current", laneRevision: intent.laneRevision, reviewRequestId: intent.reviewRequestId };
  }
  if (intent.mode === "renewal") {
    if (!SCOPE_RESERVATION_STATES.has(previous.state) || previous.state === "dormant-preserved") {
      fail("invalid_transition", "renewal requires non-dormant current authority");
    }
    if (!intent.expiresAt || Date.parse(intent.expiresAt) <= Date.parse(previous.expiresAt)) {
      fail("invalid_transition", "renewal must extend expiresAt");
    }
    return { ...base, expiresAt: intent.expiresAt, heartbeatCounter: previous.heartbeatCounter + 1 };
  }
  if (intent.mode === "review") {
    if (!["current", "reviewed"].includes(previous.state)) fail("invalid_transition", "review continuation requires current authority");
    if (intent.laneRevision !== previous.laneRevision || !intent.reviewRequestId || !intent.focusedEvidenceDigest) {
      fail("stale_review_identity", "review continuation must bind the unchanged revision and exact review evidence");
    }
    if ((previous.reviewRequestId && intent.reviewRequestId !== previous.reviewRequestId)
      || (previous.evidenceDigest && intent.focusedEvidenceDigest !== previous.evidenceDigest)) {
      fail("stale_review_identity", "review identity and evidence are immutable once recorded");
    }
    return { ...base, state: "reviewed", reviewRequestId: intent.reviewRequestId, evidenceDigest: intent.focusedEvidenceDigest };
  }
  if (intent.mode === "preserve") {
    if (!WRITE_AUTHORITY_STATES.has(previous.state) || !intent.handoffEvidenceDigest) {
      fail("invalid_transition", "preservation continuation requires current authority and handoff evidence");
    }
    return { ...base, state: "dormant-preserved", handoffEvidenceDigest: intent.handoffEvidenceDigest };
  }
  if (intent.mode === "recovery") {
    if (previous.state !== "dormant-preserved" || !intent.recoveryEvidenceDigest || !intent.expiresAt) {
      fail("invalid_transition", "recovery requires dormant-preserved authority and recovery evidence");
    }
    if (Date.parse(intent.expiresAt) <= Date.parse(evaluationTime)) fail("invalid_expiry", "recovery expiry must be future");
    const reservedOverlap = currentClaims(ledger, evaluationTime).find((claim) => (
      claim.claimId !== previous.claimId
      && claim.repositoryId === previous.repositoryId
      && claim.scopeReserved
      && writeSetsOverlap(claim.declaredWriteScope, previous.declaredWriteScope)
    ));
    if (reservedOverlap) fail("overlap_still_reserved", "dormant recovery cannot compete with an overlapping reservation");
    return {
      ...base,
      state: ["reviewed", "integrated-preserved"].includes(previous.recordedState)
        ? previous.recordedState
        : "current",
      deviceId: intent.deviceId,
      sessionId: intent.sessionId,
      expiresAt: intent.expiresAt,
      recovery: { evidenceDigest: intent.recoveryEvidenceDigest, recoveredAt: evaluationTime },
    };
  }
  if (previous.state !== "waiting-successor" || !intent.expiresAt) {
    fail("invalid_transition", "promotion requires a waiting successor and future expiry");
  }
  if (Date.parse(intent.expiresAt) <= Date.parse(evaluationTime)) {
    fail("invalid_expiry", "promotion expiry must be future");
  }
  const predecessor = hydrate(findClaimEntry(ledger, previous.predecessorClaimId), evaluationTime);
  if (!predecessor || predecessor.state !== "retired") fail("predecessor_not_retired", "waiting successor cannot write before predecessor retirement");
  const claims = currentClaims(ledger, evaluationTime);
  const reservedOverlap = claims.find((claim) => (
    claim.claimId !== previous.claimId
    && claim.repositoryId === previous.repositoryId
    && claim.scopeReserved
    && writeSetsOverlap(claim.declaredWriteScope, previous.declaredWriteScope)
  ));
  if (reservedOverlap) fail("overlap_still_reserved", "waiting successor cannot promote while an overlapping scope remains reserved");
  const eligible = claims
    .filter((claim) => (
      claim.state === "waiting-successor"
      && claim.repositoryId === previous.repositoryId
      && writeSetsOverlap(claim.declaredWriteScope, previous.declaredWriteScope)
    ))
    .sort(compareWaitingSuccessors);
  if (eligible[0]?.claimId !== previous.claimId) {
    fail("successor_not_selected", "another waiting successor has deterministic promotion priority");
  }
  return { ...base, state: "current", expiresAt: intent.expiresAt, promotedAt: evaluationTime };
}
function compareWaitingSuccessors(left, right) {
  return left.eligibleSince.localeCompare(right.eligibleSince)
    || left.ledgerSequence - right.ledgerSequence
    || left.claimId.localeCompare(right.claimId);
}
function integrateClaim({ base, previous, intent, evaluationTime }) {
  if (previous.state !== "reviewed") fail("invalid_transition", "integrate requires reviewed current authority");
  if (intent.candidateRevision !== previous.laneRevision
    || intent.reviewRequestId !== previous.reviewRequestId
    || intent.focusedEvidenceDigest !== previous.evidenceDigest) {
    fail("candidate_identity_mismatch", "integrate must consume the immutable reviewed candidate");
  }
  return {
    ...base,
    state: "integrated-preserved",
    integration: {
      candidateRevision: intent.candidateRevision,
      reviewRequestId: intent.reviewRequestId,
      focusedEvidenceDigest: intent.focusedEvidenceDigest,
      dependencyClosureDigest: intent.dependencyClosureDigest,
      namedChecksDigest: intent.namedChecksDigest,
      handoffEvidenceDigest: intent.handoffEvidenceDigest,
      operatorDecisionDigest: intent.operatorDecisionDigest,
      integrationIntentDigest: intent.integrationIntentDigest,
      integratedAt: evaluationTime,
    },
  };
}
function retireClaim({ base, previous, intent, ledger, evaluationTime }) {
  if (intent.finalRevision !== previous.laneRevision
    || intent.reviewRequestId !== previous.reviewRequestId) {
    fail("retirement_identity_mismatch", "retire must preserve the exact revision and review identity");
  }
  const integrated = previous.recordedState === "integrated-preserved";
  if (integrated !== (intent.reason === "integrated")) {
    fail("invalid_transition", "integrated-preserved authority requires an integrated retirement");
  }
  if (integrated) {
    const integrationEntry = ledger.entries.findLast((entry) => (
      entry.schema === ENTRY_SCHEMA && entry.claimId === previous.claimId && entry.action === "integrate"
    ));
    if (!integrationEntry) fail("integration_receipt_mismatch", "integration entry is missing");
    const expectedReceiptDigest = buildReceipt(integrationEntry).receiptDigest;
    if (intent.integrationReceiptDigest !== expectedReceiptDigest) {
      fail("integration_receipt_mismatch", "retirement must join the exact integration receipt");
    }
  }
  return {
    ...base,
    state: "retired",
    retirement: {
      reason: intent.reason,
      finalRevision: intent.finalRevision,
      reviewRequestId: intent.reviewRequestId,
      bytesDigest: intent.bytesDigest,
      namedChecksDigest: intent.namedChecksDigest,
      handoffEvidenceDigest: intent.handoffEvidenceDigest,
      integrationReceiptDigest: intent.integrationReceiptDigest,
      retiredAt: evaluationTime,
    },
  };
}
function buildClaimCore(intent, ledger, evaluationTime) {
  if (Date.parse(intent.expiresAt) <= Date.parse(evaluationTime)) {
    fail("invalid_expiry", "expiresAt must be later than evaluationTime");
  }
  const latest = currentClaimEntries(ledger);
  const matchingEpochs = [...latest.values()]
    .map((entry) => entry.claimCore)
    .filter((claim) => (
      claim.repositoryId === intent.repositoryId
      && claim.workItemId === intent.workItemId
      && claim.writeSetDigest === intent.writeSetDigest
    ))
    .map((claim) => claim.leaseEpoch);
  const expectedEpoch = (matchingEpochs.length === 0 ? 0 : Math.max(...matchingEpochs)) + 1;
  if (intent.leaseEpoch !== expectedEpoch) {
    fail("stale_lease_epoch", `leaseEpoch must be ${expectedEpoch}`);
  }
  const overlapping = [], queued = [];
  for (const current of currentClaims(ledger, evaluationTime)) {
    if (
      current.repositoryId !== intent.repositoryId
      || !writeSetsOverlap(current.declaredWriteScope, intent.declaredWriteScope)
    ) continue;
    if (current.scopeReserved) overlapping.push(current);
    else if (current.state === "waiting-successor") queued.push(current);
  }
  overlapping.sort((left, right) => left.claimId.localeCompare(right.claimId));
  queued.sort(compareWaitingSuccessors);
  const predecessorClaimId = overlapping[0]?.claimId ?? queued[0]?.claimId ?? intent.predecessorClaimId;
  if (intent.predecessorClaimId && predecessorClaimId !== intent.predecessorClaimId) {
    fail("predecessor_identity_mismatch", "named predecessor is not the current overlapping authority");
  }
  if (intent.predecessorClaimId && overlapping.length + queued.length === 0
    && !allowsPredecessorBaseContinuation({ ledger, intent, evaluationTime })) {
    fail("predecessor_identity_mismatch", "named predecessor is not a preserved matching authority");
  }
  return {
    claimId: intent.claimId,
    actorId: intent.actorId,
    deviceId: intent.deviceId,
    sessionId: intent.sessionId,
    repositoryId: intent.repositoryId,
    workItemId: intent.workItemId,
    canonicalBaseRevision: intent.canonicalBaseRevision,
    declaredWriteScope: intent.declaredWriteScope,
    writeSetDigest: intent.writeSetDigest,
    laneRevision: intent.laneRevision,
    leaseEpoch: intent.leaseEpoch,
    transitionCounter: 1,
    heartbeatCounter: 0,
    state: overlapping.length + queued.length === 0 ? "current" : "waiting-successor",
    expiresAt: intent.expiresAt,
    evidenceDigest: null,
    reviewRequestId: null,
    predecessorClaimId: predecessorClaimId ?? null,
    eligibleSince: overlapping.length + queued.length === 0 ? null : evaluationTime,
    handoff: null,
    release: null,
  };
}
function allowsPredecessorBaseContinuation({ ledger, intent, evaluationTime }) {
  if (!intent.predecessorClaimId) return false;
  const predecessor = hydrate(findClaimEntry(ledger, intent.predecessorClaimId), evaluationTime);
  return Boolean(
    predecessor
    && ["dormant-preserved", "retired"].includes(predecessor.state)
    && predecessor.repositoryId === intent.repositoryId
    && predecessor.workItemId === intent.workItemId
    && predecessor.writeSetDigest === intent.writeSetDigest
    && predecessor.laneRevision === intent.laneRevision
    && predecessor.canonicalBaseRevision === intent.canonicalBaseRevision,
  );
}
function appendEntry(ledger, action, intent, requestDigest, idempotencyKey, evaluationTime) {
  const claimCore = claimCoreForAction(action, intent, ledger, evaluationTime);
  const claimDigest = digestValue(claimCore);
  const draft = {
    schema: ENTRY_SCHEMA,
    sequence: ledger.sequence + 1,
    parentDigest: ledger.headDigest,
    action,
    repositoryId: claimCore.repositoryId,
    claimId: claimCore.claimId,
    idempotencyKey,
    requestDigest,
    evaluationTime,
    claimCore,
    claimDigest,
  };
  const entry = { ...draft, digest: digestValue(draft) };
  return {
    ledger: {
      ...ledger,
      sequence: entry.sequence,
      headDigest: entry.digest,
      entries: [...ledger.entries, entry],
    },
    entry,
  };
}
function statusReceipt(ledger, claim, evaluationTime) {
  const draft = {
    schema: RECEIPT_SCHEMA,
    action: "status",
    ledgerRepositoryId: ledger.ledgerRepositoryId,
    repositoryId: claim?.repositoryId ?? null,
    claimId: claim?.claimId ?? null,
    claimDigest: claim?.fenceRevision ?? null,
    fenceRevision: claim?.fenceRevision ?? null,
    ledgerRevision: ledger.headDigest,
    ledgerSequence: ledger.sequence,
    evaluationTime,
  };
  return { ...draft, receiptDigest: digestValue(draft) };
}
export function applyCloudTransition({ ledger, action, request = {}, actor, repository, evaluationTime }) {
  const ledgerFailures = validateLedger(ledger);
  if (ledgerFailures.length > 0) fail("invalid_ledger", ledgerFailures.join("; "));
  const normalizedAction = text(action, "action");
  const evaluatedAt = instant(evaluationTime, "evaluationTime");
  if (normalizedAction === "status") {
    const claimId = digest(request.claimId, "claimId", { optional: true });
    const claim = hydrateWithLedger(ledger, findClaimEntry(ledger, claimId), evaluatedAt);
    const repositoryId = repository ? normalizeRepository(repository).repositoryId : request.repositoryId ?? null;
    const claims = claimId ? (claim ? [claim] : []) : listCurrentClaims(ledger, evaluatedAt, { repositoryId });
    return {
      ledger,
      claim,
      claims,
      claimDigest: claim?.fenceRevision ?? null,
      receipt: statusReceipt(ledger, claim, evaluatedAt),
      replayed: false,
    };
  }
  if (normalizedAction === "verify") {
    const receipt = verifyCloudClaim({ ledger, request, evaluationTime: evaluatedAt });
    return {
      ledger,
      claim: receipt.claim,
      claimDigest: receipt.claim?.fenceRevision ?? null,
      receipt,
      replayed: false,
    };
  }
  if (!MUTATING_ACTIONS.has(normalizedAction)) fail("invalid_action", `unsupported action: ${normalizedAction}`);
  const repositoryValue = normalizeRepository(repository);
  const actorValue = normalizeActor(actor, request);
  const intent = normalizeRootIntent(normalizedAction, request, actorValue, repositoryValue.repositoryId);
  if (
    repositoryValue.canonicalRevision
    && normalizedAction === "claim"
    && repositoryValue.canonicalRevision !== intent.canonicalBaseRevision
    && !allowsPredecessorBaseContinuation({
      ledger,
      intent,
      evaluationTime: evaluatedAt,
    })
  ) {
    fail("stale_canonical_base", "canonicalBaseRevision does not match protected source");
  }
  const { expectedLedgerDigest: _expectedLedgerDigest, ...semanticIntent } = intent;
  const requestDigest = digestValue({ action: normalizedAction, intent: semanticIntent });
  const idempotencyKey = digestValue(text(request.idempotencyKey, "idempotencyKey"));
  const prior = ledger.entries.find((entry) => entry.idempotencyKey === idempotencyKey);
  if (prior) {
    if (prior.action !== normalizedAction || prior.requestDigest !== requestDigest) {
      fail("idempotency_conflict", "idempotencyKey was already used for a different transition");
    }
    return mutationResult(ledger, prior, true);
  }
  if (intent.expectedLedgerDigest !== ledger.headDigest) {
    fail("stale_ledger_digest", "expectedLedgerDigest is stale");
  }
  const appended = appendEntry(
    ledger,
    normalizedAction,
    intent,
    requestDigest,
    idempotencyKey,
    evaluatedAt,
  );
  const appendedFailures = validateLedger(appended.ledger);
  if (appendedFailures.length > 0) fail("invalid_transition", appendedFailures.join("; "));
  return mutationResult(appended.ledger, appended.entry, false);
}
export function verifyCloudClaim({ ledger, request = {}, evaluationTime }) {
  const evaluatedAt = instant(evaluationTime, "evaluationTime");
  const failures = validateLedger(ledger);
  const claimId = request.claimId ? digest(request.claimId, "claimId") : null;
  const currentClaim = claimId
    ? hydrateWithLedger(ledger, findClaimEntry(ledger, claimId), evaluatedAt)
    : null;
  const historicalClaim = recoverRetiredIntegratedClaim({
    ledger,
    currentClaim,
    request,
  });
  const claim = historicalClaim || currentClaim;
  const findings = [];
  if (failures.length > 0) {
    findings.push(collaborationFinding("runtime-readiness-unproven", ledger, claim, request, null, "repair-ledger"));
  } else if (!claim || (!historicalClaim && TERMINAL_STATES.has(claim.state)) || claim.state === "waiting-successor") {
    findings.push(collaborationFinding("stale-collaboration-fence", ledger, claim, request, null, "obtain-current-claim"));
  } else {
    const stale = [
      ["repositoryId", claim.repositoryId],
      ["workItemId", claim.workItemId],
      ["canonicalBaseRevision", claim.canonicalBaseRevision],
      ["laneRevision", claim.laneRevision],
      ["writeSetDigest", claim.writeSetDigest],
      ["leaseEpoch", claim.leaseEpoch],
      ["fenceRevision", claim.fenceRevision],
      ["ledgerRevision", claim.ledgerRevision],
    ].some(([field, observed]) => request[field] !== undefined && request[field] !== observed);
    if (stale || (!historicalClaim
      && claim.ledgerRevision !== findClaimEntry(ledger, claim.claimId)?.digest)) {
      findings.push(collaborationFinding("stale-collaboration-fence", ledger, claim, request, claim.evidenceDigest, "refresh-cloud-fence"));
    }
    const collisions = currentClaims(ledger, evaluatedAt).filter((other) => (
      other.claimId !== claim.claimId
      && other.repositoryId === claim.repositoryId
      && other.writeAuthority
      && claim.writeAuthority
      && writeSetsOverlap(other.declaredWriteScope, claim.declaredWriteScope)
    ));
    if (collisions.length > 0) {
      findings.push(collaborationFinding("parallel-scope-collision", ledger, claim, request, claim.evidenceDigest, "serialize-overlapping-scope"));
    }
    const suppliedEvidence = request.focusedEvidenceDigest
      ? digest(request.focusedEvidenceDigest, "focusedEvidenceDigest")
      : null;
    if (suppliedEvidence && !claim.evidenceDigest) {
      findings.push(collaborationFinding("evidence-without-run", ledger, claim, request, suppliedEvidence, "join-evidence-to-review-ready"));
    }
    const requiredState = projectAuthorityState(request.requiredState ?? "current");
    const stateReady = requiredState === "current"
      ? ["current", "reviewed", "integrated-preserved"].includes(claim.state)
      : requiredState === "reviewed"
        ? ["reviewed", "integrated-preserved"].includes(claim.state)
        : claim.state === requiredState;
    const reviewReady = requiredState !== "reviewed" || (
      claim.reviewRequestId
      && claim.evidenceDigest
      && (!request.reviewRequestId || request.reviewRequestId === claim.reviewRequestId)
      && (!suppliedEvidence || suppliedEvidence === claim.evidenceDigest)
    );
    if (!stateReady || !reviewReady) {
      findings.push(collaborationFinding("runtime-readiness-unproven", ledger, claim, request, suppliedEvidence, "join-required-readiness-evidence"));
    }
  }
  findings.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const findingCounts = Object.fromEntries(FINDING_TYPES.map((type) => [
    type,
    findings.filter((item) => item.type === type).length,
  ]));
  const draft = {
    schema: RECEIPT_SCHEMA,
    action: "verify",
    ok: findings.length === 0,
    verdict: findings.length === 0 ? "ready" : "blocked",
    ledgerRepositoryId: ledger.ledgerRepositoryId,
    repositoryId: claim?.repositoryId ?? request.repositoryId ?? null,
    claimId,
    claim,
    claimDigest: claim?.fenceRevision ?? null,
    ledgerRevision: ledger.headDigest,
    ledgerSequence: ledger.sequence,
    evaluationTime: evaluatedAt,
    findings,
    findingCounts,
  };
  return { ...draft, receiptDigest: digestValue(draft) };
}

function recoverRetiredIntegratedClaim({ ledger, currentClaim, request }) {
  if (request.allowRetiredIntegratedPreserved !== true) return null;
  if (
    !currentClaim
    || currentClaim.state !== "retired"
    || request.requiredState !== "integrated-preserved"
    || !request.fenceRevision
    || !request.integrationReceiptDigest
    || !Number.isSafeInteger(request.transitionCounter)
  ) return null;
  const lineage = ledger.entries.filter(entry => entry.claimId === currentClaim.claimId);
  const historicalIndex = lineage.findIndex(
    entry => entry.claimDigest === request.fenceRevision,
  );
  if (historicalIndex < 0 || lineage.length !== historicalIndex + 2) return null;
  const historical = hydrateWithLedger(
    ledger,
    lineage[historicalIndex],
    null,
  );
  const retirement = lineage.at(-1);
  if (
    historical.state !== "integrated-preserved"
    || historical.transitionCounter !== request.transitionCounter
    || historical.integrationReceiptDigest !== request.integrationReceiptDigest
    || retirement.action !== "retire"
    || currentClaim.transitionCounter !== request.transitionCounter + 1
    || currentClaim.integrationReceiptDigest !== request.integrationReceiptDigest
  ) return null;
  return historical;
}
