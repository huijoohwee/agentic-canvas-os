import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createInMemorySourceReader } from "../scripts/alignment-audit/source-reader.mjs";

const REQUIRED_KEYS = ["title", "doc_type", "owner"];
const MALFORMATIONS = [
  "missing-opening",
  "missing-closing",
  "unterminated-fence",
  "duplicate-key",
  "invalid-indentation",
];

// Feature: guideline-runtime-alignment-audit, Property 24: Degraded inputs yield typed Findings and a completed run
test("Property 24: mixed degraded inputs complete with document-specific typed Findings", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom(...MALFORMATIONS), {
        minLength: 1,
        maxLength: 5,
      }),
      fc.integer({ min: 1, max: 3 }),
      fc.uniqueArray(fc.constantFrom(...REQUIRED_KEYS), {
        minLength: 1,
        maxLength: REQUIRED_KEYS.length,
      }),
      fc.boolean(),
      fc.integer({ min: 1, max: 4 }),
      async (malformations, unreadableCount, omittedKeys, allDegraded, healthyCount) => {
        const malformed = malformations.map((kind, index) =>
          malformedDocument(kind, index));
        const unreadable = Array.from({ length: unreadableCount }, (_, index) =>
          unreadableDocument(index));
        const omissions = omittedKeys.map((key, index) =>
          omissionDocument(key, index));
        const healthy = allDegraded
          ? []
          : Array.from({ length: healthyCount }, (_, index) =>
              healthyDocument(index, index % 2 === 0 ? "guideline" : "runtime"));
        const documents = [...malformed, ...unreadable, ...omissions, ...healthy];
        const sink = createInMemoryWriteSink();
        const result = await runAudit(
          resolvedConfig(),
          createInMemorySourceReader(documents),
          sink,
        );
        const bySubject = new Map(
          result.sourceDocuments.map((document) => [document.subject, document]),
        );

        assert.equal(result.counts.auditedDocuments, documents.length);
        assert.equal(typeof result.report, "string");
        assert.ok(result.report.includes("## Findings"));
        assert.ok(
          [...sink.files.keys()].some((name) =>
            name.startsWith("alignment-audit-report-v")),
        );

        for (const document of malformed) {
          const findings = result.findings.filter((finding) =>
            finding.findingType === "malformed-document" &&
            finding.artifactReference === document.subject);
          assert.equal(findings.length, 1);
        }
        for (const document of unreadable) {
          const findings = result.findings.filter((finding) =>
            finding.findingType === "unreadable-input" &&
            finding.artifactReference === document.subject);
          assert.equal(findings.length, 1);
        }
        for (const [index, key] of omittedKeys.entries()) {
          const subject = omissions[index].subject;
          const documentKey = bySubject.get(subject)?.documentKey;
          const findings = result.findings.filter((finding) =>
            finding.findingType === "missing-frontmatter-key" &&
            finding.artifactReference === documentKey &&
            finding.evidenceExcerpt.includes(key));
          assert.equal(findings.length, 1);
        }

        const healthyGuidelines = healthy.filter(
          ({ auditSurface }) => auditSurface === "guideline",
        ).length;
        const healthyRuntime = healthy.filter(
          ({ auditSurface }) => auditSurface === "runtime",
        ).length;
        assert.ok(result.counts.normativeElements >= healthyGuidelines);
        assert.ok(result.counts.artifactEntries >= healthyRuntime);
      },
    ),
    { numRuns: 100 },
  );
});

function malformedDocument(kind, index) {
  const metadata = {
    readHandle: `malformed-${index}`,
    subject: `malformed-${index}.md`,
    auditSurface: index % 2 === 0 ? "guideline" : "runtime",
    inputRole: index % 2 === 0 ? "guideline" : "runtime",
  };
  const validHeader = [
    "---",
    `title: Malformed ${index}`,
    "doc_type: guideline",
    "owner: audit-test",
    "---",
    "",
  ];
  const content = {
    "missing-opening": [
      `title: Malformed ${index}`,
      "doc_type: guideline",
      "---",
      "Body without an opening delimiter.",
    ],
    "missing-closing": [
      "---",
      `title: Malformed ${index}`,
      "doc_type: guideline",
      "owner: audit-test",
      "Body without a closing delimiter.",
    ],
    "unterminated-fence": [
      ...validHeader,
      "```text",
      "fence never closes",
    ],
    "duplicate-key": [
      "---",
      `title: Malformed ${index}`,
      `title: Duplicate ${index}`,
      "doc_type: guideline",
      "owner: audit-test",
      "---",
      "Duplicate title.",
    ],
    "invalid-indentation": [
      "---",
      `title: Malformed ${index}`,
      " doc_type: guideline",
      "owner: audit-test",
      "---",
      "Indented frontmatter.",
    ],
  }[kind];
  return { ...metadata, content: content.join("\n") };
}

function unreadableDocument(index) {
  return {
    readHandle: `unreadable-${index}`,
    subject: `unreadable-${index}.md`,
    auditSurface: index % 2 === 0 ? "guideline" : "runtime",
    inputRole: index % 2 === 0 ? "guideline" : "runtime",
    unreadable: true,
    error: new Error(`simulated unreadable input ${index}`),
    content: "",
  };
}

function omissionDocument(omittedKey, index) {
  const values = {
    title: `Omission ${index}`,
    doc_type: "guideline",
    owner: "audit-test",
  };
  return {
    readHandle: `omission-${omittedKey}`,
    subject: `omission-${omittedKey}.md`,
    auditSurface: "guideline",
    inputRole: "guideline",
    content: [
      "---",
      ...REQUIRED_KEYS
        .filter((key) => key !== omittedKey)
        .map((key) => `${key}: ${values[key]}`),
      "---",
      "",
      "## Directives",
      "",
      `- Must record an evidence report for omission ${index}.`,
      "",
    ].join("\n"),
  };
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
      "---",
      "",
      "## Directives",
      "",
      guideline
        ? `- Must record an evidence report for healthy capability ${index}.`
        : `Runtime contract for healthy capability ${index}.`,
      "",
    ].join("\n"),
  };
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
    requiredFrontmatterKeys: REQUIRED_KEYS,
    economicsStatements: [],
  };
}
