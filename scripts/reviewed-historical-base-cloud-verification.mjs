// Responsibility: Prove a reviewed historical base remains safe against the current protected base.
import { execFileSync, spawnSync } from "node:child_process";

import { proveLegacyReviewCanonicalDescendant }
  from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";

export function captureReviewedHistoricalBaseProof({
  claim,
  pullRequestNumber,
  observedHeadSha,
  observedBaseSha,
  reviewRequestId,
  gitText = args => execFileSync("git", args, { encoding: "utf8" }).trim(),
  gitExitCode = args => spawnSync("git", args, { stdio: "ignore" }).status,
  run = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
} = {}) {
  requireReviewedSubject({ claim, observedHeadSha, observedBaseSha, reviewRequestId });
  const mainRef = "refs/remotes/origin/main";
  const pullRef = `refs/remotes/pull/${positiveInteger(pullRequestNumber, "pull request")}/head`;
  fetchVerificationRefs({ pullRequestNumber, run });
  requireExactFetchedRef({ gitText, ref: mainRef, expected: observedBaseSha, label: "protected base" });
  requireExactFetchedRef({ gitText, ref: pullRef, expected: observedHeadSha, label: "pull request head" });

  if (!sourceIsAncestor({ claim, observedBaseSha, gitExitCode })) {
    const shallow = gitText(["rev-parse", "--is-shallow-repository"]) === "true";
    if (!shallow) throw new Error("Reviewed historical base is not an ancestor of the protected base.");
    run(["fetch", "--no-tags", "--unshallow", "origin"]);
    if (!sourceIsAncestor({ claim, observedBaseSha, gitExitCode })) {
      throw new Error("Reviewed historical base is not an ancestor of the protected base.");
    }
  }

  const canonicalChangedPaths = gitText([
    "diff", "--name-only", "--no-renames", "-z",
    claim.canonicalBaseRevision, observedBaseSha, "--",
  ]).split("\0").filter(Boolean);
  const preservedChangedPaths = claim.declaredWriteScope
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length));
  return proveLegacyReviewCanonicalDescendant({
    sourceBaseSha: claim.canonicalBaseRevision,
    targetBaseSha: observedBaseSha,
    protectedMainSha: observedBaseSha,
    canonicalChangedPaths,
    preservedChangedPaths,
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
}

function requireReviewedSubject({ claim, observedHeadSha, observedBaseSha, reviewRequestId }) {
  if (!claim || claim.state !== "reviewed") {
    throw new Error("Historical-base verification requires one reviewed claim.");
  }
  if (claim.reviewRequestId !== reviewRequestId || claim.laneRevision !== observedHeadSha) {
    throw new Error("Reviewed claim does not match the exact pull request subject.");
  }
  if (claim.canonicalBaseRevision === observedBaseSha) {
    throw new Error("Historical-base verification requires a strict protected descendant.");
  }
  if (!Array.isArray(claim.declaredWriteScope)) {
    throw new Error("Reviewed claim declared write scope is unavailable.");
  }
}

function fetchVerificationRefs({ pullRequestNumber, run }) {
  run([
    "fetch", "--no-tags", "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    `+refs/pull/${pullRequestNumber}/head:refs/remotes/pull/${pullRequestNumber}/head`,
  ]);
}

function requireExactFetchedRef({ gitText, ref, expected, label }) {
  if (gitText(["rev-parse", ref]) !== expected) {
    throw new Error(`Fetched ${label} does not match the trusted event.`);
  }
}

function sourceIsAncestor({ claim, observedBaseSha, gitExitCode }) {
  return gitExitCode([
    "merge-base", "--is-ancestor", claim.canonicalBaseRevision, observedBaseSha,
  ]) === 0;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be positive.`);
  return number;
}
