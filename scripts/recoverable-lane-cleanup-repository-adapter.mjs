// Responsibility: provide repository, lifecycle, cloud, and bundle ports for recoverable cleanup.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeDormantPreservationAdmissionIntent } from "./dormant-preservation-decision-contract.mjs";
import {
  normalizeRecoverableLaneCleanupIntent,
  normalizeRecoverableLaneCleanupReceipt,
  RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
} from "./recoverable-lane-cleanup-contract.mjs";
import { createRecoverableLaneCleanupRecoveryStore } from "./recoverable-lane-cleanup-recovery-store.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { buildLifecycleReport } from "./worktree-lifecycle-lib.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const OPERATION_MARKERS = Object.freeze([
  "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD",
  "REVERT_HEAD", "BISECT_LOG", "sequencer", "index.lock",
]);
const CURRENT_LEASE_STATES = new Set(["active", "review_ready", "delivery", "parked"]);

export function createRecoverableLaneCleanupRepositoryAdapter({
  repository, worktree, recoveryDirectory, git = runGit, now = () => new Date(),
  checkpoint = () => {},
  readPreservationReceipts = discoverPreservationReceiptDigests,
  normalizeDormantIntent = normalizeDormantPreservationAdmissionIntent,
  readRemoteAuthority = inspectRemoteAuthority,
  invokeCloudAction = invokeRepositoryCloudAction,
} = {}) {
  const root = realDirectory(repository, "canonical repository");
  const target = normalizedAbsolute(worktree, "target worktree");
  const recovery = normalizedAbsolute(recoveryDirectory, "recovery directory");
  const commonDir = realDirectory(resolveGitPath(
    root, git(root, ["rev-parse", "--git-common-dir"]).trim(),
  ), "Git common directory");
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDir, now });
  const store = createRecoverableLaneCleanupRecoveryStore({
    root, target, recovery, commonDir, leaseStore, git, now, checkpoint,
    normalizeIntent: normalizeRecoverableLaneCleanupIntent,
    normalizeReceipt: normalizeRecoverableLaneCleanupReceipt,
  });
  const capture = input => captureEvidence({
    root, target, recovery, commonDir, git, leaseStore, store, input,
    readPreservationReceipts, normalizeDormantIntent, readRemoteAuthority,
    invokeCloudAction,
  });
  return Object.freeze({
    captureEvidence: capture,
    withSubjectFence: store.withSubjectFence,
    readIntent: store.readIntent,
    writeIntent: store.writeIntent,
    ensureBundle: plan => ensureBundle({ root, recovery, plan, git }),
    verifyBundle: (plan, bundle) => verifyBundle({ root, plan, bundle, git }),
    inspectReservation: store.inspectReservation,
    beginReservation: store.beginReservation,
    inspectCleanupState: store.inspectState,
    quarantineWorktree: store.quarantine,
    removeWorktree: store.remove,
    releaseReservation: store.releaseReservation,
    observeFinal: plan => observeFinal({ root, plan, git, leaseStore, store }),
    readReceipt: store.readReceipt,
    writeReceipt: store.writeReceipt,
  });
}

export function captureRecoverableLaneCleanupEvidence({
  repository, worktree, recoveryDirectory, git = runGit,
} = {}) {
  return createRecoverableLaneCleanupRepositoryAdapter({
    repository, worktree, recoveryDirectory, git,
  }).captureEvidence({});
}

function captureEvidence({
  root, target, recovery, commonDir, git, leaseStore, store,
  readPreservationReceipts, normalizeDormantIntent, readRemoteAuthority,
  invokeCloudAction,
}) {
  const records = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]));
  store.assertInitialLocation(records);
  const canonicalRecords = records.filter(record => record.branch === "refs/heads/main");
  if (canonicalRecords.length !== 1) throw new Error(
    `Recoverable cleanup expected one canonical main worktree; found ${canonicalRecords.length}.`,
  );
  const canonicalPath = realDirectory(canonicalRecords[0].path, "canonical worktree");
  if (canonicalPath !== root) throw new Error("Cleanup must use the registered canonical main worktree.");
  const targetRecord = records.find(record => path.resolve(record.path) === target);
  if (!targetRecord) throw new Error(`Cleanup target is not a registered worktree: ${target}`);
  if (targetRecord.bare || targetRecord.locked || targetRecord.prunable || !targetRecord.branch) {
    throw new Error("Cleanup target must be one valid attached task worktree.");
  }
  if (realDirectory(targetRecord.path, "target worktree") !== target) {
    throw new Error("Cleanup target realpath differs from the requested path.");
  }
  const canonicalStatus = git(root, [
    "status", "--porcelain=v2", "-z", "--untracked-files=all",
  ]);
  if (canonicalStatus) throw new Error("Canonical worktree must be clean.");
  const targetStatus = git(target, [
    "status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=matching",
  ]);
  if (targetStatus) throw new Error("Cleanup target must be clean, including ignored residue.");
  const unmerged = git(target, ["ls-files", "-u", "-z"]);
  const unmergedEntries = unmerged.split("\0").filter(Boolean).length;
  if (unmergedEntries) throw new Error("Cleanup target contains unmerged index entries.");
  const submodules = git(target, ["submodule", "status", "--recursive"]).trim();
  if (submodules) throw new Error("Recoverable cleanup does not yet support linked submodules.");
  const operationMarkers = OPERATION_MARKERS.filter(marker => existsSync(resolveGitPath(
    target, git(target, ["rev-parse", "--git-path", marker]).trim(),
  )));
  if (operationMarkers.length) throw new Error(
    `Cleanup target has in-progress Git state: ${operationMarkers.join(", ")}`,
  );
  const branch = git(target, ["symbolic-ref", "--quiet", "HEAD"]).trim();
  if (!branch.startsWith("refs/heads/") || branch === "refs/heads/main") {
    throw new Error("Cleanup target must own an attached non-main branch.");
  }
  const headSha = exactSha(git(target, ["rev-parse", "HEAD"]).trim(), "target HEAD");
  const treeSha = exactSha(git(target, ["rev-parse", "HEAD^{tree}"]).trim(), "target tree");
  const branchHeadSha = exactSha(git(root, ["rev-parse", branch]).trim(), "target branch HEAD");
  const gitDir = realDirectory(resolveGitPath(
    target, git(target, ["rev-parse", "--git-dir"]).trim(),
  ), "target Git directory");
  const canonicalHeadSha = exactSha(git(root, ["rev-parse", "HEAD"]).trim(), "canonical HEAD");
  const originMainSha = exactSha(git(root, ["rev-parse", "refs/remotes/origin/main"]).trim(), "origin/main");
  const remoteMainSha = remoteSha(root, "refs/heads/main", git);
  if (!remoteMainSha) throw new Error("Protected remote main is unavailable.");
  const lifecycle = buildLifecycleReport({ repository: root, git });
  const lifecycleItem = lifecycle.worktrees.find(item => path.resolve(item.path) === target);
  if (!lifecycleItem) throw new Error("Cleanup target has no lifecycle projection.");
  const lease = lifecycleItem.lease;
  const leaseStatus = lease?.status || null;
  const retired = lifecycleItem.state === "retired-preserved";
  const currentLocalWriter = !retired
    && Boolean(leaseStatus && CURRENT_LEASE_STATES.has(leaseStatus)
      && Date.parse(lease?.expiresAt || 0) > Date.now());
  const disposition = retired ? "retired-preserved-terminal"
    : leaseStatus === null ? "unowned-terminal"
      : ["released", "completed"].includes(leaseStatus)
        ? "released-terminal" : "nonterminal";
  const registry = leaseStore.readRegistry();
  const registryBranch = branch.replace(/^refs\/heads\//u, "");
  const priorLease = registry.leases?.[registryBranch] ?? null;
  const preservationReceiptDigests = readPreservationReceipts({
    commonDir, lease, target, branch, headSha, treeSha, normalizeDormantIntent,
  });
  const originUrl = git(root, ["remote", "get-url", "origin"]).trim();
  const remoteAuthority = readRemoteAuthority({
    originUrl, headSha, claimId: lease?.cloudAuthority?.claimId || null,
    invokeCloudAction,
  });
  const authorityCore = {
    lifecycleState: lifecycleItem.state,
    leaseStatus,
    currentLocalWriter,
    disposition,
    priorLease,
    priorLeaseDigest: priorLease === null ? null : digestValue(priorLease),
    preservationReceiptDigests,
    remoteAuthority,
  };
  const core = {
    schema: RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
    repository: {
      root, gitCommonDir: commonDir, identityDigest: digestValue({ commonDir, originUrl }),
    },
    canonical: {
      worktreePath: canonicalPath, headSha: canonicalHeadSha,
      treeSha: exactSha(git(root, ["rev-parse", "HEAD^{tree}"]).trim(), "canonical tree"),
      originMainSha, remoteMainSha, clean: true,
    },
    target: {
      worktreePath: target, branch, headSha, branchHeadSha, treeSha, gitDir,
      worktreeGenerationDigest: directoryGenerationDigest(target),
      gitDirIdentityDigest: gitDirectoryIdentityDigest(gitDir),
      gitDirGenerationDigest: directoryGenerationDigest(gitDir),
      clean: true, unmergedEntries, operationMarkers,
      stateDigest: digestValue({ targetStatus, unmerged, operationMarkers, submodules }),
    },
    authority: { ...authorityCore, authorityDigest: digestValue(authorityCore) },
    remoteBranch: { ref: branch, sha: remoteSha(root, branch, git) },
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

function inspectRemoteAuthority({ originUrl, headSha, claimId, invokeCloudAction }) {
  const repository = githubRepository(originUrl);
  const result = invokeCloudAction({
    action: "status", ledgerRepository: repository,
    request: { targetRepository: repository },
  });
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "status" || result.status !== "ready"
    || !Array.isArray(result.claims)) {
    throw new Error("Recoverable cleanup requires fresh provider inventory.");
  }
  const targetClaims = result.claims.filter(claim => (
    claim.claimId === claimId || claim.laneRevision === headSha
  )).map(claim => ({
    claimId: requiredDigest(claim.claimId, "claim ID"),
    state: String(claim.state),
    laneRevision: exactSha(claim.laneRevision, "claim lane revision"),
    transitionCounter: positiveInteger(claim.transitionCounter, "claim transition counter"),
    writeAuthority: exactBoolean(claim.writeAuthority, "claim write authority"),
    scopeReserved: exactBoolean(claim.scopeReserved, "claim scope reservation"),
  })).sort((left, right) => left.claimId.localeCompare(right.claimId));
  const core = {
    provider: "github",
    ledgerRepository: repository,
    targetRepository: repository,
    targetClaims,
    currentRemoteWriter: targetClaims.some(claim => claim.writeAuthority),
    waitingSuccessors: targetClaims.filter(claim => claim.state === "waiting-successor").length,
  };
  return Object.freeze({ ...core, verificationReceiptDigest: digestValue(core) });
}

function ensureBundle({ root, recovery, plan, git }) {
  if (!existsSync(recovery)) throw new Error("Cleanup intent must exist before bundle creation.");
  const bundlePath = plan.recovery.bundlePath;
  if (!existsSync(bundlePath)) {
    const branchHead = exactSha(git(root, ["rev-parse", plan.evidence.target.branch]).trim(), "bundle source branch");
    if (branchHead !== plan.evidence.target.headSha) throw new Error("Cleanup branch drifted before bundling.");
    const temporary = `${bundlePath}.tmp-${process.pid}-${process.hrtime.bigint()}`;
    try {
      git(root, ["bundle", "create", temporary, plan.evidence.target.branch]);
      verifyBundleAtPath({ root, plan, bundlePath: temporary, reportedPath: bundlePath, git });
      renameSync(temporary, bundlePath);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  return verifyBundle({ root, plan, bundle: null, git });
}

function verifyBundle({ root, plan, bundle, git }) {
  return verifyBundleAtPath({
    root, plan, bundlePath: plan.recovery.bundlePath,
    reportedPath: plan.recovery.bundlePath, bundle, git,
  });
}

function verifyBundleAtPath({ root, plan, bundlePath, reportedPath, bundle, git }) {
  if (bundle && bundle.path !== reportedPath) throw new Error("Cleanup bundle path drifted.");
  if (!existsSync(bundlePath) || !lstatSync(bundlePath).isFile()
    || lstatSync(bundlePath).isSymbolicLink()) throw new Error("Cleanup bundle is missing or unsafe.");
  git(root, ["bundle", "verify", bundlePath]);
  const bytes = readFileSync(bundlePath);
  const boundary = bytes.indexOf(Buffer.from("\n\n"));
  if (boundary < 0 || bytes.subarray(0, boundary).toString("utf8")
    .split(/\r?\n/u).some(line => line.startsWith("-"))) {
    throw new Error("Cleanup recovery bundle is not complete history.");
  }
  const heads = git(root, ["bundle", "list-heads", bundlePath]).trim().split(/\r?\n/u);
  if (!heads.includes(`${plan.evidence.target.headSha} ${plan.evidence.target.branch}`)) {
    throw new Error("Cleanup bundle does not preserve the exact branch head.");
  }
  const isolated = mkdtempSync(path.join(os.tmpdir(), "acos-cleanup-bundle-"));
  try {
    git(isolated, ["init", "--bare", "."]); git(isolated, ["bundle", "unbundle", bundlePath]);
    git(isolated, ["cat-file", "-e", `${plan.evidence.target.headSha}^{commit}`]);
    if (git(isolated, ["rev-parse", `${plan.evidence.target.headSha}^{tree}`]).trim()
      !== plan.evidence.target.treeSha) throw new Error("Cleanup bundle tree differs from target.");
  } finally { rmSync(isolated, { recursive: true, force: true }); }
  const result = {
    path: reportedPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    headSha: plan.evidence.target.headSha,
    treeSha: plan.evidence.target.treeSha,
    headRef: plan.evidence.target.branch,
    complete: true,
  };
  if (bundle && digestValue(bundle) !== digestValue(result)) throw new Error("Cleanup bundle drifted.");
  return Object.freeze(result);
}

function observeFinal({ root, plan, git, leaseStore, store }) {
  const state = store.inspectState(plan);
  const branch = plan.evidence.target.branch.replace(/^refs\/heads\//u, "");
  const current = leaseStore.readRegistry().leases?.[branch] ?? null;
  return Object.freeze({
    targetRegistered: state.targetRegistered,
    targetExists: state.targetExists,
    stagingRegistered: state.stagingRegistered,
    stagingExists: state.stagingExists,
    snapshotExists: state.snapshotExists,
    snapshotDigest: state.snapshotDigest,
    snapshotGenerationDigest: state.snapshotGenerationDigest,
    gitDirSnapshotExists: state.gitDirSnapshotExists,
    gitDirSnapshotDigest: state.gitDirSnapshotDigest,
    gitDirSnapshotGenerationDigest: state.gitDirSnapshotGenerationDigest,
    disposableGitDirExists: state.disposableGitDirExists,
    priorLeaseRestored: (current === null ? null : digestValue(current))
      === plan.evidence.authority.priorLeaseDigest,
    canonicalHeadSha: exactSha(git(root, ["rev-parse", "HEAD"]).trim(), "final canonical HEAD"),
    branchHeadSha: exactSha(git(root, ["rev-parse", plan.evidence.target.branch]).trim(), "final branch HEAD"),
    remoteBranchSha: remoteSha(root, plan.evidence.target.branch, git),
  });
}

function discoverPreservationReceiptDigests({
  commonDir, target, branch, headSha, treeSha, normalizeDormantIntent,
}) {
  const directory = path.join(commonDir, "agentic-canvas-os", "dormant-preservation-admission");
  if (!existsSync(directory)) return [];
  const values = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".json")) continue;
    const journal = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
    const intent = normalizeDormantIntent(journal.intent);
    if (intent.status !== "complete") continue;
    const selected = intent.planSnapshot?.sourceEvidence?.preservation?.selectedLanes || [];
    if (!selected.some(item => item.worktree?.path === target
      && item.worktree?.branch === branch && item.worktree?.headSha === headSha
      && item.worktree?.treeSha === treeSha)) continue;
    values.push(requiredDigest(
      intent.phases?.complete?.values?.receipt?.receiptDigest,
      "preservation receipt digest",
    ));
  }
  return [...new Set(values)].sort();
}

function githubRepository(originUrl) {
  const match = String(originUrl).match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/u);
  if (!match) throw new Error("GitHub reference mapping could not resolve the repository origin.");
  return `${match[1]}/${match[2]}`;
}
function remoteSha(root, ref, git) {
  const output = git(root, ["ls-remote", "--refs", "origin", ref]).trim();
  if (!output) return null;
  const [sha, observedRef] = output.split(/\s+/u);
  if (observedRef !== ref) throw new Error(`Remote ref response did not match ${ref}.`);
  return exactSha(sha, `remote ${ref}`);
}
function gitDirectoryIdentityDigest(gitDir) {
  const metadata = statSync(gitDir);
  return digestValue({ gitDir, device: String(metadata.dev), inode: String(metadata.ino),
    birthtimeMs: String(metadata.birthtimeMs) });
}
function directoryGenerationDigest(directory) {
  const metadata = statSync(directory);
  return digestValue({ device: String(metadata.dev), inode: String(metadata.ino),
    birthtimeMs: String(metadata.birthtimeMs) });
}
function realDirectory(value, label) {
  const normalized = normalizedAbsolute(value, label);
  if (!existsSync(normalized) || !lstatSync(normalized).isDirectory()) throw new Error(`${label} must exist.`);
  const real = realpathSync(normalized);
  if (real !== normalized) throw new Error(`${label} must be a normalized realpath.`);
  return real;
}
function normalizedAbsolute(value, label) {
  const text = String(value || "").trim();
  if (!path.isAbsolute(text) || path.normalize(text) !== text) throw new Error(
    `${label} must be a normalized absolute path.`,
  );
  return text;
}
function resolveGitPath(cwd, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value);
}
function exactSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value))) throw new Error(`${label} must be an exact Git SHA.`);
  return value;
}
function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value))) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}
function positiveInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive.`);
  return value;
}
function exactBoolean(value, label) { if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`); return value; }
function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}
