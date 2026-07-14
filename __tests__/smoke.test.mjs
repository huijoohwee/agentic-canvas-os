// Tests for the post-deploy smoke checks. ZERO network: a stubbed fetch maps
// each probe URL to a canned response, and `sleep` is a no-op so retries don't
// actually wait.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBaseUrl, runSmoke, smokeChecks } from "../scripts/smoke.mjs";

const BASE = "https://airvio.example";
const noSleep = async () => {};

function res(status, jsonValue) {
  return {
    status,
    json: async () => {
      if (jsonValue === undefined) throw new Error("no json");
      return jsonValue;
    },
    text: async () => (jsonValue === undefined ? "not json" : JSON.stringify(jsonValue)),
  };
}

/** A fetch stub driven by a { "METHOD path": response } route map. */
function fetchStub(routes) {
  return async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const path = url.slice(BASE.length);
    const key = `${method} ${path}`;
    const match = Object.keys(routes).find((k) => key.startsWith(k));
    if (!match) throw new Error(`unexpected request ${key}`);
    const value = routes[match];
    return typeof value === "function" ? value() : value;
  };
}

const healthyRoutes = {
  "GET /api/ready": res(200, { ready: true }),
  "GET /api/canvas/room": res(401, { error: "unauthorized" }),
  "POST /api/invoke": res(401, { error: "unauthorized" }),
};

test("smokeChecks pins the three critical routes and accepted statuses", () => {
  const checks = smokeChecks(BASE);
  assert.deepEqual(
    checks.map((c) => c.name),
    ["readiness", "canvas-room-route", "mcp-invoke-route"],
  );
  assert.deepEqual(checks[0].acceptStatuses, [200]);
  assert.deepEqual(checks[1].acceptStatuses, [400, 401]);
  assert.deepEqual(checks[2].acceptStatuses, [401]);
  assert.match(checks[1].url, /room=a{32}/);
});

test("normalizeBaseUrl strips trailing slashes and tolerates junk", () => {
  assert.equal(normalizeBaseUrl("https://x/"), "https://x");
  assert.equal(normalizeBaseUrl("https://x///"), "https://x");
  assert.equal(normalizeBaseUrl(undefined), "");
});

test("runSmoke passes when every route answers as expected", async () => {
  const result = await runSmoke({ baseUrl: BASE, fetchImpl: fetchStub(healthyRoutes), sleep: noSleep });
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((c) => c.ok), [true, true, true]);
});

test("runSmoke also accepts 400 on the canvas room route", async () => {
  const routes = { ...healthyRoutes, "GET /api/canvas/room": res(400, { error: "missing room" }) };
  const result = await runSmoke({ baseUrl: BASE, fetchImpl: fetchStub(routes), sleep: noSleep });
  assert.equal(result.ok, true);
});

test("runSmoke fails when the canvas room route is missing (404) after deploy", async () => {
  const routes = { ...healthyRoutes, "GET /api/canvas/room": res(404, { error: "not found" }) };
  const result = await runSmoke({ baseUrl: BASE, fetchImpl: fetchStub(routes), retries: 2, sleep: noSleep });
  assert.equal(result.ok, false);
  const room = result.checks.find((c) => c.name === "canvas-room-route");
  assert.equal(room.ok, false);
  assert.match(room.reason, /unexpected status 404/);
});

test("runSmoke fails when the MCP route is unconfigured (501)", async () => {
  const routes = { ...healthyRoutes, "POST /api/invoke": res(501, { error: "not configured" }) };
  const result = await runSmoke({ baseUrl: BASE, fetchImpl: fetchStub(routes), retries: 1, sleep: noSleep });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((c) => c.name === "mcp-invoke-route").ok, false);
});

test("runSmoke fails readiness when the body is not a JSON object", async () => {
  const routes = { ...healthyRoutes, "GET /api/ready": res(200, undefined) };
  const result = await runSmoke({ baseUrl: BASE, fetchImpl: fetchStub(routes), retries: 1, sleep: noSleep });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((c) => c.name === "readiness").reason, /JSON/);
});

test("runSmoke retries a transient failure then succeeds", async () => {
  let attempts = 0;
  const routes = {
    ...healthyRoutes,
    "GET /api/ready": () => {
      attempts += 1;
      return attempts < 2 ? res(503) : res(200, { ready: true });
    },
  };
  const result = await runSmoke({ baseUrl: BASE, fetchImpl: fetchStub(routes), retries: 3, sleep: noSleep });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test("runSmoke fails closed without a base url or transport", async () => {
  const noBase = await runSmoke({ baseUrl: "", fetchImpl: fetchStub(healthyRoutes), sleep: noSleep });
  assert.equal(noBase.ok, false);
  const noFetch = await runSmoke({ baseUrl: BASE, sleep: noSleep });
  assert.equal(noFetch.ok, false);
});
