import assert from "node:assert/strict";

import {
  executeProtectedHeadRefreshController,
  normalizeProtectedHeadRefreshProjection,
  PROTECTED_HEAD_REFRESH_BOT_EMAIL,
  PROTECTED_HEAD_REFRESH_BOT_NAME,
  PROTECTED_MAIN_REFRESH_SCHEMA,
  protectedHeadRefreshCiRunName,
  protectedHeadRefreshOperationId,
  renderProtectedHeadRefreshCommitMessage,
  renderProtectedHeadRefreshRearmCommitMessage,
} from "../scripts/protected-main-refresh-lib.mjs";

export const delivered = "a".repeat(40);
export const candidate = "b".repeat(40);
export const refreshTwo = "c".repeat(40);
export const mainOne = "d".repeat(40);
export const targetMain = "e".repeat(40);
export const treeOne = "f".repeat(40);
export const treeTwo = "1".repeat(40);
export const repository = "owner/repo";
export const branch = "agent/device/protected-refresh";
export const claimId = "2".repeat(64);
export const claimDigest = "3".repeat(64);
export const ledgerRevision = "4".repeat(40);
export const integrationReceiptDigest = "5".repeat(64);
export const reviewRequestId = "github-pull-request:PR_17";
export const parentTimestamp = "1770000000 +0800";
export const pullRequestTitle = "Protected refresh controller";
export const autoMergeActor = Object.freeze({
  id: 77,
  node_id: "U_huijoohwee",
  login: "huijoohwee",
  type: "User",
});

export function projectionInput(overrides = {}) {
  const candidateCommitMessage = renderProtectedHeadRefreshRearmCommitMessage({
    pullRequestNumber: 17,
    deliveredHeadSha: delivered,
    targetMainSha: targetMain,
  });
  const projection = {
    operation: "protected-head-refresh",
    pull_request_number: "17",
    branch,
    delivered_head_sha: delivered,
    observed_head_sha: delivered,
    target_main_sha: targetMain,
    canonical_base_sha: mainOne,
    claim_id: claimId,
    claim_digest: claimDigest,
    ledger_revision: ledgerRevision,
    review_request_id: reviewRequestId,
    pull_request_node_id: "PR_17",
    pull_request_title: pullRequestTitle,
    auto_merge_method: "squash",
    auto_merge_enabled_by_database_id: String(autoMergeActor.id),
    auto_merge_enabled_by_node_id: autoMergeActor.node_id,
    auto_merge_enabled_by_login: autoMergeActor.login,
    auto_merge_enabled_by_type: autoMergeActor.type,
    auto_merge_commit_title: pullRequestTitle,
    auto_merge_commit_message: "null",
    candidate_auto_merge_commit_title: pullRequestTitle,
    candidate_auto_merge_commit_message: JSON.stringify(candidateCommitMessage),
    integration_receipt_digest: integrationReceiptDigest,
    transition_counter: 6,
    ...overrides,
  };
  projection.operation_id = protectedHeadRefreshOperationId({ repository, projection });
  return projection;
}

export function normalizedProjection(overrides = {}) {
  return normalizeProtectedHeadRefreshProjection({
    repository,
    input: projectionInput(overrides),
  });
}

export function rawPull({
  headSha = delivered,
  autoMergeMethod = "squash",
  mergeState = "behind",
  title = pullRequestTitle,
  baseSha = mainOne,
  baseRef = "main",
  baseRepository = repository,
  state = "open",
  merged = false,
  number = 17,
  nodeId = "PR_17",
  headRef = branch,
  headRepository = repository,
  autoMergeActorValue = autoMergeActor,
  autoMergeCommitTitle = pullRequestTitle,
  autoMergeCommitMessage,
  autoMergeAuthorization,
  mergedBy = autoMergeActor,
} = {}) {
  const candidateCommitMessage = renderProtectedHeadRefreshRearmCommitMessage({
    pullRequestNumber: 17,
    deliveredHeadSha: delivered,
    targetMainSha: targetMain,
  });
  const authorization = autoMergeAuthorization
    || (headSha === delivered ? "original" : "candidate");
  const commitMessage = autoMergeCommitMessage === undefined
    ? (authorization === "candidate" ? candidateCommitMessage : null)
    : autoMergeCommitMessage;
  return {
    number,
    html_url: `https://github.com/${repository}/pull/17`,
    node_id: nodeId,
    title,
    state,
    merged,
    merged_at: merged ? "2026-08-07T00:00:00Z" : null,
    draft: false,
    mergeable_state: mergeState,
    merge_commit_sha: merged ? refreshTwo : null,
    auto_merge: autoMergeMethod === null ? null : {
      merge_method: autoMergeMethod,
      enabled_by: autoMergeActorValue,
      commit_title: autoMergeCommitTitle,
      commit_message: commitMessage,
    },
    merged_by: merged ? mergedBy : null,
    base: { ref: baseRef, sha: baseSha, repo: { full_name: baseRepository } },
    head: { ref: headRef, sha: headSha, repo: { full_name: headRepository } },
  };
}

export function createControllerHarness(options = {}) {
  const projection = normalizedProjection();
  const state = {
    headSha: options.initialHeadSha || delivered,
    autoMergeMethod: options.initialAutoMergeMethod === undefined
      ? "squash"
      : options.initialAutoMergeMethod,
    autoMergeAuthorization: options.initialAutoMergeAuthorization
      || ((options.initialAutoMergeMethod === null)
        ? null
        : ((options.initialHeadSha || delivered) === candidate
          && (options.initialCloudStatus === "pending" || options.initialCloudStatus === "complete")
          ? "candidate"
          : "original")),
    mergeState: options.initialMergeState || "behind",
    title: pullRequestTitle,
    baseSha: options.initialBaseSha
      || ((options.initialHeadSha || delivered) === candidate ? targetMain : mainOne),
    baseRef: "main",
    baseRepository: repository,
    mainSha: targetMain,
    merged: options.merged === true,
    reads: 0,
    cloudStatus: options.initialCloudStatus || "absent",
    cloudCheckRunIds: [501],
  };
  const events = [];
  const callbacks = {
    projection,
    readPullRequest: () => {
      state.reads += 1;
      if (options.unknownReads && state.reads <= options.unknownReads) {
        return rawPull({ ...state, mergeState: "unknown" });
      }
      if (options.driftBeforeCas && state.reads === 3) {
        state.title = "Drifted before CAS";
      }
      if (options.driftAtCasFence && state.reads === 4) {
        state.title = "Drifted at CAS fence";
      }
      if (options.baseDriftBeforeCas && state.reads === 3) {
        state.baseSha = targetMain;
      }
      return rawPull({
        headSha: state.headSha,
        autoMergeMethod: state.autoMergeMethod,
        autoMergeAuthorization: state.autoMergeAuthorization,
        mergeState: state.mergeState,
        title: state.title,
        baseSha: state.baseSha,
        baseRef: state.baseRef,
        baseRepository: state.baseRepository,
        state: state.merged ? "closed" : "open",
        merged: state.merged,
      });
    },
    verifyRefreshChain: ({ currentHeadSha }) => {
      if (currentHeadSha === delivered) return null;
      if (currentHeadSha === candidate) {
        return {
          schema: PROTECTED_MAIN_REFRESH_SCHEMA,
          deliveredHeadSha: delivered,
          refreshedHeadSha: candidate,
          mainParentSha: targetMain,
        };
      }
      throw new Error("advanced beyond an exact protected-main refresh chain");
    },
    verifyCloudAuthority: () => {
      events.push("cloud");
      if (
        options.mainDriftDuringFinalCloudProof
        && events.filter(value => value === "cloud").length === 5
      ) state.mainSha = mainOne;
    },
    verifyBranchProtection: () => events.push("protection"),
    readProtectedMain: () => {
      events.push("main");
      if (options.mainDriftAfterChecks && events.includes("gate-complete")) return mainOne;
      return state.mainSha;
    },
    validateSquashSubject: title => {
      events.push("subject");
      return title;
    },
    prepareCandidate: () => {
      events.push("prepare");
      return { candidateSha: candidate };
    },
    inspectCandidate: ({ candidateSha }) => {
      events.push("inspect");
      if (candidateSha !== candidate) throw new Error("candidate mismatch");
      return { candidateSha };
    },
    verifyCandidateHead: () => {
      events.push("head-fence");
      if (options.candidateHeadFenceRace) {
        throw new Error("fetched feature ref drifted");
      }
    },
    pushCandidate: () => {
      events.push("push");
      if (options.pushRaceHeadSha) state.headSha = options.pushRaceHeadSha;
      else if (!options.pushNeverObservable) {
        state.headSha = candidate;
        state.baseSha = options.postPushBaseSha || targetMain;
        state.baseRef = options.postPushBaseRef || "main";
        state.baseRepository = options.postPushBaseRepository || repository;
      }
      state.mergeState = options.postPushMergeState || "blocked";
      if (options.lostPushResponse || options.pushNeverObservable) {
        throw new Error("push response lost");
      }
    },
    verifyCandidateWorkflow: () => {
      events.push("workflow");
      if (options.candidateWorkflowDrift) {
        throw new Error("candidate CI workflow differs from protected main");
      }
    },
    verifyCandidateChecksAbsent: () => {
      events.push("checks-absent");
      if (options.existingCandidateCloudCheck) {
        throw new Error("candidate already has a cloud check");
      }
    },
    verifyNoSynchronizeRun: () => {
      events.push("no-sync");
      if (options.synchronizeBreach) throw new Error("provider contract breached");
    },
    reconcileCandidateCi: () => {
      events.push("ci");
      if (
        !options.neverUserArm
        && state.cloudStatus === "pending"
        && state.autoMergeAuthorization === "original"
      ) {
        state.autoMergeMethod = options.substitutedArm ? "merge" : "squash";
        state.autoMergeAuthorization = options.substitutedArm ? "substituted" : "candidate";
      }
      return {
        workflowRunId: 123,
        checkSuiteId: 9123,
        htmlUrl: "https://github.com/owner/repo/actions/runs/123",
      };
    },
    reconcileCloudCheck: ({ create }) => {
      events.push(create ? "gate-create" : "gate-read");
      if (state.cloudStatus === "absent" && create) {
        if (options.crashBeforeGateCreateOnce && !state.gateCreateCrashed) {
          state.gateCreateCrashed = true;
          throw new Error("crash before gate create");
        }
        state.cloudStatus = "pending";
      }
      return {
        status: state.cloudStatus,
        checkRunIds: state.cloudStatus === "absent" ? [] : state.cloudCheckRunIds,
        externalId: `agentic-protected-head-refresh:${projection.operation_id}`,
      };
    },
    completeCloudCheck: ({ ci }) => {
      events.push("gate-complete");
      assert.equal(ci.workflowRunId, 123);
      if (options.cloudFailsBeforePatch) {
        throw new Error("owned cloud check terminalized before authorization commit");
      }
      if (options.partialCloudCompletion) {
        return {
          status: "pending",
          checkRunIds: state.cloudCheckRunIds,
          externalId: `agentic-protected-head-refresh:${projection.operation_id}`,
        };
      }
      const receipt = {
        status: "complete",
        checkRunIds: state.cloudCheckRunIds,
        externalId: `agentic-protected-head-refresh:${projection.operation_id}`,
      };
      state.cloudStatus = "complete";
      if (options.disableAfterCompletion) {
        state.autoMergeMethod = null;
        state.autoMergeAuthorization = null;
      }
      if (options.mergeAfterCompletion) state.merged = true;
      if (options.dropCloudAfterCompletion) state.cloudStatus = "absent";
      return receipt;
    },
    verifyMergedCommit: value => {
      events.push("merged");
      if (options.captureMergedCommit) options.captureMergedCommit(value);
    },
    sleep: () => {
      events.push("sleep");
      if (options.candidateBaseConvergesOnSleep && state.headSha === candidate) {
        state.baseSha = targetMain;
        state.mergeState = "blocked";
      }
    },
  };
  return {
    state,
    events,
    execute: overrides => executeProtectedHeadRefreshController({
      ...callbacks,
      maxCandidatePolls: 3,
      maxAuthorizationPolls: 3,
      ...overrides,
    }),
  };
}

export function candidateGitValues({ operationId }) {
  const message = renderProtectedHeadRefreshCommitMessage({
    operationId,
    observedHeadSha: delivered,
    targetMainSha: targetMain,
  });
  const observedCommit = [
    `tree ${treeOne}`,
    `author Developer <developer@example.com> ${parentTimestamp}`,
    `committer Developer <developer@example.com> ${parentTimestamp}`,
    "",
    "Original commit",
    "",
  ].join("\n");
  const exactCandidate = [
    `tree ${treeTwo}`,
    `parent ${delivered}`,
    `parent ${targetMain}`,
    `author ${PROTECTED_HEAD_REFRESH_BOT_NAME} <${PROTECTED_HEAD_REFRESH_BOT_EMAIL}> ${parentTimestamp}`,
    `committer ${PROTECTED_HEAD_REFRESH_BOT_NAME} <${PROTECTED_HEAD_REFRESH_BOT_EMAIL}> ${parentTimestamp}`,
    "",
    message,
  ].join("\n");
  return {
    [`merge-tree --write-tree --no-messages ${delivered} ${targetMain}`]: treeTwo,
    [`show -s --format=%cI ${delivered}`]: "2026-02-02T10:40:00+08:00\n",
    [`cat-file commit ${delivered}`]: observedCommit,
    [`cat-file commit ${candidate}`]: exactCandidate,
  };
}

export function createCandidateGitText({ operationId, overrides = {} }) {
  const values = { ...candidateGitValues({ operationId }), ...overrides };
  return args => {
    const key = args.join(" ");
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    return values[key];
  };
}

export function ciRun({ operationId, overrides = {} }) {
  return {
    id: 123,
    check_suite_id: 9123,
    event: "workflow_dispatch",
    head_sha: candidate,
    head_branch: branch,
    display_title: protectedHeadRefreshCiRunName({ operationId, candidateSha: candidate }),
    path: ".github/workflows/ci.yml",
    repository: { full_name: repository },
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/owner/repo/actions/runs/123",
    ...overrides,
  };
}

export function cloudResult(overrides = {}) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision,
    claimDigest,
    findings: [],
    subject: {
      repository,
      pullRequestNumber: 17,
      branch,
      headSha: delivered,
    },
    claim: {
      claimId,
      state: "integrated-preserved",
      canonicalBaseRevision: mainOne,
      laneRevision: delivered,
      reviewRequestId,
      integrationReceiptDigest,
      transitionCounter: 6,
    },
    ...overrides,
  };
}

export function createChainValues() {
  return {
    [`rev-list --parents -n 1 ${refreshTwo}`]:
      `${refreshTwo} ${candidate} ${targetMain}`,
    [`merge-base --is-ancestor ${targetMain} origin/main`]: "",
    [`merge-tree --write-tree --no-messages ${candidate} ${targetMain}`]: treeTwo,
    [`rev-parse ${refreshTwo}^{tree}`]: treeTwo,
    [`rev-list --parents -n 1 ${candidate}`]:
      `${candidate} ${delivered} ${mainOne}`,
    [`merge-base --is-ancestor ${mainOne} origin/main`]: "",
    [`merge-tree --write-tree --no-messages ${delivered} ${mainOne}`]: treeOne,
    [`rev-parse ${candidate}^{tree}`]: treeOne,
  };
}

export function createChainGitText(values = createChainValues()) {
  return args => {
    const key = args.join(" ");
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    const value = values[key];
    if (value instanceof Error) throw value;
    return value;
  };
}

export function mergedCommitGitValues({ body }) {
  return {
    [`rev-list --parents -n 1 ${refreshTwo}`]: `${refreshTwo} ${targetMain}\n`,
    [`rev-parse ${refreshTwo}^{tree}`]: `${treeTwo}\n`,
    [`rev-parse ${candidate}^{tree}`]: `${treeTwo}\n`,
    [`show -s --format=%s ${refreshTwo}`]: `${pullRequestTitle}\n`,
    [`show -s --format=%b ${refreshTwo}`]: `${body}\n`,
    [`merge-base --is-ancestor ${refreshTwo} refs/remotes/origin/main`]: "",
  };
}

export function createMappedGitText(values) {
  return args => {
    const key = args.join(" ");
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    const value = values[key];
    if (value instanceof Error) throw value;
    return value;
  };
}
