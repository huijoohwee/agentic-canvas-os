import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDockerContainmentVerifier } from "../agent-api/src/docker-containment-verifier.js";
import { createDockerSandboxAdapter } from "../agent-api/src/docker-sandbox-adapter.js";
import { createSandboxApplicationAuthorizer } from "../agent-api/src/sandbox-application-authorizer.js";
import { createSandboxFileStateStore } from "../agent-api/src/sandbox-file-state-store.js";

const IMAGE = `node@sha256:${"a".repeat(64)}`;
const REVISION = "docker-cli-v1+test";

function fakeDocker() {
  const calls = [];
  let sandboxCount = 0;
  let proxyCount = 0;
  const run = async (args, options = {}) => {
    calls.push({ args, options });
    let stdout = "";
    let exitCode = 0;
    if (args[0] === "network" && args[1] === "create") stdout = "network-id\n";
    else if (args[0] === "create") {
      if (args.includes("agentic-canvas-os.sandbox-role=preview-proxy")) stdout = `proxy-id-${++proxyCount}\n`;
      else stdout = `container-id-${++sandboxCount}\n`;
    }
    else if (args[0] === "port") stdout = "127.0.0.1:49152\n";
    else if (args.includes("cat")) stdout = "hello";
    else if (args.includes("find")) stdout = "/workspace/input.txt\n/workspace/package.json\n";
    else if (args.includes("tar") && args.includes("-cf")) stdout = Buffer.from("archive");
    else if (args[0] === "inspect") {
      const proxy = args[1].startsWith("proxy-id");
      stdout = JSON.stringify([{
      State: { Running: true },
      Config: {
        Image: IMAGE,
        User: "65532:65532",
        Labels: {
          "agentic-canvas-os.sandbox": "true",
          "agentic-canvas-os.provider-revision": REVISION,
          ...(proxy ? { "agentic-canvas-os.sandbox-role": "preview-proxy" } : {}),
        },
      },
      HostConfig: {
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges=true"],
        Privileged: false,
        PidMode: "",
        IpcMode: "private",
        CgroupnsMode: "private",
        Memory: 268_435_456,
        NanoCpus: 1_000_000_000,
        PidsLimit: 128,
        Tmpfs: {
          "/workspace": "rw,nosuid,nodev,noexec",
          "/tmp": "rw,nosuid,nodev,noexec",
        },
        NetworkMode: proxy ? "bridge" : "network-id",
        PortBindings: proxy ? { "4173/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] } : {},
      },
      Mounts: [],
      }]);
    }
    else if (args[0] === "info") stdout = JSON.stringify(["name=seccomp,profile=builtin"]);
    else if (args[0] === "network" && args[1] === "inspect") stdout = JSON.stringify([{ Internal: true }]);
    else if (args.includes("id")) stdout = "65532\n";
    else if (args.includes("/containment-root-write")) exitCode = 1;
    else if (args.includes("node") && args.includes("-e")) exitCode = 0;
    return Object.freeze({
      exitCode,
      stdout: options.output === "buffer" && !Buffer.isBuffer(stdout) ? Buffer.from(stdout) : stdout,
      stderr: options.output === "buffer" ? Buffer.alloc(0) : "",
    });
  };
  return { run, calls };
}

function policy() {
  return {
    revision: "policy-v1",
    agents: ["agent-1"],
    workspaceRevisions: ["workspace-v1"],
    readPaths: ["src", "output", "local-package", ".packages"],
    writePaths: ["src", "output", "local-package", ".packages"],
    commands: ["node"],
    packageManagers: { "npm-local": ["local-package"] },
    previewPorts: [4_173],
    environmentBindings: [],
    allowSnapshots: true,
    allowResume: true,
  };
}

test("filesystem state survives controller instances and claims resume state atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-state-test-"));
  try {
    const first = createSandboxFileStateStore({ root });
    await first.put("resume:token", { cursor: 1 });
    const second = createSandboxFileStateStore({ root });
    assert.deepEqual(await second.get("resume:token"), { cursor: 1 });
    assert.deepEqual(await second.claim("resume:token", "claim-1"), { cursor: 1 });
    assert.equal(await first.claim("resume:token", "claim-2"), null);
    await second.release("resume:token", "claim-1");
    assert.deepEqual(await first.claim("resume:token", "claim-2"), { cursor: 1 });
    await first.commit("resume:token", "claim-2");
    assert.equal(await second.get("resume:token"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("application authorizer grants exact policy and denies command, path, package, port, and binding drift", async () => {
  const authorize = createSandboxApplicationAuthorizer(policy());
  const base = { runId: "run-1", agentId: "agent-1", workspaceRevision: "workspace-v1" };
  const opened = await authorize({
    ...base,
    action: "workspace.open",
    workspace: {
      directories: ["src"],
      filePaths: ["src/input.txt"],
      previewPorts: [4_173],
      environmentBindings: [],
    },
  });
  assert.equal(opened.allowed, true);
  assert.match(opened.approvalId, /^sandbox-approval-/);
  assert.equal((await authorize({ ...base, action: "command.run", operation: { argv: ["sh"], cwd: "src" } })).allowed, false);
  assert.equal((await authorize({ ...base, action: "file.write", operation: { path: "outside.txt" } })).allowed, false);
  assert.equal((await authorize({ ...base, action: "package.install", operation: { manager: "npm", packages: ["x"] } })).allowed, false);
  assert.equal((await authorize({ ...base, action: "port.open", operation: { containerPort: 8_080 } })).allowed, false);
  assert.equal((await authorize({ ...base, action: "workspace.destroy" })).allowed, false);
});

test("Docker adapter emits hardened argv, offline work, snapshots, resume, and cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docker-adapter-test-"));
  const docker = fakeDocker();
  try {
    const adapter = createDockerSandboxAdapter({ image: IMAGE, revision: REVISION, snapshotRoot: root, runDocker: docker.run });
    const created = await adapter.create({
      workspace: {
        directories: ["src", "local-package"],
        files: [{ path: "src/input.txt", content: "hello" }],
        environmentBindings: [],
        previewPorts: [4_173],
      },
    });
    const createArgs = docker.calls.find((call) => call.args[0] === "create").args;
    for (const expected of ["--read-only", "--cap-drop", "--security-opt", "--pids-limit", "--memory", "--cpus", "--user"]) {
      assert.equal(createArgs.includes(expected), true);
    }
    assert.equal(docker.calls.some((call) => call.args.some((item) => item.startsWith("127.0.0.1::4173"))), true);
    const request = { providerSessionId: created.providerSessionId, state: created.state };
    assert.equal((await adapter.execute({ ...request, operation: { kind: "file.read", path: "src/input.txt" } })).output.content, "hello");
    assert.equal((await adapter.execute({ ...request, operation: { kind: "command.run", argv: ["node"], background: true } })).output.started, true);
    assert.deepEqual((await adapter.execute({
      ...request,
      operation: { kind: "package.install", manager: "npm-local", packages: ["local-package"] },
    })).output.installed, ["local-package"]);
    assert.equal((await adapter.execute({
      ...request,
      operation: { kind: "port.open", containerPort: 4_173, protocol: "http", audience: "preview" },
    })).output.endpoint, "http://127.0.0.1:49152");
    const snapshot = await adapter.snapshot(request);
    assert.match(snapshot.providerSnapshotId, /^snapshot-/);
    const suspended = await adapter.suspend(request);
    const resumed = await adapter.resume({ serializedState: suspended.serializedState });
    await adapter.close(request);
    await adapter.close({ providerSessionId: resumed.providerSessionId, state: resumed.state });
    assert.equal(docker.calls.some((call) => call.args[0] === "rm" && call.args[1] === "--force"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("independent verifier requires inspect hardening and behavioral denial", async () => {
  const docker = fakeDocker();
  const verifier = createDockerContainmentVerifier({ revision: "probe-v1", image: IMAGE, runDocker: docker.run });
  const proof = await verifier.verify({
    provider: { id: "docker-cli", revision: REVISION },
    state: {
      schema: "docker-sandbox-state/v1",
      containerId: "container-id-1",
      networkId: "network-id",
      previewPorts: [4_173],
      previewBindings: [{ containerPort: 4_173, proxyContainerId: "proxy-id-1" }],
    },
  });
  assert.equal(proof.status, "verified");
  assert.equal(proof.checks.length >= 18, true);
  assert.equal(proof.checks.every((check) => check.status === "pass"), true);
});

test("Docker adapter rejects mutable images and unsafe runtime identities before invoking Docker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docker-config-test-"));
  try {
    assert.throws(() => createDockerSandboxAdapter({ image: "node:22-alpine", revision: REVISION, snapshotRoot: root }));
    assert.throws(() => createDockerSandboxAdapter({ image: IMAGE, revision: "unsafe revision", snapshotRoot: root }));
    assert.throws(() => createDockerSandboxAdapter({ image: IMAGE, revision: REVISION, snapshotRoot: root, user: "0:0" }));
    assert.throws(() => createDockerSandboxAdapter({ image: IMAGE, revision: REVISION, snapshotRoot: root, cpus: "0" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
