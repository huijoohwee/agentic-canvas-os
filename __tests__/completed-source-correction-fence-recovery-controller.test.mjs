import assert from "node:assert/strict";
import test from "node:test";
import { createCompletedSourceCorrectionFenceRecoveryController } from "../scripts/completed-source-correction-fence-recovery-controller.mjs";
import { fixture } from "./completed-source-correction-fence-recovery-contract.test.mjs";

test("controller executes every monotonic phase and terminal replay has no effects", async () => {
  let stored = null; const calls = [];
  const adapter = {
    withFence: callback => callback(), readEvidence: async () => fixture(), readIntent: async () => stored,
    writeIntent: async ({ expected, value }) => { assert.equal(stored, expected); stored = value; },
    reconcilePhase: async () => null,
    verifyTaskAuthority: async () => (calls.push("task"), { taskAuthorityReceiptDigest: "a".repeat(64), bindingDigest: "b".repeat(64) }),
    recoverCloud: async () => (calls.push("cloud"), { cloudAuthorityDigest: "b".repeat(64), verificationReceiptDigest: "c".repeat(64) }),
    projectLocal: async () => (calls.push("local"), { leaseDigest: "c".repeat(64) }),
    projectPullRequestMarker: async () => (calls.push("marker"), { pullRequestMarkerDigest: "d".repeat(64) }),
    verifyTerminal: async ({ intent }) => (calls.push("verify"), { taskAuthorityReceiptDigest: intent.phases.task_authority_verified.values.taskAuthorityReceiptDigest, cloudAuthorityDigest: "b".repeat(64), leaseDigest: "c".repeat(64), pullRequestMarkerDigest: "d".repeat(64), verificationDigest: "e".repeat(64), mutationAuthority: { schema: "authority", status: "ready" } }),
  };
  const controller = createCompletedSourceCorrectionFenceRecoveryController(adapter);
  const plan = await controller.plan({ operatorSessionId: "operator-session" });
  const receipt = await controller.run({ operatorSessionId: "operator-session", authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "mutation-authority-restored");
  assert.deepEqual(calls, ["task", "cloud", "local", "marker", "verify"]);
  await controller.run({ operatorSessionId: "operator-session", authorization: plan.exactAuthorization });
  assert.equal(calls.length, 5);
});
