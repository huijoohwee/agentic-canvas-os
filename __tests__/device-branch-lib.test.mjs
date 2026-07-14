import test from "node:test";
import assert from "node:assert/strict";

import { createParkMessage, formatParkTimestamp, park } from "../scripts/device-branch-lib.mjs";

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
