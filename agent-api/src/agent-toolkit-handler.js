import { verifySessionToken } from "./auth.js";
import { assertExactKeys, assertIdentifier } from "./agent-toolkit-contract.js";

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function bearer(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const match = /^Bearer\s+(.+)$/i.exec(String(source.authorization || source.Authorization || ""));
  return match ? match[1].trim() : "";
}

function responseStatus(result) {
  if (!result || typeof result !== "object") return 500;
  if (["run_not_found", "cohort_not_found", "span_not_found"].includes(result.reasonCode)) return 404;
  if (["run_forbidden", "toolkit_denied"].includes(result.reasonCode)) return 403;
  if (["runtime_unconfigured", "evaluator_unconfigured"].includes(result.reasonCode)) return 501;
  if (["cohort_unavailable", "state_busy"].includes(result.reasonCode)) return 503;
  if (result.status === "insufficient-evidence") return 200;
  if (result.status === "review_pending" || result.status === "running") return 202;
  if (["completed", "failed", "canceled"].includes(result.status)) return 200;
  return 409;
}

function statusRunId(body) {
  assertExactKeys(body, ["runId"], "request");
  return assertIdentifier(body.runId, "request.runId");
}

export function createAgentToolkitHandlers({ secret, agentToolkit, now } = {}) {
  const stats = agentToolkit && typeof agentToolkit.stats === "function" ? agentToolkit.stats() : {};
  const configured = Boolean(stats.configured);

  function handler(action, operation) {
    return async function agentToolkitHandler(request = {}) {
      if (!secret) return json(501, { error: "auth not configured" });
      const verdict = verifySessionToken(bearer(request.headers), secret, { now });
      if (!verdict.valid) return json(401, { error: "unauthorized" });
      if (!configured) return json(501, { error: "agent toolkit not configured" });
      try {
        const body = request.body || {};
        if (Object.hasOwn(body, "signal")) {
          throw new TypeError("request.signal is server-owned and cannot be supplied over HTTP.");
        }
        const operationBody = request.signal && ["start", "evaluate"].includes(action)
          ? { ...body, signal: request.signal }
          : body;
        const result = await operation(operationBody, {
          principalId: verdict.claims.sub,
          principalExpiresAt: verdict.claims.exp * 1000,
          telemetryTrust: "remote-unverified",
        });
        return json(responseStatus(result), result);
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          return json(400, { error: "invalid request", reason: error.message });
        }
        return json(409, { error: "agent toolkit operation failed", code: "toolkit_operation_failed" });
      }
    };
  }

  return Object.freeze({
    start: handler("start", (body, context) => agentToolkit.start(body, context)),
    startSpan: handler("start-span", (body, context) => agentToolkit.startSpan(body, context)),
    finishSpan: handler("finish-span", (body, context) => agentToolkit.finishSpan(body, context)),
    complete: handler("complete", (body, context) => agentToolkit.complete(body, context)),
    evaluate: handler("evaluate", (body, context) => agentToolkit.evaluate(body, context)),
    compare: handler("compare", (body, context) => agentToolkit.compare(body, context)),
    propose: handler("propose", (body, context) => agentToolkit.propose(body, context)),
    status: handler("status", (body, context) => agentToolkit.status(statusRunId(body), context)),
  });
}
