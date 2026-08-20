import { existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { createAdmissionLeaseProjection } from "./scoped-lane-admission-lib.mjs";
import {
  cleanupEmptyTaskWorktreeContainers,
  deriveTaskWorktreeContainers,
} from "./task-worktree-owned-containers.mjs";

const SAFE_TASK_NAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CLEAN_WORKTREE_DIGEST = digestValue({ status: "", workingFiles: [] });

export function deriveTaskWorktreeRoot(repoRoot, gitCommonDir = path.join(path.resolve(repoRoot), ".git")) {
  return deriveTaskWorktreeContainers({ repoRoot, gitCommonDir }).managedContainer.root;
}

export function provisionTaskWorktree({
  invocationPath,
  repoRoot,
  targetPath,
  gitText,
  run,
  pathExists = existsSync,
  pathStat = lstatSync,
  makeDirectory = mkdirSync,
  expectedBaseSha = "",
  expectedTargetObservationDigest = "",
  fetchBase = true,
  allowDirtyCanonicalForRootBootstrap = false,
}) {
  const canonicalRoot = path.resolve(repoRoot);
  if (path.resolve(invocationPath) !== canonicalRoot) {
    throw new Error(`Provisioning must start at the canonical repository root ${canonicalRoot}.`);
  }
  const gitCommonDir = path.resolve(canonicalRoot, gitText(["rev-parse", "--git-common-dir"]).trim());
  const { safeRoot, target, workspaceRoot } = validateTarget({
    repoRoot: canonicalRoot,
    gitCommonDir,
    targetPath,
    pathExists,
    pathStat,
  });
  const beforeRegistry = gitText(["worktree", "list", "--porcelain", "-z"]);
  const before = parseWorktreeRecords(beforeRegistry);
  const canonical = before.find(record => path.resolve(record.path) === canonicalRoot);
  if (canonical?.branch !== "refs/heads/main") {
    throw new Error("Provisioning requires the registered canonical main worktree with main checked out.");
  }
  if (before.some(record => path.resolve(record.path) === target)) {
    throw new Error(`Task worktree target is already registered: ${target}`);
  }
  if (fetchBase) run("git", ["fetch", "origin", "main"]);
  const baseSha = gitText(["rev-parse", "origin/main"]).trim();
  if (expectedBaseSha && baseSha !== expectedBaseSha) {
    throw new Error(
      `Fetched origin/main changed after admission from ${expectedBaseSha} to ${baseSha}.`,
    );
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalSourceDisposition = requireCanonicalTaskSource({
    gitText,
    status: gitText(["status", "--porcelain"]).trim(),
    headSha,
    baseSha,
    allowDirtyCanonicalForRootBootstrap,
  });
  const targetObservation = observeTarget({
    target,
    safeRoot,
    baseSha,
    headSha,
    canonicalSourceDisposition,
    registry: beforeRegistry,
  });
  if (
    expectedTargetObservationDigest
    && targetObservation.targetObservationDigest
      !== expectedTargetObservationDigest
  ) {
    throw new Error("Task worktree target observation changed after admission.");
  }
  makeDirectory(safeRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkAncestors({ workspaceRoot, target, pathExists, pathStat });
  run("git", ["worktree", "add", "--detach", target, baseSha]);
  try {
    const afterRegistry = gitText(["worktree", "list", "--porcelain", "-z"]);
    const after = parseWorktreeRecords(afterRegistry);
    const candidate = assertCandidateRegistration({
      before,
      after,
      target,
      baseSha,
    });
    const baseTreeSha = gitText(["rev-parse", `${baseSha}^{tree}`]).trim();
    const targetHeadSha = gitText(["-C", target, "rev-parse", "HEAD"]).trim();
    const targetTreeSha = gitText(["-C", target, "rev-parse", "HEAD^{tree}"]).trim();
    const targetStatus = gitText([
      "-C", target, "status", "--porcelain=v1", "-z", "--untracked-files=all",
    ]);
    if (
      path.resolve(gitText(["-C", target, "rev-parse", "--show-toplevel"]).trim())
        !== target
      || targetHeadSha !== baseSha
      || targetTreeSha !== baseTreeSha
      || targetStatus
    ) {
      throw new Error(
        "Registered task worktree does not resolve to the clean detached candidate at the admitted base.",
      );
    }
    const beforeRegistrationInventoryDigest = digestValue(beforeRegistry);
    const afterRegistrationInventoryDigest = digestValue(afterRegistry);
    const operation = {
      schema: "agentic-candidate-create-register-result/v1",
      status: "created",
      operationId: digestValue({
        target,
        baseSha,
        baseTreeSha,
        expectedTargetObservationDigest:
          targetObservation.targetObservationDigest,
        beforeRegistrationInventoryDigest,
        afterRegistrationInventoryDigest,
      }),
      targetPath: target,
      baseSha,
      baseTreeSha,
      candidateRegistrationDigest: digestValue(candidate),
      expectedTargetObservationDigest:
        targetObservation.targetObservationDigest,
      beforeRegistrationInventoryDigest,
      afterRegistrationInventoryDigest,
      mutationSet: ["candidate-registration"],
    };
    return {
      baseSha,
      canonicalRoot,
      safeRoot,
      target,
      candidateCreateRegisterResult: {
        ...operation,
        resultDigest: digestValue(operation),
      },
    };
  } catch (error) {
    throw rollbackPostAddFailure({
      error,
      canonicalRoot,
      safeRoot,
      target,
      baseSha,
      gitText,
      run,
      pathExists,
    });
  }
}

export function inspectTaskWorktreeTarget({
  invocationPath,
  repoRoot,
  targetPath,
  gitText,
  pathExists = existsSync,
  pathStat = lstatSync,
  allowDirtyCanonicalForRootBootstrap = false,
}) {
  const canonicalRoot = path.resolve(repoRoot);
  if (path.resolve(invocationPath) !== canonicalRoot) {
    throw new Error(`Admission planning must start at the canonical repository root ${canonicalRoot}.`);
  }
  const gitCommonDir = path.resolve(
    canonicalRoot,
    gitText(["rev-parse", "--git-common-dir"]).trim(),
  );
  const target = validateTarget({
    repoRoot: canonicalRoot,
    gitCommonDir,
    targetPath,
    pathExists,
    pathStat,
  });
  const registry = gitText(["worktree", "list", "--porcelain", "-z"]);
  const records = parseWorktreeRecords(registry);
  const canonical = records.find(
    record => path.resolve(record.path) === canonicalRoot,
  );
  if (canonical?.branch !== "refs/heads/main") {
    throw new Error("Admission planning requires the registered canonical main worktree.");
  }
  if (records.some(record => path.resolve(record.path) === target.target)) {
    throw new Error(`Task worktree target is already registered: ${target.target}`);
  }
  const canonicalBaseSha = gitText(["rev-parse", "origin/main"]).trim();
  const canonicalHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalSourceDisposition = requireCanonicalTaskSource({
    gitText,
    status: gitText(["status", "--porcelain"]).trim(),
    headSha: canonicalHeadSha,
    baseSha: canonicalBaseSha,
    allowDirtyCanonicalForRootBootstrap,
  });
  return {
    ...target,
    canonicalBaseSha,
    canonicalHeadSha,
    canonicalSourceDisposition,
    ...observeTarget({
      target: target.target,
      safeRoot: target.safeRoot,
      baseSha: canonicalBaseSha,
      headSha: canonicalHeadSha,
      canonicalSourceDisposition,
      registry,
    }),
  };
}

export function recoverCandidateCreateRegisterResult({
  repoRoot,
  targetPath,
  expectedBaseSha,
  expectedBranch,
  expectedFenceSha,
  expectedScope,
  expectedLeaseEpoch,
  gitText,
}) {
  const canonicalRoot = path.resolve(repoRoot);
  const target = path.resolve(targetPath);
  const baseSha = requiredSha(expectedBaseSha, "recovery base SHA");
  const fenceSha = requiredSha(expectedFenceSha, "recovery fence SHA");
  const branch = String(expectedBranch || "").trim();
  const scope = String(expectedScope || "").trim();
  if (!branch || !scope || !Number.isInteger(expectedLeaseEpoch) || expectedLeaseEpoch < 1) {
    throw new Error("Recovery requires the exact branch, semantic scope, and local lease epoch.");
  }
  const gitCommonDir = path.resolve(
    canonicalRoot,
    gitText(["rev-parse", "--git-common-dir"]).trim(),
  );
  const safeRoot = deriveTaskWorktreeRoot(canonicalRoot, gitCommonDir);
  if (path.dirname(target) !== safeRoot) {
    throw new Error("Recovery target is outside the repository-owned task worktree root.");
  }
  const currentRegistry = gitText(["worktree", "list", "--porcelain", "-z"]);
  const currentRecords = splitWorktreeRegistryRecords(currentRegistry);
  const candidateRecords = currentRecords.filter(
    record => worktreeRecordPath(record) === target,
  );
  if (candidateRecords.length !== 1) {
    throw new Error("Recovery requires one exact registered candidate worktree.");
  }
  const parsedCandidate = parseWorktreeRecords(`${candidateRecords[0]}\0\0`)[0];
  const baseTreeSha = gitText(["rev-parse", `${baseSha}^{tree}`]).trim();
  const targetHeadSha = gitText(["-C", target, "rev-parse", "HEAD"]).trim();
  const targetTreeSha = gitText(["-C", target, "rev-parse", "HEAD^{tree}"]).trim();
  const targetBranch = gitText(["-C", target, "branch", "--show-current"]).trim();
  const targetStatus = gitText([
    "-C", target, "status", "--porcelain=v1", "-z", "--untracked-files=all",
  ]);
  const parentSha = gitText(["-C", target, "rev-parse", "HEAD^"]).trim();
  const commitSubject = gitText(["-C", target, "log", "-1", "--format=%s"]).trim();
  const commitCount = Number(gitText([
    "-C", target, "rev-list", "--count", `${baseSha}..${fenceSha}`,
  ]).trim());
  const remoteFence = gitText([
    "ls-remote", "origin", `refs/heads/${branch}`,
  ]).trim().split(/\s+/u)[0] || "";
  if (
    parsedCandidate?.head !== fenceSha
    || parsedCandidate.branch !== `refs/heads/${branch}`
    || targetHeadSha !== fenceSha
    || targetTreeSha !== baseTreeSha
    || targetBranch !== branch
    || targetStatus
    || parentSha !== baseSha
    || commitCount !== 1
    || commitSubject !== `chore(coordination): claim ${scope} lease ${expectedLeaseEpoch}`
    || remoteFence !== fenceSha
  ) {
    throw new Error(
      "Recovery candidate is not the exact clean, pushed, fence-only continuation of its admitted base.",
    );
  }
  const detachedRecord = [
    `worktree ${target}`,
    `HEAD ${baseSha}`,
    "detached",
  ].join("\0");
  const initialAfterRecords = currentRecords.map(
    record => worktreeRecordPath(record) === target ? detachedRecord : record,
  );
  const initialBeforeRecords = currentRecords.filter(
    record => worktreeRecordPath(record) !== target,
  );
  const beforeRegistry = renderWorktreeRegistry(initialBeforeRecords);
  const afterRegistry = renderWorktreeRegistry(initialAfterRecords);
  const canonicalHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalSourceDisposition = requireCanonicalTaskSource({
    gitText,
    status: gitText(["status", "--porcelain"]).trim(),
    headSha: canonicalHeadSha,
    baseSha,
  });
  const targetObservation = observeTarget({
    target,
    safeRoot,
    baseSha,
    headSha: canonicalHeadSha,
    canonicalSourceDisposition,
    registry: beforeRegistry,
  });
  const detachedCandidate = {
    path: target,
    head: baseSha,
    detached: true,
  };
  const beforeRegistrationInventoryDigest = digestValue(beforeRegistry);
  const afterRegistrationInventoryDigest = digestValue(afterRegistry);
  const operation = {
    schema: "agentic-candidate-create-register-result/v1",
    status: "created",
    operationId: digestValue({
      target,
      baseSha,
      baseTreeSha,
      expectedTargetObservationDigest: targetObservation.targetObservationDigest,
      beforeRegistrationInventoryDigest,
      afterRegistrationInventoryDigest,
    }),
    targetPath: target,
    baseSha,
    baseTreeSha,
    candidateRegistrationDigest: digestValue(detachedCandidate),
    expectedTargetObservationDigest: targetObservation.targetObservationDigest,
    beforeRegistrationInventoryDigest,
    afterRegistrationInventoryDigest,
    mutationSet: ["candidate-registration"],
  };
  return Object.freeze({ ...operation, resultDigest: digestValue(operation) });
}

export function rollbackUnclaimedProvision({
  provision,
  candidateUnclaimed,
  registryUnchanged,
  gitText,
  run,
  pathExists = existsSync,
  cleanupContainers = cleanupEmptyTaskWorktreeContainers,
}) {
  const unclaimed = candidateUnclaimed ?? registryUnchanged;
  if (!provision || !unclaimed || !pathExists(provision.target)) return false;
  const records = parseWorktreeRecords(gitText(["worktree", "list", "--porcelain", "-z"]));
  const created = records.find(record => path.resolve(record.path) === provision.target);
  if (!created?.detached || created.branch) return false;
  if (gitText(["-C", provision.target, "status", "--porcelain"]).trim()) return false;
  if (gitText(["-C", provision.target, "rev-parse", "HEAD"]).trim() !== provision.baseSha) return false;
  const rawGitCommonDir = gitText(["rev-parse", "--git-common-dir"]).trim();
  const repositoryRoot = provision.canonicalRoot
    || path.dirname(path.resolve(process.cwd(), rawGitCommonDir));
  const gitCommonDir = path.resolve(repositoryRoot, rawGitCommonDir);
  run("git", ["worktree", "remove", provision.target]);
  cleanupContainers({
    repoRoot: repositoryRoot,
    gitCommonDir,
    targetPath: provision.target,
  });
  return true;
}

function rollbackPostAddFailure({
  error,
  canonicalRoot,
  safeRoot,
  target,
  baseSha,
  gitText,
  run,
  pathExists,
}) {
  try {
    const removed = rollbackUnclaimedProvision({
      provision: { canonicalRoot, safeRoot, target, baseSha },
      candidateUnclaimed: true,
      gitText,
      run,
      pathExists,
    });
    if (removed) {
      return new Error(
        `${error.message}; automatic rollback removed the clean detached exact-base candidate.`,
        { cause: error },
      );
    }
    return new Error(
      `${error.message}; automatic rollback could not safely re-prove the candidate, so it was retained at ${target}; preserve it and perform owner-led recovery.`,
      { cause: error },
    );
  } catch (rollbackError) {
    return new Error(
      `${error.message}; automatic rollback retained the candidate at ${target} after cleanup failed: ${rollbackError.message}; preserve it and perform owner-led recovery.`,
      { cause: error },
    );
  }
}

export function verifyCandidateProvisionEvidence({
  report,
  lease,
  candidate,
  operation,
}) {
  assertCandidateOperation({ report, lease, result: operation });
  const expectedAdmission = createAdmissionLeaseProjection(report);
  if (
    lease?.sessionId !== lease.cloudAuthority?.sessionId
    || lease.device !== lease.cloudAuthority?.deviceId
    || lease.scope !== report.candidate.semanticScope
    || lease.branch !== report.candidate.branch
    || path.resolve(lease.worktreePath || "") !== report.candidate.targetPath
    || digestValue(lease.admission) !== digestValue(expectedAdmission)
  ) {
    throw new Error(
      "Candidate lease identity, admission, or cloud projection does not join the admitted plan.",
    );
  }
  const evidence = {
    leaseDigest: digestValue(lease),
    admissionDigest: digestValue(lease.admission),
    cloudAuthorityDigest: digestValue(lease.cloudAuthority),
  };
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Preservation verification cannot find the candidate lane.");
  }
  const { stateDigest, ...state } = candidate;
  if (
    digestValue(state) !== stateDigest
    || candidate.branch !== `refs/heads/${report.candidate.branch}`
    || candidate.head !== lease.fenceSha
    || candidate.treeSha !== operation.baseTreeSha
    || candidate.dirty
    || candidate.workingTreeDigest !== CLEAN_WORKTREE_DIGEST
    || digestValue(candidate.lease) !== evidence.leaseDigest
  ) {
    throw new Error(
      "Candidate contains pre-authoring bytes or does not exactly join its lease and registration result.",
    );
  }
  return evidence;
}

export function assertPreservationReceiptIntegrity({
  receipt,
  report,
  lease,
  cloudAuthority,
  verification,
}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Admission finalization requires a Preservation Receipt.");
  }
  const { receiptDigest, ...core } = receipt;
  const expected = {
    schema: "agentic-lane-preservation-result/v1",
    status: "preserved",
    admissionReceiptDigest: report.admissionReceipt?.receiptDigest,
    candidateCreateRegisterResultDigest:
      receipt.candidateCreateRegisterResultDigest,
    existingLaneStateDigest: report.existingLaneStateDigest,
    candidateStateDigest: receipt.candidateStateDigest,
    candidateLeaseDigest: digestValue(lease),
    finalRemoteClaimInventoryDigest:
      verification?.remoteClaimInventoryDigest,
    finalLedgerRevision: verification?.ledgerRevision,
    finalLedgerDigest: verification?.ledgerDigest,
    cloudVerificationReceiptDigest: verification?.receiptDigest,
    preservedPaths: report.lanes.map(lane => lane.path).sort(),
    peerDisposition: "unchanged",
    causality: "candidate-only",
  };
  if (
    !DIGEST_PATTERN.test(String(receipt.candidateCreateRegisterResultDigest || ""))
    || !DIGEST_PATTERN.test(String(receipt.candidateStateDigest || ""))
    || !DIGEST_PATTERN.test(String(receiptDigest || ""))
    || digestValue(lease?.admission)
      !== digestValue(createAdmissionLeaseProjection(report))
    || digestValue(lease?.cloudAuthority) !== digestValue(cloudAuthority)
    || digestValue(core) !== receiptDigest
    || digestValue(core) !== digestValue(expected)
  ) {
    throw new Error(
      "Admission finalization requires the cryptographically joined current Preservation Receipt.",
    );
  }
}

function validateTarget({ repoRoot, gitCommonDir, targetPath, pathExists, pathStat }) {
  if (!targetPath) throw new Error("--worktree=<absolute-new-task-worktree> is required with --provision.");
  if (!path.isAbsolute(targetPath)) throw new Error("Provisioned task worktree path must be absolute.");
  const target = path.resolve(targetPath);
  const safeRoot = deriveTaskWorktreeRoot(repoRoot, gitCommonDir);
  const workspaceRoot = path.dirname(path.dirname(gitCommonDir));
  if (path.dirname(target) !== safeRoot || !SAFE_TASK_NAME.test(path.basename(target))) {
    throw new Error(`Task worktree must be a safe direct child of ${safeRoot}.`);
  }
  if (pathExists(target)) throw new Error(`Task worktree target already exists: ${target}`);
  assertNoSymlinkAncestors({ workspaceRoot, target, pathExists, pathStat });
  return { safeRoot, target, workspaceRoot };
}

function assertCandidateOperation({ report, lease, result }) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Preservation requires the candidate create/register result.");
  }
  const { resultDigest, ...core } = result;
  if (
    !SHA_PATTERN.test(String(result.baseTreeSha || ""))
    || !DIGEST_PATTERN.test(String(result.operationId || ""))
    || !DIGEST_PATTERN.test(String(result.candidateRegistrationDigest || ""))
    || !DIGEST_PATTERN.test(String(result.beforeRegistrationInventoryDigest || ""))
    || !DIGEST_PATTERN.test(String(result.afterRegistrationInventoryDigest || ""))
    || !DIGEST_PATTERN.test(String(resultDigest || ""))
  ) {
    throw new Error(
      "Candidate create/register result is missing its cryptographic registry evidence.",
    );
  }
  const operationId = digestValue({
    target: result.targetPath,
    baseSha: result.baseSha,
    baseTreeSha: result.baseTreeSha,
    expectedTargetObservationDigest:
      result.expectedTargetObservationDigest,
    beforeRegistrationInventoryDigest:
      result.beforeRegistrationInventoryDigest,
    afterRegistrationInventoryDigest:
      result.afterRegistrationInventoryDigest,
  });
  if (
    result.schema !== "agentic-candidate-create-register-result/v1"
    || result.status !== "created"
    || result.targetPath !== report.candidate.targetPath
    || result.baseSha !== report.canonicalBaseSha
    || result.expectedTargetObservationDigest
      !== report.admissionReceipt.targetObservationDigest
    || JSON.stringify(result.mutationSet)
      !== JSON.stringify(["candidate-registration"])
    || result.operationId !== operationId
    || result.beforeRegistrationInventoryDigest
      === result.afterRegistrationInventoryDigest
    || path.resolve(lease?.worktreePath || "") !== report.candidate.targetPath
    || lease?.baseSha !== report.canonicalBaseSha
    || digestValue(core) !== resultDigest
  ) {
    throw new Error(
      "Candidate create/register result does not join its Admission Receipt and local lease.",
    );
  }
}

function observeTarget({
  target,
  safeRoot,
  baseSha,
  headSha,
  canonicalSourceDisposition,
  registry,
}) {
  const observation = {
    schema: "agentic-task-worktree-target-observation/v1",
    targetPath: target,
    safeRoot,
    canonicalBaseSha: baseSha,
    canonicalHeadSha: headSha,
    canonicalSourceDisposition,
    registrationInventoryDigest: digestValue(registry),
    occupied: false,
  };
  return {
    targetObservation: observation,
    targetObservationDigest: digestValue(observation),
  };
}

function requireCanonicalTaskSource({
  gitText,
  status,
  headSha,
  baseSha,
  allowDirtyCanonicalForRootBootstrap,
}) {
  const dirty = Boolean(status);
  if (dirty && !allowDirtyCanonicalForRootBootstrap) {
    throw new Error("Canonical main must be clean before task-worktree provisioning.");
  }
  if (headSha === baseSha) return dirty ? "root-bootstrap-dirty" : "exact";
  try {
    gitText(["merge-base", "--is-ancestor", headSha, baseSha]);
  } catch {
    throw new Error(
      `Canonical main ${headSha} must be an ancestor of fetched origin/main ${baseSha}.`,
    );
  }
  return dirty ? "root-bootstrap-dirty" : "preserved-behind";
}

function assertCandidateRegistration({ before, after, target, baseSha }) {
  const beforePaths = new Set(before.map(record => path.resolve(record.path)));
  const afterPaths = new Set(after.map(record => path.resolve(record.path)));
  const candidates = after.filter(record => path.resolve(record.path) === target);
  const existingUnchanged = before.every(record => {
    const matches = after.filter(
      candidate => path.resolve(candidate.path) === path.resolve(record.path),
    );
    return matches.length === 1 && digestValue(matches[0]) === digestValue(record);
  });
  const candidate = candidates[0];
  if (
    beforePaths.size !== before.length
    || afterPaths.size !== after.length
    || after.length !== before.length + 1
    || candidates.length !== 1
    || beforePaths.has(target)
    || !existingUnchanged
    || candidate.head !== baseSha
    || !candidate.detached
    || candidate.branch
    || candidate.bare
    || candidate.locked
    || candidate.prunable
  ) {
    throw new Error(
      "Worktree registry changed by more than the single detached candidate registration.",
    );
  }
  return candidate;
}

function splitWorktreeRegistryRecords(registry) {
  const withoutTerminator = registry.endsWith("\0\0")
    ? registry.slice(0, -2)
    : registry;
  return withoutTerminator ? withoutTerminator.split("\0\0") : [];
}

function renderWorktreeRegistry(records) {
  return records.length > 0 ? `${records.join("\0\0")}\0\0` : "";
}

function worktreeRecordPath(record) {
  const firstField = String(record || "").split("\0", 1)[0];
  if (!firstField.startsWith("worktree ")) return "";
  return path.resolve(firstField.slice("worktree ".length));
}

function requiredSha(value, label) {
  const normalized = String(value || "").trim();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase 40-character SHA.`);
  }
  return normalized;
}

function assertNoSymlinkAncestors({ repoRoot, workspaceRoot = path.dirname(path.resolve(repoRoot)), target, pathExists, pathStat }) {
  const boundary = path.resolve(workspaceRoot);
  const relative = path.relative(boundary, path.dirname(target));
  let candidate = boundary;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) candidate = path.join(candidate, segment);
    if (pathExists(candidate) && pathStat(candidate).isSymbolicLink()) {
      throw new Error(`Task worktree root cannot traverse a symbolic link: ${candidate}`);
    }
  }
}
