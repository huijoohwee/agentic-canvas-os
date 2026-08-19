#!/usr/bin/env node
// Responsibility: Run path portability auditing over the orchestration projection gate scope.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPathPortability, collectTrackedAuthoredFiles } from "./path-portability-auditor.mjs";

const REPOSITORY_NAME = "agentic-canvas-os";
const repositoryPath = (...segments) => [REPOSITORY_NAME, ...segments].join("/");

export const GATE_SCOPE_PREFIXES = Object.freeze([
  repositoryPath("scripts", "orchestration-projection"),
  repositoryPath("scripts", "audit", "path-portability-gate.mjs"),
  repositoryPath("__tests__", "orchestration-projection"),
]);

if (process.argv[1] && import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href) {
  const receipt = runPathPortabilityGate({ githubRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") });
  process.stdout.write(JSON.stringify(receipt) + "\n");
  if (receipt.status !== "passed") process.exitCode = 1;
}

export function runPathPortabilityGate({ githubRoot, extraFiles = [] } = {}) {
  const inventory = collectTrackedAuthoredFiles({ githubRoot, repositoryNames: ["agentic-canvas-os"] });
  const scopedFiles = scopedAuthoredFiles({ githubRoot, inventory });
  const files = [{ path: "agentic-canvas-os/orchestration-projection.md", text: "schema: agentic-orchestration-projection/v1\n" }];
  const audit = auditPathPortability({
    files: [...scopedFiles, ...files, ...extraFiles],
    repositoryPaths: inventory.repositoryPaths,
    accountNames: inventory.accountNames,
  });
  return {
    ...audit,
    gateScope: [...GATE_SCOPE_PREFIXES],
    omittedFileCount: Math.max(0, inventory.files.length - scopedFiles.length),
  };
}

function scopedAuthoredFiles({ githubRoot, inventory }) {
  const tracked = inventory.files.filter((file) => GATE_SCOPE_PREFIXES.some((prefix) => file.path?.startsWith(prefix)));
  const trackedPaths = new Set(tracked.map((file) => file.path));
  return [...tracked, ...existingUntrackedScopeFiles({ githubRoot, trackedPaths })];
}

function existingUntrackedScopeFiles({ githubRoot, trackedPaths }) {
  const repositoryRoot = path.join(githubRoot, "agentic-canvas-os");
  return GATE_SCOPE_PREFIXES.flatMap((prefix) => readScopePath({ repositoryRoot, relativeScope: prefix.replace(/^agentic-canvas-os\//u, ""), trackedPaths }));
}

function readScopePath({ repositoryRoot, relativeScope, trackedPaths }) {
  const absolutePath = path.join(repositoryRoot, relativeScope);
  if (!existsSync(absolutePath)) return readPrefixPath({ repositoryRoot, relativeScope, trackedPaths });
  const repositoryPath = "agentic-canvas-os/" + relativeScope;
  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    return readdirSync(absolutePath).flatMap((entry) => readScopePath({ repositoryRoot, relativeScope: path.join(relativeScope, entry), trackedPaths }));
  }
  if (!stats.isFile() || trackedPaths.has(repositoryPath)) return [];
  return [{ path: repositoryPath, text: readFileSync(absolutePath, "utf8") }];
}

function readPrefixPath({ repositoryRoot, relativeScope, trackedPaths }) {
  const directory = path.dirname(relativeScope);
  const basename = path.basename(relativeScope);
  const absoluteDirectory = path.join(repositoryRoot, directory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory)
    .filter((entry) => entry.startsWith(basename))
    .flatMap((entry) => readScopePath({ repositoryRoot, relativeScope: path.join(directory, entry), trackedPaths }));
}
