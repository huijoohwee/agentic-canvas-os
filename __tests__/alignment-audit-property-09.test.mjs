import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import {
  evaluateReadiness,
  READINESS_LADDER,
  readinessRank,
} from "../scripts/alignment-audit/readiness-evaluator.mjs";
import { isSuccessfulRecordedResult } from "../scripts/alignment-audit/evidence-result.mjs";

// Feature: guideline-runtime-alignment-audit, Property 9: Readiness totality and evidence bounds
test("Property 9: readiness is total and obeys evidence bounds", () => {
  const evidenceArbitrary = fc.record({
    checkName: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: "" }),
    recordedResult: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: "" }),
    reproducible: fc.constantFrom("local", "production", "unproven"),
  });
  fc.assert(fc.property(
    fc.boolean(),
    fc.array(evidenceArbitrary, { maxLength: 10 }),
    (documented, evidence) => {
      const chain = {
        capabilityId: "capability",
        entryIds: documented ? ["entry"] : [],
        links: [],
        conditions: [],
        evidence,
      };
      const assignment = evaluateReadiness([chain], null).assignments[0];
      assert.equal(READINESS_LADDER.includes(assignment.assignedLevel), true);
      assert.equal(typeof assignment.localReadiness, "string");
      assert.equal(typeof assignment.deployedReadiness, "string");

      if (evidence.length === 0) {
        assert.ok(readinessRank(assignment.assignedLevel) <= readinessRank("spec-complete"));
      }
      if (evidence.some((item) =>
        item.reproducible === "local" &&
        item.checkName.trim() &&
        isSuccessfulRecordedResult(item))) {
        assert.ok(readinessRank(assignment.assignedLevel) >= readinessRank("dev-proven"));
      }
    },
  ), { numRuns: 100 });
});
