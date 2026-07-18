import { createHash } from "node:crypto";

import { assertExactKeys, assertIdentifier } from "./sandbox-agent-contract.js";
import { normalizeJson } from "./json-contract.js";

const AUTHORIZED_ACTIONS = new Set([
  "workspace.open",
  "file.read",
  "file.write",
  "command.run",
  "package.install",
  "port.open",
  "snapshot.create",
  "workspace.pause",
  "workspace.resume",
]);

function uniqueStrings(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const items = value.map((item, index) => assertIdentifier(item, `${field}[${index}]`));
  if (new Set(items).size !== items.length) throw new TypeError(`${field} contains a duplicate.`);
  return Object.freeze(items);
}

function uniquePorts(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const ports = value.map((port, index) => {
    if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
      throw new TypeError(`${field}[${index}] must be an integer from 1024 to 65535.`);
    }
    return port;
  });
  if (new Set(ports).size !== ports.length) throw new TypeError(`${field} contains a duplicate.`);
  return Object.freeze(ports);
}

function normalizePackagePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("policy.packageManagers must be an object.");
  }
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([manager, packages]) => [
    assertIdentifier(manager, "policy.packageManagers key"),
    uniqueStrings(packages, `policy.packageManagers.${manager}`),
  ])));
}

function normalizePolicy(value) {
  assertExactKeys(value, [
    "revision",
    "agents",
    "workspaceRevisions",
    "readPaths",
    "writePaths",
    "commands",
    "packageManagers",
    "previewPorts",
    "environmentBindings",
    "allowSnapshots",
    "allowResume",
  ], "policy");
  if (typeof value.allowSnapshots !== "boolean" || typeof value.allowResume !== "boolean") {
    throw new TypeError("policy snapshot and resume grants must be boolean.");
  }
  return Object.freeze({
    revision: assertIdentifier(value.revision, "policy.revision"),
    agents: uniqueStrings(value.agents, "policy.agents"),
    workspaceRevisions: uniqueStrings(value.workspaceRevisions, "policy.workspaceRevisions"),
    readPaths: uniqueStrings(value.readPaths, "policy.readPaths"),
    writePaths: uniqueStrings(value.writePaths, "policy.writePaths"),
    commands: uniqueStrings(value.commands, "policy.commands"),
    packageManagers: normalizePackagePolicy(value.packageManagers),
    previewPorts: uniquePorts(value.previewPorts, "policy.previewPorts"),
    environmentBindings: uniqueStrings(value.environmentBindings, "policy.environmentBindings"),
    allowSnapshots: value.allowSnapshots,
    allowResume: value.allowResume,
  });
}

function pathAllowed(candidate, prefixes) {
  return prefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`));
}

function denied(reasonCode) {
  return Object.freeze({ allowed: false, reasonCode });
}

function approvalId(policy, request) {
  const payload = JSON.stringify(normalizeJson({
    policyRevision: policy.revision,
    action: request.action,
    runId: request.runId,
    agentId: request.agentId,
    ...(request.operation ? { operation: request.operation } : {}),
    ...(request.workspaceRevision ? { workspaceRevision: request.workspaceRevision } : {}),
    ...(request.requiredCapabilities ? { requiredCapabilities: request.requiredCapabilities } : {}),
    ...(request.source ? { source: request.source } : {}),
    ...(request.workspace ? { workspace: request.workspace } : {}),
  }, "authorization evidence"));
  return `sandbox-approval-${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
}

export function createSandboxApplicationAuthorizer(policyInput) {
  const policy = normalizePolicy(policyInput);

  return async function authorize(request) {
    if (!AUTHORIZED_ACTIONS.has(request.action)) return denied("sandbox_action_denied");
    if (!policy.agents.includes(request.agentId)) return denied("sandbox_agent_denied");
    if (request.workspaceRevision && !policy.workspaceRevisions.includes(request.workspaceRevision)) {
      return denied("sandbox_workspace_revision_denied");
    }
    if (request.action === "workspace.open" && request.workspace) {
      const workspacePaths = [...request.workspace.directories, ...request.workspace.filePaths];
      if (workspacePaths.some((item) => !pathAllowed(item, policy.writePaths))) {
        return denied("sandbox_workspace_path_denied");
      }
      if (request.workspace.previewPorts.some((port) => !policy.previewPorts.includes(port))) {
        return denied("sandbox_preview_port_denied");
      }
      if (request.workspace.environmentBindings.some((name) => !policy.environmentBindings.includes(name))) {
        return denied("sandbox_environment_binding_denied");
      }
    }
    if (request.action === "file.read" && !pathAllowed(request.operation.path, policy.readPaths)) {
      return denied("sandbox_read_path_denied");
    }
    if (request.action === "file.write" && !pathAllowed(request.operation.path, policy.writePaths)) {
      return denied("sandbox_write_path_denied");
    }
    if (request.action === "command.run") {
      if (!policy.commands.includes(request.operation.argv[0])) return denied("sandbox_command_denied");
      if (request.operation.cwd && !pathAllowed(request.operation.cwd, policy.readPaths)) {
        return denied("sandbox_command_cwd_denied");
      }
    }
    if (request.action === "package.install") {
      const packages = policy.packageManagers[request.operation.manager];
      if (!packages || request.operation.packages.some((item) => !packages.includes(item))) {
        return denied("sandbox_package_denied");
      }
    }
    if (request.action === "port.open" && !policy.previewPorts.includes(request.operation.containerPort)) {
      return denied("sandbox_preview_port_denied");
    }
    if (request.action === "snapshot.create" && !policy.allowSnapshots) return denied("sandbox_snapshot_denied");
    if (["workspace.pause", "workspace.resume"].includes(request.action) && !policy.allowResume) {
      return denied("sandbox_resume_denied");
    }
    return Object.freeze({ allowed: true, approvalId: approvalId(policy, request) });
  };
}
