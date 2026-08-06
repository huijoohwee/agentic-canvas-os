import { createProtectedHeadRefreshControllerState } from "./protected-head-refresh-controller-state.mjs";
import { SHA_PATTERN } from "./protected-head-refresh-shared.mjs";

export function executeProtectedHeadRefreshController({
  projection,
  readPullRequest,
  verifyRefreshChain,
  verifyCloudAuthority,
  verifyBranchProtection,
  readProtectedMain,
  validateSquashSubject,
  prepareCandidate,
  inspectCandidate,
  verifyCandidateHead,
  pushCandidate,
  verifyCandidateWorkflow,
  verifyCandidateChecksAbsent,
  verifyNoSynchronizeRun,
  reconcileCandidateCi,
  reconcileCloudCheck,
  completeCloudCheck,
  verifyMergedCommit = () => {},
  sleep = () => {},
  maxUnknownPolls = 20,
  maxCandidatePolls = 20,
  maxAuthorizationPolls = 180,
}) {
  if (!projection || !Number.isInteger(projection.pullRequestNumber)) {
    throw new Error("Protected-head refresh requires a normalized projection.");
  }
  for (const [value, label] of [
    [maxUnknownPolls, "UNKNOWN"],
    [maxCandidatePolls, "candidate"],
    [maxAuthorizationPolls, "authorization"],
  ]) {
    if (
      !Number.isInteger(value)
      || value < 1
      || value > (label === "authorization" ? 240 : 20)
    ) {
      throw new Error(`Protected-head refresh ${label} polling bound is invalid.`);
    }
  }
  for (const [callback, label] of [
    [readPullRequest, "pull-request reader"],
    [verifyRefreshChain, "refresh-chain verifier"],
    [verifyCloudAuthority, "cloud-authority verifier"],
    [verifyBranchProtection, "branch-protection verifier"],
    [readProtectedMain, "protected-main reader"],
    [validateSquashSubject, "squash-subject validator"],
    [prepareCandidate, "deterministic candidate builder"],
    [inspectCandidate, "deterministic candidate verifier"],
    [verifyCandidateHead, "published candidate head verifier"],
    [pushCandidate, "exact leased candidate publisher"],
    [verifyCandidateWorkflow, "trusted CI workflow verifier"],
    [verifyCandidateChecksAbsent, "pre-push candidate-check verifier"],
    [verifyNoSynchronizeRun, "synchronize-trigger verifier"],
    [reconcileCandidateCi, "candidate CI reconciler"],
    [reconcileCloudCheck, "owned cloud-check reconciler"],
    [completeCloudCheck, "owned cloud-check completer"],
  ]) {
    if (typeof callback !== "function") {
      throw new Error(`Protected-head refresh ${label} is required.`);
    }
  }

  const {
    finishCandidate,
    hasOriginalUserAuthorization,
    inspectExactCandidate,
    mergedReplay,
    readCloudReceipt,
    readSettled,
    requireTargetMain,
    verifyChain,
  } = createProtectedHeadRefreshControllerState({
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
  });

  const initial = readSettled({ autoMerge: "either" });
  verifyChain(initial);
  if (initial.merged) return mergedReplay(initial);
  verifyCloudAuthority({ projection, pullRequest: initial });

  const current = readSettled({ autoMerge: "either" });
  verifyChain(current);
  if (current.merged) return mergedReplay(current);
  if (current.headSha !== projection.observed_head_sha) {
    const candidate = inspectExactCandidate(current);
    const cloud = readCloudReceipt({ candidateSha: candidate.candidateSha, create: false });
    return finishCandidate({
      pull: current,
      candidate,
      pushed: false,
      existingCloud: cloud,
      allowedOldBaseSha: current.baseSha,
    });
  }
  if (current.autoMergeMethod !== "squash" && current.autoMergeMethod !== null) {
    throw new Error("Protected-head refresh original head has an unsupported auto-merge state.");
  }
  if (current.autoMergeMethod === null) {
    return Object.freeze({
      status: "original-authorization-revoked",
      pullRequestNumber: projection.pullRequestNumber,
      headSha: current.headSha,
      mutated: false,
    });
  }
  if (!hasOriginalUserAuthorization(current)) {
    throw new Error("Protected-head refresh original human authorization drifted.");
  }
  if (current.mergeState === "dirty") {
    throw new Error("Protected pull request has conflicts; deterministic refresh is forbidden.");
  }
  if (current.mergeState !== "behind") {
    return Object.freeze({
      status: "not-behind",
      pullRequestNumber: projection.pullRequestNumber,
      headSha: current.headSha,
      mergeState: current.mergeState,
      mutated: false,
    });
  }

  // Refresh the live claim immediately before the provider identity fence. A
  // claim retired or replaced after the first proof must never reach mutation.
  verifyCloudAuthority({ projection, pullRequest: current });
  requireTargetMain();
  const beforePush = readSettled({ autoMerge: "either" });
  if (
    beforePush.headSha !== projection.observed_head_sha
    || beforePush.title !== current.title
    || beforePush.mergeState !== "behind"
    || !hasOriginalUserAuthorization(beforePush)
  ) {
    throw new Error("Protected-head refresh metadata drifted before candidate publication.");
  }
  const squashSubject = validateSquashSubject(beforePush.title);
  const candidate = prepareCandidate({
    observedHeadSha: projection.observed_head_sha,
    targetMainSha: projection.target_main_sha,
    operationId: projection.operation_id,
  });
  if (!candidate || !SHA_PATTERN.test(String(candidate.candidateSha || ""))) {
    throw new Error("Protected-head refresh candidate builder returned no exact commit.");
  }
  const prepared = inspectCandidate({
    candidateSha: candidate.candidateSha,
    observedHeadSha: projection.observed_head_sha,
    targetMainSha: projection.target_main_sha,
    operationId: projection.operation_id,
  });
  if (!prepared || prepared.candidateSha !== candidate.candidateSha) {
    throw new Error("Protected-head refresh candidate bytes were not deterministic.");
  }
  verifyCandidateWorkflow({
    candidateSha: candidate.candidateSha,
    targetMainSha: projection.target_main_sha,
    projection,
  });
  const casBound = readSettled({ autoMerge: "either" });
  if (
    casBound.headSha !== projection.observed_head_sha
    || casBound.title !== beforePush.title
    || casBound.mergeState !== "behind"
    || ![beforePush.baseSha, projection.target_main_sha].includes(casBound.baseSha)
    || !hasOriginalUserAuthorization(casBound)
  ) {
    throw new Error("Protected-head refresh metadata drifted at the final branch CAS fence.");
  }
  verifyCloudAuthority({ projection, pullRequest: casBound });
  requireTargetMain();
  verifyBranchProtection({ projection, candidateSha: candidate.candidateSha });
  verifyCandidateChecksAbsent({ projection, candidateSha: candidate.candidateSha });
  const publishBaseSha = casBound.baseSha;
  let pushError = null;
  try {
    pushCandidate({
      branch: projection.branch,
      observedHeadSha: projection.observed_head_sha,
      candidateSha: candidate.candidateSha,
    });
  } catch (error) {
    pushError = error;
  }
  let published = null;
  for (let attempt = 0; attempt < maxCandidatePolls; attempt += 1) {
    const observed = readSettled({ autoMerge: "either" });
    if (observed.merged) return mergedReplay(observed);
    if (observed.headSha === candidate.candidateSha) {
      if (observed.title !== beforePush.title) {
        throw new Error("Protected-head refresh provider title drifted after candidate push.");
      }
      inspectExactCandidate(observed);
      published = observed;
      break;
    }
    if (observed.headSha !== projection.observed_head_sha) {
      throw new Error("Protected-head refresh branch advanced to an unauthorized head after push.");
    }
    if (attempt + 1 < maxCandidatePolls) sleep(1_000);
  }
  if (!published) {
    throw pushError || new Error(
      "Protected-head refresh candidate and target base were not observable within the bound.",
    );
  }
  if (
    published.title !== beforePush.title
    || published.title !== squashSubject
  ) {
    throw new Error("Protected-head refresh provider metadata drifted after candidate push.");
  }
  const verifiedCandidate = inspectExactCandidate(published);
  if (verifiedCandidate.candidateSha !== candidate.candidateSha) {
    throw new Error("Protected-head refresh published candidate differs from deterministic bytes.");
  }
  return finishCandidate({
    pull: published,
    candidate: verifiedCandidate,
    pushed: true,
    allowedOldBaseSha: publishBaseSha,
  });
}
