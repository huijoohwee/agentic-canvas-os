import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { evaluateGates } from "../scripts/alignment-audit/gate-evaluator.mjs";

// Feature: guideline-runtime-alignment-audit, Property 7: Pipeline_Gate totality and evidence-soundness of met
test("Property 7: declared gate order and evidence boundary are preserved", () => {
  assert.deepEqual(evaluateGates({}, {}, []).gates, []);

  fc.assert(fc.property(
    gateLabelsArbitrary(),
    fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 12 }),
    fc.array(fc.boolean(), { minLength: 1, maxLength: 36 }),
    (gateIds, elementCounts, evidenceBits) => {
      const gates = gateIds.map((gateId, index) => ({
        gateId,
        order: index,
        entryCondition: `entry-${gateId}`,
        exitCondition: `exit-${gateId}`,
        requiredEvidenceType: `evidence-${gateId}`,
      }));
      const elements = [];
      const links = [];
      let bit = 0;
      for (const [gateIndex, gateId] of gateIds.entries()) {
        const count = elementCounts[gateIndex % elementCounts.length];
        for (let offset = 0; offset < count; offset += 1) {
          const elementId = `${gateId}-element-${offset}`;
          elements.push({ elementId, gateId, text: elementId });
          const evidenced = evidenceBits[bit % evidenceBits.length];
          bit += 1;
          links.push({
            elementId,
            artifactReference: `${gateId}-entry-${offset}`,
            evidenceReference: evidenced ? validEvidence(elementId) : null,
          });
        }
      }

      const result = evaluateGates(
        { gates, elements },
        {},
        [{ capabilityId: "capability", links }],
      );
      assert.deepEqual(result.gates.map(({ gateId }) => gateId), gateIds);
      assert.equal(result.gates.length, gates.length);
      for (const [index, gate] of result.gates.entries()) {
        assert.equal(gate.entryCondition, gates[index].entryCondition);
        assert.equal(gate.exitCondition, gates[index].exitCondition);
        assert.equal(gate.requiredEvidenceType, gates[index].requiredEvidenceType);
        assert.equal(["unmet", "partially-met", "met"].includes(gate.state), true);
        const mapped = new Set(gate.mappedElements);
        const fullyEvidenced = [...mapped].every((elementId) =>
          links.some((link) =>
            link.elementId === elementId && link.evidenceReference !== null));
        assert.equal(gate.state === "met", mapped.size > 0 && fullyEvidenced);
      }

      const met = result.gates.find(({ state }) => state === "met");
      if (met) {
        const removed = structuredClone(links);
        const target = removed.find(({ elementId }) => elementId === met.mappedElements[0]);
        target.evidenceReference = null;
        const reevaluated = evaluateGates(
          { gates, elements },
          {},
          [{ capabilityId: "capability", links: removed }],
        );
        assert.notEqual(
          reevaluated.gates.find(({ gateId }) => gateId === met.gateId).state,
          "met",
        );
      }
    },
  ), { numRuns: 100 });
});

function gateLabelsArbitrary() {
  return fc.uniqueArray(
    fc.integer({ min: 0, max: 1_000_000 }),
    { minLength: 1, maxLength: 12 },
  ).map((values) => values.map((value) => `stage-${value}`));
}

function validEvidence(elementId) {
  return {
    checkName: `check-${elementId}`,
    recordedResult: "passed",
    reproducible: "local",
  };
}
