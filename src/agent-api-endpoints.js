// Primary→fallback Agent-API endpoint resolution for the agentic-canvas-os
// frontend.
//
// Hosting topology: the Agent-API is served by **Vercel serverless functions
// (PRIMARY/DEFAULT)** and, when that is unreachable/erroring, by an **AWS
// (FALLBACK)** deployment. This pure module resolves the ordered base list and
// runs a request against each base in order, advancing to the fallback ONLY on a
// transport failure or an upstream-availability error (network error, 502/503/
// 504, or any 5xx). A definitive client response (2xx, or a 4xx such as
// validation/auth) is returned immediately and never triggers a fallback — a
// 400/401 means the same thing on either host.
//
// Browser-safe (no Node built-ins) so it is copied into the Vercel static
// bundle. PURE apart from the injected transport.

/**
 * Resolve the ordered list of Agent-API base URLs to try.
 *
 * @param {object} cfg
 * @param {string} [cfg.primaryBase] Vercel base; "" = same origin (default primary)
 * @param {string} [cfg.fallbackBase] AWS base used only when the primary fails
 * @returns {string[]} ordered, de-duplicated base list (at least one entry: "")
 */
export function resolveAgentApiBases({ primaryBase = "", fallbackBase = "" } = {}) {
  const norm = (b) => (typeof b === "string" ? b.trim().replace(/\/+$/, "") : "");
  const primary = norm(primaryBase); // "" means same origin (Vercel default)
  const fallback = norm(fallbackBase);
  const bases = [primary];
  if (fallback && fallback !== primary) bases.push(fallback);
  return bases;
}

/** Join a base ("" = relative/same-origin) with a request path. */
export function joinUrl(base, pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const b = typeof base === "string" ? base.replace(/\/+$/, "") : "";
  const p = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${b}${p}`;
}

/** True when a status should trigger a fallback to the next base (5xx only). */
export function shouldFallbackOnStatus(status) {
  return typeof status === "number" && status >= 500;
}

/**
 * POST JSON to a path, trying each base in order. Advances to the next base on a
 * transport throw OR a 5xx response; returns the first non-5xx response (2xx or
 * 4xx) immediately. Throws the last transport error if every base fails to
 * connect.
 *
 * @param {object} args
 * @param {(url: string, init: object) => Promise<{ status:number, json:Function }>} args.doFetch
 *   fetch-like transport (the browser `fetch`, or an injected stub in tests)
 * @param {string[]} args.bases ordered base list from `resolveAgentApiBases`
 * @param {string} args.path request path (e.g. "/run")
 * @param {object} args.init fetch init ({ method, headers, body })
 * @returns {Promise<{ status:number, body:any, base:string, usedFallback:boolean }>}
 */
export async function postJsonWithFallback({ doFetch, bases, path, init }) {
  const list = Array.isArray(bases) && bases.length ? bases : [""];
  let lastError = null;
  for (let i = 0; i < list.length; i += 1) {
    const base = list[i];
    try {
      const res = await doFetch(joinUrl(base, path), init);
      const status = typeof res.status === "number" ? res.status : 0;
      // 5xx on a non-final base → try the fallback; otherwise return as-is.
      if (shouldFallbackOnStatus(status) && i < list.length - 1) {
        lastError = new Error(`upstream ${status} at base ${i}`);
        continue;
      }
      const body = typeof res.json === "function" ? await res.json().catch(() => ({})) : {};
      return { status, body, base, usedFallback: i > 0 };
    } catch (err) {
      lastError = err;
      // transport failure → try the next base if one remains
    }
  }
  throw lastError || new Error("all Agent-API bases failed");
}
