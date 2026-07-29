import assert from "node:assert/strict";
import test from "node:test";

import { validateAlignmentAuditContractDocuments } from "../scripts/alignment-audit-contract.mjs";
import { renderAuditReport } from "../scripts/alignment-audit/report-writer.mjs";

test("alignment audit contract accepts a complete report and ignores unrelated document dialects", () => {
  const documents = new Map([
    ["AUDIT.md", auditDocument()],
    ["OTHER.md", "---\nschema: generic/v1\nnested:\n  value: true\n---\nBody\n"],
  ]);
  assert.deepEqual(validateAlignmentAuditContractDocuments(documents), []);
});

test("alignment audit contract reports malformed owned documents without throwing", () => {
  const malformed = auditDocument()
    .replace("lang: en\n", "")
    .replace("## Findings\n", "");
  assert.deepEqual(validateAlignmentAuditContractDocuments({ "AUDIT.md": malformed }), [
    "AUDIT.md: missing alignment audit frontmatter key lang",
    "AUDIT.md: missing report section ## Findings",
  ]);
  assert.deepEqual(validateAlignmentAuditContractDocuments(null), []);
});

test("the actual report renderer satisfies the registered contract", () => {
  const report = renderAuditReport({
    findings: [],
    readiness: { assignments: [] },
    gates: { gates: [] },
    counts: {
      auditedDocuments: 0,
      normativeElements: 0,
      artifactEntries: 0,
      findings: 0,
    },
    coverage: {
      artifactBearingTotal: 0,
      artifactBearingLinked: 0,
      linkedRatio: 1,
    },
    baselineVerified: true,
    modifiedOutsideOutputCount: 0,
    deployBoundaryState: "closed",
  }, { date: "2026-07-28" });
  assert.deepEqual(
    validateAlignmentAuditContractDocuments(new Map([["rendered-report.md", report]])),
    [],
  );
});

function auditDocument() {
  return [
    "---",
    "title: Alignment Audit",
    "doc_type: Alignment Audit Report",
    "version: 1.0.0",
    "date: 2026-07-28",
    "lang: en",
    "---",
    "## Alignment Summary",
    "",
    "Complete.",
    "",
    "## Readiness Gap Matrix",
    "",
    "## Findings",
    "",
    "## Pipeline Gate States",
    "",
  ].join("\n");
}
