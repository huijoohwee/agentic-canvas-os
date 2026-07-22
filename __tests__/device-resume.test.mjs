import test from "node:test";
import assert from "node:assert/strict";

import { resume } from "../scripts/device-branch-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/managed-run";
const pullRequestUrl = "https://github.test/org/repo/pull/42";
const remoteSha = "c".repeat(40);
const localSha = "d".repeat(40);
const nextFence = "e".repeat(40);
const parked = {
  schema: "agentic-writer-lease/v2",
  status: "parked",
  epoch: 4,
  sessionId: "session-a",
  device: "device",
  scope: "managed-run",
  branch,
  worktreePath: repo,
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  pullRequestUrl,
  heartbeatAt: "2026-07-22T00:00:00.000Z",
  expiresAt: "2026-07-22T00:00:00.000Z",
};

function runResume(localLease = parked, options = {}) {
  const calls = options.calls || [];
  let headReads = 0;
  let claimInput = null;
  const resumed = { ...parked, status: "active", epoch: 5, fenceSha: nextFence };
  const result = resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${"a".repeat(40)}\0detached\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": "",
        [`rev-parse origin/${branch}`]: remoteSha,
      };
      if (key === "rev-parse HEAD") return headReads++ === 0 ? localSha : nextFence;
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => args[0] === "show-ref" ? localSha : args[0] === "config" ? "device" : "",
    ghText: args => args[1] === "list" ? JSON.stringify([{
      number: 42,
      headRefName: branch,
      url: pullRequestUrl,
      body: renderWriterLeasePullRequestBody(parked),
    }]) : JSON.stringify({
      url: pullRequestUrl,
      state: "OPEN",
      isDraft: true,
      headRefName: branch,
      baseRefName: "main",
      body: renderWriterLeasePullRequestBody(parked),
    }),
    leaseStore: {
      read: () => localLease,
      claim: input => { calls.push(["lease", "claim"]); claimInput = input; return { ...resumed, fenceSha: null }; },
      annotate: () => resumed,
      rollbackClaim: input => { calls.push(["lease", "rollback", input]); },
    },
    sessionId: "session-a",
    leaseTtlMs: 1_800_000,
    run: (command, args) => {
      const call = [command, ...args];
      calls.push(call);
      if (call.join(" ") === options.failAt) throw new Error(options.failure || "command rejected");
    },
    log: () => {},
  });
  return { calls, claimInput, result };
}

test("resume preserves exact same-session parked commits ahead of the remote", () => {
  const { calls, claimInput, result } = runResume();

  assert.equal(claimInput.previousEpoch, parked.epoch);
  assert.equal(claimInput.baseSha, remoteSha);
  assert.equal(result.fenceSha, nextFence);
  assert.ok(calls.some(call => call.join(" ") === `git merge-base --is-ancestor origin/${branch} HEAD`));
  assert.ok(calls.some(call => call.join(" ") === `git merge-base --is-ancestor ${parked.fenceSha} HEAD`));
  assert.ok(calls.some(call => call.join(" ") === `git push origin ${branch}`));
});

test("resume rejects a local-ahead parked branch when exact local evidence changed", () => {
  assert.throws(
    () => runResume({ ...parked, epoch: parked.epoch + 1 }),
    /not the exact same-session parked continuation/,
  );
});

test("resume rejects a non-descendant parked local head before issuing a new claim", () => {
  const calls = [];
  const ancestry = `git merge-base --is-ancestor origin/${branch} HEAD`;
  assert.throws(
    () => runResume(parked, { calls, failAt: ancestry, failure: "not an ancestor" }),
    /not an ancestor/,
  );
  assert.equal(calls.some(call => call.join(" ") === "lease claim"), false);
  assert.equal(calls.some(call => call.join(" ") === `git push origin ${branch}`), false);
});

test("resume leaves PR handoff metadata untouched when a competing remote push wins", () => {
  const calls = [];
  const push = `git push origin ${branch}`;
  let observed;
  assert.throws(
    () => { observed = runResume(parked, { calls, failAt: push, failure: "non-fast-forward remote advancement" }); },
    /non-fast-forward remote advancement/,
  );
  assert.equal(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit"), false);
  const rollback = calls.find(call => call[0] === "lease" && call[1] === "rollback");
  assert.equal(rollback[2].previousLease, parked);
  assert.equal(rollback[2].epoch, 5);
  assert.equal(rollback[2].fenceSha, nextFence);
  assert.ok(calls.some(call => call.join(" ") === `git switch --detach origin/${branch}`));
  assert.equal(observed, undefined);
});
