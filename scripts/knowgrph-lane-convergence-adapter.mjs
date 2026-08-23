// Responsibility: Adapt the exact preserved Knowgrph lanes to the atomic convergence controller.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { createTransitionDecision } from "./lane-convergence-transaction-contract.mjs";
import {
  ACTIONS,
  ACTION_EFFECTS,
  describeKnowgrphLaneConvergenceAdapter,
  normalizeKnowgrphAdapterConfiguration,
} from "./knowgrph-lane-convergence-adapter-contract.mjs";

const SHA = /^[0-9a-f]{40}$/u;

export function describe() { return describeKnowgrphLaneConvergenceAdapter(); }

export async function createAdapter({ plan, configuration, dependencies } = {}) {
  const config = normalizeKnowgrphAdapterConfiguration(configuration, plan);
  const repository = dependencies || createRepositoryBoundary(config);

  async function observe() {
    return normalizeObservation(await repository.observe({ plan, configuration: config }), plan);
  }

  async function next({ observation: rawObservation }) {
    const observation = normalizeObservation(rawObservation, plan);
    const states = new Map(observation.subjects.map((subject) => [subject.subjectId, subject]));
    for (const subject of plan.subjects) {
      const state = states.get(subject.subjectId);
      if (terminal(state)) continue;
      if (!subject.dependencies.every((dependency) => terminal(states.get(dependency)))) continue;
      if (state.pullRequestState === "CLOSED" && !state.merged) {
        throw new Error(`Knowgrph subject ${subject.subjectId} has a closed unmerged review.`);
      }
      const configured = subjectConfiguration(config, subject.subjectId);
      if (needsAuthorityRecovery(state, configured)) {
        return decision(plan, subject.subjectId, ACTIONS.reconcileAuthority, observation);
      }
      if (!state.merged) return decision(plan, subject.subjectId, ACTIONS.integrateSource, observation);
      if (!state.contained) throw new Error(`Knowgrph subject ${subject.subjectId} merge is outside protected main.`);
      if (state.worktreePresent) return decision(plan, subject.subjectId, ACTIONS.cleanupWorktree, observation);
    }
    if (!observation.subjects.every(terminal)) {
      throw new Error("Knowgrph lane convergence has no dependency-ready transition.");
    }
    return Object.freeze({ kind: "terminal", terminal: { observationDigest: observation.observationDigest } });
  }

  async function classify({ decision: transition }) {
    const observation = await observe();
    const subject = observation.subjects.find((candidate) => candidate.subjectId === transition.subjectId);
    const complete = transition.action === ACTIONS.reconcileAuthority
      ? authorityCurrent(subject)
      : transition.action === ACTIONS.integrateSource
        ? subject.merged && subject.contained
        : !subject.worktreePresent;
    return complete
      ? Object.freeze({ state: "complete", evidence: classificationEvidence(transition, subject, observation) })
      : Object.freeze({ state: "pending" });
  }

  async function execute({ decision: transition, grant }) {
    assertGrant(transition, grant);
    const subject = subjectConfiguration(config, transition.subjectId);
    if (transition.action === ACTIONS.reconcileAuthority) {
      return repository.reconcileAuthority({ subject, grant });
    }
    if (transition.action === ACTIONS.integrateSource) {
      return repository.integrateSource({ subject, grant });
    }
    return repository.cleanupWorktree({ subject, grant });
  }

  async function verifyTransition({ decision: transition, classification }) {
    if (!classification || classification.subjectId !== transition.subjectId
      || classification.action !== transition.action) {
      throw new Error("Knowgrph transition classification does not match its decision.");
    }
    const core = {
      schema: "agentic-knowgrph-lane-convergence-transition-receipt/v1",
      operationKey: transition.operationKey,
      transitionDigest: transition.transitionDigest,
      status: "complete",
      evidenceDigest: digestValue(classification),
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  async function verifyTerminal() {
    const observation = await observe();
    if (!observation.subjects.every(terminal)) {
      throw new Error("Knowgrph terminal verification requires every subject merged, contained, and absent.");
    }
    const subjects = plan.subjects.map((subject) => {
      const state = observation.subjects.find((candidate) => candidate.subjectId === subject.subjectId);
      return Object.freeze({ subjectId: subject.subjectId, state: subject.targetState,
        evidenceDigest: digestValue(state) });
    });
    const supportedReceipts = {
      integration: digestValue(observation.subjects.map(({ subjectId, integrationSha, canonicalSha }) =>
        ({ subjectId, integrationSha, canonicalSha }))),
      cleanup: digestValue(observation.subjects.map(({ subjectId, worktreePresent }) =>
        ({ subjectId, worktreePresent }))),
    };
    const receipts = plan.terminalReceiptTypes.map((type) => {
      if (!supportedReceipts[type]) throw new Error(`Unsupported Knowgrph terminal receipt type: ${type}`);
      return Object.freeze({ type, receiptDigest: supportedReceipts[type] });
    });
    const core = { subjects, receipts, completedAt: observation.observedAt };
    return Object.freeze({ ...core, terminalDigest: digestValue(core) });
  }

  return Object.freeze({ observe, next, classify, execute, verifyTransition, verifyTerminal });
}

function createRepositoryBoundary(config) {
  return Object.freeze({
    observe: () => observeRepository(config),
    reconcileAuthority: ({ subject }) => reconcileAuthority(config, subject),
    integrateSource: ({ subject }) => integrateSource(config, subject),
    cleanupWorktree: ({ subject }) => cleanupWorktree(config, subject),
  });
}

function observeRepository(config) {
  const lifecycle = runJson(process.execPath, [path.join(config.controllerRoot,
    "scripts/worktree-lifecycle.mjs"), "check", `--repository=${config.canonicalRepository}`],
  { cwd: config.canonicalRepository, acceptFailure: true });
  const canonicalSha = git(config.canonicalRepository, ["rev-parse", "origin/main"]);
  const observedAt = new Date().toISOString();
  const subjects = config.subjects.map((subject) => {
    const worktree = lifecycle.worktrees?.find((item) => path.resolve(item.path) === subject.worktreePath) || null;
    const pathPresent = existsSync(subject.worktreePath);
    if (pathPresent !== Boolean(worktree)) {
      throw new Error(`Knowgrph worktree registration disagrees with its path: ${subject.subjectId}`);
    }
    const review = runJson("gh", ["pr", "view", subject.pullRequestUrl, "--json",
      "state,isDraft,mergedAt,mergeCommit,headRefOid,url"], { cwd: config.canonicalRepository });
    const merged = Boolean(review.mergedAt && review.mergeCommit?.oid);
    const integrationSha = merged ? requiredSha(review.mergeCommit.oid, "merge commit") : null;
    const contained = integrationSha
      ? commandStatus("git", ["-C", config.canonicalRepository, "merge-base", "--is-ancestor",
        integrationSha, "origin/main"]) === 0
      : false;
    return {
      subjectId: subject.subjectId,
      worktreePresent: Boolean(worktree),
      lifecycleState: worktree?.state || null,
      leaseStatus: worktree?.lease?.status || null,
      localAuthorityCurrent: currentAuthority(worktree?.lease, observedAt, ["active"]),
      cloudAuthorityCurrent: currentAuthority(worktree?.lease?.cloudAuthority, observedAt, ["active"]),
      dirty: Boolean(worktree && !["review-ready", "canonical", "cleanup-eligible"].includes(worktree.state)),
      pullRequestState: review.state,
      headSha: requiredSha(review.headRefOid, "review head"),
      integrationSha,
      canonicalSha: requiredSha(canonicalSha, "canonical SHA"),
      contained,
      merged,
    };
  });
  return { observedAt, subjects };
}

function reconcileAuthority(config, subject) {
  if (subject.authorityRecovery !== "active-owned-dirt-reclaim") {
    throw new Error(`No authority recovery is registered for ${subject.subjectId}.`);
  }
  const script = path.join(config.controllerRoot, "scripts/active-owned-dirt-recovery.mjs");
  const common = [`--repository=${subject.worktreePath}`, `--session=${subject.sessionId}`,
    `--task-authority=${subject.taskAuthorityPath}`, "--json"];
  const planned = runJson(process.execPath, [script, "plan", ...common], { cwd: subject.worktreePath });
  if (!planned.exactAuthorization) throw new Error("Owned-dirt recovery did not emit exact authorization.");
  return runJson(process.execPath, [script, "execute", ...common,
    `--authorize=${planned.exactAuthorization}`], { cwd: subject.worktreePath });
}

function integrateSource(config, subject) {
  const argumentsList = [path.join(config.controllerRoot, "scripts/device-branch.mjs"), "integrate",
    `--session=${subject.sessionId}`, `--repository=${subject.worktreePath}`,
    `--task-authority=${subject.taskAuthorityPath}`, "--runtime=none", "--json"];
  if (subject.commitMessage) argumentsList.push(`--commit-message=${subject.commitMessage}`,
    `--paths-manifest=${subject.changeManifestPath}`);
  return runJson(process.execPath, argumentsList, { cwd: subject.worktreePath });
}

function cleanupWorktree(config, subject) {
  return runJson(process.execPath, [path.join(config.controllerRoot, "scripts/worktree-lifecycle.mjs"),
    "cleanup", `--repository=${config.canonicalRepository}`, `--worktree=${subject.worktreePath}`],
  { cwd: config.canonicalRepository });
}

function decision(plan, subjectId, action, observation) {
  return createTransitionDecision({ plan, subjectId, action,
    operationKey: `${action}:${subjectId}`,
    preconditionDigest: digestValue({ subjectId, action, observationDigest: observation.observationDigest }),
    effects: ACTION_EFFECTS[action] });
}
function normalizeObservation(value, plan) {
  if (!value || !Array.isArray(value.subjects) || value.subjects.length !== plan.subjects.length) {
    throw new Error("Knowgrph adapter observation is malformed.");
  }
  const observedAt = instant(value.observedAt);
  const subjects = value.subjects.map((subject) => normalizeSubjectObservation(subject, plan));
  if (new Set(subjects.map((subject) => subject.subjectId)).size !== subjects.length) {
    throw new Error("Knowgrph adapter observation repeats a subject.");
  }
  const core = { observedAt, subjects };
  return Object.freeze({ ...core, observationDigest: digestValue(core) });
}
function normalizeSubjectObservation(value, plan) {
  const expected = plan.subjects.find((subject) => subject.subjectId === value?.subjectId);
  if (!expected || !["OPEN", "CLOSED", "MERGED"].includes(value.pullRequestState)) {
    throw new Error("Knowgrph subject observation is malformed.");
  }
  for (const key of ["worktreePresent", "localAuthorityCurrent", "cloudAuthorityCurrent",
    "dirty", "contained", "merged"]) if (typeof value[key] !== "boolean") {
    throw new Error(`Knowgrph subject observation has invalid ${key}.`);
  }
  return Object.freeze({ subjectId: value.subjectId, worktreePresent: value.worktreePresent,
    lifecycleState: value.lifecycleState ?? null, leaseStatus: value.leaseStatus ?? null,
    localAuthorityCurrent: value.localAuthorityCurrent,
    cloudAuthorityCurrent: value.cloudAuthorityCurrent, dirty: value.dirty,
    pullRequestState: value.pullRequestState, headSha: requiredSha(value.headSha, "subject head"),
    integrationSha: value.integrationSha === null ? null : requiredSha(value.integrationSha, "integration SHA"),
    canonicalSha: requiredSha(value.canonicalSha, "canonical SHA"),
    contained: value.contained, merged: value.merged });
}
function classificationEvidence(transition, subject, observation) { return Object.freeze({
  subjectId: subject.subjectId, action: transition.action, operationKey: transition.operationKey,
  subject, observationDigest: observation.observationDigest,
}); }
function needsAuthorityRecovery(state, subject) { return !state.merged
  && subject.authorityRecovery !== "none" && !authorityCurrent(state); }
function authorityCurrent(subject) { return subject.localAuthorityCurrent && subject.cloudAuthorityCurrent; }
function terminal(subject) { return Boolean(subject?.merged && subject.contained && !subject.worktreePresent); }
function subjectConfiguration(config, subjectId) { const result = config.subjects.find((subject) => subject.subjectId === subjectId);
  if (!result) throw new Error(`Knowgrph adapter has no configuration for ${subjectId}.`); return result; }
function assertGrant(decisionValue, grant) { if (grant?.subjectId !== decisionValue.subjectId
  || grant?.action !== decisionValue.action || grant?.transitionDigest !== decisionValue.transitionDigest) {
  throw new Error("Knowgrph adapter internal grant does not match its transition.");
} }
function currentAuthority(value, observedAt, states) { return Boolean(value && states.includes(value.status || value.state)
  && Date.parse(value.expiresAt) > Date.parse(observedAt)); }
function requiredSha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`Invalid ${label}.`); return value; }
function instant(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("Invalid observation time."); return date.toISOString(); }
function git(repository, args) { return runText("git", ["-C", repository, ...args], { cwd: repository }); }
function commandStatus(program, args) { return spawnSync(program, args, { stdio: "ignore" }).status; }
function runText(program, args, options) { const result = spawnSync(program, args, { ...options, encoding: "utf8" });
  if (result.status !== 0) throw new Error(publicFailure(program, result)); return result.stdout.trim(); }
function runJson(program, args, { acceptFailure = false, ...options } = {}) {
  const result = spawnSync(program, args, { ...options, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let parsed;
  try { parsed = JSON.parse(result.stdout.trim()); } catch { throw new Error(publicFailure(program, result)); }
  if (result.status !== 0 && !acceptFailure) throw new Error(parsed?.error?.message || publicFailure(program, result));
  return parsed;
}
function publicFailure(program, result) { return `${path.basename(program)} failed (${result.status ?? "signal"}): ${String(result.stderr || "").trim().slice(0, 500)}`; }
