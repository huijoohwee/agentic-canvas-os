#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestValue } from "./product-contract-primitives.mjs";
import { createCollaborationGateSandbox } from "./collaboration-gate-sandbox.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultAgenticCanvasOsRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveAgenticGraphRoot({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
} = {}) {
  const configuredRoot = String(env.AGENTIC_GRAPH_ROOT || "").trim();
  return configuredRoot
    ? path.resolve(configuredRoot)
    : path.resolve(agenticCanvasOsRoot, "..", "agentic-graph");
}

export function assertAgenticGraphCollaborationGate({
  agenticGraphRoot,
  fileExists = existsSync,
  readText = (filePath) => readFileSync(filePath, "utf8"),
}) {
  const packagePath = path.join(agenticGraphRoot, "package.json");
  const ownerPath = path.join(agenticGraphRoot, "scripts", "check-collaboration-readiness.mjs");
  if (!fileExists(packagePath) || !fileExists(ownerPath)) {
    throw new Error(`agentic-graph collaboration owner is unavailable at ${agenticGraphRoot}`);
  }

  const packageJson = JSON.parse(readText(packagePath));
  if (packageJson?.scripts?.["collaboration:readiness:check"] !== "node ./scripts/check-collaboration-readiness.mjs") {
    throw new Error("agentic-graph must expose the canonical collaboration:readiness:check command");
  }
  return agenticGraphRoot;
}

export function runCollaborationGate({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
  spawn = spawnSync,
  validateOwner = assertAgenticGraphCollaborationGate,
  createSandbox = createCollaborationGateSandbox,
  readProof = readCollaborationProof,
} = {}) {
  const agenticGraphRoot = validateOwner({
    agenticGraphRoot: resolveAgenticGraphRoot({ agenticCanvasOsRoot, env }),
  });
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const sandbox = createSandbox({ agenticCanvasOsRoot, agenticGraphRoot, env });
  let passed = false;

  try {
    process.stdout.write(`[collaboration-gate] runtime owner ${agenticGraphRoot}\n`);
    process.stdout.write(`[collaboration-gate] isolated run ${sandbox.runId} ports owner=${sandbox.ports.owner} guest=${sandbox.ports.guest} worker=${sandbox.ports.worker}\n`);
    const result = spawn(npmCommand, ["run", "collaboration:readiness:check"], {
      cwd: agenticGraphRoot,
      env: sandbox.environment,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw gateError(
        `agentic-graph collaboration readiness failed with exit code ${result.status ?? "unknown"}`,
        blockedResult({ agenticGraphRoot, sandbox, exitCode: result.status }),
      );
    }
    const proof = readProof(sandbox.proofPath);
    const output = passedResult({ agenticGraphRoot, sandbox, proof });
    passed = true;
    process.stdout.write("[collaboration-gate] ok\n");
    return output;
  } catch (error) {
    if (error?.gateResult) throw error;
    throw gateError(
      error instanceof Error ? error.message : String(error),
      blockedResult({ agenticGraphRoot, sandbox, exitCode: null }),
    );
  } finally {
    sandbox.release({ preserveArtifacts: !passed });
  }
}

export function readCollaborationProof(proofPath) {
  if (!existsSync(proofPath)) throw new Error("agentic-graph collaboration proof artifact is missing.");
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  return validateCollaborationProof(proof);
}

export function validateCollaborationProof(proof) {
  const identity = proof?.runtimeIdentity;
  if (proof?.ok !== true || identity?.status !== "pass") throw new Error("agentic-graph collaboration proof did not pass.");
  if (identity.observedDeviceCount < 2 || identity.requiredDeviceCount < 2) {
    throw new Error("agentic-graph collaboration proof requires at least two authenticated runtime peers.");
  }
  if (!/^[0-9a-f]{64}$/.test(String(identity.verificationDigest || ""))) {
    throw new Error("agentic-graph collaboration proof has no common verification digest.");
  }
  for (const field of ["agenticGraphRevision", "agenticCanvasOsRevision", "catalogRevision"]) {
    if (!/^[0-9a-f]{40}$/.test(String(identity[field] || ""))) {
      throw new Error(`agentic-graph collaboration proof has an invalid ${field}.`);
    }
  }
  if (identity.catalogRevision !== identity.agenticCanvasOsRevision) {
    throw new Error("agentic-graph collaboration proof catalog revision does not match Agentic Canvas OS.");
  }
  if (identity.catalogHydrationStatus !== "fresh" || identity.catalogHydrationAttempts > 2) {
    throw new Error("agentic-graph collaboration proof catalog hydration is not fresh and bounded.");
  }
  if (!Array.isArray(identity.devices) || new Set(identity.devices).size < 2) {
    throw new Error("agentic-graph collaboration proof runtime devices are not distinct.");
  }
  return proof;
}

export function withRecoverableGitMutationFence({
  plan,
  action,
  acquireLock = withPrivateOperationLock,
  readGit = gitText,
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(plan?.planDigest || ""))
    || typeof action !== "function" || typeof acquireLock !== "function"
    || typeof readGit !== "function") {
    throw new Error("Git mutation fence requires a sealed plan, lock owner, and synchronous action.");
  }
  const { source, target } = plan.evidence;
  const common = realGateDirectory(source.commonDirectory, "Git fence common directory");
  const sourceGit = realGateDirectory(path.resolve(source.worktree,
    readGit(source.worktree, ["rev-parse", "--git-dir"])), "source Git directory");
  const targetGit = realGateDirectory(path.resolve(target.worktree,
    readGit(target.worktree, ["rev-parse", "--git-dir"])), "target Git directory");
  if (readGit(source.worktree, ["rev-parse", "--show-ref-format"]) !== "files") {
    throw new Error("Git mutation fence requires the native files ref backend.");
  }
  if (readGit(source.worktree, ["check-ref-format", "--branch", target.branch]) !== target.branch) {
    throw new Error("Git mutation fence target branch is invalid.");
  }
  const worktreeLock = path.join(targetGit, "locked");
  const lockPaths = [worktreeLock, ...[
    path.join(sourceGit, "HEAD.lock"), path.join(sourceGit, "index.lock"),
    path.join(targetGit, "HEAD.lock"), path.join(targetGit, "index.lock"),
    path.join(common, "packed-refs.lock"),
    path.join(common, "refs", "heads", "main.lock"),
    path.join(common, "refs", "heads", `${target.branch}.lock`),
    path.join(common, "refs", "remotes", "origin", "main.lock"),
  ].map(file => path.resolve(file)).sort()];
  for (const directory of [sourceGit, targetGit]) requireGitFenceDescendant(common, directory);
  for (const file of lockPaths) requireGitFenceDescendant(common, file);
  const context = Object.freeze({
    schema: "agentic-canonical-untracked-relocation-git-fence/v1",
    commonDirectory: common,
    lockSetDigest: digestValue(lockPaths),
    planDigest: plan.planDigest,
    sourceWorktree: path.resolve(source.worktree),
    subjectDigest: digestValue({ commonDirectory: common,
      sourceWorktree: path.resolve(source.worktree), targetBranch: target.branch,
      targetWorktree: path.resolve(target.worktree) }),
    targetBranch: target.branch,
    targetWorktree: path.resolve(target.worktree),
  });
  const acquire = index => index === lockPaths.length ? runSynchronousFenceAction(action)
    : acquireLock({ file: lockPaths[index], context: { ...context, lockPath: lockPaths[index] },
      action: () => acquire(index + 1) });
  return acquire(0);
}

function passedResult({ agenticGraphRoot, sandbox, proof }) {
  const identity = proof.runtimeIdentity;
  return {
    schema: "agentic-collaboration-gate-result/v2",
    status: "passed",
    parityStatus: "passed",
    blockScope: null,
    runId: sandbox.runId,
    agenticGraphRoot,
    ports: sandbox.ports,
    proof: {
      observedDeviceCount: identity.observedDeviceCount,
      requiredDeviceCount: identity.requiredDeviceCount,
      verificationDigest: identity.verificationDigest,
      devices: identity.devices,
      agenticGraphRevision: identity.agenticGraphRevision,
      agenticCanvasOsRevision: identity.agenticCanvasOsRevision,
      catalogRevision: identity.catalogRevision,
      catalogHydrationStatus: identity.catalogHydrationStatus,
      catalogHydrationAttempts: identity.catalogHydrationAttempts,
    },
  };
}

function blockedResult({ agenticGraphRoot, sandbox, exitCode }) {
  return {
    schema: "agentic-collaboration-gate-result/v2",
    status: "blocked",
    parityStatus: "blocked",
    blockScope: "runtime-proof",
    runId: sandbox.runId,
    agenticGraphRoot,
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

function runSynchronousFenceAction(action) {
  const result = action();
  if (result && typeof result.then === "function") {
    throw new Error("Git mutation fence action must remain synchronous under the registry lock.");
  }
  return result;
}

function requireGitFenceDescendant(common, candidate) {
  if (candidate !== common && !candidate.startsWith(`${common}${path.sep}`)) {
    throw new Error("Git mutation fence escaped the common directory.");
  }
}

function realGateDirectory(value, label) {
  const target = path.resolve(String(value || ""));
  if (!path.isAbsolute(String(value || "")) || !lstatSync(target).isDirectory()) {
    throw new Error(`${label} must be an absolute directory.`);
  }
  return realpathSync(target);
}

function gitText(worktree, args) {
  return execFileSync("git", args, {
    cwd: worktree, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  }).trim();
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
