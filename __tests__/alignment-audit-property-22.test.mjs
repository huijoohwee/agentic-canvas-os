import assert from "node:assert/strict";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { deduplicationKey } from "../scripts/alignment-audit/finding.mjs";
import { elementIdFrom } from "../scripts/alignment-audit/normalize.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createInMemorySourceReader } from "../scripts/alignment-audit/source-reader.mjs";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

const ELEMENT_ID = elementIdFrom(
  "capability-rule",
  "The runtime must record capability artifact.",
);

// Feature: guideline-runtime-alignment-audit, Property 22: Adding a document preserves Findings for unchanged documents
test("Property 22: added documents preserve every unaffected prior Finding", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(
      "unrelated",
      "artifact-supplying",
      "conflict-introducing",
      "owner-duplicating",
      "same-identity-collision",
      "byte-identical",
    ),
    fc.integer({ min: 0, max: 2 }),
    async (kind, noiseCount) => {
      const base = baseDocuments(noiseCount);
      const added = addedDocument(kind, base[1]);
      const before = await audit(base);
      const after = await audit([...base, added]);
      const addedSource = after.sourceDocuments.find(({ subject }) =>
        subject === "added-document");
      const addedEntryIds = new Set(after.artifactIndex.entries
        .filter(({ documentKey }) => documentKey === addedSource.documentKey)
        .map(({ entryId }) => entryId));
      const newlySuppliedElements = new Set(after.mapping.links
        .filter(({ artifactReference }) => addedEntryIds.has(artifactReference))
        .map(({ elementId }) => elementId));
      const addedFindingKeys = new Set(after.findings
        .filter((finding) => findingReferencesAdded(finding, addedSource, addedEntryIds))
        .map(deduplicationKey));
      const qualifying = before.findings.filter((finding) => {
        if (addedFindingKeys.has(deduplicationKey(finding))) return false;
        if (
          finding.findingType === "unimplemented-guideline" &&
          newlySuppliedElements.has(finding.guidelineAnchor)
        ) return false;
        if (
          finding.findingType === "missing-companion" &&
          referenceStem(finding.evidenceExcerpt.split(": ").at(-1)) ===
            referenceStem(addedSource.documentKey)
        ) return false;
        return true;
      });
      const afterByKey = new Map(after.findings.map((finding) =>
        [deduplicationKey(finding), finding]));
      for (const finding of qualifying) {
        assert.deepEqual(afterByKey.get(deduplicationKey(finding)), finding);
      }

      if (kind === "artifact-supplying") {
        assert.equal(newlySuppliedElements.has(ELEMENT_ID), true);
        assert.equal(after.findings.some(({ findingType, guidelineAnchor }) =>
          findingType === "unimplemented-guideline" &&
          guidelineAnchor === ELEMENT_ID), false);
      }
    },
  ), { numRuns: 100 });
});

function baseDocuments(noiseCount) {
  const documents = [
    guidelineDocument(),
    runtimeDocument({
      readHandle: "base-runtime",
      subject: "base-runtime",
      id: "base-runtime",
      status: "dev-proven",
      capability: "core-capability",
      owner: "primary-owner",
      body: "Required companion: supplied-companion",
    }),
  ];
  for (let index = 0; index < noiseCount; index += 1) {
    documents.push(runtimeDocument({
      readHandle: `base-noise-${index}`,
      subject: `base-noise-${index}`,
      id: `base-noise-${index}`,
      status: "spec-complete",
      capability: `noise-${index}`,
      owner: `noise-owner-${index}`,
      body: `Unrelated base document ${index}.`,
    }));
  }
  return documents;
}

function addedDocument(kind, baseRuntime) {
  if (kind === "byte-identical") {
    return {
      ...baseRuntime,
      readHandle: "added-document",
      subject: "added-document",
    };
  }
  const variants = {
    unrelated: {
      id: "unrelated-added",
      status: "spec-complete",
      capability: "unrelated",
      owner: "unrelated-owner",
      body: "An unrelated declaration.",
    },
    "artifact-supplying": {
      id: "supplied-companion",
      status: "dev-proven",
      capability: "supplied-companion",
      owner: "artifact-owner",
      body: `guideline_element_ids: \`${ELEMENT_ID}\``,
    },
    "conflict-introducing": {
      id: "conflicting-status",
      status: "runtime-ready",
      capability: "core-capability",
      owner: "conflict-owner",
      body: "A conflicting readiness declaration.",
    },
    "owner-duplicating": {
      id: "duplicate-owner",
      status: "dev-proven",
      capability: "core-capability",
      owner: "secondary-owner",
      body: "A second owner declaration.",
    },
    "same-identity-collision": {
      id: "base-runtime",
      status: "spec-complete",
      capability: "benign-collision",
      owner: "benign-owner",
      body: "A benign document with the same declared identity.",
    },
  };
  return runtimeDocument({
    readHandle: "added-document",
    subject: "added-document",
    ...variants[kind],
  });
}

function guidelineDocument() {
  return {
    readHandle: "guideline",
    subject: "guideline",
    auditSurface: "guideline",
    inputRole: "guideline",
    content: frontmatter({
      title: "Additive Guideline",
      graphId: "additive-guideline",
      doc_type: "Guideline",
      status: "spec-complete",
      universal_scope: "false",
    }, "## Capability Rule\n\n- Directive: The runtime must record capability artifact."),
  };
}

function runtimeDocument({
  readHandle,
  subject,
  id,
  status,
  capability,
  owner,
  body,
}) {
  return {
    readHandle,
    subject,
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

function findingReferencesAdded(finding, source, entryIds) {
  const reference = String(finding.artifactReference);
  return reference.includes(source.documentKey) ||
    [...entryIds].some((entryId) => reference.includes(entryId));
}

function referenceStem(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.(?:md|json|ya?ml)(?:#.*)?$/u, "")
    .replace(/(?:-[0-9a-f]{8,64})+$/u, "");
}

async function audit(documents) {
  return runAudit(
    resolvedConfig(),
    createInMemorySourceReader(documents),
    createInMemoryWriteSink(),
  );
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
