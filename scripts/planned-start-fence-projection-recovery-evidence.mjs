// Responsibility: Seal the stable, read-only subject of one planned-start fence projection.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

export const PLANNED_START_FENCE_PROJECTION_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-planned-start-fence-projection-recovery-evidence/v1";

export function buildPlannedStartFenceProjectionRecoveryEvidence(input = {}) {
  const core = normalizeCore({
    schema: PLANNED_START_FENCE_PROJECTION_RECOVERY_EVIDENCE_SCHEMA,
    repository: input.repository,
    observedAt: input.observedAt,
    leaseObservations: input.leaseObservations,
    cloudObservations: input.cloudObservations,
    gitObservations: input.gitObservations,
    pullRequestObservations: input.pullRequestObservations,
    taskCapabilityDigest: input.taskCapabilityDigest,
    mutationBoundary: input.mutationBoundary ?? defaultMutationBoundary(),
  });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizePlannedStartFenceProjectionRecoveryEvidence(value) {
  const source = record(value, "evidence");
  const core = normalizeCore(source);
  const rebuilt = deepFreeze({ ...core, evidenceDigest: source.evidenceDigest });
  if (digest(source.evidenceDigest, "evidence digest") !== digestValue(core)
    || canonicalJson(source) !== canonicalJson(rebuilt)) invalid("canonical evidence");
  return rebuilt;
}

function normalizeCore(value) {
  if (value.schema !== PLANNED_START_FENCE_PROJECTION_RECOVERY_EVIDENCE_SCHEMA) invalid("schema");
  const leaseObservations = stablePair(value.leaseObservations, normalizeLease, "lease observations");
  const cloudObservations = stablePair(
    value.cloudObservations,
    normalizeCloud,
    "cloud observations",
    stableCloudIdentity,
  );
  const gitObservations = stablePair(value.gitObservations, normalizeGit, "Git observations");
  const pullRequestObservations = stablePair(
    value.pullRequestObservations,
    normalizePullRequest,
    "pull-request observations",
  );
  const sourceLease = leaseObservations[0];
  const sourceCloudAuthority = sourceLease.cloudAuthority;
  const targetCloudObservation = cloudObservations[0];
  const targetCloudAuthority = projectTargetAuthority(sourceCloudAuthority, targetCloudObservation);
  const descendant = deepFreeze({
    descendantDigest: gitObservations[0].authoredDescendantDigest,
    headSha: gitObservations[0].localHeadSha,
    treeSha: gitObservations[0].localTreeSha,
    statusDigest: gitObservations[0].statusDigest,
    changedPaths: gitObservations[0].changedPaths,
  });
  const core = {
    schema: value.schema,
    repository: text(value.repository, "repository"),
    observedAt: instant(value.observedAt, "observedAt"),
    leaseObservations,
    cloudObservations,
    gitObservations,
    pullRequestObservations,
    sourceLease,
    leaseDigest: writerLeaseDigest(sourceLease),
    sourceLeaseDigest: writerLeaseDigest(sourceLease),
    sourceCloudAuthority,
    targetCloudObservation,
    targetCloudAuthority,
    descendant,
    taskCapabilityDigest: digest(value.taskCapabilityDigest, "task capability digest"),
    mutationBoundary: normalizeMutationBoundary(value.mutationBoundary),
  };
  assertJoinedSubject(core);
  return deepFreeze(core);
}

function projectTargetAuthority(source, cloud) {
  const claim = cloud.claim;
  const target = {
    ...source,
    claimDigest: claim.fenceRevision,
    ledgerRevision: cloud.ledgerRevision,
    ledgerDigest: cloud.ledgerDigest,
    claimLedgerRevision: claim.claimLedgerRevision ?? claim.transitionDigest,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    reviewRequestId: claim.reviewRequestId,
    transitionCounter: claim.transitionCounter,
    state: "active",
    expiresAt: claim.expiresAt,
  };
  for (const key of ["entrySchema", "claimIdentitySchema", "operationReceiptDigest",
    "mutationAuthorityEligible", "integrationReceiptDigest", "integration"]) {
    if (claim[key] !== undefined) target[key] = claim[key];
  }
  validateAuthority(target, "target authority");
  return deepFreeze(target);
}

function normalizeLease(value) {
  const source = structuredClone(record(value, "writer lease"));
  const admission = record(source.admission, "lease admission");
  const authority = record(source.cloudAuthority, "lease cloud authority");
  if (source.schema !== "agentic-writer-lease/v2" || source.status !== "active"
    || admission.schema !== "agentic-lane-admission-lease/v1" || admission.status !== "planned") {
    invalid("active planned lease");
  }
  for (const [valueToCheck, label] of [[source.sessionId, "lease session"],
    [source.device, "lease device"], [source.branch, "lease branch"],
    [source.worktreePath, "lease worktree"], [source.pullRequestUrl, "lease pull request"]]) {
    text(valueToCheck, label);
  }
  sha(source.baseSha, "lease base");
  sha(source.fenceSha, "lease fence");
  positiveInteger(source.epoch, "lease epoch");
  instant(source.heartbeatAt, "lease heartbeat");
  instant(source.expiresAt, "lease expiry");
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  if (admission.writeSetDigest !== digestValue(declaredWriteSet)) invalid("lease write set");
  digest(admission.manifestDigest, "lease manifest digest");
  validateAuthority(authority, "source authority");
  source.admission = { ...admission, declaredWriteSet };
  return deepFreeze(source);
}

function normalizeCloud(value) {
  const source = record(value, "cloud observation");
  const claim = structuredClone(record(source.claim, "cloud claim"));
  if (source.status !== "ready" || !["current", "active"].includes(claim.state)
    || claim.writeAuthority !== true || claim.scopeReserved !== true) invalid("current cloud claim");
  validateClaim(claim);
  const core = {
    status: "ready",
    evaluatedAt: instant(source.evaluatedAt, "cloud evaluatedAt"),
    ledgerRevision: sha(source.ledgerRevision, "cloud ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "cloud ledger digest"),
    inventoryDigest: digest(source.inventoryDigest, "cloud inventory digest"),
    verificationReceiptDigest: digest(source.verificationReceiptDigest, "cloud verification receipt"),
    overlappingClaimIds: array(source.overlappingClaimIds, "overlapping claims")
      .map((item) => digest(item, "overlapping claim ID")).sort(),
    claim,
  };
  if (core.overlappingClaimIds.length) invalid("overlapping cloud claim");
  return deepFreeze(core);
}

function stableCloudIdentity(value) {
  const { evaluatedAt: _evaluatedAt, verificationReceiptDigest: _verificationReceiptDigest,
    ledgerRevision: _ledgerRevision, ledgerDigest: _ledgerDigest,
    inventoryDigest: _inventoryDigest, ...identity } = value;
  return identity;
}

function normalizeGit(value) {
  const source = record(value, "Git observation");
  const core = {
    branch: text(source.branch, "Git branch"),
    worktreePath: text(source.worktreePath, "Git worktree"),
    registered: source.registered === true,
    clean: source.clean === true,
    fenceSha: sha(source.fenceSha, "Git fence"),
    localHeadSha: sha(source.localHeadSha, "local head"),
    localTreeSha: sha(source.localTreeSha, "local tree"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote head"),
    indexTreeSha: sha(source.indexTreeSha, "index tree"),
    statusDigest: digest(source.statusDigest, "status digest"),
    authoredDescendantDigest: digest(source.authoredDescendantDigest, "authored descendant digest"),
    changedPaths: normalizeWriteSet(source.changedPaths),
  };
  if (!core.registered || !core.clean || core.localHeadSha === core.fenceSha
    || core.remoteHeadSha !== core.fenceSha || core.localTreeSha !== core.indexTreeSha
    || core.changedPaths.length === 0) invalid("preserved authored descendant");
  return deepFreeze(core);
}

function normalizePullRequest(value) {
  const source = record(value, "pull request");
  const core = {
    id: text(source.id, "pull-request ID"),
    reviewRequestId: text(source.reviewRequestId, "provider review-request ID"),
    number: positiveInteger(source.number, "pull-request number"),
    url: text(source.url, "pull-request URL"),
    branch: text(source.branch, "pull-request branch"),
    state: source.state === "OPEN" ? "OPEN" : invalid("pull-request state"),
    isDraft: source.isDraft === true,
    autoMergeRequest: source.autoMergeRequest === null ? null : invalid("pull-request auto-merge"),
    headSha: sha(source.headSha, "pull-request head"),
    baseSha: sha(source.baseSha, "pull-request base"),
    bodyDigest: digest(source.bodyDigest, "pull-request body digest"),
    markerDigest: digest(source.markerDigest, "pull-request marker digest"),
  };
  if (!core.isDraft) invalid("draft pull request");
  return deepFreeze(core);
}

function assertJoinedSubject(subject) {
  const lease = subject.leaseObservations[0];
  const authority = lease.cloudAuthority;
  const cloud = subject.cloudObservations[0];
  const claim = cloud.claim;
  const git = subject.gitObservations[0];
  const pullRequest = subject.pullRequestObservations[0];
  const failed = [
    ["stable-lease", writerLeaseDigest(lease) === writerLeaseDigest(subject.leaseObservations[1])],
    ["claim", authority.claimId === claim.claimId],
    ["transition", isRecoverableFenceTransition(authority, claim)],
    ["lane", authority.laneRevision === lease.baseSha && claim.laneRevision === lease.fenceSha],
    ["review", authority.reviewRequestId === null
      && claim.reviewRequestId === pullRequest.reviewRequestId],
    ["base", authority.canonicalBaseSha === claim.canonicalBaseRevision
      && authority.canonicalBaseSha === lease.baseSha],
    ["epoch", authority.leaseEpoch === claim.leaseEpoch],
    ["scope", authority.writeSetDigest === claim.writeSetDigest
      && canonicalJson(authority.cloudDeclaredWriteScope) === canonicalJson(claim.declaredWriteScope)
      && canonicalJson(claim.declaredWriteScope) === canonicalJson(lease.admission.declaredWriteSet)],
    ["owner", ownerMatches("device", authority.deviceId, lease.device)
      && ownerMatches("session", authority.sessionId, lease.sessionId)],
    ["lease-expiry", Date.parse(lease.expiresAt) <= Date.parse(subject.observedAt)],
    ["claim-expiry", Date.parse(claim.expiresAt) > Date.parse(subject.observedAt)],
    ["task", lease.taskAuthority?.bindingDigest === subject.taskCapabilityDigest],
    ["git", git.branch === lease.branch && git.worktreePath === lease.worktreePath
      && git.fenceSha === lease.fenceSha],
    ["pull-request", pullRequest.headSha === lease.fenceSha
      && pullRequest.baseSha === lease.baseSha && pullRequest.branch === lease.branch
      && pullRequest.url === lease.pullRequestUrl],
    ["descendant-scope", git.changedPaths.every((item) =>
      lease.admission.declaredWriteSet.includes(item))],
  ].filter(([, satisfied]) => !satisfied).map(([label]) => label);
  if (failed.length) invalid(`lease, cloud, Git, pull-request, or task join (${failed.join(", ")})`);
}

function isRecoverableFenceTransition(authority, claim) {
  if (authority.transitionCounter !== 1) return false;
  if (claim.transitionCounter === 2) return claim.recovery === undefined;
  return claim.transitionCounter === 3 && validResponseAheadRecovery(claim.recovery);
}

function validResponseAheadRecovery(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && /^[0-9a-f]{64}$/u.test(String(value.evidenceDigest || ""))
    && typeof value.recoveredAt === "string"
    && Number.isFinite(Date.parse(value.recoveredAt)));
}

function ownerMatches(namespace, recorded, local) {
  return recorded === local || recorded === pseudonymousIdentifier(namespace, local);
}

function validateAuthority(value, label) {
  if (value.schema !== "agentic-lane-cloud-authority/v1" || value.state !== "active") invalid(label);
  digest(value.claimId, `${label} claim ID`);
  digest(value.claimDigest, `${label} claim digest`);
  sha(value.ledgerRevision, `${label} ledger revision`);
  sha(value.canonicalBaseSha, `${label} base`);
  sha(value.laneRevision, `${label} lane revision`);
  text(value.deviceId, `${label} device`);
  text(value.sessionId, `${label} session`);
  value.cloudDeclaredWriteScope = normalizeWriteSet(value.cloudDeclaredWriteScope);
  if (value.writeSetDigest !== digestValue(value.cloudDeclaredWriteScope)) invalid(`${label} write set`);
  positiveInteger(value.leaseEpoch, `${label} lease epoch`);
  positiveInteger(value.transitionCounter, `${label} transition counter`);
}

function validateClaim(value) {
  digest(value.claimId, "claim ID");
  digest(value.fenceRevision, "claim digest");
  digest(value.transitionDigest, "claim transition digest");
  sha(value.canonicalBaseRevision, "claim base");
  sha(value.laneRevision, "claim lane revision");
  value.declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  if (value.writeSetDigest !== digestValue(value.declaredWriteScope)) invalid("claim write set");
  positiveInteger(value.leaseEpoch, "claim lease epoch");
  positiveInteger(value.transitionCounter, "claim transition counter");
  text(value.reviewRequestId, "claim review request");
  instant(value.expiresAt, "claim expiry");
}

function defaultMutationBoundary() {
  return {
    allowedMutations: ["writer-lease-registry-cas-with-recovery-receipt"],
    forbiddenEffects: ["cloud-mutation", "source-mutation", "git-mutation", "index-mutation",
      "remote-ref-mutation", "pull-request-mutation", "pull-request-state-mutation", "new-claim",
      "new-worktree", "merge", "deployment", "cleanup"],
  };
}
function normalizeMutationBoundary(value) {
  const source = record(value, "mutation boundary");
  const normalized = { allowedMutations: array(source.allowedMutations, "allowed mutations"),
    forbiddenEffects: array(source.forbiddenEffects, "forbidden effects") };
  if (canonicalJson(normalized) !== canonicalJson(defaultMutationBoundary())) invalid("mutation boundary");
  return deepFreeze({ allowedMutations: [...normalized.allowedMutations],
    forbiddenEffects: [...normalized.forbiddenEffects] });
}
function stablePair(value, normalize, label, stableProjection = item => item) {
  if (!Array.isArray(value) || value.length !== 2) invalid(label);
  const pair = value.map(normalize);
  if (canonicalJson(stableProjection(pair[0])) !== canonicalJson(stableProjection(pair[1]))) {
    invalid(`${label} drift`);
  }
  return deepFreeze(pair);
}
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function array(value, label) { if (!Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function instant(value, label) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(label); return value; }
function positiveInteger(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); return value; }
function invalid(label) { throw new Error(`Planned-start fence projection recovery has invalid ${label}.`); }
