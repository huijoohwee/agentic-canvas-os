import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { advanceReviewedCiRevisionIntent, authorizeReviewedCiRevision,
  buildReviewedCiRevisionPhaseSnapshot, buildReviewedCiRevisionPlan,
  createReviewedCiRevisionIntent, createReviewedCiRevisionPullRequestBootstrap,
  reviewedCiRevisionOperationKey, reviewedCiRevisionProviderBoundaryDigest } from "../scripts/reviewed-ci-revision-contract.mjs";
import { projectReviewedCiSourceMarker, runReviewedCiRevisionRecovery } from "../scripts/reviewed-ci-revision-controller.mjs";
import { createReviewedCiRevisionRepositoryAdapter } from "../scripts/reviewed-ci-revision-repository-adapter.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";
import {
  assertGitHubPullQueueFence,
  assertGitHubPullRequestBounds,
  buildReviewedCiFailureEvidence,
  closeGitHubPullWithReconciliation,
  createGitHubPullWithReconciliation,
  normalizeReviewedCiFailureEvidence,
  readGitHubOpenPullSubjects,
  readGitHubReviewedCiFailureSubject,
} from "../scripts/reviewed-ci-revision-evidence.mjs";
const head = "b".repeat(40), base = "a".repeat(40), D = value => String(value).repeat(64);
export function evidenceFixture({ draft = false } = {}) {
  const pullRequest = {
    number: 344, nodeId: "PR_node", state: "OPEN", isDraft: draft,
    branch: "agent/device/reviewed-ci", headSha: head,
    baseRef: "main", baseSha: base, authorLogin: "owner",
    restAutoMergeRequest: null, autoMergeRequest: null,
    isInMergeQueue: false, mergeQueueEntry: null,
    headRepository: { full_name: "owner/repository", id: 1, node_id: "R_node" },
    baseRepository: { full_name: "owner/repository", id: 1, node_id: "R_node" },
  };
  const checkRun = {
    id: 10, name: "test", head_sha: head, status: "completed", conclusion: "failure",
    started_at: "2026-08-09T00:00:01.000Z", completed_at: "2026-08-09T00:00:02.000Z",
    created_at: "2026-08-09T00:00:00.000Z",
    details_url: "https://github.com/owner/repository/actions/runs/20/job/10",
    external_id: "job:10", app: { id: 15368, slug: "github-actions" },
    check_suite: { id: 11 },
    pull_requests: [{
      number: 344, head: { sha: head, ref: pullRequest.branch },
      base: { sha: base, ref: "main" },
    }],
  };
  return {
    repository: { full_name: "owner/repository", id: 1, node_id: "R_node" },
    actor: { id: 2, login: "owner" },
    pullRequest,
    checkRun,
    checkRunInventory: { complete: true, totalCount: 1, pageCount: 1, items: [checkRun] },
    requiredStatusChecks: {
      repository: "owner/repository", branch: "main", strict: true,
      contexts: ["test"], checks: [{ context: "test", app_id: 15368 }],
    },
    workflowRun: {
      id: 20, workflow_id: 21, path: ".github/workflows/ci.yml", event: "pull_request",
      head_branch: pullRequest.branch, head_sha: head, status: "completed", conclusion: "failure",
      run_attempt: 1,
      repository: { id: 1, node_id: "R_node", full_name: "owner/repository" },
    },
    workflowJob: {
      id: 10, run_id: 20, name: "test", head_sha: head,
      status: "completed", conclusion: "failure",
    },
    expectedDraft: draft,
  };
}
function readerFixture() {
  const evidence = evidenceFixture();
  const repository = evidence.repository;
  const pull = evidence.pullRequest;
  const restPull = {
    number: pull.number, node_id: pull.nodeId,
    html_url: "https://github.com/owner/repository/pull/344", state: "open",
    draft: pull.isDraft, title: "fix: reviewed CI", body: "Human context",
    labels: [],
    head: { ref: pull.branch, sha: pull.headSha, repo: repository },
    base: { ref: pull.baseRef, sha: pull.baseSha, repo: repository },
    user: { login: pull.authorLogin }, auto_merge: null, closed_at: null, merged_at: null,
  };
  const graphPull = {
    id: pull.nodeId, number: pull.number, url: restPull.html_url, state: "OPEN",
    isDraft: pull.isDraft, title: restPull.title, body: restPull.body,
    headRefName: pull.branch, headRefOid: pull.headSha,
    baseRefName: pull.baseRef, baseRefOid: pull.baseSha,
    author: { login: pull.authorLogin },
    labels: { nodes: [], pageInfo: { hasNextPage: false } },
    headRepository: { id: repository.node_id, databaseId: repository.id,
      nameWithOwner: repository.full_name },
    baseRepository: { id: repository.node_id, databaseId: repository.id,
      nameWithOwner: repository.full_name },
    reviewDecision: null, reviews: { totalCount: 0 },
    autoMergeRequest: null, isInMergeQueue: false, mergeQueueEntry: null,
    closedAt: null, mergedAt: null,
  };
  return { evidence, restPull, graph: { data: { repository: {
    id: repository.node_id, databaseId: repository.id, nameWithOwner: repository.full_name,
    pullRequest: graphPull,
  } } } };
}
function readerGh(fixture) {
  return args => {
    const command = args.join(" ");
    if (command.startsWith("repo view ")) return "owner/repository";
    if (command === "api repos/owner/repository") return JSON.stringify(fixture.evidence.repository);
    if (command === "api user") return JSON.stringify(fixture.evidence.actor);
    if (command === "api repos/owner/repository/pulls/344") return JSON.stringify(fixture.restPull);
    if (command.startsWith("api --method GET repos/owner/repository/pulls ")) {
      return JSON.stringify([fixture.restPull]);
    }
    if (command.startsWith("api graphql ")) return JSON.stringify(fixture.graph);
    if (command.startsWith("api repos/owner/repository/check-runs/10 ")) {
      return JSON.stringify(fixture.evidence.checkRun);
    }
    if (command.includes("commits/") && command.includes("/check-runs")) {
      return JSON.stringify({ total_count: 1, check_runs: [fixture.evidence.checkRun] });
    }
    if (command.endsWith("branches/main/protection/required_status_checks")) {
      return JSON.stringify(fixture.evidence.requiredStatusChecks);
    }
    if (command === "api repos/owner/repository/actions/runs/20") {
      return JSON.stringify(fixture.evidence.workflowRun);
    }
    if (command === "api repos/owner/repository/actions/jobs/10") {
      return JSON.stringify(fixture.evidence.workflowJob);
    }
    throw new Error(`Unexpected gh command: ${command}`);
  };
}
function stageIntent(intent, plan, status, field, values) {
  const snapshot = buildReviewedCiRevisionPhaseSnapshot({ phase: status, plan, values });
  return advanceReviewedCiRevisionIntent(intent, { status, values: { [field]: snapshot } });
}
function successorClaim(plan, source, overrides = {}) {
  return { claimId: D(6), state: "waiting-successor", actorId: plan.sourceActorId,
    deviceId: plan.sourcePrivateDeviceId, sessionId: plan.sourcePrivateSessionId,
    repositoryId: plan.sourceRepositoryId, workItemId: plan.sourceWorkItemId,
    canonicalBaseRevision: plan.successorCanonicalBaseSha, laneRevision: plan.sourceHeadSha,
    declaredWriteScope: plan.declaredWriteSet, writeSetDigest: plan.writeSetDigest,
    leaseEpoch: plan.successorCloudLeaseEpoch, predecessorClaimId: plan.sourceClaimId,
    transitionCounter: 4, reviewRequestId: null, expiresAt: source.authority.expiresAt,
    fenceRevision: D(7), transitionDigest: D(8), entrySchema: source.claim.entrySchema,
    claimIdentitySchema: source.claim.claimIdentitySchema, operationReceiptDigest: D(9),
    integrationReceiptDigest: null, integration: null, ...overrides };
}
function authorityForClaim(plan, source, claim, overrides = {}) {
  return { ...source.authority, claimId: claim.claimId, claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest, canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision, cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter, state: "active", reviewRequestId: claim.reviewRequestId,
    operationReceiptDigest: claim.operationReceiptDigest, integrationReceiptDigest: null, integration: null,
    focusedEvidenceDigest: null, deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId, ...overrides };
}
function claimPhaseValues(plan, claim, operation, overrides = {}) {
  return { operationKey: reviewedCiRevisionOperationKey(plan, operation), claimId: claim.claimId,
    claimDigest: claim.fenceRevision, transitionCounter: claim.transitionCounter,
    operationReceiptDigest: claim.operationReceiptDigest, requestDigest: D(2), receiptDigest: D(3),
    ledgerDigest: D(4), state: claim.state, canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision, leaseEpoch: claim.leaseEpoch, ...overrides };
}
function cloudMutationResult(claim, operationKey) {
  return { claim, claimDigest: claim.fenceRevision, ledgerRevision: "c".repeat(40), ledgerDigest: D("c"),
    receipt: { receiptDigest: D("d"), ledgerDigest: D("c") }, operationReceipt: {
      operation: "continue", idempotencyKey: digestValue(operationKey), requestDigest: D("e"),
      receiptDigest: claim.operationReceiptDigest } };
}
async function productionAdapterFixture({ allowExecution = false } = {}) {
  const { sourceFixture } = await import("./reviewed-ci-revision-contract.test.mjs");
  const directory = mkdtempSync(path.join(os.tmpdir(), "reviewed-ci-provider-"));
  const source = sourceFixture();
  source.lease.worktreePath = directory;
  const writerMarker = projectWriterLeasePullRequestMarker(source.lease);
  const body = `Human context\n\n<!-- agentic-writer-lease/v2 ${JSON.stringify(writerMarker)} -->`;
  source.pullRequest.body = body;
  source.pullRequestBodyDigest = digestValue(body);
  source.writerMarkerDigest = digestValue(writerMarker);
  source.leaseDigest = digestValue(source.lease);
  const plan = buildReviewedCiRevisionPlan({ source });
  const authorization = authorizeReviewedCiRevision({ plan,
    authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}` });
  let intent = createReviewedCiRevisionIntent(plan, authorization);
  const identity = { fullName: plan.repository, id: plan.failureEvidence.repositoryId,
    nodeId: plan.failureEvidence.repositoryNodeId };
  const lifecycle = pull => ({ labels: [], reviewDecision: null, reviewsTotalCount: 0,
    closedAt: null, mergedAt: null,
    restAutoMergeRequest: null, autoMergeRequest: null, isInMergeQueue: false,
    mergeQueueEntry: null, headRepository: identity, baseRepository: identity, ...pull });
  const pulls = new Map([[plan.pullRequestNumber, lifecycle(source.pullRequest)]]);
  const statePath = path.join(directory, "writer-leases.json");
  const writeRegistry = registry => writeFileSync(statePath, `${JSON.stringify(registry, null, 2)}\n`);
  writeRegistry({ schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [plan.sourceBranch]: source.lease },
    reviewedCiRevisionRecoveries: { [plan.sourceBranch]: intent } });
  const readRegistry = () => JSON.parse(readFileSync(statePath, "utf8"));
  const leaseStore = { statePath, readRegistry, read: branch => readRegistry().leases[branch],
    withRegistryLock: action => action(readRegistry()) };
  const state = { publicClaims: [source.claim], privateClaims: [source.claim], closeCalls: 0,
    createCalls: 0, editCalls: 0, hardStopCalls: 0, closeResponseLoss: false,
    createResponseLoss: false, cloud: null, verifyActive: null };
  const replacement = ({ title, body: replacementBody }) => lifecycle({ number: 345,
    nodeId: "PR_replacement", url: "https://github.com/owner/repository/pull/345",
    title, body: replacementBody, branch: plan.sourceBranch, headSha: plan.sourceHeadSha,
    baseRef: "main", baseSha: plan.observedProtectedMainSha, authorLogin: plan.pullRequestAuthorLogin,
    state: "OPEN", isDraft: true });
  const runtime = { leaseStore,
    readLocal: () => ({ root: directory, branch: plan.sourceBranch,
      identity: { device: plan.sourceDeviceId }, identityDigest: plan.sourceWorktreeIdentityDigest,
      originRepository: plan.sourceOriginRepository, headSha: plan.sourceHeadSha,
      treeSha: plan.sourceTreeSha, clean: true, remoteHeadSha: plan.sourceHeadSha,
      remoteMainSha: plan.observedProtectedMainSha }),
    readProtectedMainAdvance: () => plan.protectedMainAdvance,
    readProvider: () => { const pullRequest = pulls.get(plan.pullRequestNumber);
      const evidenceInput = evidenceFixture();
      evidenceInput.pullRequest = { ...evidenceInput.pullRequest, state: pullRequest.state,
        isDraft: pullRequest.isDraft, restAutoMergeRequest: pullRequest.restAutoMergeRequest,
        autoMergeRequest: pullRequest.autoMergeRequest, isInMergeQueue: pullRequest.isInMergeQueue,
        mergeQueueEntry: pullRequest.mergeQueueEntry };
      return { repository: { full_name: plan.repository }, pullRequest, evidenceInput }; },
    readPull: number => pulls.get(number),
    listOpenPulls: branch => [...pulls.values()].filter(pull => pull.branch === branch && pull.state === "OPEN"),
    closePull: () => { state.closeCalls += 1; const pull = pulls.get(plan.pullRequestNumber);
      pulls.set(plan.pullRequestNumber, { ...pull, state: "CLOSED", closedAt: "2026-08-09T00:00:03.000Z" });
      if (state.closeResponseLoss) throw new Error("close response lost"); },
    createPull: input => { state.createCalls += 1; const pull = replacement(input); pulls.set(pull.number, pull);
      if (state.createResponseLoss) throw new Error("create response lost"); return pull.url; },
    editPullBody: (url, nextBody) => { state.editCalls += 1; const pull = [...pulls.values()].find(value => value.url === url);
      pulls.set(pull.number, { ...pull, body: nextBody }); },
    readCloud: () => ({ claims: state.publicClaims, ledgerDigest: D("a") }),
    listPrivateClaims: async () => state.privateClaims,
    cloud: (...args) => state.cloud?.(...args),
    verifyActive: input => state.verifyActive?.(input) || { authority: input.authority,
      verification: { receiptDigest: D("f"), verifiedAt: "2026-08-09T00:00:01.000Z" } },
    requireSharedEntrypointFence: () => { state.hardStopCalls += 1;
      if (!allowExecution) throw new Error("protected shared-entrypoint hard stop"); } };
  const adapter = createReviewedCiRevisionRepositoryAdapter({ repository: directory,
    sessionId: plan.sourceSessionId, pullRequestNumber: plan.pullRequestNumber,
    checkRunId: plan.failureEvidence.checkRunId }, { runtime });
  const persistIntent = next => { const registry = readRegistry();
    registry.reviewedCiRevisionRecoveries[plan.sourceBranch] = next; writeRegistry(registry); intent = next; };
  return { adapter, source, plan, get intent() { return intent; }, persistIntent, state, pulls,
    replacement, readRegistry, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
test("binds the exact required GitHub Actions failure and normalizes its digest", () => {
  const evidence = buildReviewedCiFailureEvidence(evidenceFixture());
  assert.equal(evidence.checkRunId, 10);
  assert.equal(evidence.branchProtectionRepository, "owner/repository");
  assert.deepEqual(normalizeReviewedCiFailureEvidence(evidence), evidence);
});
test("normalizes GitHub UTC seconds without requiring synthetic milliseconds", () => {
  const input = evidenceFixture();
  input.checkRun.created_at = null;
  input.checkRun.started_at = "2026-08-09T00:00:01Z";
  input.checkRun.completed_at = "2026-08-09T00:00:02Z";
  const evidence = buildReviewedCiFailureEvidence(input);
  assert.equal(evidence.startedAt, "2026-08-09T00:00:01.000Z");
  assert.equal(evidence.completedAt, "2026-08-09T00:00:02.000Z");
});
test("draft revalidation preserves immutable evidence identity", () => {
  const ready = buildReviewedCiFailureEvidence(evidenceFixture());
  const draft = buildReviewedCiFailureEvidence(evidenceFixture({ draft: true }));
  assert.equal(draft.evidenceDigest, ready.evidenceDigest);
});
test("rejects incomplete inventory and a queued newer rerun with no start time", () => {
  const incomplete = evidenceFixture();
  incomplete.checkRunInventory.complete = false;
  assert.throws(() => buildReviewedCiFailureEvidence(incomplete), /incomplete/);
  const rerun = evidenceFixture();
  rerun.checkRunInventory.items.push({
    ...rerun.checkRun, id: 12, status: "queued", conclusion: null,
    created_at: "2026-08-09T00:00:03.000Z", started_at: null, completed_at: null,
  });
  rerun.checkRunInventory.totalCount = 2;
  assert.throws(() => buildReviewedCiFailureEvidence(rerun), /newer attempt|queued/);
});
test("rejects a protection snapshot from another repository or branch", () => {
  const fixture = evidenceFixture();
  fixture.requiredStatusChecks.repository = "foreign/repository";
  assert.throws(() => buildReviewedCiFailureEvidence(fixture), /does not bind/);
});
test("reader joins exact REST and GraphQL PR identity and queue fences", () => {
  const fixture = readerFixture();
  const subject = readGitHubReviewedCiFailureSubject({
    gh: readerGh(fixture), pullRequestNumber: 344, checkRunId: 10,
  });
  assert.equal(subject.pullRequest.url, "https://github.com/owner/repository/pull/344");
  assert.equal(buildReviewedCiFailureEvidence(subject.evidenceInput).evidenceDigest.length, 64);
});
test("reader rejects GraphQL errors, missing queue fields, and REST identity drift", () => {
  const errors = readerFixture();
  errors.graph.errors = [{ message: "denied" }];
  assert.throws(() => readGitHubReviewedCiFailureSubject({
    gh: readerGh(errors), pullRequestNumber: 344, checkRunId: 10,
  }), /contains errors/);
  const missingQueue = readerFixture();
  delete missingQueue.graph.data.repository.pullRequest.isInMergeQueue;
  assert.throws(() => readGitHubReviewedCiFailureSubject({
    gh: readerGh(missingQueue), pullRequestNumber: 344, checkRunId: 10,
  }), /merge-queue state is missing/);
  const fork = readerFixture();
  fork.restPull.head.repo = { ...fork.evidence.repository, full_name: "foreign/repository" };
  assert.throws(() => readGitHubReviewedCiFailureSubject({
    gh: readerGh(fork), pullRequestNumber: 344, checkRunId: 10,
  }), /fence drifted/);
});
test("evidence rejects either auto-merge source and every active queue signal", () => {
  for (const mutate of [
    fixture => { fixture.restPull.auto_merge = { enabled_at: "now" }; },
    fixture => { fixture.graph.data.repository.pullRequest.autoMergeRequest = { enabledAt: "now" }; },
    fixture => { fixture.graph.data.repository.pullRequest.isInMergeQueue = true; },
    fixture => { fixture.graph.data.repository.pullRequest.mergeQueueEntry = { id: "MQ" }; },
  ]) {
    const fixture = readerFixture();
    mutate(fixture);
    const subject = readGitHubReviewedCiFailureSubject({
      gh: readerGh(fixture), pullRequestNumber: 344, checkRunId: 10,
    });
    assert.throws(() => buildReviewedCiFailureEvidence(subject.evidenceInput), /expected pull-request state/);
  }
});
test("open inventory and lifecycle reads retain one canonical REST plus GraphQL identity", () => {
  const fixture = readerFixture();
  const pulls = readGitHubOpenPullSubjects({
    gh: readerGh(fixture), branch: "agent/device/reviewed-ci",
  });
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].nodeId, "PR_node");
  const wrongBase = readerFixture();
  wrongBase.restPull.base.ref = "release";
  wrongBase.graph.data.repository.pullRequest.baseRefName = "release";
  assert.throws(() => readGitHubOpenPullSubjects({
    gh: readerGh(wrongBase), branch: "agent/device/reviewed-ci",
  }), /escaped its exact head\/base filter/);
  const wrongUrl = readerFixture();
  wrongUrl.restPull.html_url = "https://github.com/owner/repository/pull/999";
  wrongUrl.graph.data.repository.pullRequest.url = wrongUrl.restPull.html_url;
  assert.throws(() => readGitHubReviewedCiFailureSubject({
    gh: readerGh(wrongUrl), pullRequestNumber: 344, checkRunId: 10,
  }), /not canonical/);
});
test("queue and generated-body fences fail closed", () => {
  const clear = { restAutoMergeRequest: null, autoMergeRequest: null,
    isInMergeQueue: false, mergeQueueEntry: null };
  assert.equal(assertGitHubPullQueueFence(clear), clear);
  for (const value of [
    { ...clear, restAutoMergeRequest: {} }, { ...clear, autoMergeRequest: {} },
    { ...clear, isInMergeQueue: true }, { ...clear, mergeQueueEntry: {} },
  ]) assert.throws(() => assertGitHubPullQueueFence(value), /authority/);
  assert.doesNotThrow(() => assertGitHubPullRequestBounds({ title: "Revision", body: "small" }));
  assert.throws(() => assertGitHubPullRequestBounds({ title: "Revision",
    body: "x".repeat(65_537) }), /exceeds/);
});
test("close reconciliation adopts only exact response-loss closure", () => {
  const events = [];
  let current = { number: 344, state: "OPEN", closedAt: null, body: "same" };
  const result = closeGitHubPullWithReconciliation({
    readPull: () => { events.push(`read:${current.state}`); return current; },
    readFreshEvidence: () => { events.push("fresh-failure"); return current; },
    closePull: () => { events.push("close"); current = { ...current,
      state: "CLOSED", closedAt: "2026-08-09T00:00:03.000Z" }; throw new Error("lost"); },
    validateOpen: pull => { assert.equal(pull.state, "OPEN"); return pull; },
    validateClosed: pull => { assert.equal(pull.state, "CLOSED"); return pull; },
  });
  assert.equal(result.disposition, "reconciled-response-loss");
  assert.deepEqual(events, ["read:OPEN", "fresh-failure", "close", "read:CLOSED"]);
  events.length = 0;
  const adopted = closeGitHubPullWithReconciliation({ readPull: () => current,
    readFreshEvidence: () => { events.push("fresh-closed"); return current; }, closePull: () => assert.fail(),
    validateOpen: () => assert.fail(), validateClosed: pull => pull });
  assert.equal(adopted.disposition, "adopted-existing");
  assert.deepEqual(events, ["fresh-closed"]);
});
test("create reconciliation adopts one exact draft after response loss", () => {
  const candidate = { number: 345, url: "https://github.com/owner/repository/pull/345" };
  let pulls = [], creates = 0;
  const result = createGitHubPullWithReconciliation({
    listPulls: () => pulls,
    createPull: () => { creates += 1; pulls = [candidate]; throw new Error("lost"); },
    validatePull: pull => { assert.equal(pull, candidate); return pull; },
  });
  assert.equal(result.pull, candidate);
  assert.equal(result.disposition, "reconciled-response-loss");
  assert.equal(creates, 1);
  assert.throws(() => createGitHubPullWithReconciliation({
    listPulls: () => [candidate, { ...candidate, number: 346 }], createPull: () => {},
    validatePull: pull => pull,
  }), /ambiguous/);
});
test("production reconciliation is pending or adopts the exact intent marker key", async () => {
  const fixture = await productionAdapterFixture({ allowExecution: true });
  try {
    const operationKey = `reviewed-ci-revision:${fixture.plan.planDigest}:intent-marker`;
    const context = { plan: fixture.plan, intent: fixture.intent, phase: "source-marker",
      method: "projectRecoveryIntent", operationKey };
    assert.deepEqual(await fixture.adapter.reconcileTransition(context), { kind: "pending" });
    const projection = projectReviewedCiSourceMarker(fixture.plan, fixture.source.lease);
    const pull = fixture.pulls.get(fixture.plan.pullRequestNumber);
    fixture.pulls.set(pull.number, { ...pull, body: projection.body });
    const ahead = await fixture.adapter.reconcileTransition(context);
    assert.equal(ahead.kind, "response-ahead");
    assert.equal(ahead.operationKey, operationKey);
    assert.equal(ahead.values.operationKey, operationKey);
  } finally { fixture.cleanup(); }
});
test("production stored replay cannot bypass the protected execution fence", async () => {
  const fixture = await productionAdapterFixture();
  try {
    await assert.rejects(runReviewedCiRevisionRecovery({
      authorization: `authorize reviewed-ci-revision-recovery ${fixture.plan.planDigest}`,
    }, { adapter: fixture.adapter }), /hard stop/);
    assert.equal(fixture.state.hardStopCalls, 1);
    assert.deepEqual([fixture.state.editCalls, fixture.state.closeCalls, fixture.state.createCalls], [0, 0, 0]);
  } finally { fixture.cleanup(); }
});
test("every exported production mutator honors the protected execution fence", async () => {
  const fixture = await productionAdapterFixture();
  try {
    const input = { plan: fixture.plan, intent: fixture.intent, next: fixture.intent, evidence: {} };
    const methods = ["beginIntent", "advanceIntent", "reconcileTransition", "projectRecoveryIntent", "claimSuccessor",
      "retireSource", "closeSourcePullRequest", "createRevisionPullRequest", "promoteSuccessor",
      "bindSuccessor", "preparePullRequestProjection", "projectPullRequest", "activateLocal",
      "abortDeliveryWon", "archiveRecovery"];
    for (const method of methods) await assert.rejects(fixture.adapter[method](input), /hard stop/);
    assert.equal(fixture.state.hardStopCalls, methods.length);
    assert.deepEqual([fixture.state.editCalls, fixture.state.closeCalls, fixture.state.createCalls], [0, 0, 0]);
  } finally { fixture.cleanup(); }
});
test("production delivery-won abort retires by exact replay and archives without touching the PR", async () => {
  const fixture = await productionAdapterFixture({ allowExecution: true });
  try {
    const deliveryReceipt = D("a");
    const source = { ...fixture.source.claim, state: "integrated-preserved",
      integrationReceiptDigest: deliveryReceipt };
    const derivative = successorClaim(fixture.plan, fixture.source);
    fixture.state.publicClaims = [source, derivative];
    fixture.state.privateClaims = [source, derivative];
    let attempts = 0;
    fixture.state.cloud = (action, _authority, request) => {
      assert.equal(action, "retire");
      assert.equal(request.reason, "abandoned");
      attempts += 1;
      if (attempts === 1) {
        fixture.state.publicClaims = [source];
        fixture.state.privateClaims = [source];
        throw new Error("retirement response lost");
      }
      return { operationReceipt: { operation: "retire",
        idempotencyKey: digestValue(request.idempotencyKey), receiptDigest: D("b") } };
    };
    const result = await runReviewedCiRevisionRecovery({
      authorization: `authorize reviewed-ci-revision-recovery ${fixture.plan.planDigest}`,
    }, { adapter: fixture.adapter });
    assert.equal(result.status, "aborted-delivery-won");
    assert.equal(result.deliveryReceiptDigest, deliveryReceipt);
    assert.equal(attempts, 2);
    const registry = fixture.readRegistry();
    assert.equal(registry.reviewedCiRevisionRecoveries[fixture.plan.sourceBranch], undefined);
    assert.equal(registry.reviewedCiRevisionRecoveryArchives[fixture.plan.planDigest].status,
      "aborted-delivery-won");
    assert.equal(digestValue(registry.leases[fixture.plan.sourceBranch]), fixture.plan.sourceLeaseDigest);
    assert.equal(fixture.state.closeCalls, 0);
    assert.equal(fixture.state.editCalls, 0);
    assert.equal(fixture.pulls.get(fixture.plan.pullRequestNumber).state, "OPEN");
    const replay = await fixture.adapter.readState();
    assert.equal(replay.archive.archiveReceiptDigest, result.archiveReceiptDigest);
  } finally { fixture.cleanup(); }
});
test("production provider mutations reconcile close and create response loss", async () => {
  const fixture = await productionAdapterFixture({ allowExecution: true });
  try {
    const projection = projectReviewedCiSourceMarker(fixture.plan, fixture.source.lease);
    const pull = fixture.pulls.get(fixture.plan.pullRequestNumber);
    fixture.pulls.set(pull.number, { ...pull, body: projection.body });
    let intent = stageIntent(fixture.intent, fixture.plan, "source-marker", "sourceProjection", {
      operationKey: `reviewed-ci-revision:${fixture.plan.planDigest}:intent-marker`,
      pullRequestNodeId: fixture.plan.pullRequestNodeId,
      markerDigest: digestValue(projection.marker), writerMarkerDigest: digestValue(projection.writerMarker),
      bodyDigest: projection.bodyDigest });
    const waiting = successorClaim(fixture.plan, fixture.source);
    intent = stageIntent(intent, fixture.plan, "successor-waiting", "successor",
      claimPhaseValues(fixture.plan, waiting, "claim"));
    intent = stageIntent(intent, fixture.plan, "source-retired", "sourceRetirement", {
      operationKey: reviewedCiRevisionOperationKey(fixture.plan, "retire-source"),
      sourceClaimId: fixture.plan.sourceClaimId, successorClaimId: waiting.claimId,
      receiptDigest: D(7), operationReceiptDigest: D(8), ledgerDigest: D(9), state: "retired" });
    fixture.persistIntent(intent);
    fixture.state.closeResponseLoss = true;
    const closure = await fixture.adapter.closeSourcePullRequest({ plan: fixture.plan, intent });
    assert.equal(closure.providerDisposition, "reconciled-response-loss");
    intent = stageIntent(intent, fixture.plan, "source-pr-closed", "sourcePullRequestClosure", closure);
    fixture.persistIntent(intent);
    fixture.state.createResponseLoss = true;
    const created = await fixture.adapter.createRevisionPullRequest({ plan: fixture.plan, intent });
    assert.equal(created.providerDisposition, "reconciled-response-loss");
    assert.equal(created.state, "OPEN");
    assert.equal(created.isDraft, true);
    assert.equal(fixture.state.closeCalls, 1);
    assert.equal(fixture.state.createCalls, 1);
  } finally { fixture.cleanup(); }
});
test("production bind-ahead keeps operation proof distinct and terminal entry rechecks live margin", async () => {
  const fixture = await productionAdapterFixture({ allowExecution: true });
  try {
    const bootstrap = createReviewedCiRevisionPullRequestBootstrap(fixture.plan);
    const replacement = fixture.replacement(bootstrap);
    fixture.pulls.set(replacement.number, replacement);
    const unbound = successorClaim(fixture.plan, fixture.source, { state: "current",
      transitionCounter: 5, fenceRevision: D("b"), transitionDigest: D("c"), operationReceiptDigest: D("d") });
    const promotedAuthority = authorityForClaim(fixture.plan, fixture.source, unbound);
    const reviewRequestId = `github-pull-request:${replacement.nodeId}`;
    const boundClaim = { ...unbound, transitionCounter: 6, fenceRevision: D("e"),
      transitionDigest: D("f"), operationReceiptDigest: D(1), reviewRequestId };
    const operationKey = `reviewed-ci-revision:${fixture.plan.planDigest}:bind-successor`;
    fixture.state.publicClaims = [boundClaim];
    fixture.state.privateClaims = [boundClaim];
    fixture.state.cloud = () => cloudMutationResult(boundClaim, operationKey);
    const bindIntent = { status: "successor-promoted", promotion: { values: {
      claimId: unbound.claimId, authority: promotedAuthority } },
      replacementPullRequest: { values: { pullRequestNumber: replacement.number,
        pullRequestNodeId: replacement.nodeId, url: replacement.url } } };
    const ahead = await fixture.adapter.reconcileTransition({ plan: fixture.plan, intent: bindIntent,
      phase: "successor-bound", method: "bindSuccessor", operationKey });
    assert.equal(ahead.kind, "response-ahead");
    assert.equal(ahead.values.authority.reviewRequestId, reviewRequestId);
    assert.equal(ahead.values.authority.focusedEvidenceDigest, null);
    assert.equal(ahead.values.receiptDigest, boundClaim.operationReceiptDigest);
    assert.notEqual(ahead.values.receiptDigest, ahead.values.verificationReceiptDigest);
    const sourceProjection = projectReviewedCiSourceMarker(fixture.plan, fixture.source.lease);
    let intent = stageIntent(fixture.intent, fixture.plan, "source-marker", "sourceProjection", {
      operationKey: reviewedCiRevisionOperationKey(fixture.plan, "intent-marker"),
      pullRequestNodeId: fixture.plan.pullRequestNodeId,
      markerDigest: digestValue(sourceProjection.marker), writerMarkerDigest: digestValue(sourceProjection.writerMarker),
      bodyDigest: sourceProjection.bodyDigest });
    const waiting = successorClaim(fixture.plan, fixture.source, { claimId: boundClaim.claimId,
      transitionCounter: 4, fenceRevision: D(7), transitionDigest: D(8), operationReceiptDigest: D(9) });
    intent = stageIntent(intent, fixture.plan, "successor-waiting", "successor",
      claimPhaseValues(fixture.plan, waiting, "claim"));
    intent = stageIntent(intent, fixture.plan, "source-retired", "sourceRetirement", {
      operationKey: reviewedCiRevisionOperationKey(fixture.plan, "retire-source"),
      sourceClaimId: fixture.plan.sourceClaimId, successorClaimId: waiting.claimId,
      receiptDigest: D(2), operationReceiptDigest: D(3), ledgerDigest: D(4), state: "retired" });
    const boundary = reviewedCiRevisionProviderBoundaryDigest(fixture.plan);
    intent = stageIntent(intent, fixture.plan, "source-pr-closed", "sourcePullRequestClosure", {
      operationKey: reviewedCiRevisionOperationKey(fixture.plan, "close-source-pr"),
      pullRequestNumber: fixture.plan.pullRequestNumber, pullRequestNodeId: fixture.plan.pullRequestNodeId,
      url: fixture.plan.pullRequestUrl, state: "CLOSED", closedAt: "2026-08-09T00:00:03.000Z",
      mergedAt: null, headSha: fixture.plan.sourceHeadSha, baseSha: fixture.plan.successorCanonicalBaseSha,
      bodyDigest: sourceProjection.bodyDigest, bodyDisposition: "recovery-projection",
      providerDisposition: "closed", providerBoundaryDigest: boundary });
    intent = stageIntent(intent, fixture.plan, "replacement-pr-created", "replacementPullRequest", {
      operationKey: reviewedCiRevisionOperationKey(fixture.plan, "create-replacement-pr"),
      pullRequestNumber: replacement.number, pullRequestNodeId: replacement.nodeId, url: replacement.url,
      state: "OPEN", isDraft: true, title: bootstrap.title, bodyDigest: bootstrap.bodyDigest,
      providerDisposition: "created", providerBoundaryDigest: boundary,
      headSha: fixture.plan.sourceHeadSha, baseSha: fixture.plan.observedProtectedMainSha,
      authorLogin: fixture.plan.pullRequestAuthorLogin });
    intent = stageIntent(intent, fixture.plan, "successor-promoted", "promotion", {
      ...claimPhaseValues(fixture.plan, unbound, "promote-successor"), authority: promotedAuthority,
      authorityDigest: digestValue(promotedAuthority) });
    intent = stageIntent(intent, fixture.plan, "successor-bound", "binding", ahead.values);
    const oldSource = fixture.pulls.get(fixture.plan.pullRequestNumber);
    fixture.pulls.set(oldSource.number, { ...oldSource, body: sourceProjection.body,
      state: "CLOSED", closedAt: "2026-08-09T00:00:03.000Z" });
    fixture.persistIntent(intent);
    fixture.state.verifyActive = input => ({ authority: input.authority,
      verification: { receiptDigest: D(4), verifiedAt: "2026-08-09T00:09:30.000Z" } });
    const revision = fixture.readRegistry().revision;
    await assert.rejects(() => fixture.adapter.preparePullRequestProjection({
      plan: fixture.plan, intent }), /server-time margin/);
    assert.equal(fixture.readRegistry().revision, revision);
    fixture.state.verifyActive = null;
    const prepared = await fixture.adapter.preparePullRequestProjection({ plan: fixture.plan, intent });
    assert.equal(fixture.state.editCalls, 0);
    const candidate = buildReviewedCiRevisionPhaseSnapshot({
      phase: "remote-active", plan: fixture.plan, values: prepared });
    intent = advanceReviewedCiRevisionIntent(intent, { status: intent.status,
      values: { pullRequestProjectionCandidate: candidate } });
    fixture.persistIntent(intent);
    assert.deepEqual(await fixture.adapter.projectPullRequest({ plan: fixture.plan, intent }), prepared);
    assert.equal(fixture.state.editCalls, 1);
    const adopted = await fixture.adapter.reconcileTransition({ plan: fixture.plan, intent,
      method: "projectPullRequest", operationKey: reviewedCiRevisionOperationKey(fixture.plan, "active-pr-marker") });
    assert.equal(adopted.kind, "response-ahead");
    assert.deepEqual(adopted.values, prepared);
    assert.equal(fixture.state.editCalls, 1);
  } finally { fixture.cleanup(); }
});
}
