import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WORKSPACE_SCHEMA, validateWorkspaceManifest, resolveObservabilityWorkspace, observabilityDevPlan, runObservabilityDev } from '../web/observability-workspace.mjs';
const manifest = () => ({ schema: WORKSPACE_SCHEMA, title: 'Workspace', readOnly: true,
  repositories: [{ id: 'agentic-graph', label: 'Graph', path: 'agentic-graph', buildRevision: 'a'.repeat(40) }] });

test('manifest bounds and repository selection reject traversal and duplicates', () => {
  assert.equal(validateWorkspaceManifest(manifest()).repositories.length, 1);
  for (const input of [null, { ...manifest(), readOnly: false }, { ...manifest(), repositories: [] },
    { ...manifest(), repositories: Array(33).fill(manifest().repositories[0]) },
    { ...manifest(), repositories: [{ id: 'example', label: 'Example', path: '../other' }] },
    { ...manifest(), repositories: [manifest().repositories[0], manifest().repositories[0]] }])
    assert.throws(() => validateWorkspaceManifest(input), /observability-workspace/);
});

test('build revision is an optional exact pin owned only by the Graph repository', () => {
  const pinned = { ...manifest(), repositories: [{ id: 'agentic-graph', label: 'Graph', path: 'agentic-graph', buildRevision: 'a'.repeat(40) }] };
  assert.equal(validateWorkspaceManifest(pinned).repositories[0].buildRevision, 'a'.repeat(40));
  for (const row of [
    { ...pinned.repositories[0], buildRevision: 'main' },
    { id: 'example', label: 'Example', path: 'example', buildRevision: 'a'.repeat(40) },
  ]) assert.throws(() => validateWorkspaceManifest({ ...manifest(), repositories: [row] }), /build revision/);
});

test('explicit Graph source uses only the native config and loopback strict port', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-native-dev-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const graph = path.join(root, 'selected-graph');
  fs.mkdirSync(path.join(root, 'config')); fs.mkdirSync(path.join(graph, 'canvas'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/observability-workspace.json'), JSON.stringify(manifest()));
  fs.writeFileSync(path.join(graph, 'package.json'), JSON.stringify({ name: 'agentic-graph', scripts: { dev: 'native-owner' } }));
  fs.writeFileSync(path.join(graph, 'canvas/vite.observability.config.ts'), 'export default {}');
  const workspace = resolveObservabilityWorkspace(root, { env: { AGENTIC_GRAPH_ROOT: graph, AGENTIC_WORKSPACE_ROOT: root },
    gitText: (_, args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : ' M native.ts' });
  assert.equal(workspace.graphRoot, graph); assert.equal(workspace.sourceDirty, true); assert.equal(workspace.buildRevision, 'a'.repeat(40));
  assert.equal(workspace.env.VITE_OBSERVABILITY_WORKSPACE_MANIFEST, path.join(root, 'config/observability-workspace.json'));
  const plan = observabilityDevPlan(workspace, ['--port', '5199']);
  assert.equal(plan.url, 'http://127.0.0.1:5199/observability.html');
  assert.deepEqual(plan.args, ['run', 'dev', '--', '--config', 'vite.observability.config.ts', '--host', '127.0.0.1', '--port', '5199', '--strictPort']);
  for (const args of [['--host=0.0.0.0'], ['--port=1'], ['--config=foreign.ts']]) assert.throws(() => observabilityDevPlan(workspace, args));
});

test('foreground launcher propagates exit and removes only its own signal handlers', async () => {
  const owner = new EventEmitter(), child = new EventEmitter(); child.pid = 123; child.exitCode = null;
  const kills = []; owner.kill = (...args) => kills.push(args);
  const foreign = () => {}; owner.on('SIGINT', foreign);
  let options;
  const pending = runObservabilityDev({ command: 'npm', args: ['run', 'dev'], cwd: '/selected', env: {} },
    { processOwner: owner, spawnProcess: (_, __, value) => { options = value; return child; } });
  owner.emit('SIGTERM'); assert.deepEqual(kills, [[-123, 'SIGTERM']]);
  child.exitCode = 7; child.emit('exit', 7, null);
  assert.equal(await pending, 7); assert.equal(options.shell, false);
  assert.deepEqual(owner.listeners('SIGINT'), [foreign]); assert.equal(owner.listenerCount('SIGTERM'), 0);
});
