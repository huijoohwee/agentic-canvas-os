import {
  CLOUD_COLLABORATION_BOUNDS,
  ENTRY_SCHEMA,
  LEDGER_SCHEMA,
  MUTATING_ACTIONS,
  RECEIPT_SCHEMA,
  canonicalJson,
  createEmptyLedger,
  digest,
  digestValue,
  fail,
  instant,
  integer,
  normalizeActor,
  normalizeRepository,
  normalizeWriteSet,
  text,
  validateLedger,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";

export {
  CLOUD_COLLABORATION_BOUNDS,
  CloudCollaborationError,
  ENTRY_SCHEMA,
  LEDGER_SCHEMA,
  RECEIPT_SCHEMA,
  canonicalJson,
  createEmptyLedger,
  digestValue,
  normalizeWriteSet,
  validateLedger,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";

const TERMINAL_STATES = new Set(["released", "expired", "revoked"]);
const FINDING_TYPES = Object.freeze([
  "parallel-scope-collision",
  "stale-collaboration-fence",
  "delivery-authority-unjoined",
  "evidence-without-run",
  "runtime-readiness-unproven",
]);

function normalizeExpectedClaim(request) {
  return {
    claimId: digest(request.claimId, "claimId"),
    expectedFenceRevision: digest(request.expectedFenceRevision, "expectedFenceRevision"),
    expectedTransitionCounter: integer(request.expectedTransitionCounter, "expectedTransitionCounter", { minimum: 1 }),
  };
}

function normalizeIntent(action, request, actor, repositoryId) {
  const common = { repositoryId, ...actor };
  if (action === "claim") {
    const declaredWriteScope = normalizeWriteSet(request.declaredWriteScope);
    const writeSetDigest = digestValue(declaredWriteScope);
    const intent = {
      ...common,
      workItemId: text(request.workItemId, "workItemId"),
      canonicalBaseRevision: text(request.canonicalBaseRevision, "canonicalBaseRevision"),
      declaredWriteScope,
      writeSetDigest,
      laneRevision: text(request.laneRevision ?? request.canonicalBaseRevision, "laneRevision"),
      leaseEpoch: integer(request.leaseEpoch, "leaseEpoch", { minimum: 1 }),
      predecessorClaimId: digest(request.predecessorClaimId, "predecessorClaimId", { optional: true }),
      expiresAt: instant(request.expiresAt, "expiresAt"),
    };
    const claimId = digestValue({
      actorId: actor.actorId,
      canonicalBaseRevision: intent.canonicalBaseRevision,
      deviceId: actor.deviceId,
      leaseEpoch: intent.leaseEpoch,
      repositoryId,
      sessionId: actor.sessionId,
      workItemId: intent.workItemId,
      writeSetDigest,
    });
    if (request.claimId !== undefined && digest(request.claimId, "claimId") !== claimId) {
      fail("claim_identity_mismatch", "claimId does not match the normalized claim identity");
    }
    return { ...intent, claimId };
  }
  const expected = normalizeExpectedClaim(request);
  if (action === "bind") {
    return {
      ...common,
      ...expected,
      laneRevision: text(request.laneRevision, "laneRevision"),
      reviewRequestId: text(request.reviewRequestId, "reviewRequestId", { optional: true }),
    };
  }
  if (action === "heartbeat") {
    return { ...common, ...expected, expiresAt: instant(request.expiresAt, "expiresAt") };
  }
  if (action === "review-ready") {
    return {
      ...common,
      ...expected,
      laneRevision: text(request.laneRevision, "laneRevision"),
      reviewRequestId: text(request.reviewRequestId, "reviewRequestId"),
      focusedEvidenceDigest: digest(request.focusedEvidenceDigest, "focusedEvidenceDigest"),
    };
  }
  if (action === "delivery-authorize") {
    return {
      ...common,
      ...expected,
      laneRevision: text(request.laneRevision, "laneRevision"),
      reviewRequestId: text(request.reviewRequestId, "reviewRequestId"),
      focusedEvidenceDigest: digest(request.focusedEvidenceDigest, "focusedEvidenceDigest"),
      operatorDecisionDigest: digest(request.operatorDecisionDigest, "operatorDecisionDigest"),
      integrationIntentDigest: digest(request.integrationIntentDigest, "integrationIntentDigest"),
    };
  }
  if (action === "handoff") {
    const mode = text(request.recipientMode, "recipientMode");
    if (!["actor", "open"].includes(mode)) fail("invalid_request", "recipientMode must be actor or open");
    return {
      ...common,
      ...expected,
      recipientMode: mode,
      nextActorId: mode === "actor" ? text(request.nextActorId, "nextActorId") : null,
      evidenceDigest: digest(request.evidenceDigest, "evidenceDigest"),
    };
  }
  if (action === "release") {
    const reason = text(request.reason, "reason");
    if (!["integrated", "abandoned", "handoff"].includes(reason)) {
      fail("invalid_request", "release reason must be integrated, abandoned, or handoff");
    }
    return {
      ...common,
      ...expected,
      reason,
      evidenceDigest: digest(request.evidenceDigest, "evidenceDigest"),
      integrationReceiptDigest: digest(
        request.integrationReceiptDigest,
        "integrationReceiptDigest",
        { optional: reason !== "integrated" },
      ),
    };
  }
  fail("invalid_action", `unsupported mutation action: ${action}`);
}

function hydrate(entry, evaluationTime = null) {
  if (!entry) return null;
  const claim = {
    ...entry.claimCore,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
  };
  if (
    evaluationTime
    && !TERMINAL_STATES.has(claim.state)
    && Date.parse(evaluationTime) >= Date.parse(claim.expiresAt)
  ) {
    claim.state = "expired";
  }
  return claim;
}

function currentClaimEntries(ledger) {
  const latest = new Map();
  for (const entry of ledger.entries) latest.set(entry.claimId, entry);
  return latest;
}

function consumedPredecessors(latest) {
  return new Set([...latest.values()]
    .map((entry) => entry.claimCore.predecessorClaimId)
    .filter(Boolean));
}

function currentClaims(ledger, evaluationTime) {
  const latest = currentClaimEntries(ledger);
  const consumed = consumedPredecessors(latest);
  return [...latest.values()]
    .filter((entry) => !consumed.has(entry.claimId))
    .map((entry) => hydrate(entry, evaluationTime));
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

function mutationResult(ledger, entry, replayed) {
  return {
    ledger,
    claim: hydrate(entry, entry.evaluationTime),
    claimDigest: entry.claimDigest,
    receipt: buildReceipt(entry),
    replayed,
  };
}

function requireOwnedClaim(ledger, intent, evaluationTime) {
  const entry = findClaimEntry(ledger, intent.claimId);
  if (!entry) fail("claim_not_found", `claim ${intent.claimId} does not exist`);
  const claim = hydrate(entry, evaluationTime);
  if (TERMINAL_STATES.has(claim.state) && !(
    claim.state === "expired"
    && intent.reason === "integrated"
  )) {
    fail("claim_not_active", `claim is ${claim.state}`);
  }
  if (
    claim.actorId !== intent.actorId
    || claim.deviceId !== intent.deviceId
    || claim.sessionId !== intent.sessionId
  ) {
    fail("claim_owner_mismatch", "actor, device, or session does not own this claim");
  }
  if (claim.fenceRevision !== intent.expectedFenceRevision) {
    fail("stale_collaboration_fence", "expectedFenceRevision is stale");
  }
  if (claim.transitionCounter !== intent.expectedTransitionCounter) {
    fail("stale_transition_counter", "expectedTransitionCounter is stale");
  }
  return claim;
}

function claimCoreForAction(action, intent, ledger, evaluationTime) {
  if (action === "claim") return buildClaimCore(intent, ledger, evaluationTime);
  const previous = requireOwnedClaim(ledger, intent, evaluationTime);
  const base = { ...previous };
  delete base.fenceRevision;
  delete base.ledgerRevision;
  base.transitionCounter += 1;
  if (action === "bind") {
    if (previous.state !== "active") fail("invalid_transition", "bind requires active state");
    if (intent.laneRevision === previous.laneRevision && intent.reviewRequestId === previous.reviewRequestId) {
      fail("invalid_transition", "bind must change the immutable lane or review projection");
    }
    return { ...base, laneRevision: intent.laneRevision, reviewRequestId: intent.reviewRequestId };
  }
  if (action === "heartbeat") {
    if (Date.parse(intent.expiresAt) <= Date.parse(previous.expiresAt)) {
      fail("invalid_transition", "heartbeat must extend expiresAt");
    }
    return { ...base, heartbeatCounter: previous.heartbeatCounter + 1, expiresAt: intent.expiresAt };
  }
  if (action === "review-ready") {
    if (previous.state !== "active") fail("invalid_transition", "review-ready requires active state");
    if (intent.laneRevision !== previous.laneRevision) {
      fail("stale_lane_revision", "review-ready laneRevision must match the current bound lane");
    }
    return {
      ...base,
      state: "review-ready",
      reviewRequestId: intent.reviewRequestId,
      evidenceDigest: intent.focusedEvidenceDigest,
    };
  }
  if (action === "delivery-authorize") {
    if (previous.state !== "review-ready") {
      fail("invalid_transition", "delivery-authorize requires review-ready state");
    }
    if (
      intent.laneRevision !== previous.laneRevision
      || intent.reviewRequestId !== previous.reviewRequestId
      || intent.focusedEvidenceDigest !== previous.evidenceDigest
    ) {
      fail("delivery_authority_unjoined", "delivery authorization must bind the unchanged reviewed lane and evidence");
    }
    return {
      ...base,
      state: "delivery-authorized",
      deliveryAuthorization: {
        focusedEvidenceDigest: intent.focusedEvidenceDigest,
        integrationIntentDigest: intent.integrationIntentDigest,
        operatorDecisionDigest: intent.operatorDecisionDigest,
        evaluationTime,
      },
    };
  }
  if (action === "handoff") {
    if (!["active", "review-ready"].includes(previous.state)) {
      fail("invalid_transition", "handoff requires active or review-ready state");
    }
    return {
      ...base,
      state: "parked",
      handoff: {
        mode: intent.recipientMode,
        nextActorId: intent.nextActorId,
        evidenceDigest: intent.evidenceDigest,
        evaluationTime,
      },
    };
  }
  if (intent.reason === "integrated") {
    const storedState = findClaimEntry(ledger, intent.claimId)?.claimCore?.state;
    if (previous.state !== "delivery-authorized"
      && !(previous.state === "expired" && storedState === "delivery-authorized")) {
      fail("invalid_transition", "integrated release requires delivery-authorized state");
    }
  }
  if (intent.reason === "handoff") {
    const consumed = consumedPredecessors(currentClaimEntries(ledger));
    if (!previous.handoff || !consumed.has(previous.claimId)) {
      fail("invalid_transition", "handoff release requires an accepted successor claim");
    }
  }
  return {
    ...base,
    state: "released",
    release: {
      reason: intent.reason,
      evidenceDigest: intent.evidenceDigest,
      integrationReceiptDigest: intent.integrationReceiptDigest,
      evaluationTime,
    },
  };
}

function buildClaimCore(intent, ledger, evaluationTime) {
  if (Date.parse(intent.expiresAt) <= Date.parse(evaluationTime)) {
    fail("invalid_expiry", "expiresAt must be later than evaluationTime");
  }
  const latest = currentClaimEntries(ledger);
  const predecessor = intent.predecessorClaimId ? hydrate(latest.get(intent.predecessorClaimId), evaluationTime) : null;
  if (intent.predecessorClaimId && !predecessor) fail("claim_not_found", "predecessor claim does not exist");
  if (predecessor) {
    if (!["parked", "expired"].includes(predecessor.state)) {
      fail("invalid_transition", "predecessor claim must be parked or expired");
    }
    if (
      predecessor.repositoryId !== intent.repositoryId
      || predecessor.workItemId !== intent.workItemId
      || predecessor.writeSetDigest !== intent.writeSetDigest
      || predecessor.laneRevision !== intent.laneRevision
      || predecessor.canonicalBaseRevision !== intent.canonicalBaseRevision
    ) {
      fail("handoff_identity_mismatch", "successor must preserve predecessor work, scope, base, and lane");
    }
    if (
      predecessor.state === "parked"
      && predecessor.handoff?.mode === "actor"
      && predecessor.handoff.nextActorId !== intent.actorId
    ) {
      fail("handoff_recipient_mismatch", "actor is not the named handoff recipient");
    }
    if (predecessor.state === "parked" && !predecessor.handoff) {
      fail("invalid_transition", "parked predecessor has no accepted handoff");
    }
  }
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
  const consumed = consumedPredecessors(latest);
  for (const entry of latest.values()) {
    if (consumed.has(entry.claimId) || entry.claimId === intent.predecessorClaimId) continue;
    const current = hydrate(entry, evaluationTime);
    if (
      current.repositoryId !== intent.repositoryId
      || current.state === "released"
      || !writeSetsOverlap(current.declaredWriteScope, intent.declaredWriteScope)
    ) continue;
    if (current.state === "expired") {
      fail("expired_predecessor_required", "an overlapping expired claim must be named as predecessor");
    }
    fail("parallel_scope_collision", `declared write scope overlaps claim ${current.claimId}`);
  }
  const activeCount = currentClaims(ledger, evaluationTime)
    .filter((claim) => !TERMINAL_STATES.has(claim.state)).length;
  if (activeCount >= CLOUD_COLLABORATION_BOUNDS.activeClaims) {
    fail("bound_exceeded", `active claims exceed ${CLOUD_COLLABORATION_BOUNDS.activeClaims}`);
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
    state: "active",
    expiresAt: intent.expiresAt,
    evidenceDigest: null,
    reviewRequestId: null,
    predecessorClaimId: intent.predecessorClaimId,
    handoff: null,
    release: null,
  };
}

function appendEntry(ledger, action, intent, requestDigest, idempotencyKey, evaluationTime) {
  if (ledger.entries.length >= CLOUD_COLLABORATION_BOUNDS.ledgerEntries) {
    fail("bound_exceeded", `ledger exceeds ${CLOUD_COLLABORATION_BOUNDS.ledgerEntries} entries`);
  }
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
    const claim = hydrate(findClaimEntry(ledger, claimId), evaluatedAt);
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
  const intent = normalizeIntent(normalizedAction, request, actorValue, repositoryValue.repositoryId);
  if (
    repositoryValue.canonicalRevision
    && normalizedAction === "claim"
    && repositoryValue.canonicalRevision !== intent.canonicalBaseRevision
  ) {
    fail("stale_canonical_base", "canonicalBaseRevision does not match protected source");
  }
  const requestDigest = digestValue({ action: normalizedAction, intent });
  const idempotencyKey = digestValue(text(request.idempotencyKey, "idempotencyKey"));
  const prior = ledger.entries.find((entry) => entry.idempotencyKey === idempotencyKey);
  if (prior) {
    if (prior.action !== normalizedAction || prior.requestDigest !== requestDigest) {
      fail("idempotency_conflict", "idempotencyKey was already used for a different transition");
    }
    return mutationResult(ledger, prior, true);
  }
  const appended = appendEntry(
    ledger,
    normalizedAction,
    intent,
    requestDigest,
    idempotencyKey,
    evaluatedAt,
  );
  return mutationResult(appended.ledger, appended.entry, false);
}

function finding(type, ledger, claim, expected = {}, evidenceDigest = null, remediation = "re-evaluate") {
  return {
    type,
    severity: type === "evidence-without-run" ? "major" : "blocker",
    repositoryId: claim?.repositoryId ?? expected.repositoryId ?? null,
    workItemId: claim?.workItemId ?? expected.workItemId ?? null,
    scope: claim?.declaredWriteScope ?? expected.declaredWriteScope ?? [],
    leaseEpoch: claim?.leaseEpoch ?? expected.leaseEpoch ?? null,
    expectedFence: expected.fenceRevision ?? null,
    observedFence: claim?.fenceRevision ?? null,
    affectedRevisions: [claim?.canonicalBaseRevision, claim?.laneRevision, ledger.headDigest].filter(Boolean),
    evidenceDigest,
    remediation,
  };
}

export function verifyCloudClaim({ ledger, request = {}, evaluationTime }) {
  const evaluatedAt = instant(evaluationTime, "evaluationTime");
  const failures = validateLedger(ledger);
  const claimId = request.claimId ? digest(request.claimId, "claimId") : null;
  const claim = claimId ? hydrate(findClaimEntry(ledger, claimId), evaluatedAt) : null;
  const findings = [];
  if (failures.length > 0) {
    findings.push(finding("runtime-readiness-unproven", ledger, claim, request, null, "repair-ledger"));
  } else if (!claim || TERMINAL_STATES.has(claim.state)) {
    findings.push(finding("stale-collaboration-fence", ledger, claim, request, null, "obtain-current-claim"));
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
    if (stale || claim.ledgerRevision !== findClaimEntry(ledger, claim.claimId)?.digest) {
      findings.push(finding("stale-collaboration-fence", ledger, claim, request, claim.evidenceDigest, "refresh-cloud-fence"));
    }
    const collisions = currentClaims(ledger, evaluatedAt).filter((other) => (
      other.claimId !== claim.claimId
      && other.repositoryId === claim.repositoryId
      && !TERMINAL_STATES.has(other.state)
      && writeSetsOverlap(other.declaredWriteScope, claim.declaredWriteScope)
    ));
    if (collisions.length > 0) {
      findings.push(finding("parallel-scope-collision", ledger, claim, request, claim.evidenceDigest, "serialize-overlapping-scope"));
    }
    const suppliedEvidence = request.focusedEvidenceDigest
      ? digest(request.focusedEvidenceDigest, "focusedEvidenceDigest")
      : null;
    if (suppliedEvidence && !claim.evidenceDigest) {
      findings.push(finding("evidence-without-run", ledger, claim, request, suppliedEvidence, "join-evidence-to-review-ready"));
    }
    const requiredState = request.requiredState ?? "active";
    const stateReady = requiredState === "active"
      ? ["active", "review-ready", "parked"].includes(claim.state)
      : claim.state === requiredState;
    const reviewReady = requiredState !== "review-ready" || (
      claim.reviewRequestId
      && claim.evidenceDigest
      && (!request.reviewRequestId || request.reviewRequestId === claim.reviewRequestId)
      && (!suppliedEvidence || suppliedEvidence === claim.evidenceDigest)
    );
    if (!stateReady || !reviewReady) {
      findings.push(finding("runtime-readiness-unproven", ledger, claim, request, suppliedEvidence, "join-required-readiness-evidence"));
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
