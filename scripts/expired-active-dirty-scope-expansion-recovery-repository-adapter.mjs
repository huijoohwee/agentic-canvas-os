// Responsibility: project checkout-independent recovery evidence and apply three exact CAS effects.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import * as Contract from "./expired-active-dirty-scope-expansion-recovery-contract.mjs";
import * as Evidence from "./expired-active-dirty-scope-expansion-recovery-evidence.mjs";
import { createGitHubCloudCollaborationAdapter } from "./github-cloud-collaboration-adapter.mjs";
import { projectPublicClaim } from "./github-cloud-collaboration-mapping.mjs";
import { captureOwnedDirtEvidence, OWNED_DIRT_RECOVERY_SCHEMA, requireSameOwnedDirtEvidence } from "./owned-dirt-resume-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { casWriterLeaseProjection, readScopeExpansionIntent, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLOUD_SCRIPT = fileURLToPath(new URL("./cloud-collaboration.mjs", import.meta.url));
const JOURNAL_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-journal/v1";
const ATTEMPT_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-attempt/v1";
const WRITER_MARKER = /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u, SHA_PATTERN = /^[0-9a-f]{40}$/u;
const METHODS = Object.freeze(["withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent", "observeRecovery", "recoverCloud", "persistLocalAuthority", "persistPullRequestMarker"]);
const IMPLEMENTATION_FILES = Object.freeze(["contract", "controller", "evidence", "repository-adapter", ""].map(suffix => `expired-active-dirty-scope-expansion-recovery${suffix ? `-${suffix}` : ""}.mjs`));
const HYDRATED_OPTIONALS = Object.freeze([
  "eligibleSince", "handoff", "release", "recovery", "integration",
  "handoffEvidenceDigest", "promotedAt", "deliveryAuthorization", "retirement",
]);
export function createExpiredActiveDirtyScopeExpansionRecoveryAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
  for (const name of METHODS) if (typeof adapter[name] !== "function") throw new Error(`Expired active-dirty recovery adapter requires ${name}().`);
  return adapter;
}
export function createRepositoryExpiredActiveDirtyScopeExpansionRecoveryAdapter({
  sourceRepository, targetRepository, pullRequestNumber, claimId,
  ledgerRepository = "huijoohwee/agentic-canvas-os", statePath = null, ttlSeconds = 1_800,
  controllerRoot = CONTROLLER_ROOT, environment = process.env, execute = execFileSync,
  resolveRealpath = realpathSync, now = () => new Date(), leaseStore = null,
  cloudJson = null, cloudInventory = null, verifyCloudAuthority = verifyAdmissionCloudAuthority,
  assertMutationAuthority = assertAdmissionMutationAuthority,
} = {}) {
  const controller = resolveRealpath(path.resolve(controllerRoot));
  if (controller !== resolveRealpath(CONTROLLER_ROOT)) throw new Error("Recovery must execute from its exact protected controller root.");
  const sourceRoot = resolveRealpath(path.resolve(requiredText(sourceRepository, "source repository")));
  const target = requiredRepository(targetRepository, "target repository");
  const ledger = requiredRepository(ledgerRepository, "ledger repository");
  const pullNumber = positiveInteger(pullRequestNumber, "pull request number");
  const sourceClaimId = requiredDigest(claimId, "claim ID");
  const ttl = positiveInteger(ttlSeconds, "TTL seconds");
  const command = (program, argumentsList, cwd = sourceRoot) => execute(program, argumentsList, subprocess(cwd, environment));
  const git = (argumentsList, cwd = sourceRoot) => String(command("git", argumentsList, cwd));
  const gh = argumentsList => String(command("gh", argumentsList));
  const cloud = cloudJson || ((action, request) => invokeCloudJson({ action, request, ledgerRepository: ledger, execute, environment, cwd: controller }));
  const inventory = cloudInventory || createExpiredActiveDirtyScopeExpansionRecoveryStableInventoryReader(createGitHubCloudCollaborationAdapter({ ledgerRepository: ledger }), target);
  const commonDirectory = resolveRealpath(path.resolve(sourceRoot, git(["rev-parse", "--git-common-dir"]).trim()));
  if (statePath !== null) throw new Error("Custom expired active-dirty recovery journal paths are forbidden.");
  const journalDirectory = path.join(commonDirectory, "agentic-canvas-os", "expired-active-dirty-scope-expansion-recovery");
  const entrypointLock = path.join(journalDirectory, `${sourceClaimId}.entrypoint.lock`);
  const leases = leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, now });
  requireRegistryCas(leases);
  let activeStore = null;
  const storeFor = source => {
    const filePath = resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath({ commonDirectory, claimId: sourceClaimId, attemptDigest: recoveryAttemptDigest(source) });
    if (activeStore && activeStore.statePath !== filePath) throw new Error("Recovery journal attempt changed during one entrypoint.");
    activeStore ||= createExpiredActiveDirtyScopeExpansionRecoveryIntentStore({ statePath: filePath, pathGuard: () => assertSafeJournalPath(commonDirectory, filePath), now });
    return activeStore;
  };
  const readSnapshot = async (context = null, { includeController = false } = {}) => {
    const lane = readLane({ git, sourceRoot });
    const lease = requireLease(leases.read(lane.branch), lane, sourceRoot);
    const cloudStatus = requireCloudInventory(await inventory());
    const claim = requireExpiredActiveDirtyScopeExpansionRecoveryExactClaim(cloudStatus.claims, sourceClaimId);
    const pullRequest = readPullRequest({ gh, pullNumber, target });
    const sourceLease = context?.plan?.sourceEvidence?.lease || lease;
    const projectedPullRequest = projectPullRequest({ pullRequest, lease, sourceLease });
    const dirt = readDirt({ git });
    const cloudSnapshot = Object.freeze({ ...projectExpiredActiveDirtyScopeExpansionRecoveryCloud({ claim, inventory: cloudStatus, ledgerRepository: ledger }), authenticatedActor: readAuthenticatedActor({ gh, target }) });
    const snapshot = {
      lane, lease, leaseDigest: writerLeaseDigest(lease), cloud: cloudSnapshot, pullRequest: projectedPullRequest, dirt,
      scopeExpansionIntent: readScopeExpansionIntent({ leaseStore: leases, branch: lane.branch }),
      inventory: cloudStatus, mutationAuthority: await readMutationAuthority({ assertMutationAuthority, claim, cloudSnapshot, cloud, lease, lane, projectedPullRequest, sourceLease, target, verifyCloudAuthority, environment }),
    };
    if (includeController || context) snapshot.controller = readController({ controller, git, target });
    if (context && digestValue(snapshot.controller) !== digestValue(context.plan.sourceEvidence.controller)) throw new Error("Protected recovery controller changed from the exact plan.");
    return Object.freeze(snapshot);
  };
  const preserveDirt = async (context, action) => {
    const before = await readSnapshot(context);
    requirePlannedDirt(context.plan, before.dirt);
    const phase = evidenceFunction("buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation")({ ...context, live: before });
    if (phase.state !== "pending") return { operationKey: context.operationKey };
    const result = await action(before);
    requirePlannedDirt(context.plan, readDirt({ git }));
    return requireOperationResult(result, context);
  };
  const readRepositoryIntent = async () => {
    activeStore = null;
    const candidates = journalCandidates({ commonDirectory, journalDirectory, claimId: sourceClaimId, now });
    if (candidates.length === 0) return null;
    const matches = [], failures = [];
    for (const candidate of candidates) try {
      const intent = candidate.intent, phase = nextRecoveryPhase(intent.status);
      const context = { intent, phase, plan: intent.planSnapshot, operationKey: recoveryOperationKey(intent, phase) };
      evidenceFunction("buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation")({ ...context, live: await readSnapshot(context) });
      matches.push(candidate);
    } catch (error) { failures.push(error); }
    if (matches.length > 1) throw new Error("Multiple recovery journals match one live recovery attempt.");
    if (matches.length === 1) { activeStore = matches[0].store; return matches[0].intent; }
    try {
      const live = await readSnapshot(null, { includeController: true });
      evidenceFunction("buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence")(live);
      return null;
    } catch (error) { throw failures[0] || error; }
  };
  return createExpiredActiveDirtyScopeExpansionRecoveryAdapter({
    withEntrypointFence: (subject, action) => withJournalEntrypointFence({ action, commonDirectory, entrypointLock, journalDirectory, now, subject }),
    readIntent: readRepositoryIntent,
    writeIntent(input) {
      if (!activeStore) throw new Error("Recovery journal attempt was not selected before persistence.");
      return activeStore.writeIntent(input);
    },
    async readSourceEvidence() {
      const live = await readSnapshot(null, { includeController: true });
      const sourceEvidence = evidenceFunction("buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence")(live);
      storeFor(sourceEvidence);
      return Object.freeze({ sourceEvidence, ttlSeconds: ttl });
    },
    async observeRecovery(context) { return evidenceFunction("buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation")({ ...context, live: await readSnapshot(context) }); },
    recoverCloud: context => preserveDirt(context, async before => {
      const source = context.plan.sourceEvidence;
      const result = requireExpiredActiveDirtyScopeExpansionRecoveryCloudResult(await cloud("continue", {
        targetRepository: target, claimId: source.cloud.claim.claimId,
        deviceId: source.lease.device, sessionId: source.lease.sessionId,
        expectedFenceRevision: source.cloud.claim.claimDigest,
        expectedTransitionCounter: source.cloud.claim.transitionCounter,
        expectedLedgerDigest: source.cloud.ledgerDigest, mode: "recovery",
        ttlSeconds: context.plan.ttlSeconds, recoveryEvidenceDigest: context.operationKey,
        idempotencyKey: `expired-active-dirty-scope-expansion-recovery:${context.operationKey}`,
      }), { source });
      if (before.cloud.claim.claimId !== result.claim.claimId) throw new Error("Cloud recovery changed the exact claim identity.");
      return { operationKey: context.operationKey };
    }),
    persistLocalAuthority: context => preserveDirt(context, async before => {
      const authority = authorityFromLive({ before, context, ledger, target });
      const manifest = manifestFromLease(context.plan.sourceEvidence.lease);
      const verified = await verifyCloudAuthority({ authority, manifest, canonicalBaseSha: authority.canonicalBaseSha, environment, inspect: ({ action, request }) => cloud(action, request) });
      const values = { cloudAuthority: verified.authority, heartbeatAt: verified.verification.verifiedAt, expiresAt: verified.authority.expiresAt };
      assertMutationAuthority({ lease: { ...before.lease, ...values }, cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification });
      const updated = casWriterLeaseProjection({
        leaseStore: leases, branch: before.lane.branch,
        expectedLeaseDigest: context.plan.sourceEvidence.leaseDigest,
        expectedClaimId: context.plan.sourceEvidence.cloud.claim.claimId,
        requireNoActiveIntent: true, values,
      }).lease;
      assertMutationAuthority({ lease: updated, cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification });
      return { operationKey: context.operationKey };
    }),
    persistPullRequestMarker: context => preserveDirt(context, async before => {
      const expectedDigest = writerLeaseDigest(before.lease);
      if (before.pullRequest.markerLeaseDigest === expectedDigest) return { operationKey: context.operationKey };
      const intendedBody = replaceWriterMarkerExact(before.pullRequest.body, before.lease);
      withExactLeaseRegistry(leases, before.lane.branch, expectedDigest,
        before.cloud.claim.claimId, () => {
          assertExactPullRequestSnapshot(before.pullRequest, readPullRequest({ gh, pullNumber, target }));
          return command("gh", ["pr", "edit", before.pullRequest.url, "--body", intendedBody]);
        });
      const verified = readPullRequest({ gh, pullNumber, target });
      assertExactPullRequestMarkerUpdate({ before: before.pullRequest, verified, intendedBody, lease: before.lease, expectedDigest });
      return { operationKey: context.operationKey };
    }),
  });
}
export function createExpiredActiveDirtyScopeExpansionRecoveryIntentStore({ statePath, pathGuard = () => {}, now = () => new Date() } = {}) {
  const filePath = path.resolve(requiredText(statePath, "intent state path")), intentLock = `${filePath}.lock`, entrypointLock = `${filePath}.entrypoint.lock`;
  function readIntent() {
    pathGuard();
    if (!existsSync(filePath)) return null;
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    if (value?.schema !== JOURNAL_SCHEMA || value.intentDigest !== digestValue(value.intent)) throw new Error("Expired active-dirty recovery journal is malformed or digest-invalid.");
    return value.intent;
  }
  function writeIntent({ expectedIntent = null, nextIntent } = {}) {
    return withLock(intentLock, { operation: "intent-cas" }, () => {
      if (nullableDigest(readIntent()) !== nullableDigest(expectedIntent)) throw new Error("Expired active-dirty recovery intent changed before CAS.");
      if (!nextIntent || typeof nextIntent !== "object" || Array.isArray(nextIntent)) throw new Error("Expired active-dirty recovery next intent is required.");
      pathGuard();
      writeJsonAtomic(filePath, { schema: JOURNAL_SCHEMA, intent: nextIntent, intentDigest: digestValue(nextIntent), updatedAt: now().toISOString() });
      return nextIntent;
    });
  }
  async function withEntrypointFence(subject, action) {
    if (typeof action !== "function") throw new Error("Recovery entrypoint fence requires an action.");
    pathGuard();
    const release = acquireLock(entrypointLock, subject);
    try { return await action(Object.freeze({ acquiredAt: now().toISOString(), fenceDigest: digestValue({ filePath, subject }) })); } finally { release(); }
  }
  return Object.freeze({ readIntent, statePath: filePath, withEntrypointFence, writeIntent });
}
export function resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath({ commonDirectory, claimId, attemptDigest, statePath = null } = {}) {
  if (statePath !== null) throw new Error("Custom expired active-dirty recovery journal paths are forbidden.");
  const root = path.resolve(requiredText(commonDirectory, "Git common directory"));
  const filePath = path.join(root, "agentic-canvas-os", "expired-active-dirty-scope-expansion-recovery", `${requiredDigest(claimId, "claim ID")}.${requiredDigest(attemptDigest, "recovery attempt digest")}.json`);
  assertSafeJournalPath(root, filePath); return filePath;
}
function journalCandidates({ commonDirectory, journalDirectory, claimId, now }) {
  assertSafeJournalDirectory(commonDirectory, journalDirectory);
  if (!existsSync(journalDirectory)) return [];
  const pattern = new RegExp(`^${claimId}\\.[0-9a-f]{64}\\.json$`, "u");
  return readdirSync(journalDirectory).filter(name => pattern.test(name)).map(name => {
    const filePath = path.join(journalDirectory, name);
    const store = createExpiredActiveDirtyScopeExpansionRecoveryIntentStore({ statePath: filePath, pathGuard: () => assertSafeJournalPath(commonDirectory, filePath), now });
    const intent = normalizeRecoveryIntent(store.readIntent());
    const expected = resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath({ commonDirectory, claimId, attemptDigest: recoveryAttemptDigest(intent.planSnapshot.sourceEvidence) });
    if (filePath !== expected) throw new Error("Recovery journal filename does not match its sealed attempt.");
    return Object.freeze({ intent, store });
  });
}
function recoveryAttemptDigest(source) { return digestValue({
  schema: ATTEMPT_SCHEMA, targetRepository: source.controller.targetRepository,
  ledgerRepository: source.cloud.ledgerRepository, claimId: source.cloud.claim.claimId,
  claimDigest: source.cloud.claim.claimDigest, transitionCounter: source.cloud.claim.transitionCounter,
  sourceEvidenceDigest: source.sourceEvidenceDigest,
}); }
function nextRecoveryPhase(status) {
  const phases = ["authorized", ...Contract.EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES];
  const index = phases.indexOf(status);
  if (index < 0) throw new Error("Recovery journal status is unsupported.");
  return status === "complete" ? "complete" : phases[index + 1];
}
function recoveryOperationKey(intent, phase) { return Contract.expiredActiveDirtyScopeExpansionRecoveryOperationKey(intent.planDigest, intent.authorizationDigest, phase); }
function normalizeRecoveryIntent(value) { return Contract.normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(value); }
async function withJournalEntrypointFence({ action, commonDirectory, entrypointLock, journalDirectory, now, subject }) {
  if (typeof action !== "function") throw new Error("Recovery entrypoint fence requires an action.");
  assertSafeJournalDirectory(commonDirectory, journalDirectory);
  const release = acquireLock(entrypointLock, subject);
  try { return await action(Object.freeze({ acquiredAt: now().toISOString(), fenceDigest: digestValue({ entrypointLock, subject }) })); } finally { release(); }
}
function assertSafeJournalDirectory(root, directory) { assertSafeJournalPath(root, path.join(directory, ".directory-guard")); }
function assertSafeJournalPath(root, filePath) {
  let current = root;
  for (const segment of path.relative(root, filePath).split(path.sep)) {
    current = path.join(current, segment); if (!existsSync(current)) break;
    const status = lstatSync(current), target = current === filePath;
    if (status.isSymbolicLink() || (target ? !status.isFile() : !status.isDirectory())) throw new Error("Recovery journal path is not one dedicated regular-file target.");
  }
  if (!existsSync(filePath)) return; let value;
  try { value = JSON.parse(readFileSync(filePath, "utf8")); } catch { throw new Error("Existing recovery journal target is not a valid journal."); }
  if (value?.schema !== JOURNAL_SCHEMA || value.intentDigest !== digestValue(value.intent)) throw new Error("Existing recovery journal target is not a valid journal.");
}
export function invokeExpiredActiveDirtyScopeExpansionRecoveryCloudJson({ action, request, ledgerRepository, execute = execFileSync, environment = process.env, cwd = CONTROLLER_ROOT } = {}) {
  return invokeCloudJson({ action, request, ledgerRepository, execute, environment, cwd }); }
function readController({ controller, git, target }) {
  const origin = git(["config", "--get", "remote.origin.url"], controller).trim();
  if (repositoryFromOrigin(origin) !== target) throw new Error("Protected controller origin does not match the target repository.");
  const headSha = requiredSha(git(["rev-parse", "HEAD"], controller).trim(), "controller HEAD");
  return Object.freeze({
    path: controller, origin, targetRepository: target, headSha,
    originMainSha: requiredSha(git(["rev-parse", "origin/main"], controller).trim(), "controller origin/main"),
    remoteMainSha: remoteSha(git, controller, "main"),
    treeSha: requiredSha(git(["rev-parse", "HEAD^{tree}"], controller).trim(), "controller tree"),
    clean: git(["status", "--porcelain=v1", "--untracked-files=all"], controller) === "",
    implementationDigest: implementationDigest(controller),
  });
}
function readLane({ git, sourceRoot }) {
  const branch = requiredText(git(["branch", "--show-current"]).trim(), "source branch");
  const headSha = requiredSha(git(["rev-parse", "HEAD"]).trim(), "source HEAD");
  const treeSha = requiredSha(git(["rev-parse", "HEAD^{tree}"]).trim(), "source tree");
  const parentSha = requiredSha(git(["rev-parse", "HEAD^"]).trim(), "source parent");
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), index = git(["ls-files", "--stage", "-z"]), worktrees = git(["worktree", "list", "--porcelain", "-z"]);
  const registered = worktrees.includes(`worktree ${sourceRoot}\0`) && worktrees.includes(`branch refs/heads/${branch}\0`);
  const projection = {
    path: sourceRoot, branch, headSha, treeSha, parentSha,
    parentTreeSha: requiredSha(git(["rev-parse", "HEAD^^{tree}"]).trim(), "source parent tree"),
    parentCount: git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/u).length - 1,
    remoteHeadSha: remoteSha(git, sourceRoot, branch), detached: false,
    dirty: status !== "", invalid: !registered,
    indexDigest: digestValue(index), workingTreeDigest: digestValue(status),
  };
  return Object.freeze({ ...projection, stateDigest: digestValue(projection) });
}
function readDirt({ git }) {
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), index = git(["ls-files", "--stage", "-z"]);
  const unstaged = git(["diff", "--binary", "--no-ext-diff", "--no-textconv", "--"]), staged = git(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--"]);
  const unstagedPaths = splitNul(git(["diff", "--name-only", "-z", "--"])), stagedPaths = splitNul(git(["diff", "--cached", "--name-only", "-z", "--"]));
  const untrackedPaths = splitNul(git(["ls-files", "--others", "--exclude-standard", "-z"]));
  const changedPaths = [...new Set([...unstagedPaths, ...stagedPaths])].sort();
  const worktreeObjects = changedPaths.map(file => ({ path: file, objectId: git(["hash-object", "--no-filters", "--", file]).trim() || null }));
  const owned = captureOwnedDirtEvidence({ gitText: git, gitOptional: argumentsList => { try { return git(argumentsList); } catch { return ""; } } });
  return Object.freeze({
    statusDigest: digestValue(status), indexDigest: digestValue(index),
    unstagedDiffDigest: digestValue(unstaged), stagedDiffDigest: digestValue(staged),
    worktreeObjectsDigest: digestValue(worktreeObjects), changedPaths, untrackedPaths,
    ownedDirtDigest: owned.digest, pathCount: owned.pathCount,
  });
}
export function projectExpiredActiveDirtyScopeExpansionRecoveryCloud({ claim, inventory, ledgerRepository }) {
  const projected = projectClaim(claim);
  const peers = inventory.claims.filter(item => item.claimId !== claim.claimId).map(projectPeer);
  return Object.freeze({ claim: projected, ledgerRepository: requiredRepository(ledgerRepository, "cloud ledger repository"), ledgerRevision: inventory.ledgerRevision, ledgerDigest: inventory.ledgerDigest, sequence: inventory.sequence, peers });
}
function projectClaim(claim) { return Object.freeze({ ...claim, claimDigest: claim.fenceRevision,
  transitionDigest: claim.ledgerRevision }); }
function projectPeer(claim) {
  const record = { ...claim, claimDigest: claim.fenceRevision,
    transitionDigest: claim.ledgerRevision };
  for (const field of HYDRATED_OPTIONALS) if (!Object.hasOwn(record, field)) record[field] = null;
  return Object.freeze({ ...record, recordDigest: digestValue(record) });
}
function readPullRequest({ gh, pullNumber, target }) {
  const value = JSON.parse(gh(["pr", "view", String(pullNumber), "--repo", target, "--json",
    "url,number,id,state,isDraft,isCrossRepository,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body"]));
  if (value.isCrossRepository !== false) throw new Error("Recovery pull request must not be cross-repository.");
  return Object.freeze({ url: value.url, number: value.number, nodeId: value.id, state: value.state,
    isDraft: value.isDraft, headRepository: repositoryValue(value.headRepository),
    headRefName: value.headRefName, headRefOid: value.headRefOid,
    baseRepository: target, baseRefName: value.baseRefName,
    baseRefOid: value.baseRefOid, body: String(value.body || "") });
}
function projectPullRequest({ pullRequest, lease, sourceLease }) {
  if (pullRequest.headRepository !== pullRequest.baseRepository) throw new Error("Recovery pull request must use the canonical repository head.");
  const marker = oneWriterMarker(pullRequest.body);
  let markerLeaseDigest;
  if (digestValue(marker) === digestValue(projectWriterLeasePullRequestMarker(lease))) markerLeaseDigest = writerLeaseDigest(lease);
  else if (digestValue(marker) === digestValue(projectWriterLeasePullRequestMarker(sourceLease))) markerLeaseDigest = writerLeaseDigest(sourceLease);
  else throw new Error("Pull-request writer marker drifted from the source or rebound lease.");
  return Object.freeze({ ...pullRequest, marker, markerLeaseDigest, bodyFrameDigest: bodyFrameDigest(pullRequest.body) });
}
async function readMutationAuthority({ assertMutationAuthority, claim, cloudSnapshot, cloud,
  lease, lane, projectedPullRequest, sourceLease, target, verifyCloudAuthority, environment }) {
  const markerCurrent = projectedPullRequest.markerLeaseDigest === writerLeaseDigest(lease);
  const cloudCurrent = claim.state === "current" && lease.cloudAuthority?.claimDigest === claim.fenceRevision
    && lease.cloudAuthority?.transitionCounter === claim.transitionCounter;
  if (!markerCurrent || !cloudCurrent || writerLeaseDigest(lease) === writerLeaseDigest(sourceLease)) return null;
  const manifest = manifestFromLease(lease);
  const authority = authorityFromStatus({ claim, cloudSnapshot, lease, target });
  const verified = await verifyCloudAuthority({ authority, manifest, canonicalBaseSha: authority.canonicalBaseSha, environment, inspect: ({ action, request }) => cloud(action, request) });
  return assertMutationAuthority({ lease, cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification });
}
function authorityFromLive({ before, context, ledger, target }) {
  const source = context.plan.sourceEvidence;
  if (source.cloud.ledgerRepository !== ledger || source.lease.cloudAuthority?.ledgerRepository !== ledger) throw new Error("Recovery ledger repository changed from the exact plan.");
  return normalizeBoundAuthority({
    result: resultFromStatus(before.cloud), authority: {
      ...source.lease.cloudAuthority, ledgerRepository: ledger, targetRepository: target,
    }, manifest: manifestFromLease(source.lease), deviceId: source.lease.device,
    sessionId: source.lease.sessionId,
  });
}
function authorityFromStatus({ claim, cloudSnapshot, lease, target }) {
  return normalizeBoundAuthority({
    result: resultFromStatus(cloudSnapshot), authority: {
      ...lease.cloudAuthority, targetRepository: target,
    }, manifest: manifestFromLease(lease), deviceId: lease.device, sessionId: lease.sessionId,
  });
}
function resultFromStatus(cloud) {
  return {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
    status: "current", ledgerRevision: cloud.ledgerRevision, ledgerDigest: cloud.ledgerDigest,
    claim: cloud.claim, claimDigest: cloud.claim.claimDigest, findings: [],
  };
}
function manifestFromLease(lease) {
  return Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    declaredWriteSet: lease.admission.declaredWriteSet,
    writeSetDigest: lease.admission.writeSetDigest,
    manifestDigest: lease.admission.manifestDigest,
  });
}
function requirePlannedDirt(plan, dirt) {
  const source = plan?.sourceEvidence?.dirt;
  if (!source || source.ownedDirtDigest !== dirt.ownedDirtDigest
    || source.pathCount !== dirt.pathCount) {
    throw new Error("Owned dirt changed from the exact recovery plan.");
  }
  requireSameOwnedDirtEvidence({
    schema: OWNED_DIRT_RECOVERY_SCHEMA, sourceEpoch: plan.sourceEvidence.lease.epoch,
    sourceSessionId: plan.sourceEvidence.lease.sessionId,
    reviewHeadSha: plan.sourceEvidence.lease.fenceSha,
    evidenceDigest: source.ownedDirtDigest, pathCount: source.pathCount,
  }, { digest: dirt.ownedDirtDigest, pathCount: dirt.pathCount });
}
function withExactLeaseRegistry(store, branch, leaseDigest, claimId, action) {
  return store.withRegistryLock(registry => {
    const lease = registry?.leases?.[branch];
    if (!lease || writerLeaseDigest(lease) !== leaseDigest
      || lease.cloudAuthority?.claimId !== claimId) {
      throw new Error("Writer lease changed before pull-request marker CAS.");
    }
    return action();
  });
}
function markerDigestForLease(body, lease) {
  const marker = oneWriterMarker(body);
  if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Pull-request marker does not match the exact writer lease.");
  }
  return writerLeaseDigest(lease);
}
export function replaceExpiredActiveDirtyScopeExpansionRecoveryPullRequestMarker(body, lease) {
  const source = String(body), matches = [...source.matchAll(WRITER_MARKER)];
  if (matches.length !== 1) throw new Error("Pull request must contain one exact writer lease marker.");
  const marker = `<!-- agentic-writer-lease/v2 ${JSON.stringify(projectWriterLeasePullRequestMarker(lease))} -->`;
  return `${source.slice(0, matches[0].index)}${marker}${source.slice(matches[0].index + matches[0][0].length)}`;
}
function replaceWriterMarkerExact(body, lease) { return replaceExpiredActiveDirtyScopeExpansionRecoveryPullRequestMarker(body, lease); }
export function assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestUpdate(input = {}) {
  return assertExactPullRequestMarkerUpdate(input); }
function assertExactPullRequestMarkerUpdate({ before, verified, intendedBody, lease, expectedDigest }) {
  if (digestValue(pullRequestIdentity(verified)) !== digestValue(pullRequestIdentity(before))
    || verified.body !== intendedBody || bodyFrameDigest(verified.body) !== before.bodyFrameDigest
    || markerDigestForLease(verified.body, lease) !== expectedDigest) {
    throw new Error("Pull-request marker CAS did not preserve the exact body and lease.");
  }
}
function pullRequestIdentity(value) { return { number: value.number, nodeId: value.nodeId,
  url: value.url, state: value.state, isDraft: value.isDraft, headRepository: value.headRepository,
  headRefName: value.headRefName, headRefOid: value.headRefOid, baseRepository: value.baseRepository,
  baseRefName: value.baseRefName, baseRefOid: value.baseRefOid }; }
export function assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestSnapshot(expected, observed) {
  return assertExactPullRequestSnapshot(expected, observed); }
function assertExactPullRequestSnapshot(expected, observed) {
  if (digestValue({ identity: pullRequestIdentity(expected), body: expected.body })
    !== digestValue({ identity: pullRequestIdentity(observed), body: observed.body })) throw new Error("Pull request changed before marker CAS.");
}
function oneWriterMarker(body) {
  const matches = [...String(body).matchAll(WRITER_MARKER)];
  if (matches.length !== 1) throw new Error("Pull request must contain one exact writer lease marker.");
  const marker = parseWriterLeasePullRequestBody(matches[0][0]);
  if (!marker) throw new Error("Pull-request writer lease marker is malformed.");
  return marker;
}
function bodyFrameDigest(body) { WRITER_MARKER.lastIndex = 0;
  return digestValue(String(body).replace(WRITER_MARKER, "<!-- agentic-writer-lease/v2 [marker] -->")); }
function readAuthenticatedActor({ gh, target }) {
  const user = JSON.parse(gh(["api", "user"]));
  const login = requiredText(user.login, "authenticated GitHub login");
  const actorId = `github-user:${positiveInteger(user.id, "authenticated GitHub actor ID")}`;
  if (target.split("/")[0].toLowerCase() !== login.toLowerCase()) {
    throw new Error("Authenticated GitHub actor does not own the target repository namespace.");
  }
  return Object.freeze({ actorId, login });
}
export function requireExpiredActiveDirtyScopeExpansionRecoveryCloudResult(result, { source }) {
  const claim = result?.claim;
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "continue" || claim?.claimId !== source.cloud.claim.claimId
    || result.status !== "current" || claim.state !== "current"
    || claim.transitionCounter !== source.cloud.claim.transitionCounter + 1
    || claim.heartbeatCounter !== source.cloud.claim.heartbeatCounter
    || claim.actorId !== source.cloud.claim.actorId
    || claim.repositoryId !== source.cloud.claim.repositoryId
    || claim.workItemId !== source.cloud.claim.workItemId
    || result.claimDigest !== claim.fenceRevision || !DIGEST_PATTERN.test(claim.fenceRevision || "")
    || !SHA_PATTERN.test(result.ledgerRevision || "") || !validCloudResultReceipt(result)) {
    throw new Error("Cloud recovery subprocess returned a drifted result.");
  }
  return result;
}
function validCloudResultReceipt(result) { const { receiptDigest, ...receipt } = result?.receipt || {};
  return receipt.schema === "agentic-cloud-collaboration-github-receipt/v1" && receipt.action === "continue" && receipt.ledgerRevision === result.ledgerRevision && receipt.claimId === result.claim.claimId && receipt.claimDigest === result.claim.fenceRevision && DIGEST_PATTERN.test(receipt.ledgerDigest || "") && receipt.contractReceiptDigest === result.operationReceipt?.receiptDigest && receiptDigest === digestValue(receipt); }
function invokeCloudJson({ action, request, ledgerRepository, execute, environment, cwd }) {
  const childEnvironment = { ...environment };
  delete childEnvironment.NODE_OPTIONS;
  delete childEnvironment.NODE_PATH;
  let stdout;
  try {
    stdout = execute(process.execPath, [CLOUD_SCRIPT, requiredText(action, "cloud action"),
      `--ledger-repository=${requiredRepository(ledgerRepository, "ledger repository")}`,
      `--request-json=${JSON.stringify(request)}`, "--json"],
    subprocess(cwd, childEnvironment));
  } catch (error) {
    const result = parseJsonResult(error?.stdout);
    throw new Error(`Cloud collaboration ${action} failed: ${publicMessage(result?.error?.message || error?.stderr || error)}`);
  }
  const result = parseJsonResult(stdout);
  if (!result || result.schema !== "agentic-cloud-collaboration-result/v1") {
    throw new Error("Cloud collaboration subprocess returned no valid JSON result.");
  }
  return result;
}
function parseJsonResult(value) {
  const line = String(value || "").trim().split(/\r?\n/u).reverse().find(item => item.startsWith("{"));
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}
export function createExpiredActiveDirtyScopeExpansionRecoveryStableInventoryReader(adapter, targetRepository) { return async () => {
  const first = await adapter.execute("status", { targetRepository });
  const claims = await adapter.listClaims({ targetRepository });
  const second = await adapter.execute("status", { targetRepository });
  const publicClaims = claims.map(projectPublicClaim);
  if (JSON.stringify(first) !== JSON.stringify(second)
    || JSON.stringify(first.claims) !== JSON.stringify(publicClaims))
    throw new Error("Cloud inventory changed across its hydrated stable read.");
  return { ...second, claims };
}; }
function requireCloudInventory(result) {
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "status" || result.status !== "ready" || !Array.isArray(result.claims)) throw new Error("Cloud status did not return a complete claim inventory.");
  requiredSha(result.ledgerRevision, "cloud ledger revision");
  requiredDigest(result.ledgerDigest, "cloud ledger digest");
  positiveInteger(result.sequence, "cloud ledger sequence");
  return result;
}
export function requireExpiredActiveDirtyScopeExpansionRecoveryExactClaim(claims, claimId) {
  const matches = claims.filter(claim => claim?.claimId === claimId);
  if (matches.length !== 1) throw new Error("Cloud inventory did not contain one exact recovery claim.");
  return matches[0]; }
function requireLease(lease, lane, sourceRoot) {
  if (!lease || lease.branch !== lane.branch || path.resolve(lease.worktreePath) !== sourceRoot) throw new Error("Recovery source is not the exact locally leased worktree.");
  return lease; }
function requireRegistryCas(store) {
  if (typeof store?.withRegistryLock !== "function" || !store.statePath) throw new Error("Recovery requires the full writer-lease registry CAS capability."); }
function requireOperationResult(value, context) {
  if (!value || value.operationKey !== context.operationKey) throw new Error(`Recovery ${context.phase} effect changed its operation key.`);
  return Object.freeze({ operationKey: context.operationKey }); }
function implementationDigest(controller) {
  return digestValue(IMPLEMENTATION_FILES.map(name => {
    const bytes = readFileSync(path.join(controller, "scripts", name));
    return { name, digest: createHash("sha256").update(bytes).digest("hex") };
  }));
}
function remoteSha(git, cwd, branch) {
  const line = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], cwd).trim();
  return requiredSha(line.split(/\s+/u)[0], `remote ${branch} SHA`);
}
function repositoryFromOrigin(value) { const match = String(value).match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  return match?.[1] || null; }
function repositoryValue(value) { return requiredRepository(value?.nameWithOwner || value?.name || value, "pull-request repository"); }
function withLock(lockPath, subject, action) { const release = acquireLock(lockPath, subject);
  try { return action(); } finally { release(); } }
function acquireLock(lockPath, subject) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  try { return createOwnedLock(lockPath, subject, token); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const owner = readLockOwner(lockPath);
  if (!owner) throw new Error("Expired active-dirty recovery lock is malformed.");
  if (processIsAlive(owner.pid)) throw new Error("Expired active-dirty recovery is already fenced.");
  if (readLockOwner(lockPath)?.token !== owner.token) throw new Error("Recovery lock changed during recovery.");
  const stalePath = `${lockPath}.stale.${token}`;
  renameSync(lockPath, stalePath);
  if (readLockOwner(stalePath)?.token !== owner.token) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    throw new Error("Recovery lock changed during recovery.");
  }
  const release = createOwnedLock(lockPath, subject, token);
  unlinkSync(stalePath);
  return release;
}
function createOwnedLock(lockPath, subject, token) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, subject, token })}\n`);
  return () => { closeSync(descriptor);
    if (readLockOwner(lockPath)?.token === token) unlinkSync(lockPath); };
}
function readLockOwner(lockPath) {
  if (!existsSync(lockPath)) return null;
  try { const value = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string" ? value : null; } catch { return null; }
}
function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true; throw error; }
}
function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, filePath); }
function nullableDigest(value) { return value === null ? null : digestValue(value); }
function splitNul(value) { return String(value || "").split("\0").filter(Boolean); }
function evidenceFunction(name) { const value = Evidence[name];
  if (typeof value !== "function") throw new Error(`Recovery evidence requires ${name}().`); return value; }
function subprocess(cwd, environment) {
  return { cwd, encoding: "utf8", env: environment, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 };
}
function publicMessage(value) { return String(value || "blocked")
  .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 500); }
function requiredRepository(value, label) {
  const result = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} must be owner/name.`);
  return result;
}
function requiredText(value, label) { const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`); return result; }
function requiredSha(value, label) { const result = requiredText(value, label);
  if (!SHA_PATTERN.test(result)) throw new Error(`${label} must be a 40-character SHA.`); return result; }
function requiredDigest(value, label) { const result = requiredText(value, label);
  if (!DIGEST_PATTERN.test(result)) throw new Error(`${label} must be a SHA-256 digest.`); return result; }
function positiveInteger(value, label) { const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer.`); return result; }
