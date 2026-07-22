import test from "node:test";
import assert from "node:assert/strict";

import { resume, review } from "../scripts/device-branch-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/managed-run";
const pullRequestUrl = "https://github.test/org/repo/pull/42";
const headSha = "c".repeat(40);
const lease = {
  schema: "agentic-writer-lease/v2",
  status: "active",
  epoch: 3,
  sessionId: "session-a",
  device: "device",
  scope: "managed-run",
  branch,
  worktreePath: repo,
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  pullRequestUrl,
  acquiredAt: "2026-07-22T00:00:00.000Z",
  heartbeatAt: "2026-07-22T00:01:00.000Z",
  expiresAt: "2026-07-22T00:31:00.000Z",
};

function gitText(args) {
  const values = {
    "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": branch,
    "rev-parse HEAD": headSha,
    "log -1 --pretty=%s": "feat: managed autonomous run",
  };
  const key = args.join(" ");
  if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
  return values[key];
}

test("review validates, pushes, and marks the matching PR ready without merge", () => {
  const calls = [];
  const originalBody = "## Work item\n\nAcceptance stays visible.";
  let saved = lease;
  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : originalBody,
    ghOptional: args => args.includes("isDraft") ? "true" : pullRequestUrl,
    leaseStore: {
      read: () => saved,
      verify: () => saved,
      annotate: ({ values }) => { saved = { ...saved, ...values }; return saved; },
      release: ({ status }) => { saved = { ...saved, status }; return saved; },
    },
    sessionId: "session-a",
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(saved.status, "review_ready");
  assert.equal(saved.reviewHeadSha, headSha);
  assert.ok(calls.some(call => call.join(" ") === "npm run check"));
  assert.ok(calls.some(call => call[0] === "git" && call[1] === "push"));
  assert.ok(calls.some(call => call.join(" ") === `gh pr ready ${pullRequestUrl}`));
  const commandTrace = calls.map(call => call.join(" ")).join("\n");
  assert.doesNotMatch(commandTrace, /gh pr merge|--auto|automerge|--add-label/);
  const bodyEdit = calls.find(call => call[0] === "gh" && call.includes("--body"));
  assert.match(bodyEdit[bodyEdit.indexOf("--body") + 1], /Acceptance stays visible/);
  assert.ok(bodyEdit.includes("--title"));
});

test("review replays an exact same-session ready handoff without verification or push", () => {
  const calls = [];
  const ready = { ...lease, status: "review_ready", reviewHeadSha: headSha };
  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => `${headSha}\trefs/heads/${branch}`,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : args.includes("state,isDraft")
        ? JSON.stringify({ state: "OPEN", isDraft: false })
        : "## Work item\n\nPreserve me.",
    ghOptional: () => pullRequestUrl,
    leaseStore: { read: () => ready },
    sessionId: "session-a",
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(calls.some(call => call[0] === "npm" || call[1] === "push"), false);
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ["git", "merge-base", "--is-ancestor"],
    ["gh", "pr", "edit"],
  ]);
});

test("resume reactivates an attached reviewed handoff under a new fenced session", () => {
  const calls = [];
  const prior = { ...lease, status: "review_ready", reviewHeadSha: headSha };
  const nextFence = "d".repeat(40);
  let headReads = 0;
  let claimInput = null;
  const resumed = { ...prior, status: "active", epoch: 4, sessionId: "session-b", fenceSha: nextFence };
  const result = resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        [`rev-parse origin/${branch}`]: headSha,
      };
      if (key === "rev-parse HEAD") return headReads++ === 0 ? headSha : nextFence;
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => args[0] === "config" ? "device-b" : "",
    ghText: () => JSON.stringify([{
      number: 42,
      headRefName: branch,
      url: pullRequestUrl,
      body: renderWriterLeasePullRequestBody(prior),
    }]),
    leaseStore: {
      claim: input => { claimInput = input; return { ...resumed, fenceSha: null }; },
      annotate: () => resumed,
    },
    sessionId: "session-b",
    leaseTtlMs: 1_800_000,
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.equal(claimInput.previousEpoch, 3);
  assert.equal(claimInput.sessionId, "session-b");
  assert.equal(result.fenceSha, nextFence);
  assert.equal(calls.some(call => call[1] === "switch"), false);
  assert.ok(calls.some(call => call.join(" ") === `git push origin ${branch}`));
});
