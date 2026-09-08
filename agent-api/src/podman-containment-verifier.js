import { SandboxAgentBlock, assertIdentifier } from "./sandbox-agent-contract.js";
import { createPodmanCommandRunner } from "./podman-command-runner.js";

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

function noProcessCapabilities(status) {
  const lines = status.split("\n");
  return ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].every((key) => {
    const matches = lines.filter((line) => line.startsWith(`${key}:`));
    return matches.length === 1 && new RegExp(`^${key}:\\s+0{16}$`).test(matches[0]);
  });
}

export function createPodmanContainmentVerifier({
  revision,
  image,
  runPodman = createPodmanCommandRunner({ maxOutputBytes: 1_000_000 }),
  maxPids = 128,
} = {}) {
  const safeRevision = assertIdentifier(revision, "revision");
  const safeImage = assertIdentifier(image, "image");
  if (typeof runPodman !== "function") throw new TypeError("runPodman must be a function.");
  if (!Number.isInteger(maxPids) || maxPids < 1) throw new TypeError("maxPids must be a positive integer.");
  const descriptor = Object.freeze({ id: "podman-independent-probe", revision: safeRevision });

  async function verify({ state, provider, signal }) {
    if (provider.id !== "podman-cli" || state?.schema !== "podman-sandbox-state/v1") {
      throw new SandboxAgentBlock("containment_proof_failed", "Podman verifier received incompatible provider state.");
    }
    const inspected = parseInspect(
      (await runPodman(["inspect", state.containerId], { signal })).stdout,
      "container",
    );
    const host = inspected.HostConfig || {};
    const config = inspected.Config || {};
    const checks = [
      pass("container-running", inspected.State?.Running === true),
      pass("immutable-image", config.Image === safeImage),
      pass("non-root-user", nonRootUser(config.User)),
      pass("read-only-root", host.ReadonlyRootfs === true),
      pass("no-capabilities-added", Array.isArray(host.CapAdd) && host.CapAdd.length === 0),
      pass("no-new-privileges", host.SecurityOpt?.some((item) => item.includes("no-new-privileges"))),
      pass("not-privileged", host.Privileged === false),
      pass("private-pid-ipc-cgroup", host.PidMode !== "host" && host.IpcMode !== "host" && host.CgroupnsMode !== "host"),
      pass("bounded-memory-cpu-pids", host.Memory > 0 && host.NanoCpus > 0 && host.PidsLimit > 0 && host.PidsLimit <= maxPids),
      pass("workspace-tmpfs-hardened", hardenedTmpfs(host.Tmpfs, "/workspace") && hardenedTmpfs(host.Tmpfs, "/tmp")),
      pass("no-host-bind-mounts", (inspected.Mounts || []).every((mount) => mount.Type !== "bind")),
      pass("owned-container", config.Labels?.[OWNER_LABEL] === "true" && config.Labels?.["agentic-canvas-os.provider-revision"] === provider.revision),
    ];

    const engineSecurity = JSON.parse((await runPodman(["info", "--format", "{{json .Host.Security}}"], { signal })).stdout);
    checks.push(pass("engine-seccomp", engineSecurity.seccompEnabled === true));
    if (state.networkId) {
      const network = parseInspect(
        (await runPodman(["network", "inspect", state.networkId], { signal })).stdout,
        "network",
      );
      checks.push(pass("internal-network", network.internal === true));
      checks.push(pass("agent-container-not-published", !Object.keys(host.PortBindings || {}).length));
      let proxiesHardened = state.previewPorts?.length > 0
        && state.previewBindings?.length === state.previewPorts.length;
      for (const binding of state.previewBindings || []) {
        const proxy = parseInspect(
          (await runPodman(["inspect", binding.proxyContainerId], { signal })).stdout,
          "preview proxy",
        );
        const proxyHost = proxy.HostConfig || {};
        const proxyBindings = Object.values(proxyHost.PortBindings || {}).flat();
        const publishedPort = await runPodman(
          ["port", binding.proxyContainerId, `${binding.containerPort}/tcp`],
          { signal },
        );
        const proxyCaps = await runPodman(["exec", binding.proxyContainerId, "cat", "/proc/1/status"], { signal });
        proxiesHardened &&= noProcessCapabilities(proxyCaps.stdout);
        proxiesHardened &&= proxy.State?.Running === true
          && proxy.Config?.Image === safeImage
          && nonRootUser(proxy.Config?.User)
          && proxy.Config?.Labels?.["agentic-canvas-os.sandbox-role"] === "preview-proxy"
          && proxyHost.ReadonlyRootfs === true
          && Array.isArray(proxyHost.CapAdd) && proxyHost.CapAdd.length === 0
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

    const caps = await runPodman(["exec", state.containerId, "cat", "/proc/1/status"], { signal });
    checks.push(pass("all-process-capabilities-dropped", noProcessCapabilities(caps.stdout)));
    const user = await runPodman(["exec", state.containerId, "id", "-u"], { signal });
    checks.push(pass("behavior-non-root", Number(user.stdout.trim()) > 0));
    const rootWrite = await runPodman(
      ["exec", state.containerId, "touch", "/containment-root-write"],
      { signal, acceptedExitCodes: [0, 1, 2, 126] },
    );
    checks.push(pass("behavior-root-write-denied", rootWrite.exitCode !== 0));
    await runPodman(["exec", state.containerId, "touch", "/workspace/.containment-probe"], { signal });
    await runPodman(["exec", state.containerId, "rm", "/workspace/.containment-probe"], { signal });
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
    const egress = await runPodman(
      ["exec", state.containerId, "node", "-e", egressProbe],
      { signal, acceptedExitCodes: [0, 1] },
    );
    checks.push(pass("behavior-egress-denied", egress.exitCode === 0));

    return Object.freeze({ status: "verified", fresh: true, checks: Object.freeze(checks) });
  }

  return Object.freeze({ descriptor, verify });
}
