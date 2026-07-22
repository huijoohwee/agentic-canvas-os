import test from "node:test";
import assert from "node:assert/strict";

import { park } from "../scripts/device-branch-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/managed-run";

test("park rejects remote fence advancement before stash, detach, release, or PR edit", () => {
  const calls = [];
  let released = false;
  const values = {
    "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${"b".repeat(40)}\0branch refs/heads/${branch}\0`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": branch,
  };

  assert.throws(() => park({
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: () => `${"c".repeat(40)}\trefs/heads/${branch}`,
    ghText: () => { throw new Error("PR edit must not begin"); },
    leaseStore: {
      verify: () => ({
        status: "active",
        sessionId: "session-a",
        branch,
        fenceSha: "b".repeat(40),
        worktreePath: repo,
      }),
      release: () => { released = true; },
    },
    sessionId: "session-a",
    run: (command, args) => calls.push([command, ...args]),
  }), /session is stale/);

  assert.equal(released, false);
  assert.deepEqual(calls, []);
});

test("park pins one main object across active detach, attached replay, and detached replay", () => {
  const pullRequestUrl = "https://github.test/org/repo/pull/42";
  const fenceSha = "b".repeat(40);
  const mainSha = "a".repeat(40);
  const advancedMainSha = "c".repeat(40);
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 2,
    sessionId: "session-a",
    device: "device",
    scope: "managed-run",
    branch,
    worktreePath: repo,
    baseSha: mainSha,
    fenceSha,
    pullRequestUrl,
    heartbeatAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T01:00:00.000Z",
  };
  let remoteBody = renderWriterLeasePullRequestBody(lease);
  let isDraft = true;
  let detachAttempts = 0;
  let detached = false;
  let detachedSha = null;
  let originMainSha = mainSha;
  let originReads = 0;
  const switchTargets = [];
  const values = {
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "stash list --format=%H%x00%gs": "",
  };
  const context = {
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") {
        return detached
          ? `worktree ${repo}\0HEAD ${mainSha}\0detached\0`
          : `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0`;
      }
      if (key === "branch --show-current") return detached ? "" : branch;
      if (key === "rev-parse HEAD") return detached ? detachedSha : fenceSha;
      if (key === "rev-parse origin/main") {
        originReads += 1;
        return originMainSha;
      }
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => args[0] === "ls-remote" ? `${fenceSha}\trefs/heads/${branch}` : "",
    ghText: () => JSON.stringify({
      url: pullRequestUrl,
      state: "OPEN",
      isDraft,
      headRefName: branch,
      baseRefName: "main",
      body: remoteBody,
    }),
    leaseStore: {
      read: requestedBranch => requestedBranch ? lease : { leases: { [branch]: lease } },
      verify: () => lease,
      release: input => {
        lease = {
          ...input.expectedLease,
          ...input.values,
          status: "parked",
          heartbeatAt: input.timestamp,
          expiresAt: input.timestamp,
        };
        // Model a sibling worktree fetching a newer main during the external
        // lease/PR phase, after this park has already pinned its main object.
        originMainSha = advancedMainSha;
        return lease;
      },
    },
    sessionId: "session-a",
    run: (command, args) => {
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") remoteBody = args[4];
      if (command === "git" && args[0] === "switch") {
        switchTargets.push(args[2]);
        if (detachAttempts++ === 0) throw new Error("detachment interrupted");
        detachedSha = args[2] === "origin/main" ? originMainSha : args[2];
        detached = true;
      }
    },
    log: () => {},
    now: () => new Date("2026-07-22T00:05:00.000Z"),
  };

  assert.throws(() => park(context), /detachment interrupted/);
  assert.equal(lease.status, "parked");
  assert.equal(isDraft, true);
  const result = park(context);
  assert.equal(result.branch, branch);
  assert.equal(result.headSha, mainSha);
  assert.equal(detachAttempts, 2);
  assert.equal(lease.parkHeadSha, mainSha);
  assert.equal(originReads, 1);
  assert.deepEqual(switchTargets, [mainSha, mainSha]);
  const replay = park(context);
  assert.deepEqual(replay, result);
  assert.equal(isDraft, true);
  assert.equal(originReads, 1);
});
