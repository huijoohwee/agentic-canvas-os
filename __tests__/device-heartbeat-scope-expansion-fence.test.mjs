import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { heartbeat } from "../scripts/device-branch-ownership-lib.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { markOperationDerivedCloudVerification }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { renderWriterLeasePullRequestBody, createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import { beginScopeExpansionIntent, writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
import { beginActiveOwnedDirtRecoveryIntent } from "../scripts/active-owned-dirt-recovery-registry.mjs";
import { normalizeActiveOwnedDirtRecoveryPlan } from "../scripts/active-owned-dirt-recovery-contract.mjs";

const BRANCH = "agent/device/protected-head-refresh-controller";
const RECOVERY_WRITE_SET = ["path:scripts/recovery.mjs", "semantic:protected-head-refresh-controller"];
const RECOVERY_ACTOR = "github-user:1";
const RECOVERY_REPOSITORY = "github-repository:R";
const RECOVERY_WORK_ITEM = `work-item:${"f".repeat(64)}`;
const RECOVERY_CLOUD_EPOCH = 3;
const CLAIM = digestValue({ actorId: RECOVERY_ACTOR,
  canonicalBaseRevision: "c".repeat(40), leaseEpoch: RECOVERY_CLOUD_EPOCH,
  repositoryId: RECOVERY_REPOSITORY, workItemId: RECOVERY_WORK_ITEM,
  writeSetDigest: digestValue(RECOVERY_WRITE_SET) });
const FENCE = "b".repeat(40);
const PR_URL = "https://github.test/example/repo/pull/42";

test("device heartbeat reads the expansion fence before it can renew C1 remotely", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "scope-expansion-heartbeat-"));
  const repo = root;
  const store = createWriterLeaseStore({
    gitCommonDir: root,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });
  try {
    let lease = store.claim({
      sessionId: "session", device: "device", scope: "protected-head-refresh-controller",
      branch: BRANCH, worktreePath: repo, baseSha: "c".repeat(40), ttlMs: 1_800_000,
    });
    lease = store.annotate({
      sessionId: "session", branch: BRANCH,
      values: {
        fenceSha: FENCE, pullRequestUrl: PR_URL,
        cloudAuthority: { claimId: CLAIM },
      },
    });
    const planCore = {
      schema: "agentic-active-dirty-scope-expansion-plan/v1",
      sourceBranch: BRANCH,
      targetWriteSetDigest: "d".repeat(64),
      targetManifestDigest: "e".repeat(64),
      targetCanonicalBaseSha: "f".repeat(40),
    };
    beginScopeExpansionIntent({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: CLAIM, plan: { ...planCore, planDigest: digestValue(planCore) },
    });
    let cloudRenewed = false;
    const calls = [];
    assert.throws(() => heartbeat({
      invocationPath: repo,
      repo,
      gitText: args => {
        const values = {
          "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${FENCE}\0branch refs/heads/${BRANCH}\0`,
          "diff --name-only --diff-filter=U": "",
          "ls-files -u": "",
          "branch --show-current": BRANCH,
        };
        const key = args.join(" ");
        if (!Object.hasOwn(values, key)) throw new Error(`unexpected git ${key}`);
        return values[key];
      },
      gitOptional: () => `${FENCE}\trefs/heads/${BRANCH}`,
      ghText: () => JSON.stringify({
        url: PR_URL, state: "OPEN", isDraft: true, headRefName: BRANCH,
        headRefOid: FENCE, baseRefName: "main", body: renderWriterLeasePullRequestBody(lease),
      }),
      leaseStore: store,
      sessionId: "session",
      leaseTtlMs: 1_800_000,
      heartbeatCloudAuthority: () => { cloudRenewed = true; throw new Error("unexpected cloud renewal"); },
      verifyActiveCloudAuthority: () => { throw new Error("unexpected cloud verifier"); },
      run: (command, args) => calls.push([command, ...args]),
    }), /fences this source heartbeat/);
    assert.equal(cloudRenewed, false);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("device heartbeat cannot cross an active-owned-dirt recovery intent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "owned-dirt-heartbeat-"));
  const store = createWriterLeaseStore({
    gitCommonDir: root,
    now: () => new Date("2026-08-09T00:00:00.000Z"),
  });
  try {
    let lease = store.claim({
      sessionId: "session", device: "device", scope: "protected-head-refresh-controller",
      branch: BRANCH, worktreePath: root, baseSha: "c".repeat(40), ttlMs: 1_800_000,
    });
    lease = store.annotate({
      sessionId: "session", branch: BRANCH,
      values: {
        fenceSha: FENCE, pullRequestUrl: PR_URL,
        cloudAuthority: { claimId: CLAIM },
      },
    });
    const plan = recoveryPlan(lease);
    beginActiveOwnedDirtRecoveryIntent({
      leaseStore: store,
      branch: BRANCH,
      expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: CLAIM,
      plan,
    });
    let cloudRenewed = false;
    assert.throws(() => heartbeat({
      invocationPath: root,
      repo: root,
      gitText: args => {
        const values = {
          "worktree list --porcelain -z": `worktree ${root}\0HEAD ${FENCE}\0branch refs/heads/${BRANCH}\0`,
          "diff --name-only --diff-filter=U": "",
          "ls-files -u": "",
          "branch --show-current": BRANCH,
        };
        const key = args.join(" ");
        if (!Object.hasOwn(values, key)) throw new Error(`unexpected git ${key}`);
        return values[key];
      },
      gitOptional: () => `${FENCE}\trefs/heads/${BRANCH}`,
      ghText: () => JSON.stringify({
        url: PR_URL, state: "OPEN", isDraft: true, headRefName: BRANCH,
        headRefOid: FENCE, baseRefName: "main", body: renderWriterLeasePullRequestBody(lease),
      }),
      leaseStore: store,
      sessionId: "session",
      leaseTtlMs: 1_800_000,
      heartbeatCloudAuthority: () => { cloudRenewed = true; },
      verifyActiveCloudAuthority: () => { throw new Error("unexpected verifier"); },
      run: () => { throw new Error("unexpected mutation"); },
    }), /recovery intent fences this heartbeat/);
    assert.equal(cloudRenewed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("heartbeat adopts one exact public renewal response loss and remains usable", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "heartbeat-adoption-"));
  const store = createWriterLeaseStore({ gitCommonDir: root,
    now: () => new Date("2026-08-11T06:00:00.000Z") });
  try {
    let lease = store.claim({ sessionId: "session", device: "device",
      scope: "protected-head-refresh-controller",
      branch: BRANCH, worktreePath: root, baseSha: "c".repeat(40), ttlMs: 1_800_000 });
    const declaredWriteSet = ["path:docs/a.md", "semantic:protected-head-refresh-controller"];
    const writeSetDigest = digestValue(declaredWriteSet);
    const actorId = "github-user:1", repositoryId = "github-repository:R";
    const workItemId = `work-item:${"f".repeat(64)}`;
    const claimId = digestValue({ actorId, canonicalBaseRevision: lease.baseSha,
      leaseEpoch: 4, repositoryId, workItemId, writeSetDigest });
    const authority = { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "org/repo", targetRepository: "org/repo", claimId,
      claimDigest: "1".repeat(64), ledgerRevision: "1".repeat(40),
      ledgerDigest: "2".repeat(64), claimLedgerRevision: "2".repeat(64),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: "3".repeat(64), mutationAuthorityEligible: true,
      canonicalBaseSha: lease.baseSha, laneRevision: FENCE,
      cloudDeclaredWriteScope: declaredWriteSet, writeSetDigest,
      deviceId: lease.device, sessionId: lease.sessionId, reviewRequestId: null,
      leaseEpoch: 4, transitionCounter: 3, state: "active",
      expiresAt: "2026-08-11T06:30:00.000Z", integrationReceiptDigest: null,
      integration: null, manifestDigest: "4".repeat(64) };
    const admission = { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "protected-head-refresh-controller", declaredWriteSet, writeSetDigest,
      manifestDigest: authority.manifestDigest, planReceiptDigest: "5".repeat(64),
      admissionReceiptDigest: "6".repeat(64), existingLaneStateDigest: "7".repeat(64),
      admittedReportDigest: "8".repeat(64), preservationReceiptDigest: "9".repeat(64) };
    lease = store.annotate({ sessionId: "session", branch: BRANCH, values: {
      fenceSha: FENCE, pullRequestUrl: PR_URL, admission, cloudAuthority: authority } });
    let body = renderWriterLeasePullRequestBody(lease), remoteRenewals = 0;
    let publicClaim = renewalClaim(authority, { actorId, repositoryId, workItemId,
      heartbeatCounter: 1, transitionCounter: 4, expiresAt: "2026-08-11T06:35:58.000Z" });
    const status = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: "a".repeat(40),
      ledgerDigest: "b".repeat(64), claims: [publicClaim] });
    let operationDerived = true, raceOnce = false;
    const verification = projected => {
      const value = {
      schema: "agentic-lane-cloud-verification/v1",
      status: "ready", claimId, claimDigest: projected.claimDigest,
      ledgerRevision: projected.ledgerRevision, ledgerDigest: "b".repeat(64),
      canonicalBaseSha: projected.canonicalBaseSha, laneRevision: FENCE,
      writeSetDigest, reviewRequestId: null, receiptDigest: "e".repeat(64),
      verifiedAt: "2026-08-11T06:12:00.000Z", inventory: {
        schema: "agentic-cloud-claim-inventory/v1", ledgerDigest: "b".repeat(64),
        claims: [{ ...publicClaim, state: "active" }] } };
      return operationDerived ? markOperationDerivedCloudVerification(value) : value;
    };
    const ghText = () => JSON.stringify({ id: "PR_node", url: PR_URL, state: "OPEN",
      isDraft: true, headRefName: BRANCH, headRefOid: FENCE,
      headRepository: { nameWithOwner: "org/repo" }, baseRefName: "main",
      body, autoMergeRequest: null });
    const invoke = () => heartbeat({ invocationPath: root, repo: root,
      gitText: args => ({
        "worktree list --porcelain -z": `worktree ${root}\0HEAD ${FENCE}\0branch refs/heads/${BRANCH}\0`,
        "diff --name-only --diff-filter=U": "", "ls-files -u": "",
        "branch --show-current": BRANCH,
      })[args.join(" ")],
      gitOptional: () => `${FENCE}\trefs/heads/${BRANCH}`, ghText, leaseStore: store,
      sessionId: "session", leaseTtlMs: 1_200_000,
      inspectCloudStatus: status,
      heartbeatCloudAuthority: ({ authority: source }) => {
        remoteRenewals += 1;
        publicClaim = renewalClaim(source, { actorId, repositoryId, workItemId,
          heartbeatCounter: 2, transitionCounter: 5,
          expiresAt: "2026-08-11T06:40:00.000Z" });
        const next = { ...source, claimDigest: publicClaim.fenceRevision,
          ledgerRevision: "c".repeat(40), ledgerDigest: "b".repeat(64),
          claimLedgerRevision: publicClaim.transitionDigest,
          operationReceiptDigest: publicClaim.operationReceiptDigest,
          transitionCounter: 5, expiresAt: publicClaim.expiresAt };
        return { authority: next, verification: verification(next) };
      },
      verifyActiveCloudAuthority: ({ authority: projected }) => {
        if (raceOnce) {
          raceOnce = false;
          store.annotate({ sessionId: "session", branch: BRANCH,
            values: { runtimeRequired: true } });
        }
        return { authority: projected, verification: verification(projected) };
      },
      run: (command, args) => { if (command === "gh") body = args[args.indexOf("--body") + 1]; },
      now: () => new Date("2026-08-11T06:12:00.000Z"), log: () => {} });
    const exactClaim = publicClaim, exactBody = body;
    for (const drift of [
      { transitionCounter: 5 }, { heartbeatCounter: 2 },
      { operationReceiptDigest: authority.operationReceiptDigest },
    ]) {
      const sourceLeaseDigest = digestValue(store.read(BRANCH));
      publicClaim = { ...exactClaim, ...drift };
      assert.throws(invoke, /not one exact renewal/);
      assert.equal(digestValue(store.read(BRANCH)), sourceLeaseDigest);
      assert.equal(remoteRenewals, 0);
    }
    publicClaim = exactClaim;
    body = exactBody.replace('"sessionId":"session"', '"sessionId":"other"');
    assert.throws(invoke, /marker drifted/);
    body = exactBody;
    operationDerived = false;
    assert.throws(invoke, /exact joined cloud/);
    operationDerived = true;
    body = renderWriterLeasePullRequestBody(store.read(BRANCH));
    const adopted = invoke();
    assert.equal(remoteRenewals, 0);
    assert.equal(adopted.cloudAuthority.transitionCounter, 4);
    assert.equal(adopted.cloudAuthority.heartbeatCounter, 1);
    assert.equal(adopted.mutationAuthorityReceipt.schema,
      "agentic-active-draft-mutation-authority/v1");
    const renewed = invoke();
    assert.equal(remoteRenewals, 1);
    assert.equal(renewed.cloudAuthority.transitionCounter, 5);
    assert.equal(renewed.mutationAuthorityReceipt.status, "ready");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function renewalClaim(authority, {
  actorId, repositoryId, workItemId, heartbeatCounter, transitionCounter, expiresAt,
}) {
  return { claimId: authority.claimId, entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "current",
    writeAuthority: true, scopeReserved: true, actorId, repositoryId, workItemId,
    canonicalBaseRevision: authority.canonicalBaseSha, laneRevision: authority.laneRevision,
    declaredWriteScope: authority.cloudDeclaredWriteScope,
    writeSetDigest: authority.writeSetDigest, leaseEpoch: authority.leaseEpoch,
    transitionCounter, heartbeatCounter, reviewRequestId: null,
    predecessorClaimId: null, expiresAt, fenceRevision: `${transitionCounter}`.repeat(64),
    transitionDigest: `${heartbeatCounter + 4}`.repeat(64),
    operationReceiptDigest: `${heartbeatCounter + 5}`.repeat(64),
    integrationReceiptDigest: null, integration: null };
}

function recoveryPlan(lease) {
  const declaredWriteSet = RECOVERY_WRITE_SET;
  const writeSetDigest = digestValue(declaredWriteSet);
  const core = {
    schema: "agentic-active-owned-dirt-recovery-plan/v1",
    sourceSessionId: lease.sessionId,
    sourceDevice: lease.device,
    sourceScope: lease.scope,
    sourceBranch: lease.branch,
    sourceEpoch: lease.epoch,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceBaseSha: lease.baseSha,
    sourceFenceSha: lease.fenceSha,
    sourcePullRequestUrl: lease.pullRequestUrl,
    sourcePullRequestId: "PR_source",
    sourcePullRequestRepository: "example/repo",
    sourcePullRequestBodyDigest: "1".repeat(64),
    sourceMarkerDigest: "2".repeat(64),
    sourceWorktreeIdentityDigest: "3".repeat(64),
    sourceEntrySchema: "agentic-cloud-collaboration-entry/v2",
    sourceClaimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    sourceActorId: RECOVERY_ACTOR,
    sourceRepositoryId: RECOVERY_REPOSITORY,
    sourceWorkItemId: RECOVERY_WORK_ITEM,
    sourcePredecessorClaimId: null,
    sourceCloudDeviceId: `device:${digestValue({ namespace: "device", value: lease.device })}`,
    sourceCloudSessionId: `session:${digestValue({ namespace: "session", value: lease.sessionId })}`,
    sourceClaimId: CLAIM,
    sourceClaimDigest: "4".repeat(64),
    sourceClaimLedgerRevision: "5".repeat(64),
    sourceCloudTransitionCounter: 3,
    sourceCloudLeaseEpoch: RECOVERY_CLOUD_EPOCH,
    sourceOperationReceiptDigest: "0".repeat(64),
    sourceLedgerRevision: "6".repeat(40),
    sourceLedgerDigest: "7".repeat(64),
    sourceReviewRequestId: null,
    sourceManifestDigest: "8".repeat(64),
    sourceWriteSetDigest: writeSetDigest,
    sourceDeclaredWriteSet: declaredWriteSet,
    sourceProtectedMainAdvance: {
      schema: "agentic-active-owned-dirt-protected-main-advance/v1",
      baseSha: lease.baseSha, pullRequestBaseSha: "d".repeat(40),
      protectedMainSha: "e".repeat(40), protectedMainTreeSha: "f".repeat(40),
      declaredWriteSetDigest: writeSetDigest, changedPathCount: 1,
      changedPathsDigest: digestValue(["docs/unrelated.md"]),
    },
    evidenceDigest: "9".repeat(64),
    dirtyPathCount: 1,
    snapshotTimestamp: "2026-08-09T00:00:00.000Z",
    ttlSeconds: 1_800,
  };
  return normalizeActiveOwnedDirtRecoveryPlan({ ...core, planDigest: digestValue(core) });
}
