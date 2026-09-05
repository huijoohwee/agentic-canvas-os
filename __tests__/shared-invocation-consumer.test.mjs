import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { resolveInvocation } from "../scripts/invocation-resolve.mjs";

const execFileAsync = promisify(execFile);

test("CLI resolves shared grammar against ACOS dictionaries with opaque binding arguments", async () => {
  const tokens = ["/game.portability", "#game-portability", "@file:src/main.js:1-4"];
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    fileURLToPath(new URL("../scripts/invocation-resolve.mjs", import.meta.url)),
    ...tokens,
  ], { timeout: 5_000 });
  const result = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(result.ok, true);
  assert.deepEqual(result.tokens, tokens);
  assert.deepEqual(result.results.map(({ entry }) => entry.token), [
    "/game.portability", "#game-portability", "@file:",
  ]);
  assert.equal(result.results[2].entry.sourceDocumentPath,
    "agentic-canvas-os/docs/DICTIONARY-BINDING.md");
  assert.ok(result.costRecords.every((record) => record.modelIdentity === null
    && record.promptTokenCount === 0 && record.completionTokenCount === 0
    && record.estimatedCost === 0));
});

test("binding arguments retain the accepted size boundary and reject before dictionary reads", async () => {
  const accepted = await resolveInvocation(`@url:${"x".repeat(1_024)}`);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.results[0].entry.token, "@url:");

  for (const [token, violatedRule] of [
    [`@url:${"x".repeat(1_025)}`, "argument-too-long"],
    ["/query:argument", "invalid-remainder-character"],
    ["#topic:argument", "invalid-remainder-character"],
  ]) {
    let reads = 0;
    const rejected = await resolveInvocation(token, {
      readDictionary: async () => { reads += 1; throw new Error("unexpected dictionary read"); },
    });
    assert.equal(rejected.code, "malformed-token");
    assert.equal(rejected.error.violatedRule, violatedRule);
    assert.equal(reads, 0);
    assert.deepEqual(rejected.costRecords, []);
  }
});
