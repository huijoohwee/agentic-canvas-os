// Responsibility: Normalize the immutable subject of one expired planned fence-only recovery.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";

export const PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-planned-fence-only-admission-recovery-evidence/v2";

const EXTERNALLY_LOST_MUTATION_SET = Object.freeze([
  "local-branch",
  "registered-worktree",
]);

export function buildPlannedFenceOnlyAdmissionRecoveryEvidence(input = {}) {
  const observedAt = instant(input.observedAt, "observation time");
  const sourceLease = cloneRecord(input.sourceLease, "source lease");
  const manifest = normalizeManifest(input.manifest);
  const repository = normalizeRepository(input.repository);
  const fence = normalizeFence(input.fence);
  const localProjection = normalizeLocalProjection(input.localProjection);
  const canonical = normalizeCanonical(input.canonical);
  const protectedMainAdvance = normalizeProtectedMainAdvance(input.protectedMainAdvance);
  const review = normalizeReview(input.review);
  const cloud = normalizeCloud(input.cloud);
  assertLease({
    sourceLease,
    manifest,
    repository,
    fence,
    localProjection,
    canonical,
    protectedMainAdvance,
    review,
    cloud,
    observedAt,
  });
  const core = {
    schema: PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_EVIDENCE_SCHEMA,
    observedAt,
    repository,
    sourceLease,
    sourceLeaseDigest: digestValue(sourceLease),
    manifest,
    manifestProjectionDigest: digestValue(manifest),
    fence,
    localProjection,
    localProjectionDigest: digestValue(localProjection),
    canonical,
    protectedMainAdvance,
    review,
    cloud,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizePlannedFenceOnlyAdmissionRecoveryEvidence(value) {
  if (value?.schema !== PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_EVIDENCE_SCHEMA) {
    invalid("evidence schema");
  }
  const rebuilt = buildPlannedFenceOnlyAdmissionRecoveryEvidence(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("evidence projection");
  return rebuilt;
}

function normalizeRepository(value) {
  const source = record(value, "repository");
  return deepFreeze({
    id: text(source.id, "repository identity"),
    candidatePath: absolutePath(source.candidatePath, "candidate path"),
    canonicalPath: absolutePath(source.canonicalPath, "canonical path"),
  });
}

function normalizeFence(value) {
  const source = record(value, "fence");
  const changedPaths = normalizePaths(source.changedPaths, "fence changed paths");
  const projection = {
    branch: text(source.branch, "fence branch"),
    headSha: sha(source.headSha, "fence head"),
    treeSha: sha(source.treeSha, "fence tree"),
    parentSha: sha(source.parentSha, "fence parent"),
    baseTreeSha: sha(source.baseTreeSha, "fence base tree"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote fence head"),
    changedPaths,
    changedPathsDigest: digestValue(changedPaths),
  };
  if (source.changedPathsDigest !== undefined
    && source.changedPathsDigest !== projection.changedPathsDigest) invalid("fence paths digest");
  return deepFreeze(projection);
}

function normalizeLocalProjection(value) {
  const source = record(value, "local projection");
  const mode = source.mode === "attached" || source.mode === "externally-lost"
    ? source.mode : invalid("local projection mode");
  const mutationSet = normalizeMutationSet(source.mutationSet);
  const projection = {
    mode,
    mutationSet,
    branch: text(source.branch, "local projection branch"),
    targetPath: absolutePath(source.targetPath, "local projection target"),
    headSha: sha(source.headSha, "local projection head"),
    localRefSha: optionalSha(source.localRefSha, "local branch head"),
    worktreeRegistered: boolean(source.worktreeRegistered, "worktree registration"),
    worktreePathPresent: boolean(source.worktreePathPresent, "worktree path presence"),
    worktreeHeadSha: optionalSha(source.worktreeHeadSha, "worktree head"),
    worktreeTreeSha: optionalSha(source.worktreeTreeSha, "worktree tree"),
    worktreeClean: boolean(source.worktreeClean, "worktree cleanliness"),
    statusDigest: optionalDigest(source.statusDigest, "worktree status digest"),
    branchOwnerCount: nonnegative(source.branchOwnerCount, "branch owner count"),
    targetRecordCount: nonnegative(source.targetRecordCount, "target record count"),
    registrationDigest: digest(source.registrationDigest, "worktree registration digest"),
    targetObservationDigest: digest(source.targetObservationDigest, "target observation digest"),
  };
  const attached = mode === "attached";
  if (attached && (
    mutationSet.length !== 0
    || projection.localRefSha !== projection.headSha
    || projection.worktreeRegistered !== true
    || projection.worktreePathPresent !== true
    || projection.worktreeHeadSha !== projection.headSha
    || projection.worktreeTreeSha === null
    || projection.worktreeClean !== true
    || projection.statusDigest === null
    || projection.branchOwnerCount !== 1
    || projection.targetRecordCount !== 1
  )) invalid("attached local projection");
  if (!attached && (
    canonicalJson(mutationSet) !== canonicalJson(EXTERNALLY_LOST_MUTATION_SET)
    || projection.localRefSha !== null
    || projection.worktreeRegistered !== false
    || projection.worktreePathPresent !== false
    || projection.worktreeHeadSha !== null
    || projection.worktreeTreeSha !== null
    || projection.worktreeClean !== false
    || projection.statusDigest !== null
    || projection.branchOwnerCount !== 0
    || projection.targetRecordCount !== 0
  )) invalid("externally lost local projection");
  return deepFreeze(projection);
}

function normalizeCanonical(value) {
  const source = record(value, "canonical worktree");
  return deepFreeze({
    registered: source.registered === true,
    clean: source.clean === true,
    branch: source.branch === "main" ? "main" : invalid("canonical branch"),
    headSha: sha(source.headSha, "canonical head"),
    treeSha: sha(source.treeSha, "canonical tree"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote canonical head"),
    statusDigest: digest(source.statusDigest, "canonical status digest"),
  });
}

function normalizeProtectedMainAdvance(value) {
  const source = record(value, "protected-main advance");
  const changedPaths = normalizePaths(source.changedPaths, "protected-main changed paths");
  const changedWriteSet = Array.isArray(source.changedWriteSet)
    && source.changedWriteSet.length === 0
    ? [] : normalizeWriteSet(source.changedWriteSet);
  const expectedWriteSet = changedPaths.length === 0
    ? [] : normalizeWriteSet(changedPaths.map(candidate => `path:${candidate}`));
  const core = {
    baseSha: sha(source.baseSha, "protected-main advance base"),
    baseTreeSha: sha(source.baseTreeSha, "protected-main advance base tree"),
    headSha: sha(source.headSha, "protected-main advance head"),
    headTreeSha: sha(source.headTreeSha, "protected-main advance head tree"),
    baseIsAncestor: source.baseIsAncestor === true,
    commitCount: nonnegative(source.commitCount, "protected-main advance commit count"),
    changedPaths,
    changedPathsDigest: digestValue(changedPaths),
    changedWriteSet,
    changedWriteSetDigest: digestValue(changedWriteSet),
    disjointFromManifest: source.disjointFromManifest === true,
  };
  if (canonicalJson(changedWriteSet) !== canonicalJson(expectedWriteSet)
    || (source.changedPathsDigest !== undefined
      && source.changedPathsDigest !== core.changedPathsDigest)
    || (source.changedWriteSetDigest !== undefined
      && source.changedWriteSetDigest !== core.changedWriteSetDigest)
    || core.baseIsAncestor !== true
    || core.disjointFromManifest !== true
    || (core.baseSha === core.headSha) !== (core.commitCount === 0)
    || (core.commitCount === 0 && (
      core.changedPaths.length !== 0 || core.baseTreeSha !== core.headTreeSha
    ))) invalid("protected-main advance projection");
  const advanceDigest = digestValue(core);
  if (source.advanceDigest !== undefined && source.advanceDigest !== advanceDigest) {
    invalid("protected-main advance digest");
  }
  return deepFreeze({ ...core, advanceDigest });
}

function normalizeReview(value) {
  const source = record(value, "review projection");
  const body = typeof source.body === "string" && Buffer.byteLength(source.body, "utf8") <= 65_536
    ? source.body : invalid("review body");
  const projection = {
    adapterId: text(source.adapterId, "review adapter"),
    id: text(source.id, "review identity"),
    number: positive(source.number, "review number"),
    url: text(source.url, "review URL"),
    state: source.state === "OPEN" ? "OPEN" : invalid("review state"),
    draft: source.draft === true,
    autoMergeAbsent: source.autoMergeAbsent === true,
    headRepository: text(source.headRepository, "review head repository"),
    headBranch: text(source.headBranch, "review head branch"),
    headSha: sha(source.headSha, "review head"),
    baseBranch: source.baseBranch === "main" ? "main" : invalid("review base branch"),
    baseSha: sha(source.baseSha, "review base"),
    body,
    bodyDigest: digest(source.bodyDigest, "review body digest"),
    visibleBodyDigest: digest(source.visibleBodyDigest, "review visible-body digest"),
    markerDigest: digest(source.markerDigest, "review marker digest"),
  };
  if (digestValue(body) !== projection.bodyDigest) invalid("review body digest join");
  return deepFreeze(projection);
}

function normalizeCloud(value) {
  const source = record(value, "cloud evidence");
  const claim = normalizeClaim(source.claim);
  const overlappingClaimIds = normalizeClaimIds(source.overlappingClaimIds);
  return deepFreeze({
    status: source.status === "ready" ? "ready" : invalid("cloud status"),
    ledgerRevision: sha(source.ledgerRevision, "cloud ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "cloud ledger digest"),
    inventoryDigest: digest(source.inventoryDigest, "cloud inventory digest"),
    claim,
    claimRecordDigest: digestValue(claim),
    overlappingClaimIds,
    noOverlappingReservation: overlappingClaimIds.length === 0,
  });
}

function normalizeClaim(value) {
  const source = record(value, "dormant claim");
  return deepFreeze({
    claimId: digest(source.claimId, "claim identity"),
    entrySchema: text(source.entrySchema, "claim entry schema"),
    claimIdentitySchema: text(source.claimIdentitySchema, "claim identity schema"),
    state: source.state === "dormant-preserved"
      ? "dormant-preserved" : invalid("claim state"),
    recordedState: source.recordedState === null || source.recordedState === undefined
      ? null : text(source.recordedState, "claim recorded state"),
    actorId: text(source.actorId, "claim actor"),
    repositoryId: text(source.repositoryId, "claim repository"),
    workItemId: text(source.workItemId, "claim work item"),
    deviceId: text(source.deviceId, "claim device"),
    sessionId: text(source.sessionId, "claim session"),
    canonicalBaseRevision: sha(source.canonicalBaseRevision, "claim base"),
    laneRevision: sha(source.laneRevision, "claim lane"),
    declaredWriteScope: normalizeWriteSet(source.declaredWriteScope),
    writeSetDigest: digest(source.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positive(source.leaseEpoch, "cloud lease epoch"),
    transitionCounter: positive(source.transitionCounter, "claim transition"),
    heartbeatCounter: nonnegative(source.heartbeatCounter, "claim heartbeat"),
    reviewRequestId: text(source.reviewRequestId, "claim review identity"),
    expiresAt: instant(source.expiresAt, "claim expiry"),
    fenceRevision: digest(source.fenceRevision, "claim fence"),
    transitionDigest: digest(source.transitionDigest, "claim transition digest"),
    operationReceiptDigest: digest(source.operationReceiptDigest, "claim operation receipt"),
    scopeReserved: source.scopeReserved === true,
    writeAuthority: source.writeAuthority === true,
  });
}

function normalizeManifest(value) {
  const source = record(value, "manifest");
  const paths = normalizePaths(source.paths, "manifest paths");
  const semanticScope = text(source.semanticScope, "manifest semantic scope");
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  const projection = {
    schema: source.schema === "agentic-declared-write-scope/v1"
      ? source.schema : invalid("manifest schema"),
    semanticScope,
    paths,
    declaredWriteSet,
    manifestDigest: digest(source.manifestDigest, "manifest digest"),
    writeSetDigest: digest(source.writeSetDigest, "manifest write-set digest"),
  };
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)
    || digestValue({ schema: projection.schema, semanticScope, paths }) !== projection.manifestDigest
    || digestValue(declaredWriteSet) !== projection.writeSetDigest) invalid("manifest projection");
  return deepFreeze(projection);
}

function assertLease({ sourceLease: lease, manifest, repository, fence, localProjection,
  canonical, protectedMainAdvance, review, cloud, observedAt }) {
  const admission = record(lease.admission, "planned admission");
  const authority = record(lease.cloudAuthority, "source cloud authority");
  const leaseExpiresAt = instant(lease.expiresAt, "source lease expiry");
  instant(lease.heartbeatAt, "source lease heartbeat");
  const authorityExpiresAt = instant(authority.expiresAt, "source cloud expiry");
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const claim = cloud.claim;
  const projectedMarker = projectWriterLeasePullRequestMarker(lease);
  const observedMarker = parseWriterLeasePullRequestBody(review.body);
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || admission.schema !== "agentic-lane-admission-lease/v1" || admission.status !== "planned"
    || authority.schema !== "agentic-lane-cloud-authority/v1" || authority.state !== "active"
    || Date.parse(leaseExpiresAt) > Date.parse(observedAt)
    || authorityExpiresAt !== leaseExpiresAt || claim.expiresAt !== leaseExpiresAt
    || fence.branch !== lease.branch || fence.headSha !== lease.fenceSha
    || fence.remoteHeadSha !== lease.fenceSha || fence.parentSha !== lease.baseSha
    || fence.treeSha !== fence.baseTreeSha || fence.changedPaths.length !== 0
    || localProjection.branch !== lease.branch || localProjection.headSha !== lease.fenceSha
    || localProjection.targetPath !== repository.candidatePath
    || lease.branch !== review.headBranch || lease.worktreePath !== repository.candidatePath
    || canonical.headSha !== canonical.remoteHeadSha || !canonical.registered || !canonical.clean
    || protectedMainAdvance.baseSha !== lease.baseSha
    || protectedMainAdvance.baseTreeSha !== fence.baseTreeSha
    || protectedMainAdvance.headSha !== canonical.headSha
    || protectedMainAdvance.headTreeSha !== canonical.treeSha
    || (protectedMainAdvance.changedWriteSet.length > 0
      && writeSetsOverlap(protectedMainAdvance.changedWriteSet, manifest.declaredWriteSet))
    || admission.semanticScope !== lease.scope || admission.semanticScope !== manifest.semanticScope
    || canonical.branch !== "main" || review.headRepository !== repository.id
    || review.headSha !== lease.fenceSha || review.baseSha !== lease.baseSha
    || review.url !== lease.pullRequestUrl || !review.draft || !review.autoMergeAbsent
    || review.id !== authority.reviewRequestId
    || canonicalJson(observedMarker) !== canonicalJson(projectedMarker)
    || review.markerDigest !== digestValue(projectedMarker)
    || authority.targetRepository !== repository.id || authority.claimId !== claim.claimId
    || authority.canonicalBaseSha !== lease.baseSha || authority.laneRevision !== lease.fenceSha
    || authority.writeSetDigest !== manifest.writeSetDigest
    || authority.manifestDigest !== manifest.manifestDigest
    || authority.leaseEpoch !== claim.leaseEpoch
    || authority.transitionCounter !== claim.transitionCounter
    || authority.heartbeatCounter !== claim.heartbeatCounter
    || authority.claimDigest !== claim.fenceRevision
    || authority.claimLedgerRevision !== claim.transitionDigest
    || authority.operationReceiptDigest !== claim.operationReceiptDigest
    || authority.entrySchema !== claim.entrySchema
    || authority.claimIdentitySchema !== claim.claimIdentitySchema
    || authority.deviceId !== lease.device || authority.sessionId !== lease.sessionId
    || claim.deviceId !== lease.device || claim.sessionId !== lease.sessionId
    || claim.canonicalBaseRevision !== lease.baseSha || claim.laneRevision !== lease.fenceSha
    || claim.writeSetDigest !== manifest.writeSetDigest
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(manifest.declaredWriteSet)
    || admission.manifestDigest !== manifest.manifestDigest
    || admission.writeSetDigest !== manifest.writeSetDigest
    || canonicalJson(admission.declaredWriteSet) !== canonicalJson(manifest.declaredWriteSet)
    || binding.bindingDigest !== lease.taskAuthority.bindingDigest
    || cloud.noOverlappingReservation !== true || claim.scopeReserved !== true
    || claim.writeAuthority !== false) invalid("exact planned fence-only recovery subject");
}

function normalizeMutationSet(value) {
  if (!Array.isArray(value)) invalid("local mutation set");
  const allowed = new Set(EXTERNALLY_LOST_MUTATION_SET);
  const effects = value.map(item => text(item, "local mutation effect"));
  if (new Set(effects).size !== effects.length || effects.some(item => !allowed.has(item))) {
    invalid("local mutation set");
  }
  return effects;
}
function normalizePaths(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const paths = value.map(item => text(item, label));
  if (new Set(paths).size !== paths.length || canonicalJson(paths) !== canonicalJson([...paths].sort())) {
    invalid(label);
  }
  return paths;
}
function normalizeClaimIds(value) {
  if (!Array.isArray(value)) invalid("overlapping claim identities");
  const identities = value.map(item => digest(item, "overlapping claim identity"));
  if (new Set(identities).size !== identities.length
    || canonicalJson(identities) !== canonicalJson([...identities].sort())) {
    invalid("overlapping claim identities");
  }
  return identities;
}
function cloneRecord(value, label) { return structuredClone(record(value, label)); }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) invalid(label); return value; }
function absolutePath(value, label) { const candidate = text(value, label); if (!candidate.startsWith("/")) invalid(label); return candidate; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function optionalSha(value, label) { return value === null ? null : sha(value, label); }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function optionalDigest(value, label) { return value === null ? null : digest(value, label); }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function nonnegative(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function boolean(value, label) { if (typeof value !== "boolean") invalid(label); return value; }
function instant(value, label) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); } return value; }
function invalid(label) { throw new Error(`Planned fence-only admission recovery has invalid ${label}.`); }
