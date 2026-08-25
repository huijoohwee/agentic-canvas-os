import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createLostCapabilityOwnerRecoveryController }
  from "../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-controller.mjs";
import { authorizeLostCapabilityOwnerRecovery, buildLostCapabilityOwnerRecoveryPlan }
  from "../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-contract.mjs";
import { EVIDENCE_SCHEMA, sealLostCapabilityOwnerRecoveryEvidence }
  from "../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-evidence.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function evidence() {
  const targetCapability = { authoritySubjectId: `urn:agentic-task:${digest("2")}`,
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 3,
    publicKey: "target-public-key", publicKeyDigest: digest("3") };
  return sealLostCapabilityOwnerRecoveryEvidence({ schema: EVIDENCE_SCHEMA,
    repository: "/tmp/knowgrph-lane", branch: "agent/device/scope", headSha: sha("a"), treeSha: sha("b"),
    sourceLeaseDigest: digest("4"), sourceBinding: { authoritySubjectId: `urn:agentic-task:${digest("1")}`,
      generation: 2, publicKeyDigest: digest("5"), bindingDigest: digest("6") },
    sourceClaim: { claimId: digest("7"), fenceRevision: digest("8"), transitionCounter: 2,
      state: "current", canonicalBaseRevision: sha("c"), laneRevision: sha("a"),
      writeSetDigest: digest("9"), reviewRequestId: "github-pull-request:1" },
    sourceJournalPath: "/tmp/journal.json", sourceJournalBytesDigest: digest("a"),
    pullRequest: { url: "https://example.test/pull/1", number: 1, id: "PR_1", baseSha: sha("c"),
      headSha: sha("a"), bodyRemainderDigest: digest("b"), filesDigest: digest("c") },
    changedPaths: ["a", "b"], missingPaths: ["b"], targetManifest: {
      schema: "agentic-declared-write-scope/v1", semanticScope: "scope",
      declaredWriteSet: ["path:a", "path:b", "semantic:scope"],
      writeSetDigest: digest("d"), manifestDigest: digest("e") },
    targetCapability, targetCapabilityDigest: digestValue(targetCapability) });
}

test("plan binds exact authorization and rejects a wrong statement", () => {
  const plan = buildLostCapabilityOwnerRecoveryPlan(evidence());
  assert.match(plan.exactAuthorization, new RegExp(`${plan.planDigest}$`, "u"));
  assert.throws(() => authorizeLostCapabilityOwnerRecovery(plan, "authorize wrong"), /Exact authorization required/u);
});

test("controller journals before CAS and replays a completed receipt", () => {
  const events = [], journals = new Map();
  const completion = { schema: "agentic-reviewed-scope-expansion-lost-capability-owner-recovery-completion/v1",
    status: "recovered", receiptDigest: digest("f") };
  const adapter = { captureEvidence: evidence, now: () => "2026-08-25T00:00:00.000Z",
    assertStable: () => events.push("stable"), readJournal: key => journals.get(key) || null,
    writeJournal: (key, value) => { events.push(`journal:${value.phase}`); journals.set(key, value); },
    projectBinding: () => { events.push("binding"); return { receiptDigest: digest("1") }; },
    projectPullRequest: () => { events.push("marker"); return completion; },
    verifyComplete: () => events.push("verified") };
  const controller = createLostCapabilityOwnerRecoveryController(adapter);
  const plan = controller.plan();
  const first = controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(first.receiptDigest, completion.receiptDigest);
  assert.deepEqual(events.slice(0, 3), ["stable", "journal:prepared", "binding"]);
  const count = events.filter(item => item === "binding").length;
  controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(events.filter(item => item === "binding").length, count);
});

test("replacement must advance exactly one generation and change subject", () => {
  const value = structuredClone(evidence());
  value.targetCapability.generation = 4;
  value.targetCapabilityDigest = digestValue(value.targetCapability);
  delete value.evidenceDigest;
  assert.throws(() => sealLostCapabilityOwnerRecoveryEvidence(value), /replacement capability transition/u);
});
