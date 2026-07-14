// Post-deploy production smoke checks for agentic-canvas-os.
//
// Used by .github/workflows/deploy.yml after a Cloudflare deploy, and runnable
// locally: `PRODUCTION_URL=https://... node scripts/smoke.mjs`.
//
// These probes need NO secrets or tokens. They assert that each critical route
// is wired and healthy on the freshly deployed Worker:
//   - GET  /api/ready              -> 200 JSON object (SEA-LION readiness)
//   - GET  /api/canvas/room?room=… -> 400/401 (Durable Object route + auth live)
//   - POST /api/invoke             -> 401 (MCP forward route live, auth-gated)
//
// A route that answers 404/501/5xx means it is missing, unconfigured, or broken
// after deploy, so the check fails and the deploy job (and rollback guidance)
// surfaces it. `runSmoke` takes an injectable `fetchImpl` so the logic is
// unit-tested without a network in __tests__/smoke.test.mjs.

// A secure-looking room id (>=128 bits hex) so the room probe reaches the auth
// check rather than the "invalid room id" short-circuit.
const PROBE_ROOM_ID = "a".repeat(32);

/** Normalize a base URL by stripping trailing slashes. */
export function normalizeBaseUrl(baseUrl) {
  return typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
}

/**
 * The smoke check matrix. Each check names the route, how to call it, and the
 * set of HTTP statuses that prove the route is alive and correctly gated.
 * Exported so tests and docs can reference the exact contract.
 */
export function smokeChecks(base) {
  return [
    {
      name: "readiness",
      method: "GET",
      url: `${base}/api/ready`,
      acceptStatuses: [200],
      // Readiness must also be a JSON object, not just any 200.
      validateBody: (value) => typeof value === "object" && value !== null,
    },
    {
      name: "canvas-room-route",
      method: "GET",
      url: `${base}/api/canvas/room?room=${PROBE_ROOM_ID}`,
      // No token supplied: a wired DO route with auth configured answers 401;
      // 400 (missing/invalid params) also proves the route exists. 404/501/5xx
      // would mean the route or Durable Object binding is missing.
      acceptStatuses: [400, 401],
    },
    {
      name: "mcp-invoke-route",
      method: "POST",
      url: `${base}/api/invoke`,
      body: {},
      // No auth: a wired MCP forward route rejects with 401 before forwarding.
      acceptStatuses: [401],
    },
  ];
}

async function attemptCheck(check, fetchImpl) {
  const init = { method: check.method };
  if (check.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(check.body);
  }
  const res = await fetchImpl(check.url, init);
  const status = typeof res.status === "number" ? res.status : 0;
  if (!check.acceptStatuses.includes(status)) {
    return { ok: false, status, reason: `unexpected status ${status}` };
  }
  if (check.validateBody) {
    let parsed;
    try {
      parsed = typeof res.json === "function" ? await res.json() : JSON.parse(await res.text());
    } catch {
      return { ok: false, status, reason: "response body was not valid JSON" };
    }
    if (!check.validateBody(parsed)) {
      return { ok: false, status, reason: "response body failed validation" };
    }
  }
  return { ok: true, status };
}

/**
 * Run every smoke check against `baseUrl`, retrying each transient failure with
 * a bounded backoff. Returns `{ ok, checks }`; never throws for a failed probe
 * (a thrown transport error is retried, then recorded as a failed check).
 *
 * @param {object} args
 * @param {string} args.baseUrl deployed Worker origin
 * @param {(url:string, init:object)=>Promise<{status:number, json?:Function, text?:Function}>} args.fetchImpl
 * @param {number} [args.retries] attempts per check (default 5)
 * @param {(ms:number)=>Promise<void>} [args.sleep] injectable delay (default real)
 * @param {number} [args.backoffMs] base backoff between attempts (default 3000)
 */
export async function runSmoke({ baseUrl, fetchImpl, retries = 5, sleep, backoffMs = 3000 } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const wait = typeof sleep === "function" ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  if (!base) {
    return { ok: false, checks: [{ name: "config", ok: false, reason: "PRODUCTION_URL not set" }] };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, checks: [{ name: "config", ok: false, reason: "no fetch transport" }] };
  }

  const results = [];
  for (const check of smokeChecks(base)) {
    let outcome = { ok: false, reason: "not attempted" };
    for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
      try {
        outcome = await attemptCheck(check, fetchImpl);
      } catch (error) {
        outcome = { ok: false, reason: `transport error: ${error && error.message ? error.message : error}` };
      }
      if (outcome.ok) break;
      if (attempt < retries) await wait(backoffMs);
    }
    results.push({ name: check.name, url: check.url, ...outcome });
  }
  return { ok: results.every((r) => r.ok), checks: results };
}

// CLI entry: only runs when executed directly, never on import (keeps tests pure).
const invokedDirectly =
  typeof process !== "undefined" && Array.isArray(process.argv) && /scripts\/smoke\.mjs$/.test(process.argv[1] || "");

if (invokedDirectly) {
  const baseUrl = (process.env.PRODUCTION_URL || "").trim();
  const result = await runSmoke({ baseUrl, fetchImpl: typeof fetch === "function" ? fetch : undefined });
  for (const check of result.checks) {
    const label = check.ok ? "PASS" : "FAIL";
    const detail = check.ok ? `status ${check.status}` : check.reason;
    console.log(`[smoke] ${label} ${check.name} (${detail})`);
  }
  if (!result.ok) {
    console.error("[smoke] production smoke checks failed");
    process.exit(1);
  }
  console.log("[smoke] all production smoke checks passed");
}
