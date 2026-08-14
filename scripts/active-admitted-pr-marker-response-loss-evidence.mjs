// Responsibility: Prove one active admitted marker is exactly one sealed heartbeat behind its lease.
import {
  digestValue,
  normalizeRootIntent,
  validateLedger,
} from "./cloud-collaboration-primitives.mjs";

export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_EVIDENCE_SCHEMA =
  "agentic-active-admitted-pr-marker-response-loss-evidence/v1";

const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const PROVIDER_SEMANTICS = "observable-pre-read-edit-post-read";

export function buildActiveAdmittedPrMarkerResponseLossEvidence(input = {}) {
  const sourceAuthority = object(input.sourceAuthority, "source marker cloud authority");
  const targetAuthority = object(input.targetAuthority, "target lease cloud authority");
  const source = ledgerSnapshot(input.sourceLedgerSnapshot, "source ledger");
  const target = ledgerSnapshot(input.targetLedgerSnapshot, "target ledger");
  const current = ledgerSnapshot(input.currentLedgerSnapshot, "current ledger");
  const live = liveCloud(input.liveCloud, current);
  const renewal = proveRenewal({ sourceAuthority, targetAuthority, source, target, current, live });
  const core = normalizeCore({
    schema: ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_EVIDENCE_SCHEMA,
    repository: text(input.repository, "repository"),
    observedAt: instant(input.observedAt, "observedAt"),
    worktree: input.worktree,
    lease: input.lease,
    providerReview: input.providerReview,
    renewal,
    mutationBoundary: input.mutationBoundary || defaultMutationBoundary(),
  });
  assertJoinedSubject(core, sourceAuthority, targetAuthority);
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeActiveAdmittedPrMarkerResponseLossEvidence(value) {
  const source = object(value, "evidence");
  const core = normalizeCore(source);
  const rebuilt = { ...core, evidenceDigest: source.evidenceDigest };
  if (source.evidenceDigest !== digestValue(core)) invalid("evidence digest");
  if (digestValue(source) !== digestValue(rebuilt)) invalid("canonical evidence projection");
  return Object.freeze(rebuilt);
}

function proveRenewal({ sourceAuthority, targetAuthority, source, target, current, live }) {
  requireLedgerPrefix(source.ledger, target.ledger, "source-to-target");
  requireLedgerPrefix(target.ledger, current.ledger, "target-to-current");
  const claimId = digest(sourceAuthority.claimId, "source claim ID");
  if (targetAuthority.claimId !== claimId || live.claim.claimId !== claimId) invalid("claim identity");
  const sourceEntry = latestClaimEntry(source.ledger, claimId, "source");
  const targetEntry = latestClaimEntry(target.ledger, claimId, "target");
  const appended = target.ledger.entries.slice(source.ledger.entries.length)
    .filter(entry => entry.claimId === claimId);
  const later = current.ledger.entries.slice(target.ledger.entries.length)
    .filter(entry => entry.claimId === claimId);
  if (appended.length !== 1 || appended[0].digest !== targetEntry.digest) {
    invalid("single same-claim renewal suffix");
  }
  if (later.length !== 0 || latestClaimEntry(current.ledger, claimId, "current").digest !== targetEntry.digest) {
    invalid("later same-claim transition");
  }
  if (sourceEntry.schema !== ENTRY_SCHEMA || targetEntry.schema !== ENTRY_SCHEMA
    || sourceEntry.action !== "continue" || targetEntry.action !== "continue") {
    invalid("renewal entry kind");
  }
  assertAuthorityEntry(sourceAuthority, source, sourceEntry, "source");
  assertAuthorityEntry(targetAuthority, target, targetEntry, "target");
  assertLiveClaim(live.claim, targetEntry);
  const sourceCore = sourceEntry.claimCore;
  const targetCore = targetEntry.claimCore;
  if (targetCore.transitionCounter !== sourceCore.transitionCounter + 1
    || targetCore.heartbeatCounter !== sourceCore.heartbeatCounter + 1
    || Date.parse(targetCore.expiresAt) <= Date.parse(sourceCore.expiresAt)
    || digestValue(stableClaimCore(targetCore)) !== digestValue(stableClaimCore(sourceCore))) {
    invalid("one exact heartbeat renewal");
  }
  const idempotencyKey = digestValue([
    "device-heartbeat",
    claimId,
    sourceCore.transitionCounter,
    sourceEntry.claimDigest,
  ].join(":"));
  if (targetEntry.idempotencyKey !== idempotencyKey) invalid("heartbeat idempotency key");
  const requestDigest = renewalRequestDigest({ sourceEntry, targetEntry });
  if (targetEntry.requestDigest !== requestDigest) invalid("heartbeat request digest");
  const sourceReceiptDigest = continuationReceiptDigest(sourceEntry);
  const targetReceiptDigest = continuationReceiptDigest(targetEntry);
  if (sourceAuthority.operationReceiptDigest !== sourceReceiptDigest
    || targetAuthority.operationReceiptDigest !== targetReceiptDigest
    || live.claim.operationReceiptDigest !== targetReceiptDigest) invalid("operation receipt");
  if (digestValue(stableAuthority(targetAuthority)) !== digestValue(stableAuthority(sourceAuthority))) {
    invalid("stable cloud authority");
  }
  const core = {
    claimId,
    sourceAuthorityDigest: digestValue(sourceAuthority),
    targetAuthorityDigest: digestValue(targetAuthority),
    source: authorityPoint(sourceAuthority, source, sourceEntry),
    target: authorityPoint(targetAuthority, target, targetEntry),
    current: {
      ledgerRevision: current.revision,
      ledgerDigest: current.ledger.headDigest,
      inventoryDigest: live.inventoryDigest,
      verificationReceiptDigest: live.verificationReceiptDigest,
      claimRecordDigest: digestValue(live.claim),
      unrelatedSuffixEntryCount: current.ledger.entries.length - target.ledger.entries.length,
      noOverlappingCompetitor: true,
    },
    renewalEntryDigest: targetEntry.digest,
    renewalIdempotencyDigest: idempotencyKey,
    renewalRequestDigest: requestDigest,
    renewalOperationReceiptDigest: targetReceiptDigest,
  };
  return Object.freeze({ ...core, renewalProofDigest: digestValue(core) });
}

function normalizeCore(value) {
  if (value.schema !== ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_EVIDENCE_SCHEMA) invalid("schema");
  const worktree = object(value.worktree, "worktree");
  const lease = object(value.lease, "lease");
  const review = object(value.providerReview, "provider review");
  const renewal = normalizeRenewal(value.renewal);
  const boundary = object(value.mutationBoundary, "mutation boundary");
  const core = {
    schema: value.schema,
    repository: text(value.repository, "repository"),
    observedAt: instant(value.observedAt, "observedAt"),
    worktree: {
      identityDigest: digest(worktree.identityDigest, "worktree identity digest"),
      branch: text(worktree.branch, "worktree branch"),
      headSha: sha(worktree.headSha, "worktree head"),
      treeSha: sha(worktree.treeSha, "worktree tree"),
      remoteHeadSha: sha(worktree.remoteHeadSha, "remote head"),
      protectedMainSha: sha(worktree.protectedMainSha, "protected main"),
      statusDigest: digest(worktree.statusDigest, "worktree status digest"),
      registered: worktree.registered === true,
      clean: worktree.clean === true,
    },
    lease: {
      leaseDigest: digest(lease.leaseDigest, "lease digest"),
      cloudAuthorityDigest: digest(lease.cloudAuthorityDigest, "cloud authority digest"),
      admissionDigest: digest(lease.admissionDigest, "admission digest"),
      taskAuthorityBindingDigest: digest(lease.taskAuthorityBindingDigest, "task binding digest"),
      cloudClaimId: digest(lease.cloudClaimId, "lease cloud claim ID"),
      cloudTransitionCounter: positiveInteger(
        lease.cloudTransitionCounter,
        "lease cloud transition",
      ),
      cloudHeartbeatCounter: nonnegativeInteger(
        lease.cloudHeartbeatCounter,
        "lease cloud heartbeat",
      ),
      status: lease.status === "active" ? "active" : invalid("lease status"),
      sessionId: text(lease.sessionId, "lease session"),
      deviceId: text(lease.deviceId, "lease device"),
      scope: text(lease.scope, "lease scope"),
      branch: text(lease.branch, "lease branch"),
      epoch: positiveInteger(lease.epoch, "lease epoch"),
      baseSha: sha(lease.baseSha, "lease base"),
      fenceSha: sha(lease.fenceSha, "lease fence"),
      heartbeatAt: instant(lease.heartbeatAt, "lease heartbeat"),
      expiresAt: instant(lease.expiresAt, "lease expiry"),
      providerReviewUrl: text(lease.providerReviewUrl, "provider review URL"),
    },
    providerReview: {
      adapterId: text(review.adapterId, "provider adapter"),
      id: text(review.id, "provider review ID"),
      url: text(review.url, "provider review URL"),
      state: review.state === "open" ? "open" : invalid("provider review state"),
      draft: review.draft === true,
      autoDeliveryAbsent: review.autoDeliveryAbsent === true,
      headRepository: text(review.headRepository, "provider head repository"),
      headBranch: text(review.headBranch, "provider head branch"),
      headSha: sha(review.headSha, "provider head"),
      baseBranch: text(review.baseBranch, "provider base branch"),
      baseSha: sha(review.baseSha, "provider base"),
      sourceBodyDigest: digest(review.sourceBodyDigest, "source body digest"),
      sourceMarkerDigest: digest(review.sourceMarkerDigest, "source marker digest"),
      targetBodyDigest: digest(review.targetBodyDigest, "target body digest"),
      targetMarkerDigest: digest(review.targetMarkerDigest, "target marker digest"),
      mutationSemantics: review.mutationSemantics === PROVIDER_SEMANTICS
        ? PROVIDER_SEMANTICS : invalid("provider mutation semantics"),
    },
    renewal,
    mutationBoundary: {
      providerReviewBody: true,
      git: false,
      writerRegistry: false,
      cloudLedger: false,
      sourceBytes: false,
      authoringAuthority: false,
      integration: false,
      release: false,
      deployment: false,
    },
  };
  if (boundary.providerReviewBody !== true
    || ["git", "writerRegistry", "cloudLedger", "sourceBytes", "authoringAuthority",
      "integration", "release", "deployment"].some(field => boundary[field] !== false)
    || !core.worktree.registered || !core.worktree.clean || !core.providerReview.draft
    || !core.providerReview.autoDeliveryAbsent || !core.mutationBoundary.providerReviewBody
    || core.worktree.branch !== core.lease.branch
    || core.worktree.headSha !== core.worktree.remoteHeadSha
    || core.worktree.headSha !== core.lease.fenceSha
    || core.providerReview.headBranch !== core.lease.branch
    || core.providerReview.headSha !== core.lease.fenceSha
    || core.providerReview.url !== core.lease.providerReviewUrl
    || core.providerReview.sourceMarkerDigest === core.providerReview.targetMarkerDigest
    || core.providerReview.sourceBodyDigest === core.providerReview.targetBodyDigest
    || core.renewal.claimId !== core.lease.cloudClaimId
    || core.renewal.targetAuthorityDigest !== core.lease.cloudAuthorityDigest
    || core.renewal.target.transitionCounter !== core.lease.cloudTransitionCounter
    || core.renewal.target.heartbeatCounter !== core.lease.cloudHeartbeatCounter
    || core.renewal.target.expiresAt !== core.lease.expiresAt
    || Date.parse(core.observedAt) >= Date.parse(core.lease.expiresAt)) {
    invalid("marker-only recovery boundary");
  }
  return core;
}

function normalizeRenewal(value) {
  const source = object(value, "renewal evidence");
  const core = {
    claimId: digest(source.claimId, "renewal claim ID"),
    sourceAuthorityDigest: digest(source.sourceAuthorityDigest, "source authority digest"),
    targetAuthorityDigest: digest(source.targetAuthorityDigest, "target authority digest"),
    source: normalizePoint(source.source, "source"),
    target: normalizePoint(source.target, "target"),
    current: {
      ledgerRevision: sha(source.current?.ledgerRevision, "current ledger revision"),
      ledgerDigest: digest(source.current?.ledgerDigest, "current ledger digest"),
      inventoryDigest: digest(source.current?.inventoryDigest, "current inventory digest"),
      verificationReceiptDigest: digest(source.current?.verificationReceiptDigest, "verification receipt digest"),
      claimRecordDigest: digest(source.current?.claimRecordDigest, "current claim record digest"),
      unrelatedSuffixEntryCount: nonnegativeInteger(source.current?.unrelatedSuffixEntryCount, "unrelated suffix count"),
      noOverlappingCompetitor: source.current?.noOverlappingCompetitor === true,
    },
    renewalEntryDigest: digest(source.renewalEntryDigest, "renewal entry digest"),
    renewalIdempotencyDigest: digest(source.renewalIdempotencyDigest, "renewal idempotency digest"),
    renewalRequestDigest: digest(source.renewalRequestDigest, "renewal request digest"),
    renewalOperationReceiptDigest: digest(source.renewalOperationReceiptDigest, "renewal operation receipt"),
  };
  if (!core.current.noOverlappingCompetitor || source.renewalProofDigest !== digestValue(core)) {
    invalid("renewal proof digest");
  }
  if (core.target.transitionCounter !== core.source.transitionCounter + 1
    || core.target.heartbeatCounter !== core.source.heartbeatCounter + 1
    || Date.parse(core.target.expiresAt) <= Date.parse(core.source.expiresAt)
    || core.sourceAuthorityDigest === core.targetAuthorityDigest
    || core.source.ledgerRevision === core.target.ledgerRevision
    || core.source.claimDigest === core.target.claimDigest
    || core.target.claimLedgerRevision !== core.renewalEntryDigest
    || core.target.operationReceiptDigest !== core.renewalOperationReceiptDigest) {
    invalid("renewal proof relationship");
  }
  return Object.freeze({ ...core, renewalProofDigest: source.renewalProofDigest });
}

function normalizePoint(value, label) {
  return {
    ledgerRevision: sha(value?.ledgerRevision, `${label} ledger revision`),
    ledgerDigest: digest(value?.ledgerDigest, `${label} ledger digest`),
    claimDigest: digest(value?.claimDigest, `${label} claim digest`),
    claimLedgerRevision: digest(value?.claimLedgerRevision, `${label} claim ledger revision`),
    operationReceiptDigest: digest(value?.operationReceiptDigest, `${label} operation receipt`),
    transitionCounter: positiveInteger(value?.transitionCounter, `${label} transition`),
    heartbeatCounter: nonnegativeInteger(value?.heartbeatCounter, `${label} heartbeat`),
    expiresAt: instant(value?.expiresAt, `${label} expiry`),
  };
}

function ledgerSnapshot(value, label) {
  const snapshot = object(value, label);
  const revision = sha(snapshot.revision, `${label} revision`);
  const failures = validateLedger(snapshot.ledger);
  if (failures.length) throw new Error(`Active admitted marker response-loss ${label} is invalid: ${failures.join("; ")}`);
  return Object.freeze({ revision, ledger: snapshot.ledger });
}

function liveCloud(value, current) {
  const live = object(value, "live cloud evidence");
  if (live.status !== "ready" || live.noOverlappingCompetitor !== true
    || live.ledgerRevision !== current.revision || live.ledgerDigest !== current.ledger.headDigest) {
    invalid("live cloud inventory");
  }
  return {
    claim: object(live.claim, "live cloud claim"),
    inventoryDigest: digest(live.inventoryDigest, "live inventory digest"),
    verificationReceiptDigest: digest(live.verificationReceiptDigest, "live verification receipt"),
  };
}

function assertJoinedSubject(evidence, sourceAuthority, targetAuthority) {
  if (evidence.worktree.branch !== evidence.lease.branch
    || evidence.worktree.headSha !== evidence.worktree.remoteHeadSha
    || evidence.worktree.headSha !== evidence.lease.fenceSha
    || evidence.providerReview.headBranch !== evidence.lease.branch
    || evidence.providerReview.headSha !== evidence.lease.fenceSha
    || evidence.providerReview.url !== evidence.lease.providerReviewUrl
    || evidence.lease.cloudAuthorityDigest !== digestValue(targetAuthority)
    || evidence.renewal.claimId !== targetAuthority.claimId
    || evidence.providerReview.sourceMarkerDigest === evidence.providerReview.targetMarkerDigest
    || evidence.providerReview.sourceBodyDigest === evidence.providerReview.targetBodyDigest
    || Date.parse(evidence.observedAt) >= Date.parse(evidence.lease.expiresAt)
    || digestValue(sourceAuthority) === digestValue(targetAuthority)) invalid("joined recovery subject");
}

function assertAuthorityEntry(authority, snapshot, entry, label) {
  const core = entry.claimCore;
  if (authority.ledgerRevision !== snapshot.revision
    || authority.ledgerDigest !== snapshot.ledger.headDigest
    || authority.claimDigest !== entry.claimDigest
    || authority.claimLedgerRevision !== entry.digest
    || authority.claimId !== entry.claimId
    || authority.transitionCounter !== core.transitionCounter
    || authority.heartbeatCounter !== core.heartbeatCounter
    || authority.expiresAt !== core.expiresAt
    || authority.laneRevision !== core.laneRevision
    || authority.leaseEpoch !== core.leaseEpoch
    || authority.writeSetDigest !== core.writeSetDigest) invalid(`${label} authority projection`);
}

function assertLiveClaim(claim, entry) {
  const core = entry.claimCore;
  const stableFields = [
    "actorId", "repositoryId", "workItemId", "canonicalBaseRevision", "laneRevision",
    "writeSetDigest", "leaseEpoch", "reviewRequestId", "predecessorClaimId",
  ];
  if (!['active', 'current'].includes(claim.state) || claim.writeAuthority !== true
    || claim.scopeReserved !== true || claim.claimId !== entry.claimId
    || claim.fenceRevision !== entry.claimDigest || claim.transitionDigest !== entry.digest
    || claim.transitionCounter !== core.transitionCounter
    || claim.heartbeatCounter !== core.heartbeatCounter || claim.expiresAt !== core.expiresAt
    || claim.operationReceiptDigest !== continuationReceiptDigest(entry)
    || stableFields.some(field => (claim[field] ?? null) !== (core[field] ?? null))
    || digestValue(claim.declaredWriteScope) !== digestValue(core.declaredWriteScope)) {
    invalid("live target claim");
  }
}

function authorityPoint(authority, snapshot, entry) {
  return {
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    claimDigest: entry.claimDigest,
    claimLedgerRevision: entry.digest,
    operationReceiptDigest: authority.operationReceiptDigest,
    transitionCounter: entry.claimCore.transitionCounter,
    heartbeatCounter: entry.claimCore.heartbeatCounter,
    expiresAt: entry.claimCore.expiresAt,
  };
}

function stableClaimCore(core) {
  const { transitionCounter, heartbeatCounter, expiresAt, ...stable } = core;
  return stable;
}

function stableAuthority(authority) {
  const dynamic = new Set(["claimDigest", "ledgerRevision", "ledgerDigest", "claimLedgerRevision",
    "operationReceiptDigest", "transitionCounter", "heartbeatCounter", "expiresAt"]);
  return Object.fromEntries(Object.entries(authority).filter(([key]) => !dynamic.has(key)));
}

function renewalRequestDigest({ sourceEntry, targetEntry }) {
  const prior = sourceEntry.claimCore;
  const normalized = normalizeRootIntent("continue", {
    claimId: sourceEntry.claimId,
    expectedFenceRevision: sourceEntry.claimDigest,
    expectedTransitionCounter: prior.transitionCounter,
    expectedLedgerDigest: targetEntry.parentDigest,
    mode: "renewal",
    laneRevision: null,
    reviewRequestId: null,
    expiresAt: targetEntry.claimCore.expiresAt,
    focusedEvidenceDigest: null,
    handoffEvidenceDigest: null,
    recoveryEvidenceDigest: null,
  }, {
    actorId: prior.actorId,
    deviceId: prior.deviceId,
    sessionId: prior.sessionId,
  }, prior.repositoryId);
  const { expectedLedgerDigest: _expectedLedgerDigest, ...intent } = normalized;
  return digestValue({ action: "continue", intent });
}

function continuationReceiptDigest(entry) {
  const receipt = {
    schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue",
    status: entry.claimCore.state,
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
  return digestValue(receipt);
}

function latestClaimEntry(ledger, claimId, label) {
  const entry = ledger.entries.findLast(candidate => candidate.claimId === claimId);
  if (!entry) invalid(`${label} claim entry`);
  return entry;
}

function requireLedgerPrefix(prefix, complete, label) {
  if (prefix.entries.length > complete.entries.length
    || digestValue(prefix.entries) !== digestValue(complete.entries.slice(0, prefix.entries.length))) {
    invalid(`${label} ledger prefix`);
  }
}

function defaultMutationBoundary() {
  return { providerReviewBody: true, git: false, writerRegistry: false, cloudLedger: false,
    sourceBytes: false, authoringAuthority: false, integration: false, release: false, deployment: false };
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function instant(value, label) { if (!value || new Date(value).toISOString() !== value) invalid(label); return value; }
function positiveInteger(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function nonnegativeInteger(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function invalid(label) { throw new Error(`Active admitted PR-marker response-loss evidence has invalid ${label}.`); }
