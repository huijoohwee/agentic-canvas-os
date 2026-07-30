import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  CHANGE_MANIFEST_SCHEMA,
  integrateSession,
} from "../scripts/device-integrate-lib.mjs";

const branch = "agent/device/committed-continuation";
const sourceBaseSha = "8".repeat(40);
const sourceFenceSha = "a".repeat(40);
const committedHeadSha = "b".repeat(40);
const committedTreeSha = "c".repeat(40);
const deliveryHandoffSha = "e".repeat(40);
const deliveryHandoffTreeSha = "f".repeat(40);
const successorFenceSha = "d".repeat(40);
const changedPath = "scripts/continuation.mjs";
const rangeDiff = "committed continuation diff";

test("integration validates recovered committed evidence against its original manifest", () => {
  const harness = createHarness();
  try {
    assert.throws(() => harness.invoke(), /stop after recovered validation/);
    const state = harness.state();
    assert.equal(state.lease.integration.validationRequired, false);
    assert.match(state.lease.integration.manifestDigest, /^[0-9a-f]{64}$/);
    assert.ok(state.calls.some(call => call.join(" ") === "npm run check"));
    assert.ok(state.calls.some(call => call.join(" ") ===
      `git merge-base --is-ancestor ${sourceFenceSha} ${committedHeadSha}`));
    assert.equal(state.publishCalls, 1);
  } finally {
    harness.cleanup();
  }
});

test("integration rejects a recovered commit without its approved manifest", () => {
  const harness = createHarness({ omitManifest: true });
  try {
    assert.throws(() => harness.invoke(), /requires --paths-manifest/);
    const state = harness.state();
    assert.equal(state.calls.some(call => call[0] === "npm"), false);
    assert.equal(state.publishCalls, 0);
    assert.equal(state.lease.integration.validationRequired, true);
  } finally {
    harness.cleanup();
  }
});

test("integration revalidates delivery-resume evidence from the original source fence", () => {
  const harness = createHarness({ sourceStatus: "delivery" });
  try {
    assert.throws(() => harness.invoke(), /stop after recovered validation/);
    const state = harness.state();
    assert.equal(state.lease.integration.validationRequired, false);
    assert.ok(state.calls.some(call => call.join(" ") ===
      `git merge-base --is-ancestor ${committedHeadSha} ${deliveryHandoffSha}`));
    assert.ok(state.calls.some(call => call.join(" ") === "npm run check"));
    assert.equal(state.publishCalls, 1);
  } finally {
    harness.cleanup();
  }
});

test("repeated delivery keeps current lease markers separate from authored integration evidence", () => {
  const harness = createHarness({
    sourceStatus: "delivery",
    repeatedDelivery: true,
  });
  try {
    assert.throws(() => harness.invoke(), /stop after recovered validation/);
    const state = harness.state();
    assert.equal(state.lease.integration.validationRequired, false);
    assert.ok(state.calls.some(call => call.join(" ") ===
      `git merge-base --is-ancestor ${sourceFenceSha} ${committedHeadSha}`));
    assert.ok(state.calls.some(call => call.join(" ") ===
      `git merge-base --is-ancestor ${"3".repeat(40)} ${deliveryHandoffSha}`));
  } finally {
    harness.cleanup();
  }
});

function createHarness({
  omitManifest = false,
  sourceStatus = "active",
  repeatedDelivery = false,
} = {}) {
  const delivery = sourceStatus === "delivery";
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-committed-integration-"));
  const canonicalRoot = path.join(repo, "canonical", "agentic-canvas-os");
  mkdirSync(canonicalRoot, { recursive: true });
  const manifestPath = path.join(repo, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    schema: CHANGE_MANIFEST_SCHEMA,
    branch,
    baseSha: sourceBaseSha,
    paths: [changedPath],
  }));
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 8,
    sessionId: "session-a",
    device: "device",
    scope: "committed-continuation",
    branch,
    worktreePath: repo,
    baseSha: delivery ? deliveryHandoffSha : committedHeadSha,
    fenceSha: successorFenceSha,
    pullRequestUrl: "https://github.test/org/repo/pull/71",
    integration: {
      schema: "agentic-integration-commit/v1",
      commitSha: committedHeadSha,
      treeSha: committedTreeSha,
      commitMessage: "feat: preserve committed work",
      manifestDigest: null,
      stagedDiffDigest: null,
      paths: [changedPath],
      rangeDiffDigest: sha256(rangeDiff),
      validationRequired: true,
    },
    preClaimIntegrationContinuation: {
      schema: "agentic-pre-claim-integration-continuation/v1",
      sourceStatus,
      sourceEpoch: 7,
      sourceSessionId: "session-a",
      sourceDevice: "device",
      sourceScope: "committed-continuation",
      sourceBranch: branch,
      sourceBaseSha: repeatedDelivery ? "2".repeat(40) : sourceBaseSha,
      sourceFenceSha: repeatedDelivery ? "3".repeat(40) : sourceFenceSha,
      ...(repeatedDelivery ? {
        integrationSourceBaseSha: sourceBaseSha,
        integrationSourceFenceSha: sourceFenceSha,
      } : {}),
      sourcePullRequestUrl: "https://github.test/org/repo/pull/71",
      ...(delivery ? { sourceDeliveryHeadSha: deliveryHandoffSha } : {}),
      headSha: delivery ? deliveryHandoffSha : committedHeadSha,
      treeSha: delivery ? deliveryHandoffTreeSha : committedTreeSha,
      integrationCommitSha: committedHeadSha,
      integrationTreeSha: committedTreeSha,
    },
  };
  const calls = [];
  let publishCalls = 0;
  return {
    invoke: () => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        const values = {
          "branch --show-current": branch,
          "worktree list --porcelain -z":
            `worktree ${canonicalRoot}\0HEAD ${sourceBaseSha}\0branch refs/heads/main\0\0` +
            `worktree ${repo}\0HEAD ${successorFenceSha}\0branch refs/heads/${branch}\0\0`,
          "diff --name-only -z HEAD --": "",
          "ls-files --others --exclude-standard -z": "",
          "status --porcelain": "",
          [`diff --name-only -z ${sourceFenceSha} ${committedHeadSha} --`]:
            `${changedPath}\0`,
          [`diff --binary ${sourceFenceSha} ${committedHeadSha} --`]:
            rangeDiff,
          [`rev-parse ${committedHeadSha}^{tree}`]: committedTreeSha,
          ...(delivery ? {
            [`rev-parse ${deliveryHandoffSha}^{tree}`]:
              deliveryHandoffTreeSha,
          } : {}),
        };
        if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
        return values[key];
      },
      ghText: () => "",
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
        annotate: ({ values }) => (lease = { ...lease, ...values }),
      },
      sessionId: "session-a",
      run: (command, args) => calls.push([command, ...args]),
      runText: () => "merge preflight",
      publishTask: () => {
        publishCalls += 1;
        throw new Error("stop after recovered validation");
      },
      completeTask: () => {},
      commitMessage: "feat: preserve committed work",
      pathsManifest: omitManifest ? "" : manifestPath,
      runtime: "none",
      controllerRoot: repo,
      log: () => {},
    }),
    state: () => ({ calls, lease, publishCalls }),
    cleanup: () => rmSync(repo, { recursive: true, force: true }),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
