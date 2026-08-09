// Responsibility: verify checkout-independent evidence routing, durable lock/CAS replay, and cloud action requests.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createMergedDormantClaimReconciliationAdapter,
  createMergedDormantClaimReconciliationIntentStore,
  createGitHubReader,
  createRepositoryMergedDormantClaimCloudActions,
  mergedDormantReconciliationCheckedRevisions,
  readCompleteGitHubChangedPaths,
  readCompleteGitHubCheckRuns,
  readCompleteGitHubCommitPaths,
  readGitHubMergeCommitSha,
} from "../scripts/merged-dormant-claim-reconciliation-repository-adapter.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

test("repository adapter requires the complete controller surface", () => {
  assert.throws(
    () => createMergedDormantClaimReconciliationAdapter({}),
    /requires withEntrypointFence/,
  );
  const method = () => null;
  const adapter = createMergedDormantClaimReconciliationAdapter({
    withEntrypointFence: method,
    readSourceEvidence: method,
    readIntent: method,
    writeIntent: method,
    readClaim: method,
    recoverDormant: method,
    integrateReviewed: method,
    retireIntegrated: method,
  });
  assert.equal(adapter.retireIntegrated, method);
});

test("durable intent CAS remains available while the distinct entrypoint fence is held", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "merged-dormant-intent-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const statePath = path.join(directory, "intent.json");
  const store = createMergedDormantClaimReconciliationIntentStore({
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    statePath,
  });
  const authorized = { schema: "intent", status: "authorized" };
  const prepared = { schema: "intent", status: "prepared" };

  await store.withEntrypointFence({ planDigest: digest("a") }, async fence => {
    assert.match(fence.fenceDigest, /^[0-9a-f]{64}$/u);
    assert.deepEqual(store.writeIntent({ expectedIntent: null, nextIntent: authorized }), authorized);
    assert.deepEqual(store.writeIntent({ expectedIntent: authorized, nextIntent: prepared }), prepared);
  });

  assert.deepEqual(store.readIntent(), prepared);
  assert.throws(
    () => store.writeIntent({ expectedIntent: authorized, nextIntent: prepared }),
    /changed before CAS/,
  );
  const journal = JSON.parse(readFileSync(statePath, "utf8"));
  writeFileSync(statePath, JSON.stringify({ ...journal, intentDigest: digest("f") }));
  assert.throws(() => store.readIntent(), /digest-invalid/);
});

test("entrypoint fences recover dead owners, exclude live owners, and release only their token", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "merged-dormant-lock-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const statePath = path.join(directory, "intent.json");
  const lockPath = `${statePath}.entrypoint.lock`;
  const store = createMergedDormantClaimReconciliationIntentStore({ statePath });

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: "live-token" }));
  await assert.rejects(
    () => store.withEntrypointFence({}, () => null),
    /already fenced/,
  );

  writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, token: "dead-token" }));
  assert.equal(await store.withEntrypointFence({}, () => "replayed"), "replayed");
  assert.equal(readFileIfPresent(lockPath), null);

  await store.withEntrypointFence({}, () => {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: "replacement-token" }));
  });
  assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, "replacement-token");
});

test("cloud effects use repository CAS actions and exact plan-bound operation values", async () => {
  const calls = [];
  const actions = createRepositoryMergedDormantClaimCloudActions({
    invokeCloudAction: input => {
      calls.push(input);
      return { ok: true };
    },
    ledgerRepository: "org/ledger",
    targetRepository: "org/product",
    ttlSeconds: 900,
  });
  const operationKey = digest("1");
  const plan = {
    planDigest: digest("2"),
    recoveryDeviceId: "device-a",
    recoverySessionId: "session-a",
    dependencyClosureDigest: digest("3"),
    namedChecksDigest: digest("4"),
    handoffEvidenceDigest: digest("5"),
    bytesDigest: digest("6"),
    retirementReason: "integrated",
    finalRevision: sha("b"),
  };
  const claim = {
    claimId: digest("7"),
    fenceRevision: digest("8"),
    transitionCounter: 11,
    laneRevision: sha("b"),
    reviewRequestId: "github-pull-request:PR_node",
    evidenceDigest: digest("9"),
    integrationReceiptDigest: digest("a"),
  };
  const context = {
    intent: { authorizationDigest: digest("c") },
    live: { claim, result: { ledgerDigest: digest("d") } },
    operationKey,
    plan,
  };

  assert.deepEqual(await actions.recoverDormant(context), { operationKey });
  assert.deepEqual(await actions.integrateReviewed(context), { operationKey });
  assert.deepEqual(await actions.retireIntegrated(context), { operationKey });
  assert.deepEqual(calls.map(call => call.action), ["continue", "integrate", "retire"]);
  assert.equal(calls[0].request.mode, "recovery");
  assert.equal(calls[0].request.recoveryEvidenceDigest, operationKey);
  assert.equal(calls[0].request.deviceId, plan.recoveryDeviceId);
  assert.equal(calls[0].request.ttlSeconds, 900);
  assert.equal(calls[1].request.dependencyClosureDigest, plan.dependencyClosureDigest);
  assert.equal(calls[1].request.operatorDecisionDigest, context.intent.authorizationDigest);
  assert.equal(calls[1].request.integrationIntentDigest, operationKey);
  assert.equal(calls[2].request.reason, "integrated");
  assert.equal(calls[2].request.integrationReceiptDigest, claim.integrationReceiptDigest);
  assert.ok(calls.every(call => call.request.force === undefined));
});

test("GitHub evidence readers paginate paths and fail closed on truncated checks or commits", async () => {
  const page = count => Array.from({ length: count }, (_, index) => ({ filename: `path-${index}` }));
  const pathCalls = [];
  const paths = await readCompleteGitHubChangedPaths(async endpoint => {
    pathCalls.push(endpoint);
    return endpoint.endsWith("page=1") ? page(100) : [{ filename: "tail" }];
  }, "repos/org/product/pulls/738/files");
  assert.equal(paths.length, 101);
  assert.equal(pathCalls.length, 2);

  await assert.rejects(() => readCompleteGitHubCheckRuns(async () => ({
    total_count: 101,
    check_runs: Array.from({ length: 100 }, () => ({})),
  }), "org/product", sha("a")), /truncated/);

  await assert.rejects(() => readCompleteGitHubCommitPaths(async () => ({
    files: page(100),
  }), "org/product", sha("b")), /complete response bound/);
});

test("default GitHub reader pins the current REST version header", async () => {
  let invocation = null;
  const github = createGitHubReader({
    sourceRoot: "/preserved/source",
    execute: (command, argumentsList, options) => {
      invocation = { argumentsList, command, options };
      return "{}";
    },
  });
  await github("repos/org/product");
  assert.equal(invocation.command, "gh");
  assert.ok(invocation.argumentsList.includes("X-GitHub-Api-Version: 2026-03-10"));
  assert.equal(invocation.options.cwd, "/preserved/source");
});

test("provider check revisions support a direct merge without a refresh commit", () => {
  assert.deepEqual(
    mergedDormantReconciliationCheckedRevisions(sha("a"), [], sha("b")),
    [sha("a"), sha("b")],
  );
  assert.deepEqual(
    mergedDormantReconciliationCheckedRevisions(sha("a"), [{ sha: sha("c") }], sha("b")),
    [sha("a"), sha("c"), sha("b")],
  );
});

test("merged PR evidence recovers a null REST merge SHA from one complete merge event", async () => {
  const mergeSha = sha("c");
  const calls = [];
  assert.equal(await readGitHubMergeCommitSha(async endpoint => {
    calls.push(endpoint);
    return [{ event: "closed" }, { event: "merged", commit_id: mergeSha }];
  }, "org/product", 738, null), mergeSha);
  assert.deepEqual(calls, ["repos/org/product/issues/738/events?per_page=100&page=1"]);
  await assert.rejects(() => readGitHubMergeCommitSha(
    async () => Array.from({ length: 100 }, () => ({ event: "closed" })),
    "org/product", 738, null), /may be truncated/);
});

function readFileIfPresent(filePath) {
  try { return readFileSync(filePath, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
