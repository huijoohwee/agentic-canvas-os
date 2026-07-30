// Tests for the keyless knowgrph MCP Streamable HTTP client (agentic-canvas-os).
// Injectable fetch → ZERO network. Covers JSON + SSE reply parsing, structured
// result extraction, fail-closed on non-2xx + JSON-RPC error, and bearer
// forwarding.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createKnowgrphMcpClient,
  parseMcpReply,
  extractToolResult,
  validateSkillEvolutionResult,
  KnowgrphMcpError,
} from "../src/knowgrph-mcp-client.js";

const ENDPOINT = "https://airvio.co/knowgrph/control-plane/mcp";

function jsonResponse(status, obj, contentType = "application/json") {
  return {
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : "") },
    text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)),
  };
}

function rpcOk(id, structuredContent) {
  return { jsonrpc: "2.0", id, result: { structuredContent } };
}

const SKILL_EVOLUTION_INVOCATION = Object.freeze({
  command: "/skill.evolve",
  semantics: ["#skill-evolution"],
  bindings: ["@skill-catalog", "@skill-policy", "@runtime-proof", "@operator"],
});

const DIGEST = Object.freeze({
  baseline: "1".repeat(64),
  executor: "2".repeat(64),
  candidateAdapter: "3".repeat(64),
  training: "4".repeat(64),
  validation: "5".repeat(64),
  evaluator: "6".repeat(64),
  working: "7".repeat(64),
});

function skillEvolutionSnapshot(overrides = {}) {
  return {
    schema: "knowgrph-skill-evolution-result/v1",
    runId: "skill-run-1",
    revision: 2,
    operation: "status",
    status: "running",
    invocation: SKILL_EVOLUTION_INVOCATION,
    sourceRevision: "a".repeat(40),
    baseline: {
      skillId: "skill-1",
      revision: "v1",
      digest: DIGEST.baseline,
      artifactRef: "artifact:skill-1",
      normalizedChars: 1000,
    },
    executor: { id: "executor-1", revision: "v1", digest: DIGEST.executor },
    candidateAdapter: { id: "adapter-1", revision: "v1", digest: DIGEST.candidateAdapter },
    dataset: {
      training: [{ id: "train-1", digest: DIGEST.training, ref: "dataset:train-1" }],
      validation: [{ id: "validation-1", digest: DIGEST.validation, ref: "dataset:validation-1" }],
    },
    evaluator: {
      id: "evaluator-1",
      revision: "v1",
      digest: DIGEST.evaluator,
      metric: { id: "quality", direction: "maximize", threshold: 0.8 },
    },
    plan: {
      epochs: 2,
      batchSize: 4,
      miniBatchSize: 2,
      learningRate: { initial: 0.1, decay: 0.5, floor: 0.01 },
      batchesPerEpoch: 1,
      miniBatchesPerEpoch: 2,
      maxCandidateCalls: 4,
    },
    progress: { epoch: 1, batch: 1, miniBatch: 1, candidatesEvaluated: 1 },
    workingCandidate: {
      candidateRef: "candidate:working",
      diffRef: "diff:working",
      digest: DIGEST.working,
      parentDigest: DIGEST.baseline,
    },
    champion: {
      candidateRef: "artifact:skill-1",
      diffRef: null,
      digest: DIGEST.baseline,
      parentDigest: null,
    },
    promotedCandidate: null,
    metrics: { baseline: null, workingCandidate: null, champion: null, promotedCandidate: null },
    validation: { disjoint: true, gateResults: [], staleEpochs: 0 },
    cost: {
      adapterCalls: 3,
      mutationOperations: 1,
      changedChars: 10,
      tokens: 30,
      costUsd: 0.03,
      durationMs: 300,
      byPhase: {
        training: { adapterCalls: 2, tokens: 20, costUsd: 0.02, durationMs: 200 },
        validation: { adapterCalls: 1, tokens: 10, costUsd: 0.01, durationMs: 100 },
      },
    },
    stopReason: null,
    proposal: null,
    errors: [],
    applied: false,
    modelWeightsMutated: false,
    deploymentAttempted: false,
    ...overrides,
  };
}

function unresolvedSkillEvolutionFailure(overrides = {}) {
  return skillEvolutionSnapshot({
    runId: null,
    revision: 0,
    status: "failed",
    sourceRevision: null,
    baseline: null,
    executor: null,
    candidateAdapter: null,
    dataset: null,
    evaluator: null,
    plan: null,
    progress: { epoch: 0, batch: 0, miniBatch: 0, candidatesEvaluated: 0 },
    workingCandidate: null,
    champion: null,
    promotedCandidate: null,
    validation: { disjoint: false, gateResults: [], staleEpochs: 0 },
    cost: {
      adapterCalls: 0,
      mutationOperations: 0,
      changedChars: 0,
      tokens: 0,
      costUsd: 0,
      durationMs: 0,
      byPhase: {
        training: { adapterCalls: 0, tokens: 0, costUsd: 0, durationMs: 0 },
        validation: { adapterCalls: 0, tokens: 0, costUsd: 0, durationMs: 0 },
      },
    },
    errors: [{ code: "not_found", field: "runId", message: "Run was not found." }],
    ...overrides,
  });
}

function initialSkillEvolutionSnapshot(overrides = {}) {
  const result = skillEvolutionSnapshot(overrides);
  const candidate = {
    candidateRef: result.baseline.artifactRef,
    diffRef: null,
    digest: result.baseline.digest,
    parentDigest: null,
  };
  return {
    ...result,
    progress: { epoch: 0, batch: 0, miniBatch: 0, candidatesEvaluated: 0 },
    workingCandidate: candidate,
    champion: { ...candidate },
    promotedCandidate: null,
    metrics: { baseline: null, workingCandidate: null, champion: null, promotedCandidate: null },
    validation: { disjoint: true, gateResults: [], staleEpochs: 0 },
    cost: {
      adapterCalls: 0,
      mutationOperations: 0,
      changedChars: 0,
      tokens: 0,
      costUsd: 0,
      durationMs: 0,
      byPhase: {
        training: { adapterCalls: 0, tokens: 0, costUsd: 0, durationMs: 0 },
        validation: { adapterCalls: 0, tokens: 0, costUsd: 0, durationMs: 0 },
      },
    },
    stopReason: null,
  };
}

test("requires an endpoint", () => {
  assert.throws(() => createKnowgrphMcpClient({}), KnowgrphMcpError);
});

test("forwards tools/call and returns the structured Run_Manifest", async () => {
  const seen = {};
  const fetchImpl = async (req) => {
    seen.req = req;
    
    // Handle initialization
    if (req.body && req.body.method === "initialize") {
      return {
        status: 200,
        headers: {
          get: (n) => {
            const lower = n.toLowerCase();
            if (lower === "content-type") return "text/event-stream";
            if (lower === "mcp-session-id") return "test-session-id";
            return "";
          }
        },
        text: async () => "",
      };
    }

    return jsonResponse(200, rpcOk(req.body.id, { state: "blocked", approvalGates: [1, 2, 3, 4, 5] }));
  };
  const client = createKnowgrphMcpClient({ endpoint: ENDPOINT, fetchImpl });
  const manifest = await client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 25 });

  assert.equal(seen.req.url, ENDPOINT);
  assert.equal(seen.req.method, "POST");
  assert.equal(seen.req.body.method, "tools/call");
  assert.equal(seen.req.body.params.name, "knowgrph.video_remix.run");
  assert.equal(manifest.state, "blocked");
  assert.equal(manifest.approvalGates.length, 5);
});

test("forwards the caller bearer (Auth_Token) but never a model key", async () => {
  let authHeader;
  const fetchImpl = async (req) => {
    authHeader = req.headers.authorization;
    if (req.body && req.body.method === "initialize") {
      return { status: 200, headers: { get: (n) => n.toLowerCase() === "mcp-session-id" ? "test-session-id" : "" }, text: async () => "" };
    }
    return jsonResponse(200, rpcOk(req.body.id, { state: "complete" }));
  };
  const client = createKnowgrphMcpClient({ endpoint: ENDPOINT, fetchImpl, authToken: "tok-123" });
  await client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 1 });
  assert.equal(authHeader, "Bearer tok-123");
});

test("forwards gateway-owned execution identity in the idempotency header and MCP metadata", async () => {
  let toolRequest;
  const client = createKnowgrphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (req) => {
      if (req.body?.method === "initialize") {
        return {
          status: 200,
          headers: { get: (name) => name.toLowerCase() === "mcp-session-id" ? "receipt-session" : "" },
          text: async () => "",
        };
      }
      toolRequest = req;
      return jsonResponse(200, rpcOk(req.body.id, { ok: true }));
    },
  });
  const execution = {
    schema: "function-execution-receipt/v1",
    receiptId: "receipt-1",
    idempotencyKey: "stable-key-1",
    requestDigest: "request-digest-1",
  };
  await client.callTool("knowgrph.record.update", { value: "updated" }, { execution });
  assert.equal(toolRequest.headers["idempotency-key"], execution.idempotencyKey);
  assert.deepEqual(
    toolRequest.body.params._meta["io.agentic-canvas-os/execution"],
    execution,
  );
});

test("evolveSkill forwards the canonical resumable Skill Evolution tool", async () => {
  let toolRequest;
  const client = createKnowgrphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (req) => {
      if (req.body?.method === "initialize") {
        return {
          status: 200,
          headers: { get: (name) => name.toLowerCase() === "mcp-session-id" ? "skill-session" : "" },
          text: async () => "",
        };
      }
      toolRequest = req;
      return jsonResponse(200, rpcOk(req.body.id, skillEvolutionSnapshot()));
    },
  });
  const input = {
    schema: "knowgrph-skill-evolution-request/v1",
    operation: "status",
    invocation: SKILL_EVOLUTION_INVOCATION,
    runId: "skill-run-1",
  };

  const result = await client.evolveSkill(input, { bearer: "caller-session" });

  assert.equal(toolRequest.body.params.name, "knowgrph.skill.evolve");
  assert.deepEqual(toolRequest.body.params.arguments, input);
  assert.equal(toolRequest.headers.authorization, "Bearer caller-session");
  assert.equal(result.status, "running");
  assert.equal(result.modelWeightsMutated, false);
});

test("Skill Evolution result validation rejects schema, operation, status, and snapshot gaps", () => {
  const missingSnapshot = skillEvolutionSnapshot();
  delete missingSnapshot.dataset;
  const cases = [
    skillEvolutionSnapshot({ schema: "unknown/v1" }),
    skillEvolutionSnapshot({ operation: "step" }),
    skillEvolutionSnapshot({ status: "complete" }),
    missingSnapshot,
  ];

  for (const value of cases) {
    assert.throws(
      () => validateSkillEvolutionResult(value, { expectedOperation: "status" }),
      (error) => error instanceof KnowgrphMcpError
        && error.code === "mcp_skill_evolution_result_invalid"
        && Array.isArray(error.data?.fields),
    );
  }
});

test("Skill Evolution result validation requires every safety flag to be false", () => {
  for (const field of ["applied", "modelWeightsMutated", "deploymentAttempted"]) {
    assert.throws(
      () => validateSkillEvolutionResult(skillEvolutionSnapshot({ [field]: true }), { expectedOperation: "status" }),
      (error) => error.code === "mcp_skill_evolution_result_invalid"
        && error.data.fields.includes(field),
    );
  }
});

test("Skill Evolution result validation accepts a fully typed unresolved failure", () => {
  const result = unresolvedSkillEvolutionFailure();
  assert.equal(validateSkillEvolutionResult(result, { expectedOperation: "status" }), result);
});

test("Skill Evolution result validation accepts every canonical operation-state pair", () => {
  for (const [operation, status, runId, revision] of [
    ["plan", "planned", null, 0],
    ["start", "ready", "skill-run-1", 1],
    ["step", "running", "skill-run-1", 2],
    ["status", "stopped", "skill-run-1", 3],
    ["cancel", "canceled", "skill-run-1", 4],
  ]) {
    const result = operation === "plan" || operation === "start"
      ? initialSkillEvolutionSnapshot({ operation, status, runId, revision })
      : skillEvolutionSnapshot({ operation, status, runId, revision });
    assert.equal(validateSkillEvolutionResult(result, { expectedOperation: operation }), result);
  }
});

test("Skill Evolution result validation requires resolved identities and candidates outside admission failure", () => {
  for (const field of ["sourceRevision", "baseline", "executor", "candidateAdapter", "dataset", "evaluator", "plan", "workingCandidate", "champion"]) {
    assert.throws(
      () => validateSkillEvolutionResult(skillEvolutionSnapshot({ [field]: null }), { expectedOperation: "status" }),
      (error) => error.code === "mcp_skill_evolution_result_invalid"
        && error.data.fields.includes(field),
    );
  }
});

test("Skill Evolution result validation rejects malformed resolved identities and operation states", () => {
  const malformedBaseline = skillEvolutionSnapshot();
  delete malformedBaseline.baseline.artifactRef;
  assert.throws(
    () => validateSkillEvolutionResult(malformedBaseline, { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("baseline.artifactRef"),
  );
  assert.throws(
    () => validateSkillEvolutionResult(skillEvolutionSnapshot({ status: "planned" }), { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("operation_status"),
  );
  assert.throws(
    () => validateSkillEvolutionResult(skillEvolutionSnapshot({ operation: "start", status: "ready" }), { expectedOperation: "start" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("start_identity"),
  );
  assert.throws(
    () => validateSkillEvolutionResult(skillEvolutionSnapshot({
      validation: { disjoint: false, gateResults: [], staleEpochs: 0 },
    }), { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("validation.disjoint"),
  );
});

test("Skill Evolution result validation enforces exact candidate and metric snapshots", () => {
  const malformedCandidate = skillEvolutionSnapshot();
  malformedCandidate.workingCandidate = { digest: DIGEST.working };
  const extendedCandidate = skillEvolutionSnapshot();
  extendedCandidate.workingCandidate.hiddenState = "forbidden";
  const malformedMetrics = skillEvolutionSnapshot();
  delete malformedMetrics.metrics.promotedCandidate;

  for (const [value, field] of [
    [malformedCandidate, "workingCandidate.candidateRef"],
    [extendedCandidate, "workingCandidate.hiddenState"],
    [malformedMetrics, "metrics.promotedCandidate"],
    [skillEvolutionSnapshot({ metrics: { baseline: null, workingCandidate: Infinity, champion: null, promotedCandidate: null } }), "metrics.workingCandidate"],
  ]) {
    assert.throws(
      () => validateSkillEvolutionResult(value, { expectedOperation: "status" }),
      (error) => error.code === "mcp_skill_evolution_result_invalid"
        && error.data.fields.includes(field),
    );
  }
});

test("Skill Evolution result validation enforces phase accounting and failed errors", () => {
  const mismatchedCost = skillEvolutionSnapshot();
  mismatchedCost.cost.tokens += 1;
  assert.throws(
    () => validateSkillEvolutionResult(mismatchedCost, { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("cost.tokens"),
  );

  const decimalCost = skillEvolutionSnapshot();
  decimalCost.cost.byPhase.training.costUsd = 0.1;
  decimalCost.cost.byPhase.validation.costUsd = 0.2;
  decimalCost.cost.costUsd = 0.3;
  assert.equal(validateSkillEvolutionResult(decimalCost, { expectedOperation: "status" }), decimalCost);
  assert.throws(
    () => validateSkillEvolutionResult(unresolvedSkillEvolutionFailure({ errors: [] }), { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("errors"),
  );
  assert.throws(
    () => validateSkillEvolutionResult(skillEvolutionSnapshot({
      errors: [{ code: "unexpected", field: null, message: "Successful states cannot carry errors." }],
    }), { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("errors"),
  );
});

test("Skill Evolution result validation enforces held-out identities and zero-work initial states", () => {
  const overlapped = skillEvolutionSnapshot();
  overlapped.dataset.validation[0].ref = overlapped.dataset.training[0].ref.toUpperCase();
  assert.throws(
    () => validateSkillEvolutionResult(overlapped, { expectedOperation: "status" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("dataset.validation[0].ref"),
  );

  for (const result of [
    skillEvolutionSnapshot({ operation: "plan", status: "planned", runId: null, revision: 0 }),
    skillEvolutionSnapshot({ operation: "start", status: "ready", revision: 1 }),
  ]) {
    result.cost.adapterCalls = 1;
    result.cost.byPhase.training.adapterCalls = 1;
    result.workingCandidate = {
      candidateRef: "candidate:unexpected",
      diffRef: "diff:unexpected",
      digest: DIGEST.working,
      parentDigest: DIGEST.baseline,
    };
    assert.throws(
      () => validateSkillEvolutionResult(result, { expectedOperation: result.operation }),
      (error) => error.code === "mcp_skill_evolution_result_invalid"
        && error.data.fields.includes("cost.adapterCalls")
        && error.data.fields.includes("workingCandidate.candidateRef"),
    );
  }
});

test("evolveSkill rejects an unsafe structured MCP result", async () => {
  const client = createKnowgrphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (req) => {
      if (req.body?.method === "initialize") {
        return {
          status: 200,
          headers: { get: (name) => name.toLowerCase() === "mcp-session-id" ? "unsafe-skill-session" : "" },
          text: async () => "",
        };
      }
      return jsonResponse(200, rpcOk(req.body.id, skillEvolutionSnapshot({ applied: true })));
    },
  });

  await assert.rejects(
    () => client.evolveSkill({ operation: "status", runId: "skill-run-1" }),
    (error) => error.code === "mcp_skill_evolution_result_invalid"
      && error.data.fields.includes("applied"),
  );
});

test("parses an SSE reply and extracts the last JSON-RPC frame", () => {
  const sse = `event: message\ndata: ${JSON.stringify(rpcOk(1, { state: "complete" }))}\n\n`;
  const parsed = parseMcpReply(sse, "text/event-stream");
  assert.equal(extractToolResult(parsed).state, "complete");
});

test("extractToolResult reads a JSON text content block", () => {
  const rpc = { result: { content: [{ type: "text", text: JSON.stringify({ state: "completed" }) }] } };
  assert.equal(extractToolResult(rpc).state, "completed");
});

test("fail-closed on a non-2xx response", async () => {
  const client = createKnowgrphMcpClient({ endpoint: ENDPOINT, fetchImpl: async (req) => {
    if (req.body && req.body.method === "initialize") return { status: 200, headers: { get: (n) => n.toLowerCase() === "mcp-session-id" ? "test-session-id" : "" }, text: async () => "" };
    return jsonResponse(503, "busy", "text/plain");
  } });
  await assert.rejects(() => client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 1 }), (e) => {
    assert.equal(e.code, "mcp_http_error");
    assert.equal(e.status, 503);
    return true;
  });
});

test("fail-closed on a JSON-RPC error frame", async () => {
  const client = createKnowgrphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (req) => {
      if (req.body && req.body.method === "initialize") return { status: 200, headers: { get: (n) => n.toLowerCase() === "mcp-session-id" ? "test-session-id" : "" }, text: async () => "" };
      return jsonResponse(200, { jsonrpc: "2.0", id: req.body.id, error: { code: -32000, message: "nope" } });
    }
  });
  await assert.rejects(() => client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 1 }), (e) => {
    assert.equal(e.code, "mcp_rpc_error");
    return true;
  });
});

test("fail-closed on an unparseable body", () => {
  assert.throws(() => parseMcpReply("<<not json>>", "application/json"), KnowgrphMcpError);
});
