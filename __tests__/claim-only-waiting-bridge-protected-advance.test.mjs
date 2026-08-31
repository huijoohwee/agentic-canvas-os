import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceWaitingBridgeJournal, bridgeRetirementRequestDigest, buildBridgeRetirementPlan,
  createWaitingBridgeJournal, startWaitingBridgeJournal, waitingBridgeOperationKey,
} from "../scripts/claim-only-waiting-bridge-reconciliation-contract.mjs";
import {
  WAITING_BRIDGE_PROTECTED_ADVANCE_PLAN_SCHEMA,
  WAITING_BRIDGE_PROTECTED_ADVANCE_RECEIPT_SCHEMA,
  authorizeWaitingBridgeProtectedAdvance,
  buildWaitingBridgeProtectedAdvancePlan,
  buildWaitingBridgeProtectedAdvanceReceipt,
  captureWaitingBridgeProtectedAdvance,
  normalizeWaitingBridgeProtectedAdvancePlan,
  normalizeWaitingBridgeProtectedAdvanceReceipt,
  requireWaitingBridgeProtectedAdvanceReceiptJoin,
} from "../scripts/claim-only-waiting-bridge-protected-advance.mjs";
import { main as waitingBridgeMain }
  from "../scripts/claim-only-waiting-bridge-reconciliation.mjs";

const D = value => digestValue(String(value));
const S = character => character.repeat(40);
const T0 = "2026-08-31T00:00:00.000Z";
const T1 = "2026-08-31T00:01:00.000Z";
const T2 = "2026-08-31T00:02:00.000Z";
const T3 = "2026-08-31T00:03:00.000Z";
const T4 = "2026-08-31T01:00:00.000Z";
const REPOSITORY = "owner/repository";
const REPOSITORY_ID = "github-repository:R_test";
const ANCHOR = D("anchor"), BRIDGE = D("bridge"), SUCCESSOR = D("successor");
const ANCHOR_SCOPE = ["path:zones/anchor"];
const BRIDGE_SCOPE = ["path:zones/anchor", "path:zones/successor"];
const SUCCESSOR_SCOPE = ["path:zones/successor"];

test("seals an exact authorized cloud-free response-loss terminal adoption", () => {
  const value = fixture();
  const proof = captureWaitingBridgeProtectedAdvance({
    journal: value.journal, currentFrame: value.frame, gitText: gitReader(value),
  });
  const plan = buildWaitingBridgeProtectedAdvancePlan({
    journal: value.journal, currentFrame: value.frame, protectedAdvance: proof,
  });
  assert.equal(plan.schema, WAITING_BRIDGE_PROTECTED_ADVANCE_PLAN_SCHEMA);
  assert.equal(plan.kind, "retirement-intent-response-loss-terminal-adoption");
  assert.equal(plan.currentFrameDigest, digestValue(plan.currentFrameSnapshot));
  assert.equal(plan.currentPreservationDigest, digestValue(value.frame.preservation));
  assert.equal(plan.terminalEntryDigest, value.frame.bridgeTerminalEntry.digest);
  assert.equal(plan.protectedAdvanceSnapshot.priorMainSha, S("a"));
  assert.equal(plan.protectedAdvanceSnapshot.currentMainSha, S("b"));
  assert.deepEqual(plan.protectedAdvanceSnapshot.changedPaths, [
    "scripts/controller-repair.mjs", "tests/controller-repair.test.mjs",
  ]);
  assert.equal(plan.cloudEffect, false);
  assert.equal(plan.providerMutation, false);
  assert.ok(plan.forbiddenEffects.includes("cloud-mutation"));
  assert.deepEqual(normalizeWaitingBridgeProtectedAdvancePlan(plan), plan);

  const authorization = authorizeWaitingBridgeProtectedAdvance({
    plan, authorization: plan.exactAuthorization,
  });
  const receipt = buildWaitingBridgeProtectedAdvanceReceipt({
    plan, authorization, currentFrame: value.frame,
    currentPreservation: value.frame.preservation,
  });
  assert.equal(receipt.schema, WAITING_BRIDGE_PROTECTED_ADVANCE_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.planSnapshot.planDigest, plan.planDigest);
  assert.equal(receipt.authorizationDigest, authorization.authorizationDigest);
  assert.equal(receipt.currentFrameDigest, digestValue(value.frame));
  assert.equal(receipt.currentPreservationDigest, digestValue(value.frame.preservation));
  assert.equal(receipt.protectedAdvanceDigest, proof.protectedAdvanceDigest);
  assert.equal(receipt.terminalEntryDigest, value.frame.bridgeTerminalEntry.digest);
  assert.equal(receipt.cloudEffect, false);
  assert.equal(receipt.providerMutation, false);
  assert.deepEqual(normalizeWaitingBridgeProtectedAdvanceReceipt(receipt, {
    plan, currentFrame: value.frame, currentPreservation: value.frame.preservation,
  }), receipt);
  assert.deepEqual(requireWaitingBridgeProtectedAdvanceReceiptJoin({
    receipt, plan, currentFrame: value.frame, currentPreservation: value.frame.preservation,
  }), receipt);
});

test("rejects rollback, overlap, checkpoint drift, and receipt join drift", () => {
  const value = fixture();
  assert.throws(() => captureWaitingBridgeProtectedAdvance({
    journal: value.journal, currentFrame: value.frame,
    gitText: gitReader(value, { ancestor: false }),
  }), /strict protected descendant/u);
  assert.throws(() => captureWaitingBridgeProtectedAdvance({
    journal: value.journal, currentFrame: value.frame,
    gitText: gitReader(value, { changedPaths: ["zones/anchor/file.mjs"] }),
  }), /write-scope overlap/u);
  assert.throws(() => captureWaitingBridgeProtectedAdvance({
    journal: value.journal, currentFrame: {
      ...value.frame, controller: {
        ...value.frame.controller, headSha: S("a"), originMainSha: S("a"), remoteMainSha: S("a"),
      }, canonical: { ...value.frame.canonical, mainSha: S("a") },
    }, gitText: gitReader(value),
  }), /strict protected descendant/u);
  const prepared = structuredClone(value.journal);
  prepared.state.phase = "prepared";
  delete prepared.state.receipts["retirement-intent"];
  const journalCore = { schema: prepared.schema, operation: prepared.operation,
    plan: prepared.plan, state: prepared.state };
  prepared.journalDigest = digestValue(journalCore);
  assert.throws(() => captureWaitingBridgeProtectedAdvance({
    journal: prepared, currentFrame: value.frame, gitText: gitReader(value),
  }), /retirement-intent checkpoint/u);

  const proof = captureWaitingBridgeProtectedAdvance({
    journal: value.journal, currentFrame: value.frame, gitText: gitReader(value),
  });
  const plan = buildWaitingBridgeProtectedAdvancePlan({
    journal: value.journal, currentFrame: value.frame, protectedAdvance: proof,
  });
  assert.throws(() => authorizeWaitingBridgeProtectedAdvance({
    plan, authorization: `${plan.exactAuthorization}-wrong`,
  }), /exact authorization/u);
  const receipt = buildWaitingBridgeProtectedAdvanceReceipt({
    plan, authorization: plan.exactAuthorization, currentFrame: value.frame,
  });
  assert.throws(() => buildWaitingBridgeProtectedAdvanceReceipt({
    plan, authorization: plan.exactAuthorization,
  }), /fresh current frame/u);
  assert.throws(() => normalizeWaitingBridgeProtectedAdvanceReceipt({
    ...receipt, terminalEntryDigest: D("forged-terminal"),
  }), /receipt seal/u);
  const driftedFrame = structuredClone(value.frame);
  driftedFrame.preservation.gitRefsDigest = D("new-refs");
  assert.throws(() => normalizeWaitingBridgeProtectedAdvanceReceipt(receipt, {
    currentFrame: driftedFrame,
  }), /current frame join/u);
});

test("CLI keeps the protected plan private and requires paired replay authority", async () => {
  const directory = mkdtempSync("/private/tmp/waiting-bridge-protected-");
  try {
    chmodSync(directory, 0o700);
    const value = fixture();
    const proof = captureWaitingBridgeProtectedAdvance({
      journal: value.journal, currentFrame: value.frame, gitText: gitReader(value),
    });
    const plan = buildWaitingBridgeProtectedAdvancePlan({
      journal: value.journal, currentFrame: value.frame, protectedAdvance: proof,
    });
    const outputPath = path.join(directory, "plan.json");
    const summary = await waitingBridgeMain([
      "plan-protected-advance",
      `--repository=${process.cwd()}`,
      `--target-repository=${REPOSITORY}`,
      `--anchor-claim-id=${ANCHOR}`,
      `--bridge-claim-id=${BRIDGE}`,
      `--successor-claim-id=${SUCCESSOR}`,
      `--state-path=${path.join(directory, "retirement.json")}`,
      `--protected-advance-output=${outputPath}`,
    ], {
      createAdapter: () => ({ planProtectedAdvance: () => plan }),
    });
    assert.deepEqual(summary, {
      operation: plan.operation,
      planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization,
      outputPath,
    });
    assert.equal(Object.hasOwn(summary, "planSnapshot"), false);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), plan);
    await assert.rejects(waitingBridgeMain([
      "run-retirement", `--protected-advance-plan=${outputPath}`,
    ]), /must be paired/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const plan = buildBridgeRetirementPlan(retirementEvidence());
  let journal = startWaitingBridgeJournal(createWaitingBridgeJournal(plan),
    plan.exactAuthorization);
  journal = advanceWaitingBridgeJournal(journal, "prepared", {
    operationKey: waitingBridgeOperationKey(plan, "prepared"),
    stableFrameDigest: D("stable-frame"),
  });
  const effectOperationKey = waitingBridgeOperationKey(plan, "bridge-retired");
  const requestDigest = bridgeRetirementRequestDigest(plan);
  const intent = {
    operationKey: waitingBridgeOperationKey(plan, "retirement-intent"),
    effectOperationKey,
    claimId: BRIDGE,
    expectedFenceRevision: plan.evidence.bridge.claimDigest,
    expectedTransitionCounter: 1,
    requestDigest,
  };
  journal = advanceWaitingBridgeJournal(journal, "retirement-intent", {
    ...intent,
    intentDigest: digestValue({
      operationKey: effectOperationKey, claimId: BRIDGE,
      expectedFenceRevision: intent.expectedFenceRevision,
      expectedTransitionCounter: 1, requestDigest,
    }),
  });
  const frame = {
    schema: "agentic-claim-only-waiting-bridge-protected-advance-frame/v1",
    ...Object.fromEntries(["repository", "anchor", "bridge", "successor", "anchorEntry",
      "bridgeEntry", "successorEntry", "anchorLineageCount", "successorLineageCount",
      "associations", "directSuccessorTopology", "topology"]
      .map(key => [key, structuredClone(plan.evidence[key])])),
    controller: {
      ...structuredClone(plan.evidence.controller), headSha: S("b"),
      originMainSha: S("b"), remoteMainSha: S("b"), runtimeDigest: D("current-runtime"),
    },
    canonical: { ...structuredClone(plan.evidence.canonical), mainSha: S("b") },
    bridgeLineageCount: plan.evidence.bridgeLineageCount + 1,
    preservation: {
      gitRefsDigest: D("current-refs"), gitWorktreesDigest: D("current-worktrees"),
      registryDigest: D("current-registry"), providerDigest: D("current-provider"),
      associationDigest: digestValue(plan.evidence.associations),
    },
    bridgeTerminalEntry: retirementEntry(plan),
  };
  return { journal, frame };
}

function gitReader(value, {
  ancestor = true,
  changedPaths = ["scripts/controller-repair.mjs", "tests/controller-repair.test.mjs"],
} = {}) {
  return args => {
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      if (!ancestor) throw new Error("not ancestor");
      return "";
    }
    if (args[0] === "merge-base") return `${S("a")}\n`;
    if (args[0] === "rev-parse") return args[1].startsWith(S("a")) ? S("c") : S("d");
    if (args[0] === "diff") return `${changedPaths.join("\0")}\0`;
    throw new Error(`Unexpected Git read: ${args.join(" ")}`);
  };
}

function retirementEvidence() {
  const anchor = claim({ claimId: ANCHOR, scope: ANCHOR_SCOPE,
    state: "dormant-preserved", recordedState: "current", reserved: true,
    predecessorClaimId: null, eligibleSince: null, expiresAt: T1,
    deviceId: "device:anchor", sessionId: "session:anchor", sequence: 1 });
  const bridge = claim({ claimId: BRIDGE, scope: BRIDGE_SCOPE,
    state: "waiting-successor", recordedState: "waiting-successor", reserved: false,
    predecessorClaimId: ANCHOR, eligibleSince: T1, expiresAt: T2,
    deviceId: "device:chain", sessionId: "session:bridge", sequence: 2 });
  const successor = claim({ claimId: SUCCESSOR, scope: SUCCESSOR_SCOPE,
    state: "waiting-successor", recordedState: "waiting-successor", reserved: false,
    predecessorClaimId: BRIDGE, eligibleSince: T2, expiresAt: T3,
    deviceId: "device:chain", sessionId: "session:successor", sequence: 3 });
  const associations = {
    anchorRegistryMatches: [{ claimId: ANCHOR, cloudClaimDigest: anchor.claim.claimDigest,
      branch: "agent/device/anchor", leaseDigest: D("lease"),
      pullRequestUrl: "https://github.com/owner/repository/pull/808" }],
    anchorPullRequestMarkerMatches: [{ claimId: ANCHOR,
      markerClaimDigest: anchor.claim.claimDigest, number: 808, nodeId: "PR_808",
      state: "OPEN", isDraft: true, headRefName: "agent/device/anchor", headRefOid: S("a"),
      baseRefName: "main", baseRefOid: S("a"), bodyDigest: D("body"), markerDigest: D("marker"),
      markerBranch: "agent/device/anchor", markerLaneRevision: S("a"), markerFenceSha: S("a") }],
    anchorRegistryBranchCollisions: [], anchorRegistryPullRequestCollisions: [],
    bridgeRegistryMatches: [], bridgePullRequestMarkerMatches: [],
    successorRegistryMatches: [], successorPullRequestMarkerMatches: [],
  };
  const direct = { bridgeDirectSuccessorClaimIds: [SUCCESSOR],
    bridgeLiveDirectSuccessorClaimIds: [SUCCESSOR], bridgeTerminalDirectSuccessors: [] };
  return {
    schema: "agentic-claim-only-waiting-bridge-retirement-evidence/v1", observedAt: T4,
    repository: { targetRepository: REPOSITORY, providerRepositoryId: "R_test",
      nameWithOwner: REPOSITORY, topLevelDigest: D("top"),
      gitCommonDirectoryDigest: D("common"), originUrlDigest: D("origin") },
    controller: { repository: REPOSITORY, providerRepositoryId: "R_test",
      nameWithOwner: REPOSITORY, branch: "main", headSha: S("a"), originMainSha: S("a"),
      remoteMainSha: S("a"), runtimeDigest: D("runtime"), clean: true, protected: true,
      protectionDigest: D("protection") },
    canonical: { targetRepository: REPOSITORY, mainSha: S("a"),
      anchorBaseContained: true, bridgeBaseContained: true, successorBaseContained: true },
    cloud: { ledgerRepository: REPOSITORY, ledgerRevision: S("b"), ledgerDigest: D("ledger"),
      sequence: 3, validatedLedgerDigest: D("validated"), inventoryDigest: D("inventory") },
    anchor: anchor.claim, bridge: bridge.claim, successor: successor.claim,
    anchorEntry: anchor.entry, bridgeEntry: bridge.entry, successorEntry: successor.entry,
    anchorLineageCount: 1, bridgeLineageCount: 1, successorLineageCount: 1,
    associations,
    preservation: { gitRefsDigest: D("refs"), gitWorktreesDigest: D("worktrees"),
      registryDigest: D("registry"), providerDigest: D("provider"),
      associationDigest: digestValue(associations) },
    topology: { anchorBridge: true, bridgeSuccessor: true, anchorSuccessor: false },
    directSuccessorTopology: direct,
    peerFrame: { reservedClaimIds: [ANCHOR], waitingClaimIds: [BRIDGE, SUCCESSOR].sort(),
      relevantClaimIds: [ANCHOR, BRIDGE, SUCCESSOR].sort(),
      predecessorConnectedClaimIds: [ANCHOR, BRIDGE, SUCCESSOR].sort(), ...direct },
  };
}

function claim({ claimId, scope, state, recordedState, reserved, predecessorClaimId,
  eligibleSince, expiresAt, deviceId, sessionId, sequence }) {
  const declaredWriteScope = [...scope].sort();
  const claimDigest = D(`claim:${claimId}`), transitionDigest = D(`entry:${claimId}`);
  const common = { actorId: "github-user:42", repositoryId: REPOSITORY_ID,
    workItemId: `work-item:${claimId}`, deviceId, sessionId, canonicalBaseRevision: S("a"),
    laneRevision: S("a"), declaredWriteScope, writeSetDigest: digestValue(declaredWriteScope),
    leaseEpoch: 1, transitionCounter: 1, heartbeatCounter: 0, expiresAt,
    reviewRequestId: null, predecessorClaimId, eligibleSince };
  return {
    claim: { claimId, claimDigest, transitionDigest, operationReceiptDigest: D(`receipt:${claimId}`),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state, recordedState,
      writeAuthority: false, scopeReserved: reserved, ...common, evidenceDigest: null,
      recovery: null, integration: null, retirement: null, handoff: null, release: null,
      canonicalDescendantProof: null },
    entry: { schema: "agentic-cloud-collaboration-entry/v2", action: "claim", sequence,
      claimId, claimDigest, digest: transitionDigest, repositoryId: REPOSITORY_ID,
      idempotencyKey: D(`key:${claimId}`), requestDigest: D(`request:${claimId}`),
      evaluationTime: [T0, T1, T2][sequence - 1], state: recordedState,
      transitionCounter: 1, heartbeatCounter: 0, recordedExpiresAt: expiresAt,
      predecessorClaimId, reviewRequestId: null, ...common },
  };
}

function retirementEntry(plan) {
  const bridge = plan.evidence.bridge;
  return {
    schema: "agentic-cloud-collaboration-entry/v2", action: "retire", sequence: 4,
    claimId: bridge.claimId, claimDigest: D(`retired:${plan.planDigest}`),
    digest: D(`retirement:${plan.planDigest}`), repositoryId: bridge.repositoryId,
    idempotencyKey: digestValue(waitingBridgeOperationKey(plan, "bridge-retired")),
    requestDigest: bridgeRetirementRequestDigest(plan), evaluationTime: T3, state: "retired",
    transitionCounter: 2, heartbeatCounter: 0, recordedExpiresAt: bridge.expiresAt,
    predecessorClaimId: ANCHOR, reviewRequestId: null,
    retirement: { reason: "superseded", finalRevision: bridge.laneRevision,
      reviewRequestId: null, bytesDigest: D("bytes"), namedChecksDigest: D("checks"),
      handoffEvidenceDigest: D("handoff"), integrationReceiptDigest: null, retiredAt: T3 },
    actorId: bridge.actorId, deviceId: bridge.deviceId, sessionId: bridge.sessionId,
    workItemId: bridge.workItemId, canonicalBaseRevision: bridge.canonicalBaseRevision,
    laneRevision: bridge.laneRevision, declaredWriteScope: bridge.declaredWriteScope,
    writeSetDigest: bridge.writeSetDigest, leaseEpoch: bridge.leaseEpoch,
    eligibleSince: bridge.eligibleSince,
  };
}
