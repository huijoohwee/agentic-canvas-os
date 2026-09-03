export const URL_INGEST_INVOCATION = Object.freeze({
  command: "/ingest-url",
  bindings: Object.freeze(["@url:", "@reference-policy"]),
  semantic: "#canvas",
  skill: "url.ingest",
  text: "/ingest-url @url:https://example.com @reference-policy #canvas",
  discoveryTool: "agentic-graph.agentic_canvas_os.docs.invoke",
  executionTool: "agentic-graph.control_local_import_url",
});

const FORBIDDEN_ALIASES = Object.freeze([
  "/import-url",
  "/url.import",
  "@import-url",
  "#url-import",
]);

export function validateUrlIngestContractDocuments(documents) {
  const failures = [];
  const required = Object.fromEntries([
    "FACTS.md",
    "DICTIONARY-COMMAND.md",
    "DICTIONARY-SEMANTIC.md",
    "DICTIONARY-BINDING.md",
    "SKILLS.md",
    "MCP-GATEWAY.md",
    "RUNTIME-PROOF.md",
  ].map((name) => [name, requireDocument(documents, name, failures)]));
  if (failures.length > 0) return failures;

  requireDictionaryToken(
    required["DICTIONARY-COMMAND.md"],
    URL_INGEST_INVOCATION.command,
    "DICTIONARY-COMMAND.md",
    5,
    failures,
  );
  requireDictionaryToken(
    required["DICTIONARY-SEMANTIC.md"],
    URL_INGEST_INVOCATION.semantic,
    "DICTIONARY-SEMANTIC.md",
    4,
    failures,
  );
  for (const binding of URL_INGEST_INVOCATION.bindings) {
    requireDictionaryToken(
      required["DICTIONARY-BINDING.md"],
      binding,
      "DICTIONARY-BINDING.md",
      4,
      failures,
    );
  }

  const facts = required["FACTS.md"];
  requireCount(
    facts,
    `  "${URL_INGEST_INVOCATION.command}": "DICTIONARY-COMMAND.md#${URL_INGEST_INVOCATION.command}"`,
    1,
    "FACTS.md direct resolution",
    failures,
  );
  const truthCommands = readTruthTokenArray(facts, "commands", failures);
  if (!truthCommands?.includes(URL_INGEST_INVOCATION.command)) {
    failures.push(`FACTS.md: truth token catalog missing ${URL_INGEST_INVOCATION.command}`);
  }
  requireMarkers(facts, "FACTS.md Import URL owner boundary", [
    URL_INGEST_INVOCATION.text,
    URL_INGEST_INVOCATION.discoveryTool,
    "read-only discovery",
    URL_INGEST_INVOCATION.executionTool,
  ], failures);

  const commandRow = findTableRows(
    required["DICTIONARY-COMMAND.md"],
    URL_INGEST_INVOCATION.command,
  )[0] || "";
  const commandCells = splitMarkdownTableRow(commandRow);
  requireMarkers(commandRow, "DICTIONARY-COMMAND.md /ingest-url row", [
    "Import one operator-provided URL",
    ...URL_INGEST_INVOCATION.bindings,
    URL_INGEST_INVOCATION.semantic,
    URL_INGEST_INVOCATION.text,
    URL_INGEST_INVOCATION.discoveryTool,
    "metadata only",
    URL_INGEST_INVOCATION.executionTool,
    "guarded browser WebMCP",
    "typed imported, blocked, or failed result",
    "without a second importer",
    "Prod mutation",
    "Cloudflare deployment",
  ], failures);
  requireExactCell(
    commandCells[2],
    "exactly one `@url:` value and `@reference-policy`",
    "DICTIONARY-COMMAND.md /ingest-url bindings",
    failures,
  );
  requireExactCell(
    commandCells[3],
    "exactly `#canvas`",
    "DICTIONARY-COMMAND.md /ingest-url semantic",
    failures,
  );

  const urlBindingRow = findTableRows(
    required["DICTIONARY-BINDING.md"],
    "@url:",
  )[0] || "";
  requireMarkers(urlBindingRow, "DICTIONARY-BINDING.md @url: row", [
    "source import",
    "@reference-policy",
    "egress policy",
    "cache/citation metadata",
    "size bounds",
    "no credentials",
  ], failures);

  const skills = required["SKILLS.md"];
  requireCount(
    skills,
    `  - "${URL_INGEST_INVOCATION.skill}"`,
    1,
    "SKILLS.md skill id",
    failures,
  );
  requireMarkers(skills, "SKILLS.md URL ingest route", [
    URL_INGEST_INVOCATION.skill,
    URL_INGEST_INVOCATION.text,
    URL_INGEST_INVOCATION.discoveryTool,
    "read-only discovery metadata",
    URL_INGEST_INVOCATION.executionTool,
    "sole Import URL executor",
  ], failures);

  requireMarkers(required["MCP-GATEWAY.md"], "MCP discovery boundary", [
    URL_INGEST_INVOCATION.discoveryTool,
    "Read-only discovery",
    `never executes \`${URL_INGEST_INVOCATION.command}\``,
  ], failures);
  requireMarkers(required["RUNTIME-PROOF.md"], "Import URL proof boundary", [
    URL_INGEST_INVOCATION.text,
    URL_INGEST_INVOCATION.skill,
    URL_INGEST_INVOCATION.executionTool,
    "integrated agentic-graph browser execution and persistence proof remain separate",
  ], failures);

  for (const alias of FORBIDDEN_ALIASES) {
    for (const [name, text] of Object.entries(required)) {
      if (text.includes(alias)) {
        failures.push(`${name}: Import URL invocation contract forbids alias ${alias}`);
      }
    }
  }

  return failures;
}

function requireDictionaryToken(text, token, name, columns, failures) {
  requireCount(text, `  - "${token}"`, 1, `${name} dictionary entry`, failures);
  const rows = findTableRows(text, token)
    .filter((row) => splitMarkdownTableRow(row).length === columns);
  if (rows.length !== 1) failures.push(`${name}: expected exactly one table row ${token}`);
  requireTableShape(rows[0] || "", `${name} ${token} row`, columns, failures);
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by URL ingest contract validation`);
  return "";
}

function readTruthTokenArray(text, field, failures) {
  const match = text.match(new RegExp(`^  ${field}:\\s*(\\[.*\\])$`, "m"));
  if (!match) {
    failures.push(`FACTS.md: missing truth_tokens.${field}`);
    return undefined;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    failures.push(`FACTS.md: truth_tokens.${field} must remain a JSON-compatible array`);
    return undefined;
  }
}

function findTableRows(text, token) {
  return text.split("\n").filter((line) => line.startsWith(`| \`${token}\` |`));
}

function requireTableShape(row, label, expectedColumns, failures) {
  if (!row) return;
  const actualColumns = splitMarkdownTableRow(row).length;
  if (actualColumns !== expectedColumns) {
    failures.push(`${label}: expected ${expectedColumns} Markdown table columns, found ${actualColumns}`);
  }
}

function splitMarkdownTableRow(row) {
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of row.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      cell += character;
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function requireMarkers(text, label, markers, failures) {
  for (const marker of markers) {
    if (!text.includes(marker)) failures.push(`${label}: missing ${marker}`);
  }
}

function requireCount(text, value, expected, label, failures) {
  const actual = text.split(value).length - 1;
  if (actual !== expected) failures.push(`${label}: expected ${expected} occurrence(s) of ${value}, found ${actual}`);
}

function requireExactCell(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual || "(missing)"}`);
}
