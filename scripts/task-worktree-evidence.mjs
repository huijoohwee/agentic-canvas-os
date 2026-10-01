import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { createAdmissionLeaseProjection } from "./scoped-lane-admission-lib.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CLEAN_WORKTREE_DIGEST = digestValue({ status: "", workingFiles: [] });

export function deriveTaskWorktreeRoot(
  repoRoot,
  gitCommonDir = path.join(path.resolve(repoRoot), ".git"),
) {
  const repositoryOwnerRoot = path.dirname(path.resolve(gitCommonDir));
  return path.join(
    path.dirname(repositoryOwnerRoot),
    ".worktrees",
    path.basename(repositoryOwnerRoot),
  );
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

export function observeTaskWorktreeTarget({
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

export function requireCanonicalTaskSource({ gitText, status, headSha, baseSha }) {
  if (status) {
    throw new Error("Canonical main must be clean before task-worktree provisioning.");
  }
  if (headSha === baseSha) return "exact";
  try {
    gitText(["merge-base", "--is-ancestor", headSha, baseSha]);
  } catch {
    throw new Error(
      `Canonical main ${headSha} must be an ancestor of fetched origin/main ${baseSha}.`,
    );
  }
  return "preserved-behind";
}

export function assertNoSymlinkAncestors({
  workspaceRoot,
  target,
  pathExists,
  pathStat,
}) {
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
