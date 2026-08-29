// Responsibility: Seal one expired F < R <= H lane and its exact raw device-review bind.
import { createHash } from "node:crypto";

import { listCurrentClaims } from "./cloud-collaboration-contract.mjs";
import {
  canonicalJson,
  digestValue,
  normalizeRootIntent,
  normalizeWriteSet,
  validateLedger,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  projectPublicClaim,
  pseudonymousIdentifier,
} from "./github-cloud-collaboration-mapping.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { parseWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";

export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-evidence/v1";
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_BIND_PROOF_SCHEMA =
  "agentic-expired-published-bind-ahead-device-review-ledger-proof/v1";

const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const CONTINUATION_RECEIPT_SCHEMA =
  "agentic-collaboration-continuation-receipt/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function buildExpiredPublishedBindAheadCleanDescendantRecoveryEvidence(
  input = {},
) {
  const observedAt = instant(input.observedAt, "observedAt");
  const committed = compactCommittedSnapshot(
    input.committedSnapshot ?? input.snapshot,
    observedAt,
  );
  const pullRequest = normalizePullRequest(input.pullRequest, committed);
  const cloud = proveExpiredPublishedBindAheadLedgerProjection({
    sourceLease: committed.sourceLease,
    pullRequest,
    ...record(input.cloud, "cloud input"),
  });
  const core = normalizeCore({
    schema: EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_EVIDENCE_SCHEMA,
    observedAt,
    repository: input.repository
      ?? committed.sourceLease.cloudAuthority.targetRepository,
    committed,
    pullRequest,
    cloud,
    mutationBoundary: input.mutationBoundary ?? defaultMutationBoundary(),
  });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeExpiredPublishedBindAheadCleanDescendantRecoveryEvidence(
  value,
) {
  const source = record(value, "evidence");
  const core = normalizeCore(source);
  const rebuilt = deepFreeze({ ...core, evidenceDigest: source.evidenceDigest });
  if (digest(source.evidenceDigest, "evidence digest") !== digestValue(core)
    || canonicalJson(source) !== canonicalJson(rebuilt)) {
    invalid("canonical evidence projection");
  }
  return rebuilt;
}

/**
 * Proves the raw append-only relationship. The source transport may end after
 * the source claim entry, and the current ledger may contain arbitrary valid
 * unrelated entries on either side of the bind entry.
 */
export function proveExpiredPublishedBindAheadLedgerProjection(input = {}) {
  const sourceLease = deepFreeze(structuredClone(record(
    input.sourceLease,
    "source lease",
  )));
  const pullRequest = record(input.pullRequest, "pull request");
  const authority = record(sourceLease.cloudAuthority, "source cloud authority");
  const source = rawLedgerSnapshot(input.sourceLedgerSnapshot, "source ledger");
  const current = rawLedgerSnapshot(input.currentLedgerSnapshot, "current ledger");
  requireLedgerPrefix(source.ledger, current.ledger);

  const evaluationTime = instant(
    input.evaluationTime,
    "cloud evaluation time",
  );
  const status = normalizeCloudStatus(input.status, current);
  const claimId = digest(authority.claimId, "source claim ID");
  const sourceEntry = source.ledger.entries.find(candidate => (
    candidate.claimId === claimId
      && candidate.digest === authority.claimLedgerRevision
  ));
  if (!sourceEntry
    || source.ledger.entries.findLast(candidate => candidate.claimId === claimId)
      ?.digest !== sourceEntry.digest) {
    invalid("latest same-claim source entry");
  }

  const sameClaimSuffix = current.ledger.entries
    .slice(source.ledger.entries.length)
    .filter(candidate => candidate.claimId === claimId);
  if (sameClaimSuffix.length !== 1) {
    invalid("one same-claim bind in the current ledger suffix");
  }
  const targetEntry = sameClaimSuffix[0];
  if (current.ledger.entries.findLast(candidate => candidate.claimId === claimId)
      ?.digest !== targetEntry.digest) {
    invalid("no later same-claim transition");
  }

  assertSourceAuthorityTransport({
    sourceLease,
    authority,
    source,
    sourceEntry,
    pullRequest,
  });
  assertProjectionEntry({ sourceEntry, targetEntry, pullRequest });

  const rawIdempotencyKey = [
    "device-review-bind",
    claimId,
    sourceEntry.claimCore.transitionCounter,
    sourceEntry.claimDigest,
    pullRequest.headSha,
  ].join(":");
  const idempotencyKey = digestValue(rawIdempotencyKey);
  if (targetEntry.idempotencyKey !== idempotencyKey) {
    invalid("raw device-review bind idempotency projection");
  }

  const normalizedRequest = projectionRequest({ sourceEntry, targetEntry, pullRequest });
  const { expectedLedgerDigest: _transportCas, ...semanticIntent } = normalizedRequest;
  const requestDigest = digestValue({ action: "continue", intent: semanticIntent });
  if (targetEntry.requestDigest !== requestDigest) {
    invalid("device-review bind semantic request digest");
  }
  const sourceOperationReceipt = operationReceiptForEntry(sourceEntry);
  const targetOperationReceipt = operationReceiptForEntry(targetEntry);
  if (authority.operationReceiptDigest !== sourceOperationReceipt.receiptDigest) {
    invalid("source operation receipt");
  }

  const claims = listCurrentClaims(current.ledger, evaluationTime);
  const publicClaims = claims.map(claim => deepFreeze(projectPublicClaim(claim)));
  const matches = publicClaims.filter(claim => claim.claimId === claimId);
  if (matches.length !== 1) invalid("one live bind-ahead claim");
  const liveClaim = matches[0];
  const suppliedLiveClaim = deepFreeze(structuredClone(record(
    input.liveClaim,
    "supplied live claim",
  )));
  if (canonicalJson(suppliedLiveClaim) !== canonicalJson(liveClaim)) {
    invalid("raw-ledger-derived live claim projection");
  }
  assertLiveBindClaim(liveClaim, targetEntry, targetOperationReceipt, pullRequest);

  const competitors = publicClaims.filter(claim => (
    claim.claimId !== claimId
      && claim.repositoryId === liveClaim.repositoryId
      && claim.scopeReserved === true
      && (
        claim.reviewRequestId === liveClaim.reviewRequestId
        || writeSetsOverlap(
          claim.declaredWriteScope,
          liveClaim.declaredWriteScope,
        )
      )
  ));
  if (competitors.length !== 0
    || input.noOverlappingCompetitor !== true
    || input.competitorCount !== 0) {
    invalid("no overlapping live competitor");
  }

  const sourceSummary = ledgerSummary(source);
  const currentSummary = ledgerSummary(current);
  const sourceTransportSuffixCount =
    source.ledger.sequence - sourceEntry.sequence;
  const unrelatedBetweenSourceAndBindCount =
    targetEntry.sequence - sourceEntry.sequence - 1;
  const unrelatedBetweenTransportAndBindCount =
    targetEntry.sequence - source.ledger.sequence - 1;
  const unrelatedAfterBindCount =
    current.ledger.sequence - targetEntry.sequence;
  if ([
    sourceTransportSuffixCount,
    unrelatedBetweenSourceAndBindCount,
    unrelatedBetweenTransportAndBindCount,
    unrelatedAfterBindCount,
  ].some(value => !Number.isSafeInteger(value) || value < 0)) {
    invalid("unrelated ledger suffix counts");
  }

  const ledgerPrefixProof = {
    schema: "agentic-raw-ledger-prefix-proof/v1",
    sourceEntriesDigest: sourceSummary.entriesDigest,
    currentSourcePrefixDigest: digestValue(
      current.ledger.entries.slice(0, source.ledger.entries.length),
    ),
    sourceEntryCount: source.ledger.entries.length,
    currentEntryCount: current.ledger.entries.length,
  };
  if (ledgerPrefixProof.sourceEntriesDigest
      !== ledgerPrefixProof.currentSourcePrefixDigest) {
    invalid("source/current raw ledger prefix");
  }

  const core = {
    schema: EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_BIND_PROOF_SCHEMA,
    evaluationTime,
    status,
    source: sourceSummary,
    current: currentSummary,
    sourceEntry: deepFreeze(structuredClone(sourceEntry)),
    targetEntry: deepFreeze(structuredClone(targetEntry)),
    sourceOperationReceipt,
    targetOperationReceipt,
    liveClaim,
    claimInventoryDigest: digestValue(publicClaims),
    inventoryDigest: digest(input.inventoryDigest, "cloud inventory digest"),
    verificationReceiptDigest: digest(
      input.verificationReceiptDigest,
      "cloud verification receipt digest",
    ),
    ledgerPrefixProof: deepFreeze({
      ...ledgerPrefixProof,
      proofDigest: digestValue(ledgerPrefixProof),
    }),
    rawIdempotencyKey,
    idempotencyKey,
    normalizedRequest: deepFreeze(normalizedRequest),
    requestDigest,
    sourceTransportSuffixCount,
    unrelatedBetweenSourceAndBindCount,
    unrelatedBetweenTransportAndBindCount,
    unrelatedAfterBindCount,
    noOverlappingCompetitor: true,
    competitorCount: 0,
  };
  return deepFreeze({ ...core, bindProofDigest: digestValue(core) });
}

function normalizeCore(value) {
  if (value.schema
      !== EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_EVIDENCE_SCHEMA) {
    invalid("schema");
  }
  const observedAt = instant(value.observedAt, "observedAt");
  const committed = normalizeCommittedProjection(value.committed, observedAt);
  const pullRequest = normalizePullRequest(value.pullRequest, committed);
  const cloud = normalizeBindProof(
    value.cloud,
    committed.sourceLease,
    pullRequest,
  );
  const mutationBoundary = normalizeMutationBoundary(value.mutationBoundary);
  if (cloud.targetEntry.claimCore.laneRevision !== committed.publishedHeadSha
    || cloud.sourceEntry.claimCore.laneRevision !== committed.sourceFenceSha
    || cloud.targetEntry.claimCore.transitionCounter
      !== cloud.sourceEntry.claimCore.transitionCounter + 1) {
    invalid("F-to-R cloud bind join");
  }
  return deepFreeze({
    schema: value.schema,
    observedAt,
    repository: text(value.repository, "repository"),
    committed,
    pullRequest,
    cloud,
    mutationBoundary,
  });
}

function compactCommittedSnapshot(value, observedAt) {
  const source = record(value, "committed snapshot");
  if (source.schema !== "agentic-expired-committed-heartbeat-snapshot/v3") {
    invalid("committed snapshot schema");
  }
  const snapshotCore = {};
  for (const key of [
    "schema", "branch", "sourceLeaseDigest", "sourceMarkerDigest",
    "pullRequestBodyDigest", "remoteHeadSha", "pullRequestHeadSha",
    "sourceRemotePrefix", "headSha", "treeSha", "changedPaths",
    "declaredChangedPaths", "protectedEquivalentPaths",
    "protectedMainEquivalence", "protectedMainEquivalenceDigest",
    "rangeDiffDigest",
  ]) snapshotCore[key] = source[key];
  if (digest(source.snapshotDigest, "committed snapshot digest")
      !== digestValue(snapshotCore)) {
    invalid("committed snapshot digest join");
  }
  const lease = deepFreeze(structuredClone(record(source.lease, "source lease")));
  if (digest(source.sourceLeaseDigest, "source lease digest")
      !== digestValue(lease)) {
    invalid("source lease digest join");
  }
  const taskBinding = assertTaskAuthorityBinding({
    binding: lease.taskAuthority,
    lease,
  });
  const recoveryEvidence = deepFreeze(structuredClone(record(
    source.recoveryEvidence,
    "committed recovery evidence",
  )));
  const sourceRemotePrefix = deepFreeze(structuredClone(record(
    source.sourceRemotePrefix,
    "source remote prefix",
  )));
  const core = {
    schema: "agentic-expired-published-bind-ahead-committed-proof/v1",
    snapshotDigest: source.snapshotDigest,
    sourceLease: lease,
    sourceLeaseDigest: source.sourceLeaseDigest,
    taskAuthorityBindingDigest: taskBinding.bindingDigest,
    branch: text(source.branch, "committed branch"),
    sourceFenceSha: sha(lease.fenceSha, "source fence SHA"),
    publishedHeadSha: sha(source.remoteHeadSha, "published head SHA"),
    localHeadSha: sha(source.headSha, "local head SHA"),
    localTreeSha: sha(source.treeSha, "local tree SHA"),
    sourceMarkerDigest: digest(source.sourceMarkerDigest, "source marker digest"),
    pullRequestBodyDigest: digest(
      source.pullRequestBodyDigest,
      "pull-request body digest",
    ),
    sourceRemotePrefixDigest: digestValue(sourceRemotePrefix),
    sourceToPublishedRangeDiffDigest: digest(
      sourceRemotePrefix.rangeDiffDigest,
      "source-to-published range diff",
    ),
    sourceToLocalRangeDiffDigest: digest(
      source.rangeDiffDigest,
      "source-to-local range diff",
    ),
    changedPathsDigest: digestValue(paths(source.changedPaths, "changed paths")),
    declaredChangedPathsDigest: digestValue(paths(
      source.declaredChangedPaths,
      "declared changed paths",
    )),
    protectedEquivalentPathsDigest: digestValue(paths(
      source.protectedEquivalentPaths,
      "protected-equivalent paths",
    )),
    protectedMainEquivalenceDigest: digest(
      source.protectedMainEquivalenceDigest,
      "protected-main equivalence digest",
    ),
    recoveryEvidenceDigest: digestValue(recoveryEvidence),
    strictSourceToPublished: true,
    publishedAtOrBeforeLocal: true,
  };
  assertCommittedRelations(core, observedAt, source, recoveryEvidence);
  return deepFreeze({ ...core, committedProofDigest: digestValue(core) });
}

function normalizeCommittedProjection(value, observedAt) {
  const source = record(value, "committed proof");
  const lease = deepFreeze(structuredClone(record(source.sourceLease, "source lease")));
  const core = {
    schema: source.schema,
    snapshotDigest: digest(source.snapshotDigest, "snapshot digest"),
    sourceLease: lease,
    sourceLeaseDigest: digest(source.sourceLeaseDigest, "source lease digest"),
    taskAuthorityBindingDigest: digest(
      source.taskAuthorityBindingDigest,
      "task-authority binding digest",
    ),
    branch: text(source.branch, "branch"),
    sourceFenceSha: sha(source.sourceFenceSha, "source fence SHA"),
    publishedHeadSha: sha(source.publishedHeadSha, "published head SHA"),
    localHeadSha: sha(source.localHeadSha, "local head SHA"),
    localTreeSha: sha(source.localTreeSha, "local tree SHA"),
    sourceMarkerDigest: digest(source.sourceMarkerDigest, "source marker digest"),
    pullRequestBodyDigest: digest(
      source.pullRequestBodyDigest,
      "pull-request body digest",
    ),
    sourceRemotePrefixDigest: digest(
      source.sourceRemotePrefixDigest,
      "source remote-prefix digest",
    ),
    sourceToPublishedRangeDiffDigest: digest(
      source.sourceToPublishedRangeDiffDigest,
      "source-to-published range diff",
    ),
    sourceToLocalRangeDiffDigest: digest(
      source.sourceToLocalRangeDiffDigest,
      "source-to-local range diff",
    ),
    changedPathsDigest: digest(source.changedPathsDigest, "changed-path digest"),
    declaredChangedPathsDigest: digest(
      source.declaredChangedPathsDigest,
      "declared changed-path digest",
    ),
    protectedEquivalentPathsDigest: digest(
      source.protectedEquivalentPathsDigest,
      "protected-equivalent path digest",
    ),
    protectedMainEquivalenceDigest: digest(
      source.protectedMainEquivalenceDigest,
      "protected-main equivalence digest",
    ),
    recoveryEvidenceDigest: digest(
      source.recoveryEvidenceDigest,
      "committed recovery-evidence digest",
    ),
    strictSourceToPublished: source.strictSourceToPublished === true,
    publishedAtOrBeforeLocal: source.publishedAtOrBeforeLocal === true,
  };
  if (core.schema !== "agentic-expired-published-bind-ahead-committed-proof/v1"
    || core.sourceLeaseDigest !== digestValue(lease)
    || lease.status !== "active"
    || lease.admission?.status !== "admitted"
    || lease.cloudAuthority?.state !== "active"
    || lease.cloudAuthority?.laneRevision !== core.sourceFenceSha
    || core.sourceFenceSha !== lease.fenceSha
    || core.branch !== lease.branch
    || core.sourceFenceSha === core.publishedHeadSha
    || !core.strictSourceToPublished
    || !core.publishedAtOrBeforeLocal
    || Date.parse(lease.expiresAt) > Date.parse(observedAt)) {
    invalid("committed F < R <= H projection");
  }
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  if (binding.bindingDigest !== core.taskAuthorityBindingDigest
    || source.committedProofDigest !== digestValue(core)) {
    invalid("committed proof digest or task binding");
  }
  return deepFreeze({ ...core, committedProofDigest: source.committedProofDigest });
}

function assertCommittedRelations(core, observedAt, raw, recoveryEvidence) {
  const lease = core.sourceLease;
  if (lease.status !== "active"
    || lease.admission?.status !== "admitted"
    || lease.cloudAuthority?.state !== "active"
    || lease.cloudAuthority?.laneRevision !== core.sourceFenceSha
    || lease.branch !== core.branch
    || raw.pullRequestHeadSha !== core.publishedHeadSha
    || raw.sourceRemotePrefix?.headSha !== core.publishedHeadSha
    || core.sourceFenceSha === core.publishedHeadSha
    || Date.parse(lease.expiresAt) > Date.parse(observedAt)
    || recoveryEvidence.sourceFenceSha !== core.sourceFenceSha
    || recoveryEvidence.sourceRemoteHeadSha !== core.publishedHeadSha
    || recoveryEvidence.headSha !== core.localHeadSha
    || recoveryEvidence.sourceClaimId !== lease.cloudAuthority.claimId
    || recoveryEvidence.sourceClaimDigest !== lease.cloudAuthority.claimDigest
    || recoveryEvidence.sourceClaimLedgerRevision
      !== lease.cloudAuthority.claimLedgerRevision
    || recoveryEvidence.sourceCloudTransitionCounter
      !== lease.cloudAuthority.transitionCounter
    || recoveryEvidence.sourceMarkerDigest !== core.sourceMarkerDigest
    || recoveryEvidence.pullRequestBodyDigest !== core.pullRequestBodyDigest
    || recoveryEvidence.rangeDiffDigest !== core.sourceToLocalRangeDiffDigest) {
    invalid("committed snapshot/lease/recovery joins");
  }
}

function normalizePullRequest(value, committed) {
  const source = record(value, "pull request");
  const sourceBody = string(
    source.sourceBody ?? source.body,
    "pull-request source body",
  );
  if (Buffer.byteLength(sourceBody, "utf8") > 65_536) {
    invalid("pull-request source body provider bound");
  }
  const marker = parseWriterLeasePullRequestBody(sourceBody);
  const bodyDigest = sha256(sourceBody);
  const markerDigest = digestValue(marker);
  const headRepository = source.headRepository?.nameWithOwner
    ?? source.headRepository;
  const headRepositoryId = source.headRepository?.id
    ?? source.headRepositoryId;
  const normalized = {
    id: text(source.id ?? source.nodeId, "pull-request ID"),
    number: positiveInteger(source.number, "pull-request number"),
    url: text(source.url, "pull-request URL"),
    title: text(source.title, "pull-request title"),
    state: source.state === "OPEN" ? "OPEN" : invalid("open pull request"),
    isDraft: source.isDraft === true,
    autoMergeRequest: source.autoMergeRequest ?? null,
    headRepositoryId: text(headRepositoryId, "head repository ID"),
    headRepository: text(headRepository, "head repository"),
    headBranch: text(source.headBranch ?? source.headRefName, "head branch"),
    headSha: sha(source.headSha ?? source.headRefOid, "pull-request head SHA"),
    baseBranch: text(source.baseBranch ?? source.baseRefName, "base branch"),
    baseSha: sha(source.baseSha ?? source.baseRefOid, "pull-request base SHA"),
    sourceBody,
    sourceBodyDigest: bodyDigest,
    visibleBodyDigest: visiblePullRequestBodyDigest(sourceBody),
    sourceMarkerDigest: markerDigest,
  };
  if (!normalized.isDraft || normalized.autoMergeRequest !== null
    || normalized.baseBranch !== "main"
    || normalized.headRepository
      !== committed.sourceLease.cloudAuthority.targetRepository
    || normalized.headBranch !== committed.branch
    || normalized.headSha !== committed.publishedHeadSha
    || normalized.url !== committed.sourceLease.pullRequestUrl
    || normalized.sourceBodyDigest !== committed.pullRequestBodyDigest
    || normalized.sourceMarkerDigest !== committed.sourceMarkerDigest
    || (source.sourceBodyDigest && source.sourceBodyDigest !== bodyDigest)
    || (source.sourceMarkerDigest && source.sourceMarkerDigest !== markerDigest)) {
    invalid("exact draft pull-request projection");
  }
  return deepFreeze(normalized);
}

export function visiblePullRequestBodyDigest(value) {
  const body = string(value, "pull-request body");
  const marker = /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu;
  const matches = body.match(marker) ?? [];
  if (matches.length !== 1) invalid("one hidden writer-lease marker");
  return sha256(body.replace(
    marker,
    "<!-- agentic-writer-lease/v2 [hidden] -->",
  ));
}

function assertSourceAuthorityTransport({
  sourceLease, authority, source, sourceEntry, pullRequest,
}) {
  const core = record(sourceEntry.claimCore, "source claim core");
  const identity = source.ledger.entries.find(candidate => (
    candidate.claimId === authority.claimId && candidate.action === "claim"
  ));
  if (!identity
    || sourceEntry.schema !== ENTRY_SCHEMA
    || sourceEntry.repositoryId !== core.repositoryId
    || sourceEntry.claimId !== authority.claimId
    || sourceEntry.claimDigest !== authority.claimDigest
    || sourceEntry.claimDigest !== digestValue(core)
    || sourceEntry.digest !== authority.claimLedgerRevision
    || sourceEntry.digest !== digestValue(withoutDigest(sourceEntry))
    || authority.ledgerRevision !== source.revision
    || authority.ledgerDigest !== source.ledger.headDigest
    || authority.entrySchema !== sourceEntry.schema
    || authority.claimIdentitySchema !== identity.schema
    || authority.canonicalBaseSha !== sourceLease.baseSha
    || authority.canonicalBaseSha !== core.canonicalBaseRevision
    || authority.laneRevision !== sourceLease.fenceSha
    || authority.laneRevision !== core.laneRevision
    || authority.writeSetDigest !== sourceLease.admission.writeSetDigest
    || authority.writeSetDigest !== core.writeSetDigest
    || canonicalJson(normalizeWriteSet(authority.cloudDeclaredWriteScope))
      !== canonicalJson(normalizeWriteSet(core.declaredWriteScope))
    || canonicalJson(normalizeWriteSet(core.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(
        sourceLease.admission.declaredWriteSet,
      ))
    || authority.leaseEpoch !== core.leaseEpoch
    || authority.transitionCounter !== core.transitionCounter
    || normalizeCounter(authority.heartbeatCounter) !== core.heartbeatCounter
    || authority.reviewRequestId !== core.reviewRequestId
    || authority.reviewRequestId !== `github-pull-request:${pullRequest.id}`
    || authority.expiresAt !== core.expiresAt
    || authority.state !== "active"
    || core.state !== "current"
    || core.deviceId !== pseudonymousIdentifier("device", sourceLease.device)
    || core.sessionId !== pseudonymousIdentifier("session", sourceLease.sessionId)
    || core.workItemId !== pseudonymousIdentifier("work-item", sourceLease.branch)
    || core.repositoryId !== `github-repository:${pullRequest.headRepositoryId}`) {
    invalid("source authority transport and claim-entry joins");
  }
}

function assertProjectionEntry({ sourceEntry, targetEntry, pullRequest }) {
  const source = record(sourceEntry.claimCore, "source claim core");
  const target = record(targetEntry.claimCore, "target claim core");
  const expectedTarget = {
    ...source,
    handoff: null,
    release: null,
    transitionCounter: source.transitionCounter + 1,
    state: "current",
    laneRevision: pullRequest.headSha,
    reviewRequestId: `github-pull-request:${pullRequest.id}`,
  };
  if (targetEntry.schema !== ENTRY_SCHEMA
    || targetEntry.action !== "continue"
    || targetEntry.repositoryId !== sourceEntry.repositoryId
    || targetEntry.claimId !== sourceEntry.claimId
    || targetEntry.sequence <= sourceEntry.sequence
    || Date.parse(targetEntry.evaluationTime) < Date.parse(sourceEntry.evaluationTime)
    || targetEntry.claimDigest !== digestValue(target)
    || targetEntry.digest !== digestValue(withoutDigest(targetEntry))
    || canonicalJson(target) !== canonicalJson(expectedTarget)) {
    invalid("exact tN+1 device-review projection entry");
  }
}

function assertLiveBindClaim(claim, entry, receipt, pullRequest) {
  const core = entry.claimCore;
  const expected = {
    claimId: core.claimId,
    entrySchema: entry.schema,
    claimIdentitySchema: ENTRY_SCHEMA,
    state: claim.state,
    writeAuthority: claim.state === "current",
    scopeReserved: true,
    actorId: core.actorId,
    deviceId: core.deviceId,
    sessionId: core.sessionId,
    repositoryId: core.repositoryId,
    workItemId: core.workItemId,
    canonicalBaseRevision: core.canonicalBaseRevision,
    laneRevision: core.laneRevision,
    declaredWriteScope: core.declaredWriteScope,
    writeSetDigest: core.writeSetDigest,
    leaseEpoch: core.leaseEpoch,
    transitionCounter: core.transitionCounter,
    heartbeatCounter: core.heartbeatCounter,
    reviewRequestId: core.reviewRequestId,
    predecessorClaimId: core.predecessorClaimId,
    expiresAt: core.expiresAt,
    fenceRevision: entry.claimDigest,
    transitionDigest: entry.digest,
    operationReceiptDigest: receipt.receiptDigest,
    integrationReceiptDigest: null,
    integration: core.integration ?? null,
    recovery: core.recovery ?? null,
  };
  if (!["current", "dormant-preserved"].includes(claim.state)
    || claim.scopeReserved !== true
    || claim.reviewRequestId !== `github-pull-request:${pullRequest.id}`
    || canonicalJson(claim) !== canonicalJson(expected)) {
    invalid("current-or-dormant exact bind claim");
  }
}

function normalizeBindProof(value, sourceLease, pullRequest) {
  const source = record(value, "bind proof");
  if (source.schema
      !== EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_BIND_PROOF_SCHEMA) {
    invalid("bind proof schema");
  }
  const sourceEntry = deepFreeze(structuredClone(record(
    source.sourceEntry,
    "source entry",
  )));
  const targetEntry = deepFreeze(structuredClone(record(
    source.targetEntry,
    "target entry",
  )));
  assertProjectionEntry({ sourceEntry, targetEntry, pullRequest });
  const expectedSourceReceipt = operationReceiptForEntry(sourceEntry);
  const expectedTargetReceipt = operationReceiptForEntry(targetEntry);
  if (canonicalJson(source.sourceOperationReceipt)
      !== canonicalJson(expectedSourceReceipt)
    || canonicalJson(source.targetOperationReceipt)
      !== canonicalJson(expectedTargetReceipt)
    || sourceLease.cloudAuthority.operationReceiptDigest
      !== expectedSourceReceipt.receiptDigest) {
    invalid("bind proof operation receipts");
  }
  const expectedRawKey = [
    "device-review-bind",
    sourceEntry.claimId,
    sourceEntry.claimCore.transitionCounter,
    sourceEntry.claimDigest,
    pullRequest.headSha,
  ].join(":");
  const expectedRequest = projectionRequest({ sourceEntry, targetEntry, pullRequest });
  const { expectedLedgerDigest: _transportCas, ...intent } = expectedRequest;
  const expectedRequestDigest = digestValue({ action: "continue", intent });
  if (source.rawIdempotencyKey !== expectedRawKey
    || source.idempotencyKey !== digestValue(expectedRawKey)
    || targetEntry.idempotencyKey !== source.idempotencyKey
    || source.requestDigest !== expectedRequestDigest
    || targetEntry.requestDigest !== expectedRequestDigest
    || canonicalJson(source.normalizedRequest) !== canonicalJson(expectedRequest)) {
    invalid("bind proof raw request/idempotency projection");
  }
  const liveClaim = deepFreeze(structuredClone(record(source.liveClaim, "live claim")));
  assertLiveBindClaim(liveClaim, targetEntry, expectedTargetReceipt, pullRequest);
  const sourceSummary = normalizeLedgerSummary(source.source, "source");
  const currentSummary = normalizeLedgerSummary(source.current, "current");
  const status = normalizeStoredStatus(source.status, currentSummary);
  const ledgerPrefixProof = normalizeLedgerPrefixProof(source.ledgerPrefixProof);
  if (ledgerPrefixProof.sourceEntriesDigest !== sourceSummary.entriesDigest
    || ledgerPrefixProof.sourceEntryCount !== sourceSummary.sequence
    || ledgerPrefixProof.currentEntryCount !== currentSummary.sequence
    || sourceEntry.sequence + source.sourceTransportSuffixCount
      !== sourceSummary.sequence
    || sourceEntry.sequence + source.unrelatedBetweenSourceAndBindCount + 1
      !== targetEntry.sequence
    || sourceSummary.sequence
      + source.unrelatedBetweenTransportAndBindCount + 1
      !== targetEntry.sequence
    || targetEntry.sequence + source.unrelatedAfterBindCount
      !== currentSummary.sequence) {
    invalid("bind proof ledger sequence relationships");
  }
  const core = {
    schema: source.schema,
    evaluationTime: instant(source.evaluationTime, "cloud evaluation time"),
    status,
    source: sourceSummary,
    current: currentSummary,
    sourceEntry,
    targetEntry,
    sourceOperationReceipt: expectedSourceReceipt,
    targetOperationReceipt: expectedTargetReceipt,
    liveClaim,
    claimInventoryDigest: digest(
      source.claimInventoryDigest,
      "claim inventory digest",
    ),
    inventoryDigest: digest(source.inventoryDigest, "inventory digest"),
    verificationReceiptDigest: digest(
      source.verificationReceiptDigest,
      "verification receipt digest",
    ),
    ledgerPrefixProof,
    rawIdempotencyKey: source.rawIdempotencyKey,
    idempotencyKey: source.idempotencyKey,
    normalizedRequest: deepFreeze(expectedRequest),
    requestDigest: source.requestDigest,
    sourceTransportSuffixCount: nonnegativeInteger(
      source.sourceTransportSuffixCount,
      "source transport suffix count",
    ),
    unrelatedBetweenSourceAndBindCount: nonnegativeInteger(
      source.unrelatedBetweenSourceAndBindCount,
      "source/bind unrelated count",
    ),
    unrelatedBetweenTransportAndBindCount: nonnegativeInteger(
      source.unrelatedBetweenTransportAndBindCount,
      "transport/bind unrelated count",
    ),
    unrelatedAfterBindCount: nonnegativeInteger(
      source.unrelatedAfterBindCount,
      "post-bind unrelated count",
    ),
    noOverlappingCompetitor: source.noOverlappingCompetitor === true,
    competitorCount: nonnegativeInteger(source.competitorCount, "competitor count"),
  };
  if (!core.noOverlappingCompetitor || core.competitorCount !== 0
    || source.bindProofDigest !== digestValue(core)) {
    invalid("bind proof digest or competitor disposition");
  }
  return deepFreeze({ ...core, bindProofDigest: source.bindProofDigest });
}

function projectionRequest({ sourceEntry, targetEntry, pullRequest }) {
  const prior = sourceEntry.claimCore;
  return normalizeRootIntent("continue", {
    claimId: sourceEntry.claimId,
    expectedFenceRevision: sourceEntry.claimDigest,
    expectedTransitionCounter: prior.transitionCounter,
    expectedLedgerDigest: targetEntry.parentDigest,
    mode: "projection",
    laneRevision: pullRequest.headSha,
    reviewRequestId: `github-pull-request:${pullRequest.id}`,
    expiresAt: null,
    focusedEvidenceDigest: null,
    handoffEvidenceDigest: null,
    recoveryEvidenceDigest: null,
  }, {
    actorId: prior.actorId,
    deviceId: prior.deviceId,
    sessionId: prior.sessionId,
  }, prior.repositoryId);
}

function operationReceiptForEntry(entry) {
  const action = entry.action;
  const schemas = {
    claim: "agentic-collaboration-claim-receipt/v1",
    continue: CONTINUATION_RECEIPT_SCHEMA,
  };
  if (!schemas[action]) invalid("source operation receipt action");
  const core = {
    schema: schemas[action],
    operation: action,
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
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function rawLedgerSnapshot(value, label) {
  const source = record(value, label);
  const revision = sha(source.revision, `${label} revision`);
  const ledger = deepFreeze(structuredClone(record(source.ledger, `${label} value`)));
  const failures = validateLedger(ledger);
  if (failures.length !== 0 || ledger.entries.length !== ledger.sequence) {
    throw new Error(
      `Expired published bind-ahead recovery has invalid ${label}: ${failures.join("; ")}`,
    );
  }
  return deepFreeze({ revision, ledger });
}

function requireLedgerPrefix(prefix, current) {
  if (prefix.entries.length > current.entries.length
    || digestValue(prefix.entries)
      !== digestValue(current.entries.slice(0, prefix.entries.length))) {
    invalid("raw source ledger prefix");
  }
}

function ledgerSummary(snapshot) {
  return deepFreeze({
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    sequence: snapshot.ledger.sequence,
    entriesDigest: digestValue(snapshot.ledger.entries),
  });
}

function normalizeLedgerSummary(value, label) {
  return deepFreeze({
    ledgerRevision: sha(value?.ledgerRevision, `${label} ledger revision`),
    ledgerDigest: digest(value?.ledgerDigest, `${label} ledger digest`),
    sequence: nonnegativeInteger(value?.sequence, `${label} ledger sequence`),
    entriesDigest: digest(value?.entriesDigest, `${label} entries digest`),
  });
}

function normalizeCloudStatus(value, current) {
  const status = record(value, "cloud status");
  const normalized = {
    ledgerRevision: sha(status.ledgerRevision, "cloud status ledger revision"),
    ledgerDigest: digest(status.ledgerDigest, "cloud status ledger digest"),
    sequence: nonnegativeInteger(status.sequence, "cloud status sequence"),
  };
  if (normalized.ledgerRevision !== current.revision
    || normalized.ledgerDigest !== current.ledger.headDigest
    || normalized.sequence !== current.ledger.sequence) {
    invalid("current raw ledger/status join");
  }
  return deepFreeze(normalized);
}

function normalizeStoredStatus(value, current) {
  const status = {
    ledgerRevision: sha(value?.ledgerRevision, "stored status ledger revision"),
    ledgerDigest: digest(value?.ledgerDigest, "stored status ledger digest"),
    sequence: nonnegativeInteger(value?.sequence, "stored status sequence"),
  };
  if (status.ledgerRevision !== current.ledgerRevision
    || status.ledgerDigest !== current.ledgerDigest
    || status.sequence !== current.sequence) {
    invalid("stored current ledger/status join");
  }
  return deepFreeze(status);
}

function normalizeLedgerPrefixProof(value) {
  const source = record(value, "ledger prefix proof");
  const core = {
    schema: source.schema,
    sourceEntriesDigest: digest(
      source.sourceEntriesDigest,
      "source entries digest",
    ),
    currentSourcePrefixDigest: digest(
      source.currentSourcePrefixDigest,
      "current source-prefix digest",
    ),
    sourceEntryCount: nonnegativeInteger(
      source.sourceEntryCount,
      "source entry count",
    ),
    currentEntryCount: nonnegativeInteger(
      source.currentEntryCount,
      "current entry count",
    ),
  };
  if (core.schema !== "agentic-raw-ledger-prefix-proof/v1"
    || core.sourceEntriesDigest !== core.currentSourcePrefixDigest
    || source.proofDigest !== digestValue(core)) {
    invalid("ledger prefix proof");
  }
  return deepFreeze({ ...core, proofDigest: source.proofDigest });
}

function defaultMutationBoundary() {
  return {
    allowedMutations: [
      "same-claim-dormant-recovery",
      "same-claim-projection-horizon-renewal",
      "writer-registry-branch-controller-fence",
      "writer-registry-branch-controller-fence-release-after-complete",
      "writer-lease-continuation-cas",
      "pull-request-hidden-marker-projection",
      "private-replay-journal",
    ],
    forbiddenEffects: [
      "device-review-bind-replay",
      "cloud-review-transition",
      "source-mutation",
      "git-mutation",
      "index-mutation",
      "local-ref-mutation",
      "remote-ref-mutation",
      "pull-request-state-mutation",
      "pull-request-visible-body-mutation",
      "new-claim",
      "new-pull-request",
      "integration",
      "release",
      "deployment",
      "cleanup",
    ],
  };
}

function normalizeMutationBoundary(value) {
  const source = record(value, "mutation boundary");
  const expected = defaultMutationBoundary();
  if (canonicalJson(source) !== canonicalJson(expected)) {
    invalid("mutation boundary");
  }
  return deepFreeze(structuredClone(expected));
}

function withoutDigest(value) {
  const { digest: _digest, ...draft } = record(value, "ledger entry");
  return draft;
}

function normalizeCounter(value) {
  return value === null || value === undefined ? 0 : value;
}

function paths(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const normalized = [...new Set(value.map(item => text(item, label)))].sort();
  if (canonicalJson(value) !== canonicalJson(normalized)) invalid(`${label} order`);
  return deepFreeze(normalized);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function string(value, label) {
  if (typeof value !== "string") invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString() !== value) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
function invalid(label) {
  throw new Error(
    `Expired published bind-ahead clean-descendant evidence has invalid ${label}.`,
  );
}
