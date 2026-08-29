// Responsibility: prove private persistence, waiter-first orchestration, replay, and fail-closed drift handling.
import assert from "node:assert/strict";
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  providerOnlyMergedClaimPairReconciliationOperationKey,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-contract.mjs";
import {
  PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES,
  createProviderOnlyMergedClaimPairReconciliationController,
  createProviderOnlyMergedClaimPairReconciliationIntentStore,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-controller.mjs";
import {
  buildProviderOnlyMergedClaimPairReconciliationEvidence,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-evidence.mjs";
import {
  providerOnlyEvidenceFixture,
} from "./provider-only-merged-claim-pair-reconciliation-evidence.test.mjs";
const EFFECTS = Object.freeze([
  ["waiter-retired", "retireWaiter"],
  ["source-recovered", "recoverSource"],
  ["source-integrated", "integrateSource"],
  ["source-retired", "retireSource"],
  ["verified", "verifyTerminal"],
]);
test("intent store performs atomic private CAS and rejects journal corruption", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-intent-"));
  const statePath = path.join(root, "private", "intent.json");
  try {
    const store = createProviderOnlyMergedClaimPairReconciliationIntentStore({
      statePath,
      now: () => new Date("2026-08-29T08:00:00.000Z"),
    });
    const authorized = { status: "authorized", digest: "a".repeat(64) };
    const prepared = { status: "prepared", digest: "b".repeat(64) };
    assert.equal(store.readIntent(), null);
    assert.deepEqual(await store.writeIntent({ expectedIntent: null, nextIntent: authorized }), authorized);
    assert.deepEqual(store.readIntent(), authorized);
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).updatedAt, "2026-08-29T08:00:00.000Z");
    await assert.rejects(store.writeIntent({
      expectedIntent: { status: "foreign" },
      nextIntent: prepared,
    }), /intent changed before CAS/iu);
    assert.deepEqual(store.readIntent(), authorized);
    assert.deepEqual(await store.writeIntent({ expectedIntent: authorized, nextIntent: prepared }), prepared);
    const journal = JSON.parse(readFileSync(statePath, "utf8"));
    journal.intent.status = "tampered";
    writeFileSync(statePath, `${JSON.stringify(journal)}\n`);
    assert.throws(() => store.readIntent(), /journal is invalid/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("private journals ignore predictable symlink decoys and retain victim bytes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-private-decoy-"));
  const privateRoot = path.join(root, "private");
  const statePath = path.join(privateRoot, "intent.json");
  const victim = path.join(root, "victim.txt");
  try {
    mkdirSync(privateRoot, { mode: 0o700 });
    writeFileSync(victim, "do-not-touch\n", { mode: 0o600 });
    symlinkSync(victim, `${statePath}.tmp`);
    symlinkSync(victim, path.join(privateRoot, ".intent.json.tmp"));
    const store = createProviderOnlyMergedClaimPairReconciliationIntentStore({ statePath });
    await store.writeIntent({
      expectedIntent: null,
      nextIntent: { status: "authorized", digest: "a".repeat(64) },
    });
    assert.equal(readFileSync(victim, "utf8"), "do-not-touch\n");
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("entrypoint fence fails closed on every owner and releases only its own token", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-fence-"));
  const statePath = path.join(root, "intent.json");
  try {
    const store = createProviderOnlyMergedClaimPairReconciliationIntentStore({ statePath });
    const entrypointPath = `${statePath}.entrypoint.lock`;
    writeFileSync(entrypointPath, JSON.stringify({
      pid: 2_147_483_647,
      token: "unverifiable-owner",
      subject: {},
    }), { mode: 0o600 });
    await assert.rejects(
      store.withEntrypointFence({}, async () => {}),
      /private operation lock|malformed|owner/iu,
    );
    assert.equal(JSON.parse(readFileSync(entrypointPath, "utf8")).token, "unverifiable-owner");
    rmSync(entrypointPath);
    writeFileSync(entrypointPath, "{}\n", { mode: 0o600 });
    await assert.rejects(
      store.withEntrypointFence({}, async () => {}),
      /private operation lock|malformed/iu,
    );
    rmSync(entrypointPath);
    const outer = await store.withEntrypointFence({ planDigest: "a".repeat(64) }, async fence => {
      assert.match(fence.fenceDigest, /^[0-9a-f]{64}$/u);
      assert.equal(existsSync(entrypointPath), true);
      await assert.rejects(
        store.withEntrypointFence({ planDigest: "b".repeat(64) }, async () => {}),
        /live process|lock/iu,
      );
      assert.equal(existsSync(entrypointPath), true);
      return "complete";
    });
    assert.equal(outer, "complete");
    assert.equal(existsSync(entrypointPath), false);
    await assert.rejects(store.withEntrypointFence({}, async () => {
      const replacement = JSON.parse(readFileSync(entrypointPath, "utf8"));
      replacement.token = "replacement-owner";
      rmSync(entrypointPath);
      writeFileSync(entrypointPath, `${canonicalJson(replacement)}\n`, { mode: 0o600 });
    }), /ownership changed/iu);
    assert.equal(JSON.parse(readFileSync(entrypointPath, "utf8")).token, "replacement-owner");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("plan is read-only and returns one exact authorization-bound snapshot", async () => {
  const harness = createHarness();
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const result = await controller.plan();
  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, result.plan.planDigest);
  assert.equal(
    result.exactAuthorization,
    `authorize provider-only-merged-claim-pair-reconciliation ${result.planDigest}`,
  );
  assert.deepEqual(harness.counts, {
    effects: 0, fences: 0, freshReads: 0, intentReads: 1, planReads: 1,
    planWrites: 1, sourceReads: 1, writes: 0,
  });
});
test("run fails closed without the privately sealed plan and never self-baselines", async () => {
  const harness = createHarness();
  const controller = createProviderOnlyMergedClaimPairReconciliationController({ adapter: harness.adapter });
  const planned = await controller.plan();
  harness.clearPlan();
  const sourceReads = harness.counts.sourceReads;
  await assert.rejects(controller.run({
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  }), /requires its privately sealed plan/iu);
  assert.equal(harness.counts.sourceReads, sourceReads);
  assert.equal(harness.counts.effects, 0);
});
test("rejects stale plan digests and non-exact authorization before effects", async () => {
  const harness = createHarness();
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  await assert.rejects(
    controller.run({
      planDigest: "0".repeat(64),
      authorization: planned.exactAuthorization,
    }),
    /plan digest drifted/iu,
  );
  await assert.rejects(
    controller.run({
      planDigest: planned.planDigest,
      authorization: "authorize provider-only-merged-claim-pair-reconciliation wrong",
    }),
    /requires exact authorization/iu,
  );
  assert.equal(harness.intent, null);
  assert.equal(harness.counts.effects, 0);
  assert.equal(harness.counts.writes, 0);
});
test("persists all eight states and executes the exact waiter-first effect order", async () => {
  const harness = createHarness();
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  const result = await controller.run({
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.planDigest, planned.planDigest);
  assert.equal(result.receipt.planDigest, planned.planDigest);
  assert.deepEqual(harness.effectNames, EFFECTS.map(([, method]) => method));
  assert.deepEqual(harness.persistedStatuses, PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES);
  assert.equal(harness.intent.status, "complete");
  assert.equal(
    harness.intent.phases.complete.values.receipt.receiptDigest,
    result.receipt.receiptDigest,
  );
});
test("adopts response loss after every effect and never repeats the transition", async context => {
  for (const [, method] of EFFECTS) {
    await context.test(method, async () => {
      const harness = createHarness({ failAfterEffect: method });
      const controller = createProviderOnlyMergedClaimPairReconciliationController({
        adapter: harness.adapter,
      });
      const planned = await controller.plan();
      const first = await controller.run({
        planDigest: planned.planDigest,
        authorization: planned.exactAuthorization,
      });
      assert.equal(first.status, "complete");
      assert.equal(harness.effectNames.filter(value => value === method).length, 1);
      const replay = await controller.run({
        planDigest: planned.planDigest,
        authorization: planned.exactAuthorization,
      });
      assert.equal(replay.receipt.receiptDigest, first.receipt.receiptDigest);
      assert.equal(harness.effectNames.filter(value => value === method).length, 1);
    });
  }
});
test("resumes after every post-persistence response loss without repeating effects", async context => {
  for (const phase of PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES) {
    await context.test(phase, async () => {
      const harness = createHarness({ failAfterPersist: phase });
      const controller = createProviderOnlyMergedClaimPairReconciliationController({
        adapter: harness.adapter,
      });
      const planned = await controller.plan();
      await assert.rejects(
        controller.run({
          planDigest: planned.planDigest,
          authorization: planned.exactAuthorization,
        }),
        new RegExp(`${phase} intent response was lost`, "u"),
      );
      assert.equal(harness.intent.status, phase);
      const effectsBeforeResume = [...harness.effectNames];
      const result = await controller.run({
        planDigest: planned.planDigest,
        authorization: planned.exactAuthorization,
      });
      assert.equal(result.status, "complete");
      for (const effect of effectsBeforeResume) {
        assert.equal(
          harness.effectNames.filter(value => value === effect).length,
          effectsBeforeResume.filter(value => value === effect).length,
        );
      }
    });
  }
});
test("adopts an already-live exact phase without invoking its effect", async () => {
  const harness = createHarness({ responseAhead: "waiter-retired" });
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  await controller.run({
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  });
  assert.equal(harness.effectNames.includes("retireWaiter"), false);
  assert.equal(harness.intent.status, "complete");
});
test("revalidates stored pre-effect plans only while the waiter is still pending", async context => {
  for (const status of ["authorized", "prepared"]) {
    await context.test(`${status} stable identity drift`, async () => {
      const harness = createHarness({ failAfterPersist: status });
      const controller = createProviderOnlyMergedClaimPairReconciliationController({
        adapter: harness.adapter,
      });
      const planned = await controller.plan();
      const request = {
        planDigest: planned.planDigest,
        authorization: planned.exactAuthorization,
      };
      await assert.rejects(controller.run(request), new RegExp(`${status} intent response was lost`, "u"));
      const changed = providerOnlyEvidenceFixture();
      changed.recoveryTtlSeconds = 900;
      harness.replaceSourceEvidence(changed);
      await assert.rejects(
        controller.run(request),
        /live provider-only reconciliation plan identity drifted/iu,
      );
      assert.equal(harness.counts.effects, 0);
      assert.equal(harness.intent.status, status);
    });
  }
  await context.test("already-live waiter response loss", async () => {
    const harness = createHarness({ failAfterPersist: "prepared" });
    const controller = createProviderOnlyMergedClaimPairReconciliationController({
      adapter: harness.adapter,
    });
    const planned = await controller.plan();
    const request = {
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    };
    await assert.rejects(controller.run(request), /prepared intent response was lost/iu);
    harness.markLive("waiter-retired");
    harness.rejectSourceReads();
    const result = await controller.run(request);
    assert.equal(result.status, "complete");
    assert.equal(harness.effectNames.includes("retireWaiter"), false);
  });
});
test("rejects same-phase evidence drift before the next effect and on replay", async () => {
  const harness = createHarness({ driftAfterPersist: "source-integrated" });
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  const request = {
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  };
  await assert.rejects(controller.run(request), /evidence drifted after persistence/iu);
  assert.equal(harness.intent.status, "source-integrated");
  assert.deepEqual(harness.effectNames, ["retireWaiter", "recoverSource", "integrateSource"]);
  await assert.rejects(controller.run(request), /evidence drifted after persistence/iu);
  assert.deepEqual(harness.effectNames, ["retireWaiter", "recoverSource", "integrateSource"]);
});
test("places a fresh scoped recapture immediately before the first cloud effect", async () => {
  const harness = createHarness({ failFreshSource: true });
  const controller = createProviderOnlyMergedClaimPairReconciliationController({ adapter: harness.adapter });
  const planned = await controller.plan();
  await assert.rejects(controller.run({ planDigest: planned.planDigest,
    authorization: planned.exactAuthorization }), /fresh source changed/iu);
  assert.equal(harness.counts.freshReads, 1);
  assert.equal(harness.counts.effects, 0);
  assert.equal(harness.intent.status, "prepared");
});
test("resumes after terminal freshness interruption without repeating cloud effects", async () => {
  const harness = createHarness({ failTerminalObservation: true });
  const controller = createProviderOnlyMergedClaimPairReconciliationController({ adapter: harness.adapter });
  const planned = await controller.plan();
  const request = { planDigest: planned.planDigest, authorization: planned.exactAuthorization };
  await assert.rejects(controller.run(request), /terminal external recapture changed/iu);
  const cloudEffects = ["retireWaiter", "recoverSource", "integrateSource", "retireSource"];
  assert.deepEqual(harness.effectNames.filter(name => cloudEffects.includes(name)), cloudEffects);
  assert.equal(harness.intent.status, "source-retired");
  const result = await controller.run(request);
  assert.equal(result.status, "complete");
  assert.deepEqual(harness.effectNames.filter(name => cloudEffects.includes(name)), cloudEffects);
});
test("fails closed on an unbound effect, ambiguous completion, and intent CAS drift", async context => {
  await context.test("unbound effect", async () => {
    const harness = createHarness({ wrongOperationKey: "recoverSource" });
    const controller = createProviderOnlyMergedClaimPairReconciliationController({
      adapter: harness.adapter,
    });
    const planned = await controller.plan();
    await assert.rejects(controller.run({
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    }), /effect is not operation-bound/iu);
    assert.equal(harness.intent.status, "waiter-retired");
    assert.deepEqual(harness.effectNames, ["retireWaiter", "recoverSource"]);
  });
  await context.test("ambiguous completion", async () => {
    const harness = createHarness({ remainPendingAfterEffect: "integrateSource" });
    const controller = createProviderOnlyMergedClaimPairReconciliationController({
      adapter: harness.adapter,
    });
    const planned = await controller.plan();
    await assert.rejects(controller.run({
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    }), /did not become live-complete/iu);
    assert.equal(harness.intent.status, "source-recovered");
  });
  await context.test("intent CAS drift", async () => {
    const harness = createHarness({ casDriftAt: "prepared" });
    const controller = createProviderOnlyMergedClaimPairReconciliationController({
      adapter: harness.adapter,
    });
    const planned = await controller.plan();
    await assert.rejects(controller.run({
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    }), /intent changed before CAS/iu);
    assert.equal(harness.intent.status, "authorized");
    assert.equal(harness.counts.effects, 0);
  });
  await context.test("CAS returns a different valid intent", async () => {
    const harness = createHarness({ returnDifferentIntentAt: "prepared" });
    const controller = createProviderOnlyMergedClaimPairReconciliationController({
      adapter: harness.adapter,
    });
    const planned = await controller.plan();
    await assert.rejects(controller.run({
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    }), /cannot advance from authorized to waiter-retired|intent|CAS/iu);
    assert.equal(harness.intent.status, "authorized");
    assert.equal(harness.counts.effects, 0);
  });
});
test("terminal replay returns the same receipt without another effect", async () => {
  const harness = createHarness();
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  const request = {
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  };
  const first = await controller.run(request);
  const effects = [...harness.effectNames];
  const second = await controller.run(request);
  assert.equal(second.receipt.receiptDigest, first.receipt.receiptDigest);
  assert.deepEqual(harness.effectNames, effects);
});
test("rejects a recomputed intent whose terminal receipt was tampered", async () => {
  const harness = createHarness();
  const controller = createProviderOnlyMergedClaimPairReconciliationController({
    adapter: harness.adapter,
  });
  const planned = await controller.plan();
  const request = {
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  };
  await controller.run(request);
  const effects = [...harness.effectNames];
  const tampered = structuredClone(harness.intent);
  const receipt = tampered.phases.complete.values.receipt;
  receipt.finalRevision = "f".repeat(40);
  const { receiptDigest: _receiptDigest, ...receiptCore } = receipt;
  receipt.receiptDigest = digestValue(receiptCore);
  const { intentDigest: _intentDigest, ...intentCore } = tampered;
  tampered.intentDigest = digestValue(intentCore);
  harness.replaceIntent(tampered);
  await assert.rejects(controller.run(request), /receipt|drift/iu);
  assert.deepEqual(harness.effectNames, effects);
});
function createHarness({
  casDriftAt = null,
  driftAfterPersist = null,
  failAfterEffect = null,
  failAfterPersist = null,
  failFreshSource = false,
  failTerminalObservation = false,
  remainPendingAfterEffect = null,
  responseAhead = null,
  returnDifferentIntentAt = null,
  wrongOperationKey = null,
} = {}) {
  let source = buildProviderOnlyMergedClaimPairReconciliationEvidence(
    providerOnlyEvidenceFixture(),
  );
  let sourceReadError = null;
  const live = new Set(["prepared"]);
  if (responseAhead) live.add(responseAhead);
  const failed = new Set();
  const effectNames = [];
  const persistedStatuses = [];
  let intent = null;
  let sealedPlan = null;
  const counts = { effects: 0, fences: 0, freshReads: 0, intentReads: 0,
    planReads: 0, planWrites: 0, sourceReads: 0, writes: 0 };
  const harness = {
    counts,
    effectNames,
    persistedStatuses,
    get intent() { return intent; },
    clearPlan() { sealedPlan = null; },
    markLive(phase) { live.add(phase); },
    replaceIntent(value) { intent = value; },
    replaceSourceEvidence(value) {
      source = buildProviderOnlyMergedClaimPairReconciliationEvidence(value);
    },
    rejectSourceReads() { sourceReadError = new Error("initial inventory is no longer available"); },
  };
  const methods = {
    async withEntrypointFence(_subject, action) {
      counts.fences += 1;
      return action(Object.freeze({ fenceDigest: "9".repeat(64) }));
    },
    async readSourceEvidence() {
      counts.sourceReads += 1;
      if (sourceReadError) throw sourceReadError;
      return source;
    },
    async readPlan() {
      counts.planReads += 1;
      return sealedPlan;
    },
    async writePlan({ expectedPlan, nextPlan }) {
      counts.planWrites += 1;
      assert.equal(expectedPlan?.planDigest ?? null, sealedPlan?.planDigest ?? null);
      if (sealedPlan && sealedPlan.planDigest !== nextPlan.planDigest) {
        throw new Error("Provider-only sealed plan changed before CAS.");
      }
      sealedPlan = nextPlan;
      return sealedPlan;
    },
    async verifyFreshSource({ plan }) {
      counts.freshReads += 1;
      if (failFreshSource) throw new Error("fresh source changed during double read");
      return { planDigest: plan.planDigest, evidenceDigest: digestValue({ fresh: plan.planDigest }) };
    },
    async readIntent() {
      counts.intentReads += 1;
      return intent;
    },
    async writeIntent({ expectedIntent, nextIntent }) {
      counts.writes += 1;
      assert.equal(expectedIntent?.intentDigest ?? null, intent?.intentDigest ?? null);
      if (nextIntent.status === casDriftAt && !failed.has(`cas:${casDriftAt}`)) {
        failed.add(`cas:${casDriftAt}`);
        throw new Error("Provider-only reconciliation intent changed before CAS.");
      }
      if (nextIntent.status === returnDifferentIntentAt
        && !failed.has(`different:${returnDifferentIntentAt}`)) {
        failed.add(`different:${returnDifferentIntentAt}`);
        return intent;
      }
      intent = nextIntent;
      persistedStatuses.push(intent.status);
      if (intent.status === failAfterPersist && !failed.has(`persist:${intent.status}`)) {
        failed.add(`persist:${intent.status}`);
        throw new Error(`${intent.status} intent response was lost`);
      }
      return intent;
    },
    async observePhase({ phase, operationKey, intent: observedIntent }) {
      if (phase === "verified" && failTerminalObservation
        && !failed.has("terminal-observation")) {
        failed.add("terminal-observation");
        throw new Error("terminal external recapture changed");
      }
      if (!live.has(phase)) {
        return { phase, operationKey, state: "pending", evidenceDigest: null };
      }
      const drifted = phase === driftAfterPersist && observedIntent?.status === phase;
      const result = {
        phase,
        operationKey,
        state: "complete",
        evidenceDigest: digestValue({ phase, operationKey, drifted }),
      };
      if (["source-integrated", "source-retired", "verified"].includes(phase)) {
        result.sourceIntegrationReceiptDigest = digestValue({
          planDigest: observedIntent.planDigest,
          source: "integration-receipt",
        });
      }
      return result;
    },
  };
  for (const [phase, method] of EFFECTS) {
    methods[method] = async ({ operationKey }) => {
      counts.effects += 1;
      effectNames.push(method);
      if (method !== wrongOperationKey && method !== remainPendingAfterEffect) live.add(phase);
      if (method === failAfterEffect && !failed.has(`effect:${method}`)) {
        failed.add(`effect:${method}`);
        throw new Error(`${method} response was lost`);
      }
      return { operationKey: method === wrongOperationKey ? "wrong-operation-key" : operationKey };
    };
  }
  harness.adapter = Object.freeze(methods);
  return harness;
}
