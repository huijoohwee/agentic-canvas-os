#!/usr/bin/env node
// Responsibility: transport external evidence and exact authorization to the batch controller.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

const COMMAND_SCHEMA = "agentic-canonical-squash-batch-terminalizer-v2-command/v1";
const INSTALLED_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OPTIONS = new Set([
  "repository", "controller-root", "state-path", "evidence-manifest",
  "capabilities-manifest", "plan-digest", "auth-file", "json",
]);

export function normalizeV2EvidenceItem(value, fixed, { terminalCloud } = {}) {
  eObject(value, "subject evidence");
  eKeys(value, ["pullRequest", "branch", "worktreePath", "sourceCommit",
    "protectedCommit", "message", "checks", "lease", "taskAuthority", "cloud",
    "integration"], "subject evidence");
  const pullRequest = normalizeEvidencePull(value.pullRequest, fixed);
  if (value.branch !== fixed.branch || value.worktreePath.split("/").at(-1)
    !== fixed.worktreeBasename) eInvalid("fixed subject lane identity");
  const sourceCommit = normalizeEvidenceCommit(value.sourceCommit, {
    label: "source", sha: fixed.headSha, treeSha: fixed.treeSha,
    parentShas: fixed.sourceParentShas, messageDigest: fixed.sourceMessageDigest,
    rawSha256: fixed.sourceRawSha256, rawBytes: fixed.sourceRawBytes,
    terminalLf: true, verificationDigest: fixed.sourceVerificationDigest,
  });
  const protectedCommit = normalizeEvidenceCommit(value.protectedCommit, {
    label: "protected", sha: fixed.mergeSha, treeSha: fixed.treeSha,
    parentShas: [fixed.baseSha], messageDigest: fixed.protectedMessageDigest,
    rawSha256: fixed.protectedRawSha256, rawBytes: fixed.protectedRawBytes,
    terminalLf: false, verificationDigest: fixed.protectedVerificationDigest,
  });
  const message = normalizeEvidenceMessage(value.message, sourceCommit,
    protectedCommit, fixed);
  const checks = normalizeEvidenceChecks(value.checks, pullRequest, fixed);
  const lease = normalizeEvidenceLease(value.lease, pullRequest, value.branch,
    value.worktreePath, fixed);
  const taskAuthority = normalizeEvidenceTask(value.taskAuthority, lease, fixed);
  const cloud = normalizeEvidenceCloud(value.cloud, lease, fixed, terminalCloud);
  const integration = normalizeEvidenceIntegration(value.integration, fixed);
  return eFreeze({ pullRequest, branch: value.branch, worktreePath: value.worktreePath,
    sourceCommit, protectedCommit, message, checks, lease, taskAuthority, cloud,
    integration });
}

export function normalizeV2EvidenceManifest(value, fixedSubjects) {
  eKeys(value, ["schema", "bridge", "subjects"], "evidence manifest");
  if (value.schema !== "agentic-canonical-squash-batch-terminalizer-v2-evidence-manifest/v1") {
    throw new Error("Evidence manifest schema is invalid.");
  }
  eKeys(value.bridge, ["pullRequest", "cleanupOperationId"], "evidence bridge");
  if (value.bridge.pullRequest !== 839) throw new Error("Bridge must be this controller PR 839.");
  eDigest(value.bridge.cleanupOperationId, "bridge cleanup operation id");
  if (!Array.isArray(value.subjects) || value.subjects.length !== fixedSubjects.length) {
    throw new Error("Evidence manifest must contain one distinct bridge and eight subjects.");
  }
  const subjects = value.subjects.map((subject, index) => {
    const fixed = fixedSubjects[index];
    eKeys(subject, ["pullRequest", "reviewedRunId", "postMainRunId"], "evidence subject");
    if (subject.pullRequest !== fixed.pullRequest || subject.reviewedRunId !== fixed.reviewedRunId
      || subject.postMainRunId !== fixed.postMainRunId) {
      throw new Error("Evidence subjects must retain the exact fixed PR/run order.");
    }
    return eFreeze(structuredClone(subject));
  });
  return eFreeze({ schema: value.schema, bridge: structuredClone(value.bridge), subjects });
}

export function normalizeV2CapabilityManifest(value, fixedPullRequests, { optional = false } = {}) {
  if (value === null && optional) return null;
  eKeys(value, ["schema", "items"], "capability manifest");
  if (value.schema !== "agentic-canonical-squash-batch-terminalizer-v2-capabilities/v1"
    || !Array.isArray(value.items) || value.items.length !== fixedPullRequests.length) {
    throw new Error("Capability manifest identity is invalid.");
  }
  const paths = new Set();
  const items = value.items.map((item, index) => {
    eKeys(item, ["pullRequest", "capabilityPath"], "capability item");
    if (item.pullRequest !== fixedPullRequests[index]
      || typeof item.capabilityPath !== "string" || !path.isAbsolute(item.capabilityPath)
      || paths.has(item.capabilityPath)) throw new Error("Capability items are invalid or reused.");
    paths.add(item.capabilityPath); return eFreeze(structuredClone(item));
  });
  return eFreeze({ schema: value.schema, items });
}

export function readV2JoinedCommit({ root, target, sha, ghText, verified, reason,
  verificationDigest }) {
  const local = readV2GitCommit(root, sha);
  const value = JSON.parse(ghText(["api", "-H", "Accept: application/vnd.github+json",
    `repos/${target}/commits/${sha}`]));
  const provider = { sha: value.sha, treeSha: value.commit?.tree?.sha,
    parentShas: (value.parents || []).map(parent => parent.sha), message: value.commit?.message };
  const verification = value.commit?.verification;
  const observedVerificationDigest = digestValue(verification);
  if (verification?.verified !== verified || verification?.reason !== reason
    || (verificationDigest !== undefined && observedVerificationDigest !== verificationDigest)
    || digestValue(provider) !== digestValue({ sha: local.sha, treeSha: local.treeSha,
      parentShas: local.parentShas, message: local.message })) {
    throw new Error(`Commit ${sha} provider/Git/verification join is invalid.`);
  }
  return eFreeze({ ...local, providerVerificationDigest: observedVerificationDigest });
}

export function readV2GitCommit(root, sha) {
  const bytes = execFileSync("git", ["-C", root, "cat-file", "commit", sha],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const marker = bytes.indexOf(Buffer.from("\n\n"));
  if (marker < 0) throw new Error(`Commit ${sha} lacks a message boundary.`);
  const headers = bytes.subarray(0, marker).toString("utf8").split("\n");
  const raw = bytes.subarray(marker + 2); const terminal = raw.at(-1) === 0x0a;
  const message = raw.subarray(0, raw.length - (terminal ? 1 : 0)).toString("utf8");
  return eFreeze({ sha, treeSha: headers.find(line => line.startsWith("tree "))?.slice(5),
    parentShas: headers.filter(line => line.startsWith("parent ")).map(line => line.slice(7)),
    message, messageDigest: digestValue(message), rawMessageByteLength: raw.length,
    rawMessageSha256: createHash("sha256").update(raw).digest("hex"),
    rawMessageTerminalLf: terminal });
}

export function readV2Run(ghText, repository, runId, expected) {
  const run = JSON.parse(ghText(["api", `repos/${repository}/actions/runs/${runId}`]));
  const response = JSON.parse(ghText(["api",
    `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`]));
  if (run.id !== runId || run.head_sha !== expected.headSha || run.head_branch !== expected.branch
    || run.event !== expected.event || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(`CI run ${runId} does not join its exact subject.`);
  }
  const jobs = (response.jobs || []).map(job => ({ id: job.id, name: job.name,
    headSha: job.head_sha, status: job.status, conclusion: job.conclusion,
    startedAt: job.started_at, completedAt: job.completed_at, runnerName: job.runner_name,
    runnerGroupName: job.runner_group_name, stepsDigest: digestValue((job.steps || [])
      .map(step => ({ number: step.number, name: step.name, status: step.status,
        conclusion: step.conclusion, startedAt: step.started_at,
        completedAt: step.completed_at }))
      .sort((left, right) => left.number - right.number)) }))
    .sort((left, right) => left.id - right.id);
  return eFreeze({ id: run.id, nodeId: run.node_id, checkSuiteId: run.check_suite_id,
    workflowId: run.workflow_id, runNumber: run.run_number, attempt: run.run_attempt,
    headSha: run.head_sha, headBranch: run.head_branch, event: run.event, status: run.status,
    conclusion: run.conclusion, workflowPath: run.path, jobsDigest: digestValue(jobs), jobs });
}

function normalizeEvidencePull(value, fixed) {
  eKeys(value, ["number", "nodeId", "url", "baseSha", "headSha", "mergeSha",
    "autoMergeDigest"], "pull request evidence");
  if (value.number !== fixed.pullRequest || value.nodeId !== fixed.nodeId
    || value.url !== `https://github.com/huijoohwee/agentic-canvas-os/pull/${fixed.pullRequest}`
    || value.baseSha !== fixed.baseSha || value.headSha !== fixed.headSha
    || value.mergeSha !== fixed.mergeSha || value.autoMergeDigest !== fixed.autoMergeDigest) {
    eInvalid("fixed PR identity");
  }
  ["baseSha", "headSha", "mergeSha"].forEach(name => eSha(value[name], `PR ${name}`));
  eDigest(value.autoMergeDigest, "auto-merge digest");
  return eFreeze(structuredClone(value));
}

function normalizeEvidenceCommit(value, expected) {
  const { label } = expected;
  eKeys(value, ["sha", "treeSha", "parentShas", "message", "messageDigest",
    "rawMessageByteLength", "rawMessageSha256", "rawMessageTerminalLf",
    "providerVerificationDigest"], `${label} commit`);
  if (value.sha !== expected.sha || value.treeSha !== expected.treeSha
    || canonicalJson(value.parentShas) !== canonicalJson(expected.parentShas)
    || value.messageDigest !== expected.messageDigest
    || value.rawMessageByteLength !== expected.rawBytes
    || value.rawMessageSha256 !== expected.rawSha256
    || value.rawMessageTerminalLf !== expected.terminalLf
    || value.providerVerificationDigest !== expected.verificationDigest) {
    eInvalid(`${label} immutable commit join`);
  }
  eSha(value.treeSha, `${label} tree`);
  value.parentShas.forEach(parent => eSha(parent, `${label} parent`));
  eText(value.message, `${label} message`);
  if (value.messageDigest !== digestValue(value.message)) eInvalid(`${label} message digest`);
  ePositive(value.rawMessageByteLength, `${label} raw message length`);
  ["rawMessageSha256", "providerVerificationDigest"].forEach(name =>
    eDigest(value[name], `${label} ${name}`));
  return eFreeze(structuredClone(value));
}

function normalizeEvidenceMessage(value, source, protectedCommit, fixed) {
  eKeys(value, ["sourceKind", "protectedKind", "sourceMessageDigest",
    "protectedMessageDigest", "sourceRawMessageSha256", "protectedRawMessageSha256",
    "renderedMessageDigest", "providerCauseDigest", "sourceHistoryDigest",
    "authorAttributionDigest"], "message classification");
  if (value.sourceKind !== "managed-exact"
    || value.protectedKind !== "provider-attribution-rewrite"
    || value.sourceMessageDigest !== source.messageDigest
    || value.protectedMessageDigest !== protectedCommit.messageDigest
    || value.sourceRawMessageSha256 !== source.rawMessageSha256
    || value.protectedRawMessageSha256 !== protectedCommit.rawMessageSha256
    || value.renderedMessageDigest !== fixed.protectedMessageDigest
    || value.providerCauseDigest !== fixed.providerCauseDigest
    || value.sourceHistoryDigest !== fixed.sourceHistoryDigest
    || value.authorAttributionDigest !== fixed.authorAttributionDigest) {
    eInvalid("source/protected message classification join");
  }
  Object.keys(value).slice(2).forEach(name => eDigest(value[name], `message ${name}`));
  return eFreeze(structuredClone(value));
}

function normalizeEvidenceChecks(value, pull, fixed) {
  eKeys(value, ["reviewedRun", "postMainRun"], "check evidence");
  return eFreeze({
    reviewedRun: normalizeEvidenceRun(value.reviewedRun, {
      id: fixed.reviewedRunId, nodeId: fixed.reviewedRunNodeId,
      checkSuiteId: fixed.reviewedCheckSuiteId, runNumber: fixed.reviewedRunNumber,
      headSha: pull.headSha, headBranch: fixed.branch, event: "pull_request",
      jobsDigest: fixed.reviewedJobsDigest,
      runEvidenceDigest: fixed.reviewedRunEvidenceDigest,
      jobIds: fixed.reviewedJobIds, label: "reviewed",
    }),
    postMainRun: normalizeEvidenceRun(value.postMainRun, {
      id: fixed.postMainRunId, nodeId: fixed.postMainRunNodeId,
      checkSuiteId: fixed.postMainCheckSuiteId, runNumber: fixed.postMainRunNumber,
      headSha: pull.mergeSha, headBranch: "main", event: "push",
      jobsDigest: fixed.postMainJobsDigest,
      runEvidenceDigest: fixed.postMainRunEvidenceDigest,
      jobIds: fixed.postMainJobIds, label: "post-main",
    }),
  });
}

function normalizeEvidenceRun(value, expected) {
  eKeys(value, ["id", "nodeId", "checkSuiteId", "workflowId", "runNumber",
    "attempt", "headSha", "headBranch", "event", "status", "conclusion",
    "workflowPath", "jobsDigest", "jobs"], `${expected.label} run`);
  const jobs = Array.isArray(value.jobs)
    ? [...value.jobs].sort((left, right) => left.id - right.id) : null;
  if (value.id !== expected.id || value.nodeId !== expected.nodeId
    || value.checkSuiteId !== expected.checkSuiteId || value.workflowId !== 312871167
    || value.runNumber !== expected.runNumber || value.attempt !== 1
    || value.headSha !== expected.headSha || value.headBranch !== expected.headBranch
    || value.event !== expected.event || value.status !== "completed"
    || value.conclusion !== "success" || value.workflowPath !== ".github/workflows/ci.yml"
    || !jobs || value.jobsDigest !== digestValue(jobs)
    || value.jobsDigest !== expected.jobsDigest) {
    eInvalid(`${expected.label} exact run identity`);
  }
  jobs.forEach((job, index) => {
    eKeys(job, ["id", "name", "headSha", "status", "conclusion", "startedAt",
      "completedAt", "runnerName", "runnerGroupName", "stepsDigest"], "CI job");
    if (job.id !== expected.jobIds[index] || job.headSha !== expected.headSha
      || job.status !== "completed" || job.conclusion !== "success") eInvalid("CI job identity");
    ["startedAt", "completedAt", "runnerName", "runnerGroupName"]
      .forEach(name => eText(job[name], `CI job ${name}`));
    eDigest(job.stepsDigest, "CI job steps");
  });
  const legacy = { id: value.id, headSha: value.headSha, headBranch: value.headBranch,
    event: value.event, status: value.status, conclusion: value.conclusion,
    workflowPath: value.workflowPath, jobsDigest: value.jobsDigest, jobs };
  if (digestValue(legacy) !== expected.runEvidenceDigest) eInvalid("run evidence digest");
  return eFreeze({ ...structuredClone(value), jobs: structuredClone(jobs) });
}

function normalizeEvidenceLease(value, pull, branch, worktreePath, fixed) {
  eKeys(value, ["epoch", "sessionId", "scope", "branch", "worktreePath",
    "baseSha", "fenceSha", "pullRequestUrl", "deliveryHeadSha",
    "cloudAuthorityDigest", "taskAuthorityBindingDigest", "integrationDigest",
    "leaseIdentityDigest"], "lease evidence");
  if (value.branch !== branch || value.worktreePath !== worktreePath
    || value.baseSha !== pull.baseSha || value.pullRequestUrl !== pull.url
    || value.deliveryHeadSha !== pull.headSha || value.epoch !== fixed.localEpoch
    || value.sessionId !== fixed.sessionId || value.scope !== fixed.scope
    || value.fenceSha !== fixed.fenceSha
    || value.leaseIdentityDigest !== fixed.leaseIdentityDigest) eInvalid("lease join");
  ePositive(value.epoch, "lease epoch");
  eSha(value.fenceSha, "lease fence");
  ["cloudAuthorityDigest", "taskAuthorityBindingDigest", "integrationDigest",
    "leaseIdentityDigest"].forEach(name => eDigest(value[name], `lease ${name}`));
  return eFreeze(structuredClone(value));
}

function normalizeEvidenceTask(value, lease, fixed) {
  eKeys(value, ["authoritySubjectId", "proofAdapterId", "generation", "publicKeyDigest",
    "laneBindingDigest", "bindingMode", "priorBindingDigest", "bindingDigest"],
  "task authority evidence");
  if (value.authoritySubjectId !== fixed.taskSubject || value.generation !== 1
    || value.proofAdapterId !== "urn:agentic-proof:ed25519-file:v1"
    || value.publicKeyDigest !== fixed.publicKeyDigest
    || value.laneBindingDigest !== fixed.laneBindingDigest
    || value.bindingMode !== fixed.bindingMode
    || value.priorBindingDigest !== fixed.priorBindingDigest
    || value.bindingDigest !== fixed.bindingDigest
    || value.bindingDigest !== lease.taskAuthorityBindingDigest) eInvalid("task/lease join");
  ["publicKeyDigest", "laneBindingDigest", "bindingDigest"].forEach(name =>
    eDigest(value[name], `task ${name}`));
  if (value.priorBindingDigest !== null) eDigest(value.priorBindingDigest, "task prior");
  return eFreeze(structuredClone(value));
}

function normalizeEvidenceCloud(value, lease, fixed, terminal) {
  eKeys(value, ["claimId", "integratedClaimDigest", "lineageDigest", "lineageLength",
    "terminalState", "retirementReason", "leaseEpoch", "integrationCounter",
    "terminalCounter", "reviewRequestId", "finalRevision", "integrateEntryDigest",
    "retireSequence", "retireIdempotencyKey", "retireRequestDigest",
    "terminalEntryDigest", "terminalClaimDigest", "integrationReceiptDigest",
    "deliveryEvidenceDigest", "authorityDigest", "terminalCloudDigest"], "cloud evidence");
  const core = Object.fromEntries(Object.entries(value).slice(0, 18));
  if (!terminal || value.claimId !== fixed.claimId
    || value.integratedClaimDigest !== fixed.claimDigest || value.terminalState !== "retired"
    || value.retirementReason !== "integrated" || value.leaseEpoch !== fixed.cloudEpoch
    || value.integrationCounter !== fixed.cloudTransition
    || value.reviewRequestId !== `github-pull-request:${fixed.nodeId}`
    || value.finalRevision !== fixed.headSha || value.lineageLength !== terminal.lineageLength
    || value.lineageDigest !== terminal.lineageDigest
    || value.integrateEntryDigest !== terminal.integrateEntryDigest
    || value.integrationCounter !== terminal.integrationCounter
    || value.retireSequence !== terminal.retireSequence
    || value.retireIdempotencyKey !== terminal.retireIdempotencyKey
    || value.retireRequestDigest !== terminal.retireRequestDigest
    || value.terminalEntryDigest !== terminal.terminalEntryDigest
    || value.terminalClaimDigest !== terminal.terminalClaimDigest
    || value.terminalCounter !== terminal.terminalCounter
    || value.integrationReceiptDigest !== fixed.integrationReceiptDigest
    || value.authorityDigest !== lease.cloudAuthorityDigest
    || value.terminalCloudDigest !== digestValue(core)) eInvalid("cloud authority join");
  ["lineageLength", "leaseEpoch", "integrationCounter", "terminalCounter",
    "retireSequence"].forEach(name => ePositive(value[name], `cloud ${name}`));
  ["claimId", "integratedClaimDigest", "lineageDigest", "integrateEntryDigest",
    "retireIdempotencyKey", "retireRequestDigest", "terminalEntryDigest",
    "terminalClaimDigest", "integrationReceiptDigest", "deliveryEvidenceDigest",
    "authorityDigest", "terminalCloudDigest"].forEach(name => eDigest(value[name], `cloud ${name}`));
  return eFreeze(structuredClone(value));
}

function normalizeEvidenceIntegration(value, fixed) {
  eKeys(value, ["commitSha", "treeSha", "commitMessageDigest", "pathsDigest",
    "manifestDigest", "stagedDiffDigest", "protectedRefresh"], "integration evidence");
  if (value.commitSha !== fixed.integrationCommit || value.treeSha !== fixed.integrationTree
    || value.commitMessageDigest !== fixed.integrationMessageDigest
    || value.pathsDigest !== fixed.pathsDigest || value.manifestDigest !== fixed.manifestDigest
    || value.stagedDiffDigest !== fixed.stagedDiffDigest
    || canonicalJson(value.protectedRefresh) !== canonicalJson(fixed.protectedRefreshTopology)) {
    eInvalid("integration identity");
  }
  return eFreeze(structuredClone(value));
}

function eKeys(value, expected, label) {
  eObject(value, label);
  if (canonicalJson(Object.keys(value)) !== canonicalJson(expected)) eInvalid(`${label} keys`);
}
function eObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) eInvalid(label);
}
function eText(value, label) {
  if (typeof value !== "string" || !value.trim()) eInvalid(label);
}
function ePositive(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) eInvalid(label);
}
function eSha(value, label) {
  if (typeof value !== "string" || !/^(?!0{40}$)[0-9a-f]{40}$/u.test(value)) eInvalid(label);
}
function eDigest(value, label) {
  if (typeof value !== "string" || !/^(?!0{64}$)[0-9a-f]{64}$/u.test(value)) eInvalid(label);
}
function eInvalid(label) { throw new Error(`Canonical squash batch ${label} is invalid.`); }
function eFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); Object.values(value).forEach(eFreeze); return value;
}

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [{ createCanonicalSquashBatchTerminalizerV2Controller }, adapterModule] =
    await Promise.all([
      import("./canonical-squash-batch-terminalizer-v2-controller.mjs"),
      import("./canonical-squash-batch-terminalizer-v2-repository-adapter.mjs"),
    ]);
  const { createCanonicalSquashBatchTerminalizerV2RepositoryAdapter,
    parseV2CapabilityManifest, parseV2EvidenceManifest } = adapterModule;
  const [action, ...tail] = argumentsList;
  if (!["plan", "execute", "status"].includes(action)) throw new Error(usage());
  const options = parse(tail);
  const repository = physicalDirectory(required(options, "repository"), "canonical repository");
  const controllerRoot = physicalDirectory(
    options.get("controller-root") || INSTALLED_ROOT,
    "controller root",
  );
  if (controllerRoot !== realpathSync(INSTALLED_ROOT) || controllerRoot !== repository) {
    throw new Error("Controller root must be this exact clean canonical repository checkout.");
  }
  const gitCommonDir = physicalDirectory(
    dependencies.resolveGitCommonDirectory
      ? dependencies.resolveGitCommonDirectory(repository)
      : String(execFileSync("git", [
        "-C", repository, "rev-parse", "--path-format=absolute", "--git-common-dir",
      ], { encoding: "utf8" })).trim(),
    "Git common directory",
  );
  const excluded = [repository, controllerRoot, gitCommonDir];
  const statePath = privateDestination(
    required(options, "state-path"),
    "batch journal",
    excluded,
  );
  const evidenceManifest = parseV2EvidenceManifest(readPrivateJson(
    privateFile(required(options, "evidence-manifest"), "evidence manifest", excluded),
    "evidence manifest",
  ));
  let capabilityManifest = null;
  if (options.has("capabilities-manifest")) {
    const capabilityManifestPath = privateFile(
      required(options, "capabilities-manifest"),
      "capabilities manifest",
      excluded,
    );
    capabilityManifest = parseV2CapabilityManifest(readPrivateJson(
      capabilityManifestPath,
      "capabilities manifest",
    ));
  }
  const createAdapter = dependencies.createAdapter
    || createCanonicalSquashBatchTerminalizerV2RepositoryAdapter;
  const createController = dependencies.createController
    || createCanonicalSquashBatchTerminalizerV2Controller;
  const controller = createController({
    adapter: createAdapter({
      repository,
      controllerRoot,
      statePath,
      evidenceManifest,
      capabilityManifest,
    }, dependencies.adapterDependencies),
  });
  if (action === "plan") {
    forbid(options, ["capabilities-manifest", "plan-digest", "auth-file"], action);
    return controller.plan();
  }
  if (action === "status") {
    forbid(options, ["plan-digest", "auth-file"], action);
    return controller.status();
  }
  return controller.execute({
    planDigest: digest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(privateFile(
      required(options, "auth-file"),
      "authorization",
      excluded,
    )),
  });
}

export async function runCli(argumentsList = process.argv.slice(2), dependencies = {}) {
  try {
    const result = await main(argumentsList, dependencies);
    process.stdout.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      status: "complete",
      result,
    }, null, argumentsList.includes("--json") ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      status: "blocked",
      error: String(error?.message || error).slice(0, 1_000),
      ...(error?.capabilityReport ? { capabilityReport: error.capabilityReport } : {}),
    }, null, argumentsList.includes("--json") ? 2 : 0)}\n`);
    return 1;
  }
}

function parse(args) {
  const values = new Map();
  for (const argument of args) {
    if (argument === "--json") {
      if (values.has("json")) throw new Error("--json must be provided once.");
      values.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(argument);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
    if (values.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    values.set(match[1], match[2]);
  }
  return values;
}

function physicalDirectory(value, label) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  const target = realpathSync(path.resolve(value));
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be one physical directory.`);
  }
  return target;
}

function privateFile(value, label, excluded) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  const target = path.resolve(value);
  rejectSymlinkTraversal(target, label);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be one owner-held mode-0600 regular file.`);
  }
  const physical = realpathSync(target);
  requireExternal(physical, label, excluded);
  return physical;
}

export function resolveV2PrivateCapabilityPath(value, excluded) {
  return privateFile(value, "task authority capability", excluded);
}

function privateDestination(value, label, excluded) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  const target = path.resolve(value);
  rejectSymlinkTraversal(target, label);
  if (existsSync(target)) privateFile(target, label, excluded);
  requireExternal(resolveThroughExistingAncestor(target), label, excluded);
  return target;
}

function rejectSymlinkTraversal(value, label) {
  const parsed = path.parse(value);
  let cursor = parsed.root;
  for (const segment of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`${label} cannot traverse a symbolic link.`);
      }
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return;
      throw error;
    }
  }
}

function requireExternal(value, label, excluded) {
  for (const root of excluded) {
    if (value === root || value.startsWith(`${root}${path.sep}`)) {
      throw new Error(`${label} must remain outside repository, controller, and Git roots.`);
    }
  }
}

function resolveThroughExistingAncestor(value) {
  const remainder = [];
  let cursor = value;
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    remainder.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(existsSync(cursor) ? realpathSync(cursor) : cursor, ...remainder);
}

function readPrivateJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} is malformed: ${error.message}`); }
}
function readAuthorization(file) {
  const value = readFileSync(file, "utf8");
  const line = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (!line || line.includes("\n") || line.includes("\r")) {
    throw new Error("Authorization file must contain exactly one line.");
  }
  return line;
}
function forbid(options, names, action) {
  const forbidden = names.find(name => options.has(name));
  if (forbidden) throw new Error(`${action} forbids --${forbidden}.`);
}
function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}
function digest(value, label) {
  if (!/^(?!0{64}$)[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function usage() {
  return "Usage: canonical-squash-batch-terminalizer-v2 <plan|execute|status> --repository=<abs> --state-path=<abs> --evidence-manifest=<abs> [--capabilities-manifest=<abs>] [--plan-digest=<sha256> --auth-file=<abs>] [--json]";
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  void runCli().then(code => { process.exitCode = code; });
}
