import {
  canonicalGuidelineElements,
  compareGateDeclarations,
  normalizeDocumentMeta,
  normalizeGateDeclaration,
  unwrapGuidelineModel,
} from "./guideline-model.mjs";
import { normalizeContent } from "./normalize.mjs";

const DIGEST_HEADER = `---
title: "Guideline Digest"
doc_type: "Guideline Digest"
version: "1.0.0"
date: "1970-01-01"
lang: "en-US"
digest_schema: "guideline-digest/v1"
---

# Guideline Digest
`;

export function printGuidelineModel(modelOrResult) {
  const model = unwrapGuidelineModel(modelOrResult);
  const elements = canonicalGuidelineElements(model);
  const documents = model.documents instanceof Map
    ? [...model.documents.entries()]
    : Object.entries(model.documents ?? {});
  const chunks = [DIGEST_HEADER.trimEnd(), ""];

  for (const [documentKey, rawMeta] of documents.sort(([left], [right]) =>
    String(left).localeCompare(String(right), "en"),
  )) {
    const meta = normalizeDocumentMeta(documentKey, rawMeta);
    chunks.push(`## Document: ${documentKey}`, "");
    chunks.push("| field | value |", "|---|---|");
    chunks.push(`| universal_scope | ${meta.universalScope ? "true" : "false"} |`);
    chunks.push(`| frontmatter_keys | ${printTokenList(meta.frontmatterKeys)} |`);
    chunks.push(`| section_anchors | ${printTokenList(meta.sectionAnchors)} |`, "");

    const documentGates = (model.gates ?? [])
      .map(normalizeGateDeclaration)
      .filter(
        (gate) =>
          gate.documentKey === documentKey ||
          (gate.documentKey === "" &&
            elements.some(
              (element) =>
                element.documentKey === documentKey && element.gateId === gate.gateId,
            )),
      )
      .sort(compareGateDeclarations);
    for (const gate of documentGates) {
      chunks.push(`### Gate Declaration: ${gate.gateId}`, "");
      chunks.push("| field | value |", "|---|---|");
      chunks.push(`| order | ${gate.order} |`);
      chunks.push(`| section_anchor | \`${gate.sectionAnchor}\` |`, "");
      chunks.push(printFencedValue("gate-entry-condition", gate.entryCondition).trimEnd(), "");
      chunks.push(printFencedValue("gate-exit-condition", gate.exitCondition).trimEnd(), "");
      chunks.push(
        printFencedValue("gate-required-evidence", gate.requiredEvidenceType).trimEnd(),
        "",
      );
    }

    const seenAnchors = new Set();
    for (const sectionAnchor of meta.sectionAnchors) {
      chunks.push(`### Section: ${sectionAnchor}`, "");
      if (seenAnchors.has(sectionAnchor)) continue;
      seenAnchors.add(sectionAnchor);
      const sectionElements = elements
        .filter(
          (element) =>
            element.documentKey === documentKey && element.sectionAnchor === sectionAnchor,
        )
        .sort(
          (left, right) =>
            left.ordinal - right.ordinal ||
            left.elementId.localeCompare(right.elementId, "en"),
        );
      for (const element of sectionElements) {
        chunks.push(`#### Element: ${element.elementId}`, "");
        chunks.push("| field | value |", "|---|---|");
        chunks.push(`| kind | \`${element.kind}\` |`);
        chunks.push(`| class | \`${element.class}\` |`);
        chunks.push(`| gate | ${element.gateId === null ? "(none)" : `\`${element.gateId}\``} |`);
        chunks.push(`| ordinal | ${element.ordinal} |`, "");
        chunks.push(printFencedValue("element", element.text).trimEnd(), "");
      }
    }
  }

  return `${chunks.join("\n").trimEnd()}\n`;
}

export function printFencedValue(label, value) {
  const text = normalizeContent(String(value ?? ""));
  let longest = 0;
  for (const line of text.split("\n")) {
    const length = /^(~+)/u.exec(line)?.[1].length ?? 0;
    longest = Math.max(longest, length);
  }
  const fence = "~".repeat(Math.max(3, longest + 1));
  return `${fence}${label}\n${text}${fence}\n`;
}

function printTokenList(values) {
  if (values.length === 0) return "(none)";
  return values.map((value) => `\`${String(value).replace(/`/gu, "``")}\``).join(", ");
}
