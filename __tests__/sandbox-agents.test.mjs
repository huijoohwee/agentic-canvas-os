import test from "node:test";
import assert from "node:assert/strict";

import { SANDBOX_AGENT_CAPABILITIES } from "../agent-api/src/sandbox-agent-contract.js";
import { createSandboxAgentRuntime } from "../agent-api/src/sandbox-agents.js";

function createStateStore() {
  const values = new Map();
  return {
    put: async (key, value) => values.set(key, value),
    get: async (key) => values.get(key),
    delete: async (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

function createIdFactory() {
  let next = 0;
  return (kind) => `${kind}-${++next}`;
}

function attestation(overrides = {}) {
  return {
    providerId: "container-provider",
    providerRevision: "container-provider-v1",
    executionBoundary: "container",
    fresh: true,
    capabilities: [...SANDBOX_AGENT_CAPABILITIES],
    ...overrides,
  };
}

function createAdapter(overrides = {}) {
  const requests = { create: [], execute: [], snapshot: [], suspend: [], resume: [], close: [] };
  const adapter = {
    descriptor: {
      id: "container-provider",
      revision: "container-provider-v1",
      capabilities: [...SANDBOX_AGENT_CAPABILITIES],
      executionBoundary: "container",
    },
    create: async (request) => {
      requests.create.push(request);
      return {
        providerSessionId: `provider-session-${requests.create.length}`,
        state: { version: requests.create.length },
        attestation: attestation(),
        cost: { status: "reported", amountUsd: 0.01 },
      };
    },
    execute: async (request) => {
      requests.execute.push(request);
      return {
        output: { kind: request.operation.kind, accepted: true },
        state: { version: requests.execute.length + 1 },
        attestation: attestation(),
        cost: { status: "reported", amountUsd: 0.01 },
      };
    },
    snapshot: async (request) => {
      requests.snapshot.push(request);
      return {
        providerSnapshotId: `provider-snapshot-${requests.snapshot.length}`,
        metadata: { files: 3 },
        attestation: attestation(),
        cost: { status: "reported", amountUsd: 0.01 },
      };
    },
    suspend: async (request) => {
      requests.suspend.push(request);
      return {
        serializedState: { providerCursor: requests.suspend.length },
        attestation: attestation(),
        cost: { status: "reported", amountUsd: 0.01 },
      };
    },
    resume: async (request) => {
      requests.resume.push(request);
      return {
        providerSessionId: `provider-resumed-${requests.resume.length}`,
        state: { version: 100 + requests.resume.length },
        attestation: attestation(),
        cost: { status: "reported", amountUsd: 0.01 },
      };
    },
    close: async (request) => {
      requests.close.push(request);
      return {
        closed: true,
        attestation: attestation(),
        cost: { status: "reported", amountUsd: 0.01 },
      };
    },
    ...overrides,
  };
  return { adapter, requests };
}

function workspace() {
  return {
    revision: "workspace-v1",
    directories: ["src", "output"],
    files: [{ path: "src/input.txt", content: "hello" }],
    environmentBindings: ["PACKAGE_TOKEN"],
  };
}

function runtimeOptions(adapter, stateStore = createStateStore(), overrides = {}) {
  return {
    adapter,
    stateStore,
    authorize: async ({ action }) => ({ allowed: true, approvalId: `approval-${action}` }),
    createId: createIdFactory(),
    ...overrides,
  };
}

async function open(runtime, overrides = {}) {
  return runtime.open({
    runId: "run-1",
    agentId: "agent-1",
    workspace: workspace(),
    requiredCapabilities: [...SANDBOX_AGENT_CAPABILITIES],
    ...overrides,
  });
}

test("runs bounded file, command, package, and port work through one attested container provider", async () => {
  const { adapter, requests } = createAdapter();
  const runtime = createSandboxAgentRuntime(runtimeOptions(adapter));
  const started = await open(runtime);
  assert.equal(started.status, "ready");
  assert.equal(started.provider.executionBoundary, "container");
  assert.equal(started.evidence.containerExecutionStatus, "provider-attested");
  assert.equal(started.evidence.independentContainmentProof, "unverified");

  const operations = [
    { kind: "file.read", path: "src/input.txt" },
    { kind: "file.write", path: "output/report.md", content: "done" },
    { kind: "command.run", argv: ["node", "scripts/check.mjs"], cwd: "src" },
    { kind: "package.install", manager: "npm", packages: ["yaml", "@scope/tool@1.2.3"] },
    { kind: "port.open", containerPort: 4_173, protocol: "http", audience: "preview" },
  ];
  for (const [index, operation] of operations.entries()) {
    const result = await runtime.execute({ sandboxId: started.sandboxId, runId: "run-1", operation });
    assert.equal(result.status, "completed");
    assert.equal(result.operation.sequence, index + 1);
    assert.equal(result.output.kind, operation.kind);
    assert.equal(JSON.stringify(result).includes("providerSessionId"), false);
  }
  assert.deepEqual(requests.execute[2].operation.argv, ["node", "scripts/check.mjs"]);
  assert.equal(requests.execute[4].operation.audience, "preview");

  const closed = await runtime.close({ sandboxId: started.sandboxId, runId: "run-1" });
  assert.equal(closed.status, "closed");
  assert.equal(closed.cost.amountUsd, 0.07);
  assert.equal(runtime.stats().activeSandboxes, 0);
  assert.equal(runtime.stats().operationCount, 5);
});

test("fails closed without an adapter, authorizer, capability, or safe workspace and port scope", async () => {
  assert.equal((await open(createSandboxAgentRuntime())).reasonCode, "sandbox_adapter_unconfigured");

  const { adapter } = createAdapter();
  const noAuthorizer = createSandboxAgentRuntime({ adapter, createId: createIdFactory() });
  assert.equal((await open(noAuthorizer)).reasonCode, "sandbox_authorizer_unconfigured");

  const denied = createSandboxAgentRuntime(runtimeOptions(adapter, createStateStore(), {
    authorize: async () => ({ allowed: false, reasonCode: "operator_approval_missing" }),
  }));
  assert.equal((await open(denied)).reasonCode, "operator_approval_missing");

  const runtime = createSandboxAgentRuntime(runtimeOptions(adapter));
  assert.equal((await open(runtime, {
    workspace: { ...workspace(), files: [{ path: "../outside.txt", content: "no" }] },
  })).reasonCode, "workspace_path_invalid");
  const started = await open(runtime, { runId: "run-safe" });
  const publicPort = await runtime.execute({
    sandboxId: started.sandboxId,
    runId: "run-safe",
    operation: { kind: "port.open", containerPort: 80, protocol: "http", audience: "public" },
  });
  assert.equal(publicPort.reasonCode, "port_audience_forbidden");
});

test("requires exact provider capabilities and fresh container attestation", async () => {
  const missing = createAdapter();
  missing.adapter.descriptor.capabilities = ["files"];
  const missingRuntime = createSandboxAgentRuntime(runtimeOptions(missing.adapter));
  assert.equal((await open(missingRuntime)).reasonCode, "provider_capability_missing");

  const stale = createAdapter({
    create: async () => ({
      providerSessionId: "stale-session",
      state: {},
      attestation: attestation({ fresh: false }),
      cost: { status: "not-run" },
    }),
  });
  const staleRuntime = createSandboxAgentRuntime(runtimeOptions(stale.adapter));
  assert.equal((await open(staleRuntime)).reasonCode, "container_attestation_missing");
  assert.equal(staleRuntime.stats().providerAttestationCount, 0);
});

test("serializes operations per sandbox while allowing the accepted operation to settle", async () => {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const { adapter } = createAdapter({
    execute: async (request) => {
      entered();
      await new Promise((resolve) => { release = resolve; });
      return {
        output: { path: request.operation.path },
        attestation: attestation(),
        cost: { status: "unreported" },
      };
    },
  });
  const runtime = createSandboxAgentRuntime(runtimeOptions(adapter));
  const started = await open(runtime);
  const first = runtime.execute({
    sandboxId: started.sandboxId,
    runId: "run-1",
    operation: { kind: "file.read", path: "src/input.txt" },
  });
  await enteredPromise;
  const competing = await runtime.execute({
    sandboxId: started.sandboxId,
    runId: "run-1",
    operation: { kind: "file.read", path: "src/input.txt" },
  });
  assert.equal(competing.reasonCode, "sandbox_busy");
  release();
  assert.equal((await first).status, "completed");
  assert.equal(runtime.stats().operationCount, 1);
});

test("creates an opaque snapshot and seeds a fresh sandbox without exposing provider identity", async () => {
  const stateStore = createStateStore();
  const { adapter, requests } = createAdapter();
  const runtime = createSandboxAgentRuntime(runtimeOptions(adapter, stateStore));
  const started = await open(runtime);
  const saved = await runtime.snapshot({ sandboxId: started.sandboxId, runId: "run-1" });
  assert.equal(saved.status, "completed");
  assert.equal(saved.metadata.files, 3);
  assert.equal(JSON.stringify(saved).includes("provider-snapshot"), false);

  const seeded = await runtime.open({
    runId: "run-2",
    agentId: "agent-1",
    snapshotToken: saved.snapshotToken,
    requiredCapabilities: [...SANDBOX_AGENT_CAPABILITIES],
  });
  assert.equal(seeded.status, "ready");
  assert.equal(seeded.stage, "seeded");
  assert.equal(seeded.workspaceRevision, "workspace-v1");
  assert.equal(requests.create[1].providerSnapshotId, "provider-snapshot-1");
  assert.equal(requests.create[1].workspace, undefined);
});

test("pauses and resumes the same sandbox across controller instances through an external state store", async () => {
  const stateStore = createStateStore();
  const ids = createIdFactory();
  const { adapter, requests } = createAdapter();
  const firstRuntime = createSandboxAgentRuntime(runtimeOptions(adapter, stateStore, { createId: ids }));
  const started = await open(firstRuntime);
  await firstRuntime.execute({
    sandboxId: started.sandboxId,
    runId: "run-1",
    operation: { kind: "file.write", path: "output/work.txt", content: "checkpoint" },
  });
  const paused = await firstRuntime.pause({ sandboxId: started.sandboxId, runId: "run-1" });
  assert.equal(paused.status, "paused");
  assert.equal(firstRuntime.stats().activeSandboxes, 0);
  assert.equal(JSON.stringify(paused).includes("providerCursor"), false);

  const secondRuntime = createSandboxAgentRuntime(runtimeOptions(adapter, stateStore, { createId: ids }));
  const mismatch = await secondRuntime.resume({
    runId: "another-run",
    agentId: "agent-1",
    resumeToken: paused.resumeToken,
  });
  assert.equal(mismatch.reasonCode, "sandbox_resume_identity_mismatch");
  const resumed = await secondRuntime.resume({
    runId: "run-1",
    agentId: "agent-1",
    resumeToken: paused.resumeToken,
  });
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.stage, "resumed");
  assert.equal(resumed.sandboxId, started.sandboxId);
  assert.deepEqual(resumed.cost, { status: "partial", amountUsd: 0.04 });
  assert.equal(requests.resume[0].serializedState.providerCursor, 1);
  assert.equal(stateStore.has(`resume:${paused.resumeToken}`), false);
});

test("rejects sensitive provider output and redacts unexpected provider failures", async () => {
  let mode = "sensitive";
  const { adapter } = createAdapter({
    execute: async () => {
      if (mode === "throw") throw new Error("provider secret=should-not-leak");
      return {
        output: { apiKey: "should-not-leak" },
        attestation: attestation(),
        cost: { status: "unreported" },
      };
    },
  });
  const runtime = createSandboxAgentRuntime(runtimeOptions(adapter));
  const started = await open(runtime);
  const sensitive = await runtime.execute({
    sandboxId: started.sandboxId,
    runId: "run-1",
    operation: { kind: "file.read", path: "src/input.txt" },
  });
  assert.equal(sensitive.reasonCode, "provider_output_sensitive");
  assert.equal(JSON.stringify(sensitive).includes("should-not-leak"), false);

  mode = "throw";
  const failure = await runtime.execute({
    sandboxId: started.sandboxId,
    runId: "run-1",
    operation: { kind: "file.read", path: "src/input.txt" },
  });
  assert.equal(failure.reasonCode, "sandbox_provider_failure");
  assert.equal(JSON.stringify(failure).includes("should-not-leak"), false);
});
