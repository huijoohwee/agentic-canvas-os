// Responsibility: Bind rehydration to exact local Git, provider, cloud, and registry observations.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { deriveTaskWorktreeContainers, cleanupEmptyTaskWorktreeContainers } from "./task-worktree-owned-containers.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import {
  createWriterLeaseStore, parseDeviceBranch, parseWriterLeasePullRequestBody,
  WRITER_LEASE_REGISTRY_SCHEMA, WRITER_LEASE_SCHEMA,
} from "./writer-lease-lib.mjs";
import {
  buildOpenReviewedLaneRehydrationPlan,
  createOpenReviewedLaneRehydrationIntent,
  EVIDENCE_SCHEMA,
  normalizeOpenReviewedLaneRehydrationIntent,
} from "./open-reviewed-lane-rehydration-contract.mjs";

const ZERO_SHA = "0".repeat(40);
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;

export function createRepositoryOpenReviewedLaneRehydrationAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const targetPath = path.resolve(required(options.targetPath, "target path"));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(
    command, args, { cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], ...settings },
  ));
  const gitRaw = dependencies.gitRaw || (args => execute("git", args));
  const git = dependencies.git || (args => String(gitRaw(args)).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const commonDir = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDir });
  const registryWriter = dependencies.registryWriter || writeRegistryAtomic;
  const journalDir = path.join(commonDir, "agentic-canvas-os", "open-reviewed-lane-rehydration");
  let currentBody = null;

  function providerSubject() {
    const query = [
      "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){id nameWithOwner pullRequest(number:$number){",
      "id url number state isDraft body headRefName headRefOid baseRefName baseRefOid author{login}",
      "headRepository{nameWithOwner} baseRepository{nameWithOwner} mergeQueueEntry{id}",
      "autoMergeRequest{mergeMethod commitHeadline commitBody enabledAt enabledBy{login}}}}viewer{login databaseId}}",
    ].join(" ");
    const identity = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner,id"]));
    if (!identity?.nameWithOwner || !identity?.id || !identity.nameWithOwner.includes("/")) fail("repository identity");
    const [owner, name] = identity.nameWithOwner.split("/");
    const response = JSON.parse(gh(["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`,
      "-f", `name=${name}`, "-F", `number=${pullRequestNumber}`]));
    const repo = response?.data?.repository, pull = repo?.pullRequest, viewer = response?.data?.viewer;
    if (!pull || !repo || !viewer || repo.nameWithOwner !== identity.nameWithOwner || repo.id !== identity.id
      || pull.mergeQueueEntry !== null) fail("provider subject");
    return { repository: { nameWithOwner: repo.nameWithOwner, nodeId: repo.id,
      claimRepositoryId: `github-repository:${repo.id}` },
      actor: { id: String(viewer.databaseId), login: viewer.login,
        claimActorId: `github-user:${viewer.databaseId}` }, pull };
  }

  function capture(phase = "prepared", lockedRegistry = null, plannedProjection = null) {
    const provider = providerSubject(), pull = provider.pull;
    const markerSource = parseWriterLeasePullRequestBody(pull.body);
    if (!markerSource) fail("pull-request writer marker");
    const branch = markerSource.branch;
    if (!parseDeviceBranch(branch)) fail("agent branch identity");
    const authority = markerSource.cloudAuthority;
    const ledgerRepository = repositoryIdentity(authority?.ledgerRepository, "ledger repository identity");
    const targetRepository = repositoryIdentity(authority?.targetRepository, "target repository identity");
    if (targetRepository !== provider.repository.nameWithOwner) fail("cloud target repository identity");
    const status = cloud({ action: "status", ledgerRepository,
      request: { targetRepository }, environment });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true
      || status.action !== "status" || !Array.isArray(status.claims)) fail("cloud status");
    const claims = status.claims.filter(item => item?.claimId === authority?.claimId);
    if (claims.length !== 1) fail("claim cardinality");
    const claim = claims[0];
    const competing = status.claims.filter(item => item !== claim && (
      item?.reviewRequestId === claim.reviewRequestId || overlaps(item?.declaredWriteScope, claim.declaredWriteScope)
    ));
    if (competing.length) fail("competing cloud claim");

    const remoteHeadSha = remoteSha(`refs/heads/${branch}`, "remote branch");
    const currentMainSha = remoteSha("refs/heads/main", "remote main");
    const headSha = git(["rev-parse", "HEAD"]);
    const registryRaw = gitRaw(["worktree", "list", "--porcelain", "-z"]);
    const records = parseWorktreeRecords(registryRaw);
    const canonical = records.filter(item => samePath(item.path, repository));
    if (canonical.length !== 1 || canonical[0].branch !== "refs/heads/main" || headSha !== currentMainSha
      || git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("canonical main");
    requireGit(["rev-parse", `${remoteHeadSha}^{commit}`]);
    requireGit(["merge-base", "--is-ancestor", pull.baseRefOid, currentMainSha]);
    requireGit(["merge-base", "--is-ancestor", claim.canonicalBaseRevision, pull.baseRefOid]);
    requireGit(["merge-base", "--is-ancestor", markerSource.fenceSha, markerSource.reviewHeadSha]);
    const refresh = verifyProtectedMainRefreshChain({ expectedHeadSha: markerSource.reviewHeadSha,
      observedHeadSha: pull.headRefOid, gitText: git, mainRef: currentMainSha });

    const ownership = deriveTaskWorktreeContainers({ repoRoot: repository, gitCommonDir: commonDir, targetPath });
    requireTarget(ownership, { allowTarget: phaseIndex(phase) >= phaseIndex("worktree-created") });
    const effects = inspectLocalEffects({ phase, branch, headSha: remoteHeadSha, records, markerSource,
      pullUrl: pull.url, lockedRegistry, plannedProjection });
    const registrationDigest = digestValue(registrationProjection(records, branch, false));
    const observationDigest = digestValue({ targetPath, managedRoot: ownership.managedContainer.root,
      sharedRoot: ownership.sharedContainer.root, registrationDigest, absentBefore: true });
    currentBody = pull.body;
    return {
      schema: EVIDENCE_SCHEMA,
      repository: provider.repository,
      actor: provider.actor,
      canonical: { repoRoot: repository, gitCommonDir: commonDir, headSha, currentMainSha,
        currentMainTreeSha: git(["rev-parse", `${currentMainSha}^{tree}`]), registrationDigest,
        leaseProjectionDigest: effects.leaseProjectionDigest, clean: true },
      target: { path: targetPath, managedRoot: ownership.managedContainer.root,
        sharedRoot: ownership.sharedContainer.root, observationDigest },
      branch,
      remoteHeadSha,
      pullRequest: { number: pull.number, nodeId: pull.id, url: pull.url, state: pull.state,
        isDraft: pull.isDraft, headBranch: pull.headRefName, headSha: pull.headRefOid,
        baseBranch: pull.baseRefName, baseSha: pull.baseRefOid,
        headRepository: pull.headRepository?.nameWithOwner, baseRepository: pull.baseRepository?.nameWithOwner,
        authorLogin: pull.author?.login, reviewRequestId: `github-pull-request:${pull.id}`,
        autoMergeRequest: pull.autoMergeRequest, mergeQueueEntry: pull.mergeQueueEntry,
        bodyDigest: digestValue(pull.body), markerDigest: digestValue(markerSource) },
      marker: markerProjection(markerSource),
      claim,
      refresh,
      localProjection: effects.localProjection,
    };
  }

  function inspectLocalEffects({ phase, branch, headSha, records, markerSource, pullUrl, lockedRegistry, plannedProjection }) {
    const worktreeExpected = phaseIndex(phase) >= phaseIndex("worktree-created");
    const ref = readLocalRef(branch);
    const targets = records.filter(item => samePath(item.path, targetPath));
    const owners = records.filter(item => item.branch === `refs/heads/${branch}`);
    if (worktreeExpected) requireExactWorktree({ targets, owners, branch, headSha });
    else if (targets.length || owners.length) fail("worktree collision");
    const registry = lockedRegistry || readWriterRegistry();
    if (registry?.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !Number.isSafeInteger(registry.revision)
      || registry.revision < 0 || registry.revision >= Number.MAX_SAFE_INTEGER
      || !registry.leases || typeof registry.leases !== "object" || Array.isArray(registry.leases)) fail("writer registry");
    const lease = registry.leases?.[branch] || null;
    const targetLeases = Object.entries(registry.leases || {})
      .filter(([, item]) => samePath(item?.worktreePath, targetPath));
    const expectedLease = { ...markerSource, schema: "agentic-writer-lease/v2",
      worktreePath: targetPath, pullRequestUrl: pullUrl };
    const exactLease = digestValue(lease) === digestValue(expectedLease) && targetLeases.length === 1
      && targetLeases[0][0] === branch;
    const observedPartial = ref === headSha && exactLease;
    const observedAbsent = !ref && !lease && targetLeases.length === 0;
    let mode = plannedProjection?.mode;
    if (!mode) {
      if (observedPartial) mode = "worktree-only";
      else if (observedAbsent) mode = "all-absent";
      else if (lease || targetLeases.length) fail("writer lease collision");
      else fail("local branch collision");
    }
    const partial = mode === "worktree-only";
    const branchExpected = partial || phaseIndex(phase) >= phaseIndex("branch-created");
    const leaseExpected = partial || phaseIndex(phase) >= phaseIndex("lease-recovered");
    if ((branchExpected && ref !== headSha) || (!branchExpected && ref)) fail("local branch collision");
    if (leaseExpected) {
      if (!exactLease) fail("rehydrated lease drift");
    } else if (lease || targetLeases.length) {
      fail("writer lease collision");
    }
    const leaseProjectionDigest = digestValue({ schema: WRITER_LEASE_REGISTRY_SCHEMA, branch,
      branchLeaseDigest: partial ? digestValue(lease) : null, targetPath,
      targetOwners: partial ? targetLeases.map(([owner, item]) => ({ owner, leaseDigest: digestValue(item) })) : [] });
    const localProjection = partial ? { mode, branch: { headSha, refDigest: digestValue({ branch, head: headSha }) },
      lease: { leaseDigest: digestValue(lease), projectionDigest: leaseProjectionDigest }, worktreeAbsent: true }
      : { mode, branch: null, lease: null, worktreeAbsent: true };
    if (plannedProjection && digestValue(localProjection) !== digestValue(plannedProjection)) fail("planned local projection drift");
    return { localProjection, leaseProjectionDigest };
  }

  function requireExactWorktree({ targets, owners, branch, headSha }) {
    if (targets.length !== 1 || owners.length !== 1 || targets[0] !== owners[0]
      || targets[0].head !== headSha || targets[0].branch !== `refs/heads/${branch}`
      || targets[0].bare || targets[0].locked || targets[0].prunable || targets[0].detached
      || git(["-C", targetPath, "rev-parse", "HEAD"]) !== headSha
      || git(["-C", targetPath, "branch", "--show-current"]) !== branch
      || git(["-C", targetPath, "status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("registered worktree");
  }

  function requireTarget(ownership, { allowTarget = false } = {}) {
    if (ownership.kind !== "managed" || path.dirname(targetPath) !== ownership.managedContainer.root
      || !SAFE_NAME.test(path.basename(targetPath))) fail("managed target");
    const chain = [ownership.workspaceRoot, ownership.sharedContainer.root, ownership.managedContainer.root, targetPath];
    for (const item of chain) {
      try {
        const stat = lstatSync(item);
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail("target ancestor");
        if (item === targetPath && !allowTarget) fail("target collision");
      } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
  }

  function reconcile({ plan, intent = null, phase }) {
    const evidence = plan.evidence, branch = evidence.branch, head = evidence.remoteHeadSha;
    const adopted = evidence.localProjection.mode === "worktree-only";
    const attempted = intent?.attempts?.some(item => item.phase === phase);
    if (adopted && phase === "branch-created" && !attempted) return null;
    if (adopted && phase === "lease-recovered" && intent?.status === "worktree-created" && !attempted) return null;
    if (phase === "branch-created") {
      const ref = readLocalRef(branch);
      if (!ref) return null; if (ref !== head) fail("branch response");
      return { branch, headSha: head, refDigest: digestValue({ branch, head }),
        disposition: adopted ? "adopted" : "created" };
    }
    if (phase === "worktree-created") {
      const records = parseWorktreeRecords(gitRaw(["worktree", "list", "--porcelain", "-z"]));
      const targets = records.filter(item => samePath(item.path, targetPath));
      const owners = records.filter(item => item.branch === `refs/heads/${branch}`);
      if (!targets.length && !owners.length) return null;
      requireExactWorktree({ targets, owners, branch, headSha: head });
      return { targetPath, headSha: head,
        registrationDigest: digestValue(registrationProjection(records, branch, true)), disposition: "created" };
    }
    if (phase === "lease-recovered") {
      const registry = readWriterRegistry();
      const lease = registry.leases?.[branch] || null; if (!lease) return null;
      const marker = parseWriterLeasePullRequestBody(currentBody || providerSubject().pull.body);
      const expected = { ...marker, schema: "agentic-writer-lease/v2", worktreePath: targetPath,
        pullRequestUrl: evidence.pullRequest.url };
      if (digestValue(lease) !== digestValue(expected)) fail("lease response");
      if (adopted) return { disposition: "adopted", leaseDigest: digestValue(lease),
        epoch: lease.epoch, sessionId: lease.sessionId,
        leaseProjectionDigest: evidence.localProjection.lease.projectionDigest };
      const receipt = readLeaseCasReceipt(plan);
      if (!receipt || receipt.status !== "committed" || receipt.leaseDigest !== digestValue(lease)) {
        fail("committed lease CAS receipt");
      }
      return { disposition: "created", leaseDigest: digestValue(lease), epoch: lease.epoch, sessionId: lease.sessionId,
        leaseCasReceiptDigest: receipt.receiptDigest,
        leaseRegistryBeforeRevision: receipt.beforeRevision, leaseRegistryBeforeDigest: receipt.beforeDigest,
        leaseRegistryAfterRevision: receipt.afterRevision, leaseRegistryAfterDigest: receipt.afterDigest };
    }
    fail("unknown reconciliation phase");
  }

  return Object.freeze({
    readPlanEvidence() { return capture("prepared"); },
    withOperationLock({ operationId }, action) { return withFileLock(path.join(journalDir, `${operationId}.lock`), action); },
    readIntent({ plan }) { return readJournal(journalPath(plan)); },
    writeIntent({ expected, value }) { writeJournal(journalPath(value.planSnapshot), expected, value); },
    withRegistryLock(action) { return withWriterRegistryLock(action); },
    revalidate({ plan, intent }) {
      let phase = intent.status;
      const pending = intent.attempts.at(-1)?.phase;
      if (pending && reconcile({ plan, intent, phase: pending })) phase = pending;
      requireExactEvidence(plan, phase);
    },
    reconcile,
    createBranch({ plan }) {
      if (plan.evidence.localProjection.mode === "worktree-only") {
        if (readLocalRef(plan.evidence.branch) !== plan.evidence.remoteHeadSha) fail("adopted branch drift");
        return;
      }
      git(["update-ref", `refs/heads/${plan.evidence.branch}`, plan.evidence.remoteHeadSha, ZERO_SHA]);
    },
    createWorktree({ plan }) {
      ensureTargetParents(plan.evidence.target);
      requireTargetForCreation(plan.evidence.target);
      git(["worktree", "add", "--", targetPath, plan.evidence.branch]);
    },
    recoverLease({ plan, intent }) {
      withWriterRegistryLock(registry => {
        requireExactEvidence(plan, intent.status, registry);
        if (plan.evidence.localProjection.mode !== "worktree-only") recoverLeaseExactly(plan, registry);
      });
    },
    verify({ plan, intent }) {
      requireExactEvidence(plan, intent.status);
      const branch = reconcile({ plan, intent, phase: "branch-created" });
      const registration = reconcile({ plan, intent, phase: "worktree-created" });
      const lease = reconcile({ plan, intent, phase: "lease-recovered" });
      if (digestValue(branch) !== digestValue(intent.phases["branch-created"])
        || digestValue(registration) !== digestValue(intent.phases["worktree-created"])
        || digestValue(lease) !== digestValue(intent.phases["lease-recovered"])) fail("phase receipt drift");
      return { leaseDigest: lease.leaseDigest, registrationDigest: registration.registrationDigest };
    },
    rollback({ plan, intent }) { return withWriterRegistryLock(registry => rollbackExact(plan, intent, registry)); },
  });

  function recoverLeaseExactly(plan, registry) {
    const marker = parseWriterLeasePullRequestBody(currentBody);
    if (!marker || marker.branch !== plan.evidence.branch || marker.status !== "review_ready") fail("recovery marker");
    const lease = { ...marker, schema: WRITER_LEASE_SCHEMA, worktreePath: targetPath,
      pullRequestUrl: plan.evidence.pullRequest.url };
    if (registry?.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !Number.isSafeInteger(registry.revision)
        || registry.revision < 0 || registry.revision >= Number.MAX_SAFE_INTEGER
        || !registry.leases || typeof registry.leases !== "object" || Array.isArray(registry.leases)) fail("writer registry CAS");
      const branchLease = registry.leases[plan.evidence.branch] || null;
      const targetOwners = Object.entries(registry.leases).filter(([, item]) => samePath(item?.worktreePath, targetPath));
      if (branchLease) {
        if (targetOwners.length !== 1 || targetOwners[0][0] !== plan.evidence.branch
          || digestValue(branchLease) !== digestValue(lease)) fail("writer registry CAS collision");
        const stored = readLeaseCasReceipt(plan);
        if (!stored || stored.status !== "committed" || stored.leaseDigest !== digestValue(lease)) {
          fail("writer registry CAS replay");
        }
        return lease;
      }
      if (targetOwners.length) fail("writer registry CAS collision");
      const next = { ...registry, revision: registry.revision + 1,
        leases: { ...registry.leases, [plan.evidence.branch]: lease } };
      const priorReceipt = readLeaseCasReceipt(plan);
      if (priorReceipt) fail("writer registry CAS pending provenance");
      const prepared = createLeaseCasReceipt({ plan, lease, registry, next, status: "prepared" });
      writeLeaseCasReceipt(plan, null, prepared);
      registryWriter(next);
      if (digestValue(readWriterRegistry()) !== digestValue(next)) fail("writer registry write");
      const committed = createLeaseCasReceipt({ plan, lease, registry, next, status: "committed" });
      writeLeaseCasReceipt(plan, prepared, committed);
      return lease;
  }

  function createLeaseCasReceipt({ plan, lease, registry, next, status }) {
    const core = { schema: "agentic-open-reviewed-lane-rehydration-lease-cas/v1",
      status,
      operationId: createOpenReviewedLaneRehydrationIntent(plan).operationId, planDigest: plan.planDigest,
      branch: plan.evidence.branch, targetPath, leaseDigest: digestValue(lease),
      beforeRevision: registry.revision, beforeDigest: digestValue(registry),
      afterRevision: next.revision, afterDigest: digestValue(next) };
    return { ...core, receiptDigest: digestValue(core) };
  }

  function normalizeLeaseCasReceipt(value, plan) {
    const { receiptDigest, ...core } = value || {};
    const expectedKeys = ["schema", "status", "operationId", "planDigest", "branch", "targetPath", "leaseDigest",
      "beforeRevision", "beforeDigest", "afterRevision", "afterDigest"];
    if (JSON.stringify(Object.keys(core).sort()) !== JSON.stringify(expectedKeys.sort())
      || core.schema !== "agentic-open-reviewed-lane-rehydration-lease-cas/v1"
      || !["prepared", "committed"].includes(core.status)
      || core.operationId !== createOpenReviewedLaneRehydrationIntent(plan).operationId
      || core.planDigest !== plan.planDigest || core.branch !== plan.evidence.branch || core.targetPath !== targetPath
      || !Number.isSafeInteger(core.beforeRevision) || core.beforeRevision < 0
      || core.beforeRevision >= Number.MAX_SAFE_INTEGER
      || core.afterRevision !== core.beforeRevision + 1
      || !/^[0-9a-f]{64}$/u.test(core.leaseDigest) || !/^[0-9a-f]{64}$/u.test(core.beforeDigest)
      || !/^[0-9a-f]{64}$/u.test(core.afterDigest) || receiptDigest !== digestValue(core)) fail("lease CAS receipt");
    return Object.freeze({ ...core, receiptDigest });
  }

  function leaseCasPath(plan) {
    return path.join(journalDir, `${createOpenReviewedLaneRehydrationIntent(plan).operationId}.lease-cas.json`);
  }
  function readLeaseCasReceipt(plan) {
    const file = leaseCasPath(plan);
    if (!existsSync(file)) return null;
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail("lease CAS file");
    return normalizeLeaseCasReceipt(JSON.parse(readFileSync(file, "utf8")), plan);
  }
  function writeLeaseCasReceipt(plan, expected, value) {
    ensureJournalDirectory();
    const file = leaseCasPath(plan), current = readLeaseCasReceipt(plan);
    if (digestValue(current) !== digestValue(expected)) fail("lease CAS journal compare-and-swap");
    writeAtomicPrivateJson(file, value);
  }

  function writeRegistryAtomic(value) {
    const file = store.statePath, directory = path.dirname(file);
    requireWriterRegistryPath({ parentRequired: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.rehydration.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    try { renameSync(temporary, file); syncDirectory(directory); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail("writer registry mode");
  }

  function withWriterRegistryLock(action) {
    requireWriterRegistryPath();
    return store.withRegistryLock(registry => {
      requireWriterRegistryPath({ parentRequired: true }); return action(registry);
    });
  }
  function readWriterRegistry() {
    requireWriterRegistryPath(); const registry = store.readRegistry(); requireWriterRegistryPath(); return registry;
  }
  function requireWriterRegistryPath({ parentRequired = false } = {}) {
    const file = store.statePath, parent = path.dirname(file), expectedParent = path.join(commonDir, "agentic-canvas-os");
    if (file !== path.join(expectedParent, "writer-leases.json") || parent !== expectedParent) fail("writer registry path");
    try { const stat = lstatSync(parent); if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent) fail("writer registry parent"); }
    catch (error) { if (error?.code !== "ENOENT" || parentRequired) throw error; return; }
    try { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) fail("writer registry file"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  function requireExactEvidence(plan, phase, lockedRegistry = null) {
    const observed = buildOpenReviewedLaneRehydrationPlan(capture(phase, lockedRegistry, plan.evidence.localProjection));
    if (observed.planDigest !== plan.planDigest) fail("authorized plan drift");
    return observed.evidence;
  }

  function rollbackExact(plan, intent, registry) {
    const branch = plan.evidence.branch, head = plan.evidence.remoteHeadSha;
    if (registry?.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !Number.isSafeInteger(registry.revision)
      || registry.revision < 0 || registry.revision >= Number.MAX_SAFE_INTEGER
      || !registry.leases || typeof registry.leases !== "object" || Array.isArray(registry.leases)) fail("rollback writer registry");
    if (registry.leases[branch] || Object.values(registry.leases).some(item => samePath(item?.worktreePath, targetPath))) {
      fail("rollback after lease insertion");
    }
    const records = parseWorktreeRecords(gitRaw(["worktree", "list", "--porcelain", "-z"]));
    const targets = records.filter(item => samePath(item.path, targetPath));
    const owners = records.filter(item => item.branch === `refs/heads/${branch}`);
    const worktreeCreated = Boolean(intent.phases["worktree-created"]);
    const branchCreated = Boolean(intent.phases["branch-created"]);
    if (targets.length && worktreeCreated) {
      requireExactWorktree({ targets, owners, branch, headSha: head });
      if (digestValue(registrationProjection(records, branch, false))
        !== plan.evidence.canonical.registrationDigest) fail("rollback registration baseline");
      git(["worktree", "remove", "--", targetPath]);
    } else if (targets.length || existsSync(targetPath)) fail("unattributed rollback target retained");
    const afterRecords = parseWorktreeRecords(gitRaw(["worktree", "list", "--porcelain", "-z"]));
    if (afterRecords.some(item => item.branch === `refs/heads/${branch}`)
      || afterRecords.some(item => samePath(item.path, targetPath))
      || digestValue(registrationProjection(afterRecords, branch, false))
        !== plan.evidence.canonical.registrationDigest) fail("rollback target registration drift");
    const ref = readLocalRef(branch);
    if (ref && ref !== head) fail("rollback branch drift");
    if (ref && !branchCreated) fail("unattributed rollback branch retained");
    if (ref) git(["update-ref", "-d", `refs/heads/${branch}`, head]);
    cleanupEmptyTaskWorktreeContainers({ repoRoot: repository, gitCommonDir: commonDir, targetPath });
  }

  function journalPath(plan) { return path.join(journalDir, `${createOpenReviewedLaneRehydrationIntent(plan).operationId}.json`); }
  function readJournal(file) {
    if (!existsSync(file)) return null;
    const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()
      || (stat.mode & 0o777) !== 0o600) fail("journal file");
    return normalizeOpenReviewedLaneRehydrationIntent(JSON.parse(readFileSync(file, "utf8")));
  }
  function writeJournal(file, expected, value) {
    ensureJournalDirectory();
    const current = readJournal(file);
    if (digestValue(current) !== digestValue(expected)) fail("journal compare-and-swap");
    writeAtomicPrivateJson(file, value);
  }
  function writeAtomicPrivateJson(file, value) {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    try { renameSync(temporary, file); syncDirectory(journalDir); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail("journal mode");
  }
  function ensureJournalDirectory() {
    let current = commonDir;
    for (const segment of ["agentic-canvas-os", "open-reviewed-lane-rehydration"]) {
      current = path.join(current, segment);
      try {
        const stat = lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail("journal directory");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        mkdirSync(current, { mode: 0o700 });
        syncDirectory(path.dirname(current));
      }
    }
  }
  function withFileLock(file, action) {
    ensureJournalDirectory();
    let release;
    try { release = createOwnedOperationLock(file, randomUUID()); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      throw new Error("Open reviewed lane operation is already fenced; an abandoned lock requires explicit evidence-bound owner recovery.");
    }
    try { return action(); } finally { release(); }
  }
  function createOwnedOperationLock(file, token) {
    const descriptor = openSync(file, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
    fsyncSync(descriptor); syncDirectory(journalDir);
    return () => {
      closeSync(descriptor);
      if (readLock(file)?.token === token) { unlinkSync(file); syncDirectory(journalDir); }
    };
  }
  function remoteSha(ref, label) {
    const rows = git(["ls-remote", "origin", ref]).split(/\r?\n/u).filter(Boolean);
    if (rows.length !== 1) fail(label);
    const [sha] = rows[0].split(/\s+/u); if (!/^[0-9a-f]{40}$/u.test(sha)) fail(label); return sha;
  }
  function readLocalRef(branch) {
    const ref = `refs/heads/${branch}`;
    try { git(["show-ref", "--verify", "--quiet", ref]); }
    catch (error) { if (error?.status === 1) return ""; throw error; }
    return git(["show-ref", "--hash", "--verify", ref]);
  }

  function registrationProjection(records, branch, includeTarget) {
    const canonical = records.filter(item => samePath(item.path, repository));
    if (canonical.length !== 1) fail("canonical registration");
    const targetRecords = records.filter(item => samePath(item.path, targetPath));
    const branchOwners = records.filter(item => item.branch === `refs/heads/${branch}`);
    return { schema: "agentic-open-reviewed-lane-target-registration/v1",
      canonical: registrationRecord(canonical[0]), branch, targetPath,
      targetRecords: includeTarget ? targetRecords.map(registrationRecord) : [],
      branchOwners: includeTarget ? branchOwners.map(registrationRecord) : [] };
  }
  function requireGit(args) { try { return git(args); } catch { fail(`git ${args[0]}`); } }
}

function readLock(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) return null;
    const value = JSON.parse(readFileSync(file, "utf8"));
    return Number.isSafeInteger(value?.pid) && value.pid > 0 && typeof value?.token === "string"
      ? value : null;
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function markerProjection(value) {
  return { status: value.status, epoch: value.epoch, sessionId: value.sessionId, device: value.device,
    scope: value.scope, branch: value.branch, baseSha: value.baseSha, fenceSha: value.fenceSha,
    reviewHeadSha: value.reviewHeadSha, expiresAt: value.expiresAt,
    admission: value.admission, cloudAuthority: value.cloudAuthority,
    markerDigest: digestValue(value) };
}
function requireTargetForCreation(target) {
  for (const item of [target.sharedRoot, target.managedRoot, target.path]) {
    try { const stat = lstatSync(item); if (stat.isSymbolicLink() || (item === target.path) || !stat.isDirectory()) fail("creation path"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}
function ensureTargetParents(target) {
  for (const item of [target.sharedRoot, target.managedRoot]) {
    try {
      const stat = lstatSync(item);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("creation parent");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(item), parentStat = lstatSync(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail("creation parent");
      mkdirSync(item, { mode: 0o700 }); syncDirectory(parent);
    }
  }
}
function overlaps(left, right) { try { return writeSetsOverlap(left, right); } catch { return true; } }
function phaseIndex(value) { return ["prepared", "branch-created", "worktree-created", "lease-recovered", "complete"].indexOf(value); }
function samePath(left, right) { return Boolean(left && right && path.resolve(left) === path.resolve(right)); }
function registrationRecord(value) {
  return { path: path.resolve(value.path), head: value.head || null, branch: value.branch || null,
    bare: value.bare === true, detached: value.detached === true,
    locked: value.locked === true, prunable: value.prunable === true };
}
function required(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) fail(label); return value; }
function repositoryIdentity(value, label) { const result = required(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) fail(label); return result; }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function fail(label) { throw new Error(`Open reviewed lane rehydration ${label} is invalid.`); }
