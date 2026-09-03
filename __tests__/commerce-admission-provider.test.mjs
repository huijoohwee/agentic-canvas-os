import assert from "node:assert/strict";
import test from "node:test";

import { createCommerceAdmissionAuthority } from "../agent-api/src/commerce-admission-authority.js";
import {
  AUTHORING_HEADERS,
  COMMERCE_ADMISSION_PATH,
  authoringMutationHeaders,
} from "../agent-api/src/commerce-admission-contract.js";
import { COMMERCE_ADMISSION_DEFAULTS, createCommerceAdmissionProvider } from "../agent-api/src/commerce-admission-provider.js";
import { handleCloudflareRequest } from "../worker/index.js";
import { createGraphAuthorityFixture } from "./lib/commerce-admission-auth-fixture.mjs";
import {
  AUTH_SECRET,
  NOW,
  OPERATOR_REF,
  URL,
  authenticatedPost,
  assertEcho,
  assertNoFenceEcho,
  createNamespace,
  createRuntime,
  permitFor,
  readyRequest,
  registrationBody,
  requestFor,
  responseBody,
} from "./lib/commerce-admission-provider-fixture.mjs";

test("readyz is exact and the private route is not reachable through a public hostname", async () => {
  const runtime = createRuntime(createNamespace());
  const ready = await runtime.provider.handle(readyRequest());
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.ok, true);
  assert.equal(readyBody.contract, "commerce.agentic-os-admission-provider/v3");
  assert.equal(readyBody.receiptSchema, "agentic-os-adapter-registration/v2");
  assert.deepEqual(readyBody.operations, ["register-fenced"]);
  assert.equal(readyBody.authority.issuer_repository, "huijoohwee/agentic-graph");
  const publicResponse = await runtime.provider.handle(new Request(
    `https://airvio.co${COMMERCE_ADMISSION_PATH}/readyz`,
  ));
  assert.equal(publicResponse.status, 404);
});

test("HMAC authentication gates readiness and rejects a forged high-epoch permit before durable writes", async () => {
  const namespace = createNamespace();
  const runtime = createRuntime(namespace);
  const unsignedReady = await runtime.provider.handle(new Request(`${URL}/readyz`));
  assert.equal(unsignedReady.status, 401);
  assert.deepEqual(await unsignedReady.json(), { error: "unauthorized" });

  const body = registrationBody();
  const permit = await permitFor(body);
  const signed = requestFor(body, permit);
  const forgedHeaders = new Headers(signed.headers);
  forgedHeaders.set("x-authoring-lease-epoch", "999999");
  const before = namespace.writes();
  const forged = await runtime.provider.handle(new Request(URL, {
    method: "POST",
    headers: forgedHeaders,
    body: JSON.stringify(body),
  }));
  assert.equal(forged.status, 401);
  assert.deepEqual(await forged.json(), { error: "unauthorized" });
  assert.equal(namespace.writes(), before);

  const malformed = requestFor(body, permit);
  const malformedHeaders = new Headers(malformed.headers);
  malformedHeaders.set("x-agentic-os-admission-auth-signature", "A".repeat(64));
  const malformedResponse = await runtime.provider.handle(new Request(URL, {
    method: "POST",
    headers: malformedHeaders,
    body: JSON.stringify(body),
  }));
  assert.equal(malformedResponse.status, 401);
  assert.equal(namespace.writes(), before);
});

test("the Worker entrypoint wires the configured private service-binding route", async () => {
  const authorityNow = Date.now();
  const authorityFixture = createGraphAuthorityFixture({
    operatorInstructionRef: OPERATOR_REF,
    issuedAtMs: authorityNow - 1_000,
    expiresAtMs: authorityNow + 60_000,
  });
  const env = {
    AGENT_STATE: createNamespace(),
    AGENTIC_OS_ADMISSION_AUTHORITY_REF: authorityFixture.authorityRef,
    AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF: authorityFixture.operatorInstructionRef,
    AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE: authorityFixture.evidence,
    AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET: authorityFixture.secret,
    AGENTIC_OS_ADMISSION_AUTH_SECRET: AUTH_SECRET,
  };
  const ready = await handleCloudflareRequest(readyRequest(), env);
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.contract, "commerce.agentic-os-admission-provider/v3");
  assert.equal(readyBody.authority.issuer_repository, "huijoohwee/agentic-graph");
  const publicEnv = { ...env, ASSETS: { fetch: () => Response.json({ leaked: true }) } };
  for (const path of [
    "/agentic-os/internal",
    COMMERCE_ADMISSION_PATH,
    `${COMMERCE_ADMISSION_PATH}/readyz`,
    `${COMMERCE_ADMISSION_PATH}/unknown`,
    "/agentic-os/internal/unknown",
  ]) {
    const publicRoute = await handleCloudflareRequest(new Request(`https://airvio.co${path}`), publicEnv);
    assert.equal(publicRoute.status, 404, path);
    assert.deepEqual(await publicRoute.json(), { error: "not found" }, path);
  }
});

test("the authority and unavailable runtime fail closed without broadening authority", async () => {
  const authorityFixture = createGraphAuthorityFixture({ operatorInstructionRef: OPERATOR_REF });
  const broadened = createCommerceAdmissionAuthority({
    ...authorityFixture,
    operatorInstructionRef: `${OPERATOR_REF},operator://unowned`,
    now: () => NOW,
  });
  assert.equal((await broadened.authorize(OPERATOR_REF)).ok, false);

  const body = registrationBody();
  const permit = await permitFor(body);
  const provider = createCommerceAdmissionProvider();
  const unavailable = await provider.handle(requestFor(body, permit));
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).finding.reason_code, "runtime_unconfigured");
  assertNoFenceEcho(unavailable);

  const namespace = createNamespace();
  const runtime = createRuntime(namespace);
  const invalidDurable = createCommerceAdmissionProvider({
    store: { snapshot: runtime.store.snapshot, register: async () => ({ status: "unknown" }) },
    registrationInterface: runtime.registrationInterface,
    authority: runtime.authority,
    authSecret: AUTH_SECRET,
    now: () => NOW,
  });
  const invalid = await invalidDurable.handle(requestFor(body, permit));
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.json()).finding.reason_code, "durable_admission_invalid");
  assertNoFenceEcho(invalid);
});

test("invalid Graph authority rejects an authenticated admission before JSON projection or durable writes", async () => {
  const namespace = createNamespace();
  const runtime = createRuntime(namespace);
  const authorityFixture = createGraphAuthorityFixture({ operatorInstructionRef: OPERATOR_REF });
  const invalidAuthority = createCommerceAdmissionAuthority({
    ...authorityFixture,
    evidence: "{",
    now: () => NOW,
  });
  const provider = createCommerceAdmissionProvider({
    store: runtime.store,
    registrationInterface: runtime.registrationInterface,
    authority: invalidAuthority,
    authSecret: AUTH_SECRET,
    now: () => NOW,
  });
  const body = registrationBody();
  const permit = await permitFor(body);
  const result = await provider.handle(requestFor(body, permit));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).finding.reason_code, "authority_invalid");
  assertNoFenceEcho(result);
  assert.equal(namespace.writes(), 0);
});

test("the Durable Object rejects an authority projection that is not bound to the exact write", async () => {
  const namespace = createNamespace();
  const runtime = createRuntime(namespace);
  const inconsistentAuthority = Object.freeze({
    status: runtime.authority.status,
    async authorize(reference, authorization) {
      const result = await runtime.authority.authorize(reference, authorization);
      return result.ok ? Object.freeze({
        ...result,
        projection: Object.freeze({ ...result.projection, permit_digest: "f".repeat(64) }),
      }) : result;
    },
  });
  const provider = createCommerceAdmissionProvider({
    store: runtime.store,
    registrationInterface: runtime.registrationInterface,
    authority: inconsistentAuthority,
    authSecret: AUTH_SECRET,
    now: () => NOW,
  });
  const body = registrationBody();
  const permit = await permitFor(body);
  const result = await provider.handle(requestFor(body, permit));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).finding.reason_code, "authority_intent_mismatch");
  assert.equal(namespace.writes(), 0);
});

test("malformed and oversized bodies reject deterministically without durable writes", async () => {
  const namespace = createNamespace();
  const { provider } = createRuntime(namespace);
  const body = registrationBody();
  const permit = await permitFor(body);
  assert.equal(COMMERCE_ADMISSION_DEFAULTS.maxBodyBytes, 65_536);
  for (const [rawBody, expectedStatus, expectedCode] of [
    ["{", 409, "registration_input_invalid"],
    [JSON.stringify({ padding: "x".repeat(65_536) }), 413, null],
  ]) {
    const before = namespace.writes();
    const result = await provider.handle(requestFor(body, permit, { rawBody }));
    assert.equal(result.status, expectedStatus);
    const resultBody = await result.json();
    assert.equal(resultBody.finding?.reason_code ?? null, expectedCode);
    if (expectedCode) assertEcho(result, permit);
    assert.equal(namespace.writes(), before);
  }
});

test("every omitted or corrupt authoring header rejects without echo or writes", async () => {
  const namespace = createNamespace();
  const { provider } = createRuntime(namespace);
  const body = registrationBody();
  const permit = await permitFor(body);
  const validHeaders = authoringMutationHeaders(permit);
  for (const name of Object.values(AUTHORING_HEADERS)) {
    const omitted = new Headers({ "content-type": "application/json", ...validHeaders });
    omitted.delete(name);
    const omittedResponse = await provider.handle(authenticatedPost(JSON.stringify(body), omitted));
    assert.equal(omittedResponse.status, 409, `omitted ${name}`);
    assertNoFenceEcho(omittedResponse);

    const corrupt = new Headers({ "content-type": "application/json", ...validHeaders });
    corrupt.set(name, "");
    const corruptResponse = await provider.handle(authenticatedPost(JSON.stringify(body), corrupt));
    assert.equal(corruptResponse.status, 409, `corrupt ${name}`);
    assertNoFenceEcho(corruptResponse);
  }
  assert.equal(namespace.writes(), 0);
});

test("digest and admission-input mismatches make zero durable writes", async () => {
  const namespace = createNamespace();
  const { provider } = createRuntime(namespace);
  const body = registrationBody();
  const permit = await permitFor(body);
  const driftedIntent = registrationBody("agent-flight", {
    commerceProjection: { category: "shopping", discoveryTool: "commerce.shopping.discover" },
  });
  const digestMismatch = await provider.handle(requestFor(driftedIntent, permit));
  assert.equal((await digestMismatch.json()).finding.reason_code, "mutation_request_mismatch");
  assertEcho(digestMismatch, permit);
  assert.equal(namespace.writes(), 0);

  const inputMismatch = structuredClone(body);
  inputMismatch.operator_instruction_ref = "operator://wrong";
  const inputResponse = await provider.handle(requestFor(inputMismatch, permit));
  assert.equal((await inputResponse.json()).finding.reason_code, "registration_input_invalid");
  assert.equal(namespace.writes(), 0);
});

test("scope, target, and first-use expiry reject while an exact durable replay survives expiry", async () => {
  for (const changed of [
    { semanticScope: "operator-vendor" },
    { requiredWriteTarget: "vendor-registry" },
  ]) {
    const namespace = createNamespace();
    const { provider } = createRuntime(namespace);
    const body = registrationBody();
    const permit = Object.freeze({ ...await permitFor(body), ...changed });
    const rejected = await provider.handle(requestFor(body, permit));
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).finding.reason_code, "mutation_out_of_write_set");
    assertEcho(rejected, permit);
    assert.equal(namespace.writes(), 0);
  }

  const expiredNamespace = createNamespace();
  const expiredRuntime = createRuntime(expiredNamespace);
  const expiredBody = registrationBody("agent-expired");
  const actualNow = Date.now();
  const expiredPermit = await permitFor(expiredBody, {
    expiresAt: actualNow - 1,
    reservedAt: actualNow - 1_000,
  });
  const expired = await expiredRuntime.provider.handle(requestFor(expiredBody, expiredPermit));
  assert.equal(expired.status, 409);
  assert.equal((await expired.json()).finding.reason_code, "lease_expired");
  assertEcho(expired, expiredPermit);
  assert.equal(expiredNamespace.writes(), 0);

  let clock = NOW;
  const replayNamespace = createNamespace();
  const replayRuntime = createRuntime(replayNamespace, { now: () => clock });
  const replayBody = registrationBody("agent-expiry-replay");
  const replayPermit = await permitFor(replayBody);
  const first = await responseBody(await replayRuntime.provider.handle(requestFor(replayBody, replayPermit)));
  const firstPayload = JSON.parse(first.text);
  const writes = replayNamespace.writes();
  clock = replayPermit.leaseExpiresAtMs + 1;
  const durableReplay = await replayNamespace.commerceRegisterAt({
    permit: replayPermit,
    authoringMutationIntent: replayBody.authoring_mutation_intent,
    record: firstPayload.record,
  }, clock);
  assert.equal(durableReplay.status, 200);
  assert.deepEqual((await durableReplay.json()).record, firstPayload.record);
  assert.equal(replayNamespace.writes(), writes);
  const replay = await responseBody(await replayRuntime.provider.handle(requestFor(replayBody, replayPermit)));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.text, first.text);
  assertEcho(replay.response, replayPermit);
  assert.equal(replayNamespace.writes(), writes);
});

test("A/A and A/B/A return the byte-identical durable receipt", async () => {
  const namespace = createNamespace();
  const { provider } = createRuntime(namespace);
  const body = registrationBody();
  const permit = await permitFor(body);
  const first = await responseBody(await provider.handle(requestFor(body, permit)));
  const writesAfterFirst = namespace.writes();
  const replay = await responseBody(await provider.handle(requestFor(body, permit)));
  assert.equal(first.response.status, 200);
  assert.equal(replay.text, first.text);
  assertEcho(replay.response, permit);
  assert.equal(namespace.writes(), writesAfterFirst);

  const drifted = registrationBody("agent-flight", {
    commerceProjection: { category: "shopping", discoveryTool: "commerce.shopping.discover" },
  });
  const middle = await provider.handle(requestFor(drifted, permit));
  assert.equal((await middle.json()).finding.reason_code, "mutation_request_mismatch");
  assert.equal(namespace.writes(), writesAfterFirst);
  const finalReplay = await responseBody(await provider.handle(requestFor(body, permit)));
  assert.equal(finalReplay.text, first.text);
  assert.equal(namespace.writes(), writesAfterFirst);
});

test("an exact A outcome replays after a higher-sequence B outcome advances the fence", async () => {
  const namespace = createNamespace();
  const { provider } = createRuntime(namespace);
  const firstBody = registrationBody("agent-sequence-a");
  const firstPermit = await permitFor(firstBody, { sequence: 1 });
  const first = await responseBody(await provider.handle(requestFor(firstBody, firstPermit)));
  assert.equal(first.response.status, 200);

  const secondBody = registrationBody("agent-sequence-b");
  const secondPermit = await permitFor(secondBody, { sequence: 2 });
  const second = await provider.handle(requestFor(secondBody, secondPermit));
  assert.equal(second.status, 200);
  const writesAfterSecond = namespace.writes();

  const replay = await responseBody(await provider.handle(requestFor(firstBody, firstPermit)));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.text, first.text);
  assertEcho(replay.response, firstPermit);
  assert.equal(namespace.writes(), writesAfterSecond);
});

test("replaying an older exact receipt preserves the latest durable projection", async () => {
  const namespace = createNamespace();
  const { provider, registry, store } = createRuntime(namespace);
  const firstBody = registrationBody("agent-projection-version");
  const firstPermit = await permitFor(firstBody, { sequence: 1 });
  const first = await responseBody(await provider.handle(requestFor(firstBody, firstPermit)));
  assert.equal(first.response.status, 200);

  const secondBody = registrationBody("agent-projection-version");
  secondBody.agent_definition.revision = "agent-projection-version-v2";
  secondBody.tool_allowlist_entry.entry_id = "allowlist-agent-projection-version-v2";
  const secondPermit = await permitFor(secondBody, { sequence: 2 });
  assert.equal((await provider.handle(requestFor(secondBody, secondPermit))).status, 200);
  const writesAfterSecond = namespace.writes();

  const replay = await responseBody(await provider.handle(requestFor(firstBody, firstPermit)));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.text, first.text);
  assert.match(registry.snapshot().serialization, /agent-projection-version-v2/u);
  assert.equal((await store.list())[0].record.tool_allowlist_entry_id, "allowlist-agent-projection-version-v2");
  assert.equal(namespace.writes(), writesAfterSecond);
});

test("a conflicting allowlist entry cannot poison durable admission across stale isolates or restart", async () => {
  const namespace = createNamespace();
  const staleRuntime = createRuntime(namespace);
  assert.equal((await staleRuntime.provider.handle(readyRequest())).status, 200);

  const owningRuntime = createRuntime(namespace);
  const firstBody = registrationBody("agent-allowlist-owner");
  const firstPermit = await permitFor(firstBody, { sequence: 1 });
  const first = await responseBody(await owningRuntime.provider.handle(requestFor(firstBody, firstPermit)));
  assert.equal(first.response.status, 200);
  const writesAfterFirst = namespace.writes();

  const conflictingBody = registrationBody("agent-allowlist-conflict");
  conflictingBody.tool_allowlist_entry.entry_id = firstBody.tool_allowlist_entry.entry_id;
  const conflictingPermit = await permitFor(conflictingBody, { sequence: 2 });
  for (const runtime of [staleRuntime, owningRuntime]) {
    const conflict = await runtime.provider.handle(requestFor(conflictingBody, conflictingPermit));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).finding.reason_code, "tool_allowlist_entry_conflict");
    assertEcho(conflict, conflictingPermit);
    assert.equal(namespace.writes(), writesAfterFirst);
  }

  namespace.restart();
  const restarted = createRuntime(namespace);
  const ready = await restarted.provider.handle(readyRequest());
  assert.equal(ready.status, 200);
  assert.match(restarted.registry.snapshot().serialization, /agent-allowlist-owner/u);
  assert.doesNotMatch(restarted.registry.snapshot().serialization, /agent-allowlist-conflict/u);
  const postRestartConflict = await restarted.provider.handle(requestFor(conflictingBody, conflictingPermit));
  assert.equal(postRestartConflict.status, 409);
  assert.equal((await postRestartConflict.json()).finding.reason_code, "tool_allowlist_entry_conflict");
  assert.equal(namespace.writes(), writesAfterFirst);

  const replay = await responseBody(await restarted.provider.handle(requestFor(firstBody, firstPermit)));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.text, first.text);
  assert.equal(namespace.writes(), writesAfterFirst);
  assert.equal((await restarted.store.list()).length, 1);
});

test("a lower lease epoch is fenced without changing durable state", async () => {
  const namespace = createNamespace();
  const { provider } = createRuntime(namespace);
  const highBody = registrationBody("agent-high");
  const highPermit = await permitFor(highBody, { epoch: 2 });
  assert.equal((await provider.handle(requestFor(highBody, highPermit))).status, 200);
  const writes = namespace.writes();
  const lowBody = registrationBody("agent-low");
  const lowPermit = await permitFor(lowBody, { epoch: 1 });
  const low = await provider.handle(requestFor(lowBody, lowPermit));
  assert.equal(low.status, 409);
  assert.equal((await low.json()).finding.reason_code, "fence_stale");
  assertEcho(low, lowPermit);
  assert.equal(namespace.writes(), writes);
});

test("concurrent exact requests commit once and rehydrate after an isolate restart", async () => {
  const namespace = createNamespace();
  const firstRuntime = createRuntime(namespace);
  const body = registrationBody();
  const permit = await permitFor(body);
  const results = await Promise.all(Array.from({ length: 8 }, () => (
    firstRuntime.provider.handle(requestFor(body, permit))
  )));
  const texts = await Promise.all(results.map((result) => result.text()));
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(new Set(texts).size, 1);

  namespace.restart();
  const restarted = createRuntime(namespace);
  const ready = await restarted.provider.handle(readyRequest());
  assert.equal(ready.status, 200);
  assert.match(restarted.registry.snapshot().serialization, /agent-flight/u);
  assert.equal((await restarted.store.list()).length, 1);
});

test("projection failure leaves one durable outcome and retry projects it", async () => {
  const namespace = createNamespace();
  let failures = 1;
  const { provider, store } = createRuntime(namespace, {
    projectionFail: async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("injected projection failure");
      }
    },
  });
  const body = registrationBody();
  const permit = await permitFor(body);
  const first = await provider.handle(requestFor(body, permit));
  assert.equal(first.status, 503);
  assertNoFenceEcho(first);
  assert.equal((await store.list()).length, 1);

  const retry = await provider.handle(requestFor(body, permit));
  assert.equal(retry.status, 200);
  assertEcho(retry, permit);
  assert.equal((await store.list()).length, 1);
});
