import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mintSessionToken } from "../agent-api/src/auth.js";
import { handleCloudflareRequest } from "../worker/index.js";

const SECRET = "cloudflare-economics-secret";
const ROOM_ID = "a".repeat(32);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function roomEnvironment() {
  const calls = { idFromName: 0, get: 0, fetch: 0 };
  const env = {
    AGENT_API_JWT_SECRET: SECRET,
    CANVAS_ROOM: {
      idFromName(roomId) {
        calls.idFromName += 1;
        return roomId;
      },
      get(roomId) {
        calls.get += 1;
        return {
          async fetch() {
            calls.fetch += 1;
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };
  return { calls, env };
}

function roomRequest({ method = "GET", room = ROOM_ID, token = "", upgrade = true } = {}) {
  const params = new URLSearchParams({ room, token });
  return new Request(`https://worker.example/api/canvas/room?${params}`, {
    method,
    headers: upgrade ? { Upgrade: "websocket" } : {},
  });
}

test("invalid canvas requests do not consume a Durable Object request", async () => {
  const { calls, env } = roomEnvironment();
  const validToken = mintSessionToken({
    secret: SECRET,
    subject: "room-member",
    roomIds: [ROOM_ID],
  });
  const foreignToken = mintSessionToken({
    secret: SECRET,
    subject: "foreign",
    roomIds: ["b".repeat(32)],
  });

  const cases = [
    [roomRequest({ method: "POST" }), 405],
    [roomRequest({ token: validToken, upgrade: false }), 426],
    [roomRequest({ room: "guessable-room" }), 400],
    [roomRequest({ token: "invalid" }), 401],
    [roomRequest({ token: foreignToken }), 401],
  ];
  for (const [request, expectedStatus] of cases) {
    const response = await handleCloudflareRequest(request, env);
    assert.equal(response.status, expectedStatus);
  }
  assert.deepEqual(calls, { idFromName: 0, get: 0, fetch: 0 });
});

test("a valid scoped canvas session reaches its Durable Object exactly once", async () => {
  const { calls, env } = roomEnvironment();
  const token = mintSessionToken({
    secret: SECRET,
    subject: "room-member",
    roomIds: [ROOM_ID],
  });

  const response = await handleCloudflareRequest(roomRequest({ token }), env);

  assert.equal(response.status, 204);
  assert.deepEqual(calls, { idFromName: 1, get: 1, fetch: 1 });
});

test("room admission limits stop valid abuse before Durable Object dispatch", async () => {
  const { calls, env } = roomEnvironment();
  let limitCalls = 0;
  env.CANVAS_ROOM_RATE_LIMITER = {
    async limit() {
      limitCalls += 1;
      return { success: false };
    },
  };
  const token = mintSessionToken({
    secret: SECRET,
    subject: "rate-limited",
    roomIds: [ROOM_ID],
  });

  const response = await handleCloudflareRequest(roomRequest({ token }), env);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(limitCalls, 1);
  assert.deepEqual(calls, { idFromName: 0, get: 0, fetch: 0 });
});

test("session admission limits fail closed before token issuance", async () => {
  let limitCalls = 0;
  const response = await handleCloudflareRequest(
    new Request("https://worker.example/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    {
      AGENT_API_JWT_SECRET: SECRET,
      AUTH_SESSION_RATE_LIMITER: {
        async limit() {
          limitCalls += 1;
          return { success: false };
        },
      },
    },
  );

  assert.equal(response.status, 429);
  assert.equal(limitCalls, 1);
});

test("Wrangler delegates the Free-plan CPU ceiling and bounds every public route", async () => {
  const source = await readFile(path.join(repositoryRoot, "wrangler.jsonc"), "utf8");
  for (const route of [
    "/api/*",
    "/ready",
    "/auth/session",
    "/run",
    "/invoke",
    "/agent/run",
    "/function-call",
    "/function-call/recover",
    "/function-call/resume",
    "/canvas/room",
  ]) {
    assert.equal(source.split(JSON.stringify(route)).length - 1, 2, `${route} must run Worker-first in root and Dev`);
  }
  assert.doesNotMatch(source, /"cpu_ms"/);
  assert.match(source, /Free plan enforces its 10 ms CPU ceiling/);
  assert.equal((source.match(/"AUTH_SESSION_RATE_LIMITER"/g) || []).length, 2);
  assert.equal((source.match(/"CANVAS_ROOM_RATE_LIMITER"/g) || []).length, 2);
  assert.equal((source.match(/"preview_urls": false/g) || []).length, 2);
  assert.doesNotMatch(source, /"preview_urls": true/);
});
