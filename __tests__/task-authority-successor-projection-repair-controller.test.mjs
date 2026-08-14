// Responsibility: prove exact authority, phase reconciliation, barriers, replay, and strict CLI input.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createTaskAuthoritySuccessorProjectionRepairController }
  from "../scripts/task-authority-successor-projection-repair-controller.mjs";
import { main, parseTaskAuthoritySuccessorProjectionRepairArguments }
  from "../scripts/task-authority-successor-projection-repair.mjs";

const PLAN_DIGEST = "a".repeat(64);
const AUTHORIZATION =
  `authorize task-authority-successor-projection-repair ${PLAN_DIGEST}`;
const PHASES = [
  "projection_prepared", "successor_promoted", "successor_bound",
  "lease_projected", "marker_projected", "expansion_finalized", "verified",
];
const IRREVERSIBLE = PHASES.slice(1);
const EFFECTS = Object.freeze({
  projection_prepared: "prepareProjection",
  successor_promoted: "promoteSuccessor",
  successor_bound: "bindSuccessor",
  lease_projected: "projectLease",
  marker_projected: "projectMarker",
  expansion_finalized: "finalizeExpansion",
  verified: "verifyTerminal",
});

test("plan is read-only", async () => {
  const fixture = harness();
  assert.equal(await fixture.controller.plan(), fixture.plan);
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.intent, null);
  assert.deepEqual(Object.values(fixture.effects), PHASES.map(() => 0));
});

test("controller journals projection preparation before irreversible effects", async () => {
  const fixture = harness();
  const receipt = await fixture.controller.run({
    plan: fixture.plan,
    authorization: AUTHORIZATION,
  });
  assert.equal(receipt.receiptDigest, fixture.intent.receipt.receiptDigest);
  assert.equal(fixture.intent.status, "complete");
  assert.ok(fixture.events.indexOf("write:projection_prepared")
    < fixture.events.indexOf("effect:successor_promoted"));
  for (const phase of PHASES) {
    const expected = [
      `reconcile:${phase}`,
      `revalidate:${phase}`,
      ...(IRREVERSIBLE.includes(phase) ? [`barrier:${phase}`] : []),
      `effect:${phase}`,
    ];
    assert.deepEqual(
      fixture.events.filter(event => event.endsWith(`:${phase}`)).slice(0, expected.length),
      expected,
    );
    assert.equal(fixture.events.filter(event => event === `reconcile:${phase}`).length, 2);
  }
  assert.deepEqual(fixture.events.slice(-4), [
    "barrier:complete", "effect:verified:fresh", "archive", "fence:end",
  ]);
  assert.equal(fixture.events.includes("archive"), true);
});

test("every effect adopts only its unconditional live post-reconciliation", async () => {
  const fixture = harness({ loseResponseAt: "successor_promoted" });
  await fixture.controller.run({ plan: fixture.plan, authorization: AUTHORIZATION });
  assert.equal(fixture.effects.successor_promoted, 1);
  assert.equal(fixture.intent.status, "complete");

  const replay = await fixture.controller.run({
    plan: fixture.plan,
    authorization: AUTHORIZATION,
  });
  assert.equal(replay.receiptDigest, fixture.intent.receipt.receiptDigest);
  for (const phase of PHASES) assert.equal(fixture.effects[phase], 1);
  assert.equal(fixture.events.filter(event => event === "effect:verified:fresh").length, 2);
  assert.equal(fixture.events.filter(event => event === "archive").length, 2);
});

test("exact authorization and current plan are required before the fence or effects", async () => {
  const fixture = harness();
  await assert.rejects(
    fixture.controller.run({ plan: fixture.plan, authorization: `${AUTHORIZATION}\n` }),
    /authorization/u,
  );
  fixture.driftPlan();
  await assert.rejects(
    fixture.controller.run({ plan: fixture.plan, authorization: AUTHORIZATION }),
    /evidence changed/u,
  );
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.intent, null);
});

test("fresh terminal verification and archive must equal the completed intent", async () => {
  const verificationDrift = harness({ driftFreshVerification: true });
  await assert.rejects(
    verificationDrift.controller.run({
      plan: verificationDrift.plan,
      authorization: AUTHORIZATION,
    }),
    /Fresh terminal verification differs/u,
  );
  assert.equal(verificationDrift.intent.status, "complete");
  assert.equal(verificationDrift.events.includes("archive"), false);

  const archiveDrift = harness({ driftArchive: true });
  await assert.rejects(
    archiveDrift.controller.run({ plan: archiveDrift.plan, authorization: AUTHORIZATION }),
    /archive differs/u,
  );
  assert.equal(archiveDrift.intent.status, "complete");
});

test("CLI rejects positional, unknown, duplicate, valueless, and plan-time authority", () => {
  const common = [
    "--source-repository=/source", "--session=session-1",
    "--task-authority=/private/capability.json", "--pull-request=471",
  ];
  for (const argv of [
    ["plan", ...common, "positional"],
    ["plan", ...common, "--force=true"],
    ["plan", ...common, "--session=again"],
    ["plan", ...common, "--session"],
    ["plan", ...common, "--ttl-seconds=7201"],
    ["plan", ...common.filter(value => !value.startsWith("--pull-request=")),
      "--pull-request=0471"],
    ["plan", ...common, `--authorize=${AUTHORIZATION}`],
    ["run", ...common, `--plan-digest=${PLAN_DIGEST}`],
  ]) assert.throws(() => parseTaskAuthoritySuccessorProjectionRepairArguments(argv));
  const parsed = parseTaskAuthoritySuccessorProjectionRepairArguments([
    "run", ...common, `--plan-digest=${PLAN_DIGEST}`,
    `--authorize=${AUTHORIZATION}`, "--json",
  ]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.common.pullRequestNumber, 471);
  assert.equal(parsed.json, true);
});

test("CLI constructs the production adapter surface and forwards the exact live plan", async () => {
  let adapterInput;
  let runInput;
  const plan = Object.freeze({ planDigest: PLAN_DIGEST, exactAuthorization: AUTHORIZATION });
  const result = await main([
    "run", "--source-repository=/source", "--session=session-1",
    "--task-authority=/private/capability.json", "--pull-request=471",
    `--plan-digest=${PLAN_DIGEST}`, `--authorize=${AUTHORIZATION}`,
  ], {
    createAdapter(input) { adapterInput = input; return { production: true }; },
    createController({ adapter }) {
      assert.deepEqual(adapter, { production: true });
      return {
        plan: async () => plan,
        run: async input => { runInput = input; return { status: "complete" }; },
      };
    },
  });
  assert.equal(adapterInput.sourceRepository, "/source");
  assert.equal(adapterInput.capabilityFile, "/private/capability.json");
  assert.equal(adapterInput.pullRequestNumber, 471);
  assert.deepEqual(runInput, { plan, authorization: AUTHORIZATION });
  assert.deepEqual(result, { status: "complete" });
});

function harness({
  driftArchive = false,
  driftFreshVerification = false,
  loseResponseAt = null,
} = {}) {
  const plan = Object.freeze({
    schema: "test-plan/v1", planDigest: PLAN_DIGEST, exactAuthorization: AUTHORIZATION,
  });
  let livePlan = plan;
  let intent = null;
  const completed = new Set();
  const effects = Object.fromEntries(PHASES.map(phase => [phase, 0]));
  const events = [];
  const phaseReceipt = phase => phase === "verified"
    ? verifiedReceipt()
    : Object.freeze({ phase, value: `${phase}-live` });
  const adapter = {
    async readEvidence() { return livePlan; },
    async withEntrypointFence(subject, action) {
      assert.equal(subject.plan, plan);
      assert.equal(subject.planDigest, PLAN_DIGEST);
      events.push("fence:start");
      try { return await action(); } finally { events.push("fence:end"); }
    },
    async readIntent() { return intent; },
    async writeIntent({ expected, value }) {
      assert.equal(expected, intent);
      intent = value;
      events.push(`write:${value.status}`);
      return intent;
    },
    async revalidate({ phase }) { events.push(`revalidate:${phase}`); },
    async assertIrreversibilityBarrier({ phase }) { events.push(`barrier:${phase}`); },
    async reconcilePhase({ phase }) {
      events.push(`reconcile:${phase}`);
      return completed.has(phase) ? phaseReceipt(phase) : null;
    },
    async archiveComplete({ intent: complete, verified }) {
      events.push("archive");
      const core = {
        schema: "agentic-task-authority-successor-projection-repair-archive/v1",
        status: "complete",
        planDigest: PLAN_DIGEST,
        terminalIntentDigest: complete.intentDigest,
        completionReceiptDigest: complete.receipt.receiptDigest,
      };
      assert.equal(verified.phase, "verified");
      return { ...core, archiveDigest: driftArchive ? "f".repeat(64) : digestValue(core) };
    },
  };
  for (const [phase, effect] of Object.entries(EFFECTS)) {
    adapter[effect] = async ({ fresh = false } = {}) => {
      if (effect === "verifyTerminal" && fresh) {
        events.push("effect:verified:fresh");
        return driftFreshVerification
          ? verifiedReceipt({ leaseDigest: "f".repeat(64) })
          : verifiedReceipt({ fresh: true });
      }
      effects[phase] += 1;
      events.push(`effect:${phase}`);
      completed.add(phase);
      if (loseResponseAt === phase) throw new Error(`${phase} response lost`);
    };
  }
  const dependencies = fakeContract(plan);
  return {
    adapter, dependencies, effects, events, plan,
    controller: createTaskAuthoritySuccessorProjectionRepairController({
      adapter, dependencies,
    }),
    driftPlan() { livePlan = Object.freeze({ ...plan, changed: true }); },
    get intent() { return intent; },
  };
}

function verifiedReceipt({ fresh = false, leaseDigest = "1".repeat(64) } = {}) {
  const values = {
    sourceSnapshotDigest: "2".repeat(64),
    currentDirtDigest: "3".repeat(64),
    leaseDigest,
    authorityDigest: "4".repeat(64),
    markerDigest: "5".repeat(64),
    bodyDigest: "6".repeat(64),
    expansionIntentDigest: "7".repeat(64),
    claimId: "8".repeat(64),
    verifiedAt: fresh ? "2026-08-13T01:00:01.000Z" : "2026-08-13T01:00:00.000Z",
    cloudVerificationReceiptDigest: fresh ? "9".repeat(64) : "a".repeat(64),
    receiptDigest: fresh ? "b".repeat(64) : "c".repeat(64),
  };
  return Object.freeze({
    schema: "phase/v2", phase: "verified", planDigest: PLAN_DIGEST,
    operationKey: "d".repeat(64), values: Object.freeze(values),
    receiptDigest: fresh ? "e".repeat(64) : "f".repeat(64),
  });
}

function fakeContract(plan) {
  const normalizePlan = value => {
    if (value?.planDigest !== PLAN_DIGEST) throw new Error("plan malformed");
    return value;
  };
  return {
    buildPlan: evidence => evidence,
    normalizePlan,
    authorize: (_value, authorization) => {
      if (authorization !== AUTHORIZATION) throw new Error("exact authorization required");
      return Object.freeze({ authorizationDigest: "b".repeat(64) });
    },
    createIntent: () => seal({ status: "prepared", phases: {}, receipt: null }),
    normalizeIntent: value => value,
    normalizePhaseReceipt: ({ phase, value }) => {
      if (value?.phase !== phase) throw new Error("phase receipt drift");
      return value;
    },
    advanceIntent: (current, phase, receipt) => seal({
      ...current,
      status: phase,
      phases: phase === "complete" ? current.phases
        : { ...current.phases, [phase]: receipt },
      receipt: phase === "complete" ? receipt : null,
    }),
    buildReceipt: ({ intent: current }) => Object.freeze({
      receiptDigest: digestValue({ phases: current.phases }),
    }),
  };
  function seal(value) {
    const core = { ...value, planDigest: PLAN_DIGEST };
    delete core.intentDigest;
    return Object.freeze({ ...core, intentDigest: digestValue(core) });
  }
}
