import assert from "node:assert/strict";
import test from "node:test";

import { mintSessionToken } from "../agent-api/src/auth.js";
import { handleCloudflareRequest } from "../worker/index.js";

const SECRET = "cloudflare-economics-secret";
const ROOM_ID = "a".repeat(32);

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
