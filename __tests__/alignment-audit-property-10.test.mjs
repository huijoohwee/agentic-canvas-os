import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import {
  evaluateReadiness,
  readinessRank,
} from "../scripts/alignment-audit/readiness-evaluator.mjs";

// Feature: guideline-runtime-alignment-audit, Property 10: Evidence addition never lowers a Readiness_Level
test("Property 10: retained evidence supersets are monotone", () => {
  const evidenceArbitrary = fc.record({
    conditionId: fc.option(fc.integer({ min: 0, max: 3 }).map((index) => `condition-${index}`), {
      nil: null,
    }),
    checkName: fc.string({ minLength: 1, maxLength: 10 }),
    recordedResult: fc.option(fc.constant("passed"), { nil: "" }),
    reproducible: fc.constantFrom("local", "production", "unproven"),
  });
  fc.assert(fc.property(
    fc.array(evidenceArbitrary, { maxLength: 8 }),
    fc.array(evidenceArbitrary, { minLength: 1, maxLength: 4 }),
    (base, addition) => {
      const conditions = Array.from({ length: 4 }, (_, index) => ({
        conditionId: `condition-${index}`,
        endState: `end-${index}`,
        statedCheck: `check-${index}`,
        constraint: "scope",
      }));
      const before = evaluateReadiness([{
        capabilityId: "capability",
        entryIds: ["entry"],
        conditions,
        evidence: base,
      }], null).assignments[0];
      const after = evaluateReadiness([{
        capabilityId: "capability",
        entryIds: ["entry"],
        conditions,
        evidence: [...base, ...addition],
      }], null).assignments[0];
      assert.ok(readinessRank(after.assignedLevel) >= readinessRank(before.assignedLevel));
    },
  ), { numRuns: 100 });
});
