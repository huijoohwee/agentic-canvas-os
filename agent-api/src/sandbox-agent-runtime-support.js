import { SandboxAgentBlock } from "./sandbox-agent-contract.js";

export const SANDBOX_AGENT_DEFAULTS = Object.freeze({
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

export function defaultSandboxId(kind) {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") {
    throw new SandboxAgentBlock("sandbox_id_unavailable", "A secure sandbox identifier generator is required.");
  }
  return `${kind}-${globalThis.crypto.randomUUID()}`;
}

export function blockedSandboxResult(stage, error, extra = {}) {
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

export function aggregateSandboxCost(record, cost) {
  if (cost.status === "reported") record.reportedCostUsd += cost.amountUsd;
  if (cost.status === "unreported") record.unreportedCostEvents += 1;
}

export function publicSandboxCost(record) {
  if (record.unreportedCostEvents > 0 && record.reportedCostUsd > 0) {
    return Object.freeze({ status: "partial", amountUsd: record.reportedCostUsd });
  }
  if (record.unreportedCostEvents > 0) return Object.freeze({ status: "unreported" });
  return Object.freeze({ status: "reported", amountUsd: record.reportedCostUsd });
}

export async function callSandboxProvider(operation, timeoutMs) {
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
