import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  ACTIVE_REGISTRY_SNAPSHOT_SCHEMA,
  AGENT_DEFINITION_STATUSES,
  AgentDefinitionBlock,
  createAgentDefinitionRegistry,
} from "../agent-api/src/agent-definitions.js";
import {
  assertSnapshotUnchanged,
  captureSnapshot,
  createValidAgentDefinition,
} from "./lib/native-skill-harness-fakes.mjs";

const PROPERTY_SEED = 20260817;

function identifierArb(label) {
  return fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((value) => value.trim().length > 0)
    .map((value) => `${label}-${value.replace(/\s+/g, "-")}`);
}

const validDefinitionArb = fc.record({
  id: identifierArb("agent"),
  revision: identifierArb("rev"),
  name: identifierArb("Name"),
}).map((overrides) => createValidAgentDefinition(overrides));

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

test("a definition registered with no status key defaults to active and stays dispatchable", async () => {
  const registry = createRegistry();
  const definition = createValidAgentDefinition();
  assert.equal("status" in definition, false);

  registry.register(definition);
  const snapshot = registry.snapshot();
  assert.equal(snapshot.schema, ACTIVE_REGISTRY_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.agents, 1);
  assert.ok(snapshot.serialization.includes('"id":"knowgrph-note-agent"'));
  assert.ok(snapshot.serialization.includes('"status":"active"'));

  const prepared = await registry.prepare({ agentId: definition.id });
  assert.notEqual(prepared.reasonCode, "agent_not_active");
  assert.equal(prepared.status, "ready");

  const stats = registry.stats();
  assert.deepEqual(stats.statusCounts, { proposed: 0, active: 1, deprecated: 0 });
  assert.equal(stats.snapshotDigestAlgorithm, "sha-256");
  assert.equal(
    stats.statusCounts.proposed + stats.statusCounts.active + stats.statusCounts.deprecated,
    stats.agents,
  );
});

test("snapshot serialization is byte-identical across repeated calls", () => {
  const registry = createRegistry();
  registry.register(createValidAgentDefinition());
  registry.register(createValidAgentDefinition({
    id: "aaa-first-agent",
    revision: "first-v1",
    name: "First Agent",
  }));
  assert.equal(captureSnapshot(registry), captureSnapshot(registry));
});

// Feature: native-skill-creation-harness, Property 1: Snapshot canonicality and insertion-order independence.
test("Property 1: Snapshot canonicality and insertion-order independence", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(validDefinitionArb, {
        minLength: 1,
        maxLength: 6,
        selector: (definition) => definition.id,
      }),
      async (definitions) => {
        const first = createRegistry();
        const second = createRegistry();
        for (const definition of definitions) first.register(definition);
        for (const definition of [...definitions].reverse()) second.register(definition);
        const firstSnapshot = first.snapshot().serialization;
        const secondSnapshot = second.snapshot().serialization;
        assert.equal(firstSnapshot, secondSnapshot);
        assert.equal(firstSnapshot, first.snapshot().serialization);
        assert.equal(secondSnapshot, second.snapshot().serialization);
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED },
  );
});

test("snapshot entry ordering is ascending by id regardless of insertion order", () => {
  const first = createRegistry();
  const second = createRegistry();
  const definitions = [
    createValidAgentDefinition(),
    createValidAgentDefinition({ id: "aaa-first-agent", revision: "first-v1", name: "First Agent" }),
    createValidAgentDefinition({ id: "zzz-last-agent", revision: "last-v1", name: "Last Agent" }),
  ];
  for (const definition of definitions) first.register(definition);
  for (const definition of [...definitions].reverse()) second.register(definition);
  assert.equal(captureSnapshot(first), captureSnapshot(second));
  assert.ok(captureSnapshot(first).indexOf("aaa-first-agent") < captureSnapshot(first).indexOf("knowgrph-note-agent"));
});

test("proposed and deprecated definitions are invisible to snapshot and dispatch but counted", async () => {
  const registry = createRegistry();
  registry.register(createValidAgentDefinition());
  registry.register(createValidAgentDefinition({ id: "proposed-agent", revision: "proposed-v1", status: "proposed" }));
  registry.register(createValidAgentDefinition({ id: "deprecated-agent", revision: "deprecated-v1", status: "deprecated" }));

  const snapshot = registry.snapshot();
  assert.equal(snapshot.agents, 1);
  assert.equal(snapshot.serialization.includes("proposed-agent"), false);
  assert.equal(snapshot.serialization.includes("deprecated-agent"), false);
  assert.deepEqual(registry.stats().statusCounts, { proposed: 1, active: 1, deprecated: 1 });

  const prepared = await registry.prepare({ agentId: "proposed-agent" });
  assert.equal(prepared.status, "blocked");
  assert.equal(prepared.reasonCode, "agent_not_active");
});

test("an unsupported status value is rejected inertly", () => {
  const registry = createRegistry();
  registry.register(createValidAgentDefinition());
  const before = captureSnapshot(registry);
  assert.throws(
    () => registry.register(createValidAgentDefinition({ id: "bad-status-agent", status: "Active" })),
    (error) => error instanceof TypeError && /definition\.status/.test(error.message),
  );
  assert.throws(
    () => registry.register(createValidAgentDefinition({ id: "padded-status-agent", status: "active " })),
    (error) => error instanceof TypeError && /definition\.status/.test(error.message),
  );
  assertSnapshotUnchanged(before, captureSnapshot(registry));
});

// Feature: native-skill-creation-harness, Property 2: Status round trip with default-to-active.
test("Property 2: Status round trip with default-to-active", async () => {
  await fc.assert(
    fc.asyncProperty(
      validDefinitionArb,
      fc.option(fc.constantFrom(...AGENT_DEFINITION_STATUSES), { nil: undefined }),
      async (definition, status) => {
        const registry = createRegistry();
        const candidate = status === undefined ? definition : { ...definition, status };
        registry.register(candidate);
        const expectedStatus = status ?? "active";
        assert.equal(registry.stats().statusCounts[expectedStatus], 1);
        const prepared = await registry.prepare({ agentId: definition.id });
        if (expectedStatus === "active") {
          assert.equal(prepared.status, "ready");
          const snapshot = JSON.parse(captureSnapshot(registry));
          assert.deepEqual(snapshot.definitions.map((entry) => entry.id), [definition.id]);
          assert.equal(snapshot.definitions[0].status, "active");
        } else {
          assert.equal(prepared.status, "blocked");
          assert.equal(prepared.reasonCode, "agent_not_active");
          const snapshot = JSON.parse(captureSnapshot(registry));
          assert.deepEqual(snapshot.definitions, []);
        }
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 1 },
  );
});

// Feature: native-skill-creation-harness, Property 3: Invalid status is rejected inertly.
test("Property 3: Invalid status is rejected inertly", async () => {
  await fc.assert(
    fc.asyncProperty(
      validDefinitionArb,
      fc.anything().filter((value) => value !== undefined && !AGENT_DEFINITION_STATUSES.includes(value)),
      async (definition, invalidStatus) => {
        const registry = createRegistry();
        registry.register(definition);
        const before = captureSnapshot(registry);
        assert.throws(
          () => registry.register(createValidAgentDefinition({
            id: `${definition.id}-invalid`,
            revision: `${definition.revision}-invalid`,
            status: invalidStatus,
          })),
          (error) => error instanceof TypeError && /definition\.status/.test(error.message),
        );
        assertSnapshotUnchanged(before, captureSnapshot(registry));
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 2 },
  );
});

// Feature: native-skill-creation-harness, Property 4: Non-active definitions are invisible to snapshot, dispatch, and counts.
test("Property 4: Non-active definitions are invisible to snapshot, dispatch, and counts", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(
        fc.record({
          definition: validDefinitionArb,
          status: fc.constantFrom(...AGENT_DEFINITION_STATUSES),
        }),
        {
          minLength: 1,
          maxLength: 6,
          selector: ({ definition }) => definition.id,
        },
      ),
      async (pairs) => {
        const registry = createRegistry();
        for (const { definition, status } of pairs) {
          registry.register({ ...definition, status });
        }
        const stats = registry.stats();
        const snapshot = JSON.parse(captureSnapshot(registry));
        const activeSnapshotIds = new Set(snapshot.definitions.map((entry) => entry.id));
        const expectedCounts = { proposed: 0, active: 0, deprecated: 0 };
        for (const { definition, status } of pairs) {
          expectedCounts[status] += 1;
          if (status === "active") {
            assert.equal(activeSnapshotIds.has(definition.id), true);
            const prepared = await registry.prepare({ agentId: definition.id });
            assert.equal(prepared.status, "ready");
          } else {
            assert.equal(activeSnapshotIds.has(definition.id), false);
            const prepared = await registry.prepare({ agentId: definition.id });
            assert.equal(prepared.status, "blocked");
            assert.equal(prepared.reasonCode, "agent_not_active");
          }
        }
        assert.deepEqual(stats.statusCounts, expectedCounts);
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED + 3 },
  );
});

test("re-registering the same id and revision with a different status is a revision conflict", () => {
  const registry = createRegistry();
  registry.register(createValidAgentDefinition({ status: "proposed" }));
  const before = captureSnapshot(registry);
  assert.throws(
    () => registry.register(createValidAgentDefinition({ status: "active" })),
    (error) => error instanceof AgentDefinitionBlock && error.reasonCode === "agent_revision_conflict",
  );
  assertSnapshotUnchanged(before, captureSnapshot(registry));
  assert.equal(registry.stats().statusCounts.active, 0);
});

test("the exported status enum is the closed lifecycle set", () => {
  assert.deepEqual(AGENT_DEFINITION_STATUSES, ["proposed", "active", "deprecated"]);
});

test("strict validators reject unknown fields with messages naming the field", () => {
  const registry = createRegistry();
  assert.throws(
    () => registry.register({ ...createValidAgentDefinition(), extra_field: true }),
    (error) => error instanceof TypeError && /definition contains unsupported fields: extra_field/.test(error.message),
  );
  assert.throws(
    () => registry.register(createValidAgentDefinition({
      source: { uri: "workspace:/agents/extra-source.json", digest: "d".repeat(64), extra_field: true },
    })),
    (error) => error instanceof TypeError && /source contains unsupported fields: extra_field/.test(error.message),
  );
  assert.throws(
    () => registry.register(createValidAgentDefinition({
      model: { providerId: "workspace-provider", modelId: "workspace-model", extra_field: true },
    })),
    (error) => error instanceof TypeError && /model contains unsupported fields: extra_field/.test(error.message),
  );
  assert.throws(
    () => registry.register(createValidAgentDefinition({
      instructions: [{ name: "purpose", content: "Draft agent run notes through the MCP gateway.", extra_field: true }],
    })),
    (error) => error instanceof TypeError && /instructions\[0\] contains unsupported fields: extra_field/.test(error.message),
  );
});

test("snapshotDigest returns a stable sha-256 hex string for logging only", async () => {
  const registry = createRegistry();
  registry.register(createValidAgentDefinition());
  const digest = await registry.snapshotDigest();
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, await registry.snapshotDigest());
});
