import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCloudTransition,
  createEmptyLedger,
  digestValue,
} from "../scripts/cloud-collaboration-contract.mjs";
import {
  inspectIntegratedDeliveryTerminal,
  verifyIntegratedRetirementEvidence,
} from "../scripts/integrated-delivery-terminal-retirement.mjs";
import { verifyIntegratedDeliveryTerminalReadbacks }
  from "../scripts/post-merge-cloud-authority-controller.mjs";

const D = value => value.repeat(64);
const S = value => value.repeat(40);
const baseSha = S("b");
const headSha = S("a");
const mergeSha = S("c");
const refreshHeadSha = S("d"), refreshMainSha = S("e"), refreshTreeSha = S("f");
const branch = "agent/device/source";
const reviewRequestId = "github-pull-request:PR_node_42";
const deliveryEvidence = Object.freeze({
  dependencyClosureDigest: D("6"),
  namedChecksDigest: D("7"),
  handoffEvidenceDigest: D("8"),
  operatorDecisionDigest: D("9"),
  integrationIntentDigest: D("a"),
});

function fixture({ retired = false, reviewReady = false } = {}) {
  const integration = {
    candidateRevision: headSha,
    reviewRequestId,
    focusedEvidenceDigest: D("b"),
    ...deliveryEvidence,
    integratedAt: "2026-08-26T01:00:00.000Z",
  };
  const integrationEntry = {
    schema: "agentic-cloud-collaboration-entry/v2",
    sequence: 20,
    action: "integrate",
    repositoryId: "github-repository:R_repo",
    claimId: D("1"),
    idempotencyKey: D("2"),
    requestDigest: D("3"),
    evaluationTime: "2026-08-26T01:00:00.000Z",
    claimDigest: D("4"),
    digest: D("5"),
    claimCore: {
      claimId: D("1"),
      actorId: "github-user:1",
      deviceId: "device:one",
      sessionId: "session:one",
      repositoryId: "github-repository:R_repo",
      workItemId: "work-item:one",
      canonicalBaseRevision: baseSha,
      laneRevision: headSha,
      declaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
      writeSetDigest: D("c"),
      leaseEpoch: 1,
      transitionCounter: 7,
      heartbeatCounter: 0,
      state: "integrated-preserved",
      expiresAt: "2026-08-26T03:00:00.000Z",
      evidenceDigest: D("b"),
      reviewRequestId,
      integration,
    },
  };
  const integrationReceipt = integrationReceiptDigest(integrationEntry);
  const authority = {
    state: reviewReady ? "review_ready" : "delivery_authorized",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/source",
    claimId: D("1"),
    claimDigest: reviewReady ? D("d") : integrationEntry.claimDigest,
    claimLedgerRevision: reviewReady ? D("e") : integrationEntry.digest,
    integrationReceiptDigest: reviewReady ? null : integrationReceipt,
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    writeSetDigest: D("c"),
    cloudDeclaredWriteScope: integrationEntry.claimCore.declaredWriteScope,
    leaseEpoch: 1,
    transitionCounter: reviewReady ? 6 : 7,
    reviewRequestId,
    focusedEvidenceDigest: D("b"),
    integration: reviewReady ? null : integration,
  };
  const { integration: _integration, ...reviewedCore } = integrationEntry.claimCore;
  const reviewedEntry = {
    ...integrationEntry,
    sequence: 19,
    action: "continue",
    idempotencyKey: D("d"),
    requestDigest: D("f"),
    evaluationTime: "2026-08-26T00:50:00.000Z",
    claimDigest: D("d"),
    digest: D("e"),
    claimCore: { ...reviewedCore, state: "reviewed", transitionCounter: 6 },
  };
  const entries = reviewReady ? [reviewedEntry, integrationEntry] : [integrationEntry];
  if (retired) {
    entries.push({
      ...integrationEntry,
      sequence: 21,
      action: "retire",
        idempotencyKey: protectedPushIdempotency(),
      requestDigest: D("e"),
      evaluationTime: "2026-08-26T01:10:00.000Z",
      claimDigest: D("f"),
      digest: D("0"),
      claimCore: {
        ...integrationEntry.claimCore,
        transitionCounter: 8,
        state: "retired",
        retirement: {
          reason: "integrated",
          finalRevision: headSha,
          reviewRequestId,
          bytesDigest: protectedPushBytes(),
          namedChecksDigest: deliveryEvidence.namedChecksDigest,
          handoffEvidenceDigest: deliveryEvidence.handoffEvidenceDigest,
          integrationReceiptDigest: integrationReceipt,
          retiredAt: "2026-08-26T01:10:00.000Z",
        },
      },
    });
  }
  const ledger = { headDigest: entries.at(-1).digest, entries };
  const pullRequest = {
    number: 42,
    id: "PR_node_42",
    url: "https://github.com/owner/source/pull/42",
    state: "MERGED",
    isCrossRepository: false,
    headRefName: branch,
    headRefOid: headSha,
    baseRefName: "main",
    baseRefOid: baseSha,
    mergeCommit: { oid: mergeSha },
    mergedAt: "2026-08-26T01:05:00.000Z",
  };
  return { authority, integrationEntry, integrationReceipt, ledger, pullRequest };
}

function options(value) {
  return {
    authority: value.authority,
    branch,
    canonicalBaseSha: baseSha,
    deliveryEvidence,
    headSha,
    ledger: value.ledger,
    ledgerRevision: S("1"),
    pullRequest: value.pullRequest,
    validate: () => [],
  };
}
function protectedRefresh(mainParentSha = refreshMainSha) { return { schema: "agentic-protected-main-refresh/v1", deliveredHeadSha: headSha, refreshedHeadSha: refreshHeadSha, mainParentSha }; }
function refreshGit({ ancestry = true, topology = true, tree = true } = {}) {
  return args => {
    if (args[0] === "rev-list") return topology
      ? `${refreshHeadSha} ${headSha} ${refreshMainSha}` : `${refreshHeadSha} ${headSha}`;
    if (args[0] === "merge-base") { if (!ancestry) throw new Error(
      "refresh main parent is not protected-main ancestry"); return ""; }
    if (args[0] === "merge-tree") return refreshTreeSha;
    if (args[0] === "rev-parse") return tree ? refreshTreeSha : S("0");
    return assert.fail(`unexpected Git proof command: ${args.join(" ")}`);
  };
}
test("builds one stable exact integrated-retirement request", () => {
  const value = fixture();
  const first = inspectIntegratedDeliveryTerminal(options(value));
  const changedLedger = { ...value.ledger, headDigest: D("f") };
  const second = inspectIntegratedDeliveryTerminal({ ...options(value), ledger: changedLedger });
  assert.equal(first.state, "pending");
  assert.equal(first.request.reason, "integrated");
  assert.equal(first.request.claimId, value.authority.claimId);
  assert.equal(first.request.integrationReceiptDigest, value.integrationReceipt);
  assert.equal(first.request.pullRequestNumber, 42);
  assert.equal(first.run.runDigest, second.run.runDigest);
  assert.equal(first.request.idempotencyKey, second.request.idempotencyKey);
  assert.notEqual(first.request.expectedLedgerDigest, second.request.expectedLedgerDigest);
});
test("accepts one exact terminal integrated retirement", () => {
  const value = fixture({ retired: true });
  const result = verifyIntegratedRetirementEvidence(options(value));
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.pullRequestNodeId, "PR_node_42");
  assert.equal(result.integrationReceiptDigest, value.integrationReceipt);
});
test("accepts review-ready integration response loss with exact delivery evidence", () => {
  const value = fixture({ reviewReady: true });
  const result = inspectIntegratedDeliveryTerminal(options(value));
  assert.equal(result.state, "pending");
  assert.equal(result.integrationReceiptDigest, value.integrationReceipt);
});
test("uses the latest exact integrated-preserved renewal fence", () => {
  const value = fixture();
  const integrated = value.ledger.entries[0];
  const renewedCore = {
    ...integrated.claimCore,
    transitionCounter: 8,
    heartbeatCounter: 1,
    expiresAt: "2026-08-26T04:00:00.000Z",
  };
  const renewal = {
    ...integrated,
    sequence: 21,
    action: "continue",
    idempotencyKey: D("d"),
    requestDigest: D("e"),
    evaluationTime: "2026-08-26T02:00:00.000Z",
    claimCore: renewedCore,
    claimDigest: D("f"),
    digest: D("0"),
  };
  value.ledger.entries.push(renewal);
  value.ledger.headDigest = renewal.digest;
  value.authority.claimDigest = renewal.claimDigest;
  value.authority.claimLedgerRevision = renewal.digest;
  value.authority.transitionCounter = renewal.claimCore.transitionCounter;
  const result = inspectIntegratedDeliveryTerminal(options(value));
  assert.equal(result.request.expectedTransitionCounter, 8);
  assert.equal(result.request.expectedFenceRevision, renewal.claimDigest);
});
test("accepts an exact renewal followed by terminal retirement", () => {
  const value = fixture({ retired: true });
  const renewal = insertRenewal(value);
  const result = verifyIntegratedRetirementEvidence(options(value));
  assert.equal(result.status, "integrated-retired");
  assert.equal(value.ledger.entries[2].claimCore.transitionCounter, 9);
  assert.equal(value.ledger.entries[2].claimCore.expiresAt, renewal.claimCore.expiresAt);
});
test("rejects identity drift and non-continuations after integration", () => {
  const identityDrift = fixture({ retired: true });
  insertRenewal(identityDrift, { laneRevision: S("f") });
  assert.throws(
    () => verifyIntegratedRetirementEvidence(options(identityDrift)),
    /invalid renewal transition/u,
  );
  const wrongAction = fixture({ retired: true });
  const renewal = insertRenewal(wrongAction);
  renewal.action = "review";
  assert.throws(
    () => verifyIntegratedRetirementEvidence(options(wrongAction)),
    /invalid renewal transition/u,
  );
});
test("binds one exact protected-main refresh receipt", () => {
  const value = fixture();
  value.pullRequest.headRefOid = refreshHeadSha;
  const protectedMainRefresh = protectedRefresh();
  const result = inspectIntegratedDeliveryTerminal({ ...options(value),
    protectedMainRefresh, gitText: refreshGit() });
  assert.equal(result.subject.mergedHeadSha, refreshHeadSha);
  assert.equal(result.run.protectedMainRefreshDigest, digestValue(protectedMainRefresh));
  assert.throws(
    () => inspectIntegratedDeliveryTerminal(options(value)),
    /lacks its exact protected-main refresh receipt/u,
  );
});
test("rejects a protected-main refresh receipt when merged and delivered heads match", () => {
  const value = fixture();
  assert.throws(
    () => inspectIntegratedDeliveryTerminal({
      ...options(value),
      protectedMainRefresh: protectedRefresh(),
      gitText: refreshGit(),
    }),
    /equals the delivered head but carries a protected-main refresh receipt/u,
  );
});
test("rejects a caller-shaped protected-main refresh receipt", () => {
  const value = fixture(); value.pullRequest.headRefOid = refreshHeadSha;
  assert.throws(() => inspectIntegratedDeliveryTerminal({ ...options(value),
    protectedMainRefresh: protectedRefresh(S("0")), gitText: refreshGit() }),
  /does not match verified Git topology/u);
});
test("rejects a protected-main refresh without merge topology", () => {
  const value = fixture(); value.pullRequest.headRefOid = refreshHeadSha;
  assert.throws(() => inspectIntegratedDeliveryTerminal({ ...options(value),
    protectedMainRefresh: protectedRefresh(), gitText: refreshGit({ topology: false }) }),
  /advanced beyond an exact protected-main refresh chain/u);
});
test("rejects a protected-main refresh with a divergent merge tree", () => {
  const value = fixture(); value.pullRequest.headRefOid = refreshHeadSha;
  assert.throws(() => inspectIntegratedDeliveryTerminal({ ...options(value),
    protectedMainRefresh: protectedRefresh(), gitText: refreshGit({ tree: false }) }),
  /tree is not equivalent/u);
});
test("rejects a protected-main refresh outside main ancestry", () => {
  const value = fixture(); value.pullRequest.headRefOid = refreshHeadSha;
  assert.throws(() => inspectIntegratedDeliveryTerminal({ ...options(value),
    protectedMainRefresh: protectedRefresh(), gitText: refreshGit({ ancestry: false }) }),
  /not protected-main ancestry/u);
});
test("rejects pull-request node drift", () => {
  const value = fixture();
  value.pullRequest.id = "PR_other";
  assert.throws(
    () => inspectIntegratedDeliveryTerminal(options(value)),
    /exact merged integration subject/u,
  );
});
test("rejects local integration-receipt drift", () => {
  const value = fixture();
  value.authority.integrationReceiptDigest = D("9");
  assert.throws(
    () => inspectIntegratedDeliveryTerminal(options(value)),
    /integration receipt does not match/u,
  );
});
test("rejects review-ready delivery-evidence and counter drift", () => {
  const projectionDrift = fixture({ reviewReady: true });
  projectionDrift.authority.claimDigest = D("0");
  assert.throws(
    () => inspectIntegratedDeliveryTerminal(options(projectionDrift)),
    /no exact local authority projection entry/u,
  );
  const evidenceDrift = fixture({ reviewReady: true });
  assert.throws(() => inspectIntegratedDeliveryTerminal({
    ...options(evidenceDrift),
    deliveryEvidence: { ...deliveryEvidence, integrationIntentDigest: D("f") },
  }), /does not match local review-ready delivery evidence/u);
  const counterDrift = fixture({ reviewReady: true });
  counterDrift.ledger.entries[0].claimCore.transitionCounter += 1;
  assert.throws(
    () => inspectIntegratedDeliveryTerminal(options(counterDrift)),
    /no exact local authority projection entry/u,
  );
});
test("rejects terminal integration-receipt drift", () => {
  const value = fixture({ retired: true });
  value.ledger.entries[1].claimCore.retirement.integrationReceiptDigest = D("f");
  assert.throws(
    () => verifyIntegratedRetirementEvidence(options(value)),
    /not the exact integrated retirement/u,
  );
});
test("rejects a retirement that predates or is unbound to the protected merge", () => {
  const early = fixture({ retired: true });
  early.ledger.entries[1].claimCore.retirement.retiredAt = "2026-08-26T01:00:00.000Z";
  assert.throws(
    () => verifyIntegratedRetirementEvidence(options(early)),
    /not bound to the exact post-merge run/u,
  );
  const foreign = fixture({ retired: true });
  foreign.ledger.entries[1].idempotencyKey = D("9");
  foreign.ledger.entries[1].claimCore.retirement.bytesDigest = D("8");
  assert.throws(
    () => verifyIntegratedRetirementEvidence(options(foreign)),
    /not bound to the exact post-merge run/u,
  );
});
test("double readback accepts unrelated ledger advancement", () => {
  const value = fixture({ retired: true });
  const inspected = inspectIntegratedDeliveryTerminal(options(value));
  const later = structuredClone(value.ledger);
  later.entries.push({ claimId: D("9"), action: "claim", digest: D("8") });
  later.headDigest = D("8");
  const receipt = verifyIntegratedDeliveryTerminalReadbacks({
    expectedRun: inspected.run,
    options: {
      authority: value.authority,
      branch,
      canonicalBaseSha: baseSha,
      deliveryEvidence,
      headSha,
      validate: () => [],
    },
    snapshots: [
      { ledger: value.ledger, ledgerRevision: S("1"), pullRequest: value.pullRequest },
      { ledger: later, ledgerRevision: S("2"), pullRequest: value.pullRequest },
    ],
  });
  assert.equal(receipt.readbacks.length, 2);
  assert.notEqual(receipt.readbacks[0].ledgerDigest, receipt.readbacks[1].ledgerDigest);
  assert.equal(
    receipt.readbacks[0].retirementEntryDigest,
    receipt.readbacks[1].retirementEntryDigest,
  );
});

test("double readback rejects terminal identity drift", () => {
  const value = fixture({ retired: true });
  const inspected = inspectIntegratedDeliveryTerminal(options(value));
  const drifted = structuredClone(value.ledger);
  drifted.entries[1].digest = D("7");
  drifted.headDigest = D("7");
  assert.throws(() => verifyIntegratedDeliveryTerminalReadbacks({
    expectedRun: inspected.run,
    options: {
      authority: value.authority,
      branch,
      canonicalBaseSha: baseSha,
      deliveryEvidence,
      headSha,
      validate: () => [],
    },
    snapshots: [
      { ledger: value.ledger, ledgerRevision: S("1"), pullRequest: value.pullRequest },
      { ledger: drifted, ledgerRevision: S("2"), pullRequest: value.pullRequest },
    ],
  }), /authoritative readbacks disagree/u);
});

test("plans and verifies a ledger produced by the real collaboration contract", () => {
  const actor = { actorId: "github-user:1", deviceId: "device:one", sessionId: "session:one" };
  const repository = { repositoryId: "github-repository:R_repo", canonicalRevision: baseSha };
  const claimed = applyCloudTransition({
    ledger: createEmptyLedger("github-repository:R_ledger"),
    action: "claim",
    actor,
    repository,
    evaluationTime: "2026-08-26T00:00:00.000Z",
    request: {
      workItemId: "work-item:terminal-retirement",
      canonicalBaseRevision: baseSha,
      declaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
      laneRevision: baseSha,
      leaseEpoch: 1,
      expiresAt: "2026-08-26T03:00:00.000Z",
      expectedLedgerDigest: null,
      idempotencyKey: "claim:terminal-retirement",
    },
  });
  const projected = applyCloudTransition({
    ledger: claimed.ledger,
    action: "continue",
    actor,
    repository,
    evaluationTime: "2026-08-26T00:10:00.000Z",
    request: {
      claimId: claimed.claim.claimId,
      expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: claimed.ledger.headDigest,
      mode: "projection",
      laneRevision: headSha,
      reviewRequestId,
      idempotencyKey: "project:terminal-retirement",
    },
  });
  const reviewed = applyCloudTransition({
    ledger: projected.ledger,
    action: "continue",
    actor,
    repository,
    evaluationTime: "2026-08-26T00:20:00.000Z",
    request: {
      claimId: projected.claim.claimId,
      expectedFenceRevision: projected.claim.fenceRevision,
      expectedTransitionCounter: projected.claim.transitionCounter,
      expectedLedgerDigest: projected.ledger.headDigest,
      mode: "review",
      laneRevision: headSha,
      reviewRequestId,
      focusedEvidenceDigest: D("b"),
      idempotencyKey: "review:terminal-retirement",
    },
  });
  const integrated = applyCloudTransition({
    ledger: reviewed.ledger,
    action: "integrate",
    actor,
    repository,
    evaluationTime: "2026-08-26T00:30:00.000Z",
    request: {
      claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest,
      candidateRevision: headSha,
      reviewRequestId,
      focusedEvidenceDigest: D("b"),
      ...deliveryEvidence,
      idempotencyKey: "integrate:terminal-retirement",
    },
  });
  const renewed = applyCloudTransition({
    ledger: integrated.ledger,
    action: "continue",
    actor,
    repository,
    evaluationTime: "2026-08-26T00:40:00.000Z",
    request: {
      claimId: integrated.claim.claimId,
      expectedFenceRevision: integrated.claim.fenceRevision,
      expectedTransitionCounter: integrated.claim.transitionCounter,
      expectedLedgerDigest: integrated.ledger.headDigest,
      mode: "renewal",
      expiresAt: "2026-08-26T04:00:00.000Z",
      idempotencyKey: "renew:terminal-retirement",
    },
  });
  const value = fixture();
  value.authority = {
    ...value.authority,
    claimId: renewed.claim.claimId,
    claimDigest: renewed.claim.fenceRevision,
    claimLedgerRevision: renewed.claim.ledgerRevision,
    integrationReceiptDigest: integrated.receipt.receiptDigest,
    writeSetDigest: renewed.claim.writeSetDigest,
    cloudDeclaredWriteScope: renewed.claim.declaredWriteScope,
    leaseEpoch: renewed.claim.leaseEpoch,
    transitionCounter: renewed.claim.transitionCounter,
    reviewRequestId: renewed.claim.reviewRequestId,
    focusedEvidenceDigest: renewed.claim.evidenceDigest,
    integration: renewed.claim.integration,
  };
  value.ledger = renewed.ledger;
  const pending = inspectIntegratedDeliveryTerminal({
    ...options(value),
    validate: undefined,
  });
  const retired = applyCloudTransition({
    ledger: renewed.ledger,
    action: "retire",
    actor,
    repository,
    evaluationTime: "2026-08-26T01:10:00.000Z",
    request: pending.request,
  });
  const result = verifyIntegratedRetirementEvidence({
    ...options(value),
    ledger: retired.ledger,
    validate: undefined,
  });
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.integrationReceiptDigest, integrated.receipt.receiptDigest);
});

function integrationReceiptDigest(entry) {
  const core = {
    schema: "agentic-collaboration-integration-receipt/v1",
    operation: "integrate",
    status: "integrated-preserved",
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  };
  return digestValue(core);
}

function protectedPushIdempotency() {
  return digestValue(`push-integrated-retire:${mergeSha}:${D("1")}`);
}

function protectedPushBytes() {
  return digestValue({
    schema: "agentic-cloud-integration-evidence/v1",
    repository: "owner/source",
    pullRequestNumber: 42,
    reviewRequestId,
    laneRevision: headSha,
    mergeCommitSha: mergeSha,
  });
}

function insertRenewal(value, overrides = {}) {
  const integration = value.ledger.entries[0];
  const retirement = value.ledger.entries[1];
  const renewal = {
    ...integration,
    sequence: 21,
    action: "continue",
    idempotencyKey: D("d"),
    requestDigest: D("e"),
    evaluationTime: "2026-08-26T02:00:00.000Z",
    claimDigest: D("f"),
    digest: D("0"),
    claimCore: {
      ...integration.claimCore,
      transitionCounter: 8,
      heartbeatCounter: 1,
      expiresAt: "2026-08-26T04:00:00.000Z",
      ...overrides,
    },
  };
  retirement.sequence = 22;
  retirement.claimCore = {
    ...retirement.claimCore,
    transitionCounter: 9,
    heartbeatCounter: renewal.claimCore.heartbeatCounter,
    expiresAt: renewal.claimCore.expiresAt,
  };
  value.ledger.entries.splice(1, 0, renewal);
  return renewal;
}
