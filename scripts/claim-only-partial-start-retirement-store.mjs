// Responsibility: Persist and validate private claim-only journals, effects, and raw claim output.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
export function claimOnlyOperationKeyFromDigest(operation, planDigest, phase) {
  return digestValue({
    schema: "agentic-claim-only-operation-key/v1",
    operation,
    planDigest,
    phase
  });
}
export function buildClaimOnlyRetirementRequest(plan, claim, phase, operationKey, expectedLedgerDigest) {
  return {
    claimId: claim.claimId,
    expectedFenceRevision: claim.claimDigest,
    expectedTransitionCounter: claim.transitionCounter,
    expectedLedgerDigest,
    reason: "superseded",
    finalRevision: claim.laneRevision,
    reviewRequestId: null,
    bytesDigest: digestValue({
      planDigest: plan.planDigest,
      phase,
      kind: "bytes"
    }),
    namedChecksDigest: digestValue({
      planDigest: plan.planDigest,
      phase,
      kind: "checks"
    }),
    handoffEvidenceDigest: digestValue({
      planDigest: plan.planDigest,
      phase,
      successorClaimId: plan.evidence.successor.claimId,
      kind: "handoff"
    }),
    integrationReceiptDigest: null,
    deviceId: claim.deviceId,
    sessionId: claim.sessionId,
    idempotencyKey: operationKey
  };
}
export function claimOnlyRetirementRequestDigest(plan, claim, phase) {
  const request = buildClaimOnlyRetirementRequest(plan, claim, phase, "unused", digestValue("unused"));
  const {
    idempotencyKey: _key,
    expectedLedgerDigest: _ledger,
    ...semantic
  } = request;
  return digestValue({
    action: "retire",
    intent: {
      repositoryId: claim.repositoryId,
      actorId: claim.actorId,
      ...semantic
    }
  });
}
export function claimOnlyOperationReceiptForEntry(entry, status) {
  const core = {
    schema: `agentic-collaboration-${entry.action === "retire" ? "retirement" : entry.action}-receipt/v1`,
    operation: entry.action,
    status,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime
  };
  return {
    ...core,
    receiptDigest: digestValue(core)
  };
}
export function claimOnlyTerminalEffects(plan, receipts) {
  const rollover = plan.operation === "claim-only-successor-rollover";
  const required = rollover ? ["stale-successor-retired", "replacement-claimed"] : ["source-retired"];
  if (required.some(name => !receipts[name])) {
    throw new Error("Claim-only terminal effect receipts are invalid.");
  }
  return rollover ? Object.freeze({
    staleSuccessorRetirement: receiptValues(receipts["stale-successor-retired"]),
    replacementClaim: receiptValues(receipts["replacement-claimed"])
  }) : Object.freeze({
    sourceRetirement: receiptValues(receipts["source-retired"])
  });
}
export function claimOnlyTerminalVerification(plan, receipts, preservation) {
  const effectReceiptDigest = digestValue(claimOnlyTerminalEffects(plan, receipts));
  return Object.freeze({
    effectReceiptDigest,
    terminalEvidenceDigest: digestValue({
      schema: "agentic-claim-only-terminal-evidence/v1",
      operation: plan.operation,
      planDigest: plan.planDigest,
      effectReceiptDigest
    }),
    preservationDigest: digestValue(preservation)
  });
}
export function validateClaimOnlyJournalSemantics({
  plan,
  phase,
  receipts,
  completionReceipt = null
}) {
  const expectedAuthorization = digestValue({
    operation: plan.operation,
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization
  });
  if (receipts.authorized.authorizationDigest !== expectedAuthorization) {
    throw new Error("Claim-only authorization join is invalid.");
  }
  if (receipts.prepared?.operationKey !== undefined
    && receipts.prepared.operationKey !== claimOnlyOperationKeyFromDigest(
      plan.operation, plan.planDigest, "prepared")) {
    throw new Error("Claim-only prepared operation key join is invalid.");
  }
  const effectPhases = plan.operation === "claim-only-successor-rollover"
    ? ["stale-successor-retired", "replacement-claimed"] : ["source-retired"];
  for (const effectPhase of effectPhases) {
    const effect = receipts[effectPhase];
    if (!effect) continue;
    if (effect.operationKey !== claimOnlyOperationKeyFromDigest(plan.operation, plan.planDigest, effectPhase)) {
      throw new Error(`Claim-only ${effectPhase} operation key join is invalid.`);
    }
    if (effect.cloudMutation !== true) {
      throw new Error(`Claim-only ${effectPhase} cloud mutation proof is invalid.`);
    }
    const claim = effectPhase === "source-retired" ? plan.evidence.source
      : effectPhase === "stale-successor-retired" ? plan.evidence.successor : null;
    if (claim && effect.requestDigest !== claimOnlyRetirementRequestDigest(plan, claim, effectPhase)) {
      throw new Error(`Claim-only ${effectPhase} request join is invalid.`);
    }
    if (effectPhase === "replacement-claimed"
      && effect.replacementClaimId !== plan.evidence.replacement.expectedClaimId) {
      throw new Error("Claim-only replacement claim join is invalid.");
    }
  }
  if (receipts.verified) {
    const expected = claimOnlyTerminalVerification(plan, receipts, plan.evidence.preservation);
    if (canonicalJson(receiptValues(receipts.verified)) !== canonicalJson(expected)) {
      throw new Error("Claim-only terminal verifier join is invalid.");
    }
  }
  if (phase === "complete" && canonicalJson(receipts.complete.receipt) !== canonicalJson(completionReceipt)) {
    throw new Error("Claim-only completion receipt join is invalid.");
  }
}
function receiptValues(receipt) {
  const values = {
    ...receipt
  };
  delete values.phase;
  delete values.receiptDigest;
  return Object.freeze(values);
}
export function projectClaimOnlyClaim(claim, genesis) {
  return Object.freeze({
    claimId: claim.claimId, claimDigest: claim.fenceRevision || claim.claimDigest,
    transitionDigest: claim.transitionDigest || claim.ledgerRevision,
    operationReceiptDigest: claim.operationReceiptDigest,
    entrySchema: claim.entrySchema, claimIdentitySchema: claim.claimIdentitySchema,
    state: claim.state, recordedState: genesis.claimCore.state,
    writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved,
    actorId: claim.actorId, repositoryId: claim.repositoryId,
    workItemId: claim.workItemId, deviceId: claim.deviceId, sessionId: claim.sessionId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    declaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: claim.writeSetDigest, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter, heartbeatCounter: claim.heartbeatCounter,
    reviewRequestId: claim.reviewRequestId || null,
    predecessorClaimId: claim.predecessorClaimId || null,
    expiresAt: claim.expiresAt,
    evidenceDigest: claim.evidenceDigest || null, recovery: claim.recovery || null,
    integration: claim.integration || null, retirement: claim.retirement || null,
    eligibleSince: genesis.claimCore.eligibleSince || null,
    handoff: genesis.claimCore.handoff || null, release: genesis.claimCore.release || null,
    canonicalDescendantProof: genesis.claimCore.canonicalDescendantProof || null
  });
}
export function projectClaimOnlyEntry(entry) {
  return Object.freeze({
    schema: entry.schema, action: entry.action, sequence: entry.sequence,
    claimId: entry.claimId, claimDigest: entry.claimDigest, digest: entry.digest,
    repositoryId: entry.repositoryId,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest, evaluationTime: entry.evaluationTime,
    state: entry.claimCore.state,
    transitionCounter: entry.claimCore.transitionCounter,
    heartbeatCounter: entry.claimCore.heartbeatCounter,
    recordedExpiresAt: entry.claimCore.expiresAt,
    predecessorClaimId: entry.claimCore.predecessorClaimId || null,
    reviewRequestId: entry.claimCore.reviewRequestId || null,
    retirement: entry.claimCore.retirement || null
  });
}
export function claimOnlyOverlapFrame(claims, successor) {
  const peers = claims.filter(claim => writeSetsOverlap(claim.declaredWriteScope, successor.declaredWriteScope));
  const waiting = peers.filter(claim => claim.state === "waiting-successor").sort(compareWaiting);
  const successorIndex = waiting.findIndex(claim => claim.claimId === successor.claimId);
  return Object.freeze({
    reservedClaimIds: peers.filter(claim => claim.scopeReserved).map(claim => claim.claimId).sort(),
    waitingClaimIds: waiting.map(claim => claim.claimId),
    higherPriorityWaitingClaimIds: waiting.slice(0, Math.max(0, successorIndex)).map(claim => claim.claimId)
  });
}
export function claimOnlyReplacementEvidence(successor, mainSha, ttlSeconds) {
  const evidence = {
    actorId: successor.actorId, repositoryId: successor.repositoryId,
    workItemId: successor.workItemId,
    deviceId: successor.deviceId, sessionId: successor.sessionId,
    canonicalBaseRevision: mainSha, laneRevision: mainSha,
    declaredWriteScope: successor.declaredWriteScope,
    writeSetDigest: successor.writeSetDigest,
    leaseEpoch: 2, predecessorClaimId: successor.claimId, ttlSeconds,
  };
  evidence.expectedClaimId = digestValue({
    actorId: evidence.actorId,
    canonicalBaseRevision: evidence.canonicalBaseRevision,
    leaseEpoch: evidence.leaseEpoch,
    repositoryId: evidence.repositoryId,
    workItemId: evidence.workItemId,
    writeSetDigest: evidence.writeSetDigest
  });
  return Object.freeze(evidence);
}
export function captureClaimOnlyRepositoryIdentity({
  repository, commonDirectory, targetRepository, git, readProvider,
}) {
  const observe = () => {
    const top = realpathSync(path.resolve(git(["rev-parse", "--show-toplevel"])));
    const common = realpathSync(path.resolve(
      repository,
      git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ));
    const origin = requiredText(git(["remote", "get-url", "origin"]), "origin URL");
    const provider = readProvider();
    if (top !== repository || common !== commonDirectory
      || repositoryFromRemote(origin) !== targetRepository
      || provider?.nameWithOwner !== targetRepository) {
      throw new Error("Claim-only target repository identity is invalid.");
    }
    return Object.freeze({
      targetRepository, providerRepositoryId: requiredText(provider.id, "provider ID"),
      nameWithOwner: provider.nameWithOwner,
      topLevelDigest: digestValue(top),
      gitCommonDirectoryDigest: digestValue(common),
      originUrlDigest: digestValue(origin)
    });
  };
  const first = observe();
  const second = observe();
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error("Claim-only stable repository identity double-read is invalid.");
  }
  return first;
}
export function captureClaimOnlyControllerEvidence({
  controllerRoot, commonDirectory, repository, git, gitRaw,
  readProvider, readProtection, runtimeFiles,
}) {
  const identity = captureClaimOnlyRepositoryIdentity({
    repository: controllerRoot, commonDirectory, targetRepository: repository,
    git, readProvider,
  });
  const headSha = requiredSha(git(["rev-parse", "HEAD"]), "controller HEAD");
  const originMainSha = requiredSha(git(["rev-parse", "origin/main"]), "controller origin/main");
  const remoteMainSha = claimOnlyFirstSha(git(["ls-remote", "origin", "refs/heads/main"]));
  const protection = readProtection();
  if (protection?.protected !== true || protection.commit?.sha !== remoteMainSha) {
    throw new Error("Claim-only provider-protected controller main is invalid.");
  }
  const runtime = runtimeFiles.map(file => ({
    file,
    digest: digestValue(readFileSync(path.join(controllerRoot, file)))
  }));
  return Object.freeze({
    repository: identity.targetRepository,
    providerRepositoryId: identity.providerRepositoryId,
    nameWithOwner: identity.nameWithOwner,
    branch: git(["branch", "--show-current"]),
    headSha, originMainSha, remoteMainSha,
    runtimeDigest: digestValue(runtime),
    clean: gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"]) === "",
    protected: true, protectionDigest: digestValue(protection),
  });
}
export function claimOnlyFirstSha(value) {
  const result = String(value).trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(result)) {
    throw new Error("Claim-only remote main is invalid.");
  }
  return result;
}
export function claimOnlyRepositoryName(value) {
  const result = requiredText(value, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) {
    throw new Error("Claim-only repository is invalid.");
  }
  return result;
}
function compareWaiting(left, right) {
  return String(left.eligibleSince).localeCompare(String(right.eligibleSince)) || left.ledgerSequence - right.ledgerSequence || left.claimId.localeCompare(right.claimId);
}
function repositoryFromRemote(value) {
  const remote = requiredText(value, "origin URL").replace(/\.git$/u, "");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/u.exec(remote);
  if (!match) throw new Error("Claim-only canonical GitHub origin is invalid.");
  return match[1];
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Claim-only ${label} is invalid.`);
  }
  return value.trim();
}
function requiredSha(value, label) {
  const result = String(value || "");
  if (!/^[0-9a-f]{40}$/u.test(result)) {
    throw new Error(`Claim-only ${label} is invalid.`);
  }
  return result;
}
export function createClaimOnlyPartialStartRetirementStore({
  statePath, claimOutputPath = null, now = () => new Date(),
} = {}) {
  const journalPath = safePrivateJsonPath(statePath, "journal");
  const outputPath = claimOutputPath ? safePrivateJsonPath(claimOutputPath, "claim output") : null;
  if (outputPath === journalPath) {
    throw new Error("Journal and raw claim output paths must be distinct.");
  }
  const lockPath = `${journalPath}.lock`;
  function readJournal() {
    return readPrivateJson(journalPath, "journal");
  }
  function writeJournal({ expected, next }) {
    object(next, "next journal");
    const current = readJournal();
    const expectedDigest = expected === null ? null : digestValue(object(expected, "expected journal"));
    const currentDigest = current === null ? null : digestValue(current);
    if (expectedDigest !== currentDigest) {
      throw new Error("Claim-only journal changed before its exact compare-and-swap.");
    }
    if (currentDigest === digestValue(next)) return current;
    writePrivateJsonAtomic(journalPath, next, { replace: current !== null });
    return next;
  }
  function readClaimOutput() {
    if (!outputPath) return null;
    return readPrivateJson(outputPath, "raw claim output");
  }
  function writeClaimOutput(value) {
    if (!outputPath) throw new Error("A private raw claim output path is required.");
    object(value, "raw claim output");
    const current = readClaimOutput();
    if (current !== null) {
      if (canonicalJson(current) !== canonicalJson(value)) {
        throw new Error("Raw claim output already contains a different result.");
      }
      return current;
    }
    writePrivateJsonAtomic(outputPath, value, { replace: false });
    return value;
  }
  async function withOperationLock(context, action) {
    if (typeof action !== "function") throw new Error("Operation callback is required.");
    ensurePrivateDirectory(path.dirname(journalPath));
    const owner = acquireLock(lockPath, context, now);
    try {
      return await action();
    } finally {
      releaseLock(lockPath, owner);
    }
  }
  return Object.freeze({
    statePath: journalPath, claimOutputPath: outputPath,
    readJournal, writeJournal, readClaimOutput, writeClaimOutput, withOperationLock,
  });
}
export function readClaimOnlyPrivateJson(file, label = "private JSON") {
  return readPrivateJson(safePrivateJsonPath(file, label), label);
}
function acquireLock(file, context, now) {
  const normalizedContext = JSON.parse(canonicalJson(object(context, "lock context")));
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error("Operation process identity is unavailable.");
  const owner = Object.freeze({
    pid: process.pid,
    processIdentity: identity,
    token: randomUUID(),
    acquiredAt: instant(now()),
    context: normalizedContext,
    contextDigest: digestValue(normalizedContext)
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeExclusive(file, owner);
      return owner;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const observed = readPrivateJson(file, "operation lock");
    if (!validOwner(observed)) throw new Error("Operation lock is malformed.");
    const observedIdentity = processIdentity(observed.pid);
    if (observedIdentity === observed.processIdentity) {
      throw new Error("Operation is locked by a live controller.");
    }
    if (!observedIdentity && processExists(observed.pid)) {
      throw new Error("Operation lock owner identity cannot be verified.");
    }
    const stale = `${file}.stale-${randomUUID()}`;
    renameSync(file, stale);
    const moved = readPrivateJson(stale, "stale operation lock");
    if (moved?.token !== observed.token) {
      if (!existsSync(file)) renameSync(stale, file);
      throw new Error("Operation lock changed during stale-owner recovery.");
    }
    unlinkSync(stale);
    fsyncDirectory(path.dirname(file));
  }
  throw new Error("Operation lock could not be acquired.");
}
function releaseLock(file, owner) {
  const observed = readPrivateJson(file, "operation lock");
  if (observed?.token !== owner.token || observed.contextDigest !== owner.contextDigest) {
    throw new Error("Operation lock ownership changed before release.");
  }
  unlinkSync(file);
  fsyncDirectory(path.dirname(file));
}
function writeExclusive(file, value) {
  ensurePrivateDirectory(path.dirname(file));
  const descriptor = openSync(file, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${canonicalJson(value)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file));
}
function writePrivateJsonAtomic(file, value, { replace }) {
  ensurePrivateDirectory(path.dirname(file));
  if (!replace) {
    writeExclusive(file, value);
    return;
  }
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  writeExclusive(temporary, value);
  renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}
function readPrivateJson(file, label) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error(`${label} must be a private regular file.`);
    }
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
function safePrivateJsonPath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value || path.extname(value) !== ".json") {
    throw new Error(`${label} path must be an absolute normalized JSON path.`);
  }
  rejectExistingSymlinks(value, label);
  return value;
}
function rejectExistingSymlinks(value, label) {
  const parsed = path.parse(value);
  let current = parsed.root;
  for (const segment of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} path cannot traverse a symbolic link.`);
    }
  }
}
function ensurePrivateDirectory(directory) {
  rejectExistingSymlinks(directory, "private directory");
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const stat = statSync(directory);
  if (!stat.isDirectory()) throw new Error("Private journal parent must be a directory.");
  // The controller-created leaf is private. Existing system ancestors need not be mode 0700.
  if ((stat.mode & 0o077) !== 0) throw new Error("Private journal parent must have mode 0700.");
  fsyncDirectory(directory);
}
function validOwner(value) {
  return value && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.processIdentity === "string" && value.processIdentity.length > 0 && typeof value.token === "string" && value.token.length > 0 && value.context && value.contextDigest === digestValue(value.context);
}
function processIdentity(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8"
    }).trim() || null;
  } catch {
    return null;
  }
}
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}
function fsyncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
function instant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Operation time is invalid.");
  return date.toISOString();
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value;
}
