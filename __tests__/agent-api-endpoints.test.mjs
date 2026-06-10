// Tests for the primary→fallback Agent-API endpoint resolver (agentic-canvas-os).
// Vercel is the PRIMARY/default base; AWS is the FALLBACK. ZERO network — the
// transport is injected.

import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAgentApiBases,
  joinUrl,
  shouldFallbackOnStatus,
  postJsonWithFallback,
} from "../src/agent-api-endpoints.js";

test("resolveAgentApiBases puts the Vercel primary first, AWS fallback second", () => {
  assert.deepEqual(
    resolveAgentApiBases({ primaryBase: "", fallbackBase: "https://api.aws" }),
    ["", "https://api.aws"],
  );
  assert.deepEqual(
    resolveAgentApiBases({ primaryBase: "https://acos.vercel.app", fallbackBase: "https://api.aws/" }),
    ["https://acos.vercel.app", "https://api.aws"],
  );
});

test("resolveAgentApiBases de-dups and tolerates no fallback", () => {
  assert.deepEqual(resolveAgentApiBases({ primaryBase: "", fallbackBase: "" }), [""]);
  assert.deepEqual(resolveAgentApiBases({ primaryBase: "https://x", fallbackBase: "https://x" }), ["https://x"]);
});

test("joinUrl joins relative + absolute paths", () => {
  assert.equal(joinUrl("", "/api/run"), "/api/run");
  assert.equal(joinUrl("https://x.dev/", "api/run"), "https://x.dev/api/run");
  assert.equal(joinUrl("https://x.dev", "https://abs/explicit"), "https://abs/explicit");
});

test("only 5xx triggers a fallback", () => {
  assert.equal(shouldFallbackOnStatus(200), false);
  assert.equal(shouldFallbackOnStatus(400), false);
  assert.equal(shouldFallbackOnStatus(401), false);
  assert.equal(shouldFallbackOnStatus(500), true);
  assert.equal(shouldFallbackOnStatus(503), true);
});

function res(status, body) {
  return { status, json: async () => body };
}

test("primary success is returned without touching the fallback", async () => {
  const calls = [];
  const doFetch = async (url) => {
    calls.push(url);
    return res(200, { token: "t" });
  };
  const out = await postJsonWithFallback({
    doFetch,
    bases: ["", "https://api.aws"],
    path: "/api/auth/session",
    init: { method: "POST" },
  });
  assert.equal(out.status, 200);
  assert.equal(out.usedFallback, false);
  assert.deepEqual(calls, ["/api/auth/session"]); // fallback never called
});

test("a 5xx on the primary fails over to the AWS fallback", async () => {
  const calls = [];
  const doFetch = async (url) => {
    calls.push(url);
    return url.startsWith("https://api.aws") ? res(200, { ok: true }) : res(503, {});
  };
  const out = await postJsonWithFallback({
    doFetch,
    bases: ["", "https://api.aws"],
    path: "/api/run",
    init: { method: "POST" },
  });
  assert.equal(out.status, 200);
  assert.equal(out.usedFallback, true);
  assert.equal(out.base, "https://api.aws");
  assert.deepEqual(calls, ["/api/run", "https://api.aws/api/run"]);
});

test("a transport throw on the primary fails over to the fallback", async () => {
  const doFetch = async (url) => {
    if (!url.startsWith("https://api.aws")) throw new Error("ECONNREFUSED");
    return res(200, { ok: true });
  };
  const out = await postJsonWithFallback({
    doFetch,
    bases: ["", "https://api.aws"],
    path: "/api/run",
    init: { method: "POST" },
  });
  assert.equal(out.status, 200);
  assert.equal(out.usedFallback, true);
});

test("a 4xx is definitive and never falls over", async () => {
  const calls = [];
  const doFetch = async (url) => {
    calls.push(url);
    return res(401, { error: "unauthorized" });
  };
  const out = await postJsonWithFallback({
    doFetch,
    bases: ["", "https://api.aws"],
    path: "/api/run",
    init: { method: "POST" },
  });
  assert.equal(out.status, 401);
  assert.equal(out.usedFallback, false);
  assert.deepEqual(calls, ["/api/run"]); // no fallback for a client error
});

test("throws when every base fails to connect", async () => {
  const doFetch = async () => {
    throw new Error("network down");
  };
  await assert.rejects(
    () => postJsonWithFallback({ doFetch, bases: ["", "https://api.aws"], path: "/x", init: {} }),
    /network down/,
  );
});
