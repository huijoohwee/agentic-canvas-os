import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import {
  makeFinding,
  SEVERITY_RANK,
} from "../scripts/alignment-audit/finding.mjs";
import { scanFrontmatter } from "../scripts/alignment-audit/frontmatter.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { writeReport } from "../scripts/alignment-audit/report-writer.mjs";

const HOSTILE_SCALARS = [
  "value: with colon",
  "value # with hash",
  "single ' quote",
  'double " quote',
  "[brackets]",
  "{braces}",
  "> leading marker",
  "- leading dash",
  "trailing whitespace ",
];
const LEVELS = [
  "undocumented",
  "spec-complete",
  "dev-proven",
  "runtime-ready",
  "production-verified",
];
const FINDING_TYPES = [
  "unknown-status",
  "missing-companion",
  "orphan-route",
  "malformed-document",
];

// Feature: guideline-runtime-alignment-audit, Property 25: Audit_Report structural completeness, ordering, and frontmatter round trip
test("Property 25: emitted reports are structurally complete, ordered, and frontmatter-safe", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        title: fc.constantFrom(...HOSTILE_SCALARS),
        docType: fc.constantFrom(...HOSTILE_SCALARS),
        lang: fc.constantFrom("en-US", ...HOSTILE_SCALARS),
        patch: fc.integer({ min: 0, max: 200 }),
        day: fc.integer({ min: 1, max: 28 }),
        findingMode: fc.constantFrom("zero", "single-severity", "ties", "mixed"),
        findingCount: fc.integer({ min: 0, max: 8 }),
        severity: fc.constantFrom("blocker", "major", "minor"),
        guidelineVendorCount: fc.integer({ min: 0, max: 3 }),
        runtimeVendorCount: fc.integer({ min: 0, max: 3 }),
        capabilityCount: fc.integer({ min: 0, max: 6 }),
        gateCount: fc.integer({ min: 0, max: 4 }),
        auditedDocuments: fc.integer({ min: 0, max: 20 }),
        normativeElements: fc.integer({ min: 0, max: 30 }),
        artifactEntries: fc.integer({ min: 0, max: 30 }),
        elapsedMs: fc.integer({ min: 0, max: 100_000 }),
      }),
      async (seed) => {
        const version = `1.0.${seed.patch}`;
        const date = `2026-07-${String(seed.day).padStart(2, "0")}`;
        const vendorCounts = seed.findingMode === "zero"
          ? { guideline: 0, runtime: 0 }
          : {
              guideline: seed.guidelineVendorCount,
              runtime: seed.runtimeVendorCount,
            };
        const findings = findingsFrom(seed, vendorCounts);
        const assignments = assignmentsFrom(seed.capabilityCount);
        const gates = gatesFrom(seed.gateCount);
        const run = {
          findings,
          readiness: { assignments },
          gates: { gates },
          coverage: {
            artifactBearingTotal: seed.normativeElements,
            artifactBearingLinked: Math.min(
              seed.normativeElements,
              seed.artifactEntries,
            ),
            linkedRatio: seed.normativeElements === 0 ? 1 : 0.5,
          },
          routeCounts: { documented: 2, resolved: 1, orphan: 1, ambiguous: 0 },
          vendorCouplingCountByRole: vendorCounts,
          inputRevisions: [
            {
              surface: "guideline",
              roleLabel: "guideline",
              revisionIdentifier: "guideline-revision",
            },
            {
              surface: "runtime",
              roleLabel: "runtime",
              revisionIdentifier: "runtime-revision",
            },
          ],
          counts: {
            auditedDocuments: seed.auditedDocuments,
            normativeElements: seed.normativeElements,
            artifactEntries: seed.artifactEntries,
            findings: findings.length,
          },
          findingBound: seed.normativeElements + seed.artifactEntries,
          findingBoundSatisfied:
            findings.length <= seed.normativeElements + seed.artifactEntries,
          elapsedMs: seed.elapsedMs,
          baselineVerified: true,
          modifiedOutsideOutputCount: 0,
          deployBoundaryState: "closed",
          guidelineDigest: "# Guideline Digest\n",
          artifactIndexMarkdown: "# Artifact Index\n",
        };
        const sink = createInMemoryWriteSink();
        const written = await writeReport(run, sink, {
          startVersion: version,
          title: seed.title,
          docType: seed.docType,
          date,
          lang: seed.lang,
        });
        const report = written.reportText;
        const parsed = scanFrontmatter(report);

        assert.equal(parsed.readState, "ok");
        assert.equal(parsed.frontmatter.get("title"), seed.title);
        assert.equal(parsed.frontmatter.get("doc_type"), seed.docType);
        assert.equal(parsed.frontmatter.get("version"), version);
        assert.equal(parsed.frontmatter.get("date"), date);
        assert.equal(parsed.frontmatter.get("lang"), seed.lang);
        for (const heading of [
          "## Alignment Summary",
          "## Readiness Gap Matrix",
          "## Findings",
          "## Pipeline Gate States",
        ]) {
          assert.ok(report.includes(heading));
        }

        assert.ok(report.includes(`| audited documents | ${seed.auditedDocuments} |`));
        assert.ok(report.includes(`| normative elements | ${seed.normativeElements} |`));
        assert.ok(report.includes(`| artifact entries | ${seed.artifactEntries} |`));
        assert.ok(report.includes(`| findings | ${findings.length} |`));
        assert.ok(report.includes(
          `| finding bound | ${seed.normativeElements + seed.artifactEntries} |`,
        ));
        assert.ok(report.includes(`| elapsed ms | ${seed.elapsedMs} |`));

        const revisionRows = tableRows(
          report,
          "## Input Revisions",
          "## Readiness Gap Matrix",
        );
        assert.equal(revisionRows.length, 2);
        assert.deepEqual(
          new Set(revisionRows.map((row) => row[0])),
          new Set(["guideline", "runtime"]),
        );
        assert.deepEqual(
          new Set(revisionRows.map((row) => row[2])),
          new Set(["guideline-revision", "runtime-revision"]),
        );

        const readinessRows = tableRows(
          report,
          "## Readiness Gap Matrix",
          "## Findings",
        ).filter((row) => row[0] !== "(none)");
        assert.equal(readinessRows.length, assignments.length);
        for (const row of readinessRows) {
          assert.ok(LEVELS.includes(row[1]));
          assert.notEqual(row[4], "");
          assert.notEqual(row[5], "");
          assert.match(
            row[6],
            /^condition_id=.+; end_state=.+; stated_check=.+; constraint=.+; bound=.+$/u,
          );
        }

        const findingRows = tableRows(
          report,
          "## Findings",
          "## Pipeline Gate States",
        ).filter((row) => row[0] !== "(none)");
        assert.equal(findingRows.length, findings.length);
        for (let index = 1; index < findingRows.length; index += 1) {
          const previous = findingRows[index - 1];
          const current = findingRows[index];
          assert.ok(
            SEVERITY_RANK[previous[0]] < SEVERITY_RANK[current[0]] ||
            (
              SEVERITY_RANK[previous[0]] === SEVERITY_RANK[current[0]] &&
              previous[1].localeCompare(current[1], "en") <= 0
            ),
          );
        }

        const vendorRows = tableRows(
          report,
          "### Vendor Coupling By Input Role",
          "## Input Revisions",
        );
        const reportedVendorTotal = vendorRows.reduce(
          (sum, row) => sum + Number(row[1]),
          0,
        );
        assert.equal(
          reportedVendorTotal,
          findings.filter(({ findingType }) =>
            findingType === "vendor-coupling").length,
        );

        const gateRows = tableRows(
          report,
          "## Pipeline Gate States",
          "## Source Integrity",
        ).filter((row) => row[1] !== "(none)");
        assert.equal(gateRows.length, gates.length);
        assert.equal(sink.files.size, 3);
      },
    ),
    { numRuns: 100 },
  );
});

function findingsFrom(seed, vendorCounts) {
  if (seed.findingMode === "zero") return [];
  const findings = [];
  for (const [role, count] of Object.entries(vendorCounts)) {
    for (let index = 0; index < count; index += 1) {
      findings.push(finding(
        "vendor-coupling",
        severityFor(seed, index),
        `vendor-${role}-${index}`,
      ));
    }
  }
  for (let index = 0; index < seed.findingCount; index += 1) {
    findings.push(finding(
      seed.findingMode === "ties"
        ? "unknown-status"
        : FINDING_TYPES[index % FINDING_TYPES.length],
      severityFor(seed, index),
      `finding-${index}`,
    ));
  }
  return findings;
}

function severityFor(seed, index) {
  if (seed.findingMode === "single-severity" || seed.findingMode === "ties") {
    return seed.severity;
  }
  return ["blocker", "major", "minor"][index % 3];
}

function finding(findingType, severity, id) {
  return makeFinding({
    findingType,
    severity,
    guidelineAnchor: `anchor-${id}`,
    artifactReference: `artifact-${id}`,
    evidenceExcerpt: `evidence-${id}`,
    remediation: {
      class: "documentation-change",
      statement: `Document the alignment evidence for ${id}.`,
      state: "proposed",
      operatorInstructionRef: null,
    },
  });
}

function assignmentsFrom(count) {
  return Array.from({ length: count }, (_, index) => {
    const assignedLevel = LEVELS[index % LEVELS.length];
    return {
      capabilityId: `capability-${index}`,
      assignedLevel,
      localReadiness: assignedLevel === "production-verified"
        ? "runtime-ready"
        : assignedLevel,
      deployedReadiness: assignedLevel === "production-verified"
        ? "production-verified"
        : "undocumented",
      gapStatement: `Close gap ${index}.`,
      priority: `P${index % 3}`,
      exitCriterion: {
        conditionId: `condition-${index}`,
        endState: `End state ${index}`,
        statedCheck: `check-${index}`,
        constraint: `constraint-${index}`,
        bound: index + 1,
      },
    };
  });
}

function gatesFrom(count) {
  return Array.from({ length: count }, (_, index) => ({
    order: index,
    gateId: `gate-${index}`,
    state: ["unmet", "partially-met", "met"][index % 3],
    entryCondition: `entry-${index}`,
    exitCondition: `exit-${index}`,
    requiredEvidenceType: `evidence-${index}`,
  }));
}

function tableRows(report, heading, nextHeading) {
  const lines = report.split("\n");
  const start = lines.indexOf(heading);
  const end = lines.indexOf(nextHeading, start + 1);
  assert.ok(start >= 0 && end > start);
  return lines
    .slice(start + 1, end)
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()));
}
