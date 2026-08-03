import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "scripts", "cloud-collaboration.mjs");

test("CLI and browser workflow expose delivery authorization but not internal bind", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "cloud-collaboration.yml"),
    "utf8",
  );
  assert.match(workflow, /^\s+- delivery-authorize$/mu);
  assert.match(workflow, /inputs\.action == 'delivery-authorize'/u);
  assert.match(workflow, /AGENTIC_CLOUD_OPERATOR_DECISION_DIGEST/u);
  assert.match(workflow, /AGENTIC_CLOUD_INTEGRATION_INTENT_DIGEST/u);
  assert.doesNotMatch(workflow, /^\s+- bind$/mu);
});

test("review reconciliation verifies a prior fence independently before exact PR-head bind", async () => {
  const authoritySource = await readFile(
    path.join(repositoryRoot, "scripts", "scoped-lane-cloud-authority.mjs"),
    "utf8",
  );
  assert.match(
    authoritySource,
    /reconciled\.authority\.laneRevision === headSha/u,
  );
  assert.match(
    authoritySource,
    /branch: verifiesCurrentPullRequestHead \? branch : null/u,
  );
  assert.match(
    authoritySource,
    /pullRequestNumber: verifiesCurrentPullRequestHead \? pullRequestNumber : null/u,
  );
});

test("event verification proves protected-main refresh before it reuses a delivery-authorized reviewed head", async () => {
  const cloudSource = await readFile(
    path.join(repositoryRoot, "scripts", "cloud-collaboration.mjs"),
    "utf8",
  );
  assert.match(cloudSource, /allowProtectedMainRefresh:\s*true/u);
  assert.match(cloudSource, /requireStatus:\s*"delivery_authorized"/u);
  assert.match(cloudSource, /verifyEventProtectedMainRefresh/u);
  assert.match(cloudSource, /Observed pull request base does not match the protected-main refresh parent/u);
  assert.match(cloudSource, /refs\/remotes\/pull\/\$\{pullRequestNumber\}\/head/u);
  assert.match(cloudSource, /--unshallow/u);
});

test("check-run failure summary surfaces the verifier message", async () => {
  const checkRunSource = await readFile(
    path.join(repositoryRoot, "scripts", "cloud-collaboration-check-run.mjs"),
    "utf8",
  );
  assert.match(checkRunSource, /result\?\.error\?\.message/u);
  assert.match(checkRunSource, /Failure: \$\{message\}\./u);
});

test("CLI rejects unexposed workflow actions before network access", () => {
  const result = spawnSync(process.execPath, [cli, "dispatch", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GH_TOKEN: "not-used",
      GITHUB_ACTIONS: "true",
      AGENTIC_CLOUD_ACTION: "bind",
    },
  });

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.match(output.error.message, /not an exposed cloud collaboration action/u);
  assert.equal(result.stdout.includes("not-used"), false);
});

test("merge-group verification fails closed without claiming generic readiness", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cloud-collaboration-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const eventPath = path.join(directory, "event.json");
  await writeFile(eventPath, JSON.stringify({ merge_group: { head_sha: "a".repeat(40) } }));

  const result = spawnSync(
    process.execPath,
    [cli, "verify-event", `--event-path=${eventPath}`, "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: "not-used" },
    },
  );

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.match(output.error.message, /exact member claims/u);
  assert.equal(result.stdout.includes(directory), false);
});
