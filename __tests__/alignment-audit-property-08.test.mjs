import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { evaluateGates } from "../scripts/alignment-audit/gate-evaluator.mjs";

// Feature: guideline-runtime-alignment-audit, Property 8: Gate order drift and sequence violation detection
test("Property 8: gate ordering and sequence divergence are detected exactly", () => {
  fc.assert(fc.property(
    gateCaseArbitrary(),
    ({ gateIds, states, permutation }) => {
      const gates = gateIds.map((gateId, index) => ({
        gateId,
        order: index,
        entryCondition: `entry ${index}`,
        exitCondition: `exit ${index}`,
        requiredEvidenceType: `proof ${index}`,
      }));
      const elements = [];
      const links = [];
      for (const [index, state] of states.entries()) {
        const count = state === "partially-met" ? 2 : 1;
        for (let offset = 0; offset < count; offset += 1) {
          const elementId = `element-${index}-${offset}`;
          elements.push({ elementId, gateId: gateIds[index], text: elementId });
          const evidenced = state === "met" ||
            (state === "partially-met" && offset === 0);
          links.push({
            elementId,
            artifactReference: `entry-${index}-${offset}`,
            evidenceReference: evidenced
              ? { checkName: "check", recordedResult: "passed", reproducible: "local" }
              : null,
          });
        }
      }
      const documented = permute(gateIds, permutation);
      const result = evaluateGates(
        { gates, elements },
        { stageOrder: documented },
        [{ capabilityId: "capability", links }],
      );
      const types = result.findings.map(({ findingType }) => findingType);
      const expectedDrift = documented.some((value, index) => value !== gateIds[index]);
      const expectedViolation = states.some((state, later) =>
        state === "met" && states.slice(0, later).includes("unmet"));

      assert.deepEqual(result.gates.map(({ gateId }) => gateId), gateIds);
      assert.equal(types.includes("gate-order-drift"), expectedDrift);
      assert.equal(types.includes("gate-sequence-violation"), expectedViolation);
      const drift = result.findings.find(({ findingType }) =>
        findingType === "gate-order-drift");
      if (drift) {
        assert.match(drift.evidenceExcerpt, /Guideline order:/u);
        assert.match(drift.evidenceExcerpt, /runtime order:/u);
      }
    },
  ), { numRuns: 100 });
});

function gateCaseArbitrary() {
  return fc.uniqueArray(
    fc.integer({ min: 0, max: 1_000_000 }),
    { minLength: 1, maxLength: 12 },
  ).chain((seeds) => fc.record({
    gateIds: fc.constant(seeds.map((seed) => `stage-${seed}`)),
    states: fc.array(
      fc.constantFrom("unmet", "partially-met", "met"),
      { minLength: seeds.length, maxLength: seeds.length },
    ),
    permutation: fc.constantFrom("identity", "adjacent", "rotate", "reverse"),
  }));
}

function permute(values, kind) {
  if (kind === "identity" || values.length < 2) return [...values];
  if (kind === "adjacent") {
    const result = [...values];
    [result[0], result[1]] = [result[1], result[0]];
    return result;
  }
  if (kind === "rotate") return [...values.slice(1), values[0]];
  return [...values].reverse();
}
