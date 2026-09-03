import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const COLLABORATION_GATE_ALLOCATION_SCHEMA = "agentic-collaboration-gate-allocations/v1";
const DEFAULT_PORT_BASE = 15_000;
const PORTS_PER_RUN = 3;
const MAX_PORT_SLOTS = 200;
const LOCK_TIMEOUT_MS = 5_000;
const ALLOCATION_TTL_MS = 20 * 60_000;

export function createCollaborationGateSandbox({
  agenticCanvasOsRoot,
  agenticGraphRoot,
  env = process.env,
  runId = randomUUID().replaceAll("-", ""),
  pid = process.pid,
  now = () => new Date(),
  isProcessAlive = defaultIsProcessAlive,
  portsAvailable = defaultPortsAvailable,
} = {}) {
  if (!agenticCanvasOsRoot) throw new Error("Collaboration gate sandbox requires the Agentic Canvas OS root.");
  const workspaceRoot = path.resolve(agenticGraphRoot || agenticCanvasOsRoot, "..");
  const runtimeRoot = path.resolve(
    String(env.AGENTIC_COLLABORATION_STATE_ROOT || "").trim()
      || path.join(workspaceRoot, ".runtime-state", "agentic-canvas-os", "collaboration-gates"),
  );
  mkdirSync(runtimeRoot, { recursive: true });
  const lockPath = path.join(runtimeRoot, ".allocation-lock");
  const registryPath = path.join(runtimeRoot, "allocations.json");
  const releaseLock = acquireDirectoryLock(lockPath, { pid, now, isProcessAlive });
  let allocation;
  try {
    const registry = readRegistry(registryPath);
    const active = registry.allocations.filter((entry) => (
      Date.parse(entry.expiresAt) > now().getTime() && isProcessAlive(entry.pid)
    ));
    const ports = selectPortBlock({
      runId,
      activeAllocations: active,
      portBase: readPortBase(env),
      portsAvailable,
    });
    const runRoot = path.join(runtimeRoot, runId);
    allocation = {
      runId,
      pid,
      runRoot,
      ports,
      createdAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + ALLOCATION_TTL_MS).toISOString(),
    };
    mkdirSync(runRoot, { recursive: true });
    writeRegistry(registryPath, [...active, allocation]);
  } finally {
    releaseLock();
  }

  const persistencePath = path.join(allocation.runRoot, "wrangler");
  const proofPath = path.join(allocation.runRoot, "proof.json");
  const screenshotPrefix = path.join(allocation.runRoot, "collaboration-e2e");
  const identitySuffix = allocation.runId.slice(0, 20);
  const environment = {
    ...env,
    AGENTIC_COLLABORATION_GATE_RUN_ID: allocation.runId,
    AG_COLLABORATION_E2E_OWNER_URL: `http://127.0.0.1:${allocation.ports.owner}/`,
    AG_COLLABORATION_E2E_GUEST_URL: `http://127.0.0.1:${allocation.ports.guest}/`,
    AG_COLLABORATION_E2E_WORKER_URL: `http://127.0.0.1:${allocation.ports.worker}`,
    AG_COLLABORATION_E2E_PERSISTENCE_PATH: persistencePath,
    AG_COLLABORATION_E2E_RESULT_PATH: proofPath,
    AG_COLLABORATION_E2E_SCREENSHOT_PREFIX: screenshotPrefix,
    AG_COLLABORATION_E2E_WORKSPACE_ID: `kgws:collaboration-gate:${identitySuffix}`,
    AG_COLLABORATION_E2E_OWNER_TOKEN: `kg_owner_${randomUUID().replaceAll("-", "")}`,
    AG_COLLABORATION_E2E_GUEST_TOKEN: `kg_guest_${randomUUID().replaceAll("-", "")}`,
    AG_COLLABORATION_E2E_OWNER_DEVICE: `collaboration-owner-${identitySuffix}`,
    AG_COLLABORATION_E2E_GUEST_DEVICE: `collaboration-guest-${identitySuffix}`,
    AG_COLLABORATION_E2E_OWNER_DEVICE_ID: `dev:collaboration-owner:${identitySuffix}`,
    AG_COLLABORATION_E2E_GUEST_DEVICE_ID: `dev:collaboration-guest:${identitySuffix}`,
  };

  return {
    runId: allocation.runId,
    runRoot: allocation.runRoot,
    proofPath,
    ports: allocation.ports,
    environment,
    release: ({ preserveArtifacts = false } = {}) => {
      releaseAllocation({ registryPath, lockPath, runId: allocation.runId, pid, now, isProcessAlive });
      rmSync(persistencePath, { recursive: true, force: true });
      if (!preserveArtifacts) rmSync(allocation.runRoot, { recursive: true, force: true });
    },
  };
}

export function selectPortBlock({
  runId,
  activeAllocations = [],
  portBase = DEFAULT_PORT_BASE,
  portsAvailable = defaultPortsAvailable,
}) {
  const reserved = new Set(activeAllocations.flatMap((entry) => Object.values(entry.ports || {})));
  const firstSlot = Number.parseInt(createHash("sha256").update(runId).digest("hex").slice(0, 8), 16) % MAX_PORT_SLOTS;
  for (let offset = 0; offset < MAX_PORT_SLOTS; offset += 1) {
    const slot = (firstSlot + offset) % MAX_PORT_SLOTS;
    const firstPort = portBase + slot * PORTS_PER_RUN;
    const ports = { owner: firstPort, guest: firstPort + 1, worker: firstPort + 2 };
    const values = Object.values(ports);
    if (values.some((port) => reserved.has(port))) continue;
    if (portsAvailable(values)) return ports;
  }
  throw new Error("No isolated collaboration gate port block is available.");
}

function readPortBase(env) {
  const value = Number(env.AGENTIC_COLLABORATION_PORT_BASE || DEFAULT_PORT_BASE);
  if (!Number.isInteger(value) || value < 1024 || value + MAX_PORT_SLOTS * PORTS_PER_RUN > 65_535) {
    throw new Error("AGENTIC_COLLABORATION_PORT_BASE cannot provide the bounded local port range.");
  }
  return value;
}

function defaultPortsAvailable(ports) {
  const check = `const net=require('node:net');const ports=process.argv[1].split(',').map(Number);const servers=[];let done=false;const fail=()=>{if(done)return;done=true;for(const server of servers)server.close();process.exit(1)};for(const port of ports){const server=net.createServer();servers.push(server);server.once('error',fail);server.listen({host:'127.0.0.1',port,exclusive:true},()=>{if(done)return;if(servers.every(item=>item.listening)){done=true;let pending=servers.length;for(const item of servers)item.close(()=>{pending-=1;if(pending===0)process.exit(0)})}})}`;
  return spawnSync(process.execPath, ["-e", check, ports.join(",")], { stdio: "ignore", timeout: 5_000 }).status === 0;
}

function acquireDirectoryLock(lockPath, { pid, now, isProcessAlive }) {
  const startedAt = now().getTime();
  while (now().getTime() - startedAt < LOCK_TIMEOUT_MS) {
    try {
      mkdirSync(lockPath);
      writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid, createdAt: now().toISOString() }));
      return () => rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readJson(path.join(lockPath, "owner.json"));
      if (owner && !isProcessAlive(owner.pid)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  throw new Error("Timed out acquiring the collaboration gate allocation lock.");
}

function releaseAllocation({ registryPath, lockPath, runId, pid, now, isProcessAlive }) {
  const releaseLock = acquireDirectoryLock(lockPath, { pid, now, isProcessAlive });
  try {
    const registry = readRegistry(registryPath);
    writeRegistry(registryPath, registry.allocations.filter((entry) => entry.runId !== runId));
  } finally {
    releaseLock();
  }
}

function readRegistry(registryPath) {
  if (!existsSync(registryPath)) return { schema: COLLABORATION_GATE_ALLOCATION_SCHEMA, allocations: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw new Error(`Collaboration gate allocation registry is unreadable: ${error.message}`);
  }
  if (parsed.schema !== COLLABORATION_GATE_ALLOCATION_SCHEMA || !Array.isArray(parsed.allocations)) {
    throw new Error("Collaboration gate allocation registry has an unsupported shape.");
  }
  return parsed;
}

function writeRegistry(registryPath, allocations) {
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ schema: COLLABORATION_GATE_ALLOCATION_SCHEMA, allocations }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, registryPath);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
