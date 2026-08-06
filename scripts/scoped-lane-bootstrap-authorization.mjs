import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

export const ROOT_SOURCE_BOOTSTRAP_AUTHORIZATION_SCHEMA =
  "agentic-root-source-bootstrap-preservation-authorization/v1";
export const ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA =
  "agentic-root-source-bootstrap-operator-decision/v1";
export const ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES = 16;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ALLOWED_MUTATIONS = Object.freeze([
  "candidate-registration",
  "candidate-ref",
  "candidate-local-lease",
  "candidate-fence-projection",
]);
const OPERATOR_AUTHORIZATION_TOKEN = "AUTHORIZE ROOT-SOURCE BOOTSTRAP EXCEPTION";
const OPERATOR_ALLOWED_MAINTENANCE_CHANGES = Object.freeze([
  "focused-tests",
  "reclaim-admission-owners",
]);
const OPERATOR_FORBIDDEN_OPERATIONS = Object.freeze([
  "cleanup",
  "deployment",
  "manual-ledger-edit",
  "manual-registry-edit",
  "merge",
]);
const OPERATOR_DECISION_KEYS = Object.freeze([
  "schema",
  "operation",
  "authorizationToken",
  "explicit",
  "approved",
  "actorId",
  "candidateClaimId",
  "maintenanceWorktreeCount",
  "maintenanceIsolation",
  "allowedMaintenanceChanges",
  "preservationPolicy",
  "requiredSuccessor",
  "forbiddenOperations",
  "decisionDigest",
]);
const ROOT_SOURCE_BOOTSTRAP_MAINTENANCE_MANIFEST_SCHEMA =
  "agentic-write-scope-manifest/v1";

export function normalizeRootSourceBootstrapOperatorDecision({
  source,
  actorId,
  candidateClaimId,
}) {
  requireObject(source, "Root-source bootstrap operator decision");
  requireExactKeys(
    source,
    OPERATOR_DECISION_KEYS,
    "Root-source bootstrap operator decision",
  );
  const core = {
    schema: requiredExactText(
      source.schema,
      ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA,
      "root-source bootstrap operator decision schema",
    ),
    operation: requiredExactText(
      source.operation,
      "root-source-bootstrap-exception",
      "root-source bootstrap operator decision operation",
    ),
    authorizationToken: requiredExactText(
      source.authorizationToken,
      OPERATOR_AUTHORIZATION_TOKEN,
      "root-source bootstrap operator authorization token",
    ),
    explicit: requiredTrue(source.explicit, "root-source bootstrap explicit decision"),
    approved: requiredTrue(source.approved, "root-source bootstrap approved decision"),
    actorId: requiredExactText(
      source.actorId,
      requiredText(actorId, "root-source bootstrap candidate actorId"),
      "root-source bootstrap operator actorId",
    ),
    candidateClaimId: requiredExactText(
      requiredDigest(
        source.candidateClaimId,
        "root-source bootstrap operator candidateClaimId",
      ),
      requiredDigest(
        candidateClaimId,
        "root-source bootstrap candidate claimId",
      ),
      "root-source bootstrap operator candidateClaimId",
    ),
    maintenanceWorktreeCount: requiredExactInteger(
      source.maintenanceWorktreeCount,
      1,
      "root-source bootstrap maintenanceWorktreeCount",
    ),
    maintenanceIsolation: requiredExactText(
      source.maintenanceIsolation,
      "required",
      "root-source bootstrap maintenanceIsolation",
    ),
    allowedMaintenanceChanges: requiredExactTextArray(
      source.allowedMaintenanceChanges,
      OPERATOR_ALLOWED_MAINTENANCE_CHANGES,
      "root-source bootstrap allowedMaintenanceChanges",
    ),
    preservationPolicy: requiredExactText(
      source.preservationPolicy,
      "all-existing-lanes-and-bytes",
      "root-source bootstrap preservationPolicy",
    ),
    requiredSuccessor: requiredExactText(
      source.requiredSuccessor,
      "normal-cloud-authoritative-admitted-lane",
      "root-source bootstrap requiredSuccessor",
    ),
    forbiddenOperations: requiredExactTextArray(
      source.forbiddenOperations,
      OPERATOR_FORBIDDEN_OPERATIONS,
      "root-source bootstrap forbiddenOperations",
    ),
  };
  const decisionDigest = requiredDigest(
    source.decisionDigest,
    "root-source bootstrap operator decisionDigest",
  );
  if (digestValue(core) !== decisionDigest) {
    throw new Error("Root-source bootstrap operator decision digest is invalid.");
  }
  return Object.freeze({ ...core, decisionDigest });
}

export function buildRootSourceBootstrapOperatorDecision({
  actorId,
  candidateClaimId,
} = {}) {
  const core = {
    schema: ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA,
    operation: "root-source-bootstrap-exception",
    authorizationToken: OPERATOR_AUTHORIZATION_TOKEN,
    explicit: true,
    approved: true,
    actorId: requiredText(actorId, "root-source bootstrap candidate actorId"),
    candidateClaimId: requiredDigest(
      candidateClaimId,
      "root-source bootstrap candidate claimId",
    ),
    maintenanceWorktreeCount: 1,
    maintenanceIsolation: "required",
    allowedMaintenanceChanges: [...OPERATOR_ALLOWED_MAINTENANCE_CHANGES],
    preservationPolicy: "all-existing-lanes-and-bytes",
    requiredSuccessor: "normal-cloud-authoritative-admitted-lane",
    forbiddenOperations: [...OPERATOR_FORBIDDEN_OPERATIONS],
  };
  return Object.freeze({ ...core, decisionDigest: digestValue(core) });
}

export function selectRootSourceBootstrapPreservedLanes({
  lanes,
  canonicalPath,
  targetPath,
  maintenanceSourcePath,
  branch,
  currentRemoteClaims = [],
  maxCount = ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES,
} = {}) {
  if (!Array.isArray(lanes)) throw new Error("Root-source bootstrap lane discovery requires lanes.");
  const normalizedCanonicalPath = path.resolve(requiredText(canonicalPath, "canonicalPath"));
  const normalizedTargetPath = path.resolve(requiredText(targetPath, "targetPath"));
  const normalizedMaintenancePath = path.resolve(requiredText(
    maintenanceSourcePath,
    "maintenanceSourcePath",
  ));
  const candidateBranch = `refs/heads/${requiredText(branch, "branch")}`;
  const currentClaimIds = new Set(
    currentRemoteClaims
      .map(claim => String(claim?.claimId || "").trim())
      .filter(Boolean),
  );
  const discovered = lanes
    .map((lane) => normalizeBootstrapPreservedLaneCandidate(lane))
    .filter((lane) => (
      lane.path !== normalizedCanonicalPath
      && lane.path !== normalizedTargetPath
      && lane.path !== normalizedMaintenancePath
      && lane.branch !== candidateBranch
      && lane.branch
      && !lane.detached
      && !lane.invalid
      && !lane.leaseAmbiguous
      && lane.dirty
      && !currentClaimIds.has(String(lane.lease?.cloudAuthority?.claimId || ""))
    ))
    .map(lane => Object.freeze({
      path: lane.path,
      stateDigest: lane.stateDigest,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (discovered.length === 0) {
    throw new Error("Root-source bootstrap preservation requires at least one eligible preserved lane.");
  }
  if (discovered.length > maxCount) {
    throw new Error(
      `Root-source bootstrap preservation exceeds the bounded lane count (${discovered.length}/${maxCount}).`,
    );
  }
  return Object.freeze(discovered);
}

export function writeRootSourceBootstrapMaintenanceManifest({
  lanePath,
  outputPath,
} = {}) {
  const normalizedLanePath = path.resolve(requiredText(lanePath, "maintenance lane path"));
  const normalizedOutputPath = path.resolve(requiredText(outputPath, "maintenance manifest output path"));
  const branch = execFileSync("git", [
    "-C",
    normalizedLanePath,
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ], { encoding: "utf8" }).trim();
  const semanticScope = branch.split("/").at(-1);
  if (!semanticScope) {
    throw new Error("Root-source bootstrap maintenance source must be on a semantic task branch.");
  }
  const changedPaths = [...new Set([
    ...readGitPaths(normalizedLanePath, ["diff", "--name-only", "-z", "--cached"]),
    ...readGitPaths(normalizedLanePath, ["diff", "--name-only", "-z"]),
    ...readGitPaths(normalizedLanePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort();
  if (changedPaths.length === 0) {
    throw new Error("Root-source bootstrap maintenance source must contain changed paths.");
  }
  const declaredWriteSet = normalizeWriteSet([
    `semantic:${semanticScope}`,
    ...changedPaths.map(changedPath => `path:${changedPath}`),
  ]);
  const manifest = {
    schema: ROOT_SOURCE_BOOTSTRAP_MAINTENANCE_MANIFEST_SCHEMA,
    semanticScope,
    declaredWriteSet,
  };
  mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(normalizedOutputPath, bytes);
  return Object.freeze({
    path: normalizedOutputPath,
    manifest,
    manifestDigest: sha256(Buffer.from(bytes, "utf8")),
    changedPaths,
  });
}

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
  if (!Array.isArray(source.preservedLanes) || source.preservedLanes.length === 0) {
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
  const maintenanceProof = normalizeMaintenanceSourceProof(inspectMaintenanceSource({
    lanePath: bindings.maintenanceSourcePath,
    manifestPath: bindings.maintenanceManifestPath,
    expectedManifestDigest: bindings.maintenanceManifestDigest,
  }), {
    expectedManifestDigest: bindings.maintenanceManifestDigest,
  });
  if (
    maintenanceProof.path !== bindings.maintenanceSourcePath
    || maintenanceProof.path === path.resolve(canonicalPath)
    || maintenanceProof.path === path.resolve(targetPath)
    || preservedLanes.some(lane => lane.path === maintenanceProof.path)
    || !maintenanceProof.registered
    || maintenanceProof.detached
    || maintenanceProof.invalid
    || !maintenanceProof.dirty
    || maintenanceProof.leaseCount !== 0
  ) {
    throw new Error(
      "Root-source bootstrap requires one separate registered, dirty, unleased maintenance source lane.",
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
  if (maintenanceProof.changedPaths.length === 0 || unownedPaths.length > 0) {
    throw new Error(
      `Root-source bootstrap maintenance bytes are not exactly allowlisted: ${unownedPaths.join(", ") || "no changed paths"}`,
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
    maintenanceContentDigest: maintenanceProof.contentDigest,
    maintenanceStateDigest: maintenanceProof.stateDigest,
    maintenanceChangedPaths: maintenanceProof.changedPaths,
    preservedLanes,
    allowedMutations: ALLOWED_MUTATIONS,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

function isRetiredAdmissionOwnerLane({
  lane,
  lanePath,
  branch,
  targetRepository,
}) {
  const lease = lane.lease;
  const admission = lease?.admission;
  const authority = lease?.cloudAuthority;
  return Boolean(
    ["active", "review_ready"].includes(lease?.status)
    && path.resolve(lease?.worktreePath || "") === lanePath
    && lease?.branch === String(branch || "").replace(/^refs\/heads\//u, "")
    && admission?.schema === "agentic-lane-admission-lease/v1"
    && ["planned", "admitted"].includes(admission?.status)
    && authority?.schema === "agentic-lane-cloud-authority/v1"
    && authority?.targetRepository === targetRepository
    && DIGEST_PATTERN.test(String(authority?.claimId || ""))
    && admission?.writeSetDigest === authority?.writeSetDigest
  );
}

function normalizeBootstrapPreservedLaneCandidate(lane) {
  requireObject(lane, "Root-source bootstrap preserved lane candidate");
  return Object.freeze({
    path: path.resolve(requiredText(lane.path, "preserved lane path")),
    branch: lane.branch ? requiredText(lane.branch, "preserved lane branch") : null,
    detached: Boolean(lane.detached),
    dirty: Boolean(lane.dirty),
    invalid: Boolean(lane.invalid || lane.bare || lane.locked || lane.prunable),
    leaseAmbiguous: Boolean(lane.leaseAmbiguous),
    lease: lane.lease || null,
    stateDigest: requiredDigest(lane.stateDigest, "preserved lane stateDigest"),
  });
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
  const maintenanceProof = normalizeMaintenanceSourceProof(inspectMaintenanceSource({
    lanePath: authorization.maintenanceSourcePath,
    manifestPath: authorization.maintenanceManifestPath,
    expectedManifestDigest: authorization.maintenanceManifestDigest,
  }), {
    expectedManifestDigest: authorization.maintenanceManifestDigest,
  });
  if (
    maintenanceProof.semanticScope !== authorization.maintenanceSemanticScope
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

export function inspectRootSourceMaintenance({
  lanePath,
  manifestPath,
  expectedManifestDigest,
} = {}) {
  const normalizedLanePath = path.resolve(requiredText(
    lanePath,
    "root-source bootstrap maintenance lane path",
  ));
  const normalizedManifestPath = path.resolve(requiredText(
    manifestPath,
    "root-source bootstrap maintenance manifest path",
  ));
  const manifestBytes = readFileSync(normalizedManifestPath);
  const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
  if (manifestDigest !== requiredDigest(
    expectedManifestDigest,
    "root-source bootstrap expected maintenance manifest digest",
  )) {
    throw new Error("Root-source bootstrap maintenance manifest bytes drifted.");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Root-source bootstrap maintenance manifest must be valid JSON.");
  }
  requireObject(manifest, "Root-source bootstrap maintenance manifest");
  if (manifest.schema !== "agentic-write-scope-manifest/v1") {
    throw new Error(
      "Root-source bootstrap maintenance manifest must use agentic-write-scope-manifest/v1.",
    );
  }
  const semanticScope = requiredText(
    manifest.semanticScope,
    "root-source bootstrap maintenance semanticScope",
  );
  if (!Array.isArray(manifest.declaredWriteSet)) {
    throw new Error("Root-source bootstrap maintenance declaredWriteSet is required.");
  }
  const declaredWriteSet = normalizeWriteSet(manifest.declaredWriteSet);
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)) {
    throw new Error(
      "Root-source bootstrap maintenance manifest must declare its semantic scope.",
    );
  }
  const changedPaths = [...new Set([
    ...readGitPaths(normalizedLanePath, ["diff", "--name-only", "-z", "--cached"]),
    ...readGitPaths(normalizedLanePath, ["diff", "--name-only", "-z"]),
    ...readGitPaths(normalizedLanePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort();
  const untrackedPaths = readGitPaths(
    normalizedLanePath,
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ).sort();
  const contentDigest = digestValue({
    schema: "agentic-root-source-bootstrap-maintenance-content/v1",
    stagedDiffDigest: sha256(execFileSync("git", [
      "-C", normalizedLanePath, "diff", "--binary", "--no-ext-diff", "--cached", "--",
    ])),
    unstagedDiffDigest: sha256(execFileSync("git", [
      "-C", normalizedLanePath, "diff", "--binary", "--no-ext-diff", "--",
    ])),
    untrackedFiles: untrackedPaths.map((relativePath) => ({
      path: relativePath,
      digest: digestUntrackedFile(normalizedLanePath, relativePath),
    })),
  });
  const worktreeRecords = parseWorktreeRecords(execFileSync("git", [
    "-C",
    normalizedLanePath,
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }));
  const matchingRecords = worktreeRecords.filter(
    record => path.resolve(record.path) === normalizedLanePath,
  );
  if (matchingRecords.length !== 1) {
    throw new Error("Root-source bootstrap maintenance source must be one registered worktree.");
  }
  const record = matchingRecords[0];
  const repositoryRoot = path.resolve(execFileSync("git", [
    "-C",
    normalizedLanePath,
    "rev-parse",
    "--show-toplevel",
  ], { encoding: "utf8" }).trim());
  if (repositoryRoot !== normalizedLanePath) {
    throw new Error("Root-source bootstrap maintenance path must be its worktree root.");
  }
  const head = requiredSha(record.head, "root-source bootstrap maintenance HEAD");
  const branch = requiredText(record.branch, "root-source bootstrap maintenance branch");
  const commonDirectory = path.resolve(normalizedLanePath, execFileSync("git", [
    "-C",
    normalizedLanePath,
    "rev-parse",
    "--git-common-dir",
  ], { encoding: "utf8" }).trim());
  const leaseRegistry = createWriterLeaseStore({ gitCommonDir: commonDirectory }).readRegistry();
  const leaseCount = Object.values(leaseRegistry.leases).filter(lease => (
    path.resolve(lease?.worktreePath || "") === normalizedLanePath
    || lease?.branch === branch.replace(/^refs\/heads\//u, "")
  )).length;
  const core = {
    path: normalizedLanePath,
    repositoryRoot,
    head,
    branch,
    registered: true,
    detached: Boolean(record.detached),
    invalid: Boolean(record.bare || record.locked || record.prunable),
    dirty: changedPaths.length > 0,
    leaseCount,
    manifestDigest,
    semanticScope,
    declaredWriteSet,
    changedPaths,
    contentDigest,
  };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}

function normalizeMaintenanceSourceProof(source, { expectedManifestDigest }) {
  requireObject(source, "Root-source bootstrap maintenance proof");
  const pathValue = path.resolve(requiredText(
    source.path,
    "root-source bootstrap maintenance proof path",
  ));
  const repositoryRoot = path.resolve(requiredText(
    source.repositoryRoot,
    "root-source bootstrap maintenance proof repositoryRoot",
  ));
  const head = requiredSha(source.head, "root-source bootstrap maintenance proof head");
  const branch = requiredText(
    source.branch,
    "root-source bootstrap maintenance proof branch",
  );
  const manifestDigest = requiredDigest(
    source.manifestDigest,
    "root-source bootstrap maintenance proof manifestDigest",
  );
  if (manifestDigest !== expectedManifestDigest) {
    throw new Error("Root-source bootstrap maintenance proof used a different manifest.");
  }
  const semanticScope = requiredText(
    source.semanticScope,
    "root-source bootstrap maintenance proof semanticScope",
  );
  if (!Array.isArray(source.declaredWriteSet)) {
    throw new Error("Root-source bootstrap maintenance proof declaredWriteSet is required.");
  }
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)) {
    throw new Error("Root-source bootstrap maintenance proof lost its semantic scope.");
  }
  if (!Array.isArray(source.changedPaths)) {
    throw new Error("Root-source bootstrap maintenance proof changedPaths is required.");
  }
  const changedPaths = [...new Set(source.changedPaths.map((changedPath) => {
    const normalized = requiredText(changedPath, "maintenance changed path").replaceAll("\\", "/");
    if (
      normalized.startsWith("/")
      || normalized === ".."
      || normalized.startsWith("../")
      || normalized.includes("/../")
    ) {
      throw new Error("Root-source bootstrap maintenance changed paths must be repository-relative.");
    }
    return normalized;
  }))].sort();
  const contentDigest = requiredDigest(
    source.contentDigest,
    "root-source bootstrap maintenance proof contentDigest",
  );
  const core = {
    path: pathValue,
    repositoryRoot,
    head,
    branch,
    registered: source.registered === true,
    detached: source.detached === true,
    invalid: source.invalid === true,
    dirty: source.dirty === true,
    leaseCount: nonnegativeInteger(
      source.leaseCount,
      "root-source bootstrap maintenance proof leaseCount",
    ),
    manifestDigest,
    semanticScope,
    declaredWriteSet,
    changedPaths,
    contentDigest,
  };
  const stateDigest = requiredDigest(
    source.stateDigest,
    "root-source bootstrap maintenance proof stateDigest",
  );
  if (digestValue(core) !== stateDigest) {
    throw new Error("Root-source bootstrap maintenance source-state digest is invalid.");
  }
  return Object.freeze({ ...core, stateDigest });
}

function readGitPaths(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }).split("\0").filter(Boolean);
}

function digestUntrackedFile(repository, relativePath) {
  const absolutePath = path.resolve(repository, relativePath);
  const relative = path.relative(repository, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Root-source bootstrap untracked file escaped the maintenance worktree.");
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    return sha256(Buffer.from(`symlink\0${readlinkSync(absolutePath)}`, "utf8"));
  }
  if (!stat.isFile()) {
    throw new Error("Root-source bootstrap untracked changes must be files or symbolic links.");
  }
  return sha256(readFileSync(absolutePath));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function requireExactKeys(value, expectedKeys, label) {
  const observed = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are not exact.`);
  }
}

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredExactText(value, expected, label) {
  const normalized = requiredText(value, label);
  if (normalized !== expected) throw new Error(`${label} must be ${expected}.`);
  return normalized;
}

function requiredTrue(value, label) {
  if (value !== true) throw new Error(`${label} must be true.`);
  return true;
}

function requiredExactInteger(value, expected, label) {
  if (!Number.isInteger(value) || value !== expected) {
    throw new Error(`${label} must be ${expected}.`);
  }
  return value;
}

function requiredExactTextArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(`${label} must match the authorized values exactly.`);
  }
  return Object.freeze([...value]);
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

function nonnegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return normalized;
}
