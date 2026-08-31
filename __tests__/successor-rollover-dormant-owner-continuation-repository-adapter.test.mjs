import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildDormantOwnerContinuationPlan }
  from "../scripts/successor-rollover-dormant-owner-continuation-contract.mjs";
import { classifyDormantOwnerContinuationLease }
  from "../scripts/successor-rollover-dormant-owner-continuation-repository-adapter.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

test("classifies only the exact source or same-claim monotonic recovered lease", () => {
  const lease = sourceLease();
  const plan = buildDormantOwnerContinuationPlan({
    evidence: evidenceFor(lease),
    ttlSeconds: 1_800,
  });
  assert.equal(classifyDormantOwnerContinuationLease({ lease, plan }), "source");
  const recovered = {
    ...lease,
    epoch: lease.epoch + 1,
    heartbeatAt: "2026-08-31T00:01:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    cloudAuthority: {
      ...lease.cloudAuthority,
      claimDigest: d("renewed claim"),
      transitionCounter: lease.cloudAuthority.transitionCounter + 1,
      state: "active",
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
    taskAuthority: {
      ...lease.taskAuthority,
      bindingMode: "continuation",
      priorBindingDigest: lease.taskAuthority.bindingDigest,
      bindingDigest: d("continued binding"),
    },
  };
  assert.equal(classifyDormantOwnerContinuationLease({
    lease: recovered,
    plan,
    now: new Date("2026-08-31T01:00:00.000Z"),
  }), "recovered");
  assert.throws(
    () => classifyDormantOwnerContinuationLease({
      lease: { ...recovered, cloudAuthority: { ...recovered.cloudAuthority, claimId: d("new claim") } },
      plan,
    }),
    /source or recovered lease state/u,
  );
  assert.throws(
    () => classifyDormantOwnerContinuationLease({
      lease: { ...recovered, taskAuthority: { ...recovered.taskAuthority, priorBindingDigest: d("other") } },
      plan,
    }),
    /source or recovered lease state/u,
  );
});

function sourceLease() {
  const writeSet = ["path:scripts/owned.mjs", "semantic:scope"];
  return {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "session", device: "device", scope: "scope", branch: "agent/device/scope",
    worktreePath: "/repository", baseSha: s("base"), fenceSha: s("fence"),
    pullRequestUrl: "https://github.com/o/r/pull/808", autoDelivery: false,
    runtimeRequired: false, acquiredAt: "2026-01-01T00:00:00.000Z",
    heartbeatAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z",
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "scope", declaredWriteSet: writeSet, writeSetDigest: digestValue(writeSet),
      manifestDigest: d("manifest"), planReceiptDigest: d("plan receipt"),
      admissionReceiptDigest: d("admission receipt"), existingLaneStateDigest: d("lanes"),
      admittedReportDigest: d("report"), preservationReceiptDigest: d("preservation") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "o/r", targetRepository: "o/r", claimId: d("claim"),
      claimDigest: d("claim digest"), ledgerRevision: s("ledger"), ledgerDigest: d("ledger digest"),
      claimLedgerRevision: d("claim ledger"), entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest: d("op"),
      mutationAuthorityEligible: true, canonicalBaseSha: s("base"), laneRevision: s("fence"),
      cloudDeclaredWriteScope: writeSet, writeSetDigest: digestValue(writeSet), deviceId: "device",
      sessionId: "session", reviewRequestId: "PR_test", leaseEpoch: 1,
      transitionCounter: 2, state: "active", expiresAt: "2026-01-01T01:00:00.000Z",
      integrationReceiptDigest: null, integration: null, manifestDigest: d("manifest") },
    taskAuthority: { schema: "agentic-task-authority-binding/v1", authoritySubjectId: "urn:task",
      proofAdapterId: "urn:proof", generation: 1, publicKey: "key", publicKeyDigest: d("key"),
      laneBindingDigest: d("lane"), bindingMode: "claim", boundAt: "2026-01-01T00:00:00.000Z",
      transitionPlanDigest: null, priorBindingDigest: null, bindingDigest: d("binding") },
  };
}

function evidenceFor(lease) {
  const core = { schema: "agentic-successor-rollover-dormant-owner-continuation-evidence/v1",
    repository: "/repository", controllerRoot: "/controller",
    source: { branch: lease.branch, sessionId: lease.sessionId, worktreePath: lease.worktreePath,
      leaseDigest: writerLeaseDigest(lease), claimId: lease.cloudAuthority.claimId,
      claimDigest: lease.cloudAuthority.claimDigest, transitionCounter: 2, localEpoch: 7,
      cloudLeaseEpoch: 1, baseSha: lease.baseSha, fenceSha: lease.fenceSha,
      writeSetDigest: lease.admission.writeSetDigest, manifestDigest: lease.admission.manifestDigest,
      reviewRequestId: "PR_test", taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      expiresAt: lease.expiresAt },
    rollover: { continuationPlanDigest: d("continuation"), rolloverJournalDigest: d("journal"),
      replacementPlanDigest: d("replacement"), historicalBindProofDigest: d("history"),
      tombstoneDigest: d("tombstone"), tombstoneReceiptDigest: d("receipt") },
    promotion: { journalDigest: d("promotion"), resultDigest: d("result"),
      bridgeClaimId: d("bridge"), successorClaimId: d("successor") },
    pullRequest: { id: "PR_test", number: 808, url: lease.pullRequestUrl, state: "OPEN",
      isDraft: true, autoMergeRequest: null, headBranch: lease.branch, headSha: lease.fenceSha,
      baseSha: s("pr base"), etag: "\"e\"", bodyDigest: d("body"),
      bodyRemainderDigest: d("remainder"), markerDigest: d("marker"),
      markerClaimId: lease.cloudAuthority.claimId },
    dirt: { evidenceDigest: d("dirt") }, controller: { evidenceDigest: d("controller") },
    cloud: { topologyDigest: d("topology"), anchorClaimId: lease.cloudAuthority.claimId,
      anchorWriteSetDigest: lease.admission.writeSetDigest }, registryRevision: 9,
    observedAt: "2026-08-31T00:00:00.000Z" };
  return { ...core, evidenceDigest: digestValue(core) };
}
function d(value) { return digestValue({ value }); }
function s(value) { return d(value).slice(0, 40); }
