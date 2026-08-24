import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  bindOperationDerivedDeliveryPeerLaneStates,
  isOperationDerivedCloudVerification,
  normalizeDeclaredWriteScopeManifest,
} from "./scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import {
  assertAdmissionMutationAuthority,
  collectScopedLaneState,
} from "./scoped-lane-admission-state.mjs";
import {
  classifyExistingLane,
  isOperationDerivedDormantPreservation,
  verifyDormantPreservation,
} from "./scoped-lane-authority-state.mjs";
import {
  isOperationDerivedDeliveryPeerVerification,
  verifyDeliveryAuthorizedPeerAuthorities,
} from "./scoped-lane-delivery-peer-authority.mjs";

export const ADMISSION_CONTINUATION_RECEIPT_SCHEMA =
  "agentic-lane-admission-continuation-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function observeProtectedDescendant({
  baseRevision,
  protectedRevision,
  manifest,
  gitText,
} = {}) {
  if (!SHA_PATTERN.test(String(baseRevision || ""))
    || !SHA_PATTERN.test(String(protectedRevision || ""))
    || typeof gitText !== "function") {
    throw new Error("Protected-descendant verification requires exact revisions and gitText().");
  }
  if (protectedRevision === baseRevision) return Object.freeze([]);
  try {
    gitText(["merge-base", "--is-ancestor", baseRevision, protectedRevision]);
  } catch {
    throw new Error("Admission continuation requires a monotonic protected-source descendant.");
  }
  const changedPaths = String(gitText([
    "diff", "--name-only", "-z", "--no-renames", baseRevision, protectedRevision,
  ])).split("\0").filter(Boolean);
  const normalized = normalizeWriteSet(changedPaths);
  if (writeSetsOverlap(normalized, manifest?.declaredWriteSet || [])) {
    throw new Error("Protected-source advance overlaps the planned write authority.");
  }
  return Object.freeze(changedPaths);
}

export function assertPlannedContinuationIdentity({
  plan,
  controller,
  candidateLease: lease,
  candidateLineage: lineage,
  manifest,
  files,
} = {}) {
  const source = plan?.sourceEvidence;
  const candidate = source?.candidate;
  if (!source || !/^[0-9a-f]{64}$/u.test(String(plan?.planDigest || ""))
    || plan.sourceEvidenceDigest !== source.sourceEvidenceDigest
    || JSON.stringify(controller) !== JSON.stringify(source.controller)
    || path.resolve(lease?.worktreePath || "") !== candidate?.targetPath
    || lease?.branch !== candidate?.branch
    || lease?.sessionId !== candidate?.sessionId
    || lease?.scope !== candidate?.semanticScope
    || lease?.baseSha !== source.canonical?.headSha
    || lease?.fenceSha !== lineage?.headSha
    || lineage?.parentSha !== source.canonical?.headSha
    || lineage?.parentCount !== 1
    || lineage?.treeSha !== source.canonical?.treeSha
    || lease?.admission?.status !== "planned"
    || lease.admission.manifestDigest !== candidate?.manifest?.manifestDigest
    || lease.admission.writeSetDigest !== candidate?.manifest?.writeSetDigest
    || lease.cloudAuthority?.claimId !== candidate?.candidateClaim?.claimId
    || JSON.stringify(manifest) !== JSON.stringify(candidate?.manifest)
    || files?.selectionFileDigest !== candidate?.selectionFileDigest
    || files?.manifestFileDigest !== candidate?.manifestFileDigest
    || files?.cloudAuthorityFileDigest !== candidate?.cloudAuthorityFileDigest) {
    throw new Error("Protected-descendant continuation changed its immutable planned identity.");
  }
  return true;
}

export function continuePlannedAdmissionFromRepository({
  repository,
  branch,
  sessionId,
  leaseStore,
  manifestSource,
  dormantWorktreePaths,
  dormantPullRequests,
  operatorDecisionDigest,
  gitText,
  verifyCloudAuthority = verifyAdmissionCloudAuthority,
  collectLaneState = collectScopedLaneState,
  verifyDormant = verifyDormantPreservation,
} = {}) {
  const lease = leaseStore.verify({ sessionId, branch });
  const manifest = normalizeDeclaredWriteScopeManifest(manifestSource, {
    expectedScope: lease.scope,
  });
  gitText(["fetch", "origin", "main"]);
  const initialSnapshot = collectLaneState({ repository });
  const initialVerified = verifyCloudAuthority({
    authority: lease.cloudAuthority,
    manifest,
    canonicalBaseSha: lease.baseSha,
  });
  const dormantPreservationReceipt = verifyDormant({
    repository,
    targetRepository: lease.cloudAuthority.targetRepository,
    lanes: initialSnapshot.lanes,
    worktreePaths: dormantWorktreePaths,
    pullRequestReferences: dormantPullRequests,
    operatorDecisionDigest,
    sessionId,
    remoteAuthorityVerification: initialVerified.verification,
    verifiedAt: initialVerified.verification.verifiedAt,
  });
  gitText(["fetch", "origin", "main"]);
  const finalSnapshot = collectLaneState({ repository });
  requireStableLocalSnapshot(initialSnapshot, finalSnapshot);
  const changedPaths = observeProtectedDescendant({
    baseRevision: lease.baseSha,
    protectedRevision: finalSnapshot.canonicalBaseSha,
    manifest,
    gitText,
  });
  const finalVerified = verifyCloudAuthority({
    authority: lease.cloudAuthority,
    manifest,
    canonicalBaseSha: lease.baseSha,
  });
  const continued = continuePlannedScopedLaneAdmission({
    lease,
    cloudAuthority: finalVerified.authority,
    remoteAuthorityVerification: finalVerified.verification,
    manifest,
    lanes: finalSnapshot.lanes,
    protectedRevision: finalSnapshot.canonicalBaseSha,
    protectedDeltaPaths: changedPaths,
    dormantPreservationReceipt,
    operatorDecisionDigest,
  });
  const updated = leaseStore.annotate({
    sessionId,
    branch,
    expectedLease: lease,
    values: {
      admission: continued.admission,
      cloudAuthority: continued.cloudAuthority,
      admissionContinuation: continued.continuationReceipt,
    },
  });
  return Object.freeze({ lease: updated, ...continued });
}

/**
 * Recover one repository-owned start that reached a bound cloud claim, branch,
 * lease, and draft PR before final admission evidence could be recorded.
 * The recovery replans from current authenticated state; it never edits a peer.
 */
export function continuePlannedScopedLaneAdmission({
  lease,
  cloudAuthority,
  remoteAuthorityVerification,
  manifest,
  lanes,
  protectedRevision,
  protectedDeltaPaths = [],
  dormantPreservationReceipt,
  operatorDecisionDigest,
  continuedAt = remoteAuthorityVerification?.verifiedAt,
  verifyDeliveryPeers = verifyDeliveryAuthorizedPeerAuthorities,
} = {}) {
  requirePlannedLease({ lease, cloudAuthority, manifest });
  requireCurrentVerification(remoteAuthorityVerification);
  const candidate = requireCandidateLane({ lease, lanes });
  const protectedAdvance = verifyProtectedAdvance({
    lease,
    manifest,
    protectedRevision,
    protectedDeltaPaths,
  });
  const peers = verifyLocalPeers({
    lease,
    manifest,
    lanes,
    protectedRevision,
    dormantPreservationReceipt,
    operatorDecisionDigest,
    remoteAuthorityVerification,
    verifyDeliveryPeers,
  });
  const remotePeers = verifyRemotePeers({
    lease,
    manifest,
    remoteAuthorityVerification,
  });
  const provisionalLease = { ...lease, cloudAuthority };
  const plannedAuthorityReceipt = assertAdmissionMutationAuthority({
    lease: provisionalLease,
    cloudAuthority,
    remoteAuthorityVerification,
    allowPlanned: true,
    evaluatedAt: continuedAt,
  });
  const preservationCore = {
    schema: "agentic-lane-continuation-preservation/v1",
    candidatePath: candidate.path,
    candidateStateDigest: candidate.stateDigest,
    candidateRevision: candidate.head,
    candidateTreeSha: candidate.treeSha,
    preparedIntegrationReceiptDigest: candidate.preparedIntegrationReceiptDigest,
    peerLaneStateDigest: peers.peerLaneStateDigest,
    deliveryPeerAuthorityReceiptDigest:
      peers.deliveryPeerAuthorityReceiptDigest,
    dormantPreservationReceiptDigest: dormantPreservationReceipt.receiptDigest,
    remotePeerSetDigest: remotePeers.peerSetDigest,
    protectedAdvanceReceiptDigest: protectedAdvance.receiptDigest,
  };
  const preservationReceiptDigest = digestValue(preservationCore);
  const admittedProjection = {
    ...lease.admission,
    status: "admitted",
    existingLaneStateDigest: peers.peerLaneStateDigest,
    admittedReportDigest: preservationReceiptDigest,
    preservationReceiptDigest,
  };
  const admittedLease = {
    ...provisionalLease,
    admission: admittedProjection,
  };
  const mutationAuthorityReceipt = assertAdmissionMutationAuthority({
    lease: admittedLease,
    cloudAuthority,
    remoteAuthorityVerification,
    evaluatedAt: continuedAt,
  });
  const receiptCore = {
    schema: ADMISSION_CONTINUATION_RECEIPT_SCHEMA,
    status: "admitted",
    claimId: cloudAuthority.claimId,
    predecessorPlanReceiptDigest: lease.admission.planReceiptDigest,
    predecessorAdmissionReceiptDigest: lease.admission.admissionReceiptDigest,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    localFenceSha: lease.fenceSha,
    candidateStateDigest: candidate.stateDigest,
    candidateRevision: candidate.head,
    candidateTreeSha: candidate.treeSha,
    preparedIntegrationReceiptDigest: candidate.preparedIntegrationReceiptDigest,
    peerLaneStateDigest: peers.peerLaneStateDigest,
    deliveryPeerAuthorityReceiptDigest:
      peers.deliveryPeerAuthorityReceiptDigest,
    peerOperationReceiptDigests: remotePeers.operationReceiptDigests,
    dormantPreservationReceiptDigest: dormantPreservationReceipt.receiptDigest,
    protectedAdvanceReceiptDigest: protectedAdvance.receiptDigest,
    cloudVerificationReceiptDigest: remoteAuthorityVerification.receiptDigest,
    plannedMutationAuthorityReceiptDigest: plannedAuthorityReceipt.receiptDigest,
    mutationAuthorityReceiptDigest: mutationAuthorityReceipt.receiptDigest,
    continuedAt: new Date(continuedAt).toISOString(),
  };
  const continuationReceipt = Object.freeze({
    ...receiptCore,
    receiptDigest: digestValue(receiptCore),
  });
  return Object.freeze({
    admission: Object.freeze({
      ...admittedProjection,
      continuationReceiptDigest: continuationReceipt.receiptDigest,
    }),
    cloudAuthority,
    continuationReceipt,
    mutationAuthorityReceipt,
    protectedAdvance,
    deliveryPeerAuthorityReceiptDigest:
      peers.deliveryPeerAuthorityReceiptDigest,
    peerOperationReceipts: remotePeers.receipts,
  });
}

function requirePlannedLease({ lease, cloudAuthority, manifest }) {
  if (
    lease?.schema !== "agentic-writer-lease/v2"
    || lease.status !== "active"
    || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "planned"
    || lease.admission.manifestDigest !== manifest?.manifestDigest
    || lease.admission.writeSetDigest !== manifest?.writeSetDigest
    || JSON.stringify(lease.admission.declaredWriteSet)
      !== JSON.stringify(manifest?.declaredWriteSet)
    || lease.cloudAuthority?.claimId !== cloudAuthority?.claimId
  ) throw new Error("Admission continuation requires the exact active planned lease and manifest.");
}

function requireCurrentVerification(verification) {
  if (
    !isOperationDerivedCloudVerification(verification)
    || verification?.status !== "ready"
    || verification.remoteClaimInventoryDigest !== verification.inventory?.inventoryDigest
  ) throw new Error("Admission continuation requires operation-derived current cloud verification.");
}

function requireCandidateLane({ lease, lanes }) {
  const matches = (Array.isArray(lanes) ? lanes : []).filter(
    lane => path.resolve(lane.path) === path.resolve(lease.worktreePath),
  );
  if (matches.length !== 1) throw new Error("Admission continuation requires one registered candidate lane.");
  const candidate = matches[0];
  const preparedIntegration = requirePreparedIntegrationCandidate({
    lease,
    candidate,
  });
  if (
    candidate.branch !== `refs/heads/${lease.branch}`
    || candidate.dirty
    || candidate.invalid
    || candidate.leaseAmbiguous
    || candidate.lease?.sessionId !== lease.sessionId
    || candidate.lease?.epoch !== lease.epoch
  ) throw new Error("Admission continuation candidate drifted from its clean registered fence.");
  return Object.freeze({
    ...candidate,
    preparedIntegrationReceiptDigest: preparedIntegration
      ? digestValue(preparedIntegration)
      : null,
  });
}

function requirePreparedIntegrationCandidate({ lease, candidate }) {
  if (candidate.head === lease.fenceSha && !lease.integration) return null;
  const integration = lease.integration;
  const exactPaths = preparedIntegrationPathsMatchAuthorizedScope({
    integrationPaths: integration?.paths,
    declaredWriteSet: lease.admission?.declaredWriteSet,
  });
  if (
    integration?.schema !== "agentic-integration-commit/v1"
    || !SHA_PATTERN.test(String(integration.commitSha || ""))
    || !SHA_PATTERN.test(String(integration.treeSha || ""))
    || integration.commitSha !== candidate.head
    || integration.treeSha !== candidate.treeSha
    || !exactPaths
    || !/^[0-9a-f]{64}$/u.test(String(integration.stagedDiffDigest || ""))
    || !/^[0-9a-f]{64}$/u.test(String(integration.manifestDigest || ""))
    || typeof integration.commitMessage !== "string"
    || !integration.commitMessage.trim()
  ) {
    throw new Error(
      "Admission continuation candidate drifted from its clean registered fence or exact prepared integration commit.",
    );
  }
  return integration;
}

function preparedIntegrationPathsMatchAuthorizedScope({
  integrationPaths,
  declaredWriteSet,
}) {
  if (!Array.isArray(integrationPaths) || integrationPaths.length === 0) return false;
  const declaredPaths = normalizeWriteSet(declaredWriteSet)
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length));
  if (declaredPaths.length === 0) return false;
  return integrationPaths.every(item => {
    const normalized = String(item || "").trim();
    if (!normalized) return false;
    return declaredPaths.some(declared => (
      declared === "."
      || normalized === declared
      || normalized.startsWith(`${declared}/`)
    ));
  });
}

function verifyProtectedAdvance({ lease, manifest, protectedRevision, protectedDeltaPaths }) {
  if (!SHA_PATTERN.test(String(protectedRevision || ""))) {
    throw new Error("Admission continuation requires the exact protected revision.");
  }
  const normalizedDelta = protectedDeltaPaths.length > 0
    ? normalizeWriteSet(protectedDeltaPaths)
    : [];
  if (normalizedDelta.length > 0 && writeSetsOverlap(normalizedDelta, manifest.declaredWriteSet)) {
    throw new Error("Protected-source advance overlaps the planned write authority.");
  }
  const core = {
    schema: "agentic-disjoint-protected-advance-receipt/v1",
    fromRevision: lease.baseSha,
    toRevision: protectedRevision,
    changedWriteScope: normalizedDelta,
    candidateWriteSetDigest: manifest.writeSetDigest,
    disposition: protectedRevision === lease.baseSha ? "unchanged" : "disjoint-preserved",
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function verifyLocalPeers({
  lease,
  manifest,
  lanes,
  protectedRevision,
  dormantPreservationReceipt,
  operatorDecisionDigest,
  remoteAuthorityVerification,
  verifyDeliveryPeers,
}) {
  if (
    !isOperationDerivedDormantPreservation(dormantPreservationReceipt)
    || dormantPreservationReceipt.operatorDecisionDigest !== operatorDecisionDigest
  ) throw new Error("Admission continuation requires the current operator-bound dormant preservation receipt.");
  if (
    dormantPreservationReceipt.cloudInventory?.ledgerRevision
      !== remoteAuthorityVerification.ledgerRevision
    || dormantPreservationReceipt.cloudInventory?.ledgerDigest
      !== remoteAuthorityVerification.ledgerDigest
    || dormantPreservationReceipt.cloudInventory?.inventoryDigest
      !== digestValue(remoteAuthorityVerification.inventory.claims)
  ) {
    throw new Error("Dormant preservation does not join the current cloud inventory.");
  }
  const candidatePath = path.resolve(lease.worktreePath);
  const peerLanes = lanes.filter(lane => path.resolve(lane.path) !== candidatePath);
  const preservedPaths = new Set(
    dormantPreservationReceipt.worktrees.map(item => path.resolve(item.path)),
  );
  const canonical = peerLanes.filter(lane => lane.branch === "refs/heads/main");
  if (canonical.length !== 1 || canonical[0].dirty
    || canonical[0].head !== protectedRevision) {
    throw new Error("Admission continuation requires the clean verified protected canonical lane.");
  }
  const evaluationTime = new Date(remoteAuthorityVerification.verifiedAt);
  const classifiedPeers = peerLanes.map(lane => (
    lane.branch === "refs/heads/main"
      ? {
        ...lane,
        classification: "canonical",
        authorityState: "canonical",
        dormantPreservationReceiptDigest: null,
        overlapReasons: [],
      }
      : classifyExistingLane({
        lane,
        branch: lease.branch,
        semanticScope: lease.scope,
        declaredWriteSet: manifest.declaredWriteSet,
        evaluatedAt: evaluationTime,
        currentRemoteClaims: remoteAuthorityVerification.inventory.claims,
        dormantPreservationReceipt,
      })
  ));
  const deliveryVerification = verifyDeliveryPeers({
    lanes: peerLanes,
    remoteAuthorityVerification,
    evaluatedAt: remoteAuthorityVerification.verifiedAt,
  });
  if (!isOperationDerivedDeliveryPeerVerification(deliveryVerification)) {
    throw new Error(
      "Admission continuation requires operation-derived delivery peer authority.",
    );
  }
  const deliveryBoundPeers = bindOperationDerivedDeliveryPeerLaneStates(
    classifiedPeers,
    deliveryVerification,
  );
  const classifiedByPath = new Map(classifiedPeers.map(
    lane => [path.resolve(lane.path), lane],
  ));
  const authorityBoundPeers = deliveryBoundPeers.map(lane => {
    const classified = classifiedByPath.get(path.resolve(lane.path));
    return classified?.classification === "disjoint-attributed"
      ? lane
      : classified;
  });
  const authorityByPath = new Map(authorityBoundPeers.map(
    lane => [path.resolve(lane.path), lane],
  ));
  const noncanonicalPeers = peerLanes.filter(lane => lane.branch !== "refs/heads/main");
  for (const rawLane of noncanonicalPeers) {
    const lane = authorityByPath.get(path.resolve(rawLane.path));
    const reasons = lane?.overlapReasons?.length > 0
      ? lane.overlapReasons.join(",")
      : "none";
    if (lane?.classification !== "disjoint-attributed") {
      const disposition = lane?.classification === "ambiguous"
        ? "has unattributed peer lanes"
        : "peer authority rejected";
      throw new Error(
        `Admission continuation ${disposition}: ${rawLane.path}; `
        + `classification=${lane?.classification || "missing"}; reasons=${reasons}.`,
      );
    }
    const selected = preservedPaths.has(path.resolve(rawLane.path));
    if (selected && (
      lane.authorityState !== "dormant-preserved"
      || lane.dormantPreservationReceiptDigest
        !== dormantPreservationReceipt.receiptDigest
    )) {
      throw new Error(
        `Admission continuation selected dormant peer drifted: ${rawLane.path}.`,
      );
    }
    if (!selected && lane.dormantPreservationReceiptDigest !== null) {
      throw new Error(
        `Admission continuation broadened dormant peer selection: ${rawLane.path}.`,
      );
    }
    if (lane.authorityState === "review-ready-projected") {
      throw new Error(
        `Admission continuation delivery peer lacks operation-derived authority: ${rawLane.path}.`,
      );
    }
  }
  const observedSelectedPaths = new Set(noncanonicalPeers
    .filter(lane => preservedPaths.has(path.resolve(lane.path)))
    .map(lane => path.resolve(lane.path)));
  if (
    observedSelectedPaths.size !== preservedPaths.size
    || [...preservedPaths].some(lanePath => !observedSelectedPaths.has(lanePath))
  ) {
    throw new Error("Admission continuation dormant peer selection drifted.");
  }
  const state = peerLanes
    .map(lane => {
      const authority = authorityByPath.get(path.resolve(lane.path));
      return {
        path: path.resolve(lane.path),
        stateDigest: lane.stateDigest,
        authorityState: authority.authorityState,
        dormantPreservationReceiptDigest:
          authority.dormantPreservationReceiptDigest,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    peerLaneStateDigest: digestValue(state),
    deliveryPeerAuthorityReceiptDigest:
      deliveryVerification.operationReceiptDigest,
  };
}

function requireStableLocalSnapshot(initial, final) {
  if (
    initial?.registryDigest !== final?.registryDigest
    || initial?.laneStateDigest !== final?.laneStateDigest
    || initial?.canonicalBaseSha !== final?.canonicalBaseSha
  ) {
    throw new Error("Registered lane or protected-source state changed during admission continuation.");
  }
}

function verifyRemotePeers({ lease, manifest, remoteAuthorityVerification }) {
  const receipts = [];
  for (const claim of remoteAuthorityVerification.inventory.claims) {
    if (claim.claimId === lease.cloudAuthority.claimId) continue;
    if (writeSetsOverlap(claim.declaredWriteScope, manifest.declaredWriteSet)) {
      throw new Error(`Admission continuation overlaps current claim ${claim.claimId}.`);
    }
    const core = {
      schema: "agentic-independent-peer-operation-receipt/v1",
      claimId: claim.claimId,
      state: claim.state,
      writeSetDigest: claim.writeSetDigest,
      leaseEpoch: claim.leaseEpoch,
      transitionCounter: claim.transitionCounter,
      fenceRevision: claim.fenceRevision,
      transitionDigest: claim.transitionDigest,
      recordDigest: claim.recordDigest,
      classification: "disjoint-attributed",
    };
    receipts.push(Object.freeze({ ...core, receiptDigest: digestValue(core) }));
  }
  receipts.sort((left, right) => left.claimId.localeCompare(right.claimId));
  return Object.freeze({
    receipts: Object.freeze(receipts),
    operationReceiptDigests: Object.freeze(receipts.map(item => item.receiptDigest)),
    peerSetDigest: digestValue(receipts.map(item => ({
      claimId: item.claimId,
      recordDigest: item.recordDigest,
    }))),
  });
}
