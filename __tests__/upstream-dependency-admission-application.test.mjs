import assert from "node:assert/strict";
import test from "node:test";

import { mintSessionToken } from "../agent-api/src/auth.js";
import { createAgentApiApp } from "../agent-api/src/app.js";
import { handleCloudflareRequest } from "../worker/index.js";

const SECRET = "application-runtime-test-secret";
const ENV = Object.freeze({ AGENT_API_JWT_SECRET: SECRET });
const revision = (character) => character.repeat(40);
const digest = (character) => character.repeat(64);

function admissionInput(overrides = {}) {
  const dependency = {
    dependencyId: "upstream",
    capabilityId: "required-capability",
    sourceRevision: revision("a"),
    sourceState: "protected",
    owners: [{
      ownerId: "source-owner",
      scopeId: "source/scope",
      fenceRevision: revision("f"),
    }],
    closureDigest: digest("c"),
    evidenceRevision: revision("a"),
    requiredChecks: [{ name: "source-check", status: "pass" }],
    consumers: ["consumer"],
    decisionDeadline: "2026-07-30T00:10:00.000Z",
    fallback: {
      type: "omit",
      capabilityId: null,
      sourceRevision: null,
      evidenceDigest: null,
    },
    projectionRequested: false,
    ...overrides,
  };
  return {
    evaluationTime: "2026-07-30T00:00:00.000Z",
    units: [
      { unitId: "consumer", dependencies: [] },
      { unitId: "downstream", dependencies: ["consumer"] },
      { unitId: "independent", dependencies: [] },
    ],
    dependencies: [dependency],
    requestedPlanStop: false,
  };
}

function request(method, body, token) {
  return new Request(
    "https://agentic-canvas-os.example/api/upstream-dependency-admission/evaluate",
    {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

test("readiness exposes a sanitized authenticated application contract", () => {
  const readiness = createAgentApiApp({ env: ENV }).readiness().upstreamDependencyAdmission;

  assert.deepEqual(readiness, {
    configured: true,
    contractReady: true,
    route: "/api/upstream-dependency-admission/evaluate",
    auth: "session-bearer",
    sourcePolicy: "protected-exact-revision-only",
    continuationPolicy: "exact-consumer-closure-with-disjoint-work",
    mutationPolicy: "pure-no-source-adoption-projection-release-or-deployment",
    providerExecutionStatus: "not-applicable-model-free",
  });
  assert.equal(JSON.stringify(readiness).includes(SECRET), false);
});

test("Worker route rejects missing auth and unsupported methods", async () => {
  const unauthorized = await handleCloudflareRequest(request("POST", admissionInput()), ENV);
  assert.equal(unauthorized.status, 401);

  const wrongMethod = await handleCloudflareRequest(request("GET"), ENV);
  assert.equal(wrongMethod.status, 405);
});

test("authenticated protected source returns an eligible domain result", async () => {
  const token = mintSessionToken({ secret: SECRET, subject: "application-test" });
  const response = await handleCloudflareRequest(request("POST", admissionInput(), token), ENV);
  const result = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(result.schema, "agentic-upstream-dependency-admission-result/v1");
  assert.equal(result.decisions[0].status, "eligible");
  assert.deepEqual(result.readyUnits, ["consumer", "downstream", "independent"]);
  assert.match(result.evidenceDigest, /^[0-9a-f]{64}$/);
});

test("blocked dependency remains a valid result and disjoint work continues", async () => {
  const token = mintSessionToken({ secret: SECRET, subject: "application-test" });
  const body = admissionInput({ sourceState: "local-only", projectionRequested: true });
  const response = await handleCloudflareRequest(request("POST", body, token), ENV);
  const result = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(result.decisions[0].status, "blocked");
  assert.deepEqual(result.readyUnits, ["independent"]);
  assert.deepEqual(
    result.findings.map((finding) => finding.type),
    ["upstream-projection-premature", "upstream-source-unadmitted"],
  );
});

test("structural input errors and missing auth configuration fail closed", async () => {
  const token = mintSessionToken({ secret: SECRET, subject: "application-test" });
  const malformed = await handleCloudflareRequest(
    request("POST", { evaluationTime: "invalid" }, token),
    ENV,
  );
  assert.equal(malformed.status, 400);
  assert.equal(
    (await responseJson(malformed)).code,
    "upstream_dependency_admission_invalid",
  );

  const unconfigured = await handleCloudflareRequest(
    request("POST", admissionInput(), token),
    {},
  );
  assert.equal(unconfigured.status, 501);
});
