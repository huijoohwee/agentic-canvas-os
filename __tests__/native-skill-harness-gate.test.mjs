import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  PROMOTION_ARTIFACT_TYPE,
  PROMOTION_BOUNDARY_NAME,
  PROMOTION_GATE_IDENTITY,
  PromotionBlock,
  createSkillRegistryGate,
} from "../agent-api/src/skill-registry-gate.js";
import { createSkillProposerRuntime } from "../agent-api/src/skill-proposer.js";
import { createAdapterRegistrationInterface } from "../agent-api/src/adapter-registration.js";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import {
  assertSnapshotUnchanged,
  captureSnapshot,
  createInMemoryDraftStore,
  createInMemoryToolAllowlist,
  createOperatorInstructionResolver,
  createRecordingObserver,
  createScriptedCandidateAdapter,
  createValidAgentDefinition,
  createValidGapSignal,
  createValidToolAllowlistEntry,
} from "./lib/native-skill-harness-fakes.mjs";

const OPERATOR_REF = "operator-instruction/promote-gap-draft/2026-08-17";
const PROPERTY_SEED = 20260817;

function createRegistry() {
  return createAgentDefinitionRegistry({
    verifyDefinitionSource: async ({ source }) => ({
      verified: true,
      uri: source.uri,
      digest: source.digest,
      verificationId: "source-proof-1",
    }),
  });
}

function createGateEnvironment({ resolvable = [OPERATOR_REF] } = {}) {
  const draftStore = createInMemoryDraftStore();
  const registry = createRegistry();
  const allowlist = createInMemoryToolAllowlist();
  const resolver = createOperatorInstructionResolver({ resolvable });
  const traceObserver = createRecordingObserver();
  let clock = 5_000;
  const gate = createSkillRegistryGate({
    draftStore,
    agentDefinitionRegistry: registry,
    toolAllowlist: allowlist,
    resolveOperatorInstruction: resolver.resolveOperatorInstruction,
    emitTrace: traceObserver.emit,
    now: () => clock,
  });
  return { draftStore, registry, allowlist, resolver, traceObserver, gate, tick: (step) => { clock += step; } };
}

async function seedDraftFromProposer(draftStore) {
  const adapter = createScriptedCandidateAdapter(["valid"]);
  let clock = 1_000;
  const proposer = createSkillProposerRuntime({
    draftStore,
    proposeCandidate: adapter.proposeCandidate,
    now: () => clock,
  });
  const result = await proposer.propose(createValidGapSignal());
  const putCall = draftStore.calls.find((call) => call.method === "put");
  return { draftId: putCall.argument, result };
}

function createDirectDraft(overrides = {}) {
  return {
    schema: "acos-skill-draft/v1",
    draft_id: "gap-001:1000",
    status: "proposed",
    adapter_id: "knowgrph",
    gap_signal_id: "gap-001",
    agent_definition: createValidAgentDefinition({ id: "direct-draft-agent", revision: "direct-v1" }),
    rationale: "Directly written draft.",
    confidence: 0.6,
    proposing_mechanism: { module: "agent-api/src/skill-proposer.js", identity: "acos-skill-proposer" },
    tool_names: ["update_agent_run_note"],
    created_at_ms: 1_000,
    expires_at_ms: 1_000 + 30 * 24 * 60 * 60 * 1000,
    consumed: false,
    ...overrides,
  };
}

test("a freshly constructed gate is closed and declares its identity constants", () => {
  const { gate } = createGateEnvironment();
  assert.equal(gate.boundaryState("any-draft"), "closed");
  assert.equal(PROMOTION_ARTIFACT_TYPE, "agent-definition");
  assert.equal(PROMOTION_BOUNDARY_NAME, "skill-registry-promotion");
  assert.equal(PROMOTION_GATE_IDENTITY, "acos-skill-registry-gate");
  assert.equal(gate.stats().modelCallCapability, false);
  assert.equal(gate.stats().artifactType, PROMOTION_ARTIFACT_TYPE);
});

test("expired and consumed drafts block with typed reason codes and a byte-identical snapshot", async () => {
  const expiredStore = createInMemoryDraftStore({ now: () => 50_000 });
  const expiredRegistry = createRegistry();
  const expiredGate = createSkillRegistryGate({
    draftStore: expiredStore,
    agentDefinitionRegistry: expiredRegistry,
    resolveOperatorInstruction: createOperatorInstructionResolver({ resolvable: [OPERATOR_REF] }).resolveOperatorInstruction,
  });
  const expiredDraft = createDirectDraft({
    draft_id: "expired:1",
    expires_at_ms: 49_000,
  });
  await expiredStore.put(expiredDraft);
  const expiredSnapshotBefore = captureSnapshot(expiredRegistry);
  const expiredOutcome = await expiredGate.promote(expiredDraft.draft_id, OPERATOR_REF);
  assert.equal(expiredOutcome.status, "blocked");
  assert.equal(expiredOutcome.reason_code, "draft_not_found");
  assertSnapshotUnchanged(expiredSnapshotBefore, captureSnapshot(expiredRegistry));

  const consumedEnvironment = createGateEnvironment();
  const consumedDraft = createDirectDraft({
    draft_id: "consumed:1",
    consumed: true,
  });
  await consumedEnvironment.draftStore.put(consumedDraft);
  const consumedSnapshotBefore = captureSnapshot(consumedEnvironment.registry);
  const consumedOutcome = await consumedEnvironment.gate.promote(consumedDraft.draft_id, OPERATOR_REF);
  assert.equal(consumedOutcome.status, "blocked");
  assert.equal(consumedOutcome.reason_code, "draft_already_consumed");
  assertSnapshotUnchanged(consumedSnapshotBefore, captureSnapshot(consumedEnvironment.registry));
});

test("an unknown factory option is rejected so no flag can open the boundary", () => {
  assert.throws(
    () => createSkillRegistryGate({ openByDefault: true }),
    (error) => error instanceof TypeError && /openByDefault/.test(error.message),
  );
  assert.throws(
    () => createSkillRegistryGate({ fetch: () => {} }),
    (error) => error instanceof TypeError && /fetch/.test(error.message),
  );
  assert.throws(
    () => createSkillRegistryGate({ proposeCandidate: () => {} }),
    (error) => error instanceof TypeError && /proposeCandidate/.test(error.message),
  );
});

test("promote without a resolvable operator instruction is rejected inertly", async () => {
  const { draftStore, registry, allowlist, gate } = createGateEnvironment();
  const { draftId } = await seedDraftFromProposer(draftStore);
  const snapshotBefore = captureSnapshot(registry);
  const allowlistBefore = allowlist.snapshot();

  for (const reference of [undefined, "", "   ", "operator-instruction/unknown/1"]) {
    const outcome = await gate.promote(draftId, reference);
    assert.equal(outcome.status, "blocked");
    assert.equal(outcome.reason_code, "operator_instruction_unresolved");
  }
  assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
  assert.equal(allowlist.snapshot(), allowlistBefore);
  assert.equal(gate.boundaryState(draftId), "closed");
});

test("a resolved operator instruction promotes the draft exactly once", async () => {
  const environment = createGateEnvironment();
  const { draftStore, registry, allowlist, gate } = environment;
  const { draftId } = await seedDraftFromProposer(draftStore);
  const snapshotBefore = captureSnapshot(registry);

  const outcome = await gate.promote(draftId, OPERATOR_REF);
  assert.equal(outcome.status, "promoted");
  assert.equal(outcome.reason_code, null);
  assert.equal(outcome.draft_id, draftId);
  assert.ok(outcome.agent_definition_id);
  assert.ok(outcome.tool_allowlist_entry_id);

  // The promoted definition is active in the registry and the snapshot changed.
  const snapshotAfter = captureSnapshot(registry);
  assert.notEqual(snapshotAfter, snapshotBefore);
  assert.ok(snapshotAfter.includes(`"id":"${outcome.agent_definition_id}"`));

  // The allowlist entry references the promoted definition's id.
  const entry = JSON.parse(allowlist.snapshot().replace(/^\[/, "[")).find(
    (candidate) => candidate.agent_definition_id === outcome.agent_definition_id,
  );
  assert.ok(entry, "the allowlist entry must reference the promoted definition");
  assert.deepEqual(entry.tool_names, ["update_agent_run_note"]);

  // The Promotion_Record carries the four nested boundary fields plus the
  // proposing mechanism sibling.
  const record = outcome.promotion_record;
  assert.deepEqual(Object.keys(record.boundary).sort(), [
    "evidence_reference",
    "name",
    "operator_instruction_reference",
    "rollback_statement",
  ]);
  assert.equal(record.boundary.name, PROMOTION_BOUNDARY_NAME);
  assert.equal(record.boundary.operator_instruction_reference, OPERATOR_REF);
  assert.equal(record.boundary.evidence_reference, null);
  assert.ok(record.boundary.rollback_statement.length > 0);
  assert.notEqual(record.proposing_mechanism.identity, PROMOTION_GATE_IDENTITY);
  assert.equal(record.proposing_mechanism.identity, "acos-skill-proposer");

  // A retry cannot double-promote.
  const retry = await gate.promote(draftId, OPERATOR_REF);
  assert.equal(retry.status, "blocked");
  assert.equal(retry.reason_code, "draft_already_consumed");
  assert.equal(captureSnapshot(registry), snapshotAfter);
});

test("a proposer-written draft and a directly written draft promote identically", async () => {
  const first = createGateEnvironment();
  const { draftId: proposerDraftId } = await seedDraftFromProposer(first.draftStore);
  const proposerOutcome = await first.gate.promote(proposerDraftId, OPERATOR_REF);

  const second = createGateEnvironment();
  const directDraft = {
    schema: "acos-skill-draft/v1",
    draft_id: "gap-001:1000",
    status: "proposed",
    adapter_id: "knowgrph",
    gap_signal_id: "gap-001",
    agent_definition: proposerOutcome
      ? { ...createValidAgentDefinition({ id: "direct-draft-agent", revision: "direct-v1" }) }
      : createValidAgentDefinition({ id: "direct-draft-agent", revision: "direct-v1" }),
    rationale: "Directly written draft.",
    confidence: 0.6,
    proposing_mechanism: { module: "agent-api/src/skill-proposer.js", identity: "acos-skill-proposer" },
    tool_names: ["update_agent_run_note"],
    created_at_ms: 1_000,
    expires_at_ms: 1_000 + 30 * 24 * 60 * 60 * 1000,
    consumed: false,
  };
  await second.draftStore.put(directDraft);
  const directOutcome = await second.gate.promote(directDraft.draft_id, OPERATOR_REF);
  assert.equal(directOutcome.status, "promoted");
  assert.equal(directOutcome.promotion_record.proposing_mechanism.identity, proposerOutcome.promotion_record.proposing_mechanism.identity);
});

test("an unknown or malformed draft id blocks with draft_not_found", async () => {
  const { gate, registry } = createGateEnvironment();
  const snapshotBefore = captureSnapshot(registry);
  const unknown = await gate.promote("missing-draft", OPERATOR_REF);
  assert.equal(unknown.status, "blocked");
  assert.equal(unknown.reason_code, "draft_not_found");
  const malformed = await gate.promote({ draft: 1 }, OPERATOR_REF);
  assert.equal(malformed.reason_code, "draft_not_found");
  assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
});

test("a draft whose proposing mechanism collides with the gate identity throws before any registry write", async () => {
  const { draftStore, registry, gate } = createGateEnvironment();
  const forgedDraft = {
    schema: "acos-skill-draft/v1",
    draft_id: "forged:1",
    status: "proposed",
    adapter_id: "knowgrph",
    gap_signal_id: "gap-001",
    agent_definition: createValidAgentDefinition({ id: "forged-agent", revision: "forged-v1" }),
    rationale: "Forged proposal.",
    confidence: 0.5,
    proposing_mechanism: { module: "agent-api/src/skill-registry-gate.js", identity: PROMOTION_GATE_IDENTITY },
    tool_names: ["update_agent_run_note"],
    created_at_ms: 1_000,
    expires_at_ms: 1_000 + 30 * 24 * 60 * 60 * 1000,
    consumed: false,
  };
  await draftStore.put(forgedDraft);
  const snapshotBefore = captureSnapshot(registry);
  await assert.rejects(
    () => gate.promote(forgedDraft.draft_id, OPERATOR_REF),
    (error) => error instanceof PromotionBlock && error.reasonCode === "proposer_identity_collision",
  );
  assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
});

test("no promote call means no draft id ever appears in the active snapshot", async () => {
  const { draftStore, registry } = createGateEnvironment();
  registry.register(createValidAgentDefinition());
  const snapshotBefore = captureSnapshot(registry);
  const { draftId } = await seedDraftFromProposer(draftStore);
  assert.equal(captureSnapshot(registry), snapshotBefore);
  assert.ok(draftId);
});

test("the gate touches the draft store only through peek and markConsumed", async () => {
  const { draftStore, gate } = createGateEnvironment();
  const { draftId } = await seedDraftFromProposer(draftStore);
  draftStore.calls.length = 0;
  await gate.promote(draftId, OPERATOR_REF);
  const methods = new Set(draftStore.calls.map((call) => call.method));
  for (const method of methods) {
    assert.ok(["peek", "markConsumed"].includes(method), `unexpected draft store method ${method}`);
  }
});

// Feature: native-skill-creation-harness, Property 10: Promotion closed by default.
test("Property 10: Promotion closed by default", async () => {
  const unresolvedReferenceArb = fc.anything().filter((value) => typeof value !== "string" || !value.trim() || value.trim() !== OPERATOR_REF);
  const extraOptionsArb = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 12 }).filter((key) => !["draftStore", "agentDefinitionRegistry", "toolAllowlist", "resolveOperatorInstruction", "emitTrace", "now"].includes(key)),
    fc.anything(),
    { minKeys: 1, maxKeys: 3 },
  );
  await fc.assert(
    fc.asyncProperty(extraOptionsArb, unresolvedReferenceArb, async (extraOptions, reference) => {
      assert.throws(
        () => createSkillRegistryGate(extraOptions),
        (error) => error instanceof TypeError && Object.keys(extraOptions).some((key) => error.message.includes(key)),
      );
      const { draftStore, registry, allowlist, gate } = createGateEnvironment();
      const { draftId } = await seedDraftFromProposer(draftStore);
      const snapshotBefore = captureSnapshot(registry);
      const allowlistBefore = allowlist.snapshot();
      const outcome = await gate.promote(draftId, reference);
      assert.equal(outcome.status, "blocked");
      assert.equal(outcome.reason_code, "operator_instruction_unresolved");
      assert.equal(outcome.promotion_record, null);
      assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
      assert.equal(allowlist.snapshot(), allowlistBefore);
      assert.equal(gate.boundaryState(draftId), "closed");
    }),
    { numRuns: 100, seed: PROPERTY_SEED + 10 },
  );
});

// Feature: native-skill-creation-harness, Property 11: Promotion record completeness and provenance invariance.
test("Property 11: Promotion record completeness and provenance invariance", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (writtenByProposer) => {
      const environment = createGateEnvironment();
      const { draftStore, gate } = environment;
      let draftId;
      let expectedIdentity;
      let expectedModule;
      if (writtenByProposer) {
        ({ draftId } = await seedDraftFromProposer(draftStore));
        const draft = await draftStore.peek(draftId);
        expectedIdentity = draft.proposing_mechanism.identity;
        expectedModule = draft.proposing_mechanism.module;
      } else {
        const directDraft = createDirectDraft({
          draft_id: "gap-direct:1000",
          proposing_mechanism: {
            module: "fixtures/direct-draft-writer.mjs",
            identity: "fixture-direct-writer",
          },
        });
        await draftStore.put(directDraft);
        draftId = directDraft.draft_id;
        expectedIdentity = directDraft.proposing_mechanism.identity;
        expectedModule = directDraft.proposing_mechanism.module;
      }

      const outcome = await gate.promote(draftId, OPERATOR_REF);
      assert.equal(outcome.status, "promoted");
      assert.equal(outcome.reason_code, null);
      assert.deepEqual(Object.keys(outcome.promotion_record).sort(), ["boundary", "proposing_mechanism", "schema"]);
      assert.deepEqual(Object.keys(outcome.promotion_record.boundary).sort(), [
        "evidence_reference",
        "name",
        "operator_instruction_reference",
        "rollback_statement",
      ]);
      assert.equal(outcome.promotion_record.boundary.name, PROMOTION_BOUNDARY_NAME);
      assert.equal(outcome.promotion_record.boundary.operator_instruction_reference, OPERATOR_REF);
      assert.equal(outcome.promotion_record.proposing_mechanism.identity, expectedIdentity);
      assert.equal(outcome.promotion_record.proposing_mechanism.module, expectedModule);
      assert.notEqual(outcome.promotion_record.proposing_mechanism.identity, PROMOTION_GATE_IDENTITY);
    }),
    { numRuns: 50, seed: PROPERTY_SEED + 11 },
  );
});

// Feature: native-skill-creation-harness, Property 12: Promotion is the sole proposed-to-active transition.
test("Property 12: Promotion is the sole proposed-to-active transition", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("propose", "register"), { minLength: 0, maxLength: 12 }),
      async (operations) => {
        const { draftStore, registry } = createGateEnvironment();
        const registrationInterface = createAdapterRegistrationInterface({
          agentDefinitionRegistry: registry,
          toolAllowlist: createInMemoryToolAllowlist(),
          resolveOperatorInstruction: createOperatorInstructionResolver({ resolvable: [] }).resolveOperatorInstruction,
        });

        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index];
          if (operation === "propose") {
            const adapter = createScriptedCandidateAdapter(["valid"], {
              validCandidate: {
                agent_definition: createValidAgentDefinition({
                  id: `draft-agent-${index}`,
                  revision: `draft-${index}-v1`,
                }),
                rationale: `rationale-${index}`,
                confidence: 0.5,
              },
            });
            const proposer = createSkillProposerRuntime({
              draftStore,
              proposeCandidate: adapter.proposeCandidate,
            });
            await proposer.propose(createValidGapSignal({
              signal_id: `gap-${index}`,
              missing_tool_names: [`update_agent_run_note_${index}`],
            }));
          } else {
            await registrationInterface.register(
              createValidAgentDefinition({
                id: `registered-agent-${index}`,
                revision: `registered-${index}-v1`,
                status: "proposed",
              }),
              createValidToolAllowlistEntry({
                entry_id: `allowlist-${index}`,
                agent_definition_id: `registered-agent-${index}`,
              }),
              {
                route: "/propose-skill",
                tag: "#skill-candidate",
                binding: "@skill-registry",
                tool_identity: "acos.adapter.register",
              },
            );
          }
        }

        const snapshot = JSON.parse(captureSnapshot(registry));
        assert.deepEqual(snapshot.definitions, []);
        assert.equal(registry.stats().statusCounts.active, 0);
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 12 },
  );
});
