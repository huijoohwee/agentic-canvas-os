import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { evaluateReadiness } from "../scripts/alignment-audit/readiness-evaluator.mjs";
import {
  isEvidenceClosed,
  mapTraceability,
} from "../scripts/alignment-audit/traceability-mapper.mjs";

const LADDER = [
  "undocumented",
  "spec-complete",
  "dev-proven",
  "runtime-ready",
  "production-verified",
  "off-ladder",
];

// Feature: guideline-runtime-alignment-audit, Property 6: Runtime-ready claims are proven or blocker-flagged
test("Property 6: runtime-ready claims require nonempty evidence closure", () => {
  fc.assert(fc.property(
    fc.constantFrom(...LADDER),
    fc.array(fc.boolean(), { maxLength: 5 }),
    (declaredStatus, coverage) => {
      const conditions = coverage.map((_, index) => ({
        conditionId: `condition-${index}`,
        endState: `End state ${index}`,
        statedCheck: `check-${index}`,
        constraint: "configured scope",
      }));
      const evidence = coverage.flatMap((covered, index) => covered ? [{
        conditionId: `condition-${index}`,
        checkName: `check-${index}`,
        recordedResult: "passed",
        reproducible: "local",
      }] : []);
      const entry = {
        entryId: "runtime-entry",
        documentKey: "runtime-document",
        capabilityId: "capability",
        elementIds: ["guideline-element"],
        declaredStatus,
        excerpt: "proofartifact",
        conditions,
        evidence,
      };
      const mapped = mapTraceability({
        elements: [{
          elementId: "guideline-element",
          sectionAnchor: "proof",
          class: "artifact-bearing",
          text: "Require proofartifact",
        }],
      }, { entries: [entry] });
      const assignment = evaluateReadiness(mapped.chains, null).assignments[0];
      const closed = isEvidenceClosed(conditions, evidence);
      const unproven = mapped.findings.filter(({ findingType }) =>
        findingType === "unproven-claim");

      assert.equal(assignment.assignedLevel === "runtime-ready", closed);
      assert.equal(
        unproven.length,
        declaredStatus === "runtime-ready" && !closed ? 1 : 0,
      );
      for (const finding of unproven) assert.equal(finding.severity, "blocker");
    },
  ), { numRuns: 100 });
});
