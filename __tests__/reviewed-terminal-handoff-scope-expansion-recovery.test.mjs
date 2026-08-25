import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizeScopeExpansionRecovery, buildScopeExpansionRecoveryPlan,
  normalizeScopeExpansionRecoveryIntent, normalizeScopeExpansionRecoveryPlan,
} from "../scripts/reviewed-terminal-handoff-scope-expansion-recovery-contract.mjs";
import { createReviewedTerminalHandoffScopeExpansionRecoveryController }
  from "../scripts/reviewed-terminal-handoff-scope-expansion-recovery-controller.mjs";
import {
  buildScopeExpansionTargetAdmission, sealScopeExpansionRecoveryEvidence,
} from "../scripts/reviewed-terminal-handoff-scope-expansion-recovery-evidence.mjs";
import { buildScopeExpansionSourceRecoveryEvidenceDigest }
  from "../scripts/reviewed-terminal-handoff-scope-expansion-recovery-repository-adapter.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function admission() {
  const declaredWriteSet = ["path:a.js", "semantic:scope"];
  return { schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "scope", declaredWriteSet, writeSetDigest: digestValue(declaredWriteSet),
    manifestDigest: digest("a"), planReceiptDigest: digest("b"), admissionReceiptDigest: digest("c"),
    existingLaneStateDigest: digest("d"), admittedReportDigest: digest("e"),
    preservationReceiptDigest: digest("f") };
}

function targetManifest(paths = ["a.js", "b.js"]) {
  const core = { schema: "agentic-declared-write-scope/v1", semanticScope: "scope", paths };
  const declaredWriteSet = paths.map(item => `path:${item}`).concat("semantic:scope").sort();
  return { ...core, declaredWriteSet, writeSetDigest: digestValue(declaredWriteSet),
    manifestDigest: digestValue(core) };
}

function evidence(overrides = {}) {
  const sourceClaim = { claimId: digest("1"), fenceRevision: digest("2"), transitionCounter: 2,
    state: "current", workItemId: "work-item:x", canonicalBaseRevision: sha("3"),
    laneRevision: sha("4"), writeSetDigest: admission().writeSetDigest,
    reviewRequestId: "github-pull-request:pr", operationReceiptDigest: digest("5") };
  return sealScopeExpansionRecoveryEvidence({ branch: "agent/device/scope", headSha: sha("4"),
    treeSha: sha("6"), localLeaseDigest: digest("7"), localClaimId: digest("8"),
    sourceAdmission: admission(), sourceJournalPath: "/tmp/source.json",
    sourceJournalBytesDigest: digest("9"), sourceJournalEnvelopeDigest: digest("a"),
    sourceJournalIntentDigest: digest("b"), sourceJournalPlanDigest: digest("c"),
    sourceJournalPhase: "successor-bound",
    sourceJournalSuccessor: { claimId: sourceClaim.claimId, claimDigest: sourceClaim.fenceRevision,
      transitionCounter: sourceClaim.transitionCounter, operationReceiptDigest: sourceClaim.operationReceiptDigest },
    sourceOperatorSessionId: "source-session", sourceClaim,
    pullRequest: { url: "https://github.com/o/r/pull/1", number: 1, id: "pr",
      baseSha: sha("3"), headSha: sha("4"), bodyRemainderDigest: digest("f"), filesDigest: digest("0") },
    changedPaths: ["a.js", "b.js"], missingPaths: ["b.js"], targetManifest: targetManifest(),
    taskCapabilityDigest: digest("1"), ...overrides });
}

test("plan seals strict-superset authorization and normalizes exactly", () => {
  const plan = buildScopeExpansionRecoveryPlan({ evidence: evidence(),
    operatorSessionId: "target-session", ttlSeconds: 120 });
  assert.deepEqual(normalizeScopeExpansionRecoveryPlan(plan), plan);
  assert.match(plan.exactAuthorization,
    /^authorize reviewed-terminal-handoff-scope-expansion-recovery [0-9a-f]{64}$/u);
  assert.equal(authorizeScopeExpansionRecovery({ plan,
    authorization: plan.exactAuthorization }).planDigest, plan.planDigest);
  assert.throws(() => authorizeScopeExpansionRecovery({ plan, authorization: "authorize broad repair" }),
    /exact authorization/u);
});

test("evidence rejects a target manifest that adds paths absent from the PR gap", () => {
  assert.throws(() => buildScopeExpansionRecoveryPlan({ evidence: evidence({
    targetManifest: targetManifest(["a.js", "b.js", "c.js"]),
  }), operatorSessionId: "target-session" }), /target scope additions/u);
});

test("target admission preserves source lane evidence and binds the expanded claim", () => {
  const result = buildScopeExpansionTargetAdmission({ sourceAdmission: admission(),
    targetManifest: targetManifest(), planDigest: digest("2"),
    operationReceiptDigest: digest("3"), claimId: digest("4") });
  assert.deepEqual(result.declaredWriteSet, targetManifest().declaredWriteSet);
  assert.equal(result.existingLaneStateDigest, admission().existingLaneStateDigest);
  assert.equal(result.admissionReceiptDigest, digest("3"));
});

test("source recovery derives a cloud-safe digest from the journaled operation key", () => {
  const input = {
    operationKey: "reviewed-terminal-handoff-scope-expansion-recovery:source-recovered:operation",
    planDigest: digest("2"),
    sourceClaimId: digest("3"),
  };
  const result = buildScopeExpansionSourceRecoveryEvidenceDigest(input);
  assert.match(result, /^[0-9a-f]{64}$/u);
  assert.equal(result, buildScopeExpansionSourceRecoveryEvidenceDigest(input));
  assert.notEqual(result, buildScopeExpansionSourceRecoveryEvidenceDigest({
    ...input,
    operationKey: `${input.operationKey}:drift`,
  }));
  assert.notEqual(result, buildScopeExpansionSourceRecoveryEvidenceDigest({
    ...input,
    planDigest: digest("4"),
  }));
  assert.notEqual(result, buildScopeExpansionSourceRecoveryEvidenceDigest({
    ...input,
    sourceClaimId: digest("5"),
  }));
  assert.throws(() => buildScopeExpansionSourceRecoveryEvidenceDigest({
    ...input,
    planDigest: "not-a-digest",
  }), /plan digest is invalid/u);
});

test("controller journals every effect and completes without granting integration", async () => {
  const source = evidence();
  let stored = null;
  const effects = {
    recoverSource: { claimId: digest("1"), claimDigest: digest("2"), transitionCounter: 3 },
    claimSuccessor: { claimId: digest("3"), claimDigest: digest("4"), transitionCounter: 1 },
    retireSource: { receiptDigest: digest("5") }, promoteSuccessor: { receiptDigest: digest("6") },
    bindSuccessor: { receiptDigest: digest("7") }, markSuccessorReviewReady: { receiptDigest: digest("8") },
    projectLocal: { receiptDigest: digest("9") }, projectPullRequest: { receiptDigest: digest("a") },
    archiveSourceJournal: { receiptDigest: digest("b") }, verifyTerminal: { receiptDigest: digest("c") },
  };
  const adapter = { withFence: action => action(), captureEvidence: async () => source,
    readIntent: async () => stored,
    writeIntent: async ({ expected, value }) => { assert.equal(stored, expected); stored = value; },
    reconcile: async () => null };
  for (const [name, values] of Object.entries(effects)) adapter[name] = async () => values;
  const controller = createReviewedTerminalHandoffScopeExpansionRecoveryController(adapter);
  const plan = await controller.plan({ operatorSessionId: "target-session", ttlSeconds: 120 });
  const completion = await controller.run({ plan, operatorSessionId: "target-session",
    authorization: plan.exactAuthorization });
  assert.equal(completion.status, "successor-review-ready");
  assert.equal(completion.integrationAuthorityRestored, false);
  assert.equal(normalizeScopeExpansionRecoveryIntent(stored).phase, "complete");
});
