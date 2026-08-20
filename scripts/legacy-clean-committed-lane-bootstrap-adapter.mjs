import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  bindAdmissionCloudAuthority,
  claimLegacyReviewAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeCloudAuthority } from "./scoped-lane-admission-lib.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import {
  checkpointPath,
  createLegacyBootstrapRecoveryRequest,
  createDraftPullRequest,
  createIdentity,
  diffPaths,
  ensureDraftOwnershipPullRequest,
  findOpenPullRequest,
  git,
  gitExitCode,
  gitText,
  ghText,
  listScopeOwners,
  listedWorktrees,
  lsRemoteHead,
  nextLeaseEpoch,
  persistProjectedOutput,
  phaseOutput,
  findRecoverableLegacyBootstrapClaim,
  projectRecoveredLegacyBootstrapResult,
  projectionBaseSha,
  pullRequestNumber,
  readCurrentClaimInventory,
  readJson,
  requireRecoveredLegacyBootstrapClaim,
  requireLease,
  resolveAuthoredHeadSha,
  updatePullRequestBody,
  writeJson,
} from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";

export async function createLegacyBootstrapAdapter({ requestPath } = {}) {
  const bootstrapRequest = readJson(path.resolve(String(requestPath || "")));
  const worktreePath = path.resolve(String(bootstrapRequest?.worktreePath || ""));
  const repository = gitText(["rev-parse", "--show-toplevel"], { cwd: worktreePath });
  const gitCommonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd: worktreePath });
  const gitCommonDir = path.isAbsolute(gitCommonDirRaw)
    ? gitCommonDirRaw
    : path.resolve(repository, gitCommonDirRaw);
  const stateDir = path.join(gitCommonDir, "agentic-canvas-os", "legacy-clean-bootstrap");
  mkdirSync(stateDir, { recursive: true });
  const leaseStore = createWriterLeaseStore({ gitCommonDir });

  return {
    inspectLane: request => inspectLane({ request, repository, leaseStore, stateDir }),
    readCheckpoint: identityDigest => readCheckpoint({ identityDigest, stateDir }),
    writeCheckpoint: checkpoint => writeCheckpoint({ checkpoint, stateDir }),
    verifyFinal: context => verifyFinal({ context, repository, leaseStore, stateDir }),
    claimCloudAuthority: context => claimCloudAuthority({ context, repository, leaseStore, stateDir }),
    claimLocalLease: context => claimLocalLease({ context, repository, leaseStore, stateDir }),
    publishExactBranch: context => publishExactBranch({ context, repository, stateDir }),
    createDraftOwnershipRequest: context => createDraftOwnershipRequest({ context, repository, leaseStore, stateDir }),
    bindCloudAuthority: context => bindCloudAuthority({ context, repository, leaseStore, stateDir }),
    projectOwnerReceipt: context => projectOwnerReceipt({ context, repository, leaseStore, stateDir }),
  };
}

function inspectLane({ request, repository, leaseStore, stateDir }) {
  const worktreePath = path.resolve(request.worktreePath);
  const headSha = gitText(["rev-parse", "HEAD"], { cwd: worktreePath });
  const treeSha = gitText(["rev-parse", `${headSha}^{tree}`], { cwd: worktreePath });
  const authoredHeadSha = resolveAuthoredHeadSha({
    branch: request.branch,
    headSha,
    leaseStore,
    worktreePath,
  });
  const changedPaths = diffPaths({
    cwd: worktreePath,
    from: request.expectedBaseSha,
    to: authoredHeadSha,
  });
  const identity = createIdentity({ request, headSha, treeSha, changedPaths });
  const checkpoint = readCheckpoint({ identityDigest: identity.identityDigest, stateDir });
  const pullRequest = findOpenPullRequest({ branch: request.branch, repository });
  const { claims: claimInventory } = readCurrentClaimInventory({ request });
  const projectedClaimId = checkpoint?.outputs?.cloudClaim?.authority?.claimId || null;
  const canonicalBaseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const recoverableClaim = findRecoverableLegacyBootstrapClaim({
    claims: claimInventory,
    request,
    checkpoint,
    identity,
    canonicalBaseSha,
  });
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
      .filter(claim => claim.claimId !== projectedClaimId)
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
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
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

function bindCloudAuthority({ context, leaseStore, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  if (!lease.pullRequestUrl) {
    throw new Error("Legacy bootstrap bind requires an ownership pull request URL.");
  }
  const priorAuthority = context.checkpoint?.outputs?.cloudClaim?.authority;
  if (!priorAuthority) {
    throw new Error("Legacy bootstrap bind requires the claimed cloud authority output.");
  }
  const bound = bindAdmissionCloudAuthority({
    authority: priorAuthority,
    manifest: admissionManifest(request),
    branch: request.branch,
    headSha: request.expectedHeadSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    deviceId: request.deviceId,
    sessionId: request.sessionId,
    returnVerification: true,
  });
  const output = phaseOutput("boundAuthority", context.identity.identityDigest, {
    branch: request.branch,
    authority: bound.authority,
    verification: bound.verification,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
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
  const baseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const annotated = leaseStore.annotate({
    sessionId: request.sessionId,
    branch: request.branch,
    values: {
      baseSha,
      fenceSha: request.expectedHeadSha,
      pullRequestUrl: lease.pullRequestUrl,
      admission,
      cloudAuthority: authority,
    },
  });
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
  const projected = readOwnershipPullRequest({
    url: annotated.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const marker = parseWriterLeasePullRequestBody(projected.body);
  if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(annotated))) {
    throw new Error("Legacy bootstrap owner projection did not preserve the exact writer lease marker.");
  }
  const output = phaseOutput("ownerProjection", context.identity.identityDigest, {
    branch: request.branch,
    admission,
    authority,
    pullRequestUrl: annotated.pullRequestUrl,
    markerDigest: digestValue(marker),
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function verifyFinal({ context, repository, leaseStore, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  if (pullRequest.headRefOid !== request.expectedHeadSha) {
    throw new Error(`Legacy bootstrap PR head ${pullRequest.headRefOid} drifted from ${request.expectedHeadSha}.`);
  }
  const marker = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Legacy bootstrap final PR marker drifted.");
  }
  verifyAdmissionCloudAuthority({
    authority: lease.cloudAuthority,
    manifest: lease.admission,
    canonicalBaseSha: projectionBaseSha({
      headSha: request.expectedHeadSha,
      requestBaseSha: request.expectedBaseSha,
      worktreePath: request.worktreePath,
    }),
  });
  return inspectLane({ request, repository, leaseStore, stateDir });
}

function admissionManifest(request) {
  return {
    schema: "agentic-declared-write-scope/v1",
    semanticScope: request.semanticScope,
    declaredWriteSet: normalizeWriteSet(request.declaredWriteScope),
    writeSetDigest: request.writeSetDigest,
    manifestDigest: digestValue({
      schema: "agentic-declared-write-scope/v1",
      semanticScope: request.semanticScope,
      declaredWriteSet: normalizeWriteSet(request.declaredWriteScope),
    }),
    admittedReportDigest: digestValue({
      schema: "agentic-legacy-bootstrap-admitted-report-input/v1",
      branch: request.branch,
      semanticScope: request.semanticScope,
      writeSetDigest: request.writeSetDigest,
      headSha: request.expectedHeadSha,
    }),
  };
}

function createAdmissionProjection({ request, lease, authority, verification }) {
  const manifest = admissionManifest(request);
  const baseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const existingLaneStateDigest = digestValue({
    schema: "agentic-root-source-legacy-review-state/v1",
    branch: request.branch,
    worktreePath: path.resolve(request.worktreePath),
    baseSha,
    fenceSha: request.expectedHeadSha,
    headSha: request.expectedHeadSha,
    epoch: lease.epoch,
    pullRequestUrl: lease.pullRequestUrl,
  });
  const planReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-plan/v1",
    branch: request.branch,
    semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    existingLaneStateDigest,
  });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-preservation/v1",
    branch: request.branch,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
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
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: manifest.semanticScope,
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    planReceiptDigest,
    admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest,
  });
}
