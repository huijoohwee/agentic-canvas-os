#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCollaborationGateSandbox } from "./collaboration-gate-sandbox.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultAgenticCanvasOsRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveKnowgrphRoot({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
} = {}) {
  const configuredRoot = String(env.AGENTICGRAPH_ROOT || "").trim();
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
  validateOwner = assertKnowgrphCollaborationGate,
  createSandbox = createCollaborationGateSandbox,
  readProof = readCollaborationProof,
} = {}) {
  const knowgrphRoot = validateOwner({
    knowgrphRoot: resolveKnowgrphRoot({ agenticCanvasOsRoot, env }),
  });
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const sandbox = createSandbox({ agenticCanvasOsRoot, knowgrphRoot, env });
  let passed = false;

  try {
    process.stdout.write(`[collaboration-gate] runtime owner ${knowgrphRoot}\n`);
    process.stdout.write(`[collaboration-gate] isolated run ${sandbox.runId} ports owner=${sandbox.ports.owner} guest=${sandbox.ports.guest} worker=${sandbox.ports.worker}\n`);
    const result = spawn(npmCommand, ["run", "collaboration:readiness:check"], {
      cwd: knowgrphRoot,
      env: sandbox.environment,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw gateError(
        `Knowgrph collaboration readiness failed with exit code ${result.status ?? "unknown"}`,
        blockedResult({ knowgrphRoot, sandbox, exitCode: result.status }),
      );
    }
    const proof = readProof(sandbox.proofPath);
    const output = passedResult({ knowgrphRoot, sandbox, proof });
    passed = true;
    process.stdout.write("[collaboration-gate] ok\n");
    return output;
  } catch (error) {
    if (error?.gateResult) throw error;
    throw gateError(
      error instanceof Error ? error.message : String(error),
      blockedResult({ knowgrphRoot, sandbox, exitCode: null }),
    );
  } finally {
    sandbox.release({ preserveArtifacts: !passed });
  }
}

export function readCollaborationProof(proofPath) {
  if (!existsSync(proofPath)) throw new Error("Knowgrph collaboration proof artifact is missing.");
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  return validateCollaborationProof(proof);
}

export function validateCollaborationProof(proof) {
  const identity = proof?.runtimeIdentity;
  if (proof?.ok !== true || identity?.status !== "pass") throw new Error("Knowgrph collaboration proof did not pass.");
  if (identity.observedDeviceCount < 2 || identity.requiredDeviceCount < 2) {
    throw new Error("Knowgrph collaboration proof requires at least two authenticated runtime peers.");
  }
  if (!/^[0-9a-f]{64}$/.test(String(identity.verificationDigest || ""))) {
    throw new Error("Knowgrph collaboration proof has no common verification digest.");
  }
  for (const field of ["knowgrphRevision", "agenticCanvasOsRevision", "catalogRevision"]) {
    if (!/^[0-9a-f]{40}$/.test(String(identity[field] || ""))) {
      throw new Error(`Knowgrph collaboration proof has an invalid ${field}.`);
    }
  }
  if (identity.catalogRevision !== identity.agenticCanvasOsRevision) {
    throw new Error("Knowgrph collaboration proof catalog revision does not match Agentic Canvas OS.");
  }
  if (identity.catalogHydrationStatus !== "fresh" || identity.catalogHydrationAttempts > 2) {
    throw new Error("Knowgrph collaboration proof catalog hydration is not fresh and bounded.");
  }
  if (!Array.isArray(identity.devices) || new Set(identity.devices).size < 2) {
    throw new Error("Knowgrph collaboration proof runtime devices are not distinct.");
  }
  return proof;
}

function passedResult({ knowgrphRoot, sandbox, proof }) {
  const identity = proof.runtimeIdentity;
  return {
    schema: "agentic-collaboration-gate-result/v2",
    status: "passed",
    parityStatus: "passed",
    blockScope: null,
    runId: sandbox.runId,
    knowgrphRoot,
    ports: sandbox.ports,
    proof: {
      observedDeviceCount: identity.observedDeviceCount,
      requiredDeviceCount: identity.requiredDeviceCount,
      verificationDigest: identity.verificationDigest,
      devices: identity.devices,
      knowgrphRevision: identity.knowgrphRevision,
      agenticCanvasOsRevision: identity.agenticCanvasOsRevision,
      catalogRevision: identity.catalogRevision,
      catalogHydrationStatus: identity.catalogHydrationStatus,
      catalogHydrationAttempts: identity.catalogHydrationAttempts,
    },
  };
}

function blockedResult({ knowgrphRoot, sandbox, exitCode }) {
  return {
    schema: "agentic-collaboration-gate-result/v2",
    status: "blocked",
    parityStatus: "blocked",
    blockScope: "runtime-proof",
    runId: sandbox.runId,
    knowgrphRoot,
    ports: sandbox.ports,
    artifactRoot: sandbox.runRoot,
    exitCode,
  };
}

function gateError(message, gateResult) {
  const error = new Error(message);
  error.gateResult = gateResult;
  return error;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const json = process.argv.includes("--json");
  try {
    const result = runCollaborationGate();
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (json && error?.gateResult) process.stdout.write(`${JSON.stringify(error.gateResult)}\n`);
    else process.stderr.write(`[collaboration-gate] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
