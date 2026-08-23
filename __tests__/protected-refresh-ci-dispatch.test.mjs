import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ci.yml");
const protectedRefreshAdapterPath = path.join(
  repositoryRoot,
  "scripts",
  "protected-head-refresh-github-adapter.mjs",
);
const headSha = "a".repeat(40);
const mainSha = "b".repeat(40);
const operationId = "c".repeat(64);
const workflowBlob = "d".repeat(40);

const workflow = await readFile(workflowPath, "utf8");
const protectedRefreshAdapter = await readFile(protectedRefreshAdapterPath, "utf8");

test("protected refresh verifies the repository-policy workflow bytes", () => {
  assert.match(
    protectedRefreshAdapter,
    /const policy = readProtectedHeadRefreshRepositoryPolicy\(\{ environment \}\);/u,
  );
  assert.match(
    protectedRefreshAdapter,
    /const workflowPath = `\.github\/workflows\/\$\{policy\.ciWorkflow\}`;/u,
  );
  assert.doesNotMatch(
    protectedRefreshAdapter,
    /const workflowPath = ["']\.github\/workflows\/ci\.yml["'];/u,
  );
});

function jobSource(jobId) {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  assert.notEqual(start, -1, `missing ${jobId} job`);
  const body = start + `\n  ${jobId}:`.length;
  const next = workflow.slice(body).search(/^  [a-z][a-z0-9-]*:/mu);
  return next < 0
    ? workflow.slice(start)
    : workflow.slice(start, body + next);
}

function stepScript(stepName) {
  const lines = workflow.split("\n");
  const step = lines.indexOf(`      - name: ${stepName}`);
  assert.notEqual(step, -1, `missing ${stepName} step`);
  const run = lines.indexOf("        run: |", step);
  assert.ok(run > step, `missing script for ${stepName}`);
  const script = [];
  for (let index = run + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== "" && !line.startsWith("          ")) break;
    script.push(line.startsWith("          ") ? line.slice(10) : "");
  }
  return `${script.join("\n")}\n`;
}

test("CI dispatch exposes only the exact protected-refresh projection and title", () => {
  const dispatch = workflow.match(
    /^  workflow_dispatch:\n    inputs:\n([\s\S]*?)(?=^permissions:)/mu,
  );
  assert.ok(dispatch, "workflow_dispatch inputs must be explicit");
  const names = [...dispatch[1].matchAll(/^      ([a-z_]+):$/gmu)].map(match => match[1]);
  assert.deepEqual(names, [
    "operation",
    "pull_request_number",
    "branch",
    "expected_head_sha",
    "operation_id",
  ]);
  for (const name of names) {
    const input = dispatch[1].match(
      new RegExp(`^      ${name}:\\n(?:        .+\\n)+`, "mu"),
    )?.[0] ?? "";
    assert.match(input, /^        required: true$/mu, `${name} must be required`);
    assert.match(input, /^        type: string$/mu, `${name} must preserve canonical text`);
  }
  assert.match(
    workflow,
    /^run-name: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('Protected head refresh \{0\} \{1\}', inputs\.operation_id, inputs\.expected_head_sha\)/mu,
  );
  assert.match(workflow, /^  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]$/mu);
  assert.match(workflow, /^  merge_group:$/mu);
  assert.match(workflow, /^  push:\n    branches: \[main\]$/mu);
  assert.match(
    workflow,
    /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'workflow_dispatch' && format\('\{0\}-\{1\}', inputs\.operation_id, github\.run_id\)/,
  );
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}/);
  assert.match(workflow, /duplicate operations in\n  # distinct groups/);
});

test("dispatch authorization is read-only and proves the candidate workflow blob", () => {
  const authorization = jobSource("authorization");
  assert.match(authorization, /^    name: protected-head-refresh-authorization$/mu);
  assert.match(authorization, /^    runs-on: 'ubuntu-slim'$/mu);
  assert.match(
    authorization,
    /ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false\n          fetch-depth: 1/,
  );
  assert.match(authorization, /\[ "\$DISPATCH_OPERATION" = "protected-head-refresh" \]/);
  assert.match(authorization, /\^\[1-9\]\[0-9\]\{0,9\}\$/);
  assert.match(authorization, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(authorization, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(authorization, /\[ "\$DISPATCH_GITHUB_SHA" = "\$DISPATCH_EXPECTED_HEAD_SHA" \]/);
  assert.match(authorization, /\[ "\$DISPATCH_GITHUB_REF_NAME" = "\$DISPATCH_BRANCH" \]/);
  assert.match(
    authorization,
    /git fetch --no-tags --no-recurse-submodules --depth=1 origin \\\n            "\+refs\/heads\/main:refs\/remotes\/origin\/main"/,
  );
  assert.match(
    authorization,
    /candidate_blob="\$\(git rev-parse --verify "\$DISPATCH_EXPECTED_HEAD_SHA:\.github\/workflows\/ci\.yml"\)"/,
  );
  assert.match(
    authorization,
    /protected_blob="\$\(git rev-parse --verify "\$protected_main_sha:\.github\/workflows\/ci\.yml"\)"/,
  );
  assert.match(authorization, /\[ "\$candidate_blob" = "\$protected_blob" \]/);
  assert.doesNotMatch(authorization, /setup-node|npm |node scripts\/|github\.token|secrets\./);

  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.doesNotMatch(
    workflow,
    /^\s+(?:actions|checks|contents|deployments|id-token|packages|pull-requests|statuses): write$/mu,
  );
  assert.doesNotMatch(workflow, /secrets\.|github\.token|GH_TOKEN|persist-credentials: true/);
});

test("every gated CI job executes a failing authorization assertion first", () => {
  const gatedJobs = new Map([
    ["test", "test"],
    ["build", "build"],
    ["docs-contract", "docs-contract"],
    ["collaboration-integration", "collaboration-integration"],
    ["evaluate", "policy-runtime-readiness"],
    ["conformance", "agentic-sdlc-policy-runtime"],
  ]);
  for (const [jobId, checkName] of gatedJobs) {
    const source = jobSource(jobId);
    assert.match(source, new RegExp(`^    name: ${checkName}$`, "mu"));
    assert.match(source, /^    if: \$\{\{ always\(\) \}\}$/mu);
    assert.match(
      source,
      /^    steps:\n      - name: Require exact CI authorization$/mu,
      `${jobId} must place its authorization assertion before any named or unnamed step`,
    );
    assert.match(source, /CI_GITHUB_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(source, /CI_EXPECTED_HEAD_SHA: \$\{\{ inputs\.expected_head_sha \}\}/);
    assert.match(
      source,
      /\[ "\$CI_EVENT_NAME" != "workflow_dispatch" \] \|\| \[ "\$CI_GITHUB_SHA" = "\$CI_EXPECTED_HEAD_SHA" \]/,
    );
  }

  for (const jobId of ["test", "build", "docs-contract", "collaboration-integration", "evaluate"]) {
    const source = jobSource(jobId);
    assert.match(source, /^    needs: authorization$/mu);
    assert.match(source, /AUTHORIZATION_RESULT: \$\{\{ needs\.authorization\.result \}\}/);
    assert.match(source, /\[ "\$AUTHORIZATION_RESULT" = "success" \] \|\| exit 1/);
  }
  assert.match(jobSource("conformance"), /^    needs: evaluate$/mu);
  assert.match(jobSource("conformance"), /\[ "\$READINESS_RESULT" = "success" \] \|\| exit 1/);

  for (const jobId of ["test", "build", "docs-contract", "collaboration-integration", "evaluate"]) {
    assert.match(
      jobSource(jobId),
      /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/,
    );
  }
});

test("the exact authorization script accepts one canonical event and rejects drift", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acos-protected-refresh-ci-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "git.ndjson");
  const fakeGit = path.join(directory, "git");
  await writeFile(fakeGit, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GIT_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "check-ref-format") {
  const ref = args.at(-1);
  if (!ref || /[~^:?*\\[\\]\\\\\\s]|\\.\\.|@\\{|\\/$|^\\.|\\.lock(?:\\/|$)/u.test(ref)) process.exit(1);
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "get-url") process.stdout.write(process.env.FAKE_ORIGIN + "\\n");
else if (args[0] === "fetch") process.exit(0);
else if (args[0] === "rev-parse") {
  const revision = args.at(-1);
  if (revision === "HEAD^{commit}") process.stdout.write(process.env.FAKE_HEAD_SHA + "\\n");
  else if (revision === "refs/remotes/origin/main^{commit}") process.stdout.write(process.env.FAKE_MAIN_SHA + "\\n");
  else if (revision === process.env.FAKE_HEAD_SHA + ":.github/workflows/ci.yml") process.stdout.write(process.env.FAKE_CANDIDATE_BLOB + "\\n");
  else if (revision === process.env.FAKE_MAIN_SHA + ":.github/workflows/ci.yml") process.stdout.write(process.env.FAKE_MAIN_BLOB + "\\n");
  else process.exit(1);
} else process.exit(0);
`);
  await chmod(fakeGit, 0o755);
  const script = stepScript("Authorize the exact protected-head refresh");
  const validEnvironment = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    FAKE_GIT_LOG: logPath,
    FAKE_ORIGIN: "https://github.com/owner/repo",
    FAKE_HEAD_SHA: headSha,
    FAKE_MAIN_SHA: mainSha,
    FAKE_CANDIDATE_BLOB: workflowBlob,
    FAKE_MAIN_BLOB: workflowBlob,
    DISPATCH_EVENT_NAME: "workflow_dispatch",
    DISPATCH_GITHUB_SHA: headSha,
    DISPATCH_GITHUB_REF: "refs/heads/agent/device/task",
    DISPATCH_GITHUB_REF_NAME: "agent/device/task",
    DISPATCH_GITHUB_REF_TYPE: "branch",
    DISPATCH_REPOSITORY: "owner/repo",
    DISPATCH_SERVER_URL: "https://github.com",
    DISPATCH_OPERATION: "protected-head-refresh",
    DISPATCH_PULL_REQUEST_NUMBER: "322",
    DISPATCH_BRANCH: "agent/device/task",
    DISPATCH_EXPECTED_HEAD_SHA: headSha,
    DISPATCH_OPERATION_ID: operationId,
  };
  const execute = overrides => spawnSync("bash", [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...validEnvironment, ...overrides },
    input: script,
  });

  const accepted = execute({});
  assert.equal(accepted.status, 0, accepted.stderr);
  const calls = (await readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(calls.some(call => call.join(" ") === "fetch --no-tags --no-recurse-submodules --depth=1 origin +refs/heads/main:refs/remotes/origin/main"));
  assert.ok(calls.some(call => call.at(-1) === `${headSha}:.github/workflows/ci.yml`));
  assert.ok(calls.some(call => call.at(-1) === `${mainSha}:.github/workflows/ci.yml`));

  for (const [label, overrides] of [
    ["wrong event", { DISPATCH_EVENT_NAME: "pull_request" }],
    ["wrong operation", { DISPATCH_OPERATION: "refresh" }],
    ["zero PR", { DISPATCH_PULL_REQUEST_NUMBER: "0" }],
    ["noncanonical PR", { DISPATCH_PULL_REQUEST_NUMBER: "0322" }],
    ["oversized PR", { DISPATCH_PULL_REQUEST_NUMBER: "2147483648" }],
    ["empty branch", { DISPATCH_BRANCH: "" }],
    ["oversized branch", { DISPATCH_BRANCH: "a".repeat(256) }],
    ["invalid branch", { DISPATCH_BRANCH: "agent/../task", DISPATCH_GITHUB_REF_NAME: "agent/../task", DISPATCH_GITHUB_REF: "refs/heads/agent/../task" }],
    ["uppercase SHA", { DISPATCH_EXPECTED_HEAD_SHA: "A".repeat(40), DISPATCH_GITHUB_SHA: "A".repeat(40), FAKE_HEAD_SHA: "A".repeat(40) }],
    ["uppercase digest", { DISPATCH_OPERATION_ID: "C".repeat(64) }],
    ["tag ref", { DISPATCH_GITHUB_REF_TYPE: "tag" }],
    ["branch drift", { DISPATCH_GITHUB_REF_NAME: "agent/device/other" }],
    ["ref drift", { DISPATCH_GITHUB_REF: "refs/heads/agent/device/other" }],
    ["head drift", { DISPATCH_GITHUB_SHA: mainSha }],
    ["checkout drift", { FAKE_HEAD_SHA: mainSha }],
    ["origin drift", { FAKE_ORIGIN: "https://github.com/other/repo" }],
    ["workflow blob drift", { FAKE_MAIN_BLOB: "e".repeat(40) }],
  ]) {
    await t.test(label, () => {
      const rejected = execute(overrides);
      assert.notEqual(rejected.status, 0, `${label} was accepted`);
      assert.match(rejected.stderr, /authorization rejected/);
    });
  }
});
