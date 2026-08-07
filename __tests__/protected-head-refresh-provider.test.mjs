import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProtectedHeadRefreshProjection,
  PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
  PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS,
  protectedHeadRefreshCiRunName,
  reconcileProtectedHeadRefreshCiRuns,
  requireProtectedHeadRefreshCiRun,
  requireProtectedHeadRefreshCloudResult,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  verifyProtectedHeadRefreshMergedProviderState,
} from "../scripts/protected-head-refresh-github-adapter.mjs";
import {
  createProtectedHeadRefreshGithubProvider,
} from "../scripts/protected-head-refresh-github-provider.mjs";
import {
  branch,
  candidate,
  ciRun,
  cloudResult,
  delivered,
  mainOne,
  normalizedProjection,
  projectionInput,
  repository,
  targetMain,
} from "./protected-head-refresh-fixtures.mjs";

test("normalizes a projection whose operation digest binds the actual target main ref", () => {
  const input = projectionInput();
  const projection = normalizeProtectedHeadRefreshProjection({ repository, input });
  assert.equal(projection.pullRequestNumber, 17);
  assert.equal(projection.target_main_sha, targetMain);
  assert.equal(projection.operation_id, input.operation_id);

  for (const mutation of [
    { target_main_sha: mainOne },
    { observed_head_sha: candidate },
    { branch: "-unsafe" },
    { candidate_auto_merge_commit_title: "Substituted title" },
    { candidate_auto_merge_commit_message: JSON.stringify("Substituted body") },
  ]) {
    assert.throws(() => normalizeProtectedHeadRefreshProjection({
      repository,
      input: { ...input, ...mutation },
    }), /operation ID does not match|safe Git branch|original and candidate/u);
  }
});

test("merged verification needs protected main but not a deleted feature branch", () => {
  const mergedInput = Object.freeze({
    mergeCommitSha: "c".repeat(40),
    candidateSha: candidate,
    targetMainSha: targetMain,
    candidateSource: "durable-pull-request-head",
    featureRefAvailable: false,
  });
  const durableObjects = new Set([
    mergedInput.mergeCommitSha,
    mergedInput.candidateSha,
    mergedInput.targetMainSha,
  ]);
  const events = [];

  const result = verifyProtectedHeadRefreshMergedProviderState(mergedInput, {
    readProtectedMainSha: () => {
      events.push("read-protected-main");
      return targetMain;
    },
    fetchProtectedMainRef: sha => {
      events.push("fetch-protected-main");
      assert.equal(sha, targetMain);
    },
    verifyMergedCommit: input => {
      events.push("verify-durable-candidate");
      assert.equal(input, mergedInput);
      assert.equal(input.featureRefAvailable, false);
      assert.equal(durableObjects.has(input.candidateSha), true);
      return Object.freeze({ status: "verified", candidateSha: input.candidateSha });
    },
  });

  assert.deepEqual(events, [
    "read-protected-main",
    "fetch-protected-main",
    "verify-durable-candidate",
  ]);
  assert.deepEqual(result, { status: "verified", candidateSha: candidate });
});

test("GitHub provider binds synchronize probes and CI dispatch to exact operation argv", () => {
  const projection = normalizedProjection();
  const workflowRun = ciRun({ operationId: projection.operation_id });
  const requiredChecks = PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS.map((name, index) => ({
    id: 1_000 + index,
    name,
    head_sha: candidate,
    status: "completed",
    conclusion: "success",
    app: {
      id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
      slug: "github-actions",
    },
    check_suite: { id: workflowRun.check_suite_id },
  }));
  const synchronizeQueries = [];
  const ciRunQueries = [];
  const ghCalls = [];
  let ciRunListingReads = 0;

  const provider = createProtectedHeadRefreshGithubProvider({
    repository,
    projection,
    gh: (args, options = {}) => {
      ghCalls.push({ args, options });
      if (args[0] === "workflow") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args.includes(`repos/${repository}/commits/${candidate}/check-runs`)) {
        return {
          status: 0,
          stdout: JSON.stringify({
            total_count: requiredChecks.length,
            check_runs: requiredChecks,
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    },
    ghJson: args => {
      const endpoint = args.find(value => value.startsWith(`repos/${repository}/`));
      if (endpoint?.includes("actions/workflows/auto-delivery.yml/runs")
        || endpoint?.includes("actions/workflows/cloud-collaboration.yml/runs")) {
        synchronizeQueries.push(args);
        return { total_count: 0, workflow_runs: [] };
      }
      if (endpoint?.includes("actions/workflows/ci.yml/runs")) {
        ciRunQueries.push(args);
        ciRunListingReads += 1;
        return ciRunListingReads === 1
          ? { total_count: 0, workflow_runs: [] }
          : { total_count: 1, workflow_runs: [workflowRun] };
      }
      if (endpoint === `repos/${repository}/check-suites/${workflowRun.check_suite_id}/check-runs`) {
        return {
          total_count: requiredChecks.length,
          check_runs: requiredChecks,
        };
      }
      throw new Error(`unexpected ghJson call: ${args.join(" ")}`);
    },
    requiredEnv: name => ({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "9001",
    })[name],
    sleepSeconds: () => {},
  });

  provider.verifyNoSynchronizeRun({ candidateSha: candidate });
  assert.deepEqual(synchronizeQueries, ["auto-delivery.yml", "cloud-collaboration.yml"].map(
    workflow => [
      "api", "--method", "GET",
      `repos/${repository}/actions/workflows/${workflow}/runs`,
      "-f", "event=pull_request_target",
      "-f", `branch=${branch}`,
      "-f", `head_sha=${candidate}`,
      "-f", "per_page=100",
    ],
  ));

  const receipt = provider.reconcileCandidateCi({ candidateSha: candidate });
  assert.deepEqual(receipt, {
    workflowRunId: workflowRun.id,
    checkSuiteId: workflowRun.check_suite_id,
    htmlUrl: workflowRun.html_url,
    displayTitle: workflowRun.display_title,
  });
  assert.deepEqual(ciRunQueries[0], [
    "api", "--method", "GET",
    `repos/${repository}/actions/workflows/ci.yml/runs`,
    "-f", `branch=${branch}`,
    "-f", `head_sha=${candidate}`,
    "-f", "event=workflow_dispatch",
    "-f", "per_page=100",
  ]);
  assert.deepEqual(ghCalls.find(call => call.args[0] === "workflow")?.args, [
    "workflow", "run", "ci.yml",
    "--repo", repository,
    "--ref", branch,
    "-f", "operation=protected-head-refresh",
    "-f", "pull_request_number=17",
    "-f", `branch=${branch}`,
    "-f", `expected_head_sha=${candidate}`,
    "-f", `operation_id=${projection.operation_id}`,
  ]);
});

test("exact CI identity binds event, path, branch, head, operation, and success", () => {
  const projection = normalizedProjection();
  const run = ciRun({ operationId: projection.operation_id });
  const receipt = requireProtectedHeadRefreshCiRun({
    run,
    repository,
    branch,
    candidateSha: candidate,
    operationId: projection.operation_id,
    requireSuccess: true,
  });
  assert.equal(receipt.id, 123);
  assert.equal(receipt.displayTitle, protectedHeadRefreshCiRunName({
    operationId: projection.operation_id,
    candidateSha: candidate,
  }));

  for (const mutation of [
    { event: "pull_request" },
    { head_sha: delivered },
    { head_branch: "other" },
    { path: ".github/workflows/other.yml" },
    { display_title: "similar" },
  ]) {
    assert.throws(() => requireProtectedHeadRefreshCiRun({
      run: { ...run, ...mutation },
      repository,
      branch,
      candidateSha: candidate,
      operationId: projection.operation_id,
    }), /identity drifted/u);
  }
  assert.throws(() => requireProtectedHeadRefreshCiRun({
    run: { ...run, conclusion: "failure" },
    repository,
    branch,
    candidateSha: candidate,
    operationId: projection.operation_id,
    requireSuccess: true,
  }), /did not complete successfully/u);
});

test("CI replay reconciles duplicate exact-title runs deterministically", async t => {
  const operationId = normalizedProjection().operation_id;
  const decide = runs => reconcileProtectedHeadRefreshCiRuns({
    runs,
    repository,
    branch,
    candidateSha: candidate,
    operationId,
  });

  await t.test("manual duplicate waits while either exact run can succeed", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 124, status: "queued", conclusion: null } }),
      ciRun({ operationId, overrides: { id: 123, status: "in_progress", conclusion: null } }),
    ]);
    assert.equal(decision.status, "waiting");
    assert.deepEqual(decision.workflowRunIds, [123, 124]);
  });

  await t.test("newest terminal failure is classified for bounded redispatch", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 123, conclusion: "failure" } }),
      ciRun({ operationId, overrides: { id: 124, conclusion: "cancelled" } }),
    ]);
    assert.equal(decision.status, "retryable-failure");
    assert.equal(decision.workflowRunId, 124);
  });

  await t.test("one failed and one successful selects the exact success", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 123, conclusion: "failure" } }),
      ciRun({ operationId, overrides: { id: 124 } }),
    ]);
    assert.equal(decision.status, "succeeded");
    assert.equal(decision.workflowRunId, 124);
  });

  await t.test("older pending plus newer successful accepts the newest success", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 122, status: "queued", conclusion: null } }),
      ciRun({ operationId, overrides: { id: 124 } }),
    ]);
    assert.equal(decision.status, "succeeded");
    assert.equal(decision.workflowRunId, 124);
  });

  await t.test("the newest successful run and suite are effective evidence", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 124 } }),
      ciRun({ operationId, overrides: { id: 123 } }),
    ]);
    assert.equal(decision.workflowRunId, 124);
    assert.equal(decision.checkSuiteId, 9123);
    assert.deepEqual(decision.workflowRunIds, [123, 124]);
  });

  await t.test("older success plus newer pending waits", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 123 } }),
      ciRun({
        operationId,
        overrides: { id: 124, status: "queued", conclusion: null },
      }),
    ]);
    assert.equal(decision.status, "waiting");
    assert.equal(decision.workflowRunId, 124);
  });

  await t.test("older success plus newer failure requires a newer attempt", () => {
    const decision = decide([
      ciRun({ operationId, overrides: { id: 123 } }),
      ciRun({ operationId, overrides: { id: 124, conclusion: "failure" } }),
    ]);
    assert.equal(decision.status, "retryable-failure");
    assert.equal(decision.workflowRunId, 124);
  });

  await t.test("one identity mismatch poisons the complete matching set", () => {
    assert.throws(() => decide([
      ciRun({ operationId, overrides: { id: 123 } }),
      ciRun({ operationId, overrides: { id: 124, head_sha: delivered } }),
    ]), /identity drifted/u);
  });

  await t.test("zero then one models exactly one dispatch and subsequent wait", () => {
    const absent = decide([]);
    assert.deepEqual(absent, {
      status: "absent",
      workflowRunId: null,
      workflowRunIds: [],
    });
    const observed = decide([
      ciRun({ operationId, overrides: { id: 123, status: "queued", conclusion: null } }),
    ]);
    assert.equal(observed.status, "waiting");
    assert.deepEqual(observed.workflowRunIds, [123]);
  });
});

test("cloud authority accepts unrelated ledger advance but rejects claim evidence drift", () => {
  const projection = normalizedProjection();
  const result = cloudResult({ ledgerRevision: "7".repeat(40) });
  assert.equal(requireProtectedHeadRefreshCloudResult({
    result,
    projection,
    currentHeadSha: delivered,
  }), result);
  assert.throws(() => requireProtectedHeadRefreshCloudResult({
    result: cloudResult({
      claim: {
        ...cloudResult().claim,
        integrationReceiptDigest: "8".repeat(64),
      },
    }),
    projection,
    currentHeadSha: delivered,
  }), /claim drifted/u);
});
