const PROBE_TREE_PRESET_ID = "knowgrph-probe-tree";
const PROBE_TREE_DOCUMENT_NAME = "PROBE-TREE.md";

export const PROBE_TREE_CLARIFICATION_TOPICS = Object.freeze([
  "RECOMMEND",
  "COMPARE",
  "ASSESS",
  "PLAN",
]);

const CONTRACT = Object.freeze({
  clarification_topic_match: "semantic and case-insensitive",
  clarification_card_kind: "semantic",
  clarification_card_minimum: 2,
  clarification_card_maximum: 4,
  terminal_bypass: "runtime-recognized selected-child terminal continuation only",
  model_route: "active Chat provider, endpoint, and model",
  fallback_policy: "fail closed; query-specific hardcoding and zero-model fallback cards are forbidden",
});

export function validateProbeTreeContractDocuments(documents) {
  const failures = [];
  const probeTree = requireDocument(documents, PROBE_TREE_DOCUMENT_NAME, failures);
  const promptPresets = requireDocument(documents, "PROMPT-PRESETS.md", failures);
  const facts = requireDocument(documents, "FACTS.md", failures);
  const command = requireDocument(documents, "DICTIONARY-COMMAND.md", failures);
  const semantic = requireDocument(documents, "DICTIONARY-SEMANTIC.md", failures);
  const binding = requireDocument(documents, "DICTIONARY-BINDING.md", failures);
  if (failures.length > 0) return failures;

  const probeTreeFrontmatter = extractFrontmatter(probeTree, PROBE_TREE_DOCUMENT_NAME, failures);
  const canonicalTopics = readDocumentJsonField(
    probeTreeFrontmatter,
    PROBE_TREE_DOCUMENT_NAME,
    "clarification_topics",
    failures,
  );
  if (JSON.stringify(canonicalTopics) !== JSON.stringify(PROBE_TREE_CLARIFICATION_TOPICS)) {
    failures.push(`${PROBE_TREE_DOCUMENT_NAME}: clarification_topics must be ${PROBE_TREE_CLARIFICATION_TOPICS.join(", ")}`);
  }
  for (const [field, expected] of Object.entries(CONTRACT)) {
    const actual = typeof expected === "number"
      ? readDocumentNumberField(probeTreeFrontmatter, PROBE_TREE_DOCUMENT_NAME, field, failures)
      : readDocumentJsonField(probeTreeFrontmatter, PROBE_TREE_DOCUMENT_NAME, field, failures);
    if (actual !== expected) failures.push(`${PROBE_TREE_DOCUMENT_NAME}: ${field} must be ${JSON.stringify(expected)}`);
  }

  const preset = extractPreset(promptPresets, PROBE_TREE_PRESET_ID);
  if (!preset) return [`PROMPT-PRESETS.md: missing ${PROBE_TREE_PRESET_ID} preset`];

  const semanticContract = readPresetJsonField(preset, "semantic_contract", failures);
  if (semanticContract !== PROBE_TREE_DOCUMENT_NAME) {
    failures.push(`PROMPT-PRESETS.md: semantic_contract must be ${JSON.stringify(PROBE_TREE_DOCUMENT_NAME)}`);
  }
  const topics = readPresetJsonField(preset, "clarification_action_topics", failures);
  if (JSON.stringify(topics) !== JSON.stringify(PROBE_TREE_CLARIFICATION_TOPICS)) {
    failures.push(`PROMPT-PRESETS.md: clarification_action_topics must be ${PROBE_TREE_CLARIFICATION_TOPICS.join(", ")}`);
  }

  for (const [field, expected] of Object.entries(CONTRACT)) {
    const actual = typeof expected === "number"
      ? readPresetNumberField(preset, field, failures)
      : readPresetJsonField(preset, field, failures);
    if (actual !== expected) failures.push(`PROMPT-PRESETS.md: ${field} must be ${JSON.stringify(expected)}`);
  }

  requireMarkers(probeTree, `${PROBE_TREE_DOCUMENT_NAME} contract`, [
    ...PROBE_TREE_CLARIFICATION_TOPICS,
    "semantic and case-insensitive",
    "capitalization, inflection",
    "literal word is absent",
    "2-4 semantic",
    "distinct missing decision variable",
    "runtime-recognized selected-child terminal continuation",
    "selected child card and its committed Output",
    "active Chat provider, endpoint, and model",
    "query-specific hardcoding",
    "zero-model fallback cards",
  ], failures);
  requireMarkers(preset, "PROMPT-PRESETS.md Probe-Tree projection", [
    `semantic_contract: "${PROBE_TREE_DOCUMENT_NAME}"`,
    ...PROBE_TREE_CLARIFICATION_TOPICS,
    "semantic and case-insensitive",
    "2-4 bounded, editable next-question cards",
    "runtime-recognized selected-child terminal continuation",
    "active Chat provider, endpoint, and model",
    "query-specific hardcoding",
    "zero-model fallback cards",
  ], failures);
  requireMarkers(facts, "FACTS.md prompt preset contract", [
    "probe_tree_contract: \"PROBE-TREE.md\"",
    "semantic_contract_authority: \"PROBE-TREE.md\"",
  ], failures);
  requireMarkers(findTableRow(command, "/knowgrph.probe-tree"), "DICTIONARY-COMMAND.md Probe-Tree row", [
    ...PROBE_TREE_CLARIFICATION_TOPICS,
    "2-4",
    "runtime-recognized selected-child terminal continuation",
    "active Chat provider, endpoint, and model",
    "query-specific hardcoding",
    "zero-model fallback",
  ], failures);
  requireMarkers(findTableRow(semantic, "#knowgrph.probe-tree"), "DICTIONARY-SEMANTIC.md Probe-Tree row", [
    "semantic and case-insensitive",
    "2-4",
    "runtime-recognized selected-child terminal continuation",
  ], failures);
  requireMarkers(findTableRow(binding, "@knowgrph.probe-tree"), "DICTIONARY-BINDING.md Probe-Tree row", [
    "selected child",
    "active Chat provider, endpoint, and model",
    "stale card-local routing",
  ], failures);

  return failures;
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by Probe-Tree contract validation`);
  return "";
}

function extractPreset(text, id) {
  const marker = `  - id: "${id}"`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const end = text.indexOf("\n  - id: \"", start + marker.length);
  return text.slice(start, end < 0 ? undefined : end);
}

function extractFrontmatter(text, name, failures) {
  if (!text.startsWith("---\n")) {
    failures.push(`${name}: missing opening frontmatter delimiter`);
    return "";
  }
  const end = text.indexOf("\n---\n", 4);
  if (end >= 0) return text.slice(4, end);
  failures.push(`${name}: missing closing frontmatter delimiter`);
  return "";
}

function readDocumentJsonField(frontmatter, name, field, failures) {
  const raw = readDocumentField(frontmatter, name, field, failures);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    failures.push(`${name}: ${field} must use JSON-compatible YAML`);
    return undefined;
  }
}

function readDocumentNumberField(frontmatter, name, field, failures) {
  const raw = readDocumentField(frontmatter, name, field, failures);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) failures.push(`${name}: ${field} must be an integer`);
  return value;
}

function readDocumentField(frontmatter, name, field, failures) {
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(field)}:\\s*(.+)$`, "m"));
  if (match) return match[1].trim();
  failures.push(`${name}: missing ${field}`);
  return undefined;
}

function readPresetJsonField(block, field, failures) {
  const raw = readPresetField(block, field, failures);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    failures.push(`PROMPT-PRESETS.md: ${field} must use JSON-compatible YAML`);
    return undefined;
  }
}

function readPresetNumberField(block, field, failures) {
  const raw = readPresetField(block, field, failures);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) failures.push(`PROMPT-PRESETS.md: ${field} must be an integer`);
  return value;
}

function readPresetField(block, field, failures) {
  const match = block.match(new RegExp(`^ {4}${escapeRegExp(field)}:\\s*(.+)$`, "m"));
  if (match) return match[1].trim();
  failures.push(`PROMPT-PRESETS.md: missing ${field}`);
  return undefined;
}

function findTableRow(text, token) {
  return text.split("\n").find((line) => line.startsWith(`| \`${token}\` |`)) ?? "";
}

function requireMarkers(text, label, markers, failures) {
  for (const marker of markers) {
    if (!text.includes(marker)) failures.push(`${label}: missing ${marker}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
