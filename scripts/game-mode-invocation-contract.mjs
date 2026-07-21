export const GAME_MODE_INVOCATION = Object.freeze({
  command: "/game.mode",
  semantic: "#gameplay",
  binding: "@canvas",
  invocation: "/game.mode @canvas #gameplay",
});

export const GAME_MODE_WEB_MCP_TOOLS = Object.freeze([
  "knowgrph.inspect_local_game_mode",
  "knowgrph.control_local_game_mode",
]);

const FORBIDDEN_ALIASES = Object.freeze(["/game.fps", "#game-mode"]);

const DOCUMENT_BY_TOKEN = Object.freeze({
  [GAME_MODE_INVOCATION.command]: "DICTIONARY-COMMAND.md",
  [GAME_MODE_INVOCATION.semantic]: "DICTIONARY-SEMANTIC.md",
  [GAME_MODE_INVOCATION.binding]: "DICTIONARY-BINDING.md",
});

export function validateGameModeInvocationContractDocuments(documents) {
  const failures = [];
  const command = requireDocument(documents, "DICTIONARY-COMMAND.md", failures);
  const semantic = requireDocument(documents, "DICTIONARY-SEMANTIC.md", failures);
  const binding = requireDocument(documents, "DICTIONARY-BINDING.md", failures);
  const facts = requireDocument(documents, "FACTS.md", failures);
  if (failures.length > 0) return failures;

  const truthTokens = {
    commands: readTruthTokenArray(facts, "commands", failures),
    semantics: readTruthTokenArray(facts, "semantics", failures),
    bindings: readTruthTokenArray(facts, "bindings", failures),
  };
  const tokenContracts = [
    [GAME_MODE_INVOCATION.command, command, "commands", 5],
    [GAME_MODE_INVOCATION.semantic, semantic, "semantics", 4],
    [GAME_MODE_INVOCATION.binding, binding, "bindings", 4],
  ];
  for (const [token, dictionary, truthField, columns] of tokenContracts) {
    requireCanonicalToken({ token, dictionary, facts, truthTokens: truthTokens[truthField], columns, failures });
  }

  const commandRow = findTableRows(command, GAME_MODE_INVOCATION.command)[0] || "";
  requireMarkers(commandRow, "DICTIONARY-COMMAND.md /game.mode row", [
    "deterministic Agentic ECS gameplay",
    "exactly `@canvas`",
    "exactly `#gameplay`",
    ...GAME_MODE_WEB_MCP_TOOLS,
    "Knowgrph remains the single game, ECS, renderer, camera/input, and Decision-persistence owner",
    "no runtime or deployment authority",
  ], failures);

  const semanticRow = findTableRows(semantic, GAME_MODE_INVOCATION.semantic)[0] || "";
  requireMarkers(semanticRow, "DICTIONARY-SEMANTIC.md #gameplay row", [
    "scored Agentic ECS decisions",
    GAME_MODE_INVOCATION.invocation,
    ...GAME_MODE_WEB_MCP_TOOLS,
    "existing Canvas, XR Mode, Motion Control, ECS, and workspace owners",
    "no model, network, renderer, camera, persistence, Prod, or Cloudflare authority",
  ], failures);

  const bindingRow = findTableRows(binding, GAME_MODE_INVOCATION.binding)[0] || "";
  requireMarkers(bindingRow, "DICTIONARY-BINDING.md @canvas row", [
    "Source-backed Canvas projection",
    "Existing Source Files",
    "No dashboard-only graph store or renderer fork",
  ], failures);

  const factRow = findPlainTableRow(facts, "Game Mode invocation catalog");
  requireTableShape(factRow, "FACTS.md Game Mode invocation catalog row", 3, failures);
  requireMarkers(factRow, "FACTS.md Game Mode invocation catalog row", [
    GAME_MODE_INVOCATION.invocation,
    "Dev-only browser-local",
    "Knowgrph WebMCP owns",
    "scored `hold`, `alert`, `engage`, or `flee` decisions",
    "existing Canvas and XR Mode renderer",
    "Motion Control input reuse",
    "validated Decision-only persistence",
    "without a model, network dependency, second renderer, Prod mutation, or Cloudflare deployment",
    ...GAME_MODE_WEB_MCP_TOOLS,
  ], failures);

  for (const alias of FORBIDDEN_ALIASES) {
    if ([command, semantic, facts].some((document) => document.includes(alias))) {
      failures.push(`Game Mode invocation contract forbids alias ${alias}`);
    }
  }

  return failures;
}

function requireCanonicalToken({ token, dictionary, facts, truthTokens, columns, failures }) {
  const dictionaryEntry = `  - "${token}"`;
  if (countOccurrences(dictionary, dictionaryEntry) !== 1) {
    failures.push(`${DOCUMENT_BY_TOKEN[token]}: expected exactly one dictionary entry ${token}`);
  }
  const rows = findTableRows(dictionary, token);
  if (rows.length !== 1) failures.push(`${DOCUMENT_BY_TOKEN[token]}: expected exactly one table row ${token}`);
  requireTableShape(rows[0] || "", `${DOCUMENT_BY_TOKEN[token]} ${token} row`, columns, failures);
  const directResolution = `  "${token}": "${DOCUMENT_BY_TOKEN[token]}#${token}"`;
  if (countOccurrences(facts, directResolution) !== 1) {
    failures.push(`FACTS.md: expected exactly one direct resolution ${token}`);
  }
  if (!truthTokens?.includes(token)) failures.push(`FACTS.md: truth token catalog missing ${token}`);
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by Game Mode invocation contract validation`);
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

function findPlainTableRow(text, label) {
  return text.split("\n").find((line) => line.startsWith(`| ${label} |`)) || "";
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

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}
