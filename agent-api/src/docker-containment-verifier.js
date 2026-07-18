import { SandboxAgentBlock, assertIdentifier } from "./sandbox-agent-contract.js";
import { createDockerCommandRunner } from "./docker-command-runner.js";

const OWNER_LABEL = "agentic-canvas-os.sandbox";

function pass(id, condition) {
  if (!condition) throw new SandboxAgentBlock("containment_proof_failed", `Containment check failed: ${id}.`);
  return Object.freeze({ id, status: "pass" });
}

function parseInspect(value, field) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0]) {
    throw new SandboxAgentBlock("containment_proof_failed", `${field} inspection was unavailable.`);
  }
  return parsed[0];
}

function hardenedTmpfs(value, mountPath) {
  const options = String(value?.[mountPath] || "").split(",");
  return ["nosuid", "nodev", "noexec"].every((expected) => options.includes(expected));
}

function nonRootUser(value) {
  return Boolean(value) && !/^0(?::0)?$/.test(value);
}

export function createDockerContainmentVerifier({
  revision,
  image,
  runDocker = createDockerCommandRunner({ maxOutputBytes: 1_000_000 }),
  maxPids = 128,
} = {}) {
  const safeRevision = assertIdentifier(revision, "revision");
  const safeImage = assertIdentifier(image, "image");
  if (typeof runDocker !== "function") throw new TypeError("runDocker must be a function.");
  if (!Number.isInteger(maxPids) || maxPids < 1) throw new TypeError("maxPids must be a positive integer.");
  const descriptor = Object.freeze({ id: "docker-independent-probe", revision: safeRevision });

  async function verify({ state, provider, signal }) {
    if (provider.id !== "docker-cli" || state?.schema !== "docker-sandbox-state/v1") {
      throw new SandboxAgentBlock("containment_proof_failed", "Docker verifier received incompatible provider state.");
    }
    const inspected = parseInspect(
      (await runDocker(["inspect", state.containerId], { signal })).stdout,
      "container",
    );
    const host = inspected.HostConfig || {};
    const config = inspected.Config || {};
    const checks = [
      pass("container-running", inspected.State?.Running === true),
      pass("immutable-image", config.Image === safeImage),
      pass("non-root-user", nonRootUser(config.User)),
      pass("read-only-root", host.ReadonlyRootfs === true),
      pass("all-capabilities-dropped", host.CapDrop?.includes("ALL")),
      pass("no-new-privileges", host.SecurityOpt?.some((item) => item.includes("no-new-privileges"))),
      pass("not-privileged", host.Privileged === false),
      pass("private-pid-ipc-cgroup", host.PidMode !== "host" && host.IpcMode !== "host" && host.CgroupnsMode !== "host"),
      pass("bounded-memory-cpu-pids", host.Memory > 0 && host.NanoCpus > 0 && host.PidsLimit > 0 && host.PidsLimit <= maxPids),
      pass("workspace-tmpfs-hardened", hardenedTmpfs(host.Tmpfs, "/workspace") && hardenedTmpfs(host.Tmpfs, "/tmp")),
      pass("no-host-bind-mounts", (inspected.Mounts || []).every((mount) => mount.Type !== "bind")),
      pass("owned-container", config.Labels?.[OWNER_LABEL] === "true" && config.Labels?.["agentic-canvas-os.provider-revision"] === provider.revision),
    ];

    const engineSecurity = JSON.parse((await runDocker(["info", "--format", "{{json .SecurityOptions}}"], { signal })).stdout);
    checks.push(pass("engine-seccomp", engineSecurity.some((item) => String(item).includes("seccomp"))));
    if (state.networkId) {
      const network = parseInspect(
        (await runDocker(["network", "inspect", state.networkId], { signal })).stdout,
        "network",
      );
      checks.push(pass("internal-network", network.Internal === true));
      checks.push(pass("agent-container-not-published", !Object.keys(host.PortBindings || {}).length));
      let proxiesHardened = state.previewPorts?.length > 0
        && state.previewBindings?.length === state.previewPorts.length;
      for (const binding of state.previewBindings || []) {
        const proxy = parseInspect(
          (await runDocker(["inspect", binding.proxyContainerId], { signal })).stdout,
          "preview proxy",
        );
        const proxyHost = proxy.HostConfig || {};
        const proxyBindings = Object.values(proxyHost.PortBindings || {}).flat();
        const publishedPort = await runDocker(
          ["port", binding.proxyContainerId, `${binding.containerPort}/tcp`],
          { signal },
        );
        proxiesHardened &&= proxy.State?.Running === true
          && proxy.Config?.Image === safeImage
          && nonRootUser(proxy.Config?.User)
          && proxy.Config?.Labels?.["agentic-canvas-os.sandbox-role"] === "preview-proxy"
          && proxyHost.ReadonlyRootfs === true
          && proxyHost.CapDrop?.includes("ALL")
          && proxyHost.SecurityOpt?.some((item) => item.includes("no-new-privileges"))
          && proxyHost.Privileged === false
          && proxyHost.Memory > 0
          && proxyHost.NanoCpus > 0
          && proxyHost.PidsLimit > 0
          && proxyHost.PidsLimit <= maxPids
          && hardenedTmpfs(proxyHost.Tmpfs, "/tmp")
          && (proxy.Mounts || []).every((mount) => mount.Type !== "bind")
          && proxyBindings.length === 1
          && proxyBindings[0].HostIp === "127.0.0.1"
          && /^127\.0\.0\.1:[0-9]+$/m.test(publishedPort.stdout.trim());
      }
      checks.push(pass("hardened-loopback-preview-proxies", proxiesHardened));
    } else {
      checks.push(pass(
        "network-disabled",
        host.NetworkMode === "none"
          && !Object.keys(host.PortBindings || {}).length
          && !state.previewPorts?.length
          && !state.previewBindings?.length,
      ));
    }

    const user = await runDocker(["exec", state.containerId, "id", "-u"], { signal });
    checks.push(pass("behavior-non-root", Number(user.stdout.trim()) > 0));
    const rootWrite = await runDocker(
      ["exec", state.containerId, "touch", "/containment-root-write"],
      { signal, acceptedExitCodes: [0, 1, 2, 126] },
    );
    checks.push(pass("behavior-root-write-denied", rootWrite.exitCode !== 0));
    await runDocker(["exec", state.containerId, "touch", "/workspace/.containment-probe"], { signal });
    await runDocker(["exec", state.containerId, "rm", "/workspace/.containment-probe"], { signal });
    checks.push(pass("behavior-workspace-write", true));

    const egressProbe = [
      "const net=require('node:net');",
      "const socket=net.connect({host:'1.1.1.1',port:443});",
      "const blocked=()=>process.exit(0);",
      "socket.setTimeout(750);",
      "socket.on('connect',()=>process.exit(1));",
      "socket.on('error',blocked);",
      "socket.on('timeout',()=>{socket.destroy();blocked();});",
    ].join("");
    const egress = await runDocker(
      ["exec", state.containerId, "node", "-e", egressProbe],
      { signal, acceptedExitCodes: [0, 1] },
    );
    checks.push(pass("behavior-egress-denied", egress.exitCode === 0));

    return Object.freeze({ status: "verified", fresh: true, checks: Object.freeze(checks) });
  }

  return Object.freeze({ descriptor, verify });
}
