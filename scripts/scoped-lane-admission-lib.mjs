import path from "node:path";
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";
export const DECLARED_WRITE_SCOPE_SCHEMA = "agentic-declared-write-scope/v1";
export const LANE_ADMISSION_REPORT_SCHEMA = "agentic-lane-admission-report/v1";
export const LANE_ADMISSION_LEASE_SCHEMA = "agentic-lane-admission-lease/v1";
export const LANE_CLOUD_AUTHORITY_SCHEMA = "agentic-lane-cloud-authority/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const operationDerivedCloudVerifications = new WeakSet();
const operationDerivedDeliveryPeerHeads = new WeakMap();
const ADMITTED_LANE_STATES = new Set(["active", "delivery", "review_ready", "parked"]);

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
    || !["claim", "verify", "bind"].includes(result.action)
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
    state: String(claim.state || claim.status || "").replaceAll("-", "_"),
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
    if (canonical.head !== canonicalBaseSha || canonical.dirty) {
      findings.push(finding("canonical-base-drift", "global", {
        expectedHead: canonicalBaseSha,
        observedHead: canonical.head,
        dirty: canonical.dirty,
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

  const authorityReady = hasReadyRemoteAuthority({
    cloudAuthority,
    remoteAuthorityVerification,
    canonicalBaseSha,
    manifest,
  });
  const currentRemoteClaims = authorityReady
    ? remoteAuthorityVerification.inventory.claims
    : null;
  const classifiedLanes = normalizedLanes.map(lane => {
    if (lane.path === normalizedCanonicalPath && lane.branch === "refs/heads/main") {
      return { ...lane, classification: "canonical", overlapReasons: [] };
    }
    return classifyExistingLane({
      lane,
      branch,
      semanticScope,
      declaredWriteSet: manifest.declaredWriteSet,
      evaluatedAt: evaluationTime,
      currentRemoteClaims,
    });
  });
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
  const remoteClaims = currentRemoteClaims
    ? currentRemoteClaims.map(claim => {
      if (claim.claimId === cloudAuthority.claimId) {
        return { ...claim, classification: "candidate", overlapReasons: [] };
      }
      const overlap = writeSetsOverlap(
        claim.declaredWriteScope,
        manifest.declaredWriteSet,
      );
      return {
        ...claim,
        classification: overlap ? "overlapping" : "disjoint-attributed",
        overlapReasons: overlap ? ["write-set-overlap"] : [],
      };
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
  const existingLaneStateDigest = digestValue(
    normalizedLanes.map(lane => ({
      path: lane.path,
      stateDigest: lane.stateDigest,
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
    remoteClaimInventoryDigest:
      remoteAuthorityVerification?.remoteClaimInventoryDigest || null,
    remoteClaims,
    cloudAuthority,
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

export function markOperationDerivedCloudVerification(verification) {
  requireObject(verification, "Cloud verification");
  operationDerivedCloudVerifications.add(verification);
  return verification;
}
export function isOperationDerivedCloudVerification(verification) {
  return operationDerivedCloudVerifications.has(verification);
}
export function attachOperationDerivedDeliveryPeerHead(lane, source) {
  requireObject(lane, "Lane");
  requireObject(source, "Delivery peer head observation");
  const observation = {
    schema: requiredText(source.schema, "delivery peer head schema"),
    status: requiredText(source.status, "delivery peer head status"),
    reviewedHeadSha: requiredSha(
      source.reviewedHeadSha,
      "delivery peer reviewed head",
    ),
    observedHeadSha: requiredSha(
      source.observedHeadSha,
      "delivery peer observed head",
    ),
    protectedMainRefresh: source.protectedMainRefresh || null,
  };
  if (observation.schema !== "agentic-delivery-peer-head-observation/v1") {
    throw new Error("Delivery peer head observation schema is unsupported.");
  }
  if (!["reviewed-head", "protected-main-refresh"].includes(observation.status)) {
    throw new Error("Delivery peer head observation status is unsupported.");
  }
  if (
    (observation.status === "reviewed-head" && (
      observation.reviewedHeadSha !== observation.observedHeadSha
      || observation.protectedMainRefresh !== null
    ))
    || (observation.status === "protected-main-refresh" && (
      observation.reviewedHeadSha === observation.observedHeadSha
      || !isBoundedProtectedMainRefresh(
        observation.protectedMainRefresh,
        observation.reviewedHeadSha,
        observation.observedHeadSha,
      )
    ))
  ) {
    throw new Error("Delivery peer head observation does not bind one exact reviewed or protected-refresh head.");
  }
  const evidenceDigest = requiredDigest(
    source.evidenceDigest,
    "delivery peer head evidenceDigest",
  );
  if (evidenceDigest !== digestValue(observation)) {
    throw new Error("Delivery peer head observation digest does not bind its complete evidence.");
  }
  operationDerivedDeliveryPeerHeads.set(
    lane,
    Object.freeze({ ...observation, evidenceDigest }),
  );
  return lane;
}
function classifyExistingLane({
  lane,
  branch,
  semanticScope,
  declaredWriteSet,
  evaluatedAt,
  currentRemoteClaims,
}) {
  const reasons = [];
  if (lane.invalid || lane.leaseAmbiguous) reasons.push("structural-ambiguity");
  if (lane.branch === `refs/heads/${branch}`) reasons.push("same-branch");
  const identity = lane.branch
    ? parseDeviceBranch(lane.branch.replace(/^refs\/heads\//u, ""))
    : null;
  if (identity?.scope === semanticScope) reasons.push("same-semantic-scope");
  const lease = lane.lease;
  if (!hasAuthoritativeLaneOwner(lane, lease, evaluatedAt, currentRemoteClaims)) {
    reasons.push("missing-authoritative-owner");
  }
  const authoritativeScope = lease?.admission?.declaredWriteSet;
  if (Array.isArray(authoritativeScope)) {
    try {
      if (writeSetsOverlap(authoritativeScope, declaredWriteSet)) {
        reasons.push("write-set-overlap");
      }
    } catch {
      reasons.push("invalid-declared-write-scope");
    }
  }
  const collision = reasons.some(reason => [
    "same-branch",
    "same-semantic-scope",
    "write-set-overlap",
  ].includes(reason));
  if (collision) return { ...lane, classification: "overlapping", overlapReasons: reasons };
  if (reasons.length > 0) return { ...lane, classification: "ambiguous", overlapReasons: reasons };
  return { ...lane, classification: "disjoint-attributed", overlapReasons: [] };
}

function hasAuthoritativeLaneOwner(lane, lease, evaluatedAt, currentRemoteClaims) {
  if (
    !lease
    || !ADMITTED_LANE_STATES.has(lease.status)
    || !Array.isArray(currentRemoteClaims)
  ) return false;
  if (path.resolve(lease.worktreePath || "") !== lane.path) return false;
  const checkedOut = lane.branch?.replace(/^refs\/heads\//u, "") || null;
  if (checkedOut && checkedOut !== lease.branch) return false;
  if (hasDeliveryAuthorizedSuccessorOwner({
    lane,
    lease,
    evaluatedAt,
    currentRemoteClaims,
  })) return true;
  const identity = parseDeviceBranch(lease.branch);
  const localExpiry = Date.parse(lease.expiresAt);
  const cloud = lease.cloudAuthority;
  const cloudExpiry = Date.parse(cloud?.expiresAt);
  const expectedCloudState = {
    active: "active",
    delivery: "delivery_authorized",
    review_ready: "review_ready",
    parked: "parked",
  }[lease.status];
  const expectedLaneRevision = lease.status === "review_ready"
    ? lease.reviewHeadSha
    : lease.status === "delivery"
      ? lease.deliveryHeadSha
      : lease.fenceSha;
  if (
    !lease.sessionId
    || !identity
    || identity.device !== lease.device
    || identity.scope !== lease.scope
    || !Number.isInteger(lease.epoch)
    || lease.epoch < 1
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || !lease.pullRequestUrl
    || !DIGEST_PATTERN.test(String(lease.admission?.writeSetDigest || ""))
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission.status !== "admitted"
    || lease.admission.semanticScope !== lease.scope
    || !DIGEST_PATTERN.test(String(lease.admission.admissionReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.preservationReceiptDigest || ""))
    || cloud?.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || cloud.writeSetDigest !== lease.admission.writeSetDigest
    || cloud.canonicalBaseSha !== lease.baseSha
    || cloud.deviceId !== lease.device
    || cloud.sessionId !== lease.sessionId
    || !cloud.reviewRequestId
    || cloud.state !== expectedCloudState
    || !SHA_PATTERN.test(String(expectedLaneRevision || ""))
    || lane.head !== expectedLaneRevision
    || !Number.isFinite(cloudExpiry)
    || cloudExpiry <= evaluatedAt.getTime()
    || (Number.isFinite(localExpiry) && localExpiry > cloudExpiry)
    || (
      lease.status === "active"
      && (!Number.isFinite(localExpiry) || localExpiry <= evaluatedAt.getTime())
    )
  ) return false;
  try {
    const declaredWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
    const cloudWriteSet = normalizeWriteSet(cloud.cloudDeclaredWriteScope);
    const matches = currentRemoteClaims.filter(claim => claim.claimId === cloud.claimId);
    if (matches.length !== 1) return false;
    const remote = matches[0];
    return (
      remote.claimId === digestValue({
        actorId: remote.actorId, canonicalBaseRevision: remote.canonicalBaseRevision,
        deviceId: pseudonymousIdentifier("device", cloud.deviceId), leaseEpoch: remote.leaseEpoch,
        repositoryId: remote.repositoryId,
        sessionId: pseudonymousIdentifier("session", cloud.sessionId),
        workItemId: remote.workItemId, writeSetDigest: remote.writeSetDigest,
      })
      && digestValue(declaredWriteSet) === lease.admission.writeSetDigest
      && JSON.stringify(cloudWriteSet) === JSON.stringify(declaredWriteSet)
      && JSON.stringify(remote.declaredWriteScope) === JSON.stringify(declaredWriteSet)
      && remote.writeSetDigest === lease.admission.writeSetDigest
      && remote.fenceRevision === cloud.claimDigest
      && remote.transitionDigest === cloud.claimLedgerRevision
      && remote.canonicalBaseRevision === cloud.canonicalBaseSha
      && remote.laneRevision === cloud.laneRevision
      && remote.laneRevision === expectedLaneRevision
      && remote.leaseEpoch === cloud.leaseEpoch
      && remote.transitionCounter === cloud.transitionCounter
      && remote.state === cloud.state
      && remote.expiresAt === cloud.expiresAt
      && remote.reviewRequestId === cloud.reviewRequestId
    );
  } catch {
    return false;
  }
}
function hasDeliveryAuthorizedSuccessorOwner({
  lane,
  lease,
  evaluatedAt,
  currentRemoteClaims,
}) {
  const observation = operationDerivedDeliveryPeerHeads.get(lane);
  const cloud = lease?.cloudAuthority;
  const identity = parseDeviceBranch(lease?.branch || "");
  if (
    !observation
    || lane.dirty
    || lease.status !== "review_ready"
    || !identity
    || identity.device !== lease.device
    || identity.scope !== lease.scope
    || !Number.isInteger(lease.epoch)
    || lease.epoch < 1
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || !SHA_PATTERN.test(String(lease.reviewHeadSha || ""))
    || !lease.pullRequestUrl
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission.status !== "admitted"
    || lease.admission.semanticScope !== lease.scope
    || !Array.isArray(lease.admission.declaredWriteSet)
    || !DIGEST_PATTERN.test(String(lease.admission.writeSetDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.admissionReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.preservationReceiptDigest || ""))
    || cloud?.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || cloud.state !== "review_ready"
    || cloud.deviceId !== lease.device
    || cloud.sessionId !== lease.sessionId
    || cloud.canonicalBaseSha !== lease.baseSha
    || cloud.laneRevision !== lease.reviewHeadSha
    || cloud.writeSetDigest !== lease.admission.writeSetDigest
    || !cloud.reviewRequestId
    || !DIGEST_PATTERN.test(String(cloud.focusedEvidenceDigest || ""))
    || !DIGEST_PATTERN.test(String(cloud.claimDigest || ""))
    || !DIGEST_PATTERN.test(String(cloud.claimLedgerRevision || ""))
    || !Number.isInteger(cloud.transitionCounter)
    || cloud.transitionCounter < 1
    || Date.parse(cloud.expiresAt) <= evaluatedAt.getTime()
    || observation.reviewedHeadSha !== lease.reviewHeadSha
    || observation.observedHeadSha !== lane.head
  ) return false;
  try {
    const declaredWriteSet = normalizeWriteSet(
      lease.admission.declaredWriteSet,
    );
    const cloudWriteSet = normalizeWriteSet(cloud.cloudDeclaredWriteScope);
    const matches = currentRemoteClaims.filter(
      claim => claim.claimId === cloud.claimId,
    );
    if (matches.length !== 1) return false;
    const remote = matches[0];
    return (
      remote.claimId === digestValue({
        actorId: remote.actorId,
        canonicalBaseRevision: remote.canonicalBaseRevision,
        deviceId: pseudonymousIdentifier("device", cloud.deviceId),
        leaseEpoch: remote.leaseEpoch,
        repositoryId: remote.repositoryId,
        sessionId: pseudonymousIdentifier("session", cloud.sessionId),
        workItemId: remote.workItemId,
        writeSetDigest: remote.writeSetDigest,
      })
      && digestValue(declaredWriteSet) === lease.admission.writeSetDigest
      && JSON.stringify(cloudWriteSet) === JSON.stringify(declaredWriteSet)
      && JSON.stringify(remote.declaredWriteScope) === JSON.stringify(declaredWriteSet)
      && remote.writeSetDigest === lease.admission.writeSetDigest
      && remote.canonicalBaseRevision === cloud.canonicalBaseSha
      && remote.laneRevision === cloud.laneRevision
      && remote.laneRevision === lease.reviewHeadSha
      && remote.leaseEpoch === cloud.leaseEpoch
      && remote.transitionCounter === cloud.transitionCounter + 1
      && remote.state === "delivery_authorized"
      && remote.expiresAt === cloud.expiresAt
      && remote.reviewRequestId === cloud.reviewRequestId
      && remote.fenceRevision !== cloud.claimDigest
      && remote.transitionDigest !== cloud.claimLedgerRevision
    );
  } catch {
    return false;
  }
}
function isBoundedProtectedMainRefresh(receipt, reviewedHeadSha, observedHeadSha) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  if (
    receipt.deliveredHeadSha !== reviewedHeadSha
    || receipt.refreshedHeadSha !== observedHeadSha
  ) return false;
  if (receipt.schema === "agentic-protected-main-refresh/v1") {
    return SHA_PATTERN.test(String(receipt.mainParentSha || ""));
  }
  if (
    receipt.schema !== "agentic-protected-main-refresh-chain/v1"
    || !Number.isInteger(receipt.refreshCount)
    || receipt.refreshCount < 2
    || !Array.isArray(receipt.refreshes)
    || receipt.refreshes.length !== receipt.refreshCount
  ) return false;
  let previous = reviewedHeadSha;
  for (const refresh of receipt.refreshes) {
    if (
      !refresh
      || refresh.previousHeadSha !== previous
      || !SHA_PATTERN.test(String(refresh.refreshedHeadSha || ""))
      || !SHA_PATTERN.test(String(refresh.mainParentSha || ""))
      || !SHA_PATTERN.test(String(refresh.treeSha || ""))
    ) return false;
    previous = refresh.refreshedHeadSha;
  }
  return previous === observedHeadSha;
}
function hasReadyRemoteAuthority({
  cloudAuthority,
  remoteAuthorityVerification,
  canonicalBaseSha,
  manifest,
}) {
  if (
    !cloudAuthority
    || !remoteAuthorityVerification
    || !operationDerivedCloudVerifications.has(remoteAuthorityVerification)
    || remoteAuthorityVerification.schema !== "agentic-lane-cloud-verification/v1"
    || remoteAuthorityVerification.status !== "ready"
    || remoteAuthorityVerification.inventory?.schema !== "agentic-cloud-claim-inventory/v1"
    || remoteAuthorityVerification.remoteClaimInventoryDigest
      !== remoteAuthorityVerification.inventory.inventoryDigest
    || remoteAuthorityVerification.ledgerRevision
      !== remoteAuthorityVerification.inventory.observedLedgerHeadRevision
    || remoteAuthorityVerification.ledgerDigest
      !== remoteAuthorityVerification.inventory.ledgerDigest
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
  const deliveryPeerHead = operationDerivedDeliveryPeerHeads.get(lane);
  if (deliveryPeerHead) {
    operationDerivedDeliveryPeerHeads.set(normalized, deliveryPeerHead);
  }
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
