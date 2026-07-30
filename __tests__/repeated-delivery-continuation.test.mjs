import test from "node:test";
import assert from "node:assert/strict";

import { resolveSameSessionDeliveryHandoff } from "../scripts/device-branch-lib.mjs";
import {
  resolveSameSessionDeliveryContinuation,
} from "../scripts/expired-committed-continuation-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/repeated-delivery";
const pullRequestUrl = "https://github.test/org/repo/pull/92";

test("same-session delivery fast-forwards an exact intermediate refresh member", () => {
  const delivered = "a".repeat(40);
  const refreshOne = "b".repeat(40);
  const refreshTwo = "c".repeat(40);
  const mainOne = "d".repeat(40);
  const mainTwo = "e".repeat(40);
  const treeOne = "f".repeat(40);
  const treeTwo = "1".repeat(40);
  let localHead = refreshOne;
  const calls = [];
  const values = {
    [`rev-list --parents -n 1 ${refreshTwo}`]:
      `${refreshTwo} ${refreshOne} ${mainTwo}`,
    [`merge-base --is-ancestor ${mainTwo} origin/main`]: "",
    [`merge-tree --write-tree --no-messages ${refreshOne} ${mainTwo}`]:
      treeTwo,
    [`rev-parse ${refreshTwo}^{tree}`]: treeTwo,
    [`rev-list --parents -n 1 ${refreshOne}`]:
      `${refreshOne} ${delivered} ${mainOne}`,
    [`merge-base --is-ancestor ${mainOne} origin/main`]: "",
    [`merge-tree --write-tree --no-messages ${delivered} ${mainOne}`]:
      treeOne,
    [`rev-parse ${refreshOne}^{tree}`]: treeOne,
    "status --porcelain": "",
  };

  const handoff = resolveSameSessionDeliveryHandoff({
    remoteLease: { deliveryHeadSha: delivered },
    remoteSha: refreshTwo,
    remoteRef: `origin/${branch}`,
    localHeadSha: refreshOne,
    gitText: args => {
      const key = args.join(" ");
      if (key === "rev-parse HEAD") return localHead;
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args.join(" ") ===
        `merge --ff-only origin/${branch}`) {
        localHead = refreshTwo;
      }
    },
  });

  assert.equal(handoff, refreshTwo);
  assert.deepEqual(calls, [[
    "git",
    "merge",
    "--ff-only",
    `origin/${branch}`,
  ]]);
  assert.equal(localHead, refreshTwo);
});

test("repeated delivery rebases source markers while retaining original authored evidence", () => {
  const originalBase = "1".repeat(40);
  const originalFence = "2".repeat(40);
  const integrationCommit = "3".repeat(40);
  const integrationTree = "4".repeat(40);
  const currentFence = "5".repeat(40);
  const currentDelivery = "6".repeat(40);
  const latestHandoff = "7".repeat(40);
  const latestTree = "8".repeat(40);
  const changedPath = "scripts/runtime.mjs";
  const integration = {
    schema: "agentic-integration-commit/v1",
    commitSha: integrationCommit,
    treeSha: integrationTree,
    commitMessage: "fix: retain immutable authored evidence",
    manifestDigest: "9".repeat(64),
    stagedDiffDigest: "a".repeat(64),
    paths: [changedPath],
  };
  const priorContinuation = {
    schema: "agentic-pre-claim-integration-continuation/v1",
    sourceStatus: "delivery",
    sourceEpoch: 350,
    sourceSessionId: "session-a",
    sourceDevice: "device",
    sourceScope: "repeated-delivery",
    sourceBranch: branch,
    sourceBaseSha: originalBase,
    sourceFenceSha: originalFence,
    sourcePullRequestUrl: pullRequestUrl,
    sourceDeliveryHeadSha: integrationCommit,
    headSha: integrationCommit,
    treeSha: integrationTree,
    integrationCommitSha: integrationCommit,
    integrationTreeSha: integrationTree,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "delivery",
    epoch: 353,
    sessionId: "session-a",
    device: "device",
    scope: "repeated-delivery",
    branch,
    worktreePath: repo,
    baseSha: integrationCommit,
    fenceSha: currentFence,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2026-07-30T00:00:00.000Z",
    deliveryHeadSha: currentDelivery,
    integration,
    preClaimIntegrationContinuation: priorContinuation,
  };
  const values = {
    "rev-parse HEAD": latestHandoff,
    [`merge-base --is-ancestor ${integrationCommit} ${currentFence}`]: "",
    [`merge-base --is-ancestor ${currentFence} ${latestHandoff}`]: "",
    [`rev-parse ${integrationCommit}^{tree}`]: integrationTree,
    [`merge-base --is-ancestor ${originalFence} ${integrationCommit}`]: "",
    [`merge-base --is-ancestor ${integrationCommit} ${latestHandoff}`]: "",
    [`diff --name-only -z ${originalFence} ${integrationCommit} --`]:
      `${changedPath}\0`,
    [`diff --binary ${originalFence} ${integrationCommit} --`]:
      "original integration diff",
    [`rev-parse ${latestHandoff}^{tree}`]: latestTree,
  };

  const result = resolveSameSessionDeliveryContinuation({
    branch,
    currentBranch: branch,
    identity: { branch, device: "device", scope: "repeated-delivery" },
    localLease: lease,
    remoteLease: { ...lease, worktreePath: undefined },
    remoteSha: latestHandoff,
    deliveryHandoffHead: latestHandoff,
    pullRequestHeadSha: latestHandoff,
    ownerUrl: pullRequestUrl,
    repo,
    sessionId: "session-a",
    gitText: args => {
      const key = args.join(" ");
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    now: () => new Date("2026-07-30T00:05:00.000Z"),
  });

  assert.equal(result.integration.commitSha, integrationCommit);
  assert.equal(result.integration.validationRequired, true);
  assert.equal(result.preClaimIntegrationContinuation.sourceEpoch, 353);
  assert.equal(
    result.preClaimIntegrationContinuation.sourceDeliveryHeadSha,
    currentDelivery,
  );
  assert.equal(
    result.preClaimIntegrationContinuation.integrationSourceBaseSha,
    originalBase,
  );
  assert.equal(
    result.preClaimIntegrationContinuation.integrationSourceFenceSha,
    originalFence,
  );
  assert.equal(result.preClaimIntegrationContinuation.headSha, latestHandoff);
});
