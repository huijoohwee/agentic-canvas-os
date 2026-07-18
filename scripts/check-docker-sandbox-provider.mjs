import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SANDBOX_AGENT_CAPABILITIES } from "../agent-api/src/sandbox-agent-contract.js";
import { createSandboxAgentRuntime } from "../agent-api/src/sandbox-agents.js";
import { createSandboxApplicationAuthorizer } from "../agent-api/src/sandbox-application-authorizer.js";
import { createDockerCommandRunner } from "../agent-api/src/docker-command-runner.js";
import { createDockerContainmentVerifier } from "../agent-api/src/docker-containment-verifier.js";
import { createDockerSandboxAdapter } from "../agent-api/src/docker-sandbox-adapter.js";
import { createSandboxFileStateStore } from "../agent-api/src/sandbox-file-state-store.js";

const image = process.env.AGENTIC_SANDBOX_IMAGE;
if (!image) throw new Error("AGENTIC_SANDBOX_IMAGE must name an immutable sha256 image.");

const root = await mkdtemp(path.join(os.tmpdir(), "agentic-docker-sandbox-proof-"));
const snapshotRoot = path.join(root, "snapshots");
const stateRoot = path.join(root, "state");
const runDocker = createDockerCommandRunner({ maxOutputBytes: 12_000_000 });
const versionResult = await runDocker(["version", "--format", "{{.Server.Version}}"]);
const serverVersion = versionResult.stdout.trim();
if (!serverVersion) throw new Error("Docker Engine server is unavailable.");
const providerRevision = `docker-cli-v1+engine-${serverVersion}`;
const verifierRevision = `docker-probe-v1+engine-${serverVersion}`;
const adapter = createDockerSandboxAdapter({ image, revision: providerRevision, snapshotRoot, runDocker });
const verifier = createDockerContainmentVerifier({ revision: verifierRevision, image, runDocker });
const authorize = createSandboxApplicationAuthorizer({
  revision: "local-container-proof-v1",
  agents: ["sandbox-proof-agent"],
  workspaceRevisions: ["sandbox-proof-workspace-v1"],
  readPaths: ["src", "output", "local-package", ".packages"],
  writePaths: ["src", "output", "local-package", ".packages"],
  commands: ["node"],
  packageManagers: { "npm-local": ["local-package"] },
  previewPorts: [4_173],
  environmentBindings: [],
  allowSnapshots: true,
  allowResume: true,
});

function createRuntime() {
  return createSandboxAgentRuntime({
    adapter,
    authorize,
    containmentVerifier: verifier,
    stateStore: createSandboxFileStateStore({ root: stateRoot }),
    operationTimeoutMs: 30_000,
  });
}

async function execute(runtime, sandboxId, runId, operation) {
  const result = await runtime.execute({ sandboxId, runId, operation });
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.evidence.independentContainmentProof.status, "verified");
  return result;
}

async function fetchPreview(endpoint) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.text();
      lastError = new Error(`Preview returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError;
}

const workspace = {
  revision: "sandbox-proof-workspace-v1",
  directories: ["src", "output", "local-package"],
  files: [
    { path: "src/input.txt", content: "container-ready" },
    {
      path: "src/server.mjs",
      content: "import{createServer}from'node:http';createServer((_,response)=>response.end('sandbox-preview')).listen(4173,'0.0.0.0');",
    },
    {
      path: "local-package/package.json",
      content: JSON.stringify({ name: "local-proof-package", version: "1.0.0", type: "module", main: "index.js" }),
    },
    { path: "local-package/index.js", content: "export const proof = 'installed';\n" },
  ],
  environmentBindings: [],
  previewPorts: [4_173],
};

let first;
let seeded;
let resumed;
let firstRuntime;
let seededRuntime;
let resumedRuntime;
let containmentCheckCount = 0;
const snapshots = new Set();
try {
  assert.deepEqual(await adapter.listOwnedResources(), { containers: [], networks: [] });
  firstRuntime = createRuntime();
  first = await firstRuntime.open({
    runId: "sandbox-proof-run",
    agentId: "sandbox-proof-agent",
    workspace,
    requiredCapabilities: [...SANDBOX_AGENT_CAPABILITIES],
  });
  assert.equal(first.status, "ready", JSON.stringify(first));
  assert.equal(first.evidence.independentContainmentProof.status, "verified");
  containmentCheckCount = first.evidence.independentContainmentProof.checkCount;
  const input = await execute(firstRuntime, first.sandboxId, first.runId, { kind: "file.read", path: "src/input.txt" });
  assert.equal(input.output.content, "container-ready");
  await execute(firstRuntime, first.sandboxId, first.runId, {
    kind: "file.write",
    path: "output/checkpoint.txt",
    content: "durable-workspace",
  });
  const command = await execute(firstRuntime, first.sandboxId, first.runId, {
    kind: "command.run",
    argv: ["node", "-e", "process.stdout.write('argv-executed')"],
  });
  assert.equal(command.output.stdout, "argv-executed");
  await execute(firstRuntime, first.sandboxId, first.runId, {
    kind: "package.install",
    manager: "npm-local",
    packages: ["local-package"],
  });
  await execute(firstRuntime, first.sandboxId, first.runId, {
    kind: "command.run",
    argv: ["node", "server.mjs"],
    cwd: "src",
    background: true,
  });
  const port = await execute(firstRuntime, first.sandboxId, first.runId, {
    kind: "port.open",
    containerPort: 4_173,
    protocol: "http",
    audience: "preview",
  });
  assert.equal(await fetchPreview(port.output.endpoint), "sandbox-preview");

  const saved = await firstRuntime.snapshot({ sandboxId: first.sandboxId, runId: first.runId });
  assert.equal(saved.status, "completed", JSON.stringify(saved));
  const stateStore = createSandboxFileStateStore({ root: stateRoot });
  const snapshotRecord = await stateStore.get(`snapshot:${saved.snapshotToken}`);
  snapshots.add(snapshotRecord.providerSnapshotId);
  seededRuntime = createRuntime();
  seeded = await seededRuntime.open({
    runId: "sandbox-seeded-run",
    agentId: "sandbox-proof-agent",
    snapshotToken: saved.snapshotToken,
    requiredCapabilities: [...SANDBOX_AGENT_CAPABILITIES],
  });
  assert.equal(seeded.status, "ready", JSON.stringify(seeded));
  const seededRead = await execute(seededRuntime, seeded.sandboxId, seeded.runId, {
    kind: "file.read",
    path: "output/checkpoint.txt",
  });
  assert.equal(seededRead.output.content, "durable-workspace");
  assert.equal((await seededRuntime.close({ sandboxId: seeded.sandboxId, runId: seeded.runId })).status, "closed");
  seeded = null;

  const paused = await firstRuntime.pause({ sandboxId: first.sandboxId, runId: first.runId });
  assert.equal(paused.status, "paused", JSON.stringify(paused));
  first = null;
  const resumeRecord = await stateStore.get(`resume:${paused.resumeToken}`);
  snapshots.add(resumeRecord.serializedState.snapshotId);
  resumedRuntime = createRuntime();
  resumed = await resumedRuntime.resume({
    runId: "sandbox-proof-run",
    agentId: "sandbox-proof-agent",
    resumeToken: paused.resumeToken,
  });
  assert.equal(resumed.status, "ready", JSON.stringify(resumed));
  const resumedRead = await execute(resumedRuntime, resumed.sandboxId, resumed.runId, {
    kind: "file.read",
    path: "output/checkpoint.txt",
  });
  assert.equal(resumedRead.output.content, "durable-workspace");
  await execute(resumedRuntime, resumed.sandboxId, resumed.runId, {
    kind: "command.run",
    argv: ["node", "server.mjs"],
    cwd: "src",
    background: true,
  });
  const resumedPort = await execute(resumedRuntime, resumed.sandboxId, resumed.runId, {
    kind: "port.open",
    containerPort: 4_173,
    protocol: "http",
    audience: "preview",
  });
  assert.equal(await fetchPreview(resumedPort.output.endpoint), "sandbox-preview");
  assert.equal((await resumedRuntime.close({ sandboxId: resumed.sandboxId, runId: resumed.runId })).status, "closed");
  resumed = null;
  assert.deepEqual(await adapter.listOwnedResources(), { containers: [], networks: [] });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    providerRevision,
    verifierRevision,
    image,
    independentContainmentProof: "verified",
    checkCount: containmentCheckCount,
    snapshotSeeded: true,
    resumedAcrossControllers: true,
    previewLoopbackVerified: true,
    resourcesAfterCleanup: await adapter.listOwnedResources(),
    cost: { status: "reported", amountUsd: 0 },
  })}\n`);
} finally {
  if (seeded) await seededRuntime.close({ sandboxId: seeded.sandboxId, runId: seeded.runId }).catch(() => undefined);
  if (resumed) await resumedRuntime.close({ sandboxId: resumed.sandboxId, runId: resumed.runId }).catch(() => undefined);
  if (first) await firstRuntime.close({ sandboxId: first.sandboxId, runId: first.runId }).catch(() => undefined);
  for (const snapshotId of snapshots) await adapter.deleteSnapshot(snapshotId).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
