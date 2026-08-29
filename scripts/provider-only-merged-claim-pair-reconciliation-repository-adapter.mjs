// Responsibility: collect provider-only evidence and route waiter-first ledger effects through repository CAS.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCurrentClaims } from "./cloud-collaboration-contract.mjs";
import { digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF } from "./github-cloud-collaboration-adapter.mjs";
import { createGitHubReader, readCompleteGitHubCheckRuns, readCompleteGitHubCommitPaths, readGitHubMergeCommitSha } from "./merged-dormant-claim-reconciliation-repository-adapter.mjs";
import { assertProviderOnlyMergedClaimPairTargetRepositoryTail, buildProviderOnlyMergedClaimPairReconciliationPlan } from "./provider-only-merged-claim-pair-reconciliation-contract.mjs";
import { buildProviderOnlyMergedClaimPairReconciliationEvidence, PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RUNTIME_PATHS } from "./provider-only-merged-claim-pair-reconciliation-evidence.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
const METHODS = Object.freeze(["withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent", "observePhase",
  "retireWaiter", "recoverSource", "integrateSource", "retireSource", "verifyTerminal"]);
const SHA = /^[0-9a-f]{40}$/u, DIGEST = /^[0-9a-f]{64}$/u;
export function createProviderOnlyMergedClaimPairReconciliationAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
  for (const name of METHODS) if (typeof adapter[name] !== "function") throw new Error(
    `Provider-only merged-claim-pair repository adapter requires ${name}().`);
  return adapter;
}

export function createRepositoryProviderOnlyMergedClaimPairReconciliationAdapter({
  sourceRepository, targetRepository, pullRequestNumber, sourceClaimId, waiterClaimId,
  ledgerRepository = "huijoohwee/agentic-canvas-os",
  controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  githubJson = null, gitText = null, controllerGitText = null, cloudActions = null,
  intentStore = null, statePath = null, environment = process.env, now = () => new Date(), ttlSeconds = 1_800,
} = {}) {
  const sourceRoot = realpathSync(path.resolve(required(sourceRepository, "source repository")));
  const controller = realpathSync(path.resolve(required(controllerRoot, "controller root")));
  const target = repository(targetRepository, "target repository");
  const ledgerRepo = repository(ledgerRepository, "ledger repository");
  const pullNumber = positive(pullRequestNumber, "pull request number");
  const sourceId = digest(sourceClaimId, "source claim ID");
  const waiterId = digest(waiterClaimId, "waiter claim ID");
  const ttl = boundedTtl(ttlSeconds);
  if (sourceId === waiterId) throw new Error("Source and waiter claim IDs must differ.");
  const git = gitText || (args => runText("git", args, sourceRoot));
  const controllerGit = controllerGitText || (args => runText("git", args, controller));
  const github = githubJson || createGitHubReader({ sourceRoot, execute: (command, args, options) => (
    execFileSync(command, args, { ...options, timeout: 30_000 })) });
  const common = path.resolve(sourceRoot, git(["rev-parse", "--git-common-dir"]).trim());
  const store = intentStore || createProviderOnlyMergedClaimPairReconciliationIntentStore({
    statePath: statePath || path.join(common, "agentic-canvas-os",
      "provider-only-merged-claim-pair-reconciliation", `${sourceId}.${waiterId}.json`),
    now,
  });
  const effects = cloudActions || createProviderOnlyMergedClaimPairReconciliationCloudActions({ environment,
    invokeCloudAction: invokeRepositoryCloudAction, ledgerRepository: ledgerRepo, targetRepository: target,
    ttlSeconds: ttl });
  requireCloudActions(effects);
  async function readSnapshot() {
    const ledgerState = await readLedger({ github, ledgerRepository: ledgerRepo, now });
    const sourceEntry = latestEntry(ledgerState.ledger, sourceId);
    const waiterEntry = latestEntry(ledgerState.ledger, waiterId);
    if (!sourceEntry || !waiterEntry) throw new Error("Ledger lacks the exact source/waiter pair.");
    const repositoryId = sourceEntry.claimCore.repositoryId;
    const currentClaims = ledgerState.currentClaims.filter(claim => claim.repositoryId === repositoryId)
      .map(projectCurrentClaim);
    return deepFreeze({ ...ledgerState,
      source: projectLatestClaim(sourceEntry, ledgerState.currentClaims, now()),
      waiter: projectLatestClaim(waiterEntry, ledgerState.currentClaims, now()),
      sourceLineage: lineage(ledgerState.ledger, sourceId),
      waiterLineage: lineage(ledgerState.ledger, waiterId), currentClaims });
  }
  async function readSourceEvidence() {
    const snapshot = await readSnapshot();
    if (!snapshot.currentClaims.some(claim => claim.claimId === sourceId)
      || !snapshot.currentClaims.some(claim => claim.claimId === waiterId)) {
      throw new Error("Planning requires both nonterminal pair claims in current inventory.");
    }
    const provider = await readProvider({ controllerRepository: ledgerRepo, github,
      pullRequestNumber: pullNumber, source: snapshot.source, targetRepository: target });
    const local = readLocalAbsence({ git, sourceRoot, source: snapshot.source, waiter: snapshot.waiter,
      headBranch: provider.pullRequest.headBranch, commonDirectory: common, targetRepository: target });
    return buildProviderOnlyMergedClaimPairReconciliationEvidence({
      controller: await readControllerEvidence({ controller, git: controllerGit, github,
        ledgerRepository: ledgerRepo }),
      cloud: {
        ledgerRepository: ledgerRepo, ledgerRevision: snapshot.ledgerRevision,
        ledgerDigest: snapshot.ledgerDigest, sequence: snapshot.sequence,
        ledgerValidationDigest: snapshot.ledgerValidationDigest,
        source: snapshot.source, waiter: snapshot.waiter,
        sourceLineage: snapshot.sourceLineage, waiterLineage: snapshot.waiterLineage,
        currentClaims: snapshot.currentClaims,
      },
      provider,
      local,
      recoveryTtlSeconds: ttl,
    });
  }
  async function observePhase(context) {
    if (context.phase === "verified") return observeVerified(context);
    const snapshot = await readSnapshot();
    assertProviderOnlyMergedClaimPairTargetRepositoryTail(context.plan, snapshot.ledger);
    const entry = phaseEntry(context, snapshot);
    return entry ? completeClassification(context, entry) : pendingClassification(context);
  }
  async function observeVerified(context) {
    const first = await readSnapshot();
    const second = await readSnapshot();
    assertProviderOnlyMergedClaimPairTargetRepositoryTail(context.plan, first.ledger);
    assertProviderOnlyMergedClaimPairTargetRepositoryTail(context.plan, second.ledger);
    const firstSource = phaseEntry({ ...context, phase: "source-retired" }, first);
    const firstWaiter = phaseEntry({ ...context, phase: "waiter-retired" }, first);
    const secondSource = phaseEntry({ ...context, phase: "source-retired" }, second);
    const secondWaiter = phaseEntry({ ...context, phase: "waiter-retired" }, second);
    const firstDigest = terminalSnapshotDigest(first, firstSource, firstWaiter),
      secondDigest = terminalSnapshotDigest(second, secondSource, secondWaiter);
    if (!firstSource || !firstWaiter || !secondSource || !secondWaiter || firstDigest !== secondDigest) {
      return pendingClassification(context);
    }
    return deepFreeze({
      phase: context.phase, operationKey: context.operationKey, state: "complete",
      evidenceDigest: digestValue({ schema: "agentic-provider-only-pair-double-read/v1",
        operationKey: context.operationKey, snapshotDigest: firstDigest }),
      sourceIntegrationReceiptDigest: integrationReceiptDigest(first, context.plan),
    });
  }
  return createProviderOnlyMergedClaimPairReconciliationAdapter({
    withEntrypointFence: (subject, action) => store.withEntrypointFence(subject, action),
    readIntent: () => store.readIntent(), writeIntent: input => store.writeIntent(input),
    readSourceEvidence, observePhase,
    retireWaiter: context => effects.retireWaiter({ ...context, snapshot: readSnapshot }),
    recoverSource: context => effects.recoverSource({ ...context, snapshot: readSnapshot }),
    integrateSource: context => effects.integrateSource({ ...context, snapshot: readSnapshot }),
    retireSource: context => effects.retireSource({ ...context, snapshot: readSnapshot }),
    verifyTerminal: async context => ({ operationKey: context.operationKey }),
  });
}

export function createProviderOnlyMergedClaimPairReconciliationCloudActions({
  environment = process.env, invokeCloudAction = invokeRepositoryCloudAction,
  ledgerRepository, targetRepository, ttlSeconds = 1_800,
} = {}) {
  const ledger = repository(ledgerRepository, "ledger repository");
  const target = repository(targetRepository, "target repository");
  const ttl = boundedTtl(ttlSeconds);
  async function effect(kind, context) {
    const live = await context.snapshot();
    const plan = context.plan;
    if (plan.recoveryTtlSeconds !== ttl) throw new Error("Recovery TTL differs from the exact authorized plan.");
    assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, live.ledger);
    const isWaiter = kind === "retire-waiter";
    const claim = isWaiter ? live.waiter : live.source;
    const common = {
      targetRepository: target, claimId: claim.claimId,
      deviceId: plan.effectDeviceId, sessionId: plan.effectSessionId,
      expectedFenceRevision: claim.claimDigest,
      expectedTransitionCounter: claim.transitionCounter,
      expectedLedgerDigest: live.ledgerDigest,
      idempotencyKey: `provider-only-merged-claim-pair-reconciliation:${context.operationKey}`,
    };
    let action;
    let request;
    if (kind === "retire-waiter") {
      action = "retire";
      request = { ...common, reason: plan.waiterRetirementReason,
        finalRevision: claim.laneRevision, reviewRequestId: claim.reviewRequestId,
        bytesDigest: plan.bytesDigest, namedChecksDigest: plan.namedChecksDigest,
        handoffEvidenceDigest: plan.handoffEvidenceDigest };
    } else if (kind === "recover-source") {
      action = "continue";
      request = { ...common, mode: "recovery", laneRevision: claim.laneRevision,
        reviewRequestId: claim.reviewRequestId, ttlSeconds: plan.recoveryTtlSeconds,
        recoveryEvidenceDigest: context.operationKey };
    } else if (kind === "integrate-source") {
      action = "integrate";
      request = { ...common, candidateRevision: claim.laneRevision,
        reviewRequestId: claim.reviewRequestId, focusedEvidenceDigest: claim.evidenceDigest,
        dependencyClosureDigest: plan.dependencyClosureDigest,
        namedChecksDigest: plan.namedChecksDigest, handoffEvidenceDigest: plan.handoffEvidenceDigest,
        operatorDecisionDigest: context.intent.authorizationDigest,
        integrationIntentDigest: context.operationKey };
    } else {
      action = "retire";
      request = { ...common, reason: plan.sourceRetirementReason,
        finalRevision: claim.laneRevision, reviewRequestId: claim.reviewRequestId,
        bytesDigest: plan.bytesDigest, namedChecksDigest: plan.namedChecksDigest,
        handoffEvidenceDigest: plan.handoffEvidenceDigest,
        integrationReceiptDigest: integrationReceiptDigest(live, plan) };
    }
    await invokeCloudAction({ action, ledgerRepository: ledger, request,
      environment: effectEnvironment(environment, plan) });
    return Object.freeze({ operationKey: context.operationKey });
  }
  return Object.freeze({
    retireWaiter: context => effect("retire-waiter", context),
    recoverSource: context => effect("recover-source", context),
    integrateSource: context => effect("integrate-source", context),
    retireSource: context => effect("retire-source", context),
  });
}
export function createProviderOnlyMergedClaimPairReconciliationIntentStore({ statePath, now = () => new Date() } = {}) {
  const file = path.resolve(required(statePath, "intent state path"));
  const lock = `${file}.lock`, entrypoint = `${file}.entrypoint.lock`;
  function readIntent() {
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value.schema !== "agentic-provider-only-merged-claim-pair-journal/v1"
      || value.intentDigest !== digestValue(value.intent)) throw new Error("Provider-only journal is invalid.");
    return value.intent;
  }
  function writeIntent({ expectedIntent = null, nextIntent } = {}) {
    return withLock(lock, () => {
      if (nullableDigest(readIntent()) !== nullableDigest(expectedIntent)) throw new Error(
        "Provider-only reconciliation intent changed before CAS.");
      if (!nextIntent || typeof nextIntent !== "object" || Array.isArray(nextIntent)) throw new Error(
        "Provider-only reconciliation next intent is required.");
      const journal = { schema: "agentic-provider-only-merged-claim-pair-journal/v1",
        intent: nextIntent, intentDigest: digestValue(nextIntent), updatedAt: now().toISOString() };
      writeJson(file, journal); return nextIntent;
    });
  }
  async function withEntrypointFence(subject, action) {
    const release = acquireLock(entrypoint, subject);
    try { return await action(Object.freeze({ fenceDigest: digestValue({ file, subject }) })); }
    finally { release(); }
  }
  return Object.freeze({ readIntent, writeIntent, withEntrypointFence, statePath: file });
}
async function readLedger({ github, ledgerRepository, now }) {
  const ref = await github(`repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`);
  const ledgerRevision = sha(ref.object?.sha, "ledger ref revision");
  const metadata = await github(`repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${ledgerRevision}`);
  const encoded = metadata.content || (await github(
    `repos/${ledgerRepository}/git/blobs/${sha(metadata.sha, "ledger blob")}`
  )).content;
  if (!encoded) throw new Error("Cloud ledger content is unavailable.");
  const ledger = JSON.parse(Buffer.from(String(encoded).replaceAll("\n", ""), "base64").toString("utf8"));
  const failures = validateLedger(ledger);
  if (failures.length > 0) throw new Error(`Cloud ledger is invalid: ${failures.join("; ")}`);
  const evaluatedAt = now().toISOString();
  return deepFreeze({
    ledger, ledgerRevision, ledgerDigest: digest(ledger.headDigest, "ledger head digest"),
    sequence: positive(ledger.sequence, "ledger sequence"),
    ledgerValidationDigest: digestValue({ sequence: ledger.sequence, ledgerDigest: ledger.headDigest, failures: [] }),
    currentClaims: listCurrentClaims(ledger, evaluatedAt),
  });
}
async function readProvider({ controllerRepository, github, pullRequestNumber, source, targetRepository }) {
  const [actor, repositoryValue, pull] = await Promise.all([
    github("user"), github(`repos/${targetRepository}`),
    github(`repos/${targetRepository}/pulls/${pullRequestNumber}`),
  ]);
  const mergeSha = await readGitHubMergeCommitSha(github, targetRepository,
    pullRequestNumber, pull.merge_commit_sha);
  const [head, merge, mainRef, mainBranch, applicableRules] = await Promise.all([
    readCommit(github, targetRepository, source.laneRevision),
    readCommit(github, targetRepository, mergeSha),
    github(`repos/${targetRepository}/git/ref/heads/main`),
    github(`repos/${targetRepository}/branches/main`),
    github(`repos/${targetRepository}/rules/branches/main?per_page=100`),
  ]);
  if (!Array.isArray(applicableRules) || applicableRules.length >= 100) throw new Error(
    "Applicable branch rules are malformed or pagination-ambiguous.");
  const main = await readCommit(github, targetRepository, mainRef.object.sha);
  const [compare, pullPaths, mergePaths, workflow, headRuns, mergeRuns, remoteRef] = await Promise.all([
    github(`repos/${targetRepository}/compare/${merge.sha}...${main.sha}`),
    readCompletePullRequestPaths(github, targetRepository, pullRequestNumber),
    readCompleteGitHubCommitPaths(github, targetRepository, merge.sha),
    github(`repos/${targetRepository}/contents/.github/workflows/auto-delivery.yml?ref=${main.sha}`),
    readCompleteGitHubCheckRuns(github, targetRepository, head.sha),
    readCompleteGitHubCheckRuns(github, targetRepository, merge.sha),
    optionalGithub(github, `repos/${targetRepository}/git/ref/heads/${encodeURIComponent(pull.head.ref)}`),
  ]);
  requireCompleteCompare(compare, "merge-to-main comparison");
  const protectedMainPaths = await Promise.all(pullPaths.map(async changedPath => {
    const value = await github(`repos/${targetRepository}/contents/${encodePath(changedPath)}?ref=${main.sha}`);
    if (Array.isArray(value)) throw new Error(`Protected-main path ${changedPath} is not a file object.`);
    return { path: changedPath, type: required(value.type, `protected-main type ${changedPath}`), objectSha: sha(
      value.sha, `protected-main object ${changedPath}`) };
  }));
  const workflowText = decodeContent(workflow, "auto-delivery workflow");
  const liveRequiredChecks = projectLiveChecks(mainBranch, applicableRules);
  const enrollment = readProviderOnlyMergedClaimPairEnrollment(workflowText, {
    controllerRepository, liveRequiredChecks, protectedMainSha: main.sha, targetRepository,
  });
  return deepFreeze({
    provider: "github", repository: targetRepository,
    repositoryId: `github-repository:${required(repositoryValue.node_id, "repository node ID")}`,
    actorId: `github-user:${positive(actor.id, "actor ID")}`, actorLogin: required(actor.login, "actor login"),
    pullRequest: { number: pullRequestNumber, nodeId: required(pull.node_id, "pull node ID"), url: required(
      pull.html_url, "pull URL"), state: required(pull.state, "pull state"),
      draft: pull.draft, merged: pull.merged, mergedAt: required(pull.merged_at, "merged time"),
      headRepository: repository(pull.head?.repo?.full_name, "head repository"),
      headBranch: required(pull.head?.ref, "head branch"), headSha: sha(pull.head?.sha, "pull head"),
      baseRepository: repository(pull.base?.repo?.full_name, "base repository"),
      baseBranch: required(pull.base?.ref, "base branch"), baseSha: merge.parents[0],
      mergeCommitSha: merge.sha },
    headCommit: head, mergeCommit: merge, protectedMain: main, protectedMainPaths,
    mergeCommitIsAncestorOfProtectedMain: ["ahead", "identical"].includes(compare.status),
    changedPaths: { pullRequest: pullPaths, mergeCommit: mergePaths },
    protection: { enrollment, liveRequiredChecks, applicableRulesDigest: digestValue(applicableRules) },
    checkRuns: [...headRuns, ...mergeRuns].map(projectCheckRun),
    remoteHeadRefPresent: Boolean(remoteRef), writerMarkerPresent: String(pull.body || "").includes("agentic-writer-lease/"),
  });
}
async function readControllerEvidence({ controller, git, github, ledgerRepository }) {
  const headSha = sha(git(["rev-parse", "HEAD"]), "controller head");
  const originRepository = exactOriginRepository(git, ledgerRepository, "controller"),
    reference = await github(`repos/${ledgerRepository}/git/ref/heads/main`),
    protectedMainSha = sha(reference.object?.sha, "live controller protected main");
  const runtimeFiles = PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RUNTIME_PATHS.map(runtimePath => ({
    path: runtimePath,
    blobSha: sha(git(["rev-parse", `HEAD:${runtimePath}`]), `runtime blob ${runtimePath}`),
    contentDigest: sha256(readFileSync(path.join(controller, runtimePath))),
  }));
  return deepFreeze({ repositoryRoot: controller, originRepository, branch: git(["branch", "--show-current"]).trim(),
    headSha, protectedMainSha, clean: git(["status", "--porcelain"]).trim() === "",
    runtimeFiles, runtimeDigest: digestValue(runtimeFiles) });
}
export function readProviderOnlyMergedClaimPairLocalAbsence({
  git, sourceRoot, source, waiter, headBranch, commonDirectory, targetRepository,
}) {
  const worktrees = git(["worktree", "list", "--porcelain"]).split("\n\n");
  const registeredSourceWorktreeCount = worktrees.filter(block => (
    block.includes(`branch refs/heads/${headBranch}`) || block.includes(`HEAD ${source.laneRevision}`)
  )).length;
  return deepFreeze({
    repositoryRoot: sourceRoot, originRepository: exactOriginRepository(git, targetRepository, "local target"),
    branch: git(["branch", "--show-current"]).trim(),
    headSha: sha(git(["rev-parse", "HEAD"]), "local head"),
    protectedMainSha: sha(git(["rev-parse", "origin/main"]), "local protected main"),
    clean: git(["status", "--porcelain"]).trim() === "",
    sourceBranchRefPresent: gitProbe(git, ["show-ref", "--verify", `refs/heads/${headBranch}`]),
    sourceRemoteTrackingRefPresent: gitProbe(git, ["show-ref", "--verify", `refs/remotes/origin/${headBranch}`]),
    sourceObjectPresent: gitProbe(git, ["cat-file", "-e", `${source.laneRevision}^{commit}`]),
    registeredSourceWorktreeCount,
    matchingLeaseCount: matchingLeaseCount(commonDirectory, source, waiter, headBranch),
  });
}
const readLocalAbsence = readProviderOnlyMergedClaimPairLocalAbsence;
export function providerOnlyMergedClaimPairPhaseEntry(context, snapshot) {
  const { phase, plan } = context;
  if (phase === "prepared") {
    const source = snapshot.sourceLineage.find(entry => entry.digest === plan.sourceTransitionDigest);
    const waiter = snapshot.waiterLineage.find(entry => entry.digest === plan.waiterTransitionDigest);
    return source && waiter ? { digest: digestValue({ source, waiter, sourceEvidenceDigest: plan.sourceEvidenceDigest }) } : null;
  }
  const sourceCounter = plan.sourceTransitionCounter, waiterCounter = plan.waiterTransitionCounter;
  if (phase === "waiter-retired") return findBoundEntry(snapshot.waiterLineage,
    waiterCounter + 1, "retire", plan.waiterClaimId, context.operationKey, entry => retirementMatches(entry, plan, "waiter"));
  if (phase === "source-recovered") return findBoundEntry(snapshot.sourceLineage,
    sourceCounter + 1, "continue", plan.sourceClaimId, context.operationKey, entry => recoveryMatches(entry, plan, context.operationKey));
  if (phase === "source-integrated") return findBoundEntry(snapshot.sourceLineage,
    sourceCounter + 2, "integrate", plan.sourceClaimId, context.operationKey, entry => integrationMatches(entry, plan, context));
  if (phase === "source-retired") return findBoundEntry(snapshot.sourceLineage,
    sourceCounter + 3, "retire", plan.sourceClaimId, context.operationKey, entry => retirementMatches(
      entry, plan, "source", integrationReceiptDigest(snapshot, plan)));
  return null;
}
const phaseEntry = providerOnlyMergedClaimPairPhaseEntry;
function findBoundEntry(entries, counter, action, claimId, operationKey, predicate) {
  return entries.find(entry => entry.action === action && entry.claimId === claimId
    && entry.claimCore?.transitionCounter === counter
    && entry.idempotencyKey === digestValue(`provider-only-merged-claim-pair-reconciliation:${operationKey}`)
    && predicate(entry)) || null;
}
function retirementMatches(entry, plan, kind, integrationReceiptDigest = null) {
  const claim = kind === "source" ? { reason: plan.sourceRetirementReason,
    finalRevision: plan.sourceLaneRevision, reviewRequestId: plan.sourceReviewRequestId, integrationReceiptDigest }
    : { reason: plan.waiterRetirementReason,
    finalRevision: plan.sourceLaneRevision, reviewRequestId: null, integrationReceiptDigest: null };
  const expected = { ...claim, bytesDigest: plan.bytesDigest, namedChecksDigest: plan.namedChecksDigest,
    handoffEvidenceDigest: plan.handoffEvidenceDigest };
  const actual = entry.claimCore?.retirement; if (!actual) return false;
  const { retiredAt, ...semantic } = actual;
  return retiredAt === entry.evaluationTime && digestValue(semantic) === digestValue(expected);
}
function recoveryMatches(entry, plan, operationKey) {
  const core = entry.claimCore, recoveredAt = core?.recovery?.recoveredAt;
  return core?.state === "reviewed" && core.laneRevision === plan.sourceLaneRevision && core.reviewRequestId
    === plan.sourceReviewRequestId && core.deviceId === plan.effectDeviceId
    && core.sessionId === plan.effectSessionId && core.recovery?.evidenceDigest === operationKey
    && recoveredAt === entry.evaluationTime
    && Date.parse(core.expiresAt) - Date.parse(entry.evaluationTime) === plan.recoveryTtlSeconds * 1_000;
}
function integrationMatches(entry, plan, context) {
  const value = entry.claimCore?.integration;
  const expected = { candidateRevision: plan.sourceLaneRevision, reviewRequestId: plan.sourceReviewRequestId,
    focusedEvidenceDigest: plan.sourceFocusedEvidenceDigest, dependencyClosureDigest: plan.dependencyClosureDigest,
    namedChecksDigest: plan.namedChecksDigest, handoffEvidenceDigest: plan.handoffEvidenceDigest,
    operatorDecisionDigest: context.intent.authorizationDigest, integrationIntentDigest: context.operationKey };
  if (!value) return false; const { integratedAt, ...actual } = value;
  return integratedAt === entry.evaluationTime && entry.claimCore?.state === "integrated-preserved" && digestValue(
    actual) === digestValue(expected);
}
function completeClassification(context, entry) {
  const sourceIntegrationReceiptDigest = ["source-integrated", "source-retired"].includes(context.phase)
    ? integrationReceiptFromEntries(entry) : null;
  return deepFreeze({ phase: context.phase, operationKey: context.operationKey, state: "complete",
    evidenceDigest: digestValue({ schema: "agentic-provider-only-pair-phase-evidence/v1",
      phase: context.phase, operationKey: context.operationKey,
      entryDigest: entry.digest, controllerRuntimeDigest: context.plan.controllerRuntimeDigest }),
    sourceIntegrationReceiptDigest });
}
function pendingClassification(context) { return Object.freeze({ phase: context.phase,
  operationKey: context.operationKey, state: "pending", evidenceDigest: null, sourceIntegrationReceiptDigest: null }); }
function integrationReceiptFromEntries(entry) {
  if (entry.action === "integrate") return operationReceipt(entry, "integrated-preserved");
  return entry.claimCore?.retirement?.integrationReceiptDigest || null;
}
function integrationReceiptDigest(snapshot, plan) {
  const entry = snapshot.sourceLineage.find(item => item.action === "integrate"
    && item.claimCore?.transitionCounter === plan.sourceTransitionCounter + 2);
  if (!entry) throw new Error("Source integration transition is unavailable.");
  return operationReceipt(entry, "integrated-preserved");
}
function operationReceipt(entry, status) {
  const receiptNames = { claim: "claim", continue: "continuation", integrate: "integration", retire: "retirement" };
  const core = { schema: `agentic-collaboration-${receiptNames[entry.action]}-receipt/v1`,
    operation: entry.action, status, repositoryId: entry.repositoryId, claimId: entry.claimId,
    claimDigest: entry.claimDigest, fenceRevision: entry.claimDigest, ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence, idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest, evaluationTime: entry.evaluationTime };
  return digestValue(core);
}
function terminalSnapshotDigest(snapshot, source, waiter) {
  if (!source || !waiter) return null;
  void snapshot;
  return digestValue({ sourceDigest: source.digest, sourceReceipt: operationReceipt(source, "retired"),
    waiterDigest: waiter.digest, waiterReceipt: operationReceipt(waiter, "retired") });
}
function projectCurrentClaim(claim) {
  return deepFreeze({ claimId: claim.claimId, claimDigest: claim.fenceRevision,
    transitionDigest: claim.ledgerRevision, operationReceiptDigest: claim.operationReceiptDigest,
    state: claim.state, recordedState: claim.recordedState, writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved,
    actorId: claim.actorId, deviceId: claim.deviceId,
    sessionId: claim.sessionId, repositoryId: claim.repositoryId, workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
    declaredWriteScope: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch, transitionCounter: claim.transitionCounter, heartbeatCounter: claim.heartbeatCounter,
    reviewRequestId: claim.reviewRequestId,
    predecessorClaimId: claim.predecessorClaimId, evidenceDigest: claim.evidenceDigest,
    integrationReceiptDigest: claim.integrationReceiptDigest, integration: claim.integration ?? null,
    retirement: claim.retirement ?? null });
}
function projectLatestClaim(entry, currentClaims, evaluatedAt) {
  const live = currentClaims.find(claim => claim.claimId === entry.claimId);
  if (live) return projectCurrentClaim(live);
  const core = entry.claimCore;
  const state = projectState(core.state);
  return deepFreeze({ claimId: entry.claimId, claimDigest: entry.claimDigest,
    transitionDigest: entry.digest, operationReceiptDigest: operationReceipt(entry, state), state, recordedState: state,
    writeAuthority: false, scopeReserved: false,
    actorId: core.actorId, deviceId: core.deviceId, sessionId: core.sessionId,
    repositoryId: core.repositoryId, workItemId: core.workItemId, canonicalBaseRevision: core.canonicalBaseRevision,
    laneRevision: core.laneRevision,
    declaredWriteScope: core.declaredWriteScope, writeSetDigest: core.writeSetDigest,
    leaseEpoch: core.leaseEpoch, transitionCounter: core.transitionCounter, heartbeatCounter: core.heartbeatCounter,
    reviewRequestId: core.reviewRequestId,
    predecessorClaimId: core.predecessorClaimId, evidenceDigest: core.evidenceDigest,
    integrationReceiptDigest: core.retirement?.integrationReceiptDigest ?? null,
    integration: core.integration ?? null, retirement: core.retirement ?? null,
    evaluatedAt: evaluatedAt.toISOString() });
}
function lineage(ledger, claimId) { return ledger.entries.filter(entry => entry.claimId === claimId); }
function latestEntry(ledger, claimId) { return ledger.entries.findLast(entry => entry.claimId === claimId); }
function projectState(state) { if (state === "active") return "current";
  if (["review-ready", "delivery-authorized"].includes(state)) return "reviewed";
  if (["parked", "expired"].includes(state)) return "dormant-preserved";
  return state === "released" ? "retired" : state; }
function projectLiveChecks(branch, rules) {
  const classic = branch?.protection?.required_status_checks, values = [];
  for (const check of classic?.checks || []) values.push({ context: check.context,
    appId: check.app_id ?? null, source: "classic", strict: classic.strict === true });
  for (const context of classic?.contexts || []) if (!values.some(item => item.context === context
    && item.source === "classic")) values.push({ context, appId: null, source: "classic",
      strict: classic.strict === true });
  for (const rule of rules) if (rule?.type === "required_status_checks") for (
    const check of rule.parameters?.required_status_checks || []) values.push({
      context: check.context, appId: check.integration_id ?? null, source: "ruleset",
      strict: rule.parameters?.strict_required_status_checks_policy === true });
  return values;
}
export function readProviderOnlyMergedClaimPairEnrollment(content, {
  controllerRepository, liveRequiredChecks = [], protectedMainSha, targetRepository,
} = {}) {
  const controller = repository(controllerRepository, "controller repository"),
    target = repository(targetRepository, "enrolled target repository"),
    escaped = controller.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const checkout = content.match(new RegExp(
    `repository:\\s*${escaped}[\\s\\S]{0,240}?\\n\\s*ref:\\s*([0-9a-f]{40})`, "u"));
  const reusable = content.match(new RegExp(`uses:\\s*${escaped}/[^\\s@]+@([0-9a-f]{40})`, "u")),
    self = target === controller, controllerRevision = self ? sha(protectedMainSha,
      "self-enrolled controller revision") : sha(checkout?.[1] || reusable?.[1], "enrolled controller revision");
  const liveContexts = source => [...new Set(liveRequiredChecks.filter(check => check.source === source)
    .map(check => required(check.context, `${source} live check`)))].sort();
  const classicRequiredChecks = self ? liveContexts("classic") : yamlJsonArray(content,
    "PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON"), rulesetRequiredChecks = self
      ? liveContexts("ruleset") : yamlJsonArray(content, "PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON");
  return { workflowPath: ".github/workflows/auto-delivery.yml", contentDigest: sha256(content),
    controllerRevision, classicRequiredChecks, rulesetRequiredChecks,
    requiredCiContexts: self ? [...new Set([...classicRequiredChecks, ...rulesetRequiredChecks])].sort()
      : yamlJsonArray(content, "PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON") };
}
function yamlJsonArray(content, name) {
  const match = content.match(new RegExp(`^\\s*${name}:\\s*'([^']+)'\\s*$`, "mu"));
  if (!match) throw new Error(`Auto-delivery enrollment lacks ${name}.`);
  const value = JSON.parse(match[1]);
  if (!Array.isArray(value)) throw new Error(`${name} must encode an array.`);
  return value;
}
function projectCheckRun(run) { return { name: required(run.name, "check-run name"),
  appId: run.app?.id ?? null, headSha: sha(run.head_sha, "check-run head"),
  status: required(run.status, "check-run status"), conclusion: required(run.conclusion, "check-run conclusion") }; }
async function readCommit(github, repo, revision) { const value = await github(`repos/${repo}/git/commits/${revision}`);
  return { sha: sha(value.sha, "commit SHA"), treeSha: sha(value.tree?.sha, "commit tree"),
    parents: (value.parents || []).map(parent => sha(parent.sha, "commit parent")) }; }
async function readCompletePullRequestPaths(github, repo, pullNumber) {
  const paths = [];
  for (let page = 1; page <= 30; page += 1) {
    const files = await github(`repos/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`);
    if (!Array.isArray(files)) throw new Error("Pull-request file page is malformed.");
    for (const file of files) { const status = required(file.status, "pull-request file status");
      if (file.previous_filename != null || ["renamed", "copied"].includes(status)) throw new Error(
        "Pull-request rename/copy history is outside the exact changed-path proof.");
      paths.push(required(file.filename, "pull-request changed path")); }
    if (files.length < 100) return [...new Set(paths)].sort();
  }
  throw new Error("Pull-request files exceed the complete pagination bound.");
}
function requireCompleteCompare(value, label) {
  if (!Array.isArray(value.commits) || value.total_commits !== value.commits.length) throw new Error(`${label} is truncated.`);
}
async function optionalGithub(github, endpoint) {
  try { return await github(endpoint); }
  catch (error) { if (/404|Not Found/iu.test(String(error?.message || error))) return null; throw error; }
}
function decodeContent(value, label) { if (!value?.content) throw new Error(`${label} content is unavailable.`);
  return Buffer.from(String(value.content).replaceAll("\n", ""), "base64").toString("utf8"); }
function exactOriginRepository(git, expected, label) {
  const origin = git(["config", "--get", "remote.origin.url"]).trim().replace(/\.git\/?$/u, ""),
    match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+)$/u.exec(origin),
    observed = match ? repository(match[1], `${label} origin repository`) : null;
  if (!observed || observed.toLowerCase() !== expected.toLowerCase()) throw new Error(
    `${label} origin does not identify ${expected}.`);
  return expected;
}
function gitProbe(git, args) { try { git(args); return true; }
  catch (error) { if (error?.status === 1) return false;
    throw new Error(`Git absence probe failed for ${args[0]}.`, { cause: error }); } }
function matchingLeaseCount(common, source, waiter, branch) {
  let count = 0;
  for (const name of ["writer-leases.json", "writer-lease.json"]) {
    const file = path.join(common, "agentic-canvas-os", name);
    if (!existsSync(file)) continue;
    const value = JSON.parse(readFileSync(file, "utf8"));
    const plural = name === "writer-leases.json";
    if ((plural && (value?.schema !== "agentic-writer-lease-registry/v2" || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || !value.leases || typeof value.leases !== "object" || Array.isArray(value.leases)))
      || (!plural && value?.schema !== "agentic-writer-lease/v1")) {
      throw new Error(`Writer-lease metadata ${name} is malformed.`);
    }
    const leases = plural ? Object.values(value.leases) : [value];
    count += leases.filter(lease => lease?.branch === branch || lease?.fenceSha === source.laneRevision
      || [source.claimId, waiter.claimId].includes(lease?.cloudAuthority?.claimId)).length;
  }
  return count;
}
function effectEnvironment(environment, plan) { const result = { ...environment };
  for (const key of Object.keys(result)) if (key.startsWith("AGENTIC_CLOUD_")
    || ["AGENTIC_DEVICE_ID", "AGENTIC_SESSION_ID", "AGENTIC_TARGET_REPOSITORY"].includes(key)) delete result[key];
  return { ...result, AGENTIC_DEVICE_ID: plan.effectDeviceId, AGENTIC_SESSION_ID: plan.effectSessionId }; }
function requireCloudActions(value) { for (const name of ["retireWaiter", "recoverSource", "integrateSource", "retireSource"])
  if (typeof value?.[name] !== "function") throw new Error(`Provider-only cloud actions require ${name}().`); }
function nullableDigest(value) { return value == null ? null : digestValue(value); }
function withLock(lock, action) { const release = acquireLock(lock, { operation: "intent-cas" }); try {
  return action(); } finally { release(); } }
function acquireLock(lock, subject) { mkdirSync(path.dirname(lock), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  try { return createOwnedLock(lock, subject, token); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  throw new Error("Provider-only reconciliation is already fenced."); }
function createOwnedLock(lock, subject, token) { const descriptor = openSync(lock, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token, subject })}\n`);
  return () => { closeSync(descriptor); if (readLock(lock)?.token === token) unlinkSync(lock); }; }
function readLock(lock) { try { const value = JSON.parse(readFileSync(lock, "utf8")); return Number.isSafeInteger(
  value.pid) && typeof value.token === "string" ? value : null; }
  catch { return null; } }
function writeJson(file, value) { mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, file); }
function runText(command, args, cwd) { return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer:
  64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function encodePath(value) { return value.split("/").map(encodeURIComponent).join("/"); }
function required(value, label) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function sha(value, label) { const result = required(value, label); if (!SHA.test(result)) throw new Error(`${label} must be a SHA.`); return result; }
function digest(value, label) { const result = required(value, label); if (!DIGEST.test(result)) throw new Error(`${label} must be a digest.`); return result; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be positive.`); return result; }
function boundedTtl(value) { const result = positive(value, "TTL seconds"); if (result < 60 || result > 86_400)
  throw new Error("TTL seconds must be between 60 and 86400."); return result; }
function repository(value, label) { const result = required(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} must be owner/name.`); return result; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }
