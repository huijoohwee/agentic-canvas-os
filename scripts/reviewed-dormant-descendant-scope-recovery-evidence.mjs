// Responsibility: Seal the exact reviewed, dormant, clean-descendant lane evidence and target scope.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-reviewed-dormant-descendant-scope-recovery-evidence/v1";
export const PROTECTED_MAIN_PROOF_SCHEMA =
  "agentic-reviewed-dormant-descendant-protected-main-disjoint-proof/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function deriveReviewedDormantDescendantTargetManifest({
  sourceManifest,
  descendantPaths,
} = {}) {
  const source = normalizeDeclaredWriteScopeManifest(sourceManifest);
  const paths = uniquePaths(descendantPaths, "descendant paths");
  const uncovered = paths.filter(candidate => !covers(source.declaredWriteSet, candidate));
  if (uncovered.length === 0) invalid("strict target scope expansion");
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: source.semanticScope,
    paths: [...source.paths, ...uncovered],
  }, { expectedScope: source.semanticScope });
}

export function sealReviewedDormantDescendantScopeRecoveryEvidence(value = {}) {
  const core = normalizeCore(value);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeReviewedDormantDescendantScopeRecoveryEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  exactKeys(value, [...CORE_KEYS, "evidenceDigest"], "evidence");
  const core = normalizeCore(value);
  if (requiredDigest(value.evidenceDigest, "evidence digest") !== digestValue(core)) {
    invalid("evidence digest");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}

const CORE_KEYS = Object.freeze([
  "schema", "repository", "branch", "sourceSessionId", "sourceLease",
  "sourceLeaseDigest", "taskCapabilityDigest", "sourceClaim", "sourceClaimDigest",
  "cloudInventoryDigest", "overlapClaimIds", "pullRequest", "reviewedHeadSha",
  "reviewedTreeSha", "localHeadSha", "localTreeSha", "remoteHeadSha",
  "descendantCommits", "descendantCommitsDigest", "descendantPaths",
  "descendantPathsDigest", "descendantPatchDigest", "sourceManifest", "targetManifest",
  "protectedMainProof", "gitSnapshot", "observedAt",
]);

function normalizeCore(value) {
  const sourceLease = plain(value.sourceLease, "source lease");
  const sourceClaim = plain(value.sourceClaim, "source claim");
  const branch = text(value.branch, "branch");
  const sourceSessionId = text(value.sourceSessionId, "source session");
  const sourceManifest = normalizeDeclaredWriteScopeManifest(value.sourceManifest);
  const targetManifest = normalizeDeclaredWriteScopeManifest(value.targetManifest, {
    expectedScope: sourceManifest.semanticScope,
  });
  const reviewedHeadSha = sha(value.reviewedHeadSha, "reviewed head");
  const localHeadSha = sha(value.localHeadSha, "local head");
  const descendantCommits = uniqueShas(value.descendantCommits, "descendant commits");
  const descendantPaths = uniquePaths(value.descendantPaths, "descendant paths");
  const expectedTarget = deriveReviewedDormantDescendantTargetManifest({
    sourceManifest,
    descendantPaths,
  });
  if (canonicalJson(targetManifest) !== canonicalJson(expectedTarget)) {
    invalid("exact target manifest");
  }
  const core = {
    schema: EVIDENCE_SCHEMA,
    repository: repository(value.repository),
    branch,
    sourceSessionId,
    sourceLease,
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "source lease digest"),
    taskCapabilityDigest: requiredDigest(value.taskCapabilityDigest, "task capability digest"),
    sourceClaim,
    sourceClaimDigest: requiredDigest(value.sourceClaimDigest, "source claim digest"),
    cloudInventoryDigest: requiredDigest(value.cloudInventoryDigest, "cloud inventory digest"),
    overlapClaimIds: emptyDigests(value.overlapClaimIds, "overlap claim IDs"),
    pullRequest: pullRequest(value.pullRequest),
    reviewedHeadSha,
    reviewedTreeSha: sha(value.reviewedTreeSha, "reviewed tree"),
    localHeadSha,
    localTreeSha: sha(value.localTreeSha, "local tree"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head"),
    descendantCommits,
    descendantCommitsDigest: requiredDigest(
      value.descendantCommitsDigest,
      "descendant commits digest",
    ),
    descendantPaths,
    descendantPathsDigest: requiredDigest(value.descendantPathsDigest, "descendant paths digest"),
    descendantPatchDigest: requiredDigest(value.descendantPatchDigest, "descendant patch digest"),
    sourceManifest,
    targetManifest,
    protectedMainProof: protectedMainProof(value.protectedMainProof, targetManifest),
    gitSnapshot: gitSnapshot(value.gitSnapshot),
    observedAt: instant(value.observedAt, "observation time"),
  };
  requireJoins(core);
  return deepFreeze(core);
}

function requireJoins(value) {
  const claim = value.sourceClaim;
  const lease = value.sourceLease;
  const pull = value.pullRequest;
  if (value.sourceLeaseDigest !== digestValue(lease)
    || value.sourceClaimDigest !== digestValue(claim)
    || lease.schema !== "agentic-writer-lease/v2"
    || lease.branch !== value.branch
    || lease.sessionId !== value.sourceSessionId
    || lease.fenceSha !== value.reviewedHeadSha
    || claim.claimId === undefined || !DIGEST.test(String(claim.claimId))
    || claim.state !== "dormant-preserved"
    || claim.writeAuthority !== false
    || claim.scopeReserved !== true
    || claim.transitionCounter !== 3
    || !Number.isSafeInteger(claim.leaseEpoch) || claim.leaseEpoch < 1
    || claim.sessionId !== value.sourceSessionId
    || claim.laneRevision !== value.reviewedHeadSha
    || claim.canonicalBaseRevision !== value.protectedMainProof.sourceBaseSha
    || claim.writeSetDigest !== value.sourceManifest.writeSetDigest
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(value.sourceManifest.declaredWriteSet)
    || claim.reviewRequestId !== `github-pull-request:${pull.id}`) {
    invalid("source lease and dormant claim joins");
  }
  if (pull.state !== "OPEN" || pull.isDraft !== false || pull.autoMergeRequest !== null
    || pull.headBranch !== value.branch || pull.headSha !== value.reviewedHeadSha
    || value.remoteHeadSha !== value.reviewedHeadSha
    || value.localHeadSha === value.reviewedHeadSha
    || value.descendantCommits.length !== 6
    || value.descendantCommits.at(-1) !== value.localHeadSha
    || value.descendantCommits.includes(value.reviewedHeadSha)
    || value.descendantCommitsDigest !== digestValue(value.descendantCommits)
    || value.descendantPathsDigest !== digestValue(value.descendantPaths)
    || value.gitSnapshot.headSha !== value.localHeadSha
    || value.gitSnapshot.indexTreeSha !== value.localTreeSha
    || value.gitSnapshot.localRefSha !== value.localHeadSha
    || value.gitSnapshot.remoteRefSha !== value.reviewedHeadSha) {
    invalid("reviewed descendant and Git snapshot joins");
  }
}

function repository(value) {
  const result = {
    fullName: text(value?.fullName, "repository name"),
    nodeId: text(value?.nodeId, "repository node ID"),
  };
  exactKeys(value, Object.keys(result), "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result.fullName)) {
    invalid("repository name");
  }
  return Object.freeze(result);
}

function pullRequest(value) {
  const result = {
    id: text(value?.id, "pull-request ID"),
    number: positiveInteger(value?.number, "pull-request number"),
    url: text(value?.url, "pull-request URL"),
    state: value?.state === "OPEN" ? "OPEN" : invalid("pull-request state"),
    isDraft: value?.isDraft === false ? false : invalid("pull-request review state"),
    autoMergeRequest: value?.autoMergeRequest === null ? null : invalid("pull-request auto merge"),
    headBranch: text(value?.headBranch, "pull-request branch"),
    headSha: sha(value?.headSha, "pull-request head"),
    baseSha: sha(value?.baseSha, "pull-request base"),
    bodyDigest: requiredDigest(value?.bodyDigest, "pull-request body digest"),
    bodyRemainderDigest: requiredDigest(
      value?.bodyRemainderDigest,
      "pull-request body remainder digest",
    ),
    markerDigest: requiredDigest(value?.markerDigest, "pull-request marker digest"),
  };
  exactKeys(value, Object.keys(result), "pull request");
  return Object.freeze(result);
}

function protectedMainProof(value, targetManifest) {
  const core = {
    schema: value?.schema === PROTECTED_MAIN_PROOF_SCHEMA
      ? PROTECTED_MAIN_PROOF_SCHEMA : invalid("protected-main proof schema"),
    sourceBaseSha: sha(value?.sourceBaseSha, "protected-main source base"),
    sourceBaseTreeSha: sha(value?.sourceBaseTreeSha, "protected-main source tree"),
    protectedMainSha: sha(value?.protectedMainSha, "protected-main head"),
    protectedMainTreeSha: sha(value?.protectedMainTreeSha, "protected-main tree"),
    sourceBaseAncestorOfProtectedMain: value?.sourceBaseAncestorOfProtectedMain === true
      ? true : invalid("protected-main ancestry"),
    changedPaths: uniquePaths(value?.changedPaths, "protected-main changed paths"),
    changedPathsDigest: requiredDigest(
      value?.changedPathsDigest,
      "protected-main changed paths digest",
    ),
    targetWriteSetDigest: requiredDigest(
      value?.targetWriteSetDigest,
      "protected-main target write-set digest",
    ),
    overlap: value?.overlap === "none" ? "none" : invalid("protected-main overlap"),
  };
  exactKeys(value, [...Object.keys(core), "evidenceDigest"], "protected-main proof");
  if (core.sourceBaseSha === core.protectedMainSha
    || core.changedPaths.length === 0
    || core.changedPathsDigest !== digestValue(core.changedPaths)
    || core.targetWriteSetDigest !== targetManifest.writeSetDigest
    || core.changedPaths.some(candidate => writeSetsOverlap(
      [`path:${candidate}`],
      targetManifest.declaredWriteSet,
    ))
    || requiredDigest(value.evidenceDigest, "protected-main proof digest") !== digestValue(core)) {
    invalid("protected-main proof semantics");
  }
  return Object.freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function gitSnapshot(value) {
  const result = {
    headSha: sha(value?.headSha, "snapshot head"),
    indexTreeSha: sha(value?.indexTreeSha, "snapshot index tree"),
    statusDigest: requiredDigest(value?.statusDigest, "snapshot status digest"),
    localRefSha: sha(value?.localRefSha, "snapshot local ref"),
    remoteRefSha: sha(value?.remoteRefSha, "snapshot remote ref"),
    clean: value?.clean === true ? true : invalid("snapshot cleanliness"),
  };
  exactKeys(value, Object.keys(result), "Git snapshot");
  return Object.freeze(result);
}

function covers(writeSet, candidate) {
  return writeSet.some(item => item.startsWith("path:") && (
    item.slice(5) === "."
    || item.slice(5) === candidate
    || candidate.startsWith(`${item.slice(5).replace(/\/$/u, "")}/`)
  ));
}
function uniquePaths(values, label) {
  if (!Array.isArray(values)) invalid(label);
  const result = [...new Set(values.map(value => text(value, label)))].sort();
  if (result.length === 0 || result.length !== values.length || result.some(value => (
    value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")
  ))) invalid(label);
  return Object.freeze(result);
}
function uniqueShas(values, label) {
  if (!Array.isArray(values)) invalid(label);
  const result = values.map(value => sha(value, label));
  if (result.length === 0 || new Set(result).size !== result.length) invalid(label);
  return Object.freeze(result);
}
function emptyDigests(values, label) {
  if (!Array.isArray(values) || values.length !== 0) invalid(label);
  return Object.freeze([]);
}
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return structuredClone(value);
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function sha(value, label) {
  const result = text(value, label);
  if (!SHA.test(result)) invalid(label);
  return result;
}
function requiredDigest(value, label) {
  const result = text(value, label);
  if (!DIGEST.test(result)) invalid(label);
  return result;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function instant(value, label) {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) invalid(label);
  return result;
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) {
  throw new Error(`Reviewed dormant descendant recovery has invalid ${label}.`);
}
