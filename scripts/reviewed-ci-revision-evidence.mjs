import { digestValue } from "./cloud-collaboration-primitives.mjs";
export const REVIEWED_CI_FAILURE_EVIDENCE_SCHEMA = "agentic-reviewed-ci-failure-evidence/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u, DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, GITHUB_URL_PATTERN = /^https:\/\/github\.com\//u;
const MAX_CHECK_RUNS = 1_000, MAX_PULL_REQUESTS = 1_000, PULL_PAGE_SIZE = 100;
export function readGitHubReviewedCiFailureSubject({ gh, pullRequestNumber, checkRunId, expectedState = "OPEN" } = {}) {
  const { repository, pullRequest } = readGitHubPullLifecycleSubject({ gh, pullRequestNumber });
  const name = requiredRepository(repository.full_name);
  const actor = parseJson(gh(["api", "user"]));
  const selectedId = positiveInteger(checkRunId, "check-run ID");
  const checkRun = parseJson(gh(["api", `repos/${name}/check-runs/${selectedId}`,
    "-H", "Accept: application/vnd.github+json"]));
  const requiredStatusChecks = {
    ...parseJson(gh(["api", `repos/${name}/branches/main/protection/required_status_checks`])),
    repository: name,
    branch: "main",
  };
  const match = String(checkRun.details_url || "").match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/u);
  if (!match || Number(match[2]) !== selectedId) throw new Error("Check URL does not bind the selected Actions job.");
  const workflowRun = parseJson(gh(["api", `repos/${name}/actions/runs/${match[1]}`]));
  const workflowJob = parseJson(gh(["api", `repos/${name}/actions/jobs/${selectedId}`]));
  const checkRunInventory = readCompleteInventory(gh, name, pullRequest.headSha);
  return { repository, pullRequest, evidenceInput: { repository, actor, pullRequest, checkRun,
    checkRunInventory, requiredStatusChecks, workflowRun, workflowJob, expectedState } };
}
export function readGitHubPullLifecycleSubject({ gh, pullRequestNumber } = {}) {
  requireGh(gh);
  const name = repositoryName(gh);
  const repository = parseJson(gh(["api", `repos/${name}`]));
  const number = positiveInteger(pullRequestNumber, "pull-request number");
  const rawPull = parseJson(gh(["api", `repos/${name}/pulls/${number}`]));
  return joinPullLifecycle({ gh, name, repository, rawPull, expectedNumber: number });
}
export function readGitHubOpenPullSubjects({ gh, branch } = {}) {
  requireGh(gh);
  const name = repositoryName(gh), repository = parseJson(gh(["api", `repos/${name}`]));
  const owner = name.split("/")[0], expectedBranch = requiredBranch(branch), rawPulls = [];
  for (let page = 1; page <= Math.ceil(MAX_PULL_REQUESTS / PULL_PAGE_SIZE); page += 1) {
    const response = parseJson(gh(["api", "--method", "GET", `repos/${name}/pulls`,
      "-f", "state=open", "-f", `head=${owner}:${expectedBranch}`,
      "-f", `per_page=${PULL_PAGE_SIZE}`, "-f", `page=${page}`]));
    if (!Array.isArray(response) || response.length > PULL_PAGE_SIZE) {
      throw new Error("Open pull-request inventory page is malformed.");
    }
    rawPulls.push(...response);
    if (rawPulls.length > MAX_PULL_REQUESTS) throw new Error("Open pull-request inventory exceeds its bound.");
    if (response.length < PULL_PAGE_SIZE) break;
    if (page === Math.ceil(MAX_PULL_REQUESTS / PULL_PAGE_SIZE)) {
      throw new Error("Open pull-request inventory may be incomplete.");
    }
  }
  const numbers = rawPulls.map(raw => positiveInteger(requiredOwn(raw, "number", "REST PR number"), "pull-request number"));
  if (new Set(numbers).size !== numbers.length) throw new Error("Open pull-request inventory contains duplicate identities.");
  return rawPulls.map((rawPull, index) => {
    const subject = joinPullLifecycle({ gh, name, repository, rawPull, expectedNumber: numbers[index] });
    if (subject.pullRequest.state !== "OPEN" || subject.pullRequest.branch !== expectedBranch
      || subject.pullRequest.baseRef !== "main") {
      throw new Error("Open pull-request inventory escaped its exact head/base filter.");
    }
    return subject.pullRequest;
  });
}
export function assertGitHubPullQueueFence(pull) {
  if (pull?.restAutoMergeRequest !== null || pull?.autoMergeRequest !== null
    || pull?.isInMergeQueue !== false || pull?.mergeQueueEntry !== null) {
    throw new Error("Pull request has auto-merge or merge-queue authority.");
  }
  return pull;
}
export function gitHubPullImmutableDigest(pull) {
  const { state: _state, closedAt: _closedAt, ...immutable } = pull;
  return digestValue(immutable);
}
export function assertGitHubPullRequestBounds({ title, body }) {
  if (Array.from(title).length > 256 || Buffer.byteLength(title, "utf8") > 1_024
    || Buffer.byteLength(body, "utf8") > 65_536) {
    throw new Error("Generated replacement pull-request title or body exceeds its provider bound.");
  }
}
export function closeGitHubPullWithReconciliation({ readPull, readFreshEvidence,
  closePull, validateOpen, validateClosed } = {}) {
  let pull = readPull();
  const closed = pull.state === "CLOSED";
  const before = gitHubPullImmutableDigest(closed ? validateClosed(pull) : validateOpen(pull));
  const fresh = readFreshEvidence(pull);
  if (gitHubPullImmutableDigest(fresh) !== before) throw new Error("Source PR drifted before exact closure.");
  if (closed) return { pull, disposition: "adopted-existing" };
  let responseLost = false;
  try { closePull(); } catch { responseLost = true; }
  pull = validateClosed(readPull());
  if (gitHubPullImmutableDigest(pull) !== before) throw new Error("Source PR mutated beyond exact closure.");
  return { pull, disposition: responseLost ? "reconciled-response-loss" : "closed" };
}
export function createGitHubPullWithReconciliation({ listPulls, createPull, validatePull } = {}) {
  let pulls = listPulls();
  if (pulls.length > 1) throw new Error("Replacement PR response reconciliation is ambiguous.");
  if (pulls.length === 1) return { pull: validatePull(pulls[0]), disposition: "adopted-existing" };
  let response = null, responseLost = false;
  try { response = createPull(); } catch { responseLost = true; }
  pulls = listPulls();
  if (pulls.length !== 1) throw new Error("Replacement PR response reconciliation is ambiguous.");
  const pull = validatePull(pulls[0]);
  if (response && response !== pull.url) throw new Error("Replacement PR response did not bind the unique exact draft.");
  return { pull, disposition: responseLost ? "reconciled-response-loss" : "created" };
}
export function buildReviewedCiFailureEvidence({ repository, actor, pullRequest, checkRun,
  checkRunInventory, requiredStatusChecks, workflowRun, workflowJob,
  expectedDraft = false, expectedState = "OPEN" } = {}) {
  const repositoryIdentity = normalizeRepository(repository);
  const authenticatedActor = normalizeActor(actor);
  const pull = normalizePullRequest(pullRequest, expectedDraft, expectedState, repositoryIdentity);
  const check = normalizeCheckRun(checkRun);
  const protection = normalizeProtection(requiredStatusChecks, check, repositoryIdentity);
  const run = normalizeWorkflowRun(workflowRun, { check, pull, repository: repositoryIdentity });
  const job = normalizeWorkflowJob(workflowJob, { check, run });
  const inventory = requireLatestCheckRun({ selected: check, inventory: checkRunInventory });
  if (check.headSha !== pull.headSha) {
    throw new Error("Failed check run does not belong to the exact reviewed head.");
  }
  const subject = check.pullRequests.filter(candidate => (
    candidate.number === pull.number
    && candidate.headSha === pull.headSha
    && candidate.headRef === pull.branch
    && candidate.baseSha === pull.baseSha
    && candidate.baseRef === "main"
  ));
  if (subject.length !== 1) {
    throw new Error("Failed check run does not bind the exact ownership pull request.");
  }
  const core = {
    schema: REVIEWED_CI_FAILURE_EVIDENCE_SCHEMA,
    provider: "github",
    repository: repositoryIdentity.fullName,
    repositoryId: repositoryIdentity.id,
    repositoryNodeId: repositoryIdentity.nodeId,
    actorId: authenticatedActor.id,
    actorLogin: authenticatedActor.login,
    pullRequestNumber: pull.number,
    pullRequestNodeId: pull.nodeId,
    pullRequestAuthorLogin: pull.authorLogin,
    autoMergeDisabled: true,
    mergeQueueDisabled: true,
    pullRepositoryDigest: digestValue({ head: pull.headRepository, base: pull.baseRepository }),
    branch: pull.branch,
    baseSha: pull.baseSha,
    headSha: pull.headSha,
    checkRunId: check.id,
    checkSuiteId: check.checkSuiteId,
    checkName: check.name,
    appId: check.appId,
    appSlug: check.appSlug,
    workflowId: run.workflowId,
    workflowPath: run.path,
    workflowRunId: run.id,
    workflowRunAttempt: run.attempt,
    workflowEvent: run.event,
    workflowJobId: job.id,
    checkRunInventoryCount: inventory.count,
    checkRunInventoryLatestId: inventory.latestId,
    checkRunInventoryDigest: inventory.digest,
    requiredContext: protection.context,
    requiredContextAppId: protection.appId,
    branchProtectionStrict: protection.strict,
    branchProtectionRepository: protection.repository,
    branchProtectionBranch: protection.branch,
    branchProtectionDigest: protection.digest,
    externalIdDigest: digestValue({ externalId: check.externalId }),
    detailsUrl: check.detailsUrl,
    status: check.status,
    conclusion: check.conclusion,
    startedAt: check.startedAt,
    completedAt: check.completedAt,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}
export function normalizeReviewedCiFailureEvidence(value) {
  if (!value || value.schema !== REVIEWED_CI_FAILURE_EVIDENCE_SCHEMA) {
    throw new Error("Reviewed CI failure evidence is malformed.");
  }
  const core = {
    schema: REVIEWED_CI_FAILURE_EVIDENCE_SCHEMA,
    provider: value.provider === "github" ? value.provider : invalid("provider"),
    repository: requiredRepository(value.repository),
    repositoryId: positiveInteger(value.repositoryId, "repository ID"),
    repositoryNodeId: requiredText(value.repositoryNodeId, "repository node ID"),
    actorId: positiveInteger(value.actorId, "actor ID"),
    actorLogin: requiredText(value.actorLogin, "actor login"),
    pullRequestNumber: positiveInteger(value.pullRequestNumber, "pull-request number"),
    pullRequestNodeId: requiredText(value.pullRequestNodeId, "pull-request node ID"),
    pullRequestAuthorLogin: requiredText(value.pullRequestAuthorLogin, "pull-request author"),
    autoMergeDisabled: value.autoMergeDisabled === true ? true : invalid("auto-merge state"),
    mergeQueueDisabled: value.mergeQueueDisabled === true ? true : invalid("merge-queue state"),
    pullRepositoryDigest: requiredDigest(value.pullRepositoryDigest, "pull repository digest"),
    branch: requiredBranch(value.branch),
    baseSha: requiredSha(value.baseSha, "base SHA"),
    headSha: requiredSha(value.headSha, "head SHA"),
    checkRunId: positiveInteger(value.checkRunId, "check-run ID"),
    checkSuiteId: positiveInteger(value.checkSuiteId, "check-suite ID"),
    checkName: requiredText(value.checkName, "check name"),
    appId: positiveInteger(value.appId, "check app ID"),
    appSlug: value.appSlug === "github-actions" ? value.appSlug : invalid("check app"),
    workflowId: positiveInteger(value.workflowId, "workflow ID"),
    workflowPath: requiredWorkflowPath(value.workflowPath),
    workflowRunId: positiveInteger(value.workflowRunId, "workflow run ID"),
    workflowRunAttempt: positiveInteger(value.workflowRunAttempt, "workflow run attempt"),
    workflowEvent: value.workflowEvent === "pull_request" ? value.workflowEvent : invalid("workflow event"),
    workflowJobId: positiveInteger(value.workflowJobId, "workflow job ID"),
    checkRunInventoryCount: positiveInteger(value.checkRunInventoryCount, "check-run inventory count"),
    checkRunInventoryLatestId: positiveInteger(value.checkRunInventoryLatestId, "latest check-run ID"),
    checkRunInventoryDigest: requiredDigest(value.checkRunInventoryDigest, "check-run inventory digest"),
    requiredContext: requiredText(value.requiredContext, "required context"),
    requiredContextAppId: positiveInteger(value.requiredContextAppId, "required context app ID"),
    branchProtectionStrict: value.branchProtectionStrict === true ? true : invalid("branch protection"),
    branchProtectionRepository: requiredRepository(value.branchProtectionRepository),
    branchProtectionBranch: value.branchProtectionBranch === "main"
      ? value.branchProtectionBranch : invalid("protected branch"),
    branchProtectionDigest: requiredDigest(value.branchProtectionDigest, "branch protection digest"),
    externalIdDigest: requiredDigest(value.externalIdDigest, "external ID digest"),
    detailsUrl: requiredGitHubUrl(value.detailsUrl, "details URL"),
    status: value.status === "completed" ? value.status : invalid("check status"),
    conclusion: value.conclusion === "failure" ? value.conclusion : invalid("check conclusion"),
    startedAt: requiredInstant(value.startedAt, "check start"),
    completedAt: requiredInstant(value.completedAt, "check completion"),
  };
  if (Date.parse(core.completedAt) < Date.parse(core.startedAt)
    || core.checkRunInventoryLatestId !== core.checkRunId
    || core.branchProtectionRepository !== core.repository
    || core.branchProtectionBranch !== "main"
    || value.evidenceDigest !== digestValue(core)) {
    throw new Error("Reviewed CI failure evidence digest or timing is invalid.");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}
function joinPullLifecycle({ gh, name, repository, rawPull, expectedNumber }) {
  const [owner, repositoryNameValue] = name.split("/");
  const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){id databaseId nameWithOwner pullRequest(number:$number){id number url state isDraft title body headRefName headRefOid baseRefName baseRefOid author{login} headRepository{id databaseId nameWithOwner} baseRepository{id databaseId nameWithOwner} labels(first:100){nodes{name} pageInfo{hasNextPage}} reviewDecision reviews(first:1){totalCount} autoMergeRequest{enabledAt mergeMethod enabledBy{login}} isInMergeQueue mergeQueueEntry{id state position enqueuedAt headCommit{oid}} closedAt mergedAt}}}";
  const graphResponse = parseJson(gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`,
    "-F", `name=${repositoryNameValue}`, "-F", `number=${expectedNumber}`]));
  if (Object.hasOwn(graphResponse, "errors")) throw new Error("GraphQL pull-request snapshot contains errors.");
  const graphRepository = requiredOwn(requiredOwn(graphResponse, "data", "GraphQL data"),
    "repository", "GraphQL repository");
  const graph = requiredOwn(graphRepository, "pullRequest", "GraphQL pull request");
  const repositoryIdentity = normalizeRepository(repository);
  if (digestValue(repositoryIdentity) !== digestValue(normalizeRepository(graphRepository))) {
    throw new Error("GraphQL repository identity drifted from REST.");
  }
  const rest = normalizeProviderPull(rawPull, false), graphql = normalizeProviderPull(graph, true);
  if (digestValue(rest) !== digestValue(graphql)) {
    throw new Error("GraphQL pull-request fence drifted from REST.");
  }
  const canonicalUrl = `https://github.com/${name}/pull/${expectedNumber}`;
  if (repositoryIdentity.fullName !== name || rest.number !== expectedNumber || rest.url !== canonicalUrl
    || [rest.headRepository, rest.baseRepository].some(candidate => (
      digestValue(candidate) !== digestValue(repositoryIdentity)))) {
    throw new Error("Pull-request URL, repository, or numeric identity is not canonical.");
  }
  return { repository, pullRequest: {
    ...rest,
    restAutoMergeRequest: requiredOwn(rawPull, "auto_merge", "REST auto-merge"),
    autoMergeRequest: requiredOwn(graph, "autoMergeRequest", "GraphQL auto-merge"),
    isInMergeQueue: requiredOwn(graph, "isInMergeQueue", "GraphQL merge-queue state"),
    mergeQueueEntry: requiredOwn(graph, "mergeQueueEntry", "GraphQL merge-queue entry"),
    reviewDecision: requiredOwn(graph, "reviewDecision", "GraphQL review decision"),
    reviewsTotalCount: nonnegativeInteger(requiredOwn(requiredOwn(graph, "reviews", "GraphQL reviews"),
      "totalCount", "GraphQL review count"), "review count"),
  } };
}
function normalizeProviderPull(value, graphql) {
  const label = graphql ? "GraphQL PR" : "REST PR";
  const head = graphql ? null : requiredOwn(value, "head", `${label} head`);
  const base = graphql ? null : requiredOwn(value, "base", `${label} base`);
  const author = requiredOwn(value, graphql ? "author" : "user", `${label} author`);
  return {
    number: positiveInteger(requiredOwn(value, "number", `${label} number`), "pull-request number"),
    nodeId: requiredText(requiredOwn(value, graphql ? "id" : "node_id", `${label} node`), "pull-request node ID"),
    url: requiredGitHubUrl(requiredOwn(value, graphql ? "url" : "html_url", `${label} URL`), "pull-request URL"),
    state: requiredText(requiredOwn(value, "state", `${label} state`), "pull-request state").toUpperCase(),
    isDraft: requiredOwn(value, graphql ? "isDraft" : "draft", `${label} draft`),
    title: requiredText(requiredOwn(value, "title", `${label} title`), "pull-request title"),
    body: String(requiredOwn(value, "body", `${label} body`) ?? ""),
    branch: requiredBranch(requiredOwn(graphql ? value : head, graphql ? "headRefName" : "ref", `${label} head ref`)),
    headSha: requiredSha(requiredOwn(graphql ? value : head, graphql ? "headRefOid" : "sha", `${label} head SHA`), "pull-request head SHA"),
    baseRef: requiredText(requiredOwn(graphql ? value : base, graphql ? "baseRefName" : "ref", `${label} base ref`), "pull-request base ref"),
    baseSha: requiredSha(requiredOwn(graphql ? value : base, graphql ? "baseRefOid" : "sha", `${label} base SHA`), "pull-request base SHA"),
    authorLogin: requiredText(requiredOwn(author, "login", `${label} author login`), "pull-request author"),
    labels: normalizeLabels(requiredOwn(value, "labels", `${label} labels`), graphql),
    headRepository: normalizeRepository(requiredOwn(graphql ? value : head, graphql ? "headRepository" : "repo", `${label} head repository`)),
    baseRepository: normalizeRepository(requiredOwn(graphql ? value : base, graphql ? "baseRepository" : "repo", `${label} base repository`)),
    closedAt: optionalInstant(requiredOwn(value, graphql ? "closedAt" : "closed_at", `${label} closedAt`), "pull-request close"),
    mergedAt: optionalInstant(requiredOwn(value, graphql ? "mergedAt" : "merged_at", `${label} mergedAt`), "pull-request merge"),
  };
}
function normalizeLabels(value, graphql) {
  const items = graphql ? requiredOwn(value, "nodes", "GraphQL label nodes") : value;
  if (!Array.isArray(items) || items.length > 100
    || (graphql && requiredOwn(requiredOwn(value, "pageInfo", "GraphQL label page info"),
      "hasNextPage", "GraphQL label pagination") !== false)) {
    throw new Error("Pull-request label inventory is incomplete or exceeds its bound.");
  }
  const labels = items.map(item => requiredText(item?.name, "pull-request label")).sort();
  if (new Set(labels).size !== labels.length) throw new Error("Pull-request labels are duplicated.");
  return labels;
}
function normalizePullRequest(value, expectedDraft, expectedState, repository) {
  const pull = {
    number: positiveInteger(value?.number, "pull-request number"),
    nodeId: requiredText(value?.nodeId || value?.id, "pull-request node ID"),
    state: requiredText(value?.state, "pull-request state"),
    isDraft: value?.isDraft,
    branch: requiredBranch(value?.branch || value?.headRefName),
    headSha: requiredSha(value?.headSha || value?.headRefOid, "pull-request head SHA"),
    baseRef: requiredText(value?.baseRef || value?.baseRefName, "pull-request base ref"),
    baseSha: requiredSha(value?.baseSha || value?.baseRefOid, "pull-request base SHA"),
    authorLogin: requiredText(value?.authorLogin || value?.author?.login, "pull-request author"),
    restAutoMergeRequest: requiredOwn(value, "restAutoMergeRequest", "REST auto-merge"),
    autoMergeRequest: requiredOwn(value, "autoMergeRequest", "GraphQL auto-merge"),
    isInMergeQueue: requiredOwn(value, "isInMergeQueue", "GraphQL merge-queue state"),
    mergeQueueEntry: requiredOwn(value, "mergeQueueEntry", "GraphQL merge-queue entry"),
    headRepository: normalizeRepository(value?.headRepository || value?.head?.repo),
    baseRepository: normalizeRepository(value?.baseRepository || value?.base?.repo),
  };
  if (!["OPEN", "CLOSED"].includes(expectedState) || pull.state !== expectedState
    || pull.isDraft !== Boolean(expectedDraft) || pull.baseRef !== "main"
    || pull.restAutoMergeRequest !== null || pull.autoMergeRequest !== null
    || pull.isInMergeQueue !== false || pull.mergeQueueEntry !== null) {
    throw new Error("Reviewed CI recovery requires the exact expected pull-request state targeting main.");
  }
  if ([pull.headRepository, pull.baseRepository].some(candidate => candidate.fullName !== repository.fullName
    || candidate.id !== repository.id || candidate.nodeId !== repository.nodeId)) {
    throw new Error("Pull-request repositories drifted from the target repository.");
  }
  return pull;
}
function normalizeRepository(value) {
  const fullName = requiredRepository(value?.fullName || value?.full_name || value?.nameWithOwner || value);
  const numericId = value?.databaseId ?? (typeof value?.id === "number" ? value.id : null);
  const nodeId = value?.nodeId || value?.node_id || (typeof value?.id === "string" ? value.id : null);
  return {
    fullName,
    id: positiveInteger(numericId, "repository ID"),
    nodeId: requiredText(nodeId, "repository node ID"),
  };
}
function normalizeActor(value) {
  return {
    id: positiveInteger(value?.id, "actor ID"),
    login: requiredText(value?.login, "actor login"),
  };
}
function normalizeProtection(value, check, repository) {
  if (!value || value.strict !== true || !Array.isArray(value.contexts)
    || !Array.isArray(value.checks)) {
    throw new Error("Reviewed CI recovery requires a strict branch-protection snapshot.");
  }
  const contexts = [...new Set(value.contexts.map(item => requiredText(item, "required context")))].sort();
  const checks = value.checks.map(item => ({
    context: requiredText(item?.context, "required check context"),
    appId: positiveInteger(item?.app_id ?? item?.appId, "required check app ID"),
  })).sort((left, right) => left.context.localeCompare(right.context) || left.appId - right.appId);
  const selected = checks.filter(item => item.context === check.name && item.appId === check.appId);
  if (!contexts.includes(check.name) || selected.length !== 1) {
    throw new Error("Failed check is not the exact required branch-protection context and app.");
  }
  const protectedRepository = requiredRepository(value.repository);
  const branch = requiredText(value.branch, "protected branch");
  if (protectedRepository !== repository.fullName || branch !== "main") {
    throw new Error("Branch-protection snapshot does not bind this repository main branch.");
  }
  const snapshot = { repository: protectedRepository, branch, strict: true, contexts, checks };
  return {
    context: check.name, appId: check.appId, strict: true,
    repository: protectedRepository, branch, digest: digestValue(snapshot),
  };
}
function normalizeWorkflowRun(value, { check, pull, repository }) {
  const run = {
    id: positiveInteger(value?.id, "workflow run ID"),
    workflowId: positiveInteger(value?.workflow_id, "workflow ID"),
    path: requiredWorkflowPath(value?.path),
    event: requiredText(value?.event, "workflow event"),
    headBranch: requiredBranch(value?.head_branch),
    headSha: requiredSha(value?.head_sha, "workflow head SHA"),
    status: requiredText(value?.status, "workflow status"),
    conclusion: requiredText(value?.conclusion, "workflow conclusion"),
    attempt: positiveInteger(value?.run_attempt, "workflow run attempt"),
    repositoryId: positiveInteger(value?.repository?.id, "workflow repository ID"),
    repositoryNodeId: requiredText(value?.repository?.node_id, "workflow repository node ID"),
    repositoryName: requiredRepository(value?.repository?.full_name),
  };
  if (run.id !== runIdFromDetailsUrl(check.detailsUrl)
    || run.event !== "pull_request" || run.headBranch !== pull.branch
    || run.headSha !== pull.headSha || run.status !== "completed" || run.conclusion !== "failure"
    || run.repositoryId !== repository.id || run.repositoryNodeId !== repository.nodeId
    || run.repositoryName !== repository.fullName) {
    throw new Error("Workflow run drifted from the failed reviewed subject.");
  }
  return run;
}
function normalizeWorkflowJob(value, { check, run }) {
  const job = {
    id: positiveInteger(value?.id, "workflow job ID"),
    runId: positiveInteger(value?.run_id, "workflow job run ID"),
    name: requiredText(value?.name, "workflow job name"),
    headSha: requiredSha(value?.head_sha, "workflow job head SHA"),
    status: requiredText(value?.status, "workflow job status"),
    conclusion: requiredText(value?.conclusion, "workflow job conclusion"),
  };
  if (job.id !== check.id || job.id !== jobIdFromDetailsUrl(check.detailsUrl)
    || job.runId !== run.id || job.name !== check.name || job.headSha !== check.headSha
    || job.status !== "completed" || job.conclusion !== "failure") {
    throw new Error("Workflow job drifted from the exact failed check run.");
  }
  return job;
}
function requireLatestCheckRun({ selected, inventory }) {
  if (!inventory || inventory.complete !== true || !Array.isArray(inventory.items)
    || inventory.items.length === 0 || inventory.items.length > 1_000
    || Number(inventory.totalCount) !== inventory.items.length
    || !Number.isSafeInteger(Number(inventory.pageCount)) || Number(inventory.pageCount) < 1) {
    throw new Error("Exact-head check-run inventory is incomplete or exceeds its bound.");
  }
  const peers = inventory.items.filter(value => (
    Number(value?.app?.id) === selected.appId
    && String(value?.name || "") === selected.name
    && String(value?.head_sha || "") === selected.headSha
  ));
  if (peers.length === 0) throw new Error("Failed check is absent from the exact-head inventory.");
  const snapshots = peers.map(value => ({
    id: positiveInteger(value?.id, "peer check-run ID"),
    status: requiredText(value?.status, "peer check-run status"),
    conclusion: value?.conclusion === null ? null : requiredText(value?.conclusion, "peer conclusion"),
    createdAt: value?.created_at ? requiredInstant(value.created_at, "peer check creation") : null,
    startedAt: value?.started_at ? requiredInstant(value.started_at, "peer check start") : null,
    completedAt: value?.completed_at ? requiredInstant(value.completed_at, "peer check completion") : null,
  })).sort((left, right) => left.id - right.id);
  const latest = snapshots.at(-1);
  const exact = snapshots.filter(peer => peer.id === selected.id);
  if (exact.length !== 1 || exact[0].status !== selected.status
    || exact[0].conclusion !== selected.conclusion || exact[0].startedAt !== selected.startedAt
    || exact[0].completedAt !== selected.completedAt) {
    throw new Error("Selected check run differs from its unique inventory entry.");
  }
  if (Number(latest.id) !== selected.id) {
    throw new Error("A newer attempt supersedes the selected failed check run.");
  }
  if (snapshots.some(peer => peer.status === "queued" || peer.status === "in_progress")) {
    throw new Error("A queued or in-progress rerun supersedes reviewed failure recovery.");
  }
  const subject = {
    complete: true,
    totalCount: Number(inventory.totalCount),
    pageCount: Number(inventory.pageCount),
    peers: snapshots,
  };
  return { count: subject.totalCount, latestId: latest.id, digest: digestValue(subject) };
}
function runIdFromDetailsUrl(value) {
  const match = String(value || "").match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/u);
  if (!match) throw new Error("Check details URL lacks exact run and job identities.");
  return positiveInteger(match[1], "details run ID");
}
function jobIdFromDetailsUrl(value) {
  const match = String(value || "").match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/u);
  if (!match) throw new Error("Check details URL lacks exact run and job identities.");
  return positiveInteger(match[2], "details job ID");
}
function requiredWorkflowPath(value) {
  const text = requiredText(value, "workflow path");
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.(?:yml|yaml)$/u.test(text)) {
    throw new Error("Workflow path must be repository-owned YAML.");
  }
  return text;
}
function normalizeCheckRun(value) {
  const pullRequests = Array.isArray(value?.pull_requests)
    ? value.pull_requests.map(candidate => ({
      number: positiveInteger(candidate?.number, "check pull-request number"),
      headSha: requiredSha(candidate?.head?.sha, "check pull-request head SHA"),
      headRef: requiredBranch(candidate?.head?.ref),
      baseSha: requiredSha(candidate?.base?.sha, "check pull-request base SHA"),
      baseRef: requiredText(candidate?.base?.ref, "check pull-request base ref"),
    }))
    : [];
  const check = {
    id: positiveInteger(value?.id, "check-run ID"),
    checkSuiteId: positiveInteger(value?.check_suite?.id, "check-suite ID"),
    name: requiredText(value?.name, "check name"),
    headSha: requiredSha(value?.head_sha, "check head SHA"),
    status: requiredText(value?.status, "check status"),
    conclusion: requiredText(value?.conclusion, "check conclusion"),
    startedAt: requiredInstant(value?.started_at, "check start"),
    completedAt: requiredInstant(value?.completed_at, "check completion"),
    detailsUrl: requiredGitHubUrl(value?.details_url, "check details URL"),
    externalId: requiredText(value?.external_id, "check external ID", { allowEmpty: true }),
    appId: positiveInteger(value?.app?.id, "check app ID"),
    appSlug: requiredText(value?.app?.slug, "check app slug"),
    pullRequests,
  };
  if (check.status !== "completed" || check.conclusion !== "failure"
    || check.appSlug !== "github-actions" || pullRequests.length === 0) {
    throw new Error("Reviewed CI recovery requires one completed failing GitHub Actions check run.");
  }
  return check;
}
function requiredRepository(value) {
  const text = String(value || "").trim();
  if (!REPOSITORY_PATTERN.test(text)) throw new Error("Repository must be owner/name.");
  return text;
}
function repositoryName(gh) {
  return requiredRepository(gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim());
}
function requireGh(gh) {
  if (typeof gh !== "function") throw new Error("GitHub evidence reader requires an argv executor.");
}
function requiredBranch(value) {
  const text = requiredText(value, "branch");
  if (!/^agent\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*$/u.test(text)) throw new Error(
    "Branch must be an exact agent device branch.");
  return text;
}
function requiredText(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const text = value.normalize("NFC").trim();
  if (!allowEmpty && !text) throw new Error(`${label} is required.`);
  if (text.length > 2_048) throw new Error(`${label} exceeds its bound.`);
  return text;
}
function requiredSha(value, label) {
  const text = String(value || "");
  if (!SHA_PATTERN.test(text)) throw new Error(`${label} must be a SHA.`);
  return text;
}
function requiredDigest(value, label) {
  const text = String(value || "");
  if (!DIGEST_PATTERN.test(text)) throw new Error(`${label} must be a SHA-256 digest.`);
  return text;
}
function requiredOwn(value, key, label) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`${label} is missing.`);
  return value[key];
}
function optionalInstant(value, label) { return value === null ? null : requiredInstant(value, label); }
function requiredInstant(value, label) {
  const text = String(value || "");
  const milliseconds = Date.parse(text);
  const normalized = Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "";
  const withoutZeroMilliseconds = normalized.replace(/\.000Z$/u, "Z");
  if (!normalized || text !== normalized && text !== withoutZeroMilliseconds) {
    throw new Error(`${label} must be a canonical UTC instant.`);
  }
  return normalized;
}
function requiredGitHubUrl(value, label) {
  const text = requiredText(value, label);
  if (!GITHUB_URL_PATTERN.test(text)) throw new Error(`${label} must be a GitHub URL.`);
  return text;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be positive.`);
  return number;
}
function nonnegativeInteger(value, label) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be nonnegative.`); return number; }
function invalid(label) { throw new Error(`Reviewed CI failure ${label} is invalid.`); }
function readCompleteInventory(gh, repository, headSha) {
  const items = [];
  let totalCount = null;
  let page = 1;
  while (items.length < (totalCount ?? 1)) {
    const response = parseJson(gh(["api", "--method", "GET", `repos/${repository}/commits/${headSha}/check-runs`,
      "-f", "filter=all", "-f", "per_page=100", "-f", `page=${page}`]));
    totalCount ??= Number(response.total_count);
    items.push(...response.check_runs);
    if (items.length > MAX_CHECK_RUNS || page > 10
      || (response.check_runs.length === 0 && items.length < totalCount)) {
      throw new Error("Check-run pagination is incomplete or exceeds its bound.");
    }
    page += 1;
  }
  if (items.length !== totalCount) throw new Error("Check-run pagination count drifted.");
  return { complete: true, totalCount, pageCount: page - 1, items };
}
function parseJson(value) {
  try { return JSON.parse(String(value || "")); }
  catch { throw new Error("GitHub evidence response was not bounded JSON."); }
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}
