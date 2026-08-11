#!/usr/bin/env node
// Responsibility: Expose only read-only history audit and advisory planning from explicit repository inputs.

import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createHistoryLifecycleController } from "./history-lifecycle-controller.mjs";
import { createHistoryLifecycleRepositoryAdapter } from "./history-lifecycle-repository-adapter.mjs";

const MODES = new Set(["audit", "plan"]);
const OPTIONS = new Set([
  "repository",
  "comparison-ref",
  "remote",
  "provider-repository",
]);

export async function runHistoryLifecycle(options, dependencies = {}) {
  const adapter = dependencies.adapter || createHistoryLifecycleRepositoryAdapter({
    repository: options.repository,
    comparisonRef: options.comparisonRef,
    remoteName: options.remoteName,
    providerRepository: options.providerRepository,
  }, dependencies.adapterDependencies);
  const controller = createHistoryLifecycleController({ adapter });
  return controller[options.mode]();
}

export function parseHistoryLifecycleArguments(argumentsList) {
  const [mode, ...rawOptions] = [...argumentsList];
  if (!MODES.has(mode)) {
    throw new Error("History lifecycle mode must be audit or plan; mutation modes are unavailable.");
  }
  let json = false;
  const values = {};
  for (const argument of rawOptions) {
    if (argument === "--json") {
      if (json) throw new Error("Duplicate history lifecycle option: json.");
      json = true;
      continue;
    }
    const match = argument.match(/^--([a-z][a-z-]*)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1])) {
      throw new Error(`Unsupported history lifecycle option: ${argument}`);
    }
    if (Object.hasOwn(values, match[1])) {
      throw new Error(`Duplicate history lifecycle option: ${match[1]}.`);
    }
    values[match[1]] = exactText(match[2], match[1]);
  }
  const comparisonRef = exactText(values["comparison-ref"], "comparison-ref");
  if (!comparisonRef.startsWith("refs/") || comparisonRef.includes("..")
    || comparisonRef.includes("@{") || /[\s~^:?*[\\]/u.test(comparisonRef)) {
    throw new Error("comparison-ref must be one fully qualified, non-revision Git ref.");
  }
  return Object.freeze({
    mode,
    repository: realpathSync(path.resolve(exactText(values.repository, "repository"))),
    comparisonRef,
    remoteName: values.remote || null,
    providerRepository: values["provider-repository"] || null,
    json,
  });
}

async function main() {
  const options = parseHistoryLifecycleArguments(process.argv.slice(2));
  const result = await runHistoryLifecycle(options);
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 0 : 2)}\n`);
}

function exactText(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required and whitespace-exact.`);
  }
  return value;
}

export function sanitizeHistoryLifecycleError(error) {
  if (error && typeof error === "object" && ("stderr" in error || "stdout" in error)) {
    return "External command failed without public diagnostics.";
  }
  return String(error instanceof Error ? error.message : error)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, "[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/giu, "$1[redacted]@")
    .replace(/([?&](?:access_token|api_key|key|password|token)=)[^&\s"']+/giu, "$1[redacted]")
    .replace(/(^|[\s("'=])(?:\/(?!\/)[^\s"'<>),;]+)+/gu, "$1[local-path]")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]+/gu, "[local-path]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(0, 500);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    process.stdout.write(`${JSON.stringify({
      schema: "agentic-history-lifecycle-error/v1",
      ok: false,
      status: "error",
      mutationAuthorized: false,
      mutationAuthority: null,
      error: sanitizeHistoryLifecycleError(error),
    })}\n`);
    process.exitCode = 1;
  });
}
