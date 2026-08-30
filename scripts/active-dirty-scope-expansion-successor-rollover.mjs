#!/usr/bin/env node
// Responsibility: Expose sealed successor-rollover planning, execution, and continuation recovery.
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createActiveDirtyScopeExpansionSuccessorRolloverController,
} from "./active-dirty-scope-expansion-successor-rollover-controller.mjs";
import {
  createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter,
} from "./active-dirty-scope-expansion-successor-rollover-repository-adapter.mjs";
import {
  authorizeSuccessorRolloverContinuation,
  buildSuccessorRolloverContinuationPlan,
  normalizeSuccessorRolloverContinuationAuthorization,
  requireSuccessorRolloverContinuationJournal,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs";
import {
  authorizeSuccessorRolloverContinuationRefresh,
  buildSuccessorRolloverContinuationRefreshPlan,
  isSuccessorRolloverContinuationRefreshPlan,
  normalizeSuccessorRolloverContinuationAuthorityPlan,
  normalizeSuccessorRolloverContinuationRefreshAuthorization,
  requireSuccessorRolloverContinuationRefreshJournal,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-refresh.mjs";

const RESULT_SCHEMA =
  "agentic-active-dirty-scope-expansion-successor-rollover-result/v1";
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMANDS = new Set([
  "inspect",
  "plan-retirement",
  "run-retirement",
  "plan-replacement",
  "run-replacement",
  "plan-continuation",
  "run-continuation",
]);
const OPTIONS = new Set([
  "authorization",
  "controller-root",
  "corrected-manifest",
  "continuation-state",
  "json",
  "operator-session",
  "output",
  "plan",
  "prior-continuation",
  "pull-request",
  "repository",
  "replacement-plan",
  "source-session",
  "state-path",
  "task-authority",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command = "inspect", ...tail] = argumentsList;
  if (!COMMANDS.has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const planning = command.startsWith("plan-");
  const running = command.startsWith("run-");
  const replacement = command.endsWith("replacement");
  const continuation = command.endsWith("continuation");
  const replacementSubject = replacement || continuation;
  rejectIrrelevantOptions(options, {
    command, planning, running, replacementSubject,
  });

  const repository = canonicalDirectory(required(options, "repository"), "repository");
  const controllerRoot = canonicalDirectory(
    options.get("controller-root") || CONTROLLER_ROOT,
    "controller root",
  );
  const statePath = privateExternalPath(required(options, "state-path"), {
    repository,
    controllerRoot,
    label: "state path",
    allowAbsent: true,
  });
  const correctedManifestFile = replacementSubject
    ? manifestPath(required(options, "corrected-manifest"), {
      repository,
      controllerRoot,
    })
    : null;
  const taskAuthorityFile = running
    ? privateExternalPath(required(options, "task-authority"), {
      repository,
      controllerRoot,
      label: "task authority",
    })
    : null;
  const planFile = running
    ? privateExternalPath(required(options, "plan"), {
      repository,
      controllerRoot,
      label: "plan",
    })
    : null;
  const outputFile = planning
    ? privateExternalPath(required(options, "output"), {
      repository,
      controllerRoot,
      label: "plan output",
      allowAbsent: true,
    })
    : null;
  if (command === "plan-continuation"
    && options.has("replacement-plan") === options.has("prior-continuation")) {
    throw new Error("plan-continuation requires exactly one of --replacement-plan or --prior-continuation.");
  }
  const replacementPlanFile = command === "plan-continuation" && options.has("replacement-plan")
    ? privateExternalPath(required(options, "replacement-plan"), {
      repository,
      controllerRoot,
      label: "replacement plan",
    })
    : null;
  const priorContinuationFile = command === "plan-continuation" && options.has("prior-continuation")
    ? privateExternalPath(required(options, "prior-continuation"), {
      repository,
      controllerRoot,
      label: "prior continuation plan",
    })
    : null;
  const continuationStateFile = command === "run-continuation"
    ? privateExternalPath(required(options, "continuation-state"), {
      repository,
      controllerRoot,
      label: "continuation state",
      allowAbsent: true,
    })
    : null;
  requireDistinctPaths([
    statePath,
    correctedManifestFile,
    taskAuthorityFile,
    planFile,
    outputFile,
    replacementPlanFile,
    priorContinuationFile,
    continuationStateFile,
  ].filter(Boolean));

  const inputPlan = planFile ? readJson(planFile, "plan") : null;
  const normalizeContinuationPlan = dependencies.normalizeContinuationPlan
    || normalizeSuccessorRolloverContinuationAuthorityPlan;
  const continuationPlan = command === "run-continuation"
    ? normalizeContinuationPlan(inputPlan)
    : priorContinuationFile
      ? normalizeContinuationPlan(readJson(priorContinuationFile, "prior continuation plan"))
      : null;
  const continuationRefresh = isSuccessorRolloverContinuationRefreshPlan(continuationPlan);
  const runtimeContinuationPlan = continuationRefresh
    ? continuationPlan.continuationPlanSnapshot : continuationPlan;

  const adapter = (dependencies.createAdapter
    || createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter)({
    repository,
    sourceSessionId: required(options, "source-session"),
    pullRequestNumber: positiveInteger(
      required(options, "pull-request"),
      "pull request",
    ),
    correctedManifestFile,
    taskAuthorityFile,
    statePath,
    controllerRoot,
    continuationPlan: runtimeContinuationPlan,
    continuationRefreshPlan: continuationRefresh ? continuationPlan : null,
    refreshContinuationPlan: Boolean(priorContinuationFile),
  }, dependencies.adapterDependencies || {});
  const controller = (dependencies.createController
    || createActiveDirtyScopeExpansionSuccessorRolloverController)(adapter);

  if (command === "inspect") {
    return Object.freeze({
      schema: RESULT_SCHEMA,
      status: "inspected",
      inspection: await controller.inspect(),
    });
  }

  const operatorSessionId = required(options, "operator-session");
  if (planning) {
    let plan;
    if (continuation) {
      const priorRuntimePlan = isSuccessorRolloverContinuationRefreshPlan(continuationPlan)
        ? continuationPlan.continuationPlanSnapshot : continuationPlan;
      const replacementPlan = priorRuntimePlan?.replacementPlanSnapshot
        || readJson(replacementPlanFile, "replacement plan");
      const journal = await adapter.readRecoveryJournal();
      const frame = await adapter.readContinuationFrame({ plan: replacementPlan });
      if (continuationPlan) {
        const buildRefreshPlan = dependencies.buildContinuationRefreshPlan
          || buildSuccessorRolloverContinuationRefreshPlan;
        plan = buildRefreshPlan({
          priorPlan: continuationPlan, currentJournal: journal, frame, operatorSessionId,
        });
      } else {
        const buildContinuationPlan = dependencies.buildContinuationPlan
          || buildSuccessorRolloverContinuationPlan;
        plan = buildContinuationPlan({ replacementPlan, journal, frame, operatorSessionId });
      }
    } else if (replacement) {
      plan = await controller.planReplacement({
        operatorSessionId,
        targetManifest: readJson(correctedManifestFile, "corrected manifest"),
      });
    } else {
      plan = await controller.planRetirement({ operatorSessionId });
    }
    writePrivateJsonExclusive(outputFile, plan, dependencies, "plan output");
    return Object.freeze({
      schema: RESULT_SCHEMA,
      status: "planned",
      phase: continuation ? "continuation" : replacement ? "replacement" : "retirement",
      planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization,
      planOutput: outputFile,
    });
  }

  if (continuation) {
    const receipt = await runContinuation({
      plan: continuationPlan,
      authorization: required(options, "authorization"),
      operatorSessionId,
      continuationStateFile,
      adapter,
      controller,
      dependencies,
    });
    return Object.freeze({
      schema: RESULT_SCHEMA,
      status: "complete",
      phase: "continuation",
      planDigest: continuationPlan.planDigest,
      receipt,
      authoringAuthority: false,
      deployment: false,
    });
  }

  const plan = inputPlan;
  const input = {
    plan,
    operatorSessionId,
    authorization: required(options, "authorization"),
  };
  const receipt = replacement
    ? await controller.runReplacement(input)
    : await controller.runRetirement(input);
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "complete",
    phase: replacement ? "replacement" : "retirement",
    planDigest: plan.planDigest,
    receipt,
    authoringAuthority: false,
    deployment: false,
  });
}

async function runContinuation({
  plan,
  authorization,
  operatorSessionId,
  continuationStateFile,
  adapter,
  controller,
  dependencies,
}) {
  const refresh = isSuccessorRolloverContinuationRefreshPlan(plan);
  const runtimePlan = refresh ? plan.continuationPlanSnapshot : plan;
  const authorize = dependencies.authorizeContinuation
    || (refresh ? authorizeSuccessorRolloverContinuationRefresh
      : authorizeSuccessorRolloverContinuation);
  const authorizationRecord = authorize({ plan, authorization });
  const journal = await adapter.readRecoveryJournal();
  const requireJournal = ({ current, exactCheckpoint = false }) => {
    if (dependencies.requireContinuationJournal) return dependencies.requireContinuationJournal(
      refresh ? { plan, journal: current, exactCheckpoint } : { plan, journal: current });
    return refresh
      ? requireSuccessorRolloverContinuationRefreshJournal({
        plan, journal: current, exactCheckpoint,
      })
      : requireSuccessorRolloverContinuationJournal({ plan: runtimePlan, journal: current });
  };
  if (existsSync(continuationStateFile)) {
    const normalizeAuthorization = dependencies.normalizeContinuationAuthorization
      || (refresh ? normalizeSuccessorRolloverContinuationRefreshAuthorization
        : normalizeSuccessorRolloverContinuationAuthorization);
    const stored = normalizeAuthorization(
      readJson(continuationStateFile, "continuation state"),
      { plan },
    );
    if (stored.authorizationDigest !== authorizationRecord.authorizationDigest) {
      throw new Error("Continuation state does not match the exact authorization.");
    }
    requireJournal({ current: journal });
  } else {
    if (refresh || runtimePlan.sourceJournalSnapshot) {
      requireJournal({ current: journal, exactCheckpoint: refresh });
    }
    const frame = await adapter.readContinuationFrame({
      plan: runtimePlan.replacementPlanSnapshot,
    });
    const buildContinuationPlan = dependencies.buildContinuationPlan
      || buildSuccessorRolloverContinuationPlan;
    const observed = buildContinuationPlan({
      replacementPlan: runtimePlan.replacementPlanSnapshot,
      journal: runtimePlan.sourceJournalSnapshot || journal,
      frame,
      operatorSessionId,
    });
    if (observed.planDigest !== runtimePlan.planDigest) {
      throw new Error("Successor rollover continuation frame drifted before authorization persistence.");
    }
    if (refresh) requireJournal({ current: await adapter.readRecoveryJournal(), exactCheckpoint: true });
    writePrivateJsonExclusive(
      continuationStateFile,
      authorizationRecord,
      dependencies,
      "continuation state",
    );
  }
  return controller.runReplacement({
    plan: runtimePlan.replacementPlanSnapshot,
    operatorSessionId,
    authorization: runtimePlan.replacementPlanSnapshot.exactAuthorization,
  });
}

export async function runCli(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  try {
    const result = await main(argumentsList, dependencies);
    process.stdout.write(`${JSON.stringify(
      result,
      null,
      argumentsList.includes("--json") ? 2 : 0,
    )}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA,
      status: "blocked",
      error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function rejectIrrelevantOptions(options, {
  command,
  planning,
  running,
  replacementSubject,
}) {
  const forbidden = [];
  if (!planning) forbidden.push("output");
  if (!running) forbidden.push("plan", "authorization", "task-authority");
  if (!replacementSubject) forbidden.push("corrected-manifest");
  if (command !== "plan-continuation") forbidden.push("replacement-plan");
  if (command !== "plan-continuation") forbidden.push("prior-continuation");
  if (command !== "run-continuation") forbidden.push("continuation-state");
  if (command === "inspect") forbidden.push("operator-session");
  for (const name of forbidden) {
    if (options.has(name)) {
      throw new Error(`${command} does not accept --${name}.`);
    }
  }
}

function parseOptions(argumentsList) {
  const result = new Map();
  for (const argument of argumentsList) {
    if (argument === "--json") {
      if (result.has("json")) throw new Error("--json must be provided once.");
      result.set("json", "true");
      continue;
    }
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1]) || !match[2]) {
      throw new Error(`Unsupported option: ${argument}`);
    }
    if (result.has(match[1])) {
      throw new Error(`--${match[1]} must be provided once.`);
    }
    result.set(match[1], match[2]);
  }
  return result;
}

function canonicalDirectory(value, label) {
  if (!path.isAbsolute(String(value || ""))) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const resolved = realpathSync(path.resolve(value));
  if (!lstatSync(resolved).isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return resolved;
}

function privateExternalPath(value, context) {
  const file = externalPath(value, context);
  if (!existsSync(file)) {
    if (!context.allowAbsent) throw new Error(`${context.label} is unavailable.`);
    return file;
  }
  const metadata = lstatSync(file);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || metadata.uid !== currentUid) {
    throw new Error(`${context.label} must be an owner-held, single-link, mode 0600 regular file.`);
  }
  return file;
}

function manifestPath(value, context) {
  const file = externalPath(value, { ...context, label: "corrected manifest" });
  if (!existsSync(file)) throw new Error("corrected manifest is unavailable.");
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("corrected manifest must be a single-link regular file.");
  }
  return file;
}

function externalPath(value, { repository, controllerRoot, label }) {
  if (!path.isAbsolute(String(value || ""))) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const requested = path.resolve(value);
  rejectSymlinkTraversal(requested, label);
  const resolved = physicalPath(requested);
  for (const root of [repository, controllerRoot]) {
    const relative = path.relative(root, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error(`${label} must remain outside source and controller worktrees.`);
    }
  }
  return resolved;
}

function rejectSymlinkTraversal(value, label) {
  const parsed = path.parse(value);
  let current = parsed.root;
  for (const segment of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} cannot traverse a symbolic link.`);
    }
  }
}

function physicalPath(value) {
  let ancestor = value;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return value;
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), path.relative(ancestor, value));
}

function readJson(file, label) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not one object");
    }
    return value;
  } catch {
    throw new Error(`${label} must contain one valid JSON object.`);
  }
}

function writePrivateJsonExclusive(file, value, dependencies, label) {
  if (typeof dependencies.writePlan === "function") {
    dependencies.writePlan({ file, value });
    return;
  }
  let descriptor;
  try {
    descriptor = openSync(file, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if ((lstatSync(file).mode & 0o777) !== 0o600) {
    throw new Error(`${label} permissions are not private.`);
  }
}

function requireDistinctPaths(values) {
  if (new Set(values).size !== values.length) {
    throw new Error("State, plans, manifest, continuation, and task-authority paths must be distinct.");
  }
}

function required(options, name) {
  const value = options.get(name);
  if (!value || value !== value.trim()) {
    throw new Error(`--${name}=<value> is required.`);
  }
  return value;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return result;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 1_000);
}

function usage() {
  return "Usage: active-dirty-scope-expansion-successor-rollover.mjs "
    + "<inspect|plan-retirement|run-retirement|plan-replacement|run-replacement|"
    + "plan-continuation|run-continuation> "
    + "--repository=<source-worktree> --source-session=<id> --pull-request=<number> "
    + "--state-path=<external-private-json> [--operator-session=<id>] "
    + "[--corrected-manifest=<external-json>] [--output=<external-private-plan>] "
    + "[--replacement-plan=<external-private-replacement-plan>] "
    + "[--prior-continuation=<external-private-continuation-plan>] "
    + "[--plan=<external-private-plan> --task-authority=<external-private-capability> "
    + "--authorization=<exact-text>] [--continuation-state=<external-private-json>] "
    + "[--controller-root=<protected-controller>] [--json]";
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
