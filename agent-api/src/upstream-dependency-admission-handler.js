import { verifySessionToken } from "./auth.js";
import { evaluateUpstreamDependencies } from "./upstream-dependency-admission.js";

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function bearer(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const match = /^Bearer\s+(.+)$/i.exec(String(source.authorization || source.Authorization || ""));
  return match ? match[1].trim() : "";
}

export function createUpstreamDependencyAdmissionHandler({
  secret,
  evaluate = evaluateUpstreamDependencies,
  now,
} = {}) {
  return async function upstreamDependencyAdmissionHandler(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    const verdict = verifySessionToken(bearer(request.headers), secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });
    try {
      return json(200, evaluate(request.body || {}));
    } catch (error) {
      return json(400, {
        error: "invalid upstream dependency admission request",
        code: "upstream_dependency_admission_invalid",
        reason: error instanceof Error ? error.message : "invalid request",
      });
    }
  };
}
