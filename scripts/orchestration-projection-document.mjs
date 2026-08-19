// Responsibility: Render orchestration projection values as importable Markdown and read their digest subject back.
const FRONTMATTER_KEYS = Object.freeze([
  "title",
  "graphId",
  "doc_type",
  "date",
  "lang",
  "schema",
  "frontmatter_contract",
  "status",
  "publish_policy",
  "canvas2dRenderer",
  "kgCanvas2dRenderer",
  "observedAt",
  "stalenessBoundSeconds",
  "stageAxis",
  "inputs",
  "lanes",
  "nodes",
]);

export function renderProjectionDocument(value, digest) {
  const lines = ["---"];
  const withDigest = { ...value, projection_digest: digest };
  for (const key of FRONTMATTER_KEYS) appendYaml(lines, key, withDigest[key]);
  appendYaml(lines, "projection_digest", digest);
  lines.push("---", "", "# Orchestration Projection", "", "This Dev-only projection renders coordination receipt progress as Storyboard cards.", "", "~~~json", JSON.stringify(value), "~~~");
  return lines.join("\n") + "\n";
}

export function projectionDigestSubject(text) {
  return String(text || "").replace(/^projection_digest: .*$/mu, "projection_digest:");
}

export function readProjectionCanonicalValue(text) {
  const match = String(text || "").match(/~~~json\n([^\n]+)\n~~~/u);
  if (!match) throw new Error("Projection document is missing canonical JSON.");
  return JSON.parse(match[1]);
}

function appendYaml(lines, key, value, indent = "") {
  if (Array.isArray(value)) {
    lines.push(indent + key + ":");
    for (const item of value) appendYamlArrayItem(lines, item, indent + "  ");
    return;
  }
  if (value && typeof value === "object") {
    lines.push(indent + key + ":");
    for (const [childKey, childValue] of Object.entries(value)) appendYaml(lines, childKey, childValue, indent + "  ");
    return;
  }
  lines.push(indent + key + ": " + formatScalar(value));
}

function appendYamlArrayItem(lines, item, indent) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const entries = Object.entries(item);
    const [firstKey, firstValue] = entries[0];
    lines.push(indent + "- " + firstKey + ": " + formatScalar(firstValue));
    for (const [key, value] of entries.slice(1)) appendYaml(lines, key, value, indent + "  ");
    return;
  }
  lines.push(indent + "- " + formatScalar(item));
}

function formatScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value ?? ""));
}
