import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizeOpenReviewedLaneQueuePreservation,
  buildOpenReviewedLaneQueuePreservationPlan,
  createOpenReviewedLaneQueuePreservationIntent,
  normalizeOpenReviewedLaneQueuePreservationPlan,
  PRESERVED_QUEUE_SCHEMA,
} from "../scripts/open-reviewed-lane-queue-preservation-contract.mjs";
import { createOpenReviewedLaneQueuePreservationController }
  from "../scripts/open-reviewed-lane-queue-preservation-controller.mjs";
import { createRepositoryOpenReviewedLaneQueuePreservationAdapter }
  from "../scripts/open-reviewed-lane-queue-preservation-repository-adapter.mjs";
import {
  advanceOpenReviewedLaneRehydrationIntent,
  beginOpenReviewedLaneRehydrationEffect,
  buildOpenReviewedLaneRehydrationPlan,
  buildOpenReviewedLaneRehydrationReceipt,
  createOpenReviewedLaneRehydrationIntent,
} from "../scripts/open-reviewed-lane-rehydration-contract.mjs";
import { updateWriterLeasePullRequestBody, WRITER_LEASE_SCHEMA }
  from "../scripts/writer-lease-lib.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const sourceWrites = ["path:docs/START-WORKFLOW.md", "semantic:reviewed-lane"];

function innerEvidence({ mode = "worktree-only" } = {}) {
  const writeSetDigest = digestValue(sourceWrites);
  const workItemId = `work-item:${digest("c")}`;
  const claimId = digestValue({ actorId: "actor:7", canonicalBaseRevision: sha("1"),
    leaseEpoch: 3, repositoryId: "repository:R_repo", workItemId, writeSetDigest });
  const marker = {
    status: "review_ready", epoch: 211, sessionId: "owner-session", device: "owner-device",
    scope: "reviewed-lane", branch: "agent/owner-device/reviewed-lane",
    baseSha: sha("1"), fenceSha: sha("2"), reviewHeadSha: sha("3"),
    expiresAt: "2026-08-10T05:25:20.000Z",
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "reviewed-lane", declaredWriteSet: sourceWrites, writeSetDigest,
      manifestDigest: digest("4"), planReceiptDigest: digest("a"), admissionReceiptDigest: digest("b"),
      existingLaneStateDigest: digest("c"), admittedReportDigest: digest("5"),
      preservationReceiptDigest: digest("d") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "neutral-test",
      ledgerRepository: "coordination/ledger", targetRepository: "owner/repo", claimId,
      claimDigest: digest("7"), ledgerRevision: sha("8"), ledgerDigest: digest("8"),
      claimLedgerRevision: digest("9"), entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest: digest("a"),
      canonicalBaseSha: sha("1"), laneRevision: sha("3"), cloudDeclaredWriteScope: sourceWrites,
      writeSetDigest, deviceId: "owner-device", sessionId: "owner-session",
      reviewRequestId: "review:PR_node", leaseEpoch: 3, transitionCounter: 3,
      state: "review_ready", expiresAt: "2026-08-10T05:25:20.000Z",
      integrationReceiptDigest: null, integration: null, focusedEvidenceDigest: digest("b"),
      manifestDigest: digest("4") },
  };
  marker.markerDigest = digestValue(marker);
  const claim = {
    claimId, entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "dormant-preserved",
    writeAuthority: false, scopeReserved: true, actorId: "actor:7", repositoryId: "repository:R_repo",
    workItemId, canonicalBaseRevision: sha("1"), laneRevision: sha("3"),
    declaredWriteScope: sourceWrites, writeSetDigest, leaseEpoch: 3, transitionCounter: 4,
    heartbeatCounter: 0, reviewRequestId: "review:PR_node", predecessorClaimId: digest("d"),
    expiresAt: "2026-08-10T05:25:20.000Z", fenceRevision: digest("e"),
    transitionDigest: digest("f"), operationReceiptDigest: digest("1"),
    integrationReceiptDigest: digest("1"), integration: {
      candidateRevision: sha("3"), reviewRequestId: "review:PR_node",
      focusedEvidenceDigest: digest("b"), dependencyClosureDigest: digest("2"),
      namedChecksDigest: digest("3"), handoffEvidenceDigest: digest("4"),
      operatorDecisionDigest: digest("5"), integrationIntentDigest: digest("6"),
      integratedAt: "2026-08-10T05:20:20.000Z",
    },
  };
  const localProjection = mode === "worktree-only"
    ? { mode, branch: { headSha: sha("3"), refDigest: digestValue({ branch: marker.branch, head: sha("3") }) },
      lease: { leaseDigest: digest("6"), projectionDigest: digest("7") }, worktreeAbsent: true }
    : { mode, branch: null, lease: null, worktreeAbsent: true };
  return {
    repository: { nameWithOwner: "owner/repo", nodeId: "R_repo", claimRepositoryId: "repository:R_repo" },
    actor: { id: "7", login: "owner", claimActorId: "actor:7" },
    canonical: { repoRoot: "/workspace/repo", gitCommonDir: "/workspace/repo/.git",
      headSha: sha("a"), currentMainSha: sha("a"), currentMainTreeSha: sha("b"),
      registrationDigest: digest("1"), leaseProjectionDigest: digest("7"), clean: true },
    target: { path: "/workspace/.worktrees/repo/reviewed-lane",
      managedRoot: "/workspace/.worktrees/repo", sharedRoot: "/workspace/.worktrees",
      observationDigest: digest("2") },
    branch: marker.branch, remoteHeadSha: sha("3"),
    pullRequest: { number: 778, nodeId: "PR_node", url: "https://provider.test/owner/repo/reviews/778",
      state: "OPEN", isDraft: false, headBranch: marker.branch, headSha: sha("3"), baseBranch: "main",
      baseSha: sha("9"), headRepository: "owner/repo", baseRepository: "owner/repo",
      authorLogin: "owner", reviewRequestId: "review:PR_node", autoMergeRequest: null,
      mergeQueueEntry: null, bodyDigest: digest("3"), markerDigest: marker.markerDigest },
    marker, claim, refresh: null, localProjection,
  };
}

function innerPlan(options) { return buildOpenReviewedLaneRehydrationPlan(innerEvidence(options)); }

function waiter(plan, { character, leaseEpoch, workItemCharacter, ...overrides }) {
  const writes = [`path:scripts/evolved-${character}.mjs`, `semantic:evolved-${character}`];
  const workItemId = `work-item:${digest(workItemCharacter)}`;
  const base = {
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "waiting-successor",
    writeAuthority: false, scopeReserved: false, actorId: plan.evidence.claim.actorId,
    repositoryId: plan.evidence.claim.repositoryId, workItemId,
    canonicalBaseRevision: sha(character), laneRevision: sha(character), declaredWriteScope: writes,
    writeSetDigest: digestValue(writes), leaseEpoch, transitionCounter: 1, heartbeatCounter: 0,
    reviewRequestId: null, predecessorClaimId: plan.evidence.claim.claimId,
    expiresAt: "2026-08-14T08:00:00.000Z", fenceRevision: digest(character),
    transitionDigest: digest(workItemCharacter), operationReceiptDigest: digest(String(leaseEpoch)),
    integrationReceiptDigest: null, integration: null,
  };
  const merged = { ...base, ...overrides };
  merged.claimId = overrides.claimId || digestValue({ actorId: merged.actorId,
    canonicalBaseRevision: merged.canonicalBaseRevision, leaseEpoch: merged.leaseEpoch,
    repositoryId: merged.repositoryId, workItemId: merged.workItemId,
    writeSetDigest: merged.writeSetDigest });
  return merged;
}

function queue(plan, entries, { ledgerRevision = sha("8"), ledgerDigest = digest("8"), ...overrides } = {}) {
  const sourceClaim = { claimId: plan.evidence.claim.claimId, actorId: plan.evidence.claim.actorId,
    repositoryId: plan.evidence.claim.repositoryId, workItemId: plan.evidence.claim.workItemId };
  const core = { schema: PRESERVED_QUEUE_SCHEMA, sourceClaim, ledgerRepository: "coordination/ledger",
    targetRepository: plan.evidence.repository.nameWithOwner, ledgerRevision, ledgerDigest,
    complete: true, order: "lease-epoch-then-claim-id", entries, ...overrides };
  const queueDigest = digestValue({ schema: core.schema, sourceClaim: core.sourceClaim,
    ledgerRepository: core.ledgerRepository, targetRepository: core.targetRepository,
    complete: core.complete, order: core.order, entries: core.entries });
  return { ...core, queueDigest };
}

function evidenceFixture() {
  const plan = innerPlan();
  const entries = [
    waiter(plan, { character: "4", leaseEpoch: 4, workItemCharacter: "e" }),
    waiter(plan, { character: "5", leaseEpoch: 5, workItemCharacter: "f" }),
  ];
  return { innerPlan: plan, preservedQueue: queue(plan, entries) };
}

function createInnerReceipt(plan) {
  let intent = createOpenReviewedLaneRehydrationIntent(plan);
  intent = beginOpenReviewedLaneRehydrationEffect(intent, "branch-created");
  intent = advanceOpenReviewedLaneRehydrationIntent(intent, "branch-created", {
    branch: plan.evidence.branch, headSha: plan.evidence.remoteHeadSha,
    refDigest: plan.evidence.localProjection.branch.refDigest, disposition: "adopted",
  });
  intent = beginOpenReviewedLaneRehydrationEffect(intent, "worktree-created");
  intent = advanceOpenReviewedLaneRehydrationIntent(intent, "worktree-created", {
    targetPath: plan.evidence.target.path, headSha: plan.evidence.remoteHeadSha,
    registrationDigest: digest("9"), disposition: "created",
  });
  intent = beginOpenReviewedLaneRehydrationEffect(intent, "lease-recovered");
  intent = advanceOpenReviewedLaneRehydrationIntent(intent, "lease-recovered", {
    disposition: "adopted", leaseDigest: plan.evidence.localProjection.lease.leaseDigest,
    epoch: plan.evidence.marker.epoch, sessionId: plan.evidence.marker.sessionId,
    leaseProjectionDigest: plan.evidence.localProjection.lease.projectionDigest,
  });
  return buildOpenReviewedLaneRehydrationReceipt({ intent,
    leaseDigest: plan.evidence.localProjection.lease.leaseDigest, registrationDigest: digest("9") });
}

function fakeAdapter({ driftStage = null } = {}) {
  const initial = evidenceFixture(), innerReceipt = createInnerReceipt(initial.innerPlan);
  const state = { intent: null, innerRuns: 0, verifies: 0, revalidations: [],
    cloudMutations: 0, providerMutations: 0, remoteMutations: 0 };
  function observedQueue(stage) {
    const entries = structuredClone(initial.preservedQueue.entries);
    if (stage === driftStage) entries[0].transitionDigest = digest("0");
    return queue(initial.innerPlan, entries, { ledgerRevision: sha("9"), ledgerDigest: digest("9") });
  }
  return { state, adapter: {
    readPlanEvidence: () => initial,
    withOperationLock: (_input, action) => action(),
    readIntent: () => state.intent,
    writeIntent({ expected, value }) { assert.deepEqual(state.intent, expected); state.intent = value; },
    revalidate({ plan, stage }) {
      state.revalidations.push(stage);
      if (observedQueue(stage).queueDigest !== plan.evidence.preservedQueueDigest) {
        throw new Error(`preserved queue content drift ${stage}`);
      }
    },
    runInner(input) {
      state.innerRuns += 1;
      assert.equal(input.plan.planDigest, initial.innerPlan.planDigest);
      assert.equal(input.authorization, initial.innerPlan.exactAuthorization);
      return innerReceipt;
    },
    verifyTerminal() { state.verifies += 1; return innerReceipt; },
  } };
}

function repositoryAdapterFixture({ mutateStatus = null } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "queue-preservation-adapter-")));
  const repository = path.join(root, "repository"), commonDirectory = path.join(repository, ".git");
  mkdirSync(commonDirectory, { recursive: true });
  const subject = evidenceFixture(), innerReceipt = createInnerReceipt(subject.innerPlan);
  const source = subject.innerPlan.evidence.claim;
  const marker = subject.innerPlan.evidence.marker;
  const lease = { ...marker, schema: WRITER_LEASE_SCHEMA, autoDelivery: false,
    runtimeRequired: false, heartbeatAt: "2026-08-10T05:20:20.000Z",
    cloudAuthority: { ...marker.cloudAuthority, provider: "github" } };
  const body = updateWriterLeasePullRequestBody("", lease);
  const state = { cloudCalls: [], filteredStatuses: [], innerRuns: 0 };
  function cloud(input) {
    state.cloudCalls.push(structuredClone(input));
    const call = state.cloudCalls.length;
    const revisionCharacter = ["8", "9", "a", "b", "c"][Math.min(call - 1, 4)];
    const status = { schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: sha(revisionCharacter),
      ledgerDigest: digest(revisionCharacter),
      claims: [structuredClone(source), ...structuredClone(subject.preservedQueue.entries)] };
    mutateStatus?.({ status, call, source });
    return status;
  }
  const dependencies = {
    git(argumentsList) {
      if (JSON.stringify(argumentsList) === JSON.stringify(["rev-parse", "--git-common-dir"])) return ".git";
      throw new Error(`Unexpected repository-adapter git call: ${argumentsList.join(" ")}`);
    },
    gitRaw() { throw new Error("Unexpected repository-adapter raw Git call."); },
    gh() { throw new Error("Unexpected repository-adapter provider call."); },
    cloud,
    readReviewBody: () => body,
    createInnerAdapter(_options, innerDependencies) { return { cloud: innerDependencies.cloud }; },
    createInnerController({ adapter }) {
      const request = { action: "status", ledgerRepository: "coordination/ledger",
        request: { targetRepository: "owner/repo" } };
      return {
        plan() {
          const status = adapter.cloud(request); state.filteredStatuses.push(status);
          return subject.innerPlan;
        },
        run() {
          const status = adapter.cloud(request); state.filteredStatuses.push(status);
          state.innerRuns += 1; return innerReceipt;
        },
      };
    },
  };
  return { root, repository, state, subject,
    adapter: createRepositoryOpenReviewedLaneQueuePreservationAdapter({ repository,
      targetPath: path.join(root, "managed", "reviewed-lane"), pullRequestNumber: 778 }, dependencies),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("two direct waiters are ordered, bound, and may evolve work-item identity", () => {
  const evidence = evidenceFixture();
  const plan = buildOpenReviewedLaneQueuePreservationPlan(evidence);
  assert.equal(plan.evidence.preservedQueue.entries.length, 2);
  assert.notEqual(plan.evidence.preservedQueue.entries[0].workItemId,
    plan.evidence.sourceClaim.workItemId);
  assert.deepEqual(plan.evidence.preservedQueue.entries.map(item => item.leaseEpoch), [4, 5]);
  assert.equal(plan.evidence.preservedQueueDigest, evidence.preservedQueue.queueDigest);
  assert.equal(normalizeOpenReviewedLaneQueuePreservationPlan(plan).planDigest, plan.planDigest);
  assert.equal(createOpenReviewedLaneQueuePreservationIntent(plan).preservedQueueDigest,
    plan.evidence.preservedQueueDigest);
  assert.equal(authorizeOpenReviewedLaneQueuePreservation(plan, plan.exactAuthorization).planDigest,
    plan.planDigest);
});

test("foreign, writing, reserving, reviewed, integrated, and malformed waiters fail closed", () => {
  const mutations = [
    claim => { claim.predecessorClaimId = digest("0"); },
    claim => { claim.actorId = "actor:foreign"; },
    claim => { claim.repositoryId = "repository:foreign"; },
    claim => { claim.state = "current"; claim.writeAuthority = true; },
    claim => { claim.scopeReserved = true; },
    claim => { claim.state = "reviewed"; claim.reviewRequestId = "review:foreign"; },
    claim => { claim.integrationReceiptDigest = digest("0"); claim.integration = {}; },
    claim => { claim.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const evidence = evidenceFixture(), entries = structuredClone(evidence.preservedQueue.entries);
    mutate(entries[0]);
    assert.throws(() => buildOpenReviewedLaneQueuePreservationPlan({ innerPlan: evidence.innerPlan,
      preservedQueue: queue(evidence.innerPlan, entries) }), /queue preservation/u);
  }
});

test("queue order, completeness, exact authorization, and worktree-only mode are mandatory", () => {
  const evidence = evidenceFixture();
  assert.throws(() => buildOpenReviewedLaneQueuePreservationPlan({ innerPlan: evidence.innerPlan,
    preservedQueue: queue(evidence.innerPlan, [...evidence.preservedQueue.entries].reverse()) }), /queue order/u);
  assert.throws(() => buildOpenReviewedLaneQueuePreservationPlan({ innerPlan: evidence.innerPlan,
    preservedQueue: queue(evidence.innerPlan, evidence.preservedQueue.entries, { complete: false }) }), /queue identity/u);
  assert.throws(() => buildOpenReviewedLaneQueuePreservationPlan({ innerPlan: innerPlan({ mode: "all-absent" }),
    preservedQueue: evidence.preservedQueue }), /inner projection mode/u);
  const plan = buildOpenReviewedLaneQueuePreservationPlan(evidence);
  assert.throws(() => authorizeOpenReviewedLaneQueuePreservation(plan,
    `authorize open-reviewed-lane-queue-preservation ${digest("0")}`), /authorization/u);
});

test("unrelated ledger advancement leaves the normative queue digest stable", () => {
  const evidence = evidenceFixture();
  const advanced = queue(evidence.innerPlan, evidence.preservedQueue.entries,
    { ledgerRevision: sha("9"), ledgerDigest: digest("9") });
  assert.notEqual(advanced.ledgerRevision, evidence.preservedQueue.ledgerRevision);
  assert.notEqual(advanced.ledgerDigest, evidence.preservedQueue.ledgerDigest);
  assert.equal(advanced.queueDigest, evidence.preservedQueue.queueDigest);
});

test("controller permits only registered-worktree and replays stable attention-required proof", () => {
  const { adapter, state } = fakeAdapter();
  const controller = createOpenReviewedLaneQueuePreservationController({ adapter });
  const plan = controller.plan();
  const first = controller.run({ plan, authorization: plan.exactAuthorization });
  const replay = controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, first);
  assert.equal(first.status, "attention-required");
  assert.deepEqual(first.mutationSet, ["registered-worktree"]);
  assert.deepEqual([first.remoteMutation, first.providerMutation, first.cloudMutation,
    first.authoringAuthority, first.cloudTransitionAuthority, first.integrationAuthority],
  [false, false, false, false, false, false]);
  assert.deepEqual([state.innerRuns, state.verifies, state.cloudMutations,
    state.providerMutations, state.remoteMutations], [1, 2, 0, 0, 0]);
  assert.deepEqual(state.revalidations, ["before-inner", "after-inner", "after-inner"]);
  assert.equal(state.intent.status, "complete");
});

test("queue content drift is rejected before or after the inner idempotent boundary", () => {
  for (const stage of ["before-inner", "after-inner"]) {
    const { adapter, state } = fakeAdapter({ driftStage: stage });
    const controller = createOpenReviewedLaneQueuePreservationController({ adapter });
    const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }),
      new RegExp(`content drift ${stage}`, "u"));
    assert.equal(state.innerRuns, stage === "before-inner" ? 0 : 1);
    assert.equal(state.intent.status, stage === "before-inner" ? "prepared" : "inner-complete");
  }
});

test("repository adapter filters only the exact direct queue and tolerates unrelated ledger advance", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const evidence = fixture.adapter.readPlanEvidence();
    assert.equal(evidence.preservedQueue.entries.length, 2);
    assert.notEqual(evidence.preservedQueue.ledgerRevision,
      fixture.state.filteredStatuses[0].ledgerRevision);
    assert.deepEqual(fixture.state.filteredStatuses[0].claims.map(item => item.claimId),
      [fixture.subject.innerPlan.evidence.claim.claimId]);
    const plan = buildOpenReviewedLaneQueuePreservationPlan(evidence);
    const recaptured = fixture.adapter.revalidate({ plan, stage: "before-inner" });
    assert.notEqual(recaptured.ledgerRevision, evidence.preservedQueue.ledgerRevision);
    assert.equal(recaptured.queueDigest, evidence.preservedQueue.queueDigest);
    assert.ok(fixture.state.cloudCalls.every(call => call.action === "status"
      && call.ledgerRepository === "coordination/ledger"
      && call.request.targetRepository === "owner/repo"));
  } finally { fixture.cleanup(); }
});

test("repository adapter rejects invalid direct waiters and non-queue competitors", () => {
  const cases = [
    ({ status }) => { status.claims[1].state = "current"; status.claims[1].writeAuthority = true; },
    ({ status, source }) => { status.claims.push({ ...structuredClone(source), claimId: digest("0"),
      predecessorClaimId: digest("f"), reviewRequestId: null }); },
  ];
  for (const mutateStatus of cases) {
    const fixture = repositoryAdapterFixture({ mutateStatus });
    try { assert.throws(() => fixture.adapter.readPlanEvidence(), /repository adapter/u); }
    finally { fixture.cleanup(); }
  }
});

test("repository adapter rejects waiter content drift after planning", () => {
  const fixture = repositoryAdapterFixture({ mutateStatus({ status, call }) {
    if (call >= 3) status.claims[1].transitionDigest = digest("0");
  } });
  try {
    const plan = buildOpenReviewedLaneQueuePreservationPlan(fixture.adapter.readPlanEvidence());
    assert.throws(() => fixture.adapter.revalidate({ plan, stage: "after-inner" }),
      /preserved queue content drifted/u);
  } finally { fixture.cleanup(); }
});

test("repository adapter journals outer intent with compare-and-swap replay safety", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const plan = buildOpenReviewedLaneQueuePreservationPlan(fixture.adapter.readPlanEvidence());
    const intent = createOpenReviewedLaneQueuePreservationIntent(plan);
    fixture.adapter.writeIntent({ expected: null, value: intent });
    assert.deepEqual(fixture.adapter.readIntent({ plan }), intent);
    assert.throws(() => fixture.adapter.writeIntent({ expected: null, value: intent }),
      /compare-and-swap/u);
  } finally { fixture.cleanup(); }
});
