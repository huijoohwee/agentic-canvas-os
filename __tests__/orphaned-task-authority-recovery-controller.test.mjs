import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

import {
  planOrphanedTaskAuthorityRecovery,
  runOrphanedTaskAuthorityRecovery,
} from "../scripts/orphaned-task-authority-recovery-controller.mjs";

const digest = character => character.repeat(64);
const source = Object.freeze({
  schema: "agentic-orphaned-task-authority-source/v1",
  repository: { id: "repo-node", nameWithOwner: "owner/repo" },
  branch: "agent/device/scope", headSha: "a".repeat(40), treeSha: "b".repeat(40),
  worktreeIdentityDigest: digest("1"), leaseDigest: digest("2"), claimId: digest("3"),
  cloudClaimDigest: digest("e"),
  pullRequest: { id: "pr-node", url: "https://github.test/owner/repo/pull/7",
    bodyDigest: digest("4"), bodyRemainderDigest: digest("a"),
    markerDigest: digest("5"), state: "OPEN", isDraft: true },
  taskAuthority: { authoritySubjectId: `urn:agentic-task:${digest("6")}`,
    generation: 1, bindingDigest: digest("7"), publicKeyDigest: digest("8") },
  git: { kind: "dirty", evidenceDigest: digest("9") },
});
const target = Object.freeze({ authoritySubjectId: `urn:agentic-task:${digest("a")}`,
  proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 2,
  publicKey: "MCowBQYDK2VwAyEAo1/9t4vYw+1MZ4D1vR2zq5qfVj8qXq4O0DD5nZw1gCk=",
  publicKeyDigest: digest("b") });
const receipt = kind => {
  const core = { schema: "test-phase-receipt/v1", kind };
  return { ...core, receiptDigest: digestValue(core) };
};

function harness({ loseProjectionResponse = false } = {}) {
  const calls = [];
  let intent = null;
  let localTarget = false;
  let providerTarget = false;
  const journalStore = { read: () => intent, write: value => { intent = value; calls.push(`journal:${value.phase}`); return value; } };
  const adapter = {
    captureSource: async () => { calls.push("capture"); return source; },
    readTargetCapabilityProjection: () => target,
    assertSourceCurrent: async () => { calls.push("revalidate"); return source; },
    createSnapshot: async () => { calls.push("snapshot"); return receipt("snapshot"); },
    createTargetBinding: async () => { calls.push("proof"); return {
      binding: { bindingDigest: digest("d") }, proofReceipt: receipt("proof") }; },
    replaceLocalBinding: async () => { calls.push("local-cas"); localTarget = true; return receipt("local-cas"); },
    observeLocalBinding: async () => localTarget ? receipt("local-cas") : null,
    projectPullRequest: async () => { calls.push("pr-project"); providerTarget = true;
      if (loseProjectionResponse) throw new Error("lost response"); return receipt("pr"); },
    observePullRequestProjection: async () => providerTarget ? receipt("pr") : null,
    verifyTerminal: async () => { calls.push("verify"); return receipt("terminal"); },
  };
  return { adapter, journalStore, calls, readIntent: () => intent };
}

test("controller snapshots before its sole local CAS and journals before PR mutation", async () => {
  const setup = harness();
  const plan = await planOrphanedTaskAuthorityRecovery({
    incidentReference: "incident-reference-1234", lossAttestationDigest: digest("2"),
    plannedAt: "2026-08-23T04:00:00.000Z",
  }, { adapter: setup.adapter });
  const result = await runOrphanedTaskAuthorityRecovery({ plan,
    authorization: plan.exactAuthorization }, setup);
  assert.equal(result.status, "complete");
  assert.ok(setup.calls.indexOf("snapshot") < setup.calls.indexOf("local-cas"));
  assert.ok(setup.calls.indexOf("journal:pr-attempted") < setup.calls.indexOf("pr-project"));
  assert.deepEqual({ sourceBytesChanged: result.sourceBytesChanged,
    cloudMutated: result.cloudMutated, merged: result.merged, deployed: result.deployed },
  { sourceBytesChanged: false, cloudMutated: false, merged: false, deployed: false });
});

test("provider response loss adopts only the exact target and complete replay has no effects", async () => {
  const setup = harness({ loseProjectionResponse: true });
  const plan = await planOrphanedTaskAuthorityRecovery({
    incidentReference: "incident-reference-1234", lossAttestationDigest: digest("2"),
    plannedAt: "2026-08-23T04:00:00.000Z",
  }, { adapter: setup.adapter });
  const first = await runOrphanedTaskAuthorityRecovery({ plan,
    authorization: plan.exactAuthorization }, setup);
  const effects = setup.calls.length;
  const replay = await runOrphanedTaskAuthorityRecovery({ plan,
    authorization: plan.exactAuthorization }, setup);
  assert.deepEqual(replay, first);
  assert.equal(setup.calls.length, effects);
});

test("wrong authorization produces no journal or repository effect", async () => {
  const setup = harness();
  const plan = await planOrphanedTaskAuthorityRecovery({
    incidentReference: "incident-reference-1234", lossAttestationDigest: digest("2"),
    plannedAt: "2026-08-23T04:00:00.000Z",
  }, { adapter: setup.adapter });
  await assert.rejects(runOrphanedTaskAuthorityRecovery({ plan, authorization: "wrong" }, setup),
    /exact authorization/u);
  assert.equal(setup.readIntent(), null);
  assert.deepEqual(setup.calls.filter(value => !value.startsWith("capture")), []);
});

test("source drift blocks before the prepared journal or any recovery effect", async () => {
  const setup = harness();
  const plan = await planOrphanedTaskAuthorityRecovery({
    incidentReference: "incident-reference-1234", lossAttestationDigest: digest("2"),
    plannedAt: "2026-08-23T04:00:00.000Z",
  }, { adapter: setup.adapter });
  setup.adapter.captureSource = async () => ({ ...source, headSha: "c".repeat(40) });
  await assert.rejects(runOrphanedTaskAuthorityRecovery({
    plan,
    authorization: plan.exactAuthorization,
  }, setup), /drifted/u);
  assert.equal(setup.readIntent(), null);
  assert.equal(setup.calls.includes("snapshot"), false);
  assert.equal(setup.calls.includes("local-cas"), false);
  assert.equal(setup.calls.includes("pr-project"), false);
});
