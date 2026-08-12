// Responsibility: Prove byte-exact authority, one-shot replay, historical preservation, and receipts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson, digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_PLAN_SCHEMA,
  ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_RECEIPT_SCHEMA,
  activeDirtyScopeExpansionIntentRecoveryOperationKey,
  authorizeActiveDirtyScopeExpansionIntentRecovery,
  buildActiveDirtyScopeExpansionIntentRecoveryPlan,
  buildActiveDirtyScopeExpansionIntentRecoveryReceipt,
  completeActiveDirtyScopeExpansionIntentRecoveryIntent,
  createActiveDirtyScopeExpansionIntentRecoveryIntent,
  normalizeActiveDirtyScopeExpansionIntentRecoveryIntent,
  normalizeActiveDirtyScopeExpansionIntentRecoveryPlan,
  normalizeActiveDirtyScopeExpansionIntentRecoveryReceipt,
  projectTerminalScopeExpansionIntent,
} from "../scripts/active-dirty-scope-expansion-intent-recovery-contract.mjs";
import {
  buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence,
  buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
} from "../scripts/active-dirty-scope-expansion-intent-recovery-evidence.mjs";
import { recoveryFixture }
  from "./active-dirty-scope-expansion-intent-recovery-evidence.test.mjs";

test("plan and authorization freeze exact C3-to-C4 source evidence", () => {
  const { plan } = planFixture();
  assert.deepEqual(normalizeActiveDirtyScopeExpansionIntentRecoveryPlan(plan), plan);
  assert.equal(plan.schema, ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_PLAN_SCHEMA);
  assert.equal(
    plan.exactAuthorization,
    `authorize active-dirty-scope-expansion-intent-recovery ${plan.planDigest}`,
  );
  for (const changed of [
    ` ${plan.exactAuthorization}`,
    `${plan.exactAuthorization} `,
    `${plan.exactAuthorization}\n`,
    plan.exactAuthorization.toUpperCase(),
  ]) {
    assert.throws(
      () => authorizeActiveDirtyScopeExpansionIntentRecovery(plan, changed),
      /exact authorization/u,
    );
  }
  assert.throws(
    () => normalizeActiveDirtyScopeExpansionIntentRecoveryPlan({ ...plan, extra: true }),
    /unexpected or missing fields/u,
  );
});

test("terminal projection preserves every historical C3 field and binds C4 receipts", () => {
  const fixture = recoveryFixture();
  const recovered = projectTerminalScopeExpansionIntent({
    sourceIntent: fixture.sourceIntent,
    currentLeaseDigest: fixture.sourceInput.leaseDigest,
    currentAuthority: fixture.currentAuthority,
    mutationAuthorityReceipt: fixture.mutationAuthority,
    pullRequestMarkerDigest: fixture.sourceInput.pullRequest.markerDigest,
    pullRequestUrl: fixture.sourceInput.pullRequest.url,
  });
  assert.equal(recovered.status, "complete");
  assert.deepEqual(recovered.boundAuthority, fixture.sourceIntent.boundAuthority);
  assert.equal(recovered.boundReceiptDigest, fixture.sourceIntent.boundReceiptDigest);
  assert.equal(recovered.targetClaimDigest, fixture.sourceIntent.targetClaimDigest);
  assert.equal(
    recovered.localProjectionReceiptDigest,
    fixture.mutationAuthority.receiptDigest,
  );
  for (const key of [
    "branch", "sourceLeaseDigest", "sourceClaimId", "sourceFenceSha",
    "targetWriteSetDigest", "targetManifestDigest", "planDigest", "targetClaimId",
    "targetClaimDigest", "targetLeaseEpoch", "targetCanonicalBaseSha",
    "targetReviewRequestId", "completedReceiptDigest", "waiting",
    "waitingReceiptDigest", "sourceRetirementReceiptDigest", "promoted",
    "promotedReceiptDigest", "boundAuthority", "boundReceiptDigest", "planSnapshot",
  ]) {
    assert.equal(
      canonicalJson(recovered[key]),
      canonicalJson(fixture.sourceIntent[key]),
      `historical ${key}`,
    );
  }

  assert.throws(
    () => projectTerminalScopeExpansionIntent({
      sourceIntent: fixture.sourceIntent,
      currentLeaseDigest: fixture.sourceInput.leaseDigest,
      currentAuthority: {
        ...fixture.currentAuthority,
        transitionCounter: fixture.currentAuthority.transitionCounter + 1,
      },
      mutationAuthorityReceipt: fixture.mutationAuthority,
      pullRequestMarkerDigest: fixture.sourceInput.pullRequest.markerDigest,
      pullRequestUrl: fixture.sourceInput.pullRequest.url,
    }),
    /exact heartbeat successor/u,
  );
});

test("one-shot recovery intent completes once and emits a C4 lineage receipt", () => {
  const fixture = completeFixture();
  assert.deepEqual(
    normalizeActiveDirtyScopeExpansionIntentRecoveryIntent(fixture.completeIntent),
    fixture.completeIntent,
  );
  assert.equal(
    completeActiveDirtyScopeExpansionIntentRecoveryIntent(
      fixture.completeIntent,
      fixture.observation,
    ).intentDigest,
    fixture.completeIntent.intentDigest,
  );
  const receipt = buildActiveDirtyScopeExpansionIntentRecoveryReceipt(
    fixture.completeIntent,
  );
  assert.equal(receipt.schema, ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_RECEIPT_SCHEMA);
  assert.equal(receipt.currentAuthorityDigest, fixture.observation.currentAuthorityDigest);
  assert.equal(receipt.heartbeatLineageDigest, fixture.observation.heartbeatLineageDigest);
  assert.equal(
    receipt.recoveredScopeExpansionIntentDigest,
    digestValue(fixture.recovered),
  );
  assert.deepEqual(
    normalizeActiveDirtyScopeExpansionIntentRecoveryReceipt(
      receipt,
      fixture.completeIntent,
    ),
    receipt,
  );
  assert.throws(
    () => normalizeActiveDirtyScopeExpansionIntentRecoveryReceipt(receipt),
    /requires the expected complete intent/u,
  );
  const changed = structuredClone(fixture.observation);
  changed.finalReceiptDigest = digestValue({ changed: true });
  const { observationDigest: ignored, ...changedCore } = changed;
  changed.observationDigest = digestValue(changedCore);
  assert.throws(
    () => completeActiveDirtyScopeExpansionIntentRecoveryIntent(
      fixture.completeIntent,
      changed,
    ),
    /observation drifted|replay drifted/u,
  );
});

test("plan and receipt schemas match exact top-level runtime artifacts", () => {
  const fixture = completeFixture();
  const receipt = buildActiveDirtyScopeExpansionIntentRecoveryReceipt(
    fixture.completeIntent,
  );
  const planSchema = readSchema(
    "active-dirty-scope-expansion-intent-recovery-plan.v1.schema.json",
  );
  const receiptSchema = readSchema(
    "active-dirty-scope-expansion-intent-recovery-receipt.v1.schema.json",
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false, formats: {
    "date-time": value => Number.isFinite(Date.parse(value)),
  } });
  const validatePlan = ajv.compile(planSchema);
  const validateReceipt = ajv.compile(receiptSchema);
  assert.equal(validatePlan(fixture.plan), true, JSON.stringify(validatePlan.errors));
  const historicalAuthorityShape = structuredClone(fixture.plan);
  delete historicalAuthorityShape.sourceEvidence.scopeExpansionIntent
    .boundAuthority.heartbeatCounter;
  assert.equal(validatePlan(historicalAuthorityShape), true,
    JSON.stringify(validatePlan.errors));
  assert.equal(validateReceipt(receipt), true, JSON.stringify(validateReceipt.errors));
  assert.equal(validatePlan({ ...fixture.plan, extra: true }), false);
  assert.equal(validateReceipt({ ...receipt, extra: true }), false);
  const emptyEvidence = structuredClone(fixture.plan);
  emptyEvidence.sourceEvidence.controller = {};
  assert.equal(validatePlan(emptyEvidence), false);
  for (const key of ["lease", "currentAuthority", "currentClaim"]) {
    const emptyNestedEvidence = structuredClone(fixture.plan);
    emptyNestedEvidence.sourceEvidence[key] = { x: 1 };
    assert.equal(validatePlan(emptyNestedEvidence), false, key);
  }
  assert.deepEqual(
    [...planSchema.required].sort(),
    Object.keys(fixture.plan).sort(),
  );
  assert.deepEqual(
    [...receiptSchema.required].sort(),
    Object.keys(receipt).sort(),
  );
});

function planFixture() {
  const repository = recoveryFixture();
  const sourceEvidence = buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
    repository.sourceInput,
  );
  const plan = buildActiveDirtyScopeExpansionIntentRecoveryPlan({ sourceEvidence });
  return { plan, repository, sourceEvidence };
}

function completeFixture() {
  const { plan, repository } = planFixture();
  const authorization = authorizeActiveDirtyScopeExpansionIntentRecovery(
    plan,
    plan.exactAuthorization,
  );
  const intent = createActiveDirtyScopeExpansionIntentRecoveryIntent(
    plan,
    authorization,
  );
  const operationKey = activeDirtyScopeExpansionIntentRecoveryOperationKey(
    plan.planDigest,
    intent.authorizationDigest,
  );
  const recovered = projectTerminalScopeExpansionIntent({
    sourceIntent: repository.sourceIntent,
    currentLeaseDigest: repository.sourceInput.leaseDigest,
    currentAuthority: repository.currentAuthority,
    mutationAuthorityReceipt: repository.mutationAuthority,
    pullRequestMarkerDigest: repository.sourceInput.pullRequest.markerDigest,
    pullRequestUrl: repository.sourceInput.pullRequest.url,
  });
  const observation = buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation({
    plan,
    operationKey,
    recoveredScopeExpansionIntent: recovered,
  });
  const completeIntent = completeActiveDirtyScopeExpansionIntentRecoveryIntent(
    intent,
    observation,
  );
  return { completeIntent, intent, observation, operationKey, plan, recovered, repository };
}

function readSchema(name) {
  return JSON.parse(readFileSync(new URL(`../docs/schemas/${name}`, import.meta.url)));
}
