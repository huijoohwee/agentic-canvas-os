// Responsibility: prove the repository adapter's sole terminal writer-registry and PR effect.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  activeDirtyScopeExpansionIntentRecoveryDirtDigest,
  buildActiveDirtyScopeExpansionIntentRecoveryMutationAuthority,
  createActiveDirtyScopeExpansionIntentRecoveryAdapter,
  MAX_RECOVERY_LEDGER_BYTES,
  parseValidatedRecoveryLedgerSnapshot,
  requireRecoveryLedgerRepository,
  requireActiveDirtyScopeExpansionIntentRecoveryDeterministicTerminal,
  settleActiveDirtyScopeExpansionIntentRecoveryTerminal,
  withActiveDirtyScopeExpansionIntentRecoveryLock,
} from "../scripts/active-dirty-scope-expansion-intent-recovery-repository-adapter.mjs";
import { markOperationDerivedCloudVerification }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { parseWriterLeasePullRequestBody, renderWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

test("terminal settlement preserves C3 history and atomically records joined C4 projections", () => {
  const fixture = repositoryFixture();
  let body = renderWriterLeasePullRequestBody(fixture.boundLease);
  let edits = 0;
  const terminal = settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
    before: fixture.before,
    leaseStore: fixture.store,
    readPullRequest: () => ({ ...fixture.pullIdentity, body }),
    editPullRequest: (_url, nextBody) => { edits += 1; body = nextBody; },
  });

  const registry = fixture.readRegistry();
  const persisted = registry.scopeExpansionIntents[fixture.branch];
  assert.equal(edits, 1);
  assert.equal(persisted.status, "complete");
  assert.deepEqual(persisted, terminal);
  assert.deepEqual(persisted.boundAuthority, fixture.sourceIntent.boundAuthority);
  assert.equal(persisted.boundReceiptDigest, fixture.sourceIntent.boundReceiptDigest);
  assert.equal(persisted.targetClaimDigest, fixture.sourceIntent.targetClaimDigest);
  assert.equal(persisted.localProjection.leaseDigest, fixture.before.leaseDigest);
  assert.equal(persisted.localProjection.receiptDigest,
    fixture.before.mutationAuthority.receiptDigest);
  assert.equal(persisted.pullRequestProjection.markerDigest,
    digestValue(parseWriterLeasePullRequestBody(body)));
});

test("terminal settlement adopts response loss and does not repeat the PR effect", () => {
  const fixture = repositoryFixture();
  let body = renderWriterLeasePullRequestBody(fixture.boundLease);
  let edits = 0;
  const effect = {
    leaseStore: fixture.store,
    readPullRequest: () => ({ ...fixture.pullIdentity, body }),
    editPullRequest: (_url, nextBody) => { edits += 1; body = nextBody; },
  };
  settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
    ...effect, before: fixture.before,
  });
  const complete = fixture.readRegistry().scopeExpansionIntents[fixture.branch];
  const replay = settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
    ...effect,
    before: { ...fixture.before, scopeExpansionIntent: complete,
      scopeExpansionIntentDigest: digestValue(complete) },
  });
  assert.deepEqual(replay, complete);
  assert.equal(edits, 1);
});

test("terminal settlement fails closed on registry drift before editing the PR", () => {
  const fixture = repositoryFixture();
  const registry = fixture.readRegistry();
  registry.scopeExpansionIntents[fixture.branch] = {
    ...fixture.sourceIntent, boundReceiptDigest: digest("drifted bound receipt"),
  };
  writeFileSync(fixture.statePath, `${JSON.stringify(registry, null, 2)}\n`);
  let edits = 0;
  assert.throws(() => settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
    before: fixture.before,
    leaseStore: fixture.store,
    readPullRequest: () => ({ ...fixture.pullIdentity,
      body: renderWriterLeasePullRequestBody(fixture.boundLease) }),
    editPullRequest: () => { edits += 1; },
  }), /intent changed before terminal CAS/u);
  assert.equal(edits, 0);
});

test("response-loss adoption rejects a forged complete intent", () => {
  const fixture = repositoryFixture();
  let body = renderWriterLeasePullRequestBody(fixture.boundLease);
  const terminal = settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
    before: fixture.before, leaseStore: fixture.store,
    readPullRequest: () => ({ ...fixture.pullIdentity, body }),
    editPullRequest: (_url, nextBody) => { body = nextBody; },
  });
  const live = { leaseDigest: fixture.before.leaseDigest,
    currentAuthority: fixture.before.currentAuthority,
    mutationAuthority: fixture.before.mutationAuthority,
    pullRequest: { url: fixture.pullIdentity.url,
      markerDigest: digestValue(parseWriterLeasePullRequestBody(body)) } };
  assert.deepEqual(requireActiveDirtyScopeExpansionIntentRecoveryDeterministicTerminal({
    sourceIntent: fixture.sourceIntent, currentIntent: terminal, live,
  }), terminal);
  assert.throws(() => requireActiveDirtyScopeExpansionIntentRecoveryDeterministicTerminal({
    sourceIntent: fixture.sourceIntent,
    currentIntent: { ...terminal, finalReceiptDigest: digest("forged final") }, live,
  }), /not the deterministic C4 projection/u);
});

test("entrypoint fence reclaims a dead owner but preserves a live owner", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scope-intent-lock-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "entry.lock");
  writeFileSync(lockPath, `${JSON.stringify({ pid: 42, token: "dead-owner" })}\n`);
  let ran = false;
  await withActiveDirtyScopeExpansionIntentRecoveryLock(
    lockPath, { planDigest: digest("plan") }, async () => { ran = true; },
    { processAlive: () => false },
  );
  assert.equal(ran, true);
  assert.throws(() => readFileSync(lockPath), /ENOENT/u);

  writeFileSync(lockPath, `${JSON.stringify({ pid: 42, token: "live-owner" })}\n`);
  await assert.rejects(() => withActiveDirtyScopeExpansionIntentRecoveryLock(
    lockPath, {}, async () => {}, { processAlive: () => true },
  ), /already fenced/u);
});

test("adapter interface rejects any missing repository effect", () => {
  const complete = Object.fromEntries(["withEntrypointFence", "readSourceEvidence",
    "readIntent", "writeIntent", "observeTerminal", "executeTerminal"]
    .map(name => [name, () => name]));
  assert.equal(createActiveDirtyScopeExpansionIntentRecoveryAdapter(complete)
    .executeTerminal(), "executeTerminal");
  assert.throws(() => createActiveDirtyScopeExpansionIntentRecoveryAdapter({
    ...complete, observeTerminal: null,
  }), /requires observeTerminal/u);
});

test("dirt evidence reproduces the original trimmed Git patch digest", () => {
  const input = {
    stagedPatch: "staged patch\n",
    unstagedPatch: "unstaged patch\n\n",
    changedPaths: ["scripts/example.mjs"],
    untrackedPaths: [],
  };
  assert.equal(
    activeDirtyScopeExpansionIntentRecoveryDirtDigest(input),
    digestValue({
      stagedPatch: "staged patch",
      unstagedPatch: "unstaged patch",
      changedPaths: input.changedPaths,
      untracked: input.untrackedPaths,
    }),
  );
});

test("recovery binds its explicit ledger repository to the leased cloud authority", () => {
  assert.equal(requireRecoveryLedgerRepository({
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    authority: { ledgerRepository: "huijoohwee/agentic-canvas-os" },
  }), "huijoohwee/agentic-canvas-os");
  assert.throws(() => requireRecoveryLedgerRepository({
    ledgerRepository: "huijoohwee/knowgrph",
    authority: { ledgerRepository: "huijoohwee/agentic-canvas-os" },
  }), /does not match the leased cloud authority/u);
});

test("production-sized recovery snapshots remain bounded and validated", () => {
  const productionSizedInvalidLedger = JSON.stringify({
    padding: "x".repeat(12_000_000),
  });
  assert.throws(() => parseValidatedRecoveryLedgerSnapshot(productionSizedInvalidLedger),
    /Ledger snapshot is invalid/u);
  assert.throws(() => parseValidatedRecoveryLedgerSnapshot("x".repeat(
    MAX_RECOVERY_LEDGER_BYTES + 1,
  )), /exceeds recovery bounds/u);
});

test("recovery mutation authority admits unrelated global-head drift only", () => {
  const fixture = repositoryFixture(), authority = fixture.before.currentAuthority;
  const candidate = { claimId: authority.claimId,
    entrySchema: authority.entrySchema, claimIdentitySchema: authority.claimIdentitySchema,
    operationReceiptDigest: authority.operationReceiptDigest, state: "active",
    actorId: "github-user:42", repositoryId: "github-repository:R_acos",
    workItemId: "work-item:scope", canonicalBaseRevision: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision, declaredWriteScope: authority.cloudDeclaredWriteScope,
    writeSetDigest: authority.writeSetDigest, leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter, heartbeatCounter: authority.heartbeatCounter,
    reviewRequestId: authority.reviewRequestId, expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest, transitionDigest: authority.claimLedgerRevision,
    recordDigest: digest("record") };
  const inventoryCore = { schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: sha("advanced ledger"), ledgerDigest: digest("advanced head"),
    evaluationTime: "2026-08-12T00:31:00.000Z", claims: [candidate] };
  const inventory = { ...inventoryCore, inventoryDigest: digestValue(inventoryCore) };
  const verification = { schema: "agentic-lane-cloud-verification/v1",
    status: "ready", claimId: authority.claimId, claimDigest: authority.claimDigest,
    ledgerRevision: inventory.observedLedgerHeadRevision, ledgerDigest: inventory.ledgerDigest,
    receiptDigest: digest("verification"), verifiedAt: inventory.evaluationTime, inventory };
  markOperationDerivedCloudVerification(verification);
  const verifiedAuthority = { ...authority, ledgerRevision: verification.ledgerRevision,
    ledgerDigest: verification.ledgerDigest };
  const currentClaim = { ...candidate, state: "current", deviceId: authority.deviceId,
    sessionId: authority.sessionId, writeAuthority: true, scopeReserved: true,
    predecessorClaimId: null, ledgerRevision: authority.claimLedgerRevision,
    integrationReceiptDigest: null, integration: null };
  const receipt = buildActiveDirtyScopeExpansionIntentRecoveryMutationAuthority({
    lease: fixture.before.lease, currentAuthority: authority, verifiedAuthority,
    remoteAuthorityVerification: verification, currentClaim });
  assert.equal(receipt.localAuthorityDigest, digestValue(authority));
  assert.equal(receipt.globalLedgerRevision, verification.ledgerRevision);
  assert.throws(() => buildActiveDirtyScopeExpansionIntentRecoveryMutationAuthority({
    lease: fixture.before.lease, currentAuthority: authority, verifiedAuthority,
    remoteAuthorityVerification: { ...verification, inventory: { ...inventory,
      claims: [...inventory.claims, { ...candidate, claimId: digest("competitor") }] } },
    currentClaim,
  }), /exact local C4|operation-derived inventory/u);
});

function repositoryFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scope-intent-recovery-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "writer-leases.json");
  const branch = "agent/device/scope-recovery";
  const head = sha("head"), base = sha("base");
  const declaredWriteSet = ["path:scripts/one.mjs", "path:scripts/two.mjs",
    "semantic:scope-recovery"];
  const targetManifest = { schema: "agentic-declared-write-scope/v1",
    semanticScope: "scope-recovery", paths: ["scripts/one.mjs", "scripts/two.mjs"] };
  const targetManifestDigest = digestValue(targetManifest);
  const targetWriteSetDigest = digestValue(declaredWriteSet);
  const planCore = {
    schema: "agentic-active-dirty-scope-expansion-plan/v1", sourceBranch: branch,
    sourceFenceSha: head, sourceLeaseDigest: digest("source lease"),
    sourceClaimId: digest("source claim"), sourceClaimDigest: digest("source fence"),
    sourceClaimTransitionCounter: 8,
    sourceReviewRequestId: "github-pull-request:PR_node",
    sourceWriteSetDigest: digest("source write set"),
    sourceManifestDigest: digest("source manifest"), sourceDirtyDigest: digest("dirty"),
    sourceChangedPaths: ["scripts/one.mjs"], targetCanonicalBaseSha: base,
    targetManifestDigest, targetWriteSetDigest,
    targetDeclaredWriteSet: declaredWriteSet, targetCloudLeaseEpoch: 1,
  };
  const planSnapshot = { ...planCore, planDigest: digestValue(planCore) };
  const boundAuthority = authority({ transition: 3, claimDigest: digest("claim c3"),
    ledgerRevision: sha("ledger c3"), claimLedgerRevision: digest("entry c3"),
    heartbeatCounter: 0, expiresAt: "2099-08-12T01:00:00.000Z", base, head,
    declaredWriteSet, targetWriteSetDigest, targetManifestDigest });
  const currentAuthority = authority({ transition: 4, claimDigest: digest("claim c4"),
    ledgerRevision: sha("ledger c4"), claimLedgerRevision: digest("entry c4"),
    heartbeatCounter: 1, expiresAt: "2099-08-12T02:00:00.000Z", base, head,
    declaredWriteSet, targetWriteSetDigest, targetManifestDigest });
  const sourceIntent = {
    schema: "agentic-active-dirty-scope-expansion-intent/v1",
    status: "successor-bound", branch,
    sourceLeaseDigest: planSnapshot.sourceLeaseDigest,
    sourceClaimId: planSnapshot.sourceClaimId, sourceFenceSha: head,
    targetWriteSetDigest, targetManifestDigest, planDigest: planSnapshot.planDigest,
    targetClaimId: currentAuthority.claimId,
    targetClaimDigest: boundAuthority.claimDigest, targetLeaseEpoch: 1,
    targetCanonicalBaseSha: base,
    targetReviewRequestId: currentAuthority.reviewRequestId,
    completedReceiptDigest: null,
    waiting: historicalSuccessor(currentAuthority.claimId, 1),
    waitingReceiptDigest: digest("waiting receipt"),
    sourceRetirementReceiptDigest: digest("retirement receipt"),
    promoted: historicalSuccessor(currentAuthority.claimId, 2),
    promotedReceiptDigest: digest("promoted receipt"), boundAuthority,
    boundReceiptDigest: digest("bound receipt"), localProjection: null,
    localProjectionReceiptDigest: null, pullRequestProjection: null,
    pullRequestProjectionReceiptDigest: null, finalReceiptDigest: null, planSnapshot,
  };
  const lease = writerLease({ branch, base, head, authority: currentAuthority,
    declaredWriteSet, targetWriteSetDigest, targetManifestDigest });
  const boundLease = writerLease({ branch, base, head, authority: boundAuthority,
    declaredWriteSet, targetWriteSetDigest, targetManifestDigest });
  const mutationCore = {
    schema: "agentic-active-dirty-scope-expansion-intent-recovery-mutation-authority/v1",
    status: "ready",
    claimId: currentAuthority.claimId, claimDigest: currentAuthority.claimDigest,
    claimLedgerRevision: currentAuthority.claimLedgerRevision,
    localAuthorityDigest: digestValue(currentAuthority),
    localLeaseDigest: writerLeaseDigest(lease), localLeaseEpoch: lease.epoch,
    localFenceSha: head, globalLedgerRevision: currentAuthority.ledgerRevision,
    globalLedgerDigest: currentAuthority.ledgerDigest,
    currentClaimDigest: digest("current claim"),
    currentClaimInventoryDigest: digest("current inventory"),
    cloudVerificationReceiptDigest: digest("verification"),
    evaluatedAt: "2026-08-12T00:31:00.000Z", expiresAt: currentAuthority.expiresAt,
  };
  const mutationAuthority = { ...mutationCore, receiptDigest: digestValue(mutationCore) };
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 0,
    leases: { [branch]: lease }, scopeExpansionIntents: { [branch]: sourceIntent } };
  writeFileSync(statePath, `${JSON.stringify(registry, null, 2)}\n`);
  const store = { statePath, readRegistry: () => JSON.parse(readFileSync(statePath, "utf8")),
    withRegistryLock: action => action(JSON.parse(readFileSync(statePath, "utf8"))) };
  const pullIdentity = { url: lease.pullRequestUrl, number: 436, nodeId: "PR_node",
    state: "OPEN", isDraft: true, headRepository: "o/r", headRefName: branch,
    headRefOid: head, baseRepository: "o/r", baseRefName: "main", baseRefOid: base };
  const boundBody = renderWriterLeasePullRequestBody(boundLease);
  const before = { lane: { branch }, lease, leaseDigest: writerLeaseDigest(lease),
    scopeExpansionIntent: sourceIntent, scopeExpansionIntentDigest: digestValue(sourceIntent),
    currentAuthority, mutationAuthority,
    pullRequest: { ...pullIdentity, bodyDigest: digestValue(boundBody) } };
  return { before, boundLease, branch, pullIdentity, readRegistry: store.readRegistry,
    sourceIntent, statePath, store };
}

function authority({ transition, claimDigest, ledgerRevision, claimLedgerRevision,
  heartbeatCounter, expiresAt, base, head, declaredWriteSet,
  targetWriteSetDigest, targetManifestDigest }) {
  return { schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "o/ledger", targetRepository: "o/r",
    claimId: digest("target claim"), claimDigest, ledgerRevision,
    ledgerDigest: claimLedgerRevision, claimLedgerRevision,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: digest(`operation ${transition}`),
    mutationAuthorityEligible: true, canonicalBaseSha: base, laneRevision: head,
    cloudDeclaredWriteScope: declaredWriteSet, writeSetDigest: targetWriteSetDigest,
    deviceId: "device-a", sessionId: "session-a",
    reviewRequestId: "github-pull-request:PR_node", leaseEpoch: 1,
    transitionCounter: transition, heartbeatCounter, state: "active", expiresAt,
    integrationReceiptDigest: null, integration: null,
    manifestDigest: targetManifestDigest };
}

function historicalSuccessor(claimId, transitionCounter) {
  return { claimId, claimDigest: digest(`claim c${transitionCounter}`),
    ledgerRevision: sha(`ledger c${transitionCounter}`),
    claimLedgerRevision: digest(`entry c${transitionCounter}`), transitionCounter,
    expiresAt: "2099-08-12T01:00:00.000Z" };
}

function writerLease({ branch, base, head, authority, declaredWriteSet,
  targetWriteSetDigest, targetManifestDigest }) {
  return { schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "session-a", device: "device-a", scope: "scope-recovery", branch,
    worktreePath: "/tmp/scope-recovery", baseSha: base, fenceSha: head,
    pullRequestUrl: "https://github.com/o/r/pull/436", autoDelivery: false,
    runtimeRequired: false, admission: { schema: "agentic-lane-admission-lease/v1",
      status: "admitted", semanticScope: "scope-recovery", declaredWriteSet,
      writeSetDigest: targetWriteSetDigest, manifestDigest: targetManifestDigest,
      planReceiptDigest: digest("admission plan"),
      admissionReceiptDigest: digest("admission"),
      existingLaneStateDigest: digest("lane state"),
      admittedReportDigest: digest("admitted report"),
      preservationReceiptDigest: digest("preservation") },
    cloudAuthority: authority, acquiredAt: "2026-08-12T00:00:00.000Z",
    heartbeatAt: "2026-08-12T00:30:00.000Z", expiresAt: authority.expiresAt };
}

function digest(label) { return digestValue({ label }); }
function sha(label) { return digest(label).slice(0, 40); }
