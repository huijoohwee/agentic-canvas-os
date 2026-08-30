import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync }
  from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTerminalHandoffOwnedDirtSuccessorRecoveryController }
  from "../scripts/terminal-handoff-owned-dirt-successor-recovery-controller.mjs";
import { buildRecoveryPlan, createRecoveryIntent }
  from "../scripts/terminal-handoff-owned-dirt-successor-recovery-contract.mjs";
import { selectTerminalHandoffClaimProof }
  from "../scripts/terminal-handoff-owned-dirt-successor-recovery-evidence.mjs";
import { applyCloudTransition, createEmptyLedger }
  from "../scripts/cloud-collaboration-contract.mjs";
import { projectPublicClaim }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
  projectTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability, writeTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-store.mjs";
import { writerLeaseBodyRemainder } from "../scripts/orphaned-task-authority-recovery-evidence.mjs";
import {
  assertNoHistoricalTerminalHandoffSuccessor,
  assertTerminalHandoffAuthenticatedOperation,
  assertTerminalHandoffCloudStatusSnapshot,
  assertTerminalHandoffPullRequestIdentity,
  assertTerminalHandoffRepositoryIdentity,
  assertTerminalHandoffSuccessorClaimResult,
  assertTerminalHandoffSuccessorCapability,
  createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter,
  createTerminalHandoffSuccessorLocalTarget,
} from "../scripts/terminal-handoff-owned-dirt-successor-recovery-repository-adapter.mjs";

const hex = value => digestValue(value);
const sha = value => hex(value).slice(0, 40);

test("selects only an exact current-to-retired handoff chain", () => {
  const fixture = sourceFixture();
  const proof = selectTerminalHandoffClaimProof({ entries: fixture.entries, lease: fixture.lease });
  assert.equal(proof.claimId, fixture.lease.cloudAuthority.claimId);
  assert.equal(proof.retirementReason, "handoff");
  assert.ok(proof.terminalTransitionCounter > proof.sourceTransitionCounter);
  assert.throws(() => selectTerminalHandoffClaimProof({
    entries: fixture.entries.map((entry, index) => index ? {
      ...entry, claimCore: { ...entry.claimCore,
        retirement: { ...entry.claimCore.retirement, reason: "abandoned" } },
    } : entry), lease: fixture.lease,
  }), /terminal handoff/u);
});

test("runs the journaled successor chain without source effects", async () => {
  const evidence = evidenceFixture();
  const plan = buildRecoveryPlan({ evidence,
    operatorSessionId: "successor-session", ttlSeconds: 1800 });
  let journal = null;
  const calls = [];
  const effects = {
    snapshot: { receiptDigest: hex("snapshot") },
    claimSuccessor: { claimId: hex("successor"), receiptDigest: hex("claim") },
    bindSuccessor: { authority: { claimId: hex("successor") }, receiptDigest: hex("bind") },
    projectLocal: { receiptDigest: hex("local") },
    projectPullRequest: { receiptDigest: hex("marker") },
    verifyTerminal: { receiptDigest: hex("terminal"),
      mutationAuthorityReceiptDigest: hex("mutation") },
  };
  const adapter = {
    withFence: action => action(), captureEvidence: async () => evidence,
    readIntent: async () => journal,
    writeIntent: async ({ expected, value }) => { assert.equal(expected, journal); journal = value; },
    reconcile: async () => null,
    ...Object.fromEntries(Object.entries(effects).map(([name, value]) => [name, async () => {
      calls.push(name); return value;
    }])),
  };
  const controller = createTerminalHandoffOwnedDirtSuccessorRecoveryController(adapter);
  const completion = await controller.run({ plan, operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization });
  assert.equal(completion.status, "successor-active");
  assert.equal(completion.sourceBytesChanged, false);
  assert.deepEqual(calls, ["snapshot", "claimSuccessor", "bindSuccessor", "projectLocal",
    "projectPullRequest", "verifyTerminal"]);
  assert.equal(journal.phase, "complete");
  assert.deepEqual(await controller.run({ plan, operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization }), completion);
});

test("accepts only a distinct next-generation successor capability", () => {
  const sourceCapability = createTaskAuthorityCapability({ generation: 1 });
  const sourceLease = localLeaseFixture();
  const sourceTaskAuthority = createTaskAuthorityBinding({
    capability: sourceCapability,
    lease: sourceLease,
    boundAt: "2026-08-25T00:00:00.000Z",
  });
  const target = projectTaskAuthorityCapability(createTaskAuthorityCapability({ generation: 2 }));
  assert.equal(assertTerminalHandoffSuccessorCapability({
    targetCapability: target,
    sourceTaskAuthority,
  }), target);

  assert.throws(() => assertTerminalHandoffSuccessorCapability({
    targetCapability: projectTaskAuthorityCapability(sourceCapability),
    sourceTaskAuthority,
  }), /generation must advance exactly once/u);
  assert.throws(() => assertTerminalHandoffSuccessorCapability({
    targetCapability: projectTaskAuthorityCapability(createTaskAuthorityCapability({
      authoritySubjectId: sourceTaskAuthority.authoritySubjectId,
      generation: 2,
    })),
    sourceTaskAuthority,
  }), /distinct authority subject/u);
  assert.throws(() => assertTerminalHandoffSuccessorCapability({
    targetCapability: projectTaskAuthorityCapability(createTaskAuthorityCapability({ generation: 3 })),
    sourceTaskAuthority,
  }), /generation must advance exactly once/u);
  assert.throws(() => assertTerminalHandoffSuccessorCapability({
    targetCapability: { ...target, proofAdapterId: "urn:agentic-proof:other:v1" },
    sourceTaskAuthority,
  }), /source proof adapter/u);
});

test("binds and proves the final local target with the successor capability", () => {
  const sourceCapability = createTaskAuthorityCapability({ generation: 1 });
  const capability = createTaskAuthorityCapability({ generation: 2 });
  const unbound = localLeaseFixture();
  const sourceTaskAuthority = createTaskAuthorityBinding({
    capability: sourceCapability,
    lease: unbound,
    boundAt: "2026-08-25T00:00:00.000Z",
  });
  const sourceLease = { ...unbound, taskAuthority: sourceTaskAuthority };
  const planDigest = hex("local-target-plan");
  const reviewRequestId = "github-pull-request:PR_local_target";
  const plan = {
    planDigest,
    operatorSessionId: "successor-session",
    targetCapabilityDigest: digestValue(projectTaskAuthorityCapability(capability)),
    evidence: { lease: sourceLease, sourceClaim: { reviewRequestId },
      pullRequest: { id: "PR_local_target" } },
  };
  const authority = {
    claimId: hex("successor-claim"),
    reviewRequestId,
    expiresAt: "2026-08-25T01:00:00.000Z",
  };
  const result = createTerminalHandoffSuccessorLocalTarget({
    plan,
    sourceLease,
    successorValues: { evaluationTime: new Date().toISOString() },
    authority,
    capability,
  });
  assert.equal(result.lease.taskAuthority.authoritySubjectId,
    projectTaskAuthorityCapability(capability).authoritySubjectId);
  assert.equal(result.lease.taskAuthority.generation, 2);
  assert.equal(result.lease.taskAuthority.priorBindingDigest, sourceTaskAuthority.bindingDigest);
  assert.equal(result.lease.sessionId, "successor-session");
  const operation = `terminal-handoff-owned-dirt-successor-recovery:${planDigest}:local-cas`;
  assert.equal(verifyTaskAuthorityProof({
    proof: result.proof,
    binding: result.binding,
    lease: result.lease,
    operation,
  }).proofDigest, result.proofDigest);
  // The wrong lease is still refused. It is refused by the proof challenge rather
  // than the durable binding, because the volatile lane operands moved out of the
  // write-once digest and into every per-operation challenge; the source lease
  // shares this lane's stable identity but not its epoch, base, or claim.
  assert.throws(() => verifyTaskAuthorityProof({
    proof: result.proof,
    binding: result.binding,
    lease: sourceLease,
    operation,
  }), /proof changed its bound mutation subject/u);
});

test("reconciles only the exact successor local target", async t => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "terminal-handoff-local-target-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  mkdirSync(path.join(repository, ".git"), { mode: 0o700 });
  const capabilityPath = path.join(root, "successor-capability.json");
  writeTaskAuthorityCapability({ outputPath: capabilityPath, generation: 2 });
  const capability = readTaskAuthorityCapability(capabilityPath);
  const sourceCapability = createTaskAuthorityCapability({ generation: 1 });
  let originRepository = "example/repository";
  let observedPullRequestUrl = "https://github.com/example/repository/pull/17";
  let observedHeadRepository = "example/repository";
  let observedBaseRepository;
  const pullRequestUrl = "https://github.com/example/repository/pull/17";
  const unbound = { ...localLeaseFixture(), pullRequestUrl,
    worktreePath: repository,
    admission: { status: "admitted", declaredWriteSet: ["path:docs/terminal.md"] },
    cloudAuthority: { ...localLeaseFixture().cloudAuthority,
      state: "active", reviewRequestId: "github-pull-request:PR_exact_local_target" } };
  const sourceTaskAuthority = createTaskAuthorityBinding({
    capability: sourceCapability,
    lease: unbound,
    boundAt: "2026-08-25T00:00:00.000Z",
  });
  const sourceLease = { ...unbound, taskAuthority: sourceTaskAuthority };
  const planDigest = hex("exact-local-target-plan");
  const pullBody = "description\n\n<!-- agentic-writer-lease/v2 {} -->";
  const repositoryIdentity = assertTerminalHandoffRepositoryIdentity({
    targetRepository: sourceLease.cloudAuthority.targetRepository,
    originFetchUrl: "https://github.com/example/repository.git",
    originPushUrl: "git@github.com:example/repository.git",
    pullRequest: {
      url: pullRequestUrl,
      headRepository: { nameWithOwner: "example/repository" },
      headRefName: sourceLease.branch,
      baseRefName: "main",
    },
    branch: sourceLease.branch,
  });
  const pullRequest = { id: "PR_exact_local_target",
    url: pullRequestUrl,
    baseSha: sourceLease.baseSha,
    bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pullBody)),
    repository: repositoryIdentity.pullRequestRepository,
    headRepository: repositoryIdentity.headRepository,
    baseRepository: repositoryIdentity.baseRepository,
    headBranch: repositoryIdentity.headRefName,
    baseBranch: repositoryIdentity.baseRefName };
  const reviewRequestId = `github-pull-request:${pullRequest.id}`;
  const plan = {
    planDigest,
    headSha: sourceLease.fenceSha,
    operatorSessionId: "successor-session",
    targetCapabilityDigest: digestValue(projectTaskAuthorityCapability(capability)),
    evidence: { lease: sourceLease, branch: sourceLease.branch,
      headSha: sourceLease.fenceSha, repositoryIdentity,
      sourceClaim: { reviewRequestId }, pullRequest },
  };
  const claimed = {
    claimId: hex("successor-claim"),
    evaluationTime: "2026-08-25T00:15:00.000Z",
  };
  const authority = { ...sourceLease.cloudAuthority,
    claimId: claimed.claimId,
    claimDigest: hex("successor-claim-fence"),
    sessionId: plan.operatorSessionId,
    leaseEpoch: 2,
    state: "active",
    reviewRequestId,
    expiresAt: "2026-08-25T01:00:00.000Z",
  };
  const target = createTerminalHandoffSuccessorLocalTarget({
    plan,
    sourceLease,
    successorValues: claimed,
    authority,
    capability,
  });
  let observedLease = target.lease;
  let pullNodeId = pullRequest.id;
  let pullRequestEdits = 0;
  let pullRequestReads = 0;
  let cloudInvocations = 0;
  let driftOnPullRead = false;
  let driftAtEditBoundary = false;
  let registryLockHeld = false;
  let foreignCasAttempts = 0;
  const leaseStore = {
    read: () => observedLease,
    withRegistryLock(action) {
      assert.equal(registryLockHeld, false, "registry lock must not be re-entered");
      registryLockHeld = true;
      try {
        return action({ schema: "agentic-writer-lease-registry/v2", revision: 1,
          leases: { [sourceLease.branch]: observedLease } });
      } finally {
        registryLockHeld = false;
      }
    },
    attemptForeignCas() {
      foreignCasAttempts += 1;
      if (registryLockHeld) throw new Error("foreign registry CAS blocked by held lock");
      observedLease = { ...target.lease, sessionId: "foreign-boundary-session" };
    },
  };
  const adapter = createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter({
    repository,
    taskAuthorityFile: capabilityPath,
  }, {
    gitText: args => {
      if (args[0] === "branch") return sourceLease.branch;
      if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return sourceLease.fenceSha;
      if (args[0] === "worktree") return `worktree ${repository}\0HEAD ${sourceLease.fenceSha}\0branch refs/heads/${sourceLease.branch}\0`;
      if (args.join(" ") === "remote get-url --all origin") {
        return `https://github.com/${originRepository}.git`;
      }
      if (args.join(" ") === "remote get-url --push --all origin") {
        return `git@github.com:${originRepository}.git`;
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
    leaseStore,
    invoke: () => { cloudInvocations += 1; throw new Error("unexpected cloud invocation"); },
    ghText: args => {
      if (args[0] === "pr" && args[1] === "view") {
        pullRequestReads += 1;
        const response = JSON.stringify({
          id: pullNodeId,
          url: observedPullRequestUrl,
          state: "OPEN",
          isDraft: true,
          headRefName: sourceLease.branch,
          headRefOid: plan.headSha,
          headRepository: { nameWithOwner: observedHeadRepository },
          ...(observedBaseRepository
            ? { baseRepository: { nameWithOwner: observedBaseRepository } } : {}),
          baseRefName: "main",
          baseRefOid: pullRequest.baseSha,
          body: pullBody,
        });
        if (driftOnPullRead) observedLease = { ...target.lease,
          sessionId: "foreign-registry-session" };
        return response;
      }
      if (args[0] === "pr" && args[1] === "edit") {
        if (driftAtEditBoundary) leaseStore.attemptForeignCas();
        pullRequestEdits += 1;
        return "";
      }
      throw new Error(`Unexpected gh command: ${args.join(" ")}`);
    },
  });
  const intent = { receipts: {
    "successor-claimed": { values: claimed },
    "successor-bound": { values: { authority } },
  } };
  const input = { plan, intent, phase: "local-cas" };
  const exact = await adapter.reconcile(input);
  assert.equal(exact?.kind, "local-cas");
  assert.equal(exact?.targetBindingDigest, target.binding.bindingDigest);
  assert.match(exact?.proofDigest, /^[0-9a-f]{64}$/u);
  assert.notEqual(exact?.proofDigest, target.proofDigest,
    "reconciliation must produce a fresh target proof");
  intent.receipts["local-cas"] = { values: exact };

  const targetWithoutBinding = { ...target.lease };
  delete targetWithoutBinding.taskAuthority;
  const wrongGenerationBinding = createTaskAuthorityBinding({
    capability: createTaskAuthorityCapability({ generation: 3 }),
    lease: targetWithoutBinding,
    bindingMode: "handoff",
    boundAt: claimed.evaluationTime,
    transitionPlanDigest: planDigest,
    priorBindingDigest: sourceTaskAuthority.bindingDigest,
  });
  const wrongPriorBinding = createTaskAuthorityBinding({
    capability,
    lease: targetWithoutBinding,
    bindingMode: "handoff",
    boundAt: claimed.evaluationTime,
    transitionPlanDigest: planDigest,
    priorBindingDigest: hex("wrong-prior-binding"),
  });
  const variants = [
    ["session", { ...target.lease, sessionId: "wrong-successor-session" }],
    ["binding generation", { ...target.lease, taskAuthority: wrongGenerationBinding }],
    ["prior binding", { ...target.lease, taskAuthority: wrongPriorBinding }],
    ["cloud authority", { ...target.lease,
      cloudAuthority: { ...target.lease.cloudAuthority,
        claimDigest: hex("wrong-successor-claim-fence") } }],
    ["review request", { ...target.lease,
      cloudAuthority: { ...target.lease.cloudAuthority,
        reviewRequestId: "github-pull-request:PR_foreign" } }],
  ];
  for (const [label, lease] of variants) {
    observedLease = lease;
    assert.equal(await adapter.reconcile(input), null,
      `same-claim target with wrong ${label} must not reconcile`);
  }

  observedLease = target.lease;
  const foreignAuthorityIntent = structuredClone(intent);
  foreignAuthorityIntent.receipts["successor-bound"].values.authority.reviewRequestId =
    "github-pull-request:PR_foreign";
  assert.equal(await adapter.reconcile({ plan, intent: foreignAuthorityIntent,
    phase: "local-cas" }), null);

  const malformedSourceLease = { ...sourceLease,
    taskAuthority: { ...sourceTaskAuthority, generation: sourceTaskAuthority.generation + 1 } };
  const malformedPlan = { ...plan,
    evidence: { ...plan.evidence, lease: malformedSourceLease } };
  assert.equal(await adapter.reconcile({ plan: malformedPlan, intent,
    phase: "local-cas" }), null);
  assert.throws(() => createTerminalHandoffSuccessorLocalTarget({
    plan: malformedPlan,
    sourceLease: malformedSourceLease,
    successorValues: claimed,
    authority,
    capability,
  }), /binding digest drifted/u);

  pullNodeId = "PR_foreign";
  assert.throws(() => adapter.projectPullRequest({ plan, intent }), /PR node identity/u);
  assert.equal(pullRequestEdits, 0, "foreign PR identity must fail before marker mutation");

  pullNodeId = pullRequest.id;
  const readsBeforeForeignOrigin = pullRequestReads;
  originRepository = "foreign/mirror";
  assert.throws(() => adapter.projectPullRequest({ plan, intent }),
    /origin fetch and push URLs|authorized recovery plan/u);
  assert.equal(pullRequestReads, readsBeforeForeignOrigin,
    "foreign origin must fail before the PR provider read");
  assert.equal(pullRequestEdits, 0);
  assert.equal(await adapter.reconcile({ plan, intent, phase: "successor-claimed",
    operationKey: "foreign-origin-claim" }), null);
  assert.equal(cloudInvocations, 0,
    "foreign origin must fail before claim/bind provider inspection or mutation");
  observedLease = sourceLease;
  assert.throws(() => adapter.snapshot({ plan }), /origin fetch and push URLs/u);
  assert.throws(() => adapter.claimSuccessor({ plan,
    operationKey: "foreign-origin-claim-effect" }), /origin fetch and push URLs/u);
  assert.throws(() => adapter.bindSuccessor({ plan, intent,
    operationKey: "foreign-origin-bind-effect" }), /origin fetch and push URLs/u);
  assert.equal(pullRequestReads, readsBeforeForeignOrigin,
    "foreign origin must fail before snapshot, claim, bind, or PR provider reads");
  assert.equal(cloudInvocations, 0);
  observedLease = target.lease;
  originRepository = "example/repository";

  observedPullRequestUrl = "https://github.com/foreign/pull-subject/pull/17";
  observedLease = sourceLease;
  assert.throws(() => adapter.snapshot({ plan }), /does not match|repository identity/u);
  assert.throws(() => adapter.claimSuccessor({ plan,
    operationKey: "foreign-pr-claim-effect" }), /does not match|repository identity/u);
  assert.throws(() => adapter.bindSuccessor({ plan, intent,
    operationKey: "foreign-pr-bind-effect" }), /does not match|repository identity/u);
  assert.equal(cloudInvocations, 0);
  observedLease = target.lease;
  assert.throws(() => adapter.projectPullRequest({ plan, intent }),
    /does not match|repository identity/u);
  assert.equal(pullRequestEdits, 0);
  observedPullRequestUrl = pullRequest.url;

  observedHeadRepository = "foreign/head-fork";
  observedLease = sourceLease;
  assert.throws(() => adapter.snapshot({ plan }), /repository identity/u);
  assert.throws(() => adapter.claimSuccessor({ plan,
    operationKey: "foreign-head-claim-effect" }), /repository identity/u);
  assert.throws(() => adapter.bindSuccessor({ plan, intent,
    operationKey: "foreign-head-bind-effect" }), /repository identity/u);
  assert.equal(cloudInvocations, 0);
  observedLease = target.lease;
  assert.throws(() => adapter.projectPullRequest({ plan, intent }), /repository identity/u);
  assert.equal(pullRequestEdits, 0);
  observedHeadRepository = "example/repository";

  observedBaseRepository = "foreign/base-repository";
  assert.throws(() => adapter.projectPullRequest({ plan, intent }), /repository identity/u);
  assert.equal(pullRequestEdits, 0);
  observedBaseRepository = undefined;

  observedLease = target.lease;
  driftOnPullRead = true;
  assert.throws(() => adapter.projectPullRequest({ plan, intent }),
    /differs from the sealed local-CAS projection/u);
  assert.equal(pullRequestEdits, 0,
    "registry drift between precheck and marker action must perform no PR edit");
  driftOnPullRead = false;

  observedLease = target.lease;
  driftAtEditBoundary = true;
  assert.throws(() => adapter.projectPullRequest({ plan, intent }),
    /foreign registry CAS blocked by held lock/u);
  assert.equal(foreignCasAttempts, 1);
  assert.equal(pullRequestEdits, 0,
    "foreign registry CAS at the edit boundary must not yield a stale PR edit");
  driftAtEditBoundary = false;

  chmodSync(capabilityPath, 0o644);
  assert.throws(() => adapter.projectPullRequest({ plan, intent }),
    /owner-only single-link regular 0600 file/u);
  assert.equal(pullRequestEdits, 0);
  chmodSync(capabilityPath, 0o600);
  const postConstructionAlias = path.join(root, "post-construction-hardlink.json");
  linkSync(capabilityPath, postConstructionAlias);
  assert.throws(() => adapter.projectPullRequest({ plan, intent }),
    /owner-only single-link regular 0600 file/u);
  assert.equal(pullRequestEdits, 0);
});

test("rejects foreign PR identity and any historical terminal successor", () => {
  const sourceClaimId = hex("historical-source");
  const reviewRequestId = "github-pull-request:PR_source";
  assert.equal(assertTerminalHandoffPullRequestIdentity({
    pullRequest: { id: "PR_source" },
    sourceClaim: { reviewRequestId },
    cloudAuthority: { reviewRequestId },
  }), reviewRequestId);
  assert.throws(() => assertTerminalHandoffPullRequestIdentity({
    pullRequest: { id: "PR_source" },
    sourceClaim: { reviewRequestId },
    cloudAuthority: { reviewRequestId: "github-pull-request:PR_foreign" },
  }), /PR node identity/u);
  assert.deepEqual(assertNoHistoricalTerminalHandoffSuccessor({
    entries: [],
    sourceClaimId,
  }).historicalSuccessorClaimIds, []);
  assert.throws(() => assertNoHistoricalTerminalHandoffSuccessor({
    sourceClaimId,
    entries: [{ action: "claim", claimId: hex("retired-successor"),
      claimCore: { predecessorClaimId: sourceClaimId, state: "retired" } }],
  }), /historical successor/u);
});

test("joins one normalized GitHub origin and pull-request repository", () => {
  const input = {
    targetRepository: "Example/Repository",
    originFetchUrl: "https://github.com/example/repository.git",
    originPushUrl: "git@github.com:EXAMPLE/REPOSITORY.git",
    pullRequest: {
      url: "https://github.com/example/repository/pull/17",
      headRepository: { nameWithOwner: "EXAMPLE/REPOSITORY" },
      baseRepository: { nameWithOwner: "example/repository" },
      headRefName: "agent/device.local/terminal-handoff-successor",
      baseRefName: "main",
    },
    branch: "agent/device.local/terminal-handoff-successor",
  };
  const identity = assertTerminalHandoffRepositoryIdentity(input);
  assert.equal(identity.targetRepository, "example/repository");
  assert.equal(identity.originFetchRepository, identity.targetRepository);
  assert.equal(identity.originPushRepository, identity.targetRepository);
  assert.equal(identity.pullRequestRepository, identity.targetRepository);
  assert.equal(identity.headRepository, identity.targetRepository);
  assert.equal(identity.baseRepository, identity.targetRepository);
  for (const [label, mutate] of [
    ["fetch mirror", value => { value.originFetchUrl = "https://github.com/foreign/mirror.git"; }],
    ["push mirror", value => { value.originPushUrl = "git@github.com:foreign/mirror.git"; }],
    ["foreign PR", value => { value.pullRequest.url = "https://github.com/foreign/pr/pull/17"; }],
    ["foreign head", value => { value.pullRequest.headRepository.nameWithOwner = "foreign/head"; }],
    ["foreign base", value => { value.pullRequest.baseRepository.nameWithOwner = "foreign/base"; }],
    ["foreign head branch", value => { value.pullRequest.headRefName = "agent/foreign/lane"; }],
    ["foreign base branch", value => { value.pullRequest.baseRefName = "develop"; }],
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.throws(() => assertTerminalHandoffRepositoryIdentity(changed),
      /repository|branch|origin/u, label);
  }
});

test("requires an authenticated complete status and exact successor claim receipts", () => {
  const baseSha = sha("authenticated-status-base");
  const repository = { repositoryId: "repository:terminal-handoff-test",
    canonicalRevision: baseSha };
  const actor = { actorId: "actor:terminal-handoff-test", deviceId: "device.local",
    sessionId: "source-session" };
  const initial = createEmptyLedger("ledger:terminal-handoff-test");
  const transition = applyCloudTransition({
    ledger: initial,
    action: "claim",
    actor,
    repository,
    evaluationTime: "2026-08-25T00:00:00.000Z",
    request: {
      workItemId: "work:terminal-handoff-test",
      canonicalBaseRevision: baseSha,
      laneRevision: sha("authenticated-status-lane"),
      declaredWriteScope: ["path:docs/terminal.md"],
      leaseEpoch: 1,
      expiresAt: "2030-08-25T00:30:00.000Z",
      expectedLedgerDigest: initial.headDigest,
      idempotencyKey: "terminal-handoff-status-fixture",
    },
  });
  const ledgerRevision = sha("authenticated-ledger-revision");
  const status = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision,
    ledgerDigest: transition.ledger.headDigest,
    sequence: transition.ledger.sequence,
    claims: [projectPublicClaim(transition.claim)],
  };
  const snapshot = { ledger: transition.ledger, ledgerRevision };
  assert.equal(assertTerminalHandoffCloudStatusSnapshot({
    result: status,
    snapshot,
    sourceClaimId: transition.claim.claimId,
  }), status);
  assert.equal(assertTerminalHandoffAuthenticatedOperation({
    action: "claim",
    snapshot,
    inventory: status,
    claim: status.claims[0],
    operationKey: "terminal-handoff-status-fixture",
  }).action, "claim");
  assert.throws(() => assertTerminalHandoffAuthenticatedOperation({
    action: "claim",
    snapshot,
    inventory: status,
    claim: status.claims[0],
    operationKey: "semantically-identical-foreign-claim-operation",
  }), /exact authenticated recovery operation/u);

  const bindOperationKey = "terminal-handoff-bind-operation";
  const bound = applyCloudTransition({
    ledger: transition.ledger,
    action: "continue",
    actor,
    repository,
    evaluationTime: "2026-08-25T00:10:00.000Z",
    request: {
      claimId: transition.claim.claimId,
      expectedFenceRevision: transition.claim.fenceRevision,
      expectedTransitionCounter: transition.claim.transitionCounter,
      expectedLedgerDigest: transition.ledger.headDigest,
      mode: "projection",
      laneRevision: transition.claim.laneRevision,
      reviewRequestId: "github-pull-request:PR_operation_bound",
      idempotencyKey: bindOperationKey,
    },
  });
  const boundRevision = sha("authenticated-bound-ledger-revision");
  const boundStatus = { ...status,
    ledgerRevision: boundRevision,
    ledgerDigest: bound.ledger.headDigest,
    sequence: bound.ledger.sequence,
    claims: [projectPublicClaim(bound.claim)] };
  const boundSnapshot = { ledger: bound.ledger, ledgerRevision: boundRevision };
  assert.equal(assertTerminalHandoffAuthenticatedOperation({
    action: "continue",
    snapshot: boundSnapshot,
    inventory: boundStatus,
    claim: boundStatus.claims[0],
    operationKey: bindOperationKey,
  }).action, "continue");
  assert.throws(() => assertTerminalHandoffAuthenticatedOperation({
    action: "continue",
    snapshot: boundSnapshot,
    inventory: boundStatus,
    claim: boundStatus.claims[0],
    operationKey: "semantically-identical-foreign-bind-operation",
  }), /exact authenticated recovery operation/u);
  for (const mutate of [
    value => { value.status = "partial"; },
    value => { value.ledgerRevision = sha("foreign-ledger-revision"); },
    value => { value.claims = []; },
    value => { value.claims[0].workItemId = "work:foreign"; },
  ]) {
    const changed = structuredClone(status);
    mutate(changed);
    assert.throws(() => assertTerminalHandoffCloudStatusSnapshot({
      result: changed,
      snapshot,
      sourceClaimId: transition.claim.claimId,
    }), /complete claim inventory|authenticated ledger|authenticated repository inventory|authenticated ledger entry/u);
  }

  const successor = successorClaimResultFixture();
  assert.equal(assertTerminalHandoffSuccessorClaimResult(successor), successor.result.claim);
  for (const mutate of [
    value => { value.claim.repositoryId = "repository:foreign"; },
    value => { value.claim.canonicalBaseRevision = sha("foreign-base"); },
    value => { value.claim.declaredWriteScope = ["path:docs/foreign.md"]; },
    value => { value.claim.deviceId = "foreign.device"; },
    value => { value.claim.sessionId = "foreign-session"; },
    value => { value.claim.reviewRequestId = "github-pull-request:PR_foreign"; },
    value => { value.receipt.contractReceiptDigest = hex("foreign-contract-receipt"); },
  ]) {
    const changed = structuredClone(successor.result);
    mutate(changed);
    assert.throws(() => assertTerminalHandoffSuccessorClaimResult({
      ...successor,
      result: changed,
    }), /exact current successor|sealed identity|sealed claim mutation/u);
  }
});

test("rejects foreign claim and bind operation keys during adapter reconciliation", async t => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "terminal-handoff-operation-key-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryPath = path.join(root, "repository");
  mkdirSync(path.join(repositoryPath, ".git"), { recursive: true, mode: 0o700 });
  const capabilityPath = path.join(root, "successor-capability.json");
  writeTaskAuthorityCapability({ outputPath: capabilityPath, generation: 2 });
  const fixture = terminalOperationLedgerFixture();
  const branch = "agent/device.local/terminal-operation-bound";
  const pullRequestUrl = "https://github.com/example/repository/pull/23";
  const repositoryIdentity = assertTerminalHandoffRepositoryIdentity({
    targetRepository: "example/repository",
    originFetchUrl: "https://github.com/example/repository.git",
    originPushUrl: "git@github.com:example/repository.git",
    pullRequest: { url: pullRequestUrl,
      headRepository: { nameWithOwner: "example/repository" },
      headRefName: branch, baseRefName: "main" },
    branch,
  });
  const source = fixture.sourceProjected.claim;
  const sourceLease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    branch,
    device: fixture.successorActor.deviceId,
    pullRequestUrl,
    cloudAuthority: {
      claimId: source.claimId,
      claimDigest: source.fenceRevision,
      ledgerRepository: "example/collaboration-ledger",
      targetRepository: "example/repository",
      canonicalBaseSha: source.canonicalBaseRevision,
      laneRevision: source.laneRevision,
      writeSetDigest: source.writeSetDigest,
      reviewRequestId: source.reviewRequestId,
      leaseEpoch: source.leaseEpoch,
    },
  };
  const pullRequest = {
    id: "PR_operation_bound",
    url: pullRequestUrl,
    number: 23,
    repository: repositoryIdentity.pullRequestRepository,
    headRepository: repositoryIdentity.headRepository,
    baseRepository: repositoryIdentity.baseRepository,
    headBranch: repositoryIdentity.headRefName,
    baseBranch: repositoryIdentity.baseRefName,
  };
  const sourceClaim = {
    claimId: source.claimId,
    actorId: source.actorId,
    repositoryId: source.repositoryId,
    workItemId: source.workItemId,
    canonicalBaseRevision: source.canonicalBaseRevision,
    laneRevision: source.laneRevision,
    declaredWriteScope: source.declaredWriteScope,
    writeSetDigest: source.writeSetDigest,
    reviewRequestId: source.reviewRequestId,
  };
  const plan = {
    operation: "terminal-handoff-owned-dirt-successor-recovery",
    sourceClaimId: source.claimId,
    targetLeaseEpoch: 2,
    operatorSessionId: fixture.successorActor.sessionId,
    ttlSeconds: 1800,
    evidence: { branch, lease: sourceLease, sourceClaim, pullRequest, repositoryIdentity },
  };
  let active = fixture.successor;
  let statusReads = 0;
  const ledgerRevision = sha("operation-bound-ledger-revision");
  const blobSha = sha("operation-bound-ledger-blob");
  const adapter = createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter({
    repository: repositoryPath,
    taskAuthorityFile: capabilityPath,
  }, {
    gitText: args => {
      if (args[0] === "branch") return branch;
      if (args[0] === "rev-parse") return ".git";
      if (args[0] === "worktree") {
        return `worktree ${repositoryPath}\0HEAD ${source.laneRevision}\0branch refs/heads/${branch}\0`;
      }
      if (args.join(" ") === "remote get-url --all origin") {
        return "https://github.com/example/repository.git";
      }
      if (args.join(" ") === "remote get-url --push --all origin") {
        return "git@github.com:example/repository.git";
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
    invoke: input => {
      assert.equal(input.action, "status", "reconciliation must remain read-only");
      statusReads += 1;
      return { schema: "agentic-cloud-collaboration-result/v1", ok: true,
        action: "status", status: "ready", ledgerRevision,
        ledgerDigest: active.ledger.headDigest, sequence: active.ledger.sequence,
        claims: [projectPublicClaim(active.claim)] };
    },
    ghJson: args => {
      const endpoint = args.at(-1);
      if (endpoint.includes("/git/ref/heads/")) return { object: { sha: ledgerRevision } };
      if (endpoint.includes("/contents/")) return { sha: blobSha };
      if (endpoint.includes("/git/blobs/")) return { encoding: "base64",
        content: Buffer.from(JSON.stringify(active.ledger)).toString("base64") };
      throw new Error(`Unexpected gh JSON command: ${args.join(" ")}`);
    },
  });
  assert.equal(await adapter.reconcile({ plan, intent: { receipts: {} },
    phase: "successor-claimed",
    operationKey: "foreign-claim-operation" }), null);
  assert.ok(statusReads > 0);
  const claimed = await adapter.reconcile({ plan, intent: { receipts: {} },
    phase: "successor-claimed",
    operationKey: fixture.claimOperationKey });
  assert.equal(claimed?.claimId, fixture.successor.claim.claimId);

  active = fixture.bound;
  const intent = { receipts: { "successor-claimed": { values: claimed } } };
  assert.equal(await adapter.reconcile({ plan, intent,
    phase: "successor-bound",
    operationKey: "foreign-bind-operation" }), null);
});

test("rejects a capability in repository storage or with multiple hard links", t => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "terminal-handoff-capability-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const sibling = path.join(root, "sibling-worktree");
  const common = path.join(repository, ".git");
  mkdirSync(common, { recursive: true, mode: 0o700 });
  mkdirSync(sibling, { mode: 0o700 });
  const branch = "agent/device.local/terminal-handoff-successor";
  const porcelain = [
    `worktree ${repository}\0HEAD ${sha("capability-main-head")}\0branch refs/heads/${branch}\0`,
    `worktree ${sibling}\0HEAD ${sha("capability-sibling-head")}\0branch refs/heads/agent/device.local/sibling\0`,
  ].join("");
  const gitText = args => {
    if (args[0] === "branch") return branch;
    if (args[0] === "rev-parse") return common;
    if (args[0] === "worktree") return porcelain;
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };
  for (const [label, capabilityPath] of [
    ["Git common", path.join(common, "task-authority.json")],
    ["sibling worktree", path.join(sibling, "task-authority.json")],
  ]) {
    writeTaskAuthorityCapability({ outputPath: capabilityPath, generation: 2 });
    assert.throws(() => createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter({
      repository,
      taskAuthorityFile: capabilityPath,
    }, { gitText }), /outside every linked worktree and the Git common directory/u, label);
  }
  const externalDirectory = path.join(root, "external-capability");
  const original = path.join(externalDirectory, "task-authority.json");
  const alias = path.join(root, "task-authority-hardlink.json");
  writeTaskAuthorityCapability({ outputPath: original, generation: 2 });
  linkSync(original, alias);
  assert.throws(() => createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter({
    repository,
    taskAuthorityFile: alias,
  }, { gitText }), /single-link regular 0600 file/u);
});

test("planning reads and invalid authorization do not create recovery state", async t => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "terminal-handoff-state-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  git(repository, ["init", "--initial-branch=main"]);
  const capabilityPath = path.join(root, "successor-capability.json");
  writeTaskAuthorityCapability({ outputPath: capabilityPath, generation: 2 });
  const adapter = createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter({
    repository,
    taskAuthorityFile: capabilityPath,
  });
  const stateDirectory = path.join(repository, ".git", "agentic-canvas-os",
    "terminal-handoff-owned-dirt-successor-recovery");
  assert.equal(adapter.readIntent(), null);
  assert.equal(existsSync(stateDirectory), false);
  const plan = buildRecoveryPlan({
    evidence: evidenceFixture(),
    operatorSessionId: "successor-session",
  });
  const controller = createTerminalHandoffOwnedDirtSuccessorRecoveryController(adapter);
  await assert.rejects(() => controller.run({
    plan,
    operatorSessionId: "successor-session",
    authorization: `authorize terminal-handoff-owned-dirt-successor-recovery ${hex("wrong")}`,
  }), /exact authorization/u);
  assert.equal(existsSync(stateDirectory), false);

  const intent = createRecoveryIntent(plan, plan.exactAuthorization);
  await adapter.withFence(() => adapter.writeIntent({ expected: null, value: intent }));
  const reopened = createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter({
    repository,
    taskAuthorityFile: capabilityPath,
  });
  assert.deepEqual(reopened.readIntent(), intent,
    "renamed and parent-directory-synced journal must survive adapter reconstruction");
});

function sourceFixture() {
  const claimId = hex("source"), claimDigest = hex("source-fence"), head = sha("head");
  const authority = { claimId, claimDigest, canonicalBaseSha: sha("base"), laneRevision: head,
    writeSetDigest: hex("write-set"), reviewRequestId: "review:827", leaseEpoch: 1 };
  const lease = { fenceSha: head, cloudAuthority: authority };
  const common = { claimId, repositoryId: "repository:1", actorId: "actor:1",
    workItemId: "work-item:1", canonicalBaseRevision: authority.canonicalBaseSha,
    laneRevision: head, declaredWriteScope: ["path:src/a.ts"],
    writeSetDigest: authority.writeSetDigest, leaseEpoch: 1,
    reviewRequestId: authority.reviewRequestId };
  const sourceCore = { ...common, state: "current", transitionCounter: 2 };
  const terminalCore = { ...common, state: "retired", transitionCounter: 3,
    retirement: { reason: "handoff",
      finalRevision: head, reviewRequestId: authority.reviewRequestId,
      retiredAt: "2026-08-24T00:00:00.000Z" } };
  return { lease, entries: [
    { claimId, claimDigest, digest: hex("source-transition"), claimCore: sourceCore },
    { claimId, repositoryId: common.repositoryId, claimDigest: hex("terminal-fence"),
      digest: hex("terminal-transition"), sequence: 3,
      idempotencyKey: hex("retire-idempotency"), requestDigest: hex("retire-request"),
      evaluationTime: "2026-08-24T00:00:00.000Z",
      claimCore: terminalCore },
  ] };
}

function evidenceFixture() {
  const fixture = sourceFixture();
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "source-session", branch: "agent/device/lane", fenceSha: fixture.lease.fenceSha,
    cloudAuthority: fixture.lease.cloudAuthority };
  const core = { schema: "agentic-terminal-handoff-owned-dirt-successor-recovery-evidence/v1",
    branch: lease.branch, headSha: lease.fenceSha, treeSha: sha("tree"), lease,
    leaseDigest: hex("lease"), sourceClaim: selectTerminalHandoffClaimProof(fixture),
    dirt: {}, dirtEvidenceDigest: hex("dirt"), pullRequest: {},
    pullRequestMarkerDigest: hex("marker"), liveInventory: {},
    targetCapability: {}, targetCapabilityDigest: hex("capability") };
  return { ...core, evidenceDigest: digestValue(core) };
}

function localLeaseFixture() {
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "source-session",
    device: "device.local",
    scope: "terminal-handoff-successor",
    branch: "agent/device.local/terminal-handoff-successor",
    worktreePath: "/workspace/terminal-handoff-successor",
    baseSha: sha("local-base"),
    fenceSha: sha("local-head"),
    cloudAuthority: { claimId: hex("source-claim"),
      targetRepository: "example/repository",
      ledgerRepository: "example/collaboration-ledger" },
    heartbeatAt: "2026-08-25T00:00:00.000Z",
    expiresAt: "2026-08-25T00:30:00.000Z",
  };
}

function terminalOperationLedgerFixture() {
  const canonicalBaseRevision = sha("operation-bound-base");
  const laneRevision = sha("operation-bound-lane");
  const repository = { repositoryId: "repository:terminal-operation-bound",
    canonicalRevision: canonicalBaseRevision };
  const sourceActor = { actorId: "actor:terminal-operation-bound",
    deviceId: "device.local", sessionId: "source-session" };
  const successorActor = { ...sourceActor, sessionId: "successor-session" };
  const sourceClaimed = applyCloudTransition({
    ledger: createEmptyLedger("ledger:terminal-operation-bound"),
    action: "claim",
    actor: sourceActor,
    repository,
    evaluationTime: "2026-08-25T00:00:00.000Z",
    request: { workItemId: "work:terminal-operation-bound",
      canonicalBaseRevision, laneRevision,
      declaredWriteScope: ["path:docs/terminal.md"],
      leaseEpoch: 1, expiresAt: "2030-08-25T00:30:00.000Z",
      expectedLedgerDigest: null, idempotencyKey: "source-operation-bound-claim" },
  });
  const sourceProjected = applyCloudTransition({
    ledger: sourceClaimed.ledger,
    action: "continue",
    actor: sourceActor,
    repository,
    evaluationTime: "2026-08-25T00:05:00.000Z",
    request: { claimId: sourceClaimed.claim.claimId,
      expectedFenceRevision: sourceClaimed.claim.fenceRevision,
      expectedTransitionCounter: sourceClaimed.claim.transitionCounter,
      expectedLedgerDigest: sourceClaimed.ledger.headDigest,
      mode: "projection", laneRevision,
      reviewRequestId: "github-pull-request:PR_operation_bound",
      idempotencyKey: "source-operation-bound-project" },
  });
  const retired = applyCloudTransition({
    ledger: sourceProjected.ledger,
    action: "retire",
    actor: sourceActor,
    repository,
    evaluationTime: "2026-08-25T00:10:00.000Z",
    request: { claimId: sourceProjected.claim.claimId,
      expectedFenceRevision: sourceProjected.claim.fenceRevision,
      expectedTransitionCounter: sourceProjected.claim.transitionCounter,
      expectedLedgerDigest: sourceProjected.ledger.headDigest,
      reason: "handoff", finalRevision: laneRevision,
      reviewRequestId: sourceProjected.claim.reviewRequestId,
      bytesDigest: hex("operation-bound-bytes"),
      namedChecksDigest: hex("operation-bound-checks"),
      handoffEvidenceDigest: hex("operation-bound-handoff"),
      idempotencyKey: "source-operation-bound-retire" },
  });
  const claimOperationKey = "terminal-operation-bound-successor-claim";
  const successor = applyCloudTransition({
    ledger: retired.ledger,
    action: "claim",
    actor: successorActor,
    repository,
    evaluationTime: "2026-08-25T00:15:00.000Z",
    request: { workItemId: sourceProjected.claim.workItemId,
      canonicalBaseRevision, laneRevision,
      declaredWriteScope: sourceProjected.claim.declaredWriteScope,
      predecessorClaimId: sourceProjected.claim.claimId,
      leaseEpoch: 2, expiresAt: "2030-08-25T00:45:00.000Z",
      expectedLedgerDigest: retired.ledger.headDigest,
      idempotencyKey: claimOperationKey },
  });
  const bindOperationKey = "terminal-operation-bound-successor-bind";
  const bound = applyCloudTransition({
    ledger: successor.ledger,
    action: "continue",
    actor: successorActor,
    repository,
    evaluationTime: "2026-08-25T00:20:00.000Z",
    request: { claimId: successor.claim.claimId,
      expectedFenceRevision: successor.claim.fenceRevision,
      expectedTransitionCounter: successor.claim.transitionCounter,
      expectedLedgerDigest: successor.ledger.headDigest,
      mode: "projection", laneRevision,
      reviewRequestId: sourceProjected.claim.reviewRequestId,
      idempotencyKey: bindOperationKey },
  });
  return { sourceProjected, successorActor, successor, bound,
    claimOperationKey, bindOperationKey };
}

function successorClaimResultFixture() {
  const idempotencyKey = "terminal-handoff-successor-claim";
  const evaluationTime = "2026-08-25T00:15:00.000Z";
  const ttlSeconds = 1800;
  const sourceClaim = {
    claimId: hex("claim-result-source"),
    actorId: "actor:terminal-handoff-test",
    repositoryId: "repository:terminal-handoff-test",
    workItemId: "work:terminal-handoff-test",
    canonicalBaseRevision: sha("claim-result-base"),
    laneRevision: sha("claim-result-lane"),
    declaredWriteScope: ["path:docs/terminal.md"],
    writeSetDigest: digestValue(["path:docs/terminal.md"]),
  };
  const plan = {
    ttlSeconds,
    targetLeaseEpoch: 2,
    operatorSessionId: "successor-session",
    evidence: { sourceClaim, lease: { device: "device.local" } },
  };
  const claim = {
    claimId: hex("claim-result-successor"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    actorId: sourceClaim.actorId,
    deviceId: plan.evidence.lease.device,
    sessionId: plan.operatorSessionId,
    repositoryId: sourceClaim.repositoryId,
    workItemId: sourceClaim.workItemId,
    canonicalBaseRevision: sourceClaim.canonicalBaseRevision,
    laneRevision: sourceClaim.laneRevision,
    declaredWriteScope: sourceClaim.declaredWriteScope,
    writeSetDigest: sourceClaim.writeSetDigest,
    leaseEpoch: plan.targetLeaseEpoch,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    predecessorClaimId: sourceClaim.claimId,
    expiresAt: new Date(Date.parse(evaluationTime) + ttlSeconds * 1000).toISOString(),
    fenceRevision: hex("claim-result-fence"),
    transitionDigest: hex("claim-result-transition"),
    operationReceiptDigest: null,
    integrationReceiptDigest: null,
    integration: null,
    recovery: null,
  };
  const operationCore = {
    schema: "agentic-collaboration-claim-receipt/v1",
    operation: "claim",
    status: "current",
    repositoryId: claim.repositoryId,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    fenceRevision: claim.fenceRevision,
    ledgerRevision: claim.transitionDigest,
    ledgerSequence: 2,
    idempotencyKey: digestValue(idempotencyKey),
    requestDigest: hex("claim-result-request"),
    evaluationTime,
  };
  const operationReceipt = { ...operationCore, receiptDigest: digestValue(operationCore) };
  claim.operationReceiptDigest = operationReceipt.receiptDigest;
  const ledgerRevision = sha("claim-result-ledger-revision");
  const providerCore = {
    schema: "agentic-cloud-collaboration-github-receipt/v1",
    action: "claim",
    ledgerRevision,
    ledgerDigest: hex("claim-result-ledger-digest"),
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest: operationReceipt.receiptDigest,
    sequence: 2,
    evaluationTime,
  };
  const result = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "claim",
    status: "current",
    replayed: false,
    ledgerRevision,
    claim,
    claimDigest: claim.fenceRevision,
    operationReceipt,
    receipt: { ...providerCore, receiptDigest: digestValue(providerCore) },
  };
  return { result, plan, idempotencyKey };
}

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
