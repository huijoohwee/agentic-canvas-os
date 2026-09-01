import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceDormantOwnerContinuationJournal,
  authorizeDormantOwnerContinuation,
  buildDormantOwnerContinuationPlan,
  buildDormantOwnerContinuationResult,
  createDormantOwnerContinuationJournal,
  normalizeDormantOwnerContinuationJournal,
  normalizeDormantOwnerContinuationPlan,
} from "../scripts/successor-rollover-dormant-owner-continuation-contract.mjs";
import { normalizeDormantOwnerContinuationEvidence }
  from "../scripts/successor-rollover-dormant-owner-continuation-evidence.mjs";

test("seals exact authorization and the complete same-owner phase chain", () => {
  const plan = buildDormantOwnerContinuationPlan({ evidence: evidence(), ttlSeconds: 1_800 });
  assert.deepEqual(normalizeDormantOwnerContinuationPlan(plan), plan);
  assert.throws(
    () => authorizeDormantOwnerContinuation({ plan, authorization: "authorize broad recovery" }),
    /exact authorization/u,
  );
  let journal = createDormantOwnerContinuationJournal(plan, plan.exactAuthorization);
  journal = advanceDormantOwnerContinuationJournal(journal, "task-authority-verified", {
    taskAuthorityReceiptDigest: digest("task proof"),
  });
  journal = advanceDormantOwnerContinuationJournal(journal, "cloud-recovered", {
    claimDigest: digest("renewed claim"),
    cloudReceiptDigest: digest("cloud receipt"),
    expiresAt: "2026-09-01T00:00:00.000Z",
  });
  journal = advanceDormantOwnerContinuationJournal(journal, "local-cas", {
    leaseDigest: digest("renewed lease"),
    registryRevision: 10,
    taskAuthorityBindingDigest: digest("renewed binding"),
  });
  journal = advanceDormantOwnerContinuationJournal(journal, "pr-marker", {
    bodyDigest: digest("body"),
    pullRequestMarkerDigest: digest("marker"),
  });
  journal = advanceDormantOwnerContinuationJournal(journal, "verified", {
    claimDigest: digest("renewed claim"),
    leaseDigest: digest("renewed lease"),
    pullRequestMarkerDigest: digest("marker"),
    verificationDigest: digest("verification"),
  });
  journal = advanceDormantOwnerContinuationJournal(journal, "complete", {
    completionDigest: digest("completion"),
  });
  assert.deepEqual(normalizeDormantOwnerContinuationJournal(journal), journal);
  const result = buildDormantOwnerContinuationResult(journal);
  assert.equal(result.status, "authoring-authority-restored");
  assert.equal(result.claimId, plan.claimId);
  assert.equal(result.tombstoneDigest, plan.evidenceSnapshot.rollover.tombstoneDigest);
});

test("rejects evidence, plan, journal, and phase drift", () => {
  const source = evidence();
  assert.deepEqual(normalizeDormantOwnerContinuationEvidence(source), source);
  const plan = buildDormantOwnerContinuationPlan({ evidence: source });
  const forgedPlan = structuredClone(plan);
  forgedPlan.sourceFenceSha = "f".repeat(40);
  assert.throws(() => normalizeDormantOwnerContinuationPlan(forgedPlan), /plan projection/u);
  const journal = createDormantOwnerContinuationJournal(plan, plan.exactAuthorization);
  assert.throws(
    () => advanceDormantOwnerContinuationJournal(journal, "cloud-recovered", {}),
    /cannot advance/u,
  );
  const forgedJournal = structuredClone(journal);
  forgedJournal.receipts.authorized.values.authorizationDigest = digest("forged");
  assert.throws(
    () => normalizeDormantOwnerContinuationJournal(forgedJournal),
    /receipt seal/u,
  );
  const forgedEvidence = structuredClone(source);
  forgedEvidence.cloud.anchorClaimId = digest("other claim");
  const { evidenceDigest: ignored, ...core } = forgedEvidence;
  void ignored;
  forgedEvidence.evidenceDigest = digestValue(core);
  assert.throws(
    () => normalizeDormantOwnerContinuationEvidence(forgedEvidence),
    /cross join/u,
  );
});

export function evidence() {
  const claimId = digest("claim");
  const writeSetDigest = digest("write set");
  const core = {
    schema: "agentic-successor-rollover-dormant-owner-continuation-evidence/v1",
    repository: "/repository",
    controllerRoot: "/controller",
    source: {
      branch: "agent/device/scope",
      sessionId: "session",
      worktreePath: "/repository",
      leaseDigest: digest("lease"),
      claimId,
      claimDigest: digest("claim digest"),
      transitionCounter: 2,
      localEpoch: 7,
      cloudLeaseEpoch: 1,
      baseSha: sha("base"),
      fenceSha: sha("fence"),
      writeSetDigest,
      manifestDigest: digest("manifest"),
      reviewRequestId: "PR_test",
      taskAuthorityBindingDigest: digest("binding"),
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
    rollover: {
      continuationPlanDigest: digest("continuation"),
      rolloverJournalDigest: digest("rollover journal"),
      replacementPlanDigest: digest("replacement"),
      historicalBindProofDigest: digest("historical"),
      tombstoneDigest: digest("tombstone"),
      tombstoneReceiptDigest: digest("tombstone receipt"),
    },
    promotion: {
      journalDigest: digest("promotion journal"),
      resultDigest: digest("promotion result"),
      bridgeClaimId: digest("bridge"),
      successorClaimId: digest("successor"),
    },
    pullRequest: {
      id: "PR_test", number: 808, url: "https://github.com/o/r/pull/808",
      state: "OPEN", isDraft: true, autoMergeRequest: null,
      headBranch: "agent/device/scope", headSha: sha("fence"), baseSha: sha("pr base"),
      etag: "\"etag\"", bodyDigest: digest("body"),
      bodyRemainderDigest: digest("remainder"), markerDigest: digest("marker"),
      markerClaimId: claimId,
    },
    dirt: { evidenceDigest: digest("dirt") },
    controller: { evidenceDigest: digest("controller") },
    cloud: {
      topologyDigest: digest("topology"), anchorClaimId: claimId,
      anchorWriteSetDigest: writeSetDigest,
    },
    registryRevision: 9,
    observedAt: "2026-08-31T00:00:00.000Z",
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

function digest(value) { return digestValue({ value }); }
function sha(value) { return digest(value).slice(0, 40); }
