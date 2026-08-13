import assert from "node:assert/strict";
import test from "node:test";
import { buildProvisionedStartAdmissionRecoveryPlan } from "../scripts/provisioned-start-admission-recovery-contract.mjs";
import { createProvisionedStartAdmissionRecoveryController } from "../scripts/provisioned-start-admission-recovery-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const d = value => digestValue({ value });
const sha = character => character.repeat(40);
function evidence() {
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "planned", semanticScope: "scope",
    declaredWriteSet: ["path:docs/a.md", "semantic:scope"], writeSetDigest: d(1), manifestDigest: d(2),
    planReceiptDigest: d(3), admissionReceiptDigest: d(4), existingLaneStateDigest: d(5) };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", sessionId: "s", device: "d", scope: "scope",
    branch: "agent/d/scope", worktreePath: "/tmp/w", epoch: 1, fenceSha: sha("a"),
    pullRequestUrl: "https://example.test/pull/1", admission, taskAuthority: { digest: d(6) },
    cloudAuthority: { claimId: d(7) } };
  return { lease, descendant: { fenceSha: sha("a"), headSha: sha("b"), treeSha: sha("c"), clean: true,
    linear: true, paths: ["docs/a.md"], rangeDiffDigest: d(8), commits: [{ sha: sha("b"), treeSha: sha("c"),
      parentSha: sha("a"), message: "fix: a" }] }, pullRequest: { id: "P", number: 1, url: lease.pullRequestUrl,
      state: "OPEN", isDraft: true, autoMergeRequest: null, branch: lease.branch, headSha: sha("a"),
      baseSha: sha("0"), bodyDigest: d(9) }, cloud: { status: "ready", state: "active", writeAuthority: true,
      scopeReserved: true, claimId: d(7), claimDigest: d(10), laneRevision: sha("a"), transitionCounter: 1,
      heartbeatCounter: 0, ledgerRevision: sha("d"), ledgerDigest: d(11), verificationReceiptDigest: d(12),
      verifier: { adapterId: "test-verifier", schema: "test-verification/v1", version: 1,
        subjectDigest: d("verified subject") } } };
}

test("controller replays response loss while fresh verifier receipts change for the same subject", () => {
  const source = evidence();
  const plan = buildProvisionedStartAdmissionRecoveryPlan(source);
  let localCalls = 0; let localMutations = 0; let markerCalls = 0; let terminalCalls = 0; let intent = null; let loseOnce = true;
  let verificationChecks = 0;
  const adapter = { readEvidence: () => source, assertPlanPreimage: () => source,
    assertFreshVerification: () => { verificationChecks += 1; return { receiptDigest: d(`fresh ${verificationChecks}`) }; },
    projectLocal: () => { localCalls += 1; if (loseOnce) { loseOnce = false; localMutations += 1;
      throw new Error("simulated response loss"); } return { lease: { value: 1 }, projection: { value: 1 }, adopted: true }; },
    projectMarker: () => ({ bodyDigest: d("body"), markerDigest: d("marker"), adopted: markerCalls++ > 0 }),
    verifyTerminal: () => ({ terminal: ++terminalCalls > 0 }) };
  const store = { read: () => intent, begin({ plan: input, authorization, startedAt }) { if (!intent) intent = { phase: "intent", phases: { intent: phaseReceipt("intent", {}) },
      planDigest: input.planDigest, evidenceDigest: digestValue(input.evidence), authorizationDigest: authorization.authorizationDigest,
      startedAt }; return intent; }, advance({ expectedPhase, phase, values }) { if (phase === "local-projected" && loseOnce) {
      throw new Error("unexpected pre-effect state"); }
    assert.equal(intent.phase, expectedPhase); intent = { ...intent, phase, phases: { ...intent.phases,
      [phase]: phaseReceipt(phase, values) } }; return intent; } };
  const times = [0, 1, 2, 3, 4, 5].map(second => new Date(`2026-08-14T00:00:0${second}.000Z`));
  const controller = createProvisionedStartAdmissionRecoveryController({ adapter, intentStore: store, clock: () => times.shift() });
  const authorization = `authorize provisioned-start-admission-recovery ${plan.planDigest}`;
  assert.throws(() => controller.execute({ sealedPlan: plan, authorization }), /response loss/u);
  const result = controller.execute({ sealedPlan: plan, authorization });
  assert.equal(result.status, "admitted");
  assert.equal(localCalls, 2);
  assert.equal(localMutations, 1);
  assert.equal(markerCalls, 1);
  assert.equal(terminalCalls, 2);
  assert.equal(verificationChecks, 5);
});

function phaseReceipt(phase, values) { return { phase, values, receiptDigest: d(phase) }; }
