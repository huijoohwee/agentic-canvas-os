import assert from "node:assert/strict";

import { createAdapterRegistrationInterface } from "../../agent-api/src/adapter-registration.js";
import { createAgentDefinitionRegistry } from "../../agent-api/src/agent-definitions.js";
import {
  AUTHORING_HEADERS,
  AUTHORING_MUTATION_PERMIT_SCHEMA,
  COMMERCE_ADMISSION_PATH,
  authoringMutationHeaders,
  commerceAdmissionRequestDigest,
} from "../../agent-api/src/commerce-admission-contract.js";
import {
  createCommerceAdmissionProvider,
  createCommerceInvocationRegister,
  createCommerceToolAllowlistProjection,
} from "../../agent-api/src/commerce-admission-provider.js";
import { createDurableObjectCommerceAdmissionStore } from "../../agent-api/src/durable-object-state-store.js";
import { AgentState } from "../../worker/agent-state.js";
import {
  AGENTIC_OS_ADMISSION_TEST_SECRET,
  GRAPH_AUTHORITY_OPERATOR_REF,
  createAdmissionAuthFixture,
} from "./commerce-admission-auth-fixture.mjs";

export const NOW = 1_800_000_000_000;
export const OPERATOR_REF = GRAPH_AUTHORITY_OPERATOR_REF;
export const URL = `https://agentic-os-admission.internal${COMMERCE_ADMISSION_PATH}`;
export const AUTH_SECRET = AGENTIC_OS_ADMISSION_TEST_SECRET;
const authFixture = createAdmissionAuthFixture(URL);
export const { authenticatedPost, readyRequest } = authFixture;

class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
    this.writes = 0;
  }

  async transaction(operation) {
    const result = this.transactionTail.then(() => operation(this));
    this.transactionTail = result.catch(() => {});
    return result;
  }

  async get(key) { return this.records.get(key); }

  async put(key, value) {
    this.writes += 1;
    this.records.set(key, structuredClone(value));
  }

  async delete(key) {
    this.writes += 1;
    return this.records.delete(key);
  }

  async getAlarm() { return null; }

  async setAlarm() { this.writes += 1; }

  async deleteAlarm() { this.writes += 1; }
}

export function createNamespace() {
  const instances = new Map();
  const storages = new Map();
  function instance(id) {
    if (!storages.has(id)) storages.set(id, new MemoryStorage());
    if (!instances.has(id)) instances.set(id, new AgentState({ storage: storages.get(id) }));
    return instances.get(id);
  }
  return Object.freeze({
    idFromName: (name) => name,
    get(id) {
      return Object.freeze({
        fetch: (input, init) => instance(id).fetch(input instanceof Request ? input : new Request(input, init)),
      });
    },
    commerceRegisterAt: (value, now) => instance("commerce-admission:operator-registry")
      .commerceAdmissionRegister(value, now),
    restart() { instances.clear(); },
    writes() {
      return [...storages.values()].reduce((total, storage) => total + storage.writes, 0);
    },
  });
}

function createBoundTestAuthority() {
  const projection = (authorization) => Object.freeze({
    schema: "agentic-graph-commerce-admission-authority-projection/v1",
    authority_ref: "authority://agentic-graph/commerce-admission/test-only",
    evidence_digest: "a".repeat(64),
    issuer_repository: "huijoohwee/agentic-graph",
    issuer_revision: "b".repeat(40),
    expires_at_ms: NOW + 60_000,
    admission_inputs_digest: authorization.admissionInputsDigest,
    admission_request_digest: authorization.admissionRequestDigest,
    permit_digest: authorization.permitDigest,
  });
  const defaultAuthorization = Object.freeze({
    admissionInputsDigest: "c".repeat(64), admissionRequestDigest: "d".repeat(64), permitDigest: "e".repeat(64),
  });
  return Object.freeze({
    async status() { return Object.freeze({ ok: true, code: null, projection: projection(defaultAuthorization) }); },
    async authorize(reference, authorization) {
      const valid = reference === OPERATOR_REF && authorization && Object.keys(authorization).length === 3
        && Object.values(authorization).every((value) => /^[0-9a-f]{64}$/u.test(value));
      return Object.freeze(valid ? { ok: true, code: null, projection: projection(authorization) } : { ok: false, code: "authority_invalid" });
    },
    async resolveOperatorInstruction(reference) { return Object.freeze({ resolved: reference === OPERATOR_REF, reference }); },
  });
}

export function registrationBody(agentId = "agent-flight", overrides = {}) {
  const admissionInputs = {
    agentDefinition: {
      id: agentId,
      revision: `${agentId}-v1`,
      name: `${agentId} discovery`,
      source: { uri: `workspace:/agents/${agentId}.json`, digest: "1".repeat(64) },
      model: { providerId: "workspace-provider", modelId: "workspace-model" },
      instructions: [{ name: "purpose", content: "Discover bounded commerce offers." }],
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
  const authoringMutationIntent = {
    admissionInputs,
    commerceProjection: { category: "flight", discoveryTool: "commerce.flight.discover" },
    expectedPreviousContentHash: null,
    invocationProof: { sourceRevision: "a".repeat(40) },
    sandboxDryRun: { ok: true, digest: "b".repeat(64) },
    ...overrides,
  };
  return {
    agent_definition: admissionInputs.agentDefinition,
    tool_allowlist_entry: admissionInputs.toolAllowlistEntry,
    invocation_register_entry: admissionInputs.invocationRegisterEntry,
    operator_instruction_ref: admissionInputs.operatorInstructionRef,
    authoring_mutation_intent: authoringMutationIntent,
  };
}

export async function permitFor(body, {
  epoch = 1,
  sequence = 1,
  expiresAt = NOW + 60_000,
  reservedAt = NOW - 1_000,
} = {}) {
  const requestDigest = await commerceAdmissionRequestDigest(body.authoring_mutation_intent);
  return Object.freeze({
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
  });
}

export function requestFor(body, permit, { headers = {}, rawBody } = {}) {
  return authenticatedPost(rawBody ?? JSON.stringify(body), {
    "content-type": "application/json",
    ...authoringMutationHeaders(permit),
    ...headers,
  });
}

export function createRuntime(namespace, { projectionFail, now = () => NOW } = {}) {
  const registry = createAgentDefinitionRegistry();
  const authority = createBoundTestAuthority();
  const registrationInterface = createAdapterRegistrationInterface({
    agentDefinitionRegistry: registry,
    toolAllowlist: createCommerceToolAllowlistProjection({ fail: projectionFail }),
    invocationRegister: createCommerceInvocationRegister(),
    resolveOperatorInstruction: authority.resolveOperatorInstruction,
    now,
  });
  const store = createDurableObjectCommerceAdmissionStore({ namespace });
  return {
    registry,
    registrationInterface,
    store,
    provider: createCommerceAdmissionProvider({
      store, registrationInterface, authority, now,
      authSecret: AUTH_SECRET,
    }),
    authority,
  };
}

export async function responseBody(response) {
  return { text: await response.text(), response };
}

export function assertEcho(response, permit) {
  for (const [name, value] of Object.entries(authoringMutationHeaders(permit))) {
    assert.equal(response.headers.get(name), value, `${name} must echo exactly`);
  }
}

export function assertNoFenceEcho(response) {
  for (const name of Object.values(AUTHORING_HEADERS)) assert.equal(response.headers.get(name), null);
}
