import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  assertMainWorktree,
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
  assertUniquePullRequestScopes,
  assertWorktreeRegistry,
  parseWorktreePaths,
  parseWorktreeRecords,
} from "../scripts/repository-guards.mjs";

const resolvePath = (value) => path.resolve("/", value);

test("parseWorktreePaths reads only registered worktree records", () => {
  const porcelain = "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /tasks/camera\0HEAD def\0detached\0";
  assert.deepEqual(parseWorktreePaths(porcelain), ["/repo", "/tasks/camera"]);
  assert.deepEqual(parseWorktreeRecords(porcelain), [
    { path: "/repo", head: "abc", branch: "refs/heads/main" },
    { path: "/tasks/camera", head: "def", detached: true },
  ]);
});

test("registered worktree guard accepts parallel task worktrees and rejects unregistered paths", () => {
  const porcelain = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /tasks/camera\nHEAD def\ndetached\n";
  assert.equal(assertRegisteredWorktree({ cwd: "/tasks/camera", porcelain, resolvePath }).path, "/tasks/camera");
  assert.throws(
    () => assertRegisteredWorktree({ cwd: "/repo-copy", porcelain, resolvePath }),
    /live registered worktree/,
  );
});

test("main synchronization remains bound to the registered main worktree", () => {
  const porcelain = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /tasks/camera\nHEAD def\nbranch refs/heads/agent/mac/camera\n";
  assert.equal(
    assertMainWorktree({ cwd: "/repo", porcelain, resolvePath }).path,
    "/repo",
  );
  assert.throws(
    () => assertMainWorktree({ cwd: "/tasks/camera", porcelain, resolvePath }),
    /registered main worktree/,
  );
});

test("worktree registry rejects prunable paths and duplicate checked-out branches", () => {
  assert.throws(
    () => assertWorktreeRegistry({ porcelain: "worktree /tasks/stale\nprunable missing\n", resolvePath }),
    /unavailable or prunable/,
  );
  assert.throws(
    () => assertWorktreeRegistry({
      porcelain: "worktree /repo\nbranch refs/heads/agent/device/scope\n\nworktree /tasks/scope\nbranch refs/heads/agent/device/scope\n",
      resolvePath,
    }),
    /active in multiple worktrees/,
  );
});

test("unmerged index entries block commits and publication", () => {
  assert.doesNotThrow(() => assertNoUnmergedPaths({ conflictPaths: "", indexEntries: "" }));
  assert.throws(
    () => assertNoUnmergedPaths({ conflictPaths: "COLLABORATION.md", indexEntries: "100644 1 file" }),
    /Resolve every merge conflict/,
  );
});

test("parallel pull requests require unique semantic scopes", () => {
  const own = { number: 18, headRefName: "agent/device/scope" };
  assert.equal(assertNoCompetingPullRequests([own], own.headRefName), own);
  assert.doesNotThrow(() => assertUniquePullRequestScopes([
    own,
    { number: 14, headRefName: "agent/other/other-scope" },
  ]));
  assert.throws(
    () => assertNoCompetingPullRequests(
      [own, { number: 14, headRefName: "agent/other/scope" }],
      own.headRefName,
    ),
    /multiple active pull requests/,
  );
});
