import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync, realpathSync, statSync, lstatSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildOpenReviewedLaneRehydrationPlan, createOpenReviewedLaneRehydrationIntent,
  normalizeOpenReviewedLaneRehydrationIntent } from "../scripts/open-reviewed-lane-rehydration-contract.mjs";
import { createOpenReviewedLaneRehydrationController } from "../scripts/open-reviewed-lane-rehydration-controller.mjs";
import { createRepositoryOpenReviewedLaneRehydrationAdapter } from "../scripts/open-reviewed-lane-rehydration-repository-adapter.mjs";
import { updateWriterLeasePullRequestBody, WRITER_LEASE_REGISTRY_SCHEMA,
  WRITER_LEASE_SCHEMA, createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const writes = ["path:docs/START-WORKFLOW.md", "semantic:active-owned-dirt-recovery"];

function evidence() {
  const writeSetDigest = digestValue(writes);
  const workItemId = `work-item:${digest("c")}`;
  const claimId = digestValue({ actorId: "github-user:7", canonicalBaseRevision: sha("1"),
    leaseEpoch: 3, repositoryId: "github-repository:R_repo", workItemId, writeSetDigest });
  const marker = {
    status: "review_ready", epoch: 211, sessionId: "owner-session", device: "owner-device",
    scope: "active-owned-dirt-recovery", branch: "agent/owner-device/active-owned-dirt-recovery",
    baseSha: sha("1"), fenceSha: sha("2"), reviewHeadSha: sha("3"),
    expiresAt: "2026-08-10T05:25:20.000Z",
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "active-owned-dirt-recovery", declaredWriteSet: writes, writeSetDigest,
      manifestDigest: digest("4"), planReceiptDigest: digest("a"), admissionReceiptDigest: digest("b"),
      existingLaneStateDigest: digest("c"), admittedReportDigest: digest("5"),
      preservationReceiptDigest: digest("d") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "coordination/ledger", targetRepository: "owner/repo", claimId,
      claimDigest: digest("7"), ledgerRevision: sha("8"), ledgerDigest: digest("8"),
      claimLedgerRevision: digest("9"), entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest: digest("a"),
      canonicalBaseSha: sha("1"), laneRevision: sha("3"), cloudDeclaredWriteScope: writes,
      writeSetDigest, deviceId: "owner-device", sessionId: "owner-session",
      reviewRequestId: "github-pull-request:PR_node", leaseEpoch: 3, transitionCounter: 3,
      state: "review_ready", expiresAt: "2026-08-10T05:25:20.000Z",
      integrationReceiptDigest: null, integration: null, focusedEvidenceDigest: digest("b"),
      manifestDigest: digest("4") },
  };
  marker.markerDigest = digestValue({ ...marker });
  const claim = {
    claimId, entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "dormant-preserved",
    writeAuthority: false, scopeReserved: true, actorId: "github-user:7",
    repositoryId: "github-repository:R_repo", workItemId,
    canonicalBaseRevision: sha("1"), laneRevision: sha("3"), declaredWriteScope: writes,
    writeSetDigest, leaseEpoch: 3, transitionCounter: 4, heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_node", predecessorClaimId: digest("d"),
    expiresAt: "2026-08-10T05:25:20.000Z", fenceRevision: digest("e"),
    transitionDigest: digest("f"), operationReceiptDigest: digest("1"),
    integrationReceiptDigest: digest("1"), integration: {
      candidateRevision: sha("3"), reviewRequestId: "github-pull-request:PR_node",
      focusedEvidenceDigest: digest("b"), dependencyClosureDigest: digest("2"),
      namedChecksDigest: digest("3"), handoffEvidenceDigest: digest("4"),
      operatorDecisionDigest: digest("5"), integrationIntentDigest: digest("6"),
      integratedAt: "2026-08-10T05:20:20.000Z",
    },
  };
  return {
    repository: { nameWithOwner: "owner/repo", nodeId: "R_repo", claimRepositoryId: "github-repository:R_repo" },
    actor: { id: "7", login: "owner", claimActorId: "github-user:7" },
    canonical: { repoRoot: "/workspace/repo", gitCommonDir: "/workspace/repo/.git",
      headSha: sha("a"), currentMainSha: sha("a"), currentMainTreeSha: sha("b"),
      registrationDigest: digest("1"), leaseProjectionDigest: digest("7"), clean: true },
    target: { path: "/workspace/.worktrees/repo/active-owned-dirt-recovery",
      managedRoot: "/workspace/.worktrees/repo", sharedRoot: "/workspace/.worktrees",
      observationDigest: digest("2") },
    branch: marker.branch, remoteHeadSha: sha("3"),
    pullRequest: { number: 344, nodeId: "PR_node", url: "https://github.test/owner/repo/pull/344",
      state: "OPEN", isDraft: false, headBranch: marker.branch, headSha: sha("3"), baseBranch: "main",
      baseSha: sha("9"), headRepository: "owner/repo", baseRepository: "owner/repo",
      authorLogin: "owner", reviewRequestId: "github-pull-request:PR_node", autoMergeRequest: null,
      mergeQueueEntry: null,
      bodyDigest: digest("3"), markerDigest: marker.markerDigest },
    marker, claim, refresh: null,
    localProjection: { mode: "all-absent", branch: null, lease: null, worktreeAbsent: true },
  };
}

function fakeAdapter({ loseLeaseResponse = false, failWorktree = false } = {}) {
  const state = { journal: null, branch: false, worktree: false, lease: false,
    rollback: 0, providerMutations: 0, loseLeaseResponse };
  const adapter = {
    readPlanEvidence: () => evidence(),
    withOperationLock: (_input, action) => action(),
    readIntent: () => state.journal,
    writeIntent({ expected, value }) {
      assert.deepEqual(state.journal, expected);
      if (value.status === "lease-recovered" && state.loseLeaseResponse) {
        state.loseLeaseResponse = false;
        throw new Error("lost journal response");
      }
      state.journal = value;
    },
    withRegistryLock: action => action(),
    revalidate({ plan }) { assert.equal(plan.evidence.evidenceDigest, buildOpenReviewedLaneRehydrationPlan(evidence()).evidence.evidenceDigest); },
    reconcile({ phase }) {
      const item = evidence();
      if (phase === "branch-created" && state.branch) return { branch: item.branch,
        headSha: item.remoteHeadSha, refDigest: digestValue({ branch: item.branch, head: item.remoteHeadSha }), disposition: "created" };
      if (phase === "worktree-created" && state.worktree) return { targetPath: item.target.path,
        headSha: item.remoteHeadSha, registrationDigest: digest("9"), disposition: "created" };
      if (phase === "lease-recovered" && state.lease) return { disposition: "created", leaseDigest: digest("a"),
        epoch: item.marker.epoch, sessionId: item.marker.sessionId,
        leaseCasReceiptDigest: digest("b"),
        leaseRegistryBeforeRevision: 8, leaseRegistryBeforeDigest: digest("7"),
        leaseRegistryAfterRevision: 9, leaseRegistryAfterDigest: digest("0") };
      return null;
    },
    createBranch: () => { state.branch = true; },
    createWorktree: () => { if (failWorktree) throw new Error("worktree failed"); state.worktree = true; },
    recoverLease: () => { state.lease = true; },
    verify: () => ({ leaseDigest: digest("a"), registrationDigest: digest("9") }),
    rollback: () => { state.rollback += 1; state.worktree = false; state.branch = false; },
  };
  return { adapter, state };
}

function repositoryFixture({ preexistingProjection = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "open-reviewed-rehydration-")));
  const repository = path.join(root, "repo"), remote = path.join(root, "remote.git");
  runGit(root, ["init", "--bare", remote]);
  runGit(root, ["init", repository]);
  runGit(repository, ["config", "user.name", "Rehydration Test"]);
  runGit(repository, ["config", "user.email", "rehydration@example.test"]);
  writeFileSync(path.join(repository, "README.md"), "main\n");
  runGit(repository, ["add", "README.md"]); runGit(repository, ["commit", "-m", "main"]);
  runGit(repository, ["branch", "-M", "main"]); runGit(repository, ["remote", "add", "origin", remote]);
  runGit(repository, ["push", "-u", "origin", "main"]);
  const mainSha = runGit(repository, ["rev-parse", "HEAD"]);
  const branch = "agent/test-device.local/reviewed-recovery";
  runGit(repository, ["switch", "-c", branch]);
  writeFileSync(path.join(repository, "reviewed.txt"), "reviewed\n");
  runGit(repository, ["add", "reviewed.txt"]); runGit(repository, ["commit", "-m", "reviewed"]);
  const headSha = runGit(repository, ["rev-parse", "HEAD"]);
  runGit(repository, ["push", "origin", branch]); runGit(repository, ["switch", "main"]);
  runGit(repository, ["branch", "-D", branch]);
  const targetPath = path.join(root, ".worktrees", "repo", "reviewed-recovery");
  const subject = providerFixtureSubject({ mainSha, headSha, branch });
  if (preexistingProjection) {
    runGit(repository, ["branch", branch, headSha]);
    const lease = { ...subject.marker, worktreePath: targetPath, pullRequestUrl: subject.pull.url };
    writeRegistry(repository, { schema: WRITER_LEASE_REGISTRY_SCHEMA, revision: 1,
      leases: { [branch]: lease } });
  }
  const ghCalls = [], cloudCalls = [];
  const dependencies = {
    gh(args) {
      ghCalls.push([...args]);
      if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "owner/repo", id: "R_repo" });
      return JSON.stringify({ data: { repository: { id: "R_repo", nameWithOwner: "owner/repo",
        pullRequest: subject.pull }, viewer: { login: "owner", databaseId: 7 } } });
    },
    cloud(input) { cloudCalls.push(input); return { schema: "agentic-cloud-collaboration-result/v1",
      ok: true, action: "status", claims: [subject.claim] }; },
  };
  return { root, repository, remote, branch, mainSha, headSha, targetPath, subject,
    ghCalls, cloudCalls, dependencies,
    createAdapter: (overrides = {}) => createRepositoryOpenReviewedLaneRehydrationAdapter({ repository,
      targetPath, pullRequestNumber: 344 }, { ...dependencies, ...overrides }),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function providerFixtureSubject({ mainSha, headSha, branch }) {
  const base = evidence(), workItemId = base.claim.workItemId;
  const fixtureWrites = [...base.claim.declaredWriteScope.filter(item => !item.startsWith("semantic:")),
    "semantic:reviewed-recovery"].sort();
  const writeSetDigest = digestValue(fixtureWrites);
  const claimId = digestValue({ actorId: "github-user:7", canonicalBaseRevision: mainSha,
    leaseEpoch: 3, repositoryId: "github-repository:R_repo", workItemId,
    writeSetDigest });
  const authority = { ...base.marker.cloudAuthority, claimId, claimDigest: digest("a"),
    canonicalBaseSha: mainSha, laneRevision: headSha, expiresAt: base.claim.expiresAt,
    cloudDeclaredWriteScope: fixtureWrites, writeSetDigest };
  const marker = { schema: WRITER_LEASE_SCHEMA, status: "review_ready", epoch: base.marker.epoch,
    sessionId: base.marker.sessionId, device: "test-device.local", scope: "reviewed-recovery",
    branch, baseSha: mainSha, fenceSha: headSha, reviewHeadSha: headSha,
    autoDelivery: false, runtimeRequired: false, heartbeatAt: "2026-08-10T05:00:00.000Z",
    expiresAt: base.claim.expiresAt, admission: { ...base.marker.admission,
      semanticScope: "reviewed-recovery", declaredWriteSet: fixtureWrites, writeSetDigest }, cloudAuthority: { ...authority,
      deviceId: "test-device.local", sessionId: base.marker.sessionId } };
  const body = updateWriterLeasePullRequestBody("Reviewed lane", marker);
  const claim = { ...base.claim, claimId, canonicalBaseRevision: mainSha, laneRevision: headSha,
    declaredWriteScope: fixtureWrites, writeSetDigest,
    integration: { ...base.claim.integration, candidateRevision: headSha } };
  const pull = { id: "PR_node", url: "https://github.test/owner/repo/pull/344", number: 344,
    state: "OPEN", isDraft: false, body, headRefName: branch, headRefOid: headSha,
    baseRefName: "main", baseRefOid: mainSha, author: { login: "owner" },
    headRepository: { nameWithOwner: "owner/repo" }, baseRepository: { nameWithOwner: "owner/repo" },
    mergeQueueEntry: null, autoMergeRequest: null };
  return { marker, claim, pull };
}

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeRegistry(repository, value) {
  const file = path.join(repository, ".git", "agentic-canvas-os", "writer-leases.json");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); chmodSync(file, 0o600);
  return file;
}

function peerLease(root, suffix = "one") {
  return { schema: WRITER_LEASE_SCHEMA, status: "active", branch: `agent/peer.local/${suffix}`,
    worktreePath: path.join(root, "peer", suffix), sessionId: `peer-${suffix}` };
}
test("plan is read-only and binds exact authorization", () => {
  const { adapter, state } = fakeAdapter();
  const plan = createOpenReviewedLaneRehydrationController({ adapter }).plan();
  assert.match(plan.exactAuthorization, new RegExp(`${plan.planDigest}$`, "u"));
  assert.equal(state.journal, null);
  assert.deepEqual([state.branch, state.worktree, state.lease, state.providerMutations], [false, false, false, 0]);
});
test("public claim rejects producer-inexpressible fields", () => {
  const input = evidence();
  input.claim.recordedState = "integrated-preserved";
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(input), /public claim/u);
});
test("integrated dormant claim identity and operation receipt are independently recomputed", () => {
  const wrongIdentity = evidence(); wrongIdentity.claim.claimId = digest("9");
  wrongIdentity.marker.cloudAuthority.claimId = wrongIdentity.claim.claimId;
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(wrongIdentity), /joined subject/u);
  const wrongReceipt = evidence(); wrongReceipt.claim.integrationReceiptDigest = digest("8");
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(wrongReceipt), /joined subject/u);
});
test("plan requires no auto-merge request and no merge-queue entry", () => {
  for (const key of ["autoMergeRequest", "mergeQueueEntry"]) {
    const input = evidence(); input.pullRequest[key] = { id: "armed" };
    assert.throws(() => buildOpenReviewedLaneRehydrationPlan(input), /pull request state/u);
  }
});
test("marker branch identity and expiry join its device, scope, and cloud authority", () => {
  const wrongDevice = evidence(); wrongDevice.marker.device = "different-device";
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(wrongDevice), /joined subject/u);
  const wrongExpiry = evidence(); wrongExpiry.marker.expiresAt = "2026-08-10T05:25:21.000Z";
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(wrongExpiry), /joined subject/u);
  const wrongTarget = evidence(); wrongTarget.marker.cloudAuthority.targetRepository = "other/repo";
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(wrongTarget), /joined subject/u);
  const malformedLedger = evidence(); malformedLedger.marker.cloudAuthority.ledgerRepository = "not-a-repository";
  assert.throws(() => buildOpenReviewedLaneRehydrationPlan(malformedLedger), /ledger repository/u);
});
test("run creates only local projections and returns a typed receipt", () => {
  const { adapter, state } = fakeAdapter();
  const controller = createOpenReviewedLaneRehydrationController({ adapter });
  const plan = controller.plan(), receipt = controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "rehydrated");
  assert.deepEqual([state.branch, state.worktree, state.lease, state.providerMutations], [true, true, true, 0]);
  assert.equal(state.journal.status, "complete");
});
test("lost response after lease insertion is adopted on replay without rollback", () => {
  const { adapter, state } = fakeAdapter({ loseLeaseResponse: true });
  const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
  assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /lost journal response/u);
  assert.equal(state.lease, true); assert.equal(state.rollback, 0);
  const receipt = controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "rehydrated"); assert.equal(state.rollback, 0);
});
test("pre-lease failure rolls back only exact created local state", () => {
  const { adapter, state } = fakeAdapter({ failWorktree: true });
  const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
  assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /worktree failed/u);
  assert.deepEqual([state.branch, state.worktree, state.lease, state.rollback], [false, false, false, 1]);
});
test("intent operation identity is stable", () => {
  const plan = buildOpenReviewedLaneRehydrationPlan(evidence());
  assert.equal(createOpenReviewedLaneRehydrationIntent(plan).operationId,
    createOpenReviewedLaneRehydrationIntent(plan).operationId);
});
test("recomputed journal phase and receipt tampering cannot detach from the plan", () => {
  const { adapter, state } = fakeAdapter();
  const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
  controller.run({ plan, authorization: plan.exactAuthorization });
  const tampered = JSON.parse(JSON.stringify(state.journal));
  tampered.phases["branch-created"].branch = "agent/other-device/other-scope";
  tampered.phases["branch-created"].refDigest = digestValue({ branch: tampered.phases["branch-created"].branch,
    head: tampered.phases["branch-created"].headSha });
  tampered.receipt.phases = tampered.phases;
  const { receiptDigest: _discarded, ...receiptCore } = tampered.receipt;
  tampered.receipt.receiptDigest = digestValue(receiptCore);
  assert.throws(() => normalizeOpenReviewedLaneRehydrationIntent(tampered), /phase plan join/u);
});
test("repository adapter preserves a disjoint peer update while creating only local projections", () => {
  const fixture = repositoryFixture();
  try {
    const adapter = fixture.createAdapter();
    const controller = createOpenReviewedLaneRehydrationController({ adapter });
    const remoteBefore = runGit(fixture.repository, ["ls-remote", "origin"]);
    const plan = controller.plan();
    const peer = peerLease(fixture.root);
    writeRegistry(fixture.repository, { schema: WRITER_LEASE_REGISTRY_SCHEMA, revision: 1,
      leases: { [peer.branch]: peer } });
    const receipt = controller.run({ plan, authorization: plan.exactAuthorization });
    const registry = JSON.parse(readFileSync(path.join(fixture.repository, ".git", "agentic-canvas-os",
      "writer-leases.json"), "utf8"));
    assert.equal(receipt.status, "rehydrated");
    assert.deepEqual(receipt.mutationSet, ["local-branch", "registered-worktree", "writer-lease-projection"]);
    assert.deepEqual(registry.leases[peer.branch], peer);
    assert.equal(registry.leases[fixture.branch].worktreePath, fixture.targetPath);
    const operationId = createOpenReviewedLaneRehydrationIntent(plan).operationId;
    const journalRoot = path.join(fixture.repository, ".git", "agentic-canvas-os", "open-reviewed-lane-rehydration");
    assert.equal(statSync(path.join(journalRoot, `${operationId}.json`)).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(journalRoot, `${operationId}.lease-cas.json`)).mode & 0o777, 0o600);
    assert.equal(runGit(fixture.repository, ["ls-remote", "origin"]), remoteBefore);
    assert.ok(fixture.cloudCalls.every(call => call.action === "status"
      && call.ledgerRepository === "coordination/ledger" && call.request.targetRepository === "owner/repo"));
    assert.ok(fixture.ghCalls.every(args => args[0] === "repo" || args[0] === "api"));
  } finally { fixture.cleanup(); }
});
test("repository adapter adopts exact branch and lease while creating only the missing worktree", () => {
  const fixture = repositoryFixture({ preexistingProjection: true });
  try {
    const registryFile = path.join(fixture.repository, ".git", "agentic-canvas-os", "writer-leases.json");
    const registryBefore = readFileSync(registryFile, "utf8");
    const controller = createOpenReviewedLaneRehydrationController({ adapter: fixture.createAdapter() }); const plan = controller.plan();
    assert.equal(plan.evidence.localProjection.mode, "worktree-only");
    const receipt = controller.run({ plan, authorization: plan.exactAuthorization });
    assert.deepEqual(receipt.mutationSet, ["registered-worktree"]);
    assert.deepEqual([receipt.phases["branch-created"].disposition,
      receipt.phases["lease-recovered"].disposition], ["adopted", "adopted"]);
    assert.equal(readFileSync(registryFile, "utf8"), registryBefore);
    assert.equal(runGit(fixture.targetPath, ["rev-parse", "HEAD"]), fixture.headSha);
  } finally { fixture.cleanup(); }
});
test("partial projection rejects a branch lease that differs from the reviewed marker", () => {
  const fixture = repositoryFixture({ preexistingProjection: true });
  try {
    const registryFile = path.join(fixture.repository, ".git", "agentic-canvas-os", "writer-leases.json");
    const registry = JSON.parse(readFileSync(registryFile, "utf8"));
    registry.leases[fixture.branch].sessionId = "different-session"; writeRegistry(fixture.repository, registry);
    const controller = createOpenReviewedLaneRehydrationController({ adapter: fixture.createAdapter() });
    assert.throws(() => controller.plan(), /writer lease collision/u);
  } finally { fixture.cleanup(); }
});
test("lease CAS response loss replays after an unrelated peer registry update", () => {
  const fixture = repositoryFixture();
  try {
    const base = fixture.createAdapter(); let losePhaseWrite = true;
    const adapter = { ...base, writeIntent(input) {
      if (input.value.status === "lease-recovered" && losePhaseWrite) {
        losePhaseWrite = false; throw new Error("lost lease phase response");
      }
      return base.writeIntent(input);
    } };
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /lost lease phase response/u);
    const registryFile = path.join(fixture.repository, ".git", "agentic-canvas-os", "writer-leases.json");
    const current = JSON.parse(readFileSync(registryFile, "utf8")), peer = peerLease(fixture.root, "after");
    writeRegistry(fixture.repository, { ...current, revision: current.revision + 1,
      leases: { ...current.leases, [peer.branch]: peer } });
    const receipt = controller.run({ plan, authorization: plan.exactAuthorization });
    const finalRegistry = JSON.parse(readFileSync(registryFile, "utf8"));
    assert.equal(receipt.status, "rehydrated");
    assert.deepEqual(finalRegistry.leases[peer.branch], peer);
    assert.equal(receipt.phases["lease-recovered"].leaseRegistryAfterRevision, 1);
  } finally { fixture.cleanup(); }
});
test("a disjoint Git worktree added after lease insertion does not strand verification or completed replay", () => {
  const fixture = repositoryFixture();
  try {
    const base = fixture.createAdapter();
    const peerPath = path.join(fixture.root, "peer-after-lease"), peerBranch = "peer-after-lease";
    let peerAdded = false;
    const adapter = { ...base, verify(input) {
      if (!peerAdded) {
        runGit(fixture.repository, ["worktree", "add", "-b", peerBranch, peerPath, fixture.mainSha]);
        peerAdded = true;
      }
      return base.verify(input);
    } };
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    const receipt = controller.run({ plan, authorization: plan.exactAuthorization });
    const replayed = controller.run({ plan, authorization: plan.exactAuthorization });
    assert.equal(receipt.status, "rehydrated");
    assert.equal(replayed.receiptDigest, receipt.receiptDigest);
    assert.match(runGit(fixture.repository, ["worktree", "list", "--porcelain"]),
      new RegExp(peerPath.replaceAll("/", "\\/"), "u"));
  } finally { fixture.cleanup(); }
});
test("writer registry symlinks block planning and final CAS without branch, worktree, or lease effects", () => {
  const fixture = repositoryFixture();
  try {
    const controller = createOpenReviewedLaneRehydrationController({ adapter: fixture.createAdapter() });
    const registryDir = path.join(fixture.repository, ".git", "agentic-canvas-os");
    const registryFile = path.join(registryDir, "writer-leases.json");
    const outside = path.join(fixture.root, "outside-writer-leases.json");
    const outsideValue = `${JSON.stringify({ schema: WRITER_LEASE_REGISTRY_SCHEMA, revision: 0, leases: {} })}\n`;
    mkdirSync(registryDir, { recursive: true, mode: 0o700 });
    writeFileSync(outside, outsideValue, { mode: 0o600 });
    symlinkSync(outside, registryFile);
    assert.throws(() => controller.plan(), /writer registry file/u);
    assert.equal(readFileSync(outside, "utf8"), outsideValue);
    unlinkSync(registryFile);
    const plan = controller.plan();
    symlinkSync(outside, registryFile);
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /writer registry file/u);
    assert.equal(lstatSync(registryFile).isSymbolicLink(), true);
    assert.equal(readFileSync(outside, "utf8"), outsideValue);
    assert.equal(existsSync(fixture.targetPath), false);
    assert.throws(() => runGit(fixture.repository, ["show-ref", "--verify", `refs/heads/${fixture.branch}`]));
  } finally { fixture.cleanup(); }
});
test("repository plan rejects target and local branch collisions without mutation", () => {
  const fixture = repositoryFixture();
  try {
    const controller = createOpenReviewedLaneRehydrationController({ adapter: fixture.createAdapter() });
    fixture.subject.marker.fenceSha = sha("f");
    fixture.subject.pull.body = updateWriterLeasePullRequestBody("Reviewed lane", fixture.subject.marker);
    assert.throws(() => controller.plan(), /git merge-base/u);
    fixture.subject.marker.fenceSha = fixture.headSha;
    fixture.subject.pull.body = updateWriterLeasePullRequestBody("Reviewed lane", fixture.subject.marker);
    mkdirSync(path.dirname(fixture.targetPath), { recursive: true });
    symlinkSync(fixture.repository, fixture.targetPath);
    assert.throws(() => controller.plan(), /target ancestor/u);
    unlinkSync(fixture.targetPath); mkdirSync(fixture.targetPath);
    assert.throws(() => controller.plan(), /target collision/u);
    writeFileSync(path.join(fixture.targetPath, "residue"), "retain\n");
    assert.throws(() => controller.plan(), /target collision/u);
    rmSync(fixture.targetPath, { recursive: true });
    runGit(fixture.repository, ["update-ref", `refs/heads/${fixture.branch}`, fixture.headSha]);
    assert.throws(() => controller.plan(), /local branch collision/u);
    assert.equal(fixture.cloudCalls.filter(call => call.action !== "status").length, 0);
  } finally { fixture.cleanup(); }
});
test("pre-lease adapter failure rolls back only its exact ref and worktree under the registry lock", () => {
  const fixture = repositoryFixture();
  try {
    const base = fixture.createAdapter();
    const adapter = { ...base, recoverLease() { throw new Error("injected pre-lease stop"); } };
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /injected pre-lease stop/u);
    assert.equal(existsSync(fixture.targetPath), false);
    assert.throws(() => runGit(fixture.repository, ["show-ref", "--verify", `refs/heads/${fixture.branch}`]));
    const journal = JSON.parse(readFileSync(path.join(fixture.repository, ".git", "agentic-canvas-os",
      "open-reviewed-lane-rehydration", `${createOpenReviewedLaneRehydrationIntent(plan).operationId}.json`), "utf8"));
    assert.equal(journal.status, "prepared"); assert.deepEqual(journal.attempts, []);
  } finally { fixture.cleanup(); }
});
test("an exact branch won by a concurrent Git command is not adopted or deleted", () => {
  const fixture = repositoryFixture();
  try {
    const base = fixture.createAdapter();
    const adapter = { ...base, createBranch(input) {
      runGit(fixture.repository, ["update-ref", `refs/heads/${fixture.branch}`, fixture.headSha]);
      return base.createBranch(input);
    } };
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }),
      /unattributed rollback branch retained/u);
    assert.equal(runGit(fixture.repository, ["show-ref", "--hash", "--verify", `refs/heads/${fixture.branch}`]),
      fixture.headSha);
    assert.equal(existsSync(fixture.targetPath), false);
  } finally { fixture.cleanup(); }
});
test("an exact worktree won by a concurrent Git command is not adopted or removed", () => {
  const fixture = repositoryFixture();
  try {
    const base = fixture.createAdapter();
    const adapter = { ...base, createWorktree(input) {
      mkdirSync(path.dirname(fixture.targetPath), { recursive: true, mode: 0o700 });
      runGit(fixture.repository, ["worktree", "add", "--", fixture.targetPath, fixture.branch]);
      return base.createWorktree(input);
    } };
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }),
      /unattributed rollback target retained/u);
    assert.equal(runGit(fixture.targetPath, ["rev-parse", "HEAD"]), fixture.headSha);
    assert.equal(runGit(fixture.repository, ["show-ref", "--hash", "--verify", `refs/heads/${fixture.branch}`]),
      fixture.headSha);
  } finally { fixture.cleanup(); }
});
test("a prepared lease sidecar never adopts an exact lease after registry response loss and peer advance", () => {
  const fixture = repositoryFixture();
  try {
    const registryFile = path.join(fixture.repository, ".git", "agentic-canvas-os", "writer-leases.json");
    let registryWrites = 0;
    const adapter = fixture.createAdapter({ registryWriter(value) {
      registryWrites += 1;
      writeRegistry(fixture.repository, value);
      throw new Error("lost registry provenance");
    } });
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    const operationId = createOpenReviewedLaneRehydrationIntent(plan).operationId;
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /lost registry provenance/u);
    const sidecarFile = path.join(fixture.repository, ".git", "agentic-canvas-os",
      "open-reviewed-lane-rehydration", `${operationId}.lease-cas.json`);
    assert.equal(JSON.parse(readFileSync(sidecarFile, "utf8")).status, "prepared");
    const current = JSON.parse(readFileSync(registryFile, "utf8")), peer = peerLease(fixture.root, "intervening");
    assert.ok(current.leases[fixture.branch]);
    writeRegistry(fixture.repository, { ...current, revision: current.revision + 1,
      leases: { ...current.leases, [peer.branch]: peer } });
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }),
      /committed lease CAS receipt/u);
    const finalRegistry = JSON.parse(readFileSync(registryFile, "utf8"));
    assert.equal(registryWrites, 1);
    assert.deepEqual(finalRegistry.leases[peer.branch], peer);
    assert.ok(finalRegistry.leases[fixture.branch]);
    assert.equal(JSON.parse(readFileSync(sidecarFile, "utf8")).status, "prepared");
  } finally { fixture.cleanup(); }
});
test("a non-absence ref read failure retains the attributed ref and does not reset rollback intent", () => {
  const fixture = repositoryFixture();
  try {
    let rejectRefRead = false;
    const base = fixture.createAdapter({ git(args) {
      if (rejectRefRead && args[0] === "show-ref" && args.includes("--quiet")) {
        throw Object.assign(new Error("injected ref read failure"), { status: 128 });
      }
      return runGit(fixture.repository, args);
    } });
    const adapter = { ...base,
      recoverLease() { throw new Error("injected pre-lease stop"); },
      rollback(input) {
        rejectRefRead = true;
        try { return base.rollback(input); } finally { rejectRefRead = false; }
      } };
    const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }),
      /exact local rollback failed closed: injected ref read failure/u);
    assert.equal(existsSync(fixture.targetPath), false);
    assert.equal(runGit(fixture.repository, ["show-ref", "--hash", "--verify", `refs/heads/${fixture.branch}`]),
      fixture.headSha);
    const journal = JSON.parse(readFileSync(path.join(fixture.repository, ".git", "agentic-canvas-os",
      "open-reviewed-lane-rehydration", `${createOpenReviewedLaneRehydrationIntent(plan).operationId}.json`), "utf8"));
    assert.equal(journal.status, "worktree-created");
    assert.ok(journal.attempts.some(item => item.phase === "lease-recovered"));
  } finally { fixture.cleanup(); }
});
test("substrate removal at the final registry-lock boundary prevents lease insertion", () => {
  const fixture = repositoryFixture();
  try {
    const store = createWriterLeaseStore({ gitCommonDir: path.join(fixture.repository, ".git") });
    let lockCount = 0;
    const leaseStore = { ...store, withRegistryLock(action) {
      return store.withRegistryLock(registry => {
        lockCount += 1;
        if (lockCount === 2) runGit(fixture.repository, ["worktree", "remove", "--", fixture.targetPath]);
        return action(registry);
      });
    } };
    const controller = createOpenReviewedLaneRehydrationController({
      adapter: fixture.createAdapter({ leaseStore }),
    });
    const plan = controller.plan();
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /registered worktree/u);
    assert.equal(store.read(fixture.branch), null);
    assert.throws(() => runGit(fixture.repository, ["show-ref", "--verify", `refs/heads/${fixture.branch}`]));
  } finally { fixture.cleanup(); }
});
test("existing operation lock is never auto-taken-over or unlinked", () => {
  const fixture = repositoryFixture();
  try {
    const controller = createOpenReviewedLaneRehydrationController({ adapter: fixture.createAdapter() });
    const plan = controller.plan(), operationId = createOpenReviewedLaneRehydrationIntent(plan).operationId;
    const lock = path.join(fixture.repository, ".git", "agentic-canvas-os", "open-reviewed-lane-rehydration",
      `${operationId}.lock`);
    mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
    const owner = { pid: 999_999_999, token: "abandoned-owner" };
    writeFileSync(lock, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
    assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /explicit evidence-bound owner recovery/u);
    assert.deepEqual(JSON.parse(readFileSync(lock, "utf8")), owner);
    assert.equal(existsSync(fixture.targetPath), false);
  } finally { fixture.cleanup(); }
});
test("negative and maximum-safe writer registry revisions block before local effects", () => {
  const fixture = repositoryFixture();
  try {
    const controller = createOpenReviewedLaneRehydrationController({ adapter: fixture.createAdapter() }); const plan = controller.plan();
    for (const revision of [-1, Number.MAX_SAFE_INTEGER]) {
      writeRegistry(fixture.repository, { schema: WRITER_LEASE_REGISTRY_SCHEMA, revision, leases: {} });
      assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /writer registry/u);
      assert.equal(existsSync(fixture.targetPath), false);
      assert.throws(() => runGit(fixture.repository, ["show-ref", "--verify", `refs/heads/${fixture.branch}`]));
    }
  } finally { fixture.cleanup(); }
});
test("authorized evidence drift fails before branch, worktree, or lease effects", () => {
  const { adapter, state } = fakeAdapter();
  adapter.revalidate = () => { throw new Error("authorized evidence drift"); };
  const controller = createOpenReviewedLaneRehydrationController({ adapter }); const plan = controller.plan();
  assert.throws(() => controller.run({ plan, authorization: plan.exactAuthorization }), /authorized evidence drift/u);
  assert.deepEqual([state.branch, state.worktree, state.lease], [false, false, false]);
  assert.equal(state.journal.status, "prepared");
});
test("repository adapter contains no force or broad prune lifecycle command", () => {
  const source = readFileSync(new URL("../scripts/open-reviewed-lane-rehydration-repository-adapter.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /worktree[^\n]*(?:--force|\bprune\b)/u);
  assert.match(source, /\["worktree", "add", "--"/u);
  assert.match(source, /\["worktree", "remove", "--"/u);
});
