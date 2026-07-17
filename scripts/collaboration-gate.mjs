#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultAgenticCanvasOsRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveKnowgrphRoot({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
} = {}) {
  const configuredRoot = String(env.KNOWGRPH_ROOT || "").trim();
  return configuredRoot
    ? path.resolve(configuredRoot)
    : path.resolve(agenticCanvasOsRoot, "..", "knowgrph");
}

export function assertKnowgrphCollaborationGate({
  knowgrphRoot,
  fileExists = existsSync,
  readText = (filePath) => readFileSync(filePath, "utf8"),
}) {
  const packagePath = path.join(knowgrphRoot, "package.json");
  const ownerPath = path.join(knowgrphRoot, "scripts", "check-collaboration-readiness.mjs");
  if (!fileExists(packagePath) || !fileExists(ownerPath)) {
    throw new Error(`Knowgrph collaboration owner is unavailable at ${knowgrphRoot}`);
  }

  const packageJson = JSON.parse(readText(packagePath));
  if (packageJson?.scripts?.["collaboration:readiness:check"] !== "node ./scripts/check-collaboration-readiness.mjs") {
    throw new Error("Knowgrph must expose the canonical collaboration:readiness:check command");
  }
  return knowgrphRoot;
}

export function runCollaborationGate({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const knowgrphRoot = assertKnowgrphCollaborationGate({
    knowgrphRoot: resolveKnowgrphRoot({ agenticCanvasOsRoot, env }),
  });
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  process.stdout.write(`[collaboration-gate] runtime owner ${knowgrphRoot}\n`);
  process.stdout.write("[collaboration-gate] starting automated owner, guest, and worker proof\n");
  const result = spawn(npmCommand, ["run", "collaboration:readiness:check"], {
    cwd: knowgrphRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Knowgrph collaboration readiness failed with exit code ${result.status ?? "unknown"}`);
  }
  process.stdout.write("[collaboration-gate] ok\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    runCollaborationGate();
  } catch (error) {
    process.stderr.write(`[collaboration-gate] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
