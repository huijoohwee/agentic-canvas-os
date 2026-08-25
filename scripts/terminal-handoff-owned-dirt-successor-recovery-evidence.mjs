// Responsibility: Prove one active dirty lane whose exact cloud predecessor retired for handoff.
import { digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-terminal-handoff-owned-dirt-successor-recovery-evidence/v1";

export function selectTerminalHandoffClaimProof({ entries, lease } = {}) {
  if (!Array.isArray(entries)) throw new Error("Raw collaboration ledger entries are required.");
  const authority = lease?.cloudAuthority;
  const claimId = digest(authority?.claimId, "source claim ID");
  const claimDigest = digest(authority?.claimDigest, "source claim digest");
  const history = entries.filter(entry => entry?.claimId === claimId);
  const sources = history.filter(entry => entry?.claimDigest === claimDigest);
  if (sources.length !== 1) throw new Error("Ledger has no unique local source-claim projection.");
  const source = sources[0];
  const terminal = history.at(-1);
  const sourceCore = source.claimCore;
  const terminalCore = terminal?.claimCore;
  const retirement = terminalCore?.retirement;
  const suffix = history.slice(history.indexOf(source));
  const immutable = ["repositoryId", "actorId", "workItemId", "canonicalBaseRevision",
    "laneRevision", "writeSetDigest", "leaseEpoch", "reviewRequestId"];
  const monotonicSuffix = suffix.every((entry, index) => {
    const core = entry.claimCore;
    const expectedCounter = sourceCore.transitionCounter + index;
    const expectedState = index === suffix.length - 1 ? "retired" : "current";
    return core?.transitionCounter === expectedCounter && core.state === expectedState
      && immutable.every(key => core[key] === sourceCore[key]);
  });
  if (sourceCore?.state !== "current"
    || terminalCore?.state !== "retired"
    || retirement?.reason !== "handoff"
    || terminalCore.transitionCounter <= sourceCore.transitionCounter
    || !monotonicSuffix
    || retirement.finalRevision !== lease.fenceSha
    || retirement.reviewRequestId !== authority.reviewRequestId
    || sourceCore.canonicalBaseRevision !== authority.canonicalBaseSha
    || sourceCore.laneRevision !== authority.laneRevision
    || sourceCore.writeSetDigest !== authority.writeSetDigest
    || sourceCore.reviewRequestId !== authority.reviewRequestId
    || sourceCore.leaseEpoch !== authority.leaseEpoch) {
    throw new Error("Source claim has no exact terminal handoff retirement chain.");
  }
  const core = {
    schema: "agentic-terminal-handoff-cloud-proof/v1",
    claimId,
    claimDigest,
    workItemId: text(sourceCore.workItemId, "source work-item ID"),
    repositoryId: text(sourceCore.repositoryId, "source repository ID"),
    actorId: text(sourceCore.actorId, "source actor ID"),
    canonicalBaseRevision: sha(sourceCore.canonicalBaseRevision, "source canonical base"),
    laneRevision: sha(sourceCore.laneRevision, "source lane revision"),
    declaredWriteScope: normalizeWriteSet(sourceCore.declaredWriteScope),
    writeSetDigest: digest(sourceCore.writeSetDigest, "source write-set digest"),
    leaseEpoch: positive(sourceCore.leaseEpoch, "source lease epoch"),
    reviewRequestId: text(sourceCore.reviewRequestId, "source review request ID"),
    sourceTransitionCounter: positive(sourceCore.transitionCounter, "source transition counter"),
    sourceTransitionDigest: digest(source.digest, "source transition digest"),
    terminalTransitionCounter: positive(terminalCore.transitionCounter, "terminal transition counter"),
    terminalTransitionDigest: digest(terminal.digest, "terminal transition digest"),
    retirementReceiptDigest: terminalRetirementReceiptDigest(terminal),
    retirementReason: "handoff",
    retiredAt: instant(retirement.retiredAt, "retirement time"),
  };
  return Object.freeze({ ...core, proofDigest: digestValue(core) });
}

export function assertNoLiveOverlap({ claims, sourceProof } = {}) {
  if (!Array.isArray(claims)) throw new Error("Authoritative live claim inventory is required.");
  const source = normalizeSourceProof(sourceProof);
  const sourceMatches = claims.filter(claim => claim?.claimId === source.claimId);
  if (sourceMatches.length !== 0) throw new Error("Terminal source claim unexpectedly remains live.");
  const successors = claims.filter(claim => claim?.predecessorClaimId === source.claimId);
  if (successors.length !== 0) throw new Error("A successor claim already exists for the terminal source.");
  const overlaps = claims.filter(claim => claim?.scopeReserved !== false
    && writeSetsOverlap(claim.declaredWriteScope, source.declaredWriteScope));
  if (overlaps.length !== 0) throw new Error("Another live claim overlaps the recovery write set.");
  return Object.freeze({
    schema: "agentic-terminal-handoff-live-inventory-proof/v1",
    claimCount: claims.length,
    sourceClaimId: source.claimId,
    overlappingClaimIds: [],
    successorClaimIds: [],
    inventoryDigest: digestValue(claims),
  });
}

export function sealTerminalHandoffEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) throw new Error("Recovery evidence schema is invalid.");
  const core = { ...value };
  delete core.evidenceDigest;
  if (value.evidenceDigest !== digestValue(core)) throw new Error("Recovery evidence digest is invalid.");
  normalizeSourceProof(value.sourceClaim);
  digest(value.leaseDigest, "lease digest");
  digest(value.dirtEvidenceDigest, "dirt evidence digest");
  digest(value.pullRequestMarkerDigest, "pull-request marker digest");
  digest(value.targetCapabilityDigest, "target capability digest");
  if (value.branch !== value.lease.branch || value.headSha !== value.lease.fenceSha
    || value.sourceClaim.claimId !== value.lease.cloudAuthority.claimId) {
    throw new Error("Recovery evidence does not join branch, lease, and source claim.");
  }
  return deepFreeze(structuredClone(value));
}

function normalizeSourceProof(value) {
  if (value?.schema !== "agentic-terminal-handoff-cloud-proof/v1"
    || value.retirementReason !== "handoff") throw new Error("Terminal source proof is invalid.");
  const core = { ...value }; delete core.proofDigest;
  if (value.proofDigest !== digestValue(core)) throw new Error("Terminal source proof digest is invalid.");
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
function text(value, label) { const result = String(value || "").trim();
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
