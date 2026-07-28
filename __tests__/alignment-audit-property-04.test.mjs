import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { ABSENT } from "../scripts/alignment-audit/artifact-index.mjs";
import { buildArtifactIndex } from "../scripts/alignment-audit/artifact-indexer.mjs";
import {
  arbRuntimeDocument,
  READINESS_LADDER,
} from "./lib/alignment-audit-arbitraries.mjs";

// Feature: guideline-runtime-alignment-audit, Property 4: Artifact index fidelity to declared content
test("Property 4: index entries preserve every declared field and command", () => {
  fc.assert(
    fc.property(arbRuntimeDocument, (generated) => {
      const result = buildArtifactIndex([generated.document], READINESS_LADDER);
      assert.equal(
        result.value.entries.filter((entry) => entry.entryKind === "markdown-document").length,
        1,
      );
      for (const seed of generated.seeds) {
        const entry = result.value.entries.find((candidate) => {
          if (candidate.entryKind !== seed.entryKind) return false;
          if (candidate.capabilityId !== seed.capabilityId) return false;
          if (seed.entryKind === "readiness-status") {
            return candidate.declaredStatus === seed.status;
          }
          if (seed.entryKind === "validation-command") {
            return candidate.commandText === seed.commandText;
          }
          return candidate.excerpt.includes(seed.schema);
        });
        assert.ok(entry, `missing ${seed.entryKind} entry for ${seed.capabilityId}`);
        assert.equal(entry.declaredRuntimeScope, seed.declaredRuntimeScope);
        assert.equal(entry.declaredOwner, seed.declaredOwner);
        assert.equal(entry.declaredProofReference, seed.declaredProofReference);
        if (seed.entryKind !== "validation-command") {
          assert.equal(entry.commandText, ABSENT);
        }
      }

      const expectedUnknown = generated.seeds
        .filter(
          (seed) =>
            seed.entryKind === "readiness-status" &&
            !READINESS_LADDER.includes(seed.status),
        )
        .map((seed) => seed.status)
        .sort();
      const actualUnknown = result.findings
        .filter((finding) => finding.findingType === "unknown-status")
        .map((finding) => finding.evidenceExcerpt.replace("Unknown declared status: ", ""))
        .sort();
      assert.deepEqual(actualUnknown, expectedUnknown);
    }),
    { numRuns: 100 },
  );
});
