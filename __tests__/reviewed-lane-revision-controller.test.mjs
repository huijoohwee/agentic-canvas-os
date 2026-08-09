import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  assertReviewedLaneSourceHeadProjection,
  createReviewedLaneRevisionControllerAdapter,
  joinReviewedLanePublicPrivateClaim,
  planReviewedLaneRevision,
  runReviewedLaneRevision,
} from "../scripts/reviewed-lane-revision-controller.mjs";
import {
  buildReviewedLaneRevisionPlan,
  reviewedLaneRevisionOperationKey,
} from "../scripts/reviewed-lane-revision-contract.mjs";
import {
  buildReviewedLaneRevisionCommitCandidate,
  buildReviewedLaneRevisionSourceEvidence,
} from "../scripts/reviewed-lane-revision-evidence.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
import {
  createReviewedLaneRevisionRepositoryRuntime,
} from "../scripts/reviewed-lane-revision-repository-adapter.mjs";

const REPLACEMENT_SUBJECT = "feat(reviewed-lane): preserve tree and repair subject";
const EFFECTS = Object.freeze([
  ["successor_waiting", "createWaitingSuccessor"],
  ["commit_created", "createCommit"],
  ["local_ref_updated", "compareAndSwapLocalRef"],
  ["remote_ref_updated", "fastForwardRemote"],
  ["source_retired", "retireSourceClaim"],
  ["successor_current", "promoteSuccessor"],
  ["successor_bound", "bindSuccessor"],
  ["successor_review_ready", "markSuccessorReviewReady"],
  ["lease_updated", "updateLease"],
  ["pr_projected", "projectPullRequest"],
  ["verified", "verifyTerminal"],
]);

test("runs the exact durable phase order and retires the source before promotion", async () => {
  const harness = createHarness();
  const plan = await planReviewedLaneRevision(
    { replacementSubject: REPLACEMENT_SUBJECT },
    { adapter: harness.adapter },
  );
  const result = await runReviewedLaneRevision({
    replacementSubject: REPLACEMENT_SUBJECT,
    authorization: plan.exactAuthorization,
  }, { adapter: harness.adapter });

  assert.equal(result.status, "complete");
  assert.deepEqual(harness.effects, EFFECTS.map(([, method]) => method));
  assert.ok(
    harness.effects.indexOf("retireSourceClaim")
      < harness.effects.indexOf("promoteSuccessor"),
  );
  assert.equal(harness.intent.status, "complete");
});

test("rejects non-exact authorization before any durable intent or effect", async () => {
  const harness = createHarness();
  await assert.rejects(
    runReviewedLaneRevision({
      replacementSubject: REPLACEMENT_SUBJECT,
      authorization: "authorize reviewed-lane-revision wrong",
    }, { adapter: harness.adapter }),
    /requires exact authorization/u,
  );
  assert.equal(harness.intent, null);
  assert.deepEqual(harness.effects, []);
});

test("adopts an exact response-ahead effect without repeating the mutation", async () => {
  const harness = createHarness({ responseAhead: "successor_waiting" });
  const plan = await planReviewedLaneRevision(
    { replacementSubject: REPLACEMENT_SUBJECT },
    { adapter: harness.adapter },
  );
  await runReviewedLaneRevision({
    replacementSubject: REPLACEMENT_SUBJECT,
    authorization: plan.exactAuthorization,
  }, { adapter: harness.adapter });
  assert.equal(harness.effects.includes("createWaitingSuccessor"), false);
  assert.equal(harness.intent.status, "complete");
});

test("reconciles after a lost response and resumes terminal drift without replaying effects", async () => {
  const harness = createHarness({
    failAfterEffect: "createCommit",
    terminalDrift: true,
  });
  const plan = await planReviewedLaneRevision(
    { replacementSubject: REPLACEMENT_SUBJECT },
    { adapter: harness.adapter },
  );
  await assert.rejects(
    runReviewedLaneRevision({
      replacementSubject: REPLACEMENT_SUBJECT,
      authorization: plan.exactAuthorization,
    }, { adapter: harness.adapter }),
    /terminal equality drifted/u,
  );
  assert.equal(harness.effects.filter(value => value === "createCommit").length, 1);
  assert.equal(harness.intent.status, "pr_projected");

  harness.terminalDrift = false;
  const result = await runReviewedLaneRevision({
    replacementSubject: REPLACEMENT_SUBJECT,
    authorization: plan.exactAuthorization,
  }, { adapter: harness.adapter });
  assert.equal(result.status, "complete");
  assert.equal(harness.effects.filter(value => value === "createCommit").length, 1);
});

test("default cloud roots bind exact source, owner, branch, ledger, and evidence", async () => {
  const subject = createSubject();
  const plan = buildReviewedLaneRevisionPlan({
    ...subject,
    replacementSubject: REPLACEMENT_SUBJECT,
  });
  const repository = process.cwd();
  const branch = subject.fixture.lease.branch;
  const lease = { ...subject.fixture.lease, worktreePath: repository };
  const owner = subject.fixture.claim;
  const { deviceId: _deviceId, sessionId: _sessionId, ...publicSource } = owner;
  let claims = [publicSource];
  let ledgerDigest = "d".repeat(64);
  const observed = [];
  const inspectCloud = ({ action, request }) => {
    if (action === "status") return cloudStatus(claims, ledgerDigest);
    observed.push({ action, request });
    if (action === "claim") {
      assert.equal(request.branch, branch);
      assert.equal(request.actorId, Number(plan.source.actor.id));
      assert.equal(request.actorLogin, plan.source.actor.login);
      claims.push({ ...claims[0], claimId: "e".repeat(64),
        predecessorClaimId: plan.sourceClaimId, laneRevision: plan.sourceHeadSha,
        leaseEpoch: claims[0].leaseEpoch + 1, state: "waiting-successor",
        reviewRequestId: null, fenceRevision: "f".repeat(64), transitionDigest: "a".repeat(64),
        transitionCounter: 1, operationReceiptDigest: "b".repeat(64) });
    } else if (action === "retire") {
      assert.equal(request.expectedLedgerDigest, ledgerDigest);
      assert.equal(request.bytesDigest, digestValue({ sourceHeadSha: plan.sourceHeadSha,
        replacementHeadSha: plan.replacementHeadSha, treeSha: plan.treeSha,
        candidateDigest: plan.candidateDigest }));
      claims = claims.filter(claim => claim.claimId !== plan.sourceClaimId);
    } else if (action === "continue") {
      assert.equal(request.branch, branch);
      assert.equal(request.headSha, plan.sourceHeadSha);
      assert.equal(request.expectedLedgerDigest, ledgerDigest);
      claims = claims.map(claim => claim.claimId === request.claimId
        ? { ...claim, state: "current", fenceRevision: "c".repeat(64),
          transitionDigest: "b".repeat(64), transitionCounter: 2,
          operationReceiptDigest: "c".repeat(64) }
        : claim);
    }
    ledgerDigest = digestValue({ action, request });
    return { schema: "agentic-cloud-collaboration-result/v1", ok: true, action };
  };
  const gitText = args => {
    if (args[0] === "branch") return branch;
    if (args[0] === "worktree") return `worktree ${repository}\nHEAD ${plan.sourceHeadSha}\nbranch refs/heads/${branch}\n`;
    if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git";
    throw new Error(`Unexpected git read: ${args.join(" ")}`);
  };
  const runtime = createReviewedLaneRevisionRepositoryRuntime({
    repository,
    sessionId: lease.sessionId,
    environment: {},
  }, { gitText, leaseStore: { read: () => lease }, inspectCloud,
    privateClaims: async () => privateInventory(claims, owner) });
  for (const drift of [
    { heartbeatCounter: 1 }, { transitionCounter: owner.transitionCounter + 1 },
    { transitionDigest: "6".repeat(64) }, { state: "current" },
    { expiresAt: "2031-01-01T00:00:00.000Z" }, { reviewRequestId: "github-pull-request:other" },
    { declaredWriteScope: ["path:other"] },
  ]) {
    claims = [{ ...publicSource, ...drift }];
    await assert.rejects(runtime.createWaitingSuccessor({ plan,
      operationKey: reviewedLaneRevisionOperationKey(plan, "successor_waiting") }),
    /drifted from the authorized plan/u);
  }
  claims = [publicSource];
  await runtime.createWaitingSuccessor({ plan,
    operationKey: reviewedLaneRevisionOperationKey(plan, "successor_waiting") });
  claims = claims.map(claim => claim.claimId === plan.sourceClaimId
    ? { ...claim, heartbeatCounter: 1 } : claim);
  await assert.rejects(runtime.retireSourceClaim({ plan,
    operationKey: reviewedLaneRevisionOperationKey(plan, "source_retired") }),
  /drifted from the authorized plan/u);
  claims = claims.map(claim => claim.claimId === plan.sourceClaimId ? publicSource : claim);
  await runtime.retireSourceClaim({ plan,
    operationKey: reviewedLaneRevisionOperationKey(plan, "source_retired") });
  await runtime.promoteSuccessor({ plan,
    operationKey: reviewedLaneRevisionOperationKey(plan, "successor_current") });
  assert.deepEqual(observed.map(item => item.action), ["claim", "retire", "continue"]);
});

test("publishes the forward child without any force push", () => {
  const source = readFileSync(new URL(
    "../scripts/reviewed-lane-revision-repository-adapter.mjs", import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /--force|forceWithLease/u);
  assert.match(source, /refs\/heads\/\$\{branch\}:refs\/heads\/\$\{branch\}/u);
  assert.match(source, /mode: "projection"/u);
});

test("rejects stale durable review-ready authority after crash and heartbeat advance", async () => {
  const subject = createSubject();
  const plan = buildReviewedLaneRevisionPlan({ ...subject, replacementSubject: REPLACEMENT_SUBJECT });
  const repository = process.cwd(), lease = { ...subject.fixture.lease, worktreePath: repository };
  const owner = subject.fixture.claim;
  const successor = { ...owner, claimIdentitySchema: owner.entrySchema, claimId: "e".repeat(64),
    predecessorClaimId: plan.sourceClaimId, laneRevision: plan.replacementHeadSha,
    leaseEpoch: owner.leaseEpoch + 1, transitionCounter: 3, heartbeatCounter: 1,
    state: "reviewed", reviewRequestId: plan.sourceReviewRequestId,
    fenceRevision: "f".repeat(64), transitionDigest: "a".repeat(64),
    operationReceiptDigest: "b".repeat(64), expiresAt: "2030-01-01T00:00:00.000Z" };
  const { deviceId: _deviceId, sessionId: _sessionId, ...publicSuccessor } = successor;
  let claims = [publicSuccessor];
  const gitText = args => {
    if (args[0] === "branch") return lease.branch;
    if (args[0] === "worktree") return `worktree ${repository}\nHEAD ${plan.sourceHeadSha}\nbranch refs/heads/${lease.branch}\n`;
    if (args[0] === "rev-parse") return ".git";
    throw new Error(`Unexpected git read: ${args.join(" ")}`);
  };
  const runtime = createReviewedLaneRevisionRepositoryRuntime({ repository,
    sessionId: lease.sessionId }, { gitText, leaseStore: { read: () => lease },
    inspectCloud: () => cloudStatus(claims, "d".repeat(64)),
    privateClaims: async () => privateInventory(claims, owner) });
  const phase = "successor_review_ready";
  const operationKey = reviewedLaneRevisionOperationKey(plan, phase);
  const first = await runtime.reconcilePhase({ intent: { phases: {} }, operationKey, phase, plan });
  const intent = { phases: { [phase]: { values: first.values } } };
  claims = [{ ...publicSuccessor, transitionCounter: 4, heartbeatCounter: 2,
    expiresAt: "2030-01-01T01:00:00.000Z", fenceRevision: "c".repeat(64),
    transitionDigest: "d".repeat(64), operationReceiptDigest: "e".repeat(64) }];
  await assert.rejects(runtime.reconcilePhase({ intent, operationKey, phase, plan }),
    /authority drifted after durable recording/u);
  await assert.rejects(runtime.updateLease({ intent, plan,
    operationKey: reviewedLaneRevisionOperationKey(plan, "lease_updated") }),
  /authority drifted before lease projection/u);
});

test("review-ready source joins reviewHeadSha while retaining an older fenceSha", () => {
  const headSha = "1".repeat(40);
  assert.equal(assertReviewedLaneSourceHeadProjection({
    lease: { fenceSha: "2".repeat(40), reviewHeadSha: headSha },
    local: { headSha, remoteHeadSha: headSha },
  }), true);
  assert.throws(() => assertReviewedLaneSourceHeadProjection({
    lease: { fenceSha: "2".repeat(40), reviewHeadSha: "3".repeat(40) },
    local: { headSha, remoteHeadSha: headSha },
  }), /review head are not equal/u);
});

test("joins redacted public claim to exact private lease owner without synthesis", () => {
  const { claim, lease } = createSubject().fixture;
  const { deviceId, sessionId, ...publicClaim } = claim;
  const privateClaim = { ...claim, ledgerRevision: claim.transitionDigest };
  delete privateClaim.transitionDigest;
  const joined = joinReviewedLanePublicPrivateClaim({ publicClaim, privateClaim, lease });
  assert.equal(joined.deviceId, deviceId);
  assert.equal(joined.sessionId, sessionId);
  assert.equal(joined.transitionDigest, claim.transitionDigest);
  assert.equal("ledgerRevision" in joined, false);
  assert.throws(() => joinReviewedLanePublicPrivateClaim({
    publicClaim,
    privateClaim: { ...privateClaim, sessionId: pseudonymousIdentifier("session", "other") },
    lease,
  }), /private owner does not match/u);
});

function createHarness({ responseAhead = null, failAfterEffect = null, terminalDrift = false } = {}) {
  const subject = createSubject();
  const live = new Set(responseAhead ? [responseAhead] : []);
  const effects = [];
  let intent = null;
  let failed = false;
  const harness = {
    effects,
    get intent() { return intent; },
    terminalDrift,
  };
  const methods = {
    withEntrypointFence: (_input, action) => action(Object.freeze({ fenceDigest: "f".repeat(64) })),
    readSubject: async () => subject,
    readIntent: async () => intent,
    writeIntent: async ({ expectedIntent, nextIntent }) => {
      assert.equal(expectedIntent?.intentDigest || null, intent?.intentDigest || null);
      intent = nextIntent;
      return intent;
    },
    reconcilePhase: async ({ operationKey, phase }) => {
      if (phase === "prepared" || phase === "complete" || live.has(phase)) {
        return {
          kind: "complete",
          values: phaseValues(operationKey, phase),
        };
      }
      return { kind: "pending" };
    },
  };
  for (const [phase, method] of EFFECTS) {
    methods[method] = async ({ operationKey }) => {
      effects.push(method);
      if (phase === "verified" && harness.terminalDrift) {
        throw new Error("PR, lease, and cloud terminal equality drifted.");
      }
      live.add(phase);
      if (method === failAfterEffect && !failed) {
        failed = true;
        throw new Error("transport response was lost");
      }
      return phaseValues(operationKey, phase);
    };
  }
  harness.adapter = createReviewedLaneRevisionControllerAdapter(methods);
  return harness;
}

function phaseValues(operationKey, phase) {
  return Object.freeze({ operationKey, phase, evidenceDigest: digestValue({ operationKey, phase }) });
}

function createSubject() {
  const rawCommit = [
    `tree ${"a".repeat(40)}`,
    `parent ${"b".repeat(40)}`,
    "author Solo Dev <solo@example.com> 1700000000 +0800",
    "committer Solo Dev <solo@example.com> 1700000000 +0800",
    "",
    "feat(reviewed-lane-revision-recovery): this reviewed source subject is deliberately longer than seventy-two characters",
    "",
    "Preserve this body byte-for-byte.",
    "",
  ].join("\n");
  const candidate = buildReviewedLaneRevisionCommitCandidate({
    rawCommit,
    replacementSubject: REPLACEMENT_SUBJECT,
  });
  const headSha = candidate.source.headSha;
  const baseSha = "c".repeat(40);
  const branch = "agent/solo.local/reviewed-lane";
  const declaredWriteSet = ["path:scripts/example.mjs", "semantic:reviewed-lane"];
  const writeSetDigest = digestValue(declaredWriteSet);
  const claimId = "1".repeat(64);
  const claimDigest = "2".repeat(64);
  const claimLedgerRevision = "3".repeat(64);
  const reviewRequestId = "github-pull-request:PR_node";
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "solo/ledger",
    targetRepository: "solo/repository",
    claimId,
    claimDigest,
    claimLedgerRevision,
    ledgerRevision: "d".repeat(40),
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    writeSetDigest,
    cloudDeclaredWriteScope: declaredWriteSet,
    deviceId: "solo.local",
    sessionId: "session-1",
    reviewRequestId,
    leaseEpoch: 4,
    transitionCounter: 7,
    state: "review_ready",
    focusedEvidenceDigest: "4".repeat(64),
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "reviewed-lane",
    declaredWriteSet,
    writeSetDigest,
    manifestDigest: "5".repeat(64),
    planReceiptDigest: "6".repeat(64),
    admissionReceiptDigest: "7".repeat(64),
    existingLaneStateDigest: "8".repeat(64),
    admittedReportDigest: "9".repeat(64),
    preservationReceiptDigest: "a".repeat(64),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 4,
    sessionId: "session-1",
    device: "solo.local",
    scope: "reviewed-lane",
    branch,
    worktreePath: "/tmp/reviewed-lane",
    baseSha,
    fenceSha: "f".repeat(40),
    reviewHeadSha: headSha,
    pullRequestUrl: "https://github.com/solo/repository/pull/12",
    autoDelivery: false,
    runtimeRequired: false,
    admission,
    cloudAuthority: authority,
    acquiredAt: "2026-08-09T00:00:00.000Z",
    heartbeatAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-10T00:00:00.000Z",
  };
  const pullRequest = {
    url: lease.pullRequestUrl,
    number: 12,
    nodeId: "PR_node",
    state: "OPEN",
    isDraft: false,
    title: "Repair reviewed lane subject",
    body: renderWriterLeasePullRequestBody(lease),
    headRepository: "solo/repository",
    baseRepository: "solo/repository",
    headBranch: branch,
    baseBranch: "main",
    headSha,
    baseSha,
    authorLogin: "solo",
    autoMergeRequest: null,
    isInMergeQueue: false,
    mergeQueueEntry: null,
    reviewRequestId,
  };
  const claim = {
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimId,
    actorId: "github-user:123",
    repositoryId: "github-repository:R_repo",
    workItemId: "work-item:reviewed-lane",
    deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId),
    canonicalBaseRevision: baseSha,
    laneRevision: headSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: 4,
    transitionCounter: 7,
    reviewRequestId,
    fenceRevision: claimDigest,
    transitionDigest: claimLedgerRevision,
    state: "reviewed",
  };
  const source = buildReviewedLaneRevisionSourceEvidence({
    repository: { fullName: "solo/repository", nodeId: "R_repo" },
    actor: { id: 123, login: "solo" },
    lease,
    authority,
    claim,
    pullRequest,
    rawCommit,
    localHeadSha: headSha,
    remoteHeadSha: headSha,
    clean: true,
  });
  return Object.freeze({ candidate, source, fixture: { authority, claim, lease, pullRequest } });
}

function cloudStatus(claims, ledgerDigest) {
  return { schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", claims, ledgerRevision: "d".repeat(40), ledgerDigest };
}

function privateInventory(claims, owner) {
  return claims.map(({ transitionDigest, ...claim }) => ({
    ...claim,
    deviceId: owner.deviceId,
    sessionId: owner.sessionId,
    ledgerRevision: transitionDigest,
  }));
}
