import { normalizeJson, serializedJsonLength } from "./json-contract.js";

export const SANDBOX_AGENT_CAPABILITIES = Object.freeze([
  "files",
  "commands",
  "packages",
  "ports",
  "snapshots",
  "resume",
]);

const CAPABILITY_SET = new Set(SANDBOX_AGENT_CAPABILITIES);
const OPERATION_CAPABILITY = Object.freeze({
  "file.read": "files",
  "file.write": "files",
  "command.run": "commands",
  "package.install": "packages",
  "port.open": "ports",
});
const PACKAGE_NAME = /^[a-zA-Z0-9@][a-zA-Z0-9@/._+-]{0,255}$/;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

export class SandboxAgentBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "SandboxAgentBlock";
    this.reasonCode = reasonCode;
  }
}

export function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

export function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

export function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function normalizeRelativePath(value, field) {
  const path = assertIdentifier(value, field).replaceAll("\\", "/");
  if (path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new SandboxAgentBlock("workspace_path_invalid", `${field} must be a normalized workspace-relative path.`);
  }
  return path;
}

export function normalizeCapabilities(value, field = "capabilities") {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  const capabilities = value.map((item, index) => {
    const capability = assertIdentifier(item, `${field}[${index}]`);
    if (!CAPABILITY_SET.has(capability)) throw new TypeError(`${field}[${index}] is unsupported.`);
    return capability;
  });
  if (new Set(capabilities).size !== capabilities.length) throw new TypeError(`${field} contains a duplicate.`);
  return Object.freeze(capabilities);
}

function normalizeWorkspaceFile(value, index, limits) {
  const field = `workspace.files[${index}]`;
  assertExactKeys(value, ["path", "content"], field);
  if (typeof value.content !== "string") throw new TypeError(`${field}.content must be a string.`);
  if (value.content.length > limits.maxFileChars) {
    throw new RangeError(`${field}.content exceeds ${limits.maxFileChars} characters.`);
  }
  return Object.freeze({ path: normalizeRelativePath(value.path, `${field}.path`), content: value.content });
}

export function normalizeWorkspace(value, limits) {
  assertExactKeys(value, ["revision", "directories", "files", "environmentBindings"], "workspace");
  const directories = value.directories === undefined
    ? []
    : value.directories.map((path, index) => normalizeRelativePath(path, `workspace.directories[${index}]`));
  const files = value.files === undefined
    ? []
    : value.files.map((file, index) => normalizeWorkspaceFile(file, index, limits));
  const environmentBindings = value.environmentBindings === undefined ? [] : value.environmentBindings.map((name, index) => {
    const binding = assertIdentifier(name, `workspace.environmentBindings[${index}]`);
    if (!ENVIRONMENT_NAME.test(binding)) throw new TypeError(`workspace.environmentBindings[${index}] is invalid.`);
    return binding;
  });
  for (const [field, items] of Object.entries({ directories, files, environmentBindings })) {
    if (items.length > limits.maxWorkspaceEntries) {
      throw new RangeError(`workspace.${field} exceeds ${limits.maxWorkspaceEntries} entries.`);
    }
    const identities = items.map((item) => typeof item === "string" ? item : item.path);
    if (new Set(identities).size !== identities.length) throw new TypeError(`workspace.${field} contains a duplicate.`);
  }
  const workspace = normalizeJson({
    revision: assertIdentifier(value.revision, "workspace.revision"),
    directories,
    files,
    environmentBindings,
  }, "workspace");
  if (serializedJsonLength(workspace) > limits.maxWorkspaceChars) {
    throw new RangeError(`workspace exceeds ${limits.maxWorkspaceChars} characters.`);
  }
  return workspace;
}

export function normalizeOpenRequest(value, limits) {
  assertExactKeys(value, ["runId", "agentId", "workspace", "requiredCapabilities", "snapshotToken"], "request");
  if (value.snapshotToken !== undefined && value.workspace !== undefined) {
    throw new SandboxAgentBlock("workspace_source_conflict", "A new workspace and a snapshot cannot seed the same sandbox.");
  }
  if (value.snapshotToken === undefined && value.workspace === undefined) {
    throw new SandboxAgentBlock("workspace_source_missing", "A workspace or snapshot is required.");
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    agentId: assertIdentifier(value.agentId, "request.agentId"),
    requiredCapabilities: normalizeCapabilities(value.requiredCapabilities, "request.requiredCapabilities"),
    ...(value.workspace === undefined ? {} : { workspace: normalizeWorkspace(value.workspace, limits) }),
    ...(value.snapshotToken === undefined
      ? {}
      : { snapshotToken: assertIdentifier(value.snapshotToken, "request.snapshotToken") }),
  });
}

function normalizeArgv(value, limits) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("operation.argv must be a non-empty array.");
  if (value.length > limits.maxCommandArguments) {
    throw new RangeError(`operation.argv exceeds ${limits.maxCommandArguments} entries.`);
  }
  return Object.freeze(value.map((argument, index) => {
    if (typeof argument !== "string" || !argument.length) throw new TypeError(`operation.argv[${index}] must be a non-empty string.`);
    if (argument.length > limits.maxArgumentChars) {
      throw new RangeError(`operation.argv[${index}] exceeds ${limits.maxArgumentChars} characters.`);
    }
    return argument;
  }));
}

export function normalizeOperation(value, limits) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("operation must be an object.");
  const kind = assertIdentifier(value.kind, "operation.kind");
  if (!OPERATION_CAPABILITY[kind]) throw new TypeError("operation.kind is unsupported.");
  if (kind === "file.read") {
    assertExactKeys(value, ["kind", "path"], "operation");
    return Object.freeze({ kind, path: normalizeRelativePath(value.path, "operation.path") });
  }
  if (kind === "file.write") {
    assertExactKeys(value, ["kind", "path", "content"], "operation");
    if (typeof value.content !== "string") throw new TypeError("operation.content must be a string.");
    if (value.content.length > limits.maxFileChars) {
      throw new RangeError(`operation.content exceeds ${limits.maxFileChars} characters.`);
    }
    return Object.freeze({ kind, path: normalizeRelativePath(value.path, "operation.path"), content: value.content });
  }
  if (kind === "command.run") {
    assertExactKeys(value, ["kind", "argv", "cwd"], "operation");
    return Object.freeze({
      kind,
      argv: normalizeArgv(value.argv, limits),
      ...(value.cwd === undefined ? {} : { cwd: normalizeRelativePath(value.cwd, "operation.cwd") }),
    });
  }
  if (kind === "package.install") {
    assertExactKeys(value, ["kind", "manager", "packages"], "operation");
    const manager = assertIdentifier(value.manager, "operation.manager");
    if (!Array.isArray(value.packages) || value.packages.length === 0) {
      throw new TypeError("operation.packages must be a non-empty array.");
    }
    if (value.packages.length > limits.maxPackages) {
      throw new RangeError(`operation.packages exceeds ${limits.maxPackages} entries.`);
    }
    const packages = value.packages.map((item, index) => {
      const packageName = assertIdentifier(item, `operation.packages[${index}]`);
      if (!PACKAGE_NAME.test(packageName)) throw new TypeError(`operation.packages[${index}] is invalid.`);
      return packageName;
    });
    if (new Set(packages).size !== packages.length) throw new TypeError("operation.packages contains a duplicate.");
    return Object.freeze({ kind, manager, packages: Object.freeze(packages) });
  }
  assertExactKeys(value, ["kind", "containerPort", "protocol", "audience"], "operation");
  if (!Number.isInteger(value.containerPort) || value.containerPort < 1 || value.containerPort > 65_535) {
    throw new TypeError("operation.containerPort must be an integer from 1 to 65535.");
  }
  if (!new Set(["http", "tcp"]).has(value.protocol)) throw new TypeError("operation.protocol is unsupported.");
  if (!new Set(["private", "preview"]).has(value.audience)) {
    throw new SandboxAgentBlock("port_audience_forbidden", "Only private or preview ports are supported.");
  }
  return Object.freeze({ kind, containerPort: value.containerPort, protocol: value.protocol, audience: value.audience });
}

export function capabilityForOperation(operation) {
  return OPERATION_CAPABILITY[operation.kind];
}

export function normalizeProviderDescriptor(value) {
  assertExactKeys(value, ["id", "revision", "capabilities", "executionBoundary"], "adapter.descriptor");
  if (value.executionBoundary !== "container") {
    throw new SandboxAgentBlock("container_boundary_missing", "The sandbox adapter must declare a container execution boundary.");
  }
  return Object.freeze({
    id: assertIdentifier(value.id, "adapter.descriptor.id"),
    revision: assertIdentifier(value.revision, "adapter.descriptor.revision"),
    capabilities: normalizeCapabilities(value.capabilities, "adapter.descriptor.capabilities"),
    executionBoundary: "container",
  });
}

export function normalizeAttestation(value, descriptor, requiredCapabilities, field = "attestation") {
  assertExactKeys(value, ["providerId", "providerRevision", "executionBoundary", "fresh", "capabilities"], field);
  const capabilities = normalizeCapabilities(value.capabilities, `${field}.capabilities`);
  if (value.providerId !== descriptor.id || value.providerRevision !== descriptor.revision) {
    throw new SandboxAgentBlock("provider_attestation_mismatch", "Sandbox provider attestation does not match the registered adapter revision.");
  }
  if (value.executionBoundary !== "container" || value.fresh !== true) {
    throw new SandboxAgentBlock("container_attestation_missing", "Fresh container-boundary attestation is required.");
  }
  const missing = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  if (missing.length) {
    throw new SandboxAgentBlock("provider_capability_missing", `Sandbox provider did not attest: ${missing.join(", ")}.`);
  }
  return Object.freeze({
    providerId: descriptor.id,
    providerRevision: descriptor.revision,
    executionBoundary: "container",
    fresh: true,
    capabilities,
  });
}

export function normalizeCost(value) {
  if (value === undefined) return Object.freeze({ status: "unreported" });
  assertExactKeys(value, ["status", "amountUsd"], "cost");
  if (!new Set(["reported", "unreported", "not-run"]).has(value.status)) throw new TypeError("cost.status is unsupported.");
  if (value.status === "reported") {
    if (typeof value.amountUsd !== "number" || !Number.isFinite(value.amountUsd) || value.amountUsd < 0) {
      throw new TypeError("cost.amountUsd must be a non-negative finite number when reported.");
    }
    return Object.freeze({ status: "reported", amountUsd: value.amountUsd });
  }
  if (value.amountUsd !== undefined) throw new TypeError("cost.amountUsd is only valid when cost.status is reported.");
  return Object.freeze({ status: value.status });
}

export function normalizePublicOutput(value, maxOutputChars) {
  const output = normalizeJson(value, "provider.output");
  const sensitive = [];
  function visit(item, path) {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (/(?:secret|password|credential|authorization|api.?key|opaque.?state|serialized.?state|resume.?token)/i.test(key)) {
        sensitive.push(`${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  }
  visit(output, "provider.output");
  if (sensitive.length) {
    throw new SandboxAgentBlock("provider_output_sensitive", "Sandbox provider output contains a sensitive field.");
  }
  if (serializedJsonLength(output) > maxOutputChars) {
    throw new SandboxAgentBlock("provider_output_capacity", `Sandbox provider output exceeds ${maxOutputChars} characters.`);
  }
  return output;
}

export function requireSandboxMethod(owner, name) {
  if (typeof owner?.[name] !== "function") {
    throw new SandboxAgentBlock("sandbox_adapter_invalid", `Sandbox adapter method ${name} is required.`);
  }
}

export function normalizeSandboxAdapter(adapter) {
  if (adapter === undefined) return null;
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new TypeError("adapter must be an object when provided.");
  }
  const descriptor = normalizeProviderDescriptor(adapter.descriptor);
  for (const method of ["create", "execute", "snapshot", "suspend", "resume", "close"]) {
    requireSandboxMethod(adapter, method);
  }
  return Object.freeze({ adapter, descriptor });
}

export function normalizeAuthorization(value, action) {
  assertExactKeys(value, ["allowed", "approvalId", "reasonCode"], "authorization");
  if (typeof value.allowed !== "boolean") throw new TypeError("authorization.allowed must be boolean.");
  if (!value.allowed) {
    const reasonCode = value.reasonCode === undefined
      ? "sandbox_operation_denied"
      : assertIdentifier(value.reasonCode, "authorization.reasonCode");
    throw new SandboxAgentBlock(reasonCode, `Sandbox action ${action} was denied by application policy.`);
  }
  return Object.freeze({
    allowed: true,
    ...(value.approvalId === undefined
      ? {}
      : { approvalId: assertIdentifier(value.approvalId, "authorization.approvalId") }),
  });
}

function normalizeOpaqueState(value, field, maxStateChars) {
  const state = normalizeJson(value, field);
  if (serializedJsonLength(state) > maxStateChars) {
    throw new SandboxAgentBlock("sandbox_state_capacity", `${field} exceeds ${maxStateChars} characters.`);
  }
  return state;
}

export function normalizeSessionOutcome(value, descriptor, capabilities, limits, field) {
  assertExactKeys(value, ["providerSessionId", "state", "attestation", "cost"], field);
  return Object.freeze({
    providerSessionId: assertIdentifier(value.providerSessionId, `${field}.providerSessionId`),
    state: normalizeOpaqueState(value.state, `${field}.state`, limits.maxStateChars),
    attestation: normalizeAttestation(value.attestation, descriptor, capabilities, `${field}.attestation`),
    cost: normalizeCost(value.cost),
  });
}

export function normalizeExecutionOutcome(value, descriptor, capability, limits) {
  assertExactKeys(value, ["output", "state", "attestation", "cost"], "adapter.execute result");
  return Object.freeze({
    output: normalizePublicOutput(value.output, limits.maxOutputChars),
    ...(value.state === undefined
      ? {}
      : { state: normalizeOpaqueState(value.state, "adapter.execute result.state", limits.maxStateChars) }),
    attestation: normalizeAttestation(value.attestation, descriptor, [capability], "adapter.execute result.attestation"),
    cost: normalizeCost(value.cost),
  });
}

export function normalizeSnapshotOutcome(value, descriptor, limits) {
  assertExactKeys(value, ["providerSnapshotId", "metadata", "attestation", "cost"], "adapter.snapshot result");
  return Object.freeze({
    providerSnapshotId: assertIdentifier(value.providerSnapshotId, "adapter.snapshot result.providerSnapshotId"),
    metadata: normalizePublicOutput(value.metadata || {}, limits.maxOutputChars),
    attestation: normalizeAttestation(value.attestation, descriptor, ["snapshots"], "adapter.snapshot result.attestation"),
    cost: normalizeCost(value.cost),
  });
}

export function normalizeSuspendOutcome(value, descriptor, limits) {
  assertExactKeys(value, ["serializedState", "attestation", "cost"], "adapter.suspend result");
  return Object.freeze({
    serializedState: normalizeOpaqueState(
      value.serializedState,
      "adapter.suspend result.serializedState",
      limits.maxStateChars,
    ),
    attestation: normalizeAttestation(value.attestation, descriptor, ["resume"], "adapter.suspend result.attestation"),
    cost: normalizeCost(value.cost),
  });
}

export function normalizeCloseOutcome(value, descriptor, capabilities) {
  assertExactKeys(value, ["closed", "attestation", "cost"], "adapter.close result");
  if (value.closed !== true) {
    throw new SandboxAgentBlock("sandbox_close_unconfirmed", "Sandbox provider did not confirm closure.");
  }
  return Object.freeze({
    closed: true,
    attestation: normalizeAttestation(value.attestation, descriptor, capabilities, "adapter.close result.attestation"),
    cost: normalizeCost(value.cost),
  });
}
