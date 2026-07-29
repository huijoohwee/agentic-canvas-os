import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { mapTraceability } from "../scripts/alignment-audit/traceability-mapper.mjs";

// Feature: guideline-runtime-alignment-audit, Property 5: Traceability closure and count arithmetic
test("Property 5: traceability closure partitions elements and entries", () => {
  fc.assert(fc.property(
    fc.array(fc.boolean(), { maxLength: 8 }),
    fc.array(fc.boolean(), { maxLength: 6 }),
    fc.integer({ min: 0, max: 4 }),
    (artifactLinks, advisoryLinks, orphanCount) => {
      const elements = [];
      const entries = [];
      for (const [index, linked] of artifactLinks.entries()) {
        const token = `artifacttoken${index}`;
        elements.push({
          elementId: `artifact-${index}`,
          sectionAnchor: "requirements",
          class: "artifact-bearing",
          text: `Require ${token}`,
        });
        if (linked) {
          entries.push({
            entryId: `entry-artifact-${index}`,
            documentKey: `runtime-${index}`,
            capabilityId: `capability-${index}`,
            elementIds: [`artifact-${index}`],
            excerpt: `Provides ${token}`,
          });
        }
      }
      for (const [index, linked] of advisoryLinks.entries()) {
        const token = `advisorytoken${index}`;
        elements.push({
          elementId: `advisory-${index}`,
          sectionAnchor: "guidance",
          class: "advisory",
          text: `Prefer ${token}`,
        });
        if (linked) {
          entries.push({
            entryId: `entry-advisory-${index}`,
            documentKey: `advisory-runtime-${index}`,
            capabilityId: `advisory-capability-${index}`,
            elementIds: [`advisory-${index}`],
            excerpt: `Mentions ${token}`,
          });
        }
      }
      for (let index = 0; index < orphanCount; index += 1) {
        entries.push({
          entryId: `orphan-${index}`,
          documentKey: `orphan-document-${index}`,
          capabilityId: `orphan-capability-${index}`,
          excerpt: `orphancontent${index}`,
        });
      }

      const result = mapTraceability(
        { elements },
        {
          entries,
          unresolvableReferences: orphanCount > 0
            ? [{ artifactReference: "proof-owner", reference: "missing/proof.md" }]
            : [],
        },
      );
      const linkedIds = new Set(result.links.map(({ elementId }) => elementId));
      const unimplemented = result.findings
        .filter(({ findingType }) => findingType === "unimplemented-guideline");
      const unguided = result.findings
        .filter(({ findingType }) => findingType === "unguided-artifact");

      for (const element of elements.filter(({ class: value }) => value === "artifact-bearing")) {
        assert.equal(
          Number(linkedIds.has(element.elementId)) +
            unimplemented.filter(({ guidelineAnchor }) => guidelineAnchor === element.elementId).length,
          1,
        );
      }
      for (const element of elements.filter(({ class: value }) => value === "advisory")) {
        assert.equal(unimplemented.some(({ guidelineAnchor }) =>
          guidelineAnchor === element.elementId), false);
      }
      for (const entry of entries) {
        const linked = result.links.some(({ artifactReference }) =>
          artifactReference === entry.entryId);
        assert.equal(
          Number(linked) +
            unguided.filter(({ artifactReference }) => artifactReference === entry.entryId).length,
          1,
        );
      }
      for (const link of result.links) {
        assert.ok(link.elementId);
        assert.ok(link.artifactReference);
        assert.equal(Object.hasOwn(link, "evidenceReference"), true);
      }
      const linkedArtifactCount = elements
        .filter(({ class: value, elementId }) =>
          value === "artifact-bearing" && linkedIds.has(elementId)).length;
      assert.equal(result.coverage.artifactBearingTotal, artifactLinks.length);
      assert.equal(result.coverage.artifactBearingLinked, linkedArtifactCount);
      assert.equal(
        result.coverage.linkedRatio,
        artifactLinks.length === 0 ? 1 : linkedArtifactCount / artifactLinks.length,
      );
      assert.equal(
        result.findings.filter(({ findingType }) => findingType === "unresolvable-reference").length,
        orphanCount > 0 ? 1 : 0,
      );
    },
  ), { numRuns: 100 });
});
