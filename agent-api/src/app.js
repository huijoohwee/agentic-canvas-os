// Platform-neutral Agent-API app wiring for agentic-canvas-os.
//
// Builds the two request handlers (`authSession`, `run`) from environment, wired
// to a keyless knowgrph MCP client. This core is HOST-AGNOSTIC: the Vercel
// serverless functions (PRIMARY) and the AWS Lambda adapter (FALLBACK) both
// import it, so the auth + forward logic lives in exactly one place regardless
// of where it is deployed.
//
// Env (server-side only; never shipped to the client):
//   AGENT_API_JWT_SECRET   — HS256 signing secret (required to mint/verify)
//   KNOWGRPH_MCP_ENDPOINT  — knowgrph control-plane MCP Streamable HTTP endpoint
//   AGENT_API_AUTH_EXPIRY  — optional session expiry seconds [300, 86400]

import { createAuthSessionHandler, createRunHandler } from "./handler.js";
import { createKnowgrphMcpClient } from "../../src/knowgrph-mcp-client.js";

/**
 * Build the configured Agent-API handlers from an env bag (defaults to
 * `process.env`). The MCP client is created only when an endpoint is set;
 * otherwise the run handler fails closed (501) — never a silent direct model
 * call. Tests inject `{ env, fetchImpl }` for full offline control.
 *
 * @param {object} [opts]
 * @param {object} [opts.env] environment bag (default process.env)
 * @param {Function} [opts.fetchImpl] injectable MCP transport (tests)
 * @returns {{ authSession: Function, run: Function, configured: boolean }}
 */
export function createAgentApiApp({ env, fetchImpl } = {}) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const secret = typeof e.AGENT_API_JWT_SECRET === "string" ? e.AGENT_API_JWT_SECRET : "";
  const endpoint = typeof e.KNOWGRPH_MCP_ENDPOINT === "string" ? e.KNOWGRPH_MCP_ENDPOINT.trim() : "";
  const expiry = Number(e.AGENT_API_AUTH_EXPIRY);

  let mcpClient = null;
  if (endpoint) {
    mcpClient = createKnowgrphMcpClient({ endpoint, fetchImpl });
  }

  return {
    configured: Boolean(secret && endpoint),
    authSession: createAuthSessionHandler({
      secret,
      ...(Number.isFinite(expiry) ? { defaultExpirySeconds: expiry } : {}),
    }),
    run: createRunHandler({ secret, mcpClient }),
  };
}
