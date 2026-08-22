// Responsibility: Bind bootstrap maintenance and preserved-owner evidence.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  isRetiredPreservedLane,
  normalizeLocalReviewRetirementReceipt,
} from "./legacy-review-ready-retirement-lib.mjs";
import { normalizeLocalReleaseReceipt } from "./planned-recovery-pr-marker-reconciliation-contract.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { normalizeRetiredPlannedAdmissionOwnerReceipt } from "./retired-planned-admission-owner-lib.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

export const ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA =
  "agentic-root-source-bootstrap-operator-decision/v1";
export const ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES = 16;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
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
const MAINTENANCE_MANIFEST_SCHEMA = "agentic-write-scope-manifest/v1";

export function normalizeRootSourceBootstrapOperatorDecision({
  source,
  actorId,
  candidateClaimId,
}) {
  requireObject(source, "Root-source bootstrap operator decision");
  requireExactKeys(source, OPERATOR_DECISION_KEYS, "Root-source bootstrap operator decision");
  const core = {
    schema: requiredExactText(source.schema, ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA,
      "root-source bootstrap operator decision schema"),
    operation: requiredExactText(source.operation, "root-source-bootstrap-exception",
      "root-source bootstrap operator decision operation"),
    authorizationToken: requiredExactText(source.authorizationToken, OPERATOR_AUTHORIZATION_TOKEN,
      "root-source bootstrap operator authorization token"),
    explicit: requiredTrue(source.explicit, "root-source bootstrap explicit decision"),
    approved: requiredTrue(source.approved, "root-source bootstrap approved decision"),
    actorId: requiredExactText(source.actorId,
      requiredText(actorId, "root-source bootstrap candidate actorId"),
      "root-source bootstrap operator actorId"),
    candidateClaimId: requiredExactText(
      requiredDigest(source.candidateClaimId, "root-source bootstrap operator candidateClaimId"),
      requiredDigest(candidateClaimId, "root-source bootstrap candidate claimId"),
      "root-source bootstrap operator candidateClaimId"),
    maintenanceWorktreeCount: requiredExactInteger(source.maintenanceWorktreeCount, 1,
      "root-source bootstrap maintenanceWorktreeCount"),
    maintenanceIsolation: requiredExactText(source.maintenanceIsolation, "required",
      "root-source bootstrap maintenanceIsolation"),
    allowedMaintenanceChanges: requiredExactTextArray(source.allowedMaintenanceChanges,
      OPERATOR_ALLOWED_MAINTENANCE_CHANGES, "root-source bootstrap allowedMaintenanceChanges"),
    preservationPolicy: requiredExactText(source.preservationPolicy, "all-existing-lanes-and-bytes",
      "root-source bootstrap preservationPolicy"),
    requiredSuccessor: requiredExactText(source.requiredSuccessor,
      "normal-cloud-authoritative-admitted-lane", "root-source bootstrap requiredSuccessor"),
    forbiddenOperations: requiredExactTextArray(source.forbiddenOperations,
      OPERATOR_FORBIDDEN_OPERATIONS, "root-source bootstrap forbiddenOperations"),
  };
  const decisionDigest = requiredDigest(source.decisionDigest,
    "root-source bootstrap operator decisionDigest");
  if (digestValue(core) !== decisionDigest) {
    throw new Error("Root-source bootstrap operator decision digest is invalid.");
  }
  return Object.freeze({ ...core, decisionDigest });
}

export function buildRootSourceBootstrapOperatorDecision({ actorId, candidateClaimId } = {}) {
  const core = {
    schema: ROOT_SOURCE_BOOTSTRAP_OPERATOR_DECISION_SCHEMA,
    operation: "root-source-bootstrap-exception",
    authorizationToken: OPERATOR_AUTHORIZATION_TOKEN,
    explicit: true,
    approved: true,
    actorId: requiredText(actorId, "root-source bootstrap candidate actorId"),
    candidateClaimId: requiredDigest(candidateClaimId, "root-source bootstrap candidate claimId"),
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
  const canonical = path.resolve(requiredText(canonicalPath, "canonicalPath"));
  const target = path.resolve(requiredText(targetPath, "targetPath"));
  const maintenance = path.resolve(requiredText(maintenanceSourcePath, "maintenanceSourcePath"));
  const candidateBranch = `refs/heads/${requiredText(branch, "branch")}`;
  const currentClaimIds = new Set(currentRemoteClaims
    .map(claim => String(claim?.claimId || "").trim()).filter(Boolean));
  const discovered = lanes.map(normalizeBootstrapPreservedLaneCandidate).filter(lane => (
    lane.path !== canonical
    && lane.path !== target
    && lane.path !== maintenance
    && lane.branch !== candidateBranch
    && lane.branch
    && !lane.detached
    && !lane.invalid
    && !lane.leaseAmbiguous
    && lane.dirty
    && !currentClaimIds.has(String(lane.lease?.cloudAuthority?.claimId || ""))
  )).map(lane => Object.freeze({ path: lane.path, stateDigest: lane.stateDigest }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (discovered.length > maxCount) {
    throw new Error(`Root-source bootstrap preservation exceeds the bounded lane count (${discovered.length}/${maxCount}).`);
  }
  return Object.freeze(discovered);
}

export function writeRootSourceBootstrapMaintenanceManifest({ lanePath, outputPath } = {}) {
  const lane = path.resolve(requiredText(lanePath, "maintenance lane path"));
  const output = path.resolve(requiredText(outputPath, "maintenance manifest output path"));
  const branch = execFileSync("git", ["-C", lane, "symbolic-ref", "--quiet", "--short", "HEAD"],
    { encoding: "utf8" }).trim();
  const semanticScope = branch.split("/").at(-1);
  if (!semanticScope) {
    throw new Error("Root-source bootstrap maintenance source must be on a semantic task branch.");
  }
  const changedPaths = changedGitPaths(lane);
  const declaredWriteSet = normalizeWriteSet([
    `semantic:${semanticScope}`,
    ...changedPaths.map(changedPath => `path:${changedPath}`),
  ]);
  const manifest = { schema: MAINTENANCE_MANIFEST_SCHEMA, semanticScope, declaredWriteSet };
  mkdirSync(path.dirname(output), { recursive: true });
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(output, bytes);
  return Object.freeze({
    path: output,
    manifest,
    manifestDigest: sha256(Buffer.from(bytes, "utf8")),
    changedPaths,
  });
}

export function inspectRootSourceMaintenance({ lanePath, manifestPath, expectedManifestDigest } = {}) {
  const lane = path.resolve(requiredText(lanePath, "root-source bootstrap maintenance lane path"));
  const manifestFile = path.resolve(requiredText(
    manifestPath, "root-source bootstrap maintenance manifest path"));
  const manifestBytes = readFileSync(manifestFile);
  const manifestDigest = sha256(manifestBytes);
  if (manifestDigest !== requiredDigest(expectedManifestDigest,
    "root-source bootstrap expected maintenance manifest digest")) {
    throw new Error("Root-source bootstrap maintenance manifest bytes drifted.");
  }
  const manifest = parseManifest(manifestBytes);
  const semanticScope = requiredText(manifest.semanticScope,
    "root-source bootstrap maintenance semanticScope");
  const declaredWriteSet = normalizeWriteSet(manifest.declaredWriteSet);
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)) {
    throw new Error("Root-source bootstrap maintenance manifest must declare its semantic scope.");
  }
  const changedPaths = changedGitPaths(lane);
  const records = parseWorktreeRecords(execFileSync("git",
    ["-C", lane, "worktree", "list", "--porcelain", "-z"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }))
    .filter(record => path.resolve(record.path) === lane);
  if (records.length !== 1) {
    throw new Error("Root-source bootstrap maintenance source must be one registered worktree.");
  }
  const record = records[0];
  const repositoryRoot = path.resolve(execFileSync("git",
    ["-C", lane, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  if (repositoryRoot !== lane) {
    throw new Error("Root-source bootstrap maintenance path must be its worktree root.");
  }
  const head = requiredSha(record.head, "root-source bootstrap maintenance HEAD");
  const branch = requiredText(record.branch, "root-source bootstrap maintenance branch");
  const commonDirectory = resolveGitCommonDirectory(lane);
  const leaseRegistry = createWriterLeaseStore({ gitCommonDir: commonDirectory }).readRegistry();
  const matchingLeases = Object.values(leaseRegistry.leases).filter(lease => (
    path.resolve(lease?.worktreePath || "") === lane
    || lease?.branch === branch.replace(/^refs\/heads\//u, "")
  ));
  const retiredPreserved = matchingLeases.length === 1 && isRetiredPreservedLane({
    lane: { path: lane, branch, head, dirty: changedPaths.length > 0 },
    lease: matchingLeases[0],
  });
  const contentDigest = maintenanceContentDigest({
    lane,
    retirementReceiptDigest: retiredPreserved
      ? normalizeBootstrapRetirementReceiptDigest(matchingLeases[0])
      : null,
  });
  const core = {
    path: lane,
    repositoryRoot,
    head,
    branch,
    registered: true,
    detached: Boolean(record.detached),
    invalid: Boolean(record.bare || record.locked || record.prunable),
    dirty: changedPaths.length > 0,
    retiredPreserved,
    leaseCount: matchingLeases.length,
    manifestDigest,
    semanticScope,
    declaredWriteSet,
    changedPaths,
    contentDigest,
  };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}

export function normalizeBootstrapRetirementReceiptDigest(lease) {
  const receiptOwners = [
    lease?.localReviewRetirement
      ? () => normalizeLocalReviewRetirementReceipt(lease.localReviewRetirement)
      : null,
    lease?.admissionOwnerRetirement
      ? () => normalizeRetiredPlannedAdmissionOwnerReceipt(lease.admissionOwnerRetirement)
      : null,
    lease?.plannedRecoveryMarkerReconciliation
      ? () => normalizeLocalReleaseReceipt(lease.plannedRecoveryMarkerReconciliation)
      : null,
  ].filter(Boolean);
  if (receiptOwners.length !== 1) {
    throw new Error("Root-source bootstrap maintenance requires one exact retirement receipt owner.");
  }
  return receiptOwners[0]().receiptDigest;
}

export function normalizeRootSourceMaintenanceProof(source, { expectedManifestDigest }) {
  requireObject(source, "Root-source bootstrap maintenance proof");
  const manifestDigest = requiredDigest(source.manifestDigest,
    "root-source bootstrap maintenance proof manifestDigest");
  if (manifestDigest !== expectedManifestDigest) {
    throw new Error("Root-source bootstrap maintenance proof used a different manifest.");
  }
  const semanticScope = requiredText(source.semanticScope,
    "root-source bootstrap maintenance proof semanticScope");
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  if (!declaredWriteSet.includes(`semantic:${semanticScope}`)) {
    throw new Error("Root-source bootstrap maintenance proof lost its semantic scope.");
  }
  const changedPaths = normalizeRelativePaths(source.changedPaths);
  const retiredPreservedPresent = Object.hasOwn(source, "retiredPreserved");
  const core = {
    path: path.resolve(requiredText(source.path, "root-source bootstrap maintenance proof path")),
    repositoryRoot: path.resolve(requiredText(source.repositoryRoot,
      "root-source bootstrap maintenance proof repositoryRoot")),
    head: requiredSha(source.head, "root-source bootstrap maintenance proof head"),
    branch: requiredText(source.branch, "root-source bootstrap maintenance proof branch"),
    registered: source.registered === true,
    detached: source.detached === true,
    invalid: source.invalid === true,
    dirty: source.dirty === true,
    retiredPreserved: source.retiredPreserved === true,
    leaseCount: nonnegativeInteger(source.leaseCount,
      "root-source bootstrap maintenance proof leaseCount"),
    manifestDigest,
    semanticScope,
    declaredWriteSet,
    changedPaths,
    contentDigest: requiredDigest(source.contentDigest,
      "root-source bootstrap maintenance proof contentDigest"),
  };
  const stateDigest = requiredDigest(source.stateDigest,
    "root-source bootstrap maintenance proof stateDigest");
  const digestSubject = retiredPreservedPresent
    ? core
    : Object.fromEntries(Object.entries(core).filter(([key]) => key !== "retiredPreserved"));
  if (digestValue(digestSubject) !== stateDigest) {
    throw new Error("Root-source bootstrap maintenance source-state digest is invalid.");
  }
  return Object.freeze({ ...core, stateDigest });
}

export function isEligibleRootSourceMaintenance(proof) {
  const dirtyUnleased = proof.dirty && !proof.retiredPreserved
    && proof.leaseCount === 0 && proof.changedPaths.length > 0;
  const cleanRetired = !proof.dirty && proof.retiredPreserved
    && proof.leaseCount === 1 && proof.changedPaths.length === 0;
  return dirtyUnleased || cleanRetired;
}

export function hasCurrentRootSourceMaintenanceAuthority(proof, currentRemoteClaims) {
  if (!proof.retiredPreserved) return false;
  if (!Array.isArray(currentRemoteClaims)) {
    throw new Error("Root-source bootstrap maintenance authority requires current remote claims.");
  }
  return currentRemoteClaims.some(claim => (
    Array.isArray(claim?.declaredWriteScope)
    && writeSetsOverlap(proof.declaredWriteSet, claim.declaredWriteScope)
  ));
}

export function isRetiredAdmissionOwnerLane({ lane, lanePath, branch, targetRepository }) {
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

function parseManifest(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch {
    throw new Error("Root-source bootstrap maintenance manifest must be valid JSON.");
  }
  requireObject(manifest, "Root-source bootstrap maintenance manifest");
  if (manifest.schema !== MAINTENANCE_MANIFEST_SCHEMA || !Array.isArray(manifest.declaredWriteSet)) {
    throw new Error(`Root-source bootstrap maintenance manifest must use ${MAINTENANCE_MANIFEST_SCHEMA}.`);
  }
  return manifest;
}

function changedGitPaths(repository) {
  return [...new Set([
    ...readGitPaths(repository, ["diff", "--name-only", "-z", "--cached"]),
    ...readGitPaths(repository, ["diff", "--name-only", "-z"]),
    ...readGitPaths(repository, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort();
}

function maintenanceContentDigest({ lane, retirementReceiptDigest }) {
  const untrackedPaths = readGitPaths(lane,
    ["ls-files", "--others", "--exclude-standard", "-z"]).sort();
  return digestValue({
    schema: "agentic-root-source-bootstrap-maintenance-content/v2",
    stagedDiffDigest: sha256(execFileSync("git",
      ["-C", lane, "diff", "--binary", "--no-ext-diff", "--cached", "--"])),
    unstagedDiffDigest: sha256(execFileSync("git",
      ["-C", lane, "diff", "--binary", "--no-ext-diff", "--"])),
    untrackedFiles: untrackedPaths.map(relativePath => ({
      path: relativePath,
      digest: digestUntrackedFile(lane, relativePath),
    })),
    retirementReceiptDigest,
  });
}

function resolveGitCommonDirectory(lane) {
  const raw = execFileSync("git", ["-C", lane, "rev-parse", "--git-common-dir"],
    { encoding: "utf8" }).trim();
  return path.isAbsolute(raw) ? raw : path.resolve(lane, raw);
}

function normalizeRelativePaths(value) {
  if (!Array.isArray(value)) {
    throw new Error("Root-source bootstrap maintenance proof changedPaths is required.");
  }
  return [...new Set(value.map(changedPath => {
    const normalized = requiredText(changedPath, "maintenance changed path").replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")
      || normalized.includes("/../")) {
      throw new Error("Root-source bootstrap maintenance changed paths must be repository-relative.");
    }
    return normalized;
  }))].sort();
}

function readGitPaths(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
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

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}
function requireExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are not exact.`);
  }
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a string.`);
  return value;
}
function requiredExactText(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must equal ${expected}.`);
  return value;
}
function requiredTrue(value, label) {
  if (value !== true) throw new Error(`${label} must be true.`);
  return true;
}
function requiredExactInteger(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must equal ${expected}.`);
  return value;
}
function requiredExactTextArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(`${label} must match the authorized values exactly.`);
  }
  return Object.freeze([...value]);
}
function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
function requiredSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a Git SHA.`);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be nonnegative.`);
  return value;
}
