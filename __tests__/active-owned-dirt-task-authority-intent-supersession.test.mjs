import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizeActiveOwnedDirtIntentSupersession,
  buildActiveOwnedDirtIntentSupersessionPlan,
  createSuccessorActiveOwnedDirtRecoveryPlan,
} from "../scripts/active-owned-dirt-task-authority-intent-supersession-contract.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function activePlan() {
  const core = {
    schema: "agentic-active-owned-dirt-recovery-plan/v1",
    sourceSessionId: "session", sourceDevice: "device", sourceScope: "scope",
    sourceBranch: "agent/device/scope", sourceEpoch: 1, sourceLeaseDigest: digest("1"),
    sourceBaseSha: sha("a"), sourceFenceSha: sha("b"),
    sourcePullRequestUrl: "https://github.com/o/r/pull/1", sourcePullRequestId: "PR_1",
    sourcePullRequestRepository: "o/r", sourcePullRequestBodyDigest: digest("2"),
    sourceMarkerDigest: digest("3"), sourceWorktreeIdentityDigest: digest("4"),
    sourceEntrySchema: "agentic-cloud-collaboration-entry/v2",
    sourceClaimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    sourceActorId: "actor", sourceRepositoryId: "repo",
    sourceWorkItemId: `work-item:${digestValue("work")}`,
    sourcePredecessorClaimId: null,
    sourceCloudDeviceId: `device:${digestValue({ namespace: "device", value: "device" })}`,
    sourceCloudSessionId: `session:${digestValue({ namespace: "session", value: "session" })}`,
    sourceClaimId: "", sourceClaimDigest: digest("6"), sourceClaimLedgerRevision: digest("7"),
    sourceCloudTransitionCounter: 1, sourceCloudLeaseEpoch: 1,
    sourceOperationReceiptDigest: digest("8"), sourceLedgerRevision: sha("c"),
    sourceLedgerDigest: digest("9"), sourceReviewRequestId: "review",
    sourceManifestDigest: digest("a"), sourceWriteSetDigest: "",
    sourceDeclaredWriteSet: ["path:file", "semantic:scope"],
    sourceProtectedMainAdvance: {
      schema: "agentic-active-owned-dirt-protected-main-advance/v1", baseSha: sha("a"),
      pullRequestBaseSha: sha("a"), protectedMainSha: sha("a"),
      protectedMainTreeSha: sha("d"), changedPathCount: 0,
      changedPathsDigest: digestValue([]),
      declaredWriteSetDigest: "",
    },
    evidenceDigest: digest("b"), dirtyPathCount: 1,
    snapshotTimestamp: "2026-08-24T00:00:00.000Z", ttlSeconds: 1800,
  };
  core.sourceWriteSetDigest = digestValue(core.sourceDeclaredWriteSet);
  core.sourceProtectedMainAdvance.declaredWriteSetDigest = core.sourceWriteSetDigest;
  core.sourceClaimId = digestValue({ actorId: core.sourceActorId,
    canonicalBaseRevision: core.sourceBaseSha, leaseEpoch: core.sourceCloudLeaseEpoch,
    repositoryId: core.sourceRepositoryId, workItemId: core.sourceWorkItemId,
    writeSetDigest: core.sourceWriteSetDigest });
  return { ...core, planDigest: digestValue(core) };
}

test("successor changes only the lease-bound plan identity", () => {
  const source = activePlan();
  const successor = createSuccessorActiveOwnedDirtRecoveryPlan({
    sourcePlan: source, currentLeaseDigest: digest("f"),
  });
  assert.equal(successor.sourceLeaseDigest, digest("f"));
  assert.notEqual(successor.planDigest, source.planDigest);
  const { planDigest: ignoredSource, sourceLeaseDigest: ignoredLease, ...sourceRest } = source;
  const { planDigest: ignoredSuccessor, sourceLeaseDigest: ignoredNewLease, ...successorRest } = successor;
  assert.deepEqual(successorRest, sourceRest);
});

test("authorization is content-bound to exact lineage evidence", () => {
  const plan = buildActiveOwnedDirtIntentSupersessionPlan({ evidence: {
    repository: "o/r", branch: "agent/device/scope", sessionId: "session",
    pullRequestNumber: 1, headSha: sha("b"),
    lease: { leaseDigest: digest("f"), claimId: digest("1"), taskAuthorityBindingDigest: digest("2") },
    intent: { status: "cloud", intentDigest: digest("3"), planDigest: digest("4"),
      sourceLeaseDigest: digest("5"), sourceClaimId: digest("1"),
      snapshotReceiptDigest: digest("6"), cloudReceiptDigest: digest("7") },
    authorityRecovery: { journalDigest: digest("8"), planDigest: digest("9"),
      sourceLeaseDigest: digest("5"), targetBindingDigest: digest("2"), resultDigest: digest("a") },
  } });
  assert.throws(() => authorizeActiveOwnedDirtIntentSupersession({ plan, authorization: "authorize" }));
  assert.equal(authorizeActiveOwnedDirtIntentSupersession({
    plan, authorization: `authorize active-owned-dirt-task-authority-intent-supersession ${plan.planDigest}`,
  }).planDigest, plan.planDigest);
});
