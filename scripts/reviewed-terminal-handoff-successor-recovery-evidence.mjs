// Responsibility: Prove a reviewed local projection whose unprojected successor retired for handoff.
import { digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-reviewed-terminal-handoff-successor-recovery-evidence/v1";
const REVIEWED_PROOF_SCHEMA = "agentic-reviewed-superseded-source-proof/v1";
const HANDOFF_PROOF_SCHEMA = "agentic-unprojected-terminal-handoff-source-proof/v1";

export function selectReviewedTerminalHandoffProof({ entries, lease } = {}) {
  if (!Array.isArray(entries)) throw new Error("Raw collaboration ledger entries are required.");
  const authority = lease?.cloudAuthority;
  const localClaimId = digest(authority?.claimId, "local reviewed claim ID");
  const localClaimDigest = digest(authority?.claimDigest, "local reviewed claim digest");
  const localHistory = entries.filter(entry => entry?.claimId === localClaimId);
  const projected = localHistory.filter(entry => entry?.claimDigest === localClaimDigest);
  if (projected.length !== 1) {
    throw new Error("Ledger has no unique local reviewed-claim projection.");
  }
  const reviewedEntry = projected[0];
  const reviewedCore = reviewedEntry.claimCore;
  const sourceTerminal = localHistory.at(-1);
  const sourceTerminalCore = sourceTerminal?.claimCore;
  assertReviewedSource({ reviewedCore, sourceTerminalCore, lease });
  assertMonotonicSuffix({
    history: localHistory.slice(localHistory.indexOf(reviewedEntry)),
    sourceCore: reviewedCore,
    finalState: "retired",
    immutable: ["repositoryId", "actorId", "workItemId", "canonicalBaseRevision",
      "laneRevision", "writeSetDigest", "leaseEpoch", "reviewRequestId"],
  });

  const directEntries = entries.filter(entry => (
    entry?.claimCore?.predecessorClaimId === localClaimId
  ));
  const directIds = [...new Set(directEntries.map(entry => entry?.claimId))];
  if (directIds.length !== 1) {
    throw new Error("Reviewed source requires one exact unprojected direct successor.");
  }
  const handoffClaimId = digest(directIds[0], "handoff claim ID");
  const handoffHistory = directEntries.filter(entry => entry.claimId === handoffClaimId);
  const waiting = handoffHistory[0];
  const waitingCore = waiting?.claimCore;
  const current = handoffHistory.find(entry => entry?.claimCore?.state === "current");
  const terminal = handoffHistory.at(-1);
  const terminalCore = terminal?.claimCore;
  assertHandoffSuccessor({
    waitingCore,
    currentCore: current?.claimCore,
    terminalCore,
    reviewedCore,
    localClaimId,
    lease,
  });
  assertMonotonicSuffix({
    history: handoffHistory,
    sourceCore: waitingCore,
    finalState: "retired",
    immutable: ["repositoryId", "actorId", "workItemId", "canonicalBaseRevision",
      "laneRevision", "writeSetDigest", "leaseEpoch", "reviewRequestId", "predecessorClaimId"],
    initialCounter: 1,
    allowedIntermediateStates: new Set(["waiting-successor", "current"]),
  });

  const reviewedSourceCore = {
    schema: REVIEWED_PROOF_SCHEMA,
    claimId: localClaimId,
    claimDigest: localClaimDigest,
    transitionCounter: positive(reviewedCore.transitionCounter, "reviewed transition counter"),
    transitionDigest: digest(reviewedEntry.digest, "reviewed transition digest"),
    terminalTransitionCounter: positive(sourceTerminalCore.transitionCounter,
      "reviewed terminal transition counter"),
    terminalTransitionDigest: digest(sourceTerminal.digest, "reviewed terminal transition digest"),
    retirementReceiptDigest: terminalRetirementReceiptDigest(sourceTerminal),
    retirementReason: "superseded",
  };
  const handoffSourceCore = {
    schema: HANDOFF_PROOF_SCHEMA,
    claimId: handoffClaimId,
    predecessorClaimId: localClaimId,
    workItemId: text(waitingCore.workItemId, "handoff work-item ID"),
    repositoryId: text(waitingCore.repositoryId, "handoff repository ID"),
    actorId: text(waitingCore.actorId, "handoff actor ID"),
    canonicalBaseRevision: sha(waitingCore.canonicalBaseRevision, "handoff canonical base"),
    laneRevision: sha(waitingCore.laneRevision, "handoff lane revision"),
    declaredWriteScope: normalizeWriteSet(waitingCore.declaredWriteScope),
    writeSetDigest: digest(waitingCore.writeSetDigest, "handoff write-set digest"),
    leaseEpoch: positive(waitingCore.leaseEpoch, "handoff lease epoch"),
    reviewRequestId: null,
    waitingTransitionDigest: digest(waiting.digest, "waiting transition digest"),
    currentTransitionDigest: digest(current.digest, "current transition digest"),
    terminalTransitionCounter: positive(terminalCore.transitionCounter,
      "handoff terminal transition counter"),
    terminalTransitionDigest: digest(terminal.digest, "handoff terminal transition digest"),
    retirementReceiptDigest: terminalRetirementReceiptDigest(terminal),
    retirementReason: "handoff",
    retiredAt: instant(terminalCore.retirement.retiredAt, "handoff retirement time"),
  };
  const reviewedSource = Object.freeze({
    ...reviewedSourceCore,
    proofDigest: digestValue(reviewedSourceCore),
  });
  const handoffSource = Object.freeze({
    ...handoffSourceCore,
    proofDigest: digestValue(handoffSourceCore),
  });
  return Object.freeze({ reviewedSource, handoffSource });
}

export function assertNoLiveReviewedTerminalOverlap({ claims, reviewedSource, handoffSource } = {}) {
  if (!Array.isArray(claims)) throw new Error("Authoritative live claim inventory is required.");
  normalizeReviewedSource(reviewedSource);
  normalizeHandoffSource(handoffSource);
  const forbiddenIds = new Set([reviewedSource.claimId, handoffSource.claimId]);
  if (claims.some(claim => forbiddenIds.has(claim?.claimId))) {
    throw new Error("A terminal recovery source unexpectedly remains live.");
  }
  const successors = claims.filter(claim => claim?.predecessorClaimId === handoffSource.claimId);
  if (successors.length !== 0) {
    throw new Error("A live successor already exists for the terminal handoff source.");
  }
  const overlaps = claims.filter(claim => claim?.scopeReserved !== false
    && writeSetsOverlap(claim.declaredWriteScope, handoffSource.declaredWriteScope));
  if (overlaps.length !== 0) throw new Error("Another live claim overlaps the recovery write set.");
  return Object.freeze({
    schema: "agentic-reviewed-terminal-handoff-live-inventory-proof/v1",
    claimCount: claims.length,
    reviewedClaimId: reviewedSource.claimId,
    handoffClaimId: handoffSource.claimId,
    successorClaimIds: [],
    overlappingClaimIds: [],
    inventoryDigest: digestValue(claims),
  });
}

export function sealReviewedTerminalHandoffEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) throw new Error("Recovery evidence schema is invalid.");
  const core = { ...value };
  delete core.evidenceDigest;
  if (value.evidenceDigest !== digestValue(core)) throw new Error("Recovery evidence digest is invalid.");
  normalizeReviewedSource(value.reviewedSource);
  normalizeHandoffSource(value.handoffSource);
  digest(value.leaseDigest, "lease digest");
  digest(value.cleanEvidenceDigest, "clean evidence digest");
  digest(value.pullRequestMarkerDigest, "pull-request marker digest");
  digest(value.targetCapabilityDigest, "target capability digest");
  if (value.branch !== value.lease.branch
    || value.headSha !== value.lease.reviewHeadSha
    || value.reviewedSource.claimId !== value.lease.cloudAuthority.claimId
    || value.handoffSource.predecessorClaimId !== value.reviewedSource.claimId) {
    throw new Error("Recovery evidence does not join branch, lease, and terminal lineage.");
  }
  return deepFreeze(structuredClone(value));
}

function assertReviewedSource({ reviewedCore, sourceTerminalCore, lease }) {
  const authority = lease.cloudAuthority;
  const retirement = sourceTerminalCore?.retirement;
  if (reviewedCore?.state !== "reviewed"
    || sourceTerminalCore?.state !== "retired"
    || retirement?.reason !== "superseded"
    || retirement.finalRevision !== lease.reviewHeadSha
    || retirement.reviewRequestId !== authority.reviewRequestId
    || reviewedCore.canonicalBaseRevision !== authority.canonicalBaseSha
    || reviewedCore.laneRevision !== authority.laneRevision
    || reviewedCore.writeSetDigest !== authority.writeSetDigest
    || reviewedCore.reviewRequestId !== authority.reviewRequestId
    || reviewedCore.leaseEpoch !== authority.leaseEpoch) {
    throw new Error("Local reviewed claim has no exact superseded terminal chain.");
  }
}

function assertHandoffSuccessor({
  waitingCore, currentCore, terminalCore, reviewedCore, localClaimId, lease,
}) {
  const retirement = terminalCore?.retirement;
  const same = key => waitingCore?.[key] === reviewedCore?.[key];
  if (waitingCore?.state !== "waiting-successor"
    || currentCore?.state !== "current"
    || terminalCore?.state !== "retired"
    || retirement?.reason !== "handoff"
    || waitingCore.predecessorClaimId !== localClaimId
    || waitingCore.leaseEpoch !== reviewedCore.leaseEpoch + 1
    || waitingCore.reviewRequestId !== null
    || retirement.finalRevision !== lease.reviewHeadSha
    || retirement.reviewRequestId !== null
    || !["repositoryId", "actorId", "workItemId", "canonicalBaseRevision",
      "laneRevision", "writeSetDigest"].every(same)) {
    throw new Error("Reviewed source has no exact unprojected terminal-handoff successor.");
  }
}

function assertMonotonicSuffix({
  history, sourceCore, finalState, immutable, initialCounter = sourceCore?.transitionCounter,
  allowedIntermediateStates = new Set([sourceCore?.state]),
}) {
  if (!history.length || !Number.isSafeInteger(initialCounter)) {
    throw new Error("Terminal lineage suffix is incomplete.");
  }
  const valid = history.every((entry, index) => {
    const core = entry?.claimCore;
    const last = index === history.length - 1;
    return core?.transitionCounter === initialCounter + index
      && (last ? core.state === finalState : allowedIntermediateStates.has(core.state))
      && immutable.every(key => core[key] === sourceCore[key]);
  });
  if (!valid) throw new Error("Terminal lineage suffix is not monotonic and immutable.");
}

function normalizeReviewedSource(value) {
  if (value?.schema !== REVIEWED_PROOF_SCHEMA || value.retirementReason !== "superseded") {
    throw new Error("Reviewed source proof is invalid.");
  }
  const core = { ...value }; delete core.proofDigest;
  if (value.proofDigest !== digestValue(core)) throw new Error("Reviewed source proof digest is invalid.");
  return value;
}
function normalizeHandoffSource(value) {
  if (value?.schema !== HANDOFF_PROOF_SCHEMA || value.retirementReason !== "handoff") {
    throw new Error("Handoff source proof is invalid.");
  }
  const core = { ...value }; delete core.proofDigest;
  if (value.proofDigest !== digestValue(core)) throw new Error("Handoff source proof digest is invalid.");
  return value;
}
function terminalRetirementReceiptDigest(entry) {
  const receipt = {
    schema: "agentic-collaboration-retirement-receipt/v1",
    operation: "retire",
    status: "retired",
    repositoryId: text(entry.repositoryId, "retirement repository ID"),
    claimId: digest(entry.claimId, "retirement claim ID"),
    claimDigest: digest(entry.claimDigest, "retirement claim digest"),
    fenceRevision: digest(entry.claimDigest, "retirement fence"),
    ledgerRevision: digest(entry.digest, "retirement ledger revision"),
    ledgerSequence: positive(entry.sequence, "retirement ledger sequence"),
    idempotencyKey: digest(entry.idempotencyKey, "retirement idempotency key"),
    requestDigest: digest(entry.requestDigest, "retirement request digest"),
    evaluationTime: instant(entry.evaluationTime, "retirement evaluation time"),
  };
  return digestValue(receipt);
}
function text(value, label) { const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`); return result; }
function sha(value, label) { const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function digest(value, label) { const result = text(value, label);
  if (!/^[0-9a-f]{64}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1)
  throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`); return result; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
