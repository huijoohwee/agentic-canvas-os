import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSwarmRuntime, createAgentSwarmMemoryStore } from 'agentic-os/agents/swarm';
import { createAgentSwarmHandlers } from '../agent-api/src/agent-swarm-handler.js';
import { mintSessionToken } from '../agent-api/src/auth.js';
import { handleCloudflareRequest } from '../worker/index.js';

const secret = 'isolated-http-fixture-secret';
const request = { runId: 'http-durable-job', conversationId: 'listing-draft',
  agent: { agentId: 'listing-agent', revision: 'fixture-v1' }, goal: 'Prepare one reviewed listing.' };
const costLog = { model: 'fixture', prompt_tokens: 0, completion_tokens: 0, cache_hits: 0, estimated_cost_usd: 0 };
const output = { status: 'completed', output: 'Draft listing for review.', effect: 'read-only', costLog };
const headers = (subject, now) => ({ authorization: `Bearer ${mintSessionToken({ secret, subject, now, expiryWindowSeconds: 300 })}` });

test('HTTP admission, reconciliation and renewed sessions use one upstream job owner', async () => {
  let at = 1_000, executions = 0, reads = 0;
  const stateStore = createAgentSwarmMemoryStore({ now: () => at });
  const agentSwarm = createAgentSwarmRuntime({ stateStore, now: () => at,
    taskTimeoutMs: 20, taskLeaseMs: 100, storeClaimTtlMs: 10, retryBaseMs: 20, retryMaxMs: 100,
    runTtlMs: 900_000, retentionMs: 900_000,
    resolveAgent: async ({ agent }) => ({ status: 'ready', ...agent }),
    authorize: async () => ({ allowed: true, approvalId: 'fixture-owner-grant' }),
    planTasks: async () => ({ status: 'completed', planId: 'listing-plan', costLog,
      tasks: [{ taskId: 'listing', objective: 'Prepare draft.', dependencies: [], context: null }] }),
    executeTask: async () => { if (++executions === 1) throw Error('lost response'); return output; },
    synthesize: async () => ({ status: 'completed', output: output.output, costLog }),
    verifyReceipt: async ({ receipt }) => ({ verified: true, ...receipt }),
    reconcileTask: async ({ idempotencyKey }) => { reads++; return { status: 'absent', verified: true,
      quiescent: true, idempotencyKey, reference: 'fixture/verified-absent' }; },
  });
  let api = createAgentSwarmHandlers({ secret, agentSwarm, now: at });
  const owner = headers('owner', at), foreign = headers('other', at);
  assert.equal((await api.start({ headers: owner, body: { ...request, principalId: 'other' } })).statusCode, 400);
  const admitted = await api.start({ headers: owner, body: request });
  assert.equal(admitted.statusCode, 202);
  assert.equal((await api.start({ headers: owner, body: request })).body.requestDigest, admitted.body.requestDigest);
  assert.equal((await api.start({ headers: owner, body: { ...request, goal: 'Changed' } })).statusCode, 409);
  assert.equal((await api.status({ headers: foreign, body: { runId: request.runId } })).statusCode, 403);
  const context = { principalId: 'owner', principalExpiresAt: 301_000 };
  assert.equal((await agentSwarm.work({ runId: request.runId, workerId: 'worker', operationId: 'first' }, context)).status, 'reconciling');
  const retry = { runId: request.runId, taskId: 'listing', operationId: 'readback' };
  assert.equal((await api.retry({ headers: foreign, body: retry })).statusCode, 403);
  assert.equal(reads, 0);
  assert.equal((await api.retry({ headers: owner, body: { ...retry, token: 'spoof' } })).statusCode, 400);
  const pending = await api.retry({ headers: owner, body: retry });
  assert.equal(pending.statusCode, 202); assert.equal(reads, 1); assert.equal(executions, 1);
  at = 302_000; api = createAgentSwarmHandlers({ secret, agentSwarm, now: at });
  assert.equal((await api.status({ headers: owner, body: { runId: request.runId } })).statusCode, 401);
  const renewed = headers('owner', at);
  assert.equal((await api.status({ headers: renewed, body: { runId: request.runId } })).statusCode, 202);
  const renewedContext = { principalId: 'owner', principalExpiresAt: 602_000 };
  await agentSwarm.work({ runId: request.runId, workerId: 'worker', operationId: 'second' }, renewedContext);
  await agentSwarm.settle({ runId: request.runId, operationId: 'settle' }, renewedContext);
  const completed = await api.status({ headers: renewed, body: { runId: request.runId } });
  assert.equal(completed.statusCode, 200); assert.equal(completed.body.output, output.output);
  assert.equal(executions, 2);
  const canceledId = 'canceled-draft';
  await api.start({ headers: renewed, body: { ...request, runId: canceledId } });
  await api.cancel({ headers: renewed, body: { runId: canceledId, operationId: 'cancel' } });
  const canceled = await api.status({ headers: renewed, body: { runId: canceledId } });
  assert.equal(canceled.statusCode, 200); assert.equal(canceled.body.status, 'canceled');
});

test('Worker retry route requires POST and authentication before runtime access', async () => {
  const endpoint = 'https://runtime.example/api/agent-swarm/retry', env = { AGENT_API_JWT_SECRET: secret };
  assert.equal((await handleCloudflareRequest(new Request(endpoint), env)).status, 405);
  assert.equal((await handleCloudflareRequest(new Request(endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{}' }), env)).status, 401);
});
