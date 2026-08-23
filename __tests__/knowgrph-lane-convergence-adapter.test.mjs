import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildLaneConvergencePlan } from "../scripts/lane-convergence-transaction-contract.mjs";
import { createLaneConvergenceController } from "../scripts/lane-convergence-transaction-controller.mjs";
import {
  ACTIONS,
  ACTION_EFFECTS,
  CONFIG_SCHEMA,
  describeKnowgrphLaneConvergenceAdapter,
} from "../scripts/knowgrph-lane-convergence-adapter-contract.mjs";
import { createAdapter } from "../scripts/knowgrph-lane-convergence-adapter.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

test("descriptor exposes only the bounded Knowgrph convergence effects", () => {
  const descriptor = describeKnowgrphLaneConvergenceAdapter();
  assert.equal(descriptor.id, "knowgrph-two-lane-convergence");
  assert.deepEqual(descriptor.actions.map(({ action }) => action), [
    ACTIONS.reconcileAuthority,
    ACTIONS.integrateSource,
    ACTIONS.cleanupWorktree,
  ]);
  assert.equal(descriptor.actions.some(({ effects }) => effects.deploymentMutation), false);
});

test("one controller adopts response loss and converges both exact subjects", async () => {
  const plan = createPlan();
  const state = stateFixture();
  const calls = [];
  let loseMarketplaceIntegrationResponse = true;
  const dependencies = {
    async observe() { return snapshot(state); },
    async reconcileAuthority({ subject }) {
      calls.push(`recover:${subject.subjectId}`);
      state.marketplace.localAuthorityCurrent = true;
      state.marketplace.cloudAuthorityCurrent = true;
      throw new Error("simulated recovery response loss");
    },
    async integrateSource({ subject }) {
      calls.push(`integrate:${subject.subjectId}`);
      const target = subject.subjectId.startsWith("gemini") ? state.gemini : state.marketplace;
      target.merged = true;
      target.contained = true;
      target.pullRequestState = "MERGED";
      target.integrationSha = subject.subjectId.startsWith("gemini") ? SHA_B : SHA_C;
      if (subject.subjectId === "knowgrph-native-marketplace-layer"
        && loseMarketplaceIntegrationResponse) {
        loseMarketplaceIntegrationResponse = false;
        throw new Error("simulated integration response loss");
      }
      return { status: "integrated" };
    },
    async cleanupWorktree({ subject }) {
      calls.push(`cleanup:${subject.subjectId}`);
      const target = subject.subjectId.startsWith("gemini") ? state.gemini : state.marketplace;
      target.worktreePresent = false;
      target.lifecycleState = null;
      return { status: "removed" };
    },
  };
  const adapter = await createAdapter({ plan, configuration: configuration(), dependencies });
  const controller = createLaneConvergenceController({ adapter, journal: memoryJournal(), now: clock() });
  const receipt = await controller.run({ plan, authorization: plan.exactAuthorization });

  assert.equal(receipt.transitionCount, 5);
  assert.deepEqual(calls, [
    "recover:knowgrph-native-marketplace-layer",
    "integrate:knowgrph-native-marketplace-layer",
    "cleanup:knowgrph-native-marketplace-layer",
    "integrate:gemini-api-mainpanel-integration",
    "cleanup:gemini-api-mainpanel-integration",
  ]);
});

test("closed unmerged review blocks without an effect", async () => {
  const plan = createPlan();
  const state = stateFixture();
  state.marketplace.pullRequestState = "CLOSED";
  const adapter = await createAdapter({ plan, configuration: configuration(), dependencies: {
    async observe() { return snapshot(state); },
    async reconcileAuthority() { throw new Error("not called"); },
    async integrateSource() { throw new Error("not called"); },
    async cleanupWorktree() { throw new Error("not called"); },
  } });
  const observation = await adapter.observe();
  await assert.rejects(adapter.next({ observation }), /closed unmerged review/u);
});

test("configuration rejects a generic or renamed lane", async () => {
  const plan = createPlan();
  const invalid = configuration();
  invalid.subjects[0] = { ...invalid.subjects[0], subjectId: "generic-lane" };
  await assert.rejects(createAdapter({ plan, configuration: invalid, dependencies: {} }),
    /invalid subject policy/u);
});

function createPlan() {
  const descriptor = {
    ...describeKnowgrphLaneConvergenceAdapter(),
    moduleDigest: "1".repeat(64),
    configurationDigest: "2".repeat(64),
  };
  return buildLaneConvergencePlan({ adapter: descriptor, request: {
    schema: "agentic-lane-convergence-request/v1",
    transactionId: "knowgrph-requested-two-lane-convergence",
    objective: "Integrate and clean the two preserved Knowgrph lanes.",
    subjects: [
      subject("knowgrph-native-marketplace-layer", [], true),
      subject("gemini-api-mainpanel-integration", ["knowgrph-native-marketplace-layer"], false),
    ],
    maxTransitions: 8,
    terminalReceiptTypes: ["integration", "cleanup"],
  } });
}

function subject(subjectId, dependencies, recovery) {
  const actions = recovery
    ? [ACTIONS.reconcileAuthority, ACTIONS.integrateSource, ACTIONS.cleanupWorktree]
    : [ACTIONS.integrateSource, ACTIONS.cleanupWorktree];
  const effectCeiling = Object.fromEntries(Object.keys(ACTION_EFFECTS[ACTIONS.integrateSource])
    .map((key) => [key, actions.some((action) => ACTION_EFFECTS[action][key])]));
  return { subjectId, repository: "huijoohwee/knowgrph",
    lane: `agent/huis-macbook-pro-3/${subjectId}`, targetState: "integrated-cleaned",
    dependencies, allowedActions: actions, effectCeiling };
}

function configuration() {
  return {
    schema: CONFIG_SCHEMA,
    controllerRoot: "/controller",
    canonicalRepository: "/workspace/knowgrph",
    repository: "huijoohwee/knowgrph",
    subjects: [
      {
        subjectId: "knowgrph-native-marketplace-layer",
        branch: "agent/huis-macbook-pro-3/knowgrph-native-marketplace-layer",
        worktreePath: "/workspace/marketplace",
        sessionId: "marketplace-session",
        taskAuthorityPath: "/authority/marketplace.json",
        pullRequestUrl: "https://github.com/huijoohwee/knowgrph/pull/827",
        authorityRecovery: "active-owned-dirt-reclaim",
        commitMessage: "feat(knowgrph-native-marketplace-layer): integrate runtime",
        changeManifestPath: "/authority/marketplace-manifest.json",
      },
      {
        subjectId: "gemini-api-mainpanel-integration",
        branch: "agent/huis-macbook-pro-3/gemini-api-mainpanel-integration",
        worktreePath: "/workspace/gemini",
        sessionId: "gemini-session",
        taskAuthorityPath: "/authority/gemini.json",
        pullRequestUrl: "https://github.com/huijoohwee/knowgrph/pull/828",
        authorityRecovery: "none",
        commitMessage: null,
        changeManifestPath: null,
      },
    ],
  };
}

function stateFixture() {
  return {
    marketplace: lane("knowgrph-native-marketplace-layer", { dirty: true }),
    gemini: lane("gemini-api-mainpanel-integration", {
      dirty: false, lifecycleState: "review-ready", localAuthorityCurrent: false,
      cloudAuthorityCurrent: false,
    }),
  };
}
function lane(subjectId, overrides = {}) { return {
  subjectId, worktreePresent: true, lifecycleState: "blocked-dirty", leaseStatus: "active",
  localAuthorityCurrent: false, cloudAuthorityCurrent: false, dirty: true,
  pullRequestState: "OPEN", headSha: SHA_A, integrationSha: null,
  canonicalSha: SHA_A, contained: false, merged: false, ...overrides,
}; }
function snapshot(state) { return { observedAt: "2026-08-24T00:00:00.000Z",
  subjects: [structuredClone(state.marketplace), structuredClone(state.gemini)] }; }
function memoryJournal() { let value = null; return {
  readIntent() { return value; },
  writeIntent({ expectedIntent, nextIntent }) { assert.equal(value?.intentDigest || null,
    expectedIntent?.intentDigest || null); value = nextIntent; return value; },
  async withOperationLock(action) { return action({ token: digestValue("test") }); },
}; }
function clock() { let tick = 0; return () => new Date(Date.parse("2026-08-24T00:00:00.000Z") + tick++ * 1000); }
