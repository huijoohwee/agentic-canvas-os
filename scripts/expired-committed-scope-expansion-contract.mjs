import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const PLAN_SCHEMA = "agentic-expired-committed-scope-expansion-plan/v1";
export const RESULT_SCHEMA = "agentic-expired-committed-scope-expansion-result/v1";
export const INTENT_SCHEMA = "agentic-expired-committed-scope-expansion-intent/v1";
const PHASES = ["intent", "waiting-successor", "source-retired", "promoted", "successor-bound", "local-cas", "pr-marker", "complete"];

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildExpiredCommittedScopeExpansionPlan({
  lease,
  sourceClaim,
  headSha,
  localHeadTreeSha,
  parentSha,
  remoteHeadSha,
  pullRequest,
  authoredPaths,
  targetManifest,
  protectedMainIncorporationProof,
  evaluatedAt = new Date().toISOString(),
} = {}) {
  requireSourceLease({ lease, evaluatedAt });
  const sourceAuthority = lease.cloudAuthority;
  const target = requireTargetManifest(targetManifest, lease.scope);
  const sourceWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
  const paths = uniquePaths(authoredPaths);
  const head = requiredSha(headSha, "local committed head");
  const parent = requiredSha(parentSha, "local committed parent");
  const remote = requiredSha(remoteHeadSha, "remote branch head");
  if (head === remote || parent !== lease.fenceSha || remote !== lease.fenceSha) {
    throw new Error("Recovery requires one clean unpublished commit directly above the exact source fence.");
  }
  if (paths.length === 0 || !paths.every(path => covers(target.declaredWriteSet, path))) {
    throw new Error("Committed recovery paths must be non-empty and entirely covered by the target scope.");
  }
  if (!strictSubset(sourceWriteSet, target.declaredWriteSet)
    || paths.every(path => covers(sourceWriteSet, path))) {
    throw new Error("Recovery requires a strict scope expansion used by the committed descendant.");
  }
  requireDormantClaim({ claim: sourceClaim, lease, evaluatedAt });
  if (pullRequest?.state !== "OPEN" || pullRequest.isDraft !== true
    || pullRequest.headRefOid !== remote || !pullRequest.id) {
    throw new Error("Recovery requires the exact open draft pull request at the source fence.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    sourceBranch: lease.branch,
    sourceScope: lease.scope,
    sourceSessionId: lease.sessionId,
    sourceDevice: lease.device,
    sourceLeaseEpoch: lease.epoch,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: sourceClaim.claimId,
    sourceClaimDigest: requiredDigest(sourceClaim.fenceRevision, "source claim digest"),
    sourceClaimTransitionCounter: positiveInteger(sourceClaim.transitionCounter, "source transition counter"),
    sourceFenceSha: lease.fenceSha,
    sourceBaseSha: lease.baseSha,
    sourceWriteSetDigest: lease.admission.writeSetDigest,
    sourceManifestDigest: lease.admission.manifestDigest,
    localHeadSha: head,
    localHeadTreeSha: requiredSha(localHeadTreeSha, "local head tree"),
    authoredPaths: paths,
    pullRequestUrl: pullRequest.url,
    reviewRequestId: pullRequest.id,
    targetCanonicalBaseSha: lease.baseSha,
    targetDeclaredWriteSet: target.declaredWriteSet,
    targetWriteSetDigest: target.writeSetDigest,
    targetManifestDigest: target.manifestDigest,
    protectedMainIncorporationProof: normalizeProtectedMainIncorporationProof(
      protectedMainIncorporationProof,
      lease,
      target.writeSetDigest,
    ),
    targetCloudLeaseEpoch: 1,
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function authorizeExpiredCommittedScopeExpansion(plan, authorization) {
  const normalized = normalizeExpiredCommittedScopeExpansionPlan(plan);
  const expected = `authorize expired-committed-scope-expansion ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Recovery requires the exact authorization: ${expected}`);
  }
  return Object.freeze({
    schema: "agentic-expired-committed-scope-expansion-authorization/v1",
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue({ planDigest: normalized.planDigest, authorization: expected }),
  });
}

export function normalizeExpiredCommittedScopeExpansionPlan(value) {
  if (value?.schema !== PLAN_SCHEMA) throw new Error("Expired committed scope-expansion plan is malformed.");
  const core = {
    schema: PLAN_SCHEMA,
    sourceBranch: requiredText(value.sourceBranch, "source branch"),
    sourceScope: requiredText(value.sourceScope, "source scope"),
    sourceSessionId: requiredText(value.sourceSessionId, "source session"),
    sourceDevice: requiredText(value.sourceDevice, "source device"),
    sourceLeaseEpoch: positiveInteger(value.sourceLeaseEpoch, "source lease epoch"),
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "source lease digest"),
    sourceClaimId: requiredDigest(value.sourceClaimId, "source claim ID"),
    sourceClaimDigest: requiredDigest(value.sourceClaimDigest, "source claim digest"),
    sourceClaimTransitionCounter: positiveInteger(value.sourceClaimTransitionCounter, "source transition counter"),
    sourceFenceSha: requiredSha(value.sourceFenceSha, "source fence"),
    sourceBaseSha: requiredSha(value.sourceBaseSha, "source base"),
    sourceWriteSetDigest: requiredDigest(value.sourceWriteSetDigest, "source write-set digest"),
    sourceManifestDigest: requiredDigest(value.sourceManifestDigest, "source manifest digest"),
    localHeadSha: requiredSha(value.localHeadSha, "local head"),
    localHeadTreeSha: requiredSha(value.localHeadTreeSha, "local head tree"),
    authoredPaths: uniquePaths(value.authoredPaths),
    pullRequestUrl: requiredText(value.pullRequestUrl, "pull-request URL"),
    reviewRequestId: requiredText(value.reviewRequestId, "review request ID"),
    targetCanonicalBaseSha: requiredSha(value.targetCanonicalBaseSha, "target canonical base"),
    targetDeclaredWriteSet: normalizeWriteSet(value.targetDeclaredWriteSet),
    targetWriteSetDigest: requiredDigest(value.targetWriteSetDigest, "target write-set digest"),
    targetManifestDigest: requiredDigest(value.targetManifestDigest, "target manifest digest"),
    protectedMainIncorporationProof:
      normalizeProtectedMainIncorporationProof(value.protectedMainIncorporationProof, {
        baseSha: value.sourceBaseSha,
        fenceSha: value.sourceFenceSha,
      }, value.targetWriteSetDigest),
    targetCloudLeaseEpoch: positiveInteger(value.targetCloudLeaseEpoch, "target cloud epoch"),
  };
  if (core.targetCloudLeaseEpoch !== 1
    || core.targetWriteSetDigest !== digestValue(core.targetDeclaredWriteSet)
    || value.planDigest !== digestValue(core)) {
    throw new Error("Expired committed scope-expansion plan digest drifted.");
  }
  return Object.freeze({ ...core, planDigest: value.planDigest });
}

export function manifestFromExpiredCommittedPlan(plan) {
  const value = normalizeExpiredCommittedScopeExpansionPlan(plan);
  return Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: value.sourceScope,
    paths: value.targetDeclaredWriteSet.filter(item => item.startsWith("path:")).map(item => item.slice(5)),
    declaredWriteSet: value.targetDeclaredWriteSet,
    writeSetDigest: value.targetWriteSetDigest,
    manifestDigest: value.targetManifestDigest,
  });
}

export function readExpiredCommittedScopeExpansionIntent({ store, branch }) {
  const value = store.readRegistry()?.expiredCommittedScopeExpansionIntents?.[branch] || null;
  if (!value) return null;
  if (value.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)
    || value.planSnapshot?.planDigest !== value.planDigest) {
    throw new Error("Expired committed scope-expansion intent is malformed.");
  }
  return Object.freeze(value);
}

export function beginExpiredCommittedScopeExpansionIntent({
  store, branch, expectedLeaseDigest, expectedClaimId, plan,
}) {
  let intent;
  mutateWriterLeaseRegistry({
    leaseStore: store, branch, expectedLeaseDigest, expectedClaimId,
    action: ({ registry, lease }) => {
      const existing = registry.expiredCommittedScopeExpansionIntents?.[branch] || null;
      if (existing && existing.planDigest !== plan.planDigest) {
        throw new Error("Another expired committed scope-expansion intent fences this branch.");
      }
      intent = existing || Object.freeze({
        schema: INTENT_SCHEMA, status: "intent", branch,
        sourceLeaseDigest: expectedLeaseDigest, sourceClaimId: expectedClaimId,
        sourceFenceSha: plan.sourceFenceSha,
        targetWriteSetDigest: plan.targetWriteSetDigest,
        targetManifestDigest: plan.targetManifestDigest,
        planDigest: plan.planDigest, targetClaimId: null, targetClaimDigest: null,
        targetLeaseEpoch: 1, targetCanonicalBaseSha: plan.targetCanonicalBaseSha,
        targetReviewRequestId: null, completedReceiptDigest: null, planSnapshot: plan,
      });
      return {
        registry: existing ? registry : {
          ...registry,
          expiredCommittedScopeExpansionIntents: {
            ...(registry.expiredCommittedScopeExpansionIntents || {}), [branch]: intent,
          },
        },
        lease, intent, changed: !existing,
      };
    },
  });
  return intent;
}

export function advanceExpiredCommittedScopeExpansionIntent({
  store, branch, expectedLeaseDigest, expectedClaimId, expectedPlanDigest, values,
}) {
  let intent;
  mutateWriterLeaseRegistry({
    leaseStore: store, branch, expectedLeaseDigest, expectedClaimId,
    action: ({ registry, lease }) => {
      const current = registry.expiredCommittedScopeExpansionIntents?.[branch];
      if (current?.schema !== INTENT_SCHEMA || current.planDigest !== expectedPlanDigest) {
        throw new Error("Expired committed scope-expansion intent changed before CAS.");
      }
      intent = Object.freeze({ ...current, ...values, schema: INTENT_SCHEMA, branch });
      return {
        registry: {
          ...registry,
          expiredCommittedScopeExpansionIntents: {
            ...(registry.expiredCommittedScopeExpansionIntents || {}), [branch]: intent,
          },
        },
        lease, intent, changed: digestValue(current) !== digestValue(intent),
      };
    },
  });
  return { intent };
}

export function disposeSupersededScopeExpansionIntent({ registry, lease, plan }) {
  const intents = { ...(registry.scopeExpansionIntents || {}) };
  const prior = intents[plan.sourceBranch];
  if (!prior) return intents;
  if (prior.status !== "pr-marker"
    || prior.targetWriteSetDigest !== lease.admission.writeSetDigest
    || prior.targetManifestDigest !== lease.admission.manifestDigest
    || prior.targetClaimId === plan.sourceClaimId
    || prior.targetCanonicalBaseSha !== plan.sourceBaseSha) {
    throw new Error("Prior scope-expansion intent is not the exact superseded source projection.");
  }
  delete intents[plan.sourceBranch];
  return intents;
}

function normalizeProtectedMainIncorporationProof(value, lease, targetWriteSetDigest) {
  const core = {
    schema: value?.schema,
    sourceBaseSha: requiredSha(value?.sourceBaseSha, "proof source base"),
    protectedMainSha: requiredSha(value?.protectedMainSha, "proof protected main"),
    protectedMainTreeSha: requiredSha(value?.protectedMainTreeSha, "proof protected tree"),
    fenceSha: requiredSha(value?.fenceSha, "proof fence"),
    fenceTreeSha: requiredSha(value?.fenceTreeSha, "proof fence tree"),
    sourceBaseAncestorOfProtectedMain: value?.sourceBaseAncestorOfProtectedMain,
    sourceBaseAncestorOfFence: value?.sourceBaseAncestorOfFence,
    protectedMainAncestorOfFence: value?.protectedMainAncestorOfFence,
    protectedMainChangedPaths: uniquePaths(value?.protectedMainChangedPaths),
    protectedMainChangedPathsDigest: requiredDigest(
      value?.protectedMainChangedPathsDigest,
      "proof changed-path digest",
    ),
    ...(value?.schema === "agentic-protected-main-disjoint-fence-advance/v1" ? {
      targetDeclaredWriteSet: normalizeWriteSet(value?.targetDeclaredWriteSet),
      targetWriteSetDigest: requiredDigest(value?.targetWriteSetDigest, "proof target write-set digest"),
      overlap: value?.overlap,
    } : {}),
  };
  const incorporated = core.schema === "agentic-protected-main-incorporated-fence/v1";
  const disjointAdvance = core.schema === "agentic-protected-main-disjoint-fence-advance/v1";
  if ((!incorporated && !disjointAdvance)
    || core.sourceBaseSha !== lease.baseSha || core.fenceSha !== lease.fenceSha
    || core.sourceBaseAncestorOfProtectedMain !== true
    || core.sourceBaseAncestorOfFence !== true
    || (incorporated && core.protectedMainAncestorOfFence !== true)
    || (disjointAdvance && core.protectedMainAncestorOfFence !== false)
    || core.protectedMainChangedPaths.length === 0
    || core.protectedMainChangedPathsDigest !== digestValue(core.protectedMainChangedPaths)
    || (disjointAdvance && (
      core.targetWriteSetDigest !== targetWriteSetDigest
      || core.targetWriteSetDigest !== digestValue(core.targetDeclaredWriteSet)
      || core.overlap !== "none"
      || core.protectedMainChangedPaths.some(candidate => writeSetsOverlap(
        [`path:${candidate}`], core.targetDeclaredWriteSet,
      ))
    ))
    || value.evidenceDigest !== digestValue(core)) {
    throw new Error("Protected-main incorporation proof is invalid.");
  }
  return Object.freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function requireSourceLease({ lease, evaluatedAt }) {
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.admission?.status !== "admitted" || !lease.cloudAuthority?.claimId
    || Date.parse(lease.expiresAt) >= Date.parse(evaluatedAt)) {
    throw new Error("Recovery requires one expired active admitted source lease.");
  }
}

function requireDormantClaim({ claim, lease, evaluatedAt }) {
  if (!claim || claim.claimId !== lease.cloudAuthority.claimId
    || !["parked", "dormant", "dormant-preserved"].includes(claim.state)
    || claim.laneRevision !== lease.fenceSha
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || Date.parse(claim.expiresAt) >= Date.parse(evaluatedAt)) {
    throw new Error("Recovery requires the exact dormant expired cloud predecessor.");
  }
}

function requireTargetManifest(value, scope) {
  if (value?.semanticScope !== scope || value.writeSetDigest !== digestValue(value.declaredWriteSet)) {
    throw new Error("Target manifest changes the lane scope or has an invalid digest.");
  }
  return { ...value, declaredWriteSet: normalizeWriteSet(value.declaredWriteSet) };
}

function strictSubset(left, right) {
  return left.length < right.length && left.every(item => right.includes(item));
}

function covers(writeSet, repositoryPath) {
  return writeSet.some(item => item.startsWith("path:")
    && (repositoryPath === item.slice(5) || repositoryPath.startsWith(`${item.slice(5).replace(/\/$/u, "")}/`)));
}

function uniquePaths(values) {
  const result = [...new Set((values || []).map(value => requiredText(value, "repository path")))].sort();
  if (result.some(value => value.startsWith("/") || value.includes(".."))) throw new Error("Repository paths must be relative.");
  return result;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function requiredSha(value, label) {
  if (!SHA.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return String(value);
}

function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} must be a digest.`);
  return String(value);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
