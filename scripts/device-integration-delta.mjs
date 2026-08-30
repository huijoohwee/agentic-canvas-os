import { createHash } from "node:crypto";

import { assertPathsAdmitted } from "./active-publish-write-scope.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const DEVICE_INTEGRATION_DELTA_SCHEMA =
  "agentic-device-integration-delta/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function listIntegrationWorkingTreePaths({ gitText } = {}) {
  requireGitText(gitText);
  return canonicalPaths([
    ...splitNul(gitText([
      "diff", "--name-only", "--no-renames", "-z", "HEAD", "--",
    ])),
    ...splitNul(gitText(["ls-files", "--others", "--exclude-standard", "-z"])),
  ]);
}

export function listIntegrationUnstagedPaths({ gitText } = {}) {
  requireGitText(gitText);
  return canonicalPaths([
    ...splitNul(gitText([
      "diff", "--name-only", "--no-renames", "-z", "--",
    ])),
    ...splitNul(gitText(["ls-files", "--others", "--exclude-standard", "-z"])),
  ]);
}

export function captureStagedIntegrationDelta({
  gitText,
  parentSha,
  approvedPaths,
  admission,
} = {}) {
  requireGitText(gitText);
  const parent = requireSha(parentSha, "Staged integration parent");
  const observedHead = requireSha(
    String(gitText(["rev-parse", "HEAD"]) || "").trim(),
    "Staged integration observed HEAD",
  );
  if (observedHead !== parent) {
    throw new Error("Staged integration parent changed before delta capture.");
  }
  const treeSha = requireSha(
    String(gitText(["write-tree"]) || "").trim(),
    "Staged integration tree",
  );
  const paths = listRangePaths({ gitText, parentSha: parent, cached: true });
  requireNonemptyPaths(paths, "Staged integration");
  requireExactPaths(paths, approvedPaths, "Staged integration");
  assertPathsAdmitted({
    paths,
    admission,
    subject: "Staged integration delta",
  });
  return createDeltaReceipt({
    parentSha: parent,
    treeSha,
    paths,
    rawDelta: gitText([
      "diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "-z",
      parent, "--",
    ]),
    binaryDelta: gitText(["diff", "--cached", "--binary", parent, "--"]),
  });
}

export function sealCommittedIntegrationDelta({
  gitText,
  stagedDelta,
  admission,
} = {}) {
  requireGitText(gitText);
  const expected = normalizeDeltaReceipt(stagedDelta, "Staged integration delta");
  const commitSha = requireSha(
    String(gitText(["rev-parse", "HEAD"]) || "").trim(),
    "Committed integration HEAD",
  );
  const lineage = String(gitText([
    "rev-list", "--parents", "-n", "1", commitSha,
  ]) || "").trim().split(/\s+/u);
  if (
    lineage.length !== 2
    || lineage[0] !== commitSha
    || lineage[1] !== expected.parentSha
  ) {
    throw new Error(
      "Committed integration must have exactly the sealed precommit HEAD as its only parent.",
    );
  }
  const committed = captureRangeDelta({
    gitText,
    parentSha: expected.parentSha,
    headSha: commitSha,
    admission,
    requireClean: true,
  });
  if (committed.treeSha !== expected.treeSha) {
    throw new Error("Committed integration tree changed from the sealed staged tree.");
  }
  if (canonicalJson(committed.paths) !== canonicalJson(expected.paths)) {
    throw new Error("Committed integration paths changed from the sealed staged delta.");
  }
  if (committed.structuralDeltaDigest !== expected.structuralDeltaDigest) {
    throw new Error("Committed integration structural delta changed after staged capture.");
  }
  if (committed.stagedDiffDigest !== expected.stagedDiffDigest) {
    throw new Error("Committed integration binary delta changed after staged capture.");
  }
  return Object.freeze({ ...committed, commitSha });
}

export function captureCommittedIntegrationDelta({
  gitText,
  parentSha,
  headSha,
  admission,
} = {}) {
  requireGitText(gitText);
  const parent = requireSha(parentSha, "Committed integration range parent");
  const head = requireSha(headSha, "Committed integration range head");
  const observedHead = requireSha(
    String(gitText(["rev-parse", "HEAD"]) || "").trim(),
    "Committed integration observed HEAD",
  );
  if (observedHead !== head) {
    throw new Error("Committed integration range is not attached at the current HEAD.");
  }
  const lineage = String(gitText([
    "rev-list", "--parents", "-n", "1", head,
  ]) || "").trim().split(/\s+/u);
  if (lineage.length !== 2 || lineage[0] !== head || lineage[1] !== parent) {
    throw new Error(
      "Clean precommitted integration must be one exact commit whose only parent is the writer fence.",
    );
  }
  return captureRangeDelta({
    gitText,
    parentSha: parent,
    headSha: head,
    admission,
    requireClean: true,
  });
}

export function listIntegrationRangePaths({ gitText, parentSha, headSha } = {}) {
  requireGitText(gitText);
  const parent = requireSha(parentSha, "Integration range parent");
  const head = requireSha(headSha, "Integration range head");
  return canonicalPaths(splitNul(gitText([
    "diff", "--name-only", "--no-renames", "-z", `${parent}..${head}`, "--",
  ])));
}

// agentic-integration-commit/v1 predates canonical no-rename path evidence. Keep
// its folded path projection only for strict replay compatibility; admission and
// delta sealing must use listIntegrationRangePaths() instead.
export function projectLegacyIntegrationPaths({ gitText, parentSha, headSha } = {}) {
  requireGitText(gitText);
  const parent = requireSha(parentSha, "Legacy integration range parent");
  const head = requireSha(headSha, "Legacy integration range head");
  return canonicalPaths(splitNul(gitText([
    "diff", "--name-only", "-z", parent, head, "--",
  ])));
}

export function refreshTaskBranchFromMain({
  repo,
  gitText,
  run,
  runText,
  refreshMessage,
  branch,
  leaseEpoch,
  expectedHeadSha,
} = {}) {
  requireGitText(gitText);
  if (String(gitText(["status", "--porcelain"]) || "").trim()) {
    throw new Error("Integration commit did not leave a clean task worktree.");
  }
  const sourceHeadSha = requireSha(
    expectedHeadSha,
    "Protected-main refresh sealed source HEAD",
  );
  const preMergeHeadSha = requireSha(
    String(gitText(["rev-parse", "HEAD"]) || "").trim(),
    "Protected-main refresh pre-merge HEAD",
  );
  run("git", ["fetch", "origin", "main"]);
  const targetMainSha = requireSha(
    String(gitText(["rev-parse", "origin/main"]) || "").trim(),
    "Protected-main refresh target main",
  );
  if (String(gitText(["rev-parse", "HEAD"]) || "").trim() !== preMergeHeadSha) {
    throw new Error("Protected-main refresh HEAD changed while pinning origin/main.");
  }
  captureRefreshChain({
    gitText,
    runText,
    repo,
    sourceHeadSha,
    refreshedHeadSha: preMergeHeadSha,
    targetMainSha,
  });
  const expectedTreeSha = requireSha(
    String(runText("git", [
      "merge-tree", "--write-tree", "--no-messages", preMergeHeadSha, targetMainSha,
    ], { cwd: repo })).trim().split(/\s+/u)[0],
    "Protected-main refresh expected tree",
  );
  const mergeBaseSha = requireSha(
    String(gitText(["merge-base", preMergeHeadSha, targetMainSha]) || "").trim(),
    "Protected-main refresh merge base",
  );
  let refreshedHeadSha = preMergeHeadSha;
  let status = "current";
  if (mergeBaseSha !== targetMainSha) {
    run("git", ["merge", "--no-ff", "-m", requiredText(refreshMessage), targetMainSha]);
    refreshedHeadSha = requireSha(
      String(gitText(["rev-parse", "HEAD"]) || "").trim(),
      "Protected-main refreshed HEAD",
    );
    const parents = String(gitText([
      "rev-list", "--parents", "-n", "1", refreshedHeadSha,
    ]) || "").trim().split(/\s+/u);
    if (parents.length !== 3 || parents[0] !== refreshedHeadSha ||
        parents[1] !== preMergeHeadSha || parents[2] !== targetMainSha) {
      throw new Error("Protected-main refresh did not create the exact pinned two-parent merge.");
    }
    status = "refreshed";
  }
  const treeSha = requireSha(
    String(gitText(["rev-parse", `${refreshedHeadSha}^{tree}`]) || "").trim(),
    "Protected-main refreshed tree",
  );
  if (treeSha !== expectedTreeSha) {
    throw new Error("Protected-main refresh tree differs from the exact pinned merge tree.");
  }
  if (String(gitText(["status", "--porcelain"]) || "").trim()) {
    throw new Error("Protected-main refresh did not leave a clean task worktree.");
  }
  const paths = canonicalPaths(splitNul(gitText([
    "diff", "--name-only", "--no-renames", "-z", `${targetMainSha}..${refreshedHeadSha}`, "--",
  ])));
  const refreshChain = captureRefreshChain({
    gitText,
    runText,
    repo,
    sourceHeadSha,
    refreshedHeadSha,
    targetMainSha,
  });
  const receipt = Object.freeze({
    schema: "agentic-task-branch-main-refresh/v1",
    status,
    branch: requiredText(branch),
    leaseEpoch: requirePositiveInteger(leaseEpoch),
    sourceHeadSha,
    preMergeHeadSha,
    targetMainSha,
    refreshedHeadSha,
    treeSha,
    paths: Object.freeze(paths),
    pathsDigest: digestValue(paths),
    refreshCommitCount: refreshChain.length,
    refreshChainDigest: digestValue(refreshChain),
  });
  return verifyTaskBranchMainRefresh({
    gitText,
    runText,
    repo,
    receipt: Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) }),
    expectedHeadSha: sourceHeadSha,
    branch,
    leaseEpoch,
  });
}

export function verifyTaskBranchMainRefresh({
  gitText, runText, repo, receipt, expectedHeadSha, branch, leaseEpoch,
} = {}) {
  requireGitText(gitText);
  const sourceHeadSha = requireSha(expectedHeadSha, "Protected-main refresh sealed source HEAD");
  const currentHeadSha = requireSha(
    String(gitText(["rev-parse", "HEAD"]) || "").trim(),
    "Protected-main refresh current HEAD",
  );
  const targetMainSha = requireSha(receipt?.targetMainSha, "Protected-main refresh target main");
  const treeSha = requireSha(
    String(gitText(["rev-parse", `${currentHeadSha}^{tree}`]) || "").trim(),
    "Protected-main refresh current tree",
  );
  const paths = canonicalPaths(splitNul(gitText([
    "diff", "--name-only", "--no-renames", "-z", `${targetMainSha}..${currentHeadSha}`, "--",
  ])));
  const refreshChain = captureRefreshChain({
    gitText, runText, repo, sourceHeadSha, refreshedHeadSha: currentHeadSha, targetMainSha,
  });
  const core = {
    schema: "agentic-task-branch-main-refresh/v1",
    status: requiredText(receipt?.status),
    branch: requiredText(branch),
    leaseEpoch: requirePositiveInteger(leaseEpoch),
    sourceHeadSha,
    preMergeHeadSha: requireSha(receipt?.preMergeHeadSha, "Protected-main refresh pre-merge HEAD"),
    targetMainSha,
    refreshedHeadSha: currentHeadSha,
    treeSha,
    paths: Object.freeze(paths),
    pathsDigest: digestValue(paths),
    refreshCommitCount: refreshChain.length,
    refreshChainDigest: digestValue(refreshChain),
  };
  if (digestValue(core) !== receipt?.receiptDigest ||
      digestValue(receipt) !== digestValue({ ...core, receiptDigest: digestValue(core) })) {
    throw new Error("Protected-main refresh receipt no longer matches its exact Git chain.");
  }
  if (String(gitText(["status", "--porcelain"]) || "").trim()) {
    throw new Error("Protected-main refresh receipt requires a clean task worktree.");
  }
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function captureRefreshChain({
  gitText, runText, repo, sourceHeadSha, refreshedHeadSha, targetMainSha,
}) {
  const steps = [];
  let cursor = refreshedHeadSha;
  while (cursor !== sourceHeadSha) {
    if (steps.length >= 100) throw new Error("Protected-main refresh chain exceeds its safe bound.");
    const parents = String(gitText([
      "rev-list", "--parents", "-n", "1", cursor,
    ]) || "").trim().split(/\s+/u);
    if (parents.length !== 3 || parents[0] !== cursor) {
      throw new Error("Protected-main refresh chain contains an unsealed authored commit.");
    }
    const [, firstParentSha, protectedParentSha] = parents;
    gitText(["merge-base", "--is-ancestor", protectedParentSha, targetMainSha]);
    const expectedTreeSha = requireSha(
      String(runText("git", [
        "merge-tree", "--write-tree", "--no-messages", firstParentSha, protectedParentSha,
      ], { cwd: repo })).trim().split(/\s+/u)[0],
      "Protected-main refresh replay tree",
    );
    const treeSha = requireSha(
      String(gitText(["rev-parse", `${cursor}^{tree}`]) || "").trim(),
      "Protected-main refresh replay commit tree",
    );
    if (treeSha !== expectedTreeSha) {
      throw new Error("Protected-main refresh replay tree differs from its pinned parent merge.");
    }
    steps.push(Object.freeze({ commitSha: cursor, firstParentSha, protectedParentSha, treeSha }));
    cursor = firstParentSha;
  }
  return Object.freeze(steps.reverse());
}

function captureRangeDelta({
  gitText,
  parentSha,
  headSha,
  admission,
  requireClean,
}) {
  const treeSha = requireSha(
    String(gitText(["rev-parse", `${headSha}^{tree}`]) || "").trim(),
    "Committed integration tree",
  );
  const paths = listRangePaths({ gitText, parentSha, headSha });
  requireNonemptyPaths(paths, "Committed integration");
  assertPathsAdmitted({
    paths,
    admission,
    subject: "Committed integration delta",
  });
  const delta = createDeltaReceipt({
    parentSha,
    treeSha,
    paths,
    rawDelta: gitText([
      "diff", "--raw", "--no-abbrev", "--no-renames", "-z",
      parentSha, headSha, "--",
    ]),
    binaryDelta: gitText(["diff", "--binary", parentSha, headSha, "--"]),
  });
  if (requireClean && String(gitText([
    "status", "--porcelain", "--untracked-files=all",
  ]) || "") !== "") {
    throw new Error("Committed integration did not leave an exact clean worktree.");
  }
  return delta;
}

function listRangePaths({ gitText, parentSha, headSha = null, cached = false }) {
  const args = ["diff"];
  if (cached) args.push("--cached");
  args.push("--name-only", "--no-renames", "-z", parentSha);
  if (headSha) args.push(headSha);
  args.push("--");
  return canonicalPaths(splitNul(gitText(args)));
}

function createDeltaReceipt({ parentSha, treeSha, paths, rawDelta, binaryDelta }) {
  const rawDeltaDigest = sha256(rawDelta);
  const structuralCore = {
    schema: "agentic-device-integration-structural-delta/v1",
    parentSha,
    treeSha,
    paths,
    rawDeltaDigest,
  };
  return Object.freeze({
    schema: DEVICE_INTEGRATION_DELTA_SCHEMA,
    parentSha,
    treeSha,
    paths: Object.freeze([...paths]),
    rawDeltaDigest,
    structuralDeltaDigest: sha256(canonicalJson(structuralCore)),
    stagedDiffDigest: sha256(binaryDelta),
  });
}

function normalizeDeltaReceipt(value, label) {
  const paths = canonicalPaths(value?.paths || []);
  if (
    value?.schema !== DEVICE_INTEGRATION_DELTA_SCHEMA
    || !SHA_PATTERN.test(String(value.parentSha || ""))
    || !SHA_PATTERN.test(String(value.treeSha || ""))
    || !DIGEST_PATTERN.test(String(value.rawDeltaDigest || ""))
    || !DIGEST_PATTERN.test(String(value.structuralDeltaDigest || ""))
    || !DIGEST_PATTERN.test(String(value.stagedDiffDigest || ""))
    || canonicalJson(paths) !== canonicalJson(value.paths)
  ) {
    throw new Error(`${label} is malformed.`);
  }
  requireNonemptyPaths(paths, label);
  return value;
}

function canonicalPaths(paths) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || !path)) {
    throw new Error("Integration changed-path output is malformed.");
  }
  return [...new Set(paths)].sort();
}

function requireExactPaths(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(canonicalPaths(expected || []))) {
    throw new Error(`${label} paths differ from the exact approved paths.`);
  }
}

function requireNonemptyPaths(paths, label) {
  if (paths.length === 0) throw new Error(`${label} has no authored path delta.`);
}

function requireGitText(gitText) {
  if (typeof gitText !== "function") {
    throw new Error("Integration delta capture requires gitText().");
  }
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase commit SHA.`);
  }
  return value;
}

function requiredText(value) {
  const text = String(value || "").normalize("NFC").trim();
  if (!text) throw new Error("Protected-main refresh requires non-empty text identity.");
  return text;
}

function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Protected-main refresh requires a positive lease epoch.");
  }
  return value;
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(value);
}
