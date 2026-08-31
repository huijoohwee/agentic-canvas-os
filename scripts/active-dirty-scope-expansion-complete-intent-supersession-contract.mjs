// Responsibility: Seal one exact completed scope-expansion intent into an append-only archive before atomically seeding its strict successor.
import { buildExpansionReceipt, normalizeActiveDirtyScopeExpansionPlan }
  from "./active-dirty-scope-expansion-contract.mjs";
import { normalizeRecoverableScopeExpansionIntent }
  from "./active-dirty-scope-expansion-intent-recovery-evidence.mjs";
import { normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { SCOPE_EXPANSION_INTENT_SCHEMA, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
export const OPERATION =
  "active-dirty-scope-expansion-complete-intent-supersession";
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const ARCHIVE_SCHEMA = `agentic-${OPERATION}-archive/v1`;
export const SEEDED_INTENT_RECEIPT_SCHEMA =
  `agentic-${OPERATION}-seeded-intent-receipt/v1`;
export const RESULT_SCHEMA = `agentic-${OPERATION}-result/v1`;
export const COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY =
  "scopeExpansionCompleteIntentSupersessionArchives";
export const COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY =
  "scopeExpansionCompleteIntentSupersessionReceipts";

export const PR844_COMPLETE_INTENT_SUBJECT = deepFreeze({
  targetRepository: "huijoohwee/agentic-canvas-os",
  pullRequestNumber: 844,
  reviewRequestId: "github-pull-request:PR_kwDOSr5-fM8AAAABBjuaEw",
  branch: "agent/huis-macbook-pro-3.local/provisioned-start-pre-bind-descendant-recovery",
  sessionId: "01a0554f-78d4-7221-b216-ed700a4bae72",
  semanticScope: "provisioned-start-pre-bind-descendant-recovery",
  baseSha: "2cfd12cab616a033e78b9354d79992fdc5612d97",
  fenceSha: "ecb97f0c250f92a5c32e9e4306ce95f1626cf0c9",
  currentClaimId: "a19af0274866524387c444a6132f04ff70accd9921cb6c7856039af5fdb6120b",
  predecessorClaimId: "3a238d3f17b5ea6f51aa367c8959cbce88b05c530e0780d6e16828d309a3a190",
  completedPlanDigest: "be2a2e6a77c956920fcb2190004f285addae86a23f7123fd4b56192ebd5c9655",
  completedIntentDigest: "025009c1003ee09fbeae60df5ec57df9cab7a63de6aa888c226507cb791ff690",
  completedFinalReceiptDigest: "b4a9af618d05b9d110767dee9bcb3c2b14086263b829f90d4a3c0b89429b2852",
  completedManifestDigest: "f2ecd76a03e25d2cf88adc54c2d9a22c642b122ca05eca5b77fca502a7edd8be",
  completedWriteSetDigest: "e067a6edc8babad62ce3238a9da5397956db0f0ffe4e9dbf8b945f6d5b54eaf5",
  successorManifestDigest: "e44612fc9745ed34fc366f4ebd48745ff108c7f5fcf8033e21d1d61356297d55",
  successorWriteSetDigest: "675c58383fee59653d1e77a0e556109c31d9b3064a97f343dcb4d0480d499e3a",
});
export const PR844_CURRENT_PATHS = Object.freeze([
  "__tests__/provisioned-start-admission-recovery-cli.test.mjs", "__tests__/provisioned-start-admission-recovery-contract.test.mjs",
  "__tests__/provisioned-start-admission-recovery-controller.test.mjs", "__tests__/provisioned-start-admission-recovery-real-adapter.test.mjs",
  "__tests__/provisioned-start-admission-recovery-repository-adapter.test.mjs", "__tests__/provisioned-start-admission-recovery-store.test.mjs",
  "__tests__/provisioned-start-cloud-authority-subject.test.mjs", "docs/PROVISIONED-START-ADMISSION-RECOVERY.md",
  "scripts/provisioned-start-admission-recovery-contract.mjs", "scripts/provisioned-start-admission-recovery-controller.mjs",
  "scripts/provisioned-start-admission-recovery-repository-adapter.mjs", "scripts/provisioned-start-admission-recovery-store.mjs",
  "scripts/provisioned-start-cloud-authority-subject.mjs",
]);

export const PR844_SUCCESSOR_PATHS = Object.freeze([
  "__tests__/helpers/planned-dirty-admission-recovery-fixtures.mjs",
  "__tests__/planned-dirty-admission-recovery.test.mjs",
  ...PR844_CURRENT_PATHS,
].sort());

export function buildCompleteIntentSupersessionEvidence(value = {}) {
  const lease = snapshot(value.lease, "current writer lease");
  const leaseDigest = matchingDigest(value.leaseDigest ?? writerLeaseDigest(lease),
    writerLeaseDigest(lease), "current writer lease digest");
  const sourceIntent = normalizeRecoverableScopeExpansionIntent(value.sourceIntent,
    { expectedStatus: "complete" });
  const sourceIntentDigest = matchingDigest(value.sourceIntentDigest ?? digestValue(sourceIntent),
    digestValue(sourceIntent), "completed intent digest");
  const expectedCompletionReceipt = buildExpansionReceipt({
    phase: "complete", plan: sourceIntent.planSnapshot,
    values: { finalReceiptDigest: sourceIntent.finalReceiptDigest },
  });
  const sourceCompletionReceipt = snapshot(value.sourceCompletionReceipt ?? expectedCompletionReceipt,
    "completed scope-expansion receipt");
  if (canonicalJson(sourceCompletionReceipt) !== canonicalJson(expectedCompletionReceipt)) {
    invalid("completed scope-expansion receipt drift");
  }
  const targetManifest = normalizeDeclaredWriteScopeManifest(value.targetManifest,
    { expectedScope: PR844_COMPLETE_INTENT_SUBJECT.semanticScope });
  const successorPlan = normalizeActiveDirtyScopeExpansionPlan(value.successorPlan);
  const successorIntent = seedIntent(successorPlan);
  const core = {
    schema: EVIDENCE_SCHEMA,
    targetRepository: repository(value.targetRepository),
    lease,
    leaseDigest,
    currentClaim: normalizeCurrentClaim(value.currentClaim),
    pullRequest: normalizePullRequest(value.pullRequest),
    dirt: normalizeActiveOwnedDirtEvidence(value.dirt),
    sourceIntent,
    sourceIntentDigest,
    sourceCompletionReceipt,
    sourceCompletionReceiptDigest: digestValue(sourceCompletionReceipt),
    priorArchiveDigest: nullableDigest(value.priorArchiveDigest, "prior archive digest"),
    priorReceiptDigest: nullableDigest(value.priorReceiptDigest, "prior receipt digest"),
    targetManifest,
    successorPlan,
    successorIntent,
    successorIntentDigest: digestValue(successorIntent),
  };
  assertEvidenceJoins(core);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeCompleteIntentSupersessionEvidence(value) {
  object(value, "complete-intent supersession evidence");
  const rebuilt = buildCompleteIntentSupersessionEvidence(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("evidence digest or shape");
  return rebuilt;
}

export function buildCompleteIntentSupersessionPlan({ evidence } = {}) {
  const normalized = buildCompleteIntentSupersessionEvidence(evidence);
  const core = { schema: PLAN_SCHEMA, operation: OPERATION, evidence: normalized,
    evidenceDigest: normalized.evidenceDigest };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizeCompleteIntentSupersessionPlan(value) {
  object(value, "complete-intent supersession plan");
  const rebuilt = buildCompleteIntentSupersessionPlan({ evidence: value.evidence });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan digest or exact authorization");
  return rebuilt;
}

export function authorizeCompleteIntentSupersession({ plan, authorization } = {}) {
  const normalized = normalizeCompleteIntentSupersessionPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Complete-intent supersession requires exact authorization: ${normalized.exactAuthorization}`);
  }
  const core = { schema: AUTHORIZATION_SCHEMA, operation: OPERATION,
    planDigest: normalized.planDigest, authorization };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function buildSeededScopeExpansionIntent({ plan } = {}) {
  return seedIntent(normalizeCompleteIntentSupersessionPlan(plan).evidence.successorPlan);
}

export function normalizeSeededScopeExpansionIntent({ plan, intent } = {}) {
  const expected = buildSeededScopeExpansionIntent({ plan });
  if (canonicalJson(intent) !== canonicalJson(expected)) invalid("seeded v1 intent drift");
  return expected;
}

export function buildScopeExpansionCompleteIntentArchive({ plan, authorizationReceipt, taskAuthorityReceipt,
  priorArchiveDigest = undefined } = {}) {
  const normalized = normalizeCompleteIntentSupersessionPlan(plan);
  const evidence = normalized.evidence;
  const authorization = normalizeAuthorizationReceipt(authorizationReceipt, normalized);
  const authority = normalizeTaskAuthorityReceipt(taskAuthorityReceipt, evidence.lease);
  const prior = priorArchiveDigest === undefined
    ? evidence.priorArchiveDigest
    : nullableDigest(priorArchiveDigest, "prior archive digest");
  if (prior !== evidence.priorArchiveDigest) invalid("append-only archive predecessor");
  const core = {
    schema: ARCHIVE_SCHEMA, status: "superseded", operation: OPERATION,
    branch: evidence.lease.branch, planDigest: normalized.planDigest, planSnapshot: normalized,
    sourceLeaseDigest: evidence.leaseDigest, sourceClaimId: evidence.currentClaim.claimId,
    sourceIntent: evidence.sourceIntent, sourceIntentDigest: evidence.sourceIntentDigest,
    sourceCompletionReceipt: evidence.sourceCompletionReceipt,
    sourceCompletionReceiptDigest: evidence.sourceCompletionReceiptDigest,
    successorPlanDigest: evidence.successorPlan.planDigest, successorIntentDigest: evidence.successorIntentDigest,
    previousArchiveDigest: prior, authorizationReceipt: authorization,
    authorizationReceiptDigest: authorization.authorizationDigest, taskAuthorityReceipt: authority,
    taskAuthorityReceiptDigest: authority.receiptDigest,
  };
  return deepFreeze({ ...core, archiveDigest: digestValue(core) });
}

export function normalizeScopeExpansionCompleteIntentArchive(value, { plan } = {}) {
  const normalizedPlan = normalizeCompleteIntentSupersessionPlan(plan);
  const rebuilt = buildScopeExpansionCompleteIntentArchive({
    plan: normalizedPlan,
    authorizationReceipt: value?.authorizationReceipt,
    taskAuthorityReceipt: value?.taskAuthorityReceipt,
    priorArchiveDigest: value?.previousArchiveDigest,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("archive digest or lineage");
  return rebuilt;
}

export function buildSeededScopeExpansionIntentReceipt({ plan, archive, taskAuthorityReceipt,
  registryRevision } = {}) {
  const normalized = normalizeCompleteIntentSupersessionPlan(plan);
  const archived = normalizeScopeExpansionCompleteIntentArchive(archive, { plan: normalized });
  const authority = normalizeTaskAuthorityReceipt(taskAuthorityReceipt, normalized.evidence.lease);
  if (authority.receiptDigest !== archived.taskAuthorityReceiptDigest) {
    invalid("seed receipt task-authority join");
  }
  const seededIntent = buildSeededScopeExpansionIntent({ plan: normalized });
  const core = {
    schema: SEEDED_INTENT_RECEIPT_SCHEMA, status: "seeded", operation: OPERATION,
    planDigest: normalized.planDigest, branch: normalized.evidence.lease.branch,
    archiveDigest: archived.archiveDigest, sourceLeaseDigest: normalized.evidence.leaseDigest,
    sourceClaimId: normalized.evidence.currentClaim.claimId,
    successorPlanDigest: normalized.evidence.successorPlan.planDigest,
    seededIntent, seededIntentDigest: digestValue(seededIntent),
    authorizationReceiptDigest: archived.authorizationReceiptDigest,
    taskAuthorityReceiptDigest: archived.taskAuthorityReceiptDigest,
    previousReceiptDigest: normalized.evidence.priorReceiptDigest,
    registryRevision: positiveInteger(registryRevision, "registry revision"),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeSeededScopeExpansionIntentReceipt(value, { plan, archive } = {}) {
  const rebuilt = buildSeededScopeExpansionIntentReceipt({
    plan,
    archive,
    taskAuthorityReceipt: archive?.taskAuthorityReceipt,
    registryRevision: value?.registryRevision,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("seed receipt digest or projection");
  return rebuilt;
}

export function buildCompleteIntentSupersessionResult({ plan, archive, seedReceipt,
  replayed = false } = {}) {
  const normalized = normalizeCompleteIntentSupersessionPlan(plan);
  const archived = normalizeScopeExpansionCompleteIntentArchive(archive, { plan: normalized });
  const seeded = normalizeSeededScopeExpansionIntentReceipt(seedReceipt, {
    plan: normalized,
    archive: archived,
  });
  const core = {
    schema: RESULT_SCHEMA, status: "complete", operation: OPERATION,
    planDigest: normalized.planDigest, archive: archived, seedReceipt: seeded,
    receiptDigest: seeded.receiptDigest, replayed: Boolean(replayed),
    sourceBytesChanged: false, indexChanged: false, gitObjectsChanged: false,
    gitRefsChanged: false, cloudMutated: false, pullRequestMutated: false,
    merged: false, cleanedUp: false, deployed: false,
  };
  return deepFreeze({ ...core, resultDigest: digestValue(core) });
}

export function normalizeCompleteIntentSupersessionResult(value, { plan } = {}) {
  const rebuilt = buildCompleteIntentSupersessionResult({
    plan,
    archive: value?.archive,
    seedReceipt: value?.seedReceipt,
    replayed: value?.replayed,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("result digest or zero-effect boundary");
  return rebuilt;
}

export function classifyCompleteIntentSupersessionRegistryState({
  plan,
  currentIntent,
  archives = [],
  receipts = [],
} = {}) {
  const normalized = normalizeCompleteIntentSupersessionPlan(plan);
  const sourceDigest = digestValue(currentIntent);
  const expectedSeed = buildSeededScopeExpansionIntent({ plan: normalized });
  const entries = normalizeHistory(archives, {
    schema: ARCHIVE_SCHEMA, priorKey: "previousArchiveDigest", digestKey: "archiveDigest",
    branch: normalized.evidence.lease.branch,
  });
  const seeds = normalizeHistory(receipts, {
    schema: SEEDED_INTENT_RECEIPT_SCHEMA, priorKey: "previousReceiptDigest", digestKey: "receiptDigest",
    branch: normalized.evidence.lease.branch,
  });
  const matching = entries.filter(entry => entry.planDigest === normalized.planDigest);
  const matchingSeeds = seeds.filter(entry => entry.planDigest === normalized.planDigest);
  if (sourceDigest === normalized.evidence.sourceIntentDigest) {
    if (matching.length > 0 || matchingSeeds.length > 0) invalid("history collision before source CAS");
    if ((entries.at(-1)?.archiveDigest ?? null) !== normalized.evidence.priorArchiveDigest
      || (seeds.at(-1)?.receiptDigest ?? null) !== normalized.evidence.priorReceiptDigest) {
      invalid("history head CAS drift");
    }
    return deepFreeze({ state: "ready", archive: null, seedReceipt: null });
  }
  if (canonicalJson(currentIntent) === canonicalJson(expectedSeed)) {
    if (matching.length !== 1 || matchingSeeds.length !== 1
      || matching[0] !== entries.at(-1) || matchingSeeds[0] !== seeds.at(-1)) {
      invalid("seeded replay history collision");
    }
    const archive = normalizeScopeExpansionCompleteIntentArchive(matching[0], { plan: normalized });
    const seedReceipt = normalizeSeededScopeExpansionIntentReceipt(matchingSeeds[0], {
      plan: normalized, archive,
    });
    return deepFreeze({ state: "replay", archive, seedReceipt });
  }
  invalid("source intent CAS drift");
}

function assertEvidenceJoins(value) {
  const subject = PR844_COMPLETE_INTENT_SUBJECT;
  const lease = value.lease;
  const admission = lease.admission;
  const authority = lease.cloudAuthority;
  const task = lease.taskAuthority;
  const intent = value.sourceIntent;
  const claim = value.currentClaim;
  const pull = value.pullRequest;
  const target = value.targetManifest;
  const plan = value.successorPlan;
  const dirtPaths = value.dirt.entries.map(entry => entry.path);
  const sourceWriteSet = normalizeWriteSet(admission?.declaredWriteSet);
  const expectedSourceWriteSet = normalizeWriteSet([
    ...PR844_CURRENT_PATHS.map(path => `path:${path}`),
    `semantic:${subject.semanticScope}`,
  ]);
  const expectedTargetWriteSet = normalizeWriteSet([
    ...PR844_SUCCESSOR_PATHS.map(path => `path:${path}`),
    `semantic:${subject.semanticScope}`,
  ]);
  if (value.targetRepository !== subject.targetRepository
    || lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.branch !== subject.branch || lease.sessionId !== subject.sessionId
    || lease.scope !== subject.semanticScope || lease.baseSha !== subject.baseSha
    || lease.fenceSha !== subject.fenceSha || lease.pullRequestUrl !== pull.url
    || admission?.status !== "admitted" || admission.semanticScope !== subject.semanticScope
    || admission.manifestDigest !== subject.completedManifestDigest
    || admission.writeSetDigest !== subject.completedWriteSetDigest
    || canonicalJson(sourceWriteSet) !== canonicalJson(expectedSourceWriteSet)
    || !task || task.schema !== "agentic-task-authority-binding/v1"
    || !DIGEST_PATTERN.test(String(task.bindingDigest || ""))
    || authority?.state !== "active" || authority.mutationAuthorityEligible !== true
    || authority.claimId !== subject.currentClaimId || authority.canonicalBaseSha !== subject.baseSha
    || authority.laneRevision !== subject.fenceSha || authority.reviewRequestId !== subject.reviewRequestId
    || authority.writeSetDigest !== subject.completedWriteSetDigest
    || authority.manifestDigest !== subject.completedManifestDigest
    || intent.planDigest !== subject.completedPlanDigest
    || value.sourceIntentDigest !== subject.completedIntentDigest
    || intent.finalReceiptDigest !== subject.completedFinalReceiptDigest
    || intent.targetClaimId !== subject.currentClaimId
    || intent.targetManifestDigest !== subject.completedManifestDigest
    || intent.targetWriteSetDigest !== subject.completedWriteSetDigest
    || intent.targetReviewRequestId !== subject.reviewRequestId
    || claim.claimId !== subject.currentClaimId || claim.predecessorClaimId !== subject.predecessorClaimId
    || claim.fenceRevision !== authority.claimDigest
    || claim.transitionDigest !== authority.claimLedgerRevision
    || claim.transitionCounter !== authority.transitionCounter
    || claim.entrySchema !== authority.entrySchema
    || claim.claimIdentitySchema !== authority.claimIdentitySchema
    || claim.operationReceiptDigest !== authority.operationReceiptDigest
    || claim.canonicalBaseRevision !== subject.baseSha || claim.laneRevision !== subject.fenceSha
    || claim.reviewRequestId !== subject.reviewRequestId || claim.writeSetDigest !== subject.completedWriteSetDigest
    || claim.leaseEpoch !== authority.leaseEpoch || claim.expiresAt !== authority.expiresAt
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(expectedSourceWriteSet)
    || claim.deviceId !== pseudonymousIdentifier("device", lease.device)
    || claim.sessionId !== pseudonymousIdentifier("session", lease.sessionId)
    || claim.workItemId !== pseudonymousIdentifier("work-item", lease.scope)
    || claim.repositoryId !== `github-repository:${pull.headRepositoryId}`
    || pull.targetRepository !== subject.targetRepository || pull.number !== subject.pullRequestNumber
    || pull.nodeId !== subject.reviewRequestId.slice("github-pull-request:".length)
    || pull.state !== "OPEN" || pull.isDraft !== true || pull.autoMergeRequest !== null
    || pull.headRepository !== subject.targetRepository || pull.headRefName !== subject.branch
    || pull.headRefOid !== subject.fenceSha || pull.baseRefName !== "main"
    || canonicalJson(pull.writerMarker) !== canonicalJson(projectWriterLeasePullRequestMarker(lease))
    || target.manifestDigest !== subject.successorManifestDigest
    || target.writeSetDigest !== subject.successorWriteSetDigest
    || canonicalJson(target.declaredWriteSet) !== canonicalJson(expectedTargetWriteSet)
    || canonicalJson(target.paths) !== canonicalJson(PR844_SUCCESSOR_PATHS)
    || value.dirt.headSha !== subject.fenceSha || value.dirt.untrackedPathCount !== 0
    || canonicalJson(dirtPaths) !== canonicalJson(PR844_CURRENT_PATHS)
    || plan.sourceBranch !== subject.branch || plan.sourceFenceSha !== subject.fenceSha
    || plan.sourceLeaseDigest !== value.leaseDigest || plan.sourceClaimId !== subject.currentClaimId
    || plan.sourceClaimDigest !== authority.claimDigest
    || plan.sourceClaimTransitionCounter !== authority.transitionCounter
    || plan.sourceReviewRequestId !== subject.reviewRequestId
    || plan.sourceWriteSetDigest !== subject.completedWriteSetDigest
    || plan.sourceManifestDigest !== subject.completedManifestDigest
    || plan.sourceDirtyDigest !== value.dirt.evidenceDigest
    || canonicalJson(plan.sourceChangedPaths) !== canonicalJson(dirtPaths)
    || plan.targetManifestDigest !== subject.successorManifestDigest
    || plan.targetWriteSetDigest !== subject.successorWriteSetDigest
    || canonicalJson(plan.targetDeclaredWriteSet) !== canonicalJson(expectedTargetWriteSet)
    || plan.targetCanonicalBaseSha !== pull.baseRefOid || plan.targetCloudLeaseEpoch !== 1) {
    invalid("PR844 source, provider, dirt, or strict-successor join");
  }
  if (!sourceWriteSet.every(item => target.declaredWriteSet.includes(item))
    || sourceWriteSet.length >= target.declaredWriteSet.length) {
    invalid("successor manifest strict-superset relation");
  }
}

function normalizeCurrentClaim(value) {
  const claim = snapshot(value, "current provider claim");
  const declaredWriteScope = normalizeWriteSet(claim.declaredWriteScope);
  const normalized = {
    claimId: digest(claim.claimId, "current claim ID"),
    entrySchema: text(claim.entrySchema, "current claim entry schema"),
    claimIdentitySchema: text(claim.claimIdentitySchema, "current claim identity schema"),
    state: claim.state === "current" ? "current" : invalid("current claim state"),
    writeAuthority: claim.writeAuthority === true,
    scopeReserved: claim.scopeReserved === true,
    actorId: text(claim.actorId, "current claim actor"),
    deviceId: text(claim.deviceId, "current claim device"),
    sessionId: text(claim.sessionId, "current claim session"),
    repositoryId: text(claim.repositoryId, "current claim repository"),
    workItemId: text(claim.workItemId, "current claim work item"),
    canonicalBaseRevision: sha(claim.canonicalBaseRevision, "current claim base"),
    laneRevision: sha(claim.laneRevision, "current claim lane revision"),
    declaredWriteScope,
    writeSetDigest: digest(claim.writeSetDigest, "current claim write set"),
    leaseEpoch: positiveInteger(claim.leaseEpoch, "current claim lease epoch"),
    transitionCounter: positiveInteger(claim.transitionCounter, "current claim transition counter"),
    heartbeatCounter: nonnegativeInteger(claim.heartbeatCounter, "current claim heartbeat counter"),
    reviewRequestId: text(claim.reviewRequestId, "current claim review request"),
    predecessorClaimId: digest(claim.predecessorClaimId, "current claim predecessor"),
    expiresAt: instant(claim.expiresAt, "current claim expiry"),
    fenceRevision: digest(claim.fenceRevision, "current claim fence"),
    transitionDigest: digest(claim.transitionDigest, "current claim transition"),
    operationReceiptDigest: digest(claim.operationReceiptDigest, "current claim operation receipt"),
  };
  if (!normalized.writeAuthority || !normalized.scopeReserved
    || normalized.writeSetDigest !== digestValue(declaredWriteScope)) {
    invalid("current claim mutation authority");
  }
  return deepFreeze(normalized);
}

function normalizePullRequest(value) {
  object(value, "provider pull request");
  const marker = snapshot(value.writerMarker, "provider writer marker");
  const result = {
    targetRepository: repository(value.targetRepository),
    repositoryId: text(value.repositoryId, "provider repository ID"),
    number: positiveInteger(value.number, "pull-request number"),
    nodeId: text(value.nodeId, "pull-request node ID"),
    url: text(value.url, "pull-request URL"),
    state: text(value.state, "pull-request state"),
    isDraft: value.isDraft === true,
    autoMergeRequest: value.autoMergeRequest ?? null,
    headRepository: repository(value.headRepository),
    headRepositoryId: text(value.headRepositoryId, "head repository ID"),
    headRefName: text(value.headRefName, "pull-request head branch"),
    headRefOid: sha(value.headRefOid, "pull-request head SHA"),
    baseRefName: text(value.baseRefName, "pull-request base branch"),
    baseRefOid: sha(value.baseRefOid, "pull-request base SHA"),
    bodyDigest: digest(value.bodyDigest, "pull-request body digest"),
    writerMarker: marker,
    writerMarkerDigest: matchingDigest(
      value.writerMarkerDigest,
      digestValue(marker),
      "writer marker digest",
    ),
    bodyRemainderDigest: digest(value.bodyRemainderDigest, "pull-request body remainder digest"),
  };
  if (result.repositoryId !== `github-repository:${result.headRepositoryId}`
    || result.url !== `https://github.com/${result.targetRepository}/pull/${result.number}`) {
    invalid("provider repository or pull-request identity");
  }
  return deepFreeze(result);
}

function seedIntent(plan) {
  const normalized = normalizeActiveDirtyScopeExpansionPlan(plan);
  return deepFreeze({
    schema: SCOPE_EXPANSION_INTENT_SCHEMA, status: "intent", branch: normalized.sourceBranch,
    sourceLeaseDigest: normalized.sourceLeaseDigest,
    sourceClaimId: normalized.sourceClaimId, sourceFenceSha: normalized.sourceFenceSha,
    targetWriteSetDigest: normalized.targetWriteSetDigest,
    targetManifestDigest: normalized.targetManifestDigest, planDigest: normalized.planDigest,
    targetClaimId: null, targetClaimDigest: null, targetLeaseEpoch: 1,
    targetCanonicalBaseSha: normalized.targetCanonicalBaseSha,
    targetReviewRequestId: null, completedReceiptDigest: null,
    waiting: null, waitingReceiptDigest: null,
    sourceRetirementReceiptDigest: null,
    promoted: null, promotedReceiptDigest: null,
    boundAuthority: null, boundReceiptDigest: null,
    localProjection: null, localProjectionReceiptDigest: null,
    pullRequestProjection: null, pullRequestProjectionReceiptDigest: null,
    finalReceiptDigest: null, planSnapshot: normalized,
  });
}

function normalizeHistory(values, { schema, priorKey, digestKey, branch }) {
  if (!Array.isArray(values)) invalid("append-only history collection");
  let previous = null;
  return values.map((value) => {
    const entry = snapshot(value, "append-only history entry");
    const { [digestKey]: supplied, ...core } = entry;
    if (entry.schema !== schema || entry.operation !== OPERATION || entry.branch !== branch
      || entry[priorKey] !== previous || digest(supplied, "history digest") !== digestValue(core)) {
      invalid("append-only history chain");
    }
    previous = supplied;
    return entry;
  });
}

function normalizeAuthorizationReceipt(value, plan) {
  const expected = authorizeCompleteIntentSupersession({
    plan, authorization: plan.exactAuthorization,
  });
  if (canonicalJson(value) !== canonicalJson(expected)) invalid("supersession authorization receipt");
  return expected;
}

function normalizeTaskAuthorityReceipt(value, lease) {
  const receipt = snapshot(value, "task-authority receipt");
  const binding = lease.taskAuthority;
  const core = {
    authoritySubjectId: text(receipt.authoritySubjectId, "task authority subject"),
    bindingDigest: digest(receipt.bindingDigest, "task authority binding"),
    proofDigest: digest(receipt.proofDigest, "task authority proof"),
    operation: text(receipt.operation, "task authority operation"),
    verifiedAt: instant(receipt.verifiedAt, "task authority verification"),
  };
  const normalized = { schema: receipt.schema, status: receipt.status,
    authoritySubjectId: core.authoritySubjectId, proofAdapterId: receipt.proofAdapterId,
    generation: receipt.generation, ...core, receiptDigest: receipt.receiptDigest };
  if (receipt.schema !== "agentic-task-authority-verification-receipt/v1"
    || receipt.status !== "verified" || receipt.operation !== OPERATION
    || core.authoritySubjectId !== binding?.authoritySubjectId
    || receipt.proofAdapterId !== binding?.proofAdapterId || receipt.generation !== binding?.generation
    || core.bindingDigest !== binding?.bindingDigest || receipt.receiptDigest !== digestValue(core)
    || canonicalJson(receipt) !== canonicalJson(normalized)) {
    invalid("task-authority receipt");
  }
  return deepFreeze(normalized);
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value;
}
function snapshot(value, label) {
  object(value, label); const serialized = JSON.stringify(value);
  if (serialized.length > 262_144) invalid(`${label} size`); return deepFreeze(JSON.parse(serialized));
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim();
}
function repository(value) {
  const result = text(value, "target repository");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) invalid("target repository"); return result;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) invalid(label); return String(value);
}
function nullableDigest(value, label) { return value == null ? null : digest(value, label); }
function matchingDigest(value, expected, label) {
  if (digest(value, label) !== expected) invalid(label); return value;
}
function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) invalid(label); return String(value);
}
function instant(value, label) {
  if (!Number.isFinite(Date.parse(value))) invalid(label); return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value;
}
function invalid(label) { throw new Error(`Complete-intent supersession has invalid ${label}.`); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
