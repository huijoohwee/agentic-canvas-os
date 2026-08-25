// Responsibility: Bind recovery phases to exact Git, GitHub, cloud, and lease CAS effects.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { buildReviewedForwardChildCandidate, buildReviewedForwardChildEvidence } from "./reviewed-forward-child-recovery-evidence.mjs";
import { complete, createReviewedForwardChildAdapter, pending } from "./reviewed-forward-child-recovery-controller.mjs";
import { createReviewedForwardChildJournal } from "./reviewed-forward-child-recovery-journal.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority, projectRootState } from "./scoped-lane-cloud-reconciliation.mjs";
import { continueTaskAuthorityCloudSuccessorBinding }
  from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
export function createReviewedForwardChildRepositoryAdapter(options = {}, dependencies = {}) { return createReviewedForwardChildAdapter(createRuntime(options, dependencies)); }
function createRuntime(options, dependencies) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const operatorSessionId = text(options.operatorSessionId, "operator session");
  const taskAuthorityFile = options.taskAuthorityFile
    ? realpathSync(path.resolve(options.taskAuthorityFile))
    : null;
  const expectedPullRequest = integer(options.pullRequestNumber, "pull-request number");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(
    command,
    args,
    { cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, ...settings },
  ));
  const git = dependencies.git || (args => execute("git", args).trim());
  const gh = dependencies.gh || (args => execute("gh", args).trim());
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const branch = text(git(["branch", "--show-current"]), "branch");
  const registered = assertRegisteredWorktree({
    cwd: repository,
    porcelain: git(["worktree", "list", "--porcelain", "-z"]),
  });
  if (registered.branch !== `refs/heads/${branch}`) invalid("registered branch");
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const journal = createReviewedForwardChildJournal({
    commonDirectory,
    branch,
    operatorSessionId,
  });
  const ttlSeconds = Number(options.ttlSeconds || 3_600);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) invalid("TTL");
  function readLease({ terminal = false } = {}) {
    const lease = leaseStore.read(branch);
    const allowed = terminal ? ["review_ready", "active"] : ["review_ready"];
    if (!lease || lease.schema !== "agentic-writer-lease/v2"
      || !allowed.includes(lease.status) || lease.sessionId !== sourceSessionId
      || lease.branch !== branch || realpathSync(lease.worktreePath) !== repository
      || !lease.pullRequestUrl?.endsWith(`/pull/${expectedPullRequest}`)
      || lease.admission?.status !== "admitted") invalid("source lease");
    return lease;
  }
  function status(authority = readLease({ terminal: true }).cloudAuthority) {
    const result = cloud({
      action: "status",
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) {
      invalid("cloud status");
    }
    return result;
  }
  function providerSubject() {
    const identity = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner,id"]));
    const [owner, name] = identity.nameWithOwner.split("/");
    const query = [
      "query($owner:String!,$name:String!,$number:Int!){",
      "repository(owner:$owner,name:$name){id nameWithOwner pullRequest(number:$number){",
      "id url number state isDraft body headRefName headRefOid baseRefName baseRefOid",
      "author{login} headRepository{nameWithOwner} baseRepository{nameWithOwner}",
      "mergeQueueEntry{id} autoMergeRequest{mergeMethod commitHeadline commitBody enabledAt enabledBy{login}}",
      "timelineItems(last:50,itemTypes:[AUTO_MERGE_DISABLED_EVENT]){nodes{",
      "... on AutoMergeDisabledEvent{id createdAt actor{login}}}}}}viewer{login databaseId}}",
    ].join(" ");
    const response = JSON.parse(gh([
      "api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`,
      "-f", `name=${name}`, "-F", `number=${expectedPullRequest}`,
    ]));
    const pull = response?.data?.repository?.pullRequest;
    if (!pull) invalid("provider pull request");
    return Object.freeze({
      actor: { id: response.data.viewer.databaseId, login: response.data.viewer.login },
      repository: {
        fullName: response.data.repository.nameWithOwner,
        nodeId: response.data.repository.id,
      },
      pullRequest: {
        number: pull.number, nodeId: pull.id, url: pull.url, state: pull.state,
        isDraft: pull.isDraft, body: pull.body, headBranch: pull.headRefName,
        headSha: pull.headRefOid, baseBranch: pull.baseRefName, baseSha: pull.baseRefOid,
        authorLogin: pull.author?.login, headRepository: pull.headRepository?.nameWithOwner,
        baseRepository: pull.baseRepository?.nameWithOwner,
        autoMergeRequest: pull.autoMergeRequest ? {
          mergeMethod: pull.autoMergeRequest.mergeMethod,
          commitHeadline: pull.autoMergeRequest.commitHeadline,
          commitBody: pull.autoMergeRequest.commitBody ?? null,
          enabledAt: new Date(pull.autoMergeRequest.enabledAt).toISOString(),
          enabledByLogin: pull.autoMergeRequest.enabledBy?.login,
        } : null,
        mergeQueueEntry: pull.mergeQueueEntry ?? null,
      },
      disableEvents: pull.timelineItems?.nodes || [],
    });
  }
  function remoteHead() {
    return sha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])
      .split(/\s+/u)[0], "remote head");
  }
  function cloudAction(action, request, authority) {
    const result = cloud({
      action,
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository, ...request },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== action) invalid(`${action} result`);
    return result;
  }
  function refreshChain(reviewHeadSha, sourceHeadSha, protectedMainSha) {
    try { execute("git", ["merge-base", "--is-ancestor", reviewHeadSha, sourceHeadSha]); }
    catch { invalid("review descendant"); }
    const revisions = git([
      "rev-list", "--first-parent", "--reverse", `${reviewHeadSha}..${sourceHeadSha}`,
    ]).split(/\r?\n/u).filter(Boolean);
    if (revisions.length < 1 || revisions.length > 8) invalid("refresh chain bound");
    let prior = reviewHeadSha;
    return revisions.map((headSha, index) => {
      const parentShas = git(["show", "-s", "--format=%P", headSha]).split(" ");
      if (parentShas.length !== 2 || parentShas[0] !== prior) invalid("refresh merge chain");
      try { execute("git", ["merge-base", "--is-ancestor", parentShas[1], protectedMainSha]); }
      catch { invalid("refresh protected parent"); }
      prior = headSha;
      return Object.freeze({
        headSha: sha(headSha, `refresh ${index + 1} head`),
        treeSha: sha(git(["show", "-s", "--format=%T", headSha]), `refresh ${index + 1} tree`),
        parentShas,
      });
    });
  }
  function adaptiveRecovery(claim) {
    if (claim.state !== "integrated-preserved") return null;
    const evidencePath = environment.AGENTIC_ADAPTIVE_RECOVERY_EVIDENCE_PATH;
    if (!evidencePath) invalid("adaptive recovery evidence path");
    return JSON.parse(readFileSync(realpathSync(path.resolve(evidencePath)), "utf8"));
  }
  async function readSource() {
    const lease = readLease();
    const localHeadSha = sha(git(["rev-parse", "HEAD"]), "local head");
    const provider = providerSubject();
    const remoteHeadSha = remoteHead();
    const protectedMainSha = sha(git(["rev-parse", "origin/main"]), "protected main");
    const cloudStatus = status(lease.cloudAuthority);
    const matches = cloudStatus.claims.filter(item => item?.claimId === lease.cloudAuthority.claimId);
    if (matches.length !== 1) invalid("source claim cardinality");
    const claim = matches[0];
    const marker = parseWriterLeasePullRequestBody(provider.pullRequest.body);
    const parents = git(["show", "-s", "--format=%P", localHeadSha]).split(" ");
    const { body, ...pullRequest } = provider.pullRequest;
    return buildReviewedForwardChildEvidence({
      repository: provider.repository,
      actor: provider.actor,
      source: {
        branch, sessionId: sourceSessionId, headSha: localHeadSha, remoteHeadSha,
        providerHeadSha: provider.pullRequest.headSha,
        treeSha: git(["show", "-s", "--format=%T", localHeadSha]),
        parentShas: parents,
        clean: git(["status", "--porcelain=v1", "--untracked-files=all"]) === "",
      },
      lease: {
        status: lease.status, epoch: lease.epoch, leaseDigest: writerLeaseDigest(lease),
        baseSha: lease.baseSha, fenceSha: lease.fenceSha, reviewHeadSha: lease.reviewHeadSha,
        sessionId: lease.sessionId, device: lease.device, scope: lease.scope,
        branch: lease.branch, manifestDigest: lease.admission.manifestDigest,
        declaredWriteSet: lease.admission.declaredWriteSet,
        writeSetDigest: lease.admission.writeSetDigest,
        focusedEvidenceDigest: lease.cloudAuthority.focusedEvidenceDigest,
        pullRequestUrl: lease.pullRequestUrl,
      },
      claim: {
        claimId: claim.claimId, claimDigest: claim.fenceRevision,
        transitionDigest: claim.transitionDigest,
        operationReceiptDigest: claim.operationReceiptDigest,
        state: claim.state, writeAuthority: claim.writeAuthority,
        scopeReserved: claim.scopeReserved, actorId: claim.actorId,
        repositoryId: claim.repositoryId, workItemId: claim.workItemId,
        canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
        declaredWriteSet: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest,
        leaseEpoch: claim.leaseEpoch, transitionCounter: claim.transitionCounter,
        reviewRequestId: claim.reviewRequestId,
      },
      pullRequest: {
        ...pullRequest,
        bodyDigest: digestValue(body),
        writerMarkerDigest: digestValue(marker),
        autoMergeDigest: digestValue(provider.pullRequest.autoMergeRequest),
      },
      protectedMainSha,
      refreshChain: refreshChain(lease.reviewHeadSha, localHeadSha, protectedMainSha),
      adaptiveRecovery: adaptiveRecovery(claim),
    });
  }
  function rawCandidate(source) {
    const rawSource = execute("git", ["cat-file", "commit", source.source.headSha]);
    const committer = rawSource.split("\n").find(line => line.startsWith("committer "))?.slice(10);
    if (!committer) invalid("source committer");
    const subject = "chore(reviewed-forward-child-recovery): resume authoring";
    const raw = [
      `tree ${source.source.treeSha}`,
      `parent ${source.source.headSha}`,
      `author ${committer}`,
      `committer ${committer}`,
      "",
      subject,
      "",
    ].join("\n");
    const bytes = Buffer.from(raw, "utf8");
    const headSha = createHash("sha1")
      .update(Buffer.from(`commit ${bytes.length}\0`, "utf8")).update(bytes).digest("hex");
    return { raw, subject, headSha };
  }
  async function prepareCandidate({ source }) {
    const prepared = rawCandidate(source);
    return buildReviewedForwardChildCandidate({
      sourceHeadSha: source.source.headSha,
      sourceTreeSha: source.source.treeSha,
      childHeadSha: prepared.headSha,
      childTreeSha: source.source.treeSha,
      parentShas: [source.source.headSha],
      subject: prepared.subject,
    });
  }
  function assertPlanSource(plan, { allowLocalChild = false, allowRemoteChild = false,
    allowDraft = false, allowAutoMergeDisabled = false } = {}) {
    const provider = providerSubject().pullRequest;
    const local = git(["rev-parse", "HEAD"]);
    const remote = remoteHead();
    if (![plan.sourceHeadSha, ...(allowLocalChild ? [plan.childHeadSha] : [])].includes(local)
      || ![plan.sourceHeadSha, ...(allowRemoteChild ? [plan.childHeadSha] : [])].includes(remote)
      || ![plan.sourceHeadSha, ...(allowRemoteChild ? [plan.childHeadSha] : [])].includes(provider.headSha)
      || git(["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
      || provider.baseSha !== plan.source.pullRequest.baseSha
      || provider.isDraft !== allowDraft
      || (!allowAutoMergeDisabled
        && digestValue(provider.autoMergeRequest) !== plan.source.pullRequest.autoMergeDigest)
      || (allowAutoMergeDisabled && provider.autoMergeRequest !== null)
      || provider.mergeQueueEntry !== null) invalid("planned source drift");
  }
  function cancellationValues(plan) {
    const provider = providerSubject();
    if (provider.pullRequest.autoMergeRequest !== null) return null;
    const matches = provider.disableEvents.filter(event => event?.actor?.login === plan.source.actor.login
      && Date.parse(event.createdAt) >= Date.parse(plan.source.pullRequest.autoMergeRequest.enabledAt));
    if (matches.length !== 1) return null;
    const core = {
      schema: "agentic-pr-auto-merge-cancellation-receipt/v1",
      pullRequestNumber: plan.pullRequestNumber,
      sourceHeadSha: plan.sourceHeadSha,
      autoMergeDigest: plan.source.pullRequest.autoMergeDigest,
      eventId: matches[0].id,
      cancelledAt: matches[0].createdAt,
      actorLogin: matches[0].actor.login,
    };
    return { autoMergeCancellationDigest: digestValue(core), cancellation: core };
  }
  async function cancelAutoMerge({ plan }) {
    assertPlanSource(plan);
    execute("gh", [
      "pr", "merge", String(plan.pullRequestNumber), "--repo",
      plan.source.repository.fullName, "--disable-auto",
    ]);
    const values = cancellationValues(plan);
    if (!values) invalid("auto-merge cancellation receipt");
    return complete(values);
  }
  async function createForwardChild({ plan }) {
    assertPlanSource(plan, { allowAutoMergeDisabled: true });
    const prepared = rawCandidate(plan.source);
    if (prepared.headSha !== plan.childHeadSha) invalid("candidate determinism");
    const written = execute("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { input: prepared.raw }).trim();
    if (written !== plan.childHeadSha) invalid("candidate object");
    return complete({ childHeadSha: written, candidateDigest: plan.candidate.candidateDigest });
  }
  function successor(plan, accepted, cloudStatus = status(), laneRevision = plan.source.claim.laneRevision) {
    const source = plan.source.claim;
    const matches = cloudStatus.claims.filter(item => item?.predecessorClaimId === plan.sourceClaimId
      && item.actorId === source.actorId && item.repositoryId === source.repositoryId
      && item.workItemId === source.workItemId && item.canonicalBaseRevision === source.canonicalBaseSha
      && item.laneRevision === laneRevision && item.writeSetDigest === source.writeSetDigest
      && item.leaseEpoch === plan.successorLeaseEpoch && accepted.has(projectRootState(item.state)));
    if (matches.length > 1) invalid("successor cardinality");
    return matches[0] || null;
  }
  function successorValues(cloudStatus, claim) {
    return {
      successorClaimId: claim.claimId, successorClaimDigest: claim.fenceRevision,
      successorLeaseEpoch: claim.leaseEpoch, transitionCounter: claim.transitionCounter,
      state: projectRootState(claim.state), ledgerRevision: cloudStatus.ledgerRevision,
      ledgerDigest: cloudStatus.ledgerDigest,
    };
  }
  async function createWaitingSuccessor({ plan }) {
    assertPlanSource(plan, { allowAutoMergeDisabled: true });
    const before = status();
    cloudAction("claim", {
      actorId: Number(plan.source.actor.id), actorLogin: plan.source.actor.login,
      branch, workItemId: plan.source.claim.workItemId,
      canonicalBaseSha: plan.source.claim.canonicalBaseSha,
      headSha: plan.source.claim.laneRevision,
      declaredWriteSet: plan.source.claim.declaredWriteSet,
      predecessorClaimId: plan.sourceClaimId, leaseEpoch: plan.successorLeaseEpoch,
      ttlSeconds, expectedLedgerDigest: before.ledgerDigest,
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-forward-child:waiting:${plan.planDigest}`,
    }, readLease({ terminal: true }).cloudAuthority);
    const after = status();
    const claim = successor(plan, new Set(["waiting-successor"]), after);
    if (!claim) invalid("waiting successor");
    return complete(successorValues(after, claim));
  }
  async function retireSourceClaim({ plan }) {
    assertPlanSource(plan, { allowAutoMergeDisabled: true });
    const before = status();
    const source = before.claims.find(item => item.claimId === plan.sourceClaimId);
    const waiting = successor(plan, new Set(["waiting-successor"]), before);
    const integrated = Boolean(source?.integrationReceiptDigest);
    if (!source || source.fenceRevision !== plan.source.claim.claimDigest || !waiting
      || integrated !== Boolean(source.integration)) invalid("retirement subject");
    cloudAction("retire", {
      claimId: source.claimId, expectedFenceRevision: source.fenceRevision,
      expectedTransitionCounter: source.transitionCounter, expectedLedgerDigest: before.ledgerDigest,
      reason: integrated ? "integrated" : "superseded", finalRevision: source.laneRevision,
      reviewRequestId: source.reviewRequestId,
      bytesDigest: digestValue({ sourceHeadSha: plan.sourceHeadSha,
        sourceTreeSha: plan.source.source.treeSha, childHeadSha: plan.childHeadSha }),
      namedChecksDigest: source.integration?.namedChecksDigest ?? plan.source.lease.focusedEvidenceDigest,
      handoffEvidenceDigest: source.integration?.handoffEvidenceDigest ?? digestValue({ planDigest: plan.planDigest,
        successorClaimId: waiting.claimId }),
      integrationReceiptDigest: source.integrationReceiptDigest,
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-forward-child:retire:${plan.planDigest}`,
    }, readLease({ terminal: true }).cloudAuthority);
    if (status().claims.some(item => item.claimId === plan.sourceClaimId)) {
      invalid("source retirement");
    }
    return complete({ sourceClaimId: plan.sourceClaimId,
      retirementDigest: digestValue({ planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId }) });
  }
  async function promoteSuccessor({ plan }) {
    const before = status();
    if (before.claims.some(item => item.claimId === plan.sourceClaimId)) invalid("promotion order");
    const waiting = successor(plan, new Set(["waiting-successor"]), before);
    if (!waiting) invalid("promotion successor");
    cloudAction("continue", {
      branch, headSha: plan.source.claim.laneRevision, claimId: waiting.claimId,
      expectedFenceRevision: waiting.fenceRevision,
      expectedTransitionCounter: waiting.transitionCounter,
      expectedLedgerDigest: before.ledgerDigest, mode: "promote", ttlSeconds,
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-forward-child:promote:${plan.planDigest}`,
    }, readLease({ terminal: true }).cloudAuthority);
    const after = status();
    const claim = successor(plan, new Set(["active"]), after);
    if (!claim || claim.reviewRequestId) invalid("current successor");
    return complete(successorValues(after, claim));
  }
  async function updateLocalRef({ plan }) {
    assertPlanSource(plan, { allowAutoMergeDisabled: true });
    execute("git", ["update-ref", `refs/heads/${branch}`, plan.childHeadSha, plan.sourceHeadSha]);
    if (git(["rev-parse", "HEAD"]) !== plan.childHeadSha) invalid("local ref CAS");
    return complete({ localHeadSha: plan.childHeadSha,
      localRefReceiptDigest: digestValue({ branch, old: plan.sourceHeadSha, next: plan.childHeadSha }) });
  }
  async function updateRemoteRef({ plan }) {
    assertPlanSource(plan, { allowLocalChild: true, allowAutoMergeDisabled: true });
    execute("git", ["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
    if (remoteHead() !== plan.childHeadSha || providerSubject().pullRequest.headSha !== plan.childHeadSha) {
      invalid("remote ref CAS");
    }
    return complete({ remoteHeadSha: plan.childHeadSha,
      remoteRefReceiptDigest: digestValue({ branch, old: plan.sourceHeadSha, next: plan.childHeadSha }) });
  }
  function manifest(plan) {
    return {
      semanticScope: plan.source.lease.scope,
      declaredWriteSet: plan.source.lease.declaredWriteSet,
      writeSetDigest: plan.source.lease.writeSetDigest,
      manifestDigest: plan.source.lease.manifestDigest,
    };
  }
  async function activateLease({ plan }) {
    const sourceLease = readLease();
    let cloudStatus = status(sourceLease.cloudAuthority);
    let claim = successor(plan, new Set(["active"]), cloudStatus)
      || successor(plan, new Set(["active"]), cloudStatus, plan.childHeadSha);
    if (!claim || remoteHead() !== plan.childHeadSha) invalid("active successor");
    if (claim.laneRevision !== plan.childHeadSha) {
      cloudAction("continue", {
        branch, headSha: plan.childHeadSha, claimId: claim.claimId,
        expectedFenceRevision: claim.fenceRevision,
        expectedTransitionCounter: claim.transitionCounter,
        expectedLedgerDigest: cloudStatus.ledgerDigest, mode: "projection",
        deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
        idempotencyKey: `reviewed-forward-child:bind:${plan.planDigest}`,
      }, sourceLease.cloudAuthority);
      cloudStatus = status(sourceLease.cloudAuthority);
      claim = successor(plan, new Set(["active"]), cloudStatus, plan.childHeadSha);
    }
    if (!claim || claim.reviewRequestId) invalid("projected successor");
    const authority = normalizeBoundAuthority({
      result: { claim, claimDigest: claim.fenceRevision,
        ledgerRevision: cloudStatus.ledgerRevision, ledgerDigest: cloudStatus.ledgerDigest },
      authority: sourceLease.cloudAuthority, manifest: manifest(plan),
      deviceId: sourceLease.device, sessionId: sourceLease.sessionId,
      focusedEvidenceDigest: null,
    });
    if (!taskAuthorityFile) invalid("task authority capability");
    const heartbeatAt = new Date().toISOString();
    const nextLease = {
      ...sourceLease,
      status: "active",
      fenceSha: plan.childHeadSha,
      reviewHeadSha: null,
      cloudAuthority: authority,
      heartbeatAt,
      expiresAt: authority.expiresAt,
    };
    const taskAuthority = continueTaskAuthorityCloudSuccessorBinding({
      sourceLease,
      nextLease,
      capabilityPath: taskAuthorityFile,
      boundAt: heartbeatAt,
    });
    const updated = casWriterLeaseProjection({
      leaseStore, branch, expectedLeaseDigest: writerLeaseDigest(sourceLease),
      expectedClaimId: plan.sourceClaimId,
      values: {
        status: "active", fenceSha: plan.childHeadSha, reviewHeadSha: null,
        cloudAuthority: authority, taskAuthority, heartbeatAt,
        expiresAt: authority.expiresAt,
      },
    }).lease;
    return complete({ leaseDigest: writerLeaseDigest(updated), authority });
  }
  async function projectDraftPullRequest({ plan }) {
    const lease = readLease({ terminal: true });
    let provider = providerSubject();
    if (provider.pullRequest.headSha !== plan.childHeadSha
      || provider.pullRequest.autoMergeRequest !== null) invalid("pull-request projection subject");
    if (!provider.pullRequest.isDraft) {
      execute("gh", ["pr", "ready", "--undo", lease.pullRequestUrl]);
      provider = providerSubject();
    }
    const body = updateWriterLeasePullRequestBody(provider.pullRequest.body, lease);
    if (body !== provider.pullRequest.body) {
      execute("gh", ["pr", "edit", lease.pullRequestUrl, "--body", body]);
      provider = providerSubject();
    }
    const marker = parseWriterLeasePullRequestBody(provider.pullRequest.body);
    if (!provider.pullRequest.isDraft
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      invalid("draft projection");
    }
    return complete({ pullRequestDigest: digestValue(provider.pullRequest),
      pullRequestUrl: provider.pullRequest.url });
  }
  async function verifyTerminal({ plan, intent }) {
    const lease = readLease({ terminal: true });
    const provider = providerSubject();
    const cloudStatus = status(lease.cloudAuthority);
    const claim = successor(plan, new Set(["active"]), cloudStatus, plan.childHeadSha);
    const cancellation = intent.phases.auto_merge_cancelled?.values;
    if (lease.status !== "active" || lease.reviewHeadSha !== null
      || lease.cloudAuthority.claimId !== claim?.claimId
      || lease.cloudAuthority.laneRevision !== plan.childHeadSha
      || provider.pullRequest.isDraft !== true || provider.pullRequest.autoMergeRequest !== null
      || provider.pullRequest.headSha !== plan.childHeadSha
      || git(["rev-parse", "HEAD"]) !== plan.childHeadSha || remoteHead() !== plan.childHeadSha
      || cloudStatus.claims.some(item => item.claimId === plan.sourceClaimId)
      || !cancellationValues(plan)
      || cancellation?.autoMergeCancellationDigest
        !== cancellationValues(plan).autoMergeCancellationDigest
      || digestValue(parseWriterLeasePullRequestBody(provider.pullRequest.body))
        !== digestValue(projectWriterLeasePullRequestMarker(lease))) invalid("terminal proof");
    const values = {
      autoMergeCancellationDigest: cancellation.autoMergeCancellationDigest,
      successorClaimId: claim.claimId, successorClaimDigest: claim.fenceRevision,
      leaseDigest: writerLeaseDigest(lease), pullRequestDigest: digestValue(provider.pullRequest),
    };
    return complete({ ...values, verificationDigest: digestValue(values) });
  }
  async function reconcilePhase({ intent, phase, plan }) {
    const stored = intent.phases?.[phase]?.values;
    if (phase === "auto_merge_cancelled") {
      const values = cancellationValues(plan);
      return values ? complete(stored || values) : pending();
    }
    if (phase === "forward_child_created") {
      try {
        if (git(["show", "-s", "--format=%T %P", plan.childHeadSha])
          !== `${plan.source.source.treeSha} ${plan.sourceHeadSha}`) return pending();
        return complete(stored || { childHeadSha: plan.childHeadSha,
          candidateDigest: plan.candidate.candidateDigest });
      } catch { return pending(); }
    }
    if (phase === "local_ref_updated") {
      return git(["rev-parse", "HEAD"]) === plan.childHeadSha
        ? complete(stored || { localHeadSha: plan.childHeadSha,
          localRefReceiptDigest: digestValue({ branch, old: plan.sourceHeadSha,
            next: plan.childHeadSha }) }) : pending();
    }
    if (phase === "remote_ref_updated") {
      return remoteHead() === plan.childHeadSha && providerSubject().pullRequest.headSha === plan.childHeadSha
        ? complete(stored || { remoteHeadSha: plan.childHeadSha,
          remoteRefReceiptDigest: digestValue({ branch, old: plan.sourceHeadSha,
            next: plan.childHeadSha }) }) : pending();
    }
    if (phase === "lease_activated") {
      const lease = readLease({ terminal: true });
      const cloudStatus = status(lease.cloudAuthority);
      const claim = successor(plan, new Set(["active"]), cloudStatus, plan.childHeadSha);
      return lease.status === "active" && lease.reviewHeadSha === null
        && lease.cloudAuthority?.claimId === claim?.claimId
        && lease.cloudAuthority?.laneRevision === plan.childHeadSha
        ? complete(stored || { leaseDigest: writerLeaseDigest(lease),
          authority: lease.cloudAuthority }) : pending();
    }
    if (phase === "pr_drafted") {
      const lease = readLease({ terminal: true });
      const pull = providerSubject().pullRequest;
      return pull.isDraft && pull.headSha === plan.childHeadSha && pull.autoMergeRequest === null
        && digestValue(parseWriterLeasePullRequestBody(pull.body))
          === digestValue(projectWriterLeasePullRequestMarker(lease))
        ? complete(stored || { pullRequestDigest: digestValue(pull), pullRequestUrl: pull.url })
        : pending();
    }
    if (phase === "verified") return verifyTerminal({ plan, intent });
    const cloudStatus = status();
    if (phase === "source_retired") {
      return !cloudStatus.claims.some(item => item.claimId === plan.sourceClaimId)
        && successor(plan, new Set(["waiting-successor", "active"]), cloudStatus)
        ? complete(stored || { sourceClaimId: plan.sourceClaimId,
          retirementDigest: digestValue({ planDigest: plan.planDigest,
            sourceClaimId: plan.sourceClaimId }) }) : pending();
    }
    const accepted = phase === "successor_waiting"
      ? new Set(["waiting-successor", "active"])
      : phase === "successor_current" ? new Set(["active"]) : null;
    if (!accepted) invalid(`reconciliation phase ${phase}`);
    const claim = successor(plan, accepted, cloudStatus);
    return claim ? complete(stored || successorValues(cloudStatus, claim)) : pending();
  }
  return {
    withFence: journal.withFence,
    readSource,
    prepareCandidate,
    readIntent: journal.readIntent,
    writeIntent: journal.writeIntent,
    reconcilePhase,
    cancelAutoMerge, createForwardChild, createWaitingSuccessor, retireSourceClaim,
    promoteSuccessor, updateLocalRef, updateRemoteRef, activateLease,
    projectDraftPullRequest, verifyTerminal,
  };
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) { throw new Error(`Reviewed forward-child recovery ${label} is invalid.`); }
