import {
  ABSENT,
  createArtifactIndex,
  unwrapArtifactIndex,
} from "./artifact-index.mjs";
import { printFencedValue } from "./guideline-printer.mjs";

const INDEX_HEADER = `---
title: "Artifact Index"
doc_type: "Artifact Index"
version: "1.0.0"
date: "1970-01-01"
lang: "en-US"
index_schema: "artifact-index/v1"
---

# Artifact Index
`;

const SCALAR_FIELDS = Object.freeze([
  ["capability_id", "capabilityId"],
  ["declared_status", "declaredStatus"],
  ["declared_runtime_scope", "declaredRuntimeScope"],
  ["declared_owner", "declaredOwner"],
  ["declared_proof_reference", "declaredProofReference"],
  ["command_text", "commandText"],
  ["contract_role", "contractRole"],
]);

export function printArtifactIndex(indexOrResult) {
  const index = createArtifactIndex(unwrapArtifactIndex(indexOrResult).entries ?? []);
  const chunks = [INDEX_HEADER.trimEnd(), ""];

  for (const entry of index.entries) {
    const fenced = [];
    chunks.push(`## Entry: ${entry.entryId}`, "");
    chunks.push("| field | value |", "|---|---|");
    chunks.push(`| document_key | ${printScalar(entry.documentKey, "document_key", fenced)} |`);
    chunks.push(`| entry_kind | ${printScalar(entry.entryKind, "entry_kind", fenced)} |`);
    for (const [renderedName, property] of SCALAR_FIELDS) {
      chunks.push(
        `| ${renderedName} | ${printScalar(entry[property], renderedName, fenced)} |`,
      );
    }
    chunks.push(
      `| element_ids | ${printTokenList(entry.elementIds, fenced, "element_ids")} |`,
    );
    chunks.push(
      `| invocation_routes | ${printRouteList(entry.invocationRoutes, fenced)} |`,
    );
    chunks.push(
      `| tool_identities | ${printTokenList(entry.toolIdentities, fenced)} |`,
    );
    chunks.push(
      `| documented_stage_order | ${printTokenList(entry.documentedStageOrder, fenced, "documented_stage_order")} |`,
    );
    chunks.push(
      `| federated_tool_identities | ${printTokenList(entry.federatedToolIdentities, fenced, "federated_tool_identities")} |`,
    );
    chunks.push(
      `| catalogued_tool_identities | ${printTokenList(entry.cataloguedToolIdentities, fenced, "catalogued_tool_identities")} |`,
      "",
    );
    for (const block of fenced) chunks.push(block.trimEnd(), "");
    chunks.push(printFencedValue("excerpt", entry.excerpt).trimEnd(), "");
  }

  return `${chunks.join("\n").trimEnd()}\n`;
}

function printScalar(value, fieldName, fenced) {
  if (value === ABSENT) return "(absent)";
  if (value === "") return "(empty)";
  const text = String(value);
  if (text.includes("`") || text.includes("\n")) {
    fenced.push(printFencedValue(`value:${fieldName}`, text));
    return `(fenced:${fieldName})`;
  }
  return `\`${text}\``;
}

function printRouteList(routes, fenced) {
  if (routes.length === 0) return "(none)";
  if (
    routes.some(
      (route) => route.owner !== undefined || /[`,\n]/u.test(`${route.surface}:${route.token}`),
    )
  ) {
    fenced.push(
      printFencedValue("value:invocation_routes", JSON.stringify(routes)),
    );
    return "(fenced:invocation_routes)";
  }
  return routes.map((route) => `\`${route.surface}:${route.token}\``).join(", ");
}

function printTokenList(values, fenced, fieldName = "tool_identities") {
  if (values.length === 0) return "(none)";
  if (values.some((value) => /[`,\n]/u.test(String(value)))) {
    fenced.push(
      printFencedValue(`value:${fieldName}`, JSON.stringify(values)),
    );
    return `(fenced:${fieldName})`;
  }
  return values.map((value) => `\`${String(value).replace(/`/gu, "``")}\``).join(", ");
}
