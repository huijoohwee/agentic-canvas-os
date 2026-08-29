// Responsibility: prove sealed plans, exact authorization, contiguous intents, and receipts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceProviderOnlyMergedClaimPairReconciliationIntent,
  assertProviderOnlyMergedClaimPairTargetRepositoryTail,
  authorizeProviderOnlyMergedClaimPairReconciliation,
  buildProviderOnlyMergedClaimPairReconciliationPlan,
  buildProviderOnlyMergedClaimPairReconciliationReceipt,
  createProviderOnlyMergedClaimPairReconciliationIntent,
  normalizeProviderOnlyMergedClaimPairReconciliationIntent,
  normalizeProviderOnlyMergedClaimPairReconciliationPlan,
  providerOnlyMergedClaimPairReconciliationOperationKey,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-contract.mjs";
import {
  buildProviderOnlyMergedClaimPairReconciliationEvidence,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-evidence.mjs";
import {
  providerOnlyEvidenceFixture,
} from "./provider-only-merged-claim-pair-reconciliation-evidence.test.mjs";

const digest = label => digestValue({ label });
const phases = [
  "prepared", "waiter-retired", "source-recovered", "source-integrated",
  "source-retired", "verified",
];

test("builds one evidence-bound plan and rejects recomputed field drift", () => {
  const plan = planFixture();
  assert.deepEqual(normalizeProviderOnlyMergedClaimPairReconciliationPlan(plan), plan);
  assert.equal(
    plan.exactAuthorization,
    `authorize provider-only-merged-claim-pair-reconciliation ${plan.planDigest}`,
  );
  assert.deepEqual(plan.phases, [...phases, "complete"]);
  assert.equal(plan.waiterRetirementReason, "superseded");
  assert.equal(plan.sourceRetirementReason, "integrated");

  const changed = structuredClone(plan);
  changed.expectedLedgerSequence += 1;
  const { planDigest: _oldDigest, exactAuthorization: _oldAuthorization, ...changedCore } = changed;
  changed.planDigest = digestValue(changedCore);
  changed.exactAuthorization =
    `authorize provider-only-merged-claim-pair-reconciliation ${changed.planDigest}`;
  assert.throws(
    () => normalizeProviderOnlyMergedClaimPairReconciliationPlan(changed),
    /malformed|drifted/iu,
  );
});

test("keeps authorization stable across disjoint ledger observations and seals recovery TTL", () => {
  const baselineRaw = providerOnlyEvidenceFixture();
  const baseline = buildProviderOnlyMergedClaimPairReconciliationPlan(
    buildProviderOnlyMergedClaimPairReconciliationEvidence(baselineRaw),
  );
  const advancedRaw = providerOnlyEvidenceFixture();
  advancedRaw.cloud.ledgerRevision = "e".repeat(40);
  advancedRaw.cloud.ledgerDigest = digest("disjoint-ledger-head");
  advancedRaw.cloud.sequence += 1;
  advancedRaw.cloud.ledgerValidationDigest = digestValue({
    sequence: advancedRaw.cloud.sequence,
    ledgerDigest: advancedRaw.cloud.ledgerDigest,
    failures: [],
  });
  advancedRaw.cloud.currentClaims.push(disjointClaim(advancedRaw.cloud.source));
  const advanced = buildProviderOnlyMergedClaimPairReconciliationPlan(
    buildProviderOnlyMergedClaimPairReconciliationEvidence(advancedRaw),
  );

  assert.equal(advanced.planDigest, baseline.planDigest);
  assert.equal(advanced.exactAuthorization, baseline.exactAuthorization);
  assert.notEqual(advanced.evidence.evidenceDigest, baseline.evidence.evidenceDigest);
  assert.notEqual(advanced.expectedLedgerDigest, baseline.expectedLedgerDigest);
  assert.notEqual(
    advanced.expectedUnrelatedInventoryDigest,
    baseline.expectedUnrelatedInventoryDigest,
  );
  assert.equal(baseline.recoveryTtlSeconds, 1_800);

  const ttlRaw = providerOnlyEvidenceFixture();
  ttlRaw.recoveryTtlSeconds = 900;
  const otherTtl = buildProviderOnlyMergedClaimPairReconciliationPlan(
    buildProviderOnlyMergedClaimPairReconciliationEvidence(ttlRaw),
  );
  assert.notEqual(otherTtl.planDigest, baseline.planDigest);
  assert.equal(otherTtl.recoveryTtlSeconds, 900);
});

test("authorization is byte-exact and operation keys are plan-and-phase bound", () => {
  const plan = planFixture();
  const authorization = authorizeProviderOnlyMergedClaimPairReconciliation({
    plan,
    authorization: plan.exactAuthorization,
  });
  assert.equal(authorization.planDigest, plan.planDigest);
  assert.match(authorization.authorizationDigest, /^[0-9a-f]{64}$/u);
  for (const value of [
    ` ${plan.exactAuthorization}`,
    `${plan.exactAuthorization} `,
    `${plan.exactAuthorization}\n`,
    plan.exactAuthorization.toUpperCase(),
  ]) {
    assert.throws(() => authorizeProviderOnlyMergedClaimPairReconciliation({
      plan,
      authorization: value,
    }), /requires exact authorization/iu);
  }
  const prepared = providerOnlyMergedClaimPairReconciliationOperationKey(plan, "prepared");
  assert.match(prepared, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    prepared,
    providerOnlyMergedClaimPairReconciliationOperationKey(plan, "waiter-retired"),
  );
  assert.throws(
    () => providerOnlyMergedClaimPairReconciliationOperationKey(plan, "authorized"),
    /unsupported provider-only phase/iu,
  );
});

test("intent advances only through the exact contiguous prefix with idempotent replay", () => {
  const { plan, intent: authorized } = authorizedFixture();
  const preparedValues = phaseValues(plan, "prepared");
  const prepared = advanceProviderOnlyMergedClaimPairReconciliationIntent(authorized, {
    status: "prepared",
    values: preparedValues,
  });
  assert.equal(
    advanceProviderOnlyMergedClaimPairReconciliationIntent(prepared, {
      status: "prepared",
      values: preparedValues,
    }).intentDigest,
    prepared.intentDigest,
  );
  assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(prepared, {
    status: "prepared",
    values: { ...preparedValues, evidenceDigest: digest("replay-drift") },
  }), /replay drifted/iu);
  assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(authorized, {
    status: "waiter-retired",
    values: phaseValues(plan, "waiter-retired"),
  }), /cannot advance/iu);
  assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(prepared, {
    status: "waiter-retired",
    values: { ...phaseValues(plan, "waiter-retired"), operationKey: digest("foreign-key") },
  }), /not operation-bound/iu);

  const withFuturePhase = structuredClone(prepared);
  withFuturePhase.phases["source-recovered"] = {
    values: phaseValues(plan, "source-recovered"),
  };
  resealIntent(withFuturePhase);
  assert.throws(
    () => normalizeProviderOnlyMergedClaimPairReconciliationIntent(withFuturePhase),
    /exact contiguous prefix/iu,
  );
  const missingPhase = structuredClone(prepared);
  delete missingPhase.phases.prepared;
  resealIntent(missingPhase);
  assert.throws(
    () => normalizeProviderOnlyMergedClaimPairReconciliationIntent(missingPhase),
    /prepared phase|exact contiguous prefix/iu,
  );
});

test("phase values have exact keys and one stable integration receipt chain", async context => {
  const { plan, intent: authorized } = authorizedFixture();
  await context.test("unexpected prepared key", () => {
    assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(authorized, {
      status: "prepared",
      values: { ...phaseValues(plan, "prepared"), unexpected: "escape" },
    }), /keys|values|unexpected|malformed/iu);
  });
  const recovered = advanceThrough(authorized, plan, [
    "prepared", "waiter-retired", "source-recovered",
  ]);
  await context.test("missing integration receipt", () => {
    const values = phaseValues(plan, "source-integrated");
    delete values.sourceIntegrationReceiptDigest;
    assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(recovered, {
      status: "source-integrated",
      values,
    }), /integration receipt|values|malformed/iu);
  });
  const integrated = advanceProviderOnlyMergedClaimPairReconciliationIntent(recovered, {
    status: "source-integrated",
    values: phaseValues(plan, "source-integrated"),
  });
  for (const status of ["source-retired", "verified"]) {
    await context.test(`${status} receipt drift`, () => {
      const predecessor = status === "source-retired"
        ? integrated
        : advanceProviderOnlyMergedClaimPairReconciliationIntent(integrated, {
          status: "source-retired",
          values: phaseValues(plan, "source-retired"),
        });
      assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(predecessor, {
        status,
        values: {
          ...phaseValues(plan, status),
          sourceIntegrationReceiptDigest: digest(`${status}-foreign-receipt`),
        },
      }), /integration receipt|drift/iu);
    });
  }
});

test("accepts only the exact waiter-first target-repository ledger tail", () => {
  const plan = planFixture();
  const ledger = { entries: tailEntries(plan) };
  assert.equal(assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, ledger).length, 4);
  assert.equal(
    assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, { entries: ledger.entries.slice(0, 2) }).length,
    2,
  );
  const interleaved = structuredClone(ledger);
  interleaved.entries.splice(1, 0, {
    sequence: plan.expectedLedgerSequence + 2,
    repositoryId: "github-repository:R_disjoint",
    action: "claim",
    claimId: digest("disjoint-claim"),
    claimCore: { transitionCounter: 1 },
    idempotencyKey: digest("disjoint-operation"),
  });
  assert.equal(assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, interleaved).length, 4);

  const wrongOrder = structuredClone(ledger);
  [wrongOrder.entries[0], wrongOrder.entries[1]] = [wrongOrder.entries[1], wrongOrder.entries[0]];
  assert.throws(
    () => assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, wrongOrder),
    /waiter-first sequence/iu,
  );
  const extra = structuredClone(ledger);
  extra.entries.push({ ...extra.entries.at(-1), sequence: plan.expectedLedgerSequence + 5 });
  assert.throws(
    () => assertProviderOnlyMergedClaimPairTargetRepositoryTail(plan, extra),
    /exceeds the closed sequence/iu,
  );
});

test("terminal receipt binds the verified intent and source integration receipt", () => {
  const { plan, authorization, intent: authorized } = authorizedFixture();
  const verified = advanceThrough(authorized, plan, phases);
  const values = phaseValues(plan, "complete");
  const receipt = buildProviderOnlyMergedClaimPairReconciliationReceipt({
    plan,
    intent: verified,
    values,
  });
  assert.equal(receipt.authorizationDigest, authorization.authorizationDigest);
  assert.equal(receipt.verifiedIntentDigest, verified.intentDigest);
  assert.equal(receipt.sourceIntegrationReceiptDigest, values.sourceIntegrationReceiptDigest);
  assert.equal(receipt.bytesDigest, plan.bytesDigest);
  assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/u);

  const complete = advanceProviderOnlyMergedClaimPairReconciliationIntent(verified, {
    status: "complete",
    values: { ...values, receipt },
  });
  assert.deepEqual(normalizeProviderOnlyMergedClaimPairReconciliationIntent(complete), complete);
  assert.equal(complete.phases.complete.values.receipt.receiptDigest, receipt.receiptDigest);
  assert.throws(() => buildProviderOnlyMergedClaimPairReconciliationReceipt({
    plan,
    intent: advanceThrough(authorized, plan, phases.slice(0, -1)),
    values,
  }), /exact verified/iu);
});

test("rejects incomplete, cross-phase-drifted, and recomputed-tampered terminal receipts", async context => {
  const { plan, intent: authorized } = authorizedFixture();
  const verified = advanceThrough(authorized, plan, phases);
  const values = phaseValues(plan, "complete");
  await context.test("empty receipt", () => {
    assert.throws(() => advanceProviderOnlyMergedClaimPairReconciliationIntent(verified, {
      status: "complete",
      values: { ...values, receipt: {} },
    }), /receipt/iu);
  });
  await context.test("integration receipt drift", () => {
    assert.throws(() => buildProviderOnlyMergedClaimPairReconciliationReceipt({
      plan,
      intent: verified,
      values: {
        ...values,
        sourceIntegrationReceiptDigest: digest("other-integration-receipt"),
      },
    }), /integration receipt|verified|drift/iu);
  });
  await context.test("completion evidence drift", () => {
    assert.throws(() => buildProviderOnlyMergedClaimPairReconciliationReceipt({
      plan,
      intent: verified,
      values: { ...values, evidenceDigest: digest("foreign-completion-evidence") },
    }), /completion evidence|verified|drift/iu);
  });
  await context.test("recomputed receipt and intent tamper", () => {
    const receipt = buildProviderOnlyMergedClaimPairReconciliationReceipt({
      plan,
      intent: verified,
      values,
    });
    const complete = structuredClone(advanceProviderOnlyMergedClaimPairReconciliationIntent(verified, {
      status: "complete",
      values: { ...values, receipt },
    }));
    complete.phases.complete.values.receipt.finalRevision = "f".repeat(40);
    const tamperedReceipt = complete.phases.complete.values.receipt;
    const { receiptDigest: _receiptDigest, ...receiptCore } = tamperedReceipt;
    tamperedReceipt.receiptDigest = digestValue(receiptCore);
    resealIntent(complete);
    assert.throws(
      () => normalizeProviderOnlyMergedClaimPairReconciliationIntent(complete),
      /receipt|drift/iu,
    );
  });
});

function planFixture() {
  return buildProviderOnlyMergedClaimPairReconciliationPlan(
    buildProviderOnlyMergedClaimPairReconciliationEvidence(providerOnlyEvidenceFixture()),
  );
}

function authorizedFixture() {
  const plan = planFixture();
  const authorization = authorizeProviderOnlyMergedClaimPairReconciliation({
    plan,
    authorization: plan.exactAuthorization,
  });
  const intent = createProviderOnlyMergedClaimPairReconciliationIntent({
    plan,
    authorizationReceipt: authorization,
  });
  return { plan, authorization, intent };
}

function advanceThrough(intent, plan, statuses) {
  let current = intent;
  for (const status of statuses) {
    current = advanceProviderOnlyMergedClaimPairReconciliationIntent(current, {
      status,
      values: phaseValues(plan, status),
    });
  }
  return current;
}

function phaseValues(plan, phase) {
  const values = {
    operationKey: providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase),
    evidenceDigest: digest(`${phase}-evidence`),
  };
  if (["source-integrated", "source-retired", "verified", "complete"].includes(phase)) {
    values.sourceIntegrationReceiptDigest = digest("source-integration-receipt");
  }
  if (phase === "complete") {
    values.evidenceDigest = digestValue({
      schema: "agentic-provider-only-merged-claim-pair-completion-evidence/v1",
      planDigest: plan.planDigest,
      verifiedEvidenceDigest: digest("verified-evidence"),
      sourceIntegrationReceiptDigest: values.sourceIntegrationReceiptDigest,
    });
  }
  return values;
}

function tailEntries(plan) {
  return [
    ["waiter-retired", "retire", plan.waiterClaimId, plan.waiterTransitionCounter + 1],
    ["source-recovered", "continue", plan.sourceClaimId, plan.sourceTransitionCounter + 1],
    ["source-integrated", "integrate", plan.sourceClaimId, plan.sourceTransitionCounter + 2],
    ["source-retired", "retire", plan.sourceClaimId, plan.sourceTransitionCounter + 3],
  ].map(([phase, action, claimId, transitionCounter], index) => {
    const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
    return {
      sequence: plan.expectedLedgerSequence + index + 1,
      repositoryId: plan.repositoryId,
      action,
      claimId,
      claimCore: { transitionCounter },
      idempotencyKey: digestValue(
        `provider-only-merged-claim-pair-reconciliation:${operationKey}`,
      ),
    };
  });
}

function resealIntent(intent) {
  const { intentDigest: _intentDigest, ...core } = intent;
  intent.intentDigest = digestValue(core);
}

function disjointClaim(source) {
  const declaredWriteScope = normalizeWriteSet(["path:docs/disjoint-observation"]);
  const writeSetDigest = digestValue(declaredWriteScope);
  const identity = {
    actorId: source.actorId,
    canonicalBaseRevision: source.canonicalBaseRevision,
    leaseEpoch: 20,
    repositoryId: source.repositoryId,
    workItemId: "work-item:disjoint-observation",
    writeSetDigest,
  };
  return {
    ...structuredClone(source),
    claimId: digestValue(identity),
    claimDigest: digest("disjoint-fence"),
    transitionDigest: digest("disjoint-transition"),
    operationReceiptDigest: digest("disjoint-receipt"),
    workItemId: identity.workItemId,
    declaredWriteScope,
    writeSetDigest,
    leaseEpoch: identity.leaseEpoch,
    predecessorClaimId: null,
  };
}
