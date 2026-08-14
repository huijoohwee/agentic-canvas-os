// Responsibility: Bind the sealed CI-failure recovery lifecycle to repository/provider state.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { buildDeliveryAuthorizedCiFailureRecoveryArchive, buildDeliveryAuthorizedCiFailureRecoveryCloudRequest, createDeliveryAuthorizedCiFailureRecoveryMarker, normalizeDeliveryAuthorizedCiFailureRecoveryArchive, normalizeDeliveryAuthorizedCiFailureRecoveryIntent, parseDeliveryAuthorizedCiFailureRecoveryMarker, projectDeliveryAuthorizedCiFailureTerminalLease, upsertDeliveryAuthorizedCiFailureRecoveryMarker } from "./delivery-authorized-ci-failure-recovery-contract.mjs";
import { complete, createDeliveryAuthorizedCiFailureRecoveryAdapter, pending } from "./delivery-authorized-ci-failure-recovery-controller.mjs";
import { buildDeliveryAuthorizedCiFailureRecoveryEvidence } from "./delivery-authorized-ci-failure-recovery-evidence.mjs";
import { createGitHubCloudCollaborationAdapter } from "./github-cloud-collaboration-adapter.mjs";
import { projectPublicClaim } from "./github-cloud-collaboration-mapping.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { normalizeBoundAuthority, normalizeCurrentClaimInventory } from "./scoped-lane-cloud-reconciliation.mjs";
import { withReviewedLaneEntrypointFence } from "./reviewed-lane-revision-fence.mjs";
import { createWriterLeaseStore, parseDeviceBranch, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
const INTENTS = "deliveryAuthorizedCiFailureRecoveryIntents", ARCHIVES = "deliveryAuthorizedCiFailureRecoveryArchives", LEASE_RECEIPTS = "deliveryAuthorizedCiFailureRecoveryLeaseReceipts";
const SHA = /^[0-9a-f]{40}$/u;
export function createRepositoryDeliveryAuthorizedCiFailureRecoveryAdapter(options = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository"))),
    sessionId = required(options.sessionId, "session ID"), pullRequestNumber = positive(
      options.pullRequestNumber, "pull-request number"), checkRunId = positive(options.checkRunId,
      "check-run ID"), ttlSeconds = bounded(options.ttlSeconds ?? 3_600, 300, 86_400, "TTL"),
    dependencies = options.dependencies || {}, environment = dependencies.environment
      || options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(command,
    args, { cwd: repository, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
      env: environment, ...settings }));
  const git = dependencies.git || (args => String(execute("git", args)).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const branch = required(git(["branch", "--show-current"]), "branch"), identity = parseDeviceBranch(branch);
  if (!identity) invalid("agent device branch");
  const registered = assertRegisteredWorktree({ cwd: repository,
    porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
  if (registered.branch !== `refs/heads/${branch}`) invalid("registered branch");
  const common = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: common });
  const moduleRepository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cloudFactory = dependencies.cloudFactory || (authority => createGitHubCloudCollaborationAdapter({
    ledgerRepository: authority.ledgerRepository,
    token: environment.GH_TOKEN || environment.GITHUB_TOKEN || "",
    request: dependencies.githubRequest || null,
  }));
  let heldFence = null;
  function readLease() { const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2" || lease.sessionId !== sessionId
      || lease.branch !== branch || realpathSync(lease.worktreePath) !== repository
      || !["delivery", "active"].includes(lease.status)) invalid("exact source/terminal lease");
    return lease; }
  function registry() { return leaseStore.readRegistry(); }
  function cloud(authority = readLease().cloudAuthority) { return cloudFactory(authority); }
  async function status(authority = readLease().cloudAuthority) { const result = await cloud(authority).execute("status", { targetRepository: authority.targetRepository });
    if (result?.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) invalid("cloud status"); return result; }
  async function privateClaims(authority) { const claims = await cloud(authority).listClaims({ targetRepository: authority.targetRepository });
    if (!Array.isArray(claims)) invalid("private claim inventory"); return claims; }
  function journal(reg = registry()) { return reg[INTENTS]?.[branch] || null; }
  function archive(reg = registry()) { return reg[ARCHIVES]?.[branch] || null; }
  function fenceIdentity() { return { branch, entrypoint: "delivery-authorized-ci-failure-recovery",
    operationDigest: digestValue({ branch, sessionId, pullRequestNumber, checkRunId }) }; }
  async function withFence(action) {
    const lease = readLease(), options = { leaseStore, ...fenceIdentity(),
      expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: lease.cloudAuthority.claimId };
    const run = dependencies.withFence || withReviewedLaneEntrypointFence;
    return run(options, async fence => { heldFence = fence; try { return await action(); }
      finally { heldFence = null; } });
  }
  function requireFence() { if (!heldFence) invalid("reviewed-lane entrypoint fence"); }
  function readIntent() { const stored = journal();
    if (stored) return normalizeDeliveryAuthorizedCiFailureRecoveryIntent(stored);
    const storedArchive = archive();
    return storedArchive ? normalizeDeliveryAuthorizedCiFailureRecoveryArchive(storedArchive).terminalIntent : null; }
  function writeIntent({ expected, value }) {
    requireFence(); const lease = readLease();
    mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: lease.cloudAuthority.claimId, action: ({ registry: before, lease: current }) => {
        const observed = before[INTENTS]?.[branch] || null;
        if (digestValue(observed) !== digestValue(expected)) invalid("intent journal CAS");
        const records = { ...(before[INTENTS] || {}), [branch]: value };
        return { registry: { ...before, [INTENTS]: records }, lease: current, intent: value,
          changed: true }; } }); }
  async function readEvidence() {
    if (dependencies.readEvidence) return dependencies.readEvidence({ repository, branch, sessionId,
      pullRequestNumber, checkRunId, lease: readLease() });
    const lease = readLease();
    if (lease.status !== "delivery" || Object.hasOwn(lease, "taskAuthority")) {
      invalid("legacy delivery source");
    }
    const source = readSource(), provider = readInitialProvider(lease), authority = lease.cloudAuthority;
    const cloudStatus = await status(authority), publicClaim = one(cloudStatus.claims,
      item => item.claimId === authority.claimId, "public source claim");
    const privateClaim = one(await privateClaims(authority), item => item.claimId === authority.claimId,
      "private source claim");
    const verification = await cloud(authority).execute("verify", { targetRepository:
      authority.targetRepository, claimId: authority.claimId, canonicalBaseSha: lease.baseSha,
      headSha: source.headSha, allowRetiredIntegratedPreserved: true,
      integrationReceiptDigest: authority.integrationReceiptDigest,
      transitionCounter: publicClaim.transitionCounter });
    if (verification?.ok !== true || verification.action !== "verify"
      || verification.ledgerRevision !== cloudStatus.ledgerRevision
      || verification.claimDigest !== publicClaim.fenceRevision
      || verification.claim?.transitionDigest !== publicClaim.transitionDigest
      || verification.receipt?.ledgerDigest !== cloudStatus.ledgerDigest) invalid("cloud verification");
    const inventory = normalizeCurrentClaimInventory({ inventoryResult: cloudStatus,
      verificationResult: verification, authority });
    const publicRecord = publicClaim, privateRecord = projectPrivate(privateClaim);
    const overlaps = cloudStatus.claims.filter(item => item.claimId !== authority.claimId
      && item.scopeReserved === true && writeSetsOverlap(item.declaredWriteScope,
        lease.admission.declaredWriteSet)).map(item => item.claimId).sort();
    const input = { repository: provider.repository, actor: provider.actor,
      controller: readController(), source, lease: { record: lease, leaseDigest: writerLeaseDigest(lease) },
      authority: { record: authority, recordDigest: digestValue(authority) }, cloud: {
        ledgerRevision: cloudStatus.ledgerRevision, ledgerDigest: cloudStatus.ledgerDigest,
        inventoryDigest: inventory.inventoryDigest,
        publicClaim: { record: publicRecord, recordDigest: digestValue(publicRecord) },
        privateClaim: { record: privateRecord, recordDigest: digestValue(privateRecord) },
        inventory: { ...inventory, complete: true, totalCount: inventory.claims.length, pageCount: 1 },
        overlappingReservedClaimIds: overlaps }, provider: provider.evidence,
      protectedAdvance: readProtectedAdvance(lease, provider.evidence.failure.check.pullRequests[0].baseSha,
        provider.evidence.rest.baseSha) };
    return buildDeliveryAuthorizedCiFailureRecoveryEvidence(input); }
  function readSource() {
    const headSha = sha(git(["rev-parse", "HEAD"])), treeSha = sha(git(["rev-parse", "HEAD^{tree}"]));
    const remoteHeadSha = remoteSha(branch), clean = git(["status", "--porcelain=v1", "-z",
      "--untracked-files=all"]) === "";
    return { branch, headSha, treeSha, remoteHeadSha,
      worktreeIdentityDigest: digestValue({ root: repository, branch, registeredHead: registered.head,
        origin: git(["remote", "get-url", "origin"]) }),
      indexDigest: digestValue(git(["ls-files", "-s", "-z"])), clean }; }
  function readController() {
    const revisionSha = sha(dependencies.controllerRevision || String(execute("git", ["-C",
      moduleRepository, "rev-parse", "HEAD"])).trim()), observedMainSha = remoteSha("main");
    return { revisionSha, observedMainSha }; }
  function readProtectedAdvance(lease, checkBase, pullBase) {
    const current = remoteSha("main"), controller = readController().revisionSha;
    for (const [left, right] of [[lease.baseSha, checkBase], [checkBase, pullBase], [pullBase, current],
      [controller, current]]) execute("git", ["merge-base", "--is-ancestor", left, right]);
    const paths = git(["diff", "--name-only", "-z", lease.baseSha, current]).split("\0")
      .filter(Boolean).map(item => `path:${item}`).sort();
    return { sourceBaseSha: lease.baseSha, checkAttemptBaseSha: checkBase,
      pullRequestBaseSha: pullBase, controllerRevisionSha: controller, currentMainSha: current,
      changedWriteScope: paths, changedWriteScopeDigest: digestValue(paths),
      sourceBaseAncestorOfCheckAttemptBase: true, checkAttemptBaseAncestorOfPullRequestBase: true,
      pullRequestBaseAncestorOfCurrentMain: true, controllerRevisionAncestorOfCurrentMain: true,
      disposition: "disjoint-preserved" }; }
  function readInitialProvider(lease) {
    const snapshot = readProviderRaw(), failure = readFailure(snapshot.repository, snapshot.rest);
    return { ...snapshot, evidence: { rest: providerEvidence(snapshot, lease, true),
      graphql: providerEvidence(snapshot, lease, true), failure,
      protection: readProtection(snapshot.repository.fullName, failure.check) } }; }
  function readProviderRaw() {
    if (dependencies.readProvider) { const value = dependencies.readProvider({ pullRequestNumber });
      if (value?.rest?.number !== pullRequestNumber || value?.graph?.number !== pullRequestNumber) {
        invalid("injected provider identity"); } return value; }
    const fullName = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]),
      repo = json(gh(["api", `repos/${fullName}`])), actorRaw = json(gh(["api", "user"])),
      rest = json(gh(["api", `repos/${fullName}/pulls/${pullRequestNumber}`])), [owner, name] = fullName.split("/");
    const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){id databaseId nameWithOwner pullRequest(number:$number){id number url state isDraft title body headRefName headRefOid baseRefName baseRefOid author{__typename id databaseId login} headRepository{id databaseId nameWithOwner} baseRepository{id databaseId nameWithOwner} autoMergeRequest{enabledAt mergeMethod commitHeadline commitBody enabledBy{__typename id databaseId login}} isInMergeQueue mergeQueueEntry{id}}}}";
    const graphRoot = json(gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`,
      "-F", `name=${name}`, "-F", `number=${pullRequestNumber}`]));
    if (graphRoot.errors) invalid("GraphQL response");
    const graphRepo = graphRoot.data.repository, graph = graphRepo.pullRequest;
    const repositoryIdentity = repoIdentity(repo), actor = actorIdentity(actorRaw);
    if (digestValue(repositoryIdentity) !== digestValue(repoIdentity(graphRepo))
      || rest.node_id !== graph.id || rest.number !== graph.number || rest.html_url !== graph.url
      || String(rest.state).toUpperCase() !== graph.state || rest.draft !== graph.isDraft || rest.title !== graph.title || String(rest.body || "") !== String(graph.body || "")
      || rest.head.sha !== graph.headRefOid || rest.head.ref !== graph.headRefName || rest.base.sha !== graph.baseRefOid || rest.base.ref !== graph.baseRefName
      || rest.user.id !== actor.id || graph.author.databaseId !== actor.id
      || [rest.head.repo, rest.base.repo, graph.headRepository, graph.baseRepository]
        .some(value => digestValue(repoIdentity(value)) !== digestValue(repositoryIdentity))
      || Boolean(rest.auto_merge) !== Boolean(graph.autoMergeRequest)
      || graph.autoMergeRequest && (graph.autoMergeRequest.enabledBy.databaseId !== actor.id || rest.auto_merge.enabled_by.id !== actor.id || rest.auto_merge.merge_method.toUpperCase() !== graph.autoMergeRequest.mergeMethod)
      || graph.isInMergeQueue !== false
      || graph.mergeQueueEntry !== null) invalid("REST/GraphQL provider join");
    return { repository: repositoryIdentity, actor, rest, graph }; }
  function providerEvidence(raw, lease, armed) {
    const { rest, graph, repository, actor } = raw, auto = graph.autoMergeRequest;
    if (armed && (!auto || auto.mergeMethod !== "SQUASH" || rest.auto_merge?.merge_method !== "squash")) {
      invalid("exact armed SQUASH auto-merge");
    }
    if (!armed && (auto !== null || rest.auto_merge !== null)) invalid("disabled auto-merge");
    const body = String(rest.body || ""), marker = parseWriterLeasePullRequestBody(body);
    if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      invalid("writer marker");
    }
    const request = armed ? { mergeMethod: "SQUASH", commitHeadline: auto.commitHeadline,
      commitBody: auto.commitBody, enabledAt: new Date(auto.enabledAt).toISOString(), enabledBy: actor } : null;
    return { number: rest.number, nodeId: rest.node_id, url: rest.html_url,
      state: String(rest.state).toUpperCase(), isDraft: rest.draft, merged: rest.merged,
      title: rest.title, bodyDigest: digestValue(body), writerMarkerDigest: digestValue(marker),
      writerMarkerCount: (body.match(/<!--\s*agentic-writer-lease\/v2\s+/gu) || []).length,
      headBranch: rest.head.ref, headSha: rest.head.sha, baseBranch: rest.base.ref,
      baseSha: rest.base.sha, author: actor, headRepository: repository,
      baseRepository: repository, isInMergeQueue: graph.isInMergeQueue,
      mergeQueueEntry: graph.mergeQueueEntry, autoMergeRequest: request }; }
  function readFailure(repositoryIdentity, pull) {
    const name = repositoryIdentity.fullName, check = json(gh(["api",
      `repos/${name}/check-runs/${checkRunId}`, "-H", "Accept: application/vnd.github+json"]));
    const match = String(check.details_url).match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/u);
    if (!match || Number(match[2]) !== checkRunId) invalid("check URL");
    const run = json(gh(["api", `repos/${name}/actions/runs/${match[1]}`])),
      job = json(gh(["api", `repos/${name}/actions/jobs/${checkRunId}`])), checkRuns = [];
    let total = null, pages = 0;
    while (total === null || checkRuns.length < total) { pages += 1;
      const page = json(gh(["api", "--method", "GET", `repos/${name}/commits/${pull.head.sha}/check-runs`,
        "-f", "filter=all", "-f", "per_page=100", "-f", `page=${pages}`]));
      total ??= page.total_count; checkRuns.push(...page.check_runs);
      if (pages > 10 || checkRuns.length > 1_000 || !page.check_runs.length) invalid("check inventory pagination"); }
    const checkProjection = projectCheck(check), items = checkRuns.map(item => ({
      ...projectCheck(item), workflowRunAttempt: item.id === check.id ? run.run_attempt : 1 }))
      .sort((a, b) => a.id - b.id);
    const inventoryCore = { complete: true, totalCount: total, pageCount: pages, items };
    return { check: checkProjection, inventory: { ...inventoryCore,
      inventoryDigest: digestValue(inventoryCore) }, run: { id: run.id, workflowId: run.workflow_id,
      checkSuiteId: check.check_suite.id, path: run.path, event: run.event,
      headBranch: run.head_branch, headSha: run.head_sha, status: run.status,
      conclusion: run.conclusion, attempt: run.run_attempt, repository: repositoryIdentity,
      pullRequests: checkProjection.pullRequests }, job: { id: job.id, runId: job.run_id,
      runAttempt: run.run_attempt, name: job.name, headSha: job.head_sha, status: job.status,
      conclusion: job.conclusion } }; }
  function projectCheck(value) {
    const runId = Number(String(value.details_url).match(/\/actions\/runs\/(\d+)/u)?.[1]);
    return { id: value.id, checkSuiteId: value.check_suite.id, name: value.name,
      headSha: value.head_sha, status: value.status, conclusion: value.conclusion,
      startedAt: new Date(value.started_at).toISOString(), completedAt:
        new Date(value.completed_at).toISOString(), detailsUrl: value.details_url,
      externalIdDigest: digestValue(String(value.external_id ?? "")), appId: value.app.id,
      appSlug: value.app.slug, workflowRunId: runId, pullRequests: value.pull_requests.map(item => ({
        number: item.number, headSha: item.head.sha, headRef: item.head.ref,
        baseSha: item.base.sha, baseRef: item.base.ref })) }; }
  function readProtection(name, check) {
    const raw = json(gh(["api", `repos/${name}/branches/main/protection/required_status_checks`]));
    const core = { repository: name, branch: "main", strict: raw.strict,
      contexts: [...raw.contexts].sort(), checks: raw.checks.map(item => ({ context: item.context,
        appId: item.app_id })).sort((a, b) => a.context.localeCompare(b.context) || a.appId - b.appId) };
    if (!core.contexts.includes(check.name)) invalid("required failure context");
    return { ...core, inventoryDigest: digestValue(core) }; }
  function providerState(plan, raw, draft, markers = null) {
    const source = plan.evidence.provider.rest, body = String(raw.rest.body || ""),
      writer = parseWriterLeasePullRequestBody(body), recovery =
        parseDeliveryAuthorizedCiFailureRecoveryMarker(body), live = { number: raw.rest.number,
          nodeId: raw.rest.node_id, url: raw.rest.html_url, state: String(raw.rest.state).toUpperCase(),
          isDraft: raw.rest.draft, merged: raw.rest.merged, title: raw.rest.title,
          headBranch: raw.rest.head.ref, headSha: raw.rest.head.sha, baseBranch: raw.rest.base.ref,
          baseSha: raw.rest.base.sha, authorDigest: digestValue(actorIdentity(raw.rest.user)),
          headRepositoryDigest: digestValue(repoIdentity(raw.rest.head.repo)),
          baseRepositoryDigest: digestValue(repoIdentity(raw.rest.base.repo)) };
    if (live.isDraft !== draft || raw.rest.auto_merge !== null || raw.graph.autoMergeRequest !== null
      || raw.graph.isInMergeQueue !== false || raw.graph.mergeQueueEntry !== null
      || Object.entries(live).some(([key, value]) => value !== ({ ...source, state: "OPEN",
        merged: false, authorDigest: digestValue(source.author), headRepositoryDigest:
        digestValue(source.headRepository), baseRepositoryDigest: digestValue(source.baseRepository) })[key])) {
      invalid("provider phase state");
    }
    if (!markers && (digestValue(body) !== source.bodyDigest
      || digestValue(writer) !== source.writerMarkerDigest)) invalid("provider body preimage");
    if (markers && (digestValue(body) !== markers.bodyDigest
      || recovery?.markerDigest !== markers.recoveryMarkerDigest)) invalid("terminal recovery marker");
    const result = { ...live, bodyDigest: markers?.bodyDigest ?? source.bodyDigest,
      writerMarkerDigest: markers?.writerMarkerDigest ?? source.writerMarkerDigest,
      isInMergeQueue: false,
      mergeQueueEntry: null, autoMergeRequest: null };
    if (markers) result.recoveryMarkerDigest = markers.recoveryMarkerDigest;
    if (markers && digestValue(writer) !== markers.writerMarkerDigest) invalid("terminal writer marker");
    return result; }
  function providerValues(input, operation, draft, markers = null) {
    const { plan, intent } = input, raw = readProviderRaw(), after = providerState(plan, raw, draft, markers),
      before = providerBefore(input, operation), request = providerRequest(input, operation, markers),
      receipt = { schema:
        "agentic-delivery-authorized-ci-failure-provider-receipt/v1", operation,
        clientMutationId: request, actorId: plan.evidence.actor.id,
        actorLogin: plan.evidence.actor.login, pullRequestNodeId: plan.pullRequestNodeId,
        headSha: plan.sourceHeadSha, afterDigest: digestValue(after) };
    return { providerRequestDigest: request, providerBeforeDigest: operation === "markers_projected"
      ? intent.phases.pull_request_drafted.values.providerAfterDigest : before,
      providerAfter: after, providerAfterDigest: digestValue(after), providerReceipt: receipt,
      providerReceiptDigest: digestValue(receipt) };
  }
  function providerBefore({ plan, intent }, operation) { return operation === "auto_merge_disabled"
    ? digestValue(plan.evidence.provider.rest) : operation === "markers_projected"
      ? intent.phases.pull_request_drafted.values.providerAfterDigest
      : intent.phases.auto_merge_disabled.values.providerAfterDigest; }
  function providerRequest(input, operation, markers = null) { return operation === "markers_projected"
    ? markers.requestDigest : digestValue({ schema:
      "agentic-delivery-authorized-ci-failure-provider-request/v1", operation,
      planDigest: input.plan.planDigest, pullRequestNodeId: input.plan.pullRequestNodeId,
      expectedHeadSha: input.plan.sourceHeadSha, providerBeforeDigest: providerBefore(input, operation) }); }
  function graphMutation(query, variables, field) {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) args.push("-F", `${key}=${value}`);
    const result = json(gh(args)); if (result.errors
      || result.data?.[field]?.clientMutationId !== variables.client) invalid("GraphQL mutation receipt");
    return result;
  }
  async function disableAutoMerge(input) {
    requireFence(); const raw = readProviderRaw();
    if (raw.graph.autoMergeRequest) graphMutation("mutation($id:ID!,$client:String!){disablePullRequestAutoMerge(input:{pullRequestId:$id,clientMutationId:$client}){clientMutationId}}",
      { id: input.plan.pullRequestNodeId, client: providerRequest(input,
        "auto_merge_disabled") }, "disablePullRequestAutoMerge");
    return complete(providerValues(input, "auto_merge_disabled", false));
  }
  async function draftPullRequest(input) {
    requireFence(); const raw = readProviderRaw();
    if (!raw.rest.draft) graphMutation("mutation($id:ID!,$client:String!){convertPullRequestToDraft(input:{pullRequestId:$id,clientMutationId:$client}){clientMutationId}}",
      { id: input.plan.pullRequestNodeId, client: providerRequest(input,
        "pull_request_drafted") }, "convertPullRequestToDraft");
    return complete(providerValues(input, "pull_request_drafted", true));
  }
  async function cloudEffect(input, phase) {
    requireFence(); const { plan, intent, operationKey } = input, prior = intent.phases,
      expected = phase === "successor_waiting" ? plan.evidence.cloud.ledgerDigest
        : phase === "predecessor_retired" ? prior.successor_waiting.values.ledgerDigest
          : phase === "successor_active" ? prior.predecessor_retired.values.ledgerDigest
            : prior.successor_active.values.ledgerDigest,
      authority = plan.evidence.authority.record, client = cloud(authority), action = phase ===
        "successor_waiting" ? "claim" : phase === "predecessor_retired" ? "retire" : "continue";
    const common = { targetRepository: authority.targetRepository, actorId: plan.evidence.actor.id,
      actorLogin: plan.evidence.actor.login, deviceId: plan.evidence.cloud.privateClaim.record.deviceId,
      sessionId: plan.evidence.cloud.privateClaim.record.sessionId,
      idempotencyKey: operationKey, expectedLedgerDigest: expected };
    const request = phase === "successor_waiting" ? { ...common, branch, workItemId:
      plan.evidence.cloud.publicClaim.record.workItemId, canonicalBaseSha: plan.sourceBaseSha,
      headSha: plan.sourceHeadSha, declaredWriteSet:
        plan.evidence.cloud.publicClaim.record.declaredWriteScope,
      predecessorClaimId: plan.sourceClaimId, leaseEpoch: plan.successorCloudLeaseEpoch, ttlSeconds }
      : phase === "predecessor_retired" ? { ...common, claimId: plan.sourceClaimId,
        expectedFenceRevision: plan.evidence.cloud.publicClaim.record.fenceRevision,
        expectedTransitionCounter: plan.evidence.cloud.publicClaim.record.transitionCounter,
        reason: "integrated", finalRevision: plan.sourceHeadSha,
        reviewRequestId: plan.evidence.cloud.publicClaim.record.reviewRequestId,
        bytesDigest: buildDeliveryAuthorizedCiFailureRecoveryCloudRequest(plan, phase, prior,
          expected, null).bytesDigest, namedChecksDigest:
          plan.evidence.cloud.publicClaim.record.integration.namedChecksDigest,
        handoffEvidenceDigest: plan.evidence.cloud.publicClaim.record.integration.handoffEvidenceDigest,
        integrationReceiptDigest: plan.evidence.cloud.publicClaim.record.integrationReceiptDigest }
        : { ...common, claimId: plan.expectedSuccessorClaimId,
          expectedFenceRevision: phase === "successor_active"
            ? prior.successor_waiting.values.claimDigest : prior.successor_active.values.claimDigest,
          expectedTransitionCounter: phase === "successor_active"
            ? prior.successor_waiting.values.transitionCounter : prior.successor_active.values.transitionCounter,
          mode: phase === "successor_active" ? "promote" : "projection",
          headSha: plan.sourceHeadSha, reviewRequestId: phase === "successor_bound"
            ? `github-pull-request:${plan.pullRequestNodeId}` : null,
          ...(phase === "successor_active" ? { ttlSeconds } : {}) };
    const result = await client.execute(action, request);
    if (result?.ok !== true || result.action !== action || !result.operationReceipt) {
      invalid(`${phase} cloud result`);
    }
    return complete(cloudValues(input, phase, result, expected));
  }
  function cloudValues(input, phase, result, expected) {
    const { plan, intent } = input, receipt = result.operationReceipt,
      expiry = ["successor_waiting", "successor_active"].includes(phase)
        ? result.claim.expiresAt : null, request = buildDeliveryAuthorizedCiFailureRecoveryCloudRequest(
          plan, phase, intent.phases, expected, expiry);
    if (request.idempotencyKey !== input.operationKey) invalid("cloud operation key");
    if (phase === "successor_bound") {
      const authority = normalizeBoundAuthority({ result: { ...result,
        ledgerDigest: receipt.ledgerRevision }, authority: plan.evidence.authority.record,
        manifest: { declaredWriteSet: plan.evidence.lease.record.admission.declaredWriteSet,
          writeSetDigest: plan.evidence.lease.record.admission.writeSetDigest,
          manifestDigest: plan.evidence.lease.record.admission.manifestDigest },
        deviceId: plan.evidence.lease.record.device, sessionId, focusedEvidenceDigest: null });
      return { cloudRequestDigest: digestValue(request), operationReceiptDigest: receipt.receiptDigest,
        successorClaimId: result.claim.claimId, successorClaimDigest: result.claim.fenceRevision,
        claimLedgerRevision: receipt.ledgerRevision, transitionCounter: result.claim.transitionCounter,
        ledgerRevision: result.ledgerRevision, ledgerDigest: receipt.ledgerRevision,
        cloudRequest: request, operationReceipt: receipt, authority,
        authorityDigest: digestValue(authority) };
    }
    const retired = phase === "predecessor_retired";
    return { cloudRequestDigest: digestValue(request), operationReceiptDigest: receipt.receiptDigest,
      claimId: retired ? plan.sourceClaimId : result.claim.claimId,
      claimDigest: retired ? receipt.claimDigest : result.claim.fenceRevision,
      claimLedgerRevision: receipt.ledgerRevision,
      transitionCounter: retired ? plan.evidence.cloud.publicClaim.record.transitionCounter + 1
        : result.claim.transitionCounter,
      state: retired ? "retired" : phase === "successor_active" ? "active" : "waiting-successor",
      ledgerRevision: result.ledgerRevision, ledgerDigest: receipt.ledgerRevision,
      cloudRequest: request, operationReceipt: receipt };
  }
  const createWaitingSuccessor = input => cloudEffect(input, "successor_waiting");
  const retirePredecessor = input => cloudEffect(input, "predecessor_retired");
  const promoteSuccessor = input => cloudEffect(input, "successor_active");
  const bindSuccessor = input => cloudEffect(input, "successor_bound");
  async function prepareProjectionCandidate({ plan, intent }) {
    const bound = intent.phases.successor_bound.values;
    return complete({ successorAuthorityDigest: bound.authorityDigest,
      sourceLeaseDigest: plan.sourceLeaseDigest,
      providerBodyBeforeDigest: plan.evidence.provider.rest.bodyDigest,
      markerTemplateDigest: digestValue({ schema:
        "agentic-delivery-authorized-ci-failure-marker-template/v1", planDigest: plan.planDigest,
        sourceClaimId: plan.sourceClaimId, successorClaimId: bound.successorClaimId,
        successorAuthorityDigest: bound.authorityDigest, sourceHeadSha: plan.sourceHeadSha,
        failureCheckRunId: plan.evidence.provider.failure.check.id,
        sourceRetirementReceiptDigest:
          intent.phases.predecessor_retired.values.operationReceiptDigest }) });
  }
  async function projectLease(input) {
    requireFence(); const saved = savedLeaseProjection(input.plan);
    if (saved) return complete(saved);
    const source = readLease(); if (writerLeaseDigest(source) !== input.plan.sourceLeaseDigest) {
      invalid("source lease preimage");
    }
    let values;
    mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest: input.plan.sourceLeaseDigest,
      expectedClaimId: input.plan.sourceClaimId, action: ({ registry: before, lease }) => {
        const beforeSnapshot = registrySnapshot(before), maximumPriorEpoch = Math.max(
          ...Object.values(beforeSnapshot.leases).map(item => item.epoch)), selectedEpoch =
          maximumPriorEpoch + 1, terminalLease = projectDeliveryAuthorizedCiFailureTerminalLease({
            plan: input.plan, sourceLease: lease,
            successorAuthority: input.intent.phases.successor_bound.values.authority,
            localEpoch: selectedEpoch, projectedAt: new Date().toISOString() }),
          afterSnapshot = { ...beforeSnapshot, revision: beforeSnapshot.revision + 1,
            leases: { ...beforeSnapshot.leases, [branch]: terminalLease } }, leaseDigest =
          writerLeaseDigest(terminalLease), core = { schema:
            "agentic-delivery-authorized-ci-failure-registry-receipt/v1", branch,
            beforeRevision: beforeSnapshot.revision, afterRevision: afterSnapshot.revision,
            beforeDigest: digestValue(beforeSnapshot), afterDigest: digestValue(afterSnapshot),
            maximumPriorEpoch, selectedEpoch, sourceLeaseDigest: input.plan.sourceLeaseDigest,
            terminalLeaseDigest: leaseDigest, registryBefore: beforeSnapshot,
            registryAfter: afterSnapshot, mutationId: digestValue({ schema:
              "agentic-delivery-authorized-ci-failure-lease-cas/v1",
              planDigest: input.plan.planDigest, branch,
              sourceLeaseDigest: input.plan.sourceLeaseDigest,
              beforeRevision: beforeSnapshot.revision, beforeDigest: digestValue(beforeSnapshot),
              terminalLeaseDigest: leaseDigest }) };
        values = { terminalLease, leaseDigest,
          registryReceipt: { ...core, receiptDigest: digestValue(core) } };
        const recordCore = { schema: "agentic-delivery-authorized-ci-failure-lease-replay/v1",
          planDigest: input.plan.planDigest, valuesDigest: digestValue(values), values };
        return { registry: { ...before, leases: { ...before.leases, [branch]: terminalLease },
          [LEASE_RECEIPTS]: { ...(before[LEASE_RECEIPTS] || {}), [branch]: { ...recordCore,
            recordDigest: digestValue(recordCore) } } }, lease: terminalLease,
          intent: null, changed: true };
      } });
    return complete(values);
  }
  function registrySnapshot(value) { const { [LEASE_RECEIPTS]: ignored, ...projection } = value;
    return JSON.parse(JSON.stringify(projection)); }
  function savedLeaseProjection(plan) {
    const current = registry(), saved = current[LEASE_RECEIPTS]?.[branch]; if (!saved) return null;
    const { recordDigest, ...core } = saved, values = saved.values;
    if (saved.schema !== "agentic-delivery-authorized-ci-failure-lease-replay/v1"
      || saved.planDigest !== plan.planDigest || recordDigest !== digestValue(core)
      || saved.valuesDigest !== digestValue(values) || values.leaseDigest !==
        writerLeaseDigest(current.leases[branch]) || digestValue(values.terminalLease) !== values.leaseDigest
      || current.revision < values.registryReceipt.afterRevision
      || digestValue(current.leases) !== digestValue(values.registryReceipt.registryAfter.leases)) {
      invalid("lease replay receipt");
    }
    return values;
  }
  function markerProjection(input) {
    const lease = input.intent.phases.lease_projected.values.terminalLease,
      writerMarker = projectWriterLeasePullRequestMarker(lease), recoveryMarker =
        createDeliveryAuthorizedCiFailureRecoveryMarker({ plan: input.plan,
          intent: input.intent, terminalLease: lease }), bodyDigest = digestValue({ schema:
          "agentic-delivery-authorized-ci-failure-body-projection/v1",
          humanBodyDigest: input.plan.evidence.provider.rest.bodyDigest,
          writerMarkerDigest: digestValue(writerMarker),
          recoveryMarkerDigest: recoveryMarker.markerDigest }), requestDigest = digestValue({ schema:
          "agentic-delivery-authorized-ci-failure-marker-request/v1",
          planDigest: input.plan.planDigest, pullRequestNodeId: input.plan.pullRequestNodeId,
          expectedHeadSha: input.plan.sourceHeadSha,
          providerBeforeDigest:
            input.intent.phases.pull_request_drafted.values.providerAfterDigest,
          terminalLeaseDigest: input.intent.phases.lease_projected.values.leaseDigest,
          bodyProjectionDigest: bodyDigest, writerMarkerDigest: digestValue(writerMarker),
          recoveryMarkerDigest: recoveryMarker.markerDigest });
    return { lease, writerMarker, recoveryMarker, bodyDigest, requestDigest,
      writerMarkerDigest: digestValue(writerMarker),
      recoveryMarkerDigest: recoveryMarker.markerDigest };
  }
  async function projectMarkers(input) {
    requireFence(); const projection = markerProjection(input), raw = readProviderRaw(),
      withWriter = updateWriterLeasePullRequestBody(raw.rest.body, projection.lease),
      expectedBody = upsertDeliveryAuthorizedCiFailureRecoveryMarker(withWriter,
        projection.recoveryMarker);
    if (raw.rest.body !== expectedBody) graphMutation("mutation($id:ID!,$body:String!,$client:String!){updatePullRequest(input:{pullRequestId:$id,body:$body,clientMutationId:$client}){clientMutationId}}",
      { id: input.plan.pullRequestNodeId, body: expectedBody, client: projection.requestDigest },
      "updatePullRequest");
    const fresh = readProviderRaw();
    if (fresh.rest.body !== expectedBody) invalid("marker-only body projection");
    const values = providerValues(input, "markers_projected", true, projection);
    return complete({ ...values, writerMarker: projection.writerMarker,
      writerMarkerDigest: projection.writerMarkerDigest,
      recoveryMarker: projection.recoveryMarker,
      recoveryMarkerDigest: projection.recoveryMarkerDigest });
  }
  async function verifyTerminal(input) {
    const source = readSource();
    if (digestValue(source) !== digestValue(input.plan.evidence.source)) invalid("source invariant");
    const lease = readLease(), projected = input.intent.phases.lease_projected.values;
    if (writerLeaseDigest(lease) !== projected.leaseDigest || Object.hasOwn(lease, "taskAuthority")) {
      invalid("literal terminal lease");
    }
    const markers = input.intent.phases.markers_projected.values,
      cloudStatus = await status(lease.cloudAuthority), claim = one(cloudStatus.claims,
        item => item.claimId === lease.cloudAuthority.claimId && item.reviewRequestId
          === `github-pull-request:${input.plan.pullRequestNodeId}`, "bound successor"),
      raw = readProviderRaw();
    providerState(input.plan, raw, true, { bodyDigest: markers.providerAfter.bodyDigest,
      writerMarkerDigest: markers.writerMarkerDigest,
      recoveryMarkerDigest: markers.recoveryMarkerDigest });
    const authority = lease.cloudAuthority, sourceClaim = input.plan.evidence.cloud.publicClaim.record,
      now = Date.now(), expectedClaim = { claimId: authority.claimId,
        entrySchema: authority.entrySchema, claimIdentitySchema: authority.claimIdentitySchema,
        state: "current", writeAuthority: true, scopeReserved: true, actorId: sourceClaim.actorId,
        repositoryId: sourceClaim.repositoryId, workItemId: sourceClaim.workItemId,
        canonicalBaseRevision: authority.canonicalBaseSha, laneRevision: authority.laneRevision,
        declaredWriteScope: authority.cloudDeclaredWriteScope, writeSetDigest: authority.writeSetDigest,
        leaseEpoch: authority.leaseEpoch, transitionCounter: authority.transitionCounter,
        reviewRequestId: authority.reviewRequestId, predecessorClaimId: input.plan.sourceClaimId,
        expiresAt: authority.expiresAt, fenceRevision: authority.claimDigest,
        transitionDigest: authority.claimLedgerRevision,
        operationReceiptDigest: authority.operationReceiptDigest,
        integrationReceiptDigest: null, integration: null };
    for (const [key, value] of Object.entries(expectedClaim)) if (digestValue(claim[key])
      !== digestValue(value)) invalid(`terminal cloud ${key}`);
    if (cloudStatus.ledgerRevision !== authority.ledgerRevision
      || cloudStatus.ledgerDigest !== authority.ledgerDigest || Date.parse(authority.expiresAt) <= now
      || Date.parse(lease.expiresAt) <= now) invalid("terminal live authority");
    const core = { successorClaimId: lease.cloudAuthority.claimId,
      successorClaimDigest: lease.cloudAuthority.claimDigest, leaseDigest: projected.leaseDigest,
      pullRequestDigest: markers.providerAfterDigest,
      writerMarkerDigest: markers.writerMarkerDigest,
      recoveryMarkerDigest: markers.recoveryMarkerDigest,
      sourceInvariantDigest: digestValue(source), source };
    return complete({ ...core, verificationDigest: digestValue({ schema:
      "agentic-delivery-authorized-ci-failure-terminal-verification/v1",
      planDigest: input.plan.planDigest, ...core }) });
  }
  async function reconcilePhase(input) {
    if (input.phase === "complete") { const saved = archive();
      return saved?.terminalIntentDigest === input.intent.intentDigest
        ? complete({ archiveDigest: saved.archiveDigest }) : pending(); }
    if (input.phase === "auto_merge_disabled") {
      const raw = readProviderRaw(); return raw.graph.autoMergeRequest === null && !raw.rest.draft
        ? complete(providerValues(input, input.phase, false)) : pending();
    }
    if (input.phase === "pull_request_drafted") {
      const raw = readProviderRaw(); return raw.graph.autoMergeRequest === null && raw.rest.draft
        ? complete(providerValues(input, input.phase, true)) : pending();
    }
    if (["successor_waiting", "predecessor_retired", "successor_active", "successor_bound"]
      .includes(input.phase)) {
      const observed = await status(input.plan.evidence.authority.record), successor =
        observed.claims.find(item => item.claimId === input.plan.expectedSuccessorClaimId), source =
        observed.claims.find(item => item.claimId === input.plan.sourceClaimId), ready =
        input.phase === "successor_waiting" ? Boolean(successor)
          : input.phase === "predecessor_retired" ? !source && Boolean(successor)
            : input.phase === "successor_active" ? successor?.state === "current"
              : successor?.reviewRequestId === `github-pull-request:${input.plan.pullRequestNodeId}`;
      return ready ? cloudEffect(input, input.phase) : pending();
    }
    if (input.phase === "projection_candidate") return prepareProjectionCandidate(input);
    if (input.phase === "lease_projected") {
      const saved = savedLeaseProjection(input.plan); return saved ? complete(saved) : pending();
    }
    if (input.phase === "markers_projected") {
      const projection = markerProjection(input), raw = readProviderRaw(), expected =
        upsertDeliveryAuthorizedCiFailureRecoveryMarker(
          updateWriterLeasePullRequestBody(raw.rest.body, projection.lease),
          projection.recoveryMarker);
      return raw.rest.body === expected ? projectMarkers(input) : pending();
    }
    if (input.phase === "verified") return verifyTerminal(input);
    invalid(`reconcile phase ${input.phase}`);
  }
  async function archiveComplete(input) { requireFence(); const existing = archive();
    if (existing?.terminalIntentDigest === input.intent.intentDigest) return complete({ archiveDigest: existing.archiveDigest });
    const value = buildDeliveryAuthorizedCiFailureRecoveryArchive({ intent: input.intent, archivedAt: new Date().toISOString() }), lease = readLease();
    mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: lease.cloudAuthority.claimId, action: ({ registry: before, lease: current }) => {
        if (digestValue(before[INTENTS]?.[branch]) !== digestValue(input.intent)) invalid("archive journal CAS");
        const intents = { ...(before[INTENTS] || {}) }, archives = { ...(before[ARCHIVES] || {}), [branch]: value }; delete intents[branch];
        return { registry: { ...before, [INTENTS]: intents, [ARCHIVES]: archives },
          lease: current, intent: null, changed: true };
      } });
    return complete({ archiveDigest: value.archiveDigest }); }
  return createDeliveryAuthorizedCiFailureRecoveryAdapter({ withFence, readEvidence, readIntent,
    writeIntent, reconcilePhase, disableAutoMerge, draftPullRequest, createWaitingSuccessor,
    retirePredecessor, promoteSuccessor, bindSuccessor, prepareProjectionCandidate, projectLease,
    projectMarkers, verifyTerminal, archiveComplete });
  function remoteSha(name) { const matches = git(["ls-remote", "--refs", "origin", `refs/heads/${name}`]).split(/\r?\n/u).filter(Boolean);
    if (matches.length !== 1) invalid(`remote ref ${name}`); return sha(matches[0].split(/\s+/u)[0]); }
}
function projectPrivate(claim) { const publicRecord = projectPublicClaim(claim), { transitionDigest: ignored, ...common } = publicRecord;
  return { ...common, recordedState: claim.recordedState, deviceId: claim.deviceId, sessionId: claim.sessionId, ledgerRevision: claim.ledgerRevision }; }
function repoIdentity(value) { return { fullName: value.full_name || value.nameWithOwner, nodeId: value.node_id || value.id, databaseId: value.databaseId ?? value.id }; }
function actorIdentity(value) { return { id: Number(value.databaseId ?? value.id), nodeId: value.node_id || value.id, login: value.login, type: value.type || value.__typename }; }
function one(values, predicate, label) { const matches = values.filter(predicate);
  if (matches.length !== 1) invalid(`${label} cardinality`); return matches[0]; }
function json(value) { try { return JSON.parse(String(value)); } catch { invalid("bounded JSON"); } }
function required(value, label) { const text = String(value ?? "").trim(); if (!text || text.includes("\0")) throw new Error(`${label} is required.`); return text; }
function positive(value, label) { return bounded(value, 1, Number.MAX_SAFE_INTEGER, label); }
function bounded(value, minimum, maximum, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${label} is invalid.`); return number; }
function sha(value) { const text = String(value); if (!SHA.test(text)) invalid("Git SHA"); return text; }
function invalid(label) { throw new Error(`Delivery-authorized CI-failure repository ${label} is invalid.`); }
