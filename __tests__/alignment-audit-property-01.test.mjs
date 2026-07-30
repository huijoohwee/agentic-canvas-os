import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { guidelineModelsEqual } from "../scripts/alignment-audit/guideline-model.mjs";
import { parseGuidelineDigest } from "../scripts/alignment-audit/guideline-parser.mjs";
import { printGuidelineModel } from "../scripts/alignment-audit/guideline-printer.mjs";
import { arbGuidelineModel } from "./lib/alignment-audit-arbitraries.mjs";

// Feature: guideline-runtime-alignment-audit, Property 1: Guideline_Model round trip
test("Property 1: printed Guideline_Model parses to an equal model", () => {
  fc.assert(
    fc.property(arbGuidelineModel, (model) => {
      const parsed = parseGuidelineDigest(printGuidelineModel(model));
      assert.equal(parsed.errors, undefined);
      assert.equal(guidelineModelsEqual(parsed, model), true);
    }),
    { numRuns: 100 },
  );
});
