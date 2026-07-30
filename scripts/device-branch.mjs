#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { textCommandOptions } from "./command-text-options.mjs";
import {
  completeSession,
  heartbeat,
  park,
  publish,
  resume,
  review,
  sanitizeDevice,
  sanitizeScope,
  start,
} from "./device-branch-lib.mjs";
import { createDeviceCommandError, createDeviceCommandResult } from "./device-command-result.mjs";
import { integrateSession } from "./device-integrate-lib.mjs";
import {
  readOwnershipPullRequest,
  requireOwnershipPullRequestDraft,
} from "./device-pull-request-state.mjs";
import {
  inspectTaskWorktreeTarget,
  provisionTaskWorktree,
  rollbackUnclaimedProvision,
} from "./task-worktree-provision.mjs";
import {
  createWriterLeaseStore,
  DEFAULT_WRITER_LEASE_TTL_MS,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  createAdmissionLeaseProjection,
  evaluateScopedLaneAdmission,
  normalizeCloudAuthority,
  normalizeDeclaredWriteScopeManifest,
} from "./scoped-lane-admission-lib.mjs";
import {
  attachCloudHeartbeatMachineEvidence,
  bindAdmissionCloudAuthority,
  heartbeatAdmissionCloudAuthority,
  reconcileAdmissionCloudAuthority,
  reviewReadyAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
  verifyReviewReadyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  assertAdmissionMutationAuthority,
  assertWorkspaceGuardsReady,
  attachAdmissionReceipt,
  collectScopedLaneState,
  finalizeScopedLaneAdmission,
  verifyPreservedLaneState,
} from "./scoped-lane-admission-state.mjs";

const [command, ...args] = process.argv.slice(2);
const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!command || !["start", "resume", "heartbeat", "review", "publish", "integrate", "park", "complete", "end"].includes(command)) usage();

const json = args.includes("--json");
const provisionRequested = args.includes("--provision");
const autoDelivery = args.includes("--auto-delivery");
const recoverOwnedDirt = args.includes("--recover-owned-dirt");
const repairPullRequestProjection = args.includes("--repair-pr-projection");
const rawScope = args.find((value) => !value.startsWith("--"));
const sessionId = readOption(args, "session") || process.env.AGENTIC_SESSION_ID || "";
if (sessionId) process.env.AGENTIC_SESSION_ID = sessionId;

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
try {
  if (autoDelivery && command !== "start") {
    throw new Error("--auto-delivery is accepted only by device:start; authorization is immutable for the task lease.");
  }
  if (recoverOwnedDirt && command !== "resume") {
    throw new Error("--recover-owned-dirt is accepted only by device:resume.");
  }
  if (repairPullRequestProjection && command !== "heartbeat") {
    throw new Error("--repair-pr-projection is accepted only by device:heartbeat.");
  }
  const ttlSeconds = Number(readOption(args, "ttl-seconds") || DEFAULT_WRITER_LEASE_TTL_MS / 1000);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("--ttl-seconds must be a positive number.");
  process.chdir(invocationPath);
  canonicalRepo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(canonicalRepo);
  if (command === "start") {
    assertWorkspaceGuardsReady({
      repository: canonicalRepo,
      controllerRoot,
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
    const targetPlan = inspectTaskWorktreeTarget({
      invocationPath,
      repoRoot: canonicalRepo,
      targetPath: requestedWorktreePath,
      gitText,
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
    const authority = normalizeCloudAuthority(
      readJsonFile(cloudAuthorityPath, "cloud authority"),
      {
        ledgerRepository: readOption(args, "ledger-repository")
          || process.env.AGENTIC_LEDGER_REPOSITORY
          || "huijoohwee/agentic-canvas-os",
        targetRepository: readOption(args, "target-repository")
          || ghText(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim(),
        manifest,
        canonicalBaseSha: before.canonicalBaseSha,
      },
    );
    const verified = verifyAdmissionCloudAuthority({
      authority,
      manifest,
      canonicalBaseSha: before.canonicalBaseSha,
    });
    verifiedCloudAuthority = verified.authority;
    admissionReport = evaluateScopedLaneAdmission({
      repository: canonicalRepo,
      canonicalPath: canonicalRepo,
      canonicalBaseSha: before.canonicalBaseSha,
      targetPath: targetPlan.target,
      branch,
      semanticScope: normalizedScope,
      targetSafe: true,
      manifest,
      lanes: before.lanes,
      cloudAuthority: verifiedCloudAuthority,
      remoteAuthorityRequired: true,
      remoteAuthorityVerification: verified.verification,
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
    provision = admissionLeaseStore.withRegistryLock(() => provisionTaskWorktree({
      invocationPath,
      repoRoot: canonicalRepo,
      targetPath: requestedWorktreePath,
      gitText,
      run,
      expectedBaseSha: before.canonicalBaseSha,
      expectedTargetObservationDigest: targetPlan.targetObservationDigest,
      fetchBase: false,
    }));
    activeInvocationPath = provision.target;
  } else if (requestedWorktreePath) {
    throw new Error("--worktree requires --provision.");
  }
  process.chdir(activeInvocationPath);
  repo = gitText(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(repo);
  const gitCommonDir = path.resolve(repo, gitText(["rev-parse", "--git-common-dir"]).trim());
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
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
    run,
    log: json ? () => {} : console.log,
    now: () => new Date(),
  };
  const result = execute(command, context);
  if (provision && admissionReport) {
    const branch = resolveResultBranch(command, result);
    let lease = context.leaseStore.verify({ sessionId, branch });
    const verified = verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: admissionManifest,
      canonicalBaseSha: admissionReport.canonicalBaseSha,
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
    if (
      immediate.verification.remoteClaimInventoryDigest
        !== preservationReceipt.finalRemoteClaimInventoryDigest
    ) {
      throw new Error("Peer claim inventory changed after the Preservation Receipt.");
    }
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
    publishTask: () => publish(context),
    completeTask: () => completeSession({ ...context, json: false, finalize: false }),
    runText,
  });
  if (action === "park") return park(context);
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

function readJsonFile(file, label) {
  const absolutePath = path.resolve(file);
  let value;
  try {
    value = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} at ${absolutePath}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function gitText(args) {
  return execFileSync("git", args, textCommandOptions());
}

function gitOptional(args) {
  const result = spawnSync("git", args, textCommandOptions());
  return result.status === 0 ? result.stdout.trim() : "";
}

function ghText(args) {
  return execFileSync("gh", args, textCommandOptions());
}

function ghOptional(args) {
  const result = spawnSync("gh", args, textCommandOptions());
  return result.status === 0 ? result.stdout.trim() : "";
}

function run(command, args) {
  const stdio = json ? ["ignore", "ignore", "inherit"] : "inherit";
  const result = spawnSync(command, args, { stdio });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function runText(command, args, options = {}) {
  return execFileSync(command, args, textCommandOptions(options));
}

function usage() {
  console.error(
    "Usage: node scripts/device-branch.mjs start <scope> --session=<id> --repository=<path> [--auto-delivery] [--provision --worktree=<absolute-new-path> --write-scope-manifest=<json> --cloud-authority=<json>] [--ttl-seconds=<n>] [--json] | resume <agent/device/scope> --session=<id> --repository=<path> [--recover-owned-dirt] [--json] | heartbeat --session=<id> --repository=<path> [--repair-pr-projection] [--json] | review --session=<id> --repository=<path> [--json] | publish --session=<id> --repository=<path> [--json] | integrate --session=<id> --repository=<path> [--commit-message=<text> --paths-manifest=<json>] [--runtime=canonical|none] [--runtime-repository=<path>] [--wait-seconds=<n>] [--json] | park --session=<id> --repository=<path> [--json] | complete --repository=<path> --json | end --repository=<path> --json",
  );
  process.exit(2);
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}
