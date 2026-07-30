import assert from "node:assert/strict";
import test from "node:test";

import { repairOwnershipPullRequestProjection } from "../scripts/device-branch-lib.mjs";

const branch = "agent/device/projection-repair";
const staleHead = "a".repeat(40);
const expectedHead = "b".repeat(40);
const sourceUrl = "https://github.com/example/repo/pull/7";
const replacementUrl = "https://github.com/example/repo/pull/8";

test("projection repair replaces a structurally stale draft and preserves its receipt", () => {
  const harness = createHarness({ reopenRefreshes: false, dirty: true });
  const repaired = repairOwnershipPullRequestProjection(harness.input);

  assert.equal(repaired.pullRequestUrl, replacementUrl);
  assert.deepEqual(repaired.pullRequestProjectionRepair, {
    schema: "agentic-pull-request-projection-repair/v1",
    status: "completed",
    sourceEpoch: 17,
    sourcePullRequestUrl: sourceUrl,
    staleHeadSha: staleHead,
    expectedHeadSha: expectedHead,
    dirtEvidenceDigest: repaired.pullRequestProjectionRepair.dirtEvidenceDigest,
    dirtPathCount: 1,
    targetPullRequestUrl: replacementUrl,
    outcome: "replaced",
    startedAt: "2026-07-30T00:00:00.000Z",
    completedAt: "2026-07-30T00:00:00.000Z",
  });
  assert.match(repaired.pullRequestProjectionRepair.dirtEvidenceDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(harness.mutations.slice(0, 4), [
    ["gh", ["pr", "close", sourceUrl]],
    ["gh", ["pr", "reopen", sourceUrl]],
    ["gh", ["pr", "close", sourceUrl]],
    ["ghText", ["pr", "create", "--draft", "--base", "main", "--head", branch,
      "--title", "repair projection", "--body", harness.mutations[3][1][10]]],
  ]);
  assert.equal(harness.state.source.state, "CLOSED");
  assert.equal(harness.state.replacement.headRefOid, expectedHead);
});

test("projection repair reuses the original PR when close and reopen refreshes its head", () => {
  const harness = createHarness({ reopenRefreshes: true, dirty: false });
  const repaired = repairOwnershipPullRequestProjection(harness.input);

  assert.equal(repaired.pullRequestUrl, sourceUrl);
  assert.equal(repaired.pullRequestProjectionRepair.outcome, "reopened");
  assert.equal(repaired.pullRequestProjectionRepair.dirtEvidenceDigest, null);
  assert.equal(repaired.pullRequestProjectionRepair.dirtPathCount, 0);
  assert.equal(harness.state.replacement, null);
});

function createHarness({ reopenRefreshes, dirty }) {
  const state = {
    source: pullRequest(sourceUrl, staleHead),
    replacement: null,
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "active",
      epoch: 17,
      sessionId: "session",
      device: "device",
      scope: "projection-repair",
      branch,
      worktreePath: "/repo",
      baseSha: "c".repeat(40),
      fenceSha: expectedHead,
      pullRequestUrl: sourceUrl,
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  };
  const mutations = [];
  const gitText = args => {
    const command = args.join("\0");
    if (command === "rev-parse\0HEAD") return expectedHead;
    if (command === "status\0--porcelain") return dirty ? " M file.txt" : "";
    if (command === "status\0--porcelain=v1\0-z\0--untracked-files=all") return " M file.txt\0";
    if (command === "diff\0--name-only\0-z\0HEAD\0--") return "file.txt\0";
    if (command === "ls-files\0--others\0--exclude-standard\0-z") return "";
    if (command === "ls-files\0--stage\0-z") return `100644 ${"d".repeat(40)} 0\tfile.txt\0`;
    if (args[0] === "diff" && args.includes("--binary")) return args.includes("--cached") ? "" : "diff";
    if (command === "merge-base\0--is-ancestor\0" + staleHead + "\0" + expectedHead) return "";
    if (command === "log\0-1\0--pretty=%s") return "repair projection";
    throw new Error(`Unexpected git call: ${args.join(" ")}`);
  };
  const gitOptional = args => {
    if (args[0] === "ls-remote") return `${expectedHead}\trefs/heads/${branch}`;
    if (args[0] === "hash-object") return "e".repeat(40);
    throw new Error(`Unexpected optional git call: ${args.join(" ")}`);
  };
  const ghText = args => {
    if (args[0] === "pr" && args[1] === "view") {
      const url = args[2];
      return JSON.stringify(url === sourceUrl ? state.source : state.replacement);
    }
    if (args[0] === "pr" && args[1] === "list" && args.includes("--head")) {
      return JSON.stringify(state.replacement?.state === "OPEN" ? [state.replacement] : []);
    }
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify(state.source.state === "OPEN"
        ? [{ number: 7, headRefName: branch, url: sourceUrl }]
        : []);
    }
    if (args[0] === "pr" && args[1] === "create") {
      mutations.push(["ghText", args]);
      state.replacement = pullRequest(replacementUrl, expectedHead);
      return replacementUrl;
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  const run = (command, args) => {
    mutations.push([command, args]);
    if (command !== "gh") return;
    if (args[1] === "close") state.source.state = "CLOSED";
    if (args[1] === "reopen") {
      state.source.state = "OPEN";
      if (reopenRefreshes) state.source.headRefOid = expectedHead;
    }
  };
  const leaseStore = {
    annotate({ values }) {
      state.lease = { ...state.lease, ...values };
      return state.lease;
    },
  };
  return {
    state,
    mutations,
    input: {
      branch,
      lease: state.lease,
      leaseStore,
      sessionId: "session",
      gitText,
      gitOptional,
      ghText,
      run,
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    },
  };
}

function pullRequest(url, headRefOid) {
  return {
    url,
    state: "OPEN",
    isDraft: true,
    headRefName: branch,
    headRefOid,
    headRepository: { nameWithOwner: "example/repo" },
    baseRefName: "main",
    body: "",
  };
}
