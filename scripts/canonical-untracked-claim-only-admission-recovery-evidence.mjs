// Responsibility: Seal the exact preservation-only, claim-only recovery subject.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { pseudonymousIdentifier }
  from "./github-cloud-collaboration-mapping.mjs";

export const CANONICAL_UNTRACKED_CLAIM_ONLY_EVIDENCE_SCHEMA =
  "agentic-canonical-untracked-claim-only-admission-recovery-evidence/v1";

export function buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence(value = {}) {
  const identity = identityValue(value.identity);
  const source = sourceValue(value.source);
  const preservation = preservationValue(value.preservation);
  const manifest = normalizeDeclaredWriteScopeManifest(value.manifest, {
    expectedScope: identity.scope,
  });
  const cloud = cloudValue(value.cloud, { identity, source, manifest });
  const absence = absenceValue(value.absence);
  const controller = controllerValue(value.controller);
  assertSamePreservedSource(source, preservation, identity);
  assertManifestOwnsPaths(manifest.paths, source.untrackedPaths);
  const core = {
    schema: CANONICAL_UNTRACKED_CLAIM_ONLY_EVIDENCE_SCHEMA,
    identity,
    source,
    preservation,
    manifest,
    cloud,
    absence,
    controller,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence(value) {
  if (value?.schema !== CANONICAL_UNTRACKED_CLAIM_ONLY_EVIDENCE_SCHEMA) {
    invalid("evidence schema");
  }
  const rebuilt = buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence(value);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("evidence projection");
  return rebuilt;
}

export function projectCanonicalUntrackedClaimOnlyClaim(source) {
  const claim = record(source, "cloud claim");
  if (typeof claim.writeAuthority !== "boolean" || typeof claim.scopeReserved !== "boolean") {
    invalid("claim authority booleans");
  }
  return Object.freeze({
    claimId: digest(claim.claimId, "claim id"),
    entrySchema: text(claim.entrySchema, "entry schema"),
    claimIdentitySchema: text(claim.claimIdentitySchema, "claim identity schema"),
    actorId: text(claim.actorId, "actor id"),
    repositoryId: text(claim.repositoryId, "repository id"),
    workItemId: text(claim.workItemId, "work item id"),
    canonicalBaseRevision: sha(claim.canonicalBaseRevision, "canonical base"),
    laneRevision: sha(claim.laneRevision, "lane revision"),
    declaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: digest(claim.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positive(claim.leaseEpoch, "lease epoch"),
    transitionCounter: nonnegative(claim.transitionCounter, "transition counter"),
    heartbeatCounter: nonnegative(claim.heartbeatCounter, "heartbeat counter"),
    state: text(claim.state, "claim state"),
    writeAuthority: claim.writeAuthority,
    scopeReserved: claim.scopeReserved,
    reviewRequestId: nullableText(claim.reviewRequestId, "review request id"),
    predecessorClaimId: nullableDigest(claim.predecessorClaimId, "predecessor claim id"),
    recovery: claim.recovery ?? null,
    integration: claim.integration ?? null,
    fenceRevision: digest(claim.fenceRevision, "fence revision"),
    transitionDigest: digest(claim.transitionDigest, "transition digest"),
    operationReceiptDigest: digest(claim.operationReceiptDigest, "operation receipt digest"),
    deviceId: text(claim.deviceId, "claim device id"),
    sessionId: text(claim.sessionId, "claim session id"),
    expiresAt: instant(claim.expiresAt, "claim expiry"),
  });
}

export function claimsOverlapManifest(candidate, subject, manifest) {
  return candidate?.claimId !== subject.claimId
    && candidate?.repositoryId === subject.repositoryId
    && candidate?.scopeReserved === true
    && writeSetsOverlap(candidate.declaredWriteScope || [], manifest.declaredWriteSet);
}

function identityValue(value) {
  const source = record(value, "lane identity");
  const device = text(source.device, "device");
  const scope = text(source.scope, "scope");
  const branch = text(source.branch, "branch");
  if (branch !== `agent/${device}/${scope}`) invalid("prospective branch identity");
  if (!/^agent\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(branch)) {
    invalid("prospective branch syntax");
  }
  return Object.freeze({
    device,
    sessionId: text(source.sessionId, "session id"),
    scope,
    branch,
    targetWorktreeDigest: digest(source.targetWorktreeDigest, "target worktree digest"),
  });
}

function sourceValue(value) {
  const source = record(value, "canonical source");
  const result = {
    repository: text(source.repository, "source repository"),
    repositoryPathDigest: digest(source.repositoryPathDigest, "source path digest"),
    gitCommonDirectoryDigest: digest(source.gitCommonDirectoryDigest, "Git common directory digest"),
    branch: text(source.branch, "source branch"),
    headSha: sha(source.headSha, "source HEAD"),
    originMainSha: sha(source.originMainSha, "origin/main"),
    remoteMainSha: sha(source.remoteMainSha, "remote main"),
    primaryCanonical: source.primaryCanonical === true,
    registeredWorktree: source.registeredWorktree === true,
    trackedPaths: stringArray(source.trackedPaths, "tracked paths"),
    untrackedPaths: stringArray(source.untrackedPaths, "untracked paths"),
    stateDigest: digest(source.stateDigest, "source state digest"),
    writeSetDigest: digest(source.writeSetDigest, "source write-set digest"),
  };
  if (result.branch !== "main" || result.headSha !== result.originMainSha
    || result.headSha !== result.remoteMainSha || !result.primaryCanonical
    || !result.registeredWorktree || result.trackedPaths.length !== 0
    || result.untrackedPaths.length === 0) invalid("canonical untracked-only source");
  return Object.freeze(result);
}

function preservationValue(value) {
  const source = record(value, "preservation package");
  const result = {
    captureProfile: text(source.captureProfile, "capture profile"),
    packageDigest: digest(source.packageDigest, "package digest"),
    sourceHeadSha: sha(source.sourceHeadSha, "package source HEAD"),
    protectedTipSha: sha(source.protectedTipSha, "package protected tip"),
    operatorSessionId: text(source.operatorSessionId, "package operator session"),
    stateDigest: digest(source.stateDigest, "package state digest"),
    writeSetDigest: digest(source.writeSetDigest, "package write-set digest"),
    trackedPaths: stringArray(source.trackedPaths, "package tracked paths"),
    untrackedPaths: stringArray(source.untrackedPaths, "package untracked paths"),
  };
  if (result.captureProfile !== "canonical-untracked-retention"
    || result.trackedPaths.length !== 0 || result.untrackedPaths.length === 0) {
    invalid("canonical-untracked-retention package");
  }
  return Object.freeze(result);
}

function cloudValue(value, { identity, source, manifest }) {
  const input = record(value, "cloud evidence");
  const claim = projectCanonicalUntrackedClaimOnlyClaim(input.claim);
  const overlappingClaimIds = stringArray(input.overlappingClaimIds, "overlapping claim ids");
  if (claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || claim.transitionCounter !== 1
    || claim.heartbeatCounter !== 0 || claim.reviewRequestId !== null
    || claim.predecessorClaimId !== null || claim.recovery !== null
    || claim.integration !== null || claim.canonicalBaseRevision !== source.headSha
    || claim.laneRevision !== source.headSha || claim.writeSetDigest !== manifest.writeSetDigest
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(manifest.declaredWriteSet)
    || input.targetRepository !== source.repository
    || claim.deviceId !== ownerIdentifier("device", identity.device)
    || claim.sessionId !== ownerIdentifier("session", identity.sessionId)
    || overlappingClaimIds.length !== 0) invalid("dormant transition-1 claim-only subject");
  return Object.freeze({
    ledgerRepository: repository(input.ledgerRepository, "ledger repository"),
    targetRepository: repository(input.targetRepository, "target repository"),
    ledgerRevision: sha(input.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(input.ledgerDigest, "ledger digest"),
    inventoryDigest: digest(input.inventoryDigest, "inventory digest"),
    sourceAuthorityDigest: digest(input.sourceAuthorityDigest, "source authority digest"),
    claim,
    overlappingClaimIds,
    expectedDevice: identity.device,
    expectedSessionId: identity.sessionId,
  });
}

function absenceValue(value) {
  const source = record(value, "lane absence evidence");
  const result = {
    targetPathAbsent: source.targetPathAbsent === true,
    worktreeRegistrationAbsent: source.worktreeRegistrationAbsent === true,
    localBranchAbsent: source.localBranchAbsent === true,
    remoteBranchAbsent: source.remoteBranchAbsent === true,
    writerLeaseAbsent: source.writerLeaseAbsent === true,
    pullRequestAbsent: source.pullRequestAbsent === true,
  };
  if (Object.values(result).some(candidate => candidate !== true)) invalid("lane projections absent");
  return Object.freeze(result);
}

function controllerValue(value) {
  const source = record(value, "controller evidence");
  const result = {
    repository: repository(source.repository, "controller repository"),
    branch: text(source.branch, "controller branch"),
    headSha: sha(source.headSha, "controller HEAD"),
    originMainSha: sha(source.originMainSha, "controller origin/main"),
    remoteMainSha: sha(source.remoteMainSha, "controller remote main"),
    clean: source.clean === true,
    protectedMain: source.protectedMain === true,
    primaryCanonical: source.primaryCanonical === true,
    registeredWorktree: source.registeredWorktree === true,
  };
  if (result.branch !== "main" || !result.clean || !result.protectedMain
    || !result.primaryCanonical || !result.registeredWorktree
    || result.headSha !== result.originMainSha || result.headSha !== result.remoteMainSha) {
    invalid("protected current controller");
  }
  return Object.freeze(result);
}

function assertSamePreservedSource(source, preservation, identity) {
  if (preservation.operatorSessionId !== identity.sessionId
    || preservation.sourceHeadSha !== source.headSha
    || preservation.protectedTipSha !== source.headSha
    || preservation.stateDigest !== source.stateDigest
    || preservation.writeSetDigest !== source.writeSetDigest
    || canonicalJson(preservation.trackedPaths) !== canonicalJson(source.trackedPaths)
    || canonicalJson(preservation.untrackedPaths) !== canonicalJson(source.untrackedPaths)) {
    invalid("preservation package/source equality");
  }
}

function assertManifestOwnsPaths(owned, observed) {
  const owns = candidate => owned.some(root => candidate === root
    || candidate.startsWith(`${root.replace(/\/$/u, "")}/`));
  if (observed.some(candidate => !owns(candidate))) invalid("manifest path ownership");
}

function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function nullableText(value, label) { return value === null ? null : text(value, label); }
function digest(value, label) { const result = text(value, label); if (!/^[0-9a-f]{64}$/u.test(result)) invalid(label); return result; }
function nullableDigest(value, label) { return value === null || value === undefined ? null : digest(value, label); }
function sha(value, label) { const result = text(value, label); if (!/^[0-9a-f]{40}$/u.test(result)) invalid(label); return result; }
function repository(value, label) { const result = text(value, label); if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) invalid(label); return result; }
function instant(value, label) { const result = text(value, label); const parsed = new Date(result); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) invalid(label); return result; }
function ownerIdentifier(namespace, value) { const prefix = `${namespace}:`; return value.startsWith(prefix) && /^[0-9a-f]{64}$/u.test(value.slice(prefix.length)) ? value : pseudonymousIdentifier(namespace, value); }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function nonnegative(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function stringArray(value, label) { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item || item !== item.trim()) || new Set(value).size !== value.length || canonicalJson(value) !== canonicalJson([...value].sort())) invalid(label); return Object.freeze([...value]); }
function invalid(label) { throw new Error(`Canonical-untracked claim-only evidence rejected: ${label}.`); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
