import test from "node:test";
import assert from "node:assert/strict";

import {
  projectTaskWorktreeAdmissionSource,
  recoverCandidateCreateRegisterResult,
} from "../scripts/task-worktree-recovery.mjs";

const canonicalRoot = "/workspace/repository";
const target = "/workspace/.worktrees/repository/recovered-scope";
const branch = "agent/device/recovered-scope";
const scope = "recovered-scope";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const treeSha = "c".repeat(40);

function registry({ candidateMarker = "", canonicalRegistryHead = baseSha } = {}) {
  return [
    `worktree ${canonicalRoot}\0HEAD ${canonicalRegistryHead}\0branch refs/heads/main`,
    `worktree ${target}\0HEAD ${fenceSha}\0branch refs/heads/${branch}${candidateMarker}`,
  ].join("\0\0") + "\0\0";
}

function gitAdapter({
  dirty = false,
  candidateMarker = "",
  canonicalRegistryHead = baseSha,
  lateCanonicalDirt = false,
} = {}) {
  let canonicalStatusReads = 0;
  return args => {
    const command = args.join(" ");
    if (command === "rev-parse --git-common-dir") return ".git\n";
    if (command === "worktree list --porcelain -z") {
      return registry({ candidateMarker, canonicalRegistryHead });
    }
    if (command === `rev-parse ${baseSha}^{tree}`) return `${treeSha}\n`;
    if (command === `-C ${target} rev-parse HEAD`) return `${fenceSha}\n`;
    if (command === `-C ${target} rev-parse HEAD^{tree}`) return `${treeSha}\n`;
    if (command === `-C ${target} branch --show-current`) return `${branch}\n`;
    if (command === `-C ${target} status --porcelain=v1 -z --untracked-files=all`) {
      return dirty ? "?? authored" : "";
    }
    if (command === `-C ${target} rev-parse HEAD^`) return `${baseSha}\n`;
    if (command === `-C ${target} log -1 --format=%s`) {
      return `chore(coordination): claim ${scope} lease 4\n`;
    }
    if (command === `-C ${target} rev-list --count ${baseSha}..${fenceSha}`) {
      return "1\n";
    }
    if (command === `ls-remote origin refs/heads/${branch}`) {
      return `${fenceSha}\trefs/heads/${branch}\n`;
    }
    if (command === "rev-parse HEAD") return `${baseSha}\n`;
    if (command === "status --porcelain") {
      canonicalStatusReads += 1;
      return lateCanonicalDirt && canonicalStatusReads > 1 ? "?? late-authored" : "";
    }
    throw new Error(`unexpected git command: ${command}`);
  };
}

test("recovery reconstructs only an exact clean fence-only registration", () => {
  const result = recoverCandidateCreateRegisterResult({
    repoRoot: canonicalRoot,
    targetPath: target,
    expectedBaseSha: baseSha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: 4,
    gitText: gitAdapter(),
  });
  assert.equal(result.schema, "agentic-candidate-create-register-result/v1");
  assert.equal(result.targetPath, target);
  assert.deepEqual(result.mutationSet, ["candidate-registration"]);
  assert.throws(() => recoverCandidateCreateRegisterResult({
    repoRoot: canonicalRoot,
    targetPath: target,
    expectedBaseSha: baseSha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: 4,
    gitText: gitAdapter({ dirty: true }),
  }), /exact clean, pushed, fence-only continuation/);
  assert.throws(() => recoverCandidateCreateRegisterResult({
    repoRoot: canonicalRoot,
    targetPath: target,
    expectedBaseSha: baseSha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: 4,
    gitText: gitAdapter({ candidateMarker: "\0locked coordination" }),
  }), /exact clean, pushed, fence-only continuation/);
  assert.throws(() => recoverCandidateCreateRegisterResult({
    repoRoot: canonicalRoot,
    targetPath: target,
    expectedBaseSha: baseSha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: 4,
    gitText: gitAdapter({ canonicalRegistryHead: "d".repeat(40) }),
  }), /registry HEAD changed or is inconsistent/);
  assert.throws(() => recoverCandidateCreateRegisterResult({
    repoRoot: canonicalRoot,
    targetPath: target,
    expectedBaseSha: baseSha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: 4,
    gitText: gitAdapter({ lateCanonicalDirt: true }),
  }), /registry, HEAD, branch, tree, or bytes changed during proof/);
  assert.throws(() => recoverCandidateCreateRegisterResult({
    repoRoot: canonicalRoot,
    targetPath: target,
    expectedBaseSha: baseSha,
    expectedBranch: "agent/device/different-scope",
    expectedFenceSha: fenceSha,
    expectedScope: scope,
    expectedLeaseEpoch: 4,
    gitText: gitAdapter(),
  }), /exact branch, semantic scope/);
});

test("admission source keeps canonical disposition and immutable lanes", () => {
  const lanes = [{ path: canonicalRoot }];
  const result = projectTaskWorktreeAdmissionSource({
    observed: { repository: canonicalRoot },
    targetPlan: {
      canonicalBaseSha: baseSha,
      canonicalHeadSha: fenceSha,
      canonicalSourceDisposition: "preserved-behind",
    },
    lanes,
  });
  assert.equal(result.canonicalSourceDisposition, "preserved-behind");
  assert.equal(Object.isFrozen(result.lanes), true);
  lanes[0].path = "/mutated";
  assert.equal(result.lanes[0].path, canonicalRoot);
  assert.equal(Object.isFrozen(result.lanes[0]), true);
  assert.throws(() => projectTaskWorktreeAdmissionSource({
    observed: {},
    targetPlan: {
      canonicalBaseSha: baseSha,
      canonicalHeadSha: fenceSha,
      canonicalSourceDisposition: "unsafe",
    },
    lanes,
  }), /incomplete or unclassified/);
});
