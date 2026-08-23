import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../scripts/admitted-empty-abandoned-owner-retirement.mjs";

const digest = "a".repeat(64);
test("CLI transports exact authorization through one private file", async t => { const root = mkdtempSync(path.join(tmpdir(), "empty-owner-auth-"));
  t.after(() => rmSync(root, { recursive: true, force: true })); const auth = path.join(root, "authorization.txt");
  const phrase = `authorize admitted-empty-abandoned-owner-retirement ${digest}`; writeFileSync(auth, `${phrase}\n`, { mode: 0o600 }); chmodSync(auth, 0o600);
  const calls = [], common = ["--repository=/repo", "--subject-worktree=/subject", "--authored-worktree=/authored",
    "--target-repository=owner/repo", "--pull-request=7", `--claim-id=${digest}`, "--state-path=/private/state.json"];
  const dependencies = { createAdapter: options => (calls.push(options), {}), createController: () => ({
    plan: async () => ({ status: "planned" }), run: async input => (calls.push(input), { status: "complete" }) }) };
  await main(["run", ...common, `--plan-digest=${digest}`, `--auth-file=${auth}`], dependencies);
  assert.deepEqual(calls.at(-1), { planDigest: digest, authorization: phrase });
});
