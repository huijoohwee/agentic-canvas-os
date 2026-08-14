// Responsibility: Preserve the complete direct waiter queue around exact local worktree rehydration.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  digestValue, normalizeWriteSet, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  createOpenReviewedLaneQueuePreservationIntent,
  normalizeOpenReviewedLaneQueuePreservationIntent,
  PRESERVED_QUEUE_SCHEMA,
} from "./open-reviewed-lane-queue-preservation-contract.mjs";
import { createOpenReviewedLaneRehydrationController }
  from "./open-reviewed-lane-rehydration-controller.mjs";
import { createRepositoryOpenReviewedLaneRehydrationAdapter }
  from "./open-reviewed-lane-rehydration-repository-adapter.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { parseWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";

const RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const ORDER = "lease-epoch-then-claim-id";
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const WORK_ITEM = /^work-item:[0-9a-f]{64}$/u;
const CLAIM_KEYS = Object.freeze([
  "claimId", "entrySchema", "claimIdentitySchema", "state", "writeAuthority",
  "scopeReserved", "actorId", "repositoryId", "workItemId", "canonicalBaseRevision",
  "laneRevision", "declaredWriteScope", "writeSetDigest", "leaseEpoch",
  "transitionCounter", "heartbeatCounter", "reviewRequestId", "predecessorClaimId",
  "expiresAt", "fenceRevision", "transitionDigest", "operationReceiptDigest",
  "integrationReceiptDigest", "integration",
]);

export function createRepositoryOpenReviewedLaneQueuePreservationAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const targetPath = path.resolve(required(options.targetPath, "target path"));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, settings = {}) => execFileSync(
    command, argumentsList, { cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], ...settings },
  ));
  const gitRaw = dependencies.gitRaw || (argumentsList => execute("git", argumentsList));
  const git = dependencies.git || (argumentsList => String(gitRaw(argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const createInnerAdapter = dependencies.createInnerAdapter
    || createRepositoryOpenReviewedLaneRehydrationAdapter;
  const createInnerController = dependencies.createInnerController
    || createOpenReviewedLaneRehydrationController;
  const uuid = dependencies.randomUUID || randomUUID;
  const readReviewBody = dependencies.readReviewBody || (() => {
    const response = parseJson(gh(["pr", "view", String(pullRequestNumber), "--json", "body"]),
      "review body response");
    return required(response?.body, "review body");
  });
  const commonDir = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const journalDir = path.join(commonDir, "agentic-canvas-os",
    "open-reviewed-lane-queue-preservation");
  const innerDependencies = selectInnerDependencies(dependencies, { execute, gitRaw, git, gh });

  function readMarker() {
    const body = readReviewBody({ repository, pullRequestNumber });
    const marker = parseWriterLeasePullRequestBody(required(body, "review body"));
    if (!marker) fail("review writer marker");
    return marker;
  }

  function captureQueue(input = null) {
    const marker = readMarker();
    const authority = marker.cloudAuthority;
    const ledgerRepository = repositoryIdentity(authority?.ledgerRepository,
      "ledger repository identity");
    const targetRepository = repositoryIdentity(authority?.targetRepository,
      "target repository identity");
    if (input && (input.action !== "status" || input.ledgerRepository !== ledgerRepository
      || input.request?.targetRepository !== targetRepository
      || Object.keys(input.request || {}).length !== 1)) {
      fail("inner cloud status request");
    }
    const status = cloud({ action: "status", ledgerRepository,
      request: { targetRepository }, environment });
    return classifyQueue({ marker, status, ledgerRepository, targetRepository });
  }

  function createInner(expectedQueueDigest) {
    const filteredCloud = input => {
      const observed = captureQueue(input);
      requireQueueDigest(observed.queue, expectedQueueDigest, "inner cloud status");
      const hidden = new Set(observed.queue.entries.map(item => item.claimId));
      return Object.freeze({ ...observed.status,
        claims: Object.freeze(observed.status.claims.filter(item => !hidden.has(item.claimId))) });
    };
    const adapter = createInnerAdapter({ repository, targetPath, pullRequestNumber, environment },
      { ...innerDependencies, cloud: filteredCloud });
    const controller = createInnerController({ adapter });
    if (typeof controller?.plan !== "function" || typeof controller?.run !== "function") {
      fail("inner controller interface");
    }
    return controller;
  }

  return Object.freeze({
    readPlanEvidence() {
      const observed = captureQueue();
      const innerPlan = createInner(observed.queue.queueDigest).plan();
      return Object.freeze({ innerPlan, preservedQueue: observed.queue });
    },
    withOperationLock({ operationId }, action) {
      if (!DIGEST.test(String(operationId || "")) || typeof action !== "function") {
        fail("operation lock input");
      }
      return withFileLock(path.join(journalDir, `${operationId}.lock`), action);
    },
    readIntent({ plan }) {
      return readJournal(journalPath(plan));
    },
    writeIntent({ expected, value }) {
      const normalized = normalizeOpenReviewedLaneQueuePreservationIntent(value);
      writeJournal(path.join(journalDir, `${normalized.operationId}.json`), expected, normalized);
    },
    revalidate({ plan, stage }) {
      if (!["before-inner", "after-inner"].includes(stage)) fail("revalidation stage");
      const observed = captureQueue();
      requireQueueDigest(observed.queue, plan?.evidence?.preservedQueueDigest, stage);
      return observed.queue;
    },
    runInner({ outerPlan, plan, authorization }) {
      requireInnerJoin(outerPlan, plan, authorization);
      return createInner(outerPlan.evidence.preservedQueueDigest).run({ plan, authorization });
    },
    verifyTerminal({ plan }) {
      const innerPlan = plan?.evidence?.innerPlan;
      requireInnerJoin(plan, innerPlan, innerPlan?.exactAuthorization);
      return createInner(plan.evidence.preservedQueueDigest).run({ plan: innerPlan,
        authorization: innerPlan.exactAuthorization });
    },
  });

  function journalPath(plan) {
    const intent = createOpenReviewedLaneQueuePreservationIntent(plan);
    return path.join(journalDir, `${intent.operationId}.json`);
  }
  function readJournal(file) {
    if (!existsSync(file)) return null;
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
      fail("journal file");
    }
    return normalizeOpenReviewedLaneQueuePreservationIntent(
      parseJson(readFileSync(file, "utf8"), "journal"),
    );
  }
  function writeJournal(file, expected, value) {
    ensureJournalDirectory();
    const current = readJournal(file);
    const expectedValue = expected === null || expected === undefined ? null
      : normalizeOpenReviewedLaneQueuePreservationIntent(expected);
    if (digestValue(current) !== digestValue(expectedValue)) fail("journal compare-and-swap");
    writeAtomicPrivateJson(file, value);
  }
  function writeAtomicPrivateJson(file, value) {
    const temporary = `${file}.${process.pid}.${uuid()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    try {
      renameSync(temporary, file);
      syncDirectory(journalDir);
    } catch (error) {
      try { unlinkSync(temporary); } catch {}
      throw error;
    }
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
      fail("journal mode");
    }
  }
  function ensureJournalDirectory() {
    let current = commonDir;
    for (const segment of ["agentic-canvas-os", "open-reviewed-lane-queue-preservation"]) {
      current = path.join(current, segment);
      try {
        const metadata = lstatSync(current);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()
          || realpathSync(current) !== current) fail("journal directory");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        mkdirSync(current, { mode: 0o700 });
        syncDirectory(path.dirname(current));
      }
    }
  }
  function withFileLock(file, action) {
    ensureJournalDirectory();
    const token = uuid();
    let descriptor;
    try { descriptor = openSync(file, "wx", 0o600); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      throw new Error("Queue-preservation operation is already fenced; abandoned-lock recovery requires separate exact authority.");
    }
    try {
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
      fsyncSync(descriptor);
      syncDirectory(journalDir);
      return action();
    } finally {
      closeSync(descriptor);
      if (readLock(file)?.token === token) {
        unlinkSync(file);
        syncDirectory(journalDir);
      }
    }
  }
}

function classifyQueue({ marker, status, ledgerRepository, targetRepository }) {
  if (status?.schema !== RESULT_SCHEMA || status.ok !== true || status.action !== "status"
    || status.status !== "ready" || !Array.isArray(status.claims)
    || !SHA.test(String(status.ledgerRevision || ""))
    || !DIGEST.test(String(status.ledgerDigest || ""))) fail("full cloud status");
  const claimIds = status.claims.map(item => item?.claimId);
  if (claimIds.some(item => !DIGEST.test(String(item || "")))
    || new Set(claimIds).size !== claimIds.length) fail("full cloud claim identity");
  const sourceMatches = status.claims.filter(item => item?.claimId === marker.cloudAuthority?.claimId);
  if (sourceMatches.length !== 1) fail("source claim cardinality");
  const source = sourceMatches[0];
  required(source.actorId, "source actor");
  required(source.repositoryId, "source repository");
  if (!DIGEST.test(String(source.claimId || "")) || !WORK_ITEM.test(String(source.workItemId || ""))
    || typeof source.reviewRequestId !== "string" || !source.reviewRequestId
    || marker.cloudAuthority?.reviewRequestId !== source.reviewRequestId) fail("source review identity");
  const direct = status.claims.filter(item => item !== source
    && item?.predecessorClaimId === source.claimId);
  if (direct.length < 1 || direct.length > 128) fail("direct waiter cardinality");
  const entries = direct.map((item, index) => normalizeWaiter(item, source, index))
    .sort((left, right) => left.leaseEpoch - right.leaseEpoch
      || left.claimId.localeCompare(right.claimId));
  if (new Set(entries.map(item => item.claimId)).size !== entries.length) fail("direct waiter identity");
  const waiterIds = new Set(entries.map(item => item.claimId));
  const blockers = status.claims.filter(item => item !== source && !waiterIds.has(item?.claimId)
    && (item?.reviewRequestId === source.reviewRequestId
      || overlaps(item?.declaredWriteScope, source.declaredWriteScope)));
  if (blockers.length) fail("non-queue competing cloud claim");
  const sourceClaim = Object.freeze({ claimId: source.claimId, actorId: source.actorId,
    repositoryId: source.repositoryId, workItemId: source.workItemId });
  const core = Object.freeze({ schema: PRESERVED_QUEUE_SCHEMA, sourceClaim,
    ledgerRepository, targetRepository, ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest, complete: true, order: ORDER,
    entries: Object.freeze(entries) });
  const queueDigest = digestValue({ schema: core.schema, sourceClaim: core.sourceClaim,
    ledgerRepository: core.ledgerRepository, targetRepository: core.targetRepository,
    complete: core.complete, order: core.order, entries: core.entries });
  return Object.freeze({ status, marker, source,
    queue: Object.freeze({ ...core, queueDigest }) });
}

function normalizeWaiter(value, source, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...CLAIM_KEYS].sort())) {
    fail(`direct waiter ${index + 1} projection`);
  }
  if (value.entrySchema !== ENTRY_SCHEMA || value.claimIdentitySchema !== ENTRY_SCHEMA
    || value.state !== "waiting-successor" || value.writeAuthority !== false
    || value.scopeReserved !== false || value.reviewRequestId !== null
    || value.integrationReceiptDigest !== null || value.integration !== null
    || value.predecessorClaimId !== source.claimId || value.actorId !== source.actorId
    || value.repositoryId !== source.repositoryId) fail(`direct waiter ${index + 1} authority`);
  let declaredWriteScope;
  try { declaredWriteScope = normalizeWriteSet(value.declaredWriteScope); }
  catch { fail(`direct waiter ${index + 1} write set`); }
  const claim = Object.freeze({ ...value, declaredWriteScope });
  if (!DIGEST.test(String(claim.claimId || "")) || !WORK_ITEM.test(String(claim.workItemId || ""))
    || !SHA.test(String(claim.canonicalBaseRevision || ""))
    || !SHA.test(String(claim.laneRevision || ""))
    || !DIGEST.test(String(claim.writeSetDigest || ""))
    || !DIGEST.test(String(claim.predecessorClaimId || ""))
    || !DIGEST.test(String(claim.fenceRevision || ""))
    || !DIGEST.test(String(claim.transitionDigest || ""))
    || !DIGEST.test(String(claim.operationReceiptDigest || ""))
    || !validInstant(claim.expiresAt)
    || !positiveInteger(claim.leaseEpoch) || !positiveInteger(claim.transitionCounter)
    || !nonnegative(claim.heartbeatCounter)) fail(`direct waiter ${index + 1} fields`);
  const expectedClaimId = digestValue({ actorId: claim.actorId,
    canonicalBaseRevision: claim.canonicalBaseRevision, leaseEpoch: claim.leaseEpoch,
    repositoryId: claim.repositoryId, workItemId: claim.workItemId,
    writeSetDigest: claim.writeSetDigest });
  if (claim.writeSetDigest !== digestValue(declaredWriteScope)
    || claim.claimId !== expectedClaimId) fail(`direct waiter ${index + 1} identity`);
  return claim;
}

function selectInnerDependencies(dependencies, normalized) {
  const {
    createInnerAdapter: _createInnerAdapter, createInnerController: _createInnerController,
    readReviewBody: _readReviewBody, randomUUID: _randomUUID, cloud: _cloud,
    ...remaining
  } = dependencies;
  return Object.freeze({ ...remaining, ...normalized });
}
function requireInnerJoin(outerPlan, innerPlan, authorization) {
  const expected = outerPlan?.evidence?.innerPlan;
  if (!expected || innerPlan?.planDigest !== expected.planDigest
    || authorization !== expected.exactAuthorization) fail("inner plan join");
}
function requireQueueDigest(queue, expected, stage) {
  if (!DIGEST.test(String(expected || "")) || queue.queueDigest !== expected) {
    throw new Error(`Open reviewed lane preserved queue content drifted at ${stage}.`);
  }
}
function readLock(file) {
  try {
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) return null;
    const value = parseJson(readFileSync(file, "utf8"), "operation lock");
    return Number.isSafeInteger(value?.pid) && value.pid > 0 && typeof value?.token === "string"
      ? value : null;
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function overlaps(left, right) {
  try { return writeSetsOverlap(left, right); } catch { return true; }
}
function parseJson(value, label) {
  try { return JSON.parse(String(value)); } catch { fail(label); }
}
function validInstant(value) {
  try { return typeof value === "string" && new Date(value).toISOString() === value; } catch { return false; }
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) fail(label);
  return value;
}
function repositoryIdentity(value, label) {
  const result = required(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) fail(label);
  return result;
}
function positive(value, label = "positive integer") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(label);
  return number;
}
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function nonnegative(value) { return Number.isSafeInteger(value) && value >= 0; }
function fail(label) {
  throw new Error(`Open reviewed lane queue-preservation repository adapter ${label} is invalid.`);
}
