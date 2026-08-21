// Responsibility: acquire and normalize the local source proof for reconciliation.
import { existsSync } from "node:fs";
import path from "node:path";

import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function readMergedDormantClaimReconciliationLocalEvidence({
  claim, claims, git, leaseStore, sourceRoot,
}) {
  const branch = requiredText(git(["branch", "--show-current"]).trim(), "source branch");
  const lease = leaseStore.read(branch);
  if (lease?.branch === branch && path.resolve(lease.worktreePath) === sourceRoot) {
    return readAttachedLocalEvidence({ git, lease, sourceRoot });
  }
  return readCompletedAbsentLocalEvidence({ claim, claims, git, leaseStore, sourceRoot });
}

export function readCompletedAbsentLocalEvidence({ claim, claims, git, leaseStore, sourceRoot }) {
  const { anchor, records } = assertCleanCanonicalAnchor({ git, sourceRoot });
  const entries = Object.entries(leaseStore.read()?.leases || {});
  const historical = entries.filter(([, candidate]) => candidate?.cloudAuthority?.claimId === claim.claimId);
  if (historical.length !== 1) {
    throw new Error("Completed-absent reconciliation requires one historical lease for the exact cloud claim.");
  }
  const [registryBranch, lease] = historical[0];
  const branch = requiredText(lease.branch, "completed lease branch");
  const worktreePath = path.resolve(requiredText(lease.worktreePath, "completed lease worktree path"));
  if (registryBranch !== branch || lease.status !== "completed") {
    throw new Error("Completed-absent reconciliation requires one completed historical branch lease.");
  }
  const matching = entries.filter(([storedBranch, candidate]) => (
    storedBranch === branch
    || candidate?.branch === branch
    || resolvedLeasePath(candidate?.worktreePath) === worktreePath
    || candidate?.cloudAuthority?.claimId === claim.claimId
    || candidate?.pullRequestUrl === lease.pullRequestUrl
    || candidate?.reviewHeadSha === lease.reviewHeadSha
  ));
  if (matching.length !== 1 || matching[0][1] !== lease) {
    throw new Error("Completed-absent reconciliation has competing historical lease evidence.");
  }
  assertNoCompetingReservation({ claim, claims });
  const registered = records.some(record => resolvedLeasePath(record.worktree) === worktreePath);
  const branchAttached = records.some(record => record.branch === `refs/heads/${branch}`);
  if (existsSync(worktreePath) || registered || branchAttached) {
    throw new Error("Completed-absent reconciliation source is still present or attached.");
  }
  const headSha = requiredSha(git([
    "show-ref", "--verify", "--hash", `refs/heads/${branch}`,
  ]).trim(), "retained completed local branch");
  if (headSha !== requiredSha(lease.reviewHeadSha, "completed lease reviewed head")) {
    throw new Error("Completed-absent reconciliation retained branch drifted from its completed lease.");
  }
  const treeSha = requiredSha(git(["rev-parse", `${headSha}^{tree}`]).trim(), "retained completed local tree");
  const fenceParent = requiredSha(git(["rev-parse", `${lease.fenceSha}^`]).trim(), "completed fence parent");
  return Object.freeze({
    mode: "completed-absent", worktreePath, registered: false, attached: false, branch,
    headSha, treeSha, canonicalAnchor: anchor,
    absence: Object.freeze({ pathExists: false, registered: false, branchAttached: false,
      localBranchPresent: true, localRefName: `refs/heads/${branch}`, matchingLeaseCount: matching.length }),
    remote: { name: "origin", branchPresent: null },
    lease: projectCompletedLeaseEvidence(lease),
    lineage: { fence: { sha: lease.fenceSha, treeSha: requiredSha(git(["rev-parse", `${lease.fenceSha}^{tree}`]).trim(), "completed fence tree"), parentSha: fenceParent, parentTreeSha: requiredSha(git(["rev-parse", `${fenceParent}^{tree}`]).trim(), "completed fence parent tree") }, reviewedHead: { sha: headSha, treeSha, parentSha: requiredSha(git(["rev-parse", `${headSha}^`]).trim(), "completed reviewed parent"), changedPaths: git(["diff", "--name-only", lease.fenceSha, headSha, "--"]).trim().split("\n").filter(Boolean) } },
  });
}

export function normalizeMergedDormantClaimReconciliationLocalEvidence(value) {
  requireObject(value, "Local evidence");
  if (value.mode === "completed-absent") return normalizeCompletedAbsentLocal(value);
  if (value.mode !== undefined) throw new Error("Local evidence mode is unsupported.");
  const local = {
    worktreePath: requiredText(value.worktreePath, "local worktree path"),
    registered: value.registered,
    attached: value.attached,
    clean: value.clean,
    branch: requiredText(value.branch, "local branch"),
    headSha: requiredSha(value.headSha, "local head SHA"),
    treeSha: requiredSha(value.treeSha, "local tree SHA"),
    indexDigest: requiredDigest(value.indexDigest, "local index digest"),
    workingTreeDigest: requiredDigest(value.workingTreeDigest, "local working-tree digest"),
    stateDigest: requiredDigest(value.stateDigest, "local state digest"),
    remote: normalizeRemote(value.remote),
    lease: normalizeLease(value.lease),
    lineage: normalizeLocalLineage(value.lineage),
  };
  if (local.registered !== true || local.attached !== true || local.clean !== true
    || local.remote.name !== "origin" || local.remote.branchPresent !== false) {
    throw new Error("Reconciliation requires a clean registered attached lane with no remote branch.");
  }
  return deepFreeze(local);
}

function readAttachedLocalEvidence({ git, lease, sourceRoot }) {
  const branch = requiredText(git(["branch", "--show-current"]).trim(), "source branch");
  const headSha = requiredSha(git(["rev-parse", "HEAD"]).trim(), "source HEAD");
  const treeSha = requiredSha(git(["rev-parse", "HEAD^{tree}"]).trim(), "source tree");
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const fenceParent = requiredSha(git(["rev-parse", `${lease.fenceSha}^`]).trim(), "fence parent");
  const changedPaths = git(["diff", "--name-only", lease.fenceSha, headSha, "--"]).trim().split("\n").filter(Boolean);
  const records = git(["worktree", "list", "--porcelain", "-z"]);
  const registered = records.includes(`worktree ${sourceRoot}\0`)
    && records.includes(`branch refs/heads/${branch}\0`);
  return Object.freeze({
    worktreePath: sourceRoot,
    registered,
    attached: true,
    clean: status === "",
    branch,
    headSha,
    treeSha,
    indexDigest: digestValue({ schema: "agentic-index-state/v1", treeSha }),
    workingTreeDigest: digestValue({ schema: "agentic-working-tree-state/v1", status }),
    stateDigest: digestValue({ branch, headSha, status, treeSha, worktreePath: sourceRoot }),
    remote: { name: "origin", branchPresent: null },
    lease: projectLeaseEvidence(lease),
    lineage: { fence: { sha: lease.fenceSha, treeSha: requiredSha(git(["rev-parse", `${lease.fenceSha}^{tree}`]).trim(), "fence tree"), parentSha: fenceParent, parentTreeSha: requiredSha(git(["rev-parse", `${fenceParent}^{tree}`]).trim(), "fence parent tree") }, reviewedHead: { sha: headSha, treeSha, parentSha: requiredSha(git(["rev-parse", `${headSha}^`]).trim(), "reviewed parent"), changedPaths } },
  });
}

function assertCleanCanonicalAnchor({ git, sourceRoot }) {
  const headSha = requiredSha(git(["rev-parse", "HEAD"]).trim(), "canonical anchor HEAD");
  const originMainSha = requiredSha(git(["rev-parse", "origin/main"]).trim(), "canonical anchor origin/main");
  if (git(["branch", "--show-current"]).trim() !== "main"
    || git(["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
    || headSha !== originMainSha) {
    throw new Error(`Completed-absent reconciliation requires clean current main at ${sourceRoot}.`);
  }
  const records = readWorktreeRecords(git(["worktree", "list", "--porcelain", "-z"]));
  const attachedMain = records.filter(record => (
    resolvedLeasePath(record.worktree) === sourceRoot && record.branch === "refs/heads/main"
  ));
  if (attachedMain.length !== 1) {
    throw new Error(`Completed-absent reconciliation requires registered main at ${sourceRoot}.`);
  }
  return Object.freeze({
    anchor: Object.freeze({ branch: "main", sha: headSha,
      treeSha: requiredSha(git(["rev-parse", "HEAD^{tree}"]).trim(), "canonical anchor tree") }),
    records,
  });
}

function assertNoCompetingReservation({ claim, claims }) {
  if (!Array.isArray(claims) || claims.some(candidate => !candidate || typeof candidate !== "object")) {
    throw new Error("Completed-absent reconciliation cloud inventory is malformed.");
  }
  const competing = claims.filter(candidate => candidate.claimId !== claim.claimId
    && candidate.repositoryId === claim.repositoryId && candidate.scopeReserved === true
    && writeSetsOverlap(candidate.declaredWriteScope, claim.declaredWriteScope));
  if (competing.length > 0) {
    throw new Error("Completed-absent reconciliation has a competing reserved cloud claim.");
  }
}

function normalizeCompletedAbsentLocal(value) {
  const local = {
    mode: "completed-absent",
    worktreePath: requiredText(value.worktreePath, "completed source worktree path"),
    registered: value.registered,
    attached: value.attached,
    branch: requiredText(value.branch, "completed local branch"),
    headSha: requiredSha(value.headSha, "completed local head SHA"),
    treeSha: requiredSha(value.treeSha, "completed local tree SHA"),
    canonicalAnchor: normalizeCanonicalAnchor(value.canonicalAnchor),
    absence: normalizeCompletedAbsence(value.absence, value.branch),
    remote: normalizeRemote(value.remote),
    lease: normalizeCompletedLease(value.lease),
    lineage: normalizeLocalLineage(value.lineage),
  };
  if (local.registered !== false || local.attached !== false || local.remote.name !== "origin"
    || local.remote.branchPresent !== false) {
    throw new Error("Completed-absent local evidence is not an exact absent source projection.");
  }
  return deepFreeze(local);
}

function normalizeCanonicalAnchor(value) {
  requireObject(value, "Completed canonical anchor evidence");
  const anchor = {
    branch: requiredText(value.branch, "completed canonical anchor branch"),
    sha: requiredSha(value.sha, "completed canonical anchor SHA"),
    treeSha: requiredSha(value.treeSha, "completed canonical anchor tree"),
  };
  if (anchor.branch !== "main") throw new Error("Completed canonical anchor must be main.");
  return Object.freeze(anchor);
}

function normalizeCompletedAbsence(value, branch) {
  requireObject(value, "Completed source absence evidence");
  const absence = {
    pathExists: value.pathExists,
    registered: value.registered,
    branchAttached: value.branchAttached,
    localBranchPresent: value.localBranchPresent,
    localRefName: requiredText(value.localRefName, "completed local ref name"),
    matchingLeaseCount: positiveInteger(value.matchingLeaseCount, "completed matching lease count"),
  };
  if (absence.pathExists !== false || absence.registered !== false || absence.branchAttached !== false
    || absence.localBranchPresent !== true
    || absence.localRefName !== `refs/heads/${requiredText(branch, "completed local branch")}`
    || absence.matchingLeaseCount !== 1) {
    throw new Error("Completed source absence evidence is not exact.");
  }
  return Object.freeze(absence);
}

function normalizeRemote(value) {
  requireObject(value, "Local remote evidence");
  return Object.freeze({ name: requiredText(value.name, "local remote name"), branchPresent: value.branchPresent });
}

function normalizeLocalLineage(value) {
  requireObject(value, "Local lineage evidence");
  requireObject(value.fence, "Local coordination fence");
  requireObject(value.reviewedHead, "Local reviewed head");
  return deepFreeze({
    fence: {
      sha: requiredSha(value.fence.sha, "coordination fence SHA"),
      treeSha: requiredSha(value.fence.treeSha, "coordination fence tree"),
      parentSha: requiredSha(value.fence.parentSha, "coordination fence parent"),
      parentTreeSha: requiredSha(value.fence.parentTreeSha, "coordination fence parent tree"),
    },
    reviewedHead: {
      sha: requiredSha(value.reviewedHead.sha, "reviewed head SHA"),
      treeSha: requiredSha(value.reviewedHead.treeSha, "reviewed head tree"),
      parentSha: requiredSha(value.reviewedHead.parentSha, "reviewed head parent"),
      changedPaths: Object.freeze(normalizePaths(value.reviewedHead.changedPaths, "reviewed changed paths")),
    },
  });
}

function normalizeLease(value) {
  requireObject(value, "Local lease evidence");
  const lease = normalizeLeaseFields(value, "local lease");
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "review_ready") {
    throw new Error("Local evidence requires an exact review_ready writer lease.");
  }
  return deepFreeze(lease);
}

function normalizeCompletedLease(value) {
  requireObject(value, "Completed local lease evidence");
  const lease = {
    ...normalizeLeaseFields(value, "completed lease"),
    worktreePath: requiredText(value.worktreePath, "completed lease worktree path"),
    completion: normalizeCompletion(value.completion),
  };
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "completed") {
    throw new Error("Completed-absent evidence requires an exact completed writer lease.");
  }
  return deepFreeze(lease);
}

function normalizeLeaseFields(value, label) {
  return {
    schema: requiredText(value.schema, `${label} schema`),
    status: requiredText(value.status, `${label} status`),
    epoch: positiveInteger(value.epoch, `${label} epoch`),
    sessionId: requiredText(value.sessionId, `${label} session ID`),
    device: requiredText(value.device, `${label} device`),
    scope: requiredText(value.scope, `${label} scope`),
    branch: requiredText(value.branch, `${label} branch`),
    baseSha: requiredSha(value.baseSha, `${label} base SHA`),
    fenceSha: requiredSha(value.fenceSha, `${label} fence SHA`),
    reviewHeadSha: requiredSha(value.reviewHeadSha, `${label} review head SHA`),
    pullRequestUrl: requiredText(value.pullRequestUrl, `${label} pull request URL`),
    leaseDigest: requiredDigest(value.leaseDigest, `${label} digest`),
    cloudAuthority: normalizeLocalAuthority(value.cloudAuthority),
  };
}

function normalizeCompletion(value) {
  requireObject(value, "Completed lease completion evidence");
  return Object.freeze({
    mergeCommitSha: requiredSha(value.mergeCommitSha, "completion merge SHA"),
    mainSha: requiredSha(value.mainSha, "completion main SHA"),
  });
}

function normalizeLocalAuthority(value) {
  requireObject(value, "Local cloud authority");
  const authority = {
    claimId: requiredDigest(value.claimId, "local authority claim ID"),
    claimDigest: requiredDigest(value.claimDigest, "local authority claim digest"),
    ledgerRevision: requiredSha(value.ledgerRevision, "local authority ledger revision"),
    ledgerDigest: requiredDigest(value.ledgerDigest, "local authority ledger digest"),
    claimLedgerRevision: requiredDigest(value.claimLedgerRevision, "local authority transition digest"),
    operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "local authority operation receipt digest"),
    deviceId: requiredText(value.deviceId, "local authority cloud device ID"),
    sessionId: requiredText(value.sessionId, "local authority cloud session ID"),
    canonicalBaseSha: requiredSha(value.canonicalBaseSha, "local authority canonical base"),
    laneRevision: requiredSha(value.laneRevision, "local authority lane revision"),
    writeSetDigest: requiredDigest(value.writeSetDigest, "local authority write-set digest"),
    reviewRequestId: requiredText(value.reviewRequestId, "local authority review request ID"),
    focusedEvidenceDigest: requiredDigest(value.focusedEvidenceDigest, "local authority focused evidence digest"),
    leaseEpoch: positiveInteger(value.leaseEpoch, "local authority lease epoch"),
    transitionCounter: positiveInteger(value.transitionCounter, "local authority transition counter"),
    state: requiredText(value.state, "local authority state"),
    integrationReceiptDigest: requiredNull(value.integrationReceiptDigest, "local authority integration receipt digest"),
    integration: requiredNull(value.integration, "local authority integration"),
  };
  if (!new Set(["review_ready", "dormant-preserved"]).has(authority.state)) {
    throw new Error("Local authority must preserve its review-ready or dormant projection.");
  }
  return Object.freeze(authority);
}

function projectLeaseEvidence(lease) {
  const authority = lease.cloudAuthority;
  if (!authority || typeof authority !== "object") {
    throw new Error("Source writer lease has no stored cloud authority projection.");
  }
  return Object.freeze({
    schema: lease.schema, status: lease.status, epoch: lease.epoch, sessionId: lease.sessionId,
    device: lease.device, scope: lease.scope, branch: lease.branch, baseSha: lease.baseSha,
    fenceSha: lease.fenceSha, reviewHeadSha: lease.reviewHeadSha,
    pullRequestUrl: lease.pullRequestUrl, leaseDigest: digestValue(lease),
    cloudAuthority: Object.freeze({ ...authority }),
  });
}

function projectCompletedLeaseEvidence(lease) {
  const completed = lease.completion;
  if (!completed || typeof completed !== "object") {
    throw new Error("Completed source writer lease has no completion proof.");
  }
  return Object.freeze({
    ...projectLeaseEvidence(lease),
    worktreePath: path.resolve(requiredText(lease.worktreePath, "completed lease worktree path")),
    completion: Object.freeze({
      mergeCommitSha: requiredSha(completed.mergeCommitSha, "completed lease merge commit"),
      mainSha: requiredSha(completed.mainSha, "completed lease main revision"),
    }),
  });
}

function readWorktreeRecords(value) {
  const records = [];
  let record = {};
  for (const field of String(value).split("\0")) {
    if (!field) {
      if (Object.keys(record).length > 0) records.push(record);
      record = {};
      continue;
    }
    const separator = field.indexOf(" ");
    if (separator > 0) record[field.slice(0, separator)] = field.slice(separator + 1);
  }
  return records;
}

function resolvedLeasePath(value) {
  return typeof value === "string" && value.trim() ? path.resolve(value) : null;
}

function normalizePaths(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must not be empty.`);
  const paths = values.map(value => requiredText(value, label)).sort();
  if (new Set(paths).size !== paths.length) throw new Error(`${label} must be unique.`);
  return paths;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.normalize("NFC").trim();
}

function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase SHA.`);
  return sha;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requiredNull(value, label) {
  if (value !== null) throw new Error(`${label} must be null.`);
  return null;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
