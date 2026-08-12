// Responsibility: prove one-shot terminal recovery authorization, replay, and fail-closed boundaries.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createActiveDirtyScopeExpansionIntentRecoveryController,
} from "../scripts/active-dirty-scope-expansion-intent-recovery-controller.mjs";

const PLAN_DIGEST = digestValue({ fixture: "terminal recovery plan" });
const AUTHORIZATION =
  `authorize active-dirty-scope-expansion-intent-recovery ${PLAN_DIGEST}`;

test("plan is read-only and returns one exact repository-derived authorization", async () => {
  const harness = createHarness();
  const result = await harness.controller.plan();

  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, PLAN_DIGEST);
  assert.equal(result.exactAuthorization, AUTHORIZATION);
  assert.deepEqual(harness.counts, {
    effects: 0,
    fences: 0,
    intentReads: 1,
    observations: 0,
    sourceReads: 1,
    writes: 0,
  });
});

test("run persists exact authorization before its sole terminal effect", async () => {
  const harness = createHarness();
  const result = await runPlanned(harness);

  assert.equal(result.status, "complete");
  assert.equal(result.planDigest, PLAN_DIGEST);
  assert.equal(result.authoringAuthority, false);
  assert.equal(result.deployment, false);
  assert.equal(result.receipt.planDigest, PLAN_DIGEST);
  assert.deepEqual(harness.persistedStatuses, ["authorized", "complete"]);
  assert.equal(harness.counts.effects, 1);
  assert.ok(harness.events.indexOf("persist:authorized")
    < harness.events.indexOf("effect:terminal"));
  assert.deepEqual(harness.events.filter(value => value.startsWith("observe:")), [
    "observe:pending",
    "observe:complete",
  ]);
});

test("missing or non-byte-exact authority performs no journal write or effect", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.controller.run({ authorization: AUTHORIZATION }),
    /requires an exact plan digest/u,
  );
  for (const authorization of [
    `${AUTHORIZATION}\n`,
    AUTHORIZATION.toUpperCase(),
    ` ${AUTHORIZATION}`,
  ]) {
    await assert.rejects(harness.controller.run({
      planDigest: PLAN_DIGEST,
      authorization,
    }), /requires exact authorization/u);
  }
  assert.equal(harness.intent, null);
  assert.equal(harness.counts.writes, 0);
  assert.equal(harness.counts.effects, 0);
});

test("adopts a lost terminal effect response without repeating the effect", async () => {
  const harness = createHarness({ loseEffectResponse: true });
  const result = await runPlanned(harness);
  assert.equal(result.status, "complete");
  assert.equal(harness.counts.effects, 1);

  const replay = await runPlanned(harness);
  assert.deepEqual(replay.receipt, result.receipt);
  assert.equal(harness.counts.effects, 1);
});

test("resumes a lost complete-journal response without repeating the effect", async () => {
  const harness = createHarness({ loseCompleteWriteResponse: true });
  await assert.rejects(runPlanned(harness), /journal response lost/u);
  assert.equal(harness.intent.status, "complete");
  assert.equal(harness.counts.effects, 1);

  const result = await runPlanned(harness);
  assert.equal(result.status, "complete");
  assert.equal(harness.counts.effects, 1);
});

test("adopts an already-live exact terminal operation without invoking its effect", async () => {
  const harness = createHarness({ initiallyComplete: true });
  const result = await runPlanned(harness);
  assert.equal(result.status, "complete");
  assert.equal(harness.counts.effects, 0);
  assert.deepEqual(harness.persistedStatuses, ["authorized", "complete"]);
});

test("rejects terminal observation drift and an effect response with another operation key", async () => {
  const drift = createHarness({ driftTerminal: true });
  await assert.rejects(runPlanned(drift), /terminal observation drift/u);
  assert.equal(drift.counts.effects, 0);
  assert.deepEqual(drift.persistedStatuses, ["authorized"]);

  const wrongKey = createHarness({ wrongOperationKey: true });
  await assert.rejects(runPlanned(wrongKey), /changed its operation key/u);
  assert.equal(wrongKey.counts.effects, 1);
  assert.deepEqual(wrongKey.persistedStatuses, ["authorized"]);
});

test("fails closed when the terminal effect returns before live convergence", async () => {
  const harness = createHarness({ effectDoesNotConverge: true });
  await assert.rejects(
    runPlanned(harness),
    /did not become live-complete/u,
  );
  assert.equal(harness.counts.effects, 1);
  assert.deepEqual(harness.persistedStatuses, ["authorized"]);
});

test("rejects a stored authorization journal from another exact plan authority", async () => {
  const harness = createHarness();
  await runPlanned(harness);
  harness.replaceIntent({
    ...harness.intent,
    status: "authorized",
    authorizationDigest: digestValue({ fixture: "foreign authorization" }),
    intentDigest: digestValue({ fixture: "foreign intent" }),
  });
  await assert.rejects(runPlanned(harness), /authorization drifted/u);
  assert.equal(harness.counts.effects, 1);
});

function createHarness({
  driftTerminal = false,
  effectDoesNotConverge = false,
  initiallyComplete = false,
  loseCompleteWriteResponse = false,
  loseEffectResponse = false,
  wrongOperationKey = false,
} = {}) {
  const sourceEvidence = Object.freeze({
    schema: "test-source-evidence/v1",
    sourceEvidenceDigest: digestValue({ fixture: "source evidence" }),
  });
  const plan = Object.freeze({
    schema: "test-recovery-plan/v1",
    sourceEvidence,
    sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
    planDigest: PLAN_DIGEST,
    exactAuthorization: AUTHORIZATION,
  });
  let intent = null;
  let terminal = initiallyComplete;
  let lostEffect = false;
  let lostWrite = false;
  const persistedStatuses = [];
  const events = [];
  const counts = {
    effects: 0,
    fences: 0,
    intentReads: 0,
    observations: 0,
    sourceReads: 0,
    writes: 0,
  };
  const contract = fakeContract(plan);
  const evidence = fakeEvidence();
  const adapter = {
    async withEntrypointFence(subject, action) {
      counts.fences += 1;
      assert.equal(subject.planDigest, PLAN_DIGEST);
      return action();
    },
    async readSourceEvidence() {
      counts.sourceReads += 1;
      return sourceEvidence;
    },
    async readIntent() {
      counts.intentReads += 1;
      return intent;
    },
    async writeIntent({ expectedIntent, nextIntent }) {
      counts.writes += 1;
      assert.equal(expectedIntent?.intentDigest ?? null, intent?.intentDigest ?? null);
      intent = nextIntent;
      persistedStatuses.push(intent.status);
      events.push(`persist:${intent.status}`);
      if (intent.status === "complete" && loseCompleteWriteResponse && !lostWrite) {
        lostWrite = true;
        throw new Error("complete journal response lost");
      }
      return intent;
    },
    async observeTerminal({ operationKey }) {
      counts.observations += 1;
      events.push(`observe:${terminal ? "complete" : "pending"}`);
      if (driftTerminal) return { state: "drifted" };
      if (!terminal) return { state: "pending" };
      return terminalObservation(operationKey);
    },
    async executeTerminal({ operationKey }) {
      counts.effects += 1;
      events.push("effect:terminal");
      terminal = !effectDoesNotConverge;
      if (loseEffectResponse && !lostEffect) {
        lostEffect = true;
        throw new Error("terminal effect response lost");
      }
      return {
        operationKey: wrongOperationKey
          ? digestValue({ fixture: "wrong operation" })
          : operationKey,
      };
    },
  };
  return {
    controller: createActiveDirtyScopeExpansionIntentRecoveryController({
      adapter,
      contract,
      evidence,
    }),
    counts,
    events,
    persistedStatuses,
    get intent() { return intent; },
    replaceIntent(value) { intent = value; },
  };
}

function fakeContract(plan) {
  const normalizePlan = value => {
    if (value?.planDigest !== PLAN_DIGEST) throw new Error("plan drift");
    return value;
  };
  const normalizeIntent = value => {
    if (!value || !["authorized", "complete"].includes(value.status)) {
      throw new Error("intent malformed");
    }
    return value;
  };
  return {
    buildActiveDirtyScopeExpansionIntentRecoveryPlan: ({ sourceEvidence }) => {
      assert.deepEqual(sourceEvidence, plan.sourceEvidence);
      return plan;
    },
    normalizeActiveDirtyScopeExpansionIntentRecoveryPlan: normalizePlan,
    authorizeActiveDirtyScopeExpansionIntentRecovery: (value, authorization) => {
      normalizePlan(value);
      if (authorization !== AUTHORIZATION) {
        throw new Error(`Recovery requires exact authorization: ${AUTHORIZATION}`);
      }
      return { authorizationDigest: digestValue({ planDigest: PLAN_DIGEST, authorization }) };
    },
    createActiveDirtyScopeExpansionIntentRecoveryIntent: (value, receipt) => sealIntent({
      status: "authorized",
      planDigest: value.planDigest,
      planSnapshot: value,
      authorizationDigest: receipt.authorizationDigest,
      terminalObservation: null,
    }),
    normalizeActiveDirtyScopeExpansionIntentRecoveryIntent: normalizeIntent,
    completeActiveDirtyScopeExpansionIntentRecoveryIntent: (value, observation) => sealIntent({
      ...value,
      status: "complete",
      terminalObservation: observation,
    }),
    activeDirtyScopeExpansionIntentRecoveryOperationKey: (planDigest, authorizationDigest) =>
      digestValue({ schema: "test-operation-key/v1", planDigest, authorizationDigest }),
    buildActiveDirtyScopeExpansionIntentRecoveryReceipt: value => ({
      schema: "test-recovery-receipt/v1",
      status: "complete",
      planDigest: value.planDigest,
      completeIntentDigest: value.intentDigest,
      receiptDigest: digestValue({
        planDigest: value.planDigest,
        completeIntentDigest: value.intentDigest,
      }),
    }),
    normalizeActiveDirtyScopeExpansionIntentRecoveryReceipt: (value, expected) => {
      assert.equal(value.completeIntentDigest, expected.intentDigest);
      return value;
    },
  };
}

function fakeEvidence() {
  return {
    classifyActiveDirtyScopeExpansionIntentRecoveryTerminal: (value, expected) => {
      if (value?.state === "pending") return { state: "pending", observation: null };
      if (value?.state !== "complete") throw new Error("terminal observation drift");
      return { state: "complete", observation: value };
    },
    normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation: (value, expected) => {
      assert.equal(value.planDigest, expected.planDigest);
      assert.equal(value.operationKey, expected.operationKey);
      return value;
    },
  };
}

function terminalObservation(operationKey) {
  const core = {
    schema: "test-terminal-observation/v1",
    state: "complete",
    planDigest: PLAN_DIGEST,
    operationKey,
    currentAuthorityDigest: digestValue({ fixture: "C4 authority" }),
    heartbeatLineageDigest: digestValue({ fixture: "C3 to C4 heartbeat" }),
    mutationAuthorityReceiptDigest: digestValue({ fixture: "mutation authority" }),
    pullRequestMarkerDigest: digestValue({ fixture: "C4 PR marker" }),
    recoveredIntentDigest: digestValue({ fixture: "complete original intent" }),
  };
  return Object.freeze({
    ...core,
    observationDigest: digestValue(core),
  });
}

function sealIntent(core) {
  const { intentDigest: _ignored, ...withoutDigest } = core;
  return Object.freeze({ ...withoutDigest, intentDigest: digestValue(withoutDigest) });
}

function runPlanned(harness) {
  return harness.controller.run({
    planDigest: PLAN_DIGEST,
    authorization: AUTHORIZATION,
  });
}
