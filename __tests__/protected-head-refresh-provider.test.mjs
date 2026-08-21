import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProtectedHeadRefreshProjection,
  PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
  PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS,
  protectedHeadRefreshCiRunName,
  reconcileProtectedHeadRefreshCiRuns,
  renderProtectedHeadRefreshHandshakeEvidence,
  requireProtectedHeadRefreshCiRun,
  requireProtectedHeadRefreshCloudResult,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  requireProtectedHeadRefreshLedgerRepository,
  verifyProtectedHeadRefreshMergedProviderState,
} from "../scripts/protected-head-refresh-github-adapter.mjs";
import {
  createProtectedHeadRefreshGithubProvider,
} from "../scripts/protected-head-refresh-github-provider.mjs";
import {
  readProtectedHeadRefreshRepositoryPolicy,
} from "../scripts/protected-head-refresh-repository-policy.mjs";
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

const classicProtectionContexts = Object.freeze([
  "test",
  "build",
  "docs-contract",
  "collaboration-integration",
  "cloud-collaboration",
]);

test("protected refresh keeps target and authenticated ledger identities separate", () => {
  assert.equal(requireProtectedHeadRefreshLedgerRepository({
    targetRepository: "huijoohwee/huijoohwee.github.io",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
  }), "huijoohwee/agentic-canvas-os");
  assert.throws(() => requireProtectedHeadRefreshLedgerRepository({
    targetRepository: "huijoohwee/huijoohwee.github.io",
    ledgerRepository: "",
  }), /authenticated ledger repository/u);
});

function protectedMainBranch({
  name = "main",
  sha = targetMain,
  isProtected = true,
  enabled = true,
  enforcement = "everyone",
  contexts = [...classicProtectionContexts],
  checks = classicProtectionContexts.map(context => ({
    context,
    app_id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
  })),
} = {}) {
  return {
    name,
    commit: { sha },
    protected: isProtected,
    protection: {
      enabled,
      required_status_checks: {
        enforcement_level: enforcement,
        contexts,
        checks,
      },
    },
  };
}

function applicableProtectionRules({
  strict = true,
  context = "agentic-sdlc-policy-runtime",
  integrationId = PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
} = {}) {
  return [{
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: strict,
      required_status_checks: [{
        context,
        integration_id: integrationId,
      }],
    },
  }];
}

function branchProtectionHarness({
  mainBranch = protectedMainBranch(),
  applicable = applicableProtectionRules(),
  policy,
} = {}) {
  const calls = [];
  const provider = createProtectedHeadRefreshGithubProvider({
    repository,
    projection: normalizedProjection(),
    ...(policy ? { policy } : {}),
    gh: args => {
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    },
    ghJson: args => {
      calls.push(args);
      const endpoint = args.find(value => value.startsWith(`repos/${repository}/`));
      if (endpoint === `repos/${repository}/branches/main`) return mainBranch;
      if (endpoint === `repos/${repository}/rules/branches/main`) return applicable;
      throw new Error(`unexpected ghJson call: ${args.join(" ")}`);
    },
    requiredEnv: name => {
      throw new Error(`unexpected environment read: ${name}`);
    },
    sleepSeconds: () => {},
  });
  return { calls, provider };
}

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

test("GitHub provider proves protected main through exact public REST projections", () => {
  const { calls, provider } = branchProtectionHarness();
  provider.verifyBranchProtection();
  assert.deepEqual(calls, [
    ["api", "--method", "GET", `repos/${repository}/branches/main`],
    [
      "api", "--method", "GET", `repos/${repository}/rules/branches/main`,
      "-f", "per_page=100",
    ],
  ]);
  assert.equal(calls.flat().includes("graphql"), false);
});

test("GitHub provider accepts exact protection after main advances beyond the historical target", () => {
  const { provider } = branchProtectionHarness({
    mainBranch: protectedMainBranch({ sha: mainOne }),
  });
  assert.doesNotThrow(() => provider.verifyBranchProtection());
});

test("GitHub provider rejects classic branch-protection projection drift", async t => {
  const exactChecks = () => classicProtectionContexts.map(context => ({
    context,
    app_id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
  }));
  const cases = [
    ["wrong branch name", protectedMainBranch({ name: "trunk" })],
    ["unprotected branch", protectedMainBranch({ isProtected: false })],
    ["disabled protection", protectedMainBranch({ enabled: false })],
    ["non-universal enforcement", protectedMainBranch({ enforcement: "non_admins" })],
    ["malformed contexts", protectedMainBranch({ contexts: "test" })],
    ["missing context", protectedMainBranch({
      contexts: classicProtectionContexts.slice(1),
    })],
    ["duplicate context", protectedMainBranch({
      contexts: classicProtectionContexts.map((context, index) => (
        index === 1 ? classicProtectionContexts[0] : context
      )),
    })],
    ["extra context", protectedMainBranch({
      contexts: [...classicProtectionContexts, "extra"],
    })],
    ["malformed checks", protectedMainBranch({ checks: "test" })],
    ["missing check", protectedMainBranch({ checks: exactChecks().slice(1) })],
    ["duplicate check", protectedMainBranch({
      checks: exactChecks().map((check, index) => (
        index === 1 ? exactChecks()[0] : check
      )),
    })],
    ["extra check", protectedMainBranch({
      checks: [...exactChecks(), {
        context: "extra",
        app_id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
      }],
    })],
    ["wrong app binding", protectedMainBranch({
      checks: exactChecks().map((check, index) => (
        index === 0 ? { ...check, app_id: 1 } : check
      )),
    })],
    ["string app binding", protectedMainBranch({
      checks: exactChecks().map((check, index) => (
        index === 0
          ? { ...check, app_id: String(PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID) }
          : check
      )),
    })],
  ];

  for (const [name, mainBranch] of cases) {
    await t.test(name, () => {
      const { provider } = branchProtectionHarness({ mainBranch });
      assert.throws(
        () => provider.verifyBranchProtection(),
        /lacks the exact enforced classic required checks/u,
      );
    });
  }
});

test("GitHub provider rejects malformed or weakened applicable-rules proof", async t => {
  const cases = [
    ["non-array rules", {}],
    ["missing status-check rule", []],
    ["wrong rule type", [{ type: "pull_request" }]],
    ["non-strict rule", applicableProtectionRules({ strict: false })],
    ["missing agentic context", applicableProtectionRules({ context: "test" })],
    ["wrong integration binding", applicableProtectionRules({ integrationId: 1 })],
    [
      "string integration binding",
      applicableProtectionRules({
        integrationId: String(PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID),
      }),
    ],
  ];

  for (const [name, applicable] of cases) {
    await t.test(name, () => {
      const { provider } = branchProtectionHarness({ applicable });
      assert.throws(
        () => provider.verifyBranchProtection(),
        /applicable ruleset proof is malformed|repository-policy ruleset contexts/u,
      );
    });
  }
});

test("GitHub provider accepts a repository-neutral single-gate policy", () => {
  const policy = readProtectedHeadRefreshRepositoryPolicy({ environment: {
    PROTECTED_HEAD_REFRESH_CI_WORKFLOW: "integration.yml",
    PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON: '["Integration Gate"]',
    PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: '["Integration Gate"]',
    PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: "[]",
    PROTECTED_HEAD_REFRESH_AUDITED_WORKFLOWS_JSON: '["auto-delivery.yml"]',
  } });
  const { provider } = branchProtectionHarness({
    policy,
    mainBranch: protectedMainBranch({
      contexts: ["Integration Gate"],
      checks: [{
        context: "Integration Gate",
        app_id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
      }],
    }),
    applicable: [],
  });
  assert.doesNotThrow(() => provider.verifyBranchProtection());
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

  await t.test("repository policy binds a non-default workflow path", () => {
    const decision = reconcileProtectedHeadRefreshCiRuns({
      runs: [ciRun({
        operationId,
        overrides: { path: ".github/workflows/integration.yml" },
      })],
      repository,
      branch,
      candidateSha: candidate,
      operationId,
      workflowPath: ".github/workflows/integration.yml",
    });
    assert.equal(decision.status, "succeeded");
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

test("CI completion projects exact source checks into the candidate rollup before cloud success", () => {
  const projection = normalizedProjection();
  const workflow = ciRun({ operationId: projection.operation_id });
  const source = PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS.map((name, index) => ({
    id: 1_000 + index, name, head_sha: candidate, status: "completed", conclusion: "success",
    app: { id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID, slug: "github-actions" },
    check_suite: { id: workflow.check_suite_id },
  }));
  const cloudId = 9_000;
  let rollupAvailable = true;
  const checks = [{ id: cloudId, name: "cloud-collaboration", head_sha: candidate,
    external_id: `agentic-protected-head-refresh:${projection.operation_id}`,
    status: "in_progress", conclusion: null,
    details_url: "https://github.com/owner/repo/actions/runs/9001",
    output: { title: "Protected refresh awaiting final authorization",
      summary: renderProtectedHeadRefreshHandshakeEvidence({ projection, candidateSha: candidate,
        phase: "pending-user-authorization" }) },
    app: { id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID, slug: "github-actions" } }];
  const mutations = [];
  const provider = createProtectedHeadRefreshGithubProvider({ repository, projection,
    gh: (args, options = {}) => {
      const endpoint = args.find(value => value.startsWith(`repos/${repository}/`));
      if (endpoint === `repos/${repository}/commits/${candidate}/check-runs`) return { status: 0,
        stdout: JSON.stringify({ total_count: source.length + checks.length,
          check_runs: [...source, ...checks] }), stderr: "" };
      const body = JSON.parse(options.input); mutations.push({ endpoint, body });
      if (endpoint === `repos/${repository}/check-runs`) checks.push({ id: 2_000 + checks.length,
        ...body, head_sha: body.head_sha, external_id: body.external_id,
        status: body.status, conclusion: body.conclusion,
        details_url: `https://github.com/${repository}/runs/${2_000 + checks.length}`,
        app: { id: PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID, slug: "github-actions" } });
      else Object.assign(checks[0], body, { details_url: body.details_url });
      return { status: 0, stdout: "", stderr: "" };
    },
    ghJson: args => {
      const endpoint = args.find(value => value.startsWith(`repos/${repository}/`));
      if (endpoint === `repos/${repository}/check-suites/${workflow.check_suite_id}/check-runs`)
        return { total_count: source.length + checks.length, check_runs: [...source, ...checks] };
      if (endpoint?.includes("/check-runs/")) return checks.find(check => endpoint.endsWith(`/${check.id}`));
      return { data: { repository: { object: { statusCheckRollup: rollupAvailable ? { contexts: {
        totalCount: checks.length, nodes: checks.map(check => ({ __typename: "CheckRun",
          databaseId: check.id })) } } : null } } } };
    },
    requiredEnv: () => "unused", sleepSeconds: () => {},
  });
  const ci = { workflowRunId: workflow.id, checkSuiteId: workflow.check_suite_id,
    htmlUrl: workflow.html_url };
  assert.equal(provider.completeCloudCheck({ candidateSha: candidate,
    cloudCheck: { checkRunIds: [cloudId] }, ci }).status, "complete");
  assert.deepEqual(mutations.map(item => item.body.name).filter(Boolean),
    PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS);
  assert.equal(mutations.at(-1).endpoint, `repos/${repository}/check-runs/${cloudId}`);
  const mutationCount = mutations.length;
  provider.completeCloudCheck({ candidateSha: candidate, cloudCheck: { checkRunIds: [cloudId] }, ci });
  assert.equal(mutations.length, mutationCount);
  rollupAvailable = false;
  assert.throws(() => provider.completeCloudCheck({ projection, candidateSha: candidate,
    cloudCheck: { checkRunIds: [cloudId] }, ci }), /rollup is malformed/u);
  assert.equal(provider.completeCloudCheck({ projection: Object.freeze({ ...projection,
    allowAbsentMergedAuthorizationRecovery: true }), candidateSha: candidate,
    cloudCheck: { checkRunIds: [cloudId] }, ci }).status, "complete");
  rollupAvailable = true;
  checks[1].details_url = "https://github.com/foreign/repo/runs/2001";
  assert.throws(() => provider.completeCloudCheck({ candidateSha: candidate, cloudCheck: { checkRunIds: [cloudId] }, ci }), /drifted/u);
});
