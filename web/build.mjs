// Consume verified native Graph output; no secondary compiler or renderer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GRAPH_CONFIG, GRAPH_ENTRY, resolveObservabilityWorkspace, safeRelativePath, sha256 } from './observability-workspace.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST = 'observability-build.json';
const fail = message => { throw new Error('observability-build: ' + message); };
const inside = (root, file) => file.startsWith(root + path.sep);

export function consumeGraphObservabilityBuild(root, workspace, buildRoot) {
  buildRoot = fs.realpathSync(buildRoot);
  const sourceManifest = path.join(buildRoot, MANIFEST);
  if (!inside(buildRoot, fs.realpathSync(sourceManifest))) fail('manifest symlink escapes output');
  const manifestBytes = fs.readFileSync(sourceManifest);
  if (manifestBytes.length > 65536) fail('manifest exceeds 64 KiB');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== 'agentic-graph/observability-build/v1'
    || manifest.sourceRevision !== workspace.sourceRevision || manifest.sourceDirty !== workspace.sourceDirty
    || manifest.workspaceManifestDigest !== workspace.workspaceManifestDigest || manifest.entry !== GRAPH_ENTRY
    || !Array.isArray(manifest.outputs) || !manifest.outputs.length || manifest.outputs.length > 128)
    fail('source identity or artifact manifest mismatch');
  if (sha256(fs.readFileSync(workspace.manifestPath)) !== workspace.workspaceManifestDigest) fail('workspace changed during build');
  const files = new Map(), names = new Set();
  let total = 0;
  for (const row of manifest.outputs) {
    if (!row || !safeRelativePath(row.path) || names.has(row.path)
      || [MANIFEST, 'index.html', 'spatial-workspace-client.mjs', 'canvas-observability-build.json'].includes(row.path)
      || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes >= 500000
      || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')) fail('invalid or oversized native asset');
    const file = path.resolve(buildRoot, row.path);
    if (!inside(buildRoot, fs.realpathSync(file)) || !fs.statSync(file).isFile()) fail('asset escapes native output');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) fail('native asset digest mismatch');
    total += bytes.length; if (total > 16000000) fail('native output exceeds 16 MB');
    names.add(row.path); files.set(row.path, bytes);
  }
  if (!files.has(GRAPH_ENTRY)) fail('native entry is missing');
  if (!fs.readFileSync(sourceManifest).equals(manifestBytes)) fail('native manifest changed during read');
  files.set(MANIFEST, manifestBytes);
  // Root routing is a byte-identical alias, not another document or renderer.
  files.set('index.html', files.get(GRAPH_ENTRY));
  const client = fs.readFileSync(path.join(root, 'web/spatial-workspace-client.mjs'));
  if (client.length >= 500000) fail('spatial client exceeds byte bound');
  files.set('spatial-workspace-client.mjs', client);
  const receipt = { schema: 'agentic-canvas-os/observability-consumption/v1', sourceRevision: manifest.sourceRevision,
    sourceDirty: manifest.sourceDirty, protectedReleaseProof: false, workspaceManifestDigest: manifest.workspaceManifestDigest,
    nativeManifestDigest: sha256(manifestBytes), rootAlias: GRAPH_ENTRY, spatialClientDigest: sha256(client) };
  files.set('canvas-observability-build.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
  const destination = path.join(root, 'web/dist');
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) fail('destination must not be a symlink');
  const inventory = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) fail('existing output contains a symlink');
    return item.isDirectory() ? inventory(file) : [path.relative(destination, file).split(path.sep).join('/')];
  });
  const reused = fs.existsSync(destination) && inventory(destination).sort().join('\n') === [...files.keys()].sort().join('\n')
    && [...files].every(([file, bytes]) => fs.readFileSync(path.join(destination, file)).equals(bytes));
  if (reused) return { reused, ...receipt };
  const stage = destination + '.stage-' + randomUUID(), backup = destination + '.previous-' + randomUUID();
  fs.mkdirSync(stage, { recursive: true });
  let displaced = false;
  try {
    for (const [file, bytes] of files) { const target = path.join(stage, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' }); }
    if (fs.existsSync(destination)) { fs.renameSync(destination, backup); displaced = true; }
    try { fs.renameSync(stage, destination); }
    catch (error) { if (displaced) fs.renameSync(backup, destination); throw error; }
    if (displaced) fs.rmSync(backup, { recursive: true });
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  return { reused: false, ...receipt };
}

export async function buildWeb(root = ROOT, { env = process.env, resolveWorkspace = resolveObservabilityWorkspace,
  run = execFileSync } = {}) {
  const workspace = resolveWorkspace(root, { env });
  run('npm', ['exec', '--workspace', 'canvas', '--', 'vite', 'build', '--configLoader', 'runner', '--config', GRAPH_CONFIG],
    { cwd: workspace.graphRoot, env: workspace.env, stdio: 'inherit', timeout: 180000 });
  const after = resolveWorkspace(root, { env });
  if (after.sourceRevision !== workspace.sourceRevision || after.sourceDirty !== workspace.sourceDirty
    || after.workspaceManifestDigest !== workspace.workspaceManifestDigest) fail('source changed during native build');
  return consumeGraphObservabilityBuild(root, workspace, path.join(workspace.graphRoot, 'canvas/dist/observability'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildWeb();
  console.log(`Native Graph output ${result.reused ? 'reused' : 'verified'} at web/dist; source ${result.sourceRevision}, dirty=${result.sourceDirty}. Local artifact only; no protected release claim.`);
}
