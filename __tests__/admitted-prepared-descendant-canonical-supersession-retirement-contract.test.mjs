import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceState, authorizePlan, buildPlan, buildReceipt, createState, normalizePlan,
  normalizeState, phaseReceipt,
} from "../scripts/admitted-prepared-descendant-canonical-supersession-retirement-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const sha = value => value.repeat(40).slice(0, 40);
const digest = value => value.repeat(64).slice(0, 64);

function fixture() {
  const base = sha("1"), fence = sha("2"), integration = sha("3"), tree = sha("4");
  const protectedRevision = sha("5"), witness = sha("6"), sourceDependency = sha("7");
  const canonicalDependency = sha("8"), targetDependency = sha("9");
  const path = "docs/runtime-readiness-contract.md";
  const taskSubject = `urn:agentic-task:${digest("a")}`;
  const successorCapability = {
    authoritySubjectId: `urn:agentic-task:${digest("b")}`,
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
    generation: 1,
    publicKeyDigest: digest("c"),
    issuedAt: "2026-08-28T09:00:00.000Z",
  };
  return {
    mode: "normal", recovery: null,
    observedAt: "2026-08-28T10:00:00.000Z",
    subject: {
      repository: "owner/repo", path: "/work/source", branch: "agent/device/source",
      headSha: integration, treeSha: tree, parentSha: fence, remoteHeadSha: integration,
      changedPaths: [path], clean: true, registered: true, stateDigest: digest("d"),
      lease: {
        status: "active", epoch: 3, sessionId: "session", device: "device", scope: "old-pin",
        branch: "agent/device/source",
        worktreePath: "/work/source", baseSha: base, fenceSha: fence,
        pullRequestUrl: "https://example.test/pull/7", autoDelivery: true,
        runtimeRequired: true, acquiredAt: "2026-08-28T08:00:00.000Z",
        admissionStatus: "admitted", semanticScope: "old-pin", claimId: digest("e"),
        declaredWriteSet: [`path:${path}`, "semantic:old-pin"], writeSetDigest: digest("f"),
        manifestDigest: digest("0"), taskAuthoritySubjectId: taskSubject,
        taskAuthorityBindingDigest: digest("1"), leaseDigest: digest("2"),
      },
      integration: {
        schema: "agentic-integration-commit/v1", commitSha: integration, treeSha: tree,
        parentSha: fence, commitMessage: "chore(runtime): pin dependency",
        manifestDigest: digest("6"), stagedDiffDigest: digest("3"), paths: [path],
        recordedAt: "2026-08-28T08:00:00.000Z",
      },
      claim: {
        claimId: digest("e"), claimDigest: digest("4"), state: "current", writeAuthority: true,
        scopeReserved: true, laneRevision: fence, canonicalBaseRevision: base,
        transitionCounter: 3, reviewRequestId: "github-pull-request:PR_7",
        expiresAt: "2026-08-28T11:00:00.000Z",
      },
      pullRequest: {
        number: 7, nodeId: "PR_7", url: "https://example.test/pull/7", state: "OPEN",
        isDraft: true, mergedAt: null, closedAt: null, closeEvent: null,
        headBranch: "agent/device/source", headSha: integration,
        baseBranch: "main", baseSha: base,
      },
      sourceAuthority: {
        bindingDigest: digest("1"), proofDigest: digest("5"), operation: "observe-source",
        verifiedAt: "2026-08-28T09:30:00.000Z",
      },
    },
    canonical: {
      protectedRevision, protectedTreeSha: sha("a"), sourceBaseRevision: base,
      integrationWitnessRevision: witness, sourceBaseAncestor: true, witnessAncestor: true,
      dependencySourceRevision: sourceDependency,
      dependencyCanonicalRevision: canonicalDependency,
      targetDependencyRevision: targetDependency,
      dependencySourceAncestor: true, dependencyCanonicalAncestor: true,
      entries: [{
        path, subjectBlobSha: sha("b"), witnessBlobSha: sha("b"), canonicalBlobSha: sha("c"),
        fieldParent: "docs_dependency", fieldKey: "ref", subjectValue: sourceDependency,
        canonicalValue: canonicalDependency, targetValue: targetDependency,
        normalizedDocumentDigest: digest("6"),
      }],
      stateDigest: digest("7"),
    },
    successor: {
      semanticScope: "final-pin", targetRevision: targetDependency,
      expectedCanonicalRevision: protectedRevision, sourceIntegrationRevision: integration,
      paths: [path], manifestDigest: digest("8"), writeSetDigest: digest("9"),
      capability: successorCapability, capabilityDigest: digestValue(successorCapability),
      stateDigest: digest("a"),
    },
    controller: {
      headSha: targetDependency, originMainSha: targetDependency, treeSha: sha("d"),
      runtimeDigest: digest("b"), clean: true, protected: true,
    },
    cloud: {
      ledgerRepository: "owner/ledger", ledgerRevision: sha("e"), ledgerDigest: digest("c"),
      sequence: 4,
    },
  };
}

test("plan seals one exact prepared descendant and fresh covering successor", () => {
  const plan = buildPlan(fixture());
  assert.equal(authorizePlan(plan, plan.exactAuthorization).planDigest, plan.planDigest);
  assert.equal(normalizePlan(plan).planDigest, plan.planDigest);
  assert.equal(normalizeState(createState(plan)).phase, "planned");
  assert.deepEqual(plan.effects,
    ["retire-cloud-claim", "close-pull-request", "release-local-lease"]);
  assert.equal(plan.preservation.subjectTree, "preserved");
  assert.notEqual(plan.subject.lease.manifestDigest, plan.subject.integration.manifestDigest);
  assert.match(plan.exactAuthorization,
    /^authorize admitted-prepared-descendant-canonical-supersession-retirement [0-9a-f]{64}$/u);
});

test("plan rejects foreign descendants and prepared-integration drift", () => {
  const foreign = fixture();
  const descendant = sha("f");
  foreign.subject.headSha = descendant;
  foreign.subject.remoteHeadSha = descendant;
  foreign.subject.pullRequest.headSha = descendant;
  foreign.subject.integration.commitSha = descendant;
  assert.throws(() => buildPlan(foreign), /exactly cover/u);

  const wrongParent = fixture();
  wrongParent.subject.integration.parentSha = sha("0");
  assert.throws(() => buildPlan(wrongParent), /prepared descendant/u);

  const wrongClaim = fixture();
  wrongClaim.subject.lease.claimId = digest("0");
  assert.throws(() => buildPlan(wrongClaim), /prepared descendant/u);
});

test("plan accepts only an exact expiry-derived dormant-preserved claim", () => {
  const dormant = fixture();
  dormant.subject.claim.state = "dormant-preserved";
  dormant.subject.claim.writeAuthority = false;
  dormant.subject.claim.expiresAt = "2026-08-28T09:59:59.000Z";
  assert.equal(buildPlan(dormant).subject.claim.state, "dormant-preserved");

  const premature = structuredClone(dormant);
  premature.subject.claim.expiresAt = "2026-08-28T10:00:01.000Z";
  assert.throws(() => buildPlan(premature), /not expiry-derived/u);
  for (const [state, writeAuthority] of [["dormant-preserved", true], ["current", false]]) {
    const foreign = fixture(); foreign.subject.claim.state = state;
    foreign.subject.claim.writeAuthority = writeAuthority;
    assert.throws(() => buildPlan(foreign), /prepared descendant/u);
  }
});

test("plan seals an exact abandoned partial recovery with no live claim", () => {
  const preclosed = fixture();
  preclosed.mode = "partial-recovery";
  preclosed.subject.claim = null;
  preclosed.subject.pullRequest.state = "CLOSED";
  preclosed.subject.pullRequest.closedAt = "2026-08-28T09:59:58.000Z";
  preclosed.subject.pullRequest.closeEvent = {
    eventId: 30175235971, nodeId: "CE_close", actorLogin: "owner", actorId: 8945812,
    actorType: "User", createdAt: "2026-08-28T09:59:59.000Z", performedViaGitHubApp: null,
  };
  preclosed.recovery = {
    retirementEntryDigest: digest("1"), claimId: preclosed.subject.lease.claimId,
    claimDigest: digest("2"), state: "retired", canonicalBaseRevision: preclosed.subject.lease.baseSha,
    laneRevision: preclosed.subject.lease.fenceSha,
    writeSetDigest: preclosed.subject.lease.writeSetDigest,
    declaredWriteScope: preclosed.subject.lease.declaredWriteSet,
    deviceId: "device", sessionId: "session", transitionCounter: 4,
    reviewRequestId: "github-pull-request:PR_7", reason: "abandoned",
    finalRevision: preclosed.subject.lease.fenceSha, integrationReceiptDigest: null,
    bytesDigest: digest("3"), namedChecksDigest: digest("4"), handoffEvidenceDigest: digest("5"),
    idempotencyKey: digest("6"), retiredAt: "2026-08-28T09:59:57.000Z",
  };
  const plan = buildPlan(preclosed);
  assert.deepEqual(plan.effects, ["release-local-lease"]);
  assert.equal(plan.subject.pullRequest.closeEvent.eventId, 30175235971);

  const foreign = structuredClone(preclosed);
  foreign.subject.pullRequest.closeEvent.actorLogin = "foreign";
  assert.throws(() => buildPlan(foreign), /prepared descendant/u);

  const future = structuredClone(preclosed);
  future.subject.pullRequest.closeEvent.createdAt = "2026-08-28T10:00:01.000Z";
  assert.throws(() => buildPlan(future), /temporally joined/u);
});

test("plan rejects missing byte equivalence and unjoined field ancestry", () => {
  const wrongBlob = fixture();
  wrongBlob.canonical.entries[0].witnessBlobSha = sha("0");
  assert.throws(() => buildPlan(wrongBlob), /byte-equivalence/u);

  for (const [field, value] of [
    ["subjectValue", sha("0")], ["canonicalValue", sha("0")], ["targetValue", sha("0")],
  ]) {
    const changed = fixture();
    changed.canonical.entries[0][field] = value;
    assert.throws(() => buildPlan(changed), /byte-equivalence/u);
  }
});

test("successor capability must be fresh, distinct, generation one, and path complete", () => {
  const stale = fixture();
  stale.successor.capability.issuedAt = "2026-08-26T09:00:00.000Z";
  stale.successor.capabilityDigest = digestValue(stale.successor.capability);
  assert.throws(() => buildPlan(stale), /not fresh/u);

  const sameTask = fixture();
  sameTask.successor.capability.authoritySubjectId = sameTask.subject.lease.taskAuthoritySubjectId;
  sameTask.successor.capabilityDigest = digestValue(sameTask.successor.capability);
  assert.throws(() => buildPlan(sameTask), /exactly cover/u);

  const foreignPath = fixture();
  foreignPath.successor.paths = ["docs/foreign.md"];
  assert.throws(() => buildPlan(foreignPath), /exactly cover/u);
});

test("path evidence uses deterministic unsigned UTF-8 ordering", () => {
  const input = fixture();
  const astral = "docs/\u{10000}.md", privateUse = "docs/\u{e000}.md";
  const template = input.canonical.entries[0];
  input.subject.changedPaths = [astral, privateUse];
  input.subject.lease.declaredWriteSet = ["semantic:old-pin", `path:${astral}`, `path:${privateUse}`];
  input.subject.integration.paths = [astral, privateUse];
  input.canonical.entries = [{ ...template, path: astral }, { ...template, path: privateUse }];
  input.successor.paths = [astral, privateUse];
  const plan = buildPlan(input);
  assert.deepEqual(plan.subject.changedPaths, [privateUse, astral]);
  assert.deepEqual(plan.canonical.entries.map(entry => entry.path), [privateUse, astral]);
  assert.deepEqual(plan.successor.paths, [privateUse, astral]);
});

function terminalState() {
  let state = createState(buildPlan(fixture()));
  const plan = state.plan;
  state = advanceState(state, "authorized", phaseReceipt("authorized", {
    authorizationDigest: digestValue({
      planDigest: plan.planDigest,
      authorization: plan.exactAuthorization,
    }),
  }));
  state = advanceState(state, "source-authority-verified",
    phaseReceipt("source-authority-verified", {
      schema: "agentic-prepared-supersession-source-authority-receipt/v1",
      bindingDigest: plan.subject.sourceAuthority.bindingDigest, proofDigest: digest("1"),
      operation: `prepared-supersession-retirement:${plan.planDigest}:retire`,
      verifiedAt: "2026-08-28T10:00:01.000Z", subjectStateDigest: plan.subject.stateDigest,
    }));
  state = advanceState(state, "claim-retired", phaseReceipt("claim-retired", {
    schema: "agentic-prepared-supersession-claim-retirement-receipt/v1",
    claimId: plan.subject.claim.claimId, retirementEntryDigest: digest("e"),
    finalRevision: plan.subject.lease.fenceSha, ...plan.retirementEvidence,
    retirementReason: "superseded", providerMutation: true,
  }));
  state = advanceState(state, "pull-request-closed", phaseReceipt("pull-request-closed", {
    schema: "agentic-prepared-supersession-pull-request-close-receipt/v1",
    pullRequestNumber: plan.subject.pullRequest.number,
    pullRequestNodeId: plan.subject.pullRequest.nodeId,
    closedAt: "2026-08-28T10:01:00.000Z", providerMutation: true,
    closeEventDigest: digest("c"),
    remoteHeadSha: plan.subject.remoteHeadSha, subjectStateDigest: plan.subject.stateDigest,
  }));
  state = advanceState(state, "owner-released", phaseReceipt("owner-released", {
    schema: "agentic-prepared-supersession-owner-release-receipt/v1",
    leaseDigest: plan.subject.lease.leaseDigest, releasedLeaseDigest: digest("f"),
    releasedAt: "2026-08-28T10:02:00.000Z", localMutation: true,
    mode: "normal", retirementEntryDigest: null, retirementReason: "superseded",
    subjectStateDigest: plan.subject.stateDigest,
  }));
  const receipt = buildReceipt(state, digest("0"));
  return advanceState(state, "complete", phaseReceipt("complete", { receipt }));
}

test("state machine seals terminal evidence into a replay-verifiable receipt", () => {
  const state = terminalState(), receipt = state.receipts.complete.receipt;
  assert.equal(normalizeState(state).receipts.complete.receipt.receiptDigest, receipt.receiptDigest);
});

test("self-rehashed terminal journal cannot forge receipt lineage", () => {
  const forged = structuredClone(terminalState());
  forged.receipts.complete.receipt.planDigest = digest("f");
  const terminalCore = { ...forged.receipts.complete.receipt };
  delete terminalCore.receiptDigest;
  forged.receipts.complete.receipt.receiptDigest = digestValue(terminalCore);
  const phaseCore = { ...forged.receipts.complete };
  delete phaseCore.receiptDigest;
  forged.receipts.complete.receiptDigest = digestValue(phaseCore);
  const stateCore = { ...forged };
  delete stateCore.stateDigest;
  forged.stateDigest = digestValue(stateCore);
  assert.throws(() => normalizeState(forged), /terminal receipt is invalid/u);

  const forgedAuthorization = structuredClone(terminalState());
  forgedAuthorization.receipts.authorized = phaseReceipt("authorized", {
    authorizationDigest: digest("f"),
  });
  const forgedStateCore = { ...forgedAuthorization };
  delete forgedStateCore.stateDigest;
  forgedAuthorization.stateDigest = digestValue(forgedStateCore);
  assert.throws(() => normalizeState(forgedAuthorization), /authorized receipt is invalid/u);
});
