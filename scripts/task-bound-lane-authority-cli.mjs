#!/usr/bin/env node
// Responsibility: Expose secure capability issuance and exact clean-lane migration,
// handoff, or same-subject rebind transitions.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  canonicalJson,
  createTaskAuthorityTransitionPlan,
  normalizeTaskAuthorityBinding,
  projectTaskAuthorityCapability,
  TASK_AUTHORITY_TRANSITION_PLAN_SCHEMA,
} from "./task-bound-lane-authority-contract.mjs";
import {
  bindDeliveryTaskAuthorityMigration,
  publicTaskAuthorityStatus,
  readTaskAuthorityCapability,
  writeTaskAuthorityCapability,
} from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const [command, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (command === "issue") emit(issue());
  else if (command === "inspect") emit(inspect());
  else if (command === "plan-migration") emit(planTransition("migration"));
  else if (command === "migrate") emit(runTransition("migration"));
  else if (command === "plan-handoff") emit(planTransition("handoff"));
  else if (command === "handoff") emit(runTransition("handoff"));
  else if (command === "plan-rebind") emit(planTransition("rebind"));
  else if (command === "rebind") emit(runTransition("rebind"));
  else usage();
} catch (error) {
  if (!json) throw error;
  console.log(JSON.stringify({
    schema: "agentic-task-authority-cli-result/v1",
    ok: false,
    command: command || null,
    error: publicError(error),
  }));
  process.exitCode = 1;
}

function issue() {
  const outputPath = requiredOption("output");
  const generation = Number(option("generation") || 1);
  const authoritySubjectId = option("subject") || undefined;
  const issued = writeTaskAuthorityCapability({
    outputPath,
    authoritySubjectId,
    generation,
  });
  return {
    schema: "agentic-task-authority-cli-result/v1",
    ok: true,
    command: "issue",
    status: "issued",
    capabilityPath: issued.path,
    capability: issued.capability,
  };
}

function inspect() {
  const context = repositoryContext({
    authorityPolicy: "projected",
    requireSession: false,
  });
  return {
    schema: "agentic-task-authority-cli-result/v1",
    ok: true,
    command: "inspect",
    branch: context.branch,
    leaseEpoch: context.lease?.epoch || null,
    taskAuthority: publicTaskAuthorityStatus(context.lease),
  };
}

function planTransition(operation) {
  const targetCapabilityPath = operation === "migration"
    ? requiredOption("capability")
    : requiredOption("target-capability");
  const context = transitionContext({ operation, targetCapabilityPath });
  const plan = createTransitionPlan({ operation, context });
  const outputPath = requiredOption("output");
  writePlan(outputPath, plan);
  return {
    schema: "agentic-task-authority-cli-result/v1",
    ok: true,
    command: `plan-${operation}`,
    status: "planned",
    planPath: path.resolve(outputPath),
    planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization,
    plan,
  };
}

function runTransition(operation) {
  const planPath = requiredOption("plan");
  const storedPlan = readPlan(planPath);
  if (storedPlan.operation !== operation) {
    throw new Error("Task authority transition plan operation changed.");
  }
  const targetCapabilityPath = operation === "migration"
    ? requiredOption("capability")
    : requiredOption("target-capability");
  const context = transitionContext({ operation, targetCapabilityPath });
  const currentPlan = createTransitionPlan({
    operation,
    context,
    plannedAt: storedPlan.plannedAt,
  });
  if (canonicalJson(currentPlan) !== canonicalJson(storedPlan)) {
    throw new Error("Task authority transition plan is not exact-current.");
  }
  const authorization = requiredOption("authorize");
  if (authorization !== storedPlan.exactAuthorization) {
    throw new Error("Task authority transition requires its exact authorization.");
  }
  const boundAt = new Date().toISOString();
  const lease = operation === "migration"
    ? context.lease.status === "delivery"
      ? bindDeliveryTaskAuthorityMigration({
        leaseStore: context.leaseStore,
        sessionId: context.sessionId,
        branch: context.branch,
        targetCapabilityFile: targetCapabilityPath,
        planDigest: storedPlan.planDigest,
        boundAt,
      })
      : context.leaseStore.bindTaskAuthority({
        sessionId: context.sessionId,
        branch: context.branch,
        targetCapabilityFile: targetCapabilityPath,
        planDigest: storedPlan.planDigest,
        boundAt,
      })
    : operation === "rebind"
      ? context.leaseStore.rebindTaskAuthority({
        sessionId: context.sessionId,
        branch: context.branch,
        targetCapabilityFile: targetCapabilityPath,
        planDigest: storedPlan.planDigest,
        boundAt,
      })
      : context.leaseStore.handoffTaskAuthority({
        sessionId: context.sessionId,
        branch: context.branch,
        sourceCapabilityFile: requiredOption("source-capability"),
        targetCapabilityFile: targetCapabilityPath,
        planDigest: storedPlan.planDigest,
        boundAt,
      });
  return {
    schema: "agentic-task-authority-cli-result/v1",
    ok: true,
    command: operation,
    status: "bound",
    branch: context.branch,
    leaseEpoch: lease.epoch,
    taskAuthority: publicTaskAuthorityStatus(lease),
    planDigest: storedPlan.planDigest,
  };
}

function transitionContext({ operation, targetCapabilityPath }) {
  const sourceCapabilityPath = operation === "handoff"
    ? requiredOption("source-capability")
    : null;
  const context = repositoryContext({
    authorityPolicy: "projected",
    taskAuthorityFile: sourceCapabilityPath,
  });
  assertExternalCapability(targetCapabilityPath, context.repository);
  if (sourceCapabilityPath) {
    assertExternalCapability(sourceCapabilityPath, context.repository);
  }
  const deliveryMigration = operation === "migration"
    && context.lease?.status === "delivery"
    && !context.lease.taskAuthority;
  if (!context.lease || (context.lease.status !== "active" && !deliveryMigration)) {
    throw new Error("Task authority transition requires an active writer lease or an unbound delivery lease migration.");
  }
  if (context.lease.sessionId !== context.sessionId) {
    throw new Error("Task authority transition session does not match the writer lease.");
  }
  // Rebind is expiry-agnostic because it confers nothing: it re-anchors an
  // existing subject and leaves status, expiry, and content untouched, so it
  // cannot revive anything. Refusing it on an expired lease would make expiry plus
  // drift jointly unrecoverable, since renewal itself asserts the drifted binding.
  if (operation !== "rebind"
    && context.lease.status === "active"
    && Date.parse(context.lease.expiresAt) <= Date.now()) {
    throw new Error("Task authority transition cannot revive an expired writer lease.");
  }
  if (path.resolve(context.lease.worktreePath) !== context.repository) {
    throw new Error("Task authority transition must run in the leased worktree.");
  }
  // A rebind moves no authority and touches no working tree, so requiring a clean
  // lane would deny the repair exactly when the lane is holding the uncommitted
  // work the drifted binding is refusing to record.
  if (context.statusPorcelain && operation !== "rebind") {
    throw new Error("Dirty lanes cannot migrate or transfer task authority.");
  }
  const targetCapability = readTaskAuthorityCapability(targetCapabilityPath);
  if (operation === "migration" && targetCapability.generation !== 1) {
    throw new Error("Task authority migration begins at generation 1.");
  }
  return { ...context, sourceCapabilityPath, targetCapability };
}

function createTransitionPlan({ operation, context, plannedAt }) {
  return createTaskAuthorityTransitionPlan({
    operation,
    lease: context.lease,
    headSha: context.headSha,
    worktreeStateDigest: digestValue({
      repository: context.repository,
      branch: context.branch,
      headSha: context.headSha,
      statusPorcelain: context.statusPorcelain,
    }),
    targetCapability: context.targetCapability,
    currentBinding: normalizeTaskAuthorityBinding(context.lease.taskAuthority),
    ...(plannedAt ? { plannedAt } : {}),
  });
}

function repositoryContext({
  authorityPolicy,
  taskAuthorityFile = null,
  requireSession = true,
}) {
  const sessionId = requireSession ? requiredOption("session") : option("session");
  const invocation = path.resolve(requiredOption("repository"));
  const repository = git(invocation, ["rev-parse", "--show-toplevel"]);
  const branch = git(repository, ["branch", "--show-current"]);
  if (!branch) throw new Error("Task authority command requires an attached task branch.");
  const commonDirectory = path.resolve(
    repository,
    git(repository, ["rev-parse", "--git-common-dir"]),
  );
  const leaseStore = createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: authorityPolicy,
  });
  return {
    repository,
    branch,
    sessionId,
    headSha: git(repository, ["rev-parse", "HEAD"]),
    statusPorcelain: git(repository, ["status", "--porcelain=v1"]),
    leaseStore,
    lease: leaseStore.read(branch),
  };
}

function writePlan(outputPath, plan) {
  const target = path.resolve(outputPath);
  if (!path.isAbsolute(outputPath)) throw new Error("Transition plan path must be absolute.");
  if (existsSync(target)) throw new Error("Transition plan output already exists.");
  const parent = lstatSync(path.dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Transition plan parent must be a real directory.");
  }
  writeFileSync(target, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function assertExternalCapability(capabilityPath, repository) {
  const candidate = path.resolve(capabilityPath);
  const root = `${path.resolve(repository)}${path.sep}`;
  if (candidate === path.resolve(repository) || candidate.startsWith(root)) {
    throw new Error("Task authority capability must remain outside the repository.");
  }
}

function readPlan(planPath) {
  const target = path.resolve(planPath);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Transition plan must be a regular non-symlink file.");
  }
  const plan = JSON.parse(readFileSync(target, "utf8"));
  if (plan?.schema !== TASK_AUTHORITY_TRANSITION_PLAN_SCHEMA) {
    throw new Error("Unsupported task authority transition plan schema.");
  }
  return plan;
}

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function option(name) {
  const prefix = `--${name}=`;
  return argumentsList.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function emit(result) {
  console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
}

function publicError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}

function usage() {
  throw new Error(
    "Usage: task-bound-lane-authority-cli.mjs issue|inspect|plan-migration|migrate|plan-handoff|handoff|plan-rebind|rebind [exact options] [--json]",
  );
}
