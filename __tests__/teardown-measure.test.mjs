import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineReductionPercentage,
  externalStateMoveDecision,
  finalEvidenceBreaches,
  reductionPercentage,
  renderReport,
  thresholdBreaches,
} from "../scripts/teardown-measure.mjs";

test("threshold reporting emits one row per breach", () => {
  const measured = new Map([["scripts/.files", 16], ["scripts/.lines", 3001], ["combinedLifecycleLines", 32597]]);
  assert.deepEqual(thresholdBreaches(measured).map(item => item.threshold), ["scripts/.files", "scripts/.lines"]);
});

test("report embeds the machine-readable JSON artifact", () => {
  const report = { status: "in-progress", surfaces: [{ surface: "scripts/", baselineFiles: 1, baselineLines: 2, currentFiles: 1, currentLines: 2 }] };
  const markdown = renderReport(report);
  assert.match(markdown, /```json/u);
  assert.match(markdown, /"status": "in-progress"/u);
});

test("final evidence cannot treat an empty inventory as complete", () => {
  const breaches = finalEvidenceBreaches({
    classificationTotals: { redundant: 0, constrained: 0, dead: 0, retained: 0, total: 0 },
    constrainedWithoutReducedForm: 0,
    servedRoutes: Array.from({ length: 17 }, (_, index) => `route-${index}`),
    archive: { tagName: "archive", bundlePath: "archive.bundle",
      manifestPath: "removals.jsonl", manifestEntryCount: 1 },
  });
  assert.equal(breaches.some(item => item.threshold === "classificationTotals"), true);
});

test("a non-zero state move retains the source and stops teardown", () => {
  assert.deepEqual(externalStateMoveDecision(1), {
    removable: false, stop: true, retentionReason: "state move exited 1",
  });
  assert.deepEqual(externalStateMoveDecision(0), { removable: true, stop: false });
});

test("baseline drift reports signed growth without weakening reduction arithmetic", () => {
  assert.equal(baselineReductionPercentage(100, 125), -25);
  assert.throws(() => reductionPercentage(100, 125), /Reduction counts are invalid/u);
});
