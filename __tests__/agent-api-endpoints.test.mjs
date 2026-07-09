// Tests for the same-origin Cloudflare Worker Agent-API request helper.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveAgentApiBase, joinUrl, postJson } from "../src/agent-api-endpoints.js";

test("resolveAgentApiBase normalizes the Cloudflare Worker base", () => {
  assert.equal(resolveAgentApiBase({ base: "" }), "");
  assert.equal(resolveAgentApiBase({ base: "https://worker.example/" }), "https://worker.example");
});

test("joinUrl joins relative + absolute paths", () => {
  assert.equal(joinUrl("", "/api/run"), "/api/run");
  assert.equal(joinUrl("https://x.dev/", "api/run"), "https://x.dev/api/run");
  assert.equal(joinUrl("https://x.dev", "https://abs/explicit"), "https://abs/explicit");
});

function res(status, body) {
  return { status, json: async () => body };
}

test("postJson calls the Cloudflare Worker API once", async () => {
  const calls = [];
  const doFetch = async (url) => {
    calls.push(url);
    return res(200, { token: "t" });
  };
  const out = await postJson({
    doFetch,
    base: "",
    path: "/api/auth/session",
    init: { method: "POST" },
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { token: "t" });
  assert.deepEqual(calls, ["/api/auth/session"]);
});

test("postJson surfaces transport errors", async () => {
  const doFetch = async () => {
    throw new Error("network down");
  };
  await assert.rejects(() => postJson({ doFetch, base: "", path: "/x", init: {} }), /network down/);
});
