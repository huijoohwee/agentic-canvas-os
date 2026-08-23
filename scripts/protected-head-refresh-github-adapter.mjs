import { execFileSync, spawnSync } from "node:child_process";

import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { createProtectedHeadRefreshGithubProvider } from "./protected-head-refresh-github-provider.mjs";
import {
  createProtectedHeadRefreshCandidate,
  executeProtectedHeadRefreshController,
  normalizeProtectedHeadRefreshProjection,
  requireProtectedHeadRefreshCloudResult,
  requireProtectedHeadRefreshControllerRevision,
  requireProtectedHeadRefreshPullRequest,
  verifyProtectedHeadRefreshCandidate,
  verifyProtectedHeadRefreshMergedCommit,
  verifyProtectedMainRefreshChain,
} from "./protected-main-refresh-lib.mjs";
import { requireProtectedSquashSubject } from "./protected-squash-subject.mjs";
import { readProtectedHeadRefreshRepositoryPolicy } from "./protected-head-refresh-repository-policy.mjs";

export function runProtectedHeadRefresh({
  repository,
  environment = process.env,
  runtime = {},
}) {
  const repo = requiredText(repository, "Protected-head refresh repository");
  const run = runtime.run || ((command, args, options = {}) => (
    runCommand(command, args, { environment, ...options })
  ));
  const gh = runtime.gh || ((args, options = {}) => run("gh", args, options));
  const ghJson = runtime.ghJson || ((args, options = {}) => (
    JSON.parse(gh(args, options).stdout || "null")
  ));
  const git = runtime.git || ((args, options = {}) => run("git", args, options));
  const gitText = runtime.gitText || (args => (
    execFileSync("git", args, { encoding: "utf8", timeout: 300_000 })
  ));
  const gitBuffer = runtime.gitBuffer || (args => (
    execFileSync("git", args, { timeout: 300_000 })
  ));
  const sleepSeconds = runtime.sleepSeconds || (seconds => {
    execFileSync("sleep", [String(seconds)], {
      timeout: Math.ceil(Number(seconds) * 1_000) + 5_000,
    });
  });
  const requiredEnv = name => {
    const value = environment[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };

  if (requiredEnv("GITHUB_SERVER_URL") !== "https://github.com") {
    throw new Error("Protected-head refresh requires the github.com provider.");
  }
  if (requiredEnv("GITHUB_REF") !== "refs/heads/main") {
    throw new Error("Protected-head refresh requires a workflow dispatched at protected main.");
  }
  const ledgerRepository = requireProtectedHeadRefreshLedgerRepository({
    targetRepository: repo,
    ledgerRepository: requiredEnv("AGENTIC_LEDGER_REPOSITORY"),
  });
  const controllerRevision = requiredEnv("PROTECTED_HEAD_REFRESH_CONTROLLER_REVISION");
  requireFullSha(controllerRevision, "Protected-head refresh controller revision");
  if (gitText(["rev-parse", "HEAD"]).trim() !== controllerRevision) {
    throw new Error("Protected-head refresh checkout does not match its immutable workflow revision.");
  }
  const projection = normalizeProtectedHeadRefreshProjection({
    repository: repo,
    input: projectionInput(requiredEnv),
  });
  const allowAbsentMergedAuthorizationRecovery =
    requireProtectedHeadRefreshMergedAuthorizationRecovery({
      value: environment.PROTECTED_HEAD_REFRESH_MERGED_AUTHORIZATION_RECOVERY,
      projection,
      actorId: environment.GITHUB_ACTOR_ID,
      actorLogin: environment.GITHUB_ACTOR,
    });
  let capturedPullRequest = null;
  let mergedReplay = false;
  let targetMainIsAncestor = false;
  let mergeCommitIsAncestor = false;
  if (controllerRevision !== projection.target_main_sha) {
    capturedPullRequest = ghJson([
      "api", "--method", "GET",
      `repos/${repo}/pulls/${projection.pullRequestNumber}`,
    ]);
    const pullRequest = requireProtectedHeadRefreshPullRequest({
      pullRequest: capturedPullRequest,
      projection,
      autoMerge: "either",
    });
    mergedReplay = pullRequest.merged;
    if (mergedReplay) {
      targetMainIsAncestor = git([
        "merge-base", "--is-ancestor",
        projection.target_main_sha,
        controllerRevision,
      ], { allowFailure: true }).status === 0;
      mergeCommitIsAncestor = git([
        "merge-base", "--is-ancestor",
        pullRequest.mergeCommitSha,
        controllerRevision,
      ], { allowFailure: true }).status === 0;
    }
  }
  requireProtectedHeadRefreshControllerRevision({
    controllerRevision,
    targetMainSha: projection.target_main_sha,
    mergedReplay,
    targetMainIsAncestor,
    mergeCommitIsAncestor,
  });
  const policy = readProtectedHeadRefreshRepositoryPolicy({ environment });
  const provider = createProtectedHeadRefreshGithubProvider({
    repository: repo,
    projection,
    policy,
    gh,
    ghJson,
    requiredEnv,
    sleepSeconds,
  });
  const result = executeProtectedHeadRefreshController({
    projection: Object.freeze({
      ...projection,
      allowAbsentMergedAuthorizationRecovery,
    }),
    readPullRequest: () => {
      if (capturedPullRequest !== null) {
        const pullRequest = capturedPullRequest;
        capturedPullRequest = null;
        return pullRequest;
      }
      return ghJson([
        "api", "--method", "GET",
        `repos/${repo}/pulls/${projection.pullRequestNumber}`,
      ]);
    },
    verifyRefreshChain: ({ deliveredHeadSha, currentHeadSha, pullRequestNumber }) => {
      const mainRef = "refs/remotes/origin/main";
      const pullRef = `refs/remotes/pull/${pullRequestNumber}/head`;
      git([
        "fetch", "--no-tags", "origin",
        "+refs/heads/main:refs/remotes/origin/main",
        `+refs/pull/${pullRequestNumber}/head:${pullRef}`,
      ]);
      const fetchedHead = gitText(["rev-parse", pullRef]).trim();
      if (fetchedHead !== currentHeadSha) {
        throw new Error("Fetched pull-request head changed from the exact provider projection.");
      }
      return verifyProtectedMainRefreshChain({
        expectedHeadSha: deliveredHeadSha,
        observedHeadSha: currentHeadSha,
        gitText,
        mainRef,
      });
    },
    verifyCloudAuthority: ({ pullRequest }) => {
      // A protected refresh produces a descendant candidate after the source
      // claim has already been integrated.  If that same claim is lawfully
      // reclaimed while the candidate gate is pending, its mutable fence and
      // ledger revision advance.  The candidate remains bound to the original
      // immutable integration receipt and transition lineage, so rechecking
      // the superseded mutable fence would make recovery impossible.
      const refreshedCandidate = pullRequest.headSha !== projection.observed_head_sha;
      const cloud = invokeRepositoryCloudVerifier({
        ledgerRepository,
        environment,
        request: {
          targetRepository: repo,
          pullRequestNumber: projection.pullRequestNumber,
          branch: projection.branch,
          headSha: projection.delivered_head_sha,
          canonicalBaseSha: projection.canonical_base_sha,
          claimId: projection.claim_id,
          ...(!refreshedCandidate ? {
            expectedClaimDigest: projection.claim_digest,
            expectedLedgerRevision: projection.ledger_revision,
          } : {}),
          reviewRequestId: projection.review_request_id,
          requireStatus: "integrated-preserved",
          allowProtectedMainRefresh: true,
          integrationReceiptDigest: projection.integration_receipt_digest,
          transitionCounter: projection.transition_counter,
          ...(pullRequest.merged && allowAbsentMergedAuthorizationRecovery ? {
            allowRetiredIntegratedPreserved: true,
          } : {}),
        },
      });
      requireProtectedHeadRefreshCloudResult({
        result: cloud,
        projection,
        currentHeadSha: pullRequest.headSha,
      });
    },
    verifyBranchProtection: provider.verifyBranchProtection,
    readProtectedMain: readProtectedMainSha,
    validateSquashSubject: title => requireProtectedSquashSubject(title, {
      label: `PR #${projection.pullRequestNumber} protected squash subject`,
    }),
    prepareCandidate: ({ observedHeadSha, targetMainSha, operationId }) => {
      fetchProtectedHeadRefreshRefs({
        branch: projection.branch,
        expectedHeadSha: observedHeadSha,
        expectedMainSha: targetMainSha,
      });
      return createProtectedHeadRefreshCandidate({
        observedHeadSha,
        targetMainSha,
        operationId,
        gitText,
        commitTree: ({
          treeSha,
          parents,
          message,
          authorName,
          authorEmail,
          authorDate,
          committerName,
          committerEmail,
          committerDate,
        }) => git([
          "commit-tree", treeSha,
          "-p", parents[0],
          "-p", parents[1],
        ], {
          input: message,
          environment: {
            ...environment,
            GIT_AUTHOR_NAME: authorName,
            GIT_AUTHOR_EMAIL: authorEmail,
            GIT_AUTHOR_DATE: authorDate,
            GIT_COMMITTER_NAME: committerName,
            GIT_COMMITTER_EMAIL: committerEmail,
            GIT_COMMITTER_DATE: committerDate,
          },
        }).stdout.trim(),
      });
    },
    inspectCandidate: ({
      candidateSha,
      observedHeadSha,
      targetMainSha,
      operationId,
    }) => verifyProtectedHeadRefreshCandidate({
      candidateSha,
      observedHeadSha,
      targetMainSha,
      operationId,
      gitText,
    }),
    verifyCandidateHead: ({ branch, candidateSha, targetMainSha }) => {
      fetchProtectedHeadRefreshRefs({
        branch,
        expectedHeadSha: candidateSha,
        expectedMainSha: targetMainSha,
      });
    },
    pushCandidate: ({ branch, observedHeadSha, candidateSha }) => {
      const origin = gitText(["remote", "get-url", "origin"]).trim();
      if (!new RegExp(`^https://github\\.com/${escapeRegExp(repo)}(?:\\.git)?$`, "u").test(origin)) {
        throw new Error("Protected-head refresh origin is not the exact HTTPS repository.");
      }
      const token = requiredEnv("GH_TOKEN");
      const authorization = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
      git([
        "push",
        `--force-with-lease=refs/heads/${branch}:${observedHeadSha}`,
        "origin",
        `${candidateSha}:refs/heads/${branch}`,
      ], {
        environment: {
          ...environment,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
          GIT_TERMINAL_PROMPT: "0",
          GIT_TRACE: "0",
          GIT_TRACE_PACKET: "0",
          GIT_TRACE_PACK_ACCESS: "0",
          GIT_TRACE_PERFORMANCE: "0",
          GIT_TRACE_SETUP: "0",
          GIT_CURL_VERBOSE: "0",
        },
      });
    },
    verifyCandidateWorkflow: ({ candidateSha, targetMainSha }) => {
      const workflowPath = `.github/workflows/${policy.ciWorkflow}`;
      const candidateBlobSha = requireFullSha(
        gitText(["rev-parse", `${candidateSha}:${workflowPath}`]).trim(),
        "Protected-head refresh candidate CI workflow blob",
      );
      const trustedBlobSha = requireFullSha(
        gitText(["rev-parse", `${targetMainSha}:${workflowPath}`]).trim(),
        "Protected-head refresh trusted CI workflow blob",
      );
      if (candidateBlobSha !== trustedBlobSha) {
        throw new Error("Protected-head refresh candidate CI workflow differs from protected main.");
      }
      const candidateBytes = gitBuffer(["cat-file", "blob", candidateBlobSha]);
      const trustedBytes = gitBuffer(["cat-file", "blob", trustedBlobSha]);
      if (!candidateBytes.equals(trustedBytes)) {
        throw new Error("Protected-head refresh candidate CI workflow bytes are not exact.");
      }
    },
    verifyCandidateChecksAbsent: provider.verifyCandidateChecksAbsent,
    verifyNoSynchronizeRun: provider.verifyNoSynchronizeRun,
    reconcileCandidateCi: provider.reconcileCandidateCi,
    reconcileCloudCheck: provider.reconcileCloudCheck,
    completeCloudCheck: provider.completeCloudCheck,
    verifyMergedCommit: ({
      mergeCommitSha,
      candidateSha,
      targetMainSha,
      commitTitle,
      commitMessageJson,
    }) => verifyProtectedHeadRefreshMergedProviderState({
      mergeCommitSha,
      candidateSha,
      targetMainSha,
      commitTitle,
      commitMessageJson,
    }, {
      readProtectedMainSha,
      fetchProtectedMainRef,
      verifyMergedCommit: input => verifyProtectedHeadRefreshMergedCommit({
        ...input,
        gitText,
      }),
    }),
    sleep: milliseconds => sleepSeconds(milliseconds / 1_000),
  });
  return Object.freeze({
    schema: "agentic-protected-head-refresh-result/v1",
    ...result,
    operationId: projection.operation_id,
    controllerRevision,
  });

  function readProtectedMainSha() {
    const reference = ghJson([
      "api", "--method", "GET", `repos/${repo}/git/ref/heads/main`,
    ]);
    return requireFullSha(
      reference?.object?.sha,
      "Protected-head refresh protected main ref",
    );
  }

  function fetchProtectedMainRef(expectedMainSha) {
    git([
      "fetch", "--no-tags", "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    if (gitText(["rev-parse", "refs/remotes/origin/main"]).trim() !== expectedMainSha) {
      throw new Error("Protected-head refresh fetched protected main drifted.");
    }
  }

  function fetchProtectedHeadRefreshRefs({ branch, expectedHeadSha, expectedMainSha }) {
    const headRef = `refs/remotes/protected-head-refresh/${projection.operation_id}`;
    git([
      "fetch", "--no-tags", "origin",
      "+refs/heads/main:refs/remotes/origin/main",
      `+refs/heads/${branch}:${headRef}`,
    ]);
    if (gitText(["rev-parse", headRef]).trim() !== expectedHeadSha) {
      throw new Error("Protected-head refresh fetched feature ref drifted.");
    }
    if (gitText(["rev-parse", "refs/remotes/origin/main"]).trim() !== expectedMainSha) {
      throw new Error("Protected-head refresh fetched protected main drifted.");
    }
  }
}

export function requireProtectedHeadRefreshLedgerRepository({
  targetRepository,
  ledgerRepository,
}) {
  requiredText(targetRepository, "Protected-head refresh target repository");
  return requiredText(
    ledgerRepository,
    "Protected-head refresh authenticated ledger repository",
  );
}

export function requireProtectedHeadRefreshMergedAuthorizationRecovery({
  value,
  projection,
  actorId,
  actorLogin,
}) {
  const authorization = String(value || "");
  if (authorization === "") return false;
  if (
    authorization
      !== `recover-absent-merged-authorization:${projection.operation_id}`
    || String(actorId || "")
      !== String(projection.auto_merge_enabled_by_database_id)
    || String(actorLogin || "") !== projection.auto_merge_enabled_by_login
  ) {
    throw new Error(
      "Protected-head refresh absent merged authorization recovery identity drifted.",
    );
  }
  return true;
}

export function verifyProtectedHeadRefreshMergedProviderState(input, {
  readProtectedMainSha,
  fetchProtectedMainRef,
  verifyMergedCommit,
}) {
  for (const [callback, label] of [
    [readProtectedMainSha, "protected-main reader"],
    [fetchProtectedMainRef, "protected-main fetcher"],
    [verifyMergedCommit, "merged-commit verifier"],
  ]) {
    if (typeof callback !== "function") {
      throw new Error(`Protected-head refresh merged provider ${label} is required.`);
    }
  }
  const providerMainSha = readProtectedMainSha();
  fetchProtectedMainRef(providerMainSha);
  return verifyMergedCommit(input);
}

function projectionInput(requiredEnv) {
  const names = {
    operation: "PROTECTED_HEAD_REFRESH_OPERATION",
    pull_request_number: "PROTECTED_HEAD_REFRESH_PULL_REQUEST_NUMBER",
    branch: "PROTECTED_HEAD_REFRESH_BRANCH",
    delivered_head_sha: "PROTECTED_HEAD_REFRESH_DELIVERED_HEAD_SHA",
    observed_head_sha: "PROTECTED_HEAD_REFRESH_OBSERVED_HEAD_SHA",
    target_main_sha: "PROTECTED_HEAD_REFRESH_TARGET_MAIN_SHA",
    canonical_base_sha: "PROTECTED_HEAD_REFRESH_CANONICAL_BASE_SHA",
    claim_id: "PROTECTED_HEAD_REFRESH_CLAIM_ID",
    claim_digest: "PROTECTED_HEAD_REFRESH_CLAIM_DIGEST",
    ledger_revision: "PROTECTED_HEAD_REFRESH_LEDGER_REVISION",
    review_request_id: "PROTECTED_HEAD_REFRESH_REVIEW_REQUEST_ID",
    pull_request_node_id: "PROTECTED_HEAD_REFRESH_PULL_REQUEST_NODE_ID",
    pull_request_title: "PROTECTED_HEAD_REFRESH_PULL_REQUEST_TITLE",
    auto_merge_method: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_METHOD",
    auto_merge_enabled_by_database_id: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_ENABLED_BY_DATABASE_ID",
    auto_merge_enabled_by_node_id: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_ENABLED_BY_NODE_ID",
    auto_merge_enabled_by_login: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_ENABLED_BY_LOGIN",
    auto_merge_enabled_by_type: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_ENABLED_BY_TYPE",
    auto_merge_commit_title: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_COMMIT_TITLE",
    auto_merge_commit_message: "PROTECTED_HEAD_REFRESH_AUTO_MERGE_COMMIT_MESSAGE",
    candidate_auto_merge_commit_title: "PROTECTED_HEAD_REFRESH_CANDIDATE_AUTO_MERGE_COMMIT_TITLE",
    candidate_auto_merge_commit_message: "PROTECTED_HEAD_REFRESH_CANDIDATE_AUTO_MERGE_COMMIT_MESSAGE",
    integration_receipt_digest: "PROTECTED_HEAD_REFRESH_INTEGRATION_RECEIPT_DIGEST",
    transition_counter: "PROTECTED_HEAD_REFRESH_TRANSITION_COUNTER",
    operation_id: "PROTECTED_HEAD_REFRESH_OPERATION_ID",
  };
  return Object.fromEntries(
    Object.entries(names).map(([key, name]) => [key, requiredEnv(name)]),
  );
}

function runCommand(command, args, {
  allowFailure = false,
  environment,
  input,
  timeoutMs = 300_000,
} = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: environment,
    input,
    timeout: timeoutMs,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function requireFullSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git SHA.`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
