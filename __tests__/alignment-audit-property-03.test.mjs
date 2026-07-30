import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { parseGuidelineSet } from "../scripts/alignment-audit/guideline-parser.mjs";
import { elementIdFrom, normalizeContent } from "../scripts/alignment-audit/normalize.mjs";
import {
  arbGuidelineDocument,
  expectedGuidelineElements,
} from "./lib/alignment-audit-arbitraries.mjs";

// Feature: guideline-runtime-alignment-audit, Property 3: Guideline extraction fidelity and element classification totality
test("Property 3: guideline extraction preserves kind, anchor, text, identity, and class", () => {
  fc.assert(
    fc.property(arbGuidelineDocument, (generated) => {
      const result = parseGuidelineSet([generated.document], generated.requiredKeys);
      const actual = result.value.elements.map(project).sort(byProjection);
      const expected = expectedGuidelineElements(generated).map(project).sort(byProjection);
      assert.deepEqual(actual, expected);
      for (const element of result.value.elements) {
        assert.equal(
          element.elementId,
          elementIdFrom(element.sectionAnchor, element.text),
        );
        assert.equal(
          ["artifact-bearing", "advisory"].includes(element.class),
          true,
        );
      }
    }),
    { numRuns: 100 },
  );
});

function project(element) {
  return {
    kind: element.kind,
    sectionAnchor: element.sectionAnchor,
    text: normalizeContent(element.text),
    class: element.class,
    elementId: element.elementId,
  };
}

function byProjection(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right), "en");
}
