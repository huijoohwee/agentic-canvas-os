import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveDirtyScopeExpansionPlan }
  from "../scripts/active-dirty-scope-expansion-contract.mjs";
import {
  authorizeActiveDescendantUntrackedScopeRecovery,
  buildActiveDescendantUntrackedScopeRecoveryPlan,
  buildActiveDescendantUntrackedScopeRecoveryReceipt,
  normalizeActiveDescendantUntrackedScopeRecoveryPlan,
  OPERATION,
} from "../scripts/active-descendant-untracked-scope-recovery-contract.mjs";
import {
  activeDescendantUntrackedEntriesDigest,
  activeDescendantUntrackedIndexEvidenceDigest,
  activeDescendantUntrackedStableIncidentDigest,
  assertActiveDescendantUntrackedScopePartition,
  buildActiveDescendantUntrackedIncident,
  buildActiveDescendantUntrackedOwnerStopEvidence,
  normalizeActiveDescendantUntrackedOwnerStopEvidence,
} from "../scripts/active-descendant-untracked-scope-recovery-evidence.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const AT = "2026-08-31T00:00:00.000Z";
const EXPIRES = "2026-08-31T00:30:00.000Z";
const S = digit => digit.repeat(40);
const D = value => digestValue(value);
const BASE = S("1"), FENCE = S("2"), HEAD = S("3");
const BRANCH = "agent/device.local/untracked-scope";
const SCOPE = "untracked-scope";
const TRACKED = "src/tracked.txt", UNTRACKED = "src/untracked.txt";

test("outer plan seals one content-bound incident around integrated scope expansion", () => {
  const { plan, incident, innerPlan } = fixture();
  assert.equal(plan.exactAuthorization, `authorize ${OPERATION} ${plan.planDigest}`);
  assert.equal(plan.innerPlanDigest, innerPlan.planDigest);
  assert.equal(plan.stableIncidentDigest,
    activeDescendantUntrackedStableIncidentDigest(incident));
  assert.deepEqual(plan.allowedMutations, [
    "scope-expansion-registry-intent",
    "task-authority-successor-continuation",
    "cloud-waiting-successor",
    "cloud-source-retirement",
    "cloud-successor-promotion",
    "cloud-successor-review-binding",
    "writer-registry-cas",
    "pull-request-marker-replacement",
  ]);
  assert.ok(plan.forbiddenMutations.includes("source-bytes"));
  assert.ok(plan.forbiddenMutations.includes("push"));
  assert.deepEqual(normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan), plan);
});

test("owner stop binds index state, untracked content, capability, and expiry", () => {
  const { ownerStop, dirt } = fixture();
  assert.equal(ownerStop.sourceIndexEvidenceDigest,
    activeDescendantUntrackedIndexEvidenceDigest(dirt));
  assert.equal(ownerStop.untrackedEntriesDigest,
    activeDescendantUntrackedEntriesDigest(dirt));
  assert.deepEqual(ownerStop.untrackedPaths, [UNTRACKED]);
  assert.deepEqual(normalizeActiveDescendantUntrackedOwnerStopEvidence(ownerStop), ownerStop);
  assert.throws(() => normalizeActiveDescendantUntrackedOwnerStopEvidence({
    ...ownerStop, untrackedPaths: ["src/replaced.txt"],
  }), /owner-stop receipt projection/u);
});

test("incident rejects byte drift and a target that omits the untracked path", () => {
  const value = fixture();
  assert.throws(() => buildActiveDescendantUntrackedIncident({
    ...value.incident,
    dirt: dirtEvidence(S("c")),
  }), /incident joins/u);
  assert.throws(() => assertActiveDescendantUntrackedScopePartition({
    ...value.incident,
    targetDeclaredWriteSet: value.sourceManifest.declaredWriteSet,
  }), /strict-superset target scope/u);
});

test("authorization is exact and completion grants authoring only", () => {
  const { plan, incident, innerPlan } = fixture();
  assert.throws(() => authorizeActiveDescendantUntrackedScopeRecovery(
    plan, `authorize ${OPERATION} wrong`), /exact authorization/u);
  const authorization = authorizeActiveDescendantUntrackedScopeRecovery(
    plan, plan.exactAuthorization);
  const innerResult = {
    schema: "agentic-active-dirty-scope-expansion-result/v1",
    status: "complete",
    plan: innerPlan,
    intent: { status: "complete", planDigest: innerPlan.planDigest,
      intentDigest: D("inner-intent") },
    receiptDigest: D("inner-completion"),
  };
  const receipt = buildActiveDescendantUntrackedScopeRecoveryReceipt({
    plan,
    authorizationReceipt: authorization,
    innerResult,
    terminal: {
      stableIncidentDigest: activeDescendantUntrackedStableIncidentDigest(incident),
      sourceHeadSha: HEAD,
      sourceDirtEvidenceDigest: incident.dirt.evidenceDigest,
      successorClaimId: D("successor"),
      targetLeaseDigest: D("target-lease"),
      targetMarkerDigest: D("target-marker"),
      innerCompletionReceiptDigest: innerResult.receiptDigest,
      mutationAuthorityReceiptDigest: D("mutation-authority"),
      cloudVerificationReceiptDigest: D("cloud-verification"),
      verifiedAt: AT,
    },
  });
  assert.equal(receipt.status, "authoring-authority-restored");
  assert.equal(receipt.authoringAuthority, true);
  assert.equal(receipt.reviewAuthority, false);
  assert.equal(receipt.integrationAuthority, false);
  assert.equal(receipt.sourceMutation, false);
  assert.equal(receipt.pullRequestMarkerMutation, true);
});

function fixture() {
  const sourceManifest = manifest([TRACKED]);
  const targetManifest = manifest([TRACKED, UNTRACKED]);
  const claimId = D("source-claim");
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    targetRepository: "owner/repository",
    ledgerRepository: "owner/authority",
    claimId,
    claimDigest: D("source-fence"),
    ledgerRevision: S("4"),
    claimLedgerRevision: D("claim-ledger"),
    canonicalBaseSha: BASE,
    laneRevision: FENCE,
    cloudDeclaredWriteScope: sourceManifest.declaredWriteSet,
    writeSetDigest: sourceManifest.writeSetDigest,
    deviceId: "device.local",
    sessionId: "session:owner",
    reviewRequestId: "github-pull-request:PR_node",
    leaseEpoch: 1,
    transitionCounter: 7,
    state: "active",
    expiresAt: EXPIRES,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session:owner",
    device: "device.local",
    scope: SCOPE,
    branch: BRANCH,
    baseSha: BASE,
    fenceSha: FENCE,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: SCOPE,
      declaredWriteSet: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest,
      manifestDigest: sourceManifest.manifestDigest,
    },
    cloudAuthority: authority,
  };
  const dirt = dirtEvidence();
  const taskBindingDigest = D("task-binding");
  const ownerStop = buildActiveDescendantUntrackedOwnerStopEvidence({
    sourceSessionId: lease.sessionId,
    sourceBranch: BRANCH,
    sourceHeadSha: HEAD,
    sourceFenceSha: FENCE,
    sourceDirtEvidenceDigest: dirt.evidenceDigest,
    sourceIndexEvidenceDigest: activeDescendantUntrackedIndexEvidenceDigest(dirt),
    untrackedEntriesDigest: activeDescendantUntrackedEntriesDigest(dirt),
    taskAuthorityReceiptDigest: D("task-receipt"),
    taskAuthorityProofDigest: D("task-proof"),
    taskAuthorityBindingDigest: taskBindingDigest,
    untrackedPaths: [UNTRACKED],
    issuedAt: AT,
    expiresAt: EXPIRES,
  });
  const incident = buildActiveDescendantUntrackedIncident({
    repository: authority.targetRepository,
    authorityRepository: authority.ledgerRepository,
    worktreeIdentityDigest: D("worktree"),
    sourceSessionId: lease.sessionId,
    sourceDevice: lease.device,
    sourceScope: SCOPE,
    sourceWorkItemId: "work-item:fixture-existing-id",
    sourceBranch: BRANCH,
    sourceBaseSha: BASE,
    sourceFenceSha: FENCE,
    sourceHeadSha: HEAD,
    sourceHeadTreeSha: S("5"),
    commitInventoryDigest: D("commits"),
    rangeDiffDigest: D("range"),
    committedPaths: [TRACKED],
    dirt,
    trackedDirtyPaths: [TRACKED],
    untrackedPaths: [UNTRACKED],
    ownerStop,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: claimId,
    sourceClaimDigest: authority.claimDigest,
    sourceTransitionCounter: authority.transitionCounter,
    sourceLedgerRevision: S("6"),
    sourceLedgerDigest: D("ledger"),
    sourceTaskAuthorityBindingDigest: taskBindingDigest,
    sourceManifestDigest: sourceManifest.manifestDigest,
    sourceWriteSetDigest: sourceManifest.writeSetDigest,
    sourceDeclaredWriteSet: sourceManifest.declaredWriteSet,
    targetManifestDigest: targetManifest.manifestDigest,
    targetWriteSetDigest: targetManifest.writeSetDigest,
    targetDeclaredWriteSet: targetManifest.declaredWriteSet,
    pullRequest: {
      repository: authority.targetRepository,
      nodeId: "PR_node",
      number: 840,
      url: "https://github.com/owner/repository/pull/840",
      state: "OPEN",
      draft: true,
      autoMerge: null,
      branch: BRANCH,
      headSha: FENCE,
      baseBranch: "main",
      baseSha: BASE,
      visibleBodyDigest: D("visible-body"),
      sourceMarkerDigest: D("source-marker"),
    },
    controller: {
      repository: "git@github.com:owner/repository.git",
      branch: "main",
      headSha: S("7"),
      originMainSha: S("7"),
      treeSha: S("8"),
      implementationDigest: D("implementation"),
    },
    observedAt: AT,
  });
  assertActiveDescendantUntrackedScopePartition(incident);
  const innerPlan = buildActiveDirtyScopeExpansionPlan({
    source: {
      lease,
      branch: BRANCH,
      fenceSha: FENCE,
      claimId,
      claimDigest: authority.claimDigest,
      changedPaths: [TRACKED],
      untrackedPaths: [],
      dirtyDigest: dirt.evidenceDigest,
    },
    targetManifest,
    targetCanonicalBaseSha: BASE,
  });
  const plan = buildActiveDescendantUntrackedScopeRecoveryPlan({ incident, innerPlan });
  return { plan, incident, innerPlan, ownerStop, dirt, sourceManifest, targetManifest };
}

function manifest(paths) {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths,
  });
}

function dirtEvidence(trackedWorktreeBlob = S("9")) {
  const entries = [
    { path: TRACKED, staged: false, unstaged: true, untracked: false,
      headMode: "100644", headBlob: S("a"), indexMode: "100644",
      indexBlob: S("a"), worktreeType: "file", worktreeMode: "100644",
      worktreeBlob: trackedWorktreeBlob },
    { path: UNTRACKED, staged: false, unstaged: false, untracked: true,
      headMode: null, headBlob: null, indexMode: null, indexBlob: null,
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: S("b") },
  ];
  const core = { schema: "agentic-active-owned-dirt-evidence/v1", headSha: HEAD,
    entries, pathCount: 2, stagedPathCount: 0, unstagedPathCount: 1,
    untrackedPathCount: 1 };
  return { ...core, evidenceDigest: D(core) };
}
