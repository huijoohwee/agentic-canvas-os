import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  main,
  parseArguments,
} from "../scripts/closed-absent-planned-owner-release.mjs";

const claimId = "a".repeat(64);
const branch = "agent/device/closed-owner";
const common = ["--repository=/workspace/repository", "--target-repository=owner/repository",
  `--branch=${branch}`, "--pull-request=17", `--claim-id=${claimId}`];

test("CLI transports a private plan and one-line exact authorization", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "closed-owner-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const planFile = path.join(root, "plan.json"), authFile = path.join(root, "authorization.txt");
  const plan = { schema: "fixture-plan", planDigest: "b".repeat(64) };
  const authorization = `authorize closed-absent-planned-owner-release ${plan.planDigest}`;
  writeFileSync(planFile, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  writeFileSync(authFile, `${authorization}\n`, { mode: 0o600 });
  chmodSync(planFile, 0o600); chmodSync(authFile, 0o600);
  const calls = [];
  const result = await main(["run", ...common, `--plan-file=${planFile}`, `--auth-file=${authFile}`], {
    createAdapter: options => (calls.push(options), {}),
    createController: () => ({ run: async input => (calls.push(input), { status: "complete" }) }),
  });
  assert.deepEqual(result, { status: "complete" });
  assert.deepEqual(calls.at(-1), { plan, authorization });
  assert.equal(calls[0].branch, branch);
  assert.equal(calls[0].pullRequestNumber, 17);
});

test("CLI rejects inline, relative, in-repository, and non-private authorization transport", t => {
  const root = mkdtempSync(path.join(tmpdir(), "closed-owner-cli-reject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const planFile = path.join(root, "plan.json"), authFile = path.join(root, "auth.txt");
  writeFileSync(planFile, "{}\n", { mode: 0o600 });
  writeFileSync(authFile, "authorization\n", { mode: 0o600 });
  assert.throws(() => parseArguments(["run", ...common, `--plan-file=${planFile}`,
    `--auth-file=${authFile}`, "--authorization=inline"]), /Unsupported/u);
  assert.throws(() => parseArguments(["run", ...common, "--plan-file=relative.json",
    `--auth-file=${authFile}`]), /absolute/u);
  chmodSync(authFile, 0o644);
  assert.throws(() => parseArguments(["run", ...common, `--plan-file=${planFile}`,
    `--auth-file=${authFile}`]), /owner-only/u);
  const inRepository = "/workspace/repository/plan.json";
  assert.throws(() => parseArguments(["run", ...common, `--plan-file=${inRepository}`,
    `--auth-file=${planFile}`]), /outside repository/u);
});

test("planning accepts no run authorization surface", () => {
  const parsed = parseArguments(["plan", ...common, "--json"]);
  assert.equal(parsed.action, "plan");
  assert.equal(parsed.json, true);
  assert.throws(() => parseArguments(["plan", ...common, "--auth-file=/private/auth.txt"]),
    /Unsupported/u);
});
