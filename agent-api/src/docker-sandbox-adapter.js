import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { SANDBOX_AGENT_CAPABILITIES, SandboxAgentBlock, assertIdentifier } from "./sandbox-agent-contract.js";
import { createDockerCommandRunner } from "./docker-command-runner.js";

const SNAPSHOT_ID = /^snapshot-[a-f0-9]{24}$/;
const IMMUTABLE_IMAGE = /^(?:[a-z0-9][a-z0-9._/-]{0,200}@)?sha256:[a-f0-9]{64}$/;
const LABEL_VALUE = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/;
const MEMORY_LIMIT = /^[1-9][0-9]*(?:[bkmg])?$/;
const CPU_LIMIT = /^(?:[1-9][0-9]*(?:\.[0-9]+)?|0\.[0-9]*[1-9][0-9]*)$/;
const NUMERIC_NON_ROOT_USER = /^([1-9][0-9]{0,9}):([1-9][0-9]{0,9})$/;
const LOCAL_PACKAGE = /^[a-zA-Z0-9@][a-zA-Z0-9@._+-]{0,127}(?:\/[a-zA-Z0-9@._+-]+)*$/;
const LABEL_OWNER = "agentic-canvas-os.sandbox";

function providerCost() {
  return Object.freeze({ status: "reported", amountUsd: 0 });
}

function normalizeState(value, providerSessionId) {
  if (value?.schema !== "docker-sandbox-state/v1" || value.sessionId !== providerSessionId) {
    throw new SandboxAgentBlock("docker_state_invalid", "Docker sandbox state is invalid.");
  }
  return value;
}

function workspacePath(relative = "") {
  return relative ? `/workspace/${relative}` : "/workspace";
}

function safeLocalPackage(value) {
  if (!LOCAL_PACKAGE.test(value) || value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new SandboxAgentBlock("docker_package_invalid", "Docker local package path is invalid.");
  }
  return workspacePath(value);
}

function parsePortBinding(value, containerPort) {
  const line = value.trim().split("\n").find(Boolean);
  const match = line?.match(/^(?:127\.0\.0\.1|\[::1\]):([0-9]+)$/);
  if (!match) throw new SandboxAgentBlock("docker_port_unavailable", `Preview port ${containerPort} is not loopback-bound.`);
  return Number(match[1]);
}

export function createDockerSandboxAdapter({
  image,
  revision,
  snapshotRoot,
  runDocker = createDockerCommandRunner({ maxOutputBytes: 2_000_000 }),
  memory = "256m",
  cpus = "1",
  pidsLimit = 128,
  user = "65532:65532",
  maxSnapshotBytes = 10_000_000,
} = {}) {
  const safeImage = assertIdentifier(image, "image");
  if (!IMMUTABLE_IMAGE.test(safeImage)) throw new TypeError("image must use an immutable sha256 digest.");
  const safeRevision = assertIdentifier(revision, "revision");
  if (!LABEL_VALUE.test(safeRevision)) throw new TypeError("revision must be safe for a Docker label.");
  if (typeof snapshotRoot !== "string" || !path.isAbsolute(snapshotRoot)) {
    throw new TypeError("snapshotRoot must be an absolute path.");
  }
  if (typeof runDocker !== "function") throw new TypeError("runDocker must be a function.");
  if (typeof memory !== "string" || !MEMORY_LIMIT.test(memory)) {
    throw new TypeError("memory must be a positive Docker byte limit using an optional b, k, m, or g suffix.");
  }
  if (typeof cpus !== "string" || !CPU_LIMIT.test(cpus)) throw new TypeError("cpus must be a positive decimal string.");
  if (!Number.isInteger(pidsLimit) || pidsLimit < 16) throw new TypeError("pidsLimit must be an integer of at least 16.");
  const userIdentity = typeof user === "string" ? user.match(NUMERIC_NON_ROOT_USER) : null;
  if (!userIdentity) throw new TypeError("user must be a numeric non-root uid:gid pair.");
  const [, userId, groupId] = userIdentity;
  if (!Number.isInteger(maxSnapshotBytes) || maxSnapshotBytes < 1) {
    throw new TypeError("maxSnapshotBytes must be a positive integer.");
  }
  const descriptor = Object.freeze({
    id: "docker-cli",
    revision: safeRevision,
    capabilities: SANDBOX_AGENT_CAPABILITIES,
    executionBoundary: "container",
  });

  function attestation() {
    return Object.freeze({
      providerId: descriptor.id,
      providerRevision: descriptor.revision,
      executionBoundary: "container",
      fresh: true,
      capabilities: descriptor.capabilities,
    });
  }

  function snapshotPaths(snapshotId) {
    if (!SNAPSHOT_ID.test(snapshotId)) throw new SandboxAgentBlock("docker_snapshot_invalid", "Docker snapshot id is invalid.");
    return Object.freeze({
      archive: path.join(snapshotRoot, `${snapshotId}.tar`),
      metadata: path.join(snapshotRoot, `${snapshotId}.json`),
    });
  }

  async function prepareSnapshotRoot() {
    await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
    await chmod(snapshotRoot, 0o700);
  }

  async function writeSnapshot(containerId, previewPorts, signal) {
    await prepareSnapshotRoot();
    const snapshotId = `snapshot-${randomBytes(12).toString("hex")}`;
    const paths = snapshotPaths(snapshotId);
    const result = await runDocker(["exec", containerId, "tar", "-cf", "-", "-C", "/workspace", "."], {
      signal,
      output: "buffer",
    });
    if (result.stdout.length > maxSnapshotBytes) {
      throw new SandboxAgentBlock("docker_snapshot_capacity", "Docker workspace snapshot exceeds capacity.");
    }
    const archiveTemporary = `${paths.archive}.${randomUUID()}.tmp`;
    const metadataTemporary = `${paths.metadata}.${randomUUID()}.tmp`;
    await writeFile(archiveTemporary, result.stdout, { mode: 0o600, flag: "wx" });
    await writeFile(metadataTemporary, JSON.stringify({
      schema: "docker-sandbox-snapshot/v1",
      previewPorts,
    }), { mode: 0o600, flag: "wx" });
    await rename(archiveTemporary, paths.archive);
    await rename(metadataTemporary, paths.metadata);
    return Object.freeze({ snapshotId, bytes: result.stdout.length });
  }

  async function readSnapshot(snapshotId) {
    await prepareSnapshotRoot();
    const paths = snapshotPaths(snapshotId);
    const metadata = JSON.parse(await readFile(paths.metadata, "utf8"));
    if (metadata?.schema !== "docker-sandbox-snapshot/v1" || !Array.isArray(metadata.previewPorts)) {
      throw new SandboxAgentBlock("docker_snapshot_invalid", "Docker snapshot metadata is invalid.");
    }
    const archive = await readFile(paths.archive);
    if (archive.length > maxSnapshotBytes) {
      throw new SandboxAgentBlock("docker_snapshot_capacity", "Docker workspace snapshot exceeds capacity.");
    }
    return Object.freeze({ archive, previewPorts: Object.freeze(metadata.previewPorts) });
  }

  async function createNetwork(sessionId, signal) {
    const result = await runDocker([
      "network", "create", "--internal",
      "--label", `${LABEL_OWNER}=true`,
      "--label", `agentic-canvas-os.session=${sessionId}`,
      `acos-net-${sessionId}`,
    ], { signal });
    return result.stdout.trim();
  }

  async function createPreviewProxy({ sessionId, networkId, containerName, containerPort, signal }) {
    const proxyCode = [
      "const net=require('node:net');",
      "const host=process.argv[1],port=Number(process.argv[2]);",
      "net.createServer(client=>{",
      "const upstream=net.connect({host,port});",
      "client.pipe(upstream);upstream.pipe(client);",
      "const close=()=>{client.destroy();upstream.destroy()};",
      "client.on('error',close);upstream.on('error',close);",
      "}).listen(port,'0.0.0.0');",
    ].join("");
    const result = await runDocker([
      "create", "--name", `acos-proxy-${sessionId}-${containerPort}`,
      "--label", `${LABEL_OWNER}=true`,
      "--label", "agentic-canvas-os.sandbox-role=preview-proxy",
      "--label", `agentic-canvas-os.session=${sessionId}`,
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true",
      "--pids-limit", "32", "--memory", "64m", "--cpus", "0.25",
      "--user", user, "--init", "--stop-timeout", "3",
      "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,mode=0770,uid=${userId},gid=${groupId}`,
      "--network", "bridge", "--publish", `127.0.0.1::${containerPort}/tcp`,
      "--entrypoint", "/usr/local/bin/node", safeImage,
      "-e", proxyCode, containerName, String(containerPort),
    ], { signal });
    const proxyContainerId = result.stdout.trim();
    await runDocker(["network", "connect", networkId, proxyContainerId], { signal });
    await runDocker(["start", proxyContainerId], { signal });
    return Object.freeze({ containerPort, proxyContainerId });
  }

  async function removeResources(state, signal) {
    let failure;
    for (const binding of state.previewBindings || []) {
      try {
        await runDocker(["rm", "--force", binding.proxyContainerId], { signal });
      } catch (error) {
        failure ||= error;
      }
    }
    try {
      await runDocker(["rm", "--force", state.containerId], { signal });
    } catch (error) {
      failure = error;
    }
    if (state.networkId) {
      try {
        await runDocker(["network", "rm", state.networkId], { signal });
      } catch (error) {
        failure ||= error;
      }
    }
    if (failure) throw failure;
  }

  async function seedWorkspace(containerId, workspace, archive, signal) {
    const directories = workspace?.directories || [];
    const files = workspace?.files || [];
    const parents = files.map((file) => path.posix.dirname(file.path)).filter((item) => item !== ".");
    const paths = [...new Set([...directories, ...parents])].map(workspacePath);
    if (paths.length) await runDocker(["exec", containerId, "mkdir", "-p", ...paths], { signal });
    for (const file of files) {
      await runDocker(["exec", "-i", containerId, "tee", workspacePath(file.path)], {
        input: file.content,
        signal,
      });
    }
    if (archive) {
      await runDocker(["exec", "-i", containerId, "tar", "-xf", "-", "-C", "/workspace"], {
        input: archive,
        signal,
      });
    }
  }

  async function createContainer({ workspace, providerSnapshotId, signal }) {
    if (workspace?.environmentBindings?.length) {
      throw new SandboxAgentBlock("docker_environment_binding_unsupported", "Docker adapter does not persist environment bindings.");
    }
    const restored = providerSnapshotId ? await readSnapshot(providerSnapshotId) : null;
    const previewPorts = workspace?.previewPorts || restored?.previewPorts || [];
    const sessionId = randomBytes(8).toString("hex");
    const containerName = `acos-sandbox-${sessionId}`;
    let networkId;
    let containerId;
    const previewBindings = [];
    try {
      if (previewPorts.length) networkId = await createNetwork(sessionId, signal);
      const args = [
        "create", "--name", containerName,
        "--label", `${LABEL_OWNER}=true`,
        "--label", `agentic-canvas-os.session=${sessionId}`,
        "--label", `agentic-canvas-os.provider-revision=${safeRevision}`,
        "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges=true",
        "--pids-limit", String(pidsLimit), "--memory", memory, "--cpus", cpus,
        "--user", user, "--hostname", "sandbox", "--init", "--stop-timeout", "3",
        "--tmpfs", `/workspace:rw,nosuid,nodev,noexec,mode=0770,uid=${userId},gid=${groupId}`,
        "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,mode=0770,uid=${userId},gid=${groupId}`,
        "--network", networkId || "none",
      ];
      args.push("--entrypoint", "/bin/sleep", safeImage, "2147483647");
      containerId = (await runDocker(args, { signal })).stdout.trim();
      await runDocker(["start", containerId], { signal });
      for (const containerPort of previewPorts) {
        previewBindings.push(await createPreviewProxy({
          sessionId,
          networkId,
          containerName,
          containerPort,
          signal,
        }));
      }
      await seedWorkspace(containerId, workspace, restored?.archive, signal);
      return Object.freeze({
        providerSessionId: sessionId,
        state: Object.freeze({
          schema: "docker-sandbox-state/v1",
          sessionId,
          containerId,
          networkId: networkId || null,
          previewPorts: Object.freeze([...previewPorts]),
          previewBindings: Object.freeze(previewBindings),
        }),
      });
    } catch (error) {
      for (const binding of previewBindings) {
        await runDocker(["rm", "--force", binding.proxyContainerId], { signal }).catch(() => undefined);
      }
      if (containerId) await runDocker(["rm", "--force", containerId], { signal }).catch(() => undefined);
      if (networkId) await runDocker(["network", "rm", networkId], { signal }).catch(() => undefined);
      throw error;
    }
  }

  async function create(request) {
    const session = await createContainer(request);
    return Object.freeze({ ...session, attestation: attestation(), cost: providerCost() });
  }

  async function execute(request) {
    const state = normalizeState(request.state, request.providerSessionId);
    const operation = request.operation;
    let output;
    if (operation.kind === "file.read") {
      const result = await runDocker(["exec", state.containerId, "cat", workspacePath(operation.path)], request);
      output = { kind: operation.kind, path: operation.path, content: result.stdout };
    } else if (operation.kind === "file.write") {
      const parent = path.posix.dirname(operation.path);
      if (parent !== ".") await runDocker(["exec", state.containerId, "mkdir", "-p", workspacePath(parent)], request);
      await runDocker(["exec", "-i", state.containerId, "tee", workspacePath(operation.path)], {
        input: operation.content,
        signal: request.signal,
      });
      output = { kind: operation.kind, path: operation.path, charsWritten: operation.content.length };
    } else if (operation.kind === "command.run") {
      const args = ["exec"];
      if (operation.background) args.push("--detach");
      args.push("--workdir", workspacePath(operation.cwd), state.containerId, ...operation.argv);
      const result = await runDocker(args, request);
      output = operation.background
        ? { kind: operation.kind, started: true }
        : { kind: operation.kind, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } else if (operation.kind === "package.install") {
      if (operation.manager !== "npm-local") {
        throw new SandboxAgentBlock("docker_package_manager_denied", "Docker adapter supports only offline local npm packages.");
      }
      const packages = operation.packages.map(safeLocalPackage);
      const result = await runDocker([
        "exec", "--workdir", "/workspace", state.containerId,
        "npm", "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
        "--prefix", "/workspace/.packages", ...packages,
      ], request);
      output = { kind: operation.kind, manager: operation.manager, installed: operation.packages, stdout: result.stdout };
    } else {
      if (!state.previewPorts.includes(operation.containerPort)) {
        throw new SandboxAgentBlock("docker_port_not_declared", "Preview port was not declared when the workspace opened.");
      }
      const previewBinding = state.previewBindings.find((item) => item.containerPort === operation.containerPort);
      if (!previewBinding) throw new SandboxAgentBlock("docker_port_unavailable", "Preview proxy is unavailable.");
      const binding = await runDocker(
        ["port", previewBinding.proxyContainerId, `${operation.containerPort}/tcp`],
        request,
      );
      const hostPort = parsePortBinding(binding.stdout, operation.containerPort);
      output = {
        kind: operation.kind,
        protocol: operation.protocol,
        audience: operation.audience,
        endpoint: `${operation.protocol}://127.0.0.1:${hostPort}`,
      };
    }
    return Object.freeze({ output, state, attestation: attestation(), cost: providerCost() });
  }

  async function snapshot(request) {
    const state = normalizeState(request.state, request.providerSessionId);
    const saved = await writeSnapshot(state.containerId, state.previewPorts, request.signal);
    const files = await runDocker(["exec", state.containerId, "find", "/workspace", "-type", "f"], request);
    return Object.freeze({
      providerSnapshotId: saved.snapshotId,
      metadata: { fileCount: files.stdout.split("\n").filter(Boolean).length, bytes: saved.bytes },
      attestation: attestation(),
      cost: providerCost(),
    });
  }

  async function suspend(request) {
    const state = normalizeState(request.state, request.providerSessionId);
    const saved = await writeSnapshot(state.containerId, state.previewPorts, request.signal);
    return Object.freeze({
      serializedState: { schema: "docker-sandbox-resume/v1", snapshotId: saved.snapshotId },
      attestation: attestation(),
      cost: providerCost(),
    });
  }

  async function resume(request) {
    if (request.serializedState?.schema !== "docker-sandbox-resume/v1") {
      throw new SandboxAgentBlock("docker_resume_invalid", "Docker resume state is invalid.");
    }
    const session = await createContainer({
      providerSnapshotId: request.serializedState.snapshotId,
      signal: request.signal,
    });
    return Object.freeze({ ...session, attestation: attestation(), cost: providerCost() });
  }

  async function close(request) {
    const state = normalizeState(request.state, request.providerSessionId);
    await removeResources(state, request.signal);
    return Object.freeze({ closed: true, attestation: attestation(), cost: providerCost() });
  }

  async function deleteSnapshot(providerSnapshotId) {
    const paths = snapshotPaths(providerSnapshotId);
    await Promise.all([rm(paths.archive, { force: true }), rm(paths.metadata, { force: true })]);
  }

  async function listOwnedResources() {
    const [containers, networks] = await Promise.all([
      runDocker(["ps", "--all", "--filter", `label=${LABEL_OWNER}=true`, "--format", "{{.ID}}"]),
      runDocker(["network", "ls", "--filter", `label=${LABEL_OWNER}=true`, "--format", "{{.ID}}"]),
    ]);
    return Object.freeze({
      containers: Object.freeze(containers.stdout.split("\n").filter(Boolean)),
      networks: Object.freeze(networks.stdout.split("\n").filter(Boolean)),
    });
  }

  return Object.freeze({
    descriptor,
    create,
    execute,
    snapshot,
    suspend,
    resume,
    close,
    deleteSnapshot,
    listOwnedResources,
  });
}
