import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlan,
  buildEvidence,
  buildPlan,
  buildReleasedLease,
} from "../scripts/closed-absent-planned-owner-release-contract.mjs";
import { createController } from "../scripts/closed-absent-planned-owner-release-controller.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";

const hash = label => digestValue({ label });
const sha = label => hash(label).slice(0, 40);

function evidence() {
  const repository = "owner/repository", branch = "agent/device/closed-owner";
  const baseSha = sha("base"), headSha = sha("head"), nodeId = "PR_closed";
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "session", device: "device", scope: "closed-owner", branch,
    worktreePath: "/missing/owner", baseSha, fenceSha: headSha,
    pullRequestUrl: "https://example.test/pull/9", autoDelivery: false, runtimeRequired: false,
    admission: { status: "planned" }, cloudAuthority: { ledgerRepository: "owner/ledger",
      targetRepository: repository, claimId: hash("claim"), claimDigest: hash("source"),
      canonicalBaseSha: baseSha, laneRevision: headSha, writeSetDigest: hash("write"),
      leaseEpoch: 1, transitionCounter: 2, reviewRequestId: `github-pull-request:${nodeId}`,
      expiresAt: "2026-08-20T02:00:00.000Z" }, heartbeatAt: "2026-08-20T00:00:00.000Z",
    expiresAt: "2026-08-20T01:00:00.000Z" };
  return buildEvidence({ schema: "agentic-closed-absent-planned-owner-release-evidence/v1",
    observedAt: "2026-08-24T06:00:00.000Z",
    repository: { id: "R_repo", nameWithOwner: repository,
      gitCommonDirectoryDigest: hash("common") },
    controller: { repository: "owner/ledger", branch: "main", headSha: sha("controller"),
      originMainSha: sha("controller"), treeSha: sha("controller-tree"),
      runtimeDigest: hash("runtime"), clean: true, protected: true },
    registry: { schema: "agentic-writer-lease-registry/v2", revision: 8,
      registryDigest: hash("registry"), sourceLeaseDigest: digestValue(lease), originalLease: lease,
      relatedArtifacts: { scopeExpansionIntent: false, activeOwnedDirtRecoveryIntent: false,
        reviewedLaneEntrypointFence: false } },
    localAbsence: { branch, worktreePath: lease.worktreePath, worktreeRegistered: false,
      worktreePathPresent: false, localBranchPresent: false, remoteBranchPresent: false,
      matchingWorktreeCount: 0, matchingLocalRefCount: 0, matchingRemoteRefCount: 0 },
    pullRequest: { number: 9, nodeId, url: lease.pullRequestUrl, state: "CLOSED", isDraft: true,
      mergedAt: null, closedAt: "2026-08-20T01:30:00.000Z", headRepository: repository,
      headBranch: branch, headSha, baseRepository: repository, baseBranch: "main", baseSha,
      bodyDigest: hash("body"), bodyRemainderDigest: hash("remainder"),
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)) },
    retainedHead: { ref: "refs/pull/9/head", sha: headSha, treeSha: sha("tree"),
      parentShas: [baseSha], baseTreeSha: sha("tree"), changedPaths: [] },
    cloud: { ledgerRepository: "owner/ledger", ledgerRevision: sha("ledger"),
      ledgerDigest: hash("ledger-head"), sequence: 10, validatedLedgerDigest: hash("ledger-body"),
      currentClaimCardinality: 0,
      source: { claimId: lease.cloudAuthority.claimId,
        entryDigest: hash("source-entry"), claimDigest: hash("source"),
        transitionCounter: 2, state: "current" },
      terminal: { claimId: lease.cloudAuthority.claimId,
        entryDigest: hash("terminal-entry"), claimDigest: hash("terminal"),
        transitionCounter: 3, action: "retire", state: "retired", reason: "abandoned",
        finalRevision: headSha, reviewRequestId: `github-pull-request:${nodeId}`,
        retiredAt: "2026-08-24T05:00:00.000Z", integrationReceiptDigest: null } } });
}

test("planning double-reads one stable read-only evidence frame", async () => {
  const source = evidence(), observations = [];
  const adapter = { observe: async input => (observations.push(input || null), source),
    classifyOwner() {}, releaseOwner() {}, verifyTerminal() {} };
  const plan = await createController({ adapter }).plan();
  assert.equal(plan.evidence.evidenceDigest, source.evidenceDigest);
  assert.deepEqual(observations, [null, { observedAt: source.observedAt }]);
});

test("planning rejects evidence drift across the mandatory double read", async () => {
  const first = evidence(), second = structuredClone(first);
  second.repository.id = "R_changed";
  const adapter = { observe: async () => first ? [first, second].shift() : second,
    classifyOwner() {}, releaseOwner() {}, verifyTerminal() {} };
  let index = 0; adapter.observe = async () => [first, second][index++];
  await assert.rejects(createController({ adapter }).plan(), /drifted/u);
});

test("wrong authorization reaches no adapter operation", async () => {
  const plan = buildPlan({ evidence: evidence() }); let effects = 0;
  const adapter = { observe() {}, classifyOwner() { effects += 1; }, releaseOwner() { effects += 1; },
    verifyTerminal() { effects += 1; } };
  await assert.rejects(createController({ adapter }).run({ plan, authorization: "wrong" }), /Exact/u);
  assert.equal(effects, 0);
});

test("controller adopts CAS response loss and replay returns the same receipt", async () => {
  const plan = buildPlan({ evidence: evidence() });
  const authorization = authorizePlan({ plan, authorization: plan.exactAuthorization });
  let released = null, releaseCalls = 0;
  const adapter = {
    observe() {},
    classifyOwner() { return released ? { state: "complete", lease: released } : { state: "pending" }; },
    releaseOwner(_plan, receipt) {
      releaseCalls += 1;
      released = buildReleasedLease({ plan, authorizationReceipt: receipt,
        releasedAt: "2026-08-24T06:01:00.000Z" });
      throw new Error("simulated response loss");
    },
    verifyTerminal() { return { releasedLease: released }; },
  };
  const controller = createController({ adapter });
  const first = await controller.run({ plan, authorization: plan.exactAuthorization });
  const second = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(second, first);
  assert.equal(releaseCalls, 1);
  assert.equal(first.authorizationDigest, authorization.authorizationDigest);
  assert.equal(first.mutationDisposition.provider, false);
});
