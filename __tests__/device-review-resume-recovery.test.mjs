import test from "node:test";
import assert from "node:assert/strict";

import { resume } from "../scripts/device-branch-lib.mjs";
import { parseWriterLeasePullRequestBody, renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/managed-run";
const pullRequestUrl = "https://github.test/org/repo/pull/42";
const reviewedHead = "c".repeat(40);
const nextFence = "d".repeat(40);
const prior = {
  schema: "agentic-writer-lease/v2",
  status: "review_ready",
  epoch: 3,
  sessionId: "session-a",
  device: "device",
  scope: "managed-run",
  branch,
  worktreePath: repo,
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  pullRequestUrl,
  reviewHeadSha: reviewedHead,
  heartbeatAt: "2026-07-22T00:00:00.000Z",
  expiresAt: "2026-07-22T00:00:00.000Z",
};

test("review-ready resume reconciles every externally interruptible transition", async t => {
  for (const phase of ["demote", "claim", "commit", "annotate", "push", "body-edit"]) {
    await t.test(`after ${phase}`, () => {
      const harness = createHarness(phase);
      assert.throws(() => harness.invoke(), new RegExp(`interrupted after ${phase}`));
      const result = harness.invoke();
      const state = harness.state();

      assert.equal(result.status, "active");
      assert.equal(result.fenceSha, nextFence);
      assert.equal(state.isDraft, true);
      assert.equal(state.head, nextFence);
      assert.equal(state.remoteHead, nextFence);
      assert.equal(state.localLease.status, "active");
      assert.equal(parseWriterLeasePullRequestBody(state.remoteBody).status, "active");
      assert.equal(state.calls.filter(call => call.join(" ") === `gh pr ready --undo ${pullRequestUrl}`).length, 1);
      assert.equal(state.claims, 1);
      assert.equal(state.commits, 1);
      assert.equal(state.rollbacks, 0);
    });
  }
});

function createHarness(failPhase) {
  let failed = false;
  let isDraft = false;
  let head = reviewedHead;
  let remoteHead = reviewedHead;
  let remoteBody = renderWriterLeasePullRequestBody(prior);
  let localLease = prior;
  let claims = 0;
  let commits = 0;
  let rollbacks = 0;
  const calls = [];
  const interrupt = phase => {
    if (!failed && failPhase === phase) {
      failed = true;
      throw new Error(`interrupted after ${phase}`);
    }
  };

  const context = {
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": () => `worktree ${repo}\0HEAD ${head}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": () => "",
        "ls-files -u": () => "",
        "status --porcelain": () => "",
        "branch --show-current": () => branch,
        [`rev-parse origin/${branch}`]: () => remoteHead,
        "rev-parse HEAD": () => head,
        "rev-list --parents -n 1 HEAD": () => `${head} ${reviewedHead}`,
        "log -1 --pretty=%s": () => "chore(coordination): claim managed-run lease 4",
        "diff-tree --no-commit-id --name-only -r HEAD": () => "",
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key]();
    },
    gitOptional: args => {
      if (args[0] === "config") return "device";
      if (args[0] === "ls-remote") return `${remoteHead}\trefs/heads/${branch}`;
      return "";
    },
    ghText: args => args[1] === "list" ? JSON.stringify([{
      number: 42,
      headRefName: branch,
      url: pullRequestUrl,
      body: remoteBody,
    }]) : JSON.stringify({
      url: pullRequestUrl,
      state: "OPEN",
      isDraft,
      headRefName: branch,
      baseRefName: "main",
      body: remoteBody,
    }),
    leaseStore: {
      read: () => localLease,
      claim: () => {
        claims += 1;
        localLease = {
          ...prior,
          status: "active",
          epoch: 4,
          sessionId: "session-b",
          baseSha: reviewedHead,
          fenceSha: null,
          pullRequestUrl: null,
          heartbeatAt: "2026-07-22T00:05:00.000Z",
          expiresAt: "2026-07-22T00:35:00.000Z",
        };
        interrupt("claim");
        return localLease;
      },
      annotate: ({ values }) => {
        localLease = { ...localLease, ...values };
        interrupt("annotate");
        return localLease;
      },
      verify: () => localLease,
      rollbackClaim: () => { rollbacks += 1; localLease = prior; },
    },
    sessionId: "session-b",
    leaseTtlMs: 1_800_000,
    run: (command, args) => {
      const call = [command, ...args];
      calls.push(call);
      if (call.join(" ") === `gh pr ready --undo ${pullRequestUrl}`) {
        isDraft = true;
        interrupt("demote");
      } else if (command === "git" && args[0] === "commit") {
        commits += 1;
        head = nextFence;
        interrupt("commit");
      } else if (call.join(" ") === `git push origin ${branch}`) {
        remoteHead = head;
        interrupt("push");
      } else if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
        remoteBody = args[args.indexOf("--body") + 1];
        interrupt("body-edit");
      }
    },
    log: () => {},
    now: () => new Date("2026-07-22T00:10:00.000Z"),
  };

  return {
    invoke: () => resume(context),
    state: () => ({ calls, claims, commits, rollbacks, isDraft, head, remoteHead, remoteBody, localLease }),
  };
}
