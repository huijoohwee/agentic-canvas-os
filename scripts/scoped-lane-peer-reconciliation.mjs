import {
  digestValue,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const PEER_RECEIPT_SCHEMA = "agentic-independent-peer-operation-receipt/v1";
const ADAPTER_REVISION = "agentic-cloud-claim-inventory/v1";
const EVALUATOR_REVISION = "agentic-scoped-lane-peer-reconciliation/v1";

export function reconcileIndependentPeerOperations({ report, verification } = {}) {
  const candidateClaimId = requiredDigest(
    report?.cloudAuthority?.claimId ?? verification?.claimId,
    "candidate claimId",
  );
  const candidateWriteSet = report?.candidate?.declaredWriteSet;
  if (!Array.isArray(report?.remoteClaims)
    || !Array.isArray(verification?.inventory?.claims)) {
    throw driftError("the admission or verified inventory is incomplete");
  }
  const before = peerMap(report.remoteClaims, candidateClaimId, "admission peer");
  const after = peerMap(verification.inventory.claims, candidateClaimId, "verified peer");
  const finalPeerClaimSet = [...after.values()]
    .map((claim) => ({ claimId: claim.claimId, recordDigest: claim.recordDigest }))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  const finalPeerClaimSetDigest = digestValue(finalPeerClaimSet);
  const unchanged = [...before.values()].every((claim) => (
    after.get(claim.claimId)?.recordDigest === claim.recordDigest
  )) && before.size === after.size;
  if (unchanged) return result({
    peerDisposition: "unchanged",
    finalPeerClaimSetDigest,
    receipts: [],
  });
  if (!Array.isArray(candidateWriteSet)) {
    throw driftError("the admission candidate write set is incomplete");
  }
  for (const peer of after.values()) {
    if (writeSetsOverlap(peer.declaredWriteScope, candidateWriteSet)) {
      throw driftError(`peer ${peer.claimId} overlaps the candidate write scope`);
    }
  }

  for (const claimId of before.keys()) {
    if (!after.has(claimId)) {
      throw driftError(`peer ${claimId} disappeared without a terminal lineage receipt`);
    }
  }
  const baselineTime = instant(
    report.admissionReceipt?.evaluationTime ?? report.evaluatedAt,
    "admission evaluation time",
  );
  const verifiedAt = instant(
    verification.verifiedAt ?? verification.inventory.evaluationTime,
    "verification time",
  );
  const receipts = [];
  for (const current of [...after.values()].sort((left, right) => (
    left.claimId.localeCompare(right.claimId)
  ))) {
    const previous = before.get(current.claimId) ?? null;
    if (previous?.recordDigest === current.recordDigest) continue;
    if (previous) requireOneStepAdvance(previous, current, baselineTime, verifiedAt);
    else requireNewOneStepClaim(current, baselineTime, verifiedAt);
    receipts.push(peerOperationReceipt({
      report,
      verification,
      previous,
      current,
    }));
  }
  if (receipts.length === 0) throw driftError("changed peers lack attributable operations");
  return result({
    peerDisposition: "unchanged-or-independently-advanced-disjoint",
    finalPeerClaimSetDigest,
    receipts,
  });
}

function result({ peerDisposition, finalPeerClaimSetDigest, receipts }) {
  const frozenReceipts = Object.freeze(receipts.map(Object.freeze));
  return Object.freeze({
    peerDisposition,
    finalPeerClaimSetDigest,
    peerOperationReceipts: frozenReceipts,
    peerOperationReceiptDigests: Object.freeze(
      frozenReceipts.map((receipt) => receipt.receiptDigest),
    ),
  });
}

function peerMap(claims, candidateClaimId, label) {
  const values = claims.filter((claim) => claim.claimId !== candidateClaimId);
  const map = new Map();
  for (const claim of values) {
    requiredDigest(claim?.claimId, `${label} claimId`);
    requiredDigest(claim?.recordDigest, `${label} recordDigest`);
    if (map.has(claim.claimId)) throw driftError(`duplicate ${label} ${claim.claimId}`);
    map.set(claim.claimId, claim);
  }
  return map;
}

function requireOneStepAdvance(previous, current, baselineTime, verifiedAt) {
  const immutableFields = [
    "claimId",
    "entrySchema",
    "claimIdentitySchema",
    "actorId",
    "repositoryId",
    "workItemId",
    "predecessorClaimId",
    "canonicalBaseRevision",
    "declaredWriteScope",
    "writeSetDigest",
    "leaseEpoch",
  ];
  if (immutableFields.some((field) => (
    digestValue(previous[field] ?? null) !== digestValue(current[field] ?? null)
  ))) {
    throw driftError(`peer ${current.claimId} changed immutable identity or write scope`);
  }
  if (current.transitionCounter !== previous.transitionCounter + 1) {
    throw driftError(`peer ${current.claimId} did not advance exactly one transition`);
  }
  const previousSequence = positiveInteger(previous.ledgerSequence, "previous peer ledgerSequence");
  const currentSequence = positiveInteger(current.ledgerSequence, "current peer ledgerSequence");
  if (currentSequence <= previousSequence) {
    throw driftError(`peer ${current.claimId} ledger sequence did not advance`);
  }
  const priorReceipt = requiredDigest(
    previous.operationReceiptDigest,
    "previous peer operationReceiptDigest",
  );
  const currentReceipt = requiredDigest(
    current.operationReceiptDigest,
    "current peer operationReceiptDigest",
  );
  if (currentReceipt === priorReceipt) {
    throw driftError(`peer ${current.claimId} lacks a new operation receipt`);
  }
  requireOperationWindow(current, baselineTime, verifiedAt);
  if (Date.parse(current.operationTime) < Date.parse(previous.operationTime || baselineTime)) {
    throw driftError(`peer ${current.claimId} operation time moved backwards`);
  }
}

function requireNewOneStepClaim(current, baselineTime, verifiedAt) {
  if (current.transitionCounter !== 1) {
    throw driftError(`new peer ${current.claimId} is not an attributable first transition`);
  }
  positiveInteger(current.ledgerSequence, "new peer ledgerSequence");
  requiredDigest(current.operationReceiptDigest, "new peer operationReceiptDigest");
  requireOperationWindow(current, baselineTime, verifiedAt);
}

function requireOperationWindow(claim, baselineTime, verifiedAt) {
  const operationTime = instant(claim.operationTime, "peer operationTime");
  if (Date.parse(operationTime) < Date.parse(baselineTime)
    || Date.parse(operationTime) > Date.parse(verifiedAt)) {
    throw driftError(`peer ${claim.claimId} operation is outside the admitted observation window`);
  }
}

function peerOperationReceipt({ report, verification, previous, current }) {
  const localLanes = report.lanes.filter((lane) => (
    lane.lease?.cloudAuthority?.claimId === current.claimId
  ));
  if (localLanes.length > 1) {
    throw driftError(`peer ${current.claimId} maps to multiple local lanes`);
  }
  const mutationFields = previous
    ? Object.keys(current).filter((field) => (
      field !== "recordDigest"
      && digestValue(previous[field] ?? null) !== digestValue(current[field] ?? null)
    )).sort()
    : ["claim-created"];
  const core = {
    schema: PEER_RECEIPT_SCHEMA,
    disposition: "independently-advanced-disjoint",
    adapterRevision: ADAPTER_REVISION,
    evaluatorRevision: EVALUATOR_REVISION,
    claimId: current.claimId,
    actorId: requiredText(current.actorId, "peer actorId"),
    deviceId: requiredText(current.deviceId, "peer deviceId"),
    sessionId: requiredText(current.sessionId, "peer sessionId"),
    repositoryId: requiredText(current.repositoryId, "peer repositoryId"),
    workItemId: requiredText(current.workItemId, "peer workItemId"),
    writeSetDigest: requiredDigest(current.writeSetDigest, "peer writeSetDigest"),
    leaseEpoch: positiveInteger(current.leaseEpoch, "peer leaseEpoch"),
    transitionCounter: positiveInteger(current.transitionCounter, "peer transitionCounter"),
    fenceRevision: requiredDigest(current.fenceRevision, "peer fenceRevision"),
    transitionDigest: requiredDigest(current.transitionDigest, "peer transitionDigest"),
    ledgerSequence: positiveInteger(current.ledgerSequence, "peer ledgerSequence"),
    operationTime: instant(current.operationTime, "peer operationTime"),
    expiresAt: instant(current.expiresAt, "peer expiresAt"),
    collaborationOperationReceiptDigest: requiredDigest(
      current.operationReceiptDigest,
      "peer operationReceiptDigest",
    ),
    cloudVerificationReceiptDigest: requiredDigest(
      verification.receiptDigest,
      "cloud verification receiptDigest",
    ),
    beforeRecordDigest: previous?.recordDigest ?? null,
    afterRecordDigest: current.recordDigest,
    localLaneDisposition: localLanes.length === 1 ? "unchanged" : "absent",
    localLaneStateDigest: localLanes[0]?.stateDigest ?? null,
    mutationSetDigest: digestValue(mutationFields),
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function requiredDigest(value, label) {
  const normalized = String(value || "").trim();
  if (!DIGEST_PATTERN.test(normalized)) throw driftError(`${label} is missing or malformed`);
  return normalized;
}

function requiredText(value, label) {
  const normalized = String(value || "").normalize("NFC").trim();
  if (!normalized) throw driftError(`${label} is missing`);
  return normalized;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw driftError(`${label} is missing or malformed`);
  return value;
}

function instant(value, label) {
  const milliseconds = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(milliseconds)) {
    throw driftError(`${label} is missing or malformed`);
  }
  return new Date(milliseconds).toISOString();
}

function driftError(reason) {
  return new Error(
    `Peer claim inventory drift requires an independent peer-operation receipt; provisioning blocked: ${reason}.`,
  );
}
