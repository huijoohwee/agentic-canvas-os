#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const HYBRID_WORKSPACE_BOOTSTRAP_SCHEMA =
  "agentic-hybrid-workspace-bootstrap/v1";
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CLOUD_SIGNALS = Object.freeze([
  "CODESPACES", "GITPOD_WORKSPACE_ID", "CLOUD_WORKSTATION_CONFIG", "CLOUD_SHELL",
]);
const CONTAINER_SIGNALS = Object.freeze([
  "CODESPACES", "REMOTE_CONTAINERS", "DEVCONTAINER", "container",
]);
const READ_ONLY_GIT_PREFIX = Object.freeze([
  "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false",
]);
export const READ_ONLY_GIT_COMMANDS = Object.freeze({
  gitVersion: Object.freeze(["--version"]),
  repositoryRoot: Object.freeze(["rev-parse", "--show-toplevel"]),
  head: Object.freeze(["rev-parse", "--verify", "HEAD^{commit}"]),
  remoteNames: Object.freeze(["remote"]),
  originMain: Object.freeze([
    "rev-parse", "--verify", "refs/remotes/origin/main^{commit}",
  ]),
  promisorConfig: Object.freeze([
    "config", "--includes", "--get-regexp",
    "^(extensions\\.partialclone|remote\\..*\\.promisor)$",
  ]),
  executableFilters: Object.freeze([
    "config", "--includes", "--get-regexp",
    "^filter\\..*\\.(clean|process)$",
  ]),
  shallow: Object.freeze(["rev-parse", "--is-shallow-repository"]),
  status: Object.freeze([
    "status", "--porcelain=v1", "-z", "--untracked-files=all",
    "--ignore-submodules=all",
  ]),
  branch: Object.freeze(["symbolic-ref", "--quiet", "--short", "HEAD"]),
  registration: Object.freeze(["worktree", "list", "--porcelain", "-z"]),
});
const STATIC_GIT_SIGNATURES = new Set(
  Object.values(READ_ONLY_GIT_COMMANDS).map((args) => JSON.stringify(args)),
);
const DEFERRED_LIFECYCLE = Object.freeze({
  status: "deferred-to-admission",
  scope: "declared-write-scope",
  nextWorkflow: "docs/START-WORKFLOW.md",
});
const FINDING_MESSAGES = Object.freeze({
  "invalid-placement-override":
    "The placement override must select local or cloud.",
  "unsupported-node-version":
    "Node.js 22 or newer is required.",
  "object-safety-unavailable":
    "The installed Git cannot establish network-free object inspection.",
  "promisor-lazy-fetch-unsafe":
    "This promisor checkout needs Git 2.45 or newer for network-free inspection.",
  "repository-filter-unsafe":
    "Executable repository Git filters block read-only inspection.",
  "repository-unavailable":
    "The current checkout is not an available Git worktree.",
  "head-unavailable":
    "The current HEAD commit is unavailable.",
  "missing-origin":
    "The current repository has no origin remote.",
  "remote-inventory-unavailable":
    "The current repository remote inventory is unavailable.",
  "origin-main-unavailable":
    "The local origin/main tracking commit is unavailable.",
  "status-unavailable":
    "The current checkout status could not be inspected.",
  "dirty-worktree":
    "The current checkout contains tracked or untracked changes.",
  "detached-head":
    "The current checkout has a detached HEAD.",
  "branch-unavailable":
    "The current checkout branch could not be inspected.",
  "non-main-branch":
    "The current checkout is not attached to main.",
  "missing-current-registration":
    "The current checkout has no worktree registration.",
  "invalid-current-registration":
    "The current checkout worktree registration is invalid or ambiguous.",
  "ahead-of-origin-main":
    "The current HEAD is ahead of local origin/main.",
  "behind-origin-main":
    "The current HEAD is behind local origin/main.",
  "divergent-main":
    "The current HEAD and local origin/main have diverged.",
  "main-relation-unavailable":
    "The relationship between HEAD and local origin/main is unavailable.",
});
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function signalEnabled(environment, name) {
  return hasOwn(environment, name);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function addFinding(findings, code) {
  if (!findings.some((finding) => finding.code === code)) {
    findings.push({ code, message: FINDING_MESSAGES[code] });
  }
}
function resolvePlacement({ environment, placementOverride }) {
  const containerized = CONTAINER_SIGNALS.some(
    (name) => signalEnabled(environment, name),
  );
  const cliOverridePresent = placementOverride !== undefined;
  const environmentOverride = environment.AGENTIC_WORKSPACE_PLACEMENT;
  const environmentOverridePresent = hasOwn(
    environment, "AGENTIC_WORKSPACE_PLACEMENT",
  ) && String(environmentOverride ?? "").trim() !== "";
  if (cliOverridePresent || environmentOverridePresent) {
    const raw = cliOverridePresent
      ? placementOverride
      : environmentOverride;
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (value === "local" || value === "cloud") {
      return {
        placement: { kind: value, source: "override", containerized },
        invalidOverride: false,
      };
    }
    return {
      placement: {
        kind: "unknown",
        source: "invalid-override",
        containerized,
      },
      invalidOverride: true,
    };
  }
  const cloud = CLOUD_SIGNALS.some(
    (name) => signalEnabled(environment, name),
  );
  return {
    placement: {
      kind: cloud ? "cloud" : "local",
      source: cloud ? "runtime-signal" : "default",
      containerized,
    },
    invalidOverride: false,
  };
}
function supportsNode22(version) {
  const match = /^(\d+)\./u.exec(String(version || ""));
  return Boolean(match && Number.parseInt(match[1], 10) >= 22);
}
function readOnlyGitEnvironment(environment) {
  const result = {};
  for (const name of [
    "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR",
  ]) {
    if (typeof environment[name] === "string") result[name] = environment[name];
  }
  return {
    ...result,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    LC_ALL: "C",
    LANG: "C",
  };
}
function defaultRunGit(args, { cwd, environment, noLazyFetch }) {
  return spawnSync("git", [
    ...(noLazyFetch ? ["--no-lazy-fetch"] : []), ...READ_ONLY_GIT_PREFIX, ...args,
  ], {
    cwd,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
function isAllowedGitCommand(args) {
  if (STATIC_GIT_SIGNATURES.has(JSON.stringify(args))) return true;
  return args.length === 4
    && args[0] === "merge-base"
    && args[1] === "--is-ancestor"
    && OID_PATTERN.test(args[2])
    && OID_PATTERN.test(args[3]);
}
function outputText(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}
function runReadOnlyGit(args, { cwd, environment, runGit, noLazyFetch = false }) {
  if (!isAllowedGitCommand(args)) {
    throw new Error("Internal Git command is outside the read-only allowlist.");
  }
  try {
    const raw = runGit([...args], {
      cwd,
      environment: readOnlyGitEnvironment(environment),
      noLazyFetch,
      prefix: READ_ONLY_GIT_PREFIX,
    });
    if (typeof raw === "string" || Buffer.isBuffer(raw)) {
      return { status: 0, stdout: outputText(raw), failed: false };
    }
    return {
      status: Number.isInteger(raw?.status) ? raw.status : null,
      stdout: outputText(raw?.stdout),
      failed: Boolean(raw?.error),
    };
  } catch (error) {
    return {
      status: Number.isInteger(error?.status) ? error.status : null,
      stdout: outputText(error?.stdout),
      failed: true,
    };
  }
}
function successful(probe) {
  return probe.status === 0 && probe.failed === false;
}
function singleLine(value) {
  let result = String(value || "");
  if (result.endsWith("\r\n")) result = result.slice(0, -2);
  else if (result.endsWith("\n")) result = result.slice(0, -1);
  if (!result || /[\0\r\n]/u.test(result)) return null;
  return result;
}
function noLazyFetchSupported(probe) {
  if (!successful(probe)) return null;
  const match = /^git version (\d+)\.(\d+)(?:\.|\s|$)/u.exec(singleLine(probe.stdout) || "");
  if (!match) return null;
  const [major, minor] = match.slice(1).map(Number);
  return major > 2 || (major === 2 && minor >= 45);
}
function oidFromProbe(probe) {
  if (!successful(probe)) return null;
  const value = singleLine(probe.stdout);
  return value && OID_PATTERN.test(value) ? value : null;
}
function repositoryRootFromProbe(probe, resolvePath) {
  if (!successful(probe)) return null;
  const raw = singleLine(probe.stdout);
  if (!raw || !path.isAbsolute(raw)) return null;
  try {
    const absolute = path.normalize(path.resolve(raw));
    const root = path.normalize(resolvePath(absolute));
    return { root, aliases: new Set([absolute, root]) };
  } catch {
    return null;
  }
}
function originRemoteState(probe) {
  if (!successful(probe)) return "unavailable";
  const names = probe.stdout
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean);
  const count = names.filter((name) => name === "origin").length;
  return count === 1 ? "present" : count === 0 ? "missing" : "unavailable";
}
function assignRecordField(record, field, value) {
  if (hasOwn(record, field)) record.invalid = true;
  else record[field] = value;
}
function markRecordField(record, field) {
  if (record[field] === true) record.invalid = true;
  record[field] = true;
}
function parseWorktreeRecords(porcelain) {
  const source = String(porcelain || "");
  if (!source.includes("\0")) return null;
  const records = [];
  let current = null;
  for (const field of source.split("\0")) {
    if (!field) continue;
    if (field.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: field.slice("worktree ".length), invalid: false };
      if (!current.path) current.invalid = true;
      continue;
    }
    if (!current) continue;
    if (field.startsWith("HEAD ")) {
      assignRecordField(current, "head", field.slice("HEAD ".length));
    } else if (field.startsWith("branch ")) {
      assignRecordField(current, "branch", field.slice("branch ".length));
    } else if (field === "detached") {
      markRecordField(current, "detached");
    } else if (field === "bare") {
      markRecordField(current, "bare");
    } else if (field === "locked" || field.startsWith("locked ")) {
      markRecordField(current, "locked");
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      markRecordField(current, "prunable");
    }
  }
  if (current) records.push(current);
  return records;
}
function currentRegistration({
  probe, root, rootAliases, branch, headSha, resolvePath,
}) {
  if (!successful(probe)) return "invalid";
  const records = parseWorktreeRecords(probe.stdout);
  if (!records) return "invalid";
  const matches = [];
  for (const record of records) {
    if (!path.isAbsolute(record.path)) continue;
    const lexicalPath = path.normalize(path.resolve(record.path));
    if (!rootAliases.has(lexicalPath)) continue;
    try {
      if (path.normalize(resolvePath(record.path)) === root) matches.push(record);
    } catch {
      continue;
    }
  }
  if (matches.length === 0) return "missing";
  if (matches.length !== 1) return "invalid";
  const record = matches[0];
  const validBranch = branch === null
    ? record.detached === true && !record.branch
    : record.detached !== true && record.branch === `refs/heads/${branch}`;
  const validHead = OID_PATTERN.test(record.head || "")
    && (!headSha || record.head === headSha);
  return record.invalid
    || record.bare
    || record.locked
    || record.prunable
    || !validBranch
    || !validHead
    ? "invalid"
    : "valid";
}
function classifyRelation({ headSha, originMainSha, shallow, readGit }) {
  if (!headSha || !originMainSha) return "unavailable";
  if (headSha === originMainSha) return "equal";
  const headIsAncestor = readGit([
    "merge-base", "--is-ancestor", headSha, originMainSha,
  ]);
  const originIsAncestor = readGit([
    "merge-base", "--is-ancestor", originMainSha, headSha,
  ]);
  if (headIsAncestor.failed || originIsAncestor.failed) return "unavailable";
  if (headIsAncestor.status === 0 && originIsAncestor.status === 1) {
    return "behind";
  }
  if (headIsAncestor.status === 1 && originIsAncestor.status === 0) {
    return "ahead";
  }
  if (headIsAncestor.status === 1 && originIsAncestor.status === 1) {
    return shallow === false ? "diverged" : "unavailable";
  }
  return "unavailable";
}
function inspectRepository({ cwd, environment, runGit, resolvePath, findings }) {
  const unavailable = {
    branch: null,
    headSha: null,
    originMainSha: null,
    relation: "unavailable",
    clean: null,
    registered: false,
    canonical: false,
  };
  const versionProbe = runReadOnlyGit(READ_ONLY_GIT_COMMANDS.gitVersion, {
    cwd, environment, runGit,
  });
  const noLazyFetch = noLazyFetchSupported(versionProbe);
  if (noLazyFetch === null) {
    addFinding(findings, "object-safety-unavailable");
    return unavailable;
  }
  const readGitAt = (workingDirectory, args) => runReadOnlyGit(args, {
    cwd: workingDirectory, environment, runGit, noLazyFetch,
  });
  const rootEvidence = repositoryRootFromProbe(
    readGitAt(cwd, READ_ONLY_GIT_COMMANDS.repositoryRoot), resolvePath,
  );
  if (!rootEvidence) {
    addFinding(findings, "repository-unavailable");
    return unavailable;
  }
  const { root, aliases: rootAliases } = rootEvidence;
  const readGit = (args) => readGitAt(root, args);
  if (!noLazyFetch) {
    const promisor = readGit(READ_ONLY_GIT_COMMANDS.promisorConfig);
    if (promisor.failed || ![0, 1].includes(promisor.status)) {
      addFinding(findings, "object-safety-unavailable");
      return unavailable;
    }
    if (promisor.status === 0) {
      addFinding(findings, "promisor-lazy-fetch-unsafe");
      return unavailable;
    }
  }
  const executableFilters = readGit(READ_ONLY_GIT_COMMANDS.executableFilters);
  if (executableFilters.failed || ![0, 1].includes(executableFilters.status)) {
    addFinding(findings, "object-safety-unavailable");
    return unavailable;
  }
  if (executableFilters.status === 0) {
    addFinding(findings, "repository-filter-unsafe");
    return unavailable;
  }
  const headSha = oidFromProbe(readGit(READ_ONLY_GIT_COMMANDS.head));
  if (!headSha) addFinding(findings, "head-unavailable");
  const remoteProbe = readGit(READ_ONLY_GIT_COMMANDS.remoteNames);
  const originState = originRemoteState(remoteProbe);
  let originMainSha = null;
  if (originState === "unavailable") {
    addFinding(findings, "remote-inventory-unavailable");
  } else if (originState === "missing") {
    addFinding(findings, "missing-origin");
  } else {
    originMainSha = oidFromProbe(readGit(READ_ONLY_GIT_COMMANDS.originMain));
    if (!originMainSha) addFinding(findings, "origin-main-unavailable");
  }
  const statusProbe = readGit(READ_ONLY_GIT_COMMANDS.status);
  let clean = null;
  if (!successful(statusProbe)) {
    addFinding(findings, "status-unavailable");
  } else {
    clean = statusProbe.stdout.length === 0;
    if (!clean) addFinding(findings, "dirty-worktree");
  }
  const branchProbe = readGit(READ_ONLY_GIT_COMMANDS.branch);
  const branch = successful(branchProbe) ? singleLine(branchProbe.stdout) : null;
  if (!branch && branchProbe.status === 1 && !branchProbe.failed) {
    addFinding(findings, "detached-head");
  } else if (!branch) {
    addFinding(findings, "branch-unavailable");
  }
  else if (branch !== "main") addFinding(findings, "non-main-branch");
  const registrationState = currentRegistration({
    probe: readGit(READ_ONLY_GIT_COMMANDS.registration),
    root,
    rootAliases,
    branch,
    headSha,
    resolvePath,
  });
  const registered = registrationState === "valid";
  if (registrationState === "missing") {
    addFinding(findings, "missing-current-registration");
  } else if (registrationState === "invalid") {
    addFinding(findings, "invalid-current-registration");
  }
  const shallowProbe = readGit(READ_ONLY_GIT_COMMANDS.shallow);
  const shallowText = successful(shallowProbe)
    ? singleLine(shallowProbe.stdout)
    : null;
  const shallow = shallowText === "true"
    ? true
    : shallowText === "false" ? false : null;
  const relation = classifyRelation({
    headSha, originMainSha, shallow, readGit,
  });
  if (relation === "ahead") addFinding(findings, "ahead-of-origin-main");
  else if (relation === "behind") addFinding(findings, "behind-origin-main");
  else if (relation === "diverged") addFinding(findings, "divergent-main");
  else if (relation === "unavailable" && headSha && originMainSha) {
    addFinding(findings, "main-relation-unavailable");
  }
  return {
    branch,
    headSha,
    originMainSha,
    relation,
    clean,
    registered,
    canonical: branch === "main"
      && clean === true
      && registered
      && relation === "equal",
  };
}
export function inspectHybridWorkspace({
  cwd = process.cwd(),
  env = process.env,
  nodeVersion = process.versions.node,
  placementOverride,
  runGit = defaultRunGit,
  resolvePath = realpathSync,
} = {}) {
  const environment = { ...(env || {}) };
  const findings = [];
  const placementResult = resolvePlacement({ environment, placementOverride });
  if (placementResult.invalidOverride) {
    addFinding(findings, "invalid-placement-override");
  }
  if (!supportsNode22(nodeVersion)) {
    addFinding(findings, "unsupported-node-version");
  }
  const repository = inspectRepository({
    cwd,
    environment,
    runGit,
    resolvePath,
    findings,
  });
  return deepFreeze({
    schema: HYBRID_WORKSPACE_BOOTSTRAP_SCHEMA,
    status: findings.length === 0 ? "ready" : "blocked",
    placement: placementResult.placement,
    repository,
    lifecycle: DEFERRED_LIFECYCLE,
    findings,
    mutationAuthority: false,
  });
}
const USAGE =
  "Usage: cloud-workspace.mjs bootstrap [--json] [--placement=local|cloud]";
function parseArguments(argv) {
  if (argv[0] !== "bootstrap") throw new Error(USAGE);
  let json = false;
  let jsonSeen = false;
  let placementOverride;
  let placementSeen = false;
  for (const argument of argv.slice(1)) {
    if (argument === "--json" && !jsonSeen) {
      json = true;
      jsonSeen = true;
    } else if (argument.startsWith("--placement=") && !placementSeen) {
      placementSeen = true;
      placementOverride = argument.slice("--placement=".length);
    } else {
      throw new Error(USAGE);
    }
  }
  return { json, placementOverride };
}
function renderText(result) {
  const lines = [
    `workspace bootstrap: ${result.status}`,
    `placement: ${result.placement.kind} (${result.placement.source}, containerized=${result.placement.containerized})`,
    `repository: ${result.repository.canonical ? "canonical" : "blocked"} (${result.repository.relation})`,
    `lifecycle: ${result.lifecycle.status}`,
    "mutation authority: false",
  ];
  for (const finding of result.findings) {
    lines.push(`- ${finding.code}: ${finding.message}`);
  }
  return `${lines.join("\n")}\n`;
}
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === realpathSync(modulePath);
  } catch {
    return path.resolve(process.argv[1]) === modulePath;
  }
}
if (isDirectInvocation()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = inspectHybridWorkspace({
      placementOverride: options.placementOverride,
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderText(result),
    );
    process.exitCode = result.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `[cloud-workspace] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
