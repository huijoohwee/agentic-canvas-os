import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import {
  FINDING_TYPES,
  makeFinding,
  REMEDIATION_CLASSES,
  SEVERITY_RANK,
} from "../scripts/alignment-audit/finding.mjs";

// Feature: guideline-runtime-alignment-audit, Property 12: Finding well-formedness and severity resolution
test("Property 12: every constructed Finding is well formed", () => {
  const arbitrary = fc.record({
    findingType: fc.constantFrom(...FINDING_TYPES),
    severity: fc.constantFrom("blocker", "major", "minor"),
    anchor: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    reference: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    excerpt: fc.string({ minLength: 1, maxLength: 80 }).filter((value) => value.trim()),
    remediationClass: fc.constantFrom(...REMEDIATION_CLASSES),
    statement: fc.string({ minLength: 1, maxLength: 80 }).filter((value) => value.trim()),
  });
  fc.assert(
    fc.property(arbitrary, (seed) => {
      const finding = makeFinding({
        findingType: seed.findingType,
        severity: seed.severity,
        guidelineAnchor: seed.anchor,
        artifactReference: seed.reference,
        evidenceExcerpt: seed.excerpt,
        remediation: {
          class: seed.remediationClass,
          statement: seed.statement,
        },
      });
      assert.equal(FINDING_TYPES.includes(finding.findingType), true);
      assert.equal(finding.severity in SEVERITY_RANK, true);
      assert.ok(finding.guidelineAnchor);
      assert.ok(finding.artifactReference);
      assert.ok(finding.evidenceExcerpt);
      assert.equal(REMEDIATION_CLASSES.includes(finding.remediation.class), true);
      if (
        ["unproven-claim", "unbounded-loop", "deploy-boundary-breach"].includes(
          finding.findingType,
        )
      ) {
        assert.equal(finding.severity, "blocker");
      }
    }),
    { numRuns: 100 },
  );
});
