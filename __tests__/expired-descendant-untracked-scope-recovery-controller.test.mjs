import assert from "node:assert/strict";
import test from "node:test";
import { buildActiveDirtyScopeExpansionPlan }
  from "../scripts/active-dirty-scope-expansion-contract.mjs";
import {
  activeDescendantUntrackedEntriesDigest,
  activeDescendantUntrackedIndexEvidenceDigest,
  activeDescendantUntrackedStableIncidentDigest,
  buildActiveDescendantUntrackedIncident,
  buildActiveDescendantUntrackedOwnerStopEvidence,
} from "../scripts/active-descendant-untracked-scope-recovery-evidence.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import { createExpiredDescendantUntrackedScopeRecoveryController }
  from "../scripts/expired-descendant-untracked-scope-recovery-controller.mjs";
import { buildExpiredDescendantUntrackedScopeRecoveryPlan }
  from "../scripts/expired-descendant-untracked-scope-recovery-contract.mjs";
import {
  assertExpiredDescendantCloudTopology,
  buildExpiredDescendantTargetAdditionProof,
  buildExpiredDescendantUntrackedScopeRecoveryEvidence,
}
  from "../scripts/expired-descendant-untracked-scope-recovery-evidence.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { writerLeaseDigest }
  from "../scripts/writer-lease-registry-cas.mjs";
import { bindExpiredDescendantSuccessor }
  from "../scripts/expired-descendant-untracked-scope-recovery-repository-terminal.mjs";

const D = value => digestValue(value), S = value => value.repeat(40);
const STOPPED = "2026-08-31T00:00:00.000Z";
const EXPIRES = "2026-08-31T00:30:00.000Z", AT = "2026-08-31T01:00:00.000Z";
const BASE = S("1"), FENCE = S("2"), HEAD = S("3");
const BRANCH = "agent/device.local/scope", SCOPE = "scope";
const TRACKED = "src/tracked.txt", UNTRACKED = "src/untracked.txt";

test("wrong authorization reaches no recovery effect", async () => {
  const evidence = fixture(); let effects = 0;
  const controller = createExpiredDescendantUntrackedScopeRecoveryController({
    readEvidence: async () => evidence,
    execute: async () => { effects += 1; },
    verifyTerminal: async () => { effects += 1; },
  });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ plan, authorization: "authorize wrong" }),
    /exact authorization/u);
  assert.equal(effects, 0);
});

test("completion proves provider-deferred same-session authoring only", async () => {
  const evidence = fixture(); const calls = [];
  const innerResult = {
    schema: "agentic-expired-descendant-untracked-scope-recovery-inner/v1",
    status: "complete", planDigest: evidence.innerPlanDigest,
    successorClaimId: D("successor"),
    successorClaimDigest: D("successor-fence"),
    targetLeaseDigest: D("target-lease"),
    terminalReceiptDigest: D("terminal"), providerProjection: "deferred",
    pullRequestMutation: false, receiptDigest: D("inner"),
  };
  const controller = createExpiredDescendantUntrackedScopeRecoveryController({
    readEvidence: async () => evidence,
    execute: async () => { calls.push("execute"); return innerResult; },
    verifyTerminal: async () => {
      calls.push("verify");
      return {
        stableIncidentDigest: activeDescendantUntrackedStableIncidentDigest(
          evidence.incident,
        ),
        sourceHeadSha: HEAD,
        sourceDirtEvidenceDigest: evidence.incident.dirt.evidenceDigest,
        successorClaimId: D("successor"), successorClaimDigest: D("successor-fence"),
        targetLeaseDigest: D("target-lease"),
        innerCompletionReceiptDigest: innerResult.receiptDigest,
        mutationAuthorityReceiptDigest: D("mutation"),
        cloudVerificationReceiptDigest: D("cloud"),
        preservedPullRequestDigest: D("pull"),
        providerProjection: "deferred", pullRequestMutation: false, verifiedAt: AT,
      };
    },
  });
  const plan = await controller.plan();
  const result = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(calls, ["execute", "verify"]);
  assert.equal(result.status, "same-session-authoring-authority-restored");
  assert.equal(result.authoringAuthority, true);
  assert.equal(result.integrationAuthority, false);
  assert.equal(result.pullRequestMutation, false);
});

test("promotion guard accepts only the exact waiting-to-current response window", () => {
  const evidence = fixture();
  const plan = buildExpiredDescendantUntrackedScopeRecoveryPlan(evidence);
  const source = evidence.sourceClaim, successorId = D("successor");
  const waiting = { ...source, claimId: successorId, state: "waiting-successor",
    writeAuthority: false, scopeReserved: false, predecessorClaimId: source.claimId,
    canonicalBaseRevision: evidence.innerPlan.targetCanonicalBaseSha,
    laneRevision: evidence.innerPlan.sourceFenceSha,
    declaredWriteScope: evidence.innerPlan.targetDeclaredWriteSet,
    writeSetDigest: evidence.innerPlan.targetWriteSetDigest,
    leaseEpoch: evidence.innerPlan.targetCloudLeaseEpoch, transitionCounter: 1,
    heartbeatCounter: 0, reviewRequestId: null, fenceRevision: D("waiting") };
  const intent = { status: "source-retired", targetClaimId: successorId,
    targetClaimDigest: waiting.fenceRevision };
  const retiredSource = { ...source, state: "retired", writeAuthority: false,
    scopeReserved: false, retirement: { reason: "superseded", finalRevision: FENCE,
      reviewRequestId: source.reviewRequestId } };
  assert.doesNotThrow(() => assertExpiredDescendantCloudTopology({
    claims: [retiredSource, waiting], plan, intent, operation: "promoteSuccessor",
  }));
  const current = { ...waiting, state: "current", writeAuthority: true,
    scopeReserved: true, transitionCounter: 2, fenceRevision: D("current") };
  assert.doesNotThrow(() => assertExpiredDescendantCloudTopology({
    claims: [retiredSource, current], plan, intent, operation: "promoteSuccessor-post",
  }));
  assert.throws(() => assertExpiredDescendantCloudTopology({
    claims: [retiredSource, { ...waiting, writeSetDigest: D("wrong") }],
    plan, intent, operation: "promoteSuccessor",
  }), /exact successor topology/u);
  assert.throws(() => assertExpiredDescendantCloudTopology({
    claims: [source, waiting], plan, intent, operation: "promoteSuccessor",
  }), /phase-bound predecessor state/u);
  assert.doesNotThrow(() => assertExpiredDescendantCloudTopology({
    claims: [retiredSource, waiting], plan,
    intent: { ...intent, status: "waiting-successor" }, operation: "retireSource-post",
  }));
});

test("successor binding adopts exact t3 response loss without repeating the effect", () => {
  const evidence = fixture(), plan = buildExpiredDescendantUntrackedScopeRecoveryPlan(evidence);
  const inner = evidence.innerPlan, source = evidence.sourceClaim;
  const claimId = D("successor"), promoted = { claimId, claimDigest: D("promoted"),
    transitionCounter: 2 };
  const current = { ...source, claimId, state: "current", writeAuthority: true,
    scopeReserved: true, predecessorClaimId: source.claimId,
    canonicalBaseRevision: inner.targetCanonicalBaseSha,
    laneRevision: inner.sourceFenceSha, declaredWriteScope: inner.targetDeclaredWriteSet,
    writeSetDigest: inner.targetWriteSetDigest, leaseEpoch: inner.targetCloudLeaseEpoch,
    transitionCounter: 2, reviewRequestId: null, fenceRevision: promoted.claimDigest,
    transitionDigest: D("promoted transition"), operationReceiptDigest: D("promoted op") };
  const lease = { device: evidence.incident.sourceDevice,
    sessionId: evidence.incident.sourceSessionId, cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: evidence.incident.authorityRepository,
      targetRepository: evidence.incident.repository,
    } };
  const manifest = { schema: "agentic-declared-write-scope/v1",
    semanticScope: evidence.incident.sourceScope,
    declaredWriteSet: inner.targetDeclaredWriteSet,
    writeSetDigest: inner.targetWriteSetDigest, manifestDigest: inner.targetManifestDigest };
  const status = claim => ({ schema: "agentic-cloud-collaboration-result/v1",
    ledgerRevision: S("c"), ledgerDigest: D("ledger after bind"), claims: [claim] });
  let effects = 0, verifications = 0;
  const pending = bindExpiredDescendantSuccessor({ plan, lease, promoted,
    status: status(current), manifest,
    bindAuthority: ({ authority }) => { effects += 1; return {
      authority: { ...authority, reviewRequestId: inner.sourceReviewRequestId },
      verification: { receiptDigest: D("effect verification") } }; },
    verifyAuthority: () => { throw new Error("unexpected adoption"); } });
  assert.equal(pending.transition, "effect-or-reconciled");
  assert.equal(effects, 1);
  const bound = { ...current, transitionCounter: 3,
    reviewRequestId: inner.sourceReviewRequestId, fenceRevision: D("bound"),
    transitionDigest: D("bound transition"), operationReceiptDigest: D("bound op") };
  const adopted = bindExpiredDescendantSuccessor({ plan, lease, promoted,
    status: status(bound), manifest,
    bindAuthority: () => { effects += 1; throw new Error("repeated bind"); },
    verifyAuthority: ({ authority }) => { verifications += 1; return { authority,
      verification: { receiptDigest: D("adoption verification") } }; } });
  assert.equal(adopted.transition, "response-ahead-adopted");
  assert.equal(adopted.authority.reviewRequestId, inner.sourceReviewRequestId);
  assert.equal(effects, 1);
  assert.equal(verifications, 1);
  assert.throws(() => bindExpiredDescendantSuccessor({ plan, lease, promoted,
    status: status({ ...bound, transitionCounter: 4 }), manifest,
    bindAuthority: () => ({}), verifyAuthority: () => ({}) }),
  /exact bind pre-effect or response-ahead state/u);
});

function fixture() {
  const source = manifest([TRACKED]), target = manifest([TRACKED, UNTRACKED]);
  const claimId = D("claim"), claimDigest = D("claim-digest"), binding = D("binding");
  const authority = { schema: "agentic-lane-cloud-authority/v1",
    targetRepository: "owner/repository", ledgerRepository: "owner/authority",
    claimId, claimDigest, ledgerRevision: S("4"), claimLedgerRevision: D("transition"),
    canonicalBaseSha: BASE, laneRevision: FENCE,
    cloudDeclaredWriteScope: source.declaredWriteSet,
    writeSetDigest: source.writeSetDigest, deviceId: "device.local",
    sessionId: "session:owner", reviewRequestId: "github-pull-request:PR_node",
    leaseEpoch: 1, transitionCounter: 3, state: "active", expiresAt: EXPIRES };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "session:owner", device: "device.local", scope: SCOPE, branch: BRANCH,
    baseSha: BASE, fenceSha: FENCE,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: SCOPE, declaredWriteSet: source.declaredWriteSet,
      writeSetDigest: source.writeSetDigest, manifestDigest: source.manifestDigest },
    cloudAuthority: authority };
  const entries = [
    { path: TRACKED, staged: false, unstaged: true, untracked: false,
      headMode: "100644", headBlob: S("5"), indexMode: "100644", indexBlob: S("5"),
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: S("6") },
    { path: UNTRACKED, staged: false, unstaged: false, untracked: true,
      headMode: null, headBlob: null, indexMode: null, indexBlob: null,
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: S("7") },
  ];
  const dirtCore = { schema: "agentic-active-owned-dirt-evidence/v1", headSha: HEAD,
    entries, pathCount: 2, stagedPathCount: 0, unstagedPathCount: 1,
    untrackedPathCount: 1 };
  const dirt = { ...dirtCore, evidenceDigest: D(dirtCore) };
  const stop = buildActiveDescendantUntrackedOwnerStopEvidence({
    sourceSessionId: lease.sessionId, sourceBranch: BRANCH, sourceHeadSha: HEAD,
    sourceFenceSha: FENCE, sourceDirtEvidenceDigest: dirt.evidenceDigest,
    sourceIndexEvidenceDigest: activeDescendantUntrackedIndexEvidenceDigest(dirt),
    untrackedEntriesDigest: activeDescendantUntrackedEntriesDigest(dirt),
    taskAuthorityReceiptDigest: D("task"), taskAuthorityProofDigest: D("proof"),
    taskAuthorityBindingDigest: binding, untrackedPaths: [UNTRACKED],
    issuedAt: STOPPED, expiresAt: "2026-08-31T02:00:00.000Z" });
  const incident = buildActiveDescendantUntrackedIncident({
    repository: authority.targetRepository, authorityRepository: authority.ledgerRepository,
    worktreeIdentityDigest: D("worktree"), sourceSessionId: lease.sessionId,
    sourceDevice: lease.device, sourceScope: SCOPE, sourceBranch: BRANCH,
    sourceBaseSha: BASE, sourceFenceSha: FENCE, sourceHeadSha: HEAD,
    sourceHeadTreeSha: S("8"), commitInventoryDigest: D("commits"),
    rangeDiffDigest: D("diff"), committedPaths: [TRACKED], dirt,
    trackedDirtyPaths: [TRACKED], untrackedPaths: [UNTRACKED], ownerStop: stop,
    sourceLeaseDigest: writerLeaseDigest(lease), sourceClaimId: claimId,
    sourceClaimDigest: claimDigest, sourceTransitionCounter: 3,
    sourceLedgerRevision: S("9"), sourceLedgerDigest: D("ledger"),
    sourceTaskAuthorityBindingDigest: binding, sourceManifestDigest: source.manifestDigest,
    sourceWriteSetDigest: source.writeSetDigest,
    sourceDeclaredWriteSet: source.declaredWriteSet,
    targetManifestDigest: target.manifestDigest, targetWriteSetDigest: target.writeSetDigest,
    targetDeclaredWriteSet: target.declaredWriteSet,
    pullRequest: { repository: authority.targetRepository, nodeId: "PR_node", number: 836,
      url: "https://github.com/owner/repository/pull/836", state: "OPEN", draft: true,
      autoMerge: null, branch: BRANCH, headSha: FENCE, baseBranch: "main", baseSha: BASE,
      visibleBodyDigest: D("body"), sourceMarkerDigest: D("marker") },
    controller: { repository: "git@github.com:owner/repository.git", branch: "main",
      headSha: S("a"), originMainSha: S("a"), treeSha: S("b"),
      implementationDigest: D("implementation") }, observedAt: AT });
  const innerPlan = buildActiveDirtyScopeExpansionPlan({ source: { lease,
    branch: BRANCH, fenceSha: FENCE, claimId, claimDigest,
    changedPaths: [TRACKED], untrackedPaths: [], dirtyDigest: dirt.evidenceDigest },
    targetManifest: target, targetCanonicalBaseSha: BASE });
  const historicalCore = { schema: "agentic-active-descendant-untracked-owner-stop/v1",
    sourceSessionId: lease.sessionId, sourceBranch: BRANCH, sourceHeadSha: HEAD,
    sourceFenceSha: FENCE, untrackedPaths: [UNTRACKED], stoppedAt: STOPPED };
  return buildExpiredDescendantUntrackedScopeRecoveryEvidence({ incident, innerPlan,
    sourceClaim: { claimId, claimDigest,
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      state: "dormant-preserved", writeAuthority: false, scopeReserved: true,
      actorId: "github-user:1",
      sessionId: pseudonymousIdentifier("session", lease.sessionId),
      deviceId: pseudonymousIdentifier("device", lease.device),
      repositoryId: "github-repository:R_repo",
      workItemId: pseudonymousIdentifier("work-item", SCOPE),
      canonicalBaseRevision: BASE, laneRevision: FENCE,
      declaredWriteScope: source.declaredWriteSet,
      writeSetDigest: source.writeSetDigest, leaseEpoch: 1, transitionCounter: 3,
      heartbeatCounter: 1, reviewRequestId: authority.reviewRequestId,
      predecessorClaimId: null, expiresAt: EXPIRES, fenceRevision: claimDigest,
      transitionDigest: D("transition"), operationReceiptDigest: D("operation"),
      integrationReceiptDigest: null, integration: null, recovery: null },
    historicalOwnerDecision: { ...historicalCore, receiptDigest: D(historicalCore) },
    targetAdditionProof: buildExpiredDescendantTargetAdditionProof({
      targetAdditionPaths: [UNTRACKED], untrackedAdditionPaths: [UNTRACKED],
      absentAdditionPaths: [], overlappingClaimIds: [] }),
    pullRequestRawBodyDigest: D("raw-body"),
    pullRequestStructuralMarkerDigest: D("structural-marker"),
    repositoryIdentity: { nameWithOwner: "owner/repository", nodeId: "R_repo",
      actorId: "github-user:1" },
    authorityRepositoryIdentity: { nameWithOwner: "owner/authority",
      nodeId: "R_authority", actorId: "github-user:1" } });
}
function manifest(paths) {
  return normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE, paths });
}
