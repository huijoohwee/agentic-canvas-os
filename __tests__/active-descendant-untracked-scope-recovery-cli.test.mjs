import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main, runCli } from "../scripts/active-descendant-untracked-scope-recovery.mjs";

const DIGEST = "a".repeat(64);
const AUTHORIZATION = `authorize active-descendant-untracked-scope-recovery ${DIGEST}`;

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "acos-untracked-cli-")));
  const repository = path.join(root, "source"), controllerRoot = path.join(root, "controller");
  const external = path.join(root, "external");
  mkdirSync(repository); mkdirSync(controllerRoot); mkdirSync(external);
  const targetManifest = path.join(external, "target.json");
  const ownerStop = path.join(external, "owner-stop.json");
  const taskAuthority = path.join(external, "task-authority.json");
  const planFile = path.join(external, "plan.json");
  privateWrite(targetManifest, "{}\n"); privateWrite(ownerStop, "{}\n");
  privateWrite(taskAuthority, "{}\n");
  return { repository, controllerRoot, targetManifest, ownerStop, taskAuthority, planFile };
}

function common(value) {
  return [`--repository=${value.repository}`, "--session=session:owner",
    `--target-manifest=${value.targetManifest}`, `--owner-stop-receipt=${value.ownerStop}`];
}

test("plan is read-only, task-bound, and writes one private external plan", async () => {
  const value = fixture(), output = path.join(path.dirname(value.planFile), "planned.json");
  const calls = [];
  const result = await main(["plan", ...common(value),
    `--task-authority=${value.taskAuthority}`, `--output=${output}`], {
    controllerRoot: value.controllerRoot,
    createAdapter: options => { calls.push(["adapter", options]); return Object.freeze({}); },
    createController: adapter => ({ plan: async () => {
      calls.push(["plan", adapter]);
      return { schema: "test-plan/v1", planDigest: DIGEST, exactAuthorization: AUTHORIZATION };
    } }),
  });
  assert.equal(result.status, "planned");
  assert.equal(result.exactAuthorization, AUTHORIZATION);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(output, "utf8")).planDigest, DIGEST);
  assert.equal(calls[0][1].taskAuthorityFile, value.taskAuthority);
  assert.deepEqual(calls.map(item => item[0]), ["adapter", "plan"]);

  await assert.rejects(
    main(["plan", ...common(value), `--output=${path.join(path.dirname(output), "wrong.json")}`,
      `--authorization=${AUTHORIZATION}`], { controllerRoot: value.controllerRoot }),
    /Unsupported --authorization/u,
  );
  await assert.rejects(
    main(["plan", ...common(value),
      `--output=${path.join(path.dirname(output), "missing-cap.json")}`], {
      controllerRoot: value.controllerRoot,
    }),
    /--task-authority=<value> is required/u,
  );
});

test("owner-stop writes one private content-bound receipt before planning", async () => {
  const value = fixture(), output = path.join(path.dirname(value.planFile), "stopped.json");
  const receipt = { schema: "test-owner-stop/v1", receiptDigest: DIGEST };
  const result = await main(["owner-stop", `--repository=${value.repository}`,
    "--session=session:owner", `--task-authority=${value.taskAuthority}`,
    `--output=${output}`], {
    controllerRoot: value.controllerRoot,
    createAdapter: options => ({ createOwnerStopReceipt: async () => {
      assert.equal(options.taskAuthorityFile, value.taskAuthority);
      assert.equal(options.targetManifestFile, null);
      return receipt;
    } }),
  });
  assert.equal(result.status, "owner-stopped");
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), receipt);
});

test("run consumes external plan, capability, and exact authorization as JSON", async () => {
  const value = fixture();
  privateWrite(value.planFile, `${JSON.stringify({ planDigest: DIGEST, exactAuthorization: AUTHORIZATION })}\n`);
  let received, stdout = "", stderr = "", providerMutations = 0;
  const code = await runCli(["run", ...common(value), `--plan-file=${value.planFile}`,
    `--task-authority=${value.taskAuthority}`, `--authorization=${AUTHORIZATION}`], {
    controllerRoot: value.controllerRoot,
    createAdapter: options => ({ options, mutateProvider: () => { providerMutations += 1; } }),
    createController: adapter => ({ run: async input => {
      received = { adapter, ...input };
      assert.equal(input.authorization, input.plan.exactAuthorization);
      return { status: "authoring-authority-restored", providerMutation: false };
    } }),
    stdout: { write: chunk => { stdout += chunk; } },
    stderr: { write: chunk => { stderr += chunk; } },
  });
  assert.equal(code, 0); assert.equal(stderr, ""); assert.equal(providerMutations, 0);
  assert.equal(JSON.parse(stdout).status, "complete");
  assert.equal(received.adapter.options.taskAuthorityFile, value.taskAuthority);
  assert.equal(received.authorization, AUTHORIZATION);
});

test("run fails closed on non-exact authorization", async () => {
  const value = fixture();
  privateWrite(value.planFile, `${JSON.stringify({ planDigest: DIGEST, exactAuthorization: AUTHORIZATION })}\n`);
  let stderr = "";
  const code = await runCli(["run", ...common(value), `--plan-file=${value.planFile}`,
    `--task-authority=${value.taskAuthority}`, "--authorization=authorize wrong"], {
    controllerRoot: value.controllerRoot,
    createAdapter: () => ({}),
    createController: () => ({ run: async ({ plan, authorization }) => {
      if (authorization !== plan.exactAuthorization) throw new Error("exact authorization required");
    } }),
    stdout: { write: () => {} }, stderr: { write: chunk => { stderr += chunk; } },
  });
  assert.equal(code, 1);
  assert.match(JSON.parse(stderr).error, /exact authorization/u);
});

function privateWrite(file, value) {
  writeFileSync(file, value, { mode: 0o600 });
  chmodSync(file, 0o600);
}
