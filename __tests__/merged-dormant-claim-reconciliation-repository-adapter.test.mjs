// Responsibility: verify checkout-independent evidence routing, durable lock/CAS replay, and cloud action requests.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createMergedDormantClaimReconciliationAdapter,
  createMergedDormantClaimReconciliationIntentStore,
  createRepositoryMergedDormantClaimReconciliationAdapter,
  createGitHubReader,
  createRepositoryMergedDormantClaimCloudActions,
  mergedDormantReconciliationCheckedRevisions,
  readCompletedAbsentLocalEvidence,
  readCompleteGitHubChangedPaths,
  readCompleteGitHubCheckRuns,
  readCompleteGitHubCommitPaths,
  readGitHubMergeCommitSha,
} from "../scripts/merged-dormant-claim-reconciliation-repository-adapter.mjs";
import { applyCloudTransition, createEmptyLedger } from "../scripts/cloud-collaboration-contract.mjs";

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
    environment: {
      AGENTIC_CLOUD_HEAD_SHA: sha("f"), AGENTIC_DEVICE_ID: "ambient-device",
      AGENTIC_SESSION_ID: "ambient-session", AGENTIC_TARGET_REPOSITORY: "ambient/repository",
    },
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
  assert.ok(calls.every(call => call.environment.AGENTIC_DEVICE_ID === plan.recoveryDeviceId));
  assert.ok(calls.every(call => call.environment.AGENTIC_SESSION_ID === plan.recoverySessionId));
  assert.ok(calls.every(call => call.environment.AGENTIC_CLOUD_HEAD_SHA === undefined));
  assert.ok(calls.every(call => call.environment.AGENTIC_TARGET_REPOSITORY === undefined));
});

test("completed absent mode admits only a clean main anchor, retained ref, and one historical lease", t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "merged-dormant-absent-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const historicalPath = path.join(directory, "removed-worktree");
  const fixture = completedAbsentLocalFixture({ historicalPath, sourceRoot: directory });
  const evidence = readCompletedAbsentLocalEvidence(fixture);
  assert.equal(evidence.mode, "completed-absent");
  assert.equal(evidence.headSha, fixture.lease.reviewHeadSha);
  assert.equal(evidence.canonicalAnchor.sha, sha("1"));
  assert.equal(evidence.absence.localBranchPresent, true);
  assert.equal(evidence.absence.localRefName, `refs/heads/${fixture.lease.branch}`);

  const attached = completedAbsentLocalFixture({ historicalPath, sourceRoot: directory,
    worktreeRecords: `worktree ${directory}\0HEAD ${sha("1")}\0branch refs/heads/main\0\0worktree ${historicalPath}\0HEAD ${sha("9")}\0branch refs/heads/${fixture.lease.branch}\0\0` });
  assert.throws(() => readCompletedAbsentLocalEvidence(attached), /still present or attached/);

  const duplicate = completedAbsentLocalFixture({ historicalPath, sourceRoot: directory });
  duplicate.leaseStore.read = () => ({ leases: {
    [duplicate.lease.branch]: duplicate.lease,
    duplicate: { ...duplicate.lease, branch: "agent/other/duplicate",
      cloudAuthority: { claimId: digest("d") } },
  } });
  assert.throws(() => readCompletedAbsentLocalEvidence(duplicate), /competing historical lease evidence/);

  const competing = completedAbsentLocalFixture({ historicalPath, sourceRoot: directory });
  competing.claims.push({ claimId: digest("e"), repositoryId: competing.claim.repositoryId,
    scopeReserved: true, declaredWriteScope: ["path:src"] });
  assert.throws(() => readCompletedAbsentLocalEvidence(competing), /competing reserved cloud claim/);

  const unregisteredAnchor = completedAbsentLocalFixture({ historicalPath, sourceRoot: directory,
    worktreeRecords: `worktree ${directory}\0HEAD ${sha("9")}\0detached\0\0` });
  assert.throws(() => readCompletedAbsentLocalEvidence(unregisteredAnchor), /requires registered main/);
});

test("pre-recovery observation rejects a stale completed-absent anchor before cloud effects", async () => {
  const now = "2026-08-10T00:00:00.000Z";
  const repository = { repositoryId: "github-repository:R_fixture", canonicalRevision: sha("a") };
  const actor = { actorId: "github-user:1", deviceId: "fixture-device", sessionId: "fixture-session" };
  const empty = createEmptyLedger(repository);
  const claimed = applyCloudTransition({
    ledger: empty, action: "claim", actor, repository, evaluationTime: now,
    request: {
      workItemId: "work-item:stale-anchor", canonicalBaseRevision: repository.canonicalRevision,
      laneRevision: sha("b"), declaredWriteScope: ["path:src"], leaseEpoch: 1,
      expiresAt: "2026-08-10T01:00:00.000Z", idempotencyKey: "stale-anchor-claim",
      expectedLedgerDigest: empty.headDigest,
    },
  });
  const preserved = applyCloudTransition({
    ledger: claimed.ledger, action: "continue", actor, repository, evaluationTime: now,
    request: {
      claimId: claimed.claim.claimId, expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: claimed.ledger.headDigest, mode: "preserve",
      handoffEvidenceDigest: digest("d"), idempotencyKey: "stale-anchor-preserve",
    },
  });
  const ledgerRevision = sha("c");
  let observed = 0, recovered = 0;
  const adapter = createRepositoryMergedDormantClaimReconciliationAdapter({
    sourceRepository: "/fixture/source", targetRepository: "org/product", pullRequestNumber: 1,
    claimId: preserved.claim.claimId, ledgerRepository: "org/ledger",
    now: () => new Date(now), resolveRealpath: value => value,
    gitText: args => ({
      [["rev-parse", "--git-common-dir"].join("\0")]: ".git\n",
      [["branch", "--show-current"].join("\0")]: "main\n",
      [["status", "--porcelain=v1", "--untracked-files=all"].join("\0")]: "",
      [["rev-parse", "HEAD"].join("\0")]: `${sha("d")}\n`,
      [["rev-parse", "origin/main"].join("\0")]: `${sha("e")}\n`,
    })[args.join("\0")] ?? (() => { throw new Error(`Unexpected git call: ${args.join(" ")}`); })(),
    githubJson: async endpoint => {
      if (endpoint === "repos/org/ledger/git/ref/heads/agentic%2Fcollaboration-ledger") {
        return { object: { sha: ledgerRevision } };
      }
      if (endpoint === `repos/org/ledger/contents/.agentic/collaboration-ledger.json?ref=${ledgerRevision}`) {
        return { content: Buffer.from(JSON.stringify(preserved.ledger)).toString("base64") };
      }
      throw new Error(`Unexpected GitHub call: ${endpoint}`);
    },
    leaseStore: { read: () => ({ leases: {} }) },
    cloudActions: {
      observePhase: () => { observed += 1; return null; },
      recoverDormant: () => { recovered += 1; return null; },
      integrateReviewed: () => null,
      retireIntegrated: () => null,
    },
  });
  await assert.rejects(
    () => adapter.readClaim({
      intent: { status: "prepared" }, plan: { planDigest: digest("p") },
      phase: "recovered", operationKey: digest("o"),
    }),
    /requires clean current main/,
  );
  assert.equal(observed, 0);
  assert.equal(recovered, 0);
});

test("post-recovery observation uses phase evidence without rebuilding dormant source evidence", async () => {
  const now = "2026-08-10T00:00:00.000Z";
  const repository = { repositoryId: "github-repository:R_fixture", canonicalRevision: sha("a") };
  const actor = { actorId: "github-user:1", deviceId: "fixture-device", sessionId: "fixture-session" };
  const empty = createEmptyLedger(repository);
  const claimed = applyCloudTransition({
    ledger: empty, action: "claim", actor, repository, evaluationTime: now,
    request: {
      workItemId: "work-item:post-recovery", canonicalBaseRevision: repository.canonicalRevision,
      laneRevision: sha("b"), declaredWriteScope: ["path:src"], leaseEpoch: 1,
      expiresAt: "2026-08-10T01:00:00.000Z", idempotencyKey: "post-recovery-claim",
      expectedLedgerDigest: empty.headDigest,
    },
  });
  const reviewed = applyCloudTransition({
    ledger: claimed.ledger, action: "continue", actor, repository, evaluationTime: now,
    request: {
      claimId: claimed.claim.claimId, expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: claimed.ledger.headDigest, mode: "review",
      laneRevision: claimed.claim.laneRevision,
      reviewRequestId: "github-pull-request:PR_fixture",
      focusedEvidenceDigest: digest("f"), idempotencyKey: "post-recovery-review",
    },
  });
  const recovered = applyCloudTransition({
    ledger: reviewed.ledger, action: "continue", actor, repository,
    evaluationTime: "2026-08-10T01:01:00.000Z",
    request: {
      claimId: reviewed.claim.claimId, expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest, mode: "recovery",
      recoveryEvidenceDigest: digest("e"), expiresAt: "2026-08-10T02:00:00.000Z",
      idempotencyKey: "post-recovery-recover",
    },
  });
  const ledgerRevision = sha("c");
  let observed = 0;
  const adapter = createRepositoryMergedDormantClaimReconciliationAdapter({
    sourceRepository: "/fixture/source", targetRepository: "org/product", pullRequestNumber: 1,
    claimId: recovered.claim.claimId, ledgerRepository: "org/ledger",
    now: () => new Date(now), resolveRealpath: value => value,
    gitText: args => {
      if (args.join("\0") === ["rev-parse", "--git-common-dir"].join("\0")) return ".git\n";
      throw new Error("Post-recovery observation must not rebuild dormant source evidence.");
    },
    githubJson: async endpoint => {
      if (endpoint === "repos/org/ledger/git/ref/heads/agentic%2Fcollaboration-ledger") {
        return { object: { sha: ledgerRevision } };
      }
      if (endpoint === `repos/org/ledger/contents/.agentic/collaboration-ledger.json?ref=${ledgerRevision}`) {
        return { content: Buffer.from(JSON.stringify(recovered.ledger)).toString("base64") };
      }
      throw new Error(`Unexpected GitHub call: ${endpoint}`);
    },
    leaseStore: { read: () => ({ leases: {} }) },
    cloudActions: {
      observePhase: ({ live }) => {
        observed += 1;
        assert.equal(live.claim.state, "reviewed");
        assert.equal(live.claim.recovery.evidenceDigest, digest("e"));
        return { phase: "recovered" };
      },
      recoverDormant: () => null,
      integrateReviewed: () => null,
      retireIntegrated: () => null,
    },
  });

  assert.deepEqual(await adapter.readClaim({
    intent: { status: "prepared" }, plan: { planDigest: digest("p") },
    phase: "recovered", operationKey: digest("o"),
  }), { phase: "recovered" });
  assert.equal(observed, 1);
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
  assert.equal(invocation.options.maxBuffer, 64 * 1024 * 1024);
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

function completedAbsentLocalFixture({ historicalPath, sourceRoot, worktreeRecords = null }) {
  const branch = "agent/device/completed-source";
  const claim = {
    claimId: digest("a"), repositoryId: "github-repository:R_1", laneRevision: sha("b"),
    declaredWriteScope: ["path:src"],
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "completed", epoch: 1,
    sessionId: "historical-session", device: "historical-device", scope: "completed-source", branch,
    worktreePath: historicalPath, baseSha: sha("c"), fenceSha: sha("d"),
    reviewHeadSha: claim.laneRevision, pullRequestUrl: "https://github.com/org/repo/pull/1",
    completion: { mergeCommitSha: sha("e"), mainSha: sha("f") },
    cloudAuthority: { claimId: claim.claimId },
  };
  const responses = new Map([
    [["branch", "--show-current"].join("\0"), "main\n"],
    [["status", "--porcelain=v1", "--untracked-files=all"].join("\0"), ""],
    [["rev-parse", "HEAD"].join("\0"), `${sha("1")}\n`],
    [["rev-parse", "HEAD^{tree}"].join("\0"), `${sha("4")}\n`],
    [["rev-parse", "origin/main"].join("\0"), `${sha("1")}\n`],
    [["worktree", "list", "--porcelain", "-z"].join("\0"), worktreeRecords || `worktree ${sourceRoot}\0HEAD ${sha("1")}\0branch refs/heads/main\0\0`],
    [["show-ref", "--verify", "--hash", `refs/heads/${branch}`].join("\0"), `${lease.reviewHeadSha}\n`],
    [["rev-parse", `${lease.reviewHeadSha}^{tree}`].join("\0"), `${sha("2")}\n`],
    [["rev-parse", `${lease.fenceSha}^`].join("\0"), `${lease.baseSha}\n`],
    [["rev-parse", `${lease.fenceSha}^{tree}`].join("\0"), `${sha("3")}\n`],
    [["rev-parse", `${lease.baseSha}^{tree}`].join("\0"), `${sha("3")}\n`],
    [["rev-parse", `${lease.reviewHeadSha}^`].join("\0"), `${lease.fenceSha}\n`],
    [["diff", "--name-only", lease.fenceSha, lease.reviewHeadSha, "--"].join("\0"), "src/file.mjs\n"],
  ]);
  return {
    claim, claims: [claim], lease,
    git: args => {
      const result = responses.get(args.join("\0"));
      if (result === undefined) throw new Error(`Unexpected git call: ${args.join(" ")}`);
      return result;
    },
    leaseStore: { read: () => ({ leases: { [branch]: lease } }) }, sourceRoot,
  };
}
