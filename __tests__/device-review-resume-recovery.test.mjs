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

test("expired active takeover replays after its claim commit or push", async t => {
  for (const phase of ["commit", "push"]) {
    await t.test(`after ${phase}`, () => {
      const harness = createExpiredActiveHarness(phase);
      assert.throws(() => harness.invoke(), new RegExp(`interrupted after ${phase}`));
      const result = harness.invoke();
      const state = harness.state();

      assert.equal(result.status, "active");
      assert.equal(result.fenceSha, nextFence);
      assert.equal(state.head, nextFence);
      assert.equal(state.remoteHead, nextFence);
      assert.equal(parseWriterLeasePullRequestBody(state.remoteBody).epoch, 4);
      assert.equal(state.claims, 1);
      assert.equal(state.commits, 1);
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

function createExpiredActiveHarness(failPhase) {
  const expired = {
    ...prior,
    status: "active",
    sessionId: "session-a",
    reviewHeadSha: null,
    fenceSha: reviewedHead,
    baseSha: "a".repeat(40),
    expiresAt: "2026-07-22T00:00:00.000Z",
  };
  let failed = false;
  let currentBranch = "";
  let head = reviewedHead;
  let remoteHead = reviewedHead;
  let remoteBody = renderWriterLeasePullRequestBody(expired);
  let localLease = expired;
  let claims = 0;
  let commits = 0;
  const interrupt = phase => {
    if (!failed && phase === failPhase) {
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
        "worktree list --porcelain -z": () => currentBranch
          ? `worktree ${repo}\0HEAD ${head}\0branch refs/heads/${branch}\0`
          : `worktree ${repo}\0HEAD ${head}\0detached\0`,
        "diff --name-only --diff-filter=U": () => "",
        "ls-files -u": () => "",
        "status --porcelain": () => "",
        "branch --show-current": () => currentBranch,
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
      if (args[0] === "show-ref") return reviewedHead;
      if (args[0] === "ls-remote") return `${remoteHead}\trefs/heads/${branch}`;
      return "";
    },
    ghText: args => args[1] === "list" ? JSON.stringify([{
      number: 42, headRefName: branch, url: pullRequestUrl, body: remoteBody,
    }]) : JSON.stringify({
      url: pullRequestUrl,
      state: "OPEN",
      isDraft: true,
      headRefName: branch,
      baseRefName: "main",
      body: remoteBody,
    }),
    leaseStore: {
      read: () => localLease,
      claim: () => {
        claims += 1;
        localLease = {
          ...expired,
          status: "active",
          epoch: 4,
          sessionId: "session-b",
          baseSha: reviewedHead,
          fenceSha: null,
          pullRequestUrl: null,
          heartbeatAt: "2026-07-22T00:10:00.000Z",
          expiresAt: "2026-07-22T00:40:00.000Z",
        };
        return localLease;
      },
      annotate: ({ values }) => (localLease = { ...localLease, ...values }),
      verify: () => localLease,
    },
    sessionId: "session-b",
    leaseTtlMs: 1_800_000,
    run: (command, args) => {
      const call = [command, ...args];
      if (call.join(" ") === `git switch ${branch}`) currentBranch = branch;
      else if (command === "git" && args[0] === "commit") {
        commits += 1;
        head = nextFence;
        interrupt("commit");
      } else if (call.join(" ") === `git push origin ${branch}`) {
        remoteHead = head;
        interrupt("push");
      } else if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
    now: () => new Date("2026-07-22T00:10:00.000Z"),
  };
  return {
    invoke: () => resume(context),
    state: () => ({ head, remoteHead, remoteBody, localLease, claims, commits }),
  };
}

test("same-session owned-dirt recovery replays every interruptible resume transition", async t => {
  for (const phase of ["demote", "claim", "commit", "annotate", "push", "body-edit"]) {
    await t.test(`after ${phase}`, () => {
      const harness = createOwnedDirtHarness({ failPhase: phase });
      assert.throws(() => harness.invoke(), new RegExp(`interrupted after ${phase}`));
      const result = harness.invoke();
      const state = harness.state();

      assert.equal(result.status, "active");
      assert.equal(result.fenceSha, nextFence);
      assert.equal(state.isDraft, true);
      assert.equal(state.head, nextFence);
      assert.equal(state.remoteHead, nextFence);
      assert.equal(state.claims, 1);
      assert.equal(state.commits, 1);
      assert.equal(state.localLease.baseSha, reviewedHead);
      assert.equal(state.localLease.ownedDirtRecovery.pathCount, 3);
      assert.equal(
        parseWriterLeasePullRequestBody(state.remoteBody).ownedDirtRecovery.evidenceDigest,
        state.localLease.ownedDirtRecovery.evidenceDigest,
      );
      assert.ok(state.calls.some(call => call.join(" ") ===
        "git commit --allow-empty --only -m chore(coordination): claim managed-run lease 4"));
      assert.ok(state.calls.some(call => call.join(" ") ===
        `git push --no-verify origin ${branch}`));
    });
  }
});

test("owned-dirt recovery rejects another session before PR or lease mutation", () => {
  const harness = createOwnedDirtHarness({ sessionId: "session-b" });
  assert.throws(() => harness.invoke(), /belongs only to its exact session/);
  assert.equal(harness.state().claims, 0);
  assert.equal(harness.state().calls.some(call => call[0] === "gh"), false);
});

test("ordinary resume remains clean-only for a dirty review-ready handoff", () => {
  const harness = createOwnedDirtHarness({ recoverOwnedDirt: false });
  assert.throws(() => harness.invoke(), /Working tree is not clean/);
  assert.equal(harness.state().claims, 0);
});

test("owned-dirt replay rejects byte drift before another remote mutation", () => {
  const harness = createOwnedDirtHarness({ failPhase: "commit" });
  assert.throws(() => harness.invoke(), /interrupted after commit/);
  harness.setDirtVersion(2);
  assert.throws(() => harness.invoke(), /bytes changed from their exact preserved evidence/);
  assert.equal(harness.state().remoteHead, reviewedHead);
});

test("owned-dirt recovery requires the PR head to equal the fetched remote branch", () => {
  const harness = createOwnedDirtHarness({ pullRequestHeadSha: "9".repeat(40) });
  assert.throws(() => harness.invoke(), /pull-request head does not match/);
  assert.equal(harness.state().claims, 0);
});

test("owned-dirt replay accepts a source-recorded nonadjacent repository-global epoch", () => {
  const harness = createOwnedDirtHarness({ failPhase: "claim", claimEpoch: 9 });
  assert.throws(() => harness.invoke(), /interrupted after claim/);

  const result = harness.invoke();
  const state = harness.state();

  assert.equal(result.epoch, 9);
  assert.equal(result.ownedDirtRecovery.sourceEpoch, prior.epoch);
  assert.equal(state.remoteHead, nextFence);
  assert.equal(parseWriterLeasePullRequestBody(state.remoteBody).epoch, 9);
});

test("owned-dirt nonadjacent replay rejects mismatched recorded source markers", async t => {
  for (const [name, mutate, message] of [
    ["epoch", recovery => ({ ...recovery, sourceEpoch: prior.epoch - 1 }), /source epoch/],
    ["session", recovery => ({ ...recovery, sourceSessionId: "session-other" }), /another source session/],
    ["review head", recovery => ({ ...recovery, reviewHeadSha: "e".repeat(40) }), /source epoch/],
  ]) {
    await t.test(name, () => {
      const harness = createOwnedDirtHarness({ failPhase: "claim", claimEpoch: 9 });
      assert.throws(() => harness.invoke(), /interrupted after claim/);
      harness.mutateLocalLease(lease => ({
        ...lease,
        ownedDirtRecovery: mutate(lease.ownedDirtRecovery),
      }));

      assert.throws(() => harness.invoke(), message);
      const state = harness.state();
      assert.equal(state.remoteHead, reviewedHead);
      assert.equal(state.commits, 0);
    });
  }
});

function createOwnedDirtHarness({
  failPhase = null,
  pullRequestHeadSha = null,
  recoverOwnedDirt = true,
  sessionId = "session-a",
  claimEpoch = prior.epoch + 1,
} = {}) {
  let failed = false;
  let isDraft = false;
  let head = reviewedHead;
  let remoteHead = reviewedHead;
  let remoteBody = renderWriterLeasePullRequestBody(prior);
  let localLease = prior;
  let claims = 0;
  let commits = 0;
  let dirtVersion = 1;
  const calls = [];
  const interrupt = phase => {
    if (!failed && failPhase === phase) {
      failed = true;
      throw new Error(`interrupted after ${phase}`);
    }
  };
  const objectId = relativePath => {
    const prefix = relativePath === "src/staged.mjs" ? "4" :
      relativePath === "src/unstaged.mjs" ? "5" : "6";
    return dirtVersion === 1 ? prefix.repeat(40) : "7".repeat(40);
  };
  const dirtyStatus = [
    "M  src/staged.mjs",
    " M src/unstaged.mjs",
    "?? src/new.mjs",
    "",
  ].join("\0");

  const context = {
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": () =>
          `worktree ${repo}\0HEAD ${head}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": () => "",
        "ls-files -u": () => "",
        "status --porcelain": () => dirtyStatus,
        "status --porcelain=v1 -z --untracked-files=all": () => dirtyStatus,
        "branch --show-current": () => branch,
        "diff --name-only -z HEAD --": () => "src/staged.mjs\0src/unstaged.mjs\0",
        "ls-files --others --exclude-standard -z": () => "src/new.mjs\0",
        "ls-files --stage -z": () =>
          `100644 ${"1".repeat(40)} 0\tsrc/staged.mjs\0` +
          `100644 ${"2".repeat(40)} 0\tsrc/unstaged.mjs\0`,
        "diff --binary --no-ext-diff --no-textconv --": () =>
          `unstaged-diff-version-${dirtVersion}`,
        "diff --cached --binary --no-ext-diff --no-textconv --": () =>
          "staged-diff-version-1",
        [`rev-parse origin/${branch}`]: () => remoteHead,
        "rev-parse HEAD": () => head,
        "rev-list --parents -n 1 HEAD": () => `${head} ${reviewedHead}`,
        "log -1 --pretty=%s": () =>
          `chore(coordination): claim managed-run lease ${claimEpoch}`,
        "diff-tree --no-commit-id --name-only -r HEAD": () => "",
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key]();
    },
    gitOptional: args => {
      if (args[0] === "config") return "device";
      if (args[0] === "hash-object") return objectId(args.at(-1));
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
      headRefOid: pullRequestHeadSha || remoteHead,
      baseRefName: "main",
      body: remoteBody,
    }),
    leaseStore: {
      read: () => localLease,
      claim: input => {
        claims += 1;
        localLease = {
          ...prior,
          status: "active",
          epoch: claimEpoch,
          sessionId,
          baseSha: input.baseSha,
          fenceSha: null,
          pullRequestUrl: null,
          ownedDirtRecovery: input.ownedDirtRecovery,
          heartbeatAt: "2026-07-22T00:10:00.000Z",
          expiresAt: "2026-07-22T00:40:00.000Z",
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
    recoverOwnedDirt,
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
      } else if (call.join(" ") === `git push --no-verify origin ${branch}`) {
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
    mutateLocalLease: mutate => { localLease = mutate(localLease); },
    setDirtVersion: value => { dirtVersion = value; },
    state: () => ({ calls, claims, commits, head, isDraft, localLease, remoteBody, remoteHead }),
  };
}
