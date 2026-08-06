import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  bootstrapLegacyCleanCommittedLane,
  LEGACY_BOOTSTRAP_REQUEST_SCHEMA,
  LegacyBootstrapBlockedError,
} from "../scripts/legacy-clean-committed-lane-bootstrap-lib.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const treeSha = "c".repeat(40);
const worktreePath = "/tmp/preserved-legacy-lane";
const branch = "agent/device-a/delivery-authorization";
const request = Object.freeze({
  schema: LEGACY_BOOTSTRAP_REQUEST_SCHEMA,
  targetRepository: "owner/repository",
  ledgerRepository: "owner/coordination-ledger",
  sessionId: "owner-authorized-bootstrap",
  deviceId: "device-a",
  semanticScope: "delivery-authorization",
  branch,
  worktreePath,
  expectedBaseSha: baseSha,
  expectedHeadSha: headSha,
  expectedTreeSha: treeSha,
  expectedChangedPaths: [
    "guidelines/delivery-authorization.md",
    "schema/delivery-authorization.json",
  ],
  declaredWriteScope: [
    "semantic:delivery-authorization",
    "path:guidelines/delivery-authorization.md",
    "path:schema/delivery-authorization.json",
  ],
});

test("bootstraps exact committed bytes once and replays the receipt", async () => {
  const harness = createHarness();
  const first = await harness.run();
  const firstState = harness.state();
  const replay = await harness.run();
  const replayState = harness.state();

  assert.equal(first.status, "ready");
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptDigest, first.receiptDigest);
  assert.equal(first.preservedHeadSha, headSha);
  assert.equal(first.preservedTreeSha, treeSha);
  assert.equal(JSON.stringify(first).includes(worktreePath), false);
  assert.match(first.identity.worktreeRegistrationDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(replayState.calls, firstState.calls);
  assert.equal(replayState.headSha, headSha);
  assert.equal(replayState.treeSha, treeSha);
  assert.deepEqual(firstState.calls, Object.fromEntries(phaseNames.map(name => [name, 1])));
});

test("resumes every interrupted external boundary without duplicating it", async t => {
  for (const interruptedPhase of phaseNames) {
    await t.test(interruptedPhase, async () => {
      const harness = createHarness({ interruptAfterEffect: interruptedPhase });
      await assert.rejects(harness.run(), new RegExp(`interrupted after ${interruptedPhase}`));

      const result = await harness.run();
      const state = harness.state();
      assert.equal(result.status, "ready");
      assert.equal(state.calls[interruptedPhase], 2);
      for (const phase of phaseNames.filter(name => name !== interruptedPhase)) {
        assert.equal(state.calls[phase], 1);
      }
      assert.equal(state.effects[interruptedPhase], 1);
      assert.equal(state.headSha, headSha);
      assert.equal(state.treeSha, treeSha);
    });
  }
});

test("fails closed on unattributed pre-existing coordination projections", async () => {
  const harness = createHarness({
    initialProjection: {
      name: "remoteBranch",
      value: output("remoteBranch", "unrelated-bootstrap"),
    },
  });

  await assertBlocked(harness.run(), "unattributed_projection");
  assert.deepEqual(harness.state().calls, emptyCalls());
});

test("fails closed when immutable committed state drifts during recovery", async () => {
  const harness = createHarness({ interruptAfterEffect: "cloudClaim" });
  await assert.rejects(harness.run(), /interrupted after cloudClaim/);
  harness.mutateObservation(observation => ({ ...observation, headSha: "d".repeat(40) }));

  await assertBlocked(harness.run(), "immutable_lane_drift");
  assert.equal(harness.state().effects.cloudClaim, 1);
  assert.equal(harness.state().calls.localLease, 0);
});

test("fails closed before effects for dirty, overlapping, or mismatched lanes", async t => {
  for (const [name, mutate, code] of [
    ["dirty", observation => ({ ...observation, clean: false }), "dirty_lane"],
    ["unregistered", observation => ({ ...observation, registeredWorktree: false }), "unregistered_lane"],
    ["scope owner", observation => ({ ...observation, competingScopeOwners: ["PR-9"] }), "scope_collision"],
    ["claim overlap", observation => ({ ...observation, overlappingClaims: ["claim-9"] }), "write_overlap"],
    ["changed path", observation => ({ ...observation, changedPaths: ["other.md"] }), "committed_write_set_drift"],
  ]) {
    await t.test(name, async () => {
      const harness = createHarness();
      harness.mutateObservation(mutate);
      await assertBlocked(harness.run(), code);
      assert.deepEqual(harness.state().calls, emptyCalls());
    });
  }
});

test("requires a complete provider-neutral adapter contract", async () => {
  await assertBlocked(
    bootstrapLegacyCleanCommittedLane(request, { adapter: {} }),
    "adapter_incomplete",
  );
});

test("normalizes invalid provider-neutral write scope into a typed block", async () => {
  const harness = createHarness();
  await assertBlocked(bootstrapLegacyCleanCommittedLane({
    ...request,
    declaredWriteScope: ["../outside"],
  }, { adapter: harness.adapter }), "invalid_write_scope");
});

const phaseMethods = Object.freeze({
  cloudClaim: "claimCloudAuthority",
  localLease: "claimLocalLease",
  remoteBranch: "publishExactBranch",
  pullRequest: "createDraftOwnershipRequest",
  boundAuthority: "bindCloudAuthority",
  ownerProjection: "projectOwnerReceipt",
});
const phaseNames = Object.freeze(Object.keys(phaseMethods));

function createHarness({ interruptAfterEffect = null, initialProjection = null } = {}) {
  let observation = {
    clean: true,
    registeredWorktree: true,
    attachedBranch: branch,
    worktreePath,
    baseSha,
    headSha,
    treeSha,
    baseIsAncestor: true,
    changedPaths: [...request.expectedChangedPaths],
    competingScopeOwners: [],
    overlappingClaims: [],
    projections: {},
  };
  if (initialProjection) {
    observation.projections[initialProjection.name] = initialProjection.value;
  }
  const checkpoints = new Map();
  const calls = emptyCalls();
  const effects = emptyCalls();
  const interrupted = new Set();
  const adapter = {
    inspectLane: async () => structuredClone(observation),
    readCheckpoint: async identityDigest => structuredClone(checkpoints.get(identityDigest) ?? null),
    writeCheckpoint: async checkpoint => {
      checkpoints.set(checkpoint.identity.identityDigest, structuredClone(checkpoint));
    },
    verifyFinal: async () => structuredClone(observation),
  };
  for (const [name, method] of Object.entries(phaseMethods)) {
    adapter[method] = async context => {
      calls[name] += 1;
      let projection = observation.projections[name];
      if (!projection) {
        projection = output(name, context.identity.identityDigest);
        observation.projections[name] = projection;
        effects[name] += 1;
      }
      if (interruptAfterEffect === name && !interrupted.has(name)) {
        interrupted.add(name);
        throw new Error(`interrupted after ${name}`);
      }
      return structuredClone(projection);
    };
  }
  return {
    adapter,
    run: () => bootstrapLegacyCleanCommittedLane(request, {
      adapter,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    }),
    mutateObservation: mutation => { observation = mutation(structuredClone(observation)); },
    state: () => ({
      calls: structuredClone(calls),
      effects: structuredClone(effects),
      headSha: observation.headSha,
      treeSha: observation.treeSha,
    }),
  };
}

function output(name, identityDigest) {
  const unsigned = {
    schema: `agentic-legacy-bootstrap-${name}/v1`,
    bootstrapIdentityDigest: identityDigest,
    providerResourceId: `${name}-resource`,
  };
  return { ...unsigned, receiptDigest: digestValue(unsigned) };
}

function emptyCalls() {
  return Object.fromEntries(phaseNames.map(name => [name, 0]));
}

async function assertBlocked(promise, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof LegacyBootstrapBlockedError);
    assert.equal(error.code, code);
    return true;
  });
}
