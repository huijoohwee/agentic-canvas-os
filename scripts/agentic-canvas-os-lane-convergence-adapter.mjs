// Responsibility: Converge protected Agentic Canvas OS lanes through repository-owned controllers.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { createTransitionDecision } from "./lane-convergence-transaction-contract.mjs";
import { ACTIONS, ACTION_EFFECTS, describeAgenticCanvasOsLaneConvergenceAdapter,
  normalizeAgenticCanvasOsAdapterConfiguration }
  from "./agentic-canvas-os-lane-convergence-adapter-contract.mjs";

const SHA = /^[0-9a-f]{40}$/u;
export function describe() { return describeAgenticCanvasOsLaneConvergenceAdapter(); }

export async function createAdapter({ plan, configuration, dependencies } = {}) {
  const config = normalizeAgenticCanvasOsAdapterConfiguration(configuration, plan);
  const repository = dependencies || createRepositoryBoundary(config);

  async function observe() { return normalizeObservation(await repository.observe({ plan }), plan); }
  async function next({ observation: raw }) {
    const observation = normalizeObservation(raw, plan);
    const states = new Map(observation.subjects.map((subject) => [subject.subjectId, subject]));
    for (const subject of plan.subjects) {
      const state = states.get(subject.subjectId);
      if (state.pullRequestState === "CLOSED" && !state.merged) {
        throw new Error(`Agentic Canvas OS subject ${subject.subjectId} has a closed unmerged review.`);
      }
      if (state.merged) continue;
      if (!subject.dependencies.every((dependency) => mergedAndContained(states.get(dependency)))) continue;
      const configured = subjectConfiguration(config, subject.subjectId);
      if (configured.recoveryMode === "planned-start-response-ahead" && !state.projectionAligned) {
        return decision(plan, subject.subjectId, ACTIONS.projectStartAuthority, observation);
      }
      if (configured.recoveryMode === "planned-start-response-ahead"
        && state.admissionStatus === "planned") {
        return decision(plan, subject.subjectId, ACTIONS.admitStart, observation);
      }
      return decision(plan, subject.subjectId, ACTIONS.integrateSource, observation);
    }
    if (!observation.subjects.every(mergedAndContained)) {
      throw new Error("Agentic Canvas OS lane convergence has no dependency-ready transition.");
    }
    for (const subject of [...plan.subjects].reverse()) {
      const state = states.get(subject.subjectId);
      if (state.worktreePresent) {
        return decision(plan, subject.subjectId, ACTIONS.cleanupWorktree, observation);
      }
    }
    return Object.freeze({ kind: "terminal", terminal: {
      observationDigest: observation.observationDigest } });
  }
  async function classify({ decision: transition }) {
    const observation = await observe();
    const subject = observation.subjects.find(({ subjectId }) => subjectId === transition.subjectId);
    const complete = transition.action === ACTIONS.projectStartAuthority ? subject.projectionAligned
      : transition.action === ACTIONS.admitStart ? subject.admissionStatus === "admitted"
        : transition.action === ACTIONS.integrateSource ? mergedAndContained(subject)
          : !subject.worktreePresent;
    return complete ? Object.freeze({ state: "complete",
      evidence: classificationEvidence(transition, subject, observation) })
      : Object.freeze({ state: "pending" });
  }
  async function execute({ decision: transition, grant }) {
    assertGrant(transition, grant);
    const subject = subjectConfiguration(config, transition.subjectId);
    if (transition.action === ACTIONS.projectStartAuthority) return repository.projectStartAuthority({ subject });
    if (transition.action === ACTIONS.admitStart) return repository.admitStart({ subject });
    if (transition.action === ACTIONS.integrateSource) return repository.integrateSource({ subject });
    return repository.cleanupWorktree({ subject });
  }
  async function verifyTransition({ decision: transition, classification }) {
    if (classification?.subjectId !== transition.subjectId || classification?.action !== transition.action) {
      throw new Error("Agentic Canvas OS transition classification does not match its decision.");
    }
    const core = { schema: "agentic-canvas-os-lane-convergence-transition-receipt/v1",
      operationKey: transition.operationKey, transitionDigest: transition.transitionDigest,
      status: "complete", evidenceDigest: digestValue(classification) };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }
  async function verifyTerminal() {
    const observation = await observe();
    if (!observation.subjects.every(terminal)) {
      throw new Error("Agentic Canvas OS terminal verification requires merged, contained, absent subjects.");
    }
    const subjects = plan.subjects.map(({ subjectId, targetState }) => Object.freeze({ subjectId,
      state: targetState, evidenceDigest: digestValue(observation.subjects.find((item) =>
        item.subjectId === subjectId)) }));
    const supported = { integration: digestValue(observation.subjects.map(({ subjectId,
      integrationSha, canonicalSha }) => ({ subjectId, integrationSha, canonicalSha }))),
    cleanup: digestValue(observation.subjects.map(({ subjectId, worktreePresent }) =>
      ({ subjectId, worktreePresent }))) };
    const receipts = plan.terminalReceiptTypes.map((type) => {
      if (!supported[type]) throw new Error(`Unsupported Agentic Canvas OS receipt type: ${type}`);
      return Object.freeze({ type, receiptDigest: supported[type] });
    });
    const core = { subjects, receipts, completedAt: observation.observedAt };
    return Object.freeze({ ...core, terminalDigest: digestValue(core) });
  }
  return Object.freeze({ observe, next, classify, execute, verifyTransition, verifyTerminal });
}

function createRepositoryBoundary(config) { return Object.freeze({
  observe: () => observeRepository(config),
  projectStartAuthority: ({ subject }) => projectStartAuthority(config, subject),
  admitStart: ({ subject }) => admitStart(config, subject),
  integrateSource: ({ subject }) => integrateSource(config, subject),
  cleanupWorktree: ({ subject }) => cleanupWorktree(config, subject),
}); }

function observeRepository(config) {
  const canonicalSha = git(config.canonicalRepository, ["rev-parse", "origin/main"]);
  const observedAt = new Date().toISOString();
  const subjects = config.subjects.map((subject) => {
    const lifecycle = runJson(process.execPath, [path.join(config.controllerRoot,
      "scripts/worktree-lifecycle.mjs"), "check", `--repository=${subject.lifecycleRepository}`],
    { cwd: subject.lifecycleRepository, acceptFailure: true });
    const worktree = lifecycle.worktrees?.find((item) => path.resolve(item.path) === subject.worktreePath) || null;
    if (existsSync(subject.worktreePath) !== Boolean(worktree)) {
      throw new Error(`Agentic Canvas OS registration disagrees with path: ${subject.subjectId}`);
    }
    const review = runJson("gh", ["pr", "view", subject.pullRequestUrl, "--json",
      "state,isDraft,mergedAt,mergeCommit,headRefOid,url,id"], { cwd: config.canonicalRepository });
    const merged = Boolean(review.mergedAt && review.mergeCommit?.oid);
    const integrationSha = merged ? requiredSha(review.mergeCommit.oid, "merge commit") : null;
    const contained = integrationSha ? commandStatus("git", ["-C", config.canonicalRepository,
      "merge-base", "--is-ancestor", integrationSha, "origin/main"]) === 0 : false;
    const lease = worktree?.lease || null;
    const authority = lease?.cloudAuthority || null;
    const reviewRequestId = review.id ? `github-pull-request:${review.id}` : null;
    const projectionAligned = Boolean(authority && authority.laneRevision === lease.fenceSha
      && authority.reviewRequestId === reviewRequestId && authority.transitionCounter >= 2);
    return { subjectId: subject.subjectId, worktreePresent: Boolean(worktree),
      lifecycleState: worktree?.state || null, admissionStatus: lease?.admission?.status || null,
      projectionAligned, pullRequestState: review.state,
      headSha: requiredSha(review.headRefOid, "review head"), integrationSha,
      canonicalSha: requiredSha(canonicalSha, "canonical SHA"), contained, merged };
  });
  return { observedAt, subjects };
}

function projectStartAuthority(config, subject) {
  const common = [`--repository=${subject.worktreePath}`, `--session=${subject.sessionId}`];
  const planned = runJson(process.execPath, [path.join(config.controllerRoot,
    "scripts/planned-start-fence-projection-recovery.mjs"), "plan", ...common, "--json"],
  { cwd: subject.worktreePath });
  const planFile = artifact(config, subject, "fence-projection-plan", planned);
  return runJson(process.execPath, [path.join(config.controllerRoot,
    "scripts/planned-start-fence-projection-recovery.mjs"), "run", ...common,
    `--plan-file=${planFile}`, `--task-authority=${subject.taskAuthorityPath}`, "--json"],
  { cwd: subject.worktreePath });
}
function admitStart(config, subject) {
  const common = [`--repository=${subject.worktreePath}`, `--session=${subject.sessionId}`,
    `--task-authority=${subject.taskAuthorityPath}`, "--json"];
  const planned = runJson(process.execPath, [path.join(config.controllerRoot,
    "scripts/device-branch.mjs"), "recover-start-admission", "plan", ...common],
  { cwd: subject.worktreePath });
  const planFile = artifact(config, subject, "start-admission-plan", planned.plan);
  return runJson(process.execPath, [path.join(config.controllerRoot,
    "scripts/device-branch.mjs"), "recover-start-admission", "execute", ...common,
    `--plan=${planFile}`, `--authorization=${planned.authorization}`], { cwd: subject.worktreePath });
}
function integrateSource(config, subject) {
  return runJson(process.execPath, [path.join(config.controllerRoot, "scripts/device-branch.mjs"),
    "integrate", `--session=${subject.sessionId}`, `--repository=${subject.worktreePath}`,
    `--task-authority=${subject.taskAuthorityPath}`, "--runtime=none", "--json"],
  { cwd: subject.worktreePath });
}
function cleanupWorktree(config, subject) {
  return runJson(process.execPath, [path.join(config.controllerRoot, "scripts/worktree-lifecycle.mjs"),
    "cleanup", `--repository=${subject.lifecycleRepository}`, `--worktree=${subject.worktreePath}`],
  { cwd: subject.lifecycleRepository });
}
function artifact(config, subject, suffix, value) {
  mkdirSync(config.artifactDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(config.artifactDirectory, `${subject.subjectId}-${suffix}.json`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(file)) {
    if (readFileSync(file, "utf8") !== bytes) throw new Error(`Convergence artifact drifted: ${file}`);
  } else writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
  return file;
}
function decision(plan, subjectId, action, observation) { return createTransitionDecision({ plan,
  subjectId, action, operationKey: `${action}:${subjectId}`,
  preconditionDigest: digestValue({ subjectId, action, observationDigest: observation.observationDigest }),
  effects: ACTION_EFFECTS[action] }); }
function normalizeObservation(value, plan) {
  if (!value || !Array.isArray(value.subjects) || value.subjects.length !== plan.subjects.length) {
    throw new Error("Agentic Canvas OS adapter observation is malformed.");
  }
  const subjects = value.subjects.map((subject) => normalizeSubjectObservation(subject, plan));
  if (new Set(subjects.map(({ subjectId }) => subjectId)).size !== subjects.length) {
    throw new Error("Agentic Canvas OS adapter observation repeats a subject.");
  }
  const core = { observedAt: instant(value.observedAt), subjects };
  return Object.freeze({ ...core, observationDigest: digestValue(core) });
}
function normalizeSubjectObservation(value, plan) {
  if (!plan.subjects.some(({ subjectId }) => subjectId === value?.subjectId)
    || !["OPEN", "CLOSED", "MERGED"].includes(value.pullRequestState)) {
    throw new Error("Agentic Canvas OS subject observation is malformed.");
  }
  for (const key of ["worktreePresent", "projectionAligned", "contained", "merged"]) {
    if (typeof value[key] !== "boolean") throw new Error(`Invalid subject ${key}.`);
  }
  return Object.freeze({ subjectId: value.subjectId, worktreePresent: value.worktreePresent,
    lifecycleState: value.lifecycleState ?? null, admissionStatus: value.admissionStatus ?? null,
    projectionAligned: value.projectionAligned, pullRequestState: value.pullRequestState,
    headSha: requiredSha(value.headSha, "subject head"),
    integrationSha: value.integrationSha === null ? null : requiredSha(value.integrationSha, "integration SHA"),
    canonicalSha: requiredSha(value.canonicalSha, "canonical SHA"),
    contained: value.contained, merged: value.merged });
}
function classificationEvidence(transition, subject, observation) { return Object.freeze({
  subjectId: subject.subjectId, action: transition.action, operationKey: transition.operationKey,
  subject, observationDigest: observation.observationDigest }); }
function mergedAndContained(subject) { return Boolean(subject?.merged && subject.contained); }
function terminal(subject) { return Boolean(mergedAndContained(subject) && !subject.worktreePresent); }
function subjectConfiguration(config, subjectId) { const subject = config.subjects.find((item) =>
  item.subjectId === subjectId); if (!subject) throw new Error(`Unknown subject ${subjectId}.`); return subject; }
function assertGrant(decisionValue, grant) { if (grant?.subjectId !== decisionValue.subjectId
  || grant?.action !== decisionValue.action || grant?.transitionDigest !== decisionValue.transitionDigest) {
  throw new Error("Agentic Canvas OS internal grant does not match its transition.");
} }
function requiredSha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`Invalid ${label}.`); return value; }
function instant(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) {
  throw new Error("Invalid observation time."); } return date.toISOString(); }
function git(repository, args) { return runText("git", ["-C", repository, ...args], { cwd: repository }); }
function commandStatus(program, args) { return spawnSync(program, args, { stdio: "ignore" }).status; }
function runText(program, args, options) { const result = spawnSync(program, args,
  { ...options, encoding: "utf8" }); if (result.status !== 0) throw new Error(publicFailure(program, result));
  return result.stdout.trim(); }
function runJson(program, args, { acceptFailure = false, ...options } = {}) {
  const result = spawnSync(program, args, { ...options, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  let parsed; try { parsed = JSON.parse(result.stdout.trim()); }
  catch { throw new Error(publicFailure(program, result)); }
  if (result.status !== 0 && !acceptFailure) throw new Error(parsed?.error?.message
    || parsed?.error || publicFailure(program, result)); return parsed;
}
function publicFailure(program, result) { return `${path.basename(program)} failed (${result.status
  ?? "signal"}): ${String(result.stderr || "").trim().slice(0, 500)}`; }
