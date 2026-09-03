import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";

import { createSkillProposerRuntime } from "../agent-api/src/skill-proposer.js";
import { createSkillRegistryGate } from "../agent-api/src/skill-registry-gate.js";
import {
  createInMemoryDraftStore,
  createOperatorInstructionResolver,
  createScriptedCandidateAdapter,
} from "./lib/native-skill-harness-fakes.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pinned identity-migration digests: later work must not broaden this narrow rename.
const WRANGLER_SHA256 = "66c445c9e5a8bd0e67786bce4c2113e7f0a68fc70add9341a7518ca052d7d59c";
const SKILL_EVOLUTION_SHA256 = "e2c17a57a15de7ad47699908739abfc4c8f4b42760cc280d937be6ad2d521a08";
const PROPERTY_SEED = 20260817;
const retiredNamespace = ["k", "now", "grph"].join("");
const retiredProductEnvPrefix = ["AGENTIC", "GRAPH_"].join("");

function parseLocalImports(text) {
  return [...text.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) => match[1]);
}

test("every durable-object state store scope prefix is unique per factory", async () => {
  const text = await readFile(path.join(REPOSITORY_ROOT, "agent-api/src/durable-object-state-store.js"), "utf8");
  // Split the file into factory bodies so a prefix used twice inside one
  // factory (the same namespace) does not read as a cross-factory collision.
  const factoryBodies = text.split(/export function createDurableObject/).slice(1);
  assert.ok(factoryBodies.length >= 7, `expected at least 7 store factories, found ${factoryBodies.length}`);
  const prefixSets = factoryBodies.map((body) => {
    const prefixes = [...body.matchAll(/`([a-z0-9-]+):\$\{/g)].map((match) => match[1]);
    return new Set(prefixes);
  });
  const allPrefixes = prefixSets.flatMap((set) => [...set]);
  assert.ok(allPrefixes.includes("skill-draft"), "the skill-draft prefix must be declared");
  assert.ok(allPrefixes.includes("skill-draft-index"), "the skill-draft-index prefix must be declared");
  const collisions = [];
  for (let outer = 0; outer < prefixSets.length; outer += 1) {
    for (let inner = outer + 1; inner < prefixSets.length; inner += 1) {
      for (const prefix of prefixSets[outer]) {
        if (prefixSets[inner].has(prefix)) collisions.push(prefix);
      }
    }
  }
  assert.deepEqual(collisions, [], "no two store factories may share a scope prefix");
});

test("the proposer runtime surface is exactly propose and stats", () => {
  const runtime = createSkillProposerRuntime({
    draftStore: createInMemoryDraftStore(),
    proposeCandidate: createScriptedCandidateAdapter(["valid"]).proposeCandidate,
  });
  assert.deepEqual(Object.keys(runtime).sort(), ["propose", "stats"]);
  assert.equal(Object.isFrozen(runtime), true);
});

test("the gate accepts no model-adapter-shaped and no fetch-shaped parameter", () => {
  for (const option of [
    { proposeCandidate: () => {} },
    { fetch: () => {} },
    { fetchImpl: () => {} },
    { modelAdapter: () => {} },
  ]) {
    assert.throws(() => createSkillRegistryGate(option), /unsupported fields/);
  }
  const gate = createSkillRegistryGate({
    draftStore: createInMemoryDraftStore(),
    resolveOperatorInstruction: createOperatorInstructionResolver({ resolvable: ["ref"] }).resolveOperatorInstruction,
  });
  assert.deepEqual(Object.keys(gate).sort(), ["boundaryState", "promote", "stats"]);
  assert.equal(gate.stats().modelCallCapability, false);
});

test("wrangler.jsonc pins the identity migration and private admission boundary", async () => {
  const text = await readFile(path.join(REPOSITORY_ROOT, "wrangler.jsonc"), "utf8");
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    WRANGLER_SHA256,
    "wrangler.jsonc drifted beyond the reviewed identity and admission boundary",
  );
  assert.match(text, /AGENTIC_OS_MCP_ENDPOINT/);
  assert.match(text, /agentic-mcp-dev/);
  assert.equal(text.toLowerCase().includes(retiredNamespace), false, "retired worker identity must not return");
  assert.equal(new RegExp(`\\b${retiredProductEnvPrefix}`).test(text), false, "retired product runtime env names must not return");
  assert.equal(text.includes("/agentic-graph"), false, "agentic-graph runtime routes must not return");
  // Comment-tolerant parse of the JSONC body for the structural counts.
  const parsed = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(parsed.durable_objects.bindings.length, 2);
  assert.equal(parsed.migrations.length, 2);
  assert.equal(parsed.ratelimits.length, 2);
  assert.equal(parsed.assets ? 1 : 0, 1);
  assert.equal(parsed.env.dev.services.length, 1);
  assert.deepEqual(parsed.env.dev.services[0], {
    binding: "AGENTIC_OS_MCP_SERVICE",
    service: "agentic-mcp-dev",
  });
  assert.equal(
    parsed.env.dev.vars.AGENTIC_OS_MCP_ENDPOINT,
    "https://agentic-mcp-dev.huijoohwee.workers.dev/agentic-os/control-plane/mcp",
  );
  for (const config of [parsed, parsed.env.dev]) {
    assert.match(config.vars.AGENTIC_OS_ADMISSION_AUTHORITY_REF, /^__AGENTIC_OS_/u);
    assert.match(config.vars.AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF, /^__AGENTIC_OS_/u);
    assert.match(config.vars.AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE, /^__AGENTIC_OS_/u);
    assert.ok(config.assets.run_worker_first.includes("/agentic-os/internal"));
    assert.ok(config.assets.run_worker_first.includes("/agentic-os/internal/*"));
    assert.ok(config.assets.run_worker_first.includes("/agentic-os/internal/*"));
    assert.ok(config.secrets.required.includes("AGENTIC_OS_ADMISSION_AUTH_SECRET"));
    assert.ok(config.secrets.required.includes("AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET"));
  }
  assert.equal(/\bACOS_ADMISSION\b/.test(text), false, "legacy admission runtime variables must not return");
  assert.equal("kv_namespaces" in parsed, false);
  assert.equal("d1_databases" in parsed, false);
});

test("docs/SKILL-EVOLUTION.md preserves flag semantics through the identity migration", async () => {
  const text = await readFile(path.join(REPOSITORY_ROOT, "docs/SKILL-EVOLUTION.md"), "utf8");
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    SKILL_EVOLUTION_SHA256,
    "docs/SKILL-EVOLUTION.md drifted beyond the reviewed identity migration",
  );
  assert.equal(text.toLowerCase().includes(retiredNamespace), false, "retired product identity must not return");
  // No new module sets, reads, or reinterprets the Skill Evolution flags.
  for (const modulePath of ["agent-api/src/skill-proposer.js", "agent-api/src/skill-registry-gate.js", "agent-api/src/adapter-registration.js"]) {
    const moduleText = await readFile(path.join(REPOSITORY_ROOT, modulePath), "utf8");
    assert.equal(/modelWeightsMutated|deploymentAttempted/.test(moduleText), false, `${modulePath} references Skill Evolution flags`);
  }
});

// Feature: native-skill-creation-harness, Property 14: Evaluator independence as a structural invariant.
test("Property 14: Evaluator independence as a structural invariant", async () => {
  const proposerText = await readFile(path.join(REPOSITORY_ROOT, "agent-api/src/skill-proposer.js"), "utf8");
  const gateText = await readFile(path.join(REPOSITORY_ROOT, "agent-api/src/skill-registry-gate.js"), "utf8");
  const adapterRegistrationText = await readFile(path.join(REPOSITORY_ROOT, "agent-api/src/adapter-registration.js"), "utf8");
  const definitionsText = await readFile(path.join(REPOSITORY_ROOT, "agent-api/src/agent-definitions.js"), "utf8");
  const proposerImports = parseLocalImports(proposerText);
  const gateImports = parseLocalImports(gateText);
  const adapterRegistrationImports = parseLocalImports(adapterRegistrationText);
  const definitionsImports = parseLocalImports(definitionsText);

  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          useKnownDraftId: fc.boolean(),
          reference: fc.anything(),
        }),
        { minLength: 0, maxLength: 20 },
      ),
      async (promoteInputs) => {
        assert.equal(proposerImports.includes("./skill-registry-gate.js"), false);
        assert.equal(proposerImports.includes("./adapter-registration.js"), false);
        assert.equal(proposerImports.includes("./agent-definitions.js"), false);
        assert.equal(gateImports.includes("./skill-proposer.js"), false);
        assert.equal(gateImports.some((specifier) => /openai|model|provider/i.test(specifier)), false);
        assert.equal(definitionsImports.includes("./skill-proposer.js"), false);
        assert.equal(definitionsImports.includes("./skill-registry-gate.js"), false);
        assert.equal(definitionsImports.includes("./adapter-registration.js"), false);
        assert.equal(adapterRegistrationImports.includes("./skill-proposer.js"), false);

        const proposerRuntime = createSkillProposerRuntime({
          draftStore: createInMemoryDraftStore(),
          proposeCandidate: createScriptedCandidateAdapter(["valid"]).proposeCandidate,
        });
        assert.deepEqual(Object.keys(proposerRuntime).sort(), ["propose", "stats"]);

        const draftStore = createInMemoryDraftStore();
        const gate = createSkillRegistryGate({
          draftStore,
          resolveOperatorInstruction: createOperatorInstructionResolver({ resolvable: ["ref"] }).resolveOperatorInstruction,
        });
        const draftId = "fixture-draft";
        await draftStore.put({
          schema: "acos-skill-draft/v1",
          draft_id: draftId,
          status: "proposed",
          adapter_id: "agentic-graph",
          gap_signal_id: "gap-001",
          agent_definition: {
            id: "fixture-agent",
            revision: "fixture-v1",
            name: "Fixture Agent",
            source: { uri: "workspace:/agents/fixture.json", digest: "d".repeat(64) },
            model: { providerId: "fixture-provider", modelId: "fixture-model" },
            instructions: [{ name: "purpose", content: "Fixture draft." }],
          },
          rationale: "Fixture rationale.",
          confidence: 0.5,
          proposing_mechanism: { module: "agent-api/src/skill-proposer.js", identity: "acos-skill-proposer" },
          tool_names: ["update_agent_run_note"],
          created_at_ms: 1_000,
          expires_at_ms: 1_000 + 30 * 24 * 60 * 60 * 1000,
          consumed: false,
        });
        draftStore.calls.length = 0;
        for (let index = 0; index < promoteInputs.length; index += 1) {
          const input = promoteInputs[index];
          const candidateDraftId = input.useKnownDraftId ? draftId : { missing: index };
          await gate.promote(candidateDraftId, input.reference);
        }
        const methods = new Set(draftStore.calls.map((call) => call.method));
        for (const method of methods) {
          assert.ok(["peek", "markConsumed"].includes(method), `unexpected draft store method ${method}`);
        }
      },
    ),
    { numRuns: 75, seed: PROPERTY_SEED + 14 },
  );
});
