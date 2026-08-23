// Responsibility: inspect immutable source/provider objects and route receipt-bound cloud reconciliation through CAS adapters.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyCloudTransition } from "./cloud-collaboration-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF } from "./github-cloud-collaboration-adapter.mjs";
import { buildMergedDormantClaimReconciliationPlan } from "./merged-dormant-claim-reconciliation-contract.mjs";
import * as Evidence from "./merged-dormant-claim-reconciliation-evidence.mjs";
import { readCompletedAbsentLocalEvidence, readMergedDormantClaimReconciliationLocalEvidence } from "./merged-dormant-claim-reconciliation-local-source.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
const ADAPTER_METHODS = Object.freeze(["withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent", "readClaim", "recoverDormant", "integrateReviewed", "retireIntegrated"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
export { readCompletedAbsentLocalEvidence } from "./merged-dormant-claim-reconciliation-local-source.mjs";
export function createMergedDormantClaimReconciliationAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(ADAPTER_METHODS.map(name => [name, methods[name]])));
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Merged dormant claim repository adapter requires ${name}().`);
    }
  }
  return adapter;
}
export function createRepositoryMergedDormantClaimReconciliationAdapter({
  sourceRepository, targetRepository, pullRequestNumber, claimId,
  ledgerRepository = "huijoohwee/agentic-canvas-os", cloudActions = null,
  githubJson = null, gitText = null, leaseStore = null, intentStore = null,
  statePath = null, resolveRealpath = realpathSync, environment = process.env,
  now = () => new Date(),
  ttlSeconds = 1_800,
} = {}) {
  const sourceRoot = resolveRealpath(path.resolve(requiredText(sourceRepository, "source repository")));
  const target = requiredRepository(targetRepository, "target repository");
  const ledger = requiredRepository(ledgerRepository, "ledger repository");
  const pullNumber = positiveInteger(pullRequestNumber, "pull request number");
  const sourceClaimId = requiredDigest(claimId, "claim ID");
  const git = gitText || (args => execFileSync("git", args, subprocess(sourceRoot)));
  const github = githubJson || createGitHubReader({ sourceRoot });
  const liveActions = cloudActions || createRepositoryMergedDormantClaimCloudActions({
    environment, invokeCloudAction: invokeRepositoryCloudAction,
    ledgerRepository: ledger, targetRepository: target, ttlSeconds, });
  requireCloudActions(liveActions);
  const commonDirectory = path.resolve(sourceRoot, git(["rev-parse", "--git-common-dir"]).trim());
  const store = intentStore || createMergedDormantClaimReconciliationIntentStore({
    statePath: statePath || path.join(commonDirectory, "agentic-canvas-os",
      "merged-dormant-claim-reconciliation", `${sourceClaimId}.json`),
    now,
  });
  const leases = leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, now });
  async function readStatus() {
    const result = await readLedgerClaim({
      claimId: sourceClaimId, github, ledgerRepository: ledger, now,
    });
    const claim = result.claim;
    if (!claim || claim.claimId !== sourceClaimId) {
      throw new Error("Cloud status did not return the exact reconciliation claim.");
    }
    return Object.freeze({ claim, claims: result.claims, result });
  }
  return createMergedDormantClaimReconciliationAdapter({
    withEntrypointFence: (subject, action) => store.withEntrypointFence(subject, action),
    readIntent: () => store.readIntent(),
    writeIntent: input => store.writeIntent(input),
    async readSourceEvidence() { return readFreshSourceEvidence(await readStatus()); },
    async readClaim(context) {
      const live = await readStatus();
      await assertSourcePlanStillCurrent({ context, live });
      return liveActions.observePhase({ ...context, live, sourceClaimId });
    },
    async recoverDormant(context) {
      return requireOperationResult(await liveActions.recoverDormant({
        ...context,
        live: await readStatus(),
        sourceClaimId,
      }), context);
    },
    async integrateReviewed(context) {
      return requireOperationResult(await liveActions.integrateReviewed({
        ...context,
        live: await readStatus(),
        sourceClaimId,
      }), context);
    },
    async retireIntegrated(context) {
      return requireOperationResult(await liveActions.retireIntegrated({
        ...context,
        live: await readStatus(),
        sourceClaimId,
      }), context);
    },
  });
  async function readFreshSourceEvidence(live) {
    const local = readMergedDormantClaimReconciliationLocalEvidence({
      claim: live.claim, claims: live.claims, git, leaseStore: leases, sourceRoot,
    });
    const provider = await readProviderEvidence({
      claim: live.claim, github, local, pullRequestNumber: pullNumber, targetRepository: target,
    });
    return evidenceFunction("buildMergedDormantClaimReconciliationSourceEvidence")({
      claim: projectClaimEvidence(live), local, provider,
    });
  }
  async function assertSourcePlanStillCurrent({ context, live }) {
    if (!context?.intent || !["authorized", "prepared"].includes(context.intent.status)) return;
    if (live.claim.state !== "dormant-preserved") return;
    const current = buildMergedDormantClaimReconciliationPlan(await readFreshSourceEvidence(live));
    if (current.planDigest !== context.plan?.planDigest) {
      throw new Error("Merged dormant reconciliation source evidence drifted before recovery.");
    }
  }
}
export function createMergedDormantClaimReconciliationIntentStore({ statePath, now = () => new Date() } = {}) {
  const filePath = path.resolve(requiredText(statePath, "intent state path"));
  const lockPath = `${filePath}.lock`;
  const entrypointLockPath = `${filePath}.entrypoint.lock`;
  function readIntent() {
    if (!existsSync(filePath)) return null;
    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    if (stored?.schema !== "agentic-merged-dormant-claim-reconciliation-journal/v1"
      || stored.intentDigest !== digestValue(stored.intent)) {
      throw new Error("Merged dormant claim reconciliation journal is malformed or digest-invalid.");
    }
    return stored.intent;
  }
  function writeIntent({ expectedIntent = null, nextIntent } = {}) {
    return withLock(lockPath, { operation: "intent-cas" }, () => {
      const current = readIntent();
      if (intentDigest(current) !== intentDigest(expectedIntent)) {
        throw new Error("Merged dormant claim reconciliation intent changed before CAS.");
      }
      if (!nextIntent || typeof nextIntent !== "object" || Array.isArray(nextIntent)) {
        throw new Error("Merged dormant claim reconciliation next intent is required.");
      }
      const journal = {
        schema: "agentic-merged-dormant-claim-reconciliation-journal/v1",
        intent: nextIntent,
        intentDigest: digestValue(nextIntent),
        updatedAt: now().toISOString(),
      };
      writeJsonAtomic(filePath, journal);
      return nextIntent;
    });
  }
  async function withEntrypointFence(subject, action) {
    if (typeof action !== "function") throw new Error("Reconciliation entrypoint fence requires an action.");
    const release = acquireLock(entrypointLockPath, { operation: "entrypoint", subject });
    try {
      return await action(Object.freeze({
        acquiredAt: now().toISOString(),
        fenceDigest: digestValue({ filePath, subject }),
      }));
    } finally {
      release();
    }
  }
  return Object.freeze({ readIntent, statePath: filePath, withEntrypointFence, writeIntent });
}
export function createRepositoryMergedDormantClaimCloudActions({
  environment = process.env,
  invokeCloudAction = invokeRepositoryCloudAction,
  ledgerRepository,
  targetRepository,
  ttlSeconds = 1_800,
} = {}) {
  const ledger = requiredRepository(ledgerRepository, "ledger repository");
  const target = requiredRepository(targetRepository, "target repository");
  const ttl = positiveInteger(ttlSeconds, "TTL seconds");
  const effect = action => context => invokeEffect({ action, context, environment,
    invokeCloudAction, ledgerRepository: ledger, targetRepository: target, ttlSeconds: ttl });
  return Object.freeze({
    observePhase: ({ intent, live, operationKey, phase, plan }) => evidenceFunction(
      "buildMergedDormantClaimReconciliationPhaseObservation",
    )({ intent, live, operationKey, phase, plan }),
    recoverDormant: effect("continue"),
    integrateReviewed: effect("integrate"),
    retireIntegrated: effect("retire"),
  });
}
async function readProviderEvidence({ claim, github, local, pullRequestNumber, targetRepository }) {
  const pull = await github(`repos/${targetRepository}/pulls/${pullRequestNumber}`);
  const mergeCommitSha = await readGitHubMergeCommitSha(github, targetRepository, pullRequestNumber, pull.merge_commit_sha);
  const repository = await github(`repos/${targetRepository}`);
  const claimCommit = await readCommit(github, targetRepository, claim.laneRevision);
  const pullCommit = await readCommit(github, targetRepository, pull.head.sha);
  const mergeCommit = await readCommit(github, targetRepository, mergeCommitSha);
  const mainRef = await github(`repos/${targetRepository}/git/ref/heads/main`);
  const mainCommit = await readCommit(github, targetRepository, mainRef.object.sha);
  const refreshChain = await readRefreshChain({ claimCommit, declaredWriteScope: claim.declaredWriteScope,
    github, protectedMainSha: mainRef.object.sha, pullCommit, targetRepository });
  const mergeAncestry = requireCompleteCompare(await github(
    `repos/${targetRepository}/compare/${mergeCommitSha}...${mainRef.object.sha}`,
  ), "merge-to-main compare");
  const completion = local.mode === "completed-absent"
    ? await readProviderCompletion({ github, mergeCommitSha, protectedMainSha: mainCommit.sha,
      targetRepository, completionMainSha: local.lease.completion.mainSha })
    : null;
  const required = await github(
    `repos/${targetRepository}/branches/main/protection/required_status_checks`,
  );
  const checkedShas = mergedDormantReconciliationCheckedRevisions(claim.laneRevision, refreshChain, mergeCommitSha);
  const checkRuns = uniqueSuccessfulCheckRuns((await Promise.all([...new Set(checkedShas)]
    .map(sha => readCompleteGitHubCheckRuns(github, targetRepository, sha)))).flat().map(projectCheckRun));
  const pullPaths = await readCompleteGitHubChangedPaths(
    github, `repos/${targetRepository}/pulls/${pullRequestNumber}/files`);
  const mergePaths = await readCompleteGitHubCommitPaths(github, targetRepository, mergeCommitSha);
  if (JSON.stringify(pullPaths) !== JSON.stringify(mergePaths)) {
    throw new Error("Pull-request and merge changed paths do not match.");
  }
  const remoteRef = await readOptionalGitHub(github,
    `repos/${pull.head.repo.full_name}/git/ref/heads/${encodeURIComponent(pull.head.ref)}`,
  );
  local.remote.branchPresent = Boolean(remoteRef);
  return Object.freeze({
    provider: "github",
    repository: targetRepository,
    repositoryId: `github-repository:${requiredText(repository.node_id, "repository node ID")}`,
    pullRequest: Object.freeze({
      number: pullRequestNumber, nodeId: requiredText(pull.node_id, "pull request node ID"),
      url: requiredText(pull.html_url, "pull request URL"), draft: Boolean(pull.draft),
      state: requiredText(pull.state, "pull request state").toUpperCase(), merged: pull.merged === true,
      headRepository: requiredRepository(pull.head?.repo?.full_name, "pull request head repository"),
      headBranch: requiredText(pull.head?.ref, "pull request head branch"), headSha: pullCommit.sha,
      headTreeSha: pullCommit.treeSha,
      baseRepository: requiredRepository(pull.base?.repo?.full_name, "pull request base repository"),
      baseBranch: requiredText(pull.base?.ref, "pull request base branch"),
      mergeCommitSha: mergeCommit.sha, mergeCommitTreeSha: mergeCommit.treeSha,
    }),
    claimHead: { sha: claimCommit.sha, treeSha: claimCommit.treeSha,
      scopeTreeDigest: await readScopeTreeDigest(github, targetRepository, claimCommit.treeSha, claim.declaredWriteScope) },
    protectedMain: { branch: "main", sha: mainCommit.sha, treeSha: mainCommit.treeSha },
    ancestry: {
      claimHeadIsAncestorOfPullRequestHead: true,
      mergeCommitIsAncestorOfProtectedMain: ancestorStatus(mergeAncestry.status),
    },
    refreshChain,
    mergeCommitParents: mergeCommit.parents,
    mergeChangedPaths: mergePaths,
    requiredChecks: projectRequiredChecks(required),
    checkRuns,
    ...(completion ? { completion } : {}),
  });
}
async function readProviderCompletion({ github, mergeCommitSha, protectedMainSha,
  targetRepository, completionMainSha }) {
  const completion = await readCommit(github, targetRepository, completionMainSha);
  const mergeContainment = requireCompleteCompare(await github(
    `repos/${targetRepository}/compare/${mergeCommitSha}...${completion.sha}`,
  ), "merge-to-completion-main compare");
  const currentContainment = requireCompleteCompare(await github(
    `repos/${targetRepository}/compare/${completion.sha}...${protectedMainSha}`,
  ), "completion-main-to-protected-main compare");
  if (!ancestorStatus(mergeContainment.status) || !ancestorStatus(currentContainment.status)) {
    throw new Error("Completed source provider proof does not contain merge through protected main.");
  }
  return Object.freeze({
    mainSha: completion.sha, treeSha: completion.treeSha,
    mergeCommitIsAncestor: true, mainIsAncestorOfProtectedMain: true,
  });
}
function projectClaimEvidence({ claim, result }) {
  return Object.freeze({
    claimId: claim.claimId, claimDigest: claim.fenceRevision, transitionDigest: claim.transitionDigest,
    operationReceiptDigest: claim.operationReceiptDigest,
    ledgerRevision: result.ledgerRevision, ledgerDigest: result.ledgerDigest, state: claim.state,
    recordedState: claim.recordedState || (claim.state === "dormant-preserved" ? "reviewed" : claim.state),
    writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved, actorId: claim.actorId,
    deviceId: claim.deviceId, sessionId: claim.sessionId,
    repositoryId: claim.repositoryId, workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision, declaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter, reviewRequestId: claim.reviewRequestId,
    evidenceDigest: claim.evidenceDigest, integration: claim.integration || null,
    integrationReceiptDigest: claim.integrationReceiptDigest || null,
  });
}
async function invokeEffect({ action, context, environment, invokeCloudAction, ledgerRepository,
  targetRepository, ttlSeconds }) {
  const { intent, live, operationKey, plan } = context;
  const claim = live.claim;
  const recoveryDeviceId = requiredText(plan.recoveryDeviceId, "plan recovery device ID");
  const recoverySessionId = requiredText(plan.recoverySessionId, "plan recovery session ID");
  const common = {
    targetRepository,
    claimId: claim.claimId,
    deviceId: recoveryDeviceId,
    sessionId: recoverySessionId,
    expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter,
    expectedLedgerDigest: live.result.ledgerDigest,
    idempotencyKey: `merged-dormant-claim-reconciliation:${operationKey}`,
  };
  let request;
  if (action === "continue") {
    request = {
      ...common,
      mode: "recovery",
      laneRevision: claim.laneRevision,
      reviewRequestId: claim.reviewRequestId,
      ttlSeconds,
      recoveryEvidenceDigest: operationKey,
    };
  } else if (action === "integrate") {
    request = {
      ...common,
      candidateRevision: claim.laneRevision,
      reviewRequestId: claim.reviewRequestId,
      focusedEvidenceDigest: claim.evidenceDigest,
      dependencyClosureDigest: requiredPlanDigest(plan, "dependencyClosureDigest"),
      namedChecksDigest: requiredPlanDigest(plan, "namedChecksDigest"),
      handoffEvidenceDigest: requiredPlanDigest(plan, "handoffEvidenceDigest"),
      operatorDecisionDigest: requiredDigest(intent?.authorizationDigest, "authorization digest"),
      integrationIntentDigest: operationKey,
    };
  } else {
    request = {
      ...common,
      reason: requiredText(plan.retirementReason, "plan retirement reason"),
      finalRevision: plan.finalRevision,
      reviewRequestId: claim.reviewRequestId,
      bytesDigest: requiredPlanDigest(plan, "bytesDigest"),
      namedChecksDigest: requiredPlanDigest(plan, "namedChecksDigest"),
      handoffEvidenceDigest: requiredPlanDigest(plan, "handoffEvidenceDigest"),
      integrationReceiptDigest: requiredDigest(
        claim.integrationReceiptDigest,
        "integration receipt digest",
      ),
    };
  }
  await invokeCloudAction({ action, environment: effectEnvironmentForPlan({
    environment, recoveryDeviceId, recoverySessionId,
  }), ledgerRepository, request });
  return { operationKey };
}
function effectEnvironmentForPlan({ environment, recoveryDeviceId, recoverySessionId }) {
  const sanitized = { ...environment };
  for (const name of Object.keys(sanitized)) {
    if (name.startsWith("AGENTIC_CLOUD_") || ["AGENTIC_DEVICE_ID", "AGENTIC_LEDGER_REPOSITORY",
      "AGENTIC_SESSION_ID", "AGENTIC_TARGET_REPOSITORY"].includes(name)) delete sanitized[name];
  }
  return { ...sanitized, AGENTIC_DEVICE_ID: recoveryDeviceId, AGENTIC_SESSION_ID: recoverySessionId };
}
export function createGitHubReader({ sourceRoot, execute = execFileSync }) {
  return async endpoint => JSON.parse(execute("gh", ["api",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", endpoint], subprocess(sourceRoot)));
}
async function readLedgerClaim({ claimId, github, ledgerRepository, now }) {
  const reference = await github(
    `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`,
  );
  const revision = requiredSha(reference.object?.sha, "ledger ref revision");
  const metadata = await github(
    `repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${revision}`,
  );
  const encoded = metadata.content || (await github(
    `repos/${ledgerRepository}/git/blobs/${requiredSha(metadata.sha, "ledger blob SHA")}`,
  )).content;
  if (!encoded) throw new Error("Cloud collaboration ledger content is unavailable.");
  const ledger = JSON.parse(Buffer.from(String(encoded).replaceAll("\n", ""), "base64").toString("utf8"));
  const transition = applyCloudTransition({
    action: "status", evaluationTime: now().toISOString(), ledger, request: {},
  });
  const claim = transition.claims.find(candidate => candidate.claimId === claimId);
  if (!claim) throw new Error("Cloud collaboration ledger has no exact reconciliation claim.");
  return Object.freeze({
    claim: Object.freeze({ ...claim, transitionDigest: claim.ledgerRevision }),
    claims: Object.freeze(transition.claims),
    ledgerDigest: ledger.headDigest,
    ledgerRevision: revision,
  });
}
async function readCommit(github, repository, sha) {
  const commit = await github(`repos/${repository}/git/commits/${requiredSha(sha, "commit SHA")}`);
  return Object.freeze({
    sha: requiredSha(commit.sha, "provider commit SHA"),
    treeSha: requiredSha(commit.tree?.sha, "provider tree SHA"),
    parents: Object.freeze((commit.parents || []).map(value => requiredSha(value.sha, "provider parent SHA"))),
  });
}
async function readRefreshChain({ claimCommit, declaredWriteScope, github, protectedMainSha, pullCommit, targetRepository }) {
  const reverse = [];
  let current = pullCommit;
  while (current.sha !== claimCommit.sha) {
    if (reverse.length >= 32 || current.parents.length !== 2) {
      throw new Error("Pull-request head is not a bounded protected-main refresh chain.");
    }
    const ancestry = requireCompleteCompare(await github(
      `repos/${targetRepository}/compare/${current.parents[1]}...${protectedMainSha}`,
    ), "refresh-main compare");
    if (!ancestorStatus(ancestry.status)) throw new Error("Refresh second parent is not on protected main.");
    reverse.push(Object.freeze({ sha: current.sha, treeSha: current.treeSha, parents: current.parents,
      scopeTreeDigest: await readScopeTreeDigest(github, targetRepository, current.treeSha, declaredWriteScope), secondParentIsAncestorOfProtectedMain: true }));
    current = current.parents[0] === claimCommit.sha
      ? claimCommit : await readCommit(github, targetRepository, current.parents[0]);
  }
  return Object.freeze(reverse.reverse());
}
export function mergedDormantReconciliationCheckedRevisions(claimRevision, refreshChain, mergeRevision) {
  if (!Array.isArray(refreshChain)) throw new Error("Refresh chain must be an array.");
  return [...new Set([requiredSha(claimRevision, "claim revision"), requiredSha(
    refreshChain.at(-1)?.sha ?? claimRevision, "reviewed revision"), requiredSha(mergeRevision, "merge revision")])];
}
async function readScopeTreeDigest(github, repository, treeSha, writeScope) {
  const value = await github(`repos/${repository}/git/trees/${treeSha}?recursive=1`);
  if (value.truncated === true || !Array.isArray(value.tree)) throw new Error("GitHub scope tree is truncated.");
  const scopes = writeScope.filter(item => item.startsWith("path:")).map(item => item.slice(5));
  const entries = value.tree.filter(item => scopes.some(scope => item.path === scope || item.path.startsWith(`${scope}/`)))
    .map(item => ({ mode: item.mode, path: item.path, sha: item.sha, type: item.type })).sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length === 0) throw new Error("GitHub scope tree contains no declared path entries.");
  return digestValue(entries);
}
export async function readCompleteGitHubCheckRuns(github, repository, sha) {
  const result = await github(`repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100&page=1`);
  const runs = result.check_runs || [];
  if (result.total_count !== runs.length) throw new Error(`Check runs for ${sha} are truncated.`);
  return runs;
}
export async function readGitHubMergeCommitSha(github, repository, pullNumber, suppliedSha) {
  if (suppliedSha) return requiredSha(suppliedSha, "merge commit SHA");
  const events = await github(`repos/${repository}/issues/${pullNumber}/events?per_page=100&page=1`);
  if (!Array.isArray(events) || events.length === 100) throw new Error("Pull-request merge events may be truncated.");
  const merged = events.filter(value => value.event === "merged");
  if (merged.length !== 1) throw new Error("Pull request does not have one exact merge event.");
  return requiredSha(merged[0].commit_id, "merge event commit SHA");
}
export async function readCompleteGitHubChangedPaths(github, endpoint) {
  const paths = [];
  for (let page = 1; page <= 30; page += 1) {
    const values = await github(`${endpoint}?per_page=100&page=${page}`);
    if (!Array.isArray(values)) throw new Error("GitHub changed-path page is malformed.");
    paths.push(...values.map(value => requiredText(value.filename, "changed path")));
    if (values.length < 100) return [...new Set(paths)].sort();
  }
  throw new Error("GitHub changed paths exceed the complete pagination bound.");
}
export async function readCompleteGitHubCommitPaths(github, repository, sha) {
  const paths = [];
  for (let page = 1; page <= 30; page += 1) {
    const value = await github(`repos/${repository}/commits/${sha}?per_page=100&page=${page}`);
    const files = value.files || [];
    paths.push(...files.map(file => requiredText(file.filename, "merge changed path")));
    if (files.length < 100) return [...new Set(paths)].sort();
  }
  throw new Error("Merge changed paths exceed GitHub's complete response bound.");
}
function requireCompleteCompare(value, label) {
  if (!Array.isArray(value.commits) || value.total_commits !== value.commits.length) {
    throw new Error(`${label} is truncated.`);
  }
  return value;
}
function projectCheckRun(value) {
  return Object.freeze({
    name: requiredText(value.name, "check-run name"),
    appId: value.app?.id == null ? null : positiveInteger(value.app.id, "check-run app ID"),
    headSha: requiredSha(value.head_sha, "check-run head SHA"),
    status: requiredText(value.status, "check-run status").toUpperCase(),
    conclusion: requiredText(value.conclusion, "check-run conclusion").toUpperCase(),
  });
}
function projectRequiredChecks(value) {
  const checks = (value.checks || []).map(check => ({
    appId: check.app_id == null ? null : positiveInteger(check.app_id, "required check app ID"),
    context: requiredText(check.context, "required check context"),
  }));
  const contexts = new Set(checks.map(check => check.context));
  for (const context of value.contexts || []) {
    if (!contexts.has(context)) checks.push({ appId: null, context: requiredText(context, "required check context") });
  }
  return checks;
}
function uniqueSuccessfulCheckRuns(values) {
  const unique = new Map();
  for (const run of values) {
    if (run.status !== "COMPLETED" || run.conclusion !== "SUCCESS") continue;
    const key = `${run.name}\0${run.appId}\0${run.headSha}`;
    if (!unique.has(key)) unique.set(key, run);
  }
  return [...unique.values()];
}
async function readOptionalGitHub(github, endpoint) {
  if (typeof github.optional === "function") return github.optional(endpoint);
  try {
    return await github(endpoint);
  } catch (error) {
    if (error?.status === 404 || /HTTP 404|Not Found/iu.test(String(error?.message))) return null;
    throw error;
  }
}
function requireCloudActions(value) {
  for (const name of ["observePhase", "recoverDormant", "integrateReviewed", "retireIntegrated"]) {
    if (typeof value?.[name] !== "function") throw new Error(`Cloud actions require ${name}().`);
  }
}
function requireOperationResult(value, context) {
  if (!value || value.operationKey !== context.operationKey) throw new Error(
    `Cloud effect ${context.phase} did not preserve its operation key.`);
  return value;
}
function requiredPlanDigest(plan, name) { return requiredDigest(plan?.[name] || plan?.evidence?.[name], `plan ${name}`); }
function evidenceFunction(name) {
  const value = Evidence[name];
  if (typeof value !== "function") throw new Error(`Reconciliation evidence requires ${name}().`);
  return value;
}
function ancestorStatus(value) { return ["ahead", "identical"].includes(value); }
function intentDigest(value) { return value === null ? null : digestValue(value); }
function withLock(lockPath, subject, action) {
  const release = acquireLock(lockPath, subject);
  try {
    return action();
  } finally {
    release();
  }
}
function acquireLock(lockPath, subject) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  let stalePath = null;
  try {
    return createOwnedLock(lockPath, subject, token);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const owner = readLockOwner(lockPath);
  if (!owner) throw new Error("Merged dormant claim reconciliation lock is malformed.");
  if (processIsAlive(owner.pid)) throw new Error("Merged dormant claim reconciliation is already fenced.");
  if (readLockOwner(lockPath)?.token !== owner.token) {
    throw new Error("Merged dormant claim reconciliation lock changed during recovery.");
  }
  stalePath = `${lockPath}.stale.${token}`;
  renameSync(lockPath, stalePath);
  if (readLockOwner(stalePath)?.token !== owner.token) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    throw new Error("Merged dormant claim reconciliation lock changed during recovery.");
  }
  const release = createOwnedLock(lockPath, subject, token);
  unlinkSync(stalePath);
  return release;
}
function createOwnedLock(lockPath, subject, token) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, subject, token })}\n`);
  return () => {
    closeSync(descriptor);
    if (readLockOwner(lockPath)?.token === token) unlinkSync(lockPath);
  };
}
function readLockOwner(lockPath) {
  if (!existsSync(lockPath)) return null;
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string" ? value : null;
  } catch { return null; }
}
function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, filePath);
}
function subprocess(cwd) {
  return { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] };
}
function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) throw new Error(`${label} must be owner/name.`);
  return repository;
}
function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a 40-character SHA.`);
  return sha;
}
function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}
function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) throw new Error(`${label} must be a positive integer.`);
  return integer;
}
