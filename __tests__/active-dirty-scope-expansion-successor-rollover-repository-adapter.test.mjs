// Responsibility: prove successor-rollover repository effects fail closed at external and replay boundaries.
import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter,
  isSuccessorRolloverRawBoundCandidate,
  isSuccessorRolloverStaleCandidate,
  matchesSuccessorRolloverSourceClaimIdentity,
  matchesSuccessorRolloverLocalSourceIdentity,
  validateSuccessorRolloverLocalReceipt,
  validateSuccessorRolloverPullRequestFence,
  validateSuccessorRolloverPullRequestReceipt,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-repository-adapter.mjs";
import {
  advanceSuccessorRolloverReplacement,
  advanceSuccessorRolloverRetirement,
  beginSuccessorRolloverReplacement,
  buildSuccessorRolloverReplacementPlan,
  buildSuccessorRolloverRetirementPlan,
  createSuccessorRolloverJournal,
  successorRolloverOperationKey,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs";
import { classifySuccessorRolloverBindEvidence }
  from "../scripts/active-dirty-scope-expansion-successor-rollover-bind-evidence.mjs";
import { claimOnlyOperationReceiptForEntry } from "../scripts/claim-only-partial-start-retirement-store.mjs";
import { applyCloudTransition, createEmptyLedger, listCurrentClaims }
  from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
import { projectPublicClaim, pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const CONTROLLER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRANCH = "agent/device/commerce", FENCE = "a".repeat(40), MAIN = "c".repeat(40);
const C1 = "1".repeat(64), C2 = "2".repeat(64), C3 = "3".repeat(64);
const SOURCE = ["path:a.mjs", "path:b.mjs", "semantic:commerce"];
const STALE = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "path:device-branch-lib.mjs", "semantic:commerce"];
const CORRECTED = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "semantic:commerce"];
const sha = value => value.repeat(40), digest = value => value.repeat(64);

function repositoryFixture(t) {
  const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), "successor-rollover-adapter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "source"), common = path.join(root, "common"), stateDirectory = path.join(root, "private");
  mkdirSync(repository); mkdirSync(common); mkdirSync(stateDirectory, { mode: 0o700 }); chmodSync(stateDirectory, 0o700);
  const statePath = path.join(stateDirectory, "journal.json"), registryPath = path.join(common, "registry.json");
  const leaseStore = { statePath: registryPath, withRegistryLock: action => action({ schema: "agentic-writer-lease-registry/v2", revision: 1, leases: {} }) };
  const options = { repository, sourceSessionId: "source-session", pullRequestNumber: 809, statePath, controllerRoot: CONTROLLER_ROOT };
  const dependencies = {
    leaseStore,
    git: args => args[0] === "branch" ? BRANCH : common,
    gitRaw: () => `worktree ${repository}\0HEAD ${FENCE}\0branch refs/heads/${BRANCH}\0`,
  };
  return { root, repository, common, stateDirectory, statePath, registryPath, leaseStore, options, dependencies };
}

function liveChurnFixture(t) {
  const fixture = repositoryFixture(t), OLD_BASE = sha("b");
  const owner = { actorId: "github-user:1",
    deviceId: pseudonymousIdentifier("device", "device"),
    sessionId: pseudonymousIdentifier("session", "source-session") };
  const cloudRepository = { repositoryId: "github-repository:1", canonicalRevision: OLD_BASE };
  const workItemId = pseudonymousIdentifier("work-item", "commerce");
  const at = "2026-08-30T00:03:00.000Z";
  function claim(ledger, { actor = owner, work = workItemId, scope, id, time }) {
    return applyCloudTransition({ ledger, action: "claim", actor, repository: cloudRepository,
      evaluationTime: time, request: { workItemId: work,
        canonicalBaseRevision: OLD_BASE, declaredWriteScope: scope,
        laneRevision: FENCE, leaseEpoch: 1, expiresAt: "2099-01-01T00:00:00.000Z",
        expectedLedgerDigest: ledger.headDigest, idempotencyKey: id } });
  }
  const c1 = claim(createEmptyLedger("github-repository:ledger"), {
    scope: SOURCE, id: "c1", time: "2026-08-30T00:00:00.000Z" });
  const c2 = claim(c1.ledger, { scope: STALE, id: "c2",
    time: "2026-08-30T00:01:00.000Z" });
  const peer = { actorId: "github-user:2",
    deviceId: pseudonymousIdentifier("device", "other"),
    sessionId: pseudonymousIdentifier("session", "other") };
  const disjoint = claim(c2.ledger, { actor: peer,
    work: pseudonymousIdentifier("work-item", "other"),
    scope: ["path:z.mjs", "semantic:other"], id: "other",
    time: "2026-08-30T00:02:00.000Z" }).ledger;

  const admission = { schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "commerce", declaredWriteSet: SOURCE,
    writeSetDigest: digestValue(SOURCE), manifestDigest: digest("1"),
    planReceiptDigest: digest("2"), admissionReceiptDigest: digest("3"),
    existingLaneStateDigest: digest("4"), admittedReportDigest: digest("5"),
    preservationReceiptDigest: digest("6") };
  const cloudAuthority = { schema: "agentic-lane-cloud-authority/v1",
    claimId: c1.claim.claimId, claimDigest: c1.claim.fenceRevision,
    ledgerRepository: "owner/ledger", targetRepository: "owner/repo",
    ledgerRevision: sha("1"), claimLedgerRevision: c1.claim.ledgerRevision,
    canonicalBaseSha: OLD_BASE, cloudDeclaredWriteScope: SOURCE,
    writeSetDigest: admission.writeSetDigest, manifestDigest: admission.manifestDigest,
    leaseEpoch: 1, state: "current", expiresAt: c1.claim.expiresAt };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "source-session", device: "device", scope: "commerce", branch: BRANCH,
    baseSha: OLD_BASE, fenceSha: FENCE, worktreePath: fixture.repository,
    pullRequestUrl: "https://github.com/example/example/pull/809",
    heartbeatAt: "2026-08-30T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    admission, cloudAuthority };
  const dirtDigest = digestValue({ stagedPatch: "staged patch", unstagedPatch: "",
    changedPaths: ["a.mjs"], untracked: [] });
  const planCore = { schema: "agentic-active-dirty-scope-expansion-plan/v1",
    sourceBranch: BRANCH, sourceFenceSha: FENCE, sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: c1.claim.claimId, sourceClaimDigest: c1.claim.fenceRevision,
    sourceClaimTransitionCounter: c1.claim.transitionCounter,
    sourceReviewRequestId: "github-pull-request:PR_809", sourceWriteSetDigest: admission.writeSetDigest,
    sourceManifestDigest: admission.manifestDigest, sourceDirtyDigest: dirtDigest,
    sourceChangedPaths: ["a.mjs"], targetCanonicalBaseSha: OLD_BASE, targetManifestDigest: digest("7"),
    targetWriteSetDigest: digestValue(STALE), targetDeclaredWriteSet: STALE, targetCloudLeaseEpoch: 1 };
  const planSnapshot = { ...planCore, planDigest: digestValue(planCore) };
  const intent = { schema: "agentic-active-dirty-scope-expansion-intent/v1",
    status: "source-retired", branch: BRANCH, sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: c1.claim.claimId, sourceFenceSha: FENCE,
    targetWriteSetDigest: planCore.targetWriteSetDigest, targetManifestDigest: planCore.targetManifestDigest,
    planDigest: planSnapshot.planDigest, targetClaimId: c2.claim.claimId,
    targetClaimDigest: c2.claim.fenceRevision, targetLeaseEpoch: 1,
    targetCanonicalBaseSha: OLD_BASE, targetReviewRequestId: null, completedReceiptDigest: null,
    waiting: null, waitingReceiptDigest: null, sourceRetirementReceiptDigest: digest("8"),
    promoted: null, promotedReceiptDigest: null, boundAuthority: null, boundReceiptDigest: null,
    localProjection: null, localProjectionReceiptDigest: null, pullRequestProjection: null,
    pullRequestProjectionReceiptDigest: null, finalReceiptDigest: null, planSnapshot };
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [BRANCH]: lease }, scopeExpansionIntents: { [BRANCH]: intent } };
  const leaseStore = { statePath: fixture.registryPath, read: () => lease,
    readRegistry: () => registry, withRegistryLock: action => action(registry) };
  const body = updateWriterLeasePullRequestBody("preserved", lease);
  const git = args => { const joined = args.join(" ");
    if (joined === "rev-parse --git-common-dir") return fixture.common;
    if (joined === "branch --show-current") return BRANCH;
    if (joined === "diff --cached --name-only") return "a.mjs";
    if (joined === "diff --cached --binary") return "staged patch";
    if (joined === "rev-parse HEAD") return FENCE;
    if (args[0] === "ls-remote") return `${FENCE}\trefs/heads/${BRANCH}`;
    return "";
  };
  let frames = [], cursor = 0; const ledgerReads = [], observedSequences = [];
  function frame(revision, ledger, mutateClaims = claims => claims) {
    const claims = listCurrentClaims(ledger, at, { repositoryId: cloudRepository.repositoryId })
      .map(projectPublicClaim);
    return { revision, ledger, status: { schema: "agentic-cloud-collaboration-result/v1",
      ok: true, claims: mutateClaims(structuredClone(claims)), sequence: ledger.sequence,
      ledgerRevision: revision, ledgerDigest: ledger.headDigest } };
  }
  function setFrames(next) { frames = next; cursor = 0; ledgerReads.length = 0;
    observedSequences.length = 0; }
  const adapter = createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter(
    fixture.options, { ...fixture.dependencies, leaseStore, git,
      readPullRequest: () => ({ url: lease.pullRequestUrl, number: 809, id: "PR_809",
        state: "OPEN", isDraft: true, isCrossRepository: false,
        headRefName: BRANCH, headRefOid: FENCE, baseRefName: "main", body }),
      protectedFrame: () => ({ mainSha: MAIN, treeSha: sha("d"),
        changedPaths: ["device-branch-lib.mjs"], advanceDigest: digest("9") }),
      controllerDigest: () => digest("a"), repositoryId: () => "1",
      cloudStatus: () => { const current = frames[cursor++];
        observedSequences.push(current.status.sequence); return current.status; },
      readLedger: (_authority, revision) => { ledgerReads.push(revision);
        return frames.find(value => value.revision === revision).ledger; } });
  const baseline = frame(sha("1"), c2.ledger), advanced = frame(sha("2"), disjoint);
  setFrames([baseline, advanced]);
  return { adapter, baseline, advanced, c2, disjoint, frame, setFrames, claim,
    owner, peer, cloudRepository, lease, intent, ledgerReads, observedSequences };
}

test("factory exposes the complete repository surface and keeps an async entrypoint fenced", async t => {
  const fixture = repositoryFixture(t);
  const adapter = createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter(fixture.options, fixture.dependencies);
  assert.deepEqual(Object.keys(adapter).sort(), ["authorizeEffect", "bindReplacement", "claimReplacement", "observePhaseBComplete",
    "projectPullRequest", "promoteReplacement", "readContinuationFrame", "readPhaseAObservation", "readPhaseBState", "readRecoveryJournal", "reconcilePhase",
    "retireStaleSuccessor", "supersedeLocal", "verifyCompleted", "withEntrypointFence", "writeRecoveryJournal"].sort());
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = adapter.withEntrypointFence({ phase: "replacement" }, async () => { await gate; return "settled"; });
  await assert.rejects(adapter.withEntrypointFence({ phase: "retirement" }, async () => null), /already fenced/u);
  release(); assert.equal(await first, "settled");
  assert.equal(await adapter.withEntrypointFence({ phase: "verified" }, async () => "reacquired"), "reacquired");
});

test("paired Phase-A reads admit unrelated validated ledger-head churn", async t => {
  const fixture = liveChurnFixture(t);
  const observation = await fixture.adapter.readPhaseAObservation();
  assert.deepEqual(fixture.ledgerReads, [sha("1"), sha("2")]);
  assert.deepEqual(fixture.observedSequences, [2, 3]);
  assert.equal(observation.staleSuccessorClaimId, fixture.c2.claim.claimId);
  assert.equal(Object.hasOwn(observation, "observedLedgerDigest"), false);
  assert.equal(buildSuccessorRolloverRetirementPlan({ observation,
    operatorSessionId: "operator" }).schema.endsWith("/v2"), true);
});

test("paired Phase-A reads reject a coherent C2 terminal transition", async t => {
  const fixture = liveChurnFixture(t), ledger = fixture.baseline.ledger;
  const retired = applyCloudTransition({ ledger, action: "retire", actor: fixture.owner,
    repository: fixture.cloudRepository, evaluationTime: "2026-08-30T00:02:00.000Z",
    request: { claimId: fixture.c2.claim.claimId,
      expectedFenceRevision: fixture.c2.claim.fenceRevision,
      expectedTransitionCounter: fixture.c2.claim.transitionCounter,
      expectedLedgerDigest: ledger.headDigest, reason: "superseded", finalRevision: FENCE,
      reviewRequestId: null, bytesDigest: digest("1"), namedChecksDigest: digest("2"),
      handoffEvidenceDigest: digest("3"), idempotencyKey: "c2-drift" } });
  fixture.setFrames([fixture.baseline, fixture.frame(sha("3"), retired.ledger)]);
  await assert.rejects(fixture.adapter.readPhaseAObservation(),
    /unique stale successor|stale waiting successor|changed across paired reads/u);
  assert.deepEqual(fixture.ledgerReads, [sha("1"), sha("3")]);
  assert.deepEqual(fixture.observedSequences, [2, 3]);
});

test("paired Phase-B reads admit unrelated validated ledger-head churn", async t => {
  const fixture = liveChurnFixture(t);
  fixture.setFrames([fixture.baseline, fixture.baseline]);
  const observation = await fixture.adapter.readPhaseAObservation();
  const plan = buildSuccessorRolloverRetirementPlan({ observation, operatorSessionId: "operator" });
  const operationKey = successorRolloverOperationKey(plan, "stale-successor-retired");
  const evidence = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-cloud-effect/v1",
    planDigest: plan.planDigest, phase: "stale-successor-retired",
    staleSuccessorClaimId: observation.staleSuccessorClaimId };
  const ledger = fixture.baseline.ledger;
  const retired = applyCloudTransition({ ledger, action: "retire", actor: fixture.owner,
    repository: fixture.cloudRepository, evaluationTime: "2026-08-30T00:02:00.000Z",
    request: { claimId: fixture.c2.claim.claimId,
      expectedFenceRevision: fixture.c2.claim.fenceRevision,
      expectedTransitionCounter: fixture.c2.claim.transitionCounter,
      expectedLedgerDigest: ledger.headDigest, reason: "superseded", finalRevision: FENCE,
      reviewRequestId: null, bytesDigest: digestValue({ ...evidence, kind: "bytes" }),
      namedChecksDigest: digestValue({ ...evidence, kind: "checks" }),
      handoffEvidenceDigest: digestValue({ ...evidence, kind: "handoff" }),
      idempotencyKey: operationKey } });
  const terminal = retired.ledger.entries.at(-1);
  const retirement = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1",
    staleSuccessorClaimId: fixture.c2.claim.claimId,
    priorClaimDigest: fixture.c2.claim.fenceRevision,
    retiredClaimDigest: terminal.claimDigest, retirementTransitionDigest: terminal.digest,
    transitionCounter: terminal.claimCore.transitionCounter, state: "retired",
    reason: "successor-rollover",
    receiptDigest: claimOnlyOperationReceiptForEntry(terminal, "retired").receiptDigest };
  const journal = advanceSuccessorRolloverRetirement(
    createSuccessorRolloverJournal(plan, plan.exactAuthorization), retirement);
  await fixture.adapter.writeRecoveryJournal({ expectedJournal: null, nextJournal: journal });
  const peer = fixture.claim(retired.ledger, { actor: fixture.peer,
    work: pseudonymousIdentifier("work-item", "phase-b-other"),
    scope: ["path:phase-b-z.mjs", "semantic:phase-b-other"], id: "phase-b-other",
    time: "2026-08-30T00:02:30.000Z" });
  fixture.setFrames([
    fixture.frame(sha("3"), retired.ledger), fixture.frame(sha("4"), peer.ledger),
  ]);
  const replacement = await fixture.adapter.readPhaseBState();
  assert.deepEqual(fixture.ledgerReads, [sha("3"), sha("4")]);
  assert.deepEqual(fixture.observedSequences, [3, 4]);
  assert.equal(replacement.schema.endsWith("/v2"), true);
  assert.equal(Object.hasOwn(replacement, "observedLedgerDigest"), false);
});

test("journal, manifest, and task capability remain external and owner-held", t => {
  const fixture = repositoryFixture(t);
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    statePath: path.join(fixture.repository, "journal.json") }), /external journal state/u);
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    statePath: path.join(CONTROLLER_ROOT, "journal.json") }), /external journal state/u);
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    correctedManifestFile: path.join(CONTROLLER_ROOT, "package.json") }), /external corrected manifest/u);

  const weak = path.join(fixture.stateDirectory, "weak.cap"), secret = "never-print-capability-bytes";
  writeFileSync(weak, secret, { mode: 0o644 }); chmodSync(weak, 0o644);
  let weakError;
  assert.throws(() => { try { createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    taskAuthorityFile: weak }); } catch (error) { weakError = error; throw error; } }, /private owned single-link/u);
  assert.equal(weakError.message.includes(secret), false);

  const linked = path.join(fixture.stateDirectory, "linked.cap"), alias = path.join(fixture.stateDirectory, "linked-alias.cap");
  writeFileSync(linked, secret, { mode: 0o600 }); chmodSync(linked, 0o600); linkSync(linked, alias);
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    taskAuthorityFile: linked }), /private owned single-link/u);

  const traversal = path.join(fixture.root, "private-link"); symlinkSync(fixture.stateDirectory, traversal);
  const manifest = path.join(fixture.stateDirectory, "manifest.json"); writeFileSync(manifest, "{}\n");
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    statePath: path.join(traversal, "new-journal.json") }), /symlink traversal journal state/u);
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    taskAuthorityFile: path.join(traversal, "linked.cap") }), /symlink traversal task-authority capability/u);
  assert.throws(() => createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options,
    correctedManifestFile: path.join(traversal, "manifest.json") }), /symlink traversal corrected manifest/u);
});

test("local response-loss adoption rejects any tampered tombstone digest", () => {
  const core = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-local-receipt/v1", status: "local-cas",
    planDigest: digest("a"), sourceIntentDigest: digest("b"), sourceLeaseDigest: digest("c"), sourceClaimId: C1,
    retiredStaleSuccessorClaimId: C2, replacementClaimId: C3, replacementAuthorityDigest: digest("d"),
    sourcePullRequestMarkerDigest: digest("e"), leaseDigest: digest("f"), taskAuthorityBindingDigest: digest("0") };
  const replacementIntentDigest = digestValue(core), receiptDigest = digestValue({ ...core, replacementIntentDigest });
  const receipt = { ...core, replacementIntentDigest, receiptDigest };
  const expected = { planDigest: core.planDigest, sourceIntentDigest: core.sourceIntentDigest, sourceLeaseDigest: core.sourceLeaseDigest,
    sourceClaimId: C1, retiredStaleSuccessorClaimId: C2, replacementAuthorityDigest: core.replacementAuthorityDigest,
    sourcePullRequestMarkerDigest: core.sourcePullRequestMarkerDigest, leaseDigest: core.leaseDigest,
    replacementClaimId: C3, taskAuthorityBindingDigest: core.taskAuthorityBindingDigest };
  assert.deepEqual(validateSuccessorRolloverLocalReceipt(receipt, expected), {
    leaseDigest: core.leaseDigest, sourceIntentDigest: core.sourceIntentDigest, replacementIntentDigest,
    taskAuthorityBindingDigest: core.taskAuthorityBindingDigest, receiptDigest });
  assert.throws(() => validateSuccessorRolloverLocalReceipt({ ...receipt, receiptDigest: digest("9") }, expected), /durable local successor-rollover receipt/u);
  assert.throws(() => validateSuccessorRolloverLocalReceipt({ ...receipt, replacementAuthorityDigest: digest("8") }, expected), /durable local successor-rollover receipt/u);
  for (const [field, value] of [["sourceLeaseDigest", digest("1")], ["sourceClaimId", digest("2")],
    ["retiredStaleSuccessorClaimId", digest("3")], ["replacementAuthorityDigest", digest("4")],
    ["sourcePullRequestMarkerDigest", digest("5")]]) {
    const forgedCore = { ...core, [field]: value }, forgedIntent = digestValue(forgedCore);
    const forged = { ...forgedCore, replacementIntentDigest: forgedIntent, receiptDigest: digestValue({ ...forgedCore, replacementIntentDigest: forgedIntent }) };
    assert.throws(() => validateSuccessorRolloverLocalReceipt(forged, expected), /durable local successor-rollover receipt/u);
  }
});

test("local-CAS response-loss adoption rejects a later same-claim transition", async t => {
  const fixture = repositoryFixture(t), plan = replacementPlan(), identity = plan.sourceClaimIdentity;
  const actor = { actorId: identity.actorId, deviceId: identity.deviceId,
    sessionId: identity.sessionId };
  const repository = { repositoryId: identity.repositoryId, canonicalRevision: MAIN };
  const claimed = applyCloudTransition({ ledger: createEmptyLedger("github-repository:ledger"),
    action: "claim", actor, repository, evaluationTime: "2026-08-30T00:00:00.000Z",
    request: { workItemId: identity.workItemId, canonicalBaseRevision: MAIN,
      declaredWriteScope: plan.target.declaredWriteSet, laneRevision: FENCE, leaseEpoch: 1,
      predecessorClaimId: null, canonicalDescendantProof: null,
      expiresAt: "2099-08-30T01:00:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: successorRolloverOperationKey(plan, "replacement-claimed") } });
  const publicClaim = projectPublicClaim(claimed.claim);
  const storedClaim = { claimId: publicClaim.claimId, claimDigest: publicClaim.fenceRevision,
    ledgerRevision: sha("4"), claimLedgerRevision: publicClaim.transitionDigest,
    transitionCounter: publicClaim.transitionCounter, state: publicClaim.state,
    predecessorClaimId: null, canonicalBaseSha: MAIN, laneRevision: FENCE,
    writeSetDigest: publicClaim.writeSetDigest, leaseEpoch: 1, expiresAt: publicClaim.expiresAt };
  const retirementPlan = plan.retirementPlanSnapshot, observation = retirementPlan.observation;
  let journal = createSuccessorRolloverJournal(retirementPlan, retirementPlan.exactAuthorization);
  journal = advanceSuccessorRolloverRetirement(journal, { schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1",
    staleSuccessorClaimId: observation.staleSuccessorClaimId,
    priorClaimDigest: observation.staleSuccessorClaimDigest, retiredClaimDigest: digest("d"),
    retirementTransitionDigest: digest("e"), transitionCounter: 2, state: "retired",
    reason: "successor-rollover", receiptDigest: digest("f") });
  journal = beginSuccessorRolloverReplacement(journal, plan, plan.exactAuthorization);
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-claimed",
    { claim: storedClaim, receiptDigest: claimed.receipt.receiptDigest });
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-promoted",
    { claim: storedClaim, promoted: false, receiptDigest: claimed.receipt.receiptDigest });
  const sourceJournal = journal;
  const bindRequest = (prior, idempotencyKey) => applyCloudTransition({ ledger: prior.ledger,
    action: "continue", actor, repository, evaluationTime: "2026-08-30T00:01:00.000Z",
    request: { claimId: prior.claim.claimId, expectedFenceRevision: prior.claim.fenceRevision,
      expectedTransitionCounter: prior.claim.transitionCounter,
      expectedLedgerDigest: prior.ledger.headDigest, mode: "projection", laneRevision: FENCE,
      reviewRequestId: plan.sourceReviewRequestId, idempotencyKey } });
  const continued = bindRequest(claimed, successorRolloverOperationKey(plan, "replacement-bound"));
  const evidence = classifySuccessorRolloverBindEvidence({ plan, journal: sourceJournal,
    ledger: continued.ledger, candidate: projectPublicClaim(continued.claim) });
  const boundClaim = evidence.boundReplacement.claim;
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-bound", {
    authority: { claimId: boundClaim.claimId, claimDigest: boundClaim.claimDigest,
      claimLedgerRevision: boundClaim.claimLedgerRevision,
      transitionCounter: boundClaim.transitionCounter, canonicalBaseSha: MAIN,
      laneRevision: FENCE, writeSetDigest: plan.target.writeSetDigest,
      manifestDigest: plan.target.manifestDigest, leaseEpoch: 1,
      reviewRequestId: plan.sourceReviewRequestId, expiresAt: boundClaim.expiresAt,
      authorityDigest: digest("9") }, receiptDigest: continued.receipt.receiptDigest });
  const taskAuthority = { schema: "agentic-task-authority-binding/v1",
    authoritySubjectId: "urn:agentic-task:ecf23ead30c2e7eec477e154cdf127f2b6c623831c001952d0e1b280bb68e223",
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
    publicKey: "MCowBQYDK2VwAyEAJrlc5A3roTL0OYnt/jrI1728OCMSpWD/lq/aKfx+aJE=",
    publicKeyDigest: "aeb38ccccd3cf43765aebbae57f7c74614dd3f0c96e675afbe670c844d302cb2",
    laneBindingDigest: "38b8a14c8f96a31247e800bb30a68255c6ff4eb7cf73a752c456303f966c069a",
    bindingMode: "claim", boundAt: "2026-08-20T04:38:06.377Z", transitionPlanDigest: null,
    priorBindingDigest: null, bindingDigest: "d45a2d7bc19788768393c82100518b30cecf0829bd78e95856558faecedf767b" };
  const cloudAuthority = { claimId: boundClaim.claimId,
    claimDigest: boundClaim.claimDigest, claimLedgerRevision: boundClaim.claimLedgerRevision };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "source-session", device: "device", scope: "commerce", branch: BRANCH,
    baseSha: sha("b"), fenceSha: FENCE, worktreePath: fixture.repository,
    pullRequestUrl: "https://github.com/example/example/pull/809",
    heartbeatAt: "2026-08-30T00:00:00.000Z", expiresAt: continued.claim.expiresAt,
    cloudAuthority, taskAuthority };
  const localCore = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-local-receipt/v1",
    status: "local-cas", planDigest: plan.planDigest,
    sourceIntentDigest: plan.observation.sourceIntentDigest,
    sourceLeaseDigest: plan.observation.sourceLeaseDigest, sourceClaimId: plan.sourceClaimId,
    retiredStaleSuccessorClaimId: plan.retiredStaleSuccessorClaimId,
    replacementClaimId: continued.claim.claimId,
    replacementAuthorityDigest: digestValue(cloudAuthority),
    sourcePullRequestMarkerDigest: plan.observation.pullRequestMarkerDigest,
    leaseDigest: writerLeaseDigest(lease), taskAuthorityBindingDigest: taskAuthority.bindingDigest };
  const replacementIntentDigest = digestValue(localCore);
  const tombstone = { ...localCore, replacementIntentDigest,
    receiptDigest: digestValue({ ...localCore, replacementIntentDigest }) };
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 2,
    leases: { [BRANCH]: lease }, scopeExpansionSuccessorRolloverReceipts: { [BRANCH]: tombstone } };
  const leaseStore = { statePath: fixture.registryPath, read: () => lease,
    readRegistry: () => registry, withRegistryLock: action => action(registry) };
  const body = updateWriterLeasePullRequestBody("preserved", lease);
  const git = args => { if (args.join(" ") === "rev-parse --git-common-dir") return fixture.common;
    if (args.join(" ") === "branch --show-current") return BRANCH;
    if (args.join(" ") === "rev-parse HEAD") return FENCE;
    if (args[0] === "ls-remote") return `${FENCE}\trefs/heads/${BRANCH}`; return ""; };
  let live = continued;
  const adapter = createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({
    ...fixture.options, continuationPlan: { continuationDisposition: "bound-response-ahead",
      sourceJournalSnapshot: sourceJournal,
      continuationFrameSnapshot: { boundReplacement: evidence.boundReplacement } } }, {
    ...fixture.dependencies, leaseStore, git, normalizeContinuationPlan: value => value,
    readPullRequest: () => ({ url: lease.pullRequestUrl, number: 809, id: "PR_809",
      state: "OPEN", isDraft: true, isCrossRepository: false, headRefName: BRANCH,
      headRefOid: FENCE, baseRefName: "main", body }),
    cloudStatus: () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
      claims: [projectPublicClaim(live.claim)], sequence: live.ledger.sequence,
      ledgerRevision: sha("5"), ledgerDigest: live.ledger.headDigest }),
    readLedger: () => live.ledger });
  const context = { plan, journal, phase: "local-cas" };
  assert.equal((await adapter.reconcilePhase(context)).receiptDigest, tombstone.receiptDigest);
  live = bindRequest(continued, "post-local-cas-transition");
  await assert.rejects(adapter.reconcilePhase(context), /replacement claim ledger cardinality/u);
});

test("authorizeEffect revalidates and passes the configured capability without reading it in the adapter", t => {
  const fixture = repositoryFixture(t), capability = path.join(fixture.stateDirectory, "task.cap");
  writeFileSync(capability, "opaque-authority-bytes", { mode: 0o600 }); chmodSync(capability, 0o600);
  const dirtDigest = digestValue({ stagedPatch: "", unstagedPatch: "", changedPaths: [], untracked: [] });
  const snapshotCore = { sourceDirtyDigest: dirtDigest, sourceChangedPaths: [] };
  const planSnapshot = { ...snapshotCore, planDigest: digestValue(snapshotCore) };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1, sessionId: "source-session", device: "device",
    scope: "commerce", branch: BRANCH, baseSha: sha("b"), fenceSha: FENCE, worktreePath: fixture.repository,
    pullRequestUrl: "https://github.com/example/example/pull/809", heartbeatAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2099-08-30T00:00:00.000Z", taskAuthority: {
      schema: "agentic-task-authority-binding/v1",
      authoritySubjectId: "urn:agentic-task:ecf23ead30c2e7eec477e154cdf127f2b6c623831c001952d0e1b280bb68e223",
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
      publicKey: "MCowBQYDK2VwAyEAJrlc5A3roTL0OYnt/jrI1728OCMSpWD/lq/aKfx+aJE=",
      publicKeyDigest: "aeb38ccccd3cf43765aebbae57f7c74614dd3f0c96e675afbe670c844d302cb2",
      laneBindingDigest: "38b8a14c8f96a31247e800bb30a68255c6ff4eb7cf73a752c456303f966c069a",
      bindingMode: "claim", boundAt: "2026-08-20T04:38:06.377Z", transitionPlanDigest: null, priorBindingDigest: null,
      bindingDigest: "d45a2d7bc19788768393c82100518b30cecf0829bd78e95856558faecedf767b" } };
  const intent = { schema: "agentic-active-dirty-scope-expansion-intent/v1", status: "source-retired", branch: BRANCH,
    sourceLeaseDigest: digestValue(lease), sourceClaimId: C1, sourceFenceSha: FENCE, targetWriteSetDigest: digest("8"),
    targetManifestDigest: digest("9"), planDigest: planSnapshot.planDigest, targetClaimId: C2, targetClaimDigest: digest("6"),
    targetLeaseEpoch: 1, targetCanonicalBaseSha: sha("b"), sourceRetirementReceiptDigest: digest("5"), planSnapshot };
  const registry = { schema: "agentic-writer-lease-registry/v2", revision: 1, leases: { [BRANCH]: lease },
    scopeExpansionIntents: { [BRANCH]: intent } };
  const leaseStore = { statePath: fixture.registryPath, read: () => lease, readRegistry: () => registry,
    withRegistryLock: action => action(registry) };
  const body = updateWriterLeasePullRequestBody("preserved body", lease);
  let authorized = 0;
  const git = args => { const joined = args.join(" ");
    if (joined === "rev-parse --git-common-dir") return fixture.common;
    if (joined === "branch --show-current") return BRANCH;
    if (joined === "rev-parse HEAD") return FENCE;
    if (args[0] === "ls-remote") return `${FENCE}\trefs/heads/${BRANCH}`;
    return ""; };
  const adapter = createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter({ ...fixture.options, taskAuthorityFile: capability }, {
    ...fixture.dependencies, leaseStore, git,
    readPullRequest: () => ({ url: lease.pullRequestUrl, number: 809, id: "PR_809", state: "OPEN", isDraft: true,
      isCrossRepository: false, headRefName: BRANCH, headRefOid: FENCE, baseRefName: "main", body }),
    authorizeTaskAuthority: ({ capabilityPath }) => { authorized += 1; assert.equal(capabilityPath, capability);
      return { bindingDigest: lease.taskAuthority.bindingDigest, receiptDigest: digest("4") }; },
  });
  const plan = replacementPlan(), phase = "replacement-claimed", operationKey = successorRolloverOperationKey(plan, phase);
  const receipt = adapter.authorizeEffect({ plan, phase, operationKey });
  assert.equal(authorized, 1); assert.equal(receipt.bindingDigest, lease.taskAuthority.bindingDigest);
});

test("local raw owner values join the provider-pseudonymous C1 genesis identity", () => {
  const local = { repositoryId: "R_repo", deviceId: "device", sessionId: "source-session", workItemId: "commerce" };
  const cloud = { repositoryId: "github-repository:R_repo", deviceId: pseudonymousIdentifier("device", local.deviceId),
    sessionId: pseudonymousIdentifier("session", local.sessionId), workItemId: pseudonymousIdentifier("work-item", local.workItemId) };
  assert.equal(matchesSuccessorRolloverLocalSourceIdentity(cloud, local), true);
  assert.equal(matchesSuccessorRolloverLocalSourceIdentity({ ...cloud, deviceId: pseudonymousIdentifier("device", "foreign") }, local), false);
});

test("PR response-loss adoption recomputes its durable receipt digest", () => {
  const planDigest = digest("a"), replacementIntentDigest = digest("b"), markerDigest = digest("c"), bodyDigest = digest("d");
  const receiptDigest = digestValue({ schema: "agentic-active-dirty-scope-expansion-successor-rollover-pr-marker/v1",
    planDigest, markerDigest, bodyDigest, replacementIntentDigest });
  const receipt = { status: "pr-marker", replacementIntentDigest, prMarker: { markerDigest, bodyDigest, receiptDigest } };
  const input = { receipt, planDigest, pull: { markerDigest, bodyDigest }, leaseMarkerDigest: markerDigest };
  assert.deepEqual(validateSuccessorRolloverPullRequestReceipt(input), receipt.prMarker);
  assert.throws(() => validateSuccessorRolloverPullRequestReceipt({ ...input, receipt: { ...receipt,
    prMarker: { ...receipt.prMarker, receiptDigest: digest("e") } } }), /durable pull-request marker receipt/u);
  const pull = { url: "https://example.test/pull/809", nodeId: "PR_809", state: "OPEN", isDraft: true,
    headRefName: BRANCH, headRefOid: FENCE, baseRefName: "main" };
  const expected = { url: pull.url, nodeId: pull.nodeId, branch: BRANCH, headSha: FENCE };
  assert.equal(validateSuccessorRolloverPullRequestFence(pull, expected), pull);
  for (const drift of [{ state: "CLOSED" }, { isDraft: false }, { headRefOid: sha("9") }, { baseRefName: "release" },
    { url: "https://example.test/pull/other" }, { nodeId: "PR_other" }, { headRefName: "foreign" }]) {
    assert.throws(() => validateSuccessorRolloverPullRequestFence({ ...pull, ...drift }, expected), /exact open draft source pull request/u);
  }
});

test("successor candidate helpers preserve bound, owner, and stale identities", () => {
  const plan = replacementPlan();
  const candidate = { claimId: C3, state: "current", reviewRequestId: plan.sourceReviewRequestId };
  assert.equal(isSuccessorRolloverRawBoundCandidate(candidate, plan.sourceReviewRequestId), true);
  assert.equal(isSuccessorRolloverRawBoundCandidate({ ...candidate, state: "active" }, plan.sourceReviewRequestId), false);
  assert.equal(matchesSuccessorRolloverSourceClaimIdentity({ ...candidate, ...plan.sourceClaimIdentity }, plan.sourceClaimIdentity), true);
  for (const field of ["repositoryId", "actorId", "deviceId", "sessionId", "workItemId"]) assert.equal(
    matchesSuccessorRolloverSourceClaimIdentity({ ...plan.sourceClaimIdentity, [field]: `foreign-${field}` }, plan.sourceClaimIdentity), false);
  const stalePlan = { sourceClaimId: C1, targetWriteSetDigest: digestValue(STALE), targetDeclaredWriteSet: STALE };
  const stale = { state: "waiting-successor", predecessorClaimId: C1, fenceRevision: digest("7"), writeSetDigest: stalePlan.targetWriteSetDigest,
    declaredWriteScope: STALE, ...plan.sourceClaimIdentity };
  assert.equal(isSuccessorRolloverStaleCandidate(stale, stalePlan, stale.fenceRevision, plan.sourceClaimIdentity), true);
  assert.equal(isSuccessorRolloverStaleCandidate({ ...stale, deviceId: "foreign-device" }, stalePlan,
    stale.fenceRevision, plan.sourceClaimIdentity), false);
});

test("bound C3 response-loss reconciliation uses the canonical continuation receipt", () => {
  const actor = { actorId: "actor", deviceId: "device", sessionId: "session" };
  const repository = { repositoryId: "github-repository:1", canonicalRevision: MAIN };
  const evaluationTime = "2026-08-30T00:01:00.000Z";
  const claimed = applyCloudTransition({ ledger: createEmptyLedger("github-repository:ledger"),
    action: "claim", actor, repository, evaluationTime: "2026-08-30T00:00:00.000Z",
    request: { workItemId: "commerce", canonicalBaseRevision: MAIN,
      declaredWriteScope: CORRECTED, laneRevision: FENCE, leaseEpoch: 1,
      expiresAt: "2099-08-30T00:00:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: "claim:commerce" } });
  const continued = applyCloudTransition({ ledger: claimed.ledger, action: "continue",
    actor, repository, evaluationTime,
    request: { claimId: claimed.claim.claimId,
      expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: claimed.ledger.headDigest, mode: "projection",
      laneRevision: FENCE, reviewRequestId: "github-pull-request:PR_808",
      idempotencyKey: "continue:commerce" } });
  const entry = continued.ledger.entries.at(-1);
  const receipt = claimOnlyOperationReceiptForEntry(entry, "current");
  const current = listCurrentClaims(continued.ledger, evaluationTime,
    { repositoryId: repository.repositoryId })[0];
  assert.equal(receipt.schema, "agentic-collaboration-continuation-receipt/v1");
  assert.equal(receipt.operation, "continue");
  assert.equal(receipt.receiptDigest, current.operationReceiptDigest);
  const claimReceipt = claimOnlyOperationReceiptForEntry(claimed.ledger.entries.at(-1), "current");
  assert.equal(claimReceipt.schema, "agentic-collaboration-claim-receipt/v1");
  assert.equal(claimReceipt.receiptDigest, claimed.claim.operationReceiptDigest);
  const integrationReceipt = claimOnlyOperationReceiptForEntry({ ...entry, action: "integrate" }, "integrated-preserved");
  assert.equal(integrationReceipt.schema, "agentic-collaboration-integration-receipt/v1");
  assert.equal(integrationReceipt.operation, "integrate");
  const retirementEntry = { ...entry, action: "retire" };
  const retirementReceipt = claimOnlyOperationReceiptForEntry(retirementEntry, "retired");
  const retirementCore = { schema: "agentic-collaboration-retirement-receipt/v1",
    operation: "retire", status: "retired", repositoryId: retirementEntry.repositoryId,
    claimId: retirementEntry.claimId, claimDigest: retirementEntry.claimDigest,
    fenceRevision: retirementEntry.claimDigest, ledgerRevision: retirementEntry.digest,
    ledgerSequence: retirementEntry.sequence, idempotencyKey: retirementEntry.idempotencyKey,
    requestDigest: retirementEntry.requestDigest, evaluationTime: retirementEntry.evaluationTime };
  assert.equal(retirementReceipt.receiptDigest, digestValue(retirementCore));
  assert.throws(() => claimOnlyOperationReceiptForEntry({ ...entry, action: "unknown" }, "current"),
    /operation receipt action is invalid/u);
});

function replacementPlan() {
  const identityCore = { repositoryId: "github-repository:1", actorId: "actor", deviceId: "device", sessionId: "source-session", workItemId: "commerce" };
  const sourceClaimIdentity = { ...identityCore, identityDigest: digestValue(identityCore) };
  const observationCore = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement-observation/v2",
    sourceClaimIdentity, controllerDigest: digest("a"), protectedMainSha: MAIN, protectedMainTreeSha: sha("d"),
    protectedMainAdvanceDigest: digest("b"), protectedMainChangedPaths: ["device-branch-lib.mjs"], branch: BRANCH,
    sourceSessionId: "source-session", semanticScope: "commerce", sourceFenceSha: FENCE, sourceLeaseDigest: digest("c"), sourceClaimId: C1,
    sourceClaimDigest: digest("d"), sourceReviewRequestId: "github-pull-request:PR_809", sourceWriteSetDigest: digestValue(SOURCE),
    sourceManifestDigest: digest("e"), sourceDeclaredWriteSet: SOURCE, sourceDirtDigest: digest("f"), sourceChangedPaths: ["a.mjs"],
    sourceIntentDigest: digest("4"), sourceIntentPlanDigest: digest("5"), sourceIntentStatus: "source-retired",
    sourceRetirementReceiptDigest: digest("6"), staleSuccessorClaimId: C2, staleSuccessorClaimDigest: digest("7"),
    staleSuccessorTransitionDigest: digest("8"), staleSuccessorTransitionCounter: 1, staleSuccessorState: "waiting-successor",
    staleSuccessorPredecessorClaimId: C1, staleTargetCanonicalBaseSha: sha("b"), staleTargetWriteSetDigest: digestValue(STALE),
    staleTargetManifestDigest: digest("9"), staleTargetDeclaredWriteSet: STALE, staleExpiresAt: "2099-08-30T00:00:00.000Z",
    pullRequestNumber: 809, pullRequestNodeId: "PR_809", pullRequestMarkerDigest: digest("a"), pullRequestBodyDigest: digest("b") };
  const retirementObservation = { ...observationCore, observationDigest: digestValue(observationCore) };
  const retirementPlan = buildSuccessorRolloverRetirementPlan({ observation: retirementObservation, operatorSessionId: "operator" });
  let journal = createSuccessorRolloverJournal(retirementPlan, retirementPlan.exactAuthorization);
  const retirement = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1", staleSuccessorClaimId: C2,
    priorClaimDigest: retirementObservation.staleSuccessorClaimDigest, retiredClaimDigest: digest("d"), retirementTransitionDigest: digest("e"),
    transitionCounter: 2, state: "retired", reason: "successor-rollover", receiptDigest: digest("f"),
  };
  journal = advanceSuccessorRolloverRetirement(journal, retirement);
  const replacementCore = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-replacement-observation/v2",
    sourceClaimIdentity, controllerDigest: digest("1"), protectedMainSha: MAIN, protectedMainTreeSha: sha("1"),
    protectedMainAdvanceDigest: digest("1"), protectedMainChangedPaths: ["device-branch-lib.mjs"], branch: BRANCH,
    sourceLeaseDigest: observationCore.sourceLeaseDigest, sourceDirtDigest: observationCore.sourceDirtDigest,
    sourceIntentDigest: observationCore.sourceIntentDigest, pullRequestMarkerDigest: observationCore.pullRequestMarkerDigest,
    pullRequestBodyDigest: observationCore.pullRequestBodyDigest, staleSuccessorClaimId: C2, staleRetirementClaimDigest: retirement.retiredClaimDigest,
    staleRetirementTransitionDigest: retirement.retirementTransitionDigest, staleRetirementTransitionCounter: 2,
    staleRetirementReceiptDigest: retirement.receiptDigest };
  const observation = { ...replacementCore, observationDigest: digestValue(replacementCore) };
  const target = { schema: "agentic-declared-write-scope/v1", semanticScope: "commerce", declaredWriteSet: CORRECTED,
    writeSetDigest: digestValue(CORRECTED), manifestDigest: digest("3") };
  return buildSuccessorRolloverReplacementPlan({ observation, targetManifest: target, operatorSessionId: "operator", retirementJournal: journal });
}
