import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSource, isDiscardSink } from "../scripts/state-path-check.mjs";

test("discard sinks are not repository write offenders", () => {
  const discardRoot = "/" + "dev";
  const temporaryRoot = "/" + "tmp";
  for (const target of [discardRoot + "/null", discardRoot + "/stdout", discardRoot + "/stderr", discardRoot + "/fd/1", discardRoot + "/fd/22"]) {
    assert.equal(isDiscardSink(target), true);
  }
  const findings = analyzeSource({
    source: "tee " + discardRoot + "/null\ntee " + temporaryRoot + "/out\n",
    file: ".githooks/git-guarded",
    repositoryRoot: process.cwd(),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, temporaryRoot + "/out");
});
