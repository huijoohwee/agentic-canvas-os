#!/usr/bin/env node
// Responsibility: Record and replay the fixed product runtime HTTP corpus without owning a server.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const PRESERVED_ROUTE_SET = Object.freeze([
  ["GET", "/"], ["POST", "/api/auth/session"], ["POST", "/auth/session"],
  ["POST", "/api/invoke"], ["POST", "/invoke"], ["POST", "/api/run"],
  ["POST", "/run"], ["GET", "/api/ready"], ["GET", "/ready"],
  ["GET", "/api/canvas/room"], ["GET", "/canvas/room"],
  ["POST", "/api/function-call"], ["POST", "/function-call"],
  ["POST", "/api/function-call/recover"], ["POST", "/function-call/recover"],
  ["POST", "/api/function-call/resume"], ["POST", "/function-call/resume"],
].map(([method, routePath]) => Object.freeze({ method, path: routePath })));

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const [command, ...argumentsList] = process.argv.slice(2);

if (import.meta.url === pathToFileUrl(process.argv[1])) {
  try {
    const result = await runCli(command, argumentsList);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "ok") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export async function runCli(mode, args, { fetchImpl = fetch } = {}) {
  if (!["record", "replay"].includes(mode)) throw new Error(usage());
  const options = parseOptions(args);
  const environmentName = required(options.env, "--env");
  const baseUrl = normalizeBase(required(options.base, "--base"));
  const corpusPath = path.resolve(options.corpus || path.join(
    repositoryRoot, "docs/runtime-route-contract/route-corpus.json",
  ));
  const corpus = validateCorpus(JSON.parse(await readFile(corpusPath, "utf8")));
  if (mode === "record") {
    const observations = await executeCorpus({ corpus, baseUrl, fetchImpl });
    const outputPath = path.resolve(required(options.out, "--out"));
    const record = buildRecord({ environmentName, baseUrl, corpus, observations });
    validateRecord(record, corpus);
    await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    return { status: "ok", mode, outputPath, requestCount: record.results.length };
  }
  const inputPath = path.resolve(required(options.in, "--in"));
  const record = JSON.parse(await readFile(inputPath, "utf8"));
  if (record.environmentName !== environmentName) {
    throw new Error(`Replay environment ${environmentName} differs from ${record.environmentName}.`);
  }
  validateRecord(record, corpus);
  const observations = await executeCorpus({ corpus, baseUrl, fetchImpl });
  const expectedResults = new Map(record.results.map(item => [item.id, item.status]));
  const differences = observations.flatMap(item => (
    expectedResults.get(item.id) === item.status
      ? []
      : [{ id: item.id, expected: expectedResults.get(item.id), actual: item.status }]
  ));
  return { status: differences.length ? "mismatch" : "ok", mode, differences };
}

export function validateCorpus(value) {
  if (!value || !Array.isArray(value.requests)) throw new Error("Corpus requires requests[].");
  const seen = new Set();
  const requests = value.requests.map((request, index) => {
    const id = required(request.id, `requests[${index}].id`);
    const method = required(request.method, `${id}.method`).toUpperCase();
    const requestPath = required(request.path, `${id}.path`);
    const search = request.search ?? "";
    const capture = request.capture ?? null;
    if (seen.has(id)) throw new Error(`Duplicate corpus id ${id}.`);
    if (typeof search !== "string" || search && !search.startsWith("?")) {
      throw new Error(`${id}.search must be empty or begin with ?.`);
    }
    if (capture !== null && capture !== "sessionToken") {
      throw new Error(`${id}.capture is unsupported.`);
    }
    if (request.bodyBase64 !== null && request.bodyBase64 !== undefined
      && (typeof request.bodyBase64 !== "string"
        || Buffer.from(request.bodyBase64, "base64").toString("base64") !== request.bodyBase64)) {
      throw new Error(`${id}.bodyBase64 is invalid.`);
    }
    seen.add(id);
    return Object.freeze({
      id, method, path: requestPath,
      headers: Object.freeze({ ...(request.headers || {}) }),
      bodyBase64: request.bodyBase64 ?? null,
      search,
      capture,
    });
  });
  for (const route of PRESERVED_ROUTE_SET) {
    if (!requests.some(item => item.method === route.method && item.path === route.path)) {
      throw new Error(`Corpus omits ${route.method} ${route.path}.`);
    }
  }
  return Object.freeze({ schema: "agentic-runtime-route-corpus/v1", requests });
}

export async function executeCorpus({ corpus, baseUrl, fetchImpl }) {
  const observations = [];
  const captures = new Map();
  for (const request of corpus.requests) {
    const body = request.bodyBase64 === null ? undefined : Buffer.from(request.bodyBase64, "base64");
    const search = request.search.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu, (_, key) => {
      if (!captures.has(key)) throw new Error(`Corpus capture ${key} is unavailable.`);
      return encodeURIComponent(captures.get(key));
    });
    const response = await fetchImpl(new URL(`${request.path}${search}`, `${baseUrl}/`), {
      method: request.method, headers: request.headers, body, redirect: "manual",
    });
    const responseBytes = Buffer.from(await response.arrayBuffer());
    if (request.capture === "sessionToken") {
      let payload;
      try { payload = JSON.parse(responseBytes.toString("utf8")); } catch { payload = null; }
      if (typeof payload?.token !== "string" || !payload.token) {
        throw new Error(`Corpus request ${request.id} did not return a session token.`);
      }
      captures.set("sessionToken", payload.token);
    } else if (request.capture !== null) {
      throw new Error(`Corpus request ${request.id} has an unsupported capture.`);
    }
    observations.push({
      id: request.id, status: response.status,
      responseBodyBase64: responseBytes.toString("base64"),
      responseHeaders: Object.fromEntries([...response.headers.entries()]
        .sort(([left], [right]) => left.localeCompare(right))),
    });
  }
  return observations;
}

export function buildRecord({ environmentName, baseUrl, corpus, observations }) {
  const readinessObservation = observations.find(item => (
    corpus.requests.find(request => request.id === item.id)?.path === "/api/ready"
  ));
  let readiness = null;
  try {
    const payload = JSON.parse(Buffer.from(readinessObservation.responseBodyBase64, "base64"));
    readiness = Object.fromEntries(
      ["configured", "auth", "controlPlane", "modelProviders", "functionCalling"]
        .map(key => [key, readinessBoolean(payload[key])]),
    );
  } catch { readiness = null; }
  return {
    schema: "agentic-runtime-route-baseline/v1",
    environmentName, baseUrl,
    workerCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    recordedAt: new Date().toISOString(), readiness,
    corpusDigest: corpusDigest(corpus),
    results: observations.map(observation => ({
      id: observation.id,
      status: observation.status,
    })),
  };
}

function readinessBoolean(value) {
  if (typeof value === "boolean") return value;
  return typeof value?.configured === "boolean" ? value.configured : null;
}

export function validateRecord(record, corpus) {
  if (record?.schema !== "agentic-runtime-route-baseline/v1") throw new Error("Baseline schema is invalid.");
  if (record.corpusDigest !== corpusDigest(corpus)) throw new Error("Baseline corpus differs from the tracked corpus.");
  if (!Array.isArray(record.results) || record.results.length !== corpus.requests.length) throw new Error("Baseline results are incomplete.");
  const ids = new Set(record.results.map(item => item.id));
  if (ids.size !== corpus.requests.length || corpus.requests.some(request => !ids.has(request.id))) throw new Error("Baseline result ids differ from the corpus.");
  for (const result of record.results) {
    if (Object.keys(result).sort().join("\0") !== "id\0status"
      || !Number.isSafeInteger(result.status) || result.status < 100 || result.status > 599) {
      throw new Error(`Baseline result ${result.id || "<unknown>"} is invalid.`);
    }
  }
  const readinessKeys = ["configured", "auth", "controlPlane", "modelProviders", "functionCalling"];
  if (!record.readiness || Object.keys(record.readiness).sort().join("\0") !== [...readinessKeys].sort().join("\0")
    || Object.values(record.readiness).some(value => typeof value !== "boolean")) {
    throw new Error("Baseline readiness values are invalid.");
  }
  return record;
}

export function deriveReadiness(bindings) {
  const auth = Boolean(bindings?.AGENT_API_JWT_SECRET && bindings?.AGENT_REVIEW_JWT_SECRET);
  const controlPlane = Boolean(bindings?.CONTROL_PLANE_URL);
  const modelProviders = Boolean(bindings?.MODEL_PROVIDER);
  return Object.freeze({
    configured: auth && controlPlane && modelProviders,
    auth,
    controlPlane,
    modelProviders,
    functionCalling: Boolean(bindings?.FUNCTION_CALLING),
  });
}

export function workerFirstMatches(pattern, requestPath) {
  if (pattern === requestPath) return true;
  if (!pattern.endsWith("/*")) return false;
  const prefix = pattern.slice(0, -1);
  return requestPath.startsWith(prefix) && requestPath.length > prefix.length;
}

export function compareRouteStatuses({ baseline, observed }) {
  const expected = new Map(baseline.map(item => [`${item.method} ${item.path}`, item.status]));
  return observed.filter(item => expected.get(`${item.method} ${item.path}`) !== item.status);
}

export function corpusDigest(corpus) {
  return execFileSync("git", ["hash-object", "--stdin"], {
    cwd: repositoryRoot, input: JSON.stringify(corpus), encoding: "utf8",
  }).trim();
}

export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inline = argument.match(/^--([^=]+)=(.*)$/u);
    if (inline) {
      options[inline[1]] = inline[2];
      continue;
    }
    if (!argument.startsWith("--") || index + 1 >= args.length
      || args[index + 1].startsWith("--")) {
      throw new Error(`Unsupported argument ${argument}.`);
    }
    options[argument.slice(2)] = args[index + 1];
    index += 1;
  }
  return options;
}
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
function normalizeBase(value) { return value.replace(/\/+$/u, ""); }
function usage() { return "Usage: runtime-route-contract.mjs record|replay --env <name> --base <url> (--out <path>|--in <path>) [--corpus <path>]"; }
function pathToFileUrl(value) { return value ? new URL(`file://${path.resolve(value)}`).href : ""; }
