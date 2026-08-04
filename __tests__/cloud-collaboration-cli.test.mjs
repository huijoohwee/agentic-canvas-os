import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "scripts", "cloud-collaboration.mjs");

test("CLI and workflow expose exactly four provider-neutral root mutations", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "cloud-collaboration.yml"),
    "utf8",
  );
  for (const operation of ["claim", "continue", "integrate", "retire"]) {
    assert.match(workflow, new RegExp(`^\\s+- ${operation}$`, "mu"));
    assert.match(workflow, new RegExp(`inputs\\.action == '${operation}'`, "u"));
  }
  assert.match(workflow, /AGENTIC_CLOUD_OPERATOR_DECISION_DIGEST/u);
  assert.match(workflow, /AGENTIC_CLOUD_INTEGRATION_INTENT_DIGEST/u);
  for (const legacy of ["bind", "heartbeat", "review-ready", "delivery-authorize", "handoff", "release"]) {
    assert.doesNotMatch(workflow, new RegExp(`^\\s+- ${legacy}$`, "mu"));
  }
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

test("event verification proves protected-main refresh for an integrated-preserved candidate", async () => {
  const cloudSource = await readFile(
    path.join(repositoryRoot, "scripts", "cloud-collaboration.mjs"),
    "utf8",
  );
  assert.match(cloudSource, /allowProtectedMainRefresh:\s*true/u);
  assert.match(cloudSource, /requireStatus:\s*"integrated-preserved"/u);
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
      AGENTIC_CLOUD_ACTION: "heartbeat",
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
