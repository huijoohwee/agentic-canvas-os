#!/usr/bin/env node
// Responsibility: expose read-only planning and exact-authorized provider-only pair reconciliation.

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createProviderOnlyMergedClaimPairReconciliationController } from "./provider-only-merged-claim-pair-reconciliation-controller.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

const RESULT_SCHEMA = "agentic-provider-only-merged-claim-pair-reconciliation-result/v1";
const OPTIONS = new Set([
  "source-repository", "target-repository", "pull-request", "source-claim-id",
  "waiter-claim-id", "ledger-repository", "plan-path", "state-path", "ttl-seconds", "plan-digest",
  "authorize", "json",
]);

export async function main(argumentsList = process.argv.slice(2), {
  createAdapter = null,
  createController = createProviderOnlyMergedClaimPairReconciliationController,
} = {}) {
  const adapterFactory = createAdapter || (await import(
    "./provider-only-merged-claim-pair-reconciliation-repository-adapter.mjs"
  )).createRepositoryProviderOnlyMergedClaimPairReconciliationAdapter;
  const { command, options } = parseArguments(argumentsList);
  const adapter = adapterFactory({
    sourceRepository: required(options, "source-repository"),
    targetRepository: required(options, "target-repository"),
    pullRequestNumber: positive(required(options, "pull-request"), "--pull-request"),
    sourceClaimId: required(options, "source-claim-id"),
    waiterClaimId: required(options, "waiter-claim-id"),
    ledgerRepository: options.get("ledger-repository") || "huijoohwee/agentic-canvas-os",
    planPath: options.get("plan-path") || null,
    statePath: options.get("state-path") || null,
    ttlSeconds: options.has("ttl-seconds")
      ? boundedTtl(options.get("ttl-seconds")) : 1_800,
  });
  if (typeof createController !== "function") throw new Error("Provider-only controller is unavailable.");
  const controller = createController({ adapter });
  if (!controller || typeof controller.plan !== "function"
    || (command === "run" && typeof controller.run !== "function")) {
    throw new Error("Provider-only controller surface is unavailable.");
  }
  const planDigest = options.get("plan-digest") || null;
  if (command === "plan") {
    if (options.has("authorize")) throw new Error("plan does not accept --authorize.");
    return controller.plan({ planDigest });
  }
  if (!planDigest) throw new Error("run requires --plan-digest=<exact digest>.");
  return controller.run({ planDigest, authorization: required(options, "authorize") });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const result = await main(argumentsList);
    process.stdout.write(`${JSON.stringify(result, null, argumentsList.includes("--json") ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status: "blocked",
      error: String(error?.message || error) })}\n`);
    return 1;
  }
}

function parseArguments(argumentsList) {
  const [command = "plan", ...tokens] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = new Map();
  for (const token of tokens) {
    if (token === "--json") {
      if (options.has("json")) throw new Error("--json must be provided once.");
      options.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(token);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${token}`);
    if (options.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    options.set(match[1], match[2]);
  }
  return { command, options };
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`--${name}=... is required.`);
  }
  return value;
}
function positive(value, label) { const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be positive.`);
  return result; }
function boundedTtl(value) { const result = positive(value, "--ttl-seconds");
  if (result < 60 || result > 86_400) throw new Error("--ttl-seconds must be between 60 and 86400.");
  return result; }
function usage() {
  return "Usage: provider-only-merged-claim-pair-reconciliation.mjs plan|run "
    + "--source-repository=<clean-main> --target-repository=<owner/name> --pull-request=<number> "
    + "--source-claim-id=<digest> --waiter-claim-id=<digest> [--ledger-repository=<owner/name>] "
    + "[--plan-path=<private-path>] [--state-path=<private-path>] [--ttl-seconds=1800] "
    + "[--plan-digest=<digest> --authorize=<exact text>]";
}

const SHA = /^[0-9a-f]{40}$/u;
const CHECKOUT = /^actions\/checkout@([0-9a-f]{40})$/u;
const CONTROLLER_ENTRYPOINT = "scripts/sync-open-pr.mjs";
const CONTROLLER_ADAPTER = "scripts/protected-head-refresh-github-adapter.mjs";
const MODE = "--protected-head-refresh";

export function readProviderOnlyMergedClaimPairEnrollment(content, {
  controllerRepository,
  liveRequiredChecks = [],
  protectedMainSha,
  targetRepository,
} = {}) {
  const controller = repository(controllerRepository, "controller repository");
  const target = repository(targetRepository, "enrolled target repository");
  const workflow = parseProtectedRefreshWorkflow(content);
  const self = target.toLowerCase() === controller.toLowerCase();
  const controllerCheckout = selectControllerCheckout(workflow, { controller, self, target });
  const controllerRevision = self
    ? sha(protectedMainSha, "self-enrolled controller revision")
    : sha(controllerCheckout.with.ref, "enrolled controller revision");
  const controllerPath = self ? "." : relativePath(
    controllerCheckout.with.path,
    "controller checkout path",
  );
  const expectedCommand = `node ${controllerPath === "." ? "" : `${controllerPath}/`}`
    + `${CONTROLLER_ENTRYPOINT} ${MODE}`;
  if (workflow.runStep.run !== expectedCommand) {
    throw new Error("Protected-refresh run step does not execute the exact pinned controller path and mode.");
  }
  const liveContexts = source => [...new Set(liveRequiredChecks.filter(check => check.source === source)
    .map(check => workflowRequired(check.context, `${source} live check`)))].sort();
  const classicRequiredChecks = self
    ? liveContexts("classic")
    : jsonArray(workflow.runStep.env.PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON,
      "PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON");
  const rulesetRequiredChecks = self
    ? liveContexts("ruleset")
    : jsonArray(workflow.runStep.env.PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON,
      "PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON");
  const requiredCiContexts = self
    ? [...new Set([...classicRequiredChecks, ...rulesetRequiredChecks])].sort()
    : jsonArray(workflow.runStep.env.PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON,
      "PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON");
  const core = {
    workflowPath: ".github/workflows/auto-delivery.yml",
    contentDigest: sha256(content),
    workflowJob: "protected-head-refresh",
    checkoutActionRevision: controllerCheckout.checkoutRevision,
    controllerPath,
    controllerRevision,
    runCommand: workflow.runStep.run,
    classicRequiredChecks,
    rulesetRequiredChecks,
    requiredCiContexts,
  };
  const { contentDigest: _contentDigest, ...semantic } = core;
  return Object.freeze({ ...core, semanticDigest: digestValue(semantic) });
}

export async function readHistoricalDeliveryController({
  github,
  controllerRepository,
  enrollment,
  currentControllerRevision,
} = {}) {
  const repositoryName = repository(controllerRepository, "historical controller repository");
  const revision = sha(enrollment?.controllerRevision, "historical controller revision");
  const current = sha(currentControllerRevision, "current controller revision");
  const [commit, compare, entrypoint, adapter] = await Promise.all([
    github(`repos/${repositoryName}/git/commits/${revision}`),
    github(`repos/${repositoryName}/compare/${revision}...${current}`),
    readRemoteFile(github, repositoryName, revision, CONTROLLER_ENTRYPOINT),
    readRemoteFile(github, repositoryName, revision, CONTROLLER_ADAPTER),
  ]);
  requireCompleteCompare(compare, "historical-to-current controller comparison");
  if (!isAncestorCompare(compare)) {
    throw new Error("Historical delivery controller is not an ancestor of current protected controller.");
  }
  const witness = executeHistoricalDispatchWitness({
    content: entrypoint.content,
    repository: repositoryName,
  });
  const semantic = {
    repository: repositoryName,
    revision,
    treeSha: sha(commit.tree?.sha, "historical controller tree"),
    entrypoint: CONTROLLER_ENTRYPOINT,
    mode: MODE,
    entrypointBlobSha: entrypoint.blobSha,
    entrypointContentDigest: entrypoint.contentDigest,
    adapterPath: CONTROLLER_ADAPTER,
    adapterBlobSha: adapter.blobSha,
    adapterContentDigest: adapter.contentDigest,
    executableWitnessDigest: witness.witnessDigest,
  };
  return Object.freeze({
    ...semantic,
    currentControllerRevision: current,
    isAncestorOfCurrentController: true,
    semanticDigest: digestValue(semantic),
  });
}

export function executeHistoricalDispatchWitness({ content, repository: repositoryName }) {
  const repositoryValue = repository(repositoryName, "witness repository");
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-provider-controller-witness-"));
  chmodSync(root, 0o700);
  const token = randomUUID();
  const witnessPath = path.join(root, "dispatch-witness.json");
  try {
    writeFileSync(path.join(root, "sync-open-pr.mjs"), String(content), { mode: 0o600, flag: "wx" });
    writeStub(path.join(root, "repository-guards.mjs"),
      "export function assertUniquePullRequestScopes() { throw new Error('unreachable'); }\n");
    writeStub(path.join(root, "auto-delivery-lib.mjs"),
      "export const AUTO_DELIVERY_LABEL='unreachable'; export function isAuthorizedAutoDeliveryPullRequest(){ throw new Error('unreachable'); }\n");
    writeStub(path.join(root, "cloud-collaboration-delivery-verifier.mjs"),
      "export function verifyCloudDeliveryAuthority() { throw new Error('unreachable'); }\n");
    writeStub(path.join(root, "protected-squash-subject.mjs"),
      "export function requireProtectedSquashSubject() { throw new Error('unreachable'); }\n");
    writeStub(path.join(root, "protected-head-refresh-github-adapter.mjs"), [
      "import { writeFileSync } from 'node:fs';",
      `const witnessPath=${JSON.stringify(witnessPath)};`,
      `const token=${JSON.stringify(token)};`,
      "export function runProtectedHeadRefresh(input) {",
      "  writeFileSync(witnessPath, JSON.stringify({ token, input })+'\\n', { flag: 'wx', mode: 0o600 });",
      "  return { schema: 'agentic-provider-historical-controller-witness/v1', status: 'observed' };",
      "}",
      "",
    ].join("\n"));
    const result = spawnSync(
      process.execPath,
      [path.join(root, "sync-open-pr.mjs"), MODE],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          GITHUB_REPOSITORY: repositoryValue,
          HOME: root,
          LANG: "C",
          LC_ALL: "C",
          PATH: path.dirname(process.execPath),
        },
        maxBuffer: 1024 * 1024,
        timeout: 5_000,
      },
    );
    if (result.status !== 0 || result.signal || result.error) {
      throw new Error("Pinned historical controller did not execute its protected-refresh dispatch path.");
    }
    let witness;
    try { witness = JSON.parse(readFileSync(witnessPath, "utf8")); }
    catch { throw new Error("Pinned historical controller produced no executable dispatch witness."); }
    if (witness.token !== token
      || JSON.stringify(witness.input) !== JSON.stringify({ repository: repositoryValue })) {
      throw new Error("Pinned historical controller executable dispatch witness is not exact.");
    }
    const core = {
      schema: "agentic-provider-historical-controller-executable-witness/v1",
      adapterPath: CONTROLLER_ADAPTER,
      entrypoint: CONTROLLER_ENTRYPOINT,
      mode: MODE,
      repository: repositoryValue,
    };
    return Object.freeze({ ...core, witnessDigest: digestValue(core) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function parseProtectedRefreshWorkflow(content) {
  const lines = tokenizeYaml(content);
  const jobs = exactMapping(lines, 0, "jobs", 0, lines.length);
  const jobsEnd = blockEnd(lines, jobs.index, jobs.indent);
  const job = exactMapping(lines, jobs.indent + 2, "protected-head-refresh", jobs.index + 1, jobsEnd);
  const jobEnd = blockEnd(lines, job.index, job.indent);
  rejectAmbiguousNodes(lines.slice(job.index, jobEnd));
  const condition = scalarValue(lines, exactMapping(
    lines,
    job.indent + 2,
    "if",
    job.index + 1,
    jobEnd,
  ));
  const normalizedCondition = condition.replace(/\s+/gu, " ");
  if (!normalizedCondition.includes("refs/heads/main")
    || !normalizedCondition.includes("inputs.operation")
    || !normalizedCondition.includes("protected-head-refresh")
    || /(?:^|[(&|!\s])false(?:$|[)&|\s])/iu.test(normalizedCondition)) {
    throw new Error("Protected-refresh job condition is disabled or lacks exact main/mode enrollment.");
  }
  const stepsNode = exactMapping(lines, job.indent + 2, "steps", job.index + 1, jobEnd);
  const steps = parseSteps(lines, stepsNode.index + 1, jobEnd, stepsNode.indent + 2);
  const runSteps = steps.filter(step => step.run?.endsWith(` ${MODE}`));
  if (runSteps.length !== 1) {
    throw new Error("Protected-refresh workflow must have one executing controller run step.");
  }
  const runStep = runSteps[0];
  if (runStep.if != null || runStep["continue-on-error"] != null) {
    throw new Error("Protected-refresh controller run step cannot be conditional or fail-soft.");
  }
  const runIndex = steps.indexOf(runStep);
  const checkoutSteps = steps.slice(0, runIndex).filter(step => CHECKOUT.test(step.uses || ""));
  if (checkoutSteps.length === 0) throw new Error("Protected-refresh workflow lacks an executing checkout.");
  return { checkoutSteps, runStep };
}

function selectControllerCheckout(workflow, { controller, self, target }) {
  const targetCheckout = workflow.checkoutSteps.find(step => (
    !step.with.repository || step.with.repository.toLowerCase() === target.toLowerCase()
  ) && step.with.ref === "${{ github.sha }}" && step.with["persist-credentials"] === "false");
  if (!targetCheckout) throw new Error("Protected-refresh job lacks its exact protected-main checkout.");
  requireUnconditionalCheckout(targetCheckout, "protected-main");
  const selected = self ? targetCheckout : workflow.checkoutSteps.find(step => (
    step.with.repository?.toLowerCase() === controller.toLowerCase()
    && SHA.test(step.with.ref || "")
    && step.with.path
    && step.with["persist-credentials"] === "false"
  ));
  if (!selected) throw new Error("Protected-refresh job lacks its exact pinned controller checkout.");
  requireUnconditionalCheckout(selected, "controller");
  const match = CHECKOUT.exec(selected.uses);
  return { ...selected, checkoutRevision: match[1] };
}

function requireUnconditionalCheckout(step, label) {
  if (step.if != null || step["continue-on-error"] != null) {
    throw new Error(`Protected-refresh ${label} checkout cannot be conditional or fail-soft.`);
  }
}

function tokenizeYaml(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("Auto-delivery workflow is empty.");
  if (content.includes("\t") || content.includes("\r")) {
    throw new Error("Auto-delivery workflow must use canonical LF/space indentation.");
  }
  return content.split("\n").map((raw, index) => {
    const indent = /^ */u.exec(raw)[0].length;
    const contentValue = stripComment(raw.slice(indent)).trimEnd();
    return { content: contentValue, indent, index };
  }).filter(line => line.content.trim());
}

function parseSteps(lines, start, end, indent) {
  const starts = [];
  for (let index = start; index < end; index += 1) {
    if (lines[index].indent === indent && lines[index].content.startsWith("- ")) starts.push(index);
  }
  return starts.map((stepStart, position) => {
    const stepEnd = starts[position + 1] ?? end;
    const step = { env: {}, with: {} };
    assignPair(step, lines[stepStart].content.slice(2), "step");
    let nested = null;
    for (let index = stepStart + 1; index < stepEnd; index += 1) {
      const line = lines[index];
      if (line.indent === indent + 2) {
        const [key, value] = pair(line.content, "step");
        if (["env", "with"].includes(key) && value === "") {
          nested = key;
          continue;
        }
        nested = null;
        assign(step, key, unquote(value), "step");
      } else if (line.indent === indent + 4 && nested) {
        const [key, value] = pair(line.content, `${nested} entry`);
        assign(step[nested], key, unquote(value), nested);
      } else if (line.indent <= indent + 4) {
        throw new Error("Protected-refresh step has ambiguous YAML structure.");
      }
    }
    return Object.freeze({ ...step, env: Object.freeze(step.env), with: Object.freeze(step.with) });
  });
}

function exactMapping(lines, indent, key, start, end) {
  const matches = [];
  for (let index = start; index < end; index += 1) {
    if (lines[index].indent !== indent) continue;
    const [observed] = pair(lines[index].content, "workflow mapping");
    if (observed === key) matches.push({ ...lines[index], index });
  }
  if (matches.length !== 1) throw new Error(`Auto-delivery workflow requires exactly one ${key} mapping.`);
  return matches[0];
}

function scalarValue(lines, node) {
  const [, inline] = pair(node.content, "workflow scalar");
  if (!/^[>|][+-]?$/u.test(inline)) return unquote(inline);
  const end = blockEnd(lines, node.index, node.indent);
  return lines.slice(node.index + 1, end).map(line => line.content.trim()).join(" ");
}

function blockEnd(lines, index, indent) {
  let cursor = index + 1;
  while (cursor < lines.length && lines[cursor].indent > indent) cursor += 1;
  return cursor;
}

function rejectAmbiguousNodes(lines) {
  for (const line of lines) {
    if (/(^|\s)(?:&[A-Za-z0-9_-]+|\*[A-Za-z0-9_-]+|![A-Za-z0-9_-]+|<<\s*:)/u.test(line.content)) {
      throw new Error("Protected-refresh workflow cannot use aliases, anchors, tags, or merge keys.");
    }
  }
}

function stripComment(value) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (double && escaped) { escaped = false; continue; }
    if (double && character === "\\") { escaped = true; continue; }
    if (!double && character === "'" && (single || quoteCanStart(value, index))) {
      if (single && value[index + 1] === "'") { index += 1; continue; }
      single = !single;
      continue;
    }
    if (!single && character === '"' && (double || quoteCanStart(value, index))) {
      double = !double;
      continue;
    }
    if (!single && !double && character === "#" && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  if (single || double) throw new Error("Auto-delivery workflow contains an unterminated quoted scalar.");
  return value;
}

function quoteCanStart(value, index) {
  return index === 0 || /[\s:[{(=,!|>-]/u.test(value[index - 1]);
}

function assignPair(target, value, label) {
  const [key, scalar] = pair(value, label);
  assign(target, key, unquote(scalar), label);
}
function pair(value, label) {
  const separator = value.indexOf(":");
  if (separator < 1) throw new Error(`Malformed ${label} YAML mapping.`);
  const key = value.slice(0, separator).trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(key)) throw new Error(`Unsupported ${label} YAML key.`);
  return [key, value.slice(separator + 1).trim()];
}
function assign(target, key, value, label) {
  if (Object.hasOwn(target, key) && !["env", "with"].includes(key)) {
    throw new Error(`Duplicate ${label} YAML key ${key}.`);
  }
  target[key] = value;
}
function unquote(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { throw new Error("Malformed quoted workflow scalar."); }
  }
  return value;
}
function jsonArray(value, name) {
  if (typeof value !== "string") throw new Error(`Auto-delivery enrollment lacks ${name}.`);
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${name} must encode JSON.`); }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must encode an array of check names.`);
  }
  return [...new Set(parsed.map(item => item.trim()))].sort();
}

async function readRemoteFile(github, repo, revision, file) {
  const value = await github(`repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${revision}`);
  if (Array.isArray(value) || !value?.content) throw new Error(`Historical controller ${file} is unavailable.`);
  const content = Buffer.from(String(value.content).replaceAll("\n", ""), "base64").toString("utf8");
  return {
    blobSha: sha(value.sha, `historical controller blob ${file}`),
    content,
    contentDigest: sha256(content),
  };
}
function requireCompleteCompare(value, label) {
  if (!Array.isArray(value?.commits) || value.total_commits !== value.commits.length) {
    throw new Error(`${label} is truncated.`);
  }
}
function isAncestorCompare(value) { return ["ahead", "identical"].includes(value.status); }
function writeStub(file, bytes) { writeFileSync(file, bytes, { mode: 0o600, flag: "wx" }); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sha(value, label) { const result = workflowRequired(value, label);
  if (!SHA.test(result)) throw new Error(`${label} must be a SHA.`); return result; }
function repository(value, label) { const result = workflowRequired(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} must be owner/name.`);
  return result; }
function relativePath(value, label) { const result = workflowRequired(value, label);
  if (result.startsWith("/") || result.split("/").includes("..") || result === ".") {
    throw new Error(`${label} must be a non-root repository-relative path.`);
  } return result; }
function workflowRequired(value, label) { const result = String(value ?? "").normalize("NFC").trim();
  if (!result) throw new Error(`${label} is required.`); return result; }

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) void runCli().then(code => { process.exitCode = code; });
