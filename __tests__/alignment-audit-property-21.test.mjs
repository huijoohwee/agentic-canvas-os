import assert from "node:assert/strict";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

// Feature: guideline-runtime-alignment-audit, Property 21: Document processing order does not change the Finding set
test("Property 21: whole-audit document processing order is confluent", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      companionPresent: fc.boolean(),
      noiseCount: fc.integer({ min: 0, max: 3 }),
      secondStatus: fc.constantFrom("spec-complete", "runtime-ready"),
    }),
    fc.integer(),
    fc.array(fc.integer(), { maxLength: 10 }),
    fc.boolean(),
    async (seed, offset, weights, reverse) => {
      const documents = documentSet(seed);
      const permuted = permute(documents, offset, weights, reverse);
      const [original, reordered] = await Promise.all([
        audit(documents),
        audit(permuted),
      ]);
      assert.deepEqual(
        canonicalFindings(reordered.findings),
        canonicalFindings(original.findings),
      );
      const types = new Set(original.findings.map(({ findingType }) => findingType));
      assert.equal(types.has("status-conflict"), true);
      assert.equal(types.has("duplicate-owner"), true);
      assert.equal(types.has("ambiguous-route"), true);
      assert.equal(types.has("missing-companion"), !seed.companionPresent);
    },
  ), { numRuns: 100 });
});

function documentSet(seed) {
  const documents = [
    guidelineDocument(),
    runtimeDocument({
      id: "owner-a",
      status: "dev-proven",
      capability: "shared-capability",
      owner: "shared-owner",
      body: [
        "Required companion: missing-companion",
        "",
        "| surface | token | owner |",
        "|---|---|---|",
        "| slash | /shared.audit | shared-owner |",
      ].join("\n"),
    }),
    runtimeDocument({
      id: "owner-b",
      status: seed.secondStatus,
      capability: "shared-capability",
      owner: "shared-owner",
      body: "Second owner declaration.",
    }),
  ];
  if (seed.companionPresent) {
    documents.push(runtimeDocument({
      id: "missing-companion",
      status: "spec-complete",
      capability: "companion",
      owner: "companion-owner",
      body: "Companion contract.",
    }));
  }
  for (let index = 0; index < seed.noiseCount; index += 1) {
    documents.push(runtimeDocument({
      id: `noise-${index}`,
      status: "spec-complete",
      capability: `noise-${index}`,
      owner: `noise-owner-${index}`,
      body: `Unrelated runtime declaration ${index}.`,
    }));
  }
  return documents;
}

function guidelineDocument() {
  return {
    readHandle: "guideline",
    subject: "guideline",
    auditSurface: "guideline",
    inputRole: "guideline",
    content: frontmatter({
      title: "Confluence Guideline",
      graphId: "confluence-guideline",
      doc_type: "Guideline",
      status: "spec-complete",
      universal_scope: "false",
    }, "## Capability Rule\n\n- Directive: The runtime must record capability artifact."),
  };
}

function runtimeDocument({ id, status, capability, owner, body }) {
  return {
    readHandle: id,
    subject: id,
    auditSurface: "runtime",
    inputRole: "runtime",
    content: frontmatter({
      title: id,
      graphId: id,
      doc_type: "Runtime Contract",
      status,
      capability_id: capability,
      owner,
      universal_scope: "false",
    }, body),
  };
}

function frontmatter(fields, body) {
  return [
    "---",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
    body,
    "",
  ].join("\n");
}

function permute(documents, offset, weights, reverse) {
  if (documents.length === 0) return [];
  const rotation = Math.abs(offset) % documents.length;
  const rotated = [...documents.slice(rotation), ...documents.slice(0, rotation)];
  const shuffled = rotated
    .map((document, index) => ({ document, index, weight: weights[index] ?? 0 }))
    .sort((left, right) => left.weight - right.weight || left.index - right.index)
    .map(({ document }) => document);
  return reverse ? shuffled.reverse() : shuffled;
}

async function audit(documents) {
  return runAudit(
    resolvedConfig(),
    orderPreservingReader(documents),
    createInMemoryWriteSink(),
  );
}

function orderPreservingReader(documents) {
  const byHandle = new Map(documents.map((document) =>
    [document.readHandle, document]));
  return {
    async list() {
      return documents.map(({ content: _content, ...descriptor }) => descriptor);
    },
    async read(subject) {
      const handle = typeof subject === "string" ? subject : subject.readHandle;
      const document = byHandle.get(handle);
      return {
        ...document,
        content: document.content,
        text: document.content,
        readState: "ok",
        error: null,
      };
    },
  };
}

function canonicalFindings(findings) {
  return JSON.parse(JSON.stringify(findings));
}

function resolvedConfig() {
  return {
    resolved: true,
    guidelineRoots: [{
      locator: "/virtual/guidelines",
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
    requiredFrontmatterKeys: ["title", "doc_type", "status"],
    economicsStatements: [],
  };
}
