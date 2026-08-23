import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { normalizeActiveDirtyScopeExpansionCanonicalDescendantProof }
  from "./active-dirty-scope-expansion-protected-main.mjs";

export const ACTIVE_DIRTY_SCOPE_EXPANSION_PLAN_SCHEMA =
  "agentic-active-dirty-scope-expansion-plan/v1";
export const ACTIVE_DIRTY_SCOPE_EXPANSION_RECEIPT_SCHEMA =
  "agentic-active-dirty-scope-expansion-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildActiveDirtyScopeExpansionPlan({
  source,
  targetManifest,
  targetCanonicalBaseSha,
  canonicalDescendantProof = null,
}) {
  const normalizedSource = normalizeSource(source);
  const target = normalizeTargetManifest(targetManifest, normalizedSource.scope);
  const canonicalBaseSha = requiredSha(targetCanonicalBaseSha, "target canonical base SHA");
  const sourceWriteSet = normalizeWriteSet(normalizedSource.lease.admission.declaredWriteSet);
  if (!strictSubset(sourceWriteSet, target.declaredWriteSet)) {
    throw new Error("Scope expansion requires the source write set to be a strict subset of the target write set.");
  }
  if (!normalizedSource.changedPaths.every(path => writeSetCoversPath(sourceWriteSet, path))) {
    throw new Error("Source dirty bytes extend outside the currently admitted write set.");
  }
  const protectedMain = canonicalDescendantProof
    ? normalizeActiveDirtyScopeExpansionCanonicalDescendantProof(canonicalDescendantProof)
    : null;
  if (protectedMain && (protectedMain.sourceBaseSha !== canonicalBaseSha
    || normalizedSource.lease.baseSha !== canonicalBaseSha)) {
    throw new Error("Scope-expansion canonical-descendant proof changed the source base.");
  }
  const core = {
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_PLAN_SCHEMA,
    sourceBranch: normalizedSource.branch,
    sourceFenceSha: normalizedSource.fenceSha,
    sourceLeaseDigest: writerLeaseDigest(normalizedSource.lease),
    sourceClaimId: normalizedSource.authority.claimId,
    sourceClaimDigest: normalizedSource.authority.claimDigest,
    sourceClaimTransitionCounter: normalizedSource.authority.transitionCounter,
    sourceReviewRequestId: normalizedSource.authority.reviewRequestId,
    sourceWriteSetDigest: normalizedSource.lease.admission.writeSetDigest,
    sourceManifestDigest: normalizedSource.lease.admission.manifestDigest,
    sourceDirtyDigest: normalizedSource.dirtyDigest,
    sourceChangedPaths: normalizedSource.changedPaths,
    targetCanonicalBaseSha: canonicalBaseSha,
    targetManifestDigest: target.manifestDigest,
    targetWriteSetDigest: target.writeSetDigest,
    targetDeclaredWriteSet: target.declaredWriteSet,
    targetCloudLeaseEpoch: 1,
    ...(protectedMain ? { canonicalDescendantProof: protectedMain } : {}),
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function authorizeActiveDirtyScopeExpansion({ plan, authorization }) {
  const normalized = normalizePlan(plan);
  const expected = `authorize scope-expansion ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Scope expansion requires the exact typed authorization: ${expected}`);
  }
  return Object.freeze({
    schema: "agentic-active-dirty-scope-expansion-authorization/v1",
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue({
      schema: "agentic-active-dirty-scope-expansion-authorization/v1",
      planDigest: normalized.planDigest,
      authorization: expected,
    }),
  });
}

export function verifyWaitingSuccessor({ plan, result }) {
  const normalized = normalizePlan(plan);
  const claim = result?.claim;
  if (
    result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "claim"
    || claim?.state !== "waiting-successor"
    || !DIGEST_PATTERN.test(String(claim.claimId || ""))
    || claim.predecessorClaimId !== normalized.sourceClaimId
    || claim.canonicalBaseRevision !== normalized.targetCanonicalBaseSha
    || claim.laneRevision !== normalized.sourceFenceSha
    || claim.writeSetDigest !== normalized.targetWriteSetDigest
    || claim.leaseEpoch !== 1
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(normalized.targetDeclaredWriteSet)
  ) {
    throw new Error("Cloud successor is not the exact waiting scope-expansion claim.");
  }
  return Object.freeze({
    claimId: claim.claimId,
    claimDigest: requiredDigest(result.claimDigest || claim.fenceRevision, "successor claim digest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "successor ledger revision"),
    claimLedgerRevision: requiredDigest(claim.transitionDigest, "successor claim ledger revision"),
    transitionCounter: positiveInteger(claim.transitionCounter, "successor transition counter"),
    expiresAt: requiredInstant(claim.expiresAt, "successor expiry"),
  });
}

export function verifyPromotedSuccessor({ plan, result, waiting }) {
  const normalized = normalizePlan(plan);
  const claim = result?.claim;
  if (
    result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "continue"
    || claim?.claimId !== waiting.claimId
    || claim.state !== "current"
    || claim.canonicalBaseRevision !== normalized.targetCanonicalBaseSha
    || claim.laneRevision !== normalized.sourceFenceSha
    || claim.writeSetDigest !== normalized.targetWriteSetDigest
    || claim.leaseEpoch !== 1
    || claim.transitionCounter !== waiting.transitionCounter + 1
  ) {
    throw new Error("Cloud successor promotion did not preserve the exact expansion identity.");
  }
  return Object.freeze({
    claimId: claim.claimId,
    claimDigest: requiredDigest(result.claimDigest || claim.fenceRevision, "promoted claim digest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "promoted ledger revision"),
    claimLedgerRevision: requiredDigest(claim.transitionDigest, "promoted claim ledger revision"),
    transitionCounter: positiveInteger(claim.transitionCounter, "promoted transition counter"),
    expiresAt: requiredInstant(claim.expiresAt, "promoted expiry"),
  });
}

export function verifyBoundSuccessor({ plan, authority, reviewRequestId }) {
  const normalized = normalizePlan(plan);
  if (
    authority?.schema !== "agentic-lane-cloud-authority/v1"
    || !DIGEST_PATTERN.test(String(authority.claimId || ""))
    || authority.canonicalBaseSha !== normalized.targetCanonicalBaseSha
    || authority.laneRevision !== normalized.sourceFenceSha
    || authority.writeSetDigest !== normalized.targetWriteSetDigest
    || authority.leaseEpoch !== 1
    || authority.state !== "active"
    || authority.reviewRequestId !== requiredText(reviewRequestId, "review request ID")
  ) {
    throw new Error("Bound successor authority does not match the exact scope-expansion plan.");
  }
  return authority;
}

export function buildExpansionReceipt({ phase, plan, values = {} }) {
  const normalized = normalizePlan(plan);
  const core = {
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_RECEIPT_SCHEMA,
    phase: requiredPhase(phase),
    planDigest: normalized.planDigest,
    sourceClaimId: normalized.sourceClaimId,
    sourceLeaseDigest: normalized.sourceLeaseDigest,
    targetWriteSetDigest: normalized.targetWriteSetDigest,
    targetManifestDigest: normalized.targetManifestDigest,
    ...values,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeActiveDirtyScopeExpansionPlan(value) {
  return normalizePlan(value);
}

function normalizeSource(source) {
  const lease = source?.lease;
  const authority = lease?.cloudAuthority;
  if (
    lease?.schema !== "agentic-writer-lease/v2"
    || lease.status !== "active"
    || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "admitted"
    || authority?.schema !== "agentic-lane-cloud-authority/v1"
    || authority.state !== "active"
    || !authority.reviewRequestId
    || lease.branch !== source?.branch
    || lease.fenceSha !== source?.fenceSha
    || authority.claimId !== source?.claimId
    || authority.claimDigest !== source?.claimDigest
    || authority.laneRevision !== source?.fenceSha
    || authority.writeSetDigest !== lease.admission.writeSetDigest
    || authority.canonicalBaseSha !== lease.baseSha
    || JSON.stringify(normalizeWriteSet(authority.cloudDeclaredWriteScope))
      !== JSON.stringify(normalizeWriteSet(lease.admission.declaredWriteSet))
  ) {
    throw new Error("Scope expansion requires one exact active admitted source lane.");
  }
  const scope = requiredText(lease.scope, "source scope");
  const changedPaths = [...new Set((source.changedPaths || []).map(path => requiredPath(path)))].sort();
  if (changedPaths.length === 0 || (source.untrackedPaths || []).length > 0) {
    throw new Error("Scope expansion requires tracked dirty source bytes and no untracked source bytes.");
  }
  return {
    lease,
    authority,
    scope,
    branch: requiredText(source.branch, "source branch"),
    fenceSha: requiredSha(source.fenceSha, "source fence SHA"),
    changedPaths,
    dirtyDigest: requiredDigest(source.dirtyDigest, "source dirty digest"),
  };
}

function normalizeTargetManifest(source, scope) {
  if (!source || typeof source !== "object") throw new Error("Target write-scope manifest is required.");
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  if (
    source.semanticScope !== scope
    || !declaredWriteSet.includes(`semantic:${scope}`)
    || source.writeSetDigest !== digestValue(declaredWriteSet)
    || !DIGEST_PATTERN.test(String(source.manifestDigest || ""))
  ) {
    throw new Error("Target manifest is malformed or changes the source semantic scope.");
  }
  return {
    semanticScope: scope,
    declaredWriteSet,
    writeSetDigest: source.writeSetDigest,
    manifestDigest: source.manifestDigest,
  };
}

function normalizePlan(value) {
  if (!value || typeof value !== "object" || value.schema !== ACTIVE_DIRTY_SCOPE_EXPANSION_PLAN_SCHEMA) {
    throw new Error("Scope-expansion plan is malformed.");
  }
  const protectedMain = value.canonicalDescendantProof
    ? normalizeActiveDirtyScopeExpansionCanonicalDescendantProof(value.canonicalDescendantProof)
    : null;
  const core = {
    schema: ACTIVE_DIRTY_SCOPE_EXPANSION_PLAN_SCHEMA,
    sourceBranch: requiredText(value.sourceBranch, "source branch"),
    sourceFenceSha: requiredSha(value.sourceFenceSha, "source fence SHA"),
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "source lease digest"),
    sourceClaimId: requiredDigest(value.sourceClaimId, "source claim ID"),
    sourceClaimDigest: requiredDigest(value.sourceClaimDigest, "source claim digest"),
    sourceClaimTransitionCounter: positiveInteger(value.sourceClaimTransitionCounter, "source transition counter"),
    sourceReviewRequestId: requiredText(value.sourceReviewRequestId, "source review request ID"),
    sourceWriteSetDigest: requiredDigest(value.sourceWriteSetDigest, "source write-set digest"),
    sourceManifestDigest: requiredDigest(value.sourceManifestDigest, "source manifest digest"),
    sourceDirtyDigest: requiredDigest(value.sourceDirtyDigest, "source dirty digest"),
    sourceChangedPaths: [...new Set((value.sourceChangedPaths || []).map(path => requiredPath(path)))].sort(),
    targetCanonicalBaseSha: requiredSha(value.targetCanonicalBaseSha, "target canonical base SHA"),
    targetManifestDigest: requiredDigest(value.targetManifestDigest, "target manifest digest"),
    targetWriteSetDigest: requiredDigest(value.targetWriteSetDigest, "target write-set digest"),
    targetDeclaredWriteSet: normalizeWriteSet(value.targetDeclaredWriteSet),
    targetCloudLeaseEpoch: positiveInteger(value.targetCloudLeaseEpoch, "target cloud lease epoch"),
    ...(protectedMain ? { canonicalDescendantProof: protectedMain } : {}),
  };
  if (
    core.targetCloudLeaseEpoch !== 1
    || core.targetWriteSetDigest !== digestValue(core.targetDeclaredWriteSet)
    || (protectedMain && protectedMain.sourceBaseSha !== core.targetCanonicalBaseSha)
    || value.planDigest !== digestValue(core)
  ) {
    throw new Error("Scope-expansion plan digest or cloud epoch is invalid.");
  }
  return Object.freeze({ ...core, planDigest: value.planDigest });
}

function strictSubset(left, right) {
  return left.length < right.length && left.every(value => right.includes(value));
}

function writeSetCoversPath(writeSet, changedPath) {
  return writeSet.some((scope) => {
    if (!scope.startsWith("path:")) return false;
    const declaredPath = scope.slice("path:".length);
    // Coverage is directional: a directory owns descendants, while a narrower
    // descendant declaration must never authorize mutation of its parent.
    return declaredPath === "."
      || changedPath === declaredPath
      || changedPath.startsWith(`${declaredPath}/`);
  });
}

function requiredPath(value) {
  const [scope] = normalizeWriteSet([`path:${requiredText(value, "changed path")}`]);
  const path = scope.slice("path:".length);
  if (path === ".") throw new Error("Changed source path must identify a repository entry.");
  return path;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function requiredSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return String(value);
}

function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}

function requiredInstant(value, label) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO-8601 instant.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requiredPhase(value) {
  const phases = new Set([
    "preflight", "intent", "waiting-successor", "source-retired", "promoted",
    "successor-bound", "local-cas", "pr-marker", "complete",
  ]);
  if (!phases.has(value)) throw new Error("Scope-expansion receipt phase is invalid.");
  return value;
}
