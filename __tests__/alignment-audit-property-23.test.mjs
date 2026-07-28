import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { makeFinding } from "../scripts/alignment-audit/finding.mjs";
import {
  assertFindingCountBound,
  finalizeFindings,
} from "../scripts/alignment-audit/finding-pipeline.mjs";
import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createInMemorySourceReader } from "../scripts/alignment-audit/source-reader.mjs";

const TYPES = [
  "missing-frontmatter-key",
  "unknown-status",
  "missing-companion",
  "missing-economics-metric",
  "ambiguous-route",
  "deploy-boundary-breach",
];

// Feature: guideline-runtime-alignment-audit, Property 23: Finding count is bounded by model size
test("Property 23: deterministic reduction checks and reports the model-size bound", async () => {
  fc.assert(
    fc.property(
      fc.record({
        normativeElementCount: fc.integer({ min: 0, max: 12 }),
        artifactEntryCount: fc.integer({ min: 0, max: 12 }),
      }).chain((model) =>
        fc.integer({
          min: 0,
          max: model.normativeElementCount + model.artifactEntryCount,
        }).map((findingCount) => ({ ...model, findingCount }))),
      ({ normativeElementCount, artifactEntryCount, findingCount }) => {
        const raw = Array.from({ length: findingCount }, (_, index) => {
          const findingType = TYPES[index % TYPES.length];
        const finding = makeFinding({
          findingType,
            guidelineAnchor: `anchor-${index}`,
            artifactReference: `artifact-${index}`,
            evidenceExcerpt: `evidence-${index}`,
          remediation: {
            class: "documentation-change",
            statement: "Record the missing contract evidence.",
            state: "proposed",
            operatorInstructionRef: null,
          },
        });
        return [finding, finding, { ...finding, evidenceExcerpt: `${finding.evidenceExcerpt}-z` }];
        }).flat();
        const reduced = finalizeFindings(raw);
        assert.equal(reduced.length, findingCount);
        assert.equal(
          assertFindingCountBound(reduced, normativeElementCount, artifactEntryCount),
          true,
        );
        assert.deepEqual(finalizeFindings([...raw].reverse()), reduced);
        assert.throws(
          () => assertFindingCountBound(
            Array.from({ length: normativeElementCount + artifactEntryCount + 1 }),
            normativeElementCount,
            artifactEntryCount,
          ),
          /Finding count post-condition failed/u,
        );
      },
    ),
    { numRuns: 100 },
  );
  const runtimeDocument = {
    readHandle: "adversarial-runtime",
    subject: "adversarial-runtime",
    auditSurface: "runtime",
    inputRole: "runtime",
    content: [
      "---",
      "title: Adversarial Runtime",
      "doc_type: Runtime Contract",
      "status: dev-proven",
      "capability_id: adversarial-runtime",
      "feature_bearing: true",
      "user_facing: true",
      "ai_pipeline: true",
      "---",
      "A deliberately incomplete runtime contract.",
      "",
    ].join("\n"),
  };
  const run = await runAudit(
    resolvedConfig(),
    createInMemorySourceReader([runtimeDocument]),
    createInMemoryWriteSink(),
  );
  assert.equal(run.findingBound, 2);
  assert.equal(run.findingBoundSatisfied, false);
  assert.match(run.report, /\| finding bound \| 2 \|/u);
  assert.match(run.report, /\| finding bound satisfied \| no \|/u);
});

function resolvedConfig() {
  return {
    resolved: true,
    guidelineRoots: [{
      locator: "/virtual/guideline",
      roleLabel: "guideline",
      revisionIdentifier: "guideline-r1",
    }],
    runtimeRoots: [{
      locator: "/virtual/runtime",
      roleLabel: "runtime",
      revisionIdentifier: "runtime-r1",
    }],
    auditOutputDirectory: "/virtual/output",
    operatorDeployInstruction: null,
    readinessLadder: [
      "undocumented",
      "spec-complete",
      "dev-proven",
      "runtime-ready",
      "production-verified",
    ],
    requiredFrontmatterKeys: ["title", "doc_type"],
    economicsStatements: [
      "return-on-investment",
      "12-month-total-cost-of-ownership",
      "token-budget",
      "time-to-value",
    ],
  };
}
