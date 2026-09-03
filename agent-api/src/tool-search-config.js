import { createToolSearchRuntime } from "./tool-search.js";

const ZERO_COST_LOG = Object.freeze({
  model: "session-catalog-search",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function scoreCandidate(queryText, queryTokens, candidate) {
  const name = cleanText(candidate?.name).toLowerCase();
  const namespace = cleanText(candidate?.namespace).toLowerCase();
  const description = cleanText(candidate?.description).toLowerCase();
  const haystack = [name, namespace, description].filter(Boolean).join(" ");
  if (!haystack) return 0;

  let score = 0;
  if (queryText && name === queryText) score += 100;
  if (queryText && namespace === queryText) score += 40;
  if (queryText && name.startsWith(queryText)) score += 25;
  if (queryText && name.includes(queryText)) score += 15;
  if (queryText && namespace.includes(queryText)) score += 8;
  if (queryText && description.includes(queryText)) score += 5;

  for (const token of queryTokens) {
    if (name === token) score += 18;
    else if (name.startsWith(token)) score += 10;
    else if (name.includes(token)) score += 6;
    if (namespace === token) score += 6;
    else if (namespace.includes(token)) score += 3;
    if (description.includes(token)) score += 2;
  }
  return score;
}

export function createDeterministicDeferredToolSearchAdapter() {
  return async function searchDeferredTools({ query, limit, candidates = [] } = {}) {
    const queryText = cleanText(query).toLowerCase();
    const queryTokens = tokenize(query);
    const ranked = candidates
      .map((candidate) => ({
        name: cleanText(candidate?.name),
        score: scoreCandidate(queryText, queryTokens, candidate),
      }))
      .filter((candidate) => candidate.name && candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, limit)
      .map((candidate) => candidate.name);
    return Object.freeze({
      toolNames: Object.freeze(ranked),
      costLog: ZERO_COST_LOG,
    });
  };
}

export function upstreamToolSearchEnabled(
  env = {},
  { openAiFunctionConfig = {}, autonomousRuntimeEnvironment = {} } = {},
) {
  return Boolean(
    cleanText(env.AGENTIC_OS_MCP_ENDPOINT)
    && (openAiFunctionConfig.ready || autonomousRuntimeEnvironment.ready),
  );
}

export function createConfiguredToolSearchRuntime(
  env = {},
  { openAiFunctionConfig = {}, autonomousRuntimeEnvironment = {} } = {},
) {
  return createToolSearchRuntime(
    upstreamToolSearchEnabled(env, { openAiFunctionConfig, autonomousRuntimeEnvironment })
      ? { searchDeferredTools: createDeterministicDeferredToolSearchAdapter() }
      : {},
  );
}
