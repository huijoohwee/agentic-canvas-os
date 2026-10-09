import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWeb, consumeGraphObservabilityBuild } from '../web/build.mjs';
import { GRAPH_ENTRY, sha256 } from '../web/observability-workspace.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-native-build-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = path.join(root, 'graph/canvas/dist'), manifestPath = path.join(root, 'workspace.json');
  fs.mkdirSync(build, { recursive: true }); fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(path.join(root, 'web/spatial-workspace-client.mjs'), 'export const existingClient = true;');
  fs.writeFileSync(manifestPath, '{}');
  const workspace = { graphRoot: path.join(root, 'graph'), sourceRevision: 'a'.repeat(40), buildRevision: 'a'.repeat(40), sourceDirty: true,
    manifestPath, workspaceManifestDigest: sha256('{}'), env: {} };
  const assets = { [GRAPH_ENTRY]: '<html><script src="./entry.js"></script></html>', 'entry.js': 'export const native = true;' };
  for (const [name, bytes] of Object.entries(assets)) {
    const target = path.join(build, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  const manifest = { schema: 'agentic-graph/observability-build/v1', sourceRevision: workspace.sourceRevision,
    sourceDirty: true, workspaceManifestDigest: workspace.workspaceManifestDigest, entry: GRAPH_ENTRY,
    outputs: Object.entries(assets).map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) })) };
  const save = () => fs.writeFileSync(path.join(build, 'observability', 'observability-build.json'), JSON.stringify(manifest));
  save(); return { root, workspace, build, manifest, save };
}

test('verified native bytes reuse output and preserve the existing spatial client', t => {
  const f = fixture(t);
  assert.equal(consumeGraphObservabilityBuild(f.root, f.workspace, f.build).reused, false);
  const output = path.join(f.root, 'web/dist/index.html'), time = fs.statSync(output).mtimeMs;
  assert.deepEqual(fs.readFileSync(output), fs.readFileSync(path.join(f.build, GRAPH_ENTRY)));
  assert.equal(consumeGraphObservabilityBuild(f.root, f.workspace, f.build).reused, true);
  assert.equal(fs.statSync(output).mtimeMs, time);
  assert.match(fs.readFileSync(path.join(f.root, 'web/dist/spatial-workspace-client.mjs'), 'utf8'), /existingClient/);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root, 'web/dist/canvas-observability-build.json')));
  assert.equal(receipt.sourceDirty, true); assert.equal(receipt.protectedReleaseProof, false);
});

test('digest, traversal, duplicate, overflow and source mismatches preserve prior output', t => {
  const f = fixture(t); consumeGraphObservabilityBuild(f.root, f.workspace, f.build);
  const output = path.join(f.root, 'web/dist/index.html'), previous = fs.readFileSync(output), good = structuredClone(f.manifest);
  for (const change of [m => { m.outputs[0].sha256 = '0'.repeat(64); }, m => { m.outputs[0].path = '../escape'; },
    m => { m.outputs.push(m.outputs[0]); }, m => { m.outputs[0].bytes = 500000; },
    m => { m.sourceRevision = 'b'.repeat(40); }, m => { m.workspaceManifestDigest = '0'.repeat(64); }]) {
    Object.assign(f.manifest, structuredClone(good)); change(f.manifest); f.save();
    assert.throws(() => consumeGraphObservabilityBuild(f.root, f.workspace, f.build), /observability-build/);
    assert.deepEqual(fs.readFileSync(output), previous);
  }
});

test('native build selects Graph Vite and rejects workspace drift', async t => {
  const f = fixture(t), calls = [];
  const options = { resolveWorkspace: () => f.workspace, run: (...args) => calls.push(args) };
  await buildWeb(f.root, options);
  assert.deepEqual(calls[0][1], ['exec', '--workspace', 'canvas', '--', 'vite', 'build', '--configLoader', 'runner', '--config', 'vite.observability.config.ts']);
  assert.equal(calls[0][2].cwd, f.workspace.graphRoot);
  fs.writeFileSync(f.workspace.manifestPath, '{"changed":true}');
  await assert.rejects(buildWeb(f.root, options), /workspace changed/);
});

test('native build rejects a Graph source revision outside the exact workspace pin', async t => {
  const f = fixture(t), calls = [];
  f.workspace.buildRevision = 'b'.repeat(40);
  await assert.rejects(buildWeb(f.root, { resolveWorkspace: () => f.workspace, run: (...args) => calls.push(args) }), /pinned build revision/);
  assert.equal(calls.length, 0);
});
