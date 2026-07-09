// Same-origin Agent-API request helpers for the agentic-canvas-os Cloudflare
// Worker runtime.
//
// The Worker serves static assets and API routes from one origin, so the browser
// has no alternate host topology to resolve. Browser-safe (no Node built-ins)
// and PURE apart from the injected transport.

/**
 * Resolve the Agent-API base URL.
 *
 * @param {object} cfg
 * @param {string} [cfg.base] Cloudflare Worker base; "" = same origin
 * @returns {string} normalized base
 */
export function resolveAgentApiBase({ base = "" } = {}) {
  const norm = (b) => (typeof b === "string" ? b.trim().replace(/\/+$/, "") : "");
  return norm(base);
}

/** Join a base ("" = relative/same-origin) with a request path. */
export function joinUrl(base, pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const b = typeof base === "string" ? base.replace(/\/+$/, "") : "";
  const p = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${b}${p}`;
}

/**
 * POST JSON to a path on the Cloudflare Worker API origin.
 *
 * @param {object} args
 * @param {(url: string, init: object) => Promise<{ status:number, json:Function }>} args.doFetch
 *   fetch-like transport (the browser `fetch`, or an injected stub in tests)
 * @param {string} args.base base from `resolveAgentApiBase`
 * @param {string} args.path request path (e.g. "/run")
 * @param {object} args.init fetch init ({ method, headers, body })
 * @returns {Promise<{ status:number, body:any, base:string }>}
 */
export async function postJson({ doFetch, base = "", path, init }) {
  const resolvedBase = resolveAgentApiBase({ base });
  const res = await doFetch(joinUrl(resolvedBase, path), init);
  const status = typeof res.status === "number" ? res.status : 0;
  const body = typeof res.json === "function" ? await res.json().catch(() => ({})) : {};
  return { status, body, base: resolvedBase };
}
