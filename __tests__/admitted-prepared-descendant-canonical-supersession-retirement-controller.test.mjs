import assert from "node:assert/strict";
import test from "node:test";

import { createController, normalizePullCloseChronology, normalizeProviderInstant } from
  "../scripts/admitted-prepared-descendant-canonical-supersession-retirement-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const sha = value => value.repeat(40).slice(0, 40);
const digest = value => value.repeat(64).slice(0, 64);

function fixture() {
  const path = "docs/runtime-readiness-contract.md", base = sha("1"), fence = sha("2");
  const integration = sha("3"), target = sha("9"), protectedRevision = sha("5");
  const source = sha("7"), canonical = sha("8");
  const capability = { authoritySubjectId: `urn:agentic-task:${digest("b")}`,
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
    publicKeyDigest: digest("c"), issuedAt: "2026-08-28T09:00:00.000Z" };
  return { mode: "normal", recovery: null, observedAt: "2026-08-28T10:00:00.000Z", subject: {
    repository: "owner/repo", path: "/work/source", branch: "agent/device/source",
    headSha: integration, treeSha: sha("4"), parentSha: fence, remoteHeadSha: integration,
    changedPaths: [path], clean: true, registered: true, stateDigest: digest("d"), lease: {
      status: "active", epoch: 3, sessionId: "session", device: "device", scope: "old-pin",
      branch: "agent/device/source",
      worktreePath: "/work/source", baseSha: base, fenceSha: fence, admissionStatus: "admitted",
      pullRequestUrl: "https://example.test/pull/7", autoDelivery: true,
      runtimeRequired: true, acquiredAt: "2026-08-28T08:00:00.000Z",
      semanticScope: "old-pin", claimId: digest("e"), declaredWriteSet: [`path:${path}`, "semantic:old-pin"],
      writeSetDigest: digest("f"), manifestDigest: digest("0"),
      taskAuthoritySubjectId: `urn:agentic-task:${digest("a")}`,
      taskAuthorityBindingDigest: digest("1"), leaseDigest: digest("2") },
    integration: { schema: "agentic-integration-commit/v1", commitSha: integration,
      treeSha: sha("4"), parentSha: fence, commitMessage: "chore(runtime): pin dependency",
      manifestDigest: digest("6"), stagedDiffDigest: digest("3"), paths: [path],
      recordedAt: "2026-08-28T08:00:00.000Z" },
    claim: { claimId: digest("e"), claimDigest: digest("4"), state: "current",
      writeAuthority: true, scopeReserved: true, laneRevision: fence,
      canonicalBaseRevision: base, transitionCounter: 3,
      reviewRequestId: "github-pull-request:PR_7", expiresAt: "2026-08-28T11:00:00.000Z" },
    pullRequest: { number: 7, nodeId: "PR_7", url: "https://example.test/pull/7",
      state: "OPEN", isDraft: true, mergedAt: null, closedAt: null, closeEvent: null,
      headBranch: "agent/device/source",
      headSha: integration, baseBranch: "main", baseSha: base },
    sourceAuthority: { bindingDigest: digest("1"), proofDigest: digest("5"),
      operation: "observe-source", verifiedAt: "2026-08-28T09:30:00.000Z" } },
  canonical: { protectedRevision, protectedTreeSha: sha("a"), sourceBaseRevision: base,
    integrationWitnessRevision: sha("6"), sourceBaseAncestor: true, witnessAncestor: true,
    dependencySourceRevision: source, dependencyCanonicalRevision: canonical,
    targetDependencyRevision: target, dependencySourceAncestor: true,
    dependencyCanonicalAncestor: true, entries: [{ path, subjectBlobSha: sha("b"),
      witnessBlobSha: sha("b"), canonicalBlobSha: sha("c"), fieldParent: "docs_dependency",
      fieldKey: "ref", subjectValue: source, canonicalValue: canonical, targetValue: target,
      normalizedDocumentDigest: digest("6") }], stateDigest: digest("7") },
  successor: { semanticScope: "final-pin", targetRevision: target,
    expectedCanonicalRevision: protectedRevision, sourceIntegrationRevision: integration,
    paths: [path], manifestDigest: digest("8"), writeSetDigest: digest("9"), capability,
    capabilityDigest: digestValue(capability), stateDigest: digest("a") },
  controller: { headSha: target, originMainSha: target, treeSha: sha("d"),
    runtimeDigest: digest("b"), clean: true, protected: true },
  cloud: { ledgerRepository: "owner/ledger", ledgerRevision: sha("e"),
    ledgerDigest: digest("c"), sequence: 4 } };
}

function partialFixture() {
  const value = fixture(), lease = value.subject.lease;
  value.mode = "partial-recovery"; value.subject.claim = null;
  value.subject.pullRequest.state = "CLOSED";
  value.subject.pullRequest.closedAt = "2026-08-28T09:59:58.000Z";
  value.subject.pullRequest.closeEvent = { eventId: 30175235971, nodeId: "CE_close",
    actorLogin: "owner", actorId: 8945812, actorType: "User",
    createdAt: "2026-08-28T09:59:59.000Z", performedViaGitHubApp: null };
  value.recovery = { retirementEntryDigest: digest("1"), claimId: lease.claimId,
    claimDigest: digest("2"), state: "retired", canonicalBaseRevision: lease.baseSha,
    laneRevision: lease.fenceSha, writeSetDigest: lease.writeSetDigest,
    declaredWriteScope: lease.declaredWriteSet, deviceId: "device", sessionId: "session",
    transitionCounter: 4, reviewRequestId: "github-pull-request:PR_7", reason: "abandoned",
    finalRevision: lease.fenceSha, integrationReceiptDigest: null, bytesDigest: digest("3"),
    namedChecksDigest: digest("4"), handoffEvidenceDigest: digest("5"),
    idempotencyKey: digest("6"), retiredAt: "2026-08-28T09:59:57.000Z" };
  return value;
}

function adapterFixture({ throwAfterClaim = false, throwAfterOwner = false, partial = false } = {}) {
  let state = null, claim = !partial, pull = !partial, owner = true;
  const calls = [], terminalEvidenceDigest = digestValue({ terminal: true });
  const adapter = {
    observe: async () => partial ? partialFixture() : fixture(),
    readState: async () => state,
    writeState: async ({ expected, next }) => {
      assert.equal(state?.stateDigest || null, expected?.stateDigest || null);
      state = next; return state;
    },
    withLock: async (_context, action) => action(),
    verifySourceAuthority: async plan => (calls.push("source"), {
      schema: "agentic-prepared-supersession-source-authority-receipt/v1",
      bindingDigest: plan.subject.sourceAuthority.bindingDigest, proofDigest: digest("a"),
      operation: `prepared-supersession-retirement:${plan.planDigest}:`
        + (plan.mode === "normal" ? "retire" : "partial-release"),
      verifiedAt: "2026-08-28T10:00:01.000Z", subjectStateDigest: plan.subject.stateDigest,
    }),
    classifyClaim: async plan => claim ? { state: "pending" }
      : { state: "complete", values: {
        schema: "agentic-prepared-supersession-claim-retirement-receipt/v1",
        claimId: plan.subject.lease.claimId,
        retirementEntryDigest: plan.recovery?.retirementEntryDigest ?? digest("b"),
        finalRevision: plan.subject.lease.fenceSha,
        bytesDigest: (plan.recovery || plan.retirementEvidence).bytesDigest,
        namedChecksDigest: (plan.recovery || plan.retirementEvidence).namedChecksDigest,
        handoffEvidenceDigest: (plan.recovery || plan.retirementEvidence).handoffEvidenceDigest,
        retirementReason: partial ? "abandoned" : "superseded", providerMutation: !partial,
      } },
    retireClaim: async () => { calls.push("claim"); claim = false;
      if (throwAfterClaim) throw new Error("response lost"); },
    classifyPullRequest: async plan => pull ? { state: "pending" }
      : { state: "complete", values: {
        schema: "agentic-prepared-supersession-pull-request-close-receipt/v1",
        pullRequestNumber: plan.subject.pullRequest.number,
        pullRequestNodeId: plan.subject.pullRequest.nodeId,
        closedAt: plan.subject.pullRequest.closedAt || "2026-08-28T10:01:00.000Z",
        closeEventDigest: plan.subject.pullRequest.closeEvent
          ? digestValue(plan.subject.pullRequest.closeEvent) : digest("c"), providerMutation: !partial,
        remoteHeadSha: plan.subject.remoteHeadSha, subjectStateDigest: plan.subject.stateDigest,
      } },
    closePullRequest: async () => { calls.push("pull"); pull = false; },
    classifyOwnerReleased: async plan => owner ? { state: "pending" }
      : { state: "complete", values: {
        schema: "agentic-prepared-supersession-owner-release-receipt/v1",
        leaseDigest: plan.subject.lease.leaseDigest, releasedLeaseDigest: digest("d"),
        releasedAt: "2026-08-28T10:02:00.000Z", localMutation: true,
        mode: plan.mode, retirementEntryDigest: plan.recovery?.retirementEntryDigest ?? null,
        retirementReason: partial ? "abandoned" : "superseded",
        subjectStateDigest: plan.subject.stateDigest,
      } },
    releaseOwner: async () => { calls.push("owner"); owner = false;
      if (throwAfterOwner) throw new Error("release response lost"); },
    verifyTerminal: async () => (calls.push("terminal"), { terminalEvidenceDigest }),
  };
  return { adapter, calls, state: () => state, setTerminal: value => {
    adapter.verifyTerminal = async () => ({ terminalEvidenceDigest: value });
  } };
}

test("controller performs authority verification before the three ordered effects", async () => {
  const scenario = adapterFixture(), controller = createController({ adapter: scenario.adapter });
  const plan = await controller.plan();
  const receipt = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.deepEqual(scenario.calls, ["source", "claim", "pull", "owner", "terminal"]);
  assert.equal(scenario.state().phase, "complete");
  assert.equal(receipt.planDigest, plan.planDigest);
});

test("wrong authorization has zero proof or mutation effects", async () => {
  const scenario = adapterFixture(), controller = createController({ adapter: scenario.adapter });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: "wrong" }),
    /Exact authorization/u);
  assert.deepEqual(scenario.calls, []);
  assert.equal(scenario.state().phase, "planned");
});

test("response loss converges through exact post-effect classification", async () => {
  const scenario = adapterFixture({ throwAfterClaim: true });
  const controller = createController({ adapter: scenario.adapter }), plan = await controller.plan();
  const receipt = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "complete");
  assert.equal(scenario.calls.filter(call => call === "claim").length, 1);
});

test("partial recovery executes only the local release and adopts response loss", async () => {
  const scenario = adapterFixture({ partial: true, throwAfterOwner: true });
  const controller = createController({ adapter: scenario.adapter }), plan = await controller.plan();
  assert.deepEqual(plan.effects, ["release-local-lease"]);
  const receipt = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.deepEqual(scenario.calls, ["source", "owner", "terminal"]);
  assert.equal(receipt.mode, "partial-recovery");
  assert.equal(receipt.retirementReason, "abandoned");
  assert.equal(receipt.retirementEntryDigest, plan.recovery.retirementEntryDigest);
});

test("terminal replay is idempotent but rejects terminal evidence drift", async () => {
  const scenario = adapterFixture(), controller = createController({ adapter: scenario.adapter });
  const plan = await controller.plan();
  const first = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  const replay = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, first.receiptDigest);
  assert.equal(scenario.calls.filter(call => call === "claim").length, 1);
  scenario.setTerminal(digest("0"));
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /terminal evidence drifted/u);
});

test("provider close timestamps converge from RFC3339 seconds and milliseconds", () => {
  const event = { event: "closed", eventId: 1, nodeId: "CE_close", actorLogin: "owner",
    actorId: 2, actorType: "User", createdAt: "2026-08-28T16:09:30Z",
    performedViaGitHubApp: null };
  const { event: _event, ...expected } = event;
  const result = normalizePullCloseChronology({ targetRepository: "owner/repo",
    pull: { state: "CLOSED", mergedAt: null, closedAt: "2026-08-28T16:09:29Z" },
    timeline: [event], observedAt: "2026-08-28T16:10:00Z",
    expectedCloseEvent: { ...expected, createdAt: "2026-08-28T16:09:30.000Z" } });
  assert.equal(result.createdAt, "2026-08-28T16:09:30.000Z");
  assert.equal(normalizeProviderInstant("2026-08-28T16:09:29.123Z"), "2026-08-28T16:09:29.123Z");
  for (const value of ["2026-08-28T16:09:29+00:00", "2026-08-28t16:09:29z",
    "2026-08-28 16:09:29Z", "2026-08-28T16:09:29.1Z", "2026-08-28T16:09:29.12Z",
    "2026-08-28T16:09:29.1234Z", "2026-02-30T16:09:29Z", "2026-08-28T16:09:60Z"])
    assert.throws(() => normalizeProviderInstant(value), /Provider timestamp/u);
  assert.throws(() => normalizePullCloseChronology({ targetRepository: "owner/repo",
    pull: { state: "CLOSED", mergedAt: null, closedAt: "2026-08-28T16:09:29Z" }, timeline: [event],
    expectedCloseEvent: { ...expected, createdAt: "2026-08-28T16:09:30.001Z" } }), /drifted/u);
});
