import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  ACTIVE_DEPLOYMENT_SCHEMA,
  PRODUCTION_AUTHORITY_SCHEMA,
  PRODUCTION_BRANCH,
  PRODUCTION_ENVIRONMENT,
  PRODUCTION_JOB,
  PRODUCTION_REPOSITORY,
  PRODUCTION_WORKER,
  PRODUCTION_WORKFLOW_PATH,
  VERSION_EVIDENCE_SCHEMA,
  createProductionCandidate,
  digestValue,
  exactDeployment,
} from "./acos-production-release-contract.mjs";
import { COMMERCE_RELEASE_PROOF_PATH } from "../agent-api/src/commerce-release-proof.js";

const execFileAsync = promisify(execFile);
const MAX_EVIDENCE_BYTES = 65_536;
const SUBPROCESS_TIMEOUT_MS = 300_000;
const STORAGE_FILES = Object.freeze([
  "worker/agent-state.js",
  "worker/canvas-room.js",
  "agent-api/src/durable-object-state-store.js",
]);
const DYNAMIC_VAR_NAMES = Object.freeze([
  "ACOS_CANDIDATE_DIGEST",
  "ACOS_CONFIGURATION_DIGEST",
  "ACOS_SOURCE_REVISION",
  "ACOS_STORAGE_COMPATIBILITY_REVISION",
  "ACOS_UNMANAGED_BINDINGS_DIGEST",
]);

function requireValue(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required.`);
  return value.trim();
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function run(program, args, { cwd, env = process.env } = {}) {
  const result = await execFileAsync(program, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: SUBPROCESS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return result.stdout.trim();
}

async function git(args, repositoryRoot) {
  return run("git", args, { cwd: repositoryRoot });
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function sortBindings(bindings) {
  return [...bindings].sort((left, right) => (
    `${left.name}\0${left.type}\0${JSON.stringify(left)}`.localeCompare(`${right.name}\0${right.type}\0${JSON.stringify(right)}`)
  ));
}

function expectedBindings(config) {
  const bindings = [];
  for (const [name, text] of Object.entries(config.vars ?? {})) {
    bindings.push({ name, type: "plain_text", text: DYNAMIC_VAR_NAMES.includes(name) ? `$release:${name}` : text });
  }
  for (const name of config.secrets?.required ?? []) bindings.push({ name, type: "secret_text" });
  for (const item of config.durable_objects?.bindings ?? []) {
    bindings.push(compact({
      name: item.name,
      type: "durable_object_namespace",
      class_name: item.class_name,
      script_name: item.script_name,
      environment: item.environment,
    }));
  }
  for (const item of config.ratelimits ?? []) {
    bindings.push({ name: item.name, type: "ratelimit", namespace_id: item.namespace_id, simple: item.simple });
  }
  for (const item of config.services ?? []) {
    bindings.push(compact({
      name: item.binding,
      type: "service",
      service: item.service,
      environment: item.environment,
      entrypoint: item.entrypoint,
    }));
  }
  if (config.version_metadata?.binding) bindings.push({ name: config.version_metadata.binding, type: "version_metadata" });
  if (config.assets?.binding) bindings.push({ name: config.assets.binding, type: "assets" });
  return sortBindings(bindings);
}

function managedTopology(config, bindings = expectedBindings(config), script = null) {
  const expectedScript = script ?? {
    defaultHandlers: ["fetch"],
    namedHandlers: [{ name: "CommerceAdmissionProbe", handlers: ["fetch"] }],
    commerceAdmissionExport: { type: "worker", state: "created" },
  };
  return {
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: [...(config.compatibility_flags ?? [])].sort(),
    script: expectedScript,
    bindings: sortBindings(bindings),
  };
}

export function bindingTopologyDigestFromConfig(config) {
  return digestValue(managedTopology(config));
}

function dynamicValues(candidate) {
  return {
    ACOS_CANDIDATE_DIGEST: candidate.candidateDigest,
    ACOS_CONFIGURATION_DIGEST: candidate.configurationDigest,
    ACOS_SOURCE_REVISION: candidate.sourceRevision,
    ACOS_STORAGE_COMPATIBILITY_REVISION: candidate.storageCompatibilityRevision,
    ACOS_UNMANAGED_BINDINGS_DIGEST: candidate.unmanagedBindingsDigest,
  };
}

function remoteBindingDescriptor(binding, candidate) {
  if (binding.type === "plain_text") {
    const expected = dynamicValues(candidate)[binding.name];
    return { name: binding.name, type: binding.type, text: expected === binding.text ? `$release:${binding.name}` : binding.text };
  }
  if (["secret_text", "version_metadata", "assets"].includes(binding.type)) {
    return { name: binding.name, type: binding.type };
  }
  if (binding.type === "durable_object_namespace") {
    return compact({
      name: binding.name, type: binding.type, class_name: binding.class_name,
      script_name: binding.script_name, environment: binding.environment,
    });
  }
  if (binding.type === "ratelimit") {
    return { name: binding.name, type: binding.type, namespace_id: binding.namespace_id, simple: binding.simple };
  }
  if (binding.type === "service") {
    return compact({
      name: binding.name, type: binding.type, service: binding.service,
      environment: binding.environment, entrypoint: binding.entrypoint,
    });
  }
  return binding;
}

export function readRemoteBindingEvidence(raw, candidate, config) {
  const bindings = Array.isArray(raw?.resources?.bindings) ? raw.resources.bindings : [];
  const managedNames = new Set(expectedBindings(config).map((binding) => binding.name));
  const managed = bindings.filter((binding) => managedNames.has(binding?.name)).map((binding) => (
    remoteBindingDescriptor(binding, candidate)
  ));
  const runtime = raw?.resources?.script_runtime;
  const named = raw?.resources?.script?.named_handlers;
  const exportValue = runtime?.exports?.CommerceAdmissionProbe;
  const script = {
    defaultHandlers: [...(raw?.resources?.script?.handlers ?? [])].sort(),
    namedHandlers: Array.isArray(named) ? named.filter((item) => item?.name === "CommerceAdmissionProbe").map((item) => ({
      name: item.name,
      handlers: [...(item.handlers ?? [])].sort(),
    })) : [],
    commerceAdmissionExport: exportValue?.type === "worker"
      ? { type: "worker", state: exportValue.state ?? "created" }
      : null,
  };
  const topology = managedTopology({
    compatibility_date: runtime?.compatibility_date,
    compatibility_flags: runtime?.compatibility_flags,
  }, managed, script);
  const unmanaged = bindings.filter((binding) => !managedNames.has(binding?.name));
  return Object.freeze({
    bindingTopologyDigest: digestValue(topology),
    unmanagedBindingsDigest: digestValue(sortBindings(unmanaged)),
  });
}

async function boundedJson(response, label) {
  if (!response.ok) throw new TypeError(`${label} failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BYTES) throw new RangeError(`${label} is oversized.`);
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError(`${label} has no body.`);
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_EVIDENCE_BYTES) { await reader.cancel(); throw new RangeError(`${label} is oversized.`); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new TypeError(`${label} is not JSON.`); }
}

export async function createCandidateFromProtectedMain({ repositoryRoot, env = process.env }) {
  const root = path.resolve(repositoryRoot);
  const sourceRevision = await git(["rev-parse", "HEAD"], root);
  const sourceTree = await git(["rev-parse", "HEAD^{tree}"], root);
  const status = await git(["status", "--porcelain=v1", "--untracked-files=all"], root);
  if (status) throw new TypeError("Protected production candidate checkout is dirty.");
  if (env.GITHUB_REPOSITORY !== PRODUCTION_REPOSITORY
    || env.GITHUB_REF !== `refs/heads/${PRODUCTION_BRANCH}`
    || env.GITHUB_SHA !== sourceRevision
    || env.GITHUB_RUN_ATTEMPT !== "1") {
    throw new TypeError("Candidate is not the exact first-attempt protected-main GitHub source.");
  }
  const wranglerText = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
  const wrangler = JSON.parse(stripJsonComments(wranglerText));
  const requiredSecrets = wrangler?.secrets?.required;
  if (!Array.isArray(requiredSecrets) || requiredSecrets.length === 0) {
    throw new TypeError("wrangler.jsonc must declare required production secrets.");
  }
  const storageSources = {};
  for (const relativePath of STORAGE_FILES) {
    storageSources[relativePath] = await readFile(path.join(root, relativePath), "utf8");
  }
  return createProductionCandidate({
    sourceRevision,
    sourceTree,
    configurationDigest: sha256(wranglerText),
    bindingTopologyDigest: bindingTopologyDigestFromConfig(wrangler),
    storageCompatibilityRevision: digestValue({
      durableObjects: wrangler.durable_objects,
      migrations: wrangler.migrations,
      sources: storageSources,
    }),
    requiredSecrets,
  });
}

async function githubJson(env, pathname) {
  const token = requireValue(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  return boundedJson(await fetch(`https://api.github.com${pathname}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "agentic-canvas-os-protected-release",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  }), `GitHub ${pathname}`);
}

async function readProductionAuthority(env, candidate) {
  const runId = Number(requireValue(env.GITHUB_RUN_ID, "GITHUB_RUN_ID"));
  const repository = requireValue(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  if (repository !== PRODUCTION_REPOSITORY || env.GITHUB_JOB !== PRODUCTION_JOB) {
    throw new TypeError("Production release is outside its authenticated job.");
  }
  const [runEvidence, approvals, jobs, branch] = await Promise.all([
    githubJson(env, `/repos/${repository}/actions/runs/${runId}`),
    githubJson(env, `/repos/${repository}/actions/runs/${runId}/approvals`),
    githubJson(env, `/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`),
    githubJson(env, `/repos/${repository}/branches/${PRODUCTION_BRANCH}`),
  ]);
  const approval = Array.isArray(approvals) ? approvals.find((review) => (
    review?.state === "approved"
    && review?.user?.type === "User"
    && review.environments?.some((environment) => environment?.name === PRODUCTION_ENVIRONMENT)
  )) : null;
  const environment = approval?.environments?.find((item) => item?.name === PRODUCTION_ENVIRONMENT);
  const job = jobs?.jobs?.find((item) => item?.name === PRODUCTION_JOB && item?.run_id === runId);
  return {
    schema: PRODUCTION_AUTHORITY_SCHEMA,
    repository,
    environment: environment?.name,
    environmentId: environment?.id,
    reviewerId: approval?.user?.id,
    reviewerLogin: approval?.user?.login,
    reviewedAt: approval?.submitted_at ?? approval?.reviewed_at,
    runId,
    runAttempt: runEvidence?.run_attempt,
    event: runEvidence?.event,
    headBranch: runEvidence?.head_branch,
    headSha: runEvidence?.head_sha,
    workflowPath: runEvidence?.path,
    jobId: job?.id,
    jobName: job?.name,
    jobStatus: job?.status,
    branchProtected: branch?.protected === true && branch?.commit?.sha === candidate.sourceRevision,
  };
}

function bindingText(bindings, name) {
  const matches = bindings.filter((binding) => binding?.name === name && binding?.type === "plain_text");
  if (matches.length !== 1) return null;
  return matches[0].text ?? matches[0].value ?? null;
}

export function createLiveReleaseAdapters({ repositoryRoot, env = process.env }) {
  const root = path.resolve(repositoryRoot);
  requireValue(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  requireValue(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const productionConfig = readFile(path.join(root, "wrangler.jsonc"), "utf8").then((text) => (
    JSON.parse(stripJsonComments(text))
  ));
  async function wrangler(args, extraEnv = {}) {
    const stdout = await run("npx", ["wrangler", ...args], {
      cwd: root,
      env: { ...env, ...extraEnv },
    });
    try { return JSON.parse(stdout); } catch { throw new TypeError(`Wrangler returned malformed JSON for ${args[0]}.`); }
  }

  async function viewVersion(versionId) {
    return wrangler(["versions", "view", versionId, "--name", PRODUCTION_WORKER, "--json"]);
  }

  async function normalizedVersion(versionId, expectedCandidate = null, baselineUnmanagedBindingsDigest = null) {
    const raw = await viewVersion(versionId);
    const bindings = Array.isArray(raw?.resources?.bindings) ? raw.resources.bindings : [];
    const observedCandidate = {
      sourceRevision: bindingText(bindings, "ACOS_SOURCE_REVISION"),
      candidateDigest: bindingText(bindings, "ACOS_CANDIDATE_DIGEST"),
      configurationDigest: bindingText(bindings, "ACOS_CONFIGURATION_DIGEST"),
      storageCompatibilityRevision: bindingText(bindings, "ACOS_STORAGE_COMPATIBILITY_REVISION"),
      unmanagedBindingsAttestationDigest: bindingText(bindings, "ACOS_UNMANAGED_BINDINGS_DIGEST"),
    };
    const bindingEvidence = readRemoteBindingEvidence(
      raw,
      expectedCandidate ?? observedCandidate,
      await productionConfig,
    );
    return {
      schema: VERSION_EVIDENCE_SCHEMA,
      versionId: raw?.id,
      versionTag: raw?.annotations?.["workers/tag"],
      versionTimestamp: raw?.metadata?.created_on,
      ...observedCandidate,
      bindingTopologyDigest: bindingEvidence.bindingTopologyDigest,
      baselineUnmanagedBindingsDigest,
      preservedUnmanagedBindingsDigest: bindingEvidence.unmanagedBindingsDigest,
      versionMetadataBindings: bindings.filter((binding) => (
        binding?.name === "CF_VERSION_METADATA" && binding?.type === "version_metadata"
      )).length,
      secretNames: bindings
        .filter((binding) => binding?.type === "secret_text"
          && typeof binding.name === "string"
          && (!expectedCandidate || expectedCandidate.requiredSecrets.includes(binding.name)))
        .map((binding) => binding.name)
        .sort(),
    };
  }

  async function readActiveDeployment() {
    const raw = await wrangler(["deployments", "status", "--name", PRODUCTION_WORKER, "--json"]);
    if (!Array.isArray(raw?.versions) || raw.versions.length !== 1) return null;
    const traffic = raw.versions[0];
    const version = await normalizedVersion(traffic.version_id);
    const releasePins = [
      /^[0-9a-f]{40}$/u.test(version.sourceRevision ?? ""),
      /^[0-9a-f]{64}$/u.test(version.candidateDigest ?? ""),
      /^[0-9a-f]{64}$/u.test(version.configurationDigest ?? ""),
      /^[0-9a-f]{64}$/u.test(version.storageCompatibilityRevision ?? ""),
    ];
    const attestation = /^[0-9a-f]{64}$/u.test(version.unmanagedBindingsAttestationDigest ?? "")
      ? version.unmanagedBindingsAttestationDigest
      : null;
    const releaseManaged = releasePins.some(Boolean) || attestation !== null;
    return {
      schema: ACTIVE_DEPLOYMENT_SCHEMA,
      deploymentId: raw.id,
      versionId: traffic.version_id,
      percentage: traffic.percentage,
      storageCompatibilityRevision: version.storageCompatibilityRevision,
      releaseManaged,
      unmanagedBindingsDigest: version.preservedUnmanagedBindingsDigest,
      unmanagedBindingsAttestationDigest: attestation,
    };
  }

  async function deployIfBaseline({ expected, targetVersionId, message }) {
    const current = await readActiveDeployment();
    if (!exactDeployment(expected, current)) {
      throw Object.assign(new Error("Active deployment changed before mutation."), {
        code: "active_baseline_compare_failed",
      });
    }
    await run("npx", [
      "wrangler", "versions", "deploy", `${targetVersionId}@100%`, "--name", PRODUCTION_WORKER,
      "--message", message, "--yes",
    ], { cwd: root, env });
    return readActiveDeployment();
  }

  async function probe(url, token, label) {
    return boundedJson(await fetch(requireValue(url, `${label} URL`), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    }), label);
  }

  return Object.freeze({
    readProductionAuthority: (candidate) => readProductionAuthority(env, candidate),
    readActiveDeployment,
    async findVersionsByTag(tag) {
      const versions = await wrangler(["versions", "list", "--name", PRODUCTION_WORKER, "--json"]);
      if (!Array.isArray(versions)) throw new TypeError("Wrangler version list is malformed.");
      return versions.filter((version) => version?.annotations?.["workers/tag"] === tag).map((version) => version.id);
    },
    async uploadInactive({ candidate, tag, flags, unmanagedBindingsDigest }) {
      if (flags.join("|") !== "--strict|--keep-vars") throw new TypeError("Required upload flags drifted.");
      if (!/^[0-9a-f]{64}$/u.test(unmanagedBindingsDigest ?? "")) {
        throw new TypeError("The inactive upload has no exact predecessor binding digest.");
      }
      const boundCandidate = { ...candidate, unmanagedBindingsDigest };
      const temporary = await mkdtemp(path.join(os.tmpdir(), "acos-release-"));
      const outputPath = path.join(temporary, "wrangler-output.ndjson");
      await run("npx", [
        "wrangler", "versions", "upload", "--name", PRODUCTION_WORKER,
        "--strict", "--keep-vars", "--tag", tag,
        "--message", `protected candidate ${candidate.candidateDigest}`,
        "--var", `ACOS_SOURCE_REVISION:${candidate.sourceRevision}`,
        "--var", `ACOS_CANDIDATE_DIGEST:${candidate.candidateDigest}`,
        "--var", `ACOS_CONFIGURATION_DIGEST:${candidate.configurationDigest}`,
        "--var", `ACOS_STORAGE_COMPATIBILITY_REVISION:${candidate.storageCompatibilityRevision}`,
        "--var", `ACOS_UNMANAGED_BINDINGS_DIGEST:${unmanagedBindingsDigest}`,
      ], { cwd: root, env: { ...env, WRANGLER_OUTPUT_FILE_PATH: outputPath } });
      const lines = (await readFile(outputPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
      await unlink(outputPath);
      const uploaded = lines.find((entry) => entry?.type === "version-upload" && entry?.version === 1);
      if (!uploaded?.version_id) throw new TypeError("Wrangler upload emitted no version id.");
      return normalizedVersion(uploaded.version_id, boundCandidate, unmanagedBindingsDigest);
    },
    activateIfBaseline: ({ expected, targetVersionId }) => deployIfBaseline({
      expected, targetVersionId, message: `activate protected candidate ${targetVersionId}`,
    }),
    rollbackIfBaseline: ({ expected, targetVersionId }) => deployIfBaseline({
      expected, targetVersionId, message: `rollback to exact predecessor ${targetVersionId}`,
    }),
    probePublicReadiness: () => probe(env.ACOS_PUBLIC_READY_URL, null, "public readiness"),
    probePrivateAdmissionReadiness: () => probe(
      new URL(COMMERCE_RELEASE_PROOF_PATH, requireValue(env.ACOS_PUBLIC_READY_URL, "ACOS_PUBLIC_READY_URL")).href,
      requireValue(env.ACOS_RELEASE_PROBE_TOKEN, "ACOS_RELEASE_PROBE_TOKEN"),
      "private loopback service-bound admission readiness",
    ),
  });
}

export const ACOS_RELEASE_LIVE_DEFAULTS = Object.freeze({
  maxEvidenceBytes: MAX_EVIDENCE_BYTES,
  storageFiles: STORAGE_FILES,
});
