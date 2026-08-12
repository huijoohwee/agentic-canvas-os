import { protectedMainRefreshHeads } from "./protected-main-refresh-candidate.mjs";
import { requireProtectedHeadRefreshPullRequest } from "./protected-head-refresh-pull-request.mjs";

export function createProtectedHeadRefreshControllerState({
  projection,
  readPullRequest,
  verifyRefreshChain,
  verifyCloudAuthority,
  verifyBranchProtection,
  readProtectedMain,
  inspectCandidate,
  verifyCandidateHead,
  verifyCandidateWorkflow,
  verifyNoSynchronizeRun,
  reconcileCandidateCi,
  reconcileCloudCheck,
  completeCloudCheck,
  verifyMergedCommit,
  sleep,
  maxUnknownPolls,
  maxCandidatePolls,
  maxAuthorizationPolls,
}) {
  const readSettled = ({ autoMerge = "either" } = {}) => {
    for (let attempt = 0; attempt < maxUnknownPolls; attempt += 1) {
      const pull = requireProtectedHeadRefreshPullRequest({
        pullRequest: readPullRequest(),
        projection,
        autoMerge,
      });
      if (pull.merged || pull.mergeState !== "unknown") return pull;
      if (attempt + 1 < maxUnknownPolls) sleep(1_000);
    }
    throw new Error(
      `Protected pull request #${projection.pullRequestNumber} merge state remained UNKNOWN.`,
    );
  };
  const verifyChain = pull => {
    const receipt = verifyRefreshChain({
      deliveredHeadSha: projection.delivered_head_sha,
      currentHeadSha: pull.headSha,
      pullRequestNumber: projection.pullRequestNumber,
    });
    const heads = receipt
      ? protectedMainRefreshHeads(receipt)
      : [projection.delivered_head_sha];
    if (
      heads[0] !== projection.delivered_head_sha
      || heads.at(-1) !== pull.headSha
      || !heads.includes(projection.observed_head_sha)
    ) {
      throw new Error(
        "Protected pull-request head is not the exact delivered/observed protected-main refresh chain.",
      );
    }
    return receipt;
  };
  const requireTargetMain = () => {
    const observed = readProtectedMain();
    if (observed !== projection.target_main_sha) {
      throw new Error(
        `Protected main changed from target ${projection.target_main_sha} to ${observed || "unknown"}.`,
      );
    }
    return observed;
  };
  const replayMerged = (pull, { completedCloud = null } = {}) => {
    verifyChain(pull);
    verifyMergedCommit({
      mergeCommitSha: pull.mergeCommitSha,
      candidateSha: pull.headSha,
      targetMainSha: projection.target_main_sha,
      commitTitle: pull.headSha === projection.delivered_head_sha
        ? projection.auto_merge_commit_title
        : projection.candidate_auto_merge_commit_title,
      commitMessageJson: pull.headSha === projection.delivered_head_sha
        ? projection.auto_merge_commit_message
        : projection.candidate_auto_merge_commit_message,
    });
    let cloudCheckRunIds;
    let mutated = completedCloud !== null;
    if (pull.headSha !== projection.delivered_head_sha) {
      if (pull.baseSha !== projection.target_main_sha) {
        throw new Error("Protected-head refresh merged candidate base drifted from target main.");
      }
      const candidate = inspectCandidate({
        candidateSha: pull.headSha,
        observedHeadSha: projection.observed_head_sha,
        targetMainSha: projection.target_main_sha,
        operationId: projection.operation_id,
      });
      if (!candidate || candidate.candidateSha !== pull.headSha) {
        throw new Error(
          "Protected-head refresh merged head is not the deterministic operation candidate.",
        );
      }
      let cloud = readCloudReceipt({ candidateSha: pull.headSha, create: false });
      if (cloud.status === "absent" && completedCloud !== null) {
        const carried = requireCloudReceipt(completedCloud);
        if (carried.status !== "complete") {
          throw new Error(
            "Protected-head refresh carried cloud completion is not terminal success.",
          );
        }
        cloud = carried;
      }
      const verifyRecoveryEvidence = confirmed => {
        verifyCandidateWorkflow({
          candidateSha: candidate.candidateSha,
          targetMainSha: projection.target_main_sha,
          projection,
        });
        const ci = requireCiReceipt(reconcileCandidateCi({
          projection,
          candidateSha: candidate.candidateSha,
          pullRequest: confirmed,
        }));
        verifyBranchProtection({ projection, candidateSha: candidate.candidateSha });
        verifyNoSynchronizeRun({ projection, candidateSha: candidate.candidateSha });
        verifyCloudAuthority({ projection, pullRequest: confirmed });
        return ci;
      };
      if (
        cloud.status === "absent"
        && projection.allowAbsentMergedAuthorizationRecovery === true
      ) {
        verifyRecoveryEvidence(pull);
        cloud = requireCloudReceipt(readCloudReceipt({
          candidateSha: candidate.candidateSha,
          create: true,
        }));
        if (cloud.status !== "pending") {
          throw new Error(
            "Protected-head refresh absent merged authorization gate was not created exactly.",
          );
        }
        mutated = true;
      }
      if (cloud.status === "pending") {
        let ci = verifyRecoveryEvidence(pull);

        const confirmed = readSettled({ autoMerge: "armed" });
        if (
          !confirmed.merged
          || !sameProviderIdentity(confirmed, pull)
          || confirmed.mergeCommitSha !== pull.mergeCommitSha
        ) {
          throw new Error(
            "Protected-head refresh merged candidate identity drifted before authorization recovery.",
          );
        }
        verifyMergedCommit({
          mergeCommitSha: confirmed.mergeCommitSha,
          candidateSha: confirmed.headSha,
          targetMainSha: projection.target_main_sha,
          commitTitle: projection.candidate_auto_merge_commit_title,
          commitMessageJson: projection.candidate_auto_merge_commit_message,
        });
        ci = verifyRecoveryEvidence(confirmed);
        const pending = readCloudReceipt({ candidateSha: pull.headSha, create: false });
        if (
          pending.status !== "pending"
          || pending.checkRunIds.join(",") !== cloud.checkRunIds.join(",")
        ) {
          throw new Error(
            "Protected-head refresh merged pending gate drifted before authorization recovery.",
          );
        }
        cloud = requireCloudReceipt(completeCloudCheck({
          projection,
          candidateSha: candidate.candidateSha,
          cloudCheck: pending,
          ci,
        }));
        if (
          cloud.status !== "complete"
          || cloud.checkRunIds.join(",") !== pending.checkRunIds.join(",")
        ) {
          throw new Error(
            "Protected-head refresh merged owned cloud checks did not complete exactly.",
          );
        }
        mutated = true;
      }
      if (cloud.status !== "complete") {
        throw new Error(
          "Protected-head refresh candidate merged without complete owned authorization evidence.",
        );
      }
      cloudCheckRunIds = cloud.checkRunIds;
    }
    return Object.freeze({
      status: "merged-replay",
      pullRequestNumber: projection.pullRequestNumber,
      headSha: pull.headSha,
      mergeCommitSha: pull.mergeCommitSha,
      ...(cloudCheckRunIds ? { cloudCheckRunIds } : {}),
      mutated,
    });
  };
  // Keep the carried-receipt capability private to finishCandidate. Public
  // replay must always re-observe durable provider evidence.
  const mergedReplay = pull => replayMerged(pull);
  const inspectExactCandidate = pull => {
    const candidate = inspectCandidate({
      candidateSha: pull.headSha,
      observedHeadSha: projection.observed_head_sha,
      targetMainSha: projection.target_main_sha,
      operationId: projection.operation_id,
    });
    if (!candidate || candidate.candidateSha !== pull.headSha) {
      throw new Error("Protected-head refresh head is not the deterministic operation candidate.");
    }
    verifyChain(pull);
    return candidate;
  };
  const requireCandidate = pull => {
    if (pull.baseSha !== projection.target_main_sha) {
      throw new Error(
        "Protected-head refresh candidate base did not converge to the exact target main.",
      );
    }
    return inspectExactCandidate(pull);
  };
  const sameProviderIdentity = (left, right) => (
    left.headSha === right.headSha
    && left.baseSha === right.baseSha
    && left.title === right.title
  );
  const hasProjectedUserAuthorization = pull => (
    pull.autoMergeMethod === projection.auto_merge_method
    && pull.autoMergeAuthorization === "candidate"
  );
  const hasOriginalUserAuthorization = pull => (
    pull.autoMergeMethod === projection.auto_merge_method
    && pull.autoMergeAuthorization === "original"
  );
  const requireCiReceipt = ci => {
    if (
      !Number.isSafeInteger(ci?.workflowRunId)
      || ci.workflowRunId <= 0
      || !Number.isSafeInteger(ci?.checkSuiteId)
      || ci.checkSuiteId <= 0
    ) {
      throw new Error(
        "Protected-head refresh CI reconciliation returned no exact workflow run and check suite.",
      );
    }
    return ci;
  };
  const requireCloudReceipt = (receipt, { allowAbsent = false } = {}) => {
    const expectedExternalId = `agentic-protected-head-refresh:${projection.operation_id}`;
    const status = receipt?.status;
    const checkRunIds = receipt?.checkRunIds;
    if (
      !["absent", "pending", "complete"].includes(status)
      || receipt?.externalId !== expectedExternalId
      || !Array.isArray(checkRunIds)
      || checkRunIds.some((id, index) => (
        !Number.isSafeInteger(id)
        || id <= 0
        || (index > 0 && id <= checkRunIds[index - 1])
      ))
      || (status === "absent" && checkRunIds.length !== 0)
      || (status !== "absent" && checkRunIds.length !== 1)
      || (!allowAbsent && status === "absent")
    ) {
      throw new Error("Protected-head refresh owned cloud-check receipt is not exact.");
    }
    return receipt;
  };
  const readCloudReceipt = ({ candidateSha, create }) => requireCloudReceipt(
    reconcileCloudCheck({
      projection,
      candidateSha,
      create,
    }),
    { allowAbsent: !create },
  );
  const settleCandidateBase = ({ pull, candidateSha, allowedOldBaseSha, expectedTitle }) => {
    let observed = pull;
    for (let attempt = 0; attempt < maxCandidatePolls; attempt += 1) {
      if (observed.merged) return observed;
      if (
        observed.headSha !== candidateSha
        || observed.title !== expectedTitle
      ) {
        throw new Error("Protected-head refresh candidate identity drifted while base converged.");
      }
      if (observed.baseSha === projection.target_main_sha) return observed;
      if (observed.baseSha !== allowedOldBaseSha) {
        throw new Error("Protected-head refresh provider base drifted after candidate push.");
      }
      requireTargetMain();
      if (attempt + 1 < maxCandidatePolls) {
        sleep(1_000);
        observed = readSettled({ autoMerge: "either" });
      }
    }
    throw new Error(
      "Protected-head refresh candidate base did not converge to target main within the bound.",
    );
  };
  const authorizationCompleteReplay = ({ pull, candidate, cloud }) => {
    if (pull.autoMergeMethod === null) {
      return Object.freeze({
        status: "authorization-complete-disabled",
        pullRequestNumber: projection.pullRequestNumber,
        headSha: candidate.candidateSha,
        cloudCheckRunIds: cloud.checkRunIds,
        mutated: false,
      });
    }
    if (!hasProjectedUserAuthorization(pull)) {
      throw new Error(
        "Completed protected-head refresh authorization lacks the exact candidate user request.",
      );
    }
    for (let attempt = 0; attempt < maxCandidatePolls; attempt += 1) {
      const observed = attempt === 0
        ? pull
        : readSettled({ autoMerge: "either" });
      if (observed.merged) {
        return Object.freeze({
          ...mergedReplay(observed),
          cloudCheckRunIds: cloud.checkRunIds,
        });
      }
      if (
        observed.headSha !== candidate.candidateSha
        || observed.title !== pull.title
        || observed.baseSha !== projection.target_main_sha
        || !hasProjectedUserAuthorization(observed)
      ) {
        throw new Error("Completed protected-head refresh authorization identity drifted.");
      }
      requireTargetMain();
      if (attempt + 1 < maxCandidatePolls) sleep(1_000);
    }
    return Object.freeze({
      status: "authorization-complete-armed",
      pullRequestNumber: projection.pullRequestNumber,
      headSha: candidate.candidateSha,
      cloudCheckRunIds: cloud.checkRunIds,
      mutated: false,
    });
  };
  const finishCandidate = ({
    pull,
    candidate,
    pushed,
    existingCloud,
    allowedOldBaseSha = pull.baseSha,
  }) => {
    const inspected = inspectExactCandidate(pull);
    if (inspected.candidateSha !== candidate.candidateSha) {
      throw new Error("Protected-head refresh candidate identity changed before state admission.");
    }
    // Missing strict required context blocks the just-published candidate.
    // Only the exact carried original request may create the pending gate;
    // disabled or already-rearmed candidates require explicit user recovery.
    let admittedPull = pull;
    let cloud = existingCloud
      || readCloudReceipt({ candidateSha: candidate.candidateSha, create: false });
    if (cloud.status === "complete") {
      if (pull.baseSha !== projection.target_main_sha) {
        throw new Error("Completed protected-head refresh authorization has a stale base.");
      }
      requireCandidate(pull);
      return authorizationCompleteReplay({ pull, candidate, cloud });
    }
    if (cloud.status === "absent") {
      if (!hasOriginalUserAuthorization(pull)) {
        throw new Error(
          "Protected-head refresh candidate lacks its pending gate and exact carried original authorization.",
        );
      }
      const preGateSettled = settleCandidateBase({
        pull,
        candidateSha: candidate.candidateSha,
        allowedOldBaseSha,
        expectedTitle: pull.title,
      });
      if (preGateSettled.merged) return mergedReplay(preGateSettled);
      requireCandidate(preGateSettled);
      const blockedWithoutGate = readSettled({ autoMerge: "either" });
      if (
        !sameProviderIdentity(blockedWithoutGate, preGateSettled)
        || blockedWithoutGate.mergeState !== "blocked"
        || !hasOriginalUserAuthorization(blockedWithoutGate)
      ) {
        throw new Error(
          "Protected-head refresh candidate is not exactly BLOCKED by the absent strict context.",
        );
      }
      requireTargetMain();
      cloud = readCloudReceipt({ candidateSha: candidate.candidateSha, create: true });
      admittedPull = blockedWithoutGate;
    }
    if (cloud.status !== "pending") {
      throw new Error("Protected-head refresh owned cloud gate is not pending.");
    }
    const settled = settleCandidateBase({
      pull: admittedPull,
      candidateSha: candidate.candidateSha,
      allowedOldBaseSha,
      expectedTitle: pull.title,
    });
    if (settled.merged) return mergedReplay(settled);
    requireCandidate(settled);
    const gated = readSettled({ autoMerge: "either" });
    if (gated.merged) return mergedReplay(gated);
    if (!sameProviderIdentity(gated, settled) || gated.mergeState !== "blocked") {
      throw new Error("Protected-head refresh candidate is not exactly BLOCKED by its owned gate.");
    }

    requireTargetMain();
    verifyCandidateWorkflow({
      candidateSha: candidate.candidateSha,
      targetMainSha: projection.target_main_sha,
      projection,
    });
    verifyBranchProtection({ projection, candidateSha: candidate.candidateSha });
    verifyNoSynchronizeRun({ projection, candidateSha: candidate.candidateSha });
    verifyCloudAuthority({ projection, pullRequest: gated });

    let ci = requireCiReceipt(reconcileCandidateCi({
      projection,
      candidateSha: candidate.candidateSha,
      pullRequest: gated,
    }));

    let armed = null;
    for (let attempt = 0; attempt < maxAuthorizationPolls; attempt += 1) {
      const observed = readSettled({ autoMerge: "either" });
      if (observed.merged) {
        throw new Error("Protected-head refresh merged while its owned cloud check was pending.");
      }
      if (!sameProviderIdentity(observed, settled) || observed.mergeState !== "blocked") {
        throw new Error("Protected-head refresh candidate drifted while awaiting user authorization.");
      }
      if (observed.autoMergeMethod === null) {
        if (attempt + 1 < maxAuthorizationPolls) sleep(5_000);
        continue;
      }
      if (hasOriginalUserAuthorization(observed)) {
        if (attempt + 1 < maxAuthorizationPolls) sleep(5_000);
        continue;
      }
      if (!hasProjectedUserAuthorization(observed)) {
        throw new Error("Protected-head refresh candidate authorization identity drifted.");
      }
      armed = observed;
      break;
    }
    if (!armed) {
      throw new Error(
        "Protected-head refresh exact candidate user re-authorization did not arrive; owned gate stays pending.",
      );
    }
    requireCandidate(armed);

    // Long-running CI can race main, claim, ruleset, PR, or check-suite drift.
    // Reprove all of them immediately before success commits authorization.
    requireTargetMain();
    ci = requireCiReceipt(reconcileCandidateCi({
      projection,
      candidateSha: candidate.candidateSha,
      pullRequest: armed,
    }));
    verifyBranchProtection({ projection, candidateSha: candidate.candidateSha });
    verifyNoSynchronizeRun({ projection, candidateSha: candidate.candidateSha });
    verifyCloudAuthority({ projection, pullRequest: armed });
    const final = readSettled({ autoMerge: "armed" });
    if (final.merged) {
      throw new Error("Protected-head refresh merged before final authorization proof.");
    }
    if (
      !sameProviderIdentity(final, armed)
      || final.mergeState !== "blocked"
      || !hasProjectedUserAuthorization(final)
    ) {
      throw new Error("Protected-head refresh preserved user authorization drifted.");
    }
    requireCandidate(final);
    verifyCandidateHead({
      branch: projection.branch,
      candidateSha: candidate.candidateSha,
      targetMainSha: projection.target_main_sha,
    });
    requireTargetMain();
    const pending = readCloudReceipt({ candidateSha: candidate.candidateSha, create: false });
    if (
      pending.status !== "pending"
      || pending.checkRunIds.join(",") !== cloud.checkRunIds.join(",")
    ) {
      throw new Error("Protected-head refresh owned pending gate drifted before authorization.");
    }
    cloud = requireCloudReceipt(completeCloudCheck({
      projection,
      candidateSha: candidate.candidateSha,
      cloudCheck: pending,
      ci,
    }));
    if (
      cloud.status !== "complete"
      || cloud.checkRunIds.join(",") !== pending.checkRunIds.join(",")
    ) {
      throw new Error("Protected-head refresh owned cloud checks did not complete exactly.");
    }

    let afterAuthorization;
    for (let attempt = 0; attempt < maxCandidatePolls; attempt += 1) {
      afterAuthorization = readSettled({ autoMerge: "either" });
      if (afterAuthorization.merged) {
        return Object.freeze({
          ...replayMerged(afterAuthorization, { completedCloud: cloud }),
          workflowRunId: ci.workflowRunId,
          checkSuiteId: ci.checkSuiteId,
          cloudCheckRunIds: cloud.checkRunIds,
        });
      }
      if (!sameProviderIdentity(afterAuthorization, final)) {
        throw new Error("Protected-head refresh provider identity drifted after authorization.");
      }
      if (afterAuthorization.autoMergeMethod === null) break;
      if (!hasProjectedUserAuthorization(afterAuthorization)) {
        throw new Error("Protected-head refresh provider identity drifted after authorization.");
      }
      if (attempt + 1 < maxCandidatePolls) sleep(1_000);
    }
    return Object.freeze({
      status: afterAuthorization.autoMergeMethod === null
        ? "authorization-complete-disabled"
        : (pushed ? "candidate-published" : "candidate-replay"),
      pullRequestNumber: projection.pullRequestNumber,
      headSha: candidate.candidateSha,
      targetMainSha: projection.target_main_sha,
      workflowRunId: ci.workflowRunId,
      checkSuiteId: ci.checkSuiteId,
      cloudCheckRunIds: cloud.checkRunIds,
      mutated: true,
    });
  };

  return Object.freeze({
    finishCandidate,
    hasOriginalUserAuthorization,
    inspectExactCandidate,
    mergedReplay,
    readCloudReceipt,
    readSettled,
    requireTargetMain,
    verifyChain,
  });
}
