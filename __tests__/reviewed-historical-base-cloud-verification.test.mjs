import assert from "node:assert/strict";
import test from "node:test";

import { prepareReadRequest } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { captureReviewedHistoricalBaseProof }
  from "../scripts/reviewed-historical-base-cloud-verification.mjs";

const sourceBase = "a".repeat(40);
const protectedBase = "b".repeat(40);
const head = "c".repeat(40);
const claimId = "d".repeat(64);
const reviewRequestId = "github-pull-request:PR_17";
const changedPaths = ["docs/current.md"];
const claim = {
  state: "reviewed",
  claimId,
  canonicalBaseRevision: sourceBase,
  laneRevision: head,
  reviewRequestId,
  declaredWriteScope: ["path:scripts/owned.mjs", "semantic:owned"],
};

test("captures exact ancestry and disjoint protected-base evidence", () => {
  const calls = [];
  const proof = captureReviewedHistoricalBaseProof({
    claim,
    pullRequestNumber: 17,
    observedHeadSha: head,
    observedBaseSha: protectedBase,
    reviewRequestId,
    run: args => calls.push(args),
    gitExitCode: () => 0,
    gitText: args => {
      if (args[0] === "rev-parse" && args[1].endsWith("origin/main")) return protectedBase;
      if (args[0] === "rev-parse" && args[1].includes("pull/17")) return head;
      if (args[0] === "diff") return `${changedPaths[0]}\0`;
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
  });
  assert.equal(proof.sourceBaseSha, sourceBase);
  assert.equal(proof.targetBaseSha, protectedBase);
  assert.equal(proof.overlap, "none");
  assert.deepEqual(proof.canonicalChangedPaths, changedPaths);
  assert.equal(calls.length, 1);
});

test("rejects a protected-base advance that overlaps reviewed paths", () => {
  assert.throws(() => captureReviewedHistoricalBaseProof({
    claim,
    pullRequestNumber: 17,
    observedHeadSha: head,
    observedBaseSha: protectedBase,
    reviewRequestId,
    run: () => {},
    gitExitCode: () => 0,
    gitText: args => args[0] === "diff"
      ? "scripts/owned.mjs\0"
      : args[1]?.includes("pull/17") ? head : protectedBase,
  }), /overlaps preserved lane paths/u);
});

test("maps a reviewed historical subject only with its exact proof", () => {
  const proof = captureReviewedHistoricalBaseProof({
    claim,
    pullRequestNumber: 17,
    observedHeadSha: head,
    observedBaseSha: protectedBase,
    reviewRequestId,
    run: () => {},
    gitExitCode: () => 0,
    gitText: args => args[0] === "diff"
      ? "docs/current.md\0"
      : args[1]?.includes("pull/17") ? head : protectedBase,
  });
  const pullRequest = {
    branch: "agent/device/owned",
    headSha: head,
    baseSha: protectedBase,
    nodeId: "PR_17",
  };
  const input = {
    branch: pullRequest.branch,
    canonicalBaseSha: sourceBase,
    headSha: head,
    claimId,
    reviewRequestId,
    requireStatus: "reviewed",
    allowReviewedHistoricalBase: true,
    canonicalDescendantProof: proof,
  };
  const request = prepareReadRequest({ input, pullRequest });
  assert.equal(request.canonicalBaseRevision, sourceBase);
  assert.equal(request.laneRevision, head);
  assert.throws(
    () => prepareReadRequest({ input: { ...input, canonicalDescendantProof: null }, pullRequest }),
    /requires canonical descendant proof/u,
  );
});
