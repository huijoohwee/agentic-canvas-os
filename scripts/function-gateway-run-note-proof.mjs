import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { mintReviewerToken, verifyReviewerToken } from "../agent-api/src/auth.js";
import { createDurableObjectFunctionExecutionReceiptStore } from "../agent-api/src/durable-object-state-store.js";
import { createGuardrailsHumanReviewRuntime } from "../agent-api/src/guardrails-human-review.js";
import {
  createKnowgrphFunctionGateway,
  createKnowgrphGuardrailEvaluator,
  KNOWGRPH_FUNCTION_TOOL_NAMES,
} from "../agent-api/src/knowgrph-function-gateway.js";
import { AgentState } from "../worker/agent-state.js";

class TransactionalMemoryStorage {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
  }

  async get(key) { return this.records.get(key); }

  async put(keyOrEntries, value) {
    if (keyOrEntries && typeof keyOrEntries === "object") {
      for (const [key, entry] of Object.entries(keyOrEntries)) this.records.set(key, entry);
      return;
    }
    this.records.set(keyOrEntries, value);
  }

  async delete(key) { return this.records.delete(key); }

  transaction(operation) {
    const run = this.transactionTail.then(async () => {
      const snapshot = new Map(this.records);
      const transaction = {
        get: async (key) => snapshot.get(key),
        put: async (keyOrEntries, value) => {
          if (keyOrEntries && typeof keyOrEntries === "object") {
            for (const [key, entry] of Object.entries(keyOrEntries)) snapshot.set(key, entry);
          } else snapshot.set(keyOrEntries, value);
        },
        delete: async (key) => snapshot.delete(key),
      };
      const result = await operation(transaction);
      this.records = snapshot;
      return result;
    });
    this.transactionTail = run.catch(() => undefined);
    return run;
  }
}

function namespaceFor(createInstance) {
  const instances = new Map();
  return Object.freeze({
    idFromName: (name) => String(name),
    get(id) {
      if (!instances.has(id)) instances.set(id, createInstance());
      const instance = instances.get(id);
      return Object.freeze({
        fetch: (input, init) => instance.fetch(
          input instanceof Request ? input : new Request(input, init),
        ),
      });
    },
  });
}

function requiredKnowgrphRoot(argv) {
  const prefix = "--knowgrph-root=";
  const raw = argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
  if (!raw) throw new Error("Usage: npm run function-gateway:cross-repo-proof -- --knowgrph-root=/absolute/path/to/knowgrph");
  const root = resolve(raw);
  const modulePath = resolve(root, "cloudflare/workers/knowgrph-mcp/run-manifest-store.mjs");
  if (!existsSync(modulePath)) throw new Error(`Knowgrph runtime module not found: ${modulePath}`);
  return { root, modulePath };
}

const { root: knowgrphRoot, modulePath } = requiredKnowgrphRoot(process.argv.slice(2));
const knowgrph = await import(pathToFileURL(modulePath).href);
const runManifestNamespace = namespaceFor(
  () => new knowgrph.RunManifestStore({ storage: new TransactionalMemoryStorage() }, {}),
);
await knowgrph.persistRunManifestThroughNamespace(runManifestNamespace, {
  contractVersion: "run-manifest/v1",
  runId: "cross-repo-run-note",
  state: "completed",
});

const receiptNamespace = namespaceFor(
  () => new AgentState({ storage: new TransactionalMemoryStorage() }),
);
const executionReceiptStore = createDurableObjectFunctionExecutionReceiptStore({
  namespace: receiptNamespace,
});
const reviewRecords = new Map();
const reviewSecret = "local-cross-repo-review-secret";
let mcpCalls = 0;
let dropReceipt = true;

function createReviewRuntime() {
  return createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: createKnowgrphGuardrailEvaluator(),
    createReviewId: () => "cross-repo-run-note-review",
    authenticateReviewer: async ({ state, evidence }) => {
      const verdict = verifyReviewerToken(evidence?.token, reviewSecret, state);
      return verdict.valid
        ? { authenticated: true, subjectId: verdict.claims.sub, evidenceId: verdict.claims.jti, assurance: "signed-review-token" }
        : { authenticated: false };
    },
    reviewStore: {
      put(record) {
        if (reviewRecords.has(record.reviewId)) return false;
        reviewRecords.set(record.reviewId, record);
        return true;
      },
      take(reviewId) {
        const record = reviewRecords.get(reviewId) ?? null;
        reviewRecords.delete(reviewId);
        return record;
      },
    },
  });
}

const mcpClient = Object.freeze({
  async callTool(toolName, argumentsValue, options) {
    mcpCalls += 1;
    const result = await knowgrph.dispatchKnowgrphMcpToolCall({
      toolName,
      args: argumentsValue,
      namespace: runManifestNamespace,
      execution: options.execution,
      idempotencyHeader: options.execution.idempotencyKey,
    });
    assert.equal(result.ok, true);
    if (dropReceipt) {
      dropReceipt = false;
      const { execution_receipt: _dropped, ...uncertainPayload } = result.structuredContent;
      return uncertainPayload;
    }
    return result.structuredContent;
  },
});

function createGateway() {
  return createKnowgrphFunctionGateway({
    allowedToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.runNote],
    mcpClient,
    guardrailsHumanReview: createReviewRuntime(),
    executionReceiptStore,
  });
}

const call = Object.freeze({
  runId: "cross-repo-agentic-run",
  conversationId: "cross-repo-agentic-conversation",
  callId: "cross-repo-run-note-call",
  name: KNOWGRPH_FUNCTION_TOOL_NAMES.runNote,
  arguments: Object.freeze({
    run_id: "cross-repo-run-note",
    note: "Reviewed once and recovered after an uncertain result.",
  }),
  caller: Object.freeze({ type: "direct" }),
  policy: Object.freeze({
    revision: "knowgrph-run-note-function/v1",
    riskClass: "mutation",
    idempotent: true,
    approvalRequired: true,
  }),
});

const firstGateway = createGateway();
const paused = await firstGateway.callTool(call);
assert.equal(paused.status, "paused");
const reviewerToken = mintReviewerToken({
  secret: reviewSecret,
  subject: "operator-1",
  ...paused.resumeState,
});
const uncertain = await firstGateway.callTool({
  ...call,
  review: {
    state: paused.resumeState,
    resolution: {
      reviewId: paused.resumeState.reviewId,
      decision: "approve",
      reviewerEvidence: { token: reviewerToken },
    },
  },
});
assert.equal(uncertain.reasonCode, "upstream_execution_receipt_invalid");
assert.equal(uncertain.retryable, true);

const recovered = await createGateway().callTool(call);
assert.equal(recovered.status, "completed");
assert.equal(recovered.output.revision, 1);
const callsAfterRecovery = mcpCalls;
const terminalReplay = await createGateway().callTool(call);
assert.equal(terminalReplay.status, "completed");
assert.equal(terminalReplay.executionReceipt.replayed, true);
assert.equal(mcpCalls, callsAfterRecovery);

const stored = await knowgrph.readRunManifestThroughNamespace(
  runManifestNamespace,
  "cross-repo-run-note",
);
assert.equal(stored.manifest.operatorNote.revision, 1);
assert.equal(stored.manifest.operatorNote.text, call.arguments.note);
assert.equal(mcpCalls, 2);

process.stdout.write(`${JSON.stringify({
  ok: true,
  proof: "cross-repo-run-note-uncertain-result-recovery/v1",
  knowgrphRoot,
  reviewRequired: true,
  firstResult: uncertain.reasonCode,
  nativeRetryStatus: "replayed",
  terminalReceiptReplayed: terminalReplay.executionReceipt.replayed,
  manifestRevision: stored.manifest.operatorNote.revision,
  mcpCalls,
  paidProviderCalls: 0,
  liveProviderRun: false,
  deploymentPerformed: false,
}, null, 2)}\n`);
