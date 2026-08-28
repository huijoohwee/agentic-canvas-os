import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  digestValue,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import {
  LANE_ADMISSION_REPORT_SCHEMA,
  bindOperationDerivedDeliveryPeerLaneStates,
  isOperationDerivedCloudVerification,
  projectAdmissionRemoteClaim,
} from "./scoped-lane-admission-lib.mjs";
import { claimProvenanceMatches } from "./scoped-lane-claim-provenance.mjs";
import {
  isOperationDerivedDeliveryPeerVerification,
  verifyDeliveryAuthorizedPeerAuthorities,
} from "./scoped-lane-delivery-peer-authority.mjs";
import {
  assertPreservationReceiptIntegrity,
  verifyCandidateProvisionEvidence,
} from "./task-worktree-provision.mjs";
import { reconcileIndependentPeerOperations } from "./scoped-lane-peer-reconciliation.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const verifiedPreservationReceipts = new WeakSet();

export function collectScopedLaneState({
  repository,
  git = runGit,
  readLeases = readRepositoryLeases,
  pathExists = existsSync,
  pathStat = lstatSync,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  const first = captureScopedLaneState({
    root,
    git,
    readLeases,
    pathExists,
    pathStat,
  });
  const second = captureScopedLaneState({
    root,
    git,
    readLeases,
    pathExists,
    pathStat,
  });
  if (
    first.registryDigest !== second.registryDigest
    || first.worktreeRegistryDigest !== second.worktreeRegistryDigest
    || first.laneStateDigest !== second.laneStateDigest
    || first.canonicalSourceDisposition !== second.canonicalSourceDisposition
  ) {
    throw new Error("Registered worktree, lease, index, or working bytes changed during admission inspection.");
  }
  return {
    repository: root,
    canonicalBaseSha: second.canonicalBaseSha,
    canonicalSourceDisposition: second.canonicalSourceDisposition,
    lanes: second.lanes,
    laneStateDigest: second.laneStateDigest,
    registryDigest: second.registryDigest,
  };
}

export function attachAdmissionReceipt({
  report,
  targetObservationDigest,
  remoteAuthorityVerification,
}) {
  if (
    report?.schema !== LANE_ADMISSION_REPORT_SCHEMA
    || report.mode !== "check"
    || report.authoringAdmission?.status !== "planned"
    || report.authoringAdmission.findings.length !== 0
    || !isOperationDerivedCloudVerification(remoteAuthorityVerification)
    || remoteAuthorityVerification.status !== "ready"
  ) {
    throw new Error("Admission Receipt requires an eligible checked plan and current cloud verification.");
  }
  requireDigest(targetObservationDigest, "targetObservationDigest");
  if (
    report.remoteClaimInventoryDigest
      !== remoteAuthorityVerification.remoteClaimInventoryDigest
    || report.cloudAuthority?.claimId !== remoteAuthorityVerification.claimId
  ) {
    throw new Error("Admission Receipt cloud inventory does not join the checked plan.");
  }
  const receipt = {
    schema: "agentic-lane-admission-receipt/v1",
    status: "accepted",
    eligibilityReportDigest: report.reportDigest,
    canonicalBaseSha: report.canonicalBaseSha,
    semanticScope: report.candidate.semanticScope,
    writeSetDigest: report.candidate.writeSetDigest,
    existingLaneStateDigest: report.existingLaneStateDigest,
    remoteClaimInventoryDigest: report.remoteClaimInventoryDigest,
    targetObservationDigest,
    claimId: report.cloudAuthority.claimId,
    claimDigest: report.cloudAuthority.claimDigest,
    claimLedgerRevision: report.cloudAuthority.claimLedgerRevision,
    observedLedgerHeadRevision: remoteAuthorityVerification.ledgerRevision,
    ledgerDigest: remoteAuthorityVerification.ledgerDigest,
    cloudVerificationReceiptDigest: remoteAuthorityVerification.receiptDigest,
    evaluationTime: remoteAuthorityVerification.verifiedAt,
    allowedMutations: [
      "candidate-registration",
      "candidate-ref",
      "candidate-local-lease",
      "candidate-fence-projection",
    ],
  };
  const admissionReceipt = Object.freeze({
    ...receipt,
    receiptDigest: digestValue(receipt),
  });
  return withReportDigest({ ...report, admissionReceipt });
}

export function verifyPreservedLaneState(beforeReport, afterLanes, {
  lease,
  candidateCreateRegisterResult,
  remoteAuthorityVerification,
} = {}) {
  if (
    beforeReport?.schema !== LANE_ADMISSION_REPORT_SCHEMA
    || beforeReport.authoringAdmission?.status !== "planned"
    || beforeReport.admissionReceipt?.status !== "accepted"
  ) {
    throw new Error("Preservation verification requires the accepted Admission Receipt.");
  }
  assertAdmissionMutationAuthority({
    lease,
    cloudAuthority: lease.cloudAuthority,
    remoteAuthorityVerification,
    allowPlanned: true,
  });
  const deliveryPeerVerification = verifyDeliveryAuthorizedPeerAuthorities({
    lanes: afterLanes,
    remoteAuthorityVerification,
    evaluatedAt: remoteAuthorityVerification.verifiedAt,
  });
  if (!isOperationDerivedDeliveryPeerVerification(deliveryPeerVerification)) {
    throw new Error("Preservation requires fresh operation-derived delivery peer authority.");
  }
  const authorityBoundAfterLanes = bindOperationDerivedDeliveryPeerLaneStates(
    afterLanes,
    deliveryPeerVerification,
  );
  const rawAfter = new Map(afterLanes.map(
    lane => [path.resolve(lane.path), lane],
  ));
  const after = new Map(authorityBoundAfterLanes.map(
    lane => [path.resolve(lane.path), lane],
  ));
  const changed = beforeReport.lanes
    .filter(lane => after.get(lane.path)?.stateDigest !== lane.stateDigest)
    .map(lane => lane.path)
    .sort();
  if (changed.length > 0) {
    throw new Error(`Existing lane state changed during admission: ${changed.join(", ")}`);
  }
  const finalExistingLaneStateDigest = digestValue(
    beforeReport.lanes
      .map(lane => ({
        path: lane.path,
        stateDigest: rawAfter.get(lane.path)?.stateDigest || null,
        authorityState: lane.authorityState === "delivery-authorized"
          ? after.get(lane.path)?.authorityState || null
          : after.get(lane.path)?.authorityState
            ?? lane.authorityState
            ?? null,
        dormantPreservationReceiptDigest:
          after.get(lane.path)?.dormantPreservationReceiptDigest
          ?? lane.dormantPreservationReceiptDigest
          ?? null,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
  if (finalExistingLaneStateDigest !== beforeReport.existingLaneStateDigest) {
    throw new Error("Existing lane authority digest changed during admission.");
  }
  const candidate = after.get(beforeReport.candidate.targetPath);
  const extraPaths = [...after.keys()]
    .filter(lanePath => !beforeReport.lanes.some(lane => lane.path === lanePath));
  if (extraPaths.length !== 1
    || extraPaths[0] !== beforeReport.candidate.targetPath) {
    throw new Error("Preservation verification found a non-candidate lane delta or incomplete candidate state.");
  }
  const evidence = verifyCandidateProvisionEvidence({
    candidate,
    operation: candidateCreateRegisterResult,
    lease,
    report: beforeReport,
  });
  const peerReconciliation = assertPeersUnchanged(
    beforeReport,
    remoteAuthorityVerification,
  );
  const receipt = {
    schema: "agentic-lane-preservation-result/v1",
    status: "preserved",
    admissionReceiptDigest: beforeReport.admissionReceipt.receiptDigest,
    candidateCreateRegisterResultDigest:
      candidateCreateRegisterResult.resultDigest,
    existingLaneStateDigest: beforeReport.existingLaneStateDigest,
    candidateStateDigest: candidate.stateDigest,
    candidateLeaseDigest: evidence.leaseDigest,
    finalRemoteClaimInventoryDigest:
      remoteAuthorityVerification.remoteClaimInventoryDigest,
    finalPeerClaimSetDigest: peerReconciliation.finalPeerClaimSetDigest,
    peerOperationReceipts: peerReconciliation.peerOperationReceipts,
    peerOperationReceiptDigests:
      peerReconciliation.peerOperationReceiptDigests,
    finalLedgerRevision: remoteAuthorityVerification.ledgerRevision,
    finalLedgerDigest: remoteAuthorityVerification.ledgerDigest,
    cloudVerificationReceiptDigest: remoteAuthorityVerification.receiptDigest,
    preservedPaths: beforeReport.lanes.map(lane => lane.path).sort(),
    peerDisposition: peerReconciliation.peerDisposition,
    causality: "candidate-only",
  };
  const verified = Object.freeze({
    ...receipt,
    receiptDigest: digestValue(receipt),
  });
  verifiedPreservationReceipts.add(verified);
  return verified;
}

export function finalizeScopedLaneAdmission({
  report,
  lease,
  preservationReceipt,
  cloudAuthority,
  remoteAuthorityVerification,
  finalizedAt = remoteAuthorityVerification?.verifiedAt,
}) {
  if (
    report?.schema !== LANE_ADMISSION_REPORT_SCHEMA
    || report.mode !== "check"
    || report.authoringAdmission?.status !== "planned"
    || !verifiedPreservationReceipts.has(preservationReceipt)
  ) {
    throw new Error("Admission finalization requires joined Admission and Preservation Receipts.");
  }
  assertPreservationReceiptIntegrity({
    receipt: preservationReceipt,
    report,
    lease,
    cloudAuthority,
    verification: remoteAuthorityVerification,
  });
  const authorityReceipt = assertAdmissionMutationAuthority({
    lease,
    cloudAuthority,
    remoteAuthorityVerification,
    allowPlanned: true,
    evaluatedAt: finalizedAt,
  });
  const authoringReceipt = {
    schema: "agentic-authoring-admission-receipt/v1",
    status: "admitted",
    admissionReceiptDigest: report.admissionReceipt.receiptDigest,
    preservationReceiptDigest: preservationReceipt.receiptDigest,
    mutationAuthorityReceiptDigest: authorityReceipt.receiptDigest,
    admittedAt: new Date(finalizedAt).toISOString(),
  };
  const authoringReceiptDigest = digestValue(authoringReceipt);
  const finalized = {
    ...report,
    mode: "admit",
    evaluatedAt: authoringReceipt.admittedAt,
    planReportDigest: report.reportDigest,
    cloudAuthority,
    remoteClaimInventoryDigest:
      remoteAuthorityVerification.remoteClaimInventoryDigest,
    remoteClaims: remoteAuthorityVerification.inventory.claims.map(claim => (
      projectAdmissionRemoteClaim(claim, {
      classification: claim.claimId === cloudAuthority.claimId
        ? "candidate"
        : "disjoint-attributed",
      overlapReasons: [],
      })
    )),
    preservationReceipt,
    mutationAuthorityReceipt: authorityReceipt,
    authoringAdmission: {
      status: "admitted",
      findings: [],
      receiptDigest: authoringReceiptDigest,
    },
  };
  return withReportDigest(finalized);
}

export function assertAdmissionMutationAuthority({
  lease,
  cloudAuthority,
  remoteAuthorityVerification,
  allowPlanned = false,
  evaluatedAt = remoteAuthorityVerification?.verifiedAt,
}) {
  const evaluationTime = Date.parse(evaluatedAt);
  const localExpiry = Date.parse(lease?.expiresAt);
  const cloudExpiry = Date.parse(cloudAuthority?.expiresAt);
  const candidate = remoteAuthorityVerification?.inventory?.claims
    ?.find(claim => claim.claimId === cloudAuthority?.claimId);
  const localAuthority = candidate && cloudAuthority ? {
    ...cloudAuthority,
    entrySchema: cloudAuthority.entrySchema ?? candidate.entrySchema,
    claimIdentitySchema:
      cloudAuthority.claimIdentitySchema ?? candidate.claimIdentitySchema,
    operationReceiptDigest:
      cloudAuthority.operationReceiptDigest ?? candidate.operationReceiptDigest,
    ledgerDigest:
      cloudAuthority.ledgerDigest ?? remoteAuthorityVerification?.ledgerDigest,
  } : cloudAuthority;
  const identityComplete = candidate && Array.isArray(candidate.declaredWriteScope)
    && [candidate.actorId, candidate.canonicalBaseRevision, candidate.entrySchema,
      candidate.claimIdentitySchema, candidate.operationReceiptDigest,
      candidate.leaseEpoch, candidate.repositoryId, candidate.workItemId,
      candidate.writeSetDigest].every(value => value !== undefined && value !== null);
  const currentClaimMatches = Boolean(identityComplete && cloudAuthority && (
    claimProvenanceMatches(candidate, localAuthority)
    && candidate.state === "active"
    && localAuthority.state === candidate.state
    && candidate.expiresAt === localAuthority.expiresAt
    && candidate.leaseEpoch === localAuthority.leaseEpoch
    && candidate.transitionCounter === localAuthority.transitionCounter
    && candidate.reviewRequestId === localAuthority.reviewRequestId
    && candidate.writeSetDigest === localAuthority.writeSetDigest
    && candidate.writeSetDigest === lease?.admission?.writeSetDigest
    && digestValue(candidate.declaredWriteScope) === candidate.writeSetDigest
    && JSON.stringify(candidate.declaredWriteScope)
      === JSON.stringify(localAuthority.cloudDeclaredWriteScope)
    && JSON.stringify(candidate.declaredWriteScope)
      === JSON.stringify(lease?.admission?.declaredWriteSet)
    && candidate.canonicalBaseRevision === localAuthority.canonicalBaseSha
    && candidate.canonicalBaseRevision === lease?.baseSha
    && candidate.laneRevision === localAuthority.laneRevision
    && candidate.laneRevision === lease?.fenceSha
  ));
  const noCompetingOverlap = candidate
    ? remoteAuthorityVerification.inventory.claims.every(claim => (
      claim.claimId === candidate.claimId
      || claim.state === "waiting-successor"
      || !writeSetsOverlap(
        claim.declaredWriteScope,
        candidate.declaredWriteScope,
      )
    ))
    : true;
  if (!noCompetingOverlap) {
    throw new Error("Scoped authoring found competing overlapping cloud authority.");
  }
  if (
    lease?.schema !== "agentic-writer-lease/v2"
    || lease.status !== "active"
    || !["admitted", ...(allowPlanned ? ["planned"] : [])]
      .includes(lease.admission?.status)
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || !lease.pullRequestUrl
    || !isOperationDerivedCloudVerification(remoteAuthorityVerification)
    || remoteAuthorityVerification.status !== "ready"
    || lease.cloudAuthority?.claimId !== cloudAuthority?.claimId
    || lease.cloudAuthority?.claimDigest !== cloudAuthority.claimDigest
    || lease.cloudAuthority?.ledgerRevision !== cloudAuthority.ledgerRevision
    || remoteAuthorityVerification.claimId !== cloudAuthority?.claimId
    || remoteAuthorityVerification.claimDigest !== cloudAuthority.claimDigest
    || remoteAuthorityVerification.ledgerRevision !== cloudAuthority.ledgerRevision
    || remoteAuthorityVerification.ledgerDigest !== localAuthority?.ledgerDigest
    || remoteAuthorityVerification.canonicalBaseSha !== localAuthority.canonicalBaseSha
    || remoteAuthorityVerification.laneRevision !== lease.fenceSha
    || remoteAuthorityVerification.writeSetDigest
      !== lease.admission.writeSetDigest
    || remoteAuthorityVerification.reviewRequestId !== localAuthority.reviewRequestId
    || digestValue(lease.cloudAuthority) !== digestValue(cloudAuthority)
    || !currentClaimMatches
    || candidate.fenceRevision !== localAuthority.claimDigest
    || candidate.transitionDigest !== localAuthority.claimLedgerRevision
    || localAuthority.laneRevision !== lease.fenceSha
    || localAuthority.deviceId !== lease.device
    || localAuthority.sessionId !== lease.sessionId
    || !localAuthority.reviewRequestId
    || !Number.isFinite(evaluationTime)
    || !Number.isFinite(localExpiry)
    || !Number.isFinite(cloudExpiry)
    || localExpiry <= evaluationTime
    || cloudExpiry <= evaluationTime
    || localExpiry > cloudExpiry
  ) {
    throw new Error("Scoped authoring requires current joined cloud and local lease authority.");
  }
  const receipt = {
    schema: "agentic-admission-mutation-authority/v1",
    status: "ready",
    claimId: cloudAuthority.claimId,
    claimDigest: cloudAuthority.claimDigest,
    ledgerRevision: cloudAuthority.ledgerRevision,
    localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha,
    remoteLeaseEpoch: cloudAuthority.leaseEpoch,
    cloudVerificationReceiptDigest: remoteAuthorityVerification.receiptDigest,
    evaluatedAt: new Date(evaluationTime).toISOString(),
    expiresAt: new Date(Math.min(localExpiry, cloudExpiry)).toISOString(),
  };
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

function captureScopedLaneState({
  root,
  git,
  readLeases,
  pathExists,
  pathStat,
}) {
  const worktreeRegistry = git(root, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const records = parseWorktreeRecords(
    worktreeRegistry,
  );
  const canonicalBaseSha = git(root, ["rev-parse", "origin/main"]).trim();
  const leaseSnapshot = normalizeLeaseSnapshot(readLeases(root, git));
  const lanes = records.map(record => {
    const lanePath = path.resolve(record.path);
    const status = git(lanePath, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const indexEntries = git(lanePath, ["ls-files", "--stage", "-z"]);
    const changedPaths = nullList(git(lanePath, [
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z",
    ]));
    const workingFiles = changedPaths.map(relativePath => {
      const absolutePath = path.resolve(lanePath, relativePath);
      if (!within(lanePath, absolutePath) || !pathExists(absolutePath)) {
        return { path: relativePath, absent: true };
      }
      const stat = pathStat(absolutePath);
      return {
        path: relativePath,
        mode: stat.mode,
        sizeBytes: stat.size,
        objectId: git(lanePath, [
          "hash-object",
          "--no-filters",
          "--",
          relativePath,
        ]).trim(),
      };
    });
    const leaseMatch = selectLaneLease({
      record,
      leases: leaseSnapshot.leases,
    });
    const state = {
      path: lanePath,
      head: record.head,
      treeSha: git(lanePath, ["rev-parse", "HEAD^{tree}"]).trim(),
      branch: record.branch || null,
      detached: Boolean(record.detached),
      bare: Boolean(record.bare),
      locked: Boolean(record.locked),
      prunable: Boolean(record.prunable),
      invalid: Boolean(record.bare || record.locked || record.prunable),
      dirty: Boolean(status),
      indexDigest: digestValue(indexEntries),
      workingTreeDigest: digestValue({ status, workingFiles }),
      leaseAmbiguous: leaseMatch.ambiguous,
      lease: leaseMatch.lease,
    };
    return {
      ...state,
      stateDigest: digestValue(state),
    };
  });
  const laneStateDigest = digestValue(
    lanes
      .map(lane => ({ path: lane.path, stateDigest: lane.stateDigest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
  const canonicalSourceDisposition = classifyCanonicalTaskSource({
    root,
    canonicalBaseSha,
    lanes,
    git,
  });
  return {
    canonicalBaseSha,
    canonicalSourceDisposition,
    lanes,
    laneStateDigest,
    registryDigest: leaseSnapshot.registryDigest,
    worktreeRegistryDigest: digestValue(worktreeRegistry),
  };
}

function classifyCanonicalTaskSource({ root, canonicalBaseSha, lanes, git }) {
  const canonical = lanes.filter(lane => lane.branch === "refs/heads/main");
  if (canonical.length !== 1) return "ambiguous";
  if (canonical[0].invalid) return "unsafe";
  const dirty = canonical[0].dirty;
  if (canonical[0].head === canonicalBaseSha) {
    return dirty ? "root-bootstrap-dirty" : "exact";
  }
  try {
    git(root, [
      "merge-base",
      "--is-ancestor",
      canonical[0].head,
      canonicalBaseSha,
    ]);
    return dirty ? "root-bootstrap-dirty" : "preserved-behind";
  } catch {
    return "unsafe";
  }
}

export function assertWorkspaceGuardsReady({
  repository,
  controllerRoot = repository,
  git = runGit,
  pathExists = existsSync,
  pathStat = lstatSync,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  let configured = "";
  try {
    configured = git(root, ["config", "--get", "core.hooksPath"]).trim();
  } catch {
    configured = "";
  }
  const expectedHooksRoot = path.resolve(controllerRoot, ".githooks");
  const configuredHooksRoot = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(root, configured);
  if (!configured) {
    throw new Error(
      "Workspace guards are not ready: core.hooksPath is unset; run the repository-owned workspace guard installer.",
    );
  }
  if (configuredHooksRoot !== expectedHooksRoot) {
    throw new Error("Workspace guards are not ready: core.hooksPath must reference the canonical controller hook source.");
  }
  for (const hook of [
    "git-guarded",
    "pre-commit",
    "pre-push",
    "reference-transaction",
  ]) {
    const hookPath = path.join(expectedHooksRoot, hook);
    const configuredHookPath = path.join(configuredHooksRoot, hook);
    if (
      !pathExists(hookPath)
      || !pathExists(configuredHookPath)
      || (pathStat(configuredHookPath).mode & 0o111) === 0
      || digestValue(readFileSync(configuredHookPath, "utf8"))
        !== digestValue(readFileSync(hookPath, "utf8"))
    ) {
      throw new Error(
        `Workspace guards are not ready: ${configuredHookPath} is missing, non-executable, or differs from the controller source; run the repository-owned workspace guard installer.`,
      );
    }
  }
  return {
    schema: "agentic-workspace-guard-readiness/v1",
    status: "ready",
    hooksPath: configuredHooksRoot,
  };
}

function selectLaneLease({ record, leases }) {
  const lanePath = path.resolve(record.path);
  const checkedOutBranch = record.branch?.replace(/^refs\/heads\//u, "") || null;
  const candidates = leases.filter(lease => (
    lease?.worktreePath
    && path.resolve(lease.worktreePath) === lanePath
    && (
      checkedOutBranch
        ? lease.branch === checkedOutBranch
        : ["parked", "completed", "completing"].includes(lease.status)
    )
  )).sort((left, right) => Number(right.epoch || 0) - Number(left.epoch || 0));
  if (candidates.length === 0) return { lease: null, ambiguous: false };
  const highestEpoch = Number(candidates[0].epoch || 0);
  const highest = candidates.filter(
    lease => Number(lease.epoch || 0) === highestEpoch,
  );
  return {
    lease: highest.length === 1 ? highest[0] : null,
    ambiguous: highest.length !== 1,
  };
}

function readRepositoryLeases(repository, git) {
  const commonDirectory = path.resolve(
    repository,
    git(repository, ["rev-parse", "--git-common-dir"]).trim(),
  );
  const registryPath = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "writer-leases.json",
  );
  if (!existsSync(registryPath)) {
    return {
      leases: [],
      registryDigest: digestValue({
        schema: "agentic-writer-lease-registry/v2",
        revision: 0,
        leases: {},
      }),
    };
  }
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  if (
    registry?.schema !== "agentic-writer-lease-registry/v2"
    || !registry.leases
    || typeof registry.leases !== "object"
  ) {
    throw new Error(`Unsupported writer lease registry at ${registryPath}.`);
  }
  return {
    leases: Object.values(registry.leases),
    registryDigest: digestValue(registry),
  };
}

function normalizeLeaseSnapshot(value) {
  if (Array.isArray(value)) {
    return {
      leases: value,
      registryDigest: digestValue(value),
    };
  }
  if (
    !value
    || !Array.isArray(value.leases)
    || !/^[0-9a-f]{64}$/u.test(String(value.registryDigest || ""))
  ) {
    throw new Error("Lane-state inspection received an invalid lease snapshot.");
  }
  return value;
}

function nullList(value) {
  return String(value || "").split("\0").filter(Boolean).sort();
}

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

export function assertPeersUnchanged(report, verification) {
  return reconcileIndependentPeerOperations({ report, verification });
}

function withReportDigest(report) {
  const value = { ...report };
  delete value.reportDigest;
  return Object.freeze({ ...value, reportDigest: digestValue(value) });
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
