// Responsibility: durably enforce waiter-first provider-only reconciliation without owning effects.
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";
import * as Contract from "./provider-only-merged-claim-pair-reconciliation-contract.mjs";
const {
  closeSync, constants, existsSync, fchmodSync, fsyncSync, fstatSync, linkSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } = fs;
export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES = Object.freeze([
  "authorized", "prepared", "waiter-retired", "source-recovered",
  "source-integrated", "source-retired", "verified", "complete",
]);
const EFFECTS = Object.freeze([
  ["waiter-retired", "retireWaiter"], ["source-recovered", "recoverSource"],
  ["source-integrated", "integrateSource"], ["source-retired", "retireSource"],
  ["verified", "verifyTerminal"],
]);
const REQUIRED = Object.freeze([
  "withEntrypointFence",
  "readSourceEvidence",
  "readPlan",
  "writePlan",
  "verifyFreshSource",
  "readIntent",
  "writeIntent",
  "observePhase",
  ...EFFECTS.map(([, method]) => method),
]);
const DIGEST = /^[0-9a-f]{64}$/u;
export function createProviderOnlyMergedClaimPairReconciliationControllerAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(REQUIRED.map(name => [name, methods[name]])));
  for (const name of REQUIRED) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Provider-only merged-claim-pair adapter requires ${name}().`);
    }
  }
  return adapter;
}
export function createProviderOnlyMergedClaimPairReconciliationController({ adapter } = {}) {
  const runtime = createProviderOnlyMergedClaimPairReconciliationControllerAdapter(adapter);
  return Object.freeze({
    plan: input => planProviderOnlyMergedClaimPairReconciliation(input, { adapter: runtime }),
    run: input => runProviderOnlyMergedClaimPairReconciliation(input, { adapter: runtime }),
  });
}
export async function planProviderOnlyMergedClaimPairReconciliation(
  input = {},
  { adapter } = {},
) {
  const runtime = createProviderOnlyMergedClaimPairReconciliationControllerAdapter(adapter);
  const stored = await runtime.readIntent();
  const sealed = await runtime.readPlan();
  let plan = sealed
    ? Contract.normalizeProviderOnlyMergedClaimPairReconciliationPlan(sealed)
    : await buildPlan(runtime, { input });
  if (!sealed) {
    const returned = Contract.normalizeProviderOnlyMergedClaimPairReconciliationPlan(
      await runtime.writePlan({ expectedPlan: null, nextPlan: plan }),
    );
    if (returned.planDigest !== plan.planDigest) {
      throw new Error("Provider-only sealed plan CAS returned a different plan.");
    }
    plan = returned;
  }
  if (stored && normalizeIntent(stored).planSnapshot.planDigest !== plan.planDigest) {
    throw new Error("Stored provider-only intent differs from the sealed plan.");
  }
  requirePlanDigest(input.planDigest, plan);
  return Object.freeze({
    status: "planned",
    plan,
    planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization,
  });
}
export async function runProviderOnlyMergedClaimPairReconciliation(
  input = {},
  { adapter } = {},
) {
  const runtime = createProviderOnlyMergedClaimPairReconciliationControllerAdapter(adapter);
  return runtime.withEntrypointFence(
    { planDigest: input.planDigest ?? null },
    fence => execute({ adapter: runtime, fence, input }),
  );
}
async function execute({ adapter, fence, input }) {
  let intent = await adapter.readIntent({ fence });
  intent = intent ? normalizeIntent(intent) : null;
  const sealed = await adapter.readPlan({ fence });
  if (!sealed) {
    throw new Error("Provider-only reconciliation run requires its privately sealed plan.");
  }
  const plan = Contract.normalizeProviderOnlyMergedClaimPairReconciliationPlan(sealed);
  if (intent && intent.planSnapshot.planDigest !== plan.planDigest) {
    throw new Error("Stored provider-only intent differs from the sealed plan.");
  }
  requirePlanDigest(input.planDigest, plan, { required: true });
  const authorization = Contract.authorizeProviderOnlyMergedClaimPairReconciliation({
    plan,
    authorization: input.authorization,
  });
  if (intent && intent.authorizationDigest !== authorization.authorizationDigest) {
    throw new Error("Stored provider-only reconciliation authorization drifted.");
  }
  if (!intent) {
    const candidate = Contract.createProviderOnlyMergedClaimPairReconciliationIntent({
      plan,
      authorizationReceipt: authorization,
    });
    intent = await writeExactIntent(adapter, candidate, {
      expectedIntent: null,
      fence,
      nextIntent: candidate,
      plan,
    });
  } else if (intent.status === "authorized") {
    await requireCurrentPlan(adapter, { fence, input, plan });
  } else if (intent.status === "prepared") {
    const next = await observe(adapter, {
      fence,
      intent,
      operationKey: operationKey(plan, "waiter-retired"),
      phase: "waiter-retired",
      plan,
    });
    if (next.state === "pending") await requireCurrentPlan(adapter, { fence, input, plan });
  }
  intent = await persistObserved({ adapter, fence, intent, phase: "prepared", plan });
  for (const [phase, method] of EFFECTS) {
    if (atLeast(intent.status, phase)) {
      await requireComplete(adapter, { fence, intent, phase, plan });
      continue;
    }
    assertNext(intent.status, phase);
    const values = await executeEffect({ adapter, fence, intent, method, phase, plan });
    intent = await persist({ adapter, fence, intent, phase, plan, values });
    await requireComplete(adapter, { fence, intent, phase, plan });
  }
  if (!atLeast(intent.status, "complete")) {
    assertNext(intent.status, "complete");
    const verified = intent.phases.verified.values;
    const values = Object.freeze({
      operationKey: operationKey(plan, "complete"),
      evidenceDigest: digestValue({
        schema: "agentic-provider-only-merged-claim-pair-completion-evidence/v1",
        planDigest: plan.planDigest,
        verifiedEvidenceDigest: verified.evidenceDigest,
        sourceIntegrationReceiptDigest: verified.sourceIntegrationReceiptDigest,
      }),
      sourceIntegrationReceiptDigest: verified.sourceIntegrationReceiptDigest,
    });
    const receipt = Contract.buildProviderOnlyMergedClaimPairReconciliationReceipt({
      plan,
      intent,
      values,
    });
    intent = await persist({
      adapter,
      fence,
      intent,
      phase: "complete",
      plan,
      values: { ...values, receipt },
    });
  }
  return Object.freeze({
    schema: "agentic-provider-only-merged-claim-pair-reconciliation-result/v1",
    status: "complete",
    planDigest: plan.planDigest,
    receipt: intent.phases.complete.values.receipt,
  });
}
async function persistObserved({ adapter, fence, intent, phase, plan }) {
  if (atLeast(intent.status, phase)) {
    await requireComplete(adapter, { fence, intent, phase, plan });
    return intent;
  }
  assertNext(intent.status, phase);
  const values = await requireComplete(adapter, { fence, intent, phase, plan });
  return persist({ adapter, fence, intent, phase, plan, values });
}
async function executeEffect({ adapter, fence, intent, method, phase, plan }) {
  const context = { fence, intent, operationKey: operationKey(plan, phase), phase, plan };
  let classification = await observe(adapter, context);
  if (classification.state === "complete") return values(classification);
  if (phase === "waiter-retired") await requireFreshSource(adapter, context);
  try {
    const result = await adapter[method](context);
    if (!result || result.operationKey !== context.operationKey) {
      throw new Error(`Provider-only ${phase} effect is not operation-bound.`);
    }
  } catch (error) {
    classification = await observe(adapter, context);
    if (classification.state === "pending") throw error;
    return values(classification);
  }
  classification = await observe(adapter, context);
  if (classification.state !== "complete") {
    throw new Error(`Provider-only reconciliation phase ${phase} did not become live-complete.`);
  }
  return values(classification);
}
async function requireComplete(adapter, context) {
  const classification = await observe(adapter, {
    ...context,
    operationKey: operationKey(context.plan, context.phase),
  });
  if (classification.state !== "complete") {
    throw new Error(`Provider-only reconciliation phase ${context.phase} is not live-complete.`);
  }
  const recorded = context.intent?.phases?.[context.phase]?.values;
  if (recorded?.operationKey && recorded.operationKey !== classification.operationKey) {
    throw new Error(`Provider-only ${context.phase} operation key drifted after persistence.`);
  }
  if (recorded?.evidenceDigest && recorded.evidenceDigest !== classification.evidenceDigest) {
    throw new Error(`Provider-only ${context.phase} evidence drifted after persistence.`);
  }
  if (recorded?.sourceIntegrationReceiptDigest
    && recorded.sourceIntegrationReceiptDigest !== classification.sourceIntegrationReceiptDigest) {
    throw new Error(`Provider-only ${context.phase} integration receipt drifted after persistence.`);
  }
  return values(classification);
}
async function observe(adapter, context) {
  const value = await adapter.observePhase(context);
  if (!value || value.phase !== context.phase || value.operationKey !== context.operationKey
    || !["pending", "complete"].includes(value.state)) {
    throw new Error(`Provider-only ${context.phase} phase classification is invalid.`);
  }
  if (value.state === "pending") {
    if (value.evidenceDigest !== null) throw new Error(`Pending ${context.phase} evidence is malformed.`);
    return Object.freeze({ ...value, sourceIntegrationReceiptDigest: null });
  }
  const evidenceDigest = requiredDigest(value.evidenceDigest, `${context.phase} evidence digest`);
  const sourceIntegrationReceiptDigest = atLeast(context.phase, "source-integrated")
    ? requiredDigest(
      value.sourceIntegrationReceiptDigest,
      `${context.phase} source integration receipt digest`,
    )
    : null;
  return Object.freeze({ ...value, evidenceDigest, sourceIntegrationReceiptDigest });
}
async function persist({ adapter, fence, intent, phase, plan, values: phaseValues }) {
  const candidate = Contract.advanceProviderOnlyMergedClaimPairReconciliationIntent(
    intent,
    { status: phase, values: phaseValues },
  );
  return writeExactIntent(adapter, candidate, {
    expectedIntent: intent,
    fence,
    nextIntent: candidate,
    plan,
  });
}
async function writeExactIntent(adapter, candidate, input) {
  const returned = normalizeIntent(await adapter.writeIntent(input));
  if (returned.intentDigest !== candidate.intentDigest) {
    throw new Error("Provider-only reconciliation intent CAS returned a different intent.");
  }
  return returned;
}
function values(classification) {
  const result = {
    operationKey: classification.operationKey,
    evidenceDigest: classification.evidenceDigest,
  };
  if (classification.sourceIntegrationReceiptDigest) {
    result.sourceIntegrationReceiptDigest = classification.sourceIntegrationReceiptDigest;
  }
  return Object.freeze(result);
}
async function buildPlan(adapter, context) {
  return Contract.normalizeProviderOnlyMergedClaimPairReconciliationPlan(
    Contract.buildProviderOnlyMergedClaimPairReconciliationPlan(
      await adapter.readSourceEvidence(context),
    ),
  );
}
async function requireCurrentPlan(adapter, context) {
  const current = await buildPlan(adapter, context);
  if (current.planDigest !== context.plan.planDigest) {
    throw new Error("Live provider-only reconciliation plan identity drifted before its first effect.");
  }
}
async function requireFreshSource(adapter, context) {
  const value = await adapter.verifyFreshSource(context);
  if (!value || value.planDigest !== context.plan.planDigest
    || !DIGEST.test(String(value.evidenceDigest || ""))) {
    throw new Error("Fresh provider/local/controller subject proof is invalid.");
  }
  return value;
}
function normalizeIntent(value) {
  return Contract.normalizeProviderOnlyMergedClaimPairReconciliationIntent(value);
}
function operationKey(plan, phase) {
  return Contract.providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
}
function requirePlanDigest(requested, plan, { required = false } = {}) {
  if (required && requested == null) {
    throw new Error("Provider-only reconciliation run requires its exact plan digest.");
  }
  if (requested != null && requested !== plan.planDigest) {
    throw new Error("Requested provider-only reconciliation plan digest drifted.");
  }
}
function atLeast(current, expected) { return index(current) >= index(expected); }
function assertNext(current, expected) {
  if (PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES[index(current) + 1] !== expected) {
    throw new Error(`Provider-only reconciliation cannot advance from ${current} to ${expected}.`);
  }
}
function index(value) {
  const result = PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES.indexOf(value);
  if (result < 0) throw new Error(`Unsupported provider-only reconciliation phase: ${value}.`);
  return result;
}
function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}
const INTENT_JOURNAL_SCHEMA = "agentic-provider-only-merged-claim-pair-journal/v2";
const PLAN_JOURNAL_SCHEMA = "agentic-provider-only-merged-claim-pair-plan-journal/v1";
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
export function createProviderOnlyMergedClaimPairReconciliationIntentStore({
  planPath, statePath, now = () => new Date(),
} = {}) {
  const file = normalizePrivatePath(statePath, "intent state path");
  const planFile = normalizePrivatePath(planPath || `${file}.plan`, "sealed plan path");
  if (file === planFile) throw new Error("Sealed plan and intent paths must differ.");
  const lock = `${file}.lock`;
  const planLock = `${planFile}.lock`;
  const entrypoint = `${file}.entrypoint.lock`;
  function readIntent() {
    const record = readPrivateRecord(file, { absent: true });
    if (!record) return null;
    const value = parseRecord(record.bytes, "Provider-only intent journal");
    if (value.schema !== INTENT_JOURNAL_SCHEMA
      || value.intentDigest !== digestValue(value.intent)) {
      throw new Error("Provider-only journal is invalid.");
    }
    return value.intent;
  }
  function readPlan() {
    const record = readPrivateRecord(planFile, { absent: true });
    if (!record) return null;
    const value = parseRecord(record.bytes, "Provider-only sealed plan");
    if (value.schema !== PLAN_JOURNAL_SCHEMA
      || value.planDigest !== digestValue(value.plan)) {
      throw new Error("Provider-only sealed plan is invalid.");
    }
    return value.plan;
  }
  async function writePlan({ expectedPlan = null, nextPlan } = {}) {
    return withPrivateOperationLock({
      file: planLock,
      context: { operation: "plan-seal", planPath: planFile },
      action: () => {
        const observed = readPrivateRecord(planFile, { absent: true });
        const current = observed ? readPlan() : null;
        if (nullableDigest(current) !== nullableDigest(expectedPlan)) {
          throw new Error("Provider-only sealed plan changed before CAS.");
        }
        if (!nextPlan || typeof nextPlan !== "object" || Array.isArray(nextPlan)) {
          throw new Error("Provider-only next sealed plan is required.");
        }
        if (current !== null) {
          if (digestValue(current) !== digestValue(nextPlan)) {
            throw new Error("Provider-only sealed plan is immutable.");
          }
          return current;
        }
        const journal = {
          schema: PLAN_JOURNAL_SCHEMA, plan: nextPlan,
          planDigest: digestValue(nextPlan), sealedAt: normalizeInstant(now()),
        };
        writePrivateRecord(planFile, journal, { expected: null });
        return readPlan();
      },
    });
  }
  async function writeIntent({ expectedIntent = null, nextIntent } = {}) {
    return withPrivateOperationLock({
      file: lock,
      context: { operation: "intent-cas", statePath: file },
      action: () => {
        const observed = readPrivateRecord(file, { absent: true });
        const current = observed ? readIntent() : null;
        if (nullableDigest(current) !== nullableDigest(expectedIntent)) {
          throw new Error("Provider-only reconciliation intent changed before CAS.");
        }
        if (!nextIntent || typeof nextIntent !== "object" || Array.isArray(nextIntent)) {
          throw new Error("Provider-only reconciliation next intent is required.");
        }
        const journal = {
          schema: INTENT_JOURNAL_SCHEMA, intent: nextIntent,
          intentDigest: digestValue(nextIntent), updatedAt: normalizeInstant(now()),
        };
        writePrivateRecord(file, journal, { expected: observed?.stat ?? null });
        return readIntent();
      },
    });
  }
  async function withEntrypointFence(subject, action) {
    return withPrivateOperationLock({
      file: entrypoint,
      context: { operation: "provider-only-pair-reconciliation", statePath: file, subject },
      action: owner => action(Object.freeze({
        fenceDigest: digestValue({ file, subject, lockToken: owner.token }),
      })),
    });
  }
  return Object.freeze({
    planPath: planFile, readIntent, readPlan, statePath: file,
    withEntrypointFence, writeIntent, writePlan,
  });
}
function writePrivateRecord(file, value, { expected } = {}) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const token = randomUUID();
  const temporary = path.join(directory, `.${path.basename(file)}.${token}.tmp`);
  const bytes = `${canonicalJson(value)}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_RECORD_BYTES) {
    throw new Error("Provider-only private record exceeds its bounded size.");
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  const descriptor = openSync(temporary, flags, 0o600);
  const created = fstatSync(descriptor);
  let closed = false;
  let captured = null;
  try {
    fchmodSync(descriptor, 0o600);
    requirePrivateRegular(temporary, created);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const durable = fstatSync(descriptor);
    if (!sameInode(created, durable) || durable.size !== Buffer.byteLength(bytes, "utf8")) {
      throw new Error("Provider-only private temporary changed while it was written.");
    }
    closeSync(descriptor);
    closed = true;
    const temporaryRecord = readPrivateRecord(temporary);
    if (!sameInode(created, temporaryRecord.stat) || !temporary.endsWith(`.${token}.tmp`)
      || temporaryRecord.bytes !== bytes) {
      throw new Error("Provider-only private temporary token, inode, or bytes drifted.");
    }
    syncDirectory(directory);
    if (expected) {
      captured = `${file}.replace.${token}`;
      renameSync(file, captured);
      syncDirectory(directory);
      const capturedRecord = readPrivateRecord(captured);
      if (!sameSnapshot(expected, capturedRecord.stat)) {
        restoreCapturedRecord(captured, file);
        captured = null;
        throw new Error("Provider-only private record changed before replacement.");
      }
    } else if (existsNoFollow(file)) {
      throw new Error("Provider-only private record appeared before creation.");
    }
    linkSync(temporary, file);
    syncDirectory(directory);
    const installed = readPrivateRecord(file);
    if (!sameInode(created, installed.stat) || installed.bytes !== bytes) {
      throw new Error("Provider-only private record installation lost its exact inode or bytes.");
    }
    unlinkExact(temporary, created);
    if (captured) {
      const prior = readPrivateRecord(captured);
      if (!sameSnapshot(expected, prior.stat)) {
        throw new Error("Provider-only captured prior record changed before retirement.");
      }
      unlinkExact(captured, prior.stat);
      captured = null;
    }
    syncDirectory(directory);
  } catch (error) {
    if (!closed) safely(() => closeSync(descriptor));
    safely(() => unlinkExact(temporary, created));
    if (captured) safely(() => restoreCapturedRecord(captured, file));
    safely(() => syncDirectory(directory));
    throw error;
  }
}
function readPrivateRecord(file, { absent = false } = {}) {
  let before;
  try { before = lstatSync(file); }
  catch (error) {
    if (absent && error?.code === "ENOENT") return null;
    throw error;
  }
  requirePrivateRegular(file, before);
  if (before.size < 2 || before.size > MAX_RECORD_BYTES) {
    throw new Error("Provider-only private record size is invalid.");
  }
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!sameInode(before, opened)) {
      throw new Error("Provider-only private record changed before no-follow open.");
    }
    const bytes = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    const namedAfter = lstatSync(file);
    if (!sameSnapshot(opened, after) || !sameSnapshot(after, namedAfter)) {
      throw new Error("Provider-only private record changed while it was read.");
    }
    return Object.freeze({ bytes, stat: namedAfter });
  } finally {
    closeSync(descriptor);
  }
}
function normalizePrivatePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.normalize(value) !== value || value.includes("\0")) {
    throw new Error(`${label} must be an absolute normalized path.`);
  }
  const requestedParent = path.dirname(value);
  let existingAncestor = requestedParent;
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error(`${label} parent is unavailable.`);
    existingAncestor = parent;
  }
  const canonicalParent = path.join(
    realpathSync(existingAncestor), path.relative(existingAncestor, requestedParent),
  );
  return path.join(canonicalParent, path.basename(value));
}
function ensurePrivateDirectory(directory) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    syncDirectory(path.dirname(directory));
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
    || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Provider-only private record parent must be owner-private and canonical.");
  }
}
function requirePrivateRegular(file, stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || realpathSync(file) !== file
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Provider-only private record must be an owner-private regular file.");
  }
}
function restoreCapturedRecord(captured, file) {
  if (existsNoFollow(file)) {
    throw new Error("Provider-only captured record cannot be restored over another path.");
  }
  linkSync(captured, file);
  syncDirectory(path.dirname(file));
  const capturedRecord = readPrivateRecord(captured);
  const restored = readPrivateRecord(file);
  if (!sameInode(capturedRecord.stat, restored.stat)) {
    throw new Error("Provider-only captured record restoration changed inode.");
  }
  unlinkExact(captured, capturedRecord.stat);
  syncDirectory(path.dirname(file));
}
function unlinkExact(file, expected) {
  const current = lstatSync(file);
  if (!sameInode(expected, current)) {
    throw new Error("Provider-only private path changed before exact unlink.");
  }
  unlinkSync(file);
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function existsNoFollow(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}
function parseRecord(bytes, label) {
  let value;
  try { value = JSON.parse(bytes); }
  catch { throw new Error(`${label} is malformed.`); }
  if (bytes !== `${canonicalJson(value)}\n`) throw new Error(`${label} bytes are not canonical.`);
  return value;
}
function nullableDigest(value) { return value == null ? null : digestValue(value); }
function sameInode(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function sameSnapshot(left, right) {
  return sameInode(left, right) && left.size === right.size
    && left.mode === right.mode && left.mtimeMs === right.mtimeMs;
}
function safely(action) { try { action(); } catch {} }
function normalizeInstant(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) throw new Error("Provider-only private record time is invalid.");
  return value.toISOString();
}
