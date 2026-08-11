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
} from "../scripts/reviewed-lane-source-correction-repository-adapter.mjs";
import { main } from "../scripts/reviewed-lane-source-correction.mjs";
import { updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const hex = (character, length) => character.repeat(length);
const sourceSession = "codex-source-owner-20260810";
const operatorSession = "codex-correction-operator-20260810";

function fixture({ currentBaseSha, changedWriteScope = [] } = {}) {
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
    state: "reviewed",
    actorId: "github-user:8945812",
    repositoryId: "github-repository:R_repo",
    workItemId: "work-item:" + hex("d", 64),
    canonicalBaseRevision: baseSha,
    laneRevision: headSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter,
    reviewRequestId: authority.reviewRequestId,
    fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
    deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId),
  };
  const protectedAdvanceCore = {
    schema: "agentic-reviewed-lane-protected-advance/v1",
    sourceBaseSha: baseSha,
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
      baseSha: protectedBaseSha,
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

function adapterFixture({ reconciliation = {} } = {}) {
  const source = fixture().source;
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
      log.push(`effect:${phase}`);
      return complete(phaseValues[phase]);
    };
  }
  return { adapter, log, source, getIntent: () => intent };
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
  assert.equal(fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:docs/disjoint.md"],
  }).source.protectedAdvance.disposition, "disjoint-preserved");
  assert.throws(() => fixture({
    currentBaseSha: hex("e", 40),
    changedWriteScope: ["path:scripts/source.mjs"],
  }), /identity join/);
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
  assert.equal(state.log.filter(item => item === "read-source").length, 2);
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
  const sourceLease = { ...structuredClone(lease), worktreePath: repository };
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
  const successor = {
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
  const status = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    claims: [successor],
    ledgerRevision: hex("9", 40),
    ledgerDigest: hex("7", 64),
  };
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
    cloud: () => status,
    privateClaims: async () => [successor],
  });
  const result = await adapter.activateLease({ plan });
  const projected = leaseStore.read(sourceLease.branch);
  assert.equal(result.kind, "complete");
  assert.equal(projected.status, "active");
  assert.equal(projected.reviewHeadSha, null);
  assert.equal(projected.cloudAuthority.claimId, successor.claimId);
  assert.equal(projected.cloudAuthority.reviewRequestId, null);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).revision, 13);
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
