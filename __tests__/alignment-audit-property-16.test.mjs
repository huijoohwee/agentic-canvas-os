import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { checkInvocation } from "../scripts/alignment-audit/invocation-checker.mjs";

// Feature: guideline-runtime-alignment-audit, Property 16: Invocation route resolution partitions the route set
test("Property 16: route ownership and tool membership form exact partitions", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 10 }),
    fc.boolean(),
    fc.boolean(),
    (ownerCounts, federated, catalogued) => {
      const entries = [];
      for (const [routeIndex, ownerCount] of ownerCounts.entries()) {
        const ownerLabel = `owner-label-${routeIndex}`;
        const route = {
          surface: ["slash", "hash", "at"][routeIndex % 3],
          token: [`/route.${routeIndex}`, `#route-${routeIndex}`, `@route-${routeIndex}`][routeIndex % 3],
          owner: ownerLabel,
        };
        entries.push({
          entryId: `route-${routeIndex}-catalogue`,
          documentKey: `route-${routeIndex}-catalogue`,
          invocationRoutes: [route],
          toolIdentities: [],
        });
        if (ownerCount > 0) {
          for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
            entries.push({
              entryId: `route-${routeIndex}-owner-${ownerIndex}`,
              documentKey: `route-${routeIndex}-owner-${ownerIndex}`,
              declaredOwner: ownerLabel,
              invocationRoutes: [],
              toolIdentities: [],
            });
          }
        }
      }
      if (federated) {
        entries.push({
          entryId: "federation",
          documentKey: "tool-federation-contract",
          contractRole: "federation",
          invocationRoutes: [],
          toolIdentities: ["audit.tool"],
        });
      }
      if (catalogued) {
        entries.push({
          entryId: "catalog",
          documentKey: "capability-catalog",
          contractRole: "catalog",
          invocationRoutes: [],
          toolIdentities: ["audit.tool"],
        });
      }
      const result = checkInvocation({
        entries,
        documentedToolIdentities: ["audit.tool"],
      });
      const expectedResolved = ownerCounts.filter((count) => count === 1).length;
      const expectedOrphan = ownerCounts.filter((count) => count === 0).length;
      const expectedAmbiguous = ownerCounts.filter((count) => count >= 2).length;
      assert.deepEqual(result.routeCounts, {
        documented: ownerCounts.length,
        resolved: expectedResolved,
        orphan: expectedOrphan,
        ambiguous: expectedAmbiguous,
      });
      assert.equal(
        result.routeCounts.documented,
        result.routeCounts.resolved + result.routeCounts.orphan + result.routeCounts.ambiguous,
      );
      assert.equal(
        result.findings.filter(({ findingType }) => findingType === "unfederated-tool").length,
        federated ? 0 : 1,
      );
      assert.equal(
        result.findings.filter(({ findingType }) => findingType === "uncatalogued-tool").length,
        catalogued ? 0 : 1,
      );
    },
  ), { numRuns: 100 });
});
