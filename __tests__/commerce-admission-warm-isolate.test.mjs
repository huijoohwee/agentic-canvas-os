import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readAuthoringMutationPermit } from "../agent-api/src/commerce-admission-contract.js";
import { AgentState } from "../worker/agent-state.js";
import { handleCloudflareRequest } from "../worker/index.js";
import {
  createGraphAuthorityBinding,
  createGraphAuthorityFixture,
} from "./lib/commerce-admission-auth-fixture.mjs";

const AUTH_SECRET = "agentic-os-admission-dev-secret-rotate-before-production";

class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.tail = Promise.resolve();
  }

  async transaction(operation) {
    const pending = this.tail.then(() => operation(this));
    this.tail = pending.catch(() => {});
    return pending;
  }

  async get(key) { return this.records.get(key); }
  async put(key, value) { this.records.set(key, structuredClone(value)); }
  async delete(key) { return this.records.delete(key); }
  async getAlarm() { return null; }
  async setAlarm() {}
  async deleteAlarm() {}
}

function createNamespace() {
  const storage = new MemoryStorage();
  const instances = new Map();
  return Object.freeze({
    idFromName: (name) => name,
    get(id) {
      if (!instances.has(id)) instances.set(id, new AgentState({ storage }));
      return Object.freeze({
        fetch: (input, init) => instances.get(id).fetch(
          input instanceof Request ? input : new Request(input, init),
        ),
      });
    },
  });
}

function environment(namespace, fixture) {
  const now = Date.now();
  const permit = readAuthoringMutationPermit(new Headers(fixture.request.headers));
  if (!permit) throw new TypeError("Fixture admission permit is malformed.");
  const authority = createGraphAuthorityFixture({
    authorization: createGraphAuthorityBinding({
      authoringMutationIntent: fixture.request.body.authoring_mutation_intent,
      permit,
    }),
    operatorInstructionRef: fixture.request.body.operator_instruction_ref,
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
  });
  return {
    AGENT_STATE: namespace,
    AGENTIC_OS_ADMISSION_AUTH_SECRET: AUTH_SECRET,
    AGENTIC_OS_ADMISSION_AUTHORITY_REF: authority.authorityRef,
    AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF: authority.operatorInstructionRef,
    AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE: authority.evidence,
    AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET: authority.secret,
  };
}

test("a warm isolate refreshes its public definition projection when another isolate commits", async () => {
  const fixture = JSON.parse(await readFile(new URL(
    "../test/contracts/agentic-os-admission-v2.fixture.json",
    import.meta.url,
  )));
  const namespace = createNamespace();
  const isolateA = environment(namespace, fixture);
  const isolateB = environment(namespace, fixture);
  const readyRequest = () => new Request("https://airvio.co/api/ready");

  const before = await (await handleCloudflareRequest(readyRequest(), isolateA)).json();
  assert.equal(before.agentDefinitions.agents, 0);

  const committed = await handleCloudflareRequest(new Request(fixture.request.url, {
    method: fixture.request.method,
    headers: fixture.request.headers,
    body: JSON.stringify(fixture.request.body),
  }), isolateB);
  assert.equal(committed.status, 200);

  const refreshed = await (await handleCloudflareRequest(readyRequest(), isolateA)).json();
  assert.equal(refreshed.agentDefinitions.agents, 1);
  assert.equal(refreshed.agentDefinitions.configured, true);
  assert.equal(refreshed.agentDefinitions.statusCounts.active, 1);
});
