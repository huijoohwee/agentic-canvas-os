// Public configuration for the agentic-canvas-os product tier.
//
// PUBLIC deployment values only — never a model provider key, never an auth
// signing secret (those stay server-side in the Agent-API / Secrets Manager).
// Each value is resolved from a public env var with a documented default so the
// build/runtime is environment-driven (no hardcoded routes baked into logic).

/** First non-empty env value among `names`, trimmed; `fallback` when none set. */
export function readEnv(names, fallback = "") {
  const env = (typeof process !== "undefined" && process.env) || {};
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

/** agentic-graph MCP Streamable HTTP endpoint (the control plane this tier forwards to). */
export const AGENTIC_OS_MCP_ENDPOINT = readEnv(
  ["AGENTIC_OS_MCP_ENDPOINT", "MCP_ENDPOINT", "NEXT_PUBLIC_AGENTIC_OS_MCP_ENDPOINT"],
  "https://airvio.co/agentic-os/control-plane/mcp",
);

/** agentic-graph control-plane canvas base; the product embeds its run-scoped doc-view. */
export const CANVAS_BASE_URL = readEnv(
  ["CANVAS_BASE_URL", "NEXT_PUBLIC_CANVAS_BASE_URL", "PUBLIC_CANVAS_BASE_URL"],
  "https://airvio.co/agentic-os",
);

/** Agent-API base the Cloudflare-hosted frontend calls; empty = same Worker origin. */
export const AGENT_API_BASE_URL = readEnv(
  ["AGENT_API_URL", "PUBLIC_AGENT_API_URL", "CLOUDFLARE_AGENT_API_URL"],
  "",
);

/** The hero MCP tool exposed by the agentic-graph control plane. */
export const AGENTIC_GRAPH_RUN_TOOL = "agentic-graph.video_remix.run";
