import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

export const WORKSPACE_SCHEMA = 'agentic-canvas-os/observability-workspace/v1';
export const GRAPH_ENTRY = 'observability.html';
export const GRAPH_CONFIG = 'vite.observability.config.ts';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error('observability-workspace: ' + message); };
const text = (value, maximum) => typeof value === 'string' && value.trim() === value
  && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
const within = (root, file) => file === root || file.startsWith(root + path.sep);
export const safeRelativePath = value => text(value, 256) && !path.isAbsolute(value)
  && !value.includes('\\') && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part));

export function validateWorkspaceManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['schema', 'title', 'readOnly', 'repositories'].includes(key))
    || value.schema !== WORKSPACE_SCHEMA || !text(value.title, 128) || value.readOnly !== true
    || !Array.isArray(value.repositories) || value.repositories.length < 1 || value.repositories.length > 32)
    fail('invalid manifest');
  const ids = new Set(), paths = new Set();
  for (const row of value.repositories) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).sort().join(',') !== 'id,label,path'
      || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id ?? '') || !text(row.label, 128)
      || !safeRelativePath(row.path) || ids.has(row.id) || paths.has(row.path)) fail('invalid or duplicate repository');
    ids.add(row.id); paths.add(row.path);
  }
  return JSON.parse(JSON.stringify(value));
}

const git = (root, args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();

export function resolveObservabilityWorkspace(root, { env = process.env, gitText = git } = {}) {
  root = fs.realpathSync(root);
  const manifestPath = path.join(root, 'config/observability-workspace.json');
  if (!within(root, fs.realpathSync(manifestPath))) fail('manifest escapes repository');
  const bytes = fs.readFileSync(manifestPath);
  if (bytes.length > 65536) fail('manifest exceeds 64 KiB');
  const manifest = validateWorkspaceManifest(JSON.parse(bytes.toString('utf8')));
  const common = env.AGENTIC_WORKSPACE_ROOT ? null : gitText(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const workspaceRoot = fs.realpathSync(env.AGENTIC_WORKSPACE_ROOT || path.dirname(path.dirname(common)));
  for (const row of manifest.repositories) {
    const candidate = path.resolve(workspaceRoot, row.path);
    if (!within(workspaceRoot, candidate)) fail('repository path escapes workspace');
    if (fs.existsSync(candidate) && !within(workspaceRoot, fs.realpathSync(candidate))) fail('repository symlink escapes workspace');
  }
  const provider = manifest.repositories.find(row => row.id === 'agentic-graph');
  const graphRoot = fs.realpathSync(env.AGENTIC_GRAPH_ROOT || path.join(workspaceRoot, provider?.path || 'agentic-graph'));
  const pkg = JSON.parse(fs.readFileSync(path.join(graphRoot, 'package.json'), 'utf8'));
  if (pkg.name !== 'agentic-graph' || typeof pkg.scripts?.dev !== 'string') fail('selected provider is not the native Graph application');
  if (!fs.statSync(path.join(graphRoot, 'canvas', GRAPH_CONFIG)).isFile()) fail('native Graph observability entry is unavailable');
  const sourceRevision = gitText(graphRoot, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) fail('invalid Graph source revision');
  const sourceDirty = Boolean(gitText(graphRoot, ['status', '--porcelain', '--untracked-files=normal']));
  return { root, manifest, manifestPath, workspaceManifestDigest: sha256(bytes), workspaceRoot, graphRoot,
    sourceRevision, sourceDirty, env: { ...env, AGENTIC_WORKSPACE_ROOT: workspaceRoot,
      VITE_OBSERVABILITY_WORKSPACE_MANIFEST: manifestPath } };
}

export function observabilityDevPlan(workspace, args = []) {
  let host = '127.0.0.1', port = Number(workspace.env.PORT || 5175);
  for (let index = 0; index < args.length; index++) {
    const match = /^(--host|--port)(?:=(.*))?$/.exec(args[index]);
    if (!match) fail('only --host and --port are supported');
    const value = match[2] ?? args[++index];
    if (match[1] === '--host') host = value; else port = Number(value);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !Number.isInteger(port) || port < 1024 || port > 65535)
    fail('expected a loopback host and port 1024..65535');
  return { command: 'npm', args: ['run', 'dev', '--', '--config', GRAPH_CONFIG, '--host', host, '--port', String(port), '--strictPort'],
    cwd: workspace.graphRoot, env: workspace.env,
    url: `http://${host === '::1' ? '[::1]' : host}:${port}/${GRAPH_ENTRY}` };
}

export async function runObservabilityDev(plan, { spawnProcess = spawn, processOwner = process } = {}) {
  const detached = process.platform !== 'win32';
  const child = spawnProcess(plan.command, plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'inherit', shell: false, detached });
  return new Promise((resolve, reject) => {
    const stop = signal => {
      if (!child.pid || child.exitCode !== null) return;
      try { if (detached) processOwner.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    const cleanup = () => { processOwner.off('SIGINT', interrupt); processOwner.off('SIGTERM', terminate); };
    processOwner.on('SIGINT', interrupt); processOwner.on('SIGTERM', terminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => { cleanup(); resolve(Number.isInteger(code) ? code : signal ? 1 : 0); });
  });
}
