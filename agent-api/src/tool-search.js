import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_TOOLS = 256;
const DEFAULT_MAX_TOOLS_PER_NAMESPACE = 9;
const DEFAULT_MAX_RESULTS_PER_SEARCH = 8;
const DEFAULT_MAX_SEARCHES_PER_SESSION = 16;
const DEFAULT_MAX_SCHEMA_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const EXECUTION_MODES = new Set(["client", "hosted"]);
const TOOL_CALLERS = new Set(["direct", "programmatic"]);
const TOOL_TYPE = "function";

class ToolSearchBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "ToolSearchBlock";
    this.reasonCode = reasonCode;
  }
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("capabilities must be an object.");
  }
  const required = ["toolSearch", "clientSearch", "hostedSearch", "namespaces"];
  for (const field of required) {
    if (typeof value[field] !== "boolean") throw new TypeError(`capabilities.${field} must be boolean.`);
  }
  return Object.freeze(Object.fromEntries(required.map((field) => [field, value[field]])));
}

function normalizeObjectSchema(value, field) {
  const schema = normalizeJson(value, field);
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") {
    throw new TypeError(`${field} must be an object schema.`);
  }
  return schema;
}

function normalizeAllowedCallers(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  const callers = [...new Set(value)];
  for (const caller of callers) {
    if (!TOOL_CALLERS.has(caller)) throw new TypeError(`${field} contains unsupported caller ${String(caller)}.`);
  }
  return Object.freeze(callers);
}

function normalizeNamespaces(value) {
  if (!Array.isArray(value)) throw new TypeError("namespaces must be an array.");
  const names = new Set();
  return Object.freeze(value.map((namespace, index) => {
    if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) {
      throw new TypeError(`namespaces[${index}] must be an object.`);
    }
    const name = assertIdentifier(namespace.name, `namespaces[${index}].name`);
    if (names.has(name)) throw new TypeError(`Duplicate namespace name: ${name}.`);
    names.add(name);
    return Object.freeze({
      name,
      description: assertIdentifier(namespace.description, `namespaces[${index}].description`),
    });
  }));
}

function normalizeTools(value, namespaceNames, { maxTools, maxToolsPerNamespace, maxSchemaChars }) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("tools must be a non-empty array.");
  if (value.length > maxTools) throw new RangeError(`tools must contain at most ${maxTools} entries.`);
  const names = new Set();
  const namespaceCounts = new Map();
  let schemaChars = 0;
  const tools = value.map((tool, index) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new TypeError(`tools[${index}] must be an object.`);
    }
    if (tool.type !== TOOL_TYPE) throw new TypeError(`tools[${index}].type must be ${TOOL_TYPE}.`);
    const name = assertIdentifier(tool.name, `tools[${index}].name`);
    if (names.has(name)) throw new TypeError(`Duplicate tool name: ${name}.`);
    names.add(name);
    const namespace = tool.namespace === undefined ? "" : assertIdentifier(tool.namespace, `tools[${index}].namespace`);
    if (namespace && !namespaceNames.has(namespace)) {
      throw new TypeError(`tools[${index}].namespace is not declared: ${namespace}.`);
    }
    if (namespace) {
      const count = (namespaceCounts.get(namespace) || 0) + 1;
      if (count > maxToolsPerNamespace) {
        throw new RangeError(`Namespace ${namespace} exceeds ${maxToolsPerNamespace} tools.`);
      }
      namespaceCounts.set(namespace, count);
    }
    if (typeof tool.deferLoading !== "boolean") {
      throw new TypeError(`tools[${index}].deferLoading must be boolean.`);
    }
    if (namespace && !tool.deferLoading) {
      throw new TypeError(`Namespaced tool ${name} must defer loading as a group.`);
    }
    if (typeof tool.strict !== "boolean") throw new TypeError(`tools[${index}].strict must be boolean.`);
    const parameters = normalizeObjectSchema(tool.parameters, `tools[${index}].parameters`);
    schemaChars += serializedJsonLength(parameters);
    if (schemaChars > maxSchemaChars) throw new RangeError(`Tool schemas exceed ${maxSchemaChars} characters.`);
    return Object.freeze({
      type: TOOL_TYPE,
      name,
      description: assertIdentifier(tool.description, `tools[${index}].description`),
      namespace,
      deferLoading: tool.deferLoading,
      parameters,
      strict: tool.strict,
      allowedCallers: normalizeAllowedCallers(tool.allowedCallers, `tools[${index}].allowedCallers`),
    });
  });
  return Object.freeze({ tools: Object.freeze(tools), schemaChars });
}

function fullDefinition(tool) {
  return Object.freeze({
    type: tool.type,
    name: tool.name,
    description: tool.description,
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    parameters: tool.parameters,
    strict: tool.strict,
    allowedCallers: tool.allowedCallers,
  });
}

function adapterDefinition(tool) {
  return Object.freeze({ ...fullDefinition(tool), deferLoading: tool.deferLoading });
}

function deferredMetadata(tool) {
  return Object.freeze({
    type: tool.type,
    name: tool.name,
    description: tool.description,
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
  });
}

function buildDeferredSurfaces(namespaces, tools) {
  const deferred = tools.filter((tool) => tool.deferLoading);
  const grouped = new Map();
  for (const tool of deferred) {
    if (!tool.namespace) continue;
    const existing = grouped.get(tool.namespace) || [];
    existing.push(tool);
    grouped.set(tool.namespace, existing);
  }
  const surfaces = [];
  for (const namespace of namespaces) {
    const members = grouped.get(namespace.name);
    if (!members) continue;
    surfaces.push(Object.freeze({
      type: "namespace",
      name: namespace.name,
      description: namespace.description,
      toolCount: members.length,
    }));
  }
  for (const tool of deferred) {
    if (!tool.namespace) surfaces.push(deferredMetadata(tool));
  }
  return Object.freeze(surfaces);
}

function normalizeCostLog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolSearchBlock("cost_log_missing", "Search resolution must include a cost log.");
  }
  const model = assertIdentifier(value.model, "costLog.model");
  const result = { model };
  for (const field of ["prompt_tokens", "completion_tokens", "cache_hits"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new ToolSearchBlock("cost_log_invalid", `costLog.${field} must be a non-negative integer.`);
    }
    result[field] = value[field];
  }
  if (!Number.isFinite(value.estimated_cost_usd) || value.estimated_cost_usd < 0) {
    throw new ToolSearchBlock("cost_log_invalid", "costLog.estimated_cost_usd must be non-negative.");
  }
  result.estimated_cost_usd = value.estimated_cost_usd;
  return Object.freeze(result);
}

function zeroCostLog() {
  return Object.freeze({
    model: "not-run",
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_hits: 0,
    estimated_cost_usd: 0,
  });
}

function unreportedCostLog() {
  return Object.freeze({
    model: "unreported",
    prompt_tokens: null,
    completion_tokens: null,
    cache_hits: null,
    estimated_cost_usd: null,
  });
}

function blockedResult(sessionId, stage, reasonCode, message, costLog = zeroCostLog()) {
  return Object.freeze({ sessionId, status: "blocked", stage, reasonCode, message, costLog });
}

function normalizeLoadedNames(value, session, limit) {
  if (!Array.isArray(value)) throw new ToolSearchBlock("search_result_invalid", "toolNames must be an array.");
  if (value.length > limit) throw new ToolSearchBlock("search_result_limit", `Search returned more than ${limit} tools.`);
  const names = value.map((name, index) => assertIdentifier(name, `toolNames[${index}]`));
  if (new Set(names).size !== names.length) {
    throw new ToolSearchBlock("search_result_invalid", "Search returned duplicate tool names.");
  }
  for (const name of names) {
    const tool = session.toolsByName.get(name);
    if (!tool || !tool.deferLoading) {
      throw new ToolSearchBlock("tool_not_deferred", `Search returned an unavailable deferred tool: ${name}.`);
    }
    if (session.loadedNames.has(name)) {
      throw new ToolSearchBlock("tool_already_loaded", `Search returned an already loaded tool: ${name}.`);
    }
  }
  return Object.freeze(names);
}

function loadNames(session, names) {
  for (const name of names) session.loadedNames.add(name);
  return Object.freeze(names.map((name) => fullDefinition(session.toolsByName.get(name))));
}

function candidateMetadata(session) {
  return Object.freeze(
    [...session.toolsByName.values()]
      .filter((tool) => tool.deferLoading && !session.loadedNames.has(tool.name))
      .map(deferredMetadata),
  );
}

async function runWithTimeout(callback, input, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      callback(Object.freeze({ ...input, signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ToolSearchBlock("search_timeout", `Tool search exceeded ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createToolSearchRuntime({
  searchDeferredTools,
  maxSessions = DEFAULT_MAX_SESSIONS,
  maxTools = DEFAULT_MAX_TOOLS,
  maxToolsPerNamespace = DEFAULT_MAX_TOOLS_PER_NAMESPACE,
  maxResultsPerSearch = DEFAULT_MAX_RESULTS_PER_SEARCH,
  maxSearchesPerSession = DEFAULT_MAX_SEARCHES_PER_SESSION,
  maxSchemaChars = DEFAULT_MAX_SCHEMA_CHARS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  for (const [field, value] of Object.entries({
    maxSessions,
    maxTools,
    maxToolsPerNamespace,
    maxResultsPerSearch,
    maxSearchesPerSession,
    maxSchemaChars,
    timeoutMs,
  })) assertPositiveInteger(value, field);
  if (searchDeferredTools !== undefined && typeof searchDeferredTools !== "function") {
    throw new TypeError("searchDeferredTools must be a function when provided.");
  }

  const sessions = new Map();
  const clientSearchConfigured = typeof searchDeferredTools === "function";
  let openedSessions = 0;
  let closedSessions = 0;
  let clientSearches = 0;
  let hostedSearches = 0;
  let blockedSearches = 0;
  let loadedDefinitions = 0;

  function open({ sessionId, catalogRevision, mode, capabilities, namespaces = [], tools } = {}) {
    const safeSessionId = assertIdentifier(sessionId, "sessionId");
    const safeRevision = assertIdentifier(catalogRevision, "catalogRevision");
    if (!EXECUTION_MODES.has(mode)) throw new TypeError("mode must be client or hosted.");
    const supported = normalizeCapabilities(capabilities);
    if (!supported.toolSearch || (mode === "client" && !supported.clientSearch) || (mode === "hosted" && !supported.hostedSearch)) {
      return blockedResult(safeSessionId, "activate", "capability_unsupported", "Declared capabilities do not support the requested Tool Search mode.");
    }
    if (mode === "client" && !clientSearchConfigured) {
      return blockedResult(safeSessionId, "activate", "runtime_unconfigured", "Client Tool Search has no search adapter.");
    }
    if (sessions.has(safeSessionId)) {
      return blockedResult(safeSessionId, "activate", "session_active", "A Tool Search session with this id is already active.");
    }
    if (sessions.size >= maxSessions) {
      return blockedResult(safeSessionId, "activate", "session_capacity", `Tool Search has ${maxSessions} active sessions.`);
    }
    const safeNamespaces = normalizeNamespaces(namespaces);
    if (safeNamespaces.length > 0 && !supported.namespaces) {
      return blockedResult(safeSessionId, "activate", "namespace_unsupported", "Declared capabilities do not support namespaced Tool Search.");
    }
    const namespaceNames = new Set(safeNamespaces.map((namespace) => namespace.name));
    const normalized = normalizeTools(tools, namespaceNames, { maxTools, maxToolsPerNamespace, maxSchemaChars });
    const toolsByName = new Map(normalized.tools.map((tool) => [tool.name, tool]));
    const directDefinitions = Object.freeze(normalized.tools.filter((tool) => !tool.deferLoading).map(fullDefinition));
    const deferredSurfaces = buildDeferredSurfaces(safeNamespaces, normalized.tools);
    const deferredDefinitionChars = normalized.tools
      .filter((tool) => tool.deferLoading)
      .reduce((sum, tool) => sum + serializedJsonLength(fullDefinition(tool)), 0);
    const initialContext = Object.freeze({
      search: Object.freeze({ type: "tool-search", execution: mode }),
      directTools: directDefinitions,
      deferredSurfaces,
    });
    const adapterRequest = Object.freeze({
      search: initialContext.search,
      tools: mode === "hosted"
        ? Object.freeze(normalized.tools.map(adapterDefinition))
        : directDefinitions,
    });
    const session = {
      sessionId: safeSessionId,
      catalogRevision: safeRevision,
      mode,
      initialContext,
      toolsByName,
      loadedNames: new Set(),
      eventIds: new Set(),
      searches: 0,
    };
    sessions.set(safeSessionId, session);
    openedSessions += 1;
    return Object.freeze({
      sessionId: safeSessionId,
      status: "ready",
      mode,
      catalogRevision: safeRevision,
      initialContext,
      adapterRequest,
      evidence: Object.freeze({
        totalTools: normalized.tools.length,
        directDefinitions: directDefinitions.length,
        deferredDefinitions: normalized.tools.length - directDefinitions.length,
        deferredSurfaces: deferredSurfaces.length,
        deferredDefinitionChars,
        initialPrefixMutation: false,
        providerContextReduction: "unverified",
      }),
      costLog: zeroCostLog(),
    });
  }

  function requireSession(sessionId) {
    const safeSessionId = assertIdentifier(sessionId, "sessionId");
    const session = sessions.get(safeSessionId);
    if (!session) throw new ToolSearchBlock("session_missing", "Tool Search session is missing or closed.");
    return session;
  }

  function beginSearch(session, eventId) {
    const safeEventId = assertIdentifier(eventId, "eventId");
    if (session.eventIds.has(safeEventId)) throw new ToolSearchBlock("search_replayed", "Tool Search event id was already used.");
    if (session.searches >= maxSearchesPerSession) {
      throw new ToolSearchBlock("search_limit", `Tool Search exceeds ${maxSearchesPerSession} searches in this session.`);
    }
    session.eventIds.add(safeEventId);
    session.searches += 1;
    return safeEventId;
  }

  async function resolveClient({ sessionId, eventId, providerCallId, query, limit = maxResultsPerSearch, caller = "model" } = {}) {
    let safeSessionId = "";
    let adapterAttempted = false;
    let reportedCostLog;
    try {
      safeSessionId = assertIdentifier(sessionId, "sessionId");
      const session = requireSession(safeSessionId);
      if (session.mode !== "client") throw new ToolSearchBlock("mode_mismatch", "Client resolution requires a client Tool Search session.");
      if (caller !== "model") throw new ToolSearchBlock("top_level_search_required", "Tool Search must run before a hosted program starts.");
      const safeEventId = beginSearch(session, eventId);
      const safeProviderCallId = assertIdentifier(providerCallId, "providerCallId");
      const safeQuery = assertIdentifier(query, "query");
      if (!Number.isInteger(limit) || limit < 1 || limit > maxResultsPerSearch) {
        throw new ToolSearchBlock("search_limit_invalid", `limit must be between 1 and ${maxResultsPerSearch}.`);
      }
      const candidates = candidateMetadata(session);
      adapterAttempted = true;
      const response = await runWithTimeout(searchDeferredTools, {
        sessionId: safeSessionId,
        catalogRevision: session.catalogRevision,
        query: safeQuery,
        limit,
        candidates,
      }, timeoutMs);
      if (!response || typeof response !== "object" || Array.isArray(response)) {
        throw new ToolSearchBlock("search_result_invalid", "Client search adapter must return an object.");
      }
      reportedCostLog = normalizeCostLog(response.costLog);
      const names = normalizeLoadedNames(response.toolNames, session, limit);
      const definitions = loadNames(session, names);
      clientSearches += 1;
      loadedDefinitions += definitions.length;
      return Object.freeze({
        sessionId: safeSessionId,
        status: "completed",
        output: Object.freeze({
          type: "tool-search-output",
          eventId: safeEventId,
          providerCallId: safeProviderCallId,
          tools: definitions,
        }),
        evidence: Object.freeze({
          loadedToolNames: Object.freeze([...names]),
          remainingDeferredTools: candidateMetadata(session).length,
          initialPrefixMutation: false,
        }),
        costLog: reportedCostLog,
      });
    } catch (error) {
      blockedSearches += 1;
      const costLog = reportedCostLog || (adapterAttempted ? unreportedCostLog() : zeroCostLog());
      if (error instanceof ToolSearchBlock) {
        return blockedResult(safeSessionId, "search", error.reasonCode, error.message, costLog);
      }
      return blockedResult(safeSessionId, "search", "runtime_failed", error instanceof Error ? error.message : String(error), costLog);
    }
  }

  function acceptHosted({
    sessionId,
    eventId,
    providerCallId = null,
    execution,
    toolDefinitions,
    costLog,
  } = {}) {
    let safeSessionId = "";
    let providerOutputSupplied = false;
    let reportedCostLog;
    try {
      safeSessionId = assertIdentifier(sessionId, "sessionId");
      const session = requireSession(safeSessionId);
      if (session.mode !== "hosted") throw new ToolSearchBlock("mode_mismatch", "Hosted resolution requires a hosted Tool Search session.");
      providerOutputSupplied = true;
      if (execution !== "server" || providerCallId !== null) {
        throw new ToolSearchBlock("hosted_search_invalid", "Hosted Tool Search metadata does not match server execution.");
      }
      const safeEventId = beginSearch(session, eventId);
      if (!Array.isArray(toolDefinitions)) {
        throw new ToolSearchBlock("search_result_invalid", "toolDefinitions must be an array.");
      }
      reportedCostLog = normalizeCostLog(costLog);
      const names = toolDefinitions.map((definition, index) => {
        const normalized = normalizeJson(definition, `toolDefinitions[${index}]`);
        const name = assertIdentifier(normalized.name, `toolDefinitions[${index}].name`);
        const canonical = session.toolsByName.get(name);
        if (!canonical || JSON.stringify(normalized) !== JSON.stringify(normalizeJson(fullDefinition(canonical)))) {
          throw new ToolSearchBlock("definition_mismatch", `Hosted Tool Search returned a non-canonical definition: ${name}.`);
        }
        return name;
      });
      const loadedNames = normalizeLoadedNames(names, session, maxResultsPerSearch);
      const definitions = loadNames(session, loadedNames);
      hostedSearches += 1;
      loadedDefinitions += definitions.length;
      return Object.freeze({
        sessionId: safeSessionId,
        status: "completed",
        output: Object.freeze({
          type: "tool-search-output",
          eventId: safeEventId,
          providerCallId: null,
          tools: definitions,
        }),
        evidence: Object.freeze({
          loadedToolNames: Object.freeze([...loadedNames]),
          remainingDeferredTools: candidateMetadata(session).length,
          initialPrefixMutation: false,
        }),
        costLog: reportedCostLog,
      });
    } catch (error) {
      blockedSearches += 1;
      const failureCostLog = reportedCostLog || (providerOutputSupplied ? unreportedCostLog() : zeroCostLog());
      if (error instanceof ToolSearchBlock) {
        return blockedResult(safeSessionId, "search", error.reasonCode, error.message, failureCostLog);
      }
      return blockedResult(safeSessionId, "search", "runtime_failed", error instanceof Error ? error.message : String(error), failureCostLog);
    }
  }

  function authorize({ sessionId, toolName, caller = "direct" } = {}) {
    const session = requireSession(sessionId);
    const safeToolName = assertIdentifier(toolName, "toolName");
    if (!TOOL_CALLERS.has(caller)) throw new TypeError("caller must be direct or programmatic.");
    const tool = session.toolsByName.get(safeToolName);
    if (!tool) return Object.freeze({ authorized: false, reasonCode: "tool_not_granted" });
    if (tool.deferLoading && !session.loadedNames.has(safeToolName)) {
      return Object.freeze({ authorized: false, reasonCode: "tool_not_loaded" });
    }
    if (!tool.allowedCallers.includes(caller)) {
      return Object.freeze({ authorized: false, reasonCode: "caller_not_allowed" });
    }
    return Object.freeze({ authorized: true, definition: fullDefinition(tool) });
  }

  function initialContext({ sessionId } = {}) {
    return requireSession(sessionId).initialContext;
  }

  function close({ sessionId } = {}) {
    const safeSessionId = assertIdentifier(sessionId, "sessionId");
    if (!sessions.delete(safeSessionId)) return false;
    closedSessions += 1;
    return true;
  }

  function stats() {
    return Object.freeze({
      clientSearchConfigured,
      activeSessions: sessions.size,
      openedSessions,
      closedSessions,
      clientSearches,
      hostedSearches,
      blockedSearches,
      loadedDefinitions,
      maxSessions,
      maxTools,
      maxToolsPerNamespace,
      maxResultsPerSearch,
      maxSearchesPerSession,
      maxSchemaChars,
      timeoutMs,
    });
  }

  return Object.freeze({ open, resolveClient, acceptHosted, authorize, initialContext, close, stats });
}

export const TOOL_SEARCH_DEFAULTS = Object.freeze({
  maxSessions: DEFAULT_MAX_SESSIONS,
  maxTools: DEFAULT_MAX_TOOLS,
  maxToolsPerNamespace: DEFAULT_MAX_TOOLS_PER_NAMESPACE,
  maxResultsPerSearch: DEFAULT_MAX_RESULTS_PER_SEARCH,
  maxSearchesPerSession: DEFAULT_MAX_SEARCHES_PER_SESSION,
  maxSchemaChars: DEFAULT_MAX_SCHEMA_CHARS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
