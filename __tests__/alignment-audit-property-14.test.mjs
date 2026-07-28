import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { checkNeutrality } from "../scripts/alignment-audit/neutrality-checker.mjs";

const TYPES = Object.freeze({
  vendor: "vendor-coupling",
  path: "path-derived-claim",
  modular: "non-modular-section",
  scope: "scope-contradiction",
});

// Feature: guideline-runtime-alignment-audit, Property 14: Neutrality rule detection and modularity scope exclusion
test("Property 14: neutrality rules are sound, quoted, and scope-aware", () => {
  fc.assert(fc.property(
    fc.constantFrom(...Object.keys(TYPES)),
    fc.boolean(),
    (kind, nearMiss) => {
      let body = "## Independent\n\nThis section is self-contained.";
      let universal = true;
      const doc = {
        documentKey: "guideline",
        inputRole: "guideline",
        universalScope: true,
      };
      if (kind === "vendor") {
        body = nearMiss
          ? "## Reference Implementation\n\nStripe is a replaceable example.\n\n## Independent\n\nNeutral."
          : "## Independent\n\nThe required runtime is Stripe.";
      } else if (kind === "path") {
        body = nearMiss
          ? "## Paths\n\nA normative status must never be derived from a directory name."
          : "## Paths\n\nA normative status must be derived from a directory name.";
      } else if (kind === "modular") {
        body = "## Module\n\nThis module depends on the previous section.";
        universal = !nearMiss;
      } else {
        body = nearMiss
          ? "## Scope\n\nThis applies to any runtime and repository."
          : "## Scope\n\nThis universal contract only applies to one named runtime.";
      }
      doc.body = body;
      doc.universalScope = universal;
      const result = checkNeutrality([doc], universal ? new Set(["guideline"]) : new Set());
      const relevant = result.findings.filter(({ findingType }) => findingType === TYPES[kind]);

      assert.equal(relevant.length, nearMiss ? 0 : 1);
      if (kind === "path" && !nearMiss) {
        assert.match(relevant[0].evidenceExcerpt, /derived from a directory name/u);
      }
      assert.equal(
        Object.values(result.vendorCouplingCountByRole).reduce((sum, value) => sum + value, 0),
        result.findings.filter(({ findingType }) => findingType === "vendor-coupling").length,
      );
    },
  ), { numRuns: 100 });
});
