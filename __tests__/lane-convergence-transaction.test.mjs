import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  EFFECT_KEYS,
  REQUEST_SCHEMA,
  buildLaneConvergencePlan,
  createTransitionDecision,
} from "../scripts/lane-convergence-transaction-contract.mjs";
import { createLaneConvergenceController } from
  "../scripts/lane-convergence-transaction-controller.mjs";

const NO_EFFECTS = Object.freeze(Object.fromEntries(EFFECT_KEYS.map((key) => [key, false])));
const RECOVERY_EFFECTS = effects({ cloudMutation: true, localProjectionMutation: true });
const INTEGRATION_EFFECTS = effects({ providerMutation: true, gitRefMutation: true,
  integrationMutation: true });
const CLEANUP_EFFECTS = effects({ cleanupMutation: true });

test("one stable authorization drives response-loss-safe recovery, integration, and cleanup", async () => {
  const plan = createPlan();
  const journal = memoryJournal();
  const state = { complete: new Set(), executions: [], loseFirstRecoveryResponse: true };
  const controller = createLaneConvergenceController({
    adapter: adapterFor({ plan, state }),
    journal,
    now: clock(),
  });

  const receipt = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.transitionCount, 3);
  assert.deepEqual(state.executions, ["recover:lane-a", "integrate:lane-a", "cleanup:lane-b"]);
  assert.equal(journal.readIntent().status, "complete");
  assert.equal(journal.readIntent().authorization.receiptDigest,
    receipt.authorizationReceiptDigest);

  const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, receipt);
  assert.equal(state.executions.length, 3, "terminal replay performs no effects");
});

test("an attempted transition is checkpointed and resumed without a new plan", async () => {
  const plan = createPlan({ subjects: [subjectA()] });
  const journal = memoryJournal();
  const state = { complete: new Set(), executions: [], block: true };
  const controller = createLaneConvergenceController({ adapter: adapterFor({ plan, state }),
    journal, now: clock() });

  await assert.rejects(
    controller.run({ plan, authorization: plan.exactAuthorization }),
    /transition is blocked/u,
  );
  assert.equal(journal.readIntent().transitions.at(-1).status, "attempted");
  const authorizationReceiptDigest = journal.readIntent().authorization.receiptDigest;

  state.block = false;
  const receipt = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.transitionCount, 2);
  assert.equal(receipt.authorizationReceiptDigest, authorizationReceiptDigest);
});

test("authorization is exact and adapter effects cannot exceed the subject ceiling", async () => {
  const plan = createPlan({ subjects: [subjectA()] });
  const journal = memoryJournal();
  const controller = createLaneConvergenceController({
    adapter: adapterFor({ plan, state: { complete: new Set(), executions: [] } }),
    journal,
  });
  await assert.rejects(controller.run({ plan, authorization: `${plan.exactAuthorization} ` }),
    /Exact authorization required/u);
  assert.equal(journal.readIntent(), null);

  const request = requestFor([{
    ...subjectA(),
    effectCeiling: NO_EFFECTS,
  }]);
  assert.throws(() => buildLaneConvergencePlan({ request, adapter: descriptor() }),
    /effect ceiling/u);

  assert.throws(() => buildLaneConvergencePlan({ request: requestFor([
    { ...subjectA(), dependencies: ["lane-b"] },
    { ...subjectB(), dependencies: ["lane-a"] },
  ]), adapter: descriptor() }), /cyclic subject dependency/u);

  assert.throws(() => buildLaneConvergencePlan({ request: requestFor([
    { ...subjectA(), effectCeiling: { ...subjectA().effectCeiling, sourceMutation: "false" } },
  ]), adapter: descriptor() }), /effect ceiling/u);
});

test("plan digest is stable because live observations are adapter inputs, not plan inputs", () => {
  const left = createPlan();
  const right = createPlan();
  assert.equal(left.planDigest, right.planDigest);
  assert.equal(left.exactAuthorization, right.exactAuthorization);
});

test("CLI binds adapter and configuration bytes before terminal execution", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const temporary = mkdtempSync(path.join(tmpdir(), "lane-convergence-cli-"));
  try {
    const adapter = path.join(temporary, "adapter.mjs");
    const configuration = path.join(temporary, "configuration.json");
    const request = path.join(temporary, "request.json");
    const planFile = path.join(temporary, "plan.json");
    const state = path.join(temporary, "state.json");
    const primitives = pathToFileURL(path.join(root, "scripts/cloud-collaboration-primitives.mjs")).href;
    writeFileSync(adapter, `import { digestValue } from ${JSON.stringify(primitives)};
const effects = ${JSON.stringify(NO_EFFECTS)};
export function describe() { return { id: "cli-test", version: "1", actions: [{ action: "observe-only", effects }] }; }
export async function createAdapter({ plan }) { return {
  async observe() { return {}; },
  async next() { return { kind: "terminal", terminal: {} }; },
  async classify() { return { state: "pending" }; },
  async execute() { throw new Error("not called"); },
  async verifyTransition() { throw new Error("not called"); },
  async verifyTerminal() {
    const subjects = plan.subjects.map(subject => ({ subjectId: subject.subjectId, state: subject.targetState, evidenceDigest: digestValue(subject) }));
    const receipts = plan.terminalReceiptTypes.map(type => ({ type, receiptDigest: digestValue({ type }) }));
    const core = { subjects, receipts, completedAt: "2026-08-23T23:00:00.000Z" };
    return { ...core, terminalDigest: digestValue(core) };
  }
}; }
`);
    writeFileSync(configuration, "{}\n");
    writeFileSync(request, `${JSON.stringify(requestFor([{
      ...subjectA(), allowedActions: ["observe-only"], effectCeiling: NO_EFFECTS,
    }]))}\n`);
    const planned = commandJson(root, ["plan", `--request=${request}`, `--adapter=${adapter}`,
      `--configuration=${configuration}`, "--json"]);
    assert.equal(planned.ok, true);
    writeFileSync(planFile, `${JSON.stringify(planned.plan)}\n`);
    const completed = commandJson(root, ["run", `--plan=${planFile}`, `--adapter=${adapter}`,
      `--configuration=${configuration}`, `--state=${state}`,
      `--authorize=${planned.exactAuthorization}`, "--json"]);
    assert.equal(completed.status, "complete");
    assert.equal(completed.receipt.transitionCount, 0);

    writeFileSync(configuration, "{\"drift\":true}\n");
    const drift = commandJson(root, ["run", `--plan=${planFile}`, `--adapter=${adapter}`,
      `--configuration=${configuration}`, `--state=${state}`,
      `--authorize=${planned.exactAuthorization}`, "--json"], { allowFailure: true });
    assert.equal(drift.ok, false);
    assert.match(drift.error.message, /configuration drifted/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

function createPlan({ subjects = [subjectA(), subjectB()] } = {}) {
  return buildLaneConvergencePlan({ request: requestFor(subjects), adapter: descriptor() });
}

function requestFor(subjects) {
  return {
    schema: REQUEST_SCHEMA,
    transactionId: "knowgrph-storage-lane-convergence",
    objective: "Converge preserved lane value, integration, and exact cleanup.",
    subjects,
    maxTransitions: 8,
    terminalReceiptTypes: ["integration", "cleanup"],
  };
}

function subjectA() {
  return {
    subjectId: "lane-a",
    repository: "example/repository",
    lane: "agent/device/lane-a",
    targetState: "integrated",
    dependencies: [],
    allowedActions: ["recover", "integrate"],
    effectCeiling: effects({ cloudMutation: true, providerMutation: true,
      localProjectionMutation: true, gitRefMutation: true, integrationMutation: true }),
  };
}

function subjectB() {
  return {
    subjectId: "lane-b",
    repository: "example/repository",
    lane: "agent/device/lane-b",
    targetState: "retired",
    dependencies: ["lane-a"],
    allowedActions: ["cleanup"],
    effectCeiling: CLEANUP_EFFECTS,
  };
}

function descriptor() {
  return {
    id: "test-lane-convergence-adapter",
    version: "1",
    moduleDigest: "1".repeat(64),
    configurationDigest: "2".repeat(64),
    actions: [
      { action: "recover", effects: RECOVERY_EFFECTS },
      { action: "integrate", effects: INTEGRATION_EFFECTS },
      { action: "cleanup", effects: CLEANUP_EFFECTS },
    ],
  };
}

function adapterFor({ plan, state }) {
  return {
    async observe() { return { complete: [...state.complete], observedAt: new Date().toISOString() }; },
    async next() {
      if (!state.complete.has("recover:lane-a")) return decision("lane-a", "recover", RECOVERY_EFFECTS);
      if (!state.complete.has("integrate:lane-a")) return decision("lane-a", "integrate", INTEGRATION_EFFECTS);
      if (plan.subjects.some((subject) => subject.subjectId === "lane-b")
        && !state.complete.has("cleanup:lane-b")) return decision("lane-b", "cleanup", CLEANUP_EFFECTS);
      return { kind: "terminal", terminal: { candidate: true } };
    },
    async classify({ decision }) {
      return state.complete.has(decision.operationKey)
        ? { state: "complete", evidence: { operationKey: decision.operationKey,
          evidenceDigest: digestValue({ operationKey: decision.operationKey }) } }
        : { state: "pending" };
    },
    async execute({ decision, grant }) {
      assert.equal(grant.planDigest, plan.planDigest);
      assert.equal(grant.transitionDigest, decision.transitionDigest);
      if (state.block) throw new Error("transition is blocked");
      state.executions.push(decision.operationKey);
      state.complete.add(decision.operationKey);
      if (decision.action === "recover" && state.loseFirstRecoveryResponse) {
        state.loseFirstRecoveryResponse = false;
        throw new Error("simulated response loss");
      }
      return { operationKey: decision.operationKey };
    },
    async verifyTransition({ decision, classification }) {
      const core = { schema: "agentic-test-transition-receipt/v1",
        operationKey: decision.operationKey, transitionDigest: decision.transitionDigest,
        status: "complete", evidenceDigest: classification.evidenceDigest };
      return { ...core, receiptDigest: digestValue(core) };
    },
    async verifyTerminal() {
      const subjects = plan.subjects.map((subject) => ({ subjectId: subject.subjectId,
        state: subject.targetState, evidenceDigest: digestValue({ subjectId: subject.subjectId,
          state: subject.targetState }) }));
      const receipts = [
        { type: "integration", receiptDigest: digestValue({ type: "integration" }) },
        { type: "cleanup", receiptDigest: digestValue({ type: "cleanup" }) },
      ];
      const core = { subjects, receipts, completedAt: "2026-08-23T23:00:00.000Z" };
      return { ...core, terminalDigest: digestValue(core) };
    },
  };

  function decision(subjectId, action, actionEffects) {
    return createTransitionDecision({ plan, subjectId, action,
      operationKey: `${action}:${subjectId}`,
      preconditionDigest: digestValue({ subjectId, action, complete: [...state.complete].sort() }),
      effects: actionEffects });
  }
}

function memoryJournal() {
  let value = null;
  return {
    readIntent() { return value; },
    writeIntent({ expectedIntent, nextIntent }) {
      assert.equal(value?.intentDigest || null, expectedIntent?.intentDigest || null);
      value = nextIntent;
      return value;
    },
    async withOperationLock(action) { return action({ token: "test" }); },
  };
}

function effects(overrides = {}) { return Object.freeze({ ...NO_EFFECTS, ...overrides }); }
function clock() { let tick = 0; return () => new Date(Date.parse("2026-08-23T22:00:00.000Z") + tick++ * 1000); }
function commandJson(root, args, { allowFailure = false } = {}) {
  try {
    return JSON.parse(execFileSync(process.execPath,
      [path.join(root, "scripts/lane-convergence-transaction.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    if (!allowFailure) throw error;
    return JSON.parse(String(error.stdout));
  }
}
