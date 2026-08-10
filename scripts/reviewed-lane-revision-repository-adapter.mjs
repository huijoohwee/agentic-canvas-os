import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { createGitHubCloudCollaborationAdapter } from "./github-cloud-collaboration-adapter.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import * as evidence from "./reviewed-lane-revision-evidence.mjs";
import * as fence from "./reviewed-lane-revision-fence.mjs";
import { bindAdmissionCloudAuthority, invokeRepositoryCloudAction, reviewReadyAdmissionCloudAuthority, verifyReviewReadyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority, projectRootState } from "./scoped-lane-cloud-reconciliation.mjs";
import { assertReviewedLaneForwardChild as assertForwardChild, assertReviewedLaneSourceHeadProjection,
  createReviewedLaneRevisionControllerAdapter, joinReviewedLanePublicPrivateClaim,
  requireReviewedLaneDigest as requiredDigest, requireReviewedLaneFunction as requireFunction,
  requireReviewedLaneSha as requiredSha, requireReviewedLaneText as required,
  reviewedLaneCompleteResolution as completeResolution, reviewedLaneGitObjectExists as gitObjectExists,
  reviewedLaneOperationIdentity as operationIdentity, reviewedLaneOperationResult as operationResult,
  reviewedLaneRefResolution as refResolution,
} from "./reviewed-lane-revision-controller.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
export function createReviewedLaneRevisionRepositoryAdapter(options = {}, dependencies = {}) {
  return createReviewedLaneRevisionControllerAdapter(dependencies.runtime
    || createReviewedLaneRevisionRepositoryRuntime(options, dependencies));
}
export function createReviewedLaneRevisionRepositoryRuntime(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const environment = options.environment || process.env;
  const execute = (command, args, settings = {}) => execFileSync(command, args, { cwd: repository, encoding: "utf8", ...settings });
  const gitText = dependencies.gitText || ((args, settings = {}) => execute("git", args, settings).trim());
  const gitRaw = dependencies.gitRaw || ((args, settings = {}) => execute("git", args, settings));
  const ghText = dependencies.ghText || (args => execute("gh", args).trim());
  const runGit = dependencies.runGit || ((args, settings = {}) => execute("git", args,
    { stdio: [settings.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], ...settings }).trim());
  const hashCommit = rawCommit => runGit(["hash-object", "-t", "commit", "--stdin"], { input: rawCommit });
  const branch = required(gitText(["branch", "--show-current"]), "branch");
  const record = assertRegisteredWorktree({ cwd: repository, porcelain: gitText(["worktree", "list", "--porcelain", "-z"]) });
  if (record.branch !== `refs/heads/${branch}`) throw new Error("Reviewed lane revision worktree registration drifted from its branch.");
  const commonDirectory = path.resolve(repository, gitText(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const phaseTransport = dependencies.phaseTransport || null;
  const inspectCloud = dependencies.inspectCloud || invokeRepositoryCloudAction;
  const verifyCloud = dependencies.verifyCloud || invokeRepositoryCloudVerifier;
  const privateClaims = dependencies.privateClaims || (authority =>
    createGitHubCloudCollaborationAdapter({ ledgerRepository: authority.ledgerRepository,
      token: environment.GH_TOKEN || environment.GITHUB_TOKEN || "" })
      .listClaims({ targetRepository: authority.targetRepository }));
  const expectedPullRequest = options.pullRequestNumber || null;
  const ttlSeconds = Number(options.ttlSeconds || 1_800);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400)
    throw new Error("Reviewed lane revision TTL must be 60 through 86400 seconds.");
  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2"
      || lease.status !== "review_ready"
      || lease.sessionId !== sessionId
      || lease.branch !== branch
      || (expectedPullRequest && !lease.pullRequestUrl?.endsWith(`/pull/${expectedPullRequest}`))
      || realpathSync(lease.worktreePath) !== repository) {
      throw new Error("Reviewed lane revision requires the exact review-ready session/worktree lease.");
    }
    return lease;
  }
  function readProviderSubject(lease = readLease()) {
    const url = required(lease.pullRequestUrl, "pull-request URL");
    const match = url.match(/\/pull\/(\d+)$/u);
    if (!match) throw new Error("Reviewed lane revision pull-request URL is malformed.");
    const repositoryIdentity = JSON.parse(ghText([
      "repo", "view", "--json", "nameWithOwner,id",
    ]));
    const fullName = required(repositoryIdentity.nameWithOwner, "repository identity");
    const [owner, name] = fullName.split("/");
    const query = [
      "query($owner:String!,$name:String!,$number:Int!){",
      "repository(owner:$owner,name:$name){id nameWithOwner pullRequest(number:$number){",
      "id url number state isDraft title body headRefName headRefOid baseRefName baseRefOid",
      "author{login} headRepository{nameWithOwner} baseRepository{nameWithOwner}",
      "autoMergeRequest{enabledAt} mergeQueueEntry{id}}}",
      "viewer{login databaseId}}",
    ].join(" ");
    const response = JSON.parse(ghText([
      "api", "graphql", "-f", `query=${query}`,
      "-f", `owner=${owner}`, "-f", `name=${name}`,
      "-F", `number=${Number(match[1])}`,
    ]));
    const pullRequest = response?.data?.repository?.pullRequest;
    if (!pullRequest) throw new Error("GitHub returned no exact reviewed pull request.");
    return Object.freeze({
      actor: {
        id: response.data.viewer.databaseId,
        login: response.data.viewer.login,
      },
      pullRequest: {
        ...pullRequest,
        autoMergeRequest: pullRequest.autoMergeRequest ?? null,
        baseRepository: pullRequest.baseRepository?.nameWithOwner,
        headRepository: pullRequest.headRepository?.nameWithOwner,
        isInMergeQueue: pullRequest.mergeQueueEntry !== null,
        mergeQueueEntry: pullRequest.mergeQueueEntry ?? null,
      },
      repository: {
        fullName: response.data.repository.nameWithOwner,
        nodeId: response.data.repository.id,
      },
    });
  }
  async function joinedClaim(status, claimId, lease) {
    const authority = readLease().cloudAuthority;
    if (!authority?.ledgerRepository || !authority?.targetRepository || !claimId) {
      throw new Error("Reviewed lane revision lease has no exact cloud authority.");
    }
    const publicClaims = status.claims.filter(claim => claim?.claimId === claimId);
    const privateMatches = (await privateClaims(authority)).filter(claim => claim?.claimId === claimId);
    if (publicClaims.length !== 1 || privateMatches.length !== 1) {
      throw new Error("Cloud inventory has no unique reviewed claim.");
    }
    return joinReviewedLanePublicPrivateClaim({
      publicClaim: publicClaims[0],
      privateClaim: privateMatches[0],
      lease,
    });
  }
  async function readClaim(lease = readLease()) {
    return joinedClaim(cloudStatus(), lease.cloudAuthority?.claimId, lease);
  }
  async function exactSource(status, plan) {
    const claim = await joinedClaim(status, plan.sourceClaimId, plan.source.lease);
    if (digestValue(claim) !== plan.source.claim.claimRecordDigest
      || digestValue(readLease().cloudAuthority) !== plan.source.authority.authorityDigest) {
      throw new Error("Reviewed source claim or authority drifted from the authorized plan.");
    }
    return claim;
  }
  function readLocal() {
    const headSha = requiredSha(gitText(["rev-parse", "HEAD"]), "local head SHA");
    const remoteHeadSha = readRemoteHead();
    const status = gitText(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status) throw new Error("Reviewed lane revision requires a clean registered worktree.");
    return Object.freeze({
      branch,
      commitText: gitRaw(["cat-file", "commit", headSha], { maxBuffer: 1024 * 1024 }),
      headSha,
      parentShas: gitText(["show", "-s", "--format=%P", headSha]).split(/\s+/u).filter(Boolean),
      remoteHeadSha,
      subject: gitText(["show", "-s", "--format=%s", headSha]),
      treeSha: requiredSha(gitText(["show", "-s", "--format=%T", headSha]), "tree SHA"),
    });
  }
  function readRemoteHead() {
    const output = gitText(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    return requiredSha(output.split(/\s+/u)[0], "remote branch SHA");
  }
  function callTransport(name, input) {
    const method = phaseTransport?.[name];
    const context = {
      ...input,
      branch,
      environment,
      ghText,
      leaseStore,
      repository,
      sessionId,
    };
    if (typeof method === "function") return method(context);
    return defaultTransport(name, context);
  }
  function cloudStatus() {
    const authority = readLease().cloudAuthority;
    const status = inspectCloud({ action: "status", ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository }, environment });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true
      || status.action !== "status" || !Array.isArray(status.claims)) {
      throw new Error("Reviewed lane revision cloud inventory is incomplete.");
    }
    return status;
  }
  async function successor(status, plan, acceptedStates, laneRevisions = [plan.sourceHeadSha]) {
    const source = plan.source.claim;
    const matches = status.claims.filter(claim => claim?.predecessorClaimId === plan.sourceClaimId
      && claim.claimId !== plan.sourceClaimId && claim.actorId === source.actorId
      && claim.repositoryId === source.repositoryId && claim.workItemId === source.workItemId
      && claim.canonicalBaseRevision === source.canonicalBaseRevision
      && laneRevisions.includes(claim.laneRevision) && claim.writeSetDigest === source.writeSetDigest
      && claim.leaseEpoch === source.leaseEpoch + 1 && acceptedStates.has(projectRootState(claim.state)));
    if (matches.length > 1) throw new Error("Reviewed lane revision successor is ambiguous.");
    return matches[0] ? joinedClaim(status, matches[0].claimId, plan.source.lease) : null;
  }
  function manifest(plan) {
    const admission = readLease().admission;
    return Object.freeze({ schema: "agentic-declared-write-scope/v1",
      declaredWriteSet: plan.source.lease.declaredWriteSet,
      writeSetDigest: plan.source.lease.writeSetDigest,
      manifestDigest: plan.source.lease.manifestDigest,
      admittedReportDigest: admission?.admittedReportDigest });
  }
  function authorityFor(plan, status, claim) {
    const source = readLease().cloudAuthority;
    return normalizeBoundAuthority({ result: { claim, claimDigest: claim.fenceRevision,
      ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest },
    authority: source, manifest: manifest(plan), deviceId: readLease().device, sessionId });
  }
  function successorValues(operationKey, status, claim) {
    return operationResult(operationKey, { claimId: claim.claimId, claimDigest: claim.fenceRevision,
      transitionCounter: claim.transitionCounter, leaseEpoch: claim.leaseEpoch,
      state: projectRootState(claim.state), ledgerRevision: status.ledgerRevision,
      ledgerDigest: status.ledgerDigest });
  }
  function cloudResult(action, request) {
    const authority = readLease().cloudAuthority;
    const result = inspectCloud({ action, ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository, ...request }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || result.action !== action) throw new Error(`Reviewed lane revision ${action} was not authoritative.`);
    return result;
  }
  function defaultTransport(name, input) {
    const handlers = { reconcilePhase: reconcileCloudPhase, createWaitingSuccessor,
      retireSourceClaim, promoteSuccessor, bindSuccessor, markSuccessorReviewReady,
      buildLeaseProjection, verifyTerminal };
    const handler = handlers[name];
    if (!handler) throw new Error(`Reviewed lane revision lacks safe ${name}() repository transport.`);
    return handler(input);
  }
  async function createWaitingSuccessor({ operationKey, plan }) {
    const before = cloudStatus();
    if ((environment.GITHUB_ACTOR_ID && String(environment.GITHUB_ACTOR_ID) !== plan.source.actor.id)
      || (environment.GITHUB_ACTOR && environment.GITHUB_ACTOR !== plan.source.actor.login)) throw new Error("Runtime GitHub actor differs from the authorized source actor.");
    const predecessor = await exactSource(before, plan);
    cloudResult("claim", { actorId: Number(plan.source.actor.id), actorLogin: plan.source.actor.login,
      branch, workItemId: predecessor.workItemId, canonicalBaseSha: predecessor.canonicalBaseRevision,
      headSha: plan.sourceHeadSha, declaredWriteSet: predecessor.declaredWriteScope,
      predecessorClaimId: plan.sourceClaimId, leaseEpoch: predecessor.leaseEpoch + 1, ttlSeconds,
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-lane-revision:waiting:${plan.planDigest}` });
    const status = cloudStatus();
    const claim = await successor(status, plan, new Set(["waiting-successor"]));
    if (!claim) throw new Error("Cloud did not create the exact waiting successor.");
    return successorValues(operationKey, status, claim);
  }
  async function retireSourceClaim({ operationKey, plan }) {
    const status = cloudStatus();
    const waiting = await successor(status, plan, new Set(["waiting-successor"]));
    if (!waiting) throw new Error("Source retirement requires its exact waiting successor.");
    const source = await exactSource(status, plan);
    cloudResult("retire", { claimId: source.claimId,
      expectedFenceRevision: source.fenceRevision, expectedTransitionCounter: source.transitionCounter,
      expectedLedgerDigest: status.ledgerDigest,
      reason: "superseded", finalRevision: plan.sourceHeadSha,
      reviewRequestId: plan.sourceReviewRequestId,
      bytesDigest: digestValue({ sourceHeadSha: plan.sourceHeadSha,
        replacementHeadSha: plan.replacementHeadSha, treeSha: plan.treeSha,
        candidateDigest: plan.candidateDigest }),
      namedChecksDigest: plan.sourceFocusedEvidenceDigest,
      handoffEvidenceDigest: digestValue({ planDigest: plan.planDigest, successorClaimId: waiting.claimId }),
      deviceId: readLease().device, sessionId,
      idempotencyKey: `reviewed-lane-revision:retire:${plan.planDigest}` });
    if (cloudStatus().claims.some(claim => claim?.claimId === plan.sourceClaimId)) {
      throw new Error("Reviewed source claim remained live after retirement.");
    }
    return operationResult(operationKey, { sourceClaimId: plan.sourceClaimId,
      retirementDigest: digestValue({ planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId }) });
  }
  async function promoteSuccessor({ operationKey, plan }) {
    const before = cloudStatus();
    if (before.claims.some(claim => claim?.claimId === plan.sourceClaimId)) {
      throw new Error("Successor promotion is forbidden before source retirement.");
    }
    const waiting = await successor(before, plan, new Set(["waiting-successor"]));
    if (!waiting) throw new Error("Successor promotion requires one waiting claim.");
    cloudResult("continue", { branch, headSha: plan.sourceHeadSha,
      claimId: waiting.claimId, expectedFenceRevision: waiting.fenceRevision,
      expectedTransitionCounter: waiting.transitionCounter, expectedLedgerDigest: before.ledgerDigest,
      mode: "promote", ttlSeconds,
      deviceId: readLease().device, sessionId,
      idempotencyKey: `reviewed-lane-revision:promote:${plan.planDigest}` });
    const status = cloudStatus();
    const claim = await successor(status, plan, new Set(["active"]));
    if (!claim || claim.reviewRequestId) throw new Error("Successor did not become exact unbound current authority.");
    return successorValues(operationKey, status, claim);
  }
  async function bindSuccessor({ operationKey, plan }) {
    let status = cloudStatus();
    let claim = await successor(status, plan, new Set(["active"]),
      [plan.sourceHeadSha, plan.replacementHeadSha]);
    if (!claim || claim.reviewRequestId) {
      throw new Error("Successor binding requires unbound current authority.");
    }
    if (claim.laneRevision !== plan.replacementHeadSha) {
      cloudResult("continue", { branch, headSha: plan.replacementHeadSha,
        claimId: claim.claimId, expectedFenceRevision: claim.fenceRevision,
        expectedTransitionCounter: claim.transitionCounter, expectedLedgerDigest: status.ledgerDigest,
        mode: "projection", deviceId: readLease().device, sessionId,
        idempotencyKey: `reviewed-lane-revision:project:${plan.planDigest}` });
      status = cloudStatus();
      claim = await successor(status, plan, new Set(["active"]), [plan.replacementHeadSha]);
    }
    if (!claim || claim.reviewRequestId) throw new Error("Successor projection did not converge.");
    const bound = bindAdmissionCloudAuthority({ authority: authorityFor(plan, status, claim),
      manifest: manifest(plan), branch, headSha: plan.replacementHeadSha,
      pullRequestNumber: plan.pullRequestNumber, reviewRequestId: plan.sourceReviewRequestId,
      deviceId: readLease().device, sessionId, environment,
      invoke: inspectCloud, inspect: inspectCloud, verify: verifyCloud, returnVerification: true,
      idempotencyKey: `reviewed-lane-revision:bind:${plan.planDigest}` });
    return operationResult(operationKey, { authority: bound.authority });
  }
  async function markSuccessorReviewReady({ operationKey, plan }) {
    const status = cloudStatus();
    const claim = await successor(status, plan, new Set(["active", "review_ready"]),
      [plan.replacementHeadSha]);
    if (!claim || claim.reviewRequestId !== plan.sourceReviewRequestId) {
      throw new Error("Review-ready transition requires the exact bound successor.");
    }
    const ready = reviewReadyAdmissionCloudAuthority({ authority: authorityFor(plan, status, claim),
      manifest: manifest(plan), branch, headSha: plan.replacementHeadSha,
      pullRequestNumber: plan.pullRequestNumber, reviewRequestId: plan.sourceReviewRequestId,
      focusedEvidenceDigest: plan.sourceFocusedEvidenceDigest, deviceId: readLease().device,
      sessionId, environment, invoke: inspectCloud, inspect: inspectCloud, verify: verifyCloud });
    return operationResult(operationKey, { authority: ready.authority });
  }
  async function buildLeaseProjection({ intent, plan }) {
    const ready = intent.phases.successor_review_ready.values.authority;
    const status = cloudStatus();
    const claim = await successor(status, plan, new Set(["review_ready"]),
      [plan.replacementHeadSha]);
    const live = claim?.reviewRequestId === plan.sourceReviewRequestId
      ? authorityFor(plan, status, claim) : null;
    if (!live || digestValue(live) !== digestValue(ready)) {
      throw new Error("Reviewed successor review-ready authority drifted before lease projection.");
    }
    const current = readLease();
    return Object.freeze({ ...current, fenceSha: plan.replacementHeadSha,
      reviewHeadSha: plan.replacementHeadSha, cloudAuthority: ready,
      heartbeatAt: new Date().toISOString(), expiresAt: ready.expiresAt });
  }
  async function reconcileCloudPhase({ intent, operationKey, phase, plan }) {
    const stored = intent.phases?.[phase]?.values;
    const complete = values => completeResolution(stored || values);
    if (phase === "complete") return intent.status === "complete"
      ? complete(operationResult(operationKey, { status: "complete" }))
      : Object.freeze({ kind: "pending" });
    if (phase === "lease_updated") {
      const lease = readLease();
      const ready = projectRootState(lease.cloudAuthority?.state) === "review_ready"
        && lease.fenceSha === plan.replacementHeadSha && lease.reviewHeadSha === plan.replacementHeadSha;
      return ready ? complete(operationResult(operationKey, { leaseProjection: lease,
        leaseProjectionDigest: digestValue(lease) })) : Object.freeze({ kind: "pending" });
    }
    if (phase === "pr_projected") {
      const lease = readLease();
      const provider = readProviderSubject(lease);
      const marker = parseWriterLeasePullRequestBody(provider.pullRequest.body);
      const exact = provider.pullRequest.headRefOid === plan.replacementHeadSha
        && digestValue(marker) === digestValue(projectWriterLeasePullRequestMarker(lease));
      return exact ? complete(operationResult(operationKey, { markerDigest: digestValue(marker),
        pullRequestUrl: provider.pullRequest.url })) : Object.freeze({ kind: "pending" });
    }
    if (phase === "verified") return complete(verifyTerminal({ intent, operationKey, plan }));
    const status = cloudStatus();
    const states = phase === "successor_waiting" ? new Set(["waiting-successor", "active", "review_ready"])
      : phase === "successor_current" || phase === "successor_bound" ? new Set(["active", "review_ready"])
        : phase === "successor_review_ready" ? new Set(["review_ready"]) : null;
    if (phase === "source_retired") {
      const retired = !status.claims.some(claim => claim?.claimId === plan.sourceClaimId)
        && Boolean(await successor(status, plan,
          new Set(["waiting-successor", "active", "review_ready"]),
          [plan.sourceHeadSha, plan.replacementHeadSha]));
      return retired ? complete(operationResult(operationKey, { sourceClaimId: plan.sourceClaimId,
        retirementDigest: digestValue({ planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId }) }))
        : Object.freeze({ kind: "pending" });
    }
    if (!states) throw new Error(`Unsupported repository reconciliation phase ${phase}.`);
    const revisions = phase === "successor_bound" || phase === "successor_review_ready"
      ? [plan.replacementHeadSha] : [plan.sourceHeadSha, plan.replacementHeadSha];
    const claim = await successor(status, plan, states, revisions);
    const bound = phase === "successor_bound" || phase === "successor_review_ready";
    if (!claim || (bound && claim.reviewRequestId !== plan.sourceReviewRequestId)) {
      return Object.freeze({ kind: "pending" });
    }
    const values = bound ? operationResult(operationKey, { authority: authorityFor(plan, status, claim) })
      : successorValues(operationKey, status, claim);
    if (phase === "successor_review_ready" && stored
      && digestValue(stored.authority) !== digestValue(values.authority)) {
      throw new Error("Reviewed successor review-ready authority drifted after durable recording.");
    }
    return complete(values);
  }
  function verifyTerminal({ operationKey, plan }) {
    const lease = readLease(), local = readLocal(), provider = readProviderSubject(lease);
    if (local.headSha !== plan.replacementHeadSha || local.remoteHeadSha !== plan.replacementHeadSha
      || lease.fenceSha !== plan.replacementHeadSha || lease.reviewHeadSha !== plan.replacementHeadSha) {
      throw new Error("Terminal local and remote reviewed revision equality drifted.");
    }
    evidence.assertReviewedLaneRevisionPullRequest({ actor: provider.actor,
      authority: lease.cloudAuthority, lease, expectedHeadSha: plan.replacementHeadSha,
      pullRequest: provider.pullRequest, repository: provider.repository });
    const verified = verifyReviewReadyAdmissionCloudAuthority({ authority: lease.cloudAuthority,
      manifest: manifest(plan), headSha: plan.replacementHeadSha, branch,
      focusedEvidenceDigest: plan.sourceFocusedEvidenceDigest,
      environment, inspect: inspectCloud, invoke: verifyCloud });
    if (digestValue(verified.authority) !== digestValue(lease.cloudAuthority)) {
      throw new Error("Terminal PR, lease, and cloud authority are not exactly equal.");
    }
    return operationResult(operationKey, { headSha: plan.replacementHeadSha,
      claimId: lease.cloudAuthority.claimId, leaseDigest: writerLeaseDigest(lease),
      markerDigest: digestValue(parseWriterLeasePullRequestBody(provider.pullRequest.body)),
      terminalDigest: digestValue({ planDigest: plan.planDigest,
        claimDigest: lease.cloudAuthority.claimDigest, pullRequestUrl: provider.pullRequest.url }) });
  }
  function readJournal() {
    requireFunction(fence.readReviewedLaneRevisionIntent, "readReviewedLaneRevisionIntent");
    return fence.readReviewedLaneRevisionIntent({ branch, leaseStore });
  }
  return Object.freeze({
    withEntrypointFence({ replacementSubject }, action) {
      const lease = readLease();
      const identity = operationIdentity(branch, replacementSubject);
      const options = {
        leaseStore,
        ...identity,
        expectedLeaseDigest: writerLeaseDigest(lease),
        expectedClaimId: lease.cloudAuthority?.claimId || null,
      };
      if (typeof dependencies.withEntrypointFence === "function") {
        return dependencies.withEntrypointFence(options, action);
      }
      requireFunction(fence.withReviewedLaneEntrypointFence, "withReviewedLaneEntrypointFence");
      return fence.withReviewedLaneEntrypointFence(options, action);
    },
    readIntent() {
      if (typeof dependencies.readIntent === "function") {
        return dependencies.readIntent({ branch, leaseStore, repository, sessionId });
      }
      requireFunction(fence.readReviewedLaneRevisionIntent, "readReviewedLaneRevisionIntent");
      const journal = readJournal();
      if (!journal) return null;
      const intent = journal.values?.revisionIntent;
      if (!intent || intent.intentDigest === undefined) {
        throw new Error("Reviewed lane revision journal has no exact contract intent.");
      }
      return intent;
    },
    writeIntent({ expectedIntent, nextIntent, plan }) {
      if (typeof dependencies.writeIntent === "function") {
        return dependencies.writeIntent({ branch, expectedIntent, nextIntent, plan, repository, sessionId });
      }
      const journal = readJournal();
      const lease = readLease();
      const identity = operationIdentity(branch, plan.replacementSubject);
      const common = { leaseStore, ...identity, expectedLeaseDigest: writerLeaseDigest(lease),
        expectedClaimId: lease.cloudAuthority?.claimId || null, planDigest: plan.planDigest };
      if (!expectedIntent) {
        requireFunction(fence.beginReviewedLaneRevisionIntent, "beginReviewedLaneRevisionIntent");
        const stored = fence.beginReviewedLaneRevisionIntent({ ...common,
          intent: { revisionIntent: nextIntent } });
        return stored.values.revisionIntent;
      }
      if (!journal || journal.values?.revisionIntent?.intentDigest !== expectedIntent.intentDigest) {
        throw new Error("Reviewed lane revision journal changed before contract intent CAS.");
      }
      const name = nextIntent.status === "complete"
        ? "completeReviewedLaneRevisionIntent"
        : "advanceReviewedLaneRevisionIntent";
      requireFunction(fence[name], name);
      const phaseReceipt = nextIntent.phases?.[nextIntent.status];
      const leaseValues = nextIntent.status === "lease_updated"
        ? { leaseProjection: phaseReceipt?.values?.leaseProjection,
          leaseProjectionDigest: phaseReceipt?.values?.leaseProjectionDigest }
        : {};
      const stored = fence[name]({
        ...common,
        evidenceDigest: requiredDigest(phaseReceipt?.receiptDigest, `${nextIntent.status} evidence digest`),
        expectedIntentDigest: journal.intentDigest,
        intent: journal,
        phase: nextIntent.status,
        values: { revisionIntent: nextIntent, ...leaseValues },
      });
      return stored.values.revisionIntent;
    },
    async readSubject({ replacementSubject }) {
      const lease = readLease();
      const local = readLocal();
      assertReviewedLaneSourceHeadProjection({ lease, local });
      const provider = readProviderSubject(lease);
      requireFunction(evidence.buildReviewedLaneRevisionSourceEvidence,
        "buildReviewedLaneRevisionSourceEvidence");
      const source = evidence.buildReviewedLaneRevisionSourceEvidence({
        actor: provider.actor, authority: lease.cloudAuthority, claim: await readClaim(lease), clean: true,
        hashCommit, lease, localHeadSha: local.headSha, pullRequest: provider.pullRequest,
        rawCommit: local.commitText, remoteHeadSha: local.remoteHeadSha, repository: provider.repository,
      });
      const candidate = evidence.buildReviewedLaneRevisionCommitCandidate({ hashCommit,
        rawCommit: local.commitText, replacementSubject });
      return Object.freeze({ candidate, source });
    },
    reconcilePhase(input) {
      const { intent, operationKey, phase, plan } = input;
      if (phase === "prepared") {
        return completeResolution(operationResult(operationKey,
          { authorizationDigest: intent.authorizationDigest }));
      }
      if (phase === "commit_created") {
        const commitSha = requiredSha(plan.replacementHeadSha, "planned replacement head SHA");
        if (!gitObjectExists(gitText, commitSha)) return Object.freeze({ kind: "pending" });
        return completeResolution(operationResult(operationKey, { commitSha,
          candidateDigest: requiredDigest(plan.candidateDigest, "commit candidate digest"),
          treeSha: requiredSha(plan.treeSha, "planned tree SHA") }));
      }
      if (phase === "local_ref_updated") {
        const current = requiredSha(gitText(["rev-parse", "HEAD"]), "local head SHA");
        return refResolution({ current, operationKey, replacement: plan.replacementHeadSha,
          source: plan.sourceHeadSha });
      }
      if (phase === "remote_ref_updated") {
        return refResolution({ current: readRemoteHead(), operationKey,
          replacement: plan.replacementHeadSha, source: plan.sourceHeadSha });
      }
      return callTransport("reconcilePhase", input);
    },
    createWaitingSuccessor: input => callTransport("createWaitingSuccessor", input),
    createCommit({ operationKey, plan }) {
      const local = readLocal();
      requireFunction(evidence.buildReviewedLaneRevisionCommitCandidate,
        "buildReviewedLaneRevisionCommitCandidate");
      const candidate = evidence.buildReviewedLaneRevisionCommitCandidate({ hashCommit,
        rawCommit: local.commitText, replacementSubject: plan.replacementSubject });
      const commitText = required(candidate.candidate?.rawCommit, "replacement commit bytes");
      const commitSha = requiredSha(runGit(["hash-object", "-t", "commit", "-w", "--stdin"],
        { input: commitText }), "replacement commit SHA");
      if (candidate.candidate?.headSha !== commitSha) {
        throw new Error("Stored replacement commit differs from the exact commit candidate.");
      }
      if (candidate.candidateDigest !== plan.candidateDigest
        || commitSha !== plan.replacementHeadSha) {
        throw new Error("Replacement commit candidate drifted from the authorized plan.");
      }
      assertForwardChild({ gitText, local, commitSha });
      return operationResult(operationKey, { commitSha, treeSha: local.treeSha,
        candidateDigest: requiredDigest(candidate.candidateDigest, "commit candidate digest") });
    },
    compareAndSwapLocalRef({ operationKey, plan }) {
      const sourceHeadSha = requiredSha(plan.sourceHeadSha, "planned source head SHA");
      const replacementHeadSha = requiredSha(plan.replacementHeadSha, "planned replacement head SHA");
      runGit(["update-ref", `refs/heads/${branch}`, replacementHeadSha, sourceHeadSha]);
      if (gitText(["rev-parse", "HEAD"]) !== replacementHeadSha) {
        throw new Error("Local branch CAS did not select the exact replacement commit.");
      }
      return operationResult(operationKey, { headSha: replacementHeadSha });
    },
    fastForwardRemote({ operationKey, plan }) {
      const replacementHeadSha = requiredSha(plan.replacementHeadSha, "planned replacement head SHA");
      runGit(["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
      if (readRemoteHead() !== replacementHeadSha) {
        throw new Error("Remote branch did not converge to the no-force forward child.");
      }
      return operationResult(operationKey, { headSha: replacementHeadSha });
    },
    retireSourceClaim: input => callTransport("retireSourceClaim", input),
    promoteSuccessor: input => callTransport("promoteSuccessor", input),
    bindSuccessor: input => callTransport("bindSuccessor", input),
    markSuccessorReviewReady: input => callTransport("markSuccessorReviewReady", input),
    async updateLease({ operationKey, ...input }) {
      const leaseProjection = await callTransport("buildLeaseProjection", input);
      return operationResult(operationKey, {
        leaseProjection,
        leaseProjectionDigest: digestValue(leaseProjection),
      });
    },
    projectPullRequest({ operationKey, plan, intent }) {
      const lease = readLease();
      const before = readProviderSubject(lease);
      const body = updateWriterLeasePullRequestBody(before.pullRequest.body, lease);
      execFileSync("gh", ["pr", "edit", before.pullRequest.url, "--body", body], {
        cwd: repository,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const provider = readProviderSubject(lease);
      requireFunction(evidence.assertReviewedLaneRevisionPullRequest,
        "assertReviewedLaneRevisionPullRequest");
      evidence.assertReviewedLaneRevisionPullRequest({ actor: provider.actor,
        authority: lease.cloudAuthority, lease, expectedHeadSha: plan.replacementHeadSha,
        pullRequest: provider.pullRequest, repository: provider.repository });
      return operationResult(operationKey, {
        markerDigest: digestValue(parseWriterLeasePullRequestBody(provider.pullRequest.body)),
        pullRequestUrl: provider.pullRequest.url,
      });
    },
    verifyTerminal(input) {
      return callTransport("verifyTerminal", {
        ...input,
        lease: readLease(),
        local: readLocal(),
        pullRequest: readProviderSubject().pullRequest,
      });
    },
  });
}
