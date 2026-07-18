const MCP_TOOL = "knowgrph.agentic_canvas_os.docs.invoke";
const ACTIVE_CHAT_ROUTE = "active Chat provider, endpoint, and model";

export const REQUIRED_PROMPT_PRESET_IDS = Object.freeze([
  "video-agent",
  "image-to-threejs",
  "image-to-glb",
  "knowgrph-probe-tree",
  "sme-care-agent",
  "investment-research-agent",
  "crawler-agent",
  "sme-risk-assessment",
  "sme-protection-comparison",
  "investment-options-comparison",
  "investment-plan-assessment",
]);

const LLM_RESPONSE_PRESET_IDS = new Set([
  "video-agent",
  "knowgrph-probe-tree",
  "sme-care-agent",
  "investment-research-agent",
  "sme-risk-assessment",
  "sme-protection-comparison",
  "investment-options-comparison",
  "investment-plan-assessment",
]);

const NATIVE_RESPONSE_PRESET_IDS = new Set(["image-to-threejs", "image-to-glb", "crawler-agent"]);

const SEMANTIC_EXTENSION_MARKERS = Object.freeze({
  "sme-risk-assessment": ["active request and workspace sources", "ask one focused clarification", "do not invent"],
  "sme-protection-comparison": ["user-named SME protection choices", "Ask a focused clarification", "Do not fabricate"],
  "investment-options-comparison": ["options named by the user", "ask one focused clarification", "without inventing"],
  "investment-plan-assessment": ["user-named objective", "Ask one focused clarification", "Do not invent"],
});

export function validatePromptPresetContractDocuments(documents) {
  const failures = [];
  const catalog = requireDocument(documents, "PROMPT-PRESETS.md", failures);
  const facts = requireDocument(documents, "FACTS.md", failures);
  const command = requireDocument(documents, "DICTIONARY-COMMAND.md", failures);
  const skills = requireDocument(documents, "SKILLS.md", failures);
  if (failures.length > 0) return failures;

  const presets = extractPresets(catalog);
  if (presets.length < REQUIRED_PROMPT_PRESET_IDS.length) {
    failures.push(`PROMPT-PRESETS.md: expected at least ${REQUIRED_PROMPT_PRESET_IDS.length} source-backed presets`);
  }

  const ids = new Set();
  const aliases = new Set();
  for (const preset of presets) {
    const id = readStringField(preset, "id", failures);
    const alias = readStringField(preset, "slash_command", failures, id);
    const runtimeCommand = readStringField(preset, "runtime_command", failures, id);
    const chatRoute = readStringField(preset, "chat_route", failures, id);
    const mcpTool = readStringField(preset, "mcp_tool", failures, id);
    const mcpToken = readStringField(preset, "mcp_token", failures, id);
    const invocationModes = readJsonField(preset, "invocation_modes", failures, id);

    if (ids.has(id)) failures.push(`PROMPT-PRESETS.md: duplicate preset id ${id}`);
    if (aliases.has(alias)) failures.push(`PROMPT-PRESETS.md: duplicate preset alias ${alias}`);
    ids.add(id);
    aliases.add(alias);

    const responseMode = Array.isArray(invocationModes) ? invocationModes[0] : "";
    if (!["llm-chat-response", "native-chat-response"].includes(responseMode)
      || invocationModes?.length !== 2
      || invocationModes[1] !== "mcp-invocation") {
      failures.push(`PROMPT-PRESETS.md: ${id} invocation_modes must declare one Chat response mode followed by mcp-invocation`);
    }
    if (LLM_RESPONSE_PRESET_IDS.has(id) && responseMode !== "llm-chat-response") {
      failures.push(`PROMPT-PRESETS.md: ${id} must use llm-chat-response`);
    }
    if (NATIVE_RESPONSE_PRESET_IDS.has(id) && responseMode !== "native-chat-response") {
      failures.push(`PROMPT-PRESETS.md: ${id} must use native-chat-response`);
    }
    const expectedChatRoute = responseMode === "llm-chat-response" ? ACTIVE_CHAT_ROUTE : "active native shared runtime";
    if (chatRoute !== expectedChatRoute) failures.push(`PROMPT-PRESETS.md: ${id} chat_route must be ${expectedChatRoute}`);
    if (mcpTool !== MCP_TOOL) failures.push(`PROMPT-PRESETS.md: ${id} mcp_tool must be ${MCP_TOOL}`);
    if (mcpToken !== runtimeCommand) failures.push(`PROMPT-PRESETS.md: ${id} mcp_token must equal runtime_command`);
    requireRuntimeCommand(runtimeCommand, facts, command, failures, id);

    for (const marker of SEMANTIC_EXTENSION_MARKERS[id] ?? []) {
      if (!preset.includes(marker)) failures.push(`PROMPT-PRESETS.md: ${id} must remain generic and include ${marker}`);
    }
  }

  for (const id of REQUIRED_PROMPT_PRESET_IDS) {
    if (!ids.has(id)) failures.push(`PROMPT-PRESETS.md: missing required preset ${id}`);
  }

  requireMarkers(facts, "FACTS.md prompt preset invocation contract", [
    `invocation_routes: "llm-chat-response uses the ${ACTIVE_CHAT_ROUTE}`,
    MCP_TOOL,
  ], failures);
  requireMarkers(skills, "SKILLS.md prompt preset runtime owners", [
    "agent.investment-research",
    "agent.sme-care",
    "agent.video",
    "agent.crawler",
    "/investment-research-agent",
    "/sme-care-agent",
    "/video-agent",
    "/crawler-agent",
  ], failures);
  return failures;
}

function extractPresets(text) {
  const starts = [...text.matchAll(/^  - id: "/gm)].map((match) => match.index);
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.indexOf("\n---\n", start)));
}

function readStringField(block, field, failures, id = "preset") {
  const raw = readField(block, field, failures, id);
  if (raw === undefined) return "";
  try {
    const value = JSON.parse(raw);
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {}
  failures.push(`PROMPT-PRESETS.md: ${id} ${field} must be a non-empty quoted string`);
  return "";
}

function readJsonField(block, field, failures, id) {
  const raw = readField(block, field, failures, id);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    failures.push(`PROMPT-PRESETS.md: ${id} ${field} must use JSON-compatible YAML`);
    return undefined;
  }
}

function readField(block, field, failures, id) {
  const prefix = field === "id" ? " {2}- " : " {4}";
  const match = block.match(new RegExp(`^${prefix}${escapeRegExp(field)}:\\s*(.+)$`, "m"));
  if (match) return match[1].trim();
  failures.push(`PROMPT-PRESETS.md: ${id} missing ${field}`);
  return undefined;
}

function requireRuntimeCommand(token, facts, command, failures, id) {
  if (!/^\/[a-z0-9][a-z0-9.-]*$/.test(token)) {
    failures.push(`PROMPT-PRESETS.md: ${id} has invalid runtime command ${token || "(empty)"}`);
    return;
  }
  if (!command.includes(`  - "${token}"`)) failures.push(`DICTIONARY-COMMAND.md: missing dictionary entry ${token}`);
  if (!command.split("\n").some((line) => line.startsWith(`| \`${token}\` |`))) {
    failures.push(`DICTIONARY-COMMAND.md: missing command row ${token}`);
  }
  if (!facts.includes(`  "${token}": "DICTIONARY-COMMAND.md#${token}"`)) {
    failures.push(`FACTS.md: missing direct resolution ${token}`);
  }
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by prompt preset contract validation`);
  return "";
}

function requireMarkers(text, label, markers, failures) {
  for (const marker of markers) if (!text.includes(marker)) failures.push(`${label}: missing ${marker}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
