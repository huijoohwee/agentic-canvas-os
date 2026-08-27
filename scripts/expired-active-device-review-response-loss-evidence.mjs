// Responsibility: Seal the exact local, provider, task-binding, and already-reviewed cloud subject.
import path from "node:path";

import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeBoundAuthority }
  from "./scoped-lane-cloud-reconciliation.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function buildExpiredActiveDeviceReviewResponseLossEvidence(value = {}) {
  return normalizeEvidence(value, { acceptDigest: false });
}

export function normalizeExpiredActiveDeviceReviewResponseLossEvidence(value) {
  return normalizeEvidence(value, { acceptDigest: true });
}

function normalizeEvidence(value, { acceptDigest }) {
  const source = record(value, "evidence");
  exactKeys(source, [
    "observedAt",
    "repository",
    "worktree",
    "sourceLease",
    "sourceLeaseDigest",
    "migration",
    "sourceMarker",
    "cloud",
    "pullRequest",
    "projections",
    ...(acceptDigest && Object.hasOwn(source, "evidenceDigest") ? ["evidenceDigest"] : []),
  ], "evidence");
  const observedAt = instant(source.observedAt, "observed at");
  const repository = normalizeRepository(source.repository);
  const sourceLease = deepFreeze(structuredClone(record(source.sourceLease, "source lease")));
  const sourceLeaseDigest = digest(source.sourceLeaseDigest, "source lease digest");
  if (digestValue(sourceLease) !== sourceLeaseDigest) invalid("source lease digest join");
  const worktree = normalizeWorktree(source.worktree);
  const migration = normalizeMigration(source.migration);
  const sourceMarker = normalizeSourceMarker(source.sourceMarker);
  const cloud = normalizeCloud(source.cloud);
  const pullRequest = normalizePullRequest(source.pullRequest);
  const projections = normalizeProjections(source.projections);

  assertCrossDomainIdentity({ repository, worktree, sourceLease, pullRequest });
  assertSourceLease({ sourceLease, observedAt, worktree, migration, repository });
  assertSourceMarker({ sourceLease, sourceMarker, pullRequest });
  assertReviewedCloud({ sourceLease, cloud, pullRequest });
  assertTerminalProjections({
    sourceLease,
    cloud,
    pullRequest,
    projections,
  });

  const core = deepFreeze({
    observedAt,
    repository,
    worktree,
    sourceLease,
    sourceLeaseDigest,
    migration,
    sourceMarker,
    cloud,
    pullRequest,
    projections,
  });
  const evidenceDigest = digestValue(core);
  if (acceptDigest && Object.hasOwn(source, "evidenceDigest")
    && source.evidenceDigest !== evidenceDigest) {
    invalid("evidence digest");
  }
  return deepFreeze({ ...core, evidenceDigest });
}

function assertCrossDomainIdentity({ repository, worktree, sourceLease, pullRequest }) {
  if (sourceLease.worktreePath !== repository.path
    || sourceLease.pullRequestUrl !== pullRequest.url
    || sourceLease.reviewHeadSha != null
    || sourceLease.branch !== pullRequest.headBranch
    || sourceLease.branch !== worktree.branch
    || sourceLease.fenceSha !== pullRequest.headSha
    || sourceLease.fenceSha !== worktree.headSha
    || sourceLease.baseSha !== pullRequest.baseSha
    || pullRequest.headRepository !== repository.nameWithOwner
    || sourceLease.cloudAuthority?.targetRepository !== pullRequest.headRepository) {
    invalid("cross-domain source/provider identity");
  }
}

function normalizeRepository(value) {
  exactKeys(value, ["path", "nameWithOwner"], "repository");
  const repositoryPath = text(value.path, "repository path");
  if (!path.isAbsolute(repositoryPath) || path.normalize(repositoryPath) !== repositoryPath) {
    invalid("absolute normalized repository path");
  }
  return deepFreeze({
    path: repositoryPath,
    nameWithOwner: text(value.nameWithOwner, "repository name"),
  });
}

function normalizeWorktree(value) {
  exactKeys(value, [
    "branch", "headSha", "treeSha", "localRefSha", "remoteRefSha",
    "registered", "clean", "statusDigest", "indexDigest",
  ], "worktree");
  if (value.registered !== true || value.clean !== true) invalid("clean registered worktree");
  return deepFreeze({
    branch: text(value.branch, "worktree branch"),
    headSha: sha(value.headSha, "worktree HEAD"),
    treeSha: sha(value.treeSha, "worktree tree"),
    localRefSha: sha(value.localRefSha, "local branch ref"),
    remoteRefSha: sha(value.remoteRefSha, "remote branch ref"),
    registered: true,
    clean: true,
    statusDigest: digest(value.statusDigest, "worktree status digest"),
    indexDigest: digest(value.indexDigest, "worktree index digest"),
  });
}

function normalizeMigration(value) {
  exactKeys(value, [
    "planDigest", "targetBindingDigest", "taskAuthorityCapabilitySubject",
    "bindingMode", "boundAt",
  ], "migration");
  if (value.bindingMode !== "migration") invalid("migration binding mode");
  return deepFreeze({
    planDigest: digest(value.planDigest, "migration plan digest"),
    targetBindingDigest: digest(value.targetBindingDigest, "migration target binding digest"),
    taskAuthorityCapabilitySubject: text(
      value.taskAuthorityCapabilitySubject,
      "task-authority capability subject",
    ),
    bindingMode: "migration",
    boundAt: instant(value.boundAt, "migration bound at"),
  });
}

function normalizeSourceMarker(value) {
  exactKeys(value, [
    "marker", "markerDigest", "projectedWithoutTaskAuthorityDigest",
    "taskAuthorityAbsent",
  ], "source marker");
  if (value.taskAuthorityAbsent !== true) invalid("source marker task-authority absence");
  return deepFreeze({
    marker: deepFreeze(structuredClone(record(value.marker, "source marker value"))),
    markerDigest: digest(value.markerDigest, "source marker digest"),
    projectedWithoutTaskAuthorityDigest: digest(
      value.projectedWithoutTaskAuthorityDigest,
      "pre-migration marker projection digest",
    ),
    taskAuthorityAbsent: true,
  });
}

function normalizeCloud(value) {
  exactKeys(value, [
    "status", "claim", "sourceEntry", "reviewedEntry", "targetAuthority",
    "targetAuthorityDigest", "ledgerValidation", "ledgerValidationDigest",
    "laterTargetTransitionCount",
    "noOverlappingCompetitor", "competitorCount",
  ], "cloud");
  exactKeys(value.status, ["ledgerRevision", "ledgerDigest", "sequence"], "cloud status");
  if (value.noOverlappingCompetitor !== true || value.competitorCount !== 0) {
    invalid("cloud competitor disposition");
  }
  if (value.laterTargetTransitionCount !== 0) invalid("later target transition count");
  const claim = deepFreeze(structuredClone(record(value.claim, "cloud claim")));
  const sourceEntry = deepFreeze(structuredClone(record(
    value.sourceEntry,
    "source ledger entry",
  )));
  const reviewedEntry = deepFreeze(structuredClone(record(
    value.reviewedEntry,
    "reviewed ledger entry",
  )));
  const targetAuthority = deepFreeze(structuredClone(record(
    value.targetAuthority,
    "target cloud authority",
  )));
  const targetAuthorityDigest = digest(
    value.targetAuthorityDigest,
    "target cloud-authority digest",
  );
  if (digestValue(targetAuthority) !== targetAuthorityDigest) {
    invalid("target cloud-authority digest join");
  }
  const ledgerValidation = deepFreeze(structuredClone(record(
    value.ledgerValidation,
    "ledger validation",
  )));
  exactKeys(ledgerValidation, [
    "schema", "ledgerRevision", "ledgerDigest", "sequence", "entryCount",
    "validated", "failureCount", "targetLatestSequence", "sourceLedgerRevision",
    "sourceLedgerDigest", "sourceSequence", "sourceEntryDigest", "sourceEntryCount",
    "sourceValidated",
  ], "ledger validation");
  if (ledgerValidation.schema
      !== "agentic-expired-active-device-review-ledger-validation/v1"
    || ledgerValidation.validated !== true || ledgerValidation.failureCount !== 0
    || ledgerValidation.ledgerRevision !== value.status.ledgerRevision
    || ledgerValidation.ledgerDigest !== value.status.ledgerDigest
    || ledgerValidation.sequence !== value.status.sequence
    || !Number.isSafeInteger(ledgerValidation.entryCount)
    || ledgerValidation.entryCount !== ledgerValidation.sequence
    || !Number.isSafeInteger(ledgerValidation.targetLatestSequence)
    || ledgerValidation.targetLatestSequence !== reviewedEntry.sequence
    || !SHA_PATTERN.test(String(ledgerValidation.sourceLedgerRevision || ""))
    || ledgerValidation.sourceLedgerDigest !== sourceEntry.digest
    || ledgerValidation.sourceEntryDigest !== sourceEntry.digest
    || !Number.isSafeInteger(ledgerValidation.sourceSequence)
    || ledgerValidation.sourceSequence !== sourceEntry.sequence
    || !Number.isSafeInteger(ledgerValidation.sourceEntryCount)
    || ledgerValidation.sourceEntryCount !== ledgerValidation.sourceSequence
    || ledgerValidation.sourceValidated !== true) {
    invalid("ledger validation receipt");
  }
  const ledgerValidationDigest = digest(
    value.ledgerValidationDigest,
    "ledger validation digest",
  );
  if (ledgerValidationDigest !== digestValue(ledgerValidation)) {
    invalid("ledger validation digest join");
  }
  return deepFreeze({
    status: deepFreeze({
      ledgerRevision: sha(value.status.ledgerRevision, "cloud ledger revision"),
      ledgerDigest: digest(value.status.ledgerDigest, "cloud ledger digest"),
      sequence: nonnegativeInteger(value.status.sequence, "cloud sequence"),
    }),
    claim,
    sourceEntry,
    reviewedEntry,
    targetAuthority,
    targetAuthorityDigest,
    ledgerValidation,
    ledgerValidationDigest,
    laterTargetTransitionCount: 0,
    noOverlappingCompetitor: true,
    competitorCount: 0,
  });
}

function normalizePullRequest(value) {
  exactKeys(value, [
    "id", "number", "url", "state", "isDraft", "autoMergeRequest", "title",
    "headRepository", "headBranch", "headSha", "baseBranch", "baseSha",
    "sourceBody", "sourceBodyDigest", "sourceMarkerDigest",
  ], "pull request");
  if (value.state !== "OPEN" || value.isDraft !== true || value.autoMergeRequest !== null
    || value.baseBranch !== "main") invalid("open draft pull request");
  const sourceBody = string(value.sourceBody, "pull-request source body");
  return deepFreeze({
    id: text(value.id, "pull-request ID"),
    number: positiveInteger(value.number, "pull-request number"),
    url: text(value.url, "pull-request URL"),
    state: "OPEN",
    isDraft: true,
    autoMergeRequest: null,
    title: text(value.title, "pull-request title"),
    headRepository: text(value.headRepository, "pull-request head repository"),
    headBranch: text(value.headBranch, "pull-request head branch"),
    headSha: sha(value.headSha, "pull-request head SHA"),
    baseBranch: "main",
    baseSha: sha(value.baseSha, "pull-request base SHA"),
    sourceBody,
    sourceBodyDigest: joinedDigest(value.sourceBodyDigest, sourceBody, "source body"),
    sourceMarkerDigest: digest(value.sourceMarkerDigest, "source marker digest"),
  });
}

function normalizeProjections(value) {
  exactKeys(value, [
    "targetLease", "targetLeaseDigest", "targetMarker", "targetMarkerDigest",
    "targetBody", "targetBodyDigest", "targetProviderState",
    "targetProviderStateDigest", "targetRegistryRevision",
  ], "projections");
  const targetLease = deepFreeze(structuredClone(record(value.targetLease, "target lease")));
  const targetMarker = deepFreeze(structuredClone(record(value.targetMarker, "target marker")));
  const targetBody = string(value.targetBody, "target pull-request body");
  if (Buffer.byteLength(targetBody, "utf8") > 65_536) {
    invalid("target pull-request body provider bound");
  }
  const targetProviderState = deepFreeze(structuredClone(record(
    value.targetProviderState,
    "target provider state",
  )));
  return deepFreeze({
    targetLease,
    targetLeaseDigest: joinedDigest(value.targetLeaseDigest, targetLease, "target lease"),
    targetMarker,
    targetMarkerDigest: joinedDigest(value.targetMarkerDigest, targetMarker, "target marker"),
    targetBody,
    targetBodyDigest: joinedDigest(value.targetBodyDigest, targetBody, "target body"),
    targetProviderState,
    targetProviderStateDigest: joinedDigest(
      value.targetProviderStateDigest,
      targetProviderState,
      "target provider state",
    ),
    targetRegistryRevision: positiveInteger(
      value.targetRegistryRevision,
      "target registry revision",
    ),
  });
}

function assertSourceLease({ sourceLease, observedAt, worktree, migration, repository }) {
  if (sourceLease.schema !== "agentic-writer-lease/v2"
    || sourceLease.status !== "active"
    || sourceLease.admission?.status !== "admitted"
    || sourceLease.cloudAuthority?.state !== "active"
    || sourceLease.cloudAuthority?.transitionCounter !== 3
    || sourceLease.cloudAuthority?.integration !== null
    || sourceLease.cloudAuthority?.integrationReceiptDigest !== null
    || sourceLease.integration != null
    || Date.parse(sourceLease.expiresAt) >= Date.parse(observedAt)
    || sourceLease.branch !== worktree.branch
    || sourceLease.fenceSha !== worktree.headSha
    || worktree.localRefSha !== worktree.headSha
    || worktree.remoteRefSha !== worktree.headSha
    || sourceLease.cloudAuthority.laneRevision !== worktree.headSha
    || sourceLease.cloudAuthority.canonicalBaseSha !== sourceLease.baseSha
    || sourceLease.cloudAuthority.targetRepository !== repository.nameWithOwner) {
    invalid("expired active admitted source lease fence");
  }
  const binding = assertTaskAuthorityBinding({
    binding: sourceLease.taskAuthority,
    lease: sourceLease,
  });
  if (binding.bindingMode !== "migration"
    || binding.priorBindingDigest !== null
    || binding.bindingDigest !== migration.targetBindingDigest
    || binding.transitionPlanDigest !== migration.planDigest
    || binding.authoritySubjectId !== migration.taskAuthorityCapabilitySubject
    || binding.boundAt !== migration.boundAt) {
    invalid("migrated task-authority binding");
  }
}

function assertSourceMarker({ sourceLease, sourceMarker, pullRequest }) {
  const { taskAuthority: _taskAuthority, ...preMigrationLease } = sourceLease;
  const expected = projectWriterLeasePullRequestMarker(preMigrationLease);
  const parsed = parseWriterLeasePullRequestBody(pullRequest.sourceBody);
  if (Object.hasOwn(sourceMarker.marker, "taskAuthority")
    || canonicalJson(sourceMarker.marker) !== canonicalJson(expected)
    || canonicalJson(parsed) !== canonicalJson(expected)
    || sourceMarker.markerDigest !== digestValue(expected)
    || sourceMarker.projectedWithoutTaskAuthorityDigest !== digestValue(expected)
    || pullRequest.sourceMarkerDigest !== sourceMarker.markerDigest) {
    invalid("pre-migration marker-only projection gap");
  }
}

function assertReviewedCloud({ sourceLease, cloud, pullRequest }) {
  const sourceAuthority = sourceLease.cloudAuthority;
  const claim = cloud.claim;
  const sourceEntry = cloud.sourceEntry;
  const entry = cloud.reviewedEntry;
  const prior = sourceEntry.claimCore;
  const core = entry.claimCore;
  assertSourceAuthorityJoins({
    sourceLease,
    sourceAuthority,
    sourceEntry,
    prior,
    ledgerValidation: cloud.ledgerValidation,
  });
  const reviewedOperationReceipt = {
    schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue",
    status: "reviewed",
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
  assertPublicReviewedClaimProjection({ claim, entry, core, reviewedOperationReceipt });
  const allowedInventoryStates = new Set(["reviewed", "dormant-preserved"]);
  if (!allowedInventoryStates.has(claim.state)
    || claim.writeAuthority !== false
    || claim.scopeReserved !== true
    || claim.claimId !== sourceAuthority.claimId
    || claim.transitionCounter !== 4
    || claim.transitionCounter !== sourceAuthority.transitionCounter + 1
    || claim.heartbeatCounter !== 0
    || claim.canonicalBaseRevision !== sourceLease.baseSha
    || claim.laneRevision !== sourceLease.fenceSha
    || claim.writeSetDigest !== sourceLease.admission.writeSetDigest
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(sourceLease.admission.declaredWriteSet))
    || claim.leaseEpoch !== sourceAuthority.leaseEpoch
    || claim.reviewRequestId !== sourceAuthority.reviewRequestId
    || claim.reviewRequestId !== `github-pull-request:${pullRequest.id}`
    || claim.integration !== null
    || claim.integrationReceiptDigest !== null
    || !DIGEST_PATTERN.test(String(claim.operationReceiptDigest || ""))) {
    invalid("already-recorded reviewed cloud claim");
  }
  const expectedFocusedEvidenceDigest = digestValue({
    schema: "agentic-focused-review-evidence/v1",
    command: "npm run check",
    branch: sourceLease.branch,
    headSha: sourceLease.fenceSha,
    pullRequestNumber: pullRequest.number,
    admittedReportDigest: sourceLease.admission.admittedReportDigest,
  });
  const sourceDraft = withoutDigest(sourceEntry);
  const reviewedDraft = withoutDigest(entry);
  if (sourceEntry.schema !== "agentic-cloud-collaboration-entry/v2"
    || sourceEntry.action !== "continue"
    || sourceEntry.claimId !== claim.claimId
    || sourceEntry.digest !== sourceAuthority.claimLedgerRevision
    || sourceEntry.digest !== sourceAuthority.ledgerDigest
    || sourceEntry.claimDigest !== sourceAuthority.claimDigest
    || sourceEntry.claimDigest !== digestValue(prior)
    || sourceEntry.digest !== digestValue(sourceDraft)
    || prior?.state !== "current"
    || prior.transitionCounter !== 3
    || prior.evidenceDigest !== null
    || entry.parentDigest !== sourceEntry.digest
    || entry.sequence !== sourceEntry.sequence + 1
    || Date.parse(entry.evaluationTime) < Date.parse(sourceEntry.evaluationTime)
    || entry.claimDigest !== digestValue(core)
    || entry.digest !== digestValue(reviewedDraft)
    || !DIGEST_PATTERN.test(String(entry.idempotencyKey || ""))
    || !DIGEST_PATTERN.test(String(entry.requestDigest || ""))
    || entry.idempotencyKey === sourceEntry.idempotencyKey
    || core.evidenceDigest !== expectedFocusedEvidenceDigest
    || digestValue(reviewedOperationReceipt) !== claim.operationReceiptDigest) {
    invalid("direct reviewed ledger edge");
  }
  const stablePrior = stableReviewTransitionCore(prior);
  const stableReviewed = stableReviewTransitionCore(core);
  if (canonicalJson(stablePrior) !== canonicalJson(stableReviewed)
    || prior.actorId !== core.actorId
    || prior.deviceId !== core.deviceId
    || prior.sessionId !== core.sessionId
    || prior.repositoryId !== core.repositoryId
    || prior.workItemId !== core.workItemId
    || prior.canonicalBaseRevision !== core.canonicalBaseRevision
    || canonicalJson(prior.declaredWriteScope) !== canonicalJson(core.declaredWriteScope)
    || prior.writeSetDigest !== core.writeSetDigest
    || prior.laneRevision !== core.laneRevision
    || prior.leaseEpoch !== core.leaseEpoch
    || prior.heartbeatCounter !== core.heartbeatCounter
    || prior.expiresAt !== core.expiresAt
    || prior.predecessorClaimId !== core.predecessorClaimId
    || prior.eligibleSince !== core.eligibleSince
    || canonicalJson(prior.handoff ?? null) !== canonicalJson(core.handoff ?? null)
    || canonicalJson(prior.release ?? null) !== canonicalJson(core.release ?? null)
    || canonicalJson(prior.recovery ?? null) !== canonicalJson(core.recovery ?? null)
    || canonicalJson(prior.integration ?? null) !== canonicalJson(core.integration ?? null)
    || canonicalJson(prior.retirement ?? null) !== canonicalJson(core.retirement ?? null)) {
    invalid("review transition stable identity");
  }
  if (entry.schema !== "agentic-cloud-collaboration-entry/v2"
    || entry.action !== "continue"
    || entry.claimId !== claim.claimId
    || entry.digest !== claim.transitionDigest
    || entry.claimDigest !== claim.fenceRevision
    || core?.state !== "reviewed"
    || core.transitionCounter !== 4
    || core.claimId !== claim.claimId
    || core.laneRevision !== claim.laneRevision
    || core.canonicalBaseRevision !== claim.canonicalBaseRevision
    || core.writeSetDigest !== claim.writeSetDigest
    || core.reviewRequestId !== claim.reviewRequestId
    || core.leaseEpoch !== claim.leaseEpoch
    || core.heartbeatCounter !== claim.heartbeatCounter) {
    invalid("direct reviewed transition evidence");
  }
  const authority = cloud.targetAuthority;
  let expectedAuthority;
  try {
    expectedAuthority = Object.freeze({
      ...normalizeBoundAuthority({
        result: {
          claim,
          claimDigest: claim.fenceRevision,
          ledgerRevision: cloud.status.ledgerRevision,
          ledgerDigest: cloud.status.ledgerDigest,
        },
        authority: sourceAuthority,
        manifest: sourceLease.admission,
        deviceId: sourceLease.device,
        sessionId: sourceLease.sessionId,
        focusedEvidenceDigest: expectedFocusedEvidenceDigest,
      }),
      state: "review_ready",
      manifestDigest: sourceAuthority.manifestDigest,
    });
  } catch {
    invalid("target authority deterministic projection");
  }
  if (canonicalJson(authority) !== canonicalJson(expectedAuthority)) {
    invalid("target authority deterministic projection");
  }
}

function assertSourceAuthorityJoins({
  sourceLease,
  sourceAuthority,
  sourceEntry,
  prior,
  ledgerValidation,
}) {
  exactKeys(sourceAuthority, [
    "schema", "provider", "ledgerRepository", "targetRepository", "claimId",
    "claimDigest", "ledgerRevision", "ledgerDigest", "claimLedgerRevision",
    "entrySchema", "claimIdentitySchema", "operationReceiptDigest",
    "mutationAuthorityEligible", "canonicalBaseSha", "laneRevision",
    "cloudDeclaredWriteScope", "writeSetDigest", "deviceId", "sessionId",
    "reviewRequestId", "leaseEpoch", "transitionCounter",
    ...(Object.hasOwn(sourceAuthority, "heartbeatCounter") ? ["heartbeatCounter"] : []),
    "state", "expiresAt", "integrationReceiptDigest", "integration",
    "manifestDigest",
  ], "source authority");
  exactKeys(prior, [
    "claimId", "actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "canonicalBaseRevision", "declaredWriteScope", "writeSetDigest", "laneRevision",
    "leaseEpoch", "transitionCounter", "heartbeatCounter", "state", "expiresAt",
    "evidenceDigest", "reviewRequestId", "predecessorClaimId", "eligibleSince",
    "handoff", "release",
  ], "source t3 claim core");
  const expectedOperationReceipt = {
    schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue",
    status: "current",
    repositoryId: sourceEntry.repositoryId,
    claimId: sourceEntry.claimId,
    claimDigest: sourceEntry.claimDigest,
    fenceRevision: sourceEntry.claimDigest,
    ledgerRevision: sourceEntry.digest,
    ledgerSequence: sourceEntry.sequence,
    idempotencyKey: sourceEntry.idempotencyKey,
    requestDigest: sourceEntry.requestDigest,
    evaluationTime: sourceEntry.evaluationTime,
  };
  const expectedDeviceId = normalizeCloudIdentifier("device", sourceLease.device);
  const expectedSessionId = normalizeCloudIdentifier("session", sourceLease.sessionId);
  const expectedWorkItemId = normalizeCloudIdentifier("work-item", sourceLease.branch);
  const sourceWriteScope = normalizeWriteSet(sourceLease.admission.declaredWriteSet);
  if (sourceAuthority.schema !== "agentic-lane-cloud-authority/v1"
    || sourceAuthority.provider !== "github"
    || typeof sourceAuthority.ledgerRepository !== "string"
    || !sourceAuthority.ledgerRepository
    || !SHA_PATTERN.test(String(sourceAuthority.ledgerRevision || ""))
    || sourceAuthority.entrySchema !== sourceEntry.schema
    || sourceAuthority.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || sourceAuthority.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || sourceEntry.repositoryId !== prior.repositoryId
    || sourceAuthority.claimId !== prior.claimId
    || sourceAuthority.claimId !== sourceEntry.claimId
    || sourceAuthority.claimDigest !== sourceEntry.claimDigest
    || sourceAuthority.claimLedgerRevision !== sourceEntry.digest
    || sourceAuthority.ledgerDigest !== sourceEntry.digest
    || ledgerValidation.sourceLedgerRevision !== sourceAuthority.ledgerRevision
    || ledgerValidation.sourceLedgerDigest !== sourceAuthority.ledgerDigest
    || sourceAuthority.operationReceiptDigest !== digestValue(expectedOperationReceipt)
    || sourceAuthority.mutationAuthorityEligible !== true
    || sourceAuthority.canonicalBaseSha !== prior.canonicalBaseRevision
    || sourceAuthority.canonicalBaseSha !== sourceLease.baseSha
    || sourceAuthority.laneRevision !== prior.laneRevision
    || sourceAuthority.laneRevision !== sourceLease.fenceSha
    || canonicalJson(normalizeWriteSet(sourceAuthority.cloudDeclaredWriteScope))
      !== canonicalJson(sourceWriteScope)
    || canonicalJson(normalizeWriteSet(prior.declaredWriteScope))
      !== canonicalJson(sourceWriteScope)
    || sourceAuthority.writeSetDigest !== prior.writeSetDigest
    || sourceAuthority.writeSetDigest !== sourceLease.admission.writeSetDigest
    || sourceLease.admission.semanticScope !== sourceLease.scope
    || sourceAuthority.manifestDigest !== sourceLease.admission.manifestDigest
    || sourceAuthority.deviceId !== sourceLease.device
    || sourceAuthority.sessionId !== sourceLease.sessionId
    || normalizeCloudIdentifier("device", prior.deviceId) !== expectedDeviceId
    || normalizeCloudIdentifier("session", prior.sessionId) !== expectedSessionId
    || prior.workItemId !== expectedWorkItemId
    || sourceAuthority.reviewRequestId !== prior.reviewRequestId
    || sourceAuthority.leaseEpoch !== prior.leaseEpoch
    || sourceAuthority.transitionCounter !== prior.transitionCounter
    || normalizeHeartbeatCounter(sourceAuthority.heartbeatCounter) !== prior.heartbeatCounter
    || sourceAuthority.state !== "active"
    || prior.state !== "current"
    || prior.evidenceDigest !== null
    || prior.predecessorClaimId !== null
    || prior.eligibleSince !== null
    || prior.handoff !== null
    || prior.release !== null
    || sourceAuthority.expiresAt !== prior.expiresAt
    || sourceAuthority.expiresAt !== sourceLease.expiresAt
    || sourceAuthority.integration !== null
    || sourceAuthority.integrationReceiptDigest !== null) {
    invalid("source authority provenance and receipt joins");
  }
}

function assertPublicReviewedClaimProjection({ claim, entry, core, reviewedOperationReceipt }) {
  const allowedInventoryStates = new Set(["reviewed", "dormant-preserved"]);
  const expected = {
    claimId: core.claimId,
    entrySchema: entry.schema,
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: claim.state,
    writeAuthority: false,
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
    operationReceiptDigest: digestValue(reviewedOperationReceipt),
    integrationReceiptDigest: null,
    integration: core.integration ?? null,
    recovery: core.recovery ?? null,
  };
  if (!allowedInventoryStates.has(claim.state)
    || canonicalJson(claim) !== canonicalJson(expected)) {
    invalid("public reviewed claim projection");
  }
}

function stableReviewTransitionCore(value) {
  const copy = structuredClone(record(value, "review transition core"));
  for (const field of ["state", "transitionCounter", "evidenceDigest", "reviewRequestId"]) {
    delete copy[field];
  }
  return copy;
}

function normalizeCloudIdentifier(namespace, value) {
  const candidate = text(value, `${namespace} identity`);
  const prefix = `${namespace}:`;
  return candidate.startsWith(prefix) && DIGEST_PATTERN.test(candidate.slice(prefix.length))
    ? candidate
    : `${namespace}:${digestValue({ namespace, value: candidate })}`;
}

function normalizeHeartbeatCounter(value) {
  return value === null || value === undefined ? 0 : value;
}

function withoutDigest(value) {
  const { digest: _digest, ...draft } = record(value, "ledger entry");
  return draft;
}

function assertTerminalProjections({
  sourceLease,
  cloud,
  pullRequest,
  projections,
}) {
  const expectedLease = {
    ...sourceLease,
    status: "review_ready",
    reviewHeadSha: sourceLease.fenceSha,
    cloudAuthority: cloud.targetAuthority,
  };
  const expectedMarker = projectWriterLeasePullRequestMarker(expectedLease);
  const expectedBody = updateWriterLeasePullRequestBody(
    pullRequest.sourceBody,
    expectedLease,
  );
  const expectedProviderState = {
    id: pullRequest.id,
    number: pullRequest.number,
    url: pullRequest.url,
    state: "OPEN",
    isDraft: false,
    autoMergeRequest: null,
    title: pullRequest.title,
    headRepository: pullRequest.headRepository,
    headBranch: pullRequest.headBranch,
    headSha: pullRequest.headSha,
    baseBranch: pullRequest.baseBranch,
    baseSha: pullRequest.baseSha,
  };
  if (canonicalJson(projections.targetLease) !== canonicalJson(expectedLease)
    || canonicalJson(projections.targetMarker) !== canonicalJson(expectedMarker)
    || projections.targetBody !== expectedBody
    || canonicalJson(projections.targetProviderState) !== canonicalJson(expectedProviderState)) {
    invalid("deterministic terminal projection");
  }
}

function joinedDigest(value, subject, label) {
  const normalized = digest(value, `${label} digest`);
  if (normalized !== digestValue(subject)) invalid(`${label} digest join`);
  return normalized;
}
function exactKeys(value, keys, label) {
  record(value, label);
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    invalid(`${label} fields`);
  }
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
  if (typeof value !== "string" || !value.trim()) invalid(label);
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
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) invalid(label);
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
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(
    `Expired active device-review response-loss evidence has invalid ${label}.`,
  );
}
