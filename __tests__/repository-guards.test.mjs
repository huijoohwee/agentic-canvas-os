import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  assertCanonicalReadPath,
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertSingleCanonicalWorktree,
  parseWorktreePaths,
} from "../scripts/repository-guards.mjs";

const resolvePath = (value) => path.resolve("/", value);

test("parseWorktreePaths reads only registered worktree records", () => {
  assert.deepEqual(parseWorktreePaths("worktree /repo\nHEAD abc\nbranch refs/heads/main\n"), ["/repo"]);
});

test("canonical read paths reject another checkout or subdirectory", () => {
  assert.equal(assertCanonicalReadPath({ root: "/repo", cwd: "/repo", resolvePath }), "/repo");
  assert.throws(
    () => assertCanonicalReadPath({ root: "/repo", cwd: "/repo-copy", resolvePath }),
    /must read from the canonical checkout/,
  );
});

test("single-worktree guard rejects secondary or mismatched worktrees", () => {
  assert.equal(
    assertSingleCanonicalWorktree({ root: "/repo", porcelain: "worktree /repo\n", resolvePath }),
    "/repo",
  );
  assert.throws(
    () => assertSingleCanonicalWorktree({ root: "/repo", porcelain: "worktree /repo\n\nworktree /repo-copy\n", resolvePath }),
    /Exactly one canonical worktree/,
  );
});

test("unmerged index entries block commits and publication", () => {
  assert.doesNotThrow(() => assertNoUnmergedPaths({ conflictPaths: "", indexEntries: "" }));
  assert.throws(
    () => assertNoUnmergedPaths({ conflictPaths: "COLLABORATION.md", indexEntries: "100644 1 file" }),
    /Resolve every merge conflict/,
  );
});

test("only the active branch may own an open delivery PR", () => {
  const own = { number: 18, headRefName: "agent/device/scope" };
  assert.equal(assertNoCompetingPullRequests([own], own.headRefName), own);
  assert.throws(
    () => assertNoCompetingPullRequests([own, { number: 14, headRefName: "agent/other/scope" }], own.headRefName),
    /Exactly one active delivery PR/,
  );
});
