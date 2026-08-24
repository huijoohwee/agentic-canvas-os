// Responsibility: Bind one closed, absent, cloud-retired planned owner to a local-only release CAS.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";

export const OPERATION = "closed-absent-planned-owner-release";
export const EVIDENCE_SCHEMA =
  "agentic-closed-absent-planned-owner-release-evidence/v1";
export const PLAN_SCHEMA =
  "agentic-closed-absent-planned-owner-release-plan/v1";
export const AUTHORIZATION_SCHEMA =
  "agentic-closed-absent-planned-owner-release-authorization/v1";
export const LOCAL_RELEASE_SCHEMA =
  "agentic-closed-absent-planned-owner-local-release/v1";
export const RECEIPT_SCHEMA =
  "agentic-closed-absent-planned-owner-release-receipt/v1";

const ALLOWED_EFFECTS = Object.freeze(["writer-lease-registry-cas"]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "source-bytes", "index", "commit", "ref", "worktree", "provider",
  "cloud-ledger", "cloud-claim", "pull-request", "merge", "deployment", "runtime",
]);
const PRESERVATION = Object.freeze({
  sourceBytes: "unchanged",
  gitIndex: "unchanged",
  commits: "unchanged",
  refs: "unchanged",
  worktrees: "unchanged",
  provider: "unchanged",
  cloudLedger: "unchanged",
  deployment: "not-performed",
});
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildEvidence(value) {
  const source = object(value, "release evidence");
  const evidence = {
    schema: schema(source.schema, EVIDENCE_SCHEMA, "evidence schema"),
    observedAt: instant(source.observedAt, "observation instant"),
    repository: repositoryEvidence(source.repository),
    controller: controllerEvidence(source.controller),
    registry: registryEvidence(source.registry),
    localAbsence: localAbsenceEvidence(source.localAbsence),
    pullRequest: pullRequestEvidence(source.pullRequest),
    retainedHead: retainedHeadEvidence(source.retainedHead),
    cloud: cloudEvidence(source.cloud),
  };
  assertJoins(evidence);
  return deepFreeze({ ...evidence, evidenceDigest: digestValue(evidence) });
}

export function normalizeEvidence(value) {
  const rebuilt = buildEvidence(value);
  if (value?.evidenceDigest !== rebuilt.evidenceDigest
    || canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Closed-absent planned-owner evidence is invalid or drifted.");
  }
  return rebuilt;
}

export function buildPlan({ evidence }) {
  const normalized = normalizeEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalized,
    allowedEffects: ALLOWED_EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    preservation: PRESERVATION,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizePlan(value) {
  const source = object(value, "release plan");
  const rebuilt = buildPlan({ evidence: source.evidence });
  if (canonicalJson(source) !== canonicalJson(rebuilt)) {
    throw new Error("Closed-absent planned-owner release plan is invalid or drifted.");
  }
  return rebuilt;
}

export function authorizePlan({ plan, authorization }) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    status: "authorized",
    planDigest: normalized.planDigest,
    authorization: normalized.exactAuthorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function buildReleasedLease({ plan, authorizationReceipt, releasedAt }) {
  const normalized = normalizePlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalized);
  const originalLease = structuredClone(normalized.evidence.registry.originalLease);
  const localCore = {
    schema: LOCAL_RELEASE_SCHEMA,
    status: "released",
    planDigest: normalized.planDigest,
    authorizationDigest: authorization.authorizationDigest,
    branch: originalLease.branch,
    claimId: originalLease.cloudAuthority.claimId,
    sourceLeaseDigest: normalized.evidence.registry.sourceLeaseDigest,
    sourceRegistryDigest: normalized.evidence.registry.registryDigest,
    sourceRegistryRevision: normalized.evidence.registry.revision,
    targetRegistryRevision: normalized.evidence.registry.revision + 1,
    providerEvidenceDigest: digestValue(normalized.evidence.pullRequest),
    retainedHeadEvidenceDigest: digestValue(normalized.evidence.retainedHead),
    cloudRetirementEvidenceDigest: digestValue(normalized.evidence.cloud),
    localAbsenceEvidenceDigest: digestValue(normalized.evidence.localAbsence),
    controllerEvidenceDigest: digestValue(normalized.evidence.controller),
    originalLease,
    originalLeaseDigest: normalized.evidence.registry.sourceLeaseDigest,
    releasedAt: instant(releasedAt, "release instant"),
    preservation: PRESERVATION,
  };
  if (Date.parse(localCore.releasedAt) < Date.parse(normalized.evidence.observedAt)) {
    throw new Error("Release instant precedes the authorized observation.");
  }
  const localRelease = deepFreeze({ ...localCore, receiptDigest: digestValue(localCore) });
  const releasedLease = {
    ...originalLease,
    status: "released",
    heartbeatAt: localCore.releasedAt,
    expiresAt: localCore.releasedAt,
    admission: null,
    cloudAuthority: null,
    closedAbsentPlannedOwnerRelease: localRelease,
  };
  assertReleasedLease({ lease: releasedLease, plan: normalized, authorizationReceipt: authorization });
  return deepFreeze(releasedLease);
}

export function assertReleasedLease({ lease, plan, authorizationReceipt }) {
  const normalized = normalizePlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalized);
  const candidate = object(lease, "released writer lease");
  const release = normalizeLocalRelease(candidate.closedAbsentPlannedOwnerRelease, normalized);
  if (candidate.schema !== "agentic-writer-lease/v2" || candidate.status !== "released"
    || candidate.admission !== null || candidate.cloudAuthority !== null
    || candidate.branch !== normalized.evidence.registry.originalLease.branch
    || candidate.heartbeatAt !== release.releasedAt || candidate.expiresAt !== release.releasedAt
    || release.authorizationDigest !== authorization.authorizationDigest) {
    throw new Error("Writer lease is not the authorized released projection.");
  }
  const reconstructed = { ...candidate };
  delete reconstructed.closedAbsentPlannedOwnerRelease;
  Object.assign(reconstructed, {
    status: release.originalLease.status,
    heartbeatAt: release.originalLease.heartbeatAt,
    expiresAt: release.originalLease.expiresAt,
    admission: release.originalLease.admission,
    cloudAuthority: release.originalLease.cloudAuthority,
  });
  if (digestValue(reconstructed) !== release.originalLeaseDigest
    || digestValue(release.originalLease) !== release.originalLeaseDigest
    || canonicalJson(reconstructed) !== canonicalJson(release.originalLease)) {
    throw new Error("Released projection changed fields outside the bounded owner release.");
  }
  return deepFreeze(structuredClone(candidate));
}

export function isReleasedLease(input) {
  try { assertReleasedLease(input); return true; } catch { return false; }
}

export function buildReceipt({ plan, authorizationReceipt, releasedLease }) {
  const normalized = normalizePlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalized);
  const released = assertReleasedLease({ lease: releasedLease, plan: normalized,
    authorizationReceipt: authorization });
  const local = released.closedAbsentPlannedOwnerRelease;
  const releasedLeaseDigest = digestValue(released);
  const terminalEvidenceDigest = digestValue({
    planDigest: normalized.planDigest,
    releasedLeaseDigest,
    localReleaseReceiptDigest: local.receiptDigest,
    sourceRegistryRevision: local.sourceRegistryRevision,
    targetRegistryRevision: local.targetRegistryRevision,
    providerEvidenceDigest: local.providerEvidenceDigest,
    cloudRetirementEvidenceDigest: local.cloudRetirementEvidenceDigest,
  });
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "complete",
    operation: OPERATION,
    planDigest: normalized.planDigest,
    authorizationDigest: authorization.authorizationDigest,
    repository: normalized.evidence.repository.nameWithOwner,
    branch: released.branch,
    claimId: local.claimId,
    pullRequestNumber: normalized.evidence.pullRequest.number,
    sourceLeaseDigest: local.sourceLeaseDigest,
    releasedLeaseDigest,
    localReleaseReceiptDigest: local.receiptDigest,
    sourceRegistryDigest: local.sourceRegistryDigest,
    sourceRegistryRevision: local.sourceRegistryRevision,
    targetRegistryRevision: local.targetRegistryRevision,
    terminalEvidenceDigest,
    mutationDisposition: {
      writerLease: "released",
      admission: "cleared",
      cloudAuthority: "cleared",
      sourceBytes: false,
      git: false,
      provider: false,
      cloud: false,
      merge: false,
      deployment: false,
    },
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function repositoryEvidence(value) {
  const source = object(value, "repository evidence");
  return {
    id: text(source.id, "repository ID"),
    nameWithOwner: repository(source.nameWithOwner, "repository name"),
    gitCommonDirectoryDigest: digest(source.gitCommonDirectoryDigest, "Git common-directory digest"),
  };
}

function controllerEvidence(value) {
  const source = object(value, "controller evidence");
  const result = {
    repository: repository(source.repository, "controller repository"),
    branch: text(source.branch, "controller branch"),
    headSha: sha(source.headSha, "controller HEAD"),
    originMainSha: sha(source.originMainSha, "controller origin/main"),
    treeSha: sha(source.treeSha, "controller tree"),
    runtimeDigest: digest(source.runtimeDigest, "controller runtime digest"),
    clean: source.clean === true,
    protected: source.protected === true,
  };
  if (result.branch !== "main" || !result.clean || !result.protected
    || result.headSha !== result.originMainSha) {
    throw new Error("Release requires one clean protected-main controller.");
  }
  return result;
}

function registryEvidence(value) {
  const source = object(value, "writer registry evidence");
  const originalLease = structuredClone(object(source.originalLease, "original writer lease"));
  const sourceLeaseDigest = digest(source.sourceLeaseDigest, "source lease digest");
  if (source.schema !== "agentic-writer-lease-registry/v2"
    || !Number.isSafeInteger(source.revision) || source.revision < 0
    || source.revision >= Number.MAX_SAFE_INTEGER
    || digestValue(originalLease) !== sourceLeaseDigest) {
    throw new Error("Writer registry source evidence is invalid.");
  }
  if (originalLease.schema !== "agentic-writer-lease/v2" || originalLease.status !== "active"
    || !Number.isSafeInteger(originalLease.epoch) || originalLease.epoch < 1
    || originalLease.admission?.status !== "planned"
    || !DIGEST.test(String(originalLease.cloudAuthority?.claimId || ""))) {
    throw new Error("Source owner is not one active planned writer lease.");
  }
  const related = object(source.relatedArtifacts, "related writer-registry artifacts");
  if (related.scopeExpansionIntent !== false || related.activeOwnedDirtRecoveryIntent !== false
    || related.reviewedLaneEntrypointFence !== false) {
    throw new Error("Source owner has a competing writer-registry intent or fence.");
  }
  return {
    schema: source.schema,
    revision: source.revision,
    registryDigest: digest(source.registryDigest, "writer registry digest"),
    sourceLeaseDigest,
    originalLease,
    relatedArtifacts: {
      scopeExpansionIntent: false,
      activeOwnedDirtRecoveryIntent: false,
      reviewedLaneEntrypointFence: false,
    },
  };
}

function localAbsenceEvidence(value) {
  const source = object(value, "local absence evidence");
  const result = {
    branch: text(source.branch, "absent branch"),
    worktreePath: text(source.worktreePath, "absent worktree path"),
    worktreeRegistered: source.worktreeRegistered === true,
    worktreePathPresent: source.worktreePathPresent === true,
    localBranchPresent: source.localBranchPresent === true,
    remoteBranchPresent: source.remoteBranchPresent === true,
    matchingWorktreeCount: nonnegative(source.matchingWorktreeCount, "matching worktree count"),
    matchingLocalRefCount: nonnegative(source.matchingLocalRefCount, "matching local-ref count"),
    matchingRemoteRefCount: nonnegative(source.matchingRemoteRefCount, "matching remote-ref count"),
  };
  if (result.worktreeRegistered || result.worktreePathPresent || result.localBranchPresent
    || result.remoteBranchPresent || result.matchingWorktreeCount !== 0
    || result.matchingLocalRefCount !== 0 || result.matchingRemoteRefCount !== 0) {
    throw new Error("Release requires an absent worktree and absent local and remote branch.");
  }
  return result;
}

function pullRequestEvidence(value) {
  const source = object(value, "pull-request evidence");
  const result = {
    number: positive(source.number, "pull-request number"),
    nodeId: text(source.nodeId, "pull-request node ID"),
    url: text(source.url, "pull-request URL"),
    state: text(source.state, "pull-request state"),
    isDraft: source.isDraft === true,
    mergedAt: source.mergedAt ?? null,
    closedAt: instant(source.closedAt, "pull-request closedAt"),
    headRepository: repository(source.headRepository, "pull-request head repository"),
    headBranch: text(source.headBranch, "pull-request head branch"),
    headSha: sha(source.headSha, "pull-request head SHA"),
    baseRepository: repository(source.baseRepository, "pull-request base repository"),
    baseBranch: text(source.baseBranch, "pull-request base branch"),
    baseSha: sha(source.baseSha, "pull-request base SHA"),
    bodyDigest: digest(source.bodyDigest, "pull-request body digest"),
    bodyRemainderDigest: digest(source.bodyRemainderDigest, "pull-request body remainder digest"),
    markerDigest: digest(source.markerDigest, "pull-request marker digest"),
  };
  if (result.state !== "CLOSED" || !result.isDraft || result.mergedAt !== null) {
    throw new Error("Release requires one closed, unmerged draft pull request.");
  }
  return result;
}

function retainedHeadEvidence(value) {
  const source = object(value, "retained head evidence");
  const parentShas = array(source.parentShas, "retained head parents")
    .map((item, index) => sha(item, `retained head parent ${index}`));
  const changedPaths = array(source.changedPaths, "retained head changed paths")
    .map(item => text(item, "retained head changed path")).sort();
  const result = {
    ref: text(source.ref, "retained pull-request ref"),
    sha: sha(source.sha, "retained head SHA"),
    treeSha: sha(source.treeSha, "retained head tree"),
    parentShas,
    baseTreeSha: sha(source.baseTreeSha, "retained base tree"),
    changedPaths,
  };
  if (!/^refs\/pull\/[1-9][0-9]*\/head$/u.test(result.ref)
    || parentShas.length !== 1 || changedPaths.length !== 0
    || result.treeSha !== result.baseTreeSha) {
    throw new Error("Retained pull-request head is not one empty coordination commit.");
  }
  return result;
}

function cloudEvidence(value) {
  const source = object(value, "cloud retirement evidence");
  const sourceEntry = object(source.source, "source cloud entry");
  const terminal = object(source.terminal, "terminal cloud entry");
  const result = {
    ledgerRepository: repository(source.ledgerRepository, "ledger repository"),
    ledgerRevision: sha(source.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "ledger digest"),
    sequence: positive(source.sequence, "ledger sequence"),
    validatedLedgerDigest: digest(source.validatedLedgerDigest, "validated ledger digest"),
    currentClaimCardinality: nonnegative(source.currentClaimCardinality, "current claim cardinality"),
    source: {
      claimId: digest(sourceEntry.claimId, "source claim ID"),
      entryDigest: digest(sourceEntry.entryDigest, "source entry digest"),
      claimDigest: digest(sourceEntry.claimDigest, "source claim digest"),
      transitionCounter: positive(sourceEntry.transitionCounter, "source transition counter"),
      state: text(sourceEntry.state, "source claim state"),
    },
    terminal: {
      claimId: digest(terminal.claimId, "terminal claim ID"),
      entryDigest: digest(terminal.entryDigest, "terminal entry digest"),
      claimDigest: digest(terminal.claimDigest, "terminal claim digest"),
      transitionCounter: positive(terminal.transitionCounter, "terminal transition counter"),
      action: text(terminal.action, "terminal action"),
      state: text(terminal.state, "terminal claim state"),
      reason: text(terminal.reason, "retirement reason"),
      finalRevision: sha(terminal.finalRevision, "retirement final revision"),
      reviewRequestId: text(terminal.reviewRequestId, "retirement review request ID"),
      retiredAt: instant(terminal.retiredAt, "retirement instant"),
      integrationReceiptDigest: terminal.integrationReceiptDigest ?? null,
    },
  };
  if (result.currentClaimCardinality !== 0 || result.source.state !== "current"
    || result.terminal.action !== "retire" || result.terminal.state !== "retired"
    || result.terminal.reason !== "abandoned"
    || result.terminal.transitionCounter <= result.source.transitionCounter
    || result.terminal.integrationReceiptDigest !== null) {
    throw new Error("Cloud evidence is not one terminal abandoned retirement.");
  }
  return result;
}

function assertJoins(evidence) {
  const lease = evidence.registry.originalLease;
  const authority = lease.cloudAuthority;
  const pull = evidence.pullRequest;
  const retained = evidence.retainedHead;
  if (Date.parse(lease.expiresAt) > Date.parse(evidence.observedAt)
    || Date.parse(authority.expiresAt) > Date.parse(evidence.observedAt)) {
    throw new Error("Release requires an expired local planned owner and projected authority.");
  }
  if (evidence.repository.nameWithOwner !== pull.headRepository
    || pull.headRepository !== pull.baseRepository
    || evidence.repository.nameWithOwner !== authority.targetRepository
    || evidence.cloud.ledgerRepository !== authority.ledgerRepository
    || evidence.localAbsence.branch !== lease.branch
    || evidence.localAbsence.worktreePath !== lease.worktreePath
    || pull.headBranch !== lease.branch || pull.headSha !== lease.fenceSha
    || pull.baseBranch !== "main" || pull.baseSha !== lease.baseSha
    || retained.ref !== `refs/pull/${pull.number}/head` || retained.sha !== pull.headSha
    || retained.parentShas[0] !== pull.baseSha
    || evidence.cloud.source.claimId !== authority.claimId
    || evidence.cloud.terminal.claimId !== authority.claimId
    || evidence.cloud.source.claimDigest !== authority.claimDigest
    || evidence.cloud.source.transitionCounter !== authority.transitionCounter
    || evidence.cloud.terminal.finalRevision !== pull.headSha
    || evidence.cloud.terminal.reviewRequestId !== `github-pull-request:${pull.nodeId}`
    || authority.reviewRequestId !== `github-pull-request:${pull.nodeId}`
    || pull.markerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Lease, absence, pull request, retained head, and cloud retirement do not join.");
  }
}

function normalizeAuthorization(value, plan) {
  const source = object(value, "authorization receipt");
  const core = {
    schema: schema(source.schema, AUTHORIZATION_SCHEMA, "authorization schema"),
    status: source.status === "authorized" ? source.status : invalid("authorization status"),
    planDigest: digest(source.planDigest, "authorization plan digest"),
    authorization: text(source.authorization, "authorization text"),
  };
  if (core.planDigest !== plan.planDigest || core.authorization !== plan.exactAuthorization
    || source.authorizationDigest !== digestValue(core)
    || canonicalJson(source) !== canonicalJson({ ...core, authorizationDigest: source.authorizationDigest })) {
    throw new Error("Authorization receipt is invalid or drifted.");
  }
  return deepFreeze({ ...core, authorizationDigest: source.authorizationDigest });
}

function normalizeLocalRelease(value, plan) {
  const source = object(value, "local release receipt");
  const core = { ...structuredClone(source) };
  delete core.receiptDigest;
  const expected = plan.evidence;
  if (core.schema !== LOCAL_RELEASE_SCHEMA || core.status !== "released"
    || core.planDigest !== plan.planDigest
    || core.branch !== expected.registry.originalLease.branch
    || core.claimId !== expected.registry.originalLease.cloudAuthority.claimId
    || core.sourceLeaseDigest !== expected.registry.sourceLeaseDigest
    || core.sourceRegistryDigest !== expected.registry.registryDigest
    || core.sourceRegistryRevision !== expected.registry.revision
    || core.targetRegistryRevision !== expected.registry.revision + 1
    || core.providerEvidenceDigest !== digestValue(expected.pullRequest)
    || core.retainedHeadEvidenceDigest !== digestValue(expected.retainedHead)
    || core.cloudRetirementEvidenceDigest !== digestValue(expected.cloud)
    || core.localAbsenceEvidenceDigest !== digestValue(expected.localAbsence)
    || core.controllerEvidenceDigest !== digestValue(expected.controller)
    || core.originalLeaseDigest !== expected.registry.sourceLeaseDigest
    || digestValue(core.originalLease) !== core.originalLeaseDigest
    || canonicalJson(core.preservation) !== canonicalJson(PRESERVATION)
    || source.receiptDigest !== digestValue(core)) {
    throw new Error("Local owner-release receipt is invalid or drifted.");
  }
  digest(core.authorizationDigest, "release authorization digest");
  instant(core.releasedAt, "release instant");
  return deepFreeze({ ...core, receiptDigest: source.receiptDigest });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function array(value, label) { if (!Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function text(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new Error(`${label} is invalid.`);
  return value;
}
function repository(value, label) {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function schema(value, expected, label) { if (value !== expected) throw new Error(`${label} is invalid.`); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function nonnegative(value, label) { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) {
  if (typeof value !== "string" || !value || new Date(value).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function invalid(label) { throw new Error(`${label} is invalid.`); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
