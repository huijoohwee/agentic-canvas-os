// Responsibility: Capture byte-exact controller, index, review, cloud, and recovered-registration evidence.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { deriveTaskWorktreeRoot } from "./task-worktree-provision.mjs";
import { WRITER_LEASE_SCHEMA, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";

export const CONTROLLER_IMPLEMENTATION_FILES = Object.freeze([
  "scripts/planned-clean-fence-one-ahead-admission-finalization-contract.mjs",
  "scripts/planned-clean-fence-one-ahead-admission-finalization-evidence.mjs",
  "scripts/planned-clean-fence-one-ahead-admission-finalization-ports.mjs",
  "scripts/planned-clean-fence-one-ahead-admission-finalization-repository-adapter.mjs",
  "scripts/planned-clean-fence-one-ahead-admission-finalization.mjs",
]);
const BODY_LIMIT = 65_536;

export const FINALIZATION_RECEIPTS_FIELD =
  "plannedCleanFenceAdmissionFinalizationReceipts";
const REGISTRY_RECEIPT_SCHEMA =
  "agentic-planned-clean-fence-one-ahead-admission-finalization-registry-receipt/v1";

export function capturePlannedCleanFenceProtectedController({
  canonicalRepository, git, implementationFiles = CONTROLLER_IMPLEMENTATION_FILES,
}) {
  const root = path.resolve(canonicalRepository);
  const branch = git(root, ["branch", "--show-current"]);
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const headSha = git(root, ["rev-parse", "HEAD"]);
  const localMainSha = git(root, ["rev-parse", "refs/heads/main"]);
  const originMainSha = git(root, ["rev-parse", "refs/remotes/origin/main"]);
  const remoteMainSha = git(root,
    ["ls-remote", "--heads", "origin", "refs/heads/main"]).split(/\s+/u)[0] || "";
  const treeSha = git(root, ["rev-parse", "HEAD^{tree}"]);
  if (branch !== "main" || status || !sha(headSha) || headSha !== localMainSha
    || headSha !== originMainSha || headSha !== remoteMainSha || !sha(treeSha)) {
    throw new Error("Admission finalization requires its clean integrated protected controller main.");
  }
  const objectFormat = git(root, ["rev-parse", "--show-object-format"]);
  if (!new Set(["sha1", "sha256"]).has(objectFormat)
    || !Array.isArray(implementationFiles) || implementationFiles.length === 0) {
    throw new Error("Admission-finalization controller implementation identity is invalid.");
  }
  const files = [...new Set(implementationFiles)].sort().map(relativePath => {
    const absolute = path.resolve(root, relativePath);
    if (!inside(root, absolute)) throw new Error("Controller implementation escaped its root.");
    const before = lstatSync(absolute, { bigint: true });
    const bytes = readFileSync(absolute);
    const after = lstatSync(absolute, { bigint: true });
    const expectedOid = git(root, ["rev-parse", `${headSha}:${relativePath}`]);
    const observedOid = gitBlobOid(bytes, objectFormat);
    if (!before.isFile() || before.isSymbolicLink() || statIdentity(before) !== statIdentity(after)
      || expectedOid !== observedOid) {
      throw new Error("Controller implementation is not byte-exact at protected main.");
    }
    return { path: relativePath, oid: observedOid,
      sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const post = [git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(root, ["rev-parse", "HEAD"]), git(root, ["rev-parse", "refs/heads/main"]),
    git(root, ["rev-parse", "refs/remotes/origin/main"]),
    git(root, ["ls-remote", "--heads", "origin", "refs/heads/main"])
      .split(/\s+/u)[0] || ""];
  if (canonicalJson(post) !== canonicalJson(["main", "", headSha, headSha, headSha, headSha])) {
    throw new Error("Protected controller changed during exact implementation capture.");
  }
  return Object.freeze({
    schema: "agentic-planned-clean-fence-protected-controller/v1",
    branch, headSha, treeSha, localMainSha, originMainSha, remoteMainSha,
    clean: true, statusDigest: digestValue(status), implementationDigest: digestValue(files),
  });
}

export function captureRegisteredRawIndexFrame({ canonicalRepository, repository, git }) {
  const records = parseWorktreeRecords(
    git(canonicalRepository, ["worktree", "list", "--porcelain", "-z"]),
  );
  const candidate = path.resolve(repository);
  const indexes = records.filter(item => !item.bare).map(item => {
    const lanePath = path.resolve(item.path);
    return { pathDigest: digestValue(lanePath), indexSha256: rawIndexSha256(lanePath, git),
      candidate: lanePath === candidate };
  }).sort((left, right) => left.pathDigest.localeCompare(right.pathDigest));
  if (indexes.filter(item => item.candidate).length !== 1) {
    throw new Error("Raw-index capture requires one exact registered candidate.");
  }
  return Object.freeze({ schema: "agentic-registered-raw-index-frame/v1",
    laneCount: indexes.length, candidateIndexSha256:
      indexes.find(item => item.candidate).indexSha256, indexFrameDigest: digestValue(indexes) });
}

export function assertRegisteredRawIndexFrame(expected, observed) {
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    throw new Error("Admission finalization changed candidate or peer raw index bytes.");
  }
  return observed;
}

export function rawIndexSha256(repository, git) {
  const indexPath = path.resolve(git(repository,
    ["rev-parse", "--path-format=absolute", "--git-path", "index"]));
  const before = lstatSync(indexPath, { bigint: true });
  const bytes = readFileSync(indexPath);
  const after = lstatSync(indexPath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()
    || statIdentity(before) !== statIdentity(after)) {
    throw new Error("Admission-finalization index changed during exact capture.");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

export function replacePlannedCleanFenceWriterMarker(body, lease) {
  const source = String(body);
  const match = readExactWriterMarker(source);
  const marker = `<!-- ${WRITER_LEASE_SCHEMA} ${JSON.stringify(
    projectWriterLeasePullRequestMarker(lease))} -->`;
  const target = `${source.slice(0, match.start)}${marker}${source.slice(match.end)}`;
  const projected = readExactWriterMarker(target);
  if (projected.text !== marker
    || digestValue(projected.value) !== digestValue(projectWriterLeasePullRequestMarker(lease))
    || source.slice(0, match.start) !== target.slice(0, projected.start)
    || source.slice(match.end) !== target.slice(projected.end)) {
    throw new Error("Admission-finalization marker projection changed non-marker body bytes.");
  }
  return target;
}

export function assertFinalizationBodyCapacity(body) {
  if (Buffer.byteLength(body) > BODY_LIMIT) {
    throw new Error("Admission finalization has invalid bounded exact target pull-request marker body.");
  }
  return body;
}

export function readExactWriterMarker(body) {
  if (typeof body !== "string") throw new Error("Admission finalization requires one exact writer marker.");
  const escaped = WRITER_LEASE_SCHEMA.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = [...body.matchAll(new RegExp(
    `<!--\\s*${escaped}\\s+\\{.*?\\}\\s*-->`, "gsu"))];
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].index)) {
    throw new Error("Admission finalization requires one exact writer marker.");
  }
  const start = matches[0].index;
  const text = matches[0][0];
  const end = start + text.length;
  let value;
  try { value = parseWriterLeasePullRequestBody(text); } catch { value = null; }
  if (!value || end > body.length) throw new Error("Admission finalization writer marker is malformed.");
  return Object.freeze({ start, end, text, value });
}

export function assertStatusVerificationJoin({ statusClaim, verification, authority }) {
  const candidates = verification?.inventory?.claims?.filter(
    item => item.claimId === authority?.claimId) || [];
  const verified = candidates[0];
  if (candidates.length !== 1
    || statusClaim.transitionCounter !== verified.transitionCounter
    || statusClaim.heartbeatCounter !== verified.heartbeatCounter
    || statusClaim.fenceRevision !== verified.fenceRevision
    || statusClaim.transitionDigest !== verified.transitionDigest
    || authority.transitionCounter !== verified.transitionCounter
    || authority.heartbeatCounter !== verified.heartbeatCounter
    || authority.claimDigest !== verified.fenceRevision
    || authority.claimLedgerRevision !== verified.transitionDigest) {
    throw new Error("Admission-finalization status and verified cloud transition disagree.");
  }
  return verified;
}

export function projectStatusVerifiedCloudAuthority({ statusClaim, verification, authority }) {
  const candidates = verification?.inventory?.claims?.filter(
    item => item.claimId === authority?.claimId) || [];
  if (candidates.length !== 1) {
    throw new Error("Admission finalization requires one exact verified live claim.");
  }
  const target = Object.freeze({ ...authority,
    heartbeatCounter: candidates[0].heartbeatCounter });
  assertStatusVerificationJoin({ statusClaim, verification, authority: target });
  return target;
}

export function projectFinalizationPreviewEvidence(value) {
  return Object.freeze({
    peerLaneStateDigest: value.peerLaneStateDigest,
    protectedMainAdvanceDigest: digestValue(value.protectedMainAdvance),
    candidateCreateRegisterResultDigest: value.candidateCreateRegisterResult.resultDigest,
    recoveredPlanReportDigest: value.report.reportDigest,
    recoveredAdmissionReceiptDigest: value.report.admissionReceipt.receiptDigest,
    recoveredExistingLaneStateDigest: value.report.existingLaneStateDigest,
    preservationReceiptDigest: value.preservationReceipt.receiptDigest,
    admittedReportDigest: value.admittedReport.reportDigest,
    planRecoveryReceiptDigest: value.planRecoveryReceipt.receiptDigest,
  });
}

export function assertNoCompetingFinalizationIntent({ registry, branch }) {
  if (registry.scopeExpansionIntents?.[branch] != null
    || registry.activeOwnedDirtRecoveryIntents?.[branch] != null) {
    throw new Error("Admission finalization found a competing branch recovery intent.");
  }
}

export function assertFinalizationRegistryTarget({ registry, branch, plan, record,
  targetLeaseDigest }) {
  assertNoCompetingFinalizationIntent({ registry, branch });
  const currentLease = registry.leases?.[branch];
  const receipt = registry[FINALIZATION_RECEIPTS_FIELD]?.[plan.planDigest];
  const { receiptDigest, ...core } = receipt || {};
  if (currentLease?.schema !== "agentic-writer-lease/v2"
    || currentLease.branch !== branch
    || digestValue(currentLease) !== targetLeaseDigest
    || receipt?.schema !== REGISTRY_RECEIPT_SCHEMA
    || receipt.planDigest !== plan.planDigest
    || receipt.sourceLeaseDigest !== plan.evidence.sourceLeaseDigest
    || receipt.targetLeaseDigest !== targetLeaseDigest
    || receipt.claimId !== plan.evidence.sourceLease.cloudAuthority.claimId
    || receipt.recordDigest !== record.receiptDigest
    || !Number.isSafeInteger(receipt.registryRevision) || receipt.registryRevision < 1
    || receipt.registryRevision > registry.revision
    || receiptDigest !== digestValue(core)) {
    throw new Error("Admission-finalization target registry receipt is invalid.");
  }
  return receipt;
}

export function recoverProtectedDescendantCandidateRegistration({
  canonicalRepository,
  repository,
  lease,
  branch,
  git,
} = {}) {
  const raw = git(canonicalRepository, ["worktree", "list", "--porcelain", "-z"]);
  const records = parseWorktreeRecords(raw);
  const target = path.resolve(repository);
  const commonDirectory = path.resolve(canonicalRepository,
    git(canonicalRepository, ["rev-parse", "--git-common-dir"]));
  const safeRoot = deriveTaskWorktreeRoot(canonicalRepository, commonDirectory);
  const candidates = records.filter(item => path.resolve(item.path) === target);
  const headSha = git(repository, ["rev-parse", "HEAD"]);
  const treeSha = git(repository, ["rev-parse", "HEAD^{tree}"]);
  const baseTreeSha = git(canonicalRepository, ["rev-parse", `${lease.baseSha}^{tree}`]);
  const parentShas = git(repository, ["show", "-s", "--format=%P", "HEAD"])
    .split(/\s+/u).filter(Boolean);
  const status = git(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const subject = git(repository, ["log", "-1", "--format=%s"]);
  const remote = git(canonicalRepository,
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/u)[0] || "";
  if (path.dirname(target) !== safeRoot
    || candidates.length !== 1
    || candidates[0].branch !== `refs/heads/${branch}`
    || candidates[0].head !== lease.fenceSha
    || headSha !== lease.fenceSha
    || treeSha !== baseTreeSha
    || parentShas.length !== 1 || parentShas[0] !== lease.baseSha
    || status
    || subject !== `chore(coordination): claim ${lease.scope} lease ${lease.epoch}`
    || remote !== lease.fenceSha) {
    throw new Error("Protected-descendant recovery candidate is not the exact clean fence registration.");
  }
  git(canonicalRepository, ["merge-base", "--is-ancestor", lease.baseSha, "HEAD"]);
  const normalized = records.map(item => ({ path: path.resolve(item.path),
    head: item.head || null, branch: item.branch || null,
    detached: Boolean(item.detached) }));
  const before = normalized.filter(item => item.path !== target);
  const detachedCandidate = { path: target, head: lease.baseSha, branch: null, detached: true };
  const after = [...before, detachedCandidate].sort(compareRecords);
  const beforeRegistrationInventoryDigest = digestValue(before.sort(compareRecords));
  const afterRegistrationInventoryDigest = digestValue(after);
  const targetObservation = {
    schema: "agentic-task-worktree-target-observation/v1",
    targetPath: target,
    safeRoot,
    canonicalBaseSha: lease.baseSha,
    canonicalHeadSha: git(canonicalRepository, ["rev-parse", "HEAD"]),
    canonicalSourceDisposition: "protected-main-descendant",
    registrationInventoryDigest: beforeRegistrationInventoryDigest,
    occupied: false,
  };
  const expectedTargetObservationDigest = digestValue(targetObservation);
  const operationCore = {
    schema: "agentic-candidate-create-register-result/v1",
    status: "created",
    operationId: digestValue({
      target,
      baseSha: lease.baseSha,
      baseTreeSha,
      expectedTargetObservationDigest,
      beforeRegistrationInventoryDigest,
      afterRegistrationInventoryDigest,
    }),
    targetPath: target,
    baseSha: lease.baseSha,
    baseTreeSha,
    candidateRegistrationDigest: digestValue(detachedCandidate),
    expectedTargetObservationDigest,
    beforeRegistrationInventoryDigest,
    afterRegistrationInventoryDigest,
    mutationSet: ["candidate-registration"],
  };
  return Object.freeze({ ...operationCore, resultDigest: digestValue(operationCore) });
}

function compareRecords(left, right) {
  return left.path.localeCompare(right.path) || String(left.branch).localeCompare(String(right.branch));
}

function gitBlobOid(bytes, objectFormat) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

function statIdentity(value) {
  return [value.dev, value.ino, value.mode, value.size, value.mtimeNs, value.ctimeNs]
    .map(String).join(":");
}

function sha(value) { return /^[0-9a-f]{40}$/u.test(String(value || "")); }
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
