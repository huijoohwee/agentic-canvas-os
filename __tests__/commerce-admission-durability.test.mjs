import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import { createAdapterRegistrationInterface } from "../agent-api/src/adapter-registration.js";
import {
  AUTHORING_MUTATION_PERMIT_SCHEMA,
  COMMERCE_ADMISSION_PATH,
  authoringMutationHeaders,
  canonicalJson,
  commerceAdmissionRequestDigest,
  createCommerceAdmissionAuthInput,
} from "../agent-api/src/commerce-admission-contract.js";
import {
  createCommerceAdmissionProvider,
  createCommerceInvocationRegister,
  createCommerceToolAllowlistProjection,
} from "../agent-api/src/commerce-admission-provider.js";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import { createDurableObjectCommerceAdmissionStore } from "../agent-api/src/durable-object-state-store.js";
import { AgentState } from "../worker/agent-state.js";
import {
  GRAPH_AUTHORITY_OPERATOR_REF,
} from "./lib/commerce-admission-auth-fixture.mjs";
import { DEPLOYMENT_IDENTITY } from "./lib/commerce-admission-provider-fixture.mjs";

const NOW = 1_800_000_000_000;
const OPERATOR_REF = GRAPH_AUTHORITY_OPERATOR_REF;
const URL = `https://agentic-os-admission.internal${COMMERCE_ADMISSION_PATH}`;
const AUTH_SECRET = "agentic-os-admission-durability-secret-00001";
const INDEX_KEY = "commerce-admission:registration-index";
const OUTCOME_INDEX_KEY = "commerce-admission:outcome-index";

class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.tail = Promise.resolve();
    this.writes = 0;
  }

  async transaction(operation) {
    const pending = this.tail.then(() => operation(this));
    this.tail = pending.catch(() => {});
    return pending;
  }

  async get(key) { return this.records.get(key); }
  async put(key, value) { this.writes += 1; this.records.set(key, structuredClone(value)); }
  async delete(key) { this.writes += 1; return this.records.delete(key); }
  async getAlarm() { return null; }
  async setAlarm() { this.writes += 1; }
  async deleteAlarm() { this.writes += 1; }
}

function createNamespace() {
  const storage = new MemoryStorage();
  const instances = new Map();
  let clock = NOW;
  function instance(id) {
    if (!instances.has(id)) instances.set(id, new AgentState({ storage }));
    return instances.get(id);
  }
  return {
    idFromName: (name) => name,
    get: (id) => ({
      async fetch(input, init) {
        const request = input instanceof Request ? input : new Request(input, init);
        const body = JSON.parse(await request.text());
        if (body.operation === "commerce-admission-register") {
          return instance(id).commerceAdmissionRegister(body.value, clock);
        }
        if (body.operation === "commerce-admission-list") {
          return instance(id).commerceAdmissionList(body.value);
        }
        throw new TypeError(`Unsupported fixture operation: ${body.operation}`);
      },
    }),
    restart: () => instances.clear(),
    corrupt: (operation) => operation(storage.records),
    keys: () => [...storage.records.keys()].sort(),
    setNow: (value) => { clock = value; },
    now: () => clock,
    writes: () => storage.writes,
  };
}

function bodyFor(content = "Bounded discovery.", agentId = "agent-durable") {
  const admissionInputs = {
    agentDefinition: {
      id: agentId,
      revision: `${agentId}-v1`,
      name: `${agentId} discovery`,
      source: { uri: `workspace:/agents/${agentId}.json`, digest: "1".repeat(64) },
      model: { providerId: "workspace-provider", modelId: "workspace-model" },
      instructions: [{ name: "purpose", content }],
    },
    toolAllowlistEntry: {
      entry_id: `allowlist-${agentId}`,
      agent_definition_id: agentId,
      adapter_identity: "commerce-discovery",
      tool_names: ["commerce.flight.discover"],
      review_required: true,
    },
    invocationRegisterEntry: {
      route: "/tool.route",
      tag: "#mcp",
      binding: "@mcp-gateway",
      tool_identity: "agentic-os.adapter.register",
    },
    operatorInstructionRef: OPERATOR_REF,
  };
  return {
    agent_definition: admissionInputs.agentDefinition,
    tool_allowlist_entry: admissionInputs.toolAllowlistEntry,
    invocation_register_entry: admissionInputs.invocationRegisterEntry,
    operator_instruction_ref: admissionInputs.operatorInstructionRef,
    authoring_mutation_intent: {
      admissionInputs,
      commerceProjection: { category: "flight", discoveryTool: "commerce.flight.discover" },
      expectedPreviousContentHash: null,
      invocationProof: { sourceRevision: "a".repeat(40) },
      sandboxDryRun: { ok: true, digest: "b".repeat(64) },
    },
  };
}

async function permitFor(body, sequence, {
  epoch = 1,
  expiresAt = NOW + 60_000,
  reservedAt = NOW - 1_000,
} = {}) {
  const requestDigest = await commerceAdmissionRequestDigest(body.authoring_mutation_intent);
  return {
    schema: AUTHORING_MUTATION_PERMIT_SCHEMA,
    mutationId: `mutation:${epoch}:${sequence}:${requestDigest.slice(0, 32)}`,
    operationId: `operation:${requestDigest}`,
    requestDigest,
    mutationSequence: sequence,
    semanticScope: "operator-registry",
    claimId: `claim-${epoch}`,
    leaseEpoch: epoch,
    leaseExpiresAtMs: expiresAt,
    fenceRevision: `fence-${epoch}`,
    requiredWriteTarget: "registry",
    reservedAtMs: reservedAt,
  };
}

function requestFor(body, permit) {
  const bodyText = JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json", ...authoringMutationHeaders(permit) });
  const input = createCommerceAdmissionAuthInput({
    method: "POST",
    url: URL,
    bodyDigest: createHash("sha256").update(bodyText).digest("hex"),
    headers,
  });
  headers.set("x-agentic-os-admission-auth-schema", "commerce-agentic-os-admission-auth/v1");
  headers.set(
    "x-agentic-os-admission-auth-signature",
    createHmac("sha256", AUTH_SECRET).update(canonicalJson(input)).digest("hex"),
  );
  return new Request(URL, {
    method: "POST",
    headers,
    body: bodyText,
  });
}

function readyRequest() {
  const url = `${URL}/readyz`;
  const headers = new Headers();
  const input = createCommerceAdmissionAuthInput({
    method: "GET",
    url,
    bodyDigest: createHash("sha256").update("").digest("hex"),
    headers,
  });
  headers.set("x-agentic-os-admission-auth-schema", "commerce-agentic-os-admission-auth/v1");
  headers.set("x-agentic-os-admission-auth-signature", createHmac("sha256", AUTH_SECRET)
    .update(canonicalJson(input)).digest("hex"));
  return new Request(url, { headers });
}

function createBoundTestAuthority() {
  const projection = (authorization) => Object.freeze({
    schema: "agentic-graph-commerce-admission-authority-projection/v1",
    authority_ref: "authority://agentic-graph/commerce-admission/durability-test",
    evidence_digest: "a".repeat(64),
    issuer_repository: "huijoohwee/agentic-graph",
    issuer_revision: "b".repeat(40),
    expires_at_ms: 4_000_000_000_000,
    admission_inputs_digest: authorization.admissionInputsDigest,
    admission_request_digest: authorization.admissionRequestDigest,
    permit_digest: authorization.permitDigest,
  });
  return Object.freeze({
    async status() {
      return Object.freeze({ ok: true, code: null, projection: projection({
        admissionInputsDigest: "c".repeat(64), admissionRequestDigest: "d".repeat(64), permitDigest: "e".repeat(64),
      }) });
    },
    async authorize(reference, authorization) {
      const valid = reference === OPERATOR_REF && authorization && Object.keys(authorization).length === 3
        && Object.values(authorization).every((value) => /^[0-9a-f]{64}$/u.test(value));
      return Object.freeze(valid ? { ok: true, code: null, projection: projection(authorization) } : { ok: false, code: "authority_invalid" });
    },
    async resolveOperatorInstruction(reference) { return Object.freeze({ resolved: reference === OPERATOR_REF, reference }); },
  });
}

function runtimeState(namespace, storeOverride) {
  const registry = createAgentDefinitionRegistry();
  const authority = createBoundTestAuthority();
  const registrationInterface = createAdapterRegistrationInterface({
    agentDefinitionRegistry: registry,
    toolAllowlist: createCommerceToolAllowlistProjection(),
    invocationRegister: createCommerceInvocationRegister(),
    resolveOperatorInstruction: authority.resolveOperatorInstruction,
    now: namespace.now,
  });
  const store = storeOverride ?? createDurableObjectCommerceAdmissionStore({ namespace });
  const provider = createCommerceAdmissionProvider({
    store,
    registrationInterface,
    authority,
    deploymentIdentity: DEPLOYMENT_IDENTITY,
    authSecret: AUTH_SECRET,
    now: namespace.now,
  });
  return { provider, registry, store };
}

function runtime(namespace) {
  return runtimeState(namespace).provider;
}

test("a durable agent revision owner rejects stale-isolate content drift and preserves exact replay", async () => {
  const namespace = createNamespace();
  const stale = runtime(namespace);
  assert.equal((await stale.handle(readyRequest())).status, 200);

  const owning = runtime(namespace);
  const firstBody = bodyFor("Canonical discovery definition.");
  const firstPermit = await permitFor(firstBody, 1);
  const first = await owning.handle(requestFor(firstBody, firstPermit));
  const firstText = await first.text();
  assert.equal(first.status, 200);
  const committedWrites = namespace.writes();

  const conflictBody = bodyFor("Different bytes at the same revision.");
  const conflictPermit = await permitFor(conflictBody, 2);
  for (const provider of [stale, owning]) {
    const conflict = await provider.handle(requestFor(conflictBody, conflictPermit));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).finding.reason_code, "agent_revision_conflict");
    assert.equal(namespace.writes(), committedWrites);
  }

  namespace.restart();
  const restarted = runtime(namespace);
  const afterRestart = await restarted.handle(requestFor(conflictBody, conflictPermit));
  assert.equal(afterRestart.status, 409);
  assert.equal((await afterRestart.json()).finding.reason_code, "agent_revision_conflict");
  assert.equal(namespace.writes(), committedWrites);
  const replay = await restarted.handle(requestFor(firstBody, firstPermit));
  assert.equal(replay.status, 200);
  assert.equal(await replay.text(), firstText);
  assert.equal(namespace.writes(), committedWrites);
});

test("corrupt or orphaned registration indexes make readyz and admission fail closed without writes", async () => {
  const corruptions = [
    ["non-array", (records) => records.set(INDEX_KEY, { agent: "agent-durable" })],
    ["duplicate", (records) => records.set(INDEX_KEY, ["agent-durable", "agent-durable"])],
    ["invalid id", (records) => records.set(INDEX_KEY, [""])],
    ["missing record", (records) => records.delete("commerce-admission:registration:agent-durable")],
  ];
  for (const [label, corrupt] of corruptions) {
    const namespace = createNamespace();
    const firstBody = bodyFor();
    const firstPermit = await permitFor(firstBody, 1);
    assert.equal((await runtime(namespace).handle(requestFor(firstBody, firstPermit))).status, 200, label);
    namespace.corrupt(corrupt);
    namespace.restart();
    const provider = runtime(namespace);
    const writes = namespace.writes();
    const ready = await provider.handle(readyRequest());
    assert.equal(ready.status, 503, label);
    assert.equal((await ready.json()).code, "projection_unavailable", label);

    const nextBody = bodyFor("Another valid registration.", `agent-next-${label.replaceAll(" ", "-")}`);
    const nextPermit = await permitFor(nextBody, 2);
    const admission = await provider.handle(requestFor(nextBody, nextPermit));
    assert.equal(admission.status, 503, label);
    assert.equal((await admission.json()).finding.reason_code, "projection_unavailable", label);
    assert.equal(namespace.writes(), writes, label);
  }
});

test("expired outcomes compact safely so more than 64 revisions remain writable", async () => {
  const namespace = createNamespace();
  const provider = runtime(namespace);
  let firstBody;
  let firstPermit;
  let retainedBody;
  let retainedPermit;
  let retainedText;
  for (let sequence = 1; sequence <= 70; sequence += 1) {
    const clock = NOW + sequence * 1_000;
    namespace.setNow(clock);
    const body = bodyFor(`Revision ${sequence}.`);
    body.agent_definition.revision = `agent-durable-v${sequence}`;
    body.tool_allowlist_entry.entry_id = `allowlist-agent-durable-v${sequence}`;
    const permit = await permitFor(body, sequence, {
      epoch: sequence,
      expiresAt: clock + 500,
      reservedAt: clock - 1,
    });
    const response = await provider.handle(requestFor(body, permit));
    const text = await response.text();
    assert.equal(response.status, 200, `revision ${sequence}: ${text}`);
    if (sequence === 1) { firstBody = body; firstPermit = permit; }
    if (sequence === 70) { retainedBody = body; retainedPermit = permit; retainedText = text; }
  }
  const outcomeIndex = await new Promise((resolve) => namespace.corrupt((records) => (
    resolve(structuredClone(records.get(OUTCOME_INDEX_KEY)))
  )));
  assert.equal(outcomeIndex.length, 64);
  assert.equal(namespace.keys().filter((key) => key.includes(":allowlist-owner:")).length, 1);
  namespace.restart();
  const restarted = runtime(namespace);
  const writes = namespace.writes();
  namespace.setNow(retainedPermit.leaseExpiresAtMs + 1);
  const replay = await restarted.handle(requestFor(retainedBody, retainedPermit));
  assert.equal(replay.status, 200);
  assert.equal(await replay.text(), retainedText);
  assert.equal(namespace.writes(), writes);

  const retired = await restarted.handle(requestFor(firstBody, firstPermit));
  assert.equal(retired.status, 409);
  assert.equal((await retired.json()).finding.reason_code, "lease_expired");
  assert.equal(namespace.writes(), writes);
});

test("delayed older commit responses cannot project over the durable current revision", async () => {
  const namespace = createNamespace();
  const durableStore = createDurableObjectCommerceAdmissionStore({ namespace });
  let releaseFirst;
  let announceFirst;
  const firstCommitted = new Promise((resolve) => { announceFirst = resolve; });
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });
  const delayedStore = {
    snapshot: durableStore.snapshot,
    async register(value) {
      const result = await durableStore.register(value);
      if (value.authoringMutationIntent.admissionInputs.agentDefinition.revision.endsWith("-v1")) {
        announceFirst();
        await firstRelease;
      }
      return result;
    },
  };
  const { provider, registry } = runtimeState(namespace, delayedStore);
  const firstBody = bodyFor("Revision one.", "agent-projection-race");
  const firstPermit = await permitFor(firstBody, 1);
  const firstRequest = provider.handle(requestFor(firstBody, firstPermit));
  await firstCommitted;

  const secondBody = bodyFor("Revision two.", "agent-projection-race");
  secondBody.agent_definition.revision = "agent-projection-race-v2";
  secondBody.tool_allowlist_entry.entry_id = "allowlist-agent-projection-race-v2";
  const secondPermit = await permitFor(secondBody, 2);
  const second = await provider.handle(requestFor(secondBody, secondPermit));
  assert.equal(second.status, 200);
  releaseFirst();
  assert.equal((await firstRequest).status, 200);

  const durable = await durableStore.list();
  assert.equal(durable[0].intent.admissionInputs.agentDefinition.revision, "agent-projection-race-v2");
  assert.match(registry.snapshot().serialization, /agent-projection-race-v2/u);
  assert.doesNotMatch(registry.snapshot().serialization, /Revision one/u);
});
