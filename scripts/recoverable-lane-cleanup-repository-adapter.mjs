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
import { captureRecoverableLaneGeneratedResidue,
  inspectRecoverableLaneCleanupTree } from "./recoverable-lane-cleanup-generated-residue.mjs";
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
  repository, worktree, recoveryDirectory, ledgerRepository = null,
  git = runGit, now = () => new Date(),
  checkpoint = () => {},
  readPreservationReceipts = discoverPreservationReceiptDigests,
  normalizeDormantIntent = normalizeDormantPreservationAdmissionIntent,
  readRemoteAuthority = inspectRemoteAuthority,
  invokeCloudAction = invokeRepositoryCloudAction,
  observeGeneratedResidueEntry,
} = {}) {
  const root = realDirectory(repository, "canonical repository");
  const target = normalizedAbsolute(worktree, "target worktree");
  const recovery = normalizedAbsolute(recoveryDirectory, "recovery directory");
  const explicitLedgerRepository = ledgerRepository === null
    ? null : repositoryIdentity(ledgerRepository, "ledger repository");
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
    invokeCloudAction, observeGeneratedResidueEntry,
    configuredLedgerRepository: explicitLedgerRepository,
  });
  const readIntent = () => {
    const intent = store.readIntent();
    return assertConfiguredRepositoryRouting({
      intent,
      explicitLedgerRepository,
      configuredTargetRepository: intent && readRemoteAuthority === inspectRemoteAuthority
        ? githubRepository(git(root, ["remote", "get-url", "origin"]).trim())
        : null,
    });
  };
  return Object.freeze({
    captureEvidence: capture,
    withSubjectFence: store.withSubjectFence,
    readIntent,
    writeIntent: store.writeIntent,
    ensureBundle: plan => ensureBundle({ root, recovery, plan, git }),
    verifyBundle: (plan, bundle) => verifyBundle({ root, plan, bundle, git }),
    inspectReservation: store.inspectReservation,
    beginReservation: store.beginReservation,
    inspectCleanupState: store.inspectState,
    quarantineWorktree: store.quarantine,
    removeWorktree: store.remove,
    releaseReservation: store.releaseReservation,
    observeRestored: plan => observeRestored({ root, plan, git }),
    abortReservation: (plan, reservation, restoredStateDigest) => store.abortReservation(
      plan, reservation, restoredStateDigest,
      () => observeRestored({ root, plan, git }).restoredStateDigest,
    ),
    observeAbortRelease: store.observeAbortRelease,
    observeFinal: plan => observeFinal({ root, plan, git, leaseStore, store }),
    readReceipt: store.readReceipt,
    writeReceipt: store.writeReceipt,
  });
}

function observeRestored({ root, plan, git }) {
  const target = plan.evidence.target.worktreePath;
  const records = parseWorktreeRecords(git(root, ["worktree", "list", "--porcelain"]));
  const matches = records.filter(record => path.resolve(record.path) === target);
  if (matches.length !== 1 || (matches[0].branch ?? null) !== plan.evidence.target.branch
    || matches[0].head !== plan.evidence.target.headSha || matches[0].bare
    || Boolean(matches[0].detached) !== (plan.evidence.target.branch === null)
    || matches[0].locked || !existsSync(target)
    || git(target, ["status", "--porcelain=v2", "-z", "--untracked-files=all"])
    || git(target, ["rev-parse", "HEAD"]).trim() !== plan.evidence.target.headSha
    || git(target, ["rev-parse", "HEAD^{tree}"]).trim() !== plan.evidence.target.treeSha) {
    throw new Error("Cleanup drift rollback did not restore the exact lane frame.");
  }
  const tree = inspectRecoverableLaneCleanupTree(target);
  const core = { schema: "agentic-recoverable-lane-cleanup-restored-drift/v1",
    planDigest: plan.planDigest, targetRegistered: true, targetExists: true,
    checkoutDigest: tree.digest, checkoutGenerationDigest: tree.generationDigest };
  return Object.freeze({ ...core, restoredStateDigest: digestValue(core) });
}


export function captureRecoverableLaneCleanupEvidence({
  repository, worktree, recoveryDirectory, ledgerRepository = null, git = runGit,
} = {}) {
  return createRecoverableLaneCleanupRepositoryAdapter({
    repository, worktree, recoveryDirectory, ledgerRepository, git,
  }).captureEvidence({});
}

function captureEvidence({
  root, target, recovery, commonDir, git, leaseStore, store,
  readPreservationReceipts, normalizeDormantIntent, readRemoteAuthority,
  invokeCloudAction, observeGeneratedResidueEntry,
  configuredLedgerRepository,
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
  if (targetRecord.bare || targetRecord.locked || targetRecord.prunable) {
    throw new Error("Cleanup target must be one valid task worktree.");
  }
  if (realDirectory(targetRecord.path, "target worktree") !== target) {
    throw new Error("Cleanup target realpath differs from the requested path.");
  }
  const canonicalStatus = git(root, [
    "status", "--porcelain=v2", "-z", "--untracked-files=all",
  ]);
  if (canonicalStatus) throw new Error("Canonical worktree must be clean.");
  const targetStatus = git(target, [
    "status", "--porcelain=v2", "-z", "--untracked-files=all",
  ]);
  if (targetStatus) throw new Error("Cleanup target must have no tracked or ordinary untracked residue.");
  const generatedResidue = captureRecoverableLaneGeneratedResidue({
    root: target, git, observeEntry: observeGeneratedResidueEntry,
  });
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
  const branch = targetRecord.branch ?? null;
  if (branch !== null && (!branch.startsWith("refs/heads/") || branch === "refs/heads/main")) {
    throw new Error("Cleanup target branch must be one exact non-main ref.");
  }
  const headSha = exactSha(git(target, ["rev-parse", "HEAD"]).trim(), "target HEAD");
  const treeSha = exactSha(git(target, ["rev-parse", "HEAD^{tree}"]).trim(), "target tree");
  const branchHeadSha = branch === null ? null
    : exactSha(git(root, ["rev-parse", branch]).trim(), "target branch HEAD");
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
  const detachedLeases = branch === null ? Object.values(registry.leases || {})
    .filter(candidate => path.resolve(candidate?.worktreePath || "") === target) : [];
  if (detachedLeases.length) {
    throw new Error("Detached cleanup target must have no writer-lease projection.");
  }
  const registryBranch = branch === null ? null : branch.replace(/^refs\/heads\//u, "");
  const priorLease = registryBranch === null ? null : registry.leases?.[registryBranch] ?? null;
  const preservationReceiptDigests = readPreservationReceipts({
    commonDir, lease, target, branch, headSha, treeSha, normalizeDormantIntent,
  });
  const originUrl = git(root, ["remote", "get-url", "origin"]).trim();
  const remoteAuthority = readRemoteAuthority({
    originUrl, headSha, claimId: lease?.cloudAuthority?.claimId || null,
    ledgerRepository: configuredLedgerRepository, invokeCloudAction,
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
      clean: true, generatedResidue, unmergedEntries, operationMarkers,
      stateDigest: digestValue({
        targetStatus, generatedResidue, unmerged, operationMarkers, submodules,
      }),
    },
    authority: { ...authorityCore, authorityDigest: digestValue(authorityCore) },
    remoteBranch: { ref: branch, sha: branch === null ? null : remoteSha(root, branch, git) },
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function inspectRemoteAuthority({
  originUrl, ledgerRepository = null, headSha, claimId, invokeCloudAction,
}) {
  const targetRepository = githubRepository(originUrl);
  const resolvedLedgerRepository = ledgerRepository === null
    ? targetRepository
    : repositoryIdentity(ledgerRepository, "ledger repository");
  const result = invokeCloudAction({
    action: "status", ledgerRepository: resolvedLedgerRepository,
    request: { targetRepository },
  });
  const freshInventoryStatus = result?.status === "ready" || result?.status === "empty";
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "status" || !freshInventoryStatus
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
    ledgerRepository: resolvedLedgerRepository,
    targetRepository,
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
    const bundleRef = plan.evidence.target.branch ?? "HEAD";
    const bundleRoot = plan.evidence.target.branch === null
      ? plan.evidence.target.worktreePath : root;
    const branchHead = exactSha(git(bundleRoot, ["rev-parse", bundleRef]).trim(), "bundle source ref");
    if (branchHead !== plan.evidence.target.headSha) throw new Error("Cleanup source ref drifted before bundling.");
    const temporary = `${bundlePath}.tmp-${process.pid}-${process.hrtime.bigint()}`;
    try {
      git(bundleRoot, ["bundle", "create", temporary, bundleRef]);
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
  const expectedHeadRef = plan.evidence.target.branch ?? "HEAD";
  if (!heads.includes(`${plan.evidence.target.headSha} ${expectedHeadRef}`)) {
    throw new Error("Cleanup bundle does not preserve the exact source head.");
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
    headRef: expectedHeadRef,
    complete: true,
  };
  if (bundle && digestValue(bundle) !== digestValue(result)) throw new Error("Cleanup bundle drifted.");
  return Object.freeze(result);
}

function observeFinal({ root, plan, git, leaseStore, store }) {
  const state = store.inspectState(plan);
  const branch = cleanupReservationBranch(plan);
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
    branchHeadSha: plan.evidence.target.branch === null ? null
      : exactSha(git(root, ["rev-parse", plan.evidence.target.branch]).trim(), "final branch HEAD"),
    remoteBranchSha: plan.evidence.target.branch === null
      ? null : remoteSha(root, plan.evidence.target.branch, git),
  });
}

function cleanupReservationBranch(plan) {
  return plan.evidence.target.branch === null
    ? `agent/recoverable-cleanup/detached-${plan.subjectKey.slice(0, 16)}`
    : plan.evidence.target.branch.replace(/^refs\/heads\//u, "");
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
    if (journalIsProvenUnrelated(journal, { target, branch, headSha, treeSha })) continue;
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

function journalIsProvenUnrelated(journal, { target }) {
  const selected = journal?.intent?.planSnapshot?.sourceEvidence
    ?.preservation?.selectedLanes;
  if (!Array.isArray(selected)) return false;
  const subjects = selected.map(item => item?.worktree);
  if (!subjects.every(subject => typeof subject?.path === "string"
    && path.isAbsolute(subject.path) && path.normalize(subject.path) === subject.path)) return false;
  return !subjects.some(subject => subject.path === target);
}

function assertConfiguredRepositoryRouting({
  intent, explicitLedgerRepository, configuredTargetRepository,
}) {
  if (!intent) return null;
  const remote = intent?.plan?.evidence?.authority?.remoteAuthority;
  const ledgerMatches = explicitLedgerRepository
    ? remote?.ledgerRepository === explicitLedgerRepository
    : remote?.ledgerRepository === remote?.targetRepository;
  const targetMatches = configuredTargetRepository === null
    || remote?.targetRepository === configuredTargetRepository;
  if (!ledgerMatches || !targetMatches) {
    throw new Error("Cleanup ledger or target repository differs from the stored plan.");
  }
  return intent;
}

function githubRepository(originUrl) {
  const value = String(originUrl || "");
  const match = value.match(/^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/u);
  if (!match) throw new Error("GitHub reference mapping could not resolve the repository origin.");
  return repositoryIdentity(`${match[1]}/${match[2]}`, "target repository");
}
function repositoryIdentity(value, label) {
  const repository = typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`${label} must be an exact owner/name repository identity.`);
  }
  return repository;
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
function runGit(cwd, args, { input } = {}) {
  return execFileSync("git", args, {
    cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8", input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}
