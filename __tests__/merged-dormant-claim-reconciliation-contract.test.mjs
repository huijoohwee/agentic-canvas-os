// Responsibility: verify digest-bound plans, byte-exact authorization, durable phase history, and terminal receipts for merged dormant reconciliation.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceMergedDormantClaimReconciliationIntent,
  authorizeMergedDormantClaimReconciliation,
  buildMergedDormantClaimReconciliationReceipt,
  createMergedDormantClaimReconciliationIntent,
  mergedDormantClaimReconciliationOperationKey,
  normalizeMergedDormantClaimReconciliationIntent,
  normalizeMergedDormantClaimReconciliationPlan,
  normalizeMergedDormantClaimReconciliationReceipt,
} from "../scripts/merged-dormant-claim-reconciliation-contract.mjs";

const digest = label => digestValue({ label });
const sha = label => digestValue({ sha: label }).slice(0, 40);

test("normalizes one digest-bound plan whose exact token ends in its plan digest", () => {
  const plan = planFixture();
  assert.deepEqual(normalizeMergedDormantClaimReconciliationPlan(plan), plan);
  assert.equal(
    plan.exactAuthorization,
    `authorize merged-dormant-claim-reconciliation ${plan.planDigest}`,
  );
  const changed = structuredClone(plan);
  changed.protectedMainSha = sha("drifted-main");
  assert.throws(() => normalizeMergedDormantClaimReconciliationPlan(changed));
});

test("authorization is byte-exact and rejects whitespace normalization", () => {
  const plan = planFixture();
  const receipt = authorizeMergedDormantClaimReconciliation({
    plan,
    authorization: plan.exactAuthorization,
  });
  assert.equal(receipt.planDigest, plan.planDigest);
  for (const authorization of [
    ` ${plan.exactAuthorization}`,
    `${plan.exactAuthorization} `,
    `${plan.exactAuthorization}\n`,
    plan.exactAuthorization.toUpperCase(),
  ]) {
    assert.throws(() => authorizeMergedDormantClaimReconciliation({ plan, authorization }));
  }
});

test("intent advances monotonically with exact phase cardinality and idempotent replay", () => {
  const { plan, authorization, intent: authorized } = authorizedFixture();
  const preparedValues = phaseValues(plan, "prepared");
  const prepared = advanceMergedDormantClaimReconciliationIntent(authorized, {
    status: "prepared",
    values: preparedValues,
  });
  assert.equal(
    advanceMergedDormantClaimReconciliationIntent(prepared, {
      status: "prepared",
      values: preparedValues,
    }).intentDigest,
    prepared.intentDigest,
  );
  assert.throws(() => advanceMergedDormantClaimReconciliationIntent(authorized, {
    status: "recovered",
    values: phaseValues(plan, "recovered"),
  }));
  assert.throws(() => advanceMergedDormantClaimReconciliationIntent(authorized, {
    status: "prepared",
    values: { ...preparedValues, unexpected: digest("extra") },
  }));
  const recovered = advanceMergedDormantClaimReconciliationIntent(prepared, {
    status: "recovered",
    values: phaseValues(plan, "recovered"),
  });
  assert.throws(() => advanceMergedDormantClaimReconciliationIntent(recovered, {
    status: "integrated",
    values: {
      operationKey: mergedDormantClaimReconciliationOperationKey(plan, "integrated"),
      evidenceDigest: digest("integrated-evidence"),
    },
  }));
  assert.equal(authorization.planDigest, plan.planDigest);
});

test("terminal receipt binds the retired intent, integration receipt, and all plan evidence", () => {
  const { plan, authorization, intent: authorized } = authorizedFixture();
  const retired = advanceToRetired(authorized, plan);
  const values = phaseValues(plan, "complete");
  const receipt = buildMergedDormantClaimReconciliationReceipt({
    plan,
    intent: retired,
    phase: "complete",
    values,
  });
  assert.equal(receipt.integrationReceiptDigest, values.integrationReceiptDigest);
  assert.deepEqual(normalizeMergedDormantClaimReconciliationReceipt(receipt, {
    plan,
    authorizationDigest: authorization.authorizationDigest,
    retiredIntentDigest: retired.intentDigest,
    operationKey: values.operationKey,
    evidenceDigest: values.evidenceDigest,
    integrationReceiptDigest: values.integrationReceiptDigest,
  }), receipt);
  const complete = advanceMergedDormantClaimReconciliationIntent(retired, {
    status: "complete",
    values: { ...values, receipt },
  });
  assert.deepEqual(normalizeMergedDormantClaimReconciliationIntent(complete), complete);
  assert.equal(complete.phases.complete.values.receipt.receiptDigest, receipt.receiptDigest);
});

test("recomputed journal digests cannot hide terminal receipt or durable history tampering", () => {
  const { plan, intent: authorized } = authorizedFixture();
  const retired = advanceToRetired(authorized, plan);
  const values = phaseValues(plan, "complete");
  const receipt = buildMergedDormantClaimReconciliationReceipt({
    plan,
    intent: retired,
    phase: "complete",
    values,
  });
  const complete = advanceMergedDormantClaimReconciliationIntent(retired, {
    status: "complete",
    values: { ...values, receipt },
  });
  const tamperedReceipt = structuredClone(complete);
  tamperedReceipt.phases.complete.values.receipt.finalRevision = sha("forged-final");
  resealReceiptAndIntent(tamperedReceipt);
  assert.throws(() => normalizeMergedDormantClaimReconciliationIntent(tamperedReceipt));

  const missingIntegration = structuredClone(retired);
  delete missingIntegration.phases.integrated.values.integrationReceiptDigest;
  resealIntent(missingIntegration);
  assert.throws(() => normalizeMergedDormantClaimReconciliationIntent(missingIntegration));
});

function authorizedFixture() {
  const plan = planFixture();
  const authorization = authorizeMergedDormantClaimReconciliation({
    plan,
    authorization: plan.exactAuthorization,
  });
  const intent = createMergedDormantClaimReconciliationIntent({
    plan,
    authorizationReceipt: authorization,
  });
  return { plan, authorization, intent };
}

function advanceToRetired(intent, plan) {
  let current = intent;
  for (const status of ["prepared", "recovered", "integrated", "retired"]) {
    current = advanceMergedDormantClaimReconciliationIntent(current, {
      status,
      values: phaseValues(plan, status),
    });
  }
  return current;
}

function phaseValues(plan, phase) {
  const values = {
    operationKey: mergedDormantClaimReconciliationOperationKey(plan, phase),
    evidenceDigest: digest(`${phase}-evidence`),
  };
  if (["integrated", "retired", "complete"].includes(phase)) {
    values.integrationReceiptDigest = digest("integration-receipt");
  }
  return values;
}

function planFixture() {
  const core = {
    schema: "agentic-merged-dormant-claim-reconciliation-plan/v1",
    provider: "github",
    targetRepository: "owner/repo",
    repositoryId: "github-repository:R_1",
    actorId: "github-user:1",
    workItemId: "work-item:game-os",
    canonicalBaseRevision: sha("base"),
    recoveryDeviceId: "device",
    recoverySessionId: "session",
    expectedCloudDeviceId: `device:${digest("cloud-device")}`,
    expectedCloudSessionId: `session:${digest("cloud-session")}`,
    claimId: digest("claim"),
    claimDigest: digest("claim-fence"),
    claimTransitionDigest: digest("claim-transition"),
    claimOperationReceiptDigest: digest("claim-operation"),
    expectedLedgerRevision: sha("ledger-ref"),
    expectedLedgerDigest: digest("ledger"),
    expectedTransitionCounter: 5,
    claimLeaseEpoch: 1,
    claimLaneRevision: sha("claim-lane"),
    claimReviewRequestId: "github-pull-request:PR_738",
    claimFocusedEvidenceDigest: digest("focused"),
    claimWriteSetDigest: digest("write-set"),
    pullRequestNumber: 738,
    pullRequestNodeId: "PR_738",
    pullRequestHeadSha: sha("pull-head"),
    pullRequestHeadTreeSha: sha("pull-tree"),
    pullRequestMergeCommitSha: sha("merge"),
    pullRequestMergeCommitTreeSha: sha("pull-tree"),
    protectedMainSha: sha("main"),
    protectedMainTreeSha: sha("main-tree"),
    sourceEvidenceDigest: digest("source"),
    bytesDigest: digest("bytes"),
    refreshTopologyDigest: digest("refresh"),
    namedChecksDigest: digest("checks"),
    handoffEvidenceDigest: digest("handoff"),
    localSnapshotDigest: digest("local"),
    localAuthorityDigest: digest("authority"),
    dependencyClosureDigest: digest("dependencies"),
    retirementReason: "integrated",
    finalRevision: sha("claim-lane"),
    integrationReceiptDigest: null,
    phases: ["prepared", "recovered", "integrated", "retired", "complete"],
  };
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    exactAuthorization: `authorize merged-dormant-claim-reconciliation ${planDigest}`,
    planDigest,
  });
}

function resealReceiptAndIntent(intent) {
  const receipt = intent.phases.complete.values.receipt;
  const { receiptDigest: _receiptDigest, ...receiptCore } = receipt;
  receipt.receiptDigest = digestValue(receiptCore);
  resealIntent(intent);
}

function resealIntent(intent) {
  const { intentDigest: _intentDigest, ...intentCore } = intent;
  intent.intentDigest = digestValue(intentCore);
}
