import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  inspectRemoteAuthority,
} from "../scripts/recoverable-lane-cleanup-repository-adapter.mjs";

function readyInventory() {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "empty",
    claims: [],
  };
}

test("remote authority queries an explicit ledger for the Git-origin target", () => {
  const calls = [];
  const evidence = inspectRemoteAuthority({
    originUrl: "git@github.com:target-owner/target-repository.git",
    ledgerRepository: "authority-owner/collaboration-ledger",
    headSha: "1".repeat(40),
    claimId: null,
    invokeCloudAction(request) {
      calls.push(request);
      return readyInventory();
    },
  });
  assert.deepEqual(calls, [{
    action: "status",
    ledgerRepository: "authority-owner/collaboration-ledger",
    request: { targetRepository: "target-owner/target-repository" },
  }]);
  const core = {
    provider: "github",
    ledgerRepository: "authority-owner/collaboration-ledger",
    targetRepository: "target-owner/target-repository",
    targetClaims: [],
    currentRemoteWriter: false,
    waitingSuccessors: 0,
  };
  assert.deepEqual(evidence, {
    ...core,
    verificationReceiptDigest: digestValue(core),
  });
});

test("remote authority defaults the ledger to the Git-origin target", () => {
  const calls = [];
  const evidence = inspectRemoteAuthority({
    originUrl: "https://github.com/target-owner/target-repository.git",
    headSha: "1".repeat(40),
    claimId: null,
    invokeCloudAction(request) {
      calls.push(request);
      return readyInventory();
    },
  });
  assert.equal(evidence.ledgerRepository, "target-owner/target-repository");
  assert.equal(evidence.targetRepository, "target-owner/target-repository");
  assert.equal(calls[0].ledgerRepository, "target-owner/target-repository");
});

test("remote authority rejects malformed or ambiguous repository identities", () => {
  for (const ledgerRepository of [
    "authority", "authority/ledger/extra", " authority/ledger",
    "authority/ledger ", "authority//ledger",
  ]) {
    assert.throws(() => inspectRemoteAuthority({
      originUrl: "https://github.com/target-owner/target-repository.git",
      ledgerRepository,
      headSha: "1".repeat(40),
      claimId: null,
      invokeCloudAction: readyInventory,
    }), /ledger repository.*owner\/name/);
  }
  assert.throws(() => inspectRemoteAuthority({
    originUrl: "https://example.invalid/target-owner/target-repository.git",
    ledgerRepository: "authority-owner/collaboration-ledger",
    headSha: "1".repeat(40),
    claimId: null,
    invokeCloudAction: readyInventory,
  }), /GitHub reference mapping/);
});
