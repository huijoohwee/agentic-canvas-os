import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlan,
  buildEvidence,
  buildPlan,
  buildReceipt,
  buildReleasedLease,
  isReleasedLease,
  normalizePlan,
} from "../scripts/closed-absent-planned-owner-release-contract.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";

const hash = label => digestValue({ label });
const sha = label => hash(label).slice(0, 40);

function evidenceInput() {
  const repository = "owner/repository";
  const branch = "agent/device/closed-owner";
  const baseSha = sha("base"), headSha = sha("head"), claimId = hash("claim");
  const nodeId = "PR_closed_owner";
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "closed-owner-session", device: "device", scope: "closed-owner", branch,
    worktreePath: "/workspace/missing-owner", baseSha, fenceSha: headSha,
    pullRequestUrl: "https://example.test/owner/repository/pull/17",
    autoDelivery: false, runtimeRequired: false,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "planned",
      semanticScope: "closed-owner", declaredWriteSet: ["path:docs/owner.md"],
      writeSetDigest: hash("write-set"), manifestDigest: hash("manifest") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "owner/ledger", targetRepository: repository, claimId,
      claimDigest: hash("source-claim"), canonicalBaseSha: baseSha, laneRevision: headSha,
      writeSetDigest: hash("write-set"), leaseEpoch: 1, transitionCounter: 3,
      reviewRequestId: `github-pull-request:${nodeId}`, state: "active",
      expiresAt: "2026-08-20T02:00:00.000Z" },
    acquiredAt: "2026-08-20T00:00:00.000Z", heartbeatAt: "2026-08-20T00:30:00.000Z",
    expiresAt: "2026-08-20T01:00:00.000Z",
    taskAuthority: { schema: "agentic-task-authority-binding/v1",
      authoritySubjectId: "urn:agentic-task:ecf23ead30c2e7eec477e154cdf127f2b6c623831c001952d0e1b280bb68e223",
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
      publicKey: "MCowBQYDK2VwAyEAJrlc5A3roTL0OYnt/jrI1728OCMSpWD/lq/aKfx+aJE=",
      publicKeyDigest: "aeb38ccccd3cf43765aebbae57f7c74614dd3f0c96e675afbe670c844d302cb2",
      laneBindingDigest: "38b8a14c8f96a31247e800bb30a68255c6ff4eb7cf73a752c456303f966c069a",
      bindingMode: "claim", boundAt: "2026-08-20T04:38:06.377Z",
      transitionPlanDigest: null, priorBindingDigest: null,
      bindingDigest: "d45a2d7bc19788768393c82100518b30cecf0829bd78e95856558faecedf767b" },
  };
  return {
    schema: "agentic-closed-absent-planned-owner-release-evidence/v1",
    observedAt: "2026-08-24T06:00:00.000Z",
    repository: { id: "R_repository", nameWithOwner: repository,
      gitCommonDirectoryDigest: hash("common-directory") },
    controller: { repository: "owner/ledger", branch: "main", headSha: sha("controller"),
      originMainSha: sha("controller"), treeSha: sha("controller-tree"),
      runtimeDigest: hash("runtime"), clean: true, protected: true },
    registry: { schema: "agentic-writer-lease-registry/v2", revision: 41,
      registryDigest: hash("registry"), sourceLeaseDigest: digestValue(lease), originalLease: lease,
      relatedArtifacts: { scopeExpansionIntent: false, activeOwnedDirtRecoveryIntent: false,
        reviewedLaneEntrypointFence: false } },
    localAbsence: { branch, worktreePath: lease.worktreePath, worktreeRegistered: false,
      worktreePathPresent: false, localBranchPresent: false, remoteBranchPresent: false,
      matchingWorktreeCount: 0, matchingLocalRefCount: 0, matchingRemoteRefCount: 0 },
    pullRequest: { number: 17, nodeId, url: lease.pullRequestUrl, state: "CLOSED",
      isDraft: true, mergedAt: null, closedAt: "2026-08-20T01:30:00.000Z",
      headRepository: repository, headBranch: branch, headSha,
      baseRepository: repository, baseBranch: "main", baseSha,
      bodyDigest: hash("body"), bodyRemainderDigest: hash("body-remainder"),
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)) },
    retainedHead: { ref: "refs/pull/17/head", sha: headSha, treeSha: sha("tree"),
      parentShas: [baseSha], baseTreeSha: sha("tree"), changedPaths: [] },
    cloud: { ledgerRepository: "owner/ledger", ledgerRevision: sha("ledger"),
      ledgerDigest: hash("ledger-head"), sequence: 90, validatedLedgerDigest: hash("ledger-body"),
      currentClaimCardinality: 0,
      source: { claimId, entryDigest: hash("source-entry"),
        claimDigest: lease.cloudAuthority.claimDigest,
        transitionCounter: 3, state: "current" },
      terminal: { claimId, entryDigest: hash("terminal-entry"),
        claimDigest: hash("terminal-claim"),
        transitionCounter: 5, action: "retire", state: "retired", reason: "abandoned",
        finalRevision: headSha, reviewRequestId: `github-pull-request:${nodeId}`,
        retiredAt: "2026-08-24T05:00:00.000Z", integrationReceiptDigest: null } },
  };
}

function plan() { return buildPlan({ evidence: buildEvidence(evidenceInput()) }); }

test("plan seals the exact terminal topology and authorization", () => {
  const value = plan();
  const authorized = authorizePlan({ plan: value, authorization: value.exactAuthorization });
  assert.equal(authorized.planDigest, value.planDigest);
  assert.equal(value.allowedEffects.length, 1);
  assert.equal(value.allowedEffects[0], "writer-lease-registry-cas");
  assert.throws(() => authorizePlan({ plan: value, authorization: `${value.exactAuthorization} ` }), /Exact/u);
  assert.equal(normalizePlan(value).planDigest, value.planDigest);
});

test("evidence rejects a present projection, live owner, non-empty head, and foreign retirement", () => {
  const present = evidenceInput(); present.localAbsence.remoteBranchPresent = true;
  assert.throws(() => buildEvidence(present), /absent/u);
  const live = evidenceInput(); live.registry.originalLease.expiresAt = "2099-08-20T01:00:00.000Z";
  live.registry.sourceLeaseDigest = digestValue(live.registry.originalLease);
  assert.throws(() => buildEvidence(live), /expired/u);
  const changed = evidenceInput(); changed.retainedHead.changedPaths = ["source.ts"];
  assert.throws(() => buildEvidence(changed), /empty coordination/u);
  const integrated = evidenceInput(); integrated.cloud.terminal.integrationReceiptDigest = hash("integration");
  assert.throws(() => buildEvidence(integrated), /terminal abandoned/u);
  const foreignSource = evidenceInput(); foreignSource.cloud.source.claimId = hash("foreign-source");
  assert.throws(() => buildEvidence(foreignSource), /do not join/u);
  const foreignTerminal = evidenceInput(); foreignTerminal.cloud.terminal.claimId = hash("foreign-terminal");
  assert.throws(() => buildEvidence(foreignTerminal), /do not join/u);
});

test("local release clears only bounded authority fields and retains the complete original lease", () => {
  const value = plan();
  const authorization = authorizePlan({ plan: value, authorization: value.exactAuthorization });
  const released = buildReleasedLease({ plan: value, authorizationReceipt: authorization,
    releasedAt: "2026-08-24T06:01:00.000Z" });
  assert.equal(released.status, "released");
  assert.equal(released.admission, null);
  assert.equal(released.cloudAuthority, null);
  assert.deepEqual(released.closedAbsentPlannedOwnerRelease.originalLease,
    value.evidence.registry.originalLease);
  assert.equal(released.taskAuthority.bindingDigest,
    value.evidence.registry.originalLease.taskAuthority.bindingDigest);
  assert.equal(isReleasedLease({ lease: released, plan: value, authorizationReceipt: authorization }), true);
  const receipt = buildReceipt({ plan: value, authorizationReceipt: authorization, releasedLease: released });
  assert.equal(receipt.mutationDisposition.cloud, false);
  assert.equal(receipt.targetRegistryRevision, value.evidence.registry.revision + 1);
  assert.deepEqual(buildReceipt({ plan: value, authorizationReceipt: authorization,
    releasedLease: structuredClone(released) }), receipt);
});

test("released projection and normalized plan fail closed on smuggled or foreign fields", () => {
  const value = plan();
  assert.throws(() => normalizePlan({ ...value, unexpected: true }), /invalid or drifted/u);
  const authorization = authorizePlan({ plan: value, authorization: value.exactAuthorization });
  const released = buildReleasedLease({ plan: value, authorizationReceipt: authorization,
    releasedAt: "2026-08-24T06:01:00.000Z" });
  const drifted = structuredClone(released); drifted.autoDelivery = true;
  assert.equal(isReleasedLease({ lease: drifted, plan: value, authorizationReceipt: authorization }), false);
});
