import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createInMemorySourceReader } from "../scripts/alignment-audit/source-reader.mjs";

const SCENARIOS = ["empty", "single", "all-malformed", "large"];

// Feature: guideline-runtime-alignment-audit, Property 20: Repeated runs over unchanged inputs are identical
test("Property 20: repeated in-memory runs retain reports and preserve the Finding set", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...SCENARIOS),
      fc.integer({ min: 2, max: 5 }),
      fc.integer({ min: 2, max: 8 }),
      async (scenario, runCount, size) => {
        const documents = documentsFor(scenario, size);
        const reader = createInMemorySourceReader(documents);
        const sink = createInMemoryWriteSink();
        const findingSets = [];
        const versions = [];

        for (let index = 0; index < runCount; index += 1) {
          const retainedBefore = new Map(sink.files);
          const result = await runAudit(resolvedConfig(), reader, sink);
          findingSets.push(canonicalFindings(result.findings));
          versions.push(result.version);
          for (const [name, content] of retainedBefore) {
            assert.equal(sink.files.get(name), content);
          }
        }

        for (const findings of findingSets.slice(1)) {
          assert.deepEqual(findings, findingSets[0]);
        }
        assert.equal(new Set(versions).size, runCount);
        assert.deepEqual(
          versions,
          Array.from({ length: runCount }, (_, index) => `1.0.${index}`),
        );
        const reports = [...sink.files.keys()]
          .filter((name) => /^alignment-audit-report-v\d+\.\d+\.\d+\.md$/u.test(name))
          .sort();
        assert.equal(reports.length, runCount);
        assert.equal(sink.files.size, runCount * 3);
      },
    ),
    { numRuns: 100 },
  );
});

function documentsFor(scenario, size) {
  if (scenario === "empty") return [];
  if (scenario === "single") {
    return [healthyDocument(0, "guideline")];
  }
  if (scenario === "all-malformed") {
    return Array.from({ length: size }, (_, index) => ({
      readHandle: `malformed-${index}`,
      subject: `malformed-${index}.md`,
      auditSurface: index % 2 === 0 ? "guideline" : "runtime",
      inputRole: index % 2 === 0 ? "guideline" : "runtime",
      content: `title: Malformed ${index}\nNo opening frontmatter delimiter.`,
    }));
  }
  return Array.from({ length: size }, (_, index) =>
    healthyDocument(index, index % 2 === 0 ? "guideline" : "runtime"));
}

function healthyDocument(index, auditSurface) {
  const guideline = auditSurface === "guideline";
  return {
    readHandle: `healthy-${auditSurface}-${index}`,
    subject: `healthy-${auditSurface}-${index}.md`,
    auditSurface,
    inputRole: auditSurface,
    content: [
      "---",
      `title: Healthy ${auditSurface} ${index}`,
      `doc_type: ${guideline ? "guideline" : "runtime-contract"}`,
      "owner: audit-test",
      ...(guideline
        ? []
        : [
            `capability_id: capability-${index}`,
            "status: dev-proven",
            "runtime_scope: local",
            "proof_reference: local-check-passed",
          ]),
      "---",
      "",
      "## Directives",
      "",
      guideline
        ? `- Must record an evidence report for capability ${index}.`
        : [
            `Runtime contract for capability ${index}.`,
            "",
            "| lane | owner | mutation |",
            "|---|---|---|",
            "| development | local | output only |",
            "| production mirror | operator | gated |",
            "| edge delivery | operator | gated |",
          ].join("\n"),
      "",
    ].join("\n"),
  };
}

function canonicalFindings(findings) {
  return findings.map((finding) => JSON.parse(JSON.stringify(finding)));
}

function resolvedConfig() {
  return {
    resolved: true,
    guidelineRoots: [{
      locator: "/virtual/guidelines",
      roleLabel: "guideline",
      revisionIdentifier: "guideline-revision",
    }],
    runtimeRoots: [{
      locator: "/virtual/runtime",
      roleLabel: "runtime",
      revisionIdentifier: "runtime-revision",
    }],
    auditOutputDirectory: "/virtual/audit-output",
    operatorDeployInstruction: null,
    readinessLadder: [
      "undocumented",
      "spec-complete",
      "dev-proven",
      "runtime-ready",
      "production-verified",
    ],
    requiredFrontmatterKeys: ["title", "doc_type", "owner"],
    economicsStatements: [],
  };
}
