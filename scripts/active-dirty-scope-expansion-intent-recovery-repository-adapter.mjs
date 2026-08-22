// Responsibility: derive repository recovery evidence and settle its sole terminal CAS effect.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue, normalizeWriteSet, validateLedger, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { projectTerminalScopeExpansionIntent }
  from "./active-dirty-scope-expansion-intent-recovery-contract.mjs";
import { buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence,
  buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
  verifyExactScopeExpansionHeartbeatSuffix }
  from "./active-dirty-scope-expansion-intent-recovery-evidence.mjs";
import { createGitHubCloudCollaborationAdapter }
  from "./github-cloud-collaboration-adapter.mjs";
import { projectPublicClaim } from "./github-cloud-collaboration-mapping.mjs";
import { isOperationDerivedCloudVerification } from "./scoped-lane-admission-lib.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { mutateWriterLeaseRegistry, readScopeExpansionIntent, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOURNAL_SCHEMA = "agentic-active-dirty-scope-expansion-intent-recovery-journal/v1";
const IMPLEMENTATION = ["contract", "controller", "evidence", "repository-adapter", ""]
  .map(suffix => `active-dirty-scope-expansion-intent-recovery${suffix ? `-${suffix}` : ""}.mjs`);
const METHODS = ["withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent",
  "observeTerminal", "executeTerminal"];
export const MAX_RECOVERY_LEDGER_BYTES = 16_777_216;

export function createActiveDirtyScopeExpansionIntentRecoveryAdapter(methods = {}) {
  for (const name of METHODS) {
    if (typeof methods[name] !== "function") throw new Error(`Recovery adapter requires ${name}().`);
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createRepositoryActiveDirtyScopeExpansionIntentRecoveryAdapter({
  sourceRepository, targetRepository, pullRequestNumber, sessionId,
  ledgerRepository = null, controllerRoot = CONTROLLER_ROOT,
  environment = process.env, execute = execFileSync, resolveRealpath = realpathSync,
  now = () => new Date(), leaseStore = null, cloudInventory = null,
  verifyCloudAuthority = verifyAdmissionCloudAuthority,
  buildMutationAuthority = buildActiveDirtyScopeExpansionIntentRecoveryMutationAuthority,
  cloudInspect = invokeRepositoryCloudAction,
} = {}) {
  const controller = resolveRealpath(path.resolve(controllerRoot));
  if (controller !== resolveRealpath(CONTROLLER_ROOT)) throw new Error("Recovery requires its exact protected controller root.");
  const sourceRoot = resolveRealpath(path.resolve(requiredText(sourceRepository, "source repository")));
  const target = requiredRepository(targetRepository, "target repository");
  const ledger = requiredRepository(ledgerRepository, "ledger repository");
  const pullNumber = positiveInteger(pullRequestNumber, "pull request number");
  const session = requiredText(sessionId, "session ID");
  const command = (program, args, cwd = sourceRoot) => execute(program, args, subprocess(cwd, environment));
  const git = (args, cwd = sourceRoot) => String(command("git", args, cwd));
  const gh = args => String(command("gh", args, sourceRoot));
  const commonDirectory = resolveRealpath(path.resolve(sourceRoot, git(["rev-parse", "--git-common-dir"]).trim()));
  const store = leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, now });
  if (typeof store.withRegistryLock !== "function" || !store.statePath) throw new Error("Recovery requires writer-registry CAS.");
  const journalKey = digestValue({ sourceRoot, session, target, pullNumber });
  const journalPath = path.join(commonDirectory, "agentic-canvas-os",
    "active-dirty-scope-expansion-intent-recovery", `${journalKey}.json`);
  const entryLock = `${journalPath}.entrypoint.lock`;
  const inventory = cloudInventory || stableInventoryReader(
    createGitHubCloudCollaborationAdapter({ ledgerRepository: ledger }), target,
  );

  const readLive = async () => {
    const branch = requiredText(git(["branch", "--show-current"]).trim(), "source branch");
    const lease = store.verify({ sessionId: session, branch });
    if (path.resolve(lease.worktreePath) !== sourceRoot) throw new Error("Recovery source is not the exact leased worktree.");
    requireRecoveryLedgerRepository({ ledgerRepository: ledger, authority: lease.cloudAuthority });
    const intent = readScopeExpansionIntent({ leaseStore: store, branch });
    const lane = readLane({ git, sourceRoot, branch });
    if (lane.dirtyDigest !== intent?.planSnapshot?.sourceDirtyDigest
      || JSON.stringify(lane.changedPaths) !== JSON.stringify(intent?.planSnapshot?.sourceChangedPaths)) {
      throw new Error("Recovery dirt changed from the original scope-expansion intent.");
    }
    const pullRequest = readPullRequest({ gh, pullNumber, target });
    const marker = parseSingleMarker(pullRequest.body);
    const cloud = await inventory();
    const currentClaim = exactClaim(cloud.claims, lease.cloudAuthority.claimId);
    const manifest = normalizeDeclaredWriteScopeManifest({
      schema: "agentic-declared-write-scope/v1",
      semanticScope: lease.scope,
      paths: lease.admission.declaredWriteSet.filter(item => item.startsWith("path:"))
        .map(item => item.slice("path:".length)),
    }, { expectedScope: lease.scope });
    const verified = await verifyCloudAuthority({
      authority: lease.cloudAuthority, manifest,
      canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha, environment,
      inspect: cloudInspect,
    });
    const mutationAuthority = buildMutationAuthority({
      lease, currentAuthority: lease.cloudAuthority, verifiedAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification, currentClaim,
    });
    const historicalLedger = readLedger({ gh, ledgerRepository: ledger, revision: intent.boundAuthority.ledgerRevision });
    const currentLedger = readLedger({ gh, ledgerRepository: ledger, revision: verified.authority.ledgerRevision });
    const ledgerLineage = verifyExactScopeExpansionHeartbeatSuffix({
      historicalLedger, currentLedger, boundAuthority: intent.boundAuthority, currentClaim,
      historicalSuccessors: { waiting: intent.waiting, promoted: intent.promoted,
        bound: intent.boundAuthority, sourceClaimId: intent.sourceClaimId,
        targetReviewRequestId: intent.targetReviewRequestId },
    });
    const dirt = { changedPaths: lane.changedPaths, untrackedPaths: lane.untrackedPaths,
      dirtyDigest: lane.dirtyDigest };
    return { controller: readController({ controller, git, target }), lane, lease,
      leaseDigest: writerLeaseDigest(lease), scopeExpansionIntent: intent,
      scopeExpansionIntentDigest: digestValue(intent), targetManifest: manifest,
      currentAuthority: lease.cloudAuthority, currentClaim, ledgerLineage,
      pullRequest: projectPullRequest(pullRequest, marker), dirt, mutationAuthority };
  };
  const readSnapshot = async () => {
    const live = await readLive();
    return buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence({
      ...live,
    }, { expectedIntentStatus: live.scopeExpansionIntent.status });
  };

  const observeTerminal = async context => {
    const live = await readLive();
    const currentIntent = live.scopeExpansionIntent;
    if (currentIntent.status !== "complete") return { state: "pending" };
    assertPreserved(context.plan.sourceEvidence, live);
    requireActiveDirtyScopeExpansionIntentRecoveryDeterministicTerminal({
      sourceIntent: context.plan.sourceEvidence.scopeExpansionIntent,
      currentIntent, live,
    });
    return buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation({
      plan: context.plan, operationKey: context.operationKey,
      recoveredScopeExpansionIntent: currentIntent,
    });
  };

  return createActiveDirtyScopeExpansionIntentRecoveryAdapter({
    withEntrypointFence: (subject, action) => withLock(entryLock, subject, action, now),
    readSourceEvidence: readSnapshot,
    readIntent: () => readJournal(journalPath),
    writeIntent: input => writeJournalCas(journalPath, input, now),
    observeTerminal,
    executeTerminal: async context => {
      const before = await readSnapshot();
      assertPreserved(context.plan.sourceEvidence, before);
      settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
        before, leaseStore: store,
        readPullRequest: () => readPullRequest({ gh, pullNumber, target }),
        editPullRequest: (url, body) => command("gh", ["pr", "edit", url, "--body", body]),
      });
      const after = await readLive();
      assertPreserved(before, after);
      if (after.scopeExpansionIntent.status !== "complete") throw new Error("Terminal recovery did not commit.");
      return { operationKey: context.operationKey };
    },
  });
}

export function buildActiveDirtyScopeExpansionIntentRecoveryMutationAuthority({
  lease, currentAuthority, verifiedAuthority, remoteAuthorityVerification,
  currentClaim,
} = {}) {
  const verification = remoteAuthorityVerification;
  const inventory = verification?.inventory, claims = inventory?.claims;
  const candidates = claims?.filter(claim => claim.claimId === currentAuthority?.claimId);
  if (!isOperationDerivedCloudVerification(verification)
    || verification.status !== "ready" || !Array.isArray(claims) || candidates.length !== 1) {
    throw new Error("Recovery mutation authority requires one fresh operation-derived inventory.");
  }
  const omitHead = value => { const { ledgerRevision, ledgerDigest, ...subject } = value; return subject; };
  const candidate = candidates[0];
  const scope = normalizeWriteSet(currentClaim?.declaredWriteScope);
  const competing = claims.some(claim => claim.claimId !== currentAuthority.claimId
    && !["waiting-successor", "parked"].includes(claim.state)
    && writeSetsOverlap(claim.declaredWriteScope, scope));
  const evaluatedAt = verification.verifiedAt;
  const expiresAt = new Date(Math.min(Date.parse(lease?.expiresAt),
    Date.parse(currentAuthority?.expiresAt), Date.parse(currentClaim?.expiresAt))).toISOString();
  if (digestValue(currentAuthority) !== digestValue(lease?.cloudAuthority)
    || digestValue(omitHead(verifiedAuthority)) !== digestValue(omitHead(currentAuthority))
    || verification.claimId !== currentAuthority.claimId
    || verification.claimDigest !== currentAuthority.claimDigest
    || currentClaim.claimId !== currentAuthority.claimId
    || currentClaim.fenceRevision !== currentAuthority.claimDigest
    || (currentClaim.transitionDigest ?? currentClaim.ledgerRevision)
      !== currentAuthority.claimLedgerRevision
    || currentClaim.transitionCounter !== currentAuthority.transitionCounter
    || currentClaim.heartbeatCounter !== currentAuthority.heartbeatCounter
    || currentClaim.expiresAt !== currentAuthority.expiresAt
    || currentClaim.state !== "current" || currentClaim.writeAuthority !== true
    || candidate.fenceRevision !== currentAuthority.claimDigest
    || candidate.transitionDigest !== currentAuthority.claimLedgerRevision
    || candidate.transitionCounter !== currentAuthority.transitionCounter
    || candidate.heartbeatCounter !== currentAuthority.heartbeatCounter
    || candidate.state !== "active"
    || candidate.expiresAt !== currentAuthority.expiresAt
    || candidate.canonicalBaseRevision !== currentAuthority.canonicalBaseSha
    || candidate.laneRevision !== currentAuthority.laneRevision
    || candidate.writeSetDigest !== currentAuthority.writeSetDigest
    || candidate.leaseEpoch !== currentAuthority.leaseEpoch
    || candidate.reviewRequestId !== currentAuthority.reviewRequestId
    || competing || Date.parse(expiresAt) <= Date.parse(evaluatedAt)) {
    throw new Error("Recovery mutation authority changed the exact local C4 claim subject.");
  }
  const core = { schema: "agentic-active-dirty-scope-expansion-intent-recovery-mutation-authority/v1",
    status: "ready", claimId: currentAuthority.claimId,
    claimDigest: currentAuthority.claimDigest,
    claimLedgerRevision: currentAuthority.claimLedgerRevision,
    localAuthorityDigest: digestValue(currentAuthority), localLeaseDigest: writerLeaseDigest(lease),
    localLeaseEpoch: lease.epoch, localFenceSha: lease.fenceSha,
    globalLedgerRevision: verification.ledgerRevision,
    globalLedgerDigest: verification.ledgerDigest,
    currentClaimDigest: digestValue(projectPublicClaim(currentClaim)),
    currentClaimInventoryDigest: inventory.inventoryDigest,
    cloudVerificationReceiptDigest: verification.receiptDigest,
    evaluatedAt, expiresAt };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function settleActiveDirtyScopeExpansionIntentRecoveryTerminal({
  before, leaseStore, readPullRequest: readPull, editPullRequest,
} = {}) {
  if (before.scopeExpansionIntent.status === "complete") return before.scopeExpansionIntent;
  let terminal;
  mutateWriterLeaseRegistry({
    leaseStore, branch: before.lane.branch,
    expectedLeaseDigest: before.leaseDigest,
    expectedClaimId: before.currentAuthority.claimId,
    action: ({ registry, lease }) => {
      const liveIntent = registry.scopeExpansionIntents?.[before.lane.branch];
      if (digestValue(liveIntent) !== before.scopeExpansionIntentDigest) throw new Error("Scope-expansion intent changed before terminal CAS.");
      const currentPull = readPull();
      const currentMarker = parseSingleMarker(currentPull.body);
      const expectedMarker = projectWriterLeasePullRequestMarker(lease);
      let expectedBody = currentPull.body;
      if (digestValue(currentPull.body) !== before.pullRequest.bodyDigest) {
        throw new Error("Pull-request body changed before terminal CAS.");
      }
      if (digestValue(currentMarker) !== digestValue(expectedMarker)) {
        if (digestValue(pullIdentity(currentPull)) !== digestValue(pullIdentity(before.pullRequest))) throw new Error("Pull request changed before terminal CAS.");
        expectedBody = updateWriterLeasePullRequestBody(currentPull.body, lease);
        editPullRequest(currentPull.url, expectedBody);
      }
      const verifiedPull = readPull();
      const verifiedMarker = parseSingleMarker(verifiedPull.body);
      if (verifiedPull.body !== expectedBody
        || digestValue(verifiedMarker) !== digestValue(expectedMarker)) {
        throw new Error("Pull-request marker CAS did not converge.");
      }
      terminal = projectTerminalScopeExpansionIntent({
        sourceIntent: liveIntent, currentLeaseDigest: writerLeaseDigest(lease),
        currentAuthority: before.currentAuthority,
        mutationAuthorityReceipt: before.mutationAuthority,
        pullRequestMarkerDigest: digestValue(verifiedMarker), pullRequestUrl: verifiedPull.url,
      });
      return { registry: { ...registry, scopeExpansionIntents: {
        ...(registry.scopeExpansionIntents || {}), [before.lane.branch]: terminal,
      } }, lease, intent: terminal, changed: true };
    },
  });
  return terminal;
}

export function requireActiveDirtyScopeExpansionIntentRecoveryDeterministicTerminal({
  sourceIntent, currentIntent, live,
} = {}) {
  const expected = projectTerminalScopeExpansionIntent({
    sourceIntent, currentLeaseDigest: live.leaseDigest,
    currentAuthority: live.currentAuthority,
    mutationAuthorityReceipt: live.mutationAuthority,
    pullRequestMarkerDigest: live.pullRequest.markerDigest,
    pullRequestUrl: live.pullRequest.url,
  });
  if (digestValue(currentIntent) !== digestValue(expected)) {
    throw new Error("Live complete scope-expansion intent is not the deterministic C4 projection.");
  }
  return expected;
}

function readController({ controller, git, target }) {
  const headSha = git(["rev-parse", "HEAD"], controller).trim();
  const originMainSha = git(["rev-parse", "origin/main"], controller).trim();
  const remoteMainSha = git(["ls-remote", "origin", "refs/heads/main"], controller).trim().split(/\s+/u)[0];
  const origin = git(["config", "--get", "remote.origin.url"], controller).trim();
  if (repositoryFromOrigin(origin) !== target) throw new Error("Protected controller origin changed.");
  return { path: controller, origin,
    targetRepository: target, headSha, originMainSha, remoteMainSha,
    treeSha: git(["rev-parse", "HEAD^{tree}"], controller).trim(),
    clean: git(["status", "--porcelain=v1"], controller) === "",
    implementationDigest: digestValue(IMPLEMENTATION.map(name => ({ name,
      digest: createHash("sha256").update(readFileSync(path.join(controller, "scripts", name))).digest("hex") }))),
  };
}

function readLane({ git, sourceRoot, branch }) {
  const changedPaths = splitNul(git(["diff", "--name-only", "-z", "HEAD", "--"])).sort();
  const untrackedPaths = splitNul(git(["ls-files", "--others", "--exclude-standard", "-z"])).sort();
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return { path: sourceRoot, branch, headSha: git(["rev-parse", "HEAD"]).trim(),
    remoteHeadSha: git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).trim().split(/\s+/u)[0],
    dirty: Boolean(status), changedPaths, untrackedPaths,
    dirtyDigest: activeDirtyScopeExpansionIntentRecoveryDirtDigest({
      stagedPatch: git(["diff", "--cached", "--binary"]),
      unstagedPatch: git(["diff", "--binary"]), changedPaths,
      untrackedPaths,
    }),
  };
}

export function activeDirtyScopeExpansionIntentRecoveryDirtDigest({
  stagedPatch = "", unstagedPatch = "", changedPaths = [], untrackedPaths = [],
} = {}) {
  return digestValue({
    stagedPatch: String(stagedPatch).trim(),
    unstagedPatch: String(unstagedPatch).trim(),
    changedPaths: [...changedPaths],
    untracked: [...untrackedPaths],
  });
}

function readPullRequest({ gh, pullNumber, target }) {
  const value = JSON.parse(gh(["pr", "view", String(pullNumber), "--repo", target, "--json",
    "url,number,id,state,isDraft,isCrossRepository,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body"]));
  if (value.isCrossRepository) throw new Error("Recovery pull request must use the canonical repository.");
  return { url: value.url, number: value.number, nodeId: value.id, state: value.state,
    isDraft: value.isDraft, headRepository: value.headRepository.nameWithOwner,
    headRefName: value.headRefName, headRefOid: value.headRefOid,
    baseRepository: target, baseRefName: value.baseRefName, baseRefOid: value.baseRefOid,
    body: String(value.body || "") };
}

function projectPullRequest(value, marker) { const { body, ...identity } = value;
  return { ...identity, marker, markerDigest: digestValue(marker), bodyDigest: digestValue(body) }; }
function pullIdentity(value) { return { url: value.url, number: value.number,
  nodeId: value.nodeId, state: value.state, isDraft: value.isDraft,
  headRepository: value.headRepository, headRefName: value.headRefName,
  headRefOid: value.headRefOid, baseRepository: value.baseRepository,
  baseRefName: value.baseRefName, baseRefOid: value.baseRefOid }; }
function parseSingleMarker(body) {
  const matches = String(body).match(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu) || [];
  if (matches.length !== 1) throw new Error("Pull request must contain one writer marker.");
  const marker = parseWriterLeasePullRequestBody(matches[0]);
  if (!marker) throw new Error("Pull-request writer marker is malformed.");
  return marker;
}

function readLedger({ gh, ledgerRepository, revision }) {
  const bytes = gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
    `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`, "-f", `ref=${revision}`]);
  return parseValidatedRecoveryLedgerSnapshot(bytes);
}

export function requireRecoveryLedgerRepository({ ledgerRepository, authority } = {}) {
  const ledger = requiredRepository(ledgerRepository, "ledger repository");
  if (authority?.ledgerRepository !== ledger) {
    throw new Error("Recovery ledger repository does not match the leased cloud authority.");
  }
  return ledger;
}

export function parseValidatedRecoveryLedgerSnapshot(bytes) {
  const size = Buffer.byteLength(bytes);
  if (size < 1 || size > MAX_RECOVERY_LEDGER_BYTES) {
    throw new Error("Ledger snapshot exceeds recovery bounds.");
  }
  const ledger = JSON.parse(bytes), failures = validateLedger(ledger);
  if (failures.length) throw new Error(`Ledger snapshot is invalid: ${failures.join("; ")}`);
  return ledger;
}

function stableInventoryReader(adapter, target) { return async () => {
  const first = await adapter.execute("status", { targetRepository: target });
  const claims = await adapter.listClaims({ targetRepository: target });
  const second = await adapter.execute("status", { targetRepository: target });
  if (JSON.stringify(first) !== JSON.stringify(second)
    || JSON.stringify(first.claims) !== JSON.stringify(claims.map(projectPublicClaim))) throw new Error("Cloud inventory changed during stable read.");
  return { ...second, claims };
}; }
function exactClaim(claims, claimId) { const found = claims.filter(value => value.claimId === claimId);
  if (found.length !== 1) throw new Error("Cloud inventory lacks one exact recovery claim."); return found[0]; }

function assertPreserved(source, live) {
  for (const [label, left, right] of [
    ["controller", source.controller, live.controller],
    ["lane", source.lane, live.lane], ["lease", source.lease, live.lease],
    ["authority", source.currentAuthority, live.currentAuthority], ["claim", source.currentClaim, live.currentClaim],
    ["lineage", source.ledgerLineage, live.ledgerLineage], ["dirt", source.dirt, live.dirt],
  ]) if (digestValue(left) !== digestValue(right)) throw new Error(`Recovery changed preserved ${label}.`);
  if (digestValue(pullIdentity(source.pullRequest)) !== digestValue(pullIdentity(live.pullRequest)))
    throw new Error("Recovery changed preserved pull request identity.");
  if (source.scopeExpansionIntent.status === "successor-bound") {
    for (const field of ["boundAuthority", "boundReceiptDigest", "targetClaimDigest", "planSnapshot"])
      if (digestValue(source.scopeExpansionIntent[field]) !== digestValue(live.scopeExpansionIntent[field])) throw new Error(`Recovery changed historical ${field}.`);
  }
}

function readJournal(filePath) {
  if (!existsSync(filePath)) return null;
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (value.schema !== JOURNAL_SCHEMA || value.intentDigest !== digestValue(value.intent)) throw new Error("Recovery journal is malformed.");
  return value.intent;
}
function writeJournalCas(filePath, { expectedIntent = null, nextIntent } = {}, now) {
  return withLock(`${filePath}.lock`, { operation: "journal-cas" }, () => {
    if (nullableDigest(readJournal(filePath)) !== nullableDigest(expectedIntent)) throw new Error("Recovery journal changed before CAS.");
    writeJsonAtomic(filePath, { schema: JOURNAL_SCHEMA, intent: nextIntent,
      intentDigest: digestValue(nextIntent), updatedAt: now().toISOString() });
    return nextIntent;
  }, now);
}
export async function withActiveDirtyScopeExpansionIntentRecoveryLock(
  lockPath, subject, action, { now = () => new Date(), processAlive = processIsAlive } = {},
) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  let descriptor = createLock(lockPath, token, subject, now);
  if (descriptor === null) {
    const owner = readLock(lockPath);
    if (!owner) throw new Error("Recovery entrypoint lock is malformed.");
    if (processAlive(owner.pid)) throw new Error("Recovery is already fenced.");
    if (readLock(lockPath)?.token !== owner.token) throw new Error("Recovery entrypoint lock changed during stale-owner inspection.");
    const stalePath = `${lockPath}.stale.${token}`;
    renameSync(lockPath, stalePath);
    if (readLock(stalePath)?.token !== owner.token) {
      if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
      throw new Error("Recovery entrypoint lock changed during stale-owner recovery.");
    }
    descriptor = createLock(lockPath, token, subject, now);
    if (descriptor === null) {
      if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
      throw new Error("Recovery entrypoint lock was concurrently reacquired.");
    }
    unlinkSync(stalePath);
  }
  try { return await action(); } finally {
    closeSync(descriptor);
    if (readLock(lockPath)?.token === token) unlinkSync(lockPath);
  }
}
function withLock(lockPath, subject, action, now) {
  return withActiveDirtyScopeExpansionIntentRecoveryLock(lockPath, subject, action, { now });
}
function createLock(lockPath, token, subject, now) {
  let descriptor;
  try { descriptor = openSync(lockPath, "wx", 0o600); }
  catch (error) { if (error?.code === "EEXIST") return null; throw error; }
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token, subject,
    acquiredAt: now().toISOString() })}\n`);
  return descriptor;
}
function readLock(lockPath) { if (!existsSync(lockPath)) return null;
  try { const value = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string" ? value : null;
  } catch { return null; } }
function processIsAlive(pid) { try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true; throw error; } }
function writeJsonAtomic(filePath, value) { mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, filePath); }
function nullableDigest(value) { return value === null ? null : digestValue(value); }
function splitNul(value) { return String(value || "").split("\0").filter(Boolean); }
function subprocess(cwd, environment) { return { cwd, encoding: "utf8", env: environment,
  maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }; }
function requiredText(value, label) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function requiredRepository(value, label) { const result = requiredText(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} must be owner/name.`); return result; }
function repositoryFromOrigin(value) { const match = String(value).match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u); return match?.[1] || null; }
function positiveInteger(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be positive.`); return result; }
