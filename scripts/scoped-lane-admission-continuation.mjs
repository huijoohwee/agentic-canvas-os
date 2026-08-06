import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  isOperationDerivedCloudVerification,
  normalizeDeclaredWriteScopeManifest,
} from "./scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import {
  assertAdmissionMutationAuthority,
  collectScopedLaneState,
} from "./scoped-lane-admission-state.mjs";
import {
  isOperationDerivedDormantPreservation,
  verifyDormantPreservation,
} from "./scoped-lane-authority-state.mjs";

export const ADMISSION_CONTINUATION_RECEIPT_SCHEMA =
  "agentic-lane-admission-continuation-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

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
  try {
    gitText(["merge-base", "--is-ancestor", lease.baseSha, finalSnapshot.canonicalBaseSha]);
  } catch {
    throw new Error("Admission continuation requires a monotonic protected-source descendant.");
  }
  const changedPaths = finalSnapshot.canonicalBaseSha === lease.baseSha
    ? []
    : String(gitText([
      "diff", "--name-only", "-z", "--no-renames", lease.baseSha,
      finalSnapshot.canonicalBaseSha,
    ])).split("\0").filter(Boolean);
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
    lanes,
    dormantPreservationReceipt,
    operatorDecisionDigest,
    remoteAuthorityVerification,
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
    peerLaneStateDigest: peers.peerLaneStateDigest,
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
    peerLaneStateDigest: peers.peerLaneStateDigest,
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
  if (
    candidate.branch !== `refs/heads/${lease.branch}`
    || candidate.head !== lease.fenceSha
    || candidate.dirty
    || candidate.invalid
    || candidate.leaseAmbiguous
    || candidate.lease?.sessionId !== lease.sessionId
    || candidate.lease?.epoch !== lease.epoch
  ) throw new Error("Admission continuation candidate drifted from its clean registered fence.");
  return candidate;
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
  lanes,
  dormantPreservationReceipt,
  operatorDecisionDigest,
  remoteAuthorityVerification,
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
  if (canonical.length !== 1 || canonical[0].dirty || canonical[0].head !== lease.baseSha) {
    throw new Error("Admission continuation requires the clean original canonical lane.");
  }
  const uncovered = peerLanes.filter(lane => (
    lane.branch !== "refs/heads/main" && !preservedPaths.has(path.resolve(lane.path))
  ));
  if (uncovered.length > 0) {
    throw new Error(`Admission continuation has unattributed peer lanes: ${uncovered.map(item => item.path).join(", ")}`);
  }
  const state = peerLanes
    .map(lane => ({ path: path.resolve(lane.path), stateDigest: lane.stateDigest }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { peerLaneStateDigest: digestValue(state) };
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
