#!/usr/bin/env node
// Responsibility: Dispatch fenced device lifecycle commands and machine-readable results.
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import {
  createCoordinationClaimRunAdapter, createDeviceChildProcessPolicy,
} from "./device-child-process-policy.mjs";
import {
  parseJsonObject, readJsonFile, readOption, readOptions, requiredOption,
} from "./device-command-input.mjs";
import {
  completeSession, heartbeat, park, publish, resume, review, sanitizeDevice,
  sanitizeScope, start,
} from "./device-branch-lib.mjs";
import { createDeviceCommandError, createDeviceCommandResult } from "./device-command-result.mjs";
import { runProvisionedStartAdmissionRecoveryCli } from "./provisioned-start-admission-recovery.mjs";
import { integrateSession } from "./device-integrate-lib.mjs";
import { createPostMergeCloudAuthorityVerifier } from
  "./post-merge-cloud-authority-verifier.mjs";
import {
  readOwnershipPullRequest, requireOwnershipPullRequestDraft,
} from "./device-pull-request-state.mjs";
import {
  inspectTaskWorktreeTarget, provisionTaskWorktree, rollbackUnclaimedProvision,
} from "./task-worktree-provision.mjs";
import {
  createWriterLeaseStore, DEFAULT_WRITER_LEASE_TTL_MS, parseDeviceBranch,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  assertRootSourceBootstrapCurrent, createAdmissionLeaseProjection,
  evaluateScopedLaneAdmission, normalizeCloudAuthority,
  normalizeDeclaredWriteScopeManifest,
} from "./scoped-lane-admission-lib.mjs";
import {
  attachCloudHeartbeatMachineEvidence, bindAdmissionCloudAuthority,
  heartbeatAdmissionCloudAuthority, reconcileAdmissionCloudAuthority,
  reviewReadyAdmissionCloudAuthority, verifyAdmissionCloudAuthority,
  verifyReviewReadyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  assertAdmissionMutationAuthority, assertPeersUnchanged,
  assertWorkspaceGuardsReady, attachAdmissionReceipt, collectScopedLaneState,
  finalizeScopedLaneAdmission, verifyPreservedLaneState,
} from "./scoped-lane-admission-state.mjs";
import { continuePlannedAdmissionFromRepository } from "./scoped-lane-admission-continuation.mjs";
import {
  createDeviceDormantPreservationAdmissionGate,
  createDeviceDormantPreservationPlannedContinuationGate,
} from "./dormant-preservation-decision-repository-adapter.mjs";
const [command, ...args] = process.argv.slice(2);
if (command === "recover-start-admission") {
  try {
    console.log(JSON.stringify(runProvisionedStartAdmissionRecoveryCli(args)));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ schema: "agentic-provisioned-start-admission-recovery-command/v1", ok: false,
      status: "error", error: { code: "provisioned_start_admission_recovery_failed", message: error.message } }));
    process.exit(1);
  }
}
const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let workspaceGuardControllerRoot = controllerRoot;
let scriptControllerRoot = controllerRoot;
if (!command || !["start", "resume", "heartbeat", "review", "publish", "integrate", "park", "complete", "end"].includes(command)) usage();
const json = args.includes("--json");
const provisionRequested = args.includes("--provision");
const autoDelivery = args.includes("--auto-delivery");
const recoverOwnedDirt = args.includes("--recover-owned-dirt");
const repairPullRequestProjection = args.includes("--repair-pr-projection");
const continueAdmission = args.includes("--continue-admission");
const rawScope = args.find((value) => !value.startsWith("--"));
const sessionId = readOption(args, "session") || process.env.AGENTIC_SESSION_ID || "";
if (sessionId) process.env.AGENTIC_SESSION_ID = sessionId;
const childProcessEnvironment = { ...process.env };
const taskAuthorityInput = readOption(args, "task-authority")
  || process.env.AGENTIC_TASK_AUTHORITY_FILE || "";
const taskAuthorityFile = taskAuthorityInput ? path.resolve(taskAuthorityInput) : "";
// The capability locator is controller input, never ambient authority for child processes.
delete process.env.AGENTIC_TASK_AUTHORITY_FILE;
const {
  gitText, gitOptional, ghText, ghOptional, run, runText,
  commitCoordinationClaim,
} = createDeviceChildProcessPolicy({
  taskAuthorityFile,
  environment: childProcessEnvironment,
  json,
});
let repo = null;
let canonicalRepo = null;
let provision = null;
let admissionReport = null;
let admissionProjection = null;
let admissionManifest = null;
let verifiedCloudAuthority = null;
let mutationAuthorityReceipt = null;
const invocationPath = path.resolve(
  readOption(args, "repository") || process.env.AGENTIC_TARGET_REPOSITORY || process.env.INIT_CWD || process.cwd(),
);
const requestedWorktreePath = readOption(args, "worktree");
const writeScopeManifestPath = readOption(args, "write-scope-manifest");
const cloudAuthorityPath = readOption(args, "cloud-authority");
const rootSourceBootstrapInput = readOption(args, "root-source-bootstrap");
const dormantWorktreePaths = readOptions(args, "dormant-preservation");
const dormantPullRequests = readOptions(args, "dormant-preservation-pr");
try {
  workspaceGuardControllerRoot = resolveWorkspaceGuardControllerRoot(args);
  scriptControllerRoot = workspaceGuardControllerRoot;
  if (autoDelivery && command !== "start") {
    throw new Error("--auto-delivery is accepted only by device:start; authorization is immutable for the task lease.");
  }
  if (recoverOwnedDirt && command !== "resume") {
    throw new Error("--recover-owned-dirt is accepted only by device:resume.");
  }
  if (repairPullRequestProjection && command !== "heartbeat") {
    throw new Error("--repair-pr-projection is accepted only by device:heartbeat.");
  }
  if (continueAdmission && command !== "heartbeat") {
    throw new Error("--continue-admission is accepted only by device:heartbeat.");
  }
  if (rootSourceBootstrapInput && (command !== "start" || !provisionRequested)) {
    throw new Error("--root-source-bootstrap is accepted only by provisioned device:start.");
  }
  const ttlSeconds = Number(readOption(args, "ttl-seconds") || DEFAULT_WRITER_LEASE_TTL_MS / 1000);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("--ttl-seconds must be a positive number.");
  process.chdir(invocationPath);
  canonicalRepo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(canonicalRepo);
  if (taskAuthorityFile) assertExternalTaskAuthorityFile(taskAuthorityFile, canonicalRepo);
  if (command === "start") {
    scriptControllerRoot = bindControllerHooksEnvironment(scriptControllerRoot);
    assertWorkspaceGuardsReady({
      repository: canonicalRepo,
      controllerRoot: scriptControllerRoot,
    });
  }
  let activeInvocationPath = invocationPath;
  if (provisionRequested) {
    if (command !== "start") throw new Error("--provision is supported only by device:start.");
    if (!writeScopeManifestPath || !cloudAuthorityPath) {
      throw new Error(
        "--provision requires --write-scope-manifest and --cloud-authority from the repository cloud claim.",
      );
    }
    run("git", ["fetch", "origin", "main"]);
    const before = collectScopedLaneState({ repository: canonicalRepo });
    const rootSourceBootstrapAuthorization = rootSourceBootstrapInput
      ? parseJsonObject(
        rootSourceBootstrapInput,
        "root-source bootstrap authorization",
      )
      : null;
    const targetPlan = inspectTaskWorktreeTarget({
      invocationPath,
      repoRoot: canonicalRepo,
      targetPath: requestedWorktreePath,
      gitText,
      allowDirtyCanonicalForRootBootstrap: Boolean(rootSourceBootstrapAuthorization),
    });
    const normalizedScope = sanitizeScope(rawScope);
    const device = sanitizeDevice(
      gitOptional(["config", "--get", "agentic.device"])
      || os.hostname(),
    );
    const branch = `agent/${device}/${normalizedScope}`;
    const manifest = normalizeDeclaredWriteScopeManifest(
      readJsonFile(writeScopeManifestPath, "declared write-scope manifest"),
      { expectedScope: normalizedScope },
    );
    admissionManifest = manifest;
    const targetRepository = readOption(args, "target-repository")
      || ghText(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
    const authority = normalizeCloudAuthority(
      readJsonFile(cloudAuthorityPath, "cloud authority"),
      {
        ledgerRepository: readOption(args, "ledger-repository")
          || process.env.AGENTIC_LEDGER_REPOSITORY
          || "huijoohwee/agentic-canvas-os",
        targetRepository,
        manifest,
        canonicalBaseSha: before.canonicalBaseSha,
      },
    );
    const dormantGate = createDeviceDormantPreservationAdmissionGate({
      argumentsList: args, controllerRoot: scriptControllerRoot,
      repository: canonicalRepo, targetRepository, targetPath: targetPlan.target,
      manifest, authority, sessionId, worktreePaths: dormantWorktreePaths,
      pullRequestReferences: dormantPullRequests, gitText,
    });
    const { verified, dormantPreservationReceipt, decision } = dormantGate.verify({
      laneState: before, targetPlan,
    });
    verifiedCloudAuthority = verified.authority;
    admissionReport = evaluateScopedLaneAdmission({
      repository: canonicalRepo,
      canonicalPath: canonicalRepo,
      canonicalBaseSha: before.canonicalBaseSha,
      canonicalSourceDisposition: before.canonicalSourceDisposition,
      targetPath: targetPlan.target,
      branch,
      semanticScope: normalizedScope,
      targetSafe: true,
      manifest,
      lanes: before.lanes,
      cloudAuthority: verifiedCloudAuthority,
      remoteAuthorityRequired: true,
      remoteAuthorityVerification: verified.verification,
      dormantPreservationReceipt,
      rootSourceBootstrapAuthorization,
      mode: "check",
    });
    if (admissionReport.authoringAdmission.status !== "planned") {
      throw new Error("Scoped lane admission blocked before worktree mutation.");
    }
    admissionReport = attachAdmissionReceipt({
      report: admissionReport,
      targetObservationDigest: targetPlan.targetObservationDigest,
      remoteAuthorityVerification: verified.verification,
    });
    admissionProjection = createAdmissionLeaseProjection(admissionReport);
    const canonicalCommonDir = path.resolve(
      canonicalRepo,
      gitText(["rev-parse", "--git-common-dir"]).trim(),
    );
    const admissionLeaseStore = createWriterLeaseStore({
      gitCommonDir: canonicalCommonDir,
    });
    run("git", ["fetch", "origin", "main"]);
    provision = admissionLeaseStore.withRegistryLock(() => {
      dormantGate.revalidate({ expectedDecision: decision });
      return provisionTaskWorktree({
        invocationPath, repoRoot: canonicalRepo, targetPath: requestedWorktreePath,
        gitText, run, expectedBaseSha: before.canonicalBaseSha,
        expectedTargetObservationDigest: targetPlan.targetObservationDigest,
        fetchBase: false,
        allowDirtyCanonicalForRootBootstrap: Boolean(
          admissionReport.rootSourceBootstrapAuthorization,
        ),
      });
    });
    activeInvocationPath = provision.target;
  } else if (requestedWorktreePath) {
    throw new Error("--worktree requires --provision.");
  }
  process.chdir(activeInvocationPath);
  repo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(repo);
  const gitCommonDir = path.resolve(repo, gitText(["rev-parse", "--git-common-dir"]).trim());
  const leaseStore = createWriterLeaseStore({
    gitCommonDir,
    taskAuthorityFile: taskAuthorityFile || null,
    taskAuthorityPolicy: "required",
  });
  const attachedBranch = gitText(["branch", "--show-current"]).trim();
  const authorityBranch = command === "resume" ? rawScope : attachedBranch;
  const coordinationClaimScope = command === "resume"
    ? parseDeviceBranch(rawScope)?.scope
    : rawScope ? sanitizeScope(rawScope) : "";
  const coordinationClaimBranch = command === "resume"
    ? rawScope
    : coordinationClaimScope
      ? `agent/${sanitizeDevice(
        gitOptional(["config", "--get", "agentic.device"]) || os.hostname(),
      )}/${coordinationClaimScope}`
      : "";
  if (authorityBranch && leaseStore.read(authorityBranch)) {
    leaseStore.assertTaskAuthority({
      branch: authorityBranch,
      operation: `device:${command}`,
    });
  }
  const context = {
    scope: rawScope,
    invocationPath: activeInvocationPath,
    repo,
    gitText,
    gitOptional,
    ghText,
    ghOptional,
    leaseStore,
    sessionId,
    leaseTtlMs: ttlSeconds * 1000,
    autoDelivery,
    recoverOwnedDirt,
    repairPullRequestProjection,
    admission: admissionProjection,
    cloudAuthority: verifiedCloudAuthority,
    bindCloudAuthority: bindDeviceStartCloudAuthority,
    heartbeatCloudAuthority: heartbeatAdmissionCloudAuthority,
    reconcileCloudAuthority: reconcileAdmissionCloudAuthority,
    verifyActiveCloudAuthority: verifyAdmissionCloudAuthority,
    reviewReadyCloudAuthority: reviewReadyAdmissionCloudAuthority,
    verifyReviewReadyCloudAuthority:
      verifyReviewReadyAdmissionCloudAuthority,
    run: createCoordinationClaimRunAdapter({
      action: command,
      expectedScope: coordinationClaimScope,
      verifyExpectedClaim: claim => {
        const lease = coordinationClaimBranch
          ? leaseStore.read(coordinationClaimBranch)
          : null;
        return lease?.status === "active"
          && lease.sessionId === sessionId
          && lease.branch === coordinationClaimBranch
          && lease.scope === claim.scope
          && lease.epoch === claim.epoch
          && path.resolve(lease.worktreePath) === path.resolve(repo)
          && !lease.fenceSha
          && Boolean(lease.ownedDirtRecovery) === claim.preserveOwnedDirt;
      },
      run,
      commitCoordinationClaim,
    }),
    log: json ? () => {} : console.log,
    now: () => new Date(),
  };
  let admissionContinuation = null;
  if (continueAdmission) {
    if (!writeScopeManifestPath) {
      throw new Error("--continue-admission requires --write-scope-manifest.");
    }
    const branch = gitText(["branch", "--show-current"]).trim();
    const manifestSource = readJsonFile(
      writeScopeManifestPath, "declared write-scope manifest",
    );
    const continuationGate = dormantWorktreePaths.length + dormantPullRequests.length > 0
      ? createDeviceDormantPreservationPlannedContinuationGate({
        argumentsList: args, repository: repo, branch, sessionId, leaseStore,
        manifestSource, worktreePaths: dormantWorktreePaths,
        pullRequestReferences: dormantPullRequests,
      })
      : null;
    admissionContinuation = continuePlannedAdmissionFromRepository({
      repository: repo,
      branch,
      sessionId,
      leaseStore,
      manifestSource,
      dormantWorktreePaths,
      dormantPullRequests,
      operatorDecisionDigest: requiredOption(args, "operator-decision-digest"),
      verifyDormant: continuationGate?.verifyDormant, verifyCloudAuthority: continuationGate?.verifyCloudAuthority,
      gitText,
    });
  }
  let result = execute(command, context);
  if (admissionContinuation && result && typeof result === "object") {
    result = Object.freeze({
      ...result,
      admissionContinuationReceipt: admissionContinuation.continuationReceipt,
    });
  }
  if (provision && admissionReport) {
    const branch = resolveResultBranch(command, result);
    let lease = context.leaseStore.verify({ sessionId, branch });
    const verified = verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: admissionManifest,
      canonicalBaseSha: admissionReport.canonicalBaseSha,
    });
    assertRootSourceBootstrapCurrent({
      report: admissionReport,
      remoteAuthorityVerification: verified.verification,
    });
    const preservationReceipt = verifyPreservedLaneState(
      admissionReport,
      collectScopedLaneState({ repository: canonicalRepo }).lanes,
      {
        lease: { ...lease, cloudAuthority: verified.authority },
        candidateCreateRegisterResult:
          provision.candidateCreateRegisterResult,
        remoteAuthorityVerification: verified.verification,
      },
    );
    admissionReport = finalizeScopedLaneAdmission({
      report: admissionReport,
      lease: { ...lease, cloudAuthority: verified.authority },
      preservationReceipt,
      cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
    });
    admissionProjection = createAdmissionLeaseProjection(admissionReport);
    lease = context.leaseStore.annotate({
      sessionId,
      branch,
      values: {
        admission: admissionProjection,
        cloudAuthority: verified.authority,
      },
    });
    const pullRequest = requireOwnershipPullRequestDraft({
      url: lease.pullRequestUrl,
      branch,
      ghText,
      expectedDraft: true,
    });
    run("gh", [
      "pr",
      "edit",
      lease.pullRequestUrl,
      "--body",
      updateWriterLeasePullRequestBody(pullRequest.body, lease),
    ]);
    requireOwnershipPullRequestDraft({
      url: lease.pullRequestUrl,
      branch,
      ghText,
      expectedDraft: true,
    });
    const immediate = verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: admissionManifest,
      canonicalBaseSha: admissionReport.canonicalBaseSha,
    });
    assertPeersUnchanged(admissionReport, immediate.verification);
    mutationAuthorityReceipt = assertAdmissionMutationAuthority({
      lease,
      cloudAuthority: immediate.authority,
      remoteAuthorityVerification: immediate.verification,
    });
  }
  if (json) emitJson(command, context, result, { provisioned: Boolean(provision) });
} catch (error) {
  const finalError = rollbackProvision(error);
  if (!json) throw finalError;
  console.log(JSON.stringify(createDeviceCommandError({
    action: command,
    repoRoot: repo || canonicalRepo,
    worktreePath: provision?.target || (requestedWorktreePath ? path.resolve(requestedWorktreePath) : invocationPath),
    error: finalError,
  })));
  process.exitCode = 1;
}
function execute(action, context) {
  if (action === "start") return start(context);
  if (action === "resume") return resume({ ...context, branchName: rawScope });
  if (action === "heartbeat") return heartbeat(context);
  if (action === "review") return review(context);
  if (action === "publish") return publish(context);
  if (action === "integrate") return integrateSession({
    ...context,
    commitMessage: readOption(args, "commit-message"),
    pathsManifest: readOption(args, "paths-manifest"),
    runtime: readOption(args, "runtime") || "canonical",
    runtimeRepository: readOption(args, "runtime-repository"),
    waitSeconds: Number(readOption(args, "wait-seconds") || 900),
    pollSeconds: Number(readOption(args, "poll-seconds") || 5),
    controllerRoot,
    verifyCloudAuthority: createPostMergeCloudAuthorityVerifier({ ghText }),
    renewActiveAuthority: ({ lease }) => {
      const remainingAuthorityMs = Date.parse(lease.expiresAt) - Date.now();
      if (remainingAuthorityMs <= context.leaseTtlMs / 2) heartbeat(context);
    },
    publishTask: () => publish(context),
    completeTask: () => completeSession({ ...context, json: false, finalize: false }),
    runText,
  });
  if (action === "park") return park(context);
  if (action === "end") {
    return completeSession({ ...context, json: false, allowAlreadyOnCleanMain: true });
  }
  return completeSession({ ...context, json: false });
}
function emitJson(action, context, result, { provisioned }) {
  if (action === "complete" || action === "end" || action === "integrate") {
    console.log(JSON.stringify(result));
    return;
  }
  const branch = resolveResultBranch(action, result);
  const lease = branch ? context.leaseStore.read(branch) : null;
  const pullRequestIsDraft = lease?.pullRequestUrl ? readMachinePullRequestDraft({ action, branch, lease, ghText: context.ghText }) : null;
  const response = createDeviceCommandResult({
    action,
    repoRoot: context.repo,
    worktreePath: context.repo,
    branch,
    lease,
    result,
    provisioned,
    pullRequestIsDraft,
  });
  if (action === "start" && provisioned) {
    if (!admissionReport || !mutationAuthorityReceipt) {
      throw new Error("Provisioned start did not retain its final admission evidence.");
    }
    response.admissionReport = admissionReport;
    response.mutationAuthorityReceipt = mutationAuthorityReceipt;
  }
  if (action === "heartbeat") attachCloudHeartbeatMachineEvidence(response, { lease, result });
  console.log(JSON.stringify(response));
}
function readMachinePullRequestDraft({ action, branch, lease, ghText }) {
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch,
    ghText,
    requireOpen: action !== "publish",
  });
  const expected = ["start", "resume", "heartbeat", "park"].includes(action) ? true :
    ["review", "publish"].includes(action) ? false : null;
  if (expected !== null && pullRequest.isDraft !== expected) {
    throw new Error(`Machine result for ${action} cannot prove pull request draft state ${expected}.`);
  }
  return pullRequest.isDraft;
}
function resolveResultBranch(action, result) {
  if (action === "start") return result;
  if (action === "review" || action === "publish") return gitText(["branch", "--show-current"]).trim();
  return result?.branch || "";
}

function rollbackProvision(originalError) {
  if (!provision || !canonicalRepo) return originalError;
  try {
    process.chdir(canonicalRepo);
    const commonDirectory = path.resolve(canonicalRepo, gitText(["rev-parse", "--git-common-dir"]).trim());
    const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
    leaseStore.withRegistryLock(registry => {
      const candidateClaimed = Object.values(registry.leases).some(lease => (
        lease?.worktreePath
        && path.resolve(lease.worktreePath) === path.resolve(provision.target)
      ));
      rollbackUnclaimedProvision({
        provision,
        candidateUnclaimed: !candidateClaimed,
        gitText,
        run,
      });
    });
    return originalError;
  } catch (rollbackError) {
    return new Error(`${originalError.message}; automatic worktree rollback stopped: ${rollbackError.message}`);
  }
}

function bindDeviceStartCloudAuthority({
  authority,
  admission,
  branch,
  headSha,
  pullRequestUrl,
  device,
  sessionId: activeSession,
}) {
  const url = new URL(pullRequestUrl);
  const match = url.pathname.match(/\/pull\/([1-9]\d*)\/?$/u);
  if (url.protocol !== "https:" || !match) {
    throw new Error("Cloud bind requires an exact HTTPS pull-request URL.");
  }
  return bindAdmissionCloudAuthority({
    authority,
    manifest: admission,
    branch,
    headSha,
    pullRequestNumber: Number(match[1]),
    deviceId: device,
    sessionId: activeSession,
  });
}

function bindControllerHooksEnvironment(defaultControllerRoot) {
  return defaultControllerRoot;
}
function assertExternalTaskAuthorityFile(file, repository) {
  const candidate = path.resolve(file);
  const root = `${path.resolve(repository)}${path.sep}`;
  if (candidate === path.resolve(repository) || candidate.startsWith(root)) {
    throw new Error("Task authority capability must remain outside the repository.");
  }
}

function usage() {
  console.error(
    "Usage: node scripts/device-branch.mjs <lifecycle-command> --session=<id> --repository=<path> --task-authority=<external-capability.json> [command-specific options] [--json]",
  );
  process.exit(2);
}

function resolveWorkspaceGuardControllerRoot(values) {
  const configured = readOption(values, "workspace-guard-controller");
  if (!configured) return controllerRoot;
  const candidate = path.resolve(configured);
  const currentRemote = gitAt(controllerRoot, ["remote", "get-url", "origin"]);
  const candidateRemote = gitAt(candidate, ["remote", "get-url", "origin"]);
  const candidateHead = gitAt(candidate, ["rev-parse", "HEAD"]);
  const candidateProtectedHead = gitAt(candidate, ["rev-parse", "origin/main"]);
  const candidateBranch = gitAt(candidate, ["symbolic-ref", "--short", "HEAD"]);
  const candidateStatus = gitAt(candidate, ["status", "--porcelain"]);
  if (
    candidateRemote !== currentRemote
    || candidateBranch !== "main"
    || candidateHead !== candidateProtectedHead
    || candidateStatus
  ) {
    throw new Error("--workspace-guard-controller must be a clean protected main checkout of this controller repository.");
  }
  return candidate;
}

function gitAt(directory, argumentsList) {
  return runText("git", ["-C", directory, ...argumentsList]).trim();
}
