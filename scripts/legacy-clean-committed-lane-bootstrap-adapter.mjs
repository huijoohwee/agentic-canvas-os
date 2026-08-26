import { existsSync, mkdirSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import path from "node:path";
import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { bindAdmissionCloudAuthority, claimLegacyReviewAdmissionCloudAuthority, invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeCloudAuthority } from "./scoped-lane-admission-lib.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { assertTaskAuthorityBinding, canonicalJson } from "./task-bound-lane-authority-contract.mjs";
import { authorizeTaskBoundLeaseMutation, createTaskAuthorityLeaseBinding,
  readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { checkpointPath, createLegacyBootstrapRecoveryRequest, createDraftPullRequest,
  createIdentity, diffPaths, ensureDraftOwnershipPullRequest, findOpenPullRequest, git, gitExitCode, gitText, ghText, listScopeOwners, listedWorktrees, lsRemoteHead, nextLeaseEpoch,
  persistProjectedOutput, phaseOutput, findRecoverableLegacyBootstrapClaim, findLegacyBootstrapCheckpointClaim, findLegacyReviewCurrentBaseCandidate, legacyBootstrapAdmissionManifest, projectRecoveredLegacyBootstrapResult, projectionBaseSha,
  proveLegacyReviewCanonicalDescendant, pullRequestNumber, readCurrentClaimInventory, readJson, requireRecoveredLegacyBootstrapClaim, requireLease, resolveAuthoredHeadSha, updatePullRequestBody,
  writeJson } from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";
export async function createLegacyBootstrapAdapter({ requestPath } = {}) {
  const bootstrapRequest = readJson(path.resolve(String(requestPath || "")));
  const worktreePath = path.resolve(String(bootstrapRequest?.worktreePath || ""));
  const repository = gitText(["rev-parse", "--show-toplevel"], { cwd: worktreePath });
  const gitCommonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd: worktreePath });
  const gitCommonDir = path.isAbsolute(gitCommonDirRaw) ? gitCommonDirRaw : path.resolve(repository, gitCommonDirRaw);
  const stateDir = path.join(gitCommonDir, "agentic-canvas-os", "legacy-clean-bootstrap");
  mkdirSync(stateDir, { recursive: true });
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
  return {
    inspectLane: request => inspectLane({ request, repository, leaseStore, stateDir }), readCheckpoint: identityDigest => readCheckpoint({ identityDigest, stateDir }),
    writeCheckpoint: checkpoint => writeCheckpoint({ checkpoint, stateDir }), verifyFinal: context => verifyFinal({ context, repository, leaseStore, stateDir }),
    claimCloudAuthority: context => claimCloudAuthority({ context, repository, leaseStore, stateDir }),
    claimLocalLease: context => claimLocalLease({ context, repository, leaseStore, stateDir }), publishExactBranch: context => publishExactBranch({ context, repository, stateDir }),
    createDraftOwnershipRequest: context => createDraftOwnershipRequest({ context, repository, leaseStore, stateDir }),
    bindCloudAuthority: context => bindCloudAuthority({ context, repository, leaseStore, stateDir }), projectOwnerReceipt: context => projectOwnerReceipt({ context, repository, leaseStore, stateDir }),
  };
}
function inspectLane({ request, repository, leaseStore, stateDir }) {
  const worktreePath = path.resolve(request.worktreePath);
  const headSha = gitText(["rev-parse", "HEAD"], { cwd: worktreePath });
  const treeSha = gitText(["rev-parse", `${headSha}^{tree}`], { cwd: worktreePath });
  const authoredHeadSha = resolveAuthoredHeadSha({ branch: request.branch, headSha,
    leaseStore, worktreePath });
  const changedPaths = diffPaths({ cwd: worktreePath, from: request.expectedBaseSha,
    to: authoredHeadSha });
  const identity = createIdentity({ request, headSha, treeSha, changedPaths });
  const checkpoint = readCheckpoint({ identityDigest: identity.identityDigest, stateDir });
  const pullRequest = findOpenPullRequest({ branch: request.branch, repository });
  const { claims: claimInventory } = readCurrentClaimInventory({ request });
  const projectedClaimIds = projectedLegacyBootstrapClaimIds(
    checkpoint,
    leaseStore.read(request.branch),
    { claims: claimInventory, request },
  );
  const canonicalBaseSha = projectionBaseSha({ headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha, worktreePath: request.worktreePath });
  const recoverableClaim = findRecoverableLegacyBootstrapClaim({ claims: claimInventory,
    request, checkpoint, identity, canonicalBaseSha });
  return {
    clean: gitText(["status", "--short"], { cwd: worktreePath }) === "",
    registeredWorktree: listedWorktrees(repository).includes(worktreePath),
    attachedBranch: gitText(["branch", "--show-current"], { cwd: worktreePath }),
    worktreePath,
    baseSha: request.expectedBaseSha,
    headSha,
    treeSha,
    baseIsAncestor: gitExitCode(["merge-base", "--is-ancestor", request.expectedBaseSha, headSha], { cwd: worktreePath }) === 0,
    changedPaths,
    competingScopeOwners: listScopeOwners({
      branch: request.branch,
      semanticScope: request.semanticScope,
      repository,
    }),
    overlappingClaims: claimInventory
      .filter(claim => !projectedClaimIds.has(claim.claimId))
      .filter(claim => claim.claimId !== recoverableClaim?.claimId)
      .filter(claim => claim.state !== "parked" && claim.state !== "waiting-successor")
      .filter(claim => writeSetsOverlap(claim.declaredWriteScope, request.declaredWriteScope))
      .map(claim => claim.claimId),
    projections: {
      ...(checkpoint?.outputs || {}),
      ...(pullRequest ? { pullRequestState: pullRequest } : {}),
    },
  };
}
export function projectedLegacyBootstrapClaimIds(
  checkpoint,
  lease = null,
  { claims = [], request = null } = {},
) {
  const claimIds = [
    checkpoint?.outputs?.cloudClaim?.authority?.claimId,
    checkpoint?.outputs?.boundAuthority?.authority?.claimId,
  ];
  try {
    const continuation = requireCurrentLegacyBootstrapTaskBindingContinuation({ lease });
    if (
      continuation.bootstrapIdentityDigest === checkpoint?.identity?.identityDigest
      && continuation.branch === lease.branch
      && continuation.preservedHeadSha === checkpoint?.identity?.headSha
      && continuation.preservedTreeSha === checkpoint?.identity?.treeSha
    ) {
      claimIds.push(continuation.targetClaimId);
    }
  } catch {
    // An unattributed or malformed local continuation never grants claim attribution.
  }
  try {
    const reconciliation = normalizeLegacyBootstrapFinalAuthorityReconciliation(
      checkpoint?.outputs?.finalAuthorityReconciliation,
    );
    if (
      reconciliation.status !== "adopted"
      && writerLeaseDigest(lease) === reconciliation.intent.sourceLeaseDigest
    ) {
      requireLegacyBootstrapFinalAuthorityIntent({
        intent: reconciliation.intent,
        context: { identity: checkpoint.identity, request },
        lease,
      });
      const candidate = findLegacyReviewCurrentBaseCandidate({
        claims,
        request,
        targetBaseSha: reconciliation.intent.reviewBaseSha,
        allowedReviewRequestIds: [null, reconciliation.intent.reviewRequestId],
        sourceAuthority: lease.cloudAuthority,
        canonicalDescendantProof: reconciliation.intent.successorProofDigest
          ? reconciliation.intent.protectedBaseProof
          : null,
      });
      if (candidate && (
        reconciliation.resolvedClaimId === null
        || reconciliation.resolvedClaimId === candidate.claimId
      )) {
        claimIds.push(candidate.claimId);
      }
    }
  } catch {
    // A pending final claim is attributable only through its authenticated exact intent.
  }
  return new Set(claimIds.filter(Boolean));
}
function readCheckpoint({ identityDigest, stateDir }) {
  const filePath = checkpointPath({ identityDigest, stateDir });
  if (!existsSync(filePath)) return null;
  return readJson(filePath);
}
function writeCheckpoint({ checkpoint, stateDir }) {
  writeJson(checkpointPath({
    identityDigest: checkpoint?.identity?.identityDigest,
    stateDir,
  }), checkpoint);
}
function claimCloudAuthority({ context, leaseStore, stateDir }) {
  const request = context.request;
  const leaseEpoch = 1;
  const canonicalBaseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const manifest = admissionManifest(request);
  const inventory = readCurrentClaimInventory({ request });
  const recoverableClaim = findRecoverableLegacyBootstrapClaim({
    claims: inventory.claims,
    request,
    checkpoint: context.checkpoint,
    identity: context.identity,
    canonicalBaseSha,
  });
  const claim = recoverableClaim
    ? adoptRecoverableCloudClaim({
      recoverableClaim,
      inventory,
      request,
      identity: context.identity,
      manifest,
      canonicalBaseSha,
    })
    : claimLegacyReviewAdmissionCloudAuthority({
      ledgerRepository: request.ledgerRepository,
      targetRepository: request.targetRepository,
      manifest,
      canonicalBaseSha,
      branch: request.branch,
      headSha: request.expectedHeadSha,
      deviceId: request.deviceId,
      sessionId: request.sessionId,
      leaseEpoch,
    });
  const output = phaseOutput("cloudClaim", context.identity.identityDigest, {
    branch: request.branch,
    leaseEpoch,
    authority: claim.authority,
    verification: claim.verification,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}
function adoptRecoverableCloudClaim({
  recoverableClaim,
  inventory,
  request,
  identity,
  manifest,
  canonicalBaseSha,
}) {
  let recoveredResult;
  if (recoverableClaim.state === "dormant-preserved") {
    const recoveryRequest = createLegacyBootstrapRecoveryRequest({
      claim: recoverableClaim,
      request,
      identity,
    });
    try {
      recoveredResult = invokeRepositoryCloudAction({
        action: "continue",
        ledgerRepository: request.ledgerRepository,
        request: recoveryRequest,
      });
    } catch (originalError) {
      try {
        const observed = readCurrentClaimInventory({ request });
        const recoveredClaim = observed.claims.find(
          claim => claim.claimId === recoverableClaim.claimId,
        );
        requireRecoveredLegacyBootstrapClaim({
          claim: recoveredClaim,
          sourceClaim: recoverableClaim,
          request,
          identity,
          canonicalBaseSha,
        });
        recoveredResult = projectRecoveredLegacyBootstrapResult({
          statusResult: observed.result,
          claim: recoveredClaim,
        });
      } catch (recoveryError) {
        throw new Error(
          `${originalError.message}; exact legacy bootstrap response-loss adoption failed: ${recoveryError.message}`,
          { cause: originalError },
        );
      }
    }
    requireRecoveredLegacyBootstrapClaim({
      claim: recoveredResult.claim,
      sourceClaim: recoverableClaim,
      request,
      identity,
      canonicalBaseSha,
    });
  } else if (recoverableClaim.transitionCounter >= 2) {
    recoveredResult = projectRecoveredLegacyBootstrapResult({
      statusResult: inventory.result,
      claim: recoverableClaim,
    });
  } else {
    return claimLegacyReviewAdmissionCloudAuthority({
      ledgerRepository: request.ledgerRepository,
      targetRepository: request.targetRepository,
      manifest,
      canonicalBaseSha,
      branch: request.branch,
      headSha: request.expectedHeadSha,
      deviceId: request.deviceId,
      sessionId: request.sessionId,
      leaseEpoch: 1,
    });
  }
  const recoveredAuthority = normalizeCloudAuthority({
    ledgerRepository: request.ledgerRepository,
    targetRepository: request.targetRepository,
    result: recoveredResult,
  }, { manifest, canonicalBaseSha });
  const verified = verifyAdmissionCloudAuthority({
    authority: recoveredAuthority,
    manifest,
    canonicalBaseSha,
  });
  return bindAdmissionCloudAuthority({
    authority: verified.authority,
    manifest,
    branch: request.branch,
    headSha: request.expectedHeadSha,
    deviceId: request.deviceId,
    sessionId: request.sessionId,
    returnVerification: true,
  });
}
function claimLocalLease({ context, leaseStore, stateDir }) {
  const request = context.request;
  const baseSha = projectionBaseSha({
    headSha: request.expectedHeadSha, requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath });
  const currentPullRequest = findOpenPullRequest({
    branch: request.branch,
    repository: path.resolve(request.worktreePath),
  });
  const lease = leaseStore.claim({
    sessionId: request.sessionId,
    device: request.deviceId,
    scope: request.semanticScope,
    branch: request.branch,
    worktreePath: request.worktreePath,
    baseSha,
    previousEpoch: nextLeaseEpoch({ branch: request.branch, leaseStore }) - 1,
  });
  const annotated = leaseStore.annotate({
    sessionId: request.sessionId,
    branch: request.branch,
    values: {
      fenceSha: request.expectedHeadSha,
      ...(currentPullRequest ? { pullRequestUrl: currentPullRequest.url } : {}),
    },
  });
  const output = phaseOutput("localLease", context.identity.identityDigest, {
    branch: request.branch,
    lease: annotated,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}
function publishExactBranch({ context, repository, stateDir }) {
  const request = context.request;
  git(["push", "--set-upstream", "origin", request.branch], { cwd: request.worktreePath });
  const remoteHeadSha = lsRemoteHead({
    repository,
    branch: request.branch,
  });
  if (remoteHeadSha !== request.expectedHeadSha) {
    throw new Error(`Legacy bootstrap push published ${remoteHeadSha || "missing"} instead of ${request.expectedHeadSha}.`);
  }
  const output = phaseOutput("remoteBranch", context.identity.identityDigest, {
    branch: request.branch,
    remoteHeadSha,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}
function createDraftOwnershipRequest({ context, repository, leaseStore, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  const existing = findOpenPullRequest({ branch: request.branch, repository });
  const url = existing?.url || createDraftPullRequest({
    branch: request.branch,
    title: gitText(["log", "-1", "--pretty=%s"], { cwd: request.worktreePath }),
    body: updateWriterLeasePullRequestBody("", lease),
    repository,
  });
  const pullRequest = ensureDraftOwnershipPullRequest({
    url,
    branch: request.branch,
    expectedHeadSha: request.expectedHeadSha,
    repository,
  });
  const updatedLease = leaseStore.annotate({
    sessionId: request.sessionId,
    branch: request.branch,
    values: { pullRequestUrl: pullRequest.url },
  });
  updatePullRequestBody({
    url: pullRequest.url,
    body: updateWriterLeasePullRequestBody(pullRequest.body, updatedLease),
    repository,
  });
  const verified = readOwnershipPullRequest({
    url: pullRequest.url,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const output = phaseOutput("pullRequest", context.identity.identityDigest, {
    branch: request.branch,
    pullRequest: {
      url: verified.url,
      number: pullRequestNumber(verified.url),
      isDraft: verified.isDraft,
      headRefOid: verified.headRefOid,
    },
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}
function bindCloudAuthority({ context, leaseStore, repository, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  if (!lease.pullRequestUrl) {
    throw new Error("Legacy bootstrap bind requires an ownership pull request URL.");
  }
  const priorAuthority = context.checkpoint?.outputs?.cloudClaim?.authority;
  if (!priorAuthority) {
    throw new Error("Legacy bootstrap bind requires the claimed cloud authority output.");
  }
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  if (pullRequest.headRefOid !== request.expectedHeadSha) {
    throw new Error("Legacy bootstrap bind requires the exact preserved pull-request head.");
  }
  const reviewRequestId = `github-pull-request:${pullRequest.id}`;
  const repair = initialCloudProjectionTaskBindingRepair({
    lease,
    request,
    repository,
    sourceBaseSha: priorAuthority.canonicalBaseSha,
  });
  const current = resolveCheckpointCloudAuthority({
    context,
    request,
    canonicalBaseSha: priorAuthority.canonicalBaseSha,
    reviewRequestId,
  });
  const bound = current.authority.reviewRequestId === reviewRequestId
    ? current
    : repair && lease.cloudAuthority
    ? verifyAdmissionCloudAuthority({ authority: lease.cloudAuthority,
      manifest: admissionManifest(request), canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha })
    : bindAdmissionCloudAuthority({ authority: current.authority, manifest: admissionManifest(request),
      branch: request.branch, headSha: request.expectedHeadSha,
      pullRequestNumber: pullRequestNumber(lease.pullRequestUrl), deviceId: request.deviceId,
      sessionId: request.sessionId, returnVerification: true });
  const output = phaseOutput("boundAuthority", context.identity.identityDigest, {
    branch: request.branch,
    authority: bound.authority,
    verification: bound.verification,
    ...(repair ? { canonicalDescendantProof: repair.proof } : {}),
    ...(repair ? { taskBindingContinuationProof: repair.proof } : {}),
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function resolveCheckpointCloudAuthority({
  context,
  request,
  canonicalBaseSha,
  reviewRequestId,
}) {
  const manifest = admissionManifest(request);
  let inventory = readCurrentClaimInventory({ request });
  let claim = findLegacyBootstrapCheckpointClaim({
    claims: inventory.claims,
    request,
    checkpoint: context.checkpoint,
    identity: context.identity,
    canonicalBaseSha,
    allowedReviewRequestIds: [null, reviewRequestId],
  });
  if (!claim) {
    throw new Error("Legacy bootstrap bind could not resolve its exact checkpoint cloud claim.");
  }
  let result;
  if (claim.state === "dormant-preserved") {
    const recoveryRequest = createLegacyBootstrapRecoveryRequest({
      claim,
      request,
      identity: context.identity,
    });
    try {
      result = invokeRepositoryCloudAction({
        action: "continue",
        ledgerRepository: request.ledgerRepository,
        request: recoveryRequest,
      });
    } catch (originalError) {
      inventory = readCurrentClaimInventory({ request });
      const recovered = inventory.claims.find(candidate => candidate.claimId === claim.claimId);
      try {
        requireRecoveredLegacyBootstrapClaim({
          claim: recovered,
          sourceClaim: claim,
          request,
          identity: context.identity,
          canonicalBaseSha,
          expectedLaneRevision: request.expectedHeadSha,
          expectedReviewRequestId: claim.reviewRequestId,
        });
        result = projectRecoveredLegacyBootstrapResult({
          statusResult: inventory.result,
          claim: recovered,
        });
      } catch (recoveryError) {
        throw new Error(
          `${originalError.message}; exact checkpoint cloud recovery failed: ${recoveryError.message}`,
          { cause: originalError },
        );
      }
    }
    requireRecoveredLegacyBootstrapClaim({
      claim: result.claim,
      sourceClaim: claim,
      request,
      identity: context.identity,
      canonicalBaseSha,
      expectedLaneRevision: request.expectedHeadSha,
      expectedReviewRequestId: claim.reviewRequestId,
    });
  } else {
    result = projectRecoveredLegacyBootstrapResult({
      statusResult: inventory.result,
      claim,
    });
  }
  const authority = normalizeLegacyBootstrapLiveAuthority({
    result,
    seedAuthority: context.checkpoint.outputs.cloudClaim.authority,
    manifest,
    request,
    canonicalBaseSha,
    expectedLaneRevision: request.expectedHeadSha,
  });
  return verifyAdmissionCloudAuthority({ authority, manifest, canonicalBaseSha });
}

export function normalizeLegacyBootstrapLiveAuthority({
  result,
  seedAuthority,
  manifest,
  request,
  canonicalBaseSha,
  expectedLaneRevision,
}) {
  const authority = {
    ...(seedAuthority || {}),
    ledgerRepository: seedAuthority?.ledgerRepository || request?.ledgerRepository,
    targetRepository: seedAuthority?.targetRepository || request?.targetRepository,
    deviceId: request?.deviceId,
    sessionId: request?.sessionId,
  };
  const normalized = normalizeBoundAuthority({
    result,
    authority,
    manifest,
    deviceId: request?.deviceId,
    sessionId: request?.sessionId,
    focusedEvidenceDigest: null,
  });
  if (
    normalized.state !== "active"
    || normalized.canonicalBaseSha !== canonicalBaseSha
    || normalized.laneRevision !== expectedLaneRevision
    || normalized.writeSetDigest !== manifest?.writeSetDigest
    || JSON.stringify(normalized.cloudDeclaredWriteScope)
      !== JSON.stringify(manifest?.declaredWriteSet)
  ) {
    throw new Error("Legacy bootstrap live cloud authority drifted from its exact authored subject.");
  }
  return normalized;
}

export function recoverDormantLegacyBootstrapClaim({
  claim,
  request,
  identity,
  canonicalBaseSha,
  expectedLaneRevision,
  expectedReviewRequestId,
}, dependencies = {
  continueCloud: ({ ledgerRepository, recoveryRequest }) => invokeRepositoryCloudAction({
    action: "continue",
    ledgerRepository,
    request: recoveryRequest,
  }),
  readInventory: readCurrentClaimInventory,
}) {
  const recoveryRequest = createLegacyBootstrapRecoveryRequest({
    claim,
    request,
    identity,
  });
  let statusResult;
  try {
    statusResult = dependencies.continueCloud({
      ledgerRepository: request.ledgerRepository,
      recoveryRequest,
    });
  } catch (originalError) {
    try {
      const observed = dependencies.readInventory({ request });
      const recoveredClaim = observed.claims.find(candidate => candidate.claimId === claim.claimId);
      requireRecoveredLegacyBootstrapClaim({
        claim: recoveredClaim,
        sourceClaim: claim,
        request,
        identity,
        canonicalBaseSha,
        expectedLaneRevision,
        expectedReviewRequestId,
      });
      return Object.freeze({ claim: recoveredClaim, statusResult: observed.result });
    } catch (recoveryError) {
      throw new Error(
        `${originalError.message}; exact dormant legacy bootstrap recovery failed: ${recoveryError.message}`,
        { cause: originalError },
      );
    }
  }
  requireRecoveredLegacyBootstrapClaim({
    claim: statusResult.claim,
    sourceClaim: claim,
    request,
    identity,
    canonicalBaseSha,
    expectedLaneRevision,
    expectedReviewRequestId,
  });
  return Object.freeze({ claim: statusResult.claim, statusResult });
}
function projectOwnerReceipt({ context, leaseStore, repository, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  if (!lease.pullRequestUrl) {
    throw new Error("Legacy bootstrap owner projection requires an ownership pull request.");
  }
  const verification = context.checkpoint?.outputs?.boundAuthority?.verification;
  const authority = context.checkpoint?.outputs?.boundAuthority?.authority;
  if (!authority || !verification) {
    throw new Error("Legacy bootstrap owner projection requires the bound authority output.");
  }
  const admission = createAdmissionProjection({
    request,
    lease,
    authority,
    verification,
  });
  const repairProof = context.checkpoint?.outputs?.boundAuthority?.taskBindingContinuationProof
    || context.checkpoint?.outputs?.boundAuthority?.canonicalDescendantProof;
  const baseSha = repairProof ? authority.canonicalBaseSha : projectionBaseSha({
    headSha: request.expectedHeadSha, requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath });
  const values = legacyBootstrapLeaseProjectionValues({ baseSha,
    headSha: request.expectedHeadSha, pullRequestUrl: lease.pullRequestUrl,
    admission, authority, verifiedAt: verification.verifiedAt });
  const adopted = adoptLegacyBootstrapTaskBindingContinuation({
    lease,
    request,
    values,
    repairProof,
    bootstrapIdentityDigest: context.identity.identityDigest,
  });
  let ownerProjection;
  if (adopted) ownerProjection = adopted;
  else if (lease.taskAuthority && taskBindingMatchesNullCloud(lease)) {
    if (!repairProof) {
      throw new Error("Legacy bootstrap task-bound cloud projection requires its exact base proof.");
    }
    ownerProjection = projectCloudAuthorityAndTaskBinding({
      leaseStore,
      lease,
      request,
      values,
      repairProof,
      bootstrapIdentityDigest: context.identity.identityDigest,
    });
  } else if (lease.taskAuthority) {
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    if (lease.cloudAuthority?.claimId !== authority.claimId) {
      throw new Error("Legacy bootstrap task-bound lease cannot annotate a different cloud claim.");
    }
    ownerProjection = { lease: leaseStore.annotate({ sessionId: request.sessionId,
      branch: request.branch, values }), continuationReceipt: null };
  } else ownerProjection = { lease: leaseStore.annotate({ sessionId: request.sessionId,
    branch: request.branch, values }), continuationReceipt: null };
  const annotated = ownerProjection.lease;
  const pullRequest = readOwnershipPullRequest({
    url: annotated.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const body = updateWriterLeasePullRequestBody(pullRequest.body, annotated);
  updatePullRequestBody({
    url: annotated.pullRequestUrl,
    body,
    repository,
  });
  const projectedPullRequest = readOwnershipPullRequest({
    url: annotated.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const marker = parseWriterLeasePullRequestBody(projectedPullRequest.body);
  if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(annotated))) {
    throw new Error("Legacy bootstrap owner projection did not preserve the exact writer lease marker.");
  }
  const output = phaseOutput("ownerProjection", context.identity.identityDigest, {
    branch: request.branch,
    admission,
    authority,
    pullRequestUrl: annotated.pullRequestUrl,
    markerDigest: digestValue(marker),
    ...(ownerProjection.continuationReceipt
      ? { taskAuthorityContinuation: ownerProjection.continuationReceipt } : {}),
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}
function verifyFinal({ context, repository, leaseStore, stateDir }) {
  const request = context.request;
  let lease = requireLease({ branch: request.branch, leaseStore });
  if (lease.taskAuthority) {
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  }
  requireRecordedLegacyBootstrapContinuation({ context, lease });
  lease = reconcileFinalCurrentBaseAuthority({
    context,
    repository,
    leaseStore,
    stateDir,
  });
  if (lease.taskAuthority) {
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  }
  requireRecordedLegacyBootstrapContinuation({ context, lease });
  return verifyLegacyBootstrapFinalBoundary({
    verifyCloud: () => verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: lease.admission,
      canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha,
    }),
    inspect: () => inspectLane({ request, repository, leaseStore, stateDir }),
    requireProtectedReview: () => requireCurrentLegacyBootstrapProtectedReview({
      request,
      lease,
      repository,
      expectedBaseSha: lease.cloudAuthority.canonicalBaseSha,
    }),
    verifyMarker: pullRequest => {
      const marker = parseWriterLeasePullRequestBody(pullRequest.body);
      if (!marker
        || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
        throw new Error("Legacy bootstrap final PR marker drifted.");
      }
    },
  });
}

function requireRecordedLegacyBootstrapContinuation({ context, lease }) {
  const recordedContinuation = context.checkpoint?.outputs?.ownerProjection
    ?.taskAuthorityContinuation;
  if (!recordedContinuation) return null;
  const recorded = normalizeLegacyBootstrapTaskBindingContinuationReceipt(
    recordedContinuation,
  );
  const current = requireCurrentLegacyBootstrapTaskBindingContinuation({ lease });
  return requireLegacyBootstrapContinuationPrefix({ recorded, current });
}

export function requireLegacyBootstrapContinuationPrefix({ recorded, current }) {
  const normalizedRecorded = normalizeLegacyBootstrapTaskBindingContinuationReceipt(recorded);
  const normalizedCurrent = normalizeLegacyBootstrapTaskBindingContinuationReceipt(current);
  const recordedPrefix = [
    ...normalizedRecorded.lineage,
    compactLegacyBootstrapContinuation(normalizedRecorded),
  ];
  const currentLineage = [
    ...normalizedCurrent.lineage,
    compactLegacyBootstrapContinuation(normalizedCurrent),
  ];
  if (recordedPrefix.length > currentLineage.length
    || recordedPrefix.some((hop, index) => (
      digestValue(hop) !== digestValue(currentLineage[index])
    ))) {
    throw new Error("Legacy bootstrap final task-binding continuation evidence drifted.");
  }
  return normalizedCurrent;
}

export function verifyLegacyBootstrapFinalBoundary({
  verifyCloud,
  inspect,
  requireProtectedReview,
  verifyMarker,
}) {
  verifyCloud();
  const observation = inspect();
  const pullRequest = requireProtectedReview();
  verifyMarker(pullRequest);
  return observation;
}

export function runLegacyBootstrapFinalReconciliationSequence({
  requireDurableIntent,
  resolve,
  persistResolved,
  project,
  persistAdopted,
  revalidate,
}) {
  const intentState = requireDurableIntent();
  const replacement = resolve(intentState);
  const resolvedState = persistResolved({ intentState, replacement });
  const projection = project({ intentState, replacement, resolvedState });
  const adoptedState = persistAdopted({
    intentState,
    replacement,
    resolvedState,
    projection,
  });
  return revalidate({
    intentState,
    replacement,
    resolvedState,
    projection,
    adoptedState,
  });
}
function reconcileFinalCurrentBaseAuthority({ context, repository, leaseStore, stateDir }) {
  const request = context.request;
  let lease = requireLease({ branch: request.branch, leaseStore });
  const projected = context.checkpoint?.outputs?.ownerProjection;
  if (!projected?.taskAuthorityContinuation) return lease;
  let reconciliation = readLegacyBootstrapFinalReconciliation({ context, stateDir });
  let liveReview = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });

  if (reconciliation?.status === "adopted") {
    requireAdoptedLegacyBootstrapFinalReconciliation({
      reconciliation,
      context,
      lease,
    });
    requireLegacyBootstrapAdoptedFinalRefresh({ reconciliation, liveReview });
  }

  if (!reconciliation || reconciliation.status === "adopted") {
    if (liveReview.headRefOid !== request.expectedHeadSha) {
      throw new Error("Legacy bootstrap final reconciliation requires the preserved review head.");
    }
    const proof = currentProtectedBaseProof({
      request,
      sourceBaseSha: lease.cloudAuthority.canonicalBaseSha,
      targetBaseSha: liveReview.baseRefOid,
    });
    const intent = createLegacyBootstrapFinalAuthorityIntent({
      context,
      lease,
      review: liveReview,
      proof,
      priorReconciliation: reconciliation,
    });
    reconciliation = persistLegacyBootstrapFinalReconciliation({
      context,
      stateDir,
      reconciliation: createLegacyBootstrapFinalReconciliation({
        status: "intent",
        intent,
      }),
    });
  }

  const intent = requireLegacyBootstrapFinalAuthorityIntent({
    intent: reconciliation.intent,
    context,
    lease,
  });
  if (
    liveReview.id !== intent.reviewId
    || liveReview.headRefOid !== intent.reviewHeadSha
  ) {
    throw new Error("Legacy bootstrap pending final reconciliation review identity drifted.");
  }

  if (writerLeaseDigest(lease) !== intent.sourceLeaseDigest) {
    const adopted = adoptResolvedLegacyBootstrapFinalLease({
      reconciliation,
      context,
      lease,
    });
    if (!adopted) {
      throw new Error("Legacy bootstrap pending final reconciliation source lease drifted.");
    }
    reconciliation = persistLegacyBootstrapFinalReconciliation({
      context,
      stateDir,
      reconciliation: adopted,
    });
  } else {
    const pinnedReview = {
      ...liveReview,
      id: intent.reviewId,
      headRefOid: intent.reviewHeadSha,
      baseRefOid: intent.reviewBaseSha,
    };
    return runLegacyBootstrapFinalReconciliationSequence({
      requireDurableIntent: () => reconciliation,
      resolve: () => resolveReviewBoundAuthority({
        request,
        lease,
        review: pinnedReview,
        proof: intent.protectedBaseProof,
        identity: context.identity,
      }),
      persistResolved: ({ replacement }) => {
        if (reconciliation.resolvedClaimId !== null
          && reconciliation.resolvedClaimId !== replacement.authority.claimId) {
          throw new Error("Legacy bootstrap final reconciliation resolved another cloud successor.");
        }
        reconciliation = persistLegacyBootstrapFinalReconciliation({
          context,
          stateDir,
          reconciliation: createLegacyBootstrapFinalReconciliation({
            status: "resolved",
            intent,
            resolvedClaimId: replacement.authority.claimId,
          }),
        });
        return reconciliation;
      },
      project: ({ replacement }) => {
        const needsProjection = legacyBootstrapAuthorityNeedsProjection({
          sourceAuthority: lease.cloudAuthority,
          targetAuthority: replacement.authority,
        }) || taskBindingMatchesNullCloud(lease);
        let projectionKind = "unchanged";
        if (needsProjection) {
          const admission = createAdmissionProjection({
            request,
            lease,
            authority: replacement.authority,
            verification: replacement.verification,
          });
          const values = legacyBootstrapLeaseProjectionValues({
            baseSha: intent.reviewBaseSha,
            headSha: request.expectedHeadSha,
            pullRequestUrl: lease.pullRequestUrl,
            admission,
            authority: replacement.authority,
            verifiedAt: replacement.verification.verifiedAt,
          });
          lease = projectCloudAuthorityAndTaskBinding({
            leaseStore,
            lease,
            request,
            values,
            repairProof: intent.protectedBaseProof,
            sourceWithoutCloud: !lease.cloudAuthority || taskBindingMatchesNullCloud(lease),
            bootstrapIdentityDigest: context.identity.identityDigest,
          }).lease;
          projectionKind = "continued";
        }
        return { lease, projectionKind };
      },
      persistAdopted: ({ replacement, projection }) => {
        const continuation = requireCurrentLegacyBootstrapTaskBindingContinuation({
          lease: projection.lease,
        });
        reconciliation = persistLegacyBootstrapFinalReconciliation({
          context,
          stateDir,
          reconciliation: createLegacyBootstrapFinalReconciliation({
            status: "adopted",
            intent,
            resolvedClaimId: replacement.authority.claimId,
            targetLeaseDigest: writerLeaseDigest(projection.lease),
            projectionKind: projection.projectionKind,
            adoptedContinuationReceiptDigest: continuation.receiptDigest,
          }),
        });
        return reconciliation;
      },
      revalidate: ({ projection, adoptedState }) => {
        requireAdoptedLegacyBootstrapFinalReconciliation({
          reconciliation: adoptedState,
          context,
          lease: projection.lease,
        });
        const resolvedReview = requireCurrentLegacyBootstrapProtectedReview({
          request,
          lease: projection.lease,
          repository,
          expectedBaseSha: intent.reviewBaseSha,
          expectedReviewId: intent.reviewId,
        });
        return restoreReviewMarker({
          lease: projection.lease,
          review: resolvedReview,
          repository,
        });
      },
    });
  }

  requireAdoptedLegacyBootstrapFinalReconciliation({
    reconciliation,
    context,
    lease,
  });
  const resolvedReview = requireCurrentLegacyBootstrapProtectedReview({
    request,
    lease,
    repository,
    expectedBaseSha: reconciliation.intent.reviewBaseSha,
    expectedReviewId: reconciliation.intent.reviewId,
  });
  return restoreReviewMarker({ lease, review: resolvedReview, repository });
}

export function requireLegacyBootstrapAdoptedFinalRefresh({ reconciliation, liveReview }) {
  if (reconciliation?.status !== "adopted") return false;
  if (
    liveReview?.id !== reconciliation.intent?.reviewId
    || liveReview?.headRefOid !== reconciliation.intent?.reviewHeadSha
  ) {
    throw new Error("Legacy bootstrap final reconciliation review identity drifted.");
  }
  return true;
}

function requireCurrentLegacyBootstrapProtectedReview({
  request,
  lease,
  repository,
  expectedBaseSha,
  expectedReviewId = null,
}) {
  const review = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  if (
    review.headRefOid !== request.expectedHeadSha
    || review.baseRefOid !== expectedBaseSha
    || (expectedReviewId !== null && review.id !== expectedReviewId)
  ) {
    throw new Error("Legacy bootstrap protected pull-request subject drifted.");
  }
  requireLegacyBootstrapProtectedBaseSubject({
    reviewBaseSha: review.baseRefOid,
    trackingBaseSha: gitText(["rev-parse", "origin/main"], { cwd: request.worktreePath }),
    remoteBaseSha: lsRemoteHead({ repository: request.worktreePath, branch: "main" }),
  });
  return review;
}
const admissionManifest = legacyBootstrapAdmissionManifest;
function initialCloudProjectionTaskBindingRepair({
  lease,
  request,
  repository,
  sourceBaseSha = null,
}) {
  if (!lease?.taskAuthority || !taskBindingMatchesNullCloud(lease)) return null;
  const review = readOwnershipPullRequest({ url: lease.pullRequestUrl, branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }) });
  if (review.headRefOid !== request.expectedHeadSha) {
    throw new Error("Legacy bootstrap task-binding repair requires the exact preserved PR head.");
  }
  if (lease.cloudAuthority && (lease.cloudAuthority.reviewRequestId !== `github-pull-request:${review.id}`
    || lease.cloudAuthority.laneRevision !== request.expectedHeadSha)) {
    throw new Error("Legacy bootstrap task-binding repair requires the exact PR-bound cloud claim.");
  }
  return { proof: currentProtectedBaseProof({
    request,
    sourceBaseSha: sourceBaseSha || lease.cloudAuthority?.canonicalBaseSha || review.baseRefOid,
    targetBaseSha: review.baseRefOid,
  }) };
}
function resolveReviewBoundAuthority({ request, lease, review, proof, identity }) {
  const manifest = admissionManifest(request);
  requireLegacyBootstrapProtectedBaseProof({ proof, reviewBaseSha: review.baseRefOid });
  const inventory = readCurrentClaimInventory({ request });
  const reviewRequestId = `github-pull-request:${review.id}`;
  const successorProof = legacyBootstrapPredecessorDescendantProof({
    authority: lease.cloudAuthority,
    reviewBaseSha: review.baseRefOid,
    proof,
  });
  const candidate = findLegacyReviewCurrentBaseCandidate({
    claims: inventory.claims,
    request,
    targetBaseSha: review.baseRefOid,
    allowedReviewRequestIds: [null, reviewRequestId],
    sourceAuthority: lease.cloudAuthority,
    canonicalDescendantProof: successorProof,
  });
  let current;
  if (candidate && candidate.state !== "waiting-successor") {
    const recovered = candidate.state === "dormant-preserved"
      ? recoverDormantLegacyBootstrapClaim({
        claim: candidate,
        request,
        identity,
        canonicalBaseSha: review.baseRefOid,
        expectedLaneRevision: candidate.laneRevision,
        expectedReviewRequestId: candidate.reviewRequestId,
      })
      : { claim: candidate, statusResult: inventory.result };
    const result = projectRecoveredLegacyBootstrapResult({
      statusResult: recovered.statusResult,
      claim: recovered.claim,
    });
    current = {
      authority: normalizeLegacyBootstrapLiveAuthority({
        result,
        seedAuthority: lease.cloudAuthority,
        manifest,
        request,
        canonicalBaseSha: review.baseRefOid,
        expectedLaneRevision: recovered.claim.laneRevision,
      }),
    };
  } else current = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: request.ledgerRepository, targetRepository: request.targetRepository, manifest,
    canonicalBaseSha: review.baseRefOid, branch: request.branch, headSha: request.expectedHeadSha,
    deviceId: request.deviceId, sessionId: request.sessionId,
    predecessorClaimId: lease.cloudAuthority?.claimId || null,
    canonicalDescendantProof: successorProof,
    leaseEpoch: (lease.cloudAuthority?.leaseEpoch || 0) + 1 });
  if (current.authority.reviewRequestId === reviewRequestId
    && current.authority.laneRevision === request.expectedHeadSha) {
    return verifyAdmissionCloudAuthority({ authority: current.authority, manifest, canonicalBaseSha: review.baseRefOid });
  }
  return bindAdmissionCloudAuthority({ authority: current.authority, manifest, branch: request.branch,
    headSha: request.expectedHeadSha, pullRequestNumber: pullRequestNumber(lease.pullRequestUrl), deviceId: request.deviceId,
    sessionId: request.sessionId, returnVerification: true });
}
export function legacyBootstrapAuthorityNeedsProjection({ sourceAuthority, targetAuthority }) {
  const stableProjection = authority => {
    if (!authority) return authority;
    const { ledgerRevision: _ledgerRevision, ledgerDigest: _ledgerDigest, ...stable } = authority;
    return stable;
  };
  return digestValue(stableProjection(sourceAuthority))
    !== digestValue(stableProjection(targetAuthority));
}

export function requireLegacyBootstrapProtectedBaseSubject({
  reviewBaseSha,
  trackingBaseSha,
  remoteBaseSha,
}) {
  for (const [label, value] of [
    ["pull-request base", reviewBaseSha],
    ["tracking protected base", trackingBaseSha],
    ["remote protected base", remoteBaseSha],
  ]) {
    if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) {
      throw new Error(`Legacy bootstrap ${label} must be an exact Git SHA.`);
    }
  }
  if (reviewBaseSha !== trackingBaseSha || reviewBaseSha !== remoteBaseSha) {
    throw new Error("Legacy bootstrap pull-request base is not the exact current protected main.");
  }
  return reviewBaseSha;
}

export function requireLegacyBootstrapProtectedBaseProof({ proof, reviewBaseSha }) {
  const unsigned = { ...(proof || {}) };
  delete unsigned.evidenceDigest;
  if (
    ![
      "agentic-legacy-review-current-base-equality-proof/v1",
      "agentic-legacy-review-current-base-disjoint-proof/v1",
    ].includes(proof?.schema)
    || proof.targetBaseSha !== reviewBaseSha
    || proof.protectedMainSha !== reviewBaseSha
    || proof.overlap !== "none"
    || proof.evidenceDigest !== digestValue(unsigned)
  ) {
    throw new Error("Legacy bootstrap protected-base proof does not bind the exact pull-request base.");
  }
  return proof;
}

export function legacyBootstrapPredecessorDescendantProof({ authority, reviewBaseSha, proof }) {
  if (!authority || authority.canonicalBaseSha === reviewBaseSha) return null;
  requireLegacyBootstrapProtectedBaseProof({ proof, reviewBaseSha });
  if (proof.schema !== "agentic-legacy-review-current-base-disjoint-proof/v1") {
    throw new Error("Legacy bootstrap advanced predecessor requires a disjoint protected-base proof.");
  }
  return proof;
}
function currentProtectedBaseProof({ request, sourceBaseSha, targetBaseSha }) {
  const trackingBaseSha = gitText(["rev-parse", "origin/main"], { cwd: request.worktreePath });
  const remoteBaseSha = lsRemoteHead({ repository: request.worktreePath, branch: "main" });
  requireLegacyBootstrapProtectedBaseSubject({
    reviewBaseSha: targetBaseSha,
    trackingBaseSha,
    remoteBaseSha,
  });
  if (sourceBaseSha === targetBaseSha) {
    const core = { schema: "agentic-legacy-review-current-base-equality-proof/v1",
      sourceBaseSha, targetBaseSha, protectedMainSha: targetBaseSha, overlap: "none" };
    return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
  }
  return proveLegacyReviewCanonicalDescendant({ sourceBaseSha, targetBaseSha, protectedMainSha: targetBaseSha,
    canonicalChangedPaths: diffPaths({ cwd: request.worktreePath, from: sourceBaseSha, to: targetBaseSha }),
    preservedChangedPaths: request.expectedChangedPaths,
    sourceIsAncestor: gitExitCode(["merge-base", "--is-ancestor", sourceBaseSha, targetBaseSha],
      { cwd: request.worktreePath }) === 0,
    targetIsProtectedAncestor: gitExitCode(["merge-base", "--is-ancestor", targetBaseSha, "origin/main"],
      { cwd: request.worktreePath }) === 0 });
}
function restoreReviewMarker({ lease, review, repository }) {
  const marker = parseWriterLeasePullRequestBody(review.body);
  if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    updatePullRequestBody({ url: lease.pullRequestUrl,
      body: updateWriterLeasePullRequestBody(review.body, lease), repository });
  }
  return lease;
}
function taskBindingMatchesNullCloud(lease) {
  try {
    assertTaskAuthorityBinding({ binding: lease?.taskAuthority, lease: { ...lease, cloudAuthority: null } });
    return true;
  } catch { return false; }
}

const LEGACY_BOOTSTRAP_CONTINUATION_MAX_HOPS = 16;
const LEGACY_BOOTSTRAP_CONTINUATION_SCHEMA =
  "agentic-legacy-bootstrap-task-binding-continuation/v2";
const LEGACY_BOOTSTRAP_FINAL_RECONCILIATION_SCHEMA =
  "agentic-legacy-bootstrap-final-authority-reconciliation/v1";
const LEGACY_BOOTSTRAP_FINAL_INTENT_SCHEMA =
  "agentic-legacy-bootstrap-final-authority-intent/v1";

function legacyBootstrapContinuationDigest(input, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(input || ""))) {
    throw new Error(`Legacy bootstrap ${label} must be a SHA-256 digest.`);
  }
  return input;
}

function legacyBootstrapContinuationSha(input, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(input || ""))) {
    throw new Error(`Legacy bootstrap ${label} must be a Git SHA.`);
  }
  return input;
}

function legacyBootstrapContinuationSignature(value) {
  const encoded = String(value || "");
  const decoded = Buffer.from(encoded, "base64");
  if (!encoded || decoded.length !== 64 || decoded.toString("base64") !== encoded) {
    throw new Error("Legacy bootstrap continuation signature is malformed.");
  }
  return encoded;
}

function legacyBootstrapContinuationCore(value) {
  return {
    schema: value.schema,
    status: value.status,
    authoritySubjectId: String(value.authoritySubjectId || ""),
    proofAdapterId: String(value.proofAdapterId || ""),
    generation: value.generation,
    publicKeyDigest: legacyBootstrapContinuationDigest(
      value.publicKeyDigest,
      "task authority public key",
    ),
    bootstrapIdentityDigest: legacyBootstrapContinuationDigest(
      value.bootstrapIdentityDigest,
      "bootstrap identity",
    ),
    branch: String(value.branch || ""),
    sourceClaimId: value.sourceClaimId === null
      ? null : legacyBootstrapContinuationDigest(value.sourceClaimId, "source claim"),
    targetClaimId: legacyBootstrapContinuationDigest(value.targetClaimId, "target claim"),
    sourceLeaseSubjectDigest: legacyBootstrapContinuationDigest(
      value.sourceLeaseSubjectDigest,
      "source lease subject",
    ),
    targetLeaseSubjectDigest: legacyBootstrapContinuationDigest(
      value.targetLeaseSubjectDigest,
      "target lease subject",
    ),
    priorBindingDigest: legacyBootstrapContinuationDigest(
      value.priorBindingDigest,
      "prior task binding",
    ),
    targetBindingDigest: legacyBootstrapContinuationDigest(
      value.targetBindingDigest,
      "target task binding",
    ),
    rootBindingDigest: legacyBootstrapContinuationDigest(
      value.rootBindingDigest,
      "root task binding",
    ),
    priorContinuationReceiptDigest: value.priorContinuationReceiptDigest === null
      ? null : legacyBootstrapContinuationDigest(
        value.priorContinuationReceiptDigest,
        "prior continuation receipt",
      ),
    lineageDigest: legacyBootstrapContinuationDigest(value.lineageDigest, "continuation lineage"),
    taskAuthorityReceiptDigest: legacyBootstrapContinuationDigest(
      value.taskAuthorityReceiptDigest,
      "task authority receipt",
    ),
    disjointProofDigest: legacyBootstrapContinuationDigest(
      value.disjointProofDigest,
      "protected-base proof",
    ),
    preservedHeadSha: legacyBootstrapContinuationSha(value.preservedHeadSha, "preserved head"),
    preservedTreeSha: legacyBootstrapContinuationSha(value.preservedTreeSha, "preserved tree"),
    pullRequestUrl: String(value.pullRequestUrl || ""),
  };
}

function compactLegacyBootstrapContinuation(value) {
  const core = legacyBootstrapContinuationCore(value);
  return Object.freeze({
    ...core,
    signature: legacyBootstrapContinuationSignature(value.signature),
    receiptDigest: legacyBootstrapContinuationDigest(value.receiptDigest, "continuation receipt"),
  });
}

function normalizeLegacyBootstrapContinuationHop(value) {
  const allowedKeys = new Set([
    "authoritySubjectId", "bootstrapIdentityDigest", "branch", "disjointProofDigest",
    "generation", "lineageDigest", "preservedHeadSha", "preservedTreeSha",
    "priorBindingDigest", "priorContinuationReceiptDigest", "proofAdapterId",
    "publicKeyDigest", "pullRequestUrl", "receiptDigest", "rootBindingDigest", "schema",
    "signature", "sourceClaimId", "sourceLeaseSubjectDigest", "status",
    "targetBindingDigest", "targetClaimId", "targetLeaseSubjectDigest",
    "taskAuthorityReceiptDigest",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error("Legacy bootstrap task-binding continuation hop is malformed.");
  }
  const hop = compactLegacyBootstrapContinuation(value);
  const signed = { ...legacyBootstrapContinuationCore(hop), signature: hop.signature };
  if (
    hop.schema !== LEGACY_BOOTSTRAP_CONTINUATION_SCHEMA
    || hop.status !== "projected"
    || !hop.authoritySubjectId
    || !hop.proofAdapterId
    || !Number.isSafeInteger(hop.generation)
    || hop.generation < 1
    || !hop.branch
    || !hop.pullRequestUrl
    || hop.receiptDigest !== digestValue(signed)
  ) {
    throw new Error("Legacy bootstrap task-binding continuation hop is not content-bound.");
  }
  return hop;
}

export function normalizeLegacyBootstrapTaskBindingContinuationReceipt(value) {
  const allowedEnvelopeKeys = new Set([
    "authoritySubjectId", "bootstrapIdentityDigest", "branch", "disjointProofDigest",
    "generation", "lineage", "lineageDigest", "preservedHeadSha", "preservedTreeSha",
    "priorBindingDigest", "priorContinuationReceiptDigest", "proofAdapterId",
    "publicKeyDigest", "pullRequestUrl", "receiptDigest", "registryRevision",
    "rootBindingDigest", "schema", "signature", "sourceClaimId",
    "sourceLeaseSubjectDigest", "status", "targetBindingDigest", "targetClaimId",
    "targetLeaseDigest", "targetLeaseSubjectDigest", "taskAuthorityReceiptDigest",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !allowedEnvelopeKeys.has(key))
    || !Array.isArray(value.lineage)
    || value.lineage.length > LEGACY_BOOTSTRAP_CONTINUATION_MAX_HOPS - 1) {
    throw new Error("Legacy bootstrap task-binding continuation receipt is malformed.");
  }
  const lineage = Object.freeze(value.lineage.map(normalizeLegacyBootstrapContinuationHop));
  const receipt = normalizeLegacyBootstrapContinuationHop(
    Object.fromEntries(Object.entries(value).filter(([key]) => ![
      "lineage", "registryRevision", "targetLeaseDigest",
    ].includes(key))),
  );
  if (
    receipt.lineageDigest !== digestValue(lineage)
    || (value.targetLeaseDigest !== undefined
      && !/^[0-9a-f]{64}$/u.test(String(value.targetLeaseDigest || "")))
    || (value.registryRevision !== undefined && value.registryRevision !== null
      && (!Number.isSafeInteger(value.registryRevision) || value.registryRevision < 1))
  ) {
    throw new Error("Legacy bootstrap task-binding continuation receipt is not content-bound.");
  }
  return Object.freeze({ ...receipt, lineage });
}

function legacyBootstrapContinuationSignatureSubject(core) {
  return Buffer.from(canonicalJson({
    schema: "agentic-legacy-bootstrap-task-binding-continuation-signature/v1",
    continuation: core,
  }));
}

function signLegacyBootstrapContinuation({ core, capabilityPath }) {
  const capability = readTaskAuthorityCapability(capabilityPath);
  return sign(
    null,
    legacyBootstrapContinuationSignatureSubject(core),
    createPrivateKey(capability.privateKey),
  ).toString("base64");
}

function verifyLegacyBootstrapContinuation({ core, signature: encoded, binding }) {
  try {
    return verify(
      null,
      legacyBootstrapContinuationSignatureSubject(core),
      createPublicKey({
        key: Buffer.from(binding.publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(encoded, "base64"),
    );
  } catch {
    return false;
  }
}

function legacyBootstrapFinalIntentSignatureSubject(core) {
  return Buffer.from(canonicalJson({
    schema: "agentic-legacy-bootstrap-final-authority-intent-signature/v1",
    intent: core,
  }));
}

function signLegacyBootstrapFinalIntent({ core, capabilityPath }) {
  const capability = readTaskAuthorityCapability(capabilityPath);
  return sign(
    null,
    legacyBootstrapFinalIntentSignatureSubject(core),
    createPrivateKey(capability.privateKey),
  ).toString("base64");
}

function verifyLegacyBootstrapFinalIntent({ core, signature: encoded, binding }) {
  try {
    return verify(
      null,
      legacyBootstrapFinalIntentSignatureSubject(core),
      createPublicKey({
        key: Buffer.from(binding.publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(encoded, "base64"),
    );
  } catch {
    return false;
  }
}

function legacyBootstrapFinalIntentCore(value) {
  return {
    schema: value.schema,
    generation: value.generation,
    priorReconciliationReceiptDigest: value.priorReconciliationReceiptDigest,
    authoritySubjectId: value.authoritySubjectId,
    proofAdapterId: value.proofAdapterId,
    taskAuthorityGeneration: value.taskAuthorityGeneration,
    publicKeyDigest: value.publicKeyDigest,
    bootstrapIdentityDigest: value.bootstrapIdentityDigest,
    branch: value.branch,
    preservedHeadSha: value.preservedHeadSha,
    preservedTreeSha: value.preservedTreeSha,
    sourceLeaseDigest: value.sourceLeaseDigest,
    sourceClaimId: value.sourceClaimId,
    sourceCanonicalBaseSha: value.sourceCanonicalBaseSha,
    sourceLeaseEpoch: value.sourceLeaseEpoch,
    sourceBindingDigest: value.sourceBindingDigest,
    pullRequestUrl: value.pullRequestUrl,
    reviewId: value.reviewId,
    reviewRequestId: value.reviewRequestId,
    reviewHeadSha: value.reviewHeadSha,
    reviewBaseSha: value.reviewBaseSha,
    protectedBaseProof: value.protectedBaseProof,
    successorProofDigest: value.successorProofDigest,
  };
}

function normalizeLegacyBootstrapFinalIntent(value) {
  const allowedKeys = new Set([
    "authoritySubjectId", "bootstrapIdentityDigest", "branch", "generation", "intentDigest",
    "preservedHeadSha", "preservedTreeSha", "priorReconciliationReceiptDigest",
    "proofAdapterId", "protectedBaseProof", "publicKeyDigest", "pullRequestUrl",
    "reviewBaseSha", "reviewHeadSha", "reviewId", "reviewRequestId", "schema", "signature",
    "sourceBindingDigest", "sourceCanonicalBaseSha", "sourceClaimId", "sourceLeaseDigest",
    "sourceLeaseEpoch", "successorProofDigest", "taskAuthorityGeneration",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error("Legacy bootstrap final authority intent is malformed.");
  }
  const core = {
    schema: value.schema,
    generation: value.generation,
    priorReconciliationReceiptDigest: value.priorReconciliationReceiptDigest === null
      ? null : legacyBootstrapContinuationDigest(
        value.priorReconciliationReceiptDigest,
        "prior final reconciliation receipt",
      ),
    authoritySubjectId: String(value.authoritySubjectId || ""),
    proofAdapterId: String(value.proofAdapterId || ""),
    taskAuthorityGeneration: value.taskAuthorityGeneration,
    publicKeyDigest: legacyBootstrapContinuationDigest(
      value.publicKeyDigest,
      "final intent public key",
    ),
    bootstrapIdentityDigest: legacyBootstrapContinuationDigest(
      value.bootstrapIdentityDigest,
      "final intent bootstrap identity",
    ),
    branch: String(value.branch || ""),
    preservedHeadSha: legacyBootstrapContinuationSha(value.preservedHeadSha, "final intent head"),
    preservedTreeSha: legacyBootstrapContinuationSha(value.preservedTreeSha, "final intent tree"),
    sourceLeaseDigest: legacyBootstrapContinuationDigest(value.sourceLeaseDigest, "source lease"),
    sourceClaimId: legacyBootstrapContinuationDigest(value.sourceClaimId, "source claim"),
    sourceCanonicalBaseSha: legacyBootstrapContinuationSha(
      value.sourceCanonicalBaseSha,
      "source canonical base",
    ),
    sourceLeaseEpoch: value.sourceLeaseEpoch,
    sourceBindingDigest: legacyBootstrapContinuationDigest(
      value.sourceBindingDigest,
      "source binding",
    ),
    pullRequestUrl: String(value.pullRequestUrl || ""),
    reviewId: String(value.reviewId || ""),
    reviewRequestId: String(value.reviewRequestId || ""),
    reviewHeadSha: legacyBootstrapContinuationSha(value.reviewHeadSha, "review head"),
    reviewBaseSha: legacyBootstrapContinuationSha(value.reviewBaseSha, "review base"),
    protectedBaseProof: value.protectedBaseProof,
    successorProofDigest: value.successorProofDigest === null
      ? null : legacyBootstrapContinuationDigest(value.successorProofDigest, "successor proof"),
  };
  const signature = legacyBootstrapContinuationSignature(value.signature);
  if (
    core.schema !== LEGACY_BOOTSTRAP_FINAL_INTENT_SCHEMA
    || !Number.isSafeInteger(core.generation)
    || core.generation < 1
    || !Number.isSafeInteger(core.taskAuthorityGeneration)
    || core.taskAuthorityGeneration < 1
    || !Number.isSafeInteger(core.sourceLeaseEpoch)
    || core.sourceLeaseEpoch < 1
    || !core.authoritySubjectId
    || !core.proofAdapterId
    || !core.branch
    || !core.pullRequestUrl
    || !core.reviewId
    || core.reviewRequestId !== `github-pull-request:${core.reviewId}`
    || core.reviewHeadSha !== core.preservedHeadSha
    || value.intentDigest !== digestValue({ ...core, signature })
  ) {
    throw new Error("Legacy bootstrap final authority intent is not content-bound.");
  }
  requireLegacyBootstrapProtectedBaseProof({
    proof: core.protectedBaseProof,
    reviewBaseSha: core.reviewBaseSha,
  });
  if (
    core.protectedBaseProof.sourceBaseSha !== core.sourceCanonicalBaseSha
    || core.successorProofDigest !== (
      core.sourceCanonicalBaseSha === core.reviewBaseSha
        ? null
        : core.protectedBaseProof.evidenceDigest
    )
  ) {
    throw new Error("Legacy bootstrap final authority intent proof lineage drifted.");
  }
  return Object.freeze({ ...core, signature, intentDigest: value.intentDigest });
}

export function normalizeLegacyBootstrapFinalAuthorityReconciliation(value) {
  const allowedKeys = new Set([
    "adoptedContinuationReceiptDigest", "bootstrapIdentityDigest", "intent",
    "projectionKind", "receiptDigest", "resolvedClaimId", "schema", "status",
    "targetLeaseDigest",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error("Legacy bootstrap final authority reconciliation is malformed.");
  }
  const intent = normalizeLegacyBootstrapFinalIntent(value.intent);
  const core = {
    schema: value.schema,
    status: value.status,
    bootstrapIdentityDigest: legacyBootstrapContinuationDigest(
      value.bootstrapIdentityDigest,
      "final reconciliation identity",
    ),
    intent,
    resolvedClaimId: value.resolvedClaimId === null
      ? null : legacyBootstrapContinuationDigest(value.resolvedClaimId, "resolved claim"),
    targetLeaseDigest: value.targetLeaseDigest === null
      ? null : legacyBootstrapContinuationDigest(value.targetLeaseDigest, "target lease"),
    projectionKind: value.projectionKind,
    adoptedContinuationReceiptDigest: value.adoptedContinuationReceiptDigest === null
      ? null : legacyBootstrapContinuationDigest(
        value.adoptedContinuationReceiptDigest,
        "adopted continuation receipt",
      ),
  };
  if (
    core.schema !== LEGACY_BOOTSTRAP_FINAL_RECONCILIATION_SCHEMA
    || !["intent", "resolved", "adopted"].includes(core.status)
    || core.bootstrapIdentityDigest !== intent.bootstrapIdentityDigest
    || (core.status === "intent" && (
      core.resolvedClaimId !== null
      || core.targetLeaseDigest !== null
      || core.projectionKind !== null
      || core.adoptedContinuationReceiptDigest !== null
    ))
    || (core.status === "resolved" && (
      core.resolvedClaimId === null
      || core.targetLeaseDigest !== null
      || core.projectionKind !== null
      || core.adoptedContinuationReceiptDigest !== null
    ))
    || (core.status === "adopted" && (
      core.resolvedClaimId === null
      || core.targetLeaseDigest === null
      || !["continued", "unchanged"].includes(core.projectionKind)
      || core.adoptedContinuationReceiptDigest === null
    ))
    || value.receiptDigest !== digestValue(core)
  ) {
    throw new Error("Legacy bootstrap final authority reconciliation is not content-bound.");
  }
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function createLegacyBootstrapFinalAuthorityIntent({
  context,
  lease,
  review,
  proof,
  priorReconciliation,
}) {
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const successorProof = legacyBootstrapPredecessorDescendantProof({
    authority: lease.cloudAuthority,
    reviewBaseSha: review.baseRefOid,
    proof,
  });
  const core = {
    schema: LEGACY_BOOTSTRAP_FINAL_INTENT_SCHEMA,
    generation: (priorReconciliation?.intent?.generation || 0) + 1,
    priorReconciliationReceiptDigest: priorReconciliation?.receiptDigest || null,
    authoritySubjectId: binding.authoritySubjectId,
    proofAdapterId: binding.proofAdapterId,
    taskAuthorityGeneration: binding.generation,
    publicKeyDigest: binding.publicKeyDigest,
    bootstrapIdentityDigest: context.identity.identityDigest,
    branch: context.request.branch,
    preservedHeadSha: context.request.expectedHeadSha,
    preservedTreeSha: context.request.expectedTreeSha,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: lease.cloudAuthority.claimId,
    sourceCanonicalBaseSha: lease.cloudAuthority.canonicalBaseSha,
    sourceLeaseEpoch: lease.cloudAuthority.leaseEpoch,
    sourceBindingDigest: binding.bindingDigest,
    pullRequestUrl: lease.pullRequestUrl,
    reviewId: review.id,
    reviewRequestId: `github-pull-request:${review.id}`,
    reviewHeadSha: review.headRefOid,
    reviewBaseSha: review.baseRefOid,
    protectedBaseProof: proof,
    successorProofDigest: successorProof?.evidenceDigest || null,
  };
  const signature = signLegacyBootstrapFinalIntent({
    core,
    capabilityPath: process.env.AGENTIC_TASK_AUTHORITY_FILE,
  });
  return normalizeLegacyBootstrapFinalIntent({
    ...core,
    signature,
    intentDigest: digestValue({ ...core, signature }),
  });
}

function requireLegacyBootstrapFinalAuthorityIntent({ intent, context, lease }) {
  const normalized = normalizeLegacyBootstrapFinalIntent(intent);
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  if (
    verifyLegacyBootstrapFinalIntent({
      core: legacyBootstrapFinalIntentCore(normalized),
      signature: normalized.signature,
      binding,
    }) !== true
    || normalized.authoritySubjectId !== binding.authoritySubjectId
    || normalized.proofAdapterId !== binding.proofAdapterId
    || normalized.taskAuthorityGeneration !== binding.generation
    || normalized.publicKeyDigest !== binding.publicKeyDigest
    || normalized.bootstrapIdentityDigest !== context.identity.identityDigest
    || normalized.branch !== context.request.branch
    || normalized.preservedHeadSha !== context.request.expectedHeadSha
    || normalized.preservedTreeSha !== context.request.expectedTreeSha
    || normalized.pullRequestUrl !== lease.pullRequestUrl
  ) {
    throw new Error("Legacy bootstrap final authority intent is not authenticated-current.");
  }
  return normalized;
}

function createLegacyBootstrapFinalReconciliation({
  status,
  intent,
  resolvedClaimId = null,
  targetLeaseDigest = null,
  projectionKind = null,
  adoptedContinuationReceiptDigest = null,
}) {
  const core = {
    schema: LEGACY_BOOTSTRAP_FINAL_RECONCILIATION_SCHEMA,
    status,
    bootstrapIdentityDigest: intent.bootstrapIdentityDigest,
    intent,
    resolvedClaimId,
    targetLeaseDigest,
    projectionKind,
    adoptedContinuationReceiptDigest,
  };
  return normalizeLegacyBootstrapFinalAuthorityReconciliation({
    ...core,
    receiptDigest: digestValue(core),
  });
}

function readLegacyBootstrapFinalReconciliation({ context, stateDir }) {
  const checkpoint = readCheckpoint({
    identityDigest: context.identity.identityDigest,
    stateDir,
  });
  const value = checkpoint?.outputs?.finalAuthorityReconciliation;
  return value ? normalizeLegacyBootstrapFinalAuthorityReconciliation(value) : null;
}

function persistLegacyBootstrapFinalReconciliation({ context, stateDir, reconciliation }) {
  const checkpoint = readCheckpoint({
    identityDigest: context.identity.identityDigest,
    stateDir,
  });
  if (!checkpoint
    || checkpoint.identity?.identityDigest !== context.identity.identityDigest
    || digestValue(checkpoint.identity) !== digestValue(context.identity)) {
    throw new Error("Legacy bootstrap final reconciliation checkpoint identity drifted.");
  }
  writeJson(checkpointPath({
    identityDigest: context.identity.identityDigest,
    stateDir,
  }), {
    ...checkpoint,
    outputs: {
      ...checkpoint.outputs,
      finalAuthorityReconciliation: reconciliation,
    },
  });
  return reconciliation;
}

function requireAdoptedLegacyBootstrapFinalReconciliation({
  reconciliation,
  context,
  lease,
}) {
  const normalized = normalizeLegacyBootstrapFinalAuthorityReconciliation(reconciliation);
  const intent = requireLegacyBootstrapFinalAuthorityIntent({
    intent: normalized.intent,
    context,
    lease,
  });
  const continuation = requireCurrentLegacyBootstrapTaskBindingContinuation({ lease });
  if (
    normalized.status !== "adopted"
    || normalized.targetLeaseDigest !== writerLeaseDigest(lease)
    || normalized.resolvedClaimId !== lease.cloudAuthority?.claimId
    || normalized.adoptedContinuationReceiptDigest !== continuation.receiptDigest
    || lease.baseSha !== intent.reviewBaseSha
    || lease.cloudAuthority?.canonicalBaseSha !== intent.reviewBaseSha
    || (normalized.projectionKind === "continued" && (
      continuation.sourceClaimId !== intent.sourceClaimId
      || continuation.targetClaimId !== normalized.resolvedClaimId
      || continuation.priorBindingDigest !== intent.sourceBindingDigest
      || continuation.disjointProofDigest !== intent.protectedBaseProof.evidenceDigest
      || lease.cloudAuthority.leaseEpoch !== intent.sourceLeaseEpoch
        + (normalized.resolvedClaimId === intent.sourceClaimId ? 0 : 1)
      || (normalized.resolvedClaimId !== intent.sourceClaimId
        && lease.cloudAuthority.predecessorClaimId !== intent.sourceClaimId)
    ))
    || (normalized.projectionKind === "unchanged" && (
      intent.sourceLeaseDigest !== writerLeaseDigest(lease)
      || normalized.resolvedClaimId !== intent.sourceClaimId
    ))
  ) {
    throw new Error("Legacy bootstrap adopted final reconciliation is not exact-current.");
  }
  return normalized;
}

function adoptResolvedLegacyBootstrapFinalLease({ reconciliation, context, lease }) {
  if (!["intent", "resolved"].includes(reconciliation.status)) return null;
  const intent = requireLegacyBootstrapFinalAuthorityIntent({
    intent: reconciliation.intent,
    context,
    lease,
  });
  const continuation = requireCurrentLegacyBootstrapTaskBindingContinuation({ lease });
  if (
    (reconciliation.resolvedClaimId !== null
      && reconciliation.resolvedClaimId !== lease.cloudAuthority?.claimId)
    || continuation.sourceClaimId !== intent.sourceClaimId
    || continuation.targetClaimId !== lease.cloudAuthority?.claimId
    || continuation.priorBindingDigest !== intent.sourceBindingDigest
    || continuation.disjointProofDigest !== intent.protectedBaseProof.evidenceDigest
    || lease.baseSha !== intent.reviewBaseSha
    || lease.cloudAuthority?.canonicalBaseSha !== intent.reviewBaseSha
    || lease.cloudAuthority.leaseEpoch !== intent.sourceLeaseEpoch
      + (lease.cloudAuthority.claimId === intent.sourceClaimId ? 0 : 1)
    || (lease.cloudAuthority.claimId !== intent.sourceClaimId
      && lease.cloudAuthority.predecessorClaimId !== intent.sourceClaimId)
  ) {
    return null;
  }
  return createLegacyBootstrapFinalReconciliation({
    status: "adopted",
    intent,
    resolvedClaimId: lease.cloudAuthority.claimId,
    targetLeaseDigest: writerLeaseDigest(lease),
    projectionKind: "continued",
    adoptedContinuationReceiptDigest: continuation.receiptDigest,
  });
}

function requireLegacyBootstrapContinuationLineage({ receipt, binding, verifyReceipt }) {
  const hops = [...receipt.lineage, compactLegacyBootstrapContinuation(receipt)];
  const root = hops[0];
  for (const [index, hop] of hops.entries()) {
    const prior = index === 0 ? null : hops[index - 1];
    if (
      hop.lineageDigest !== digestValue(hops.slice(0, index))
      || verifyReceipt({
        core: legacyBootstrapContinuationCore(hop),
        signature: hop.signature,
        binding,
      }) !== true
      || hop.authoritySubjectId !== binding.authoritySubjectId
      || hop.proofAdapterId !== binding.proofAdapterId
      || hop.generation !== binding.generation
      || hop.publicKeyDigest !== binding.publicKeyDigest
      || hop.bootstrapIdentityDigest !== root.bootstrapIdentityDigest
      || hop.branch !== root.branch
      || hop.preservedHeadSha !== root.preservedHeadSha
      || hop.preservedTreeSha !== root.preservedTreeSha
      || hop.pullRequestUrl !== root.pullRequestUrl
      || hop.rootBindingDigest !== root.targetBindingDigest
      || (prior === null && (
        hop.priorContinuationReceiptDigest !== null
        || hop.rootBindingDigest !== hop.targetBindingDigest
      ))
      || (prior !== null && (
        hop.priorContinuationReceiptDigest !== prior.receiptDigest
        || hop.priorBindingDigest !== prior.targetBindingDigest
        || hop.sourceClaimId !== prior.targetClaimId
        || hop.sourceLeaseSubjectDigest !== prior.targetLeaseSubjectDigest
      ))
    ) {
      throw new Error("Legacy bootstrap task-binding continuation lineage is not authenticated.");
    }
  }
  return Object.freeze(hops);
}

export function requireCurrentLegacyBootstrapTaskBindingContinuation(
  { lease },
  dependencies = { leaseDigest: writerLeaseDigest, assertBinding: assertTaskAuthorityBinding },
) {
  const leaseDigest = dependencies.leaseDigest || writerLeaseDigest;
  const assertBinding = dependencies.assertBinding || assertTaskAuthorityBinding;
  const verifyReceipt = dependencies.verifyReceipt || verifyLegacyBootstrapContinuation;
  const receipt = normalizeLegacyBootstrapTaskBindingContinuationReceipt(
    lease?.legacyBootstrapTaskBindingContinuation,
  );
  const targetSubject = { ...lease };
  delete targetSubject.legacyBootstrapTaskBindingContinuation;
  const binding = assertBinding({ binding: lease?.taskAuthority, lease });
  const normalizedBinding = binding || lease?.taskAuthority;
  requireLegacyBootstrapContinuationLineage({
    receipt,
    binding: normalizedBinding,
    verifyReceipt,
  });
  if (
    lease?.taskAuthority?.bindingMode !== "continuation"
    || receipt.targetClaimId !== lease?.cloudAuthority?.claimId
    || receipt.targetBindingDigest !== lease?.taskAuthority?.bindingDigest
    || receipt.priorBindingDigest !== lease?.taskAuthority?.priorBindingDigest
    || receipt.targetLeaseSubjectDigest !== leaseDigest(targetSubject)
    || receipt.branch !== lease?.branch
    || receipt.preservedHeadSha !== lease?.fenceSha
    || receipt.pullRequestUrl !== lease?.pullRequestUrl
  ) {
    throw new Error("Legacy bootstrap task-binding continuation does not join the current lease.");
  }
  return receipt;
}

export function projectCloudAuthorityAndTaskBinding({ leaseStore, lease, request, values, repairProof,
  sourceWithoutCloud = true, bootstrapIdentityDigest }, dependencies = { authorize: authorizeTaskBoundLeaseMutation,
  createBinding: createTaskAuthorityLeaseBinding, mutate: mutateWriterLeaseRegistry,
  leaseDigest: writerLeaseDigest, assertBinding: assertTaskAuthorityBinding }) {
  const authorize = dependencies.authorize || authorizeTaskBoundLeaseMutation;
  const createBinding = dependencies.createBinding || createTaskAuthorityLeaseBinding;
  const mutate = dependencies.mutate || mutateWriterLeaseRegistry;
  const leaseDigest = dependencies.leaseDigest || writerLeaseDigest;
  const assertBinding = dependencies.assertBinding || assertTaskAuthorityBinding;
  const signReceipt = dependencies.signReceipt || signLegacyBootstrapContinuation;
  const verifyReceipt = dependencies.verifyReceipt || verifyLegacyBootstrapContinuation;
  const capabilityPath = process.env.AGENTIC_TASK_AUTHORITY_FILE;
  const priorContinuation = lease.legacyBootstrapTaskBindingContinuation
    ? requireCurrentLegacyBootstrapTaskBindingContinuation({ lease }, {
      ...dependencies,
      leaseDigest,
      assertBinding,
      verifyReceipt,
    })
    : null;
  const sourceLease = sourceWithoutCloud ? { ...lease, cloudAuthority: null } : lease;
  const sourceBinding = assertBinding({ binding: lease.taskAuthority, lease: sourceLease })
    || lease.taskAuthority;
  const taskReceipt = authorize({ lease: sourceLease, capabilityPath,
    operation: sourceWithoutCloud ? "legacy-bootstrap-cloud-claim-task-binding-continuation"
      : "legacy-bootstrap-current-base-task-binding-continuation" });
  const sourceClaimId = lease.cloudAuthority?.claimId ?? null;
  const core = { ...lease, ...values };
  delete core.legacyBootstrapTaskBindingContinuation;
  const taskAuthority = createBinding({ lease: core, capabilityPath,
    bindingMode: "continuation", priorBindingDigest: lease.taskAuthority.bindingDigest });
  const targetSubject = { ...core, taskAuthority };
  const targetBinding = assertBinding({
    binding: taskAuthority,
    lease: targetSubject,
  }) || taskAuthority;
  for (const field of [
    "authoritySubjectId", "proofAdapterId", "generation", "publicKeyDigest", "publicKey",
  ]) {
    if (sourceBinding?.[field] !== targetBinding?.[field]) {
      throw new Error("Legacy bootstrap continuation cannot change its task authority signer.");
    }
  }
  const lineage = priorContinuation
    ? [...priorContinuation.lineage, compactLegacyBootstrapContinuation(priorContinuation)]
    : [];
  if (lineage.length > LEGACY_BOOTSTRAP_CONTINUATION_MAX_HOPS - 1) {
    throw new Error("Legacy bootstrap task-binding continuation lineage is over capacity.");
  }
  const sourceLeaseSubject = { ...sourceLease };
  delete sourceLeaseSubject.legacyBootstrapTaskBindingContinuation;
  const repairCore = {
    schema: LEGACY_BOOTSTRAP_CONTINUATION_SCHEMA,
    status: "projected",
    authoritySubjectId: targetBinding.authoritySubjectId,
    proofAdapterId: targetBinding.proofAdapterId,
    generation: targetBinding.generation,
    publicKeyDigest: targetBinding.publicKeyDigest,
    bootstrapIdentityDigest,
    branch: request.branch,
    sourceClaimId,
    targetClaimId: values.cloudAuthority.claimId,
    sourceLeaseSubjectDigest: leaseDigest(sourceLeaseSubject),
    targetLeaseSubjectDigest: leaseDigest(targetSubject),
    priorBindingDigest: lease.taskAuthority.bindingDigest,
    targetBindingDigest: taskAuthority.bindingDigest,
    rootBindingDigest: priorContinuation?.rootBindingDigest || taskAuthority.bindingDigest,
    priorContinuationReceiptDigest: priorContinuation?.receiptDigest || null,
    lineageDigest: digestValue(lineage),
    taskAuthorityReceiptDigest: taskReceipt.receiptDigest,
    disjointProofDigest: repairProof.evidenceDigest,
    preservedHeadSha: request.expectedHeadSha,
    preservedTreeSha: request.expectedTreeSha,
    pullRequestUrl: values.pullRequestUrl,
  };
  const signature = signReceipt({ core: repairCore, capabilityPath });
  const repair = Object.freeze({
    ...repairCore,
    signature,
    lineage: Object.freeze(lineage),
    receiptDigest: digestValue({ ...repairCore, signature }),
  });
  const nextLease = { ...targetSubject, legacyBootstrapTaskBindingContinuation: repair };
  requireCurrentLegacyBootstrapTaskBindingContinuation({ lease: nextLease }, {
    ...dependencies,
    leaseDigest,
    assertBinding,
    verifyReceipt,
  });
  const mutation = mutate({ leaseStore, branch: request.branch,
    expectedLeaseDigest: leaseDigest(lease), expectedClaimId: sourceClaimId,
    action: ({ registry }) => ({ registry: { ...registry,
      leases: { ...registry.leases, [request.branch]: nextLease } }, lease: nextLease, changed: true }) });
  return { lease: mutation.lease, continuationReceipt: Object.freeze({
    ...repair,
    targetLeaseDigest: leaseDigest(mutation.lease),
    registryRevision: mutation.registryRevision,
  }) };
}

export function adoptLegacyBootstrapTaskBindingContinuation({
  lease,
  request,
  values,
  repairProof,
  bootstrapIdentityDigest,
}, dependencies = { leaseDigest: writerLeaseDigest, assertBinding: assertTaskAuthorityBinding }) {
  if (!lease?.legacyBootstrapTaskBindingContinuation) return null;
  const repair = requireCurrentLegacyBootstrapTaskBindingContinuation(
    { lease },
    dependencies,
  );
  const targetSubject = { ...lease };
  delete targetSubject.legacyBootstrapTaskBindingContinuation;
  const exact = repair.bootstrapIdentityDigest === bootstrapIdentityDigest
    && repair.branch === request.branch
    && repair.targetClaimId === values.cloudAuthority?.claimId
    && repair.targetLeaseSubjectDigest === dependencies.leaseDigest(targetSubject)
    && repair.targetBindingDigest === lease.taskAuthority?.bindingDigest
    && repair.priorBindingDigest === lease.taskAuthority?.priorBindingDigest
    && lease.taskAuthority?.bindingMode === "continuation"
    && repair.disjointProofDigest === repairProof?.evidenceDigest
    && repair.preservedHeadSha === request.expectedHeadSha
    && repair.preservedTreeSha === request.expectedTreeSha
    && repair.pullRequestUrl === values.pullRequestUrl
    && lease.baseSha === values.baseSha
    && lease.fenceSha === values.fenceSha
    && lease.pullRequestUrl === values.pullRequestUrl
    && digestValue(lease.admission) === digestValue(values.admission)
    && digestValue(lease.cloudAuthority) === digestValue(values.cloudAuthority)
    && lease.heartbeatAt === values.heartbeatAt
    && lease.expiresAt === values.expiresAt;
  if (!exact) {
    throw new Error("Legacy bootstrap task-binding continuation receipt is not exact-current.");
  }
  (dependencies.assertBinding || assertTaskAuthorityBinding)({
    binding: lease.taskAuthority,
    lease,
  });
  return { lease, continuationReceipt: Object.freeze({
    ...repair,
    targetLeaseDigest: dependencies.leaseDigest(lease),
    registryRevision: null,
  }) };
}
export function legacyBootstrapLeaseProjectionValues({ baseSha, headSha, pullRequestUrl,
  admission, authority, verifiedAt }) {
  const verifiedTime = Date.parse(verifiedAt), expiryTime = Date.parse(authority?.expiresAt);
  if (!Number.isFinite(verifiedTime) || !Number.isFinite(expiryTime) || verifiedTime >= expiryTime) throw new Error("Legacy bootstrap lease projection requires current verified cloud expiry.");
  return { baseSha, fenceSha: headSha, pullRequestUrl, admission, cloudAuthority: authority,
    heartbeatAt: verifiedAt, expiresAt: authority.expiresAt };
}
function createAdmissionProjection({ request, lease, authority, verification }) {
  const manifest = admissionManifest(request);
  const baseSha = authority.canonicalBaseSha;
  const existingLaneStateDigest = digestValue({
    schema: "agentic-root-source-legacy-review-state/v1", branch: request.branch,
    worktreePath: path.resolve(request.worktreePath), baseSha,
    fenceSha: request.expectedHeadSha, headSha: request.expectedHeadSha,
    epoch: lease.epoch, pullRequestUrl: lease.pullRequestUrl,
  });
  const planReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-plan/v1", branch: request.branch,
    semanticScope: manifest.semanticScope, manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest, existingLaneStateDigest,
  });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-preservation/v1", branch: request.branch,
    claimId: authority.claimId, claimDigest: authority.claimDigest,
    manifestDigest: manifest.manifestDigest,
    existingLaneStateDigest,
  });
  const admittedReportDigest = digestValue({
    schema: "agentic-root-source-legacy-review-admission/v1",
    branch: request.branch,
    semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    canonicalBaseSha: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    verificationReceiptDigest: verification.receiptDigest,
    preservationReceiptDigest,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: manifest.semanticScope, declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest,
    planReceiptDigest, admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest, admittedReportDigest, preservationReceiptDigest,
  });
}
