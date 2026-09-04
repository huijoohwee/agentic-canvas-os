import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readCommerceAdmissionAuthorityEvidence } from "../agent-api/src/commerce-admission-authority.js";
import { canonicalJson as canonicalAdmissionJson } from "../agent-api/src/commerce-admission-contract.js";
import {
  COMMERCE_RELEASE_PROOF_PATH, isCommerceReleaseProbeToken,
} from "../agent-api/src/commerce-release-proof.js";
import {
  ACOS_RELEASE_ARTIFACT_BOUNDS, webArtifactDigestFromDirectory,
} from "./acos-production-release-artifact.mjs";
import {
  ACTIVE_DEPLOYMENT_SCHEMA, PRODUCTION_AUTHORITY_SCHEMA, PRODUCTION_BRANCH,
  PRODUCTION_ENVIRONMENT, PRODUCTION_JOB, PRODUCTION_REPOSITORY, PRODUCTION_WORKER,
  PRODUCTION_WORKFLOW_PATH, VERSION_EVIDENCE_SCHEMA, createProductionCandidate,
  digestValue, exactDeployment, readProductionCandidate,
} from "./acos-production-release-contract.mjs";
import { validateProductionReleaseCandidate } from "./production-release-authorization-contract.mjs";
const execFileAsync = promisify(execFile);
const MAX_EVIDENCE_BYTES = 65_536;
const MAX_CONFIG_BYTES = 500_000;
const MAX_VERSION_RECORDS = 256;
const SUBPROCESS_TIMEOUT_MS = 300_000;
const STORAGE_FILES = Object.freeze([
  "worker/agent-state.js", "worker/canvas-room.js", "agent-api/src/adapter-registration.js",
  "agent-api/src/commerce-admission-authority.js", "agent-api/src/commerce-admission-contract.js",
  "agent-api/src/commerce-admission-provider.js", "agent-api/src/commerce-deployment-identity.js",
  "agent-api/src/durable-object-state-store.js",
]);
const DYNAMIC_VAR_NAMES = Object.freeze([
  "ACOS_CANDIDATE_DIGEST", "ACOS_SOURCE_REVISION", "AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE",
  "AGENTIC_OS_ADMISSION_AUTHORITY_REF", "AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF",
]);
const PLACEHOLDERS = Object.freeze({
  ACOS_CANDIDATE_DIGEST: "__PROTECTED_RELEASE_CANDIDATE_DIGEST__",
  ACOS_SOURCE_REVISION: "__PROTECTED_RELEASE_SOURCE_REVISION__",
  AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE: "__AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE__",
  AGENTIC_OS_ADMISSION_AUTHORITY_REF: "__AGENTIC_OS_ADMISSION_AUTHORITY_REF__",
  AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF: "__AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF__",
});
function requireValue(value, name, maximum = 4_096) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new TypeError(`${name} is missing or oversized.`);
  }
  return value.trim();
}
function sha256(text) { return createHash("sha256").update(text).digest("hex"); }
export { webArtifactDigestFromDirectory };
export function versionIdsByTag(body, tag) {
  const versions = body?.result?.items;
  if (body?.success !== true || !Array.isArray(versions)
    || versions.length > MAX_VERSION_RECORDS
    || versions.some((version) => typeof version?.id !== "string")) {
    throw new TypeError("Cloudflare deployable-version evidence is malformed or oversized.");
  }
  return versions
    .filter((version) => version?.annotations?.["workers/tag"] === tag)
    .map((version) => version.id);
}
async function run(program, args, { cwd, env = process.env } = {}) {
  try {
    const result = await execFileAsync(program, args, { cwd, env, encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024, timeout: SUBPROCESS_TIMEOUT_MS, killSignal: "SIGKILL" });
    return result.stdout.trim();
  } catch {
    throw new TypeError(`${program} ${args[0] ?? "command"} failed.`);
  }
}
async function git(args, repositoryRoot) {
  return run("git", args, { cwd: repositoryRoot });
}
function stripJsonComments(text) {
  let output = "", string = false, escaped = false, line = false, block = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index], next = text[index + 1];
    if (line) {
      if (current === "\n" || current === "\r") { line = false; output += current; }
      continue;
    }
    if (block) {
      if (current === "*" && next === "/") { block = false; output += " "; index += 1; }
      else if (current === "\n" || current === "\r") output += current;
      continue;
    }
    if (string) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') string = false;
      continue;
    }
    if (current === '"') { string = true; output += current; }
    else if (current === "/" && next === "/") { line = true; output += " "; index += 1; }
    else if (current === "/" && next === "*") { block = true; output += " "; index += 1; }
    else output += current;
  }
  if (string || block) throw new TypeError("wrangler.jsonc has an unterminated token.");
  return output;
}
function readJsonc(text) {
  if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new RangeError("wrangler.jsonc is oversized.");
  return JSON.parse(stripJsonComments(text));
}
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
function sortBindings(bindings) {
  return [...bindings].sort((left, right) => (
    `${left.name}\0${left.type}\0${JSON.stringify(left)}`
      .localeCompare(`${right.name}\0${right.type}\0${JSON.stringify(right)}`)
  ));
}
function assertProductionPlaceholders(config) {
  if (config?.name !== PRODUCTION_WORKER || typeof config.main !== "string"
    || typeof config.assets?.directory !== "string") {
    throw new TypeError("wrangler.jsonc does not describe the production Worker.");
  }
  for (const [name, placeholder] of Object.entries(PLACEHOLDERS)) {
    if (config.vars?.[name] !== placeholder) {
      throw new TypeError(`wrangler.jsonc placeholder drifted for ${name}.`);
    }
  }
}
function expectedBindings(config) {
  const bindings = [];
  for (const [name, text] of Object.entries(config.vars ?? {})) {
    bindings.push({
      name,
      type: "plain_text",
      text: DYNAMIC_VAR_NAMES.includes(name) ? `$release:${name}` : text,
    });
  }
  for (const name of config.secrets?.required ?? []) bindings.push({ name, type: "secret_text" });
  for (const item of config.durable_objects?.bindings ?? []) {
    bindings.push(compact({
      name: item.name, type: "durable_object_namespace", class_name: item.class_name,
      script_name: item.script_name, environment: item.environment,
    }));
  }
  for (const item of config.ratelimits ?? []) {
    bindings.push({ name: item.name, type: "ratelimit", namespace_id: item.namespace_id, simple: item.simple });
  }
  for (const item of config.services ?? []) {
    bindings.push(compact({
      name: item.binding, type: "service", service: item.service,
      environment: item.environment, entrypoint: item.entrypoint,
    }));
  }
  if (config.version_metadata?.binding) {
    bindings.push({ name: config.version_metadata.binding, type: "version_metadata" });
  }
  if (config.assets?.binding) bindings.push({ name: config.assets.binding, type: "assets" });
  return sortBindings(bindings);
}
function managedTopology(config, bindings = expectedBindings(config), script = null) {
  return {
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: [...(config.compatibility_flags ?? [])].sort(),
    script: script ?? {
      defaultHandlers: ["fetch"],
      namedHandlers: [{ name: "CommerceAdmissionProbe", handlers: ["fetch"] }],
      commerceAdmissionExport: { type: "worker", state: "created" },
    },
    bindings: sortBindings(bindings),
  };
}
export function bindingTopologyDigestFromConfig(config) {
  return digestValue(managedTopology(config));
}
function remoteBindingDescriptor(binding) {
  if (binding.type === "plain_text") {
    return {
      name: binding.name,
      type: binding.type,
      text: DYNAMIC_VAR_NAMES.includes(binding.name)
        ? `$release:${binding.name}`
        : binding.text ?? binding.value,
    };
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
    return { name: binding.name, type: binding.type,
      namespace_id: binding.namespace_id, simple: binding.simple };
  }
  if (binding.type === "service") {
    return compact({
      name: binding.name, type: binding.type, service: binding.service,
      environment: binding.environment, entrypoint: binding.entrypoint,
    });
  }
  return binding;
}
export function readRemoteBindingEvidence(raw, config) {
  const bindings = Array.isArray(raw?.resources?.bindings) ? raw.resources.bindings : [];
  const managedNames = new Set(expectedBindings(config).map((binding) => binding.name));
  const managed = bindings.filter((binding) => managedNames.has(binding?.name))
    .map(remoteBindingDescriptor);
  const runtime = raw?.resources?.script_runtime;
  const named = raw?.resources?.script?.named_handlers;
  const exportValue = runtime?.exports?.CommerceAdmissionProbe;
  const script = {
    defaultHandlers: [...(raw?.resources?.script?.handlers ?? [])].sort(),
    namedHandlers: Array.isArray(named)
      ? named.filter((item) => item?.name === "CommerceAdmissionProbe")
        .map((item) => ({ name: item.name, handlers: [...(item.handlers ?? [])].sort() }))
      : [],
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
function bindingText(bindings, name) {
  const matches = bindings.filter((binding) => binding?.name === name && binding?.type === "plain_text");
  return matches.length === 1 ? matches[0].text ?? matches[0].value ?? null : null;
}
export function validateGraphAuthorityEvidence(candidate, rawEvidence) {
  const evidence = readCommerceAdmissionAuthorityEvidence(rawEvidence, {
    authorityRef: candidate.graphAuthority.authorityRef,
    operatorInstructionRef: candidate.graphAuthority.operatorInstructionRef,
  });
  const observedAt = Date.now();
  if (!evidence
    || evidence.issuerRevision !== candidate.graphAuthority.issuerRevision
    || sha256(canonicalAdmissionJson(evidence)) !== candidate.graphAuthority.evidenceDigest
    || evidence.issuedAtMs > observedAt + 60_000
    || evidence.expiresAtMs <= observedAt) {
    throw new TypeError("Graph authority evidence does not match the sealed candidate.");
  }
  return evidence;
}
export function materializeProductionConfig(config, {
  repositoryRoot,
  candidate,
  graphAuthorityEvidence,
}) {
  assertProductionPlaceholders(config);
  validateGraphAuthorityEvidence(candidate, graphAuthorityEvidence);
  const ephemeral = structuredClone(config);
  delete ephemeral.$schema;
  delete ephemeral.env;
  ephemeral.main = path.resolve(repositoryRoot, config.main);
  ephemeral.assets.directory = path.resolve(repositoryRoot, config.assets.directory);
  ephemeral.vars = {
    ...ephemeral.vars,
    ACOS_SOURCE_REVISION: candidate.sourceRevision,
    ACOS_CANDIDATE_DIGEST: candidate.candidateDigest,
    AGENTIC_OS_ADMISSION_AUTHORITY_REF: candidate.graphAuthority.authorityRef,
    AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF: candidate.graphAuthority.operatorInstructionRef,
    AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE: graphAuthorityEvidence,
  };
  return ephemeral;
}
async function boundedJson(response, label) {
  if (!response.ok) throw new TypeError(`${label} failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BYTES) {
    throw new RangeError(`${label} is oversized.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError(`${label} has no body.`);
  const decoder = new TextDecoder();
  let size = 0, text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_EVIDENCE_BYTES) {
      await reader.cancel();
      throw new RangeError(`${label} is oversized.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { throw new TypeError(`${label} is not JSON.`); }
}
function releaseCandidateFromEnvironment(env) {
  const raw = requireValue(
    env.ACOS_AUTHORIZED_RELEASE_CANDIDATE_JSON,
    "ACOS_AUTHORIZED_RELEASE_CANDIDATE_JSON",
    MAX_EVIDENCE_BYTES,
  );
  let candidate;
  try { candidate = JSON.parse(raw); } catch {
    throw new TypeError("Authorized release candidate is not JSON.");
  }
  return validateProductionReleaseCandidate(candidate);
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
    || env.GITHUB_RUN_ATTEMPT !== "1"
    || env.ACOS_EXPECTED_SOURCE_REVISION !== sourceRevision) {
    throw new TypeError("Candidate is not the exact first-attempt protected-main GitHub source.");
  }
  const releaseCandidate = releaseCandidateFromEnvironment(env);
  if (releaseCandidate.agenticCanvasOs.repository !== PRODUCTION_REPOSITORY
    || releaseCandidate.agenticCanvasOs.revision !== sourceRevision
    || releaseCandidate.agenticCanvasOs.tree !== sourceTree) {
    throw new TypeError("Authorized artifact/manifest candidate does not match this ACOS tree.");
  }
  const wranglerText = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
  const wrangler = readJsonc(wranglerText);
  assertProductionPlaceholders(wrangler);
  const requiredSecrets = wrangler?.secrets?.required;
  if (!Array.isArray(requiredSecrets) || requiredSecrets.length === 0) {
    throw new TypeError("wrangler.jsonc must declare required production secrets.");
  }
  const storageSources = {};
  for (const relativePath of STORAGE_FILES) {
    storageSources[relativePath] = await readFile(path.join(root, relativePath), "utf8");
  }
  const candidate = createProductionCandidate({
    sourceRevision,
    sourceTree,
    configurationDigest: sha256(wranglerText),
    bindingTopologyDigest: bindingTopologyDigestFromConfig(wrangler),
    storageCompatibilityRevision: digestValue({
      durableObjects: wrangler.durable_objects,
      migrations: wrangler.migrations,
      sources: storageSources,
    }),
    webArtifactDigest: await webArtifactDigestFromDirectory(path.join(root, "web/dist")),
    requiredSecrets,
    releaseCandidate,
    graphAuthority: {
      authorityRef: requireValue(env.ACOS_GRAPH_AUTHORITY_REF, "ACOS_GRAPH_AUTHORITY_REF"),
      operatorInstructionRef: requireValue(env.ACOS_GRAPH_OPERATOR_INSTRUCTION_REF,
        "ACOS_GRAPH_OPERATOR_INSTRUCTION_REF"),
      issuerRevision: requireValue(env.ACOS_GRAPH_AUTHORITY_ISSUER_REVISION, "ACOS_GRAPH_AUTHORITY_ISSUER_REVISION"),
      evidenceDigest: requireValue(env.ACOS_GRAPH_AUTHORITY_EVIDENCE_DIGEST, "ACOS_GRAPH_AUTHORITY_EVIDENCE_DIGEST"),
    },
    publicReadyOrigin: requireValue(env.ACOS_PUBLIC_READY_ORIGIN, "ACOS_PUBLIC_READY_ORIGIN"),
  });
  if (candidate.candidateDigest !== env.ACOS_EXPECTED_CANDIDATE_DIGEST) {
    throw new TypeError("Computed deployment candidate digest does not match the dispatch input.");
  }
  return candidate;
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
    schema: PRODUCTION_AUTHORITY_SCHEMA, repository,
    environment: environment?.name, environmentId: environment?.id,
    reviewerId: approval?.user?.id, reviewerLogin: approval?.user?.login,
    runId, jobStartedAt: job?.started_at,
    runAttempt: runEvidence?.run_attempt, event: runEvidence?.event,
    headBranch: runEvidence?.head_branch, headSha: runEvidence?.head_sha,
    workflowPath: runEvidence?.path, jobId: job?.id,
    jobName: job?.name, jobStatus: job?.status,
    branchProtected: branch?.protected === true && branch?.commit?.sha === candidate.sourceRevision,
  };
}
export function createLiveReleaseAdapters({ repositoryRoot, env = process.env }) {
  const root = path.resolve(repositoryRoot);
  const cloudflareToken = requireValue(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  const accountId = requireValue(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const releaseProbeToken = requireValue(env.ACOS_RELEASE_PROBE_TOKEN, "ACOS_RELEASE_PROBE_TOKEN");
  if (!isCommerceReleaseProbeToken(releaseProbeToken)) {
    throw new TypeError("ACOS_RELEASE_PROBE_TOKEN does not meet the release-proof contract.");
  }
  const rawGraphEvidence = requireValue(env.AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE,
    "AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE", MAX_EVIDENCE_BYTES);
  const rawRecovery = env.ACOS_PRESERVE_RECEIPT_JSON?.trim() ?? "";
  if (rawRecovery.length > MAX_EVIDENCE_BYTES) throw new RangeError("Preserve receipt is oversized.");
  let recoveryReceipt = null;
  try { recoveryReceipt = rawRecovery ? JSON.parse(rawRecovery) : null; } catch {
    throw new TypeError("Preserve receipt is not JSON.");
  }
  const checkedConfigPath = path.join(root, "wrangler.jsonc");
  const productionConfig = readFile(checkedConfigPath, "utf8").then(readJsonc);
  async function deployableVersions() {
    const pathname = `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${PRODUCTION_WORKER}/versions?deployable=true`;
    return boundedJson(await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
      headers: { authorization: `Bearer ${cloudflareToken}` },
      signal: AbortSignal.timeout(15_000),
    }), "Cloudflare deployable-version list");
  }
  async function wrangler(args, configPath = checkedConfigPath, extraEnv = {}) {
    const stdout = await run("npx", ["wrangler", ...args, "--env", "", "--config", configPath], {
      cwd: root,
      env: { ...env, ...extraEnv },
    });
    try { return JSON.parse(stdout); } catch {
      throw new TypeError(`Wrangler returned malformed JSON for ${args[0]}.`);
    }
  }
  async function viewVersion(versionId) {
    return wrangler(["versions", "view", versionId, "--name", PRODUCTION_WORKER, "--json"]);
  }
  async function normalizedVersion(versionId, candidate, baselineUnmanagedBindingsDigest) {
    const raw = await viewVersion(versionId);
    const bindings = Array.isArray(raw?.resources?.bindings) ? raw.resources.bindings : [];
    const remoteEvidence = bindingText(bindings, "AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE");
    let graphAuthority = null;
    try {
      const evidence = validateGraphAuthorityEvidence(candidate, remoteEvidence);
      graphAuthority = {
        authorityRef: bindingText(bindings, "AGENTIC_OS_ADMISSION_AUTHORITY_REF"),
        operatorInstructionRef: bindingText(bindings, "AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF"),
        issuerRevision: evidence.issuerRevision, evidenceDigest: sha256(canonicalAdmissionJson(evidence)),
      };
    } catch {}
    const bindingEvidence = readRemoteBindingEvidence(raw, await productionConfig);
    return {
      schema: VERSION_EVIDENCE_SCHEMA, versionId: raw?.id,
      versionTag: raw?.annotations?.["workers/tag"], versionTimestamp: raw?.metadata?.created_on,
      sourceRevision: bindingText(bindings, "ACOS_SOURCE_REVISION"),
      candidateDigest: bindingText(bindings, "ACOS_CANDIDATE_DIGEST"), graphAuthority,
      bindingTopologyDigest: bindingEvidence.bindingTopologyDigest, baselineUnmanagedBindingsDigest,
      preservedUnmanagedBindingsDigest: bindingEvidence.unmanagedBindingsDigest,
      versionMetadataBindings: bindings.filter((binding) => (
        binding?.name === "CF_VERSION_METADATA" && binding?.type === "version_metadata"
      )).length,
      secretNames: bindings
        .filter((binding) => binding?.type === "secret_text"
          && typeof binding.name === "string"
          && candidate.requiredSecrets.includes(binding.name))
        .map((binding) => binding.name)
        .sort(),
    };
  }
  async function readActiveDeployment() {
    const raw = await wrangler(["deployments", "status", "--name", PRODUCTION_WORKER, "--json"]);
    if (!Array.isArray(raw?.versions) || raw.versions.length !== 1) return null;
    const traffic = raw.versions[0];
    const version = await viewVersion(traffic.version_id);
    const bindingEvidence = readRemoteBindingEvidence(version, await productionConfig);
    return {
      schema: ACTIVE_DEPLOYMENT_SCHEMA, deploymentId: raw.id,
      versionId: traffic.version_id, percentage: traffic.percentage,
      unmanagedBindingsDigest: bindingEvidence.unmanagedBindingsDigest,
    };
  }
  async function deployIfBaseline({ expected, targetVersionId }) {
    const current = await readActiveDeployment();
    if (!exactDeployment(expected, current)) {
      throw Object.assign(new Error("Active deployment changed before mutation."), {
        code: "active_baseline_compare_failed",
      });
    }
    await run("npx", [
      "wrangler", "versions", "deploy", `${targetVersionId}@100%`,
      "--name", PRODUCTION_WORKER,
      "--message", `activate exact protected version ${targetVersionId}`,
      "--yes",
      "--env", "",
      "--config", checkedConfigPath,
    ], { cwd: root, env });
    return readActiveDeployment();
  }
  return Object.freeze({
    readProductionAuthority: (candidate) => {
      validateGraphAuthorityEvidence(candidate, rawGraphEvidence);
      return readProductionAuthority(env, candidate);
    },
    readActiveDeployment,
    readForwardRecoveryReceipt: async () => recoveryReceipt,
    async findVersionsByTag(tag) {
      return versionIdsByTag(await deployableVersions(), tag);
    },
    readVersionById: ({ candidate, versionId, unmanagedBindingsDigest }) => (
      normalizedVersion(versionId, candidate, unmanagedBindingsDigest)
    ),
    async uploadInactive({ candidate, tag, flags, unmanagedBindingsDigest }) {
      if (flags.join("|") !== "--strict|--keep-vars") throw new TypeError("Required upload flags drifted.");
      if (!/^[0-9a-f]{64}$/u.test(unmanagedBindingsDigest ?? "")) {
        throw new TypeError("Inactive upload has no exact predecessor binding digest.");
      }
      const exactCandidate = readProductionCandidate(candidate);
      if (!exactCandidate || tag !== `acos-prod-${candidate.candidateDigest}`) {
        throw new TypeError("Inactive upload candidate drifted.");
      }
      const temporary = await mkdtemp(path.join(os.tmpdir(), "acos-production-release-"));
      const configPath = path.join(temporary, "wrangler.production.json");
      const outputPath = path.join(temporary, "wrangler-output.ndjson");
      try {
        const materialized = materializeProductionConfig(await productionConfig, {
          repositoryRoot: root, candidate, graphAuthorityEvidence: rawGraphEvidence,
        });
        await writeFile(configPath, `${JSON.stringify(materialized, null, 2)}\n`, {
          encoding: "utf8", flag: "wx", mode: 0o600,
        });
        await run("npx", [
          "wrangler", "versions", "upload",
          "--name", PRODUCTION_WORKER,
          "--strict",
          "--keep-vars",
          "--env", "",
          "--tag", tag,
          "--message", `protected candidate ${candidate.candidateDigest}`,
          "--config", configPath,
        ], {
          cwd: root,
          env: { ...env, WRANGLER_OUTPUT_FILE_PATH: outputPath },
        });
        const output = await readFile(outputPath, "utf8");
        if (Buffer.byteLength(output) > MAX_EVIDENCE_BYTES) {
          throw new RangeError("Wrangler upload evidence is oversized.");
        }
        const lines = output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const uploaded = lines.find((entry) => entry?.type === "version-upload" && entry?.version === 1);
        if (!uploaded?.version_id) throw new TypeError("Wrangler upload emitted no version id.");
        return await normalizedVersion(uploaded.version_id, candidate, unmanagedBindingsDigest);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
    activateExact: deployIfBaseline,
    async probeProductionReadiness(candidate) {
      validateGraphAuthorityEvidence(candidate, rawGraphEvidence);
      const url = `${candidate.publicReadyOrigin}${COMMERCE_RELEASE_PROOF_PATH}`;
      return boundedJson(await fetch(url, {
        headers: { authorization: `Bearer ${releaseProbeToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }), "authenticated production readyz");
    },
  });
}
export const ACOS_RELEASE_LIVE_DEFAULTS = Object.freeze({
  maxEvidenceBytes: MAX_EVIDENCE_BYTES,
  maxConfigBytes: MAX_CONFIG_BYTES,
  maxVersionRecords: MAX_VERSION_RECORDS,
  storageFiles: STORAGE_FILES,
  dynamicVariableNames: DYNAMIC_VAR_NAMES,
  artifactBounds: ACOS_RELEASE_ARTIFACT_BOUNDS,
});
