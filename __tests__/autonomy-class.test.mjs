// Proves the promotion ceiling is computed from the write set, that a mixed set
// resolves upward, and that the classifier cannot widen its own authority.
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORITY_PATTERNS,
  CLASS_ADDITIVE_CONTRACT,
  CLASS_AUTHORITY_CONTROLLING,
  CLASS_BEHAVIORAL,
  CLASS_DOCS_ONLY,
  CLASS_ORDER,
  CLASS_TEST_ONLY,
  classifyPath,
  classifyWriteSet,
  collectWriteSet,
  coversClass,
} from "../scripts/autonomy-class.mjs";

test("documentation and tests classify by path alone", () => {
  assert.equal(classifyPath("docs/START-WORKFLOW.md"), CLASS_DOCS_ONLY);
  assert.equal(classifyPath("README.md"), CLASS_DOCS_ONLY);
  assert.equal(classifyPath("llms.txt"), CLASS_DOCS_ONLY);
  assert.equal(classifyPath("__tests__/anything.test.mjs"), CLASS_TEST_ONLY);
});

test("a new module is additive and a modified one is behavioral", () => {
  const added = classifyWriteSet([{ path: "scripts/new-thing.mjs", added: true }]);
  assert.equal(added.class, CLASS_ADDITIVE_CONTRACT);
  assert.equal(added.escalates, false);

  const modified = classifyWriteSet([{ path: "scripts/new-thing.mjs", added: false }]);
  assert.equal(modified.class, CLASS_BEHAVIORAL);
  assert.equal(modified.escalates, false);
});

test("every authority surface classifies as authority-controlling", () => {
  for (const candidate of [
    ".githooks/pre-push",
    ".github/workflows/ci.yml",
    "scripts/writer-lease-lib.mjs",
    "scripts/task-bound-lane-authority-contract.mjs",
    "scripts/device-branch-ownership-lib.mjs",
    "scripts/scoped-lane-admission.mjs",
    "scripts/workspace-guard-hook.mjs",
    "scripts/lane-projection-reconciliation.mjs",
    ".agentic-runtime/workflow-task-authority.json",
    "config/credentials.json",
  ]) {
    assert.equal(classifyPath(candidate), CLASS_AUTHORITY_CONTROLLING, candidate);
  }
});

test("the classifier classifies itself as authority-controlling", () => {
  // Autonomy must not be able to widen its own definition, so the table and the
  // module that reads it are inside the class they gate.
  assert.equal(classifyPath("scripts/autonomy-class.mjs"), CLASS_AUTHORITY_CONTROLLING);
  assert.ok(AUTHORITY_PATTERNS.some((pattern) => pattern.test("scripts/autonomy-class.mjs")));
});

test("a mixed write set resolves to its highest class", () => {
  const report = classifyWriteSet([
    "docs/NOTES.md",
    { path: "__tests__/a.test.mjs", added: true },
    { path: "scripts/feature.mjs", added: true },
    { path: ".githooks/pre-commit", added: false },
  ]);
  assert.equal(report.class, CLASS_AUTHORITY_CONTROLLING);
  assert.equal(report.escalates, true);
  assert.deepEqual(report.escalatingPaths, [".githooks/pre-commit"]);
});

test("an empty write set promotes nothing and escalates nothing", () => {
  const report = classifyWriteSet([]);
  assert.equal(report.class, CLASS_DOCS_ONLY);
  assert.equal(report.escalates, false);
});

test("a standing grant covers classes at or below its ceiling", () => {
  assert.equal(coversClass({ grantCeiling: CLASS_BEHAVIORAL, derivedClass: CLASS_DOCS_ONLY }), true);
  assert.equal(coversClass({ grantCeiling: CLASS_BEHAVIORAL, derivedClass: CLASS_BEHAVIORAL }), true);
  assert.equal(
    coversClass({ grantCeiling: CLASS_ADDITIVE_CONTRACT, derivedClass: CLASS_BEHAVIORAL }),
    false,
    "a grant never covers a class above its ceiling",
  );
});

test("no grant ever covers an authority-controlling candidate", () => {
  for (const grantCeiling of CLASS_ORDER) {
    assert.equal(
      coversClass({ grantCeiling, derivedClass: CLASS_AUTHORITY_CONTROLLING }),
      false,
      `${grantCeiling} must not cover an escalating class`,
    );
  }
});

test("an unknown ceiling or class never covers anything", () => {
  assert.equal(coversClass({ grantCeiling: "invented", derivedClass: CLASS_DOCS_ONLY }), false);
  assert.equal(coversClass({ grantCeiling: CLASS_BEHAVIORAL, derivedClass: "invented" }), false);
});

test("the write set is read from the diff, added status included", () => {
  const report = collectWriteSet({
    repository: "/repo",
    base: "base",
    head: "head",
    git: () => "A\tscripts/new.mjs\nM\tdocs/OLD.md\nA\t__tests__/n.test.mjs\n",
  });
  assert.deepEqual(report, [
    { path: "scripts/new.mjs", added: true },
    { path: "docs/OLD.md", added: false },
    { path: "__tests__/n.test.mjs", added: true },
  ]);
  assert.equal(classifyWriteSet(report).class, CLASS_ADDITIVE_CONTRACT);
});

test("a rename records its destination path", () => {
  const report = collectWriteSet({
    repository: "/repo",
    base: "base",
    head: "head",
    git: () => "R100\tdocs/a.md\tdocs/b.md\n",
  });
  assert.deepEqual(report, [{ path: "docs/b.md", added: false }]);
});
