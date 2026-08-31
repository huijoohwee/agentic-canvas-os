// Responsibility: bind the exact provider-only reviewed source/waiter pair and merged provider proof.
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_EVIDENCE_SCHEMA =
  "agentic-provider-only-merged-claim-pair-reconciliation-evidence/v1";
export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RUNTIME_PATHS = Object.freeze([
  ...["cloud-collaboration-contract", "cloud-collaboration-primitives", "github-cloud-collaboration-adapter",
    "merged-dormant-claim-reconciliation-repository-adapter", "private-operation-lock"].map(name => `scripts/${name}.mjs`),
  ...["contract", "controller", "evidence", "repository-adapter"].map(
    name => `scripts/provider-only-merged-claim-pair-reconciliation-${name}.mjs`,
  ),
  "scripts/provider-only-merged-claim-pair-reconciliation.mjs",
  "scripts/scoped-lane-cloud-authority.mjs",
]);

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const CLAIM_ENTRY_V1 = "agentic-cloud-collaboration-entry/v1";
const CLAIM_ENTRY_V2 = "agentic-cloud-collaboration-entry/v2";
export function buildProviderOnlyMergedClaimPairReconciliationEvidence(input) {
  object(input, "Provider-only reconciliation evidence input");
  return assemble({
    controller: normalizeController(input.controller),
    cloud: normalizeCloud(input.cloud),
    provider: normalizeProvider(input.provider),
    local: normalizeLocal(input.local),
    recoveryTtlSeconds: boundedTtl(input.recoveryTtlSeconds),
  });
}
export function normalizeProviderOnlyMergedClaimPairReconciliationEvidence(value) {
  object(value, "Provider-only reconciliation evidence");
  if (value.schema !== PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_EVIDENCE_SCHEMA) {
    throw new Error("Unsupported provider-only merged-claim-pair evidence schema.");
  }
  const normalized = assemble({
    controller: normalizeController(value.controller),
    cloud: normalizeCloud(value.cloud),
    provider: normalizeProvider(value.provider),
    local: normalizeLocal(value.local),
    recoveryTtlSeconds: boundedTtl(value.recoveryTtlSeconds),
  });
  if (normalized.evidenceDigest !== value.evidenceDigest) {
    throw new Error("Provider-only merged-claim-pair evidence digest is invalid.");
  }
  return normalized;
}
export function providerOnlyMergedClaimPairRelevantClaims(claims, source, waiter) {
  const normalized = normalizeClaims(claims);
  return normalized.filter(claim => (
    claim.workItemId === source.workItemId
    || claim.claimId === source.claimId
    || claim.claimId === waiter.claimId
    || claim.predecessorClaimId === source.claimId
    || claim.predecessorClaimId === waiter.claimId
    || writeSetsOverlap(claim.declaredWriteScope, source.declaredWriteScope)
  ));
}
export function providerOnlyMergedClaimPairInventoryDigest(claims) {
  return digestValue(normalizeClaims(claims));
}
function assemble({ controller, cloud, provider, local, recoveryTtlSeconds }) {
  const { source, waiter } = cloud;
  assertPair(source, waiter);
  assertLineage(cloud.sourceLineage, source, "source");
  assertLineage(cloud.waiterLineage, waiter, "waiter");
  const relevant = providerOnlyMergedClaimPairRelevantClaims(cloud.currentClaims, source, waiter);
  if (relevant.length !== 2
    || !relevant.some(claim => claim.claimId === source.claimId)
    || !relevant.some(claim => claim.claimId === waiter.claimId)) {
    throw new Error("Provider-only reconciliation requires exactly the source/waiter relevant pair.");
  }
  const unrelated = cloud.currentClaims.filter(claim => (
    claim.claimId !== source.claimId && claim.claimId !== waiter.claimId
  ));
  const joinedCloud = deepFreeze({
    ...cloud,
    currentInventoryDigest: providerOnlyMergedClaimPairInventoryDigest(cloud.currentClaims),
    relevantClaimIds: Object.freeze([source.claimId, waiter.claimId].sort()),
    unrelatedInventoryDigest: providerOnlyMergedClaimPairInventoryDigest(unrelated),
    sourceLineageDigest: digestValue(cloud.sourceLineage),
    waiterLineageDigest: digestValue(cloud.waiterLineage),
  });
  assertJoins({ controller, cloud: joinedCloud, provider, local });
  const preservation = deepFreeze({
    sourceFiles: "unchanged",
    gitObjectsAndRefs: "unchanged",
    pullRequest: "unchanged",
    providerDeployment: "forbidden",
    unrelatedClaims: "append-only-out-of-scope",
    journal: "private-only",
  });
  const core = {
    schema: PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_EVIDENCE_SCHEMA,
    controller,
    cloud: joinedCloud,
    provider,
    local,
    recoveryTtlSeconds,
    preservation,
    bytesDigest: digestValue({
      head: provider.headCommit,
      merge: provider.mergeCommit,
      changedPaths: provider.changedPaths,
      mergePathObjects: provider.mergePathObjects,
    }),
    namedChecksDigest: digestValue({
      enrollment: provider.protection.enrollment.semanticDigest,
      historicalController: provider.protection.historicalController.semanticDigest,
      requiredCheckWitnesses: provider.protection.requiredCheckWitnesses,
    }),
    handoffEvidenceDigest: digestValue({
      sourceClaimId: source.claimId,
      waiterClaimId: waiter.claimId,
      sourceLineageDigest: digestValue(cloud.sourceLineage),
      waiterLineageDigest: digestValue(cloud.waiterLineage),
      preservation,
    }),
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}
function normalizeController(value) {
  object(value, "Controller evidence");
  const runtimeFiles = array(value.runtimeFiles, "controller runtime files").map((file, index) => {
    object(file, `controller runtime file ${index}`);
    return deepFreeze({
      path: relativePath(file.path, `controller runtime path ${index}`),
      blobSha: sha(file.blobSha, `controller runtime blob ${index}`),
      contentDigest: digest(file.contentDigest, `controller runtime content ${index}`),
    });
  }).sort((left, right) => left.path.localeCompare(right.path));
  unique(runtimeFiles.map(file => file.path), "controller runtime paths");
  if (JSON.stringify(runtimeFiles.map(file => file.path))
    !== JSON.stringify(PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RUNTIME_PATHS)) {
    throw new Error("Controller runtime proof must bind the exact dedicated module set.");
  }
  const normalized = deepFreeze({
    repositoryRoot: absolutePath(value.repositoryRoot, "controller repository root"),
    originRepository: repository(value.originRepository, "controller origin repository"),
    branch: text(value.branch, "controller branch"),
    headSha: sha(value.headSha, "controller head"),
    protectedMainSha: sha(value.protectedMainSha, "controller protected main"),
    baselineProtectedMainSha: sha(value.baselineProtectedMainSha, "controller baseline protected main"),
    headIsAncestorOfProtectedMain: value.headIsAncestorOfProtectedMain,
    baselineIsAncestorOfProtectedMain: value.baselineIsAncestorOfProtectedMain,
    clean: value.clean,
    runtimeFiles: Object.freeze(runtimeFiles),
    runtimeDigest: digest(value.runtimeDigest, "controller runtime digest"),
    protectedRuntimeDigest: digest(value.protectedRuntimeDigest, "protected controller runtime digest"),
  });
  if (normalized.branch !== "main" || normalized.clean !== true
    || normalized.headIsAncestorOfProtectedMain !== true
    || normalized.baselineIsAncestorOfProtectedMain !== true
    || normalized.runtimeDigest !== digestValue(runtimeFiles)
    || normalized.protectedRuntimeDigest !== normalized.runtimeDigest) {
    throw new Error("Controller must be a clean protected descendant with unchanged content-bound runtime files.");
  }
  return normalized;
}
function normalizeCloud(value) {
  object(value, "Cloud evidence");
  const sequence = positive(value.sequence, "cloud ledger sequence");
  const ledgerDigest = digest(value.ledgerDigest, "cloud ledger digest");
  const ledgerValidationDigest = digest(value.ledgerValidationDigest, "cloud ledger validation digest");
  if (ledgerValidationDigest !== digestValue({ sequence, ledgerDigest, failures: [] })) {
    throw new Error("Cloud ledger validation digest does not prove one valid complete ledger.");
  }
  return deepFreeze({
    ledgerRepository: repository(value.ledgerRepository, "ledger repository"),
    ledgerRevision: sha(value.ledgerRevision, "ledger revision"),
    ledgerDigest,
    sequence,
    ledgerValidationDigest,
    source: normalizeClaim(value.source, "source claim"),
    waiter: normalizeClaim(value.waiter, "waiter claim"),
    sourceLineage: Object.freeze(normalizeLineage(value.sourceLineage, "source lineage")),
    waiterLineage: Object.freeze(normalizeLineage(value.waiterLineage, "waiter lineage")),
    currentClaims: Object.freeze(normalizeClaims(value.currentClaims)),
  });
}
function normalizeClaim(value, label = "cloud claim") {
  object(value, label);
  const declaredWriteScope = Object.freeze(normalizeWriteSet(value.declaredWriteScope));
  const suppliedEntrySchema = value.entrySchema == null
    ? null : text(value.entrySchema, `${label} entry schema`);
  const suppliedIdentitySchema = value.claimIdentitySchema == null
    ? null : text(value.claimIdentitySchema, `${label} claim identity schema`);
  if ((suppliedEntrySchema && ![CLAIM_ENTRY_V1, CLAIM_ENTRY_V2].includes(suppliedEntrySchema))
    || (suppliedIdentitySchema && ![CLAIM_ENTRY_V1, CLAIM_ENTRY_V2].includes(suppliedIdentitySchema))
    || (suppliedEntrySchema && suppliedIdentitySchema
      && suppliedEntrySchema !== suppliedIdentitySchema)) {
    throw new Error(`${label} has an unsupported or mismatched claim identity schema.`);
  }
  const normalized = {
    entrySchema: suppliedEntrySchema,
    claimIdentitySchema: suppliedIdentitySchema,
    claimId: digest(value.claimId, `${label} ID`),
    claimDigest: digest(value.claimDigest ?? value.fenceRevision, `${label} digest`),
    transitionDigest: digest(value.transitionDigest, `${label} transition digest`),
    operationReceiptDigest: digest(value.operationReceiptDigest, `${label} receipt digest`),
    state: text(value.state, `${label} state`),
    recordedState: text(value.recordedState ?? value.state, `${label} recorded state`),
    writeAuthority: value.writeAuthority,
    scopeReserved: value.scopeReserved,
    actorId: text(value.actorId, `${label} actor`),
    deviceId: text(value.deviceId, `${label} device`),
    sessionId: text(value.sessionId, `${label} session`),
    repositoryId: text(value.repositoryId, `${label} repository ID`),
    workItemId: text(value.workItemId, `${label} work item`),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, `${label} base`),
    laneRevision: sha(value.laneRevision, `${label} lane revision`),
    declaredWriteScope,
    writeSetDigest: digest(value.writeSetDigest, `${label} write-set digest`),
    leaseEpoch: positive(value.leaseEpoch, `${label} lease epoch`),
    transitionCounter: positive(value.transitionCounter, `${label} transition counter`),
    heartbeatCounter: nonnegative(value.heartbeatCounter ?? 0, `${label} heartbeat counter`),
    reviewRequestId: optionalText(value.reviewRequestId),
    predecessorClaimId: optionalDigest(value.predecessorClaimId),
    evidenceDigest: optionalDigest(value.evidenceDigest),
    integrationReceiptDigest: optionalDigest(value.integrationReceiptDigest),
    integration: jsonValue(value.integration ?? null, `${label} integration`),
    retirement: jsonValue(value.retirement ?? null, `${label} retirement`),
  };
  const v2Identity = {
      actorId: normalized.actorId,
      canonicalBaseRevision: normalized.canonicalBaseRevision,
      leaseEpoch: normalized.leaseEpoch,
      repositoryId: normalized.repositoryId,
      workItemId: normalized.workItemId,
      writeSetDigest: normalized.writeSetDigest,
  };
  const v1Identity = {
    ...v2Identity,
    deviceId: normalized.deviceId,
    sessionId: normalized.sessionId,
  };
  const inferredSchemas = [
    [CLAIM_ENTRY_V1, v1Identity],
    [CLAIM_ENTRY_V2, v2Identity],
  ].filter(([, identity]) => normalized.claimId === digestValue(identity))
    .map(([schema]) => schema);
  const inferredSchema = inferredSchemas.length === 1 ? inferredSchemas[0] : null;
  const requiredSchema = suppliedIdentitySchema ?? suppliedEntrySchema ?? inferredSchema;
  if (normalized.writeSetDigest !== digestValue(declaredWriteScope)
    || !inferredSchema || requiredSchema !== inferredSchema) {
    throw new Error(`${label} has an invalid write-set or claim identity digest.`);
  }
  normalized.entrySchema = inferredSchema;
  normalized.claimIdentitySchema = inferredSchema;
  return deepFreeze(normalized);
}
function normalizeClaims(values) {
  const claims = array(values, "current cloud claims").map((value, index) => (
    normalizeClaim(value, `current cloud claim ${index}`)
  )).sort((left, right) => left.claimId.localeCompare(right.claimId));
  unique(claims.map(claim => claim.claimId), "current cloud claim IDs");
  return Object.freeze(claims);
}
function normalizeLineage(values, label) {
  const entries = array(values, label).map((value, index) => {
    object(value, `${label} entry ${index}`);
    return deepFreeze({
      schema: text(value.schema, `${label} schema ${index}`),
      sequence: positive(value.sequence, `${label} sequence ${index}`),
      action: text(value.action, `${label} action ${index}`),
      claimId: digest(value.claimId, `${label} claim ID ${index}`),
      claimDigest: digest(value.claimDigest, `${label} claim digest ${index}`),
      digest: digest(value.digest, `${label} entry digest ${index}`),
      evaluationTime: instant(value.evaluationTime, `${label} time ${index}`),
      transitionCounter: positive(
        value.transitionCounter ?? value.claimCore?.transitionCounter,
        `${label} transition counter ${index}`,
      ),
      recordedState: text(
        value.recordedState ?? value.claimCore?.state,
        `${label} recorded state ${index}`,
      ),
    });
  });
  if (entries.length === 0) throw new Error(`${label} must contain the complete claim lineage.`);
  return entries;
}

function normalizeProvider(value) {
  object(value, "Provider evidence");
  const pullRequest = normalizePullRequest(value.pullRequest);
  const headCommit = normalizeCommit(value.headCommit, "provider head commit");
  const mergeCommit = normalizeCommit(value.mergeCommit, "provider merge commit");
  const changedPaths = {
    pullRequest: Object.freeze(paths(value.changedPaths?.pullRequest, "pull-request changed paths")),
    mergeCommit: Object.freeze(paths(value.changedPaths?.mergeCommit, "merge changed paths")),
  };
  const checkRuns = deduplicate(array(value.checkRuns, "provider check runs").map(normalizeCheckRun)
    .sort(compareChecks));
  const protection = normalizeProtection(value.protection);
  const requiredCheckWitnesses = projectRequiredCheckWitnesses(
    protection, checkRuns, [headCommit.sha, mergeCommit.sha],
  );
  const mergePathObjects = Object.freeze(normalizePathObjects(value.mergePathObjects, "merge path"));
  const protectedAdvanceChangedPaths = Object.freeze(array(
    value.protectedAdvanceChangedPaths,
    "protected-main advancement paths",
  ).map(item => relativePath(item, "protected-main advancement path")).sort());
  unique(protectedAdvanceChangedPaths, "protected-main advancement paths");
  if (protectedAdvanceChangedPaths.some(changedPath => changedPaths.pullRequest.includes(changedPath))) {
    throw new Error("Protected main advanced through a source path.");
  }
  const protectedMainPaths = value.protectedMainPaths == null
    ? mergePathObjects
    : Object.freeze(array(value.protectedMainPaths, "protected-main path objects").length === 0
      ? [] : normalizePathObjects(value.protectedMainPaths, "protected-main path"));
  return deepFreeze({
    provider: text(value.provider, "provider"),
    repository: repository(value.repository, "provider repository"),
    repositoryId: text(value.repositoryId, "provider repository ID"),
    actorId: text(value.actorId, "provider actor ID"),
    actorLogin: text(value.actorLogin, "provider actor login"),
    pullRequest,
    headCommit,
    mergeCommit,
    protectedMain: normalizeCommit(value.protectedMain, "protected main commit"),
    plannedProtectedMainSha: sha(value.plannedProtectedMainSha, "planned protected main"),
    plannedProtectedMainIsAncestorOfProtectedMain:
      value.plannedProtectedMainIsAncestorOfProtectedMain,
    mergePathObjects,
    protectedMainPaths,
    protectedAdvanceChangedPaths,
    mergeCommitIsAncestorOfProtectedMain: value.mergeCommitIsAncestorOfProtectedMain,
    changedPaths: deepFreeze(changedPaths),
    protection: deepFreeze({ ...protection, requiredCheckWitnesses }),
    checkRuns: Object.freeze(checkRuns),
    writerMarkerPresent: value.writerMarkerPresent,
  });
}

function normalizePullRequest(value) {
  object(value, "Provider pull request");
  return deepFreeze({
    number: positive(value.number, "pull request number"),
    nodeId: text(value.nodeId, "pull request node ID"),
    url: text(value.url, "pull request URL"),
    state: text(value.state, "pull request state").toUpperCase(),
    draft: value.draft,
    merged: value.merged,
    mergedAt: instant(value.mergedAt, "pull request merged time"),
    headRepository: repository(value.headRepository, "pull request head repository"),
    headBranch: text(value.headBranch, "pull request head branch"),
    headSha: sha(value.headSha, "pull request head SHA"),
    baseRepository: repository(value.baseRepository, "pull request base repository"),
    baseBranch: text(value.baseBranch, "pull request base branch"),
    baseSha: sha(value.baseSha, "pull request base SHA"),
    mergeCommitSha: sha(value.mergeCommitSha, "pull request merge SHA"),
  });
}

function normalizeCommit(value, label) {
  object(value, label);
  return deepFreeze({
    sha: sha(value.sha, `${label} SHA`),
    treeSha: sha(value.treeSha, `${label} tree`),
    parents: Object.freeze(array(value.parents ?? [], `${label} parents`).map((item, index) => (
      sha(item, `${label} parent ${index}`)
    ))),
  });
}

function normalizeProtection(value) {
  object(value, "Provider protection evidence");
  const enrollment = value.enrollment;
  object(enrollment, "Protection enrollment");
  const classic = strings(enrollment.classicRequiredChecks, "classic enrollment checks");
  const ruleset = strings(enrollment.rulesetRequiredChecks, "ruleset enrollment checks");
  const requiredCi = strings(enrollment.requiredCiContexts, "required CI enrollment checks");
  const live = deduplicate(array(value.liveRequiredChecks, "live required checks").map((check, index) => {
    object(check, `live required check ${index}`);
    return deepFreeze({
      context: text(check.context, `live required check context ${index}`),
      appId: check.appId === null ? null : positive(check.appId, `live required check app ${index}`),
      source: text(check.source, `live required check source ${index}`),
      strict: check.strict,
    });
  }).sort(compareChecks));
  const enrollmentCore = {
      workflowPath: relativePath(enrollment.workflowPath, "enrollment workflow path"),
      contentDigest: digest(enrollment.contentDigest, "enrollment content digest"),
      workflowJob: text(enrollment.workflowJob, "enrollment workflow job"),
      checkoutActionRevision: sha(enrollment.checkoutActionRevision, "enrollment checkout action revision"),
      controllerPath: enrollmentControllerPath(enrollment.controllerPath),
      controllerRevision: sha(enrollment.controllerRevision, "enrollment controller revision"),
      runCommand: text(enrollment.runCommand, "enrollment run command"),
      classicRequiredChecks: Object.freeze(classic), rulesetRequiredChecks: Object.freeze(ruleset),
      requiredCiContexts: Object.freeze(requiredCi),
  };
  const semanticEnrollment = { ...enrollmentCore };
  delete semanticEnrollment.contentDigest;
  if (enrollmentCore.workflowPath !== ".github/workflows/auto-delivery.yml"
    || enrollmentCore.workflowJob !== "protected-head-refresh"
    || enrollmentCore.runCommand !== `node ${enrollmentCore.controllerPath === "." ? "" : `${enrollmentCore.controllerPath}/`}scripts/sync-open-pr.mjs --protected-head-refresh`
    || enrollment.semanticDigest !== digestValue(semanticEnrollment)) {
    throw new Error("Protected-refresh enrollment semantic proof is incomplete.");
  }
  return deepFreeze({
    enrollment: deepFreeze({ ...enrollmentCore,
      semanticDigest: digestValue(semanticEnrollment) }),
    historicalController: normalizeHistoricalController(value.historicalController),
    liveRequiredChecks: Object.freeze(live),
    applicableRulesDigest: digest(value.applicableRulesDigest, "applicable rules digest"),
  });
}

function normalizeHistoricalController(value) {
  object(value, "Historical delivery controller evidence");
  const semantic = { repository: repository(value.repository, "historical controller repository"),
    revision: sha(value.revision, "historical controller revision"),
    treeSha: sha(value.treeSha, "historical controller tree"),
    entrypoint: relativePath(value.entrypoint, "historical controller entrypoint"),
    mode: text(value.mode, "historical controller mode"),
    entrypointBlobSha: sha(value.entrypointBlobSha, "historical controller entrypoint blob"),
    entrypointContentDigest: digest(value.entrypointContentDigest, "historical controller entrypoint content"),
    adapterPath: relativePath(value.adapterPath, "historical controller adapter path"),
    adapterBlobSha: sha(value.adapterBlobSha, "historical controller adapter blob"),
    adapterContentDigest: digest(value.adapterContentDigest, "historical controller adapter content"),
    executableWitnessDigest: digest(value.executableWitnessDigest, "historical controller executable witness") };
  const normalized = deepFreeze({ ...semantic,
    currentControllerRevision: sha(value.currentControllerRevision, "current controller revision"),
    isAncestorOfCurrentController: value.isAncestorOfCurrentController,
    semanticDigest: digest(value.semanticDigest, "historical controller semantic digest"),
  });
  if (normalized.entrypoint !== "scripts/sync-open-pr.mjs"
    || normalized.adapterPath !== "scripts/protected-head-refresh-github-adapter.mjs"
    || normalized.mode !== "--protected-head-refresh"
    || normalized.isAncestorOfCurrentController !== true || normalized.semanticDigest !== digestValue(semantic)) {
    throw new Error("Historical delivery controller proof is incomplete or non-ancestral.");
  }
  return normalized;
}

function enrollmentControllerPath(value) { return value === "." ? "."
  : relativePath(value, "enrollment controller path"); }

function normalizeCheckRun(value, index) {
  object(value, `check run ${index}`);
  return deepFreeze({
    name: text(value.name, `check run name ${index}`),
    appId: value.appId === null ? null : positive(value.appId, `check run app ${index}`),
    headSha: sha(value.headSha, `check run head ${index}`),
    status: text(value.status, `check run status ${index}`).toUpperCase(),
    conclusion: text(value.conclusion, `check run conclusion ${index}`).toUpperCase(),
  });
}

function normalizeLocal(value) {
  object(value, "Local absence evidence");
  return deepFreeze({
    repositoryRoot: absolutePath(value.repositoryRoot, "local repository root"),
    originRepository: repository(value.originRepository, "local origin repository"),
    branch: text(value.branch, "local branch"),
    headSha: sha(value.headSha, "local head"),
    protectedMainSha: sha(value.protectedMainSha, "local protected main"),
    providerProtectedMainSha: sha(value.providerProtectedMainSha, "provider protected main"),
    headIsAncestorOfProviderProtectedMain: value.headIsAncestorOfProviderProtectedMain,
    clean: value.clean,
    sourceBranchRefPresent: value.sourceBranchRefPresent,
    registeredSourceWorktreeCount: nonnegative(
      value.registeredSourceWorktreeCount,
      "registered source worktree count",
    ),
    matchingLeaseCount: nonnegative(value.matchingLeaseCount, "matching lease count"),
  });
}

function assertPair(source, waiter) {
  const same = ["actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest"];
  if (source.entrySchema !== CLAIM_ENTRY_V2 || source.claimIdentitySchema !== CLAIM_ENTRY_V2
    || waiter.entrySchema !== CLAIM_ENTRY_V2 || waiter.claimIdentitySchema !== CLAIM_ENTRY_V2) {
    throw new Error("Provider-only reconciliation requires an exact v2 source/waiter pair.");
  }
  const reviewedSource = source.recordedState === "reviewed" && Boolean(source.evidenceDigest);
  const projectedSource = source.recordedState === "current" && source.evidenceDigest === null;
  if (source.state !== "dormant-preserved" || (!reviewedSource && !projectedSource)
    || source.writeAuthority !== false || source.scopeReserved !== true
    || !source.reviewRequestId || source.integration !== null
    || source.integrationReceiptDigest !== null) {
    throw new Error("Source must be the exact dormant-preserved reviewed non-integrated claim.");
  }
  if (waiter.state !== "waiting-successor" || waiter.recordedState !== "waiting-successor"
    || waiter.writeAuthority !== false || waiter.scopeReserved !== false
    || waiter.predecessorClaimId !== source.claimId || waiter.reviewRequestId !== null
    || waiter.evidenceDigest !== null || waiter.integration !== null
    || waiter.integrationReceiptDigest !== null || waiter.leaseEpoch !== source.leaseEpoch + 1
    || same.some(field => waiter[field] !== source[field])) {
    throw new Error("Waiter must be the exact same-subject direct successor without authority.");
  }
}

function assertLineage(lineage, claim, label) {
  if (lineage[0].action !== "claim"
    || lineage.some(entry => entry.schema !== "agentic-cloud-collaboration-entry/v2")
    || lineage.some(entry => entry.claimId !== claim.claimId)
    || lineage.some((entry, index) => entry.transitionCounter !== index + 1)
    || lineage.slice(1).some(entry => entry.action !== "continue")
    || lineage.at(-1).claimDigest !== claim.claimDigest
    || lineage.at(-1).digest !== claim.transitionDigest
    || lineage.at(-1).transitionCounter !== claim.transitionCounter
    || lineage.at(-1).recordedState !== claim.recordedState) {
    throw new Error(`The ${label} claim lineage is incomplete or does not join its current claim.`);
  }
  if (label === "waiter" && lineage.length !== 1) {
    throw new Error("The direct waiter must have exactly one claim transition.");
  }
}

function assertJoins({ controller, cloud, provider, local }) {
  const { source } = cloud;
  const pull = provider.pullRequest;
  const pathScopes = source.declaredWriteScope.filter(item => item.startsWith("path:"));
  const covered = changedPath => pathScopes.some(item => {
    const owned = item.slice(5);
    return owned === "." || changedPath === owned || changedPath.startsWith(`${owned}/`);
  });
  if (provider.provider !== "github" || provider.repositoryId !== source.repositoryId
    || provider.actorId !== source.actorId || pull.number < 1 || pull.state !== "CLOSED"
    || pull.draft !== false || pull.merged !== true || pull.baseBranch !== "main"
    || pull.headRepository.toLowerCase() !== provider.repository.toLowerCase()
    || pull.baseRepository.toLowerCase() !== provider.repository.toLowerCase()
    || pull.headSha !== source.laneRevision || provider.headCommit.sha !== pull.headSha
    || provider.mergeCommit.sha !== pull.mergeCommitSha
    || provider.headCommit.treeSha !== provider.mergeCommit.treeSha
    || provider.mergeCommit.parents.length !== 1
    || provider.mergeCommit.parents[0] !== source.canonicalBaseRevision
    || pull.baseSha !== source.canonicalBaseRevision
    || source.reviewRequestId !== `github-pull-request:${pull.nodeId}`
    || provider.mergeCommitIsAncestorOfProtectedMain !== true
    || provider.plannedProtectedMainIsAncestorOfProtectedMain !== true
    || provider.writerMarkerPresent !== false) {
    throw new Error("Provider, pair, direct squash, and merged protected-main identities do not join.");
  }
  if (controller.originRepository.toLowerCase() !== cloud.ledgerRepository.toLowerCase()) {
    throw new Error("Controller origin does not join the repository-owned cloud ledger.");
  }
  const historical = provider.protection.historicalController;
  if (provider.protection.enrollment.workflowPath !== ".github/workflows/auto-delivery.yml"
    || provider.protection.enrollment.controllerRevision !== historical.revision
    || historical.repository.toLowerCase() !== controller.originRepository.toLowerCase()
    || historical.currentControllerRevision !== controller.protectedMainSha) {
    throw new Error("Protected workflow enrollment does not join its historical controller proof.");
  }
  if (JSON.stringify(provider.changedPaths.pullRequest)
      !== JSON.stringify(provider.changedPaths.mergeCommit)
    || provider.changedPaths.pullRequest.some(path => !covered(path))
    || JSON.stringify(provider.mergePathObjects.map(item => item.path))
      !== JSON.stringify(provider.changedPaths.pullRequest)
    || JSON.stringify(provider.protectedMainPaths)
      !== JSON.stringify(provider.mergePathObjects)
    || provider.protectedMainPaths.some(item => item.type !== "file")) {
    throw new Error("Merged provider changed paths are incomplete or escape the claim write set.");
  }
  assertProtectionAndChecks(provider);
  if (local.branch !== "main" || local.clean !== true
    || local.originRepository.toLowerCase() !== provider.repository.toLowerCase()
    || local.headSha !== local.protectedMainSha
    || local.providerProtectedMainSha !== provider.protectedMain.sha
    || local.headIsAncestorOfProviderProtectedMain !== true
    || local.sourceBranchRefPresent !== false
    || local.registeredSourceWorktreeCount !== 0 || local.matchingLeaseCount !== 0) {
    throw new Error("Provider-only mode requires clean canonical local absence without a historical lease.");
  }
}

function assertProtectionAndChecks(provider) {
  const { enrollment, liveRequiredChecks } = provider.protection;
  const enrolled = [...new Set([...enrollment.classicRequiredChecks,
    ...enrollment.rulesetRequiredChecks])].sort();
  if (enrolled.length === 0 || JSON.stringify(enrolled) !== JSON.stringify(enrollment.requiredCiContexts)) {
    throw new Error("Protection enrollment required-check sets do not join.");
  }
  for (const context of enrollment.classicRequiredChecks) if (!liveRequiredChecks.some(check =>
    check.context === context && check.source === "classic")) throw new Error(
    `Classic required check ${context} is not live-enforced.`);
  for (const context of enrollment.rulesetRequiredChecks) {
    if (!liveRequiredChecks.some(check => (
      check.context === context && check.source === "ruleset" && check.strict === true
    ))) throw new Error(`Ruleset required check ${context} is not strict live-enforced.`);
  }
  const witnessedContexts = [...new Set(
    provider.protection.requiredCheckWitnesses.map(witness => witness.context),
  )];
  if (witnessedContexts.length === 0
    || provider.protection.requiredCheckWitnesses.length !== witnessedContexts.length * 2
    || witnessedContexts.some(context => !enrolled.includes(context))) {
    throw new Error("Required-check witnesses do not cover both reviewed revisions.");
  }
}

function projectRequiredCheckWitnesses(protection, runs, revisions) {
  const { enrollment, liveRequiredChecks } = protection;
  const requirements = [...enrollment.classicRequiredChecks.map(context => ({ context, source: "classic" })),
    ...enrollment.rulesetRequiredChecks.map(context => ({ context, source: "ruleset" }))];
  const historicallyWitnessed = requirements.filter(requirement => revisions.every(revision => (
    runs.some(item => item.name === requirement.context && item.headSha === revision
      && item.status === "COMPLETED" && item.conclusion === "SUCCESS")
  )));
  if (historicallyWitnessed.length === 0) {
    throw new Error("No live-enforced enrolled check has success on both reviewed revisions.");
  }
  const witnesses = [];
  for (const revision of revisions) for (const requirement of historicallyWitnessed) {
    const live = liveRequiredChecks.find(check => check.context === requirement.context
      && check.source === requirement.source && (check.source !== "ruleset" || check.strict === true));
    if (!live) throw new Error(`${requirement.source} required check ${requirement.context} is not live-enforced.`);
    const run = runs.find(item => item.name === live.context
      && (live.appId === null || item.appId === live.appId) && item.headSha === revision
      && item.status === "COMPLETED" && item.conclusion === "SUCCESS");
    if (!run) throw new Error(`Required check ${live.context} lacks success on ${revision}.`);
    witnesses.push(deepFreeze({ context: live.context, appId: live.appId,
      source: live.source, strict: live.strict, headSha: revision,
      status: "COMPLETED", conclusion: "SUCCESS" }));
  }
  return Object.freeze(witnesses.sort(compareChecks));
}

function normalizePathObjects(values, label) { const result = array(values, `${label} objects`).map((item, index) => {
  object(item, `${label} object ${index}`); return deepFreeze({ path: relativePath(item.path, `${label} ${index}`),
    type: text(item.type, `${label} type ${index}`), objectSha: sha(item.objectSha,
      `${label} object SHA ${index}`) }); }).sort((left, right) => left.path.localeCompare(right.path));
  unique(result.map(item => item.path), `${label} paths`);
  return result;
}

function deduplicate(values) { return values.filter((value, index) => index === 0
  || JSON.stringify(value) !== JSON.stringify(values[index - 1])); }

function strings(values, label) { const result = array(values, label).map(value => text(value, label)).sort(); unique(result, label); return result; }
function paths(values, label) { const result = array(values, label).map(value => relativePath(value, label)).sort(); if (result.length === 0) throw new Error(`${label} must not be empty.`); unique(result, label); return result; }
function unique(values, label) { if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`); }
function compareChecks(left, right) { return ["context", "name", "source", "headSha", "appId", "status",
  "conclusion", "strict"].map(key => String(left[key] ?? "").localeCompare(String(right[key] ?? "")))
  .find(result => result !== 0) || 0; }
function array(value, label) { if (!Array.isArray(value)) throw new Error(`${label} must be an array.`); return value; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function text(value, label) { if (typeof value !== "string" || !value.normalize("NFC").trim()) throw new Error(`${label} is required.`); return value.normalize("NFC").trim(); }
function sha(value, label) { const result = text(value, label); if (!SHA.test(result)) throw new Error(`${label} must be a lowercase SHA.`); return result; }
function digest(value, label) { const result = text(value, label); if (!DIGEST.test(result)) throw new Error(`${label} must be a SHA-256 digest.`); return result; }
function optionalDigest(value) { return value == null ? null : digest(value, "optional digest"); }
function optionalText(value) { return value == null ? null : text(value, "optional text"); }
function positive(value, label) { if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${label} must be positive.`); return Number(value); }
function nonnegative(value, label) { if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error(`${label} must be nonnegative.`); return Number(value); }
function boundedTtl(value) { const result = positive(value, "recovery TTL seconds"); if (result < 60 || result > 86_400) throw new Error("Recovery TTL must be between 60 and 86400 seconds."); return result; }
function instant(value, label) { const result = text(value, label); if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an instant.`); return result; }
function repository(value, label) { const result = text(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} must be owner/name.`); return result; }
function relativePath(value, label) { const result = text(value, label); if (result.startsWith("/") || result.split("/").includes("..")) throw new Error(`${label} must be repository-relative.`); return result; }
function absolutePath(value, label) { const result = text(value, label); if (!result.startsWith("/")) throw new Error(`${label} must be absolute.`); return result; }
function jsonValue(value, label) { try { return deepFreeze(JSON.parse(JSON.stringify(value))); }
  catch { throw new Error(`${label} must be JSON-compatible.`); } }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }
