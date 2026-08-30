// Responsibility: Seal one exact active-owned-dirt current-base reanchor and its replay journal.
import { canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { pseudonymousIdentifier }
  from "./github-cloud-collaboration-mapping.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";

export const OPERATION = "active-owned-dirt-current-base-reanchor";
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const EFFECT_SCHEMA = `agentic-${OPERATION}-effect/v1`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;

export const PHASES = Object.freeze([
  "authorized",
  "source-authorized",
  "snapshotted",
  "reanchor-prepared",
  "successor-waiting",
  "source-retired",
  "successor-current",
  "local-reanchored",
  "remote-reanchored",
  "successor-bound",
  "local-cas",
  "pr-projected",
  "verified",
  "complete",
]);

const DIGEST = /^[0-9a-f]{64}$/u;
const OBJECT_ID = /^[0-9a-f]{40,64}$/u;

export function buildReanchorPlan({ evidence, ttlSeconds = 1_800 } = {}) {
  const source = normalizeReanchorEvidence(evidence);
  const ttl = boundedTtl(ttlSeconds);
  const lease = source.lease;
  const claim = source.sourceClaim;
  const reanchor = source.reanchor;
  const targetCloudLeaseEpoch = source.targetEpochProof.targetCloudLeaseEpoch;
  const planExpiresAt = new Date(Math.min(
    Date.parse(source.operationAt) + ttl * 1_000,
    Date.parse(claim.expiresAt),
    Date.parse(lease.expiresAt),
  )).toISOString();
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    operationAt: source.operationAt,
    planExpiresAt,
    ttlSeconds: ttl,
    branch: lease.branch,
    sessionId: lease.sessionId,
    device: lease.device,
    scope: lease.scope,
    sourceLeaseDigest: source.leaseDigest,
    sourceBaseSha: lease.baseSha,
    sourceFenceSha: lease.fenceSha,
    sourceClaimId: claim.claimId,
    sourceClaimDigest: claim.fenceRevision,
    sourceClaimTransitionCounter: claim.transitionCounter,
    sourceCloudLeaseEpoch: claim.leaseEpoch,
    sourceTaskBindingDigest: lease.taskAuthority.bindingDigest,
    pullRequestId: source.pullRequest.id,
    pullRequestUrl: source.pullRequest.url,
    pullRequestNumber: source.pullRequest.number,
    pullRequestBodyDigest: source.pullRequest.bodyDigest,
    pullRequestBodyRemainderDigest: source.pullRequest.bodyRemainderDigest,
    targetCanonicalBaseSha: source.targetProtectedMain.protectedMainSha,
    targetLaneRevision: reanchor.coordination.commitSha,
    targetCloudLeaseEpoch,
    targetManifestDigest: lease.admission.manifestDigest,
    targetWriteSetDigest: lease.admission.writeSetDigest,
    targetDeclaredWriteSet: lease.admission.declaredWriteSet,
    protectedChangedPathsDigest: source.targetProtectedMain.changedPathsDigest,
    protectedChangedPathCount: source.targetProtectedMain.changedPaths.length,
    dirtyOverlapPathsDigest: source.targetProtectedMain.dirtyOverlapPathsDigest,
    dirtyOverlapPathCount: source.targetProtectedMain.dirtyOverlapPaths.length,
    sourceDirtEvidenceDigest: source.dirt.evidenceDigest,
    sourceDirtyPathCount: source.dirt.pathCount,
    sourceUntrackedPathCount: source.dirt.untrackedPathCount,
    coordinationCommitSha: reanchor.coordination.commitSha,
    coordinationTreeSha: reanchor.coordination.treeSha,
    coordinationParents: reanchor.coordination.parents,
    sourceIndexTreeSha: reanchor.sourceIndexTreeSha,
    sourceWorktreeTreeSha: reanchor.sourceWorktreeTreeSha,
    targetIndexTreeSha: reanchor.targetIndexTreeSha,
    targetWorktreeTreeSha: reanchor.targetWorktreeTreeSha,
    targetDirtEvidenceDigest: reanchor.targetDirt.evidenceDigest,
    dispositionsDigest: digestValue(reanchor.dispositions),
    ignoredRetentionDigest: digestValue(reanchor.ignoredRetention),
    allowedEffects: [
      "external-private-replay-journal",
      "task-authority-possession-proof",
      "owned-dirt-snapshot-ref",
      "deterministic-coordination-commit",
      "source-preserving-index-worktree-overlay",
      "exact-local-branch-reanchor",
      "exact-remote-force-with-lease-reanchor",
      "same-pull-request-current-base-projection",
      "same-scope-waiting-successor",
      "exact-source-claim-retirement",
      "successor-promotion-and-bind",
      "writer-lease-and-task-continuation-cas",
      "pull-request-marker-projection",
    ],
    forbiddenEffects: [
      "admitted-scope-change",
      "authored-byte-mode-or-deletion-change",
      "authored-commit",
      "pull-request-review",
      "pull-request-merge",
      "required-check-bypass",
      "deployment",
      "cleanup",
    ],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeReanchorPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildReanchorPlan({ evidence: value.evidence, ttlSeconds: value.ttlSeconds });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeReanchor({ plan, authorization } = {}) {
  const source = normalizeReanchorPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Reanchor requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    operation: OPERATION,
    status: "authorized",
    planDigest: source.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createReanchorIntent(plan, authorization) {
  const source = normalizeReanchorPlan(plan);
  const authority = authorizeReanchor({ plan: source, authorization });
  return sealIntent({
    phase: "authorized",
    plan: source,
    authority,
    receipts: {
      authorized: phaseReceipt(source, "authorized", null, {
        authorizationDigest: authority.authorizationDigest,
      }),
    },
    completion: null,
  });
}

export function advanceReanchorIntent(value, { phase, values } = {}) {
  const current = normalizeReanchorIntent(value);
  const from = PHASES.indexOf(current.phase);
  const to = PHASES.indexOf(phase);
  if (to !== from + 1) throw new Error("Reanchor cannot skip or regress a protected phase.");
  const receipts = {
    ...current.receipts,
    [phase]: phaseReceipt(current.planSnapshot, phase, current.intentDigest, values),
  };
  return sealIntent({
    phase,
    plan: current.planSnapshot,
    authority: current.authorization,
    receipts,
    completion: phase === "complete" ? values : null,
  });
}

export function normalizeReanchorIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) invalid("intent schema");
  const plan = normalizeReanchorPlan(value.planSnapshot);
  const authority = authorizeReanchor({ plan, authorization: value.authorization?.statement });
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  const receipts = {};
  let priorIntentDigest = null;
  for (const name of names) {
    receipts[name] = phaseReceipt(plan, name, priorIntentDigest, value.receipts[name]?.values);
    priorIntentDigest = sealIntentCore({
      phase: name,
      plan,
      authority,
      receipts: { ...receipts },
      completion: name === "complete" ? value.completion : null,
    }).intentDigest;
  }
  const rebuilt = sealIntent({
    phase: value.phase,
    plan,
    authority,
    receipts,
    completion: value.phase === "complete" ? value.completion : null,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function normalizeReanchorEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const dirt = normalizeActiveOwnedDirtEvidence(value.dirt);
  const targetDirt = normalizeActiveOwnedDirtEvidence(value.reanchor?.targetDirt);
  const lease = structuredClone(value.lease);
  const claim = structuredClone(value.sourceClaim);
  const targetEpochProof = structuredClone(value.targetEpochProof);
  const sourceFence = structuredClone(value.sourceFence);
  const target = structuredClone(value.targetProtectedMain);
  const pullRequest = structuredClone(value.pullRequest);
  const repositoryIdentity = structuredClone(value.repositoryIdentity);
  const reanchor = { ...structuredClone(value.reanchor), targetDirt };
  requireLease(lease);
  requireClaim(claim, lease);
  requireTargetEpochProof(targetEpochProof, claim, lease);
  requirePullRequest(pullRequest, lease, claim);
  requireRepositoryIdentity(repositoryIdentity, lease, pullRequest);
  requireFence(sourceFence, lease, dirt);
  requireTarget(target, lease, dirt);
  requireReanchor(reanchor, sourceFence, target, dirt);
  const core = {
    schema: EVIDENCE_SCHEMA,
    operationAt: instant(value.operationAt, "evidence operation time"),
    lease,
    leaseDigest: digest(value.leaseDigest, "source lease digest"),
    sourceClaim: claim,
    targetEpochProof,
    sourceFence,
    targetProtectedMain: target,
    pullRequest,
    repositoryIdentity,
    dirt,
    ignoredRetention: structuredClone(value.ignoredRetention),
    reanchor,
    overlapClaimIds: [...(value.overlapClaimIds || [])],
    controllerRevision: objectId(value.controllerRevision, "controller revision"),
  };
  if (core.overlapClaimIds.length !== 0) invalid("overlapping cloud claims");
  if (core.leaseDigest !== writerLeaseDigest(lease)) invalid("source lease digest join");
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest !== evidenceDigest) invalid("evidence digest");
  return deepFreeze({ ...core, evidenceDigest });
}

export function operationKey(plan, phase) {
  const source = normalizeReanchorPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

export function effectReceipt(kind, values = {}) {
  if (!kind || !values || typeof values !== "object" || Array.isArray(values)) {
    invalid("effect receipt");
  }
  const core = { schema: EFFECT_SCHEMA, kind, ...structuredClone(values) };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildReanchorCompletion(intent) {
  const current = normalizeReanchorIntent(intent);
  if (current.phase !== "verified") invalid("verified intent before completion");
  const values = phase => current.receipts[phase].values;
  const plan = current.planSnapshot;
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "authoring-authority-reanchored",
    planDigest: plan.planDigest,
    sourceClaimId: plan.sourceClaimId,
    successorClaimId: values("successor-current").claimId,
    sourceBaseSha: plan.sourceBaseSha,
    targetCanonicalBaseSha: plan.targetCanonicalBaseSha,
    sourceFenceSha: plan.sourceFenceSha,
    targetLaneRevision: plan.targetLaneRevision,
    targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
    sourceAuthorizationReceiptDigest: values("source-authorized").receiptDigest,
    snapshotReceiptDigest: values("snapshotted").snapshotReceiptDigest,
    terminalVerificationReceiptDigest: values("verified").receiptDigest,
    mutationAuthorityReceiptDigest: values("verified").mutationAuthorityReceiptDigest,
    taskAuthorityContinuationReceiptDigest: values("local-cas").taskContinuationReceiptDigest,
    authoredBytesPreserved: true,
    untrackedBytesPreserved: true,
    admittedScopeChanged: false,
    sourceHeadChanged: true,
    sourceBaseChanged: true,
    coordinationCommitCreated: true,
    authoredCommitCreated: false,
    pullRequestReviewed: false,
    pullRequestMerged: false,
    deployed: false,
    cleaned: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function requireLease(lease) {
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.admission?.status !== "admitted" || lease.cloudAuthority?.state !== "active"
    || !lease.taskAuthority || !lease.pullRequestUrl || !lease.branch || !lease.sessionId
    || !lease.device || !lease.scope || !lease.worktreePath) invalid("active admitted lease");
  objectId(lease.baseSha, "lease base");
  objectId(lease.fenceSha, "lease fence");
  digest(lease.admission.manifestDigest, "manifest digest");
  digest(lease.admission.writeSetDigest, "write-set digest");
  digest(lease.taskAuthority.bindingDigest, "task binding digest");
  assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  if (canonicalJson(normalizeWriteSet(lease.admission.declaredWriteSet))
      !== canonicalJson(lease.admission.declaredWriteSet)) invalid("canonical admitted write set");
}

function requireClaim(claim, lease) {
  if (!claim || claim.claimId !== lease.cloudAuthority.claimId
    || claim.fenceRevision !== lease.cloudAuthority.claimDigest
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lease.fenceSha
    || claim.deviceId !== pseudonymousIdentifier("device", lease.device)
    || claim.sessionId !== pseudonymousIdentifier("session", lease.sessionId)
    || claim.workItemId !== pseudonymousIdentifier("work-item", lease.scope)
    || !/^github-user:\d+$/u.test(String(claim.actorId || ""))
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(lease.admission.declaredWriteSet)
    || !["active", "current"].includes(claim.state) || claim.writeAuthority !== true
    || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || claim.leaseEpoch !== lease.cloudAuthority.leaseEpoch
    || !Number.isSafeInteger(claim.transitionCounter) || claim.transitionCounter < 1
    || !Number.isFinite(Date.parse(claim.expiresAt))
    || (claim.predecessorClaimId ?? null) !== null) invalid("exact current source claim");
  digest(claim.claimId, "source claim ID");
  digest(claim.fenceRevision, "source claim digest");
}

function requireTargetEpochProof(proof, claim, lease) {
  if (proof?.schema !== `agentic-${OPERATION}-target-epoch-proof/v1`
    || !OBJECT_ID.test(String(proof.ledgerRevision || ""))
    || !DIGEST.test(String(proof.ledgerDigest || ""))
    || !Number.isSafeInteger(proof.ledgerSequence) || proof.ledgerSequence < 1
    || !DIGEST.test(String(proof.ledgerEntriesDigest || ""))
    || proof.repositoryId !== claim.repositoryId
    || proof.workItemId !== claim.workItemId
    || proof.writeSetDigest !== lease.admission.writeSetDigest
    || !Array.isArray(proof.matchingClaims) || proof.matchingClaims.length < 1
    || proof.matchingClaimsDigest !== digestValue(proof.matchingClaims)) {
    invalid("authenticated target cloud epoch proof");
  }
  let maximum = 0;
  let priorClaimId = null;
  for (const item of proof.matchingClaims) {
    digest(item?.claimId, "historical target claim ID");
    if (priorClaimId !== null && item.claimId <= priorClaimId) {
      invalid("canonical historical target claim order");
    }
    priorClaimId = item.claimId;
    if (!Number.isSafeInteger(item.leaseEpoch) || item.leaseEpoch < 1
      || !Number.isSafeInteger(item.transitionCounter) || item.transitionCounter < 1
      || !DIGEST.test(String(item.transitionDigest || ""))
      || typeof item.state !== "string" || item.state.length === 0) {
      invalid("historical target claim projection");
    }
    maximum = Math.max(maximum, item.leaseEpoch);
  }
  const core = { ...structuredClone(proof) };
  delete core.proofDigest;
  if (!proof.matchingClaims.some(item => item.claimId === claim.claimId
      && item.leaseEpoch === claim.leaseEpoch
      && item.transitionCounter === claim.transitionCounter
      && item.transitionDigest === claim.transitionDigest)
    || proof.maximumHistoricalLeaseEpoch !== maximum
    || maximum !== claim.leaseEpoch
    || proof.targetCloudLeaseEpoch !== maximum + 1
    || proof.proofDigest !== digestValue(core)) {
    invalid("target cloud epoch derivation");
  }
}

function requirePullRequest(pull, lease, claim) {
  if (!pull || pull.url !== lease.pullRequestUrl || pull.state !== "OPEN" || pull.isDraft !== true
    || pull.headSha !== lease.fenceSha || pull.baseSha !== lease.baseSha
    || pull.headRepository !== lease.cloudAuthority.targetRepository
    || pull.autoMerge !== null || !Number.isSafeInteger(pull.number) || pull.number < 1) {
    invalid("exact draft pull request");
  }
  if (!Number.isSafeInteger(pull.bodyByteLength) || pull.bodyByteLength < 0
    || pull.targetMarkerGrowthReserveBytes !== 16_384
    || pull.targetBodyLimitBytes !== 65_536
    || pull.bodyByteLength + pull.targetMarkerGrowthReserveBytes
      > pull.targetBodyLimitBytes) {
    invalid("target pull-request body capacity");
  }
  if (claim.reviewRequestId !== `github-pull-request:${pull.id}`) {
    invalid("source claim pull-request identity");
  }
  digest(pull.bodyDigest, "pull-request body digest");
  digest(pull.bodyRemainderDigest, "pull-request body remainder digest");
}

function requireRepositoryIdentity(identity, lease, pull) {
  const target = lease.cloudAuthority.targetRepository;
  const core = {
    schema:
      "agentic-retired-abandoned-owned-dirt-repository-identity-witness/v1",
    targetRepository: target,
    originFetchUrl: identity?.originFetchUrl,
    originFetchRepository: target,
    originPushUrl: identity?.originPushUrl,
    originPushRepository: target,
    pullRequestUrl: pull.url,
    pullRequestRepository: target,
    headRepository: target,
    baseRepository: target,
    headRefName: lease.branch,
    baseRefName: "main",
  };
  if (!identity?.originFetchUrl || !identity.originPushUrl
    || canonicalJson(identity) !== canonicalJson({
      ...core,
      identityDigest: digestValue(core),
    })) {
    invalid("joined target origin and pull-request repository identity");
  }
}

function requireFence(fence, lease, dirt) {
  if (!fence || fence.headSha !== lease.fenceSha || fence.parentSha !== lease.baseSha
    || fence.treeSha !== fence.baseTreeSha || dirt.headSha !== fence.headSha) {
    invalid("empty source fence");
  }
  for (const value of [fence.headSha, fence.parentSha, fence.treeSha, fence.baseTreeSha]) {
    objectId(value, "source fence object");
  }
}

function requireTarget(target, lease, dirt) {
  if (!target || target.sourceBaseSha !== lease.baseSha
    || target.protectedMainSha === lease.baseSha || target.mergeBaseSha !== lease.baseSha
    || target.ancestryVerified !== true
    || target.localMainSha !== target.protectedMainSha
    || target.localOriginMainSha !== target.protectedMainSha
    || target.remoteMainSha !== target.protectedMainSha
    || !Array.isArray(target.changedPaths) || target.changedPaths.length === 0
    || !Array.isArray(target.dirtyOverlapPaths) || target.dirtyOverlapPaths.length !== 0
    || target.changedPathsDigest !== digestValue(target.changedPaths)
    || target.dirtyOverlapPathsDigest !== digestValue(target.dirtyOverlapPaths)) {
    invalid("strict disjoint protected-main advance");
  }
  if (target.changedPaths.some(item => writeSetsOverlap(
    [`path:${item}`],
    lease.admission.declaredWriteSet,
  ))) invalid("protected/main admitted-write-set overlap");
}

function requireReanchor(reanchor, fence, target, dirt) {
  const coordination = reanchor?.coordination;
  if (!coordination || coordination.treeSha !== target.treeSha
    || canonicalJson(coordination.parents) !== canonicalJson([
      fence.headSha,
      target.protectedMainSha,
    ]) || coordination.commitSha === fence.headSha
    || reanchor.targetDirt.headSha !== coordination.commitSha
    || reanchor.targetDirt.pathCount !== dirt.pathCount
    || reanchor.targetDirt.untrackedPathCount !== dirt.untrackedPathCount
    || canonicalJson(reanchor.targetDirt.entries) !== canonicalJson(dirt.entries)
    || !Array.isArray(reanchor.dispositions)
    || reanchor.dispositions.length < dirt.pathCount) invalid("deterministic reanchor projection");
  for (const value of [
    coordination.commitSha,
    coordination.treeSha,
    reanchor.sourceIndexTreeSha,
    reanchor.sourceWorktreeTreeSha,
    reanchor.targetIndexTreeSha,
    reanchor.targetWorktreeTreeSha,
  ]) objectId(value, "reanchor object");
  const byPath = new Map(reanchor.dispositions.map(item => [item.path, item]));
  for (const entry of dirt.entries) {
    const disposition = byPath.get(entry.path);
    const exactIndex = disposition?.sourceIndex?.mode === entry.indexMode
      && disposition?.sourceIndex?.blob === entry.indexBlob;
    const exactWorktree = disposition?.sourceWorktree?.type === entry.worktreeType
      && disposition?.sourceWorktree?.mode === entry.worktreeMode
      && disposition?.sourceWorktree?.blob === entry.worktreeBlob;
    const targetIndexExact = disposition?.indexDisposition !== "source"
      || Boolean(disposition?.targetIndex && disposition?.sourceIndex
        && canonicalJson(disposition.targetIndex) === canonicalJson(disposition.sourceIndex));
    const targetWorktreeExact = disposition?.worktreeDisposition !== "source"
      || Boolean(disposition?.targetWorktree && disposition?.sourceWorktree
        && canonicalJson(disposition.targetWorktree) === canonicalJson(disposition.sourceWorktree));
    if (!disposition || !exactIndex || !exactWorktree
      || !targetIndexExact || !targetWorktreeExact
      || (disposition.indexDisposition !== "source"
        && disposition.worktreeDisposition !== "source")) {
      invalid("owned-dirt source disposition");
    }
  }
}

function phaseReceipt(plan, phase, priorIntentDigest, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) invalid(`${phase} values`);
  const normalized = deepFreeze(structuredClone(values));
  const core = {
    schema: `agentic-${OPERATION}-phase/v1`,
    phase,
    planDigest: plan.planDigest,
    operationKey: operationKey(plan, phase),
    priorIntentDigest,
    values: normalized,
    valuesDigest: digestValue(normalized),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ phase, plan, authority, receipts, completion }) {
  return deepFreeze(sealIntentCore({ phase, plan, authority, receipts, completion }));
}

function sealIntentCore({ phase, plan, authority, receipts, completion }) {
  const core = {
    schema: INTENT_SCHEMA,
    operation: OPERATION,
    phase,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization: authority,
    receipts,
    completion,
  };
  return { ...core, intentDigest: digestValue(core) };
}

function boundedTtl(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 60 || parsed > 86_400) invalid("TTL seconds");
  return parsed;
}

function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}

function objectId(value, label) {
  if (!OBJECT_ID.test(String(value || ""))) invalid(label);
  return value;
}

function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function invalid(label) {
  throw new Error(`Active-owned-dirt current-base reanchor ${label} is invalid.`);
}
