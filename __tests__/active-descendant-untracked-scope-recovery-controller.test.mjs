import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveDirtyScopeExpansionPlan }
  from "../scripts/active-dirty-scope-expansion-contract.mjs";
import { buildActiveDescendantUntrackedScopeRecoveryPlan }
  from "../scripts/active-descendant-untracked-scope-recovery-contract.mjs";
import { createActiveDescendantUntrackedScopeRecoveryController }
  from "../scripts/active-descendant-untracked-scope-recovery-controller.mjs";
import {
  activeDescendantUntrackedEntriesDigest,
  activeDescendantUntrackedIndexEvidenceDigest,
  activeDescendantUntrackedStableIncidentDigest,
  buildActiveDescendantUntrackedIncident,
  buildActiveDescendantUntrackedOwnerStopEvidence,
} from "../scripts/active-descendant-untracked-scope-recovery-evidence.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const D = value => digestValue(value), S = digit => digit.repeat(40);
const AT = "2026-08-31T00:00:00.000Z", EXPIRES = "2026-08-31T00:30:00.000Z";
const BASE = S("1"), FENCE = S("2"), HEAD = S("3");
const BRANCH = "agent/device.local/untracked-scope", SCOPE = "untracked-scope";
const TRACKED = "src/tracked.txt", UNTRACKED = "src/untracked.txt";

test("wrong outer authorization reaches no effect", async () => {
  const { incident, innerPlan } = fixture();
  let effects = 0;
  const controller = createActiveDescendantUntrackedScopeRecoveryController({
    readEvidence: async () => ({ incident, innerPlan }),
    execute: async () => { effects += 1; },
    verifyTerminal: async () => { effects += 1; },
  });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ plan, authorization: "authorize wrong" }),
    /exact authorization/u);
  assert.equal(effects, 0);
});

test("controller delegates once and joins terminal evidence", async () => {
  const { incident, innerPlan } = fixture();
  const calls = [];
  const innerResult = {
    schema: "agentic-active-dirty-scope-expansion-result/v1",
    status: "complete",
    plan: innerPlan,
    intent: { status: "complete", planDigest: innerPlan.planDigest,
      intentDigest: D("inner-intent") },
    receiptDigest: D("inner-completion"),
  };
  const controller = createActiveDescendantUntrackedScopeRecoveryController({
    readEvidence: async () => { calls.push("read"); return { incident, innerPlan }; },
    execute: async ({ plan }) => {
      calls.push(["execute", plan.planDigest]);
      return innerResult;
    },
    verifyTerminal: async ({ plan, innerResult: observed }) => {
      calls.push(["terminal", plan.planDigest]);
      assert.equal(observed, innerResult);
      return {
        stableIncidentDigest: activeDescendantUntrackedStableIncidentDigest(incident),
        sourceHeadSha: HEAD,
        sourceDirtEvidenceDigest: incident.dirt.evidenceDigest,
        successorClaimId: D("successor"),
        targetLeaseDigest: D("target-lease"),
        targetMarkerDigest: D("target-marker"),
        innerCompletionReceiptDigest: innerResult.receiptDigest,
        mutationAuthorityReceiptDigest: D("mutation"),
        cloudVerificationReceiptDigest: D("verification"),
        verifiedAt: AT,
      };
    },
  });
  const plan = await controller.plan();
  const result = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(calls, ["read", ["execute", plan.planDigest],
    ["terminal", plan.planDigest]]);
  assert.equal(result.status, "authoring-authority-restored");
  assert.equal(result.innerCompletionReceiptDigest, innerResult.receiptDigest);
});

function fixture() {
  const source = manifest([TRACKED]), target = manifest([TRACKED, UNTRACKED]);
  const claimId = D("claim"), claimDigest = D("claim-fence");
  const authority = { schema: "agentic-lane-cloud-authority/v1",
    targetRepository: "owner/repository", ledgerRepository: "owner/authority",
    claimId, claimDigest, ledgerRevision: S("4"), claimLedgerRevision: D("transition"),
    canonicalBaseSha: BASE, laneRevision: FENCE,
    cloudDeclaredWriteScope: source.declaredWriteSet, writeSetDigest: source.writeSetDigest,
    deviceId: "device.local", sessionId: "session:owner",
    reviewRequestId: "github-pull-request:PR_node", leaseEpoch: 1,
    transitionCounter: 3, state: "active", expiresAt: EXPIRES };
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
  const binding = D("binding");
  const ownerStop = buildActiveDescendantUntrackedOwnerStopEvidence({
    sourceSessionId: lease.sessionId, sourceBranch: BRANCH, sourceHeadSha: HEAD,
    sourceFenceSha: FENCE, sourceDirtEvidenceDigest: dirt.evidenceDigest,
    sourceIndexEvidenceDigest: activeDescendantUntrackedIndexEvidenceDigest(dirt),
    untrackedEntriesDigest: activeDescendantUntrackedEntriesDigest(dirt),
    taskAuthorityReceiptDigest: D("task-receipt"), taskAuthorityProofDigest: D("proof"),
    taskAuthorityBindingDigest: binding, untrackedPaths: [UNTRACKED],
    issuedAt: AT, expiresAt: EXPIRES });
  const incident = buildActiveDescendantUntrackedIncident({
    repository: authority.targetRepository, authorityRepository: authority.ledgerRepository,
    worktreeIdentityDigest: D("worktree"), sourceSessionId: lease.sessionId,
    sourceDevice: lease.device, sourceScope: SCOPE,
    sourceWorkItemId: "work-item:fixture-existing-id", sourceBranch: BRANCH,
    sourceBaseSha: BASE, sourceFenceSha: FENCE, sourceHeadSha: HEAD,
    sourceHeadTreeSha: S("8"), commitInventoryDigest: D("commits"),
    rangeDiffDigest: D("diff"), committedPaths: [TRACKED], dirt,
    trackedDirtyPaths: [TRACKED], untrackedPaths: [UNTRACKED], ownerStop,
    sourceLeaseDigest: writerLeaseDigest(lease), sourceClaimId: claimId,
    sourceClaimDigest: claimDigest, sourceTransitionCounter: 3,
    sourceLedgerRevision: S("9"), sourceLedgerDigest: D("ledger"),
    sourceTaskAuthorityBindingDigest: binding, sourceManifestDigest: source.manifestDigest,
    sourceWriteSetDigest: source.writeSetDigest, sourceDeclaredWriteSet: source.declaredWriteSet,
    targetManifestDigest: target.manifestDigest, targetWriteSetDigest: target.writeSetDigest,
    targetDeclaredWriteSet: target.declaredWriteSet,
    pullRequest: { repository: authority.targetRepository, nodeId: "PR_node", number: 840,
      url: "https://github.com/owner/repository/pull/840", state: "OPEN", draft: true,
      autoMerge: null, branch: BRANCH, headSha: FENCE, baseBranch: "main", baseSha: BASE,
      visibleBodyDigest: D("body"), sourceMarkerDigest: D("marker") },
    controller: { repository: "git@github.com:owner/repository.git", branch: "main",
      headSha: S("a"), originMainSha: S("a"), treeSha: S("b"),
      implementationDigest: D("implementation") }, observedAt: AT });
  const innerPlan = buildActiveDirtyScopeExpansionPlan({
    source: { lease, branch: BRANCH, fenceSha: FENCE, claimId, claimDigest,
      changedPaths: [TRACKED], untrackedPaths: [], dirtyDigest: dirt.evidenceDigest },
    targetManifest: target, targetCanonicalBaseSha: BASE });
  buildActiveDescendantUntrackedScopeRecoveryPlan({ incident, innerPlan });
  return { incident, innerPlan };
}

function manifest(paths) {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1", semanticScope: SCOPE, paths });
}
