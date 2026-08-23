import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildAdaptiveClaimRecoveryDecision,
} from "../scripts/adaptive-claim-recovery-contract.mjs";
import {
  advanceReviewedForwardChildIntent,
  authorizeReviewedForwardChild,
  buildReviewedForwardChildPlan,
  createReviewedForwardChildIntent,
} from "../scripts/reviewed-forward-child-recovery-contract.mjs";
import {
  complete,
  createReviewedForwardChildController,
  pending,
} from "../scripts/reviewed-forward-child-recovery-controller.mjs";
import {
  buildReviewedForwardChildCandidate,
  buildReviewedForwardChildEvidence,
} from "../scripts/reviewed-forward-child-recovery-evidence.mjs";
import {
  createReviewedForwardChildJournal,
  reviewedForwardChildJournalPaths,
} from "../scripts/reviewed-forward-child-recovery-journal.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const declaredWriteSet = ["path:scripts/source.mjs", "semantic:source"];
const writeSetDigest = digestValue(declaredWriteSet);

function sourceEvidence(overrides = {}) {
  const autoMergeRequest = {
    mergeMethod: "SQUASH",
    commitHeadline: "feat(source): reviewed lane",
    commitBody: "exact body",
    enabledAt: "2026-08-10T09:06:33.000Z",
    enabledByLogin: "owner",
  };
  const source = {
    repository: { fullName: "owner/repository", nodeId: "R_test" },
    actor: { id: "1", login: "owner" },
    source: {
      branch: "agent/device/source", sessionId: "source-session",
      headSha: sha("d"), remoteHeadSha: sha("d"), providerHeadSha: sha("d"),
      treeSha: sha("e"), parentShas: [sha("a"), sha("c")], clean: true,
    },
    lease: {
      status: "review_ready", epoch: 218, leaseDigest: digest("1"),
      baseSha: sha("b"), fenceSha: sha("a"), reviewHeadSha: sha("a"),
      sessionId: "source-session", device: "device", scope: "source",
      branch: "agent/device/source", manifestDigest: digest("2"),
      declaredWriteSet, writeSetDigest, focusedEvidenceDigest: digest("3"),
      pullRequestUrl: "https://github.com/owner/repository/pull/353",
    },
    claim: {
      claimId: digest("4"), claimDigest: digest("5"), transitionDigest: digest("6"),
      operationReceiptDigest: digest("7"), state: "dormant-preserved",
      writeAuthority: false, scopeReserved: true, actorId: "github-user:1",
      repositoryId: "github-repository:R_test", workItemId: "work-item:test",
      canonicalBaseSha: sha("b"), laneRevision: sha("a"), declaredWriteSet,
      writeSetDigest, leaseEpoch: 2, transitionCounter: 6,
      reviewRequestId: "github-pull-request:PR_test",
    },
    pullRequest: {
      number: 353, nodeId: "PR_test",
      url: "https://github.com/owner/repository/pull/353", state: "OPEN",
      isDraft: false, headBranch: "agent/device/source", headSha: sha("d"),
      baseBranch: "main", baseSha: sha("c"),
      headRepository: "owner/repository", baseRepository: "owner/repository",
      authorLogin: "owner", bodyDigest: digest("8"), writerMarkerDigest: digest("9"),
      autoMergeRequest, autoMergeDigest: digestValue(autoMergeRequest), mergeQueueEntry: null,
    },
    protectedMainSha: sha("f"),
    refreshChain: [{ headSha: sha("d"), treeSha: sha("e"), parentShas: [sha("a"), sha("c")] }],
  };
  return buildReviewedForwardChildEvidence({
    ...source,
    ...overrides,
    source: { ...source.source, ...overrides.source },
    lease: { ...source.lease, ...overrides.lease },
    claim: { ...source.claim, ...overrides.claim },
    pullRequest: { ...source.pullRequest, ...overrides.pullRequest },
  });
}

function childCandidate(overrides = {}) {
  return buildReviewedForwardChildCandidate({
    sourceHeadSha: sha("d"), sourceTreeSha: sha("e"), childHeadSha: sha("f"),
    childTreeSha: sha("e"), parentShas: [sha("d")],
    subject: "chore(reviewed-forward-child-recovery): resume authoring",
    ...overrides,
  });
}

function plan() {
  return buildReviewedForwardChildPlan({
    source: sourceEvidence(),
    candidate: childCandidate(),
    operatorSessionId: "operator-session",
  });
}

function adaptiveRecovery(overrides = {}) {
  const base = {
    subject: {
      repositoryId: "github-repository:R_test", workItemId: "work-item:test",
      candidateHeadSha: sha("d"), protectedMainSha: sha("f"),
    },
    claim: {
      claimId: digest("4"), state: "integrated-preserved", writeAuthority: false,
      scopeReserved: true, fenceRevision: digest("5"), transitionCounter: 6,
      heartbeatCounter: 1, heartbeatAt: "2026-08-10T09:00:30.000Z",
      expiresAt: "2026-08-10T10:00:00.000Z",
    },
    operation: {
      operationId: "provider-operation:5", state: "terminal", conclusion: "failed",
      immutable: true, candidateHeadSha: sha("d"), protectedMainSha: sha("f"),
      fenceRevision: digest("0"), generation: 5,
      heartbeatAt: "2026-08-10T09:00:00.000Z",
      terminalAt: "2026-08-10T09:01:00.000Z", terminalReceiptDigest: digest("a"),
      revokedAt: null, revocationReceiptDigest: null, evidenceDigest: digest("b"),
    },
    observation: {
      observedAt: "2026-08-10T09:02:00.000Z", latestFenceRevision: digest("5"),
      latestTransitionCounter: 6, latestHeartbeatCounter: 1,
      expectedHeartbeatSeconds: 30, missedHeartbeatTolerance: 3,
    },
  };
  return buildAdaptiveClaimRecoveryDecision({
    ...base,
    ...overrides,
    subject: { ...base.subject, ...overrides.subject },
    claim: { ...base.claim, ...overrides.claim },
    operation: { ...base.operation, ...overrides.operation },
    observation: { ...base.observation, ...overrides.observation },
  });
}

test("evidence binds refreshed source and one empty single-parent child", () => {
  const source = sourceEvidence();
  const child = childCandidate();
  assert.equal(source.source.headSha, child.parentShas[0]);
  assert.equal(source.source.treeSha, child.childTreeSha);
  assert.throws(() => childCandidate({ childTreeSha: sha("0") }), /single-parent empty forward child/u);
  assert.throws(() => childCandidate({ parentShas: [sha("d"), sha("a")] }), /single-parent/u);
});

test("evidence joins the pull-request base to the newest protected refresh", () => {
  const source = sourceEvidence({
    source: {
      headSha: sha("0"), remoteHeadSha: sha("0"), providerHeadSha: sha("0"),
      treeSha: sha("1"), parentShas: [sha("d"), sha("f")],
    },
    pullRequest: { headSha: sha("0"), baseSha: sha("f") },
    refreshChain: [
      { headSha: sha("d"), treeSha: sha("e"), parentShas: [sha("a"), sha("c")] },
      { headSha: sha("0"), treeSha: sha("1"), parentShas: [sha("d"), sha("f")] },
    ],
  });
  assert.equal(source.pullRequest.baseSha, source.refreshChain.at(-1).parentShas[1]);
  assert.throws(() => sourceEvidence({
    source: {
      headSha: sha("0"), remoteHeadSha: sha("0"), providerHeadSha: sha("0"),
      treeSha: sha("1"), parentShas: [sha("d"), sha("f")],
    },
    pullRequest: { headSha: sha("0"), baseSha: sha("c") },
    refreshChain: [
      { headSha: sha("d"), treeSha: sha("e"), parentShas: [sha("a"), sha("c")] },
      { headSha: sha("0"), treeSha: sha("1"), parentShas: [sha("d"), sha("f")] },
    ],
  }), /joined owner lane/u);
});

test("integrated-preserved source requires an exact adaptive recovery join", () => {
  const claim = {
    ...sourceEvidence().claim,
    state: "integrated-preserved",
  };
  const source = sourceEvidence({ claim, adaptiveRecovery: adaptiveRecovery() });
  assert.equal(source.claim.state, "integrated-preserved");
  assert.equal(source.adaptiveRecovery.status, "recoverable-now");
  assert.throws(() => sourceEvidence({
    claim,
    adaptiveRecovery: adaptiveRecovery({ subject: { candidateHeadSha: sha("c") } }),
  }), /adaptive recovery join/u);
});

test("plan emits one exact content-bound authorization", () => {
  const value = plan();
  assert.match(value.planDigest, /^[0-9a-f]{64}$/u);
  assert.equal(value.exactAuthorization, `authorize reviewed-forward-child-recovery ${value.planDigest}`);
  assert.equal(value.successorLeaseEpoch, 3);
  assert.throws(() => authorizeReviewedForwardChild({
    plan: value,
    authorization: `${value.exactAuthorization} `,
  }), /requires exact authorization/u);
});

test("intent rejects phase skips and protects receipt lineage", () => {
  const value = plan();
  const intent = createReviewedForwardChildIntent(value, value.exactAuthorization);
  assert.throws(() => advanceReviewedForwardChildIntent(intent, {
    status: "forward_child_created",
    values: { childHeadSha: value.childHeadSha },
  }), /cannot skip/u);
});

function operationValues(name) {
  const shared = {
    autoMergeCancellationDigest: digest("a"), successorClaimId: digest("b"),
    successorClaimDigest: digest("c"), leaseDigest: digest("d"),
    pullRequestDigest: digest("e"), verificationDigest: digest("f"),
  };
  const values = {
    auto_merge_cancelled: { autoMergeCancellationDigest: shared.autoMergeCancellationDigest },
    forward_child_created: { childHeadSha: sha("f"), candidateDigest: digest("1") },
    successor_waiting: { successorClaimId: shared.successorClaimId, state: "waiting-successor" },
    source_retired: { sourceClaimId: digest("4"), retirementDigest: digest("2") },
    successor_current: { successorClaimId: shared.successorClaimId,
      successorClaimDigest: shared.successorClaimDigest, state: "active" },
    local_ref_updated: { localHeadSha: sha("f"), localRefReceiptDigest: digest("3") },
    remote_ref_updated: { remoteHeadSha: sha("f"), remoteRefReceiptDigest: digest("4") },
    lease_activated: { leaseDigest: shared.leaseDigest },
    pr_drafted: { pullRequestDigest: shared.pullRequestDigest },
    verified: shared,
  };
  return values[name];
}

function fakeAdapter({ loseResponseAt = null } = {}) {
  let intent = null;
  const completed = new Set();
  const effects = [];
  const adapter = {
    withFence: action => action(),
    readSource: async () => sourceEvidence(),
    prepareCandidate: async () => childCandidate(),
    readIntent: async () => intent,
    writeIntent: async ({ expected, value }) => {
      assert.deepEqual(intent, expected);
      intent = value;
    },
    reconcilePhase: async ({ phase }) => completed.has(phase)
      ? complete(operationValues(phase)) : pending(),
  };
  for (const [phase, method] of Object.entries({
    auto_merge_cancelled: "cancelAutoMerge",
    forward_child_created: "createForwardChild",
    successor_waiting: "createWaitingSuccessor",
    source_retired: "retireSourceClaim",
    successor_current: "promoteSuccessor",
    local_ref_updated: "updateLocalRef",
    remote_ref_updated: "updateRemoteRef",
    lease_activated: "activateLease",
    pr_drafted: "projectDraftPullRequest",
    verified: "verifyTerminal",
  })) {
    adapter[method] = async () => {
      effects.push(phase);
      completed.add(phase);
      if (phase === loseResponseAt) throw new Error("simulated lost response");
      return complete(operationValues(phase));
    };
  }
  return { adapter, effects, getIntent: () => intent };
}

test("controller performs the protected sequence and replays terminal completion", async () => {
  const fake = fakeAdapter();
  const controller = createReviewedForwardChildController({ adapter: fake.adapter });
  const planned = await controller.plan({ operatorSessionId: "operator-session" });
  const first = await controller.run({
    operatorSessionId: "operator-session",
    authorization: planned.exactAuthorization,
  });
  assert.deepEqual(fake.effects, [
    "auto_merge_cancelled", "forward_child_created", "successor_waiting",
    "source_retired", "successor_current", "local_ref_updated", "remote_ref_updated",
    "lease_activated", "pr_drafted", "verified",
  ]);
  const second = await controller.run({
    operatorSessionId: "operator-session",
    authorization: planned.exactAuthorization,
  });
  assert.deepEqual(second, first);
  assert.equal(fake.getIntent().status, "complete");
});

test("controller adopts a response-ahead effect only through reconciliation", async () => {
  const fake = fakeAdapter({ loseResponseAt: "auto_merge_cancelled" });
  const controller = createReviewedForwardChildController({ adapter: fake.adapter });
  const planned = await controller.plan({ operatorSessionId: "operator-session" });
  const receipt = await controller.run({
    operatorSessionId: "operator-session",
    authorization: planned.exactAuthorization,
  });
  assert.equal(receipt.status, "authoring-restored");
  assert.equal(fake.effects.filter(name => name === "auto_merge_cancelled").length, 1);
});

test("journal generations preserve completed history and serialize active recovery", async () => {
  const commonDirectory = mkdtempSync(path.join(os.tmpdir(), "forward-child-journal-"));
  const branch = "agent/device/source";
  const firstOperator = "operator-session-1";
  const secondOperator = "operator-session-2";
  const firstPaths = reviewedForwardChildJournalPaths({
    commonDirectory,
    branch,
    operatorSessionId: firstOperator,
  });
  const secondPaths = reviewedForwardChildJournalPaths({
    commonDirectory,
    branch,
    operatorSessionId: secondOperator,
  });
  const completedLegacyCore = {
    schema: "agentic-reviewed-forward-child-recovery-intent/v1",
    status: "complete",
    planSnapshot: {},
    authorization: {},
    phases: {},
    completion: { status: "authoring-restored" },
  };
  const completedLegacy = {
    ...completedLegacyCore,
    intentDigest: digestValue(completedLegacyCore),
  };
  const prepared = {
    schema: "agentic-reviewed-forward-child-recovery-intent/v1",
    status: "prepared",
    completion: null,
    intentDigest: digest("b"),
  };

  try {
    mkdirSync(path.dirname(firstPaths.legacyStatePath), { recursive: true });
    const legacyBytes = `${JSON.stringify(completedLegacy)}\n`;
    writeFileSync(firstPaths.legacyStatePath, legacyBytes, { mode: 0o600 });
    const first = createReviewedForwardChildJournal({
      commonDirectory,
      branch,
      operatorSessionId: firstOperator,
    });
    const second = createReviewedForwardChildJournal({
      commonDirectory,
      branch,
      operatorSessionId: secondOperator,
    });

    await first.withFence(() => first.writeIntent({ expected: null, value: prepared }));
    assert.equal(readFileSync(firstPaths.legacyStatePath, "utf8"), legacyBytes);
    assert.notEqual(firstPaths.statePath, secondPaths.statePath);
    assert.equal(firstPaths.lockPath, secondPaths.lockPath);
    await assert.rejects(
      second.withFence(() => second.writeIntent({ expected: null, value: prepared })),
      /unfinished competing journal generation/u,
    );

    const completedCore = {
      ...prepared,
      status: "complete",
      planSnapshot: {},
      authorization: {},
      phases: {},
      completion: { status: "authoring-restored" },
    };
    const { intentDigest: _preparedDigest, ...completedWithoutDigest } = completedCore;
    const completed = {
      ...completedWithoutDigest,
      intentDigest: digestValue(completedWithoutDigest),
    };
    await first.withFence(() => first.writeIntent({ expected: prepared, value: completed }));
    await second.withFence(() => second.writeIntent({ expected: null, value: prepared }));
    assert.deepEqual(second.readIntent(), prepared);
  } finally {
    rmSync(commonDirectory, { recursive: true, force: true });
  }
});

test("malformed terminal history blocks a new journal generation", async () => {
  const commonDirectory = mkdtempSync(path.join(os.tmpdir(), "forward-child-journal-"));
  const values = {
    commonDirectory,
    branch: "agent/device/source",
    operatorSessionId: "operator-session",
  };
  const paths = reviewedForwardChildJournalPaths(values);
  try {
    mkdirSync(path.dirname(paths.legacyStatePath), { recursive: true });
    writeFileSync(paths.legacyStatePath, JSON.stringify({
      schema: "agentic-reviewed-forward-child-recovery-intent/v1",
      status: "complete",
      planSnapshot: {},
      authorization: {},
      phases: {},
      completion: { status: "authoring-restored" },
      intentDigest: "not-a-digest",
    }));
    const journal = createReviewedForwardChildJournal(values);
    await assert.rejects(
      journal.withFence(() => journal.writeIntent({ expected: null, value: {} })),
      /unfinished competing journal generation/u,
    );
    assert.equal(journal.readIntent(), null);
  } finally {
    rmSync(commonDirectory, { recursive: true, force: true });
  }
});

test("stale authorization reaches no protected effect", async () => {
  const fake = fakeAdapter();
  const controller = createReviewedForwardChildController({ adapter: fake.adapter });
  await assert.rejects(controller.run({
    operatorSessionId: "operator-session",
    authorization: `authorize reviewed-forward-child-recovery ${digest("0")}`,
  }), /requires exact authorization/u);
  assert.deepEqual(fake.effects, []);
});

test("repository publication is compare-and-swap and never force-based", () => {
  const source = readFileSync(new URL(
    "../scripts/reviewed-forward-child-recovery-repository-adapter.mjs",
    import.meta.url,
  ), "utf8");
  assert.match(source, /"update-ref", `refs\/heads\/\$\{branch\}`, plan\.childHeadSha, plan\.sourceHeadSha/u);
  assert.match(source, /"push", "origin", `refs\/heads\/\$\{branch\}:refs\/heads\/\$\{branch\}`/u);
  assert.match(source, /const prepared = rawCandidate\(plan\.source\)/u);
  assert.match(source, /headSha: plan\.source\.claim\.laneRevision/u);
  assert.match(source, /mode: "projection"/u);
  assert.match(source, /`reviewed-forward-child:bind:\$\{plan\.planDigest\}`/u);
  assert.match(source, /cloudStatus, plan\.childHeadSha\)/u);
  assert.match(source, /reason: integrated \? "integrated" : "superseded"/u);
  assert.match(source, /integrationReceiptDigest: source\.integrationReceiptDigest/u);
  assert.doesNotMatch(source, /--force|force-with-lease|reset|stash/u);
});

test("plan-only preparation does not materialize or publish the child", () => {
  const cli = readFileSync(new URL(
    "../scripts/reviewed-forward-child-recovery.mjs",
    import.meta.url,
  ), "utf8");
  assert.match(cli, /controller\.plan/u);
  assert.match(cli, /operatorSessionId,/u);
  assert.doesNotMatch(cli, /git|push|hash-object/u);
});
