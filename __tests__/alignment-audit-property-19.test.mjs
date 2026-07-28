import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { artifactIndexesEqual } from "../scripts/alignment-audit/artifact-index.mjs";
import { buildArtifactIndex } from "../scripts/alignment-audit/artifact-indexer.mjs";
import {
  arbDocumentSet,
  READINESS_LADDER,
} from "./lib/alignment-audit-arbitraries.mjs";

// Feature: guideline-runtime-alignment-audit, Property 19: Path agnosticity under container and file renaming
test("Property 19: relocation leaves index attributes and Findings unchanged", () => {
  fc.assert(
    fc.property(arbDocumentSet, (set) => {
      const original = buildArtifactIndex(set.documents, READINESS_LADDER);
      const relocated = buildArtifactIndex(set.relocatedDocuments, READINESS_LADDER);
      assert.equal(artifactIndexesEqual(original, relocated), true);
      assert.deepEqual(original.findings, relocated.findings);
    }),
    { numRuns: 100 },
  );
});
