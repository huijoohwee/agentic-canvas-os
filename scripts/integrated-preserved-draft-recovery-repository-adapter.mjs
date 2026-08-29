import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import {
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "./cloud-authority-handoff-controller.mjs";
import {
  classifyIntegratedReplay,
  classifyPredecessor,
  classifyResumableSuccessor,
  emptyResumableSuccessor,
  normalizeContinuationRequest,
  validateContinuation,
} from "./cloud-authority-handoff-lineage.mjs";
import {
  createScopeExpansionLineageProjectionProof,
} from "./cloud-authority-scope-expansion-lineage-projection.mjs";
import {
  githubLedgerCommandOptions,
  readScopeExpansionLineageLedger,
} from "./cloud-authority-scope-expansion-lineage-migration.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  createIntegratedPreservedDraftRecoveryPlan,
} from "./integrated-preserved-draft-recovery-contract.mjs";
import { captureReviewAheadProjectionEvidence } from
  "./review-ahead-projection-recovery-evidence.mjs";
import {
  authorizeTaskBoundLeaseMutation,
} from "./task-bound-lane-authority-store.mjs";
import { withReviewedLaneEntrypointFence } from "./reviewed-lane-revision-fence.mjs";
import {
  createWriterLeaseStore,
  parseDeviceBranch,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const PULL_REQUEST_FIELDS = [
  "id", "number", "url", "title", "body", "state", "isDraft", "autoMergeRequest",
  "author", "headRefName", "headRefOid", "headRepository", "headRepositoryOwner",
  "baseRefName", "baseRefOid",
].join(",");

export function createRepositoryIntegratedPreservedDraftRecoveryAdapter({
  repository,
  sessionId,
  taskAuthorityFile = null,
  baseAdapter = null,
  leaseStore = null,
  gitText = null,
  ghText = null,
  run = null,
  readProvider = null,
  readLineageLedger = null,
  withFence = withReviewedLaneEntrypointFence,
  now = () => new Date(),
  resolveRealpath = realpathSync,
} = {}) {
  const repoRoot = resolveRealpath(path.resolve(requiredText(repository, "repository")));
  const sourceSessionId = requiredText(sessionId, "sessionId");
  const subprocess = {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  const git = gitText || (argumentsList => execFileSync("git", argumentsList, subprocess));
  const gh = ghText || (argumentsList => execFileSync("gh", argumentsList, subprocess));
  const execute = run || ((command, argumentsList) => (
    execFileSync(command, argumentsList, subprocess)
  ));
  const commonDirectoryValue = requiredText(
    git(["rev-parse", "--git-common-dir"]),
    "Git common directory",
  );
  const commonDirectory = resolveRealpath(path.isAbsolute(commonDirectoryValue)
    ? commonDirectoryValue
    : path.resolve(repoRoot, commonDirectoryValue));
  const capabilityPath = externalTaskAuthorityPath({
    taskAuthorityFile,
    repoRoot,
    commonDirectory,
    resolveRealpath,
  });
  const handoffAdapter = baseAdapter
    || createRepositoryCloudAuthorityHandoffControllerAdapter({
      repository: repoRoot,
      sessionId: sourceSessionId,
      taskAuthorityFile: capabilityPath,
      gitText: argumentsList => git(argumentsList),
      ghText: argumentsList => gh(argumentsList),
      run: execute,
      resolveRealpath,
    });
  const providerReader = readProvider || (reference => JSON.parse(gh([
    "pr", "view", reference, "--json", PULL_REQUEST_FIELDS,
  ])));
  const lineageLedgerReader = readLineageLedger || (ledgerRepository => (
    readScopeExpansionLineageLedger({
      ledgerRepository,
      ghText: argumentsList => execFileSync(
        "gh",
        argumentsList,
        githubLedgerCommandOptions(repoRoot),
      ),
    })
  ));
  let authorityStore = leaseStore;

  function store() {
    if (authorityStore) return authorityStore;
    authorityStore = createWriterLeaseStore({
      gitCommonDir: commonDirectory,
      taskAuthorityFile: capabilityPath,
      taskAuthorityPolicy: "required",
    });
    return authorityStore;
  }

  async function readState({ branch, sessionId: requestedSessionId = sourceSessionId } = {}) {
    const sourceBranch = requiredText(branch, "branch");
    if (!parseDeviceBranch(sourceBranch)) {
      throw new Error("Integrated-preserved draft recovery requires a canonical branch.");
    }
    if (requestedSessionId !== sourceSessionId) {
      throw new Error("Integrated-preserved draft recovery source session changed.");
    }
    let capturedActor = null;
    const evidenceAdapter = Object.freeze({
      ...handoffAdapter,
      async readAuthenticatedOwner() {
        capturedActor = await handoffAdapter.readAuthenticatedOwner();
        return capturedActor;
      },
    });
    const captured = await captureReviewAheadProjectionEvidence({
      adapter: evidenceAdapter,
      branch: sourceBranch,
      sessionId: sourceSessionId,
    });
    if (!capturedActor) {
      throw new Error("Integrated-preserved draft recovery did not capture an authenticated owner.");
    }
    const provider = await providerReader(captured.lane.pullRequest.url);
    assertProviderMatchesCapturedLane(provider, captured.lane);
    const requiresLineageProof = captured.claim?.leaseEpoch === 1
      && Boolean(captured.claim.predecessorClaimId);
    const lineageLedger = requiresLineageProof
      ? await lineageLedgerReader(captured.lane.authority.ledgerRepository)
      : null;
    const continuation = classifyContinuation({
      lane: captured.lane,
      actor: capturedActor,
      status: captured.status,
      sessionId: sourceSessionId,
      lineageLedger,
      observedAt: now(),
    });
    assertOnlyDraftProjectionFinding({
      findings: continuation.findings,
      isDraft: provider.isDraft,
    });
    const providerIdentity = stableProviderIdentity(provider);
    const authority = captured.lane.authority;
    const lease = captured.lane.lease;
    const claim = captured.claim;
    if (!lease.taskAuthority?.bindingDigest) {
      throw new Error("Integrated-preserved draft recovery requires task-bound lane authority.");
    }
    const localMarker = projectWriterLeasePullRequestMarker(lease);
    if (!captured.lane.remoteLease
        || digestValue(localMarker) !== digestValue(captured.lane.remoteLease)) {
      throw new Error(
        "Integrated-preserved draft recovery requires the exact task-bound owner marker.",
      );
    }
    return Object.freeze({
      repository: repoRoot,
      repositoryId: captured.evidence.repositoryId,
      targetRepository: authority.targetRepository,
      branch: sourceBranch,
      sessionId: sourceSessionId,
      deviceId: lease.device,
      actorLogin: captured.evidence.actorLogin,
      clean: captured.evidence.clean,
      baseSha: captured.lane.baseSha,
      localHeadSha: captured.evidence.localHeadSha,
      remoteHeadSha: captured.evidence.remoteHeadSha,
      reviewHeadSha: captured.evidence.reviewHeadSha,
      leaseStatus: lease.status,
      leaseSessionId: lease.sessionId,
      leaseEpoch: lease.epoch,
      localLeaseDigest: writerLeaseDigest(lease),
      taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      localAuthorityState: authority.state,
      localAuthorityClaimId: authority.claimId,
      localAuthorityLaneRevision: authority.laneRevision,
      localAuthorityReviewRequestId: authority.reviewRequestId,
      localAuthorityWriteSetDigest: authority.writeSetDigest,
      localAuthorityLeaseEpoch: authority.leaseEpoch,
      localAuthorityDigest: digestValue(authority),
      remoteClaimId: claim.claimId,
      remoteClaimState: claim.state,
      remoteClaimWriteAuthority: claim.writeAuthority,
      remoteClaimScopeReserved: claim.scopeReserved,
      remoteClaimRepositoryId: claim.repositoryId,
      remoteClaimCanonicalBaseSha: claim.canonicalBaseRevision,
      remoteClaimLaneRevision: claim.laneRevision,
      remoteClaimReviewRequestId: claim.reviewRequestId,
      remoteClaimWriteSetDigest: claim.writeSetDigest,
      remoteClaimLeaseEpoch: claim.leaseEpoch,
      remoteClaimTransitionCounter: claim.transitionCounter,
      remoteClaimOperationReceiptDigest: claim.operationReceiptDigest,
      remoteClaimIntegrationReceiptDigest: claim.integrationReceiptDigest,
      remoteClaimIntegrationDigest: digestValue(claim.integration),
      remoteClaimDigest: digestValue(claim),
      continuationSubjectDigest: continuation.subjectDigest,
      scopeExpansionLineageIdentityDigest:
        continuation.lineageProof?.lineageIdentityDigest || null,
      scopeExpansionSourceClaimId:
        continuation.lineageProof?.sourceClaimId || null,
      scopeExpansionTargetGenesisEntryDigest:
        continuation.lineageProof?.targetGenesisEntryDigest || null,
      scopeExpansionSourceRetirementEntryDigest:
        continuation.lineageProof?.sourceRetirementEntryDigest || null,
      pullRequestId: requiredText(provider.id, "pull-request ID"),
      pullRequestNumber: provider.number,
      pullRequestUrl: requiredText(provider.url, "pull-request URL"),
      pullRequestState: requiredText(provider.state, "pull-request state"),
      pullRequestDraft: requiredBoolean(provider.isDraft, "pull-request draft state"),
      pullRequestAutoMergeArmed: provider.autoMergeRequest != null,
      pullRequestAuthorLogin: requiredText(provider.author?.login, "pull-request author"),
      pullRequestHeadRepository: requiredText(
        provider.headRepository?.nameWithOwner,
        "pull-request head repository",
      ),
      pullRequestHeadOwnerLogin: requiredText(
        provider.headRepositoryOwner?.login,
        "pull-request head owner",
      ),
      pullRequestHeadBranch: requiredText(provider.headRefName, "pull-request head branch"),
      pullRequestHeadSha: requiredText(provider.headRefOid, "pull-request head SHA"),
      pullRequestBaseBranch: requiredText(provider.baseRefName, "pull-request base branch"),
      pullRequestBaseSha: requiredText(provider.baseRefOid, "pull-request base SHA"),
      pullRequestBodyDigest: digestValue(provider.body),
      pullRequestProviderIdentityDigest: digestValue(providerIdentity),
      remoteLeaseDigest: digestValue(captured.lane.remoteLease),
    });
  }

  function authorizeTask({ state, planDigest }) {
    const branch = state.branch;
    const lease = store().read(branch);
    if (!lease || writerLeaseDigest(lease) !== state.localLeaseDigest
        || lease.taskAuthority?.bindingDigest !== state.taskAuthorityBindingDigest) {
      throw new Error("Task-bound writer lease changed before provider projection.");
    }
    return authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath,
      operation: `integrated-preserved-draft-recovery:${planDigest}:provider-ready`,
      now: now(),
    });
  }

  function withOperationFence({ state, planDigest }, action) {
    return withFence({
      leaseStore: store(),
      branch: state.branch,
      entrypoint: "integrated-preserved-draft-recovery",
      operationDigest: planDigest,
      expectedLeaseDigest: state.localLeaseDigest,
      expectedClaimId: state.localAuthorityClaimId,
    }, action);
  }

  async function projectPullRequestReady({ state, planDigest }) {
    const normalizedPlanDigest = requiredDigest(planDigest, "plan digest");
    const sourcePlan = createIntegratedPreservedDraftRecoveryPlan(state);
    if (sourcePlan.status !== "planned" || sourcePlan.planDigest !== normalizedPlanDigest
        || !sourcePlan.observation.pullRequestDraft) {
      throw new Error("Provider ready projection does not match the sealed draft plan.");
    }
    const fresh = await readState({ branch: state.branch, sessionId: state.sessionId });
    const freshPlan = createIntegratedPreservedDraftRecoveryPlan(fresh);
    if (freshPlan.status !== "planned" || freshPlan.planDigest !== normalizedPlanDigest
        || !freshPlan.observation.pullRequestDraft) {
      throw new Error("Provider ready projection drifted before mutation.");
    }
    const output = execute("gh", ["pr", "ready", fresh.pullRequestUrl]);
    const core = Object.freeze({
      schema: "agentic-integrated-preserved-provider-ready-operation/v1",
      planDigest: normalizedPlanDigest,
      pullRequestId: fresh.pullRequestId,
      pullRequestUrl: fresh.pullRequestUrl,
      providerCommand: "pull-request-ready",
    });
    return Object.freeze({
      ...core,
      outputObserved: String(output ?? "").length > 0,
      operationDigest: digestValue(core),
    });
  }

  return Object.freeze({
    readState,
    authorizeTask,
    withOperationFence,
    projectPullRequestReady,
  });
}

function classifyContinuation({
  lane,
  actor,
  status,
  sessionId,
  lineageLedger,
  observedAt,
}) {
  const request = normalizeContinuationRequest({
    transition: "reclaim",
    branch: lane.branch,
    sessionId,
    successorSessionId: sessionId,
    successorDeviceId: lane.lease.device,
    ttlSeconds: 1800,
  });
  const candidate = status?.claims?.find(
    claim => claim?.claimId === lane.authority.claimId,
  );
  const lineageProof = candidate?.leaseEpoch === 1 && candidate.predecessorClaimId
    ? createScopeExpansionLineageProjectionProof({
      lane, actor, status, ledger: lineageLedger, request, now: observedAt,
    })
    : null;
  const predecessor = classifyPredecessor({
    lane, actor, status, request, lineageProjectionProof: lineageProof,
  });
  const integratedReplay = classifyIntegratedReplay({
    request,
    lane,
    actor,
    status,
    predecessor,
  });
  const successor = integratedReplay.applicable
    ? emptyResumableSuccessor()
    : classifyResumableSuccessor({ request, lane, actor, status, predecessor });
  const findings = validateContinuation({
    request,
    lane,
    actor,
    status,
    predecessor,
    successor,
    integratedReplay,
    lineageProjectionProof: lineageProof,
  });
  const subject = Object.freeze({
    request,
    predecessor,
    integratedReplay,
    successor,
    scopeExpansionLineageIdentityDigest: lineageProof?.lineageIdentityDigest || null,
  });
  return Object.freeze({
    findings,
    lineageProof,
    observedAt,
    subjectDigest: digestValue(subject),
  });
}

function assertOnlyDraftProjectionFinding({ findings, isDraft }) {
  const types = findings.map(item => item.type);
  const expected = isDraft ? ["review-projection-not-ready"] : [];
  if (JSON.stringify(types) !== JSON.stringify(expected)) {
    throw new Error(
      `Integrated-preserved draft recovery has unrelated findings: ${types.join(",") || "none"}.`,
    );
  }
}

function assertProviderMatchesCapturedLane(provider, lane) {
  const captured = lane.pullRequest;
  const exact = provider?.id === captured.id
    && provider.url === captured.url
    && provider.state === captured.state
    && provider.isDraft === captured.isDraft
    && provider.autoMergeRequest === captured.autoMergeRequest
    && provider.headRefName === captured.headRefName
    && provider.headRefOid === captured.headRefOid
    && provider.baseRefName === captured.baseRefName
    && provider.body === captured.body
    && provider.author?.login === captured.authorLogin;
  if (!exact) throw new Error("Pull-request identity changed during exact-state capture.");
}

function stableProviderIdentity(provider) {
  return Object.freeze({
    id: provider.id,
    number: provider.number,
    url: provider.url,
    title: provider.title,
    bodyDigest: digestValue(provider.body),
    state: provider.state,
    autoMergeRequest: provider.autoMergeRequest,
    authorLogin: provider.author?.login,
    headRefName: provider.headRefName,
    headRefOid: provider.headRefOid,
    headRepository: provider.headRepository?.nameWithOwner,
    headRepositoryOwnerLogin: provider.headRepositoryOwner?.login,
    baseRefName: provider.baseRefName,
    baseRefOid: provider.baseRefOid,
  });
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function requiredDigest(value, label) {
  const text = requiredText(value, label);
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`${label} must be a digest.`);
  return text;
}

function externalTaskAuthorityPath({
  taskAuthorityFile,
  repoRoot,
  commonDirectory,
  resolveRealpath,
}) {
  if (taskAuthorityFile === null || taskAuthorityFile === undefined) return null;
  const source = requiredText(taskAuthorityFile, "task-authority capability path");
  if (!path.isAbsolute(source)) {
    throw new Error("Task-authority capability path must be absolute.");
  }
  const capabilityPath = resolveRealpath(source);
  if (pathIsInside(repoRoot, capabilityPath) || pathIsInside(commonDirectory, capabilityPath)) {
    throw new Error(
      "Task-authority capability must remain outside the repository and Git common directory.",
    );
  }
  return capabilityPath;
}

function pathIsInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
