import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseOptions, runTrial } from "../scripts/teardown-concurrency-trial.mjs";

test("accepts separated and inline option forms", () => {
  assert.deepEqual(parseOptions(["--trial-id", "trial", "--entry=scripts/x.mjs"]), {
    "trial-id": "trial", entry: "scripts/x.mjs",
  });
});

test("runs three real writer pairs per mechanism", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "teardown-concurrency-"));
  const left = path.join(root, "left"); const right = path.join(root, "right");
  await mkdir(left); await mkdir(right);
  const writer = path.join(root, "writer.mjs"); const resource = path.join(root, "resource.txt");
  await writeFile(writer, 'import { appendFileSync } from "node:fs"; const value=process.argv.find(v=>v.startsWith("--writer=")); appendFileSync(process.argv.find(v=>v.startsWith("--resource=")).slice(11), value+"\\n");');
  const result = await runTrial({ "trial-id": "trial-1", entry: "scripts/lease.mjs", writer, resource, "worktree-a": left, "worktree-b": right });
  assert.equal(result.runs.length, 6);
  assert.equal(result.runs.filter(run => run.mechanism === "active").length, 3);
  assert.ok(result.runs.every(run => run.startSkewMs <= 5000 && Number.isInteger(run.exitStatusA) && Number.isInteger(run.exitStatusB)));
});
