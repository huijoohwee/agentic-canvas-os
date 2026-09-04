import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  ADAPTER_REGISTRATION_OWNER,
  REGISTRATION_FINDING_SCHEMA,
  REGISTRATION_FINDING_TYPES,
  REGISTRATION_RECORD_SCHEMA,
  RegistrationBlock,
  createAdapterRegistrationInterface,
} from "../agent-api/src/adapter-registration.js";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import {
  assertSnapshotUnchanged,
  captureSnapshot,
  createInMemoryToolAllowlist,
  createInvocationRegisterFake,
  createOperatorInstructionResolver,
  createRecordingObserver,
  createValidAgentDefinition,
  createValidToolAllowlistEntry,
} from "./lib/native-skill-harness-fakes.mjs";

const OPERATOR_REF = "operator-instruction/adapter-register/2026-08-17";
const PROPERTY_SEED = 20260817;
const REGISTERED_TOKENS = [
  "/propose-skill",
  "#skill-candidate",
  "@skill-registry",
  "agentic-os.adapter.register",
];

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

function createInterface({ resolverResolvable = [OPERATOR_REF], declared = REGISTERED_TOKENS } = {}) {
  const registry = createRegistry();
  const allowlist = createInMemoryToolAllowlist();
  const resolver = createOperatorInstructionResolver({ resolvable: resolverResolvable });
  const invocationRegister = createInvocationRegisterFake({ declared });
  const traceObserver = createRecordingObserver();
  let clock = 9_000;
  const registrationInterface = createAdapterRegistrationInterface({
    agentDefinitionRegistry: registry,
    toolAllowlist: allowlist,
    invocationRegister,
    resolveOperatorInstruction: resolver.resolveOperatorInstruction,
    emitTrace: traceObserver.emit,
    now: () => clock,
  });
  return { registry, allowlist, invocationRegister, registrationInterface };
}

function validInvocationRegisterEntry(overrides = {}) {
  return {
    route: "/propose-skill",
    tag: "#skill-candidate",
    binding: "@skill-registry",
    tool_identity: "agentic-os.adapter.register",
    ...overrides,
  };
}

function normalizeOutcomeIdentity(outcome) {
  if (outcome.status === "registered") {
    return {
      status: "registered",
      resulting_status: outcome.record.resulting_status,
      adapter_identity: outcome.record.adapter_identity,
      agent_definition_id: outcome.record.agent_definition_id,
      finding_type: null,
      finding_reason: null,
    };
  }
  return {
    status: "rejected",
    resulting_status: null,
    adapter_identity: outcome.finding.adapter_identity,
    agent_definition_id: null,
    finding_type: outcome.finding.type,
    finding_reason: outcome.finding.reason_code,
  };
}

async function executeTriples(triples, order) {
  const resolvableReferences = triples
    .filter((triple) => triple.resolvable)
    .map((triple) => `operator://triple/${triple.suffix}`);
  const { registry, registrationInterface } = createInterface({ resolverResolvable: resolvableReferences });
  const outcomes = new Map();
  for (const position of order) {
    const triple = triples[position];
    const snapshotBefore = captureSnapshot(registry);
    const agentDefinition = (() => {
      switch (triple.definition_state) {
        case "valid":
          return createValidAgentDefinition({
            id: `agentic-graph-${triple.suffix}-agent`,
            revision: `${triple.suffix}-v1`,
          });
        case "missing":
          return undefined;
        case "malformed":
          return { id: `broken-${triple.suffix}`, revision: "", name: "Broken" };
        default:
          return triple.definition_arbitrary;
      }
    })();
    const toolAllowlistEntry = (() => {
      switch (triple.allowlist_state) {
        case "valid":
          return createValidToolAllowlistEntry({
            entry_id: `allowlist-${triple.suffix}`,
            agent_definition_id: `agentic-graph-${triple.suffix}-agent`,
          });
        case "missing":
          return undefined;
        case "malformed":
          return { entry_id: `bad-${triple.suffix}` };
        default:
          return triple.allowlist_arbitrary;
      }
    })();
    const invocationRegisterEntry = (() => {
      switch (triple.invocation_state) {
        case "valid":
          return validInvocationRegisterEntry();
        case "missing":
          return undefined;
        case "malformed":
          return { route: "/propose-skill" };
        default:
          return triple.invocation_arbitrary;
      }
    })();
    const operatorInstructionRef = triple.resolvable
      ? `operator://triple/${triple.suffix}`
      : `operator://never/${triple.suffix}`;
    const outcome = await registrationInterface.register(
      agentDefinition,
      toolAllowlistEntry,
      invocationRegisterEntry,
      operatorInstructionRef,
    );
    if (outcome.status === "rejected") {
      assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
    }
    outcomes.set(triple.suffix, normalizeOutcomeIdentity(outcome));
  }
  return outcomes;
}

test("registration identity is owned by the agentic-os generation", () => {
  assert.equal(ADAPTER_REGISTRATION_OWNER, "agentic-os-adapter-registration");
  assert.equal(REGISTRATION_RECORD_SCHEMA, "agentic-os-adapter-registration/v1");
  assert.equal(REGISTRATION_FINDING_SCHEMA, "agentic-os-adapter-registration-finding/v1");
  assert.deepEqual(REGISTRATION_FINDING_TYPES, ["unfederated-tool", "uncatalogued-tool"]);
});

test("a agentic-graph-shaped registration with a resolved reference produces a Registration_Record", async () => {
  // Min-Viable Scope is proven against the existing agentic-graph adapter only;
  // the second-adapter genericity proof is outside this increment.
  const { registry, registrationInterface } = createInterface();
  const outcome = await registrationInterface.register(
    createValidAgentDefinition(),
    createValidToolAllowlistEntry(),
    validInvocationRegisterEntry(),
    OPERATOR_REF,
  );
  assert.equal(outcome.status, "registered");
  assert.equal(outcome.finding, null);
  const record = outcome.record;
  assert.equal(record.schema, REGISTRATION_RECORD_SCHEMA);
  assert.equal(record.adapter_identity, "agentic-graph");
  assert.equal(record.agent_definition_id, "agentic-graph-note-agent");
  assert.equal(record.tool_allowlist_entry_id, "allowlist-agentic-graph-note-agent-1");
  assert.deepEqual(record.invocation_register_tokens, REGISTERED_TOKENS);
  assert.equal(record.resulting_status, "active");
  assert.equal(record.operator_instruction_reference, OPERATOR_REF);
  assert.ok(Number.isFinite(record.registered_at_ms));
  assert.ok(captureSnapshot(registry).includes("agentic-graph-note-agent"));
});

test("a missing or malformed tool allowlist entry is an unfederated-tool finding", async () => {
  const { registry, registrationInterface } = createInterface();
  const snapshotBefore = captureSnapshot(registry);
  for (const entry of [undefined, null, "not-an-object", { entry_id: "x" }]) {
    const outcome = await registrationInterface.register(createValidAgentDefinition(), entry, validInvocationRegisterEntry(), OPERATOR_REF);
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.finding.schema, REGISTRATION_FINDING_SCHEMA);
    assert.equal(outcome.finding.type, "unfederated-tool");
  }
  assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
});

test("a missing or undeclared invocation register entry is an uncatalogued-tool finding", async () => {
  const { registry, registrationInterface } = createInterface();
  const snapshotBefore = captureSnapshot(registry);
  const missing = await registrationInterface.register(
    createValidAgentDefinition(),
    createValidToolAllowlistEntry(),
    undefined,
    OPERATOR_REF,
  );
  assert.equal(missing.finding.type, "uncatalogued-tool");

  const undeclared = await registrationInterface.register(
    createValidAgentDefinition(),
    createValidToolAllowlistEntry(),
    validInvocationRegisterEntry({ tool_identity: "acos.unknown.tool" }),
    OPERATOR_REF,
  );
  assert.equal(undeclared.finding.type, "uncatalogued-tool");
  assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
});

test("an invalid agent definition is converted to a typed finding, never a raw TypeError", async () => {
  const { registrationInterface } = createInterface();
  const outcome = await registrationInterface.register(
    { id: "broken", revision: "", name: "Broken" },
    createValidToolAllowlistEntry(),
    validInvocationRegisterEntry(),
    OPERATOR_REF,
  );
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.finding.type, "unfederated-tool");
  assert.equal(outcome.finding.reason_code, "agent_definition_invalid");
});

test("an active outcome without a resolvable operator reference is rejected", async () => {
  const { registry, registrationInterface } = createInterface({ resolverResolvable: [] });
  const snapshotBefore = captureSnapshot(registry);
  const outcome = await registrationInterface.register(
    createValidAgentDefinition(),
    createValidToolAllowlistEntry(),
    validInvocationRegisterEntry(),
    "operator-instruction/never-recorded/1",
  );
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.finding.type, "unfederated-tool");
  assert.equal(outcome.finding.reason_code, "operator_instruction_required");
  assertSnapshotUnchanged(snapshotBefore, captureSnapshot(registry));
});

test("a proposed-status registration needs no operator reference and never activates", async () => {
  const { registry, registrationInterface } = createInterface();
  const outcome = await registrationInterface.register(
    createValidAgentDefinition({ status: "proposed" }),
    createValidToolAllowlistEntry(),
    validInvocationRegisterEntry(),
  );
  assert.equal(outcome.status, "registered");
  assert.equal(outcome.record.resulting_status, "proposed");
  assert.equal(outcome.record.operator_instruction_reference, null);
  assert.equal(captureSnapshot(registry).includes("agentic-graph-note-agent"), false);
  assert.equal(registry.stats().statusCounts.proposed, 1);
});

test("concurrent registrations for distinct ids all settle with one terminal outcome each", async () => {
  const { registrationInterface } = createInterface();
  const definitions = ["a", "b", "c", "d"].map((suffix) => createValidAgentDefinition({
    id: `agentic-graph-${suffix}-agent`,
    revision: `${suffix}-v1`,
  }));
  const outcomes = await Promise.all(definitions.map((definition, index) => registrationInterface.register(
    definition,
    createValidToolAllowlistEntry({
      entry_id: `allowlist-${index}`,
      agent_definition_id: definition.id,
    }),
    validInvocationRegisterEntry(),
    OPERATOR_REF,
  )));
  assert.equal(outcomes.length, 4);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "registered");
    assert.ok(outcome.record || outcome.finding);
  }
  assert.equal(registrationInterface.stats().registeredCount, 4);
  assert.equal(registrationInterface.stats().requestScopedState, false);
  assert.equal(registrationInterface.stats().sharedEntrypointAdapterNames, 0);
});

test("a conflicting revision surfaces as a typed agent_revision_conflict finding", async () => {
  const { registry, registrationInterface } = createInterface();
  registry.register(createValidAgentDefinition());
  const outcome = await registrationInterface.register(
    createValidAgentDefinition({ name: "Conflicting Name" }),
    createValidToolAllowlistEntry(),
    validInvocationRegisterEntry(),
    OPERATOR_REF,
  );
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.finding.type, "unfederated-tool");
  assert.equal(outcome.finding.reason_code, "agent_revision_conflict");
});

test("an unknown factory option is rejected at construction", () => {
  assert.throws(
    () => createAdapterRegistrationInterface({ adapterName: "agentic-graph" }),
    (error) => error instanceof TypeError && /adapterName/.test(error.message),
  );
  assert.equal(typeof RegistrationBlock, "function");
});

// Feature: native-skill-creation-harness, Property 13: Registration outcome totality and typed findings.
test("Property 13: Registration outcome totality and typed findings", async () => {
  const tripleArb = fc.record({
    suffix: fc.string({ minLength: 1, maxLength: 8 }).filter((value) => value.trim().length > 0),
    definition_state: fc.constantFrom("valid", "missing", "malformed", "arbitrary"),
    allowlist_state: fc.constantFrom("valid", "missing", "malformed", "arbitrary"),
    invocation_state: fc.constantFrom("valid", "missing", "malformed", "arbitrary"),
    resolvable: fc.boolean(),
    definition_arbitrary: fc.anything(),
    allowlist_arbitrary: fc.anything(),
    invocation_arbitrary: fc.anything(),
  });
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(tripleArb, {
        minLength: 1,
        maxLength: 8,
        selector: (triple) => triple.suffix,
      }),
      fc.array(fc.nat(), { minLength: 0, maxLength: 20 }),
      async (triples, indexHints) => {
        const canonicalOrder = triples.map((_, index) => index);
        const permutation = [];
        const seen = new Set();
        for (const hint of indexHints) {
          const index = hint % triples.length;
          if (!seen.has(index)) {
            permutation.push(index);
            seen.add(index);
          }
        }
        for (const index of canonicalOrder) {
          if (!seen.has(index)) permutation.push(index);
        }

        const first = await executeTriples(triples, canonicalOrder);
        const second = await executeTriples(triples, permutation);
        assert.equal(first.size, triples.length);
        assert.equal(second.size, triples.length);
        for (const triple of triples) {
          const firstOutcome = first.get(triple.suffix);
          const secondOutcome = second.get(triple.suffix);
          assert.deepEqual(firstOutcome, secondOutcome);
          if (firstOutcome.status === "rejected") {
            assert.ok(REGISTRATION_FINDING_TYPES.includes(firstOutcome.finding_type));
          }
        }
      },
    ),
    { numRuns: 75, seed: PROPERTY_SEED + 13 },
  );
});
