// Responsibility: Join historical rollover, terminal bridge promotion, live owner, dirt, and PR evidence.
import {
  canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  normalizeSuccessorRolloverContinuationPlan,
  requireSuccessorRolloverContinuationJournal,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs";
import { normalizeSuccessorRolloverReplacementPlan }
  from "./active-dirty-scope-expansion-successor-rollover-contract.mjs";
import {
  buildWaitingBridgeResult,
  normalizeWaitingBridgeJournal,
  SUCCESSOR_PROMOTION_OPERATION,
} from "./claim-only-waiting-bridge-reconciliation-contract.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { OPERATION } from "./successor-rollover-dormant-owner-continuation-contract.mjs";

export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;

export function buildDormantOwnerContinuationEvidence(input = {}) {
  const { core, lease, promotionResult } = buildStaticEvidenceCore(input);
  const cloud = requireCloudTopology({
    status: input.cloudStatus,
    lease,
    promotionResult,
  });
  const { registryRevision, observedAt, ...prefix } = core;
  const complete = { ...prefix, cloud, registryRevision, observedAt };
  return deepFreeze({ ...complete, evidenceDigest: digestValue(complete) });
}

export function requireSameDormantOwnerContinuationStaticEvidence(expected, input = {}) {
  const sealed = normalizeDormantOwnerContinuationEvidence(expected);
  const { cloud: ignoredCloud, evidenceDigest: ignoredDigest, ...left } = sealed;
  void ignoredCloud;
  void ignoredDigest;
  const right = buildStaticEvidenceCore(input).core;
  if (canonicalJson(left) !== canonicalJson(right)) invalid("static live evidence drift");
  return deepFreeze({ ...right, evidenceDigest: digestValue(right) });
}

function buildStaticEvidenceCore(input) {
  const continuation = normalizeSuccessorRolloverContinuationPlan(input.continuationPlan);
  const rolloverJournal = requireSuccessorRolloverContinuationJournal({
    plan: continuation,
    journal: input.rolloverJournal,
  });
  const replacement = normalizeSuccessorRolloverReplacementPlan(
    continuation.replacementPlanSnapshot,
  );
  const promotionJournal = normalizeWaitingBridgeJournal(input.promotionJournal);
  if (promotionJournal.operation !== SUCCESSOR_PROMOTION_OPERATION
    || promotionJournal.state?.phase !== "complete") invalid("terminal successor-promotion journal");
  const promotionResult = buildWaitingBridgeResult(promotionJournal);
  const lease = requireLease(input.lease, input.observedAt);
  const promotedOwner = rolloverJournal.replacement
    ?.phases?.["replacement-promoted"]?.values?.claim;
  if (!promotedOwner || lease.branch !== replacement.branch
    || lease.fenceSha !== replacement.sourceFenceSha
    || lease.cloudAuthority.claimId !== promotedOwner.claimId
    || lease.admission.writeSetDigest !== replacement.target.writeSetDigest
    || lease.admission.manifestDigest !== replacement.target.manifestDigest) {
    invalid("rollover owner lease join");
  }
  const tombstone = requireTombstone(input.tombstone, lease, replacement);
  if (promotionResult.anchorClaimId !== promotedOwner.claimId
    || promotionJournal.plan.anchorClaimId !== promotedOwner.claimId) {
    invalid("promotion anchor owner join");
  }
  const dirt = normalizeActiveOwnedDirtEvidence(input.dirtEvidence);
  assertActiveOwnedDirtWithinWriteSet({
    evidence: dirt,
    declaredWriteSet: lease.admission.declaredWriteSet,
  });
  if (dirt.headSha !== lease.fenceSha || dirt.pathCount < 1) invalid("owned dirt fence");
  const pull = requirePullRequest(input.pullRequest, lease, continuation);
  const controller = requireProtectedControllerAdvance(
    input.protectedControllerAdvance,
    replacement,
    lease.admission.declaredWriteSet,
  );
  const historical = continuation.historicalBindProof;
  if (historical.sourceBaseSha !== pull.baseSha
    || historical.targetBaseSha !== replacement.targetCanonicalBaseSha
    || historical.overlap !== "none") invalid("historical review-base proof");
  const source = {
    branch: lease.branch,
    sessionId: lease.sessionId,
    worktreePath: lease.worktreePath,
    leaseDigest: writerLeaseDigest(lease),
    claimId: lease.cloudAuthority.claimId,
    claimDigest: lease.cloudAuthority.claimDigest,
    transitionCounter: lease.cloudAuthority.transitionCounter,
    localEpoch: lease.epoch,
    cloudLeaseEpoch: lease.cloudAuthority.leaseEpoch,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    writeSetDigest: lease.admission.writeSetDigest,
    manifestDigest: lease.admission.manifestDigest,
    reviewRequestId: lease.cloudAuthority.reviewRequestId,
    taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
    expiresAt: lease.expiresAt,
  };
  return {
    lease,
    promotionResult,
    core: {
    schema: EVIDENCE_SCHEMA,
    repository: text(input.repository, "repository"),
    controllerRoot: text(input.controllerRoot, "controller root"),
    source,
    rollover: {
      continuationPlanDigest: continuation.planDigest,
      rolloverJournalDigest: rolloverJournal.journalDigest,
      replacementPlanDigest: replacement.planDigest,
      historicalBindProofDigest: historical.evidenceDigest,
      tombstoneDigest: digestValue(tombstone),
      tombstoneReceiptDigest: tombstone.receiptDigest,
    },
    promotion: {
      journalDigest: promotionJournal.journalDigest,
      resultDigest: promotionResult.resultDigest,
      bridgeClaimId: promotionResult.bridgeClaimId,
      successorClaimId: promotionResult.successorClaimId,
    },
    pullRequest: pull,
    dirt,
    controller,
    registryRevision: positive(input.registryRevision, "registry revision"),
    observedAt: instant(input.observedAt, "observation time"),
    },
  };
}

export function normalizeDormantOwnerContinuationEvidence(value) {
  if (!value || value.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const { evidenceDigest, ...core } = structuredClone(value);
  if (evidenceDigest !== digestValue(core)) invalid("evidence seal");
  for (const member of [
    core.source?.leaseDigest, core.source?.claimId, core.source?.claimDigest,
    core.rollover?.tombstoneDigest, core.rollover?.tombstoneReceiptDigest,
    core.promotion?.journalDigest, core.promotion?.resultDigest,
    core.pullRequest?.markerDigest, core.dirt?.evidenceDigest,
    core.controller?.evidenceDigest, core.cloud?.topologyDigest,
  ]) digest(member, "evidence digest member");
  if (core.source.claimId !== core.cloud.anchorClaimId
    || core.source.claimId !== core.pullRequest.markerClaimId
    || core.source.fenceSha !== core.pullRequest.headSha
    || core.source.writeSetDigest !== core.cloud.anchorWriteSetDigest
    || core.rollover.tombstoneReceiptDigest === core.rollover.tombstoneDigest) {
    invalid("evidence cross join");
  }
  return deepFreeze({ ...core, evidenceDigest });
}

export function requireSameDormantOwnerContinuationEvidence(expected, observed) {
  const left = normalizeDormantOwnerContinuationEvidence(expected);
  const right = normalizeDormantOwnerContinuationEvidence(observed);
  if (canonicalJson(left) !== canonicalJson(right)) invalid("live evidence drift");
  return right;
}

function requireLease(lease, observedAt) {
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.admission?.status !== "admitted" || !lease.taskAuthority
    || !lease.cloudAuthority?.claimId
    || Date.parse(lease.expiresAt) >= Date.parse(instant(observedAt, "observation time"))) {
    invalid("expired admitted source lease");
  }
  return lease;
}

function requireTombstone(value, lease, replacement) {
  if (!value || value.schema
      !== "agentic-active-dirty-scope-expansion-successor-rollover-local-receipt/v1"
    || value.status !== "pr-marker" || value.planDigest !== replacement.planDigest
    || value.replacementClaimId !== lease.cloudAuthority.claimId
    || value.leaseDigest !== writerLeaseDigest(lease)
    || value.taskAuthorityBindingDigest !== lease.taskAuthority.bindingDigest
    || !/^[0-9a-f]{64}$/u.test(value.receiptDigest || "")) invalid("rollover tombstone");
  return value;
}

function requirePullRequest(value, lease, continuation) {
  const marker = parseWriterLeasePullRequestBody(value?.body || "");
  const expected = projectWriterLeasePullRequestMarker(lease);
  const number = positive(value?.number, "pull-request number");
  if (value?.id !== lease.cloudAuthority.reviewRequestId
    || value.url !== lease.pullRequestUrl || value.state !== "OPEN" || value.isDraft !== true
    || value.autoMergeRequest !== null || value.headBranch !== lease.branch
    || value.headSha !== lease.fenceSha || value.baseSha !== continuation.historicalBindProof.sourceBaseSha
    || digestValue(marker) !== digestValue(expected)) invalid("draft pull-request projection");
  return deepFreeze({
    id: value.id, number, url: value.url, state: value.state, isDraft: true,
    autoMergeRequest: null, headBranch: value.headBranch, headSha: value.headSha,
    baseSha: value.baseSha, etag: text(value.etag, "pull-request entity tag"),
    bodyDigest: digestValue(value.body),
    bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(value.body)),
    markerDigest: digestValue(marker),
    markerClaimId: marker.cloudAuthority.claimId,
  });
}

function requireCloudTopology({ status, lease, promotionResult }) {
  if (status?.ok !== true || status.action !== "status" || !Array.isArray(status.claims)) {
    invalid("cloud inventory");
  }
  const anchor = exactClaim(status.claims, lease.cloudAuthority.claimId, "anchor");
  const bridge = exactClaim(status.claims, promotionResult.bridgeClaimId, "bridge");
  const successor = exactClaim(status.claims, promotionResult.successorClaimId, "successor");
  if (anchor.state !== "dormant-preserved" || anchor.writeAuthority !== false
    || anchor.scopeReserved !== true || anchor.laneRevision !== lease.fenceSha
    || anchor.writeSetDigest !== lease.admission.writeSetDigest
    || !["retired", "released"].includes(bridge.state)
    || !["current", "active"].includes(successor.state)
    || successor.scopeReserved !== true
    || writeSetsOverlap(
      normalizeWriteSet(successor.declaredWriteScope),
      lease.admission.declaredWriteSet,
    )) invalid("cloud owner topology");
  const overlaps = status.claims.filter(candidate => candidate.claimId !== anchor.claimId
    && candidate.scopeReserved !== false
    && !["retired", "released", "revoked"].includes(candidate.state)
    && writeSetsOverlap(
      normalizeWriteSet(candidate.declaredWriteScope),
      lease.admission.declaredWriteSet,
    ));
  if (overlaps.length) invalid("overlapping live cloud peer");
  const core = {
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    anchorClaimId: anchor.claimId,
    anchorClaimDigest: anchor.fenceRevision,
    anchorWriteSetDigest: anchor.writeSetDigest,
    anchorState: anchor.state,
    bridgeClaimId: bridge.claimId,
    bridgeState: bridge.state,
    successorClaimId: successor.claimId,
    successorClaimDigest: successor.fenceRevision,
    successorState: successor.state,
  };
  return deepFreeze({ ...core, topologyDigest: digestValue(core) });
}

function requireProtectedControllerAdvance(value, replacement, declaredWriteSet) {
  if (value?.schema
      !== "agentic-active-dirty-scope-expansion-successor-rollover-controller-advance/v1") {
    invalid("protected-controller advance schema");
  }
  const { evidenceDigest, ...core } = value;
  if (evidenceDigest !== digestValue(core)
    || value.sourceCanonicalBaseSha !== replacement.targetCanonicalBaseSha
    || value.clean !== true || value.controllerHeadSha !== value.controllerOriginMainSha
    || value.controllerHeadSha !== value.protectedMainSha
    || value.changedPaths.some(candidate => writeSetsOverlap(
      [`path:${candidate}`], declaredWriteSet,
    ))) invalid("protected-controller advance");
  return deepFreeze(structuredClone(value));
}

function exactClaim(claims, claimId, label) {
  const matches = claims.filter(candidate => candidate?.claimId === claimId);
  if (matches.length !== 1) invalid(`${label} cloud claim`);
  return matches[0];
}
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(value))) invalid(label); return value; }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Invalid dormant-owner continuation ${label}.`); }
