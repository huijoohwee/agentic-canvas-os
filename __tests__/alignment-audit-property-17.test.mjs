import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { checkTopology } from "../scripts/alignment-audit/topology-checker.mjs";

const CASE_TYPES = Object.freeze({
  lane: "missing-lane",
  transition: "incomplete-lane-transition",
  approval: "ungated-promotion",
  node: "incomplete-topology-node",
  breach: "deploy-boundary-breach",
});

// Feature: guideline-runtime-alignment-audit, Property 17: Topology and lane conformance detection is robust to absent lanes
test("Property 17: topology injections are exact and breach detection survives lane removal", () => {
  fc.assert(fc.property(
    fc.constantFrom(...Object.keys(CASE_TYPES)),
    fc.constantFrom("development", "production-mirror", "edge-delivery"),
    (kind, missingLane) => {
      const doc = {
        documentKey: "topology",
        lanes: ["development", "production-mirror", "edge-delivery"],
        transitions: [{
          id: "dev-to-mirror",
          deployBoundary: "release-gate",
          evidenceReference: "release-proof",
          rollback: "restore prior revision",
          operatorApproval: "explicit operator instruction required",
        }],
        topologyNodes: [{
          id: "component",
          connectionType: "async",
          dataResidency: "local",
        }],
        body: "Topology contract.",
      };
      if (kind === "lane") {
        doc.lanes = doc.lanes.filter((lane) => lane !== missingLane);
      } else if (kind === "transition") {
        delete doc.transitions[0].evidenceReference;
      } else if (kind === "approval") {
        doc.transitions[0].operatorApproval = "not required";
      } else if (kind === "node") {
        delete doc.topologyNodes[0].dataResidency;
      } else {
        doc.body = "Development command deploys and mutates the production surface.";
      }

      const result = checkTopology([doc], {}, null);
      const relevant = result.findings.filter(({ findingType }) =>
        findingType === CASE_TYPES[kind]);
      assert.equal(relevant.length, 1);
      if (kind === "breach") {
        assert.equal(relevant[0].severity, "blocker");
        const stripped = checkTopology([{ ...doc, lanes: [] }], {}, null);
        assert.deepEqual(
          stripped.findings
            .filter(({ findingType }) => findingType === "deploy-boundary-breach")
            .map(({ evidenceExcerpt }) => evidenceExcerpt),
          relevant.map(({ evidenceExcerpt }) => evidenceExcerpt),
        );
      }
      assert.equal(result.deployBoundaryState, "closed");
    },
  ), { numRuns: 100 });
});
