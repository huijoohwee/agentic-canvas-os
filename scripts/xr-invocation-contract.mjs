export const XR_INVOCATION_COMMANDS = Object.freeze([
  "/camera.select",
  "/xr.stage",
  "/xr.place",
  "/xr.transform",
  "/xr.label",
  "/xr.remove",
  "/xr.physics",
  "/xr.present",
]);

export const XR_INVOCATION_SEMANTICS = Object.freeze([
  "#transform",
  "#world",
  "#body",
  "#impulse",
  "#controller",
  "#reticle",
]);

export const XR_INVOCATION_BINDINGS = Object.freeze(["@scene"]);

export const FACTS_COMPACTED_CONTRACTS = Object.freeze({
  layer_contract: Object.freeze({
    soul: "durable agent identity and voice",
    facts: "shared truth and precedence",
    memory: "persistence, routing memory, and reusable local context",
    planning: "bounded index plus append-only cross-repository monthly shards",
    user: "bounded user preferences, communication style, and expectations",
    skills: "on-demand procedural knowledge and progressive disclosure contracts",
    agents: "agent roles, editing rules, and operational behavior",
    dictionaries: "direct token definitions for /, #, and @ invocation grammar",
  }),
  prompt_preset_contract: Object.freeze({
    selection_alias_suffix: "-prompt-preset",
    selection_alias_authority: "PROMPT-PRESETS.md",
    runtime_command_authority: "SKILLS.md and DICTIONARY-COMMAND.md",
    execution_boundary: "selection resolves and loads the source-backed runtime prompt without submit; Send remains the execution boundary",
    semantic_contract_authority: "PROBE-TREE.md",
    invocation_routes: "llm-chat-response uses the active Chat provider, endpoint, and model; native-chat-response uses the named shared runtime; mcp-invocation resolves the matching runtime command through knowgrph.agentic_canvas_os.docs.invoke without executing it",
  }),
});

const COMMAND_MARKERS = Object.freeze({
  "/camera.select": ["exactly `@camera`", "exactly `#camera`", "camera=fixed-follow|free-orbit", "knowgrph.control_local_camera"],
  "/xr.stage": ["@<environment-id>", "no semantic token", "knowgrph.control_local_xr_scene"],
  "/xr.place": ["@<asset-id>", "bounded non-empty label", "linear|hold", "no semantic token", "knowgrph.control_local_xr_scene"],
  "/xr.transform": ["@<subject-id>", "exactly `#transform`", "knowgrph.control_local_xr_scene"],
  "/xr.label": ["@<subject-id>", "bounded non-empty label", "no semantic token", "knowgrph.control_local_xr_scene"],
  "/xr.remove": ["@<subject-id>", "shared scene owner", "no semantic token", "knowgrph.control_local_xr_scene"],
  "/xr.physics": ["exactly `@canvas`", "exactly one of", "`#world`", "`#body`", "`#impulse`", "`#controller`", "single physics owner"],
  "/xr.present": ["exactly `@scene`", "exactly `#reticle`", "active immersive AR placement target"],
});

const SEMANTIC_MARKERS = Object.freeze({
  "#transform": ["/xr.transform", "Scene-authored XR subject", "knowgrph.control_local_xr_scene"],
  "#world": ["/xr.physics @canvas #world", "play", "pause", "stop", "reset", "step", "configure"],
  "#body": ["/xr.physics @canvas #body", "attach", "configure", "detach", "Agentic ECS remains a separate composition lane"],
  "#impulse": ["/xr.physics @canvas #impulse", "x,y,z", "eligible live body"],
  "#controller": ["/xr.physics @canvas #controller", "develop-run", "resume", "select"],
  "#reticle": ["/xr.present @scene #reticle", "current valid reticle", "camera access"],
});

export function validateXrInvocationContractDocuments(documents) {
  const failures = [];
  const command = requireDocument(documents, "DICTIONARY-COMMAND.md", failures);
  const semantic = requireDocument(documents, "DICTIONARY-SEMANTIC.md", failures);
  const binding = requireDocument(documents, "DICTIONARY-BINDING.md", failures);
  const facts = requireDocument(documents, "FACTS.md", failures);
  if (failures.length > 0) return failures;

  for (const [field, expected] of Object.entries(FACTS_COMPACTED_CONTRACTS)) {
    const actual = readJsonFrontmatterField(facts, field, failures);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`FACTS.md: compacted ${field} must preserve the canonical parsed value`);
    }
  }
  const truthTokens = {
    commands: readJsonFrontmatterArray(facts, "commands", failures),
    semantics: readJsonFrontmatterArray(facts, "semantics", failures),
    bindings: readJsonFrontmatterArray(facts, "bindings", failures),
  };
  for (const [field, tokens] of Object.entries({
    commands: XR_INVOCATION_COMMANDS,
    semantics: XR_INVOCATION_SEMANTICS,
    bindings: XR_INVOCATION_BINDINGS,
  })) {
    for (const token of tokens) {
      if (!truthTokens[field]?.includes(token)) failures.push(`FACTS.md: truth_tokens.${field} missing ${token}`);
    }
  }

  for (const token of XR_INVOCATION_COMMANDS) {
    requireDictionaryToken(command, facts, "DICTIONARY-COMMAND.md", token, failures);
    requireMarkers(findTableRow(command, token), `DICTIONARY-COMMAND.md ${token} row`, COMMAND_MARKERS[token], failures);
  }
  for (const token of XR_INVOCATION_SEMANTICS) {
    requireDictionaryToken(semantic, facts, "DICTIONARY-SEMANTIC.md", token, failures);
    requireMarkers(findTableRow(semantic, token), `DICTIONARY-SEMANTIC.md ${token} row`, SEMANTIC_MARKERS[token], failures);
  }
  for (const token of XR_INVOCATION_BINDINGS) {
    requireDictionaryToken(binding, facts, "DICTIONARY-BINDING.md", token, failures);
    requireMarkers(findTableRow(binding, token), `DICTIONARY-BINDING.md ${token} row`, [
      "Current canonical XR scene",
      "Browser-local Knowgrph",
      "no camera or sensor grant",
      "no duplicate renderer",
    ], failures);
  }

  requireMarkers(findTableRow(semantic, "#camera"), "DICTIONARY-SEMANTIC.md #camera row", [
    "source selection",
    "/camera.select",
  ], failures);
  requireMarkers(findPlainTableRow(facts, "Camera and XR scene invocation catalog"), "FACTS.md Camera and XR scene boundary", [
    "knowgrph.control_local_camera",
    "knowgrph.control_local_xr_scene",
    "Agentic ECS stays a separate three-tool stdio/KGC composition lane",
    "no renderer or physics ownership",
  ], failures);

  return failures;
}

function requireDictionaryToken(document, facts, documentName, token, failures) {
  if (!document.includes(`  - "${token}"`)) failures.push(`${documentName}: missing dictionary entry ${token}`);
  if (!findTableRow(document, token)) failures.push(`${documentName}: missing table row ${token}`);
  const separator = "#";
  if (!facts.includes(`  "${token}": "${documentName}${separator}${token}"`)) {
    failures.push(`FACTS.md: missing direct resolution ${token}`);
  }
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by Camera and XR invocation contract validation`);
  return "";
}

function findTableRow(text, token) {
  return text.split("\n").find((line) => line.startsWith(`| \`${token}\` |`)) || "";
}

function findPlainTableRow(text, label) {
  return text.split("\n").find((line) => line.startsWith(`| ${label} |`)) || "";
}

function readJsonFrontmatterField(text, field, failures) {
  const match = text.match(new RegExp(`^${field}:\\s*(?:\\n  )?(\\{.*\\})$`, "m"));
  if (!match) {
    failures.push(`FACTS.md: missing JSON-compatible ${field}`);
    return undefined;
  }
  try {
    const jsonCompatible = match[1].replace(/([{,]\s*)([a-z_]+)\s*:/g, '$1"$2":');
    return JSON.parse(jsonCompatible);
  } catch {
    failures.push(`FACTS.md: ${field} must remain JSON-compatible YAML`);
    return undefined;
  }
}

function readJsonFrontmatterArray(text, field, failures) {
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

function requireMarkers(text, label, markers, failures) {
  for (const marker of markers) if (!text.includes(marker)) failures.push(`${label}: missing ${marker}`);
}
