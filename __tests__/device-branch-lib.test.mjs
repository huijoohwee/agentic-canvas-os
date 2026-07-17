import test from "node:test";
import assert from "node:assert/strict";

import {
  completeSession,
  createParkMessage,
  formatParkTimestamp,
  heartbeat,
  park,
  publish,
  resume,
  sanitize,
  sanitizeDevice,
  sanitizeScope,
  start,
} from "../scripts/device-branch-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();

function createGitText(responses) {
  return args => {
    const key = args.join(" ");
    if (!(key in responses)) throw new Error(`unexpected git command: ${key}`);
    const value = responses[key];
    if (Array.isArray(value)) return value.shift() ?? "";
    return value;
  };
}

test("formatParkTimestamp emits git-friendly UTC stamps", () => {
  assert.equal(formatParkTimestamp(new Date("2026-07-14T22:30:45.123Z")), "20260714T223045Z");
  assert.equal(
    createParkMessage("agent/device/scope", new Date("2026-07-14T22:30:45.123Z")),
    "park: agent/device/scope 20260714T223045Z",
  );
});

test("device and scope sanitizers preserve hostname identity without widening scope grammar", () => {
  assert.equal(sanitize("Legacy.Scope_Value"), "legacy.scope_value");
  assert.equal(sanitizeDevice("Katrinas-MacBook-Pro.local"), "katrinas-macbook-pro.local");
  assert.equal(sanitizeDevice("build_host"), "build_host");
  assert.equal(sanitizeScope("Local_Branch.Runtime Contract"), "local-branch-runtime-contract");
  assert.throws(() => sanitizeDevice(".local"), /Device must have ASCII alphanumeric boundaries/);
});

test("start rejects an invalid device before checkout mutation", () => {
  const calls = [];
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
  });

  assert.throws(() => start({
    scope: "runtime-leases",
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => ".local",
    ghText: () => "[]",
    leaseStore: {},
    sessionId: "chat-a",
    run: (command, args) => calls.push([command, ...args]),
  }), /Device must have ASCII alphanumeric boundaries/);
  assert.deepEqual(calls, []);
});

test("start claims a lease and publishes a draft ownership PR before authoring", () => {
  const calls = [];
  const annotations = [];
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "rev-parse origin/main": "a".repeat(40),
    "rev-parse HEAD": "b".repeat(40),
  });
  const leaseStore = {
    claim: values => ({
      schema: "agentic-writer-lease/v1",
      status: "active",
      epoch: 1,
      ...values,
      fenceSha: null,
      pullRequestUrl: null,
      heartbeatAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:30:00.000Z",
    }),
    annotate: ({ values }) => {
      annotations.push(values);
      return {
        schema: "agentic-writer-lease/v1",
        status: "active",
        epoch: 1,
        sessionId: "chat-a",
        device: "device",
        scope: "runtime-leases",
        branch: "agent/device/runtime-leases",
        baseSha: "a".repeat(40),
        fenceSha: values.fenceSha || "b".repeat(40),
        pullRequestUrl: values.pullRequestUrl || null,
        heartbeatAt: "2026-07-17T10:00:00.000Z",
        expiresAt: "2026-07-17T10:30:00.000Z",
      };
    },
  };

  const branch = start({
    scope: "runtime-leases",
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "device",
    ghText: args => args[0] === "pr" && args[1] === "list" ? "[]" : "https://github.test/pull/1\n",
    leaseStore,
    sessionId: "chat-a",
    leaseTtlMs: 1_800_000,
    run: (command, args) => calls.push([command, ...args]),
    log: message => logs.push(message),
  });

  assert.equal(branch, "agent/device/runtime-leases");
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ["git", "fetch", "origin"],
    ["git", "switch", "--create"],
    ["git", "commit", "--allow-empty"],
    ["git", "push", "--set-upstream"],
  ]);
  assert.deepEqual(annotations, [
    { fenceSha: "b".repeat(40) },
    { pullRequestUrl: "https://github.test/pull/1" },
  ]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /chat-a/);
});

test("park stashes a dirty task branch and returns to clean canonical main", () => {
  const calls = [];
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "status --porcelain": [" M docs/task.md\n", ""],
    "stash list --format=%gd -n 1": "stash@{0}\n",
    "rev-parse HEAD": "1234567890abcdef1234567890abcdef12345678\n",
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const result = park({
    invocationPath: repo,
    repo,
    gitText,
    leaseStore: {
      verify: () => ({ status: "active" }),
      release: () => ({ status: "parked" }),
    },
    sessionId: "chat-a",
    run: (command, args) => calls.push([command, ...args]),
    log: message => logs.push(message),
    now: () => new Date("2026-07-14T22:30:45.123Z"),
  });

  assert.deepEqual(calls, [
    ["git", "stash", "push", "-u", "-m", "park: agent/device/scope 20260714T223045Z"],
    ["git", "switch", "main"],
    ["git", "fetch", "origin", "main"],
    ["git", "merge", "--ff-only", "origin/main"],
  ]);
  assert.deepEqual(result, {
    branch: "agent/device/scope",
    headSha: "1234567890abcdef1234567890abcdef12345678",
    stashRef: "stash@{0}",
  });
  assert.equal(logs[0], "Parked agent/device/scope in stash@{0}; main is now 1234567890ab.");
});

test("heartbeat rejects a session after the remote fencing commit advances", () => {
  const branch = "agent/device/runtime-leases";
  let renewed = false;
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": `${branch}\n`,
  });

  assert.throws(() => heartbeat({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => `${"c".repeat(40)}\trefs/heads/${branch}`,
    leaseStore: {
      verify: () => ({ fenceSha: "b".repeat(40) }),
      heartbeat: () => { renewed = true; },
    },
    sessionId: "chat-a",
    leaseTtlMs: 1_800_000,
    run: () => {},
  }), /session is stale/);
  assert.equal(renewed, false);
});

test("publish verifies the session lease and fencing ancestor before delivery", () => {
  const calls = [];
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "log -1 --pretty=%s": "fix: coordination runtime\n",
  });
  let releaseStatus = null;

  const result = publish({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }]),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => ({ branch, fenceSha: "b".repeat(40), pullRequestUrl }),
      release: ({ status }) => {
        releaseStatus = status;
        return {
          schema: "agentic-writer-lease/v1",
          status,
          epoch: 1,
          sessionId: "chat-a",
          device: "device",
          scope: "runtime-leases",
          branch,
          baseSha: "a".repeat(40),
          fenceSha: "b".repeat(40),
          heartbeatAt: "2026-07-17T10:00:00.000Z",
          expiresAt: "2026-07-17T10:00:00.000Z",
        };
      },
    },
    sessionId: "chat-a",
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.deepEqual(calls[0], ["git", "merge-base", "--is-ancestor", "b".repeat(40), "HEAD"]);
  assert.ok(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready"));
  assert.equal(releaseStatus, "delivery");
});

test("resume fences parked handoffs and same-session delivery revisions with a newer epoch", () => {
  for (const handoff of [
    { status: "parked", priorSessionId: "chat-old", sessionId: "chat-new" },
    { status: "delivery", priorSessionId: "chat-new", sessionId: "chat-new" },
  ]) {
    const calls = [];
    const branch = "agent/old-device/runtime-leases";
    const pullRequestUrl = "https://github.test/pull/1";
    const priorLease = {
      schema: "agentic-writer-lease/v1",
      status: handoff.status,
      epoch: 4,
      sessionId: handoff.priorSessionId,
      device: "old-device",
      scope: "runtime-leases",
      branch,
      baseSha: "a".repeat(40),
      fenceSha: "b".repeat(40),
      heartbeatAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:00:00.000Z",
    };
    const gitText = createGitText({
      "worktree list --porcelain": `worktree ${repo}\n`,
      "diff --name-only --diff-filter=U": "",
      "ls-files -u": "",
      "status --porcelain": "",
      [`rev-parse origin/${branch}`]: "c".repeat(40),
      "rev-parse HEAD": "d".repeat(40),
    });
    let claimInput = null;
    const resumedLease = {
      ...priorLease,
      status: "active",
      epoch: 5,
      sessionId: handoff.sessionId,
      device: "new-device",
      baseSha: "c".repeat(40),
      fenceSha: "d".repeat(40),
      pullRequestUrl,
      expiresAt: "2026-07-17T10:30:00.000Z",
    };

    const result = resume({
      branchName: branch,
      invocationPath: repo,
      repo,
      gitText,
      gitOptional: args => args[0] === "config" ? "new-device" : "",
      ghText: () => JSON.stringify([{
        number: 1,
        headRefName: branch,
        url: pullRequestUrl,
        body: renderWriterLeasePullRequestBody(priorLease),
      }]),
      leaseStore: {
        claim: input => { claimInput = input; return { ...resumedLease, fenceSha: null }; },
        annotate: () => resumedLease,
      },
      sessionId: handoff.sessionId,
      leaseTtlMs: 1_800_000,
      run: (command, args) => calls.push([command, ...args]),
      log: () => {},
      now: () => new Date("2026-07-17T10:05:00.000Z"),
    });

    assert.equal(claimInput.previousEpoch, 4);
    assert.equal(result.epoch, 5);
    assert.ok(calls.some(call => call.join(" ") === `git push origin ${branch}`));
    assert.ok(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit"));
  }
});

test("resume rejects a delivery revision claimed by another session", () => {
  const branch = "agent/device/runtime-leases";
  const priorLease = {
    schema: "agentic-writer-lease/v1",
    status: "delivery",
    epoch: 4,
    sessionId: "chat-old",
    device: "device",
    scope: "runtime-leases",
    branch,
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:00:00.000Z",
  };
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
  });

  assert.throws(() => resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: () => JSON.stringify([{
      number: 1,
      headRefName: branch,
      url: "https://github.test/pull/1",
      body: renderWriterLeasePullRequestBody(priorLease),
    }]),
    leaseStore: {},
    sessionId: "chat-new",
    leaseTtlMs: 1_800_000,
    run: () => {},
    now: () => new Date("2026-07-17T10:05:00.000Z"),
  }), /remains delivery under another session/);
});

test("park fails closed when local main does not equal origin/main after refresh", () => {
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "main\n",
    "status --porcelain": "",
    "rev-parse HEAD": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    "rev-parse origin/main": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
  });

  assert.throws(
    () => park({
      invocationPath: repo,
      repo,
      gitText,
      run: () => {},
    }),
    /main must match origin\/main after park/,
  );
});

test("completeSession switches to main only after the task pull request is merged", () => {
  const calls = [];
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%s": "",
    "status --porcelain": ["", ""],
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
      "1234567890abcdef1234567890abcdef12345678\n",
    ],
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
    }),
    run: (command, args) => calls.push([command, ...args]),
    log: message => logs.push(message),
  });

  assert.deepEqual(calls, [
    ["git", "fetch", "origin", "main"],
    ["git", "merge-base", "--is-ancestor", "abcdefabcdefabcdefabcdefabcdefabcdefabcd", "origin/main"],
    ["git", "switch", "main"],
    ["git", "merge", "--ff-only", "origin/main"],
  ]);
  assert.deepEqual(summary, {
    completedBranch: "agent/device/scope",
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
  });
  assert.match(logs[0], /Restart the local runtime from this SHA/);
});

test("completeSession fails closed while the pull request is open", () => {
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%s": "",
    "status --porcelain": "",
  });

  assert.throws(
    () => completeSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => JSON.stringify({
        state: "OPEN",
        baseRefName: "main",
        url: "https://github.com/example/repo/pull/42",
        mergeCommit: null,
        headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      }),
      run: () => {},
    }),
    /remains pending.*not merged/,
  );
});

test("completeSession fails closed while task work remains parked", () => {
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%s": "On agent/device/scope: park: agent/device/scope 20260717T010203Z\n",
    "status --porcelain": "",
  });

  assert.throws(
    () => completeSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => "",
      run: () => {},
    }),
    /remains parked in a named stash/,
  );
});

test("completeSession emits machine-readable merge and main evidence", () => {
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain": `worktree ${repo}\n`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%s": "",
    "status --porcelain": ["", ""],
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
      "1234567890abcdef1234567890abcdef12345678\n",
    ],
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
    }),
    run: () => {},
    log: message => logs.push(message),
    json: true,
  });

  assert.deepEqual(summary, {
    completedBranch: "agent/device/scope",
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
  });
  assert.equal(
    logs[0],
    JSON.stringify(summary),
  );
});
