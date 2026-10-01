import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  verifyDeliveryAuthorizedPeerAuthorities,
} from "../scripts/scoped-lane-delivery-peer-authority.mjs";
import {
  bindOperationDerivedDeliveryPeerLaneStates,
  requireDeliveryPeerAuthorityMap,
} from "../scripts/scoped-lane-admission-ownership.mjs";

test("delivery peer binding accepts only an operation-derived exact lane proof", () => {
  const inventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: "a".repeat(40),
    ledgerDigest: "1".repeat(64),
    evaluationTime: "2026-08-04T08:00:00.000Z",
    claims: [],
  };
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  const remote = {
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    ledgerRevision: inventory.observedLedgerHeadRevision,
    ledgerDigest: inventory.ledgerDigest,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    inventory,
    verifiedAt: inventory.evaluationTime,
  };
  const verification = verifyDeliveryAuthorizedPeerAuthorities({
    lanes: [],
    remoteAuthorityVerification: remote,
  });
  assert.equal(requireDeliveryPeerAuthorityMap(verification, []).size, 0);
  assert.deepEqual(
    bindOperationDerivedDeliveryPeerLaneStates([], verification),
    [],
  );
  assert.throws(() => requireDeliveryPeerAuthorityMap(
    structuredClone(verification),
    [],
  ), /operation-derived authority proof/);
});
