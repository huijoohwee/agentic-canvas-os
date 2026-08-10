// Responsibility: Bind source-correction phases to Git, GitHub, cloud, and lease CAS effects.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { createGitHubCloudCollaborationAdapter } from "./github-cloud-collaboration-adapter.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  buildReviewedLaneSourceCorrectionEvidence,
} from "./reviewed-lane-source-correction-evidence.mjs";
import {
  complete,
  createReviewedLaneSourceCorrectionAdapter,
  pending,
} from "./reviewed-lane-source-correction-controller.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import {
  normalizeBoundAuthority,
  projectRootState,
} from "./scoped-lane-cloud-reconciliation.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  casWriterLeaseProjection,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

export function createReviewedLaneSourceCorrectionRepositoryAdapter(options = {}, dependencies = {}) {
  const runtime = createRuntime(options, dependencies);
  return createReviewedLaneSourceCorrectionAdapter(runtime);
}

function createRuntime(options, dependencies) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const expectedPullRequest = integer(options.pullRequestNumber, "pull-request number");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(
    command, args, { cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, ...settings },
  ));
  const git = dependencies.git || (args => execute("git", args).trim());
  const gh = dependencies.gh || (args => execute("gh", args).trim());
  const branch = text(git(["branch", "--show-current"]), "branch");
  const record = assertRegisteredWorktree({ cwd: repository,
    porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
  if (record.branch !== `refs/heads/${branch}`) invalid("registered branch");
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const privateClaims = dependencies.privateClaims || (authority =>
    createGitHubCloudCollaborationAdapter({
      ledgerRepository: authority.ledgerRepository,
      token: environment.GH_TOKEN || environment.GITHUB_TOKEN || "",
    }).listClaims({ targetRepository: authority.targetRepository }));
  const journalDirectory = path.join(commonDirectory, "agentic-canvas-os", "reviewed-lane-source-correction");
  const journalKey = createHash("sha256").update(branch).digest("hex");
  const statePath = path.join(journalDirectory, `${journalKey}.json`);
  const lockPath = `${statePath}.lock`;
  const ttlSeconds = Number(options.ttlSeconds || 3_600);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    invalid("TTL");
  }

  function readLease({ terminal = false } = {}) {
    const lease = leaseStore.read(branch);
    const allowed = terminal ? ["review_ready", "active"] : ["review_ready"];
    if (!lease || lease.schema !== "agentic-writer-lease/v2"
      || !allowed.includes(lease.status)
      || lease.sessionId !== sourceSessionId
      || lease.branch !== branch
      || realpathSync(lease.worktreePath) !== repository
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

  async function joinedClaim(claimId, authority, cloudStatus = status(authority)) {
    const publicMatches = cloudStatus.claims.filter(item => item?.claimId === claimId);
    const privateMatches = (await privateClaims(authority)).filter(item => item?.claimId === claimId);
    if (publicMatches.length !== 1 || privateMatches.length !== 1) invalid("claim cardinality");
    return Object.freeze({ ...privateMatches[0], ...publicMatches[0],
      deviceId: privateMatches[0].deviceId, sessionId: privateMatches[0].sessionId });
  }

  async function readSource() {
    const lease = readLease();
    const localHeadSha = sha(git(["rev-parse", "HEAD"]), "local head");
    const remoteHeadSha = remoteHead();
    const clean = git(["status", "--porcelain=v1", "--untracked-files=all"]) === "";
    const provider = providerSubject();
    const cloudStatus = status(lease.cloudAuthority);
    const joined = await joinedClaim(lease.cloudAuthority.claimId, lease.cloudAuthority, cloudStatus);
    const claimState = projectRootState(joined.state);
    if (claimState !== "review_ready" && claimState !== "parked") {
      invalid("source claim state");
    }
    const claim = { ...joined, state: claimState === "review_ready" ? "reviewed" : "dormant-preserved" };
    const authority = normalizeBoundAuthority({
      result: { claim: joined, claimDigest: joined.fenceRevision,
        ledgerRevision: cloudStatus.ledgerRevision, ledgerDigest: cloudStatus.ledgerDigest },
      authority: lease.cloudAuthority,
      manifest: {
        semanticScope: lease.admission.semanticScope,
        declaredWriteSet: lease.admission.declaredWriteSet,
        writeSetDigest: lease.admission.writeSetDigest,
        manifestDigest: lease.admission.manifestDigest,
      },
      deviceId: lease.device,
      sessionId: lease.sessionId,
      focusedEvidenceDigest: lease.cloudAuthority.focusedEvidenceDigest,
    });
    const advance = protectedAdvance(lease, provider.pullRequest.baseSha);
    return buildReviewedLaneSourceCorrectionEvidence({
      repository: provider.repository,
      actor: provider.actor,
      lease,
      authority: { ...authority,
        state: projectRootState(authority.state) === "parked" ? "parked" : "review_ready" },
      claim,
      pullRequest: provider.pullRequest,
      localHeadSha,
      remoteHeadSha,
      clean,
      protectedAdvance: advance,
    });
  }

  function protectedAdvance(lease, currentBaseSha) {
    const target = sha(currentBaseSha, "protected current base");
    try {
      execute("git", ["merge-base", "--is-ancestor", lease.baseSha, target]);
    } catch {
      invalid("protected base ancestry");
    }
    const changedPaths = lease.baseSha === target ? [] : execute("git", [
      "diff", "--name-only", "-z", "--no-renames", lease.baseSha, target,
    ]).split("\0").filter(Boolean);
    const changedWriteScope = changedPaths.length === 0 ? [] : normalizeWriteSet(changedPaths);
    if (changedWriteScope.length > 256
      || (changedWriteScope.length > 0
        && writeSetsOverlap(changedWriteScope, lease.admission.declaredWriteSet))) {
      invalid("protected base overlap");
    }
    const core = {
      schema: "agentic-reviewed-lane-protected-advance/v1",
      sourceBaseSha: lease.baseSha,
      currentBaseSha: target,
      changedWriteScope,
      changedWriteScopeDigest: digestValue(changedWriteScope),
      disposition: lease.baseSha === target ? "unchanged" : "disjoint-preserved",
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function providerSubject() {
    const repositoryIdentity = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner,id"]));
    const [owner, name] = repositoryIdentity.nameWithOwner.split("/");
    const query = [
      "query($owner:String!,$name:String!,$number:Int!){",
      "repository(owner:$owner,name:$name){id nameWithOwner pullRequest(number:$number){",
      "id url number state isDraft body headRefName headRefOid baseRefName baseRefOid",
      "author{login} headRepository{nameWithOwner} baseRepository{nameWithOwner}",
      "autoMergeRequest{enabledAt} mergeQueueEntry{id}}}viewer{login databaseId}}",
    ].join(" ");
    const response = JSON.parse(gh(["api", "graphql", "-f", `query=${query}`,
      "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${expectedPullRequest}`]));
    const pull = response?.data?.repository?.pullRequest;
    if (!pull) invalid("provider pull request");
    return Object.freeze({
      actor: { id: response.data.viewer.databaseId, login: response.data.viewer.login },
      repository: { fullName: response.data.repository.nameWithOwner,
        nodeId: response.data.repository.id },
      pullRequest: {
        number: pull.number, nodeId: pull.id, url: pull.url, state: pull.state,
        isDraft: pull.isDraft, body: pull.body, headBranch: pull.headRefName,
        headSha: pull.headRefOid, baseBranch: pull.baseRefName, baseSha: pull.baseRefOid,
        authorLogin: pull.author?.login, headRepository: pull.headRepository?.nameWithOwner,
        baseRepository: pull.baseRepository?.nameWithOwner,
        autoMergeRequest: pull.autoMergeRequest ?? null,
        mergeQueueEntry: pull.mergeQueueEntry ?? null,
      },
    });
  }

  function remoteHead() {
    return sha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])
      .split(/\s+/u)[0], "remote head");
  }

  function assertUnchangedSource(plan) {
    const provider = providerSubject().pullRequest;
    if (git(["rev-parse", "HEAD"]) !== plan.sourceHeadSha
      || remoteHead() !== plan.sourceHeadSha
      || git(["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
      || provider.headSha !== plan.sourceHeadSha
      || provider.baseSha !== plan.source.protectedAdvance.currentBaseSha
      || provider.isDraft !== false
      || provider.autoMergeRequest !== null
      || provider.mergeQueueEntry !== null
      || digestValue(provider.body) !== plan.source.pullRequest.bodyDigest) {
      invalid("source changed after planning");
    }
  }

  function manifest(plan) {
    return Object.freeze({
      schema: "agentic-declared-write-scope/v1",
      semanticScope: plan.source.lease.admission.semanticScope,
      declaredWriteSet: plan.source.lease.admission.declaredWriteSet,
      writeSetDigest: plan.source.lease.admission.writeSetDigest,
      manifestDigest: plan.source.lease.admission.manifestDigest,
      admittedReportDigest: plan.source.lease.admission.admittedReportDigest,
    });
  }

  function cloudAction(action, request, authority = readLease({ terminal: true }).cloudAuthority) {
    const result = cloud({ action, ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository, ...request }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== action) invalid(`${action} result`);
    return result;
  }

  async function successor(plan, acceptedStates, cloudStatus = status(plan.source.authority)) {
    const source = plan.source.claim;
    const candidates = cloudStatus.claims.filter(item =>
      item?.predecessorClaimId === plan.sourceClaimId
      && item.claimId !== plan.sourceClaimId
      && item.actorId === source.actorId
      && item.repositoryId === source.repositoryId
      && item.workItemId === source.workItemId
      && item.canonicalBaseRevision === source.canonicalBaseRevision
      && item.laneRevision === plan.sourceHeadSha
      && item.writeSetDigest === source.writeSetDigest
      && item.leaseEpoch === plan.successorLeaseEpoch
      && acceptedStates.has(projectRootState(item.state)));
    if (candidates.length > 1) invalid("successor cardinality");
    return candidates[0]
      ? joinedClaim(candidates[0].claimId, plan.source.authority, cloudStatus)
      : null;
  }

  function successorValues(cloudStatus, claim) {
    return {
      successorClaimId: claim.claimId,
      successorClaimDigest: claim.fenceRevision,
      successorLeaseEpoch: claim.leaseEpoch,
      transitionCounter: claim.transitionCounter,
      state: projectRootState(claim.state),
      ledgerRevision: cloudStatus.ledgerRevision,
      ledgerDigest: cloudStatus.ledgerDigest,
    };
  }

  async function createWaitingSuccessor({ plan }) {
    assertUnchangedSource(plan);
    const before = status(plan.source.authority);
    const source = await joinedClaim(plan.sourceClaimId, plan.source.authority, before);
    if (source.laneRevision !== plan.sourceHeadSha
      || source.fenceRevision !== plan.source.claim.fenceRevision) invalid("source claim drift");
    cloudAction("claim", {
      actorId: Number(plan.source.actor.id), actorLogin: plan.source.actor.login,
      branch, workItemId: source.workItemId,
      canonicalBaseSha: source.canonicalBaseRevision, headSha: plan.sourceHeadSha,
      declaredWriteSet: source.declaredWriteScope, predecessorClaimId: plan.sourceClaimId,
      leaseEpoch: plan.successorLeaseEpoch, ttlSeconds,
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-lane-source-correction:waiting:${plan.planDigest}`,
    }, plan.source.authority);
    const after = status(plan.source.authority);
    const claim = await successor(plan, new Set(["waiting-successor"]), after);
    if (!claim) invalid("waiting successor");
    return complete(successorValues(after, claim));
  }

  async function retireSourceClaim({ plan }) {
    assertUnchangedSource(plan);
    const before = status(plan.source.authority);
    const waiting = await successor(plan, new Set(["waiting-successor"]), before);
    const source = await joinedClaim(plan.sourceClaimId, plan.source.authority, before);
    if (!waiting || source.fenceRevision !== plan.source.claim.fenceRevision) {
      invalid("retirement subject");
    }
    cloudAction("retire", {
      claimId: source.claimId,
      expectedFenceRevision: source.fenceRevision,
      expectedTransitionCounter: source.transitionCounter,
      expectedLedgerDigest: before.ledgerDigest,
      reason: "superseded", finalRevision: plan.sourceHeadSha,
      reviewRequestId: plan.sourceReviewRequestId,
      bytesDigest: digestValue({ headSha: plan.sourceHeadSha,
        treePreserved: true, sourceEvidenceDigest: plan.source.evidenceDigest }),
      namedChecksDigest: plan.source.authority.focusedEvidenceDigest,
      handoffEvidenceDigest: digestValue({ planDigest: plan.planDigest,
        successorClaimId: waiting.claimId }),
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-lane-source-correction:retire:${plan.planDigest}`,
    }, plan.source.authority);
    if (status(plan.source.authority).claims.some(item => item.claimId === plan.sourceClaimId)) {
      invalid("source retirement");
    }
    return complete({ sourceClaimId: plan.sourceClaimId,
      retirementDigest: digestValue({ planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId }) });
  }

  async function promoteSuccessor({ plan }) {
    const before = status(plan.source.authority);
    if (before.claims.some(item => item.claimId === plan.sourceClaimId)) invalid("promotion order");
    const waiting = await successor(plan, new Set(["waiting-successor"]), before);
    if (!waiting) invalid("promotion successor");
    cloudAction("continue", {
      branch, headSha: plan.sourceHeadSha, claimId: waiting.claimId,
      expectedFenceRevision: waiting.fenceRevision,
      expectedTransitionCounter: waiting.transitionCounter,
      expectedLedgerDigest: before.ledgerDigest,
      mode: "promote", ttlSeconds,
      deviceId: plan.source.lease.device, sessionId: plan.source.lease.sessionId,
      idempotencyKey: `reviewed-lane-source-correction:promote:${plan.planDigest}`,
    }, plan.source.authority);
    const after = status(plan.source.authority);
    const claim = await successor(plan, new Set(["active"]), after);
    if (!claim || claim.reviewRequestId) invalid("current successor");
    return complete(successorValues(after, claim));
  }

  async function activateLease({ plan }) {
    const sourceLease = readLease();
    const cloudStatus = status(plan.source.authority);
    const claim = await successor(plan, new Set(["active"]), cloudStatus);
    if (!claim || claim.reviewRequestId) invalid("active successor");
    const authority = normalizeBoundAuthority({
      result: { claim, claimDigest: claim.fenceRevision,
        ledgerRevision: cloudStatus.ledgerRevision, ledgerDigest: cloudStatus.ledgerDigest },
      authority: plan.source.authority,
      manifest: manifest(plan),
      deviceId: plan.source.lease.device,
      sessionId: plan.source.lease.sessionId,
      focusedEvidenceDigest: null,
    });
    const updated = casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest: writerLeaseDigest(sourceLease),
      expectedClaimId: plan.sourceClaimId,
      values: {
        status: "active",
        reviewHeadSha: null,
        cloudAuthority: authority,
        heartbeatAt: new Date().toISOString(),
        expiresAt: authority.expiresAt,
      },
    }).lease;
    return complete({ leaseDigest: writerLeaseDigest(updated), authority });
  }

  async function projectDraftPullRequest({ plan }) {
    const lease = readLease({ terminal: true });
    let provider = providerSubject();
    if (provider.pullRequest.headSha !== plan.sourceHeadSha) invalid("pull-request head");
    if (!provider.pullRequest.isDraft) {
      execute("gh", ["pr", "ready", "--undo", lease.pullRequestUrl]);
      provider = providerSubject();
    }
    const body = updateWriterLeasePullRequestBody(provider.pullRequest.body, lease);
    if (body !== provider.pullRequest.body) {
      execute("gh", ["pr", "edit", lease.pullRequestUrl, "--body", body]);
      provider = providerSubject();
    }
    if (!provider.pullRequest.isDraft
      || digestValue(parseWriterLeasePullRequestBody(provider.pullRequest.body))
        !== digestValue(projectWriterLeasePullRequestMarker(lease))) invalid("draft projection");
    return complete({ pullRequestDigest: digestValue(provider.pullRequest),
      pullRequestUrl: provider.pullRequest.url });
  }

  async function verifyTerminal({ plan }) {
    const lease = readLease({ terminal: true });
    const provider = providerSubject();
    const cloudStatus = status(lease.cloudAuthority);
    const claim = await successor(plan, new Set(["active"]), cloudStatus);
    const marker = parseWriterLeasePullRequestBody(provider.pullRequest.body);
    if (lease.status !== "active" || lease.reviewHeadSha !== null
      || lease.cloudAuthority.claimId !== claim?.claimId
      || lease.cloudAuthority.reviewRequestId !== null
      || provider.pullRequest.isDraft !== true
      || provider.pullRequest.headSha !== plan.sourceHeadSha
      || git(["rev-parse", "HEAD"]) !== plan.sourceHeadSha
      || remoteHead() !== plan.sourceHeadSha
      || cloudStatus.claims.some(item => item.claimId === plan.sourceClaimId)
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      invalid("terminal proof");
    }
    const values = {
      successorClaimId: claim.claimId,
      successorClaimDigest: claim.fenceRevision,
      leaseDigest: writerLeaseDigest(lease),
      pullRequestDigest: digestValue(provider.pullRequest),
    };
    return complete({ ...values, verificationDigest: digestValue(values) });
  }

  async function reconcilePhase({ intent, phase, plan }) {
    const stored = intent.phases?.[phase]?.values;
    if (phase === "complete") return intent.status === "complete" ? complete(stored) : pending();
    if (phase === "lease_activated") {
      const lease = readLease({ terminal: true });
      const cloudStatus = status(plan.source.authority);
      const claim = await successor(plan, new Set(["active"]), cloudStatus);
      return lease.status === "active"
        && claim
        && !claim.reviewRequestId
        && lease.reviewHeadSha === null
        && lease.cloudAuthority?.claimId === claim.claimId
        && lease.cloudAuthority?.claimDigest === claim.fenceRevision
        && lease.cloudAuthority?.laneRevision === plan.sourceHeadSha
        && lease.cloudAuthority?.writeSetDigest === plan.source.claim.writeSetDigest
        && lease.cloudAuthority?.reviewRequestId === null
        ? complete(stored || { leaseDigest: writerLeaseDigest(lease), authority: lease.cloudAuthority })
        : pending();
    }
    if (phase === "pr_drafted") {
      const lease = readLease({ terminal: true });
      const provider = providerSubject();
      const marker = parseWriterLeasePullRequestBody(provider.pullRequest.body);
      return provider.pullRequest.isDraft
        && provider.pullRequest.headSha === plan.sourceHeadSha
        && digestValue(marker) === digestValue(projectWriterLeasePullRequestMarker(lease))
        ? complete(stored || { pullRequestDigest: digestValue(provider.pullRequest),
          pullRequestUrl: provider.pullRequest.url })
        : pending();
    }
    if (phase === "verified") return verifyTerminal({ plan });
    const cloudStatus = status(plan.source.authority);
    if (phase === "source_retired") {
      return !cloudStatus.claims.some(item => item.claimId === plan.sourceClaimId)
        && await successor(plan, new Set(["waiting-successor", "active"]), cloudStatus)
        ? complete(stored || { sourceClaimId: plan.sourceClaimId,
          retirementDigest: digestValue({ planDigest: plan.planDigest,
            sourceClaimId: plan.sourceClaimId }) }) : pending();
    }
    const accepted = phase === "successor_waiting"
      ? new Set(["waiting-successor", "active"])
      : phase === "successor_current" ? new Set(["active"]) : null;
    if (!accepted) invalid(`reconciliation phase ${phase}`);
    const claim = await successor(plan, accepted, cloudStatus);
    return claim ? complete(stored || successorValues(cloudStatus, claim)) : pending();
  }

  async function withFence(action) {
    mkdirSync(journalDirectory, { recursive: true });
    const lock = acquireFence();
    try { return await action(); } finally { releaseFence(lock); }
  }
  function acquireFence() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomUUID();
      try {
        const descriptor = openSync(lockPath, "wx", 0o600);
        writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
        closeSync(descriptor);
        return Object.freeze({ pid: process.pid, token });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const current = JSON.parse(readFileSync(lockPath, "utf8"));
        if (!Number.isSafeInteger(current?.pid) || typeof current?.token !== "string") {
          invalid("fence record");
        }
        try { process.kill(current.pid, 0); invalid("concurrent fence"); }
        catch (probeError) {
          if (probeError?.code !== "ESRCH") throw probeError;
          unlinkSync(lockPath);
        }
      }
    }
    invalid("fence acquisition");
  }
  function releaseFence(expected) {
    if (!existsSync(lockPath)) return;
    const current = JSON.parse(readFileSync(lockPath, "utf8"));
    if (current.pid !== expected.pid || current.token !== expected.token) invalid("fence ownership");
    unlinkSync(lockPath);
  }
  function readIntent() {
    return existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  }
  function writeIntent({ expected, value }) {
    const current = readIntent();
    if (JSON.stringify(current) !== JSON.stringify(expected)) invalid("journal CAS");
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, statePath);
  }

  return {
    withFence, readSource, readIntent, writeIntent, reconcilePhase,
    createWaitingSuccessor, retireSourceClaim, promoteSuccessor,
    activateLease, projectDraftPullRequest, verifyTerminal,
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
function invalid(label) { throw new Error(`Reviewed-lane source correction ${label} is invalid.`); }
