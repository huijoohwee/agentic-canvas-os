import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createSourceEvidenceExtension } from "../worker/source-evidence-extension.js";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const revision = "a".repeat(40);
const tree = "b".repeat(40);
const snapshotSha256 = "c".repeat(64);
const source = "export const greeting = 'hello';\n";
const sourceSha256 = sha256(source);
const catalogKey = "source-evidence/catalog.json";
const manifestKey = "source-evidence/sample-app/manifest.json";
const sourceKey = `source-evidence/sample-app/${snapshotSha256}/src-main.js`;

function responseObject(value) {
  const bytes = new TextEncoder().encode(value);
  return Object.freeze({
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  });
}

function extension({ allowed = true } = {}) {
  const objects = new Map([
    [catalogKey, JSON.stringify({
      schema: "agentic-os/source-evidence-catalog/v1",
      title: "Source evidence",
      readOnly: true,
      repositories: [{ id: "sample-app", label: "Sample application", manifestKey }],
    })],
    [manifestKey, JSON.stringify({
      schema: "agentic-os/source-evidence-manifest/v1",
      repository: { id: "sample-app", label: "Sample application" },
      revision,
      tree,
      snapshotSha256,
      sourceMode: "committed-clean",
      files: [{
        path: "src/main.js",
        sha256: sourceSha256,
        bytes: new TextEncoder().encode(source).byteLength,
        objectKey: sourceKey,
        facts: ["exports greeting"],
        imports: [],
      }],
    })],
    [sourceKey, source],
  ]);
  const reads = [];
  return {
    reads,
    extension: createSourceEvidenceExtension({ env: {
      AGENTIC_OS_SOURCE_EVIDENCE: {
        async get(key) {
          reads.push(key);
          const value = objects.get(key);
          return value === undefined ? null : responseObject(value);
        },
      },
      SOURCE_EVIDENCE_RATE_LIMITER: { async limit() { return { success: allowed }; } },
    } }),
  };
}

async function json(response) {
  assert.ok(response instanceof Response);
  return response.json();
}

test("source-evidence manifest is catalog-only and read-only", async () => {
  const { extension: handler } = extension();
  const result = await json(await handler.handle(new Request("https://example.test/api/observability-workspace/manifest")));

  assert.deepEqual(result, {
    schema: "agentic-canvas-os/observability-workspace/v1",
    title: "Source evidence",
    readOnly: true,
    repositories: [{ id: "sample-app", label: "Sample application" }],
  });
});

test("source-evidence context returns a digest-fenced bounded map and exact read", async () => {
  const { extension: handler } = extension();
  const mapped = await handler.handle(new Request("https://example.test/api/observability-workspace/source-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repositoryId: "sample-app", operation: "map", path: "src" }),
  }));
  assert.equal(mapped.status, 200);
  assert.deepEqual(await json(mapped), {
    schema: "agentic-os/codebase-context/v1",
    operation: "map",
    scope: "src",
    revision,
    snapshotSha256,
    sourceMode: "immutable-evidence-bundle",
    freshness: "artifact-sha256-verified",
    atomicSnapshot: true,
    remoteFreshness: "not-applicable",
    grantsAuthority: false,
    selectedRepository: { id: "sample-app", label: "Sample application" },
    repositoryState: { repository: "Sample application", revision, tree, dirty: false },
    limits: { files: 512, fileBytes: 128 * 1024, sourceBytes: 1024 * 1024, outputBytes: 64 * 1024, results: 20, lines: 80, durationMs: 10_000 },
    results: [{ path: "src/main.js", sha256: sourceSha256, bytes: source.length, facts: ["exports greeting"], imports: [] }],
    totalMatches: 1,
    nextAfter: null,
  });

  const read = await handler.handle(new Request("https://example.test/api/observability-workspace/source-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repositoryId: "sample-app", operation: "read", path: "src/main.js", sha256: sourceSha256, line: 1, lines: 1 }),
  }));
  assert.equal(read.status, 200);
  const body = await json(read);
  assert.equal(body.content, "export const greeting = 'hello';");
  assert.equal(body.nextLine, 2);
  assert.equal(body.objectKey, undefined);
});

test("source-evidence rejects traversal before reading storage and enforces the rate limit", async () => {
  const rejected = extension();
  const invalid = await rejected.extension.handle(new Request("https://example.test/api/observability-workspace/source-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repositoryId: "sample-app", operation: "map", path: "../private" }),
  }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await json(invalid), { error: "source evidence request was rejected" });
  assert.deepEqual(rejected.reads, [catalogKey]);

  const limited = extension({ allowed: false });
  const rateLimited = await limited.extension.handle(new Request("https://example.test/api/observability-workspace/manifest"));
  assert.equal(rateLimited.status, 429);
  assert.deepEqual(await json(rateLimited), { error: "rate limit exceeded" });
  assert.deepEqual(limited.reads, []);
});
