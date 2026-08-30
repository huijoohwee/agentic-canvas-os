// Responsibility: orchestrate two separately authorized, journaled successor-rollover phases.
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import {
  REPLACEMENT_PHASES,
  advanceSuccessorRolloverReplacement,
  advanceSuccessorRolloverRetirement,
  authorizeSuccessorRolloverReplacement,
  authorizeSuccessorRolloverRetirement,
  beginSuccessorRolloverReplacement,
  buildSuccessorRolloverCompletion,
  buildSuccessorRolloverReplacementPlan,
  buildSuccessorRolloverRetirementPlan,
  createSuccessorRolloverJournal,
  normalizeSuccessorRolloverJournal,
  normalizeSuccessorRolloverReplacementPlan,
  normalizeSuccessorRolloverRetirementPlan,
  successorRolloverOperationKey,
} from "./active-dirty-scope-expansion-successor-rollover-contract.mjs";

const RESULT_SCHEMA = "agentic-active-dirty-scope-expansion-successor-rollover-result/v1";
const METHODS = Object.freeze([
  "withEntrypointFence", "readRecoveryJournal", "writeRecoveryJournal",
  "readPhaseAObservation", "authorizeEffect", "reconcilePhase", "retireStaleSuccessor",
  "readPhaseBState", "claimReplacement", "promoteReplacement", "bindReplacement",
  "supersedeLocal", "projectPullRequest", "observePhaseBComplete", "verifyCompleted",
]);
const REPLACEMENT_EFFECTS = Object.freeze({
  "replacement-claimed": "claimReplacement",
  "replacement-promoted": "promoteReplacement",
  "replacement-bound": "bindReplacement",
  "local-cas": "supersedeLocal",
  "pr-marker": "projectPullRequest",
  verified: "observePhaseBComplete",
});
const MUTATING_PHASES = new Set([
  "stale-successor-retired", "replacement-claimed", "replacement-promoted",
  "replacement-bound", "local-cas", "pr-marker",
]);
const MAX_JOURNAL_BYTES = 2_097_152;

export function createActiveDirtyScopeExpansionSuccessorRolloverController(adapter) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    inspect: () => inspectSuccessorRollover({ adapter: runtime }),
    planRetirement: input => planSuccessorRolloverRetirement(input, { adapter: runtime }),
    runRetirement: input => runSuccessorRolloverRetirement(input, { adapter: runtime }),
    planReplacement: input => planSuccessorRolloverReplacement(input, { adapter: runtime }),
    runReplacement: input => runSuccessorRolloverReplacement(input, { adapter: runtime }),
  });
}

export async function inspectSuccessorRollover({ adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  const raw = await runtime.readRecoveryJournal();
  if (!raw) return Object.freeze({ schema: RESULT_SCHEMA, status: "unplanned", authoringAuthority: false });
  const journal = normalizeSuccessorRolloverJournal(raw);
  const status = journal.replacement?.status || journal.retirement.status;
  return Object.freeze({ schema: RESULT_SCHEMA, status, journalDigest: journal.journalDigest,
    retirementPlanDigest: journal.retirement.planDigest,
    replacementPlanDigest: journal.replacement?.planDigest || null,
    authoringAuthority: false, deployment: false });
}

export async function planSuccessorRolloverRetirement(
  { operatorSessionId } = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const raw = await runtime.readRecoveryJournal();
  if (raw) {
    const journal = normalizeSuccessorRolloverJournal(raw);
    assertOperator(journal.retirement.planSnapshot, operatorSessionId);
    return journal.retirement.planSnapshot;
  }
  return buildSuccessorRolloverRetirementPlan({
    observation: await runtime.readPhaseAObservation(), operatorSessionId,
  });
}

export async function runSuccessorRolloverRetirement(
  { plan: suppliedPlan, operatorSessionId, authorization } = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const plan = normalizeSuccessorRolloverRetirementPlan(suppliedPlan);
  authorizeSuccessorRolloverRetirement({ plan, authorization });
  assertOperator(plan, operatorSessionId);
  return runtime.withEntrypointFence(
    { phase: "retirement", planDigest: plan.planDigest },
    async () => {
      let journal = await readJournal(runtime);
      if (journal) {
        assertRetirementPlan(journal, plan);
      } else {
        const currentPlan = buildSuccessorRolloverRetirementPlan({
          observation: await runtime.readPhaseAObservation(), operatorSessionId,
        });
        assertPlanCurrent(plan, currentPlan, "retirement");
        journal = createSuccessorRolloverJournal(plan, authorization);
        journal = await persistJournal(runtime, null, journal);
      }
      if (journal.retirement.status !== "stale-successor-retired") {
        journal = await executePhase(runtime, journal, plan, "stale-successor-retired",
          "retireStaleSuccessor", advanceSuccessorRolloverRetirement);
      } else {
        await verifyJournaledPhase(runtime, journal, plan, "stale-successor-retired");
      }
      return retirementResult(journal);
    },
  );
}

export async function planSuccessorRolloverReplacement(
  { operatorSessionId, targetManifest } = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const journal = await requireRetiredJournal(runtime);
  if (journal.replacement) {
    assertOperator(journal.replacement.planSnapshot, operatorSessionId);
    return journal.replacement.planSnapshot;
  }
  return buildReplacementPlan(runtime, journal, operatorSessionId, targetManifest);
}

export async function runSuccessorRolloverReplacement(
  { plan: suppliedPlan, operatorSessionId, authorization } = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const plan = normalizeSuccessorRolloverReplacementPlan(suppliedPlan);
  authorizeSuccessorRolloverReplacement({ plan, authorization });
  assertOperator(plan, operatorSessionId);
  return runtime.withEntrypointFence(
    { phase: "replacement", planDigest: plan.planDigest },
    async () => {
      let journal = await requireRetiredJournal(runtime);
      if (journal.replacement) {
        assertReplacementPlan(journal, plan);
      } else {
        const current = await buildReplacementPlan(runtime, journal, operatorSessionId, plan.target);
        assertPlanCurrent(plan, current, "replacement");
        const next = beginSuccessorRolloverReplacement(journal, plan, authorization);
        journal = await persistJournal(runtime, journal, next);
      }
      journal = await executeReplacement(runtime, journal);
      return replacementResult(journal);
    },
  );
}

async function executeReplacement(adapter, initial) {
  let journal = initial;
  if (journal.replacement.status === "complete") {
    const live = await adapter.verifyCompleted(
      context(journal, journal.replacement.planSnapshot, "complete"));
    requireValues(live, "complete verification");
    if (canonicalJson(live) !== canonicalJson(journal.replacement.phases.verified.values)) {
      throw new Error("Successor-rollover completion replay changed terminal evidence.");
    }
    return journal;
  }
  const start = REPLACEMENT_PHASES.indexOf(journal.replacement.status) + 1;
  for (const phase of REPLACEMENT_PHASES.slice(start)) {
    const plan = journal.replacement.planSnapshot;
    if (phase === "complete") {
      const receipt = buildSuccessorRolloverCompletion(journal);
      const next = advanceSuccessorRolloverReplacement(journal, phase, { receipt });
      journal = await persistJournal(adapter, journal, next);
      continue;
    }
    journal = await executePhase(adapter, journal, plan, phase,
      REPLACEMENT_EFFECTS[phase], (value, values) =>
        advanceSuccessorRolloverReplacement(value, phase, values));
  }
  return journal;
}

async function executePhase(adapter, journal, plan, phase, effectName, advance) {
  const input = context(journal, plan, phase);
  let values = await adapter.reconcilePhase(input);
  if (!values) {
    if (MUTATING_PHASES.has(phase)) await adapter.authorizeEffect(input);
    try {
      values = await adapter[effectName](input);
    } catch (error) {
      values = await adapter.reconcilePhase(input);
      if (!values) throw error;
    }
  }
  requireValues(values, phase);
  const next = advance(journal, values);
  return persistJournal(adapter, journal, next);
}

async function verifyJournaledPhase(adapter, journal, plan, phase) {
  const live = await adapter.reconcilePhase(context(journal, plan, phase));
  requireValues(live, phase);
  if (canonicalJson(live) !== canonicalJson(journal.retirement.phases[phase].values)) {
    throw new Error("Successor-rollover retirement replay changed its exact terminal receipt.");
  }
}

async function buildReplacementPlan(adapter, journal, operatorSessionId, targetManifest) {
  const observation = await adapter.readPhaseBState({ journal, targetManifest });
  return buildSuccessorRolloverReplacementPlan({
    observation, targetManifest, operatorSessionId, retirementJournal: journal,
  });
}

function context(journal, plan, phase) {
  return Object.freeze({ journal, plan, phase,
    operationKey: successorRolloverOperationKey(plan, phase) });
}

async function readJournal(adapter) {
  const raw = await adapter.readRecoveryJournal();
  return raw ? normalizeSuccessorRolloverJournal(raw) : null;
}

async function requireRetiredJournal(adapter) {
  const journal = await readJournal(adapter);
  if (!journal || journal.retirement.status !== "stale-successor-retired") {
    throw new Error("Successor replacement requires a terminal, journaled stale-successor retirement.");
  }
  return journal;
}

async function persistJournal(adapter, expectedJournal, nextJournal) {
  const candidate = normalizeSuccessorRolloverJournal(nextJournal);
  const written = await adapter.writeRecoveryJournal({ expectedJournal, nextJournal: candidate });
  const persisted = normalizeSuccessorRolloverJournal(written || await adapter.readRecoveryJournal());
  if (persisted.journalDigest !== candidate.journalDigest) {
    throw new Error("Successor-rollover external journal changed during CAS persistence.");
  }
  return persisted;
}

function assertRetirementPlan(journal, plan) {
  if (journal.retirement.planDigest !== plan.planDigest) {
    throw new Error("Stored successor-rollover retirement differs from the authorized plan.");
  }
  if (journal.replacement) {
    throw new Error("Stale-successor retirement cannot rerun after replacement authority began.");
  }
}
function assertReplacementPlan(journal, plan) {
  if (journal.replacement.planDigest !== plan.planDigest
    || plan.retirementIntentDigest !== journal.retirement.intentDigest) {
    throw new Error("Stored successor-rollover replacement differs from the authorized plan.");
  }
}
function assertPlanCurrent(plan, current, label) {
  if (plan.planDigest !== current.planDigest) {
    throw new Error(`Authorized successor-rollover ${label} plan is not exact-current.`);
  }
}
function assertOperator(plan, operatorSessionId) {
  if (plan.operatorSessionId !== operatorSessionId) {
    throw new Error("Successor-rollover plan belongs to another operator session.");
  }
}
function requireValues(value, phase) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Successor-rollover ${phase} did not produce exact evidence.`);
  }
}
function retirementResult(journal) {
  const values = journal.retirement.phases["stale-successor-retired"].values;
  return Object.freeze({ schema: RESULT_SCHEMA, status: "stale-successor-retired",
    planDigest: journal.retirement.planDigest, journalDigest: journal.journalDigest,
    retirementReceiptDigest: values.receiptDigest, staleSuccessorClaimId: values.staleSuccessorClaimId,
    authoringAuthority: false, deployment: false });
}
function replacementResult(journal) {
  const receipt = journal.replacement.phases.complete.values.receipt;
  return Object.freeze({ schema: RESULT_SCHEMA, status: "complete",
    planDigest: journal.replacement.planDigest, journalDigest: journal.journalDigest,
    receipt, authoringAuthority: false, deployment: false });
}
function normalizeAdapter(adapter) {
  for (const name of METHODS) if (typeof adapter?.[name] !== "function") {
    throw new Error(`Successor-rollover controller adapter requires ${name}().`);
  }
  return adapter;
}

export function createSuccessorRolloverJournalStore({ statePath, repositoryRoot,
  processAlive = isProcessAlive, now = () => new Date() } = {}) {
  const repository = realDirectory(repositoryRoot, "repository root");
  const target = externalStatePath(statePath, repository);
  const entrypointLock = `${target}.entrypoint.lock`;
  const casLock = `${target}.cas.lock`;
  return Object.freeze({
    readRecoveryJournal() {
      if (!existsSync(target)) return null;
      assertPrivateFile(target, "successor-rollover journal");
      assertBoundedJournalSize(target);
      let value;
      try { value = JSON.parse(readFileSync(target, "utf8")); }
      catch (error) { throw new Error(`Successor-rollover journal JSON is invalid: ${error.message}`); }
      return normalizeSuccessorRolloverJournal(value);
    },
    writeRecoveryJournal({ expectedJournal = null, nextJournal } = {}) {
      const expected = expectedJournal === null
        ? null : normalizeSuccessorRolloverJournal(expectedJournal);
      const next = normalizeSuccessorRolloverJournal(nextJournal);
      return withSyncLock(casLock, { operation: "journal-cas" }, () => {
        if (existsSync(target)) {
          assertPrivateFile(target, "successor-rollover journal");
          assertBoundedJournalSize(target);
        }
        const current = existsSync(target) ? normalizeSuccessorRolloverJournal(
          JSON.parse(readFileSync(target, "utf8"))) : null;
        if ((current?.journalDigest || null) !== (expected?.journalDigest || null)) {
          throw new Error("Successor-rollover journal changed before CAS.");
        }
        writeAtomicJournal(target, next);
        return next;
      }, { processAlive, now });
    },
    withEntrypointFence(subject, action) {
      if (typeof action !== "function") throw new Error("Successor-rollover entrypoint action is required.");
      return withAsyncLock(entrypointLock, subject, action, { processAlive, now });
    },
    statePath: target,
  });
}

function externalStatePath(value, repository) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("Successor-rollover journal state path must be absolute.");
  }
  const requested = path.resolve(value);
  assertExternalPath(requested, repository);
  const parent = realDirectory(path.dirname(requested), "journal parent", { privateMode: true });
  const target = path.join(parent, path.basename(value));
  assertExternalPath(target, repository);
  if (existsSync(target)) assertPrivateFile(target, "successor-rollover journal");
  return target;
}
function assertExternalPath(target, repository) {
  const relative = path.relative(repository, target);
  if (relative === "" || relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("Successor-rollover journal must remain outside the source repository.");
  }
}
function realDirectory(value, label, { privateMode = false } = {}) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const target = realpathSync(path.resolve(value));
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (privateMode && (stat.mode & 0o077) !== 0)) {
    throw new Error(`${label} must be ${privateMode ? "a private " : "a "}real directory.`);
  }
  return target;
}
function assertPrivateFile(file, label) {
  const stat = lstatSync(file);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (stat.mode & 0o777) !== 0o600 || stat.uid !== uid) {
    throw new Error(`${label} must be an owner-held, single-link, mode 0600 regular file.`);
  }
}
function writeAtomicJournal(target, journal) {
  const serialized = `${JSON.stringify(journal, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) {
    throw new Error("Successor-rollover journal exceeds its size bound.");
  }
  const temporary = `${target}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, serialized);
    fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    if (existsSync(target)) assertPrivateFile(target, "successor-rollover journal");
    renameSync(temporary, target); syncDirectory(path.dirname(target));
    assertPrivateFile(target, "successor-rollover journal");
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function withSyncLock(lockPath, subject, action, options) {
  const lock = acquireLock(lockPath, subject, options);
  try { return action(); } finally { releaseLock(lockPath, lock); }
}
async function withAsyncLock(lockPath, subject, action, options) {
  const lock = acquireLock(lockPath, subject, options);
  try { return await action(); } finally { releaseLock(lockPath, lock); }
}
function acquireLock(lockPath, subject, { processAlive, now }) {
  const token = `${process.pid}:${process.hrtime.bigint()}`;
  let descriptor = createLock(lockPath, { token, subject, now });
  if (descriptor !== null) return { descriptor, token };
  const owner = readLock(lockPath);
  if (!owner) throw new Error("Successor-rollover lock is malformed.");
  if (processAlive(owner.pid)) throw new Error("Successor-rollover operation is already fenced.");
  const reaperPath = `${lockPath}.reaper.lock`;
  const reaperToken = `${token}:reaper`;
  const reaperDescriptor = createLock(reaperPath, { token: reaperToken,
    subject: { operation: "stale-owner-reaping", subject }, now });
  if (reaperDescriptor === null) {
    const reaperOwner = readLock(reaperPath);
    if (!reaperOwner) throw new Error("Successor-rollover stale-owner reaper is malformed.");
    const state = processAlive(reaperOwner.pid) ? "already fenced" : "stale and requires recovery";
    throw new Error(`Successor-rollover stale-owner reaping is ${state}.`);
  }
  const reaper = { descriptor: reaperDescriptor, token: reaperToken };
  try {
    const current = readLock(lockPath);
    if (current?.token !== owner.token) {
      throw new Error("Successor-rollover lock changed during stale-owner fencing.");
    }
    if (processAlive(current.pid)) throw new Error("Successor-rollover operation is already fenced.");
    unlinkSync(lockPath);
    descriptor = createLock(lockPath, { token, subject, now });
    if (descriptor === null) throw new Error("Successor-rollover lock was concurrently reacquired.");
    return { descriptor, token };
  } finally {
    releaseLock(reaperPath, reaper);
  }
}
function createLock(lockPath, { token, subject, now }) {
  let descriptor;
  try { descriptor = openSync(lockPath, "wx", 0o600); }
  catch (error) { if (error?.code === "EEXIST") return null; throw error; }
  try {
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token, subject,
      acquiredAt: now().toISOString() })}\n`);
    fsyncSync(descriptor); return descriptor;
  } catch (error) {
    closeSync(descriptor); unlinkSync(lockPath); throw error;
  }
}
function readLock(lockPath) {
  if (!existsSync(lockPath)) return null;
  try {
    assertPrivateFile(lockPath, "successor-rollover lock");
    const value = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.token === "string"
      && Number.isFinite(Date.parse(value.acquiredAt)) ? value : null;
  } catch { return null; }
}
function releaseLock(lockPath, { descriptor, token }) {
  closeSync(descriptor);
  if (readLock(lockPath)?.token === token) unlinkSync(lockPath);
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function assertBoundedJournalSize(file) {
  const size = lstatSync(file).size;
  if (size < 2 || size > MAX_JOURNAL_BYTES) {
    throw new Error("Successor-rollover journal size is outside its bound.");
  }
}
function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true; throw error; }
}
