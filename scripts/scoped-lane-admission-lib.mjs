import path from "node:path";
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import {
  DELIVERY_PEER_VERIFICATION_SCHEMA,
  verifyDeliveryAuthorizedPeerAuthorities,
} from "./scoped-lane-delivery-peer-authority.mjs";
import {
  LANE_ADMISSION_LEASE_SCHEMA,
  LANE_CLOUD_AUTHORITY_SCHEMA,
  classifyExistingLane,
  isOperationDerivedCloudVerification,
  isOperationDerivedDormantPreservation,
  isReadyRemoteInventory,
  markOperationDerivedCloudVerification,
} from "./scoped-lane-authority-state.mjs";
import {
  assertRootSourceBootstrapCurrent,
  normalizeRootSourceBootstrapAuthorization,
  ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA,
} from "./scoped-lane-bootstrap-authorization.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";
export const DECLARED_WRITE_SCOPE_SCHEMA = "agentic-declared-write-scope/v1";
export const LANE_ADMISSION_REPORT_SCHEMA = "agentic-lane-admission-report/v1";
export {
  LANE_ADMISSION_LEASE_SCHEMA,
  LANE_CLOUD_AUTHORITY_SCHEMA,
  assertRootSourceBootstrapCurrent,
  isOperationDerivedCloudVerification,
  markOperationDerivedCloudVerification,
  ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA,
};

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function normalizeDeclaredWriteScopeManifest(source, { expectedScope = "" } = {}) {
  requireObject(source, "Declared write-scope manifest");
  if (source.schema !== DECLARED_WRITE_SCOPE_SCHEMA) {
    throw new Error(`Declared write-scope manifest schema must be ${DECLARED_WRITE_SCOPE_SCHEMA}.`);
  }
  const semanticScope = requiredText(source.semanticScope, "semanticScope");
  if (expectedScope && semanticScope !== expectedScope) {
    throw new Error(`Declared write-scope manifest owns ${semanticScope}, not ${expectedScope}.`);
  }
  if (!Array.isArray(source.paths) || source.paths.length === 0) {
    throw new Error("Declared write-scope manifest paths must be a non-empty array.");
  }
  const declaredPaths = normalizeWriteSet(source.paths);
  if (declaredPaths.some(item => !item.startsWith("path:"))) {
    throw new Error("Declared write-scope manifest paths must contain repository-relative paths only.");
  }
  const declaredWriteSet = normalizeWriteSet([
    `semantic:${semanticScope}`,
    ...declaredPaths,
  ]);
  const manifest = {
    schema: DECLARED_WRITE_SCOPE_SCHEMA,
    semanticScope,
    paths: declaredPaths.map(item => item.slice("path:".length)),
  };
  return Object.freeze({
    ...manifest,
    declaredWriteSet,
    manifestDigest: digestValue(manifest),
    writeSetDigest: digestValue(declaredWriteSet),
  });
}

export function projectAdmissionRemoteClaim(
  claim,
  { classification, overlapReasons = [] } = {},
) {
  return {
    claimId: claim.claimId,
    entrySchema: claim.entrySchema ?? null,
    claimIdentitySchema: claim.claimIdentitySchema ?? null,
    operationReceiptDigest: claim.operationReceiptDigest ?? null,
    state: claim.state,
    actorId: claim.actorId,
    deviceId: claim.deviceId ?? null,
    sessionId: claim.sessionId ?? null,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    predecessorClaimId: claim.predecessorClaimId ?? null,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    declaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter,
    reviewRequestId: claim.reviewRequestId,
    expiresAt: claim.expiresAt,
    fenceRevision: claim.fenceRevision,
    transitionDigest: claim.transitionDigest,
    ledgerSequence: claim.ledgerSequence ?? null,
    operationTime: claim.operationTime ?? null,
    recordDigest: claim.recordDigest,
    classification,
    overlapReasons,
  };
}

export function normalizeCloudAuthority(source, {
  ledgerRepository,
  targetRepository,
  manifest,
  canonicalBaseSha,
  now = new Date(),
} = {}) {
  requireObject(source, "Cloud authority");
  const result = source.schema === "agentic-cloud-collaboration-result/v1"
    ? source
    : source.result;
  requireObject(result, "Cloud authority result");
  if (
    result.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || !["claim", "continue", "verify", "bind"].includes(result.action)
  ) {
    throw new Error("Cloud authority must contain a successful repository cloud-collaboration result.");
  }
  const claim = result.claim;
  requireObject(claim, "Cloud authority claim");
  const normalized = {
    schema: LANE_CLOUD_AUTHORITY_SCHEMA,
    provider: "github",
    ledgerRepository: requiredRepository(source.ledgerRepository || ledgerRepository, "ledgerRepository"),
    targetRepository: requiredRepository(source.targetRepository || targetRepository, "targetRepository"),
    claimId: requiredDigest(claim.claimId, "claimId"),
    claimDigest: requiredDigest(result.claimDigest || claim.fenceRevision, "claimDigest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "ledgerRevision"),
    claimLedgerRevision: requiredDigest(claim.transitionDigest, "claimLedgerRevision"),
    canonicalBaseSha: requiredSha(claim.canonicalBaseRevision, "canonicalBaseRevision"),
    laneRevision: requiredSha(claim.laneRevision, "laneRevision"),
    cloudDeclaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: requiredDigest(claim.writeSetDigest, "writeSetDigest"),
    deviceId: claim.deviceId || source.deviceId || null,
    sessionId: claim.sessionId || source.sessionId || null,
    reviewRequestId: claim.reviewRequestId ? requiredText(claim.reviewRequestId, "reviewRequestId") : null,
    leaseEpoch: positiveInteger(claim.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(claim.transitionCounter, "transitionCounter"),
    state: projectAdmissionState(claim.state || claim.status),
    expiresAt: requiredInstant(claim.expiresAt, "expiresAt"),
  };
  if (normalized.state !== "active") {
    throw new Error(`Cloud admission claim must be active; received ${normalized.state || "missing"}.`);
  }
  if (Date.parse(normalized.expiresAt) <= now.getTime()) {
    throw new Error(`Cloud admission claim expired at ${normalized.expiresAt}.`);
  }
  if (manifest) {
    if (normalized.writeSetDigest !== manifest.writeSetDigest) {
      throw new Error("Cloud claim write-set digest does not match the declared write-scope manifest.");
    }
    if (JSON.stringify(normalized.cloudDeclaredWriteScope) !== JSON.stringify(manifest.declaredWriteSet)) {
      throw new Error("Cloud claim write scope does not match the declared write-scope manifest.");
    }
  }
  if (canonicalBaseSha && normalized.canonicalBaseSha !== canonicalBaseSha) {
    throw new Error("Cloud claim canonical base does not match fetched origin/main.");
  }
  if (normalized.laneRevision !== normalized.canonicalBaseSha) {
    throw new Error("Fresh lane cloud claim must start at its exact canonical base revision.");
  }
  Object.defineProperty(normalized, "ledgerDigest", {
    value: requiredDigest(
      result.ledgerDigest || result.receipt?.ledgerDigest,
      "ledgerDigest",
    ),
    enumerable: false,
  });
  return Object.freeze(normalized);
}

export function evaluateScopedLaneAdmission({
  repository,
  canonicalPath,
  canonicalBaseSha,
  targetPath,
  branch,
  semanticScope,
  targetSafe,
  manifest,
  lanes,
  cloudAuthority = null,
  remoteAuthorityRequired = false,
  remoteAuthorityVerification = null,
  canonicalSourceDisposition = "exact",
  dormantPreservationReceipt = null,
  rootSourceBootstrapAuthorization = null,
  inspectRootSourceMaintenance = undefined,
  mode = remoteAuthorityRequired ? "check" : "plan",
  evaluatedAt = new Date().toISOString(),
}) {
  const findings = [];
  const normalizedRepository = path.resolve(requiredText(repository, "repository"));
  const normalizedCanonicalPath = path.resolve(requiredText(canonicalPath, "canonicalPath"));
  const normalizedTargetPath = path.resolve(requiredText(targetPath, "targetPath"));
  const evaluationTime = new Date(requiredInstant(evaluatedAt, "evaluatedAt"));
  requiredSha(canonicalBaseSha, "canonicalBaseSha");
  if (!parseDeviceBranch(branch) || parseDeviceBranch(branch).scope !== semanticScope) {
    throw new Error("Candidate branch must be the exact agent/<device>/<semantic-scope> identity.");
  }
  if (!manifest || manifest.semanticScope !== semanticScope) {
    throw new Error("Admission requires the normalized declared write-scope manifest for its semantic scope.");
  }
  const normalizedLanes = [...lanes].map(normalizeLane).sort(compareLanes);
  const canonicalLanes = normalizedLanes.filter(
    lane => lane.path === normalizedCanonicalPath && lane.branch === "refs/heads/main",
  );
  if (canonicalLanes.length !== 1) {
    findings.push(finding("canonical-structure-ambiguous", "global", {
      observedCanonicalOwners: canonicalLanes.length,
    }));
  } else {
    const canonical = canonicalLanes[0];
    const canonicalSourceReady = canonical.head === canonicalBaseSha
      ? canonicalSourceDisposition === "exact"
      : canonicalSourceDisposition === "preserved-behind";
    if (!canonicalSourceReady || canonical.dirty) {
      findings.push(finding("canonical-base-drift", "global", {
        expectedHead: canonicalBaseSha,
        observedHead: canonical.head,
        dirty: canonical.dirty,
        sourceDisposition: canonicalSourceDisposition,
      }));
    }
    if (canonical.invalid) {
      findings.push(finding("canonical-structure-ambiguous", "global", {
        path: canonical.path,
      }));
    }
  }
  if (!targetSafe) {
    findings.push(finding("unsafe-target", "candidate", { path: normalizedTargetPath }));
  }
  if (normalizedLanes.some(lane => lane.path === normalizedTargetPath)) {
    findings.push(finding("target-worktree-collision", "candidate", { path: normalizedTargetPath }));
  }
  const duplicateBranches = duplicates(
    normalizedLanes.map(lane => lane.branch).filter(Boolean),
  );
  for (const duplicateBranch of duplicateBranches) {
    findings.push(finding("structural-branch-ambiguity", "global", {
      branch: duplicateBranch,
    }));
  }

  const inventoryReady = isReadyRemoteInventory(remoteAuthorityVerification);
  const authorityReady = Boolean(cloudAuthority) && hasReadyRemoteAuthority({
    cloudAuthority, remoteAuthorityVerification, canonicalBaseSha, manifest,
  });
  const currentRemoteClaims = inventoryReady ? remoteAuthorityVerification.inventory.claims : null;
  const rootSourceBootstrap = normalizeRootSourceBootstrapAuthorization({
    source: rootSourceBootstrapAuthorization,
    lanes: normalizedLanes,
    canonicalPath: normalizedCanonicalPath,
    canonicalBaseSha,
    targetPath: normalizedTargetPath,
    branch,
    semanticScope,
    manifest,
    cloudAuthority,
    remoteAuthorityVerification,
    currentRemoteClaims,
    evaluatedAt: evaluationTime,
    inspectMaintenanceSource: inspectRootSourceMaintenance,
  });
  const canonicalDirtyBootstrap = rootSourceBootstrap?.maintenanceMode
    === "canonical-dirty-main"
    && rootSourceBootstrap.maintenanceSourcePath === normalizedCanonicalPath
    && canonicalSourceDisposition === "root-bootstrap-dirty"
    && canonicalLanes.length === 1
    && canonicalLanes[0].dirty;
  if (canonicalDirtyBootstrap) {
    const canonicalFindingIndex = findings.findIndex(candidate => (
      candidate.type === "canonical-base-drift" && candidate.blockScope === "global"
    ));
    if (canonicalFindingIndex >= 0) findings.splice(canonicalFindingIndex, 1);
  }
  const rootSourceAuthorizations = new Map(
    rootSourceBootstrap?.preservedLanes.map(lane => [lane.path, lane]) || [],
  );
  let classifiedLanes = normalizedLanes.map(lane => {
    if (lane.path === normalizedCanonicalPath && lane.branch === "refs/heads/main") {
      return {
        ...lane,
        classification: "canonical",
        authorityState: "canonical",
        dormantPreservationReceiptDigest: null,
        overlapReasons: [],
      };
    }
    if (lane.path === rootSourceBootstrap?.maintenanceSourcePath) {
      return {
        ...lane,
        classification: "disjoint-attributed",
        authorityState: "unattributed",
        dormantPreservationReceiptDigest: null,
        overlapReasons: [
          `root-source-bootstrap-maintenance:${rootSourceBootstrap.authorizationDigest}`,
        ],
      };
    }
    const bootstrapLane = rootSourceAuthorizations.get(lane.path);
    if (bootstrapLane) {
      return {
        ...lane,
        classification: "disjoint-attributed",
        authorityState: "unattributed",
        dormantPreservationReceiptDigest: null,
        overlapReasons: [
          `root-source-bootstrap-preserved:${rootSourceBootstrap.authorizationDigest}`,
        ],
      };
    }
    return classifyExistingLane({
      lane,
      branch,
      semanticScope,
      declaredWriteSet: manifest.declaredWriteSet,
      evaluatedAt: evaluationTime,
      currentRemoteClaims,
      dormantPreservationReceipt,
    });
  });
  if (inventoryReady) {
    try {
      const deliveryPeerVerification = verifyDeliveryAuthorizedPeerAuthorities({
        lanes: normalizedLanes,
        remoteAuthorityVerification,
        evaluatedAt: evaluationTime.toISOString(),
      });
      classifiedLanes = bindOperationDerivedDeliveryPeerLaneStates(
        classifiedLanes,
        deliveryPeerVerification,
      );
    } catch {
      // Partial or stale delivery-peer proof is non-authoritative.
    }
  }
  for (const lane of classifiedLanes) {
    if (lane.classification === "overlapping") {
      findings.push(finding("scope-admission-collision", "semantic-scope", {
        path: lane.path,
        branch: lane.branch,
        reasons: lane.overlapReasons,
      }));
    }
    if (lane.classification === "ambiguous") {
      findings.push(finding("unattributed-lane-ambiguity", "global", {
        path: lane.path,
        branch: lane.branch,
        reasons: lane.overlapReasons,
      }));
    }
  }
  const attributedRemoteClaimIds = new Set(classifiedLanes
    .filter(lane => lane.classification === "disjoint-attributed")
    .map(lane => lane.lease?.cloudAuthority?.claimId)
    .filter(Boolean));
  const remoteClaims = currentRemoteClaims
    ? currentRemoteClaims.map(claim => {
      if (claim.claimId === cloudAuthority?.claimId) {
        return projectAdmissionRemoteClaim(claim, {
          classification: "candidate",
          overlapReasons: [],
        });
      }
      if (attributedRemoteClaimIds.has(claim.claimId)) {
        return projectAdmissionRemoteClaim(claim, {
          classification: "disjoint-attributed",
          overlapReasons: [],
        });
      }
      const overlap = writeSetsOverlap(
        claim.declaredWriteScope,
        manifest.declaredWriteSet,
      );
      if (claim.state === "waiting-successor") {
        return projectAdmissionRemoteClaim(claim, {
          classification: "waiting-successor",
          overlapReasons: overlap ? ["waiting-behind-current-authority"] : [],
        });
      }
      return projectAdmissionRemoteClaim(claim, {
        classification: overlap ? "overlapping" : "disjoint-attributed",
        overlapReasons: overlap ? ["write-set-overlap"] : [],
      });
    })
    : [];
  for (const claim of remoteClaims.filter(item => item.classification === "overlapping")) {
    findings.push(finding("scope-admission-collision", "semantic-scope", {
      claimId: claim.claimId,
      reasons: claim.overlapReasons,
    }));
  }
  if (remoteAuthorityRequired && !authorityReady) {
    findings.push(finding("cloud-authority-unproven", "global", {
      configured: Boolean(cloudAuthority),
      verified: authorityReady,
    }));
  }
  if (cloudAuthority) {
    if (
      cloudAuthority.canonicalBaseSha !== canonicalBaseSha
      || cloudAuthority.writeSetDigest !== manifest.writeSetDigest
      || cloudAuthority.state !== "active"
    ) {
      findings.push(finding("stale-collaboration-fence", "semantic-scope", {
        claimId: cloudAuthority.claimId || null,
      }));
    }
  }

  findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!["plan", "check"].includes(mode)) {
    throw new Error("Admission mode must be plan or check.");
  }
  const authoringStatus = findings.length > 0 ? "blocked" : "planned";
  const classifiedByPath = new Map(classifiedLanes.map(lane => [lane.path, lane]));
  const existingLaneStateDigest = digestValue(
    normalizedLanes.map(lane => ({
      path: lane.path,
      stateDigest: lane.stateDigest,
      authorityState: classifiedByPath.get(lane.path)?.authorityState,
      dormantPreservationReceiptDigest: classifiedByPath
        .get(lane.path)?.dormantPreservationReceiptDigest,
    })),
  );
  const report = {
    schema: LANE_ADMISSION_REPORT_SCHEMA,
    mode,
    repository: normalizedRepository,
    evaluatedAt: evaluationTime.toISOString(),
    canonicalBaseSha,
    candidate: {
      semanticScope,
      branch,
      targetPath: normalizedTargetPath,
      manifestDigest: manifest.manifestDigest,
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
    },
    existingLaneStateDigest,
    lanes: classifiedLanes,
    dormantPreservationReceipts: isOperationDerivedDormantPreservation(dormantPreservationReceipt)
      ? [dormantPreservationReceipt]
      : [],
    remoteClaimInventoryDigest:
      remoteAuthorityVerification?.remoteClaimInventoryDigest || null,
    remoteClaims,
    cloudAuthority,
    ...(rootSourceBootstrap
      ? { rootSourceBootstrapAuthorization: rootSourceBootstrap }
      : {}),
    authoringAdmission: {
      status: authoringStatus,
      findings,
      receiptDigest: null,
    },
    admissionReceipt: null,
    preservationReceipt: null,
    admissionRuntimeConformance: {
      status: "unevaluated",
      independent: true,
      receiptDigest: null,
      reason: "independent-conformance-not-run",
    },
    runtimeReadiness: {
      status: "unevaluated",
      independent: true,
      receiptDigest: null,
      reason: "task-worktrees-are-source-only",
    },
    lifecycleReadiness: {
      status: "unevaluated",
      independent: true,
      receiptDigest: null,
      reason: "global-lifecycle-unevaluated",
    },
  };
  return Object.freeze({
    ...report,
    reportDigest: digestValue(report),
  });
}

export function bindOperationDerivedDeliveryPeerLaneStates(lanes, verification) {
  if (
    verification?.schema !== DELIVERY_PEER_VERIFICATION_SCHEMA
    || verification.status !== "ready"
  ) {
    return lanes;
  }
  const peers = new Map((verification.peers || []).map(peer => [peer.path, peer]));
  return lanes.map(lane => {
    const peer = peers.get(lane.path);
    if (!peer) return lane;
    return {
      ...lane,
      classification: "disjoint-attributed",
      authorityState: "delivery-authorized",
      overlapReasons: [],
      stateDigest: digestValue({
        priorStateDigest: lane.stateDigest,
        authorityDigest: peer.authorityDigest,
      }),
    };
  });
}

export function createAdmissionLeaseProjection(report) {
  const status = report?.authoringAdmission?.status;
  if (
    report?.schema !== LANE_ADMISSION_REPORT_SCHEMA
    || !["planned", "admitted"].includes(status)
  ) {
    throw new Error("Only a planned or admitted scoped lane report can project to a writer lease.");
  }
  const projection = {
    schema: LANE_ADMISSION_LEASE_SCHEMA,
    status,
    semanticScope: report.candidate.semanticScope,
    declaredWriteSet: report.candidate.declaredWriteSet,
    writeSetDigest: report.candidate.writeSetDigest,
    manifestDigest: report.candidate.manifestDigest,
    planReceiptDigest: status === "planned"
      ? report.reportDigest
      : requiredDigest(report.planReportDigest, "planReportDigest"),
    admissionReceiptDigest: requiredDigest(
      report.admissionReceipt?.receiptDigest,
      "admissionReceiptDigest",
    ),
    existingLaneStateDigest: report.existingLaneStateDigest,
  };
  if (status === "admitted") {
    projection.admittedReportDigest = report.reportDigest;
    projection.preservationReceiptDigest = requiredDigest(
      report.preservationReceipt?.receiptDigest,
      "preservationReceiptDigest",
    );
  }
  return Object.freeze(projection);
}

function hasReadyRemoteAuthority({
  cloudAuthority, remoteAuthorityVerification, canonicalBaseSha, manifest,
}) {
  if (
    !remoteAuthorityVerification
    || !isOperationDerivedCloudVerification(remoteAuthorityVerification)
    || remoteAuthorityVerification.schema !== "agentic-lane-cloud-verification/v1"
    || remoteAuthorityVerification.status !== "ready"
    || remoteAuthorityVerification.inventory?.schema !== "agentic-cloud-claim-inventory/v1"
    || remoteAuthorityVerification.remoteClaimInventoryDigest
      !== remoteAuthorityVerification.inventory.inventoryDigest
    || remoteAuthorityVerification.ledgerRevision
      !== remoteAuthorityVerification.inventory.observedLedgerHeadRevision
    || remoteAuthorityVerification.ledgerDigest
      !== remoteAuthorityVerification.inventory.ledgerDigest
    || remoteAuthorityVerification.verifiedAt
      !== remoteAuthorityVerification.inventory.evaluationTime
  ) return false;
  return (
    remoteAuthorityVerification.claimId === cloudAuthority.claimId
    && remoteAuthorityVerification.claimDigest === cloudAuthority.claimDigest
    && remoteAuthorityVerification.ledgerRevision === cloudAuthority.ledgerRevision
    && remoteAuthorityVerification.canonicalBaseSha === canonicalBaseSha
    && remoteAuthorityVerification.writeSetDigest === manifest.writeSetDigest
    && remoteAuthorityVerification.laneRevision === cloudAuthority.laneRevision
    && remoteAuthorityVerification.reviewRequestId === cloudAuthority.reviewRequestId
    && remoteAuthorityVerification.inventory.claims.some(claim => (
      claim.claimId === cloudAuthority.claimId
      && claim.fenceRevision === cloudAuthority.claimDigest
      && claim.transitionDigest === cloudAuthority.claimLedgerRevision
    ))
  );
}
function projectAdmissionState(value) {
  const normalized = String(value || "").replaceAll("-", "_");
  return normalized === "current" ? "active" : normalized;
}
function normalizeLane(lane) {
  requireObject(lane, "Lane");
  const normalized = {
    path: path.resolve(requiredText(lane.path, "lane.path")),
    head: requiredSha(lane.head, "lane.head"),
    branch: lane.branch ? requiredText(lane.branch, "lane.branch") : null,
    detached: Boolean(lane.detached),
    dirty: Boolean(lane.dirty),
    invalid: Boolean(lane.invalid || lane.bare || lane.locked || lane.prunable),
    leaseAmbiguous: Boolean(lane.leaseAmbiguous),
    lease: lane.lease || null,
    stateDigest: requiredDigest(lane.stateDigest, "lane.stateDigest"),
  };
  return Object.freeze(normalized);
}
function finding(type, blockScope, evidence) {
  return { type, blockScope, evidence };
}
function compareLanes(left, right) {
  return left.path.localeCompare(right.path);
}
function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}
function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a lowercase 40-character SHA.`);
  return normalized;
}
function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return normalized;
}

function requiredRepository(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
    throw new Error(`${label} must be an owner/repository name.`);
  }
  return normalized;
}

function requiredInstant(value, label) {
  const normalized = requiredText(value, label);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO-8601 instant.`);
  return new Date(milliseconds).toISOString();
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return normalized;
}
