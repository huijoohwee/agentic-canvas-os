// Responsibility: Orchestrate one receipt-bound dormant-preservation admission without owning effects.
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import * as Contract from "./dormant-preservation-decision-contract.mjs";
import * as Evidence from "./dormant-preservation-decision-evidence.mjs";

const REQUIRED_METHODS = Object.freeze([
  "withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent",
  "classifyLiveStart", "invokeProvisionedStart", "invokePlannedContinuation",
]);
const STATES = new Set(["absent", "planned", "complete"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function createDormantPreservationAdmissionController({ adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    plan: input => planDormantPreservationAdmission(input, { adapter: runtime }),
    run: input => runDormantPreservationAdmission(input, { adapter: runtime }),
  });
}

export async function planDormantPreservationAdmission(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  const intent = normalizeOptionalIntent(await runtime.readIntent());
  let plan = intent?.planSnapshot || await buildCurrentPlan(runtime, { input });
  if (intent?.status === "authorized") {
    if (observedPreExistingPlannedCandidate(plan)) {
      const current = await buildCurrentPlan(runtime, { intent, plan, refresh: true });
      assertContinuingCandidate(plan, current);
      const operationKey = Contract.dormantPreservationAdmissionOperationKey(
        current.planDigest, "admitted",
      );
      const live = await classify(runtime, { intent, operationKey, plan: current });
      if (live.state === "planned") plan = current;
    } else {
      const operationKey = Contract.dormantPreservationAdmissionOperationKey(
        plan.planDigest, "admitted",
      );
      const live = await classify(runtime, { intent, operationKey, plan });
      if (live.state === "absent") {
        plan = await buildCurrentPlan(runtime, { intent, operationKey, plan, refresh: true });
      }
    }
  }
  requireRequestedPlan(input.planDigest, plan);
  return planResult(plan);
}

export async function runDormantPreservationAdmission(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  if (!DIGEST_PATTERN.test(String(input.planDigest || ""))) {
    throw new Error("Dormant-preservation run requires an exact plan digest.");
  }
  return runtime.withEntrypointFence(
    { planDigest: input.planDigest },
    fence => execute({ adapter: runtime, fence, input }),
  );
}

export function createDormantPreservationAdmissionIntentStore({
  statePath, now = () => new Date(),
} = {}) {
  const filePath = path.resolve(requiredText(statePath, "intent state path"));
  const intentLock = `${filePath}.lock`;
  const entrypointLock = `${filePath}.entrypoint.lock`;
  function readIntent() {
    if (!existsSync(filePath)) return null;
    const journal = JSON.parse(readFileSync(filePath, "utf8"));
    if (journal?.schema !== "agentic-dormant-preservation-admission-journal/v1"
      || journal.intentDigest !== digestValue(journal.intent)) {
      throw new Error("Dormant preservation admission journal is malformed or digest-invalid.");
    }
    return journal.intent;
  }
  function writeIntent({ expectedIntent = null, nextIntent } = {}) {
    return withLock(intentLock, { operation: "intent-cas" }, () => {
      const current = readIntent();
      if (digestNullable(current) !== digestNullable(expectedIntent)) {
        throw new Error("Dormant preservation admission intent changed before CAS.");
      }
      const intent = Contract.normalizeDormantPreservationAdmissionIntent(nextIntent);
      writeJsonAtomic(filePath, {
        schema: "agentic-dormant-preservation-admission-journal/v1",
        intent, intentDigest: digestValue(intent), updatedAt: now().toISOString(),
      });
      return intent;
    });
  }
  async function withEntrypointFence(subject, action) {
    const release = acquireLock(entrypointLock, { operation: "entrypoint", subject });
    try {
      return await action(Object.freeze({
        acquiredAt: now().toISOString(), fenceDigest: digestValue({ filePath, subject }),
      }));
    } finally { release(); }
  }
  return Object.freeze({ readIntent, statePath: filePath, withEntrypointFence, writeIntent });
}

export function materializeDormantPreservationDeviceStartOptions(input) {
  const values = [
    `--session=${input.sessionId}`, `--repository=${input.repository}`, "--provision",
    `--worktree=${input.targetPath}`, `--write-scope-manifest=${input.manifestPath}`,
    `--cloud-authority=${input.cloudAuthorityPath}`,
    `--target-repository=${input.targetRepository}`,
    `--ledger-repository=${input.ledgerRepository}`,
    `--dormant-preservation-selection=${input.selectionPath}`,
    `--dormant-preservation-state=${input.statePath}`,
    `--workspace-guard-controller=${input.controllerRoot}`, `--ttl-seconds=${input.ttlSeconds}`,
  ];
  for (const lane of input.selection.lanes) {
    values.push(`--dormant-preservation=${lane.worktreePath}`);
    if (lane.pullRequest !== null) values.push(`--dormant-preservation-pr=${lane.pullRequest}`);
  }
  values.push("--json");
  return Object.freeze(values);
}

export function invokeDormantPreservationDevice(input) {
  const argv = input.action === "start"
    ? Contract.materializeDormantPreservationDeviceStartArgv(input.plan)
    : materializeContinuationArgv(input);
  const executable = input.action === "start"
    ? input.plan.nestedDeviceStart.executable : process.execPath;
  const cwd = input.action === "start" ? input.plan.nestedDeviceStart.cwd : input.targetPath;
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  const child = input.spawn(executable, argv, {
    cwd, encoding: "utf8", env: environment, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
  });
  const result = parseDormantPreservationDeviceResult(child.stdout);
  if (child.error || child.signal || child.status !== 0) {
    const message = result?.error?.message || child.error?.message || child.stderr || child.signal;
    throw new Error(`Device ${input.action} failed: ${publicMessage(message)}`);
  }
  requireDeviceJoin(result, input);
  return Object.freeze({ operationKey: input.operationKey,
    result, resultDigest: digestValue(result) });
}

export function parseDormantPreservationDeviceResult(stdout) {
  const text = String(stdout || "").trim();
  if (!text || text.split(/\r?\n/u).length !== 1) {
    throw new Error("Device command must return exactly one JSON object.");
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value;
  } catch { throw new Error("Device command returned invalid JSON."); }
}

export function assertDormantPreservationCandidatePullRequest(plan, lease, value) {
  const repository = plan?.sourceEvidence?.canonical?.targetRepository;
  if (!value || value.state !== "OPEN" || value.isDraft !== true
    || !Number.isSafeInteger(value.number) || value.number < 1
    || value.url !== lease.pullRequestUrl
    || value.url !== `https://github.com/${repository}/pull/${value.number}`
    || value.headRepository?.nameWithOwner !== repository
    || value.headRefName !== lease.branch || value.baseRefName !== "main") {
    throw new Error("Admitted candidate pull request is not the exact same-repository open draft lane.");
  }
  return value;
}

function materializeContinuationArgv(input) {
  const source = input.plan.sourceEvidence;
  const args = [input.plan.nestedDeviceStart.argvTemplate[0], "heartbeat",
    `--session=${input.sessionId}`, `--repository=${input.targetPath}`,
    "--continue-admission", `--write-scope-manifest=${input.manifestPath}`,
    `--operator-decision-digest=${input.plan.planDigest}`,
    `--dormant-preservation-selection=${input.selectionPath}`,
    `--dormant-preservation-evidence-digest=${source.sourceEvidenceDigest}`,
    `--dormant-preservation-authorization=${input.plan.exactAuthorization}`,
    `--dormant-preservation-state=${input.statePath}`,
    `--workspace-guard-controller=${input.controllerRoot}`, "--json"];
  for (const lane of input.selection.lanes) {
    args.push(`--dormant-preservation=${lane.worktreePath}`);
    if (lane.pullRequest !== null) args.push(`--dormant-preservation-pr=${lane.pullRequest}`);
  }
  return args;
}

function requireDeviceJoin(result, input) {
  const claimId = input.plan.sourceEvidence.candidate.cloudAuthority.claimId;
  if (result?.schema !== "agentic-device-command-result/v1" || result.ok !== true
    || result.action !== input.action || result.status !== "active"
    || path.resolve(result.worktreePath || "") !== input.targetPath
    || result.lease?.sessionId !== input.sessionId || result.lease?.scope !== input.scope
    || result.pullRequest?.isDraft !== true) {
    throw new Error("Device command result did not join the exact dormant admission subject.");
  }
  const validStart = input.action === "start" && result.provisioned === true
    && result.admissionReport?.mode === "admit"
    && result.admissionReport?.authoringAdmission?.status === "admitted"
    && result.admissionReport?.cloudAuthority?.claimId === claimId;
  const validHeartbeat = input.action === "heartbeat"
    && result.admission?.status === "admitted" && result.cloudAuthority?.claimId === claimId;
  if ((!validStart && !validHeartbeat) || result.mutationAuthorityReceipt?.status !== "ready") {
    throw new Error(`Device ${input.action} did not return admitted mutation authority.`);
  }
}

async function execute({ adapter, fence, input }) {
  let intent = normalizeOptionalIntent(await adapter.readIntent({ fence }));
  let plan = intent?.planSnapshot || await buildCurrentPlan(adapter, { fence, input });
  if (intent && input.planDigest && input.planDigest !== plan.planDigest) {
    if (intent.status !== "authorized") {
      throw new Error("Only an effect-absent authorized intent can be replaced.");
    }
    let current;
    if (observedPreExistingPlannedCandidate(plan)) {
      current = await buildCurrentPlan(adapter, { fence, intent, plan, refresh: true });
      assertContinuingCandidate(plan, current);
      const currentOperationKey = Contract.dormantPreservationAdmissionOperationKey(
        current.planDigest, "admitted",
      );
      const live = await classify(adapter, {
        fence, intent, operationKey: currentOperationKey, plan: current,
      });
      if (live.state !== "planned") {
        throw new Error(
          "Authorized planned-candidate replacement requires the same live planned candidate.",
        );
      }
    } else {
      const priorOperationKey = Contract.dormantPreservationAdmissionOperationKey(
        plan.planDigest, "admitted",
      );
      const live = await classify(adapter, {
        fence, intent, operationKey: priorOperationKey, plan,
      });
      if (live.state !== "absent") {
        throw new Error("Authorized intent replacement requires an absent candidate effect.");
      }
      current = await buildCurrentPlan(adapter, { fence, intent, plan, refresh: true });
    }
    requireRequestedPlan(input.planDigest, current);
    const replacementAuthorization = Contract.authorizeDormantPreservationAdmission(
      current, input.authorization,
    );
    intent = await persist(adapter, {
      expectedIntent: intent, fence, plan: current,
      nextIntent: Contract.createDormantPreservationAdmissionIntent(
        current, replacementAuthorization,
      ),
    });
    plan = current;
  }
  requireRequestedPlan(input.planDigest, plan);
  const authorization = Contract.authorizeDormantPreservationAdmission(
    plan, input.authorization,
  );
  if (intent && intent.authorizationDigest !== authorization.authorizationDigest) {
    throw new Error("Stored dormant-preservation authorization drifted.");
  }
  if (!intent) {
    intent = await persist(adapter, {
      expectedIntent: null, fence, plan,
      nextIntent: Contract.createDormantPreservationAdmissionIntent(plan, authorization),
    });
  }
  if (intent.status === "complete") return completeResult(intent);
  if (intent.status === "admitted") {
    const receipt = Contract.buildDormantPreservationAdmissionReceipt(intent);
    intent = await persist(adapter, { expectedIntent: intent, fence, plan,
      nextIntent: Contract.advanceDormantPreservationAdmissionIntent(intent, "complete", receipt) });
    return completeResult(intent);
  }

  const operationKey = Contract.dormantPreservationAdmissionOperationKey(
    plan.planDigest, "admitted",
  );
  const context = { fence, intent, operationKey, plan };
  let live = await classify(adapter, context);
  if (live.state === "absent") {
    const observedPlan = await buildCurrentPlan(adapter, { ...context, revalidate: true });
    if (observedPlan.planDigest !== plan.planDigest) {
      throw new Error("Dormant-preservation admission plan drifted before device:start.");
    }
    live = await invokeAndRecover(adapter, "invokeProvisionedStart", context);
  } else if (live.state === "planned") {
    live = await invokeAndRecover(adapter, "invokePlannedContinuation", context);
  }
  if (live.state !== "complete") {
    throw new Error("Dormant-preservation admission did not become live-complete.");
  }

  intent = await persist(adapter, { expectedIntent: intent, fence, plan,
    nextIntent: Contract.advanceDormantPreservationAdmissionIntent(
      intent, "admitted", live.evidence) });
  const receipt = Contract.buildDormantPreservationAdmissionReceipt(intent);
  intent = await persist(adapter, { expectedIntent: intent, fence, plan,
    nextIntent: Contract.advanceDormantPreservationAdmissionIntent(intent, "complete", receipt) });
  return completeResult(intent);
}

function observedPreExistingPlannedCandidate(plan) {
  const source = plan?.sourceEvidence;
  const authority = source?.candidate?.cloudAuthority;
  const claim = source?.candidate?.candidateClaim;
  return typeof authority?.reviewRequestId === "string"
    && authority.reviewRequestId.length > 0
    && authority.reviewRequestId === claim?.reviewRequestId
    && authority.laneRevision === claim?.laneRevision
    && authority.laneRevision !== source?.canonical?.headSha
    && authority.leaseEpoch === claim?.leaseEpoch
    && Number.isSafeInteger(authority.transitionCounter)
    && authority.transitionCounter >= 2
    && authority.transitionCounter === claim?.transitionCounter;
}

function assertContinuingCandidate(priorPlan, currentPlan) {
  const project = plan => {
    const candidate = plan.sourceEvidence.candidate;
    return {
      semanticScope: candidate.semanticScope,
      deviceId: candidate.deviceId,
      branch: candidate.branch,
      sessionId: candidate.sessionId,
      targetPath: candidate.targetPath,
      targetObservationDigest: candidate.targetObservationDigest,
      manifestPath: candidate.manifestPath,
      manifestFileDigest: candidate.manifestFileDigest,
      cloudAuthorityPath: candidate.cloudAuthorityPath,
      cloudAuthorityFileDigest: candidate.cloudAuthorityFileDigest,
      candidateClaimRecordDigest: candidate.candidateClaimRecordDigest,
    };
  };
  if (digestValue(project(priorPlan)) !== digestValue(project(currentPlan))) {
    throw new Error("Authorized planned-candidate replacement changed candidate identity.");
  }
}

function completeResult(intent) {
  const plan = intent.planSnapshot;
  const receipt = Contract.normalizeDormantPreservationAdmissionReceipt(
    intent.phases.complete.values.receipt,
  );
  return Object.freeze({
    schema: "agentic-dormant-preservation-admission-result/v1",
    status: "complete", planDigest: plan.planDigest, receipt,
  });
}

async function invokeAndRecover(adapter, method, context) {
  try {
    const result = await adapter[method](context);
    if (!result || result.operationKey !== context.operationKey) {
      throw new Error("Dormant-preservation device effect changed its operation key.");
    }
  } catch (error) {
    const recovered = await classify(adapter, context);
    if (recovered.state !== "complete") throw error;
    return recovered;
  }
  return classify(adapter, context);
}

async function classify(adapter, context) {
  const value = await adapter.classifyLiveStart(context);
  if (!value || !STATES.has(value.state)) {
    throw new Error("Dormant-preservation live start returned an invalid state.");
  }
  if (value.state !== "complete") {
    if (value.evidence != null) throw new Error("Pending dormant-preservation state carried evidence.");
    return Object.freeze({ state: value.state, evidence: null });
  }
  const evidence = Evidence.normalizeDormantPreservationAdmissionExecutionEvidence(
    value.evidence,
  );
  if (evidence.planDigest !== context.plan.planDigest
    || evidence.operationKey !== context.operationKey) {
    throw new Error("Dormant-preservation execution evidence changed its planned identity.");
  }
  return Object.freeze({ state: "complete", evidence });
}

async function buildCurrentPlan(adapter, context) {
  const value = await adapter.readSourceEvidence(context);
  if (!value?.sourceEvidence || !value?.nestedDeviceStart) {
    throw new Error("Dormant-preservation adapter returned incomplete planning input.");
  }
  return Contract.buildDormantPreservationAdmissionPlan(value);
}

async function persist(adapter, { expectedIntent, fence, nextIntent, plan }) {
  return Contract.normalizeDormantPreservationAdmissionIntent(await adapter.writeIntent({
    expectedIntent, fence, nextIntent, plan,
  }));
}

function normalizeOptionalIntent(value) {
  return value == null ? null : Contract.normalizeDormantPreservationAdmissionIntent(value);
}

function normalizeAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(
    REQUIRED_METHODS.map(name => [name, methods?.[name]]),
  ));
  for (const name of REQUIRED_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Dormant-preservation admission adapter requires ${name}().`);
    }
  }
  return adapter;
}

function requireRequestedPlan(value, plan) {
  if (value == null || value === "") return;
  if (!DIGEST_PATTERN.test(value) || value !== plan.planDigest) {
    throw new Error("Requested dormant-preservation plan digest is not exact-current.");
  }
}

function planResult(plan) {
  return Object.freeze({
    schema: "agentic-dormant-preservation-admission-result/v1",
    status: "planned", planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization, plan,
  });
}

function withLock(lockPath, subject, action) {
  const release = acquireLock(lockPath, subject);
  try { return action(); } finally { release(); }
}

function acquireLock(lockPath, subject) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  try { return createOwnedLock(lockPath, subject, token); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const owner = readLock(lockPath);
  if (!owner) throw new Error("Dormant preservation admission lock is malformed.");
  if (processAlive(owner.pid)) throw new Error("Dormant preservation admission is already fenced.");
  if (readLock(lockPath)?.token !== owner.token) {
    throw new Error("Dormant admission lock changed during recovery.");
  }
  const stale = `${lockPath}.stale.${token}`;
  renameSync(lockPath, stale);
  try {
    const release = createOwnedLock(lockPath, subject, token);
    unlinkSync(stale);
    return release;
  } catch (error) {
    if (!existsSync(lockPath) && existsSync(stale)) renameSync(stale, lockPath);
    throw error;
  }
}

function createOwnedLock(lockPath, subject, token) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, subject, token })}\n`);
  return () => {
    closeSync(descriptor);
    if (readLock(lockPath)?.token === token) unlinkSync(lockPath);
  };
}

function readLock(lockPath) {
  if (!existsSync(lockPath)) return null;
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string" ? value : null;
  } catch { return null; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, filePath);
}

function digestNullable(value) { return value ? digestValue(value) : null; }
function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function publicMessage(value) {
  return String(value || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 500);
}
