import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { artifactIndexesEqual } from "../scripts/alignment-audit/artifact-index.mjs";
import { parseArtifactIndexMarkdown } from "../scripts/alignment-audit/artifact-indexer.mjs";
import { printArtifactIndex } from "../scripts/alignment-audit/artifact-printer.mjs";
import { arbArtifactIndex } from "./lib/alignment-audit-arbitraries.mjs";

// Feature: guideline-runtime-alignment-audit, Property 2: Artifact_Index round trip
test("Property 2: printed Artifact_Index parses to an equal index", () => {
  fc.assert(
    fc.property(arbArtifactIndex, (index) => {
      const parsed = parseArtifactIndexMarkdown(printArtifactIndex(index));
      assert.equal(parsed.errors, undefined);
      assert.equal(artifactIndexesEqual(parsed, index), true);
    }),
    { numRuns: 100 },
  );
});
