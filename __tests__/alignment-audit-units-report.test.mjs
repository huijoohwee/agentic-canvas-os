import assert from "node:assert/strict";
import test from "node:test";

import { makeFinding } from "../scripts/alignment-audit/finding.mjs";
import { scanFrontmatter } from "../scripts/alignment-audit/frontmatter.mjs";
import {
  artifactNames,
  renderAuditReport,
  writeReport,
} from "../scripts/alignment-audit/report-writer.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";

test("report renders every required section and the fixed deployment record", () => {
  const report = renderAuditReport(fixtureRun(), {
    title: "Audit: [portable] #1",
    docType: "Alignment > Audit",
    date: "2026-07-28",
    lang: "en-US",
    version: "2.3.4",
  });

  for (const section of [
    "## Alignment Summary",
    "### Vendor Coupling By Input Role",
    "## Input Revisions",
    "## Readiness Gap Matrix",
    "## Findings",
    "## Pipeline Gate States",
    "## Source Integrity",
    "## Deployment Boundary",
  ]) {
    assert.ok(report.includes(section), `missing ${section}`);
  }
  assert.match(
    report,
    /Production-surface and edge-surface mutation is outside the scope of an Audit_Run\./u,
  );
  assert.match(report, /\| guideline \| guide \| guideline-r1 \|/u);
  assert.match(report, /\| runtime \| runtime \| runtime-r2 \|/u);
  assert.match(report, /\| capability-a \| dev-proven .* VCC-A/u);
  assert.match(report, /\| 1 \| G1 \| partially-met/u);
  assert.match(report, /\| finding bound \| 7 \|/u);
  assert.match(report, /\| finding bound satisfied \| yes \|/u);
});

test("report frontmatter round-trips reserved punctuation", () => {
  const metadata = {
    title: 'Audit: "#hash" [brackets] {braces}',
    docType: "> alignment - report ",
    version: "9.8.7",
    date: "2026-07-28",
    lang: "en-US",
  };
  const parsed = scanFrontmatter(renderAuditReport(fixtureRun(), metadata));
  assert.equal(parsed.readState, "ok");
  assert.equal(parsed.frontmatter.get("title"), metadata.title);
  assert.equal(parsed.frontmatter.get("doc_type"), metadata.docType);
  assert.equal(parsed.frontmatter.get("version"), metadata.version);
  assert.equal(parsed.frontmatter.get("date"), metadata.date);
  assert.equal(parsed.frontmatter.get("lang"), metadata.lang);
});

test("finding rows are ordered by severity and then Finding_Type", () => {
  const report = renderAuditReport(fixtureRun());
  const blocker = report.indexOf("| blocker | unproven-claim |");
  const major = report.indexOf("| major | duplicate-owner |");
  const minor = report.indexOf("| minor | unguided-artifact |");
  assert.ok(blocker > 0);
  assert.ok(major > blocker);
  assert.ok(minor > major);
});

test("report writer retains each report and companion version", async () => {
  const sink = createInMemoryWriteSink();
  const first = await writeReport(fixtureRun(), sink);
  const firstReport = sink.files.get(artifactNames(first.version).report);
  const second = await writeReport(fixtureRun(), sink);

  assert.equal(first.version, "1.0.0");
  assert.equal(second.version, "1.0.1");
  assert.equal(sink.files.size, 6);
  assert.equal(sink.files.get(artifactNames(first.version).report), firstReport);
});

function fixtureRun() {
  return {
    guidelineDigest: "# Guideline Digest\n",
    artifactIndexMarkdown: "# Artifact Index\n",
    findings: [
      finding("unguided-artifact", "minor", "artifact-c"),
      finding("duplicate-owner", "major", "artifact-b"),
      finding("unproven-claim", "major", "artifact-a"),
    ],
    counts: {
      auditedDocuments: 2,
      normativeElements: 3,
      artifactEntries: 4,
      findings: 3,
    },
    findingBound: 7,
    findingBoundSatisfied: true,
    coverage: {
      artifactBearingTotal: 3,
      artifactBearingLinked: 2,
      linkedRatio: 2 / 3,
    },
    routeCounts: { documented: 4, resolved: 3, orphan: 1, ambiguous: 0 },
    vendorCouplingCountByRole: { guide: 1, runtime: 2 },
    inputRevisions: [
      {
        surface: "guideline",
        roleLabel: "guide",
        revisionIdentifier: "guideline-r1",
      },
      {
        surface: "runtime",
        roleLabel: "runtime",
        revisionIdentifier: "runtime-r2",
      },
    ],
    readiness: {
      assignments: [
        {
          capabilityId: "capability-a",
          assignedLevel: "dev-proven",
          localReadiness: "dev-proven",
          deployedReadiness: "undocumented",
          gapStatement: "Close the remaining evidence gap.",
          priority: "P1",
          exitCriterion: {
            endState: "VCC-A end state",
            statedCheck: "run VCC-A",
            constraint: "local only",
          },
        },
      ],
    },
    gates: {
      gates: [
        {
          order: 1,
          gateId: "G1",
          state: "partially-met",
          entryCondition: "entry",
          exitCondition: "exit",
          requiredEvidenceType: "local result",
        },
      ],
    },
    baselineVerified: true,
    modifiedOutsideOutputCount: 0,
    deployBoundaryState: "closed",
    elapsedMs: 12.5,
  };
}

function finding(findingType, severity, artifactReference) {
  return makeFinding({
    findingType,
    severity,
    guidelineAnchor: "guide#anchor",
    artifactReference,
    evidenceExcerpt: `${artifactReference} evidence`,
    remediation: {
      class: "documentation-change",
      statement: `Document the remediation for ${artifactReference}.`,
    },
  });
}
