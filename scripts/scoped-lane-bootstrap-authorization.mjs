import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  buildRootSourceBootstrapOperatorDecision,
  hasCurrentRootSourceMaintenanceAuthority,
  inspectRootSourceMaintenance,
  isEligibleRootSourceMaintenance,
  isRetiredAdmissionOwnerLane,
  normalizeRootSourceBootstrapOperatorDecision,
  normalizeRootSourceMaintenanceProof,
  ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES,
  ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA,
  selectRootSourceBootstrapPreservedLanes,
} from "./scoped-lane-bootstrap-maintenance.mjs";

// Keep the owner-led recovery contract visible at this authorization boundary:
// AUTHORIZE ROOT-SOURCE BOOTSTRAP EXCEPTION
// ["planned", "admitted"].includes(admission?.status)
// Mutation-closed operations: "cleanup", "deployment", "manual-ledger-edit",
// "manual-registry-edit", and "merge"; enforcement stays in the maintenance owner.
export {
  buildRootSourceBootstrapOperatorDecision,
  hasCurrentRootSourceMaintenanceAuthority,
  inspectRootSourceMaintenance,
  normalizeRootSourceBootstrapOperatorDecision,
  ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES,
  ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA,
  selectRootSourceBootstrapPreservedLanes,
  writeRootSourceBootstrapMaintenanceManifest,
} from "./scoped-lane-bootstrap-maintenance.mjs";

export const ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA =
  "agentic-root-source-bootstrap-preservation-authorization/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ALLOWED_MUTATIONS = Object.freeze([
  "candidate-registration",
  "candidate-ref",
  "candidate-local-lease",
  "candidate-fence-projection",
]);

export function createRootSourceBootstrapAuthorization({
  lanes,
  canonicalPath,
  canonicalBaseSha,
  targetPath,
  branch,
  semanticScope,
  manifest,
  cloudAuthority,
  remoteAuthorityVerification,
  maintenanceSourcePath,
  maintenanceManifestPath,
  maintenanceManifestDigest,
  preservedLanes = null,
  inspectMaintenanceSource = inspectRootSourceMaintenance,
  evaluatedAt = new Date(),
} = {}) {
  requireObject(manifest, "Root-source bootstrap candidate manifest");
  requireObject(cloudAuthority, "Root-source bootstrap cloud authority");
  requireObject(remoteAuthorityVerification, "Root-source bootstrap remote authority verification");
  const currentRemoteClaims = remoteAuthorityVerification.inventory?.claims;
  if (!Array.isArray(currentRemoteClaims)) {
    throw new Error("Root-source bootstrap authorization requires a verified remote claim inventory.");
  }
  const candidateClaim = currentRemoteClaims.find(
    claim => claim.claimId === cloudAuthority.claimId,
  );
  if (!candidateClaim) {
    throw new Error("Root-source bootstrap authorization requires the exact candidate claim in inventory.");
  }
  const discoveredPreservedLanes = selectRootSourceBootstrapPreservedLanes({
    lanes,
    canonicalPath,
    targetPath,
    maintenanceSourcePath,
    branch,
    currentRemoteClaims,
  });
  if (preservedLanes !== null && preservedLanes !== undefined
    && !Array.isArray(preservedLanes)) {
    throw new Error("Root-source bootstrap preservedLanes must be an array.");
  }
  const requestedPreservedLanes = Array.isArray(preservedLanes)
    ? preservedLanes.map((lane) => Object.freeze({
      path: path.resolve(requiredText(lane.path, "preserved lane path")),
      stateDigest: requiredDigest(lane.stateDigest, "preserved lane stateDigest"),
    }))
    : [];
  const mergedPreservedLanes = [
    ...new Map(
      [...discoveredPreservedLanes, ...requestedPreservedLanes].map((lane) => [
        lane.path,
        lane,
      ]),
    ).values(),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const authorization = {
    schema: ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA,
    operatorDecision: buildRootSourceBootstrapOperatorDecision({
      actorId: candidateClaim.actorId,
      candidateClaimId: cloudAuthority.claimId,
    }),
    actorId: candidateClaim.actorId,
    candidateClaimId: cloudAuthority.claimId,
    canonicalBaseSha: requiredSha(canonicalBaseSha, "canonicalBaseSha"),
    semanticScope: requiredText(semanticScope, "semanticScope"),
    branch: requiredText(branch, "branch"),
    targetPath: path.resolve(requiredText(targetPath, "targetPath")),
    manifestDigest: requiredDigest(manifest.manifestDigest, "manifest.manifestDigest"),
    writeSetDigest: requiredDigest(manifest.writeSetDigest, "manifest.writeSetDigest"),
    ledgerRevision: requiredSha(
      remoteAuthorityVerification.ledgerRevision,
      "remoteAuthorityVerification.ledgerRevision",
    ),
    ledgerDigest: requiredDigest(
      remoteAuthorityVerification.ledgerDigest,
      "remoteAuthorityVerification.ledgerDigest",
    ),
    maintenanceSourcePath: path.resolve(requiredText(
      maintenanceSourcePath,
      "maintenanceSourcePath",
    )),
    maintenanceManifestDigest: requiredDigest(
      maintenanceManifestDigest,
      "maintenanceManifestDigest",
    ),
    maintenanceManifestPath: path.resolve(requiredText(
      maintenanceManifestPath,
      "maintenanceManifestPath",
    )),
    expiresAt: requiredInstant(
      cloudAuthority.expiresAt,
      "cloudAuthority.expiresAt",
    ),
    preservedLanes: mergedPreservedLanes,
  };
  return normalizeRootSourceBootstrapAuthorization({
    source: authorization,
    lanes,
    canonicalPath,
    canonicalBaseSha,
    targetPath,
    branch,
    semanticScope,
    manifest,
    cloudAuthority,
    remoteAuthorityVerification,
    currentRemoteClaims,
    evaluatedAt,
    inspectMaintenanceSource,
  });
}

export function normalizeRootSourceBootstrapAuthorization({
  source,
  lanes,
  canonicalPath,
  canonicalBaseSha,
  targetPath,
  branch,
  semanticScope,
  manifest,
  cloudAuthority,
  remoteAuthorityVerification,
  currentRemoteClaims,
  evaluatedAt,
  inspectMaintenanceSource = inspectRootSourceMaintenance,
}) {
  if (source === null || source === undefined) return null;
  requireObject(source, "Root-source bootstrap authorization");
  if (source.schema !== ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA) {
    throw new Error(
      `Root-source bootstrap authorization schema must be ${ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA}.`,
    );
  }
  if (
    !cloudAuthority
    || remoteAuthorityVerification?.status !== "ready"
    || !Array.isArray(currentRemoteClaims)
  ) {
    throw new Error(
      "Root-source bootstrap authorization requires current operation-derived cloud authority.",
    );
  }
  const candidateClaims = currentRemoteClaims.filter(
    claim => claim.claimId === cloudAuthority.claimId,
  );
  if (candidateClaims.length !== 1) {
    throw new Error("Root-source bootstrap authorization requires one exact candidate claim.");
  }
  const candidateClaim = candidateClaims[0];
  const operatorDecision = normalizeRootSourceBootstrapOperatorDecision({
    source: source.operatorDecision,
    actorId: candidateClaim.actorId,
    candidateClaimId: cloudAuthority.claimId,
  });
  const authorizationExpiresAt = requiredInstant(
    source.expiresAt,
    "root-source bootstrap expiresAt",
  );
  if (
    Date.parse(authorizationExpiresAt) <= evaluatedAt.getTime()
    || Date.parse(authorizationExpiresAt) > Date.parse(cloudAuthority.expiresAt)
  ) {
    throw new Error(
      "Root-source bootstrap authorization must be current and bounded by the candidate claim.",
    );
  }
  const bindings = {
    operatorDecisionDigest: operatorDecision.decisionDigest,
    actorId: requiredText(source.actorId, "root-source bootstrap actorId"),
    candidateClaimId: requiredDigest(
      source.candidateClaimId,
      "root-source bootstrap candidateClaimId",
    ),
    canonicalBaseSha: requiredSha(
      source.canonicalBaseSha,
      "root-source bootstrap canonicalBaseSha",
    ),
    semanticScope: requiredText(
      source.semanticScope,
      "root-source bootstrap semanticScope",
    ),
    branch: requiredText(source.branch, "root-source bootstrap branch"),
    targetPath: path.resolve(requiredText(
      source.targetPath,
      "root-source bootstrap targetPath",
    )),
    manifestDigest: requiredDigest(
      source.manifestDigest,
      "root-source bootstrap manifestDigest",
    ),
    writeSetDigest: requiredDigest(
      source.writeSetDigest,
      "root-source bootstrap writeSetDigest",
    ),
    ledgerRevision: requiredSha(
      source.ledgerRevision,
      "root-source bootstrap ledgerRevision",
    ),
    ledgerDigest: requiredDigest(
      source.ledgerDigest,
      "root-source bootstrap ledgerDigest",
    ),
    maintenanceSourcePath: path.resolve(requiredText(
      source.maintenanceSourcePath,
      "root-source bootstrap maintenanceSourcePath",
    )),
    maintenanceManifestDigest: requiredDigest(
      source.maintenanceManifestDigest,
      "root-source bootstrap maintenanceManifestDigest",
    ),
    maintenanceManifestPath: path.resolve(requiredText(
      source.maintenanceManifestPath,
      "root-source bootstrap maintenanceManifestPath",
    )),
    expiresAt: authorizationExpiresAt,
  };
  if (
    bindings.actorId !== candidateClaim.actorId
    || bindings.candidateClaimId !== cloudAuthority.claimId
    || bindings.canonicalBaseSha !== canonicalBaseSha
    || bindings.canonicalBaseSha !== cloudAuthority.canonicalBaseSha
    || bindings.semanticScope !== semanticScope
    || bindings.branch !== branch
    || bindings.targetPath !== path.resolve(targetPath)
    || bindings.manifestDigest !== manifest.manifestDigest
    || bindings.writeSetDigest !== manifest.writeSetDigest
  ) {
    throw new Error("Root-source bootstrap authorization drifted from its candidate bindings.");
  }
  if (!Array.isArray(source.preservedLanes)) {
    throw new Error("Root-source bootstrap authorization requires preservedLanes.");
  }
  if (source.preservedLanes.length > ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES) {
    throw new Error("Root-source bootstrap authorization exceeds its bounded lane count.");
  }
  const observedByPath = new Map(lanes.map(lane => [lane.path, lane]));
  const preservedLanes = source.preservedLanes.map((item) => {
    requireObject(item, "Root-source bootstrap preserved lane");
    const lanePath = path.resolve(requiredText(item.path, "preserved lane path"));
    const expectedStateDigest = requiredDigest(
      item.stateDigest,
      "preserved lane stateDigest",
    );
    const lane = observedByPath.get(lanePath);
    if (
      !lane
      || lanePath === path.resolve(canonicalPath)
      || lanePath === path.resolve(targetPath)
      || lane.invalid
      || lane.leaseAmbiguous
      || lane.detached
      || !lane.branch
      || lane.branch === `refs/heads/${branch}`
      || lane.stateDigest !== expectedStateDigest
    ) {
      throw new Error(
        `Root-source bootstrap preserved lane is missing, unsafe, candidate-owned, or drifted: ${lanePath}`,
      );
    }
    const liveClaimId = lane.lease?.cloudAuthority?.claimId || null;
    if (
      liveClaimId
      && currentRemoteClaims.some(claim => claim.claimId === liveClaimId)
    ) {
      throw new Error(
        `Root-source bootstrap cannot replace current cloud ownership for ${lanePath}.`,
      );
    }
    if (
      lane.lease
      && lane.dirty
      && liveClaimId
      && currentRemoteClaims.some(claim => claim.claimId === liveClaimId)
      && !isRetiredAdmissionOwnerLane({
        lane,
        lanePath,
        branch: lane.branch,
        targetRepository: cloudAuthority.targetRepository,
      })
    ) {
      throw new Error(
        `Root-source bootstrap cannot suppress dirty bytes in a previously admitted lane: ${lanePath}.`,
      );
    }
    return Object.freeze({
      path: lanePath,
      branch: lane.branch,
      head: lane.head,
      dirty: lane.dirty,
      stateDigest: lane.stateDigest,
    });
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(preservedLanes.map(lane => lane.path)).size !== preservedLanes.length) {
    throw new Error("Root-source bootstrap preserved lanes must be unique.");
  }
  const maintenanceProof = normalizeRootSourceMaintenanceProof(inspectMaintenanceSource({
    lanePath: bindings.maintenanceSourcePath,
    manifestPath: bindings.maintenanceManifestPath,
    expectedManifestDigest: bindings.maintenanceManifestDigest,
  }), {
    expectedManifestDigest: bindings.maintenanceManifestDigest,
  });
  const canonicalMaintenance = maintenanceProof.path === path.resolve(canonicalPath);
  const canonicalDirtyMaintenance = canonicalMaintenance
    && maintenanceProof.branch === "refs/heads/main"
    && maintenanceProof.dirty
    && !maintenanceProof.retiredPreserved
    && maintenanceProof.leaseCount === 0;
  const separateMaintenance = !canonicalMaintenance
    && maintenanceProof.path !== path.resolve(targetPath)
    && !preservedLanes.some(lane => lane.path === maintenanceProof.path);
  if (
    maintenanceProof.path !== bindings.maintenanceSourcePath
    || (!separateMaintenance && !canonicalDirtyMaintenance)
    || !maintenanceProof.registered
    || maintenanceProof.detached
    || maintenanceProof.invalid
    || !isEligibleRootSourceMaintenance(maintenanceProof)
    || hasCurrentRootSourceMaintenanceAuthority(maintenanceProof, currentRemoteClaims)
  ) {
    throw new Error(
      "Root-source bootstrap requires one separate registered, dirty, unleased maintenance source lane or the dirty, unleased canonical main source.",
    );
  }
  const maintenanceBranchScope = maintenanceProof.branch.split("/").at(-1);
  if (maintenanceProof.semanticScope !== maintenanceBranchScope) {
    throw new Error(
      "Root-source bootstrap maintenance manifest must own the exact maintenance branch scope.",
    );
  }
  const allowedPaths = new Set(maintenanceProof.declaredWriteSet
    .filter(item => item.startsWith("path:"))
    .map(item => item.slice("path:".length)));
  const unownedPaths = maintenanceProof.changedPaths.filter(
    changedPath => !allowedPaths.has(changedPath),
  );
  if ((maintenanceProof.dirty && maintenanceProof.changedPaths.length === 0)
    || (!maintenanceProof.dirty && maintenanceProof.changedPaths.length !== 0)
    || unownedPaths.length > 0) {
    throw new Error(
      `Root-source bootstrap maintenance bytes are not exactly allowlisted: ${unownedPaths.join(", ") || "maintenance state mismatch"}`,
    );
  }
  if (preservedLanes.length === 0 && !canonicalDirtyMaintenance) {
    throw new Error(
      "Root-source bootstrap requires at least one preserved lane unless maintenance is canonical-dirty-main.",
    );
  }
  const core = {
    schema: ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA,
    operatorDecision,
    ...bindings,
    maintenanceSemanticScope: maintenanceProof.semanticScope,
    maintenanceRepositoryRoot: maintenanceProof.repositoryRoot,
    maintenanceHead: maintenanceProof.head,
    maintenanceBranch: maintenanceProof.branch,
    maintenanceMode: canonicalDirtyMaintenance
      ? "canonical-dirty-main"
      : "separate-root-lane",
    maintenanceContentDigest: maintenanceProof.contentDigest,
    maintenanceStateDigest: maintenanceProof.stateDigest,
    maintenanceChangedPaths: maintenanceProof.changedPaths,
    preservedLanes,
    allowedMutations: ALLOWED_MUTATIONS,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function assertRootSourceBootstrapCurrent({
  report,
  remoteAuthorityVerification,
  inspectMaintenanceSource = inspectRootSourceMaintenance,
}) {
  const authorization = report?.rootSourceBootstrapAuthorization;
  if (!authorization) return null;
  const candidate = remoteAuthorityVerification?.inventory?.claims?.find(
    claim => claim.claimId === authorization.candidateClaimId,
  );
  const operatorDecision = normalizeRootSourceBootstrapOperatorDecision({
    source: authorization.operatorDecision,
    actorId: candidate?.actorId,
    candidateClaimId: authorization.candidateClaimId,
  });
  const { authorizationDigest, ...authorizationCore } = authorization;
  const evaluationTime = Date.parse(remoteAuthorityVerification?.verifiedAt);
  if (
    authorization.schema !== ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA
    || authorizationDigest !== digestValue(authorizationCore)
    || operatorDecision.decisionDigest !== authorization.operatorDecisionDigest
    || !candidate
    || candidate.actorId !== authorization.actorId
    || report.cloudAuthority?.claimId !== authorization.candidateClaimId
    || report.candidate?.semanticScope !== authorization.semanticScope
    || report.candidate?.branch !== authorization.branch
    || report.candidate?.targetPath !== authorization.targetPath
    || report.candidate?.manifestDigest !== authorization.manifestDigest
    || report.candidate?.writeSetDigest !== authorization.writeSetDigest
    || report.canonicalBaseSha !== authorization.canonicalBaseSha
    || !Number.isFinite(evaluationTime)
    || evaluationTime >= Date.parse(authorization.expiresAt)
  ) {
    throw new Error("Root-source bootstrap authorization expired or drifted before preservation proof.");
  }
  const maintenanceProof = normalizeRootSourceMaintenanceProof(inspectMaintenanceSource({
    lanePath: authorization.maintenanceSourcePath,
    manifestPath: authorization.maintenanceManifestPath,
    expectedManifestDigest: authorization.maintenanceManifestDigest,
  }), {
    expectedManifestDigest: authorization.maintenanceManifestDigest,
  });
  const liveCanonicalDirtyMaintenance = path.resolve(authorization.maintenanceSourcePath)
    === path.resolve(report.repository)
    && maintenanceProof.branch === "refs/heads/main"
    && maintenanceProof.dirty
    && !maintenanceProof.retiredPreserved
    && maintenanceProof.leaseCount === 0;
  if (
    !Array.isArray(authorization.preservedLanes)
    || (authorization.preservedLanes.length === 0 && !liveCanonicalDirtyMaintenance)
    || (authorization.maintenanceMode === "canonical-dirty-main"
      && !liveCanonicalDirtyMaintenance)
    || (authorization.maintenanceMode === "separate-root-lane" &&
      path.resolve(authorization.maintenanceSourcePath) === path.resolve(report.repository))
    || !["canonical-dirty-main", "separate-root-lane"].includes(authorization.maintenanceMode)
    || hasCurrentRootSourceMaintenanceAuthority(
      maintenanceProof,
      remoteAuthorityVerification.inventory.claims,
    )
    || maintenanceProof.semanticScope !== authorization.maintenanceSemanticScope
    || maintenanceProof.repositoryRoot !== authorization.maintenanceRepositoryRoot
    || maintenanceProof.head !== authorization.maintenanceHead
    || maintenanceProof.branch !== authorization.maintenanceBranch
    || maintenanceProof.contentDigest !== authorization.maintenanceContentDigest
    || maintenanceProof.stateDigest !== authorization.maintenanceStateDigest
    || JSON.stringify(maintenanceProof.changedPaths)
      !== JSON.stringify(authorization.maintenanceChangedPaths)
  ) {
    throw new Error(
      "Root-source bootstrap maintenance manifest or changed paths drifted before preservation proof.",
    );
  }
  return authorization.authorizationDigest;
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

function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase 40-character SHA.`);
  }
  return normalized;
}

function requiredInstant(value, label) {
  const milliseconds = Date.parse(requiredText(value, label));
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO-8601 instant.`);
  return new Date(milliseconds).toISOString();
}
