import assert from "node:assert/strict";
import test from "node:test";

import { readCommerceAdmissionReadyEnvelope } from "../agent-api/src/commerce-admission-contract.js";
import { productionVersionTag } from "../agent-api/src/commerce-deployment-identity.js";
import {
  COMMERCE_RELEASE_PROOF_PATH,
  createCommerceReleaseProofHandler,
} from "../agent-api/src/commerce-release-proof.js";
import { handleCloudflareRequest } from "../worker/index.js";

const TOKEN = "release-proof-token-with-at-least-32-bytes";
const ADMISSION_SECRET = "acos-admission-release-proof-secret-0001";
const CANDIDATE = "c".repeat(64);
const IDENTITY = Object.freeze({
  schema: "acos-cloudflare-deployment-identity/v1",
  sourceRevision: "a".repeat(40),
  candidateDigest: CANDIDATE,
  versionId: "8f031f1e-ec20-4c55-9f04-1fdc77c68f6e",
  versionTag: productionVersionTag(CANDIDATE),
  versionTimestamp: "2026-09-03T04:05:06.123Z",
});
const ENVELOPE = Object.freeze({
  ok: true,
  contract: "commerce.acos-admission-provider/v3",
  receiptSchema: "acos-adapter-registration/v2",
  operations: Object.freeze(["register-fenced"]),
  productionReady: true,
  deploymentIdentity: IDENTITY,
});

function request(token = TOKEN, method = "GET") {
  return new Request(`https://airvio.co${COMMERCE_RELEASE_PROOF_PATH}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test("the producer envelope is accepted by the shared exact consumer parser", () => {
  assert.deepEqual(readCommerceAdmissionReadyEnvelope(ENVELOPE), ENVELOPE);
  assert.equal(readCommerceAdmissionReadyEnvelope({ ...ENVELOPE, ready: true }), null);
  assert.equal(readCommerceAdmissionReadyEnvelope({
    ...ENVELOPE,
    deploymentIdentity: { ...IDENTITY, ready: true },
  }), null);
});

test("the release proof authenticates and relays only bounded exact service-bound readiness", async () => {
  let serviceCalls = 0;
  const handler = createCommerceReleaseProofHandler({
    token: TOKEN,
    admissionAuthSecret: ADMISSION_SECRET,
    serviceFetch: async (upstream) => {
      serviceCalls += 1;
      assert.equal(new URL(upstream.url).hostname, "acos-admission.internal");
      assert.equal(upstream.headers.get("x-acos-admission-auth-schema"), "commerce-acos-admission-auth/v1");
      assert.match(upstream.headers.get("x-acos-admission-auth-signature"), /^[0-9a-f]{64}$/u);
      return Response.json(ENVELOPE);
    },
  });
  for (const invalid of [request(""), request("wrong-token"), request(TOKEN, "POST")]) {
    const result = await handler.handle(invalid);
    assert.notEqual(result.status, 200);
  }
  assert.equal(serviceCalls, 0);
  const result = await handler.handle(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), ENVELOPE);
  assert.equal(serviceCalls, 1);
});

test("unconfigured, oversized, or drifted loopback evidence fails closed", async () => {
  const unconfigured = createCommerceReleaseProofHandler({ token: TOKEN });
  assert.equal((await unconfigured.handle(request())).status, 503);

  for (const upstream of [
    new Response(JSON.stringify({ ...ENVELOPE, unexpected: true })),
    new Response(JSON.stringify({ padding: "x".repeat(65_536) })),
  ]) {
    const handler = createCommerceReleaseProofHandler({
      token: TOKEN,
      admissionAuthSecret: ADMISSION_SECRET,
      serviceFetch: async () => upstream,
    });
    assert.equal((await handler.handle(request())).status, 503);
  }
});

test("the public release-proof route invokes only the owned loopback service binding", async () => {
  let calls = 0;
  const response = await handleCloudflareRequest(request(), {
    ACOS_RELEASE_PROBE_TOKEN: TOKEN,
    ACOS_ADMISSION_AUTH_SECRET: ADMISSION_SECRET,
  }, {
    exports: {
      CommerceAdmissionProbe: {
        fetch: async () => { calls += 1; return Response.json(ENVELOPE); },
      },
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ENVELOPE);
  assert.equal(calls, 1);
  const publicProvider = await handleCloudflareRequest(new Request(
    "https://airvio.co/internal/v2/adapter-registrations/readyz",
  ), {}, {});
  assert.equal(publicProvider.status, 404);
});
