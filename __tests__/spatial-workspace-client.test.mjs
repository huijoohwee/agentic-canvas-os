import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialWorkspaceClient } from '../web/spatial-workspace-client.mjs';

function fixture() {
  const calls = [], toolNames = { inspect: 'host.inspect', preview: 'host.preview' };
  const identity = { token: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), sceneDigest: 'c'.repeat(64),
    session: 'browser-1', documentName: '/scene.md', implementation: 'agentic-graph.spatial-review/v1' };
  const scene = { ok: true, identity, provenance: { kind: 'authored', correspondence: 'unknown' } };
  const entries = new Map(Object.values(toolNames).map(name => [name, { name, inputSchema: {}, execute() {} }]));
  const registry = { get: name => entries.get(name), execute: async (name, input) => {
    calls.push({ name, input });
    return name === toolNames.inspect ? { spatialWorkspace: scene }
      : { ok: true, proposal: { sourceToken: identity.token, documentName: identity.documentName, digest: 'd'.repeat(64) } };
  } };
  return { calls, scene, identity, entries, registry, toolNames, client: createSpatialWorkspaceClient({ registry, toolNames }) };
}

test('the injected registry owns validation and preview; the client exposes no apply or undo', async () => {
  const f = fixture(), inspection = await f.client.inspect();
  assert.equal(Object.isFrozen(inspection.identity), true);
  assert.deepEqual(inspection.provenance, f.scene.provenance);
  const edits = [{ subjectId: 'box', position: [1, 0, 0] }];
  assert.equal((await f.client.preview({ inspection, edits })).ok, true);
  assert.deepEqual(f.calls[1], { name: 'host.preview', input: { action: 'preview', expectedToken: f.identity.token, edits } });
  assert.deepEqual(Object.keys(f.client).sort(), ['dispose', 'inspect', 'preview']);
  assert.equal((await f.client.preview({ inspection, edits })).code, 'stale-inspection');
  assert.equal(f.calls.length, 2);
});

test('missing transport and old Graph versions are unavailable', async () => {
  assert.equal((await createSpatialWorkspaceClient().inspect()).code, 'transport-unavailable');
  const f = fixture(); delete f.identity.implementation;
  assert.equal((await f.client.inspect()).code, 'contract-unavailable');
});

test('refuse copied, foreign, superseded inspections and agent-supplied approval fields', async () => {
  const f = fixture(), first = await f.client.inspect(), second = await f.client.inspect();
  for (const inspection of [first, structuredClone(second), (await fixture().client.inspect())])
    assert.equal((await f.client.preview({ inspection, edits: [] })).code, 'stale-inspection');
  for (const flag of ['approved', 'apply', 'action', 'invocation'])
    assert.equal((await f.client.preview({ inspection: second, edits: [], [flag]: true })).code, 'invalid-input');
  assert.equal(f.calls.length, 2);
});

test('Graph source conflicts and validation refusals are preserved and consume inspection', async () => {
  const f = fixture(), inspection = await f.client.inspect();
  f.registry.execute = async () => ({ ok: false, code: 'stale-source', message: 'Changed' });
  assert.deepEqual(await f.client.preview({ inspection, edits: [] }), { ok: false, code: 'stale-source', message: 'Changed' });
  assert.equal((await f.client.preview({ inspection, edits: [] })).code, 'stale-inspection');
});

test('a changed registry or browser session invalidates the binding', async () => {
  const f = fixture(); await f.client.inspect(); f.identity.session = 'browser-2';
  assert.equal((await f.client.inspect()).code, 'session-changed');
  assert.equal((await f.client.inspect()).code, 'cancelled');
  const g = fixture(); g.entries.set('host.preview', { inputSchema: {}, execute() {} });
  assert.equal((await g.client.inspect()).code, 'transport-unavailable');
  assert.equal(g.calls.length, 0);
});

test('abort discards a late response and overlapping requests are refused', async () => {
  const f = fixture(), controller = new AbortController(); let finish;
  f.registry.execute = () => new Promise(resolve => { finish = resolve; });
  const client = createSpatialWorkspaceClient({ ...f, signal: controller.signal });
  const request = client.inspect();
  assert.equal((await client.inspect()).code, 'busy');
  controller.abort(); finish({ spatialWorkspace: f.scene });
  assert.equal((await request).code, 'cancelled');
  assert.equal((await client.inspect()).code, 'cancelled');
});

test('mismatched preview replies and thrown transport errors cannot become success', async () => {
  const f = fixture(), inspection = await f.client.inspect();
  f.registry.execute = async () => ({ ok: true, proposal: { sourceToken: 'e'.repeat(64) } });
  assert.equal((await f.client.preview({ inspection, edits: [] })).code, 'invalid-response');
  f.registry.execute = async () => { throw new Error('offline host'); };
  assert.equal((await f.client.inspect()).code, 'transport-failed');
});
