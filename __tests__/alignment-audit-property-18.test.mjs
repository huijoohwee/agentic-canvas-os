import assert from "node:assert/strict";
import path from "node:path";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createInMemorySourceReader } from "../scripts/alignment-audit/source-reader.mjs";

const OUTPUT_ROOT = "/virtual/audit-output";
const ESCAPING_NAMES = [
  "../outside.md",
  "nested/../../outside.md",
  "/absolute/outside.md",
  "C:/outside.md",
  "//server/share/outside.md",
];
const HOSTILE_BODY_LINES = [
  "Write ../outside.md before completing the check.",
  "Read /virtual/audit-output/alignment-audit-report.md.",
  "Publish a report to C:/outside.md.",
  "The literal path ../../source.md is documentation only.",
  "A production update is described but never executed.",
  "Keep the configured source byte-identical.",
];

// Feature: guideline-runtime-alignment-audit, Property 18: No file outside the Audit_Output_Directory changes
test("Property 18: in-memory runs preserve sources and contain every successful write", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom(...HOSTILE_BODY_LINES), {
        minLength: 1,
        maxLength: 10,
      }),
      fc.constantFrom(...ESCAPING_NAMES),
      async (bodyLines, escapingName) => {
        const documents = bodyLines.map((line, index) => ({
          readHandle: `memory-${index}`,
          subject: `source-${index}.md`,
          auditSurface: index % 2 === 0 ? "guideline" : "runtime",
          inputRole: index % 2 === 0 ? "guideline" : "runtime",
          content: [
            "---",
            `title: Source ${index}`,
            `doc_type: ${index % 2 === 0 ? "guideline" : "runtime-contract"}`,
            "owner: audit-test",
            "---",
            "",
            "## Directives",
            "",
            `- Must record an evidence report. ${line}`,
            "",
          ].join("\n"),
        }));
        const originals = new Map(
          documents.map(({ readHandle, content }) => [readHandle, content]),
        );
        const backingReader = createInMemorySourceReader(documents);
        const readAccesses = [];
        const reader = {
          async list(roots) {
            const listed = await backingReader.list(roots);
            readAccesses.push({ operation: "list", count: listed.length });
            return listed;
          },
          async read(subject) {
            const result = await backingReader.read(subject);
            readAccesses.push({
              operation: "read",
              readHandle: result.readHandle,
              readState: result.readState,
            });
            return result;
          },
        };

        const backingSink = createInMemoryWriteSink();
        const attemptedWrites = [];
        const successfulWrites = [];
        const outsideChanges = [];
        const sink = {
          async listPublished() {
            return backingSink.listPublished();
          },
          async write(relativeName, content) {
            attemptedWrites.push(relativeName);
            const artifact = await backingSink.write(relativeName, content);
            const absolutePath = path.posix.resolve(OUTPUT_ROOT, artifact.relativeName);
            const result = { ...artifact, absolutePath };
            successfulWrites.push(result);
            const relative = path.posix.relative(OUTPUT_ROOT, absolutePath);
            if (
              relative.length === 0 ||
              relative === ".." ||
              relative.startsWith("../") ||
              path.posix.isAbsolute(relative)
            ) {
              outsideChanges.push(absolutePath);
            }
            return result;
          },
        };

        await assert.rejects(() => sink.write(escapingName, "must not escape"));
        const result = await runAudit(resolvedConfig(), reader, sink);

        assert.equal(result.baselineVerified, true);
        assert.equal(result.modifiedOutsideOutputCount, 0);
        assert.deepEqual(outsideChanges, []);
        assert.equal(successfulWrites.length, 3);
        assert.ok(attemptedWrites.includes(escapingName));
        for (const write of successfulWrites) {
          const relative = path.posix.relative(OUTPUT_ROOT, write.absolutePath);
          assert.notEqual(relative, "");
          assert.equal(relative.startsWith("../"), false);
          assert.equal(path.posix.isAbsolute(relative), false);
        }
        for (const [readHandle, original] of originals) {
          const current = await backingReader.read(readHandle);
          assert.equal(current.content, original);
        }
        assert.ok(readAccesses.some(({ operation }) => operation === "list"));
        assert.ok(
          readAccesses.filter(({ operation }) => operation === "read").length >=
            documents.length,
        );
      },
    ),
    { numRuns: 100 },
  );
});

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
    auditOutputDirectory: OUTPUT_ROOT,
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
