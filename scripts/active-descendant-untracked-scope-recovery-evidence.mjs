// Responsibility: Seal the stopped owner's exact unpublished descendant and content-bound dirt.
import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const OWNER_STOP_SCHEMA =
  "agentic-active-descendant-untracked-owner-stop/v2";
export const INCIDENT_SCHEMA =
  "agentic-active-descendant-untracked-scope-recovery-incident/v2";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActiveDescendantUntrackedOwnerStopEvidence(input = {}) {
  const core = normalizeOwnerStopCore({ ...input, schema: OWNER_STOP_SCHEMA });
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeActiveDescendantUntrackedOwnerStopEvidence(value) {
  const core = normalizeOwnerStopCore(value);
  const receiptDigest = digest(value?.receiptDigest, "owner-stop receipt");
  if (receiptDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, receiptDigest })) {
    invalid("owner-stop receipt projection");
  }
  return deepFreeze({ ...core, receiptDigest });
}

export function buildActiveDescendantUntrackedIncident(input = {}) {
  const core = normalizeIncidentCore({ ...input, schema: INCIDENT_SCHEMA });
  return deepFreeze({ ...core, incidentDigest: digestValue(core) });
}

export function normalizeActiveDescendantUntrackedIncident(value) {
  const core = normalizeIncidentCore(value);
  const incidentDigest = digest(value?.incidentDigest, "incident digest");
  if (incidentDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, incidentDigest })) {
    invalid("incident projection");
  }
  return deepFreeze({ ...core, incidentDigest });
}

export function activeDescendantUntrackedStableIncidentDigest(value) {
  const incident = normalizeActiveDescendantUntrackedIncident(value);
  const { observedAt: _observedAt, ...stable } = incident;
  return digestValue(stable);
}

export function activeDescendantUntrackedIndexEvidenceDigest(dirt) {
  const normalized = normalizeActiveOwnedDirtEvidence(dirt);
  return digestValue(normalized.entries.map(entry => ({
    path: entry.path,
    staged: entry.staged,
    indexMode: entry.indexMode,
    indexBlob: entry.indexBlob,
  })));
}

export function activeDescendantUntrackedEntriesDigest(dirt) {
  const normalized = normalizeActiveOwnedDirtEvidence(dirt);
  return digestValue(normalized.entries.filter(entry => entry.untracked).map(entry => ({
    path: entry.path,
    worktreeType: entry.worktreeType,
    worktreeMode: entry.worktreeMode,
    worktreeBlob: entry.worktreeBlob,
  })));
}

export function assertActiveDescendantUntrackedScopePartition(incident) {
  const source = normalizeWriteSet(incident.sourceDeclaredWriteSet);
  const target = normalizeWriteSet(incident.targetDeclaredWriteSet);
  if (!(target.length > source.length && source.every(item => target.includes(item)))) {
    invalid("strict-superset target scope");
  }
  if (incident.committedPaths.some(file => !writeSetCovers(source, file))
    || incident.trackedDirtyPaths.some(file => !writeSetCovers(source, file))
    || incident.untrackedPaths.some(file => writeSetCovers(source, file))
    || incident.untrackedPaths.some(file => !writeSetCovers(target, file))) {
    invalid("committed, tracked, and untracked scope partition");
  }
  const additions = target.filter(item => !source.includes(item));
  if (incident.untrackedPaths.some(file => !additions.includes(`path:${file}`))) {
    invalid("exact untracked target additions");
  }
  return incident;
}

export function requireFreshActiveDescendantUntrackedOwnerStop({
  ownerStop,
  lease,
  frame,
  sourceSessionId,
  ttlSeconds,
  now,
  expectedReceiptDigest = null,
}) {
  const stop = normalizeActiveDescendantUntrackedOwnerStopEvidence(ownerStop);
  const instantMs = now.getTime();
  if (stop.sourceSessionId !== sourceSessionId
    || stop.sourceBranch !== lease.branch || stop.sourceHeadSha !== frame.headSha
    || stop.sourceFenceSha !== lease.fenceSha
    || stop.sourceDirtEvidenceDigest !== frame.dirt.evidenceDigest
    || stop.sourceIndexEvidenceDigest !== activeDescendantUntrackedIndexEvidenceDigest(frame.dirt)
    || stop.untrackedEntriesDigest !== activeDescendantUntrackedEntriesDigest(frame.dirt)
    || canonicalJson(stop.untrackedPaths) !== canonicalJson(frame.untrackedPaths)
    || Date.parse(stop.issuedAt) > instantMs || Date.parse(stop.expiresAt) <= instantMs
    || Date.parse(stop.expiresAt) - Date.parse(stop.issuedAt) > ttlSeconds * 1_000
    || (expectedReceiptDigest && stop.receiptDigest !== expectedReceiptDigest)) {
    invalid("fresh content-bound owner stop");
  }
  return stop;
}

export function buildActiveDescendantUntrackedSyntheticState({ rawState, incident }) {
  const sourceProjection = writerLeaseDigest(rawState.lease) === incident.sourceLeaseDigest;
  const source = Object.freeze({
    ...rawState.source,
    ...(!sourceProjection
      ? { lease: Object.freeze({ ...rawState.source.lease, taskAuthority: null }) }
      : {}),
    changedPaths: incident.trackedDirtyPaths,
    untrackedPaths: [],
    dirtyDigest: incident.dirt.evidenceDigest,
  });
  return Object.freeze({
    ...rawState,
    source,
    requireTaskAuthoritySuccessor: sourceProjection,
    sourceStateDigest: digestValue({
      source,
      leaseDigest: writerLeaseDigest(rawState.lease),
      incidentDigest: incident.incidentDigest,
    }),
    targetObservationDigest: digestValue({
      targetCanonicalBaseSha: rawState.targetCanonicalBaseSha,
      canonicalDescendantProof: rawState.canonicalDescendantProof || null,
      stableIncidentDigest: activeDescendantUntrackedStableIncidentDigest(incident),
    }),
  });
}

function normalizeOwnerStopCore(value) {
  record(value, "owner-stop receipt");
  const core = {
    schema: value.schema,
    sourceSessionId: text(value.sourceSessionId, "owner-stop session"),
    sourceBranch: text(value.sourceBranch, "owner-stop branch"),
    sourceHeadSha: sha(value.sourceHeadSha, "owner-stop HEAD"),
    sourceFenceSha: sha(value.sourceFenceSha, "owner-stop fence"),
    sourceDirtEvidenceDigest: digest(
      value.sourceDirtEvidenceDigest,
      "owner-stop dirt evidence",
    ),
    sourceIndexEvidenceDigest: digest(
      value.sourceIndexEvidenceDigest,
      "owner-stop index evidence",
    ),
    untrackedEntriesDigest: digest(
      value.untrackedEntriesDigest,
      "owner-stop untracked entries",
    ),
    taskAuthorityReceiptDigest: digest(
      value.taskAuthorityReceiptDigest,
      "owner-stop task-authority receipt",
    ),
    taskAuthorityProofDigest: digest(
      value.taskAuthorityProofDigest,
      "owner-stop task-authority proof",
    ),
    taskAuthorityBindingDigest: digest(
      value.taskAuthorityBindingDigest,
      "owner-stop task-authority binding",
    ),
    untrackedPaths: paths(value.untrackedPaths, "owner-stop untracked paths"),
    issuedAt: instant(value.issuedAt, "owner-stop issue instant"),
    expiresAt: instant(value.expiresAt, "owner-stop expiry instant"),
  };
  if (core.schema !== OWNER_STOP_SCHEMA
    || Date.parse(core.expiresAt) <= Date.parse(core.issuedAt)) {
    invalid("owner-stop schema or validity window");
  }
  return core;
}

function normalizeIncidentCore(value) {
  record(value, "recovery incident");
  const dirt = normalizeActiveOwnedDirtEvidence(value.dirt);
  const ownerStop = normalizeActiveDescendantUntrackedOwnerStopEvidence(
    value.ownerStop,
  );
  const committedPaths = paths(value.committedPaths, "committed paths", true);
  const trackedDirtyPaths = paths(value.trackedDirtyPaths, "tracked dirt paths");
  const untrackedPaths = paths(value.untrackedPaths, "untracked paths");
  const sourceDeclaredWriteSet = normalizeWriteSet(value.sourceDeclaredWriteSet);
  const targetDeclaredWriteSet = normalizeWriteSet(value.targetDeclaredWriteSet);
  const controller = normalizeController(value.controller);
  const pullRequest = normalizePullRequest(value.pullRequest);
  const core = {
    schema: value.schema,
    repository: text(value.repository, "repository"),
    authorityRepository: text(value.authorityRepository, "authority repository"),
    worktreeIdentityDigest: digest(
      value.worktreeIdentityDigest,
      "worktree identity",
    ),
    sourceSessionId: text(value.sourceSessionId, "source session"),
    sourceDevice: text(value.sourceDevice, "source device"),
    sourceScope: text(value.sourceScope, "source scope"),
    sourceBranch: text(value.sourceBranch, "source branch"),
    sourceBaseSha: sha(value.sourceBaseSha, "source base"),
    sourceFenceSha: sha(value.sourceFenceSha, "source fence"),
    sourceHeadSha: sha(value.sourceHeadSha, "source HEAD"),
    sourceHeadTreeSha: sha(value.sourceHeadTreeSha, "source HEAD tree"),
    commitInventoryDigest: digest(
      value.commitInventoryDigest,
      "commit inventory",
    ),
    rangeDiffDigest: digest(value.rangeDiffDigest, "descendant range diff"),
    committedPaths,
    dirt,
    sourceIndexEvidenceDigest: activeDescendantUntrackedIndexEvidenceDigest(dirt),
    trackedDirtyPaths,
    untrackedPaths,
    untrackedEntriesDigest: activeDescendantUntrackedEntriesDigest(dirt),
    ownerStop,
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease"),
    sourceClaimId: digest(value.sourceClaimId, "source claim ID"),
    sourceClaimDigest: digest(value.sourceClaimDigest, "source claim digest"),
    sourceTransitionCounter: positive(
      value.sourceTransitionCounter,
      "source transition counter",
    ),
    sourceLedgerRevision: sha(value.sourceLedgerRevision, "source ledger revision"),
    sourceLedgerDigest: digest(value.sourceLedgerDigest, "source ledger digest"),
    sourceTaskAuthorityBindingDigest: digest(
      value.sourceTaskAuthorityBindingDigest,
      "source task binding",
    ),
    sourceManifestDigest: digest(value.sourceManifestDigest, "source manifest"),
    sourceWriteSetDigest: digest(value.sourceWriteSetDigest, "source write set"),
    sourceDeclaredWriteSet,
    targetManifestDigest: digest(value.targetManifestDigest, "target manifest"),
    targetWriteSetDigest: digest(value.targetWriteSetDigest, "target write set"),
    targetDeclaredWriteSet,
    pullRequest,
    controller,
    observedAt: instant(value.observedAt, "incident observation"),
  };
  if (core.schema !== INCIDENT_SCHEMA
    || core.sourceWriteSetDigest !== digestValue(sourceDeclaredWriteSet)
    || core.targetWriteSetDigest !== digestValue(targetDeclaredWriteSet)
    || ownerStop.sourceSessionId !== core.sourceSessionId
    || ownerStop.sourceBranch !== core.sourceBranch
    || ownerStop.sourceHeadSha !== core.sourceHeadSha
    || ownerStop.sourceFenceSha !== core.sourceFenceSha
    || ownerStop.sourceDirtEvidenceDigest !== dirt.evidenceDigest
    || ownerStop.sourceIndexEvidenceDigest !== core.sourceIndexEvidenceDigest
    || ownerStop.untrackedEntriesDigest !== core.untrackedEntriesDigest
    || ownerStop.taskAuthorityBindingDigest
      !== core.sourceTaskAuthorityBindingDigest
    || canonicalJson(ownerStop.untrackedPaths) !== canonicalJson(untrackedPaths)
    || canonicalJson(dirt.entries.filter(entry => entry.untracked)
      .map(entry => entry.path).sort()) !== canonicalJson(untrackedPaths)
    || canonicalJson(dirt.entries.filter(entry => !entry.untracked)
      .map(entry => entry.path).sort()) !== canonicalJson(trackedDirtyPaths)
    || pullRequest.branch !== core.sourceBranch
    || pullRequest.headSha !== core.sourceFenceSha) {
    invalid("incident joins");
  }
  return core;
}

function normalizeController(value) {
  record(value, "controller witness");
  const result = {
    repository: text(value.repository, "controller repository"),
    branch: text(value.branch, "controller branch"),
    headSha: sha(value.headSha, "controller HEAD"),
    originMainSha: sha(value.originMainSha, "controller origin/main"),
    treeSha: sha(value.treeSha, "controller tree"),
    implementationDigest: digest(
      value.implementationDigest,
      "controller implementation",
    ),
  };
  if (result.branch !== "main" || result.headSha !== result.originMainSha) {
    invalid("protected controller identity");
  }
  return result;
}

function normalizePullRequest(value) {
  record(value, "pull-request identity");
  const result = {
    repository: text(value.repository, "pull-request repository"),
    nodeId: text(value.nodeId, "pull-request node ID"),
    number: positive(value.number, "pull-request number"),
    url: text(value.url, "pull-request URL"),
    state: text(value.state, "pull-request state"),
    draft: boolean(value.draft, "pull-request draft state"),
    autoMerge: value.autoMerge === null ? null : invalid("pull-request auto-merge"),
    branch: text(value.branch, "pull-request branch"),
    headSha: sha(value.headSha, "pull-request head"),
    baseBranch: text(value.baseBranch, "pull-request base branch"),
    baseSha: sha(value.baseSha, "pull-request base SHA"),
    visibleBodyDigest: digest(value.visibleBodyDigest, "visible pull-request body"),
    sourceMarkerDigest: digest(value.sourceMarkerDigest, "source pull-request marker"),
  };
  if (result.state !== "OPEN" || result.draft !== true
    || result.baseBranch !== "main") invalid("open draft pull request");
  return result;
}

function paths(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) invalid(label);
  const normalized = [...new Set(value.map(item => safePath(item, label)))].sort();
  if (normalized.length !== value.length || (!allowEmpty && !normalized.length)) {
    invalid(label);
  }
  return normalized;
}

function safePath(value, label) {
  const result = text(value, label).replaceAll("\\", "/");
  if (result.startsWith("/") || result.split("/")
    .some(part => !part || part === "." || part === "..")) invalid(label);
  return result;
}

function writeSetCovers(writeSet, candidate) {
  return writeSet.some(item => item.startsWith("path:")
    && (item.slice(5) === "." || item.slice(5) === candidate
      || candidate.startsWith(`${item.slice(5)}/`)));
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}
function instant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Active descendant/untracked recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
