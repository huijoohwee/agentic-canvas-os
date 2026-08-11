// Responsibility: normalize and join immutable provider, cloud-claim, and preserved-local evidence for merged dormant reconciliation.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
export const MERGED_DORMANT_CLAIM_RECONCILIATION_SOURCE_EVIDENCE_SCHEMA =
  "agentic-merged-dormant-claim-reconciliation-source-evidence/v1";
const PLAN_SCHEMA = "agentic-merged-dormant-claim-reconciliation-plan/v1";
const INTENT_SCHEMA = "agentic-merged-dormant-claim-reconciliation-intent/v1";
const OPERATION_KEY_SCHEMA = "agentic-merged-dormant-claim-reconciliation-operation-key/v1";
const PHASE_EVIDENCE_SCHEMA = "agentic-merged-dormant-claim-reconciliation-phase-evidence/v1";
const PHASES = Object.freeze(["prepared", "recovered", "integrated", "retired", "complete"]);
const INTENT_STATUSES = Object.freeze(["authorized", ...PHASES]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export function buildMergedDormantClaimReconciliationSourceEvidence({ claim, provider, local }) {
  return assembleSourceEvidence({
    claim: normalizeClaim(claim), provider: normalizeProvider(provider), local: normalizeLocal(local), });
}
export function normalizeMergedDormantClaimReconciliationSourceEvidence(value) {
  requireObject(value, "Source evidence");
  if (value.schema !== MERGED_DORMANT_CLAIM_RECONCILIATION_SOURCE_EVIDENCE_SCHEMA) {
    throw new Error("Unsupported merged dormant reconciliation source evidence.");
  }
  const normalized = assembleSourceEvidence({
    claim: normalizeClaim(value.claim), provider: normalizeProvider(value.provider), local: normalizeLocal(value.local), });
  for (const field of [
    "bytesDigest", "refreshTopologyDigest", "namedChecksDigest", "handoffEvidenceDigest", "sourceEvidenceDigest", ]) {
    if (value[field] !== normalized[field]) {
      throw new Error(`Merged dormant reconciliation ${field} is invalid.`);
    }
  }
  return normalized;
}
export function assertMergedDormantClaimReconciliationSourceEvidence(value) {
  return normalizeMergedDormantClaimReconciliationSourceEvidence(value);
}
export function buildMergedDormantClaimReconciliationPhaseObservation({
  plan, intent, phase, operationKey, live, }) {
  const normalizedPhase = requiredPhase(phase);
  const normalizedPlan = normalizePlanEnvelope(plan);
  const normalizedIntent = normalizeIntentEnvelope(intent, normalizedPlan.planDigest, normalizedPhase);
  const expectedOperationKey = phaseOperationKey(normalizedPlan.planDigest, normalizedPhase);
  if (operationKey !== expectedOperationKey) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} operation key drifted.`);
  }
  const projected = projectPhaseLive(live);
  const state = phaseLiveState(normalizedPlan, normalizedIntent, normalizedPhase, projected);
  const evidenceDigest = phaseEvidenceDigest(
    normalizedPlan, normalizedPhase, expectedOperationKey, projected, state, );
  return deepFreeze({
    kind: state, values: { operationKey: expectedOperationKey, evidenceDigest, live: projected }, });
}
export function classifyMergedDormantClaimReconciliationPhase({
  plan, intent, phase, observation, operationKey, }) {
  const normalizedPhase = requiredPhase(phase);
  const normalizedPlan = normalizePlanEnvelope(plan);
  const normalizedIntent = normalizeIntentEnvelope(
    intent, normalizedPlan.planDigest, normalizedPhase, );
  const expectedOperationKey = phaseOperationKey(normalizedPlan.planDigest, normalizedPhase);
  if (operationKey !== expectedOperationKey) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} operation key drifted.`);
  }
  requireObject(observation, `${normalizedPhase} observation`);
  if (!new Set(["pending", "complete"]).has(observation.kind)) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} observation is impossible.`);
  }
  assertExactKeys(observation, ["kind", "values"], `${normalizedPhase} observation`);
  requireObject(observation.values, `${normalizedPhase} observation values`);
  assertExactKeys(
    observation.values, ["evidenceDigest", "live", "operationKey"], `${normalizedPhase} observation values`, );
  if (observation.values.operationKey !== expectedOperationKey) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} live operation key drifted.`);
  }
  const live = projectPhaseLive(observation.values.live);
  const liveState = phaseLiveState(normalizedPlan, normalizedIntent, normalizedPhase, live);
  if (observation.kind !== liveState) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} live state drifted.`);
  }
  const expectedEvidenceDigest = phaseEvidenceDigest(
    normalizedPlan, normalizedPhase, expectedOperationKey, live, liveState, );
  if (observation.values.evidenceDigest !== expectedEvidenceDigest) {
    throw new Error(`Merged dormant reconciliation ${normalizedPhase} live evidence digest drifted.`);
  }
  return Object.freeze({
    phase: normalizedPhase, operationKey: expectedOperationKey, state: liveState, evidenceDigest: liveState === "complete" ? expectedEvidenceDigest : null, integrationReceiptDigest: liveState === "complete"
      && ["integrated", "retired", "complete"].includes(normalizedPhase)
      ? live.claim.integrationReceiptDigest : null, });
}
function phaseLiveState(plan, intent, phase, live) {
  const stages = ["prepared", "recovered", "integrated", "retired"];
  const targetOffset = phase === "complete" ? 3 : stages.indexOf(phase);
  const observedOffset = live.claim.transitionCounter - plan.expectedTransitionCounter;
  if (observedOffset < 0 || observedOffset > 3 || observedOffset < targetOffset - 1) {
    throw new Error(`Merged dormant reconciliation ${phase} observed an impossible transition counter.`);
  }
  const currentPhase = stages[observedOffset];
  assertPhaseLive(plan, intent, currentPhase, phaseOperationKey(plan.planDigest, currentPhase), live);
  return observedOffset >= targetOffset ? "complete" : "pending";
}
function projectPhaseLive(value) {
  requireObject(value, "Live phase evidence");
  const result = value.result || value;
  const claim = value.claim;
  requireObject(claim, "Live phase claim");
  return deepFreeze({
    ledgerRevision: requiredSha(result.ledgerRevision, "live ledger revision"), ledgerDigest: requiredDigest(result.ledgerDigest, "live ledger digest"), claim: {
      claimId: requiredDigest(claim.claimId, "live claim ID"), state: requiredText(claim.state, "live claim state"), recordedState: requiredText(claim.recordedState, "live recorded state"),
      writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved, actorId: requiredText(claim.actorId, "live actor ID"), repositoryId: requiredText(claim.repositoryId, "live repository ID"), workItemId: requiredText(claim.workItemId, "live work-item ID"),
      deviceId: requiredText(claim.deviceId, "live device ID"), sessionId: requiredText(claim.sessionId, "live session ID"), canonicalBaseRevision: requiredSha(claim.canonicalBaseRevision, "live canonical base"), laneRevision: requiredSha(claim.laneRevision, "live lane revision"),
      writeSetDigest: requiredDigest(claim.writeSetDigest, "live write-set digest"), leaseEpoch: positiveInteger(claim.leaseEpoch, "live lease epoch"),
      transitionCounter: positiveInteger(claim.transitionCounter, "live transition counter"), reviewRequestId: requiredText(claim.reviewRequestId, "live review request ID"),
      evidenceDigest: requiredDigest(claim.evidenceDigest, "live review evidence digest"), fenceRevision: requiredDigest(claim.fenceRevision, "live fence revision"), transitionDigest: requiredDigest(claim.transitionDigest, "live transition digest"), operationReceiptDigest: requiredDigest(
        claim.operationReceiptDigest, "live operation receipt digest", ), recovery: projectRecovery(claim.recovery), integration: projectIntegration(claim.integration), integrationReceiptDigest: optionalDigest(
        claim.integrationReceiptDigest, "live integration receipt digest", ), retirement: projectRetirement(claim.retirement), }, });
}
function assertPhaseLive(plan, intent, phase, operationKey, live) {
  const claim = live.claim;
  const offset = phase === "prepared" ? 0 : phase === "recovered" ? 1
    : phase === "integrated" ? 2 : 3;
  if (claim.claimId !== plan.claimId || claim.actorId !== plan.actorId
    || claim.repositoryId !== plan.repositoryId || claim.workItemId !== plan.workItemId
    || claim.canonicalBaseRevision !== plan.canonicalBaseRevision
    || claim.laneRevision !== plan.claimLaneRevision || claim.writeSetDigest !== plan.claimWriteSetDigest
    || claim.leaseEpoch !== plan.claimLeaseEpoch || claim.reviewRequestId !== plan.claimReviewRequestId
    || claim.evidenceDigest !== plan.claimFocusedEvidenceDigest
    || claim.transitionCounter !== plan.expectedTransitionCounter + offset
    || claim.writeAuthority !== false) {
    throw new Error(`Merged dormant reconciliation ${phase} live claim identity drifted.`);
  }
  if (phase === "prepared") {
    if (claim.state !== "dormant-preserved" || claim.recordedState !== "reviewed"
      || claim.scopeReserved !== true || claim.fenceRevision !== plan.claimDigest
      || claim.transitionDigest !== plan.claimTransitionDigest
      || claim.operationReceiptDigest !== plan.claimOperationReceiptDigest
      || live.ledgerRevision !== plan.expectedLedgerRevision
      || live.ledgerDigest !== plan.expectedLedgerDigest
      || claim.recovery !== null || claim.integration !== null || claim.retirement !== null) {
      throw new Error("Prepared evidence drifted from the exact dormant source claim.");
    }
    return;
  }
  if (claim.deviceId !== plan.expectedCloudDeviceId || claim.sessionId !== plan.expectedCloudSessionId
    || claim.fenceRevision === plan.claimDigest || live.ledgerDigest === plan.expectedLedgerDigest
    || claim.recovery?.evidenceDigest !== phaseOperationKey(plan.planDigest, "recovered")) {
    throw new Error(`Merged dormant reconciliation ${phase} recovery evidence drifted.`);
  }
  if (phase === "recovered") {
    if (claim.state !== "reviewed" || claim.recordedState !== "reviewed"
      || claim.scopeReserved !== true || claim.integration !== null || claim.retirement !== null) {
      throw new Error("Recovered evidence is not the exact reviewed claim transition.");
    }
    return;
  }
  assertIntegration(plan, intent, claim, phaseOperationKey(plan.planDigest, "integrated"));
  if (phase === "integrated") {
    if (claim.state !== "integrated-preserved" || claim.recordedState !== "integrated-preserved"
      || claim.scopeReserved !== true || claim.retirement !== null) {
      throw new Error("Integrated evidence is not the exact preserved integration transition.");
    }
    return;
  }
  assertRetirement(plan, claim);
  if (claim.state !== "retired" || claim.recordedState !== "retired"
    || claim.scopeReserved !== false || operationKey !== phaseOperationKey(plan.planDigest, phase)) {
    throw new Error(`Merged dormant reconciliation ${phase} terminal evidence drifted.`);
  }
}
function assertIntegration(plan, intent, claim, integrationKey) {
  const value = claim.integration;
  if (!value || value.candidateRevision !== plan.claimLaneRevision
    || value.reviewRequestId !== plan.claimReviewRequestId
    || value.focusedEvidenceDigest !== plan.claimFocusedEvidenceDigest
    || value.dependencyClosureDigest !== plan.dependencyClosureDigest
    || value.namedChecksDigest !== plan.namedChecksDigest
    || value.handoffEvidenceDigest !== plan.handoffEvidenceDigest
    || value.operatorDecisionDigest !== intent.authorizationDigest
    || value.integrationIntentDigest !== integrationKey || !claim.integrationReceiptDigest) {
    throw new Error("Integrated evidence drifted from its exact reviewed intent.");
  }
}
function assertRetirement(plan, claim) {
  const value = claim.retirement;
  if (!value || value.reason !== "integrated" || value.finalRevision !== plan.finalRevision
    || value.reviewRequestId !== plan.claimReviewRequestId || value.bytesDigest !== plan.bytesDigest
    || value.namedChecksDigest !== plan.namedChecksDigest
    || value.handoffEvidenceDigest !== plan.handoffEvidenceDigest
    || value.integrationReceiptDigest !== claim.integrationReceiptDigest) {
    throw new Error("Retirement evidence drifted from the exact integrated claim.");
  }
}
function projectRecovery(value) {
  if (value == null) return null;
  requireObject(value, "Live recovery evidence");
  return Object.freeze({
    evidenceDigest: requiredDigest(value.evidenceDigest, "recovery evidence digest"), recoveredAt: requiredInstant(value.recoveredAt, "recovery instant"), });
}
function projectIntegration(value) {
  if (value == null) return null;
  requireObject(value, "Live integration evidence");
  return Object.freeze({
    candidateRevision: requiredSha(value.candidateRevision, "integration candidate"), reviewRequestId: requiredText(value.reviewRequestId, "integration review request ID"),
    focusedEvidenceDigest: requiredDigest(value.focusedEvidenceDigest, "integration focused evidence"), dependencyClosureDigest: requiredDigest(value.dependencyClosureDigest, "integration dependency closure"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "integration named checks"), handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "integration handoff evidence"), operatorDecisionDigest: requiredDigest(value.operatorDecisionDigest, "integration operator decision"),
    integrationIntentDigest: requiredDigest(value.integrationIntentDigest, "integration intent"), integratedAt: requiredInstant(value.integratedAt, "integration instant"), });
}
function projectRetirement(value) {
  if (value == null) return null;
  requireObject(value, "Live retirement evidence");
  return Object.freeze({
    reason: requiredText(value.reason, "retirement reason"), finalRevision: requiredSha(value.finalRevision, "retirement final revision"), reviewRequestId: requiredText(value.reviewRequestId, "retirement review request ID"), bytesDigest: requiredDigest(value.bytesDigest, "retirement bytes digest"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "retirement named checks"), handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "retirement handoff evidence"), integrationReceiptDigest: requiredDigest(
      value.integrationReceiptDigest, "retirement integration receipt", ), retiredAt: requiredInstant(value.retiredAt, "retirement instant"), });
}
function phaseOperationKey(planDigest, phase) {
  return digestValue({ schema: OPERATION_KEY_SCHEMA, planDigest, phase });
}
function phaseEvidenceDigest(plan, phase, operationKey, live, state) {
  if (state === "pending") {
    return digestValue({ schema: PHASE_EVIDENCE_SCHEMA, planDigest: plan.planDigest, phase, operationKey, state, live });
  }
  let evidence;
  if (phase === "prepared") evidence = { sourceEvidenceDigest: plan.sourceEvidenceDigest };
  else if (phase === "recovered") evidence = { recovery: live.claim.recovery };
  else if (phase === "integrated") evidence = {
    integration: live.claim.integration, integrationReceiptDigest: live.claim.integrationReceiptDigest, };
  else evidence = {
    retirement: live.claim.retirement, operationReceiptDigest: live.claim.operationReceiptDigest, };
  return digestValue({ schema: PHASE_EVIDENCE_SCHEMA, planDigest: plan.planDigest, phase, operationKey, evidence });
}
function assembleSourceEvidence({ claim, provider, local }) {
  assertSourceJoins({ claim, provider, local });
  const bytesDigest = digestValue({
    claimHead: provider.claimHead, pullRequestHeadSha: provider.pullRequest.headSha, pullRequestHeadTreeSha: provider.pullRequest.headTreeSha, mergeCommitSha: provider.pullRequest.mergeCommitSha, mergeCommitTreeSha: provider.pullRequest.mergeCommitTreeSha, protectedMain: provider.protectedMain, });
  const namedChecksDigest = digestValue({
    requiredChecks: provider.requiredChecks, checkRuns: provider.checkRuns, });
  const refreshTopologyDigest = digestValue({
    claimHead: provider.claimHead, refreshChain: provider.refreshChain, mergeCommitParents: provider.mergeCommitParents, mergeChangedPaths: provider.mergeChangedPaths, });
  const preservation = Object.freeze({
    localBranch: "preserved", localWorktree: "preserved", sourceBytes: "read-only", remoteBranch: "already-absent", ledgerMutation: "repository-adapter-only", });
  const handoffEvidenceDigest = digestValue({
    claimId: claim.claimId, claimTransitionDigest: claim.transitionDigest, local, preservation, });
  const core = {
    schema: MERGED_DORMANT_CLAIM_RECONCILIATION_SOURCE_EVIDENCE_SCHEMA, claim, provider, local, preservation, bytesDigest, refreshTopologyDigest, namedChecksDigest, handoffEvidenceDigest, };
  return deepFreeze({ ...core, sourceEvidenceDigest: digestValue(core) });
}
function normalizeClaim(value) {
  requireObject(value, "Dormant claim");
  const declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  const claim = {
    claimId: requiredDigest(value.claimId, "claim ID"), claimDigest: requiredDigest(value.claimDigest, "claim digest"), transitionDigest: requiredDigest(value.transitionDigest, "claim transition digest"),
    operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "claim operation receipt digest"), ledgerRevision: requiredSha(value.ledgerRevision, "claim ledger revision"),
    ledgerDigest: requiredDigest(value.ledgerDigest, "claim ledger digest"), state: requiredText(value.state, "claim state"), recordedState: requiredText(value.recordedState, "claim recorded state"), writeAuthority: value.writeAuthority, scopeReserved: value.scopeReserved,
    actorId: requiredText(value.actorId, "claim actor ID"), deviceId: requiredText(value.deviceId, "claim cloud device ID"), sessionId: requiredText(value.sessionId, "claim cloud session ID"), repositoryId: requiredText(value.repositoryId, "claim repository ID"),
    workItemId: requiredText(value.workItemId, "claim work-item ID"), canonicalBaseRevision: requiredSha(value.canonicalBaseRevision, "claim canonical base"), laneRevision: requiredSha(value.laneRevision, "claim lane revision"), declaredWriteScope: Object.freeze(declaredWriteScope),
    writeSetDigest: requiredDigest(value.writeSetDigest, "claim write-set digest"), leaseEpoch: positiveInteger(value.leaseEpoch, "claim lease epoch"),
    transitionCounter: positiveInteger(value.transitionCounter, "claim transition counter"), reviewRequestId: requiredText(value.reviewRequestId, "claim review request ID"),
    evidenceDigest: requiredDigest(value.evidenceDigest, "claim review evidence digest"), integration: requiredNull(value.integration, "claim integration"), integrationReceiptDigest: requiredNull(
      value.integrationReceiptDigest, "claim integration receipt digest", ), };
  if (claim.state !== "dormant-preserved" || claim.recordedState !== "reviewed"
    || claim.writeAuthority !== false || claim.scopeReserved !== true) {
    throw new Error("Reconciliation requires one dormant-preserved reviewed claim without write authority.");
  }
  if (claim.writeSetDigest !== digestValue(declaredWriteScope)) {
    throw new Error("Dormant claim write-set digest is invalid.");
  }
  if (claim.claimId !== digestValue({ actorId: claim.actorId, canonicalBaseRevision: claim.canonicalBaseRevision, leaseEpoch: claim.leaseEpoch, repositoryId: claim.repositoryId, workItemId: claim.workItemId, writeSetDigest: claim.writeSetDigest })) {
    throw new Error("Dormant claim identity digest is invalid.");
  }
  return deepFreeze(claim);
}
function normalizeProvider(value) {
  requireObject(value, "Provider evidence");
  const pullRequest = normalizePullRequest(value.pullRequest);
  const claimHead = normalizeRevision(value.claimHead, "provider claim head"), requiredChecks = normalizeRequiredChecks(value.requiredChecks);
  const checkRuns = normalizeCheckRuns(value.checkRuns);
  const provider = {
    provider: requiredText(value.provider, "provider"), repository: requiredRepository(value.repository, "provider repository"), repositoryId: requiredText(value.repositoryId, "provider repository ID"), pullRequest, claimHead,
    protectedMain: normalizeProtectedMain(value.protectedMain), ancestry: normalizeAncestry(value.ancestry), refreshChain: normalizeRefreshChain(value.refreshChain, pullRequest, claimHead), mergeCommitParents: normalizeSingleParent(value.mergeCommitParents, "merge commit parents"),
    mergeChangedPaths: Object.freeze(normalizePaths(value.mergeChangedPaths, "merge changed paths")), requiredChecks: Object.freeze(requiredChecks), checkRuns: Object.freeze(checkRuns), };
  if (provider.provider !== "github") {
    throw new Error("Merged dormant reconciliation currently requires GitHub provider evidence.");
  }
  const checkedRevisions = [provider.claimHead.sha, provider.refreshChain.at(-1)?.sha ?? provider.claimHead.sha, pullRequest.mergeCommitSha];
  for (const sha of [...new Set(checkedRevisions)]) {
    for (const required of requiredChecks) {
      if (!checkRuns.some(run => run.name === required.context && (required.appId === null || run.appId === required.appId)
        && run.headSha === sha && run.status === "COMPLETED" && run.conclusion === "SUCCESS")) {
        throw new Error(`Required check ${required.context} lacks success on ${sha}.`);
      }
    }
  }
  return deepFreeze(provider);
}
function normalizePullRequest(value) {
  requireObject(value, "Provider pull request");
  const pullRequest = {
    number: positiveInteger(value.number, "pull request number"), nodeId: requiredText(value.nodeId, "pull request node ID"), url: requiredText(value.url, "pull request URL"), state: requiredText(value.state, "pull request state").toUpperCase(), draft: value.draft, merged: value.merged,
    headRepository: requiredRepository(value.headRepository, "pull request head repository"), headBranch: requiredText(value.headBranch, "pull request head branch"), headSha: requiredSha(value.headSha, "pull request head SHA"), headTreeSha: requiredSha(value.headTreeSha, "pull request head tree"),
    baseRepository: requiredRepository(value.baseRepository, "pull request base repository"), baseBranch: requiredText(value.baseBranch, "pull request base branch"),
    mergeCommitSha: requiredSha(value.mergeCommitSha, "pull request merge commit"), mergeCommitTreeSha: requiredSha(value.mergeCommitTreeSha, "pull request merge tree"), };
  if (pullRequest.state !== "CLOSED" || pullRequest.draft !== false || pullRequest.merged !== true
    || pullRequest.baseBranch !== "main" || pullRequest.headTreeSha !== pullRequest.mergeCommitTreeSha) {
    throw new Error("Provider evidence must prove a closed merged same-tree pull request into main.");
  }
  return Object.freeze(pullRequest);
}
function normalizeProtectedMain(value) {
  requireObject(value, "Protected main evidence");
  const result = {
    branch: requiredText(value.branch, "protected branch"), sha: requiredSha(value.sha, "protected main SHA"), treeSha: requiredSha(value.treeSha, "protected main tree"), };
  if (result.branch !== "main") throw new Error("Provider evidence must bind protected main.");
  return Object.freeze(result);
}
function normalizeAncestry(value) {
  requireObject(value, "Provider ancestry evidence");
  if (value.claimHeadIsAncestorOfPullRequestHead !== true
    || value.mergeCommitIsAncestorOfProtectedMain !== true) {
    throw new Error("Provider evidence does not prove required protected ancestry.");
  }
  return Object.freeze({
    claimHeadIsAncestorOfPullRequestHead: true, mergeCommitIsAncestorOfProtectedMain: true, });
}
function normalizeRefreshChain(values, pullRequest, claimHead) {
  if (!Array.isArray(values)) throw new Error("Provider refresh chain must be an array.");
  if (values.length === 0) {
    if (claimHead.sha !== pullRequest.headSha || claimHead.treeSha !== pullRequest.headTreeSha) {
      throw new Error("A direct merge requires the reviewed claim head to equal the pull-request head.");
    }
    return Object.freeze([]);
  }
  const chain = values.map((value, index) => {
    requireObject(value, `Refresh chain item ${index}`);
    if (value.secondParentIsAncestorOfProtectedMain !== true) {
      throw new Error("Refresh-chain second parents must be protected-main ancestors.");
    }
    return Object.freeze({
      sha: requiredSha(value.sha, `refresh chain SHA ${index}`), treeSha: requiredSha(value.treeSha, `refresh chain tree ${index}`), scopeTreeDigest: requiredDigest(value.scopeTreeDigest, `refresh chain scope tree ${index}`),
      parents: normalizeParents(value.parents, `refresh chain parents ${index}`), secondParentIsAncestorOfProtectedMain: true, });
  });
  if (chain.at(-1).sha !== pullRequest.headSha || chain.at(-1).treeSha !== pullRequest.headTreeSha) {
    throw new Error("Refresh chain does not terminate at the reviewed pull-request head.");
  }
  return Object.freeze(chain);
}
function normalizeParents(values, label) {
  if (!Array.isArray(values) || values.length !== 2) throw new Error(`${label} must contain two SHAs.`);
  return Object.freeze(values.map((value, index) => requiredSha(value, `${label}[${index}]`)));
}
function normalizeSingleParent(values, label) {
  if (!Array.isArray(values) || values.length !== 1) throw new Error(`${label} must contain one SHA.`);
  return Object.freeze([requiredSha(values[0], `${label}[0]`)]);
}
function normalizePaths(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must not be empty.`);
  const paths = values.map(value => requiredText(value, label)).sort();
  rejectDuplicates(paths, label);
  return paths;
}
function normalizeRequiredChecks(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Provider evidence requires at least one protected required check.");
  }
  const normalized = values.map((value) => {
    requireObject(value, "Required check");
    return Object.freeze({
      context: requiredText(value.context, "required check context"), appId: optionalPositiveInteger(value.appId, "required check app ID"), });
  }).sort(compareChecks);
  rejectDuplicates(normalized.map(check => `${check.context}\0${check.appId}`), "required checks");
  return normalized;
}
function normalizeCheckRuns(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Provider evidence requires successful check runs.");
  }
  const normalized = values.map((value) => {
    requireObject(value, "Check run");
    return Object.freeze({
      name: requiredText(value.name, "check run name"), appId: optionalPositiveInteger(value.appId, "check run app ID"), headSha: requiredSha(value.headSha, "check run head SHA"),
      status: requiredText(value.status, "check run status").toUpperCase(), conclusion: requiredText(value.conclusion, "check run conclusion").toUpperCase(), });
  }).sort((left, right) => compareChecks(
    { context: left.name, appId: left.appId }, { context: right.name, appId: right.appId }, ));
  rejectDuplicates(normalized.map(run => `${run.name}\0${run.appId}\0${run.headSha}`), "check runs");
  return normalized;
}
function normalizeLocal(value) {
  requireObject(value, "Local evidence");
  const local = {
    worktreePath: requiredText(value.worktreePath, "local worktree path"), registered: value.registered, attached: value.attached, clean: value.clean, branch: requiredText(value.branch, "local branch"), headSha: requiredSha(value.headSha, "local head SHA"),
    treeSha: requiredSha(value.treeSha, "local tree SHA"), indexDigest: requiredDigest(value.indexDigest, "local index digest"), workingTreeDigest: requiredDigest(value.workingTreeDigest, "local working-tree digest"), stateDigest: requiredDigest(value.stateDigest, "local state digest"),
    remote: normalizeRemote(value.remote), lease: normalizeLease(value.lease), lineage: normalizeLocalLineage(value.lineage), };
  if (local.registered !== true || local.attached !== true || local.clean !== true
    || local.remote.name !== "origin" || local.remote.branchPresent !== false) {
    throw new Error("Reconciliation requires a clean registered attached lane with no remote branch.");
  }
  return deepFreeze(local);
}
function normalizeRemote(value) {
  requireObject(value, "Local remote evidence");
  return Object.freeze({
    name: requiredText(value.name, "local remote name"), branchPresent: value.branchPresent, });
}
function normalizeLocalLineage(value) {
  requireObject(value, "Local lineage evidence");
  requireObject(value.fence, "Local coordination fence"); requireObject(value.reviewedHead, "Local reviewed head");
  return deepFreeze({
    fence: { sha: requiredSha(value.fence.sha, "coordination fence SHA"), treeSha: requiredSha(value.fence.treeSha, "coordination fence tree"),
      parentSha: requiredSha(value.fence.parentSha, "coordination fence parent"), parentTreeSha: requiredSha(value.fence.parentTreeSha, "coordination fence parent tree") },
    reviewedHead: { sha: requiredSha(value.reviewedHead.sha, "reviewed head SHA"), treeSha: requiredSha(value.reviewedHead.treeSha, "reviewed head tree"),
      parentSha: requiredSha(value.reviewedHead.parentSha, "reviewed head parent"), changedPaths: Object.freeze(normalizePaths(value.reviewedHead.changedPaths, "reviewed changed paths")) }, });
}
function normalizeLease(value) {
  requireObject(value, "Local lease evidence");
  const lease = {
    schema: requiredText(value.schema, "local lease schema"), status: requiredText(value.status, "local lease status"), epoch: positiveInteger(value.epoch, "local lease epoch"),
    sessionId: requiredText(value.sessionId, "local lease session ID"), device: requiredText(value.device, "local lease device"), scope: requiredText(value.scope, "local lease scope"),
    branch: requiredText(value.branch, "local lease branch"), baseSha: requiredSha(value.baseSha, "local lease base SHA"), fenceSha: requiredSha(value.fenceSha, "local lease fence SHA"),
    reviewHeadSha: requiredSha(value.reviewHeadSha, "local lease review head SHA"), pullRequestUrl: requiredText(value.pullRequestUrl, "local lease pull request URL"),
    leaseDigest: requiredDigest(value.leaseDigest, "local lease digest"), cloudAuthority: normalizeLocalAuthority(value.cloudAuthority), };
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "review_ready") {
    throw new Error("Local evidence requires an exact review_ready writer lease.");
  }
  return deepFreeze(lease);
}
function normalizeLocalAuthority(value) {
  requireObject(value, "Local cloud authority");
  const authority = {
    claimId: requiredDigest(value.claimId, "local authority claim ID"), claimDigest: requiredDigest(value.claimDigest, "local authority claim digest"),
    ledgerRevision: requiredSha(value.ledgerRevision, "local authority ledger revision"), ledgerDigest: requiredDigest(value.ledgerDigest, "local authority ledger digest"),
    claimLedgerRevision: requiredDigest(value.claimLedgerRevision, "local authority transition digest"), operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "local authority operation receipt digest"),
    deviceId: requiredText(value.deviceId, "local authority cloud device ID"), sessionId: requiredText(value.sessionId, "local authority cloud session ID"),
    canonicalBaseSha: requiredSha(value.canonicalBaseSha, "local authority canonical base"), laneRevision: requiredSha(value.laneRevision, "local authority lane revision"),
    writeSetDigest: requiredDigest(value.writeSetDigest, "local authority write-set digest"), reviewRequestId: requiredText(value.reviewRequestId, "local authority review request ID"), focusedEvidenceDigest: requiredDigest(
      value.focusedEvidenceDigest, "local authority focused evidence digest", ), leaseEpoch: positiveInteger(value.leaseEpoch, "local authority lease epoch"),
    transitionCounter: positiveInteger(value.transitionCounter, "local authority transition counter"), state: requiredText(value.state, "local authority state"), integrationReceiptDigest: requiredNull(
      value.integrationReceiptDigest, "local authority integration receipt digest", ), integration: requiredNull(value.integration, "local authority integration"), };
  if (!new Set(["review_ready", "dormant-preserved"]).has(authority.state)) {
    throw new Error("Local authority must preserve its review-ready or dormant projection.");
  }
  return Object.freeze(authority);
}
function assertSourceJoins({ claim, provider, local }) {
  const authority = local.lease.cloudAuthority;
  if (provider.repositoryId !== claim.repositoryId
    || provider.repository.toLowerCase() !== provider.pullRequest.headRepository.toLowerCase()
    || provider.repository.toLowerCase() !== provider.pullRequest.baseRepository.toLowerCase()
    || provider.claimHead.sha !== claim.laneRevision
    || provider.claimHead.sha !== local.headSha
    || provider.claimHead.treeSha !== local.treeSha
    || local.branch !== provider.pullRequest.headBranch
    || local.lease.branch !== local.branch
    || local.lease.reviewHeadSha !== local.headSha
    || local.lease.baseSha !== claim.canonicalBaseRevision
    || local.lease.pullRequestUrl !== provider.pullRequest.url
    || claim.reviewRequestId !== `github-pull-request:${provider.pullRequest.nodeId}`) {
    throw new Error("Provider, claim, and preserved local revision identities do not join.");
  }
  const { fence, reviewedHead } = local.lineage;
  if (fence.sha !== local.lease.fenceSha || fence.parentSha !== claim.canonicalBaseRevision || fence.treeSha !== fence.parentTreeSha
    || reviewedHead.sha !== local.headSha || reviewedHead.treeSha !== local.treeSha || reviewedHead.parentSha !== fence.sha
    || reviewedHead.changedPaths.some(path => !writeSetCoversPath(claim.declaredWriteScope, path))) {
    throw new Error("Local fence and reviewed-head lineage is not the exact scope-covered chain.");
  }
  let previous = provider.claimHead.sha;
  for (const refresh of provider.refreshChain) {
    if (refresh.parents[0] !== previous) {
      throw new Error("Provider refresh chain is not an exact first-parent sequence.");
    }
    if (refresh.scopeTreeDigest !== provider.claimHead.scopeTreeDigest) {
      throw new Error("Provider refresh chain changes the reviewed scope bytes.");
    }
    previous = refresh.sha;
  }
  const lastMainParent = provider.refreshChain.at(-1)?.parents[1] ?? claim.canonicalBaseRevision;
  if (provider.mergeCommitParents[0] !== lastMainParent
    || provider.mergeChangedPaths.some(path => !writeSetCoversPath(claim.declaredWriteScope, path))) {
    throw new Error("Provider merge topology or changed paths escape the reviewed claim.");
  }
  const pairs = [
    [authority.claimId, claim.claimId], [authority.claimDigest, claim.claimDigest], [authority.claimLedgerRevision, claim.transitionDigest], [authority.operationReceiptDigest, claim.operationReceiptDigest],
    [authority.canonicalBaseSha, claim.canonicalBaseRevision], [authority.laneRevision, claim.laneRevision], [authority.writeSetDigest, claim.writeSetDigest],
    [authority.reviewRequestId, claim.reviewRequestId], [authority.focusedEvidenceDigest, claim.evidenceDigest], [authority.leaseEpoch, claim.leaseEpoch], [authority.transitionCounter, claim.transitionCounter], ];
  if (pairs.some(([left, right]) => left !== right)) {
    throw new Error("Local cloud authority does not exactly project the dormant claim.");
  }
  if (authority.deviceId !== local.lease.device || authority.sessionId !== local.lease.sessionId
    || pseudonymousIdentifier("device", authority.deviceId) !== claim.deviceId
    || pseudonymousIdentifier("session", authority.sessionId) !== claim.sessionId) {
    throw new Error("Local owner inputs do not map to the cloud claim owner identity.");
  }
}
function normalizePlanEnvelope(value) {
  requireObject(value, "Reconciliation plan");
  if (value.schema !== PLAN_SCHEMA) throw new Error("Unsupported reconciliation plan.");
  const { planDigest, exactAuthorization, ...core } = value;
  if (requiredDigest(planDigest, "plan digest") !== digestValue(core)) {
    throw new Error("Merged dormant reconciliation plan digest is invalid.");
  }
  if (exactAuthorization !== `authorize merged-dormant-claim-reconciliation ${planDigest}`) {
    throw new Error("Merged dormant reconciliation exact authorization is invalid.");
  }
  return value;
}
function normalizeIntentEnvelope(value, planDigest, phase) {
  requireObject(value, "Reconciliation intent");
  if (value.schema !== INTENT_SCHEMA || value.planDigest !== planDigest) {
    throw new Error("Merged dormant reconciliation intent does not join its plan.");
  }
  const statusIndex = INTENT_STATUSES.indexOf(value.status);
  const phaseIndex = INTENT_STATUSES.indexOf(phase);
  if (statusIndex < 0 || statusIndex < phaseIndex - 1) {
    throw new Error(`Merged dormant reconciliation cannot observe ${phase} before its predecessor.`);
  }
  const { intentDigest, ...core } = value;
  if (requiredDigest(intentDigest, "intent digest") !== digestValue(core)) {
    throw new Error("Merged dormant reconciliation intent digest is invalid.");
  }
  requiredDigest(value.authorizationDigest, "intent authorization digest");
  return value;
}
function normalizeRevision(value, label) {
  requireObject(value, label);
  return Object.freeze({
    sha: requiredSha(value.sha, `${label} SHA`), treeSha: requiredSha(value.treeSha, `${label} tree`), scopeTreeDigest: requiredDigest(value.scopeTreeDigest, `${label} scope tree digest`), });
}
function compareChecks(left, right) {
  return left.context.localeCompare(right.context) || String(left.appId).localeCompare(String(right.appId));
}
function rejectDuplicates(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
function writeSetCoversPath(writeSet, changedPath) {
  return writeSet.some((scope) => {
    if (!scope.startsWith("path:")) return false;
    const ownedPath = scope.slice("path:".length);
    return ownedPath === "." || changedPath === ownedPath || changedPath.startsWith(`${ownedPath}/`);
  });
}
function requiredPhase(value) {
  const phase = requiredText(value, "reconciliation phase");
  if (!PHASES.includes(phase)) throw new Error(`Unsupported reconciliation phase: ${phase}.`);
  return phase;
}
function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`${label} must use owner/repository form.`);
  }
  return repository;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.normalize("NFC").trim();
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase SHA.`);
  return sha;
}
function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}
function optionalDigest(value, label) {
  return value == null ? null : requiredDigest(value, label);
}
function requiredInstant(value, label) {
  const instant = requiredText(value, label);
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO-8601 instant.`);
  return new Date(milliseconds).toISOString();
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
function optionalPositiveInteger(value, label) {
  return value === null ? null : positiveInteger(value, label);
}
function requiredNull(value, label) {
  if (value !== null) throw new Error(`${label} must be null.`);
  return null;
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
