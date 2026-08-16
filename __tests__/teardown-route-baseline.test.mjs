import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PRESERVED_ROUTE_SET, buildRecord, executeCorpus, parseOptions, validateCorpus, validateRecord } from "../scripts/teardown-route-baseline.mjs";

const corpus = validateCorpus(JSON.parse(await readFile(new URL("../docs/repository-teardown/route-corpus.json", import.meta.url))));

test("accepts the documented separated option form", () => {
  assert.deepEqual(parseOptions(["--env", "local", "--base", "http://127.0.0.1:8787"]), {
    env: "local", base: "http://127.0.0.1:8787",
  });
});

test("tracked corpus covers each preserved pair exactly once", () => {
  assert.equal(corpus.requests.length, 17);
  assert.deepEqual(corpus.requests.map(({ method, path }) => ({ method, path })), PRESERVED_ROUTE_SET);
});

test("executes exact request body bytes and records response evidence for readiness", async () => {
  const seen = [];
  const observations = await executeCorpus({ corpus: { requests: corpus.requests.slice(0, 2) }, baseUrl: "http://127.0.0.1:8787", fetchImpl: async (url, init) => { seen.push([url.pathname, init.body && Buffer.from(init.body).toString("base64")]); return new Response(url.pathname === "/api/auth/session" ? '{"token":"session-token"}' : "{}", { status: 201, headers: { "content-type": "application/json" } }); } });
  assert.deepEqual(seen, [["/", undefined], ["/api/auth/session", "eyJyb29tSWRzIjpbIjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmIl19"]]);
  assert.deepEqual(observations.map(item => item.status), [201, 201]);
  assert.deepEqual(observations.map(item => item.responseBodyBase64), [
    "e30=", "eyJ0b2tlbiI6InNlc3Npb24tdG9rZW4ifQ==",
  ]);
  assert.deepEqual(observations[0].responseHeaders, { "content-type": "application/json" });
});

test("baseline rejects corpus drift", () => {
  const observations = corpus.requests.map(request => ({ id: request.id, status: 200,
    responseBodyBase64: request.path === "/api/ready"
      ? Buffer.from('{"configured":false,"auth":{"configured":true},"controlPlane":{"configured":true},"modelProviders":{"configured":false},"functionCalling":{"configured":false}}').toString("base64")
      : "",
    responseHeaders: { "content-type": "application/json" } }));
  const record = buildRecord({ environmentName: "local-dev", baseUrl: "http://127.0.0.1:8787", corpus, observations });
  assert.deepEqual(record.results[0], { id: "root", status: 200 });
  assert.deepEqual(record.readiness, {
    configured: false,
    auth: true,
    controlPlane: true,
    modelProviders: false,
    functionCalling: false,
  });
  assert.equal(validateRecord(record, corpus), record);
  assert.throws(() => validateRecord({ ...record, corpusDigest: "drift" }, corpus), /differs/u);
});
