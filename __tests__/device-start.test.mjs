import test from "node:test";
import assert from "node:assert/strict";

import { start } from "../scripts/device-start-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/managed-run";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const pullRequestUrl = "https://github.test/org/repo/pull/42";

test("start reconciles a draft PR created before its response was lost", () => {
  const calls = [];
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 3,
    sessionId: "session-a",
    device: "device",
    scope: "managed-run",
    branch,
    worktreePath: repo,
    baseSha,
    fenceSha,
    pullRequestUrl: null,
    acquiredAt: "2026-07-22T00:00:00.000Z",
    heartbeatAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T01:00:00.000Z",
  };
  let owner = null;
  const context = {
    scope: "managed-run",
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        "rev-parse HEAD": fenceSha,
        "rev-list --parents -n 1 HEAD": `${fenceSha} ${baseSha}`,
        "log -1 --pretty=%s": "chore(coordination): claim managed-run lease 3",
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => args[0] === "config" ? "device" : "",
    ghText: args => {
      if (args[1] === "list") return JSON.stringify(owner ? [owner] : []);
      if (args[1] === "create") {
        owner = { number: 42, headRefName: branch, url: pullRequestUrl, body: renderWriterLeasePullRequestBody(lease), isDraft: true };
        throw new Error("response lost after draft creation");
      }
      if (args[1] === "view") return JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        isDraft: true,
        headRefName: branch,
        baseRefName: "main",
        body: owner.body,
      });
      throw new Error(`unexpected gh command: ${args.join(" ")}`);
    },
    leaseStore: {
      read: () => lease,
      heartbeat: () => lease,
      annotate: ({ values }) => (lease = { ...lease, ...values }),
    },
    sessionId: "session-a",
    leaseTtlMs: 60_000,
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
    now: () => new Date("2026-07-22T00:01:00.000Z"),
  };

  assert.throws(() => start(context), /response lost/);
  assert.equal(lease.pullRequestUrl, null);
  assert.equal(start(context), branch);
  assert.equal(lease.pullRequestUrl, pullRequestUrl);
  assert.equal(calls.filter(call => call.join(" ") === `git push --set-upstream origin ${branch}`).length, 2);
  assert.equal(calls.filter(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit").length, 1);
  assert.equal(calls.some(call => call[0] === "git" && ["switch", "commit"].includes(call[1])), false);
});

test("start rejects local and remote branch collisions before lease mutation", () => {
  for (const collision of ["local", "remote"]) {
    let claims = 0;
    assert.throws(() => start({
      scope: "managed-run",
      invocationPath: repo,
      repo,
      gitText: args => {
        const values = {
          "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${baseSha}\0detached\0`,
          "diff --name-only --diff-filter=U": "",
          "ls-files -u": "",
          "status --porcelain": "",
          "branch --show-current": "",
        };
        const key = args.join(" ");
        if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
        return values[key];
      },
      gitOptional: args => {
        if (args[0] === "config") return "device";
        if (collision === "local" && args[0] === "show-ref") return fenceSha;
        if (collision === "remote" && args[0] === "ls-remote") return `${fenceSha}\trefs/heads/${branch}`;
        return "";
      },
      ghText: () => "[]",
      leaseStore: {
        read: () => null,
        claim: () => { claims += 1; },
      },
      sessionId: "session-a",
      leaseTtlMs: 60_000,
      run: () => {},
      log: () => {},
    }), /branch collision/);
    assert.equal(claims, 0, `${collision} collision`);
  }
});
