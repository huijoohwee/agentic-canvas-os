import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizeProvisionedStartDescendantAdmissionRecovery,
  projectProvisionedStartDescendantAdmissionLease,
  sealProvisionedStartDescendantAdmissionRecoveryPlan,
} from "../scripts/provisioned-start-descendant-admission-recovery-contract.mjs";
import { createProvisionedStartDescendantAdmissionRecoveryController }
  from "../scripts/provisioned-start-descendant-admission-recovery-controller.mjs";
import { buildProvisionedStartDescendantAdmissionRecoveryEvidence }
  from "../scripts/provisioned-start-descendant-admission-recovery-evidence.mjs";
import { projectProvisionedStartDescendantAdmissionStableSource }
  from "../scripts/provisioned-start-descendant-admission-recovery-repository-adapter.mjs";

const sha = character => character.repeat(40);
const digest = value => digestValue({ value });

function fixture() {
  const declaredWriteSet = ["path:docs/recovery.md", "semantic:recovery"];
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "planned",
    semanticScope: "recovery", declaredWriteSet,
    writeSetDigest: digestValue(declaredWriteSet), manifestDigest: digest("manifest"),
    planReceiptDigest: digest("plan"), admissionReceiptDigest: digest("admission"),
    existingLaneStateDigest: digest("lanes") };
  const cloudAuthority = { schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "owner/controller", targetRepository: "owner/repository",
    claimId: digest("claim"), claimDigest: digest("claim-fence"), ledgerRevision: sha("1"),
    ledgerDigest: digest("ledger"), claimLedgerRevision: digest("transition"),
    canonicalBaseSha: sha("a"), laneRevision: sha("a"), cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest: admission.writeSetDigest, deviceId: "device", sessionId: "session",
    reviewRequestId: null, leaseEpoch: 1, transitionCounter: 1, state: "active",
    expiresAt: "2026-08-26T00:00:00.000Z" };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "session", device: "device", scope: "recovery", branch: "agent/device/recovery",
    worktreePath: "/tmp/recovery", baseSha: sha("a"), fenceSha: sha("b"),
    pullRequestUrl: "https://github.com/owner/repository/pull/10", autoDelivery: true,
    runtimeRequired: true, admission, cloudAuthority, acquiredAt: "2026-08-25T00:00:00.000Z",
    heartbeatAt: "2026-08-25T00:00:00.000Z", expiresAt: "2026-08-25T01:00:00.000Z",
    taskAuthority: { bindingDigest: digest("binding") } };
  const descendant = { fenceSha: sha("b"), headSha: sha("c"), treeSha: sha("d"),
    clean: true, linear: true, paths: ["docs/recovery.md"], rangeDiffDigest: digest("patch"),
    commits: [{ sha: sha("c"), treeSha: sha("d"), parentSha: sha("b"),
      message: "fix(recovery): preserve descendant" }] };
  const pullRequest = { id: "PR_id", reviewRequestId: "github-pull-request:PR_id", number: 10,
    url: lease.pullRequestUrl, branch: lease.branch, headSha: descendant.headSha,
    baseSha: lease.baseSha, state: "OPEN", isDraft: true, autoMergeRequest: null,
    bodyDigest: digest("body") };
  const claim = { claimId: cloudAuthority.claimId, entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "current",
    writeAuthority: true, scopeReserved: true, canonicalBaseRevision: lease.baseSha,
    laneRevision: lease.baseSha, declaredWriteScope: declaredWriteSet,
    writeSetDigest: admission.writeSetDigest, leaseEpoch: 1, transitionCounter: 1,
    heartbeatCounter: 0, reviewRequestId: null, expiresAt: cloudAuthority.expiresAt,
    fenceRevision: cloudAuthority.claimDigest, transitionDigest: cloudAuthority.claimLedgerRevision,
    operationReceiptDigest: digest("operation"), integrationReceiptDigest: null, integration: null };
  const evidence = buildProvisionedStartDescendantAdmissionRecoveryEvidence({
    repository: "owner/repository", observedAt: "2026-08-25T00:10:00.000Z", lease,
    sourceLeaseDigest: digestValue(lease), descendant, pullRequest,
    cloud: { ledgerRevision: sha("2"), ledgerDigest: digest("live-ledger"), claim,
      overlappingClaimIds: [] }, controller: { repository: "/tmp/controller", headSha: sha("e"),
      treeSha: sha("f"), clean: true, protected: true },
    mutationBoundary: { "cloud-claim-cas": true, "writer-registry-cas": true,
      "pull-request-marker-cas": true, sourceBytes: false, gitRefs: false, draftState: false,
      merge: false, deployment: false, cleanup: false } });
  return { evidence, lease, descendant, pullRequest };
}

test("plan binds exact authorization and rejects substitution", () => {
  const plan = sealProvisionedStartDescendantAdmissionRecoveryPlan(fixture().evidence);
  assert.match(plan.exactAuthorization, new RegExp(`${plan.planDigest}$`, "u"));
  assert.doesNotThrow(() => authorizeProvisionedStartDescendantAdmissionRecovery(plan, plan.exactAuthorization));
  assert.throws(() => authorizeProvisionedStartDescendantAdmissionRecovery(plan,
    `authorize provisioned-start-descendant-admission-recovery ${digest("other")}`), /Exact authorization/u);
});

test("evidence requires the provider head to expose the authored descendant", () => {
  const current = fixture();
  assert.throws(() => buildProvisionedStartDescendantAdmissionRecoveryEvidence({
    ...current.evidence, evidenceDigest: undefined,
    pullRequest: { ...current.pullRequest, headSha: current.lease.fenceSha },
  }), /open draft descendant pull request/u);
});

test("run source identity excludes only time-derived and unrelated ledger observations", () => {
  const { evidence } = fixture();
  const refreshed = buildProvisionedStartDescendantAdmissionRecoveryEvidence({
    ...evidence,
    observedAt: "2026-08-25T00:20:00.000Z",
    cloud: {
      ...evidence.cloud,
      ledgerRevision: sha("3"),
      ledgerDigest: digest("later-ledger"),
      claim: {
        ...evidence.cloud.claim,
        state: "dormant-preserved",
        writeAuthority: false,
      },
    },
  });
  assert.deepEqual(
    projectProvisionedStartDescendantAdmissionStableSource(refreshed),
    projectProvisionedStartDescendantAdmissionStableSource(evidence),
  );

  const claimDrift = structuredClone(refreshed);
  claimDrift.cloud.claim.fenceRevision = digest("different-claim-fence");
  assert.notDeepEqual(
    projectProvisionedStartDescendantAdmissionStableSource(claimDrift),
    projectProvisionedStartDescendantAdmissionStableSource(evidence),
  );
});

test("local projection admits only the exact cloud-bound descendant", () => {
  const { evidence, descendant, pullRequest } = fixture();
  const plan = sealProvisionedStartDescendantAdmissionRecoveryPlan(evidence);
  const authority = { ...evidence.lease.cloudAuthority, laneRevision: descendant.headSha,
    reviewRequestId: pullRequest.reviewRequestId, transitionCounter: 2,
    state: "active", expiresAt: "2026-08-26T01:00:00.000Z" };
  const projection = projectProvisionedStartDescendantAdmissionLease({ plan, authority,
    taskAuthorityReceiptDigest: digest("task"), projectedAt: evidence.observedAt });
  assert.equal(projection.lease.admission.status, "admitted");
  assert.equal(projection.lease.integration.commitSha, descendant.headSha);
  assert.equal(projection.lease.cloudAuthority.reviewRequestId, pullRequest.reviewRequestId);
  assert.throws(() => projectProvisionedStartDescendantAdmissionLease({ plan,
    authority: { ...authority, laneRevision: evidence.lease.fenceSha },
    taskAuthorityReceiptDigest: digest("task"), projectedAt: evidence.observedAt }), /exact descendant/u);
});

test("controller journals effects in authority order and replay verifies only", () => {
  const plan = sealProvisionedStartDescendantAdmissionRecoveryPlan(fixture().evidence);
  const calls = [], phases = {};
  let journal = null;
  const adapter = {
    readEvidence: () => plan.evidence,
    withLock: (_plan, action) => action(),
    begin: () => journal || (journal = { phase: "prepared", phases: { prepared: receipt("prepared") } }),
    advance: ({ phase, values }) => (journal = { phase,
      phases: { ...journal.phases, [phase]: { ...receipt(phase), values } } }),
    authorizeTask: () => (calls.push("task"), { receiptDigest: digest("task"), bindingDigest: digest("binding") }),
    bindCloud: () => (calls.push("cloud"), { authority: { claimId: digest("claim") } }),
    projectLocal: () => (calls.push("local"), { leaseDigest: digest("lease") }),
    projectMarker: () => (calls.push("marker"), { bodyDigest: digest("body") }),
    verify: () => (calls.push("verify"), { leaseDigest: digest("lease") }),
  };
  const controller = createProvisionedStartDescendantAdmissionRecoveryController({ adapter });
  const first = controller.run({ sealedPlan: plan, authorization: plan.exactAuthorization });
  assert.equal(first.status, "admitted");
  assert.deepEqual(calls, ["task", "cloud", "local", "marker", "verify", "verify"]);
  calls.length = 0;
  controller.run({ sealedPlan: plan, authorization: plan.exactAuthorization });
  assert.deepEqual(calls, ["verify"]);
  function receipt(phase) { return { phase, receiptDigest: digest(phase), values: {} }; }
});
