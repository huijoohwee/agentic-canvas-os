import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import {
  deriveTaskWorktreeRoot,
  observeTaskWorktreeTarget,
  requireCanonicalTaskSource,
} from "./task-worktree-evidence.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function projectTaskWorktreeAdmissionSource({
  observed,
  targetPlan,
  lanes = observed?.lanes,
}) {
  if (
    !observed
    || !targetPlan
    || !["exact", "preserved-behind"].includes(
      targetPlan.canonicalSourceDisposition,
    )
    || !SHA_PATTERN.test(String(targetPlan.canonicalBaseSha || ""))
    || !SHA_PATTERN.test(String(targetPlan.canonicalHeadSha || ""))
    || !Array.isArray(lanes)
  ) {
    throw new Error("Task-worktree admission source is incomplete or unclassified.");
  }
  return deepFreeze({
    ...structuredClone(observed),
    canonicalBaseSha: targetPlan.canonicalBaseSha,
    canonicalHeadSha: targetPlan.canonicalHeadSha,
    canonicalSourceDisposition: targetPlan.canonicalSourceDisposition,
    lanes: structuredClone(lanes),
  });
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
  if (!path.isAbsolute(targetPath || "")) {
    throw new Error("Recovery requires an absolute task worktree path.");
  }
  const target = path.resolve(targetPath);
  const baseSha = requiredSha(expectedBaseSha, "recovery base SHA");
  const fenceSha = requiredSha(expectedFenceSha, "recovery fence SHA");
  const branch = String(expectedBranch || "").trim();
  const scope = String(expectedScope || "").trim();
  const branchIdentity = parseDeviceBranch(branch);
  if (
    !branchIdentity
    || !scope
    || branchIdentity.scope !== scope
    || !Number.isInteger(expectedLeaseEpoch)
    || expectedLeaseEpoch < 1
  ) {
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
  const parsedRecords = currentRecords.map(
    record => parseWorktreeRecords(`${record}\0\0`)[0],
  );
  const recordPaths = parsedRecords.map(record => path.resolve(record?.path || ""));
  const canonicalRecords = parsedRecords.filter(
    record => path.resolve(record?.path || "") === canonicalRoot,
  );
  const canonicalRecord = canonicalRecords[0];
  if (
    parsedRecords.some(record => !record)
    || new Set(recordPaths).size !== recordPaths.length
    || canonicalRecords.length !== 1
    || canonicalRecord.branch !== "refs/heads/main"
    || !SHA_PATTERN.test(String(canonicalRecord.head || ""))
    || canonicalRecord.detached
    || canonicalRecord.bare
    || canonicalRecord.locked
    || canonicalRecord.prunable
  ) {
    throw new Error("Recovery requires one live registered canonical-main source worktree.");
  }
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
    || parsedCandidate.detached
    || parsedCandidate.bare
    || parsedCandidate.locked
    || parsedCandidate.prunable
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
  if (canonicalRecord.head !== canonicalHeadSha) {
    throw new Error("Recovery canonical-main registry HEAD changed or is inconsistent.");
  }
  const canonicalStatus = gitText(["status", "--porcelain"]).trim();
  const canonicalSourceDisposition = requireCanonicalTaskSource({
    gitText,
    status: canonicalStatus,
    headSha: canonicalHeadSha,
    baseSha,
  });
  const targetObservation = observeTaskWorktreeTarget({
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
  if (
    gitText(["worktree", "list", "--porcelain", "-z"]) !== currentRegistry
    || gitText(["rev-parse", "HEAD"]).trim() !== canonicalHeadSha
    || gitText(["status", "--porcelain"]).trim() !== canonicalStatus
    || gitText(["-C", target, "rev-parse", "HEAD"]).trim() !== targetHeadSha
    || gitText(["-C", target, "rev-parse", "HEAD^{tree}"]).trim() !== targetTreeSha
    || gitText(["-C", target, "branch", "--show-current"]).trim() !== targetBranch
    || gitText([
      "-C", target, "status", "--porcelain=v1", "-z", "--untracked-files=all",
    ]) !== targetStatus
  ) {
    throw new Error("Recovery worktree registry, HEAD, branch, tree, or bytes changed during proof.");
  }
  return Object.freeze({ ...operation, resultDigest: digestValue(operation) });
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

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
