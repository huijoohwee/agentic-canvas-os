import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAdapterRegistrationInterface } from "../agent-api/src/adapter-registration.js";
import {
  AUTHORING_HEADERS,
  canonicalJson,
} from "../agent-api/src/commerce-admission-contract.js";
import {
  createCommerceAdmissionProvider,
  createCommerceInvocationRegister,
  createCommerceOperatorInstructionResolver,
  createCommerceToolAllowlistProjection,
} from "../agent-api/src/commerce-admission-provider.js";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";

const FIXTURE_URL = new URL("../test/contracts/acos-admission-v2.fixture.json", import.meta.url);
const MANIFEST_URL = new URL("../test/contracts/acos-admission-v2.fixture.sha256", import.meta.url);
const AUTH_SECRET = "acos-admission-dev-secret-rotate-before-production";
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

test("the content-addressed Commerce vector passes the live ACOS provider and exact replay", async () => {
  const [bytes, manifest] = await Promise.all([
    readFile(FIXTURE_URL),
    readFile(MANIFEST_URL, "utf8"),
  ]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, "06827913f1f21a62fb31e028b41121e83cef1c09a11fcaf8fba84657cddaea44");
  assert.equal(manifest.trim(), `${digest}  acos-admission-v2.fixture.json`);

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
  const resolver = createCommerceOperatorInstructionResolver(
    fixture.request.body.operator_instruction_ref,
  );
  const registrationInterface = createAdapterRegistrationInterface({
    agentDefinitionRegistry: registry,
    toolAllowlist: createCommerceToolAllowlistProjection(),
    invocationRegister: createCommerceInvocationRegister(),
    resolveOperatorInstruction: resolver.resolveOperatorInstruction,
    now: () => NOW,
  });
  const store = createReplayStore();
  const provider = createCommerceAdmissionProvider({
    store,
    registrationInterface,
    deploymentIdentity: fixture.expectedReceiptIdentity.deployment_identity,
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
