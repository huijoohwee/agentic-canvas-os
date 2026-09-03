import assert from "node:assert/strict";
import test from "node:test";

import {
  PR825_CLEANUP_RETIREMENT_BINDINGS_SCHEMA,
  createPr825CleanupRetirementBindings,
} from "../scripts/pr825-cleanup-retirement-bindings.mjs";

const OBSERVED_AT = "2026-09-03T08:27:00.000Z";
const EXPIRES_AT = "2026-09-03T08:41:35.861Z";

test("derives exact PR825 cleanup bindings from the successor integration receipt and local observation", async () => {
  const record = await createPr825CleanupRetirementBindings({
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
  });

  assert.equal(record.schema, PR825_CLEANUP_RETIREMENT_BINDINGS_SCHEMA);
  assert.equal(record.cleanupReady, true);
  assert.equal(record.observedAt, OBSERVED_AT);
  assert.equal(record.expiresAt, EXPIRES_AT);
  assert.equal(
    record.integrationReceiptDigest,
    "dfcfc9813f5be7b893b7e892b7e835438409c8f6ea1af9f2a4fe96b9c939cdbc",
  );
  assert.equal(
    record.integrationPlanByteDigest,
    "c1c36b4f3a17fcfa70316e9c2c396a2417dd0465702227a23ce368f4f8f8d152",
  );
  assert.equal(
    record.profileDigest,
    "934ae07b9602bfe6c8368a161648750adf569096560893f6554a0be06203c1fe",
  );
  assert.equal(
    record.canonicalRevision,
    "5c96826499ef3a8608d0a9554e32bc224bebb58b",
  );
  assert.equal(
    record.recoveryInventoryDigest,
    "9c27409251f8be58d9eca9b0f77b9a4a9ca6a7500c4be8a82dfa9f9710a7e397",
  );
  assert.equal(record.recoveryInventoryContentEntries, 4631);
  assert.equal(
    record.cleanupPlan.expectedBranch,
    "agent/katrinas-macbook-pro.local/active-dirt-marker-replay-order",
  );
  assert.equal(
    record.cleanupPlan.expectedHeadRevision,
    "c16dee29507a26cb0c8b2e8e6f9b9d80204e4a57",
  );
  assert.equal(record.cleanupPlan.profileDigest, record.profileDigest);
  assert.equal(record.cleanupPlan.recoveryInventoryDigest, record.recoveryInventoryDigest);
  assert.equal(
    record.cleanupPlan.integrationReceiptDigest,
    record.integrationReceiptDigest,
  );
  assert.equal(
    record.preservationReceipt.integrationReceiptDigest,
    record.integrationReceiptDigest,
  );
  assert.equal(
    record.noRemainingValueReceipt.integrationReceiptDigest,
    record.integrationReceiptDigest,
  );
  assert.equal(record.preservationReceipt.archiveDigest, record.archiveDigest);
  assert.equal(record.noRemainingValueReceipt.archiveDigest, record.archiveDigest);
  assert.equal(record.preservationReceipt.preservationComplete, true);
  assert.equal(record.noRemainingValueReceipt.reachableFromRetainedRefs, true);
  assert.equal(record.noRemainingValueReceipt.unpreservedValueCount, 0);
  assert.match(record.ownerStateDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.archiveDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.cleanupPlan.planDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.cleanupPlanByteDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.preservationReceipt.receiptDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.noRemainingValueReceipt.receiptDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.recordDigest, /^[0-9a-f]{64}$/u);
});
