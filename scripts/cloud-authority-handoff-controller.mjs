#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { continueClaimedReviewSuccessorCloudAuthority, invokeRepositoryCloudAction,
  recoverIntegratedPreservedCloudAuthority, reviewReadyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { sanitizeCloudAuthorityDiagnostic } from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  assertIntegratedReplayRecovery,
  assertResumableSuccessorReplay,
  buildCloudAuthoritySuccessorClaimRequest,
  buildHandoffReceipt,
  classifyIntegratedReplay,
  classifyPredecessor,
  classifyResumableSuccessor,
  CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
  CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA,
  emptyResumableSuccessor,
  finalizeContinuationResult,
  normalizeContinuationRequest,
  projectSuccessorClaimAuthority,
  validateContinuation,
} from "./cloud-authority-handoff-lineage.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import { createWriterLeaseStore, parseDeviceBranch, parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
export { buildCloudAuthoritySuccessorClaimRequest, CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA, CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA };
const SHA_PATTERN = /^[0-9a-f]{40}$/u, DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export function createCloudAuthorityHandoffControllerAdapter(methods = {}) {
  const adapter = Object.freeze({
    readPreservedReviewLane: methods.readPreservedReviewLane,
    readAuthenticatedOwner: methods.readAuthenticatedOwner,
    readCloudStatus: methods.readCloudStatus,
    claimSuccessor: methods.claimSuccessor,
    bindAndReviewReady: methods.bindAndReviewReady,
    persistReviewProjection: methods.persistReviewProjection,
    recoverIntegratedAuthority: methods.recoverIntegratedAuthority,
  });
  for (const key of ["readPreservedReviewLane", "readAuthenticatedOwner", "readCloudStatus",
    "claimSuccessor", "bindAndReviewReady", "persistReviewProjection"]) {
    if (typeof adapter[key] !== "function") {
      throw new Error(`Controller adapter method ${key} must be a function.`);
    }
  }
  if (adapter.recoverIntegratedAuthority !== undefined && typeof adapter.recoverIntegratedAuthority !== "function") {
    throw new Error("Controller adapter method recoverIntegratedAuthority must be a function when provided.");
  }
  return adapter;
}
export async function continueExpiredReviewLaneAuthority(input, { adapter, lineageAdmission = null } = {}) {
  const request = normalizeContinuationRequest(input);
  if (!parseDeviceBranch(request.branch)) {
    throw new Error("Cloud authority continuation requires a canonical agent/device/scope branch.");
  }
  const lane = await adapter.readPreservedReviewLane({ branch: request.branch });
  const actor = await adapter.readAuthenticatedOwner();
  const status = await adapter.readCloudStatus({
    ledgerRepository: lane.authority.ledgerRepository,
    targetRepository: lane.authority.targetRepository,
  });
  const predecessor = classifyPredecessor({ lane, actor, status, request, lineageAdmission });
  const integratedReplay = classifyIntegratedReplay({ request, lane, actor, status, predecessor });
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
  });
  const preflightReceipt = buildHandoffReceipt("preflight", {
    branch: lane.branch,
    transition: request.transition,
    repository: lane.repository,
    baseSha: lane.baseSha,
    headSha: lane.headSha,
    reviewRequestId: lane.authority.reviewRequestId,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    predecessorWorkItemId: predecessor.claim?.workItemId || null,
    successorDeviceId: request.successorDeviceId,
    successorSessionId: request.successorSessionId,
    resumableSuccessorClaimId: successor.claim?.claimId || null,
    integratedReplayClaimId: integratedReplay.claim?.claimId || null,
    actorLogin: actor.login,
    blockingFindingDigest: digestValue(findings),
  });
  if (findings.length > 0) {
    return finalizeContinuationResult({
      request,
      lane,
      outcome: "blocked",
      actor,
      blockingFindings: findings,
      receipts: [preflightReceipt],
    });
  }
  if (request.transition === "retain") {
    return finalizeContinuationResult({
      request,
      lane,
      outcome: "retained-legacy",
      actor,
      receipts: [preflightReceipt],
    });
  }
  if (integratedReplay.claim) {
    if (typeof adapter.recoverIntegratedAuthority !== "function") {
      throw new Error("Integrated-preserved replay requires a recovery adapter method.");
    }
    const recovered = await adapter.recoverIntegratedAuthority({
      request,
      lane,
      integratedReplay,
    });
    assertIntegratedReplayRecovery({ recovered, integratedReplay, lane });
    const replayReceipt = buildHandoffReceipt("integrated-authority-converged", {
      branch: lane.branch,
      transition: request.transition,
      claimId: recovered.authority.claimId,
      leaseEpoch: recovered.authority.leaseEpoch,
      reviewRequestId: recovered.authority.reviewRequestId,
      convergenceEvidenceDigest: requiredDigest(
        recovered.convergenceEvidenceDigest,
        "integrated replay convergence evidence digest",
      ),
      currentOperationReceiptDigest: requiredDigest(
        recovered.authority.operationReceiptDigest,
        "integrated replay current operation receipt digest",
      ),
      integrationReceiptDigest: requiredDigest(
        recovered.authority.integrationReceiptDigest,
        "integrated replay integration receipt digest",
      ),
      projectionUpdated: false,
    });
    return finalizeContinuationResult({
      request,
      lane,
      actor,
      outcome: "reclaimed-live-replay",
      authority: recovered.authority,
      receipts: [preflightReceipt, replayReceipt],
      projectionUpdated: false,
    });
  }
  const claimResult = await adapter.claimSuccessor({
    request,
    lane,
    predecessor: predecessor.claim,
  });
  assertResumableSuccessorReplay({
    claimResult,
    resumableSuccessor: successor.claim,
    lane,
    predecessor: predecessor.claim,
  });
  const claimAuthority = projectSuccessorClaimAuthority({
    result: claimResult,
    lane,
    successorDeviceId: request.successorDeviceId,
    successorSessionId: request.successorSessionId,
  });
  const ready = await adapter.bindAndReviewReady({
    request,
    lane,
    authority: claimAuthority,
    claimResult,
    resumableSuccessor: successor.claim,
  });
  const projectLocal = (
    request.transition === "reclaim"
    && request.successorDeviceId === lane.lease.device
    && request.successorSessionId === lane.lease.sessionId
  );
  const projectionReceipt = projectLocal
    ? await adapter.persistReviewProjection({
      request,
      lane,
      authority: ready.authority,
    })
    : null;
  const continuationReceipt = buildHandoffReceipt("continuation", {
    branch: lane.branch,
    transition: request.transition,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorClaimId: ready.authority.claimId,
    successorLeaseEpoch: ready.authority.leaseEpoch,
    reviewRequestId: ready.authority.reviewRequestId,
    projectionUpdated: projectLocal,
    claimReceiptDigest: requiredDigest(
      claimResult.receipt?.receiptDigest,
      "claim receipt digest",
    ),
    reviewReadyReceiptDigest: requiredDigest(
      ready.verification.receiptDigest,
      "review-ready receipt digest",
    ),
    projectionReceiptDigest: projectionReceipt?.receiptDigest || null,
  });
  return finalizeContinuationResult({
    request,
    lane,
    actor,
    outcome: request.transition === "reclaim" ? "reclaimed-live" : "handed-off-live",
    authority: ready.authority,
    receipts: [preflightReceipt, continuationReceipt, ...(projectionReceipt ? [projectionReceipt] : [])],
    projectionUpdated: projectLocal,
  });
}
export function createRepositoryCloudAuthorityHandoffControllerAdapter({
  repository, sessionId, environment = process.env, gitText = null, ghText = null,
  run = null, leaseStore = null, resolveRealpath = realpathSync,
} = {}) {
  const repoRoot = resolveRealpath(path.resolve(requiredText(repository, "repository")));
  const subprocess = { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const git = gitText || (args => execFileSync("git", args, subprocess));
  const gh = ghText || (args => execFileSync("gh", args, subprocess));
  const execute = run || ((command, args) => execFileSync(command, args, subprocess));
  let store = leaseStore;
  function registeredStore(branch) {
    if (!parseDeviceBranch(branch)) throw new Error("Controller branch identity is invalid.");
    const record = assertRegisteredWorktree({
      cwd: repoRoot, porcelain: git(["worktree", "list", "--porcelain", "-z"]),
      resolvePath: value => path.resolve(value),
    });
    if (record.branch !== `refs/heads/${branch}`
      || path.resolve(git(["rev-parse", "--show-toplevel"]).trim()) !== repoRoot) {
      throw new Error("Controller requires the exact registered branch worktree root.");
    }
    store ||= createWriterLeaseStore({
      gitCommonDir: path.resolve(repoRoot, git(["rev-parse", "--git-common-dir"]).trim()),
    });
    return store;
  }
  return createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane({ branch }) {
      const laneStore = registeredStore(branch);
      const branchRef = `refs/heads/${branch}`, remoteRef = `refs/remotes/origin/${branch}`;
      execute("git", ["fetch", "--no-tags", "origin",
        "+refs/heads/main:refs/remotes/origin/main", `+${branchRef}:${remoteRef}`]);
      const currentBranch = requiredText(git(["branch", "--show-current"]).trim(), "current branch");
      if (branch !== currentBranch) {
        throw new Error(`Controller requires ${branch} checked out; received ${currentBranch}.`);
      }
      const lease = laneStore.read(branch);
      if (!lease) throw new Error(`No writer lease records ${branch}.`);
      const pullRequest = readOwnershipPullRequest({
        url: requiredText(lease.pullRequestUrl, "pullRequestUrl"),
        branch,
        ghText: args => gh(args),
      });
      const pullWithAuthor = JSON.parse(gh([
        "pr",
        "view",
        pullRequest.url,
        "--json",
        "id,author,url,state,isDraft,headRefName,headRefOid,baseRefName,body",
      ]));
      const remoteLease = parseWriterLeasePullRequestBody(pullWithAuthor.body);
      const admission = normalizeManifestFromLease(lease.admission);
      const authority = normalizePreservedAuthority(lease.cloudAuthority, admission);
      const reviewHeadSha = requiredSha(lease.reviewHeadSha, "lease reviewHeadSha");
      const localHeadSha = requiredSha(git(["rev-parse", "HEAD"]).trim(), "local HEAD");
      const remoteHeadSha = requiredSha(git(["rev-parse", remoteRef]).trim(), "remote HEAD");
      const pullRequestHeadSha = requiredSha(pullWithAuthor.headRefOid, "pull request head");
      const protectedMainRefresh = detectProtectedMainRefresh({
        reviewedHeadSha: reviewHeadSha,
        localHeadSha,
        remoteHeadSha,
        pullRequestHeadSha,
        gitText: git,
      });
      return Object.freeze({
        repository: repoRoot,
        branch,
        headSha: reviewHeadSha,
        refreshedHeadSha: protectedMainRefresh ? localHeadSha : null,
        remoteHeadSha,
        clean: git(["status", "--porcelain"]).trim() === "",
        baseSha: requiredSha(lease.baseSha, "lease baseSha"),
        lease,
        manifest: admission,
        authority,
        protectedMainRefresh,
        pullRequest: Object.freeze({
          id: requiredText(pullWithAuthor.id, "pull request node ID"),
          url: pullWithAuthor.url,
          state: pullWithAuthor.state,
          isDraft: pullWithAuthor.isDraft,
          headRefName: pullWithAuthor.headRefName,
          headRefOid: pullRequestHeadSha,
          baseRefName: pullWithAuthor.baseRefName,
          body: pullWithAuthor.body,
          authorLogin: requiredText(pullWithAuthor.author?.login, "pull request author"),
        }),
        remoteLease,
      });
    },
    readAuthenticatedOwner() {
      const user = JSON.parse(gh(["api", "user"]));
      return Object.freeze({
        id: Number(user.id),
        login: requiredText(user.login, "authenticated login"),
      });
    },
    readCloudStatus({ ledgerRepository, targetRepository }) {
      const repositoryNodeId = requiredText(gh([
        "api", `repos/${targetRepository}`, "--jq", ".node_id",
      ]), "target repository node identity");
      const status = invokeRepositoryCloudAction({
        action: "status",
        ledgerRepository,
        request: { targetRepository },
        environment,
      });
      return Object.freeze({ ...status, repositoryId: `github-repository:${repositoryNodeId}` });
    },
    claimSuccessor({ request, lane, predecessor }) {
      return invokeRepositoryCloudAction({
        action: "claim",
        ledgerRepository: lane.authority.ledgerRepository,
        request: buildCloudAuthoritySuccessorClaimRequest({
          request,
          lane,
          predecessor,
        }),
        environment,
      });
    },
    bindAndReviewReady({ request, lane, authority, claimResult, resumableSuccessor }) {
      const pullRequestNumberValue = lane.protectedMainRefresh
        ? null
        : pullRequestNumber(lane.pullRequest.url);
      const continued = continueClaimedReviewSuccessorCloudAuthority({
        authority,
        claimResult,
        observedClaim: resumableSuccessor || claimResult.claim,
        manifest: lane.manifest,
        branch: lane.branch,
        headSha: lane.headSha,
        pullRequestNumber: pullRequestNumberValue,
        reviewRequestId: lane.authority.reviewRequestId,
        focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
        ttlSeconds: request.ttlSeconds,
        deviceId: request.successorDeviceId,
        sessionId: request.successorSessionId,
        environment,
        invoke: invokeRepositoryCloudAction,
        inspect: invokeRepositoryCloudAction,
        verify: invokeRepositoryCloudVerifier,
      });
      const currentAuthority = continued.authority;
      if (lane.protectedMainRefresh) {
        return reviewReadyAdmissionCloudAuthority({
          authority: currentAuthority,
          manifest: lane.manifest,
          branch: lane.branch,
          headSha: lane.headSha,
          reviewRequestId: lane.authority.reviewRequestId,
          focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
          deviceId: request.successorDeviceId,
          sessionId: request.successorSessionId,
          environment,
          invoke: invokeRepositoryCloudAction,
          inspect: invokeRepositoryCloudAction,
          verify: invokeRepositoryCloudVerifier,
        });
      }
      return reviewReadyAdmissionCloudAuthority({
        authority: currentAuthority,
        manifest: lane.manifest,
        branch: lane.branch,
        headSha: lane.headSha,
        pullRequestNumber: pullRequestNumber(lane.pullRequest.url),
        deviceId: request.successorDeviceId,
        sessionId: request.successorSessionId,
        environment,
        invoke: invokeRepositoryCloudAction,
        inspect: invokeRepositoryCloudAction,
        verify: invokeRepositoryCloudVerifier,
      });
    },
    recoverIntegratedAuthority({ request, lane, integratedReplay }) {
      return recoverIntegratedPreservedCloudAuthority({
        authority: lane.authority,
        integratedClaim: integratedReplay.claim,
        queuedSuccessor: integratedReplay.queuedClaim,
        manifest: lane.manifest,
        branch: lane.branch,
        headSha: lane.headSha,
        focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
        ttlSeconds: request.ttlSeconds,
        deviceId: request.successorDeviceId,
        sessionId: request.successorSessionId,
        environment,
        invoke: invokeRepositoryCloudAction,
        inspect: invokeRepositoryCloudAction,
        verify: invokeRepositoryCloudVerifier,
      });
    },
    persistReviewProjection({ lane, authority }) {
      const updatedLease = store.release({
        sessionId,
        branch: lane.branch,
        status: "review_ready",
        timestamp: authority.expiresAt,
        values: {
          reviewHeadSha: lane.headSha,
          cloudAuthority: authority,
        },
      });
      if (updatedLease.status !== "review_ready"
        || updatedLease.heartbeatAt !== authority.expiresAt || updatedLease.expiresAt !== authority.expiresAt
        || updatedLease.cloudAuthority?.claimId !== authority.claimId) {
        throw new Error("Local review-ready projection did not preserve exact cloud expiry and authority.");
      }
      execute("gh", [
        "pr", "edit", lane.pullRequest.url,
        "--body", updateWriterLeasePullRequestBody(lane.pullRequest.body, updatedLease),
      ]);
      const verifiedPull = readOwnershipPullRequest({
        url: lane.pullRequest.url,
        branch: lane.branch,
        ghText: args => gh(args),
      });
      const verifiedLease = parseWriterLeasePullRequestBody(verifiedPull.body);
      if (
        !verifiedLease
        || verifiedLease.reviewHeadSha !== lane.headSha
        || verifiedLease.cloudAuthority?.claimId !== authority.claimId
      ) {
        throw new Error("Updated pull request body did not preserve the exact review-ready projection.");
      }
      return buildHandoffReceipt("projection", {
        branch: lane.branch,
        pullRequestUrl: lane.pullRequest.url,
        reviewHeadSha: lane.headSha,
        successorClaimId: authority.claimId,
        successorLeaseEpoch: authority.leaseEpoch,
        reviewRequestId: authority.reviewRequestId,
      });
    },
  });
}
function normalizeManifestFromLease(admission) {
  if (!admission || admission.status !== "admitted") {
    throw new Error("Controller requires an admitted lane manifest.");
  }
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  return Object.freeze({
    declaredWriteSet,
    writeSetDigest: requiredDigest(admission.writeSetDigest, "admission writeSetDigest"),
    admittedReportDigest: requiredDigest(admission.admittedReportDigest, "admittedReportDigest"),
    manifestDigest: requiredDigest(admission.manifestDigest, "manifestDigest"),
  });
}
function detectProtectedMainRefresh({
  reviewedHeadSha,
  localHeadSha,
  remoteHeadSha,
  pullRequestHeadSha,
  gitText,
}) {
  if (
    localHeadSha === reviewedHeadSha
    || localHeadSha !== remoteHeadSha
    || localHeadSha !== pullRequestHeadSha
  ) {
    return null;
  }
  try {
    return verifyProtectedMainRefreshChain({
      expectedHeadSha: reviewedHeadSha,
      observedHeadSha: localHeadSha,
      gitText,
    });
  } catch {
    return null;
  }
}
function normalizePreservedAuthority(authority, manifest) {
  if (!authority || authority.state !== "review_ready") {
    throw new Error("Controller requires an expired review-ready cloud authority.");
  }
  if (requiredDigest(authority.writeSetDigest, "authority writeSetDigest") !== manifest.writeSetDigest) {
    throw new Error("Authority write-set digest drifted from its admitted manifest.");
  }
  return Object.freeze({
    ...authority,
    claimId: requiredDigest(authority.claimId, "claimId"),
    claimDigest: requiredDigest(authority.claimDigest, "claimDigest"),
    claimLedgerRevision: requiredDigest(authority.claimLedgerRevision, "claimLedgerRevision"),
    ledgerRevision: requiredSha(authority.ledgerRevision, "ledgerRevision"),
    canonicalBaseSha: requiredSha(authority.canonicalBaseSha, "canonicalBaseSha"),
    laneRevision: requiredSha(authority.laneRevision, "laneRevision"),
    leaseEpoch: positiveInteger(authority.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(authority.transitionCounter, "transitionCounter"),
    reviewRequestId: requiredText(authority.reviewRequestId, "reviewRequestId"),
    expiresAt: requiredText(authority.expiresAt, "expiresAt"),
    focusedEvidenceDigest: requiredDigest(authority.focusedEvidenceDigest, "focusedEvidenceDigest"),
    cloudDeclaredWriteScope: normalizeWriteSet(authority.cloudDeclaredWriteScope),
  });
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
  if (!Number.isSafeInteger(integer) || integer < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return integer;
}
function pullRequestNumber(url) {
  const match = String(url || "").match(/\/pull\/(\d+)$/u);
  if (!match) throw new Error(`Pull request URL ${url} has no numeric identifier.`);
  return Number(match[1]);
}
function option(argumentsList, name) {
  const prefix = `--${name}=`;
  const inline = argumentsList.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : "";
}
function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
async function main() {
  const [transition = "reclaim", ...argumentsList] = process.argv.slice(2);
  const json = argumentsList.includes("--json");
  try {
    const requestedBranch = option(argumentsList, "branch");
    if (requestedBranch && !parseDeviceBranch(requestedBranch)) {
      throw new Error("--branch must use the canonical agent/device/scope form.");
    }
    const repository = path.resolve(
      option(argumentsList, "repository")
        || execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
    );
    const branch = option(argumentsList, "branch")
      || execFileSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).trim();
    if (!parseDeviceBranch(branch)) throw new Error("Current branch is not a canonical agent branch.");
    const sessionId = option(argumentsList, "session");
    if (!sessionId) throw new Error("--session is required.");
    const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
      repository, sessionId, environment: process.env,
    });
    const result = await continueExpiredReviewLaneAuthority({
      transition,
      branch,
      sessionId,
      successorSessionId: option(argumentsList, "successor-session") || sessionId,
      successorDeviceId: option(argumentsList, "successor-device")
        || option(argumentsList, "device-id")
        || parseDeviceBranch(branch)?.device,
      ttlSeconds: option(argumentsList, "ttl-seconds") || 1800,
    }, { adapter });
    emit(result);
    if (result.outcome === "blocked") process.exitCode = 1;
  } catch (error) {
    const result = {
      schema: CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
      outcome: "blocked",
      transition: transition || null,
      error: { message: sanitizeCloudAuthorityDiagnostic(error) },
    };
    if (!json) throw error;
    emit(result);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
