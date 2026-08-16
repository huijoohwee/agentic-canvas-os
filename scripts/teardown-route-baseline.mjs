#!/usr/bin/env node
// Responsibility: Record and replay the fixed teardown HTTP corpus without owning a server.
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
    repositoryRoot, "docs/repository-teardown/route-corpus.json",
  ));
  const corpus = validateCorpus(JSON.parse(await readFile(corpusPath, "utf8")));
  const observations = await executeCorpus({ corpus, baseUrl, fetchImpl });
  if (mode === "record") {
    const outputPath = path.resolve(required(options.out, "--out"));
    const record = buildRecord({ environmentName, baseUrl, corpus, observations });
    await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    return { status: "ok", mode, outputPath, requestCount: record.requests.length };
  }
  const inputPath = path.resolve(required(options.in, "--in"));
  const record = JSON.parse(await readFile(inputPath, "utf8"));
  if (record.environmentName !== environmentName) {
    throw new Error(`Replay environment ${environmentName} differs from ${record.environmentName}.`);
  }
  const expected = new Map(record.requests.map(item => [item.id, item.status]));
  const differences = observations.filter(item => expected.get(item.id) !== item.status)
    .map(item => ({ id: item.id, expected: expected.get(item.id), actual: item.status }));
  return { status: differences.length ? "mismatch" : "ok", mode, differences };
}

export function validateCorpus(value) {
  if (!value || !Array.isArray(value.requests)) throw new Error("Corpus requires requests[].");
  const seen = new Set();
  const requests = value.requests.map((request, index) => {
    const id = required(request.id, `requests[${index}].id`);
    const method = required(request.method, `${id}.method`).toUpperCase();
    const requestPath = required(request.path, `${id}.path`);
    if (seen.has(id)) throw new Error(`Duplicate corpus id ${id}.`);
    seen.add(id);
    return Object.freeze({
      id, method, path: requestPath,
      headers: Object.freeze({ ...(request.headers || {}) }),
      bodyBase64: request.bodyBase64 ?? null,
    });
  });
  for (const route of PRESERVED_ROUTE_SET) {
    if (!requests.some(item => item.method === route.method && item.path === route.path)) {
      throw new Error(`Corpus omits ${route.method} ${route.path}.`);
    }
  }
  return Object.freeze({ schema: "agentic-teardown-route-corpus/v1", requests });
}

export async function executeCorpus({ corpus, baseUrl, fetchImpl }) {
  const observations = [];
  for (const request of corpus.requests) {
    const body = request.bodyBase64 === null ? undefined : Buffer.from(request.bodyBase64, "base64");
    const response = await fetchImpl(new URL(request.path, `${baseUrl}/`), {
      method: request.method, headers: request.headers, body, redirect: "manual",
    });
    const responseBytes = Buffer.from(await response.arrayBuffer());
    observations.push({
      id: request.id, status: response.status,
      responseBodyBase64: responseBytes.toString("base64"),
      responseContentType: response.headers.get("content-type"),
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
        .map(key => [key, payload[key]]),
    );
  } catch { readiness = null; }
  return {
    schema: "agentic-teardown-route-baseline/v1",
    environmentName, baseUrl,
    workerCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    recordedAt: new Date().toISOString(), readiness,
    requests: corpus.requests.map(request => ({
      ...request, ...observations.find(item => item.id === request.id),
    })),
  };
}

function parseOptions(args) {
  return Object.fromEntries(args.map(argument => {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) throw new Error(`Unsupported argument ${argument}.`);
    return [match[1], match[2]];
  }));
}
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
function normalizeBase(value) { return value.replace(/\/+$/u, ""); }
function usage() { return "Usage: teardown-route-baseline.mjs record|replay --env=<name> --base=<url> (--out=<path>|--in=<path>) [--corpus=<path>]"; }
function pathToFileUrl(value) { return value ? new URL(`file://${path.resolve(value)}`).href : ""; }
