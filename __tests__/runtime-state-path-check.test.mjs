import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { analyzeSource, firstOffender } from "../scripts/state-path-check.mjs";

const root = "/workspace/repository";
test("detects literal, template, constant, join, resolve, and home write targets", () => {
  const fixtures = [
    'writeFileSync("../outside", "x")', 'mkdirSync(`../../state`)',
    'const target = "../outside";\nappendFileSync(target, "x")',
    'copyFileSync(path.join("..", "source"), "inside")',
    'rmSync(path.resolve("..", "outside"))', 'mkdirSync(os.homedir())',
  ];
  for (const source of fixtures) assert.equal(analyzeSource({ source, file: "scripts/x.mjs", repositoryRoot: root }).length, 1, source);
});

test("documents dynamic blind spots", () => {
  for (const source of ['writeFileSync(process.env.TARGET, "x")', 'mkdirSync(process.argv[2])', 'writeSomewhere(target)', 'spawn("mkdir", args)']) assert.deepEqual(analyzeSource({ source, file: "scripts/x.mjs", repositoryRoot: root }), []);
});

test("reports only the first ordered offender", () => {
  const offender = firstOffender({ repositoryRoot: root, files: ["scripts/b.mjs", "scripts/a.mjs"], read: file => file.endsWith("a.mjs") ? 'mkdirSync("../first")' : 'mkdirSync("../second")' });
  assert.equal(offender.file, "scripts/a.mjs");
  assert.equal(offender.target, path.resolve(root, "../first"));
});
