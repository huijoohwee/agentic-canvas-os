import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { authorizePlan, buildPlan, createState, normalizePlan, normalizeState }
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
