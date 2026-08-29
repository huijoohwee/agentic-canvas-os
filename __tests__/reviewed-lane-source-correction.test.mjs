// Responsibility: Prove exact, path-free, replay-safe reviewed-to-authoring correction.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  authorizeReviewedLaneSourceCorrection,
  buildReviewedLaneSourceCorrectionPlan,
  normalizeReviewedLaneSourceCorrectionIntent,
} from "../scripts/reviewed-lane-source-correction-contract.mjs";
import {
  complete,
  createReviewedLaneSourceCorrectionController,
  pending,
} from "../scripts/reviewed-lane-source-correction-controller.mjs";
import {
  buildReviewedLaneSourceCorrectionEvidence,
  normalizeReviewedLaneSourceCorrectionEvidence,
} from "../scripts/reviewed-lane-source-correction-evidence.mjs";
import {
  createReviewedLaneSourceCorrectionRepositoryAdapter,
  sourceCorrectionCanonicalDescendantProof,
} from "../scripts/reviewed-lane-source-correction-repository-adapter.mjs";
import { main } from "../scripts/reviewed-lane-source-correction.mjs";
import { updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const hex = (character, length) => character.repeat(length);
const sourceSession = "codex-source-owner-20260810";
const operatorSession = "codex-correction-operator-20260810";

function fixture({ currentBaseSha, changedWriteScope = [], integratedReplay = false,
  recoveredReplay = false,
  integratedState = "dormant-preserved" } = {}) {
  const branch = "agent/huis-macbook-pro-3.local/source-owner";
  const headSha = hex("a", 40);
  const baseSha = hex("b", 40);
  const protectedBaseSha = currentBaseSha || baseSha;
  const declaredWriteSet = normalizeWriteSet([
    "path:scripts/source.mjs",
    "semantic:source-owner",
  ]);
  const writeSetDigest = digestValue(declaredWriteSet);
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    targetRepository: "huijoohwee/agentic-canvas-os",
    claimId: hex("1", 64),
    claimDigest: hex("2", 64),
    ledgerRevision: hex("c", 40),
    ledgerDigest: hex("3", 64),
    claimLedgerRevision: hex("4", 64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: hex("5", 64),
    mutationAuthorityEligible: true,
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: "huis-macbook-pro-3.local",
    sessionId: sourceSession,
    reviewRequestId: "github-pull-request:PR_node",
    leaseEpoch: 7,
    transitionCounter: 9,
    state: "review_ready",
    expiresAt: "2026-08-10T08:00:00.000Z",
    integrationReceiptDigest: null,
    integration: null,
    focusedEvidenceDigest: hex("6", 64),
    manifestDigest: hex("7", 64),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 41,
    sessionId: sourceSession,
    device: "huis-macbook-pro-3.local",
    scope: "source-owner",
    branch,
    worktreePath: "/Users/private/reviewed-source",
    baseSha,
    fenceSha: headSha,
    pullRequestUrl: "https://github.com/huijoohwee/agentic-canvas-os/pull/344",
    autoDelivery: false,
    runtimeRequired: false,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "source-owner",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: hex("7", 64),
      planReceiptDigest: hex("8", 64),
      admissionReceiptDigest: hex("9", 64),
      existingLaneStateDigest: hex("a", 64),
      admittedReportDigest: hex("b", 64),
      preservationReceiptDigest: hex("c", 64),
    },
    cloudAuthority: authority,
    acquiredAt: "2026-08-10T05:00:00.000Z",
    heartbeatAt: "2026-08-10T06:00:00.000Z",
    expiresAt: "2026-08-10T06:30:00.000Z",
    reviewHeadSha: headSha,
  };
  const body = updateWriterLeasePullRequestBody("Source owner\n", lease);
  const claim = {
    claimId: authority.claimId,
    state: integratedReplay ? integratedState : "reviewed",
    recordedState: integratedReplay ? "integrated-preserved" : "reviewed",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:8945812",
    repositoryId: "github-repository:R_repo",
    workItemId: "work-item:" + hex("d", 64),
    canonicalBaseRevision: baseSha,
    laneRevision: headSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter + (integratedReplay ? recoveredReplay ? 2 : 1 : 0),
    reviewRequestId: authority.reviewRequestId,
    fenceRevision: integratedReplay ? hex("d", 64) : authority.claimDigest,
    transitionDigest: integratedReplay ? hex("e", 64) : authority.claimLedgerRevision,
    operationReceiptDigest: integratedReplay
      ? recoveredReplay ? hex("0", 64) : hex("f", 64) : authority.operationReceiptDigest,
    integrationReceiptDigest: integratedReplay ? hex("f", 64) : null,
    integration: integratedReplay ? {
      candidateRevision: headSha,
      reviewRequestId: authority.reviewRequestId,
      focusedEvidenceDigest: authority.focusedEvidenceDigest,
      dependencyClosureDigest: hex("1", 64),
      namedChecksDigest: hex("2", 64),
      handoffEvidenceDigest: hex("3", 64),
      operatorDecisionDigest: hex("4", 64),
      integrationIntentDigest: hex("5", 64),
      integratedAt: "2026-08-10T06:10:00.000Z",
    } : null,
    recovery: recoveredReplay ? {
      evidenceDigest: hex("8", 64),
      recoveredAt: "2026-08-10T07:10:00.000Z",
    } : null,
    deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId),
  };
  const protectedAdvanceCore = {
    schema: "agentic-reviewed-lane-protected-advance/v2",
    sourceBaseSha: baseSha,
    pullRequestBaseSha: baseSha,
    currentBaseSha: protectedBaseSha,
    changedWriteScope,
    changedWriteScopeDigest: digestValue(changedWriteScope),
    disposition: protectedBaseSha === baseSha ? "unchanged" : "disjoint-preserved",
  };
  const source = buildReviewedLaneSourceCorrectionEvidence({
    repository: { fullName: "huijoohwee/agentic-canvas-os", nodeId: "R_repo" },
    actor: { id: "8945812", login: "huijoohwee" },
    lease,
    authority,
    claim,
    pullRequest: {
      number: 344,
      nodeId: "PR_node",
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: false,
      headBranch: branch,
      headSha,
      baseBranch: "main",
      baseSha,
      headRepository: "huijoohwee/agentic-canvas-os",
      baseRepository: "huijoohwee/agentic-canvas-os",
      authorLogin: "huijoohwee",
      body,
      autoMergeRequest: null,
      mergeQueueEntry: null,
    },
    localHeadSha: headSha,
    remoteHeadSha: headSha,
    clean: true,
    protectedAdvance: {
      ...protectedAdvanceCore,
      receiptDigest: digestValue(protectedAdvanceCore),
    },
  });
  return { source, lease, authority, claim, body };
}

function adapterFixture({ reconciliation = {}, effectFailures = {} } = {}) {
  let source = fixture().source;
  const log = [];
  let intent = null;
  const digest = character => hex(character, 64);
  const phaseValues = {
    successor_waiting: { successorClaimId: digest("d"), successorClaimDigest: digest("e") },
    source_retired: { sourceClaimId: source.claim.claimId, retirementDigest: digest("f") },
    successor_current: { successorClaimId: digest("d"), successorClaimDigest: digest("e") },
    lease_activated: { leaseDigest: digest("1"), authority: { state: "active" } },
    pr_drafted: { pullRequestDigest: digest("2"), pullRequestUrl: source.pullRequest.url },
    verified: {
      successorClaimId: digest("d"),
      successorClaimDigest: digest("e"),
      leaseDigest: digest("1"),
      pullRequestDigest: digest("2"),
      verificationDigest: digest("3"),
    },
  };
  const adapter = {
    async withFence(action) { log.push("fence"); return action(); },
    async readSource() { log.push("read-source"); return source; },
    async readIntent() { return intent; },
    async writeIntent({ expected, value }) {
      assert.deepEqual(intent, expected);
      intent = value;
      log.push(`stored:${value.status}`);
    },
    async reconcilePhase({ phase }) {
      log.push(`reconcile:${phase}`);
      return reconciliation[phase] ? complete(phaseValues[phase]) : pending();
    },
  };
  for (const [phase, method] of Object.entries({
    successor_waiting: "createWaitingSuccessor",
    source_retired: "retireSourceClaim",
    successor_current: "promoteSuccessor",
    lease_activated: "activateLease",
    pr_drafted: "projectDraftPullRequest",
    verified: "verifyTerminal",
  })) {
    adapter[method] = async () => {
      if (effectFailures[phase]) throw new Error(effectFailures[phase]);
      log.push(`effect:${phase}`);
      return complete(phaseValues[phase]);
    };
  }
  return {
    adapter,
    log,
    source,
    getIntent: () => intent,
    setSource(nextSource) { source = nextSource; },
  };
}

test("plan is exact, closed, and excludes machine paths and raw PR body", () => {
  const { source, body } = fixture();
  const plan = buildReviewedLaneSourceCorrectionPlan({ source, operatorSessionId: operatorSession });
  const serialized = JSON.stringify(plan);
  assert.equal(plan.exactAuthorization,
    `authorize reviewed-lane-source-correction ${plan.planDigest}`);
  assert.equal(serialized.includes("/Users/private"), false);
  assert.equal(serialized.includes("worktreePath"), false);
  assert.equal(serialized.includes(body), false);
  assert.equal(plan.source.pullRequest.bodyDigest, digestValue(body));
  assert.deepEqual(normalizeReviewedLaneSourceCorrectionEvidence(source), source);
  assert.throws(() => buildReviewedLaneSourceCorrectionPlan({
    source,
    operatorSessionId: sourceSession,
  }), /distinct source and operator/);
});

test("authorization is byte exact and rejects source projection drift", () => {
  const source = fixture().source;
  const plan = buildReviewedLaneSourceCorrectionPlan({ source, operatorSessionId: operatorSession });
  assert.equal(authorizeReviewedLaneSourceCorrection({
    plan,
    authorization: plan.exactAuthorization,
  }).planDigest, plan.planDigest);
  assert.throws(() => authorizeReviewedLaneSourceCorrection({
    plan,
    authorization: `${plan.exactAuthorization} `,
  }), /requires exact authorization/);
  const drift = structuredClone(source);
  drift.localHeadSha = hex("f", 40);
  drift.evidenceDigest = digestValue(Object.fromEntries(
    Object.entries(drift).filter(([key]) => key !== "evidenceDigest"),
  ));
  assert.throws(() => normalizeReviewedLaneSourceCorrectionEvidence(drift), /identity join/);
});

test("protected-main advance is accepted only when its write scope is disjoint", () => {
  const source = fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"],
  }).source;
  assert.equal(source.protectedAdvance.disposition, "disjoint-preserved");
  assert.equal(source.pullRequest.baseSha, source.protectedAdvance.sourceBaseSha);
  assert.notEqual(source.pullRequest.baseSha, source.protectedAdvance.currentBaseSha);
  assert.throws(() => fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:scripts/source.mjs"],
  }), /identity join/);
});

test("protected-main advance derives one exact canonical descendant proof", () => {
  const source = fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"],
  }).source;
  const proof = sourceCorrectionCanonicalDescendantProof({
    protectedAdvance: source.protectedAdvance,
    declaredWriteSet: source.lease.admission.declaredWriteSet,
  });
  assert.equal(proof.sourceBaseSha, source.protectedAdvance.sourceBaseSha);
  assert.equal(proof.targetBaseSha, source.protectedAdvance.currentBaseSha);
  assert.equal(proof.protectedMainSha, source.protectedAdvance.currentBaseSha);
  assert.deepEqual(proof.canonicalChangedPaths, ["docs/disjoint.md"]);
  assert.deepEqual(proof.preservedChangedPaths, ["scripts/source.mjs"]);
  assert.equal(sourceCorrectionCanonicalDescendantProof({
    protectedAdvance: fixture().source.protectedAdvance,
    declaredWriteSet: source.lease.admission.declaredWriteSet,
  }), null);
});

test("integrated response loss joins the prior local review projection exactly", () => {
  for (const state of ["integrated-preserved", "dormant-preserved"]) {
    const source = fixture({ integratedReplay: true, integratedState: state }).source;
    assert.equal(source.authority.transitionCounter + 1, source.claim.transitionCounter);
    assert.equal(source.claim.state, state);
  }
  const recovered = fixture({ integratedReplay: true, recoveredReplay: true }).source;
  assert.equal(recovered.authority.transitionCounter + 2, recovered.claim.transitionCounter);
  assert.notEqual(recovered.claim.operationReceiptDigest,
    recovered.claim.integrationReceiptDigest);
  const source = fixture({ integratedReplay: true }).source;
  const changes = {
    state: value => { value.claim.state = "reviewed"; },
    writeAuthority: value => { value.claim.writeAuthority = true; },
    scopeReserved: value => { value.claim.scopeReserved = false; },
    counter: value => { value.claim.transitionCounter += 1; },
    fence: value => { value.claim.fenceRevision = value.authority.claimDigest; },
    transition: value => { value.claim.transitionDigest = value.authority.claimLedgerRevision; },
    operationReceipt: value => { value.claim.operationReceiptDigest = hex("0", 64); },
    integrationReceipt: value => { value.claim.integrationReceiptDigest = hex("0", 64); },
    candidate: value => { value.claim.integration.candidateRevision = hex("c", 40); },
    review: value => { value.claim.integration.reviewRequestId = "github-pull-request:other"; },
    focused: value => { value.claim.integration.focusedEvidenceDigest = hex("0", 64); },
  };
  for (const [label, change] of Object.entries(changes)) {
    const drift = structuredClone(source);
    change(drift);
    drift.claim.recordDigest = digestValue(Object.fromEntries(
      Object.entries(drift.claim).filter(([key]) => key !== "recordDigest"),
    ));
    drift.evidenceDigest = digestValue(Object.fromEntries(
      Object.entries(drift).filter(([key]) => key !== "evidenceDigest"),
    ));
    assert.throws(() => normalizeReviewedLaneSourceCorrectionEvidence(drift), label);
  }
});

test("controller orders protected effects and seals one authoring receipt", async () => {
  const state = adapterFixture();
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const plan = await controller.plan({ operatorSessionId: operatorSession });
  const receipt = await controller.run({
    operatorSessionId: operatorSession,
    authorization: plan.exactAuthorization,
  });
  assert.equal(receipt.status, "authoring-restored");
  assert.equal(receipt.disposition, "same-owner-authoring-restored");
  assert.deepEqual(state.log.filter(item => item.startsWith("effect:")), [
    "effect:successor_waiting",
    "effect:source_retired",
    "effect:successor_current",
    "effect:lease_activated",
    "effect:pr_drafted",
    "effect:verified",
  ]);
  assert.equal(state.log.filter(item => item === "fence").length, 1);
  assert.equal(normalizeReviewedLaneSourceCorrectionIntent(state.getIntent()).status, "complete");
});

test("replay returns the durable receipt without repeating effects", async () => {
  const state = adapterFixture();
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const plan = await controller.plan({ operatorSessionId: operatorSession });
  const first = await controller.run({ operatorSessionId: operatorSession,
    authorization: plan.exactAuthorization });
  const effectCount = state.log.filter(item => item.startsWith("effect:")).length;
  const second = await controller.run({ operatorSessionId: operatorSession,
    authorization: plan.exactAuthorization });
  assert.deepEqual(second, first);
  assert.equal(state.log.filter(item => item.startsWith("effect:")).length, effectCount);
  assert.equal(state.log.filter(item => item === "read-source").length, 4);
});

test("completed journal can be superseded only by exact current source authorization", async () => {
  const state = adapterFixture();
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const firstPlan = await controller.plan({ operatorSessionId: operatorSession });
  const first = await controller.run({
    operatorSessionId: operatorSession,
    authorization: firstPlan.exactAuthorization,
  });
  const effectCount = state.log.filter(item => item.startsWith("effect:")).length;
  const currentSource = fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"],
  }).source;
  state.setSource(currentSource);
  const currentPlan = await controller.plan({ operatorSessionId: operatorSession });

  await assert.rejects(controller.run({
    operatorSessionId: operatorSession,
    authorization: `${currentPlan.exactAuthorization}-wrong`,
  }), /requires exact authorization/);
  assert.equal(state.log.filter(item => item.startsWith("effect:")).length, effectCount);

  const second = await controller.run({
    operatorSessionId: operatorSession,
    authorization: currentPlan.exactAuthorization,
  });
  assert.notDeepEqual(second, first);
  assert.equal(state.getIntent().planSnapshot.planDigest, currentPlan.planDigest);
  assert.equal(state.getIntent().status, "complete");
  assert.equal(state.log.filter(item => item.startsWith("effect:")).length, effectCount * 2);
});

test("pristine prepared journal can be superseded only after response-ahead absence", async () => {
  const reconciliation = {};
  const effectFailures = { successor_waiting: "stop before first effect" };
  const state = adapterFixture({ reconciliation, effectFailures });
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const firstPlan = await controller.plan({ operatorSessionId: operatorSession });
  await assert.rejects(controller.run({
    operatorSessionId: operatorSession,
    authorization: firstPlan.exactAuthorization,
  }), /stop before first effect/);
  assert.equal(state.getIntent().status, "prepared");

  const currentSource = fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"],
  }).source;
  state.setSource(currentSource);
  const currentPlan = await controller.plan({ operatorSessionId: operatorSession });
  await assert.rejects(controller.run({
    operatorSessionId: operatorSession,
    authorization: `${currentPlan.exactAuthorization}-wrong`,
  }), /requires exact authorization/);
  assert.equal(state.getIntent().planSnapshot.planDigest, firstPlan.planDigest);

  effectFailures.successor_waiting = null;
  const receipt = await controller.run({
    operatorSessionId: operatorSession,
    authorization: currentPlan.exactAuthorization,
  });
  assert.equal(receipt.status, "authoring-restored");
  assert.equal(state.getIntent().planSnapshot.planDigest, currentPlan.planDigest);
  assert.equal(state.log.includes("reconcile:successor_waiting"), true);
});

test("prepared journal with a response-ahead successor remains on its original plan", async () => {
  const reconciliation = {};
  const effectFailures = { successor_waiting: "lost first-effect response" };
  const state = adapterFixture({ reconciliation, effectFailures });
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const firstPlan = await controller.plan({ operatorSessionId: operatorSession });
  await assert.rejects(controller.run({
    operatorSessionId: operatorSession,
    authorization: firstPlan.exactAuthorization,
  }), /lost first-effect response/);
  reconciliation.successor_waiting = true;
  state.setSource(fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"],
  }).source);
  const currentPlan = await controller.plan({ operatorSessionId: operatorSession });

  await assert.rejects(controller.run({
    operatorSessionId: operatorSession,
    authorization: currentPlan.exactAuthorization,
  }), /response-ahead successor/);
  assert.equal(state.getIntent().status, "prepared");
  assert.equal(state.getIntent().planSnapshot.planDigest, firstPlan.planDigest);
});

test("response-ahead reconciliation skips the duplicate remote effect", async () => {
  const state = adapterFixture({ reconciliation: { successor_waiting: true } });
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const plan = await controller.plan({ operatorSessionId: operatorSession });
  await controller.run({ operatorSessionId: operatorSession,
    authorization: plan.exactAuthorization });
  assert.equal(state.log.includes("effect:successor_waiting"), false);
  assert.equal(state.log.includes("effect:source_retired"), true);
});

test("reviewed lease becomes active through an exact predecessor-fenced registry CAS", async t => {
  const { source, lease } = fixture();
  const plan = buildReviewedLaneSourceCorrectionPlan({ source, operatorSessionId: operatorSession });
  const root = mkdtempSync(path.join(os.tmpdir(), "reviewed-source-cas-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "worktree");
  const commonDirectory = path.join(root, "common");
  mkdirSync(repository);
  mkdirSync(commonDirectory);
  const statePath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.json");
  mkdirSync(path.dirname(statePath), { recursive: true });
  const sourceLease = {
    ...structuredClone(lease),
    worktreePath: repository,
    sourceCorrectionSuccessorTaskBindingReconciliation: {
      claimId: hex("6", 64),
      bindingDigest: hex("7", 64),
    },
  };
  const registry = {
    schema: "agentic-writer-lease-registry/v2",
    revision: 12,
    leases: { [sourceLease.branch]: sourceLease },
  };
  writeFileSync(statePath, JSON.stringify(registry));
  const leaseStore = {
    statePath,
    read(branch) { return JSON.parse(readFileSync(statePath, "utf8")).leases[branch] || null; },
    readRegistry() { return JSON.parse(readFileSync(statePath, "utf8")); },
    withRegistryLock(action) { return action(this.readRegistry()); },
  };
  let successor = {
    ...structuredClone(source.claim),
    claimId: hex("d", 64),
    state: "current",
    predecessorClaimId: source.claim.claimId,
    leaseEpoch: plan.successorLeaseEpoch,
    transitionCounter: source.claim.transitionCounter + 1,
    reviewRequestId: null,
    fenceRevision: hex("e", 64),
    transitionDigest: hex("f", 64),
    expiresAt: "2026-08-10T09:00:00.000Z",
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: hex("8", 64),
    mutationAuthorityEligible: true,
    integrationReceiptDigest: null,
    integration: null,
  };
  const status = () => ({ schema: "agentic-cloud-collaboration-result/v1",
    ok: true, action: "status", claims: [successor], ledgerRevision: hex("9", 40),
    ledgerDigest: hex("7", 64) });
  const cloudCalls = [];
  const git = args => {
    if (args[0] === "branch") return sourceLease.branch;
    if (args[0] === "worktree") {
      return `worktree ${repository}\nHEAD ${source.localHeadSha}\nbranch refs/heads/${sourceLease.branch}\n`;
    }
    if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return commonDirectory;
    throw new Error(`Unexpected git read: ${args.join(" ")}`);
  };
  const adapter = createReviewedLaneSourceCorrectionRepositoryAdapter({
    repository,
    sourceSessionId: sourceSession,
    pullRequestNumber: 344,
  }, {
    git,
    leaseStore,
    cloud(input) {
      cloudCalls.push(input);
      if (input.action === "status") return status();
      assert.equal(input.request.mode, "projection");
      assert.equal(input.request.reviewRequestId, plan.sourceReviewRequestId);
      successor = { ...successor, reviewRequestId: plan.sourceReviewRequestId,
        transitionCounter: successor.transitionCounter + 1, fenceRevision: hex("0", 64),
        transitionDigest: hex("1", 64), operationReceiptDigest: hex("2", 64) };
      return { ...status(), action: "continue", claim: successor,
        claimDigest: successor.fenceRevision };
    },
    privateClaims: async () => [successor],
  });
  const result = await adapter.activateLease({ plan });
  const projected = leaseStore.read(sourceLease.branch);
  assert.equal(result.kind, "complete");
  assert.equal(projected.status, "active");
  assert.equal(projected.fenceSha, plan.sourceHeadSha);
  assert.equal(projected.reviewHeadSha, null);
  assert.equal(projected.cloudAuthority.claimId, successor.claimId);
  assert.equal(projected.cloudAuthority.reviewRequestId, plan.sourceReviewRequestId);
  assert.equal(projected.sourceCorrectionSuccessorTaskBindingReconciliation, null);
  assert.equal(cloudCalls.filter(item => item.action === "continue").length, 1);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).revision, 13);

  assert.equal((await adapter.reconcilePhase({
    intent: {}, phase: "lease_activated", plan,
  })).kind, "complete");
  const drifted = JSON.parse(readFileSync(statePath, "utf8"));
  drifted.leases[sourceLease.branch].fenceSha = hex("f", 40);
  writeFileSync(statePath, JSON.stringify(drifted));
  assert.deepEqual(await adapter.reconcilePhase({
    intent: {}, phase: "lease_activated", plan,
  }), pending());
});

test("integrated response-loss retirement uses and replays the exact integration receipt", async t => {
  const subject = fixture({ integratedReplay: true, currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"] });
  const root = mkdtempSync(path.join(os.tmpdir(), "integrated-source-retire-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "worktree"), commonDirectory = path.join(root, "common");
  mkdirSync(repository); mkdirSync(commonDirectory);
  const lease = { ...structuredClone(subject.lease), worktreePath: repository };
  const sourceClaim = structuredClone(subject.source.claim);
  const waiting = { ...sourceClaim, claimId: hex("6", 64), state: "waiting-successor",
    recordedState: "waiting-successor", predecessorClaimId: sourceClaim.claimId,
    leaseEpoch: sourceClaim.leaseEpoch + 1, transitionCounter: 1, reviewRequestId: null,
    fenceRevision: hex("7", 64), transitionDigest: hex("8", 64),
    operationReceiptDigest: hex("9", 64), integrationReceiptDigest: null, integration: null };
  const publicSource = { ...sourceClaim, state: "integrated-preserved" };
  for (const key of ["recordedState", "deviceId", "sessionId"]) delete publicSource[key];
  let retired = false;
  let successorCreated = false;
  const claimRequests = [];
  const retireRequests = [];
  const status = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", claims: retired ? [waiting]
      : successorCreated ? [publicSource, waiting] : [publicSource],
    ledgerRevision: hex("a", 40), ledgerDigest: hex("b", 64) });
  const pull = subject.source.pullRequest;
  const gh = args => args[0] === "repo"
    ? JSON.stringify({ nameWithOwner: subject.source.repository.fullName,
      id: subject.source.repository.nodeId })
    : JSON.stringify({ data: { repository: { id: subject.source.repository.nodeId,
      nameWithOwner: subject.source.repository.fullName, pullRequest: {
        id: pull.nodeId, url: pull.url, number: pull.number, state: pull.state,
        isDraft: pull.isDraft, body: subject.body, headRefName: pull.headBranch,
        headRefOid: pull.headSha, baseRefName: pull.baseBranch, baseRefOid: pull.baseSha,
        author: { login: pull.authorLogin },
        headRepository: { nameWithOwner: pull.headRepository },
        baseRepository: { nameWithOwner: pull.baseRepository },
        autoMergeRequest: null, mergeQueueEntry: null } },
      viewer: { login: subject.source.actor.login, databaseId: Number(subject.source.actor.id) } } });
  const git = args => {
    if (args[0] === "branch") return lease.branch;
    if (args[0] === "worktree") return `worktree ${repository}\nHEAD ${subject.source.localHeadSha}\nbranch refs/heads/${lease.branch}\n`;
    if (args[0] === "status" || args[0] === "fetch") return "";
    if (args[0] === "ls-remote") return `${subject.source.localHeadSha}\trefs/heads/${lease.branch}`;
    if (args[0] === "rev-parse") return args[1] === "--git-common-dir"
      ? commonDirectory : args[1] === "FETCH_HEAD"
        ? subject.source.protectedAdvance.currentBaseSha : subject.source.localHeadSha;
    throw new Error(`Unexpected git read: ${args.join(" ")}`);
  };
  const adapter = createReviewedLaneSourceCorrectionRepositoryAdapter({ repository,
    sourceSessionId: sourceSession, pullRequestNumber: pull.number }, {
    git, gh, leaseStore: { read: () => lease },
    privateClaims: async () => successorCreated ? [sourceClaim, waiting] : [sourceClaim],
    execute(command, args) {
      if (command === "git" && args[0] === "merge-base") return "";
      if (command === "git" && args[0] === "diff") return "docs/disjoint.md\0";
      throw new Error(`Unexpected effect: ${command} ${args.join(" ")}`);
    },
    cloud(input) {
      if (input.action === "status") return status();
      if (input.action === "claim") {
        claimRequests.push(structuredClone(input.request));
        if (!successorCreated) {
          waiting.canonicalDescendantProof = structuredClone(
            input.request.canonicalDescendantProof,
          );
          successorCreated = true;
        }
        return { ...status(), action: "claim" };
      }
      retireRequests.push(input.request); retired = true;
      return { ...status(), action: "retire", operationReceipt: {
        operation: "retire", receiptDigest: hex("c", 64) } };
    },
  });
  const observed = await adapter.readSource();
  assert.equal(observed.claim.state, "integrated-preserved");
  assert.notEqual(observed.pullRequest.baseSha, observed.protectedAdvance.currentBaseSha);
  const plan = buildReviewedLaneSourceCorrectionPlan({ source: observed,
    operatorSessionId: operatorSession });
  const drifted = structuredClone(plan);
  drifted.source.claim.operationReceiptDigest = hex("0", 64);
  await assert.rejects(adapter.createWaitingSuccessor({ plan: drifted }), /source claim drift/);
  const firstSuccessor = await adapter.createWaitingSuccessor({ plan });
  const secondSuccessor = await adapter.createWaitingSuccessor({ plan });
  assert.deepEqual(secondSuccessor, firstSuccessor);
  assert.equal(claimRequests.length, 2);
  assert.deepEqual(claimRequests[1].canonicalDescendantProof,
    claimRequests[0].canonicalDescendantProof);
  assert.deepEqual(claimRequests[0].canonicalDescendantProof,
    sourceCorrectionCanonicalDescendantProof({
      protectedAdvance: plan.source.protectedAdvance,
      declaredWriteSet: plan.source.lease.admission.declaredWriteSet,
    }));
  assert.deepEqual(claimRequests[0].canonicalDescendantProof.canonicalChangedPaths,
    ["docs/disjoint.md"]);
  assert.deepEqual(claimRequests[0].canonicalDescendantProof.preservedChangedPaths,
    ["scripts/source.mjs"]);
  const exactProof = structuredClone(waiting.canonicalDescendantProof);
  waiting.canonicalDescendantProof.evidenceDigest = hex("0", 64);
  await assert.rejects(adapter.createWaitingSuccessor({ plan }),
    /successor canonical descendant proof/);
  waiting.canonicalDescendantProof = exactProof;
  const first = await adapter.retireSourceClaim({ plan });
  const second = await adapter.retireSourceClaim({ plan });
  assert.deepEqual(second, first);
  assert.equal(retireRequests.length, 2);
  for (const request of retireRequests) {
    assert.equal(request.reason, "integrated");
    assert.equal(request.integrationReceiptDigest, sourceClaim.integrationReceiptDigest);
    assert.equal(request.namedChecksDigest, sourceClaim.integration.namedChecksDigest);
    assert.equal(request.handoffEvidenceDigest, sourceClaim.integration.handoffEvidenceDigest);
  }
});

test("invalid authority stops before intent or remote effect", async () => {
  const state = adapterFixture();
  const controller = createReviewedLaneSourceCorrectionController({ adapter: state.adapter });
  const plan = await controller.plan({ operatorSessionId: operatorSession });
  await assert.rejects(controller.run({
    operatorSessionId: operatorSession,
    authorization: `${plan.exactAuthorization}-wrong`,
  }), /requires exact authorization/);
  assert.equal(state.getIntent(), null);
  assert.equal(state.log.some(item => item.startsWith("effect:")), false);
});

test("CLI preserves the exact public plan and requires run authorization", async () => {
  const state = adapterFixture();
  const argumentsList = [
    "plan",
    "--repository=/registered/source",
    `--source-session=${sourceSession}`,
    `--operator-session=${operatorSession}`,
    "--pull-request=344",
  ];
  const plan = await main(argumentsList, { createAdapter: () => state.adapter });
  assert.equal(plan.pullRequestNumber, 344);
  await assert.rejects(main([
    "run",
    ...argumentsList.slice(1),
  ], { createAdapter: () => state.adapter }), /--authorize/);
});
