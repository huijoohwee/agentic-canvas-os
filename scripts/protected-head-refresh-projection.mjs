import { createHash } from "node:crypto";

import {
  PROTECTED_HEAD_REFRESH_CI_RUN_PREFIX,
  PROTECTED_HEAD_REFRESH_COMMIT_SCHEMA,
  PROTECTED_HEAD_REFRESH_HANDSHAKE_SCHEMA,
  PROTECTED_HEAD_REFRESH_OPERATION_SCHEMA,
  TERMINAL_CI_CONCLUSIONS,
  requireBranch,
  requireCanonicalPositiveInteger,
  requireDigest,
  requireExactText,
  requireNullableTextJson,
  requireRepository,
  requireSha,
} from "./protected-head-refresh-shared.mjs";

export function normalizeProtectedHeadRefreshProjection({ repository, input }) {
  requireRepository(repository, "Protected-head refresh repository");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Protected-head refresh requires an exact dispatch projection.");
  }
  if (input.operation !== "protected-head-refresh") {
    throw new Error("Protected-head refresh operation is invalid.");
  }
  const pullRequestNumber = requireCanonicalPositiveInteger(
    input.pull_request_number,
    "Protected-head refresh pull request number",
  );
  const transitionCounter = requireCanonicalPositiveInteger(
    input.transition_counter,
    "Protected-head refresh transition counter",
  );
  const projection = {
    operation: "protected-head-refresh",
    pull_request_number: String(pullRequestNumber),
    branch: requireBranch(input.branch, "Protected-head refresh branch"),
    delivered_head_sha: requireSha(input.delivered_head_sha, "Protected-head refresh delivered head"),
    observed_head_sha: requireSha(input.observed_head_sha, "Protected-head refresh observed head"),
    target_main_sha: requireSha(input.target_main_sha, "Protected-head refresh target main"),
    canonical_base_sha: requireSha(input.canonical_base_sha, "Protected-head refresh canonical base"),
    claim_id: requireDigest(input.claim_id, "Protected-head refresh claim ID"),
    claim_digest: requireDigest(input.claim_digest, "Protected-head refresh claim digest"),
    ledger_revision: requireSha(input.ledger_revision, "Protected-head refresh ledger revision"),
    review_request_id: requireExactText(
      input.review_request_id,
      "Protected-head refresh review request ID",
    ),
    pull_request_node_id: requireExactText(
      input.pull_request_node_id,
      "Protected-head refresh pull request node ID",
    ),
    pull_request_title: requireExactText(
      input.pull_request_title,
      "Protected-head refresh pull request title",
    ),
    auto_merge_method: requireExactText(
      input.auto_merge_method,
      "Protected-head refresh auto-merge method",
    ).toLowerCase(),
    auto_merge_enabled_by_database_id: requireCanonicalPositiveInteger(
      input.auto_merge_enabled_by_database_id,
      "Protected-head refresh auto-merge actor database ID",
    ),
    auto_merge_enabled_by_node_id: requireExactText(
      input.auto_merge_enabled_by_node_id,
      "Protected-head refresh auto-merge actor node ID",
    ),
    auto_merge_enabled_by_login: requireExactText(
      input.auto_merge_enabled_by_login,
      "Protected-head refresh auto-merge actor login",
    ),
    auto_merge_enabled_by_type: requireExactText(
      input.auto_merge_enabled_by_type,
      "Protected-head refresh auto-merge actor type",
    ),
    auto_merge_commit_title: requireExactText(
      input.auto_merge_commit_title,
      "Protected-head refresh auto-merge commit title",
    ),
    auto_merge_commit_message: requireNullableTextJson(
      input.auto_merge_commit_message,
      "Protected-head refresh auto-merge commit message",
    ),
    candidate_auto_merge_commit_title: requireExactText(
      input.candidate_auto_merge_commit_title,
      "Protected-head refresh candidate auto-merge commit title",
    ),
    candidate_auto_merge_commit_message: requireNullableTextJson(
      input.candidate_auto_merge_commit_message,
      "Protected-head refresh candidate auto-merge commit message",
    ),
    integration_receipt_digest: requireDigest(
      input.integration_receipt_digest,
      "Protected-head refresh integration receipt digest",
    ),
    transition_counter: transitionCounter,
  };
  const expectedCandidateMessage = JSON.stringify(
    renderProtectedHeadRefreshRearmCommitMessage({
      pullRequestNumber,
      deliveredHeadSha: projection.delivered_head_sha,
      targetMainSha: projection.target_main_sha,
    }),
  );
  if (
    projection.auto_merge_method !== "squash"
    || projection.auto_merge_enabled_by_login !== "huijoohwee"
    || projection.auto_merge_enabled_by_type !== "User"
    || projection.review_request_id !== `github-pull-request:${projection.pull_request_node_id}`
    || projection.candidate_auto_merge_commit_title !== projection.auto_merge_commit_title
    || projection.candidate_auto_merge_commit_message !== expectedCandidateMessage
    || JSON.parse(projection.candidate_auto_merge_commit_message) === null
    || projection.candidate_auto_merge_commit_message === projection.auto_merge_commit_message
  ) {
    throw new Error(
      "Protected-head refresh requires the exact original and candidate huijoohwee SQUASH authorizations.",
    );
  }
  const operationId = protectedHeadRefreshOperationId({ repository, projection });
  if (input.operation_id !== operationId) {
    throw new Error("Protected-head refresh operation ID does not match its exact projection.");
  }
  return Object.freeze({
    repository,
    pullRequestNumber,
    ...projection,
    operation_id: operationId,
  });
}

export function protectedHeadRefreshOperationId({ repository, projection }) {
  requireRepository(repository, "Protected-head refresh repository");
  const projected = {
    operation: projection.operation,
    pull_request_number: projection.pull_request_number,
    branch: projection.branch,
    delivered_head_sha: projection.delivered_head_sha,
    observed_head_sha: projection.observed_head_sha,
    target_main_sha: projection.target_main_sha,
    canonical_base_sha: projection.canonical_base_sha,
    claim_id: projection.claim_id,
    claim_digest: projection.claim_digest,
    ledger_revision: projection.ledger_revision,
    review_request_id: projection.review_request_id,
    pull_request_node_id: projection.pull_request_node_id,
    pull_request_title: projection.pull_request_title,
    auto_merge_method: projection.auto_merge_method,
    auto_merge_enabled_by_database_id: Number(projection.auto_merge_enabled_by_database_id),
    auto_merge_enabled_by_node_id: projection.auto_merge_enabled_by_node_id,
    auto_merge_enabled_by_login: projection.auto_merge_enabled_by_login,
    auto_merge_enabled_by_type: projection.auto_merge_enabled_by_type,
    auto_merge_commit_title: projection.auto_merge_commit_title,
    auto_merge_commit_message: projection.auto_merge_commit_message,
    candidate_auto_merge_commit_title: projection.candidate_auto_merge_commit_title,
    candidate_auto_merge_commit_message: projection.candidate_auto_merge_commit_message,
    integration_receipt_digest: projection.integration_receipt_digest,
    transition_counter: projection.transition_counter,
  };
  return createHash("sha256").update(JSON.stringify({
    schema: PROTECTED_HEAD_REFRESH_OPERATION_SCHEMA,
    repository,
    ...projected,
  })).digest("hex");
}

export function renderProtectedHeadRefreshRearmCommitMessage({
  pullRequestNumber,
  deliveredHeadSha,
  targetMainSha,
}) {
  const number = requireCanonicalPositiveInteger(
    pullRequestNumber,
    "Protected-head refresh re-arm pull request number",
  );
  requireSha(deliveredHeadSha, "Protected-head refresh re-arm delivered head");
  requireSha(targetMainSha, "Protected-head refresh re-arm target main");
  return [
    "Protected head refresh authorization",
    "",
    `Agentic-Pull-Request: ${number}`,
    `Agentic-Delivered-Head: ${deliveredHeadSha}`,
    `Agentic-Target-Main: ${targetMainSha}`,
  ].join("\n");
}

export function renderProtectedHeadRefreshHandshakeEvidence({
  projection,
  candidateSha,
  phase,
  ci = null,
}) {
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error("Protected-head refresh handshake requires a normalized projection.");
  }
  requireSha(candidateSha, "Protected-head refresh handshake candidate");
  if (!new Set([
    "pending-user-authorization",
    "authorization-complete",
  ]).has(phase)) {
    throw new Error("Protected-head refresh handshake phase is invalid.");
  }
  const evidence = {
    schema: PROTECTED_HEAD_REFRESH_HANDSHAKE_SCHEMA,
    operation_id: requireDigest(
      projection.operation_id,
      "Protected-head refresh handshake operation ID",
    ),
    phase,
    candidate_sha: candidateSha,
    projection: {
      repository: requireRepository(
        projection.repository,
        "Protected-head refresh handshake repository",
      ),
      operation: projection.operation,
      pull_request_number: projection.pull_request_number,
      branch: projection.branch,
      delivered_head_sha: projection.delivered_head_sha,
      observed_head_sha: projection.observed_head_sha,
      target_main_sha: projection.target_main_sha,
      canonical_base_sha: projection.canonical_base_sha,
      claim_id: projection.claim_id,
      claim_digest: projection.claim_digest,
      ledger_revision: projection.ledger_revision,
      review_request_id: projection.review_request_id,
      pull_request_node_id: projection.pull_request_node_id,
      pull_request_title: projection.pull_request_title,
      auto_merge_method: projection.auto_merge_method,
      auto_merge_enabled_by_database_id:
        projection.auto_merge_enabled_by_database_id,
      auto_merge_enabled_by_node_id: projection.auto_merge_enabled_by_node_id,
      auto_merge_enabled_by_login: projection.auto_merge_enabled_by_login,
      auto_merge_enabled_by_type: projection.auto_merge_enabled_by_type,
      auto_merge_commit_title: projection.auto_merge_commit_title,
      auto_merge_commit_message: projection.auto_merge_commit_message,
      candidate_auto_merge_commit_title:
        projection.candidate_auto_merge_commit_title,
      candidate_auto_merge_commit_message:
        projection.candidate_auto_merge_commit_message,
      integration_receipt_digest: projection.integration_receipt_digest,
      transition_counter: projection.transition_counter,
    },
    ...(ci === null ? {} : {
      ci: {
        workflow_run_id: requireCanonicalPositiveInteger(
          ci.workflowRunId,
          "Protected-head refresh handshake workflow run",
        ),
        check_suite_id: requireCanonicalPositiveInteger(
          ci.checkSuiteId,
          "Protected-head refresh handshake check suite",
        ),
      },
    }),
  };
  return JSON.stringify(evidence);
}

export function requireProtectedHeadRefreshControllerRevision({
  controllerRevision,
  targetMainSha,
  mergedReplay = false,
  targetMainIsAncestor = false,
  mergeCommitIsAncestor = false,
}) {
  requireSha(controllerRevision, "Protected-head refresh controller revision");
  requireSha(targetMainSha, "Protected-head refresh target main revision");
  if (
    controllerRevision !== targetMainSha
    && !(
      mergedReplay === true
      && targetMainIsAncestor === true
      && mergeCommitIsAncestor === true
    )
  ) {
    throw new Error(
      "Protected-head refresh controller revision is neither its projected target main nor an authorized merged successor.",
    );
  }
  return controllerRevision;
}

export function renderProtectedHeadRefreshCommitMessage({
  operationId,
  observedHeadSha,
  targetMainSha,
}) {
  requireDigest(operationId, "Protected-head refresh commit operation ID");
  requireSha(observedHeadSha, "Protected-head refresh commit observed head");
  requireSha(targetMainSha, "Protected-head refresh commit target main");
  return [
    "Protected head refresh",
    "",
    `Agentic-Schema: ${PROTECTED_HEAD_REFRESH_COMMIT_SCHEMA}`,
    "Agentic-Operation: protected-head-refresh",
    `Agentic-Operation-Id: ${operationId}`,
    `Agentic-Observed-Head: ${observedHeadSha}`,
    `Agentic-Target-Main: ${targetMainSha}`,
    "",
  ].join("\n");
}

export function protectedHeadRefreshCiRunName({ operationId, candidateSha }) {
  requireDigest(operationId, "Protected-head refresh CI operation ID");
  requireSha(candidateSha, "Protected-head refresh CI candidate");
  return `${PROTECTED_HEAD_REFRESH_CI_RUN_PREFIX} ${operationId} ${candidateSha}`;
}

export function requireProtectedHeadRefreshCiRun({
  run,
  repository,
  branch,
  candidateSha,
  operationId,
  workflowPath = ".github/workflows/ci.yml",
  requireSuccess = false,
}) {
  requireRepository(repository, "Protected-head refresh CI repository");
  requireBranch(branch, "Protected-head refresh CI branch");
  const expectedName = protectedHeadRefreshCiRunName({ operationId, candidateSha });
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error("Protected-head refresh CI run is missing.");
  }
  const runId = Number(run.id);
  const checkSuiteId = Number(run.check_suite_id ?? run.check_suite?.id);
  if (
    !Number.isSafeInteger(runId)
    || runId <= 0
    || !Number.isSafeInteger(checkSuiteId)
    || checkSuiteId <= 0
    || run.event !== "workflow_dispatch"
    || run.head_sha !== candidateSha
    || run.head_branch !== branch
    || run.display_title !== expectedName
    || run.path !== workflowPath
    || run.repository?.full_name !== repository
  ) {
    throw new Error("Protected-head refresh CI run identity drifted.");
  }
  const status = String(run.status || "").toLowerCase();
  if (!new Set([
    "queued",
    "in_progress",
    "pending",
    "requested",
    "waiting",
    "completed",
  ]).has(status)) {
    throw new Error("Protected-head refresh CI run status is unsupported.");
  }
  const conclusion = run.conclusion === null
    ? null
    : String(run.conclusion || "").toLowerCase();
  if (status !== "completed" && conclusion !== null) {
    throw new Error("Protected-head refresh CI run has a premature conclusion.");
  }
  if (status === "completed" && !TERMINAL_CI_CONCLUSIONS.has(conclusion)) {
    throw new Error("Protected-head refresh CI run has no supported terminal conclusion.");
  }
  if (requireSuccess && (status !== "completed" || conclusion !== "success")) {
    throw new Error("Protected-head refresh CI run did not complete successfully.");
  }
  return Object.freeze({
    id: runId,
    checkSuiteId,
    status,
    conclusion,
    htmlUrl: requireExactText(run.html_url, "Protected-head refresh CI run URL"),
    displayTitle: expectedName,
  });
}

export function reconcileProtectedHeadRefreshCiRuns({
  runs,
  repository,
  branch,
  candidateSha,
  operationId,
  workflowPath = ".github/workflows/ci.yml",
}) {
  if (!Array.isArray(runs)) {
    throw new Error("Protected-head refresh CI run set is malformed.");
  }
  const expectedName = protectedHeadRefreshCiRunName({ operationId, candidateSha });
  const matching = runs.filter(run => run?.display_title === expectedName);
  if (matching.length > 10) {
    throw new Error("Protected-head refresh CI operation exceeds its run-count bound.");
  }
  if (matching.length === 0) {
    return Object.freeze({
      status: "absent",
      workflowRunId: null,
      workflowRunIds: Object.freeze([]),
    });
  }
  // Validate every same-operation run before selecting one. A valid success
  // cannot mask a duplicate whose branch, head, workflow, or repository
  // identity was widened.
  const receipts = matching.map(run => requireProtectedHeadRefreshCiRun({
    run,
    repository,
    branch,
    candidateSha,
    operationId,
    workflowPath,
  })).sort((left, right) => left.id - right.id);
  const selected = receipts.at(-1);
  if (selected.status === "completed" && selected.conclusion === "success") {
    return Object.freeze({
      status: "succeeded",
      workflowRunId: selected.id,
      checkSuiteId: selected.checkSuiteId,
      workflowRunIds: Object.freeze(receipts.map(receipt => receipt.id)),
      run: selected,
    });
  }
  if (selected.status !== "completed") {
    return Object.freeze({
      status: "waiting",
      workflowRunId: selected.id,
      checkSuiteId: selected.checkSuiteId,
      workflowRunIds: Object.freeze(receipts.map(receipt => receipt.id)),
    });
  }
  return Object.freeze({
    status: "retryable-failure",
    workflowRunId: selected.id,
    checkSuiteId: selected.checkSuiteId,
    workflowRunIds: Object.freeze(receipts.map(receipt => receipt.id)),
    run: selected,
  });
}
