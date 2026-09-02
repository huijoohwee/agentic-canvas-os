#!/usr/bin/env node
// Module budget audit for the native skill creation harness.
//
// Counts agent-api/src/ modules and total lines across worker/, src/, and
// agent-api/src/, reports them against the recorded pre-feature baseline and
// the recorded projection, and fails when the observed counts exceed the
// projection so the projection cannot drift silently.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pre-feature baseline, verified 2026-08-17 on main at 436cd8250.
const BASELINE = Object.freeze({ agentApiModules: 59, totalLines: 19_834 });
// Recorded projection for this feature: +4 modules and roughly
// +1,250 lines of module, store, registry, runtime wiring, and audit surface.
// The fourth module is the env-aware Tool Search runtime owner added so the
// configured upstream runtime can truthfully report toolSearch.configured.
const PROJECTION = Object.freeze({ agentApiModules: 63, totalLines: 21_100 });

async function countLines(files) {
  let lines = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    lines += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  return lines;
}

async function collectJavaScriptFiles(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectJavaScriptFiles(entryPath, files);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(entryPath);
  }
  return files;
}

async function run() {
  const failures = [];
  const agentApiFiles = (await readdir(path.join(REPOSITORY_ROOT, "agent-api/src"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(REPOSITORY_ROOT, "agent-api/src", entry.name));
  const allFiles = [
    ...(await collectJavaScriptFiles(path.join(REPOSITORY_ROOT, "worker"))),
    ...(await collectJavaScriptFiles(path.join(REPOSITORY_ROOT, "src"))),
    ...agentApiFiles,
  ];

  const observed = {
    agentApiModules: agentApiFiles.length,
    totalLines: await countLines(allFiles),
  };

  if (observed.agentApiModules > PROJECTION.agentApiModules) {
    failures.push(
      `agent-api/src/ holds ${observed.agentApiModules} modules, above the recorded projection ceiling of ${PROJECTION.agentApiModules}`,
    );
  }
  if (observed.totalLines > PROJECTION.totalLines) {
    failures.push(
      `worker/ + src/ + agent-api/src/ hold ${observed.totalLines} lines, above the recorded projection ceiling of ${PROJECTION.totalLines}`,
    );
  }

  const delta = {
    agentApiModules: observed.agentApiModules - BASELINE.agentApiModules,
    totalLines: observed.totalLines - BASELINE.totalLines,
  };
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `module budget ok: ${observed.agentApiModules} agent-api modules (+${delta.agentApiModules}) and `
    + `${observed.totalLines} lines (+${delta.totalLines}) against baseline ${BASELINE.agentApiModules}/${BASELINE.totalLines.toLocaleString("en-US")}; `
    + `projection ceilings ${PROJECTION.agentApiModules}/${PROJECTION.totalLines.toLocaleString("en-US")} hold`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
