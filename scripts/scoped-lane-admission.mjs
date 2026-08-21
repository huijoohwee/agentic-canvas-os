#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
import { requireOwnershipPullRequestDraft } from "./device-pull-request-state.mjs";
import {
  createWriterLeaseStore,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  assertRootSourceBootstrapCurrent,
  createAdmissionLeaseProjection,
  evaluateScopedLaneAdmission,
  normalizeCloudAuthority,
  normalizeDeclaredWriteScopeManifest,
} from "./scoped-lane-admission-lib.mjs";
import {
  createRootSourceBootstrapAuthorization,
  writeRootSourceBootstrapMaintenanceManifest,
} from "./scoped-lane-bootstrap-authorization.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import {
  assertAdmissionMutationAuthority,
  attachAdmissionReceipt,
  collectScopedLaneState,
  finalizeScopedLaneAdmission,
  verifyPreservedLaneState,
} from "./scoped-lane-admission-state.mjs";
import {
  inspectTaskWorktreeTarget,
  recoverCandidateCreateRegisterResult,
} from "./task-worktree-provision.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  ghText,
  gitHubRepository,
  publicMessage,
  scopedLaneAdmissionUsage as usage,
  withWorkingDirectory,
} from "./scoped-lane-admission-cli.mjs";

const [rawMode, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (!["plan", "check", "recover", "bootstrap"].includes(rawMode)) usage();
  const repository = path.resolve(
    option("repository") || process.env.AGENTIC_TARGET_REPOSITORY || process.cwd(),
  );
  const scope = sanitizeScope(requiredOption("scope"));
  const targetPath = path.resolve(requiredOption("worktree"));
  const manifestPath = path.resolve(requiredOption("write-scope-manifest"));
  const manifest = normalizeDeclaredWriteScopeManifest(
    readJson(manifestPath, "declared write-scope manifest"),
    { expectedScope: scope },
  );
  const rootSourceBootstrapFile = option("root-source-bootstrap-file");
  const rootSourceBootstrapInline = option("root-source-bootstrap");
  if (rootSourceBootstrapFile && rootSourceBootstrapInline) {
    throw new Error("Use one root-source bootstrap input, not both inline and file forms.");
  }
  const rootSourceBootstrapAuthorization = rootSourceBootstrapFile
    ? readJson(
      path.resolve(rootSourceBootstrapFile),
      "root-source bootstrap authorization",
    )
    : rootSourceBootstrapInline
      ? parseJsonObject(
        rootSourceBootstrapInline,
        "root-source bootstrap authorization",
      )
      : null;
  const snapshot = collectScopedLaneState({ repository });
  const canonicalLane = snapshot.lanes.filter(
    lane => lane.branch === "refs/heads/main",
  );
  if (canonicalLane.length !== 1) {
    throw new Error(`Expected one registered canonical main worktree; found ${canonicalLane.length}.`);
  }
  const canonicalPath = canonicalLane[0].path;
  const device = sanitizeDevice(
    gitOptional(canonicalPath, ["config", "--get", "agentic.device"])
    || os.hostname(),
  );
  const branch = `agent/${device}/${scope}`;
  if (rawMode === "bootstrap") {
    const authorityPath = path.resolve(requiredOption("cloud-authority"));
    const source = readJson(authorityPath, "cloud authority");
    const cloudAuthority = normalizeCloudAuthority(source, {
      ledgerRepository: option("ledger-repository")
        || process.env.AGENTIC_LEDGER_REPOSITORY
        || "huijoohwee/agentic-canvas-os",
      targetRepository: option("target-repository")
        || gitHubRepository(canonicalPath),
      manifest,
      canonicalBaseSha: snapshot.canonicalBaseSha,
    });
    const verified = verifyAdmissionCloudAuthority({
      authority: cloudAuthority,
      manifest,
      canonicalBaseSha: snapshot.canonicalBaseSha,
    });
    const target = withWorkingDirectory(canonicalPath, () => (
      inspectTaskWorktreeTarget({
        invocationPath: canonicalPath,
        repoRoot: canonicalPath,
        targetPath,
        gitText,
        allowDirtyCanonicalForRootBootstrap: true,
      })
    ));
    const maintenanceSourcePath = path.resolve(requiredOption("maintenance-source"));
    const maintenanceManifestOutput = path.resolve(requiredOption("maintenance-manifest-output"));
    const maintenanceManifest = writeRootSourceBootstrapMaintenanceManifest({
      lanePath: maintenanceSourcePath,
      outputPath: maintenanceManifestOutput,
    });
    const preserved = option("preserve")
      ? option("preserve").split(",").map(item => path.resolve(item)).filter(Boolean)
      : null;
    const authorization = createRootSourceBootstrapAuthorization({
      lanes: snapshot.lanes,
      canonicalPath,
      canonicalBaseSha: snapshot.canonicalBaseSha,
      targetPath: target.target,
      branch,
      semanticScope: scope,
      manifest,
      cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
      maintenanceSourcePath,
      maintenanceManifestPath: maintenanceManifest.path,
      maintenanceManifestDigest: maintenanceManifest.manifestDigest,
      ...(preserved ? {
        preservedLanes: snapshot.lanes
          .filter(lane => preserved.includes(path.resolve(lane.path)))
          .map(lane => ({ path: path.resolve(lane.path), stateDigest: lane.stateDigest })),
      } : {}),
    });
    process.stdout.write(`${JSON.stringify({
      authorization,
      maintenanceManifestPath: maintenanceManifest.path,
      maintenanceManifestDigest: maintenanceManifest.manifestDigest,
    }, null, json ? 0 : 2)}\n`);
    process.exit(0);
  }
  if (rawMode === "recover") {
    const report = withWorkingDirectory(canonicalPath, () => recoverAdmission({
      repository,
      canonicalPath,
      snapshot,
      targetPath,
      branch,
      scope,
      manifest,
      rootSourceBootstrapAuthorization,
    }));
    process.stdout.write(`${JSON.stringify(report, null, json ? 0 : 2)}\n`);
    process.exit(0);
  }
  const target = withWorkingDirectory(canonicalPath, () => (
    inspectTaskWorktreeTarget({
      invocationPath: canonicalPath,
      repoRoot: canonicalPath,
      targetPath,
      gitText,
    })
  ));
  let cloudAuthority = null;
  let remoteAuthorityVerification = null;
  if (rawMode === "check") {
    const authorityPath = path.resolve(requiredOption("cloud-authority"));
    const source = readJson(authorityPath, "cloud authority");
    cloudAuthority = normalizeCloudAuthority(source, {
      ledgerRepository: option("ledger-repository")
        || process.env.AGENTIC_LEDGER_REPOSITORY
        || "huijoohwee/agentic-canvas-os",
      targetRepository: option("target-repository")
        || gitHubRepository(canonicalPath),
      manifest,
      canonicalBaseSha: snapshot.canonicalBaseSha,
    });
    const verified = verifyAdmissionCloudAuthority({
      authority: cloudAuthority,
      manifest,
      canonicalBaseSha: snapshot.canonicalBaseSha,
    });
    cloudAuthority = verified.authority;
    remoteAuthorityVerification = verified.verification;
  }
  let report = evaluateScopedLaneAdmission({
    repository,
    canonicalPath,
    canonicalBaseSha: snapshot.canonicalBaseSha,
    canonicalSourceDisposition: snapshot.canonicalSourceDisposition,
    targetPath: target.target,
    branch,
    semanticScope: scope,
    targetSafe: true,
    manifest,
    lanes: snapshot.lanes,
    cloudAuthority,
    remoteAuthorityRequired: rawMode === "check",
    remoteAuthorityVerification,
    rootSourceBootstrapAuthorization,
    mode: rawMode,
  });
  if (rawMode === "check" && report.authoringAdmission.status === "planned") {
    report = attachAdmissionReceipt({
      report,
      targetObservationDigest: target.targetObservationDigest,
      remoteAuthorityVerification,
    });
  }
  process.stdout.write(`${JSON.stringify(report, null, json ? 0 : 2)}\n`);
  if (report.authoringAdmission.status === "blocked") process.exitCode = 1;
} catch (error) {
  const output = {
    schema: "agentic-lane-admission-error/v1",
    ok: false,
    mode: rawMode || null,
    status: "error",
    error: {
      code: "lane_admission_failed",
      message: publicMessage(error),
    },
  };
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = 2;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function option(name) {
  const prefix = `--${name}=`;
  const inline = argumentsList.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : "";
}

function readJson(file, label) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return value;
  } catch (error) {
    throw new Error(`Could not read ${label} at ${file}: ${publicMessage(error)}`);
  }
}

function parseJsonObject(source, label) {
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return value;
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${publicMessage(error)}`);
  }
}

function gitText(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitOptional(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function recoverAdmission({
  repository,
  canonicalPath,
  snapshot,
  targetPath,
  branch,
  scope,
  manifest,
  rootSourceBootstrapAuthorization,
}) {
  const sessionId = requiredOption("session");
  const gitCommonDir = path.resolve(
    canonicalPath,
    gitText(["rev-parse", "--git-common-dir"]).trim(),
  );
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
  let lease = leaseStore.verify({ sessionId, branch });
  requireRecoveryLease({
    lease,
    branch,
    scope,
    targetPath,
    manifest,
    canonicalBaseSha: snapshot.canonicalBaseSha,
  });
  const pullRequest = requireRecoveryPullRequest({ lease, branch });
  const verified = verifyAdmissionCloudAuthority({
    authority: lease.cloudAuthority,
    manifest,
    canonicalBaseSha: snapshot.canonicalBaseSha,
  });
  if (lease.admission.status === "admitted") {
    const authorityReceipt = assertAdmissionMutationAuthority({
      lease: { ...lease, cloudAuthority: verified.authority },
      cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
    });
    updateRecoveryPullRequest({ pullRequest, lease, branch });
    return recoveryResult({
      status: "admitted-replayed",
      lease,
      authorityReceipt,
      pullRequestUrl: pullRequest.url,
    });
  }
  const rootSourceRecovery = isRootSourceRecovery(verified.authority);
  if (!rootSourceBootstrapAuthorization && rootSourceRecovery) {
    throw new Error("Planned admission recovery requires fresh root-source bootstrap preservation authorization.");
  }
  if (rootSourceBootstrapAuthorization && !rootSourceRecovery) {
    throw new Error(
      "Downstream planned admission recovery requires exact lane-state replay and does not accept root-source bootstrap authorization.",
    );
  }
  const candidateLanes = snapshot.lanes.filter(
    lane => path.resolve(lane.path) === path.resolve(targetPath),
  );
  if (candidateLanes.length !== 1) {
    throw new Error("Planned admission recovery requires one exact registered candidate lane.");
  }
  const candidateCreateRegisterResult = recoverCandidateCreateRegisterResult({
    repoRoot: canonicalPath,
    targetPath,
    expectedBaseSha: lease.baseSha,
    expectedBranch: branch,
    expectedFenceSha: lease.fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: lease.epoch,
    gitText,
  });
  const peerLanes = snapshot.lanes.filter(
    lane => path.resolve(lane.path) !== path.resolve(targetPath),
  );
  let report = evaluateScopedLaneAdmission({
    repository,
    canonicalPath,
    canonicalBaseSha: snapshot.canonicalBaseSha,
    canonicalSourceDisposition: snapshot.canonicalSourceDisposition,
    targetPath,
    branch,
    semanticScope: scope,
    targetSafe: true,
    manifest,
    lanes: peerLanes,
    cloudAuthority: verified.authority,
    remoteAuthorityRequired: true,
    remoteAuthorityVerification: verified.verification,
    rootSourceBootstrapAuthorization,
    mode: "check",
  });
  if (report.authoringAdmission.status !== "planned") {
    throw new Error("Interrupted lane recovery is no longer eligible for admission.");
  }
  report = attachAdmissionReceipt({
    report,
    targetObservationDigest:
      candidateCreateRegisterResult.expectedTargetObservationDigest,
    remoteAuthorityVerification: verified.verification,
  });
  assertRootSourceBootstrapCurrent({
    report,
    remoteAuthorityVerification: verified.verification,
  });
  const planRecoveryReceipt = createPlanRecoveryReceipt({
    previousAdmission: lease.admission,
    report,
    allowExactDownstreamRecovery: !rootSourceRecovery,
  });
  assertAdmissionMutationAuthority({
    lease: { ...lease, cloudAuthority: verified.authority },
    cloudAuthority: verified.authority,
    remoteAuthorityVerification: verified.verification,
    allowPlanned: true,
  });
  const latest = leaseStore.verify({ sessionId, branch });
  if (digestValue(latest) !== digestValue(lease)) {
    throw new Error("Planned writer lease changed during admission recovery.");
  }
  lease = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      admission: createAdmissionLeaseProjection(report),
      cloudAuthority: verified.authority,
    },
  });
  const preservationReceipt = verifyPreservedLaneState(
    report,
    collectScopedLaneState({ repository: canonicalPath }).lanes,
    {
      lease,
      candidateCreateRegisterResult,
      remoteAuthorityVerification: verified.verification,
    },
  );
  const admittedReport = finalizeScopedLaneAdmission({
    report,
    lease,
    preservationReceipt,
    cloudAuthority: verified.authority,
    remoteAuthorityVerification: verified.verification,
  });
  lease = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      admission: createAdmissionLeaseProjection(admittedReport),
      cloudAuthority: verified.authority,
    },
  });
  updateRecoveryPullRequest({ pullRequest, lease, branch });
  const immediate = verifyAdmissionCloudAuthority({
    authority: lease.cloudAuthority,
    manifest,
    canonicalBaseSha: admittedReport.canonicalBaseSha,
  });
  const authorityReceipt = assertAdmissionMutationAuthority({
    lease,
    cloudAuthority: immediate.authority,
    remoteAuthorityVerification: immediate.verification,
  });
  return recoveryResult({
    status: "admitted",
    lease,
    admittedReport,
    preservationReceipt,
    authorityReceipt,
    candidateCreateRegisterResult,
    planRecoveryReceipt,
    pullRequestUrl: pullRequest.url,
  });
}

function createPlanRecoveryReceipt({
  previousAdmission,
  report,
  allowExactDownstreamRecovery = false,
}) {
  const bootstrap = report.rootSourceBootstrapAuthorization;
  const exactExistingLaneReplay = typeof previousAdmission?.existingLaneStateDigest === "string"
    && previousAdmission.existingLaneStateDigest.length > 0
    && previousAdmission.existingLaneStateDigest === report.existingLaneStateDigest;
  const rootSourceBootstrapRecovery = !allowExactDownstreamRecovery
    && Boolean(bootstrap?.authorizationDigest);
  const exactDownstreamRecovery = !bootstrap
    && allowExactDownstreamRecovery
    && exactExistingLaneReplay;
  if (
    previousAdmission?.status !== "planned"
    || (!rootSourceBootstrapRecovery && !exactDownstreamRecovery)
    || report.authoringAdmission?.status !== "planned"
    || report.admissionReceipt?.status !== "accepted"
  ) {
    throw new Error(
      "Plan recovery requires exact downstream evidence or fresh root-source bootstrap authorization.",
    );
  }
  const receipt = {
    schema: "agentic-lane-admission-plan-recovery/v2",
    status: "accepted",
    recoveryMode: exactDownstreamRecovery
      ? "exact-downstream-finalization"
      : "root-source-bootstrap",
    reason: exactExistingLaneReplay
      ? "exact-plan-replay"
      : "operator-authorized-maintenance-replan",
    previousPlanReportDigest: previousAdmission.planReceiptDigest,
    previousAdmissionReceiptDigest: previousAdmission.admissionReceiptDigest,
    previousExistingLaneStateDigest: previousAdmission.existingLaneStateDigest,
    recoveredPlanReportDigest: report.reportDigest,
    recoveredAdmissionReceiptDigest: report.admissionReceipt.receiptDigest,
    recoveredExistingLaneStateDigest: report.existingLaneStateDigest,
    rootSourceBootstrapAuthorizationDigest: bootstrap?.authorizationDigest || null,
    maintenanceSourcePath: bootstrap?.maintenanceSourcePath || null,
  };
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

function isRootSourceRecovery(authority) {
  return authority.targetRepository.toLowerCase()
    === authority.ledgerRepository.toLowerCase();
}

function requireRecoveryLease({
  lease,
  branch,
  scope,
  targetPath,
  manifest,
  canonicalBaseSha,
}) {
  if (
    !["planned", "admitted"].includes(lease.admission?.status)
    || lease.branch !== branch
    || lease.scope !== scope
    || path.resolve(lease.worktreePath || "") !== path.resolve(targetPath)
    || lease.baseSha !== canonicalBaseSha
    || lease.admission.semanticScope !== scope
    || lease.admission.manifestDigest !== manifest.manifestDigest
    || lease.admission.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(lease.admission.declaredWriteSet)
      !== JSON.stringify(manifest.declaredWriteSet)
  ) {
    throw new Error("Admission recovery lease does not match the exact candidate identity and manifest.");
  }
}

function requireRecoveryPullRequest({ lease, branch }) {
  const pullRequest = requireOwnershipPullRequestDraft({
    url: lease.pullRequestUrl,
    branch,
    ghText,
    expectedDraft: true,
  });
  if (pullRequest.headRefOid !== lease.fenceSha) {
    throw new Error("Admission recovery pull request does not match the exact candidate fence.");
  }
  return pullRequest;
}

function updateRecoveryPullRequest({ pullRequest, lease, branch }) {
  execFileSync("gh", [
    "pr",
    "edit",
    pullRequest.url,
    "--body",
    updateWriterLeasePullRequestBody(pullRequest.body, lease),
  ], { stdio: ["ignore", "pipe", "pipe"] });
  requireRecoveryPullRequest({ lease, branch });
}

function recoveryResult({
  status,
  lease,
  authorityReceipt,
  pullRequestUrl,
  admittedReport = null,
  preservationReceipt = null,
  candidateCreateRegisterResult = null,
  planRecoveryReceipt = null,
}) {
  const receipt = {
    schema: "agentic-lane-admission-recovery-result/v1",
    status,
    branch: lease.branch,
    worktreePath: lease.worktreePath,
    fenceSha: lease.fenceSha,
    pullRequestUrl,
    claimId: lease.cloudAuthority.claimId,
    admissionStatus: lease.admission.status,
    admissionReportDigest: lease.admission.admittedReportDigest,
    preservationReceiptDigest: lease.admission.preservationReceiptDigest,
    mutationAuthorityReceiptDigest: authorityReceipt.receiptDigest,
    candidateCreateRegisterResultDigest:
      candidateCreateRegisterResult?.resultDigest || null,
    planRecoveryReceiptDigest: planRecoveryReceipt?.receiptDigest || null,
  };
  return {
    ...receipt,
    receiptDigest: digestValue(receipt),
    ...(admittedReport ? { admittedReport } : {}),
    ...(preservationReceipt ? { preservationReceipt } : {}),
    ...(planRecoveryReceipt ? { planRecoveryReceipt } : {}),
    mutationAuthorityReceipt: authorityReceipt,
  };
}
