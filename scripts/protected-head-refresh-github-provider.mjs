import {
  PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID,
  reconcileProtectedHeadRefreshCiRuns,
  renderProtectedHeadRefreshHandshakeEvidence,
} from "./protected-main-refresh-lib.mjs";
import { DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY } from "./protected-head-refresh-repository-policy.mjs";
const CI_ROLLUP_PROJECTION_SCHEMA = "agentic-protected-head-refresh-ci-rollup-projection/v1";
const CI_ROLLUP_EXTERNAL_ID_PREFIX = "agentic-protected-head-refresh-ci:";
const CI_ROLLUP_TITLE = "Protected refresh CI rollup projection";

export function createProtectedHeadRefreshGithubProvider({
  repository,
  projection,
  policy = DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY,
  gh,
  ghJson,
  requiredEnv,
  sleepSeconds,
}) {
  let totalCiDispatchAttempts = 0;
  const maxCiDispatchAttempts = 3;

  function verifyCandidateChecksAbsent({ candidateSha }) {
    const runs = readCommitCheckRuns(candidateSha, { allowMissingCommit: true });
    const existingCloud = runs.filter(run => (
      run?.name === "cloud-collaboration"
      && run?.app?.id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
      && run?.app?.slug === "github-actions"
      && run?.head_sha === candidateSha
    ));
    if (existingCloud.length > 0) {
      throw new Error(
        "Protected-head refresh candidate already has a github-actions cloud-collaboration check.",
      );
    }
  }
  function verifyNoSynchronizeRun({ candidateSha }) {
    for (const workflow of policy.auditedWorkflows) {
      const response = ghJson([
        "api", "--method", "GET",
        `repos/${repository}/actions/workflows/${workflow}/runs`,
        "-f", "event=pull_request_target",
        "-f", `branch=${projection.branch}`,
        "-f", `head_sha=${candidateSha}`,
        "-f", "per_page=100",
      ]);
      const runs = requireBoundedArrayPage({
        response,
        key: "workflow_runs",
        label: `Protected-head refresh ${workflow} pull_request_target run listing`,
      });
      const synchronizeRun = runs.find(run => (
        run?.event === "pull_request_target"
        && (
          (run?.head_sha === candidateSha && run?.head_branch === projection.branch)
          || (
            Array.isArray(run?.pull_requests)
            && run.pull_requests.some(pull => (
              Number(pull?.number) === projection.pullRequestNumber
              && pull?.head?.sha === candidateSha
            ))
          )
        )
      ));
      if (synchronizeRun) {
        throw new Error(
          `GITHUB_TOKEN provider contract breached: ${workflow} pull_request_target synchronize run ${synchronizeRun.id} observed.`,
        );
      }
    }
  }
  function reconcileCandidateCi({ candidateSha }) {
    let visibilityFence = null;
    for (let attempt = 0; attempt < 210; attempt += 1) {
      const decision = readProtectedHeadRefreshCiDecision({ candidateSha });
      const newestId = decision.workflowRunIds.at(-1) || 0;
      if (visibilityFence && newestId <= visibilityFence.priorRunId) {
        visibilityFence.polls += 1;
        if (visibilityFence.polls < 12) {
          if (attempt + 1 < 210) sleepSeconds(5);
          continue;
        }
        visibilityFence = null;
      } else if (visibilityFence && newestId > visibilityFence.priorRunId) {
        visibilityFence = null;
      }
      if (decision.status === "succeeded") {
        const receipt = Object.freeze({
          workflowRunId: decision.workflowRunId,
          checkSuiteId: decision.checkSuiteId,
          htmlUrl: decision.run.htmlUrl,
          displayTitle: decision.run.displayTitle,
        });
        const evidence = classifyProtectedHeadRefreshCiEvidence({ candidateSha, ci: receipt });
        if (evidence === "accepted") return receipt;
        if (evidence === "superseded") {
          visibilityFence = dispatchProtectedHeadRefreshCi({
            candidateSha,
            priorRunId: decision.workflowRunId,
          });
        }
      } else if (
        decision.status === "absent"
        || decision.status === "retryable-failure"
      ) {
        visibilityFence = dispatchProtectedHeadRefreshCi({
          candidateSha,
          priorRunId: newestId,
        });
      }
      if (attempt + 1 < 210) sleepSeconds(5);
    }
    throw new Error("Protected-head refresh CI did not converge within the 17.5-minute bound.");
  }
  function readProtectedHeadRefreshCiDecision({ candidateSha }) {
    const response = ghJson([
      "api", "--method", "GET",
      `repos/${repository}/actions/workflows/${policy.ciWorkflow}/runs`,
      "-f", `branch=${projection.branch}`,
      "-f", `head_sha=${candidateSha}`,
      "-f", "event=workflow_dispatch",
      "-f", "per_page=100",
    ]);
    const runs = requireBoundedArrayPage({
      response,
      key: "workflow_runs",
      label: "Protected-head refresh CI run listing",
    });
    return reconcileProtectedHeadRefreshCiRuns({
      runs,
      repository,
      branch: projection.branch,
      candidateSha,
      operationId: projection.operation_id,
      workflowPath: `.github/workflows/${policy.ciWorkflow}`,
    });
  }
  function dispatchProtectedHeadRefreshCi({ candidateSha, priorRunId }) {
    if (totalCiDispatchAttempts >= maxCiDispatchAttempts) {
      throw new Error("Protected-head refresh exhausted its bounded CI dispatch attempts.");
    }
    totalCiDispatchAttempts += 1;
    const dispatched = gh([
      "workflow", "run", policy.ciWorkflow,
      "--repo", repository,
      "--ref", projection.branch,
      "-f", "operation=protected-head-refresh",
      "-f", `pull_request_number=${projection.pullRequestNumber}`,
      "-f", `branch=${projection.branch}`,
      "-f", `expected_head_sha=${candidateSha}`,
      "-f", `operation_id=${projection.operation_id}`,
    ], { allowFailure: true });
    if (dispatched.status !== 0) {
      const afterFailure = readProtectedHeadRefreshCiDecision({ candidateSha });
      const observedId = afterFailure.workflowRunIds.at(-1) || 0;
      if (observedId <= priorRunId) {
        if (totalCiDispatchAttempts >= maxCiDispatchAttempts) {
          throw new Error(
            `Protected-head refresh CI dispatch failed without an observable run: ${dispatched.stderr || dispatched.stdout}`,
          );
        }
        return null;
      }
    }
    return { priorRunId, polls: 0 };
  }
  function classifyProtectedHeadRefreshCiEvidence({ candidateSha, ci }) {
    const suiteResponse = ghJson([
      "api", "--method", "GET",
      `repos/${repository}/check-suites/${ci.checkSuiteId}/check-runs`,
      "-f", "filter=latest",
      "-f", "per_page=100",
    ]);
    const suiteRuns = requireBoundedArrayPage({
      response: suiteResponse,
      key: "check_runs",
      label: "Protected-head refresh selected check-suite listing",
    });
    for (const context of policy.requiredCiContexts) {
      const matches = suiteRuns.filter(run => (
        run?.name === context && !isCiRollupProjection(run)
      ));
      if (matches.length !== 1) {
        throw new Error(`Protected-head refresh selected suite has no exact ${context} check.`);
      }
      const state = classifyActionsCheck({
        run: matches[0],
        candidateSha,
        context,
        checkSuiteId: ci.checkSuiteId,
      });
      if (state !== "success") return state === "pending" ? "waiting" : "superseded";
    }

    const allRuns = readCommitCheckRuns(candidateSha);
    for (const context of policy.requiredCiContexts) {
      const actionsRuns = allRuns.filter(run => (
        run?.name === context
        && run?.app?.id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
        && run?.app?.slug === "github-actions"
      ));
      const projections = actionsRuns.filter(isCiRollupProjection);
      if (projections.some(run => !isOperationCiRollupProjection(run))) {
        throw new Error(
          `Protected-head refresh required check ${context} has a foreign rollup projection.`,
        );
      }
      const sourceRuns = actionsRuns.filter(run => !isCiRollupProjection(run));
      if (sourceRuns.length === 0) return "waiting";
      const newest = sourceRuns
        .sort((left, right) => Number(left.id) - Number(right.id)).at(-1);
      const state = classifyActionsCheck({ run: newest, candidateSha, context });
      if (state === "pending") return "waiting";
      if (state === "failure") return "superseded";
      if (Number(newest?.check_suite?.id) !== ci.checkSuiteId) return "superseded";
    }
    return "accepted";
  }
  function classifyActionsCheck({ run, candidateSha, context, checkSuiteId = null }) {
    if (
      !Number.isSafeInteger(Number(run?.id)) || Number(run?.id) <= 0
      || run?.name !== context
      || run?.head_sha !== candidateSha
      || run?.app?.id !== PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
      || run?.app?.slug !== "github-actions"
      || (checkSuiteId !== null && Number(run?.check_suite?.id) !== checkSuiteId)
    ) {
      throw new Error(`Protected-head refresh required check ${context} identity drifted.`);
    }
    if (run.status !== "completed") {
      if (run.conclusion !== null) {
        throw new Error(`Protected-head refresh required check ${context} concluded prematurely.`);
      }
      return "pending";
    }
    return run.conclusion === "success" ? "success" : "failure";
  }
  function isCiRollupProjection(run) {
    return String(run?.external_id || "").startsWith(CI_ROLLUP_EXTERNAL_ID_PREFIX);
  }
  function isOperationCiRollupProjection(run) {
    return String(run?.external_id || "").startsWith(
      `${CI_ROLLUP_EXTERNAL_ID_PREFIX}${projection.operation_id}:`,
    );
  }
  function reconcileCloudCheck({ candidateSha, create }) {
    const contract = protectedHeadRefreshCheckContract();
    let receipt = readProtectedHeadRefreshCloudChecks({ candidateSha, contract });
    if (receipt.status === "absent" && create) {
      gh([
        "api", "--method", "POST", `repos/${repository}/check-runs`, "--input", "-",
      ], {
        allowFailure: true,
        input: JSON.stringify({
          name: contract.name,
          head_sha: candidateSha,
          status: "in_progress",
          external_id: contract.externalId,
          details_url: `${requiredEnv("GITHUB_SERVER_URL")}/${repository}/actions/runs/${requiredEnv("GITHUB_RUN_ID")}`,
          output: {
            title: contract.pendingTitle,
            summary: renderProtectedHeadRefreshHandshakeEvidence({
              projection,
              candidateSha,
              phase: contract.pendingPhase,
            }),
          },
        }),
      });
      receipt = readProtectedHeadRefreshCloudChecks({ candidateSha, contract });
      if (receipt.status !== "pending") {
        throw new Error("Protected-head refresh pending cloud gate was not observable.");
      }
    }
    return receipt;
  }
  function completeCloudCheck({
    candidateSha,
    cloudCheck,
    ci,
    projection: authorizationProjection = projection,
  }) {
    if (!ci?.htmlUrl || !Number.isSafeInteger(ci.workflowRunId)) {
      throw new Error("Protected-head refresh cloud completion requires exact CI evidence.");
    }
    if (!Array.isArray(cloudCheck.checkRunIds) || cloudCheck.checkRunIds.length !== 1) {
      throw new Error("Protected-head refresh requires one sole owned pending cloud check.");
    }
    const checkRunId = cloudCheck.checkRunIds[0];
    const contract = protectedHeadRefreshCheckContract();
    const exactCheck = readExactCheckRun(checkRunId);
    const state = requireProtectedHeadRefreshOwnedCheck({
      check: exactCheck,
      candidateSha,
      contract,
    });
    const completeSummary = renderProtectedHeadRefreshHandshakeEvidence({
      projection,
      candidateSha,
      phase: "authorization-complete",
      ci,
    });
    if (state === "complete" && exactCheck.output?.summary !== completeSummary) {
      throw new Error("Protected-head refresh concurrent cloud completion CI evidence drifted.");
    }
    reconcileCiRollupProjections({
      candidateSha,
      ci,
      cloudCheckRunId: checkRunId,
      allowAbsentMergedAuthorizationRecovery:
        authorizationProjection.allowAbsentMergedAuthorizationRecovery === true,
    });
    if (state !== "complete") {
      gh([
        "api", "--method", "PATCH", `repos/${repository}/check-runs/${checkRunId}`,
        "--input", "-",
      ], {
        allowFailure: true,
        input: JSON.stringify({
          status: "completed",
          conclusion: "success",
          details_url: ci.htmlUrl,
          output: { title: contract.completeTitle, summary: completeSummary },
        }),
      });
      const confirmed = readExactCheckRun(checkRunId);
      if (requireProtectedHeadRefreshOwnedCheck({
        check: confirmed,
        candidateSha,
        contract,
      }) !== "complete") {
        throw new Error("Protected-head refresh cloud PATCH was not exactly confirmed.");
      }
      if (confirmed.output?.summary !== completeSummary) {
        throw new Error("Protected-head refresh completed cloud evidence drifted after PATCH.");
      }
    }
    return readProtectedHeadRefreshCloudChecks({ candidateSha, contract });
  }
  function reconcileCiRollupProjections({
    candidateSha,
    ci,
    cloudCheckRunId,
    allowAbsentMergedAuthorizationRecovery,
  }) {
    if (!Number.isSafeInteger(ci?.workflowRunId) || !Number.isSafeInteger(ci?.checkSuiteId)
      || !ci?.htmlUrl || !Number.isSafeInteger(cloudCheckRunId)) {
      throw new Error("Protected-head refresh CI rollup projection requires exact CI evidence.");
    }
    const sourcePage = ghJson(["api", "--method", "GET",
      `repos/${repository}/check-suites/${ci.checkSuiteId}/check-runs`,
      "-f", "filter=latest", "-f", "per_page=100"]);
    const sources = requireBoundedArrayPage({ response: sourcePage, key: "check_runs",
      label: "Protected-head refresh CI rollup source listing" });
    const ids = [];
    for (const context of policy.requiredCiContexts) {
      const matches = sources.filter(run => (
        run?.name === context && !isCiRollupProjection(run)
      ));
      if (matches.length !== 1 || classifyActionsCheck({ run: matches[0], candidateSha,
        context, checkSuiteId: ci.checkSuiteId }) !== "success") {
        throw new Error(`Protected-head refresh CI rollup source ${context} is not exact success.`);
      }
      const sourceId = Number(matches[0].id);
      const externalId = `${CI_ROLLUP_EXTERNAL_ID_PREFIX}${projection.operation_id}:${sourceId}`;
      const summary = JSON.stringify({ schema: CI_ROLLUP_PROJECTION_SCHEMA,
        operation_id: projection.operation_id, candidate_sha: candidateSha, context,
        source_workflow_run_id: ci.workflowRunId, source_check_suite_id: ci.checkSuiteId,
        source_check_run_id: sourceId });
      const readMatching = () => {
        const projected = readCommitCheckRuns(candidateSha).filter(check => check?.name === context
          && check?.app?.id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
          && check?.app?.slug === "github-actions" && isCiRollupProjection(check));
        const exact = projected.filter(check => check?.external_id === externalId);
        if (projected.length !== exact.length) {
          throw new Error(`Protected-head refresh CI rollup context ${context} is quarantined.`);
        }
        return exact;
      };
      let projected = readMatching();
      if (projected.length === 0) {
        gh(["api", "--method", "POST", `repos/${repository}/check-runs`, "--input", "-"], {
          allowFailure: true, input: JSON.stringify({ name: context, head_sha: candidateSha,
            status: "completed", conclusion: "success", external_id: externalId,
            details_url: ci.htmlUrl, output: { title: CI_ROLLUP_TITLE, summary } }),
        });
        projected = readMatching();
      }
      if (projected.length !== 1) {
        throw new Error(`Protected-head refresh CI rollup projection ${context} is not sole.`);
      }
      const check = readExactCheckRun(Number(projected[0].id));
      const canonicalDetailsUrl = `https://github.com/${repository}/runs/${check.id}`;
      if (check?.name !== context || check?.head_sha !== candidateSha
        || check?.external_id !== externalId || check?.app?.id !== PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
        || check?.app?.slug !== "github-actions" || check?.status !== "completed"
        || check?.conclusion !== "success" || ![ci.htmlUrl, canonicalDetailsUrl].includes(check?.details_url)
        || check?.output?.title !== CI_ROLLUP_TITLE || check?.output?.summary !== summary) {
        throw new Error(`Protected-head refresh CI rollup projection ${context} drifted.`);
      }
      ids.push(Number(check.id));
    }
    const expected = [...ids, cloudCheckRunId];
    const [owner, name] = repository.split("/");
    const query = "query($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{statusCheckRollup{contexts(first:100){totalCount nodes{__typename ... on CheckRun{databaseId}}}}}}}}";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = ghJson(["api", "graphql", "-f", `query=${query}`,
        "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `oid=${candidateSha}`]);
      const rollup = response?.data?.repository?.object?.statusCheckRollup;
      if (rollup === null && allowAbsentMergedAuthorizationRecovery) {
        const observed = new Set(readCommitCheckRuns(candidateSha).map(check => Number(check?.id)));
        if (expected.every(id => observed.has(id))) return Object.freeze(ids);
        if (attempt + 1 < 12) {
          sleepSeconds(1);
          continue;
        }
        break;
      }
      const contexts = rollup?.contexts;
      if (!contexts || !Array.isArray(contexts.nodes)
        || !Number.isSafeInteger(Number(contexts.totalCount)) || Number(contexts.totalCount) > 100) {
        throw new Error("Protected-head refresh candidate status-check rollup is malformed.");
      }
      const observed = new Set(contexts.nodes.map(node => Number(node?.databaseId)));
      if (expected.every(id => observed.has(id))) return Object.freeze(ids);
      if (attempt + 1 < 12) sleepSeconds(1);
    }
    throw new Error("Protected-head refresh CI projections did not converge into the candidate rollup.");
  }
  function readProtectedHeadRefreshCloudChecks({ candidateSha, contract }) {
    const allChecks = readCommitCheckRuns(candidateSha);
    const sameContext = allChecks.filter(check => (
      check?.name === contract.name
      && check?.app?.id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
      && check?.app?.slug === "github-actions"
    ));
    const matching = sameContext.filter(check => check?.external_id === contract.externalId);
    if (sameContext.length !== matching.length) {
      throw new Error(
        "Protected-head refresh candidate has a quarantined foreign owned-check context.",
      );
    }
    if (matching.length === 0) {
      return Object.freeze({
        status: "absent",
        checkRunIds: Object.freeze([]),
        externalId: contract.externalId,
      });
    }
    if (matching.length !== 1) {
      throw new Error("Protected-head refresh requires one sole operation-owned check.");
    }
    const check = readExactCheckRun(Number(matching[0].id));
    const status = requireProtectedHeadRefreshOwnedCheck({ check, candidateSha, contract });
    return Object.freeze({
      status,
      checkRunIds: Object.freeze([Number(check.id)]),
      externalId: contract.externalId,
    });
  }
  function protectedHeadRefreshCheckContract() {
    return Object.freeze({
      name: "cloud-collaboration",
      externalId: `agentic-protected-head-refresh:${projection.operation_id}`,
      pendingPhase: "pending-user-authorization",
      pendingTitle: "Protected refresh awaiting final authorization",
      completeTitle: "Protected refresh authorization complete",
    });
  }
  function requireProtectedHeadRefreshOwnedCheck({ check, candidateSha, contract }) {
    if (
      check.name !== contract.name
      || check.head_sha !== candidateSha
      || check.external_id !== contract.externalId
      || check.app?.id !== PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
      || check?.app?.slug !== "github-actions"
    ) {
      throw new Error("Protected-head refresh owned cloud check identity drifted.");
    }
    let parsed;
    try {
      parsed = JSON.parse(check.output?.summary);
    } catch {
      throw new Error("Protected-head refresh owned cloud check evidence is malformed.");
    }
    if (["queued", "in_progress"].includes(check.status) && check.conclusion === null) {
      const summary = renderProtectedHeadRefreshHandshakeEvidence({
        projection,
        candidateSha,
        phase: contract.pendingPhase,
      });
      if (check.output?.title !== contract.pendingTitle || check.output?.summary !== summary) {
        throw new Error("Protected-head refresh pending cloud evidence drifted.");
      }
      return "pending";
    }
    if (check.status === "completed" && check.conclusion === "success") {
      const summary = renderProtectedHeadRefreshHandshakeEvidence({
        projection,
        candidateSha,
        phase: "authorization-complete",
        ci: {
          workflowRunId: parsed?.ci?.workflow_run_id,
          checkSuiteId: parsed?.ci?.check_suite_id,
        },
      });
      if (check.output?.title !== contract.completeTitle || check.output?.summary !== summary) {
        throw new Error("Protected-head refresh completed cloud evidence drifted.");
      }
      return "complete";
    }
    throw new Error(
      "Protected-head refresh owned cloud check terminalized before authorization commit.",
    );
  }
  function readExactCheckRun(checkRunId) {
    const check = ghJson([
      "api", "--method", "GET", `repos/${repository}/check-runs/${checkRunId}`,
    ]);
    if (Number(check?.id) !== checkRunId) {
      throw new Error("Protected-head refresh exact cloud check ID drifted.");
    }
    return check;
  }

  function readCommitCheckRuns(candidateSha, { allowMissingCommit = false } = {}) {
    const result = gh([
      "api", "--method", "GET",
      `repos/${repository}/commits/${candidateSha}/check-runs`,
      "-f", "filter=all",
      "-f", "per_page=100",
    ], { allowFailure: true });
    if (result.status !== 0) {
      if (
        allowMissingCommit
        && /(?:HTTP 404|not found|no commit found)/iu.test(
          `${result.stdout}\n${result.stderr}`,
        )
      ) return [];
      throw new Error(
        `Protected-head refresh check-run listing failed: ${result.stderr || result.stdout}`,
      );
    }
    const response = JSON.parse(result.stdout || "null");
    return requireBoundedArrayPage({
      response,
      key: "check_runs",
      label: "Protected-head refresh commit check-run listing",
    });
  }

  function verifyBranchProtection() {
    const classicContexts = policy.classicRequiredChecks;
    const mainBranch = ghJson([
      "api", "--method", "GET", `repos/${repository}/branches/main`,
    ]);
    const branchProtectionRule = mainBranch?.protection?.required_status_checks;
    const contexts = branchProtectionRule?.contexts;
    const checks = branchProtectionRule?.checks;
    const hasExactContexts = (
      Array.isArray(contexts)
      && contexts.length === classicContexts.length
      && new Set(contexts).size === classicContexts.length
      && classicContexts.every(context => contexts.includes(context))
    );
    const hasExactChecks = (
      Array.isArray(checks)
      && checks.length === classicContexts.length
      && new Set(checks.map(check => check?.context)).size === classicContexts.length
      && checks.every(check => (
        classicContexts.includes(check?.context)
        && check?.app_id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID
      ))
    );
    if (
      mainBranch?.name !== "main"
      || mainBranch?.protected !== true
      || mainBranch?.protection?.enabled !== true
      || branchProtectionRule?.enforcement_level !== "everyone"
      || !hasExactContexts
      || !hasExactChecks
    ) {
      throw new Error("Protected main lacks the exact enforced classic required checks.");
    }
    const applicable = ghJson([
      "api", "--method", "GET", `repos/${repository}/rules/branches/main`,
      "-f", "per_page=100",
    ]);
    if (!Array.isArray(applicable)) {
      throw new Error("Protected-head refresh applicable ruleset proof is malformed.");
    }
    const strictRulesetChecks = new Set(applicable.flatMap(rule => (
      rule?.type === "required_status_checks"
      && rule?.parameters?.strict_required_status_checks_policy === true
      && Array.isArray(rule?.parameters?.required_status_checks)
        ? rule.parameters.required_status_checks
          .filter(check => check?.integration_id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID)
          .map(check => check?.context)
        : []
    )));
    if (!policy.rulesetRequiredChecks.every(context => strictRulesetChecks.has(context))) {
      throw new Error("Protected main lacks the repository-policy ruleset contexts.");
    }
  }

  function requireBoundedArrayPage({ response, key, label }) {
    const values = response?.[key];
    const totalCount = Number(response?.total_count ?? values?.length);
    if (
      !Array.isArray(values)
      || !Number.isSafeInteger(totalCount)
      || totalCount < values.length
      || totalCount > 100
    ) {
      throw new Error(`${label} is malformed or exceeds the proven pagination bound.`);
    }
    return values;
  }

  return Object.freeze({
    verifyCandidateChecksAbsent,
    verifyNoSynchronizeRun,
    reconcileCandidateCi,
    reconcileCloudCheck,
    completeCloudCheck,
    verifyBranchProtection,
  });
}
