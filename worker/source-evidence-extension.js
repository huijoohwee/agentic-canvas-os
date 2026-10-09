import { createHash } from 'node:crypto';

const CATALOG_SCHEMA = 'agentic-os/source-evidence-catalog/v1';
const MANIFEST_SCHEMA = 'agentic-os/source-evidence-manifest/v1';
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_SEARCH_FILES = 80;
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_RESULTS = 20;
const MAX_LINES = 80;
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json', 'cache-control': 'no-store' });
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;

class SourceEvidenceUnavailable extends Error {}

const json = (status, value) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
const objectKey = value => typeof value === 'string' && value.length <= 512 && !value.startsWith('/')
  && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
const sourcePath = value => typeof value === 'string' && value.length <= 512 && !value.includes('\\')
  && !value.split('/').some(part => !part || part === '.' || part === '..') && !/[\x00-\x1f\x7f]/.test(value);
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const sha256 = value => createHash('sha256').update(value).digest('hex');

function validateCatalog(value) {
  if (!exactKeys(value, ['schema', 'title', 'readOnly', 'repositories']) || value.schema !== CATALOG_SCHEMA
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160
    || value.readOnly !== true || !Array.isArray(value.repositories) || !value.repositories.length || value.repositories.length > 32) {
    throw new Error('invalid source evidence catalog');
  }
  const ids = new Set();
  for (const entry of value.repositories) {
    if (!exactKeys(entry, ['id', 'label', 'manifestKey']) || !ID.test(entry.id) || ids.has(entry.id)
      || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 160 || !objectKey(entry.manifestKey)) {
      throw new Error('invalid source evidence catalog entry');
    }
    ids.add(entry.id);
  }
  return value;
}

function validateManifest(value, expectedId) {
  if (!exactKeys(value, ['schema', 'repository', 'revision', 'tree', 'snapshotSha256', 'sourceMode', 'files'])
    || value.schema !== MANIFEST_SCHEMA || !exactKeys(value.repository, ['id', 'label']) || value.repository.id !== expectedId
    || !ID.test(value.repository.id) || typeof value.repository.label !== 'string' || !value.repository.label.trim()
    || !SHA1.test(value.revision) || !SHA1.test(value.tree) || !SHA256.test(value.snapshotSha256)
    || value.sourceMode !== 'committed-clean' || !Array.isArray(value.files) || value.files.length > 512) {
    throw new Error('invalid source evidence manifest');
  }
  const paths = new Set();
  for (const file of value.files) {
    if (!exactKeys(file, ['path', 'sha256', 'bytes', 'objectKey', 'facts', 'imports']) || !sourcePath(file.path)
      || paths.has(file.path) || !SHA256.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES
      || !objectKey(file.objectKey) || !file.objectKey.startsWith(`source-evidence/${expectedId}/${value.snapshotSha256}/`)
      || !Array.isArray(file.facts) || !Array.isArray(file.imports) || file.facts.length > 16 || file.imports.length > 16) {
      throw new Error('invalid source evidence file');
    }
    paths.add(file.path);
  }
  return value;
}

async function readObject(bucket, key, maximumBytes) {
  if (!bucket || typeof bucket.get !== 'function') throw new SourceEvidenceUnavailable('source evidence storage is not configured');
  const object = await bucket.get(key);
  if (!object) return null;
  if (Number.isFinite(object.size) && object.size > maximumBytes) throw new Error('source evidence object exceeds its bound');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error('source evidence object exceeds its bound');
  return bytes;
}

async function rateLimitAllows(binding, request) {
  if (!binding || typeof binding.limit !== 'function') throw new SourceEvidenceUnavailable('source evidence admission is not configured');
  try {
    const address = request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
    return (await binding.limit({ key: `source-evidence:${address.slice(0, 128)}` }))?.success === true;
  } catch { throw new SourceEvidenceUnavailable('source evidence admission is unavailable'); }
}

function parseJson(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not valid JSON`); }
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new RangeError('request body exceeds its bound');
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) { await reader.cancel(); throw new RangeError('request body exceeds its bound'); }
    chunks.push(value);
  }
  return parseJson(new Blob(chunks).size === 0 ? new Uint8Array() : new Uint8Array(await new Blob(chunks).arrayBuffer()), 'request body');
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ID.test(input.repositoryId || '')) throw new Error('repositoryId is required');
  const operation = input.operation;
  const allowed = operation === 'map' ? ['repositoryId', 'operation', 'path', 'limit', 'after']
    : operation === 'search' ? ['repositoryId', 'operation', 'path', 'query', 'limit', 'after']
      : operation === 'read' ? ['repositoryId', 'operation', 'path', 'sha256', 'line', 'lines'] : [];
  if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key)) || !sourcePath(input.path || '')) throw new Error('invalid source evidence request');
  const integer = (value, fallback, maximum) => value === undefined ? fallback : Number.isInteger(value) && value >= 1 && value <= maximum ? value : null;
  const limit = integer(input.limit, operation === 'search' ? 5 : 10, MAX_RESULTS);
  if (limit === null || (input.after !== undefined && !sourcePath(input.after))) throw new Error('invalid source evidence pagination');
  if (operation === 'search' && (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 256 || /[\x00-\x1f\x7f]/.test(input.query))) throw new Error('invalid source evidence query');
  if (operation === 'read' && (!SHA256.test(input.sha256 || '') || integer(input.line, 1, 1_000_000) === null || integer(input.lines, 40, MAX_LINES) === null)) throw new Error('invalid exact source read');
  return { ...input, limit, line: integer(input.line, 1, 1_000_000), lines: integer(input.lines, 40, MAX_LINES) };
}

const withinScope = (path, scope) => path === scope || path.startsWith(`${scope}/`);
const page = (items, after, limit) => {
  const remaining = items.filter(item => !after || item.path > after);
  const results = remaining.slice(0, limit);
  return { results, totalMatches: items.length, nextAfter: remaining.length > limit ? results.at(-1).path : null };
};

function publicFile(file) { return { path: file.path, sha256: file.sha256, bytes: file.bytes, facts: file.facts, imports: file.imports }; }
function receipt(manifest, input, result) {
  return { schema: 'agentic-os/codebase-context/v1', operation: input.operation, scope: input.path,
    revision: manifest.revision, snapshotSha256: manifest.snapshotSha256, sourceMode: 'immutable-evidence-bundle',
    freshness: 'artifact-sha256-verified', atomicSnapshot: true, remoteFreshness: 'not-applicable', grantsAuthority: false,
    selectedRepository: manifest.repository, repositoryState: { repository: manifest.repository.label, revision: manifest.revision, tree: manifest.tree, dirty: false },
    limits: { files: 512, fileBytes: MAX_FILE_BYTES, sourceBytes: MAX_SEARCH_BYTES, outputBytes: MAX_RESPONSE_BYTES, results: MAX_RESULTS, lines: MAX_LINES, durationMs: 10_000 }, ...result };
}

function boundedExcerpt(lines) {
  let output = '';
  for (const text of lines) {
    const next = output ? `${output}\n${text}` : text;
    if (new TextEncoder().encode(next).byteLength > MAX_RESPONSE_BYTES) return { content: output, truncated: true };
    output = next;
  }
  return { content: output, truncated: false };
}

async function sourceText(bucket, file) {
  const bytes = await readObject(bucket, file.objectKey, MAX_FILE_BYTES);
  if (!bytes || sha256(bytes) !== file.sha256) throw new Error('source evidence content digest mismatch');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function operate(bucket, manifest, input) {
  const files = manifest.files.filter(file => withinScope(file.path, input.path)).sort((left, right) => left.path.localeCompare(right.path));
  if (input.operation === 'map') return receipt(manifest, input, page(files.map(publicFile), input.after, input.limit));
  if (input.operation === 'read') {
    const file = files.find(item => item.path === input.path && item.sha256 === input.sha256);
    if (!file) throw new Error('source file is missing or stale');
    const lines = (await sourceText(bucket, file)).split('\n');
    if (input.line > lines.length) throw new Error('source line is outside the file');
    const excerpt = boundedExcerpt(lines.slice(input.line - 1, input.line - 1 + input.lines));
    return receipt(manifest, input, { ...publicFile(file), line: input.line, ...excerpt,
      nextLine: input.line + input.lines <= lines.length ? input.line + input.lines : null });
  }
  const needle = input.query.trim().toLowerCase(), matches = [];
  let inspected = 0, bytes = 0, complete = true;
  for (const file of files) {
    if (inspected >= MAX_SEARCH_FILES || bytes + file.bytes > MAX_SEARCH_BYTES) { complete = false; break; }
    inspected += 1; bytes += file.bytes;
    const lines = (await sourceText(bucket, file)).split('\n');
    const matching = lines.flatMap((line, index) => line.toLowerCase().includes(needle) ? [index + 1] : []);
    const pathMatch = file.path.toLowerCase().includes(needle);
    if (matching.length || pathMatch) matches.push({ ...publicFile(file), line: matching[0] ?? 1, matchingLines: matching.length, pathMatch });
  }
  const result = page(matches, input.after, input.limit);
  return receipt(manifest, input, { ...result, coverage: { complete, filesInScope: files.length, filesInspected: inspected, sourceBytesInspected: bytes } });
}

export function createSourceEvidenceExtension({ env = {} } = {}) {
  return Object.freeze({
    async handle(request) {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/^\/agentic-os(?=\/)/, '');
      const route = pathname.match(/^\/api\/observability-workspace\/(manifest|source-context)$/)?.[1];
      if (!route) return null;
      try {
        if (!await rateLimitAllows(env.SOURCE_EVIDENCE_RATE_LIMITER, request)) {
          return new Response(JSON.stringify({ error: 'rate limit exceeded' }), { status: 429, headers: { ...JSON_HEADERS, 'retry-after': '60' } });
        }
        const catalogKey = typeof env.AGENTIC_OS_SOURCE_EVIDENCE_CATALOG_KEY === 'string' && objectKey(env.AGENTIC_OS_SOURCE_EVIDENCE_CATALOG_KEY)
          ? env.AGENTIC_OS_SOURCE_EVIDENCE_CATALOG_KEY : 'source-evidence/catalog.json';
        const catalogBytes = await readObject(env.AGENTIC_OS_SOURCE_EVIDENCE, catalogKey, MAX_CATALOG_BYTES);
        if (!catalogBytes) return json(503, { error: 'source evidence catalog is unavailable' });
        const catalog = validateCatalog(parseJson(catalogBytes, 'source evidence catalog'));
        if (route === 'manifest') {
          if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
          return json(200, { schema: 'agentic-canvas-os/observability-workspace/v1', title: catalog.title, readOnly: true,
            repositories: catalog.repositories.map(({ id, label }) => ({ id, label })) });
        }
        if (request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: 'JSON POST required' });
        const input = normalizeInput(await readBody(request));
        const entry = catalog.repositories.find(item => item.id === input.repositoryId);
        if (!entry) return json(404, { error: 'selected repository is unavailable' });
        const manifestBytes = await readObject(env.AGENTIC_OS_SOURCE_EVIDENCE, entry.manifestKey, MAX_MANIFEST_BYTES);
        if (!manifestBytes) return json(503, { error: 'source evidence manifest is unavailable' });
        const manifest = validateManifest(parseJson(manifestBytes, 'source evidence manifest'), entry.id);
        if (manifest.repository.label !== entry.label) throw new Error('source evidence catalog and manifest disagree');
        const result = await operate(env.AGENTIC_OS_SOURCE_EVIDENCE, manifest, input);
        console.log(JSON.stringify({ event: 'source_evidence_read', operation: input.operation, repositoryId: entry.id, status: 'ok' }));
        return json(200, result);
      } catch (error) {
        console.log(JSON.stringify({ event: 'source_evidence_read', status: 'rejected', reason: error instanceof RangeError ? 'bound' : 'invalid' }));
        return json(error instanceof SourceEvidenceUnavailable ? 503 : error instanceof RangeError ? 413 : 400, { error: 'source evidence request was rejected' });
      }
    },
    async beforeReadiness() {},
  });
}
