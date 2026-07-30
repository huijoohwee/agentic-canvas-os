import test from "node:test";
import assert from "node:assert/strict";

import { resume } from "../scripts/device-branch-lib.mjs";
import {
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/committed-continuation";
const pullRequestUrl = "https://github.test/org/repo/pull/71";
const sourceFence = "a".repeat(40);
const committedHead = "b".repeat(40);
const committedTree = "c".repeat(40);
const claimFence = "d".repeat(40);
const sourceTree = "8".repeat(40);
const committedPath = "scripts/continuation.mjs";
const sourceLease = {
  schema: "agentic-writer-lease/v2",
  status: "active",
  epoch: 7,
  sessionId: "session-a",
  device: "device",
  scope: "committed-continuation",
  branch,
  worktreePath: repo,
  baseSha: "e".repeat(40),
  fenceSha: sourceFence,
  pullRequestUrl,
  heartbeatAt: "2026-07-30T00:00:00.000Z",
  expiresAt: "2026-07-30T00:01:00.000Z",
};

test("expired clean committed continuation replays every external boundary", async t => {
  for (const phase of ["demote", "claim", "commit", "annotate", "push", "body-edit"]) {
    await t.test(`after ${phase}`, () => {
      const harness = createHarness({ failPhase: phase });
      assert.throws(() => harness.invoke(), new RegExp(`interrupted after ${phase}`));
      const result = harness.invoke();
      const state = harness.state();

      assert.equal(result.status, "active");
      assert.equal(result.fenceSha, claimFence);
      assert.equal(result.baseSha, committedHead);
      assert.equal(result.integration.commitSha, committedHead);
      assert.equal(result.integration.treeSha, committedTree);
      assert.deepEqual(result.integration.paths, [committedPath]);
      assert.equal(result.integration.validationRequired, true);
      assert.equal(
        result.preClaimIntegrationContinuation.sourceFenceSha,
        sourceFence,
      );
      assert.equal(
        result.preClaimIntegrationContinuation.headSha,
        committedHead,
      );
      assert.equal(state.head, claimFence);
      assert.equal(state.remoteHead, claimFence);
      assert.equal(state.isDraft, true);
      assert.equal(state.claims, 1);
      assert.equal(state.commits, 1);
      assert.equal(
        parseWriterLeasePullRequestBody(state.remoteBody).epoch,
        sourceLease.epoch + 1,
      );
      assert.equal(
        state.calls.filter(call => call.join(" ") ===
          `gh pr ready --undo ${pullRequestUrl}`).length,
        1,
      );
      assert.ok(state.calls.some(call => call.join(" ") ===
        `git push origin ${branch}`));
      assert.equal(
        state.calls.some(call => call.join(" ") ===
          `git push --no-verify origin ${branch}`),
        false,
      );
    });
  }
});

test("expired committed continuation fails closed before mutation", async t => {
  for (const [name, options, message] of [
    ["cross-session", { sessionId: "session-b" }, /another session/],
    ["dirty", { dirty: true }, /Working tree is not clean/],
    ["non-descendant", { rejectAncestry: true }, /not an ancestor/],
    [
      "local-registry mismatch",
      { localLease: { ...sourceLease, baseSha: "f".repeat(40) } },
      /exact local and remote lease evidence/,
    ],
    [
      "pull-request head mismatch",
      { pullRequestHeadSha: "9".repeat(40) },
      /exact remote or pull-request fence/,
    ],
  ]) {
    await t.test(name, () => {
      const harness = createHarness(options);
      assert.throws(() => harness.invoke(), message);
      const state = harness.state();
      assert.equal(state.claims, 0);
      assert.equal(state.commits, 0);
      assert.equal(state.calls.some(call => call[0] === "gh"), false);
      assert.equal(state.calls.some(call => call[1] === "push"), false);
    });
  }
});

function createHarness({
  failPhase = null,
  sessionId = "session-a",
  dirty = false,
  rejectAncestry = false,
  localLease: initialLocalLease = sourceLease,
  pullRequestHeadSha = null,
} = {}) {
  let failed = false;
  let isDraft = false;
  let head = committedHead;
  let remoteHead = sourceFence;
  let remoteBody = renderWriterLeasePullRequestBody(sourceLease);
  let localLease = initialLocalLease;
  let claims = 0;
  let commits = 0;
  const calls = [];
  const interrupt = phase => {
    if (!failed && failPhase === phase) {
      failed = true;
      throw new Error(`interrupted after ${phase}`);
    }
  };
  const gitText = args => {
    const key = args.join(" ");
    const values = {
      "worktree list --porcelain -z": () =>
        `worktree ${repo}\0HEAD ${head}\0branch refs/heads/${branch}\0`,
      "diff --name-only --diff-filter=U": () => "",
      "ls-files -u": () => "",
      "status --porcelain": () => dirty ? " M src/changed.mjs" : "",
      "branch --show-current": () => branch,
      [`rev-parse origin/${branch}`]: () => remoteHead,
      "rev-parse HEAD": () => head,
      [`rev-parse ${committedHead}^{tree}`]: () => committedTree,
      [`rev-parse ${sourceFence}^{tree}`]: () => sourceTree,
      [`diff --name-only -z ${sourceFence} ${committedHead} --`]: () =>
        `${committedPath}\0`,
      [`diff --binary ${sourceFence} ${committedHead} --`]: () =>
        "committed continuation diff",
      [`merge-base --is-ancestor ${sourceFence} ${committedHead}`]: () => {
        if (rejectAncestry) throw new Error("not an ancestor");
        return "";
      },
      [`merge-base --is-ancestor ${committedHead} ${claimFence}`]: () => "",
      [`merge-base --is-ancestor ${committedHead} ${committedHead}`]: () => "",
      [`merge-base --is-ancestor ${sourceFence} ${claimFence}`]: () => "",
      [`log -1 --pretty=%s ${committedHead}`]: () => "feat: preserve committed work",
      "log -1 --pretty=%s": () =>
        `chore(coordination): claim committed-continuation lease ${sourceLease.epoch + 1}`,
      "rev-list --parents -n 1 HEAD": () => `${claimFence} ${committedHead}`,
      "diff-tree --no-commit-id --name-only -r HEAD": () => "",
    };
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    return values[key]();
  };
  const context = {
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: args => {
      if (args[0] === "config") return "device";
      if (args[0] === "ls-remote") return `${remoteHead}\trefs/heads/${branch}`;
      return "";
    },
    ghText: args => args[1] === "list" ? JSON.stringify([{
      number: 71,
      headRefName: branch,
      url: pullRequestUrl,
      body: remoteBody,
    }]) : JSON.stringify({
      url: pullRequestUrl,
      state: "OPEN",
      isDraft,
      headRefName: branch,
      headRefOid: pullRequestHeadSha || remoteHead,
      baseRefName: "main",
      body: remoteBody,
    }),
    leaseStore: {
      read: () => localLease,
      claim: input => {
        claims += 1;
        localLease = {
          ...sourceLease,
          status: "active",
          epoch: sourceLease.epoch + 1,
          sessionId,
          baseSha: input.baseSha,
          fenceSha: null,
          pullRequestUrl: null,
          integration: input.integration,
          preClaimIntegrationContinuation:
            input.preClaimIntegrationContinuation,
          heartbeatAt: "2026-07-30T00:10:00.000Z",
          expiresAt: "2026-07-30T00:40:00.000Z",
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
    },
    sessionId,
    leaseTtlMs: 1_800_000,
    run: (command, args) => {
      const call = [command, ...args];
      calls.push(call);
      if (call.join(" ") === `gh pr ready --undo ${pullRequestUrl}`) {
        isDraft = true;
        interrupt("demote");
      } else if (command === "git" && args[0] === "commit") {
        commits += 1;
        head = claimFence;
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
    now: () => new Date("2026-07-30T00:10:00.000Z"),
  };
  return {
    invoke: () => resume(context),
    state: () => ({
      calls,
      claims,
      commits,
      head,
      isDraft,
      localLease,
      remoteBody,
      remoteHead,
    }),
  };
}
