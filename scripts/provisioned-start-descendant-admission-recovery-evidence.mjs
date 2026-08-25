// Responsibility: Normalize the exact interrupted-start descendant admission subject.

import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-provisioned-start-descendant-admission-recovery-evidence/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildProvisionedStartDescendantAdmissionRecoveryEvidence(input = {}) {
  const source = normalizeCore({ ...input, schema: EVIDENCE_SCHEMA });
  return freeze({ ...source, evidenceDigest: digestValue(source) });
}

export function normalizeProvisionedStartDescendantAdmissionRecoveryEvidence(value) {
  const source = object(value, "evidence");
  const core = normalizeCore(source);
  if (digest(source.evidenceDigest, "evidence digest") !== digestValue(core)
    || canonicalJson(source) !== canonicalJson({ ...core, evidenceDigest: source.evidenceDigest })) {
    invalid("canonical evidence");
  }
  return freeze({ ...core, evidenceDigest: source.evidenceDigest });
}

function normalizeCore(value) {
  if (value.schema !== EVIDENCE_SCHEMA) invalid("schema");
  const lease = structuredClone(object(value.lease, "source lease"));
  const admission = object(lease.admission, "planned admission");
  const authority = object(lease.cloudAuthority, "source cloud authority");
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || admission.schema !== "agentic-lane-admission-lease/v1" || admission.status !== "planned"
    || authority.schema !== "agentic-lane-cloud-authority/v1"
    || authority.transitionCounter !== 1 || authority.reviewRequestId !== null) {
    invalid("transition-1 active planned lease");
  }
  text(lease.sessionId, "lease session");
  text(lease.device, "lease device");
  text(lease.branch, "lease branch");
  text(lease.worktreePath, "lease worktree");
  text(lease.pullRequestUrl, "lease pull request");
  sha(lease.baseSha, "lease base");
  sha(lease.fenceSha, "lease fence");
  positive(lease.epoch, "lease epoch");
  digest(authority.claimId, "claim ID");
  digest(authority.claimDigest, "claim digest");
  sha(authority.canonicalBaseSha, "claim base");
  sha(authority.laneRevision, "source claim lane");
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  if (admission.writeSetDigest !== digestValue(declaredWriteSet)
    || authority.writeSetDigest !== admission.writeSetDigest
    || canonicalJson(normalizeWriteSet(authority.cloudDeclaredWriteScope))
      !== canonicalJson(declaredWriteSet)
    || authority.canonicalBaseSha !== lease.baseSha
    || authority.laneRevision !== lease.baseSha) invalid("lease and claim join");
  lease.admission = { ...admission, declaredWriteSet };
  const descendant = normalizeDescendant(value.descendant, lease);
  const pullRequest = normalizePullRequest(value.pullRequest, lease, descendant);
  const cloud = normalizeCloud(value.cloud, lease, pullRequest);
  const controller = normalizeController(value.controller);
  const boundary = normalizeBoundary(value.mutationBoundary);
  return freeze({ schema: EVIDENCE_SCHEMA, repository: text(value.repository, "repository"),
    observedAt: instant(value.observedAt, "observedAt"), lease: freeze(lease),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease digest"),
    descendant, pullRequest, cloud, controller, mutationBoundary: boundary });
}

function normalizeDescendant(value, lease) {
  const source = object(value, "descendant");
  const paths = normalizeWriteSet((source.paths || []).map(item => `path:${item}`))
    .map(item => item.slice(5));
  const allowed = new Set(lease.admission.declaredWriteSet
    .filter(item => item.startsWith("path:")).map(item => item.slice(5)));
  const commits = array(source.commits, "commits").map((commit, index) => freeze({
    sha: sha(commit.sha, `commit ${index} SHA`), treeSha: sha(commit.treeSha, `commit ${index} tree`),
    parentSha: sha(commit.parentSha, `commit ${index} parent`),
    message: text(commit.message, `commit ${index} message`),
  }));
  const result = { fenceSha: sha(source.fenceSha, "descendant fence"),
    headSha: sha(source.headSha, "descendant head"), treeSha: sha(source.treeSha, "descendant tree"),
    clean: source.clean === true, linear: source.linear === true, paths,
    rangeDiffDigest: digest(source.rangeDiffDigest, "range diff"), commits };
  if (!result.clean || !result.linear || result.fenceSha !== lease.fenceSha
    || result.headSha === result.fenceSha || !commits.length
    || commits[0].parentSha !== result.fenceSha || commits.at(-1).sha !== result.headSha
    || commits.some((commit, index) => index > 0 && commit.parentSha !== commits[index - 1].sha)
    || !paths.length || paths.some(item => !allowed.has(item))) invalid("clean linear scoped descendant");
  return freeze(result);
}

function normalizePullRequest(value, lease, descendant) {
  const source = object(value, "pull request");
  const result = { id: text(source.id, "pull-request ID"),
    reviewRequestId: text(source.reviewRequestId, "review-request ID"),
    number: positive(source.number, "pull-request number"), url: text(source.url, "pull-request URL"),
    branch: text(source.branch, "pull-request branch"), headSha: sha(source.headSha, "pull-request head"),
    baseSha: sha(source.baseSha, "pull-request base"), state: source.state,
    isDraft: source.isDraft === true, autoMergeRequest: source.autoMergeRequest ?? null,
    bodyDigest: digest(source.bodyDigest, "pull-request body") };
  if (result.state !== "OPEN" || !result.isDraft || result.autoMergeRequest !== null
    || result.url !== lease.pullRequestUrl || result.branch !== lease.branch
    || result.headSha !== descendant.headSha) invalid("open draft descendant pull request");
  return freeze(result);
}

function normalizeCloud(value, lease, pullRequest) {
  const source = object(value, "cloud observation");
  const claim = structuredClone(object(source.claim, "cloud claim"));
  const state = ["current", "dormant-preserved"].includes(claim.state) ? claim.state : invalid("claim state");
  if (claim.claimId !== lease.cloudAuthority.claimId || claim.transitionCounter !== 1
    || claim.canonicalBaseRevision !== lease.baseSha || claim.laneRevision !== lease.baseSha
    || claim.reviewRequestId !== null || claim.writeSetDigest !== lease.admission.writeSetDigest
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(lease.admission.declaredWriteSet)
    || (state === "current" && (!claim.writeAuthority || !claim.scopeReserved))
    || (state === "dormant-preserved" && (claim.writeAuthority || !claim.scopeReserved))) {
    invalid("transition-1 cloud claim");
  }
  const overlaps = array(source.overlappingClaimIds, "overlapping claims");
  if (overlaps.length) invalid("overlapping cloud claim");
  return freeze({ state: "ready", ledgerRevision: sha(source.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "ledger digest"), claim: freeze(claim),
    overlappingClaimIds: freeze(overlaps) });
}

function normalizeController(value) {
  const source = object(value, "controller");
  if (source.clean !== true || source.protected !== true) invalid("protected controller");
  return freeze({ repository: text(source.repository, "controller repository"),
    headSha: sha(source.headSha, "controller head"), treeSha: sha(source.treeSha, "controller tree"),
    clean: true, protected: true });
}

function normalizeBoundary(value) {
  const source = object(value, "mutation boundary");
  const allowed = ["cloud-claim-cas", "writer-registry-cas", "pull-request-marker-cas"];
  for (const key of allowed) if (source[key] !== true) invalid(`mutation boundary ${key}`);
  for (const key of ["sourceBytes", "gitRefs", "draftState", "merge", "deployment", "cleanup"])
    if (source[key] !== false) invalid(`mutation boundary ${key}`);
  return freeze({ ...source });
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function array(value, label) { if (!Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(String(value || "")))) invalid(label); return new Date(value).toISOString(); }
function invalid(label) { throw new Error(`Provisioned-start descendant evidence ${label} is invalid.`); }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
