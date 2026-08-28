import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { advanceResumeState, advanceState, authorizePlan, authorizeResumePlan, buildPlan,
  buildReceipt, buildResumePlan, buildResumeReceipt, createResumeState, createState,
  normalizePlan, normalizeResumePlan, normalizeResumeState, normalizeState, phaseReceipt,
  RESUME_RECEIPT_SCHEMA }
  from "../scripts/admitted-empty-abandoned-owner-retirement-contract.mjs";

const sha = value => value.repeat(40).slice(0, 40), digest = value => value.repeat(64).slice(0, 64);
function fixture() { const base = sha("1"), head = sha("2"), tree = sha("3"), lease = { status: "active",
  sessionId: "session", branch: "agent/device/empty", worktreePath: "/work/empty", baseSha: base,
  fenceSha: head, expiresAt: "2026-08-23T10:00:00.000Z", admissionStatus: "planned",
  claimId: digest("a"), digest: digest("b") }; return { observedAt: "2026-08-23T11:00:00.000Z",
  subject: { repository: "owner/repo", path: "/work/empty", branch: lease.branch, headSha: head,
    headTreeSha: tree, baseSha: base, baseTreeSha: tree, parentShas: [base], changedPaths: [],
    clean: true, registered: true, remoteHeadSha: head, stateDigest: digest("c"), lease,
    claim: { claimId: lease.claimId, claimDigest: digest("d"), state: "dormant-preserved",
      writeAuthority: false, scopeReserved: true, laneRevision: base, canonicalBaseRevision: base,
      transitionCounter: 1, reviewRequestId: null, expiresAt: "2026-08-23T10:00:00.000Z" },
    pullRequest: { number: 7, nodeId: "PR_7", url: "https://example.test/pull/7", state: "OPEN",
      isDraft: true, mergedAt: null, headBranch: lease.branch, headSha: head, baseBranch: "main", baseSha: base } },
  authoredLane: { path: "/work/authored", branch: "agent/device/authored", headSha: sha("4"),
    treeSha: sha("5"), clean: true, registered: true, statusDigest: digest("e"), stateDigest: digest("f") },
  controller: { headSha: sha("6"), originMainSha: sha("6"), treeSha: sha("7"),
    runtimeDigest: digest("8"), clean: true, protected: true },
  cloud: { ledgerRepository: "owner/ledger", ledgerRevision: sha("9"), ledgerDigest: digest("9"), sequence: 3 } }; }

function partialState(input = fixture()) {
  const plan = buildPlan(input);
  let state = createState(plan);
  state = advanceState(state, "authorized", phaseReceipt("authorized", {
    authorizationDigest: digest("1"),
  }));
  state = advanceState(state, "claim-retired", phaseReceipt("claim-retired", {
    claimId: plan.subject.claim.claimId, cloudMutation: true,
    subjectStateDigest: plan.subject.stateDigest,
  }));
  return advanceState(state, "pull-request-closed", phaseReceipt("pull-request-closed", {
    pullRequestNumber: plan.subject.pullRequest.number,
    closedAt: "2026-08-23T11:02:00.000Z", providerMutation: true,
    remoteBranchPreserved: true,
  }));
}

function resumeEvidence(sourceState = partialState()) {
  const plan = sourceState.plan;
  return { observedAt: "2026-08-23T12:00:00.000Z", sourceState,
    controller: { ...plan.controller, headSha: sha("a"), originMainSha: sha("a"),
      treeSha: sha("b"), runtimeDigest: digest("c") },
    cloud: { ...plan.cloud, ledgerRevision: sha("d"), ledgerDigest: digest("d"), sequence: 4 },
    recovery: { sourceStateDigest: sourceState.stateDigest, sourcePlanDigest: plan.planDigest,
      claimAbsent: true, retirementEntryDigest: digest("e"), pullRequestState: "CLOSED",
      pullRequestClosedAt: sourceState.receipts["pull-request-closed"].closedAt,
      leaseStatus: "active", leaseDigest: plan.subject.lease.digest,
      taskAuthorityBindingDigest: digest("f"), subjectStateDigest: plan.subject.stateDigest,
      authoredLaneStateDigest: plan.authoredLane.stateDigest, remoteHeadSha: plan.subject.remoteHeadSha } };
}

test("plan seals the fence-only subject, distinct authored lane, and exact authorization", () => {
  const plan = buildPlan(fixture());
  assert.equal(authorizePlan(plan, plan.exactAuthorization).planDigest, plan.planDigest);
  assert.equal(normalizeState(createState(plan)).plan.planDigest, plan.planDigest);
  assert.equal(normalizePlan(plan).planDigest, plan.planDigest);
  assert.equal(plan.preservation.subjectTree, "preserved");
});

test("planning accepts the exact pull-request-bound fence projection", () => {
  const recovered = fixture();
  recovered.subject.claim.laneRevision = recovered.subject.headSha;
  recovered.subject.claim.reviewRequestId =
    `github-pull-request:${recovered.subject.pullRequest.nodeId}`;
  const plan = buildPlan(recovered);
  assert.equal(plan.subject.claim.laneRevision, recovered.subject.headSha);
  assert.equal(plan.subject.claim.reviewRequestId, "github-pull-request:PR_7");
  assert.equal(normalizePlan(plan).planDigest, plan.planDigest);
});

test("planning rejects fence, base, and pull-request projection drift", () => {
  const wrongFence = fixture();
  wrongFence.subject.claim.laneRevision = sha("4");
  wrongFence.subject.claim.reviewRequestId = "github-pull-request:PR_7";
  assert.throws(() => buildPlan(wrongFence), /fence-only/u);

  const wrongBase = fixture();
  wrongBase.subject.claim.canonicalBaseRevision = sha("4");
  assert.throws(() => buildPlan(wrongBase), /fence-only/u);

  for (const reviewRequestId of [null, "github-pull-request:PR_FOREIGN", "PR_7"]) {
    const wrongReview = fixture();
    wrongReview.subject.claim.laneRevision = wrongReview.subject.headSha;
    wrongReview.subject.claim.reviewRequestId = reviewRequestId;
    assert.throws(() => buildPlan(wrongReview), /fence-only/u);
  }

  const mixedLegacy = fixture();
  mixedLegacy.subject.claim.reviewRequestId = "github-pull-request:PR_7";
  assert.throws(() => buildPlan(mixedLegacy), /fence-only/u);
});

test("planning rejects source bytes, live authority, and lane conflation", () => {
  const changed = fixture(); changed.subject.changedPaths = ["source.ts"];
  assert.throws(() => buildPlan(changed), /fence-only/u);
  const live = fixture(); live.subject.claim.writeAuthority = true;
  assert.throws(() => buildPlan(live), /fence-only/u);
  const conflated = fixture(); conflated.authoredLane.path = conflated.subject.path;
  assert.throws(() => buildPlan(conflated), /distinct/u);
});

test("plan digest changes when preserved authored evidence changes", () => {
  const first = buildPlan(fixture()), changed = fixture(); changed.authoredLane.stateDigest = digestValue({ changed: true });
  assert.notEqual(buildPlan(changed).planDigest, first.planDigest);
});

test("resume seals the partial receipt lineage and requires fresh exact authorization", () => {
  const plan = buildResumePlan(resumeEvidence());
  assert.equal(authorizeResumePlan(plan, plan.exactAuthorization).planDigest, plan.planDigest);
  assert.match(plan.exactAuthorization,
    /^authorize admitted-empty-abandoned-owner-retirement-resume [0-9a-f]{64}$/u);
  assert.equal(normalizeResumeState(createResumeState(plan)).phase, "planned");
  assert.equal(plan.remainingEffects[0], "release-local-lease");

  const wrongClose = resumeEvidence();
  wrongClose.recovery.pullRequestClosedAt = "2026-08-23T11:03:00.000Z";
  assert.throws(() => buildResumePlan(wrongClose), /partial source journal/u);

  const wrongAuthoredLane = resumeEvidence();
  wrongAuthoredLane.recovery.authoredLaneStateDigest = digest("0");
  assert.throws(() => buildResumePlan(wrongAuthoredLane), /partial source journal/u);

  for (const field of ["retirementEntryDigest", "taskAuthorityBindingDigest"]) {
    const changed = structuredClone(plan);
    changed.recovery[field] = digest("0");
    assert.throws(() => normalizeResumePlan(changed), /invalid or drifted/u);
  }
});

test("resume admits only a sealed protected-main authored descendant", () => {
  const input = fixture();
  input.authoredLane = { ...input.authoredLane, path: "/controller", branch: "main",
    headSha: input.controller.headSha, treeSha: input.controller.treeSha,
    stateDigest: digest("0") };
  const evidence = resumeEvidence(partialState(input));
  evidence.recovery = { ...evidence.recovery,
    authoredLaneDisposition: "protected-main-descendant",
    authoredLaneStateDigest: digest("1"),
    authoredLaneHeadSha: evidence.controller.headSha,
    authoredLaneTreeSha: evidence.controller.treeSha };
  const plan = buildResumePlan(evidence);
  assert.equal(plan.recovery.authoredLaneDisposition, "protected-main-descendant");
  assert.equal(plan.recovery.authoredLaneHeadSha, evidence.controller.headSha);

  for (const [field, value] of [["authoredLaneHeadSha", sha("0")],
    ["authoredLaneTreeSha", sha("0")], ["authoredLaneDisposition", "foreign"]]) {
    const changed = structuredClone(evidence);
    changed.recovery[field] = value;
    assert.throws(() => buildResumePlan(changed), /authored lane|partial source journal/u);
  }

  for (const field of ["branch", "headSha", "treeSha"]) {
    const changedInput = fixture();
    changedInput.authoredLane = { ...input.authoredLane,
      [field]: field === "branch" ? "agent/device/authored" : sha("0") };
    const changed = resumeEvidence(partialState(changedInput));
    changed.recovery = { ...changed.recovery,
      authoredLaneDisposition: "protected-main-descendant",
      authoredLaneStateDigest: digest("1"), authoredLaneHeadSha: changed.controller.headSha,
      authoredLaneTreeSha: changed.controller.treeSha };
    assert.throws(() => buildResumePlan(changed), /partial source journal/u);
  }
});

test("ordinary and resume terminal receipt schemas cannot cross state machines", () => {
  let ordinary = partialState();
  ordinary = advanceState(ordinary, "owner-released", phaseReceipt("owner-released", {
    leaseDigest: digest("a"), localMutation: true,
  }));
  const terminal = buildReceipt(ordinary, digest("b"));
  ordinary = advanceState(ordinary, "complete", phaseReceipt("complete", { receipt: terminal }));
  const crossedOrdinary = structuredClone(ordinary);
  crossedOrdinary.receipts.complete.receipt.schema = RESUME_RECEIPT_SCHEMA;
  const terminalCore = { ...crossedOrdinary.receipts.complete.receipt };
  delete terminalCore.receiptDigest;
  crossedOrdinary.receipts.complete.receipt.receiptDigest = digestValue(terminalCore);
  const phaseCore = { ...crossedOrdinary.receipts.complete };
  delete phaseCore.receiptDigest;
  crossedOrdinary.receipts.complete.receiptDigest = digestValue(phaseCore);
  const stateCore = { ...crossedOrdinary };
  delete stateCore.stateDigest;
  crossedOrdinary.stateDigest = digestValue(stateCore);
  assert.throws(() => normalizeState(crossedOrdinary), /Terminal receipt is invalid/u);

  const resumePlan = buildResumePlan(resumeEvidence());
  let resumed = createResumeState(resumePlan);
  resumed = advanceResumeState(resumed, "authorized", phaseReceipt("authorized", {
    authorizationDigest: digest("c"),
  }));
  resumed = advanceResumeState(resumed, "owner-released", phaseReceipt("owner-released", {
    leaseDigest: digest("d"), localMutation: true,
  }));
  const resumeReceipt = buildResumeReceipt(resumed, digest("e"));
  resumed = advanceResumeState(resumed, "complete", phaseReceipt("complete", { receipt: resumeReceipt }));
  assert.equal(normalizeResumeState(resumed).receipts.complete.receipt.schema, RESUME_RECEIPT_SCHEMA);
});
