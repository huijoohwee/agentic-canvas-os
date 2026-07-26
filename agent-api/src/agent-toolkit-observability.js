import { digestToolkitEvidence } from "./agent-toolkit-ledger.js";

const SCHEMA = "agent-toolkit-telemetry/v1";

function resultStatus(value) {
  return typeof value?.status === "string" ? value.status : "unknown";
}

export function createAgentToolkitObservability({ exporter, now } = {}) {
  if (exporter !== undefined && typeof exporter !== "function") {
    throw new TypeError("Agent Toolkit telemetry exporter must be a function.");
  }
  if (typeof now !== "function") throw new TypeError("Agent Toolkit observability requires a clock.");
  const configured = typeof exporter === "function";

  async function emit({ action, context, identity, result, startedAt }) {
    if (!configured) return false;
    const finishedAt = Number(now());
    const event = Object.freeze({
      schema: SCHEMA,
      action,
      status: resultStatus(result),
      ...(typeof result?.reasonCode === "string" ? { reasonCode: result.reasonCode } : {}),
      principalDigest: digestToolkitEvidence(["principal", context.principalId]),
      identityDigest: digestToolkitEvidence(["identity", identity]),
      telemetryTrust: context.telemetryTrust,
      observedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - startedAt),
    });
    try {
      await exporter(event);
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    emit,
    stats: () => Object.freeze({
      configured,
      schema: SCHEMA,
      payloadPolicy: "digests-status-reason-timing-only",
      failurePolicy: "operation-unaffected",
    }),
  });
}
