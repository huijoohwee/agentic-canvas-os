import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCloudTransition,
  createEmptyLedger,
} from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlan,
  buildPlan,
} from "../scripts/closed-absent-planned-owner-release-contract.mjs";
import { createController }
  from "../scripts/closed-absent-planned-owner-release-controller.mjs";
import { createRepositoryAdapter }
  from "../scripts/closed-absent-planned-owner-release-repository-adapter.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const hash = label => digestValue({ label });
const sha = label => hash(label).slice(0, 40);

function createHarness(t) {
  const root = mkdtempSync(path.join(tmpdir(), "closed-absent-owner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryPath = path.join(root, "repository"), commonDirectory = path.join(root, "git-common");
  mkdirSync(repositoryPath); mkdirSync(commonDirectory);
  const repositoryRealpath = realpathSync(repositoryPath);
  const branch = "agent/device/closed-owner", repositoryName = "owner/repository";
  const baseSha = sha("base"), headSha = sha("head"), treeSha = sha("tree");
  const controllerSha = sha("controller"), controllerTreeSha = sha("controller-tree");
  const nodeId = "PR_closed_owner", reviewRequestId = `github-pull-request:${nodeId}`;
  const actor = { actorId: "actor:owner", deviceId: "device", sessionId: "session" };
  const cloudRepository = { repositoryId: "repository:target", canonicalRevision: baseSha };
  const declaredWriteSet = ["path:docs/owner.md", "semantic:closed-owner"];
  let cloud = applyCloudTransition({ ledger: createEmptyLedger("owner/ledger"), action: "claim",
    actor, repository: cloudRepository, evaluationTime: "2026-08-20T00:00:00.000Z",
    request: { workItemId: "work:closed-owner", canonicalBaseRevision: baseSha,
      declaredWriteScope: declaredWriteSet, laneRevision: baseSha, leaseEpoch: 1,
      expiresAt: "2026-08-20T02:00:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: "claim:closed-owner" } });
  cloud = applyCloudTransition({ ledger: cloud.ledger, action: "continue", actor,
    repository: cloudRepository, evaluationTime: "2026-08-20T00:10:00.000Z",
    request: { claimId: cloud.claim.claimId, expectedFenceRevision: cloud.claim.fenceRevision,
      expectedTransitionCounter: cloud.claim.transitionCounter, expectedLedgerDigest: cloud.ledger.headDigest,
      mode: "projection", laneRevision: headSha, reviewRequestId,
      idempotencyKey: "project:closed-owner" } });
  const sourceClaim = cloud.claim, sourceEntry = cloud.ledger.entries.at(-1);
  cloud = applyCloudTransition({ ledger: cloud.ledger, action: "retire", actor,
    repository: cloudRepository, evaluationTime: "2026-08-24T05:00:00.000Z",
    request: { claimId: sourceClaim.claimId, expectedFenceRevision: sourceClaim.fenceRevision,
      expectedTransitionCounter: sourceClaim.transitionCounter,
      expectedLedgerDigest: cloud.ledger.headDigest, reason: "abandoned",
      finalRevision: headSha, reviewRequestId, bytesDigest: hash("bytes"),
      namedChecksDigest: hash("checks"), handoffEvidenceDigest: hash("handoff"),
      idempotencyKey: "retire:closed-owner" } });
  const ledger = cloud.ledger, terminalEntry = ledger.entries.at(-1);
  const claimId = sourceClaim.claimId;
  const missingWorktree = path.join(root, "missing-owner");
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "session", device: "device", scope: "closed-owner", branch,
    worktreePath: missingWorktree, baseSha, fenceSha: headSha,
    pullRequestUrl: "https://example.test/owner/repository/pull/17",
    autoDelivery: false, runtimeRequired: false,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "planned",
      semanticScope: "closed-owner", declaredWriteSet,
      writeSetDigest: sourceClaim.writeSetDigest, manifestDigest: hash("manifest"),
      planReceiptDigest: hash("plan-receipt"), admissionReceiptDigest: hash("admission-receipt"),
      existingLaneStateDigest: hash("existing-lane") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "owner/ledger", targetRepository: repositoryName, claimId,
      claimDigest: sourceEntry.claimDigest, ledgerRevision: sha("source-ledger"),
      claimLedgerRevision: sourceEntry.digest, canonicalBaseSha: baseSha, laneRevision: headSha,
      cloudDeclaredWriteScope: declaredWriteSet,
      writeSetDigest: sourceClaim.writeSetDigest, leaseEpoch: sourceClaim.leaseEpoch,
      transitionCounter: sourceClaim.transitionCounter, reviewRequestId, state: "active",
      expiresAt: sourceClaim.expiresAt }, acquiredAt: "2026-08-20T00:00:00.000Z",
    heartbeatAt: "2026-08-20T00:10:00.000Z", expiresAt: "2026-08-20T01:00:00.000Z",
    taskAuthority: { schema: "agentic-task-authority-binding/v1",
      authoritySubjectId: "urn:agentic-task:ecf23ead30c2e7eec477e154cdf127f2b6c623831c001952d0e1b280bb68e223",
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
      publicKey: "MCowBQYDK2VwAyEAJrlc5A3roTL0OYnt/jrI1728OCMSpWD/lq/aKfx+aJE=",
      publicKeyDigest: "aeb38ccccd3cf43765aebbae57f7c74614dd3f0c96e675afbe670c844d302cb2",
      laneBindingDigest: "38b8a14c8f96a31247e800bb30a68255c6ff4eb7cf73a752c456303f966c069a",
      bindingMode: "claim", boundAt: "2026-08-20T04:38:06.377Z",
      transitionPlanDigest: null, priorBindingDigest: null,
      bindingDigest: "d45a2d7bc19788768393c82100518b30cecf0829bd78e95856558faecedf767b" } };
  const peer = { schema: "agentic-writer-lease/v2", status: "released", epoch: 8,
    branch: "agent/device/peer" };
  const registryPath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.json");
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const initialRegistry = { schema: "agentic-writer-lease-registry/v2", revision: 31,
    leases: { [branch]: lease, [peer.branch]: peer }, scopeExpansionIntents: {},
    activeOwnedDirtRecoveryIntents: {}, reviewedLaneEntrypointFences: {} };
  writeFileSync(registryPath, `${JSON.stringify(initialRegistry, null, 2)}\n`, { mode: 0o600 });
  const leaseStore = { statePath: registryPath,
    readRegistry: () => JSON.parse(readFileSync(registryPath, "utf8")),
    withRegistryLock: action => action(JSON.parse(readFileSync(registryPath, "utf8"))) };
  const body = renderWriterLeasePullRequestBody(lease);
  let externalUnavailable = false, externalReadCount = 0;
  const externalState = {
    targetOrigin: `https://github.com/${repositoryName}.git`,
    targetTopLevel: repositoryPath,
    targetCommonDirectory: commonDirectory,
    controllerOrigin: "https://github.com/owner/ledger.git",
    controllerHeadSha: controllerSha,
    controllerMainSha: controllerSha,
    controllerTrackingMainSha: controllerSha,
    controllerRemoteMainSha: controllerSha,
    controllerTreeSha,
    controllerProviderTreeSha: controllerTreeSha,
    controllerProtected: true,
  };
  const readExternal = action => {
    externalReadCount += 1;
    if (externalUnavailable) throw new Error("simulated external evidence reader failure");
    return action();
  };
  const git = (argumentsList, cwd = repositoryPath) => readExternal(() => {
    const command = argumentsList.join(" ");
    const target = realpathSync(path.resolve(cwd)) === repositoryRealpath;
    if (target && command === "rev-parse --path-format=absolute --git-common-dir") {
      return externalState.targetCommonDirectory;
    }
    if (target && command === "remote get-url origin") return externalState.targetOrigin;
    if (target && command === "rev-parse --show-toplevel") return externalState.targetTopLevel;
    if (target && command === "for-each-ref --format=%(refname) refs/heads") return "refs/heads/main";
    if (target && command === `ls-remote --heads origin ${branch}`) return "";
    if (target && command === "ls-remote origin refs/pull/17/head") {
      return `${headSha}\trefs/pull/17/head`;
    }
    if (!target && command === "remote get-url origin") return externalState.controllerOrigin;
    if (!target && command === "rev-parse --show-toplevel") return cwd;
    if (!target && command === "rev-parse HEAD") return externalState.controllerHeadSha;
    if (!target && command === "rev-parse refs/heads/main") return externalState.controllerMainSha;
    if (!target && command === "rev-parse refs/remotes/origin/main") {
      return externalState.controllerTrackingMainSha;
    }
    if (!target && command === "ls-remote --refs origin refs/heads/main") {
      return `${externalState.controllerRemoteMainSha}\trefs/heads/main`;
    }
    if (!target && command === "rev-parse HEAD^{tree}") return externalState.controllerTreeSha;
    if (!target && command === "branch --show-current") return "main";
    throw new Error(`unexpected git command: ${command}`);
  });
  const ghJson = argumentsList => readExternal(() => {
    const command = argumentsList.join(" ");
    if (command.startsWith("repo view ")) return { id: "R_target", nameWithOwner: repositoryName };
    if (command.startsWith("pr view ")) return { number: 17, id: nodeId,
      url: lease.pullRequestUrl, state: "CLOSED", isDraft: true, mergedAt: null,
      closedAt: "2026-08-20T01:30:00Z", headRefName: branch, headRefOid: headSha,
      headRepository: { nameWithOwner: repositoryName }, baseRefName: "main", baseRefOid: baseSha, body };
    if (command.endsWith(`/git/commits/${headSha}`)) {
      return { sha: headSha, tree: { sha: treeSha }, parents: [{ sha: baseSha }] };
    }
    if (command.endsWith(`/git/commits/${baseSha}`)) return { sha: baseSha, tree: { sha: treeSha }, parents: [] };
    if (command.endsWith(`/commits/${headSha}`)) return { files: [] };
    if (command.endsWith("repos/owner/ledger/branches/main")) {
      return { name: "main", commit: { sha: externalState.controllerRemoteMainSha },
        protected: externalState.controllerProtected,
        protection: { enabled: externalState.controllerProtected } };
    }
    if (command.endsWith(`repos/owner/ledger/git/commits/${externalState.controllerRemoteMainSha}`)) {
      return { sha: externalState.controllerRemoteMainSha,
        tree: { sha: externalState.controllerProviderTreeSha } };
    }
    throw new Error(`unexpected gh command: ${command}`);
  });
  const status = { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "status",
    status: "ready", ledgerRevision: sha("ledger-revision"), ledgerDigest: ledger.headDigest,
    sequence: ledger.sequence, claims: [] };
  const gitRaw = (argumentsList, cwd = repositoryPath) => readExternal(() => {
    const command = argumentsList.join(" ");
    if (realpathSync(path.resolve(cwd)) === repositoryRealpath
      && command === "worktree list --porcelain -z") {
      return `worktree ${repositoryPath}\0HEAD ${baseSha}\0branch refs/heads/main\0`;
    }
    if (realpathSync(path.resolve(cwd)) !== repositoryRealpath
      && command === "status --porcelain=v1 --untracked-files=all") return "";
    throw new Error(`unexpected raw git command: ${command}`);
  });
  const adapter = createRepositoryAdapter({ repository: repositoryPath, targetRepository: repositoryName,
    ledgerRepository: "owner/ledger", branch, pullRequestNumber: 17, claimId }, {
    git, gitRaw,
    ghJson, leaseStore, readCloud: () => readExternal(() => status),
    readLedger: () => readExternal(() => ledger),
    now: () => new Date("2026-08-24T06:01:00.000Z") });
  return { adapter, branch, claimId, initialRegistry, lease, peer, registryPath,
    sourceEntry, terminalEntry,
    mutateExternal(values) { Object.assign(externalState, values); },
    disableExternalReaders() { externalUnavailable = true; return externalReadCount; },
    externalReadCount() { return externalReadCount; } };
}

test("adapter joins the absent lane and applies exactly one registry CAS", async t => {
  const fixture = createHarness(t);
  const evidence = await fixture.adapter.observe();
  assert.equal(evidence.cloud.source.claimId, fixture.claimId);
  assert.equal(evidence.cloud.terminal.claimId, fixture.claimId);
  assert.equal(evidence.cloud.source.entryDigest, fixture.sourceEntry.digest);
  assert.equal(evidence.cloud.terminal.entryDigest, fixture.terminalEntry.digest);
  assert.equal(evidence.localAbsence.remoteBranchPresent, false);
  const plan = buildPlan({ evidence });
  const authorization = authorizePlan({ plan, authorization: plan.exactAuthorization });
  assert.equal(fixture.adapter.classifyOwner(plan, authorization).state, "pending");
  fixture.adapter.releaseOwner(plan, authorization);
  const stored = JSON.parse(readFileSync(fixture.registryPath, "utf8"));
  assert.equal(stored.revision, fixture.initialRegistry.revision + 1);
  assert.deepEqual(stored.leases[fixture.peer.branch], fixture.peer);
  assert.deepEqual(stored.scopeExpansionIntents, fixture.initialRegistry.scopeExpansionIntents);
  assert.equal(stored.leases[fixture.branch].status, "released");
  assert.equal(stored.leases[fixture.branch].admission, null);
  assert.equal(stored.leases[fixture.branch].cloudAuthority, null);
  assert.deepEqual(stored.leases[fixture.branch].closedAbsentPlannedOwnerRelease.originalLease,
    fixture.lease);
  assert.equal(fixture.adapter.classifyOwner(plan, authorization).state, "complete");
  assert.equal(fixture.adapter.verifyTerminal(plan, authorization).releasedLease.status, "released");
});

test("terminal replay remains local when external readers fail after a lost CAS response", async t => {
  const fixture = createHarness(t);
  const plan = buildPlan({ evidence: await fixture.adapter.observe() });
  const authorization = authorizePlan({ plan, authorization: plan.exactAuthorization });
  let releaseCalls = 0, readsWhenDisabled = null;
  const controller = createController({ adapter: {
    observe: (...argumentsList) => fixture.adapter.observe(...argumentsList),
    classifyOwner: (...argumentsList) => fixture.adapter.classifyOwner(...argumentsList),
    releaseOwner: (...argumentsList) => {
      releaseCalls += 1;
      fixture.adapter.releaseOwner(...argumentsList);
      readsWhenDisabled = fixture.disableExternalReaders();
      throw new Error("simulated writer-registry CAS response loss");
    },
    verifyTerminal: (...argumentsList) => fixture.adapter.verifyTerminal(...argumentsList),
  } });
  const first = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(fixture.adapter.classifyOwner(plan, authorization).state, "complete");
  assert.equal(fixture.adapter.verifyTerminal(plan, authorization).releasedLease.status, "released");
  const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, first);
  assert.equal(releaseCalls, 1);
  assert.equal(fixture.externalReadCount(), readsWhenDisabled);
});

test("full-registry drift blocks the bounded release before CAS", async t => {
  const fixture = createHarness(t);
  const plan = buildPlan({ evidence: await fixture.adapter.observe() });
  const authorization = authorizePlan({ plan, authorization: plan.exactAuthorization });
  const drifted = JSON.parse(readFileSync(fixture.registryPath, "utf8"));
  drifted.revision += 1;
  writeFileSync(fixture.registryPath, `${JSON.stringify(drifted, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => fixture.adapter.releaseOwner(plan, authorization), /foreign state|changed/u);
  assert.equal(JSON.parse(readFileSync(fixture.registryPath, "utf8")).leases[fixture.branch].status, "active");
});

test("terminal classification requires the embedded target registry revision", async t => {
  const fixture = createHarness(t);
  const plan = buildPlan({ evidence: await fixture.adapter.observe() });
  const authorization = authorizePlan({ plan, authorization: plan.exactAuthorization });
  fixture.adapter.releaseOwner(plan, authorization);
  const regressed = JSON.parse(readFileSync(fixture.registryPath, "utf8"));
  regressed.revision = fixture.initialRegistry.revision;
  writeFileSync(fixture.registryPath, `${JSON.stringify(regressed, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => fixture.adapter.classifyOwner(plan, authorization),
    /released writer-registry revision/u);
});

test("adapter rejects target and controller identity or protected-main drift", async t => {
  const cases = [
    ["foreign target origin", { targetOrigin: "https://github.com/owner/foreign.git" },
      /target GitHub origin/u],
    ["foreign target top-level", { targetTopLevel: null }, /top-level continuity/u],
    ["changed target common directory", { targetCommonDirectory: null }, /common-directory continuity/u],
    ["foreign controller origin", { controllerOrigin: "git@github.com:owner/foreign.git" },
      /controller GitHub origin/u],
    ["stale controller local main", { controllerMainSha: sha("stale-local-main") },
      /provider-protected controller main/u],
    ["stale controller tracking main", { controllerTrackingMainSha: sha("stale-tracking-main") },
      /provider-protected controller main/u],
    ["stale controller live main", { controllerRemoteMainSha: sha("stale-live-main") },
      /provider-protected controller main/u],
    ["unprotected controller main", { controllerProtected: false },
      /provider-protected controller main/u],
    ["foreign provider tree", { controllerProviderTreeSha: sha("foreign-tree") },
      /provider-protected controller main/u],
  ];
  for (const [name, drift, pattern] of cases) {
    await t.test(name, subtest => {
      const fixture = createHarness(subtest);
      if (Object.hasOwn(drift, "targetTopLevel")) drift.targetTopLevel = path.dirname(fixture.registryPath);
      if (Object.hasOwn(drift, "targetCommonDirectory")) {
        drift.targetCommonDirectory = path.dirname(fixture.registryPath);
      }
      fixture.mutateExternal(drift);
      assert.throws(() => fixture.adapter.observe(), pattern);
    });
  }
});
