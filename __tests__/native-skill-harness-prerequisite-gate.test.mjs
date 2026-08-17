import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fc from "fast-check";

import {
  computeGateState,
  evaluatePrerequisiteRecord,
  projectRecordForEmission,
} from "../scripts/native-skill-harness-prerequisite-gate.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = path.join(REPOSITORY_ROOT, "scripts/native-skill-harness/prerequisite-gate.json");
const PROPERTY_SEED = 20260817;
const BLOCKED_RECORD = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
const PREREQUISITE_NAMES = BLOCKED_RECORD.prerequisites.map((prerequisite) => prerequisite.name);
const EMITTED_PREREQUISITE_KEYS = [
  "name",
  "readiness_pointer",
  "expected",
  "observed",
  "evidence_reference",
  "met",
];

function matchingObserved(expected) {
  return expected.startsWith("not:") ? "verified" : expected;
}

function mismatchingObserved(expected) {
  return expected.startsWith("not:") ? expected.slice(4) : "__mismatch__";
}

function readinessBodyFromBooleans(flags) {
  return {
    functionCalling: {
      configured: flags[0],
      providerExecutionStatus: flags[1] ? "verified" : "unverified",
    },
    toolSearch: {
      configured: flags[2],
    },
    agentDefinitions: {
      configured: flags[3],
      providerExecutionStatus: flags[4] ? "verified" : "unverified",
    },
    modelProviders: {
      configured: flags[5],
      providerExecutionStatus: flags[6] ? "verified" : "unverified",
    },
    skillProposer: { configured: false },
    skillRegistryGate: { configured: false },
    adapterRegistration: { configured: false },
  };
}

// Feature: native-skill-creation-harness, Property 15: Prerequisite gate state computation.
test("Property 15: prerequisite gate state computation", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
      fc.subarray(PREREQUISITE_NAMES),
      fc.option(fc.string({ minLength: 1, maxLength: 32 }).filter((value) => value.trim().length > 0), { nil: null }),
      async (flags, acceptedUnmet, operatorInstructionReference) => {
        const prerequisites = BLOCKED_RECORD.prerequisites.map((prerequisite, index) => ({
          ...prerequisite,
          observed: flags[index] ? matchingObserved(prerequisite.expected) : mismatchingObserved(prerequisite.expected),
        }));
        const unmet = prerequisites
          .filter((prerequisite, index) => !flags[index])
          .map((prerequisite) => prerequisite.name)
          .sort();
        const accepted = [...acceptedUnmet].sort();
        const waiverCoversExactly = accepted.length > 0
          && accepted.length === unmet.length
          && accepted.every((name, index) => name === unmet[index]);
        const expectedState = unmet.length === 0
          ? "satisfied"
          : operatorInstructionReference && waiverCoversExactly
            ? "waived"
            : "blocked";

        const actual = computeGateState(prerequisites, {
          acceptedUnmet,
          operatorInstructionReference,
        });

        assert.equal(actual.state, expectedState);
        assert.deepEqual([...actual.unmet].sort(), unmet);
      },
    ),
    { numRuns: 100, seed: PROPERTY_SEED },
  );
});

test("a satisfied record emission carries exactly the declared field set", () => {
  const record = {
    ...BLOCKED_RECORD,
    state: "satisfied",
    prerequisites: BLOCKED_RECORD.prerequisites.map((prerequisite) => ({
      ...prerequisite,
      observed: matchingObserved(prerequisite.expected),
      met: true,
    })),
  };

  const emitted = projectRecordForEmission(record);
  assert.deepEqual(Object.keys(emitted).sort(), ["feature", "prerequisites", "schema", "state"]);
  assert.equal(emitted.state, "satisfied");
  for (const prerequisite of emitted.prerequisites) {
    assert.deepEqual(Object.keys(prerequisite).sort(), [...EMITTED_PREREQUISITE_KEYS].sort());
  }
});

test("a waived record emission carries exactly the declared field set", () => {
  const record = {
    ...BLOCKED_RECORD,
    state: "waived",
    accepted_unmet: ["gateway-federation.function-calling-configured"],
    operator_instruction_reference: "operator://waive/native-skill-harness",
    prerequisites: BLOCKED_RECORD.prerequisites.map((prerequisite, index) => ({
      ...prerequisite,
      observed: index === 0 ? mismatchingObserved(prerequisite.expected) : matchingObserved(prerequisite.expected),
      met: index !== 0,
    })),
  };

  const emitted = projectRecordForEmission(record);
  assert.deepEqual(
    Object.keys(emitted).sort(),
    ["feature", "operator_instruction_reference", "prerequisites", "schema", "state"],
  );
  assert.equal(emitted.state, "waived");
  assert.equal(emitted.operator_instruction_reference, "operator://waive/native-skill-harness");
  for (const prerequisite of emitted.prerequisites) {
    assert.deepEqual(Object.keys(prerequisite).sort(), [...EMITTED_PREREQUISITE_KEYS].sort());
  }
});

test("a stale waiver whose accepted_unmet set no longer matches fails the check", () => {
  const record = {
    ...BLOCKED_RECORD,
    state: "waived",
    accepted_unmet: ["gateway-federation.function-calling-configured"],
    operator_instruction_reference: "operator://waive/native-skill-harness",
  };
  const readinessBody = readinessBodyFromBooleans([false, false, true, true, true, true, true]);

  const evaluation = evaluatePrerequisiteRecord(record, readinessBody);

  assert.equal(evaluation.computedState, "blocked");
  assert.match(
    evaluation.failures.join("\n"),
    /recorded state waived does not match computed state blocked/,
  );
});

test("a waiver with an exact accepted_unmet set passes without unmet failures", () => {
  const unmet = [
    "gateway-federation.function-calling-configured",
    "gateway-federation.function-calling-provider-execution",
  ];
  const record = {
    ...BLOCKED_RECORD,
    state: "waived",
    accepted_unmet: unmet,
    operator_instruction_reference: "operator://native-skill-harness/waive-prerequisite-gate-and-sequencing/2026-08-17",
  };
  const readinessBody = readinessBodyFromBooleans([false, false, true, true, true, true, true]);

  const evaluation = evaluatePrerequisiteRecord(record, readinessBody);

  assert.equal(evaluation.computedState, "waived");
  assert.deepEqual(evaluation.failures, []);
  assert.deepEqual([...evaluation.record.unmet].sort(), [...unmet].sort());
});
