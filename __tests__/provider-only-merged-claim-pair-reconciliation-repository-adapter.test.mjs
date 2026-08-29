// Responsibility: prove repository seams, private intent CAS/fencing, and exact cloud requests.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildProviderOnlyMergedClaimPairReconciliationPlan,
  providerOnlyMergedClaimPairReconciliationOperationKey,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-contract.mjs";
import {
  buildProviderOnlyMergedClaimPairReconciliationEvidence,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-evidence.mjs";
import {
  createProviderOnlyMergedClaimPairReconciliationAdapter,
  createProviderOnlyMergedClaimPairReconciliationCloudActions,
  createProviderOnlyMergedClaimPairReconciliationIntentStore,
  providerOnlyMergedClaimPairPhaseEntry,
  readProviderOnlyMergedClaimPairEnrollment,
  readProviderOnlyMergedClaimPairLocalAbsence,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-repository-adapter.mjs";
import {
  providerOnlyEvidenceFixture,
} from "./provider-only-merged-claim-pair-reconciliation-evidence.test.mjs";

const methodNames = [
  "withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent", "observePhase",
  "retireWaiter", "recoverSource", "integrateSource", "retireSource", "verifyTerminal",
];

test("repository adapter requires and freezes every closed-sequence seam", () => {
  for (let count = 0; count < methodNames.length; count += 1) {
    const methods = Object.fromEntries(methodNames.slice(0, count).map(name => [name, () => {}]));
    assert.throws(
      () => createProviderOnlyMergedClaimPairReconciliationAdapter(methods),
      new RegExp(`requires ${methodNames[count]}\\(\\)`, "u"),
    );
  }
  const methods = Object.fromEntries(methodNames.map(name => [name, () => name]));
  const adapter = createProviderOnlyMergedClaimPairReconciliationAdapter({
    ...methods,
    ignoredEscapeHatch: () => "ignored",
  });
  assert.deepEqual(Object.keys(adapter), methodNames);
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal("ignoredEscapeHatch" in adapter, false);
});

test("intent store performs atomic private CAS and rejects journal corruption", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-intent-"));
  const statePath = path.join(root, "private", "intent.json");
  try {
    const store = createProviderOnlyMergedClaimPairReconciliationIntentStore({
      statePath,
      now: () => new Date("2026-08-29T08:00:00.000Z"),
    });
    const authorized = { status: "authorized", digest: "a".repeat(64) };
    const prepared = { status: "prepared", digest: "b".repeat(64) };
    assert.equal(store.readIntent(), null);
    assert.deepEqual(store.writeIntent({ expectedIntent: null, nextIntent: authorized }), authorized);
    assert.deepEqual(store.readIntent(), authorized);
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).updatedAt, "2026-08-29T08:00:00.000Z");

    assert.throws(() => store.writeIntent({
      expectedIntent: { status: "foreign" },
      nextIntent: prepared,
    }), /intent changed before CAS/iu);
    assert.deepEqual(store.readIntent(), authorized);
    assert.deepEqual(store.writeIntent({ expectedIntent: authorized, nextIntent: prepared }), prepared);

    const journal = JSON.parse(readFileSync(statePath, "utf8"));
    journal.intent.status = "tampered";
    writeFileSync(statePath, `${JSON.stringify(journal)}\n`);
    assert.throws(() => store.readIntent(), /journal is invalid/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("entrypoint fence fails closed on every owner and releases only its own token", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-fence-"));
  const statePath = path.join(root, "intent.json");
  try {
    const store = createProviderOnlyMergedClaimPairReconciliationIntentStore({ statePath });
    const entrypointPath = `${statePath}.entrypoint.lock`;
    writeFileSync(entrypointPath, JSON.stringify({
      pid: 2_147_483_647,
      token: "unverifiable-owner",
      subject: {},
    }));
    await assert.rejects(
      store.withEntrypointFence({}, async () => {}),
      /already fenced|manual recovery/iu,
    );
    assert.equal(JSON.parse(readFileSync(entrypointPath, "utf8")).token, "unverifiable-owner");
    rmSync(entrypointPath);

    writeFileSync(entrypointPath, "{}\n");
    await assert.rejects(
      store.withEntrypointFence({}, async () => {}),
      /already fenced|malformed|manual recovery/iu,
    );
    rmSync(entrypointPath);

    const outer = await store.withEntrypointFence({ planDigest: "a".repeat(64) }, async fence => {
      assert.match(fence.fenceDigest, /^[0-9a-f]{64}$/u);
      assert.equal(existsSync(entrypointPath), true);
      await assert.rejects(
        store.withEntrypointFence({ planDigest: "b".repeat(64) }, async () => {}),
        /already fenced/iu,
      );
      assert.equal(existsSync(entrypointPath), true);
      return "complete";
    });
    assert.equal(outer, "complete");
    assert.equal(existsSync(entrypointPath), false);

    await store.withEntrypointFence({}, async () => {
      writeFileSync(entrypointPath, JSON.stringify({
        pid: process.pid,
        token: "replacement-owner",
        subject: {},
      }));
    });
    assert.equal(JSON.parse(readFileSync(entrypointPath, "utf8")).token, "replacement-owner");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery TTL accepts only the sealed 60 through 86400 second range", () => {
  for (const ttlSeconds of [60, 86_400]) {
    assert.doesNotThrow(() => createProviderOnlyMergedClaimPairReconciliationCloudActions({
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      targetRepository: "owner/target",
      ttlSeconds,
    }));
  }
  for (const ttlSeconds of [59, 86_401]) {
    assert.throws(() => createProviderOnlyMergedClaimPairReconciliationCloudActions({
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      targetRepository: "owner/target",
      ttlSeconds,
    }), /TTL.*60.*86400|between 60 and 86400/iu);
  }
});

test("enrollment accepts exact self-checkout and keeps cross-repository pins exact", () => {
  const protectedMainSha = "1".repeat(40);
  const self = readProviderOnlyMergedClaimPairEnrollment(enrollmentFixture({
    checkout: "ref: ${{ github.sha }}",
  }), {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    liveRequiredChecks: [
      { context: "Integration Gate", appId: 15368, source: "classic", strict: true },
    ],
    protectedMainSha,
    targetRepository: "huijoohwee/agentic-canvas-os",
  });
  assert.equal(self.controllerRevision, protectedMainSha);
  assert.equal(self.workflowPath, ".github/workflows/auto-delivery.yml");
  assert.deepEqual(self.requiredCiContexts, ["Integration Gate"]);

  const pinnedRevision = "2".repeat(40);
  const crossRepository = readProviderOnlyMergedClaimPairEnrollment(enrollmentFixture({
    checkout: `repository: huijoohwee/agentic-canvas-os\n          ref: ${pinnedRevision}`,
  }), {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    protectedMainSha,
    targetRepository: "owner/target",
  });
  assert.equal(crossRepository.controllerRevision, pinnedRevision);
  assert.throws(() => readProviderOnlyMergedClaimPairEnrollment(enrollmentFixture({
    checkout: "repository: huijoohwee/agentic-canvas-os\n          ref: main",
  }), {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    protectedMainSha,
    targetRepository: "owner/target",
  }), /enrolled controller revision.*SHA|required/iu);
});

test("local absence rejects malformed leases and fatal Git probes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-local-"));
  const commonDirectory = path.join(root, ".git-common");
  const source = { claimId: "a".repeat(64), laneRevision: "1".repeat(40) };
  const waiter = { claimId: "b".repeat(64) };
  const input = {
    sourceRoot: root,
    source,
    waiter,
    headBranch: "agent/device/provider-only",
    commonDirectory,
    targetRepository: "owner/target",
  };
  try {
    const local = readProviderOnlyMergedClaimPairLocalAbsence({
      ...input,
      git: localAbsenceGit(),
    });
    assert.equal(local.originRepository, "owner/target");
    assert.equal(local.sourceBranchRefPresent, false);
    assert.equal(local.sourceRemoteTrackingRefPresent, false);
    assert.equal(local.sourceObjectPresent, false);
    assert.equal(local.matchingLeaseCount, 0);

    const leaseDirectory = path.join(commonDirectory, "agentic-canvas-os");
    mkdirSync(leaseDirectory, { recursive: true });
    writeFileSync(path.join(leaseDirectory, "writer-leases.json"), JSON.stringify({
      schema: "agentic-writer-lease-registry/v2",
      revision: 1,
      leases: [],
    }));
    assert.throws(() => readProviderOnlyMergedClaimPairLocalAbsence({
      ...input,
      git: localAbsenceGit(),
    }), /writer-lease metadata.*malformed/iu);
    rmSync(leaseDirectory, { recursive: true, force: true });

    assert.throws(() => readProviderOnlyMergedClaimPairLocalAbsence({
      ...input,
      git: localAbsenceGit({ fatalProbe: true }),
    }), /Git absence probe failed/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("phase entries require every operation-bound semantic field", () => {
  const plan = planFixture();
  const authorizationDigest = digestValue({ authorization: "exact" });
  const entries = phaseEntries(plan, authorizationDigest);
  for (const phase of [
    "waiter-retired", "source-recovered", "source-integrated", "source-retired",
  ]) {
    const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
    const context = { phase, plan, operationKey, intent: { authorizationDigest } };
    const snapshot = {
      sourceLineage: entries.sourceLineage,
      waiterLineage: entries.waiterLineage,
    };
    assert.ok(providerOnlyMergedClaimPairPhaseEntry(context, snapshot), phase);
  }

  const cases = [
    ["waiter-retired", values => { values.waiterLineage[0].claimCore.retirement.bytesDigest = "f".repeat(64); }],
    ["source-recovered", values => {
      values.sourceLineage.find(entry => entry.action === "continue").claimCore.expiresAt =
        "2026-08-29T08:30:01.000Z";
    }],
    ["source-integrated", values => {
      values.sourceLineage.find(entry => entry.action === "integrate")
        .claimCore.integration.operatorDecisionDigest = "f".repeat(64);
    }],
    ["source-retired", values => {
      values.sourceLineage.find(entry => entry.action === "retire")
        .claimCore.retirement.finalRevision = "f".repeat(40);
    }],
  ];
  for (const [phase, corrupt] of cases) {
    const changed = structuredClone(entries);
    corrupt(changed);
    const context = {
      phase,
      plan,
      operationKey: providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase),
      intent: { authorizationDigest },
    };
    assert.equal(providerOnlyMergedClaimPairPhaseEntry(context, changed), null, phase);
  }
});

test("cloud actions emit only the exact waiter-first operation-bound requests", async () => {
  const plan = planFixture(900);
  const calls = [];
  let snapshotReads = 0;
  const integrationEntry = integrationLedgerEntry(plan);
  const snapshot = {
    ledger: { entries: [] },
    ledgerDigest: plan.expectedLedgerDigest,
    source: {
      claimId: plan.sourceClaimId,
      claimDigest: plan.sourceClaimDigest,
      transitionCounter: plan.sourceTransitionCounter,
      laneRevision: plan.sourceLaneRevision,
      reviewRequestId: plan.sourceReviewRequestId,
      evidenceDigest: plan.sourceFocusedEvidenceDigest,
    },
    waiter: {
      claimId: plan.waiterClaimId,
      claimDigest: plan.waiterClaimDigest,
      transitionCounter: plan.waiterTransitionCounter,
      laneRevision: plan.sourceLaneRevision,
      reviewRequestId: null,
    },
    sourceLineage: [integrationEntry],
  };
  const actions = createProviderOnlyMergedClaimPairReconciliationCloudActions({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    ttlSeconds: 900,
    environment: {
      SAFE_VALUE: "preserved",
      AGENTIC_CLOUD_AUTHORIZATION: "must-not-leak",
      AGENTIC_DEVICE_ID: "wrong-device",
      AGENTIC_SESSION_ID: "wrong-session",
      AGENTIC_TARGET_REPOSITORY: "wrong/repository",
    },
    invokeCloudAction: async input => { calls.push(input); },
  });
  const intent = { authorizationDigest: digestValue({ authorization: "exact" }) };
  const snapshotReader = async () => { snapshotReads += 1; return snapshot; };
  const results = [];
  for (const [phase, method] of [
    ["waiter-retired", "retireWaiter"],
    ["source-recovered", "recoverSource"],
    ["source-integrated", "integrateSource"],
    ["source-retired", "retireSource"],
  ]) {
    const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
    results.push(await actions[method]({ plan, intent, operationKey, snapshot: snapshotReader }));
  }

  assert.deepEqual(results.map(result => result.operationKey), [
    "waiter-retired", "source-recovered", "source-integrated", "source-retired",
  ].map(phase => providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase)));
  assert.equal(snapshotReads, 4);
  assert.deepEqual(calls.map(call => call.action), ["retire", "continue", "integrate", "retire"]);
  assert.deepEqual(calls.map(call => call.request.claimId), [
    plan.waiterClaimId, plan.sourceClaimId, plan.sourceClaimId, plan.sourceClaimId,
  ]);
  assert.deepEqual(calls.map(call => call.request.expectedTransitionCounter), [
    plan.waiterTransitionCounter,
    plan.sourceTransitionCounter,
    plan.sourceTransitionCounter,
    plan.sourceTransitionCounter,
  ]);
  assert.equal(calls[0].request.reason, "superseded");
  assert.equal(calls[1].request.mode, "recovery");
  assert.equal(calls[1].request.ttlSeconds, 900);
  assert.equal(calls[2].request.operatorDecisionDigest, intent.authorizationDigest);
  assert.equal(calls[2].request.candidateRevision, plan.sourceLaneRevision);
  assert.equal(calls[3].request.reason, "integrated");
  assert.match(calls[3].request.integrationReceiptDigest, /^[0-9a-f]{64}$/u);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.ledgerRepository, "owner/ledger");
    assert.equal(call.request.targetRepository, "owner/target");
    assert.equal(call.request.expectedLedgerDigest, plan.expectedLedgerDigest);
    assert.equal(
      call.request.idempotencyKey,
      `provider-only-merged-claim-pair-reconciliation:${results[index].operationKey}`,
    );
    assert.equal(call.environment.SAFE_VALUE, "preserved");
    assert.equal(call.environment.AGENTIC_DEVICE_ID, plan.effectDeviceId);
    assert.equal(call.environment.AGENTIC_SESSION_ID, plan.effectSessionId);
    assert.equal("AGENTIC_CLOUD_AUTHORIZATION" in call.environment, false);
    assert.equal("AGENTIC_TARGET_REPOSITORY" in call.environment, false);
  }
});

function planFixture(recoveryTtlSeconds = 1_800) {
  const raw = providerOnlyEvidenceFixture();
  raw.recoveryTtlSeconds = recoveryTtlSeconds;
  return buildProviderOnlyMergedClaimPairReconciliationPlan(
    buildProviderOnlyMergedClaimPairReconciliationEvidence(raw),
  );
}

function integrationLedgerEntry(plan) {
  const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(
    plan,
    "source-integrated",
  );
  return {
    action: "integrate",
    repositoryId: plan.repositoryId,
    claimId: plan.sourceClaimId,
    claimDigest: digestValue({ phase: "source-integrated", kind: "claim" }),
    digest: digestValue({ phase: "source-integrated", kind: "entry" }),
    sequence: plan.expectedLedgerSequence + 3,
    idempotencyKey: digestValue(
      `provider-only-merged-claim-pair-reconciliation:${operationKey}`,
    ),
    requestDigest: digestValue({ phase: "source-integrated", kind: "request" }),
    evaluationTime: "2026-08-29T08:00:00.000Z",
    claimCore: { transitionCounter: plan.sourceTransitionCounter + 2 },
  };
}

function enrollmentFixture({ checkout }) {
  return `
env:
  PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: '["Integration Gate"]'
  PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: '[]'
  PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON: '["Integration Gate"]'
jobs:
  enroll:
    steps:
      - uses: actions/checkout@${"3".repeat(40)}
        with:
          ${checkout}
`;
}

function localAbsenceGit({ fatalProbe = false } = {}) {
  const mainSha = "2".repeat(40);
  return args => {
    const [command, ...rest] = args;
    if (command === "worktree") {
      return `worktree /clean-main\nHEAD ${mainSha}\nbranch refs/heads/main`;
    }
    if (command === "config") return "git@github.com:owner/target.git";
    if (command === "branch") return "main";
    if (command === "status") return "";
    if (command === "rev-parse") return mainSha;
    if (["show-ref", "cat-file"].includes(command)) {
      const error = new Error(fatalProbe && command === "cat-file" ? "disk failure" : "not found");
      error.status = fatalProbe && command === "cat-file" ? 128 : 1;
      throw error;
    }
    throw new Error(`Unexpected Git call: ${[command, ...rest].join(" ")}`);
  };
}

function phaseEntries(plan, authorizationDigest) {
  const operation = phase => providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
  const entry = ({ action, claimId, counter, phase, claimCore }) => ({
    action,
    repositoryId: plan.repositoryId,
    claimId,
    claimDigest: digestValue({ phase, kind: "claim" }),
    digest: digestValue({ phase, kind: "entry" }),
    sequence: plan.expectedLedgerSequence + counter,
    idempotencyKey: digestValue(
      `provider-only-merged-claim-pair-reconciliation:${operation(phase)}`,
    ),
    requestDigest: digestValue({ phase, kind: "request" }),
    evaluationTime: "2026-08-29T08:00:00.000Z",
    claimCore: { ...claimCore, transitionCounter: counter },
  });
  const waiter = entry({
    action: "retire", claimId: plan.waiterClaimId,
    counter: plan.waiterTransitionCounter + 1, phase: "waiter-retired",
    claimCore: { retirement: retirementValues(plan, { reason: plan.waiterRetirementReason }) },
  });
  const recoveredAt = "2026-08-29T08:00:00.000Z";
  const recovered = entry({
    action: "continue", claimId: plan.sourceClaimId,
    counter: plan.sourceTransitionCounter + 1, phase: "source-recovered",
    claimCore: {
      state: "reviewed", laneRevision: plan.sourceLaneRevision,
      reviewRequestId: plan.sourceReviewRequestId,
      deviceId: plan.effectDeviceId, sessionId: plan.effectSessionId,
      recovery: { evidenceDigest: operation("source-recovered"), recoveredAt },
      expiresAt: new Date(Date.parse(recoveredAt) + plan.recoveryTtlSeconds * 1_000).toISOString(),
    },
  });
  const integrated = entry({
    action: "integrate", claimId: plan.sourceClaimId,
    counter: plan.sourceTransitionCounter + 2, phase: "source-integrated",
    claimCore: {
      state: "integrated-preserved",
      integration: {
        candidateRevision: plan.sourceLaneRevision,
        reviewRequestId: plan.sourceReviewRequestId,
        focusedEvidenceDigest: plan.sourceFocusedEvidenceDigest,
        dependencyClosureDigest: plan.dependencyClosureDigest,
        namedChecksDigest: plan.namedChecksDigest,
        handoffEvidenceDigest: plan.handoffEvidenceDigest,
        operatorDecisionDigest: authorizationDigest,
        integrationIntentDigest: operation("source-integrated"),
        integratedAt: "2026-08-29T08:00:00.000Z",
      },
    },
  });
  const integrationReceiptDigest = ledgerOperationReceipt(integrated, "integrated-preserved");
  const retired = entry({
    action: "retire", claimId: plan.sourceClaimId,
    counter: plan.sourceTransitionCounter + 3, phase: "source-retired",
    claimCore: {
      retirement: retirementValues(plan, {
        reason: plan.sourceRetirementReason,
        reviewRequestId: plan.sourceReviewRequestId,
        integrationReceiptDigest,
      }),
    },
  });
  return { sourceLineage: [recovered, integrated, retired], waiterLineage: [waiter] };
}

function retirementValues(plan, {
  reason, reviewRequestId = null, integrationReceiptDigest = null,
}) {
  return {
    reason,
    finalRevision: plan.sourceLaneRevision,
    reviewRequestId,
    bytesDigest: plan.bytesDigest,
    namedChecksDigest: plan.namedChecksDigest,
    handoffEvidenceDigest: plan.handoffEvidenceDigest,
    integrationReceiptDigest,
    retiredAt: "2026-08-29T08:00:00.000Z",
  };
}

function ledgerOperationReceipt(entry, status) {
  return digestValue({
    schema: "agentic-collaboration-integration-receipt/v1",
    operation: "integrate",
    status,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  });
}
