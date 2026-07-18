import { normalizeJson } from "./json-contract.js";
import {
  SANDBOX_AGENT_CAPABILITIES,
  SandboxAgentBlock,
  assertExactKeys,
  assertIdentifier,
  assertPositiveInteger,
  capabilityForOperation,
  normalizeAuthorization,
  normalizeCloseOutcome,
  normalizeExecutionOutcome,
  normalizeOpenRequest,
  normalizeOperation,
  normalizeSandboxAdapter,
  normalizeSessionOutcome,
  normalizeSnapshotOutcome,
  normalizeSuspendOutcome,
  requireSandboxMethod,
} from "./sandbox-agent-contract.js";

const DEFAULT_LIMITS = Object.freeze({
  maxActiveSandboxes: 32,
  maxOperationsPerSandbox: 256,
  maxWorkspaceEntries: 256,
  maxWorkspaceChars: 500_000,
  maxFileChars: 200_000,
  maxCommandArguments: 64,
  maxArgumentChars: 4_096,
  maxPackages: 64,
  maxOutputChars: 200_000,
  maxStateChars: 500_000,
  operationTimeoutMs: 30_000,
});

function defaultCreateId(kind) {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") {
    throw new SandboxAgentBlock("sandbox_id_unavailable", "A secure sandbox identifier generator is required.");
  }
  return `${kind}-${globalThis.crypto.randomUUID()}`;
}

function blocked(stage, error, extra = {}) {
  const safeError = error instanceof SandboxAgentBlock
    ? error
    : new SandboxAgentBlock("sandbox_provider_failure", "Sandbox provider operation failed.");
  return Object.freeze({
    status: "blocked",
    stage,
    reasonCode: safeError.reasonCode,
    message: safeError.message,
    ...extra,
  });
}

function aggregateCost(record, cost) {
  if (cost.status === "reported") record.reportedCostUsd += cost.amountUsd;
  if (cost.status === "unreported") record.unreportedCostEvents += 1;
}

function publicCost(record) {
  if (record.unreportedCostEvents > 0 && record.reportedCostUsd > 0) {
    return Object.freeze({ status: "partial", amountUsd: record.reportedCostUsd });
  }
  if (record.unreportedCostEvents > 0) return Object.freeze({ status: "unreported" });
  return Object.freeze({ status: "reported", amountUsd: record.reportedCostUsd });
}

async function callWithTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new SandboxAgentBlock("sandbox_timeout", `Sandbox operation exceeded ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createSandboxAgentRuntime({
  adapter,
  authorize,
  stateStore,
  createId = defaultCreateId,
  ...limitOverrides
} = {}) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  for (const [field, value] of Object.entries(limits)) assertPositiveInteger(value, field);
  if (authorize !== undefined && typeof authorize !== "function") throw new TypeError("authorize must be a function when provided.");
  if (typeof createId !== "function") throw new TypeError("createId must be a function.");
  if (stateStore !== undefined) {
    for (const method of ["put", "get", "delete"]) requireSandboxMethod(stateStore, method);
  }
  const configuredAdapter = normalizeSandboxAdapter(adapter);
  const active = new Map();
  let openingCount = 0;
  let openedCount = 0;
  let operationCount = 0;
  let snapshotCount = 0;
  let pausedCount = 0;
  let resumedCount = 0;
  let closedCount = 0;
  let blockedCount = 0;
  let providerAttestationCount = 0;

  async function authorizeAction(action, context) {
    if (typeof authorize !== "function") {
      throw new SandboxAgentBlock("sandbox_authorizer_unconfigured", "Sandbox actions require an application authorizer.");
    }
    return normalizeAuthorization(await authorize(Object.freeze({ action, ...context })), action);
  }

  function requireAdapter() {
    if (!configuredAdapter) {
      throw new SandboxAgentBlock("sandbox_adapter_unconfigured", "A container sandbox adapter is required.");
    }
    return configuredAdapter;
  }

  function requireStateStore(capability) {
    if (!stateStore) {
      throw new SandboxAgentBlock("sandbox_state_store_unconfigured", `${capability} requires an external sandbox state store.`);
    }
    return stateStore;
  }

  function issueId(kind) {
    return assertIdentifier(createId(kind), `${kind}Id`);
  }

  function requireActive({ sandboxId, runId }) {
    const safeSandboxId = assertIdentifier(sandboxId, "sandboxId");
    const record = active.get(safeSandboxId);
    if (!record) throw new SandboxAgentBlock("sandbox_missing", `Sandbox ${safeSandboxId} is not active.`);
    if (record.runId !== assertIdentifier(runId, "runId")) {
      throw new SandboxAgentBlock("sandbox_run_mismatch", "Sandbox run identity does not match.");
    }
    if (record.busy) throw new SandboxAgentBlock("sandbox_busy", "Sandbox already has an active operation.");
    return record;
  }

  function reserveOpening() {
    if (active.size + openingCount >= limits.maxActiveSandboxes) {
      throw new SandboxAgentBlock("sandbox_capacity", `Active sandboxes are limited to ${limits.maxActiveSandboxes}.`);
    }
    openingCount += 1;
  }

  function newRecord({ sandboxId, request, workspaceRevision, session }) {
    return {
      sandboxId,
      runId: request.runId,
      agentId: request.agentId,
      workspaceRevision,
      requiredCapabilities: request.requiredCapabilities,
      providerSessionId: session.providerSessionId,
      state: session.state,
      operations: 0,
      reportedCostUsd: 0,
      unreportedCostEvents: 0,
      busy: false,
    };
  }

  function openedResult(record, stage, approval, session) {
    aggregateCost(record, session.cost);
    providerAttestationCount += 1;
    return Object.freeze({
      status: "ready",
      stage,
      sandboxId: record.sandboxId,
      runId: record.runId,
      agentId: record.agentId,
      workspaceRevision: record.workspaceRevision,
      capabilities: record.requiredCapabilities,
      provider: Object.freeze({
        id: configuredAdapter.descriptor.id,
        revision: configuredAdapter.descriptor.revision,
        executionBoundary: "container",
      }),
      approval,
      cost: publicCost(record),
      evidence: Object.freeze({
        containerExecutionStatus: "provider-attested",
        independentContainmentProof: "unverified",
        opaqueProviderStateReturned: false,
      }),
    });
  }

  async function open(value = {}) {
    let reserved = false;
    try {
      const currentAdapter = requireAdapter();
      reserveOpening();
      reserved = true;
      const request = normalizeOpenRequest(value, limits);
      const missing = request.requiredCapabilities.filter(
        (capability) => !currentAdapter.descriptor.capabilities.includes(capability),
      );
      if (missing.length) {
        throw new SandboxAgentBlock("provider_capability_missing", `Sandbox adapter lacks: ${missing.join(", ")}.`);
      }
      let snapshot;
      let workspaceRevision = request.workspace?.revision;
      if (request.snapshotToken) {
        const store = requireStateStore("Snapshot seeding");
        snapshot = await store.get(`snapshot:${request.snapshotToken}`);
        if (!snapshot) throw new SandboxAgentBlock("sandbox_snapshot_missing", "Sandbox snapshot is missing or expired.");
        if (snapshot.agentId !== request.agentId) {
          throw new SandboxAgentBlock("sandbox_snapshot_agent_mismatch", "Sandbox snapshot belongs to another agent.");
        }
        if (snapshot.providerId !== currentAdapter.descriptor.id
          || snapshot.providerRevision !== currentAdapter.descriptor.revision) {
          throw new SandboxAgentBlock("sandbox_snapshot_provider_mismatch", "Sandbox snapshot provider revision is incompatible.");
        }
        workspaceRevision = snapshot.workspaceRevision;
      }
      const approval = await authorizeAction("workspace.open", {
        runId: request.runId,
        agentId: request.agentId,
        requiredCapabilities: request.requiredCapabilities,
        workspaceRevision,
        source: request.snapshotToken ? "snapshot" : "fresh",
      });
      const sandboxId = issueId("sandbox");
      const session = normalizeSessionOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.create({
          runId: request.runId,
          agentId: request.agentId,
          requiredCapabilities: request.requiredCapabilities,
          workspace: request.workspace,
          ...(snapshot ? { providerSnapshotId: snapshot.providerSnapshotId } : {}),
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        request.requiredCapabilities,
        limits,
        "adapter.create result",
      );
      const record = newRecord({ sandboxId, request, workspaceRevision, session });
      active.set(sandboxId, record);
      openedCount += 1;
      return openedResult(record, request.snapshotToken ? "seeded" : "opened", approval, session);
    } catch (error) {
      blockedCount += 1;
      return blocked("open", error);
    } finally {
      if (reserved) openingCount -= 1;
    }
  }

  async function execute(value = {}) {
    let record;
    try {
      const currentAdapter = requireAdapter();
      assertExactKeys(value, ["sandboxId", "runId", "operation"], "request");
      record = requireActive(value);
      if (record.operations >= limits.maxOperationsPerSandbox) {
        throw new SandboxAgentBlock(
          "sandbox_operation_capacity",
          `Sandbox operations are limited to ${limits.maxOperationsPerSandbox}.`,
        );
      }
      const operation = normalizeOperation(value.operation, limits);
      const capability = capabilityForOperation(operation);
      if (!record.requiredCapabilities.includes(capability)) {
        throw new SandboxAgentBlock("sandbox_capability_not_granted", `Sandbox does not grant ${capability}.`);
      }
      record.busy = true;
      const approval = await authorizeAction(operation.kind, {
        sandboxId: record.sandboxId,
        runId: record.runId,
        agentId: record.agentId,
        operation,
      });
      const outcome = normalizeExecutionOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.execute({
          providerSessionId: record.providerSessionId,
          state: record.state,
          operation,
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        capability,
        limits,
      );
      if (outcome.state) record.state = outcome.state;
      record.operations += 1;
      operationCount += 1;
      providerAttestationCount += 1;
      aggregateCost(record, outcome.cost);
      return Object.freeze({
        status: "completed",
        stage: "execute",
        sandboxId: record.sandboxId,
        operation: Object.freeze({ kind: operation.kind, sequence: record.operations }),
        output: outcome.output,
        approval,
        cost: publicCost(record),
        evidence: Object.freeze({ containerExecutionStatus: "provider-attested", opaqueProviderStateReturned: false }),
      });
    } catch (error) {
      blockedCount += 1;
      return blocked("execute", error);
    } finally {
      if (record) record.busy = false;
    }
  }

  async function snapshot(value = {}) {
    let record;
    try {
      const currentAdapter = requireAdapter();
      const store = requireStateStore("Snapshots");
      assertExactKeys(value, ["sandboxId", "runId"], "request");
      record = requireActive(value);
      if (!record.requiredCapabilities.includes("snapshots")) {
        throw new SandboxAgentBlock("sandbox_capability_not_granted", "Sandbox does not grant snapshots.");
      }
      record.busy = true;
      const approval = await authorizeAction("snapshot.create", {
        sandboxId: record.sandboxId,
        runId: record.runId,
        agentId: record.agentId,
      });
      const outcome = normalizeSnapshotOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.snapshot({
          providerSessionId: record.providerSessionId,
          state: record.state,
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        limits,
      );
      const snapshotToken = issueId("snapshot");
      await store.put(`snapshot:${snapshotToken}`, normalizeJson({
        agentId: record.agentId,
        workspaceRevision: record.workspaceRevision,
        providerId: currentAdapter.descriptor.id,
        providerRevision: currentAdapter.descriptor.revision,
        providerSnapshotId: outcome.providerSnapshotId,
      }, "snapshot record"));
      snapshotCount += 1;
      providerAttestationCount += 1;
      aggregateCost(record, outcome.cost);
      return Object.freeze({
        status: "completed",
        stage: "snapshot",
        sandboxId: record.sandboxId,
        snapshotToken,
        metadata: outcome.metadata,
        approval,
        cost: publicCost(record),
        evidence: Object.freeze({ containerExecutionStatus: "provider-attested", providerSnapshotIdReturned: false }),
      });
    } catch (error) {
      blockedCount += 1;
      return blocked("snapshot", error);
    } finally {
      if (record) record.busy = false;
    }
  }

  async function pause(value = {}) {
    let record;
    try {
      const currentAdapter = requireAdapter();
      const store = requireStateStore("Resume");
      assertExactKeys(value, ["sandboxId", "runId"], "request");
      record = requireActive(value);
      if (!record.requiredCapabilities.includes("resume")) {
        throw new SandboxAgentBlock("sandbox_capability_not_granted", "Sandbox does not grant resume state.");
      }
      record.busy = true;
      const approval = await authorizeAction("workspace.pause", {
        sandboxId: record.sandboxId,
        runId: record.runId,
        agentId: record.agentId,
      });
      const outcome = normalizeSuspendOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.suspend({
          providerSessionId: record.providerSessionId,
          state: record.state,
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        limits,
      );
      aggregateCost(record, outcome.cost);
      const resumeToken = issueId("resume");
      const buildResumeRecord = () => normalizeJson({
        sandboxId: record.sandboxId,
        runId: record.runId,
        agentId: record.agentId,
        workspaceRevision: record.workspaceRevision,
        requiredCapabilities: record.requiredCapabilities,
        providerId: currentAdapter.descriptor.id,
        providerRevision: currentAdapter.descriptor.revision,
        serializedState: outcome.serializedState,
        operations: record.operations,
        reportedCostUsd: record.reportedCostUsd,
        unreportedCostEvents: record.unreportedCostEvents + 1,
      }, "resume record");
      await store.put(`resume:${resumeToken}`, buildResumeRecord());
      const closeOutcome = normalizeCloseOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.close({
          providerSessionId: record.providerSessionId,
          state: record.state,
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        record.requiredCapabilities,
      );
      aggregateCost(record, closeOutcome.cost);
      active.delete(record.sandboxId);
      pausedCount += 1;
      closedCount += 1;
      providerAttestationCount += 2;
      return Object.freeze({
        status: "paused",
        stage: "pause",
        sandboxId: record.sandboxId,
        resumeToken,
        approval,
        cost: publicCost(record),
        evidence: Object.freeze({ containerExecutionStatus: "provider-attested", serializedStateReturned: false }),
      });
    } catch (error) {
      blockedCount += 1;
      return blocked("pause", error);
    } finally {
      if (record && active.has(record.sandboxId)) record.busy = false;
    }
  }

  async function resume(value = {}) {
    let reserved = false;
    try {
      const currentAdapter = requireAdapter();
      const store = requireStateStore("Resume");
      reserveOpening();
      reserved = true;
      assertExactKeys(value, ["runId", "agentId", "resumeToken"], "request");
      const runId = assertIdentifier(value.runId, "request.runId");
      const agentId = assertIdentifier(value.agentId, "request.agentId");
      const resumeToken = assertIdentifier(value.resumeToken, "request.resumeToken");
      const saved = await store.get(`resume:${resumeToken}`);
      if (!saved) throw new SandboxAgentBlock("sandbox_resume_missing", "Sandbox resume state is missing or expired.");
      if (saved.runId !== runId || saved.agentId !== agentId) {
        throw new SandboxAgentBlock("sandbox_resume_identity_mismatch", "Sandbox resume identity does not match.");
      }
      if (saved.providerId !== currentAdapter.descriptor.id
        || saved.providerRevision !== currentAdapter.descriptor.revision) {
        throw new SandboxAgentBlock("sandbox_resume_provider_mismatch", "Sandbox resume provider revision is incompatible.");
      }
      if (active.has(saved.sandboxId)) throw new SandboxAgentBlock("sandbox_busy", "Sandbox is already active.");
      const approval = await authorizeAction("workspace.resume", {
        sandboxId: saved.sandboxId,
        runId,
        agentId,
        workspaceRevision: saved.workspaceRevision,
      });
      const session = normalizeSessionOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.resume({
          serializedState: saved.serializedState,
          requiredCapabilities: saved.requiredCapabilities,
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        saved.requiredCapabilities,
        limits,
        "adapter.resume result",
      );
      const request = Object.freeze({ runId, agentId, requiredCapabilities: saved.requiredCapabilities });
      const record = newRecord({
        sandboxId: saved.sandboxId,
        request,
        workspaceRevision: saved.workspaceRevision,
        session,
      });
      record.operations = saved.operations;
      record.reportedCostUsd = saved.reportedCostUsd;
      record.unreportedCostEvents = saved.unreportedCostEvents;
      await store.delete(`resume:${resumeToken}`);
      active.set(record.sandboxId, record);
      resumedCount += 1;
      return openedResult(record, "resumed", approval, session);
    } catch (error) {
      blockedCount += 1;
      return blocked("resume", error);
    } finally {
      if (reserved) openingCount -= 1;
    }
  }

  async function close(value = {}) {
    let record;
    try {
      const currentAdapter = requireAdapter();
      assertExactKeys(value, ["sandboxId", "runId"], "request");
      record = requireActive(value);
      record.busy = true;
      const outcome = normalizeCloseOutcome(
        await callWithTimeout((signal) => currentAdapter.adapter.close({
          providerSessionId: record.providerSessionId,
          state: record.state,
          signal,
        }), limits.operationTimeoutMs),
        currentAdapter.descriptor,
        record.requiredCapabilities,
      );
      aggregateCost(record, outcome.cost);
      active.delete(record.sandboxId);
      closedCount += 1;
      providerAttestationCount += 1;
      return Object.freeze({
        status: "closed",
        stage: "close",
        sandboxId: record.sandboxId,
        cost: publicCost(record),
        evidence: Object.freeze({ containerExecutionStatus: "provider-attested" }),
      });
    } catch (error) {
      blockedCount += 1;
      return blocked("close", error);
    } finally {
      if (record && active.has(record.sandboxId)) record.busy = false;
    }
  }

  function stats() {
    return Object.freeze({
      configured: Boolean(configuredAdapter && authorize && stateStore),
      adapterConfigured: Boolean(configuredAdapter),
      authorizerConfigured: Boolean(authorize),
      stateStoreConfigured: Boolean(stateStore),
      provider: configuredAdapter
        ? Object.freeze({
          id: configuredAdapter.descriptor.id,
          revision: configuredAdapter.descriptor.revision,
          capabilities: configuredAdapter.descriptor.capabilities,
          executionBoundary: "container",
        })
        : null,
      activeSandboxes: active.size,
      openingSandboxes: openingCount,
      openedCount,
      operationCount,
      snapshotCount,
      pausedCount,
      resumedCount,
      closedCount,
      blockedCount,
      providerAttestationCount,
      containerExecutionStatus: providerAttestationCount > 0 ? "provider-attested" : "unverified",
      independentContainmentProof: "unverified",
      supportedCapabilities: SANDBOX_AGENT_CAPABILITIES,
      ...limits,
    });
  }

  return Object.freeze({ open, execute, snapshot, pause, resume, close, stats });
}

export const SANDBOX_AGENT_DEFAULTS = DEFAULT_LIMITS;
