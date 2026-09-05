import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

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
  assert.deepEqual(ceilings, {}, "resolved size debt must not return as repository exemptions");
  const measured = await measureAuthoredFiles();
  assert.deepEqual(evaluateLineBudget({ measured, baseline: ceilings }).failures, []);
});

test("every baseline entry is genuinely over budget", async () => {
  const { budget, ceilings } = await baseline();
  assert.equal(budget, AUTHORED_LINE_BUDGET);
  for (const [relativePath, ceiling] of Object.entries(ceilings)) {
    assert.ok(ceiling >= AUTHORED_LINE_BUDGET, `${relativePath} does not need a baseline entry`);
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
  for (const relativePath of ["scripts/doctor.mjs", "src/index.js", "web/build.mjs"]) {
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

test("the strict boundary accepts 599 lines and rejects exactly 600", () => {
  const measured = new Map([["src/within.js", 599], ["src/boundary.js", 600]]);
  const { failures, overBudget } = evaluateLineBudget({ measured, baseline: {} });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^src\/boundary\.js: 600 lines crosses/);
  assert.deepEqual([...overBudget], [["src/boundary.js", 600]]);
});

test("measurement permits tracked deletion and rejects unreadable tracked nodes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "acos-authored-measure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const source = path.join(root, "source.js");
  await writeFile(source, "export const value = 1;\n");
  execFileSync("git", ["add", "source.js"], { cwd: root });
  await rm(source);
  assert.deepEqual([...await measureAuthoredFiles({ repositoryRoot: root })], []);
  await mkdir(source);
  await assert.rejects(measureAuthoredFiles({ repositoryRoot: root }), { code: "EISDIR" });
  await rm(source, { recursive: true });
  await symlink("absent-target", source);
  await assert.rejects(measureAuthoredFiles({ repositoryRoot: root }), { code: "ENOENT" });
});

test("record mode refuses size exemptions and only clears resolved debt", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "acos-authored-record-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const scripts = path.join(root, "scripts");
  await mkdir(scripts);
  const script = path.join(scripts, "authored-line-budget.mjs");
  await writeFile(script, await readFile(new URL("../scripts/authored-line-budget.mjs", import.meta.url)));
  const recorded = path.join(scripts, "authored-line-budget.baseline.json");
  const original = JSON.stringify({ budget: 600, ceilings: { "source.js": 600 } });
  await writeFile(recorded, original);
  await writeFile(path.join(root, "source.js"), "// owned\n".repeat(600));
  execFileSync("git", ["add", "source.js"], { cwd: root });
  assert.throws(() => execFileSync(process.execPath, [script, "--write"], {
    cwd: root, stdio: "pipe",
  }), (error) => error.status === 1 && /Cannot record size exemptions/.test(error.stderr.toString()));
  assert.equal(await readFile(recorded, "utf8"), original);
  await writeFile(path.join(root, "source.js"), "// owned\n".repeat(599));
  execFileSync(process.execPath, [script, "--write"], { cwd: root, stdio: "pipe" });
  assert.deepEqual(JSON.parse(await readFile(recorded, "utf8")).ceilings, {});
});
