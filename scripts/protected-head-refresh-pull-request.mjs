import {
  OPEN_MERGE_STATES,
  requireCanonicalPositiveInteger,
  requireDigest,
  requireExactText,
  requireSha,
} from "./protected-head-refresh-shared.mjs";

export function requireProtectedHeadRefreshPullRequest({
  pullRequest,
  projection,
  autoMerge = "either",
}) {
  if (!pullRequest || typeof pullRequest !== "object" || Array.isArray(pullRequest)) {
    throw new Error("Protected-head refresh received no pull-request projection.");
  }
  const number = Number(pullRequest.number);
  const state = String(pullRequest.state || "").toLowerCase();
  const merged = pullRequest.merged === true || Boolean(pullRequest.merged_at);
  if (number !== projection.pullRequestNumber) {
    throw new Error("Protected-head refresh pull-request number drifted.");
  }
  const expectedUrl = `https://github.com/${projection.repository}/pull/${number}`;
  if (pullRequest.html_url !== expectedUrl) {
    throw new Error("Protected-head refresh pull-request URL drifted.");
  }
  if (!(
    (state === "open" && !merged)
    || (state === "closed" && merged)
  )) {
    throw new Error("Protected-head refresh requires an OPEN or exactly MERGED pull request.");
  }
  if (pullRequest.draft !== false) {
    throw new Error("Protected-head refresh refuses draft pull requests.");
  }
  if (
    pullRequest.base?.ref !== "main"
    || pullRequest.base?.repo?.full_name !== projection.repository
  ) {
    throw new Error("Protected-head refresh requires the same repository protected main base.");
  }
  requireSha(pullRequest.base?.sha, "Protected-head refresh observed base");
  if (
    pullRequest.head?.ref !== projection.branch
    || pullRequest.head?.repo?.full_name !== projection.repository
  ) {
    throw new Error("Protected-head refresh requires the exact same-repository head branch.");
  }
  const headSha = requireSha(pullRequest.head?.sha, "Protected-head refresh observed PR head");
  const nodeId = requireExactText(pullRequest.node_id, "Protected-head refresh PR node ID");
  const title = requireExactText(pullRequest.title, "Protected-head refresh PR title");
  if (
    `github-pull-request:${nodeId}` !== projection.review_request_id
    || nodeId !== projection.pull_request_node_id
    || title !== projection.pull_request_title
  ) {
    throw new Error("Protected-head refresh pull request identity drifted.");
  }
  const autoMergeMethod = pullRequest.auto_merge === null
    ? null
    : String(pullRequest.auto_merge?.merge_method || "").toLowerCase();
  const autoMergeEnabledByDatabaseId = autoMergeMethod === null
    ? null
    : requireCanonicalPositiveInteger(
      pullRequest.auto_merge?.enabled_by?.id,
      "Protected-head refresh auto-merge actor database ID",
    );
  const autoMergeEnabledByNodeId = autoMergeMethod === null
    ? null
    : requireExactText(
      pullRequest.auto_merge?.enabled_by?.node_id,
      "Protected-head refresh auto-merge actor node ID",
    );
  const autoMergeEnabledByLogin = autoMergeMethod === null
    ? null
    : requireExactText(
      pullRequest.auto_merge?.enabled_by?.login,
      "Protected-head refresh auto-merge actor login",
    );
  const autoMergeEnabledByType = autoMergeMethod === null
    ? null
    : requireExactText(
      pullRequest.auto_merge?.enabled_by?.type,
      "Protected-head refresh auto-merge actor type",
    );
  const autoMergeCommitTitle = autoMergeMethod === null
    ? null
    : requireExactText(
      pullRequest.auto_merge?.commit_title,
      "Protected-head refresh auto-merge commit title",
    );
  const autoMergeCommitMessage = autoMergeMethod === null
    ? null
    : JSON.stringify(pullRequest.auto_merge?.commit_message ?? null);
  if (autoMergeMethod !== null && autoMergeMethod !== "squash") {
    throw new Error("Protected-head refresh refuses non-SQUASH auto-merge.");
  }
  const actorMatches = autoMergeMethod === "squash"
    && autoMergeEnabledByDatabaseId === projection.auto_merge_enabled_by_database_id
    && autoMergeEnabledByNodeId === projection.auto_merge_enabled_by_node_id
    && autoMergeEnabledByLogin === projection.auto_merge_enabled_by_login
    && autoMergeEnabledByType === projection.auto_merge_enabled_by_type;
  const originalAuthorizationMatches = actorMatches
    && autoMergeCommitTitle === projection.auto_merge_commit_title
    && autoMergeCommitMessage === projection.auto_merge_commit_message;
  const candidateAuthorizationMatches = actorMatches
    && autoMergeCommitTitle === projection.candidate_auto_merge_commit_title
    && autoMergeCommitMessage === projection.candidate_auto_merge_commit_message;
  const candidateHead = headSha !== projection.observed_head_sha;
  if (
    autoMergeMethod === "squash"
    && !(originalAuthorizationMatches || (candidateHead && candidateAuthorizationMatches))
  ) {
    throw new Error("Protected-head refresh auto-merge authorization identity drifted.");
  }
  if (
    merged
    && (
      autoMergeMethod !== "squash"
      || (candidateHead
        ? !candidateAuthorizationMatches
        : !originalAuthorizationMatches)
    )
  ) {
    throw new Error(
      "Protected-head refresh merged replay lacks its exact retained SQUASH authorization.",
    );
  }
  if (!merged && autoMerge === "armed" && autoMergeMethod !== "squash") {
    throw new Error("Protected-head refresh requires exact armed SQUASH auto-merge.");
  }
  if (!merged && autoMerge === "disabled" && autoMergeMethod !== null) {
    throw new Error("Protected-head refresh requires auto-merge to remain disabled.");
  }
  if (!new Set(["armed", "disabled", "either"]).has(autoMerge)) {
    throw new Error("Protected-head refresh auto-merge expectation is invalid.");
  }
  const mergeState = merged
    ? "merged"
    : String(pullRequest.mergeable_state || "unknown").toLowerCase();
  if (!merged && !OPEN_MERGE_STATES.has(mergeState)) {
    throw new Error(`Protected-head refresh received unsupported merge state ${mergeState || "empty"}.`);
  }
  const mergeCommitSha = merged
    ? requireSha(pullRequest.merge_commit_sha, "Protected-head refresh merge commit")
    : null;
  if (merged) {
    const mergedBy = pullRequest.merged_by;
    if (
      requireCanonicalPositiveInteger(
        mergedBy?.id,
        "Protected-head refresh merged-by database ID",
      ) !== projection.auto_merge_enabled_by_database_id
      || requireExactText(
        mergedBy?.node_id,
        "Protected-head refresh merged-by node ID",
      ) !== projection.auto_merge_enabled_by_node_id
      || requireExactText(
        mergedBy?.login,
        "Protected-head refresh merged-by login",
      ) !== projection.auto_merge_enabled_by_login
      || requireExactText(
        mergedBy?.type,
        "Protected-head refresh merged-by type",
      ) !== projection.auto_merge_enabled_by_type
    ) {
      throw new Error("Protected-head refresh merged attribution drifted from the bound user.");
    }
  }
  return Object.freeze({
    number,
    state,
    merged,
    nodeId,
    title,
    headSha,
    baseSha: pullRequest.base.sha,
    autoMergeMethod,
    autoMergeEnabledByDatabaseId,
    autoMergeEnabledByNodeId,
    autoMergeEnabledByLogin,
    autoMergeEnabledByType,
    autoMergeCommitTitle,
    autoMergeCommitMessage,
    autoMergeAuthorization: autoMergeMethod === null
      ? null
      : (candidateAuthorizationMatches ? "candidate" : "original"),
    mergeState,
    mergeCommitSha,
  });
}

export function requireProtectedHeadRefreshCloudResult({
  result,
  projection,
  currentHeadSha,
}) {
  if (
    !result
    || typeof result !== "object"
    || Array.isArray(result)
    || result.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "verify"
    || result.status !== "ready"
    || !Array.isArray(result.findings)
    || result.findings.length !== 0
  ) {
    throw new Error("Protected-head refresh cloud verification was not exactly ready.");
  }
  // The verifier proves projection.ledger_revision is an ancestor containing
  // the same claim fence. Unrelated ledger appends may advance the live head.
  requireSha(result.ledgerRevision, "Protected-head refresh live ledger revision");
  const claim = result.claim;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("Protected-head refresh cloud verification returned no claim.");
  }
  const state = String(claim.state || claim.status || "").replaceAll("-", "_");
  const recoveredFence = result.claimDigest !== projection.claim_digest;
  if (
    state !== "integrated_preserved"
    || claim.claimId !== projection.claim_id
    || claim.canonicalBaseRevision !== projection.canonical_base_sha
    || claim.laneRevision !== projection.delivered_head_sha
    || claim.reviewRequestId !== projection.review_request_id
    || claim.integrationReceiptDigest !== projection.integration_receipt_digest
    || (recoveredFence
      ? !isExactProtectedRefreshRecovery({ result, claim, projection, currentHeadSha })
      : claim.transitionCounter !== projection.transition_counter)
  ) {
    throw new Error("Protected-head refresh cloud claim drifted from delivery authority.");
  }
  const subject = result.subject;
  if (
    !subject
    || subject.repository !== projection.repository
    || Number(subject.pullRequestNumber) !== projection.pullRequestNumber
    || subject.branch !== projection.branch
    || subject.headSha !== currentHeadSha
  ) {
    throw new Error("Protected-head refresh cloud pull-request subject drifted.");
  }
  return result;
}

function isExactProtectedRefreshRecovery({ result, claim, projection, currentHeadSha }) {
  const recovery = claim.recovery;
  if (
    currentHeadSha === projection.observed_head_sha
    || claim.transitionCounter !== projection.transition_counter + 1
    || claim.fenceRevision !== result.claimDigest
    || !recovery
    || typeof recovery !== "object"
    || Array.isArray(recovery)
  ) {
    return false;
  }
  try {
    requireDigest(result.claimDigest, "Protected-head refresh recovered cloud fence");
    requireDigest(recovery.evidenceDigest, "Protected-head refresh recovery evidence");
    const recoveredAt = String(recovery.recoveredAt || "");
    return new Date(recoveredAt).toISOString() === recoveredAt;
  } catch {
    return false;
  }
}
