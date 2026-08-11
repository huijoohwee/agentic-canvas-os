import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { main, parseArguments, publicError } from "../scripts/reviewed-ci-revision.mjs";
import { sourceFixture } from "./reviewed-ci-revision-contract.test.mjs";
import { buildReviewedCiRevisionPlan } from "../scripts/reviewed-ci-revision-contract.mjs";

const baseArguments = [
  "--repository=/workspace/recovery",
  "--session=session",
  "--pr=344",
  "--check-run=10",
];

test("plan CLI returns the exact typed authorization without mutation", async () => {
  let reads = 0;
  const result = await main(["plan", ...baseArguments], {
    createAdapter: () => ({
      async readState() { reads += 1; return { source: sourceFixture(), ttlSeconds: 1_800 }; },
    }),
    environment: {},
  });
  assert.equal(reads, 1);
  assert.equal(result.schema, "agentic-reviewed-ci-revision-cli-plan/v1");
  assert.equal(result.authorization, `authorize reviewed-ci-revision-recovery ${result.plan.planDigest}`);
  const output = JSON.stringify(result);
  for (const secret of ["session", "device-private", "session-private", "/workspace/recovery"]) {
    assert.doesNotMatch(output, new RegExp(secret, "u"));
  }
  assert.equal(result.plan.check.appId, 15368);
  assert.equal(result.plan.headSha, "b".repeat(40));
  assert.equal(result.plan.strategy, "close-reviewed-source-and-create-draft-successor");
  const policy = result.plan.providerPolicy;
  assert.equal(policy.sourcePullRequest.disposition, "close-unmerged-and-preserve");
  assert.equal(policy.sourcePullRequest.number, 344);
  assert.equal(policy.sourcePullRequest.merged, false);
  assert.equal(policy.replacementPullRequest.disposition, "create-one-distinct-open-draft");
  assert.equal(policy.replacementPullRequest.recoveryNonce.length, 64);
  assert.equal(policy.replacementPullRequest.bodyDigest.length, 64);
  assert.equal(policy.replacementPullRequest.backlink, policy.sourcePullRequest.url);
  assert.deepEqual(policy.replacementPullRequest.carryOver,
    { reviews: false, labels: false, autoMerge: false, mergeQueue: false });
  assert.equal(policy.terminalProjection.localPullRequestUrl,
    "replace-with-provider-assigned-replacement-url");
  assert.equal(policy.basePolicy.sourceCloudCanonicalBaseSha, "a".repeat(40));
  assert.equal(policy.basePolicy.replacementProtectedMainSha, "a".repeat(40));
  assert.equal(policy.basePolicy.ancestryReceiptDigest.length, 64);
  assert.equal(policy.basePolicy.ancestryHopCount, 0);
  assert.equal(policy.basePolicy.unchangedHeadSha, "b".repeat(40));
  assert.equal(policy.basePolicy.boundedAncestryProofRequired, true);
  assert.equal(policy.basePolicy.silentRebase, false);
  assert.equal(policy.basePolicy.headMutation, false);
});

test("execute requires explicit exact authorization input", () => {
  assert.throws(() => parseArguments(["execute", ...baseArguments]), /requires exact/);
  assert.throws(() => parseArguments(["plan", ...baseArguments, "--pr=345"]), /unique/);
  assert.throws(() => parseArguments(["plan", ...baseArguments, "--unknown=x"]), /Unknown/);
});

test("stored replay requires the exact PR, check run, and authorization", async () => {
  const plan = buildReviewedCiRevisionPlan({ source: sourceFixture() });
  const authorization = `authorize reviewed-ci-revision-recovery ${plan.planDigest}`;
  const createAdapter = () => ({ async readState() { return { intent: { planSnapshot: plan } }; } });
  const runRecovery = async (_input, { adapter }) => {
    await adapter.readState();
    return successFixture(plan);
  };
  await assert.rejects(main(["execute", ...baseArguments.slice(0, 2), "--pr=345", "--check-run=10",
    `--authorize=${authorization}`], { createAdapter, runRecovery }), /PR\/check-run identity/);
  await assert.rejects(main(["execute", ...baseArguments, "--authorize=authorize wrong"],
    { createAdapter, runRecovery }), /exact plan authorization/);
  const result = await main(["execute", ...baseArguments, `--authorize=${authorization}`],
    { createAdapter, runRecovery });
  assert.equal(result.planDigest, plan.planDigest);
});

test("archived replay retains the exact CLI subject and authorization fence", async () => {
  const plan = buildReviewedCiRevisionPlan({ source: sourceFixture() });
  const authorization = `authorize reviewed-ci-revision-recovery ${plan.planDigest}`;
  const createAdapter = () => ({ async readState() {
    return { archive: { intentSnapshot: { planSnapshot: plan } } };
  } });
  const runRecovery = async (_input, { adapter }) => {
    await adapter.readState();
    return successFixture(plan);
  };
  const result = await main(["execute", ...baseArguments, `--authorize=${authorization}`],
    { createAdapter, runRecovery });
  assert.equal(result.archiveReceiptDigest, "6".repeat(64));
  await assert.rejects(main(["execute", ...baseArguments, "--authorize=authorize wrong"],
    { createAdapter, runRecovery }), /exact plan authorization/);
});

test("execute success exposes digests only", async () => {
  const plan = buildReviewedCiRevisionPlan({ source: sourceFixture() });
  const authorization = `authorize reviewed-ci-revision-recovery ${plan.planDigest}`;
  const result = await main(["execute", ...baseArguments, `--authorize=${authorization}`], {
    createAdapter: () => ({ async readState() { return { intent: { planSnapshot: plan } }; } }),
    async runRecovery(_input, { adapter }) { await adapter.readState(); return successFixture(plan); },
  });
  const output = JSON.stringify(result);
  assert.deepEqual(Object.keys(result), ["schema", "status", "planDigest", "sourceClaimId",
    "successorClaimId", "finalReceiptDigest", "archiveReceiptDigest", "receiptDigests"]);
  for (const privateValue of ["session-private", "device-private", "/Users/alice/recovery",
    "private PR body", "authorizationDigest"]) assert.doesNotMatch(output, new RegExp(privateValue, "u"));
  assert.equal(result.receiptDigests[0], "4".repeat(64));
});

test("delivery-won abort exposes cleanup digests only", async () => {
  const plan = buildReviewedCiRevisionPlan({ source: sourceFixture() });
  const authorization = `authorize reviewed-ci-revision-recovery ${plan.planDigest}`;
  const result = await main(["execute", ...baseArguments, `--authorize=${authorization}`], {
    createAdapter: () => ({ async readState() { return { intent: { planSnapshot: plan } }; } }),
    async runRecovery(_input, { adapter }) { await adapter.readState(); return {
      status: "aborted-delivery-won", planDigest: plan.planDigest, sourceClaimId: "1".repeat(64),
      deliveryReceiptDigest: "2".repeat(64), cleanupReceiptDigest: "3".repeat(64),
      abortReceiptDigest: "4".repeat(64), archiveReceiptDigest: "5".repeat(64),
      privateAuthority: { sessionId: "session-private" } } },
  });
  assert.deepEqual(Object.keys(result), ["schema", "status", "planDigest", "sourceClaimId",
    "deliveryReceiptDigest", "cleanupReceiptDigest", "abortReceiptDigest", "archiveReceiptDigest"]);
  assert.doesNotMatch(JSON.stringify(result), /session-private|privateAuthority/);
});

test("diagnostics redact credentials and Unix/Windows user paths", () => {
  const message = publicError(new Error(
    "github_pat_secret ghp_secret https://user:pass@example.test /Users /Users/alice/repo C:\\Users\\alice\\repo /home/bob/repo",
  ));
  assert.doesNotMatch(message, /secret|alice|bob|user:pass|\\Users|\/Users|\/home/);
  assert.match(message, /\[credential\]/);
  assert.match(message, /\[local-path\]/);
  assert.ok(message.length <= 300);
});

test("operator documentation keeps execution blocked and describes provider replacement and abort", () => {
  const document = readFileSync(new URL("../docs/REVIEWED-CI-REVISION-RECOVERY.md", import.meta.url), "utf8");
  for (const statement of ["intentionally hard-stopped", "close-unmerged-and-preserve",
    "create-one-distinct-open-draft", "delivery-won-aborted", "bounded ancestry proof",
    "no review decisions, labels, auto-merge request, or merge-queue entry"]) {
    assert.match(document, new RegExp(statement, "u"));
  }
});

function successFixture(plan) {
  return {
    schema: "private-result", status: "recovered", planDigest: plan.planDigest,
    sourceClaimId: "1".repeat(64), successorClaimId: "2".repeat(64),
    finalReceiptDigest: "3".repeat(64), archiveReceiptDigest: "6".repeat(64),
    receipts: [{ phase: "remote-active", receiptDigest: "4".repeat(64), values: {
      sessionId: "session-private", deviceId: "device-private",
      activeLease: { worktreePath: "/Users/alice/recovery" }, body: "private PR body",
      authorizationDigest: "5".repeat(64),
    } }],
  };
}
