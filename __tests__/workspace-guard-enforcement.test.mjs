import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  DESTRUCTIVE_OPERATION_CLASSES,
  ENFORCEMENT_SURFACES,
  assertRefTransactionSafety,
  buildEnforcementCoverageReport,
  classifyRefUpdate,
  isZeroSha,
} from "../scripts/workspace-parallelism-lib.mjs";
import {
  HOOK_SURFACES,
  buildShim,
  discoverRepositories,
  planHookInstall,
  applyHookInstall,
  resolveWorkspaceRoot,
} from "../scripts/install-workspace-guards.mjs";

const ZERO = "0".repeat(40);
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

const ownedLane = {
  repository: "knowgrph",
  worktree: "/GitHub/knowgrph",
  branch: "refs/heads/docs/payments",
  session: "session-a",
  scope: "payments",
  dirtyTrackedPaths: 0,
  untrackedPaths: 0,
  recoveryRef: null,
};

test("zero sha detection accepts both sha1 and sha256 widths", () => {
  assert.equal(isZeroSha(ZERO), true);
  assert.equal(isZeroSha("0".repeat(64)), true);
  assert.equal(isZeroSha(OLD), false);
  assert.equal(isZeroSha(""), false);
});

test("ref updates classify as create, update, rewind, delete, or noop", () => {
  const ff = (from, to) => true;
  const nonFf = () => false;
  assert.equal(classifyRefUpdate({ ref: "refs/heads/x", oldSha: ZERO, newSha: NEW }).kind, "create");
  assert.equal(classifyRefUpdate({ ref: "refs/heads/x", oldSha: OLD, newSha: ZERO }).kind, "delete");
  assert.equal(classifyRefUpdate({ ref: "refs/heads/x", oldSha: OLD, newSha: OLD }).kind, "noop");
  assert.equal(classifyRefUpdate({ ref: "refs/heads/x", oldSha: OLD, newSha: NEW, isAncestor: ff }).kind, "update");
  assert.equal(classifyRefUpdate({ ref: "refs/heads/x", oldSha: OLD, newSha: NEW, isAncestor: nonFf }).kind, "rewind");
  assert.throws(() => classifyRefUpdate({ ref: "", oldSha: OLD, newSha: NEW }), /requires a ref name/);
});

test("fast-forward and create transactions pass without a recovery reference", () => {
  const decision = assertRefTransactionSafety({
    updates: [
      { ref: "refs/heads/docs/payments", oldSha: OLD, newSha: NEW },
      { ref: "refs/heads/new", oldSha: ZERO, newSha: NEW },
    ],
    lane: ownedLane,
    session: "session-a",
    isAncestor: () => true,
  });
  assert.equal(decision.decision, "allow");
});

test("a rewind on a foreign lane is refused and names the owner", () => {
  assert.throws(
    () => assertRefTransactionSafety({
      updates: [{ ref: "refs/heads/docs/payments", oldSha: OLD, newSha: NEW }],
      lane: ownedLane,
      session: "session-z",
      isAncestor: () => false,
    }),
    /Session session-z cannot apply rewind refs\/heads\/docs\/payments.*owned by session-a/,
  );
});

test("a ref deletion is refused while the lane holds untracked work", () => {
  assert.throws(
    () => assertRefTransactionSafety({
      updates: [{ ref: "refs/heads/docs/payments", oldSha: OLD, newSha: ZERO }],
      lane: { ...ownedLane, untrackedPaths: 2 },
      session: "session-a",
      isAncestor: () => true,
    }),
    /holds 2 untracked path\(s\) that no ref can restore/,
  );
});

test("a rewind on a dirty owned lane requires an existing durable recovery reference", () => {
  const dirty = { ...ownedLane, dirtyTrackedPaths: 3 };
  assert.throws(
    () => assertRefTransactionSafety({
      updates: [{ ref: "refs/heads/docs/payments", oldSha: OLD, newSha: NEW }],
      lane: dirty,
      session: "session-a",
      isAncestor: () => false,
    }),
    /declares no recovery reference/,
  );
  const decision = assertRefTransactionSafety({
    updates: [{ ref: "refs/heads/docs/payments", oldSha: OLD, newSha: NEW }],
    lane: { ...dirty, recoveryRef: "refs/heads/recovery/payments" },
    session: "session-a",
    refs: ["refs/heads/recovery/payments"],
    isAncestor: () => false,
  });
  assert.equal(decision.decision, "allow-with-recovery");
  assert.equal(decision.recoveryRef, "refs/heads/recovery/payments");
});

test("ref transaction review requires the acting session", () => {
  assert.throws(
    () => assertRefTransactionSafety({ updates: [], lane: ownedLane, session: "" }),
    /requires the acting session id/,
  );
});

test("enforcement coverage names the hook gap instead of claiming full coverage", () => {
  const coverage = buildEnforcementCoverageReport();
  assert.equal(coverage.wrapperRequired, true);
  // Git exposes no hook for working-tree-only commands, and none for gc or reflog
  // expiry, so these three classes are reachable only through the wrapper.
  assert.deepEqual([...coverage.hookGapClasses], ["forcedCheckout", "objectPruning", "untrackedRemoval"]);
  for (const cls of coverage.hookGapClasses) {
    assert.ok(!coverage.hookCoveredClasses.includes(cls), `${cls} must not be claimed as hook-covered`);
  }
  assert.deepEqual(
    [...ENFORCEMENT_SURFACES.wrapper.covers].sort(),
    Object.keys(DESTRUCTIVE_OPERATION_CLASSES).sort(),
    "the wrapper must cover every catalog class",
  );
});

test("every hook surface in the installer has a declared enforcement surface", () => {
  for (const surface of HOOK_SURFACES) {
    assert.ok(ENFORCEMENT_SURFACES[surface], `${surface} must declare what it proves`);
    assert.equal(typeof ENFORCEMENT_SURFACES[surface].proves, "string");
  }
});

test("the workspace root resolves from configuration before the default parent", () => {
  assert.equal(resolveWorkspaceRoot({ env: { AGENTIC_WORKSPACE_ROOT: "/custom/root" } }), path.resolve("/custom/root"));
  assert.ok(resolveWorkspaceRoot({ env: {} }).length > 0);
});

test("repository discovery skips dotted directories and non-repositories", () => {
  const entries = [
    { name: "knowgrph", isDirectory: () => true },
    { name: ".git-worktrees", isDirectory: () => true },
    { name: ".backups", isDirectory: () => true },
    { name: "notes.md", isDirectory: () => false },
    { name: "not-a-repo", isDirectory: () => true },
  ];
  const repositories = discoverRepositories({
    workspaceRoot: "/GitHub",
    listEntries: () => entries,
  });
  assert.ok(repositories.every((candidate) => !path.basename(candidate).startsWith(".")));
});

test("hook install points every repository at one hook source of truth", () => {
  const plan = planHookInstall({ repositories: ["/GitHub/knowgrph", "/GitHub/agentic-canvas-os"], home: "/GitHub/agentic-canvas-os" });
  assert.equal(plan.length, 2);
  assert.equal(new Set(plan.map((entry) => entry.hooksPath)).size, 1, "one hooksPath for the whole workspace");
  assert.equal(plan[0].hooksPath, path.join("/GitHub/agentic-canvas-os", ".githooks"));
  assert.equal(plan.find((entry) => entry.repository === "/GitHub/agentic-canvas-os").isGuardHome, true);
  assert.equal(plan.find((entry) => entry.repository === "/GitHub/knowgrph").isGuardHome, false);
});

test("hook install only writes hook configuration and reports per repository", () => {
  const calls = [];
  const lines = [];
  const applied = applyHookInstall({
    plan: planHookInstall({ repositories: ["/GitHub/knowgrph", "/GitHub/broken"], home: "/GitHub/agentic-canvas-os" }),
    spawn: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status: options.cwd.endsWith("broken") ? 1 : 0, stdout: "", stderr: "" };
    },
    write: (text) => lines.push(text.trim()),
  });
  assert.deepEqual(applied, ["/GitHub/knowgrph"]);
  assert.ok(calls.every((call) => call.command === "git" && call.args[0] === "config" && call.args[1] === "core.hooksPath"));
  assert.ok(lines.some((line) => line.includes("hooked knowgrph")));
  assert.ok(lines.some((line) => line.includes("skipped broken")));
});

test("the PATH shim points external tooling at the wrapper and carries the guard home", () => {
  const shim = buildShim({ home: "/GitHub/agentic-canvas-os" });
  assert.match(shim, /^#!\/bin\/sh/);
  assert.match(shim, /AGENTIC_WORKSPACE_GUARD_HOME="\/GitHub\/agentic-canvas-os"/);
  assert.match(shim, /exec "\/GitHub\/agentic-canvas-os\/\.githooks\/git-guarded" "\$@"/);
});
