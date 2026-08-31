import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync }
  from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { main, runCli }
  from "../scripts/expired-descendant-untracked-scope-recovery.mjs";

const DIGEST = "a".repeat(64);

test("plan requires the external task capability and writes private authority", async () => {
  const value = fixture(), calls = [];
  const result = await main(["plan", ...common(value),
    `--task-authority=${value.capability}`, `--output=${value.plan}`], {
    controllerRoot: value.controller,
    gitCommonDirectory: root => root,
    createAdapter: options => { calls.push(options); return {}; },
    createController: () => ({ plan: async () => ({ planDigest: DIGEST,
      exactAuthorization: `authorize expired-descendant-untracked-scope-recovery ${DIGEST}` }) }),
  });
  assert.equal(result.status, "planned");
  assert.equal(calls[0].taskAuthorityFile, value.capability);
  assert.equal(JSON.parse(readFileSync(value.plan, "utf8")).planDigest, DIGEST);
  await assert.rejects(main(["plan", ...common(value),
    `--output=${path.join(path.dirname(value.plan), "missing.json")}`], {
    controllerRoot: value.controller,
    gitCommonDirectory: root => root,
  }), /--task-authority=<value> is required/u);
});

test("run emits one JSON result and never grants provider projection", async () => {
  const value = fixture(); privateWrite(value.plan, JSON.stringify({ planDigest: DIGEST }));
  let stdout = "", received;
  const code = await runCli(["run", ...common(value),
    `--task-authority=${value.capability}`, `--plan-file=${value.plan}`,
    "--authorization=authorize exact"], {
    controllerRoot: value.controller,
    gitCommonDirectory: root => root,
    createAdapter: () => ({}),
    createController: () => ({ run: async input => {
      received = input;
      return { providerProjection: "deferred", pullRequestMutation: false };
    } }),
    stdout: { write: chunk => { stdout += chunk; } },
    stderr: { write: () => {} },
  });
  assert.equal(code, 0); assert.equal(received.authorization, "authorize exact");
  assert.equal(JSON.parse(stdout).completion.pullRequestMutation, false);
});

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "acos-expired-desc-")));
  const repository = path.join(root, "source"), controller = path.join(root, "controller"),
    external = path.join(root, "external");
  mkdirSync(repository); mkdirSync(controller); mkdirSync(external);
  const target = path.join(external, "target.json"), stop = path.join(external, "stop.json"),
    historical = path.join(external, "historical.json"),
    capability = path.join(external, "cap.json"), plan = path.join(external, "plan.json");
  privateWrite(target, "{}"); privateWrite(stop, "{}"); privateWrite(historical, "{}");
  privateWrite(capability, "{}");
  return { repository, controller, target, stop, historical, capability, plan };
}
function common(value) {
  return [`--repository=${value.repository}`, "--session=session:owner",
    `--target-manifest=${value.target}`, `--owner-stop-receipt=${value.stop}`,
    `--historical-owner-decision=${value.historical}`];
}
function privateWrite(file, value) {
  writeFileSync(file, `${value}\n`, { mode: 0o600 }); chmodSync(file, 0o600);
}
