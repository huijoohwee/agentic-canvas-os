import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalHandoffOwnedDirtSuccessorRecoveryController }
  from "../scripts/terminal-handoff-owned-dirt-successor-recovery-controller.mjs";
import { buildRecoveryPlan }
  from "../scripts/terminal-handoff-owned-dirt-successor-recovery-contract.mjs";
import { selectTerminalHandoffClaimProof }
  from "../scripts/terminal-handoff-owned-dirt-successor-recovery-evidence.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const hex = value => digestValue(value);
const sha = value => hex(value).slice(0, 40);

test("selects only an exact current-to-retired handoff chain", () => {
  const fixture = sourceFixture();
  const proof = selectTerminalHandoffClaimProof({ entries: fixture.entries, lease: fixture.lease });
  assert.equal(proof.claimId, fixture.lease.cloudAuthority.claimId);
  assert.equal(proof.retirementReason, "handoff");
  assert.ok(proof.terminalTransitionCounter > proof.sourceTransitionCounter);
  assert.throws(() => selectTerminalHandoffClaimProof({
    entries: fixture.entries.map((entry, index) => index ? {
      ...entry, claimCore: { ...entry.claimCore,
        retirement: { ...entry.claimCore.retirement, reason: "abandoned" } },
    } : entry), lease: fixture.lease,
  }), /terminal handoff/u);
});

test("runs the journaled successor chain without source effects", async () => {
  const evidence = evidenceFixture();
  const plan = buildRecoveryPlan({ evidence,
    operatorSessionId: "successor-session", ttlSeconds: 1800 });
  let journal = null;
  const calls = [];
  const effects = {
    snapshot: { receiptDigest: hex("snapshot") },
    claimSuccessor: { claimId: hex("successor"), receiptDigest: hex("claim") },
    bindSuccessor: { authority: { claimId: hex("successor") }, receiptDigest: hex("bind") },
    projectLocal: { receiptDigest: hex("local") },
    projectPullRequest: { receiptDigest: hex("marker") },
    verifyTerminal: { receiptDigest: hex("terminal"),
      mutationAuthorityReceiptDigest: hex("mutation") },
  };
  const adapter = {
    withFence: action => action(), captureEvidence: async () => evidence,
    readIntent: async () => journal,
    writeIntent: async ({ expected, value }) => { assert.equal(expected, journal); journal = value; },
    reconcile: async () => null,
    ...Object.fromEntries(Object.entries(effects).map(([name, value]) => [name, async () => {
      calls.push(name); return value;
    }])),
  };
  const controller = createTerminalHandoffOwnedDirtSuccessorRecoveryController(adapter);
  const completion = await controller.run({ plan, operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization });
  assert.equal(completion.status, "successor-active");
  assert.equal(completion.sourceBytesChanged, false);
  assert.deepEqual(calls, ["snapshot", "claimSuccessor", "bindSuccessor", "projectLocal",
    "projectPullRequest", "verifyTerminal"]);
  assert.equal(journal.phase, "complete");
  assert.deepEqual(await controller.run({ plan, operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization }), completion);
});

function sourceFixture() {
  const claimId = hex("source"), claimDigest = hex("source-fence"), head = sha("head");
  const authority = { claimId, claimDigest, canonicalBaseSha: sha("base"), laneRevision: head,
    writeSetDigest: hex("write-set"), reviewRequestId: "review:827", leaseEpoch: 1 };
  const lease = { fenceSha: head, cloudAuthority: authority };
  const common = { claimId, repositoryId: "repository:1", actorId: "actor:1",
    workItemId: "work-item:1", canonicalBaseRevision: authority.canonicalBaseSha,
    laneRevision: head, declaredWriteScope: ["path:src/a.ts"],
    writeSetDigest: authority.writeSetDigest, leaseEpoch: 1,
    reviewRequestId: authority.reviewRequestId };
  const sourceCore = { ...common, state: "current", transitionCounter: 2 };
  const terminalCore = { ...common, state: "retired", transitionCounter: 3,
    retirement: { reason: "handoff",
      finalRevision: head, reviewRequestId: authority.reviewRequestId,
      retiredAt: "2026-08-24T00:00:00.000Z" } };
  return { lease, entries: [
    { claimId, claimDigest, digest: hex("source-transition"), claimCore: sourceCore },
    { claimId, repositoryId: common.repositoryId, claimDigest: hex("terminal-fence"),
      digest: hex("terminal-transition"), sequence: 3,
      idempotencyKey: hex("retire-idempotency"), requestDigest: hex("retire-request"),
      evaluationTime: "2026-08-24T00:00:00.000Z",
      claimCore: terminalCore },
  ] };
}

function evidenceFixture() {
  const fixture = sourceFixture();
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "source-session", branch: "agent/device/lane", fenceSha: fixture.lease.fenceSha,
    cloudAuthority: fixture.lease.cloudAuthority };
  const core = { schema: "agentic-terminal-handoff-owned-dirt-successor-recovery-evidence/v1",
    branch: lease.branch, headSha: lease.fenceSha, treeSha: sha("tree"), lease,
    leaseDigest: hex("lease"), sourceClaim: selectTerminalHandoffClaimProof(fixture),
    dirt: {}, dirtEvidenceDigest: hex("dirt"), pullRequest: {},
    pullRequestMarkerDigest: hex("marker"), liveInventory: {},
    targetCapability: {}, targetCapabilityDigest: hex("capability") };
  return { ...core, evidenceDigest: digestValue(core) };
}
