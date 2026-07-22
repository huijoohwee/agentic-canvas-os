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
  parkHeadSha: "a".repeat(40),
  parkBranchHeadSha: localSha,
  parkSourceEpoch: 4,
  parkSourceFenceSha: "b".repeat(40),
  parkStashRef: null,
  parkStashSha: null,
  parkStashMessage: null,
  parkStashStatus: null,
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
  assert.equal(claimInput.baseSha, localSha);
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

test("resume preserves the exact pending claim when a push result is uncertain", () => {
  const calls = [];
  const push = `git push origin ${branch}`;
  let observed;
  assert.throws(
    () => { observed = runResume(parked, { calls, failAt: push, failure: "non-fast-forward remote advancement" }); },
    /non-fast-forward remote advancement/,
  );
  assert.equal(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit"), false);
  assert.equal(calls.some(call => call[0] === "lease" && call[1] === "rollback"), false);
  assert.equal(calls.some(call => call[1] === "reset" || call[1] === "update-ref"), false);
  assert.equal(calls.some(call => call[1] === "switch" && call[2] === "--detach"), false);
  assert.equal(observed, undefined);
});

for (const stage of ["before-commit", "before-annotation", "after-annotation", "after-push"]) {
  test(`expired pending resume safely replays ${stage}`, () => {
    const calls = [];
    let body = renderWriterLeasePullRequestBody(parked);
    let headSha = stage === "before-commit" ? localSha : nextFence;
    const annotated = ["after-annotation", "after-push"].includes(stage);
    let active = {
      schema: parked.schema,
      status: "active",
      epoch: parked.epoch + 1,
      sessionId: parked.sessionId,
      device: parked.device,
      scope: parked.scope,
      branch,
      worktreePath: repo,
      baseSha: localSha,
      fenceSha: annotated ? nextFence : null,
      pullRequestUrl: annotated ? pullRequestUrl : null,
      acquiredAt: "2026-07-22T00:00:00.000Z",
      heartbeatAt: "2026-07-22T00:00:00.000Z",
      expiresAt: "2026-07-22T00:01:00.000Z",
    };
    const leaseStore = {
      read: () => active,
      heartbeat: ({ ttlMs }) => {
        calls.push(["lease", "heartbeat", ttlMs]);
        active = { ...active, heartbeatAt: "2026-07-22T00:10:00.000Z", expiresAt: "2026-07-22T00:40:00.000Z" };
        return active;
      },
      annotate: ({ values }) => (active = { ...active, ...values }),
      verify: () => active,
    };
    const result = resume({
      branchName: branch,
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        const values = {
          "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${nextFence}\0branch refs/heads/${branch}\0`,
          "diff --name-only --diff-filter=U": "",
          "ls-files -u": "",
          "status --porcelain": "",
          "branch --show-current": branch,
          [`rev-parse origin/${branch}`]: stage === "after-push" ? nextFence : parked.parkSourceFenceSha,
          "rev-list --parents -n 1 HEAD": `${nextFence} ${localSha}`,
          "log -1 --pretty=%s": `chore(coordination): claim managed-run lease ${parked.epoch + 1}`,
          "diff-tree --no-commit-id --name-only -r HEAD": "",
        };
        if (key === "rev-parse HEAD") return headSha;
        if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
        return values[key];
      },
      gitOptional: args => args[0] === "ls-remote" ? nextFence : "",
      ghText: args => args[1] === "list" ? JSON.stringify([{
        number: 42, headRefName: branch, url: pullRequestUrl, body,
      }]) : JSON.stringify({
        url: pullRequestUrl, state: "OPEN", isDraft: true,
        headRefName: branch, baseRefName: "main", body,
      }),
      leaseStore,
      sessionId: parked.sessionId,
      leaseTtlMs: 1_800_000,
      run: (command, args) => {
        const call = [command, ...args];
        calls.push(call);
        if (call.slice(0, 3).join(" ") === "git commit --allow-empty") headSha = nextFence;
        if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
          body = args[args.indexOf("--body") + 1];
        }
      },
      log: () => {},
      now: () => new Date("2026-07-22T00:10:00.000Z"),
    });

    assert.equal(result.fenceSha, nextFence);
    assert.equal(active.pullRequestUrl, pullRequestUrl);
    assert.equal(active.expiresAt, "2026-07-22T00:40:00.000Z");
    assert.ok(calls.some(call => call.join(" ") === "lease heartbeat 1800000"));
    assert.equal(
      calls.some(call => call.slice(0, 3).join(" ") === "git commit --allow-empty"),
      stage === "before-commit",
    );
    assert.equal(
      calls.some(call => call.join(" ") === `git push origin ${branch}`),
      stage !== "after-push",
    );
  });
}

test("expired pending resume rejects an unrelated HEAD before any mutation", () => {
  const calls = [];
  const invalidHead = "9".repeat(40);
  const active = {
    schema: parked.schema,
    status: "active",
    epoch: parked.epoch + 1,
    sessionId: parked.sessionId,
    device: parked.device,
    scope: parked.scope,
    branch,
    worktreePath: repo,
    baseSha: localSha,
    fenceSha: null,
    pullRequestUrl: null,
    acquiredAt: "2026-07-22T00:00:00.000Z",
    heartbeatAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T00:01:00.000Z",
  };
  assert.throws(() => resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${invalidHead}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        [`rev-parse origin/${branch}`]: parked.parkSourceFenceSha,
        "rev-parse HEAD": invalidHead,
        "rev-list --parents -n 1 HEAD": `${invalidHead} ${"8".repeat(40)}`,
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: () => "",
    ghText: args => args[1] === "list" ? JSON.stringify([{
      number: 42, headRefName: branch, url: pullRequestUrl,
      body: renderWriterLeasePullRequestBody(parked),
    }]) : JSON.stringify({
      url: pullRequestUrl, state: "OPEN", isDraft: true,
      headRefName: branch, baseRefName: "main",
      body: renderWriterLeasePullRequestBody(parked),
    }),
    leaseStore: {
      read: () => active,
      heartbeat: () => { calls.push(["lease", "heartbeat"]); return active; },
      annotate: () => { calls.push(["lease", "annotate"]); return active; },
    },
    sessionId: parked.sessionId,
    leaseTtlMs: 1_800_000,
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
    now: () => new Date("2026-07-22T00:10:00.000Z"),
  }), /exact single-parent claim commit/);
  assert.equal(calls.some(call => call[0] === "lease"), false);
  assert.equal(calls.some(call => ["commit", "push"].includes(call[1])), false);
  assert.equal(calls.some(call => call[0] === "gh" && call[2] === "edit"), false);
});
