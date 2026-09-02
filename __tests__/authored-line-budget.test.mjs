import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AUTHORED_LINE_BUDGET,
  countLines,
  evaluateLineBudget,
  isAuthoredPath,
  measureAuthoredFiles,
} from "../scripts/authored-line-budget.mjs";

const baseline = async () => JSON.parse(
  await readFile(new URL("../scripts/authored-line-budget.baseline.json", import.meta.url), "utf8"),
);

test("the recorded baseline holds against the tracked authored set", async () => {
  const { ceilings } = await baseline();
  const measured = await measureAuthoredFiles();
  assert.deepEqual(evaluateLineBudget({ measured, baseline: ceilings }).failures, []);
});

test("every baseline entry is genuinely over budget", async () => {
  const { budget, ceilings } = await baseline();
  assert.equal(budget, AUTHORED_LINE_BUDGET);
  for (const [relativePath, ceiling] of Object.entries(ceilings)) {
    assert.ok(ceiling > AUTHORED_LINE_BUDGET, `${relativePath} does not need a baseline entry`);
    assert.ok(isAuthoredPath(relativePath), `${relativePath} is not an authored path`);
  }
});

test("generated and vendored trees are out of scope", () => {
  for (const relativePath of [
    "node_modules/ajv/dist/ajv.js",
    "web/dist/index.html",
    "package-lock.json",
    "docs/FACTS.md",
    "README.md",
  ]) {
    assert.equal(isAuthoredPath(relativePath), false, relativePath);
  }
  for (const relativePath of ["scripts/doctor.mjs", "src/index.js", "web/app.js"]) {
    assert.equal(isAuthoredPath(relativePath), true, relativePath);
  }
});

test("a new file crossing the budget fails without a baseline entry", () => {
  const measured = new Map([["scripts/new-owner.mjs", AUTHORED_LINE_BUDGET + 1]]);
  const { failures } = evaluateLineBudget({ measured, baseline: {} });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /crosses the <600 authored line budget/);
  assert.match(failures[0], /split by responsibility/);
});

test("an existing offender may shrink but never grow", () => {
  const ceilings = { "scripts/legacy.mjs": 1_000 };
  assert.deepEqual(
    evaluateLineBudget({ measured: new Map([["scripts/legacy.mjs", 999]]), baseline: ceilings }).failures,
    [],
  );
  const grown = evaluateLineBudget({
    measured: new Map([["scripts/legacy.mjs", 1_001]]),
    baseline: ceilings,
  }).failures;
  assert.equal(grown.length, 1);
  assert.match(grown[0], /exceeds its recorded ceiling of 1000/);
  assert.match(grown[0], /non-increasing/);
});

test("an offender that returns to budget must leave the baseline", () => {
  const { failures } = evaluateLineBudget({
    measured: new Map([["scripts/legacy.mjs", 400]]),
    baseline: { "scripts/legacy.mjs": 1_000 },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /remove its baseline entry with --write/);
});

test("a deleted file must leave the baseline", () => {
  const { failures } = evaluateLineBudget({
    measured: new Map(),
    baseline: { "scripts/removed.mjs": 900 },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /absent from the tracked authored set/);
});

test("line counting ignores one trailing newline", () => {
  assert.equal(countLines("a\nb\n"), 2);
  assert.equal(countLines("a\nb"), 2);
  // Matches the counting already used by scripts/docs-contract.mjs, where an
  // empty file counts as one line rather than zero.
  assert.equal(countLines(""), 1);
});
