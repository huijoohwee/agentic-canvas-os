import assert from "node:assert/strict";
import test from "node:test";

import { productionVersionTag } from "../agent-api/src/commerce-deployment-identity.js";
import {
  COMMERCE_RELEASE_PROOF_PATH,
  createCommerceReleaseProofHandler,
  readCommerceReleaseProofEnvelope,
} from "../agent-api/src/commerce-release-proof.js";
import { handleCloudflareRequest } from "../worker/index.js";

const TOKEN = "release-proof-token-with-at-least-32-bytes";
const ADMISSION_SECRET = "agentic-os-admission-release-proof-secret-0001";
const CANDIDATE = "c".repeat(64);
const IDENTITY = Object.freeze({
  schema: "acos-cloudflare-deployment-identity/v1",
  sourceRevision: "a".repeat(40),
  candidateDigest: CANDIDATE,
  versionId: "8f031f1e-ec20-4c55-9f04-1fdc77c68f6e",
  versionTag: productionVersionTag(CANDIDATE),
  versionTimestamp: "2026-09-03T04:05:06.123Z",
});
const AUTHORITY = Object.freeze({
  schema: "agentic-graph-commerce-admission-authority-projection/v1",
  authority_ref: "authority://agentic-graph/commerce-admission/release-proof",
  admission_inputs_digest: "1".repeat(64),
  admission_request_digest: "2".repeat(64),
  evidence_digest: "3".repeat(64),
  issuer_repository: "huijoohwee/agentic-graph",
  issuer_revision: "b".repeat(40),
  permit_digest: "4".repeat(64),
  expires_at_ms: 1_800_000_000_000,
});
const ENVELOPE = Object.freeze({
  ok: true,
  contract: "commerce.agentic-os-admission-provider/v3",
  receiptSchema: "agentic-os-adapter-registration/v2",
  operations: Object.freeze(["register-fenced"]),
  productionReady: true,
  deploymentIdentity: IDENTITY,
  authority: AUTHORITY,
});

function request(token = TOKEN, method = "GET") {
  return new Request(`https://airvio.co${COMMERCE_RELEASE_PROOF_PATH}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test("the exact current provider, identity, and Graph authority envelope is accepted", () => {
  assert.deepEqual(readCommerceReleaseProofEnvelope(ENVELOPE), ENVELOPE);
  assert.equal(readCommerceReleaseProofEnvelope({ ...ENVELOPE, ready: true }), null);
  assert.equal(readCommerceReleaseProofEnvelope({
    ...ENVELOPE,
    authority: { ...AUTHORITY, evidence_digest: "wrong" },
  }), null);
});

test("release proof authenticates before the HMAC service-bound readyz call", async () => {
  let serviceCalls = 0;
  const handler = createCommerceReleaseProofHandler({
    token: TOKEN,
    admissionAuthSecret: ADMISSION_SECRET,
    serviceFetch: async (upstream) => {
      serviceCalls += 1;
      assert.equal(new URL(upstream.url).hostname, "agentic-os-admission.internal");
      assert.equal(new URL(upstream.url).pathname, "/agentic-os/internal/v2/adapter-registrations/readyz");
      assert.equal(
        upstream.headers.get("x-agentic-os-admission-auth-schema"),
        "commerce-agentic-os-admission-auth/v1",
      );
      assert.match(upstream.headers.get("x-agentic-os-admission-auth-signature"), /^[0-9a-f]{64}$/u);
      return Response.json(ENVELOPE);
    },
  });
  for (const invalid of [request(""), request("wrong-token"), request(TOKEN, "POST")]) {
    assert.notEqual((await handler.handle(invalid)).status, 200);
  }
  assert.equal(serviceCalls, 0);
  const response = await handler.handle(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), ENVELOPE);
  assert.equal(serviceCalls, 1);
});

test("unconfigured, oversized, or drifted loopback evidence fails closed", async () => {
  assert.equal((await createCommerceReleaseProofHandler({ token: TOKEN }).handle(request())).status, 503);
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

test("public proof delegates only to the same-Worker export and public /ready stays non-authoritative", async () => {
  let calls = 0;
  const env = {
    ACOS_RELEASE_PROBE_TOKEN: TOKEN,
    AGENTIC_OS_ADMISSION_AUTH_SECRET: ADMISSION_SECRET,
  };
  const response = await handleCloudflareRequest(request(), env, {
    exports: {
      CommerceAdmissionProbe: {
        fetch: async (upstream) => {
          calls += 1;
          assert.equal(new URL(upstream.url).hostname, "agentic-os-admission.internal");
          return Response.json(ENVELOPE);
        },
      },
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ENVELOPE);
  assert.equal(calls, 1);

  const ready = await handleCloudflareRequest(new Request("https://airvio.co/ready"), {});
  const body = await ready.json();
  assert.equal(Object.hasOwn(body, "deploymentIdentity"), false);
  assert.equal(Object.hasOwn(body, "authority"), false);
  const privateProvider = await handleCloudflareRequest(new Request(
    "https://airvio.co/agentic-os/internal/v2/adapter-registrations/readyz",
  ), {}, {});
  assert.equal(privateProvider.status, 404);
});
