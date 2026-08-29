import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createIntegratedPreservedDraftRecoveryPlan,
} from "../scripts/integrated-preserved-draft-recovery-contract.mjs";
import {
  createRepositoryIntegratedPreservedDraftRecoveryAdapter,
} from "../scripts/integrated-preserved-draft-recovery-repository-adapter.mjs";
import {
  createTaskAuthorityBinding,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  readTaskAuthorityCapability,
  writeTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-store.mjs";
import {
  projectWriterLeasePullRequestMarker,
} from "../scripts/writer-lease-lib.mjs";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const CLAIM_ID = "c".repeat(64);
const WRITE_SET_DIGEST = "d".repeat(64);
const BRANCH = "agent/device.local/scope";
const SESSION_ID = "source-session";
const PULL_REQUEST_URL = "https://github.com/owner/repo/pull/1";
const WRITE_SET = ["path:scripts/example.mjs", "semantic:scope"];
const CAPABILITY_ROOT = realpathSync(
  mkdtempSync(path.join(os.tmpdir(), "integrated-draft-capability-")),
);
const CAPABILITY_PATH = path.join(CAPABILITY_ROOT, "task-authority.json");
writeTaskAuthorityCapability({ outputPath: CAPABILITY_PATH });
const CAPABILITY = readTaskAuthorityCapability(CAPABILITY_PATH);

function integration() {
  return {
    candidateRevision: HEAD_SHA,
    reviewRequestId: "github-pull-request:PR_1",
    focusedEvidenceDigest: "1".repeat(64),
    dependencyClosureDigest: "2".repeat(64),
    namedChecksDigest: "3".repeat(64),
    handoffEvidenceDigest: "4".repeat(64),
    operatorDecisionDigest: "5".repeat(64),
    integrationIntentDigest: "6".repeat(64),
    integratedAt: "2026-08-29T00:00:00.000Z",
  };
}

function claim(overrides = {}) {
  return {
    claimId: CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "integrated-preserved",
    actorId: "github-user:1",
    repositoryId: "github-repository:R_test",
    workItemId: `work-item:${"7".repeat(64)}`,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: HEAD_SHA,
    declaredWriteScope: WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 7,
    transitionCounter: 6,
    heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_1",
    predecessorClaimId: "8".repeat(64),
    expiresAt: "2026-08-29T01:00:00.000Z",
    fenceRevision: "9".repeat(64),
    transitionDigest: "0".repeat(64),
    operationReceiptDigest: "a".repeat(64),
    integrationReceiptDigest: "b".repeat(64),
    integration: integration(),
    writeAuthority: false,
    scopeReserved: true,
    ...overrides,
  };
}

function lease(overrides = {}) {
  const source = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    branch: BRANCH,
    scope: "scope",
    sessionId: SESSION_ID,
    device: "device.local",
    baseSha: BASE_SHA,
    fenceSha: HEAD_SHA,
    reviewHeadSha: HEAD_SHA,
    pullRequestUrl: PULL_REQUEST_URL,
    epoch: 7,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-28T23:30:00.000Z",
    expiresAt: "2026-08-29T00:00:00.000Z",
    admission: {
      status: "admitted",
      declaredWriteSet: WRITE_SET,
      writeSetDigest: WRITE_SET_DIGEST,
      manifestDigest: "2".repeat(64),
    },
    cloudAuthority: authority(),
    ...overrides,
  };
  const taskAuthority = Object.hasOwn(overrides, "taskAuthority")
    ? overrides.taskAuthority
    : createTaskAuthorityBinding({
      capability: CAPABILITY,
      lease: source,
      boundAt: "2026-08-28T23:00:00.000Z",
    });
  return taskAuthority ? { ...source, taskAuthority } : source;
}

function authority(overrides = {}) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/repo",
    claimId: CLAIM_ID,
    claimDigest: "f".repeat(64),
    claimLedgerRevision: "0".repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    canonicalBaseSha: BASE_SHA,
    laneRevision: HEAD_SHA,
    cloudDeclaredWriteScope: WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    deviceId: "device.local",
    sessionId: SESSION_ID,
    reviewRequestId: "github-pull-request:PR_1",
    leaseEpoch: 7,
    transitionCounter: 5,
    state: "review_ready",
    expiresAt: "2026-08-29T00:00:00.000Z",
    focusedEvidenceDigest: "1".repeat(64),
    operationReceiptDigest: "e".repeat(64),
    ...overrides,
  };
}

function provider(isDraft = true, overrides = {}) {
  return {
    id: "PR_1",
    number: 1,
    url: PULL_REQUEST_URL,
    title: "Exact recovery",
    body: "<!-- writer-lease -->",
    state: "OPEN",
    isDraft,
    autoMergeRequest: null,
    author: { login: "owner" },
    headRefName: BRANCH,
    headRefOid: HEAD_SHA,
    headRepository: { nameWithOwner: "owner/repo" },
    headRepositoryOwner: { login: "owner" },
    baseRefName: "main",
    baseRefOid: BASE_SHA,
    ...overrides,
  };
}

function lane(isDraft = true, overrides = {}, sourceLease = lease()) {
  return {
    repository: "/repo",
    branch: BRANCH,
    headSha: HEAD_SHA,
    refreshedHeadSha: null,
    remoteHeadSha: HEAD_SHA,
    clean: true,
    baseSha: BASE_SHA,
    lease: sourceLease,
    manifest: sourceLease.admission,
    authority: sourceLease.cloudAuthority,
    protectedMainRefresh: false,
    pullRequest: {
      id: "PR_1",
      url: PULL_REQUEST_URL,
      state: "OPEN",
      isDraft,
      autoMergeRequest: null,
      headRefName: BRANCH,
      headRefOid: HEAD_SHA,
      baseRefName: "main",
      body: "<!-- writer-lease -->",
      authorLogin: "owner",
    },
    remoteLease: projectWriterLeasePullRequestMarker(sourceLease),
    ...overrides,
  };
}

function repositoryAdapter({
  draft = true,
  laneOverrides = {},
  claimOverrides = {},
  providerOverrides = {},
  readProvider = null,
  run = () => "ready",
  withFence = (_options, action) => action(),
  sourceLease = lease(),
  leaseStore = null,
  repository = "/repo",
  commonDirectory = "/repo.git",
  taskAuthorityFile = CAPABILITY_PATH,
  resolveRealpath = value => value,
} = {}) {
  const sourceLane = lane(draft, laneOverrides, sourceLease);
  const sourceClaim = claim(claimOverrides);
  const sourceLeaseStore = leaseStore || { read: () => sourceLease };
  const baseAdapter = {
    async readPreservedReviewLane() { return sourceLane; },
    async readCloudStatus() {
      return {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "status",
        status: "ready",
        repositoryId: "github-repository:R_test",
        claims: [sourceClaim],
      };
    },
    async readAuthenticatedOwner() { return { id: 1, login: "owner" }; },
  };
  return createRepositoryIntegratedPreservedDraftRecoveryAdapter({
    repository,
    sessionId: SESSION_ID,
    taskAuthorityFile,
    baseAdapter,
    leaseStore: sourceLeaseStore,
    gitText: argumentsList => {
      if (argumentsList.join(" ") === "rev-parse --git-common-dir") return commonDirectory;
      throw new Error(`Unexpected Git call: ${argumentsList.join(" ")}`);
    },
    readProvider: readProvider || (() => provider(draft, providerOverrides)),
    run,
    withFence,
    resolveRealpath,
  });
}

test("repository capture accepts exactly the draft-only integrated replay finding", async () => {
  const adapter = repositoryAdapter();
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  const plan = createIntegratedPreservedDraftRecoveryPlan(state);
  assert.equal(state.pullRequestDraft, true);
  assert.equal(state.remoteClaimState, "integrated-preserved");
  assert.equal(state.remoteClaimWriteAuthority, false);
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.findings, []);
});

test("ready recapture preserves the same sealed identity and removes all handoff findings", async () => {
  const draftState = await repositoryAdapter().readState({
    branch: BRANCH,
    sessionId: SESSION_ID,
  });
  const readyState = await repositoryAdapter({ draft: false }).readState({
    branch: BRANCH,
    sessionId: SESSION_ID,
  });
  assert.equal(
    createIntegratedPreservedDraftRecoveryPlan(draftState).planDigest,
    createIntegratedPreservedDraftRecoveryPlan(readyState).planDigest,
  );
});

test("unrelated handoff findings fail before any provider mutation", async () => {
  const adapter = repositoryAdapter({
    laneOverrides: { clean: false },
  });
  await assert.rejects(
    adapter.readState({ branch: BRANCH, sessionId: SESSION_ID }),
    /unrelated findings: .*dirty-preserved-lane/u,
  );
});

test("provider identity drift fails closed during the same capture", async () => {
  const adapter = repositoryAdapter({
    providerOverrides: { headRefOid: "c".repeat(40) },
  });
  await assert.rejects(
    adapter.readState({ branch: BRANCH, sessionId: SESSION_ID }),
    /identity changed during exact-state capture/u,
  );
});

test("provider projection invokes only the exact controller-owned ready command", async () => {
  const calls = [];
  const adapter = repositoryAdapter({
    run(command, argumentsList) {
      calls.push([command, argumentsList]);
      return "Pull request marked ready";
    },
  });
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  const plan = createIntegratedPreservedDraftRecoveryPlan(state);
  const result = await adapter.projectPullRequestReady({ state, planDigest: plan.planDigest });
  assert.deepEqual(calls, [["gh", ["pr", "ready", PULL_REQUEST_URL]]]);
  assert.match(result.operationDigest, /^[0-9a-f]{64}$/u);
});

test("provider projection rejects an unsealed or wrong plan before invoking GitHub", async () => {
  const calls = [];
  const adapter = repositoryAdapter({
    run(command, argumentsList) { calls.push([command, argumentsList]); },
  });
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  await assert.rejects(
    adapter.projectPullRequestReady({ state, planDigest: "not-sealed" }),
    /plan digest must be a digest/u,
  );
  await assert.rejects(
    adapter.projectPullRequestReady({ state, planDigest: "1".repeat(64) }),
    /does not match the sealed draft plan/u,
  );
  assert.deepEqual(calls, []);
});

test("fresh provider drift after task proof stops before the ready command", async () => {
  const calls = [];
  let providerReads = 0;
  const adapter = repositoryAdapter({
    readProvider() {
      providerReads += 1;
      return provider(true, providerReads === 1 ? {} : { body: "drifted body" });
    },
    run(command, argumentsList) { calls.push([command, argumentsList]); },
  });
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  const plan = createIntegratedPreservedDraftRecoveryPlan(state);
  await assert.rejects(
    adapter.projectPullRequestReady({ state, planDigest: plan.planDigest }),
    /identity changed during exact-state capture/u,
  );
  assert.deepEqual(calls, []);
});

test("the complete remote marker must retain the local task binding", async () => {
  const sourceLease = lease();
  const remoteLease = structuredClone(projectWriterLeasePullRequestMarker(sourceLease));
  delete remoteLease.taskAuthority;
  const adapter = repositoryAdapter({
    sourceLease,
    laneOverrides: { remoteLease },
  });
  await assert.rejects(
    adapter.readState({ branch: BRANCH, sessionId: SESSION_ID }),
    /exact task-bound owner marker/u,
  );
});

test("task capability must remain outside the worktree and Git common directory", () => {
  for (const taskAuthorityFile of [
    "/repo/task-authority.json",
    "/repo.git/task-authority.json",
  ]) {
    assert.throws(
      () => repositoryAdapter({ taskAuthorityFile }),
      /outside the repository and Git common directory/u,
    );
  }
  assert.throws(
    () => repositoryAdapter({ taskAuthorityFile: "relative-authority.json" }),
    /must be absolute/u,
  );
});

test("entrypoint fence binds the exact lease, claim, and plan identity", async () => {
  let observed = null;
  const adapter = repositoryAdapter({
    withFence(options, action) {
      observed = options;
      return action();
    },
  });
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  const value = await adapter.withOperationFence({
    state,
    planDigest: "1".repeat(64),
  }, () => "inside");
  assert.equal(value, "inside");
  assert.deepEqual(observed, {
    leaseStore: { read: observed.leaseStore.read },
    branch: BRANCH,
    entrypoint: "integrated-preserved-draft-recovery",
    operationDigest: "1".repeat(64),
    expectedLeaseDigest: state.localLeaseDigest,
    expectedClaimId: CLAIM_ID,
  });
});

test("task authorization rejects lease drift before capability evaluation", async () => {
  const sourceLease = lease();
  const adapter = repositoryAdapter({
    sourceLease,
    leaseStore: { read: () => lease({ epoch: 8 }) },
  });
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  assert.throws(
    () => adapter.authorizeTask({ state, planDigest: "1".repeat(64) }),
    /writer lease changed before provider projection/u,
  );
});

test("task authorization verifies a real external capability and matching binding", async () => {
  const sourceLease = lease();
  const adapter = repositoryAdapter({ sourceLease });
  const state = await adapter.readState({ branch: BRANCH, sessionId: SESSION_ID });
  const plan = createIntegratedPreservedDraftRecoveryPlan(state);
  const receipt = adapter.authorizeTask({ state, planDigest: plan.planDigest });
  assert.equal(receipt.status, "verified");
  assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/u);
});
