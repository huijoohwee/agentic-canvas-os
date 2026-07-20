import { verifySessionToken } from "./auth.js";
import { assertExactKeys, assertIdentifier } from "./agent-swarm-contract.js";

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function bearer(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const match = /^Bearer\s+(.+)$/i.exec(String(source.authorization || source.Authorization || ""));
  return match ? match[1].trim() : "";
}

function responseStatus(action, result) {
  if (result.reasonCode === "run_forbidden") return 403;
  if (result.status === "completed") return 200;
  if (action === "cancel" && result.status === "canceled") return 200;
  if (["running", "pending", "idle", "retryable", "synthesizing"].includes(result.status)) return 202;
  return 409;
}

function statusRunId(body) {
  assertExactKeys(body, ["runId"], "request");
  return assertIdentifier(body.runId, "request.runId");
}

export function createAgentSwarmHandlers({ secret, agentSwarm, now } = {}) {
  const swarmStats = agentSwarm && typeof agentSwarm.stats === "function" ? agentSwarm.stats() : {};
  const configured = Boolean(swarmStats.configured);

  function handler(action, operation) {
    return async function agentSwarmHandler(request = {}) {
      if (!secret) return json(501, { error: "auth not configured" });
      const verdict = verifySessionToken(bearer(request.headers), secret, { now });
      if (!verdict.valid) {
        return json(401, { error: "unauthorized" });
      }
      if (!configured) return json(501, { error: "agent swarm not configured" });
      const currentTime = Number.isFinite(now) ? now : Date.now();
      if (action === "start" && Number.isFinite(swarmStats.runTtlMs)
        && verdict.claims.exp * 1000 - currentTime < swarmStats.runTtlMs) {
        return json(409, { error: "session lifetime is shorter than the swarm run", code: "session_too_short" });
      }
      try {
        const body = request.body || {};
        if (Object.hasOwn(body, "signal")) {
          throw new TypeError("request.signal is server-owned and cannot be supplied over HTTP.");
        }
        const operationBody = request.signal && ["start", "work", "settle"].includes(action)
          ? { ...body, signal: request.signal }
          : body;
        const result = await operation(operationBody, {
          principalId: verdict.claims.sub,
          principalExpiresAt: verdict.claims.exp * 1000,
        });
        return json(responseStatus(action, result), result);
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          return json(400, { error: "invalid request", reason: error.message });
        }
        const forbidden = error?.reasonCode === "run_forbidden";
        return json(forbidden ? 403 : 409, {
          error: forbidden ? "forbidden" : "agent swarm operation failed",
          code: forbidden ? "run_forbidden" : "swarm_operation_failed",
        });
      }
    };
  }

  return Object.freeze({
    start: handler("start", (body, context) => agentSwarm.start(body, context)),
    work: handler("work", (body, context) => agentSwarm.work(body, context)),
    settle: handler("settle", (body, context) => agentSwarm.settle(body, context)),
    status: handler("status", (body, context) => agentSwarm.status(statusRunId(body), context)),
    cancel: handler("cancel", (body, context) => agentSwarm.cancel(body, context)),
  });
}
