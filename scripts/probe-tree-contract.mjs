const PROBE_TREE_PRESET_ID = "knowgrph-probe-tree";

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
  const promptPresets = requireDocument(documents, "PROMPT-PRESETS.md", failures);
  const facts = requireDocument(documents, "FACTS.md", failures);
  const command = requireDocument(documents, "DICTIONARY-COMMAND.md", failures);
  const semantic = requireDocument(documents, "DICTIONARY-SEMANTIC.md", failures);
  const binding = requireDocument(documents, "DICTIONARY-BINDING.md", failures);
  if (failures.length > 0) return failures;

  const preset = extractPreset(promptPresets, PROBE_TREE_PRESET_ID);
  if (!preset) return [`PROMPT-PRESETS.md: missing ${PROBE_TREE_PRESET_ID} preset`];

  const topics = readJsonField(preset, "clarification_action_topics", failures);
  if (JSON.stringify(topics) !== JSON.stringify(PROBE_TREE_CLARIFICATION_TOPICS)) {
    failures.push(`PROMPT-PRESETS.md: clarification_action_topics must be ${PROBE_TREE_CLARIFICATION_TOPICS.join(", ")}`);
  }

  for (const [field, expected] of Object.entries(CONTRACT)) {
    const actual = typeof expected === "number"
      ? readNumberField(preset, field, failures)
      : readJsonField(preset, field, failures);
    if (actual !== expected) failures.push(`PROMPT-PRESETS.md: ${field} must be ${JSON.stringify(expected)}`);
  }

  requireMarkers(preset, "PROMPT-PRESETS.md Probe-Tree preset", [
    ...PROBE_TREE_CLARIFICATION_TOPICS,
    "semantic and case-insensitive",
    "2-4 bounded, editable next-question cards",
    "runtime-recognized selected-child terminal continuation",
    "active Chat provider, endpoint, and model",
    "query-specific hardcoding",
    "zero-model fallback cards",
  ], failures);
  requireMarkers(facts, "FACTS.md prompt preset contract", [
    "semantic_contract_authority: \"PROMPT-PRESETS.md prompt preset entry fields\"",
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

function readJsonField(block, field, failures) {
  const raw = readField(block, field, failures);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    failures.push(`PROMPT-PRESETS.md: ${field} must use JSON-compatible YAML`);
    return undefined;
  }
}

function readNumberField(block, field, failures) {
  const raw = readField(block, field, failures);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) failures.push(`PROMPT-PRESETS.md: ${field} must be an integer`);
  return value;
}

function readField(block, field, failures) {
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
