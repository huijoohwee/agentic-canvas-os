import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAdapterRegistrationInterface } from "../agent-api/src/adapter-registration.js";
import { createCommerceAdmissionAuthority } from "../agent-api/src/commerce-admission-authority.js";
import {
  AUTHORING_HEADERS,
  canonicalJson,
  readAuthoringMutationPermit,
} from "../agent-api/src/commerce-admission-contract.js";
import {
  createCommerceAdmissionProvider,
  createCommerceInvocationRegister,
  createCommerceToolAllowlistProjection,
} from "../agent-api/src/commerce-admission-provider.js";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import {
  GRAPH_AUTHORITY_OPERATOR_REF,
  createGraphAuthorityBinding,
  createGraphAuthorityFixture,
} from "./lib/commerce-admission-auth-fixture.mjs";

const FIXTURE_URL = new URL("../test/contracts/agentic-os-admission-v2.fixture.json", import.meta.url);
const MANIFEST_URL = new URL("../test/contracts/agentic-os-admission-v2.fixture.sha256", import.meta.url);
const AUTH_SECRET = "agentic-os-admission-dev-secret-rotate-before-production";
const NOW = 1_788_396_400_000;

function createReplayStore() {
  let durable = null;
  let writes = 0;
  return Object.freeze({
    async snapshot(knownRevision = null) {
      const registrations = durable ? [{ intent: durable.intent, record: durable.record }] : [];
      const revision = createHash("sha256").update(canonicalJson(registrations)).digest("hex");
      return Object.freeze({
        registrations: knownRevision === revision ? null : registrations,
        revision,
      });
    },
    async register({ permit, authoringMutationIntent, record }) {
      if (!durable) {
        durable = structuredClone({ permit, intent: authoringMutationIntent, record });
        writes += 1;
      } else if (canonicalJson(durable.permit) !== canonicalJson(permit)
        || canonicalJson(durable.intent) !== canonicalJson(authoringMutationIntent)) {
        return Object.freeze({ status: "rejected", code: "mutation_request_mismatch" });
      }
      return Object.freeze({ status: "registered", record: structuredClone(durable.record) });
    },
    writes: () => writes,
  });
}

test("the content-addressed Commerce vector passes the Graph-authorized provider and exact replay", async () => {
  const [bytes, manifest] = await Promise.all([
    readFile(FIXTURE_URL),
    readFile(MANIFEST_URL, "utf8"),
  ]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, "3fede7b38f3d8a5004870f31d798cb4218f7d7f59607144ba2fd0b431ac93a61");
  assert.equal(manifest.trim(), `${digest}  agentic-os-admission-v2.fixture.json`);

  const fixture = JSON.parse(bytes);
  assert.equal(Object.keys(fixture.request.body).length, 5);
  assert.equal(Object.values(AUTHORING_HEADERS).filter((name) => (
    Object.hasOwn(fixture.request.headers, name)
  )).length, 12);

  const registry = createAgentDefinitionRegistry();
  assert.throws(
    () => registry.register(fixture.commerceAgentDefinition),
    /unsupported fields: executableTarget/u,
  );
  assert.equal(fixture.request.body.operator_instruction_ref, GRAPH_AUTHORITY_OPERATOR_REF);
  const permit = readAuthoringMutationPermit(new Headers(fixture.request.headers));
  assert.ok(permit);
  const authority = createCommerceAdmissionAuthority({
    ...createGraphAuthorityFixture({
      authorization: createGraphAuthorityBinding({
        authoringMutationIntent: fixture.request.body.authoring_mutation_intent,
        permit,
      }),
      operatorInstructionRef: fixture.request.body.operator_instruction_ref,
      issuedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
    }),
    now: () => NOW,
  });
  const registrationInterface = createAdapterRegistrationInterface({
    agentDefinitionRegistry: registry,
    toolAllowlist: createCommerceToolAllowlistProjection(),
    invocationRegister: createCommerceInvocationRegister(),
    resolveOperatorInstruction: authority.resolveOperatorInstruction,
    now: () => NOW,
  });
  const store = createReplayStore();
  const provider = createCommerceAdmissionProvider({
    store,
    registrationInterface,
    authority,
    authSecret: AUTH_SECRET,
    now: () => NOW,
  });
  const rawBody = JSON.stringify(fixture.request.body);
  const invoke = () => provider.handle(new Request(fixture.request.url, {
    method: fixture.request.method,
    headers: fixture.request.headers,
    body: rawBody,
  }));

  const first = await invoke();
  const firstText = await first.text();
  assert.equal(first.status, 200);
  const firstBody = JSON.parse(firstText);
  assert.equal(firstBody.status, "registered");
  for (const [key, value] of Object.entries(fixture.expectedReceiptIdentity)) {
    assert.deepEqual(firstBody.record[key], value, key);
  }
  assert.equal(store.writes(), 1);

  const replay = await invoke();
  assert.equal(replay.status, 200);
  assert.equal(await replay.text(), firstText);
  assert.equal(store.writes(), 1);
});
