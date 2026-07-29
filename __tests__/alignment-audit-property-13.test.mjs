import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { detectDrift } from "../scripts/alignment-audit/drift-detector.mjs";

const CASES = Object.freeze({
  status: "status-conflict",
  stale: "stale-evidence",
  owner: "duplicate-owner",
  blended: "blended-status",
  companion: "missing-companion",
});

// Feature: guideline-runtime-alignment-audit, Property 13: Drift condition detection is sound and complete
test("Property 13: drift injections and near misses are distinguished exactly", () => {
  fc.assert(fc.property(
    fc.constantFrom(...Object.keys(CASES)),
    fc.boolean(),
    (kind, nearMiss) => {
      const entries = [];
      const chains = [];
      if (kind === "status") {
        entries.push(
          baseEntry("first", { declaredStatus: "dev-proven" }),
          baseEntry("second", {
            declaredStatus: nearMiss ? "dev-proven" : "runtime-ready",
          }),
        );
      } else if (kind === "stale") {
        const command = "node --test focused.test.mjs";
        entries.push(baseEntry("owner"), {
          ...baseEntry("command"),
          capabilityId: "command-capability",
          entryKind: "validation-command",
          commandText: nearMiss ? command : "node --test other.test.mjs",
        });
        chains.push({
          capabilityId: "capability",
          links: [{ elementId: "element" }],
          evidence: [{
            kind: "validation-command",
            checkName: command,
            recordedResult: "passed",
          }],
        });
      } else if (kind === "owner") {
        entries.push(baseEntry("first", { declaredOwner: "owner-a" }));
        if (!nearMiss) entries.push(baseEntry("second", { declaredOwner: "owner-b" }));
      } else if (kind === "blended") {
        entries.push(baseEntry("owner", {
          declaredStatus: nearMiss
            ? "runtime-ready"
            : "runtime-ready; production deployment verified",
        }));
      } else {
        entries.push(baseEntry("owner", { requiredCompanions: ["proof.md#recorded-check"] }));
        if (nearMiss) {
          entries.push({
            ...baseEntry("companion"),
            capabilityId: "other-capability",
            documentKey: "proof-0123456789ab",
          });
        } else {
          entries.push({
            ...baseEntry("near-companion"),
            capabilityId: "other-capability",
            documentKey: "proofing-0123456789ab",
          });
        }
      }

      const findings = detectDrift({}, { entries }, chains, [], []);
      const relevant = findings.filter(({ findingType }) => findingType === CASES[kind]);
      assert.equal(relevant.length, nearMiss ? 0 : 1);
      if (relevant.length > 0) {
        assert.ok(relevant[0].artifactReference);
        assert.ok(relevant[0].evidenceExcerpt);
      }
    },
  ), { numRuns: 100 });
});

function baseEntry(name, overrides = {}) {
  return {
    entryId: `entry-${name}`,
    documentKey: `document-${name}`,
    capabilityId: "capability",
    declaredStatus: undefined,
    declaredOwner: undefined,
    excerpt: "clean content",
    ...overrides,
  };
}
