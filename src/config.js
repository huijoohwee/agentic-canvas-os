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

/** knowgrph MCP Streamable HTTP endpoint (the control plane this tier forwards to). */
export const KNOWGRPH_MCP_ENDPOINT = readEnv(
  ["KNOWGRPH_MCP_ENDPOINT", "MCP_ENDPOINT", "NEXT_PUBLIC_KNOWGRPH_MCP_ENDPOINT"],
  "https://airvio.co/knowgrph/mcp",
);

/** knowgrph control-plane canvas base; the product embeds its run-scoped doc-view. */
export const CANVAS_BASE_URL = readEnv(
  ["CANVAS_BASE_URL", "NEXT_PUBLIC_CANVAS_BASE_URL", "PUBLIC_CANVAS_BASE_URL"],
  "https://airvio.co/knowgrph",
);

/** Agent-API base the Cloudflare-hosted frontend calls; empty = same Worker origin. */
export const AGENT_API_BASE_URL = readEnv(
  ["AGENT_API_URL", "PUBLIC_AGENT_API_URL", "CLOUDFLARE_AGENT_API_URL"],
  "",
);

/** The hero MCP tool exposed by the knowgrph control plane. */
export const KNOWGRPH_RUN_TOOL = "knowgrph.video_remix.run";
